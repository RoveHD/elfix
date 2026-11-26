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

// Originale Frame-Skripte mit kontrollierter Uhr: seeked kann beim Nachladen
// erst lange nach dem Befehl eintreffen. Keine echte Wartefrist im Test.
function echoRahmen() {
  const medium = media(10);
  class Medium {}
  Object.setPrototypeOf(medium, Medium.prototype);
  medium.currentSrc = "https://fixture.test/folge-1.mp4";
  let jetzt = 100000;
  class Uhr extends Date { static now() { return jetzt; } }
  const horcher = new Map();
  const logs = [];
  const kontext = {
    ...rahmen(medium), Date: Uhr, HTMLMediaElement: Medium,
    console: { log(zeile) { logs.push(zeile); } },
    setInterval() { return 0; }, clearInterval() {},
    document: {
      querySelectorAll(wahl) { return wahl === "video" ? [medium] : []; },
      addEventListener(name, fn) {
        if (!horcher.has(name)) horcher.set(name, []);
        horcher.get(name).push(fn);
      }
    }
  };
  vm.runInNewContext(sync.beobachterScript(), kontext);
  const melden = (name, target = medium) => {
    for (const fn of horcher.get(name) || []) fn({ target });
  };
  const seek = (stelle) => ausfuehren(sync.applyScript("seek", {
    videoTime: stelle, playing: false, hatUhr: false
  }, { genau: true }), kontext);
  const aktionen = () => logs.filter((zeile) => /^__elfix:wp:(play|pause|seek):/.test(zeile));
  return { medium, kontext, melden, seek, aktionen, spaeter(ms) { jetzt += ms; } };
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

  for (const verzoegerung of [100, 2000, 60000]) {
    const f = echoRahmen();
    await f.seek(100.125);
    const generation = f.kontext.window.__elfixWpGeneration;
    f.spaeter(verzoegerung);
    f.melden("seeked");
    pruefe(`Fernsprung nach ${verzoegerung} ms bleibt ohne Benutzer-Echo`,
      f.aktionen().length === 0 && f.kontext.window.__elfixWpGeneration === generation);
    f.melden("seeked");
    pruefe(`Der quittierte Merker verschluckt keinen folgenden Nutzersprung (${verzoegerung} ms)`,
      f.aktionen().length === 1);
  }

  {
    const f = echoRahmen();
    f.medium.paused = false;
    await ausfuehren(sync.applyScript("pause", { videoTime: 90, playing: false }, { genau: true }), f.kontext);
    f.melden("pause");
    f.spaeter(2000);
    f.melden("seeked");
    pruefe("Eine quittierte Pause laesst ihren langsamen Fernsprung geschuetzt", f.aktionen().length === 0);
  }

  {
    const f = echoRahmen();
    await f.seek(100);
    await f.seek(200);
    f.spaeter(2000);
    f.melden("seeked");
    pruefe("Ueberlappende Fernspruenge quittieren die letzte Zielstelle", f.aktionen().length === 0);
    f.medium.currentTime = 100;
    f.melden("seeked");
    pruefe("Der ersetzte Fernsprung hinterlaesst keinen Merker", f.aktionen().length === 1);
  }

  {
    const f = echoRahmen();
    await f.seek(100);
    f.medium.currentTime = 200;
    f.melden("seeking");
    f.medium.currentTime = 100;
    f.melden("seeked");
    pruefe("Ein eigener Zwischensprung beendet den alten Fernauftrag", f.aktionen().length === 1);
  }

  {
    const f = echoRahmen();
    await f.seek(100);
    f.melden("seeking");
    f.spaeter(2000);
    f.medium.currentTime = 100.1;
    f.melden("seeked");
    pruefe("Weiterlaufende Filmzeit zwischen seeking und seeked erzeugt kein Echo", f.aktionen().length === 0);
  }

  for (const wechsel of ["loadstart", "emptied", "quelle", "runde", "video"]) {
    const f = echoRahmen();
    await f.seek(100);
    let target = f.medium;
    if (wechsel === "quelle") f.medium.currentSrc = "https://fixture.test/folge-2.mp4";
    else if (wechsel === "runde") await ausfuehren(sync.zuruecksetzenScript(), f.kontext);
    else if (wechsel === "video") {
      target = media(100);
      Object.setPrototypeOf(target, Object.getPrototypeOf(f.medium));
      target.currentSrc = f.medium.currentSrc;
    } else f.melden(wechsel);
    f.spaeter(2000);
    f.melden("seeked", target);
    pruefe(`Ein Wechsel von ${wechsel} beendet den fremden Seek-Merker`, f.aktionen().length === 1);
  }

  for (const wechsel of ["loadstart", "emptied"]) {
    const f = echoRahmen();
    f.medium.readyState = 1;
    const alterAuftrag = f.seek(100);
    f.melden(wechsel);
    f.medium.readyState = 4;
    const ergebnis = await alterAuftrag;
    pruefe(`Ein ${wechsel} bricht auch den noch wartenden Fernauftrag ab`,
      ergebnis === "abgebrochen" && !f.kontext.window.__elfixWpSpruenge.has(f.medium));
  }

  {
    const f = echoRahmen();
    f.medium.paused = false;
    f.kontext.window.__elfixWpSync = { bestaetigt: 2, seitSprung: 0, letzteMessung: 0, gemeldet: 0 };
    await ausfuehren(sync.driftScript({ videoTime: 100, playing: true, hatUhr: false }), f.kontext);
    f.spaeter(2000);
    f.melden("seeked");
    pruefe("Auch eine langsame Driftkorrektur geht nicht als Nutzersprung zurueck",
      f.medium.currentTime === 100 && f.aktionen().length === 0);
  }

  const fehler = pruefungen.filter((wert) => !wert).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  process.exit(fehler ? 1 : 0);
})();
