"use strict";
// Was eine Karte zeigt, wenn ihr Bild nicht laedt.
//
// Gemeldet war: auf der Startseite bleiben bei vielen Eintraegen dunkelblaue
// Flaechen stehen. Zwei verschiedene Ursachen fuehren dorthin, und diese Datei
// prueft die zweite - die erste (AniWorld haelt sein eigenes Cover per CSS
// verborgen, solange ein data-src daran haengt) steht in bildnachreichungtest.
//
// Hier geht es um die Karten von ELFIX selbst. Dort gab es drei Luecken:
//
//   1. bildEbeneSetzen() hatte keinen onerror. Ein Bild, das nicht kam, hinterliess
//      eine leere Karte - nicht zu unterscheiden von einer, fuer die nie ein
//      Bild vorgesehen war.
//   2. Schlug die Reparatur fehl, wurde die Adresse geloescht. Damit machte ein
//      Aussetzer von zehn Sekunden das Bild dauerhaft weg: ohne Adresse gibt es
//      auch keinen zweiten Versuch.
//   3. Und ein onerror, der dieselbe Adresse wieder in den src setzt, laeuft im
//      Kreis.
//
// Geprueft wird der echte Quelltext aus renderer.js in einem Ersatz-DOM - wie
// in kacheltest.js, aus demselben Grund: ein Nachbau prueft den Nachbau.

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const WURZEL = path.join(__dirname, "..");
const lies = (datei) => fs.readFileSync(path.join(WURZEL, datei), "utf8").split("\r\n").join("\n");

const pruefungen = [];
const pruefe = (name, bedingung, detail = "") => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

// Eine Funktion endet an der ersten Zeile, die nur eine schliessende Klammer
// traegt - so ist der Quelltext durchgehend formatiert.
function abschnitt(quelle, anfang, ende = "}") {
  const zeilen = quelle.split("\n");
  const von = zeilen.findIndex((z) => z.startsWith(anfang));
  if (von < 0) throw new Error("nicht gefunden: " + anfang);
  let bis = von;
  while (bis < zeilen.length && zeilen[bis] !== ende) bis += 1;
  return zeilen.slice(von, bis + 1).join("\n");
}

// --- Ein Ersatz-DOM ---------------------------------------------------------

function element(tag) {
  const knoten = {
    tagName: tag.toUpperCase(),
    alt: "",
    draggable: true,
    decoding: "",
    kinder: [],
    attribute: {},
    style: {
      werte: {},
      setProperty(name, wert) { this.werte[name] = wert; }
    },
    classList: {
      menge: new Set(),
      add(...c) { c.forEach((x) => this.menge.add(x)); },
      remove(...c) { c.forEach((x) => this.menge.delete(x)); },
      toggle(c, an) {
        const soll = an === undefined ? !this.menge.has(c) : Boolean(an);
        if (soll) this.menge.add(c); else this.menge.delete(c);
      },
      contains(c) { return this.menge.has(c); }
    },
    append(...k) { knoten.kinder.push(...k); },
    prepend(...k) { knoten.kinder.unshift(...k); },
    remove() {
      if (!knoten.elternteil) return;
      knoten.elternteil.kinder = knoten.elternteil.kinder.filter((k) => k !== knoten);
      knoten.elternteil = null;
    },
    getAttribute(name) { return name in knoten.attribute ? knoten.attribute[name] : null; },
    setAttribute(name, wert) { knoten.attribute[name] = String(wert); },
    // Das Ersatz-DOM kennt genau die eine Abfrage, die bildEbeneSetzen stellt.
    querySelector(auswahl) {
      if (auswahl === ":scope > .karten-bild") {
        return knoten.kinder.find((k) => k.classList.contains("karten-bild")) || null;
      }
      if (auswahl === "img") return knoten.kinder.find((k) => k.tagName === "IMG") || null;
      return null;
    }
  };
  Object.defineProperty(knoten, "className", {
    get() { return [...knoten.classList.menge].join(" "); },
    set(wert) { knoten.classList.menge = new Set(String(wert).split(" ").filter(Boolean)); }
  });
  Object.defineProperty(knoten, "src", {
    get() { return knoten.attribute.src || ""; },
    set(wert) { knoten.attribute.src = String(wert); knoten.gesetzt = (knoten.gesetzt || 0) + 1; }
  });
  return knoten;
}

