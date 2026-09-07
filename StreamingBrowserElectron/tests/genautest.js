"use strict";

/*
 * Genau anhalten, genau springen, gemeinsam starten.
 *
 * Zwei gemeldete Fehler, und beide sind Rechenfehler und keine Geschmacksfrage:
 *
 *   1. "Beim Pausieren zeigen zwei Geraete dieselbe Sekunde, aber verschiedene
 *      Bilder." Die Stelle ging auf zwei Nachkommastellen hinaus, und niemand
 *      hat nachgesehen, wo der Sprung wirklich gelandet ist.
 *   2. "Play startet nicht gleichzeitig." Wer drueckte, lief sofort los; die
 *      anderen holten auf. Der Rueckstand war die Laufzeit der Nachricht plus
 *      Springen und Puffern - jedes Mal, und er blieb stehen, weil der laufende
 *      Ausgleich erst bei fuenf Sekunden eingreift.
 *
 * Geprueft wird hier gegen ein nachgebautes <video>, das sich wie ein echtes
 * verhaelt: `currentTime = x` ist kein Zuweisen, sondern der Anfang eines
 * Suchvorgangs, `seeked` kommt spaeter, und gelandet wird nicht unbedingt dort,
 * wo man hinwollte. Genau daran ist die alte Fassung vorbeigelaufen.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const sync = require("../src/watchparty-sync");

const WURZEL = path.join(__dirname, "..");
const SPIELER = fs.readFileSync(path.join(WURZEL, "src/renderer/spieler.js"), "utf8");

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------------------------------------- Das Video */

/**
 * Ein <video>, das seine Suchvorgaenge ernst nimmt.
 *
 * @param danebenS um wieviel der *erste* Sprung danebengeht - so verhaelt sich
 *                 eine Quelle, die auf ein Schluesselbild aufsetzt. Jeder
 *                 weitere Sprung sitzt.
 * @param immer    wenn wahr, geht *jeder* Sprung daneben: ein Player, der die
 *                 Stelle nie trifft.
 */
function videoBauen(danebenS = 0, immer = false) {
  const horcher = {};
  const spuren = { ziele: [], spruenge: 0 };
  let stelle = 0;
  const bild = {
    paused: true, ended: false, seeking: false, readyState: 4,
    duration: 1371, volume: 1, muted: false, playbackRate: 1, defaultPlaybackRate: 1,
    buffered: { length: 0 }, textTracks: [],
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(name, fn) { (horcher[name] ||= []).push(fn); },
    removeEventListener(name, fn) { horcher[name] = (horcher[name] || []).filter((f) => f !== fn); },
    dispatchEvent(ereignis) { for (const fn of [...(horcher[ereignis.type] || [])]) fn(ereignis); },
    play() { this.paused = false; this.dispatchEvent({ type: "play" }); return Promise.resolve(); },
    pause() {
      const lief = !this.paused;
      this.paused = true;
      if (lief) this.dispatchEvent({ type: "pause" });
    },
    load() {}, canPlayType() { return ""; },
    setAttribute() {}, getAttribute() { return ""; }, removeAttribute() {},
    append() {}, appendChild() {}, replaceChildren() {},
    spuren
  };
  Object.defineProperty(bild, "currentTime", {
    get() { return stelle; },
    set(wert) {
      // Genau das ist der Punkt: die Zuweisung *startet* eine Suche. Wo sie
      // endet, steht erst hinterher fest.
      spuren.ziele.push(wert);
      spuren.spruenge += 1;
      const daneben = immer || spuren.spruenge === 1 ? danebenS : 0;
      bild.seeking = true;
      setTimeout(() => {
        stelle = wert + daneben;
        bild.seeking = false;
        bild.dispatchEvent({ type: "seeked" });
      }, 5);
    }
  });
  return bild;
}

