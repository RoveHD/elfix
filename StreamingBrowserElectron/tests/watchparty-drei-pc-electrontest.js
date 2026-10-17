"use strict";

// Run with Node. Three independent Electron processes, isolated profiles and
// an actual local relay; production UI/IPC/player and S.to-shaped fixtures.
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), net = require("node:net");
const { spawn } = require("node:child_process");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-three-pc-"));
const clients = [];
const room = "avatar-three-pc", base = "/serie/avatar-die-sieben-hafen";
let relay, requestId = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await pause(80); }
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
    origin: ["http://serienstream.to", "http://serienstream.cx", "http://186.2.175.5"][index - 1] };
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
const readPlayer = pc => pc.player(`({time:bild.currentTime,paused:bild.paused,ready:bild.readyState,
  waiting:!document.getElementById('warteAufAlle').hidden,src:bild.currentSrc,error:bild.error?.message,
  episode:Number(bild.currentSrc.match(/fixture-([0-9]+)/)?.[1]),members:document.getElementById('runde').childElementCount})`);
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
  await until(() => pcs.every(pc => pc.ready), "three app windows");
  await until(async () => (await Promise.all(pcs.map(pc => pc.shell("streamingBrowser.getWatchpartyStatus()")))).every(s => s.connected), "three relay connections");
  const host = pcs[0];
  await host.shell(`streamingBrowser.openProviderUrl('sto','http://serienstream.to${base}/staffel-1/episode-1')`);
  await until(async () => (await readPlayer(host))?.ready >= 2, "host media");
  const shared = await host.shell(`streamingBrowser.shareCurrentToWatchparty('${room}')`);
  assert.equal(shared.shared, true, JSON.stringify(shared));
  const key = shared.key;
  for (const pc of pcs.slice(1)) {
    await until(async () => (await pc.shell("streamingBrowser.getWatchpartyItems()")).some(item => item.key === key), "shared card");
    await pc.shell(`streamingBrowser.enterWatchparty(${JSON.stringify(key)},'${room}')`);
  }
  await until(async () => (await Promise.all(pcs.map(pc => pc.shell("streamingBrowser.getWatchpartyItems()")))).every(items => items.find(item => item.key === key)?.joined), "joined membership");
  await Promise.all(pcs.map(pc => pc.shell(`streamingBrowser.openWatchpartyItem(${JSON.stringify(key)},'${room}')`)));
  await until(async () => (await Promise.all(pcs.map(readPlayer))).every(p => p?.ready >= 2), "three loaded players");
  await until(async () => (await Promise.all(pcs.map(readPlayer))).every(p => p?.members === 3), "three participants in each real player strip");
  await host.shell(`streamingBrowser.resyncWatchparty(${JSON.stringify(key)},'${room}')`);
  await until(async () => (await Promise.all(pcs.map(readPlayer))).every(p => p && !p.waiting && p.paused), "synchronize pauses and releases all three controls");
  await host.player("spielenUmschalten()");
  await until(async () => (await Promise.all(pcs.map(readPlayer))).every(p => p && !p.waiting && !p.paused), "all three start together");
  const playing = await Promise.all(pcs.map(readPlayer));
  assert.ok(Math.max(...playing.map(p => p.time)) - Math.min(...playing.map(p => p.time)) < 1, JSON.stringify(playing));
  const guest = pcs[1];
  await guest.player("spielenUmschalten()");
  await until(async () => (await Promise.all(pcs.map(readPlayer))).every(p => p?.paused && !p.waiting), "guest pauses the entire party");
  await guest.player("spielenUmschalten()");
  await until(async () => (await Promise.all(pcs.map(readPlayer))).every(p => p && !p.paused && !p.waiting), "guest restarts the entire party");

  // Hold real HTTP responses, not player state or readiness. PC3 cannot become
  // ready until the fixture bytes arrive; PC1 and PC2 must keep waiting.
  await pcs[2].call("hold", undefined, { episode: 2 });
  const changed = await guest.player(`bruecke.wechseln(${JSON.stringify("http://serienstream.cx" + base + "/staffel-1/episode-2")})`);
  assert.equal(changed.wartetAufRunde, true, JSON.stringify(changed));
  await until(async () => (await pcs[2].call("fixture-status")).pendingResponses > 0, "PC3 is actually waiting for episode 2 media bytes");
  await until(async () => (await Promise.all(pcs.slice(0, 2).map(readPlayer)))
    .every(p => p?.episode === 2 && p.ready >= 3 && p.paused && p.waiting), "two ready players wait for delayed PC3");
  await guest.player("spielenUmschalten()");
  assert.ok((await Promise.all(pcs.slice(0, 2).map(readPlayer))).every(p => p.paused && p.waiting),
    "A real pending third PC cannot be bypassed with another Play click");
  await pcs[2].call("release");
  await until(async () => (await Promise.all(pcs.map(readPlayer)))
    .every(p => p?.episode === 2 && p.ready >= 3 && !p.paused && !p.waiting), "episode 2 starts on all three after PC3 buffers");
  const next = await Promise.all(pcs.map(readPlayer));
  assert.ok(Math.max(...next.map(p => p.time)) - Math.min(...next.map(p => p.time)) < 1, JSON.stringify(next));
  console.log("OK Three complete Electron apps: three participant strips; synchronize releases controls; host and guest Play/Pause; episode change waits for delayed PC3, then all start (<1s spread)");
}
main().catch(async error => { console.error(error.stack); console.error("Diagnostics:", root);
  console.error(await Promise.all(clients.map(readPlayer))); process.exitCode = 1; }).finally(async () => {
  for (const pc of clients) { if (pc.child.connected) pc.child.send({ action: "quit" }); }
  await Promise.all(clients.map(pc => pc.child.exitCode !== null ? Promise.resolve() : new Promise(resolve => {
    const timer = setTimeout(() => { pc.child.kill(); resolve(); }, 3000);
    pc.child.once("exit", () => { clearTimeout(timer); resolve(); });
  })));
  relay?.kill();
});
