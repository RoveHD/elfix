"use strict";
// Rechtsklick auf einen Anbieter in der Leiste, und das Plus daneben.
//
// Beides fuehrt an dieselbe Stelle: die Anbieterseite der Einstellungen. Der
// Rechtsklick bringt den angeklickten Anbieter mit und stellt sein Formular
// ausgefuellt hin, das Plus stellt ein leeres hin.
//
// Der Punkt, an dem so etwas schiefgeht, ist die Reihenfolge. openSettings()
// baut die Ansicht bereits auf - wer die Auswahl erst danach setzt, sieht sie
// nicht, sondern erst beim naechsten Aufbau. Genau das wird hier gemessen:
// nicht nur "welche Auswahl steht am Ende", sondern "stand sie schon, als
// gebaut wurde".
//
// Geprueft werden die echten Funktionen aus renderer.js, aus der Datei
// geschnitten und in einem Ersatz-DOM ausgefuehrt.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const lies = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8").replace(/\r/g, "");
const RENDERER = lies("src/renderer/renderer.js");
const HTML = lies("src/renderer/index.html");
const CSS = lies("src/renderer/styles.css");
const MAIN = lies("src/main.js");
const PRELOAD = lies("src/preload.js");

const pruefungen = [];
const pruefe = (name, bedingung, detail) => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

// Alles abarbeiten, was an Zusagen noch offen ist.
const ruhen = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((fertig) => setImmediate(fertig));
};

function abschnitt(quelle, anfang, ende = "}") {
  const zeilen = quelle.split("\n");
  const von = zeilen.findIndex((z) => z.startsWith(anfang));
  if (von < 0) throw new Error("nicht gefunden: " + anfang);
  let bis = von;
  while (bis < zeilen.length && zeilen[bis] !== ende) bis += 1;
  return zeilen.slice(von, bis + 1).join("\n");
}

// --- Ersatz-DOM --------------------------------------------------------------

function element(tag) {
  const horcher = new Map();
  return {
    tagName: tag, className: "", type: "", innerHTML: "", dataset: {},
    addEventListener(name, fn) {
      if (!horcher.has(name)) horcher.set(name, []);
      horcher.get(name).push(fn);
    },
    hat: (name) => horcher.has(name),
    getBoundingClientRect: () => ({ left: 120, bottom: 96 }),
    focus() { this.fokussiert = true; },
    async ausloesen(name, ereignis = {}) {
      const daten = { ...ereignis };
      daten.preventDefault = () => { daten.verhindert = true; };
      for (const fn of horcher.get(name) || []) await fn(daten);
      // Der Horcher schickt die Menuefrage nur ab und kehrt sofort zurueck -
      // ihn abzuwarten hiesse gar nichts. Also die Warteschlange leerlaufen
      // lassen, bis die Antwort verarbeitet ist.
      await ruhen();
      return daten;
    }
  };
}

const ANBIETER = [
  { id: "aniworld", name: "Aniworld", startUrl: "https://aniworld.to/" },
  { id: "sto", name: "S.to", startUrl: "https://s.to/" },
  { id: "yt", name: "Youtube", startUrl: "https://www.youtube.com/" }
];

function buehne(antwort) {
  const gerufen = { menue: [], settings: [], tabs: [], gebaut: [], toasts: [] };
  const providerNameFeld = element("input");

  const kontext = {
    providers: ANBIETER.map((eintrag) => ({ ...eintrag })),
    selectedProviderIndex: 99,
    activeProviderId: "yt",
    providerName: providerNameFeld,
    document: { createElement: element },
    escapeHtml: (wert) => String(wert),
    api: {
      providerContextMenu: async (name, punkt) => {
        gerufen.menue.push({ name, punkt });
        return antwort;
      }
    },
    // Die drei Schritte, auf deren Reihenfolge es ankommt. Jeder haelt fest,
    // welche Auswahl in dem Moment galt.
    openSettings: async (route = "settings") => {
      gerufen.settings.push(route);
      gerufen.gebaut.push(kontext.selectedProviderIndex);
    },
    activateTab: (name) => gerufen.tabs.push(name),
    renderSettings: () => gerufen.gebaut.push(kontext.selectedProviderIndex),
    showToast: (text) => gerufen.toasts.push(text),
    setTimeout: () => 0,
    clearTimeout: () => {},
    console, Math, Date, String, Number, Boolean, Array, Object, JSON, Set, Map, Promise
  };
  const sandkasten = new Proxy(kontext, {
    has: () => true,
    get: (ziel, name) => (name in ziel ? ziel[name] : (typeof name === "symbol" ? undefined : () => {})),
    set: (ziel, name, wert) => { ziel[name] = wert; return true; }
  });
  vm.createContext(sandkasten);
  for (const name of ["function providerCard(", "async function anbieterMenue(",
    "async function anbieterBearbeiten(", "async function anbieterHinzufuegen("]) {
    vm.runInContext(abschnitt(RENDERER, name), sandkasten);
  }
  return {
    gerufen, kontext, providerNameFeld,
    karte: (index) => vm.runInContext("providerCard", sandkasten)(kontext.providers[index], false),
    auswahl: () => kontext.selectedProviderIndex
  };
}

// --- Der Rechtsklick ---------------------------------------------------------

