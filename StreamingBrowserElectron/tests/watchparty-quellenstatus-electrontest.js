"use strict";

// Isolierte, versteckte Electron-Playeransicht fuer Vorbereitung, Escape-Namen,
// Recovery-Abbruch und den lokalen Quellenreset (ohne Live-Raum oder Hoster).
const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const profil = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-watchparty-status-"));
app.setPath("userData", profil);
app.disableHardwareAcceleration();
let fenster;
let anzahl = 0;
const abgesagt = [];
const neustarts = [];
const aktionen = [];
const staende = [];
const fehlerMeldungen = [];
const frist = setTimeout(() => beenden(1, Error("Watchparty-Status-Test blieb stehen")), 30000);
const pause = (ms) => new Promise((fertig) => setTimeout(fertig, ms));
const pruefe = (name, ist, soll) => { assert.deepEqual(ist, soll, name); anzahl += 1; console.log(`OK    ${name}`); };
const warten = async (test) => {
  const ende = Date.now() + 7000;
  while (Date.now() < ende) { if (await test()) return; await pause(40); }
  throw Error("Erwarteter Playerzustand blieb aus");
};

app.whenReady().then(async () => {
  const daten = Buffer.alloc(4 * 8000, 128);
  const wav = Buffer.alloc(44 + daten.length);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34);
  wav.write("data", 36); wav.writeUInt32LE(daten.length, 40); daten.copy(wav, 44);
  const datei = path.join(profil, "lokal.wav"); fs.writeFileSync(datei, wav);
  ipcMain.on("spieler:bereit", (event) => event.sender.send("spieler:auftrag", {
    id: "alt-auftrag", adresse: pathToFileURL(datei).href, typ: "datei", titel: "Testfolge", hosterliste: []
  }));
  ipcMain.on("spieler:vorbereitung-abbrechen", (_event, id) => abgesagt.push(id));
  ipcMain.on("spieler:neustart-bereit", (_event, id) => neustarts.push(id));
  ipcMain.on("spieler:aktion", (_event, ...werte) => aktionen.push(werte));
  ipcMain.on("spieler:stand", (_event, wert) => staende.push(wert));
  ipcMain.on("spieler:fehler", (_event, text, id) => fehlerMeldungen.push([text, id]));
  ipcMain.handle("spieler:folgen", async () => null);
  ipcMain.handle("spieler:chat-status", async () => ({ active: false, messages: [] }));

  fenster = new BrowserWindow({ show: false, width: 1280, height: 720, webPreferences: {
    preload: path.join(__dirname, "../src/spieler-preload.js"), contextIsolation: true,
    sandbox: true, nodeIntegration: false, backgroundThrottling: false
  } });
  fenster.webContents.setAudioMuted(true);
  await fenster.loadFile(path.join(__dirname, "../src/renderer/spieler.html"));
  const lesen = (code) => fenster.webContents.executeJavaScript(code);
  await warten(() => lesen("bild.readyState >= 1"));

  const nameGefaehrlich = "<img src=x onerror=alert(1)>";
  await fenster.webContents.send("spieler:vorbereitung", {
    syncId: "sync-1", reason: "", phase: "preparing", recovery: false,
    currentMemberId: "mitglied-1", members: [
      { id: "mitglied-1", name: nameGefaehrlich, state: "source-search", detail: "Anime lädt" },
      { id: "mitglied-2", name: "Mira", state: "confirmation-required" },
      { id: "mitglied-3", name: "Noah", state: "video-loading" },
      { id: "mitglied-4", name: "Tess", state: "ready" },
      { id: "mitglied-5", name: "Oli", state: "left" }
    ]
  });
  pruefe("Status unterscheidet Teilnehmer und escaped Namen", await lesen(`({ text: vorbereitungListe.textContent, html: vorbereitungListe.querySelector('img') !== null,
    current: vorbereitungListe.querySelector('[aria-current="true"]')?.textContent })`), {
    text: `${nameGefaehrlich} — sucht eine QuelleAnime lädtMira — benötigt eine BestätigungNoah — lädt das VideoTess — bereitOli — hat die Runde verlassen`,
    html: false, current: `${nameGefaehrlich} — sucht eine QuelleAnime lädt`
  });
  pruefe("Bei normalem Puffern ist kein Abbrechen sichtbar", await lesen("[vorbereitung.hidden, vorbereitungAbbrechen.hidden, !puffer.hidden]"), [false, true, true]);
  fenster.setSize(360, 700);
  await pause(80);
  pruefe("Schmale Viewports halten Status, Teilnehmerliste und Abbruchknopf im Fenster", await lesen(`(() => {
    const box = vorbereitung.getBoundingClientRect();
    return [box.left >= 0, box.right <= innerWidth, box.height <= innerHeight,
      vorbereitungListe.clientHeight > 0, vorbereitung.scrollHeight >= vorbereitung.clientHeight];
  })()`), [true, true, true, true, true]);
  fenster.setSize(1280, 720);
  fenster.webContents.send("spieler:vorbereitung", {
    syncId: "sync-1", phase: "preparing", recovery: false, currentMemberId: "late-member",
    members: [{ id: "late-member", name: "Später Gast", state: "video-loading" }]
  });
  pruefe("Nachgereichter Teilnehmer erscheint mit seinem aktuellen Ladezustand", await lesen("vorbereitungListe.textContent"),
    "Später Gast — lädt das Video");

  fenster.webContents.send("spieler:vorbereitung", {
    syncId: "recovery-7", phase: "rejoining", recovery: true, currentMemberId: "mitglied-2",
    members: [{ id: "mitglied-2", name: "Mira", state: "confirmation-required" },
      { id: "mitglied-5", name: "Oli", state: "left" }, { id: "mitglied-6", name: "Jona", state: "video-loading" }]
  });
  pruefe("Recovery erklärt die Wiederverbindung und bietet Abbruch", await lesen("[vorbereitungTitel.textContent, vorbereitungText.textContent, vorbereitungAbbrechen.hidden]"),
    ["Watchparty wird neu verbunden", "Teilnehmer werden nacheinander wieder verbunden.", false]);
  pruefe("Bei Recovery wartet ein abgeräumter Teilnehmer auf den erneuten Beitritt", await lesen("vorbereitungListe.textContent"),
    "Mira — benötigt eine BestätigungOli — wartet auf den erneuten BeitrittJona — lädt das Video");
  pruefe("Drei Teilnehmer bleiben über der Timeline und vollständig innerhalb der Viewportbreite", await lesen(`(() => {
    const box = vorbereitung.getBoundingClientRect(), controls = leiste.getBoundingClientRect();
    return [box.bottom <= controls.top, box.left >= 0, box.right <= innerWidth];
  })()`), [true, true, true]);
  fenster.webContents.send("spieler:vorbereitung", { syncId: "recovery-7", phase: "rejoining", recovery: true,
    members: Array.from({ length: 6 }, (_, index) => ({ id: `member-${index}`, name: `Gast ${index + 1}`, state: "video-loading" })) });
  await warten(async () => (await lesen("vorbereitungListe.children.length")) === 6);
  pruefe("Sechs Teilnehmer bleiben scrollbar oberhalb der Timeline", await lesen(`(() => {
    const box = vorbereitung.getBoundingClientRect(), controls = leiste.getBoundingClientRect();
    return [box.bottom <= controls.top, vorbereitung.scrollHeight > vorbereitung.clientHeight,
      vorbereitung.clientHeight <= innerHeight - 220];
  })()`), [true, true, true]);
  fenster.setSize(640, 360);
  await pause(80);
  pruefe("Sechs Teilnehmer bleiben auch bei 640×360 oberhalb der Timeline", await lesen(`(() => {
    const box = vorbereitung.getBoundingClientRect(), controls = leiste.getBoundingClientRect();
    return [box.bottom <= controls.top, vorbereitung.scrollHeight > vorbereitung.clientHeight,
      controls.top < innerHeight];
  })()`), [true, true, true]);
  fenster.setSize(1280, 720);
  await pause(80);
  fenster.webContents.send("spieler:vorbereitung", { syncId: "recovery-7", phase: "rejoining", recovery: true,
    members: [{ id: "mitglied-2", name: "Mira", state: "confirmation-required" },
      { id: "mitglied-5", name: "Oli", state: "left" }, { id: "mitglied-6", name: "Jona", state: "video-loading" }] });
  await warten(async () => (await lesen("[vorbereitung.hidden, vorbereitungListe.children.length]"))[0] === false
    && (await lesen("vorbereitungListe.children.length")) === 3);
  await pause(100);
  const screenshot = path.join(profil, "watchparty-vorbereitung-3-teilnehmer.png");
  const screenshotImage = await fenster.webContents.capturePage();
  fs.writeFileSync(screenshot, screenshotImage.toPNG());
  console.log(`CAPTURE ${screenshot}`);
  await lesen("vorbereitungAbbrechen.click()");
  pruefe("Recovery-Abbruch sendet die syncId", abgesagt, ["recovery-7"]);

  fenster.webContents.send("spieler:vorbereitung", {
    syncId: "failed-9", reason: "episode-change", phase: "failed", recovery: true,
    members: [{ id: "mitglied-2", name: "Mira", state: "error", detail: "Quelle nicht erreichbar" }]
  });
  pruefe("Fehler erklärt Ursache ohne Spinner, aber mit Schließen", await lesen("[vorbereitungTitel.textContent, vorbereitungText.textContent, puffer.hidden, vorbereitungAbbrechen.hidden, vorbereitungSchliessen.hidden, fehler.hidden]"),
    ["Watchparty konnte nicht vorbereitet werden", "Der gemeinsame Folgenwechsel konnte nicht vorbereitet werden. Bitte starte ihn erneut.", true, true, false, true]);
  await lesen("vorbereitungSchliessen.click()");
  fenster.webContents.send("spieler:vorbereitung", { syncId: "failed-9", reason: "episode-change", phase: "failed", recovery: true, members: [] });
  pruefe("Fehlerzustand bleibt trotz Wiederholung desselben Status geschlossen", await lesen("vorbereitung.hidden"), true);

  for (const [reason, expected] of [
    ["recovery-failed", "Die Wiederverbindung ist fehlgeschlagen. Du kannst später erneut beitreten."],
    ["episode-change", "Der gemeinsame Folgenwechsel konnte nicht vorbereitet werden. Bitte starte ihn erneut."],
    ["sync-timeout", "Die Teilnehmer wurden nicht rechtzeitig bereit. Prüfe Verbindung und Quelle und versuche es erneut."],
    ["unexpected-code", "Die Watchparty-Vorbereitung ist fehlgeschlagen. Bitte versuche es erneut."]
  ]) {
    fenster.webContents.send("spieler:vorbereitung", { syncId: "failed-why", phase: "failed", recovery: true, reason, members: [] });
    pruefe(`Relay-Fehlercode ${reason} erhält feste deutsche Erklärung`, await lesen("vorbereitungText.textContent"), expected);
  }

  fenster.webContents.send("spieler:vorbereitung", { syncId: "done-1", phase: "completed", recovery: true, myId: "self",
    members: [{ id: "self", name: "Ich", state: "ready" }] });
  pruefe("completed beendet Spinner, Wartehinweis und Abbruchmöglichkeit", await lesen("[vorbereitungText.textContent, puffer.hidden, warteAufAlle.hidden, vorbereitungAbbrechen.hidden, mitteSpielen.hidden]"),
    ["Die Vorbereitung ist abgeschlossen.", true, true, true, true]);
  fenster.webContents.send("spieler:vorbereitung", { syncId: "ready-1", phase: "ready", recovery: true, myId: "self",
    members: [{ id: "self", name: "Ich", state: "ready" }, { id: "peer", name: "Gast", state: "error", detail: "Gastquelle fehlt" }] });
  pruefe("ready blendet das zentrale Panel für einen erfolgreichen eigenen Player aus und behält den Status", await lesen("[vorbereitung.hidden, watchpartyVorbereitung.phase, vorbereitungSchliessen.hidden]"),
    [true, "ready", true]);
  fenster.webContents.send("spieler:vorbereitung", { syncId: "ready-error-1", phase: "ready", recovery: true, myId: "self",
    members: [{ id: "self", name: "Ich", state: "error", detail: "Deine Quelle ist nicht erreichbar" },
      { id: "peer", name: "Gast", state: "ready" }] });
  pruefe("ready zeigt einen eigenen Teilnehmerfehler trotz globalem Teilerfolg schließbar an", await lesen("[vorbereitung.hidden, vorbereitungTitel.textContent, vorbereitungText.textContent, vorbereitungSchliessen.hidden, vorbereitungAbbrechen.hidden, puffer.hidden]"),
    [false, "Deine Wiedergabe braucht Aufmerksamkeit", "Deine Quelle ist nicht erreichbar", false, true, true]);
  await lesen("vorbereitungSchliessen.click()");
  fenster.webContents.send("spieler:vorbereitung", { syncId: "ready-error-1", phase: "ready", recovery: true, myId: "self",
    members: [{ id: "self", name: "Ich", state: "error", detail: "Deine Quelle ist nicht erreichbar" }] });
  pruefe("Ein Fehlerpanel bleibt bei wiederholtem ready-Ereignis desselben Auftrags geschlossen", await lesen("vorbereitung.hidden"), true);
  fenster.webContents.send("spieler:vorbereitung", { syncId: "cancel-1", phase: "cancelled", recovery: true, members: [] });
  pruefe("cancelled bleibt ein schließbarer Abschluss ohne Dauerspinner", await lesen("[vorbereitungText.textContent, puffer.hidden, vorbereitungAbbrechen.hidden, vorbereitungSchliessen.hidden]"),
    ["Die Wiederverbindung wurde abgebrochen.", true, true, false]);
  await lesen("vorbereitungSchliessen.click()");
  fenster.webContents.send("spieler:vorbereitung", { syncId: "cancel-1", phase: "cancelled", recovery: true, members: [] });
  pruefe("Abgebrochener Zustand bleibt trotz Heartbeat geschlossen", await lesen("vorbereitung.hidden"), true);

  fenster.webContents.send("spieler:vorbereitung", { syncId: "overlap-1", phase: "rejoining", recovery: true, members: [] });
  fenster.setSize(640, 360);
  await lesen("aufgeben('Die Quelle brach ab.', 'test-fehler')");
  await pause(80);
  pruefe("Bei gleichzeitigem Playerfehler überlappen Status, Fehlerbox und Controls bei 640×360 nicht", await lesen(`(() => {
    const e = fehler.getBoundingClientRect(), s = vorbereitung.getBoundingClientRect();
    return [vorbereitung.hidden, fehler.hidden, mitteSpielen.hidden,
      e.left >= 0, e.right <= innerWidth, e.top >= 0, e.bottom <= innerHeight,
      !(e.left < s.right && e.right > s.left && e.top < s.bottom && e.bottom > s.top)];
  })()`), [true, false, true, true, true, true, true, true]);
  fenster.setSize(420, 600);
  await pause(80);
  pruefe("Fehlerbox bleibt bei 420×600 vollständig bedienbar und im Fenster", await lesen(`(() => {
    const e = fehler.getBoundingClientRect();
    return [e.left >= 0, e.right <= innerWidth, e.top >= 0, e.bottom <= innerHeight,
      !document.getElementById('zurueckZumHoster').disabled];
  })()`), [true, true, true, true, true]);
  pruefe("Playerfehler bleiben an ihre Auftrags-ID gebunden", fehlerMeldungen.at(-1), ["test-fehler: Die Quelle brach ab.", "alt-auftrag"]);

  fenster.webContents.send("spieler:vorbereitung", {
    syncId: "reset-12", phase: "rejoining", recovery: true,
    members: [{ id: "mitglied-2", name: "Mira", state: "video-loading" }]
  });
  await lesen("inRunde = true; rundeWarten = false; bild.paused = false");
  fenster.webContents.send("spieler:steuern", { tun: "runde-neustart", syncId: "reset-12" });
  await warten(() => neustarts.length === 1);
  await pause(150);
  const standAnzahlNachReset = staende.length;
  await lesen("bild.dispatchEvent(new Event('timeupdate'))");
  pruefe("Reset räumt Medien, Frame und alten Fehler ohne Watchparty-Aktion ab", await lesen("[auftrag, bild.getAttribute('src'), fehler.hidden, !puffer.hidden, !vorbereitung.hidden]"),
    [null, null, true, true, true]);
  pruefe("Reset bestätigt nach dem Aufräumen und sendet weder alte Stände noch Pause-/Play-Aktionen", [neustarts, aktionen, staende.length], [["reset-12"], [], standAnzahlNachReset]);
  pruefe("Reset lässt UI und Folgen-Sidebar initialisiert", await lesen("[document.getElementById('folgenPanel') !== null, !document.getElementById('zu').disabled]"), [true, true]);
  fenster.webContents.send("spieler:auftrag", {
    id: "neu-auftrag", adresse: pathToFileURL(datei).href, typ: "datei", titel: "Wiederverbundene Folge", hosterliste: []
  });
  await warten(() => lesen("auftrag?.id === 'neu-auftrag'"));
  pruefe("Nach dem Reset nimmt der offene Player einen verspätet eintreffenden neuen Auftrag an", await lesen("[auftrag.id, document.getElementById('titel').textContent, resetWartetAufAuftrag]"),
    ["neu-auftrag", "Wiederverbundene Folge", false]);
  console.log(`${anzahl}/${anzahl} bestanden`);
}).then(() => beenden(0), (fehler) => beenden(1, fehler));

function beenden(code, fehler) {
  if (fehler) console.error("FAIL  " + (fehler.stack || fehler.message));
  clearTimeout(frist);
  fenster?.destroy();
  app.exit(code);
}
