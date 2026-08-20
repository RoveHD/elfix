"use strict";
// Der Zaehler nach dem Ende einer Folge - und der Knopf, der bleibt.
//
// Abgeschaltet wird der Automatismus, nicht der Weg zur naechsten Folge. Wer
// selbst entscheiden will, wann es weitergeht, will darum nicht suchen muessen,
// wo es weitergeht. Genau diese Trennung wird hier gemessen: dasselbe Skript,
// einmal mit Zaehler und einmal ohne, und in beiden Faellen steht der Knopf da.
//
// Geprueft wird die Einblendung, wie sie wirklich in die Seite geht - aus
// main.js gebaut und in einem Ersatz-DOM ausgefuehrt. Ein Test, der nur den
// Quelltext liest, koennte nicht sagen, ob nach fuenf Sekunden tatsaechlich
// nichts passiert.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..");
const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").replace(/\r/g, "");
const RENDERER = fs.readFileSync(path.join(WURZEL, "src/renderer/renderer.js"), "utf8").replace(/\r/g, "");
const HTML = fs.readFileSync(path.join(WURZEL, "src/renderer/index.html"), "utf8").replace(/\r/g, "");

const pruefungen = [];
const pruefe = (name, bedingung, detail) => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

function abschnitt(quelle, anfang, ende = "}") {
  const zeilen = quelle.split("\n");
  const von = zeilen.findIndex((z) => z.startsWith(anfang));
  if (von < 0) throw new Error("nicht gefunden: " + anfang);
  let bis = von;
  while (bis < zeilen.length && zeilen[bis] !== ende) bis += 1;
  return zeilen.slice(von, bis + 1).join("\n");
}

// --- Das Skript, wie installNextEpisodePrompt es baut ------------------------
// Gebaut wird es von der echten Funktion; ausgefuehrt wird es hier statt in
// einer fremden Seite. So steht wirklich das zur Pruefung, was ausgeliefert
// wird - und nicht eine Nachbildung davon.

function skriptBauen(url, optionen) {
  let gebaut = "";
  const umgebung = {
    isLiveView: () => true,
    executeJavaScriptInMediaFrames: (_view, script) => {
      gebaut = script;
      return { then: () => ({ catch: () => {} }) };
    },
    console: { log() {} },
    Number, String, JSON, Date
  };
  vm.createContext(umgebung);
  vm.runInContext(abschnitt(MAIN, "function installNextEpisodePrompt("), umgebung);
  vm.runInContext("installNextEpisodePrompt", umgebung)({}, url, optionen);
  return gebaut;
}

// --- Ersatz-DOM --------------------------------------------------------------

function seite() {
  const uhr = { jetzt: 1000000 };
  const takte = new Map();
  const wartende = new Map();
  let naechsteNummer = 1;
  const meldungen = [];

  function element(tag = "div") {
    const knoten = {
      tagName: String(tag).toUpperCase(),
      id: "", textContent: "", type: "", disabled: false,
      style: {}, dataset: {}, children: [], parentElement: null,
      horcher: {},
      addEventListener(name, fn) { (this.horcher[name] = this.horcher[name] || []).push(fn); },
      removeEventListener() {},
      append(...kinder) { kinder.forEach((kind) => { kind.parentElement = this; this.children.push(kind); }); },
      appendChild(kind) { kind.parentElement = this; this.children.push(kind); return kind; },
      remove() {
        if (this.parentElement) {
          this.parentElement.children = this.parentElement.children.filter((k) => k !== this);
        }
        this.parentElement = null;
      },
      getBoundingClientRect: () => ({ width: 0, height: 0 }),
      klicken(name = "click") {
        for (const fn of this.horcher[name] || []) fn({ preventDefault() {}, stopPropagation() {} });
      }
    };
    return knoten;
  }

  const video = element("video");
  video.getBoundingClientRect = () => ({ width: 800, height: 450 });
  const wurzel = element("html");
  const nachId = new Map();

  const dokument = {
    documentElement: wurzel,
    fullscreenElement: null,
    getElementById: (id) => nachId.get(id) || null,
    createElement: (tag) => element(tag),
    querySelectorAll: (auswahl) => (auswahl === "video" ? [video] : []),
    addEventListener() {},
    removeEventListener() {}
  };

  const fenster = {};
  fenster.top = fenster;
  fenster.self = fenster;

  const kontext = {
    document: dokument,
    window: fenster,
    location: { hostname: "aniworld.to", href: "https://aniworld.to/folge-3" },
    console: { log: (text) => meldungen.push(String(text)) },
    Date: { now: () => uhr.jetzt },
    Math, Object, Array, String, Number, Boolean, JSON,
    setInterval: (fn) => { const n = naechsteNummer++; takte.set(n, fn); return n; },
    clearInterval: (n) => { takte.delete(n); },
    setTimeout: (fn) => { const n = naechsteNummer++; wartende.set(n, fn); return n; },
    clearTimeout: (n) => { wartende.delete(n); },
    requestAnimationFrame: (fn) => fn()
  };
  vm.createContext(kontext);

  return {
    meldungen, uhr,
    // Die Karte haengt an ihrer Kennung - so findet der zweite Aufruf sie
    // wieder, genau wie im echten Dokument.
    merken: () => {
      for (const kind of wurzel.children) if (kind.id) nachId.set(kind.id, kind);
    },
    karte: () => nachId.get("__elfixNextEpisode") || wurzel.children.find((k) => k.id === "__elfixNextEpisode"),
    laufen(script) {
      const ergebnis = vm.runInContext(script, kontext);
      this.merken();
      return ergebnis;
    },
    // Die Uhr weiterdrehen und alle laufenden Takte ausloesen.
    vorspulen(sekunden) {
      uhr.jetzt += sekunden * 1000;
      for (const fn of [...takte.values()]) fn();
    },
    takteLaufen: () => takte.size
  };
}

