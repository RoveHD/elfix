"use strict";

const { groupProviderResults } = require("../shared/search-grouping");
const checks = [];
function check(name, condition) {
  checks.push(Boolean(condition));
  console.log(`${condition ? "OK  " : "FAIL"}  ${name}`);
}
const provider = (providerId, providerName, results) => ({ providerId, providerName, results });
const result = (title, url, extra = {}) => ({ title, url, ...extra });

let groups = groupProviderResults([
  provider("ani", "AniWorld", [result("Demon Slayer", "https://aniworld.to/a")]),
  provider("sto", "S.to", [result("Demon Slayer", "https://s.to/a")])
]);
check("gleicher Titel erscheint als ein Werk", groups.length === 1 && groups[0].entries.length === 2);

groups = groupProviderResults([
  provider("a", "AniWorld", [result("Dune", "https://a/dune", { year: 1984 })]),
  provider("b", "Filmo", [result("Dune", "https://b/dune", { year: 2021 })])
]);
check("Remakes mit abweichendem Jahr bleiben getrennt", groups.length === 2);

groups = groupProviderResults([
  provider("a", "AniWorld", [result("Arcane", "https://a/arcane", { type: "series", season: 1 })]),
  provider("b", "S.to", [result("Arcane", "https://b/arcane", { type: "series", season: 2 })])
]);
check("Staffeln bleiben getrennt", groups.length === 2);

groups = groupProviderResults([
  provider("yt", "YouTube", [result("Trailer", "https://youtube.com/watch?v=one")]),
  provider("yt", "YouTube", [result("Trailer", "https://youtube.com/watch?v=two")])
]);
check("verschiedene YouTube-Videos werden nie zusammengelegt", groups.length === 2);

groups = groupProviderResults([
  provider("a", "AniWorld", [result("Dune", "https://a/dune", { externeIds: { tmdb: "438631" }, konfidenz: "HIGH" })]),
  provider("b", "Filmo", [result("Dune Part Two", "https://b/dune", { externeIds: { tmdb: "438631" }, konfidenz: "EXACT" })])
]);
check("bestaetigte Metadaten-ID hat Vorrang vor Schreibweise", groups.length === 1);

groups = groupProviderResults([
  provider("a", "AniWorld", [result("Werk A", "https://a/a", { externeIds: { tmdb: "123" }, konfidenz: "HIGH" })]),
  provider("b", "Filmo", [result("Werk B", "https://b/b", { externeIds: { anilist: "123" }, konfidenz: "HIGH" })])
]);
check("gleichlautende IDs verschiedener Kataloge bleiben getrennt", groups.length === 2);

groups = groupProviderResults([
  provider("a", "AniWorld", [result("Werk", "https://a/film", { externeIds: { tmdb: "9" }, konfidenz: "HIGH", art: "film" })]),
  provider("b", "Filmo", [result("Werk", "https://b/serie", { externeIds: { tmdb: "9" }, konfidenz: "HIGH", art: "serie" })])
]);
check("eine ID hebt Medienart nicht auf", groups.length === 2);

groups = groupProviderResults([
  provider("a", "AniWorld", [result("Werk", "https://a/s1", { externeIds: { tmdb: "9" }, konfidenz: "HIGH", staffel: 1, folge: 2 })]),
  provider("b", "Filmo", [result("Werk", "https://b/s2", { externeIds: { tmdb: "9" }, konfidenz: "HIGH", staffel: 2, folge: 2 })])
]);
check("eine ID hebt Staffel und Folge nicht auf", groups.length === 2);

groups = groupProviderResults([
  provider("yt", "Andere Quelle", [result("Trailer", "https://youtu.be/one")]),
  provider("yt", "Andere Quelle", [result("Trailer", "https://youtu.be/two")])
]);
check("Kurz-YouTube-Adressen bleiben getrennt", groups.length === 2);

process.exit(checks.every(Boolean) ? 0 : 1);
