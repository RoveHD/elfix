"use strict";

// Metadaten-Gateway des Relays.
//
// Warum liegt das hier und nicht in der App? Der TMDB-Schluessel darf nicht auf
// die Geraete. Alles, was in ein Electron-Bundle wandert, ist lesbar - eine
// EXE ist kein Versteck. Also fragt die App nicht TMDB, sondern dieses Relay,
// und das Relay kennt den Schluessel.
//
// Zwei Regeln halten das zusammen:
//
//   1. Es gibt keine allgemeine Weiterleitung. Kein "?url=", keine
//      durchgereichten Pfade. Nur die vier Funktionen unten, jede mit
//      geprueften Parametern. Sonst waere das hier ein oeffentliches
//      TMDB-Relay, und der Schluessel waere zwar geheim, aber verbraucht.
//
//   2. Nach aussen geht nur die Normalform. Weder rohe TMDB- noch rohe
//      AniList-Antworten verlassen den Server - schon damit kein Feld
//      versehentlich etwas mitnimmt, das niemanden angeht.
//
// Der Schluessel steht in der Umgebung (TMDB_API_TOKEN). Fehlt er, laeuft
// alles weiter: Anime kommt von AniList, Filme und Serien bleiben ohne
// Anreicherung. Das ist kein Fehlerfall, sondern ein Betriebszustand.

const ANILIST_URL = "https://graphql.anilist.co";
const TMDB_URL = "https://api.themoviedb.org/3";

// --- Grenzen ----------------------------------------------------------------

// AniList erlaubt gemessene 30 Anfragen je Minute. Eine Abfrage mit Aliassen
// zaehlt als eine, deshalb ist der Stapel keine Optimierung, sondern die
// Bedingung: einzeln waeren 60 Titel zwei Minuten.
const ANILIST_STAPEL = 10;
const ANFRAGE_TIMEOUT_MS = 9000;
// Hoechstens so viele Titel nimmt eine Sammelanfrage entgegen. Alles darueber
// ist kein Anwendungsfall mehr, sondern jemand, der den Dienst ausprobiert.
const MAX_STAPEL = 25;
const MAX_TITEL_LAENGE = 200;
const MAX_KOERPER = 64 * 1024;

// Wie lange gelten Antworten? TMDB erlaubt laut Nutzungsbedingungen hoechstens
// sechs Monate; so lange braucht es hier ohnehin nicht. Beziehungen und
// Sammlungen aendern sich selten, Bekanntheit staendig - deshalb zwei Werte.
const CACHE_MS = 14 * 24 * 60 * 60 * 1000;
const NEGATIV_CACHE_MS = 3 * 24 * 60 * 60 * 1000;
const CACHE_MAX = 5000;

// Je Adresse: so viele Anfragen in diesem Zeitfenster. Grosszuegig genug fuer
// einen Haushalt mit mehreren Geraeten, zu wenig fuer einen Fremden, der den
// Dienst als eigene TMDB-Anbindung benutzen moechte.
const TAKT_FENSTER_MS = 60 * 1000;
const TAKT_ANFRAGEN = 60;
const TAKT_TITEL = 300;

// --- Kleine Helfer ----------------------------------------------------------

function text(wert, laenge) {
  return String(wert === undefined || wert === null ? "" : wert).slice(0, laenge).trim();
}

function jahr(wert) {
  const zahl = Number.parseInt(String(wert || "").slice(0, 4), 10);
  return zahl >= 1900 && zahl <= 2100 ? zahl : 0;
}