const ZIEL = "https://aniworld.to/folge-4";
const knoepfe = (karte) => karte.children.map((kind) => kind.textContent);

// --- Mit Zaehler -------------------------------------------------------------

const mit = seite();
const mitSkript = skriptBauen(ZIEL, { countdown: 5 });
pruefe("Mit Zaehler meldet sich die Einblendung als Countdown",
  mit.laufen(mitSkript) === "countdown@aniworld.to");
pruefe("Der Knopf zaehlt herunter",
  knoepfe(mit.karte())[0] === "Nächste Folge in 5 …",
  knoepfe(mit.karte())[0]);
pruefe("und daneben steht ein Abbrechen",
  knoepfe(mit.karte())[1] === "Abbrechen" && mit.karte().children[1].style.display === "");

mit.vorspulen(3);
pruefe("Nach drei Sekunden steht noch zwei",
  knoepfe(mit.karte())[0] === "Nächste Folge in 2 …",
  knoepfe(mit.karte())[0]);
pruefe("und es ist noch nichts geschaltet", mit.meldungen.length === 0);

mit.vorspulen(2);
pruefe("Nach fuenf Sekunden schaltet es von selbst weiter",
  mit.meldungen.some((zeile) => zeile === "__elfix:next-episode:" + ZIEL),
  mit.meldungen.join(" | "));
pruefe("und der Zaehler steht still", mit.takteLaufen() === 0);

// Abbrechen haelt den Zaehler an, laesst den Knopf aber stehen.
const halt = seite();
halt.laufen(skriptBauen(ZIEL, { countdown: 5 }));
halt.karte().children[1].klicken();
pruefe("Abbrechen stoppt den Zaehler und laesst den Knopf da",
  knoepfe(halt.karte())[0] === "Nächste Folge  ›" && halt.takteLaufen() === 0);
halt.vorspulen(30);
pruefe("Danach schaltet nichts mehr von selbst", halt.meldungen.length === 0);

// --- Ohne Zaehler ------------------------------------------------------------

const ohne = seite();
const ohneSkript = skriptBauen(ZIEL, { countdown: 0 });
pruefe("Ohne Zaehler meldet sich die Einblendung als Knopf",
  ohne.laufen(ohneSkript) === "knopf@aniworld.to");
pruefe("Der Knopf steht trotzdem da",
  knoepfe(ohne.karte())[0] === "Nächste Folge  ›",
  knoepfe(ohne.karte())[0]);
pruefe("ohne Abbrechen daneben",
  ohne.karte().children[1].style.display === "none",
  "es gibt nichts abzubrechen");
pruefe("Es laeuft kein Zaehler", ohne.takteLaufen() === 0);

ohne.vorspulen(60);
pruefe("Auch nach einer Minute schaltet nichts weiter",
  ohne.meldungen.length === 0,
  "genau das ist der Unterschied");

ohne.karte().children[0].klicken();
pruefe("Ein Klick auf den Knopf schaltet weiter",
  ohne.meldungen.some((zeile) => zeile === "__elfix:next-episode:" + ZIEL),
  "abgeschaltet ist der Automatismus, nicht der Weg");
pruefe("und der Knopf sagt, dass es losgeht",
  knoepfe(ohne.karte())[0] === "Wird geladen …");

// --- "Danach aufhoeren" ------------------------------------------------------
// Der Knopf, der den Zaehler aufhaelt, bevor er anfaengt. Er sitzt in derselben
// Einblendung, weil dort die Entscheidung faellt: der Weg zur naechsten Folge
// und der Verzicht darauf gehoeren nebeneinander.

const dritter = (karte) => karte.children[2];

