"use strict";

// Zwei echte asynchrone Player-Anwendungen im selben Rahmen: Ein langsames
// Play darf nach einer neueren Pause nicht wieder anlaufen. Ausserdem darf das
// Lade-Pause-Echo eines Teilnehmers den gemeinsamen Start nicht zuruecknehmen.
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { anwendenScript, beobachterScript, abgleichScript } = require("../src/youtube-sync");

const warten = (ms) => new Promise((fertig) => setTimeout(fertig, ms));

function playerUmgebung(media, protokoll = []) {
  const listeners = new Map();
  const spieler = {
    classList: { contains: () => false },
    contains: (ziel) => ziel === media
  };
  const document = {
    querySelector: (wahl) => wahl === "#movie_player" ? spieler
      : wahl === "video.html5-main-video" ? media : null,
    querySelectorAll: (wahl) => wahl === "video" ? [media] : [],
    addEventListener: (name, handler) => {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(handler);
    }
  };
  const kontext = vm.createContext({
    window: {}, document, HTMLMediaElement: media.constructor,
    setTimeout, clearTimeout, Date, Promise, Math,
    console: { log: (zeile) => protokoll.push(String(zeile)) }
  });
  return {
    kontext,
    ausloesen(name, extra = {}) {
      for (const handler of listeners.get(name) || []) {
        handler({ type: name, target: media, key: "", ...extra });
      }
    }
  };
}

class LangsamesVideo {
  constructor() {
    this._time = 0;
    this.duration = 600;
    this.readyState = 4;
    this.seeking = false;
    this.paused = true;
    this.playAufrufe = 0;
    this.pauseAufrufe = 0;
  }
  get currentTime() { return this._time; }
  set currentTime(wert) {
    this._time = Number(wert) || 0;
    this.seeking = true;
    setTimeout(() => { this.seeking = false; }, 30);
  }
  play() {
    this.playAufrufe += 1;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.pauseAufrufe += 1;
    this.paused = true;
  }
}

(async () => {
  const media = new LangsamesVideo();
  const { kontext } = playerUmgebung(media);
  const basis = Date.now();
  const altPlay = vm.runInContext(anwendenScript({
    position: 80, updatedAt: basis, playing: true, rev: 10
  }, { aktion: "play" }), kontext);

  // Waehrend der erste Teilnehmer noch auf 80 s puffert, kommt die neuere
  // Pause. Nach deren Revision darf das alte async Play nicht mehr aufwachen.
  await warten(5);
  const neuPause = vm.runInContext(anwendenScript({
    position: 80, updatedAt: basis + 5, playing: false, rev: 11
  }, { aktion: "pause" }), kontext);
  const [alt, neu] = await Promise.all([altPlay, neuPause]);
  assert.equal(alt, "ueberholt");
  assert.equal(neu, "pausiert");
  assert.equal(media.playAufrufe, 0, "veraltetes Play lief nach neuer Pause wieder an");
  assert.equal(media.paused, true);

  // Auch der Zwei-Sekunden-Abgleich bleibt aus einer noch laufenden oder eben
  // abgeschlossenen Anwendung heraus. Sonst kaempfen zwei Skripte im Player.
  assert.equal(vm.runInContext(abgleichScript({
    position: 80, updatedAt: basis + 5, playing: false, rev: 11
  }), kontext), "anwenden");

  const echoVideo = new LangsamesVideo();
  echoVideo.readyState = 2;
  echoVideo.seeking = true;
  const meldungen = [];
  const echo = playerUmgebung(echoVideo, meldungen);
  assert.equal(vm.runInContext(beobachterScript(), echo.kontext), "installiert");

  echoVideo.paused = false;
  echo.ausloesen("play");
  echoVideo.paused = true;
  echo.ausloesen("pause");
  assert.equal(meldungen.filter((zeile) => zeile.startsWith("__elfix:yt:")).length, 1,
    "Lade-Pause eines Teilnehmers nahm den gemeinsamen Start zurueck");
  assert.ok(meldungen[0].startsWith("__elfix:yt:play:"));

  // Ein wirklicher Klick hebt die Echosperre auf; Bedienung bleibt jederzeit
  // moeglich und die folgende Pause geht als neue Tat in die YouTube-Runde.
  echo.ausloesen("pointerdown");
  echo.ausloesen("pause");
  assert.ok(meldungen[1].startsWith("__elfix:yt:pause:"));

  console.log("OK YouTube-Start: veraltetes Async-Play und Lade-Pause-Echo gesperrt");
})().catch((fehler) => {
  console.error(fehler);
  process.exitCode = 1;
});
