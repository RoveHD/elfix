"use strict";
// Die Mediathek und der Zustand, den es nicht geben darf.
//
// Gemeldet war: von Hand abgehakte Titel verschwanden wieder. In der echten
// Ablage standen vierzehn Eintraege mit `completedManually: true` und
// gleichzeitig `completed: false` - von Hand abgehakt, aber nicht
// abgeschlossen. Die Mediathek filtert auf `completed`, also fielen sie heraus;
// und weil `completedManually` stehenblieb, holte sie auch nichts zurueck.
//
// Ursache war favorites:toggle-current: der Handler baut einen vorhandenen
// Eintrag neu zusammen und setzt `completed: false` fest, waehrend
// `completedManually` ueber den Spread aus dem alten Eintrag ueberlebt.

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const WURZEL = path.join(__dirname, "..");
// Der Fortschritt selbst steht seit der Verschiebung in src/fortschritt.js,
// damit Desktop und Android dieselbe Regel benutzen. Fuer die Pruefungen hier
// zaehlen beide Dateien als eine Quelle.
const QUELLE = ["src/main.js", "src/fortschritt.js"]
  .map((datei) => fs.readFileSync(path.join(WURZEL, datei), "utf8").split("\r\n").join("\n"))
  .join("\n");

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

// --- Der Ausgleich, aus main.js herausgeschnitten ---------------------------

function ausgleichBauen() {
  const umgebung = { favorites: [], Date, Boolean, String, Number, Array, Object, console: { log() {} } };
  vm.createContext(umgebung);
  vm.runInContext(abschnitt("function widersprucheGeraderichten("), umgebung);
  return (liste) => ({ geaendert: vm.runInContext("widersprucheGeraderichten", umgebung)(liste), liste });
}
const ausgleich = ausgleichBauen();

const abgehakt = (extra = {}) => ({
  id: "a", title: "Breaking Bad", completed: true, completedManually: true,
  completedAt: "2026-08-16T11:48:37.139Z", hideFromContinueWatching: true, favorite: false, ...extra
});

// Genau der Zustand aus der echten Ablage.
const kaputt = [abgehakt({ completed: false })];
const r1 = ausgleich(kaputt);
pruefe("Von Hand abgehakt ohne completed wird zurueckgeholt",
  r1.geaendert === 1 && kaputt[0].completed === true, JSON.stringify(kaputt[0].completed));
pruefe("Der Titel verschwindet dabei nicht aus Weiterschauen-Sicht",
  kaputt[0].hideFromContinueWatching === true);
pruefe("Ein fehlendes Datum wird nachgetragen", Boolean(kaputt[0].completedAt));

// Ein fehlendes completedAt darf kein Grund sein, nichts zu tun.
const ohneDatum = [abgehakt({ completed: false, completedAt: "" })];
ausgleich(ohneDatum);
pruefe("Auch ohne Datum wird zurueckgeholt",
  ohneDatum[0].completed === true && ohneDatum[0].completedAt !== "");

// Was in Ordnung ist, bleibt unberuehrt.
const heil = [
  abgehakt(),
  { id: "b", title: "Loki", completed: false, completedManually: false },
  { id: "c", title: "Naruto", completed: true, completedManually: false },
  { id: "d", title: "Leer" }
];
const vorher = JSON.stringify(heil);
const r2 = ausgleich(heil);
pruefe("Heile Eintraege werden nicht angefasst", r2.geaendert === 0 && JSON.stringify(heil) === vorher);

// Ein Titel, den neue Folgen zurueckgeholt haben, hat completedManually: false
// - der darf nicht faelschlich in die Mediathek wandern.
const neueFolge = [{ id: "e", title: "One Piece", completed: false, completedManually: false, favorite: true }];
ausgleich(neueFolge);
pruefe("Zurueckgeholte Serien bleiben ausserhalb der Mediathek", neueFolge[0].completed === false);

// --- Die Ursache ------------------------------------------------------------

const toggle = abschnitt('ipcMain.handle("favorites:toggle-current"', "});");
pruefe("Vormerken loescht das Abhaken jetzt vollstaendig",
  /completed: false,\s*\n\s*completedManually: false,\s*\n\s*completedAt: "",/.test(toggle),
  toggle.includes("completedManually: false") ? "completedManually wird mitgeloescht" : "FEHLT");

