"use strict";
const assert = require("node:assert/strict");
const { merken, normalisieren, waehlen } = require("../src/untertitelwahl");
const de = merken({ lang: "ger", name: "Deutsch" });
assert.equal(waehlen([{ lang: "en" }, { lang: "deu", name: "Deutsch" }], de), 1);
assert.equal(waehlen([{ lang: "de-DE", name: "Deutsch" }, { lang: "en" }], de), 0);
assert.equal(waehlen([{ lang: "en" }], de), -1, "Keine fremde Sprache bei fehlender deutscher Spur");
assert.equal(waehlen([{ lang: "de", name: "Deutsch" }], merken(null)), -1, "Aus bleibt aus");
assert.equal(waehlen([{ lang: "de", name: "Deutsch" }, { lang: "de", name: "Deutsch SDH" }],
  merken({ lang: "de", name: "Deutsch SDH" })), 1, "Spurbezeichnung bei gleicher Sprache bevorzugen");
assert.equal(waehlen([{ label: "Untertitel", language: "ja" }], merken({ label: "Untertitel", language: "ja" })), 0);
assert.equal(waehlen([{ name: "English" }, { name: "Deutsch" }], merken({ name: "Deutsch" })), 1);
assert.equal(waehlen([], de), -1);
assert.deepEqual(normalisieren({ aus: false, sprache: [], name: {} }), merken(null));
console.log("OK Untertitel: Reihenfolge, Sprachcodes, Sprachregion, fehlende Sprache, explizit Aus, SDH und native Spuren");
