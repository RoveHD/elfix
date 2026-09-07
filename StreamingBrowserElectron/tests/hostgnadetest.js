"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../../sync-server/server.js"), "utf8");
const start = source.indexOf("function aktuelleHostId(");
let clock = 1000, connected = false;
const context = {
  Date: { now: () => clock }, HOST_GNADE_MS: 12000,
  istAktiv: () => false, istVerbunden: () => connected,
  hostFuerFolge: () => ({ geraetId: "B" })
};
vm.createContext(context);
vm.runInContext(source.slice(start, source.indexOf("\n}", start) + 2), context);
const entry = () => ({ hostId: "A", hostGesehen: 500, members: new Map([["A", "Alice"], ["B", "Bob"]]), stand: new Map([["A", { at: 500 }]]) });
assert.equal(context.aktuelleHostId("raum", entry()), "A", "Socket schliesst vor close-Handler: Host bleibt erhalten");
const absent = entry(); absent.stand.delete("A");
assert.equal(context.aktuelleHostId("raum", absent), "A", "Gnadenfrist gilt auch nach Entfernen des Standes");
clock = 13000;
assert.equal(context.aktuelleHostId("raum", entry()), "B", "Nach der Gnadenfrist rueckt ein aktiver Gast nach");
clock = 1000; connected = true;
assert.equal(context.aktuelleHostId("raum", entry()), "B", "Offene aber veraltete Sitzung erhaelt keine Gnadenfrist");
const released = entry(); released.hostId = "";
assert.equal(context.aktuelleHostId("raum", released), "B", "Explizite Freigabe wird nicht verzoegert");
console.log("OK: Host-Schonfrist gilt auch zwischen Socket-Schliessung und Stand-Loeschung.");