// Wer in der Ablage sucht, findet den Widerspruch sonst nirgends mehr: jede
// Stelle, die `completed` loescht, muss `completedManually` mitloeschen - sonst
// entsteht derselbe Zustand an anderer Stelle wieder.
// Geprueft werden nur Zuweisungen an einen *vorhandenen* Eintrag. Die
// Vorlagen fuer neue Eintraege ({ completed: false, ... }) koennen den
// Widerspruch nicht erzeugen: dort gibt es noch kein completedManually.
const zeilen = QUELLE.split(String.fromCharCode(10));
const stellen = zeilen
  .map((zeile, i) => ({ zeile: zeile.trim(), nr: i + 1 }))
  .filter((z) => z.zeile === "favorite.completed = false;" || z.zeile === "lokal.completed = false;");
const ohneNachzug = stellen.filter((z) => (
  !/completedManually\s*=\s*false/.test(zeilen.slice(z.nr - 1, z.nr + 6).join(String.fromCharCode(10)))
));
pruefe("Jede Zuweisung completed=false zieht completedManually nach",
  ohneNachzug.length === 0,
  ohneNachzug.length ? "offen in Zeile " + ohneNachzug.map((z) => z.nr).join(", ") : "alle " + stellen.length + " Stellen");

pruefe("Der Ausgleich laeuft vor jedem Schreiben",
  /function saveFavorites\(\) \{[\s\S]{0,200}?widersprucheGeraderichten\(\)/.test(QUELLE));
// Frueher stand hier ein Abstand in Zeichen ("hoechstens 4000 ab dem Anfang der
// Funktion"). Das war ein Hilfsmass fuer die eigentliche Frage - laeuft der
// Ausgleich, bevor die geladene Liste zurueckgeht? - und es ging jedes Mal
// kaputt, wenn ein Eintrag ein Feld dazubekam: der Ausgleich stand dann nicht
// spaeter, die Feldliste darueber war nur laenger. Gemessen wird deshalb, was
// gemeint ist.
{
  const koerper = abschnitt("function loadFavorites() {");
  const ausgleich = koerper.indexOf("widersprucheGeraderichten(geladen)");
  const rueckgabe = koerper.indexOf("return geladen;");
  pruefe("Der Ausgleich laeuft auch beim Laden",
    ausgleich >= 0 && rueckgabe >= 0 && ausgleich < rueckgabe,
    ausgleich < 0 ? "der Aufruf fehlt" : "vor der Rueckgabe");
}

// --- Die Sortierung der Mediathek --------------------------------------------
//
// Vier Ansichten auf dieselben Titel: von Hand gelegt, zuletzt gesehen, A-Z und
// nach Anbieter. Die wichtigste Zusage steht dabei nicht in der Sortierung
// selbst, sondern daneben: keine der drei anderen Ansichten darf die von Hand
// gelegte Reihenfolge anfassen. Wer sie sich einmal gelegt hat, findet sie nach
// einem Ausflug nach A-Z unveraendert wieder vor.
//
// Geprueft wird der echte Quelltext der Oberflaeche.

const RENDERER = fs.readFileSync(path.join(WURZEL, "src/renderer/renderer.js"), "utf8").split("\r\n").join("\n");

function rendererAbschnitt(anfang, ende = "}") {
  const zeilen = RENDERER.split("\n");
  const von = zeilen.findIndex((z) => z.startsWith(anfang));
  if (von < 0) throw new Error("nicht gefunden: " + anfang);
  let bis = von;
  while (bis < zeilen.length && zeilen[bis] !== ende) bis += 1;
  return zeilen.slice(von, bis + 1).join("\n");
}

const sortSand = {
  // Was die Sortierung von aussen braucht: der angezeigte Titel und der
  // Zeitpunkt. Beide kommen aus der Oberflaeche und sind hier nachgestellt,
  // damit die Reihenfolge fuer sich geprueft werden kann.
  displayFavoriteTitle: (favorite) => String(favorite?.title || ""),
  favoriteTimestamp: (favorite) => Number(favorite?.stand || 0),
  Number, String, Array, Math, console
};
vm.createContext(sortSand);
vm.runInContext(rendererAbschnitt("function mediathekSortieren("), sortSand);
const sortieren = vm.runInContext("mediathekSortieren", sortSand);

const SAMMLUNG = [
  { id: "c", title: "Cowboy Bebop", providerName: "S.to", libraryOrder: 2, stand: 300 },
  { id: "a", title: "Attack on Titan", providerName: "Aniworld", libraryOrder: 0, stand: 100 },
  { id: "d", title: "Death Note", providerName: "Filmo", libraryOrder: 1, stand: 500 },
  { id: "b", title: "Bleach", providerName: "Aniworld", libraryOrder: 3, stand: 200 }
];
const reihe = (liste) => liste.map((x) => x.id).join("");

pruefe("Von Hand: die gespeicherte Stelle entscheidet",
  reihe(sortieren(SAMMLUNG, "manuell")) === "adcb", reihe(sortieren(SAMMLUNG, "manuell")));
pruefe("Zuletzt gesehen: das Neueste oben",
  reihe(sortieren(SAMMLUNG, "zuletzt")) === "dcba", reihe(sortieren(SAMMLUNG, "zuletzt")));
pruefe("A-Z: nach Titel",
  reihe(sortieren(SAMMLUNG, "titel")) === "abcd", reihe(sortieren(SAMMLUNG, "titel")));
pruefe("Nach Anbieter: Anbieter zuerst, darin nach Titel",
  reihe(sortieren(SAMMLUNG, "anbieter")) === "abdc",
  sortieren(SAMMLUNG, "anbieter").map((x) => `${x.providerName}/${x.title}`).join(" | "));

// Das Entscheidende: keine Ansicht fasst die Handarbeit an.
{
  const vorher = JSON.stringify(SAMMLUNG);
  for (const art of ["manuell", "zuletzt", "titel", "anbieter"]) sortieren(SAMMLUNG, art);
  pruefe("Keine Ansicht aendert die Eintraege selbst", JSON.stringify(SAMMLUNG) === vorher);
  pruefe("Die urspruengliche Liste bleibt in ihrer Reihenfolge",
    reihe(SAMMLUNG) === "cadb", reihe(SAMMLUNG));
  pruefe("Nach A-Z steht die Handsortierung unveraendert bereit",
    reihe(sortieren(SAMMLUNG, "manuell")) === "adcb", reihe(sortieren(SAMMLUNG, "manuell")));
}

pruefe("Eine unbekannte Sortierung faellt auf die Handarbeit zurueck",
  reihe(sortieren(SAMMLUNG, "zauberei")) === "adcb" && reihe(sortieren(SAMMLUNG)) === "adcb");

// Frisch abgehakte Titel haben noch keine Stelle und gehoeren nach oben, sonst
// gingen sie unten unter.
{
  const frisch = [...SAMMLUNG, { id: "n", title: "Neu", providerName: "S.to", stand: 900 }];
  pruefe("Ohne gespeicherte Stelle steht ein Titel oben",
    reihe(sortieren(frisch, "manuell")).startsWith("n"), reihe(sortieren(frisch, "manuell")));
}

// Umlaute gehoeren an ihre Stelle im Alphabet, nicht ans Ende.
{
  const umlaute = [
    { id: "z", title: "Zorn", stand: 1 },
    { id: "u", title: "Über den Wolken", stand: 2 },
    { id: "a", title: "Alles", stand: 3 }
  ];
  pruefe("A-Z ordnet Umlaute deutsch ein",
    reihe(sortieren(umlaute, "titel")) === "auz", reihe(sortieren(umlaute, "titel")));
}

// --- Und die Oberflaeche haelt sich daran ------------------------------------

pruefe("Gezogen werden darf nur in der Handsortierung",
  /const vonHand = sortierung === "manuell";[\s\S]{0,400}?sortable: vonHand/.test(RENDERER));
pruefe("Das Speichern der Reihenfolge weigert sich in jeder anderen Ansicht",
  /async function mediathekReihenfolgeSpeichern\(\)[\s\S]{0,400}?if \(mediathekSortierung\(\) !== "manuell"\) return;/.test(RENDERER));
pruefe("Der Wechsel der Ansicht schreibt keine Reihenfolge",
  /async function mediathekSortierungSetzen\([\s\S]{0,600}?\n\}/.test(RENDERER)
  && !/async function mediathekSortierungSetzen\([\s\S]{0,600}?reorderLibrary/.test(RENDERER));
pruefe("Die Wahl wird gespeichert und ueberlebt den Neustart",
  /librarySort: sanitizeChoice\(raw\?\.home\?\.librarySort/.test(QUELLE)
  && /librarySort: "manuell"/.test(QUELLE));


// --- Doppelte Eintraege, Datum und Verlauf -----------------------------------
//
// Gemeldet war: "Spider-Man: Brand New Day ist zweimal drin". In der echten
// Ablage standen dafuer zwei Eintraege - einer privat, einer aus der
// Watchparty "Bangus". Das ist so gewollt: jeder Raum fuehrt seinen eigenen
// Fortschritt, und auf der Startseite sind die beiden Reihen getrennt. Die
// Mediathek kannte diese Trennung nicht und zeigte beide nebeneinander.

function rendererAbschnitt(anfang) {
  const zeilen = RENDERER.split("\n");
  const von = zeilen.findIndex((z) => z.startsWith(anfang));
  if (von < 0) throw new Error("nicht gefunden: " + anfang);
  let bis = von;
  while (bis < zeilen.length && zeilen[bis] !== "}") bis += 1;
  return zeilen.slice(von, bis + 1).join("\n");
}

const mediathek = { console, Number, String, Array, Math, Date, Boolean, Object, Set };
vm.createContext(mediathek);
vm.runInContext([
  "function mediathekEntdoppeln",
  "function istBessererMediathekEintrag",
  "function gesehenAm",
  "function datumKurz",
  "function verlaufZeitspanne",
  "function verlaufFolgeStand"
].map(rendererAbschnitt).join("\n\n"), mediathek);

const PRIVAT = { id: "a", normalizedUrl: "https://filmo.to/movies/x", watchpartyRoom: "", libraryOrder: 39, createdAt: "2026-08-14T08:00:00.000Z" };
const RUNDE = { id: "b", normalizedUrl: "https://filmo.to/movies/x", watchpartyRoom: "Bangus", createdAt: "2026-08-20T11:51:00.000Z" };
const ANDERER = { id: "c", normalizedUrl: "https://filmo.to/movies/y", watchpartyRoom: "", createdAt: "2026-08-01T08:00:00.000Z" };

const entdoppelt = mediathek.mediathekEntdoppeln([PRIVAT, RUNDE, ANDERER]);
pruefe("Derselbe Film aus Watchparty und privat steht nur noch einmal da",
  entdoppelt.length === 2, `${entdoppelt.length} statt 3`);
pruefe("Uebrig bleibt der private Eintrag, nicht der aus der Runde",
  entdoppelt.find((e) => e.normalizedUrl === "https://filmo.to/movies/x")?.id === "a");
pruefe("Die Reihenfolge des Eingangs aendert daran nichts",
  mediathek.mediathekEntdoppeln([RUNDE, PRIVAT]).find((e) => e.id === "a") !== undefined);
pruefe("Gibt es den Titel nur aus einer Runde, steht eben der da",
  mediathek.mediathekEntdoppeln([RUNDE]).length === 1
  && mediathek.mediathekEntdoppeln([RUNDE])[0].id === "b");
pruefe("Verschiedene Filme werden nicht zusammengeworfen",
  mediathek.mediathekEntdoppeln([PRIVAT, ANDERER]).length === 2);
pruefe("Entdoppelt wird vor dem Sortieren",
  /return mediathekSortieren\(mediathekEntdoppeln\(sichtbar\), sortierung\);/.test(RENDERER),
  "sonst bestimmt eine Karte die Reihenfolge mit, die gar nicht angezeigt wird");

// Das Datum auf der Karte.
pruefe("Das Datum kommt aus dem Abschluss, nicht aus dem letzten Oeffnen",
  mediathek.gesehenAm({ completedAt: "2026-08-16T11:55:14.522Z", lastWatchedAt: "2026-08-20T09:00:00.000Z" })
    ?.toISOString().startsWith("2026-08-16"));
pruefe("Fehlt der Abschluss, tut es der letzte Fortschritt",
  mediathek.gesehenAm({ lastWatchedAt: "2026-08-14T14:00:45.619Z" })?.toISOString().startsWith("2026-08-14"));
pruefe("Ohne jede Angabe gibt es kein Datum",
  mediathek.gesehenAm({}) === null && mediathek.datumKurz(null) === "");
pruefe("Das Datum steht nur auf den Karten der Mediathek",
  /showWatchedDate: true,/.test(RENDERER)
  && /options\.showWatchedDate \? datumKurz\(gesehenAm\(favorite\)\) : ""/.test(RENDERER));

// --- Der Verlaufs-Kasten in der Mediathek ------------------------------------
//
// Die Rechnung selbst steht in shared/verlauf.js und wird in
// tests/verlauftest.js geprueft. Hier steht nur, dass die Oberflaeche sie
// benutzt - und dass die drei Angaben, die frueher falsch waren, weg sind.

pruefe("Der Kasten rechnet mit dem gemeinsamen Modul",
  /const verlaufModul = globalThis\.ELFIX_VERLAUF;/.test(RENDERER)
  && /verlaufModul\.verlaufBauen\(favorites, favorite, \{ metadaten \}\)/.test(RENDERER));
pruefe("Und die Oberflaeche laedt es auch",
  /<script src="\.\.\/\.\.\/shared\/verlauf\.js"><\/script>/
    .test(fs.readFileSync(path.join(WURZEL, "src/renderer/index.html"), "utf8")));

// Der gemeldete Fall: "4 Mal abgeschlossen" bei einer laufenden Serie.
pruefe("\"X Mal abgeschlossen\" steht nirgends mehr",
  !/Mal abgeschlossen/.test(RENDERER),
  "eine laufende Serie wird nicht mehrfach abgeschlossen, nur mehrfach eingeholt");
pruefe("Der Kasten zaehlt keine Abschluesse mehr",
  !/function abschlussListe/.test(RENDERER) && !/function verlaufTage\(/.test(RENDERER));
pruefe("Das rohe Ereignisprotokoll wird nicht mehr Zeile fuer Zeile gezeigt",
  !/function verlaufListe\(/.test(RENDERER));
pruefe("Der Kasten bleibt der Kasten - ohne Abbrechen und mehrzeilig",
  /nurSchliessen: true/.test(RENDERER) && /mehrzeilig: true/.test(RENDERER));
// Bei einer Serie zaehlen Folgen und nicht Ereignisse - sonst oeffnete sich
// der Punkt schon, wenn sich der Player bei derselben Folge zweimal gemeldet
// hat. Bei einem Film gibt es keine Folgen, und "mehr als eine" war fuer ihn
// nie erfuellbar: an der echten Ablage gemessen fehlte der Punkt dadurch bei
// neunundzwanzig von achtundvierzig Titeln der Mediathek.
pruefe("Der Menuepunkt unterscheidet Serie und Film",
  /verlaufModell\.istSerie[\s\S]{0,120}folgen\?\.length \|\| 0\) > 1[\s\S]{0,80}tage \|\| 0\) > 0/.test(RENDERER),
  "Serie: mehr als eine Folge. Film: mindestens ein Tag");

{
  // Und dieselbe Regel an gerechneten Modellen, nicht nur am Quelltext.
  const verlaufModul = require(path.join(WURZEL, "shared/verlauf.js"));
  const lohnt = (favoriten, favorite) => {
    const m = verlaufModul.verlaufBauen(favoriten, favorite, {});
    return m ? (m.istSerie ? m.folgen.length > 1 : m.tage > 0) : false;
  };
  const heute = "2026-08-20T20:00:00.000Z";
  const film = {
    id: "f1", title: "Ein Film", type: "film", completed: true,
    url: "https://filmo.example/film/ein-film",
    activity: [{ at: heute, url: "https://filmo.example/film/ein-film", label: "Abgeschlossen" }]
  };
  pruefe("Ein gesehener Film bekommt den Punkt", lohnt([film], film));

  const nurGeoeffnet = {
    id: "f2", title: "Nur aufgemacht", type: "film", completed: true,
    url: "https://filmo.example/film/nie-gesehen",
    activity: [{ at: heute, url: "https://filmo.example/film/nie-gesehen", label: "Geöffnet" }]
  };
  pruefe("Ein nur geoeffneter Film bekommt ihn nicht", !lohnt([nurGeoeffnet], nurGeoeffnet),
    "eine offene Seite ist keine Wiedergabe");

  const eineFolge = {
    id: "s1", title: "Serie", type: "serie", completed: true,
    url: "https://aniworld.example/anime/stream/serie/staffel-1/episode-1",
    completedEpisodes: [{ season: 1, episode: 1, completedAt: heute }]
  };
  pruefe("Eine Serie mit einer einzigen Folge bekommt ihn nicht", !lohnt([eineFolge], eineFolge),
    "das Datum steht schon auf der Karte");

  const zweiFolgen = {
    ...eineFolge,
    completedEpisodes: [
      { season: 1, episode: 1, completedAt: heute },
      { season: 1, episode: 2, completedAt: "2026-08-21T20:00:00.000Z" }
    ]
  };
  pruefe("Eine Serie mit zwei Folgen bekommt ihn", lohnt([zweiFolgen], zweiFolgen));
}

// Wie eine Folgenzeile aussieht.
pruefe("Eine abgeschlossene Folge sagt genau das",
  mediathek.verlaufFolgeStand({ abgeschlossen: true, position: 800, dauer: 1400 }) === "Abgeschlossen",
  "die Stelle spielt dann keine Rolle mehr");
pruefe("Eine halb gesehene Folge nennt Stelle und Laufzeit",
  mediathek.verlaufFolgeStand({ abgeschlossen: false, position: 761, dauer: 1450 }) === "12:41 von 24:10",
  mediathek.verlaufFolgeStand({ abgeschlossen: false, position: 761, dauer: 1450 }));
pruefe("Ohne Stelle wird nichts behauptet",
  mediathek.verlaufFolgeStand({ abgeschlossen: false, position: 0, dauer: 0 }) === "Angesehen");
pruefe("Lange Folgen bekommen ihre Stunde",
  mediathek.verlaufZeitspanne(3761) === "1:02:41", mediathek.verlaufZeitspanne(3761));

// Das Abschlussereignis ohne Folgenangabe war die Quelle der falschen Zaehlung.
pruefe("Eine Serie schreibt keine generische Abschlusszeile mehr",
  /if \(entry\.completed && !warBereitsAbgeschlossen && !identity\) \{\n\s*appendMediaActivity\(entry, url, "Abgeschlossen"\);/.test(QUELLE),
  "nur noch Filme und YouTube - dort ist \"abgeschlossen\" eindeutig");
pruefe("Die letzte Folge einer Serie wird als Folge vermerkt",
  /if \(mediaEnded && identity && wholeItemCompleted\) \{\n\s*appendCompletedEpisode\(entry, identity, url, now\);/.test(QUELLE),
  "sonst fehlt genau die Folge, um die es ging");

// Ohne diese Regel blieb "Abbrechen" im Verlaufs-Kasten stehen: eine
// allgemeine .is-hidden-Regel gibt es in dieser Datei nicht.
const STIL = fs.readFileSync(path.join(WURZEL, "src/renderer/styles.css"), "utf8");
pruefe("Der Kasten kann seinen Abbrechen-Knopf wirklich ausblenden",
  /\.confirm-actions button\.is-hidden \{\s*display: none;/.test(STIL));
// Der Kasten ist derselbe wie bei jeder Rueckfrage - bleibt ein Merker
// stehen, steht die naechste Loeschabfrage ohne Abbrechen da.
pruefe("Beide Merker werden bei jedem Aufruf neu gesetzt",
  /confirmCopy\.classList\.toggle\("is-mehrzeilig", Boolean\(mehrzeilig\)\);/.test(RENDERER)
  && /confirmCancel\.classList\.toggle\("is-hidden", Boolean\(nurSchliessen\)\);/.test(RENDERER));

// --- Die geteilten Module im Namensraum der Oberflaeche -----------------------
//
// Der teuerste Fehler dieser Ecke, und einer, den keine der Pruefungen oben
// sehen konnte.
//
// Die Oberflaeche laedt shared/bildausschnitt.js und shared/verlauf.js als
// gewoehnliche <script>-Elemente. Klassische Skripte teilen sich *einen*
// globalen Namensraum. Beide Dateien schlossen mit `const schnittstelle = {...}`,
// und die zweite brach damit ab:
//
//   SyntaxError: Identifier 'schnittstelle' has already been declared
//
// Nicht die Zeile - die ganze Datei. shared/verlauf.js wurde nie ausgefuehrt,
// globalThis.ELFIX_VERLAUF blieb undefiniert, verlaufModellBauen() gab null
// zurueck, und in der Mediathek fehlte bei jedem einzelnen Titel der
// Menuepunkt "Verlauf ansehen".
//
// Alle Pruefungen liefen dabei gruen, denn sie laden dieselben Dateien mit
// require() - als CommonJS, wo jede Datei ihren eigenen Namensraum hat. Genau
// diese Luecke schliesst der Block hier: die Dateien werden so ausgefuehrt, wie
// die Oberflaeche sie laedt, hintereinander in einem Kontext.
//
// Die zweite Kollision war stiller und waere nach dem Beheben der ersten erst
// aufgewacht: `zahl` heisst in beiden Dateien so und bedeutet nicht dasselbe -
// zahl(wert, ersatz) beim Bildausschnitt, zahl(wert) mit Abrunden im Verlauf.
// Wer zuletzt geladen wird, gewinnt, und der andere rechnet ab da falsch.
const GETEILT_IN_DER_OBERFLAECHE = (() => {
  const html = fs.readFileSync(path.join(WURZEL, "src/renderer/index.html"), "utf8");
  return [...html.matchAll(/<script\s+src="\.\.\/\.\.\/(shared\/[\w.-]+\.js)"/g)].map((t) => t[1]);
})();

pruefe("Die Oberflaeche laedt ueberhaupt geteilte Module",
  GETEILT_IN_DER_OBERFLAECHE.length >= 2, GETEILT_IN_DER_OBERFLAECHE.join(", "));

{
  // Ein Kontext, alle Dateien nacheinander - dieselbe Reihenfolge wie im HTML.
  const namensraum = { console, URL, TextEncoder, TextDecoder };
  namensraum.globalThis = namensraum;
  const kontext = vm.createContext(namensraum);
  let bruch = "";
  for (const datei of GETEILT_IN_DER_OBERFLAECHE) {
    try {
      vm.runInContext(fs.readFileSync(path.join(WURZEL, datei), "utf8"), kontext,
        { filename: datei });
    } catch (fehler) {
      bruch = `${datei}: ${fehler.message}`;
      break;
    }
  }
  pruefe("Die geteilten Module vertragen sich in einem Namensraum",
    bruch === "", bruch || "keine Kollision");

  // Und sie liefern danach wirklich, was die Oberflaeche von ihnen erwartet.
  pruefe("Nach dem Laden steht ELFIX_VERLAUF bereit",
    typeof namensraum.ELFIX_VERLAUF === "object" && namensraum.ELFIX_VERLAUF !== null
      && typeof namensraum.ELFIX_VERLAUF.verlaufBauen === "function",
    typeof namensraum.ELFIX_VERLAUF);
  pruefe("Und ELFIX_BILDAUSSCHNITT ebenfalls",
    typeof namensraum.ELFIX_BILDAUSSCHNITT === "object" && namensraum.ELFIX_BILDAUSSCHNITT !== null,
    typeof namensraum.ELFIX_BILDAUSSCHNITT);
}

{
  // Kein Name auf oberster Ebene darf zweimal vergeben sein - auch keiner, den
  // JavaScript stillschweigend ueberschreiben wuerde (Funktionen tun das).
  const vergeben = new Map();
  const doppelt = [];
  for (const datei of GETEILT_IN_DER_OBERFLAECHE) {
    const text = fs.readFileSync(path.join(WURZEL, datei), "utf8");
    for (const treffer of text.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      const name = treffer[1];
      if (vergeben.has(name) && vergeben.get(name) !== datei) {
        doppelt.push(`${name} (${vergeben.get(name)} und ${datei})`);
      }
      vergeben.set(name, datei);
    }
  }
  pruefe("Kein Name auf oberster Ebene ist zweimal vergeben",
    doppelt.length === 0, doppelt.length ? doppelt.join("; ") : `${vergeben.size} Namen geprueft`);
}

const gut = pruefungen.filter(Boolean).length;
console.log(`${gut}/${pruefungen.length} bestanden`);
process.exit(gut === pruefungen.length ? 0 : 1);
