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
const { protectEpisode } = require("../src/spoilerschutz");
let schutz = false;
let queueAufrufe = 0;
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
  // Wie im Hauptprozess: der Gesehen-Stand ist veraenderlich, und die Regel
  // reist mit, damit die Schalter unter der Liste beim Aufklappen stimmen.
  let gesehen = [{ season: 1, episode: 1 }];
  const regel = { enabled: false, roomMinimum: true, shareWatchedWithRoom: true };
  const gesehenAufrufe = [];
  const schalterAufrufe = [];
  ipcMain.handle("spieler:folgen", async (_event, _frisch, url) => ({
    titel: "Folgen und Filme", staffeln, spoilerRegel: { ...regel, enabled: schutz },
    folgen: [
      { staffel: 1, folge: 1, titel: "Bekannte Folge", url: "https://fixture.test/episode-1", laeuft: true },
      { staffel: 1, folge: 2, titel: "Die geheime Wendung", url: "https://fixture.test/episode-2" }
    ].map(e => protectEpisode(e, { enabled: schutz, completedEpisodes: gesehen }))
  }));
  ipcMain.handle("spieler:gesehen", (_event, folgen, an) => {
    gesehenAufrufe.push({ folgen, an });
    for (const folge of folgen) {
      gesehen = gesehen.filter(w => !(w.season === folge.season && w.episode === folge.episode));
      if (an) gesehen.push({ season: folge.season, episode: folge.episode });
    }
    // Derselbe Weg wie echt: der Hauptprozess meldet den neuen Stand, und der
    // Player baut die Liste daraufhin neu auf.
    fenster.webContents.send("spieler:spoiler", { folgentitel: "", naechste: auftrag.naechste });
    return true;
  });
  ipcMain.handle("spieler:spoiler-einstellung", (_event, feld, an) => {
    schalterAufrufe.push({ feld, an });
    regel[feld] = an;
    return { ...regel, enabled: schutz };
  });
  ipcMain.handle("spieler:queue-weiter", () => { queueAufrufe++; return { ok: true }; });
  ipcMain.handle("spieler:chat-status", async () => ({ active: false, messages: [] }));
  ipcMain.handle("spieler:hoster", async (_event, link) => { hosterAufrufe.push(link); return { ok: true }; });
  ipcMain.handle("spieler:wechseln", async (_event, link) => { folgenAufrufe.push(link); return { ok: true }; });
  fenster = new BrowserWindow({ show: false, width: 960, height: 540, webPreferences: {
    preload: path.join(__dirname, "../src/spieler-preload.js"), contextIsolation: true,
    sandbox: true, nodeIntegration: false, backgroundThrottling: false,
    autoplayPolicy: "no-user-gesture-required"
  } });
  fenster.webContents.setAudioMuted(true);
  await fenster.loadFile(path.join(__dirname, "../src/renderer/spieler.html"));
  const lesen = code => fenster.webContents.executeJavaScript(code);
  await warten(() => lesen("bild.readyState >= 2"));

  await lesen("ausRundeBis=Date.now()+60000;bild.pause();folgenZeigen()");
  pruefe("Gesehen-Markierung ohne eingeschalteten Schutz", await lesen("folgenListe.querySelectorAll('.hakenKnopf.an').length"), 1);
  pruefe("Ungesehener Name bei ausgeschaltetem Schutz sichtbar", await lesen("folgenListe.textContent.includes('Die geheime Wendung')"), true);
  schutz = true;
  fenster.webContents.send("spieler:spoiler", { folgentitel: "", naechste: auftrag.naechste });
  await warten(() => lesen("folgenListe.textContent.includes('Noch nicht gesehen')"));
  pruefe("Aktive Liste entfernt ungesehenen Titel sofort", await lesen("folgenListe.textContent.includes('Die geheime Wendung')"), false);
  pruefe("Schutz entfernt weder Folgen noch Navigation", await lesen("[folgenListe.children.length, [...folgenListe.children].every(e=>!e.disabled)]"), [2, true]);
  pruefe("Bereits gesehen bleibt lesbar", await lesen("folgenListe.textContent.includes('Bekannte Folge')"), true);
  await lesen("kopfTitelSetzen('Testserie', 'Geheimer Folgentitel')");
  fenster.webContents.send("spieler:spoiler", { folgentitel: "", naechste: auftrag.naechste });
  await warten(() => lesen("document.getElementById('titel').textContent === 'Testserie'"));
  pruefe("Leerer geschuetzter Name entfernt bestehenden Playernamen", await lesen("document.getElementById('titel').textContent"), "Testserie");
  schutz = false;
  fenster.webContents.send("spieler:spoiler", { folgentitel: "", naechste: auftrag.naechste });
  await warten(() => lesen("folgenListe.textContent.includes('Die geheime Wendung')"));
  pruefe("Ausschalten stellt die Angaben wieder her", await lesen("folgenListe.textContent.includes('Die geheime Wendung')"), true);
  fenster.webContents.send("spieler:queue", true);
  await warten(() => lesen("queueAktiv && bild.seekable.length > 0 && bild.seekable.end(bild.seekable.length-1) >= 89.8"));
  await lesen("ausRundeBis=Date.now()+60000; folgenPanel.hidden=true; weiterZaehler=0; weiterVerworfen=false; bild.pause(); bild.currentTime=89.5");
  await warten(() => lesen("!bild.seeking && bild.currentTime >= 89.4")).catch(async error => { console.error(await lesen("({time:bild.currentTime,seeking:bild.seeking,ready:bild.readyState,duration:bild.duration,seekable:[...Array(bild.seekable.length)].map((_,i)=>[bild.seekable.start(i),bild.seekable.end(i)])})")); throw error; });
  await lesen("bild.play()");
  await warten(() => queueAufrufe === 1).catch(async error => { console.error(await lesen("({time:bild.currentTime,duration:bild.duration,paused:bild.paused,ended:bild.ended,queueAktiv,weiterVerworfen,weiterZaehler})")); throw error; });
  await pause(1200);
  pruefe("Medienende startet Queue trotz ausgeschaltetem Folgen-Autoplay genau einmal", queueAufrufe, 1);
  pruefe("Queue-Ende loest keinen zusaetzlichen Folgenwechsel aus", folgenAufrufe.length, 0);
  // --- Der Haken von Hand ----------------------------------------------------
  //
  // Der Anlass: eine Staffel, die man laengst gesehen hat, stand vollstaendig
  // als "Noch nicht gesehen" da, weil ELFIX von damals keine Zeile hat.
  schutz = true;
  await lesen("folgenStand=null; folgenPanel.hidden=false; folgenZeigen()");
  await warten(() => lesen("folgenListe.querySelectorAll('.hakenKnopf').length === 2"));
  pruefe("Jede Folge hat ihren eigenen Haken", await lesen(
    "[...folgenListe.querySelectorAll('.hakenKnopf')].map(k=>k.textContent)"), ["✓ Gesehen", "○"]);
  pruefe("Der Folgenknopf bleibt ein eigener Knopf", await lesen(
    "[...folgenListe.children].every(z=>z.classList.contains('zeile') && z.querySelector('button.folge'))"), true);

  await lesen("folgenListe.querySelectorAll('.hakenKnopf')[1].click()");
  await warten(() => lesen("folgenListe.textContent.includes('Die geheime Wendung')"));
  pruefe("Ein Haken meldet genau seine Folge", gesehenAufrufe.at(-1),
    { folgen: [{ season: 1, episode: 2 }], an: true });
  pruefe("Und die Folge gibt danach ihren Namen frei", await lesen(
    "folgenListe.textContent.includes('Die geheime Wendung')"), true);

  await lesen("folgenListe.querySelectorAll('.hakenKnopf')[1].click()");
  await warten(() => lesen("!folgenListe.textContent.includes('Die geheime Wendung')"));
  pruefe("Derselbe Haken nimmt die Markierung wieder zurueck", gesehenAufrufe.at(-1),
    { folgen: [{ season: 1, episode: 2 }], an: false });

  await lesen("staffelGesehen.click()");
  await warten(() => lesen("folgenListe.textContent.includes('Die geheime Wendung')"));
  pruefe("Die ganze Staffel geht in einem Zug", gesehenAufrufe.at(-1),
    { folgen: [{ season: 1, episode: 1 }, { season: 1, episode: 2 }], an: true });
  await lesen("staffelUngesehen.click()");
  await warten(() => lesen("!folgenListe.textContent.includes('Die geheime Wendung')"));
  pruefe("Und laesst sich genauso zuruecknehmen", gesehenAufrufe.at(-1).an, false);

  // --- Die drei Schalter -----------------------------------------------------
  pruefe("Die Schalter stehen beim Aufklappen schon richtig", await lesen(
    "[spoilerEnabled.checked, spoilerRoomMinimum.checked, spoilerShare.checked]"), [true, true, true]);
  await lesen("spoilerShare.checked=false; spoilerShare.dispatchEvent(new Event('change'))");
  await warten(() => schalterAufrufe.length === 1);
  pruefe("Ein Schalter meldet Feld und Zustand", schalterAufrufe.at(-1),
    { feld: "shareWatchedWithRoom", an: false });
  pruefe("Und die Antwort setzt die Anzeige", await lesen("spoilerShare.checked"), false);

  await lesen("staffelGesehen.click()");
  await warten(() => lesen("folgenListe.textContent.includes('Die geheime Wendung')"));
  const screenshot = path.resolve(__dirname, "../../build/history-perf/player-spoilerschutz.png");
  // build/history-perf ist nicht versioniert. Auf einem frischen Checkout gibt
  // es das Verzeichnis also nicht, und diese Pruefung laeuft vor der, die es
  // bisher nebenbei angelegt hat.
  fs.mkdirSync(path.dirname(screenshot), { recursive: true });
  await lesen("folgenZeigen()");
  // Das Bild soll die Liste zeigen und nicht den Moment davor: erst auf das
  // offene Panel warten, dann auf ein gezeichnetes Bild.
  await warten(() => lesen("!folgenPanel.hidden && folgenListe.children.length > 0"));
  await lesen("spoilerSchutzBox.open = true");
  await lesen("new Promise(f => requestAnimationFrame(() => requestAnimationFrame(f)))");
  fs.writeFileSync(screenshot, (await fenster.webContents.capturePage()).toPNG());
  pruefe("Kein Playerfehler", fehler, []);
  console.log(anzahl + "/" + anzahl + " bestanden");
}).then(() => beenden(0), error => beenden(1, error));

function beenden(code, error) {
  if (error) console.error("FAIL  " + error.stack);
  clearTimeout(frist);
  fenster?.destroy();
  app.exit(code);
}
