"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(process.env.ELFIX_MAIN_SOURCE || path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
const start = source.indexOf('ipcMain.handle("spieler:upscaling-setzen",');
assert.ok(start > 0);
const end = source.indexOf('\nipcMain.handle(', start + 1);
const helperStart = source.indexOf("function spielerUpscalingAnimation()");
const helperEnd = source.indexOf("function spielerRtxStop()", helperStart);
assert.ok(helperStart > 0 && helperEnd > helperStart);
const cache = { pages: {} }, external = new Map(), jobs = [];
let lookups = 0, network = 0, brokenCache = false;
const lauf = require("../src/empfehlungslauf").erstellen({
  cacheLesen: () => cache,
  metadaten: () => ({ ausCache: wunsch => external.get(wunsch.titel) || null,
    nachschlagen: () => { network++; throw Error("Unexpected network lookup"); } }),
  holen: () => { network++; throw Error("Unexpected page lookup"); }
});
const sender = {};
let handler, saved = 0, changes = 0, stops = 0;
const sent = [];
const settings = { playback: { videoUpscaling: false, videoUpscalingMethod: "fsr1",
  videoUpscalingResolution: 1440, rtxVideoLicense: "", autoplayNextEpisode: false } };
const context = vm.createContext({
  ipcMain: { handle(_channel, callback) { handler = callback; } },
  settings, URL, spielerLauf: { id: 41 }, spielerUpscalingStatus: null,
  cleanBaseMediaTitle: require("../src/fortschritt").cleanBaseMediaTitle,
  lauf: { titelAnzeige: (...args) => {
    lookups++;
    if (brokenCache) throw Error("Bad optional cache");
    return lauf.titelAnzeige(...args);
  } },
  queueMicrotask: job => jobs.push(job),
  tasteCacheAblage: { planen() {} }, metadatenCacheAblage: { planen() {} },
  spielerView: { webContents: { send: (...args) => sent.push(args), isDestroyed: () => false } },
  vomSpieler: event => event === sender,
  saveSettings: () => { saved++; }, meldeEinstellungen: () => { changes++; },
  spielerRtxStop: () => { stops++; }, videoUpscalingStandSenden() {}
});
vm.runInContext(source.slice(helperStart, helperEnd) + "\n" + source.slice(start, end), context);
for (const name of ["saveTasteCacheSoon", "metadatenSpeichernSoon"]) {
  const begin = source.indexOf(`function ${name}()`);
  vm.runInContext(source.slice(begin, source.indexOf("\n}", begin) + 2), context);
}
const flush = () => { while (jobs.length) jobs.shift()(); };
const setLauf = (url, titel = "Testtitel") => { context.spielerLauf = { id: 41, url, titel }; };
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
setLauf("https://aniworld.to/anime/stream/frieren/staffel-1/episode-3");
assert.equal(handler(sender, 41, true, 1440).verfahren, "anime4k");
assert.deepEqual(sent.at(-1), ["spieler:upscaling", true, "anime4k", 1440]);
setLauf("https://s.to/serie/stream/dark/staffel-1/episode-1");
assert.equal(handler(sender, 41, true, 1440).verfahren, "rtx");
setLauf("https://example.org/filme/inception");
assert.equal(handler(sender, 41, true, 1440).verfahren, "rtx");
settings.playback.rtxVideoLicense = "";
const ohneLizenz = handler(sender, 41, true, 1440);
assert.equal(ohneLizenz.verfahren, "fsr1", "Ohne NVIDIA-Lizenz laufen Serien und Filme mit FSR 1");
assert.equal(ohneLizenz.an, true, "Automatisch verlangt fuer Anime und FSR keine Lizenz");

// Anbieterunabhaengig: Serienseite statt Episode; exakte URL statt Titelteil.
const avatar = "https://s.to/serie/avatar-die-sieben-hafen";
cache.pages[avatar] = { genres: [{ key: "animation", label: "Animation" }] };
setLauf(avatar + "/staffel-1/episode-2", "Avatar - Die sieben Häfen · Staffel 1 Folge 2");
assert.equal(handler(sender, 41, true, 2160).verfahren, "anime4k");
assert.equal(network, 0);
const previousLookups = lookups;
for (let i = 0; i < 200; i++) assert.equal(context.spielerUpscalingVerfahren(), "anime4k");
assert.equal(lookups, previousLookups, "No cache traversal for each video frame");
settings.playback.rtxVideoLicense = "2024-02-23";
setLauf("https://filmo.to/filme/avatar", "Avatar");
assert.equal(context.spielerUpscalingVerfahren(), "rtx", "A similarly named live-action film is not the animated series");
setLauf("https://different-provider.test/serie/avatar-die-sieben-hafen/staffel-1/episode-2");
assert.equal(context.spielerUpscalingVerfahren(), "rtx", "Unrelated provider pages do not share genre evidence");
const animatedFilm = "https://filmo.to/filme/animated-fixture";
cache.pages[animatedFilm] = { genres: [{ key: "animation", label: "Animation" }] };
setLauf(animatedFilm);
assert.equal(context.spielerUpscalingVerfahren(), "anime4k", "Animated films use Anime4K too");

