"use strict";

// Der Haken "Gesehen" von Hand.
//
// Die automatische Anzeige verwendet den normalen 90-%-Abschluss. Ein
// Verlaufsbesuch allein zaehlt nicht. Manuelle Haken bleiben gueltig,
// Ruecknahmen veraendern nie den Rohverlauf.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const spoilerschutz = require("../src/spoilerschutz");
const taste = require("../src/taste");
const fortschritt = require("../src/fortschritt");

const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");

function quelle(name) {
  const treffer = main.match(new RegExp(`^function ${name}\\([^]*?^}`, "m"));
  assert.ok(treffer, `${name} fehlt`);
  return treffer[0];
}

const SERIE = "https://aniworld.to/anime/stream/bleach";
const folgenUrl = (staffel, folge) => `${SERIE}/staffel-${staffel}/episode-${folge}`;

function welt(favoriten) {
  const context = vm.createContext({
    favorites: favoriten,
    spoilerschutz,
    taste,
    sanitizePositiveNumber: (wert) => {
      const zahl = Number(wert);
      return Number.isFinite(zahl) && zahl > 0 ? Math.floor(zahl) : 0;
    },
    istGleicheSerie: (links, rechts) => Boolean(links) && Boolean(rechts)
      && taste.urlSchluessel(links) === taste.urlSchluessel(rechts),
    Date
  });
  vm.runInContext(quelle("spoilerAbgeschlosseneFolgen"), context);
  vm.runInContext(quelle("spoilerFolgenMarkieren"), context);
  return context;
}

const schluessel = (welt, url) => welt.spoilerAbgeschlosseneFolgen(url)
  .map((wert) => spoilerschutz.episodenSchluessel(wert)).sort().join(",");

// 1) Nur gepruefte Folgenabschluesse zaehlen. Auch ein rohes "ended" kann im
//    Verlauf "Abgeschlossen" heissen, ohne die Sehzeitpruefung zu bestehen.
{
  const w = welt([{
    url: folgenUrl(3, 22),
    completedEpisodes: [{ season: 3, episode: 20 }, { season: 3, episode: 21 }],
    activity: [
      { url: folgenUrl(3, 17), label: "Abgeschlossen" },
      { url: folgenUrl(3, 18), label: "Geöffnet" },
      { url: folgenUrl(3, 19), label: "Staffel 3 Folge 19" }
    ]
  }]);
  assert.equal(schluessel(w, folgenUrl(3, 1)), "3|20,3|21",
    "nur bestaetigte Abschluesse zaehlen, Verlaufslabels nicht");
}

// 2) Von Hand abhaken - und die Markierung liegt beim Titel, nicht am Aufrufer.
{
  const favorit = { url: folgenUrl(3, 22), completedEpisodes: [], activity: [] };
  const w = welt([favorit]);
  assert.equal(w.spoilerFolgenMarkieren(folgenUrl(3, 22), [{ season: 3, episode: 5 }], true), true);
  assert.equal(schluessel(w, folgenUrl(3, 1)), "3|5");
  assert.equal(favorit.completedEpisodes.at(-1).manual, true, "die Herkunft steht am Eintrag");
  assert.equal(favorit.completedEpisodes.at(-1).season, 3);
  assert.equal(favorit.completedEpisodes.at(-1).episode, 5);

  // Zweimal dasselbe legt keinen zweiten Eintrag an.
  assert.equal(w.spoilerFolgenMarkieren(folgenUrl(3, 22), [{ season: 3, episode: 5 }], true), false);
  assert.equal(favorit.completedEpisodes.length, 1);
}

// 3) Eine ganze Staffel auf einmal - der Grund, aus dem es den Weg gibt.
{
  const favorit = { url: folgenUrl(3, 22), completedEpisodes: [], activity: [] };
  const w = welt([favorit]);
  const staffel = Array.from({ length: 22 }, (_, i) => ({ season: 3, episode: i + 1 }));
  assert.equal(w.spoilerFolgenMarkieren(folgenUrl(3, 22), staffel, true), true);
  assert.equal(w.spoilerAbgeschlosseneFolgen(folgenUrl(3, 1)).length, 22);
  // Eine andere Staffel bleibt davon unberuehrt.
  assert.equal(w.spoilerAbgeschlosseneFolgen(folgenUrl(3, 1))
    .every((wert) => wert.season === 3), true);
}

