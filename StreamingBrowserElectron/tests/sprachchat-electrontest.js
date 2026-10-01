"use strict";

// Zwei echte Chromium-WebRTC-Endpunkte, Produktions-UI/Preload/Relay und
// synthetisches Mikrofon: kein Zugriff auf private Daten oder echte Aufnahme.
const { app, BrowserWindow, ipcMain, session } = require("electron");
const { spawn } = require("child_process");
const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const crypto = require("crypto");
const WS = require("../../sync-server/node_modules/ws");
const { WatchpartyRaeume } = require("../src/watchparty-raeume");
const { erstellen } = require("../src/sprachchat-fenster");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-voice-electron-"));
app.setPath("userData", path.join(profile, "app"));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
let relay;
let ui;
let second;
let outsider;
const parties = [];
let count = 0;
let duck = false;
let preferences = { inputDeviceId: "" };
const deadline = setTimeout(() => finish(1, Error("Sprachchat-Test Timeout")), 70000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); count++; console.log("OK  " + name); };
async function until(test, name, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await test()) return; await sleep(50); }
  throw Error(name || "Zustand nicht erreicht");
}
const read = (window, code) => window.webContents.executeJavaScript(code, true);
const instrumentation = `(() => {
  window.__calls = 0; window.__tracks = []; window.__pcs = [];
  const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (...args) => {
    window.__calls++; window.__lastConstraints = args[0]; const stream = await get(...args); window.__tracks.push(...stream.getTracks()); return stream;
  };
  for (const method of ['addTransceiver','setRemoteDescription']) {
    const original = RTCPeerConnection.prototype[method];
    RTCPeerConnection.prototype[method] = function(...args) {
      if (!window.__pcs.includes(this)) window.__pcs.push(this);
      return original.apply(this,args);
    };
  }
})()`;
async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
app.whenReady().then(async () => {
  const port = await unusedPort();
  relay = spawn(process.execPath, [path.resolve(__dirname, "../../sync-server/server.js")], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(port), STATE_DIRECTORY: path.join(profile, "relay"), ELFIX_VOICE_ICE_SERVERS: "[]" },
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
  });
  let ready = false;
  relay.stdout.on("data", (data) => { if (String(data).includes("auf Port")) ready = true; });
  relay.stderr.on("data", () => {});
  await until(() => ready, "Relay startet");
  function party(name, onVoice) {
    const value = new WatchpartyRaeume({ WebSocketKlasse: WS, onVoice });
    parties.push(value);
    value.konfigurieren({ enabled: true, serverUrl: `ws://127.0.0.1:${port}`, rooms: ["sprachtest", "wechseltest"], name, deviceSecret: crypto.randomBytes(32).toString("base64url") });
    return value;
  }
  const firstParty = party("Anna", (message) => ui?.nachricht(message));
  const secondParty = party("<b>Ben</b>", (message) => { if (second && !second.isDestroyed()) second.webContents.send("voice-test:message", message); });
  await until(() => parties.every((value) => value.status().rooms[0]?.connected), "Raumverbindungen");
  ui = erstellen({ BrowserWindow, session, ipcMain, watchparty: firstParty, parent: () => undefined, duck: (active) => { duck = active; }, preferences: () => preferences,
    savePreferences: (value) => { preferences = value; return true; } });
  check("Nicht konfigurierter Raum wird abgewiesen", ui.oeffnen("fremderraum").ok, false);
  check("Sprachfenster öffnet konfigurierten Raum", ui.oeffnen("sprachtest").ok, true);
  const first = ui.fenster;
  const context = () => ({ room: "sprachtest", name: "Ben", connected: true });
  ipcMain.handle("voice-test:context", context);
  ipcMain.handle("voice-test:send", (_event, message) => secondParty.voiceSenden("sprachtest", message));
  ipcMain.handle("voice-test:microphone", () => true);
  const secondSession = session.fromPartition("voice-test-second");
  secondSession.setPermissionCheckHandler((_wc, permission, _origin, details) => permission === "media" && details.mediaType === "audio");
  secondSession.setPermissionRequestHandler((_wc, permission, callback, details) => callback(permission === "media" && details.mediaTypes?.join() === "audio"));
  second = new BrowserWindow({ show: false, width: 390, height: 740, webPreferences: { session: secondSession, preload: path.join(__dirname, "sprachchat-fixture-preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  await second.loadFile(path.resolve(__dirname, "../shared/sprachchat.html"));
  await until(() => read(first, "document.querySelector('#beitreten')?.disabled === false"), "Erste UI bereit");
  await read(first, instrumentation); await read(second, instrumentation);
  check("Zugriff ohne explizite Mikrofonfreigabe abgewiesen", await read(first, "navigator.mediaDevices.getUserMedia({audio:true}).then(s=>{s.getTracks().forEach(t=>t.stop());return false},()=>true)"), true);
  await read(first, "document.querySelector('#geraeteLaden').click()");
  await until(() => read(first, "document.querySelector('#geraeteHinweis').textContent.startsWith('Mikrofone geladen') && !document.querySelector('#geraeteLaden').disabled"), "Geräteliste vor Beitritt");
  check("Mikrofonwahl in der Sprachansicht braucht keinen Beitritt", await read(first, "window.__tracks.length > 0 && window.__tracks.every(t=>t.readyState==='ended') && window.__pcs.length === 0"), true);
  check("Probe-Freigabe endet nach der Geräteliste", await read(first, "navigator.mediaDevices.getUserMedia({audio:true}).then(s=>{s.getTracks().forEach(t=>t.stop());return false},()=>true)"), true);
  await read(first, "window.__calls = 0; document.querySelector('#beitreten').click()");
  await read(second, "document.querySelector('#beitreten').click()");
  await until(() => read(first, "document.querySelectorAll('.peer').length === 1 && !document.querySelector('#mikrofon').hidden"), "Beide Voice-Teilnehmer");
  check("Zuhören fordert kein Mikrofon an", await read(first, "window.__calls"), 0);
  check("Teilnehmername bleibt Text", await read(first, "[document.querySelector('.peer-name').textContent, document.querySelector('.peer-name b') === null]"), ["<b>Ben</b>", true]);
  await read(first, "document.querySelector('#mikrofon').click()");
  await until(() => read(first, "document.querySelector('#mikrofon').getAttribute('aria-pressed') === 'true'"), "Produktions-Mikrofonfreigabe");
  await until(() => read(second, "window.__pcs.some(pc=>pc.connectionState==='connected')"), "Echte RTC Verbindung", 15000);
  await until(() => read(second, "Promise.all(window.__pcs.map(pc=>pc.getStats())).then(stats=>stats.some(report=>[...report.values()].some(s=>s.type==='inbound-rtp' && s.bytesReceived>1000)))"), "Audio-RTP empfangen", 15000);
  check("Echtes WebRTC-Audio erreicht zweiten Client", true, true);
  ui.nachricht({ room: "sprachtest", type: "voiceerror", code: "peer-missing", message: "Ein Teilnehmer hat den Raum verlassen." });
  check("Abgegangener Signalempfänger entzieht nicht der ganzen Runde das Mikrofon", await read(first, "ElfixVoiceHost.microphone()"), true);
  check("Kamerazugriff bleibt auch bei freigegebenem Mikrofon verboten", await read(first, "navigator.mediaDevices.getUserMedia({video:true}).then(s=>{s.getTracks().forEach(t=>t.stop());return false},()=>true)"), true);
  await read(first, "document.querySelector('#mikrofon').click()");
  await until(() => read(first, "window.__tracks.every(t=>t.readyState==='ended')"), "Mute stoppt Aufnahme");
  check("Stummschalten gibt Mikrofon frei", await read(first, "window.__tracks.every(t=>t.readyState==='ended')"), true);
  await read(second, "document.querySelector('#mikrofon').click()");
  await until(() => read(first, "Promise.all(window.__pcs.map(pc=>pc.getStats())).then(stats=>stats.some(report=>[...report.values()].some(s=>s.type==='inbound-rtp' && s.bytesReceived>1000)))"), "Audio-Rueckkanal");
  check("Audio wird auch in Gegenrichtung empfangen", true, true);
  await read(first, "const slider=document.querySelector('.volume input'); slider.value='35'; slider.dispatchEvent(new Event('input'))");
  check("Teilnehmerlautstärke wird unabhängig gesetzt", await read(first, "document.querySelector('.volume output').textContent"), "35%");
  first.focus();
  await until(async () => first.isFocused() && await read(first, "document.hasFocus()"), "Sprachfenster fokussiert");
  await read(first, "document.querySelector('#ptt').click(); document.querySelector('#sprechen').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}))");
  await until(() => read(first, "window.__tracks.some(t=>t.readyState==='live')"), "PTT Aufnahme");
  first.minimize();
  await until(() => read(first, "window.__tracks.every(t=>t.readyState==='ended')"), "PTT Fokusverlust");
  await until(() => read(first, "document.querySelector('#status').textContent.includes('Mikrofon ist aus')"), "PTT zeigt gemuteten Zustand");
  check("PTT endet beim Fokusverlust", true, true);
  check("Minimieren erhält Sprachchat", await read(first, "document.querySelector('#beitreten').hidden"), true);
  first.restore(); first.focus();
  await until(() => first.isFocused(), "Sprachfenster wieder fokussiert");
  const imagePath = path.join(profile, "sprachchat-desktop.png");
  fs.writeFileSync(imagePath, (await first.webContents.capturePage()).toPNG());
  console.log("SNAP  " + imagePath);
  // Gleicher Dateipfad und gleiche Partition reichen nicht: fremdes WC bleibt gesperrt.
  outsider = new BrowserWindow({ show: false, webPreferences: { partition: "persist:elfix-sprachchat", preload: path.resolve(__dirname, "../src/sprachchat-preload.js"), sandbox: true, contextIsolation: true } });
  await outsider.loadFile(path.resolve(__dirname, "../shared/sprachchat.html"));
  check("Fremdes WebContents darf keine Voice-IPC nutzen", await read(outsider, "ElfixVoiceHost.microphone().then(()=>false,()=>true)"), true);
  await read(first, "document.querySelector('#verlassen').click()");
  await until(() => read(second, "document.querySelectorAll('.peer').length === 0"), "Peer nach Verlassen entfernt");
  check("Verlassen schließt alle PeerConnections", await read(first, "window.__pcs.every(pc=>pc.connectionState==='closed')"), true);
  check("Verlassen stellt Filmton wieder her", duck, false);
  await read(first, "document.querySelector('#beitreten').click()");
  await until(() => read(first, "!document.querySelector('#verlassen').hidden"), "Neuer Beitritt");
  ui.oeffnen("wechseltest");
  await until(() => read(first, "document.querySelector('#raum').textContent.includes('wechseltest') && !document.querySelector('#beitreten').hidden"), "Raumwechsel");
  await until(() => read(second, "document.querySelectorAll('.peer').length === 0"), "Alter Raum verlassen");
  check("Raumwechsel beendet alte Stimme ohne automatischen Beitritt", await read(first, "window.__tracks.every(t=>t.readyState==='ended') && window.__pcs.every(pc=>pc.connectionState==='closed')"), true);
  check("Sprachchat ändert keine Titel-Mitgliedschaft", parties.every(p=>p.serverEintraege().length === 0), true);
  ui.schliessen();
  ui.oeffnen("", true);
  let settingsWindow = ui.fenster;
  await until(() => read(settingsWindow, "document.querySelector('#einstellungen')?.open === true && document.querySelector('#geraeteLaden')?.disabled === false"), "Raumlose Einstellungen");
  await read(settingsWindow, instrumentation);
  check("Mikrofoneinstellungen ohne Raum und ohne Aufnahme", await read(settingsWindow, "[document.querySelector('#beitreten').disabled, window.__calls]"), [true, 0]);
  await read(settingsWindow, "document.querySelector('#geraeteLaden').click()");
  await until(() => read(settingsWindow, "document.querySelector('#geraeteHinweis').textContent.startsWith('Mikrofone geladen')"), "Geraeteliste mit Freigabe");
  check("Geräteliste überträgt kein Audio und beendet Probeaufnahme", await read(settingsWindow, "window.__tracks.length > 0 && window.__tracks.every(t=>t.readyState==='ended') && window.__pcs.length === 0"), true);
  const deviceId = await read(settingsWindow, "document.querySelector('#mikrofonGeraet').options[1]?.value");
  assert.ok(deviceId, "Synthetisches Mikrofon auswählbar");
  await read(settingsWindow, "const select = document.querySelector('#mikrofonGeraet'); select.selectedIndex=1; select.dispatchEvent(new Event('change'))");
  await until(() => preferences.inputDeviceId === deviceId, "Auswahl gespeichert");
  ui.schliessen();
  ui.oeffnen("sprachtest");
  settingsWindow = ui.fenster;
  await until(() => read(settingsWindow, "document.querySelector('#beitreten')?.disabled === false"), "Neue Sprachansicht");
  check("Gespeicherte Auswahl überlebt Schließen und erneutes Öffnen", await read(settingsWindow, "document.querySelector('#mikrofonGeraet').value"), deviceId);
  await read(settingsWindow, instrumentation);
  await read(settingsWindow, "document.querySelector('#beitreten').click()");
  await until(() => read(settingsWindow, "!document.querySelector('#mikrofon').hidden"), "Join nach Mikrofonwahl");
  await read(settingsWindow, "document.querySelector('#mikrofon').click()");
  await until(() => read(settingsWindow, "document.querySelector('#mikrofon').getAttribute('aria-pressed') === 'true'"), "Gewaehlt Mikrofon startet");
  check("Sprachaufnahme verwendet exakt ausgewähltes Mikrofon", await read(settingsWindow, "window.__lastConstraints.audio.deviceId.exact"), deviceId);
  await read(settingsWindow, "const select=document.querySelector('#mikrofonGeraet'); select.value=''; select.dispatchEvent(new Event('change'))");
  await until(() => read(settingsWindow, "window.__tracks.every(t=>t.readyState==='ended')"), "Geraetewechsel stoppt Aufnahme");
  check("Auswahlwechsel schaltet zunächst stumm", await read(settingsWindow, "document.querySelector('#mikrofon').getAttribute('aria-pressed')"), "false");
  console.log(`${count}/${count} bestanden`);
}).then(() => finish(0), (error) => finish(1, error));

function finish(code, error) {
  if (error) console.error("FAIL  " + (error.stack || error.message));
  clearTimeout(deadline);
  ui?.schliessen(); second?.destroy(); outsider?.destroy();
  for (const party of parties) party.trennen();
  relay?.kill();
  app.exit(code);
}
