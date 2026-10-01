(function (root, factory) {
  "use strict";
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ElfixSprachchat = api.ElfixSprachchat;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const object = (value) => value && typeof value === "object" && !Array.isArray(value);
  const peerId = (value) => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
  const inputDevice = (value) => typeof value === "string" && value.length <= 512;
  const CLIENT_TYPES = new Set(["voicejoin", "voiceleave", "voicestate", "voicesignal"]);

  // Used at the IPC/WS boundary as well. No supplied room/from/device fields
  // cross the boundary: the relay derives those from the authenticated socket.
  function voiceClientMessage(message) {
    if (!object(message) || !CLIENT_TYPES.has(message.type)) return null;
    if (message.type === "voicejoin" || message.type === "voiceleave") return { type: message.type };
    if (message.type === "voicestate") return typeof message.muted === "boolean"
      ? { type: message.type, muted: message.muted } : null;
    if (!peerId(message.to)) return null;
    if (object(message.description) && !Object.hasOwn(message, "candidate")) {
      const { type, sdp } = message.description;
      if (!["offer", "answer"].includes(type) || typeof sdp !== "string" || sdp.length > 24000) return null;
      return { type: "voicesignal", to: message.to, description: { type, sdp } };
    }
    if (!Object.hasOwn(message, "candidate") || Object.hasOwn(message, "description")) return null;
    if (message.candidate === null) return { type: "voicesignal", to: message.to, candidate: null };
    const c = message.candidate;
    if (!object(c) || typeof c.candidate !== "string" || c.candidate.length > 2000
      || (c.sdpMid != null && (typeof c.sdpMid !== "string" || c.sdpMid.length > 64))
      || (c.sdpMLineIndex != null && c.sdpMLineIndex !== 0)
      || (c.usernameFragment != null && (typeof c.usernameFragment !== "string" || c.usernameFragment.length > 256))) return null;
    const candidate = { candidate: c.candidate, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null };
    if (c.usernameFragment) candidate.usernameFragment = c.usernameFragment;
    return { type: "voicesignal", to: message.to, candidate };
  }

  class ElfixSprachchat {
    constructor(options = {}) {
      this.send = options.send || (() => false);
      this.onState = options.onState || (() => {});
      this.onDucking = options.onDucking || (() => {});
      this.onMicrophone = options.onMicrophone || (() => {});
      this.RTC = options.RTCPeerConnection || root.RTCPeerConnection;
      this.media = options.mediaDevices || root.navigator?.mediaDevices;
      this.MediaStream = options.MediaStream || root.MediaStream;
      this.AudioContext = options.AudioContext || root.AudioContext || root.webkitAudioContext;
      this.createAudio = options.createAudio || (() => root.document?.createElement("audio"));
      this.joinTimeoutMs = options.joinTimeoutMs || 8000;
      this.peerTimeoutMs = options.peerTimeoutMs || 25000;
      this.members = new Map();
      this.generation = 0;
      this.micGeneration = 0;
      this.capture = null;
      this.capturePending = null;
      this.context = null;
      this.localMeter = null;
      this.timer = null;
      this.meterTimer = null;
      this.closed = false;
      this.ducking = false;
      this.desiredMic = false;
      this.iceServers = [];
      this.data = { joined: false, connecting: false, muted: true, pushToTalk: false,
        speaking: false, selfId: "", error: "", available: Boolean(this.RTC),
        inputDeviceId: inputDevice(options.inputDeviceId) ? options.inputDeviceId : "" };
    }

    get state() {
      return { ...this.data, peers: [...this.members.values()].map((peer) => ({ id: peer.id,
        name: peer.name, muted: peer.muted, speaking: peer.speaking, volume: peer.volume,
        connectionState: peer.pc.connectionState || "new", error: peer.error,
        playbackError: peer.playbackError })) };
    }

    emit() { this.onState(this.state); }

    transmit(message) {
      const clean = voiceClientMessage(message);
      if (!clean) return false;
      const generation = this.generation;
      try {
        const result = this.send(clean);
        if (result && typeof result.then === "function") {
          Promise.resolve(result).then((ok) => {
            if (ok === false && generation === this.generation && (this.data.joined || this.data.connecting)) this.transportFailed();
          }, () => {
            if (generation === this.generation && (this.data.joined || this.data.connecting)) this.transportFailed();
          });
          return true;
        }
        return result !== false;
      } catch { return false; }
    }

    join() {
      if (this.closed || this.data.joined || this.data.connecting) return false;
      if (!this.RTC) { this.data.error = "Sprachchat wird auf diesem Gerät nicht unterstützt"; this.emit(); return false; }
      this.generation += 1;
      this.data.error = "";
      this.data.connecting = true;
      this.data.muted = true;
      this.resumeAudio();
      const generation = this.generation;
      this.timer = setTimeout(() => {
        if (generation !== this.generation || !this.data.connecting) return;
        this.leave();
        this.data.error = "Das Relay antwortet nicht auf Sprachchat. Verbindung prüfen oder Relay aktualisieren";
        this.emit();
      }, this.joinTimeoutMs);
      this.timer.unref?.();
      if (!this.transmit({ type: "voicejoin" })) {
        this.leave(false);
        this.data.error = "Watchparty-Verbindung ist nicht bereit";
        this.emit();
        return false;
      }
      this.emit();
      return true;
    }

    receive(message) {
      if (!object(message) || this.closed) return;
      if (message.type === "voicewelcome") {
        if (!this.data.connecting || !peerId(message.selfId)) return;
        clearTimeout(this.timer);
        this.timer = null;
        this.data.connecting = false;
        this.data.joined = true;
        this.data.selfId = message.selfId;
        this.iceServers = Array.isArray(message.iceServers) ? message.iceServers.slice(0, 12) : [];
        this.roster(message.peers);
        return;
      }
      if (message.type === "voiceleft") {
        if (!this.data.joined && !this.data.connecting) return;
        this.leave(false);
        this.data.error = message.reason === "replaced" ? "Sprachchat wurde auf deinem anderen Gerät übernommen"
          : message.reason === "disconnected" ? "Watchparty-Verbindung wurde getrennt" : "";
        this.emit();
        return;
      }
      if (message.type === "voiceerror") {
        if (!this.data.joined && !this.data.connecting) return;
        if (this.data.connecting || message.code !== "peer-missing") this.leave();
        this.data.error = typeof message.message === "string" ? message.message.slice(0, 250) : "Sprachchat fehlgeschlagen";
        this.emit();
        return;
      }
      if (!this.data.joined) return;
      if (message.type === "voicepeers") this.roster(message.peers);
      if (message.type === "voicesignal") {
        const peer = this.members.get(message.from);
        if (!peer) return;
        this.enqueue(peer, () => this.signal(peer, message));
      }
    }

    roster(list) {
      if (!Array.isArray(list)) return;
      const peers = list.slice(0, 8).filter((peer) => object(peer) && peerId(peer.id) && peer.id !== this.data.selfId);
      const ids = new Set(peers.map((peer) => peer.id));
      for (const peer of this.members.values()) if (!ids.has(peer.id)) this.removePeer(peer);
      for (const info of peers) {
        let peer = this.members.get(info.id);
        if (!peer) {
          try { peer = this.newPeer(info); }
          catch { this.data.error = "Audio-Verbindung konnte nicht erstellt werden"; continue; }
        }
        peer.name = typeof info.name === "string" ? info.name.slice(0, 40) : "Teilnehmer";
        peer.muted = info.muted !== false;
        if (peer.muted) peer.speaking = false;
      }
      this.updateDucking();
      this.emit();
    }

    alive(peer) { return this.data.joined && peer.generation === this.generation && this.members.get(peer.id) === peer; }

    enqueue(peer, operation) {
      peer.chain = peer.chain.then(async () => { if (this.alive(peer)) await operation(); }).catch(() => {
        if (!this.alive(peer)) return;
        peer.error = "Audio-Verbindung fehlgeschlagen. Sprachchat erneut beitreten";
        this.emit();
      });
      return peer.chain;
    }

    newPeer(info) {
      const pc = new this.RTC({ iceServers: this.iceServers, bundlePolicy: "max-bundle" });
      const peer = { id: info.id, name: "", muted: true, speaking: false, volume: 1,
        pc, sender: null, generation: this.generation, chain: Promise.resolve(), candidates: [],
        audio: null, stream: null, meter: null, error: "", playbackError: false, timer: null };
      this.members.set(peer.id, peer);
      pc.onicecandidate = (event) => {
        if (!this.alive(peer)) return;
        const candidate = event.candidate?.toJSON ? event.candidate.toJSON() : event.candidate;
        if (!this.transmit({ type: "voicesignal", to: peer.id, candidate: candidate || null })) this.transportFailed();
      };
      pc.ontrack = (event) => {
        if (this.alive(peer) && event.track?.kind === "audio") this.remoteAudio(peer, event);
      };
      pc.onconnectionstatechange = () => {
        if (!this.alive(peer)) return;
        if (pc.connectionState === "connected") { clearTimeout(peer.timer); peer.error = ""; }
        if (pc.connectionState === "failed") peer.error = "Audio-Verbindung fehlgeschlagen. Netzwerk/TURN prüfen und erneut beitreten";
        if (["disconnected", "failed", "closed"].includes(pc.connectionState)) peer.speaking = false;
        this.updateDucking();
        this.emit();
      };
      peer.timer = setTimeout(() => {
        if (this.alive(peer) && pc.connectionState !== "connected") {
          peer.error = "Audio-Verbindung braucht zu lange. Netzwerk/TURN prüfen und erneut beitreten";
          this.emit();
        }
      }, this.peerTimeoutMs);
      peer.timer.unref?.();
      // A single stable offerer, chosen from relay IDs. Only that side creates
      // the transceiver; the answerer adopts the offered audio transceiver.
      // Later microphone changes use replaceTrack and never create glare.
      if (this.data.selfId < peer.id) this.enqueue(peer, async () => {
        peer.sender = pc.addTransceiver("audio", { direction: "sendrecv" }).sender;
        await peer.sender.replaceTrack(this.capture?.getAudioTracks()[0] || null);
        if (!this.alive(peer)) return;
        const offer = await pc.createOffer();
        if (!this.alive(peer)) return;
        await pc.setLocalDescription(offer);
        if (this.alive(peer)) this.sendDescription(peer);
      });
      return peer;
    }

    sendDescription(peer) {
      const description = peer.pc.localDescription;
      if (!this.transmit({ type: "voicesignal", to: peer.id, description: { type: description.type, sdp: description.sdp } })) this.transportFailed();
    }

    async signal(peer, message) {
      const pc = peer.pc;
      if (message.description) {
        const description = message.description;
        if (!object(description) || !["offer", "answer"].includes(description.type)
          || typeof description.sdp !== "string" || description.sdp.length > 24000) return;
        if (description.type === "offer" && this.data.selfId < peer.id) return;
        if (description.type === "answer" && pc.signalingState !== "have-local-offer") return;
        await pc.setRemoteDescription(description);
        if (!this.alive(peer)) return;
        for (const candidate of peer.candidates.splice(0)) {
          await pc.addIceCandidate(candidate);
          if (!this.alive(peer)) return;
        }
        if (description.type === "offer") {
          const transceiver = pc.getTransceivers().find((item) => item.receiver.track.kind === "audio");
          if (!transceiver) throw new Error("Missing audio transceiver");
          transceiver.direction = "sendrecv";
          peer.sender = transceiver.sender;
          await peer.sender.replaceTrack(this.capture?.getAudioTracks()[0] || null);
          if (!this.alive(peer)) return;
          const answer = await pc.createAnswer();
          if (!this.alive(peer)) return;
          await pc.setLocalDescription(answer);
          if (this.alive(peer)) this.sendDescription(peer);
        }
      } else if (Object.hasOwn(message, "candidate")) {
        const clean = voiceClientMessage({ type: "voicesignal", to: peer.id, candidate: message.candidate });
        if (!clean) return;
        if (!pc.remoteDescription) {
          if (peer.candidates.length < 64) peer.candidates.push(clean.candidate);
        } else await pc.addIceCandidate(clean.candidate);
      }
    }

    transportFailed() {
      this.leave();
      this.data.error = "Watchparty-Verbindung wurde getrennt";
      this.emit();
    }

    async setMuted(muted) {
      if (!this.data.joined || this.closed) return false;
      this.desiredMic = muted === false;
      this.micGeneration += 1;
      const request = this.micGeneration;
      const generation = this.generation;
      if (!this.desiredMic) {
        this.stopMicrophone();
        this.data.muted = true;
        if (!this.transmit({ type: "voicestate", muted: true })) this.transportFailed();
        this.emit();
        return true;
      }
      this.resumeAudio();
      if (this.capture) return true;
      // One permission request at a time; stale permission results are stopped
      // before a later explicit unmute can obtain its own capture.
      if (this.capturePending) await this.capturePending;
      if (!this.data.joined || generation !== this.generation || request !== this.micGeneration || !this.desiredMic) return false;
      if (!this.media?.getUserMedia) { this.data.error = "Mikrofonzugriff wird nicht unterstützt"; this.emit(); return false; }
      let pending;
      pending = (async () => {
        let stream;
        try {
          const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
          if (this.data.inputDeviceId) audio.deviceId = { exact: this.data.inputDeviceId };
          stream = await this.media.getUserMedia({ audio, video: false });
          if (!this.data.joined || generation !== this.generation || request !== this.micGeneration || !this.desiredMic) {
            for (const track of stream.getTracks()) { track.enabled = false; track.stop(); }
            if (!this.capture) this.onMicrophone(false);
            return false;
          }
          const track = stream.getAudioTracks()[0];
          if (!track) { for (const item of stream.getTracks()) item.stop(); throw new Error("No microphone"); }
          this.capture = stream;
          this.data.muted = false;
          this.data.error = "";
          track.onended = () => {
            if (this.capture === stream) {
              this.setMuted(true);
              this.data.error = "Mikrofon wurde getrennt. Zum Sprechen erneut einschalten";
              this.emit();
            }
          };
          this.onMicrophone(true);
          this.localMeter = this.createMeter(stream);
          for (const peer of this.members.values()) this.enqueue(peer, async () => {
            if (peer.sender) await peer.sender.replaceTrack(this.capture?.getAudioTracks()[0] || null);
          });
          if (!this.transmit({ type: "voicestate", muted: false })) this.transportFailed();
          this.emit();
          return true;
        } catch (error) {
          if (generation === this.generation && request === this.micGeneration && this.data.joined) {
            this.stopMicrophone();
            this.data.muted = true;
            this.desiredMic = false;
            this.data.error = error?.name === "NotAllowedError" ? "Mikrofonberechtigung wurde nicht erteilt. Zugriff erlauben und erneut einschalten"
              : ["NotFoundError", "OverconstrainedError"].includes(error?.name) ? "Das ausgewählte Mikrofon ist nicht verfügbar. In den Einstellungen ein Mikrofon wählen und erneut einschalten"
              : "Mikrofon konnte nicht geöffnet werden. Gerät und Berechtigung prüfen";
            this.emit();
          }
          return false;
        } finally { if (this.capturePending === pending) this.capturePending = null; }
      })();
      this.capturePending = pending;
      return pending;
    }

    stopMicrophone() {
      if (this.capture) {
        for (const track of this.capture.getTracks()) { track.enabled = false; track.onended = null; track.stop(); }
        this.capture = null;
      }
      this.disposeMeter(this.localMeter);
      this.localMeter = null;
      this.data.speaking = false;
      this.onMicrophone(false);
      for (const peer of this.members.values()) this.enqueue(peer, async () => {
        if (peer.sender) await peer.sender.replaceTrack(this.capture?.getAudioTracks()[0] || null);
      });
    }

    setInputDevice(deviceId) {
      if (this.closed || !inputDevice(deviceId)) return false;
      if (deviceId === this.data.inputDeviceId) return true;
      const wasCapturing = Boolean(this.capture || this.desiredMic);
      this.data.inputDeviceId = deviceId;
      this.micGeneration += 1;
      this.desiredMic = false;
      this.stopMicrophone();
      this.data.muted = true;
      if (wasCapturing) this.data.error = "Mikrofon wurde gewechselt. Zum Sprechen erneut einschalten";
      if (this.data.joined && !this.transmit({ type: "voicestate", muted: true })) this.transportFailed();
      this.emit();
      return true;
    }

    setPushToTalk(enabled) {
      this.data.pushToTalk = enabled === true;
      this.setMuted(true);
      this.emit();
    }

    pushToTalk(pressed) {
      if (!this.data.pushToTalk) return Promise.resolve(false);
      return this.setMuted(pressed !== true);
    }

    setVolume(id, value) {
      const peer = this.members.get(id);
      if (!peer || typeof value !== "number" || !Number.isFinite(value)) return false;
      peer.volume = Math.max(0, Math.min(1, value));
      if (peer.audio) peer.audio.volume = peer.volume;
      this.updateDucking();
      this.emit();
      return true;
    }

    remoteAudio(peer, event) {
      this.disposeMeter(peer.meter);
      if (peer.audio) { peer.audio.pause(); peer.audio.srcObject = null; }
      const stream = event.streams?.[0] || new this.MediaStream([event.track]);
      peer.stream = stream;
      const audio = this.createAudio();
      if (!audio) { peer.error = "Audio-Ausgabe wird nicht unterstützt"; this.emit(); return; }
      peer.audio = audio;
      audio.autoplay = true;
      audio.playsInline = true;
      audio.volume = peer.volume;
      audio.srcObject = stream;
      audio.onerror = () => { if (this.alive(peer)) { peer.playbackError = true; this.emit(); } };
      peer.meter = this.createMeter(stream);
      this.play(peer);
    }

    async play(peer) {
      try {
        await peer.audio.play();
        if (this.alive(peer)) { peer.playbackError = false; this.emit(); }
      } catch {
        if (this.alive(peer)) {
          peer.playbackError = true;
          this.updateDucking();
          this.emit();
        }
      }
    }

    retryAudio(id) {
      this.resumeAudio();
      return Promise.all([...this.members.values()].filter((peer) => peer.audio && (!id || peer.id === id)).map((peer) => this.play(peer)));
    }

    resumeAudio() {
      try {
        if (!this.context && this.AudioContext) this.context = new this.AudioContext();
        this.context?.resume()?.catch?.(() => {});
      } catch { /* Audio playback still works without optional level meters. */ }
    }

    createMeter(stream) {
      if (!this.context) return null;
      try {
        const source = this.context.createMediaStreamSource(stream);
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 256;
        const silent = this.context.createGain();
        silent.gain.value = 0;
        source.connect(analyser);
        analyser.connect(silent);
        silent.connect(this.context.destination);
        if (!this.meterTimer) {
          this.meterTimer = setInterval(() => this.meter(), 120);
          this.meterTimer.unref?.();
        }
        return { source, analyser, silent, values: new Uint8Array(analyser.fftSize), until: 0 };
      } catch { return null; }
    }

    disposeMeter(meter) {
      if (!meter) return;
      for (const node of [meter.source, meter.analyser, meter.silent]) { try { node.disconnect(); } catch {} }
    }

    speaking(meter) {
      if (!meter) return false;
      meter.analyser.getByteTimeDomainData(meter.values);
      let sum = 0;
      for (const value of meter.values) sum += ((value - 128) / 128) ** 2;
      if (Math.sqrt(sum / meter.values.length) > 0.035) meter.until = Date.now() + 350;
      return Date.now() < meter.until;
    }

    meter() {
      if (!this.data.joined) return;
      let changed = false;
      const speaking = !this.data.muted && this.speaking(this.localMeter);
      if (this.data.speaking !== speaking) { this.data.speaking = speaking; changed = true; }
      for (const peer of this.members.values()) {
        const active = !peer.muted && !["failed", "disconnected", "closed"].includes(peer.pc.connectionState) && this.speaking(peer.meter);
        if (peer.speaking !== active) { peer.speaking = active; changed = true; }
      }
      if (changed) { this.updateDucking(); this.emit(); }
    }

    updateDucking() {
      const active = this.data.joined && [...this.members.values()].some((peer) => peer.speaking && peer.volume > 0 && !peer.playbackError);
      if (active !== this.ducking) { this.ducking = active; this.onDucking(active); }
    }

    removePeer(peer) {
      this.members.delete(peer.id);
      clearTimeout(peer.timer);
      peer.pc.onicecandidate = null;
      peer.pc.ontrack = null;
      peer.pc.onconnectionstatechange = null;
      peer.pc.close();
      if (peer.audio) { peer.audio.onerror = null; peer.audio.pause(); peer.audio.srcObject = null; peer.audio.remove?.(); }
      for (const track of peer.stream?.getTracks() || []) track.stop();
      this.disposeMeter(peer.meter);
      peer.candidates.length = 0;
    }

    leave(notify = true) {
      const wasActive = this.data.joined || this.data.connecting;
      this.generation += 1;
      this.micGeneration += 1;
      this.desiredMic = false;
      clearTimeout(this.timer);
      this.timer = null;
      this.data.joined = false;
      this.data.connecting = false;
      this.data.muted = true;
      this.data.selfId = "";
      this.stopMicrophone();
      for (const peer of [...this.members.values()]) this.removePeer(peer);
      clearInterval(this.meterTimer);
      this.meterTimer = null;
      try { this.context?.close()?.catch?.(() => {}); } catch {}
      this.context = null;
      this.iceServers = [];
      this.updateDucking();
      if (notify && wasActive) this.transmit({ type: "voiceleave" });
      this.emit();
    }

    close() { this.leave(); this.closed = true; }
  }

  return { ElfixSprachchat, voiceClientMessage };
});
