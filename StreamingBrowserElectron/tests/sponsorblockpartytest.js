"use strict";

// SponsorBlock in der separaten YouTube-Runde: genau ein Teilnehmer erkennt
// und meldet den automatischen Sprung, alle anderen bekommen denselben normalen
// ytevent-Seek. Kein Teil dieses Wegs benutzt die Serien-Watchparty-Steuerung.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sponsorblock = require("../src/sponsorblock");
const { YoutubeWatchparty } = require("../src/youtube-watchparty");

const ROOM = "Bangus";
const VIDEO = "dQw4w9WgXcQ";
const members = [
  { id: "a", name: "Anna" },
  { id: "b", name: "Ben" },
  { id: "c", name: "Cem" }
];
const ausgang = [];

function client(id) {
  const party = new YoutubeWatchparty({
    senden: (room, message) => ausgang.push({ id, room, ...message }),
    serverJetzt: () => null
  });
  party.kennung(id);
  party.einschalten(ROOM);
  party.verbindung(ROOM, true);
  party.nachricht({
    type: "ytstate", room: ROOM, videoId: VIDEO,
    url: `https://www.youtube.com/watch?v=${VIDEO}`,
    position: 40, livePosition: 40, playing: true,
    updatedAt: Date.now(), rev: 1, members
  });
  return party;
}

const clients = members.map((person) => client(person.id));
ausgang.length = 0; // Die drei ytjoin-Nachrichten gehoeren nur zum Aufbau.
assert.deepEqual(clients.map((party) => party.darfSponsorblockAutomatisch()),
  [true, false, false], "mehrere Teilnehmer wollten automatisch springen");

const segment = { von: 45, bis: 72, kategorie: "sponsor", modus: "skip" };
for (const party of clients) {
  // Genau diese Entscheidung reicht main.js als `automatisch` an dasselbe
  // SponsorBlock-Skript. Nur der eine Treffer wird als YouTube-Seek gemeldet.
  const treffer = party.darfSponsorblockAutomatisch()
    ? sponsorblock.sprungFuer([segment], 46, []) : null;
  if (treffer) party.melden("seek", {
    videoId: VIDEO, position: treffer.bis, playing: true
  });
}
const seeks = ausgang.filter((message) => message.type === "ytevent" && message.action === "seek");
assert.equal(seeks.length, 1);
assert.equal(seeks[0].id, "a");
assert.equal(seeks[0].position, 72);

// Am Sprungziel erkennt auch der neue Leiter keinen weiteren Treffer. Das
// verhindert Zurueckspruenge und eine Seek-Schleife nach einem Rollenwechsel.
clients[1].mitglieder = members.slice(1);
assert.equal(clients[1].darfSponsorblockAutomatisch(), true, "Leiterwechsel blieb aus");
assert.equal(sponsorblock.sprungFuer([segment], 72, []), null);

const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
const installation = main.slice(
  main.indexOf("async function installSponsorblock("),
  main.indexOf("// --- Empfohlen fuer dich", main.indexOf("async function installSponsorblock("))
);
assert.ok(installation.includes("youtubeParty.darfSponsorblockAutomatisch()"));
assert.ok(installation.includes("automatisch:"));
assert.ok(!installation.includes("watchparty.steuern"),
  "SponsorBlock lief ueber die Serien-Watchparty-Steuerung");
assert.match(sponsorblock.skipScript([segment], { videoId: VIDEO, automatisch: false }),
  /"automatisch":false/);

console.log("OK SponsorBlock-YouTube-Runde: ein Auto-Sprung, ytevent-Sync und Leiterwechsel");
