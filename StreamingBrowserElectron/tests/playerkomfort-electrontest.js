"use strict";
const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const profil = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-playerkomfort-"));
app.setPath("userData", profil);
app.disableHardwareAcceleration();
let fenster;
const frist = setTimeout(() => ende(1, Error("Playerkomfort Timeout")), 25000);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function warten(fn) {
  const bis = Date.now() + 6000;
  while (Date.now() < bis) { if (await fn()) return; await pause(25); }
  throw Error("Playerkomfort: erwarteter Zustand fehlt");
}
function ende(code, error) {
  if (error) console.error(error);
  clearTimeout(frist); fenster?.destroy(); app.exit(code);
}
app.whenReady().then(async () => {
  const wav = Buffer.alloc(44 + 15 * 8000, 128);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write("data", 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  const datei = path.join(profil, "test.wav"); fs.writeFileSync(datei, wav);
  const basis = { id: 1, adresse: pathToFileURL(datei).href, typ: "datei", titel: "Komfort-Test",
    untertitel: { aus: false, sprache: "de", name: "Deutsch" }, weiterZaehler: 0 };
  const gespeichert = [], mini = [], aktionen = [];
  ipcMain.on("spieler:bereit", e => e.sender.send("spieler:auftrag", basis));
  ipcMain.handle("spieler:chat-status", () => ({ active: false, messages: [] }));
  ipcMain.on("spieler:untertitel", (_e, id, vorgabe) => gespeichert.push({ id, vorgabe }));
  ipcMain.on("spieler:mini-status", (_e, an) => mini.push(an));
  ipcMain.on("spieler:aktion", (_e, aktion) => aktionen.push(aktion));
  fenster = new BrowserWindow({ show: false, width: 1100, height: 700, webPreferences: {
    preload: path.join(__dirname, "../src/spieler-preload.js"), sandbox: true,
    nodeIntegration: false, contextIsolation: true, backgroundThrottling: false,
    autoplayPolicy: "no-user-gesture-required"
  } });
  fenster.webContents.setAudioMuted(true);
  await fenster.loadFile(path.join(__dirname, "../src/renderer/spieler.html"));
  const js = (code, geste = false) => fenster.webContents.executeJavaScript(code, geste);
  await warten(() => js("bild.readyState >= 2"));
  assert.equal(await js("knopfMini.disabled"), true, "Reine Tonquelle oeffnet kein leeres Mini-Fenster");
  await js("bild.pause(); hls = {subtitleTrack:-1,subtitleDisplay:false}; untertitelSetzen([{lang:'en',name:'English'},{lang:'deu',name:'Deutsch'}])");
  assert.deepEqual(await js("[untertitelWahl.value,hls.subtitleTrack,hls.subtitleDisplay]"), ["1",1,true]);
  await js("untertitelSetzen([{lang:'de',name:'Deutsch'},{lang:'en',name:'English'}])");
  assert.equal(await js("hls.subtitleTrack"), 0, "Andere Reihenfolge behaelt die Sprache");
  await js("untertitelSetzen([{lang:'en',name:'English'}])");
  assert.deepEqual(await js("[hls.subtitleTrack,hls.subtitleDisplay,untertitelVorgabe.sprache]"), [-1,false,"de"]);
  await js("untertitelSetzen([{lang:'de',name:'Deutsch'}]); untertitelWahl.auf(); untertitelWahl.menue.querySelector('button').click()");
  await warten(() => Promise.resolve(gespeichert.length === 1));
  assert.equal(gespeichert[0].vorgabe.aus, true, "Nur explizite Wahl speichert Aus");
  await js("untertitelSetzen([{lang:'de',name:'Deutsch'}])");
  assert.equal(await js("hls.subtitleTrack"), -1, "Tracks-Update schaltet Aus nicht wieder ein");
  await js("hls = null; untertitelVorgabe = {aus:false,sprache:'de',name:'Deutsch'}; bild.addTextTrack('subtitles','English','en'); bild.addTextTrack('subtitles','Deutsch','de')");
  await warten(() => js("bild.textTracks[1].mode === 'showing'"));

  // Originales Videobild ohne heruntergeladene Testmedien oder Kamera-Rechte.
  await js(`
    const flaeche = document.createElement('canvas'); flaeche.width=320; flaeche.height=180;
    const ctx=flaeche.getContext('2d'); ctx.fillStyle='#2dd4bf'; ctx.fillRect(0,0,320,180);
    window.komfortStream=flaeche.captureStream(10);
    bild.removeAttribute('src'); bild.srcObject=window.komfortStream; bild.play();
  `);
  await warten(() => js("bild.videoWidth === 320 && !knopfMini.disabled"));
  assert.equal(await js("document.pictureInPictureEnabled"), true, "Electron bietet Bild-in-Bild");
  await js("miniUmschalten()", true);
  assert.equal(await js("document.pictureInPictureElement === bild"), true, "Echtes Mini-Fenster geoeffnet");
  assert.equal(await js("bild.paused"), false, "Wiedergabe bleibt im Mini-Player aktiv");
  await js("miniUmschalten()", true);
  await warten(() => js("document.pictureInPictureElement === null"));
  assert.ok(mini.includes(true)); assert.equal(mini.at(-1), false);
  await js("inRunde=true; binHost=false; bild.pause(); ausRundeBis=0; spielenUmschalten()");
  await warten(() => Promise.resolve(aktionen.includes("play")));
  assert.equal(await js("bild.paused"), true, "Watchparty-Play wartet weiterhin auf gemeinsamen Start");
  await js("inRunde=false; window.komfortStream.getTracks().forEach(track=>track.stop()); bild.srcObject=null");
  console.log("OK Echter Player: Untertitel merken/off/Spurwechsel, native Spuren, echtes Mini-Fenster und Watchparty-Startschranke");
}).then(() => ende(0), error => ende(1, error));
