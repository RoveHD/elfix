"use strict";
const assert = require("node:assert/strict");
const filler = require("../src/anime-filler");
let anzahl = 0;
async function pruefe(name, fn) {
  await fn();
  anzahl++;
  console.log("OK   " + name);
}
const zeile = (nummer, type, titel) => `<tr class="${type} odd" id="eps-${nummer}">
  <td class="Number">${nummer}</td><td class="Title"><a>${titel}</a></td><td class="Type">${type}</td></tr>`;
const indexHtml = '<a href="/shows/test-anime">Test Anime</a><a href="/shows/test-anime-sequel">Test Anime Sequel</a>';
const html = zeile(1, "manga_canon", "The first morning") + zeile(2, "mixed_canon/filler", "A new journey")
  + zeile(3, "filler", "Unexpected visitors") + zeile(4, "anime_canon", "The next morning")
  + zeile(25, "manga_canon", "The second beginning") + zeile(26, "mixed_canon/filler", "A later journey")
  + zeile(27, "filler", "A hidden visitor");
const daten = filler.episodenLesen(html);
const url = "https://aniworld.to/anime/stream/test-anime/staffel-1";
const folge = (nummer, staffel = 1, titel = "") => ({ staffel, folge: nummer, titel,
  url: `${url.replace(/staffel-1$/, `staffel-${staffel}`)}/episode-${nummer}`, gesperrt: false });
const stand = { titel: "Test Anime", staffeln: [{ staffel: 1, url }], folgen: [1, 2, 3, 4, 5].map(n => folge(n)) };
const response = (text, extra = {}) => ({ ok: true, text: async () => text, ...extra });
const sourceUrl = "https://www.animefillerlist.com/shows/test-anime";

