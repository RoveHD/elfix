"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const watchpartySync = require("../src/watchparty-sync");

const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");

function source(name) {
  const match = main.match(new RegExp(`(?:async )?function ${name}\\([^]*?^}`, "m"));
  assert.ok(match, `${name} fehlt`);
  return match[0];
}

const handlers = new Map();
const leaves = [];
const heartbeats = [];
const liveStates = [];
let uuidCalls = 0;

const url = "https://aniworld.example/anime/stream/serie/staffel-1/episode-2";
const favorite = { id: "party-favorite", url, watchpartyRoom: "RUNDE" };
const roomItem = {
  key: "serie-key", room: "RUNDE", url, joined: true,
  hostId: "device-a", myId: "device-a", hostName: "Host"
};
const playerContents = { isDestroyed: () => false };
const providerContents = {
  isDestroyed: () => false,
  getURL: () => url,
  setAudioMuted() {}
};
const providerView = { webContents: providerContents };
const playerView = {
  webContents: playerContents,
  setVisible() {},
  setBounds() {}
};
const mainWindow = {
  isDestroyed: () => false,
  isMinimized: () => false,
  getContentSize: () => [1200, 800],
  contentView: { removeChildView() {} },
  webContents: { send() {} }
};

const context = vm.createContext({
  watchpartySync,
  activeView: providerView,
  activeProviderId: "provider-a",
  activeFavoriteId: favorite.id,
  attachedProviderViews: new Set(["provider-a"]),
  browserBounds: { x: 0, y: 0, width: 1200, height: 800 },
  clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  crypto: { randomUUID: () => `session-${++uuidCalls}` },
  episodeIdentity: () => ({ season: 1, episode: 2 }),
  favorites: [favorite],
  ipcMain: { on: (name, callback) => handlers.set(name, callback) },
  isContentFullscreen: false,
  isLiveView: (view) => Boolean(view && !view.webContents.isDestroyed()),
  leaveContentFullscreen() {},
  mainWindow,
  optionaleCachesNachMiniPlanen() {},
  overlayReasons: new Set(),
  pauseActivePlayback() {},
  providerViews: new Map([["provider-a", providerView]]),
  sendWatchpartyLive: (state) => liveStates.push(state),
  setOverlayOpen() {},
  settings: { playback: { pauseOnMinimize: true } },
  spielerAutoMiniAusstehend: null,
  spielerLauf: { id: 17, providerId: "provider-a", url },
  spielerMiniAktiv: false,
  spielerMiniVorbereitung: false,
  spielerView: playerView,
  spoilerAbschluesseMelden() {},
  taste: { urlSchluessel: () => "serie-key" },
  watchparty: {
    aktiv: true,
    verbunden: true,
    geraetId: "device-a",
    status: () => ({ rooms: [{ room: "RUNDE", connected: true }] }),
    verlasseStand: (key, room) => leaves.push({ key, room }),
    meldeStand: (key, state, room) => heartbeats.push({ key, state, room })
  },
  watchpartyAnwesend: { key: "serie-key", raum: "RUNDE" },
  watchpartyLiveAus: new Set(),
  watchpartyShared: [roomItem],
  watchpartySitzung: new Map(),
  youtubeModusGiltFuer: () => false
});

for (const name of [
  "watchpartyEintrag", "liveMerker", "watchpartyLiveAktiv", "aktiverWatchpartyRaum",
  "watchpartyRaeumeForUrl", "watchpartyRaumForUrl", "watchpartySerieForUrl",
  "watchpartyLiveKeyForUrl", "pushWatchpartyLiveState", "sendActiveState",
  "spielerMiniBehalten", "spielerLageSetzen", "enterHomeMode", "vomSpieler",
  "spielerRunde", "spielerRundenEinstellung", "watchpartySitzungFuer",
  "meldeWatchpartyStandAusSpieler"
]) vm.runInContext(source(name), context);

const miniStart = main.indexOf('ipcMain.on("spieler:mini-status",');
assert.ok(miniStart >= 0, "Mini-Status-Handler fehlt");
vm.runInContext(main.slice(miniStart, main.indexOf("\n});", miniStart) + 4), context);

const sender = { sender: playerContents };
const playerRun = context.spielerLauf;
const sessionBefore = context.watchpartySitzungFuer("provider-a");
assert.equal(context.spielerRundenEinstellung().binHost, true, "Hoststatus vor PiP");
context.meldeWatchpartyStandAusSpieler(23, false, 1000);

handlers.get("spieler:mini-status")(sender, true, false);

assert.equal(context.spielerMiniAktiv, true, "PiP ist aktiv");
assert.equal(context.spielerLauf, playerRun, "derselbe Player-Lauf bleibt erhalten");
assert.equal(context.spielerView, playerView, "dieselbe Player-View bleibt erhalten");
assert.equal(context.activeFavoriteId, favorite.id, "dieselbe Watchparty-Rundenzuordnung bleibt erhalten");
assert.equal(context.watchpartyAnwesend?.key, "serie-key", "Anwesenheit bleibt am Titel");
assert.equal(context.watchpartyAnwesend?.raum, "RUNDE", "Anwesenheit bleibt im Raum");
assert.deepEqual(leaves, [], "PiP darf keine Presence-Abmeldung senden");
assert.equal(context.watchparty.geraetId, "device-a", "deviceId bleibt erhalten");
assert.equal(context.spielerRundenEinstellung().binHost, true, "Host bleibt im PiP Host");

context.meldeWatchpartyStandAusSpieler(24, false, 2000);
assert.equal(heartbeats.length, 2, "Presence-Takt läuft im PiP weiter");
assert.equal(heartbeats[0].state.playerSessionId, sessionBefore);
assert.equal(heartbeats[1].state.playerSessionId, sessionBefore, "Player-Session bleibt im PiP gleich");
assert.equal(uuidCalls, 1, "PiP erzeugt keine neue Session und keinen Ghost");

handlers.get("spieler:mini-status")(sender, false, false);
assert.equal(context.spielerMiniAktiv, false, "PiP ist wieder aus");
assert.equal(context.spielerLauf, playerRun, "Rückkehr baut den Player nicht neu");
assert.equal(context.activeFavoriteId, favorite.id, "Rückkehr behält dieselbe Runde");
assert.deepEqual(leaves, [], "auch die Rückkehr meldet keinen Leave");
assert.equal(liveStates.at(-1).active, false, "Startseiten-Bedienung bleibt im PiP ausgeblendet");

console.log("OK Miniplayer-Presence: gleiche Runde, deviceId, Session und Host; kein Leave/Reconnect/Ghost");
