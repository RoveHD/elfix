"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const WS = require("../../sync-server/node_modules/ws");
const { SprachchatRelay } = require("../../sync-server/sprachchat");
const SDP = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=sendrecv\r\n";
let checks = 0;
const clients = [];
function check(name, condition) { assert.ok(condition, name); checks += 1; console.log(`OK ${name}`); }
const proof = () => crypto.randomBytes(32).toString("base64url");

async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function client(address, room, name, deviceProof = proof(), accountProof = "") {
  const socket = new WS(address);
  const messages = [];
  const pending = new Set();
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw)); messages.push(message);
    for (const waiter of pending) if (waiter.match(message)) { pending.delete(waiter); clearTimeout(waiter.timer); waiter.resolve(message); }
  });
  socket.on("error", () => {});
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const api = {
    socket, messages, deviceProof,
    send(message) { socket.send(JSON.stringify(message)); },
    wait(type, predicate = () => true, since = 0) {
      const match = (message) => message.type === type && predicate(message);
      const existing = messages.slice(since).find(match);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = { match, resolve, timer: setTimeout(() => { pending.delete(waiter); reject(new Error(`Relay-Antwort fehlt: ${type}`)); }, 4000) };
        pending.add(waiter);
      });
    },
    async joinVoice() { const since = messages.length; this.send({ type: "voicejoin", id: "spoof", muted: false }); return this.wait("voicewelcome", () => true, since); },
    async close(force = false) { if (socket.readyState === WS.CLOSED) return; await new Promise((resolve) => { socket.once("close", resolve); if (force) socket.terminate(); else socket.close(); }); }
  };
  clients.push(api);
  if (room) {
    api.send({ type: "join", room, name, deviceProof, accountProof });
    await api.wait("state");
  }
  return api;
}

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-voice-relay-"));
  const port = await freePort();
  const server = path.resolve(__dirname, "../../sync-server/server.js");
  const relay = spawn(process.execPath, [server], { cwd: path.dirname(server), windowsHide: true,
    env: { ...process.env, PORT: String(port), STATE_DIRECTORY: directory,
      ELFIX_VOICE_ICE_SERVERS: '[{"urls":"turn:localhost:3478"}]', ELFIX_VOICE_TURN_SECRET: "isolated-test-secret", ELFIX_VOICE_TURN_TTL: "120" },
    stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  relay.stderr.on("data", (data) => { stderr += String(data); });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Isoliertes Relay startet nicht")), 7000);
      relay.stdout.on("data", (data) => { if (String(data).includes("auf Port")) { clearTimeout(timer); resolve(); } });
      relay.once("exit", () => { clearTimeout(timer); reject(new Error("Relay beendet sich beim Start")); });
    });
    const address = `ws://127.0.0.1:${port}`;
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    check("Echtes isoliertes Relay veröffentlicht Voice-Feature", health.features.includes("voice"));
    const stranger = await client(address);
    stranger.send({ type: "voicejoin", room: "Familie", deviceId: "spoof" });
    check("Voice vor authentifiziertem Watchparty-Join wird abgewiesen", (await stranger.wait("voiceerror")).code === "not-authenticated");
    const account = proof();
    const a = await client(address, "Familie", "Fernseher", proof(), account);
    const b = await client(address, "Familie", "Freund");
    const c = await client(address, "Andere", "Anderer Raum");
    const wa = await a.joinVoice(); const wb = await b.joinVoice(); const wc = await c.joinVoice();
    check("Voice-ID ist zufällig, socketgebunden und startet immer gemutet", /^[0-9a-f]{32}$/.test(wa.selfId) && wa.selfId !== wb.selfId && wa.peers[0].muted && wa.selfId !== a.messages.find((message) => message.type === "state").you);
    check("Roster bleibt im jeweiligen Raum", wb.peers.length === 2 && wc.peers.length === 1 && !wc.peers.some((peer) => peer.id === wa.selfId));
    check("TURN-Credentials laufen kurzfristig ab und geben Secret nicht preis", wa.iceServers[0].username.endsWith(`:${wa.selfId}`)
      && wa.iceServers[0].credential === crypto.createHmac("sha1", "isolated-test-secret").update(wa.iceServers[0].username).digest("base64")
      && Number(wa.iceServers[0].username.split(":")[0]) - Math.floor(Date.now() / 1000) <= 120 && !JSON.stringify(wa).includes("isolated-test-secret"));
    let index = b.messages.length;
    a.send({ type: "voicesignal", to: wb.selfId, from: wc.selfId, room: "Andere", description: { type: "offer", sdp: SDP, private: "omitted" } });
    const signal = await b.wait("voicesignal", () => true, index);
    check("Signalling schreibt From aus Socketidentität und ignoriert fremden Raum/Extras", signal.from === wa.selfId && !signal.room && !signal.description.private && signal.description.sdp === SDP);
    index = a.messages.length;
    a.send({ type: "voicesignal", to: wc.selfId, candidate: null });
    check("Raumübergreifendes Signalling wird abgewiesen", (await a.wait("voiceerror", () => true, index)).code === "peer-missing" && !c.messages.some((message) => message.type === "voicesignal"));
    index = a.messages.length;
    a.send({ type: "voicesignal", to: wb.selfId, description: { type: "offer", sdp: `${SDP}m=video 9 UDP/TLS/RTP/SAVPF 96\r\n` } });
    check("Relay lässt nur Audio-SDP durch", (await a.wait("voiceerror", () => true, index)).code === "invalid-signal");
    index = a.messages.length;
    a.send({ type: "voicesignal", to: wb.selfId, description: { type: "offer", sdp: "x".repeat(34000) } });
    check("Zu große Voice-Nachricht wird vor Weitergabe abgewiesen", (await a.wait("voiceerror", () => true, index)).code === "too-large");
    index = b.messages.length;
    a.send({ type: "voicestate", muted: false, id: wb.selfId });
    const state = await b.wait("voicepeers", (message) => message.peers.some((peer) => peer.id === wa.selfId && !peer.muted), index);
    check("Mute-Befehl verändert nur die eigene Voice-Mitgliedschaft", state.peers.find((peer) => peer.id === wb.selfId).muted);
    const phone = await client(address, "Familie", "Handy", proof(), account);
    const phoneWelcome = await phone.joinVoice();
    check("Handy desselben Kontos übernimmt Audio und entfernt TV-Peer", (await a.wait("voiceleft")).reason === "replaced"
      && phoneWelcome.peers.length === 2 && !phoneWelcome.peers.some((peer) => peer.id === wa.selfId));
    index = a.messages.length;
    a.send({ type: "voicesignal", to: wb.selfId, candidate: null });
    check("Ersetzter Socket darf keine Sprachsignale mehr senden", (await a.wait("voiceerror", () => true, index)).code === "not-joined");
    const replacement = await client(address, "Familie", "Neu verbunden", b.deviceProof);
    const replacementWelcome = await replacement.joinVoice();
    check("Dieselbe Geräteidentität wird ebenfalls ersetzt", (await b.wait("voiceleft")).reason === "replaced" && !replacementWelcome.peers.some((peer) => peer.id === wb.selfId));
    await b.close();
    index = phone.messages.length;
    replacement.send({ type: "voicestate", muted: false });
    const replacementRoster = await phone.wait("voicepeers", (message) => message.peers.some((peer) => peer.id === replacementWelcome.selfId && !peer.muted), index);
    check("Close eines ersetzten Sockets entfernt den Ersatzpeer nicht", replacementRoster.peers.some((peer) => peer.id === replacementWelcome.selfId));
    index = phone.messages.length;
    replacement.send({ type: "join", room: "Andere", name: "Raumwechsel", deviceProof: replacement.deviceProof });
    await phone.wait("voicepeers", (message) => !message.peers.some((peer) => peer.id === replacementWelcome.selfId), index);
    check("Watchparty-Raumwechsel entfernt Voice im alten Raum", (await replacement.wait("voiceleft")).reason === "room-changed");
    const fill = [];
    for (let n = 0; n < 7; n += 1) { const participant = await client(address, "Familie", `Gast ${n}`); const welcome = await participant.joinVoice(); fill.push({ participant, welcome }); }
    const excess = await client(address, "Familie", "Neunter");
    excess.send({ type: "voicejoin" });
    check("Maximal acht Voice-Teilnehmer pro Raum", (await excess.wait("voiceerror")).code === "room-full" && fill.at(-1).welcome.peers.length === 8);
    index = phone.messages.length;
    const removed = fill[0]; await removed.participant.close();
    const closeRoster = await phone.wait("voicepeers", (message) => message.peers.length === 7 && !message.peers.some((peer) => peer.id === removed.welcome.selfId), index);
    // Socket-close sends voicepeers followed by the ordinary Watchparty peers.
    // Both may arrive in one WS read before the awaiting continuation runs.
    // Check the matched response, never the last message of either protocol.
    assert.deepEqual(closeRoster.peers.map((peer) => peer.id).sort(),
      [phoneWelcome.selfId, ...fill.slice(1).map(({ welcome }) => welcome.selfId)].sort(),
      "Voice-Close muss genau die sieben verbliebenen Peer-IDs erhalten");
    check("WebSocket-Close bereinigt ephemere Voice-Mitgliedschaft", closeRoster.peers.length === 7 && !closeRoster.peers.some((peer) => peer.id === removed.welcome.selfId));
    index = phone.messages.length;
    for (let n = 0; n < 220; n += 1) phone.send({ type: "voicestate", muted: true });
    check("Voice-Burst wird socketweise begrenzt", (await phone.wait("voiceerror", (message) => message.code === "rate-limit", index)).code === "rate-limit");
    const after = phone.messages.length;
    phone.send({ type: "time", t0: -123 });
    check("Voice-Rate-Limit blockiert bestehenden Watchparty-Uhrabgleich nicht", (await phone.wait("timeack", () => true, after)).t0 === -123);
    index = phone.messages.length;
    phone.send({ type: "voiceleave" });
    check("Leave bleibt trotz erschöpftem Rate-Limit möglich", (await phone.wait("voiceleft", () => true, index)).reason === "left");
    check("Relay schreibt keine Signalling-/Credential-Daten in Fehlerlog", !stderr.includes(SDP) && !stderr.includes("isolated-test-secret"));
    // Configuration errors must not evict a valid participant, even when a
    // duplicate account attempts to take over under broken relay settings.
    const sent = [];
    const mock = (device, konto = "") => ({ readyState: 1, raum: "Test", geraetId: device, konto, name: device, send: (text) => sent.push(JSON.parse(text)) });
    const env = { ELFIX_VOICE_ICE_SERVERS: "[]" };
    const unit = new SprachchatRelay({ env });
    const old = mock("old", "same"); unit.handle(old, { type: "voicejoin" });
    env.ELFIX_VOICE_ICE_SERVERS = "bad";
    unit.handle(mock("new", "same"), { type: "voicejoin" });
    check("Fehlerhafte ICE-Konfiguration verdrängt keinen bestehenden Audio-Teilnehmer", unit.members.has(old) && sent.at(-1).code === "ice-config");
    console.log(`${checks}/${checks} isolierte Sprachchat-Relayprüfungen bestanden`);
  } finally {
    await Promise.all(clients.map((api) => api.close(true)));
    const exited = new Promise((resolve) => { if (relay.exitCode !== null) resolve(); else relay.once("exit", resolve); });
    relay.kill(); await exited;
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("elfix-voice-relay-")) throw new Error("Testablage liegt außerhalb des isolierten Temp-Verzeichnisses");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
