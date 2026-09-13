"use strict";

// AnimeFillerList offers public episode tables, but no maintained official JSON
// API. This read-only adapter is shared by Electron and Android's JS core.
// Fetch only the index and a confidently matched show, never a URL from a page.
const BASIS = "https://www.animefillerlist.com";
const LABELS = Object.freeze(Object.assign(Object.create(null), {
  manga_canon: "Manga-Canon", filler: "Filler",
  "mixed_canon/filler": "Canon / Filler", anime_canon: "Anime-Canon"
}));
const MAX_BYTES = 2 * 1024 * 1024;
const TAG = 24 * 60 * 60 * 1000;

function textAus(html) {
  return String(html || "").replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp|ndash|mdash|rsquo|lsquo|times);/gi, (ganz, wert) => {
      if (wert[0] === "#") {
        const code = /^#x/i.test(wert) ? parseInt(wert.slice(2), 16) : Number(wert.slice(1));
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }
      return ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ",
        ndash: "-", mdash: "-", rsquo: "'", lsquo: "'", times: "x" })[wert.toLowerCase()] || ganz;
    }).replace(/\s+/g, " ").trim();
}

function normal(wert) {
  return textAus(wert).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/×/g, "x").replace(/[^\p{L}\p{N}]/gu, "");
}

function attribut(tag, name) {
  const treffer = new RegExp("\\b" + name + "\\s*=\\s*([\"'])(.*?)\\1", "i").exec(tag);
  return treffer ? treffer[2] : "";
}

function showPfad(wert) {
  try {
    const url = new URL(String(wert || ""), BASIS);
    return url.origin === BASIS && /^\/shows\/[^/?#]+$/.test(url.pathname)
      && !url.search && !url.hash ? url.pathname : "";
  } catch { return ""; }
}

function indexLesen(html) {
  const shows = new Map();
  for (const match of String(html || "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const pfad = showPfad(attribut(match[1], "href"));
    const titel = textAus(match[2]);
    if (!pfad || !titel || titel.length > 240) continue;
    shows.set(pfad, { pfad, titel });
    if (shows.size >= 10000) break;
  }
  return Array.from(shows.values());
}

function episodenLesen(html) {
  const folgen = new Map();
  for (const match of String(html || "").matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)) {
    const typen = attribut(match[1], "class").split(/\s+/).filter(type => LABELS[type]);
    if (typen.length !== 1) continue;
    const zellen = {};
    for (const zelle of match[2].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)) {
      for (const klasse of attribut(zelle[1], "class").toLowerCase().split(/\s+/)) {
        zellen[klasse] = textAus(zelle[2]);
      }
    }
    if (!/^\d+$/.test(zellen.number || "")) continue;
    const episode = Number(zellen.number);
    if (episode < 1 || episode > 10000) continue;
    // Conflicting duplicate source rows must not silently pick a category.
    const vorher = folgen.get(episode);
    const type = typen[0];
    folgen.set(episode, vorher && vorher.type !== type
      ? { episode, type: "", titel: "" }
      : { episode, type, titel: String(zellen.title || "").slice(0, 300) });
  }
  return Array.from(folgen.values()).filter(folge => LABELS[folge.type]);
}

function namen(titel) {
  const raus = [normal(titel)];
  // Parenthesized romanized names are aliases; years and sequel numbers are
  // part of the identity and must never be dropped (e.g. Hunter x Hunter).
  const klammer = /^(.*?)\s*\(([^)]+)\)$/.exec(titel);
  if (klammer && /\p{L}{3}/u.test(klammer[2]) && !/\d/.test(klammer[2])) {
    raus.push(normal(klammer[1]), normal(klammer[2]));
  }
  return raus.filter(Boolean);
}

