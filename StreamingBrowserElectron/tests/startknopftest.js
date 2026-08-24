"use strict";
// Was der Autostart fuer einen Play-Knopf haelt.
//
// Das ist die Wurzel des gemeldeten Fehlers, und sie sass an einer Stelle, an
// der niemand sie gesucht haette. Gemessen am 24.08.2026 im Protokoll von
// ELFIX, auf der Folgenseite von Attack on Titan:
//
//   [ELFIX AUTOPLAY] vollbild=ja | rest=25s |
//       startknopf-geklickt:Young Ladies Don't Play Fighti@aniworld.to
//   [ELFIX MEDIA]    AKTUALISIERT | media=young-ladies-dont-play-fighting-games
//
// Der Autostart hat eine Empfehlungskachel angeklickt - weil in dem
// *Serientitel* das Wort "Play" steht. Danach stand das Hauptfenster bei einer
// fremden Serie, und der laufende Fortschritts-Takt schrieb deren Titel,
// Titelbild und Serienlaenge auf den Eintrag von Attack on Titan.
//
// Deshalb war es immer dieselbe fremde Serie: sie steht auf AniWorld in jeder
// Empfehlungsspalte, und ihr Titel enthaelt das Wort.
//
// Zwei Regeln folgen daraus, und beide werden hier gemessen:
//
//   1. Ein Play-Knopf fuehrt nicht von der Seite weg. Er startet, was hier
//      schon liegt.
//   2. "Play" zaehlt als Aufschrift eines Knopfes, nicht als Wort in einem
//      Satz. Ein Knopf traegt eine Aufschrift, keinen Titel.
//
// Gefahren wird der echte Quelltext aus main.js - die Auswahl steht dort in
// einer Zeichenkette, die in die Anbieterseite getragen wird.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..");
const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").split("\r\n").join("\n");

const pruefungen = [];
const pruefe = (name, bedingung, detail = "") => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

// Ein Abschnitt aus main.js. Die Zeilen stehen eingerueckt in einer Vorlage,
// deshalb endet ein Block hier auf "    };" und nicht auf "}".
//
// Gesucht wird ab einer Zeile, nicht von vorn: "const visible" steht in main.js
// zweimal. Die erste Fassung gehoert zu playerCenterPoint() und verlangt 200
// mal 120 Pixel - mit ihr faellt jeder Knopf durch, und der Test bestuende aus
// lauter falschen Nein.
const zeilen = MAIN.split("\n");
const zeileMit = (anfang, ab = 0) => {
  const treffer = zeilen.findIndex((z, i) => i >= ab && z.startsWith(anfang));
  if (treffer < 0) throw new Error("nicht gefunden: " + anfang);
  return treffer;
};
function abschnitt(anfang, ende, ab = 0) {
  const von = zeileMit(anfang, ab);
  if (!ende) return zeilen[von];
  let bis = von;
  while (bis < zeilen.length && zeilen[bis] !== ende) bis += 1;
  return zeilen.slice(von, bis + 1).join("\n");
}

// Der Anfang des Skripts, um das es geht.
const AB = zeileMit("    const badText = ");

// --- Eine Seite, so weit die Auswahl sie anfasst -----------------------------

const SEITE = "https://aniworld.to/anime/stream/attack-on-titan/staffel-3/episode-21";

function knoten({ tag = "div", text = "", klasse = "", href = null, breite = 64, hoehe = 64, elternAnker = null }) {
  const selbst = {
    tagName: tag.toUpperCase(),
    innerText: text,
    textContent: text,
    className: klasse,
    title: "",
    getAttribute: (name) => (name === "href" ? href : null),
    getBoundingClientRect: () => ({ width: breite, height: hoehe, top: 100, left: 100 }),
    // Der Anker ueber der Kachel - auf AniWorld liegt das Bild im Link, nicht
    // umgekehrt.
    closest: (auswahl) => {
      if (auswahl !== "a[href]") return null;
      if (tag.toLowerCase() === "a" && href) return selbst;
      return elternAnker;
    }
  };
  return selbst;
}

function auswahlLaufenLassen(elemente) {
  const kontext = vm.createContext({
    console,
    Array,
    String,
    Number,
    Boolean,
    Object,
    Math,
    RegExp,
    URL,
    Date,
    location: new URL(SEITE),
    innerWidth: 1280,
    innerHeight: 800,
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    document: { querySelectorAll: () => elemente }
  });
  kontext.globalThis = kontext;
  vm.runInContext([
    abschnitt("    const badText = ", null, AB),
    abschnitt("    const visible = (node) => {", "    };", AB),
    abschnitt("    const textOf = ", null, AB),
    abschnitt("    const fuehrtWeg = (node) => {", "    };", AB),
    abschnitt("    const startknopf = () => {", "    };", AB),
    "globalThis.__treffer = startknopf();"
  ].join("\n"), kontext, { filename: "main.js:startPlaybackInView" });
  return kontext.__treffer;
}

