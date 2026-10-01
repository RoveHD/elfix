"use strict";

const assert = require("node:assert/strict");
const { ElfixSprachchat, voiceClientMessage } = require("../shared/sprachchat");
const { Watchparty } = require("../src/watchparty");
const { WatchpartyRaeume } = require("../src/watchparty-raeume");
const A = "1".repeat(32);
const B = "2".repeat(32);
const C = "3".repeat(32);
const SDP = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=sendrecv\r\n";
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
let checks = 0;
function check(name, condition) { assert.ok(condition, name); checks += 1; console.log(`OK ${name}`); }

class Track {
  constructor() { this.kind = "audio"; this.enabled = true; this.stopped = false; this.onended = null; }
  stop() { this.stopped = true; }
}
class Stream {
  constructor(tracks = [new Track()]) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); }
}
class RTC {
  constructor(configuration) {
    this.configuration = configuration;
    this.connectionState = "new";
    this.signalingState = "stable";
    this.remoteDescription = null;
    this.transceivers = [];
    this.ice = [];
    this.offers = 0;
    this.closed = false;
  }
  addTransceiver(kind) {
    assert.equal(kind, "audio");
    const sender = { track: null, replaceTrack: async (track) => { sender.track = track; } };
    const item = { sender, receiver: { track: new Track() }, direction: "sendrecv" };
    this.transceivers.push(item);
    return item;
  }
  getTransceivers() { return this.transceivers; }
  async createOffer() { this.offers += 1; return { type: "offer", sdp: SDP }; }
  async createAnswer() { return { type: "answer", sdp: SDP }; }
  async setLocalDescription(description) {
    this.localDescription = description;
    this.signalingState = description.type === "offer" ? "have-local-offer" : "stable";
  }
  async setRemoteDescription(description) {
    this.remoteDescription = description;
    if (description.type === "offer" && !this.transceivers.length) this.addTransceiver("audio");
    this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
  }
  async addIceCandidate(candidate) { assert.ok(this.remoteDescription); this.ice.push(candidate); }
  close() { this.closed = true; this.connectionState = "closed"; }
}
class Context {
  constructor() { this.nodes = []; this.destination = {}; this.closed = false; this.level = 128; }
  node(extra = {}) { const item = { connected: [], connect(to) { this.connected.push(to); }, disconnect() { this.disconnected = true; }, ...extra }; this.nodes.push(item); return item; }
  createMediaStreamSource() { return this.node(); }
  createGain() { return this.node({ gain: { value: 1 } }); }
  createAnalyser() { return this.node({ fftSize: 256, getByteTimeDomainData: (values) => values.fill(this.level) }); }
  async resume() {}
  async close() { this.closed = true; }
}
function setup(extra = {}) {
  const sent = [];
  const mic = [];
  const duck = [];
  const streams = [];
  let captures = 0;
  const engine = new ElfixSprachchat({ send: (message) => { sent.push(message); return true; },
    RTCPeerConnection: RTC, MediaStream: Stream, AudioContext: Context,
    onMicrophone: (active) => mic.push(active), onDucking: (active) => duck.push(active),
    mediaDevices: { getUserMedia: async (constraints) => {
      assert.equal(constraints.video, false);
      captures += 1;
      const stream = new Stream(); streams.push(stream); return stream;
    } }, createAudio: () => ({ volume: 1, async play() {}, pause() { this.paused = true; } }), ...extra });
  return { engine, sent, mic, duck, streams, captures: () => captures };
}
function welcome(engine, selfId = A, peers = [{ id: A, name: "Ich", muted: true }, { id: B, name: "Partner", muted: true }]) {
  engine.receive({ type: "voicewelcome", selfId, peers, iceServers: [] });
}

