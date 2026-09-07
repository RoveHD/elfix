"use strict";

// Realer Player mit lokaler Quelle: prueft die Schranke einer neuen
// Watchparty-Folge ohne Relay oder externen Hoster.
const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const profil = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-spieler-barriere-"));
app.setPath("userData", profil);
app.disableHardwareAcceleration();
let fenster;
let anzahl = 0;
const bereit = [];
const frist = setTimeout(() => beenden(1, Error("Player-Barriere-Test blieb stehen")), 30000);
const pause = (ms) => new Promise((fertig) => setTimeout(fertig, ms));
const pruefe = (name, ist, soll) => { assert.deepEqual(ist, soll, name); anzahl += 1; console.log(`OK    ${name}`); };
const warten = async (test) => {
  const ende = Date.now() + 7000;
  while (Date.now() < ende) { if (await test()) return; await pause(40); }
  throw Error("Erwarteter Barrierenzustand blieb aus");
};

app.whenReady().then(async () => {
  const daten = Buffer.alloc(35 * 8000, 128);
  const wav = Buffer.alloc(44 + daten.length);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write("data", 36);
  wav.writeUInt32LE(daten.length, 40); daten.copy(wav, 44);
  const datei = path.join(profil, "still.wav");
  fs.writeFileSync(datei, wav);
  const auftrag = { id: 1, adresse: pathToFileURL(datei).href, typ: "datei", titel: "Schrankenprüfung",
    runde: true, rundeWarten: true, weiterZaehler: 0, hosterliste: [] };
  ipcMain.on("spieler:bereit", (ereignis) => ereignis.sender.send("spieler:auftrag", auftrag));
  ipcMain.on("spieler:sync-bereit", (_ereignis, id) => bereit.push(id));
  ipcMain.on("spieler:fehler", (_ereignis, text) => { throw Error(text); });
  ipcMain.handle("spieler:folgen", async () => null);
  ipcMain.handle("spieler:chat-status", async () => ({ active: false, messages: [] }));

  fenster = new BrowserWindow({ show: false, width: 1280, height: 720, webPreferences: {
    preload: path.join(__dirname, "../src/spieler-preload.js"), contextIsolation: true,
    sandbox: true, nodeIntegration: false, backgroundThrottling: false,
    autoplayPolicy: "no-user-gesture-required"
  } });
  fenster.webContents.setAudioMuted(true);
  await fenster.loadFile(path.join(__dirname, "../src/renderer/spieler.html"));
  const lesen = (code) => fenster.webContents.executeJavaScript(code);
  await warten(() => lesen("bild.readyState >= 2"));
  pruefe("Eine Barrieren-Folge startet nach Metadaten nicht lokal", await lesen("[bild.paused, !warteAufAlle.hidden]"), [true, true]);

  await lesen(`(() => {
    window.__spiele = 0;
    window.__originalPlay = bild.play.bind(bild);
    bild.play = () => { window.__spiele += 1; return window.__originalPlay(); };
    Object.defineProperty(bild, "readyState", { configurable: true, get: () => window.__barriereBereit ? 4 : 0 });
    window.__barriereBereit = false;
    starten({ id: 2, adresse: ${JSON.stringify(pathToFileURL(datei).href)}, typ: "datei", titel: "Neue Folge", runde: true, rundeWarten: true, weiterZaehler: 0, hosterliste: [] });
    steuernAusRunde({ tun: "stelle", stelle: 0, laufen: false, springen: true, genau: true, bereitId: "folge-2-bereit" });
  })()`);
  await pause(180);
  pruefe("syncprepare vor Metadaten bestätigt nicht voreilig", bereit, []);
  await lesen("spielenUmschalten()");
  pruefe("Ein Nutzer-Play während der Schranke startet nicht lokal", await lesen("window.__spiele"), 0);

  await lesen(`(() => {
    window.__barriereBereit = true;
    bild.dispatchEvent(new Event("loadedmetadata"));
  })()`);
  await warten(() => bereit.length === 1);
  pruefe("Nach Metadaten und Puffer geht genau eine Bereitschaft zurück", bereit, ["folge-2-bereit"]);
  pruefe("Bis syncstart bleibt die neue Folge angehalten", await lesen("[bild.paused, !warteAufAlle.hidden]"), [true, true]);

  await lesen(`(() => {
    delete bild.readyState;
    steuernAusRunde({ tun: "stelle", stelle: 0, laufen: true, springen: true, startLokal: Date.now() + 140, wartenMs: 140 });
  })()`);
  await warten(() => lesen("window.__spiele === 1 && !bild.paused && warteAufAlle.hidden"));
  pruefe("Der terminierte syncstart hebt die Schranke auf und spielt", await lesen("[window.__spiele, bild.paused, warteAufAlle.hidden]"), [1, false, true]);

  await lesen("steuernAusRunde({ tun: 'stelle', stelle: 0, laufen: false, springen: false, wartenAufFolge: true }); spielen.click()");
  pruefe("Schon waehrend der Quellenauflösung bleibt lokales Play gesperrt", await lesen("[bild.paused, window.__spiele, warteAufAlle.hidden]"), [true, 1, false]);
  pruefe("Quellenauflösung bestaetigt noch keine Player-Bereitschaft", bereit, ["folge-2-bereit"]);

  await lesen(`(() => {
    Object.defineProperty(bild, "readyState", { configurable: true, get: () => window.__barriereBereit ? 4 : 0 });
    window.__barriereBereit = false;
    starten({ id: 3, adresse: ${JSON.stringify(pathToFileURL(datei).href)}, typ: "datei", titel: "Timeout-Folge", runde: true, rundeWarten: true, weiterZaehler: 0, hosterliste: [] });
    steuernAusRunde({ tun: "stelle", stelle: 0, laufen: false, springen: true, genau: true, bereitId: "folge-3-bereit" });
    steuernAusRunde({ tun: "stelle", stelle: 0, laufen: false, springen: true, genau: true });
  })()`);
  pruefe("Ein Schranken-Timeout gibt die Bedienung wieder frei", await lesen("[warteAufAlle.hidden, spielen.getAttribute('aria-label')]"), [true, "Abspielen (Leertaste)"]);
  await lesen(`(() => { window.__barriereBereit = true; bild.dispatchEvent(new Event("loadedmetadata")); })()`);
  await pause(220);
  pruefe("Metadaten nach Timeout starten die Folgenquelle nicht allein", await lesen("[bild.paused, window.__spiele, warteAufAlle.hidden]"), [true, 1, true]);
  await lesen("delete bild.readyState");

  console.log(`${anzahl}/${anzahl} bestanden`);
}).then(() => beenden(0), (fehler) => beenden(1, fehler));

function beenden(code, fehler) {
  if (fehler) console.error("FAIL  " + (fehler.stack || fehler.message));
  clearTimeout(frist);
  fenster?.destroy();
  app.exit(code);
}
