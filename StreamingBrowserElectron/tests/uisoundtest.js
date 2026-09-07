"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

let clock = 0, contexts = 0, quiet = false, observed;
const timers = new Map(), listeners = new Map(), oscillators = [], peaks = [];
const settings = { uiSounds: true, uiSoundVolume: 20 };
const document = {
  body: {}, hidden: false,
  addEventListener: (name, fn) => listeners.set(name, fn),
  removeEventListener: name => listeners.delete(name)
};
class AudioContext {
  constructor() { contexts++; this.state = "running"; this.currentTime = 0; this.destination = {}; }
  createOscillator() {
    const voice = { frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {}, disconnect() {}, start() { this.started = true; },
      stop(time) { if (time === undefined) this.stopped = true; } };
    oscillators.push(voice);
    return voice;
  }
  createGain() {
    return { gain: { setValueAtTime() {}, linearRampToValueAtTime: value => peaks.push(value),
      exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} };
  }
  close() { return Promise.resolve(); }
}
const sandbox = { document, AudioContext, performance: { now: () => clock },
  MutationObserver: class { constructor(fn) { observed = fn; } observe() {} disconnect() {} },
  setTimeout: fn => { const id = Symbol(); timers.set(id, fn); return id; },
  clearTimeout: id => timers.delete(id) };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/renderer/ui-sounds.js"), "utf8"), sandbox);
const sounds = sandbox.ELFIX_UI_SOUNDS.erstellen({ getSettings: () => settings, isQuiet: () => quiet });
const button = { matches: () => false, closest: () => null };
const click = (trusted = true, target = button) => listeners.get("click")({ isTrusted: trusted, target: { closest: () => target } });
const flush = () => { clock += 50; const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); };
assert.equal(contexts, 0, "Kein Audio beim Start");
sounds.notice();
assert.equal(contexts, 0, "Hintergrundmeldung startet kein Audio");
click(false); flush();
assert.equal(contexts, 0, "Synthetischer Klick bleibt stumm");
click(true, { matches: () => true }); flush();
assert.equal(contexts, 0, "Deaktivierter Button bleibt stumm");
click(); flush();
assert.equal(contexts, 1);
assert.equal(oscillators.length, 1, "Echter Klick spielt einen Ton");
assert.ok(Math.abs(peaks[0] - 0.02) < 1e-8, "Leiser Standardpegel");
click(); flush();
assert.equal(oscillators.length, 1, "Schnelle Klickfolge wird begrenzt");
clock += 200; click();
observed([{ target: { matches: () => true } }]); flush();
assert.equal(oscillators.length, 2, "Dialog ersetzt Klickton");
clock += 200; click(); sounds.notice(); flush();
assert.equal(oscillators.length, 4, "Bestaetigung ersetzt Klick durch Zweiklang");
clock += 1500; sounds.notice();
assert.equal(oscillators.length, 4, "Spaete Hintergrundmeldung bleibt stumm");
for (const mode of ["off", "zero", "quiet", "hidden"]) {
  settings.uiSounds = mode !== "off";
  settings.uiSoundVolume = mode === "zero" ? 0 : 20;
  quiet = mode === "quiet";
  document.hidden = mode === "hidden";
  clock += 200; click(); flush();
  assert.equal(oscillators.length, 4, mode + " bleibt stumm");
}
sounds.sync();
assert.ok(oscillators.every(voice => voice.stopped), "Stummschalten stoppt aktive Toene");
settings.uiSounds = true; settings.uiSoundVolume = 500; quiet = false; document.hidden = false;
clock += 200; click(); flush();
assert.equal(peaks.at(-1), 0.1, "Importierte Lautstaerke wird begrenzt");
settings.uiSoundVolume = NaN;
clock += 200; click(); flush();
assert.equal(oscillators.length, 5, "Ungueltige Lautstaerke bleibt stumm");
sounds.destroy();
assert.equal(listeners.size, 0, "Aufraeumen entfernt den Listener");
console.log("OK: UI-Sounds: Benutzeraktionen, Dialoge, Rate-Limit, Lautstaerke, Hintergrundruhe und Aufraeumen.");