(async () => {
  await pruefe("Vier explizite Kategorien, unbekannte und widerspruechliche Zeilen bleiben leer", () => {
    assert.equal(daten.length, 7);
    assert.deepEqual(daten.slice(0, 4).map(e => e.type), ["manga_canon", "mixed_canon/filler", "filler", "anime_canon"]);
    assert.deepEqual(filler.episodenLesen(zeile(1, "__proto__", "Falsch") + zeile(2, "canon", "Unknown")), []);
    assert.deepEqual(filler.episodenLesen(zeile(1, "manga_canon", "X") + zeile(1, "filler", "X")), []);
    assert.equal(filler.episodenLesen(zeile(1, "extra manga_canon even", "Rock &amp; Roll &#xD7; &#39;Go&#39;"))[0].titel,
      "Rock & Roll × 'Go'");
  });
  await pruefe("Index akzeptiert nur konkrete Show-Links; Namenssuche verwechselt keine Fortsetzung", () => {
    const index = filler.indexLesen(indexHtml + '<a href="https://evil.test/shows/x">Test Anime</a>'
      + '<a href="/shows/test-anime/episode-name">Episode</a><a href="//evil.test/shows/x">X</a>');
    assert.equal(index.length, 2);
    assert.equal(filler.serieFinden(index, stand, { url }).pfad, "/shows/test-anime");
    assert.equal(filler.serieFinden(index, { titel: "Test Anime Movie" }, {}), null);
    const jahre = filler.indexLesen('<a href="/shows/hunter-2011">Hunter x Hunter (2011)</a>'
      + '<a href="/shows/hunter-1999">Hunter x Hunter (1999)</a>');
    assert.equal(filler.serieFinden(jahre, { titel: "Hunter x Hunter" }, {}), null);
    assert.equal(filler.serieFinden(jahre, { titel: "Hunter × Hunter (2011)" }, {}).pfad, "/shows/hunter-2011");
    const doppelt = filler.indexLesen('<a href="/shows/a">Same</a><a href="/shows/b">Same</a>');
    assert.equal(filler.serieFinden(doppelt, { titel: "Same" }, {}), null);
    const varianten = filler.indexLesen('<a href="/shows/one-pace">One Pace (One Piece)</a>'
      + '<a href="/shows/one-piece">One Piece</a><a href="/shows/boruto">Boruto</a>'
      + '<a href="/shows/boruto-definitive">Boruto (Definitive)</a>');
    assert.equal(filler.serieFinden(varianten, { titel: "One Piece" }, {}).pfad, "/shows/one-piece");
    assert.equal(filler.serieFinden(varianten, { titel: "Boruto" }, {}).pfad, "/shows/boruto");
    assert.equal(filler.serieFinden(jahre, { titel: "Hunter x Hunter (2011)" },
      { url: "https://aniworld.to/anime/stream/hunter-1999" }).pfad, "/shows/hunter-2011");
  });
  await pruefe("Erste Staffel bekommt bekannte Labels; fehlende Daten bleiben unbekannt und Original unveraendert", () => {
    const result = filler.zuordnen(stand, daten, sourceUrl);
    assert.equal(result.folgen[0].filler.label, "Manga-Canon");
    assert.equal(result.folgen[2].filler.label, "Filler");
    assert.equal(result.folgen[4].filler, undefined);
    assert.equal(stand.folgen[0].filler, undefined);
    assert.equal(result.folgen[0].url, stand.folgen[0].url);
  });
  await pruefe("Spaetere Staffeln ohne belegten Offset und Filme erhalten keine erfundene Zuordnung", () => {
    const result = filler.zuordnen({ folgen: [folge(1, 2), folge(2, 2), folge(1, 0)] }, daten, sourceUrl);
    assert(result.folgen.every(f => !f.filler));
  });
  await pruefe("Zwei englische Titel belegen Staffel-Offset trotz deutscher Anzeige", () => {
    const a = { ...folge(1, 2, "Ein neuer Anfang"), titelAlternativen: ["The second beginning"] };
    const b = { ...folge(2, 2, "Eine neue Reise"), titelAlternativen: ["A later journey"] };
    const result = filler.zuordnen({ folgen: [a, b, folge(3, 2, "Ein Besucher")] }, daten, sourceUrl);
    assert.deepEqual(result.folgen.map(f => f.filler.episode), [25, 26, 27]);
    assert.equal(result.folgen[2].filler.type, "filler");
    assert.equal(result.folgen[0].titel, "Ein neuer Anfang");
  });
  await pruefe("Einzelne, doppelte und widerspruechliche Titel beweisen keinen Staffel-Offset", () => {
    const a = folge(1, 2, "The second beginning");
    const b = folge(2, 2, "Unexpected visitors");
    const c = folge(3, 2);
    const einzeln = filler.zuordnen({ folgen: [a, c] }, daten, sourceUrl);
    assert.equal(einzeln.folgen[0].filler.episode, 25);
    assert.equal(einzeln.folgen[1].filler, undefined);
    assert.equal(filler.zuordnen({ folgen: [a, b, c] }, daten, sourceUrl).folgen[2].filler, undefined);
    const doppelt = filler.zuordnen({ folgen: [a, c] }, [...daten, { episode: 99, type: "filler", titel: a.titel }], sourceUrl);
    assert(doppelt.folgen.every(f => !f.filler));
    const alt = filler.zuordnen({ folgen: [{ ...folge(999), filler: { type: "manga_canon" } }] }, daten, sourceUrl);
    assert.equal(alt.folgen[0].filler, undefined);
  });
  await pruefe("Nur Anime loesen anonyme GET-Anfragen aus; parallele Aufrufe und Neustart teilen den Cache", async () => {
    const requests = [];
    let saved;
    const client = filler.erstellen({ holen: async (adresse, options) => {
      requests.push(adresse);
      assert.equal(options.credentials, "omit");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, undefined);
      return response(adresse.endsWith("/shows") ? indexHtml : html);
    }, speichern: value => { saved = value; } });
    assert.equal(await client.anreichern(stand, { url: "https://s.to/serie/stream/test-anime/staffel-1" }), stand);
    assert.equal(requests.length, 0);
    const results = await Promise.all([client.anreichern(stand, { url }), client.anreichern(stand, { url })]);
    assert.equal(requests.length, 2);
    assert.equal(results[0].folgen[1].filler.type, "mixed_canon/filler");
    await client.anreichern(stand, { url });
    assert.equal(requests.length, 2);
    const cached = filler.erstellen({ laden: () => saved, holen: async () => { throw new Error("offline"); } });
    assert.equal((await cached.anreichern(stand, { url })).folgen[0].filler.label, "Manga-Canon");
  });
  await pruefe("Unbekannte Serien loesen keinen geratenen Show-Abruf aus", async () => {
    let calls = 0;
    const client = filler.erstellen({ holen: async () => { calls++; return response(indexHtml); } });
    await client.anreichern({ ...stand, titel: "Unbekannt" }, { art: "anime" });
    assert.equal(calls, 1);
  });
  await pruefe("Ausfall behaelt begrenzt vorhandene Daten und bremst wiederholte Fehlabrufe", async () => {
    let now = 100000, offline = false, calls = 0;
    const client = filler.erstellen({ jetzt: () => now, holen: async adresse => {
      calls++;
      if (offline) throw new Error("offline");
      return response(adresse.endsWith("/shows") ? indexHtml : html);
    } });
    await client.anreichern(stand, { url });
    offline = true;
    now += 2 * 86400000;
    assert.equal((await client.anreichern(stand, { url })).folgen[0].filler.type, "manga_canon");
    const vorher = calls;
    await client.anreichern(stand, { url });
    assert.equal(calls, vorher);
    now += 31 * 86400000;
    assert.equal((await client.anreichern(stand, { url })).folgen[0].filler, undefined);
  });
  await pruefe("Haengendes fetch oder Response-Body wird zeitlich begrenzt", async () => {
    for (const holen of [async () => new Promise(() => {}), async () => ({ ok: true, text: () => new Promise(() => {}) })]) {
      assert.equal(await filler.erstellen({ holen, timeoutMs: 25 }).anreichern(stand, { url }), stand);
    }
  });
  await pruefe("429, fremde Weiterleitung, riesige Antwort und kaputte Caches behindern die Folgen nicht", async () => {
    for (const antwort of [response("", { ok: false, status: 429 }), response(indexHtml, { url: "https://evil.test" }),
      response(indexHtml, { headers: { get: () => 9000000 } }), response("<html>No table</html>")]) {
      const client = filler.erstellen({ holen: async () => antwort, laden: () => { throw new Error("bad JSON"); } });
      assert.equal(await client.anreichern(stand, { url }), stand);
    }
  });
  console.log(`\n${anzahl}/${anzahl} bestanden`);
})().catch(error => { console.error(error); process.exitCode = 1; });
