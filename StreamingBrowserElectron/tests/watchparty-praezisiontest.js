"use strict";

// Die Ausführung im Hoster-Rahmen: geplantes Losfahren, exakte Pause und das
// Abbrechen eines alten asynchronen Play-Befehls. Der Medien-Doppelgänger ist
// absichtlich klein; getestet wird der erzeugte Skripttext, nicht eine zweite
// JavaScript-Fassung der Logik.
const vm = require("vm");
const sync = require("../src/watchparty-sync");

const pruefungen = [];
const pruefe = (name, bedingung, detail = "") => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};
const schlaf = (ms) => new Promise((fertig) => setTimeout(fertig, ms));

function media(stelle = 0) {
  let zeit = stelle;
  return {
    duration: 3600, readyState: 4, seeking: false, paused: true, playbackRate: 1.5,
    playCalls: 0, pauseAt: [],
    get currentTime() { return zeit; },
    set currentTime(wert) { zeit = Number(wert); },
    pause() { this.paused = true; this.pauseAt.push(zeit); },
    play() { this.playCalls += 1; this.paused = false; return Promise.resolve(); }
  };
}

function rahmen(medium) {
  const fenster = {};
  return {
    window: fenster,
    document: { querySelectorAll: (wahl) => wahl === "video" ? [medium] : [] },
    Date, Math, Number, Boolean, Array, JSON, Promise, setTimeout, clearTimeout
  };
}

async function ausfuehren(text, kontext) {
  return vm.runInNewContext(text, kontext);
}

(async () => {
  const pauseMedium = media(10);
  const pauseRahmen = rahmen(pauseMedium);
  const pauseStelle = 421.037;
  const pause = await ausfuehren(sync.applyScript("pause", {
    videoTime: pauseStelle, timestamp: Date.now(), playing: false, hatUhr: true, tempo: 1.5
  }, { genau: true }), pauseRahmen);
  pruefe("Pause hält zuerst an und zeigt danach die exakte Stelle",
    pause === "pausiert" && pauseMedium.pauseAt.length === 1
      && Math.abs(pauseMedium.currentTime - pauseStelle) <= 0.001,
    `angehalten bei ${pauseMedium.pauseAt.at(-1)}, danach ${pauseMedium.currentTime}`);
  pruefe("Pause erhält das Tempo des Players", pauseMedium.playbackRate === 1.5);

  const startMedium = media(0);
  const startRahmen = rahmen(startMedium);
  const startAt = Date.now() + 90;
  const startPromise = ausfuehren(sync.applyScript("play", {
    videoTime: 55.125, timestamp: Date.now(), playing: true, hatUhr: true, startAt, tempo: 1.5
  }), startRahmen);
  await schlaf(35);
  pruefe("Geplantes Play startet nicht vor der Server-Deadline", startMedium.playCalls === 0);
  await startPromise;
  pruefe("Geplantes Play startet an der vereinbarten Stelle",
    // Zwischen Deadline-Prüfung und play() können wenige Millisekunden liegen;
    // die korrigiert `startPlan` in Filmzeit nach vorn.
    startMedium.playCalls === 1 && Math.abs(startMedium.currentTime - 55.125) <= 0.06,
    `${startMedium.currentTime}`);
  pruefe("Geplantes Play erhält das Tempo des Players", startMedium.playbackRate === 1.5);

  const abbruchMedium = media(0);
  const abbruchRahmen = rahmen(abbruchMedium);
  const alt = ausfuehren(sync.applyScript("play", {
    videoTime: 7, timestamp: Date.now(), playing: true, hatUhr: true, startAt: Date.now() + 180
  }), abbruchRahmen);
  await schlaf(25);
  const neu = ausfuehren(sync.applyScript("pause", {
    videoTime: 9.321, timestamp: Date.now(), playing: false, hatUhr: true
  }, { genau: true }), abbruchRahmen);
  await Promise.all([alt, neu]);
  pruefe("Neuer Befehl bricht ein wartendes altes Play ab", abbruchMedium.playCalls === 0);
  pruefe("Der neue Pause-Befehl bleibt exakt", Math.abs(abbruchMedium.currentTime - 9.321) <= 0.001);

  const sauber = sync.ereignisSaeubern({ videoTime: 4, timestamp: 5, playing: true, hatUhr: true, startAt: 6, tempo: 2 });
  pruefe("Der Player erhält Startzeitpunkt und Tempo", sauber.startAt === 6 && sauber.tempo === 2);

  const mitFrame = sync.ereignisFuerPlayer({ position: 4.2, frameTime: 4.166666 }, false, 0, true);
  pruefe("Die sichtbare Framezeit reist zum Player", mitFrame.frameTime === 4.166666);
  const ohneFrame = sync.ereignisSaeubern({ videoTime: 4, frameTime: null });
  pruefe("Eine fehlende Framezeit wird nicht zu 0:00", !Object.hasOwn(ohneFrame, "frameTime"));

  const frameMedium = media(2);
  const frameRahmen = rahmen(frameMedium);
  await ausfuehren(sync.applyScript("pause", {
    videoTime: 8.2, frameTime: 8.166666, timestamp: Date.now(), playing: false, hatUhr: true
  }, { genau: true }), frameRahmen);
  pruefe("Pause richtet sich am sichtbaren Frame statt currentTime aus",
    Math.abs(frameMedium.currentTime - 8.166666) <= 0.001, String(frameMedium.currentTime));

  const spaetMedium = media(0);
  const spaetRahmen = rahmen(spaetMedium);
  await ausfuehren(sync.applyScript("syncstart", {
    videoTime: 10, frameTime: 10, timestamp: Date.now() - 250,
    startAt: Date.now() - 200, playing: true, hatUhr: true
  }), spaetRahmen);
  pruefe("Ein verspäteter syncstart rechnet nach der Startlinie weiter",
    spaetMedium.currentTime > 10.1, String(spaetMedium.currentTime));

  const fehler = pruefungen.filter((wert) => !wert).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  process.exit(fehler ? 1 : 0);
})();