const vor = seite();
vor.laufen(skriptBauen(ZIEL, { schluss: true }));
pruefe("Vor dem Ende steht der Knopf schon da",
  dritter(vor.karte()).textContent === "Danach aufhören"
  && dritter(vor.karte()).style.display === "",
  "dort ist die Ansage noch eine Ansage");

dritter(vor.karte()).klicken();
pruefe("Ein Klick meldet die Ansage nach aussen",
  vor.meldungen.some((zeile) => zeile === "__elfix:stop-after-episode:1"),
  vor.meldungen.join(" | "));
pruefe("und der Knopf zeigt, dass es gilt",
  dritter(vor.karte()).textContent === "Danach aufhören ✓");

// Jetzt laeuft die Folge aus: ELFIX spielt neu ein, diesmal mit Zaehler - der
// darf aber nicht anspringen.
pruefe("Am Ende faengt trotzdem kein Zaehler an",
  vor.laufen(skriptBauen(ZIEL, { countdown: 5, schluss: true, schlussScharf: true })) === "knopf@aniworld.to"
  && vor.takteLaufen() === 0);
vor.vorspulen(30);
pruefe("und es schaltet nichts weiter",
  !vor.meldungen.some((zeile) => zeile.startsWith("__elfix:next-episode")),
  "genau darum ging es");
dritter(vor.karte()).klicken();
pruefe("Der Knopf zur naechsten Folge geht weiter",
  vor.karte().children[0].textContent !== "Wird geladen …");
vor.karte().children[0].klicken();
pruefe("Wer doch weiter will, kommt mit einem Klick weiter",
  vor.meldungen.some((zeile) => zeile === "__elfix:next-episode:" + ZIEL),
  "aufgehoben ist der Automatismus, nicht der Weg");

// Waehrend des Zaehlers scharf schalten - und es sich anders ueberlegen.
const zurueck = seite();
zurueck.laufen(skriptBauen(ZIEL, { countdown: 5, schluss: true }));
pruefe("Der Zaehler laeuft zunaechst", zurueck.takteLaufen() === 1);
dritter(zurueck.karte()).klicken();
pruefe("Scharfschalten haelt ihn an",
  zurueck.takteLaufen() === 0
  && zurueck.karte().children[0].textContent === "Nächste Folge  ›");
dritter(zurueck.karte()).klicken();
pruefe("Zuruecknehmen nimmt ihn wieder auf",
  zurueck.takteLaufen() === 1
  && zurueck.karte().children[0].textContent === "Nächste Folge in 5 …",
  "sonst waere die Meldung \"es geht wieder von selbst weiter\" nicht wahr");
pruefe("und die Ruecknahme geht auch nach aussen",
  zurueck.meldungen.some((zeile) => zeile === "__elfix:stop-after-episode:0"));
zurueck.vorspulen(5);
pruefe("Dann schaltet es doch von selbst weiter",
  zurueck.meldungen.some((zeile) => zeile === "__elfix:next-episode:" + ZIEL));

// Ohne Automatik gibt es nichts aufzuhalten.
const sinnlos = seite();
sinnlos.laufen(skriptBauen(ZIEL, { countdown: 0, schluss: false }));
pruefe("Ist der Zaehler ohnehin abgeschaltet, faellt der Knopf weg",
  dritter(sinnlos.karte()).style.display === "none",
  "ein Knopf gegen etwas, das nicht passiert, waere Zierde");

// Abbrechen und "Danach aufhoeren" duerfen sich nicht ins Gehege kommen.
const beides = seite();
beides.laufen(skriptBauen(ZIEL, { countdown: 5, schluss: true }));
beides.karte().children[1].klicken();
dritter(beides.karte()).klicken();
dritter(beides.karte()).klicken();
pruefe("Nach Abbrechen bleibt der Zaehler auch dann aus",
  beides.takteLaufen() === 0,
  "Abbrechen gilt fuer diese Folge, daran aendert der andere Knopf nichts");

// --- Die Einstellung ---------------------------------------------------------

const umgebung = new Proxy({
  console: { log() {} }, crypto: require("crypto"),
  Boolean, String, Number, Array, Object, JSON, Math, Date
}, {
  has: () => true,
  get: (ziel, name) => (name in ziel ? ziel[name] : (typeof name === "symbol" ? undefined : () => [])),
  set: (ziel, name, wert) => { ziel[name] = wert; return true; }
});
vm.createContext(umgebung);
vm.runInContext(MAIN.match(/^const SETTINGS_SCHEMA_VERSION = \d+;$/m)[0], umgebung);
for (const name of ["function sanitizeChoice(", "function defaultSettings(", "function normalizeSettings("]) {
  vm.runInContext(abschnitt(MAIN, name), umgebung);
}
const durch = (roh) => vm.runInContext("normalizeSettings", umgebung)(roh).playback.autoplayNextEpisode;

