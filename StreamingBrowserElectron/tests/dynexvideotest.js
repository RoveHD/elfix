"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createHash } = require("node:crypto");
const { erstellen, medienAntwort, pipeName } = require("../src/dynex-video");

let checks = 0;
function pruefe(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
const media = { id: 1, url: "https://unknown-hoster.example/stream?private=not-for-dynex", ip: "203.0.113.8", statusCode: 206,
  resourceType: "xhr", responseHeaders: { "Content-Type": ["video/mp4"] } };
pruefe(medienAntwort(media), { address: media.ip, port: 443 }, "HTTPS video MIME proves actual server endpoint");
for (const mime of ["video/webm", "application/vnd.apple.mpegurl", "application/x-mpegurl", "application/dash+xml"]) {
  pruefe(medienAntwort({ ...media, responseHeaders: { "content-type": [mime] } })?.port, 443, mime);
}
pruefe(medienAntwort({ ...media, url: "http://media.example:8081/file", ip: "2001:db8::4" }), { address: "2001:db8::4", port: 8081 }, "IPv6 and explicit HTTP port");
pruefe(medienAntwort({ ...media, resourceType: "media", responseHeaders: { "content-type": ["application/octet-stream"] } })?.port, 443, "Chromium media resource with generic MIME");
for (const patch of [{ fromCache: true }, { statusCode: 404 }, { statusCode: 302 }, { statusCode: undefined }, { ip: "media.example" },
  { ip: "" }, { url: "file:///movie.mp4" }, { url: "https://user:secret@media.example/movie" }, { url: "https://media.example:0/movie" },
  { responseHeaders: { "content-type": ["video/mp4"], "content-disposition": ["attachment; filename=movie.mp4"] } },
  { responseHeaders: { "content-type": ["text/html"] } }, { responseHeaders: { "content-type": ["application/octet-stream"] } },
  { responseHeaders: { "content-type": ["video/mp4", "application/octet-stream"] } }, { responseHeaders: { "content-type": ["audio/mpeg"] }, resourceType: "media" }]) {
  pruefe(medienAntwort({ ...media, ...patch }), null, "cache, downloads, errors, ambiguous/nonmedia responses and guessed endpoints excluded");
}
const expectedHash = createHash("sha256").update("c:\\users\\fixture\\appdata\\local").digest("hex").slice(0, 24);
pruefe(pipeName("C:/Users/Fixture/AppData/Local/"), "dynex-media-" + expectedHash, "shared normalized per-user pipe-name contract");
pruefe(pipeName(""), "", "missing local user directory cannot use a shared global pipe");

function fixture({ platform = "win32", prozesse = () => [701, 702, 702], absent = false } = {}) {
  let time = 0;
  const clocks = new Set(), lines = [], sockets = [], paths = [];
  function stellen(fn, delay) { const c = { fn, at: time + delay, unref() {} }; clocks.add(c); return c; }
  function advance(ms) {
    const end = time + ms;
    for (let i = 0; i < 1000; i++) {
      const c = [...clocks].filter(c => c.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!c) { time = end; return; }
      clocks.delete(c); time = c.at; c.fn();
    }
    throw new Error("unbounded timer loop");
  }
  class Socket extends EventEmitter {
    writableLength = 0;
    destroyed = false;
    unref() {}
    write(line) { lines.push(JSON.parse(line)); return true; }
    end(line) { this.write(line); this.destroy(); }
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit("close"); } }
  }
  const reporter = erstellen({ platform, localAppData: "C:/Users/Fixture/AppData/Local", prozesse, jetzt: () => time,
    uhrStellen: stellen, uhrLoeschen: c => clocks.delete(c), verbinden: adresse => {
      paths.push(adresse);
      const socket = new Socket(); sockets.push(socket);
      stellen(() => socket.emit(absent ? "error" : "connect", new Error("absent")), 0);
      return socket;
    } });
  const ses = new EventEmitter();
  const hooks = {};
  ses.webRequest = Object.fromEntries(["onResponseStarted", "onCompleted", "onErrorOccurred"].map(name => [name, cb => { hooks[name] = cb; }]));
  reporter.beobachten(ses);
  return { reporter, ses, hooks, advance, lines, clocks, sockets, paths };
}

const f = fixture();
f.hooks.onResponseStarted(media); f.advance(0);
pruefe(f.lines[0], { version: 1, processIds: [701, 702], connections: [{ address: media.ip, port: 443 }] }, "actual endpoint and deduplicated process IDs, no URL or content");
pruefe(f.paths[0], "\\\\.\\pipe\\dynex-media-" + expectedHash, "Windows named pipe, no network listener");
pruefe(JSON.stringify(f.lines).includes("private"), false, "URL query never leaves ELFIX");
f.advance(5000);
pruefe(f.lines.length, 2, "five-second evidence renewal");
f.hooks.onResponseStarted({ ...media, id: 2, ip: "2001:db8::5" }); f.advance(260);
pruefe(f.lines.at(-1).connections.length, 2, "new media endpoint does not wait for the old renewal timer");
f.hooks.onErrorOccurred({ id: 2 }); f.advance(260);
pruefe(f.lines.at(-1).connections.length, 1, "failed media request loses evidence");
f.ses.emit("will-download", {}, { getURL: () => media.url, getURLChain: () => [media.url] }); f.advance(260);
pruefe(f.lines.at(-1).connections, [], "explicit file download revokes media endpoint");
f.hooks.onCompleted(media); f.advance(5000);
pruefe(f.lines.at(-1).connections, [], "download completion cannot recreate revoked media evidence");
f.hooks.onResponseStarted({ ...media, id: 3 }); f.advance(0);
f.hooks.onCompleted({ id: 3 }); f.advance(15500);
pruefe(f.lines.at(-1).connections, [], "completed buffered media evidence expires");
f.reporter.schliessen();
pruefe(f.lines.at(-1).connections, [], "app shutdown explicitly clears DYNEX evidence");
pruefe(f.clocks.size, 0, "shutdown leaves no renewal or reconnect timers");

const absent = fixture({ absent: true });
absent.hooks.onResponseStarted(media); absent.advance(30000);
pruefe(absent.paths.length <= 4, true, "missing DYNEX has bounded, energy-saving reconnects");
pruefe(absent.lines, [], "missing DYNEX does not affect media transport");
absent.reporter.schliessen();
const linux = fixture({ platform: "linux" });
pruefe(Object.keys(linux.hooks), [], "non-Windows installs do not start the optional companion");
linux.reporter.schliessen();
const unavailable = fixture({ prozesse: () => { throw new Error("app already quitting"); } });
unavailable.hooks.onResponseStarted(media); unavailable.advance(10000);
pruefe(unavailable.paths, [], "process-metrics error cannot crash playback or create unowned evidence");
unavailable.reporter.schliessen();
const many = fixture({ prozesse: () => Array.from({ length: 100 }, (_, i) => i + 1) });
for (let i = 0; i < 300; i++) many.hooks.onResponseStarted({ ...media, id: i, ip: "203.0.113." + (i % 250 + 1), url: "https://media.example:" + (1000 + i) + "/stream" });
many.advance(0);
pruefe(many.lines[0].processIds.length, 32, "process envelope is bounded");
pruefe(many.lines[0].connections.length, 64, "endpoint envelope is bounded");
assert.ok(Buffer.byteLength(JSON.stringify(many.lines[0])) < 16384); checks++;
many.reporter.schliessen();
console.log("PASS: " + checks + " DYNEX media sender checks");
