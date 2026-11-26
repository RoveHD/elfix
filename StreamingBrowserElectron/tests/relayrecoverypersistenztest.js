"use strict";

// Die echten Relay-Speicherfunktionen gegen eine isolierte Datei ausfuehren.
// Eine alte JSON-Datei kann Sets nur als {} enthalten: solche Laufzeitdaten
// duerfen weder einen Neustart blockieren noch alte Ladefehler wiederbeleben.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const relay = fs.readFileSync(path.join(__dirname, "../../sync-server/server.js"), "utf8").replace(/\r\n/g, "\n");
function source(name) {
  const start = relay.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Relayfunktion fehlt: ${name}`);
  return relay.slice(start, relay.indexOf("\n}\n", start) + 3);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-recovery-persist-"));
const file = path.join(dir, "raeume.json");
let save;
const rooms = new Map();
const context = vm.createContext({
  fs, Map, Set, Date, STATE_FILE: file, SPEICHER_VERZOEGERUNG_MS: 500,
  raeume: rooms, identitaeten: new Map(), speicherTimer: null,
  setTimeout(fn) { save = fn; return { unref() {} }; },
  warteschlangeAnlegen: () => ({ laden() {} }),
  geraete: { zustandLesen: () => ({}), zustandSetzen() {}, anzahl: () => 0 },
  youtubeParty: {}, console: { log() {}, error: (...args) => { throw Error(args.join(" ")); } },
  text: (s, length) => typeof s === "string" ? s.slice(0, length) : "",
  STAND_FRISCH_MS: 12000, istVerbunden: () => true
});
vm.runInContext(["zustandLaden", "zustandSpeichernSpaeter", "syncStand", "istAktiv"].map(source).join("\n"), context);

try {
  rooms.set("isoliert", { at: 1000, titel: new Map([["title", {
    key: "title", title: "Bleibt erhalten", members: new Map([["guest", "Gast"]]),
    sync: { id: "active" }, syncAbschluss: { syncId: "old", phase: "failed" },
    playbackAusgeschlossen: new Set(["guest"]), stand: new Map()
  }]]) });
  context.zustandSpeichernSpaeter();
  assert.equal(typeof save, "function");
  save();
  const stored = JSON.parse(fs.readFileSync(file, "utf8"));
  const title = stored.raeume.isoliert.titel[0];
  assert.equal(Object.hasOwn(title, "syncAbschluss"), false);
  assert.equal(Object.hasOwn(title, "playbackAusgeschlossen"), false);
  assert.equal(Object.hasOwn(title, "sync"), false);
  assert.deepEqual(title.members, [["guest", "Gast"]]);

  for (const polluted of [false, true]) {
    if (polluted) {
      title.syncAbschluss = { syncId: "obsolete", phase: "failed", members: [{ id: "guest", state: "error" }] };
      title.playbackAusgeschlossen = {};
      fs.writeFileSync(file, JSON.stringify(stored));
    }
    rooms.clear();
    context.zustandLaden();
    const loaded = rooms.get("isoliert").titel.get("title");
    assert.equal(loaded.title, "Bleibt erhalten");
    assert.equal(loaded.members.get("guest"), "Gast");
    assert.ok(loaded.playbackAusgeschlossen instanceof Set);
    assert.equal(loaded.playbackAusgeschlossen.size, 0);
    assert.equal(loaded.syncAbschluss, null);
    assert.equal(context.syncStand(loaded), null, "kein veralteter Ladezustand nach Neustart");
    assert.equal(context.istAktiv("isoliert", loaded, "guest", { sitzung: "fresh", at: Date.now() }), true,
      "gespeichertes {} darf .has weder blockieren noch abstuerzen lassen");
  }
  console.log("OK Relay-Persistenz: Recoveryabschluss und Playbackausschluss bleiben fluechtig; alte {}-Werte werden beim Neustart verworfen");
} finally {
  if (fs.existsSync(file)) fs.unlinkSync(file);
  fs.rmdirSync(dir);
}
