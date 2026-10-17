"use strict";
// Die Erkennungsseite der Sprachsuche ohne Mikrofon und ohne Vosk: ein
// nachgebauter Erkenner liefert Saetze, geprueft wird, was die Seite meldet.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(Boolean(b)); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d !== undefined ? "   -> " + d : ""}`); };
const ruhen = async () => { for (let i = 0; i < 10; i += 1) await new Promise((ok) => setImmediate(ok)); };

function buehne({ mikrofon = true, modellFehler = false } = {}) {
  const gemeldet = [];
  const zustand = { befehl: null, erkenner: null, spurenGestoppt: 0, zeitgeber: [] };
  class Erkenner {
    constructor() { this.horcher = {}; zustand.erkenner = this; }
    on(name, fn) { this.horcher[name] = fn; }
    acceptWaveform() {}
    remove() { this.entfernt = true; }
    sagen(text) { this.horcher.result?.({ result: { text } }); }
    teil(text) { this.horcher.partialresult?.({ result: { partial: text } }); }
  }
  class Modell {
    constructor() {
      this.horcher = {};
      this.worker = { addEventListener() {}, terminate() {} };
      this.KaldiRecognizer = Erkenner;
      setImmediate(() => (modellFehler ? this.horcher.error?.({ error: "kaputt" }) : this.horcher.load?.({ result: true })));
    }
    on(name, fn) { this.horcher[name] = fn; }
  }
  const knoten = () => ({ connect() {}, disconnect() {} });
  const fenster = {
    ElfixSprachsucheHost: {
      modellUrl: async () => "https://sprachmodell.elfix.invalid/de.tar.gz",
      mikrofon: async () => mikrofon,
      melden: (e) => gemeldet.push(e),
      onBefehl: (fn) => { zustand.befehl = fn; }
    },
    Vosk: { Model: Modell },
    AudioContext: class { constructor() { this.sampleRate = 48000; this.destination = {}; }
      createMediaStreamSource() { return knoten(); } createScriptProcessor() { return knoten(); } close() { return Promise.resolve(); } },
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { zustand.spurenGestoppt += 1; } }] }) } },
    console,
    setTimeout: (fn, ms) => { const t = { fn, ms }; zustand.zeitgeber.push(t); return t; },
    clearTimeout: (t) => { if (t) t.fn = null; }
  };
  fenster.window = fenster;
  fenster.globalThis = fenster;
  vm.createContext(fenster);
  for (const datei of ["shared/sprachsuche-text.js", "shared/sprachsuche-seite.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", datei), "utf8"), fenster);
  }
  const ablaufen = () => { const offen = zustand.zeitgeber.filter((t) => t.fn); zustand.zeitgeber = []; for (const t of offen) t.fn(); };
  return { gemeldet, zustand, ablaufen, typen: () => gemeldet.map((e) => e.typ + (e.zustand ? ":" + e.zustand : "")) };
}

