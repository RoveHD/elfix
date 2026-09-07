"use strict";
// Physical Electron renderer + USB Media3 player with an isolated relay.
// Run through electron/cli.js; requires the debug APK and a >=50s local video.
const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn, execFile, execFileSync } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const http = require("node:http"), net = require("node:net"), assert = require("node:assert/strict");
const { WatchpartyRaeume } = require("../src/watchparty-raeume");
const sync = require("../src/watchparty-sync");
const WS = require("../../sync-server/node_modules/ws");
const root = path.join(__dirname, "../..");
const state = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-physical-wp-"));
const output = process.env.ELFIX_WATCHPARTY_OUTPUT || path.join(root, "build/watchparty-device");
fs.mkdirSync(output, { recursive: true });
const adb = process.env.ADB || "C:/tmp/android-sdk/platform-tools/adb.exe";
const component = "local.elflix.android.debug/local.elflix.android.WatchpartyProbeActivity";
const room = "geraeteprobe", key = "film:watchparty-geraeteprobe", url = "https://probe.invalid/watchparty";
const report = { started: new Date().toISOString(), pauses: [], starts: [], cancellations: [] };
let relay, server, win, party, lastEvent, relayPort, port, holdReady = false, heldReady;
const phone = [], controls = [];
app.setPath("userData", state);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(25); }
  throw Error("Timeout: " + label);
}
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer(); s.on("error", reject);
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
});
function adbRun(...args) { return execFileSync(adb, ["-d", ...args], { windowsHide: true, timeout: 15000 }); }
function phoneAction(command) {
  return new Promise((resolve, reject) => execFile(adb,
    ["-d", "shell", "input", "keyevent", command === "pause" ? "127" : "126"],
    { windowsHide: true, timeout: 15000 }, error => error ? reject(error) : resolve()));
}
const read = script => win.webContents.executeJavaScript(script, true);
const pcState = () => read("({position:bild.currentTime,frameTime:dargestelltesBild,paused:bild.paused,seeking:bild.seeking,at:Date.now(),duration:bild.duration})");
const lastPhone = () => phone.at(-1);

function applyControl(m) {
  controls.push(m);
  console.log("CONTROL", m.action, m.syncId || "", m.position, m.startAt || "");
  const item = party.eintraege().find(e => e.key === key);
  const verdict = sync.steuerungEntscheiden(m, { letzter: lastEvent, binHost: item?.hostId === item?.myId,
    hostId: item?.hostId, gleicheAdresse: true, offen: null });
  if (verdict.merken) lastEvent = verdict.merken;
  if (verdict.tun === "nichts" || verdict.tun === "drift") return;
  const clock = party.uhrStand(room);
  const event = sync.ereignisFuerPlayer(m, sync.laeuftDanach(m), clock?.versatz, Boolean(clock));
  const plan = sync.startPlan(event, party.serverJetzt(room), 0);
  win?.webContents.send("spieler:steuern", { stelle: plan.stelle, laufen: event.playing,
    genau: true, springen: true, wartenMs: plan.wartenMs,
    startLokal: event.playing ? Date.now() + plan.wartenMs : 0,
    bereitId: m.action === "syncprepare" ? m.syncId : undefined });
}