function spielerKontext(bild) {
  const elemente = new Map();
  const meldungen = [];
  function element(id) {
    if (id === "bild") return bild;
    if (elemente.has(id)) return elemente.get(id);
    const horcher = {};
    const attribute = new Map();
    const el = {
      hidden: true, value: "", children: [], disabled: false,
      style: { setProperty() {} },
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(name, fn) { (horcher[name] ||= []).push(fn); },
      removeEventListener() {},
      dispatchEvent(ereignis) { for (const fn of horcher[ereignis.type] || []) fn(ereignis); },
      appendChild(kind) { this.children.push(kind); return kind; },
      append(...kinder) { this.children.push(...kinder); },
      replaceChildren(...kinder) { this.children = kinder; },
      querySelector() { return null; }, querySelectorAll() { return []; },
      setAttribute(name, value) { attribute.set(name, String(value)); },
      getAttribute(name) { return attribute.get(name) ?? null; },
      removeAttribute(name) { attribute.delete(name); },
      focus() {}, requestLayout() {}
    };
    Object.defineProperty(el, "textContent", {
      get() { return this.text || ""; },
      set(wert) { this.text = wert; this.children = []; }
    });
    elemente.set(id, el);
    return el;
  }
  const bruecke = new Proxy(
    { stand: (wert) => meldungen.push(wert), folgen: async () => null, wechseln: async () => ({ ok: true }) },
    { get: (objekt, key) => objekt[key] || (() => {}) }
  );
  const still = { log() {}, warn() {}, error() {}, info() {} };
  const c = vm.createContext({
    window: { elfixSpieler: bruecke }, console: still, Date, Event, Promise,
    document: { getElementById: element, createElement: () => element(Symbol()), addEventListener() {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}
  });
  vm.runInContext(SPIELER, c);
  return { c, element, meldungen };
}

(async () => {
  /* --- 1. Die Pause sitzt auf die Millisekunde --------------------------- */

  const STELLE = 421.037;

  {
    // Ein Player, der beim ersten Sprung 130 ms danebenlandet - drei Bilder.
    const bild = videoBauen(0.13);
    const { c } = spielerKontext(bild);
    bild.paused = false;
    bild.currentTime = 300;
    bild.spuren.ziele.length = 0;
    bild.spuren.spruenge = 0;

    c.steuernAusRunde({ tun: "stelle", stelle: STELLE, laufen: false, springen: true, genau: true });
    await schlaf(120);

    pruefe("Die Pause haelt zuerst an", bild.paused === true);
    pruefe("Gesprungen wird auf genau die uebertragene Zahl",
      bild.spuren.ziele[0] === STELLE, String(bild.spuren.ziele[0]));
    pruefe("Nicht auf 421, nicht auf 421.0, nicht auf 421.04",
      bild.spuren.ziele.every((ziel) => ziel === STELLE),
      JSON.stringify(bild.spuren.ziele));
    pruefe("Nach dem seeked wird nachgemessen und einmal nachgesetzt",
      bild.spuren.spruenge === 2, String(bild.spuren.spruenge));
    pruefe("Und dann sitzt die Stelle innerhalb von zwanzig Millisekunden",
      Math.abs(bild.currentTime - STELLE) <= 0.02,
      (bild.currentTime - STELLE).toFixed(6));
    pruefe("Danach steht das Bild - kein Weiterlaufen", bild.paused === true);
  }

  {
    // Sitzt der Sprung gleich, wird nicht nachgesetzt. Keine Schleife.
    const bild = videoBauen(0);
    const { c } = spielerKontext(bild);
    c.steuernAusRunde({ tun: "stelle", stelle: STELLE, laufen: false, springen: true, genau: true });
    await schlaf(120);
    pruefe("Sitzt es beim ersten Mal, wird nicht noch einmal gesprungen",
      bild.spuren.spruenge === 1, String(bild.spuren.spruenge));
  }

  {
    // Und auch ein Player, der die Stelle nie trifft, springt nicht endlos.
    const bild = videoBauen(0.4, true);
    const { c } = spielerKontext(bild);
    c.steuernAusRunde({ tun: "stelle", stelle: STELLE, laufen: false, springen: true, genau: true });
    await schlaf(200);
    pruefe("Wer die Stelle nie trifft, springt trotzdem nur zweimal",
      bild.spuren.spruenge === 2, String(bild.spuren.spruenge));
  }

  /* --- 2. Der gemeinsame Start ------------------------------------------- */

  {
    const { c, element } = spielerKontext(videoBauen());
    vm.runInContext("inRunde = true", c);
    c.startAnfordern();
    pruefe("Beide Playbuttons zeigen denselben abbrechbaren Wartezustand",
      [element("spielen"), element("mitteSpielen")].every(button =>
        button.getAttribute("aria-busy") === "true"
        && button.getAttribute("data-play-state") === "pause"
        && button.getAttribute("aria-label").includes("abbrechen")));
    c.pauseAnfordern();
    pruefe("Abbrechen setzt beide Buttons unmittelbar auf Play zurueck",
      [element("spielen"), element("mitteSpielen")].every(button =>
        button.getAttribute("aria-busy") === "false"
        && button.getAttribute("data-play-state") === "play"));
  }

  {
    const bild = videoBauen(0);
    const { c } = spielerKontext(bild);
    bild.currentTime = 100;
    await schlaf(20);
    bild.spuren.spruenge = 0;
    bild.spuren.ziele.length = 0;

    // Ein verabredeter Start in 200 ms - der Player wartet ihn ab.
    c.steuernAusRunde({ tun: "stelle", stelle: 100, laufen: true, springen: true, wartenMs: 200 });
    await schlaf(60);
    pruefe("Vor dem verabredeten Zeitpunkt laeuft nichts", bild.paused === true);
    await schlaf(400);
    pruefe("Und danach laeuft es", bild.paused === false);
  }

  /* --- 3. Die Rechnung dahinter, fuer beide Geraete dieselbe ------------- */

  {
    const bild = videoBauen(0);
    const { c, meldungen } = spielerKontext(bild);
    vm.runInContext("inRunde = true", c);
    bild.readyState = 2;
    c.steuernAusRunde({ stelle: 70, laufen: true, wartenMs: 100 });
    await schlaf(2700);
    pruefe("Ein verlorener Puffer startet nach Fristablauf nicht allein", bild.paused);
  }

  {
    const bild = videoBauen(0);
    const { c } = spielerKontext(bild);
    const frist = Date.now() + 200;
    c.steuernAusRunde({ stelle: 80.123, laufen: true, startLokal: frist, wartenMs: 600 });
    await schlaf(320);
    pruefe("IPC-Verzoegerung verschiebt den absoluten Startzeitpunkt nicht", !bild.paused);
  }
  {
    const bild = videoBauen(0);
    const { c } = spielerKontext(bild);
    vm.runInContext("inRunde = true", c);
    c.steuernAusRunde({ stelle: 90.321, laufen: true, startLokal: Date.now() + 200 });
    await schlaf(50);
    c.spielenUmschalten();
    await schlaf(300);
    pruefe("Pause waehrend eines verabredeten Starts widerruft den Start", bild.paused);
  }
  {
    const bild = videoBauen(0);
    const { c } = spielerKontext(bild);
    c.steuernAusRunde({ stelle: 90.321, laufen: true, wartenMs: 200 });
    await schlaf(40);
    c.steuernAusRunde({ stelle: 92.123, laufen: false, genau: true });
    await schlaf(300);
    pruefe("Ein neuer Pausenbefehl gewinnt gegen den alten Starttimer",
      bild.paused && Math.abs(bild.currentTime - 92.123) <= 0.001);
  }

  const ereignis = (zusatz) => ({
    videoTime: STELLE, timestamp: 1000, playing: true, hatUhr: true, tempo: 1, ...zusatz
  });

  pruefe("Ohne verabredeten Zeitpunkt bleibt es beim alten Verhalten",
    sync.startPlan(ereignis(), 1000, 0).wartenMs === 0);

  {
    // Derselbe Zeitpunkt, zwei Geraete, verschiedene Laufzeit der Nachricht.
    const startAt = 10_000;
    const host = sync.startPlan(ereignis({ startAt }), 9200);
    const gast = sync.startPlan(ereignis({ startAt }), 9650);
    pruefe("Host und Gast bekommen dieselbe Ausgangsstelle",
      host.stelle === STELLE && gast.stelle === STELLE, `${host.stelle} / ${gast.stelle}`);
    pruefe("Und warten beide genau bis zum verabredeten Augenblick",
      host.wartenMs === 800 && gast.wartenMs === 350, `${host.wartenMs} / ${gast.wartenMs}`);
    pruefe("Zusammengerechnet ist das derselbe Serverzeitpunkt",
      9200 + host.wartenMs === startAt && 9650 + gast.wartenMs === startAt);
  }

  {
    // Kuenstliche Verzoegerung: die Nachricht ist erst nach dem Zeitpunkt da.
    const startAt = 10_000;
    const spaet = sync.startPlan(ereignis({ startAt }), 10_500);
    pruefe("Wer zu spaet dran ist, wartet nicht mehr", spaet.wartenMs === 0);
    pruefe("Und bekommt die verstrichene Zeit an der Stelle gutgeschrieben",
      Math.abs(spaet.stelle - (STELLE + 0.5)) < 1e-9, String(spaet.stelle));
    pruefe("Bei doppeltem Tempo doppelt so viel Film",
      Math.abs(sync.startPlan(ereignis({ startAt, tempo: 2 }), 10_500).stelle - (STELLE + 1)) < 1e-9);
    // Das ist der Punkt: der Versatz ist einmalig und nicht dauerhaft. Wer
    // pünktlich bereit ist, startet ohne jeden Rueckstand.
    pruefe("Wer puenktlich bereit ist, hat keinen Rueckstand",
      sync.startPlan(ereignis({ startAt }), startAt).stelle === STELLE);
  }

  pruefe("Eine Pause verabredet nichts - sie gilt sofort und genau",
    sync.startPlan(ereignis({ startAt: 10_000, playing: false }), 9000).wartenMs === 0
    && sync.startPlan(ereignis({ startAt: 10_000, playing: false }), 9000).stelle === STELLE);

  /* --- 4. Nichts rundet auf dem Weg -------------------------------------- */

  pruefe("Das Ereignis fuer den Player traegt die volle Zahl",
    sync.ereignisFuerPlayer({ videoTime: STELLE, timestamp: 1, startAt: 7 }, false, 0, true).videoTime === STELLE);
  pruefe("Und den verabredeten Zeitpunkt",
    sync.ereignisFuerPlayer({ videoTime: STELLE, timestamp: 1, startAt: 7 }, true, 0, true).startAt === 7);

  const zeile = `__elfix:wp:pause:${STELLE}`;
  pruefe("Die Meldung des Horchers wird ohne Verlust gelesen",
    sync.aktionLesen(zeile).position === STELLE, String(sync.aktionLesen(zeile).position));
  const skript = sync.beobachterScript();
  pruefe("Und sie wird ohne Rundung geschrieben",
    !/toFixed\(2\)\s*\)/.test(skript) && /genaueZahl\(media\.currentTime\)/.test(skript));

  const spieler = fs.readFileSync(path.join(WURZEL, "src/renderer/spieler.js"), "utf8");
  pruefe("Der Player wartet auf seeked, statt die Zuweisung zu glauben",
    /addEventListener\("seeked", beiSeeked\)/.test(spieler)
    && /await seekAbwarten\(\)/.test(spieler));
  pruefe("In einer Runde faengt niemand allein an",
    /if \(inRunde && !ausRunde\(\)\) \{\s*\r?\n\s*startAnfordern\(\);/.test(spieler));

  const android = fs.readFileSync(
    path.join(WURZEL, "../android/app/src/main/java/local/elflix/android/DirektSpieler.java"), "utf8");
  pruefe("Android wartet ebenso, trennt Play und Pause und misst millisekundengenau nach",
    /private void abspielenAnfordern\(\)/.test(android)
    && /private void pauseAnfordern\(\)/.test(android)
    && /KEYCODE_MEDIA_PLAY_PAUSE[\s\S]*KEYCODE_MEDIA_PLAY[\s\S]*KEYCODE_MEDIA_PAUSE/.test(android)
    && /SEEK_TOLERANZ_S\s*=\s*0\.001/.test(android)
    && /abstand > SEEK_TOLERANZ_S/.test(android));

  const relay = fs.readFileSync(path.join(WURZEL, "../sync-server/server.js"), "utf8");
  pruefe("Das Relay legt den gemeinsamen Zeitpunkt fest",
    /function startZeitpunkt\(laeuftDanach, jetzt, vorschlag\)/.test(relay)
    && /startAt,/.test(relay));

  const gut = pruefungen.filter(Boolean).length;
  console.log(`${gut}/${pruefungen.length} bestanden`);
  process.exit(gut === pruefungen.length ? 0 : 1);
})();