function karteBauen() {
  const karte = element("div");
  const alt = karte.append.bind(karte);
  karte.append = (...k) => { k.forEach((kind) => { kind.elternteil = karte; }); alt(...k); };
  const altVorn = karte.prepend;
  karte.prepend = (...k) => { k.forEach((kind) => { kind.elternteil = karte; }); altVorn.call(karte, ...k); };
  return karte;
}

// --- Den echten Quelltext laden ---------------------------------------------

const renderer = lies("src/renderer/renderer.js");
const online = [];
const kontext = vm.createContext({
  console,
  Date,
  Map,
  Set,
  String,
  Number,
  Boolean,
  Object,
  Array,
  Math,
  document: {
    createElement: (tag) => {
      const knoten = element(tag);
      const altAppend = knoten.append;
      knoten.append = (...k) => { k.forEach((kind) => { kind.elternteil = knoten; }); altAppend(...k); };
      return knoten;
    }
  },
  window: { addEventListener: (art, fn) => { if (art === "online") online.push(fn); } },
  // Der Ausschnitt ist hier belanglos: geprueft wird, ob ueberhaupt ein Bild
  // erscheint, nicht welcher Teil davon.
  bildausschnittModul: { cssWerte: () => ({}) },
  kartenFormat: () => "karte",
  // Die drei Neuzeichner ruft nur der online-Horcher.
  renderFavorites: () => {},
  renderHome: () => {},
  renderLibraryViews: () => {},
  thumbnailRepairAttempts: new Set()
});
kontext.globalThis = kontext;

vm.runInContext([
  abschnitt(renderer, "const bildFehler = new Map();", "const bildFehler = new Map();"),
  abschnitt(renderer, "const BILDFEHLER_PAUSE_MS", "const BILDFEHLER_PAUSE_MS = 5 * 60 * 1000;"),
  abschnitt(renderer, "const BILDFEHLER_MAX", "const BILDFEHLER_MAX = 400;"),
  abschnitt(renderer, "function bildGiltAlsKaputt"),
  abschnitt(renderer, "function bildAlsKaputtMerken"),
  abschnitt(renderer, "window.addEventListener(\"online\"", "});"),
  abschnitt(renderer, "function bildEbeneSetzen")
].join("\n"), kontext, { filename: "renderer.js" });

// Funktionen landen als Eigenschaft im Kontext, eine const-Bindung nicht -
// die muss man sich holen.
const { bildEbeneSetzen } = kontext;
const bildFehler = vm.runInContext("bildFehler", kontext);
const BILD = "https://aniworld.to/public/img/cover/attack-on-titan-stream-cover-abc_220x330.png";
const ANDERES = "https://aniworld.to/public/img/cover/black-torch-stream-cover-def_220x330.png";

const bildVon = (karte) => karte.querySelector(":scope > .karten-bild")?.querySelector("img") || null;

// ---------------------------------------------------------------------------
// (6) Eine gueltige Adresse wird gesetzt
// ---------------------------------------------------------------------------

const gut = karteBauen();
bildEbeneSetzen(gut, BILD, null);
pruefe("Eine gueltige Adresse landet im Bild", bildVon(gut)?.getAttribute("src") === BILD, bildVon(gut)?.getAttribute("src"));
pruefe("Die Karte gilt als bebildert", gut.classList.contains("has-thumb"));
pruefe("Und nicht als Karte ohne Bild", !gut.classList.contains("ohne-bild"));

// Zweimal zeichnen darf das Bild nicht neu laden - sonst blinkt die Karte bei
// jedem Takt der Watchparty.
const vorher = bildVon(gut).gesetzt;
bildEbeneSetzen(gut, BILD, null);
pruefe("Dieselbe Adresse wird nicht noch einmal gesetzt", bildVon(gut).gesetzt === vorher, `${vorher} -> ${bildVon(gut).gesetzt}`);

// Eine andere Adresse dagegen schon.
bildEbeneSetzen(gut, ANDERES, null);
pruefe("Eine andere Adresse wird uebernommen", bildVon(gut).getAttribute("src") === ANDERES);

// ---------------------------------------------------------------------------
// (7) Leere und gescheiterte Adressen
// ---------------------------------------------------------------------------

