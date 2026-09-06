"use strict";

// Aufruf: npx electron tests/direktelectrontest.js
// Echte Preload-Bruecke und echtes HTMLVideoElement, nur lokale Testdaten.
const { app, BrowserWindow, WebContentsView, ipcMain, session } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const vm = require("vm");
const assert = require("assert/strict");
const { pathToFileURL } = require("url");
const direktbeobachtung = require("../src/direktbeobachtung");
const ablage = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-direkt-test-"));
app.setPath("userData", ablage);
app.disableHardwareAcceleration();
let fenster;
let server;
const meldungen = [];
const frist = setTimeout(() => { console.error("FAIL  Electron-Test blieb stehen"); app.exit(1); }, 30000);
const warten = async (pruefen) => {
  const ende = Date.now() + 10000;
  while (Date.now() < ende) {
    if (await pruefen()) return;
    await new Promise((fertig) => setTimeout(fertig, 50));
  }
  throw Error("Erwarteter Player-Zustand blieb aus");
};

app.whenReady().then(async () => {
  // Eine stille PCM-Datei reicht fuer Metadaten, Play/Pause und Seek.
  const daten = Buffer.alloc(125 * 8000, 128);
  const wav = Buffer.alloc(44 + daten.length);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write("data", 36);
  wav.writeUInt32LE(daten.length, 40); daten.copy(wav, 44);
  const datei = path.join(ablage, "still.wav"); fs.writeFileSync(datei, wav);
  let auftrag = { id: 1, adresse: pathToFileURL(datei).href, typ: "datei", titel: "Lokale Probe", startzeit: 6,
    weiterZaehler: 0, hosterliste: [] };
  ipcMain.on("spieler:bereit", (event) => event.sender.send("spieler:auftrag", auftrag));
  ipcMain.on("spieler:stand", (_event, stand) => meldungen.push(stand));
  ipcMain.on("spieler:fehler", (_event, text) => { throw Error(text); });
  ipcMain.handle("spieler:folgen", async () => null);
  fenster = new BrowserWindow({ show: false, webPreferences: {
    preload: path.join(__dirname, "../src/spieler-preload.js"),
    contextIsolation: true, sandbox: true, nodeIntegration: false,
    backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required"
  } });
  fenster.webContents.setAudioMuted(true);
  await fenster.loadFile(path.join(__dirname, "../src/renderer/spieler.html"));
  const lesen = (code) => fenster.webContents.executeJavaScript(code);
  await warten(() => lesen('document.getElementById("bild").currentTime >= 6'));
  assert.equal(await lesen("Hls.isSupported()"), true);
  fenster.webContents.send("spieler:steuern", { tun: "fern", befehl: "pause" });
  await warten(() => meldungen.at(-1)?.laeuft === false);
  assert.equal(meldungen.at(-1).auftragId, 1);
  const vorher = await lesen('document.getElementById("bild").currentTime');
  fenster.webContents.send("spieler:steuern", { tun: "fern", befehl: "vor", vor: 30 });
  await warten(() => lesen(`document.getElementById("bild").currentTime >= ${vorher + 29}`));
  fenster.webContents.send("spieler:steuern", { tun: "fern", befehl: "stumm" });
  await warten(() => meldungen.at(-1)?.stumm === true);
  fenster.webContents.send("spieler:steuern", { tun: "fern", befehl: "lauter" });
  await warten(() => meldungen.at(-1)?.stumm === false);
  console.log("OK    Echte Preload-Bruecke: Startposition, Pause, Seek und Ton");

  auftrag = { id: 2, auswahl: true, hosterliste: [{ adresse: "hoster", hoster: "VOE", fassung: "Deutsch" }], weiterZaehler: 0 };
  fenster.webContents.send("spieler:auftrag", auftrag);
  await warten(() => lesen('document.getElementById("hosterWahl").options.length === 2'));
  assert.equal(await lesen('document.getElementById("hosterWahl").disabled'), false);
  console.log("OK    Fehler-Auswahl mit einem Hoster bleibt bedienbar");

  // Die Produktions-Beobachtung liest einen lokal nachgebauten Hoster, der
  // seine Playlist erst per JavaScript anfordert. Kein fremder Dienst.
  server = http.createServer((anfrage, antwort) => {
    if (anfrage.url === "/master.m3u8") antwort.end("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nmedia.m3u8\n");
    else if (anfrage.url === "/media.m3u8") antwort.end("#EXTM3U\n#EXTINF:125,\na.ts\n#EXT-X-ENDLIST\n");
    else { antwort.setHeader("content-type", "text/html"); antwort.end('<script>fetch("/master.m3u8")</script>'); }
  });
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  const url = `http://127.0.0.1:${server.address().port}/hoster`;
  const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
  const funktion = (name) => {
    const start = main.search(new RegExp(`(?:async )?function ${name}\\(`));
    return main.slice(start, main.indexOf("\n}", start) + 2);
  };
  const beobachter = new Map();
  const c = vm.createContext({ console, app, WebContentsView, direktbeobachtung,
    browserSession: session.fromPartition("elfix-direkt-test"), direktBeobachter: beobachter,
    webContentsProvider: new Map(), providerModel: { isHttpUrl: (wert) => /^https?:/.test(wert) },
    frameQuelle: (details) => details.referrer || "", setTimeout, FRAME_SCRIPT_TIMEOUT_MS: 1000 });
  vm.runInContext(["isLiveView", "executeJavaScriptInMediaFrames", "configureBrowserSession", "direktQuelleBeobachten"]
    .map(funktion).join("\n"), c);
  c.configureBrowserSession();
  const ergebnis = await c.direktQuelleBeobachten({ id: "test" }, url, url, new AbortController().signal);
  assert.equal(ergebnis.ok, true);
  assert.equal(ergebnis.quelle.adresse, url.replace("/hoster", "/master.m3u8"));
  assert.equal(beobachter.size, 0);
  console.log("OK    Stufe 2: echter Netzwerk-Horcher, Manifest und Aufraeumen");
  console.log("3/3 bestanden");
}).then(() => beenden(0), (fehler) => { console.error(`FAIL  ${fehler.stack}`); beenden(1); });

function beenden(code) {
  clearTimeout(frist);
  fenster?.destroy();
  server?.close();
  app.exit(code);
}
