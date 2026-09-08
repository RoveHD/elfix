"use strict";

// Echter Player, echte Preload-Bruecke und lokales Medium. Keine Hosteranfragen.
// Aufruf: electron tests/spielerquellenelectrontest.js
const { app, BrowserWindow, ipcMain } = require("electron");
// Ein vom Terminal geloester Windows-GUI-Prozess darf keinen EPIPE-Dialog
// auf dem Desktop hinterlassen. Fehlende Testausgabe bedeutet einen Fehllauf.
for (const stream of [process.stdout, process.stderr]) stream.on("error", () => app.exit(1));
const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const ablage = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-player-rechte-"));
app.setPath("userData", ablage);
app.disableHardwareAcceleration();
let fenster;
let anzahl = 0;
const hosterAufrufe = [];
const folgenAufrufe = [];
const fehler = [];
const frist = setTimeout(() => beenden(1, new Error("Playerpruefung blieb stehen")), 45000);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const pruefe = (name, wert, soll) => { assert.deepEqual(wert, soll, name); anzahl++; console.log("OK    " + name); };
const warten = async test => {
  const ende = Date.now() + 7000;
  while (Date.now() < ende) { if (await test()) return; await pause(40); }
  throw new Error("Playerzustand blieb aus");
};

app.whenReady().then(async () => {
  const daten = Buffer.alloc(90 * 8000, 128);
  const wav = Buffer.alloc(44 + daten.length);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write("data", 36);
  wav.writeUInt32LE(daten.length, 40); daten.copy(wav, 44);
  const datei = path.join(ablage, "still.wav"); fs.writeFileSync(datei, wav);
  const hosterliste = [
    { adresse: "https://fixture.test/de-voe", hoster: "VOE", fassung: "Deutsch" },
    { adresse: "https://fixture.test/de-vidmoly", hoster: "Vidmoly", fassung: "Deutsch" },
    { adresse: "https://fixture.test/en-voe", hoster: "VOE", fassung: "Englisch" },
    { adresse: "https://fixture.test/ja-voe", hoster: "VOE", fassung: "Japanisch, Deutsche Untertitel" }
  ];
  const auftrag = { id: 1, adresse: pathToFileURL(datei).href, typ: "datei", titel: "Playerprüfung",
    link: hosterliste[0].adresse, hosterliste, runde: true, rundeHost: false, rundeTempo: 1,
    weiterZaehler: 0, naechste: { url: "https://fixture.test/episode-2", beschriftung: "Folge 2" } };
  ipcMain.on("spieler:bereit", event => event.sender.send("spieler:auftrag", auftrag));
  ipcMain.on("spieler:fehler", (_event, text) => fehler.push(text));
  const staffeln = [{ staffel: 0, url: "https://fixture.test/filme" }, { staffel: 1, url: "https://fixture.test/staffel-1" }];
  ipcMain.handle("spieler:folgen", async (_event, _frisch, url) => ({
    titel: "Folgen und Filme", staffeln,
    folgen: url === staffeln[0].url
      ? [{ staffel: 0, folge: 1, titel: "Der Film", url: "https://fixture.test/film-1" }]
      : [{ staffel: 1, folge: 1, titel: "Die erste Folge", url: "https://fixture.test/episode-1", laeuft: true }]
  }));
  ipcMain.handle("spieler:chat-status", async () => ({ active: false, messages: [] }));
  ipcMain.handle("spieler:hoster", async (_event, link) => { hosterAufrufe.push(link); return { ok: true }; });
  ipcMain.handle("spieler:wechseln", async (_event, link) => { folgenAufrufe.push(link); return { ok: true }; });
  fenster = new BrowserWindow({ show: false, width: 1280, height: 720, webPreferences: {
    preload: path.join(__dirname, "../src/spieler-preload.js"), contextIsolation: true,
    sandbox: true, nodeIntegration: false, backgroundThrottling: false,
    autoplayPolicy: "no-user-gesture-required"
  } });
  fenster.webContents.setAudioMuted(true);
  await fenster.loadFile(path.join(__dirname, "../src/renderer/spieler.html"));
  const lesen = code => fenster.webContents.executeJavaScript(code);
  await warten(() => lesen("bild.readyState >= 2"));
  const rechte = () => lesen("[fassungWahl.disabled, hosterWahl.disabled]");
  pruefe("Gast kann Fassung und Hoster nicht oeffnen", await rechte(), [true, true]);
  await lesen("(async()=>{fassungWechseln('Englisch');await hosterWechseln('https://fixture.test/de-vidmoly')})()");
  pruefe("Gast-Direktaufrufe erreichen die Hoster-Bruecke nicht", hosterAufrufe.length, 0);
  await lesen("folgeWechseln(naechste.url)");
  pruefe("Auch ein Gast darf die naechste Folge anfordern", folgenAufrufe, ["https://fixture.test/episode-2"]);

  fenster.webContents.send("spieler:leiste", [{ me: true, host: true, name: "Du" }]);
  await warten(async () => (await rechte()).every(wert => !wert));
  pruefe("Beforderter Host bekommt beide Auswahlen sofort", await rechte(), [false, false]);
  await lesen("fassungWechseln('Englisch')");
  await warten(() => hosterAufrufe.length === 1);
  pruefe("Host darf auch Englisch waehlen", hosterAufrufe[0], "https://fixture.test/en-voe");
  await lesen("fassungWechseln('Japanisch, Deutsche Untertitel')");
  await warten(() => hosterAufrufe.length === 2);
  pruefe("Host darf japanische Fassung waehlen", hosterAufrufe[1], "https://fixture.test/ja-voe");
  await lesen("hosterWechseln('https://fixture.test/de-vidmoly')");
  pruefe("Host darf den Hoster wechseln", hosterAufrufe[2], "https://fixture.test/de-vidmoly");
  await lesen("hosterWahl.auf()");
  fenster.webContents.send("spieler:rundentempo", 1, false);
  await warten(async () => (await rechte()).every(Boolean));
  pruefe("Rollenverlust schliesst ein offenes Hoster-Menue", await lesen("hosterWahl.offen()"), false);

  fenster.webContents.send("spieler:auftrag", { ...auftrag, id: 2, runde: false, rundeHost: false });
  await warten(() => lesen("auftrag.id === 2 && bild.readyState >= 2"));
  pruefe("Ohne Watchparty bleiben beide Auswahlen frei", await rechte(), [false, false]);
  await lesen("folgenZeigen()");
  pruefe("Filme haben einen eigenen Reiter", await lesen("[...staffelReiter.children].map(x=>x.textContent)"), ["Filme", "Staffel 1"]);
  pruefe("Episodentitel erscheinen im Player", await lesen("folgenListe.textContent.includes('Die erste Folge')"), true);
  await lesen("staffelOeffnen(0)");
  // Der Folgenknopf und nicht die ganze Zeile: daneben steht der Haken, mit
  // dem sich ein Eintrag von Hand als gesehen markieren laesst.
  pruefe("Film-Reiter laedt seine Eintraege mit Filmnummer und Titel",
    await lesen("folgenListe.querySelector('button.folge').textContent"), "Film 1Der Film");
  await lesen("folgenPanel.hidden=true");
  await lesen("bild.play().then(()=>schichtenZeigen())");
  await warten(() => lesen("leiste.classList.contains('weg')"));
  pruefe("Mauszeiger verschwindet mit den Bedienelementen", await lesen("getComputedStyle(bild).cursor"), "none");
  fenster.webContents.sendInputEvent({ type: "mouseMove", x: 640, y: 300 });
  await warten(() => lesen("!leiste.classList.contains('weg')"));
  pruefe("Mausbewegung zeigt den Zeiger wieder", await lesen("getComputedStyle(bild).cursor"), "default");
  await lesen("hosterWahl.auf()");
  await pause(3000);
  pruefe("Offenes Menue behaelt Bedienelemente und Zeiger", await lesen("[leiste.classList.contains('weg'),getComputedStyle(bild).cursor]"), [false, "default"]);
  await lesen("wahlAlleZu();bild.pause();schichtenZeigen()");
  await pause(3000);
  pruefe("Bei Pause bleiben Bedienelemente und Zeiger sichtbar", await lesen("[leiste.classList.contains('weg'),getComputedStyle(bild).cursor]"), [false, "default"]);
  pruefe("Kein Playerfehler", fehler, []);
  console.log(`${anzahl}/${anzahl} bestanden`);
}).then(() => beenden(0), error => beenden(1, error));

function beenden(code, error) {
  if (error) console.error("FAIL  " + error.stack);
  clearTimeout(frist);
  fenster?.destroy();
  app.exit(code);
}
