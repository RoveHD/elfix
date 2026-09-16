"use strict";

/*
 * Der Wunsch der Runde ueberlebt den Folgenwechsel und den Beitritt.
 *
 * Gemeldet, zweimal mit demselben Bild:
 *
 *   1. Folgenwechsel in der laufenden Runde: die neue Folge laedt, faengt kurz
 *      an - und geht sofort wieder aus. Jemand muss von Hand Play druecken.
 *   2. Ein Geraet tritt einer laufenden Runde bei: alle halten kurz an, damit
 *      abgeglichen werden kann, und bleiben danach stehen.
 *
 * Dahinter steckt beide Male dieselbe Verwechslung: ein Player, der eine neue
 * Quelle laedt oder auf den verabredeten Start wartet, meldet im Sekundentakt
 * "pausiert". Das beschreibt seine Vorbereitung und keine Pause - das Relay las
 * darin aber den Zustand der Runde und hielt daraufhin alle an, die gerade
 * losgefahren waren.
 *
 * Geprueft wird hier am echten Relay, ueber WebSockets, in der Reihenfolge der
 * Abnahmefaelle: laufende Runde wechselt die Folge, angehaltene Runde wechselt
 * die Folge, Beitritt in eine laufende und in eine angehaltene Runde, und die
 * Gegenprobe, dass eine echte Pause weiterhin jeden anhaelt.
 */

const crypto = require("node:crypto");
const WS = require("../../sync-server/node_modules/ws");

const PORT = Number(process.env.TESTPORT) || 8799;
const ADRESSE = `ws://127.0.0.1:${PORT}`;
const FOLGE1 = "https://aniworld.to/anime/stream/zustand/staffel-1/episode-1";
const FOLGE2 = "https://aniworld.to/anime/stream/zustand/staffel-1/episode-2";
const FOLGE3 = "https://aniworld.to/anime/stream/zustand/staffel-1/episode-3";

let bestanden = 0;
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

function nachweis(name) {
  return crypto.createHash("sha256").update(name).digest("base64url");
}

