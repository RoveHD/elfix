"use strict";
// Ein Anbieter zieht um.
//
// Das Heikle daran ist nicht das Ersetzen, sondern das Nicht-Ersetzen. Der
// Umzug geht durch jeden Eintrag der Watchlist, durch jede abgehakte Folge und
// durch jede Verlaufszeile; was er zu viel anfasst, faellt erst auf, wenn sich
// etwas nicht mehr oeffnen laesst - und dann ist die alte Adresse nirgends mehr
// nachzuschlagen.
//
// Deshalb prueft die Haelfte hier, was gleich bleibt.

const fs = require("fs");
const path = require("path");
const umzug = require("../src/umzug");

const WURZEL = path.join(__dirname, "..");
const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").replace(/\r/g, "");

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}

const ALT = "s.to";
const NEU = "http://186.2.175.5";
// Wie im Hauptprozess: der Vergleichsschluessel wird gerechnet, nicht mitgezogen.
const normalisieren = (url) => String(url || "").toLowerCase().replace(/\/+$/, "");

// --- Taugt der Umzug ueberhaupt? ---------------------------------------------

pruefe("Von einer Domain auf eine IP",
  umzug.pruefen("https://s.to/", "http://186.2.175.5/").ok);
pruefe("Und wieder zurueck",
  umzug.pruefen("http://186.2.175.5/", "https://s.to/").ok);
pruefe("Von http auf https ist auch ein Umzug",
  umzug.pruefen("http://s.to/", "https://s.to/").ok,
  "derselbe Wirt, andere Wurzel - die Adressen aendern sich trotzdem");
pruefe("Dieselbe Adresse ist keiner",
  umzug.pruefen("https://s.to/", "https://s.to/suche").grund === "Das ist dieselbe Adresse");
pruefe("Unsinn ist keine Adresse",
  !umzug.pruefen("https://s.to/", "gar keine adresse").ok
  && !umzug.pruefen("https://s.to/", "").ok);
pruefe("Und ein anderes Schema auch nicht",
  !umzug.pruefen("https://s.to/", "ftp://s.to/").ok,
  "daraus wuerde sonst https://ftp://s.to - ein gueltiges Gebilde mit dem Wirt \"ftp\"");
pruefe("Ein Wirt ohne Punkt ist keiner",
  !umzug.pruefen("https://s.to/", "sto").ok
  && !umzug.pruefen("https://s.to/", "http://localhost").ok,
  "ein Vertipper zoege die ganze Watchlist auf einen Wirt, den es nicht gibt");
pruefe("Eine IP mit Port geht",
  umzug.pruefen("https://s.to/", "http://186.2.175.5:8080/").ok
  && umzug.pruefen("https://s.to/", "http://186.2.175.5:8080/").nachWurzel === "http://186.2.175.5:8080");

// --- Eine einzelne Adresse ----------------------------------------------------

pruefe("Der Wirt wird ersetzt, der Pfad bleibt",
  umzug.adresse("https://s.to/serie/stream/dark/staffel-1/episode-2", ALT, NEU)
  === "http://186.2.175.5/serie/stream/dark/staffel-1/episode-2");
pruefe("Abfrage und Anker bleiben ebenfalls",
  umzug.adresse("https://s.to/suche?term=dark#treffer", ALT, NEU)
  === "http://186.2.175.5/suche?term=dark#treffer");
pruefe("Ein alter Wirt in der Abfrage bleibt stehen",
  umzug.adresse("https://s.to/weiter?ziel=https://s.to/x", ALT, NEU)
  === "http://186.2.175.5/weiter?ziel=https://s.to/x",
  "deshalb wird geparst und nicht ersetzt - eine Textersetzung truege ihn mit um");
pruefe("Ein fremder Wirt bleibt unangetastet",
  umzug.adresse("https://aniworld.to/anime/stream/x", ALT, NEU) === "",
  "leer heisst: dieser Eintrag geht den Umzug nichts an");
pruefe("Ein Bild auf einem fremden Server bleibt, wo es ist",
  umzug.adresse("https://cdn.example.com/bild.jpg", ALT, NEU) === "");
pruefe("Eine Data-URL wird nicht angefasst",
  umzug.adresse("data:image/png;base64,AAAA", ALT, NEU) === "",
  "das eigene Bild liegt so vor und hat mit Wirten nichts zu tun");
pruefe("Ein Unterwirt ist ein anderer Wirt",
  umzug.adresse("https://cdn.s.to/bild.jpg", ALT, NEU) === "",
  "wer alles mitnimmt, was hinten passt, nimmt zu viel mit");
pruefe("Leeres bleibt leer",
  umzug.adresse("", ALT, NEU) === "" && umzug.adresse(null, ALT, NEU) === "");