function serieFinden(index, stand, context) {
  let slug = "";
  try {
    const match = /\/(?:anime|serie)\/stream\/([^/]+)/i.exec(new URL(context.url).pathname);
    slug = match ? decodeURIComponent(match[1]) : "";
  } catch { /* A caller can also supply an explicit anime title without a URL. */ }
  const titel = String(stand.titel || "");
  const suchen = [...new Set([normal(titel), normal(slug)].filter(Boolean))];
  // Prefer the complete displayed title over aliases. AFL also lists fan edits
  // like "One Pace (One Piece)" and alternate "(Definitive)" guides. Those must
  // not make the exact original title ambiguous or win over it.
  for (const name of suchen) {
    const genau = index.filter(show => normal(show.titel) === name);
    if (genau.length) return genau.length === 1 ? genau[0] : null;
  }
  // A year supplied in the heading distinguishes remakes even when a provider
  // uses an unqualified URL. Never fall back to a differently dated edition.
  const jahr = titel.match(/\b(?:19|20)\d{2}\b/);
  if (jahr) return null;
  for (const name of suchen) {
    const kandidaten = index.filter(show => namen(show.titel).includes(name));
    if (kandidaten.length) return kandidaten.length === 1 ? kandidaten[0] : null;
  }
  // Slugs are only a final fallback: AFL sometimes retains a historical slug
  // for a completely different displayed show, so require title agreement too.
  const pfadTreffer = index.filter(show => {
    try { return normal(decodeURIComponent(show.pfad.slice(7))) === normal(slug)
      && namen(show.titel).some(name => suchen.includes(name)); } catch { return false; }
  });
  if (pfadTreffer.length === 1) return pfadTreffer[0];
  return null;
}

function zuordnen(stand, daten, sourceUrl) {
  const nachNummer = new Map(daten.map(e => [e.episode, e]));
  const nachTitel = new Map();
  for (const ep of daten) {
    const key = normal(ep.titel);
    if (key.length < 5) continue;
    nachTitel.set(key, nachTitel.has(key) ? null : ep);
  }
  const staffeln = new Map();
  for (const folge of stand.folgen || []) {
    if (!Number.isInteger(Number(folge.staffel)) || Number(folge.staffel) < 1
      || !Number.isInteger(Number(folge.folge)) || Number(folge.folge) < 1) continue;
    const liste = staffeln.get(Number(folge.staffel)) || [];
    liste.push(folge);
    staffeln.set(Number(folge.staffel), liste);
  }
  const zugewiesen = new Map();
  for (const [staffel, liste] of staffeln) {
    const anker = new Map();
    const offsets = new Map();
    for (const folge of liste) {
      const titel = [folge.titel, ...(Array.isArray(folge.titelAlternativen) ? folge.titelAlternativen : [])];
      const treffer = [...new Set(titel.map(t => nachTitel.get(normal(t))).filter(Boolean))];
      if (treffer.length !== 1) continue;
      const ep = treffer[0];
      anker.set(folge, ep);
      const offset = ep.episode - Number(folge.folge);
      const nummern = offsets.get(offset) || new Set();
      nummern.add(Number(folge.folge));
      offsets.set(offset, nummern);
    }
    // AFL numbers a show absolutely; providers often restart at each season.
    // Infer an offset only from two distinct, exact episode-title anchors.
    // Unknown later seasons are never treated as season 1.
    let offset = null;
    if (offsets.size === 1) {
      const [wert, nummern] = [...offsets][0];
      if (wert >= 0 && (nummern.size >= 2 || (staffel === 1 && wert === 0))) offset = wert;
    } else if (!offsets.size && staffel === 1) offset = 0;
    for (const folge of liste) {
      const ep = anker.get(folge) || (offset !== null ? nachNummer.get(Number(folge.folge) + offset) : null);
      if (ep && LABELS[ep.type]) zugewiesen.set(folge, {
        type: ep.type, label: LABELS[ep.type], source: "AnimeFillerList", sourceUrl, episode: ep.episode
      });
    }
  }
  return { ...stand, folgen: (stand.folgen || []).map(folge => {
    const kopie = { ...folge };
    delete kopie.filler;
    if (zugewiesen.has(folge)) kopie.filler = zugewiesen.get(folge);
    return kopie;
  }) };
}

