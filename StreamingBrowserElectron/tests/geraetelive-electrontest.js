"use strict";
const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("assert/strict");
const profil = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-geraetelive-"));
app.setPath("appData", profil);
app.setPath("userData", path.join(profil, "browser"));
app.setAppPath(path.resolve(__dirname, ".."));
app.disableHardwareAcceleration();
const timeout = setTimeout(() => app.exit(1), 60000);
app.on("browser-window-created", (_ereignis, fenster) => {
  fenster.webContents.on("did-finish-load", async () => {
    if (!fenster.webContents.getURL().endsWith("index.html")) return;
    try {
      await fenster.webContents.executeJavaScript(`(async () => {
        await window.streamingBrowser.getGeraeteStatus();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      })()`);
      const ergebnis = await fenster.webContents.executeJavaScript(`(() => {
        const status = { connected:true, enabled:true, hasKey:true, devices:[
          { id:'pc',name:'Dieser PC',current:true,playback:{title:'Eigenes Video'} },
          { id:'tv',name:'Wohnzimmer-TV',typ:'tv',online:true,
            playback:{title:'Wise Man’s Grandchild',season:1,episode:4,position:720,paused:false} }
        ] };
        renderGeraeteStatus(status);
        const bereich=document.getElementById('homeGeraeteLive');
        const liste=document.getElementById('homeGeraeteLiveListe');
        const karte=liste.firstElementChild;
        const sichtbar=getComputedStyle(bereich).display!=='none';
        const text=karte.textContent;
        const eigeneUnsichtbar=liste.children.length===1;
        status.devices[1].playback.paused=true;
        renderGeraeteStatus(status);
        const gleicheKarte=liste.firstElementChild===karte;
        const pausiert=karte.textContent.includes('pausiert');
        const geraeteliste=document.getElementById('geraeteListe').textContent.includes('Wise Man');
        status.devices[1].playback.title='<img src=x onerror=alert(1)>';
        renderGeraeteStatus(status);
        const textSicher=karte.querySelector('img')===null && karte.textContent.includes('<img');
        status.connected=false;
        renderGeraeteStatus(status);
        const getrennt=getComputedStyle(bereich).display==='none' && liste.children.length===0;
        status.connected=true; status.devices[1].playback=null;
        renderGeraeteStatus(status);
        const beendet=getComputedStyle(bereich).display==='none';
        status.devices[1].playback={title:'Wise Man’s Grandchild',season:1,episode:4,paused:false};
        renderGeraeteStatus(status);
        window.__liveProbeStatus = status;
        const keinUeberlauf=bereich.scrollWidth<=bereich.clientWidth;
        return {sichtbar,text,eigeneUnsichtbar,gleicheKarte,pausiert,geraeteliste,textSicher,getrennt,beendet,keinUeberlauf};
      })()`);
      assert.match(ergebnis.text, /Wohnzimmer-TV schaut gerade.*Wise Man.*Staffel 1, Folge 4/);
      for (const [name, wert] of Object.entries(ergebnis)) if (name !== "text") assert.equal(wert, true, name);
      const screenshot = path.resolve(__dirname, "../../build/history-perf/geraete-live-preview.png");
      await fenster.webContents.executeJavaScript(`new Promise(resolve => {
        renderGeraeteStatus(window.__liveProbeStatus);
        setTimeout(() => {
          renderGeraeteStatus(window.__liveProbeStatus);
          document.getElementById('homeGeraeteLive').style.animation='none';
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }, 500);
      })`);
      assert.equal(await fenster.webContents.executeJavaScript(`document.getElementById('homeGeraeteLive').getBoundingClientRect().height > 0`), true,
        "Live-Bereich bleibt nach asynchronem Start sichtbar");
      fs.mkdirSync(path.dirname(screenshot), { recursive: true });
      fs.writeFileSync(screenshot, (await fenster.webContents.capturePage()).toPNG());
      clearTimeout(timeout);
      console.log("OK Live-Geraeteanzeige: Startseite, Pause, stabiler DOM, sicheres Text-Rendering, Ende und Trennung");
      app.exit(0);
    } catch (fehler) {
      console.error("FAIL " + fehler.stack);
      app.exit(1);
    }
  });
});
require("../src/main.js");
