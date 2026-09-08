"use strict";
const {app,BrowserWindow,ipcMain} = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http");
const komfortVideo = require("./komfort-video");
const profil=fs.mkdtempSync(path.join(os.tmpdir(),"elfix-vorschau-"));
app.setPath("userData",profil); app.disableHardwareAcceleration();
let fenster, server;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const frist=setTimeout(()=>ende(1,Error("Vorschau-Player Timeout")),35000);
function ende(code,e){if(e)console.error(e);clearTimeout(frist);fenster?.destroy();server?.close();app.exit(code)}
async function warten(fn){const bis=Date.now()+7000;while(Date.now()<bis){if(await fn())return;await pause(30)}throw Error("Vorschau-Zustand fehlt")}
app.whenReady().then(async()=>{
  fenster=new BrowserWindow({show:false,width:1100,height:700,webPreferences:{
    preload:path.join(__dirname,"../src/spieler-preload.js"),sandbox:true,contextIsolation:true,
    nodeIntegration:false,backgroundThrottling:false,autoplayPolicy:"no-user-gesture-required"}});
  await fenster.loadURL("data:text/html,<html></html>");
  const video=await komfortVideo(fenster,path.join(profil,"farben.webm"));
  let proben=0, spruenge=0;
  server=http.createServer((req,res)=>{
    res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Expose-Headers","Content-Range");
    res.setHeader("Content-Type","video/webm");
    if(req.headers.range==="bytes=0-0")proben++;
    const bereich=/bytes=(\d+)-(\d*)/.exec(req.headers.range||"");
    if(bereich){const start=Number(bereich[1]);if(start>=video.length){res.writeHead(416);res.end();return}
      const end=Math.min(video.length-1,bereich[2]?Number(bereich[2]):video.length-1);
      res.writeHead(206,{"Content-Range":`bytes ${start}-${end}/${video.length}`,"Content-Length":end-start+1});res.end(video.subarray(start,end+1));
    }else{res.writeHead(200,{"Content-Length":video.length});res.end(video)}
  });
  await new Promise(r=>server.listen(0,"127.0.0.1",r));
  const basis={id:1,adresse:`http://127.0.0.1:${server.address().port}/farben.webm`,typ:"datei",titel:"Vorschau",weiterZaehler:0};
  ipcMain.on("spieler:bereit",e=>e.sender.send("spieler:auftrag",basis));
  ipcMain.handle("spieler:chat-status",()=>({active:false,messages:[]}));
  ipcMain.on("spieler:sprung",()=>spruenge++);
  await fenster.loadFile(path.join(__dirname,"../src/renderer/spieler.html"));
  // requestAnimationFrame steuert die Pointer-Koaleszierung und läuft nur für
  // ein sichtbares Renderer-Fenster; genau das ist auch der reale Nutzerpfad.
  fenster.show();
  const js=c=>fenster.webContents.executeJavaScript(c);
  await warten(()=>js("bild.readyState>=2 && Number.isFinite(bild.duration)"));
  await js("bild.pause(); bild.currentTime=.3; schichtenZeigen()");
  await warten(()=>js("!bild.seeking"));
  await js("spulVorschauZeigen(2)");
  await warten(()=>js("!vorschauBild.hidden"));
  const pixel=await js("Array.from(vorschauBild.getContext('2d').getImageData(120,67,1,1).data)");
  assert.ok(pixel[2]>180 && pixel[0]<80,`Zweite Sekunde zeigt blaues Bild: ${pixel}`);
  assert.ok(Math.abs(await js("bild.currentTime")-.3)<.05,"Vorschau spult nicht den Hauptfilm");
  assert.equal(await js("bild.paused"),true);
  assert.equal(spruenge,0,"Vorschau sendet keinen Watchparty-Sprung");
  assert.equal(proben,1,"Nur ein begrenzter Probeabruf je Preview-Medium");
  // Die Maus bleibt fast eine Sekunde in Bewegung. Der Stand nach dem letzten
  // Pointer-Event wäre für den alten, stets zurückgesetzten 150-ms-Debouncer
  // kein Beleg: Deshalb werden nur Canvasbilder gezählt, die *während* der
  // fortlaufenden Pointer-Events sichtbar waren.
  await js("spulVorschauVerbergen()");
  const bewegung=await js(`new Promise(resolve=>{
    const rahmen=regler.getBoundingClientRect(), farben=new Set(); let zaehler=0;
    regler.dispatchEvent(new PointerEvent('pointerdown',{clientX:rahmen.left+4}));
    const bewegen=setInterval(()=>{
      const anteil=.04+(.92*Math.min(1,zaehler/24));
      regler.dispatchEvent(new PointerEvent('pointermove',{clientX:rahmen.left+rahmen.width*anteil}));
      zaehler++;
    },35);
    const bilder=setInterval(()=>{
      if(vorschauBild.hidden)return;
      const p=vorschauBild.getContext('2d').getImageData(120,67,1,1).data;
      if(p[0]>180)farben.add('rot'); else if(p[1]>180)farben.add('gruen'); else if(p[2]>180)farben.add('blau');
    },20);
    setTimeout(()=>{clearInterval(bewegen);clearInterval(bilder);regler.dispatchEvent(new PointerEvent('pointerup'));resolve({zaehler,farben:[...farben],text:vorschauText.textContent})},980);
  })`);
  assert.ok(bewegung.zaehler>=20,"Test sendet fortlaufende Pointer-Events");
  assert.ok(bewegung.farben.length>=2,`Mindestens zwei echte Vorschauframes erscheinen während der Bewegung: ${bewegung.farben}`);
  assert.ok(Math.abs(await js("bild.currentTime")-.3)<.05,"Dauerndes Vorschauen spult nicht den Hauptfilm");
  assert.equal(await js("bild.paused"),true);
  assert.equal(spruenge,0,"Dauerndes Vorschauen sendet keinen Watchparty-Sprung");
  assert.equal(proben,2,"Auch eine neue Vorschau-Session bleibt bei einem Bereichs-Probeabruf");
  await js("spulVorschauVerbergen()");
  await js("regler.dispatchEvent(new PointerEvent('pointermove',{clientX:regler.getBoundingClientRect().left+8})); regler.dispatchEvent(new PointerEvent('pointerleave'))");
  await pause(150);
  assert.equal(await js("vorschauKasten.hidden"),true,"Ein ausstehender Maus-Frame oeffnet die Vorschau nach Verlassen nicht erneut");
  assert.equal(await js("document.querySelectorAll('video').length"),1,"Verlassen startet keinen verspaeteten Vorschau-Decoder");
  await js("regler.dispatchEvent(new PointerEvent('pointerdown')); regler.value='800'; regler.dispatchEvent(new Event('input'))");
  assert.ok(Math.abs(await js("bild.currentTime")-.3)<.05,"Ziehen bleibt bis zum Loslassen eine Vorschau");
  await js("regler.dispatchEvent(new Event('change'))");
  await warten(()=>Promise.resolve(spruenge===1));
  assert.ok(Math.abs(await js("bild.currentTime")-2)<.1,"Loslassen spult einmal zum Ziel");
  assert.equal(await js("vorschauKasten.hidden"),true);
  await js("spulVorschauZeigen(0)");
  await warten(()=>js("!vorschauBild.hidden"));
  const rot=await js("Array.from(vorschauBild.getContext('2d').getImageData(120,67,1,1).data)");
  assert.ok(rot[0]>180&&rot[2]<80,`Anfang zeigt rotes Bild: ${rot}`);
  await js("spulVorschauVerbergen()");
  assert.equal(await js("document.querySelectorAll('video').length"),1,"Zweiter Abspieler wird nach Verlassen entfernt");
  console.log("OK Echter Player: rote/blaue Videovorschau, Range, Hauptvideo unveraendert, genau ein Seek beim Loslassen und Cleanup");
}).then(()=>ende(0),e=>ende(1,e));
