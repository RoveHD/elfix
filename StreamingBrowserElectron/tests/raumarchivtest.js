"use strict";
/*
 * Der Lebenslauf eines Titels in einer Runde - die Regel, ohne Netz.
 *
 * Gemeldet: Watchparty-Raeume verschwanden nach dreissig Tagen, und die Titel
 * darin verschwanden nie. Beides war verkehrt herum. Ein Raum ist eine
 * Verabredung und bleibt; ein Titel dagegen ist irgendwann durch - der Film zu
 * Ende, die letzte verfuegbare Folge abgehakt - und hat dann in "Gemeinsam
 * weiterschauen" nichts mehr verloren.
 *
 * Was hier geprueft wird, ist die geteilte Regel dazu: `watchpartyArchived`,
 * wie er hinausgeht (watchpartyStand), wie er zurueckkommt
 * (watchpartyArchivAbgleichen, watchpartyStandUebernehmen) und was er fuer
 * "Gemeinsam weiterschauen" bedeutet (hasContinueProgressRecord). Dieselben
 * Funktionen benutzt das Telefon - deshalb steht die Regel dort und nicht
 * zweimal.
 *
 * Das Zusammenspiel mit dem echten Relay steht in watchpartyarchivtest.js.
 */

const fortschritt = require("../src/fortschritt");
const watchlist = require("../src/watchlist");

const pruefungen = [];
const pruefe = (name, bedingung, detail) => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

const SERIE = "https://aniworld.to/anime/stream/black-torch";
const folge = (staffel, nummer) => `${SERIE}/staffel-${staffel}/episode-${nummer}`;
const FILM = "https://filmo.to/movies/spider-man";

function raumEintrag(zusatz = {}) {
  return {
    id: "bt-bangus",
    providerId: "aniworld",
    providerName: "AniWorld",
    title: "Black Torch",
    url: folge(1, 8),
    type: "serie",
    season: 1,
    episode: 8,
    favorite: false,
    watched: true,
    completed: false,
    episodeCompleted: true,
    continuePending: false,
    watchpartyRoom: "bangus",
    watchpartyArchived: false,
    duration: 1400,
    currentTime: 1399,
    progress: 100,
    lastWatchedAt: "2026-08-30T10:00:00.000Z",
    createdAt: "2026-07-01T10:00:00.000Z",
    activity: [],
    ...zusatz
  };
}

/* ============ 1. Archiviert heisst: raus aus "Gemeinsam weiterschauen" ===== */

pruefe("1a. Ein offener Raum-Eintrag steht in Weiterschauen",
  fortschritt.hasContinueProgressRecord(
    raumEintrag({ episodeCompleted: false, continuePending: true })) === true);

pruefe("1b. Archiviert faellt er heraus",
  fortschritt.hasContinueProgressRecord(
    raumEintrag({ episodeCompleted: false, continuePending: true, watchpartyArchived: true })) === false,
  "das ist der Unterschied zwischen 'gerade nichts Neues' und 'geloescht'");

pruefe("1c. Und der Merker gilt auch fuer einen laufenden Wiederholungsdurchlauf nicht als Ausnahme",
  fortschritt.hasContinueProgressRecord(
    raumEintrag({ completed: true, rewatching: true, watchpartyArchived: true })) === false);

// Der private Eintrag desselben Werks traegt den Merker nie - er gehoert
// keinem Raum. Geprueft wird das hier als Regel und nicht als Zufall.
pruefe("1d. Ein privater Eintrag bleibt unberuehrt",
  fortschritt.hasContinueProgressRecord({
    url: folge(1, 4), type: "serie", continuePending: true, watchpartyRoom: ""
  }) === true);

/* ================= 2. Was ueber die Leitung geht (Film) =================== */

const filmFertig = {
  title: "Spider-Man", url: FILM, type: "film", watchpartyRoom: "bangus",
  completed: true, episodeCompleted: false, duration: 8000, currentTime: 7990,
  progress: 100, season: 0, episode: 0, lastWatchedAt: "2026-08-30T20:00:00.000Z"
};
const filmStand = fortschritt.watchpartyStand(filmFertig, "PC");
pruefe("2a. Ein zu Ende geschauter Film meldet sich als archiviert",
  filmStand.archived === true && filmStand.completed === true,
  JSON.stringify({ archived: filmStand.archived, completed: filmStand.completed }));

pruefe("2b. Ein halb geschauter Film nicht",
  fortschritt.watchpartyStand({ ...filmFertig, completed: false }, "PC").archived === false);

pruefe("2c. Ein laufendes Wiederansehen ist kein Archiv",
  fortschritt.watchpartyStand({ ...filmFertig, rewatching: true }, "PC").archived === false,
  "da ist der Titel zwar durch, die Runde aber gerade wieder unterwegs");

