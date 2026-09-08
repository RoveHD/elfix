"use strict";

// Echter Player, echtes HTMLVideoElement und echte Tastatureingaben, aber nur
// eine lokale WAV-Datei. Aufruf:
//   electron tests/spielerbedienung-electrontest.js
const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { pathToFileURL } = require("url");

const profil = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-spieler-bedienung-"));
app.setPath("userData", profil);
app.disableHardwareAcceleration();
let fenster;
let hlsServer;
let masterAntwort;
let anzahl = 0;
const frist = setTimeout(() => beenden(1, Error("Player-Bedienungspruefung blieb stehen")), 30000);
const pause = (ms) => new Promise((fertig) => setTimeout(fertig, ms));
const pruefe = (name, ist, soll) => {
  assert.deepEqual(ist, soll, name);
  anzahl += 1;
  console.log(`OK    ${name}`);
};
const warten = async (test) => {
  const ende = Date.now() + 7000;
  while (Date.now() < ende) {
    if (await test()) return;
    await pause(40);
  }
  throw Error("Playerzustand blieb aus");
};

app.whenReady().then(async () => {
  const daten = Buffer.alloc(45 * 8000, 128);
  const wav = Buffer.alloc(44 + daten.length);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write("data", 36);
  wav.writeUInt32LE(daten.length, 40); daten.copy(wav, 44);
  const datei = path.join(profil, "still.wav");
  fs.writeFileSync(datei, wav);
  const auftrag = {
    id: 1, adresse: pathToFileURL(datei).href, typ: "datei", titel: "Bedienungsprüfung",
    weiterZaehler: 0, hosterliste: []
  };
  ipcMain.on("spieler:bereit", (ereignis) => ereignis.sender.send("spieler:auftrag", auftrag));
  ipcMain.on("spieler:fehler", (_ereignis, text) => { throw Error(text); });
  ipcMain.handle("spieler:folgen", async () => null);
  ipcMain.handle("spieler:chat-status", async () => ({ active: false, messages: [] }));
  ipcMain.handle("spieler:wechseln", async () => ({ ok: true }));

  fenster = new BrowserWindow({ show: false, width: 1280, height: 720, webPreferences: {
    preload: path.join(__dirname, "../src/spieler-preload.js"), contextIsolation: true,
    sandbox: true, nodeIntegration: false, backgroundThrottling: false,
    autoplayPolicy: "no-user-gesture-required"
  } });
  fenster.webContents.setAudioMuted(true);
  await fenster.loadFile(path.join(__dirname, "../src/renderer/spieler.html"));
  const lesen = (code) => fenster.webContents.executeJavaScript(code);
  await warten(() => lesen("bild.readyState >= 2"));
  pruefe("Eine Datei ohne Varianten zeigt keine leere Qualitätsliste", await lesen(`
    [stufenWahl.disabled, stufenWahl.text.textContent, stufenWahl.eintraege.map(e => e.text)]
  `), [true, "Keine Qualitätsauswahl", ["Keine Qualitätsauswahl"]]);
  await lesen("stufenWahl.auf()");
  pruefe("Ohne Varianten lässt sich das Qualitätsmenü nicht öffnen", await lesen("stufenWahl.offen()"), false);
  hlsServer = http.createServer((anfrage, antwort) => {
    antwort.setHeader("access-control-allow-origin", "*");
    if (anfrage.url === "/master.m3u8") {
      // Der Test gibt das Manifest erst nach dem sichtbaren Lade-Zustand
      // frei. Das ist ein Ablauf, keine Wettrennen gegen localhost.
      masterAntwort = antwort;
    } else if (/^\/(360|720|1080)\.m3u8$/.test(anfrage.url)) {
      // Nach dem Manifest bleibt die Medienliste offen. Das verhindert einen
      // künstlichen HLS-Fehler, bevor die Auswahl geprüft ist.
    } else {
      antwort.statusCode = 404;
      antwort.end();
    }
  });
  await new Promise((fertig) => hlsServer.listen(0, "127.0.0.1", fertig));
  const hlsAdresse = `http://127.0.0.1:${hlsServer.address().port}/master.m3u8`;
  await lesen(`(() => {
    const echt = bild.canPlayType.bind(bild);
    bild.canPlayType = (typ) => typ === 'application/vnd.apple.mpegurl' ? 'probably' : echt(typ);
  })()`);
  fenster.webContents.send("spieler:auftrag", { ...auftrag, id: 2, adresse: hlsAdresse, typ: "hls" });
  await warten(() => lesen("auftrag.id === 2 && stufenWahl.text.textContent === 'Bildqualität wird geladen …'"));
  pruefe("Während des HLS-Manifests bleibt die Qualitätsliste ehrlich geschlossen", await lesen(`
    [Boolean(hls), stufenWahl.disabled, stufenWahl.text.textContent, stufenWahl.eintraege.map(e => e.text)]
  `), [true, true, "Bildqualität wird geladen …", ["Bildqualität wird geladen …"]]);
  await warten(() => Boolean(masterAntwort));
  masterAntwort.end("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\n360.m3u8\n"
    + "#EXT-X-STREAM-INF:BANDWIDTH=1600000,RESOLUTION=1280x720\n720.m3u8\n"
    + "#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1920x1080\n1080.m3u8\n");
  await warten(() => lesen("stufenWahl.disabled === false && stufenWahl.eintraege.length === 4"));
  pruefe("Ein echtes HLS-Manifest liefert auswählbare Qualitätsstufen", await lesen(`(() => {
    stufenWahl.auf();
    const vorWahl = [stufenWahl.text.textContent,
      [...stufenWahl.menue.querySelectorAll('button')].map(zeile => zeile.textContent)];
    stufenWahl.waehlen('1');
    return [vorWahl, hls.autoLevelEnabled, stufenWahl.text.textContent];
  })()`), [["1080p", ["Automatisch", "360p", "720p", "✓1080p"]], false, "720p"]);
  fenster.webContents.send("spieler:auftrag", auftrag);
  await warten(() => lesen("auftrag.id === 1 && bild.readyState >= 2"));
  await lesen("delete bild.canPlayType");

  await lesen(`(() => {
    window.__wechsel = [];
    folgeWechseln = (ziel) => window.__wechsel.push(ziel);
    naechste = { url: "lokal://folge-2", beschriftung: "Folge 2" };
    weiterZaehler = 1;
    weiterVerworfen = false;
    puffert = false;
    return bild.play().then(() => weiterAnbieten());
  })()`);
  await warten(() => lesen("Boolean(weiterUhr)"));
  await lesen("bild.pause()");
  await pause(1200);
  pruefe("Pause bricht den laufenden Folgen-Countdown ab", await lesen("window.__wechsel.length"), 0);

  await lesen(`(() => {
    weiterVerworfen = false; puffert = false;
    return bild.play().then(() => weiterAnbieten());
  })()`);
  await warten(() => lesen("Boolean(weiterUhr)"));
  await lesen("bild.dispatchEvent(new Event('waiting'))");
  await pause(1200);
  pruefe("Puffern bricht den laufenden Folgen-Countdown ab", await lesen("window.__wechsel.length"), 0);

  await lesen(`(() => {
    puffert = true; weiterVerworfen = false; weiterZaehler = 1;
    Object.defineProperty(bild, "ended", { configurable: true, get: () => true });
    bild.dispatchEvent(new Event("ended"));
  })()`);
  await warten(() => lesen("window.__wechsel.length === 1"));
  pruefe("Das echte Medienende startet die naechste Folge weiter", await lesen("window.__wechsel"), ["lokal://folge-2"]);

  await lesen(`(() => {
    window.__reglerTasten = [];
    regler.addEventListener("keydown", (ereignis) => window.__reglerTasten.push([ereignis.key, ereignis.code]));
    regler.value = "500";
    lautstaerke.value = "40";
    bild.pause();
    bild.currentTime = 10;
    regler.focus();
  })()`);
  fenster.webContents.focus();
  fenster.webContents.sendInputEvent({ type: "keyDown", keyCode: "RIGHT" });
  fenster.webContents.sendInputEvent({ type: "keyUp", keyCode: "RIGHT" });
  await warten(() => lesen("window.__reglerTasten.length === 1"));
  pruefe("Echte Pfeiltaste erreicht den fokussierten Timeline-Regler", await lesen("window.__reglerTasten"), [["ArrowRight", "ArrowRight"]]);
  await pause(100);
  pruefe("Timeline-Pfeil loest keinen globalen Zehnsekundensprung aus", await lesen("Math.round(bild.currentTime)"), 10);

  await lesen("lautstaerke.focus()");
  fenster.webContents.sendInputEvent({ type: "keyDown", keyCode: "UP" });
  fenster.webContents.sendInputEvent({ type: "keyUp", keyCode: "UP" });
  await warten(() => lesen("lautstaerke.value === '41'"));
  pruefe("Lautstaerke-Pfeil behaelt seine eigene Einzelschritt-Steuerung", await lesen("lautstaerke.value"), "41");

  await lesen("bild.play(); regler.focus()");
  await warten(() => lesen("!bild.paused"));
  fenster.webContents.sendInputEvent({ type: "keyDown", keyCode: "SPACE" });
  fenster.webContents.sendInputEvent({ type: "keyUp", keyCode: "SPACE" });
  await pause(150);
  pruefe("Leertaste auf einer Range pausiert den Film nicht", await lesen("bild.paused"), false);

  await lesen(`(() => {
    let fortsetzen;
    const altSetzen = stelleSetzen;
    const altSpielen = bild.play;
    window.__staleSpiele = 0;
    stelleSetzen = () => new Promise((fertig) => { fortsetzen = fertig; });
    bild.play = () => { window.__staleSpiele += 1; return Promise.resolve(); };
    auftrag = { startzeit: 10 };
    startGesetzt = false;
    bild.dispatchEvent(new Event("loadedmetadata"));
    starten({ laden: true });
    fortsetzen(true);
    return Promise.resolve().then(() => { stelleSetzen = altSetzen; bild.play = altSpielen; });
  })()`);
  await pause(100);
  pruefe("Ein wartender Metadaten-Horcher startet keine neue Quelle", await lesen("window.__staleSpiele"), 0);

  await lesen("inRunde = true; binHost = false; tempoRechteSetzen(); zeichneRunde([{ me: true, host: true, name: 'Du', zeit: '0:00' }])");
  pruefe("Solo-Host kann bedienen, obwohl die Teilnehmerleiste verborgen ist", await lesen("[regler.disabled, tempoWahl.disabled, rundeLeiste.hidden]"), [false, false, true]);
  await lesen("zeichneRunde([{ me: true, host: false, name: 'Du', zeit: '0:00' }, { me: false, host: true, name: 'Host', zeit: '0:00' }])");
  pruefe("Ein echter Hostwechsel sperrt die Gast-Quelleneinstellungen wieder", await lesen("[regler.disabled, tempoWahl.disabled]"), [true, true]);
  console.log(`${anzahl}/${anzahl} bestanden`);
}).then(() => beenden(0), (fehler) => beenden(1, fehler));

function beenden(code, fehler) {
  if (fehler) console.error("FAIL  " + (fehler.stack || fehler.message));
  clearTimeout(frist);
  fenster?.destroy();
  hlsServer?.close();
  app.exit(code);
}
