"use strict";
// Das Metadaten-Tor des Relays.
//
// Geprueft wird nicht, dass TMDB antwortet - das tut es oder nicht. Geprueft
// wird, was passiert, wenn es das nicht tut: ob der Schluessel dichthaelt, ob
// ein Ausfall der fremden API hier stehen bleibt und ob aus dem Tor keine
// allgemeine Weiterleitung wird.
//
// Alle fremden Antworten sind gestellt. Ein Test, der ans Netz geht, prueft die
// Laune von jemand anderem.

const http = require("http");
const M = require("../../sync-server/metadaten");

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(b); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };

const GEHEIM = "geheimer-tmdb-schluessel-4711";

// --- Ein gestelltes Netz ----------------------------------------------------

function netzBauen(regeln) {
  const rufe = [];
  const holen = async (url, aufbau = {}) => {
    rufe.push({ url: String(url), aufbau });
    for (const regel of regeln) {
      if (!String(url).includes(regel.wenn)) continue;
      if (regel.verzoegern) await new Promise((f) => setTimeout(f, regel.verzoegern));
      if (regel.wirft) throw Object.assign(new Error(regel.wirft), { name: regel.wirft });
      return {
        ok: (regel.status || 200) < 400,
        status: regel.status || 200,
        json: async () => (typeof regel.daten === "function" ? regel.daten() : regel.daten)
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { holen, rufe };
}

const ANILIST_NARUTO = {
  id: 20, idMal: 20,
  title: { romaji: "NARUTO", english: "Naruto", native: "NARUTO -ナルト-" },
  synonyms: ["火影忍者"], format: "TV", status: "FINISHED",
  seasonYear: 2002, startDate: { year: 2002 }, endDate: { year: 2007 },
  episodes: 220, countryOfOrigin: "JP", isAdult: false,
  genres: ["Action", "Adventure"],
  tags: [
    { name: "Ninja", rank: 98, isMediaSpoiler: false, isGeneralSpoiler: false, category: "Theme-Action" },
    { name: "Shounen", rank: 95, isMediaSpoiler: false, isGeneralSpoiler: false, category: "Demographic" },
    { name: "Wer stirbt", rank: 60, isMediaSpoiler: true, isGeneralSpoiler: false, category: "Theme-Drama" }
  ],
  studios: { edges: [{ isMain: true, node: { name: "Studio Pierrot" } }] },
  popularity: 718718, averageScore: 80, favourites: 42914,
  relations: { edges: [
    { relationType: "SEQUEL", node: { id: 1735, type: "ANIME", format: "TV", seasonYear: 2007, title: { romaji: "NARUTO: Shippuuden", english: "Naruto: Shippuden" } } },
    { relationType: "ADAPTATION", node: { id: 30011, type: "MANGA", format: "MANGA", seasonYear: null, title: { romaji: "NARUTO", english: "Naruto" } } }
  ] }
};

const TMDB_IRONMAN = {
  id: 1726, title: "Iron Man", original_title: "Iron Man", release_date: "2008-04-30",
  imdb_id: "tt0371746", vote_average: 7.6, vote_count: 25000, popularity: 88.2,
  genres: [{ name: "Action" }, { name: "Science Fiction" }],
  belongs_to_collection: { id: 131292, name: "Iron Man Filmreihe" },
  production_companies: [{ name: "Marvel Studios" }],
  keywords: { keywords: [{ name: "marvel cinematic universe" }, { name: "superhero" }] },
  credits: { cast: [{ name: "Robert Downey Jr.", character: "Tony Stark" }],
    crew: [{ name: "Jon Favreau", job: "Director" }] },
  recommendations: { results: [{ id: 10138, title: "Iron Man 2" }] },
  alternative_titles: { titles: [{ title: "Iron Man 1" }] },
  external_ids: { imdb_id: "tt0371746" }
};

// --- Kleiner Server je Prueffall --------------------------------------------

async function mitDienst(optionen, arbeit) {
  const dienst = M.erstellen(optionen);
  const server = http.createServer((req, res) => {
    const pfad = String(req.url || "").split("?")[0];
    Promise.resolve(dienst.behandeln(req, res, pfad)).then((behandelt) => {
      if (!behandelt) { res.writeHead(404); res.end("nein"); }
    }).catch(() => { if (!res.headersSent) { res.writeHead(500); res.end("fehler"); } });
  });
  await new Promise((f) => server.listen(0, f));
  const port = server.address().port;
  const rufen = async (pfad, aufbau = {}) => {
    const antwort = await fetch(`http://127.0.0.1:${port}${pfad}`, aufbau);
    const roh = await antwort.text();
    let daten = null;
    try { daten = JSON.parse(roh); } catch { /* kein JSON */ }
    return { status: antwort.status, roh, daten, kopf: antwort.headers };
  };
  try {
    await arbeit({ rufen, dienst });
  } finally {
    dienst._stoppen();
    await new Promise((f) => server.close(f));
  }
}

const suchen = (titel) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ titel }) });