// 4) Automatische und manuelle Abschluesse lassen sich zuruecknehmen, auch
//    wenn fuer dieselbe Folge weiterhin ein Verlaufsereignis existiert.
{
  const favorit = {
    url: folgenUrl(3, 22),
    completedEpisodes: [{ season: 3, episode: 20 }, { season: 3, episode: 17, manual: true }],
    activity: [{ url: folgenUrl(3, 17), label: "Abgeschlossen" }]
  };
  const w = welt([favorit]);
  assert.equal(schluessel(w, folgenUrl(3, 1)), "3|17,3|20");

  assert.equal(w.spoilerFolgenMarkieren(folgenUrl(3, 22), [{ season: 3, episode: 20 }], false), true);
  assert.equal(schluessel(w, folgenUrl(3, 1)), "3|17", "der Abschluss ist weg");

  assert.equal(w.spoilerFolgenMarkieren(folgenUrl(3, 22), [{ season: 3, episode: 17 }], false), true);
  assert.equal(schluessel(w, folgenUrl(3, 1)), "", "ein Verlaufsereignis setzt den Haken nicht wieder");
  assert.deepEqual(favorit.activity.length, 1, "der Verlauf selbst bleibt unangetastet");

  // Und wieder anhaken hebt die Ruecknahme auf - aber nur die dieser Folge.
  assert.equal(w.spoilerFolgenMarkieren(folgenUrl(3, 22), [{ season: 3, episode: 17 }], true), true);
  assert.equal(schluessel(w, folgenUrl(3, 1)), "3|17");
  assert.equal((favorit.unwatchedEpisodes || []).some((wert) => wert.episode === 17), false,
    "die Ruecknahme dieser Folge ist aufgehoben");
  assert.equal((favorit.unwatchedEpisodes || []).some((wert) => wert.episode === 20), true,
    "die der anderen bleibt stehen");

  // Und ist nichts mehr zurueckgenommen, bleibt auch keine leere Liste stehen.
  assert.equal(w.spoilerFolgenMarkieren(folgenUrl(3, 22), [{ season: 3, episode: 20 }], true), true);
  assert.equal(favorit.unwatchedEpisodes, undefined, "eine leere Ruecknahmeliste bleibt nicht stehen");
}

// 5) Zwei Eintraege derselben Serie - der gemeldete Fall hatte genau das. Der
//    Haken gilt fuer die Serie und nicht fuer den zufaellig getroffenen Eintrag.
{
  const alt = { url: folgenUrl(1, 1), completedEpisodes: [{ season: 3, episode: 9 }], activity: [] };
  const neu = { url: folgenUrl(3, 22), completedEpisodes: [], activity: [] };
  const w = welt([alt, neu]);
  assert.equal(schluessel(w, folgenUrl(3, 22)), "3|9", "beide Eintraege zaehlen zusammen");
  assert.equal(w.spoilerFolgenMarkieren(folgenUrl(3, 22), [{ season: 3, episode: 9 }], false), true);
  assert.equal(schluessel(w, folgenUrl(3, 22)), "", "und der Haken raeumt in beiden auf");
}

// 6) Unsinnige Angaben aendern nichts.
{
  const favorit = { url: folgenUrl(3, 22), completedEpisodes: [], activity: [] };
  const w = welt([favorit]);
  assert.equal(w.spoilerFolgenMarkieren(folgenUrl(3, 22), [{ season: 3, episode: 0 }], true), false);
  assert.equal(w.spoilerFolgenMarkieren(folgenUrl(3, 22), "keine liste", true), false);
  assert.equal(w.spoilerFolgenMarkieren("https://example.com/anderes", [{ season: 1, episode: 1 }], true), false,
    "eine fremde Serie wird nicht angefasst");
  assert.equal(favorit.completedEpisodes.length, 0);
}

// 7) Echte Fortschrittsverarbeitung bis zur Anzeige: Start und Teilwiedergabe
//    bleiben geschuetzt, erst der normale Abschluss ab 90 % gibt sie frei.
{
  const provider = { id: "aniworld", name: "AniWorld", startUrl: "https://aniworld.to/" };
  for (const [position, watchedSeconds, gesehen, ended = false] of [[1, 1, false], [300, 300, false],
    [890, 890, false], [900, 1, false], [1000, 1, false, true], [900, 900, true], [1000, 900, true, true]]) {
    const favorite = { id: "bleach", providerId: provider.id, type: "serie", url: folgenUrl(3, 3),
      title: "Bleach", season: 3, episode: 3, favorite: true, completedEpisodes: [], activity: [] };
    const result = fortschritt.medienStandVerbuchen({ favoriten: [favorite], aktiverFavoritId: favorite.id },
      provider, folgenUrl(3, 3), { currentTime: position, duration: 1000, watchedSeconds, completed: ended,
        finalSeason: 17, finalEpisode: 12, seasonLastEpisode: 20 },
      { label: ended ? "Abgeschlossen" : undefined });
    assert.ok(result.eintrag.activity.length, "der Start steht tatsaechlich im Verlauf");
    const w = welt(result.favoriten);
    const abgeschlossen = w.spoilerAbgeschlosseneFolgen(folgenUrl(3, 3));
    const anzeige = spoilerschutz.protectEpisode({ staffel: 3, folge: 3, titel: "Der echte Titel" },
      { enabled: true, completedEpisodes: abgeschlossen });
    assert.equal(anzeige.seen, gesehen, `${position / 10} % / ${watchedSeconds}s: Gesehen-Regel`);
    assert.equal(anzeige.titel, gesehen ? "Der echte Titel" : "Noch nicht gesehen",
      "der Titel wird gleichzeitig mit dem Abschluss freigegeben");
    assert.equal(spoilerschutz.folgeIstGesehen({ staffel: 3, folge: 4 }, abgeschlossen), false,
      "der Weiterschauen-Zeiger markiert die naechste Folge nicht mit");
  }
}

console.log("OK Gesehen-Markierung: normale 90-%-Regel mit Sehzeitpruefung, manuelle Haken und Ruecknahme");
