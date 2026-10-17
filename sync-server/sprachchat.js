"use strict";

const crypto = require("crypto");
const CLIENT_TYPES = new Set(["voicejoin", "voiceleave", "voicestate", "voicesignal"]);
const MAX_BYTES = 32768;
const object = (value) => value && typeof value === "object" && !Array.isArray(value);

// Only signalling is relayed. Membership and identity belong to the authenticated
// socket, never to IDs, names or room codes supplied in a voice message.
class SprachchatRelay {
  constructor(options = {}) {
    this.rooms = new Map();
    this.members = new Map();
    this.rates = new WeakMap();
    this.env = options.env || process.env;
    this.now = options.now || Date.now;
  }

  send(socket, message) {
    if (socket.readyState === 1) socket.send(JSON.stringify(message));
  }

  error(socket, code, message) {
    this.send(socket, { type: "voiceerror", code, message });
  }

  peers(room) {
    return [...(this.rooms.get(room)?.values() || [])].map(({ id, name, muted }) => ({ id, name, muted }));
  }

  broadcast(room) {
    const message = { type: "voicepeers", peers: this.peers(room) };
    for (const member of this.rooms.get(room)?.values() || []) this.send(member.socket, message);
  }

  leave(socket, reason = "left", notify = true) {
    const member = this.members.get(socket);
    if (!member) return;
    this.members.delete(socket);
    const room = this.rooms.get(member.room);
    room?.delete(member.id);
    if (!room?.size) this.rooms.delete(member.room);
    if (notify) this.send(socket, { type: "voiceleft", reason });
    this.broadcast(member.room);
  }

  iceServers(id) {
    let servers;
    try {
      servers = JSON.parse(this.env.ELFIX_VOICE_ICE_SERVERS || '[{"urls":"stun:stun.l.google.com:19302"}]');
    } catch { throw new Error("ICE-Konfiguration ist ungültig"); }
    if (!Array.isArray(servers) || servers.length > 12) throw new Error("ICE-Konfiguration ist ungültig");
    return servers.map((server) => {
      const urls = typeof server?.urls === "string" ? [server.urls] : server?.urls;
      if (!Array.isArray(urls) || !urls.length || urls.length > 8
          || urls.some((url) => typeof url !== "string" || url.length > 1000 || !/^(stun|stuns|turn|turns):[^\s]+$/i.test(url))) {
        throw new Error("ICE-Konfiguration ist ungültig");
      }
      const result = { urls };
      if (urls.some((url) => /^turns?:/i.test(url)) && this.env.ELFIX_VOICE_TURN_SECRET) {
        // coturn REST credentials expire; the shared server secret stays here.
        const ttl = Math.max(60, Math.min(86400, Number(this.env.ELFIX_VOICE_TURN_TTL) || 3600));
        result.username = `${Math.floor(this.now() / 1000) + ttl}:${id}`;
        result.credential = crypto.createHmac("sha1", this.env.ELFIX_VOICE_TURN_SECRET).update(result.username).digest("base64");
      } else {
        if (typeof server.username === "string") result.username = server.username;
        if (typeof server.credential === "string") result.credential = server.credential;
      }
      return result;
    });
  }

