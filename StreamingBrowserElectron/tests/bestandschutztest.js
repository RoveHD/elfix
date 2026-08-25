"use strict";
// Was einen Bestand kostet.
//
// Am 25.08.2026 um 22:20:15 verschwanden 67 Eintraege in derselben Sekunde -
// Mediathek, Weiterschauen, Verlauf. Nicht durch einen Absturz und nicht durch
// einen Handgriff: durch zwei Regeln, die einzeln vertretbar aussahen und
// zusammen einen Bestand ausloeschten.
//
//   1. Der Watchparty-Aufraeumer loeschte den *ganzen* Eintrag, sobald ein
//      Favorit einen Raum trug, dem dieses Geraet gerade nicht beigetreten war.
//      "Ich bin in dieser Runde nicht mehr dabei" heisst aber nicht, dass es
//      den Titel nie gab.
//   2. Der Geraeteabgleich uebergeht raumgebundene Favoriten (ihr Stand gehoert
//      der Runde) - und leitete zugleich aus dem, was in seiner Liste *fehlt*,
//      ab, was hier geloescht wurde. Zurueckgehalten sah damit aus wie
//      weggeworfen, und der Grabstein ging an alle Geraete.
//
// Dazu die dritte Regel, die aus derselben Nacht stammt: die letzte Staffel
// einer Serie wurde aus allen "/staffel-N"-Links der Seite gebildet, auch aus
// denen fremder Serien in der Randspalte. Korra hat vier Buecher und stand auf
// Staffel 16; nach der letzten Folge zaehlte die Regel auf Staffel 5 Folge 1
// weiter - eine Folge, die es nicht gibt.
//
// Diese Pruefung haelt alle drei fest. Sie prueft nicht, ob etwas "richtig
// aussieht", sondern ob ein Bestand eine Runde ueberlebt, die endet.

const fs = require("fs");
const path = require("path");
const geraeteStand = require("../src/geraete-stand");
const seitendaten = require("../src/seitendaten");

const MAIN = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8").replace(/\r/g, "");

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}

/* ===================== 1. Der Aufraeumer loescht nicht mehr ================ */

// Gelesen wird der Quelltext, weil die Funktion am Zustand von main.js haengt
// und sich nicht einzeln aufrufen laesst. Das reicht fuer die eine Frage, um
// die es geht: verschwindet hier ein Eintrag oder nur eine Bindung?
const aufraeumer = MAIN.slice(
  MAIN.indexOf("function raeumeWatchpartyEintraegeAuf()"),
  MAIN.indexOf("function lokalerWatchpartyEintrag(")
);

pruefe("1a. Der Aufraeumer kennt den Aufraeumer-Fall ueberhaupt noch",
  aufraeumer.length > 200 && aufraeumer.includes("watchpartyRoom"),
  "sonst prueft hier nichts mehr");
pruefe("1b. Er loest die Bindung, statt den Eintrag zu loeschen",
  aufraeumer.includes('favorite.watchpartyRoom = ""'),
  "was jemand gesehen hat, gehoert ihm und nicht dem Raum");
pruefe("1c. Und er schreibt die Favoritenliste nicht mehr neu",
  !/favorites\s*=\s*behalten/.test(aufraeumer),
  "genau diese Zuweisung hat den Bestand gekostet");
pruefe("1d. Der fremde Fortschritt geht mit der Bindung",
  aufraeumer.includes('favorite.watchpartyFrom = ""'),
  "sonst steht auf der Karte weiter, wer da angeblich schaut");

/* ============ 2. Zurueckgehalten ist nicht geloescht ====================== */

const favoriten = [
  { id: "a", title: "Bleach", url: "https://aniworld.to/anime/stream/bleach", type: "serie" },
  { id: "b", title: "Game of Thrones", url: "https://s.to/serie/stream/game-of-thrones", type: "serie", watchpartyRoom: "Bangus" },
  { id: "c", title: "Breaking Bad", url: "https://s.to/serie/stream/breaking-bad", type: "serie", watchpartyRoom: "Bangus" }
];

const abgeglichen = geraeteStand.staende(favoriten).map((s) => s.key);
const zurueck = geraeteStand.zurueckgehalten(favoriten);

pruefe("2a. Raumgebundene Titel werden weiter zurueckgehalten",
  abgeglichen.length === 1 && abgeglichen[0] === "serie:bleach",
  JSON.stringify(abgeglichen));
pruefe("2b. Aber sie sind benennbar - und damit keine Loeschung",
  zurueck.length === 2 && zurueck.includes("serie:gameofthrones")
    && zurueck.includes("serie:breakingbad"),
  JSON.stringify(zurueck));
pruefe("2c. Ohne Raum steht nichts auf dieser Liste",
  geraeteStand.zurueckgehalten([favoriten[0]]).length === 0);
pruefe("2d. Und eine leere Ablage ergibt eine leere Liste",
  geraeteStand.zurueckgehalten([]).length === 0
    && geraeteStand.zurueckgehalten(null).length === 0);

// Der Abgleich muss sie auch wirklich bekommen - eine Auskunft, die niemand
// abholt, haette den Bestand nicht gerettet.
pruefe("2e. main.js reicht sie an den Abgleich weiter",
  MAIN.includes("geraete.abgleichen(geraeteStaende(), geraeteZurueckgehalten())"),
  "sonst gehen die Grabsteine weiter hinaus");

