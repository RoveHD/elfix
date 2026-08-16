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
// Hoechstens so oft geht der Stand aller Geraete an die Runde.
const STAND_TAKT_MS = 1000;

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
        members: new Map(Array.isArray(eintrag.members) ? eintrag.members : []),
        // Nie aus der Datei uebernehmen: als einfaches Objekt waere es keine
        // Map und der erste Eintrag wuerde den Dienst abraeumen.
        stand: new Map()
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
          // Laufender Abgleich, sein Zeitgeber und der Stand je Geraet sind
          // fluechtig - die Geraete melden ihn nach einem Neustart selbst.
          sync: undefined,
          syncTimer: undefined,
          stand: undefined,
          standTimer: undefined,
          standGesendet: undefined,
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

// Raumcodes duerfen Buchstaben aller Sprachen enthalten - "Gummikaese" mit ae
// als Umlaut ist ein voellig normaler Name und wurde vorher abgewiesen.
// Zusammengesetzte Umlaute (a + Trema) werden vorher zusammengezogen, sonst
// landen zwei Geraete je nach Tastatur in verschiedenen Raeumen.
function codeNormalisieren(value) {
  return typeof value === "string" ? value.normalize("NFC") : "";
}

function istGueltigerCode(value) {
  return /^[\p{L}\p{N}_-]{4,64}$/u.test(codeNormalisieren(value));
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
    res.end(JSON.stringify({
      ok: true,
      raeume: raeume.size,
      // "syncall" und "hostpause" sagen der App, dass dieses Relay das genaue
      // Gleichziehen und die Pause auf die Host-Zeit beherrscht.
      features: ["share", "enter", "kick", "persist", "syncall", "hostpause", "watchstate", "here"]
    }));
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
//
// Rueckgabe null heisst "vom Host ist nichts bekannt". Frueher stand dafuer 0,
// und damit war der Anfang einer Folge nicht von "keine Ahnung" zu
// unterscheiden: direkt nach einem Folgenwechsel steht der Host bei 0, und der
// Abgleich lieferte deshalb gar keine Antwort mehr.
function hostStandJetzt(eintrag) {
  const kandidaten = [];
  if (eintrag.live && eintrag.hostId) {
    kandidaten.push({
      at: Number(eintrag.live.at) || 0,
      position: eintrag.live.position,
      laeuft: eintrag.live.action === "play"
    });
  }
  const fortschritt = eintrag.progress;
  if (fortschritt && eintrag.hostName && fortschritt.from === eintrag.hostName) {
    const gemeldet = Date.parse(fortschritt.updatedAt) || 0;
    if (gemeldet) {
      kandidaten.push({
        at: gemeldet,
        position: fortschritt.position,
        laeuft: eintrag.live?.action !== "pause"
      });
    }
  }
  if (!kandidaten.length) return null;

  // Die juengste Meldung zaehlt. Der Host meldet `live` nur, wenn er drueckt -
  // laeuft er lange durch, ist diese Stelle Minuten alt, und die Hochrechnung
  // unterstellt lueckenloses Abspielen. Jedes Puffern schiebt sie nach vorn,
  // und der Abgleich sprang dadurch immer ein Stueck zu weit. Der Fortschritt
  // kommt alle paar Sekunden frisch aus dem Player und korrigiert das.
  const neueste = kandidaten.sort((links, rechts) => rechts.at - links.at)[0];
  const vergangen = neueste.laeuft ? Math.max(0, Date.now() - neueste.at) / 1000 : 0;
  return neueste.position + Math.min(vergangen, 600);
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
  if (!neuer) {
    // Niemand da: der alte Name darf nicht stehen bleiben, sonst zeigt die
    // Anzeige einen Host, der laengst weg ist. Der Naechste, der kommt,
    // uebernimmt.
    if (!eintrag.hostId && !eintrag.hostName) return false;
    eintrag.hostId = "";
    eintrag.hostName = "";
    return true;
  }
  eintrag.hostId = neuer.geraetId;
  eintrag.hostName = neuer.name;
  return true;
}

// Ein Geraet, das neu installiert wurde, meldet sich mit derselben Bezeichnung,
// aber neuer Kennung. Ohne diese Uebernahme stuende es doppelt in der Liste und
// muesste ueberall neu beitreten.
// Benennt jemand sein Geraet um, bleibt es dasselbe Geraet: die Kennung ist
// dieselbe, also wird ueberall nur der Name nachgezogen. Ohne das stand in den
// Mitgliederlisten weiter der alte Name, und niemand wusste, wer gemeint ist.
function namenNachziehen(raum, geraetId, name) {
  if (!geraetId || !name) return false;
  let geaendert = false;
  for (const eintrag of raum.titel.values()) {
    if (eintrag.members.has(geraetId) && eintrag.members.get(geraetId) !== name) {
      eintrag.members.set(geraetId, name);
      geaendert = true;
    }
    if (eintrag.hostId === geraetId && eintrag.hostName !== name) {
      eintrag.hostName = name;
      geaendert = true;
    }
    if (eintrag.addedById === geraetId && eintrag.addedBy !== name) {
      eintrag.addedBy = name;
      geaendert = true;
    }
  }
  return geaendert;
}

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

// Wer steht wo? Je Mitglied die zuletzt bekannte Stelle und ob dort gerade
// angehalten ist. Damit zeigt die App eine Leiste, auf der man sieht, ob alle
// beieinander sind - vorher war das reine Vermutung.
//
// Der Stand ist fluechtig wie `sync`: nach einem Neustart des Dienstes melden
// ihn die Geraete binnen Sekunden von selbst wieder.
function standSetzen(eintrag, geraetId, name, werte) {
  if (!geraetId || !eintrag.members.has(geraetId)) return;
  if (!eintrag.stand) eintrag.stand = new Map();
  const vorher = eintrag.stand.get(geraetId) || {};
  eintrag.stand.set(geraetId, {
    name: name || vorher.name || eintrag.members.get(geraetId) || "Gerät",
    position: werte.position == null ? (vorher.position || 0) : werte.position,
    paused: werte.paused == null ? Boolean(vorher.paused) : Boolean(werte.paused),
    season: werte.season == null ? (vorher.season || 0) : werte.season,
    episode: werte.episode == null ? (vorher.episode || 0) : werte.episode,
    at: Date.now()
  });
}

// Ein Befehl gilt fuer alle Beigetretenen - also stehen danach auch alle dort.
function standFuerAlle(eintrag, position, paused) {
  for (const geraetId of eintrag.members.keys()) {
    standSetzen(eintrag, geraetId, eintrag.members.get(geraetId), { position, paused });
  }
}

function standNachAussen(eintrag) {
  if (!eintrag.stand) return [];
  return [...eintrag.stand.entries()]
    .filter(([geraetId]) => eintrag.members.has(geraetId))
    .map(([geraetId, wert]) => ({
      id: geraetId,
      name: wert.name,
      position: wert.position,
      paused: wert.paused,
      season: wert.season || 0,
      episode: wert.episode || 0,
      at: wert.at,
      host: geraetId === eintrag.hostId
    }));
}

function standSenden(raumcode, eintrag) {
  clearTimeout(eintrag.standTimer);
  eintrag.standTimer = null;
  eintrag.standGesendet = Date.now();
  const daten = JSON.stringify({ type: "watchstate", key: eintrag.key, members: standNachAussen(eintrag) });
  for (const client of wss.clients) {
    if (client.raum !== raumcode || client.readyState !== client.OPEN) continue;
    if (!eintrag.members.has(client.geraetId)) continue;
    client.send(daten);
  }
}

// Jedes Geraet meldet im Sekundentakt - daraus muessen nicht ebenso viele
// Rundsendungen werden. Einmal pro Sekunde reicht, der Rest wird zusammengefasst.
function standSendenGedrosselt(raumcode, eintrag) {
  const seit = Date.now() - (eintrag.standGesendet || 0);
  if (seit >= STAND_TAKT_MS) {
    standSenden(raumcode, eintrag);
    return;
  }
  if (eintrag.standTimer) return;
  eintrag.standTimer = setTimeout(() => {
    eintrag.standTimer = null;
    standSenden(raumcode, eintrag);
  }, STAND_TAKT_MS - seit);
  eintrag.standTimer.unref?.();
}

// Aus der Adresse lesen, welche Folge das ist. Ein Folgenwechsel meldet nur die
// neue Adresse - ohne das blieb in der Runde "Staffel 1 Folge 1" stehen,
// obwohl laengst Folge 2 lief.
function folgeAusAdresse(url) {
  const pfad = String(url || "");
  const staffel = pfad.match(/\/(?:staffel|season)-(\d+)/i);
  const folge = pfad.match(/\/(?:episode|folge)-(\d+)/i);
  return {
    season: staffel ? Number(staffel[1]) || 0 : 0,
    episode: folge ? Number(folge[1]) || 0 : 0
  };
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
  standFuerAlle(eintrag, ziel, false);
  standSenden(raumcode, eintrag);
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
      socket.raum = codeNormalisieren(nachricht.room);
      socket.name = text(nachricht.name, 40) || "Gerät";
      socket.geraetId = text(nachricht.deviceId, 64) || crypto.randomUUID();
      const raum = raumHolen(socket.raum);
      kennungUebernehmen(raum, socket.geraetId, socket.name);
      namenNachziehen(raum, socket.geraetId, socket.name);
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
        eintrag.stand?.delete(socket.geraetId);
        // Wer aussteigt, kann nicht Host bleiben - sonst gleichen sich alle
        // weiter mit jemandem ab, der gar nicht mehr mitschaut.
        hostSicherstellen(socket.raum, eintrag);
      }
      zustandSenden(socket.raum);
      standSenden(socket.raum, eintrag);
      return;
    }

    // Einzelne Mitglieder entfernen darf, wer die Serie eingestellt hat.
    if (nachricht.type === "kick") {
      const eintrag = raum.titel.get(text(nachricht.key, 300));
      const wen = text(nachricht.memberId, 64);
      if (!eintrag || eintrag.addedById !== socket.geraetId || !wen) return;
      if (wen === socket.geraetId) return;
      if (!eintrag.members.delete(wen)) return;
      eintrag.stand?.delete(wen);
      hostSicherstellen(socket.raum, eintrag);
      zustandSenden(socket.raum);
      standSenden(socket.raum, eintrag);
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
      const istHost = socket.geraetId === eintrag.hostId;
      const eigen = zahl(nachricht.position, 100000);
      let neueFolge = false;

      // Neue Folge: der alte Stand gilt nicht mehr. Bliebe er stehen, zoege
      // der naechste Abgleich alle auf eine Stelle aus der Folge davor.
      if (aktion === "navigate") {
        // Wer dem Wechsel nur nachzieht, meldet dieselbe Adresse zurueck. Das
        // ist keine neue Folge - sonst faellt der Stand bei jedem Nachzuegler
        // wieder auf null und die Runde faengt dreimal von vorn an.
        const schonDort = Boolean(ziel) && eintrag.live?.url === ziel;
        if (ziel) {
          eintrag.url = ziel;
          // Auch die Folgenangabe: sie steckt in der Adresse, wurde hier aber
          // nie ausgelesen - nur der Fortschritt hat sie je nachgezogen.
          const folge = folgeAusAdresse(ziel);
          if (folge.episode && folge.episode !== eintrag.episode) {
            eintrag.season = folge.season || eintrag.season;
            eintrag.episode = folge.episode;
            neueFolge = true;
          }
        }
        if (!schonDort) {
          eintrag.live = { action: "pause", position: 0, url: ziel || eintrag.url, at: Date.now() };
          eintrag.sync = null;
          clearTimeout(eintrag.syncTimer);
        }
      }

      // Bei einer Pause zaehlt die Zeit des Hosts: danach stehen alle exakt
      // dort, auch wer selbst gedrueckt hat. Pausiert der Host, ist seine
      // gemeldete Stelle genauer als jede Hochrechnung.
      const hostStand = hostStandJetzt(eintrag);
      const gemeinsam = aktion === "pause" && !istHost && hostStand != null ? hostStand : eigen;

      // Der zuletzt an alle geschickte Befehl ist der Stand der Runde - egal,
      // von wem er kam. Nur so passt das, woran sich ein Abgleich orientiert,
      // zu dem, was auf den Geraeten wirklich laeuft.
      if (aktion !== "navigate" && (istHost || aktion === "pause")) {
        eintrag.live = {
          action: aktion,
          position: gemeinsam,
          url: ziel || eintrag.live?.url || eintrag.url,
          at: Date.now()
        };
      }

      const daten = JSON.stringify({
        type: "control",
        key: eintrag.key,
        action: aktion,
        position: gemeinsam,
        url: ziel,
        from: socket.name,
        host: istHost,
        at: Date.now()
      });
      for (const client of wss.clients) {
        if (client.raum !== socket.raum || client.readyState !== client.OPEN) continue;
        if (!eintrag.members.has(client.geraetId)) continue;
        // Eine Pause geht auch an den, der sie ausgeloest hat: er soll auf
        // dieselbe Sekunde ruecken wie alle anderen. Bei allem anderen waere
        // das nur ein Echo der eigenen Tat.
        if (client === socket && !(aktion === "pause" && !istHost)) continue;
        client.send(daten);
      }

      // Fuer die Leiste: nach einem Befehl stehen alle Beigetretenen dort.
      if (aktion === "pause") standFuerAlle(eintrag, gemeinsam, true);
      else if (aktion === "play") standFuerAlle(eintrag, gemeinsam, false);
      else if (aktion === "seek") standFuerAlle(eintrag, gemeinsam, null);
      else if (aktion === "navigate") standFuerAlle(eintrag, 0, true);
      standSenden(socket.raum, eintrag);

      // Steht die Runde jetzt auf einer anderen Folge, muessen es alle sehen -
      // sonst zeigt die Karte weiter die Folge von vorhin.
      if (neueFolge) zustandSenden(socket.raum);
      else zustandSpeichernSpaeter();
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
      const hostStand = hostStandJetzt(eintrag);
      const ziel = hostStand == null ? zahl(nachricht.position, 100000) : hostStand;
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

    // Ein Geraet sagt, wo es steht. Kommt im Sekundentakt und traegt die
    // Leiste - unabhaengig davon, ob gerade ein Fortschritt gebucht wurde.
    if (nachricht.type === "here") {
      const eintrag = raum.titel.get(text(nachricht.key, 300));
      if (!eintrag || !eintrag.members.has(socket.geraetId)) return;
      standSetzen(eintrag, socket.geraetId, socket.name, {
        position: zahl(nachricht.position, 100000),
        paused: Boolean(nachricht.paused),
        season: zahl(nachricht.season, 999),
        episode: zahl(nachricht.episode, 9999)
      });
      standSendenGedrosselt(socket.raum, eintrag);
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
      // Nur wenn vom Host wirklich nichts bekannt ist, bleibt die Antwort aus.
      // Steht er am Anfang der Folge, ist 0 die richtige Auskunft.
      if (stand == null) return;
      senden({
        type: "control",
        key: eintrag.key,
        action: eintrag.live?.action === "pause" ? "pause" : "play",
        position: stand,
        url: eintrag.live?.url || eintrag.url,
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
      // Die Stelle fuer die Leiste kommt hier laufend herein. Ob angehalten
      // ist, sagt der Fortschritt nicht - das bleibt, wie der letzte Befehl es
      // hinterlassen hat.
      standSetzen(eintrag, socket.geraetId, socket.name, { position: fortschritt.position });
      standSenden(socket.raum, eintrag);
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
      // Wer weg ist, steht auch nirgends mehr - sonst zeigt die Leiste eine
      // Sekunde von jemandem, der gar nicht mehr zuschaut.
      if (eintrag.stand?.delete(socket.geraetId)) standSenden(socket.raum, eintrag);
      // hostSicherstellen sieht selbst, dass diese Verbindung weg ist, und
      // gibt weiter, wenn dadurch jemand anderes den Takt uebernimmt.
      gewechselt = hostSicherstellen(socket.raum, eintrag) || gewechselt;
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
