"use strict";
// Die Benachrichtigung ueber neue Folgen.
//
// ELFIX sucht im Hintergrund nach neuen Folgen abgeschlossener Serien und
// setzt newEpisodeAt am Eintrag. Gesagt hat es das bisher nur, solange das
// Fenster offen war - also genau dann nicht, wenn man es braucht.
//
// Zwei Zusagen haengen daran, und beide sind leicht zu verletzen:
//
//   Standardmaessig aus. Eine Meldung, die man nicht bestellt hat, ist eine
//   Stoerung - und eine Einstellung, die man nicht eingeschaltet hat, darf
//   nicht wirken.
//
//   Nur einmal je Fund. newEpisodeAt bleibt am Eintrag stehen, bis der Titel
//   geoeffnet wird. Wuerde von dort gemeldet, kaeme bei jedem Durchlauf
//   dieselbe Meldung wieder - und der Durchlauf laeuft im Takt.
//
// Geprueft wird der echte Quelltext aus main.js, nicht seine Beschreibung.

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const WURZEL = path.join(__dirname, "..");
const QUELLE = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").split("\r\n").join("\n");

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(b); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };

function abschnitt(anfang, ende = "}") {
  const zeilen = QUELLE.split("\n");
  const von = zeilen.findIndex((z) => z.startsWith(anfang));
  if (von < 0) throw new Error("nicht gefunden: " + anfang);
  let bis = von;
  while (bis < zeilen.length && zeilen[bis] !== ende) bis += 1;
  return zeilen.slice(von, bis + 1).join("\n");
}

// Ein Ersatz fuer Electron: die Meldungen landen in einer Liste statt auf dem
// Bildschirm.
function melderBauen({ eingeschaltet, moeglich = true }) {
  const gezeigt = [];
  const protokoll = [];
  class NachbauNotification {
    constructor(werte) { this.werte = werte; this.klicks = []; }
    on(art, fn) { this.klicks.push([art, fn]); }
    show() { gezeigt.push(this.werte); }
    static isSupported() { return moeglich; }
  }
  const umgebung = {
    settings: { notifications: { newEpisodes: eingeschaltet } },
    Notification: NachbauNotification,
    BrowserWindow: { getAllWindows: () => [] },
    cleanTitle: (wert) => String(wert || ""),
    console: { log: (zeile) => protokoll.push(String(zeile)) },
    String, Number, Boolean, Array, Object, Math, Date
  };
  vm.createContext(umgebung);
  vm.runInContext(abschnitt("function meldeNeueFolgen(neue) {"), umgebung);
  vm.runInContext(abschnitt("function zeigeHinweis({ titel, text, favorite }) {"), umgebung);
  return { melden: vm.runInContext("meldeNeueFolgen", umgebung), gezeigt, protokoll };
}

const NEU = (titel, was) => ({ id: titel, title: titel, newEpisodeLabel: was });

// --- Standardmaessig aus -------------------------------------------------------

{
  const aus = melderBauen({ eingeschaltet: false });
  aus.melden([NEU("Bleach", "Folge 15 ist da")]);
  pruefe("Ausgeschaltet wird nichts gemeldet", aus.gezeigt.length === 0, `${aus.gezeigt.length} Meldungen`);
}

pruefe("Die Werkseinstellung ist aus",
  /notifications: \{\s*newEpisodes: false\s*\}/.test(QUELLE));
pruefe("Aus der Ablage zaehlt nur ein ausdrueckliches Ja",
  /newEpisodes: raw\?\.notifications\?\.newEpisodes === true/.test(QUELLE),
  (QUELLE.match(/newEpisodes: raw[^\n]*/) || [""])[0].trim());

// --- Eingeschaltet ------------------------------------------------------------

{
  const an = melderBauen({ eingeschaltet: true });
  an.melden([NEU("Bleach", "Folge 15 ist da")]);
  pruefe("Eingeschaltet kommt genau eine Meldung", an.gezeigt.length === 1, `${an.gezeigt.length}`);
  pruefe("Sie nennt den Titel und was neu ist",
    an.gezeigt[0]?.title === "Bleach" && an.gezeigt[0]?.body === "Folge 15 ist da",
    JSON.stringify(an.gezeigt[0]));
}

// Bei einem Schwall lieber eine Meldung als zehn.
{
  const an = melderBauen({ eingeschaltet: true });
  an.melden([NEU("Bleach", "Folge 15 ist da"), NEU("Naruto", "Staffel 3 ist da"), NEU("Loki", "Folge 2 ist da")]);
  pruefe("Mehrere Funde ergeben eine einzige Meldung", an.gezeigt.length === 1, `${an.gezeigt.length}`);
  pruefe("Sie sagt, wie viele es sind",
    an.gezeigt[0]?.title === "3 neue Folgen", an.gezeigt[0]?.title);
  pruefe("Und nennt die Titel", /Bleach/.test(an.gezeigt[0]?.body || "")
    && /Naruto/.test(an.gezeigt[0]?.body || ""), an.gezeigt[0]?.body);
}