  handle(socket, message, bytes) {
    if (!CLIENT_TYPES.has(message?.type)) return false;
    if (!socket.raum || !socket.geraetId) {
      this.error(socket, "not-authenticated", "Zuerst der Watchparty beitreten");
      return true;
    }
    if ((bytes || Buffer.byteLength(JSON.stringify(message))) > MAX_BYTES) {
      this.error(socket, "too-large", "Sprachchat-Nachricht ist zu groß");
      return true;
    }
    // Privacy/lifecycle cleanup must remain possible even after a signal burst.
    if (message.type === "voiceleave") {
      this.leave(socket);
      return true;
    }
    // Token bucket per socket, independent of the Watchparty/player traffic.
    const now = this.now();
    const rate = this.rates.get(socket) || { at: now, tokens: 100 };
    rate.tokens = Math.min(100, rate.tokens + Math.max(0, now - rate.at) * 0.025);
    rate.at = now;
    const cost = message.type === "voicejoin" ? 10 : 1;
    if (rate.tokens < cost) {
      if (!rate.warned || now - rate.warned > 1000) {
        this.error(socket, "rate-limit", "Zu viele Sprachchat-Nachrichten");
        rate.warned = now;
      }
      this.rates.set(socket, rate);
      return true;
    }
    rate.tokens -= cost;
    this.rates.set(socket, rate);
    if (message.type === "voicejoin") {
      const existing = this.members.get(socket);
      if (existing) return true; // Retransmission cannot reset another participant.
      const room = this.rooms.get(socket.raum) || new Map();
      const duplicates = [...room.values()].filter((member) => member.device === socket.geraetId
        || (socket.konto && member.account === socket.konto));
      if (room.size - duplicates.length >= 8) {
        this.error(socket, "room-full", "Im Sprachchat können höchstens acht Personen sein");
        return true;
      }
      const id = crypto.randomBytes(16).toString("hex");
      let iceServers;
      try { iceServers = this.iceServers(id); }
      catch { this.error(socket, "ice-config", "Die Sprachchat-Netzkonfiguration des Relays ist ungültig"); return true; }
      for (const duplicate of duplicates) this.leave(duplicate.socket, "replaced");
      const current = this.rooms.get(socket.raum) || new Map();
      current.set(id, { id, socket, room: socket.raum, device: socket.geraetId,
        account: socket.konto || "", name: String(socket.name || "Gerät").slice(0, 40), muted: true });
      this.rooms.set(socket.raum, current);
      this.members.set(socket, current.get(id));
      this.send(socket, { type: "voicewelcome", selfId: id, peers: this.peers(socket.raum), iceServers });
      this.broadcast(socket.raum);
      return true;
    }
    const member = this.members.get(socket);
    if (!member || member.room !== socket.raum) {
      this.error(socket, "not-joined", "Zuerst dem Sprachchat beitreten");
      return true;
    }
    if (message.type === "voicestate") {
      if (typeof message.muted !== "boolean") return true;
      if (member.muted !== message.muted) {
        member.muted = message.muted;
        this.broadcast(member.room);
      }
      return true;
    }
    const target = this.rooms.get(member.room)?.get(message.to);
    if (!target || target === member) {
      this.error(socket, "peer-missing", "Sprachchat-Teilnehmer ist nicht mehr verbunden");
      return true;
    }
    const result = { type: "voicesignal", from: member.id };
    if (object(message.description) && !Object.hasOwn(message, "candidate")) {
      const { type, sdp } = message.description;
      if (!["offer", "answer"].includes(type) || typeof sdp !== "string" || sdp.length > 24000
        || !sdp.startsWith("v=0") || !/(?:^|\r?\n)m=audio /m.test(sdp)
        || /(?:^|\r?\n)m=(?!audio )/m.test(sdp)) {
        this.error(socket, "invalid-signal", "Ungültige Audio-Verhandlung"); return true;
      }
      result.description = { type, sdp };
    } else if (Object.hasOwn(message, "candidate") && !Object.hasOwn(message, "description")) {
      if (message.candidate === null) result.candidate = null;
      else {
        const candidate = message.candidate;
        if (!object(candidate) || typeof candidate.candidate !== "string" || candidate.candidate.length > 2000
          || (candidate.sdpMid != null && (typeof candidate.sdpMid !== "string" || candidate.sdpMid.length > 64))
          || (candidate.sdpMLineIndex != null && (!Number.isInteger(candidate.sdpMLineIndex) || candidate.sdpMLineIndex !== 0))
          || (candidate.usernameFragment != null && (typeof candidate.usernameFragment !== "string" || candidate.usernameFragment.length > 256))) {
          this.error(socket, "invalid-signal", "Ungültiger Audio-Netzwerkkandidat"); return true;
        }
        result.candidate = { candidate: candidate.candidate, sdpMid: candidate.sdpMid ?? null,
          sdpMLineIndex: candidate.sdpMLineIndex ?? null };
        if (candidate.usernameFragment) result.candidate.usernameFragment = candidate.usernameFragment;
      }
    } else { this.error(socket, "invalid-signal", "Ungültige Sprachchat-Nachricht"); return true; }
    this.send(target.socket, result);
    return true;
  }
}

module.exports = { SprachchatRelay, CLIENT_TYPES, MAX_BYTES };
