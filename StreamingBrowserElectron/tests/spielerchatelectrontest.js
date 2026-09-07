"use strict";

// Echte Playerseite, echte Preload-Bruecke, eigenes Testprofil. Der Chat
// bekommt nur IPC-Fakes und eine lokale WAV-Datei; keine Netzwerkverbindung.
const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const profil = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-spieler-chat-"));
app.commandLine.appendSwitch("lang", "en-US");
app.setPath("userData", profil);
app.disableHardwareAcceleration();
let fenster;
let anzahl = 0;
const gesendet = [];
let sendenAbschliessen = null;
let sendenVerzoegern = false;
const frist = setTimeout(() => beenden(1, Error("Player-Chat-Test blieb stehen")), 30000);
const pause = (ms) => new Promise((fertig) => setTimeout(fertig, ms));
const pruefe = (name, ist, soll) => { assert.deepEqual(ist, soll, name); anzahl += 1; console.log(`OK    ${name}`); };
const warten = async (test) => {
  const ende = Date.now() + 7000;
  while (Date.now() < ende) { if (await test()) return; await pause(40); }
  throw Error("Erwarteter Chat-Zustand blieb aus");
};

app.whenReady().then(async () => {
  const daten = Buffer.alloc(30 * 8000, 128);
  const wav = Buffer.alloc(44 + daten.length);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write("data", 36);
  wav.writeUInt32LE(daten.length, 40); daten.copy(wav, 44);
  const datei = path.join(profil, "still.wav");
  fs.writeFileSync(datei, wav);
  ipcMain.on("spieler:bereit", (ereignis) => ereignis.sender.send("spieler:auftrag", {
    id: 1, adresse: pathToFileURL(datei).href, typ: "datei", titel: "Chatprüfung", weiterZaehler: 0, hosterliste: []
  }));
  ipcMain.on("spieler:fehler", (_ereignis, text) => { throw Error(text); });
  ipcMain.handle("spieler:folgen", async () => null);
  ipcMain.handle("spieler:chat-status", async () => ({
    active: true, connected: true, room: "raum-a",
    messages: [{ id: "a1", name: "Anna", text: "<b>Nur Text</b>", at: 1735732800000, deviceId: "anna" }]
  }));
  ipcMain.handle("spieler:chat-senden", async (_ereignis, text) => {
    gesendet.push(text);
    if (sendenVerzoegern) return new Promise(fertig => { sendenAbschliessen = fertig; });
    return { ok: true };
  });

  fenster = new BrowserWindow({ show: false, width: 1280, height: 720, webPreferences: {
    preload: path.join(__dirname, "../src/spieler-preload.js"), contextIsolation: true,
    sandbox: true, nodeIntegration: false, backgroundThrottling: false,
    autoplayPolicy: "no-user-gesture-required"
  } });
  fenster.webContents.setAudioMuted(true);
  await fenster.loadFile(path.join(__dirname, "../src/renderer/spieler.html"));
  const lesen = (code) => fenster.webContents.executeJavaScript(code);
  await warten(() => lesen("!chatKnopf.hidden && chatListe.children.length === 1"));
  pruefe("Englische Runner-Sprache ist aktiv",
    await lesen("[navigator.language, Intl.DateTimeFormat().resolvedOptions().locale.startsWith('en')]"),
    ["en-US", true]);
  pruefe("Aktiver Livechat zeigt den Schalter", await lesen("[chatKnopf.hidden, chatKnopf.getAttribute('aria-expanded')]"), [false, "false"]);
  pruefe("Chatnachrichten werden als Text statt HTML gerendert", await lesen("[chatListe.querySelector('.chatText').textContent, chatListe.querySelectorAll('b,script').length]"), ["<b>Nur Text</b>", 0]);
  const nachrichtenZeit = new Date(1735732800000);
  const erwarteteZeit = [nachrichtenZeit.getHours(), nachrichtenZeit.getMinutes()]
    .map((wert) => String(wert).padStart(2, "0")).join(":");
  pruefe("Alte localeabhaengige Chatzeit reproduziert AM oder PM",
    await lesen("/\\b(?:AM|PM)\\b/.test(new Date(1735732800000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))"), true);
  pruefe("Chatzeit bleibt unter englischer Runner-Sprache deutsch und 24-stuendig",
    await lesen("chatListe.querySelector('.chatZeit').textContent"), erwarteteZeit);

  await lesen("chatKnopf.click()");
  await warten(() => lesen("!chatPanel.hidden && document.activeElement === chatEingabe"));
  pruefe("Der Chat klappt links auf und fokussiert die Eingabe", await lesen("chatKnopf.getAttribute('aria-expanded')"), "true");
  fenster.showInactive();
  await pause(160);
  fs.writeFileSync(path.join(profil, "chat-geoeffnet.png"), await fenster.webContents.capturePage().then((bild) => bild.toPNG()));
  fenster.hide();
  console.log("SNAP  " + path.join(profil, "chat-geoeffnet.png"));

  await lesen("chatEingabe.value = 'Hallo Runde'; chatForm.requestSubmit()");
  await warten(() => gesendet.length === 1);
  pruefe("Eine Nachricht geht über die begrenzte Chat-Brücke", gesendet, ["Hallo Runde"]);

  await lesen("bild.play(); chatEingabe.focus()");
  await warten(() => lesen("!bild.paused"));
  fenster.webContents.focus();
  fenster.webContents.sendInputEvent({ type: "keyDown", keyCode: "SPACE" });
  fenster.webContents.sendInputEvent({ type: "keyUp", keyCode: "SPACE" });
  await pause(120);
  pruefe("Leertaste beim Schreiben pausiert den Film nicht", await lesen("bild.paused"), false);

  await lesen("chatEingabe.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await warten(() => lesen("chatPanel.hidden && document.activeElement === chatKnopf"));
  pruefe("Escape schließt zuerst den Chat", await lesen("chatKnopf.getAttribute('aria-expanded')"), "false");

  fenster.webContents.send("spieler:chat", { type: "message", room: "raum-a", message: { id: "a2", name: "Ben", text: "Neu", at: 2, deviceId: "ben" } });
  await warten(() => lesen("chatKnopf.dataset.ungelesen === '1'"));
  pruefe("Eingeklappter Chat zählt ungelesene Nachrichten", await lesen("chatKnopf.dataset.ungelesen"), "1");

  sendenVerzoegern = true;
  await lesen("chatEingabe.value = 'Alter Entwurf'; chatForm.requestSubmit()");
  await warten(() => sendenAbschliessen !== null);
  fenster.webContents.send("spieler:chat", { type: "status", active: true, connected: true, room: "raum-b", messages: [{ id: "b1", name: "Clara", text: "Neuer Raum", at: 3, deviceId: "clara" }] });
  await warten(() => lesen("chatListe.querySelector('.chatText')?.textContent === 'Neuer Raum'"));
  pruefe("Ein anderer Raum setzt Chatverlauf und Zähler zurück", await lesen("[chatListe.querySelector('.chatText').textContent, chatKnopf.dataset.ungelesen || '0']"), ["Neuer Raum", "0"]);
  pruefe("Ein Entwurf wird nicht in den neuen Raum übernommen", await lesen("chatEingabe.value"), "");
  await lesen("chatEingabe.value = 'Neuer Entwurf'");
  sendenAbschliessen({ ok: true });
  await warten(() => lesen("!chatSenden.disabled"));
  pruefe("Eine alte Sendebestätigung löscht keinen neuen Entwurf", await lesen("chatEingabe.value"), "Neuer Entwurf");

  const verlauf = Array.from({ length: 60 }, (_, i) => ({ id: 'b' + (i + 2), name: 'Anna', text: 'Nachricht ' + i, at: 1735732800000 + i }));
  fenster.webContents.send("spieler:chat", { type: "status", active: true, connected: true, room: "raum-b", messages: verlauf });
  await warten(() => lesen("chatListe.children.length === 61"));
  await lesen("chatKnopf.click(); chatListe.scrollTop = 25; window.__ersteChatzeile = chatListe.firstElementChild");
  const scroll = await lesen("chatListe.scrollTop");
  fenster.webContents.send("spieler:chat", { type: "status", active: true, connected: true, room: "raum-b", messages: verlauf });
  await pause(80);
  pruefe("Statusmeldungen erhalten DOM und Leseposition", await lesen("[chatListe.firstElementChild === window.__ersteChatzeile, chatListe.scrollTop]"), [true, scroll]);

  console.log(`${anzahl}/${anzahl} bestanden`);
}).then(() => beenden(0), (fehler) => beenden(1, fehler));

function beenden(code, fehler) {
  if (fehler) console.error("FAIL  " + (fehler.stack || fehler.message));
  clearTimeout(frist);
  fenster?.destroy();
  app.exit(code);
}
