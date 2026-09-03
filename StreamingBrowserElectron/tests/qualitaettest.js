"use strict";
// Die beste Bildstufe beim Hoster.
//
// Zwei Haelften. Zuerst die Auswahl selbst: aus dem, was ein Player anbietet,
// die hoechste echte Stufe herausfinden - "Auto" ist keine. Dann das Skript,
// das die Wahl in den Player traegt; das wird ausgefuehrt und nicht bloss
// gelesen. Ob ein Skript den Player wirklich findet und ob es ihn spaeter in
// Ruhe laesst, sieht man einem Quelltext nicht an.

const vm = require("vm");
const {
  hoechsteStufe, anzeigeWegraeumen, qualitaetScript, ANZEIGE_KENNUNG, ANZEIGE_HOECHSTENS
} = require("../src/voe-qualitaet");

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

// Das Anzeigefeld von VOE, so weit das Skript es anfasst: ein Text, der
// Aenderungen meldet (echte MutationObserver-Batches sind Mikrotasks; hier
// genuegt synchron), und ein Stil, der ein "!important" annimmt.
function feldBauen(text) {
  const stil = { werte: {} };
  stil.setProperty = (name, wert) => { stil.werte[name] = wert; };
  const wachen = [];
  let inhalt = text;
  const feld = {
    style: stil,
    _wachen: wachen,
    get textContent() { return inhalt; },
    set textContent(neu) {
      if (neu === inhalt) return;
      inhalt = neu;
      wachen.slice().forEach((fn) => fn());
    }
  };
  return feld;
}

// Ein Dokument mit genau dem Ausschnitt an MutationObserver, den das Skript
// braucht: ein Beobachter je Feld, der abschaltbar ist. Kein jsdom - die
// Probe soll ohne node_modules laufen.
function dokumentMit(felder) {
  return {
    getElementById: (kennung) => (felder && felder[kennung]) || null,
    defaultView: {
      MutationObserver: function (callback) {
        let aktiv = false;
        this.observe = (ziel) => {
          aktiv = true;
          if (ziel && ziel._wachen) ziel._wachen.push(() => { if (aktiv) callback(); });
        };
        this.disconnect = () => { aktiv = false; };
      }
    }
  };
}

function buehneBauen(anfangsStufen, felder) {
  let stufen = anfangsStufen;
  const gesetzt = [];
  const horcher = {};
  const jw = {
    getQualityLevels: () => stufen,
    setCurrentQuality: (i) => { gesetzt.push(i); },
    on: (name, fn) => { horcher[name] = fn; }
  };
  const kontext = {
    window: { jwplayer: () => jw },
    document: felder === undefined ? undefined : dokumentMit(felder)
  };
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

// --- Die Anzeige, die der Player stehen laesst -------------------------------
//
// Gemessen am 2026-09-03 im laufenden VOE-Player: nach `setCurrentQuality`
// steht "Quality: 1080p" in `#QualityText` und verschwindet nie wieder von
// selbst. Geprueft wird deshalb beides - dass es weggeraeumt wird, und dass
// ein Feld, dessen Text erst spaeter ankommt, auch noch erwischt wird.

// Der Fall aus dem Player: das Feld steht schon da, wenn gesetzt wird.
const feld = feldBauen("Quality: 1080p");
const mitFeld = buehneBauen(wieBeiVoe, { [ANZEIGE_KENNUNG]: feld });
mitFeld.lauf();
pruefe("Die stehengebliebene Anzeige wird geleert",
  feld.textContent === "",
  `text="${feld.textContent}"`);
pruefe("Und zusaetzlich verborgen, solange das haelt",
  feld.style.werte.display === "none",
  `display=${feld.style.werte.display}`);

// Der gemessene Fall: VOE schreibt den Stil des Feldes als ganzen Block neu
// und wischt das Verbergen dabei weg. Der leere Text muss das ueberleben -
// daran haengt, ob im Bild etwas steht.
pruefe("Wenn der Player den Stil zurueckschreibt, bleibt das Feld leer",
  (() => {
    feld.style.werte.display = "block";
    return feld.textContent === "";
  })(),
  "ein leeres Feld ist unsichtbar, auch wenn es display:block traegt");

// Der echte Ablauf: VOE schreibt den Text erst, wenn der Wechsel wirklich
// greift - Sekunden spaeter, nicht Millisekunden. Ein Zeitfenster deckt das
// nicht ab; ein Beobachter auf dem Feld selbst schon.
const spaet = feldBauen("");
const mitSpaetemFeld = buehneBauen(wieBeiVoe, { [ANZEIGE_KENNUNG]: spaet });
mitSpaetemFeld.lauf();
spaet.style.werte.display = "block";
spaet.textContent = "Quality: 1080p";
pruefe("Auch ein Text, der erst nach dem Umschalten ankommt, wird erwischt",
  spaet.textContent === "",
  "sonst greift man auf ein Feld zu, das noch leer ist");

// Ein spaeterer Wechsel von Hand traegt eine andere Stufe im Text - der
// Beobachter erkennt daran, dass er nicht mehr seine eigene Ansage sieht.
spaet.textContent = "Quality: 720p";
pruefe("Ein Wechsel von Hand behaelt seine Anzeige",
  spaet.textContent === "Quality: 720p",
  "der Beobachter kennt nur die Stufe, die er selbst gesetzt hat");

// Der Deckel: ein Feld, das sich staendig wehrt, gewinnt den Streit nach
// endlich vielen Runden - kein Beobachter, der fuer immer mitlaeuft.
const streit = feldBauen("");
const streitDok = dokumentMit({ [ANZEIGE_KENNUNG]: streit });
anzeigeWegraeumen(streitDok, ANZEIGE_KENNUNG, "1080p", 3);
for (let i = 0; i < 5; i += 1) streit.textContent = "Quality: 1080p";
pruefe("Nach dem Deckel gewinnt ein Feld, das sich staendig wehrt",
  streit.textContent === "Quality: 1080p",
  `nach 5 Schreibvorgaengen: text="${streit.textContent}"`);

// Die Wahl selbst darf davon nichts merken.
pruefe("Die Stufe wird trotzdem gesetzt",
  mitFeld.gesetzt.length === 1 && mitFeld.gesetzt[0] === 1,
  mitFeld.gesetzt.join(","));

// Und die Umgebungen, in denen es das Feld gar nicht gibt.
pruefe("Ohne Dokument passiert nichts",
  String(anzeigeWegraeumen(null, ANZEIGE_KENNUNG, "1080p", 20)) === "kein-dokument",
  "das Skript geht in alle Frames");
pruefe("Ohne Stufenname passiert nichts",
  String(anzeigeWegraeumen(dokumentMit({}), ANZEIGE_KENNUNG, "", 20)) === "keine-stufe");
let ohneFeldAntwort = "wirft";
try {
  ohneFeldAntwort = String(anzeigeWegraeumen(
    { getElementById: () => null, defaultView: {} }, ANZEIGE_KENNUNG, "1080p", 20));
} catch {
  ohneFeldAntwort = "wirft";
}
pruefe("Ein Player ohne dieses Feld bringt nichts zum Absturz",
  ohneFeldAntwort !== "wirft",
  ohneFeldAntwort);
const ohneFeld = buehneBauen(wieBeiVoe, {});
ohneFeld.lauf();
pruefe("Ein Player ohne diese Anzeige setzt die Stufe trotzdem",
  ohneFeld.gesetzt.length === 1,
  ohneFeld.gesetzt.join(","));

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`
${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
