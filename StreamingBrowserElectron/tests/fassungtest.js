"use strict";
// Fassung merken - Sub oder Dub.
//
// Zwei Haelften wie bei den Marken: die Regeln, und das Skript, das in der
// Anbieterseite liegt. Das Skript wird ausgefuehrt und nicht gelesen - ob eine
// Flagge wirklich angeklickt wird, ob dabei die richtige getroffen wird und ob
// der eigene Klick nicht als Entscheidung zurueckkommt, sieht man einem
// Quelltext nicht an.
//
// Der letzte Punkt ist der, an dem die ganze Sache haengt. Lernte die Vorwahl
// von ihrem eigenen Klick, waere sie harmlos; lernte sie dagegen von dem, was
// beim Laden dasteht, haette sie sich nach der ersten Folge selbst wieder
// abgewaehlt - denn beim Laden steht die Vorgabe des Anbieters da, und die ist
// meistens Deutsch.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const fassung = require("../src/fassung");

const WURZEL = path.join(__dirname, "..");
const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").replace(/\r/g, "");

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}

// --- Die Worte ----------------------------------------------------------------

pruefe("Der Dateiname der Flagge wird zum Wort",
  fassung.bezeichnung("german") === "Deutsch");
pruefe("Untertitel bleiben Untertitel",
  fassung.bezeichnung("japanese-german") === "Japanisch, Deutsche Untertitel",
  "japanischer Ton, deutscher Untertitel - nicht zwei Sprachen");
pruefe("Dieselben Worte wie im Kalender",
  fassung.bezeichnung("ger-sub") === require("../src/discover").spracheAusFlagge("ger-sub"),
  "sonst stuenden zwei Namen fuer dieselbe Fassung in derselben App");
pruefe("Auch der Titeltext der Seite wird verstanden",
  fassung.bezeichnung("Mit Untertitel Deutsch") === "Deutsche Untertitel");
pruefe("Und der englische",
  fassung.bezeichnung("Mit Untertitel Englisch") === "Englische Untertitel");
pruefe("Nichts bleibt nichts",
  fassung.bezeichnung("") === "");
pruefe("Unbekanntes bleibt lesbar",
  fassung.bezeichnung("klingon") === "Klingon",
  "es landet als Beschriftung in den Einstellungen");

// --- Was gespeichert wird -------------------------------------------------------

pruefe("Ohne Angabe gibt es keine Fassung",
  fassung.normalisieren({ key: "", roh: "" }) === null);
pruefe("Ein Schluessel allein genuegt",
  fassung.normalisieren({ key: "3" })?.key === "3",
  "der Dateiname kann fehlen, der Schluessel klickt trotzdem");
pruefe("Der Name entsteht beim Normalisieren",
  fassung.normalisieren({ key: "1", roh: "german" })?.name === "Deutsch");

pruefe("Gleicher Schluessel meint dieselbe Fassung",
  fassung.gleich({ key: "1", roh: "german" }, { key: "1", roh: "" }));
pruefe("Anderer Schluessel meint eine andere",
  !fassung.gleich({ key: "1", roh: "german" }, { key: "3", roh: "german" }),
  "der Schluessel schlaegt den Dateinamen - er ist die Angabe der Seite");
pruefe("Ohne Schluessel entscheidet der Dateiname",
  fassung.gleich({ key: "", roh: "japanese-german" }, { key: "", roh: "JAPANESE-GERMAN" }));
pruefe("Nichts ist mit nichts nicht gleich",
  !fassung.gleich(null, { key: "1" }));

