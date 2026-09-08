"use strict";

// Der Haken "Gesehen" von Hand.
//
// Gemeldet mit einem Bildschirmfoto einer Bleach-Staffel: einundzwanzig Zeilen
// "Noch nicht gesehen", obwohl die Folgen laengst geschaut waren. Der Grund
// steht in der echten Ablage - `completedEpisodes` kannte genau zwei Folgen,
// der Verlauf sieben weitere, und fuer alles davor gibt es ueberhaupt keine
// Zeile. Die ersten beiden Quellen zaehlen jetzt zusammen; fuer den Rest gibt
// es diesen Weg.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const spoilerschutz = require("../src/spoilerschutz");
const taste = require("../src/taste");

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

// 1) Der Verlauf zaehlt mit - genau das fehlte im gemeldeten Fall.
{
  const w = welt([{
    url: folgenUrl(3, 22),
    completedEpisodes: [{ season: 3, episode: 20 }, { season: 3, episode: 21 }],
    activity: [
      { url: folgenUrl(3, 17), label: "Staffel 3 Folge 17" },
      { url: folgenUrl(3, 18), label: "Geöffnet" }
    ]
  }]);
  assert.equal(schluessel(w, folgenUrl(3, 1)), "3|17,3|20,3|21",
    "Abschluss und Verlauf ergeben zusammen den gesehenen Stand");
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

// 4) Zuruecknehmen. Auch bei einer Folge, die nur der Verlauf kennt - sonst
//    liesse sich genau die nicht abwaehlen, weil sie sofort wieder abgeleitet
//    wuerde.
{
  const favorit = {
    url: folgenUrl(3, 22),
    completedEpisodes: [{ season: 3, episode: 20 }],
    activity: [{ url: folgenUrl(3, 17), label: "Staffel 3 Folge 17" }]
  };
  const w = welt([favorit]);
  assert.equal(schluessel(w, folgenUrl(3, 1)), "3|17,3|20");

  assert.equal(w.spoilerFolgenMarkieren(folgenUrl(3, 22), [{ season: 3, episode: 20 }], false), true);
  assert.equal(schluessel(w, folgenUrl(3, 1)), "3|17", "der Abschluss ist weg");

  assert.equal(w.spoilerFolgenMarkieren(folgenUrl(3, 22), [{ season: 3, episode: 17 }], false), true);
  assert.equal(schluessel(w, folgenUrl(3, 1)), "", "auch die Folge aus dem Verlauf laesst sich abwaehlen");
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

console.log("OK Gesehen-Markierung: Verlauf zaehlt mit, Haken je Folge und je Staffel, Ruecknahme haelt");
