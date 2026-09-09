"use strict";

// Ein Ersatz-WebSocket desselben Geraets kann schon im Raum sein, bevor der
// alte WebSocket sein close-Ereignis am Relay ausloest. Der alte Abgang darf
// dann weder die neue YouTube-Mitgliedschaft noch ihren Playerstand abraeumen.

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const WS = require("../../sync-server/node_modules/ws");

const ROOT = path.join(__dirname, "../..");
const KEY = "serie:youtube-wiederanschluss";
const URL = "https://aniworld.to/anime/stream/youtube-wiederanschluss/staffel-1/episode-1";
const FRIST_MS = 3000;
const schlafen = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pruefen(bedingung, text) {
  if (!bedingung) throw new Error(text);
}

function nachweis(wert) {
  return crypto.createHash("sha256").update(wert).digest("base64url");
}

function freierPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close((fehler) => fehler ? reject(fehler) : resolve(port));
    });
  });
}

function gesund(port) {
  return new Promise((resolve) => {
    const anfrage = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 250 }, (antwort) => {
      antwort.resume();
      resolve(antwort.statusCode === 200);
    });
    anfrage.on("error", () => resolve(false));
    anfrage.on("timeout", () => {
      anfrage.destroy();
      resolve(false);
    });
  });
}

async function wartenBis(pruefung, beschreibung, frist = FRIST_MS) {
  const ende = Date.now() + frist;
  while (Date.now() < ende) {
    if (await pruefung()) return;
    await schlafen(25);
  }
  throw new Error(`Zeitueberschreitung: ${beschreibung}`);
}

