"use strict";
const { app, BrowserWindow, ipcMain, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const media = require("../src/spieler-netz");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-upscaling-player-"));
app.setPath("userData", profile);
// Closing the recording helper must not end the test before the real player exists.
app.on("window-all-closed", () => {});
if (process.env.ELFIX_FSR_HARDWARE !== "1") {
  app.commandLine.appendSwitch("use-gl", "angle");
  app.commandLine.appendSwitch("use-angle", "swiftshader");
  app.commandLine.appendSwitch("enable-unsafe-swiftshader");
}
let window, recorder, server;
const statuses = [], errors = [], requests = [], bridgeResponses = [];
const timeout = setTimeout(() => finish(1, new Error("Upscaling player timeout")), 40000);
function finish(code, error) {
  clearTimeout(timeout);
  if (error) console.error(error);
  window?.destroy(); recorder?.destroy(); server?.close(); app.exit(code);
}
async function until(check) {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw Error(`Player state missing: ${JSON.stringify(statuses.at(-1))}; ${errors.join(", ")}`);
}
app.whenReady().then(async () => {
  recorder = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  await recorder.loadURL("about:blank");
  const bytes = await require("./komfort-video")(recorder, path.join(profile, "fixture.webm"));
  recorder.destroy(); recorder = null;
  server = http.createServer((req, res) => {
    requests.push({ cookie: req.headers.cookie, range: req.headers.range, origin: req.headers.origin });
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
    const from = range ? Number(range[1]) : 0;
    const to = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    res.writeHead(range ? 206 : 200, { "Content-Type": "video/webm", "Accept-Ranges": "bytes",
      "Content-Length": to - from + 1, ...(range ? { "Content-Range": `bytes ${from}-${to}/${bytes.length}` } : {}) });
    res.end(bytes.subarray(from, to + 1));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/video.webm`;
  const provider = session.fromPartition("persist:fsr-provider");
  await provider.cookies.set({ url, name: "fsr-auth", value: "fixture", path: "/" });
  const player = session.fromPartition("fsr-player");
  const bridge = media.medienHandler(request => media.medienAbruf(request, provider));
  await player.protocol.handle("http", async request => {
    const response = await bridge(request);
    bridgeResponses.push(response.headers.get("access-control-allow-origin"));
    return response;
  });
  ipcMain.on("spieler:bereit", event => event.sender.send("spieler:auftrag", {
    id: 41, adresse: url, typ: "datei", titel: "Upscaling-Probe", videoUpscaling: true, weiterZaehler: 0
  }));
  ipcMain.on("spieler:upscaling-status", (_event, id, status) => statuses.push({ id, ...status }));
  ipcMain.on("spieler:fehler", (_event, message) => errors.push(message));
  ipcMain.handle("spieler:chat-status", () => ({ active: false, messages: [] }));
  window = new BrowserWindow({ show: false, width: 640, height: 360, useContentSize: true, webPreferences: {
    session: player, preload: path.join(__dirname, "../src/spieler-preload.js"),
    nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false,
    autoplayPolicy: "no-user-gesture-required"
  } });
  await window.loadFile(path.join(__dirname, "../src/renderer/spieler.html"));
  const js = code => window.webContents.executeJavaScript(code);
  await until(() => statuses.at(-1)?.zustand === "aktiv");
  assert.equal(statuses.at(-1).id, 41);
  assert.ok(requests.some(r => r.cookie?.includes("fsr-auth=fixture")), "Provider session cookies survive anonymous video CORS");
  assert.ok(bridgeResponses.includes("null"), "The media bridge permits CORS only for the local player origin");
  const before = await js(`(() => {
    bild.loop=true; window.unwanted=[];
    for (const event of ['pause','seeking','emptied']) bild.addEventListener(event,()=>window.unwanted.push(event));
    const v=bild.getBoundingClientRect(),c=document.querySelector('#fsrBild').getBoundingClientRect();
    return {source:bild.currentSrc,paused:bild.paused,cors:bild.crossOrigin,sizes:[v.width,v.height,c.width,c.height]};
  })()`);
  assert.equal(before.paused, false);
  assert.equal(before.cors, "anonymous");
  assert.equal(before.sizes[0], before.sizes[2]);
  assert.equal(before.sizes[1], before.sizes[3]);
  window.webContents.send("spieler:upscaling", false);
  await until(() => statuses.at(-1)?.zustand === "aus");
  assert.equal(await js("document.querySelector('#fsrBild').hidden"), true);
  window.webContents.send("spieler:upscaling", true);
  await until(() => statuses.at(-1)?.zustand === "aktiv");
  assert.deepEqual(await js("({source:bild.currentSrc,paused:bild.paused,events:window.unwanted})"),
    { source: before.source, paused: false, events: [] }, "Toggling preserves decoder, source, position and playback");
  assert.deepEqual(errors, []);
  console.log("OK FSR player integration: production HTML/preload, CORS, provider cookies, layout and live toggle without reload/pause");
  finish(0);
}).catch(error => finish(1, error));
