"use strict";

const assert = require("assert");
const skipsegmente = require("../src/skipsegmente.js");

const pruefungen = [];
async function pruefe(name, arbeit) {
  try {
    await arbeit();
    pruefungen.push(true);
    console.log(`OK    ${name}`);
  } catch (fehler) {
    pruefungen.push(false);
    console.error(`FAIL  ${name}\n      ${fehler.stack || fehler.message}`);
  }
}

function antwort(daten, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? headers[name.toLowerCase()] ?? null },
    json: async () => daten
  };
}

const serie = {
  art: "serie",
  ids: { imdb: "tt0903747", tmdb: 1396 },
  season: 1,
  episode: 1,
  duration: 3500
};

(async () => {
  await pruefe("AniSkip wird nur mit ausdruecklicher MAL-Folge und echter Laufzeit gefragt", async () => {
    const urls = [];
    const client = skipsegmente.erstellen({
      holen: async (url) => {
        urls.push(url);
        if (url.includes("aniskip")) return antwort({
          found: true,
          results: [{
            interval: { startTime: 10, endTime: 80 },
            skipType: "op",
            skipId: "x",
            episodeLength: 1400
          }]
        });
        return antwort({}, { status: 404 });
      }
    });
    await client.lesen({ art: "anime", ids: { mal: 9253 }, episode: 1, duration: 1400 });
    assert(!urls.some((url) => url.includes("aniskip")));
    urls.length = 0;
    const segmente = await client.lesen({
      art: "anime", ids: { mal: 9253 }, episode: 1, malEpisode: 1, duration: 1400
    });
    assert(urls[0].includes("/v2/skip-times/9253/1?"));
    assert(urls[0].includes("episodeLength=1400"));
    assert.deepStrictEqual(segmente[0], {
      type: "intro", start: 10, end: 80, source: "AniSkip", confidence: null
    });
  });

  await pruefe("Prioritaet gilt je Segmenttyp und vollstaendige Treffer stoppen den Fallback", async () => {
    const urls = [];
    const client = skipsegmente.erstellen({ holen: async (url) => {
      urls.push(url);
      if (url.includes("skipdb")) return antwort({ segments: {
        intro: { start_ms: 10000, end_ms: 70000, match: "exact", confidence: 0.9 },
        recap: null,
        outro: { start_ms: 3400000, end_ms: 3500000, match: "exact", confidence: 0.8 },
        preview: { start_ms: 3300000, end_ms: 3390000, match: "exact", confidence: 0.7 }
      }, intro_length_estimate_ms: 60000 });
      if (url.includes("api.introdb.app")) return antwort({
        intro: { start_ms: 12000, end_ms: 72000, confidence: 1 },
        recap: { start_ms: 0, end_ms: 9000, confidence: 0.75 },
        outro: null
      });
      throw new Error("TheIntroDB darf nicht mehr gefragt werden");
    }});
    const segmente = await client.lesen(serie);
    assert.deepStrictEqual(segmente.map((s) => `${s.type}:${s.source}`), [
      "recap:IntroDB", "intro:SkipDB", "preview:SkipDB", "outro:SkipDB"
    ]);
    assert.strictEqual(urls.length, 2);
    assert.strictEqual(segmente.find((s) => s.type === "intro").start, 10);
  });

  await pruefe("SkipDB-Abwesenheit ist ein Ergebnis und sperrt nur diesen Typ", async () => {
    const urls = [];
    const client = skipsegmente.erstellen({ holen: async (url) => {
      urls.push(url);
      if (url.includes("skipdb")) return antwort({ segments: {
        intro: { start_ms: 0, end_ms: 0, match: "exact", confidence: 1 },
        recap: null, outro: null, preview: null
      }});
      if (url.includes("api.introdb.app")) return antwort({
        intro: { start_ms: 10000, end_ms: 70000, confidence: 1 },
        recap: { start_ms: 0, end_ms: 8000, confidence: 0.8 },
        outro: null
      });
      return antwort({ tmdb_id: 1396, type: "tv", intro: [{ start_ms: 20000, end_ms: 80000 }] });
    }});
    const segmente = await client.lesen(serie);
    const intro = segmente.filter((s) => s.type === "intro");
    assert.strictEqual(intro.length, 1);
    assert.strictEqual(intro[0].source, "SkipDB");
    assert.strictEqual(intro[0].absent, true);
    assert.strictEqual(segmente.find((s) => s.type === "recap").source, "IntroDB");
    assert.strictEqual(urls.length, 3);
  });

  await pruefe("Unsichere SkipDB-Laufzeit und Schaetzwerte werden verworfen", async () => {
    const client = skipsegmente.erstellen({ holen: async (url) => {
      if (url.includes("skipdb")) return antwort({ segments: {
        intro: { start_ms: 10000, end_ms: 70000, match: "out-of-range", confidence: 0.99 },
        recap: null, outro: null, preview: null
      }, intro_length_estimate_ms: 60000 });
      if (url.includes("api.introdb.app")) return antwort({ intro: null, recap: null, outro: null });
      return antwort({ tmdb_id: 1396, type: "tv" });
    }});
    assert.deepStrictEqual(await client.lesen(serie), []);
  });

  await pruefe("Eine falsche Antwortidentitaet faellt auf die naechste Quelle zurueck", async () => {
    const client = skipsegmente.erstellen({ holen: async (url) => {
      if (url.includes("skipdb")) return antwort({
        imdb_id: "tt9999999", season: 1, episode: 1,
        segments: { intro: { start_ms: 1000, end_ms: 60000, match: "exact" } }
      });
      if (url.includes("api.introdb.app")) return antwort({
        imdb_id: "tt0903747", season: 1, episode: 1,
        intro: { start_ms: 200000, end_ms: 243000, confidence: 0.8 }, recap: null, outro: null
      });
      return antwort({ tmdb_id: 9999, type: "tv" });
    }});
    const segmente = await client.lesen(serie);
    assert.strictEqual(segmente.find((s) => s.type === "intro")?.source, "IntroDB");
    assert(!segmente.some((s) => s.start === 1));
  });

  await pruefe("Starke Ueberlappung eines tieferen Segmenttyps erzeugt keinen zweiten Knopf", async () => {
    const client = skipsegmente.erstellen({ holen: async (url) => {
      if (url.includes("skipdb")) return antwort({ segments: {
        intro: { start_ms: 10000, end_ms: 70000, match: "exact" },
        recap: null, outro: null, preview: null
      }});
      if (url.includes("api.introdb.app")) return antwort({
        intro: null,
        recap: { start_ms: 20000, end_ms: 60000, confidence: 1 },
        outro: null
      });
      return antwort({ tmdb_id: 1396, type: "tv" });
    }});
    const segmente = await client.lesen(serie);
    assert.deepStrictEqual(segmente.map((s) => s.type), ["intro"]);
  });

  await pruefe("AniSkip mischt keine Inhaltssegmente ein und verlangt passende Laufzeit", async () => {
    const client = skipsegmente.erstellen({ holen: async (url) => {
      if (url.includes("aniskip")) return antwort({ found: true, results: [
        { interval: { startTime: 5, endTime: 65 }, skipType: "mixed-op", episodeLength: 1400 },
        { interval: { startTime: 70, endTime: 130 }, skipType: "op", episodeLength: 1450 },
        { interval: { startTime: 1320, endTime: 1399 }, skipType: "ed", episodeLength: 1402 }
      ] });
      return antwort({}, { status: 404 });
    }});
    const segmente = await client.lesen({
      art: "anime", ids: { mal: 9253 }, malEpisode: 1, duration: 1400
    });
    assert.deepStrictEqual(segmente.map((s) => s.type), ["outro"]);
    assert.strictEqual(segmente[0].start, 1320);
  });

  await pruefe("TheIntroDB behandelt dokumentierte Nullgrenzen und mehrere Abschnitte", async () => {
    const client = skipsegmente.erstellen({ holen: async (url) => {
      if (url.includes("skipdb")) return antwort({ segments: { intro: null, recap: null, outro: null, preview: null } });
      if (url.includes("api.introdb.app")) return antwort({ intro: null, recap: null, outro: null });
      return antwort({
        tmdb_id: 1396, type: "tv",
        intro: [
          { start_ms: null, end_ms: 90000, confidence: 0.9 },
          { start_ms: 300000, end_ms: 360000, confidence: 0.8 },
          { start_ms: 301000, end_ms: 359000, confidence: 0.2 }
        ],
        credits: [{ start_ms: 3400000, end_ms: null }],
        preview: [{ start_ms: null, end_ms: null, confidence: 1 }]
      });
    }});
    const segmente = await client.lesen(serie);
    assert.deepStrictEqual(segmente.filter((s) => !s.absent).map((s) => [s.type, s.start, s.end]), [
      ["intro", 0, 90], ["intro", 300, 360], ["outro", 3400, 3500]
    ]);
    assert.strictEqual(segmente.find((s) => s.type === "preview")?.absent, true);
  });

  await pruefe("Fremde Typen, Texte, Null und Grenzen ausserhalb des Videos kommen nicht durch", async () => {
    const client = skipsegmente.erstellen({ holen: async (url) => {
      if (url.includes("skipdb")) return antwort({ segments: {
        intro: { start_ms: "10000", end_ms: 70000, match: "exact" },
        recap: { start_ms: null, end_ms: 9000, match: "exact" },
        outro: { start_ms: 3400000, end_ms: 3600000, match: "exact" },
        preview: null,
        evil: { start_ms: 1, end_ms: 2 }
      }});
      if (url.includes("api.introdb.app")) return antwort({
        intro: null, recap: null,
        outro: { start_ms: 10, end_ms: 10, confidence: 1 }
      });
      return antwort({ tmdb_id: 1396, type: "tv", preview: [{ start_ms: NaN, end_ms: 20 }] });
    }});
    assert.deepStrictEqual(await client.lesen(serie), []);
  });

  await pruefe("SkipDB darf breitere lokale IMDb-Kennungen nutzen, strengere Dienste nicht", async () => {
    const urls = [];
    const client = skipsegmente.erstellen({ holen: async (url) => {
      urls.push(url);
      return antwort({ segments: {
        intro: { start_ms: 0, end_ms: 0, match: "exact" },
        recap: { start_ms: 0, end_ms: 0, match: "exact" },
        outro: { start_ms: 0, end_ms: 0, match: "exact" },
        preview: { start_ms: 0, end_ms: 0, match: "exact" }
      }});
    }});
    await client.lesen({ art: "film", ids: { imdb: "tt123456789" }, duration: 6000 });
    assert.strictEqual(urls.length, 1);
    assert(urls[0].includes("api.skipdb.tv"));
  });

  await pruefe("Uebergrosse Antworten werden vor dem JSON-Lesen verworfen", async () => {
    let jsonGelesen = false;
    const client = skipsegmente.erstellen({ holen: async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => name.toLowerCase() === "content-length" ? String(600 * 1024) : null },
      json: async () => { jsonGelesen = true; return {}; }
    }) });
    assert.deepStrictEqual(await client.lesen(serie), []);
    assert.strictEqual(jsonGelesen, false);
  });

  await pruefe("Gleiche gleichzeitige Leser teilen genau eine Anfragefolge", async () => {
    let anfragen = 0;
    let freigeben;
    const sperre = new Promise((resolve) => { freigeben = resolve; });
    const client = skipsegmente.erstellen({ holen: async (url) => {
      anfragen += 1;
      if (url.includes("skipdb")) {
        await sperre;
        return antwort({ segments: {
          intro: { start_ms: 10000, end_ms: 70000, match: "exact" },
          recap: { start_ms: 0, end_ms: 0, match: "exact" },
          outro: { start_ms: 0, end_ms: 0, match: "exact" },
          preview: { start_ms: 0, end_ms: 0, match: "exact" }
        }});
      }
      throw new Error("unerwarteter Fallback");
    }});
    const a = client.lesen(serie);
    const b = client.lesen(serie);
    freigeben();
    const [links, rechts] = await Promise.all([a, b]);
    assert.strictEqual(anfragen, 1);
    assert.deepStrictEqual(links, rechts);
    assert.notStrictEqual(links, rechts);
  });

  await pruefe("Timeout bleibt fail-open, auch wenn der Adapter Abort ignoriert", async () => {
    const client = skipsegmente.erstellen({
      timeoutMs: 25,
      holen: () => new Promise(() => {})
    });
    const beginn = Date.now();
    assert.deepStrictEqual(await client.lesen(serie), []);
    assert(Date.now() - beginn < 250);
  });

  await pruefe("429 beachtet Retry-After und probiert innerhalb des Budgets einmal neu", async () => {
    let n = 0;
    const client = skipsegmente.erstellen({ timeoutMs: 200, holen: async (url) => {
      n += 1;
      if (n === 1) return antwort({ error: "rate" }, { status: 429, headers: { "Retry-After": "0" } });
      if (url.includes("skipdb")) return antwort({ segments: {
        intro: { start_ms: 10000, end_ms: 70000, match: "exact" },
        recap: { start_ms: 0, end_ms: 0, match: "exact" },
        outro: { start_ms: 0, end_ms: 0, match: "exact" },
        preview: { start_ms: 0, end_ms: 0, match: "exact" }
      }});
      return antwort({}, { status: 404 });
    }});
    assert((await client.lesen(serie)).some((s) => s.type === "intro"));
    assert.strictEqual(n, 2);
  });

  await pruefe("Cache ist persistent, gekapselt und auf 512 Eintraege begrenzt", async () => {
    let gespeichert = null;
    let anfragen = 0;
    let uhr = 1000;
    const bauen = (laden) => skipsegmente.erstellen({
      jetzt: () => uhr,
      laden,
      speichern: (wert) => { gespeichert = wert; },
      holen: async () => {
        anfragen += 1;
        return antwort({ segments: {
          intro: { start_ms: 1000, end_ms: 2000, match: "exact" },
          recap: { start_ms: 0, end_ms: 0, match: "exact" },
          outro: { start_ms: 0, end_ms: 0, match: "exact" },
          preview: { start_ms: 0, end_ms: 0, match: "exact" }
        }});
      }
    });
    const erster = bauen(null);
    await erster.lesen(serie);
    assert.strictEqual(anfragen, 1);
    const zweiter = bauen(() => gespeichert);
    const ausCache = await zweiter.lesen(serie);
    assert.strictEqual(anfragen, 1);
    ausCache[0].start = 999;
    assert.notStrictEqual((await zweiter.lesen(serie))[0].start, 999);

    for (let i = 0; i < 520; i += 1) {
      uhr += 1;
      await zweiter.lesen({ ...serie, episode: i + 2 });
    }
    assert.strictEqual(Object.keys(zweiter.cache().eintraege).length, skipsegmente.CACHE_MAX);
  });

  await pruefe("Aktivitaet und deutsche Beschriftungen sind defensiv", async () => {
    const segmente = [
      { type: "intro", start: 0, end: 0, source: "SkipDB", confidence: 1, absent: true },
      { type: "recap", start: -1, end: 5, source: "x", confidence: null },
      { type: "intro", start: 10, end: 70, source: "AniSkip", confidence: null },
      { type: "outro", start: 3400, end: 3600, source: "x", confidence: null }
    ];
    assert.strictEqual(skipsegmente.aktiv(segmente, 20, 3500)?.source, "AniSkip");
    assert.strictEqual(skipsegmente.aktiv(segmente, 69.999, 3500)?.type, "intro");
    assert.strictEqual(skipsegmente.aktiv(segmente, 70, 3500), null);
    assert.strictEqual(skipsegmente.aktiv(segmente, 3450, 3500), null);
    assert.strictEqual(skipsegmente.beschriftung("recap"), "Rückblick überspringen");
    assert.strictEqual(skipsegmente.beschriftung("outro"), "Abspann überspringen");
  });

  const bestanden = pruefungen.filter(Boolean).length;
  console.log(`\n${bestanden}/${pruefungen.length} Skipsegment-Pruefungen bestanden.`);
  if (bestanden !== pruefungen.length) process.exitCode = 1;
})().catch((fehler) => {
  console.error(fehler.stack || fehler.message);
  process.exitCode = 1;
});
