"use strict";
// Die beste Bildstufe beim Hoster.
//
// Zwei Haelften. Zuerst die Auswahl selbst: aus dem, was ein Player anbietet,
// die hoechste echte Stufe herausfinden - "Auto" ist keine. Dann das Skript,
// das die Wahl in den Player traegt; das wird ausgefuehrt und nicht bloss
// gelesen. Ob ein Skript den Player wirklich findet und ob es ihn spaeter in
// Ruhe laesst, sieht man einem Quelltext nicht an.

const vm = require("vm");
const { hoechsteStufe, qualitaetScript } = require("../src/voe-qualitaet");

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}

// --- Die Auswahl ------------------------------------------------------------

const wieBeiVoe = [
  { label: "Auto" },
  { label: "1080p", height: 1080 },
  { label: "720p", height: 720 },
  { label: "480p", height: 480 }
];

pruefe("Aus der Liste von VOE faellt die Wahl auf 1080p",
  hoechsteStufe(wieBeiVoe) === 1,
  String(hoechsteStufe(wieBeiVoe)));

pruefe("\"Auto\" wird nie gewaehlt",
  hoechsteStufe([{ label: "Auto", height: 1080 }, { label: "720p", height: 720 }]) === 1,
  "Auto ist keine Qualitaet, sondern der Verzicht auf die Wahl");

pruefe("Die Reihenfolge in der Liste spielt keine Rolle",
  hoechsteStufe([
    { label: "Auto" }, { label: "480p", height: 480 },
    { label: "1080p", height: 1080 }, { label: "720p", height: 720 }
  ]) === 2,
  "manche Player zaehlen von unten");

pruefe("Ohne Hoehe zaehlt die Beschriftung",
  hoechsteStufe([{ label: "Auto" }, { label: "720p" }, { label: "1080p" }]) === 2);

pruefe("Ohne beides zaehlt die Bitrate",
  hoechsteStufe([
    { label: "Auto" }, { label: "hoch", bitrate: 5000000 }, { label: "niedrig", bitrate: 800000 }
  ]) === 1);

pruefe("Bei nur einer Stufe gibt es nichts zu waehlen",
  hoechsteStufe([{ label: "1080p", height: 1080 }]) === -1,
  "dann bleibt alles, wie es ist");

pruefe("Eine leere oder fehlende Liste ergibt keine Wahl",
  hoechsteStufe([]) === -1 && hoechsteStufe(null) === -1 && hoechsteStufe(undefined) === -1);

pruefe("Eine Liste nur aus Auto ergibt keine Wahl",
  hoechsteStufe([{ label: "Auto" }, { label: "auto" }]) === -1);

// --- Das Skript im Player ---------------------------------------------------

function buehneBauen(anfangsStufen) {
  let stufen = anfangsStufen;
  const gesetzt = [];
  const horcher = {};
  const jw = {
    getQualityLevels: () => stufen,
    setCurrentQuality: (i) => { gesetzt.push(i); },
    on: (name, fn) => { horcher[name] = fn; }
  };
  const kontext = { window: { jwplayer: () => jw } };
  vm.createContext(kontext);
  return {
    gesetzt,
    horcher,
    stufenSetzen: (neu) => { stufen = neu; },
    lauf: () => vm.runInContext(qualitaetScript(), kontext)
  };
}

// Vor dem Manifest kennt der Player nur "Auto" - oder noch gar nichts.
const buehne = buehneBauen([]);
const ersteAntwort = buehne.lauf();
pruefe("Vor dem Manifest wird nichts gesetzt",
  ersteAntwort === "noch-keine-stufen" && buehne.gesetzt.length === 0,
  ersteAntwort);
pruefe("Das Skript haengt sich an die Ereignisse des Players",
  typeof buehne.horcher.levels === "function" && typeof buehne.horcher.playlistItem === "function",
  "sonst bliebe es bei dem einen Versuch vor dem Manifest");

// Jetzt steht das Manifest.
buehne.stufenSetzen(wieBeiVoe);
buehne.horcher.levels();
pruefe("Sobald die Stufen dastehen, wird die hoechste gesetzt",
  buehne.gesetzt.length === 1 && buehne.gesetzt[0] === 1,
  buehne.gesetzt.join(","));

// Der Punkt, an dem ein Skript unhoeflich wuerde.
buehne.horcher.levels();
buehne.horcher.levels();
pruefe("Danach greift es nicht mehr ein",
  buehne.gesetzt.length === 1,
  "wer von Hand auf 720p geht, hat einen Grund dafuer");

// Eine neue Folge faengt wieder oben an.
buehne.horcher.playlistItem();
buehne.horcher.levels();
pruefe("Die naechste Folge faengt wieder bei der hoechsten Stufe an",
  buehne.gesetzt.length === 2 && buehne.gesetzt[1] === 1,
  buehne.gesetzt.join(","));

// Ein zweiter Durchlauf des Skripts darf nichts doppeln.
const nochmal = buehne.lauf();
pruefe("Ein erneutes Einspielen richtet nicht neu ein",
  buehne.gesetzt.length === 2,
  nochmal);

// --- Wo kein Player ist -----------------------------------------------------

const ohnePlayer = { window: {} };
vm.createContext(ohnePlayer);
pruefe("Ohne Player tut das Skript nichts",
  vm.runInContext(qualitaetScript(), ohnePlayer) === "kein-player",
  "es geht in alle Frames - im Dokument von AniWorld gibt es keinen");

const fremderPlayer = { window: { jwplayer: () => ({}) } };
vm.createContext(fremderPlayer);
pruefe("Und auch nicht bei einem Player ohne Stufenliste",
  vm.runInContext(qualitaetScript(), fremderPlayer) === "kein-player");

const sperrig = {
  window: {
    jwplayer: () => ({
      getQualityLevels: () => { throw new Error("noch nicht so weit"); },
      setCurrentQuality: () => {},
      on: () => {}
    })
  }
};
vm.createContext(sperrig);
pruefe("Ein Player, der die Liste verweigert, bringt nichts zum Absturz",
  vm.runInContext(qualitaetScript(), sperrig) === "keine-liste");

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