{
  const leer = {};
  const eins = fassung.merken(leer, "onepiece", { key: "1", roh: "german" });
  pruefe("Eine Fassung wird gemerkt",
    fassung.lesen(eins, "onepiece")?.name === "Deutsch");
  pruefe("Der Bestand davor bleibt unberuehrt",
    Object.keys(leer).length === 0,
    "der Aufrufer soll am Rueckgabewert sehen, ob es etwas zu speichern gibt");
  pruefe("Dasselbe noch einmal aendert nichts",
    fassung.merken(eins, "onepiece", { key: "1", roh: "german" }) === eins);

  const vorgabe = fassung.merken(eins, "onepiece", { key: "1", roh: "german" }, { nurWennNeu: true });
  pruefe("Die Vorgabe des Anbieters ueberschreibt nichts",
    vorgabe === eins);
  const gedreht = fassung.merken(eins, "onepiece", { key: "3", roh: "japanese-german" }, { nurWennNeu: true });
  pruefe("Auch keine andere Vorgabe",
    gedreht === eins,
    "sonst waehlte die Vorwahl sich nach der ersten Folge selbst wieder ab");
  const wahl = fassung.merken(eins, "onepiece", { key: "3", roh: "japanese-german" });
  pruefe("Ein Klick dagegen gilt",
    fassung.lesen(wahl, "onepiece")?.key === "3");
  pruefe("Ohne Schluessel wird nichts gemerkt",
    fassung.merken(eins, "", { key: "1" }) === eins);
}

{
  let bestand = {};
  for (let nummer = 0; nummer < fassung.MAX_TITEL + 5; nummer += 1) {
    bestand = fassung.merken(bestand, `serie-${nummer}`, { key: "1", roh: "german" }, { at: 1000 + nummer });
  }
  pruefe("Der Bestand waechst nicht ins Uferlose",
    Object.keys(bestand).length === fassung.MAX_TITEL);
  pruefe("Die aeltesten fallen raus",
    !bestand["serie-0"] && Boolean(bestand[`serie-${fassung.MAX_TITEL + 4}`]));
}

pruefe("Eine unbekannte Serie hat keine Fassung",
  fassung.lesen({}, "onepiece") === null);
pruefe("Und ohne Schluessel erst recht keine",
  fassung.lesen({ "": { key: "1" } }, "") === null);

// --- Der Rueckkanal ---------------------------------------------------------------

{
  const stand = fassung.meldung(fassung.MELDE_STAND + "1:german");
  pruefe("Der Stand kommt an",
    stand?.art === "stand" && stand.fassung.key === "1" && stand.fassung.name === "Deutsch");
  const wahl = fassung.meldung(fassung.MELDE_WAHL + "3:" + encodeURIComponent("Mit Untertitel Deutsch"));
  pruefe("Die Wahl auch, mit Umschrift",
    wahl?.art === "wahl" && wahl.fassung.name === "Deutsche Untertitel");
  pruefe("Eine kaputte Umschrift wirft die Meldung nicht weg",
    fassung.meldung(fassung.MELDE_WAHL + "3:%E0%A4%A")?.fassung.key === "3",
    "der Schluessel allein genuegt zum Wiederfinden");
  pruefe("Fremde Zeilen sind keine Meldung",
    fassung.meldung("__elfix:sprung:62:152") === null);
  pruefe("Und eine halbe auch nicht",
    fassung.meldung(fassung.MELDE_STAND + "ohnetrenner") === null);
}

// --- Das Skript in der Anbieterseite ------------------------------------------------

// Eine Anbieterseite, wie AniWorld und S.to sie bauen: eine Reihe Flaggen in
// einer .changeLanguageBox, darunter je Fassung eine Hosterliste - und nur die
// der gewaehlten Fassung ist sichtbar.
function element(tag, attrs = {}, kinder = []) {
  const node = {
    tagName: String(tag).toUpperCase(),
    attrs,
    className: attrs.class || "",
    kinder,
    parent: null,
    textContent: attrs.text || "",
    sichtbar: attrs.sichtbar !== false,
    horcher: {},
    getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; },
    getBoundingClientRect() {
      return this.sichtbar ? { width: 30, height: 20 } : { width: 0, height: 0 };
    },
    addEventListener(name, fn) { (this.horcher[name] = this.horcher[name] || []).push(fn); },
    closest(auswahl) {
      let lauf = this;
      while (lauf) {
        if (auswahl.startsWith(".")) {
          if (String(lauf.className || "").split(/\s+/).includes(auswahl.slice(1))) return lauf;
        } else if (passt(lauf, auswahl)) {
          return lauf;
        }
        lauf = lauf.parent;
      }
      return null;
    },
    querySelector(auswahl) { return unten(this).find((kind) => passt(kind, auswahl)) || null; },
    dispatchEvent(ereignis) {
      ereignis.target = this;
      for (const fn of dokument.horcher[ereignis.type] || []) fn(ereignis);
      let lauf = this;
      while (lauf) {
        for (const fn of lauf.horcher[ereignis.type] || []) fn(ereignis);
        lauf = lauf.parent;
      }
      return true;
    }
  };
  for (const kind of kinder) kind.parent = node;
  return node;
}

