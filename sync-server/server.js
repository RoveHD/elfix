"use strict";

// Relay fuer die Watchparty.
//
// Ablauf: Jemand stellt eine Serie in den Raum ("share"). Alle sehen sie als
// Vorschlag. Wer mitmachen will, tritt bei ("enter") - erst dann fliesst der
// Fortschritt dieser Serie zwischen den Beigetretenen. Nichts passiert von
// selbst, nichts wird ungefragt geteilt.
//
// Der Server haelt alles nur im Arbeitsspeicher: keine Datenbank, keine Konten.
// Wer den Raumcode kennt, ist im Raum.

const http = require("http");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 8787;
const MAX_TITEL_JE_RAUM = 100;
const RAUM_LEBENSDAUER_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_NACHRICHT = 256 * 1024;

// raumcode -> { titel: Map<key, eintrag>, at: number }
const raeume = new Map();

function raumHolen(code) {
  const vorhanden = raeume.get(code);
  if (vorhanden) {
    vorhanden.at = Date.now();
    return vorhanden;
  }
  const neu = { titel: new Map(), at: Date.now() };
  raeume.set(code, neu);
  return neu;
}

function aufraeumen() {
  const grenze = Date.now() - RAUM_LEBENSDAUER_MS;
  for (const [code, raum] of raeume) {
    if (raum.at < grenze) raeume.delete(code);
  }
}
setInterval(aufraeumen, 60 * 60 * 1000).unref?.();

function istGueltigerCode(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(value);
}

function text(value, laenge) {
  return String(value == null ? "" : value).slice(0, laenge);
}

function zahl(value, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0;
}

function httpAdresse(value) {
  const wert = text(value, 800);
  return /^https?:\/\//i.test(wert) ? wert : "";
}

// Eine geteilte Serie, wie sie im Raum steht.
function titelSaeubern(roh) {
  const key = text(roh?.key, 300);
  const url = httpAdresse(roh?.url);
  if (!key || !url) return null;
  return {
    key,
    url,
    title: text(roh?.title, 300),
    providerName: text(roh?.providerName, 80),
    thumbnail: httpAdresse(roh?.thumbnail),
    type: text(roh?.type, 20),
    season: zahl(roh?.season, 999),
    episode: zahl(roh?.episode, 9999)
  };
}

function fortschrittSaeubern(roh) {
  if (!roh || typeof roh !== "object") return null;
  return {
    url: httpAdresse(roh.url),
    season: zahl(roh.season, 999),
    episode: zahl(roh.episode, 9999),
    position: zahl(roh.position, 100000),
    duration: zahl(roh.duration, 100000),
    progress: zahl(roh.progress, 100),
    completed: Boolean(roh.completed),
    episodeCompleted: Boolean(roh.episodeCompleted),
    updatedAt: text(roh.updatedAt || new Date().toISOString(), 40),
    from: text(roh.from, 60)
  };
}

// Fuer die Uebertragung: Mitglieder als Namensliste statt als Map.
function titelNachAussen(eintrag) {
  return {
    key: eintrag.key,
    url: eintrag.url,
    title: eintrag.title,
    providerName: eintrag.providerName,
    thumbnail: eintrag.thumbnail,
    type: eintrag.type,
    season: eintrag.season,
    episode: eintrag.episode,
    addedBy: eintrag.addedBy,
    addedById: eintrag.addedById,
    addedAt: eintrag.addedAt,
    members: [...eintrag.members.values()],
    memberIds: [...eintrag.members.keys()],
    progress: eintrag.progress || null
  };
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, raeume: raeume.size }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("ELFIX Watchparty-Relay laeuft. Die App verbindet sich per WebSocket.\n");
});

const wss = new WebSocketServer({ server, maxPayload: MAX_NACHRICHT });

function anRaumSenden(raumcode, nachricht, ausser = null) {
  const daten = JSON.stringify(nachricht);
  for (const client of wss.clients) {
    if (client.raum !== raumcode || client.readyState !== client.OPEN) continue;
    if (ausser && client === ausser) continue;
    client.send(daten);
  }
}

function zustandSenden(raumcode) {
  const raum = raeume.get(raumcode);
  if (!raum) return;
  anRaumSenden(raumcode, {
    type: "state",
    shared: [...raum.titel.values()].map(titelNachAussen),
    peers: teilnehmer(raumcode)
  });
}

