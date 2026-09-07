"use strict";

// Das Appearance-Speichern bekommt nur die sichtbaren Einstellungen aus dem
// Renderer. Die Verbindungsdaten bleiben im Hauptprozess und duerfen weder
// verloren gehen noch einen neuen Verbindungsaufbau ausloesen.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const sponsorblock = require("../src/sponsorblock");
const geraeteSchluessel = require("../src/geraete-schluessel");
const { raumcodesAufraeumen } = require("../src/watchparty-raeume");

const WURZEL = path.join(__dirname, "..");
const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").replace(/\r/g, "");
const PRELOAD = fs.readFileSync(path.join(WURZEL, "src/preload.js"), "utf8").replace(/\r/g, "");
const pruefungen = [];
const pruefe = (name, bedingung, detail = "") => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

function abschnitt(anfang, ende = "}") {
  const zeilen = MAIN.split("\n");
  const von = zeilen.findIndex((zeile) => zeile.startsWith(anfang));
  if (von < 0) throw new Error("nicht gefunden: " + anfang);
  let bis = von;
  while (bis < zeilen.length && zeilen[bis] !== ende) bis += 1;
  return zeilen.slice(von, bis + 1).join("\n");
}

const registriert = {};
const aufrufe = { gespeichert: 0, watchparty: 0, geraete: 0, fern: 0 };
const kontext = {
  SETTINGS_SCHEMA_VERSION: Number(MAIN.match(/^const SETTINGS_SCHEMA_VERSION = (\d+);$/m)[1]),
  WATCHPARTY_MAX_RAEUME: Number(MAIN.match(/^const WATCHPARTY_MAX_RAEUME = (\d+);$/m)[1]),
  crypto, sponsorblock, geraeteSchluessel, raumcodesAufraeumen,
  settings: {},
  Boolean, String, Number, Array, Object, JSON, Math, Date,
  ipcMain: { handle: (kanal, handler) => { registriert[kanal] = handler; } },
  saveSettings: () => { aufrufe.gespeichert += 1; },
  syncWatchparty: () => { aufrufe.watchparty += 1; },
  syncGeraete: () => { aufrufe.geraete += 1; },
  syncFern: () => { aufrufe.fern += 1; }
};
vm.createContext(kontext);
for (const name of ["function sanitizeChoice(", "function sanitizeColor(", "function sanitizeNumber(", "function publicSettings(", "function defaultSettings(", "function normalizeSettings("]) {
  vm.runInContext(abschnitt(name), kontext);
}
vm.runInContext(abschnitt('ipcMain.handle("settings:appearance-save"', "});"), kontext);

kontext.settings = vm.runInContext("normalizeSettings", kontext)({
  playback: { autoplayNextEpisode: false, direktModus: false },
  watchparty: { enabled: true, serverUrl: "wss://party.example", rooms: ["ROOM42"], deviceName: "Wohnzimmer", deviceId: "private-device-id", youtubeRoom: "ROOM42" },
  geraete: { key: "" },
  fern: { enabled: true, code: "PRIVATE-CODE" },
  appearance: { themeMode: "dark" }
});

const gespeichert = registriert["settings:appearance-save"](null, {
  themeMode: "light",
  accentColor: "ungueltig",
  fontScale: 999,
  deviceId: "renderer-kann-das-nicht-setzen"
});

pruefe("Der Appearance-Kanal ist im Preload bewusst getrennt", /saveAppearance: \(appearance\) => ipcRenderer\.invoke\("settings:appearance-save", appearance\)/.test(PRELOAD));
pruefe("Die Wiedergabe bleibt unveraendert", gespeichert.playback.autoplayNextEpisode === false && gespeichert.playback.direktModus === false);
pruefe("Watchparty-Daten bleiben im Hauptprozess erhalten", gespeichert.watchparty.serverUrl === "wss://party.example" && gespeichert.watchparty.deviceId === "private-device-id" && gespeichert.watchparty.youtubeRoom === "ROOM42");
pruefe("Fernbedienung und Geraete bleiben erhalten", gespeichert.fern.code === "PRIVATE-CODE" && gespeichert.fern.enabled === true && gespeichert.geraete.enabled === false);
pruefe("Appearance wird normalisiert", gespeichert.appearance.themeMode === "light" && gespeichert.appearance.accentColor === "#7c3aed" && gespeichert.appearance.fontScale === 140);
pruefe("Fremde Kennungen aus dem Appearance-Payload werden nicht uebernommen", gespeichert.watchparty.deviceId === "private-device-id");
pruefe("Gespeichert wird genau einmal", aufrufe.gespeichert === 1);
pruefe("Kein Appearance-Regler verbindet Dienste neu", aufrufe.watchparty === 0 && aufrufe.geraete === 0 && aufrufe.fern === 0);

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
