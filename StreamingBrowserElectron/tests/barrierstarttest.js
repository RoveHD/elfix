"use strict";

// Der Folgenwechsel selbst: sind alle Player in der neuen Folge bereit, muss
// die Runde gemeinsam anlaufen - genau einmal, ausgeloest von der letzten
// Bereitmeldung. Und ein Wiederanschluss mitten in der Vorbereitung darf die
// Barriere nicht auf eine Verbindung warten lassen, die es nicht mehr gibt.

const crypto = require("node:crypto");
const WS = require("../../sync-server/node_modules/ws");

const PORT = Number(process.env.TESTPORT) || 8799;
const ADRESSE = `ws://127.0.0.1:${PORT}`;
const URL1 = "https://aniworld.to/anime/stream/starter/staffel-1/episode-1";
const URL2 = "https://aniworld.to/anime/stream/starter/staffel-1/episode-2";

let bestanden = 0;

function nachweis(name) {
  return crypto.createHash("sha256").update(name).digest("base64url");
}

// Der Besitznachweis haengt am Namen: dieselbe Kennung ueber zwei Verbindungen
// hinweg ist genau das, was einen Wiederanschluss von einem zweiten Geraet
// unterscheidet.
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
    warten(ab, passt, was) {
      const vorhanden = eingang.slice(ab).find(passt);
      if (vorhanden) return Promise.resolve(vorhanden);
      return new Promise((resolve, reject) => {
        const warte = { ab, passt, resolve, timer: null };
        warte.timer = setTimeout(() => {
          const index = wartende.indexOf(warte);
          if (index >= 0) wartende.splice(index, 1);
          reject(new Error(`Zeitueberschreitung: ${name} wartet auf ${was}`));
        }, 2500);
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
    async schliessenUndWarten() {
      const zu = new Promise((resolve) => socket.once("close", resolve));
      socket.close();
      return zu;
    },
    schliessen() { socket?.close(); }
  };
}

async function zustandNach(geraet, senden, passt, was) {
  const ab = geraet.marke();
  senden();
  return geraet.warten(ab, (m) => m.type === "state" && passt(m), was);
}

/** Host teilt, alle uebrigen treten ein, jeder meldet seinen Playerstand. */
async function rundeAufbauen(raum, key, geraete) {
  const [host, ...gaeste] = geraete;
  await zustandNach(host, () => host.senden({
    type: "share",
    item: { key, url: URL1, title: "Starter", type: "serie", season: 1, episode: 1 }
  }), (m) => m.shared?.some((eintrag) => eintrag.key === key), "geteilten Titel");

  for (let i = 0; i < gaeste.length; i += 1) {
    const erwartet = i + 2;
    await zustandNach(host, () => gaeste[i].senden({ type: "enter", key }),
      (m) => m.shared?.find((eintrag) => eintrag.key === key)?.memberIds?.length >= erwartet,
      `Beitritt von ${gaeste[i].name}`);
  }
  for (const geraet of geraete) {
    geraet.senden({ type: "here", key, position: 0, paused: true,
      season: 1, episode: 1, playerSessionId: `${geraet.name}-player` });
  }
}

/** Folgenwechsel ausloesen und die gemeinsame Barrier-Generation einsammeln. */
async function folgeWechseln(key, geraete, ausloeser = geraete[0]) {
  const marken = geraete.map((geraet) => geraet.marke());
  ausloeser.senden({ type: "control", key, action: "navigate", position: 0, url: URL2 });
  const vorbereitungen = await Promise.all(geraete.map((geraet, i) => geraet.warten(marken[i],
    (m) => m.type === "syncprepare" && m.reason === "episode-change",
    `Folgenvorbereitung bei ${geraet.name}`)));
  const ids = new Set(vorbereitungen.map((m) => m.syncId));
  if (ids.size !== 1) throw new Error(`Keine gemeinsame Barrier-Generation: ${[...ids]}`);
  return { syncId: vorbereitungen[0].syncId, marken };
}

/**
 * Eine Chat-Marke ueber denselben Socket hinterherschicken. Kommt sie zurueck,
 * hat das Relay die davor gesendete Bereitmeldung sicher verarbeitet - ohne
 * feste Pause und ohne vorwegzunehmen, ob dabei ein Start entstand.
 */
async function abwarten(geraet, ab) {
  const marker = `barrier-marker-${crypto.randomUUID()}`;
  geraet.senden({ type: "chat", text: marker });
  await geraet.warten(ab, (m) => m.type === "chat" && m.text === marker, "Ordnungsmarkierung");
}

function starts(geraet, ab, syncId) {
  return geraet.eingang.slice(ab).filter((m) => m.type === "syncstart" && m.syncId === syncId);
}

function pruefen(bedingung, text) {
  if (!bedingung) throw new Error(text);
  bestanden += 1;
}

// 1) Zwei Teilnehmer, beide bereit: die neue Folge laeuft gemeinsam an - und
//    kein Start, solange auch nur einer noch fehlt.
async function zweiTeilnehmer() {
  const raum = "barrier-start-zwei";
  const key = "serie:barrier-start-zwei";
  const host = client("Zwei Host");
  const gast = client("Zwei Gast");
  try {
    await host.verbinden(raum);
    await gast.verbinden(raum);
    await rundeAufbauen(raum, key, [host, gast]);
    const { syncId, marken } = await folgeWechseln(key, [host, gast]);

    host.senden({ type: "syncready", key, syncId });
    await abwarten(host, marken[0]);
    pruefen(starts(host, marken[0], syncId).length === 0,
      "Die Runde startete, obwohl der zweite Player noch nicht bereit war");

    gast.senden({ type: "syncready", key, syncId });
    const start = await host.warten(marken[0],
      (m) => m.type === "syncstart" && m.syncId === syncId, "gemeinsamen Start");
    await gast.warten(marken[1],
      (m) => m.type === "syncstart" && m.syncId === syncId, "gemeinsamen Start");
    pruefen(start.url === URL2 && start.episodeId === "s1e2",
      `Der gemeinsame Start zeigt auf die falsche Folge: ${JSON.stringify(start)}`);
  } finally {
    host.schliessen();
    gast.schliessen();
  }
}

// 2) Mehrere Teilnehmer: die letzte Bereitmeldung loest den Start aus, und
//    zwar genau einmal fuer jeden.
async function letzterReadyStartet() {
  const raum = "barrier-start-viele";
  const key = "serie:barrier-start-viele";
  const geraete = ["Viele Host", "Viele A", "Viele B"].map(client);
  try {
    for (const geraet of geraete) await geraet.verbinden(raum);
    await rundeAufbauen(raum, key, geraete);
    const { syncId, marken } = await folgeWechseln(key, geraete);

    for (let i = 0; i < geraete.length - 1; i += 1) {
      geraete[i].senden({ type: "syncready", key, syncId });
      await abwarten(geraete[i], marken[i]);
      pruefen(starts(geraete[0], marken[0], syncId).length === 0,
        `Start nach nur ${i + 1} von ${geraete.length} Bereitmeldungen`);
    }

    const letzter = geraete[geraete.length - 1];
    letzter.senden({ type: "syncready", key, syncId });
    await Promise.all(geraete.map((geraet, i) => geraet.warten(marken[i],
      (m) => m.type === "syncstart" && m.syncId === syncId, `Start bei ${geraet.name}`)));
    // Eine verspaetete Wiederholung derselben Generation darf nichts mehr tun.
    letzter.senden({ type: "syncready", key, syncId });
    await abwarten(letzter, marken[geraete.length - 1]);
    for (let i = 0; i < geraete.length; i += 1) {
      const anzahl = starts(geraete[i], marken[i], syncId).length;
      pruefen(anzahl === 1, `${geraete[i].name} bekam ${anzahl} Startbefehle`);
    }
  } finally {
    for (const geraet of geraete) geraet.schliessen();
  }
}

// 3) Wiederanschluss mitten in der Barriere: der zurueckkehrende Player bekommt
//    dieselbe Vorbereitung noch einmal, seine Bereitmeldung zaehlt, und die
//    Runde laeuft danach an. Die abgebrochene Verbindung darf weder als Warter
//    uebrig bleiben noch einen zweiten Start erzeugen.
async function reconnectWaehrendBarriere() {
  const raum = "barrier-start-reconnect";
  const key = "serie:barrier-start-reconnect";
  const host = client("Reco Host");
  const gast = client("Reco Gast");
  let zurueck = null;
  try {
    await host.verbinden(raum);
    await gast.verbinden(raum);
    await rundeAufbauen(raum, key, [host, gast]);
    const { syncId, marken } = await folgeWechseln(key, [host, gast]);

    // Der Gast faellt heraus, bevor irgendjemand bereit ist, und kommt mit
    // derselben Geraetekennung zurueck.
    await gast.schliessenUndWarten();
    zurueck = client("Reco Gast");
    await zurueck.verbinden(raum);
    const ab = zurueck.marke();
    const erneut = await zurueck.warten(0,
      (m) => m.type === "syncprepare" && m.syncId === syncId,
      "erneute Vorbereitung nach Wiederanschluss");
    pruefen(erneut.url === URL2, "Der Wiederanschluss bekam die alte Folge vorbereitet");

    host.senden({ type: "syncready", key, syncId });
    await abwarten(host, marken[0]);
    pruefen(starts(host, marken[0], syncId).length === 0,
      "Die Runde startete ohne den wiederverbundenen Player");

    zurueck.senden({ type: "syncready", key, syncId });
    const start = await host.warten(marken[0],
      (m) => m.type === "syncstart" && m.syncId === syncId,
      "Start nach Wiederanschluss");
    await zurueck.warten(ab, (m) => m.type === "syncstart" && m.syncId === syncId,
      "Start beim wiederverbundenen Player");
    pruefen(start.episodeId === "s1e2", "Falsche Folge nach Wiederanschluss");
    pruefen(starts(host, marken[0], syncId).length === 1,
      "Der Wiederanschluss erzeugte einen zweiten Start");
  } finally {
    host.schliessen();
    gast.schliessen();
    zurueck?.schliessen();
  }
}

// 4) Und wer waehrend der Barriere ganz wegbleibt, haelt sie nicht auf: sobald
//    alle uebrigen bereit sind, laeuft die Runde ohne ihn an.
async function abbruchWaehrendBarriere() {
  const raum = "barrier-start-abbruch";
  const key = "serie:barrier-start-abbruch";
  const host = client("Weg Host");
  const gast = client("Weg Gast");
  try {
    await host.verbinden(raum);
    await gast.verbinden(raum);
    await rundeAufbauen(raum, key, [host, gast]);
    const { syncId, marken } = await folgeWechseln(key, [host, gast]);

    host.senden({ type: "syncready", key, syncId });
    await abwarten(host, marken[0]);
    pruefen(starts(host, marken[0], syncId).length === 0,
      "Die Runde startete, obwohl der Gast noch verbunden und nicht bereit war");

    await gast.schliessenUndWarten();
    const start = await host.warten(marken[0],
      (m) => m.type === "syncstart" && m.syncId === syncId,
      "Start nach dem Wegfall des Gastes");
    pruefen(start.episodeId === "s1e2", "Falsche Folge nach dem Wegfall des Gastes");
  } finally {
    host.schliessen();
    gast.schliessen();
  }
}

(async () => {
  await zweiTeilnehmer();
  await letzterReadyStartet();
  await reconnectWaehrendBarriere();
  await abbruchWaehrendBarriere();
  console.log(`${bestanden}/${bestanden} bestanden `
    + "(Ready-Barriere: letzter Ready startet, genau einmal, Reconnect haengt nicht)");
})().catch((fehler) => {
  console.error(`FAIL ${fehler.stack || fehler}`);
  process.exitCode = 1;
});
