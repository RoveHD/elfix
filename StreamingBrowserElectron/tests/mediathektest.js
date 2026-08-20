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
pruefe("Der Ausgleich laeuft auch beim Laden",
  /function loadFavorites\(\)[\s\S]{0,4000}?widersprucheGeraderichten\(geladen\)/.test(QUELLE));

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

const mediathek = { console };
vm.createContext(mediathek);
// NUR_GEOEFFNET ist eine Konstante, keine Funktion - rendererAbschnitt() holt
// nur Funktionen, deshalb kommt sie hier einzeln dazu.
const NUR_GEOEFFNET_QUELLE = (RENDERER.match(/^const NUR_GEOEFFNET = .*$/m) || [""])[0];
vm.runInContext([
  NUR_GEOEFFNET_QUELLE,
  ...[
    "function mediathekEntdoppeln",
    "function istBessererMediathekEintrag",
    "function istAbschluss",
    "function verlaufListe",
    "function abschlussListe",
    "function verlaufTage",
    "function gesehenAm",
    "function datumKurz"
  ].map(rendererAbschnitt)
].join("\n\n"), mediathek);

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

// Der Verlauf im Menue.
const VERLAUF = {
  activity: [
    { at: "2026-08-16T17:14:51.972Z", label: "Geöffnet" },
    { at: "2026-08-16T17:39:39.397Z", label: "Staffel 2 Folge 9" },
    { at: "2026-08-16T17:43:22.511Z", label: "Staffel 2 Folge 10" },
    { at: "2026-08-18T20:01:00.000Z", label: "Staffel 2 Folge 11" },
    { at: "kaputt", label: "Unsinn" }
  ]
};
const liste = mediathek.verlaufListe(VERLAUF);
pruefe("Der Verlauf laesst \"Geoeffnet\" weg - das sagt nichts ueber Geschautes",
  liste.length === 3 && !liste.some((e) => /geöffnet/i.test(e.label)),
  liste.map((e) => e.label).join(", "));
// Der gemeldete Fall: ein dreimal geoeffneter Film stand als "3 Mal
// geschaut" da. Das Label heisst bei Filmen "Film geöffnet", nicht
// "Geöffnet" - der erste Filter traf es deshalb nicht.
const NUR_AUF = { completedAt: "2026-08-16T11:55:14.522Z", activity: [
  { at: "2026-08-16T13:49:00.000Z", label: "Film geöffnet" },
  { at: "2026-08-16T22:06:00.000Z", label: "Film geöffnet" },
  { at: "2026-08-17T11:07:00.000Z", label: "Film geöffnet" }
] };
pruefe("Dreimal geoeffnet ist nicht dreimal geschaut",
  mediathek.verlaufListe(NUR_AUF).length === 0,
  `${mediathek.verlaufListe(NUR_AUF).length} statt 0`);
pruefe("Gezaehlt wird der Abschluss - und den gibt es hier genau einmal",
  mediathek.abschlussListe(NUR_AUF).length === 1);
pruefe("Der Abschluss kommt aus completedAt, wenn er nicht aufgezeichnet wurde",
  mediathek.abschlussListe(NUR_AUF)[0].zeit.toISOString().startsWith("2026-08-16"));
pruefe("Ein aufgezeichneter Abschluss wird nicht doppelt gezaehlt",
  mediathek.abschlussListe({
    completedAt: "2026-08-16T11:55:14.522Z",
    activity: [{ at: "2026-08-16T11:55:20.000Z", label: "Abgeschlossen" }]
  }).length === 1);
pruefe("Zweimal wirklich durchgeschaut zaehlt zweimal",
  mediathek.abschlussListe({
    completedAt: "2026-08-20T10:00:00.000Z",
    activity: [
      { at: "2026-08-16T11:55:20.000Z", label: "Abgeschlossen" },
      { at: "2026-08-20T10:00:05.000Z", label: "Abgeschlossen" }
    ]
  }).length === 2);
pruefe("Ohne Abschluss bleibt die Zaehlung bei null",
  mediathek.abschlussListe({ activity: [{ at: "2026-08-16T11:00:00.000Z", label: "Staffel 1 Folge 1" }] }).length === 0);

pruefe("Kaputte Zeitangaben fliegen raus", !liste.some((e) => Number.isNaN(e.zeit.getTime())));
pruefe("Neueste zuerst", liste[0].label === "Staffel 2 Folge 11");
pruefe("Gezaehlt werden Tage, nicht Folgen",
  mediathek.verlaufTage(liste) === 2, `${mediathek.verlaufTage(liste)} Tage bei 3 Eintraegen`);
pruefe("Ohne Verlauf bleibt die Liste leer",
  mediathek.verlaufListe({}).length === 0 && mediathek.verlaufListe({ activity: "kein Array" }).length === 0);
pruefe("Der Menuepunkt erscheint nur, wo es mehr als den einen Abschluss gibt",
  /verlauf\.length > 1 \|\| abschlussListe\(favorite\)\.length > 1/.test(RENDERER));
pruefe("Der Kasten zaehlt Abschluesse, nicht Oeffnungen",
  /Mal abgeschlossen/.test(RENDERER)
  && /nurSchliessen: true/.test(RENDERER) && /mehrzeilig: true/.test(RENDERER));
// Damit die Zaehlung kuenftig nicht mehr auf completedAt angewiesen ist.
pruefe("Der Abschluss wird beim Uebergang aufgezeichnet",
  /const warBereitsAbgeschlossen = Boolean\(existing\?\.completed\);/.test(QUELLE)
  && /if \(entry\.completed && !warBereitsAbgeschlossen\) \{\n\s*appendMediaActivity\(entry, url, "Abgeschlossen"\);/.test(QUELLE));
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

const gut = pruefungen.filter(Boolean).length;
console.log(`${gut}/${pruefungen.length} bestanden`);
process.exit(gut === pruefungen.length ? 0 : 1);