async function pauseCheck(who, index) {
  const since = Date.now(), count = controls.length;
  const beforePause = await pcState();
  if (who === "pc") await read("pauseAnfordern()"); else await phoneAction("pause");
  await until(() => controls.slice(count).some(m => m.action === "pause"), who + " real pause command");
  await until(async () => {
    const p = await pcState(), a = lastPhone();
    return a && a.received > since && a.paused && p.paused && !p.seeking && Math.abs(p.position - a.position) <= .002;
  }, who + " pause positions agree");
  await delay(1100); // Also exclude a temporary preparation pause before auto-start.
  const p = await pcState(), a = lastPhone();
  assert.ok(p.paused && a.paused, "pause unexpectedly restarted a device");
  assert.ok(Math.abs(p.position - a.position) <= .002, "pause positions moved apart");
  assert.ok(p.position >= beforePause.position - .08, "pause rewound to an old start position");
  assert.ok(typeof p.frameTime === "number" && typeof a.frameTime === "number", "actual frame metadata missing");
  assert.ok(Math.abs(p.frameTime - a.frameTime) < .000002,
    "different visible frames: PC=" + p.frameTime + " Android=" + a.frameTime);
  const result = { who, pc: p.position, android: a.position, differenceMs: Math.abs(p.position - a.position) * 1000,
    pcFrameTime: p.frameTime, androidFrameTime: a.frameTime };
  report.pauses.push(result); console.log("PAUSE", JSON.stringify(result));
  fs.writeFileSync(path.join(output, "pc-pause-" + index + ".png"), (await win.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(output, "android-pause-" + index + ".png"), adbRun("exec-out", "screencap", "-p"));
}

async function startCheck(who) {
  const count = controls.length, since = Date.now();
  if (who === "pc") await read("startAnfordern()"); else await phoneAction("play");
  await until(() => controls.slice(count).some(m => m.action === "syncstart"), who + " readiness barrier");
  const start = controls.slice(count).find(m => m.action === "syncstart");
  await until(async () => !(await pcState()).paused && lastPhone()?.paused === false && lastPhone().received > since,
    who + " both players run");
  await delay(700);
  const p = await pcState(), a = lastPhone();
  // Independent device wall clocks differ. The minimum USB telemetry transit
  // gives their offset (with only the minimum one-way transport uncertainty).
  const clockOffset = Math.min(...phone.map(sample => sample.received - sample.at));
  const deltaMs = (p.position - (a.position + (p.at - a.at - clockOffset) / 1000)) * 1000;
  const result = { who, startAt: start.startAt, position: start.position, pc: p.position,
    android: a.position, pcAt: p.at, androidAt: a.at, clockOffsetMs: clockOffset, timelineDifferenceMs: deltaMs };
  report.starts.push(result); console.log("START", JSON.stringify(result));
  assert.ok(Math.abs(deltaMs) < 80, "physical playback timelines differ by " + deltaMs + "ms");
}

async function main() {
  const video = process.env.ELFIX_WATCHPARTY_VIDEO || path.join(root, "build/watchparty-fixture.mp4");
  assert.ok(fs.existsSync(video), "Test video missing: " + video);
  const body = fs.readFileSync(video);
  relayPort = await freePort(); port = await freePort();
  let relayOutput = "";
  relay = spawn(process.execPath, [path.join(root, "sync-server/server.js")], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(relayPort), STATE_DIRECTORY: state },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  relay.stdout.on("data", data => { relayOutput += data; });
  relay.stderr.on("data", data => { relayOutput += data; });
  await until(() => relayOutput.includes("auf Port " + relayPort), "local relay");
  server = http.createServer((req, res) => {
    if (req.url === "/telemetry") {
      let text = ""; req.on("data", data => { text += data; });
      req.on("end", () => { try { phone.push({ ...JSON.parse(text), received: Date.now() }); } catch {} res.writeHead(204).end(); });
      return;
    }
    const range = String(req.headers.range || "").match(/bytes=(\d+)-(\d*)/);
    const from = range ? Number(range[1]) : 0, to = range?.[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
    res.writeHead(range ? 206 : 200, { "Content-Type": video.endsWith(".webm") ? "video/webm" : "video/mp4",
      "Content-Length": to - from + 1, "Accept-Ranges": "bytes",
      ...(range ? { "Content-Range": "bytes " + from + "-" + to + "/" + body.length } : {}) });
    res.end(body.subarray(from, to + 1));
  });
  await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
  party = new WatchpartyRaeume({ WebSocketKlasse: WS, onControl: applyControl });
  party.konfigurieren({ enabled: true, serverUrl: "ws://127.0.0.1:" + relayPort, rooms: [room],
    name: "PC real renderer", deviceId: "pc-real-renderer" });
  await until(() => party.verbunden, "PC relay connection");
  party.teilen({ key, url, title: "Watchparty Geraeteprobe", type: "film" }, room);
  party.beitreten(key, room);
  ipcMain.on("spieler:bereit", event => event.sender.send("spieler:auftrag", {
    id: 1, adresse: "http://127.0.0.1:" + port + "/probe", typ: "datei", titel: "ELFIX: PC + Handy Test",
    startzeit: 8, weiterZaehler: 0, hosterliste: [], runde: true, rundeHost: true, rundeTempo: 1 }));
  ipcMain.on("spieler:takt", (_, t) => party.meldeStand(key, { position: t.stelle, frameTime: t.frameTime, paused: !t.laeuft, url,
    playerSessionId: "pc-physical-player" }, room));
  ipcMain.on("spieler:aktion", (_, action, position) => party.steuernMitAdresse(key, action, position, url, room));
  ipcMain.on("spieler:sync-bereit", (_, id) => {
    if (holdReady) heldReady = id;
    else party.bereitZumStart(key, room, id);
  });
  ipcMain.handle("spieler:folgen", async () => null);
  win = new BrowserWindow({ show: true, width: 960, height: 600, webPreferences: {
    preload: path.join(__dirname, "../src/spieler-preload.js"), contextIsolation: true, sandbox: true,
    nodeIntegration: false, backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required" } });
  win.webContents.setAudioMuted(true);
  await win.loadFile(path.join(__dirname, "../src/renderer/spieler.html"));
  await until(async () => (await pcState()).duration > 50, "PC decoded video");
  await read("bild.pause(); inRunde = true;");
  await until(() => party.eintraege().find(e => e.key === key)?.hostId, "PC is host");
  adbRun("reverse", "tcp:" + relayPort, "tcp:" + relayPort);
  adbRun("reverse", "tcp:" + port, "tcp:" + port);
  adbRun("shell", "am", "force-stop", "local.elflix.android.debug");
  adbRun("shell", "am", "start", "-n", component, "--es", "serverUrl", "ws://127.0.0.1:" + relayPort,
    "--es", "room", room, "--es", "key", key, "--es", "mediaUrl", "http://127.0.0.1:" + port + "/probe",
    "--es", "telemetryUrl", "http://127.0.0.1:" + port + "/telemetry");
  console.log("Waiting for physical phone", relayPort, port);
  await until(() => lastPhone()?.duration > 50 && phone.some(p => p.kind === "join"), "phone decoded video", 45000);
  await delay(1500);
  await pauseCheck("pc", 1);
  await startCheck("pc");
  await pauseCheck("android", 2);
  await startCheck("android");
  await pauseCheck("pc", 3);
  const before = controls.length;
  await read("startAnfordern()");
  await until(() => controls.slice(before).some(m => m.action === "syncstart"), "cancellable scheduled start");
  await read("pauseAnfordern()");
  await delay(1200);
  assert.ok((await pcState()).paused && lastPhone().paused, "cancelled play restarted a device");
  report.cancellations.push("Pause cancelled pending scheduled start on PC and Android");
  for (let i = 0; i < 2; i++) {
    await startCheck(i ? "android" : "pc");
    await pauseCheck(i ? "pc" : "android", i + 4);
  }
  // Readiness delayed at one real device: nobody may start before its ACK.
  holdReady = true;
  const pendingCount = controls.length;
  await phoneAction("play");
  await until(() => heldReady, "PC prepared but acknowledgement delayed");
  await delay(1200);
  assert.ok((await pcState()).paused && lastPhone().paused, "player started before both ready");
  assert.ok(await read("[knopfSpielen,knopfMitte].every(b => b.getAttribute('aria-busy') === 'true' && b.getAttribute('data-play-state') === 'pause')"),
    "waiting play buttons disagree");
  fs.writeFileSync(path.join(output, "pc-waiting.png"), (await win.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(output, "android-waiting.png"), adbRun("exec-out", "screencap", "-p"));
  assert.ok(!controls.slice(pendingCount).some(m => m.action === "syncstart"), "readiness barrier bypassed");
  await phoneAction("pause");
  await until(() => controls.slice(pendingCount).some(m => m.action === "pause"), "Android cancels preparation");
  holdReady = false;
  party.bereitZumStart(key, room, heldReady);
  await delay(1200);
  assert.ok((await pcState()).paused && lastPhone().paused, "stale ready restarted a player");
  assert.ok(await read("[knopfSpielen,knopfMitte].every(b => b.getAttribute('aria-busy') === 'false' && b.getAttribute('data-play-state') === 'play')"),
    "cancelled play buttons remain busy");
  report.cancellations.push("Android cancelled delayed readiness; late acknowledgement stayed cancelled");
  report.ok = true;
}
function finish(code) {
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(output, "android-samples.json"), JSON.stringify(phone, null, 2));
  try { if (relayPort) adbRun("reverse", "--remove", "tcp:" + relayPort); if (port) adbRun("reverse", "--remove", "tcp:" + port); } catch {}
  win?.destroy(); server?.close(); relay?.kill(); app.exit(code);
}
app.whenReady().then(main).then(() => { console.log("OK physical PC + Android watchparty"); finish(0); }, error => {
  report.error = error.stack || String(error); console.error("FAIL", report.error); finish(1);
});
