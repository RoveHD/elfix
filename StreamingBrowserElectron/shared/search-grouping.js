"use strict";

// Ein bewusst konservatives Anzeigemodell fuer die globale Suche.  Es fasst
// nur Quellen eines Werkes zusammen; Folgen, Staffeln, Fassungen und Videos
// bleiben eigenstaendige Treffer.  Es macht keine Netzabfragen.
(function searchGroupingUmd(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ELFIX_SEARCH_GROUPING = api;
}(globalThis, function createSearchGrouping() {
  function text(value) {
    return String(value || "").trim();
  }

  function normalTitle(value) {
    return text(value).toLocaleLowerCase("de")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[’'`]/g, "")
      .replace(/[^a-z0-9]+/g, " ").trim();
  }

  function valueOf(result, names) {
    for (const name of names) {
      const value = result?.[name] ?? result?.metadata?.[name];
      if (text(value)) return text(value);
    }
    return "";
  }

  function identity(result) {
    // Die gespeicherte Normalform verwendet `konfidenz` und `externeIds`.
    // Eine nackte `id` kann dagegen die Anbieter-ID sein und ist nie global.
    const confidence = valueOf(result, ["metadataConfidence", "confidence", "matchConfidence", "konfidenz"])
      .toUpperCase();
    if (!["EXACT", "HIGH", "CONFIRMED"].includes(confidence)) return "";
    const ids = result?.externeIds || result?.metadata?.externeIds || {};
    for (const namespace of ["tmdb", "anilist", "imdb"]) {
      const id = text(ids?.[namespace] ?? result?.[`${namespace}Id`]);
      if (id) return `${namespace}:${id}`;
    }
    return "";
  }

  function isYoutube(entry) {
    const name = text(entry?.provider?.providerName || entry?.provider?.name).toLowerCase();
    if (name.includes("youtube")) return true;
    try { return /(^|\.)(youtube(?:-nocookie)?\.com|youtu\.be)$/i.test(new URL(text(entry?.result?.url)).hostname); } catch { return false; }
  }

  function signature(entry) {
    const result = entry.result || {};
    const title = normalTitle(result.title);
    if (!title || isYoutube(entry)) return "";
    // Diese Werte duerfen nie weg-normalisiert werden: "Dune 1984" ist nicht
    // "Dune 2021", ein Film ist nicht die gleichnamige Serie.
    const year = valueOf(result, ["year", "releaseYear", "releaseDateYear"]);
    const type = valueOf(result, ["type", "mediaType", "kind", "format", "art"]);
    const season = valueOf(result, ["season", "seasonNumber", "staffel"]);
    const episode = valueOf(result, ["episode", "episodeNumber", "folge"]);
    const exactId = identity(result);
    return `${exactId ? `id:${exactId}` : `title:${title}`}|year:${year}|type:${type}|season:${season}|episode:${episode}`;
  }

  function groupProviderResults(response) {
    const groups = [];
    const bySignature = new Map();
    for (const provider of Array.isArray(response) ? response : []) {
      for (const result of Array.isArray(provider?.results) ? provider.results : []) {
        const entry = { provider, result };
        const key = signature(entry);
        let group = key && bySignature.get(key);
        if (!group) {
          group = { key: key || `single:${groups.length}`, title: text(result.title), entries: [] };
          groups.push(group);
          if (key) bySignature.set(key, group);
        }
        group.entries.push(entry);
      }
    }
    return groups;
  }

  return { groupProviderResults, normalTitle, signature };
}));
