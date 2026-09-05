"use strict";
// Der Direktbetrieb: die Anbieterseite bleibt unsichtbar.
//
// Das ist eine Zusage, die man nicht "meistens" einhalten kann. Es genuegt ein
// Weg, auf dem die Seite doch eingehaengt wird oder auf dem der Player
// zurueck auf sie verweist, und der Zuschauer sitzt wieder vor der
// Werbeschicht, der er entkommen wollte.
//
// Geprueft wird deshalb der Quelltext selbst: wo eine Ansicht eingehaengt
// wird, was nach einer Navigation geschieht, was der Player im Fehlerfall
// anbietet - und dass es fuer all das einen Schalter gibt, der beides kann.
//
// Was hier *nicht* geprueft wird: ob es hinterher wirklich gut aussieht. Das
// kann nur ein Blick in die laufende App.

const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..");
const lies = (datei) => fs.readFileSync(path.join(WURZEL, datei), "utf8");

const haupt = lies("src/main.js");
const spielerSkript = lies("src/renderer/spieler.js");
const spielerSeite = lies("src/renderer/spieler.html");
const oberflaeche = lies("src/renderer/renderer.js");
const seite = lies("src/renderer/index.html");

const pruefungen = [];
const pruefe = (name, bedingung, detail = "") => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

/* --------------------------------------------------- Die Ansicht bleibt weg */

// Es gibt genau vier Stellen, an denen ueberhaupt eine Ansicht eingehaengt
// wird: die Anbieteransicht, ihre Rueckkehr aus einem Overlay, der
// Ladevorhang und der eigene Player. Die ersten beiden gehoeren der
// Anbieterseite - und beide muessen den Direktbetrieb kennen.
const anbieterAnhaengen = [...haupt.matchAll(/[^\n]*contentView\.addChildView\((\w+)\)[^\n]*/g)]
  .map((treffer) => treffer[0]);
pruefe("Es gibt nicht mehr Stellen zum Einhaengen als bekannt",
  anbieterAnhaengen.length === 4,
  String(anbieterAnhaengen.length));

const navigation = haupt.slice(haupt.indexOf("async function navigateProvider"));
const navBereich = navigation.slice(0, navigation.indexOf("\n}\n"));
pruefe("Die Anbieteransicht wird im Direktbetrieb nicht eingehaengt",
  /overlayReasons\.size === 0 && !direktModus\(target\)/.test(navBereich),
  "sonst liegt die Seite sichtbar im Fenster");
pruefe("Nach jeder Navigation uebernimmt der Direktbetrieb",
  navBereich.includes("if (direktModus(target)) direktUebernehmen(provider, target)"),
  "sonst bliebe eine leere Flaeche stehen");
// YouTube ist ausgenommen: dort gehoert der Player zur Seite - Vorschlaege,
// Kommentare, die eigene Runde, das Ueberspringen bezahlter Einschuebe. Sie zu
// verstecken hiesse, YouTube abzuschaffen.
pruefe("YouTube bleibt sichtbar",
  /function direktModus\(adresse = ""\)[\s\S]{0,320}youtube\.istYoutubeUrl\(adresse\)/.test(haupt),
  "der Direktbetrieb entscheidet an der Adresse, nicht nur am Schalter");

const rueckkehr = haupt.slice(haupt.indexOf("function restoreActiveViewAfterOverlay"));
pruefe("Auch nach einem Overlay kommt sie nicht zurueck",
  rueckkehr.slice(0, 500).includes("direktModus(activeView.webContents.getURL())"),
  "Einstellungen zumachen darf die Seite nicht hervorholen");

/* ------------------------------------------------- Der Weg fuehrt nicht zurueck */

pruefe("Der Player bietet keinen Weg auf die Anbieterseite mehr an",
  !/Beim Hoster öffnen/.test(spielerSeite) && !/anbieterseite/i.test(spielerSeite),
  "der Ausweg aus einer kaputten Quelle ist ein anderer Hoster, nicht die Seite");
pruefe("Im Fehlerfall fuehrt der Knopf in die Folgenliste",
  /zurueckZumHoster.*\n?.*addEventListener[\s\S]{0,120}folgenZeigen\(\)/.test(spielerSkript),
  "dort steht auch die Hosterwahl");
pruefe("Ist der Player zu, kommt die eigene Oberflaeche",
  haupt.includes('if (direktModus()) direktZurueckZurOberflaeche("")'),
  "hinter ihm liegt nur noch eine Werkbank");
pruefe("Und die Oberflaeche hoert darauf",
  oberflaeche.includes("api.onShowHome?.(()"),
  "sonst bliebe der leere Bereich stehen");

/* ------------------------------------------------------- Drei sichtbare Enden */

const uebernahme = haupt.slice(haupt.indexOf("async function direktUebernehmen"));
const uebernahmeBereich = uebernahme.slice(0, uebernahme.indexOf("\n}\n"));
pruefe("Eine Folge wird gespielt",
  uebernahmeBereich.includes("direktFolgeSpielen(provider, url)"));
// Ein Film hat keine Folgennummer, nur eine Seite mit Hostern darauf. Ginge
// die Entscheidung ueber die Adresse, landete er bei "keine Folge gefunden".
pruefe("Ein Film auch - entschieden wird an den Hosterkacheln",
  uebernahmeBereich.includes("const links = await direktLinksLesen(provider, view);")
  && uebernahmeBereich.indexOf("direktLinksLesen") < uebernahmeBereich.indexOf("folgenlisteLesen"),
  "nicht an der Adresse");
pruefe("Eine Serie wird zur Auswahl",
  uebernahmeBereich.includes("direktAuswahlOeffnen(provider, url)"));
pruefe("Alles andere endet in der eigenen Oberflaeche",
  uebernahmeBereich.includes("direktZurueckZurOberflaeche("),
  "Startseite, Katalog und Suche des Anbieters haben hier nichts zu suchen");
pruefe("Und waehrend der Aufloesung steht der Player schon da",
  uebernahmeBereich.includes("{ laden: true }")
  && spielerSkript.includes("if (auftrag.laden)"),
  "sonst waere die Flaeche sekundenlang leer und stumm");

/* --------------------------------------------------------------- Der Vorhang */

pruefe("Der Ladevorhang der Anbieterseite bleibt im Direktbetrieb aus",
  /async function beginAutostart[\s\S]{0,900}?if \(direktModus\([\s\S]{0,120}?\)\) return;/.test(haupt),
  "er wartet auf Wiedergabe in einer Ansicht, in der nichts mehr laeuft");

/* ---------------------------------------------------------- Der Schalter */

pruefe("Der Direktbetrieb ist von Haus aus an",
  haupt.includes("direktModus: raw?.playback?.direktModus !== false")
  && haupt.includes("direktModus: true"));
pruefe("Er laesst sich in den Einstellungen abschalten",
  seite.includes('id="direktModus"')
  && oberflaeche.includes('direktModus?.addEventListener("change", saveSettings)')
  && oberflaeche.includes("direktModus: direktModus ? direktModus.checked"),
  "wer die Anbieterseite doch sehen will, soll sie sehen duerfen");
pruefe("Und dann kommt auch der Direkt-Knopf wieder",
  oberflaeche.includes('.toggle("is-hidden", !aufSeite || settings.playback?.direktModus !== false)'),
  "im Direktbetrieb waere er ein zweiter Weg zu dem, was ohnehin laeuft");

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`
${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
