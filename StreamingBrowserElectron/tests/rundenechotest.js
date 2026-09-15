"use strict";

/*
 * Der Nachhall der Runde ist keine Tat - und das Ueberspringen gehoert allen.
 *
 * Zwei gemeldete Fehler, beide mit demselben Bild: die Runde haelt an, gleicht
 * sich ab, steht auf derselben Stelle - und faehrt nicht wieder los.
 *
 *   1. Autoplay schaltet auf die naechste Folge. Jeder Player laedt sie auf
 *      Ansage, und dabei meldet er von selbst: ein Quellenwechsel schickt ein
 *      `pause` hinterher, eine frisch geladene Quelle ein kurzes `play`.
 *      Gedrueckt hat das niemand - beim Relay loeschte es die offene
 *      Startverabredung, und das gemeinsame Losfahren blieb aus.
 *   2. Der Rueckblick wird uebersprungen. Beim Gast entsteht daraus die
 *      gemeinsame Startverabredung, beim Host ging derselbe Knopf als
 *      gewoehnlicher Sprung hinaus - die Runde landete hinter dem Rueckblick
 *      und blieb dort stehen.
 *
 * Geprueft wird am echten Skript des Players (renderer/spieler.js) gegen ein
 * nachgebautes <video>. Die Gegenprobe gehoert dazu: ausserhalb des Wartens
 * muss eine Pause weiterhin hinausgehen, sonst waere die Runde still.
 */

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const WURZEL = path.join(__dirname, "..");
const SPIELER = fs.readFileSync(path.join(WURZEL, "src/renderer/spieler.js"), "utf8");

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ein <video>, das nur kann, was hier gebraucht wird - aber das richtig. */
function videoBauen() {
  const horcher = {};
  const textTracks = [];
  textTracks.addEventListener = () => {};
  const bild = {
    paused: true, ended: false, seeking: false, readyState: 4,
    duration: 1400, currentTime: 0, volume: 1, muted: false,
    playbackRate: 1, defaultPlaybackRate: 1,
    buffered: { length: 0 }, textTracks,
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
    append() {}, appendChild() {}, replaceChildren() {}
  };
  return bild;
}

