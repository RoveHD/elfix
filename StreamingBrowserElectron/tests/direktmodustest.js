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

// Eine Ansicht wird nur an bekannten Stellen eingehaengt. Kommt eine neue
// hinzu, faellt sie hier auf - und zwar mit Namen, nicht als Zahl. Genau das
// ist der Fall, in dem die Anbieterseite unbemerkt wieder sichtbar wuerde.
//
// Erlaubt sind fuenf, und jede aus einem eigenen Grund:
//   navigateProvider            die Anbieterseite - nur ausserhalb des Direktbetriebs
//   restoreActiveViewAfterOverlay  dieselbe nach einem Overlay - ebenso
//   raiseAutostartCurtain       der Ladevorhang
//   direktSpielerOeffnen        der eigene Player
//   menschentorLoesenLassen     die Abfrage des Wachdienstes, samt Rueckkehr
//                               des Players darueber
const zeilen = haupt.split("\n");
const einhaengeStellen = new Set();
zeilen.forEach((zeile, nummer) => {
  if (!zeile.includes("contentView.addChildView(")) return;
  for (let lauf = nummer; lauf >= 0; lauf -= 1) {
    const treffer = /^(?:async )?function (\w+)\(/.exec(zeilen[lauf]);
    if (treffer) {
      einhaengeStellen.add(treffer[1]);
      return;
    }
  }
  einhaengeStellen.add(`unbekannt:${nummer + 1}`);
});
const erlaubt = ["navigateProvider", "restoreActiveViewAfterOverlay", "raiseAutostartCurtain",
  "direktSpielerOeffnen", "menschentorLoesenLassen"];
const fremde = [...einhaengeStellen].filter((name) => !erlaubt.includes(name));
pruefe("Eine Ansicht wird nur an bekannten Stellen eingehaengt",
  fremde.length === 0,
  fremde.join(", ") || [...einhaengeStellen].join(", "));

const navigation = haupt.slice(haupt.indexOf("async function navigateProvider"));
const navBereich = navigation.slice(0, navigation.indexOf("\n}\n"));
pruefe("Die Anbieteransicht wird im Direktbetrieb nicht eingehaengt",
  /overlayReasons\.size === 0 && !direktModus\(target\)/.test(navBereich),
  "sonst liegt die Seite sichtbar im Fenster");
pruefe("Nach jeder Navigation uebernimmt der Direktbetrieb",
  /if \(direktModus\(target\)\) \{\s*\n\s*direktUebernehmen\(provider, target, signal\)/.test(navBereich),
  "sonst bliebe eine leere Flaeche stehen");
// Und sie laedt die Seite selbst - hier zu laden hiesse, sie zweimal zu laden:
// unmittelbar nach loadURL nennt getURL() noch die alte Adresse.
pruefe("Geladen wird die Seite genau einmal",
  navBereich.indexOf("direktUebernehmen(provider, target, signal)") < navBereich.indexOf("view.webContents.loadURL(target)"),
  "die Werkbank laedt, nicht die Navigation davor");
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
// Die gelesenen Kacheln gehen mit hinein: die Seite wird nur einmal gelesen.
// Ohne das las die zweite Runde eine Seite, vor der inzwischen der Player
// liegt - und meldete "Kein Hoster auf der Seite", obwohl zwoelf dastanden.
pruefe("Eine Folge wird gespielt",
  uebernahmeBereich.includes("direktFolgeSpielen(provider, url, { links, signal })"));
// Ein Film hat keine Folgennummer, nur eine Seite mit Hostern darauf. Ginge
// die Entscheidung ueber die Adresse, landete er bei "keine Folge gefunden".
pruefe("Ein Film auch - entschieden wird an den Hosterkacheln",
  uebernahmeBereich.includes("const links = await werkbankLesen(provider, url, (view) => direktLinksLesen(provider, view)")
  && uebernahmeBereich.indexOf("direktLinksLesen") < uebernahmeBereich.indexOf("folgenlisteLesen"),
  "nicht an der Adresse");
pruefe("Eine Serie wird zur Auswahl",
  uebernahmeBereich.includes("direktAuswahlOeffnen(provider, url, { signal })"));
pruefe("Alles andere endet in der eigenen Oberflaeche",
  uebernahmeBereich.includes("direktZurueckZurOberflaeche("),
  "Startseite, Katalog und Suche des Anbieters haben hier nichts zu suchen");
pruefe("Und waehrend der Aufloesung steht der Player schon da",
  uebernahmeBereich.includes("{ laden: true, signal }")
  && spielerSkript.includes("if (auftrag.laden)"),
  "sonst waere die Flaeche sekundenlang leer und stumm");

/* --------------------------------------------------------------- Der Vorhang */

pruefe("Der Ladevorhang der Anbieterseite bleibt im Direktbetrieb aus",
  /async function beginAutostart[\s\S]{0,900}?if \(direktModus\([\s\S]{0,120}?\)\) return;/.test(haupt),
  "er wartet auf Wiedergabe in einer Ansicht, in der nichts mehr laeuft");

/* ------------------------------------------------------- Die eine Ausnahme */

// Fragt der Wachdienst des Anbieters, ob ein Mensch davorsitzt, muss man die
// Frage sehen koennen - niemand setzt ein Haekchen, das er nicht sieht. Danach
// verschwindet sie wieder, und der Player kommt zurueck nach oben.
pruefe("Eine Bestaetigungsabfrage wird sichtbar gemacht",
  haupt.includes("async function menschentorLoesenLassen")
  && haupt.includes("Der Anbieter fragt nach einer Bestätigung"),
  "sonst endet jede Cloudflare-Abfrage als 'kein Hoster auf der Seite'");
pruefe("Erkannt wird sie am Inhalt, nicht an der Adresse",
  /function menschentorErkennen[\s\S]{0,700}challenges\.cloudflare\.com/.test(haupt),
  "die Abfrage kommt unter derselben Adresse zurueck, die man angefragt hat");
pruefe("Danach liegt der Player wieder oben",
  /menschentorLoesenLassen[\s\S]{0,1400}addChildView\(spielerView\)/.test(haupt));
pruefe("Und jede Werkbankseite geht durch diese Pruefung",
  /async function werkbankAn[\s\S]{0,900}?menschentorErkennen\(view\)/.test(haupt),
  "nicht nur der erste Aufruf");

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
  oberflaeche.includes('#direktButton")?.classList.toggle("is-hidden", !aufSeite || direkt)'),
  "im Direktbetrieb waere er ein zweiter Weg zu dem, was ohnehin laeuft");
// Zurueck, Vor, Neu laden und Stop bedienen die Anbieterseite. Ist keine zu
// sehen, ist ein solcher Knopf ein Versprechen ohne Deckung - auf YouTube
// dagegen bleibt alles, wie es war.
pruefe("Die Knoepfe fuer die Seite verschwinden mit ihr",
  /for \(const auswahl of \["#backButton", "#forwardButton", "#reloadButton"\]\)[\s\S]{0,160}toggle\("is-hidden", direkt\)/.test(oberflaeche));
pruefe("Auf YouTube bleiben sie",
  oberflaeche.includes("settings.playback?.direktModus !== false && !aufYoutubeSeite()"),
  "dort gehoert der Player zur Seite");

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`
${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
