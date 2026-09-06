"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../..");
const assets = path.join(root, "android/app/src/main/assets/kern");
const files = fs.readFileSync(path.join(root, "android/app/build.gradle"), "utf8")
  .split("def kernModule = [")[1].split("]")[0].match(/"[^"]+\.js"/g).map(s => JSON.parse(s));
const requests = [];
const aborted = [];
let answer = () => null;
let context;
context = vm.createContext({
  console, URL, AbortController, AbortSignal, setTimeout, clearTimeout, atob, btoa,
  TextEncoder, TextDecoder, Uint8Array, Map, Set,
  AndroidKern: {
    netzStart(id, url, options) {
      requests.push({ id, url, ...JSON.parse(options) });
      const result = answer(url);
      if (result) queueMicrotask(() => context.ElfixKern.netzFertig(id, {
        status: 200, url, kopf: {}, koerper: result
      }));
    },
    netzAbbrechen(id) { aborted.push(id); },
    bereit() {}, protokoll() {}
  }
});
context.window = context;
vm.runInContext(fs.readFileSync(path.join(assets, "kern-knoten.js"), "utf8"), context);
vm.runInContext(fs.readFileSync(path.join(assets, "kern-host.js"), "utf8"), context);
for (const file of files) context.ElfixKern.quelle(path.basename(file),
  fs.readFileSync(path.join(root, "StreamingBrowserElectron", file), "utf8"));
for (const file of ["direkt-android.js", "watchparty-bruecke.js", "marken-bruecke.js"]) {
  context.ElfixKern.quelle(file, fs.readFileSync(path.join(assets, "eigen", file), "utf8"));
}
const direct = context.ElfixKern.require("direkt-android");
let count = 0;
async function test(name, fn) {
  await fn();
  count++;
  console.log("OK " + name);
}
const episode = n => `https://aniworld.to/anime/stream/test/staffel-1/episode-${n}`;
async function main() {
  await test("Android resolves the desktop parser through the real Java fetch bridge", async () => {
    answer = () => '<video><source src="https://cdn.example/movie.m3u8"></video>';
    const result = await direct.aufloesen("https://hoster.example/e/film", episode(1), "Android-Test");
    assert.equal(result.ok, true);
    assert.equal(result.quelle.adresse, "https://cdn.example/movie.m3u8");
    assert.equal(result.kopfzeilen.referer, "https://hoster.example/");
    assert.equal(result.kopfzeilen["user-agent"], "Android-Test");
    assert.equal(requests.at(-1).maxBytes, 4 * 1024 * 1024);
  });
  await test("Closing aborts the active Java request and ignores its late reply", async () => {
    answer = () => null;
    const pending = direct.aufloesen("https://hoster.example/slow", episode(1), "Android-Test");
    const request = requests.at(-1);
    direct.abbrechen();
    const result = await pending;
    assert.equal(result.ok, false);
    assert.ok(aborted.includes(request.id));
    context.ElfixKern.netzFertig(request.id, { status: 200, koerper: '<source src="https://cdn.example/late.mp4">' });
  });
  await test("A new load cancels the previous load", async () => {
    const first = direct.aufloesen("https://hoster.example/old", episode(1), "Android-Test");
    answer = () => '<source src="https://cdn.example/new.mp4">';
    const second = direct.aufloesen("https://hoster.example/new", episode(2), "Android-Test");
    assert.equal((await first).ok, false);
    assert.equal((await second).quelle.adresse, "https://cdn.example/new.mp4");
  });
  await test("Observed ads and live playlists are rejected", async () => {
    answer = () => "#EXTM3U\n#EXT-X-TARGETDURATION:30\n#EXTINF:30,\nad.ts\n#EXT-X-ENDLIST";
    assert.equal((await direct.pruefen("https://cdn.example/ad.m3u8", "https://hoster.example/e", "UA")).ok, false);
    answer = () => "#EXTM3U\n#EXT-X-TARGETDURATION:130\n#EXTINF:130,\nlive.ts";
    assert.equal((await direct.pruefen("https://cdn.example/live.m3u8", "https://hoster.example/e", "UA")).ok, false);
  });
  await test("Observed full HLS streams retain playback headers", async () => {
    answer = () => "#EXTM3U\n#EXT-X-TARGETDURATION:130\n#EXTINF:130,\nvideo.ts\n#EXT-X-ENDLIST";
    const result = await direct.pruefen("https://cdn.example/movie.m3u8", "https://hoster.example/e", "UA");
    assert.equal(result.ok, true);
    assert.equal(result.kopfzeilen.origin, "https://hoster.example");
  });
  await test("Next episode skips combined episodes and does not guess missing episodes", () => {
    const stand = { folgen: [1, 2, 3].map(n => ({ staffel: 1, folge: n, url: episode(n), gesperrt: n === 2 })) };
    assert.equal(direct.naechste(stand, episode(1)).folge, 3);
    assert.equal(direct.naechste(stand, episode(5)), null);
  });
  await test("Next season requires the current episode and the end of its list", () => {
    const stand = { folgen: [1, 2].map(n => ({ staffel: 1, folge: n, url: episode(n) })),
      staffeln: [{ staffel: 3, url: "season3" }, { staffel: 2, url: "season2" }] };
    assert.equal(direct.naechsteStaffel(stand, episode(1)), null);
    assert.equal(direct.naechsteStaffel(stand, episode(5)), null);
    assert.equal(direct.naechsteStaffel(stand, episode(2)).url, "season2");
  });
  await test("Native Watchparty uses the shared validation and keeps the host's position", () => {
    const wp = context.ElfixKern.require("watchparty-bruecke");
    const result = wp.steuerungPruefen({ key: "serie:test", room: "r", action: "pause", position: 40,
      sequenceId: 1, episodeId: "s1e1" }, { nativ: true, binHost: true, gleicheAdresse: true, season: 1, episode: 1 });
    assert.equal(result.nichtSpringen, true);
    assert.equal(result.position, 40);
    assert.equal(result.ereignis.playing, false);
    assert.equal(wp.steuerungPruefen({ key: "serie:test", room: "r", action: "play", position: 12,
      sequenceId: 0, episodeId: "s1e2" }, { nativ: true, gleicheAdresse: false, season: 1, episode: 1 }).tun, "nichts");
  });
  await test("Intro learning and button timing use the shared rules", () => {
    const marken = context.ElfixKern.require("marken-bruecke");
    marken.laden({});
    const provider = { id: "aniworld", name: "AniWorld", startUrl: "https://aniworld.to" };
    marken.sprung([], provider, episode(1), 10, 100);
    marken.sprung([], provider, episode(2), 11, 101);
    const marke = marken.skript([], provider, episode(3), false).marke;
    assert.ok(marke);
    assert.equal(direct.intro(marke, 11).sichtbar, true);
    assert.ok(direct.intro(marke, 11).ziel >= 100);
    assert.equal(direct.intro(marke, 200).sichtbar, false);
    assert.equal(direct.intro(null, 0).sichtbar, false);
  });
  await test("Buffered Watchparty commands recalculate target time after loading", () => {
    const result = direct.befehlJetzt({ position: 1, ereignis: {
      videoTime: 30, playing: true, hatUhr: true, timestamp: Date.now() - 3000, versatz: 0
    } });
    assert.ok(result.position >= 33 && result.position < 34);
    assert.equal(direct.befehlJetzt({ position: 1, ereignis: { videoTime: 30, playing: false } }).position, 30);
  });
  console.log(`${count}/${count} Android-Direktprüfungen bestanden.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