function unten(node) {
  const alle = [];
  for (const kind of node.kinder || []) {
    alle.push(kind, ...unten(kind));
  }
  return alle;
}

// Ein winziger Waehler: Tagnamen, Attributvorhandensein und href*=. Mehr
// braucht das Skript nicht.
function passt(node, auswahl) {
  return String(auswahl).split(",").map((teil) => teil.trim()).some((teil) => {
    if (teil === "[data-lang-key]") return node.getAttribute("data-lang-key") !== null;
    const treffer = teil.match(/^([a-z]+)\[href\*='([^']+)'\]$/i);
    if (treffer) {
      return node.tagName === treffer[1].toUpperCase()
        && String(node.getAttribute("href") || "").includes(treffer[2]);
    }
    return node.tagName === teil.toUpperCase();
  });
}

const dokument = { horcher: {} };

// aktiv: welche Fassung die Seite gerade zeigt. eigeneLogik: ob die Seite auf
// einen Klick selbst umschaltet - beim ersten Lauf haengen die Horcher des
// Anbieters manchmal noch nicht.
function seite({ fassungen = [["1", "german"], ["3", "japanese-german"]], aktiv = "1", eigeneLogik = true, markiert = "" } = {}) {
  const flaggen = fassungen.map(([key, datei]) => element("li", {
    "data-lang-key": key,
    class: markiert === key ? "selected" : ""
  }, [element("a", { href: "#" }, [element("img", { class: "flag", src: `/public/img/${datei}.svg` })])]));
  const box = element("div", { class: "changeLanguageBox" }, flaggen);

  const hoster = [];
  for (const [key] of fassungen) {
    for (const name of ["VOE", "Vidoza"]) {
      hoster.push(element("li", {
        "data-lang-key": key,
        text: name,
        sichtbar: key === aktiv
      }, [element("a", { href: "/redirect/12345" })]));
    }
  }
  const liste = element("ul", { class: "hosterSiteVideo" }, hoster);
  const wurzel = element("body", {}, [box, liste]);

  const zustand = { aktiv };
  if (eigeneLogik) {
    for (const flagge of flaggen) {
      flagge.addEventListener("click", () => {
        zustand.aktiv = flagge.getAttribute("data-lang-key");
        for (const eintrag of hoster) {
          eintrag.sichtbar = eintrag.getAttribute("data-lang-key") === zustand.aktiv;
        }
      });
    }
  }

  const meldungen = [];
  const fenster = {};
  const kontext = {
    window: fenster,
    document: {
      querySelectorAll: (auswahl) => unten(wurzel).filter((node) => passt(node, auswahl)),
      addEventListener: (name, fn) => { (dokument.horcher[name] = dokument.horcher[name] || []).push(fn); }
    },
    getComputedStyle: (node) => ({ display: node.sichtbar ? "block" : "none", visibility: "visible" }),
    MouseEvent: function MouseEvent(art, init) { this.type = art; Object.assign(this, init || {}); this.isTrusted = false; },
    console: { log: (zeile) => meldungen.push(String(zeile)) },
    Array, Number, Math, Date, JSON, String, Boolean, Object, Map
  };
  fenster.top = fenster;
  kontext.globalThis = kontext;
  vm.createContext(kontext);

  return {
    meldungen, kontext, fenster, zustand, flaggen, hoster,
    laufen: (wunsch) => vm.runInContext(fassung.fassungScript(wunsch), kontext),
    // Ein echter Klick eines Menschen auf eine Flagge. Getroffen wird das Bild
    // darin - das ist es, was unter dem Finger liegt.
    tippen: (key) => {
      const flagge = flaggen.find((node) => node.getAttribute("data-lang-key") === key);
      flagge.querySelector("img").dispatchEvent({ type: "click", isTrusted: true });
    },
    staende: () => meldungen.filter((zeile) => zeile.startsWith(fassung.MELDE_STAND)),
    wahlen: () => meldungen.filter((zeile) => zeile.startsWith(fassung.MELDE_WAHL))
  };
}