(async () => {
  const b = buehne("edit");
  const karte = b.karte(1);
  pruefe("Die Kachel horcht auf den Rechtsklick", karte.hat("contextmenu"));

  const ereignis = await karte.ausloesen("contextmenu");
  pruefe("Das Browsermenue wird unterdrueckt",
    ereignis.verhindert === true,
    "sonst stuenden zwei Menues uebereinander");
  pruefe("Gefragt wird mit dem Namen des angeklickten Anbieters",
    b.gerufen.menue[0]?.name === "S.to",
    b.gerufen.menue[0]?.name);
  pruefe("und mit der Stelle unter der Kachel",
    b.gerufen.menue[0]?.punkt?.x === 120 && b.gerufen.menue[0]?.punkt?.y === 100,
    "sonst klappt das Menue in der Ecke des Fensters auf");

  pruefe("\"Bearbeiten\" waehlt genau diesen Anbieter aus",
    b.auswahl() === 1,
    `Auswahl ${b.auswahl()} statt 1`);
  pruefe("Die Einstellungen gehen auf und zwar auf der Anbieterseite",
    b.gerufen.settings.length === 1 && b.gerufen.tabs.includes("providers"));
  pruefe("Die Auswahl stand schon beim ersten Aufbau",
    b.gerufen.gebaut.length > 0 && b.gerufen.gebaut.every((stand) => stand === 1),
    `Staende: ${JSON.stringify(b.gerufen.gebaut)} - eine 99 darin hiesse: zu spaet gesetzt`);

  // --- Neu aus demselben Menue ---
  const n = buehne("new");
  await (await n.karte(0)).ausloesen("contextmenu");
  pruefe("\"Neuer Anbieter\" stellt ein leeres Formular hin",
    n.auswahl() === -1,
    "-1 ist die Stellung, die auch \"+ Neu\" in den Einstellungen herstellt");
  pruefe("und nimmt die eigene Route mit",
    n.gerufen.settings[0] === "add-provider");
  pruefe("Der Name ist gleich dran", n.providerNameFeld.fokussiert === true);

  // --- Abbrechen ---
  const a = buehne("");
  await (await a.karte(2)).ausloesen("contextmenu");
  pruefe("Wer das Menue wegklickt, landet nirgends",
    a.gerufen.settings.length === 0 && a.gerufen.tabs.length === 0 && a.auswahl() === 99);

  // --- Ein Anbieter, den es nicht mehr gibt ---
  const g = buehne("edit");
  const karteWeg = g.karte(1);
  g.kontext.providers = g.kontext.providers.filter((eintrag) => eintrag.id !== "sto");
  await karteWeg.ausloesen("contextmenu");
  pruefe("Ein inzwischen geloeschter Anbieter oeffnet nichts, sondern sagt Bescheid",
    g.gerufen.settings.length === 0 && g.gerufen.toasts.length === 1,
    "sonst stuende die Auswahl auf -1 und man legte versehentlich einen neuen an");

  // --- Das Plus ---------------------------------------------------------------

  pruefe("Das Plus steht in der Leiste, nicht in der Schiene",
    /<div class="provider-rail" id="providerRail"><\/div>\s*<button[^>]*id="providerAddButton"/.test(HTML),
    "in der Schiene wuerde es mitscrollen und bei vielen Anbietern verschwinden");
  pruefe("Es ist verdrahtet",
    /#providerAddButton"\)\?\.addEventListener\("click", \(\) => \{ anbieterHinzufuegen\(\)/.test(RENDERER));
  pruefe("Die Leiste ist dafuer eine Reihe geworden",
    /\.provider-strip \{[^}]*display: flex;/.test(CSS)
    && /\.provider-rail \{[^}]*flex: 1 1 auto;/.test(CSS),
    "sonst saesse das Plus unter den Anbietern");
  pruefe("Das Plus schrumpft nicht mit",
    /\.provider-add \{[^}]*flex: 0 0 auto;/.test(CSS));
  pruefe("Eine ausgeblendete Leiste bleibt ausgeblendet",
    /\.app-shell\.hide-provider-strip \.provider-strip \{\s*display: none;/.test(CSS),
    "die Regel ist staerker als das neue display: flex");

  // --- Das Menue selbst -------------------------------------------------------

  const handler = MAIN.slice(MAIN.indexOf('ipcMain.handle("provider:context-menu"'));
  pruefe("Das Menue baut der Hauptprozess",
    MAIN.includes('ipcMain.handle("provider:context-menu"'),
    "ein Kaestchen aus HTML verschwaende hinter der Anbieterseite");
  pruefe("Es bietet Bearbeiten und Neu an",
    /label: "Bearbeiten", click: \(\) => \{ gewaehlt = "edit"; \}/.test(handler.slice(0, 1200))
    && /label: "Neuer Anbieter", click: \(\) => \{ gewaehlt = "new"; \}/.test(handler.slice(0, 1200)));
  pruefe("Der Name steht als Ueberschrift darueber, unanklickbar",
    /\{ label: titel \|\| "Anbieter", enabled: false \}/.test(handler.slice(0, 1000)));
  pruefe("Die Bruecke steht im preload",
    /providerContextMenu: \(name, punkt\) => ipcRenderer\.invoke\("provider:context-menu", name, punkt\)/.test(PRELOAD));

  const fehler = pruefungen.filter((ok) => !ok).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  process.exit(fehler ? 1 : 0);
})();
