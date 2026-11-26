"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const WS = require("../../sync-server/node_modules/ws");
const relay = path.join(__dirname, "../../sync-server/server.js");
const base = "https://aniworld.to/anime/stream/recovery/staffel-1/episode-";

function client(port, name) {
  const messages = [], waiters = [];
  const socket = new WS(`ws://127.0.0.1:${port}`);
  socket.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    messages.push(m);
    for (const w of [...waiters]) {
      if (messages.length <= w.from || !w.predicate(m)) continue;
      clearTimeout(w.timer);
      waiters.splice(waiters.indexOf(w), 1);
      w.resolve(m);
    }
  });
  return {
    socket, messages,
    send: (m) => socket.send(JSON.stringify(m)),
    async join(room) {
      await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
      this.send({ type: "join", room, name,
        deviceProof: crypto.createHash("sha256").update(name).digest("base64url"),
        capabilities: ["playback-recovery-v1"] });
      return this.wait(0, (m) => m.type === "state" && m.you);
    },
    wait(from, predicate) {
      const found = messages.slice(from).find(predicate);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const w = { from, predicate, resolve, timer: setTimeout(() => {
          waiters.splice(waiters.indexOf(w), 1);
          reject(Error(`Timeout ${name}: ${JSON.stringify(messages.slice(from))}`));
        }, 3000) };
        waiters.push(w);
      });
    }
  };
}

(async () => {
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close((err) => err ? reject(err) : resolve(port));
    });
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-recovery-socket-"));
  const server = spawn(process.execPath, [relay], {
    env: { ...process.env, PORT: String(port), STATE_DIRECTORY: dir },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  server.stderr.on("data", (data) => { stderr += String(data); });
  const clients = [];
  try {
    await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(Error(`Relay start timeout: ${stderr}`)), 5000);
      server.once("exit", (code) => { clearTimeout(timer); reject(Error(`Relay exited ${code}: ${stderr}`)); });
      server.stdout.on("data", (data) => {
        output += String(data);
        if (output.includes(`auf Port ${port} (Ablage:`)) { clearTimeout(timer); resolve(); }
      });
    });
    const host = client(port, "Ada"), guest = client(port, "Lena"), other = client(port, "Other");
    clients.push(host, guest, other);
    const [hstate] = await Promise.all([host.join("recovery-a"), guest.join("recovery-a"), other.join("recovery-b")]);
    assert.ok(hstate.features.includes("playback-recovery-v1"));
    host.send({ type: "share", item: { key: "same-title", url: base + "1", title: "Recovery", type: "serie", season: 1, episode: 1 } });
    await host.wait(0, (m) => m.type === "state" && m.shared?.some((e) => e.key === "same-title"));
    guest.send({ type: "enter", key: "same-title" });
    await host.wait(0, (m) => m.type === "state" && m.shared?.find((e) => e.key === "same-title")?.memberIds.length === 2);
    other.send({ type: "share", item: { key: "same-title", url: base + "1", title: "Other", type: "serie", season: 1, episode: 1 } });
    await other.wait(0, (m) => m.type === "state" && m.shared?.some((e) => e.key === "same-title"));
    host.send({ type: "here", key: "same-title", position: 5, paused: false, url: base + "1", season: 1, episode: 1, playerSessionId: "h1" });
    await host.wait(0, (m) => m.type === "watchstate" && m.members?.some((p) => p.name === "Ada"));
    guest.send({ type: "here", key: "same-title", position: 5, paused: false, url: base + "1", season: 1, episode: 1, playerSessionId: "g1" });
    await host.wait(0, (m) => m.type === "watchstate" && m.members?.length === 2);
    const mark = host.messages.length, otherMark = other.messages.length;
    host.send({ type: "control", key: "same-title", action: "navigate", position: 0, url: base + "2" });
    const prepare = await host.wait(mark, (m) => m.type === "syncprepare");
    guest.send({ type: "syncstatus", key: "same-title", syncId: prepare.syncId, state: "confirmation-required", detail: "Anbieter bestaetigen" });
    const status = await host.wait(mark, (m) => m.type === "watchstate"
      && m.preparation?.members.some((p) => p.name === "Lena" && p.state === "confirmation-required"));
    assert.equal(status.preparation.syncId, prepare.syncId);
    guest.send({ type: "synccancel", key: "same-title", syncId: prepare.syncId });
    await host.wait(mark, (m) => m.type === "syncfailed" && m.reason === "user-cancelled");
    host.send({ type: "syncready", key: "same-title", syncId: prepare.syncId });
    guest.send({ type: "syncready", key: "same-title", syncId: prepare.syncId });
    const freshMark = host.messages.length;
    host.send({ type: "control", key: "same-title", action: "navigate", position: 0, url: base + "3", fromEpisodeId: "s1e2" });
    const fresh = await host.wait(freshMark, (m) => m.type === "syncprepare");
    assert.notEqual(fresh.syncId, prepare.syncId);
    host.send({ type: "syncready", key: "same-title", syncId: fresh.syncId });
    guest.send({ type: "syncready", key: "same-title", syncId: fresh.syncId });
    // Der ausdrueckliche Abbruch hielt die Runde an. Auch die neue Folge
    // muss nach erfolgreicher Vorbereitung angehalten bleiben.
    await host.wait(freshMark, (m) => m.type === "syncfailed" && m.syncId === fresh.syncId && m.reason === "sync-pausiert");
    await host.wait(freshMark, (m) => m.type === "watchstate" && m.preparation?.syncId === fresh.syncId && m.preparation.phase === "ready");
    assert.equal(host.messages.filter((m) => m.type === "syncstart" && m.syncId === prepare.syncId).length, 0);
    assert.equal(other.messages.slice(otherMark).some((m) => ["syncprepare", "syncstart", "syncfailed"].includes(m.type)), false);
    assert.equal(host.messages.filter((m) => m.type === "state").at(-1).shared.find((e) => e.key === "same-title").memberIds.length, 2);
    console.log("OK echtes isoliertes Relay: Capability, namentlicher Ladestand, Abbruch, alte Generation, neues pausiertes Ziel und getrennter Raum");
  } finally {
    for (const c of clients) c.socket.terminate();
    if (server.exitCode === null) {
      const exited = new Promise((resolve) => server.once("exit", resolve));
      server.kill();
      await exited;
    }
    // Nur die einzelnen Dateien dieses soeben erstellten Testordners entfernen.
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (!path.resolve(dir).startsWith(tempRoot) || !path.basename(dir).startsWith("elfix-recovery-socket-")) throw Error("Unsafe test cleanup");
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      if (fs.statSync(file).isFile()) fs.unlinkSync(file);
    }
    fs.rmdirSync(dir);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
