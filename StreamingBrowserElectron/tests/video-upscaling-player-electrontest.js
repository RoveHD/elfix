"use strict";
const { app, BrowserWindow, ipcMain, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const media = require("../src/spieler-netz");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-upscaling-player-"));
app.setPath("userData", profile);
app.commandLine.appendSwitch("force-device-scale-factor", "1");
// Closing the recording helper must not end the test before the real player exists.
app.on("window-all-closed", () => {});
if (process.env.ELFIX_FSR_HARDWARE !== "1") {
  app.commandLine.appendSwitch("use-gl", "angle");
  app.commandLine.appendSwitch("use-angle", "swiftshader");
  app.commandLine.appendSwitch("enable-unsafe-swiftshader");
}
let window, recorder, server;
const statuses = [], errors = [], requests = [], bridgeResponses = [];
const toggles = [];
const timeout = setTimeout(() => finish(1, new Error("Upscaling player timeout")), 40000);
function finish(code, error) {
  clearTimeout(timeout);
  if (error) console.error(error);
  window?.destroy(); recorder?.destroy(); server?.close(); app.exit(code);
}
async function until(check) {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  const mediaError = await window.webContents.executeJavaScript("bild.error?.message || ''");
  throw Error(`Player state missing: ${JSON.stringify(statuses.at(-1))}; ${errors.join(", ")}; ${mediaError}; requests=${JSON.stringify(requests)}; cors=${JSON.stringify(bridgeResponses)}`);
}
app.whenReady().then(async () => {
  recorder = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  await recorder.loadURL("about:blank");
  const bytes = await require("./komfort-video")(recorder, path.join(profile, "fixture.webm"), { durationMs: 8000 });
  recorder.destroy(); recorder = null;
  server = http.createServer((req, res) => {
    requests.push({ cookie: req.headers.cookie, range: req.headers.range, origin: req.headers.origin });
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
    const from = range ? Number(range[1]) : 0;
    const to = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    res.writeHead(range ? 206 : 200, { "Content-Type": "video/webm", "Accept-Ranges": "bytes",
      "Content-Length": to - from + 1, ...(range ? { "Content-Range": `bytes ${from}-${to}/${bytes.length}` } : {}) });
    res.end(bytes.subarray(from, to + 1));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/video.webm`;
  const provider = session.fromPartition("persist:fsr-provider");
  await provider.cookies.set({ url, name: "fsr-auth", value: "fixture", path: "/" });
  const player = session.fromPartition("fsr-player");
  const bridge = media.medienHandler(request => media.medienAbruf(request, provider));
  await player.protocol.handle("http", async request => {
    const response = await bridge(request);
    bridgeResponses.push(response.headers.get("access-control-allow-origin"));
    return response;
  });
  ipcMain.on("spieler:bereit", event => event.sender.send("spieler:auftrag", {
    id: 41, adresse: url, typ: "datei", titel: "Upscaling-Probe", videoUpscaling: false, weiterZaehler: 0
  }));
  ipcMain.on("spieler:upscaling-status", (_event, id, status) => statuses.push({ id, ...status }));
  ipcMain.on("spieler:fehler", (_event, message) => errors.push(message));
  ipcMain.handle("spieler:chat-status", () => ({ active: false, messages: [] }));
  ipcMain.handle("spieler:upscaling-setzen", (event, id, an, aufloesung) => {
    assert.equal(id, 41); assert.equal(typeof an, "boolean");
    assert.ok([1440, 2160, "auto"].includes(aufloesung)); toggles.push([an, aufloesung]);
    event.sender.send("spieler:upscaling", an, "fsr1", aufloesung);
    return { ok: true, an, verfahren: "fsr1", aufloesung };
  });
  window = new BrowserWindow({ show: false, width: 640, height: 360, useContentSize: true, webPreferences: {
    session: player, preload: path.join(__dirname, "../src/spieler-preload.js"),
    nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false,
    autoplayPolicy: "no-user-gesture-required"
  } });
  await window.loadFile(path.join(__dirname, "../src/renderer/spieler.html"));
  const js = code => window.webContents.executeJavaScript(code);
  await until(() => js("bild.videoWidth===160 && !bild.paused"));
  await js("bild.loop=true");
  assert.equal(await js("document.querySelector('#upscalingKnopf').getAttribute('aria-pressed')"), "false");
  assert.equal(await js("document.querySelector('#upscalingHinweis').textContent"), "160 × 90 · Originalbild");
  await js("document.querySelector('#upscalingKnopf').click()");
  await until(() => statuses.at(-1)?.zustand === "aktiv");
  assert.equal(await js("document.querySelector('#upscalingHinweis').textContent"), "FSR 1 · 160 × 90 → 2560 × 1440");
  assert.equal(statuses.at(-1).id, 41);
  assert.ok(requests.some(r => r.cookie?.includes("fsr-auth=fixture")), "Provider session cookies survive anonymous video CORS");
  assert.ok(bridgeResponses.includes("null"), "The media bridge permits CORS only for the local player origin");
  const before = await js(`(() => {
    bild.loop=true; window.unwanted=[];
    for (const event of ['pause','seeking','emptied']) bild.addEventListener(event,()=>window.unwanted.push(event));
    const v=bild.getBoundingClientRect(),c=document.querySelector('#fsrBild').getBoundingClientRect();
    return {source:bild.currentSrc,paused:bild.paused,cors:bild.crossOrigin,sizes:[v.width,v.height,c.width,c.height]};
  })()`);
  assert.equal(before.paused, false);
  assert.equal(before.cors, "anonymous");
  assert.equal(before.sizes[0], before.sizes[2]);
  assert.equal(before.sizes[1], before.sizes[3]);
  await js("document.querySelector('#upscalingKnopf').focus()");
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Space" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Space" });
  await until(() => statuses.at(-1)?.zustand === "aus");
  assert.equal(await js("document.querySelector('#fsrBild').hidden"), true);
  assert.doesNotMatch(await js("document.querySelector('#upscalingHinweis').textContent"), /→/);
  await until(() => js("document.querySelector('#upscalingKnopf').getAttribute('aria-disabled')==='false'"));
  assert.equal(await js("document.activeElement===document.querySelector('#upscalingKnopf')"), true,
    "Keyboard focus stays on the toggle after saving");
  await js("document.querySelector('#upscalingKnopf').click()");
  await until(() => statuses.at(-1)?.zustand === "aktiv");
  await js("document.querySelector('#upscalingZiel .wahlKnopf').click()");
  await js("document.querySelector('#upscalingZiel .wahlMenue button:last-child').click()");
  await until(() => statuses.at(-1)?.ausgang?.breite === 3840);
  assert.equal(await js("document.querySelector('#upscalingHinweis').textContent"), "FSR 1 · 160 × 90 → 3840 × 2160");
  assert.deepEqual(await js("[document.querySelector('#fsrBild').width,document.querySelector('#fsrBild').height]"), [3840, 2160]);
  assert.deepEqual(toggles, [[true,"auto"], [false,"auto"], [true,"auto"], [true,2160]]);
  assert.deepEqual(await js("({source:bild.currentSrc,paused:bild.paused,events:window.unwanted})"),
    { source: before.source, paused: false, events: [] }, "Toggling preserves decoder, source, position and playback");
  assert.deepEqual(errors, []);
  await js("bild.pause()");
  window.setContentSize(960, 600);
  await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  assert.equal(await js("document.querySelector('#upscalingHinweis').textContent"), "FSR 1 · 160 × 90 → 3840 × 2160");
  assert.equal(await js("getComputedStyle(document.querySelector('#fsrBild')).objectFit"), "contain");
  assert.equal(await js("bild.paused"), true);
  if (process.env.ELFIX_TEST_SCREENSHOT) {
    window.setOpacity(0); window.showInactive();
    await js("schichtenZeigen();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    fs.writeFileSync(process.env.ELFIX_TEST_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
  }
  for (const width of [960, 360]) {
    window.setContentSize(width, 600);
    await js("schichtenZeigen();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    assert.equal(await js(`(() => {
      const u=document.querySelector('#upscalingBedienung').getBoundingClientRect(),
        close=document.querySelector('#zu').getBoundingClientRect();
      return u.right<=close.left && close.right<=innerWidth && u.left>=0 && u.top<150;
    })()`), true, "Top-right control and resolution stay visible without overlapping Close");
    await js("document.querySelector('#upscalingZiel .wahlKnopf').click()");
    assert.equal(await js(`(() => {
      const menu=document.querySelector('#upscalingZiel .wahlMenue').getBoundingClientRect();
      return menu.left>=0 && menu.right<=innerWidth && menu.top>0 && menu.bottom<innerHeight;
    })()`), true, "The top menu opens downwards and fits narrow windows");
    await js("document.querySelector('#upscalingZiel .wahlKnopf').click()");
  }
  // Erster Eintrag: Auto nach Monitor. Der Testbildschirm ist kleiner als 4K.
  await js("document.querySelector('#upscalingZiel .wahlKnopf').click(); document.querySelector('#upscalingZiel .wahlMenue button').click()");
  await until(() => statuses.at(-1)?.ausgang?.breite === 2560);
  assert.deepEqual(toggles.at(-1), [true, "auto"]);
  assert.equal(await js("document.querySelector('#upscalingZiel .wahlText').textContent"), "Auto · Monitor (1440p)");
  assert.equal(await js("bild.paused"), true, "Changing the target preserves pause");
  // Auf einen 4K-Monitor gezogen: Auto wechselt ohne neue Einstellung auf 4K.
  const vorMonitor = toggles.length;
  window.webContents.enableDeviceEmulation({ screenPosition: "desktop", screenSize: { width: 3840, height: 2160 },
    viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 0, viewSize: { width: 0, height: 0 }, scale: 1 });
  await until(() => js("screen.height===2160"));
  await js("window.dispatchEvent(new Event('resize'))");
  await until(() => statuses.at(-1)?.ausgang?.breite === 3840);
  assert.equal(await js("document.querySelector('#upscalingZiel .wahlText').textContent"), "Auto · Monitor (4K)");
  assert.equal(toggles.length, vorMonitor, "Monitorwechsel speichert keine neue Einstellung");
  // Ultrawide 5120 x 1440 bleibt bei 1440p.
  window.webContents.enableDeviceEmulation({ screenPosition: "desktop", screenSize: { width: 5120, height: 1440 },
    viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 0, viewSize: { width: 0, height: 0 }, scale: 1 });
  await until(() => js("screen.width===5120"));
  await js("window.dispatchEvent(new Event('resize'))");
  await until(() => statuses.at(-1)?.ausgang?.breite === 2560);
  window.webContents.disableDeviceEmulation();
  assert.doesNotMatch(await js("document.querySelector('#upscalingHinweis').textContent"), /960 × 600/,
    "The resolution excludes letterbox bars");
  console.log("OK FSR player: real button/keyboard, auto/1440p/4K selection incl. monitor change, CORS/cookies, no pause/reload, fixed actual resolution, paused resize and narrow layout");
  finish(0);
}).catch(error => finish(1, error));
