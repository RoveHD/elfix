"use strict";

// Das Intro ueberspringen darf jeder - genau wie den Folgenwechsel. Der Sprung
// eines Gastes laeuft dabei ueber dieselbe Startverabredung wie das
// Weiterlaufen: alle halten am Ende des Intros, bestaetigen und fahren
// gemeinsam los. Freies Spulen bleibt davon unberuehrt beim Host.

const crypto = require("node:crypto");
const WS = require("../../sync-server/node_modules/ws");

const PORT = Number(process.env.TESTPORT) || 8799;
const ADRESSE = `ws://127.0.0.1:${PORT}`;
const RAUM = "intro-skip";
const KEY = "serie:intro-skip";
const URL = "https://aniworld.to/anime/stream/skipper/staffel-1/episode-1";
const START = 12;
const INTROENDE = 92;

let bestanden = 0;

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
    async verbinden() {
      socket = new WS(ADRESSE);
      socket.on("message", (roh) => empfangen(JSON.parse(String(roh))));
      await new Promise((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      const ab = eingang.length;
      this.senden({ type: "join", room: RAUM, name, deviceProof: nachweis(name) });
      return this.warten(ab, (m) => m.type === "state" && m.you, "Raumbeitritt");
    },
    schliessen() { socket?.close(); }
  };
}

/**
 * Eine Chat-Marke ueber denselben Socket hinterherschicken. Kommt sie zurueck,
 * hat das Relay den Befehl davor sicher verarbeitet - ohne feste Pause und
 * ohne vorwegzunehmen, was dabei herauskam.
 */
async function abwarten(geraet, ab) {
  const marker = `skip-marker-${crypto.randomUUID()}`;
  geraet.senden({ type: "chat", text: marker });
  await geraet.warten(ab, (m) => m.type === "chat" && m.text === marker, "Ordnungsmarkierung");
}

function pruefen(bedingung, text) {
  if (!bedingung) throw new Error(text);
  bestanden += 1;
}

(async () => {
  const host = client("Skip Host");
  const gast = client("Skip Gast");
  try {
    const hostBeitritt = await host.verbinden();
    await gast.verbinden();
    const hostId = hostBeitritt.you;

    const geteilt = host.marke();
    host.senden({ type: "share", item: { key: KEY, url: URL, title: "Skipper",
      type: "serie", season: 1, episode: 1 } });
    await host.warten(geteilt, (m) => m.type === "state"
      && m.shared?.some((eintrag) => eintrag.key === KEY), "geteilten Titel");

    const beigetreten = host.marke();
    gast.senden({ type: "enter", key: KEY });
    await host.warten(beigetreten, (m) => m.type === "state"
      && m.shared?.find((eintrag) => eintrag.key === KEY)?.memberIds?.length === 2,
      "zwei Mitglieder");

    // Beide stehen mitten im Intro derselben Folge. Wer zuerst meldet, gibt den
    // Takt vor - deshalb wird die Rollenverteilung hier abgewartet und nicht
    // der Reihenfolge zweier gleichzeitiger Nachrichten ueberlassen.
    const vorHostStand = host.marke();
    host.senden({ type: "here", key: KEY, position: START, paused: false,
      season: 1, episode: 1, playerSessionId: "host-player" });
    await host.warten(vorHostStand, (m) => m.type === "watchstate" && m.key === KEY
      && m.members?.some((mitglied) => mitglied.id === hostId && mitglied.host),
      "die bestaetigte Hostrolle");

    const vorGastStand = host.marke();
    gast.senden({ type: "here", key: KEY, position: START, paused: false,
      season: 1, episode: 1, playerSessionId: "gast-player" });
    const rollen = await host.warten(vorGastStand, (m) => m.type === "watchstate"
      && m.key === KEY && m.members?.length === 2, "beide Playerstaende");
    pruefen(rollen.members.find((mitglied) => mitglied.host)?.id === hostId,
      "Der Host ist nicht der, der zuerst gemeldet hat");

    // Freies Spulen bleibt beim Host: das ist die bestehende Regel, und sie
    // wird vom Intro-Knopf nicht aufgeweicht.
    const vorSeek = host.marke();
    gast.senden({ type: "control", key: KEY, action: "seek", position: INTROENDE });
    await abwarten(gast, gast.marke());
    await abwarten(host, vorSeek);
    pruefen(!host.eingang.slice(vorSeek).some((m) => m.type === "control" || m.type === "syncprepare"),
      "Das freie Spulen eines Gastes bewegte die Runde");

    // Der Intro-Knopf dagegen gilt fuer alle - und zwar mit der Stelle dessen,
    // der ihn drueckt, nicht mit der des Hosts.
    const hostAb = host.marke();
    const gastAb = gast.marke();
    gast.senden({ type: "control", key: KEY, action: "skip", position: INTROENDE });
    const [hostVorbereitung, gastVorbereitung] = await Promise.all([
      host.warten(hostAb, (m) => m.type === "syncprepare", "Vorbereitung beim Host"),
      gast.warten(gastAb, (m) => m.type === "syncprepare", "Vorbereitung beim Gast")
    ]);
    pruefen(hostVorbereitung.syncId === gastVorbereitung.syncId,
      "Die beiden Player bekamen keine gemeinsame Barrier-Generation");
    pruefen(Math.abs(hostVorbereitung.position - INTROENDE) < 0.001,
      `Der Host wurde auf ${hostVorbereitung.position} statt hinter das Intro gestellt`);
    pruefen(Math.abs(gastVorbereitung.position - INTROENDE) < 0.001,
      `Der Gast wurde auf ${gastVorbereitung.position} statt hinter das Intro gestellt`);

    const syncId = hostVorbereitung.syncId;
    host.senden({ type: "syncready", key: KEY, syncId });
    await abwarten(host, hostAb);
    pruefen(!host.eingang.slice(hostAb).some((m) => m.type === "syncstart" && m.syncId === syncId),
      "Die Runde startete, bevor der Gast bereit war");

    gast.senden({ type: "syncready", key: KEY, syncId });
    const [hostStart, gastStart] = await Promise.all([
      host.warten(hostAb, (m) => m.type === "syncstart" && m.syncId === syncId,
        "gemeinsamen Start hinter dem Intro"),
      gast.warten(gastAb, (m) => m.type === "syncstart" && m.syncId === syncId,
        "gemeinsamen Start hinter dem Intro")
    ]);
    pruefen(Math.abs(hostStart.position - INTROENDE) < 0.001
      && Math.abs(gastStart.position - INTROENDE) < 0.001,
      "Der gemeinsame Start liegt nicht hinter dem Intro");

    // Und der Sprung haelt: der Rundenstand steht jetzt dort, sonst zoege der
    // naechste Abgleich alle wieder ins Intro zurueck.
    const vorResync = gast.marke();
    gast.senden({ type: "resync", key: KEY });
    const antwort = await gast.warten(vorResync,
      (m) => m.type === "control" && m.resync, "Antwort auf das Abgleichen");
    pruefen(antwort.position >= INTROENDE - 0.001,
      `Der Rundenstand fiel auf ${antwort.position} zurueck`);

    console.log(`${bestanden}/${bestanden} bestanden `
      + "(Intro ueberspringen: jeder darf, gemeinsamer Start, freies Spulen bleibt beim Host)");
  } finally {
    host.schliessen();
    gast.schliessen();
  }
})().catch((fehler) => {
  console.error(`FAIL ${fehler.stack || fehler}`);
  process.exitCode = 1;
});
