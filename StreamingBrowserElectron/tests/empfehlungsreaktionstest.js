"use strict";

const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");
const E = require("../src/empfehlung");
const titel = require("../src/titel");

// Ausschliesslich erfundene Daten. Der volle Pool zwingt auch die quadratische
// Vielfaltsauswahl zum Arbeiten; ein Test mit nur 24 Treffern saehe sie nicht.
function daten() {
  const jetzt = Date.parse("2026-11-26T12:00:00Z");
  const genres = ["action", "abenteuer", "fantasy", "drama", "isekai", "thriller"];
  const extern = (i) => ({
    quelle: "tmdb", konfidenz: "HIGH", titel: "Werk " + i,
    externeIds: { tmdb: i + 1 }, genres: ["Action", "Drama"],
    schlagworte: ["swordplay", "journey", "world " + i % 11],
    besetzung: ["Person " + i % 13, "Person " + i % 7],
    regie: ["Regie " + i % 17], autoren: ["Autor " + i % 19],
    studios: ["Studio " + i % 5],
    sammlung: i < 3 ? { id: 42, name: "Eine Reihe" } : null,
    jahr: 2000 + i % 23, bewertung: 7.4, stimmen: 800, beliebtheit: 42
  });
  const verlauf = Array.from({ length: 150 }, (_, i) => ({
    title: "Gesehen " + i, type: i % 2 ? "film" : "serie",
    art: i % 2 ? "film" : "anime", providerId: "p" + i % 3,
    genres: [genres[i % 6], genres[(i + 1) % 6]],
    watched: true, completed: true, lastWatchedAt: new Date(jetzt - i * 3600000).toISOString(),
    extern: extern(i)
  }));
  const kandidaten = Array.from({ length: 2200 }, (_, i) => ({
    title: "Katalog " + i, url: "https://anbieter.test/werk/" + i,
    type: i % 2 ? "film" : "serie", art: i % 2 ? "film" : "anime",
    providerId: "p" + i % 3, providerName: "Anbieter " + i % 3,
    genres: [genres[i % 6], genres[(i + 1) % 6]],
    via: i % 5 ? "genre" : "related", seedTitle: "Gesehen " + i % 150,
    seedWeight: 0.8, extern: extern(i + 150)
  }));
  kandidaten.push({ ...kandidaten[0], providerId: "alternative", url: "https://alternative.test/werk/0" });
  kandidaten.push({ ...kandidaten[1], title: verlauf[1].title });
  const ausschluss = new Set([titel.werkSchluessel(kandidaten[2].title, kandidaten[2].type)]);
  const anzeigen = new Map([[titel.werkSchluessel(kandidaten[3].title, kandidaten[3].type), 8]]);
  return { kandidaten, verlauf, jetzt, optionen: { jetzt, limit: 1500, ausschluss, anzeigen, debug: true } };
}

async function pruefen() {
  const { kandidaten, verlauf, jetzt, optionen } = daten();
  const profil = E.profilBauen(verlauf, jetzt);
  const beginn = performance.now();
  const synchron = E.empfehlen(kandidaten, profil, optionen);
  const synchronMs = performance.now() - beginn;
  // Hash ueber ALLE Ergebnisfelder, nicht nur Titel oder Scores. Er stammt
  // vom urspruenglichen synchronen Ranking vor der Aufteilung in Schritte.
  const hash = createHash("sha256").update(JSON.stringify(synchron)).digest("hex");
  assert.equal(hash, "21b3ec3587d1429dcd11544ee50dec7c1f9b6722d4bee90994c56dc1bcd834c7");
  let schlaege = 0;
  let letzter = performance.now();
  let maxLueckeMs = 0;
  const heartbeat = setInterval(() => {
    const nun = performance.now();
    maxLueckeMs = Math.max(maxLueckeMs, nun - letzter);
    letzter = nun;
    schlaege += 1;
  }, 5);
  const asyncBeginn = performance.now();
  let asynchron;
  try {
    asynchron = await E.empfehlenAsync(kandidaten, profil, optionen);
    maxLueckeMs = Math.max(maxLueckeMs, performance.now() - letzter);
  } finally {
    clearInterval(heartbeat);
  }
  assert.deepEqual(asynchron, synchron, "Scores, Reihenfolge, Ausschluesse, Belege und Gruende bleiben gleich");
  assert.ok(schlaege > 2, "Eingaben/Timer muessen WAEHREND des Rankings an die Reihe kommen");
  assert.ok(maxLueckeMs < 250, "Keine lange Blockade: " + maxLueckeMs.toFixed(1) + " ms");
  console.log("OK    Empfehlung bleibt reaktionsfaehig " + JSON.stringify({
    kandidaten: kandidaten.length, profil: verlauf.length, pool: asynchron.length,
    synchronMs: Math.round(synchronMs), asyncMs: Math.round(performance.now() - asyncBeginn),
    heartbeat: schlaege, maxLueckeMs: Number(maxLueckeMs.toFixed(1)), hash
  }));

  // Android hat weder setImmediate noch Node-Worker. Die Modulgrenze bleibt
  // dieselbe; nur die echte Timer-Runde ersetzt dort setImmediate.
  let mobileRunden = 0;
  let uhr = 0;
  const mobile = { module: { exports: {} }, require: (name) => require("../src/" + name),
    performance: { now: () => { uhr += 4; return uhr; } },
    setTimeout: (fn) => { mobileRunden += 1; return setTimeout(fn, 0); } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/empfehlung"), "utf8"), mobile);
  const klein = kandidaten.slice(0, 8);
  const mobilErgebnis = await mobile.module.exports.empfehlenAsync(klein, profil, { ...optionen, limit: 8 });
  assert.deepEqual(JSON.parse(JSON.stringify(mobilErgebnis)),
    JSON.parse(JSON.stringify(E.empfehlen(klein, profil, { ...optionen, limit: 8 }))));
  assert.ok(mobileRunden > 0);
  console.log("OK    Android-Timerrunden liefern identische Empfehlungen");
}

module.exports = { pruefen, daten };
if (require.main === module) pruefen().catch((fehler) => { console.error(fehler); process.exitCode = 1; });
