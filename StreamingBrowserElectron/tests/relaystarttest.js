"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "run.js"), "utf8");
const start = source.indexOf("async function warteAufRelay(");
const fn = source.slice(start, source.indexOf("\n}", start) + 2);
let clock = 0, ownReady = false;
const context = {
  Date: { now: () => clock }, gesund: async () => true,
  schlaf: async ms => { clock += ms; }
};
vm.createContext(context);
vm.runInContext(fn, context);
(async () => {
  assert.equal(await context.warteAufRelay(8791, 500, () => false, () => ownReady), false,
    "Ein fremdes gesundes Relay darf den eigenen Prozess nicht ersetzen");
  ownReady = true;
  assert.equal(await context.warteAufRelay(8791, 500, () => false, () => ownReady), true);
  assert.equal(await context.warteAufRelay(8791, 500, () => true, () => ownReady), false,
    "Gestorbener eigener Prozess gewinnt gegen fremde Health-Antwort");
  console.log("OK: Relay-Start akzeptiert nur den bereiten eigenen Prozess.");
})().catch(error => { console.error(error); process.exitCode = 1; });
