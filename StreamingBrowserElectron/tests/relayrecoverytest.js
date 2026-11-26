const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const relay = fs.readFileSync(path.join(__dirname, '../../sync-server/server.js'), 'utf8').replace(/\r\n/g, '\n');
const functions = relay.slice(relay.indexOf('const SYNC_BEREIT_FRIST_MS'), relay.indexOf('wss.on("connection"'));
const URL = 'https://aniworld.to/anime/stream/test/staffel-1/episode-2';
function harness() {
  let now = 1000;
  const timers = new Set(), clients = new Set();
  const context = vm.createContext({
    Map, Set, JSON, Math, Number, Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } },
    setTimeout(fn, delay) { const t = { at: now + delay, fn, unref() {} }; timers.add(t); return t; },
    clearTimeout: (t) => timers.delete(t),
    wss: { clients }, START_VORLAUF_MS: 800,
    text: (s, n = 500) => typeof s === 'string' ? s.slice(0, n) : '',
    naechsteNummer: (e) => e.nummer = (e.nummer || 0) + 1,
    folgenKennung: (s, e) => `s${s}e${e}`,
    aktiveTeilnehmer: (room, e) => [...clients].filter((c) => c.raum === room && e.members.has(c.geraetId)).map((c) => ({ geraetId: c.geraetId })),
    aktuelleHostId: (room, e) => e.hostId,
    standSetzen() {}, standFuerAlle() {}, zustandSenden() {},
    standSenden(room, e) { for (const c of clients) if (c.raum === room && e.members.has(c.geraetId)) c.send(JSON.stringify({ type: 'watchstate', preparation: context.syncStand(e) })); }
  });
  vm.runInContext(functions, context);
  function client(id, room = 'a', recovery = true) {
    const c = { geraetId: id, name: id.toUpperCase(), raum: room, playbackRecovery: recovery,
      readyState: 1, OPEN: 1, messages: [], send(raw) { this.messages.push(JSON.parse(raw)); } };
    clients.add(c); return c;
  }
  function title(cs) { return { key: 'title', url: URL, live: { url: URL }, season: 1, episode: 2, tempo: 1.5,
    hostId: cs[0].geraetId, members: new Map(cs.map((c) => [c.geraetId, c.name])) }; }
  function prepare(e, cs, reason = 'episode-change', options = {}) { context.syncVorbereiten(cs[0].raum, e, 42.125, 'Host', cs[0].geraetId,
    { grund: reason, fristMs: reason === 'episode-change' ? 90000 : 5000, ...options }); return e.sync.id; }
  function tick(ms) {
    const until = now + ms;
    for (;;) { const t = [...timers].filter((t) => t.at <= until).sort((a,b) => a.at - b.at)[0];
      if (!t) break; timers.delete(t); now = t.at; t.fn(); }
    now = until;
  }
  function ready(e, c, id = e.sync?.id, ok = true) { context.syncBereitMelden(c.raum, e, c, { syncId: id, ok }); }
  function left(e, c, id = e.sync.id) { context.syncVerlassenBestaetigen(c.raum, e, c, { syncId: id }); }
  return { context, client, title, prepare, tick, ready, left, clients, timers };
}
function messages(c, type) { return c.messages.filter((m) => m.type === type); }
let checks = 0;
function test(name, fn) { fn(); checks++; console.log(`OK ${name}`); }

test('Namentlicher Quellstatus, neue Generation und strikt sequenzieller Wiederbeitritt', () => {
  const h = harness(), a = h.client('a'), b = h.client('b'), c = h.client('c'), other = h.client('a', 'b');
  const e = h.title([a,b,c]); const old = h.prepare(e, [a,b,c]);
  h.ready(e,a); h.ready(e,b);
  h.context.syncLadestandMelden('a',e,c,{syncId:old,state:'confirmation-required',detail:'Bitte bestaetigen'});
  const status = h.context.syncStand(e); assert.equal(status.members.find((m) => m.id === 'c').name, 'C');
  assert.equal(status.members.find((m) => m.id === 'c').state, 'confirmation-required');
  h.tick(89999); assert.equal(messages(a,'syncrecover').length,0);
  h.tick(1); const id = e.sync.id; assert.notEqual(id, old);
  for (const member of [a,b,c]) { const m=messages(member,'syncrecover')[0]; assert.equal(m.syncId,id); assert.equal(m.position,42.125); assert.equal(m.tempo,1.5); assert.equal(m.hostId,'a'); assert.ok(m.sequenceId); assert.equal(m.episodeId,'s1e2'); }
  h.ready(e,c,old); h.ready(e,c,id); assert.equal(e.sync.phase,'leaving');
  h.left(e,c); h.left(e,a); assert.equal(messages(a,'syncprepare').length,1);
  h.left(e,b); assert.equal(e.sync.aktuell,'a'); assert.equal(messages(a,'syncprepare').length,2); assert.equal(messages(b,'syncprepare').length,1);
  h.ready(e,b,id); assert.equal(e.sync.aktuell,'a','a future participant cannot skip ahead');
  h.ready(e,a,id); assert.equal(e.sync.aktuell,'b');
  h.ready(e,b,id); assert.equal(e.sync.aktuell,'c');
  h.tick(90000); assert.equal(e.sync,null);
  assert.equal(messages(a,'syncstart').length,1); assert.equal(messages(b,'syncstart').length,1); assert.equal(messages(c,'syncstart').length,0);
  assert.equal(h.context.syncStand(e).members.find((m) => m.id==='c').state,'error');
  assert.equal(e.members.size,3,'saved memberships survive playback recovery');
  assert.equal(other.messages.length,0,'same identity and title in another room are isolated');
  h.tick(900000); assert.equal(messages(a,'syncrecover').length,1,'no automatic retry loop');
});

