"use strict";

/*
 * Der HLS-Zeitanker ist ein Ablauf, kein Textmerkmal: hls.js darf erst
 * Fragment null laden, ein vorzeitiger Sprung muss warten, und nur der
 * INIT_PTS des gerade laufenden Hauptstreams darf ihn freigeben.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const QUELLE = fs.readFileSync(path.join(__dirname, "../src/renderer/spieler.js"), "utf8");
const pruefungen = [];
function pruefe(name, bedingung, detail = "") {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? ` -> ${detail}` : ""}`);
}
const schlaf = (ms) => new Promise((fertig) => setTimeout(fertig, ms));

function funktion(name) {
  const funktionsAnfang = QUELLE.indexOf(`function ${name}(`);
  if (funktionsAnfang < 0) throw new Error(`Funktion fehlt: ${name}`);
  const anfang = QUELLE.slice(Math.max(0, funktionsAnfang - 6), funktionsAnfang) === "async "
    ? funktionsAnfang - 6 : funktionsAnfang;
  const klammer = QUELLE.indexOf("{", anfang);
  let tiefe = 0;
  let text = null;
  let quote = "";
  let kommentar = "";
  for (let i = klammer; i < QUELLE.length; i += 1) {
    const zeichen = QUELLE[i];
    const naechstes = QUELLE[i + 1];
    if (kommentar === "zeile") {
      if (zeichen === "\n") kommentar = "";
      continue;
    }
    if (kommentar === "block") {
      if (zeichen === "*" && naechstes === "/") { kommentar = ""; i += 1; }
      continue;
    }
    if (quote) {
      if (zeichen === "\\") { i += 1; continue; }
      if (zeichen === quote) quote = "";
      continue;
    }
    if (zeichen === "/" && naechstes === "/") { kommentar = "zeile"; i += 1; continue; }
    if (zeichen === "/" && naechstes === "*") { kommentar = "block"; i += 1; continue; }
    if (zeichen === '"' || zeichen === "'" || zeichen === "`") { quote = zeichen; continue; }
    if (zeichen === "{") tiefe += 1;
    if (zeichen === "}") {
      tiefe -= 1;
      if (tiefe === 0) { text = QUELLE.slice(anfang, i + 1); break; }
    }
  }
  if (!text) throw new Error(`Funktionsende fehlt: ${name}`);
  return text;
}

class ProbeHls {
  static instanzen = [];
  static Events = {
    INIT_PTS_FOUND: "init",
    MANIFEST_PARSED: "manifest",
    SUBTITLE_TRACKS_UPDATED: "subtitle",
    LEVEL_SWITCHED: "level",
    ERROR: "error"
  };
  static ErrorTypes = { NETWORK_ERROR: "network", MEDIA_ERROR: "media" };
  static isSupported() { return true; }

  constructor(config) {
    this.config = config;
    this.horcher = new Map();
    this.startstellen = [];
    this.subtitleTracks = [];
    this.gestoppt = false;
    ProbeHls.instanzen.push(this);
  }
  on(name, fn) { this.horcher.set(name, fn); }
  senden(name, daten = {}) { this.horcher.get(name)?.(name, daten); }
  startLoad(stelle) { this.startstellen.push(stelle); }
  stopLoad() { this.gestoppt = true; }
  recoverMediaError() { this.repariert = true; }
  loadSource(adresse) { this.adresse = adresse; }
  attachMedia(bild) { this.medium = bild; }
}

function umgebung() {
  ProbeHls.instanzen.length = 0;
  const spruenge = [];
  const fehler = [];
  const zeichnungen = [];
  let stelle = 0;
  const bild = {
    canPlayType: () => "", seeking: false, paused: true, duration: 1000,
    pause() { this.paused = true; },
    play() { this.paused = false; this.starts = (this.starts || 0) + 1; return Promise.resolve(); }
  };
  Object.defineProperty(bild, "currentTime", {
    get: () => stelle,
    set: (wert) => { stelle = wert; spruenge.push(wert); }
  });
  const c = vm.createContext({
    Promise, Date, setTimeout, clearTimeout,
    Hls: ProbeHls, bild, hls: null, hlsAnker: null,
    HLS_ANKER_FRIST_MS: 40, bildZeitMessbar: false, dargestelltesBild: null,
    startAuftrag: 1, startAusstehend: false, startNotbremse: 0,
    vorigeStelle: 0, ausRundeBis: 0, tempo: 1, inRunde: false,
    SEEK_TOLERANZ_S: 0.001,
    gerettet: { netz: false, medium: false },
    stufenWahl: { value: "-1" },
    stufenSetzen() {}, stufenStatus() {}, untertitelSetzen() {}, standMelden() {},
    spielenZeichnen: () => zeichnungen.push("zeichnen"),
    seekAbwarten: () => Promise.resolve(true),
    bereitFuerStart: () => Promise.resolve(true), pauseAnfordern() {},
    aufgeben: (text, grund) => fehler.push({ text, grund })
  });
  const namen = ["hlsAnkerAbwarten", "stelleSetzen", "genauAbbrechen",
    "frameSuchStelle", "dargestelltesBildAbwarten", "genauSetzen",
    "startVerabredet", "hlsAnkerZuruecksetzen", "hlsAnkerErzeugen", "hlsStarten"];
  vm.runInContext(namen.map(funktion).join("\n"), c);
  return { c, bild, spruenge, fehler, zeichnungen };
}

(async () => {
  {
    const { c, spruenge } = umgebung();
    c.hlsStarten("eins.m3u8");
    const eins = ProbeHls.instanzen[0];
    pruefe("HLS laedt nicht vor der bewussten Startfreigabe",
      eins.config.autoStartLoad === false && eins.startstellen.length === 0);
    pruefe("Bandbreitenprobe kann Fragment null nicht still ueberspringen",
      eins.config.startPosition === 0 && eins.config.testBandwidth === false);

    eins.senden(ProbeHls.Events.MANIFEST_PARSED, { levels: [{}] });
    pruefe("Nach dem Manifest beginnt das Laden ausdruecklich bei Fragment null",
      eins.startstellen.length === 1 && eins.startstellen[0] === 0,
      JSON.stringify(eins.startstellen));

    const genau = c.genauSetzen(459.333866, true, 1);
    await Promise.resolve();
    pruefe("Ein genauer Sprung wartet vor INIT_PTS_FOUND", spruenge.length === 0);
    eins.senden(ProbeHls.Events.INIT_PTS_FOUND, { id: "audio" });
    await Promise.resolve();
    pruefe("Ein Ton-Zeitstempel gibt den Bildsprung nicht frei", spruenge.length === 0);
    eins.senden(ProbeHls.Events.INIT_PTS_FOUND, { id: "main" });
    pruefe("Der erste Hauptstream-Zeitstempel gibt den Sprung frei",
      await genau && spruenge[0] === 459.333866);
  }

  {
    const { c, spruenge } = umgebung();
    c.hlsStarten("alt.m3u8");
    const alt = ProbeHls.instanzen[0];
    const alterSprung = c.genauSetzen(100, false, 1);
    c.hlsStarten("neu.m3u8");
    const neu = ProbeHls.instanzen[1];
    pruefe("Ein Quellenwechsel bricht den wartenden alten Sprung ab",
      await alterSprung === false && spruenge.length === 0);
    const neuerSprung = c.genauSetzen(200, false, 1);
    alt.senden(ProbeHls.Events.INIT_PTS_FOUND, { id: "main" });
    await Promise.resolve();
    pruefe("Ein spaeter Zeitstempel der alten Quelle bleibt wirkungslos", spruenge.length === 0);
    neu.senden(ProbeHls.Events.INIT_PTS_FOUND, { id: "main" });
    pruefe("Die neue Quelle muss sich selbst neu verankern",
      await neuerSprung && spruenge[0] === 200);
  }

  {
    const { c, spruenge, fehler, zeichnungen } = umgebung();
    c.hlsStarten("langsam.m3u8");
    const langsam = ProbeHls.instanzen[0];
    c.startAusstehend = true;
    const sprung = c.genauSetzen(300, false, 1);
    await schlaf(60);
    pruefe("Ein fehlender Zeitanker endet mit einem sichtbaren Fehler",
      await sprung === false && fehler[0]?.grund === "hls-zeitanker");
    pruefe("Nach der Frist wird kein spaeteres Fragment geladen",
      langsam.gestoppt && spruenge.length === 0);
    pruefe("Ein abgelaufener Anker loest den aktuellen Wartezustand",
      c.startAusstehend === false && zeichnungen.length === 1);
  }

  {
    const { c, spruenge, fehler } = umgebung();
    c.hlsStarten("kaputt.m3u8");
    const kaputt = ProbeHls.instanzen[0];
    const sprung = c.genauSetzen(310, false, 1);
    kaputt.senden(ProbeHls.Events.ERROR, {
      fatal: true, type: "mux", details: "unlesbar"
    });
    pruefe("Ein endgueltiger HLS-Fehler bricht wartende Spruenge sofort ab",
      await sprung === false && spruenge.length === 0 && fehler[0]?.grund === "hls-unlesbar");
  }

  {
    const { c, bild } = umgebung();
    c.hlsStarten("spaet-kaputt.m3u8");
    const kaputt = ProbeHls.instanzen[0];
    kaputt.senden(ProbeHls.Events.INIT_PTS_FOUND, { id: "main" });
    const start = c.startVerabredet(400, 35, true, Date.now() + 35);
    await Promise.resolve();
    kaputt.senden(ProbeHls.Events.ERROR, {
      fatal: true, type: "mux", details: "spaet"
    });
    await start;
    pruefe("Ein fataler Fehler nach dem Anker widerruft den geplanten Start",
      bild.starts === undefined && bild.paused && c.startAusstehend === false);
    pruefe("Nach einem fatalen Fehler bleibt auch ein neuer HLS-Sprung gesperrt",
      await c.genauSetzen(450, false, c.startAuftrag) === false);
  }

  {
    const { c, spruenge } = umgebung();
    const sprung = c.genauSetzen(88.25, false, 1);
    pruefe("Eine direkte MP4-Stelle wird weiterhin synchron gesetzt", spruenge[0] === 88.25);
    pruefe("Der MP4-Sprung schliesst normal ab", await sprung === true);
  }

  const ok = pruefungen.every(Boolean);
  console.log(`\n${pruefungen.filter(Boolean).length}/${pruefungen.length} HLS-Anker-Pruefungen bestanden.`);
  process.exit(ok ? 0 : 1);
})().catch((fehler) => {
  console.error(fehler);
  process.exit(1);
});