function client(adresse, raum, name, geheimnis) {
  const meldungen = [];
  const wartende = [];
  let socket = null;

  function empfangen(meldung) {
    meldungen.push(meldung);
    for (let i = wartende.length - 1; i >= 0; i -= 1) {
      const warte = wartende[i];
      if (meldungen.length <= warte.ab || !warte.passt(meldung)) continue;
      clearTimeout(warte.timer);
      wartende.splice(i, 1);
      warte.resolve(meldung);
    }
  }

  const api = {
    geraetId: "",
    meldungen,
    marke: () => meldungen.length,
    senden(meldung) {
      socket.send(JSON.stringify(meldung));
    },
    warten(ab, passt, beschreibung, frist = FRIST_MS) {
      const vorhanden = meldungen.slice(ab).find(passt);
      if (vorhanden) return Promise.resolve(vorhanden);
      return new Promise((resolve, reject) => {
        const warte = { ab, passt, resolve, timer: null };
        warte.timer = setTimeout(() => {
          const index = wartende.indexOf(warte);
          if (index >= 0) wartende.splice(index, 1);
          reject(new Error(`Zeitueberschreitung: ${beschreibung}; zuletzt `
            + JSON.stringify(meldungen.slice(-5))));
        }, frist);
        warte.timer.unref?.();
        wartende.push(warte);
      });
    },
    async verbinden() {
      socket = new WS(adresse);
      socket.on("message", (roh) => empfangen(JSON.parse(String(roh))));
      await new Promise((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      const ab = api.marke();
      api.senden({ type: "join", room: raum, name, deviceProof: nachweis(geheimnis) });
      const stand = await api.warten(ab, (meldung) => meldung.type === "state" && meldung.you,
        `${name} tritt ${raum} bei`);
      api.geraetId = stand.you;
      return stand;
    },
    async youtubeBeitreten() {
      const ab = api.marke();
      api.senden({ type: "ytjoin" });
      return api.warten(ab, (meldung) => meldung.type === "ytstate"
        && meldung.members?.some((mitglied) => mitglied.id === api.geraetId),
      `${name} tritt der YouTube-Runde bei`);
    },
    async schliessen() {
      if (!socket || socket.readyState === WS.CLOSED) return;
      const geschlossen = new Promise((resolve) => socket.once("close", resolve));
      socket.close();
      await Promise.race([geschlossen, schlafen(1000)]);
    },
    beenden() {
      if (socket && socket.readyState !== WS.CLOSED) socket.terminate();
    }
  };
  return api;
}

(async () => {
  const port = await freierPort();
  const adresse = `ws://127.0.0.1:${port}`;
  const raumA = `youtube-neu-a-${crypto.randomBytes(4).toString("hex")}`;
  const raumB = `youtube-neu-b-${crypto.randomBytes(4).toString("hex")}`;
  const ablage = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-youtube-neu-"));
  const relay = spawn(process.execPath, [path.join(ROOT, "sync-server/server.js")], {
    env: {
      ...process.env,
      PORT: String(port),
      STATE_DIRECTORY: ablage,
      ELFIX_RELAY_SEITE: "0",
      ELFIX_RELAY_LEISTE: "0",
      ELFIX_RELAY_KEIN_UPDATE: "1"
    },
    stdio: "ignore",
    windowsHide: true
  });
  const clients = [];

  try {
    await wartenBis(() => gesund(port), "Relay startet");

    const beobachter = client(adresse, raumA, "Beobachter", "beobachter-a");
    const alt = client(adresse, raumA, "Dasselbe Geraet", "gleiches-geraet");
    const neu = client(adresse, raumA, "Dasselbe Geraet", "gleiches-geraet");
    clients.push(beobachter, alt, neu);
    await beobachter.verbinden();
    await beobachter.youtubeBeitreten();
    await alt.verbinden();
    await alt.youtubeBeitreten();
    await neu.verbinden();
    pruefen(neu.geraetId === alt.geraetId, "Der Ersatz bekam nicht dieselbe Geraetekennung");
    await neu.youtubeBeitreten();

    // Auch der normale Serienstand liegt an der Geraetekennung. Er darf beim
    // spaeten close des alten Sockets ebenso wenig verschwinden.
    let ab = beobachter.marke();
    neu.senden({ type: "share", item: { key: KEY, url: URL, title: "Wiederanschluss", type: "serie" } });
    await beobachter.warten(ab, (meldung) => meldung.type === "state"
      && meldung.shared?.some((eintrag) => eintrag.key === KEY), "Titel wird geteilt");
    ab = beobachter.marke();
    beobachter.senden({ type: "enter", key: KEY });
    await beobachter.warten(ab, (meldung) => meldung.type === "state"
      && meldung.shared?.find((eintrag) => eintrag.key === KEY)?.memberIds?.includes(beobachter.geraetId),
    "Beobachter tritt dem Titel bei");
    ab = beobachter.marke();
    neu.senden({ type: "here", key: KEY, position: 17, paused: true, season: 1, episode: 1,
      url: URL, playerSessionId: "ersatz-player" });
    await beobachter.warten(ab, (meldung) => meldung.type === "watchstate"
      && meldung.key === KEY && meldung.members?.some((mitglied) => mitglied.id === neu.geraetId),
    "Ersatz meldet Playerstand");

    // Das alte close muss zuerst am Relay angekommen sein. Bei erhaltenem
    // Geraetezustand antwortet der Relay hier mit der bereinigten Peerliste.
    ab = beobachter.marke();
    await alt.schliessen();
    await beobachter.warten(ab, (meldung) => meldung.type === "peers", "alter Socket wird geschlossen");

    ab = beobachter.marke();
    neu.senden({ type: "ytevent", action: "video", videoId: "dQw4w9WgXcQ", position: 0 });
    await beobachter.warten(ab, (meldung) => meldung.type === "ytevent"
      && meldung.videoId === "dQw4w9WgXcQ", "Ersatz steuert nach altem close");

    ab = beobachter.marke();
    beobachter.senden({ type: "enter", key: KEY });
    const playerstand = await beobachter.warten(ab, (meldung) => meldung.type === "watchstate"
      && meldung.key === KEY, "Playerstand nach altem close");
    pruefen(playerstand.members.some((mitglied) => mitglied.id === neu.geraetId),
      "Das alte close hat den Playerstand der Ersatzverbindung entfernt");

    // Dieselbe Kennung in einem anderen Raum ist kein Ersatz fuer diesen Raum.
    const beobachterB = client(adresse, raumB, "Beobachter B", "beobachter-b");
    const gleichesGeraetB = client(adresse, raumB, "Dasselbe Geraet", "gleiches-geraet");
    clients.push(beobachterB, gleichesGeraetB);
    await beobachterB.verbinden();
    await beobachterB.youtubeBeitreten();
    await gleichesGeraetB.verbinden();
    pruefen(gleichesGeraetB.geraetId === neu.geraetId,
      "Dieselbe Identitaet bekam im zweiten Raum eine andere Kennung");
    await gleichesGeraetB.youtubeBeitreten();
    ab = beobachterB.marke();
    await gleichesGeraetB.schliessen();
    await beobachterB.warten(ab, (meldung) => meldung.type === "ytstate"
      && meldung.reason === "left"
      && !meldung.members.some((mitglied) => mitglied.id === gleichesGeraetB.geraetId),
    "echter Abgang im zweiten Raum");

    // Ein anderes Geraet desselben Raums wird weiterhin normal entfernt.
    const anderes = client(adresse, raumA, "Anderes Geraet", "anderes-geraet");
    clients.push(anderes);
    await anderes.verbinden();
    await anderes.youtubeBeitreten();
    ab = beobachter.marke();
    await anderes.schliessen();
    const ohneAnderes = await beobachter.warten(ab, (meldung) => meldung.type === "ytstate"
      && meldung.reason === "left"
      && !meldung.members.some((mitglied) => mitglied.id === anderes.geraetId),
    "anderes Geraet wird entfernt");
    pruefen(ohneAnderes.members.some((mitglied) => mitglied.id === neu.geraetId),
      "Der Abgang eines anderen Geraets entfernte die Ersatzverbindung");

    // Erst der letzte Socket dieser Kennung beendet ihre Mitgliedschaft.
    ab = beobachter.marke();
    await neu.schliessen();
    await beobachter.warten(ab, (meldung) => meldung.type === "ytstate"
      && meldung.reason === "left"
      && !meldung.members.some((mitglied) => mitglied.id === neu.geraetId),
    "letzter Socket wird entfernt");

    console.log("OK YouTube-Wiederanschluss: Ersatz bleibt, echte Abgaenge werden je Raum und Geraet entfernt");
  } finally {
    for (const eintrag of clients) eintrag.beenden();
    relay.kill();
    await Promise.race([
      new Promise((resolve) => relay.once("exit", resolve)),
      schlafen(1000)
    ]);
    fs.rmSync(ablage, { recursive: true, force: true });
  }
})().catch((fehler) => {
  console.error(`FAIL ${fehler.stack || fehler}`);
  process.exitCode = 1;
});
