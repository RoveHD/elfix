"use strict";

const assert = require("node:assert/strict");
const fortschritt = require("../src/fortschritt");
const watchlist = require("../src/watchlist");
const anbieter = { id: "sto", name: "S.to", startUrl: "https://serienstream.to/" };
const folge = (host, nummer = 4, alt = false, serie = "avatar-die-sieben-hafen") =>
  `https://${host}/serie/${alt ? "stream/" : ""}${serie}/staffel-1/episode-${nummer}`;
const tests = [];
function test(name, lauf) {
  try { lauf(); tests.push(true); console.log(`OK ${name}`); }
  catch (error) { tests.push(false); console.error(`FAIL ${name}: ${error.message}`); }
}
function eintrag(id, host, nummer = 4, extra = {}) {
  const url = folge(host, nummer);
  return { id, providerId: "sto", providerName: "S.to", type: "serie", title: "Avatar - Die sieben Häfen",
    url, normalizedUrl: url, season: 1, episode: nummer, currentTime: 37, duration: 1390,
    progress: 3, watched: true, activity: [], completedEpisodes: [], ...extra };
}

test("S.to Aliasse und alte Pfade bezeichnen dieselbe Folge, fremde Serien bleiben getrennt", () => {
  const ziel = fortschritt.episodeIdentity(folge("s.to"));
  for (const host of ["s.to", "www.s.to", "serienstream.to", "www.serienstream.cx", "186.2.175.5"]) {
    for (const alt of [false, true]) {
      assert.deepEqual(fortschritt.episodeIdentity(folge(host, 4, alt)), ziel);
      assert.equal(fortschritt.serienKennungAusUrl(folge(host, 4, alt)), ziel.key);
      assert.notEqual(fortschritt.episodeIdentity(folge(host, 4, alt, "andere-serie")).key, ziel.key);
    }
  }
  for (const host of ["serienstream.to.example", "example.org", "192.0.2.1", "aniworld.to"]) {
    assert.notEqual(fortschritt.episodeIdentity(folge(host)).key, ziel.key);
  }
});

test("Umleitung derselben Folge loest weder Raum noch Fortschritt", () => {
  const original = eintrag("raum", "s.to", 4, { watchpartyRoom: "Bangus" });
  for (const modus of ["sequential", "manual"]) {
    const urteil = fortschritt.favoritNachziehen(original, folge("serienstream.cx", 4, true), anbieter, modus);
    assert.equal(urteil.art, "nichts");
    assert.equal(original.currentTime, 37);
    assert.equal(original.watchpartyRoom, "Bangus");
  }
  assert.equal(fortschritt.favoritNachziehen(original, folge("serienstream.to", 5), anbieter).art, "nachziehen");
  assert.equal(fortschritt.favoritNachziehen(original, folge("serienstream.to", 4, false, "andere-serie"), anbieter).art, "loesen");
});

test("Raum und privater Eintrag bleiben bei Aliaswechsel getrennt und werden wiedergefunden", () => {
  const privat = eintrag("privat", "s.to");
  const raum = eintrag("raum", "186.2.175.5", 4, { watchpartyRoom: "Bangus" });
  assert.equal(fortschritt.watchpartyEintragFinden([privat, raum], "Bangus", folge("serienstream.cx")), raum);
  assert.equal(fortschritt.privaterEintragFinden([raum, privat], folge("serienstream.to")), privat);
  const stand = fortschritt.medienStandVerbuchen({ favoriten: [privat, raum], aktiverFavoritId: raum.id, watchpartyFuehrt: true },
    anbieter, folge("serienstream.cx"), { currentTime: 42, duration: 1390, watchedSeconds: 5 });
  assert.equal(stand.neu, false);
  assert.equal(stand.eintrag.id, raum.id);
  assert.equal(privat.currentTime, 37);
});

test("Bestehende private Avatar-Dubletten behalten Fortschritt, Verlauf und gesehene Folgen", () => {
  const liste = [eintrag("alt1", "s.to", 4, { activity: [{ at: "2026-01-01", url: folge("s.to"), label: "Geöffnet" }] }),
    eintrag("alt2", "serienstream.cx", 4, { customThumbnail: "eigenes-bild" }),
    eintrag("weiter", "186.2.175.5", 6, { currentTime: 0, duration: 0, continuePending: true,
      completedEpisodes: [{ key: "alt:s1:e3", season: 1, episode: 3 }] }),
    eintrag("raum", "186.2.175.5", 4, { watchpartyRoom: "Bangus" })];
  const urteil = watchlist.doppelteZusammenfuehren(liste);
  assert.equal(urteil.zusammengefuehrt, 2);
  assert.equal(liste.length, 2);
  const privat = liste.find(item => !item.watchpartyRoom);
  assert.equal(privat.id, "weiter");
  assert.equal(privat.episode, 6);
  assert.equal(privat.activity.length, 1);
  assert.equal(privat.completedEpisodes.length, 1);
  assert.equal(privat.customThumbnail, "eigenes-bild");
  assert.equal(liste.find(item => item.watchpartyRoom).id, "raum");
  assert.equal(watchlist.doppelteZusammenfuehren(liste).zusammengefuehrt, 0);
});