// Externer Cache: dieselbe hohe Zuordnungsschwelle wie auf der Titelkarte.
for (const confidence of ["EXACT", "HIGH", "MEDIUM", "LOW"]) {
  external.set("Externes Werk", { konfidenz: confidence, genres: ["Animation"] });
  setLauf("https://s.to/serie/externes-werk/staffel-1/episode-1", "Externes Werk · Staffel 1 Folge 1");
  assert.equal(context.spielerUpscalingVerfahren(), ["EXACT", "HIGH"].includes(confidence) ? "anime4k" : "rtx");
}
external.clear();
setLauf("https://s.to/serie/anime-dokumentation/staffel-1/episode-1", "Anime in Japan");
assert.equal(context.spielerUpscalingVerfahren(), "rtx", "Title words alone do not classify animation");
brokenCache = true;
setLauf("https://s.to/serie/bad-cache/staffel-1/episode-1");
assert.equal(context.spielerUpscalingVerfahren(), "rtx", "Optional metadata failure cannot prevent playback");
brokenCache = false;

// Beide echten Schreib-Hooks wechseln nur die Bildverarbeitung, dedupliziert.
const late = "https://s.to/serie/spaete-daten";
setLauf(late + "/staffel-1/episode-1", "Spaete Daten");
assert.equal(context.spielerUpscalingVerfahren(), "rtx");
cache.pages[late] = { genres: [{ key: "anime", label: "Anime" }] };
let beforeSent = sent.length, beforeStops = stops;
context.saveTasteCacheSoon(); context.saveTasteCacheSoon();
assert.equal(jobs.length, 1, "Multiple cache writes schedule one recheck");
flush();
assert.equal(stops, beforeStops + 1, "Late Anime data stops the RTX helper");
assert.deepEqual(sent.slice(beforeSent), [["spieler:upscaling", true, "anime4k", 2160]]);
beforeSent = sent.length;
context.saveTasteCacheSoon(); flush();
assert.equal(sent.length, beforeSent, "Unchanged genres do not restart processing");

delete cache.pages[late];
setLauf(late + "/staffel-1/episode-1", "Spaete Daten");
assert.equal(context.spielerUpscalingVerfahren(), "rtx");
external.set("Spaete Daten", { konfidenz: "HIGH", genres: ["Zeichentrick"] });
context.metadatenSpeichernSoon(); flush();
assert.deepEqual(sent.at(-1), ["spieler:upscaling", true, "anime4k", 2160]);

for (const method of ["rtx", "fsr1", "anime4k"]) {
  settings.playback.videoUpscalingMethod = method;
  setLauf(avatar + "/staffel-1/episode-2");
  assert.equal(context.spielerUpscalingVerfahren(), method);
  beforeSent = sent.length;
  context.saveTasteCacheSoon(); flush();
  assert.equal(sent.length, beforeSent, "Manual selection stays unchanged by metadata");
}
settings.playback.videoUpscalingMethod = "auto";
setLauf("https://s.to/serie/old/staffel-1/episode-1");
assert.equal(context.spielerUpscalingVerfahren(), "rtx");
context.saveTasteCacheSoon();
setLauf(avatar + "/staffel-1/episode-2");
beforeSent = sent.length;
flush();
assert.equal(sent.length, beforeSent, "Queued metadata for an old stream cannot alter the new one");
assert.equal(context.spielerUpscalingVerfahren(), "anime4k");
settings.playback.videoUpscaling = false;
beforeSent = sent.length;
context.saveTasteCacheSoon(); flush();
assert.equal(sent.length, beforeSent, "Metadata cannot enable disabled upscaling");
assert.equal(network, 0, "Recognition uses only existing caches");
console.log("OK Player-Upscaling: persisted on/off and 1440p/4K, settings synchronization, current episode, sender, RTX license guard and automatic Anime4K/RTX choice");
console.log("OK Auto: provider genres, safe metadata, title identity, manual overrides, cached frame path and late genre updates without stream reload");
