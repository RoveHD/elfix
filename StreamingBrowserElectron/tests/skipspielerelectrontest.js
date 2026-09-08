"use strict";
const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const profil = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-skip-player-"));
app.setPath("userData", profil);
app.disableHardwareAcceleration();
let fenster;
const frist = setTimeout(() => ende(1, Error("Skip-Player-Test Timeout")), 40000);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function warten(fn) {
  const bis = Date.now() + 6000;
  while (Date.now() < bis) { if (await fn()) return; await pause(30); }
  throw Error("Erwarteter Skip-Playerzustand blieb aus");
}
function ende(code, error) {
  if (error) console.error(error);
  clearTimeout(frist);
  fenster?.destroy();
  app.exit(code);
}
app.whenReady().then(async () => {
  const wav = Buffer.alloc(44 + 50 * 8000, 128);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write("data", 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  const datei = path.join(profil, "test.wav");
  fs.writeFileSync(datei, wav);
  const basis = { id: 1, adresse: pathToFileURL(datei).href, typ: "datei", titel: "Skip-Test",
    skipSegments: true, weiterZaehler: null, hosterliste: [] };
  const segmente = [
    { type: "intro", start: 3, end: 9, source: "aniskip", confidence: 1 },
    { type: "recap", start: 12, end: 15, source: "skipdb", confidence: 1 },
    { type: "preview", start: 30, end: 35, source: "theintrodb", confidence: 1 },
    { type: "outro", start: 40, end: 48, source: "introdb", confidence: 1 }
  ];
  let abrufe = 0;
  let spaet;
  const spruenge = [];
  const aktionen = [];
  ipcMain.on("spieler:bereit", e => e.sender.send("spieler:auftrag", basis));
  ipcMain.handle("spieler:chat-status", async () => ({ active: false, messages: [] }));
  ipcMain.handle("spieler:skip-segmente", (_e, id) => {
    abrufe++;
    if (id === 2 || id === 4) return new Promise(resolve => { spaet = resolve; });
    return id === 3 ? [] : segmente;
  });
  ipcMain.on("spieler:sprung", (_e, von, nach, genutzt) => spruenge.push({ von, nach, genutzt }));
  ipcMain.on("spieler:aktion", (_e, aktion) => aktionen.push(aktion));
  fenster = new BrowserWindow({ show: false, width: 1280, height: 720, webPreferences: {
    preload: path.join(__dirname, "../src/spieler-preload.js"), sandbox: true,
    nodeIntegration: false, contextIsolation: true, backgroundThrottling: false,
    autoplayPolicy: "no-user-gesture-required"
  } });
  fenster.webContents.setAudioMuted(true);
  await fenster.loadFile(path.join(__dirname, "../src/renderer/spieler.html"));
  fenster.show();
  const js = code => fenster.webContents.executeJavaScript(code);
  await warten(() => js("bild.readyState >= 2 && skipSegmente.length === 4"));
  const farbspur = await js("getComputedStyle(regler).backgroundImage");
  for (const farbe of ["rgb(45, 212, 191)", "rgb(251, 146, 60)", "rgb(167, 139, 250)", "rgb(244, 114, 182)"]) {
    assert.ok(farbspur.includes(farbe), `Abschnittsfarbe ${farbe} wird auf der Zeitleiste gerendert`);
  }
  assert.match(farbspur, /rgb\(45, 212, 191\) 6%, rgb\(45, 212, 191\) 18%/, "Intro liegt bei 3 bis 9 von 50 Sekunden");
  for (const [stelle, hinweis] of [[5, "Intro · 0:05"], [13, "Rückblick · 0:13"],
    [32, "Vorschau · 0:32"], [42, "Abspann · 0:42"], [20, "0:20"]]) {
    await js(`regler.dispatchEvent(new PointerEvent('pointermove', { clientX: regler.getBoundingClientRect().left + regler.getBoundingClientRect().width * ${stelle + 0.1} / 50 }))`);
    await warten(() => js(`vorschauText.textContent === ${JSON.stringify(hinweis)}`));
    assert.equal(await js("vorschauText.textContent"), hinweis, "Vorschau beschreibt den Abschnitt unter der Maus");
    assert.equal(await js("regler.hasAttribute('title')"), false, "Kein doppelter nativer Tooltip");
  }
  await js("inRunde = true; binHost = false; spulenRechteSetzen()");
  assert.match(await js("vorschauText.textContent"), /Spulen steuert der Host$/, "Gast sieht weiterhin den Spulhinweis");
  await js("inRunde = false; spulenRechteSetzen(); regler.dispatchEvent(new PointerEvent('pointerleave'))");
  assert.equal(await js("regler.title"), "Zeitleiste", "Verlassen entfernt den letzten Abschnittshinweis");
  await js("reglerFaerben(45)");
  assert.equal(await js("getComputedStyle(regler).backgroundImage.split('linear-gradient')[1]"),
    farbspur.split("linear-gradient")[1], "Gespielte Abschnitte behalten ihre Markierung");
  await js("bild.pause(); bild.currentTime = 2; markeZeigen(2)");
  await js("naechsteSetzen({url: 'https://aniworld.to/anime/stream/test/staffel-1/episode-2'}); bild.currentTime = 39; weiterKnopfZeigen()");
  assert.equal(await js("knopfWeiter.hidden"), true, "Vor dem Abspann bleibt Naechste Folge verborgen");
  await js("bild.currentTime = 40; weiterKnopfZeigen()");
  assert.equal(await js("knopfWeiter.hidden"), false, "Abspann zeigt Naechste Folge schon vor 90 Prozent");
  assert.equal(await js("Boolean(weiterUhr)"), false, "Abspann startet keinen Autoplay-Countdown");
  await js("bild.currentTime = 49; weiterKnopfZeigen()");
  assert.equal(await js("knopfWeiter.hidden"), false, "Angebot bleibt nach dem Abspann sichtbar");
  await js("skipSegmente.find(s => s.type === 'outro').start = 47; bild.currentTime = 45; weiterKnopfZeigen()");
  assert.equal(await js("knopfWeiter.hidden"), true, "Ein spaeterer Abspann ersetzt ebenfalls die 90-Prozent-Schwelle");
  await js("skipSegmente.find(s => s.type === 'outro').start = 40");
  await js("bild.currentTime = 2; markeZeigen(2)");
  assert.equal(await js("knopfMarke.hidden"), true);
  await js("bild.currentTime = 3; markeZeigen(3)");
  assert.deepEqual(await js("[knopfMarke.hidden,knopfMarke.textContent]"), [false, "Intro überspringen"]);
  assert.equal(abrufe, 1, "loadedmetadata und durationchange teilen einen Abruf");
  await js("inRunde = true; binHost = true; markeNutzen()");
  await warten(() => Promise.resolve(spruenge.length > 0 && aktionen.includes("seek")));
  assert.equal(spruenge[0].nach, 9);
  assert.equal(spruenge[0].genutzt, true, "Daten-Sprung wird nicht als eigenes Intro gelernt");
  await js("inRunde = false; markeZeigen(9)");
  assert.equal(await js("knopfMarke.hidden"), true, "Segmentende ist exklusiv");
  for (const [zeit, text] of [[12, "Rückblick überspringen"], [30, "Vorschau überspringen"], [40, "Abspann überspringen"]]) {
    await js(`bild.currentTime = ${zeit}; markeZeigen(${zeit})`);
    assert.equal(await js("knopfMarke.textContent"), text);
  }
  await js("knopfMarke.focus(); markeZeigen(49)");
  assert.equal(await js("document.activeElement === knopfSpielen"), true, "Verborgener Skip-Knopf verliert Fokus an Play");
  await js("bild.currentTime = 12; markeZeigen(12)");
  fenster.webContents.send("spieler:skip-einstellung", false);
  await warten(() => js("knopfMarke.hidden && skipSegmente.length === 0"));
  assert.equal(await js("regler.style.getPropertyValue('--skip-abschnitte')"), "", "Ausschalten entfernt Farbmarkierungen");
  await js("bild.currentTime = 44.9; weiterKnopfZeigen()");
  assert.equal(await js("knopfWeiter.hidden"), true, "Ohne Daten gilt wieder 90 Prozent");
  await js("bild.currentTime = 45; weiterKnopfZeigen()");
  assert.equal(await js("knopfWeiter.hidden"), false, "Fallback beginnt genau bei 90 Prozent");
  fenster.webContents.send("spieler:auftrag", { ...basis, id: 2 });
  await warten(() => Promise.resolve(Boolean(spaet)));
  assert.equal(await js("bild.paused"), false, "Wiedergabe startet trotz ausstehender Skip-Antwort");
  fenster.webContents.send("spieler:auftrag", { ...basis, id: 3 });
  await warten(() => js("auftrag.id === 3 && bild.readyState >= 2"));
  spaet(segmente);
  await pause(100);
  assert.equal(await js("skipSegmente.length"), 0, "Antwort der alten Folge wird verworfen");
  assert.equal(await js("regler.style.getPropertyValue('--skip-abschnitte')"), "", "Neue Folge zeigt keine alten Markierungen");
  spaet = null;
  fenster.webContents.send("spieler:auftrag", { ...basis, id: 4 });
  await warten(() => Promise.resolve(Boolean(spaet)));
  fenster.webContents.send("spieler:skip-einstellung", false);
  await warten(() => js("skipAn === false"));
  spaet(segmente);
  await pause(100);
  assert.equal(await js("skipSegmente.length"), 0, "Antwort nach Ausschalten bleibt wirkungslos");
  console.log("OK Echter Player: farbige Zeitleiste, Abspann/90-Prozent-Angebot, vier Labels, Grenzen, Seek/Watchparty, Fokus, fail-open und Quellenwechsel");
}).then(() => ende(0), error => ende(1, error));
