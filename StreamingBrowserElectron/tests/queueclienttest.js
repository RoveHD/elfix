"use strict";

const assert = require("assert");
const { Watchparty } = require("../src/watchparty");
const { WatchpartyRaeume } = require("../src/watchparty-raeume");
const { YoutubeWatchparty } = require("../src/youtube-watchparty");

const queueEvents = [];
const spoilerEvents = [];
const stateEvents = [];
const normal = new Watchparty({
  onQueue: (wert) => queueEvents.push(wert),
  onSpoiler: (wert) => spoilerEvents.push(wert),
  onState: (wert) => stateEvents.push(wert)
});
normal.raum = "runde";
normal.aktiv = true;
normal.verbunden = true;
normal.identitaetBestaetigt = true;
normal.geraetId = "ich";
normal.nachrichtVerarbeiten(JSON.stringify({
  type: "queue:state", room: "runde", rev: 2, selectedId: "q1",
  items: [{ id: "q1", kind: "title", key: "serie:test", url: "https://example.test/s2/e5",
    title: "Test", votes: 2, voted: true, mine: false }]
}));
assert.equal(normal.queueStatus().items[0].key, "serie:test");
assert.equal(queueEvents[0].type, "queue:state");
normal.nachrichtVerarbeiten(JSON.stringify({
  type: "queue:start", room: "runde", startId: "start-1", fromKey: "serie:alt",
  targetKey: "serie:test", item: { id: "q1", key: "serie:test", url: "https://example.test/s2/e5" }
}));
assert.equal(queueEvents[1].startId, "start-1");
assert.equal(normal.eintraege()[0].key, "serie:test", "erstes Queue-Ziel fehlte auf der synchronen Leseflaeche");
assert.equal(normal.eintraege()[0].progress.url, "https://example.test/s2/e5");
assert.equal(normal.eintraege()[0].joined, true);
assert.equal(stateEvents.length, 0, "provisorisches Ziel wurde als autoritativer Zustand gemeldet");
normal.nachrichtVerarbeiten(JSON.stringify({
  type: "queue:cancel", room: "runde", startId: "start-1", reason: "start-failed",
  fromKey: "serie:alt", targetKey: "serie:test"
}));
assert.equal(queueEvents[2].type, "queue:cancel");
assert.equal(queueEvents[2].targetKey, "serie:test");
assert.equal(normal.eintraege().length, 0, "Cancel liess ein provisorisches Queue-Ziel zurueck");

normal.geteilt = [{
  key: "serie:test", url: "https://example.test/s1/e1", title: "Alt",
  season: 1, episode: 1, memberIds: ["ich"], members: ["Ich"],
  progress: { url: "https://example.test/s1/e1", season: 1, episode: 1, position: 44 }
}];
normal.nachrichtVerarbeiten(JSON.stringify({
  type: "queue:start", room: "runde", startId: "start-2", fromKey: "serie:alt",
  targetKey: "serie:test", item: { id: "q1", key: "serie:test", url: "https://example.test/s2/e5",
    title: "Neu", season: 2, episode: 5 }
}));
assert.equal(normal.eintraege()[0].progress.url, "https://example.test/s2/e5",
  "vorhandenes Ziel wurde auf der Leseflaeche nicht ueberblendet");
assert.equal(normal.serverEintraege()[0].progress.url, "https://example.test/s1/e1",
  "Overlay mutierte den bestaetigten alten Titel");
normal.nachrichtVerarbeiten(JSON.stringify({
  type: "queue:cancel", room: "runde", startId: "start-2", reason: "start-failed",
  fromKey: "serie:alt", targetKey: "serie:test"
}));
assert.equal(normal.eintraege()[0].progress.url, "https://example.test/s1/e1",
  "Cancel stellte den alten bestaetigten Titel nicht wieder her");

