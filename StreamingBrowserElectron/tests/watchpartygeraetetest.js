"use strict";

// Hardware-facing desktop half of WatchpartyGeraeteTest.
//
// It is intentionally an Electron test, rather than a DOM imitation: the
// command crosses the production preload and the production spieler.js before
// it reaches a real HTMLVideoElement.  The Android instrumentation test uses
// the same command fields against Media3.  A live run starts this file and the
// instrumentation test while a fresh local relay is running.

const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-watchparty-device-"));
app.setPath("userData", dataDir);
app.disableHardwareAcceleration();
let window;
let timeout;
const stands = [];
const readyIds = [];

function waitFor(check, label, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    const end = Date.now() + timeoutMs;
    const tick = () => {
      Promise.resolve().then(check).then(ok => {
        if (ok) return resolve();
        if (Date.now() >= end) return reject(new Error(`Timeout: ${label}`));
        setTimeout(tick, 25);
      }, reject);
    };
    tick();
  });
}

function wavFixture() {
  const pcm = Buffer.alloc(125 * 8000, 128);
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
  const file = path.join(dataDir, "watchparty.wav");
  fs.writeFileSync(file, wav);
  return pathToFileURL(file).href;
}

app.whenReady().then(async () => {
  const source = wavFixture();
  const order = { id: 1, adresse: source, typ: "datei", titel: "Watchparty device fixture", startzeit: 8, weiterZaehler: 0, hosterliste: [] };
  ipcMain.on("spieler:bereit", event => event.sender.send("spieler:auftrag", order));
  ipcMain.on("spieler:stand", (_event, stand) => stands.push(stand));
  ipcMain.on("spieler:sync-bereit", (_event, id) => readyIds.push(String(id)));
  ipcMain.on("spieler:fehler", (_event, text) => { throw new Error(String(text)); });
  ipcMain.handle("spieler:folgen", async () => null);
  ipcMain.handle("spieler:autoplay", async () => false);
  ipcMain.handle("spieler:schluss", async () => 0);
  window = new BrowserWindow({ show: false, webPreferences: {
    preload: path.join(__dirname, "../src/spieler-preload.js"), contextIsolation: true,
    sandbox: true, nodeIntegration: false, backgroundThrottling: false,
    autoplayPolicy: "no-user-gesture-required"
  } });
  window.webContents.setAudioMuted(true);
  await window.loadFile(path.join(__dirname, "../src/renderer/spieler.html"));
  const read = code => window.webContents.executeJavaScript(code);
  await waitFor(() => read("document.getElementById('bild').currentTime >= 8"), "lokale Quelle gestartet");

  // syncprepare: pause first and quantise the source position before reporting ready.
  window.webContents.send("spieler:steuern", { stelle: 41.250, laufen: false, genau: true, bereitId: "phone-and-pc-ready" });
  await waitFor(() => readyIds.includes("phone-and-pc-ready"), "desktop meldet syncprepare-bereit");
  const paused = await read("({ time: document.getElementById('bild').currentTime, paused: document.getElementById('bild').paused })");
  assert.equal(paused.paused, true);
  assert.ok(Math.abs(paused.time - 41.250) <= 0.075, `pause frame differs: ${paused.time}`);

  // syncstart from the relay: both clients receive the same absolute local deadline.
  const startAt = Date.now() + 850;
  window.webContents.send("spieler:steuern", { stelle: 41.250, laufen: true, genau: true, startLokal: startAt, wartenMs: 850 });
  await waitFor(() => read("!document.getElementById('bild').paused && document.getElementById('bild').currentTime > 41.40"), "verabredeter Start");
  const after = await read("document.getElementById('bild').currentTime");
  assert.ok(after >= 41.40, `start advanced from wrong position: ${after}`);
  console.log(`OK  desktop real renderer: pause=${paused.time.toFixed(3)} ready=${readyIds[0]} start=${after.toFixed(3)}`);
}).then(() => quit(0), error => { console.error("FAIL", error.stack || error); quit(1); });

function quit(code) {
  clearTimeout(timeout);
  window?.destroy();
  app.exit(code);
}

timeout = setTimeout(() => { console.error("FAIL watchdog"); quit(1); }, 30_000);
