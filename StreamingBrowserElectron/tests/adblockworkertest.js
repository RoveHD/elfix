"use strict";
const assert = require("assert/strict");
const { vorbereiten } = require("../src/adblock-vorbereitung");

(async () => {
  const modul = await import("@adguard/tsurlfilter");
  modul.setConfiguration({ engine: "extension", version: "1.0.0", verbose: false,
    compatibility: modul.CompatibilityTypes.Extension });
  const filters = [{ id: 2, content: [
    "||ads.example^$script", "@@||ads.example/allowed.js$script",
    "example.org##.advert", "example.org#@#.allowed",
    ...Array.from({ length: 20000 }, (_, i) => `||ad${i}.example^`)
  ].join("\n") }];
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 10);
  let result;
  try { result = await vorbereiten(filters); } finally { clearInterval(timer); }
  assert.ok(ticks > 0, "Hauptthread bearbeitet Timer waehrend der Konvertierung");
  const original = new modul.FilterList(filters[0].content, 2);
  assert.equal(result[0].content, original.getContent());
  assert.deepEqual(result[0].data, original.getConversionData());
  const restored = new modul.FilterList(result[0].content, result[0].id, result[0].data);
  assert.equal(restored.getOriginalContent(), original.getOriginalContent());
  const direkt = await modul.Engine.createAsync({ filters });
  const worker = await modul.Engine.createAsync({ filters: [{ id: 2, content: restored }] });
  assert.equal(worker.getRulesCount(), direkt.getRulesCount());
  console.log(`OK: ${worker.getRulesCount()} Regeln unveraendert; ${ticks} Hauptthread-Timer waehrend Worker-Aufbau.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
