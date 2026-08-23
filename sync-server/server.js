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
const metadaten = require("./metadaten");
// Die YouTube-Watchparty. Ein eigenes Modul mit eigenem Zustand - es teilt sich
// mit der Titelverwaltung nur die Verbindung und den Raumcode.
const youtubeParty = require("./youtube-party");
// Der Abgleich zwischen den Geraeten einer Person. Er faehrt auf denselben
// Verbindungen, kennt aber weder Raeume noch Titel - nur Kennungen und
// verschlossene Klumpen. Was er sieht und was nicht, steht in geraete.js.
const geraete = require("./geraete");
// Das Handy als Fernbedienung: die Kopplung und die Seite, die das Relay dafuer
// ausliefert.
const fern = require("./fern");
const fernSeite = require("./fern-seite");
const fernIcon = require("./fern-icon");

// Das Relay ist ausserdem das Tor zu TMDB und AniList. Der Grund ist nicht
// Bequemlichkeit: der TMDB-Schluessel darf nicht auf die Geraete, und alles,
// was in ein Electron-Bundle wandert, ist lesbar. Die Watchparty merkt davon
// nichts - die Metadaten haengen an eigenen Routen und teilen mit ihr nur den
// Port. Fehlt der Schluessel, fehlen die Filmdaten; die Watchparty laeuft.
const metadatenDienst = metadaten.erstellen();

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
// So lange wird gewartet, bevor einem stehengebliebenen Geraet noch einmal ein
// Play nachgereicht wird - sonst haemmert es im Sekundentakt dagegen.
const NACHREICHEN_MS = 3000;
// Das Relay gleicht nichts mehr aus. Es misst nur noch und meldet, wo der Host
// steht - ob daraus etwas folgt, entscheidet allein der Player: nur er kennt
// seine tatsaechliche Stelle in dem Moment, in dem er handeln wuerde, und nur
// er sieht, ob gerade gepuffert wird.
//
// Deshalb liegt die Grenze hier so niedrig. Sie sagt nicht "jetzt ist es zu
// viel", sondern nur "hier lohnt sich eine Meldung". Der Player braucht auch
// die kleinen Werte: an ihnen erkennt er, dass der Versatz wieder im Rahmen
// ist, und setzt seine Zaehlung zurueck. Ohne diese Meldungen muesste er
// raten. Nur bei praktisch deckungsgleichen Staenden bleibt es still.
const DRIFT_GRENZE_S = 0.5;
// Und in diesem Abstand. Der Player verlangt drei Messungen ueber fuenf
// Sekunden hintereinander, bevor er springt - bei zwei Sekunden Abstand sind
// das gut sechs Sekunden anhaltender Versatz.
const DRIFT_RUHE_MS = 2000;
// So alt darf die letzte Meldung eines Geraets hoechstens sein, damit es in der
// Leiste steht. Gemeldet wird jede Sekunde, im Notfall alle fuenf - wer hier
// herausfaellt, schaut gerade nicht mit.
const STAND_FRISCH_MS = 15000;

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
  geraete.zustandSetzen(roh?.geraete);
  console.log(`Zustand geladen: ${raeume.size} Raum/Raeume, ${geraete.anzahl()} Geraeteschluessel`);
}