const geraeteQuelle = fs.readFileSync(path.join(__dirname, "..", "src", "geraete.js"), "utf8");
pruefe("2f. Und der Abgleich laesst sie beim Grabsteinen aus",
  geraeteQuelle.includes("zurueck.has(id)"),
  "das ist die Zeile, an der zurueckgehalten und geloescht auseinandergehen");

const brueckeQuelle = fs.readFileSync(
  path.join(__dirname, "..", "..", "android/app/src/main/assets/kern/eigen/geraete-bruecke.js"), "utf8");
pruefe("2g. Android reicht sie genauso weiter",
  brueckeQuelle.includes("geraeteStand.zurueckgehalten(favoriten)"),
  "sonst loescht das Telefon, was der Rechner gerade gerettet hat");

/* ================== 3. Die letzte Staffel ist die eigene ================== */

const KORRA = "die-legende-von-korra";
const staffel = seitendaten.staffelAusPfad;

pruefe("3a. Eine Staffel der eigenen Serie zaehlt",
  staffel("/serie/stream/die-legende-von-korra/staffel-4", KORRA) === 4);
pruefe("3b. Auch mit Folge dahinter",
  staffel("/serie/stream/die-legende-von-korra/staffel-3/episode-2", KORRA) === 3);
pruefe("3c. Die Staffel einer fremden Serie nicht",
  staffel("/anime/stream/bleach/staffel-16", KORRA) === 0,
  "genau dieser Nachbarlink hat Korra auf 16 Staffeln gebracht");
pruefe("3d. Ein Link ohne Staffel ist keine Staffel",
  staffel("/serie/stream/die-legende-von-korra", KORRA) === 0
    && staffel("/", KORRA) === 0
    && staffel("", KORRA) === 0);
pruefe("3e. Ohne bekannten Slug zaehlt nur, was selbst einen traegt",
  staffel("/serie/stream/irgendwas/staffel-2", "") === 2
    && staffel("/staffel-9", "") === 0,
  "lieber nichts zaehlen als die Staffelzahl einer fremden Serie erben");
pruefe("3f. Die englische Schreibweise ebenso",
  staffel("/serie/stream/die-legende-von-korra/season-2", KORRA) === 2);

const skript = seitendaten.seitenSkript();
pruefe("3g. Das Seitenskript benutzt genau diese Regel",
  skript.includes("function staffelAusPfad") && skript.includes("staffelAusPfad("),
  "eine zweite Fassung im Skript waere die naechste falsche Staffelzahl");

// Und die Rechnung darueber: aus den Zahlen wird das Maximum. Mit der Regel
// bleibt Korra bei vier.
const seiteLinks = [
  "/serie/stream/die-legende-von-korra/staffel-1",
  "/serie/stream/die-legende-von-korra/staffel-2",
  "/serie/stream/die-legende-von-korra/staffel-3",
  "/serie/stream/die-legende-von-korra/staffel-4/episode-13",
  "/anime/stream/bleach/staffel-16",
  "/serie/stream/game-of-thrones/staffel-8"
];
const gezaehlt = seiteLinks.map((pfad) => staffel(pfad, KORRA)).filter((n) => n > 0);
pruefe("3h. Eine Korra-Seite mit fremden Nachbarlinks ergibt vier Staffeln",
  Math.max(0, ...gezaehlt) === 4,
  `gezaehlt: ${JSON.stringify(gezaehlt)}`);

/* ========= 4. Die naechste Folge faellt nicht beim Aufmachen heraus ======= */

// Der dritte Weg, auf dem ein Titel aus "Weiterschauen" verschwindet, und der
// leiseste: Folge zu Ende, naechste aufgemacht, nichts gelaufen - und weg.
const fortschritt = require("../src/fortschritt");

function nachOeffnen(stelle) {
  // Ein Eintrag, der auf der naechsten Folge steht und dort noch nichts
  // gesehen hat, so wie ihn der Wechsel hinterlaesst.
  const eintrag = {
    id: "aot",
    title: "Attack on Titan",
    url: "https://s.to/serie/stream/attack-on-titan/staffel-3/episode-22",
    type: "serie",
    season: 3,
    episode: 22,
    currentTime: stelle,
    position: stelle,
    duration: stelle > 0 ? 1435 : 0,
    progress: 0,
    continuePending: true,
    completedEpisodes: [{ season: 3, episode: 21 }]
  };
  return eintrag;
}

pruefe("4a. Frisch gewechselt steht die Folge in Weiterschauen",
  fortschritt.hasContinueProgressRecord(nachOeffnen(0)) === true);
pruefe("4b. Ohne den Merker und ohne Fortschritt waere sie weg",
  fortschritt.hasContinueProgressRecord(
    Object.assign(nachOeffnen(0), { continuePending: false })) === false,
  "genau dieser Zustand hat Attack on Titan aus der Liste genommen");
pruefe("4c. Sobald wirklich etwas laeuft, traegt der Fortschritt sie",
  fortschritt.hasContinueProgressRecord(
    Object.assign(nachOeffnen(240), { continuePending: false })) === true);

const fortschrittQuelle = fs.readFileSync(path.join(__dirname, "..", "src", "fortschritt.js"), "utf8");
pruefe("4d. Der Merker faellt erst weg, wenn etwas gelaufen ist",
  fortschrittQuelle.includes("entry.continuePending = Boolean(entry.continuePending) && !etwasGelaufen"),
  "das blosse Oeffnen einer Folge darf ihn nicht loeschen");

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
