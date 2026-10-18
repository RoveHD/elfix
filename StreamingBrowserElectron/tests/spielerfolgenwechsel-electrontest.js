"use strict";

// Echter Player und echtes Medium, isolierte IPC-Antworten: Die Main-Seite
// des Quellenhandshakes prueft anbieterquellentest.js mit Produktionsfunktionen.
const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { pathToFileURL } = require("node:url");
const profil = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-folgenwechsel-"));
app.setPath("userData", profil); app.disableHardwareAcceleration();
let win;
const frist = setTimeout(() => ende(1, Error("Folgenwechsel-Zeitlimit")), 25000);
async function warte(fn) {
  const bis = Date.now() + 6000;
  while (Date.now() < bis) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw Error("Folgenwechsel-Zustand fehlt");
}
app.whenReady().then(async () => {
  const daten = Buffer.alloc(45 * 8000, 128), wav = Buffer.alloc(44 + daten.length);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write("data", 36);
  wav.writeUInt32LE(daten.length, 40); daten.copy(wav, 44);
  const alt = path.join(profil, "folge1.wav"), neu = path.join(profil, "folge2.wav");
  fs.writeFileSync(alt, wav); fs.writeFileSync(neu, wav);
  const alteQuelle = pathToFileURL(alt).href, neueQuelle = pathToFileURL(neu).href;
  const episode = "https://s.to/serie/test/staffel-1/episode-2";
  const auftrag = { id: 1, url: episode.replace("episode-2", "episode-1"), adresse: alteQuelle, typ: "datei", titel: "Folge 1", weiterZaehler: 0, hosterliste: [] };
  let wechselFertig, hosterFertig, anbieterAufrufe = 0, naechsteId = 1, ladeId;
  const fehler = [];
  ipcMain.on("spieler:bereit", event => event.sender.send("spieler:auftrag", auftrag));
  ipcMain.on("spieler:fehler", (_event, text) => { fehler.push(text); });
  ipcMain.handle("spieler:folgen", async () => null);
  ipcMain.handle("spieler:chat-status", async () => ({ active: false, messages: [] }));
  ipcMain.handle("spieler:wechseln", (event, url) => {
    assert.equal(url, episode);
    ladeId = ++naechsteId;
    event.sender.send("spieler:auftrag", { id: ladeId, url, adresse: "", laden: true, startzeit: 0, titel: "Folge 2", rundeWarten: true });
    return new Promise(resolve => { wechselFertig = resolve; });
  });
  ipcMain.handle("spieler:anbieter-seite", (event, id) => {
    assert.equal(id, ladeId); anbieterAufrufe++;
    event.sender.send("spieler:auftrag", { ...auftrag, id: ++naechsteId, url: episode, adresse: neueQuelle, titel: "Folge 2", startzeit: 0, rundeWarten: true });
    return "uebernommen";
  });
  ipcMain.handle("spieler:hoster", () => new Promise(resolve => { hosterFertig = resolve; }));
  win = new BrowserWindow({ show: false, webPreferences: {
    preload: path.join(__dirname, "../src/spieler-preload.js"), contextIsolation: true, sandbox: true,
    nodeIntegration: false, autoplayPolicy: "no-user-gesture-required"
  } });
  win.webContents.setAudioMuted(true);
  await win.loadFile(path.join(__dirname, "../src/renderer/spieler.html"));
  const lesen = code => win.webContents.executeJavaScript(code);
  await warte(() => lesen("bild.readyState >= 2"));
  await lesen("bild.currentTime=12;bild.play()");
  await warte(() => lesen("!bild.paused && bild.currentTime >= 12"));
  await lesen("window.wechselFertig=false;void folgeWechseln('https://s.to/serie/test/staffel-1/episode-2').then(()=>window.wechselFertig=true)");
  await warte(() => lesen("auftrag.id===2 && bild.readyState===0 && !bild.getAttribute('src')")).catch(async error => {
    throw Error(error.message + " " + JSON.stringify(await lesen("({id:auftrag.id,src:bild.currentSrc,attr:bild.getAttribute('src'),paused:bild.paused,wechsel:wechselLaeuft,fehler:fehlerKasten.textContent})")));
  });
  assert.deepEqual(await lesen("[bild.paused,bild.getAttribute('src'),auftrag.startzeit,auftrag.rundeWarten,hosterSeiteBedienung.hidden,wechselLaeuft]"),
    [true, null, 0, true, false, false], "Ladeauftrag stoppt alte Folge und erlaubt Bestaetigung fuer neue Folge");
  assert.equal(await lesen("folgenPanel.hidden"), true, "Neue Folgenwahl schliesst die Liste bereits beim Ladeauftrag");
  wechselFertig({ ok: false, grund: "Aktuelle neue Folge ohne Quelle" });
  await warte(() => lesen("window.wechselFertig"));
  assert.equal(await lesen("fehlerKasten.hidden"), false, "Fehler des passenden aktuellen Ladeauftrags bleibt sichtbar");
  assert.ok(await lesen("fehlerKasten.textContent.includes('Aktuelle neue Folge ohne Quelle')"));
  await lesen("window.wechselFertig=false;void folgeWechseln('https://s.to/serie/test/staffel-1/episode-2').then(()=>window.wechselFertig=true)");
  await warte(() => lesen("auftrag.id===3 && auftrag.laden && fehlerKasten.hidden"));
  await lesen("knopfHosterSeite.click()");
  await warte(() => lesen("auftrag.id===4 && bild.readyState>=2"));
  assert.equal(anbieterAufrufe, 1);
  assert.equal(await lesen("bild.currentSrc"), neueQuelle);
  assert.deepEqual(await lesen("[bild.paused,bild.currentTime,auftrag.rundeWarten]"), [true, 0, true],
    "Neue Folge beginnt bei Null und erhaelt die Watchparty-Schranke");
  wechselFertig({ ok: false, grund: "VOE: Keine spielbare Quelle beobachtet" });
  await warte(() => lesen("window.wechselFertig"));
  assert.deepEqual(await lesen("[auftrag.id,fehlerKasten.hidden,bild.currentSrc,bild.currentTime]"), [4, true, neueQuelle, 0],
    "Spaeter Fehler der ersetzten Aufloesung ueberschreibt bestaetigte Folge nicht");
  // Dieselbe Grenze gilt fuer einen alten Hosterwechsel derselben Episode.
  await lesen("inRunde=false;window.hosterFertig=false;void hosterWechseln('fixture-hoster').then(()=>window.hosterFertig=true)");
  await warte(() => Promise.resolve(Boolean(hosterFertig)));
  win.webContents.send("spieler:auftrag", { ...auftrag, id: 5, url: episode, adresse: neueQuelle, startzeit: 7, rundeWarten: true });
  await warte(() => lesen("auftrag.id===5 && bild.readyState>=2"));
  hosterFertig({ ok: false, grund: "Alter Hosterfehler" });
  await warte(() => lesen("window.hosterFertig"));
  assert.equal(await lesen("fehlerKasten.hidden"), true, "Alter Hosterfehler bleibt hinter neuer Auftragsgeneration");
  assert.equal(await lesen("bild.currentSrc"), neueQuelle);
  hosterFertig = null;
  await lesen("inRunde=false;window.hosterFertig=false;void hosterWechseln('fixture-hoster').then(()=>window.hosterFertig=true)");
  await warte(() => Promise.resolve(Boolean(hosterFertig)));
  win.webContents.send("spieler:auftrag", { id: 6, url: episode, adresse: "", laden: true });
  await warte(() => lesen("auftrag.id===6"));
  hosterFertig({ ok: false, grund: "Aktueller Hoster ohne Quelle" });
  await warte(() => lesen("window.hosterFertig"));
  assert.equal(await lesen("fehlerKasten.hidden"), false, "Auch aktueller Hosterfehler des passenden Ladeauftrags bleibt sichtbar");
  assert.ok(await lesen("fehlerKasten.textContent.includes('Aktueller Hoster ohne Quelle')"));
  naechsteId = 6;
  await lesen("window.wechselFertig=false;void folgeWechseln('https://s.to/serie/test/staffel-1/episode-2').then(()=>window.wechselFertig=true)");
  await warte(() => lesen("auftrag.id===7 && auftrag.laden"));
  win.webContents.send("spieler:auftrag", { id: 8, url: episode.replace("episode-2", "episode-3"), adresse: "", laden: true });
  await warte(() => lesen("auftrag.id===8"));
  wechselFertig({ ok: false, grund: "Spaeter Fehler der vorherigen Auswahl" });
  await warte(() => lesen("window.wechselFertig"));
  assert.equal(await lesen("fehlerKasten.hidden"), true, "Schon eine neuere Folgenauswahl ohne Quelle verwirft den alten Fehler");
  assert.equal(fehler.length, 2, "Nur die beiden aktuellen Fehler werden gemeldet, keine spaeten Antworten");
  console.log("OK Echter Player: alte Folge stoppt vor Quellenfindung, neue Quelle nach Bestaetigung, Start0/Watchparty und spaete Wechsel-/Hosterfehler sicher");
}).then(() => ende(0), error => ende(1, error));
function ende(code, error) {
  if (error) console.error(error.stack || error);
  clearTimeout(frist); win?.destroy(); app.exit(code);
}
