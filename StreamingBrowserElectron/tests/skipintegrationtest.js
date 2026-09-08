"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const metadaten = require("../src/metadaten");
const empfehlung = require("../src/empfehlungslauf");
const relayMetadaten = require("../../sync-server/metadaten");

(async () => {
  const tvdb = relayMetadaten.tmdbNormalform({ id: 1396, external_ids: { tvdb_id: 81189 } }, "serie", "HIGH");
  assert.equal(metadaten.verdichten(tvdb, "serie").externeIds.tvdb, 81189,
    "Bereits mitgelieferte TVDB-ID wird ohne Zusatzabruf bewahrt");
  const anime = "https://aniworld.to/anime/stream/beispiel";
  const serie = "https://s.to/serie/stream/beispiel";
  const film = "https://filmo.to/film/beispiel";
  let form = { konfidenz: "HIGH", externeIds: { mal: 9253, anilist: 9253 }, folgenGesamt: 24 };
  let netz = 0;
  const cache = { pages: {} };
  const client = { ausCache: () => form, wunschBauen: metadaten.wunschBauen,
    bereit: () => true, gesperrt: () => false,
    nachschlagen: async ([wunsch]) => { netz++; return new Map([[wunsch.schluessel,
      { konfidenz: "HIGH", externeIds: { imdb: "tt0903747", tmdb: 1396 } }]]); } };
  const lauf = empfehlung.erstellen({ cacheLesen: () => cache, metadaten: () => client,
    holen: () => { throw Error("Kein neuer Anbieterabruf fuer Skip-IDs"); } });
  const a = await lauf.skipKontext("Beispiel", `${anime}/staffel-1/episode-3`);
  assert.equal(a.malEpisode, 3);
  assert.equal(a.ids.mal, 9253);
  assert.equal(netz, 0, "MAL aus vorhandenem Cache benutzen");
  assert.equal((await lauf.skipKontext("Beispiel", `${anime}/staffel-2/episode-3`)).malEpisode, undefined,
    "Haupttitel-MAL-ID ist keine sichere Cour-Zuordnung");
  assert.equal((await lauf.skipKontext("Beispiel", `${anime}/staffel-1/episode-25`)).malEpisode, undefined);
  const af = await lauf.skipKontext("Beispiel", `${anime}/filme/film-1`);
  assert.equal(af.art, "film");
  assert.deepEqual(af.ids, {}, "Franchise-ID niemals auf einen Anime-Film uebertragen");
  form = { konfidenz: "LOW", externeIds: { tmdb: 123, imdb: "tt1234567" } };
  assert.deepEqual((await lauf.skipKontext("Beispiel", `${serie}/staffel-1/episode-2`)).ids, {});
  cache.pages[serie] = { meta: { imdb: "tt0903747" } };
  form = null;
  assert.equal((await lauf.skipKontext("Beispiel", `${serie}/staffel-1/episode-2`)).ids.imdb, "tt0903747");
  assert.equal(netz, 0, "Anbieter-IMDb benoetigt keine Metadatenabfrage");
  const f = await lauf.skipKontext("Beispiel", film);
  assert.equal(f.art, "film");
  assert.equal(f.ids.tmdb, 1396);
  assert.equal(netz, 1, "Fehlende ID geht durch vorhandene Metadatenlogik");
  client.nachschlagen = async () => { throw Error("Relay offline"); };
  assert.deepEqual((await lauf.skipKontext("Beispiel", film)).ids, {});
  assert.equal(await lauf.skipKontext("YouTube", "https://youtube.com/watch?v=test"), null);
  assert.equal(await lauf.skipKontext("Beispiel", anime), null);

  const code = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
  const start = code.indexOf("async function spielerSkipLesen(");
  const funktion = code.slice(start, code.indexOf("\n}", start) + 2);
  let antwort;
  let aufrufe = 0;
  const kontext = vm.createContext({ settings: { playback: { skipSegments: true } },
    spielerLauf: { id: 7, url: "folge-1", titel: "Serie" }, vomSpieler: e => e.echt,
    cleanBaseMediaTitle: x => x,
    lauf: { skipKontext: async () => ({ art: "serie", ids: { imdb: "tt0903747" } }) },
    skipClient: () => ({ lesen: () => { aufrufe++; return new Promise(resolve => { antwort = resolve; }); } }) });
  vm.runInContext(funktion, kontext);
  await kontext.spielerSkipLesen({ echt: false }, 7, 100);
  await kontext.spielerSkipLesen({ echt: true }, 6, 100);
  await kontext.spielerSkipLesen({ echt: true }, 7, Infinity);
  assert.equal(aufrufe, 0, "Fremde Absender, alte Auftraege und falsche Laufzeiten fragen nie das Netz");
  const pending = kontext.spielerSkipLesen({ echt: true }, 7, 100);
  await new Promise(setImmediate);
  kontext.spielerLauf = { id: 8, url: "folge-2" };
  antwort([{ type: "intro", start: 1, end: 10 }]);
  assert.equal((await pending).length, 0, "Alte Antwort erreicht neue Folge nicht");
  const off = kontext.spielerSkipLesen({ echt: true }, 8, 100);
  await new Promise(setImmediate);
  kontext.settings.playback.skipSegments = false;
  antwort([{ type: "intro", start: 1, end: 10 }]);
  assert.equal((await off).length, 0, "Ausschalten verwirft laufende Antwort");
  console.log("OK Skip-Integration: vorhandene IDs, sichere Anime-Zuordnung, fehlende Metadaten, IPC und Quellenwechsel");
})().catch(error => { console.error(error); process.exitCode = 1; });