// --- Der Anbieter selbst -------------------------------------------------------

{
  const { anbieter, geaendert } = umzug.anbieter({
    id: "sto", name: "S.to",
    startUrl: "https://s.to/",
    searchUrl: "https://s.to/suche?term={query}",
    lastUrl: "https://s.to/serie/stream/dark"
  }, ALT, NEU);
  pruefe("Die Startseite zieht um",
    anbieter.startUrl === "http://186.2.175.5/");
  pruefe("Die zuletzt geoeffnete Seite auch",
    anbieter.lastUrl === "http://186.2.175.5/serie/stream/dark");
  pruefe("Und die Such-Adresse behaelt ihren Platzhalter",
    anbieter.searchUrl === "http://186.2.175.5/suche?term={query}",
    anbieter.searchUrl);
  pruefe("Drei Felder, drei Aenderungen",
    geaendert === 3, String(geaendert));
  pruefe("Der Name bleibt",
    anbieter.name === "S.to",
    "die Adresse hat sich geaendert, nicht der Anbieter");
}

// --- Ein Eintrag der Watchlist -------------------------------------------------

function eintrag(zusatz = {}) {
  return {
    id: "f1", providerId: "sto", title: "Dark",
    url: "https://s.to/serie/stream/dark/staffel-1/episode-2",
    normalizedUrl: "https://s.to/serie/stream/dark/staffel-1/episode-2",
    thumbnail: "https://s.to/bilder/dark.jpg",
    favicon: "https://s.to/favicon.ico",
    customThumbnail: "data:image/png;base64,AAAA",
    completedEpisodes: [
      { key: "dark:s1:e1", season: 1, episode: 1, url: "https://s.to/serie/stream/dark/staffel-1/episode-1" }
    ],
    activity: [{ at: "2026-08-01T20:00:00.000Z", url: "https://s.to/serie/stream/dark/staffel-1/episode-1", label: "Folge 1" }],
    ...zusatz
  };
}

{
  const { favorit, geaendert } = umzug.favorit(eintrag(), ALT, NEU, normalisieren);
  pruefe("Die Adresse des Eintrags zieht um",
    favorit.url === "http://186.2.175.5/serie/stream/dark/staffel-1/episode-2");
  pruefe("Der Vergleichsschluessel wird neu gerechnet",
    favorit.normalizedUrl === normalisieren(favorit.url),
    "er ist eine Ableitung der Adresse und keine zweite Adresse");
  pruefe("Das Vorschaubild zieht mit",
    favorit.thumbnail === "http://186.2.175.5/bilder/dark.jpg",
    "sonst waere die Watchlist nach dem Umzug eine Wand aus grauen Kacheln");
  pruefe("Das Favicon auch",
    favorit.favicon === "http://186.2.175.5/favicon.ico");
  pruefe("Abgehakte Folgen ziehen mit",
    favorit.completedEpisodes[0].url === "http://186.2.175.5/serie/stream/dark/staffel-1/episode-1");
  pruefe("Der Schluessel der abgehakten Folge bleibt",
    favorit.completedEpisodes[0].key === "dark:s1:e1",
    "an ihm haengt, was als gesehen gilt - er ist keine Adresse");
  pruefe("Der Verlauf zieht mit",
    favorit.activity[0].url === "http://186.2.175.5/serie/stream/dark/staffel-1/episode-1");
  pruefe("Das eigene Bild bleibt unangetastet",
    favorit.customThumbnail === "data:image/png;base64,AAAA");
  pruefe("Der Titel bleibt",
    favorit.title === "Dark");
  pruefe("Gezaehlt wird jedes Feld einzeln",
    geaendert === 5,
    "Adresse, Bild, Favicon, eine abgehakte Folge, eine Verlaufszeile - der"
    + " Vergleichsschluessel zaehlt nicht mit, er wird gerechnet");
}

{
  const fremd = eintrag({
    id: "f2", providerId: "aniworld",
    url: "https://aniworld.to/anime/stream/one-piece/staffel-1/episode-1",
    thumbnail: "https://aniworld.to/bild.jpg",
    favicon: "",
    completedEpisodes: [],
    activity: []
  });
  const ergebnis = umzug.favorit(fremd, ALT, NEU, normalisieren);
  pruefe("Ein Eintrag eines anderen Anbieters bleibt unberuehrt",
    ergebnis.geaendert === 0 && ergebnis.favorit.url === fremd.url);
}

// --- Der ganze Umzug -----------------------------------------------------------

const ANBIETER = [
  { id: "sto", name: "S.to", startUrl: "https://s.to/", searchUrl: "https://s.to/suche?term={query}", lastUrl: "" },
  { id: "aniworld", name: "AniWorld", startUrl: "https://aniworld.to/", searchUrl: "https://aniworld.to/search?q={query}", lastUrl: "" }
];

