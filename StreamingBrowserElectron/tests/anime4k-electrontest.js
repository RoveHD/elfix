"use strict";

// Standalone GPU test: electron tests/anime4k-electrontest.js
// SwiftShader is enabled only for this isolated test process.
const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { rechnen } = require("./anime4k-referenz");

const profil = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-anime4k-test-"));
app.setPath("userData", profil);
if (process.env.ELFIX_FSR_HARDWARE !== "1") {
  app.commandLine.appendSwitch("use-gl", "angle");
  app.commandLine.appendSwitch("use-angle", "swiftshader");
  app.commandLine.appendSwitch("enable-unsafe-swiftshader");
}
let fenster;
const frist = setTimeout(() => beenden(1, new Error("Anime4K Electron-Test: Zeitlimit")), 90000);

function beenden(code, fehler) {
  clearTimeout(frist);
  if (fehler) console.error(fehler);
  try { fenster?.destroy(); } catch { /* Testabschluss */ }
  try { fs.rmSync(profil, { recursive: true, force: true }); } catch { /* Profil vom Betriebssystem gesperrt */ }
  app.exit(code);
}

app.whenReady().then(async () => {
  const skripte = ["spieler-fsr.js", "spieler-anime4k-shaders.js", "spieler-anime4k.js"]
    .map(name => `<script src="${pathToFileURL(path.join(__dirname, "../src/renderer", name)).href}"></script>`).join("");
  const html = path.join(profil, "anime4k.html");
  fs.writeFileSync(html, `<!doctype html><meta charset="utf-8">
    <style>html,body{margin:0;background:#000}#stage{position:relative;width:320px;height:180px}
    #out,#video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
    #video{z-index:1}#out{pointer-events:none}</style>
    <div id="stage"><canvas id="out" hidden></canvas><video id="video" muted playsinline></video></div>
    ${skripte}`);
  fenster = new BrowserWindow({ show: true, width: 400, height: 300, webPreferences: {
    sandbox: true, nodeIntegration: false, contextIsolation: true,
    backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required"
  } });
  await fenster.loadFile(html);
  const ergebnis = await fenster.webContents.executeJavaScript(`(async () => {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const wait = async (predicate, runden=400) => {
      for (let i=0; i<runden; i++) { if (predicate()) return; await pause(50); }
      throw Error('Wartebedingung blieb aus: ' + JSON.stringify(window.last));
    };
    const video = document.getElementById('video');
    const canvas = document.getElementById('out');
    // Obere Haelfte rot, untere blau (prueft die Ausrichtung), dazu eine
    // senkrechte harte Kante weiss/schwarz in der rechten Bildhaelfte.
    const source=document.createElement('canvas'); source.width=320; source.height=180;
    const ctx=source.getContext('2d');
    ctx.fillStyle='#f00'; ctx.fillRect(0,0,160,90);
    ctx.fillStyle='#00f'; ctx.fillRect(0,90,160,90);
    ctx.fillStyle='#fff'; ctx.fillRect(160,0,80,180);
    ctx.fillStyle='#000'; ctx.fillRect(240,0,80,180);
    const stream=source.captureStream(10);
    video.srcObject=stream;
    await video.play();
    await wait(() => video.readyState>=2 && video.videoWidth===320);
    const zeilen=[];
    const passes=[];
    const originalDraw=WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays=function(...args) {
      const result=originalDraw.apply(this,args);
      if (this.getParameter(this.FRAMEBUFFER_BINDING)) { passes.push('netz'); return result; }
      passes.push('ausgabe');
      const w=this.drawingBufferWidth, h=this.drawingBufferHeight;
      const zeile=new Uint8Array(w*4);
      this.readPixels(0,Math.floor(h*.5),w,1,this.RGBA,this.UNSIGNED_BYTE,zeile);
      const oben=new Uint8Array(4), unten=new Uint8Array(4);
      // readPixels zaehlt von unten: h-10 ist oben im Bild.
      this.readPixels(Math.floor(w*.2),h-10,1,1,this.RGBA,this.UNSIGNED_BYTE,oben);
      this.readPixels(Math.floor(w*.2),10,1,1,this.RGBA,this.UNSIGNED_BYTE,unten);
      zeilen.push({w,h,zeile:Array.from(zeile),oben:Array.from(oben),unten:Array.from(unten)});
      return result;
    };
    const states=[];
    const upscaler=window.ElfixSpielerFsr.erstellen({video,canvas,verfahren:'anime4k',beiStatus:s=>{window.last=s;states.push(s)}});
    upscaler.setzeAktiv(true);
    await wait(() => window.last?.zustand==='aktiv' && zeilen.length>0);
    const letzte=zeilen.at(-1);
    // Breite des Uebergangs weiss->schwarz auf der mittleren Zeile.
    let uebergang=0;
    for (let x=Math.floor(letzte.w*.6); x<Math.floor(letzte.w*.9); x++) {
      const v=letzte.zeile[x*4];
      if (v>25 && v<230) uebergang++;
    }
    const pro=passes.length;
    const stufen=window.ElfixSpielerAnime4k.stufen(2560,1440,320,180);
    const stufen1080=window.ElfixSpielerAnime4k.stufen(2560,1440,1920,1080);
    const stufen4k=window.ElfixSpielerAnime4k.stufen(3840,2160,1280,720);
    const stufenKnapp=window.ElfixSpielerAnime4k.stufen(2560,1440,2160,1215);
    upscaler.setzeAktiv(true,2160);
    await wait(() => window.last?.ausgang?.breite===3840 && canvas.width===3840);
    const vierK={status:window.last,backing:[canvas.width,canvas.height]};
    upscaler.setzeAktiv(false);
    const aus={status:window.last,hidden:canvas.hidden,opacity:video.style.opacity};
    upscaler.zerstoeren();
    stream.getTracks().forEach(track=>track.stop());
    WebGL2RenderingContext.prototype.drawArrays=originalDraw;
    // Exakter Vergleich mit der CPU-Referenz: 40x24 -> 160x96 (Restore, M, S).
    const klein=document.createElement('canvas'); klein.width=40; klein.height=24;
    const kctx=klein.getContext('2d');
    kctx.fillStyle='#202830'; kctx.fillRect(0,0,40,24);
    kctx.fillStyle='#f4e0c0'; kctx.beginPath(); kctx.arc(14,11,8,0,Math.PI*2); kctx.fill();
    kctx.strokeStyle='#101010'; kctx.lineWidth=1.5; kctx.beginPath(); kctx.moveTo(22,2); kctx.lineTo(38,20); kctx.stroke();
    kctx.fillStyle='#3080ff'; kctx.fillRect(26,3,6,5);
    const quelle=Array.from(kctx.getImageData(0,0,40,24).data);
    const ref=document.createElement('canvas'); ref.width=160; ref.height=96;
    const rgl=ref.getContext('webgl2',{alpha:false,antialias:false,preserveDrawingBuffer:true});
    const netz=window.ElfixSpielerAnime4k.gpu(rgl);
    netz.zeichnen({w:160,h:96,inW:40,inH:24,outW:160,outH:96,x:0,y:0},klein);
    const roh=new Uint8Array(160*96*4);
    rgl.readPixels(0,0,160,96,rgl.RGBA,rgl.UNSIGNED_BYTE,roh);
    const gpuBild=[];
    for (let y=95; y>=0; y--) gpuBild.push(...roh.subarray(y*160*4,(y+1)*160*4));
    netz.freigeben();
    return {referenz:{quelle,gpuBild,stufen:window.ElfixSpielerAnime4k.stufen(160,96,40,24)},status:states.find(s=>s.zustand==='aktiv'),backing:[letzte.w,letzte.h],oben:letzte.oben,unten:letzte.unten,
      uebergang,passes:passes.slice(0,pro),stufen,stufen1080,stufen4k,stufenKnapp,vierK,aus};
  })()`);
  assert.equal(ergebnis.status.verfahren, "anime4k");
  assert.equal(ergebnis.status.grund, "anime4k-cnn");
  assert.deepEqual(ergebnis.status.eingang, { breite: 320, hoehe: 180 });
  assert.deepEqual(ergebnis.status.ausgang, { breite: 2560, hoehe: 1440 });
  assert.deepEqual(ergebnis.backing, [2560, 1440]);
  assert.deepEqual(ergebnis.stufen, ["restoreM", "upscaleM", "upscaleS"]);
  assert.deepEqual(ergebnis.stufen1080, ["restoreM", "upscaleM"]);
  assert.deepEqual(ergebnis.stufen4k, ["restoreM", "upscaleM", "upscaleS"]);
  assert.deepEqual(ergebnis.stufenKnapp, ["restoreM"], "Faktor unter der mpv-Schwelle 1,2");
  // Restore 8 + Upscale M 9 + Upscale S 5 Netzdurchgaenge, dann die Ausgabe.
  assert.equal(ergebnis.passes.filter(p => p === "netz").length % 22, 0);
  assert.equal(ergebnis.passes.at(-1), "ausgabe");
  assert.ok(ergebnis.oben[0] > 200 && ergebnis.oben[2] < 60, `oben bleibt rot: ${ergebnis.oben}`);
  assert.ok(ergebnis.unten[2] > 200 && ergebnis.unten[0] < 60, `unten bleibt blau: ${ergebnis.unten}`);
  // Bilinear waeren es bei 8-facher Vergroesserung rund acht Zwischenpixel.
  assert.ok(ergebnis.uebergang > 0 && ergebnis.uebergang <= 6, `harte Kante bleibt scharf: ${ergebnis.uebergang}`);
  assert.deepEqual(ergebnis.vierK.status.ausgang, { breite: 3840, hoehe: 2160 });
  assert.deepEqual(ergebnis.vierK.backing, [3840, 2160]);
  assert.equal(ergebnis.aus.status.zustand, "aus");
  assert.equal(ergebnis.aus.hidden, true);
  assert.equal(ergebnis.aus.opacity, "");
  const erwartet = rechnen(ergebnis.referenz.stufen, Uint8Array.from(ergebnis.referenz.quelle), 40, 24);
  assert.deepEqual([erwartet.w, erwartet.h], [160, 96]);
  let maxAbweichung = 0, summe = 0, anzahl = 0;
  for (let i = 0; i < erwartet.d.length; i += 1) {
    if (i % 4 === 3) continue;
    const soll = Math.round(Math.min(1, Math.max(0, erwartet.d[i])) * 255);
    const d = Math.abs(soll - ergebnis.referenz.gpuBild[i]);
    maxAbweichung = Math.max(maxAbweichung, d);
    summe += d;
    anzahl += 1;
  }
  assert.ok(maxAbweichung <= 4 && summe / anzahl < 0.5,
    `WebGL-Ausgabe weicht von der CPU-Referenz ab: max ${maxAbweichung}, mittel ${(summe / anzahl).toFixed(3)}`);
  console.log(`OK Anime4K-Referenz: max ${maxAbweichung}/255, mittel ${(summe / anzahl).toFixed(3)}`);
  console.log(`OK Anime4K: Restore/Upscale-CNN in WebGL2, Ausrichtung, Kantenschaerfe (${ergebnis.uebergang} px), 1440p/4K`);
  beenden(0);
}).catch(fehler => beenden(1, fehler));