const leer = karteBauen();
bildEbeneSetzen(leer, "", null);
pruefe("Ohne Adresse entsteht keine Bildebene", bildVon(leer) === null);
pruefe("Ohne Adresse ist die Karte nicht als bebildert markiert", !leer.classList.contains("has-thumb"));
// Wichtig: eine Karte, fuer die nie ein Bild vorgesehen war, ist kein Fehler.
// Sie bekommt deshalb auch nicht das Zeichen fuer einen Ladefehler.
pruefe("Ohne Adresse gibt es keinen Fehlerhinweis", !leer.classList.contains("ohne-bild"));

bildEbeneSetzen(leer, "   ", null);
pruefe("Nur Leerzeichen zaehlen wie keine Adresse", bildVon(leer) === null && !leer.classList.contains("ohne-bild"));

const kaputt = karteBauen();
bildEbeneSetzen(kaputt, BILD, null);
const bildK = bildVon(kaputt);
pruefe("Vor dem Fehlschlag steht ein Bild da", bildK !== null);
// Genau das, was der Browser tut, wenn die Adresse nicht laedt.
bildK.onerror();
pruefe("Nach dem Fehlschlag ist die Bildebene weg", bildVon(kaputt) === null);
pruefe("Die Karte gilt nicht mehr als bebildert", !kaputt.classList.contains("has-thumb"));
pruefe("Sie traegt jetzt das Zeichen fuer die Ersatzgrafik", kaputt.classList.contains("ohne-bild"));

// Kein Kreislauf: ein neues Zeichnen setzt die kaputte Adresse nicht wieder in
// den src, sonst feuerte der onerror sofort das naechste Mal.
bildEbeneSetzen(kaputt, BILD, null);
pruefe("Ein Neuzeichnen setzt die kaputte Adresse nicht wieder", bildVon(kaputt) === null);
pruefe("Und die Ersatzgrafik bleibt stehen", kaputt.classList.contains("ohne-bild"));

// Ein verspaeteter onerror des *vorigen* Bildes darf das neue nicht mitreissen.
const gewechselt = karteBauen();
bildEbeneSetzen(gewechselt, ANDERES, null);
const altesBild = bildVon(gewechselt);
const altesOnerror = altesBild.onerror;
bildEbeneSetzen(gewechselt, "https://aniworld.to/public/img/cover/neu_220x330.png", null);
altesOnerror();
pruefe("Ein verspaeteter Fehler des alten Bildes trifft das neue nicht",
  bildVon(gewechselt) !== null && !gewechselt.classList.contains("ohne-bild"),
  bildVon(gewechselt)?.getAttribute("src"));

// ---------------------------------------------------------------------------
// (8) Ein Fehlschlag ist kein Urteil
// ---------------------------------------------------------------------------
//
// Gemerkt wird der Zeitpunkt, nicht das Ergebnis. Sonst kostete ein Aussetzer
// von zehn Sekunden das Bild bis zum naechsten Neustart - und genau das tat die
// Reparatur frueher, indem sie die Adresse leerte.

pruefe("Der Fehlschlag ist mit Zeitpunkt gemerkt, nicht als Urteil",
  typeof bildFehler.get(BILD) === "number", String(bildFehler.get(BILD)));

// Die Zeit vorstellen, statt fuenf Minuten zu warten.
bildFehler.set(BILD, Date.now() - (5 * 60 * 1000) - 1);
const spaeter = karteBauen();
bildEbeneSetzen(spaeter, BILD, null);
pruefe("Nach der Pause ist dieselbe Adresse wieder einen Versuch wert",
  bildVon(spaeter)?.getAttribute("src") === BILD, bildVon(spaeter)?.getAttribute("src"));
pruefe("Und der alte Fehlschlag ist vergessen", bildFehler.has(BILD) === false);

// Wer wieder online geht, bekommt seine Bilder sofort zurueck - ohne auf die
// fuenf Minuten zu warten.
bildEbeneSetzen(spaeter, BILD, null);
bildVon(spaeter).onerror();
pruefe("Vor dem Netzereignis gilt die Adresse als kaputt", bildFehler.has(BILD));
pruefe("Es gibt einen Horcher auf 'online'", online.length === 1, String(online.length));
online[0]();
pruefe("Zurueck am Netz sind alle Fehlschlaege vergessen", bildFehler.size === 0, String(bildFehler.size));

const fehler = pruefungen.filter((wert) => !wert).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
