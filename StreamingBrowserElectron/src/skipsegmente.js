"use strict";

// Gemeinsamer Leser fuer oeffentliche Intro-, Rueckblick-, Abspann- und
// Vorschauzeiten. Alle Zeiten, die dieses Modul verlaesst, sind Sekunden.
(function veroeffentlichen(fabrik) {
  const api = fabrik();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.ElfixSkipsegmente = api;
})(function bauen() {
  const CACHE_VERSION = 1;
  const CACHE_MAX = 512;
  const GUT_MS = 7 * 24 * 60 * 60 * 1000;
  const LEER_MS = 6 * 60 * 60 * 1000;
  const FEHLER_MS = 5 * 60 * 1000;
  const STANDARD_TIMEOUT_MS = 3000;
  const MAX_GLEICHZEITIG = 3;
  const MAX_ANTWORT_BYTES = 512 * 1024;
  const TYPEN = ["intro", "recap", "outro", "preview"];
  const PRIORITAET = {
    anime: ["aniskip", "skipdb", "introdb", "theintrodb"],
    serie: ["skipdb", "introdb", "theintrodb"],
    film: ["skipdb", "theintrodb"]
  };
  const QUELLEN_TYPEN = {
    aniskip: new Set(["intro", "recap", "outro"]),
    skipdb: new Set(TYPEN),
    introdb: new Set(["intro", "recap", "outro"]),
    theintrodb: new Set(TYPEN)
  };

  function echteZahl(wert) {
    return typeof wert === "number" && Number.isFinite(wert);
  }

  function positiveGanzzahl(wert) {
    return Number.isInteger(wert) && wert > 0;
  }

  function artAus(wert) {
    const art = String(wert || "").toLowerCase();
    return Object.prototype.hasOwnProperty.call(PRIORITAET, art) ? art : null;
  }

  function imdbAus(wert, minimum = 6, maximum = 10) {
    const imdb = String(wert || "").trim();
    const treffer = /^tt(\d+)$/.exec(imdb);
    return treffer && treffer[1].length >= minimum && treffer[1].length <= maximum ? imdb : null;
  }

  function dauerAus(wert) {
    return echteZahl(wert) && wert > 0 ? wert : null;
  }

  function zeitAus(jetzt) {
    const wert = typeof jetzt === "function" ? jetzt() : Date.now();
    if (wert instanceof Date) return wert.getTime();
    return echteZahl(wert) ? wert : Date.now();
  }

  function kopie(segmente) {
    return Array.isArray(segmente) ? segmente.map((segment) => ({ ...segment })) : [];
  }

  function cacheSchluessel(context) {
    const art = artAus(context?.art) || "?";
    const ids = context?.ids || {};
    const dauer = dauerAus(context?.duration);
    return [
      `v${CACHE_VERSION}`, art,
      positiveGanzzahl(ids.mal) ? ids.mal : "",
      imdbAus(ids.imdb) || "",
      positiveGanzzahl(ids.tmdb) ? ids.tmdb : "",
      positiveGanzzahl(ids.tvdb) ? ids.tvdb : "",
      positiveGanzzahl(ids.anilist) ? ids.anilist : "",
      positiveGanzzahl(context?.season) ? context.season : "",
      positiveGanzzahl(context?.episode) ? context.episode : "",
      positiveGanzzahl(context?.malEpisode) ? context.malEpisode : "",
      dauer == null ? "" : Math.round(dauer * 10) / 10
    ].join("|");
  }

  function beschriftung(type) {
    return ({
      intro: "Intro überspringen",
      recap: "Rückblick überspringen",
      outro: "Abspann überspringen",
      preview: "Vorschau überspringen"
    })[type] || "Segment überspringen";
  }

  function aktiv(segmente, zeit, dauer) {
    if (!Array.isArray(segmente) || !echteZahl(zeit) || zeit < 0) return null;
    const grenze = dauerAus(dauer);
    for (const segment of segmente) {
      if (!segment || segment.absent === true || !TYPEN.includes(segment.type)) continue;
      if (!echteZahl(segment.start) || !echteZahl(segment.end)) continue;
      if (segment.start < 0 || segment.end <= segment.start) continue;
      if (grenze != null && (segment.start >= grenze || segment.end > grenze)) continue;
      if (zeit >= segment.start && zeit < segment.end) return segment;
    }
    return null;
  }

  function erstellen(optionen = {}) {
    const holen = typeof optionen.holen === "function"
      ? optionen.holen
      : (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    const laden = typeof optionen.laden === "function" ? optionen.laden : null;
    const speichern = typeof optionen.speichern === "function" ? optionen.speichern : null;
    const jetzt = typeof optionen.jetzt === "function" ? optionen.jetzt : Date.now;
    const timeoutMs = echteZahl(optionen.timeoutMs)
      ? Math.max(25, Math.min(STANDARD_TIMEOUT_MS, optionen.timeoutMs))
      : STANDARD_TIMEOUT_MS;
    const eintraege = new Map();
    const laufend = new Map();
    const urlLaufend = new Map();
    const hostPause = new Map();
    const wartende = [];
    let aktivAnfragen = 0;

    cacheLaden();

    function cacheLaden() {
      if (!laden) return;
      try {
        const roh = laden();
        if (!roh || roh.version !== CACHE_VERSION || !roh.eintraege || typeof roh.eintraege !== "object") return;
        for (const [key, wert] of Object.entries(roh.eintraege)) {
          if (!wert || !echteZahl(wert.at) || !["gut", "leer", "fehler"].includes(wert.status)) continue;
          if (!Array.isArray(wert.segmente)) continue;
          eintraege.set(key, { at: wert.at, status: wert.status, segmente: kopie(wert.segmente) });
        }
        beschneiden();
      } catch (_) {
        // Ein kaputter lokaler Cache darf die Wiedergabe nie blockieren.
      }
    }

    function cacheObjekt() {
      const objekt = {};
      for (const [key, wert] of eintraege) objekt[key] = { ...wert, segmente: kopie(wert.segmente) };
      return { version: CACHE_VERSION, eintraege: objekt };
    }

    function cacheSpeichern() {
      if (!speichern) return;
      try {
        const ergebnis = speichern(cacheObjekt());
        if (ergebnis && typeof ergebnis.catch === "function") ergebnis.catch(() => {});
      } catch (_) {
        // Persistenz ist eine Optimierung, kein Grund die Funktion abzubrechen.
      }
    }

    function beschneiden() {
      if (eintraege.size <= CACHE_MAX) return;
      const alt = [...eintraege.entries()].sort((a, b) => a[1].at - b[1].at);
      for (let i = 0; i < alt.length - CACHE_MAX; i += 1) eintraege.delete(alt[i][0]);
    }

    function gueltig(wert) {
      const ttl = wert.status === "gut" ? GUT_MS : wert.status === "leer" ? LEER_MS : FEHLER_MS;
      return zeitAus(jetzt) - wert.at < ttl;
    }

    function merken(key, status, segmente) {
      eintraege.delete(key);
      eintraege.set(key, { at: zeitAus(jetzt), status, segmente: kopie(segmente) });
      beschneiden();
      cacheSpeichern();
    }

    function semaphore(arbeit) {
      return new Promise((resolve, reject) => {
        const starten = () => {
          aktivAnfragen += 1;
          Promise.resolve().then(arbeit).then(resolve, reject).finally(() => {
            aktivAnfragen -= 1;
            const naechste = wartende.shift();
            if (naechste) naechste();
          });
        };
        if (aktivAnfragen < MAX_GLEICHZEITIG) starten();
        else wartende.push(starten);
      });
    }

    function header(antwort, name) {
      try {
        if (antwort?.headers?.get) return antwort.headers.get(name);
        const headers = antwort?.headers || {};
        const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
        return key ? headers[key] : null;
      } catch (_) {
        return null;
      }
    }

    function retryNachMs(antwort) {
      const roh = header(antwort, "Retry-After");
      if (roh == null) return 60 * 1000;
      const sekunden = Number(roh);
      if (Number.isFinite(sekunden) && sekunden >= 0) return Math.ceil(sekunden * 1000);
      const datum = Date.parse(String(roh));
      return Number.isFinite(datum) ? Math.max(0, datum - Date.now()) : 60 * 1000;
    }

    function textBytes(text) {
      if (typeof TextEncoder === "function") return new TextEncoder().encode(text).byteLength;
      if (typeof Buffer !== "undefined") return Buffer.byteLength(text, "utf8");
      return text.length * 2;
    }

    function schlafen(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function einmal(url, restMs) {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      let timer = null;
      const grenze = new Promise((_, reject) => {
        timer = setTimeout(() => {
          try { controller?.abort(); } catch (_) {}
          reject(new Error("Zeitlimit"));
        }, Math.max(1, restMs));
      });
      try {
        const anfrage = Promise.resolve().then(() => holen(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller?.signal
        }));
        const antwort = await Promise.race([anfrage, grenze]);
        if (antwort && typeof antwort.status === "number" && antwort.status === 404) {
          return { ok: true, leer: true, daten: null, antwort };
        }
        if (antwort && typeof antwort.status === "number" && antwort.status === 429) {
          return { ok: false, rate: retryNachMs(antwort), daten: null, antwort };
        }
        if (antwort && (antwort.ok === false || (typeof antwort.status === "number" && antwort.status >= 400))) {
          return { ok: false, daten: null, antwort };
        }
        const laenge = Number(header(antwort, "Content-Length"));
        if (Number.isFinite(laenge) && laenge > MAX_ANTWORT_BYTES) return { ok: false, daten: null, antwort };
        const datenVersprechen = antwort?.body?.getReader && typeof TextDecoder === "function"
          ? Promise.resolve().then(async () => {
            const reader = antwort.body.getReader();
            const decoder = new TextDecoder();
            let text = "";
            let gesamt = 0;
            while (true) {
              const teil = await reader.read();
              if (teil.done) break;
              gesamt += teil.value?.byteLength || 0;
              if (gesamt > MAX_ANTWORT_BYTES) {
                try { await reader.cancel(); } catch (_) {}
                try { controller?.abort(); } catch (_) {}
                throw new Error("Antwort zu gross");
              }
              text += decoder.decode(teil.value, { stream: true });
            }
            text += decoder.decode();
            return JSON.parse(text);
          })
          : antwort && typeof antwort.text === "function"
            ? Promise.resolve().then(async () => {
              const text = await antwort.text();
              if (typeof text !== "string" || textBytes(text) > MAX_ANTWORT_BYTES) throw new Error("Antwort zu gross");
              return JSON.parse(text);
            })
          : antwort && typeof antwort.json === "function"
            ? Promise.resolve().then(() => antwort.json())
            : Promise.resolve(antwort);
        const daten = await Promise.race([datenVersprechen, grenze]);
        return { ok: true, daten, antwort };
      } catch (_) {
        return { ok: false, daten: null, antwort: null };
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    async function abrufen(url) {
      if (!holen || !url) return { ok: false, daten: null };
      if (urlLaufend.has(url)) return urlLaufend.get(url);
      const aufgabe = semaphore(async () => {
        const beginn = Date.now();
        let origin = "";
        try { origin = new URL(url).origin; } catch (_) {}
        const pauseBis = hostPause.get(origin) || 0;
        if (pauseBis > Date.now()) {
          const pause = pauseBis - Date.now();
          if (pause >= timeoutMs) return { ok: false, daten: null };
          await schlafen(pause);
        }
        let ergebnis = await einmal(url, timeoutMs - (Date.now() - beginn));
        if (ergebnis.rate != null) {
          const bis = Date.now() + Math.max(0, ergebnis.rate);
          if (origin) hostPause.set(origin, bis);
          const rest = timeoutMs - (Date.now() - beginn);
          if (ergebnis.rate < rest) {
            await schlafen(ergebnis.rate);
            ergebnis = await einmal(url, timeoutMs - (Date.now() - beginn));
            if (ergebnis.rate != null && origin) hostPause.set(origin, Date.now() + Math.max(0, ergebnis.rate));
          }
        }
        return ergebnis;
      });
      urlLaufend.set(url, aufgabe);
      try {
        return await aufgabe;
      } finally {
        urlLaufend.delete(url);
      }
    }

    function basisSegment(type, start, end, source, confidence, duration, absent = false) {
      if (!TYPEN.includes(type)) return null;
      if (absent) return { type, start: 0, end: 0, source, confidence: confidence ?? null, absent: true };
      if (!echteZahl(start) || !echteZahl(end) || start < 0 || end <= start) return null;
      if (duration != null && (start >= duration || end > duration)) return null;
      return {
        type, start, end, source,
        confidence: echteZahl(confidence) && confidence >= 0 && confidence <= 1 ? confidence : null
      };
    }

    function innerhalbQuelle(segmente) {
      const ergebnis = [];
      for (const type of TYPEN) {
        const gruppe = segmente.filter((segment) => segment?.type === type);
        const echte = gruppe.filter((segment) => !segment.absent)
          .sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1) || a.start - b.start);
        if (!echte.length) {
          const fehlt = gruppe.find((segment) => segment.absent);
          if (fehlt) ergebnis.push(fehlt);
          continue;
        }
        const behalten = [];
        for (const segment of echte) {
          const gleich = behalten.some((alt) => Math.abs(alt.start - segment.start) <= 2
            && Math.abs(alt.end - segment.end) <= 2);
          const ueberlappt = behalten.some((alt) => segment.start < alt.end && segment.end > alt.start);
          if (!gleich && !ueberlappt) behalten.push(segment);
        }
        ergebnis.push(...behalten.sort((a, b) => a.start - b.start));
      }
      return ergebnis.sort((a, b) => a.start - b.start || TYPEN.indexOf(a.type) - TYPEN.indexOf(b.type));
    }

    function feldPasst(daten, feld, erwartet) {
      return !Object.prototype.hasOwnProperty.call(daten, feld) || daten[feld] === erwartet;
    }

    function wesentlichUeberlappt(links, rechts) {
      if (!links || !rechts || links.absent || rechts.absent) return false;
      const schnitt = Math.min(links.end, rechts.end) - Math.max(links.start, rechts.start);
      if (schnitt <= 2) return false;
      return schnitt >= Math.min(links.end - links.start, rechts.end - rechts.start) * 0.5;
    }

    function aniskipUrl(context, offen) {
      const mal = context?.ids?.mal;
      const folge = context?.malEpisode;
      const dauer = dauerAus(context?.duration);
      if (!positiveGanzzahl(mal) || !positiveGanzzahl(folge) || dauer == null) return null;
      const mapping = { intro: "op", recap: "recap", outro: "ed" };
      const typen = offen.filter((type) => mapping[type]).map((type) => mapping[type]);
      if (!typen.length) return null;
      const query = typen.map((type) => `types=${encodeURIComponent(type)}`);
      query.push(`episodeLength=${encodeURIComponent(String(dauer))}`);
      return `https://api.aniskip.com/v2/skip-times/${mal}/${folge}?${query.join("&")}`;
    }

    function aniskipLesen(daten, context) {
      if (!daten || daten.found !== true || !Array.isArray(daten.results)) return [];
      const dauer = dauerAus(context?.duration);
      if (dauer == null) return [];
      const mapping = { op: "intro", recap: "recap", ed: "outro" };
      const segmente = [];
      for (const roh of daten.results) {
        const type = mapping[roh?.skipType];
        if (!type || roh?.skipType === "mixed-op" || roh?.skipType === "mixed-ed") continue;
        if (!echteZahl(roh.episodeLength) || Math.abs(roh.episodeLength - dauer) > 2) continue;
        const segment = basisSegment(type, roh?.interval?.startTime, roh?.interval?.endTime,
          "AniSkip", null, dauer);
        if (segment) segmente.push(segment);
      }
      return innerhalbQuelle(segmente);
    }

    function skipdbUrl(context) {
      const imdb = imdbAus(context?.ids?.imdb, 6, 10);
      if (!imdb) return null;
      const art = artAus(context?.art);
      const query = [`imdb_id=${encodeURIComponent(imdb)}`];
      if (art !== "film") {
        if (!positiveGanzzahl(context?.season) || !positiveGanzzahl(context?.episode)) return null;
        query.push(`season=${context.season}`, `episode=${context.episode}`);
      }
      const dauer = dauerAus(context?.duration);
      if (dauer != null) query.push(`duration=${encodeURIComponent(String(dauer))}`);
      query.push("adjust=conservative");
      return `https://api.skipdb.tv/api/segments?${query.join("&")}`;
    }

    function skipdbLesen(daten, context) {
      if (!daten || typeof daten.segments !== "object" || !daten.segments) return [];
      const imdb = imdbAus(context?.ids?.imdb, 6, 10);
      if (!feldPasst(daten, "imdb_id", imdb)) return [];
      if (artAus(context?.art) !== "film"
        && (!feldPasst(daten, "season", context.season) || !feldPasst(daten, "episode", context.episode))) return [];
      const dauer = dauerAus(context?.duration);
      const segmente = [];
      for (const type of TYPEN) {
        const roh = daten.segments[type];
        if (!roh || roh.match === "out-of-range") continue;
        if (roh.start_ms === 0 && roh.end_ms === 0) {
          segmente.push(basisSegment(type, 0, 0, "SkipDB", roh.confidence, dauer, true));
          continue;
        }
        if (!echteZahl(roh.start_ms) || !echteZahl(roh.end_ms)) continue;
        const segment = basisSegment(type, roh.start_ms / 1000, roh.end_ms / 1000,
          "SkipDB", roh.confidence, dauer);
        if (segment) segmente.push(segment);
      }
      return innerhalbQuelle(segmente.filter(Boolean));
    }

    function introdbUrl(context) {
      if (artAus(context?.art) === "film") return null;
      const imdb = imdbAus(context?.ids?.imdb, 7, 8);
      if (!imdb || !positiveGanzzahl(context?.season) || !positiveGanzzahl(context?.episode)) return null;
      return `https://api.introdb.app/segments?imdb_id=${encodeURIComponent(imdb)}`
        + `&season=${context.season}&episode=${context.episode}`;
    }

    function introdbLesen(daten, context) {
      if (!daten || typeof daten !== "object") return [];
      const imdb = imdbAus(context?.ids?.imdb, 7, 8);
      if (!feldPasst(daten, "imdb_id", imdb)
        || !feldPasst(daten, "season", context.season)
        || !feldPasst(daten, "episode", context.episode)) return [];
      const dauer = dauerAus(context?.duration);
      const segmente = [];
      for (const type of ["intro", "recap", "outro"]) {
        const roh = daten[type];
        if (!roh || !echteZahl(roh.start_ms) || !echteZahl(roh.end_ms)) continue;
        const segment = basisSegment(type, roh.start_ms / 1000, roh.end_ms / 1000,
          "IntroDB", roh.confidence, dauer);
        if (segment) segmente.push(segment);
      }
      return innerhalbQuelle(segmente);
    }

    function theintrodbUrl(context) {
      const ids = context?.ids || {};
      const query = [];
      if (positiveGanzzahl(ids.tmdb)) query.push(`tmdb_id=${ids.tmdb}`);
      else if (positiveGanzzahl(ids.tvdb)) query.push(`tvdb_id=${ids.tvdb}`);
      else {
        const imdb = imdbAus(ids.imdb, 7, 8);
        if (imdb) query.push(`imdb_id=${encodeURIComponent(imdb)}`);
      }
      if (!query.length) return null;
      if (artAus(context?.art) !== "film") {
        if (!positiveGanzzahl(context?.season) || !positiveGanzzahl(context?.episode)) return null;
        query.push(`season=${context.season}`, `episode=${context.episode}`);
      }
      const dauer = dauerAus(context?.duration);
      if (dauer != null) query.push(`duration_ms=${Math.round(dauer * 1000)}`);
      return `https://api.theintrodb.org/v3/media?${query.join("&")}`;
    }

    function theintrodbLesen(daten, context) {
      if (!daten || typeof daten !== "object") return [];
      const art = artAus(context?.art);
      const tmdb = context?.ids?.tmdb;
      if (positiveGanzzahl(tmdb) && !feldPasst(daten, "tmdb_id", tmdb)) return [];
      if (!feldPasst(daten, "type", art === "film" ? "movie" : "tv")) return [];
      if (art !== "film"
        && (!feldPasst(daten, "season", context.season) || !feldPasst(daten, "episode", context.episode))) return [];
      const dauer = dauerAus(context?.duration);
      const mapping = { intro: "intro", recap: "recap", credits: "outro", preview: "preview" };
      const segmente = [];
      for (const [feld, type] of Object.entries(mapping)) {
        if (!Array.isArray(daten[feld])) continue;
        for (const roh of daten[feld]) {
          const keinStart = roh?.start_ms === null || roh?.start_ms === 0;
          const keinEnde = roh?.end_ms === null || roh?.end_ms === 0;
          if (keinStart && keinEnde) {
            segmente.push(basisSegment(type, 0, 0, "TheIntroDB", roh?.confidence, dauer, true));
            continue;
          }
          const startMs = roh?.start_ms === null && (type === "intro" || type === "recap")
            ? 0 : roh?.start_ms;
          const endMs = roh?.end_ms === null && (type === "outro" || type === "preview") && dauer != null
            ? dauer * 1000 : roh?.end_ms;
          if (!echteZahl(startMs) || !echteZahl(endMs)) continue;
          const segment = basisSegment(type, startMs / 1000, endMs / 1000,
            "TheIntroDB", roh?.confidence, dauer);
          if (segment) segmente.push(segment);
        }
      }
      return innerhalbQuelle(segmente);
    }

    const adapter = {
      aniskip: { url: aniskipUrl, lesen: aniskipLesen },
      skipdb: { url: skipdbUrl, lesen: skipdbLesen },
      introdb: { url: introdbUrl, lesen: introdbLesen },
      theintrodb: { url: theintrodbUrl, lesen: theintrodbLesen }
    };

    async function wirklichLesen(context) {
      const art = artAus(context?.art);
      if (!art) return { segmente: [], fehler: false };
      const gefunden = [];
      const erledigt = new Set();
      let fehler = false;
      for (const quelle of PRIORITAET[art]) {
        const offen = TYPEN.filter((type) => !erledigt.has(type) && QUELLEN_TYPEN[quelle].has(type));
        if (!offen.length) continue;
        const url = adapter[quelle].url(context, offen);
        if (!url) continue;
        const antwort = await abrufen(url);
        if (!antwort.ok) {
          fehler = true;
          continue;
        }
        let segmente = [];
        try { segmente = adapter[quelle].lesen(antwort.daten, context); } catch (_) { fehler = true; }
        for (const segment of segmente) {
          if (!offen.includes(segment.type)) continue;
          if (gefunden.some((alt) => alt.type !== segment.type && wesentlichUeberlappt(alt, segment))) continue;
          gefunden.push(segment);
          erledigt.add(segment.type);
        }
        if (erledigt.size === TYPEN.length) break;
      }
      return { segmente: gefunden.sort((a, b) => a.start - b.start || TYPEN.indexOf(a.type) - TYPEN.indexOf(b.type)), fehler };
    }

    async function lesen(context) {
      const key = cacheSchluessel(context);
      const gespeichert = eintraege.get(key);
      if (gespeichert && gueltig(gespeichert)) {
        eintraege.delete(key);
        eintraege.set(key, gespeichert);
        return kopie(gespeichert.segmente);
      }
      if (gespeichert) eintraege.delete(key);
      if (laufend.has(key)) return kopie(await laufend.get(key));
      const aufgabe = wirklichLesen(context).then(({ segmente, fehler }) => {
        merken(key, fehler ? "fehler" : segmente.length ? "gut" : "leer", segmente);
        return segmente;
      }).catch(() => {
        merken(key, "fehler", []);
        return [];
      });
      laufend.set(key, aufgabe);
      try {
        return kopie(await aufgabe);
      } finally {
        laufend.delete(key);
      }
    }

    function leeren() {
      eintraege.clear();
      cacheSpeichern();
    }

    return { lesen, leeren, cache: cacheObjekt };
  }

  return {
    erstellen,
    aktiv,
    beschriftung,
    CACHE_VERSION,
    CACHE_MAX,
    GUT_MS,
    LEER_MS,
    FEHLER_MS,
    MAX_ANTWORT_BYTES
  };
});