// Jeder Lauf braucht ein frisches Dokument - die Horcher haengen daran.
function frisch(optionen) {
  dokument.horcher = {};
  return seite(optionen);
}

{
  const b = frisch();
  const ergebnis = b.laufen(null);
  pruefe("Ohne gemerkte Fassung wird nichts angeklickt",
    ergebnis === "ohne-wunsch");
  pruefe("Aber der Stand wird gemeldet",
    b.staende().length === 1 && b.staende()[0] === fassung.MELDE_STAND + "1:german",
    "das ist die Vorgabe des Anbieters - die erste Folge sagt, womit man anfaengt");
}

{
  const b = frisch({ fassungen: [], aktiv: "" });
  pruefe("Eine Seite ohne Flaggen ist keine Serie mit Fassungen",
    b.laufen({ key: "3", roh: "japanese-german" }) === "keine-fassungen");
}

{
  const b = frisch({ aktiv: "3" });
  pruefe("Steht die gemerkte Fassung schon da, passiert nichts",
    b.laufen({ key: "3", roh: "japanese-german" }) === "steht");
  pruefe("Und es wird auch nichts umgestellt",
    b.zustand.aktiv === "3");
}

{
  const b = frisch({ aktiv: "1" });
  const ergebnis = b.laufen({ key: "3", roh: "japanese-german" });
  pruefe("Die gemerkte Fassung wird angeklickt",
    ergebnis === "gewechselt:japanese-german", ergebnis);
  pruefe("Danach zeigt die Seite die andere Hosterliste",
    b.zustand.aktiv === "3"
    && b.hoster.filter((node) => node.sichtbar).every((node) => node.getAttribute("data-lang-key") === "3"),
    "genau darum muss der Autostart warten - er klickt sonst den falschen Hoster");
}

{
  const b = frisch({ aktiv: "1", eigeneLogik: false });
  pruefe("Klickt die Seite nicht mit, wird das gesagt",
    b.laufen({ key: "3", roh: "japanese-german" }) === "geklickt:japanese-german",
    "dann bleibt die Sperre stehen, bis der zweite Lauf sie aufloest");
}

{
  const b = frisch({ fassungen: [["1", "german"]], aktiv: "1" });
  pruefe("Gibt es die gemerkte Fassung hier nicht, bleibt alles stehen",
    b.laufen({ key: "3", roh: "japanese-german" }) === "fehlt",
    "eine Staffel, die es nur auf Deutsch gibt, soll nicht ins Leere klicken");
  pruefe("Und es wird nichts anderes angeklickt",
    b.zustand.aktiv === "1");
}

{
  const b = frisch({ aktiv: "1" });
  b.laufen({ key: "", roh: "japanese-german" });
  pruefe("Auch ohne Schluessel findet der Dateiname die Flagge",
    b.zustand.aktiv === "3",
    "so ueberlebt eine gemerkte Fassung einen Anbieterumzug");
}

{
  const b = frisch({ aktiv: "1" });
  b.laufen(null);
  b.tippen("3");
  pruefe("Ein echter Klick wird gemeldet",
    b.wahlen().length === 1 && b.wahlen()[0] === fassung.MELDE_WAHL + "3:japanese-german",
    "getroffen wird das Bild, gemeldet die Flagge darum herum");
}

