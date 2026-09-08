"use strict";

// Verlaesst ein Player eine laufende Folgen-Barriere ausdruecklich, darf seine
// Geraete-ID nicht als unsichtbarer Warter uebrig bleiben. Der Raum-Socket und
// die Mitgliedschaft bleiben dabei absichtlich bestehen: `bye` beendet nur den
// Playerstand.

const crypto = require("node:crypto");
const WS = require("../../sync-server/node_modules/ws");

const PORT = Number(process.env.TESTPORT) || 8799;
const ADRESSE = `ws://127.0.0.1:${PORT}`;
const RAUM = "barrier-leave";
const KEY = "serie:barrier-leave";
const URL1 = "https://aniworld.to/anime/stream/barrier/staffel-1/episode-1";
const URL2 = "https://aniworld.to/anime/stream/barrier/staffel-1/episode-2";

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

async function zustandNach(geraet, senden, passt, was) {
  const ab = geraet.marke();
  senden();
  return geraet.warten(ab, (m) => m.type === "state" && passt(m), was);
}

(async () => {
  const host = client("Barrier Host");
  const gast = client("Barrier Gast");
  try {
    const hostJoin = await host.verbinden();
    await gast.verbinden();

    await zustandNach(host, () => host.senden({
      type: "share",
      item: { key: KEY, url: URL1, title: "Barrier", type: "serie", season: 1, episode: 1 }
    }), (m) => m.shared?.some((eintrag) => eintrag.key === KEY), "geteilten Titel");

    await zustandNach(host, () => gast.senden({ type: "enter", key: KEY }),
      (m) => m.shared?.find((eintrag) => eintrag.key === KEY)?.memberIds?.length === 2,
      "zwei Mitglieder");

    // Auf die Playerstaende warten und sie nicht bloss abschicken: erwartet
    // wird beim Folgenwechsel, wer den Titel wirklich im Player hat.
    const vorStaenden = host.marke();
    host.senden({ type: "here", key: KEY, position: 0, paused: true,
      season: 1, episode: 1, playerSessionId: "host-player" });
    gast.senden({ type: "here", key: KEY, position: 0, paused: true,
      season: 1, episode: 1, playerSessionId: "gast-player" });
    await host.warten(vorStaenden, (m) => m.type === "watchstate" && m.key === KEY
      && m.members?.length === 2, "beide Playerstaende");

    const hostAb = host.marke();
    const gastAb = gast.marke();
    host.senden({ type: "control", key: KEY, action: "navigate", position: 0, url: URL2 });
    const [hostVorbereitung, gastVorbereitung] = await Promise.all([
      host.warten(hostAb, (m) => m.type === "syncprepare" && m.reason === "episode-change",
        "Folgenvorbereitung"),
      gast.warten(gastAb, (m) => m.type === "syncprepare" && m.reason === "episode-change",
        "Folgenvorbereitung")
    ]);
    if (!hostVorbereitung.syncId || hostVorbereitung.syncId !== gastVorbereitung.syncId) {
      throw new Error("Die beiden Player erhielten keine gemeinsame Barrier-Generation");
    }

    const syncId = hostVorbereitung.syncId;
    const startAb = host.marke();
    host.senden({ type: "syncready", key: KEY, syncId });
    // Der Gast schliesst ausdruecklich seinen Player, waehrend Raumverbindung
    // und Mitgliedschaft bestehen bleiben. Damit ist er kein erwarteter
    // Player dieser Barrier mehr.
    gast.senden({ type: "bye", key: KEY });
    const start = await host.warten(startAb,
      (m) => m.type === "syncstart" && m.syncId === syncId,
      "Start nach Player-Abmeldung");
    if (start.url !== URL2 || start.episodeId !== "s1e2") {
      throw new Error(`Falscher gemeinsamer Start: ${JSON.stringify(start)}`);
    }

    // Eine verspaetete zweite Bereitschaft derselben Generation darf keinen
    // zweiten Start ausloesen. Die Chat-Markierung wird vom selben Socket nach
    // syncready verarbeitet und macht die Reihenfolge ohne feste Pause sicher.
    const marker = `barrier-marker-${Date.now()}`;
    host.senden({ type: "syncready", key: KEY, syncId });
    host.senden({ type: "chat", text: marker });
    await host.warten(startAb, (m) => m.type === "chat" && m.text === marker,
      "Ordnungsmarkierung nach doppeltem Ready");
    const starts = host.eingang.slice(startAb)
      .filter((m) => m.type === "syncstart" && m.syncId === syncId);
    if (starts.length !== 1) throw new Error(`syncstart wurde ${starts.length}-mal ausgeloest`);

    console.log(`2/2 bestanden (${hostJoin.you}: bye reevaluates barrier; syncstart exactly once)`);
  } finally {
    host.schliessen();
    gast.schliessen();
  }
})().catch((fehler) => {
  console.error(`FAIL ${fehler.stack || fehler}`);
  process.exitCode = 1;
});
