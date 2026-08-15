"use strict";

// Relay fuer die Watchparty: verteilt Fortschritts-Meldungen zwischen den
// Geraeten eines Raums. Der Server merkt sich nur den letzten Stand je Titel im
// Arbeitsspeicher, damit ein spaeter beitretendes Geraet nicht bei null steht.
// Keine Datenbank, keine Konten - wer den Raumcode hat, ist im Raum.

const http = require("http");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 8787;
const MAX_RAUM_TITEL = 400;
const RAUM_LEBENSDAUER_MS = 7 * 24 * 60 * 60 * 1000;
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

// Raeume, in denen lange nichts passiert ist, wieder freigeben.
function aufraeumen() {
  const grenze = Date.now() - RAUM_LEBENSDAUER_MS;
  for (const [code, raum] of raeume) {
    if (raum.at < grenze) raeume.delete(code);
  }
}
setInterval(aufraeumen, 60 * 60 * 1000).unref?.();

function istGueltigerCode(value) {
  return typeof value === "string" && /^[A-Za-z0-9-]{4,64}$/.test(value);
}

// Nur die Felder weiterreichen, die zum Weiterschauen gebraucht werden.
function eintragSaeubern(roh) {
  if (!roh || typeof roh !== "object") return null;
  const key = String(roh.key || "").slice(0, 300);
  const url = String(roh.url || "").slice(0, 800);
  if (!key || !/^https?:\/\//i.test(url)) return null;

  const zahl = (wert, max) => {
    const n = Number(wert);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0;
  };
  return {
    key,
    url,
    title: String(roh.title || "").slice(0, 300),
    providerName: String(roh.providerName || "").slice(0, 80),
    thumbnail: /^https?:\/\//i.test(String(roh.thumbnail || "")) ? String(roh.thumbnail).slice(0, 800) : "",
    season: zahl(roh.season, 999),
    episode: zahl(roh.episode, 9999),
    position: zahl(roh.position, 100000),
    duration: zahl(roh.duration, 100000),
    progress: zahl(roh.progress, 100),
    completed: Boolean(roh.completed),
    episodeCompleted: Boolean(roh.episodeCompleted),
    hidden: Boolean(roh.hidden),
    updatedAt: String(roh.updatedAt || new Date().toISOString()).slice(0, 40),
    from: String(roh.from || "").slice(0, 60)
  };
}

function istNeuer(links, rechts) {
  return Date.parse(links?.updatedAt || 0) > Date.parse(rechts?.updatedAt || 0);
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

wss.on("connection", (socket) => {
  socket.raum = "";
  socket.geraet = crypto.randomUUID().slice(0, 8);
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
      socket.name = String(nachricht.name || "").slice(0, 40);
      const raum = raumHolen(socket.raum);
      // Beim Beitritt bekommt das Geraet den bekannten Stand des Raums.
      senden({ type: "sync", items: [...raum.titel.values()], device: socket.geraet });
      verteileTeilnehmer(socket.raum);
      return;
    }

    if (nachricht?.type === "progress" && socket.raum) {
      const raum = raumHolen(socket.raum);
      const uebernommen = [];
      for (const roh of Array.isArray(nachricht.items) ? nachricht.items.slice(0, 200) : []) {
        const eintrag = eintragSaeubern(roh);
        if (!eintrag) continue;
        const bekannt = raum.titel.get(eintrag.key);
        if (bekannt && !istNeuer(eintrag, bekannt)) continue;
        raum.titel.set(eintrag.key, eintrag);
        uebernommen.push(eintrag);
      }
      // Aeltere Titel verwerfen, damit ein Raum nicht unbegrenzt waechst.
      if (raum.titel.size > MAX_RAUM_TITEL) {
        const sortiert = [...raum.titel.entries()]
          .sort((links, rechts) => Date.parse(rechts[1].updatedAt) - Date.parse(links[1].updatedAt));
        raum.titel = new Map(sortiert.slice(0, MAX_RAUM_TITEL));
      }
      if (!uebernommen.length) return;

      for (const client of wss.clients) {
        if (client === socket || client.raum !== socket.raum || client.readyState !== client.OPEN) continue;
        client.send(JSON.stringify({ type: "progress", items: uebernommen }));
      }
    }
  });

  socket.on("close", () => verteileTeilnehmer(socket.raum));
});

function verteileTeilnehmer(raum) {
  if (!raum) return;
  const namen = [...wss.clients]
    .filter((client) => client.raum === raum && client.readyState === client.OPEN)
    .map((client) => client.name || "Gerät");
  for (const client of wss.clients) {
    if (client.raum !== raum || client.readyState !== client.OPEN) continue;
    client.send(JSON.stringify({ type: "peers", peers: namen }));
  }
}

// Tote Verbindungen erkennen - Free-Tier-Hoster kappen Leitungen gern still.
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
