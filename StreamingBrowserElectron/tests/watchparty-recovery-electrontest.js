"use strict";

// Node coordinator: production relay, Main, player and IPC, three hidden apps,
// isolated profiles. Only provider/hoster/media are local fixtures. The 90s
// product deadline is real; no application clock or configuration is changed.
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), net = require("node:net");
const { spawn } = require("node:child_process");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-recovery-three-pc-"));
const room = "avatar-recovery-three-pc", key = "serie:avatardiesiebenhafen";
const target = "http://serienstream.to/serie/avatar-die-sieben-hafen/staffel-1/episode-2";
const clients = [];
const sourceDeadline = 90000;
let relay, requestId = 0, stage = "startup";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 30000) {
  stage = label;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await pause(100); }
  throw Error("Timeout: " + label);
}
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve)); return port;
}
function client(index, relayUrl) {
  const config = { profile: path.join(root, "pc" + index), name: "PC " + index, room, relay: relayUrl,
    origin: ["http://serienstream.to", "http://serienstream.cx", "http://186.2.175.5"][index - 1],
    hidden: true, observeRecovery: true };
  fs.mkdirSync(config.profile, { recursive: true });
  const child = spawn(require("electron"), [path.join(__dirname, "watchparty-drei-pc-client.js")], {
    windowsHide: true, env: { ...process.env, ELFIX_THREE_PC_CONFIG: JSON.stringify(config) },
    stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const pending = new Map();
  const log = fs.createWriteStream(path.join(root, `pc${index}.log`));
  child.stdout.pipe(log); child.stderr.pipe(log);
  const api = { child, config, ready: false, call(action, code, extras = {}) {
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      const timer = setTimeout(() => { pending.delete(id); reject(Error(`PC ${index}: ${action} timed out`)); }, 20000);
      pending.set(id, { resolve, reject, timer }); child.send({ id, action, code, ...extras });
    });
  }, shell(code) { return this.call("shell", code); }, player(code) { return this.call("player", code); } };
  child.on("message", message => {
    if (message.ready) api.ready = true;
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id); clearTimeout(task.timer);
    if (message.error) task.reject(Error(message.error)); else task.resolve(message.result);
  });
  child.on("exit", code => {
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(Error(`PC ${index} exited: ${code}`)); }
    pending.clear(); log.end();
  });
  clients.push(api); return api;
}
const readPlayer = pc => pc.player(`({at:Date.now(),time:bild.currentTime,paused:bild.paused,ready:bild.readyState,
  waiting:rundeWarten,src:bild.currentSrc,inParty:inRunde,
  episode:Number(bild.currentSrc.match(/fixture-([0-9]+)/)?.[1]),members:document.getElementById('runde').childElementCount,
  edition:fassungWahl.value,job:auftrag?.id || null,
  preparation:{visible:!document.getElementById('vorbereitung').hidden,
    text:document.getElementById('vorbereitungListe').textContent,title:document.getElementById('vorbereitungTitel').textContent}})`);
