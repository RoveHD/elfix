"use strict";
// Bilder, die eine Seite selbst nicht laedt.
//
// AniWorld haengt seine Cover nicht in den <img>, sondern daneben, in data-src.
// Im src steht ein durchsichtiges PNG von einem Pixel; tauschen soll das ein
// Skript von cdnjs.cloudflare.com. Kommt das nicht durch, bleibt jede Kachel
// leer - und deshalb tauscht ELFIX selbst.
//
// Gemeldet war genau dieser leere Zustand, obwohl die Nachreichung laengst
// eingebaut war. Der Grund: der Platzhalter sah wie eine gueltige Bildadresse
// aus. Er trug keines der Woerter, an denen ELFIX Beiwerk erkennt (logo,
// sprite, blank, ...), galt damit als brauchbares Bild - und ein Bild von einem
// Pixel ist sofort fertig geladen. Die Nachreichung sah also ein Bild, das
// schon da war, und liess das Cover liegen.
//
// Gefahren wird das echte Skript aus bildnachreichung.js in einer Seite mit
// genau den <img>, die auf aniworld.to stehen (aus tests/aniworld.html
// uebernommen).

const vm = require("vm");
const bildnachreichung = require("../src/bildnachreichung");

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}

/** Der Platzhalter, den AniWorld in jeden src setzt: ein Pixel, durchsichtig. */
const PLATZHALTER = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAf"
  + "FcSJAAAADUlEQVR42mPUd/SuBwACngE8BcXfBAAAAABJRU5ErkJggg==";
const COVER = "/public/img/cover/mushoku-tensei-jobless-reincarnation-stream-cover-eNsZxDLh_200x300.png";

/** Ein <img>, so weit das Skript es anfasst. */
function bild(attribute) {
  const werte = { ...attribute };
  return {
    dataset: {},
    // Ein Bild von einem Pixel ist sofort geladen - genau das hat die
    // Nachreichung frueher fuer "schon da" gehalten.
    complete: true,
    loading: "lazy",
    decoding: "auto",
    style: {},
    tabIndex: 0,
    innerText: "",
    textContent: "",
    getAttribute: (name) => (name in werte ? werte[name] : null),
    setAttribute: (name, wert) => { werte[name] = wert; },
    // Die Seite haengt ihr Cover nicht nur an data-src - sie *versteckt* auch
    // jedes Bild, das dieses Attribut noch traegt. Ohne removeAttribute liesse
    // sich hier nicht pruefen, was der Fehler eigentlich war.
    removeAttribute: (name) => { delete werte[name]; },
    zustand: werte
  };
}

function nachreichen(bilder) {
  let mutation = null;
  const kontext = vm.createContext({
    location: { href: "https://aniworld.to/anime/stream/mushoku-tensei/staffel-3" },
    URL, Array, String, Number, Boolean, RegExp, JSON, console,
    setTimeout: () => 0,
    MutationObserver: function (callback) {
      mutation = callback;
      this.observe = () => {};
    },
    Event: function (name) { this.type = name; },
    document: {
      documentElement: {},
      querySelectorAll: (auswahl) => (auswahl === "img" ? bilder : [])
    }
  });
  kontext.window = kontext;
  kontext.globalThis = kontext;
  kontext.window.dispatchEvent = () => {};
  vm.runInContext(bildnachreichung.nachreichSkript(), kontext, { filename: "bildnachreichung.js" });
  kontext.__elflixRunMutation = () => {
    if (mutation) mutation([]);
  };
  return bilder;
}

const cover = bild({ src: PLATZHALTER, "data-src": COVER, alt: "Mushoku Tensei Cover" });
nachreichen([cover]);
pruefe("Das Cover kommt in den src, obwohl dort ein Platzhalter stand",
  cover.zustand.src === "https://aniworld.to" + COVER,
  cover.zustand.src.slice(0, 80));
pruefe("und das Bild laedt danach sofort statt beim Scrollen",
  cover.loading === "eager", cover.loading);

// Und jetzt der Grund, warum das Cover trotz richtiger Adresse unsichtbar
// blieb. AniWorld blendet in seinem eigenen Stylesheet aus:
//
//   .homeContentPromotionBoxPicture img[data-src],
//   .seriesCoverBox img[data-src],
//   .coverListItem img[data-src] { opacity: 0; }
//
// Sichtbar wird ein Bild dort also nicht dadurch, dass eine Adresse im src
// steht, sondern dadurch, dass vanilla-lazyload das Attribut nach dem
// Umhaengen *entfernt*. Kommt dieses Skript nicht durch, blieb die Kachel
// dunkelblau - mit einem Bild dahinter, das vollstaendig geladen war.
//
// Gemessen am 24.08.2026 auf der Startseite von AniWorld in ELFIX: 337 Bilder,
// keines mit naturalWidth 0, und die obere Kachelreihe trotzdem leer. Jedes
// betroffene <img> stand auf opacity 0 und trug noch sein data-src.
pruefe("Das Lazy-Attribut ist danach weg - sonst haelt die Seite das Bild verborgen",
  cover.zustand["data-src"] === undefined, JSON.stringify(cover.zustand["data-src"]));