pruefe("Von Haus aus laeuft der Zaehler", durch({}) === true,
  "es war bisher immer so - ein Update soll nichts abschalten");
pruefe("Nur ein ausdrueckliches Nein schaltet ihn ab",
  durch({ playback: { autoplayNextEpisode: false } }) === false);
pruefe("Ein ausdrueckliches Ja bleibt an",
  durch({ playback: { autoplayNextEpisode: true } }) === true);
pruefe("Die Vorgabe kennt ihn auch",
  vm.runInContext("defaultSettings()", umgebung).playback.autoplayNextEpisode === true);

// Die Entscheidung selbst, ausgefuehrt statt gelesen: zwei Wege fuehren zur
// Null, und sie meinen Verschiedenes.
function zaehlerBauen(einstellungAn, gemerkteAdresse) {
  const umgebung = {
    settings: { playback: { autoplayNextEpisode: einstellungAn } },
    stopNachFolge: new Map(gemerkteAdresse ? [["p1", gemerkteAdresse]] : []),
    NEXT_EPISODE_COUNTDOWN_SECONDS: 5,
    Number, String, Boolean
  };
  vm.createContext(umgebung);
  vm.runInContext(abschnitt(MAIN, "function autoplayZaehler("), umgebung);
  return (url) => vm.runInContext("autoplayZaehler", umgebung)({ id: "p1" }, url);
}

const HIER = "https://aniworld.to/folge-3";
pruefe("Steht die Einstellung an und ist nichts gemerkt, laeuft der Zaehler",
  zaehlerBauen(true, "")(HIER) === 5);
pruefe("Die Einstellung aus heisst: kein Zaehler",
  zaehlerBauen(false, "")(HIER) === 0);
pruefe("\"Danach aufhoeren\" fuer diese Folge heisst dasselbe",
  zaehlerBauen(true, HIER)(HIER) === 0);
pruefe("Fuer eine andere Folge gemerkt aendert hier nichts",
  zaehlerBauen(true, "https://aniworld.to/folge-9")(HIER) === 5,
  "die Ansage galt einer bestimmten Folge, nicht dem Anbieter");
pruefe("Das Kaestchen steht in den Einstellungen",
  /id="autoplayNextEpisode" type="checkbox"/.test(HTML));
pruefe("Es sagt, dass der Knopf bleibt",
  /Nächste Folge“ steht trotzdem da/.test(HTML),
  "sonst liest es sich, als verloere man den Weg zur naechsten Folge");
pruefe("Es ist verdrahtet",
  /autoplayNextEpisode\?\.addEventListener\("change", saveSettings\);/.test(RENDERER)
  && /autoplayNextEpisode\.checked = settings\.playback\?\.autoplayNextEpisode !== false/.test(RENDERER));
pruefe("Fehlt das Kaestchen, wird nichts abgeschaltet",
  /autoplayNextEpisode: autoplayNextEpisode \? autoplayNextEpisode\.checked : settings\.playback\?\.autoplayNextEpisode !== false/.test(RENDERER),
  "Boolean(undefined) waere false - und haette es beim Speichern stillschweigend ausgeschaltet");
pruefe("Die Suche in den Einstellungen findet sie",
  /\["playback", "Nächste Folge von selbst starten"/.test(RENDERER));
// Der Rueckkanal und die Einmaligkeit - beides steht in main.js.
pruefe("Die Ansage wird entgegengenommen",
  /\^__elfix:stop-after-episode:\(\[01\]\)\$/.test(MAIN)
  && /stopNachFolge\.set\(provider\.id, adresse\)/.test(MAIN)
  && /stopNachFolge\.delete\(provider\.id\)/.test(MAIN));
pruefe("Gemerkt wird die Adresse der Folge, nicht bloss ein Ja",
  /const adresse = view\.webContents\.getURL\(\);[\s\S]{0,40}if \(schluss\[1\] === "1"\) stopNachFolge\.set\(provider\.id, adresse\);/.test(MAIN),
  "sonst gaelte sie auch fuer eine ganz andere Folge desselben Anbieters");
pruefe("Beim Folgenwechsel faellt der Merker",
  /nextEpisodeAutostartState\.delete\(provider\.id\);[\s\S]{0,200}stopNachFolge\.delete\(provider\.id\);/.test(MAIN),
  "das macht die Ansage einmalig - der Wechsel loest did-navigate aus");
pruefe("Am Ende wird der scharfe Zustand mitgegeben",
  /schlussScharf: stopNachFolge\.get\(provider\.id\) === url/.test(MAIN),
  "sonst vergaesse ein erneutes Einspielen ihn");

pruefe("Zuruecksetzen stellt sie auf an",
  /youtubeInMediathek: false,\s*\n\s*autoplayNextEpisode: true/.test(RENDERER));

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
