"use strict";

// Relay fuer die Watchparty.
//
// Ablauf: Jemand stellt eine Serie in den Raum ("share"). Alle sehen sie als
// Vorschlag. Wer mitmachen will, tritt bei ("enter") - erst dann fliesst der
// Fortschritt dieser Serie zwischen den Beigetretenen. Nichts passiert von
// selbst, nichts wird ungefragt geteilt.
//
// Wer eine Serie eingestellt hat, darf sie wieder herausnehmen und einzelne
// Mitglieder entfernen ("kick").
//
// Raeume liegen auf der Platte, damit ein Neustart des Dienstes nicht alle
// Mitgliedschaften vergisst. Konten gibt es keine: wer den Raumcode kennt, ist
// im Raum.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 8787;
const MAX_TITEL_JE_RAUM = 100;
const RAUM_LEBENSDAUER_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_NACHRICHT = 256 * 1024;

// systemd legt das Verzeichnis an (StateDirectory); ohne systemd liegt die
// Datei neben dem Server.
const STATE_DIR = process.env.STATE_DIRECTORY || __dirname;
const STATE_FILE = path.join(STATE_DIR, "raeume.json");
const SPEICHER_VERZOEGERUNG_MS = 1000;

// raumcode -> { titel: Map<key, eintrag>, at: number }
const raeume = new Map();
let speicherTimer = null;

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

// --- Ablage -----------------------------------------------------------------

function zustandLaden() {
  let roh;
  try {
    roh = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return;
  }
  for (const [code, raum] of Object.entries(roh?.raeume || {})) {
    const titel = new Map();
    for (const eintrag of raum?.titel || []) {
      if (!eintrag?.key) continue;
      titel.set(eintrag.key, {
        ...eintrag,
        members: new Map(Array.isArray(eintrag.members) ? eintrag.members : [])
      });
    }
    raeume.set(code, { titel, at: Number(raum?.at) || Date.now() });
  }
  console.log(`Zustand geladen: ${raeume.size} Raum/Raeume`);
}

function zustandSpeichernSpaeter() {
  if (speicherTimer) return;
  speicherTimer = setTimeout(() => {
    speicherTimer = null;
    const roh = { raeume: {} };
    for (const [code, raum] of raeume) {
      roh.raeume[code] = {
        at: raum.at,
        titel: [...raum.titel.values()].map((eintrag) => ({
          ...eintrag,
          // Laufender Abgleich und sein Zeitgeber sind fluechtig.
          sync: undefined,
          syncTimer: undefined,
          members: [...eintrag.members.entries()]
        }))
      };
    }
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(roh));
    } catch (fehler) {
      console.error("Zustand konnte nicht gespeichert werden:", fehler.message);
    }
  }, SPEICHER_VERZOEGERUNG_MS);
  speicherTimer.unref?.();
}

function aufraeumen() {
  const grenze = Date.now() - RAUM_LEBENSDAUER_MS;
  let entfernt = false;
  for (const [code, raum] of raeume) {
    if (raum.at < grenze) {
      raeume.delete(code);
      entfernt = true;
    }
  }
  if (entfernt) zustandSpeichernSpaeter();
}
setInterval(aufraeumen, 60 * 60 * 1000).unref?.();

// --- Hilfen -----------------------------------------------------------------

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
    hostId: eintrag.hostId || "",
    hostName: eintrag.hostName || "",
    live: eintrag.live || null,
    addedBy: eintrag.addedBy,
    addedById: eintrag.addedById,
    addedAt: eintrag.addedAt,
    members: [...eintrag.members.values()],
    memberIds: [...eintrag.members.keys()],
    progress: eintrag.progress || null
  };
}

// --- Server -----------------------------------------------------------------

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, raeume: raeume.size, features: ["share", "enter", "kick", "persist"] }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("ELFIX Watchparty-Relay laeuft. Die App verbindet sich per WebSocket.\n");
});

const wss = new WebSocketServer({ server, maxPayload: MAX_NACHRICHT });