const fixtures = () => Promise.all(clients.map(pc => pc.call("fixture-status")));
const events = (fixture, direction, type) => fixture.protocolEvents.filter(e => e.direction === direction && e.message.type === type);
const received = (fixture, type) => events(fixture, "received", type);
const sent = (fixture, type) => events(fixture, "sent", type);
const episode2 = request => /\/r\?t=2(?:&|$)/.test(request.url);
function assertNoRecovery(fixtures) {
  assert.ok(fixtures.every(f => received(f, "syncrecover").length === 0), "No recovery before the relay source deadline");
}
async function main() {
  const port = await freePort();
  fs.mkdirSync(path.join(root, "relay"));
  relay = spawn(process.execPath, [path.resolve(__dirname, "../../sync-server/server.js")], {
    windowsHide: true, env: { ...process.env, PORT: String(port), STATE_DIRECTORY: path.join(root, "relay") },
    stdio: ["ignore", "pipe", "pipe"] });
  const relayLog = fs.createWriteStream(path.join(root, "relay.log"));
  relay.stdout.pipe(relayLog); relay.stderr.pipe(relayLog);
  await until(async () => { try { return (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch { return false; } }, "relay");
  const pcs = [1, 2, 3].map(index => client(index, `ws://127.0.0.1:${port}`));
  await until(() => pcs.every(pc => pc.ready), "three hidden application shells");
  await until(async () => (await Promise.all(pcs.map(pc => pc.shell("streamingBrowser.getWatchpartyStatus()")))).every(s => s.connected), "three relay connections");
  await until(async () => (await Promise.all(pcs.map(pc => pc.shell("streamingBrowser.getWatchpartyItems()"))))
    .every(items => items.find(item => item.key === key)?.joined), "existing saved memberships");
  // Exercise the persisted card route in the real shell, without a test join.
  await Promise.all(pcs.map(pc => pc.shell(`(async () => {
    await openFavoriteEntry(favorites.find(f => f.id === 'avatar-party'),{autoplay:true}); return true;
  })()`)));
  await until(async () => (await Promise.all(pcs.map(readPlayer)))
    .every(p => p?.ready >= 3 && p.inParty && p.members === 3), "all three original episode players in the saved room");
  await pcs[0].shell(`streamingBrowser.resyncWatchparty(${JSON.stringify(key)},'${room}')`);
  await until(async () => (await Promise.all(pcs.map(readPlayer))).every(p => p && !p.waiting && p.paused), "initial synchronization settles");
  await pcs[0].player("spielenUmschalten()");
  await until(async () => (await Promise.all(pcs.map(readPlayer))).every(p => p && !p.paused && !p.waiting), "initial shared playback");
  const editions = (await Promise.all(pcs.map(readPlayer))).map(p => p.edition);
  assert.ok(editions.every(Boolean), "Fixture has an actual selected edition");
  await pcs[2].call("source-fault", undefined, { episode: 2,
    mode: process.env.ELFIX_RECOVERY_SOURCE_FAULT || "never-source", releaseOnRecovery: true });
  const changed = await pcs[1].player(`bruecke.wechseln(${JSON.stringify(target)})`);
  assert.equal(changed.wartetAufRunde, true, "Episode selection enters the real shared barrier");
  await until(async () => (await fixtures())[2].sourceFault.failures > 0, "PC3 really receives a hoster source failure");
  await until(async () => (await Promise.all(pcs.slice(0, 2).map(readPlayer)))
    .every(p => p?.episode === 2 && p.ready >= 3 && p.paused && p.waiting), "ready PC1 and PC2 wait for source-less PC3");
  await until(async () => (await Promise.all(pcs.map(readPlayer))).every(p => p?.preparation.visible
    && p.preparation.text.includes("PC 3") && /PC 3[^]*?(sucht eine Quelle|Bestätigung|Fehler|fehlgeschlagen|gescheitert|nicht)/i.test(p.preparation.text)),
  "every real player identifies PC3 and its blocked source state");
  const before = await fixtures();
  assertNoRecovery(before);
  const preparations = before.map(f => received(f, "syncprepare").find(e => e.message.reason === "episode-change"));
  assert.ok(preparations.every(Boolean), "Every participant received the episode-change preparation");
  const original = preparations[0].message;
  assert.equal(original.episodeId, "s1e2", "The elected target is episode 2");
  assert.ok(preparations.every(e => e.message.syncId === original.syncId));
  assert.ok(before[2].mediaRequests.every(r => !/fixture-2\.mp4/.test(r.url)), "PC3 has no episode2 media source before recovery");
  // Continue to check the barrier while the actual server deadline elapses.
  console.log("Waiting for the production 90-second source deadline; PC3 has no source.");
  stage = "real 90-second deadline";
  while (Date.now() < original.at + sourceDeadline - 2000) {
    assertNoRecovery(await fixtures());
    const players = await Promise.all(pcs.slice(0, 2).map(readPlayer));
    assert.ok(players.every(p => p.episode === 2 && p.paused && p.waiting && p.inParty), "No early playback, old episode or private fallback");
    await pause(1000);
  }
  await until(async () => (await fixtures()).every(f => received(f, "syncrecover").length === 1), "exactly one recovery per PC after deadline", 20000);
  const expectedRecoveryId = received((await fixtures())[0], "syncrecover")[0].message.syncId;
  await until(async () => (await fixtures()).every(f => received(f, "syncstart")
    .some(e => e.message.syncId === expectedRecoveryId)), "one shared recovery start message", 50000);
  for (const fixture of await fixtures()) {
    const start = received(fixture, "syncstart").find(e => e.message.syncId === expectedRecoveryId).message;
    for (const field of ["url", "episodeId", "position"]) {
      assert.equal(start[field], original[field], `Recovery start preserves original target ${field}`);
    }
  }
  await until(async () => (await Promise.all(pcs.map(readPlayer)))
    .every(p => p?.episode === 2 && p.ready >= 3 && !p.paused && !p.waiting && p.inParty), "all three restart the same episode after sequential recovery", 50000);
  const after = await fixtures();
  const recoveries = after.map(f => received(f, "syncrecover")[0]);
  const recoveryId = recoveries[0].message.syncId;
  assert.notEqual(recoveryId, original.syncId, "Recovery owns a fresh generation");
  // The same local relay stamps both messages. Renderer/Main scheduling can
  // delay delivery by seconds, so receipt-to-receipt time is not the deadline.
  assert.ok(recoveries[0].message.at - original.at >= sourceDeadline - 10, "Recovery respects the relay source deadline");
  for (let i = 0; i < pcs.length; i++) {
    const fixture = after[i], recovery = recoveries[i].message;
    assert.equal(received(fixture, "syncrecover").length, 1);
    assert.equal(sent(fixture, "leave").length, 0, "Technical recovery never removes a saved room membership");
    for (const field of ["position", "frameTime", "url", "episodeId", "hostId", "tempo"]) {
      assert.equal(recovery[field], original[field], `PC${i + 1} recovery preserves ${field}`);
    }
    assert.equal(recovery.phase, "leave"); assert.equal(recovery.syncId, recoveryId);
    const ack = fixture.playerEvents.filter(e => e.channel === "spieler:neustart-bereit" && e.syncId === recoveryId);
    assert.equal(ack.length, 1, "One real renderer reset acknowledgement");
    assert.ok(ack[0].senderUrl.endsWith("/spieler.html"));
    assert.ok(ack[0].state && !ack[0].state.auftragId && !ack[0].state.src && ack[0].state.paused,
      `Renderer acknowledged only after clearing its actual source: ${JSON.stringify(ack)}`);
    const left = sent(fixture, "syncrecoverleft").filter(e => e.message.syncId === recoveryId);
    assert.equal(left.length, 1); assert.ok(left[0].at >= ack[0].at);
    const prepare = received(fixture, "syncprepare").filter(e => e.message.syncId === recoveryId);
    assert.equal(prepare.length, 1); assert.equal(prepare[0].message.recovery, true);
    for (const event of [...received(fixture, "syncprepare"), ...received(fixture, "syncstart")]
      .filter(e => [original.syncId, recoveryId].includes(e.message.syncId))) {
      assert.equal(event.message.episodeId, "s1e2", "Every preparation and start keeps episode 2");
      for (const field of ["url", "position", "frameTime", "hostId", "tempo"]) {
        assert.equal(event.message[field], original[field], `Every preparation/start preserves target ${field}`);
      }
    }
    const loads = fixture.fixtureRequests.filter(r => episode2(r) && r.at >= recoveries[i].at);
    assert.ok(loads.length > 0, `PC${i + 1} performs a fresh hoster request after reset`);
    assert.ok(loads[0].at >= prepare[0].at);
    const ready = sent(fixture, "syncready").filter(e => e.message.syncId === recoveryId);
    assert.equal(ready.length, 1); assert.notEqual(ready[0].message.ok, false);
    assert.ok(ready[0].at >= loads[0].at);
    const start = received(fixture, "syncstart").filter(e => e.message.syncId === recoveryId);
    assert.equal(start.length, 1); assert.ok(start[0].at >= ready[0].at);
    assert.equal(start[0].message.position, original.position);
    assert.equal(start[0].message.episodeId, original.episodeId);
  }
  const ordered = after.map((f, i) => ({ index: i,
    prepare: received(f, "syncprepare").find(e => e.message.syncId === recoveryId),
    load: f.fixtureRequests.find(r => episode2(r) && r.at >= recoveries[i].at),
    ready: sent(f, "syncready").find(e => e.message.syncId === recoveryId) }))
    .sort((a, b) => a.prepare.at - b.prepare.at);
  const allLeftAt = Math.max(...after.map(f => sent(f, "syncrecoverleft").find(e => e.message.syncId === recoveryId).at));
  assert.ok(ordered[0].prepare.at >= allLeftAt, "First rejoin waits for all three genuine renderer reset acknowledgements");
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(ordered[i].prepare.at >= ordered[i - 1].ready.at, "Next participant prepares only after previous real readiness");
    assert.ok(ordered[i].load.at >= ordered[i - 1].ready.at, "Fresh hoster requests are sequential, not just protocol messages");
  }
  const starts = after.map(f => received(f, "syncstart").find(e => e.message.syncId === recoveryId).message);
  assert.ok(starts.every(s => s.startAt === starts[0].startAt && s.sequenceId === starts[0].sequenceId), "One common future start for all three");
  const playing = await Promise.all(pcs.map(readPlayer));
  assert.ok(Math.max(...playing.map(p => p.time)) - Math.min(...playing.map(p => p.time)) < 1, JSON.stringify(playing));
  assert.deepEqual(playing.map(p => p.edition), editions, "Selected edition survives reset and fresh source resolution");
  assert.ok(playing.every(p => p.members === 3 && p.inParty && p.episode === 2));
  assert.ok((await Promise.all(pcs.map(pc => pc.shell("streamingBrowser.getWatchpartyItems()"))))
    .every(items => items.find(item => item.key === key)?.joined), "Recovery preserves existing room membership");
  await until(async () => (await Promise.all(pcs.map(readPlayer))).every(p => !p.preparation.visible),
    "successful shared start dismisses preparation on all three real players");
  const settledPlayers = await Promise.all(pcs.map(readPlayer));
  await pause(6000);
  assert.ok((await fixtures()).every(f => received(f, "syncrecover").length === 1), "Successful recovery never starts a retry loop");
  const evidence = { original, recoveryId, recoveryDelayMs: recoveries[0].message.at - original.at,
    order: ordered.map(o => ({ pc: o.index + 1, prepare: o.prepare.at, sourceRequest: o.load.at, ready: o.ready.at })),
    players: playing, settledPlayers, fixtures: after };
  fs.writeFileSync(path.join(root, "recovery-evidence.json"), JSON.stringify(evidence, null, 2));
  console.log("OK Three real hidden Electron apps: named source failure, real90s deadline, renderer resets, sequential fresh hoster requests, shared start, preserved episode/position/edition/membership and no retry loop.");
  console.log("Evidence:", root);
}
main().catch(async error => {
  console.error(error.stack); console.error("Diagnostics:", root);
  const diagnostics = { stage, players: await Promise.allSettled(clients.map(readPlayer)),
    clients: await Promise.allSettled(clients.map(pc => pc.call("diagnostics"))),
    pages: await Promise.allSettled(clients.map(pc => pc.call("diagnostic-pages"))) };
  for (const results of [diagnostics.players, diagnostics.clients, diagnostics.pages]) {
    for (const result of results) if (result.status === "rejected") result.reason = String(result.reason?.stack || result.reason);
  }
  fs.writeFileSync(path.join(root, "diagnostics.json"), JSON.stringify(diagnostics, null, 2));
  console.error(JSON.stringify(diagnostics, null, 2)); process.exitCode = 1;
}).finally(async () => {
  for (const pc of clients) if (pc.child.connected) pc.child.send({ action: "quit" });
  await Promise.all(clients.map(pc => pc.child.exitCode !== null ? Promise.resolve() : new Promise(resolve => {
    const timer = setTimeout(() => { pc.child.kill(); resolve(); }, 3000);
    pc.child.once("exit", () => { clearTimeout(timer); resolve(); });
  })));
  relay?.kill();
});
