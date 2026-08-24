"use strict";
// Das Titelbild - und der Weg, auf dem es aufs Telefon kommt.
//
// Die Bildsuche stand als Textblock mitten in main.js. Dort war sie nur am
// Rechner zu haben, und genau deshalb trugen die Karten der APK Buchstaben
// statt Bilder. Sie liegt jetzt in src/seitendaten.js und wird von beiden
// Geraeten benutzt - vom Rechner ueber executeJavaScript, vom Telefon ueber
// den Kern.
//
// Dass sie dort ankommt, haengt an drei Dingen, und jedes davon faellt still
// aus, wenn es kaputtgeht:
//
//   1. Das Skript laeuft ohne Electron und ohne Node. Ein `require`, ein
//      `process` oder sonst etwas aus dem Hauptprozess, und im WebView des
//      Telefons kaeme nur ein Fehler zurueck - die Karte bliebe bei ihren
//      Buchstaben, ohne dass irgendwo etwas rot wuerde.
//   2. main.js benutzt wirklich das Modul und nicht wieder eine eigene Kopie.
//      Zwei Bildsuchen waeren zwei Programme, und das eine bliebe stehen.
//   3. Die Datei faehrt in den Assets mit. Steht sie nicht in kernModule,
//      findet der Kern sie auf dem Geraet nicht.
//
// Ausgefuehrt wird das Skript hier wirklich, in einem nackten Kontext mit
// einer knappen Seite darin - so knapp, wie ein WebView sie mindestens
// hergibt.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..");
const seitendaten = require(path.join(WURZEL, "src/seitendaten.js"));
const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8");
const GRADLE = fs.readFileSync(path.join(WURZEL, "..", "android/app/build.gradle"), "utf8");

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}

/**
 * Eine Seite, so knapp wie moeglich.
 *
 * Nur was das Skript wirklich anfasst: ein paar Knoten zum Fragen und leere
 * Listen fuer alles Uebrige. Was hier fehlt, faellt dem Skript vor die Fuesse -
 * und das ist der Sinn der Sache: es soll mit dem auskommen, was jeder Browser
 * hat.
 */
function seiteBauen({ ogBild = "", titel = "", adresse = "https://beispiel.tv/serie/stream/testserie/staffel-1/episode-2" } = {}) {
  const knoten = (attribute) => ({
    getAttribute: (name) => (name in attribute ? attribute[name] : null),
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    textContent: "",
    tagName: "DIV"
  });
  const ziel = new URL(adresse);
  const dokument = {
    title: titel,
    images: [],
    body: { innerText: "" },
    querySelector(auswahl) {
      if (auswahl.includes("og:image")) {
        return ogBild ? knoten({ content: ogBild }) : null;
      }
      if (auswahl.includes("icon")) return knoten({ href: "/favicon.ico" });
      return null;
    },
    querySelectorAll: () => []
  };
  return {
    document: dokument,
    location: { href: ziel.href, hostname: ziel.hostname, pathname: ziel.pathname },
    innerWidth: 1280,
    innerHeight: 800,
    getComputedStyle: () => ({ backgroundImage: "" }),
    URL,
    Number,
    Math,
    JSON,
    console
  };
}

const skript = seitendaten.seitenSkript();

pruefe("Das Skript kommt als Quelltext heraus", typeof skript === "string" && skript.length > 1000,
  `${typeof skript}, ${String(skript).length} Zeichen`);

// 1. Laeuft es ohne Electron und ohne Node?
let ergebnis = null;
let fehler = null;
try {
  ergebnis = vm.runInNewContext(skript, vm.createContext(seiteBauen({
    ogBild: "https://beispiel.tv/bilder/testserie-abc123.jpg",
    titel: "Testserie - Staffel 1 Folge 2"
  })));
} catch (ausnahme) {
  fehler = ausnahme;
}
pruefe("Es laeuft in einem nackten Kontext - so wie im WebView", !fehler, fehler && fehler.message);
pruefe("Es liefert ein Titelbild", ergebnis && ergebnis.thumbnail
  === "https://beispiel.tv/bilder/testserie-abc123.jpg",
  ergebnis && JSON.stringify(ergebnis.thumbnail));
pruefe("Es liefert Titel und Art dazu", ergebnis && ergebnis.title === "Testserie - Staffel 1 Folge 2"
  && ergebnis.type === "serie", ergebnis && `${ergebnis.title} / ${ergebnis.type}`);

// Eine Seite ohne Bild darf keins erfinden - ein falsches waere schlimmer.
let ohneBild = null;
try {
  ohneBild = vm.runInNewContext(skript, vm.createContext(seiteBauen({ titel: "Testserie" })));
} catch (ausnahme) {
  ohneBild = { thumbnail: "abgestuerzt: " + ausnahme.message };
}
pruefe("Ohne Bild auf der Seite bleibt das Feld leer", ohneBild && ohneBild.thumbnail === "",
  ohneBild && JSON.stringify(ohneBild.thumbnail));

// Auf S.to zaehlt allein das Poster neben der Beschreibung. Das og:image ist
// dort das Bild der Seite und nicht das der Serie - es hier zu nehmen, hiesse
// jeder Folge dasselbe Bild zu geben.
let beiSto = null;
try {
  beiSto = vm.runInNewContext(skript, vm.createContext(seiteBauen({
    adresse: "https://s.to/serie/stream/testserie/staffel-1/episode-2",
    ogBild: "https://s.to/public/img/og-image.jpg",
    titel: "Testserie"
  })));
} catch (ausnahme) {
  beiSto = { thumbnail: "abgestuerzt: " + ausnahme.message };
}
pruefe("S.to nimmt das og:image der Seite nicht als Titelbild", beiSto && beiSto.thumbnail === "",
  beiSto && JSON.stringify(beiSto.thumbnail));

// 2. Benutzt der Rechner das Modul - oder wieder eine eigene Kopie?
pruefe("main.js holt das Skript aus dem Modul",
  /require\("\.\/seitendaten"\)/.test(MAIN) && MAIN.includes("seitendaten.seitenSkript()"));
pruefe("und traegt die Bildsuche nicht ein zweites Mal",
  !MAIN.includes("meta[property='og:image'], meta[name='twitter:image']"));

// 3. Faehrt die Datei in den Assets mit?
pruefe("seitendaten.js steht in kernModule und faehrt aufs Telefon mit",
  GRADLE.includes('"src/seitendaten.js"'));

const bestanden = pruefungen.filter(Boolean).length;
console.log(`${bestanden}/${pruefungen.length} bestanden`);
process.exit(bestanden === pruefungen.length ? 0 : 1);
