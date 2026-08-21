"use strict";
// Ein Ersatz-DOM fuer die Einblendungen in der Anbieterseite.
//
// Die Skripte, die ELFIX in fremde Seiten traegt, stehen als Zeichenketten in
// main.js. Sie hier auszufuehren statt sie zu lesen ist der einzige Weg, an dem
// auffaellt, was ein Quelltext nicht zeigt: ob ein Knopf wirklich entsteht, ob
// er nach ein paar Sekunden Stille verschwindet, ob ein zweites Einspielen ihn
// verdoppelt.
//
// Chat und Autoplay-Schalter teilen sich seit der gemeinsamen Leiste dieselbe
// Buehne - deshalb liegt sie hier und nicht mehr in einer der beiden Suiten.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..");
const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").replace(/\r/g, "");

// Ein Abschnitt aus main.js: von der Zeile, die so anfaengt, bis zur ersten
// Zeile, die nur aus der schliessenden Klammer besteht.
function abschnitt(quelle, anfang, ende = "}") {
  const zeilen = quelle.split("\n");
  const von = zeilen.findIndex((z) => z.startsWith(anfang));
  if (von < 0) throw new Error("nicht gefunden: " + anfang);
  let bis = von;
  while (bis < zeilen.length && zeilen[bis] !== ende) bis += 1;
  return zeilen.slice(von, bis + 1).join("\n");
}

// Ein Einblendungs-Skript aus main.js zusammenbauen. Die Leiste gehoert dazu:
// beide Skripte tragen ihren Quelltext in sich, sonst faenden sie in einer
// fremden Seite nichts, woran sie sich haengen koennten.
function skriptBauen(name, ...argumente) {
  const u = { JSON, String, Number };
  vm.createContext(u);
  vm.runInContext(MAIN.match(/^const LEISTE_RUHE_MS = .+$/m)[0], u);
  vm.runInContext(abschnitt(MAIN, "function leisteQuelltext("), u);
  vm.runInContext(abschnitt(MAIN, `function ${name}(`), u);
  return vm.runInContext(name, u)(...argumente);
}

function seiteBauen() {
  const meldungen = [];
  const uhr = { jetzt: 0 };
  const wartende = [];
  let nummer = 1;

  function element(tag) {
    const horcher = {};
    const knoten = {
      tag, id: "", textContent: "", type: "", value: "", maxLength: 0, placeholder: "",
      title: "", style: {}, dataset: {}, attribute: {}, children: [], parentElement: null,
      addEventListener(name, fn) { (horcher[name] = horcher[name] || []).push(fn); },
      removeEventListener() {},
      setAttribute(name, wert) { knoten.attribute[name] = String(wert); },
      getAttribute(name) { return knoten.attribute[name]; },
      append(...k) { k.forEach((x) => { x.parentElement = knoten; knoten.children.push(x); }); },
      appendChild(k) { k.parentElement = knoten; knoten.children.push(k); return k; },
      remove() {
        if (knoten.parentElement) {
          knoten.parentElement.children = knoten.parentElement.children.filter((x) => x !== knoten);
          knoten.parentElement = null;
        }
      },
      get firstChild() { return knoten.children[0] || null; },
      focus() { dokument.activeElement = knoten; },
      getBoundingClientRect: () => ({ width: 800, height: 450 }),
      scrollTop: 0, scrollHeight: 0,
      ausloesen(name, ereignis = {}) {
        const daten = { preventDefault() {}, stopPropagation() { daten.gestoppt = true; }, ...ereignis };
        for (const fn of horcher[name] || []) fn(daten);
        return daten;
      },
      hat: (name) => Boolean(horcher[name])
    };
    return knoten;
  }

  function suche(knoten, id) {
    if (knoten.id === id) return knoten;
    for (const kind of knoten.children) {
      const treffer = suche(kind, id);
      if (treffer) return treffer;
    }
    return null;
  }

  const video = element("video");
  const wurzel = element("html");
  const dokument = {
    documentElement: wurzel,
    fullscreenElement: null,
    activeElement: null,
    createElement: element,
    // Ein entfernter Knoten haengt an keinem Elternteil mehr und wird deshalb
    // auch nicht mehr gefunden - genau wie im echten Dokument.
    getElementById: (id) => suche(wurzel, id),
    querySelectorAll: (auswahl) => (auswahl === "video" ? [video] : []),
    addEventListener(name, fn) { (dokument.__h = dokument.__h || {})[name] = fn; },
    removeEventListener() {}
  };

  const fenster = {};
  fenster.top = fenster;
  fenster.self = fenster;

  const kontext = {
    document: dokument,
    window: fenster,
    location: { hostname: "aniworld.to" },
    console: { log: (t) => meldungen.push(String(t)) },
    Object, Array, String, Number, Boolean, Math, JSON, Date,
    setTimeout: (fn, ms) => {
      const n = nummer++;
      wartende.push({ n, fn, faellig: uhr.jetzt + (Number(ms) || 0) });
      return n;
    },
    clearTimeout: (n) => {
      const i = wartende.findIndex((w) => w.n === n);
      if (i >= 0) wartende.splice(i, 1);
    },
    requestAnimationFrame: (fn) => fn()
  };
  vm.createContext(kontext);

  return {
    kontext, dokument, wurzel, fenster, meldungen,
    lauf: (script) => vm.runInContext(script, kontext),
    holen: (id) => suche(wurzel, id),
    leiste: () => suche(wurzel, "__elfixLeisteLinks"),
    mausBewegen: () => dokument.__h.mousemove({}),
    // Die Uhr weiterdrehen und alles ausloesen, was faellig geworden ist.
    warten(ms) {
      uhr.jetzt += ms;
      for (const eintrag of wartende.splice(0).sort((a, b) => a.faellig - b.faellig)) {
        if (eintrag.faellig <= uhr.jetzt) eintrag.fn();
        else wartende.push(eintrag);
      }
    }
  };
}

module.exports = { MAIN, abschnitt, skriptBauen, seiteBauen };