{
  const favoriten = [
    eintrag(),
    eintrag({ id: "f2", url: "https://s.to/serie/stream/loki/staffel-1/episode-1", completed: true }),
    eintrag({
      id: "f3", providerId: "aniworld",
      url: "https://aniworld.to/anime/stream/one-piece",
      thumbnail: "https://aniworld.to/bild.jpg", favicon: "", completedEpisodes: [], activity: []
    })
  ];
  const ergebnis = umzug.umziehen({
    providers: ANBIETER, favorites: favoriten,
    providerId: "sto", neueAdresse: "http://186.2.175.5", normalisieren
  });

  pruefe("Der Umzug geht durch",
    ergebnis.ok && ergebnis.bericht.eintraege === 2,
    `${ergebnis.bericht?.eintraege} Eintraege`);
  pruefe("Der Bericht nennt die Mediathek eigens",
    ergebnis.bericht.mediathek === 1,
    "was dort steht, ist abgeschlossen - und faellt beim Umzug besonders auf");
  pruefe("und wie viele Bilder mitziehen",
    ergebnis.bericht.bilder === 2, String(ergebnis.bericht.bilder));
  pruefe("Der andere Anbieter bleibt, wie er war",
    ergebnis.providers[1] === ANBIETER[1],
    "gleiches Objekt, nicht bloss gleicher Inhalt - angefasst wurde es nicht");
  pruefe("Und sein Eintrag ebenfalls",
    ergebnis.favorites[2] === favoriten[2]);
  pruefe("Die Vorlagen selbst bleiben unveraendert",
    ANBIETER[0].startUrl === "https://s.to/" && favoriten[0].url.startsWith("https://s.to/"),
    "gerechnet wird ohne Nebenwirkung - geschrieben wird erst nach der Rueckfrage");
}

{
  const zusammen = [
    ANBIETER[0],
    { id: "zwei", name: "S.to Spiegel", startUrl: "https://s.to/spiegel", searchUrl: "https://s.to/suche?term={query}", lastUrl: "" }
  ];
  const ergebnis = umzug.umziehen({
    providers: zusammen, favorites: [],
    providerId: "sto", neueAdresse: "http://186.2.175.5", normalisieren
  });
  pruefe("Ein zweiter Anbieter auf derselben Adresse wird genannt",
    ergebnis.bericht.mitbewohner.length === 1 && ergebnis.bericht.mitbewohner[0] === "S.to Spiegel",
    "zwei Anbieter mit derselben Adresse waeren nicht auseinanderzuhalten");
  pruefe("aber nicht mit umgezogen",
    ergebnis.providers[1].startUrl === "https://s.to/spiegel",
    "der Umzug gilt fuer den Anbieter, auf den er sich bezieht");
}

pruefe("Einen Anbieter, den es nicht gibt, zieht niemand um",
  umzug.umziehen({ providers: ANBIETER, favorites: [], providerId: "gibtesnicht", neueAdresse: "https://x.example" }).ok === false);
pruefe("Ohne Watchlist geht es auch",
  umzug.umziehen({ providers: ANBIETER, providerId: "sto", neueAdresse: "https://neu.example" }).ok);

// --- Die Reihenfolge im Hauptprozess -------------------------------------------

const stelle = MAIN.indexOf('ipcMain.handle("provider:relocate"');
const block = MAIN.slice(stelle, MAIN.indexOf("ipcMain.handle(\"watchparty:status\"", stelle));
pruefe("Erst rechnen, dann fragen, dann schreiben",
  block.indexOf("umzug.umziehen(") < block.indexOf("dialog.showMessageBox")
  && block.indexOf("dialog.showMessageBox") < block.indexOf("saveProviders()")
  && block.indexOf("saveProviders()") < block.indexOf("saveFavorites()"),
  "was der Bericht nennt, ist genau das, was danach anders ist");
pruefe("Ohne Zustimmung geschieht nichts",
  /if \(antwort\.response !== 1\) return \{ moved: false \};/.test(block)
  && block.indexOf("if (antwort.response !== 1)") < block.indexOf("saveProviders()"));
pruefe("Die offene Seite wird vorher uebersetzt",
  block.indexOf("const offeneAdresse") < block.indexOf("providers = providerModel.normalizeProviders"),
  "danach ist die alte Adresse nirgends mehr zu finden");
pruefe("und danach dorthin nachgezogen",
  /await navigateProvider\(ziel, offeneAdresse\)/.test(block),
  "sonst stuende nach dem Umzug eine tote Seite im Bild");

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