function zustandSpeichernSpaeter() {
  if (speicherTimer) return;
  speicherTimer = setTimeout(() => {
    speicherTimer = null;
    const roh = { raeume: {}, geraete: geraete.zustandLesen() };
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
          pauseAusgerichtet: undefined,
          // Host und letzte Aktion ergeben sich aus den lebenden Meldungen -
          // gespeichert waeren sie beim naechsten Start sofort falsch.
          hostId: undefined,
          hostName: undefined,
          letzteAktion: undefined,
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
  // Die YouTube-Runden liegen nur im Speicher und raeumen sich nach eigener
  // Frist auf - hier haengt bloss der Zeitgeber.
  youtubeParty.aufraeumen();
  // Der Geraeteabgleich liegt dagegen auf der Platte: verfallene Grabsteine und
  // Schluessel, die ein halbes Jahr niemand benutzt hat, muessen auch dort weg.
  if (geraete.aufraeumen()) zustandSpeichernSpaeter();
  // Kopplungen liegen nur im Speicher - der Rechner meldet sich nach einem
  // Neustart ohnehin neu an.
  fern.aufraeumen();
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

function titelNachAussen(raumcode, eintrag, fuerGeraet) {
  // Kein aktiver Teilnehmer in dieser Folge, kein Host. Dann bleibt nur der
  // zuletzt bekannte Stand - und die Karte behauptet nicht laenger, jemand
  // fuehre die Runde, der gar nicht mehr dabei ist.
  const host = hostFuerGeraet(raumcode, eintrag, fuerGeraet);
  return {
    key: eintrag.key,
    url: eintrag.url,
    title: eintrag.title,
    providerName: eintrag.providerName,
    thumbnail: eintrag.thumbnail,
    type: eintrag.type,
    season: eintrag.season,
    episode: eintrag.episode,
    hostId: host?.geraetId || "",
    hostName: host?.name || "",
    // Wer zuletzt gedrueckt hat - nicht zu verwechseln damit, wer gerade
    // angehalten ist. Ein mitgezogenes Pause macht niemanden zum Ausloeser.
    pausedBy: eintrag.letzteAktion?.type === "pause" ? eintrag.letzteAktion.name : "",
    lastAction: eintrag.letzteAktion || null,
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
  // Der Pfad ohne Abfrageteil - die Metadaten-Routen nehmen keine offenen
  // Parameter entgegen, und was hier nicht passt, kommt gar nicht erst an.
  const pfad = String(req.url || "").split("?")[0];

  if (pfad.startsWith("/metadata")) {
    // Ein Fehler in der Anreicherung darf das Relay nicht mitnehmen.
    Promise.resolve(metadatenDienst.behandeln(req, res, pfad)).catch(() => {
      if (res.headersSent) return;
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ fehler: "metadaten-fehlgeschlagen" }));
    });
    return;
  }

  // Die Fernbedienung fuers Handy. Sie kommt aus diesem Relay, damit auf dem
  // Telefon nichts zu installieren ist - eine Adresse im Browser genuegt. Und
  // wer will, macht daraus mit einem Griff eine App auf dem Startbildschirm;
  // dafuer liegen hier Manifest, Symbol und Service Worker.
  //
  // Alles unter /fern/ mit Schraegstrich: der Service Worker gilt fuer sein
  // Verzeichnis, und eine Startadresse ausserhalb davon wuerde Chrome die
  // Installation verweigern.
  if (pfad === "/fern") {
    res.writeHead(302, { location: "/fern/" });
    res.end();
    return;
  }

  if (pfad === "/fern/") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      // Nicht zwischenspeichern: sonst haelt ein Handy nach dem Aktualisieren
      // des Relays wochenlang an der alten Seite fest. Der Service Worker haelt
      // sie trotzdem vor - aber nur als Rueckfall ohne Netz.
      "cache-control": "no-store"
    });
    res.end(fernSeite.SEITE);
    return;
  }

  if (pfad === "/fern/manifest.webmanifest") {
    res.writeHead(200, {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": "no-store"
    });
    res.end(JSON.stringify(fernSeite.MANIFEST));
    return;
  }

  if (pfad === "/fern/icon.png") {
    res.writeHead(200, {
      "content-type": "image/png",
      // Das Symbol aendert sich praktisch nie.
      "cache-control": "public, max-age=604800",
      "content-length": fernIcon.ICON.length
    });
    res.end(fernIcon.ICON);
    return;
  }

  if (pfad === "/fern/sw.js") {
    res.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      // Der Service Worker selbst darf nie aus dem Zwischenspeicher kommen -
      // sonst laesst sich eine Fassung, die etwas falsch macht, nicht mehr
      // abloesen.
      "cache-control": "no-store"
    });
    res.end(fernSeite.SERVICE_WORKER);
    return;
  }

  if (pfad === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      raeume: raeume.size,
      youtubeRaeume: youtubeParty.anzahl(),
      geraeteRaeume: geraete.anzahl(),
      fernbedienungen: fern.anzahl(),
      // "syncall" und "hostpause" sagen der App, dass dieses Relay das genaue
      // Gleichziehen und die Pause auf die Host-Zeit beherrscht.
      // "clock" heisst: dieses Relay beantwortet Uhrproben, der smarte Start
      // kann also rechnen. "seq" heisst: jede Steuernachricht traegt eine
      // laufende Nummer, verspaetete Ereignisse lassen sich abweisen.
      // "youtube" heisst: dieses Relay kennt den eigenen YouTube-Modus mit
      // gemeinsamem Video, Revisionsnummer und ohne Host.
      //
      // "chat" heisst: es reicht Textzeilen im Raum weiter. Der Eintrag ist die
      // einzige Moeglichkeit, nach dem Ausrollen von aussen zu sehen, ob die
      // neue Fassung wirklich laeuft - eine Chatzeile schickt man dafuer nicht
      // gern versuchsweise durch einen fremden Raum.
      // "geraete" heisst: dieses Relay kennt den Abgleich zwischen den
      // Geraeten einer Person. Ohne den Eintrag laeuft dort drueben eine
      // aeltere Fassung, und die App wartet auf einen Zustand, der nie kommt.
      features: ["share", "enter", "kick", "persist", "syncall", "hostpause", "watchstate", "here", "bye", "handover", "episodehost", "hostzeit", "clock", "seq", "metadata", "youtube", "chat", "geraete",
        // "fern" heisst: dieses Relay koppelt Handy und Rechner und liefert die
        // Seite dafuer unter /fern aus.
        "fern"],
      // Ob die Anreicherung bereitsteht - ohne den Schluessel selbst. Der
      // gehoert weder in eine Antwort noch ins Journal.
      ...metadatenDienst.zustand()
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

// An einen ausgewaehlten Kreis im Raum. Die YouTube-Watchparty fuehrt ihre
// Mitglieder selbst - hier steht nur der Versand.
function anMitgliederSenden(raumcode, nachricht, ids) {
  const daten = JSON.stringify(nachricht);
  for (const client of wss.clients) {
    if (client.raum !== raumcode || client.readyState !== client.OPEN) continue;
    if (!ids.has(client.geraetId)) continue;
    client.send(daten);
  }
}

// An die uebrigen Geraete desselben Schluessels. Sie haengen an keinem
// Raumcode - der Geraeteabgleich kennt nur seine abgeleitete Kennung, und die
// steht am Socket.
function anGeraeteSenden(raumId, nachricht, ausser) {
  const daten = JSON.stringify(nachricht);
  for (const client of wss.clients) {
    if (client.geraeteRaum !== raumId || client.readyState !== client.OPEN) continue;
    if (client === ausser) continue;
    client.send(daten);
  }
}

// Die beiden Seiten einer Fernbedienung. Sie haengen an keinem Raum, sondern
// nur am Kopplungscode am Socket.
function anFernSeite(code, nachricht, seite) {
  const daten = JSON.stringify(nachricht);
  for (const client of wss.clients) {
    if (client.fernCode !== code || client.fernSeite !== seite) continue;
    if (client.readyState !== client.OPEN) continue;
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
  const peers = teilnehmer(raumcode);
  for (const client of wss.clients) {
    if (client.raum !== raumcode || client.readyState !== client.OPEN) continue;
    // Der Host haengt an der Folge, die dieses Geraet offen hat - also wird
    // die Liste je Empfaenger gebaut.
    const shared = [...raum.titel.values()].map((eintrag) => titelNachAussen(raumcode, eintrag, client.geraetId));
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
function hostZustandJetzt(raumcode, eintrag) {
  const kandidaten = [];
  // Am genauesten ist, was der Host selbst zuletzt aus seinem Player gemeldet
  // hat: hoechstens eine Sekunde alt, mit echtem Pausenzustand. Weil der Host
  // nie springt, muessen sich die anderen genau darauf ausrichten.
  const eigen = aktuellerHost(raumcode, eintrag);
  if (eigen) {
    kandidaten.push({ at: eigen.at, position: eigen.position, laeuft: !eigen.paused });
  }
  if (eintrag.live) {
    kandidaten.push({
      at: Number(eintrag.live.at) || 0,
      position: eintrag.live.position,
      laeuft: eintrag.live.action === "play"
    });
  }
  const fortschritt = eintrag.progress;
  if (fortschritt && eigen?.name && fortschritt.from === eigen.name) {
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
  return { position: neueste.position + Math.min(vergangen, 600), laeuft: Boolean(neueste.laeuft) };
}

// Nur die Stelle - fuer alles, was den Pausenzustand nicht braucht.
function hostStandJetzt(raumcode, eintrag) {
  const zustand = hostZustandJetzt(raumcode, eintrag);
  return zustand ? zustand.position : null;
}

// Die laufende Nummer je Titel. Sie ordnet alles, was das Relay an die Runde
// schickt - der Player weist damit Nachzuegler ab, die sich unterwegs
// ueberholt haben. Sie zaehlt im Arbeitsspeicher und faengt nach einem
// Neustart wieder bei eins an; der mitgeschickte Zeitstempel sorgt dafuer,
// dass die Player deswegen nicht dauerhaft dichtmachen.
function naechsteNummer(eintrag) {
  eintrag.nummer = (Number(eintrag.nummer) || 0) + 1;
  return eintrag.nummer;
}

// Welche Folge ist gemeint? Steht in jeder Nachricht, damit ein spaeter
// eintreffendes Ereignis der vorigen Folge den laufenden Player nicht mehr
// anfassen kann.
function folgenKennung(season, episode) {
  const staffel = Number(season) || 0;
  const folge = Number(episode) || 0;
  if (!staffel && !folge) return "";
  return `s${staffel}e${folge}`;
}

// Es muss immer jemanden geben, an dem sich die anderen ausrichten koennen.
// Host ist, wer zuerst da war - faellt er weg, uebernimmt der naechste
// verbundene Teilnehmer, sonst haette niemand mehr eine Referenz.
// --- Wer ist Host? -----------------------------------------------------------
//
// Host ist keine Eigenschaft des Raums, sondern der Folge: unter allen, die
// gerade dieselbe Folge offen haben, fuehrt der, der sie zuerst betreten hat.
//
// Vorher haftete der Host am Raum und an der Beitritts-Reihenfolge. Damit
// stand oben weiter "Host: Jakob", obwohl Jakob laengst eine Folge weiter oder
// gar nicht mehr am Player war - und niemand konnte sich mehr an ihm
// ausrichten.
//
// Aktiv ist, wer verbunden ist, Mitglied ist, eine laufende Player-Sitzung
// gemeldet hat und dessen Herzschlag nicht abgelaufen ist.
function istVerbunden(raumcode, geraetId) {
  for (const client of wss.clients) {
    if (client.raum === raumcode && client.readyState === client.OPEN && client.geraetId === geraetId) return true;
  }
  return false;
}

function istAktiv(raumcode, eintrag, geraetId, wert) {
  if (!wert || !wert.sitzung) return false;
  if (!eintrag.members.has(geraetId)) return false;
  if (Date.now() - wert.at > STAND_FRISCH_MS) return false;
  return istVerbunden(raumcode, geraetId);
}

// Alle, die genau diese Folge offen haben - der frueheste zuerst.
function aktiveTeilnehmer(raumcode, eintrag, season, episode) {
  const treffer = [];
  for (const [geraetId, wert] of eintrag.stand || new Map()) {
    if (!istAktiv(raumcode, eintrag, geraetId, wert)) continue;
    if (Number(wert.episode || 0) !== Number(episode || 0)) continue;
    if (Number(wert.season || 0) !== Number(season || 0)) continue;
    treffer.push({ geraetId, ...wert });
  }
  return treffer.sort((links, rechts) => (links.seitFolge || 0) - (rechts.seitFolge || 0));
}

function hostFuerFolge(raumcode, eintrag, season, episode) {
  return aktiveTeilnehmer(raumcode, eintrag, season, episode)[0] || null;
}

// Der Host der Folge, auf der die Runde gerade steht. Daran richtet sich alles
// aus, was den Raum als Ganzes betrifft - Abgleich, Pause, Nachreichen.
function aktuellerHost(raumcode, eintrag) {
  return hostFuerFolge(raumcode, eintrag, eintrag.season, eintrag.episode);
}

function aktuelleHostId(raumcode, eintrag) {
  return aktuellerHost(raumcode, eintrag)?.geraetId || "";
}

// Und der Host, der fuer genau dieses Geraet gilt: es zaehlt die Folge, die es
// selbst offen hat. Wer eine Folge weiter ist, sieht dort seinen eigenen Host.
function hostFuerGeraet(raumcode, eintrag, geraetId) {
  const eigen = eintrag.stand?.get(geraetId);
  const season = eigen ? eigen.season : eintrag.season;
  const episode = eigen ? eigen.episode : eintrag.episode;
  return hostFuerFolge(raumcode, eintrag, season, episode);
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
      const stand = eintrag.stand?.get(alteId);
      eintrag.members.delete(alteId);
      eintrag.members.set(geraetId, name);
      // Dasselbe Geraet mit neuer Kennung behaelt seinen Stand samt Sitzung -
      // sonst gaelte es als frisch dazugekommen.
      if (stand && eintrag.stand) {
        eintrag.stand.delete(alteId);
        eintrag.stand.set(geraetId, stand);
      }
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

  // Eine neue Player-Sitzung oder eine andere Folge heisst: hier faengt der
  // Aufenthalt in dieser Folge neu an. Danach richtet sich, wer Host ist -
  // wer zuerst da war, fuehrt. Ein alter Player kann so nicht weiter als
  // aktiv gelten, nur weil dasselbe Geraet frueher einmal hier war.
  const sitzung = werte.sitzung || vorher.sitzung || "";
  const folge = werte.episode == null ? (vorher.episode || 0) : werte.episode;
  const staffel = werte.season == null ? (vorher.season || 0) : werte.season;
  const neueSitzung = sitzung !== vorher.sitzung
    || folge !== (vorher.episode || 0)
    || staffel !== (vorher.season || 0);
  // Wer neu in einer Folge ist oder gerade erst wieder auftaucht, kann die
  // Host-Wahl umwerfen - dann muss der Raumzustand neu hinaus.
  const wachAuf = neueSitzung || !vorher.at || Date.now() - vorher.at > STAND_FRISCH_MS;

  eintrag.stand.set(geraetId, {
    sitzung,
    seitFolge: neueSitzung ? Date.now() : (vorher.seitFolge || Date.now()),
    // Wann diesem Geraet zuletzt etwas nachgereicht oder es zurueckgeholt
    // wurde, muss den Wechsel ueberleben - sonst greift die Bremse nie und es
    // haemmert im Sekundentakt.
    geholt: vorher.geholt || 0,
    gerueckt: vorher.gerueckt || 0,
    name: name || vorher.name || eintrag.members.get(geraetId) || "Gerät",
    position: werte.position == null ? (vorher.position || 0) : werte.position,
    paused: werte.paused == null ? Boolean(vorher.paused) : Boolean(werte.paused),
    season: werte.season == null ? (vorher.season || 0) : werte.season,
    episode: werte.episode == null ? (vorher.episode || 0) : werte.episode,
    at: Date.now()
  });
  return wachAuf;
}

// Ein Befehl gilt fuer alle Beigetretenen - also stehen danach auch alle dort.
function standFuerAlle(eintrag, position, paused) {
  for (const geraetId of eintrag.members.keys()) {
    standSetzen(eintrag, geraetId, eintrag.members.get(geraetId), { position, paused });
  }
}

// In die Leiste gehoert nur, wer diese Serie gerade wirklich offen hat. Jedes
// Geraet meldet sich dabei mindestens alle paar Sekunden - auch pausiert.
// Bleibt eine Meldung aus, schaut dort jemand etwas anderes, ist auf privat
// umgestellt oder hat die Seite verlassen: dann hat er in der Leiste nichts
// verloren, sonst stuende dort eine Sekunde, die es nicht mehr gibt.
function standNachAussen(raumcode, eintrag, fuerGeraet) {
  if (!eintrag.stand) return [];
  const host = hostFuerGeraet(raumcode, eintrag, fuerGeraet);
  return [...eintrag.stand.entries()]
    .filter(([geraetId, wert]) => istAktiv(raumcode, eintrag, geraetId, wert))
    .map(([geraetId, wert]) => ({
      id: geraetId,
      name: wert.name,
      position: wert.position,
      paused: wert.paused,
      season: wert.season || 0,
      episode: wert.episode || 0,
      // Wie alt die Meldung ist, in Sekunden - und zwar hier gerechnet, mit
      // einer einzigen Uhr. Frueher ging der Zeitstempel des Relays hinaus und
      // die App zog ihre eigene Uhr davon ab: jede Abweichung zwischen den
      // beiden Rechnern landete unbesehen in der angezeigten Sekunde.
      age: Math.max(0, (Date.now() - wert.at) / 1000),
      host: geraetId === host?.geraetId
    }));
}

function standSenden(raumcode, eintrag) {
  clearTimeout(eintrag.standTimer);
  eintrag.standTimer = null;
  eintrag.standGesendet = Date.now();
  // Je Empfaenger gebaut: welcher Host gilt, haengt an der Folge, die dieses
  // Geraet gerade offen hat.
  for (const client of wss.clients) {
    if (client.raum !== raumcode || client.readyState !== client.OPEN) continue;
    if (!eintrag.members.has(client.geraetId)) continue;
    client.send(JSON.stringify({
      type: "watchstate",
      key: eintrag.key,
      members: standNachAussen(raumcode, eintrag, client.geraetId),
      pausedBy: eintrag.letzteAktion?.type === "pause" ? eintrag.letzteAktion.name : "",
      lastAction: eintrag.letzteAktion || null
    }));
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

// Eine neue Folge faengt bei ihrer eigenen Stelle an. Der gebuchte Fortschritt
// gehoert sonst noch zur Folge davor, und die Karte zeigt die neue Folge mit
// einer Stelle, die es dort nie gab.
function fortschrittAufFolge(eintrag, position, von) {
  eintrag.progress = {
    url: eintrag.url,
    season: eintrag.season || 0,
    episode: eintrag.episode || 0,
    position: Number(position) || 0,
    duration: 0,
    progress: 0,
    completed: false,
    episodeCompleted: false,
    updatedAt: new Date().toISOString(),
    from: von || ""
  };
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
  eintrag.pauseAusgerichtet = false;

  // Auch hier gilt die eine Regel: die Nachricht ist unterschiedlich lange
  // unterwegs, und wer spaeter einsteigt, muss weiter vorn einsteigen. Sonst
  // waeren nach dem gemeinsamen Start genau die Millisekunden Unterschied
  // drin, die dieses Verfahren beseitigen soll.
  const jetzt = Date.now();
  const daten = JSON.stringify({
    type: "syncstart",
    key: eintrag.key,
    position: ziel,
    at: jetzt,
    videoTime: ziel,
    timestamp: jetzt,
    playing: true,
    sequenceId: naechsteNummer(eintrag),
    episodeId: folgenKennung(eintrag.season, eintrag.episode),
    hostId: aktuelleHostId(raumcode, eintrag)
  });
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
  // Der Geraeteabgleich haengt an einer eigenen Kennung und an keinem Raumcode.
  // Ein Geraet kann ihn benutzen, ohne je eine Watchparty zu betreten.
  socket.geraeteRaum = "";
  // Die Fernbedienung: welcher Code und welche Seite - Rechner oder Handy.
  socket.fernCode = "";
  socket.fernSeite = "";
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

    // Uhrabgleich. Bewusst ganz vorn und ohne Raumbindung: die Antwort haengt
    // an nichts, darf nichts blockieren und soll so schnell wie moeglich
    // zurueckgehen - jede Millisekunde Bearbeitung hier landet als Fehler im
    // gemessenen Versatz. `t0` wird nur durchgereicht, damit der Client seine
    // Proben zuordnen kann.
    if (nachricht?.type === "time") {
      senden({ type: "timeack", t0: nachricht.t0, t1: Date.now() });
      return;
    }

    // Das Handy als Fernbedienung. Wie der Geraeteabgleich vor der Raumpflicht:
    // eine Fernbedienung hat keinen Raumcode, und wer nur sein eigenes ELFIX
    // anhalten will, soll dafuer keine Watchparty betreten muessen.
    if (String(nachricht?.type || "").startsWith("fn")) {
      fern.behandeln({
        nachricht,
        socket,
        senden,
        anRechner: (antwort) => anFernSeite(socket.fernCode, antwort, "rechner"),
        anHandys: (antwort) => anFernSeite(socket.fernCode, antwort, "handy")
      });
      return;
    }

    // Der Abgleich zwischen den Geraeten einer Person. Er steht bewusst vor
    // "join" und vor der Raumpflicht darunter: er hat keinen Raumcode, und wer
    // nur seine eigenen Geraete zusammenhaelt, soll keine Watchparty betreten
    // muessen.
    if (String(nachricht?.type || "").startsWith("gr")) {
      if (nachricht.type === "grhello") {
        if (!geraete.istKennung(nachricht.room)) {
          senden({ type: "grerror", message: "Ungueltiger Schluessel" });
          return;
        }
        socket.geraeteRaum = nachricht.room;
      }
      if (!socket.geraeteRaum) return;
      const geaendert = geraete.behandeln({
        nachricht,
        raumId: socket.geraeteRaum,
        senden,
        verteilen: (antwort) => anGeraeteSenden(socket.geraeteRaum, antwort, socket)
      });
      if (geaendert) zustandSpeichernSpaeter();
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
      zustandSenden(socket.raum);
      return;
    }

    if (!socket.raum) return;

    // Die YouTube-Watchparty. Sie kommt vor allem anderen und geht komplett an
    // ihr eigenes Modul: eigener Zustand, eigene Ordnung, eigene Nachrichten.
    // Unterhalb dieser Zeile aendert sich fuer Serien und Filme nichts - was
    // hier abgefangen wird, hat die Titelverwaltung noch nie gesehen.
    if (String(nachricht?.type || "").startsWith("yt")) {
      youtubeParty.behandeln({
        nachricht,
        raumcode: socket.raum,
        geraetId: socket.geraetId,
        name: socket.name,
        senden,
        verteilen: (antwort, ids) => anMitgliederSenden(socket.raum, antwort, ids)
      });
      return;
    }

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

    // Der Chat. Das Relay reicht ihn nur weiter: es kennt die Mitglieder eines
    // Raums ohnehin und weiss, wer gerade schreibt.
    //
    // Nichts davon wird gespeichert - weder hier noch in der App. Ein
    // Chatverlauf auf einem fremden Server ist etwas anderes als ein
    // Raumzustand: er enthaelt, was Leute einander schreiben, und dafuer gibt
    // es hier keinen Grund und keine Einwilligung. Wer nicht dabei war, hat es
    // nicht gelesen.
    if (nachricht.type === "chat") {
      const zeile = text(nachricht.text, 500).trim();
      if (!zeile) return;
      anRaumSenden(socket.raum, {
        type: "chat",
        text: zeile,
        from: socket.name,
        deviceId: socket.geraetId,
        at: Date.now()
      });
      return;
    }

    if (nachricht.type === "enter" || nachricht.type === "leave") {
      const eintrag = raum.titel.get(text(nachricht.key, 300));
      if (!eintrag) return;
      if (nachricht.type === "enter") {
        eintrag.members.set(socket.geraetId, socket.name);
      } else {
        eintrag.members.delete(socket.geraetId);
        // Der Stand geht mit: wer draussen ist, zaehlt nicht mehr als aktiv
        // und kann damit auch nicht mehr Host sein.
        eintrag.stand?.delete(socket.geraetId);
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
      eintrag.stand?.delete(wen);
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

      const ziel = httpAdresse(nachricht.url);
      const istHost = socket.geraetId === aktuelleHostId(socket.raum, eintrag);
      const eigen = zahl(nachricht.position, 100000);
      let neueFolge = false;
      // Ein Steuerbefehl gilt nur unter denen, die dieselbe Folge offen haben.
      // Der Folgenwechsel ist die Ausnahme - der muss gerade die erreichen,
      // die noch bei der alten Folge stehen.
      const absenderFolge = eintrag.stand?.get(socket.geraetId)?.episode || 0;
      const nurGleicheFolge = aktion !== "navigate" && absenderFolge > 0;
      // Und nur wer bei der Folge der Runde steht, bewegt deren Zustand.
      // Sonst haette eine Pause aus einer anderen Folge die ganze Runde
      // formal angehalten, obwohl hier weiterlief.
      const amRaumstand = !absenderFolge || !eintrag.episode || absenderFolge === eintrag.episode;

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
              fortschrittAufFolge(eintrag, 0, socket.name);
            eintrag.letzteAktion = null;
            neueFolge = true;
          }
        }
        if (!schonDort) {
          // Nicht "pause": eine neue Folge ist noch gar nichts: weder angehalten
          // noch laufend. Stand hier "pause", bekam jedes Geraet, das die neue
          // Folge oeffnet und den Stand abfragt, prompt eine Pause zurueck - die
          // Folge startete, lud und blieb dann stehen. Jetzt laeuft der Autostart
          // durch, und das erste echte Play gibt den Takt vor.
          eintrag.live = { action: "navigate", position: 0, url: ziel || eintrag.url, at: Date.now() };
          eintrag.sync = null;
          clearTimeout(eintrag.syncTimer);
        }
      }

      // Bei einer Pause zaehlt die Zeit des Hosts: danach stehen alle exakt
      // dort, auch wer selbst gedrueckt hat. Pausiert der Host, ist seine
      // gemeldete Stelle genauer als jede Hochrechnung.
      const hostStand = hostStandJetzt(socket.raum, eintrag);
      const gemeinsam = aktion === "pause" && !istHost && hostStand != null ? hostStand : eigen;

      // Der zuletzt an alle geschickte Befehl ist der Stand der Runde - egal,
      // von wem er kam. Nur so passt das, woran sich ein Abgleich orientiert,
      // zu dem, was auf den Geraeten wirklich laeuft.
      // Neue Pause, neue Ausrichtung - und beim Weiterlaufen faellt sie weg.
      if (aktion !== "pause") eintrag.pauseAusgerichtet = false;

      // Nach einem Sprung darf der Ausgleich sofort greifen: dort laufen die
      // Geraete am ehesten auseinander, weil jeder Hoster anders puffert.
      if (aktion === "seek") {
        for (const wert of (eintrag.stand || new Map()).values()) wert.gerueckt = 0;
      }

      // Wer gedrueckt hat. Das ist etwas anderes als "wer ist gerade
      // angehalten": zieht ein zweites Geraet die Pause nur mit, bleibt der
      // Ausloeser derselbe. Nur ein Befehl, der hier ankommt, zaehlt - und
      // hereinkommende Befehle wendet der Empfaenger an, ohne sie erneut zu
      // melden.
      if (amRaumstand && ["play", "pause", "seek"].includes(aktion)) {
        eintrag.letzteAktion = {
          type: aktion,
          userId: socket.geraetId,
          name: socket.name,
          timestamp: Date.now()
        };
      }

      if (aktion !== "navigate" && amRaumstand && (istHost || aktion === "pause")) {
        eintrag.live = {
          action: aktion,
          position: gemeinsam,
          url: ziel || eintrag.live?.url || eintrag.url,
          at: Date.now()
        };
      }

      // Laeuft das Video an der Quelle nach diesem Ereignis? Davon haengt ab,
      // ob der Empfaenger die Laufzeit der Nachricht auf die Stelle
      // aufschlaegt. Bei einem Sprung zaehlt, ob der Absender selbst gerade
      // laeuft - spult er im Stehen, ist seine Stelle exakt und endgueltig.
      const laeuftDanach = aktion === "play"
        || (aktion === "seek" && !(eintrag.stand?.get(socket.geraetId)?.paused ?? true));
      const jetzt = Date.now();
      const daten = JSON.stringify({
        type: "control",
        key: eintrag.key,
        action: aktion,
        position: gemeinsam,
        url: ziel,
        from: socket.name,
        host: istHost,
        at: jetzt,
        // Der smarte Start: Stelle, Zeitpunkt und Laufzustand gehoeren
        // zusammen. Aus ihnen rechnet der Empfaenger aus, wo die Quelle in
        // dem Augenblick steht, in dem er wirklich einsteigt.
        videoTime: gemeinsam,
        timestamp: jetzt,
        playing: laeuftDanach,
        sequenceId: naechsteNummer(eintrag),
        episodeId: folgenKennung(
          aktion === "navigate" ? eintrag.season : (eintrag.stand?.get(socket.geraetId)?.season || eintrag.season),
          aktion === "navigate" ? eintrag.episode : (absenderFolge || eintrag.episode)
        ),
        hostId: aktuelleHostId(socket.raum, eintrag)
      });
      for (const client of wss.clients) {
        if (client.raum !== socket.raum || client.readyState !== client.OPEN) continue;
        if (!eintrag.members.has(client.geraetId)) continue;
        // Eine Pause geht auch an den, der sie ausgeloest hat: er soll auf
        // dieselbe Sekunde ruecken wie alle anderen. Bei allem anderen waere
        // das nur ein Echo der eigenen Tat.
        if (client === socket && !(aktion === "pause" && !istHost)) continue;
        if (nurGleicheFolge) {
          const seins = eintrag.stand?.get(client.geraetId)?.episode || 0;
          if (seins && seins !== absenderFolge) continue;
        }
        client.send(daten);
      }

      // Fuer die Leiste: nach einem Befehl stehen alle Beigetretenen dort.
      if (aktion === "pause") standFuerAlle(eintrag, gemeinsam, true);
      else if (aktion === "play") standFuerAlle(eintrag, gemeinsam, false);
      else if (aktion === "seek") standFuerAlle(eintrag, gemeinsam, null);
      else if (aktion === "navigate") standFuerAlle(eintrag, 0, true);
      standSenden(socket.raum, eintrag);

      // Steht die Runde jetzt auf einer anderen Folge, muessen es alle sehen -
      // sonst zeigt die Karte weiter die Folge von vorhin. Und wer gedrueckt
      // hat, gehoert ebenfalls in die Karten.
      if (neueFolge || ["play", "pause", "seek"].includes(aktion)) zustandSenden(socket.raum);
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
      const hostStand = hostStandJetzt(socket.raum, eintrag);
      const ziel = hostStand == null ? zahl(nachricht.position, 100000) : hostStand;
      const url = eintrag.live?.url || eintrag.url;

      const mitglieder = [...wss.clients].filter((client) => (
        client.raum === socket.raum && client.readyState === client.OPEN && eintrag.members.has(client.geraetId)
      ));
      eintrag.sync = { ziel, wartetAuf: new Set(mitglieder.map((c) => c.geraetId)), at: Date.now() };

      // Beim Vorbereiten halten alle an und stellen sich auf dieselbe Stelle.
      // Es wird also nichts hochgerechnet - `playing` ist falsch, und die
      // Stelle gilt auf die Hundertstelsekunde.
      const angesetzt = Date.now();
      const vorbereiten = JSON.stringify({
        type: "syncprepare",
        key: eintrag.key,
        position: ziel,
        url,
        from: socket.name,
        at: angesetzt,
        videoTime: ziel,
        timestamp: angesetzt,
        playing: false,
        sequenceId: naechsteNummer(eintrag),
        episodeId: folgenKennung(eintrag.season, eintrag.episode),
        hostId: aktuelleHostId(socket.raum, eintrag)
      });
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
      const vorher = eintrag.stand?.get(socket.geraetId);
      const pausiert = Boolean(nachricht.paused);
      const folge = zahl(nachricht.episode, 9999);
      const hostVorher = aktuelleHostId(socket.raum, eintrag);
      const wachAuf = standSetzen(eintrag, socket.geraetId, socket.name, {
        position: zahl(nachricht.position, 100000),
        paused: pausiert,
        season: zahl(nachricht.season, 999),
        episode: folge,
        // Die Kennung des Players. Sie wechselt bei jeder neuen Folge und
        // jedem neu geladenen Player - daran erkennt das Relay, dass hier ein
        // Aufenthalt neu beginnt und nicht der alte weiterlaeuft.
        sitzung: text(nachricht.playerSessionId, 64)
      });

      // Anhalten, Weiterlaufen und ein Folgenwechsel muessen die anderen sofort
      // sehen - darauf zu warten, bis das Buendel voll ist, waere genau die
      // Verzoegerung, die eine Watchparty nicht haben darf. Nur eine reine
      // Stellenmeldung wird zusammengefasst, und die tickt drueben ohnehin
      // von selbst weiter.
      const geaendert = !vorher
        || Boolean(vorher.paused) !== pausiert
        || (folge && (vorher.episode || 0) !== folge);
      // Die Folge des Hosts ist die Folge der Runde - und zwar sofort, sobald
      // sein Player sie meldet. Vorher erfuhr der Raum davon nur ueber den
      // gebuchten Fortschritt, und der rueckte erst nach Minuten nach: bis
      // dahin behauptete die Runde, es laufe noch die Folge davor.
      //
      // Massgeblich ist, wer die Runde *vor* dieser Meldung gefuehrt hat.
      // Danach zu fragen ist sinnlos: dieses Geraet steht dann schon auf der
      // neuen Folge und zaehlt fuer die alte nicht mehr mit - die Bedingung
      // war nie wahr, und der Raum folgte der Folge nur ueber den
      // Wechsel-Befehl. Blieb der aus, hing die Runde fest.
      if (socket.geraetId === hostVorher && folge && folge !== eintrag.episode) {
        eintrag.episode = folge;
        eintrag.season = zahl(nachricht.season, 999) || eintrag.season;
        const adresse = httpAdresse(nachricht.url);
        if (adresse) {
          eintrag.url = adresse;
          eintrag.live = { action: "navigate", position: 0, url: adresse, at: Date.now() };
        }
        eintrag.pauseAusgerichtet = false;
        eintrag.letzteAktion = null;
        fortschrittAufFolge(eintrag, zahl(nachricht.position, 100000), socket.name);
        zustandSenden(socket.raum);
      }

      // Bei jeder Pause ruecken alle exakt auf die Stelle des Hosts. Sein
      // eigener Player meldet sie beim Anhalten sofort und auf die
      // Millisekunde - genauer als jede Hochrechnung aus der letzten
      // Steuerung. Erst haelt jeder an, damit nichts wegdriftet, dann kommt
      // die genaue Stelle hinterher. Einmal je Pause, nicht bei jedem
      // Herzschlag.
      if (socket.geraetId === aktuelleHostId(socket.raum, eintrag) && pausiert
        && eintrag.live?.action === "pause" && !eintrag.pauseAusgerichtet) {
        eintrag.pauseAusgerichtet = true;
        const genau = zahl(nachricht.position, 100000);
        eintrag.live.position = genau;
        eintrag.live.at = Date.now();
        standFuerAlle(eintrag, genau, true);
        const jetzt = Date.now();
        const daten = JSON.stringify({
          type: "control",
          key: eintrag.key,
          action: "seek",
          position: genau,
          url: eintrag.live?.url || eintrag.url,
          from: aktuellerHost(socket.raum, eintrag)?.name || "Host",
          host: true,
          resync: true,
          at: jetzt,
          videoTime: genau,
          timestamp: jetzt,
          // Der Host steht - also ist seine Stelle exakt und wird nicht
          // hochgerechnet. Genau dafuer gibt es diese Ausrichtung.
          playing: false,
          sequenceId: naechsteNummer(eintrag),
          episodeId: folgenKennung(eintrag.season, eintrag.episode),
          hostId: socket.geraetId
        });
        for (const client of wss.clients) {
          if (client === socket || client.raum !== socket.raum || client.readyState !== client.OPEN) continue;
          if (!eintrag.members.has(client.geraetId)) continue;
          // Nur wer bei derselben Folge steht - alle anderen geht die Stelle
          // des Hosts nichts an.
          const seins = eintrag.stand?.get(client.geraetId)?.episode || 0;
          if (seins && seins !== eintrag.episode) continue;
          client.send(daten);
        }
      }

      // Die laufende Messung. Sie ist keine Korrektur: das Relay meldet nur,
      // wo der Host steht, und zwar auch bei kleinem Versatz. Der Player
      // braucht gerade die kleinen Werte - an ihnen sieht er, dass wieder
      // alles im Rahmen ist, und setzt seine Zaehlung zurueck. Ob am Ende
      // gesprungen wird, entscheidet er allein.
      //
      // Gemessen wird nur bei derselben Folge, nur wenn beide wirklich laufen,
      // und nie fuer den Host selbst: er ist die Zeitquelle.
      const zustand = eintrag.stand.get(socket.geraetId);
      const gleicheFolge = !folge || !eintrag.episode || folge === eintrag.episode;
      const hostJetzt = aktuellerHost(socket.raum, eintrag);

      if (hostJetzt && hostJetzt.geraetId !== socket.geraetId
        && !pausiert && !hostJetzt.paused && !eintrag.sync
        && gleicheFolge) {
        const stand = hostZustandJetzt(socket.raum, eintrag);
        const ziel = stand ? stand.position : null;
        const abstand = ziel == null ? 0 : Math.abs(zahl(nachricht.position, 100000) - ziel);
        if (ziel != null && abstand > DRIFT_GRENZE_S && Date.now() - (zustand.gerueckt || 0) > DRIFT_RUHE_MS) {
          zustand.gerueckt = Date.now();
          const jetzt = Date.now();
          senden({
            type: "control",
            key: eintrag.key,
            action: "hostzeit",
            hostPlaying: stand.laeuft,
            position: ziel,
            url: eintrag.live?.url || eintrag.url,
            from: hostJetzt.name || "Host",
            host: false,
            resync: true,
            at: jetzt,
            videoTime: ziel,
            timestamp: jetzt,
            playing: stand.laeuft,
            sequenceId: naechsteNummer(eintrag),
            episodeId: folgenKennung(eintrag.season, eintrag.episode),
            hostId: hostJetzt.geraetId
          });
        }
      }

      // Die Runde laeuft, dieses Geraet steht: dann ist sein Play unterwegs
      // verloren gegangen oder es hat nach einem Neuladen nie eines bekommen.
      // Statt es stehen zu lassen, wird ihm der fehlende Befehl nachgereicht -
      // nur ihm, und nur wenn es bei derselben Folge steht.
      const faellig = !zustand.geholt || Date.now() - zustand.geholt > NACHREICHEN_MS;
      if (pausiert && gleicheFolge && faellig && !eintrag.sync && eintrag.live?.action === "play") {
        const stand = hostZustandJetzt(socket.raum, eintrag);
        if (stand) {
          zustand.geholt = Date.now();
          const jetzt = Date.now();
          senden({
            type: "control",
            key: eintrag.key,
            action: "play",
            position: stand.position,
            url: eintrag.live?.url || eintrag.url,
            from: aktuellerHost(socket.raum, eintrag)?.name || "Host",
            host: false,
            resync: true,
            at: jetzt,
            videoTime: stand.position,
            timestamp: jetzt,
            playing: stand.laeuft,
            sequenceId: naechsteNummer(eintrag),
            episodeId: folgenKennung(eintrag.season, eintrag.episode),
            hostId: aktuelleHostId(socket.raum, eintrag)
          });
        }
      }

      // Der Host haengt an den lebenden Meldungen: wechselt jemand die Folge
      // oder taucht neu auf, kann er sich verschieben. Dann muss der volle
      // Zustand hinaus - die Leiste allein traegt ihn nicht in die Karten.
      if (wachAuf || hostVorher !== aktuelleHostId(socket.raum, eintrag)) {
        zustandSenden(socket.raum);
      }

      if (geaendert) standSenden(socket.raum, eintrag);
      else standSendenGedrosselt(socket.raum, eintrag);
      return;
    }

    // Ausdrueckliche Abmeldung: die Folge ist hier nicht mehr offen - die
    // Startseite liegt darueber, es laeuft etwas anderes, oder auf privat
    // umgestellt. Ohne das wuerde erst der ablaufende Herzschlag verraten,
    // dass jemand weg ist, und bis dahin stuende er noch oben in der Leiste.
    // Den Host weitergeben. Nur wer ihn gerade hat, darf das, und nur an
    // jemanden, der bei derselben Folge aktiv mitschaut. Host ist, wer die
    // Folge zuerst betreten hat - also wird der Beschenkte vorgereiht.
    if (nachricht.type === "handover") {
      const eintrag = raum.titel.get(text(nachricht.key, 300));
      const wen = text(nachricht.memberId, 64);
      if (!eintrag || !wen || wen === socket.geraetId) return;
      if (socket.geraetId !== aktuelleHostId(socket.raum, eintrag)) return;

      const runde = aktiveTeilnehmer(socket.raum, eintrag, eintrag.season, eintrag.episode);
      if (!runde.some((teilnehmer) => teilnehmer.geraetId === wen)) return;

      const frueheste = Math.min(...runde.map((teilnehmer) => teilnehmer.seitFolge || 0));
      const ziel = eintrag.stand.get(wen);
      ziel.seitFolge = frueheste - 1;
      zustandSenden(socket.raum);
      standSenden(socket.raum, eintrag);
      return;
    }

    if (nachricht.type === "bye") {
      const eintrag = raum.titel.get(text(nachricht.key, 300));
      if (!eintrag?.stand?.delete(socket.geraetId)) return;
      zustandSenden(socket.raum);
      standSenden(socket.raum, eintrag);
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
      const stand = hostZustandJetzt(socket.raum, eintrag);
      // Nur wenn vom Host wirklich nichts bekannt ist, bleibt die Antwort aus.
      // Steht er am Anfang der Folge, ist 0 die richtige Auskunft.
      if (!stand) return;
      const angehalten = eintrag.live?.action === "pause";
      const jetzt = Date.now();
      senden({
        type: "control",
        key: eintrag.key,
        action: angehalten ? "pause" : "play",
        position: stand.position,
        url: eintrag.live?.url || eintrag.url,
        from: aktuellerHost(socket.raum, eintrag)?.name || "Host",
        host: true,
        resync: true,
        at: jetzt,
        // Beitreten und Wiederverbinden laufen ueber genau diese Antwort. Sie
        // traegt deshalb dieselben Angaben wie ein echtes Ereignis: wer jetzt
        // einsteigt, soll dort landen, wo der Host beim Einsteigen steht - und
        // nicht dort, wo er beim Absenden stand.
        videoTime: stand.position,
        timestamp: jetzt,
        playing: !angehalten && stand.laeuft,
        sequenceId: naechsteNummer(eintrag),
        episodeId: folgenKennung(eintrag.season, eintrag.episode),
        hostId: aktuelleHostId(socket.raum, eintrag)
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
    // Geht der Rechner, ist nichts mehr zu steuern. Die Handys erfahren es und
    // die Kopplung faellt weg - beim naechsten Start meldet er sich neu an.
    if (socket.fernSeite === "rechner" && socket.fernCode) {
      anFernSeite(socket.fernCode, { type: "fnweg" }, "handy");
      fern.abmelden(socket.fernCode);
    }
    if (!socket.raum) return;
    // Aus der YouTube-Runde austragen. Wer nur kurz herausfaellt, meldet sich
    // beim naechsten Verbindungsaufbau selbst wieder an.
    youtubeParty.abmelden({
      raumcode: socket.raum,
      geraetId: socket.geraetId,
      verteilen: (antwort, ids) => anMitgliederSenden(socket.raum, antwort, ids)
    });
    const raum = raeume.get(socket.raum);
    let gewechselt = false;
    for (const eintrag of raum?.titel.values() || []) {
      // Wer weg ist, steht auch nirgends mehr - sonst zeigt die Leiste eine
      // Sekunde von jemandem, der gar nicht mehr zuschaut.
      if (eintrag.stand?.delete(socket.geraetId)) standSenden(socket.raum, eintrag);
      // Wer die Verbindung verliert, ist nicht mehr aktiv - damit faellt er
      // aus der Host-Wahl und der naechste in dieser Folge rueckt nach.
      gewechselt = true;
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
