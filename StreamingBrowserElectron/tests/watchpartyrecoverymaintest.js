"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const watchpartySync = require("../src/watchparty-sync");
const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
const episode = "https://serienstream.to/serie/avatar/staffel-1/episode-6";
const entry = { key: "sto:avatar", room: "fixture-room" };
function fixture() {
  const commands = [], sent = [], statuses = [], left = [], cancelled = [], ready = [], events = new Map();
  const wc = { isDestroyed: () => false, send: (...args) => sent.push(args) };
  const state = {
    console: { log() {} }, Date, watchpartySync,
    spielerView: { webContents: wc }, spielerLauf: { id: 12, url: episode, quelle: { adresse: "old.mp4" } },
    spielerAuftragId: 12, spielerTakt: { stelle: 29, laeuft: true },
    spielerSyncBereit: null, spielerFolgenVorbereitung: null, spielerLadeSchranke: null,
    spielerVorbereitungsAnzeige: null, spielerWiederherstellung: null, spielerWiederherstellungsGeneration: 0,
    spielerKopfzeilen: { stale: true }, spielerLetzterStand: { stale: true }, watchpartyLetztesEreignis: new Map(),
    direktLaden: new AbortController(), menschentorFenster: { abbrechen: () => { state.closedGate++; } }, closedGate: 0,
    spielerCfAbbrechen() {}, spielerRtxStop() {},
    direktAuftragBeginnen() { state.direktLaden.abort(); state.direktLaden = new AbortController(); },
    spielerRunde: () => ({ key: entry.key, raum: entry.room }),
    aktiverWatchpartyRaum: () => entry.room,
    spielerBefehl: command => commands.push(command),
    watchpartySerienSchluessel: url => String(url).split("/staffel-")[0],
    istGleicheFolge: (a, b) => a === b,
    providerModel: { isHttpUrl: url => /^https?:\/\//.test(url) },
    sanitizePositiveNumber: value => Math.max(0, Number(value) || 0),
    vomSpieler: event => event.sender === wc,
    ipcMain: { on: (channel, handler) => events.set(channel, handler) },
    watchparty: {
      vorbereitungsStatus: (...args) => statuses.push(args),
      wiederherstellungVerlassen: (...args) => left.push(args),
      wiederherstellungAbbrechen: (...args) => cancelled.push(args),
      bereitZumStart: (...args) => ready.push(args)
    }
  };
  const c = vm.createContext(state);
  const start = main.indexOf("function spielerVorbereitungSenden()");
  const end = main.indexOf("/** Die Runde,", start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(main.slice(start, end), c);
  const errorStart = main.indexOf('ipcMain.on("spieler:fehler"');
  vm.runInContext(main.slice(errorStart, main.indexOf("\n});", errorStart) + 4), c);
  const message = { ...entry, action: "syncrecover", phase: "leave", syncId: "retry-1", url: episode,
    episodeId: "s1e6", position: 29, timestamp: 2000, sequenceId: 2 };
  return { c, commands, sent, statuses, left, cancelled, ready, message,
    emit: (channel, ...args) => events.get(channel)({ sender: wc }, ...args),
    foreign: (channel, ...args) => events.get(channel)({ sender: {} }, ...args) };
}

// A reset is not a leave: room membership stays intact, while the old source
// and all async resolver callbacks become invalid before acknowledging it.
{
  const f = fixture(), old = f.c.direktLaden;
  f.c.spielerWiederherstellungBeginnen(entry, f.message);
  assert.equal(old.signal.aborted, true);
  assert.equal(f.c.spielerLauf.quelle.adresse, "");
  assert.equal(f.c.spielerLauf.id, 13);
  assert.equal(f.c.spielerTakt.laeuft, false);
  assert.equal(f.c.spielerKopfzeilen, null);
  assert.equal(f.c.spielerLetzterStand, null);
  assert.equal(f.commands.at(-1).tun, "runde-neustart");
  assert.equal(f.left.length, 0, "Wait for actual renderer teardown");
  f.foreign("spieler:neustart-bereit", "retry-1");
  f.emit("spieler:neustart-bereit", "old-id");
  assert.equal(f.left.length, 0);
  f.emit("spieler:neustart-bereit", "retry-1");
  assert.deepEqual(f.left, [[entry.key, entry.room, "retry-1"]]);
  f.c.spielerWiederherstellungBeginnen(entry, f.message);
  assert.equal(f.left.length, 2, "Reconnect can repeat a completed teardown ACK");
  assert.equal(f.c.spielerLauf.id, 13, "Duplicate recovery does not reset again");
  f.c.spielerWiederherstellung.phase = "rejoining";
  f.c.spielerWiederherstellungBeginnen(entry, f.message);
  assert.equal(f.left.length, 2, "An old leave must not acknowledge the new source");
}

// Stale generation, another room and another series cannot reset this player.
{
  const f = fixture();
  f.c.watchpartyLetztesEreignis.set(`${entry.room}|${entry.key}`, { sequenceId: 4, timestamp: 4000, episodeId: "s1e6" });
  f.c.spielerWiederherstellungBeginnen(entry, f.message);
  f.c.spielerWiederherstellungBeginnen({ ...entry, room: "other" }, { ...f.message, sequenceId: 5 });
  f.c.spielerWiederherstellungBeginnen(entry, { ...f.message, sequenceId: 5, url: episode.replace("avatar", "other") });
  assert.equal(f.commands.length, 0);
  assert.equal(f.c.direktLaden.signal.aborted, false);
}

// Confirmation replaces the player request id. Only the actual fresh player
// may complete the still-active start barrier; an old renderer error is stale.
{
  const f = fixture();
  f.c.spielerLadeSchranke = { ...entry, syncId: "source-1", url: episode, position: 29, frameTime: 29.04 };
  f.c.spielerVorbereitungMelden("confirmation-required");
  f.c.spielerVorbereitungMelden("confirmation-required");
  assert.equal(f.statuses.length, 1, "Identical status does not extend a deadline");
  f.c.spielerLauf = { id: 13, url: episode, quelle: { adresse: "fresh.mp4" } };
  f.c.spielerVorbereitungQuelleBereit();
  assert.equal(f.c.spielerSyncBereit.auftragId, 13);
  assert.equal(f.commands.at(-1).stelle, 29);
  assert.equal(f.commands.at(-1).frameTime, 29.04);
  assert.equal(f.commands.at(-1).laufen, false);
  const id = f.c.spielerSyncBereit.id;
  f.emit("spieler:fehler", "obsolete", 12);
  assert.equal(f.statuses.at(-1)[3], "video-loading");
  f.foreign("spieler:sync-bereit", id);
  f.emit("spieler:sync-bereit", "old-barrier");
  assert.equal(f.ready.length, 0);
  f.emit("spieler:sync-bereit", id);
  assert.deepEqual(f.ready, [[entry.key, entry.room, "source-1"]]);
  assert.equal(f.statuses.at(-1)[3], "ready");
  f.c.spielerVorbereitungMelden("error", "wrong episode", episode.replace("episode-6", "episode-5"));
  assert.equal(f.statuses.at(-1)[3], "ready");
  const commandCount = f.commands.length;
  f.c.spielerRunde = () => null;
  f.c.spielerVorbereitungQuelleBereit();
  assert.equal(f.commands.length, commandCount, "A source opened privately cannot rearm the former room barrier");
}

// Local status is never leaked into a different active room; cancel stops
// in-flight loading and can neither be forged nor cancel another generation.
{
  const f = fixture();
  f.c.spielerVorbereitungsAnzeige = { ...entry, phase: "preparing" };
  f.c.spielerVorbereitungSenden();
  assert.equal(f.sent.at(-1)[1].phase, "preparing");
  f.c.spielerVorbereitungsAnzeige.room = "other";
  f.c.spielerVorbereitungSenden();
  assert.equal(f.sent.at(-1)[1], null);
  f.c.spielerWiederherstellungBeginnen(entry, f.message);
  const generation = f.c.spielerWiederherstellungsGeneration;
  f.foreign("spieler:vorbereitung-abbrechen", "retry-1");
  f.emit("spieler:vorbereitung-abbrechen", "old");
  assert.equal(f.cancelled.length, 0);
  f.emit("spieler:vorbereitung-abbrechen", "retry-1");
  assert.deepEqual(f.cancelled, [[entry.key, entry.room, "retry-1"]]);
  assert.equal(f.c.direktLaden.signal.aborted, true);
  assert.equal(f.c.spielerWiederherstellungsGeneration, generation + 1);
  assert.equal(f.c.spielerWiederherstellung, null);
  assert.equal(f.commands.at(-1).laufen, false);
  f.emit("spieler:neustart-bereit", "retry-1");
  assert.equal(f.left.length, 0, "Late reset ACK cannot revive a cancelled recovery");
}
console.log("OK Watchparty Main: actual reset ACK, reconnect, generations, room boundary, confirmation handoff and cancellation");
