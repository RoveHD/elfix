"use strict";
const assert = require("node:assert/strict");
const server = require("../../sync-server/metadaten");
const client = require("../src/metadaten");
const discover = require("../src/discover");
const laufModul = require("../src/empfehlungslauf");

const tmdb = server.tmdbNormalform({ id: 1, name: "Silo", overview: "Die ganze Handlung.",
  genres: [{ name: "Drama" }, { name: "Science Fiction" }], vote_average: 8.2, vote_count: 900 }, "serie", "HIGH");
const verdichtet = client.verdichten(tmdb, "serie");
assert.equal(verdichtet.beschreibung, "Die ganze Handlung.");
assert.equal(verdichtet.bewertung, 8.2);
assert.equal(verdichtet.quelle, "tmdb");
const anime = client.verdichten(server.anilistNormalform({ id: 2, title: { english: "Anime" },
  description: "Vollstaendige Anime-Handlung.", averageScore: 85 }, "HIGH"), "anime");
assert.equal(anime.beschreibung, "Vollstaendige Anime-Handlung.");
assert.equal(anime.quelle, "anilist");
assert.equal(anime.bewertung, 8.5);
const url = "https://aniworld.to/anime/stream/beispiel";
const full = 'Die &quot;ganze&quot; Handlung &amp; mehr.';
const meta = discover.extractTitleMeta(`<p class="seri_des" itemprop="description" data-full-description="${full}">Nur der Anfang… mehr anzeigen</p>`, url);
assert.equal(meta.beschreibung, 'Die "ganze" Handlung & mehr.');
assert.equal(discover.extractTitleMeta('<p itemprop="description">Ein <b>voller</b> Text.</p>', url).beschreibung, "Ein voller Text.");
assert.equal(discover.extractTitleMeta("", url).beschreibung, "");
const cache = { pages: { [url]: { meta, genres: [{ label: "Action", key: "action" }] } } };
let external = verdichtet;
let network = 0;
const lauf = laufModul.erstellen({ cacheLesen: () => cache,
  metadaten: () => ({ ausCache: () => external, nachschlagen: () => { network++; throw Error("Netzabruf"); } }),
  holen: () => { network++; throw Error("Seitenabruf"); } });
const daten = lauf.titelAnzeige("Beispiel", url + "/staffel-1/episode-6");
assert.equal(daten.beschreibung, meta.beschreibung, "Anbieterbeschreibung hat Vorrang");
assert.deepEqual(daten.genres, ["Action"]);
assert.equal(daten.bewertung, 8.2);
delete cache.pages[url];
assert.equal(lauf.titelAnzeige("Beispiel", url).beschreibung, "Die ganze Handlung.", "Externer Cache ist Rueckfallquelle");
external = { ...verdichtet, konfidenz: "LOW" };
assert.equal(lauf.titelAnzeige("Beispiel", url).beschreibung, "", "Unsichere Zuordnung wird nicht als Handlung gezeigt");
external = null;
assert.deepEqual(lauf.titelAnzeige("Beispiel", url).genres, []);
assert.equal(network, 0, "Hero-Anzeige erzeugt keinen Netzabruf");
console.log("OK: Beschreibung, Genres und Quellenbewertung ueberleben die Datenstrecke; Hero liest nur vorhandene Caches.");
