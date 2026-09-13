"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const geraeteStand = require("../src/geraete-stand");
const schluessel = require("../src/geraete-schluessel");
const fortschritt = require("../src/fortschritt");

const url = (episode, season = 1, host = "aniworld.to") =>
  `https://${host}/anime/stream/black-torch/staffel-${season}/episode-${episode}`;
const neu = () => ({
  id: "black-torch", title: "Black Torch", type: "serie", providerName: "AniWorld",
  url: url(4), season: 1, episode: 4, position: 0, progress: 0,
  newEpisodeAt: "2026-09-13T08:00:00.000Z", newEpisodeLabel: "Folge 4",
  completedEpisodes: []
});
let anzahl = 0;
function pruefe(name, remote, erwartet) {
  const lokal = neu();
  const stand = schluessel.stand({ ...lokal, ...remote, key: geraeteStand.titelSchluessel(lokal) });
  assert.equal("newEpisodeAt" in stand, false, "Hinweise bleiben geraetelokal");
  const ergebnis = geraeteStand.uebernehmen(stand, { favoriten: [lokal] });
  assert.ok(ergebnis);
  assert.equal(Boolean(lokal.newEpisodeAt), erwartet, name);
  assert.equal(Boolean(lokal.newEpisodeLabel), erwartet, name + " Beschriftung");
  assert.equal(schluessel.standHash(ergebnis.stand),
    schluessel.standHash(schluessel.stand({ ...lokal, key: stand.key })), "Kein Ruecksendekreis");
  console.log("OK  " + name);
  anzahl += 1;
}

pruefe("PC schaut die neue Folge: Hinweis verschwindet", { position: 100, progress: 7 }, false);
pruefe("PC schliesst die neue Folge ab", { episodeCompleted: true, completed: true }, false);
pruefe("Andere Anbieteradresse verhindert die Bestaetigung nicht", {
  url: url(4, 1, "185.148.128.1"), position: 100
}, false);
pruefe("Abgeschlossene Folge bleibt beim automatischen Weiterschalten bestaetigt", {
  url: url(5), episode: 5, continuePending: true,
  completedEpisodes: [{ season: 1, episode: 4, completedAt: "2026-09-13T09:00:00.000Z" }]
}, false);
pruefe("Spaetere Wiedergabe bestaetigt den alten Hinweis", { url: url(5), episode: 5, position: 60 }, false);
pruefe("Neue Staffel bestaetigt den alten Hinweis", { url: url(1, 2), season: 2, episode: 1, position: 60 }, false);
pruefe("Reiner Metadatenabgleich behaelt den ungesehenen Hinweis", { thumbnail: "https://cdn.example/cover.jpg" }, true);
pruefe("Ungestartete naechste Folge entfernt den Hinweis nicht", { continuePending: true }, true);
pruefe("Aeltere geschaute Folge bestaetigt keinen neuen Nachschub", {
  url: url(3), episode: 3, position: 1400, progress: 100, episodeCompleted: true,
  completedEpisodes: [{ season: 1, episode: 3 }]
}, true);
pruefe("Alte Seriengrenze gilt nicht als Abschluss der neuen Folge", {
  url: url(3), episode: 3, completed: true
}, true);

for (const [name, remote, gesehen] of [
  ["Watchparty-Wiedergabe bestaetigt den lokalen Folgenhinweis", { url: url(4), season: 1, episode: 4, position: 100 }, true],
  ["Aelterer Watchparty-Fortschritt laesst neuen Nachschub stehen", { url: url(3), season: 1, episode: 3, position: 1400, episodeCompleted: true }, false],
  ["Ungestartete Watchparty-Folge ist keine Bestaetigung", { url: url(4), season: 1, episode: 4, position: 0 }, false]
]) {
  const lokal = { ...neu(), watchpartyRoom: "Test-Runde" };
  const ergebnis = fortschritt.watchpartyStandUebernehmen(lokal, {
    duration: 1400, updatedAt: "2026-09-13T09:00:00.000Z", ...remote
  });
  assert.equal(ergebnis.art, "aendern", name);
  assert.equal(ergebnis.aenderung.newEpisodeAt === "", gesehen, name);
  assert.equal(ergebnis.aenderung.newEpisodeLabel === "", gesehen, name);
  assert.ok(lokal.newEpisodeAt, "Urteil veraendert nicht die Eingabe");
  anzahl += 1;
  console.log("OK  " + name);
}

{
  const gespeichert = { ...neu(), position: 100, progress: 7, watchpartyAt: "2026-09-13T09:00:00.000Z" };
  const vorher = JSON.stringify(gespeichert);
  assert.deepEqual(geraeteStand.geseheneNachschubHinweise([gespeichert]), [{
    id: gespeichert.id, url: gespeichert.url, newEpisodeAt: gespeichert.newEpisodeAt
  }], "Alter bereits abgeglichener Hinweis wird ohne neue Servermeldung erkannt");
  assert.equal(JSON.stringify(gespeichert), vorher, "Die Pruefung schreibt keinen Stand um");
  anzahl += 1;
}
{
  const privat = neu();
  const runde = { ...neu(), id: "runde", watchpartyRoom: "Test", newEpisodeAt: "", url: url(5), episode: 5, position: 100 };
  const zukunft = { ...neu(), id: "neuere-folge", url: url(6), episode: 6 };
  const fremd = { ...runde, id: "fremd", url: "https://aniworld.to/anime/stream/andere-serie/staffel-5/episode-10" };
  const liste = [privat, runde, zukunft, fremd];
  const vorher = JSON.stringify(liste);
  assert.deepEqual(geraeteStand.geseheneNachschubHinweise(liste).map((eintrag) => eintrag.id), [privat.id],
    "Gesehene Watchparty bestaetigt den privaten Hinweis, keine spaetere Folge");
  assert.equal(JSON.stringify(liste), vorher, "Private und Watchparty-Fortschritte bleiben getrennt");
  assert.deepEqual(geraeteStand.geseheneNachschubHinweise([privat, fremd]), [], "Andere Serien bestaetigen nichts");
  anzahl += 1;
}

// Die native Anbindung muss reine Hinweis-Aenderungen sichtbar machen.
const main = fs.readFileSync(path.join(__dirname, "../../android/app/src/main/java/local/elflix/android/MainActivity.java"), "utf8");
const seitenbild = main.slice(main.indexOf("private String seitenbild()"), main.indexOf("private void bestandGeaendert()"));
assert.ok(seitenbild.includes("eintrag.neueFolgeAm()") && seitenbild.includes("eintrag.neueFolgeText()"),
  "Android-Seitenvergleich muss Hinweis und Beschriftung beruecksichtigen");
anzahl += 1;
console.log(`\n${anzahl}/${anzahl} bestanden`);