function anRaumSenden(raumcode, nachricht) {
  const daten = JSON.stringify(nachricht);
  for (const client of wss.clients) {
    if (client.raum !== raumcode || client.readyState !== client.OPEN) continue;
    client.send(daten);
  }
}

function teilnehmer(raumcode) {
  return [...wss.clients]
    .filter((client) => client.raum === raumcode && client.readyState === client.OPEN)
    .map((client) => client.name || "Gerät");
}

// Jeder Client erfaehrt zusaetzlich, unter welcher Kennung er hier gefuehrt
// wird ("you"). Ohne das erkennt sich ein Geraet ohne eigene Kennung nicht in
// der Mitgliederliste wieder - der Beitritt sieht dann aus, als haette er nicht
// geklappt, und Fortschritt wird nie gemeldet.
function zustandSenden(raumcode) {
  const raum = raeume.get(raumcode);
  if (!raum) return;
  const shared = [...raum.titel.values()].map(titelNachAussen);
  const peers = teilnehmer(raumcode);
  for (const client of wss.clients) {
    if (client.raum !== raumcode || client.readyState !== client.OPEN) continue;
    client.send(JSON.stringify({ type: "state", shared, peers, you: client.geraetId }));
  }
  zustandSpeichernSpaeter();
}

// Wo steht der Host jetzt? Bevorzugt aus seiner letzten Steuerung, sonst aus
// seinem laufenden Fortschritt - er meldet den ohnehin als Mitglied. Bei
// laufender Wiedergabe zaehlt die seither vergangene Zeit mit, sonst zieht man
// immer auf die Stelle von vorhin.
function hostStandJetzt(eintrag) {
  if (eintrag.live && eintrag.hostId) {
    const vergangen = eintrag.live.action === "play" ? (Date.now() - eintrag.live.at) / 1000 : 0;
    return eintrag.live.position + vergangen;
  }
  const fortschritt = eintrag.progress;
  if (fortschritt && eintrag.hostName && fortschritt.from === eintrag.hostName) {
    const gemeldet = Date.parse(fortschritt.updatedAt) || 0;
    const vergangen = gemeldet ? Math.max(0, Date.now() - gemeldet) / 1000 : 0;
    return fortschritt.position + Math.min(vergangen, 600);
  }
  return 0;
}

// Es muss immer jemanden geben, an dem sich die anderen ausrichten koennen.
// Host ist, wer zuerst da war - faellt er weg, uebernimmt der naechste
// verbundene Teilnehmer, sonst haette niemand mehr eine Referenz.
function hostSicherstellen(raumcode, eintrag) {
  const verbundene = [...wss.clients].filter((client) => (
    client.raum === raumcode && client.readyState === client.OPEN && eintrag.members.has(client.geraetId)
  ));
  if (eintrag.hostId && verbundene.some((client) => client.geraetId === eintrag.hostId)) return false;

  const neuer = verbundene[0];
  if (!neuer) return false;
  eintrag.hostId = neuer.geraetId;
  eintrag.hostName = neuer.name;
  return true;
}

// Ein Geraet, das neu installiert wurde, meldet sich mit derselben Bezeichnung,
// aber neuer Kennung. Ohne diese Uebernahme stuende es doppelt in der Liste und
// muesste ueberall neu beitreten.
function kennungUebernehmen(raum, geraetId, name) {
  if (!name) return false;
  let geaendert = false;
  for (const eintrag of raum.titel.values()) {
    for (const [alteId, alterName] of [...eintrag.members]) {
      if (alteId === geraetId || alterName !== name) continue;
      eintrag.members.delete(alteId);
      eintrag.members.set(geraetId, name);
      geaendert = true;
    }
    if (eintrag.addedBy === name && eintrag.addedById !== geraetId) {
      eintrag.addedById = geraetId;
      geaendert = true;
    }
  }
  return geaendert;
}