test('Regulaeres Seek behaelt 5s; belegte Quellensuche bekommt einmalig 90s', () => {
  const h=harness(), a=h.client('a'), b=h.client('b'), e=h.title([a,b]);
  h.prepare(e,[a,b],''); h.ready(e,a); h.tick(5000); assert.equal(e.sync,null); assert.equal(messages(a,'syncrecover').length,0);
  const id=h.prepare(e,[a,b],''); h.tick(1000);
  h.context.syncLadestandMelden('a',e,b,{syncId:id,state:'source-search'}); h.tick(4000); assert.ok(e.sync);
  h.tick(80000); h.context.syncLadestandMelden('a',e,b,{syncId:id,state:'confirmation-required'});
  h.tick(5000); assert.equal(e.sync.phase,'leaving');
});

test('Fehlende Resetbestaetigung und alte Clients werden sicher ausgeschlossen', () => {
  const h=harness(), a=h.client('a'), b=h.client('b'), old=h.client('old','a',false), e=h.title([a,b,old]);
  h.prepare(e,[a,b,old]); h.tick(90000); h.left(e,a); h.tick(5000);
  assert.equal(e.sync.aktuell,'a'); assert.equal(messages(b,'syncprepare').length,1);
  assert.equal(messages(old,'syncrecover').length,0); assert.equal(messages(old,'syncfailed').at(-1).reason,'recovery-unsupported');
  h.ready(e,a); assert.equal(e.sync,null); assert.equal(messages(a,'syncstart').length,1); assert.equal(messages(b,'syncstart').length,0);
  assert.equal(messages(old,'syncstart').length,0); assert.equal(e.members.size,3);
});

test('Explizites Leave gewinnt; Abbruch und Folgenwechsel entwerten alte Antworten und Timer', () => {
  const h=harness(), a=h.client('a'), b=h.client('b'), e=h.title([a,b]);
  h.prepare(e,[a,b]); h.tick(90000); const old=e.sync.id;
  e.members.delete('b'); h.context.syncTeilnehmerEntfernen('a',e,'b'); h.left(e,a);
  assert.equal(e.sync.aktuell,'a'); h.ready(e,b,old); assert.equal(e.sync.aktuell,'a');
  h.context.syncAbschliessen('a',e,'cancelled','user-cancelled'); assert.equal(e.sync,null);
  h.ready(e,a,old); h.tick(90000); assert.equal(messages(a,'syncstart').length,0);
  h.prepare(e,[a]); const fresh=e.sync.id; assert.notEqual(fresh,old); h.left(e,a,old); h.ready(e,a,old); assert.equal(e.sync.id,fresh);
  h.ready(e,a,fresh); assert.equal(messages(a,'syncstart').length,1);
});

test('Alle Wiederbeitritte gescheitert bleiben angehalten und loesen keine zweite Runde aus', () => {
  const h=harness(), a=h.client('a'), b=h.client('b'), e=h.title([a,b]);
  h.prepare(e,[a,b]); h.tick(90000); h.left(e,a); h.left(e,b); h.ready(e,a,e.sync.id,false); h.ready(e,b,e.sync.id,false);
  assert.equal(e.sync,null); assert.equal(e.live.action,'pause'); assert.equal(h.context.syncStand(e).phase,'failed');
  h.tick(900000); assert.equal(messages(a,'syncrecover').length,1); assert.equal(messages(a,'syncstart').length,0);
});
test('Gescheiterter Host verliert Liveautoritaet; spaete here/control/progress bleiben wirkungslos', () => {
  const h=harness(), a=h.client('a'), b=h.client('b'), e=h.title([a,b]);
  e.stand=new Map([['a',{sitzung:'old-a',alteSitzungen:[],at:1000,episode:2}],['b',{sitzung:'old-b',alteSitzungen:[],at:1000,episode:2}]]);
  h.prepare(e,[a,b]); h.tick(90000); assert.ok(e.stand.get('a').alteSitzungen.includes('old-a'));
  h.left(e,a); h.left(e,b); h.ready(e,a,e.sync.id,false); h.ready(e,b);
  assert.equal(e.hostId,'b'); assert.equal(e.playbackAusgeschlossen.has('a'),true);
  assert.equal(e.playbackAusgeschlossen.has('b'),false);
  const functionSource=(name) => { const start=relay.indexOf(`function ${name}(`); return relay.slice(start,relay.indexOf('\n}\n',start)+3); };
  vm.runInContext(functionSource('istAktiv'),h.context);
  assert.equal(h.context.istAktiv('a',e,'a',e.stand.get('a')),false);
  // Die echten Nachrichteneingaenge aus dem Relay ausfuehren. Spaete Echos
  // duerfen nicht einmal die darunterliegenden Player-/Raumwege betreten.
  for (const type of ['here','control','progress']) {
    const start=relay.indexOf(`    if (nachricht.type === "${type}") {`);
    const end=relay.indexOf('\n    }\n',start)+7;
    vm.runInContext(`function dispatch(socket,raum,nachricht) { ${relay.slice(start,end)} throw Error('nicht ausgeschlossen'); }`,h.context);
    h.context.dispatch(a,{titel:new Map([['title',e]])},{type,key:'title',action:'pause',position:0,paused:true,playerSessionId:'old-a'});
  }
  assert.equal(messages(b,'syncstart').length,1);
});