function client(name) {
  const eingang = [];
  const wartende = [];
  let socket;

  function empfangen(meldung) {
    eingang.push(meldung);
    for (let i = wartende.length - 1; i >= 0; i -= 1) {
      const warte = wartende[i];
      if (eingang.length <= warte.ab || !warte.passt(meldung)) continue;
      clearTimeout(warte.timer);
      wartende.splice(i, 1);
      warte.resolve(meldung);
    }
  }

  return {
    name,
    eingang,
    marke() { return eingang.length; },
    senden(meldung) { socket.send(JSON.stringify(meldung)); },
    warten(ab, passt, was, frist = 3000) {
      const vorhanden = eingang.slice(ab).find(passt);
      if (vorhanden) return Promise.resolve(vorhanden);
      return new Promise((resolve, reject) => {
        const warte = { ab, passt, resolve, timer: null };
        warte.timer = setTimeout(() => {
          const index = wartende.indexOf(warte);
          if (index >= 0) wartende.splice(index, 1);
          reject(new Error(`Zeitueberschreitung: ${name} wartet auf ${was}`));
        }, frist);
        warte.timer.unref?.();
        wartende.push(warte);
      });
    },
    async verbinden(raum) {
      socket = new WS(ADRESSE);
      socket.on("message", (roh) => empfangen(JSON.parse(String(roh))));
      await new Promise((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      const ab = eingang.length;
      this.senden({ type: "join", room: raum, name, deviceProof: nachweis(name) });
      return this.warten(ab, (m) => m.type === "state" && m.you, "Raumbeitritt");
    },
    schliessen() { socket?.close(); }
  };
}

/** Eine Ordnungsmarkierung: kommt sie zurueck, ist alles davor verarbeitet. */
async function abwarten(geraet, ab) {
  const marker = `zustand-${crypto.randomUUID()}`;
  geraet.senden({ type: "chat", text: marker });
  await geraet.warten(ab, (m) => m.type === "chat" && m.text === marker, "Ordnungsmarkierung");
}

function pruefen(bedingung, text) {
  if (!bedingung) throw new Error(text);
  bestanden += 1;
}

function stand(geraet, key, { position, paused, episode = 1, url = FOLGE1 }) {
  geraet.senden({ type: "here", key, position, paused, season: 1, episode, url,
    duration: 1400, playerSessionId: `${geraet.name}-player` });
}

/** Host teilt, die uebrigen treten ein, jeder meldet seinen Playerstand. */
async function rundeAufbauen(raum, key, geraete) {
  const [host, ...gaeste] = geraete;
  const geteilt = host.marke();
  host.senden({ type: "share",
    item: { key, url: FOLGE1, title: "Zustand", type: "serie", season: 1, episode: 1 } });
  await host.warten(geteilt, (m) => m.type === "state"
    && m.shared?.some((eintrag) => eintrag.key === key), "geteilten Titel");

  for (let i = 0; i < gaeste.length; i += 1) {
    const erwartet = i + 2;
    const ab = host.marke();
    gaeste[i].senden({ type: "enter", key });
    await host.warten(ab, (m) => m.type === "state"
      && m.shared?.find((eintrag) => eintrag.key === key)?.memberIds?.length >= erwartet,
      `Beitritt von ${gaeste[i].name}`);
  }

  // Wer zuerst meldet, fuehrt die Runde. Das darf hier nicht dem Zufall zweier
  // Sockets ueberlassen bleiben: an der Hostrolle haengt, wessen "pausiert" der
  // Rundenzustand ist - und genau darum geht es in diesen Pruefungen.
  const vorHost = host.marke();
  stand(host, key, { position: 0, paused: true });
  await host.warten(vorHost, (m) => m.type === "watchstate" && m.key === key
    && m.members?.some((mitglied) => mitglied.name === host.name && mitglied.host),
    "die bestaetigte Hostrolle");

  const vorStaenden = host.marke();
  for (const geraet of gaeste) stand(geraet, key, { position: 0, paused: true });
  if (gaeste.length) {
    await host.warten(vorStaenden, (m) => m.type === "watchstate" && m.key === key
      && m.members?.length === geraete.length, "alle Playerstaende");
  }
}

/** Play druecken und die Schranke ordentlich durchlaufen. */
async function rundeStarten(key, geraete, stelle = 10) {
  const marken = geraete.map((geraet) => geraet.marke());
  geraete[0].senden({ type: "control", key, action: "play", position: stelle });
  const vorbereitungen = await Promise.all(geraete.map((geraet, i) => geraet.warten(marken[i],
    (m) => m.type === "syncprepare", `Vorbereitung bei ${geraet.name}`)));
  const syncId = vorbereitungen[0].syncId;
  for (const geraet of geraete) geraet.senden({ type: "syncready", key, syncId });
  const start = await geraete[0].warten(marken[0],
    (m) => m.type === "syncstart" && m.syncId === syncId, "gemeinsamen Start");
  return { syncId, start, marken };
}

/** Folgenwechsel ausloesen und die gemeinsame Generation einsammeln. */
async function folgeWechseln(key, geraete, url, ausloeser = geraete[0]) {
  const marken = geraete.map((geraet) => geraet.marke());
  ausloeser.senden({ type: "control", key, action: "navigate", position: 0, url });
  const vorbereitungen = await Promise.all(geraete.map((geraet, i) => geraet.warten(marken[i],
    (m) => m.type === "syncprepare" && m.reason === "episode-change" && m.url === url,
    `Folgenvorbereitung bei ${geraet.name}`)));
  return { syncId: vorbereitungen[0].syncId, marken };
}

// --- 1. Laufende Runde wechselt die Folge: sie laeuft weiter ----------------
async function wechselImLauf() {
  const raum = "zustand-lauf";
  const key = "serie:zustand-lauf";
  const host = client("Lauf Host");
  const gast = client("Lauf Gast");
  try {
    await host.verbinden(raum);
    await gast.verbinden(raum);
    await rundeAufbauen(raum, key, [host, gast]);
    await rundeStarten(key, [host, gast]);

    const { syncId, marken } = await folgeWechseln(key, [host, gast], FOLGE2);
    // Beide laden die neue Folge und melden dabei genau das, was ein ladender
    // Player meldet: "ich stehe noch". Das darf den Start nicht verhindern.
    for (const geraet of [host, gast]) {
      stand(geraet, key, { position: 0, paused: true, episode: 2, url: FOLGE2 });
    }
    for (const geraet of [host, gast]) geraet.senden({ type: "syncready", key, syncId });

    const start = await gast.warten(marken[1],
      (m) => m.type === "syncstart" && m.syncId === syncId, "gemeinsamen Start der neuen Folge");
    pruefen(start.playing === true && start.url === FOLGE2,
      `Die laufende Runde startete die neue Folge nicht: ${JSON.stringify(start)}`);

    // Und jetzt der gemeldete Fehler: der Host laedt noch und meldet weiter
    // "pausiert", der Gast ist schon angelaufen. Frueher bekam der Gast darauf
    // ein `control pause` - die neue Folge ging nach zwei Sekunden wieder aus.
    await schlaf(3200);
    const nachStart = gast.marke();
    const hostMarke = host.marke();
    stand(host, key, { position: 0, paused: true, episode: 2, url: FOLGE2 });
    // Zwei Sockets haben keine feste Reihenfolge. Erst wenn der ladende Stand
    // des Hosts wirklich beim Relay liegt, sagt die Meldung des Gastes etwas
    // ueber die Regel aus, die hier geprueft wird.
    await abwarten(host, hostMarke);
    stand(gast, key, { position: 3, paused: false, episode: 2, url: FOLGE2 });
    await abwarten(gast, nachStart);
    const gestoppt = gast.eingang.slice(nachStart)
      .find((m) => m.type === "control" && m.action === "pause");
    pruefen(!gestoppt, `Der ladende Host hielt die neue Folge an: ${JSON.stringify(gestoppt)}`);
  } finally {
    host.schliessen();
    gast.schliessen();
  }
}

// --- 2. Angehaltene Runde wechselt die Folge: sie bleibt stehen -------------
async function wechselInDerPause() {
  const raum = "zustand-pause";
  const key = "serie:zustand-pause";
  const host = client("Pause Host");
  const gast = client("Pause Gast");
  try {
    await host.verbinden(raum);
    await gast.verbinden(raum);
    await rundeAufbauen(raum, key, [host, gast]);
    await rundeStarten(key, [host, gast]);

    // Ausdruecklich angehalten - das ist eine Entscheidung und kein Nachhall.
    const pauseMarke = gast.marke();
    host.senden({ type: "control", key, action: "pause", position: 42 });
    await gast.warten(pauseMarke, (m) => m.type === "control" && m.action === "pause",
      "die ausdrueckliche Pause");
    stand(host, key, { position: 42, paused: true });
    stand(gast, key, { position: 42, paused: true });

    const { syncId, marken } = await folgeWechseln(key, [host, gast], FOLGE3);
    for (const geraet of [host, gast]) geraet.senden({ type: "syncready", key, syncId });

    const ende = await gast.warten(marken[1], (m) => m.type === "control"
      && m.syncId === syncId && m.action === "pause", "das Ende der Schranke");
    pruefen(ende.reason === "sync-pausiert" && ende.playing === false,
      `Die angehaltene Runde endete nicht als Pause: ${JSON.stringify(ende)}`);
    pruefen(Math.abs(Number(ende.position)) < 0.001,
      `Die neue Folge steht nicht am Anfang: ${ende.position}`);
    await abwarten(gast, marken[1]);
    pruefen(!gast.eingang.slice(marken[1]).some((m) => m.type === "syncstart" && m.syncId === syncId),
      "Die angehaltene Runde startete die neue Folge trotzdem");
  } finally {
    host.schliessen();
    gast.schliessen();
  }
}

// --- 3./4. Beitritt: der Raumzustand gilt, egal ob er laeuft oder steht -----
async function beitritt(laufend) {
  const raum = laufend ? "zustand-join-lauf" : "zustand-join-pause";
  const key = `serie:${raum}`;
  const host = client(`${laufend ? "Join" : "Standjoin"} Host`);
  const neu = client(`${laufend ? "Join" : "Standjoin"} Neu`);
  try {
    await host.verbinden(raum);
    await neu.verbinden(raum);
    await rundeAufbauen(raum, key, [host]);
    await rundeStarten(key, [host], 120);
    if (!laufend) {
      const ab = host.marke();
      host.senden({ type: "control", key, action: "pause", position: 120 });
      await host.warten(ab, (m) => m.type === "control" && m.action === "pause", "die Pause");
    }
    stand(host, key, { position: 120, paused: !laufend });

    // Das neue Geraet tritt bei und fragt, was gilt. Genau diesen Weg geht der
    // Player, sobald seine Quelle steht.
    const beigetreten = host.marke();
    neu.senden({ type: "enter", key });
    await host.warten(beigetreten, (m) => m.type === "state"
      && m.shared?.find((eintrag) => eintrag.key === key)?.memberIds?.length === 2, "Beitritt");

    // Waehrend er laedt, meldet der Host weiter seinen Stand. Beim laufenden
    // Raum steht dort unmittelbar nach dem Start "pausiert" - Vorbereitung.
    const gefragt = neu.marke();
    neu.senden({ type: "resync", key });
    const antwort = await neu.warten(gefragt,
      (m) => m.type === "control" && m.resync, "die Antwort auf das Abgleichen");
    pruefen(antwort.playing === laufend,
      `Der Beitritt in eine ${laufend ? "laufende" : "angehaltene"} Runde bekam `
      + `playing=${antwort.playing}`);
    pruefen(antwort.position >= 119,
      `Der Beitritt landete bei ${antwort.position} statt bei der Stelle der Runde`);
  } finally {
    host.schliessen();
    neu.schliessen();
  }
}

// --- 5. Gegenprobe: eine echte Pause haelt weiterhin jeden an ---------------
async function echtePauseGiltWeiter() {
  const raum = "zustand-echte-pause";
  const key = "serie:zustand-echte-pause";
  const host = client("Echt Host");
  const gast = client("Echt Gast");
  try {
    await host.verbinden(raum);
    await gast.verbinden(raum);
    await rundeAufbauen(raum, key, [host, gast]);
    await rundeStarten(key, [host, gast]);

    // Der Host bestaetigt den Start - ab hier ist sein "pausiert" wieder eine
    // Pause und kein Ladezustand.
    const bestaetigt = host.marke();
    stand(host, key, { position: 12, paused: false });
    await abwarten(host, bestaetigt);
    stand(gast, key, { position: 12, paused: false });
    await schlaf(3200);

    const ab = gast.marke();
    const hostAb = host.marke();
    stand(host, key, { position: 20, paused: true });
    await abwarten(host, hostAb);
    stand(gast, key, { position: 21, paused: false });
    const nachgehalten = await gast.warten(ab,
      (m) => m.type === "control" && m.action === "pause" && m.resync,
      "das Nachhalten beim stehenden Host");
    pruefen(nachgehalten.playing === false,
      `Das Nachhalten kam als laufender Befehl: ${JSON.stringify(nachgehalten)}`);
  } finally {
    host.schliessen();
    gast.schliessen();
  }
}

(async () => {
  await wechselImLauf();
  await wechselInDerPause();
  await beitritt(true);
  await beitritt(false);
  await echtePauseGiltWeiter();
  console.log(`${bestanden}/${bestanden} bestanden `
    + "(Rundenzustand: Folgenwechsel und Beitritt halten Play/Pause, "
    + "die echte Pause haelt weiter an)");
})().catch((fehler) => {
  console.error(`FAIL ${fehler.stack || fehler}`);
  process.exitCode = 1;
});