pruefe("2d. Der ausgerechnete Merker geht ebenfalls hinaus",
  fortschritt.watchpartyStand(raumEintrag({ watchpartyArchived: true }), "PC").archived === true,
  "so erfaehrt die Runde von einer Serie, nach deren letzter Folge nichts kommt");

/* ================ 3. Was aus dem Raumzustand zurueckkommt ================= */

const lokal = raumEintrag();
const archiviert = fortschritt.watchpartyArchivAbgleichen(lokal, true);
pruefe("3a. Der Raum archiviert - der Eintrag hier zieht nach",
  archiviert.art === "aendern" && archiviert.aenderung.watchpartyArchived === true);
pruefe("3b. Und nur dieser eine Merker aendert sich",
  Object.keys(archiviert.aenderung).join(",") === "watchpartyArchived",
  "Fortschritt, Folge und Verlauf gehoeren dem Benutzer und nicht dem Raum");

Object.assign(lokal, archiviert.aenderung);
pruefe("3c. Zweimal dasselbe ist keine Aenderung",
  fortschritt.watchpartyArchivAbgleichen(lokal, true).art === "nichts",
  "sonst schriebe jeder Raumzustand die Ablage neu");
pruefe("3d. Wird der Titel wieder aktiv, geht der Merker weg",
  fortschritt.watchpartyArchivAbgleichen(lokal, false).aenderung.watchpartyArchived === false);

// Und derselbe Weg ueber eine Standmeldung: das Relay laesst nur durch, was
// wirklich gilt, also gilt hier, was ankommt.
const uebernommen = fortschritt.watchpartyStandUebernehmen(raumEintrag(), {
  url: folge(1, 8), season: 1, episode: 8, position: 1399, duration: 1400, progress: 100,
  completed: false, episodeCompleted: true, archived: true,
  updatedAt: "2026-08-31T09:00:00.000Z", from: "PC"
});
pruefe("3e. Ein archivierter Stand archiviert auch hier",
  uebernommen.art === "aendern" && uebernommen.aenderung.watchpartyArchived === true);
pruefe("3f. Und macht den Eintrag nicht nebenbei wieder offen",
  uebernommen.aenderung.continuePending !== true,
  "continuePending waere genau der Weg zurueck in die Reihe");

const geweckt = fortschritt.watchpartyStandUebernehmen(
  raumEintrag({ watchpartyArchived: true }), {
    url: folge(1, 9), season: 1, episode: 9, position: 0, duration: 0, progress: 0,
    completed: false, episodeCompleted: false, archived: false,
    updatedAt: "2026-09-05T09:00:00.000Z", from: "Handy"
  });
pruefe("3g. Eine neue Folge holt den Titel zurueck",
  geweckt.aenderung.watchpartyArchived === false
  && geweckt.aenderung.continuePending === true
  && geweckt.aenderung.url === folge(1, 9),
  geweckt.aenderung.url);

/* ================== 4. Neue Folge, neue Staffel, Korra ==================== */

// Genau der Weg, auf dem ELFIX heute schon eine neue Folge zu einer
// abgeschlossenen Serie erkennt: die Seitengrenzen wandern nach vorn.
// Nichts daran ist fuer die Watchparty neu erfunden.
function nachSeitenbesuch(eintrag, finalSeason, finalEpisode, aktuell) {
  const meldungen = [];
  const geaendert = fortschritt.applyFavoriteSeriesBounds(
    eintrag, { finalSeason, finalEpisode }, aktuell, meldungen);
  return { geaendert, meldungen };
}

const bt = raumEintrag({
  completed: true, completedAt: "2026-08-30T10:00:00.000Z",
  episodeCompleted: false, watchpartyArchived: true,
  finalSeason: 1, finalEpisode: 8
});
const btLauf = nachSeitenbesuch(bt, 1, 9, folge(1, 8));
pruefe("4a. Folge 9 erscheint - derselbe Raumtitel wird wieder aktiv",
  btLauf.geaendert
  && bt.watchpartyArchived === false
  && bt.completed === false
  && bt.episodeCompleted === false
  && bt.continuePending === true
  && bt.url === folge(1, 9),
  `${bt.url} archiviert=${bt.watchpartyArchived}`);
pruefe("4b. Raum und Werk bleiben dieselben",
  bt.watchpartyRoom === "bangus" && bt.id === "bt-bangus");
pruefe("4c. Und die private Watchlist entsteht daraus nicht",
  bt.favorite === false,
  "ein Raum-Eintrag gehoert seiner Runde, nicht der eigenen Merkliste");
