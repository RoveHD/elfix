"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const nachschub = require("../src/nachschub");
const fortschritt = require("../src/fortschritt");
const folge = (n, s = 1) => `https://aniworld.to/anime/stream/black-torch/staffel-${s}/episode-${n}`;
const privat = {
  id: "privat", title: "BLACK TORCH", url: folge(11), season: 1, episode: 11,
  watchpartyRoom: "", finalSeason: 1, finalEpisode: 11,
  newEpisodeAt: "2026-09-12T18:05:15.420Z", position: 421, duration: 1400, progress: 30
};
const raum = {
  key: "serie:blacktorch", title: "Black Torch", room: "Bangus", type: "serie",
  joined: true, archived: true, url: folge(10), season: 1, episode: 10,
  progress: { url: folge(10), season: 1, episode: 10, completed: true, archived: true }
};
const vorher = JSON.stringify({ privat, raum });
const melden = (f = privat, r = raum) => nachschub.watchpartyNachschub([f], [r]);
const [fund] = melden();
assert.ok(fund, "Privater Nachschub muss den archivierten Raum ohne lokalen Raumeintrag erreichen");
assert.equal(fund.key, raum.key);
assert.equal(fund.room, "Bangus");
assert.equal(fund.eintrag.url, folge(11));
assert.equal(fund.eintrag.completed, false);
assert.equal(fund.eintrag.watchpartyArchived, false);
assert.equal(fund.eintrag.continuePending, true);
assert.equal(fortschritt.watchpartyStand(fund.eintrag).position, 0);
assert.equal(fortschritt.watchpartyStand(fund.eintrag).progress, 0);
assert.equal(JSON.stringify({ privat, raum }), vorher, "Private Ablage und Relay-Snapshot bleiben unveraendert");
assert.equal(melden({ ...privat, newEpisodeAt: "" }).length, 0);
assert.equal(melden({ ...privat, finalEpisode: 10 }).length, 0);
assert.equal(melden({ ...privat, finalEpisode: 0 }).length, 0);
assert.equal(melden({ ...privat, rewatching: true }).length, 0);
assert.equal(melden({ ...privat, url: folge(11).replace("black-torch", "anderer-anime") }).length, 0);
assert.equal(melden({ ...privat, url: folge(11).replace("aniworld.to", "anderer-anbieter.test") }).length, 0);
assert.equal(melden(privat, { ...raum, joined: false }).length, 0);
assert.equal(melden(privat, { ...raum, archived: false }).length, 0);
assert.equal(melden(privat, { ...raum, type: "film" }).length, 0);
assert.equal(nachschub.watchpartyNachschub([privat], []).length, 0, "Entfernte Titel bleiben entfernt");
const alteRunde = { ...raum, progress: { ...raum.progress, url: folge(8), episode: 8 } };
assert.equal(melden(privat, alteRunde)[0].eintrag.url, folge(9), "Ungesehene Folgen der Runde werden nicht uebersprungen");
assert.equal(melden({ ...privat, url: folge(1, 2), finalSeason: 2, finalEpisode: 1 })[0].eintrag.url, folge(1, 2));
const runden = nachschub.watchpartyNachschub([privat], [raum, { ...alteRunde, room: "Familie" }, { ...raum, room: "Aktiv", archived: false }]);
assert.deepEqual(runden.map((f) => [f.room, f.eintrag.episode]), [["Bangus", 11], ["Familie", 9]]);

// Echte Desktop-Verkabelung: Fund vor Raumverbindung, spaeterer Raumzustand,
// sowie Fund waehrend einer bestehenden Verbindung.
const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
function funktion(name) {
  const start = main.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0);
  return main.slice(start, main.indexOf("\n}", start) + 2);
}
const gesendet = [];
const kontext = vm.createContext({
  favorites: [privat], watchpartyShared: [], nachschub, fortschritt,
  watchparty: { aktiv: true, fortschrittMelden: (...args) => gesendet.push(args) },
  watchpartySettings: () => ({ deviceName: "Test" }),
  lokalerWatchpartyEintrag: () => null,
  NEUE_FOLGEN_PRO_LAUF: 6,
  nachschubLauf: { lauf: async () => ({ geaendert: true, gefunden: [privat] }) },
  reportWatchpartyProgress: () => {}, saveFavorites: () => {}, sendActiveState: () => {}, meldeNeueFolgen: () => {}
});
vm.runInContext(["meldeWatchpartyNachschub", "raumEintraegeSichern", "pruefeNeueFolgen"].map(funktion).join("\n"), kontext);
(async () => {
  await kontext.pruefeNeueFolgen();
  assert.equal(gesendet.length, 0);
  kontext.raumEintraegeSichern([raum]);
  assert.equal(gesendet.length, 1, "Gespeicherter Fund wird beim Verbinden nachgemeldet");
  assert.equal(gesendet[0][0], raum.key);
  assert.equal(gesendet[0][1].episode, 11);
  assert.equal(gesendet[0][2], "Bangus");
  kontext.watchpartyShared = [raum];
  await kontext.pruefeNeueFolgen();
  assert.equal(gesendet.length, 2, "Online-Fund wird sofort in den archivierten Raum gemeldet");
  kontext.raumEintraegeSichern([{ ...raum, joined: false }]);
  assert.equal(gesendet.length, 2);
  console.log("OK Nachschub reaktiviert archivierte Watchpartys ohne lokalen Raumeintrag, online und nach Reconnect; private Staende bleiben getrennt");
})().catch((error) => { console.error(error); process.exitCode = 1; });
