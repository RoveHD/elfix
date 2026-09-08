"use strict";
const {app,BrowserWindow,WebContentsView,ipcMain}=require("electron");
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),vm=require("node:vm");
app.setPath("userData",fs.mkdtempSync(path.join(os.tmpdir(),"elfix-mini-nav-")));app.disableHardwareAcceleration();
let win,view;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const timer=setTimeout(()=>finish(1,Error("Miniplayer Timeout")),35000);
function finish(code,e){if(e)console.error(e);clearTimeout(timer);if(view&&!view.webContents.isDestroyed())view.webContents.close();win?.destroy();app.exit(code);}
async function until(fn){const end=Date.now()+7000;while(Date.now()<end){if(await fn())return;await sleep(40);}throw Error("Miniplayer: erwarteter Zustand fehlt");}
const main=fs.readFileSync(path.join(__dirname,"../src/main.js"),"utf8");
function source(name){const m=main.match(new RegExp(`(?:async )?function ${name}\\([^]*?^}`,"m"));assert.ok(m,name);return m[0];}
app.whenReady().then(async()=>{
 win=new BrowserWindow({show:true,width:1100,height:720,webPreferences:{backgroundThrottling:false}});
 await win.loadURL("data:text/html,<body style='background:%23111;color:white'><h1>ELFIX Navigationstest</h1><p id='route'>Player</p></body>");
 view=new WebContentsView({webPreferences:{preload:path.join(__dirname,"../src/spieler-preload.js"),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,autoplayPolicy:"no-user-gesture-required"}});
 win.contentView.addChildView(view);view.setBounds({x:0,y:0,width:1100,height:720});view.webContents.setAudioMuted(true);
 let closes=0,pauses=0;
 const c=vm.createContext({mainWindow:win,spielerView:view,spielerLauf:{id:1,session:"same"},spielerMiniAktiv:false,spielerMiniVorbereitung:false,spielerAutoMiniAusstehend:null,
 settings:{playback:{pauseOnMinimize:true,pauseOnBlur:true}},isContentFullscreen:false,browserBounds:{x:0,y:0,width:1100,height:720},
 isLiveView:v=>Boolean(v&&!v.webContents.isDestroyed()),clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),providerViews:new Map(),attachedProviderViews:new Set(),overlayReasons:new Set(),
 activeView:null,activeProviderId:null,activeFavoriteId:null,providers:[],webContentsProvider:new Map(),providerResumeState:new Map(),sendActiveState:()=>{},
 direktSpielerSchliessen:()=>{closes++;},clearBrowserDataPreservingLogin:async()=>{},setOverlayOpen:(k,on)=>on?c.overlayReasons.add(k):c.overlayReasons.delete(k),optionaleCachesNachMiniPlanen:()=>{},
 vomSpieler:e=>e.sender===view.webContents,sendFullscreenState:()=>{},applyBrowserBounds:()=>c.spielerLageSetzen(),pauseActivePlayback:()=>{pauses++;view.webContents.executeJavaScript("bild.pause()").catch(()=>{});},ipcMain,setTimeout});
 for(const name of ["spielerMiniBehalten","spielerBeimMinimieren","spielerLageSetzen","enterHomeMode","leaveContentFullscreen"])vm.runInContext(source(name),c);
 const a=main.indexOf('ipcMain.on("spieler:mini-status",');vm.runInContext(main.slice(a,main.indexOf('\n});',a)+4),c);
 const b=main.indexOf('  mainWindow.on("minimize",');vm.runInContext(main.slice(b,main.indexOf('  mainWindow.on("focus",',b)),c);
 ipcMain.handle("spieler:chat-status",()=>({active:false,messages:[]}));await view.webContents.loadFile(path.join(__dirname,"../src/renderer/spieler.html"));
 const js=(s,g=false)=>view.webContents.executeJavaScript(s,g);
 await js(`const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const pen=canvas.getContext('2d');let frame=0;window.testFrames=setInterval(()=>{pen.fillStyle=++frame%2?'#2dd4bf':'#f43f5e';pen.fillRect(0,0,320,180);},40);bild.srcObject=canvas.captureStream(25);bild.play();`);
 await until(()=>js("bild.videoWidth===320 && !bild.paused"));
 ipcMain.emit("spieler:mini-status",{sender:view.webContents},true,true);assert.equal(view.getVisible(),true);assert.equal(c.spielerMiniAktiv,false);ipcMain.emit("spieler:mini-status",{sender:view.webContents},false);
 win.minimize();await until(()=>js("document.pictureInPictureElement===bild"));await until(()=>Promise.resolve(c.spielerMiniAktiv));
 assert.equal(await js("bild.paused"),false,"Fokusverlust vor Minimieren darf nicht pausieren");assert.equal(pauses,0);assert.equal(view.getVisible(),false);
 win.restore();win.show();await sleep(150);const before=await js("bild.currentTime");
 for(const route of ["Startseite","Suche","Mediathek"]){await c.enterHomeMode();await win.webContents.executeJavaScript(`document.getElementById('route').textContent=${JSON.stringify(route)}`);assert.equal(await win.webContents.executeJavaScript("document.getElementById('route').textContent"),route);assert.equal(c.spielerLauf.session,"same");assert.equal(view.getVisible(),false);assert.equal(closes,0);}
 await sleep(350);assert.ok(await js("bild.currentTime")>before,"Video laeuft waehrend Navigation weiter");assert.equal(await js("document.pictureInPictureElement===bild"),true);
 await js("miniUmschalten()",true);await until(()=>Promise.resolve(!c.spielerMiniAktiv));assert.equal(view.getVisible(),true);
 // Fullscreen and closing PiP while still minimized use the real native lifecycle too.
 c.isContentFullscreen=true;win.setFullScreen(true);await until(()=>Promise.resolve(win.isFullScreen()));
 await js("bild.play()");win.minimize();await until(()=>js("document.pictureInPictureElement===bild"));
 await until(()=>Promise.resolve(c.spielerMiniAktiv));assert.equal(win.isMinimized(),true,"Auto-PiP darf das minimierte Hauptfenster nicht wieder oeffnen");
 await js("miniUmschalten()",true);await until(()=>js("bild.paused"));assert.equal(c.spielerMiniAktiv,false);
 win.restore();await sleep(100);
 await js("bild.pause()");win.minimize();await sleep(250);assert.equal(await js("document.pictureInPictureElement===null"),true);assert.equal(await js("bild.paused"),true);win.restore();
 await c.enterHomeMode();assert.equal(closes,1,"Normale Startseiten-Navigation schliesst weiterhin ohne PiP");
 let answer;c.spielerView={webContents:{isDestroyed:()=>false,executeJavaScript:()=>new Promise(r=>{answer=r;})}};const old=c.spielerBeimMinimieren(),count=pauses;c.spielerView=view;c.spielerLauf={id:2};answer(false);await old;assert.equal(pauses,count);
 console.log("OK Echter Electron: Minimieren startet natives PiP, Fokusverlust sicher, Navigation behaelt Video/Sitzung, Rueckkehr, Pause und veraltete Antworten");
}).then(()=>finish(0),e=>finish(1,e));
