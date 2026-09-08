"use strict";
const {app,BrowserWindow}=require("electron");
const fs=require("fs"),path=require("path"),os=require("os"),assert=require("assert/strict");
const profile=fs.mkdtempSync(path.join(os.tmpdir(),"elfix-feature-start-"));
app.setPath("appData",profile);app.setPath("userData",path.join(profile,"browser"));
app.disableHardwareAcceleration();
app.setAppPath(path.resolve(__dirname,".."));
for(const stream of [process.stdout,process.stderr]) stream.on("error",()=>app.exit(1));
const timer=setTimeout(()=>{console.error("FAIL Startup timeout");app.exit(1);},60000);
app.on("browser-window-created",(_event,window)=>{
  window.webContents.on("did-finish-load",async()=>{
    if(!window.webContents.getURL().endsWith("index.html"))return;
    try {
      const result=await window.webContents.executeJavaScript(`(async()=>{
        const api=window.streamingBrowser;
        const initial=await api.init();
        return {settings:initial.settings?.playback?.spoilerProtection,
          queue:await api.getRoomQueue('unconfigured','normal'),
          options:!!document.getElementById('spoilerProtectionEnabled')&&!!document.getElementById('spoilerProtectionShareWatchedWithRoom'),
          module:typeof globalThis.ElfixRaumqueue?.erstellen};
      })()`);
      // Der Schutz selbst bleibt eine bewusste Entscheidung; seine beiden
      // Rundenregeln gelten, sobald er an ist.
      assert.deepEqual(result.settings,{enabled:false,roomMinimum:true,shareWatchedWithRoom:true});
      assert.equal(result.options,true);assert.equal(result.module,"function");assert.equal(result.queue.connected,false);
      await window.webContents.executeJavaScript(`(() => {
        const pane=document.createElement('section');pane.id='queue-fixture';pane.className='raumqueue';
        pane.style.cssText='position:fixed;inset:24px;z-index:10000;overflow:auto;margin:0;background:var(--panel)';
        document.body.append(pane);
        globalThis.ElfixRaumqueue.erstellen({root:pane,rooms:()=>['Testkino'],favorites:()=>[{id:'one',title:'Beispielserie · Staffel 1 Folge 2'}],api:{
          getRoomQueue:async(room,mode)=>({room,mode,connected:true,supported:true,rev:2,selectedId:'a',
            weights:[3,2,1],freeWeights:[2,1],items:[
              {id:'a',title:'Beispielserie · Staffel 1 Folge 2',votes:5,voters:2,myVote:3,voted:true,mine:false},
              {id:'b',title:'Ein Film für den nächsten gemeinsamen Abend',votes:1,voters:1,myVote:0,voted:false,mine:true}]}),
          roomQueueCommand:async()=>({ok:true})}});
      })()`);
      await new Promise(resolve=>setTimeout(resolve,200));
      const layout=await window.webContents.executeJavaScript(`(() => {
        const root=document.getElementById('queue-fixture'),start=[...root.querySelectorAll('button')].find(b=>b.textContent==='Jetzt starten');
        start.focus();
        const zeilen=[...root.querySelectorAll('.raumqueue-item')];
        return {overflow:root.scrollWidth>root.clientWidth,focus:document.activeElement===start,rows:zeilen.length,
          // Drei gewichtete Stimmen je Zeile, die eigene davon gedrueckt.
          stimmen:zeilen.map(z=>[...z.querySelectorAll('.stimme-knopf')].map(k=>k.textContent)),
          meine:zeilen.map(z=>[...z.querySelectorAll('.stimme-knopf.is-active')].map(k=>k.textContent)),
          // Anderswo vergebene Gewichte bleiben sichtbar, aber blass.
          vergeben:zeilen.map(z=>[...z.querySelectorAll('.stimme-knopf.is-vergeben')].map(k=>k.textContent)),
          // Und starten darf man jeden Vorschlag, nicht nur den obersten.
          starts:zeilen.filter(z=>[...z.querySelectorAll('button')].some(k=>k.textContent==='Jetzt starten')).length,
          punkte:zeilen.map(z=>z.querySelector('small').textContent)};
      })()`);
      assert.deepEqual(layout,{overflow:false,focus:true,rows:2,
        stimmen:[['3','2','1'],['3','2','1']],
        meine:[['3'],[]],
        vergeben:[[],['3']],
        starts:2,
        punkte:['5 Punkte von 2 Personen','1 Punkt von 1 Person']});
      const picture=path.resolve(__dirname,'../../build/history-perf/raumqueue-desktop.png');
      fs.mkdirSync(path.dirname(picture),{recursive:true});fs.writeFileSync(picture,(await window.webContents.capturePage()).toPNG());
      console.log("OK Real application startup: settings, renderer module, secured queue IPC, queue layout and keyboard focus with isolated profile");
      clearTimeout(timer);app.exit(0);
    } catch(e){console.error(e.stack);clearTimeout(timer);app.exit(1);}
  });
});
require("../src/main.js");