{
  const an = melderBauen({ eingeschaltet: true });
  an.melden(["a", "b", "c", "d", "e"].map((x) => NEU(x, "Folge 2 ist da")));
  pruefe("Bei vielen Funden wird der Rest gezaehlt statt aufgezaehlt",
    /und 2 weitere/.test(an.gezeigt[0]?.body || ""), an.gezeigt[0]?.body);
}

// --- Nichts zu melden ----------------------------------------------------------

{
  const an = melderBauen({ eingeschaltet: true });
  an.melden([]);
  pruefe("Ohne Fund keine Meldung", an.gezeigt.length === 0);
}

// --- Ein System ohne Benachrichtigungen ------------------------------------------

{
  const ohne = melderBauen({ eingeschaltet: true, moeglich: false });
  ohne.melden([NEU("Bleach", "Folge 15 ist da")]);
  pruefe("Kann das System es nicht, wird nichts versucht", ohne.gezeigt.length === 0);
  pruefe("Und es steht im Protokoll",
    ohne.protokoll.some((z) => /nicht moeglich/i.test(z)), ohne.protokoll.join(" | "));
}

// --- Nur einmal je Fund -----------------------------------------------------------
//
// Gemeldet wird die Liste, die der Durchlauf selbst gefuellt hat - nicht das,
// was an den Eintraegen steht. Sonst kaeme dieselbe Meldung im Takt wieder.

// Der Durchlauf selbst liegt seit dem Umzug in nachschub.js - dieselbe Datei,
// die das Telefon fahrt. Die Zusage ist unveraendert: gemeldet wird die Liste,
// die der Lauf gefuellt hat, und nicht das, was an den Eintraegen steht.
const LAUF = fs.readFileSync(path.join(WURZEL, "src/nachschub.js"), "utf8").split("\r\n").join("\n");
pruefe("Der Durchlauf sammelt seine eigenen Funde",
  /const gefunden = \[\];/.test(LAUF) && /gefunden\.push\(favorit\);/.test(LAUF));
pruefe("Gemeldet wird erst nach dem Speichern",
  /saveFavorites\(\);\s*\n\s*sendActiveState\(\);\s*\n\s*meldeNeueFolgen\(ergebnis\.gefunden\);/.test(QUELLE));
pruefe("Und nur diese Liste, nicht die Eintraege mit newEpisodeAt",
  !/meldeNeueFolgen\(favorites/.test(QUELLE));

// --- Der Klick auf die Meldung ------------------------------------------------------

pruefe("Ein Klick holt das Fenster nach vorn",
  /hinweis\.on\("click"[\s\S]{0,400}?fenster\.focus\(\)/.test(QUELLE));
pruefe("Und sagt der Oberflaeche, um welchen Titel es ging",
  /elfix:zeige-favorit/.test(QUELLE));

// --- Windows braucht eine Kennung ------------------------------------------------------
//
// Ohne setAppUserModelId zeigt Windows die Meldung einer Electron-App nicht an
// oder schreibt "electron.app.Elfix" darueber.

pruefe("Die Anwendungskennung wird gesetzt",
  /app\.setAppUserModelId\("com\.rovehd\.elfix"\)/.test(QUELLE));
pruefe("Sie passt zu der aus dem Installationsprogramm",
  JSON.parse(fs.readFileSync(path.join(WURZEL, "package.json"), "utf8")).build.appId === "com.rovehd.elfix");

// --- Eine kaputte Meldung darf den Durchlauf nicht mitreissen -------------------------

// Windows nimmt die Meldung an und liefert sie trotzdem nicht aus, wenn
// Benachrichtigungen dort abgeschaltet sind. Auf dem Rechner, auf dem das hier
// entstanden ist, war genau das der Fall: isSupported() sagte ja, das
// show-Ereignis kam, und Windows meldete HRESULT -2143420140. Ohne einen
// Horcher darauf scheitert es lautlos.
pruefe("Ein Scheitern beim Ausliefern wird protokolliert",
  /hinweis\.on\("failed"/.test(QUELLE));
pruefe("Und nennt die wahrscheinliche Ursache",
  /Windows-Einstellungen/.test(QUELLE));

pruefe("Das Zeigen ist gegen Fehler abgesichert",
  /try \{[\s\S]{0,400}?new Notification\([\s\S]{0,1600}?\} catch/.test(QUELLE));

const gut = pruefungen.filter(Boolean).length;
console.log(`${gut}/${pruefungen.length} bestanden`);
process.exit(gut === pruefungen.length ? 0 : 1);