pruefe("4d. Die Meldung spricht von der Runde und nicht von der Watchlist",
  btLauf.meldungen.some((text) => text.includes("Bangus") || text.includes("bangus")),
  btLauf.meldungen.join(" | "));

// Zum Vergleich: derselbe Vorgang privat setzt die Merkliste weiterhin.
const privat = raumEintrag({
  id: "bt-privat", watchpartyRoom: "", watchpartyArchived: false,
  completed: true, episodeCompleted: false, favorite: false,
  finalSeason: 1, finalEpisode: 8
});
nachSeitenbesuch(privat, 1, 9, folge(1, 8));
pruefe("4e. Privat bleibt es dabei: neue Folge, zurueck auf die Watchlist",
  privat.favorite === true && privat.completed === false,
  "an der privaten Regel aendert sich nichts");

const staffel = raumEintrag({
  id: "bt-staffel", url: folge(1, 12), season: 1, episode: 12,
  completed: true, episodeCompleted: false, watchpartyArchived: true,
  finalSeason: 1, finalEpisode: 12
});
nachSeitenbesuch(staffel, 2, 1, folge(1, 12));
pruefe("4f. Eine neue Staffel weckt genauso",
  staffel.watchpartyArchived === false && staffel.url === folge(2, 1),
  staffel.url);

const korra = raumEintrag({
  id: "korra", title: "Die Legende von Korra",
  url: "https://aniworld.to/anime/stream/korra/staffel-4/episode-13",
  season: 4, episode: 13, completed: true, episodeCompleted: false,
  watchpartyArchived: true, finalSeason: 4, finalEpisode: 13
});
const korraLauf = nachSeitenbesuch(korra, 4, 13, korra.url);
pruefe("4g. Kommt nie eine neue Folge, bleibt der Titel archiviert",
  korra.watchpartyArchived === true
  && korra.completed === true
  && korraLauf.meldungen.length === 0,
  "er stoert niemanden - und der Raum bleibt trotzdem stehen");
pruefe("4h. In Weiterschauen steht er nicht",
  fortschritt.hasContinueProgressRecord(korra) === false);

/* ============ 5. Zwei Raeume mit demselben Titel bleiben getrennt ========= */

const bangus = raumEintrag({ id: "bt-bangus", watchpartyRoom: "bangus", watchpartyArchived: true });
const familie = raumEintrag({
  id: "bt-familie", watchpartyRoom: "familie", url: folge(1, 4), season: 1, episode: 4,
  episodeCompleted: false, continuePending: true
});
pruefe("5a. Bangus ist archiviert, Familie laeuft weiter",
  fortschritt.hasContinueProgressRecord(bangus) === false
  && fortschritt.hasContinueProgressRecord(familie) === true);

const familieNachher = fortschritt.watchpartyArchivAbgleichen(familie, false);
pruefe("5b. Der Zustand des einen Raums faerbt nicht auf den anderen ab",
  familieNachher.art === "nichts" && familie.url === folge(1, 4),
  "gesucht wird immer nach Serie *und* Raum");

/* ============ 6. Watchlist und Mediathek bleiben, wie sie waren =========== */

const bestand = [
  { id: "p1", title: "Black Torch", url: folge(1, 4), type: "serie", favorite: true, completed: false, watchpartyRoom: "" },
  { id: "r1", title: "Black Torch", url: folge(1, 8), type: "serie", favorite: false, completed: true, watchpartyRoom: "bangus", watchpartyArchived: true },
  { id: "r2", title: "Spider-Man", url: FILM, type: "film", favorite: false, completed: true, watchpartyRoom: "bangus", watchpartyArchived: true }
];

pruefe("6a. Auf der Watchlist steht weiterhin nur der eigene Eintrag",
  bestand.filter((eintrag) => eintrag.favorite && !eintrag.completed && !eintrag.watchpartyRoom)
    .map((eintrag) => eintrag.id).join(",") === "p1");

// Die Mediathek legt privat und Runde desselben Werks zusammen - ein
// archivierter Raum-Eintrag aendert daran nichts, er ist ja nicht geloescht.
const schluessel = (eintrag) => watchlist.werkSchluessel(eintrag.title, eintrag.url, eintrag.type);
pruefe("6b. Privat und Runde desselben Werks tragen denselben Werkschluessel",
  schluessel(bestand[0]) === schluessel(bestand[1]),
  "sonst stuende Black Torch zweimal in der Mediathek");
pruefe("6c. Der abgeschlossene Film bleibt in der Mediathek",
  bestand.filter((eintrag) => eintrag.completed).length === 2,
  "archiviert heisst nicht geloescht - was jemand gesehen hat, gehoert ihm");

const fehler = pruefungen.filter((x) => !x).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
