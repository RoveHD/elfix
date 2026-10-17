"use strict";

// Drei echte Desktop-Verbindungen und die URL-/Player-Zielpruefung aus main.js.
// Medien werden hier nicht geladen; der Electron-Test prueft den echten Einstieg.
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { WatchpartyRaeume } = require("../src/watchparty-raeume");
const WS = require("../../sync-server/node_modules/ws");
const sync = require("../src/watchparty-sync");
const { kontext, folge, key, room, serie } = require("./watchpartystoidentitaettest");
const events = new EventEmitter();
const clients = [];
function warten(bedingung, name) {
  if (bedingung()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { events.off("change", pruefen); reject(Error(name)); }, 6000);
    function pruefen() {
      if (!bedingung()) return;
      clearTimeout(timer); events.off("change", pruefen); resolve();
    }
    events.on("change", pruefen);
  });
}
function client(name, host) {
  const context = kontext(folge(host));
  const prepares = [], starts = [];
  let letzter;
  const raeume = new WatchpartyRaeume({
    WebSocketKlasse: WS,
    onState: items => { context.watchpartyShared = items; events.emit("change"); },
    onStatus: () => events.emit("change"),
    onWatchstate: state => { api.stand = state; events.emit("change"); },
    onControl: message => {
      const urteil = sync.steuerungEntscheiden(message, { letzter, gleicheAdresse: true, offen: null });
      if (urteil.tun === "nichts") return;
      if (!context.spielerRundenNachrichtPasst(context.watchpartyShared[0], message, urteil)) return;
      if (urteil.merken) letzter = urteil.merken;
      if (urteil.tun === "syncprepare") prepares.push(message);
      if (urteil.tun === "syncstart") starts.push(message);
      events.emit("change");
    }
  });
  const api = { context, raeume, prepares, starts, stand: null,
    melden() {
      const runde = context.spielerRunde();
      assert.ok(runde, `${name}: Live-Zuordnung am Anbieter-Alias`);
      raeume.meldeStand(runde.key, { url: runde.adresse, season: 1, episode: 2,
        position: 12, paused: true, playerSessionId: `${name}-player` }, runde.raum);
    },
    bereit() { raeume.bereitZumStart(key, room, prepares.at(-1).syncId); },
    quittung() { return new Promise((resolve, reject) => {
      if (!raeume.barriere(room, resolve)) reject(Error("Keine Relay-Barriere"));
    }); }
  };
  clients.push(api);
  raeume.konfigurieren({ enabled: true, serverUrl: `ws://127.0.0.1:${process.env.TESTPORT || 8799}`,
    rooms: [room], name });
  return api;
}

(async () => {
  const pcs = [client("PC1", "https://serienstream.to"), client("PC2", "https://s.to"),
    client("PC3", "http://186.2.175.5")];
  await warten(() => pcs.every(pc => pc.raeume.raeume.get(room)?.identitaetBestaetigt), "Drei PCs autorisiert");
  assert.equal(new Set(pcs.map(pc => pc.raeume.geraetId)).size, 3);
  pcs[0].raeume.teilen({ key, url: serie, title: "Avatar - Die sieben Häfen",
    providerName: "S.to", type: "serie", season: 1, episode: 2 }, room);
  await warten(() => pcs.every(pc => pc.context.watchpartyShared.length), "Titel auf drei PCs");
  for (const pc of pcs) pc.raeume.beitreten(key, room);
  await warten(() => pcs.every(pc => pc.context.watchpartyShared[0]?.joined), "Drei Mitglieder");
  for (const pc of pcs) pc.melden();
  await warten(() => pcs.every(pc => pc.stand?.members.length === 3), "Drei PCs in jeder Teilnehmerleiste");
  pcs[0].raeume.steuernMitAdresse(key, "play", 12, pcs[0].context.spielerLauf.url, room);
  await warten(() => pcs.every(pc => pc.prepares.length === 1), "Drei passende Player-Vorbereitungen");
  pcs[0].bereit(); pcs[1].bereit();
  await Promise.all(pcs.map(pc => pc.quittung()));
  assert.ok(pcs.every(pc => pc.starts.length === 0), "Echter dritter wartender Player bleibt erwartet");
  // Ein wiederholter Beitritt auf derselben Verbindung darf ein schon
  // bestaetigtes Ready nicht rueckgaengig machen. Der Client verwirft eine
  // identische Vorbereitung korrekt als veraltet.
  pcs[1].raeume.beitreten(key, room);
  await pcs[1].quittung();
  pcs[2].bereit();
  await warten(() => pcs.every(pc => pc.starts.length === 1), "Gemeinsamer Start trotz doppeltem Beitritt");
  await Promise.all(pcs.map(pc => pc.quittung()));
  assert.ok(pcs.every(pc => pc.starts.length === 1), "Genau ein Start je PC");
  pcs[0].raeume.steuernMitAdresse(key, "pause", 12, pcs[0].context.spielerLauf.url, room);
  await pcs[0].quittung();
  pcs[0].context.spielerLauf.url = folge("https://serienstream.cx");
  pcs[0].melden();
  await pcs[0].quittung();
  pcs[0].raeume.steuernMitAdresse(key, "play", 12, pcs[0].context.spielerLauf.url, room);
  await warten(() => pcs.every(pc => pc.prepares.length === 2), "Neue Vorbereitung mit serienstream.cx");
  pcs[0].bereit(); pcs[1].bereit();
  await Promise.all(pcs.map(pc => pc.quittung()));
  assert.ok(pcs.every(pc => pc.starts.length === 1), "Fehlendes Ready darf nicht stillschweigend entfernt werden");
  pcs[2].raeume.verlassen(key, room);
  await warten(() => pcs.slice(0, 2).every(pc => pc.starts.length === 2), "Echtes Leave gibt die zweite Runde frei");
  await Promise.all(pcs.map(pc => pc.quittung()));
  assert.equal(pcs[2].starts.length, 1, "Ausgetretener PC bekommt keinen neuen Start");
  console.log("OK 3 Desktop-Clients: serienstream.to/s.to/gespeicherte IP, drei Live-Teilnehmer, echtes Ready, doppelter Beitritt, genau ein Start");
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => { for (const pc of clients) pc.raeume.konfigurieren({ enabled: false, rooms: [] }); });
