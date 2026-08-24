"use strict";
// Regression fuer den AOT-Folgenwechsel: Die Seite darf eine fremde
// Vorschlagsfolge melden, aber der Weiterschauen-Eintrag bleibt bei derselben
// Serie und behaelt ihren Serientitel.

const fortschritt = require("../src/fortschritt");

const pruefungen = [];
const pruefe = (name, bedingung, detail = "") => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

const ANBIETER = { id: "aniworld", name: "Aniworld", startUrl: "https://aniworld.to/", logo: "AN" };
const AOT1 = "https://aniworld.to/anime/stream/attack-on-titan/staffel-1/episode-1";
const AOT2 = "https://aniworld.to/anime/stream/attack-on-titan/staffel-1/episode-2";
const FREMD = "https://aniworld.to/anime/stream/young-ladies-dont-play-fighting-games/staffel-1/episode-2";

const eintrag = {
  id: "aot",
  providerId: ANBIETER.id,
  providerName: ANBIETER.name,
  title: "Attack on Titan",
  url: AOT1,
  normalizedUrl: fortschritt.normalizeFavoriteUrl(AOT1),
  type: "serie",
  season: 1,
  episode: 1,
  progress: 80,
  currentTime: 1200,
  position: 1200,
  duration: 1400,
  favorite: true,
  watched: true,
  completed: false,
  episodeCompleted: false,
  continuePending: false,
  completedEpisodes: [],
  activity: [],
  finalSeason: 4,
  finalEpisode: 30,
  hideFromContinueWatching: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastWatchedAt: "2026-01-01T00:00:00.000Z"
};

const ergebnis = fortschritt.medienStandVerbuchen(
  { favoriten: [eintrag], aktiverFavoritId: "aot", watchpartyFuehrt: false },
  ANBIETER,
  AOT1,
  {
    title: "Young Ladies Don't Play Fighting Games - Folge 2",
    currentTime: 1330,
    duration: 1400,
    watchedSeconds: 900,
    finalSeason: 4,
    finalEpisode: 30,
    nextUrl: FREMD
  }
);

pruefe("Die fremde naechste Folge wird nicht uebernommen", ergebnis.eintrag?.url === AOT2, ergebnis.eintrag?.url);
pruefe("Der Serientitel bleibt erhalten", ergebnis.eintrag?.title === "Attack on Titan", ergebnis.eintrag?.title);
pruefe("Der Eintrag steht offen auf der naechsten Folge",
  ergebnis.eintrag?.continuePending === true
  && ergebnis.eintrag?.progress === 0
  && ergebnis.eintrag?.season === 1
  && ergebnis.eintrag?.episode === 2,
  `S${ergebnis.eintrag?.season}E${ergebnis.eintrag?.episode}, ${ergebnis.eintrag?.progress}%`);

const fehler = pruefungen.filter((wert) => !wert).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
