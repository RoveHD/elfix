"use strict";
const assert = require("assert/strict");
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const source = fs.readFileSync(path.join(__dirname, "../src/renderer/renderer.js"), "utf8").replace(/\r/g, "");
const start = source.indexOf("async function startArbeitenVerteilen(");
const code = source.slice(start, source.indexOf("\n}", start) + 2);
async function pruefen(idle) {
  const events = [];
  const context = vm.createContext({
    console: { warn() { events.push("error"); } },
    window: {
      setTimeout(fn) { events.push("yield"); setImmediate(fn); },
      ...(idle ? { requestIdleCallback(fn) { events.push("idle"); setImmediate(fn); } } : {})
    }
  });
  vm.runInContext(code, context);
  let release;
  const work = context.startArbeitenVerteilen([
    () => new Promise(resolve => { events.push("first"); release = resolve; }),
    () => { events.push("second"); throw Error("offline"); },
    () => events.push("third")
  ]);
  while (!release) await new Promise(setImmediate);
  assert.ok(!events.includes("second"), "Zweite Abfrage wartet auf erste Antwort");
  release();
  await work;
  assert.equal(events.filter(x => x === "yield").length, 3);
  assert.ok(events.indexOf("first") < events.indexOf("second"));
  assert.ok(events.indexOf("error") < events.indexOf("third"), "Fehler blockiert restlichen Start nicht");
}
Promise.resolve().then(() => pruefen(true)).then(() => pruefen(false)).then(() => {
  console.log("OK: Startabfragen seriell, mit Eingabepausen und Fehlerfortsetzung; Idle und Fallback geprueft.");
}).catch(error => { console.error(error); process.exitCode = 1; });