(async () => {
  // --- Knopf: der naechste Satz ist die Suche ---
  const k = buehne();
  pruefe("Die Seite meldet sich bereit", k.gemeldet[0]?.typ === "bereit");
  k.zustand.befehl({ typ: "start", modus: "einmal" });
  await ruhen();
  pruefe("Nach dem Knopf hoert sie zu", k.typen().includes("zustand:hoert"), k.typen().join(","));
  k.zustand.erkenner.teil("such nach brea");
  pruefe("Teilergebnisse gehen an die Oberflaeche", k.gemeldet.some((e) => e.typ === "teil" && e.text === "such nach brea"));
  k.zustand.erkenner.sagen("such nach breaking bad");
  const anfrage = k.gemeldet.find((e) => e.typ === "anfrage");
  pruefe("Der Satz wird bereinigt zur Suche", anfrage?.text === "breaking bad" && anfrage.quelle === "knopf", JSON.stringify(anfrage));
  pruefe("Danach ist das Mikrofon zu", k.zustand.spurenGestoppt === 1 && k.typen().at(-1) === "zustand:aus", k.typen().join(","));

  // --- Knopf ohne Sprechen ---
  const s = buehne();
  s.zustand.befehl({ typ: "start", modus: "einmal" });
  await ruhen();
  s.ablaufen();
  pruefe("Wer nichts sagt, bekommt 'nichts' und das Mikrofon geht zu",
    s.typen().includes("nichts") && s.zustand.spurenGestoppt === 1, s.typen().join(","));

  // --- Hey Elfix ---
  const w = buehne();
  w.zustand.befehl({ typ: "start", modus: "weckwort" });
  await ruhen();
  pruefe("Im Weckwortbetrieb wartet sie", w.typen().at(-1) === "zustand:wartet", w.typen().join(","));
  w.zustand.erkenner.sagen("und dann hat er gesagt dass breaking bad toll ist");
  pruefe("Ein Satz ohne Weckwort sucht nichts", !w.gemeldet.some((e) => e.typ === "anfrage"));
  w.zustand.erkenner.teil("hey elf fix");
  pruefe("Das Weckwort wird schon im Teilergebnis gemeldet", w.gemeldet.some((e) => e.typ === "weckwort"));
  w.zustand.erkenner.sagen("hey elf fix avatar die sieben häfen");
  const direkt = w.gemeldet.find((e) => e.typ === "anfrage");
  pruefe("'Hey Elfix <Titel>' sucht sofort", direkt?.text === "avatar die sieben häfen" && direkt.quelle === "weckwort", JSON.stringify(direkt));
  pruefe("und hoert danach weiter auf das Weckwort", w.zustand.spurenGestoppt === 0 && w.typen().at(-1) === "zustand:wartet");
  w.zustand.erkenner.sagen("hey elfix");
  pruefe("Nur das Weckwort: sie hoert auf den naechsten Satz", w.typen().at(-1) === "zustand:hoert", w.typen().join(","));
  w.zustand.erkenner.sagen("zeig mir one piece");
  const danach = w.gemeldet.filter((e) => e.typ === "anfrage").at(-1);
  pruefe("Der naechste Satz ist die Suche", danach?.text === "one piece", JSON.stringify(danach));
  w.zustand.erkenner.sagen("one piece ist super");
  pruefe("Und danach zaehlt wieder nur das Weckwort", w.gemeldet.filter((e) => e.typ === "anfrage").length === 2);
  w.zustand.erkenner.sagen("hey elfix");
  w.ablaufen();
  pruefe("Kommt nach dem Weckwort nichts, wartet sie wieder", w.typen().at(-1) === "zustand:wartet" && w.zustand.spurenGestoppt === 0,
    w.typen().slice(-3).join(","));

  // --- Knopf waehrend Hey Elfix ---
  w.zustand.befehl({ typ: "start", modus: "einmal" });
  await ruhen();
  w.zustand.erkenner.sagen("dark");
  pruefe("Der Knopf bei laufendem Hey Elfix sucht den Satz", w.gemeldet.filter((e) => e.typ === "anfrage").at(-1)?.text === "dark");
  pruefe("und kehrt zum Weckwort zurueck, statt das Mikrofon zu schliessen",
    w.zustand.spurenGestoppt === 0 && w.typen().at(-1) === "zustand:wartet", w.typen().slice(-3).join(","));
  w.zustand.befehl({ typ: "stopp" });
  pruefe("Stopp schliesst das Mikrofon", w.zustand.spurenGestoppt === 1 && w.typen().at(-1) === "zustand:aus");

  // --- Fehler ---
  const m = buehne({ mikrofon: false });
  m.zustand.befehl({ typ: "start", modus: "einmal" });
  await ruhen();
  const ohne = m.gemeldet.find((e) => e.typ === "fehler");
  pruefe("Ohne Mikrofonfreigabe: Fehler, kein Modellfehler", ohne && ohne.modell === false, JSON.stringify(ohne));
  const f = buehne({ modellFehler: true });
  f.zustand.befehl({ typ: "start", modus: "weckwort" });
  await ruhen();
  const kaputt = f.gemeldet.find((e) => e.typ === "fehler");
  pruefe("Ein kaputtes Modell wird als Modellfehler gemeldet", kaputt?.modell === true, JSON.stringify(kaputt));
  pruefe("und der Zustand geht auf aus", f.typen().at(-1) === "zustand:aus");

  console.log(`${pruefungen.filter(Boolean).length}/${pruefungen.length} bestanden`);
  process.exit(pruefungen.every(Boolean) ? 0 : 1);
})().catch((fehler) => { console.error(fehler); process.exit(1); });