// --- Die Kachel, die den Fehler ausgeloest hat -------------------------------

const empfehlung = knoten({
  tag: "a",
  text: "Young Ladies Don't Play Fighting Games",
  klasse: "coverListItem",
  href: "/anime/stream/young-ladies-dont-play-fighting-games",
  breite: 220,
  hoehe: 330
});

pruefe("Die Empfehlungskachel wird nicht mehr als Startknopf genommen",
  auswahlLaufenLassen([empfehlung]) === null,
  String(auswahlLaufenLassen([empfehlung]) && auswahlLaufenLassen([empfehlung]).innerText));

// Auch das Bild *in* der Kachel nicht - dort haengt der Link am Elternteil.
const bildInKachel = knoten({
  tag: "img",
  text: "",
  klasse: "playPoster",
  breite: 220,
  hoehe: 330,
  elternAnker: empfehlung
});
pruefe("Auch ein Kind der Kachel nicht - der Link zaehlt vom Elternteil aus",
  auswahlLaufenLassen([bildInKachel]) === null);

// Ein Titel ohne Link, aber mit dem Wort: auch das ist kein Knopf. Ein Knopf
// traegt eine Aufschrift, keinen Satz.
const ueberschrift = knoten({
  tag: "h1",
  text: "Young Ladies Don't Play Fighting Games",
  klasse: "seriesTitle",
  breite: 600,
  hoehe: 40
});
pruefe("Ein langer Titel mit dem Wort 'Play' ist kein Knopf",
  auswahlLaufenLassen([ueberschrift]) === null);

// --- Und was ein Startknopf ist, bleibt einer -------------------------------

const grosserKnopf = knoten({ tag: "button", text: "", klasse: "vjs-big-play-button", breite: 80, hoehe: 80 });
pruefe("Der runde Knopf des Players bleibt der Startknopf",
  auswahlLaufenLassen([grosserKnopf]) === grosserKnopf,
  String(auswahlLaufenLassen([grosserKnopf]) && auswahlLaufenLassen([grosserKnopf]).className));

const beschrifteter = knoten({ tag: "button", text: "Play", klasse: "btn", breite: 90, hoehe: 44 });
pruefe("Ein Knopf mit der Aufschrift 'Play' auch",
  auswahlLaufenLassen([beschrifteter]) === beschrifteter);

const abspielen = knoten({ tag: "div", text: "▶ Play now", klasse: "poster-overlay", breite: 120, hoehe: 48 });
pruefe("Und 'Play now' mit Dreieck davor",
  auswahlLaufenLassen([abspielen]) === abspielen);

// Die Aufforderung von Filmo ist ein ganzer Satz - sie hat ihre eigene Regel
// und darf nicht an der Laengengrenze scheitern.
const filmoHinweis = knoten({
  tag: "div",
  text: "Tippe auf Play, um die Wiedergabe zu starten",
  klasse: "start-hint",
  breite: 420,
  hoehe: 60
});
pruefe("Die Aufforderung 'Tippe auf Play, um die Wiedergabe zu starten' bleibt",
  auswahlLaufenLassen([filmoHinweis]) === filmoHinweis);

// Ein Anker, der auf dieselbe Seite zeigt, ist kein Weglaufen: manche Player
// haengen ihren Startknopf an ein <a href="#">.
const ankerAufSichSelbst = knoten({ tag: "a", text: "Play", klasse: "play", href: "#", breite: 70, hoehe: 70 });
pruefe("Ein Startknopf an einem Anker auf dieselbe Seite zaehlt weiter",
  auswahlLaufenLassen([ankerAufSichSelbst]) === ankerAufSichSelbst);

const ankerJavascript = knoten({ tag: "a", text: "Play", klasse: "play", href: "javascript:void(0)", breite: 70, hoehe: 70 });
pruefe("Und einer, der nur ein Skript aufruft, ebenfalls",
  auswahlLaufenLassen([ankerJavascript]) === ankerJavascript);

// Der entscheidende Fall im Zusammenspiel: stehen beide auf der Seite, gewinnt
// der Knopf - nicht die Kachel.
pruefe("Stehen Kachel und Knopf zusammen auf der Seite, gewinnt der Knopf",
  auswahlLaufenLassen([empfehlung, grosserKnopf]) === grosserKnopf,
  String(auswahlLaufenLassen([empfehlung, grosserKnopf]) && auswahlLaufenLassen([empfehlung, grosserKnopf]).className));

const fehler = pruefungen.filter((wert) => !wert).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
