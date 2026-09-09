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
            weights:[3,2,1],freeWeights:[2,1],spin:globalThis.__elfixLos||null,items:[
              {id:'a',title:'Beispielserie · Staffel 1 Folge 2',votes:5,voters:2,myVote:3,voted:true,mine:false},
              {id:'b',title:'Ein Film für den nächsten gemeinsamen Abend',votes:1,voters:1,myVote:0,voted:false,mine:true}]}),
          // Das Los faellt im Relay und steht danach im Raumzustand. Der
          // Ersatzraum tut dasselbe, damit die Anzeige denselben Weg geht.
          roomQueueCommand:async(room,mode,befehl)=>{
            if(befehl==='spin') globalThis.__elfixLos={spinId:'los-1',by:'Ben',winnerId:'b',landing:0.5,
              startLokal:Date.now(),duration:900,fields:[
                {id:'a',title:'Beispielserie · Staffel 1 Folge 2',weight:6},
                {id:'b',title:'Ein Film für den nächsten gemeinsamen Abend',weight:2}]};
            return {ok:true};
          }}});
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
      /*
       * Das Gluecksrad.
       *
       * Geprueft wird die Rechnung dahinter, nicht die Bewegung: jeder
       * Vorschlag bekommt ein Feld (auch ohne Stimme), und am Ende steht der
       * Zeiger wirklich in dem Feld, das ausgelost wurde.
       */
      const rad=await window.webContents.executeJavaScript(`(() => {
        const box=document.querySelector('#queue-fixture .raumqueue-rad');
        box.open=true;
        return {felder:box.querySelectorAll('path').length,
          schriften:[...box.querySelectorAll('text')].map(t=>t.textContent),
          drehbar:!box.querySelector('button.primary-action').disabled,
          startVersteckt:box.querySelectorAll('button')[1].hidden};
      })()`);
      assert.equal(rad.felder,2,"Das Rad zeigt nicht jeden Vorschlag");
      assert.equal(rad.schriften.length,2,"Ein Feld blieb ohne Beschriftung");
      assert.equal(rad.drehbar,true,"Ab zwei Vorschlaegen muss sich drehen lassen");
      assert.equal(rad.startVersteckt,true,"Vor der Auslosung gibt es nichts zu starten");

      // Die Drehung wird auf eine Millisekunde gekuerzt: der Ausgang steht
      // ohnehin vor der Bewegung fest, und die Pruefung soll nicht vier
      // Sekunden lang einer Animation zusehen.
      // Und die Scheibe bewegt sich wirklich: zwei Proben waehrend des Laufs
      // muessen verschieden stehen. Ein Sprung auf den Endwert waere kein Rad.
      /*
       * Geprueft wird die Art der Animation und nicht ihr Aussehen.
       * Gezeichnete Zwischenbilder gibt es in einem verborgenen Fenster ohne
       * Grafikbeschleunigung nicht verlaesslich - auf dem Bauserver fiel genau
       * daran eine Pruefung um, die oertlich lief.
       *
       * Die Art traegt denselben Beleg und haengt an nichts, was der Bildschirm
       * tut: ein CSS-Uebergang laeuft an dieser SVG-Gruppe gar nicht an, die
       * Scheibe sprang damit auf den Endwert. Steht hier ein `CSSTransition`
       * statt einer `Animation`, ist genau dieser Fehler zurueck.
       *
       * `matchMedia` wird dafuer festgelegt: mit "reduzierte Bewegung" waere
       * die Dauer null, und das ist eine andere, ebenso richtige Antwort.
       */
      const bewegung=await window.webContents.executeJavaScript(`new Promise(fertig => {
        const box=document.querySelector('#queue-fixture .raumqueue-rad');
        const scheibe=box.querySelector('.rad-scheibe > g');
        window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
        box.querySelector('button.primary-action').click();
        setTimeout(()=>{
          const laeufe=scheibe.getAnimations().map(lauf=>({art:lauf.constructor.name,
            dauer:Number(lauf.effect.getTiming().duration)||0}));
          fertig({laeufe,
            text:box.querySelector('.rad-ergebnis').textContent,
            startVersteckt:box.querySelectorAll('button')[1].hidden});
        },200);
      })`);
      assert.ok(bewegung.laeufe.some(lauf=>lauf.art==="Animation"&&lauf.dauer>0),
        "Die Scheibe dreht sich nicht - erwartet wird eine Animation mit Dauer, gefunden: "
        +JSON.stringify(bewegung.laeufe));
      assert.match(bewegung.text,/dreht das Rad/,"Waehrend der Drehung fehlt, wer sie ausgeloest hat");
      assert.equal(bewegung.startVersteckt,true,"Der Gewinner stand schon vor dem Halten fest");
      const ausgang=await window.webContents.executeJavaScript(`new Promise(fertig => {
        const box=document.querySelector('#queue-fixture .raumqueue-rad');
        const nachsehen=()=>{
          const text=box.querySelector('.rad-ergebnis').textContent;
          if(!text.startsWith('Das Los')||text.endsWith('…')) return false;
          const zeiger=box.querySelector('.rad-zeiger').getBoundingClientRect();
          const felder=[...box.querySelectorAll('path')];
          // Der oberste Knoten unter dem Zeiger kann die Beschriftung oder der
          // Zeiger selbst sein - gesucht ist das Feld darunter.
          const punkt=document.elementsFromPoint(zeiger.left+zeiger.width/2,zeiger.bottom+14)
            .find(el=>felder.includes(el));
          const name=text.split(': ').slice(1).join(': ');
          const zeilen=[...document.querySelectorAll('#queue-fixture .raumqueue-item')];
          fertig({text,name,
            startSichtbar:!box.querySelectorAll('button')[1].hidden,
            feldIndex:felder.indexOf(punkt),
            gewinnerIndex:zeilen.findIndex(z=>z.querySelector('strong').textContent===name)});
          return true;
        };
        if(nachsehen()) return;
        const uhr=setInterval(()=>{ if(nachsehen()) clearInterval(uhr); },120);
      })`);
      assert.ok(ausgang.name,"Das Ergebnis nannte keinen Vorschlag: "+ausgang.text);
      assert.equal(ausgang.gewinnerIndex,1,"Nicht der vom Raum ausgeloste Vorschlag gewann");
      assert.equal(ausgang.startSichtbar,true,"Nach der Auslosung fehlt der Startknopf");
      assert.ok(ausgang.gewinnerIndex>=0,"Der ausgeloste Name steht nicht in der Liste");
      assert.equal(ausgang.feldIndex,ausgang.gewinnerIndex,
        "Der Zeiger stand nicht in dem Feld, das ausgelost wurde");

      const picture=path.resolve(__dirname,'../../build/history-perf/raumqueue-desktop.png');
      fs.mkdirSync(path.dirname(picture),{recursive:true});fs.writeFileSync(picture,(await window.webContents.capturePage()).toPNG());
      console.log("OK Real application startup: settings, renderer module, secured queue IPC, queue layout and keyboard focus with isolated profile");
      clearTimeout(timer);app.exit(0);
    } catch(e){console.error(e.stack);clearTimeout(timer);app.exit(1);}
  });
});
require("../src/main.js");
