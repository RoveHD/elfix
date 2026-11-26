"use strict";
const assert = require('node:assert/strict');
const { Watchparty } = require('../src/watchparty');
const { WatchpartyRaeume } = require('../src/watchparty-raeume');
class Socket {
  constructor() { this.readyState = 1; this.sent = []; }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; }
}
const controls = [], states = [];
const party = new Watchparty({ WebSocketKlasse: Socket, onControl: (m) => controls.push(m), onWatchstate: (m) => states.push(m) });
party.konfigurieren({enabled:true,serverUrl:'ws://127.0.0.1:9876',room:'one',name:'Host',deviceSecret:'a'.repeat(43)});
const socket = party.socket;
socket.onopen();
assert.ok(socket.sent.find((m) => m.type === 'join').capabilities.includes('playback-recovery-v1'));
party.nachrichtVerarbeiten(JSON.stringify({type:'state',identityVersion:2,you:'one-id',features:['playback-recovery-v1'],shared:[{key:'title',memberIds:['one-id']}]}));
party.nachrichtVerarbeiten(JSON.stringify({type:'syncrecover',key:'title',syncId:'new',phase:'leave',sequenceId:10,timestamp:100,episodeId:'s1e2',url:'https://example.test/e2',nested:{untrusted:true}}));
assert.equal(controls[0].action,'syncrecover'); assert.equal(controls[0].nested,undefined);
party.nachrichtVerarbeiten(JSON.stringify({type:'syncfailed',key:'title',syncId:'new',reason:'recovery-timeout',recovery:true}));
assert.equal(controls[1].action,'syncfailed'); assert.equal(controls[1].recovery,true);
party.nachrichtVerarbeiten(JSON.stringify({type:'watchstate',key:'title',members:[],preparation:{syncId:'new',phase:'rejoining',reason:'episode-change',recovery:true,currentMemberId:'two-id',members:[{id:'two-id',name:'Lena',state:'confirmation-required',detail:'Bitte bestaetigen',secret:{no:true}},{id:{bad:true},name:'bad'}]}}));
assert.equal(states[0].preparation.currentMemberId,'two-id');
assert.deepEqual(states[0].preparation.members,[{id:'two-id',name:'Lena',state:'confirmation-required',detail:'Bitte bestaetigen'}]);
party.vorbereitungsStatus('title','new','source-search','Suche'); party.wiederherstellungVerlassen('title','new'); party.wiederherstellungAbbrechen('title','new');
assert.deepEqual(socket.sent.slice(-3).map((m) => m.type),['syncstatus','syncrecoverleft','synccancel']);
const sentCount=socket.sent.length;
party.vorbereitungsStatus('foreign','new','error'); party.wiederherstellungVerlassen('foreign','new'); party.wiederherstellungAbbrechen('foreign','new');
assert.equal(socket.sent.length,sentCount,'foreign memberships cannot acknowledge or cancel');
party.trennen();

const routed=[], received=[];
const multi = new WatchpartyRaeume({onControl:(m)=>received.push(m),onWatchstate:(m)=>received.push(m)});
for (const code of ['one','two']) {
  const p = multi.raumAnlegen(code); multi.raeume.set(code,p);
  Object.assign(p,{aktiv:true,identitaetBestaetigt:true,geraetId:'id',raum:code,geteilt:[{key:'title',memberIds:['id']}]});
  p.socket={readyState:1,send(raw){routed.push({room:code,...JSON.parse(raw)});}};
}
multi.vorbereitungsStatus('title','one','sync-one','video-loading');
multi.wiederherstellungVerlassen('title','one','sync-one');
multi.wiederherstellungAbbrechen('title','one','sync-one');
multi.ladezustandMelden('two','title','sync-two','confirmation-required');
assert.deepEqual(routed.map((m)=>[m.room,m.type,m.syncId]),[['one','syncstatus','sync-one'],['one','syncrecoverleft','sync-one'],['one','synccancel','sync-one'],['two','syncstatus','sync-two']]);
multi.raeume.get('two').nachrichtVerarbeiten(JSON.stringify({type:'syncrecover',key:'title',syncId:'sync-two',phase:'leave'}));
multi.raeume.get('one').nachrichtVerarbeiten(JSON.stringify({type:'watchstate',key:'title',members:[],preparation:null}));
assert.equal(received[0].room,'two'); assert.equal(received[1].room,'one');
console.log('OK Watchparty-Recovery-Transport: Capability, Statussanitisierung, Abbruch und exakte Raumzuordnung');

