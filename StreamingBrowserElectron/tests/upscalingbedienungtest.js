"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
const start = source.indexOf('ipcMain.handle("spieler:upscaling-setzen",');
assert.ok(start > 0);
const end = source.indexOf('\nipcMain.handle(', start + 1);
const helperStart = source.indexOf("function spielerUpscalingVerfahren()");
const helperEnd = source.indexOf("\n}", source.indexOf("function spielerUpscalingAktiv()")) + 2;
const sender = {};
let handler, saved = 0, changes = 0, stops = 0;
const sent = [];
const settings = { playback: { videoUpscaling: false, videoUpscalingMethod: "fsr1",
  videoUpscalingResolution: 1440, rtxVideoLicense: "", autoplayNextEpisode: false } };
const context = vm.createContext({
  ipcMain: { handle(_channel, callback) { handler = callback; } },
  settings, URL, spielerLauf: { id: 41 }, spielerUpscalingStatus: null,
  spielerView: { webContents: { send: (...args) => sent.push(args) } },
  vomSpieler: event => event === sender,
  saveSettings: () => { saved++; }, meldeEinstellungen: () => { changes++; },
  spielerRtxStop: () => { stops++; }, videoUpscalingStandSenden() {}
});
vm.runInContext(source.slice(helperStart, helperEnd) + "\n" + source.slice(start, end), context);
for (const [event, id, value] of [[{}, 41, true], [sender, 40, true], [sender, 41, "true"]]) {
  assert.equal(handler(event, id, value, 1440).ok, false);
}
for (const value of [undefined, null, "2160", "Auto", 1080, 4320, {}, NaN]) assert.equal(handler(sender, 41, true, value).ok, false);
assert.equal(saved, 0, "Foreign senders, old episodes and malformed input cannot change settings");
assert.equal(handler(sender, 41, true, 1440).an, true);
assert.equal(settings.playback.videoUpscaling, true);
assert.equal(settings.playback.autoplayNextEpisode, false);
assert.equal(saved, 1);
assert.equal(changes, 1, "The settings window receives the player's persisted change");
assert.deepEqual(sent.at(-1), ["spieler:upscaling", true, "fsr1", 1440]);
assert.equal(handler(sender, 41, false, 1440).an, false);
assert.equal(settings.playback.videoUpscaling, false);
assert.equal(stops, 1);
settings.playback.videoUpscalingMethod = "rtx";
assert.equal(handler(sender, 41, true, 2160).grund, "rtx-lizenz");
assert.equal(saved, 2, "The player cannot bypass RTX license acceptance");
assert.equal(settings.playback.videoUpscaling, false);
settings.playback.rtxVideoLicense = "2024-02-23";
assert.equal(handler(sender, 41, true, 2160).an, true);
assert.equal(settings.playback.videoUpscalingResolution, 2160);
assert.deepEqual(sent.at(-1), ["spieler:upscaling", true, "rtx", 2160]);
assert.equal(stops, 2, "Changing the output target stops the old native generation");
assert.equal(handler(sender, 41, true, 1440).aufloesung, 1440);
assert.equal(settings.playback.videoUpscalingResolution, 1440);
assert.equal(stops, 3);
assert.equal(changes, 4);
assert.equal(handler(sender, 41, true, "auto").aufloesung, "auto", "Auto-Ziel nach Monitor wird gespeichert");
assert.equal(settings.playback.videoUpscalingResolution, "auto");
assert.deepEqual(sent.at(-1), ["spieler:upscaling", true, "rtx", "auto"]);
// Automatisch: Anime4K fuer Anime-Adressen, RTX Video fuer Serien und Filme.
settings.playback.videoUpscalingMethod = "auto";
context.spielerLauf.url = "https://aniworld.to/anime/stream/frieren/staffel-1/episode-3";
assert.equal(handler(sender, 41, true, 1440).verfahren, "anime4k");
assert.deepEqual(sent.at(-1), ["spieler:upscaling", true, "anime4k", 1440]);
context.spielerLauf.url = "https://s.to/serie/stream/dark/staffel-1/episode-1";
assert.equal(handler(sender, 41, true, 1440).verfahren, "rtx");
context.spielerLauf.url = "https://example.org/filme/inception";
assert.equal(handler(sender, 41, true, 1440).verfahren, "rtx");
settings.playback.rtxVideoLicense = "";
const ohneLizenz = handler(sender, 41, true, 1440);
assert.equal(ohneLizenz.verfahren, "fsr1", "Ohne NVIDIA-Lizenz laufen Serien und Filme mit FSR 1");
assert.equal(ohneLizenz.an, true, "Automatisch verlangt fuer Anime und FSR keine Lizenz");
console.log("OK Player-Upscaling: persisted on/off and 1440p/4K, settings synchronization, current episode, sender, RTX license guard and automatic Anime4K/RTX choice");