{
  const b = frisch({ aktiv: "1" });
  b.laufen({ key: "3", roh: "japanese-german" });
  pruefe("Der eigene Klick der Vorwahl wird nicht als Entscheidung gemeldet",
    b.wahlen().length === 0,
    "sonst lernte die Vorwahl von sich selbst");
}

{
  const b = frisch({ aktiv: "1" });
  b.laufen(null);
  b.laufen(null);
  pruefe("Der zweite Lauf meldet den Stand nicht noch einmal",
    b.staende().length === 1);
  b.tippen("3");
  pruefe("Und er haengt keinen zweiten Horcher ein",
    b.wahlen().length === 1,
    "sonst stuende jede Wahl doppelt in der Konsole");
}

{
  const b = frisch({ aktiv: "1" });
  b.fenster.top = { andere: true };
  pruefe("Im Rahmen des Hosters tut das Skript nichts",
    b.laufen({ key: "3", roh: "japanese-german" }) === "",
    "dort gibt es keine Flaggen, und das Skript geht in alle Rahmen");
}

{
  // Die Klasse sagt "1", die sichtbaren Hoster sagen "3". Die Seite selbst hat
  // recht - Klassennamen aendern die Anbieter beim naechsten Umbau.
  const b = frisch({ aktiv: "3", markiert: "1" });
  pruefe("Was laeuft, verraten die sichtbaren Hoster und nicht eine Klasse",
    b.laufen({ key: "3", roh: "japanese-german" }) === "steht");
}

// --- Die Verdrahtung ---------------------------------------------------------------

pruefe("Das Skript kommt beim Laden und noch einmal danach",
  (MAIN.match(/installFassung\(provider, view, view\.webContents\.getURL\(\)/g) || []).length === 2,
  "beim dom-ready haengen die Klickhorcher des Anbieters manchmal noch nicht");
pruefe("Die Vorwahl steht vor dem Autostart",
  MAIN.indexOf("installFassung(provider, view, view.webContents.getURL());")
  < MAIN.indexOf("resumePendingProviderAutoplay(provider, view);\n  });\n\n  providerViews.set"),
  "der Aufruf setzt die Sperre, auf die der Autostart wartet");
pruefe("Der Autostart wartet auf die Fassung",
  /const fassungBis = fassungWartet\.get\(provider\.id\) \|\| 0;/.test(MAIN)
  && /if \(Date\.now\(\) < fassungBis\) return;/.test(MAIN),
  "sonst laedt er den Hoster der Fassung, die gerade noch dastand");
pruefe("Die Sperre steht nur, wenn es etwas umzustellen gibt",
  /if \(gewuenscht && !optionen\.nachlauf\) fassungWartet\.set/.test(MAIN),
  "ohne gemerkte Fassung gibt es nichts zu verzoegern");
pruefe("Ein 'geklickt' loest die Sperre nicht",
  /if \(!antwort\.startsWith\("geklickt"\)\) fassungWartet\.delete\(provider\.id\);/.test(MAIN));
pruefe("Der Stand ueberschreibt nichts",
  /nurWennNeu: art === "stand"/.test(MAIN),
  "die Vorgabe des Anbieters ist keine Entscheidung");
pruefe("Die Fassung haengt am Titel, nicht an der Adresse",
  /return taste\.titelSchluessel\(eintrag\?\.title \|\| cleanBaseMediaTitle\("", url\)\);/.test(MAIN));
pruefe("Ausgeschaltet wird nichts gemerkt und nichts geklickt",
  (MAIN.match(/if \(settings\.playback\?\.rememberLanguage === false\)/g) || []).length === 2);
pruefe("Von Haus aus ist es an",
  /rememberLanguage: raw\?\.playback\?\.rememberLanguage !== false/.test(MAIN)
  && /rememberLanguage: true,/.test(MAIN));
pruefe("Es gibt einen Weg zurueck",
  /ipcMain\.handle\("fassungen:vergessen"/.test(MAIN)
  && /ipcMain\.handle\("fassungen:stand"/.test(MAIN),
  "eine Vorwahl, die man nicht loeschen kann, ist eine Seite, die sich unerklaerlich verhaelt");

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
