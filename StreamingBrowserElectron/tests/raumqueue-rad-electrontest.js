"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow } = require("electron");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-wheel-"));
app.setPath("userData", path.join(profile, "profile"));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("force-device-scale-factor", "1");
let win;
const timer = setTimeout(() => { console.error("Wheel test timed out"); app.exit(1); }, 45000);
const run = code => win.webContents.executeJavaScript(code, true);
app.whenReady().then(async () => {
  const renderer = path.resolve(__dirname, "../src/renderer");
  const fixture = path.join(profile, "wheel.html");
  fs.writeFileSync(fixture, `<meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(renderer, "styles.css"))}">
    <body style="margin:0;padding:14px;overflow:auto;--accent:#467deb"><section class="raumqueue" id="queue"></section>
    <script src="${pathToFileURL(path.join(renderer, "raumqueue.js"))}"></script></body>`);
  win = new BrowserWindow({ show: false, width: 1280, height: 1000, useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  await win.loadFile(fixture);
  win.setOpacity(0);win.showInactive();
  await run(`(async () => {
    window.names = ['Game of Thrones','My Hero Academia','One Piece','Prison Break','Dragonball Z','Dragonball'];
    window.weights = [5,3,2,1,1,1];
    window.queueState = {room:'Bangus',mode:'normal',connected:true,supported:true,rev:1,
      weights:[3,2,1],freeWeights:[3,2,1],items:names.map((title,i)=>({id:String(i),title,votes:weights[i]-1}))};
    window.queueOptions = {root:document.querySelector('#queue'),rooms:()=>['Bangus'],favorites:()=>[],
      settings:()=>({uiSounds:false}),api:{getRoomQueue:async()=>queueState,
        roomQueueCommand:async()=>({ok:true}),onRoomQueue:callback=>{window.queueUpdate=callback;return ()=>{};}}};
    window.queueHandle = ElfixRaumqueue.erstellen(queueOptions);
    await queueHandle.refresh();
    if (document.querySelector(".raumqueue-body").hidden) document.querySelector(".raumqueue-klappe").click();
    document.querySelector('.raumqueue-rad').open = true;
  })()`);

  const output = path.resolve(__dirname, "../../build/history-perf");
  fs.mkdirSync(output, { recursive: true });
  for (const [width, weights] of [[1280,[5,3,2,1,1,1]],[740,[5,3,2,1,1,1]],
    [390,[5,3,2,1,1,1]],[740,[1,7,1,3,1,1]],[740,[40,1,1,1,1,1]]]) {
    win.setContentSize(width, 1100);
    await run(`window.weights=${JSON.stringify(weights)};
      queueState={...queueState,items:queueState.items.map((item,i)=>({...item,votes:weights[i]-1}))};
      queueUpdate(queueState);void 0;`);
    await run("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    const geometry = await run(`(() => {
      const root=document.querySelector('#queue'), svg=root.querySelector('svg');
      const fields=[...svg.querySelectorAll('path[data-feld]')];
      let angle=0;
      const total=weights.reduce((a,b)=>a+b,0);
      const spans=weights.map(weight=>{const start=angle;angle+=weight/total*360;return [start,angle];});
      const errors=[];
      for(const label of svg.querySelectorAll('.rad-schrift')) {
        const index=Number(label.previousElementSibling.dataset.feld);
        const [start,end]=spans[index], box=label.getBBox();
        const matrix=label.parentNode.getCTM().inverse().multiply(label.getCTM());
        for(const x of [box.x-1,box.x+box.width+1]) for(const y of [box.y-1,box.y+box.height+1]) {
          const point=new DOMPoint(x,y).matrixTransform(matrix), dx=point.x-100,dy=point.y-100;
          const a=(Math.atan2(dx,-dy)*180/Math.PI+360)%360;
          if(Math.hypot(dx,dy)>91 || (a-start+360)%360>end-start+0.1)
            errors.push({index,a,start,end,text:label.textContent,box:{x:box.x,y:box.y,width:box.width,height:box.height}});
        }
      }
      return {errors,labels:svg.querySelectorAll('.rad-schrift').length,
        titles:fields.map(field=>field.querySelector('title')?.textContent),
        overflow:document.documentElement.scrollWidth>innerWidth};
    })()`);
    assert.deepEqual(geometry.errors, [], `Labels leave weighted segments at ${width}px`);
    assert.ok(geometry.labels > 0);
    if (weights[0] === 5) assert.equal(geometry.labels, 6);
    assert.equal(geometry.overflow, false);
    assert.deepEqual(geometry.titles, ['Game of Thrones','My Hero Academia','One Piece','Prison Break','Dragonball Z','Dragonball']);
    if (weights[0] === 5) fs.writeFileSync(path.join(output, `raumqueue-gewichtung-${width}.png`), (await win.webContents.capturePage()).toPNG());
  }

  const collapsed = await run(`(async () => {
    const button=document.querySelector('.raumqueue-klappe');button.focus();button.click();
    queueState={...queueState,rev:2};queueUpdate(queueState);
    const content=document.getElementById(button.getAttribute('aria-controls'));
    const result={hidden:content.hidden,height:content.getBoundingClientRect().height,
      expanded:button.getAttribute('aria-expanded'),focus:document.activeElement===button};
    queueHandle.destroy();queueHandle=ElfixRaumqueue.erstellen(queueOptions);await queueHandle.refresh();
    result.remembered=document.querySelector('.raumqueue-body').hidden;
    document.querySelector('.raumqueue-klappe').click();
    result.restored=!document.querySelector('.raumqueue-body').hidden;
    document.querySelector('.raumqueue-rad').open=true;
    return result;
  })()`);
  assert.deepEqual(collapsed, { hidden:true,height:0,expanded:"false",focus:true,remembered:true,restored:true });

  // Advance the real Web Animation to either side of each visible spoke.
  // Browser easing is the independent reference; no copy of the app's curve.
  const ticks = await run(`(async () => {
    const originalRaf=window.requestAnimationFrame;
    let callbacks=[];
    window.requestAnimationFrame=callback=>{callbacks.push(callback);return callbacks.length;};
    const pointer=document.querySelector('.rad-zeiger');
    const originalAdd=pointer.classList.add.bind(pointer.classList);
    let hits=0;
    pointer.classList.add=(...classes)=>{if(classes.includes('schlaegt'))hits++;originalAdd(...classes);};
    const reports=[];
    for(const [caseId,values] of [[1,[5,3,2,1,1,1]],[2,[1,7,1,3,1,1]]]) {
      queueUpdate({...queueState,spin:{spinId:'test-'+caseId,winnerId:'2',landing:0.4,
        startLokal:Date.now(),duration:21000,fields:names.map((title,i)=>({id:String(i),title,weight:values[i]}))}});
      const group=document.querySelector('.rad-scheibe > g'), animation=group.getAnimations()[0];
      animation.pause();animation.currentTime=0;
      const frames=animation.effect.getKeyframes();
      const from=Number(/rotate\\(([-.\\d]+)/.exec(frames[0].transform)[1]);
      const to=Number(/rotate\\(([-.\\d]+)/.exec(frames.at(-1).transform)[1]);
      const advance=angle=>{
        let lo=0,hi=Number(animation.effect.getTiming().duration);
        for(let i=0;i<35;i++) {
          const mid=(lo+hi)/2;animation.currentTime=mid;
          if(from+(to-from)*animation.effect.getComputedTiming().progress<angle)lo=mid;else hi=mid;
        }
        animation.currentTime=(lo+hi)/2;
        const pending=callbacks;callbacks=[];pending.forEach(callback=>callback());
      };
      // A spoke reaches twelve o'clock when its rotated endpoint crosses x=100.
      const crossings=[...group.querySelectorAll('line')].map(line=>{
        const angle=Math.atan2(Number(line.getAttribute('x2'))-100,100-Number(line.getAttribute('y2')))*180/Math.PI;
        const contact=((360-angle)%360+360)%360;
        return contact+Math.floor((from-contact)/360+1)*360;
      }).sort((a,b)=>a-b);
      let expected=hits;
      for(const contact of crossings) {
        advance(contact-0.08);reports.push({caseId,stage:'before',expected,actual:hits});
        advance(contact+0.08);expected++;reports.push({caseId,stage:'after',expected,actual:hits});
      }
      animation.finish();await animation.finished;await Promise.resolve();
    }
    window.requestAnimationFrame=originalRaf;
    return reports;
  })()`);
  for (const tick of ticks) assert.equal(tick.actual, tick.expected, JSON.stringify(tick));
  console.log("OK Weighted wheel: contained labels at 1280/740/390px, full-title tooltips, persistent collapse and pointer contacts with unequal weights over successive spins");
  clearTimeout(timer);win.destroy();app.exit(0);
}).catch(error => { console.error(error);clearTimeout(timer);win?.destroy();app.exit(1); });