function teilnehmer(raumcode) {
  return [...wss.clients]
    .filter((client) => client.raum === raumcode && client.readyState === client.OPEN)
    .map((client) => client.name || "Gerät");
}

wss.on("connection", (socket) => {
  socket.raum = "";
  socket.geraetId = "";
  socket.name = "";
  socket.isAlive = true;
  socket.on("pong", () => { socket.isAlive = true; });

  const senden = (nachricht) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(nachricht));
  };

  socket.on("message", (rohdaten) => {
    let nachricht;
    try {
      nachricht = JSON.parse(String(rohdaten));
    } catch {
      return;
    }

    if (nachricht?.type === "join") {
      if (!istGueltigerCode(nachricht.room)) {
        senden({ type: "error", message: "Ungueltiger Raumcode" });
        return;
      }
      socket.raum = nachricht.room;
      socket.name = text(nachricht.name, 40) || "Gerät";
      // Die Geraete-ID kommt vom Client und ueberlebt Neustarts - sonst waere
      // eine Mitgliedschaft nach jedem Neuverbinden verloren.
      socket.geraetId = text(nachricht.deviceId, 64) || crypto.randomUUID();
      raumHolen(socket.raum);
      zustandSenden(socket.raum);
      return;
    }

    if (!socket.raum) return;
    const raum = raumHolen(socket.raum);

    // Eine Serie in den Raum stellen. Wer sie einstellt, ist automatisch dabei.
    if (nachricht.type === "share") {
      const eintrag = titelSaeubern(nachricht.item);
      if (!eintrag) return;
      if (raum.titel.size >= MAX_TITEL_JE_RAUM && !raum.titel.has(eintrag.key)) return;

      const bekannt = raum.titel.get(eintrag.key);
      const gespeichert = bekannt || {
        ...eintrag,
        addedBy: socket.name,
        addedById: socket.geraetId,
        addedAt: new Date().toISOString(),
        members: new Map(),
        progress: null
      };
      if (bekannt) Object.assign(gespeichert, eintrag);
      gespeichert.members.set(socket.geraetId, socket.name);
      raum.titel.set(eintrag.key, gespeichert);
      zustandSenden(socket.raum);
      return;
    }

    if (nachricht.type === "enter" || nachricht.type === "leave") {
      const eintrag = raum.titel.get(text(nachricht.key, 300));
      if (!eintrag) return;
      if (nachricht.type === "enter") {
        eintrag.members.set(socket.geraetId, socket.name);
      } else {
        eintrag.members.delete(socket.geraetId);
      }
      zustandSenden(socket.raum);
      return;
    }

    // Eine Serie ganz aus dem Raum nehmen darf, wer sie eingestellt hat.
    if (nachricht.type === "unshare") {
      const key = text(nachricht.key, 300);
      const eintrag = raum.titel.get(key);
      if (!eintrag || eintrag.addedById !== socket.geraetId) return;
      raum.titel.delete(key);
      zustandSenden(socket.raum);
      return;
    }

    // Fortschritt zaehlt nur von Beigetretenen und geht nur an Beigetretene.
    if (nachricht.type === "progress") {
      const eintrag = raum.titel.get(text(nachricht.key, 300));
      if (!eintrag || !eintrag.members.has(socket.geraetId)) return;
      const fortschritt = fortschrittSaeubern(nachricht.progress);
      if (!fortschritt) return;
      const bekannt = eintrag.progress;
      if (bekannt && Date.parse(fortschritt.updatedAt) <= Date.parse(bekannt.updatedAt)) return;
      eintrag.progress = fortschritt;
      if (fortschritt.url) eintrag.url = fortschritt.url;
      eintrag.season = fortschritt.season || eintrag.season;
      eintrag.episode = fortschritt.episode || eintrag.episode;

      const daten = JSON.stringify({ type: "progress", key: eintrag.key, progress: fortschritt });
      for (const client of wss.clients) {
        if (client === socket || client.raum !== socket.raum || client.readyState !== client.OPEN) continue;
        if (!eintrag.members.has(client.geraetId)) continue;
        client.send(daten);
      }
    }
  });

  socket.on("close", () => {
    if (socket.raum) anRaumSenden(socket.raum, { type: "peers", peers: teilnehmer(socket.raum) });
  });
});

setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, 30000).unref?.();

server.listen(PORT, () => {
  console.log(`ELFIX Watchparty-Relay auf Port ${PORT}`);
});
