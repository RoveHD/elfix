"use strict";
// Default: production player with an unavailable GPU, verifying safe fallback.
// ELFIX_RTX_HARDWARE=1: requires the compiled helper and a real supported RTX GPU.
const { app, BrowserWindow, ipcMain, sharedTexture } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { pathToFileURL } = require("node:url");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-rtx-player-"));
const nativeErrors = [];
const nativeCounts = {};
app.setPath("userData", path.join(root, "profile"));
app.on("window-all-closed", () => {});
const hardware = process.env.ELFIX_RTX_HARDWARE === "1";
if (!hardware) {
  app.commandLine.appendSwitch("use-gl", "angle");
  app.commandLine.appendSwitch("use-angle", "swiftshader");
  app.commandLine.appendSwitch("enable-unsafe-swiftshader");
}
let win, recorder, engine;
const statuses = [], errors = [], requests = [];
const timeout = setTimeout(() => finish(1, Error("RTX player timeout")), 60000);
function finish(code, error) {
  clearTimeout(timeout); engine?.stop();
  if (error) console.error(error);
  win?.destroy(); recorder?.destroy(); app.exit(code);
}
function stop() { engine?.stop(); engine = null; }
async function until(check, label) {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  const picture = win ? await win.webContents.executeJavaScript("({frames:window.rtxFrames?.slice(-10), time:bild.currentTime, paused:bild.paused})").catch(() => null) : null;
  throw Error(`${label}: ${JSON.stringify(statuses.at(-1))}; errors=${JSON.stringify(errors)}; native=${nativeErrors.join(";")}; picture=${JSON.stringify(picture)}; requests=${requests.length}; nativeCounts=${JSON.stringify(nativeCounts)}`);
}
app.whenReady().then(async () => {
  recorder = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  await recorder.loadURL("about:blank");
  const file = path.join(root, "fixture.webm");
  await require("./komfort-video")(recorder, file, { width: 640, height: 360,
    ...(hardware ? { durationMs: 10000, colorDurationMs: 3000 } : {}) });
  recorder.destroy(); recorder = null;
  ipcMain.on("spieler:bereit", () => {});
  ipcMain.on("spieler:upscaling-status", (_event, id, stand) => statuses.push({ id, ...stand }));
  ipcMain.on("spieler:fehler", (_event, message) => errors.push(message));
  ipcMain.handle("spieler:chat-status", () => ({ active: false, messages: [] }));
  ipcMain.on("spieler:rtx-stop", stop);
  ipcMain.handle("spieler:rtx-bild", (_event, id, frame) => {
    assert.equal(id, 71);
    requests.push({ generation: frame.generation, frameId: frame.frameId });
    if (!hardware) return { ok: false, grund: "rtx-nicht-verfuegbar" };
    engine ||= require("../src/rtx-video").erstellen({
      verzeichnis: path.join(__dirname, "../build/rtx-video"),
      datenVerzeichnis: path.join(root, "ngx"), sharedTexture,
      spawnHelper(...args) {
        const child = require("node:child_process").spawn(...args);
        child.stdout.on("data", chunk => {
          const text = chunk.toString();
          if (text.includes('"error"')) nativeErrors.push(text.trim());
          for (const line of text.trim().split("\n")) {
            try { const key=JSON.parse(line).type; nativeCounts[key]=(nativeCounts[key]||0)+1; } catch { /* Partial diagnostic line */ }
          }
        });
        return child;
      }
    });
    return engine.bild({ ...frame, pixel: Buffer.from(frame.pixel), webContents: win.webContents });
  });
  win = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: {
    preload: path.join(__dirname, "../src/spieler-preload.js"), sandbox: true,
    nodeIntegration: false, contextIsolation: true, backgroundThrottling: false,
    autoplayPolicy: "no-user-gesture-required"
  } });
  await win.loadFile(path.join(__dirname, "../src/renderer/spieler.html"));
  if (hardware) win.showInactive();
  const js = code => win.webContents.executeJavaScript(code);
  await js(`(() => {
    bild.loop=true; window.rtxFrames=[];
    const original=CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage=function(...args) {
      const result=original.apply(this,args);
      if(this.canvas.id==='rtxBild') window.rtxFrames.push(Array.from(this.getImageData(this.canvas.width/2,this.canvas.height/2,1,1).data));
      return result;
    };
  })()`);
  win.webContents.send("spieler:auftrag", { id: 71, adresse: pathToFileURL(file).href,
    typ: "datei", titel: "RTX-Probe", videoUpscaling: true, videoUpscalingMethod: "rtx", weiterZaehler: 0 });
  await until(() => statuses.at(-1)?.zustand === (hardware ? "aktiv" : "nicht-verfuegbar"), "RTX result");
  assert.equal(statuses.at(-1).verfahren, "rtx");
  const initial = await js("({source:bild.currentSrc,paused:bild.paused,opacity:bild.style.opacity,hidden:document.querySelector('#rtxBild').hidden})");
  assert.equal(initial.paused, false);
  assert.equal(initial.hidden, !hardware);
  assert.equal(initial.opacity, hardware ? "0" : "");
  if (!hardware) {
    assert.equal(requests.length, 1, "Unsupported hardware does not cause a request loop");
    assert.match(await js("document.querySelector('#upscalingHinweis').title"), /Grafikkarte|Treiber/);
  } else {
    await until(() => js("window.rtxFrames.some(p=>p[2]>180&&p[1]<70)&&window.rtxFrames.some(p=>p[1]>180&&p[2]<70)"), "Continuous native frames change color");
    await js("bild.pause()");
    const before = await js("window.rtxFrames.length");
    win.setContentSize(1100, 700);
    await until(async () => await js("window.rtxFrames.length") > before, "Paused resize receives a fresh native frame");
    assert.equal(await js("bild.paused"), true);
    await js("bild.currentTime=0.2");
    await until(() => js("!bild.seeking && window.rtxFrames.at(-1)?.[0]>180 && window.rtxFrames.at(-1)?.[2]<70 && !document.querySelector('#rtxBild').hidden"), "Seek shows the correct red frame");
    assert.equal(await js("bild.paused"), true);
    await js("bild.play()");
  }
  await js("window.unwanted=[]; for(const name of ['pause','emptied']) bild.addEventListener(name,()=>window.unwanted.push(name));");
  win.webContents.send("spieler:upscaling", false, "rtx");
  await until(() => statuses.at(-1)?.zustand === "aus", "RTX off");
  assert.equal(await js("document.querySelector('#rtxBild').hidden"), true);
  win.webContents.send("spieler:upscaling", true, "fsr1");
  await until(() => statuses.at(-1)?.zustand === "aktiv" && statuses.at(-1)?.verfahren !== "rtx", "Switch to FSR");
  assert.deepEqual(await js("({source:bild.currentSrc,paused:bild.paused,events:window.unwanted})"),
    { source: initial.source, paused: false, events: [] });
  const old = requests[0];
  await js(`(() => { const c=document.createElement('canvas'); c.width=1280; c.height=720;
    const frame=new VideoFrame(c,{timestamp:0});
    window.postMessage({type:'elfix-rtx-frame',metadata:${JSON.stringify({ ...old, width: 1280, height: 720 })},frame},'*',[frame]);
    return new Promise(resolve=>setTimeout(resolve,50)); })()`);
  assert.equal(await js("document.querySelector('#rtxBild').hidden"), true, "A late frame cannot reappear after switching away from RTX");
  assert.deepEqual(errors, []);
  console.log(hardware ? "OK RTX hardware player: real NGX/shared textures, colors, paused resize, seek and switch to FSR without reload/pause"
    : "OK RTX player fallback: unsupported GPU, original video, no request loop and live switch to FSR");
  finish(0);
}).catch(error => finish(1, error));