(async () => {
  // ======================================================= Kein TMDB-Schluessel
  await mitDienst({ tmdbSchluessel: "", fetch: netzBauen([]).holen }, async ({ rufen }) => {
    const status = await rufen("/metadata/status");
    pruefe("Ohne Schluessel: Status meldet unavailable",
      status.daten?.tmdb === "unavailable" && status.daten?.anilist === "available",
      JSON.stringify(status.daten && { tmdb: status.daten.tmdb, anilist: status.daten.anilist }));
    const film = await rufen("/metadata/lookup", suchen([{ id: "a", art: "film", titel: "Iron Man", jahr: 2008 }]));
    pruefe("Ohne Schluessel: Filmanfrage bleibt sauber ohne Treffer",
      film.status === 200 && film.daten.treffer[0].konfidenz === "UNMATCHED"
      && film.daten.treffer[0].fehler === "kein-schluessel",
      JSON.stringify(film.daten?.treffer?.[0]?.fehler));
    const werk = await rufen("/metadata/movie/1726");
    pruefe("Ohne Schluessel: Werkabfrage antwortet 503, nicht 500", werk.status === 503, "HTTP " + werk.status);
  });

  // ================================================================ Cache-Wege
  {
    const netz = netzBauen([
      { wenn: "anilist", daten: () => ({ data: { t0: { media: [ANILIST_NARUTO] } } }) }
    ]);
    await mitDienst({ tmdbSchluessel: GEHEIM, fetch: netz.holen }, async ({ rufen, dienst }) => {
      const erst = await rufen("/metadata/lookup", suchen([{ id: "n", art: "anime", titel: "Naruto", jahr: 2002 }]));
      const treffer = erst.daten.treffer[0];
      pruefe("Cache miss: AniList wird einmal gefragt", netz.rufe.length === 1, netz.rufe.length + " Aufrufe");
      pruefe("Zuordnung mit Name und Jahr ergibt EXACT", treffer.konfidenz === "EXACT", treffer.konfidenz);
      pruefe("Normalform traegt die Beziehung", treffer.relationen.some((r) => r.art === "SEQUEL" && r.titel.includes("Shippuden")),
        JSON.stringify(treffer.relationen.map((r) => r.art)));
      pruefe("Manga-Beziehungen fallen heraus", treffer.relationen.every((r) => r.art !== "ADAPTATION"));
      pruefe("Tags behalten den Rang von AniList",
        treffer.tags[0]?.name === "Ninja" && treffer.tags[0]?.rang === 98, JSON.stringify(treffer.tags[0]));
      pruefe("Spoiler-Tags werden entfernt", treffer.tags.every((t) => t.name !== "Wer stirbt"));
      pruefe("Keine erfundene Stimmenzahl", treffer.bewertungStimmen === 0 && treffer.bewertung === 8);
      pruefe("Empfehlungen und Beziehungen bleiben getrennt", Array.isArray(treffer.aehnlich) && treffer.aehnlich.length === 0);

      const zweit = await rufen("/metadata/lookup", suchen([{ id: "n", art: "anime", titel: "Naruto", jahr: 2002 }]));
      pruefe("Cache hit: kein zweiter Aufruf nach draussen", netz.rufe.length === 1, netz.rufe.length + " Aufrufe");
      pruefe("Cache hit liefert dasselbe", zweit.daten.treffer[0].externeIds.anilist === 20);
      pruefe("Statistik zaehlt Treffer und Fehlgriffe",
        dienst.statistik().cacheTreffer === 1 && dienst.statistik().cacheFehlgriffe === 1,
        JSON.stringify(dienst.statistik()));
    });
  }

  // =============================================== Gleichzeitige gleiche Anfrage
  {
    let laufende = 0;
    let hoechstens = 0;
    const netz = netzBauen([{
      wenn: "themoviedb", verzoegern: 40,
      daten: () => TMDB_IRONMAN
    }]);
    const gezaehlt = async (url, aufbau) => {
      laufende += 1;
      hoechstens = Math.max(hoechstens, laufende);
      try { return await netz.holen(url, aufbau); } finally { laufende -= 1; }
    };
    await mitDienst({ tmdbSchluessel: GEHEIM, fetch: gezaehlt }, async ({ rufen }) => {
      const alle = await Promise.all([1, 2, 3, 4, 5].map(() => rufen("/metadata/movie/1726")));
      pruefe("Fuenf gleichzeitige gleiche Anfragen: ein Abruf nach draussen",
        netz.rufe.length === 1, netz.rufe.length + " Aufrufe, hoechstens " + hoechstens + " gleichzeitig");
      pruefe("Alle fuenf bekommen dieselbe Antwort",
        alle.every((a) => a.status === 200 && a.daten.externeIds.tmdb === 1726));
      pruefe("Sammlung wird uebernommen", alle[0].daten.sammlung?.id === 131292, JSON.stringify(alle[0].daten.sammlung));
      pruefe("Schlagworte werden uebernommen", alle[0].daten.schlagworte.includes("marvel cinematic universe"));
      pruefe("Regie und Besetzung werden uebernommen",
        alle[0].daten.regie[0] === "Jon Favreau" && alle[0].daten.besetzung[0]?.name === "Robert Downey Jr.");
      pruefe("TMDB-Empfehlungen landen in `aehnlich`, nicht in `relationen`",
        alle[0].daten.aehnlich.length === 1 && alle[0].daten.relationen.length === 0);
    });
  }

  // ==================================================== Ausfaelle der Gegenseite
  for (const [name, regel, erwartet] of [
    ["Zeitgrenze", { wenn: "themoviedb", wirft: "TimeoutError" }, 502],
    ["HTTP 429", { wenn: "themoviedb", status: 429, daten: {} }, 502],
    ["HTTP 500", { wenn: "themoviedb", status: 500, daten: {} }, 502],
    ["kaputtes JSON", { wenn: "themoviedb", daten: () => { throw new Error("Unexpected token"); } }, 502]
  ]) {
    const netz = netzBauen([regel]);
    await mitDienst({ tmdbSchluessel: GEHEIM, fetch: netz.holen }, async ({ rufen }) => {
      const antwort = await rufen("/metadata/movie/1726");
      pruefe("Ausfall " + name + ": kontrollierter Fehlercode",
        antwort.status === erwartet, "HTTP " + antwort.status);
      pruefe("Ausfall " + name + ": keine Spur des Schluessels in der Antwort",
        !antwort.roh.includes(GEHEIM), antwort.roh.slice(0, 60));
    });
  }

  // Ein Ausfall darf nicht als "gibt es nicht" haengen bleiben.
  {
    let versuche = 0;
    const netz = netzBauen([{
      wenn: "anilist",
      daten: () => {
        versuche += 1;
        if (versuche === 1) throw new Error("Unexpected token");
        return { data: { t0: { media: [ANILIST_NARUTO] } } };
      }
    }]);
    await mitDienst({ tmdbSchluessel: GEHEIM, fetch: netz.holen }, async ({ rufen }) => {
      const erst = await rufen("/metadata/lookup", suchen([{ id: "n", art: "anime", titel: "Naruto", jahr: 2002 }]));
      pruefe("Nach einem Ausfall bleibt der Titel offen", erst.daten.treffer[0].fehler !== undefined,
        JSON.stringify(erst.daten.treffer[0].fehler));
      const zweit = await rufen("/metadata/lookup", suchen([{ id: "n", art: "anime", titel: "Naruto", jahr: 2002 }]));
      pruefe("Der naechste Versuch fragt wirklich erneut", zweit.daten.treffer[0].konfidenz === "EXACT",
        zweit.daten.treffer[0].konfidenz);
    });
  }

  // ================================================================= Fehlgriffe
  {
    const netz = netzBauen([
      { wenn: "anilist", daten: () => ({ data: { t0: { media: [] } } }) },
      { wenn: "/find/", daten: () => ({ movie_results: [], tv_results: [] }) },
      { wenn: "/search/", daten: () => ({ results: [] }) }
    ]);
    await mitDienst({ tmdbSchluessel: GEHEIM, fetch: netz.holen }, async ({ rufen }) => {
      const antwort = await rufen("/metadata/lookup", suchen([
        { id: "k", art: "anime", titel: "Die Legende von Korra", jahr: 2012 },
        { id: "x", art: "film", titel: "Gibt Es Nicht", jahr: 1999 }
      ]));
      pruefe("Nicht gefunden ist ein Ergebnis, kein Fehler",
        antwort.status === 200 && antwort.daten.treffer.every((t) => t.konfidenz === "UNMATCHED"),
        JSON.stringify(antwort.daten.treffer.map((t) => t.konfidenz)));
      const vorher = netz.rufe.length;
      await rufen("/metadata/lookup", suchen([{ id: "k", art: "anime", titel: "Die Legende von Korra", jahr: 2012 }]));
      pruefe("Negativ-Cache: kein zweiter Abruf fuer denselben Fehlgriff",
        netz.rufe.length === vorher, (netz.rufe.length - vorher) + " zusaetzliche Aufrufe");
    });
  }

  // ============================================ Falsche und unsinnige Eingaben
  {
    const netz = netzBauen([{ wenn: "themoviedb", daten: () => TMDB_IRONMAN }]);
    await mitDienst({ tmdbSchluessel: GEHEIM, fetch: netz.holen }, async ({ rufen }) => {
      const faelle = [
        ["ohne Titel", suchen([{ id: "a", art: "film" }]), 400],
        ["ohne Art", suchen([{ id: "a", titel: "Irgendwas" }]), 400],
        ["leere Liste", suchen([]), 400],
        ["kein JSON", { method: "POST", headers: { "content-type": "application/json" }, body: "{kaputt" }, 400],
        ["zu viele Titel", suchen(Array.from({ length: 40 }, (_, i) => ({ id: "t" + i, art: "anime", titel: "T" + i }))), 400]
      ];
      for (const [name, aufbau, erwartet] of faelle) {
        const antwort = await rufen("/metadata/lookup", aufbau);
        pruefe("Eingabe abgewiesen: " + name, antwort.status === erwartet, "HTTP " + antwort.status);
      }

      const unbekannt = await rufen("/metadata/movie/nichtszahl");
      pruefe("Unbekannte Route antwortet 404", unbekannt.status === 404, "HTTP " + unbekannt.status);
      const zuLang = await rufen("/metadata/lookup", suchen([{ id: "a", art: "anime", titel: "x".repeat(5000) }]));
      pruefe("Ueberlanger Titel wird gekuerzt statt abzustuerzen", zuLang.status === 200, "HTTP " + zuLang.status);

      // Es gibt keinen Weg, eine fremde Adresse unterzuschieben.
      for (const pfad of [
        "/metadata/proxy?url=https://api.themoviedb.org/3/movie/1726",
        "/metadata/movie/1726/../../../health",
        "/metadata/tv/1726%2F..%2F..%2Fsecret",
        "/metadata/movie/1726?api_key=fremd"
      ]) {
        const antwort = await rufen(pfad);
        const angefragt = netz.rufe.map((r) => r.url).join(" ");
        pruefe("Keine offene Weiterleitung: " + pfad.slice(0, 46),
          antwort.status === 404 || (antwort.status === 200 && !angefragt.includes("fremd")),
          "HTTP " + antwort.status);
      }
    });
  }

  // ================================================================= Taktbremse
  {
    const netz = netzBauen([{ wenn: "anilist", daten: () => ({ data: { t0: { media: [] } } }) }]);
    await mitDienst({ tmdbSchluessel: GEHEIM, fetch: netz.holen }, async ({ rufen }) => {
      let gebremst = 0;
      let letzte = null;
      for (let i = 0; i < M.GRENZEN.TAKT_ANFRAGEN + 5; i += 1) {
        letzte = await rufen("/metadata/lookup", suchen([{ id: "t" + i, art: "anime", titel: "Titel " + i }]));
        if (letzte.status === 429) gebremst += 1;
      }
      pruefe("Taktbremse greift je Adresse", gebremst > 0, gebremst + " von " + (M.GRENZEN.TAKT_ANFRAGEN + 5) + " abgewiesen");
      pruefe("Abweisung nennt eine Wartezeit",
        letzte.status !== 429 || Number(letzte.kopf.get("retry-after")) > 0,
        "retry-after=" + letzte.kopf.get("retry-after"));
      const status = await rufen("/metadata/status");
      pruefe("Status bleibt trotz Bremse erreichbar", status.status === 200, "HTTP " + status.status);
    });
  }

  // ================================================== Der Schluessel bleibt hier
  {
    const netz = netzBauen([
      { wenn: "themoviedb", daten: () => TMDB_IRONMAN },
      { wenn: "anilist", daten: () => ({ data: { t0: { media: [ANILIST_NARUTO] } } }) }
    ]);
    const ausgaben = [];
    const echtesLog = console.log;
    const echtesErr = console.error;
    console.log = (...a) => ausgaben.push(a.join(" "));
    console.error = (...a) => ausgaben.push(a.join(" "));
    await mitDienst({ tmdbSchluessel: GEHEIM, fetch: netz.holen }, async ({ rufen }) => {
      const antworten = [
        await rufen("/metadata/status"),
        await rufen("/metadata/movie/1726"),
        await rufen("/metadata/lookup", suchen([{ id: "n", art: "anime", titel: "Naruto", jahr: 2002 }])),
        await rufen("/metadata/gibtesnicht")
      ];
      console.log = echtesLog;
      console.error = echtesErr;
      pruefe("Der Schluessel steht in keiner Antwort",
        antworten.every((a) => !a.roh.includes(GEHEIM)),
        antworten.map((a) => a.status).join(","));
      pruefe("Der Schluessel steht in keiner Ausgabe",
        !ausgaben.join(" ").includes(GEHEIM), ausgaben.length + " Zeilen");
      pruefe("Der Schluessel geht nur an TMDB",
        netz.rufe.every((r) => !String(r.url).includes(GEHEIM) || String(r.url).startsWith("https://api.themoviedb.org")),
        netz.rufe.map((r) => String(r.url).replace(GEHEIM, "<SCHLUESSEL>").slice(0, 46)).join(" | "));
      pruefe("Der Status verraet nur, ob er da ist",
        antworten[0].daten.tmdb === "configured" && !JSON.stringify(antworten[0].daten).includes(GEHEIM));
    });
    console.log = echtesLog;
    console.error = echtesErr;
  }

  // ============================================ Zuordnung, die nicht raten darf
  {
    const HXH_1999 = { ...ANILIST_NARUTO, id: 136, title: { romaji: "HUNTER×HUNTER", english: "Hunter x Hunter", native: "" }, synonyms: [], seasonYear: 1999, startDate: { year: 1999 }, popularity: 133357, relations: { edges: [] } };
    const HXH_2011 = { ...HXH_1999, id: 11061, title: { romaji: "HUNTER×HUNTER (2011)", english: "Hunter x Hunter (2011)", native: "" }, seasonYear: 2011, popularity: 800000 };
    const netz = netzBauen([{ wenn: "anilist", daten: () => ({ data: { t0: { media: [HXH_1999, HXH_2011] } } }) }]);
    await mitDienst({ tmdbSchluessel: GEHEIM, fetch: netz.holen }, async ({ rufen }) => {
      const mitJahr = await rufen("/metadata/lookup", suchen([{ id: "h", art: "anime", titel: "Hunter x Hunter", jahr: 2011 }]));
      pruefe("Das Jahr entscheidet zwischen zwei Fassungen",
        mitJahr.daten.treffer[0].externeIds.anilist === 11061,
        "id=" + mitJahr.daten.treffer[0].externeIds.anilist + " jahr=" + mitJahr.daten.treffer[0].jahr);
      const ohneJahr = await rufen("/metadata/lookup", suchen([{ id: "h2", art: "anime", titel: "Hunter x Hunter" }]));
      pruefe("Ohne Jahr wird die Zuordnung nicht als sicher ausgegeben",
        ["HIGH", "MEDIUM", "LOW"].includes(ohneJahr.daten.treffer[0].konfidenz),
        ohneJahr.daten.treffer[0].konfidenz);
    });
  }

  const gut = pruefungen.filter(Boolean).length;
  console.log(`${gut}/${pruefungen.length} bestanden`);
  process.exit(gut === pruefungen.length ? 0 : 1);
})();
