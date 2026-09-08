"use strict";

// Der Player-Chat gehoert zum aktiv geoeffneten Raum-Eintrag. Das gilt auch,
// wenn nur dieses eine Geraet darin ist, und muss nach jedem neuen Auftrag des
// weiterverwendeten Players neu gemeldet werden.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const taste = require("../src/taste");

const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
function funktion(name) {
  const start = main.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} fehlt`);
  return main.slice(start, main.indexOf("\n}", start) + 2);
}

const folge = (nummer) => `https://aniworld.to/anime/stream/bleach/staffel-1/episode-${nummer}`;
const raumFavorit = {
  id: "raum-favorit", providerId: "aniworld", title: "Bleach",
  url: folge(1), watchpartyRoom: "gummikaese"
};
const privatFavorit = {
  id: "privat-favorit", providerId: "aniworld", title: "Bleach",
  url: folge(1), watchpartyRoom: ""
};
const raumEintrag = {
  key: "serie:bleach", room: "gummikaese", url: folge(1), joined: true,
  // Absichtlich genau ein Mitglied: der Chat ist eine Raumfunktion und keine
  // Teilnehmerleiste, deshalb darf seine Freigabe nicht an > 1 haengen.
  members: [{ id: "ich", name: "Ich" }]
};
const kontext = vm.createContext({
  activeFavoriteId: raumFavorit.id,
  favorites: [privatFavorit, raumFavorit],
  spielerLauf: { url: folge(1) },
  watchpartyShared: [raumEintrag],
  watchpartyLiveAus: new Set(),
  watchpartyChatNachrichten: new Map([["gummikaese", [{ id: "1", text: "Hallo" }]]]),
  watchparty: {
    aktiv: true,
    status: () => ({ rooms: [{ room: "gummikaese", connected: true }] })
  },
  taste,
  youtubeModusGiltFuer: () => false
});
vm.runInContext([
  "liveMerker", "watchpartyLiveAktiv", "aktiverWatchpartyRaum",
  "watchpartyRaeumeForUrl", "watchpartyRaumForUrl", "watchpartySerieForUrl",
  "watchpartyLiveKeyForUrl", "watchpartyEintrag", "spielerRunde", "spielerChatStatus"
].map(funktion).join("\n"), kontext);

assert.deepEqual({ ...kontext.spielerRunde() }, {
  key: "serie:bleach", raum: "gummikaese", adresse: folge(1)
}, "Solo-Raum wurde nicht an den Player weitergereicht");
assert.deepEqual({ ...kontext.spielerChatStatus(), messages: [...kontext.spielerChatStatus().messages] }, {
  active: true, room: "gummikaese", connected: true,
  messages: [{ id: "1", text: "Hallo" }]
});

// Der Raum haengt am aktiven Favoriten und an der Serie, nicht an einer
// einzelnen Folge. Ein Folgenwechsel behaelt ihn, ein privater Einstieg loest
// ihn sofort.
kontext.spielerLauf.url = folge(2);
assert.equal(kontext.spielerRunde()?.raum, "gummikaese", "Folgenwechsel verlor den aktiven Raum");
kontext.activeFavoriteId = privatFavorit.id;
assert.equal(kontext.spielerRunde(), null, "Privater Favorit erbte den Raum-Chat");

// Der Einstieg aus "Gemeinsam weiterschauen" macht genau den Favoriten dieser
// Runde aktiv. Ohne diesen Schritt waere der Raum zwar beigetreten, der Player
// wuerde aber absichtlich im privaten Zustand bleiben.
const einstieg = vm.createContext({
  activeFavoriteId: privatFavorit.id,
  activeView: {},
  favorites: [privatFavorit, raumFavorit],
  watchpartyEintrag: () => raumEintrag,
  providerForWatchpartyUrl: () => ({ id: "aniworld" }),
  merkeWatchpartySprung: () => {},
  lokalerWatchpartyEintrag: (key, room) => key === raumEintrag.key && room === raumEintrag.room
    ? raumFavorit : null,
  createWatchpartyFavorite: () => null,
  moveFavoriteToFront: () => {},
  recordMediaActivity: () => {},
  repairFavoriteThumbnailIfNeeded: async () => false,
  beginAutostart: async () => {},
  cleanTitle: (text) => text,
  navigateProvider: async () => {},
  scheduleProviderAutoplay: () => {},
  activeState: () => ({})
});
vm.runInContext(funktion("openWatchpartyItem"), einstieg);

// Ein bestehender WebContentsView wird fuer den naechsten Auftrag
// weiterverwendet. Genau dieser Pfad muss den neu berechneten Chatstatus senden.
const taten = [];
const wiederverwendung = vm.createContext({
  spielerView: { webContents: {
    isDestroyed: () => false,
    send: (kanal) => taten.push(kanal)
  } },
  mainWindow: { isDestroyed: () => false },
  spielerLaufSetzen: () => taten.push("lauf-setzen"),
  spielerAuftrag: () => ({ id: 2 }),
  sendSpielerChatStatus: () => taten.push("chat-status"),
  direktVollbildAnwenden: () => {},
  spielerNaechsteNachtragen: () => Promise.resolve()
});
vm.runInContext(funktion("direktSpielerOeffnen"), wiederverwendung);
(async () => {
  await einstieg.openWatchpartyItem(raumEintrag.key, raumEintrag.room);
  assert.equal(einstieg.activeFavoriteId, raumFavorit.id,
    "Gemeinsamer Einstieg aktivierte seinen Raum-Favoriten nicht");

  const offen = await wiederverwendung.direktSpielerOeffnen(
    { id: "aniworld" }, folge(2), { quelle: {} }, { laden: true }
  );
  assert.equal(offen, true);
  assert.deepEqual(taten, ["lauf-setzen", "spieler:auftrag", "chat-status"]);
  console.log("OK Player-Chat: Solo-Raum, aktiver Favorit und Status bei Quellenwechsel");
})().catch((fehler) => {
  console.error(fehler);
  process.exitCode = 1;
});