test("Alte S.to-Abschlusskennungen werden beim erneuten Melden nicht doppelt gezaehlt", () => {
  const url = folge("186.2.175.5", 3, true);
  const stand = eintrag("privat", "s.to", 3, { completedEpisodes: [{ key: "186.2.175.5:stream:s1:e3", url,
    season: 1, episode: 3, completedAt: "2026-01-01" }] });
  fortschritt.appendCompletedEpisode(stand, fortschritt.episodeIdentity(folge("serienstream.cx", 3)), folge("serienstream.cx", 3), "2026-01-02");
  assert.equal(stand.completedEpisodes.length, 1);
  assert.equal(stand.completedEpisodes[0].completedAt, "2026-01-01");
  const zweiteKopie = eintrag("zweite", "serienstream.cx", 3, { completedEpisodes: [{
    key: "serienstream.cx:avatar-die-sieben-hafen:s1:e3", url: folge("serienstream.cx", 3),
    season: 1, episode: 3, completedAt: "2026-01-02" }] });
  const liste = [stand, zweiteKopie];
  watchlist.doppelteZusammenfuehren(liste);
  assert.equal(liste[0].completedEpisodes.length, 1);
  assert.equal(liste[0].completedEpisodes[0].key, "s.to:avatar-die-sieben-hafen:s1:e3");
  stand.url = folge("serienstream.to", 4);
  assert.equal(fortschritt.repairTrimmedSeriesTail(stand, 1, 3), true);
  assert.equal(stand.episode, 3);
});

test("Neu endet beim Oeffnen der beworbenen oder spaeteren Folge, auch aus einer anderen Karte", () => {
  for (const nummer of [4, 5, 6]) {
    const liste = [eintrag("privat", "186.2.175.5", 6, { newEpisodeAt: "2026-01-01", newEpisodeLabel: "Folge 4 ist da" }),
      eintrag("raum", "s.to", 4, { watchpartyRoom: "Bangus", newEpisodeAt: "2026-01-01", newEpisodeLabel: "Folge 4 ist da" })];
    assert.equal(fortschritt.nachschubHinweisGeoeffnet(liste, folge("serienstream.cx", nummer)), true);
    assert.ok(liste.every(item => !item.newEpisodeAt && !item.newEpisodeLabel));
    assert.equal(liste[0].episode, 6);
    assert.equal(liste[0].completed, undefined);
    assert.equal(fortschritt.nachschubHinweisGeoeffnet(liste, folge("serienstream.cx", nummer)), false);
  }
});

test("Aeltere Folgen, andere Serien und Uebersichten lassen Neu stehen", () => {
  for (const url of [folge("s.to", 3), folge("s.to", 8, false, "andere-serie"), "https://s.to/serie/avatar-die-sieben-hafen/staffel-1"]) {
    const stand = eintrag("privat", "s.to", 6, { newEpisodeAt: "2026-01-01", newEpisodeLabel: "Folge 4 ist da" });
    assert.equal(fortschritt.nachschubHinweisGeoeffnet([stand], url), false);
    assert.ok(stand.newEpisodeAt);
  }
});

test("Neue Staffel und unveraenderte AniWorld/Filmo-Identitaeten", () => {
  const stand = eintrag("privat", "s.to", 1, { newEpisodeAt: "2026-01-01", newEpisodeLabel: "Staffel 2 ist da" });
  assert.equal(fortschritt.nachschubHinweisGeoeffnet([stand], folge("s.to", 9)), false);
  assert.equal(fortschritt.nachschubHinweisGeoeffnet([stand], folge("s.to", 1).replace("staffel-1", "staffel-2")), true);
  assert.equal(fortschritt.episodeIdentity("https://aniworld.to/anime/stream/naruto/staffel-1/episode-3").key, "aniworld.to:naruto");
  assert.equal(fortschritt.serienKennungAusUrl("https://filmo.to/movies/avatar-fire-and-ash"), "filmo.to:avatar-fire-and-ash");
  const aniUrl = "https://aniworld.to/anime/stream/naruto/staffel-1/episode-3";
  const ani = { url: aniUrl, normalizedUrl: aniUrl, newEpisodeAt: "2026-01-01", newEpisodeLabel: "Folge 3 ist da" };
  assert.equal(fortschritt.nachschubHinweisGeoeffnet([ani], aniUrl), true);
  assert.equal(fortschritt.favoritNachziehen(ani, aniUrl, { name: "AniWorld", startUrl: "https://aniworld.to/" }).art, "nichts");
  const filmUrl = "https://filmo.to/movies/avatar-fire-and-ash";
  assert.equal(fortschritt.favoritNachziehen({ url: filmUrl, normalizedUrl: filmUrl }, filmUrl,
    { name: "Filmo", startUrl: "https://filmo.to/" }).art, "nichts");
});

console.log(`${tests.filter(Boolean).length}/${tests.length} S.to-Fortschrittspruefungen bestanden`);
process.exitCode = tests.every(Boolean) ? 0 : 1;