// Alle zusammen anlaufen lassen. Wer sich nicht gemeldet hat, bekommt den
// Startbefehl trotzdem - besser leicht versetzt als gar nicht.
function syncStarten(raumcode, eintrag) {
  if (!eintrag?.sync) return;
  const ziel = eintrag.sync.ziel;
  clearTimeout(eintrag.syncTimer);
  eintrag.sync = null;
  eintrag.live = { action: "play", position: ziel, url: eintrag.live?.url || eintrag.url, at: Date.now() };

  const daten = JSON.stringify({ type: "syncstart", key: eintrag.key, position: ziel, at: Date.now() });
  for (const client of wss.clients) {
    if (client.raum !== raumcode || client.readyState !== client.OPEN) continue;
    if (!eintrag.members.has(client.geraetId)) continue;
    client.send(daten);
  }
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
      socket.geraetId = text(nachricht.deviceId, 64) || crypto.randomUUID();
      const raum = raumHolen(socket.raum);
      kennungUebernehmen(raum, socket.geraetId, socket.name);
      for (const eintrag of raum.titel.values()) hostSicherstellen(socket.raum, eintrag);
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
        hostSicherstellen(socket.raum, eintrag);
      } else {
        eintrag.members.delete(socket.geraetId);
      }
      zustandSenden(socket.raum);
      return;
    }

    // Einzelne Mitglieder entfernen darf, wer die Serie eingestellt hat.
    if (nachricht.type === "kick") {
      const eintrag = raum.titel.get(text(nachricht.key, 300));
      const wen = text(nachricht.memberId, 64);
      if (!eintrag || eintrag.addedById !== socket.geraetId || !wen) return;
      if (wen === socket.geraetId) return;
      if (!eintrag.members.delete(wen)) return;
      zustandSenden(socket.raum);
      return;
    }

    // Live-Steuerung: Pause, Weiter, Springen und Folgenwechsel gehen sofort an
    // die anderen Beigetretenen. Wer als Erster spielt, gibt den Takt vor - er
    // ist der Host, an dem sich "Synchronisieren" orientiert.
    if (nachricht.type === "control") {
      const eintrag = raum.titel.get(text(nachricht.key, 300));
      if (!eintrag || !eintrag.members.has(socket.geraetId)) return;
      const aktion = text(nachricht.action, 10);
      if (!["play", "pause", "seek", "navigate"].includes(aktion)) return;

      hostSicherstellen(socket.raum, eintrag);
      if (!eintrag.hostId) {
        eintrag.hostId = socket.geraetId;
        eintrag.hostName = socket.name;
      }
      const ziel = httpAdresse(nachricht.url);
      if (aktion === "navigate" && ziel) eintrag.url = ziel;

      // Der Stand des Hosts ist die Referenz - daran richtet sich aus, wer
      // spaeter dazukommt oder auf "Synchronisieren" drueckt.
      if (socket.geraetId === eintrag.hostId) {
        eintrag.live = {
          action: aktion,
          position: zahl(nachricht.position, 100000),
          url: ziel || eintrag.live?.url || eintrag.url,
          at: Date.now()
        };
      }

      const daten = JSON.stringify({
        type: "control",
        key: eintrag.key,
        action: aktion,
        position: zahl(nachricht.position, 100000),
        url: ziel,
        from: socket.name,
        host: socket.geraetId === eintrag.hostId,
        at: Date.now()
      });
      for (const client of wss.clients) {
        if (client === socket || client.raum !== socket.raum || client.readyState !== client.OPEN) continue;
        if (!eintrag.members.has(client.geraetId)) continue;
        client.send(daten);
      }
      zustandSpeichernSpaeter();
      return;
    }

    // Gemeinsam gleichziehen: erst halten alle an und springen auf dieselbe
    // Stelle, dann startet der Server sie zusammen. Ohne diesen Umweg laufen
    // die Geraete sofort wieder auseinander, weil jedes anders puffert.
    if (nachricht.type === "syncall") {
      const eintrag = raum.titel.get(text(nachricht.key, 300));
      if (!eintrag || !eintrag.members.has(socket.geraetId)) return;

      // Massgeblich ist die Zeit des Hosts. Die Stelle des Ausloesers zaehlt
      // nur, wenn vom Host noch nichts bekannt ist - sonst wuerde ein
      // Nachzuegler alle anderen zu sich zurueckziehen.
      hostSicherstellen(socket.raum, eintrag);
      const ziel = hostStandJetzt(eintrag) || zahl(nachricht.position, 100000);
      const url = eintrag.live?.url || eintrag.url;

      const mitglieder = [...wss.clients].filter((client) => (
        client.raum === socket.raum && client.readyState === client.OPEN && eintrag.members.has(client.geraetId)
      ));
      eintrag.sync = { ziel, wartetAuf: new Set(mitglieder.map((c) => c.geraetId)), at: Date.now() };

      const vorbereiten = JSON.stringify({ type: "syncprepare", key: eintrag.key, position: ziel, url, from: socket.name });
      for (const client of mitglieder) client.send(vorbereiten);

      // Auch wenn jemand nicht meldet, geht es nach kurzer Zeit los.
      clearTimeout(eintrag.syncTimer);
      eintrag.syncTimer = setTimeout(() => syncStarten(socket.raum, eintrag), 4000);
      eintrag.syncTimer.unref?.();
      return;
    }

    if (nachricht.type === "syncready") {
      const eintrag = raum.titel.get(text(nachricht.key, 300));
      if (!eintrag?.sync) return;
      eintrag.sync.wartetAuf.delete(socket.geraetId);
      if (!eintrag.sync.wartetAuf.size) syncStarten(socket.raum, eintrag);
      return;
    }

    // Auf Wunsch den Stand des Hosts nachliefern ("Synchronisieren").
    if (nachricht.type === "resync") {
      const eintrag = raum.titel.get(text(nachricht.key, 300));
      if (!eintrag || !eintrag.members.has(socket.geraetId)) return;
      hostSicherstellen(socket.raum, eintrag);
      const stand = hostStandJetzt(eintrag);
      if (!stand) return;
      senden({
        type: "control",
        key: eintrag.key,
        action: eintrag.live?.action === "pause" ? "pause" : "play",
        position: stand,
        url: eintrag.live.url || eintrag.url,
        from: eintrag.hostName || "Host",
        host: true,
        resync: true,
        at: Date.now()
      });
      return;
    }

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
      // Der Zeitpunkt kommt vom Server, nicht vom Geraet: gehen die Uhren
      // auseinander, wuerden die Meldungen des einen dauerhaft als "aelter"
      // verworfen und sein Stand kaeme nie an.
      fortschritt.updatedAt = new Date().toISOString();
      fortschritt.from = fortschritt.from || socket.name;
      eintrag.progress = fortschritt;
      if (fortschritt.url) eintrag.url = fortschritt.url;
      eintrag.season = fortschritt.season || eintrag.season;
      eintrag.episode = fortschritt.episode || eintrag.episode;
      zustandSpeichernSpaeter();

      const daten = JSON.stringify({ type: "progress", key: eintrag.key, progress: fortschritt });
      for (const client of wss.clients) {
        if (client === socket || client.raum !== socket.raum || client.readyState !== client.OPEN) continue;
        if (!eintrag.members.has(client.geraetId)) continue;
        client.send(daten);
      }
    }
  });

  socket.on("close", () => {
    if (!socket.raum) return;
    const raum = raeume.get(socket.raum);
    let gewechselt = false;
    for (const eintrag of raum?.titel.values() || []) {
      if (eintrag.hostId === socket.geraetId) {
        eintrag.hostId = "";
        gewechselt = hostSicherstellen(socket.raum, eintrag) || gewechselt;
      }
    }
    if (gewechselt) zustandSenden(socket.raum);
    else anRaumSenden(socket.raum, { type: "peers", peers: teilnehmer(socket.raum) });
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

zustandLaden();
server.listen(PORT, () => {
  console.log(`ELFIX Watchparty-Relay auf Port ${PORT} (Ablage: ${STATE_FILE})`);
});