const multiStates = [];
const multi = new WatchpartyRaeume({ onState: entries => multiStates.push(entries) });
const roomA = multi.raumAnlegen("raum-a");
const roomB = multi.raumAnlegen("raum-b");
multi.raeume.set("raum-a", roomA);
multi.raeume.set("raum-b", roomB);
Object.assign(roomA, {
  raum: "raum-a", aktiv: true, verbunden: true, identitaetBestaetigt: true,
  geraetId: "multi-a", name: "A", deviceSecret: "secret-a"
});
Object.assign(roomB, {
  raum: "raum-b", aktiv: true, verbunden: true, identitaetBestaetigt: true,
  geraetId: "multi-b", name: "B", deviceSecret: "secret-b"
});
roomA.nachrichtVerarbeiten(JSON.stringify({
  type: "queue:start", room: "raum-a", startId: "multi-start", targetKey: "serie:neu",
  item: { id: "multi-item", key: "serie:neu", url: "https://example.test/new", title: "Neu" }
}));
assert.equal(multi.eintraege().some(entry => entry.key === "serie:neu" && entry.joined), true,
  "Raumfassade blendete das Queue-Ziel nicht auf ihrer Leseflaeche ein");
roomB.nachrichtVerarbeiten(JSON.stringify({
  type: "state", identityVersion: 2, you: "multi-b", peers: [], shared: [{
    key: "serie:b", url: "https://example.test/b", title: "B", memberIds: ["multi-b"], members: ["B"]
  }]
}));
assert.equal(multiStates.at(-1).some(entry => entry.key === "serie:neu"), false,
  "Zustand eines anderen Raums persistierte ein provisorisches Queue-Ziel");
normal.nachrichtVerarbeiten(JSON.stringify({
  type: "spoilerstate", room: "runde", key: "serie:alt", known: true,
  completed: [[1, 1], [1, 2]], unknownCount: 0
}));
assert.deepEqual(spoilerEvents[0].completed, [[1, 1], [1, 2]]);

const gesendet = [];
normal.socket = { readyState: 1, send: (wert) => gesendet.push(JSON.parse(wert)) };
assert.equal(normal.queueAdvance("q1", "serie:alt"), true);
assert.equal(normal.queueStarted("start-1", true), true);
assert.equal(normal.spoilerMelden("serie:alt", null), true);
assert.deepEqual(gesendet.map((wert) => wert.type), ["queue:advance", "queue:started", "spoilerstate"]);
normal.socket = null;
assert.equal(normal.queueVote("q1", true), false, "offline Queue-Befehl wurde angenommen");

const ytEvents = [];
const ytOut = [];
const yt = new YoutubeWatchparty({
  onQueue: (wert) => ytEvents.push(wert),
  senden: (_room, wert) => { ytOut.push(wert); return true; }
});
yt.raum = "runde";
yt.verbunden = true;
yt.beigetreten = true;
yt.geraetId = "ich";
yt.nachricht({
  type: "ytqueue:state", room: "runde", rev: 1, selectedId: "y1",
  items: [{ id: "y1", videoId: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    title: "Video", votes: 1, voted: true, mine: true }]
});
assert.equal(yt.queueStatus().items[0].videoId, "dQw4w9WgXcQ");
yt.nachricht({
  type: "ytqueue:start", room: "runde", startId: "ystart", fromVideoId: "oldVideo123",
  item: { id: "y1", videoId: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }
});
assert.equal(ytEvents[1].startId, "ystart");
yt.nachricht({
  type: "ytqueue:cancel", room: "runde", startId: "ystart",
  reason: "lease-expired", fromVideoId: "oldVideo123"
});
assert.equal(ytEvents[2].type, "ytqueue:cancel");
assert.equal(ytEvents[2].fromVideoId, "oldVideo123");
assert.equal(yt.queueStarted("ystart", true), true);
assert.equal(ytOut[0].type, "ytqueue:started");

console.log("OK Queue-Clients: Zustand, Start, Spoiler, Sendebestaetigung und YouTube-Trennung");