// Aber nur, wenn wirklich ein Bild uebernommen wurde. Sonst bliebe der
// durchsichtige Platzhalter sichtbar - und nachkommen koennte auch nichts
// mehr, weil die Adresse dann nirgends mehr steht.
const ohneBrauchbares = bild({ src: PLATZHALTER, "data-src": "/public/img/spinner.gif" });
nachreichen([ohneBrauchbares]);
pruefe("Ohne uebernommenes Bild bleibt das Lazy-Attribut stehen",
  ohneBrauchbares.zustand["data-src"] === "/public/img/spinner.gif",
  JSON.stringify(ohneBrauchbares.zustand["data-src"]));

// Die Sprachfahnen neben jeder Folge haengen genauso in data-src. Sie gehoeren
// zur Seite und kommen deshalb mit - hier geht es darum, wiederherzustellen,
// was die Seite zeigen will, und nicht darum, ein Titelbild auszusuchen.
const fahne = bild({ src: PLATZHALTER, "data-src": "/public/img/japanese-german.svg", class: "flag" });
nachreichen([fahne]);
pruefe("Die Sprachfahne einer Folge kommt ebenfalls",
  fahne.zustand.src === "https://aniworld.to/public/img/japanese-german.svg",
  fahne.zustand.src);

// Was die Seite selbst nur als Beiwerk fuehrt, bleibt liegen: ein Ladekringel
// im Hintergrund eines Kastens waere nichts, was jemand sehen will.
const kringel = bild({ src: PLATZHALTER, "data-src": "/public/img/spinner.gif" });
nachreichen([kringel]);
pruefe("Ein Ladekringel wird nicht nachgereicht",
  kringel.zustand.src === PLATZHALTER, kringel.zustand.src.slice(0, 40));

// Ein Bild, das die Seite schon richtig geladen hat, wird nicht angefasst.
const echt = bild({ src: "https://aniworld.to/public/img/cover/tensura-cover.png", "data-src": COVER });
nachreichen([echt]);
pruefe("Ein bereits geladenes Bild bleibt, wie es ist",
  echt.zustand.src === "https://aniworld.to/public/img/cover/tensura-cover.png",
  echt.zustand.src);

// Zweimal ueber dieselbe Seite laufen (der Beobachter tut das bei jeder
// Aenderung) darf nichts kaputtmachen.
const nochmal = bild({ src: PLATZHALTER, "data-src": COVER });
nachreichen([nochmal]);
nachreichen([nochmal]);
pruefe("Ein zweiter Durchgang aendert nichts mehr",
  nochmal.zustand.src === "https://aniworld.to" + COVER);

// AniWorld baut Kacheln teils in zwei Schritten: erst steht nur der
// Platzhalter, danach kommt data-src dazu. Die Nachreichung darf das Bild dann
// nicht als "schon erledigt" abtun.
const spaet = bild({ src: PLATZHALTER });
let mutation = null;
const kontext = vm.createContext({
  location: { href: "https://aniworld.to/anime/stream/mushoku-tensei/staffel-3" },
  URL, Array, String, Number, Boolean, RegExp, JSON, console,
  setTimeout: () => 0,
  MutationObserver: function (callback) {
    mutation = callback;
    this.observe = () => {};
  },
  Event: function (name) { this.type = name; },
  document: {
    documentElement: {},
    querySelectorAll: (auswahl) => (auswahl === "img" ? [spaet] : [])
  }
});
kontext.window = kontext;
kontext.globalThis = kontext;
kontext.window.dispatchEvent = () => {};
vm.runInContext(bildnachreichung.nachreichSkript(), kontext, { filename: "bildnachreichung.js" });
spaet.setAttribute("data-src", COVER);
if (mutation) mutation([]);
pruefe("Ein spaeter gesetztes data-src wird nachgezogen",
  spaet.zustand.src === "https://aniworld.to" + COVER,
  spaet.zustand.src.slice(0, 80));

const bestanden = pruefungen.filter(Boolean).length;
console.log(`${bestanden}/${pruefungen.length} bestanden`);
process.exit(bestanden === pruefungen.length ? 0 : 1);
