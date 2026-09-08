"use strict";

// Koordiniert die kurzen Direktsuchen im Hauptprozess. Der Renderer darf eine
// alte Suche verwerfen, ohne einen gleichlautenden Abruf eines zweiten Fensters
// abzubrechen. Erfolgreiche Antworten bleiben nur kurz im Speicher; Fehler und
// Abbrueche gelangen nie in den Cache.

function abortError() {
  const error = new Error("Suche abgebrochen");
  error.name = "AbortError";
  return error;
}

function createSearchCoordinator(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const ttlMs = Number.isFinite(options.ttlMs) ? Math.max(0, options.ttlMs) : 12_000;
  const maxEntries = Number.isFinite(options.maxEntries) ? Math.max(0, Math.floor(options.maxEntries)) : 24;
  const cache = new Map();
  const pending = new Map();

  function removeExpired() {
    const time = now();
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= time) cache.delete(key);
    }
  }

  function remember(key, value) {
    if (!ttlMs || !maxEntries) return;
    removeExpired();
    cache.delete(key);
    cache.set(key, { value, expiresAt: now() + ttlMs });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  }

  function cached(key) {
    removeExpired();
    const entry = cache.get(key);
    if (!entry) return undefined;
    // Map-Reihenfolge ist zugleich die LRU-Reihenfolge.
    cache.delete(key);
    cache.set(key, entry);
    return entry.value;
  }

  function detach(entry, consumer, error = abortError()) {
    if (!entry.consumers.delete(consumer)) return;
    consumer.reject(error);
    if (!entry.consumers.size && !entry.settled) entry.controller.abort();
  }

  function cancel(owner, exceptKey) {
    for (const [key, entry] of pending) {
      if (key === exceptKey) continue;
      for (const consumer of [...entry.consumers]) {
        if (consumer.owner === owner) detach(entry, consumer);
      }
    }
  }

  function start(key, execute, isCacheable) {
    const controller = new AbortController();
    const entry = { controller, consumers: new Set(), settled: false };
    pending.set(key, entry);
    Promise.resolve()
      .then(() => execute(controller.signal))
      .then((value) => {
        // Manche Fetch-Wrapper loesen trotz Signal noch auf. Ein abgebrochener
        // Lauf darf auch dann weder antworten noch den Cache fuellen.
        if (controller.signal.aborted) throw abortError();
        return value;
      })
      .then((value) => {
        entry.settled = true;
        if (pending.get(key) === entry) pending.delete(key);
        // Ein fehlerhafter Cache-Pruefer darf niemals die wartenden Renderer
        // haengen lassen. Die Antwort ist trotzdem gueltig, nur nicht cachebar.
        let cacheable = false;
        try { cacheable = Boolean(isCacheable(value)); } catch {}
        if (cacheable) remember(key, value);
        for (const consumer of entry.consumers) consumer.resolve(value);
        entry.consumers.clear();
      }, (error) => {
        entry.settled = true;
        if (pending.get(key) === entry) pending.delete(key);
        for (const consumer of entry.consumers) consumer.reject(error);
        entry.consumers.clear();
      });
    return entry;
  }

  function request({ key, owner, execute, isCacheable = () => true }) {
    const cacheKey = String(key || "");
    if (!cacheKey) return Promise.reject(new Error("Suchschluessel fehlt"));
    if (typeof execute !== "function") return Promise.reject(new TypeError("Suche fehlt"));
    const ownerKey = String(owner || "default");

    // Eine neue, andere Suche desselben Renderers macht nur dessen alte
    // Erwartung gegenstandslos. Gleichlautende Anfragen anderer Besitzer
    // bleiben als gemeinsame Arbeit erhalten.
    cancel(ownerKey, cacheKey);
    const value = cached(cacheKey);
    if (value !== undefined) return Promise.resolve(value);

    // Ein gerade abgebrochener Lauf kann noch auf seine Fetch-Ablehnung warten.
    // Er darf einen erneuten gleichlautenden Begriff nicht mit seiner alten
    // Ablehnung mitnehmen.
    const existing = pending.get(cacheKey);
    const entry = existing && !existing.controller.signal.aborted
      ? existing
      : start(cacheKey, execute, isCacheable);
    return new Promise((resolve, reject) => {
      entry.consumers.add({ owner: ownerKey, resolve, reject });
    });
  }

  return {
    request,
    cancel(owner) { cancel(String(owner || "default")); },
    clear() { cache.clear(); },
    // Nur fuer die isolierten Pruefungen; keine Produktentscheidung haengt an
    // diesen Zahlen.
    stats() { removeExpired(); return { cached: cache.size, pending: pending.size }; }
  };
}

module.exports = { createSearchCoordinator, abortError };
