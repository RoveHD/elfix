"use strict";
const { app, BrowserWindow, ipcMain, session } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http");
const assert = require("node:assert/strict");
const { gzipSync } = require("node:zlib");
const { absichern, lokaleNavigation } = require("../src/ipc-schutz");
const media = require("../src/spieler-netz");
for (const stream of [process.stdout, process.stderr]) stream.on("error", () => app.exit(2));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-security-"));
app.setPath("userData", path.join(root, "profile"));
const timeout = setTimeout(() => app.exit(3), 25000);
let server;
app.whenReady().then(async () => {
  const csp = fs.readFileSync(path.join(__dirname, "../src/renderer/spieler.html"), "utf8").match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0];
  // Chromium leaves `~` literal in senderFrame.url; pathToFileURL encodes it
  // as `%7E`. Keep this spelling in every run instead of relying on the CI
  // account's TEMP directory happening to use its Windows 8.3 alias.
  const file = path.join(root, "RUNNER~1", "player.html");
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, `<html><head>${csp}</head><body><video id="video" muted></video></body></html>`);
  let outbound = [];
  const samples = Buffer.alloc(16000, 128);
  const wav = Buffer.alloc(44 + samples.length);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34); wav.write("data", 36); wav.writeUInt32LE(samples.length, 40); samples.copy(wav, 44);
  server = http.createServer((req, res) => {
    outbound.push({ method: req.method, origin: req.headers.origin, range: req.headers.range, encoding: req.headers["accept-encoding"] });
    if (req.url === "/slow") return;
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/media" }); res.end(); return;
    }
    if (req.url === "/compressed") {
      const compressed = gzipSync("playlist-data");
      res.writeHead(200, { "Content-Type": "text/plain", "Content-Encoding": "gzip", "Content-Length": String(compressed.length) });
      res.end(compressed); return;
    }
    if (req.url === "/video.wav") {
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
      const from = range ? Number(range[1]) : 0;
      const to = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
      res.writeHead(range ? 206 : 200, { "Content-Type": "audio/wav", "Accept-Ranges": "bytes",
        "Content-Length": String(to - from + 1), ...(range ? { "Content-Range": `bytes ${from}-${to}/${wav.length}` } : {}) });
      res.end(wav.subarray(from, to + 1));
      return;
    }
    res.writeHead(req.headers.range ? 206 : 200, { "Content-Type": "text/plain", ...(req.headers.range ? { "Content-Range": "bytes 0-6/7" } : {}) });
    res.end("segment");
});
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const ses = session.fromPartition("security-media-test");
  media.einrichten(ses);
  // Dieselbe Hoster-Kopfzeilenanpassung wie im produktiven Player.
  ses.webRequest.onBeforeSendHeaders((details, done) => done({ requestHeaders: { ...details.requestHeaders, Origin: "https://hoster.example", Referer: "https://hoster.example/player" } }));
  const window = new BrowserWindow({ show: false, webPreferences: { session: ses,
    preload: path.join(__dirname, "../build/preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
  lokaleNavigation(window.webContents, file);
  absichern(ipcMain, () => ({ inhalt: window.webContents, datei: file })).handle("app:init", () => ({ marker: "protected" }));
  await window.loadFile(file);
  assert.equal((await window.webContents.executeJavaScript("streamingBrowser.init()")).marker, "protected");
  const endpoint = `http://127.0.0.1:${server.address().port}/media`;
  const result = await window.webContents.executeJavaScript(`fetch(${JSON.stringify(endpoint)}, { headers: { Range: 'bytes=0-6' } }).then(async r => ({status:r.status, text:await r.text(), range:r.headers.get('Content-Range')}))`);
  assert.deepEqual(result, { status: 206, text: "segment", range: "bytes 0-6/7" });
  assert.equal(outbound[0].origin, "https://hoster.example");
  assert.equal(outbound[0].encoding, "identity");
  const origin = `http://127.0.0.1:${server.address().port}`;
  // Den Handler selbst abbrechen: nur ein abgelehnter Renderer-fetch wuerde
  // ein intern haengendes Promise nicht aufdecken.
  const abortSession = session.fromPartition("security-abort-test");
  const controller = new AbortController();
  const interrupted = media.medienAbruf(new Request(origin + "/slow", { signal: controller.signal }), abortSession);
  setTimeout(() => controller.abort(), 100);
  let abortDeadline;
  await assert.rejects(Promise.race([interrupted, new Promise((_resolve, reject) => {
    abortDeadline = setTimeout(() => reject(new Error("Abbruch blieb haengen")), 2000);
  })]), /Medienabruf abgebrochen/);
  clearTimeout(abortDeadline);
  assert.equal(await window.webContents.executeJavaScript(`fetch(${JSON.stringify(origin + "/redirect")}).then(r=>r.text())`), "segment");
  assert.equal(await window.webContents.executeJavaScript(`fetch(${JSON.stringify(origin + "/compressed")}).then(r=>r.text())`), "playlist-data");
  assert.equal(await window.webContents.executeJavaScript(`fetch(${JSON.stringify(endpoint)}, {headers:{'Content-Type':'application/elfix-test'}}).then(r=>r.text())`), "segment");
  const videoUrl = `http://127.0.0.1:${server.address().port}/video.wav`;
  const duration = await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
    const video=document.getElementById('video'); video.onloadedmetadata=()=>resolve(video.duration);
    video.onerror=()=>reject(new Error('Medienabruf fehlgeschlagen')); video.src=${JSON.stringify(videoUrl)};
  })`);
  assert.equal(duration, 2);
  await window.webContents.executeJavaScript("document.getElementById('video').play()", true);
  assert.equal(await window.webContents.executeJavaScript("document.getElementById('video').paused"), false);
  await window.webContents.executeJavaScript("document.getElementById('video').pause()");
  await window.webContents.executeJavaScript("const injected=document.createElement('script'); injected.textContent='window.badScriptRan=true'; document.body.append(injected)");
  assert.equal(await window.webContents.executeJavaScript("Boolean(window.badScriptRan)"), false);
  assert.equal(await window.webContents.executeJavaScript("typeof require"), "undefined");
  assert.equal(window.webContents.getLastWebPreferences().sandbox, true);
  assert.equal(window.webContents.getLastWebPreferences().webSecurity, true);
  console.log("OK Echter Electron: Sandbox-Preload, IPC, CSP, Range und echte Medienwiedergabe ohne abgeschaltete Websicherheit");
  window.destroy(); server.close(); clearTimeout(timeout); app.exit(0);
}).catch(error => { console.error(error); server?.close(); app.exit(1); });
