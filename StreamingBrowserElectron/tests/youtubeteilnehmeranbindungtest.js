"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const src = fs.readFileSync(require("node:path").join(__dirname, "../src/main.js"), "utf8").replace(/\r/g, "");
const code = src.match(/^async function youtubeTeilnehmerAktualisieren\([^]*?^\}/m)[0];
(async () => {
  const sent = [];
  let fail = false;
  let url = "https://www.youtube.com/watch?v=abcdefghijk";
  const view = { webContents: { getURL: () => url, executeJavaScript: async (script) => {
    if (fail) throw new Error("navigation");
    sent.push(JSON.parse(script));
  } } };
  const context = vm.createContext({ youtubeTeilnehmerStand: new WeakMap(), isLiveView: (v) => v === view,
    youtube: { istYoutubeUrl: (u) => new URL(u).hostname === "www.youtube.com" },
    youtubeTeilnehmer: { anzeigeScript: JSON.stringify }, youtubeAnsicht: () => ({ view }) });
  vm.runInContext(code, context);
  const update = context.youtubeTeilnehmerAktualisieren;
  const state = { enabled: true, connected: true, joined: true, room: "Freunde", me: "a", members: [{id:"a",name:"Elias"}] };
  await update(state);
  for (let position=0;position<100;position++) await update({...state, video:{position}});
  assert.equal(sent.length,1,"Positionstakte injizieren keine identischen Namen");
  await update({...state,members:[...state.members,{id:"b",name:"Jakob"}]});
  assert.equal(sent.length,2);assert.equal(sent[1].members.length,2);
  await update({...state,connected:false});assert.equal(sent.at(-1).connected,false);
  await update({...state,enabled:false});assert.equal(sent.at(-1).enabled,false);
  await update(state,view,true);const count=sent.length;
  await update(state,view,true);assert.equal(sent.length,count+1,"dom-ready stellt denselben Zustand wieder her");
  fail=true;await update({...state,room:"Neu"});fail=false;await update({...state,room:"Neu"});assert.equal(sent.at(-1).room,"Neu");
  const before=sent.length;url="https://aniworld.to/";await update(state,view,true);await update(state,null,true);assert.equal(sent.length,before);
  // Jeder Status-Push frischt die Anzeige in der Seite auf. Wo im Rumpf der
  // Aufruf steht, ist dabei gleich - vor ihm liegt inzwischen die
  // Warteschlangen-Mitgliedschaft der Raum-Warteschlange, und das ist kein
  // Fehler. Geprueft wird deshalb der Rumpf und nicht die erste Zeile.
  const push = src.match(/^function sendYoutubePartyState\(status\) \{[^]*?^\}/m);
  assert.ok(push, "sendYoutubePartyState fehlt");
  assert.match(push[0], /youtubeTeilnehmerAktualisieren\(/);
  assert.match(src,/async function installYoutubePartyControls\(provider, view, url\) \{\s*await youtubeTeilnehmerAktualisieren/);
  console.log("OK YouTube-Teilnehmer: Status-Push, Neuaufbau, Deduplizierung, Trennung und Fehlerwiederholung");
})().catch((error)=>{console.error(error);process.exitCode=1;});
