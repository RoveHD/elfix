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
  assert.equal(a.malFolgenGesamt, 24);
  assert.equal(a.ids.mal, 9253);
  assert.equal(netz, 0, "MAL aus vorhandenem Cache benutzen");
  assert.equal((await lauf.skipKontext("Beispiel", `${anime}/staffel-2/episode-3`)).malEpisode, undefined,
    "Haupttitel-MAL-ID ist keine sichere Cour-Zuordnung");
  assert.equal((await lauf.skipKontext("Beispiel", `${anime}/staffel-1/episode-25`)).malEpisode, undefined);
  form = { konfidenz: "EXACT", externeIds: { mal: 34572, anilist: 97940 }, folgenGesamt: 170 };
  const staffelListen = (anzahlen = [51, 51, 52, 16]) => anzahlen.map((anzahl, index) => ({
    offeneStaffel: index + 1,
    staffeln: [0, 1, 2, 3, 4, 5].map(staffel => ({ staffel,
      url: staffel ? `${anime}/staffel-${staffel}` : `${anime}/filme` })),
    folgen: Array.from({ length: anzahl }, (_, i) => ({ staffel: index + 1, folge: i + 1,
      url: `${anime}/staffel-${index + 1}/episode-${i + 1}`, gesperrt: false }))
  }));
  const absolut = (season, episode, listen = staffelListen()) => lauf.skipKontext("Black Clover",
    `${anime}/staffel-${season}/episode-${episode}`, { staffelListen: listen });
  for (const [season, episode, erwartet] of [[1, 51, 51], [2, 1, 52], [2, 20, 71], [2, 28, 79],
    [2, 51, 102], [3, 1, 103], [3, 52, 154], [4, 1, 155], [4, 16, 170]]) {
    assert.equal((await absolut(season, episode)).malEpisode, erwartet,
      "Vollstaendiger 170-Folgen-Eintrag verteilt sich auf vier belegte Anbieter-Staffeln");
  }
  assert.equal((await absolut(2, 20, staffelListen().reverse())).malEpisode, 71);
  assert.equal((await absolut(5, 1)).malEpisode, undefined, "Naechste echte Staffel gehoert nicht zur alten MAL-ID");
  assert.equal((await absolut(4, 17)).malEpisode, undefined, "Episode fehlt in der belegten Aufteilung");
  for (const [grund, veraendern] of [
    ["Unvollstaendiger Prefix", () => staffelListen([51, 51])],
    ["Fehlende Folge", () => staffelListen([51, 51, 52, 15])],
    ["Ueberschrittene MAL-Laenge", () => staffelListen([51, 51, 52, 16, 3])],
    ["Luecke", listen => { listen[0].folgen[1].folge = 3; return listen; }],
    ["Doppelte Folge", listen => { listen[0].folgen[1] = listen[0].folgen[0]; return listen; }],
    ["Doppelte Staffel", listen => { listen[2].offeneStaffel = 2; return listen; }],
    ["Fehlender Staffel-Link", listen => { listen[0].staffeln.splice(2, 1); return listen; }],
    ["Fremde Serie", listen => { listen[0].folgen[0].url = `${anime}-fremd/staffel-1/episode-1`; return listen; }],
    ["Fremder Anbieter", listen => { listen[0].folgen[0].url = `${anime.replace("aniworld.to", "fremd.test")}/staffel-1/episode-1`; return listen; }],
    ["Fremder Staffel-Link", listen => { listen[0].staffeln[1].url = `${anime}-fremd/staffel-1`; return listen; }],
    ["Widerspruechliche Folgen-URL", listen => { listen[0].folgen[0].url = `${anime}/staffel-1/episode-2`; return listen; }],
    ["Gesperrte Doppelfolgen-Zeile", listen => { listen[0].folgen[0].gesperrt = true; return listen; }],
    ["Filmsammlung", listen => { listen[0].folgen[0] = { staffel: 0, folge: 1, url: `${anime}/filme/film-1` }; return listen; }]
  ]) {
    assert.equal((await absolut(2, 20, veraendern(staffelListen()))).malEpisode, undefined, grund);
  }
  form = { ...form, folgenGesamt: 0 };
  const ohneMalLaenge = await absolut(2, 20);
  assert.equal(ohneMalLaenge.malEpisode, undefined, "Ohne MAL-Laenge keine sichere absolute Zuordnung");
  assert.equal(ohneMalLaenge.malFolgenGesamt, undefined);
  form = { ...form, folgenGesamt: 170, konfidenz: "LOW" };
  assert.deepEqual((await absolut(2, 20)).ids, {}, "Vollstaendige Folgenlisten heilen keine unsichere Werks-ID");
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

  let animeAnfragen = 0;
  const animeLauf = empfehlung.erstellen({
    cacheLesen: () => ({ pages: { [anime]: { meta: { imdb: "tt0988824", jahr: 2007 } } } }),
    metadaten: () => ({ ausCache: () => null, wunschBauen: metadaten.wunschBauen,
      bereit: () => true, gesperrt: () => false,
      nachschlagen: async ([wunsch]) => {
        animeAnfragen++;
        assert.equal(wunsch.art, "anime");
        assert.equal(wunsch.imdb, "tt0988824", "Anbieter-ID bleibt Teil der geprueften Metadatenanfrage");
        assert.equal(wunsch.jahr, 2007);
        return new Map([[wunsch.schluessel,
          { konfidenz: "HIGH", externeIds: { mal: 1735 }, folgenGesamt: 500 }]]);
      } }),
    holen: () => { throw Error("Kein neuer Anbieterabruf fuer Skip-IDs"); }
  });
  const animeMitImdb = await animeLauf.skipKontext("Naruto Shippuden", `${anime}/staffel-1/episode-3`);
  assert.equal(animeAnfragen, 1, "Anbieter-IMDb ersetzt bei Anime keine MAL-Aufloesung");
  assert.equal(animeMitImdb.ids.imdb, "tt0988824");
  assert.equal(animeMitImdb.ids.mal, 1735);
  assert.equal(animeMitImdb.malEpisode, 3);

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
  console.log("OK Skip-Integration: vorhandene IDs, vollstaendige Anime-Staffelaufteilung, fehlende Metadaten, IPC und Quellenwechsel");
})().catch(error => { console.error(error); process.exitCode = 1; });