async function main() {
  {
    const requested = [];
    const f = setup({ inputDeviceId: "usb-microphone", mediaDevices: { getUserMedia: async (constraints) => {
      requested.push(constraints); return new Stream();
    } } });
    check("Gespeichertes Mikrofon ist im Zustand sichtbar ohne Gerätezugriff", f.engine.state.inputDeviceId === "usb-microphone" && requested.length === 0);
    f.engine.join(); welcome(f.engine); await tick();
    await f.engine.setMuted(false);
    check("Explizites Einschalten fordert exakt das gewählte Mikrofon an", requested.length === 1 && requested[0].audio.deviceId.exact === "usb-microphone" && requested[0].video === false);
    const oldTrack = f.engine.capture.getAudioTracks()[0];
    f.engine.setInputDevice("headset"); await tick();
    check("Gerätewechsel stoppt aktive Aufnahme sofort und verlangt neues Einschalten", oldTrack.stopped && !oldTrack.enabled && f.engine.state.muted && requested.length === 1 && /erneut einschalten/.test(f.engine.state.error));
    await f.engine.setMuted(false);
    check("Erst bewusster Klick startet das neu gewählte Mikrofon", requested.length === 2 && requested[1].audio.deviceId.exact === "headset");
    const liveTrack = f.engine.capture.getAudioTracks()[0];
    check("Identische Auswahl verändert eine aktive Aufnahme nicht", f.engine.setInputDevice("headset") && f.engine.capture.getAudioTracks()[0] === liveTrack && !liveTrack.stopped);
    check("Ungültige Gerätedaten werden ohne Seiteneffekt verworfen", !f.engine.setInputDevice(null) && !f.engine.setInputDevice("x".repeat(513)) && f.engine.state.inputDeviceId === "headset" && !liveTrack.stopped);
    f.engine.setInputDevice("");
    await f.engine.setMuted(false);
    check("Systemstandard lässt den deviceId-Constraint vollständig weg", requested.length === 3 && !Object.hasOwn(requested[2].audio, "deviceId") && f.engine.state.inputDeviceId === "");
    f.engine.close();
    check("Geschlossener Kern akzeptiert keine Geräteänderungen", !f.engine.setInputDevice("headset"));
  }
  {
    const permission = deferred(); let captures = 0;
    const f = setup({ inputDeviceId: "old-input", mediaDevices: { getUserMedia: () => { captures += 1; return permission.promise; } } });
    f.engine.join(); welcome(f.engine, A, [{ id: A }]);
    const unmute = f.engine.setMuted(false);
    f.engine.setInputDevice("new-input");
    const stale = new Stream(); permission.resolve(stale); await unmute;
    check("Gerätewechsel während Mikrofonfreigabe verwirft den alten Track ohne neuen Capture", stale.getAudioTracks()[0].stopped && f.engine.state.muted && f.engine.state.inputDeviceId === "new-input" && captures === 1 && !f.mic.includes(true));
    f.engine.close();
  }
  {
    const permission = deferred(); const requests = [];
    const f = setup({ inputDeviceId: "old-input", mediaDevices: { getUserMedia: (constraints) => {
      requests.push(constraints); return permission.promise;
    } } });
    f.engine.join(); welcome(f.engine, A, [{ id: A }]);
    f.engine.setPushToTalk(true);
    const firstPress = f.engine.pushToTalk(true);
    f.engine.setInputDevice("new-input");
    const newPress = f.engine.pushToTalk(true);
    await f.engine.pushToTalk(false);
    const stale = new Stream(); permission.resolve(stale); await firstPress; await newPress;
    check("PTT-Release nach Gerätewahl beendet auch die wartende neue Mikrofonanfrage", requests.length === 1 && stale.getAudioTracks()[0].stopped && f.engine.state.muted && !f.mic.includes(true));
    f.engine.close();
  }
  {
    let permissionRequests = 0;
    const f = setup({ mediaDevices: { getUserMedia: async () => {
      permissionRequests += 1;
      const error = new Error("private unavailable hardware id"); error.name = "OverconstrainedError"; throw error;
    } } });
    check("Gerätewahl bei geöffneten Einstellungen benötigt kein getUserMedia", f.engine.setInputDevice("missing-device") && permissionRequests === 0 && f.engine.capture === null && !f.engine.data.joined);
    f.engine.join(); welcome(f.engine, A, [{ id: A }]);
    await f.engine.setMuted(false);
    check("Nicht verfügbares Mikrofon bleibt stumm mit klarer Auswahlhilfe ohne stille Ersatzwahl", f.engine.state.muted && f.engine.state.inputDeviceId === "missing-device" && /nicht verfügbar/.test(f.engine.state.error) && !f.engine.state.error.includes("private unavailable"));
    f.engine.close();
  }
  {
    const f = setup();
    f.engine.join(); welcome(f.engine); await tick();
    const peer = f.engine.members.get(B);
    check("Expliziter Beitritt bleibt stumm und fordert kein Mikrofon", f.captures() === 0 && f.engine.state.muted && f.engine.state.joined);
    check("Ein stabiler Offerer erzeugt genau eine Audio-Transceiver", peer.pc.offers === 1 && peer.pc.transceivers.length === 1);
    await f.engine.setMuted(false); await tick();
    check("Erstes Unmute aktiviert nur Audio und hängt den Track an", f.captures() === 1 && !f.engine.state.muted && peer.sender.track === f.streams[0].getAudioTracks()[0]);
    await f.engine.setMuted(true); await tick();
    check("Mute stoppt Track sofort und entfernt Sender-Track", f.streams[0].getAudioTracks()[0].stopped && !f.streams[0].getAudioTracks()[0].enabled && peer.sender.track === null);
    f.engine.setPushToTalk(true);
    await f.engine.pushToTalk(true); await tick();
    check("PTT gedrückt aktiviert ein neues Mikrofon", f.captures() === 2 && !f.engine.state.muted);
    await f.engine.pushToTalk(false); await tick();
    check("PTT losgelassen stoppt das Mikrofon ohne Neuverhandlung", f.engine.state.muted && f.streams[1].getAudioTracks()[0].stopped && peer.pc.offers === 1);
    const stream = new Stream();
    peer.pc.ontrack({ track: stream.getAudioTracks()[0], streams: [stream] }); await tick();
    f.engine.setVolume(B, 0.4);
    check("Teilnehmerlautstärke setzt Audioausgabe und begrenzt Werte", peer.audio.volume === 0.4 && f.engine.setVolume(B, 3) && peer.audio.volume === 1 && !f.engine.setVolume(B, NaN));
    f.engine.receive({ type: "voicepeers", peers: [{ id: A }, { id: B, name: "Partner", muted: false }] });
    f.engine.context.level = 150;
    f.engine.meter();
    check("Sprachindikator und Ducking beruhen auf echtem Analyser-Pegel", f.engine.state.peers[0].speaking && f.duck.at(-1) === true);
    f.engine.setVolume(B, 0);
    check("Stummer Teilnehmer senkt Filmaudio nicht ab", f.duck.at(-1) === false);
    f.engine.receive({ type: "voicepeers", peers: [{ id: A }] });
    check("Roster-Leave schließt RTC, Remote-Track und Audioausgabe", peer.pc.closed && stream.getAudioTracks()[0].stopped && peer.audio.srcObject === null && !f.engine.state.peers.length);
    f.engine.close();
    check("close verhindert erneuten Beitritt", !f.engine.join() && f.engine.context === null);
  }
  {
    const permission = deferred();
    const f = setup({ mediaDevices: { getUserMedia: () => permission.promise } });
    f.engine.join(); welcome(f.engine, A, [{ id: A }]);
    const unmute = f.engine.setMuted(false);
    f.engine.leave();
    const stream = new Stream(); permission.resolve(stream); await unmute;
    check("Späte Mikrofonberechtigung nach Leave stoppt Track und sendet kein Unmute", stream.getAudioTracks()[0].stopped && !f.engine.state.joined && !f.sent.some((message) => message.type === "voicestate" && !message.muted));
    check("Abgebrochene Aufnahme meldet dem Android-Host Mikrofon aus", f.mic.at(-1) === false);
    f.engine.receive({ type: "voicewelcome", selfId: A, peers: [] });
    check("Spätes Welcome nach Leave kann nicht wieder beitreten", !f.engine.state.joined);
    f.engine.close();
  }
  {
    const permission = deferred();
    const f = setup({ mediaDevices: { getUserMedia: () => permission.promise } });
    f.engine.join(); welcome(f.engine, A, [{ id: A }]);
    f.engine.setPushToTalk(true);
    const down = f.engine.pushToTalk(true);
    await f.engine.pushToTalk(false);
    const stream = new Stream(); permission.resolve(stream); await down;
    check("PTT loslassen während Berechtigungsdialog verhindert jede Übertragung", stream.getAudioTracks()[0].stopped && f.engine.state.muted && !f.mic.includes(true));
    f.engine.close();
  }
  {
    const first = deferred(); let calls = 0; const fresh = new Stream();
    const f = setup({ mediaDevices: { getUserMedia: () => ++calls === 1 ? first.promise : Promise.resolve(fresh) } });
    f.engine.join(); welcome(f.engine, A, [{ id: A }]);
    const old = f.engine.setMuted(false);
    f.engine.leave(); f.engine.join(); welcome(f.engine, B, [{ id: B }]);
    const explicit = f.engine.setMuted(false);
    const stale = new Stream(); first.resolve(stale); await old; await explicit;
    check("Rejoin plus explizites Unmute bekommt frischen Track, alte Anfrage bleibt verworfen", stale.getAudioTracks()[0].stopped && calls === 2 && f.engine.capture === fresh && !fresh.getAudioTracks()[0].stopped);
    f.engine.close();
  }
  {
    const f = setup({ mediaDevices: { getUserMedia: async () => { const error = new Error("private device"); error.name = "NotAllowedError"; throw error; } } });
    f.engine.join(); welcome(f.engine, A, [{ id: A }]);
    await f.engine.setMuted(false);
    check("Abgelehnte Berechtigung bleibt stumm mit sichtbarem bereinigtem Fehler", f.engine.state.muted && /berechtigung/i.test(f.engine.state.error) && !f.engine.state.error.includes("private device") && f.mic.at(-1) === false);
    f.engine.close();
  }
  {
    const f = setup(); f.engine.join(); welcome(f.engine, B, [{ id: A }, { id: B }]);
    const peer = f.engine.members.get(A);
    f.engine.receive({ type: "voicesignal", from: A, candidate: { candidate: "candidate:test", sdpMLineIndex: 0 } }); await tick();
    check("ICE vor SDP bleibt in begrenzter Queue", peer.candidates.length === 1 && peer.pc.ice.length === 0 && peer.pc.transceivers.length === 0);
    f.engine.receive({ type: "voicesignal", from: A, description: { type: "offer", sdp: SDP } }); await tick();
    check("Answerer übernimmt eine Audio-Transceiver und arbeitet frühe ICE ab", peer.pc.transceivers.length === 1 && peer.pc.offers === 0 && peer.pc.ice.length === 1 && f.sent.some((message) => message.description?.type === "answer"));
    const wait = deferred(); peer.pc.setRemoteDescription = () => wait.promise;
    const before = f.sent.length;
    f.engine.receive({ type: "voicesignal", from: A, description: { type: "offer", sdp: SDP } }); await tick();
    f.engine.leave(); wait.resolve(); await tick();
    check("SDP fertig nach Leave erzeugt keine Antwort und keinen neuen Peer", f.sent.slice(before).every((message) => message.type === "voiceleave") && !f.engine.state.peers.length && peer.pc.closed);
    f.engine.close();
  }
  {
    let rejectPlay = true;
    const f = setup({ createAudio: () => ({ volume: 1, play: async () => { if (rejectPlay) throw new Error("autoplay"); }, pause() {} }) });
    f.engine.join(); welcome(f.engine); await tick();
    const peer = f.engine.members.get(B); const stream = new Stream();
    peer.pc.ontrack({ track: stream.getAudioTracks()[0], streams: [] }); await tick();
    check("Autoplay-Fehler bleibt sichtbar, auch für streamlose Remote-Audiospur", f.engine.state.peers[0].playbackError && peer.audio.srcObject.getAudioTracks().length === 1);
    rejectPlay = false; await f.engine.retryAudio(B);
    check("Expliziter Audio-Retry behebt blockierte Ausgabe", !f.engine.state.peers[0].playbackError);
    f.engine.close();
  }
  {
    const f = setup({ joinTimeoutMs: 20 }); f.engine.join();
    await new Promise((resolve) => setTimeout(resolve, 35));
    check("Älteres Relay endet in begrenztem Timeout ohne Mikrofonanfrage", !f.engine.state.connecting && !f.engine.state.joined && /Relay/.test(f.engine.state.error) && f.captures() === 0);
    f.engine.close();
  }
  {
    const f = setup(); f.engine.join(); welcome(f.engine); await tick();
    await f.engine.setMuted(false); await tick();
    const peer = f.engine.members.get(B);
    const track = f.streams[0].getAudioTracks()[0];
    track.onended(); await tick();
    check("Physisch verlorenes Mikrofon bleibt ausgeschaltet bis zum nächsten Klick", f.engine.state.muted && f.captures() === 1 && track.stopped && peer.sender.track === null && /getrennt/.test(f.engine.state.error));
    peer.pc.connectionState = "failed"; peer.pc.onconnectionstatechange();
    check("Gescheiterte RTC-Verbindung zeigt Netzwerkfehler ohne stilles Mikrofon-Reacquire", /TURN/.test(f.engine.state.peers[0].error) && f.captures() === 1);
    f.engine.close();
  }
  {
    const f = setup(); f.engine.join(); welcome(f.engine, B, [{ id: A }, { id: B }]);
    for (let n = 0; n < 120; n += 1) f.engine.receive({ type: "voicesignal", from: A, candidate: { candidate: `candidate:${n}`, sdpMLineIndex: 0 } });
    await tick();
    check("Frühe ICE-Queue überschreitet auch bei Kandidatenflut nie 64 Einträge", f.engine.members.get(A).candidates.length === 64);
    f.engine.close();
  }
  {
    const delivery = deferred();
    const f = setup({ send: () => delivery.promise });
    f.engine.join(); delivery.resolve(false); await tick();
    check("Asynchroner Bridge-Sendefehler beendet Joining sichtbar und ohne Rejection", !f.engine.state.connecting && /getrennt/.test(f.engine.state.error));
    f.engine.close();
  }
  {
    const delivery = deferred(); let sends = 0;
    const f = setup({ send: () => ++sends === 1 ? delivery.promise : Promise.resolve(true) });
    f.engine.join(); f.engine.leave(); f.engine.join(); welcome(f.engine, B, [{ id: B }]);
    delivery.resolve(false); await tick();
    check("Verspäteter Sendefehler alter Generation beendet neuen Beitritt nicht", f.engine.state.joined && !f.engine.state.error);
    f.engine.close();
  }
  {
    const f = setup({ send: () => Promise.reject(new Error("private bridge failure")) });
    f.engine.join(); await tick();
    check("Promise-Rejection der Host-Bridge wird aufgefangen und bereinigt", !f.engine.state.connecting && !f.engine.state.error.includes("private bridge failure"));
    f.engine.close();
  }
  {
    const f = setup(); f.engine.join(); welcome(f.engine); await tick();
    await f.engine.setMuted(false);
    f.engine.receive({ type: "voiceerror", code: "rate-limit", message: "Zu viele Nachrichten" });
    check("Fataler Relay-Fehler stoppt Mikrofon und räumt die Voice-Mitgliedschaft auf", !f.engine.state.joined && f.streams[0].getAudioTracks()[0].stopped && f.sent.at(-1).type === "voiceleave");
    f.engine.close();
  }
  {
    check("IPC-Reiniger lehnt fremde Types und falsche Peer-IDs ab", voiceClientMessage({ type: "join", room: "spoof" }) === null && voiceClientMessage({ type: "voicesignal", to: "spoof", candidate: null }) === null);
    const cleaned = voiceClientMessage({ type: "voicesignal", to: B, from: C, room: "spoof", candidate: { candidate: "candidate:test", extra: "private" } });
    check("IPC-Reiniger übernimmt weder From noch Room noch Extra-Kandidatenfelder", !cleaned.from && !cleaned.room && !cleaned.candidate.extra);
    const incoming = []; const sent = []; const party = new Watchparty({ onVoice: (message) => incoming.push(message) });
    party.socket = { readyState: 1, send: (data) => sent.push(JSON.parse(data)) };
    party.identitaetBestaetigt = true;
    party.nachrichtVerarbeiten(JSON.stringify({ type: "voicewelcome", selfId: A, peers: [] }));
    check("Watchparty reicht Voice separat durch und sendet nur Voice-Protokoll", incoming.length === 1 && party.voiceSenden({ type: "voicejoin", room: "spoof" }) && sent[0].type === "voicejoin" && !sent[0].room && !party.voiceSenden({ type: "join" }));
    party.socket = null;
    const rooms = new WatchpartyRaeume({ onVoice: (message) => incoming.push(message) });
    const room = rooms.raumAnlegen("Familie"); rooms.raeume.set("Familie", room);
    room.aufVoice({ type: "voiceleft", reason: "test" });
    check("Fassade bindet Voice-Callback an Raum und sendet nur in benannten Raum", incoming.at(-1).room === "Familie" && !rooms.voiceSenden("Fremd", { type: "voicejoin" }));
  }
  console.log(`${checks}/${checks} Sprachchat-Kernprüfungen bestanden`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
