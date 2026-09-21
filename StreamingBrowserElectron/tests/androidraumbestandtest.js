"use strict";

// Echte Android-Bruecke und Watchparty-Verbindung, kontrollierte Relaypakete.
// Der Fernseher kann beim Loeschen aus gewesen sein; seine alte Ablage bleibt.
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.join(__dirname, "..");
const BRUECKE = process.env.RAUMBESTAND_BRUECKE || path.join(ROOT,
  "../android/app/src/main/assets/kern/eigen/watchparty-bruecke.js");
const URL_SERIE = "https://aniworld.to/anime/stream/tomb-raider-king";
const KEY = "serie:tombraiderking";
const ROOM = "gemeinsam";
const PROVIDER = [{ id: "aniworld", name: "AniWorld", startUrl: "https://aniworld.to/" }];
const alt = () => ({ id: "tomb", title: "Tomb Raider King", type: "serie",
  url: URL_SERIE + "/staffel-1/episode-4", season: 1, episode: 4, currentTime: 780,
  progress: 55, duration: 1400, watchedSeconds: 400, watchpartyRoom: ROOM,
  watchpartyFrom: "PC", watchpartyAt: "2026-09-20T10:00:00Z", watchpartyArchived: false,
  completedEpisodes: [[1, 1], [1, 2], [1, 3]], activity: [{ kind: "watched" }] });
const titel = (extra = {}) => ({ key: KEY, title: "Tomb Raider King", type: "serie",
  url: URL_SERIE, memberIds: ["tv"], archived: false, ...extra });

class Leitung {
  static alle = [];
  constructor() { this.readyState = 0; this.pakete = []; Leitung.alle.push(this); }
  send(json) { this.pakete.push(JSON.parse(json)); }
  close() { this.readyState = 3; }
  offen() { this.readyState = 1; this.onopen(); }
  eingang(paket) { this.onmessage?.({ data: JSON.stringify(paket) }); }
  zustand(shared = []) { this.eingang({ type: "state", identityVersion: 2, you: "tv", shared }); }
  quittieren() {
    for (const paket of this.pakete.splice(0)) {
      if (paket.type === "time" && paket.t0 < 0) this.eingang({ type: "timeack", t0: paket.t0, t1: Date.now() });
    }
  }
  abbruch() { this.readyState = 3; this.onclose(); }
}

function android() {
  const modul = { exports: {} };
  const events = [];
  vm.runInNewContext(fs.readFileSync(BRUECKE, "utf8"), {
    require: (name) => require(path.join(ROOT, fs.existsSync(path.join(ROOT, "src", name + ".js"))
      ? "src" : "shared", name + ".js")),
    module: modul, exports: modul.exports, console, URL,
    window: { ElfixKern: { ereignis: (name, daten) => events.push({ name, daten }) } },
    setTimeout, clearTimeout, setInterval, clearInterval
  });
  const bridge = modul.exports;
  const config = { enabled: true, serverUrl: "ws://127.0.0.1:8799", rooms: [ROOM],
    deviceId: "tv", deviceName: "TV", deviceSecret: "a".repeat(43) };
  bridge.konfigurieren(config);
  return { bridge, config, events, leitung: Leitung.alle.at(-1) };
}
function abgleichen(bridge, favoriten) {
  return bridge.raumEintraegeSichern({ favoriten }, PROVIDER);
}

