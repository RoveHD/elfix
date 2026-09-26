"use strict";

// Standalone GPU test: electron tests/fsr-electrontest.js
// SwiftShader is enabled only for this isolated test process.
const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const profil = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-fsr-test-"));
app.setPath("userData", profil);
const hardware = process.env.ELFIX_FSR_HARDWARE === "1";
if (!hardware) {
  app.commandLine.appendSwitch("use-gl", "angle");
  app.commandLine.appendSwitch("use-angle", "swiftshader");
  app.commandLine.appendSwitch("enable-unsafe-swiftshader");
}
let fenster;
const frist = setTimeout(() => beenden(1, new Error("FSR Electron-Test: Zeitlimit")), 30000);

function beenden(code, fehler) {
  clearTimeout(frist);
  if (fehler) console.error(fehler);
  try { fenster?.destroy(); } catch { /* Testabschluss */ }
  try { fs.rmSync(profil, { recursive: true, force: true }); } catch { /* Profil vom Betriebssystem gesperrt */ }
  app.exit(code);
}

app.whenReady().then(async () => {
  const skript = pathToFileURL(path.join(__dirname, "../src/renderer/spieler-fsr.js")).href;
  const html = path.join(profil, "fsr.html");
  fs.writeFileSync(html, `<!doctype html><meta charset="utf-8">
    <style>html,body{margin:0;background:#000}#stage{position:relative;width:320px;height:180px}
    #out,#video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
    #video{z-index:1}#out{pointer-events:none}</style>
    <div id="stage"><canvas id="out" hidden></canvas><video id="video" muted playsinline></video></div>
    <script src="${skript}"></script>`);
  fenster = new BrowserWindow({ show: true, width: 400, height: 300, webPreferences: {
    sandbox: true, nodeIntegration: false, contextIsolation: true,
    backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required"
  } });
  await fenster.loadFile(html);
  const ergebnis = await fenster.webContents.executeJavaScript(`(async () => {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const wait = async predicate => {
      for (let i=0; i<100; i++) { if (predicate()) return; await pause(50); }
      throw Error('Wartebedingung blieb aus: ' + window.last?.zustand + '/' + window.last?.grund);
    };
    const video = document.getElementById('video');
    const canvas = document.getElementById('out');
    let source;
    let stream;
    const makeSource = color => {
      const c = document.createElement('canvas'); c.width=32; c.height=18;
      const ctx=c.getContext('2d');
      ctx.fillStyle=color; ctx.fillRect(0,0,32,18);
      ctx.fillStyle='#fff'; ctx.fillRect(12,0,9,18);
      ctx.fillStyle='#000'; ctx.fillRect(24,0,8,18);
      ctx.beginPath(); ctx.moveTo(12,0); ctx.lineTo(20,18); ctx.lineWidth=1;
      ctx.strokeStyle='#000'; ctx.stroke();
      return c;
    };
    const attach = async color => {
      stream?.getTracks().forEach(track => track.stop());
      source=makeSource(color);
      stream=source.captureStream(30);
      const geladen=new Promise(resolve => video.addEventListener('loadeddata',resolve,{once:true}));
      video.srcObject=stream;
      await video.play();
      await geladen;
      await wait(() => video.readyState>=2 && video.videoWidth===32);
    };
    const draws=[];
    const pixels=[];
    const originalDraw=WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays=function(...args) {
      const result=originalDraw.apply(this,args);
      const pass=this.getParameter(this.FRAMEBUFFER_BINDING) ? 'easu' : 'rcas';
      draws.push(pass);
      if (pass==='rcas') {
        const near=new Uint8Array(4), top=new Uint8Array(4);
        const white=new Uint8Array(4), black=new Uint8Array(4);
        this.readPixels(10,90,1,1,this.RGBA,this.UNSIGNED_BYTE,near);
        this.readPixels(10,170,1,1,this.RGBA,this.UNSIGNED_BYTE,top);
        this.readPixels(130,90,1,1,this.RGBA,this.UNSIGNED_BYTE,white);
        this.readPixels(290,90,1,1,this.RGBA,this.UNSIGNED_BYTE,black);
        pixels.push({near:Array.from(near),top:Array.from(top),white:Array.from(white),black:Array.from(black)});
      }
      return result;
    };
    await attach('#f00');
    const states=[];
    const fsr=window.ElfixSpielerFsr.erstellen({video,canvas,beiStatus:s=>{window.last=s;states.push(s)}});
    fsr.setzeAktiv(true);
    await wait(() => window.last?.zustand==='aktiv');
    const initial={status:window.last,draws:draws.slice(-2),pixel:pixels.at(-1),visible:!canvas.hidden,opacity:video.style.opacity};
    const laufendeFrames=[];
    for (const farbe of ['#00f','#ff0']) {
      const drawCount=draws.length;
      const ctx=source.getContext('2d');
      ctx.fillStyle=farbe;
      ctx.fillRect(0,0,10,18);
      stream.getVideoTracks()[0].requestFrame?.();
      await wait(() => {
        const rgb=pixels.at(-1)?.near;
        return draws.length>=drawCount+2 && rgb && (farbe==='#00f'
          ? rgb[2]>rgb[0]+100 && rgb[2]>rgb[1]+100
          : rgb[0]>150 && rgb[1]>150 && rgb[2]<100);
      });
      laufendeFrames.push({draws:draws.length-drawCount,pixel:pixels.at(-1).near});
    }
    fsr.setzeAktiv(false);
    const drawCountOff=draws.length;
    await pause(120);
    const off={status:window.last,hidden:canvas.hidden,opacity:video.style.opacity,noDraw:draws.length===drawCountOff};
    fsr.setzeAktiv(true);
    await wait(() => window.last?.zustand==='aktiv');
    const track=video.addTextTrack('subtitles','Probe','de'); track.mode='showing';
    await wait(() => window.last?.grund==='native-untertitel');
    const subtitles={status:window.last,hidden:canvas.hidden,opacity:video.style.opacity};
    track.mode='disabled';
    await wait(() => window.last?.zustand==='aktiv');
    video.pause();
    await wait(() => video.paused);
    const beforePausedResize=draws.length;
    document.getElementById('stage').style.width='160px';
    document.getElementById('stage').style.height='180px';
    await wait(() => window.last?.ausgang?.breite===160 && window.last?.ausgang?.hoehe===90);
    const aspect={status:window.last,canvas:[canvas.width,canvas.height],pixel:pixels.at(-1),draws:draws.length-beforePausedResize,paused:video.paused};
    const pausedDrawCount=draws.length;
    await pause(150);
    aspect.noLoop=draws.length===pausedDrawCount;
    document.getElementById('stage').style.width='16px';
    document.getElementById('stage').style.height='9px';
    await wait(() => window.last?.zustand==='nicht-noetig');
    const unneeded={status:window.last,hidden:canvas.hidden,opacity:video.style.opacity};
    document.getElementById('stage').style.width='160px';
    document.getElementById('stage').style.height='180px';
    await wait(() => window.last?.zustand==='aktiv');
    fsr.setzeAktiv(false);
    await attach('#0f0');
    fsr.setzeAktiv(true);
    await wait(() => window.last?.zustand==='aktiv' && pixels.at(-1)?.near[1]>pixels.at(-1)?.near[0]+100);
    const switched={status:window.last,draws:draws.slice(-2),pixel:pixels.at(-1)};
    const gl=canvas.getContext('webgl2');
    const debug=gl.getExtension('WEBGL_debug_renderer_info');
    const gpuName=debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const extension=gl.getExtension('WEBGL_lose_context');
    extension?.loseContext();
    if (extension) await wait(() => window.last?.grund==='gpu-kontext-verloren');
    const lost={status:window.last,hidden:canvas.hidden,opacity:video.style.opacity};
    fsr.zerstoeren();
    stream.getTracks().forEach(track=>track.stop());
    return { initial,laufendeFrames,off,subtitles,aspect,unneeded,switched,lost,hasLoseContext:!!extension,gpuName };
  })()`);
  assert.equal(ergebnis.initial.status.zustand, "aktiv");
  assert.deepEqual(ergebnis.initial.draws, ["easu", "rcas"]);
  assert.deepEqual(ergebnis.initial.status.eingang, { breite: 32, hoehe: 18 });
  assert.deepEqual(ergebnis.initial.status.ausgang, { breite: 320, hoehe: 180 });
  assert.equal(ergebnis.initial.visible, true);
  assert.equal(ergebnis.initial.opacity, "0");
  assert.ok(ergebnis.initial.pixel.near[0] > ergebnis.initial.pixel.near[1] + 100, "rotes Videobild wurde gerendert");
  assert.ok(ergebnis.initial.pixel.white.slice(0,3).every(channel => channel > 235), "weisse Flaeche bleibt weiss");
  assert.ok(ergebnis.initial.pixel.black.slice(0,3).every(channel => channel < 20), "schwarze Flaeche bleibt schwarz");
  assert.equal(ergebnis.laufendeFrames.length, 2);
  assert.ok(ergebnis.laufendeFrames.every(frame => frame.draws >= 2), "jedes neue Videobild durchlaeuft beide Shader");
  assert.equal(ergebnis.off.status.zustand, "aus");
  assert.equal(ergebnis.off.hidden, true);
  assert.equal(ergebnis.off.opacity, "");
  assert.equal(ergebnis.off.noDraw, true);
  assert.equal(ergebnis.subtitles.status.grund, "native-untertitel");
  assert.equal(ergebnis.subtitles.hidden, true);
  assert.equal(ergebnis.subtitles.opacity, "");
  assert.deepEqual(ergebnis.aspect.status.ausgang, { breite: 160, hoehe: 90 });
  assert.deepEqual(ergebnis.aspect.canvas, [160, 180]);
  assert.deepEqual(ergebnis.aspect.pixel.top.slice(0,3), [0,0,0]);
  assert.equal(ergebnis.aspect.paused, true);
  assert.ok(ergebnis.aspect.draws >= 2, "pausiertes Bild wird nach Resize einmal neu gefiltert");
  assert.equal(ergebnis.aspect.noLoop, true, "pausiertes Bild startet keinen Renderloop");
  assert.ok(ergebnis.aspect.pixel.near[0]>150 && ergebnis.aspect.pixel.near[1]>150, "pausiertes Farbbild bleibt bei Resize korrekt");
  assert.equal(ergebnis.unneeded.status.zustand, "nicht-noetig");
  assert.equal(ergebnis.unneeded.hidden, true);
  assert.deepEqual(ergebnis.switched.draws, ["easu", "rcas"]);
  assert.ok(ergebnis.switched.pixel.near[1] > ergebnis.switched.pixel.near[0] + 100, "neues gruenses Videobild wurde gerendert");
  if (ergebnis.hasLoseContext) {
    assert.equal(ergebnis.lost.status.zustand, "nicht-verfuegbar");
    assert.equal(ergebnis.lost.hidden, true);
    assert.equal(ergebnis.lost.opacity, "");
  }
  console.log(`OK FSR1 (${hardware ? "Hardware" : "SwiftShader"}, ${ergebnis.gpuName}): WebGL2 EASU+RCAS, laufende Frames, pausierter Resize, Umschalten, Untertitel, Seitenverhaeltnis, Quellenwechsel, Kontextverlust`);
  beenden(0);
}).catch(fehler => beenden(1, fehler));