function erstellen(optionen = {}) {
  const holen = optionen.holen || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  const jetzt = optionen.jetzt || Date.now;
  const timeout = Math.max(25, Math.min(6000, Number(optionen.timeoutMs) || 5000));
  const cache = new Map();
  const laufend = new Map();
  try {
    const roh = optionen.laden?.();
    if (roh?.version === 1 && Array.isArray(roh.entries)) {
      for (const e of roh.entries.slice(-64)) {
        if (!e || (e.key !== "/shows" && !showPfad(e.key)) || !Number.isFinite(e.at)
          || !Number.isFinite(e.bis) || e.at > jetzt() || jetzt() - e.at > 30 * TAG) continue;
        if (e.value !== null && (!Array.isArray(e.value) || e.value.length > 10000)) continue;
        const value = e.value === null ? null : e.value.filter(item => item && (e.key === "/shows"
          ? showPfad(item.pfad) && typeof item.titel === "string" && item.titel.length <= 240
          : Number.isInteger(item.episode) && item.episode > 0 && item.episode <= 10000
            && LABELS[item.type] && typeof item.titel === "string" && item.titel.length <= 300));
        cache.set(e.key, { ...e, bis: Math.min(e.bis, e.at + TAG), value });
      }
    }
  } catch { /* A broken optional cache must not affect episode selection. */ }

  function speichern() {
    while (cache.size > 64) cache.delete(cache.keys().next().value);
    try { optionen.speichern?.({ version: 1, entries: Array.from(cache.values()) }); } catch { /* optional */ }
  }

  async function lesen(key) {
    const gemerkt = cache.get(key);
    if (gemerkt && gemerkt.bis > jetzt()) return gemerkt.value;
    if (laufend.has(key)) return laufend.get(key);
    const lauf = (async () => {
      const controller = new AbortController();
      let timer;
      try {
        const arbeit = (async () => {
          if (!holen) throw new Error("No fetch");
          const antwort = await holen(BASIS + key, { signal: controller.signal, credentials: "omit",
            redirect: "error", maxBytes: MAX_BYTES, headers: { Accept: "text/html" } });
          if (!antwort?.ok) throw new Error("Source unavailable");
          if (antwort.url && new URL(antwort.url).origin !== BASIS) throw new Error("Foreign redirect");
          if (Number(antwort.headers?.get?.("content-length")) > MAX_BYTES) throw new Error("Response too large");
          let html;
          if (antwort.body?.getReader) {
            const reader = antwort.body.getReader();
            const decoder = new TextDecoder();
            let bytes = 0;
            html = "";
            try {
              while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                bytes += chunk.value.byteLength;
                if (bytes > MAX_BYTES) throw new Error("Response too large");
                html += decoder.decode(chunk.value, { stream: true });
              }
              html += decoder.decode();
            } finally { await reader.cancel().catch(() => {}); }
          } else html = await antwort.text();
          if (html.length > MAX_BYTES) throw new Error("Response too large");
          const value = key === "/shows" ? indexLesen(html) : episodenLesen(html);
          if (!value.length) throw new Error("Missing source table");
          return value;
        })();
        const value = await Promise.race([arbeit, new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error("Timeout")); }, timeout);
        })]);
        cache.set(key, { key, at: jetzt(), bis: jetzt() + TAG, value });
        speichern();
        return value;
      } catch {
        const value = gemerkt && jetzt() - gemerkt.at <= 30 * TAG ? gemerkt.value : null;
        cache.set(key, { key, at: value ? gemerkt.at : jetzt(), bis: jetzt() + 5 * 60 * 1000, value });
        speichern();
        return value;
      } finally { clearTimeout(timer); controller.abort(); }
    })();
    laufend.set(key, lauf);
    try { return await lauf; } finally { laufend.delete(key); }
  }

  async function anreichern(stand, context = {}) {
    if (!stand || !Array.isArray(stand.folgen) || !stand.folgen.some(f => Number(f.staffel) > 0)) return stand;
    let anime = context.art === "anime";
    try { anime ||= /^\/anime\/stream\//i.test(new URL(context.url).pathname); } catch { /* no URL */ }
    if (!anime) return stand;
    try {
      const index = await lesen("/shows");
      const show = index && serieFinden(index, stand, context);
      if (!show) return stand;
      const daten = await lesen(show.pfad);
      return daten ? zuordnen(stand, daten, BASIS + show.pfad) : stand;
    } catch { return stand; }
  }
  return { anreichern };
}

module.exports = { erstellen, indexLesen, episodenLesen, serieFinden, zuordnen, normal, LABELS };