const vorher = globalThis.WebSocket;
globalThis.WebSocket = Leitung;
let tests = 0;
function pruefe(name, test) {
  const geraet = android();
  try { test(geraet); tests += 1; console.log("OK " + name); }
  finally { geraet.bridge.trennen(); }
}
try {
  pruefe("Geloeschter Titel verschwindet nach Wiederanschluss, Verlauf bleibt erhalten", ({ bridge, config, leitung, events }) => {
    const eintrag = alt();
    const privat = { ...alt(), id: "privat", watchpartyRoom: "", currentTime: 123 };
    const andereRunde = { ...alt(), id: "andere-runde", watchpartyRoom: "familie" };
    leitung.offen();
    bridge.konfigurieren({ ...config, rooms: [ROOM, "familie"] });
    const vorSnapshot = events.filter((e) => e.name === "watchparty:zustand").at(-1).daten.abgleichVersion;
    leitung.zustand([]);
    assert.ok(events.filter((e) => e.name === "watchparty:zustand").at(-1).daten.abgleichVersion > vorSnapshot,
      "Ein bestaetigter leerer Raum muss Java auch nach einer leeren Startanzeige erreichen");
    const vorher = JSON.parse(JSON.stringify(eintrag));
    assert.equal(abgleichen(bridge, [eintrag, privat, andereRunde]).geaendert, false);
    assert.equal(eintrag.watchpartyRoom, ROOM, "Noch nicht quittierte Beitritte duerfen fehlen");
    leitung.quittieren();
    const ergebnis = abgleichen(bridge, [eintrag, privat, andereRunde]);
    assert.equal(ergebnis.geaendert, true);
    assert.equal(eintrag.watchpartyRoom, "");
    assert.ok(events.some((e) => e.name === "watchparty:zustand" && e.daten.abgleichVersion > 0));
    for (const feld of ["currentTime", "progress", "completedEpisodes", "activity", "watchedSeconds"]) {
      assert.deepEqual(eintrag[feld], vorher[feld], feld + " bleibt erhalten");
    }
    assert.equal(privat.currentTime, 123);
    assert.equal(andereRunde.watchpartyRoom, "familie", "Anderer Raum wartet noch auf Verbindung");
    assert.equal(ergebnis.favoriten.length, 3, "Kein Bestand wird geloescht");
  });
  pruefe("Ausgeschaltet und offline bleibt die Raumbindung bestehen", ({ bridge, config, leitung }) => {
    const eintrag = alt();
    assert.equal(abgleichen(bridge, [eintrag]).geaendert, false);
    leitung.offen();
    leitung.zustand([]);
    abgleichen(bridge, [eintrag]);
    leitung.abbruch();
    leitung.quittieren();
    assert.equal(abgleichen(bridge, [eintrag]).geaendert, false);
    bridge.konfigurieren({ ...config, enabled: false });
    assert.equal(abgleichen(bridge, [eintrag]).geaendert, false);
    assert.equal(eintrag.watchpartyRoom, ROOM);
  });
  pruefe("Entfernter letzter Raum loest nur seine Bindung", ({ bridge, config }) => {
    const eintrag = alt();
    bridge.konfigurieren({ ...config, rooms: [] });
    assert.equal(abgleichen(bridge, [eintrag]).geaendert, true);
    assert.equal(eintrag.watchpartyRoom, "");
    assert.equal(eintrag.currentTime, 780);
  });
  pruefe("Nachgetragener Beitritt wartet auf neueste Quittung", ({ bridge, leitung }) => {
    const eintrag = alt();
    leitung.offen();
    leitung.zustand([titel({ memberIds: ["pc"] })]);
    abgleichen(bridge, [eintrag]);
    const alteQuittung = leitung.pakete.find((p) => p.type === "time" && p.t0 < 0);
    bridge.beitreten(KEY, ROOM);
    leitung.eingang({ type: "timeack", t0: alteQuittung.t0, t1: Date.now() });
    abgleichen(bridge, [eintrag]);
    assert.equal(eintrag.watchpartyRoom, ROOM, "Die alte Quittung ueberholt keinen neuen Beitritt");
    leitung.zustand([titel()]);
    leitung.quittieren();
    abgleichen(bridge, [eintrag]);
    assert.equal(eintrag.watchpartyRoom, ROOM);
  });
  pruefe("Verlassener Titel bleibt trotz anderer Raumtitel nicht gemeinsam", ({ bridge, leitung }) => {
    const eintrag = alt();
    leitung.offen(); leitung.zustand([titel()]);
    abgleichen(bridge, [eintrag]); leitung.quittieren();
    bridge.verlassen(KEY, ROOM);
    abgleichen(bridge, [eintrag]);
    assert.equal(eintrag.watchpartyRoom, ROOM);
    leitung.zustand([titel({ memberIds: ["pc"] })]); leitung.quittieren();
    assert.equal(abgleichen(bridge, [eintrag]).geaendert, true);
    assert.equal(eintrag.watchpartyRoom, "");
  });
  pruefe("Archivierter Titel wird nach Kaltstart erkannt und behaelt seinen Raum", ({ bridge, leitung }) => {
    const eintrag = alt();
    leitung.offen(); leitung.zustand([titel({ archived: true })]);
    assert.equal(bridge.eintraegeMitAnbieter(PROVIDER).length, 0);
    assert.equal(abgleichen(bridge, [eintrag]).geaendert, true);
    leitung.quittieren(); abgleichen(bridge, [eintrag]);
    assert.equal(eintrag.watchpartyArchived, true);
    assert.equal(eintrag.watchpartyRoom, ROOM);
  });
  console.log(`${tests}/${tests} Android-Raumbestand-Pruefungen bestanden`);
} finally { globalThis.WebSocket = vorher; }