function spielerKontext(bild) {
  const elemente = new Map();
  const aktionen = [];
  const spruenge = [];
  function element(id) {
    if (id === "bild") return bild;
    if (elemente.has(id)) return elemente.get(id);
    const horcher = {};
    const attribute = new Map();
    const el = {
      hidden: true, value: "", children: [], disabled: false, title: "",
      style: { setProperty() {} },
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(name, fn) { (horcher[name] ||= []).push(fn); },
      removeEventListener() {},
      dispatchEvent(ereignis) { for (const fn of horcher[ereignis.type] || []) fn(ereignis); },
      appendChild(kind) { this.children.push(kind); return kind; },
      append(...kinder) { this.children.push(...kinder); },
      replaceChildren(...kinder) { this.children = kinder; },
      querySelector() { return null; }, querySelectorAll() { return []; },
      getBoundingClientRect() { return { left: 0, width: 0 }; },
      setAttribute(name, wert) { attribute.set(name, String(wert)); },
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
    {
      stand: () => {}, aktion: (...werte) => aktionen.push(werte),
      sprung: (...werte) => spruenge.push(werte),
      syncBereit: () => {}, folgen: async () => null, wechseln: async () => ({ ok: true })
    },
    { get: (objekt, key) => objekt[key] || (() => {}) }
  );
  const still = { log() {}, warn() {}, error() {}, info() {} };
  const vorschau = { erstellen: () => ({ quelle() {}, zeigen: async () => ({}), verbergen() {}, zerstoeren() {} }) };
  const c = vm.createContext({
    window: {
      elfixSpieler: bruecke,
      ElfixSpielerVorschau: vorschau,
      ElfixUntertitelwahl: require("../src/untertitelwahl"),
      ElfixSkipsegmente: require("../src/skipsegmente"),
      addEventListener() {}
    },
    navigator: {}, console: still, Date, Event, Promise,
    document: { getElementById: element, createElement: () => element(Symbol()), addEventListener() {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}
  });
  vm.runInContext(SPIELER, c);
  return { c, aktionen, spruenge };
}

(async () => {
  /* --- 1. Warten auf alle: der Player meldet seinen Nachhall nicht --------- */
  {
    const bild = videoBauen();
    const { c, aktionen } = spielerKontext(bild);
    vm.runInContext("inRunde = true", c);
    bild.paused = false;

    // Die Vorbereitung eines Folgenwechsels: anhalten und auf die Runde warten.
    c.steuernAusRunde({ tun: "stelle", stelle: 0, laufen: false, springen: false,
      genau: false, wartenAufFolge: true });
    pruefe("Die Vorbereitung stellt den Player auf Warten",
      vm.runInContext("rundeWarten", c) === true);
    aktionen.length = 0;

    // Ein Folgenwechsel dauert laenger als die kurze Echo-Sperre. Genau dann
    // meldet die alte Quelle ihr `pause` und die neue ihr erstes `play`.
    vm.runInContext("ausRundeBis = 0", c);
    bild.paused = false;
    bild.pause();
    bild.play();
    await schlaf(10);
    pruefe("Kein Echo an die Runde, solange sie den Player fuehrt",
      aktionen.length === 0, JSON.stringify(aktionen));

    // Und die Sperre klebt nicht: gibt die Runde den Player wieder frei - beim
    // gemeinsamen Start, bei einer abgelaufenen Frist, bei einer gewoehnlichen
    // Pause -, meldet er wie immer.
    c.steuernAusRunde({ tun: "stelle", stelle: 0, laufen: false, springen: false, genau: false });
    pruefe("Die freigegebene Runde laesst den Player wieder melden",
      vm.runInContext("rundeWarten", c) === false);
    vm.runInContext("ausRundeBis = 0", c);
    bild.paused = false;
    bild.pause();
    await schlaf(10);
    pruefe("Nach der Freigabe geht die eigene Pause wieder hinaus",
      aktionen.length === 1 && aktionen[0][0] === "pause", JSON.stringify(aktionen));
  }

  /* --- 2. Gegenprobe: ausserhalb des Wartens geht die Pause hinaus --------- */
  {
    const bild = videoBauen();
    const { c, aktionen } = spielerKontext(bild);
    vm.runInContext("inRunde = true; ausRundeBis = 0", c);
    bild.paused = false;
    bild.pause();
    await schlaf(10);
    pruefe("Eine eigene Pause meldet der Player weiterhin",
      aktionen.length === 1 && aktionen[0][0] === "pause", JSON.stringify(aktionen));
  }

  /* --- 3. Der Rueckblick gehoert allen - auch wenn der Host drueckt -------- */
  for (const host of [true, false]) {
    const bild = videoBauen();
    const { c, aktionen, spruenge } = spielerKontext(bild);
    bild.currentTime = 30;
    vm.runInContext(`inRunde = true; binHost = ${host}; ausRundeBis = 0;
      skipAn = true;
      skipSegmente = [{ type: "recap", start: 10, end: 95 }];`, c);

    await c.markeNutzen();
    pruefe(`Der Sprung hinter den Rueckblick sitzt (${host ? "Host" : "Gast"})`,
      bild.currentTime === 95 && spruenge.length === 1, String(bild.currentTime));
    pruefe(`Das Ueberspringen geht als "skip" an die Runde (${host ? "Host" : "Gast"})`,
      aktionen.length === 1 && aktionen[0][0] === "skip" && aktionen[0][1] === 95,
      JSON.stringify(aktionen));
  }

  /* --- 4. Freies Spulen bleibt ein Sprung --------------------------------- */
  {
    const bild = videoBauen();
    const { c, aktionen } = spielerKontext(bild);
    bild.currentTime = 300;
    vm.runInContext("inRunde = true; binHost = true; ausRundeBis = 0", c);
    await c.springen(10);
    pruefe("Der Host spult weiterhin als Sprung",
      aktionen.length === 1 && aktionen[0][0] === "seek", JSON.stringify(aktionen));
  }

  const fehler = pruefungen.filter((ok) => !ok).length;
  console.log(`${pruefungen.length - fehler}/${pruefungen.length} bestanden `
    + "(Runden-Echo bleibt still, Rueckblick ueberspringt fuer alle gemeinsam)");
  if (fehler) process.exitCode = 1;
})().catch((fehler) => {
  console.error(`FAIL ${fehler.stack || fehler}`);
  process.exitCode = 1;
});