test('Wiederanschluss und alte Resetbestaetigung umgehen die laufende Reihenfolge nicht', () => {
  const h=harness(), a=h.client('a'), b=h.client('b'), e=h.title([a,b]);
  h.prepare(e,[a,b]); h.tick(90000); const id=e.sync.id;
  h.left(e,a); h.left(e,b);
  const reconnect=h.client('b'); h.context.syncTeilnehmerNachtragen('a',e,reconnect);
  assert.equal(messages(reconnect,'syncprepare').length,0,'future reconnect must await its turn');
  h.ready(e,a); assert.equal(messages(reconnect,'syncprepare').length,1);
  h.left(e,reconnect,id); assert.equal(e.sync.aktuell,'b','late reset ACK cannot advance a rejoin');
  h.ready(e,reconnect); assert.equal(e.sync,null); assert.equal(messages(a,'syncstart').length,1);
});
test('Alter Share-Nachtrag waehrend Recovery darf finale Zielfolge und Fortschritt nicht zuruecksetzen', () => {
  for (const restore of [true, false]) for (const zielLaufend of [true, false]) {
    const h=harness(), a=h.client('a'), b=h.client('b'), e=h.title([a,b]);
    const oldURL=URL.replace('episode-2','episode-1');
    e.progress={url:URL,season:1,episode:2,position:42.125};
    const originalProgress=e.progress;
    const functionSource=(name) => { const start=relay.indexOf(`function ${name}(`); return relay.slice(start,relay.indexOf('\n}\n',start)+3); };
    Object.assign(h.context,{MAX_TITEL_JE_RAUM:100,vorgaengerAufraeumen(){},zustandSpeichernSpaeter(){}});
    vm.runInContext(['zahl','httpAdresse','titelSaeubern','fortschrittSaeubern','folgeIstNeuer'].map(functionSource).join('\n'),h.context);
    const blocks=['share','progress'].map((type)=>{const start=relay.indexOf(`    if (nachricht.type === "${type}") {`);return relay.slice(start,relay.indexOf('\n    }\n',start)+7);});
    vm.runInContext(`function dispatch(socket,raum,nachricht) { ${blocks.join('\n')} }`,h.context);
    const room={titel:new Map([['title',e]]),graeber:new Map()};
    h.prepare(e,[a,b],'episode-change',{zielLaufend});h.tick(90000);h.left(e,a);h.left(e,b);h.ready(e,a);
    h.context.dispatch(b,room,{type:'share',restore,item:{key:'title',url:oldURL,title:'Metadaten aktualisiert',type:'serie',season:1,episode:1}});
    h.context.dispatch(a,room,{type:'progress',key:'title',progress:{url:oldURL,season:1,episode:1,position:10,duration:100}});
    assert.equal(e.progress,originalProgress,'old progress is rejected while the target is loading');
    h.ready(e,b);
    const start=zielLaufend ? messages(a,'syncstart').at(-1) : messages(a,'control').find((m)=>m.reason==='sync-pausiert');
    assert.equal(start.url,URL);
    assert.equal(start.episodeId,'s1e2','reproduced: syncprepare loaded e2 but syncstart identified e1');
    assert.equal(e.url,URL);assert.equal(e.season,1);assert.equal(e.episode,2);
    assert.equal(e.title,'Metadaten aktualisiert','metadata updates remain allowed');
    if (restore) {
      h.context.dispatch(b,room,{type:'share',restore:true,item:{key:'title',url:oldURL,title:e.title,type:'serie',season:1,episode:1}});
      assert.equal(e.episode,2,'late restore after completion is not a new episode choice');
      assert.equal(e.url,URL);
    }
    h.context.dispatch(a,room,{type:'progress',key:'title',progress:{url:oldURL,season:1,episode:1,position:10,duration:100}});
    assert.equal(e.progress,originalProgress,'old progress cannot roll the accepted target back');
  }
});
console.log(`${checks}/${checks} bestanden`);