function normalisieren(wert) {
  return String(wert || "").toLowerCase()
    .replace(/[‘’'`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const worte = (wert) => normalisieren(wert).split(" ").filter(Boolean);

// Wie gut deckt der gesuchte Name den gefundenen? Ein Praefix zaehlt fast voll:
// die Anbieter fuehren oft die Kurzform ("Demon Slayer" statt "Demon Slayer:
// Kimetsu no Yaiba"), und wer das als Fehltreffer wertet, verliert die
// haeufigsten Faelle.
function namensDeckung(suche, name) {
  const links = worte(suche);
  const rechts = worte(name);
  if (!links.length || !rechts.length) return 0;
  if (links.length === rechts.length && links.every((w, i) => w === rechts[i])) return 1;
  if (links.every((w, i) => rechts[i] === w)) return 0.9;
  if (rechts.every((w, i) => links[i] === w)) return 0.85;
  const menge = new Set(rechts);
  return (2 * links.filter((w) => menge.has(w)).length) / (links.length + rechts.length);
}

// --- Zwischenspeicher -------------------------------------------------------
//
// Zwei Ebenen liegen davor und dahinter: die App haelt ihren eigenen Cache, und
// dieser hier faengt ab, was mehrere Geraete gleichzeitig brauchen. Eine dritte
// Ebene waere eine Datenbank - dafuer ist die Datenmenge zu klein.

function cacheBauen(jetztFn) {
  const eintraege = new Map();
  return {
    lesen(schluessel) {
      const eintrag = eintraege.get(schluessel);
      if (!eintrag) return null;
      if (jetztFn() > eintrag.bis) {
        eintraege.delete(schluessel);
        return null;
      }
      // Wer gelesen wird, rutscht ans Ende - beim Aufraeumen fliegt das
      // Aelteste zuerst.
      eintraege.delete(schluessel);
      eintraege.set(schluessel, eintrag);
      return eintrag.wert;
    },
    schreiben(schluessel, wert, dauer) {
      eintraege.set(schluessel, { wert, bis: jetztFn() + dauer });
      while (eintraege.size > CACHE_MAX) {
        const aeltester = eintraege.keys().next().value;
        eintraege.delete(aeltester);
      }
    },
    groesse: () => eintraege.size,
    leeren: () => eintraege.clear()
  };
}

// --- Taktbremse je Adresse --------------------------------------------------

function taktBauen(jetztFn) {
  const adressen = new Map();
  return {
    pruefen(adresse, kosten) {
      const jetzt = jetztFn();
      const eintrag = adressen.get(adresse);
      if (!eintrag || jetzt - eintrag.seit > TAKT_FENSTER_MS) {
        adressen.set(adresse, { seit: jetzt, anfragen: 1, titel: kosten });
        return { erlaubt: true };
      }
      eintrag.anfragen += 1;
      eintrag.titel += kosten;
      if (eintrag.anfragen > TAKT_ANFRAGEN || eintrag.titel > TAKT_TITEL) {
        return { erlaubt: false, wartenS: Math.ceil((TAKT_FENSTER_MS - (jetzt - eintrag.seit)) / 1000) };
      }
      return { erlaubt: true };
    },
    aufraeumen() {
      const jetzt = jetztFn();
      for (const [adresse, eintrag] of adressen) {
        if (jetzt - eintrag.seit > TAKT_FENSTER_MS) adressen.delete(adresse);
      }
    },
    groesse: () => adressen.size
  };
}

// --- Normalform -------------------------------------------------------------
//
// Was die App zu sehen bekommt. Bewusst nicht die Struktur einer der beiden
// Quellen: sonst haengt die Empfehlungslogik an fremden Feldnamen, und ein
// zweiter Anbieter waere ein Umbau.
//
// Getrennt gehalten wird dabei, was verschieden ist:
//   relationen  belegte Beziehungen (Fortsetzung, Vorgaenger, Nebengeschichte)
//   aehnlich    fremde Empfehlungen - ein Hinweis, keine Aussage ueber Reihen
// Beides in einen Topf zu werfen waere die bequeme und falsche Loesung.

function leereNormalform(art) {
  return {
    quelle: "",
    externeIds: {},
    titel: "",
    originalTitel: "",
    altTitel: [],
    art,
    jahr: 0,
    bisJahr: 0,
    genres: [],
    tags: [],
    schlagworte: [],
    relationen: [],
    aehnlich: [],
    sammlung: null,
    studios: [],
    besetzung: [],
    regie: [],
    autoren: [],
    bewertung: null,
    bewertungStimmen: 0,
    beliebtheit: 0,
    altersfreigabe: null,
    konfidenz: "UNMATCHED"
  };
}

// --- AniList ----------------------------------------------------------------

const ANILIST_FELDER = `
  id idMal
  title { romaji english native }
  synonyms format status
  seasonYear startDate { year } endDate { year }
  episodes countryOfOrigin isAdult
  genres
  tags { name rank isMediaSpoiler isGeneralSpoiler category }
  studios { edges { isMain node { name } } }
  popularity averageScore favourites
  relations { edges { relationType node { id type format seasonYear title { romaji english } } } }
`;

// AniList sortiert seine Suche nach eigener Relevanz, und die ist hier
// unbrauchbar: "Demon Slayer" liefert zuerst einen Kurzfilm namens "Onigiri",
// dessen Synonym exakt passt, waehrend der gemeinte Titel auf Platz drei steht.
// POPULARITY_DESC dreht das gerade.
function anilistAbfrage(titel) {
  return "query {\n" + titel.map((wert, i) => (
    `  t${i}: Page(perPage: 6) { media(search: ${JSON.stringify(wert)}, type: ANIME, sort: POPULARITY_DESC) { ${ANILIST_FELDER} } }`
  )).join("\n") + "\n}";
}

function anilistNormalform(m, konfidenz) {
  const form = leereNormalform("anime");
  const tags = (m.tags || []).filter((t) => !t.isMediaSpoiler && !t.isGeneralSpoiler);
  form.quelle = "anilist";
  form.externeIds = { anilist: m.id, ...(m.idMal ? { mal: m.idMal } : {}) };
  form.titel = m.title?.english || m.title?.romaji || "";
  form.originalTitel = m.title?.native || m.title?.romaji || "";
  form.altTitel = [m.title?.romaji, m.title?.english, ...(m.synonyms || [])]
    .filter(Boolean).filter((wert, i, alle) => alle.indexOf(wert) === i).slice(0, 12);
  form.jahr = m.seasonYear || m.startDate?.year || 0;
  form.bisJahr = m.endDate?.year || 0;
  form.genres = m.genres || [];
  // Der Rang ist AniLists eigene Relevanzangabe - wie viele Nutzer den Tag fuer
  // zutreffend halten. Ein zweites Gewichtungssystem darueber waere Unfug.
  form.tags = tags.slice(0, 25).map((t) => ({ name: t.name, rang: t.rank, kategorie: t.category || "" }));
  form.relationen = (m.relations?.edges || [])
    .filter((k) => k?.node?.type === "ANIME")
    .map((k) => ({
      art: k.relationType,
      id: k.node.id,
      titel: k.node.title?.english || k.node.title?.romaji || "",
      format: k.node.format || "",
      jahr: k.node.seasonYear || 0
    })).slice(0, 30);
  form.studios = (m.studios?.edges || []).filter((e) => e.isMain).map((e) => e.node?.name).filter(Boolean);
  form.bewertung = typeof m.averageScore === "number" ? m.averageScore / 10 : null;
  // AniList nennt keine Stimmenzahl. `favourites` ist etwas anderes und wird
  // nicht als Stimmenzahl ausgegeben - eine erfundene Zahl waere schlimmer als
  // keine.
  form.bewertungStimmen = 0;
  form.beliebtheit = m.popularity || 0;
  form.altersfreigabe = m.isAdult ? 18 : null;
  form.konfidenz = konfidenz;
  return form;
}

// --- TMDB -------------------------------------------------------------------

// TMDB kennt zwei Arten der Anmeldung: den alten Schluessel als Parameter und
// das neuere Lesetoken im Kopf. Welches vorliegt, sieht man ihm an - ein Token
// ist ein JWT und beginnt mit "eyJ".
function tmdbKopfUndParameter(schluessel) {
  if (!schluessel) return null;
  if (schluessel.startsWith("eyJ")) {
    return { kopf: { authorization: "Bearer " + schluessel }, parameter: {} };
  }
  return { kopf: {}, parameter: { api_key: schluessel } };
}

function tmdbNormalform(roh, art, konfidenz) {
  const form = leereNormalform(art);
  const istFilm = art === "film";
  form.quelle = "tmdb";
  form.externeIds = { tmdb: roh.id, ...(roh.imdb_id ? { imdb: roh.imdb_id } : {}),
    ...(roh.external_ids?.imdb_id ? { imdb: roh.external_ids.imdb_id } : {}) };
  form.titel = istFilm ? (roh.title || "") : (roh.name || "");
  form.originalTitel = istFilm ? (roh.original_title || "") : (roh.original_name || "");
  form.altTitel = (roh.alternative_titles?.titles || roh.alternative_titles?.results || [])
    .map((t) => t.title).filter(Boolean).slice(0, 12);
  form.jahr = jahr(istFilm ? roh.release_date : roh.first_air_date);
  form.bisJahr = istFilm ? 0 : jahr(roh.last_air_date);
  form.genres = (roh.genres || []).map((g) => g.name).filter(Boolean);
  // TMDB gewichtet seine Schlagworte nicht. Sie kommen deshalb ohne Rang - eine
  // erfundene Gewichtung waere kein Fortschritt.
  form.schlagworte = (roh.keywords?.keywords || roh.keywords?.results || [])
    .map((k) => k.name).filter(Boolean).slice(0, 30);
  // Sammlungen gibt es bei TMDB nur fuer Filme. Fuer Serien ist das Feld nicht
  // etwa leer - es existiert nicht. Deshalb loest eine Film-Sammlung keine
  // Serien-Universen; das muss ueber Schlagworte laufen.
  form.sammlung = roh.belongs_to_collection
    ? { id: roh.belongs_to_collection.id, titel: roh.belongs_to_collection.name || "" }
    : null;
  form.studios = (roh.production_companies || []).map((c) => c.name).filter(Boolean).slice(0, 8);
  form.besetzung = (roh.credits?.cast || []).slice(0, 12)
    .map((p) => ({ name: p.name, rolle: p.character || "" })).filter((p) => p.name);
  form.regie = (roh.credits?.crew || []).filter((p) => p.job === "Director").map((p) => p.name).slice(0, 4);
  form.autoren = [
    ...(roh.created_by || []).map((p) => p.name),
    ...(roh.credits?.crew || []).filter((p) => p.job === "Writer" || p.job === "Screenplay").map((p) => p.name)
  ].filter(Boolean).filter((wert, i, alle) => alle.indexOf(wert) === i).slice(0, 5);
  // Fremde Empfehlungen sind ein Hinweis, keine Beziehung. Sie liegen deshalb
  // in einem eigenen Feld und werden nie zu `relationen`.
  form.aehnlich = (roh.recommendations?.results || []).slice(0, 12)
    .map((r) => ({ id: r.id, titel: r.title || r.name || "", art, quelle: "tmdb-empfehlung" }))
    .filter((r) => r.titel);
  form.bewertung = typeof roh.vote_average === "number" ? roh.vote_average : null;
  form.bewertungStimmen = roh.vote_count || 0;
  form.beliebtheit = roh.popularity || 0;
  form.konfidenz = konfidenz;
  return form;
}

// --- Der Dienst -------------------------------------------------------------

function erstellen(optionen = {}) {
  const jetztFn = optionen.jetzt || Date.now;
  const holen = optionen.fetch || globalThis.fetch;
  const tmdbSchluessel = text(optionen.tmdbSchluessel !== undefined
    ? optionen.tmdbSchluessel : process.env.TMDB_API_TOKEN, 300);
  const cache = cacheBauen(jetztFn);
  const takt = taktBauen(jetztFn);
  // Fragen zehn Geraete gleichzeitig nach demselben Titel, geht eine Anfrage
  // hinaus, nicht zehn.
  const laufend = new Map();
  const zaehler = {
    anfragen: 0, treffer: 0, fehlgriffe: 0,
    anilist: 0, tmdb: 0, fehler: 0, gebremst: 0
  };

  function statistik() {
    const gesamt = zaehler.treffer + zaehler.fehlgriffe;
    return {
      anfragen: zaehler.anfragen,
      cacheTreffer: zaehler.treffer,
      cacheFehlgriffe: zaehler.fehlgriffe,
      trefferquote: gesamt ? Number((zaehler.treffer / gesamt).toFixed(3)) : 0,
      cacheGroesse: cache.groesse(),
      anilistAnfragen: zaehler.anilist,
      tmdbAnfragen: zaehler.tmdb,
      fehler: zaehler.fehler,
      gebremst: zaehler.gebremst
    };
  }

  // Jede ausgehende Anfrage laeuft hierdurch: mit Zeitgrenze, ohne dass ein
  // Fehler nach oben durchschlaegt. Ein Ausfall der fremden API ist ein
  // fehlendes Ergebnis, kein Absturz.
  async function abrufen(url, aufbau) {
    const abbruch = AbortSignal.timeout(ANFRAGE_TIMEOUT_MS);
    try {
      const antwort = await holen(url, { ...aufbau, signal: abbruch });
      if (antwort.status === 429) return { fehler: "gebremst", status: 429 };
      if (!antwort.ok) return { fehler: "status", status: antwort.status };
      return { daten: await antwort.json() };
    } catch (fehler) {
      // Der Grund gehoert ins Journal, nicht in die Antwort - und schon gar
      // nicht die Adresse, in der bei TMDB der Schluessel steht.
      return { fehler: String(fehler?.name === "TimeoutError" ? "timeout" : "netz") };
    }
  }

  // Ergebnisse werden einmal geholt, auch wenn viele gleichzeitig fragen.
  function einmal(schluessel, arbeit) {
    const bekannt = laufend.get(schluessel);
    if (bekannt) return bekannt;
    const lauf = arbeit().finally(() => laufend.delete(schluessel));
    laufend.set(schluessel, lauf);
    return lauf;
  }

  // --- AniList ---------------------------------------------------------------

  async function anilistSuchen(titel) {
    zaehler.anilist += 1;
    const antwort = await abrufen(ANILIST_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query: anilistAbfrage(titel) })
    });
    if (antwort.fehler) {
      zaehler.fehler += 1;
      return { fehler: antwort.fehler };
    }
    if (antwort.daten?.errors) {
      zaehler.fehler += 1;
      return { fehler: "abfrage" };
    }
    return { daten: antwort.daten?.data || {} };
  }

  // Welcher der Treffer ist gemeint? Der Name allein entscheidet das nicht:
  // "Hunter x Hunter" gibt es von 1999 und von 2011, und ohne Jahr trifft man
  // die falsche. Deshalb bestimmt erst das Zusammenspiel aus Name und Jahr die
  // Konfidenz - und nur EXACT und HIGH duerfen spaeter starke Signale tragen.
  function anilistZuordnen(wunsch, kandidaten) {
    const bewertet = (kandidaten || []).map((m) => {
      const haupt = Math.max(
        namensDeckung(wunsch.titel, m.title?.romaji),
        namensDeckung(wunsch.titel, m.title?.english)
      );
      const ueberAlt = Math.max(0, ...(wunsch.altTitel || []).flatMap((a) => [
        namensDeckung(a, m.title?.romaji),
        namensDeckung(a, m.title?.english),
        namensDeckung(a, m.title?.native),
        ...(m.synonyms || []).map((s) => namensDeckung(a, s))
      ]));
      // Ein Synonym ist ein Hinweis, kein Beweis: "Onigiri" fuehrt "Demon
      // Slayer" als Synonym und ist trotzdem nicht gemeint.
      const ueberSyn = Math.max(0, ...(m.synonyms || []).map((s) => namensDeckung(wunsch.titel, s)));
      const name = Math.max(haupt, ueberAlt, ueberSyn * 0.7);
      const gefunden = m.seasonYear || m.startDate?.year || 0;
      const jahrPasst = wunsch.jahr && gefunden ? Math.abs(wunsch.jahr - gefunden) <= 1 : null;
      return { m, name, jahrPasst, beliebt: m.popularity || 0 };
    }).sort((a, b) => {
      // Ein passendes Jahr schlaegt einen minimal besseren Namen.
      const jahrA = a.jahrPasst === true ? 1 : 0;
      const jahrB = b.jahrPasst === true ? 1 : 0;
      return jahrB - jahrA || b.name - a.name || b.beliebt - a.beliebt;
    });

    const beste = bewertet[0];
    if (!beste || beste.name < 0.6) return null;
    let konfidenz = "LOW";
    if (beste.name >= 0.99 && beste.jahrPasst === true) konfidenz = "EXACT";
    else if (beste.name >= 0.85 && beste.jahrPasst === true) konfidenz = "HIGH";
    else if (beste.name >= 0.99 && beste.jahrPasst === null) konfidenz = "HIGH";
    else if (beste.name >= 0.85) konfidenz = "MEDIUM";
    return { m: beste.m, konfidenz };
  }

  // --- TMDB ------------------------------------------------------------------

  const tmdbAuth = tmdbKopfUndParameter(tmdbSchluessel);
  const tmdbBereit = () => Boolean(tmdbAuth);

  function tmdbAdresse(pfad, parameter = {}) {
    const url = new URL(TMDB_URL + pfad);
    for (const [name, wert] of Object.entries({ ...tmdbAuth.parameter, ...parameter })) {
      if (wert !== undefined && wert !== null && wert !== "") url.searchParams.set(name, String(wert));
    }
    return url;
  }

  async function tmdbHolen(pfad, parameter) {
    zaehler.tmdb += 1;
    return abrufen(tmdbAdresse(pfad, parameter).href, {
      headers: { accept: "application/json", ...tmdbAuth.kopf }
    });
  }

  // Alles, was ein Werk beschreibt, in einem Abruf. `append_to_response` haengt
  // die Unterabfragen an dieselbe Anfrage - ohne das waeren es fuenf.
  const TMDB_ANHANG = "keywords,credits,recommendations,alternative_titles,external_ids";

  async function tmdbWerk(art, id) {
    const pfad = (art === "film" ? "/movie/" : "/tv/") + encodeURIComponent(String(id));
    const antwort = await tmdbHolen(pfad, { append_to_response: TMDB_ANHANG, language: "de-DE" });
    if (antwort.fehler) {
      zaehler.fehler += 1;
      return null;
    }
    return antwort.daten || null;
  }

  // Der beste Weg zu einem TMDB-Werk fuehrt gar nicht ueber die Suche: die
  // Anbieterseiten von AniWorld und S.to tragen die IMDB-Kennung, und damit
  // loest TMDB ein Werk eindeutig auf. Kein Titelvergleich, kein Jahr, keine
  // Verwechslung zwischen zwei Verfilmungen desselben Stoffs.
  async function tmdbUeberImdb(imdb) {
    const antwort = await tmdbHolen("/find/" + encodeURIComponent(imdb), { external_source: "imdb_id" });
    if (antwort.fehler) {
      zaehler.fehler += 1;
      return null;
    }
    const film = (antwort.daten?.movie_results || [])[0];
    if (film) return { art: "film", id: film.id };
    const serie = (antwort.daten?.tv_results || [])[0];
    if (serie) return { art: "serie", id: serie.id };
    return null;
  }

  async function tmdbSuchen(wunsch) {
    const istFilm = wunsch.art === "film";
    const antwort = await tmdbHolen(istFilm ? "/search/movie" : "/search/tv", {
      query: wunsch.titel,
      ...(wunsch.jahr ? (istFilm ? { year: wunsch.jahr } : { first_air_date_year: wunsch.jahr }) : {}),
      include_adult: "false"
    });
    if (antwort.fehler) {
      zaehler.fehler += 1;
      return null;
    }
    const treffer = (antwort.daten?.results || []).map((r) => {
      const name = istFilm ? r.title : r.name;
      const original = istFilm ? r.original_title : r.original_name;
      const gefunden = jahr(istFilm ? r.release_date : r.first_air_date);
      const deckung = Math.max(namensDeckung(wunsch.titel, name), namensDeckung(wunsch.titel, original),
        ...(wunsch.altTitel || []).map((a) => namensDeckung(a, name)));
      const jahrPasst = wunsch.jahr && gefunden ? Math.abs(wunsch.jahr - gefunden) <= 1 : null;
      return { r, deckung, jahrPasst, beliebt: r.popularity || 0 };
    }).sort((a, b) => {
      const jahrA = a.jahrPasst === true ? 1 : 0;
      const jahrB = b.jahrPasst === true ? 1 : 0;
      return jahrB - jahrA || b.deckung - a.deckung || b.beliebt - a.beliebt;
    });
    const beste = treffer[0];
    if (!beste || beste.deckung < 0.6) return null;
    // Ohne Jahr bleibt es bei MEDIUM. Ein gleichnamiger Film aus einem anderen
    // Jahrzehnt ist genau der Fehler, den diese Schicht vermeiden soll -
    // "Spider-Man" gibt es mehrfach, und eine falsche Zuordnung ist schlechter
    // als gar keine.
    let konfidenz = "LOW";
    if (beste.deckung >= 0.99 && beste.jahrPasst === true) konfidenz = "EXACT";
    else if (beste.deckung >= 0.85 && beste.jahrPasst === true) konfidenz = "HIGH";
    else if (beste.deckung >= 0.85) konfidenz = "MEDIUM";
    return { id: beste.r.id, konfidenz };
  }

  // --- Auskunft je Titel -----------------------------------------------------

  function wunschSchluessel(wunsch) {
    return [wunsch.art, normalisieren(wunsch.titel), wunsch.jahr || "", wunsch.imdb || ""].join("|");
  }

  async function animeAufloesen(wunsch) {
    const lauf = await anilistSuchen([wunsch.titel]);
    if (lauf.fehler) return { fehler: lauf.fehler };
    const zuordnung = anilistZuordnen(wunsch, lauf.daten.t0?.media || []);
    return { form: zuordnung ? anilistNormalform(zuordnung.m, zuordnung.konfidenz) : null };
  }

  async function tmdbAufloesen(wunsch) {
    if (!tmdbBereit()) return { fehler: "kein-schluessel" };
    // Erst die eindeutige Kennung, dann erst die Suche.
    let art = wunsch.art === "film" ? "film" : "serie";
    let id = 0;
    let konfidenz = "";
    if (wunsch.imdb) {
      const ueberId = await tmdbUeberImdb(wunsch.imdb);
      if (ueberId) {
        art = ueberId.art;
        id = ueberId.id;
        konfidenz = "EXACT";
      }
    }
    if (!id) {
      const gesucht = await tmdbSuchen({ ...wunsch, art });
      if (gesucht) {
        id = gesucht.id;
        konfidenz = gesucht.konfidenz;
      }
    }
    if (!id) return { form: null };
    const roh = await tmdbWerk(art, id);
    return { form: roh ? tmdbNormalform(roh, art, konfidenz) : null };
  }

  // Ein einzelner Titel, mit Cache, Negativ-Cache und Zusammenlegung
  // gleichzeitiger Anfragen.
  async function aufloesen(wunsch) {
    const schluessel = wunschSchluessel(wunsch);
    const bekannt = cache.lesen(schluessel);
    if (bekannt) {
      zaehler.treffer += 1;
      return bekannt;
    }
    zaehler.fehlgriffe += 1;
    return einmal(schluessel, async () => {
      const ergebnis = wunsch.art === "anime" ? await animeAufloesen(wunsch) : await tmdbAufloesen(wunsch);
      if (ergebnis.fehler) {
        // Ein Ausfall wird nicht als "nicht gefunden" gemerkt - sonst haengt
        // ein Titel wegen einer Zeitgrenze tagelang fest.
        return { ...leereNormalform(wunsch.art), konfidenz: "UNMATCHED", fehler: ergebnis.fehler };
      }
      const form = ergebnis.form || { ...leereNormalform(wunsch.art), konfidenz: "UNMATCHED" };
      // Auch "nicht gefunden" ist ein Ergebnis: "Die Legende von Korra" ist bei
      // AniList kein Anime und wird es auch morgen nicht sein. Nur kuerzer
      // gemerkt, damit ein neuer Eintrag der Datenbank irgendwann ankommt.
      cache.schreiben(schluessel, form, form.konfidenz === "UNMATCHED" ? NEGATIV_CACHE_MS : CACHE_MS);
      return form;
    });
  }

  // Mehrere Anime auf einmal - der einzige Weg, unter dem AniList-Takt zu
  // bleiben. Was schon im Cache liegt, geht gar nicht erst hinaus.
  async function animeStapel(wuensche) {
    const ergebnisse = new Map();
    const offen = [];
    for (const wunsch of wuensche) {
      const schluessel = wunschSchluessel(wunsch);
      const bekannt = cache.lesen(schluessel);
      if (bekannt) {
        zaehler.treffer += 1;
        ergebnisse.set(wunsch.id, bekannt);
      } else {
        zaehler.fehlgriffe += 1;
        offen.push(wunsch);
      }
    }
    for (let i = 0; i < offen.length; i += ANILIST_STAPEL) {
      const teil = offen.slice(i, i + ANILIST_STAPEL);
      const lauf = await anilistSuchen(teil.map((w) => w.titel));
      teil.forEach((wunsch, n) => {
        if (lauf.fehler) {
          ergebnisse.set(wunsch.id, { ...leereNormalform("anime"), konfidenz: "UNMATCHED", fehler: lauf.fehler });
          return;
        }
        const zuordnung = anilistZuordnen(wunsch, lauf.daten["t" + n]?.media || []);
        const form = zuordnung
          ? anilistNormalform(zuordnung.m, zuordnung.konfidenz)
          : { ...leereNormalform("anime"), konfidenz: "UNMATCHED" };
        cache.schreiben(wunschSchluessel(wunsch), form, form.konfidenz === "UNMATCHED" ? NEGATIV_CACHE_MS : CACHE_MS);
        ergebnisse.set(wunsch.id, form);
      });
    }
    return ergebnisse;
  }

  // --- HTTP ------------------------------------------------------------------

  function antworten(res, status, koerper) {
    const daten = JSON.stringify(koerper);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(daten)
    });
    res.end(daten);
  }

  function adresseVon(req) {
    // Hinter einem Proxy steht die echte Adresse im Kopf. Nur der erste
    // Eintrag zaehlt, und nur so lang, dass er als Schluessel taugt.
    const weiter = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    return (weiter || req.socket?.remoteAddress || "unbekannt").slice(0, 60);
  }

  function koerperLesen(req) {
    return new Promise((fertig) => {
      let roh = "";
      let zuGross = false;
      req.on("data", (stueck) => {
        if (zuGross) return;
        roh += stueck;
        if (roh.length > MAX_KOERPER) {
          zuGross = true;
          roh = "";
        }
      });
      req.on("end", () => {
        if (zuGross) return fertig({ fehler: "zu-gross" });
        if (!roh) return fertig({ daten: {} });
        try {
          fertig({ daten: JSON.parse(roh) });
        } catch {
          fertig({ fehler: "kein-json" });
        }
      });
      req.on("error", () => fertig({ fehler: "abbruch" }));
    });
  }

  // Was aus dem Netz kommt, wird nicht uebernommen, sondern nachgebaut: nur
  // diese Felder, nur diese Typen, nur diese Laengen.
  function wunschPruefen(roh) {
    const art = ["anime", "film", "serie"].includes(roh?.art) ? roh.art : "";
    const titel = text(roh?.titel, MAX_TITEL_LAENGE);
    if (!art || !titel) return null;
    const imdb = /^tt\d{6,10}$/.test(String(roh?.imdb || "")) ? String(roh.imdb) : "";
    return {
      id: text(roh?.id, 120) || titel,
      art,
      titel,
      jahr: jahr(roh?.jahr),
      imdb,
      altTitel: Array.isArray(roh?.altTitel)
        ? roh.altTitel.slice(0, 8).map((wert) => text(wert, MAX_TITEL_LAENGE)).filter(Boolean)
        : []
    };
  }

  function zustand() {
    return {
      metadata: true,
      tmdb: tmdbBereit() ? "configured" : "unavailable",
      anilist: "available"
    };
  }

  // Die einzigen Wege nach draussen. Keine Adresse aus der Anfrage wird
  // weitergereicht, keine Route nimmt einen fremden Pfad entgegen.
  async function behandeln(req, res, pfad) {
    if (!pfad.startsWith("/metadata")) return false;

    if (pfad === "/metadata/status" && req.method === "GET") {
      antworten(res, 200, { ...zustand(), statistik: statistik() });
      return true;
    }

    const takterlaubnis = takt.pruefen(adresseVon(req), 1);
    if (!takterlaubnis.erlaubt) {
      zaehler.gebremst += 1;
      res.setHeader("retry-after", String(takterlaubnis.wartenS || 60));
      antworten(res, 429, { fehler: "zu-viele-anfragen", wartenS: takterlaubnis.wartenS || 60 });
      return true;
    }
    zaehler.anfragen += 1;

    if (pfad === "/metadata/lookup" && req.method === "POST") {
      const koerper = await koerperLesen(req);
      if (koerper.fehler) return antworten(res, 400, { fehler: koerper.fehler }), true;
      const roh = Array.isArray(koerper.daten?.titel) ? koerper.daten.titel : [];
      if (!roh.length) return antworten(res, 400, { fehler: "keine-titel" }), true;
      if (roh.length > MAX_STAPEL) return antworten(res, 400, { fehler: "zu-viele-titel", grenze: MAX_STAPEL }), true;
      const wuensche = roh.map(wunschPruefen).filter(Boolean);
      if (!wuensche.length) return antworten(res, 400, { fehler: "keine-gueltigen-titel" }), true;

      const nachTitelZahl = takt.pruefen(adresseVon(req), wuensche.length);
      if (!nachTitelZahl.erlaubt) {
        zaehler.gebremst += 1;
        res.setHeader("retry-after", String(nachTitelZahl.wartenS || 60));
        antworten(res, 429, { fehler: "zu-viele-titel-im-fenster", wartenS: nachTitelZahl.wartenS || 60 });
        return true;
      }

      const anime = wuensche.filter((w) => w.art === "anime");
      const rest = wuensche.filter((w) => w.art !== "anime");
      const ergebnisse = anime.length ? await animeStapel(anime) : new Map();
      for (const wunsch of rest) ergebnisse.set(wunsch.id, await aufloesen(wunsch));
      antworten(res, 200, {
        treffer: wuensche.map((wunsch) => ({ id: wunsch.id, ...(ergebnisse.get(wunsch.id) || leereNormalform(wunsch.art)) })),
        quellen: zustand()
      });
      return true;
    }

    const werk = pfad.match(/^\/metadata\/(anime|movie|tv)\/(\d{1,12})$/);
    if (werk && req.method === "GET") {
      const [, was, id] = werk;
      if (was === "anime") {
        const schluessel = "anime-id|" + id;
        const bekannt = cache.lesen(schluessel);
        if (bekannt) {
          zaehler.treffer += 1;
          antworten(res, 200, bekannt);
          return true;
        }
        zaehler.fehlgriffe += 1;
        const form = await einmal(schluessel, async () => {
          zaehler.anilist += 1;
          const antwort = await abrufen(ANILIST_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              query: `query ($id: Int) { Media(id: $id, type: ANIME) { ${ANILIST_FELDER} } }`,
              variables: { id: Number(id) }
            })
          });
          if (antwort.fehler || !antwort.daten?.data?.Media) {
            zaehler.fehler += 1;
            return null;
          }
          const gebaut = anilistNormalform(antwort.daten.data.Media, "EXACT");
          cache.schreiben(schluessel, gebaut, CACHE_MS);
          return gebaut;
        });
        if (!form) return antworten(res, 502, { fehler: "quelle-nicht-erreichbar" }), true;
        antworten(res, 200, form);
        return true;
      }

      if (!tmdbBereit()) return antworten(res, 503, { fehler: "tmdb-nicht-eingerichtet" }), true;
      const art = was === "movie" ? "film" : "serie";
      const schluessel = art + "-id|" + id;
      const bekannt = cache.lesen(schluessel);
      if (bekannt) {
        zaehler.treffer += 1;
        antworten(res, 200, bekannt);
        return true;
      }
      zaehler.fehlgriffe += 1;
      const form = await einmal(schluessel, async () => {
        const roh = await tmdbWerk(art, id);
        if (!roh) return null;
        const gebaut = tmdbNormalform(roh, art, "EXACT");
        cache.schreiben(schluessel, gebaut, CACHE_MS);
        return gebaut;
      });
      if (!form) return antworten(res, 502, { fehler: "quelle-nicht-erreichbar" }), true;
      antworten(res, 200, form);
      return true;
    }

    antworten(res, 404, { fehler: "unbekannte-metadaten-route" });
    return true;
  }

  const aufraeumTakt = setInterval(() => takt.aufraeumen(), TAKT_FENSTER_MS);
  aufraeumTakt.unref?.();

  return {
    behandeln,
    zustand,
    statistik,
    // Nur fuer Pruefungen: erlaubt einen sauberen Ausgangszustand.
    _cache: cache,
    _stoppen: () => clearInterval(aufraeumTakt)
  };
}

module.exports = {
  erstellen,
  // Ausgestellt, damit die Pruefungen die Bausteine einzeln fassen koennen.
  namensDeckung,
  normalisieren,
  leereNormalform,
  anilistNormalform,
  tmdbNormalform,
  GRENZEN: { MAX_STAPEL, TAKT_ANFRAGEN, TAKT_TITEL, TAKT_FENSTER_MS, CACHE_MS, NEGATIV_CACHE_MS, ANFRAGE_TIMEOUT_MS }
};
