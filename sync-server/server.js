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
const { AbstimmungsWarteschlange } = require("./warteschlange");
// Der Abgleich zwischen den Geraeten einer Person. Er faehrt auf denselben
// Verbindungen, kennt aber weder Raeume noch Titel - nur Kennungen und
// verschlossene Klumpen. Was er sieht und was nicht, steht in geraete.js.
const geraete = require("./geraete");
// Das Handy als Fernbedienung: die Kopplung und die Seite, die das Relay dafuer
// ausliefert.
const fern = require("./fern");
const fernSeite = require("./fern-seite");
const fernIcon = require("./fern-icon");
// Die Statusseite: die Antwort auf "laeuft es ueberhaupt?" ohne Zugang zur
// Maschine. Sie haengt an keiner Watchparty - sie liest nur, was /health
// ohnehin sagt.
const statusSeite = require("./status-seite");
// Und die beiden Wege, auf denen das Relay von sich aus zeigt, dass es laeuft:
// das Symbol in der Statusleiste und die Seite beim allerersten Start.
const statusleiste = require("./statusleiste");
const seiteZeigen = require("./seite-zeigen");

// Das Relay ist ausserdem das Tor zu TMDB und AniList. Der Grund ist nicht
// Bequemlichkeit: der TMDB-Schluessel darf nicht auf die Geraete, und alles,
// was in ein Electron-Bundle wandert, ist lesbar. Die Watchparty merkt davon
// nichts - die Metadaten haengen an eigenen Routen und teilen mit ihr nur den
// Port. Fehlt der Schluessel, fehlen die Filmdaten; die Watchparty laeuft.
const metadatenDienst = metadaten.erstellen();

const PORT = Number(process.env.PORT) || 8787;
// Wann dieses Relay gestartet ist. Die Statusseite macht daraus die Laufzeit -
// und die ist die eine Zahl, an der ein stiller Neustart auffaellt.
const START_AT = Date.now();
const MAX_TITEL_JE_RAUM = 100;
// Raeume verfallen nicht.
//
// Hier stand einmal RAUM_LEBENSDAUER_MS = 30 Tage, und aufraeumen() loeschte
// jeden Raum, in dem so lange niemand war. Das war aus der Sicht des Relays
// Ordnung und aus der Sicht der Leute ein Verlust: ein Raum ist kein
// Zwischenspeicher, sondern eine Verabredung. "Bangus" gehoert denselben vier
// Leuten, ob sie diese Woche zusammen geschaut haben oder ein halbes Jahr
// nicht. Wer den Raum los sein will, nimmt seine Titel heraus und traegt ihn
// aus seinen Einstellungen aus - das ist eine Entscheidung, und nur sie darf
// einen Raum verschwinden lassen.
//
// Was aufraeumen() weiterhin tut, steht dort. Der Lebenslauf der *Titel* in
// einem Raum haengt seither nicht mehr am Alter des Raums, sondern an
// "archived" - siehe dort.

// Wie lange ein herausgenommener Titel als Grabstein liegen bleibt.
//
// Ohne ihn kommt er wieder. Jedes Geraet merkt sich, was es selbst eingestellt
// hat, und traegt es beim naechsten Verbinden nach, falls es im Raum fehlt
// (restoreWatchparty in der App). Nimmt einer den Titel heraus, waehrend das
// andere Geraet aus ist, stellt dieses ihn beim naechsten Start wieder ein -
// und fuer den Benutzer sieht es aus, als liesse er sich nicht entfernen.
//
// Der Geraeteabgleich hat dieselbe Lehre laengst gezogen (siehe
// GRAB_LEBENSDAUER_MS in geraete.js); der Watchparty fehlte sie.
const GRAB_LEBENSDAUER_MS = 30 * 24 * 60 * 60 * 1000;
// Mehr Grabsteine als Titel braucht kein Raum. Der aelteste faellt heraus.
const MAX_GRAEBER_JE_RAUM = 200;
const MAX_NACHRICHT = 256 * 1024;
const MAX_SPOILER_FOLGEN = 3000;

// Die Fassung dieses Relays.
//
// Beim Bauen der eigenstaendigen Datei hineingesetzt (siehe bauen.js); laeuft
// es aus dem Quelltext, kommt sie aus package.json. Sie steht in der
// Startzeile und ist das, woran die Selbstaktualisierung sich misst.
const FASSUNG = process.env.ELFIX_RELAY_FASSUNG || (() => {
  try {
    return require("./package.json").version;
  } catch {
    return "0.0.0";
  }
})();

// Ob dieses Relay eine gepackte Datei ist oder aus dem Quelltext laeuft.
const GEPACKT = Boolean(process.pkg) || Boolean(require("node:sea")?.isSea?.());

// Wo die Raeume liegen.
//
// systemd legt das Verzeichnis an (StateDirectory). Ohne systemd liegt die
// Datei neben dem Server - bei einer gepackten Datei aber *nicht* neben der
// Binaerdatei: die kann unter Programme oder /usr/bin liegen, wo ein Dienst
// nicht schreiben darf. Dann gilt der uebliche Ort fuer Anwendungsdaten.
const STATE_DIR = process.env.STATE_DIRECTORY || (GEPACKT ? datenOrdner() : __dirname);

function datenOrdner() {
  const heim = require("os").homedir();
  const ordner = process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(heim, "AppData", "Roaming"), "ELFIX-Relay")
    : path.join(process.env.XDG_STATE_HOME || path.join(heim, ".local", "state"), "elfix-relay");
  try {
    fs.mkdirSync(ordner, { recursive: true });
  } catch {
    // Geht das nicht, bleibt es beim Ordner der Binaerdatei - schlimmstenfalls
    // ohne Ablage, und dann muessen nach einem Neustart alle neu beitreten.
    return path.dirname(process.execPath);
  }
  return ordner;
}
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

// raumcode -> { titel: Map<key, eintrag>, graeber: Map<key, at>, at: number }
//
// "at" ist seit dem Wegfall von RAUM_LEBENSDAUER_MS nur noch eine Auskunft
// ("wann war hier zuletzt jemand") und keine Frist mehr. Es bleibt stehen,
// weil es in der Ablage liegt und nichts kostet - geloescht wird daraufhin
// nichts.
const raeume = new Map();
// Fingerabdruck eines servergebundenen, geraeteeigenen Nachweises ->
// oeffentliche Geraetekennung. Der Nachweis selbst wird weder gespeichert noch an andere
// Teilnehmer geschickt. Damit kann eine sichtbare Kennung nicht mehr einfach
// beim Beitritt behauptet werden.
const identitaeten = new Map();
let speicherTimer = null;

function raumHolen(code) {
  const vorhanden = raeume.get(code);
  if (vorhanden) {
    vorhanden.at = Date.now();
    return vorhanden;
  }
  const neu = { titel: new Map(), graeber: new Map(), warteschlange: warteschlangeAnlegen(code), at: Date.now() };
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
        // Genau so ist der Nachzieh-Merker einmal auf die Platte geraten:
        // als Map serialisiert zu einem leeren Objekt, und das ueberlebt
        // den Spread darueber.
        stand: new Map(),
        nachgezogen: new Map(),
        spoiler: new Map(),
        spoilerWartet: new Set()
      });
    }
    const graeber = new Map();
    for (const grab of raum?.graeber || []) {
      if (!grab?.key) continue;
      graeber.set(String(grab.key), Number(grab.at) || Date.now());
    }
    const warteschlange = warteschlangeAnlegen(code);
    warteschlange.laden(raum?.queue);
    raeume.set(code, { titel, graeber, warteschlange, at: Number(raum?.at) || Date.now() });
  }
  for (const eintrag of Array.isArray(roh?.identitaeten) ? roh.identitaeten : []) {
    const fingerabdruck = text(eintrag?.fingerabdruck, 64);
    const geraetId = text(eintrag?.geraetId, 64);
    if (!/^[0-9a-f]{64}$/.test(fingerabdruck) || !geraetId) continue;
    identitaeten.set(fingerabdruck, {
      geraetId,
      // Konten sind ebenfalls geheime Nachweise. Auch davon liegt nur der
      // Fingerabdruck auf der Platte.
      konto: typeof eintrag?.konto === "string" && /^[0-9a-f]{64}$/.test(eintrag.konto)
        ? eintrag.konto : ""
    });
  }
  youtubeParty.warteschlangenLaden?.(roh?.youtubeQueues);
  geraete.zustandSetzen(roh?.geraete);
  console.log(`Zustand geladen: ${raeume.size} Raum/Raeume, ${geraete.anzahl()} Geraeteschluessel`);
}

function zustandSpeichernSpaeter() {
  if (speicherTimer) return;
  speicherTimer = setTimeout(() => {
    speicherTimer = null;
    const roh = {
      raeume: {},
      geraete: geraete.zustandLesen(),
      youtubeQueues: youtubeParty.warteschlangenLesen?.() || {},
      identitaeten: [...identitaeten].map(([fingerabdruck, eintrag]) => ({
        fingerabdruck,
        geraetId: eintrag.geraetId,
        konto: eintrag.konto || ""
      }))
    };
    for (const [code, raum] of raeume) {
      roh.raeume[code] = {
        at: raum.at,
        // Grabsteine gehoeren auf die Platte: ihr ganzer Zweck ist, einen
        // Neustart und ein Geraet zu ueberleben, das eine Woche aus war.
        graeber: [...(raum.graeber || new Map()).entries()].map(([key, at]) => ({ key, at })),
        queue: raum.warteschlange?.serialisieren(),
        titel: [...raum.titel.values()].map((eintrag) => ({
          ...eintrag,
          // Laufender Abgleich, sein Zeitgeber und der Stand je Geraet sind
          // fluechtig - die Geraete melden ihn nach einem Neustart selbst.
          sync: undefined,
          syncTimer: undefined,
          stand: undefined,
          // Wer schon einmal geholt wurde, ist nach einem Neustart ohnehin
          // wieder offen - und als Map stuende hier sonst ein leeres Objekt.
          nachgezogen: undefined,
          standTimer: undefined,
            standGesendet: undefined,
            spoiler: undefined,
            spoilerWartet: undefined,
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

// Was regelmaessig wegzuraeumen ist - und was ausdruecklich nicht.
//
// Raeume nicht. Ein Raum, in dem lange niemand war, ist kein Muell, sondern
// eine Verabredung, die gerade ruht (siehe oben). Weg sind hier nur Dinge, die
// ihren Zweck erfuellt haben: Grabsteine, die ihre Frist ueberstanden haben,
// und der Kram der anderen Module.
function aufraeumen() {
  const grabGrenze = Date.now() - GRAB_LEBENSDAUER_MS;
  let entfernt = false;
  for (const raum of raeume.values()) {
    for (const [key, at] of raum.graeber || new Map()) {
      if (at < grabGrenze) {
        raum.graeber.delete(key);
        entfernt = true;
      }
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
  if (!["string", "number", "boolean"].includes(typeof value)) return "";
  return String(value).slice(0, laenge);
}

function nachrichtIstObjekt(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    // Namespaces trennen die beiden Queue-Protokolle vom alten flachen
    // Nachrichtensatz. Nur der Doppelpunkt kommt neu hinzu; Leerraum,
    // Schraegstriche und Steuerzeichen bleiben weiterhin ausgeschlossen.
    && typeof value.type === "string" && /^[a-z][a-z0-9:-]{0,31}$/.test(value.type);
}

function nachweisFingerabdruck(value) {
  const nachweis = typeof value === "string" ? value : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(nachweis)) return "";
  return crypto.createHash("sha256").update(nachweis, "utf8").digest("hex");
}

function kontoFingerabdruck(value) {
  const konto = typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : "";
  return konto ? crypto.createHash("sha256").update(konto, "utf8").digest("hex") : "";
}

function neueGeraetId() {
  let geraetId = "";
  do {
    geraetId = crypto.randomUUID();
  } while ([...identitaeten.values()].some((eintrag) => eintrag.geraetId === geraetId));
  return geraetId;
}

function kennungIstGeschuetzt(geraetId) {
  if (!geraetId) return true;
  if ([...identitaeten.values()].some((eintrag) => eintrag.geraetId === geraetId)) return true;
  for (const raum of raeume.values()) {
    for (const eintrag of raum.titel.values()) {
      if (eintrag.addedById === geraetId || eintrag.members.has(geraetId)) return true;
    }
  }
  if (typeof wss !== "undefined") {
    for (const client of wss.clients) {
      if (client.geraetId === geraetId) return true;
    }
  }
  return false;
}

function identitaetFuer(nachricht) {
  const fingerabdruck = nachweisFingerabdruck(nachricht.deviceProof);
  if (!fingerabdruck) return null;
  let eintrag = identitaeten.get(fingerabdruck);
  if (!eintrag) {
    // Eine frisch nachgewiesene Identitaet darf fuer alte lokale Test- und
    // Anzeigeverweise ihre gewuenschte Kennung behalten, sofern daran noch
    // keinerlei Zustand oder andere Identitaet haengt. Ein vorhandener Name
    // oder eine vorhandene Kennung wird dadurch gerade nicht uebernommen.
    const gewuenscht = typeof nachricht.deviceId === "string"
      && /^[\p{L}\p{N}_.:-]{1,64}$/u.test(nachricht.deviceId)
      && !kennungIstGeschuetzt(nachricht.deviceId)
      ? nachricht.deviceId : "";
    eintrag = {
      geraetId: gewuenscht || neueGeraetId(),
      konto: kontoFingerabdruck(nachricht.accountProof)
    };
    identitaeten.set(fingerabdruck, eintrag);
    zustandSpeichernSpaeter();
  } else if (!eintrag.konto) {
    // Ein Konto darf einmal nachgetragen werden, wenn der Geraeteabgleich erst
    // spaeter eingeschaltet wurde. Danach bleibt es an diesen Nachweis gebunden.
    const konto = kontoFingerabdruck(nachricht.accountProof);
    if (konto) {
      eintrag.konto = konto;
      zustandSpeichernSpaeter();
    }
  }
  return eintrag;
}

function zahl(value, max) {
  if (typeof value !== "number" && typeof value !== "string") return 0;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0;
}

function httpAdresse(value) {
  const wert = text(value, 800);
  return /^https?:\/\//i.test(wert) ? wert : "";
}

/**
 * Die Tempostufen der Runde - dieselbe Leiter wie in watchparty-sync.js.
 *
 * Sie steht hier ein zweites Mal, weil das Relay ohne die App laeuft: es hat
 * kein `require` auf StreamingBrowserElectron und soll auch keines bekommen.
 * Was hereinkommt, kommt aus dem Netz - also wird es auf eine der sechs Stufen
 * gezwungen, bevor es der Runde gehoert.
 */
const TEMPO_STUFEN = [0.5, 0.75, 1, 1.25, 1.5, 2];

function tempoStufe(wert) {
  if (typeof wert !== "number" && typeof wert !== "string") return 1;
  const n = Number(wert);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return TEMPO_STUFEN.reduce((beste, stufe) => (
    Math.abs(stufe - n) < Math.abs(beste - n) ? stufe : beste
  ), 1);
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

/**
 * Wer diesen Titel eingestellt hat - ueber Geraet *und* Konto.
 *
 * Ein zweites nachgewiesenes Geraet desselben Kontos ist derselbe Besitzer.
 * Die Karte (`mine`) und das Herausnehmen (`unshare`) rechnen laengst so; nur
 * das Entfernen einzelner Mitglieder fragte allein nach der Geraete-ID. Wer
 * sein Geraet gewechselt hatte, zaehlte dort ploetzlich nicht mehr als
 * Ersteller und bekam niemanden mehr aus seinem eigenen Titel heraus.
 */
function istEinsteller(eintrag, socket) {
  if (!eintrag || !socket?.geraetId) return false;
  if (eintrag.addedById === socket.geraetId) return true;
  return Boolean(socket.konto) && eintrag.addedByKonto === socket.konto;
}

/** Das Konto hinter einer Geraetekennung, soweit eines nachgewiesen ist. */
function kontoVonGeraet(geraetId) {
  if (!geraetId) return "";
  for (const eintrag of identitaeten.values()) {
    if (eintrag.geraetId === geraetId) return eintrag.konto || "";
  }
  return "";
}

/**
 * Das Vorgaengergeraet aus der Mitgliederliste nehmen.
 *
 * Gemeldet mit einem Bildschirmfoto: "11 dabei", und die Haelfte davon
 * doppelt - jeder Name zweimal. Eine Mitgliedschaft haengt an der
 * Geraetekennung und bleibt ueber Verbindungsabbrueche hinweg bestehen; das
 * ist richtig. Nach einer Neuinstallation bekommt dasselbe Geraet aber eine
 * neue Kennung, und die alte blieb fuer immer in der Liste stehen.
 *
 * Weggeraeumt wird nur, was eindeutig dasselbe Geraet ist: gleiches
 * nachgewiesenes Konto, gleicher Name, andere Kennung - und gerade nicht
 * verbunden. Zwei echte Geraete einer Person (Rechner, Fernseher, Telefon)
 * heissen verschieden und bleiben deshalb beide stehen.
 */
function vorgaengerAufraeumen(raumcode, eintrag, socket) {
  if (!socket?.konto || !socket.geraetId) return false;
  const name = socket.name || "";
  if (!name) return false;
  let geaendert = false;
  for (const [geraetId, mitgliedName] of [...eintrag.members]) {
    if (geraetId === socket.geraetId || mitgliedName !== name) continue;
    if (kontoVonGeraet(geraetId) !== socket.konto) continue;
    if (istVerbunden(raumcode, geraetId)) continue;
    eintrag.members.delete(geraetId);
    eintrag.stand?.delete(geraetId);
    eintrag.spoiler?.delete(geraetId);
    eintrag.spoilerWartet?.delete(geraetId);
    hostFreigeben(eintrag, geraetId);
    geaendert = true;
  }
  return geaendert;
}

function akteurFuer(socket) {
  if (!socket?.geraetId) return null;
  return {
    principal: socket.konto ? `konto:${socket.konto}` : `geraet:${socket.geraetId}`,
    id: socket.geraetId,
    name: socket.name || "Gerät"
  };
}

function warteschlangeAnlegen(code) {
  return new AbstimmungsWarteschlange({
    art: "title",
    saeubern: titelSaeubern,
    schluessel: (eintrag) => eintrag.key,
    onChange: () => {
      warteschlangeSenden(code);
      zustandSpeichernSpaeter();
    },
    onStart: (pending) => warteschlangenStartSenden(code, pending),
    onReady: (pending, bereit) => warteschlangenStartVorbereiten(code, pending, bereit),
    onCancel: (pending, reason) => warteschlangenStartAbbrechen(code, pending, reason)
  });
}

function spoilerFolgenSaeubern(roh) {
  if (!Array.isArray(roh)) return [];
  const gesehen = new Set();
  const folgen = [];
  for (const wert of roh) {
    if (!Array.isArray(wert) || wert.length < 2) continue;
    const season = zahl(wert[0], 999);
    const episode = zahl(wert[1], 9999);
    if (!episode) continue;
    const key = `${season}:${episode}`;
    if (gesehen.has(key)) continue;
    gesehen.add(key);
    folgen.push([season, episode]);
    if (folgen.length >= MAX_SPOILER_FOLGEN) break;
  }
  return folgen.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

function fortschrittSaeubern(roh) {
  if (!roh || typeof roh !== "object" || Array.isArray(roh)) return null;
  return {
    url: httpAdresse(roh.url),
    season: zahl(roh.season, 999),
    episode: zahl(roh.episode, 9999),
    position: zahl(roh.position, 100000),
    duration: zahl(roh.duration, 100000),
    progress: zahl(roh.progress, 100),
    completed: Boolean(roh.completed),
    episodeCompleted: Boolean(roh.episodeCompleted),
    // Ob die Runde mit diesem Titel durch ist - siehe folgeIstNeuer() und den
    // Abschnitt "progress" weiter unten. Das Geraet rechnet es aus (es kennt
    // die Seriengrenzen, das Relay nicht); hier wird es nur gefuehrt.
    archived: Boolean(roh.archived),
    updatedAt: text(roh.updatedAt || new Date().toISOString(), 40),
    from: text(roh.from, 60)
  };
}

// Meldet dieser Stand eine Folge *nach* der, bei der der Titel gerade steht?
//
// Die eine Frage, an der die Wiederbelebung eines archivierten Titels haengt.
// Sie ist absichtlich streng: ein Geraet, das eine Woche aus war, meldet beim
// Start seinen alten Stand, und der darf einen archivierten Titel nicht
// aufwecken - sonst stuende "Black Torch" nach jedem Handystart wieder bei
// Folge 5 in "Gemeinsam weiterschauen". Ein Film hat keine naechste Folge und
// kommt so nie zurueck; das ist gewollt.
function folgeIstNeuer(eintrag, fortschritt) {
  const alteStaffel = Number(eintrag?.progress?.season || eintrag?.season || 0);
  const alteFolge = Number(eintrag?.progress?.episode || eintrag?.episode || 0);
  const neueStaffel = Number(fortschritt?.season || 0);
  const neueFolge = Number(fortschritt?.episode || 0);
  if (!neueStaffel && !neueFolge) return false;
  if (neueStaffel !== alteStaffel) return neueStaffel > alteStaffel;
  return neueFolge > alteFolge;
}

function titelNachAussen(raumcode, eintrag, fuerGeraet, fuerKonto) {
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
    // Was der Host fuer die Runde eingestellt hat. Steht in der Karte, damit
    // ein Beitretender es uebernehmen kann, ohne jemanden zu fragen.
    tempo: eintrag.tempo || 1,
    fassung: eintrag.fassung || "",
    hoster: eintrag.hoster || "",
    addedBy: eintrag.addedBy,
    addedById: eintrag.addedById,
    // Das Kontokennzeichen ist ein geheimer Besitznachweis und darf nicht im
    // Raumzustand stehen. Der Empfaenger bekommt nur das fertige Ergebnis.
    mine: eintrag.addedById === fuerGeraet
      || (Boolean(fuerKonto) && eintrag.addedByKonto === fuerKonto),
    addedAt: eintrag.addedAt,
    // Archiviert heisst: die Runde hat diesen Titel hinter sich - der Film ist
    // zu Ende, oder von der Serie gibt es gerade nichts Neues. Der Eintrag
    // bleibt trotzdem stehen, samt Raum, Mitgliedern und Werk: erscheint eine
    // Folge, wird genau dieser Eintrag wieder aktiv, und niemand muss den
    // Titel neu einstellen und alle neu beitreten lassen.
    archived: Boolean(eintrag.archived),
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

  if (pfad === "/fern/icon.png" || pfad === "/fern/icon-192.png") {
    const bild = pfad.endsWith("icon-192.png") ? fernIcon.ICON_192 : fernIcon.ICON_512;
    res.writeHead(200, {
      "content-type": "image/png",
      // Die Symbole aendern sich praktisch nie.
      "cache-control": "public, max-age=604800",
      "content-length": bild.length
    });
    res.end(bild);
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

  // Die Statusseite. Fuer Menschen, waehrend /health fuer Programme bleibt -
  // dieselben Zahlen, nur lesbar.
  if (pfad === "/status") {
    statusAusliefern(res);
    return;
  }

  if (pfad === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      // Die Fassung, die Laufzeit und die offenen Verbindungen. Sie stehen hier,
      // weil die Statusseite sie zeigt - und weil "es antwortet" und "es laeuft
      // seit dem Absturz vor zwei Minuten" zwei verschiedene Auskuenfte sind.
      // Ein Pfad zur Ablage steht ausdruecklich nicht dabei: /health ist so
      // oeffentlich wie das Relay, und was niemandem nuetzt, gehoert nicht hin.
      fassung: FASSUNG,
      port: PORT,
      gepackt: GEPACKT,
      laeuftSeitS: Math.round((Date.now() - START_AT) / 1000),
      verbindungen: offeneVerbindungen(),
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
      features: ["share", "enter", "kick", "persist", "syncall", "hostpause", "watchstate", "here", "bye", "handover", "episodehost", "hostzeit", "clock", "seq", "metadata", "youtube", "queue", "ytqueue", "spoilerstate", "chat", "geraete",
        // "tempo" heisst: der Host stellt Geschwindigkeit und Fassung fuer die
        // ganze Runde. Fehlt der Eintrag, laeuft drueben ein aelteres Relay -
        // es wirft beide Befehle weg, und jeder bleibt bei seiner Einstellung.
        "tempo",
        // "fern" heisst: dieses Relay koppelt Handy und Rechner und liefert die
        // Seite dafuer unter /fern aus.
        "fern",
        // "fernapp" heisst: die Seite kommt mit Manifest, Symbolen und Service
        // Worker - erst damit bietet Chrome "App installieren" an. Ein Relay
        // ohne diesen Eintrag liefert die Fernbedienung zwar aus, aber Chrome
        // legt davon nur eine Verknuepfung mit Browserleiste an. Das sieht man
        // der Seite nicht an, und darum steht es hier: die App fragt danach und
        // sagt es, statt den Nutzer raten zu lassen.
        "fernapp",
        // "status" heisst: dieses Relay liefert unter / und /status eine Seite
        // aus, die seinen Zustand zeigt, und /health nennt Fassung, Laufzeit und
        // offene Verbindungen. Ohne den Eintrag laeuft dort drueben eine
        // aeltere Fassung, und wer die Adresse aufruft, bekommt nur eine Zeile
        // Text.
        "status",
        // "trailer" heisst: die Metadaten dieses Relays tragen den Trailer zu
        // einem Werk. Ohne den Eintrag laeuft dort eine aeltere Fassung - und
        // die App kann das sagen, statt "kein Trailer hinterlegt" zu behaupten.
        // Genau diese Auskunft war falsch und hat einen Abend gekostet: zu dem
        // gemeldeten Film fuehrt TMDB einen deutschen Trailer, das Relay kannte
        // das Feld nur nicht.
        "trailer"],
      // Ob die Anreicherung bereitsteht - ohne den Schluessel selbst. Der
      // gehoert weder in eine Antwort noch ins Journal.
      ...metadatenDienst.zustand()
    }));
    return;
  }
  // Die Wurzel bedient beide: ein Browser bekommt die Seite, alles andere die
  // eine Zeile Text von frueher. Das ist keine Spielerei - `curl` auf die
  // Wurzel steht in Anleitungen und in mancher Ueberwachung, und dort waere
  // HTML eine Verschlechterung. Wer die Seite ausdruecklich will, ruft /status
  // auf; dort gibt es sie immer.
  if (willHtml(req)) {
    statusAusliefern(res);
    return;
  }

  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("ELFIX Watchparty-Relay laeuft. Die Statusseite steht unter /status, die App verbindet sich per WebSocket.\n");
});

// Ob der Aufrufer eine Seite erwartet oder eine Auskunft. Browser sagen das im
// Accept-Kopf; curl und die Ueberwachung sagen dort nichts oder */*.
function willHtml(req) {
  return String(req.headers?.accept || "").includes("text/html");
}

function statusAusliefern(res) {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    // Nicht zwischenspeichern: eine Statusseite aus dem Zwischenspeicher zeigt
    // ein Relay, das es so vielleicht gar nicht mehr gibt.
    "cache-control": "no-store"
  });
  res.end(statusSeite.SEITE);
}

// Wie viele Geraete gerade wirklich haengen. Nicht wss.clients.size: darin
// stecken auch Verbindungen, die schon im Abbau sind.
function offeneVerbindungen() {
  let offen = 0;
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) offen += 1;
  }
  return offen;
}

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

function warteschlangeSenden(raumcode, reason = "") {
  const queue = raeume.get(raumcode)?.warteschlange;
  if (!queue) return;
  for (const client of wss.clients) {
    if (client.raum !== raumcode || client.readyState !== client.OPEN) continue;
    client.send(JSON.stringify({ type: "queue:state", room: raumcode,
      ...queue.zustand(akteurFuer(client), reason ? { reason } : {}) }));
  }
}

function warteschlangeAnSocket(socket, reason = "") {
  const queue = raeume.get(socket.raum)?.warteschlange;
  if (!queue || socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify({ type: "queue:state", room: socket.raum,
    ...queue.zustand(akteurFuer(socket), reason ? { reason } : {}) }));
  if (queue.istStartZiel(socket.geraetId)) {
    socket.send(JSON.stringify(queue.startNachricht(akteurFuer(socket), {
      type: "queue:start", room: socket.raum, replay: true
    })));
  }
}

function warteschlangenStartSenden(raumcode, pending) {
  const raum = raeume.get(raumcode);
  if (!raum || !pending?.entry?.data) return;
  const daten = pending.entry.data;
  // Der Titel bleibt bis zu allen Lade-ACKs vollstaendig unangetastet. Die
  // Clients haben den validierten Eintrag in queue:start; die serverseitige
  // Mitgliedschaft wird unmittelbar vor syncprepare materialisiert.
  pending.context.targetKey = daten.key;
  for (const client of wss.clients) {
    if (client.raum !== raumcode || client.readyState !== client.OPEN
      || !pending.targets.has(client.geraetId)) continue;
    client.send(JSON.stringify(raum.warteschlange.startNachricht(akteurFuer(client), {
      type: "queue:start", room: raumcode
    })));
  }
}

function warteschlangenStartAbbrechen(raumcode, pending, reason) {
  const raum = raeume.get(raumcode);
  if (!raum || !pending) return;
  const targetKey = pending.context?.targetKey || pending.entry?.data?.key || "";
  const nachricht = {
    type: "queue:cancel", room: raumcode, startId: pending.startId,
    reason: text(reason, 80), fromKey: text(pending.context?.fromKey, 300),
    targetKey: text(targetKey, 300)
  };
  anMitgliederSenden(raumcode, nachricht, pending.targets);
  zustandSenden(raumcode);
}

function warteschlangenStartVorbereiten(raumcode, pending, bereit) {
  const raum = raeume.get(raumcode);
  if (!raum || !bereit?.size || !pending?.entry?.data) return;
  const daten = pending.entry.data;
  let eintrag = raum.titel.get(pending.context?.targetKey || daten.key);
  if (!eintrag) {
    eintrag = {
      ...daten,
      addedBy: pending.entry.proposedByName,
      addedById: pending.entry.proposedById,
      addedByKonto: pending.entry.proposedBy.startsWith("konto:")
        ? pending.entry.proposedBy.slice("konto:".length) : "",
      addedAt: new Date(pending.entry.proposedAt).toISOString(),
      members: new Map(), spoiler: new Map(), spoilerWartet: new Set(),
      archived: false, progress: null
    };
    raum.titel.set(daten.key, eintrag);
  }
  if (!(eintrag.members instanceof Map)) eintrag.members = new Map();
  if (!(eintrag.spoiler instanceof Map)) eintrag.spoiler = new Map();
  if (!(eintrag.spoilerWartet instanceof Set)) eintrag.spoilerWartet = new Set();
  const quelle = raum.titel.get(pending.context?.fromKey);
  for (const id of pending.targets) {
    if (eintrag.members.has(id)) continue;
    const verbunden = [...wss.clients].find((client) => client.raum === raumcode && client.geraetId === id);
    eintrag.members.set(id, quelle?.members?.get(id) || verbunden?.name || "Gerät");
  }
  // Erst nachdem wirklich alle Zielgeraete den pausierten Inhalt bestaetigt
  // haben, wird er zum gemeinsamen Raumstand. Ein NACK oder Timeout kann
  // dadurch weder alten Fortschritt noch eine andere aktive Gruppe zerstoeren.
  clearTimeout(eintrag.syncTimer);
  eintrag.url = daten.url;
  eintrag.title = daten.title || eintrag.title;
  eintrag.providerName = daten.providerName || eintrag.providerName;
  eintrag.thumbnail = daten.thumbnail || eintrag.thumbnail;
  eintrag.type = daten.type || eintrag.type;
  eintrag.season = daten.season || 0;
  eintrag.episode = daten.episode || 0;
  eintrag.archived = false;
  fortschrittAufFolge(eintrag, 0, "Warteschlange");
  eintrag.live = { action: "navigate", position: 0, url: daten.url, at: Date.now() };
  eintrag.sync = null;
  eintrag.syncTimer = null;
  eintrag.startAt = 0;
  eintrag.letzteAktion = null;
  eintrag.hostId = [...bereit][0] || "";
  eintrag.hostGesehen = Date.now();
  eintrag.nachgezogen = new Map();
  for (const id of bereit) {
    standSetzen(eintrag, id, eintrag.members.get(id), {
      position: 0, paused: true, season: eintrag.season, episode: eintrag.episode
    });
  }
  syncVorbereiten(raumcode, eintrag, 0, "Warteschlange", [...bereit][0], {
    aktion: "play", grund: "queue-change", mitgliedIds: bereit
  });
}

function spoilerStand(eintrag) {
  if (!eintrag) return { ids: new Set(), known: false, completed: [], unknownCount: 0 };
  if (!(eintrag.spoiler instanceof Map)) eintrag.spoiler = new Map();
  const aktiv = new Set();
  for (const [id, wert] of eintrag.stand || new Map()) {
    if (wert && Date.now() - (wert.at || 0) <= STAND_FRISCH_MS) aktiv.add(id);
  }
  for (const id of eintrag.spoilerWartet || new Set()) {
    if (eintrag.members?.has(id)) aktiv.add(id);
  }
  let schnitt = null;
  let unbekannt = 0;
  for (const id of aktiv) {
    const menge = eintrag.spoiler.get(id);
    if (!(menge instanceof Set)) {
      unbekannt += 1;
      continue;
    }
    if (schnitt === null) schnitt = new Set(menge);
    else for (const folge of schnitt) if (!menge.has(folge)) schnitt.delete(folge);
  }
  const completed = unbekannt || schnitt === null ? [] : [...schnitt]
    .map((wert) => wert.split(":").map(Number))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { ids: aktiv, known: aktiv.size > 0 && unbekannt === 0, completed, unknownCount: unbekannt };
}

function spoilerStandSenden(raumcode, eintrag) {
  const stand = spoilerStand(eintrag);
  const daten = {
    type: "spoilerstate", room: raumcode, key: eintrag.key,
    known: stand.known, completed: stand.completed, unknownCount: stand.unknownCount
  };
  const merkmal = JSON.stringify(daten);
  if (eintrag.spoilerGesendet === merkmal) return;
  eintrag.spoilerGesendet = merkmal;
  anMitgliederSenden(raumcode, daten, stand.ids);
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
    const shared = [...raum.titel.values()].map((eintrag) =>
      titelNachAussen(raumcode, eintrag, client.geraetId, client.konto));
    client.send(JSON.stringify({
      type: "state",
      identityVersion: 2,
      shared,
      peers,
      you: client.geraetId
    }));
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
  // A paused heartbeat captured during the scheduled start can arrive just
  // after its deadline. It describes preparation, not a later user pause;
  // otherwise the next guest pause rewinds everyone to the starting frame.
  const vorbereitungsStand = eigen?.paused && eintrag.live?.action === "play"
    && Number(eintrag.startAt) > 0 && eigen.at <= Number(eintrag.startAt) + 250;
  if (eigen && !vorbereitungsStand) {
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

/**
 * Wie weit im Voraus ein gemeinsamer Start verabredet wird.
 *
 * <p>800 Millisekunden. Sie sind kein Puffer gegen die Leitung, sondern die
 * Zeit, die jeder Player zum Fertigmachen bekommt: springen, an der neuen
 * Stelle puffern, den Startbefehl annehmen. Wer frueher fertig ist, wartet den
 * Rest ab - und deshalb faengt niemand vor den anderen an.
 */
const START_VORLAUF_MS = 800;

/**
 * Der Zeitpunkt, zu dem alle gemeinsam losfahren - in Serverzeit.
 *
 * <p>Vorher gab es ihn nicht: wer Play drueckte, lief sofort los, und die
 * anderen holten auf. Der Rueckstand war damit genau die Laufzeit der Nachricht
 * plus die Zeit fuers Springen und Puffern - jedes Mal, und er blieb stehen,
 * weil der laufende Ausgleich erst bei fuenf Sekunden eingreift.
 *
 * <p>Der Absender darf einen Zeitpunkt vorschlagen: er kennt seinen eigenen
 * Uhrversatz aus Ping/Pong und stellt sich damit auf denselben Augenblick ein,
 * ohne dass ihm das Relay etwas zurueckschicken muesste. Angenommen wird der
 * Vorschlag nur, wenn er in der nahen Zukunft liegt - alles andere waere eine
 * Uhr, der nicht zu trauen ist, oder ein Versuch, die Runde anzuhalten.
 *
 * @param laeuftDanach ob nach diesem Befehl ueberhaupt etwas laeuft
 * @param jetzt        die Serverzeit in diesem Augenblick
 * @param vorschlag    was der Absender vorgeschlagen hat, falls etwas
 * @return der Zeitpunkt in Serverzeit, 0 wenn nichts zu starten ist
 */
function startZeitpunkt(laeuftDanach, jetzt, vorschlag) {
  if (!laeuftDanach) return 0;
  const wunsch = Number(vorschlag);
  // Ein Vorschlag, der beim Relay schon fast faellig ist, hilft keinem
  // Geraet beim Puffern. Er wuerde den Ausloeser frueher starten lassen als
  // die Empfaenger, obwohl alle dieselbe Serveruhr benutzen. Deshalb gilt ein
  // uebernommener Zeitpunkt nur, wenn der volle Vorlauf noch vor ihm liegt.
  if (Number.isFinite(wunsch) && wunsch >= jetzt + START_VORLAUF_MS && wunsch <= jetzt + 5000) return wunsch;
  return jetzt + START_VORLAUF_MS;
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
/**
 * Die Geraete, die fuer diesen Titel wirklich einen Player offen haben - ohne
 * Ruecksicht auf die Folge.
 *
 * Fuer einen Folgenwechsel ist das die richtige Menge: die anderen stehen noch
 * bei der alten Folge und sollen mitkommen, aber wer gar keinen Player fuer
 * diesen Titel hat, hat auch nichts vorzubereiten. `aktiveTeilnehmer` waere zu
 * eng (es fragt nach genau einer Folge), "alle Mitglieder" zu weit.
 */
function spielerImTitel(raumcode, eintrag) {
  const ids = new Set();
  for (const [geraetId, wert] of eintrag.stand || new Map()) {
    if (istAktiv(raumcode, eintrag, geraetId, wert)) ids.add(geraetId);
  }
  return ids;
}

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
// Wie lange ein Host seine Rolle nach einem Verbindungsabriss behaelt.
//
// Nur dafuer, und das ist der Unterschied: bei einem Abriss loescht das Relay
// seinen Stand sofort, er waere also von einer Sekunde auf die andere weg -
// obwohl ein Neuladen, ein Hosterwechsel oder ein kurzes Funkloch Sekunden
// dauern. Ohne diese Frist rueckte bei jedem Wackeln jemand nach, und kam der
// Host zurueck, wechselte es gleich noch einmal.
//
// Verstummt er dagegen bei offener Verbindung, gilt die gewoehnliche Regel:
// nach STAND_FRISCH_MS ist er nicht mehr aktiv und damit auch nicht mehr Host.
// Dort ist nichts zu ueberbruecken - er ist ja noch da und sagt nichts.
const HOST_GNADE_MS = 12000;

// Wer ist Host?
//
// Frueher: wer die laufende Folge zuerst betreten hat. Das hiess in der Praxis,
// dass bei jeder neuen Folge neu gewuerfelt wurde und gewann, wessen Hoster
// schneller laedt - der Host wechselte also staendig, ohne dass jemand die
// Runde verlassen haette. Dasselbe beim Neuladen des Players: der Stempel, an
// dem die Reihenfolge hing, wurde bei jeder neuen Player-Sitzung neu gesetzt.
//
// Jetzt haelt der Host seine Rolle, bis er sie wirklich abgibt. Gewaehlt wird
// nur, wenn keiner da ist - und wer gewaehlt wurde, bleibt es dann auch ueber
// Folgen hinweg.
//
// Abgegeben wird sie in genau vier Faellen, und alle vier stehen anderswo im
// Code: der Host verlaesst die Folge ("bye"), verlaesst den Titel ("leave"),
// wird entfernt ("kick") - oder uebergibt ausdruecklich ("handover"). Ein
// Folgenwechsel gehoert nicht dazu, und ein Neuladen auch nicht.
function aktuelleHostId(raumcode, eintrag) {
  const gehalten = eintrag.hostId;
  if (gehalten && eintrag.members.has(gehalten)) {
    const wert = eintrag.stand?.get(gehalten);
    if (wert && istAktiv(raumcode, eintrag, gehalten, wert)) {
      eintrag.hostGesehen = Date.now();
      return gehalten;
    }
    // Ein schliessender Socket gilt bereits als getrennt, bevor sein close-
    // Handler den Stand entfernt. Ein Gast-Herzschlag in diesem Zeitfenster
    // darf die Gnadenfrist nicht ueberspringen. Bei offener Verbindung und
    // veraltetem Stand gilt weiterhin die normale Aktivitaetsfrist.
    if ((!wert || !istVerbunden(raumcode, gehalten))
      && Date.now() - (eintrag.hostGesehen || 0) <= HOST_GNADE_MS) return gehalten;
    /*
     * Waehrend eines Folgenwechsels schweigt jeder.
     *
     * Der Player ist zu, die neue Quelle wird aufgeloest und gepuffert - das
     * dauert auf einem Telefon leicht laenger als die Frist, nach der ein
     * Stand als alt gilt. Wer gerade laedt, ist aber nicht weg, und die Rolle
     * darf dabei nicht weiterwandern: sonst fuehrt nach jedem Wechsel ein
     * anderer, blass weil sein Hoster schneller war. Solange die Schranke
     * offen ist und der Bisherige verbunden bleibt, bleibt er Host.
     */
    if (eintrag.sync && istVerbunden(raumcode, gehalten)) {
      eintrag.hostGesehen = Date.now();
      return gehalten;
    }
  }
  const gewaehlt = hostFuerFolge(raumcode, eintrag, eintrag.season, eintrag.episode);
  if (!gewaehlt) return "";
  eintrag.hostId = gewaehlt.geraetId;
  eintrag.hostGesehen = Date.now();
  return gewaehlt.geraetId;
}

// Der Host als Zeitquelle - also mit Stelle und Pausenzustand.
//
// Bewusst getrennt von der Frage, wer Host *ist*: waehrend der Gnadenfrist
// bleibt er Host, taugt aber nicht als Quelle, weil von ihm gerade nichts
// Frisches vorliegt. Dann faellt hostZustandJetzt auf den Rundenstand zurueck,
// statt alle auf eine erfundene Null zu ziehen.
function aktuellerHost(raumcode, eintrag) {
  const id = aktuelleHostId(raumcode, eintrag);
  if (!id) return null;
  const wert = eintrag.stand?.get(id);
  if (!wert || !istAktiv(raumcode, eintrag, id, wert)) return null;
  return { geraetId: id, ...wert };
}

// Gibt der Host die Rolle wirklich ab, wird sofort neu gewaehlt - ohne
// Gnadenfrist, denn hier ist nichts unklar.
function hostFreigeben(eintrag, geraetId) {
  if (eintrag.hostId !== geraetId) return;
  eintrag.hostId = "";
  eintrag.hostGesehen = 0;
}

// Und der Host, der fuer genau dieses Geraet gilt: es zaehlt die Folge, die es
// selbst offen hat. Wer eine Folge weiter ist, sieht dort seinen eigenen Host.
function hostFuerGeraet(raumcode, eintrag, geraetId) {
  // Der gehaltene Host gilt fuer alle - sonst zeigte die Leiste auf dem
  // Fernseher jemand anderen als die Karte, sobald zwei Geraete kurz auf
  // verschiedenen Folgen stehen. Desktop, Android und Fernseher sollen
  // dieselbe Kennung sehen.
  const id = aktuelleHostId(raumcode, eintrag);
  if (id) {
    // Auch ohne frischen Stand: waehrend eines kurzen Abrisses ist der Host
    // weiterhin der Host, und die Karte soll ihn nennen. Hier zaehlt nur die
    // Kennung und der Name - Stelle und Pausenzustand holt sich der Abgleich
    // an anderer Stelle und merkt dort selbst, dass gerade nichts vorliegt.
    const wert = eintrag.stand?.get(id);
    return wert
      ? { geraetId: id, ...wert }
      : { geraetId: id, name: eintrag.members.get(id) || "Gerät" };
  }
  const eigen = eintrag.stand?.get(geraetId);
  const season = eigen ? eigen.season : eintrag.season;
  const episode = eigen ? eigen.episode : eintrag.episode;
  return hostFuerFolge(raumcode, eintrag, season, episode);
}

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
    // Dasselbe fuer die Gegenrichtung: wann diesem Geraet zuletzt ein Pause
    // nachgehalten wurde. Ohne den Uebertrag baut standSetzen den Eintrag bei
    // jedem Herzschlag neu, der Stempel waere weg und die Bremse zwecklos -
    // das Relay schickte im Sekundentakt Pausen hinterher.
    gestoppt: vorher.gestoppt || 0,
    name: name || vorher.name || eintrag.members.get(geraetId) || "Gerät",
    position: werte.position == null ? (vorher.position || 0) : werte.position,
    paused: werte.paused == null ? Boolean(vorher.paused) : Boolean(werte.paused),
    frameTime: Number.isFinite(werte.frameTime) && werte.frameTime >= 0
      ? werte.frameTime : undefined,
    playbackRate: Number.isFinite(werte.playbackRate) && werte.playbackRate > 0
      ? Math.min(werte.playbackRate, 4) : undefined,
    buffering: typeof werte.buffering === "boolean" ? werte.buffering : undefined,
    season: werte.season == null ? (vorher.season || 0) : werte.season,
    episode: werte.episode == null ? (vorher.episode || 0) : werte.episode,
    at: Date.now()
  });
  return wachAuf;
}

// Ein Befehl gilt fuer alle Beigetretenen - also stehen danach auch alle dort.
/**
 * @param ausser wessen Eintrag der Befehl nicht meint - oder leer fuer alle.
 *               Gebraucht beim Play eines Nicht-Hosts: den Befehl bekommt er
 *               selbst nicht zurueck (er hat ja gedrueckt), also rueckt er
 *               auch nicht auf die Stelle des Hosts. Sein Eintrag mit ihr zu
 *               fuellen behauptete, er stuende dort - er steht, wo er steht,
 *               und sagt es mit seinem naechsten Herzschlag selbst.
 */
function standFuerAlle(eintrag, position, paused, ausser) {
  for (const geraetId of eintrag.members.keys()) {
    if (ausser && geraetId === ausser) continue;
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
      ...(Number.isFinite(wert.frameTime) ? { frameTime: wert.frameTime } : {}),
      ...(Number.isFinite(wert.playbackRate) ? { playbackRate: wert.playbackRate } : {}),
      ...(typeof wert.buffering === "boolean" ? { buffering: wert.buffering } : {}),
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
      tempo: eintrag.tempo || 1,
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

const SYNC_BEREIT_FRIST_MS = 5000;
const FOLGENWECHSEL_BEREIT_FRIST_MS = 90000;

// Eine Startschranke gehoert den aktuell offenen, eingetretenen Geraeten und
// nicht den Socket-Objekten, die beim Anlegen zufaellig offen waren. Ein
// Wiederanschluss bekommt dadurch dieselbe Vorbereitung; ein Timeout erreicht
// den neuen Socket statt eines laengst geschlossenen alten.
function offeneSyncTeilnehmer(raumcode, eintrag) {
  return [...wss.clients].filter((client) => (
    client.raum === raumcode && client.readyState === client.OPEN
    && client.geraetId && eintrag.members.has(client.geraetId)
  ));
}

function syncTeilnehmerNachtragen(raumcode, eintrag, socket) {
  if (!eintrag?.sync || !eintrag.sync.vorbereitung
    || socket.raum !== raumcode || socket.readyState !== socket.OPEN
    || !socket.geraetId || !eintrag.members.has(socket.geraetId)) return false;
  // Nur wer zu dieser Schranke gehoert. Sonst tritt ein Geraet, das waehrend
  // des Wechsels zufaellig verbindet, in eine Wartemenge ein, in der es nie
  // war - und haelt alle uebrigen fest.
  if (eintrag.sync.erwartet instanceof Set
    && !eintrag.sync.erwartet.has(socket.geraetId)) return false;
  eintrag.sync.wartetAuf.add(socket.geraetId);
  socket.send(eintrag.sync.vorbereitung);
  return true;
}

function syncTeilnehmerEntfernen(raumcode, eintrag, geraetId, alterSocket = null) {
  if (!eintrag?.sync || !geraetId) return;
  const gleicheVerbindung = offeneSyncTeilnehmer(raumcode, eintrag)
    .some((client) => client !== alterSocket && client.geraetId === geraetId);
  if (gleicheVerbindung) return;
  eintrag.sync.wartetAuf.delete(geraetId);
  // Start nur, wenn mindestens ein eingetretener Teilnehmer noch wirklich
  // verbunden ist. In einen leeren Raum startet das Relay kein Video.
  if (!eintrag.sync.wartetAuf.size
    && offeneSyncTeilnehmer(raumcode, eintrag).some((client) => client !== alterSocket)) {
    syncStarten(raumcode, eintrag);
  }
}

// Alle Teilnehmer auf derselben Stelle anhalten und erst nach ihren echten
// Bereitmeldungen gemeinsam weiterlaufen lassen. Ein fehlendes "bereit" ist
// kein stilles Einverstaendnis: bei Ablauf der Frist bleibt die Runde stehen,
// damit kein noch pufferndes Geraet wieder allein loslaeuft.
function syncVorbereiten(raumcode, eintrag, ziel, von, userId, optionen = {}) {
  const frameTime = eintrag.live?.action === "pause" && Number.isFinite(eintrag.live?.frameTime)
    && Math.abs(eintrag.live.frameTime - ziel) < .25 ? eintrag.live.frameTime : undefined;
  // Media3 adressiert Millisekunden. Dieselbe gemeinsame Zahl verhindert,
  // dass nur Android einen Bruchteil auf ein benachbartes Bild rundet.
  ziel = frameTime ?? Math.round(ziel * 1000) / 1000;
  clearTimeout(eintrag.syncTimer);
  // Nur wer diese Folge gerade wirklich im Player hat, kann sie fuer den
  // Start vorbereiten. Ein verbundenes Handy im Menue oder auf einer anderen
  // Folge darf die Runde nicht fuenf Sekunden lang blockieren. Der Ausloeser
  // selbst zaehlt immer mit: sein Play ist der frische Beleg dafuer, dass sein
  // Player diese Folge hat, auch wenn sein naechster Herzschlag noch unterwegs
  // ist.
  const aktiveIds = optionen.mitgliedIds instanceof Set
    ? new Set(optionen.mitgliedIds)
    : optionen.erwarteteIds instanceof Set
      ? new Set(optionen.erwarteteIds)
      : optionen.alleVerbunden
      ? new Set(eintrag.members.keys())
      : new Set(
        aktiveTeilnehmer(raumcode, eintrag, eintrag.season, eintrag.episode)
          .map((teilnehmer) => teilnehmer.geraetId)
      );
  aktiveIds.add(userId);
  const mitglieder = offeneSyncTeilnehmer(raumcode, eintrag)
    .filter((client) => aktiveIds.has(client.geraetId));
  const syncId = `sync-${naechsteNummer(eintrag)}`;
  eintrag.startAt = 0;
  eintrag.live = { action: "pause", position: ziel, frameTime, url: eintrag.live?.url || eintrag.url, at: Date.now() };
  eintrag.pauseAusgerichtet = true;
  eintrag.letzteAktion = {
    type: optionen.aktion || "play", userId, name: von, timestamp: Date.now()
  };
  if (optionen.mitgliedIds instanceof Set) {
    for (const geraetId of aktiveIds) {
      if (!eintrag.members.has(geraetId)) continue;
      standSetzen(eintrag, geraetId, eintrag.members.get(geraetId), { position: ziel, paused: true });
    }
  } else {
    standFuerAlle(eintrag, ziel, true);
  }

  const jetzt = Date.now();
  const daten = JSON.stringify({
    type: "syncprepare",
    key: eintrag.key,
    syncId,
    position: ziel,
    frameTime,
    url: eintrag.live.url,
    from: von,
    at: jetzt,
    videoTime: ziel,
    timestamp: jetzt,
    playing: false,
    reason: optionen.grund || undefined,
    tempo: eintrag.tempo || 1,
    sequenceId: naechsteNummer(eintrag),
    episodeId: folgenKennung(eintrag.season, eintrag.episode),
    hostId: aktuelleHostId(raumcode, eintrag)
  });
  eintrag.sync = {
    id: syncId,
    ziel,
    frameTime,
    vorbereitung: daten,
    wartetAuf: new Set(mitglieder.map((client) => client.geraetId)),
    // Wer zu dieser Schranke gehoert, steht mit ihrer Entstehung fest. Ein
    // Wiederanschluss setzt sie fort; ein Geraet, das erst jetzt hereinkommt,
    // laesst sie nicht von vorn warten.
    erwartet: new Set(mitglieder.map((client) => client.geraetId)),
    mitgliedIds: optionen.mitgliedIds instanceof Set ? new Set(aktiveIds) : null
  };
  for (const client of mitglieder) client.send(daten);
  standSenden(raumcode, eintrag);
  zustandSenden(raumcode);

  // Ein Verbindungsabbruch waehrend des Pufferns ist kein Grund, die uebrigen
  // unvorbereitet loszuschicken. Der naechste Play startet einen frischen Lauf.
  eintrag.syncTimer = setTimeout(() => {
    if (!eintrag.sync || eintrag.sync.id !== syncId) return;
    eintrag.sync = null;
    eintrag.syncTimer = null;
    const jetzt = Date.now();
    const pause = JSON.stringify({ type: "control", key: eintrag.key,
      action: "pause", position: ziel, videoTime: ziel, playing: false,
      frameTime,
      url: eintrag.live?.url || eintrag.url, at: jetzt, timestamp: jetzt,
      sequenceId: naechsteNummer(eintrag), syncId,
      episodeId: folgenKennung(eintrag.season, eintrag.episode),
      hostId: aktuelleHostId(raumcode, eintrag), reason: "sync-timeout" });
    for (const client of offeneSyncTeilnehmer(raumcode, eintrag)) {
      if (optionen.mitgliedIds instanceof Set && !aktiveIds.has(client.geraetId)) continue;
      // Clear pending start controls too, including clients that reconnected
      // while this generation was seeking or loading.
      client.send(pause);
      client.send(JSON.stringify({ type: "syncfailed", key: eintrag.key, syncId }));
    }
  }, optionen.fristMs || SYNC_BEREIT_FRIST_MS);
  eintrag.syncTimer.unref?.();
}

// Alle zusammen anlaufen lassen, nachdem jedes Geraet seine Bereitmeldung
// abgegeben hat.
function syncStarten(raumcode, eintrag) {
  if (!eintrag?.sync) return;
  const syncId = eintrag.sync.id;
  const ziel = eintrag.sync.ziel;
  const frameTime = eintrag.sync.frameTime;
  const mitgliedIds = eintrag.sync.mitgliedIds;
  clearTimeout(eintrag.syncTimer);
  eintrag.sync = null;
  // Nach dem letzten "bereit" braucht jeder noch denselben kurzen Vorlauf,
  // damit der letzte Empfaenger nicht erst beim Eintreffen von syncstart
  // losfaehrt. Der Zeitpunkt ist Serverzeit und wird vom Player ueber den
  // gemessenen Uhrversatz in seine lokale Wartezeit umgesetzt.
  const jetzt = Date.now();
  const startAt = jetzt + START_VORLAUF_MS;
  eintrag.startAt = startAt;
  eintrag.live = { action: "play", position: ziel, url: eintrag.live?.url || eintrag.url, at: startAt };
  eintrag.pauseAusgerichtet = false;

  // Auch hier gilt die eine Regel: die Nachricht ist unterschiedlich lange
  // unterwegs, und wer spaeter einsteigt, muss weiter vorn einsteigen. Sonst
  // waeren nach dem gemeinsamen Start genau die Millisekunden Unterschied
  // drin, die dieses Verfahren beseitigen soll.
  const daten = JSON.stringify({
    type: "syncstart",
    key: eintrag.key,
    syncId,
    position: ziel,
    frameTime,
    url: eintrag.live?.url || eintrag.url,
    at: jetzt,
    videoTime: ziel,
    timestamp: jetzt,
    playing: true,
    startAt,
    tempo: eintrag.tempo || 1,
    sequenceId: naechsteNummer(eintrag),
    episodeId: folgenKennung(eintrag.season, eintrag.episode),
    hostId: aktuelleHostId(raumcode, eintrag)
  });
  for (const client of wss.clients) {
    if (client.raum !== raumcode || client.readyState !== client.OPEN) continue;
    if (!eintrag.members.has(client.geraetId)) continue;
    if (mitgliedIds instanceof Set && !mitgliedIds.has(client.geraetId)) continue;
    client.send(daten);
  }
  if (mitgliedIds instanceof Set) {
    for (const geraetId of mitgliedIds) {
      if (!eintrag.members.has(geraetId)) continue;
      standSetzen(eintrag, geraetId, eintrag.members.get(geraetId), { position: ziel, paused: false });
    }
  } else {
    standFuerAlle(eintrag, ziel, false);
  }
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
    // JSON kann ebenso gut null, eine Zahl oder eine Liste enthalten. Erst ab
    // hier darf irgendein Modul Eigenschaften der Nachricht lesen.
    if (!nachrichtIstObjekt(nachricht)) return;

    // Jedes weitere Feld kommt aus dem Netz. Die einzelnen Reiniger lehnen
    // bereits Nicht-Skalare ab; diese Grenze verhindert zusaetzlich, dass ein
    // Fehler in einem angebundenen Protokollmodul den Relay-Prozess beendet.
    try {

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
    if (nachricht.type.startsWith("fn")) {
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
    if (nachricht.type.startsWith("gr")) {
      if (nachricht.type === "grhello") {
        if (!geraete.istKennung(nachricht.room)) {
          senden({ type: "grerror", message: "Ungueltiger Schluessel" });
          return;
        }
        const geraetId = String(nachricht?.device?.id || "");
        if (geraetId) {
          // Dieselbe servergebundene HMAC-Identitaet wie die Watchparty. Der
          // geheime Wurzelwert erscheint weder in der Nachricht noch im
          // Roster; der gespeicherte Fingerabdruck bindet genau diese ID.
          const identitaet = identitaetFuer({ ...nachricht, deviceId: geraetId });
          if (!identitaet || identitaet.geraetId !== geraetId) {
            senden({ type: "grerror", message: "Sicherer Gerätenachweis fehlt oder gehört zu einer anderen Kennung" });
            return;
          }
        }
        if (socket.syncGeraetId && geraetId && socket.syncGeraetId !== geraetId) {
          senden({ type: "grerror", message: "Geraetkennung kann in einer Verbindung nicht wechseln" });
          return;
        }
        if (geraetId) socket.syncGeraetId = geraetId;
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

    if (nachricht.type === "join") {
      if (!istGueltigerCode(nachricht.room)) {
        senden({ type: "error", message: "Ungueltiger Raumcode" });
        return;
      }
      const identitaet = identitaetFuer(nachricht);
      if (!identitaet) {
        senden({
          type: "error",
          code: "identity-required",
          message: "Sicherer Gerätenachweis fehlt; ELFIX oder Relay aktualisieren"
        });
        return;
      }
      socket.raum = codeNormalisieren(nachricht.room);
      socket.name = text(nachricht.name, 40) || "Gerät";
      socket.geraetId = identitaet.geraetId;
      // Das Konto - alle Geraete einer Person unter einer Kennung.
      //
      // Es ist nicht die Kennung des Geraeteabgleichs, sondern ein HMAC
      // darueber: das Relay kann damit zwei Sockets als "dieselbe Person"
      // erkennen, aber nicht auf den Abgleichsraum derselben Person schliessen.
      // Wer den Abgleich nicht benutzt, schickt nichts - dann bleibt alles wie
      // bisher, und es entscheidet allein das Geraet.
      socket.konto = identitaet.konto || "";
      const raum = raumHolen(socket.raum);
      namenNachziehen(raum, socket.geraetId, socket.name);
      for (const eintrag of raum.titel.values()) {
        if (!eintrag.members.has(socket.geraetId)) continue;
        if (!(eintrag.spoilerWartet instanceof Set)) eintrag.spoilerWartet = new Set();
        eintrag.spoilerWartet.add(socket.geraetId);
      }
      zustandSenden(socket.raum);
      warteschlangeAnSocket(socket, "join");
      for (const eintrag of raum.titel.values()) {
        if (eintrag.members.has(socket.geraetId)) spoilerStandSenden(socket.raum, eintrag);
      }
      // War dieses Geraet schon eingetreten, setzt ein Wiederanschluss genau
      // die laufende Vorbereitung fort. Die Mitgliedschaft stammt aus dem
      // Relayzustand, nicht aus einer Behauptung des neuen Sockets.
      for (const eintrag of raum.titel.values()) {
        syncTeilnehmerNachtragen(socket.raum, eintrag, socket);
      }
      return;
    }

    if (!socket.raum) return;

    // Die YouTube-Watchparty. Sie kommt vor allem anderen und geht komplett an
    // ihr eigenes Modul: eigener Zustand, eigene Ordnung, eigene Nachrichten.
    // Unterhalb dieser Zeile aendert sich fuer Serien und Filme nichts - was
    // hier abgefangen wird, hat die Titelverwaltung noch nie gesehen.
    if (nachricht.type.startsWith("yt")) {
      youtubeParty.behandeln({
        nachricht,
        raumcode: socket.raum,
        geraetId: socket.geraetId,
        name: socket.name,
        konto: socket.konto,
        senden,
        sendenAn: (id, antwort) => anMitgliederSenden(socket.raum, antwort, new Set([id])),
        speichern: zustandSpeichernSpaeter,
        verteilen: (antwort, ids) => anMitgliederSenden(socket.raum, antwort, ids)
      });
      return;
    }

    const raum = raumHolen(socket.raum);

    if (nachricht.type === "queue:propose") {
      const ergebnis = raum.warteschlange.vorschlagen(nachricht.item, akteurFuer(socket));
      if (!ergebnis.ok) warteschlangeAnSocket(socket, ergebnis.reason);
      else if (ergebnis.unchanged) warteschlangeAnSocket(socket);
      return;
    }

    if (nachricht.type === "queue:vote") {
      // `value` traegt jetzt das Gewicht (3, 2 oder 1) oder `false`. Ein
      // schlichtes `true` bleibt gueltig und bedeutet die leichteste freie
      // Stimme - so sprechen aeltere Clients weiter mit.
      const stimme = nachricht.value === false ? false
        : (Number(nachricht.value) || true);
      const ergebnis = raum.warteschlange.abstimmen(nachricht.id, stimme, akteurFuer(socket));
      if (!ergebnis.ok) warteschlangeAnSocket(socket, ergebnis.reason);
      else if (ergebnis.unchanged) warteschlangeAnSocket(socket);
      return;
    }

    if (nachricht.type === "queue:spin") {
      const ergebnis = raum.warteschlange.auslosen(akteurFuer(socket),
        { schnell: nachricht.fast === true });
      if (!ergebnis.ok) warteschlangeAnSocket(socket, ergebnis.reason);
      return;
    }

    if (nachricht.type === "queue:remove") {
      const ergebnis = raum.warteschlange.entfernen(nachricht.id, akteurFuer(socket));
      if (!ergebnis.ok) warteschlangeAnSocket(socket, ergebnis.reason);
      return;
    }

    if (nachricht.type === "queue:advance") {
      const fromKey = text(nachricht.fromKey, 300);
      const quelle = fromKey ? raum.titel.get(fromKey) : null;
      if (fromKey && (!quelle || !quelle.members.has(socket.geraetId))) {
        warteschlangeAnSocket(socket, "not-joined-source");
        return;
      }
      const ziele = new Set();
      if (quelle) {
        const jetzt = Date.now();
        for (const client of wss.clients) {
          const stand = quelle.stand?.get(client.geraetId);
          if (client.raum === socket.raum && client.readyState === client.OPEN
            && quelle.members.has(client.geraetId) && stand
            && jetzt - (stand.at || 0) <= STAND_FRISCH_MS) ziele.add(client.geraetId);
        }
      }
      // Ein ausdruecklicher Start aus einer ruhenden Runde ist erlaubt. Er
      // betrifft nur den Ausloeser und zieht keinen bloss verbundenen Browser mit.
      ziele.add(socket.geraetId);
      const ergebnis = raum.warteschlange.starten(nachricht.expectedId, { fromKey }, ziele, akteurFuer(socket));
      if (!ergebnis.ok) warteschlangeAnSocket(socket, ergebnis.reason);
      return;
    }

    if (nachricht.type === "queue:started") {
      const ergebnis = raum.warteschlange.gestartet(nachricht.startId, nachricht.ok !== false, socket.geraetId);
      if (!ergebnis.ok) warteschlangeAnSocket(socket, ergebnis.reason);
      return;
    }

    if (nachricht.type === "spoilerstate") {
      const eintrag = raum.titel.get(text(nachricht.key, 300));
      if (!eintrag || !eintrag.members.has(socket.geraetId)) return;
      if (!(eintrag.spoiler instanceof Map)) eintrag.spoiler = new Map();
      if (nachricht.completed === null) eintrag.spoiler.delete(socket.geraetId);
      else {
        const folgen = spoilerFolgenSaeubern(nachricht.completed);
        eintrag.spoiler.set(socket.geraetId, new Set(folgen.map(([s, e]) => `${s}:${e}`)));
      }
      spoilerStandSenden(socket.raum, eintrag);
      return;
    }

    // Eine Serie in den Raum stellen. Wer sie einstellt, ist automatisch dabei.
    if (nachricht.type === "share") {
      const eintrag = titelSaeubern(nachricht.item);
      if (!eintrag) return;
      if (raum.titel.size >= MAX_TITEL_JE_RAUM && !raum.titel.has(eintrag.key)) return;

      // Nachgetragen wird nur, was niemand herausgenommen hat.
      //
      // Ein Geraet traegt beim Verbinden nach, was es selbst eingestellt hatte
      // und im Raum vermisst - das ist richtig nach einem Serverneustart und
      // falsch nach einem Entfernen. Es kann den Unterschied nicht kennen,
      // also sagt es dazu, dass es nur nachtraegt; hier liegt das Wissen.
      //
      // Ein ausdrueckliches Einstellen dagegen hebt den Grabstein auf: wer
      // einen Titel bewusst wieder in die Runde stellt, meint genau das.
      if (raum.graeber?.has(eintrag.key)) {
        if (nachricht.restore) return;
        raum.graeber.delete(eintrag.key);
      }

      const bekannt = raum.titel.get(eintrag.key);
      const gespeichert = bekannt || {
        ...eintrag,
        addedBy: socket.name,
        addedById: socket.geraetId,
        addedByKonto: socket.konto || "",
        addedAt: new Date().toISOString(),
        members: new Map(),
        spoiler: new Map(),
        spoilerWartet: new Set(),
        archived: false,
        progress: null
      };
      if (bekannt) Object.assign(gespeichert, eintrag);
      // Dieselbe Trennung wie beim Grabstein, eine Zeile darueber: ein
      // Nachtrag laesst einen archivierten Titel archiviert - sonst holte ihn
      // jedes Geraet, das sich verbindet, ungefragt zurueck in die Runde. Wer
      // ihn dagegen von Hand wieder einstellt, meint genau das.
      if (!nachricht.restore) gespeichert.archived = false;
      // Ein Titel, der ohne Konto eingestellt wurde, bekommt es nach, sobald
      // sein Einsteller mit Konto wiederkommt - sonst haetten die anderen
      // Geraete derselben Person nie Zugriff darauf.
      if (!gespeichert.addedByKonto && socket.konto && gespeichert.addedById === socket.geraetId) {
        gespeichert.addedByKonto = socket.konto;
      }
      gespeichert.members.set(socket.geraetId, socket.name);
      vorgaengerAufraeumen(socket.raum, gespeichert, socket);
      if (!(gespeichert.spoilerWartet instanceof Set)) gespeichert.spoilerWartet = new Set();
      gespeichert.spoilerWartet.add(socket.geraetId);
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
        vorgaengerAufraeumen(socket.raum, eintrag, socket);
        if (!(eintrag.spoilerWartet instanceof Set)) eintrag.spoilerWartet = new Set();
        eintrag.spoilerWartet.add(socket.geraetId);
        syncTeilnehmerNachtragen(socket.raum, eintrag, socket);
      } else {
        eintrag.members.delete(socket.geraetId);
        eintrag.spoiler?.delete(socket.geraetId);
        eintrag.spoilerWartet?.delete(socket.geraetId);
        syncTeilnehmerEntfernen(socket.raum, eintrag, socket.geraetId);
        // Der Stand geht mit: wer draussen ist, zaehlt nicht mehr als aktiv
        // und kann damit auch nicht mehr Host sein.
        eintrag.stand?.delete(socket.geraetId);
        hostFreigeben(eintrag, socket.geraetId);
      }
      zustandSenden(socket.raum);
      standSenden(socket.raum, eintrag);
      spoilerStandSenden(socket.raum, eintrag);
      return;
    }

    // Einzelne Mitglieder entfernen darf, wer die Serie eingestellt hat.
    if (nachricht.type === "kick") {
      const eintrag = raum.titel.get(text(nachricht.key, 300));
      const wen = text(nachricht.memberId, 64);
      if (!eintrag || !istEinsteller(eintrag, socket) || !wen) return;
      if (wen === socket.geraetId) return;
      if (!eintrag.members.delete(wen)) return;
      eintrag.spoiler?.delete(wen);
      eintrag.spoilerWartet?.delete(wen);
      syncTeilnehmerEntfernen(socket.raum, eintrag, wen);
      eintrag.stand?.delete(wen);
      hostFreigeben(eintrag, wen);
      zustandSenden(socket.raum);
      standSenden(socket.raum, eintrag);
      spoilerStandSenden(socket.raum, eintrag);
      return;
    }

    // Live-Steuerung: Pause, Weiter, Springen und Folgenwechsel gehen sofort an
    // die anderen Beigetretenen. Wer als Erster spielt, gibt den Takt vor - er
    // ist der Host, an dem sich "Synchronisieren" orientiert.
    if (nachricht.type === "control") {
      const eintrag = raum.titel.get(text(nachricht.key, 300));
      if (!eintrag || !eintrag.members.has(socket.geraetId)) return;
      const aktion = text(nachricht.action, 10);
      if (!["play", "pause", "seek", "skip", "navigate", "tempo", "fassung"].includes(aktion)) return;

      const ziel = httpAdresse(nachricht.url);
      const istHost = socket.geraetId === aktuelleHostId(socket.raum, eintrag);
      const eigen = zahl(nachricht.position, 100000);
      const offeneStartverabredungAbbrechen = (pauseSenden = false) => {
        if (!eintrag.sync) return;
        const offene = eintrag.sync;
        clearTimeout(eintrag.syncTimer);
        eintrag.sync = null;
        eintrag.syncTimer = null;
        if (!pauseSenden) return;

        // Ein Fassungswechsel laedt die Quelle neu und macht jede bereits
        // gemeldete Bereitschaft wertlos. Die normale Pause ist zugleich die
        // sichtbare Absage an die Clients: sie widerruft alte Start-Timer und
        // entfernt deren wartenden Play-Zustand. Nur den Relay-Timer zu loeschen
        // liesse alle auf ein syncstart warten, das nie mehr kommen kann.
        const jetzt = Date.now();
        const pause = JSON.stringify({
          type: "control", key: eintrag.key, action: "pause",
          position: offene.ziel, videoTime: offene.ziel, playing: false,
          frameTime: offene.frameTime,
          url: eintrag.live?.url || eintrag.url, at: jetzt, timestamp: jetzt,
          sequenceId: naechsteNummer(eintrag), syncId: offene.id,
          episodeId: folgenKennung(eintrag.season, eintrag.episode),
          hostId: aktuelleHostId(socket.raum, eintrag), reason: "fassung"
        });
        eintrag.startAt = 0;
        for (const client of wss.clients) {
          if (client.raum !== socket.raum || client.readyState !== client.OPEN) continue;
          if (!eintrag.members.has(client.geraetId)) continue;
          client.send(pause);
        }
      };
      let neueFolge = false;
      // Ob ein "navigate" nur nachzieht, was ohnehin schon laeuft. Steht hier
      // oben, weil die Leiste weiter unten dieselbe Antwort braucht.
      let nurNachgezogen = false;

      // Spulen bewegt die Runde - und das darf nur der Host.
      //
      // Vorher ging jedes "seek" an alle hinaus, gleich von wem. Der Stand der
      // Runde (eintrag.live) aenderte sich dabei aber nur beim Host. Ein
      // Nicht-Host riss die anderen also auf seine Stelle, und der naechste
      // Ausgleich zog sie gleich wieder zum Host zurueck - der gemeldete
      // Doppelsprung. Besonders beim Beitreten, wo der Neue sich erst
      // zurechtruckelt.
      //
      // Sein Player darf selbstverstaendlich spulen, wohin er will; das ist
      // seine Sache und bleibt bei ihm. Nur ein Befehl an die anderen wird
      // daraus nicht mehr. Wo er steht, erfahren sie ohnehin - mit seinem
      // naechsten Herzschlag, eine Sekunde spaeter.
      //
      // Hier und nicht im Client: die Regel muss dort stehen, wo sie niemand
      // umgehen kann, und sie gilt damit fuer Desktop, Android und Fernseher
      // gleichermassen, ohne dass drei Stellen sie einzeln kennen muessen.
      if (aktion === "seek" && !istHost) return;

      // Tempo und Fassung stellt der Host - fuer alle.
      //
      // Sie sind keine Stellen, sondern Einstellungen der Runde: sie halten
      // nichts an und springen nirgendwohin. Deshalb laufen sie hier an der
      // ganzen Stellenrechnung vorbei und gehen gleich hinaus. Und deshalb
      // steht die Host-Regel hier oben und nicht im Client - wo sie stuende,
      // muessten Rechner, Telefon und Fernseher sie einzeln kennen.
      if (aktion === "tempo" || aktion === "fassung") {
        if (!istHost) return;
        if (aktion === "tempo") eintrag.tempo = tempoStufe(nachricht.tempo);
        else {
          eintrag.fassung = text(nachricht.fassung, 80);
          eintrag.hoster = text(nachricht.hoster, 80);
          offeneStartverabredungAbbrechen(true);
        }
        const rundenDaten = JSON.stringify({
          type: "control",
          key: eintrag.key,
          action: aktion,
          position: eigen,
          url: ziel || eintrag.live?.url || eintrag.url,
          from: socket.name,
          host: true,
          at: Date.now(),
          tempo: eintrag.tempo || 1,
          fassung: eintrag.fassung || "",
          hoster: eintrag.hoster || "",
          sequenceId: naechsteNummer(eintrag),
          episodeId: folgenKennung(eintrag.season, eintrag.episode),
          hostId: socket.geraetId
        });
        for (const client of wss.clients) {
          if (client.raum !== socket.raum || client.readyState !== client.OPEN) continue;
          if (!eintrag.members.has(client.geraetId) || client === socket) continue;
          client.send(rundenDaten);
        }
        // In die Karten, damit ein Beitretender es ohne Nachfrage sieht.
        zustandSenden(socket.raum);
        return;
      }

      // Ein Steuerbefehl gilt nur unter denen, die dieselbe Folge offen haben.
      // Der Folgenwechsel ist die Ausnahme - der muss gerade die erreichen,
      // die noch bei der alten Folge stehen.
      const absenderStand = eintrag.stand?.get(socket.geraetId);
      const absenderFolge = absenderStand?.episode || 0;
      const absenderStaffel = absenderStand?.season || 0;
      const nurGleicheFolge = aktion !== "navigate" && absenderFolge > 0;
      // Und nur wer bei der Folge der Runde steht, bewegt deren Zustand.
      // Sonst haette eine Pause aus einer anderen Folge die ganze Runde
      // formal angehalten, obwohl hier weiterlief.
      const amRaumstand = !absenderFolge || !eintrag.episode || (
        absenderFolge === eintrag.episode
        && (!absenderStaffel || !eintrag.season || absenderStaffel === eintrag.season)
      );

      // Nur ein Befehl fuer die laufende Folge ersetzt deren offene
      // Startverabredung. Ein Geraet, das bewusst eine andere Folge schaut,
      // darf dort steuern, ohne die vorbereiteten Player der Runde zu stranden.
      if (aktion !== "navigate" && amRaumstand) offeneStartverabredungAbbrechen();

      // Neue Folge: der alte Stand gilt nicht mehr. Bliebe er stehen, zoege
      // der naechste Abgleich alle auf eine Stelle aus der Folge davor.
      if (aktion === "navigate") {
        // Wer dem Wechsel nur nachzieht, meldet dieselbe Adresse zurueck. Das
        // ist keine neue Folge - sonst faellt der Stand bei jedem Nachzuegler
        // wieder auf null und die Runde faengt dreimal von vorn an.
        //
        // Verglichen wird dabei nicht mehr die Zeichenkette allein. Sie taugt
        // dafuer nicht: `httpAdresse` normalisiert nichts, und derselbe Titel
        // steht je nach Geraet unter `http://186.2.175.5/serie/...` oder
        // `https://s.to/serie/...`. Ein Handy, das der laufenden Folge nur
        // beitrat, meldete damit einen "Wechsel" auf die Folge, bei der die
        // Runde laengst stand - und setzte sie dabei auf null. Genau der
        // gemeldete Rueckwurf. Massgeblich ist die Folge, nicht die Schreibung
        // der Adresse.
        const zielFolge = folgeAusAdresse(ziel);
        const liveFolge = folgeAusAdresse(eintrag.live?.url);
        // Der gebuchte Fortschritt kann der laufenden Quelle voraus sein. Dann
        // stimmt zwar `eintrag.episode` schon mit dem Ziel ueberein, die Live-
        // Adresse zeigt aber noch die vorige Folge. Das ist kein Nachziehen,
        // sondern ein echter Wechsel mit neuer Startschranke.
        const schonDort = Boolean(ziel) && (
          eintrag.live?.url === ziel
          || (zielFolge.episode
            && zielFolge.episode === eintrag.episode
            && (zielFolge.season || 0) === (eintrag.season || 0)
            && (!liveFolge.episode || (liveFolge.episode === zielFolge.episode
              && (liveFolge.season || 0) === (zielFolge.season || 0))))
        );
        if (ziel) {
          eintrag.url = ziel;
          // Auch die Folgenangabe: sie steckt in der Adresse, wurde hier aber
          // nie ausgelesen - nur der Fortschritt hat sie je nachgezogen.
          const folge = folgeAusAdresse(ziel);
          const staffelGeaendert = folge.season > 0
            && folge.season !== (eintrag.season || 0);
          const folgeGeaendert = folge.episode && folge.episode !== eintrag.episode;
          if (folge.episode && (staffelGeaendert || folgeGeaendert)) {
            eintrag.season = folge.season || eintrag.season;
            eintrag.episode = folge.episode;
            fortschrittAufFolge(eintrag, 0, socket.name);
            eintrag.letzteAktion = null;
            neueFolge = true;
          }
        }
        nurNachgezogen = schonDort;
        // Ein Geraet kann genau den Wechsel verpasst haben, der den Raum schon
        // auf diese Adresse stellte: nach Reconnect oder einem abgebrochenen
        // Laden schickt es beim eigenen Weiter dieselbe Zieladresse. Ihm gar
        // nichts zu antworten liess seinen Aufrufer auf der alten Folge stehen.
        // Die bereits laufende Runde wird nicht neu angehalten. Der einzelne
        // Nachzuegler bekommt ihren aktuellen Zustand als verpassten Start und
        // laedt/puffert ihn lokal, bevor der normale Abgleich nachfasst.
        const eigenerStand = eintrag.stand?.get(socket.geraetId);
        const eigenerStandIstZiel = Boolean(eigenerStand?.episode) && (
          Number(eigenerStand.episode) === Number(eintrag.episode)
          && (!eigenerStand.season || !eintrag.season
            || Number(eigenerStand.season) === Number(eintrag.season))
        );
        if (schonDort && !eigenerStandIstZiel) {
          // Gehoert er zur vorhandenen Generation, bekommt er nur deren
          // Vorbereitung erneut - auch wenn seine Bereitmeldung schon beim
          // Relay ankam, sein eigener alter Herzschlag aber noch unterwegs
          // ist. Die Menge der Bereiten bleibt dabei unveraendert; ein neues
          // sender-only syncstart duerfte diese echte Schranke nicht vorzeitig
          // ueberholen.
          if (eintrag.sync?.vorbereitung && eintrag.sync.erwartet?.has(socket.geraetId)) {
            socket.send(eintrag.sync.vorbereitung);
            return;
          }
          const host = aktuellerHost(socket.raum, eintrag);
          const hostIstZiel = host && Number(host.episode) === Number(eintrag.episode)
            && (!host.season || !eintrag.season || Number(host.season) === Number(eintrag.season));
          const stand = hostIstZiel ? hostZustandJetzt(socket.raum, eintrag) : null;
          const jetzt = Date.now();
          const playing = Boolean(stand?.laeuft);
          // Das ist kein neuer gemeinsamer Start, sondern ein Nachreichen an
          // einen einzelnen spaeten Player. Mit `startAt` wuerde `videoTime`
          // erst an dieser Linie gelten und der aktuelle Laufzustand um den
          // Vorlauf hinterherhinken; Zeitstempel plus playing rechnen ihn beim
          // Empfaenger korrekt bis zum tatsaechlichen Laden weiter.
          const startAt = 0;
          socket.send(JSON.stringify({
            type: "syncstart",
            key: eintrag.key,
            syncId: `catchup-${naechsteNummer(eintrag)}`,
            position: stand?.position ?? 0,
            videoTime: stand?.position ?? 0,
            frameTime: !playing && Number.isFinite(host?.frameTime) ? host.frameTime : undefined,
            url: eintrag.live?.url || eintrag.url,
            from: "Runde",
            at: jetzt,
            timestamp: jetzt,
            playing,
            startAt,
            tempo: eintrag.tempo || 1,
            sequenceId: naechsteNummer(eintrag),
            episodeId: folgenKennung(eintrag.season, eintrag.episode),
            hostId: eintrag.hostId || "",
            reason: "episode-catchup"
          }));
          return;
        }
        if (!schonDort) {
          offeneStartverabredungAbbrechen();
          // Nicht "pause": eine neue Folge ist noch gar nichts: weder angehalten
          // noch laufend. Stand hier "pause", bekam jedes Geraet, das die neue
          // Folge oeffnet und den Stand abfragt, prompt eine Pause zurueck - die
          // Folge startete, lud und blieb dann stehen. Jetzt laeuft der Autostart
          // durch, und das erste echte Play gibt den Takt vor.
          eintrag.live = { action: "navigate", position: 0, url: ziel || eintrag.url, at: Date.now() };
          // Ein Folgenwechsel ist erst fertig, wenn jeder aktuell verbundene
          // Teilnehmer den neuen Player geladen und gepuffert hat. Deshalb
          // geht er als Vorbereitung hinaus; der gemeinsame Start folgt erst
          // nach den bestaetigten Bereitschaften. Abgemeldete/offline
          // Mitglieder kommen nicht in die Wartemenge.
          // Erwartet werden die Geraete, die diesen Titel wirklich im Player
          // haben - nicht jedes verbundene Mitglied. Ein Handy, das der Runde
          // beigetreten ist und im Menue steht, hat nichts vorzubereiten und
          // hielt die uebrigen bisher volle neunzig Sekunden in "Warten auf
          // alle" fest. Der Ausloeser zaehlt in syncVorbereiten ohnehin mit.
          syncVorbereiten(socket.raum, eintrag, 0, socket.name, socket.geraetId, {
            erwarteteIds: spielerImTitel(socket.raum, eintrag),
            aktion: "navigate",
            grund: "episode-change",
            fristMs: FOLGENWECHSEL_BEREIT_FRIST_MS
          });
          return;
        }
      }

      // Die Stelle eines Befehls kommt vom Host - bei *jeder* Aktion.
      //
      // Bis hierher galt das nur fuer die Pause. Play und Sprung eines
      // Nicht-Hosts trugen dagegen seine eigene Stelle, und die ging an alle
      // hinaus. Gemessen am 3.9.2026: ein Zuschauer spulte von Hand auf 0, sein
      // Player meldete daraufhin "play bei 0", und das Relay schickte
      //
      //   control action=play position=0 playing=true from=ViewerA
      //
      // an den Host *und* an den zweiten Zuschauer. Beide sprangen auf 0 und
      // wurden vom naechsten Ausgleich wieder zum Host gezogen - der gemeldete
      // Doppelsprung. Der Sync-Pfad "Zuschauer -> Zuschauer" darf es nicht
      // geben; was ein Nicht-Host druecken darf, ist der *Zustand* (laeuft,
      // haelt an), niemals die Stelle.
      //
      // Der Folgenwechsel ist ausgenommen: eine neue Folge faengt bei null an,
      // und die Stelle des Hosts aus der alten Folge waere dort falsch.
      const hostStand = hostStandJetzt(socket.raum, eintrag);
      // Beim Ueberspringen zaehlt die Stelle dessen, der drueckt: er steht am
      // Ende des Intros. Die des Hosts waere genau die, von der alle weg wollen.
      const stelleVomHost = aktion !== "navigate" && aktion !== "skip"
        && !istHost && hostStand != null;
      const quelle = stelleVomHost ? hostStand : eigen;
      const gemeinsam = aktion === "pause" ? Math.round(quelle * 1000) / 1000 : quelle;

      // Weiterlaufen ist ein Zwei-Phasen-Ablauf: erst halten alle auf der
      // gemeinsamen Stelle und bestaetigen, dass der Sprung gepuffert ist;
      // dann gibt es ein einziges syncstart mit einem zukuenftigen Zeitpunkt.
      // Das gilt auch fuer den Ausloeser. Sein lokaler Vorschlag ist nur eine
      // Bitte und darf keinen Vorsprung vor Android oder dem Desktop bekommen.
      // Das Intro ueberspringen darf jeder - wie den Folgenwechsel. Es laeuft
      // ueber genau dieselbe Startverabredung: alle halten am Ende des Intros,
      // bestaetigen und fahren gemeinsam los. Damit bewegt auch der Sprung
      // eines Gastes den Rundenstand, statt ihn beim naechsten Abgleich wieder
      // einzusammeln - der Grund, aus dem `seek` beim Host bleibt.
      if ((aktion === "play" || aktion === "skip") && amRaumstand) {
        syncVorbereiten(socket.raum, eintrag, gemeinsam, socket.name, socket.geraetId,
          aktion === "skip" ? { aktion: "skip" } : {});
        return;
      }

      // Der zuletzt an alle geschickte Befehl ist der Stand der Runde - egal,
      // von wem er kam. Nur so passt das, woran sich ein Abgleich orientiert,
      // zu dem, was auf den Geraeten wirklich laeuft.
      /*
       * Neue Pause, neue Ausrichtung.
       *
       * Hier stand `if (aktion !== "pause")` - und damit war die Ausrichtung
       * genau einmal moeglich und danach nie wieder, solange niemand etwas
       * anderes als Pause drueckte. Gemessen am 7.9.2026 zwischen Rechner und
       * Telefon an diesem Relay: die Ausrichtung feuerte einmal, verbrauchte
       * das Flag, und die *naechste* Pause richtete nichts mehr aus - Rechner
       * und Telefon standen 46 Millisekunden auseinander, dauerhaft, also auf
       * verschiedenen Bildern.
       *
       * Jede Pause ist eine eigene Pause. Das Flag verhindert nur, dass
       * innerhalb *einer* Pause jeder Herzschlag erneut ausrichtet.
       */
      if (aktion === "navigate" || amRaumstand) eintrag.pauseAusgerichtet = false;

      // Nach einem Sprung darf der Ausgleich sofort greifen: dort laufen die
      // Geraete am ehesten auseinander, weil jeder Hoster anders puffert.
      if (aktion === "seek" && amRaumstand) {
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

      // Eine Pause eines Nicht-Hosts ruecken alle auf die Stelle des Hosts -
      // dafuer muss sie bekannt sein. Ist sie es nicht, stuende hier seine
      // eigene: ein frisch beigetretenes Handy, dessen Player noch laedt,
      // schriebe damit `position: 0` als Stand der Runde und schickte allen
      // ein "pause bei 0". Dann gilt sein Befehl fuer ihn, und der Stand der
      // Runde bleibt, was er war.
      const pauseZaehlt = aktion === "pause" && (istHost || hostStand != null);
      if (aktion !== "navigate" && amRaumstand && (istHost || pauseZaehlt)) {
        eintrag.live = {
          action: aktion,
          position: gemeinsam,
          playing: aktion === "play"
            || (aktion === "seek" && !(eintrag.stand?.get(socket.geraetId)?.paused ?? true)),
          frameTime: typeof nachricht.frameTime === "number"
            && Number.isFinite(nachricht.frameTime) && nachricht.frameTime >= 0
            ? nachricht.frameTime : undefined,
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
      // Der gemeinsame Startzeitpunkt - siehe startZeitpunkt().
      const startAt = startZeitpunkt(laeuftDanach, jetzt, nachricht.startAt);
      // Er wird gemerkt: die Ausrichtung weiter unten muss wissen, dass ein
      // Start laeuft und das "pausiert" des Hosts nur das Warten darauf ist.
      // Ein Anhalten macht jede Startverabredung gegenstandslos.
      if (aktion === "navigate" || amRaumstand) eintrag.startAt = startAt || 0;
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
        // Wann alle gemeinsam losfahren. Null bei allem, was nichts startet -
        // eine Pause hat keinen Zeitpunkt, sie hat eine Stelle.
        startAt,
        // Das Tempo der Runde reist mit jedem Befehl mit: der Empfaenger
        // rechnet die Laufzeit der Nachricht auf die Stelle auf, und bei 2x ist
        // die Quelle in derselben Zeit doppelt so weit (zielZeitBerechnen).
        tempo: eintrag.tempo || 1,
        sequenceId: naechsteNummer(eintrag),
        episodeId: folgenKennung(
          aktion === "navigate" ? eintrag.season : (eintrag.stand?.get(socket.geraetId)?.season || eintrag.season),
          aktion === "navigate" ? eintrag.episode : (absenderFolge || eintrag.episode)
        ),
        hostId: aktuelleHostId(socket.raum, eintrag)
      });
      // Ein Nachzieher bewegt niemanden.
      //
      // Wer meldet, er sei jetzt bei der Folge, bei der die Runde ohnehin
      // steht, hat den anderen nichts zu sagen. Frueher ging der Befehl
      // trotzdem hinaus - mit `position: 0` und mit *seiner* Adresse. Beides
      // schadet: die anderen sprangen an den Anfang, und wer denselben Titel
      // bei einem anderen Anbieter offen hatte, wurde auf dessen Adresse
      // geschickt und lud seinen Player neu.
      for (const client of nurNachgezogen ? [] : wss.clients) {
        if (client.raum !== socket.raum || client.readyState !== client.OPEN) continue;
        if (!eintrag.members.has(client.geraetId)) continue;
        // Pause und Play gehen auch an den Ausloeser zurueck.
        //
        // Bei einer Pause braucht er die autoritative Stelle des Hosts. Beim
        // Play braucht er den vom Relay bestaetigten `startAt`: der Absender
        // kann zwar einen Zeitpunkt vorschlagen, das Relay darf ihn aber
        // korrigieren. Bliebe der Befehl bei ihm aus, startete er nach seinem
        // lokalen Vorschlag, waehrend alle anderen nach dem Serverzeitpunkt
        // losfahren. Damit konnten Rechner und Android trotz desselben Play
        // sichtbar versetzt beginnen.
        //
        // Ein eigener Sprung und ein eigener Folgenwechsel bleiben lokal. Eine
        // Pause dagegen geht immer auch an ihren Ausloeser, einschliesslich
        // des Hosts: alle stellen sich auf dieselbe autoritative Stelle.
        if (client === socket && aktion !== "play" && aktion !== "pause") continue;
        if (nurGleicheFolge) {
          const seinStand = eintrag.stand?.get(client.geraetId);
          const seineFolge = seinStand?.episode || 0;
          const seineStaffel = seinStand?.season || 0;
          if (seineFolge && (seineFolge !== absenderFolge
            || (absenderStaffel && seineStaffel && seineStaffel !== absenderStaffel))) continue;
        }
        client.send(daten);
      }

      // Fuer die Leiste: nach einem Befehl stehen alle Beigetretenen dort.
      //
      // "Dort" gilt aber nur, wenn die Stelle ueberhaupt fuer alle gilt - also
      // vom Host stammt. Sonst wurde hier die Stelle eines einzelnen Geraets
      // in den Anzeigeeintrag *aller* geschrieben, auch in den des Hosts. Ein
      // Zuschauer, dessen Player beim Puffern kurz "pause/play bei 0" meldete,
      // setzte damit die ganze Leiste auf 0:00, bis jedes Geraet eine Sekunde
      // spaeter seinen eigenen Stand wieder meldete. Genau das periodische
      // Springen zwischen richtiger Zeit und null.
      //
      // Ohne autoritative Stelle wandert nur noch der Laufzustand mit; die
      // Stellen bleiben stehen (standSetzen laesst sie bei `null` unberuehrt).
      const stelleFuerAlle = istHost || hostStand != null ? gemeinsam : null;
      // Die Pause bekommt der Ausloeser zurueck und rueckt mit; sein Play
      // nicht - er laeuft ja schon.
      const ohneAusloeser = istHost || aktion === "pause" ? "" : socket.geraetId;
      if (aktion === "pause" && amRaumstand) standFuerAlle(eintrag, stelleFuerAlle, true);
      else if (aktion === "play" && amRaumstand) standFuerAlle(eintrag, stelleFuerAlle, false, ohneAusloeser);
      else if (aktion === "seek" && amRaumstand) standFuerAlle(eintrag, gemeinsam, null);
      // Ein Wechsel faengt bei null an - aber nur ein echter. Wer der
      // laufenden Folge bloss nachzieht, darf die Leiste aller anderen nicht
      // auf null stellen.
      else if (aktion === "navigate" && !nurNachgezogen) standFuerAlle(eintrag, 0, true);
      standSenden(socket.raum, eintrag);

      // Steht die Runde jetzt auf einer anderen Folge, muessen es alle sehen -
      // sonst zeigt die Karte weiter die Folge von vorhin. Und wer gedrueckt
      // hat, gehoert ebenfalls in die Karten.
      if (neueFolge || ["play", "pause", "seek"].includes(aktion)) zustandSenden(socket.raum);
      else zustandSpeichernSpaeter();
      return;
    }

    // Gleichziehen heisst: alle halten an, auf der Stelle des Hosts.
    //
    // Frueher startete der Server sie danach wieder gemeinsam. Das war der
    // Anspruch, aber nicht das, was gebraucht wird: bis der Start kam, hatte
    // jeder anders gepuffert, und die Runde lief prompt wieder auseinander -
    // nur diesmal mit einem Ruck. Angehalten stehen alle exakt gleich, und wer
    // weiterschauen will, drueckt Play. Das ist die Aufgabe des Knopfes.
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
      // Kein offener Gleichzieh-Vorgang mehr: es wird nichts nachgestartet,
      // also wartet auch niemand auf eine Bereitmeldung. Ein stehengebliebenes
      // `sync` haette ausserdem die Driftmessung dauerhaft abgeschaltet.
      eintrag.sync = null;
      clearTimeout(eintrag.syncTimer);
      eintrag.syncTimer = null;

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

      // Und der Stand der Runde ist jetzt "angehalten bei dieser Stelle".
      // Ohne das haette der naechste Abgleich den Stehenden ihr Play
      // nachgereicht - der Knopf haette dann angehalten und sofort wieder
      // gestartet.
      eintrag.live = { action: "pause", position: ziel, url, at: Date.now() };
      eintrag.pauseAusgerichtet = true;
      eintrag.letzteAktion = {
        type: "pause",
        userId: socket.geraetId,
        name: socket.name,
        timestamp: Date.now()
      };
      standFuerAlle(eintrag, ziel, true);
      standSenden(socket.raum, eintrag);
      zustandSenden(socket.raum);
      return;
    }

    // Ein Geraet sagt, wo es steht. Kommt im Sekundentakt und traegt die
    // Leiste - unabhaengig davon, ob gerade ein Fortschritt gebucht wurde.
    if (nachricht.type === "here") {
      const eintrag = raum.titel.get(text(nachricht.key, 300));
      if (!eintrag || !eintrag.members.has(socket.geraetId)) return;
      // Ein Geraet hat genau einen aktuell offenen Player. Sobald es Titel B
      // meldet, darf keine Freigabe- oder Unbekannt-Markierung aus Titel A
      // weiter in dessen Spoilerschutz eingehen.
      //
      // Nur die Spoilermarkierungen. Der Playerstand eines anderen Titels
      // wird hier ausdruecklich nicht geloescht: er hat seine eigene Frist
      // (STAND_FRISCH_MS) und mit ihr die Gnadenfrist der Hostrolle. Wurde
      // er sofort weggeraeumt, verlor ein Geraet, das zwei Titel derselben
      // Runde meldet, in beiden abwechselnd seinen Stand - und mit ihm die
      // Stelle, an der sich "Abgleichen" ausrichtet.
      let vorherigerTitelWeg = false;
      for (const anderer of raum.titel.values()) {
        if (anderer === eintrag) continue;
        const wartenWeg = Boolean(anderer.spoilerWartet?.delete(socket.geraetId));
        const spoilerWeg = Boolean(anderer.spoiler?.delete(socket.geraetId));
        if (!wartenWeg && !spoilerWeg) continue;
        spoilerStandSenden(socket.raum, anderer);
        vorherigerTitelWeg = true;
      }
      if (vorherigerTitelWeg) zustandSenden(socket.raum);
      eintrag.spoilerWartet?.delete(socket.geraetId);
      const vorher = eintrag.stand?.get(socket.geraetId);
      const pausiert = Boolean(nachricht.paused);
      const folge = zahl(nachricht.episode, 9999);
      const staffel = zahl(nachricht.season, 999);
      const hostVorher = aktuelleHostId(socket.raum, eintrag);

      // Steht dieser Player wirklich bei 0:00 - oder ist er nur noch nicht da?
      //
      // Beides meldet dieselbe Zahl, und 0:00 ist eine voellig gueltige
      // Stelle; ein pauschales "0 ignorieren" waere deshalb falsch. Was die
      // beiden Faelle trennt, ist die Laufzeit: ein geladener Player kennt
      // sie, ein Rahmen, dessen Quelle noch laedt, meldet 0. Kommt also weder
      // Stelle noch Laufzeit, und stand hier schon einmal etwas Gueltiges,
      // bleibt der bisherige Wert stehen - der Balken springt sonst auf null
      // und beim naechsten Takt zurueck.
      //
      // `duration` kam spaeter dazu. Eine Gegenstelle, die sie gar nicht
      // schickt, kann darueber nichts sagen; fuer sie bleibt alles wie bisher.
      // Und: gar keine Angabe ist etwas anderes als "bei null".
      //
      // Eine Anwesenheitsmeldung ("ich bin hier") laesst die Stelle jetzt weg
      // - wo dieses Geraet steht, weiss sein Player und meldet es selbst.
      // `zahl(undefined)` waere 0, und damit stuende in der Leiste wieder eine
      // Null, die niemand behauptet hat.
      const kenntLaufzeit = nachricht.duration !== undefined;
      const ohneAngabe = nachricht.position === undefined || nachricht.position === null;
      const stelle = zahl(nachricht.position, 100000);
      const unfertig = kenntLaufzeit
        && stelle <= 0
        && zahl(nachricht.duration, 100000) <= 0
        && Number(vorher?.position) > 0;
      const wachAuf = standSetzen(eintrag, socket.geraetId, socket.name, {
        position: ohneAngabe || unfertig ? null : stelle,
        paused: pausiert,
        frameTime: typeof nachricht.frameTime === "number" && Number.isFinite(nachricht.frameTime)
          && nachricht.frameTime >= 0 ? Math.min(nachricht.frameTime, 100000) : undefined,
        playbackRate: typeof nachricht.playbackRate === "number" && Number.isFinite(nachricht.playbackRate)
          && nachricht.playbackRate > 0 ? nachricht.playbackRate : undefined,
        buffering: typeof nachricht.buffering === "boolean"
          ? nachricht.buffering
          : (typeof nachricht.puffert === "boolean" ? nachricht.puffert : undefined),
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
      //
      // Und nicht nur die des Hosts: *jeder* Folgenwechsel, den das Relay an
      // einem Geraet wirklich sieht, zieht die Runde nach.
      //
      // Der Grund ist der gemeldete Fall vom 4.9.2026: am Telefon eine Folge
      // weiter, und Rechner und Fernseher ruehrten sich nicht. Der Weg dahin
      // war bis hierher allein `control navigate` - eine einzige Meldung, die
      // das Geraet selbst schicken muss. Schickt es sie nicht (die Bruecke
      // haelt sich fuer einen Nachzieher, die Seite lud noch, die Leitung war
      // gerade weg), erfaehrt die Runde von dem Wechsel nie: sie blieb bei der
      // alten Folge, der Takt zog niemanden, und die Leiste zeigte
      // stundenlang "2 woanders".
      //
      // Der Herzschlag dagegen kommt im Sekundentakt und traegt Folge und
      // Adresse. Was sich darin aendert, ist keine Behauptung, sondern eine
      // Beobachtung - und die ist der verlaesslichere Ausloeser.
      //
      // Drei Faelle bleiben ausdruecklich draussen:
      //
      //   - Wer neu dazukommt, hat kein "vorher" und wirft die Runde damit
      //     nicht auf seine Folge zurueck (joinruecksturztest).
      //   - Wer der Runde gerade folgt, meldet am Ende die Folge, bei der sie
      //     ohnehin steht - dann ist nichts zu tun.
      //   - Und wer ohnehin woanders stand, zieht niemanden: er war nicht
      //     dabei, also bestimmt er auch nicht, wohin es weitergeht. Sonst
      //     riesse ein Geraet, das noch bei Folge 1 haengt, die ganze Runde
      //     von Folge 5 auf Folge 2, sobald dort jemand weiterblaettert.
      //     Weiterziehen darf nur, wer mit der Runde zusammen dastand.
      const staffelGeaendert = Boolean(staffel)
        && staffel !== (vorher?.season || 0);
      const folgeGeaendert = Boolean(folge)
        && folge !== (vorher?.episode || 0);
      const eigenerWechsel = Boolean(vorher && vorher.episode)
        && folge && (staffelGeaendert || folgeGeaendert)
        && (!eintrag.episode || (
          vorher.episode === eintrag.episode
          && (!eintrag.season || !vorher.season || vorher.season === eintrag.season)
        ));
      //   - Und wer gar nicht gewechselt hat, zieht auch niemanden. Das galt
      //     bisher nur fuer die anderen: dem Host genuegte es, dass die Runde
      //     woanders stand als er - ob er selbst etwas getan hatte, wurde nie
      //     gefragt. Damit machte sein Herzschlag jeden fremden Wechsel wieder
      //     rueckgaengig, solange er noch auf der alten Seite sass. Waehrend
      //     einer Startverabredung sitzt er genau dort: er laedt die neue
      //     Folge, er ist Teil der Schranke, und sein Herzschlag traegt im
      //     Sekundentakt weiter die alte. Gemessen an der echten Runde sprang
      //     die Karte auf die neue Folge und zweihundert Millisekunden spaeter
      //     zurueck; der Gast stand allein bei der neuen, und der gemeinsame
      //     Start galt der alten.
      //
      //     Beobachtet wird also ein Wechsel, nicht ein Unterschied. Fuer alle
      //     gleich - der Host fuehrt die Runde, er korrigiert sie nicht.
      const hostWechsel = socket.geraetId === hostVorher
        && Boolean(vorher && vorher.episode)
        && (staffelGeaendert || folgeGeaendert);
      if (folge && (staffelGeaendert || folge !== eintrag.episode)
        && (hostWechsel || eigenerWechsel)) {
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
        console.log(`Folge der Runde: ${socket.name || socket.geraetId} steht bei `
          + `${folgenKennung(eintrag.season, eintrag.episode)} - die Runde zieht nach`);
        zustandSenden(socket.raum);
        // Und die uebrigen gleich mit, statt bis zum naechsten Takt zu warten.
        // Der Takt ist das Netz darunter; das Mitziehen soll sich anfuehlen
        // wie ein Knopfdruck und nicht wie eine Wartezeit.
        nachzueglerHolen();
      }

      // Bei jeder Pause ruecken alle exakt auf die Stelle des Hosts. Sein
      // eigener Player meldet sie beim Anhalten sofort und auf die
      // Millisekunde - genauer als jede Hochrechnung aus der letzten
      // Steuerung. Erst haelt jeder an, damit nichts wegdriftet, dann kommt
      // die genaue Stelle hinterher. Einmal je Pause, nicht bei jedem
      // Herzschlag.
      // Ohne Stelle keine Ausrichtung: eine Anwesenheitsmeldung traegt keine,
      // und `zahl(undefined)` waere 0 - der Host wuerde damit die ganze Runde
      // auf den Anfang ausrichten.
      /*
       * Nicht ausrichten, waehrend ein gemeinsamer Start verabredet ist.
       *
       * Seit dem verabredeten Start bleibt auch der Host nach einem Play noch
       * einen Augenblick stehen - und meldet in diesem Fenster brav
       * "pausiert". Ohne diese Schranke las das Relay darin eine Pause, die es
       * auszurichten gilt, und schickte allen ein `seek playing:false` mitten
       * in den Start hinein. Gemessen: 740 Millisekunden nach dem Play.
       */
      // Eng gefasst: der Host meldet "pausiert" nur *bis* zum verabredeten
      // Augenblick, danach laeuft er. Ein breiteres Fenster wuerde die richtige
      // Ausrichtung nach einer spaeteren Pause mitblockieren - genau das ist im
      // Pruefstand passiert (zweiter Durchgang, 40 ms Abstand).
      const startLaeuft = Number(eintrag.startAt) > 0 && Date.now() < Number(eintrag.startAt) + 250;
      // Ein gezielter Seek kann ebenfalls im Stehen enden. Seine live.action
      // bleibt dann "seek"; der frische Host-Heartbeat muss trotzdem den
      // tatsächlich gerenderten Frame an alle verteilen.
      const pausierterSeek = eintrag.live?.action === "seek"
        && eintrag.live?.playing === false;
      const frameTimeVorhanden = typeof nachricht.frameTime === "number"
        && Number.isFinite(nachricht.frameTime)
        && nachricht.frameTime >= 0
        && Math.abs(nachricht.frameTime - zahl(nachricht.position, 100000)) < .25;
      if (!ohneAngabe && !startLaeuft && socket.geraetId === aktuelleHostId(socket.raum, eintrag) && pausiert
        && (eintrag.live?.action === "pause" || (pausierterSeek && frameTimeVorhanden))
        && !eintrag.pauseAusgerichtet) {
        eintrag.pauseAusgerichtet = true;
        const position = zahl(nachricht.position, 100000);
        const frameTime = typeof nachricht.frameTime === "number" && Number.isFinite(nachricht.frameTime)
          && nachricht.frameTime >= 0 && Math.abs(nachricht.frameTime - position) < .25
          ? nachricht.frameTime : undefined;
        const genau = frameTime ?? Math.round(position * 1000) / 1000;
        eintrag.live.position = genau;
        eintrag.live.frameTime = frameTime;
        eintrag.live.at = Date.now();
        standFuerAlle(eintrag, genau, true);
        const jetzt = Date.now();
        const daten = JSON.stringify({
          type: "control",
          key: eintrag.key,
          action: "seek",
          position: genau,
          frameTime,
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
        // Auch der Host bekommt die nachgereichte exakte Stelle. Sein erstes
        // Pause-Ereignis und die Zeit, zu der die anderen es erhalten, liegen
        // ein paar Millisekunden auseinander; ohne diesen zweiten gemeinsamen
        // Sprung blieb er auf einem benachbarten Bild stehen.
        for (const client of wss.clients) {
          if (client.raum !== socket.raum || client.readyState !== client.OPEN) continue;
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

      // Die Folgenkennung fuer die drei Nachrichten, die gleich *nur an dieses
      // eine Geraet* gehen: Messung, nachgereichtes Play, nachgehaltene Pause.
      //
      // Sie traegt, was das Geraet gerade selbst gemeldet hat, und nicht den
      // Stand der Runde. Der Player drueben vergleicht sie mit der Folge, die
      // bei ihm offen steht - und die ist die Quelle genau dieser Angabe.
      // Nimmt man stattdessen die der Runde, faellt die Nachricht bei jeder
      // Abweichung als "andere Folge" durch, obwohl beide dieselbe Folge
      // meinen: der Raum kennt vielleicht keine Staffel (die Adresse traegt
      // keine), das Geraet aber schon - oder umgekehrt. Dass wirklich dieselbe
      // Folge gemeint ist, entscheidet `gleicheFolge` eine Zeile darueber; die
      // Kennung sagt es dem Player nur in seiner eigenen Schreibweise.
      const kennungFuerIhn = folge
        ? folgenKennung(zahl(nachricht.season, 999), folge)
        : folgenKennung(eintrag.season, eintrag.episode);

      if (hostJetzt && hostJetzt.geraetId !== socket.geraetId
        && !pausiert && !hostJetzt.paused && !eintrag.sync && !startLaeuft
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
            episodeId: kennungFuerIhn,
            hostId: hostJetzt.geraetId
          });
        }
      }

      // Die Runde laeuft, dieses Geraet steht: dann ist sein Play unterwegs
      // verloren gegangen oder es hat nach einem Neuladen nie eines bekommen.
      // Statt es stehen zu lassen, wird ihm der fehlende Befehl nachgereicht -
      // nur ihm, und nur wenn es bei derselben Folge steht.
      // Ob die Runde laeuft, entscheidet der Host und nicht der letzte Befehl.
      //
      // Vorher stand hier `eintrag.live?.action === "play"`. Das ist der zuletzt
      // an alle geschickte Befehl, und der veraltet: eine Pause eines
      // Nicht-Hosts wird dort vermerkt, sein spaeteres Play aber nicht (weiter
      // oben gilt `istHost || aktion === "pause"`). Nach einmal Pause und
      // Weiter durch einen Nicht-Host stand dort also "pause", waehrend alle
      // liefen - und ein Fernseher, der in dieser Lage stand, bekam sein Play
      // nie nachgereicht. Genau der gemeldete Fall.
      //
      // hostZustandJetzt kennt den Unterschied: es nimmt die juengste Meldung,
      // und die des Hosts aus seinem eigenen Player ist frischer als der alte
      // Befehl. Pausiert der Host wirklich, bleibt es beim Stehen.
      const faellig = !zustand.geholt || Date.now() - zustand.geholt > NACHREICHEN_MS;
      if (pausiert && gleicheFolge && faellig && !eintrag.sync && !startLaeuft) {
        const stand = hostZustandJetzt(socket.raum, eintrag);
        if (stand && stand.laeuft) {
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
            episodeId: kennungFuerIhn,
            hostId: aktuelleHostId(socket.raum, eintrag)
          });
        }
      }

      // Und dasselbe andersherum: die Runde steht, dieses Geraet laeuft.
      //
      // Genau das war gemeldet - "am Fernseher spielt es weiter, am Handy und
      // am PC ist pausiert". Fuer diese Richtung gab es bis hierher nichts:
      //
      //   - Die Driftmessung oben verlangt, dass *beide* laufen. Steht der
      //     Host, misst sie nichts.
      //   - Das Nachreichen darunter gilt nur dem, der selbst steht.
      //   - Und `control pause` geht einmal hinaus. Wer ihn verpasst - weil
      //     sein Player gerade neu lud, weil er kurz bei einer anderen Folge
      //     stand, weil die Leitung zuckte -, lief danach fuer immer allein
      //     weiter. Nichts hat ihn je wieder angehalten.
      //
      // Deshalb hier die Gegenrichtung, nach denselben Regeln: nur bei
      // derselben Folge, nur an den Einzelnen, und hoechstens alle paar
      // Sekunden.
      //
      // Massgeblich ist ausschliesslich der Host, wie er sich *selbst* gerade
      // meldet - nicht `eintrag.live`. Der ist der zuletzt an alle geschickte
      // Befehl und veraltet: nach dem Play eines Nicht-Hosts steht dort noch
      // "pause", waehrend laengst alle laufen. Wer danach ginge, hielte die
      // Runde bei jedem Herzschlag wieder an, obwohl gerade jemand Play
      // gedrueckt hat. Der frische Stand des Hosts kann das nicht: druecken
      // die anderen Play, laeuft auch sein Player Sekundenbruchteile spaeter
      // an, und ab da meldet er sich als laufend.
      //
      // Ein frisches Play der Runde ist trotzdem tabu. Drueckt ein Zuschauer
      // Play, laeuft der Player des Hosts nicht in derselben Millisekunde an -
      // er puffert erst, und bis dahin meldet er sich weiter als angehalten.
      // Ohne diese Frist bekaeme genau in dieser Luecke jeder, der schon
      // laeuft, eine Pause hinterher, und das Weiterschauen faenge mit einem
      // Ruck an. Nach ein paar Sekunden zaehlt wieder allein, was der Host
      // wirklich meldet - ein Play, dem kein laufender Player folgt, haelt die
      // Runde nicht dauerhaft offen.
      const frischesPlay = eintrag.letzteAktion?.type === "play"
        && Date.now() - (eintrag.letzteAktion.timestamp || 0) < NACHREICHEN_MS;
      const stoppFaellig = !zustand.gestoppt || Date.now() - zustand.gestoppt > NACHREICHEN_MS;
      if (!pausiert && gleicheFolge && stoppFaellig && !eintrag.sync && !frischesPlay
        && hostJetzt && hostJetzt.geraetId !== socket.geraetId && hostJetzt.paused) {
        zustand.gestoppt = Date.now();
        const jetzt = Date.now();
        console.log(`Nachhalten: ${socket.name || socket.geraetId} laeuft, `
          + `${hostJetzt.name || "der Host"} steht bei ${Math.round(hostJetzt.position)}s`);
        senden({
          type: "control",
          key: eintrag.key,
          action: "pause",
          // Der Host steht - seine Stelle ist exakt und wird nicht
          // hochgerechnet. Genau darauf soll dieses Geraet ruecken.
          position: hostJetzt.position,
          url: eintrag.live?.url || eintrag.url,
          from: hostJetzt.name || "Host",
          host: false,
          resync: true,
          at: jetzt,
          videoTime: hostJetzt.position,
          timestamp: jetzt,
          playing: false,
          sequenceId: naechsteNummer(eintrag),
          episodeId: kennungFuerIhn,
          hostId: hostJetzt.geraetId
        });
      }

      // Der Host haengt an den lebenden Meldungen: wechselt jemand die Folge
      // oder taucht neu auf, kann er sich verschieben. Dann muss der volle
      // Zustand hinaus - die Leiste allein traegt ihn nicht in die Karten.
      if (wachAuf || hostVorher !== aktuelleHostId(socket.raum, eintrag)) {
        zustandSenden(socket.raum);
      }

      if (geaendert) standSenden(socket.raum, eintrag);
      else standSendenGedrosselt(socket.raum, eintrag);
      // Der Inhalt der Meldung bleibt lokal; hinaus geht nur die Schnittmenge.
      // Der Vergleich in spoilerStandSenden verhindert Netzverkehr je Positionstick.
      spoilerStandSenden(socket.raum, eintrag);
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
      // Und ausdruecklich: der Beschenkte haelt die Rolle jetzt, auch ueber
      // Folgen hinweg. Die Vorreihung allein truege nur bis zur naechsten
      // Folge - dort wuerde der Stempel neu gesetzt und die Uebergabe waere
      // wieder vergessen.
      eintrag.hostId = wen;
      eintrag.hostGesehen = Date.now();
      zustandSenden(socket.raum);
      standSenden(socket.raum, eintrag);
      return;
    }

    if (nachricht.type === "bye") {
      const eintrag = raum.titel.get(text(nachricht.key, 300));
      if (!eintrag) return;
      const standWeg = Boolean(eintrag.stand?.delete(socket.geraetId));
      const spoilerWeg = Boolean(eintrag.spoiler?.delete(socket.geraetId));
      const wartenWeg = Boolean(eintrag.spoilerWartet?.delete(socket.geraetId));
      if (!standWeg && !spoilerWeg && !wartenWeg) return;
      // Wer die Folge verlaesst, gibt die Rolle ab - hier ist nichts unklar,
      // also auch keine Gnadenfrist.
      hostFreigeben(eintrag, socket.geraetId);
      // Und er ist kein erwarteter Player einer laufenden Startverabredung
      // mehr. Ohne diese Zeile blieb seine Geraete-ID in `wartetAuf` stehen,
      // obwohl sein Player zu ist: die Runde wartete dann auf eine
      // Bereitmeldung, die niemand mehr abgeben kann, und der gemeinsame
      // Start blieb aus, obwohl alle anderen laengst in der neuen Folge
      // standen. `leave` und `kick` raeumen dort seit jeher auf; `bye` war
      // der einzige Weg aus einer Folge, der es nicht tat. Der eigene Socket
      // zaehlt dabei nicht mehr mit: er ist noch im Raum, aber ohne Player.
      syncTeilnehmerEntfernen(socket.raum, eintrag, socket.geraetId, socket);
      zustandSenden(socket.raum);
      standSenden(socket.raum, eintrag);
      spoilerStandSenden(socket.raum, eintrag);
      return;
    }

    if (nachricht.type === "syncready") {
      const eintrag = raum.titel.get(text(nachricht.key, 300));
      if (!eintrag?.sync) return;
      // Eine Bereitmeldung aus dem abgebrochenen oder vorherigen Lauf darf
      // keinen neuen Start ausloesen. Die Kennung wird mit syncprepare
      // ausgegeben und mit syncstart wiederholt.
      if (text(nachricht.syncId, 80) !== eintrag.sync.id) return;
      // `ok: false` ist eine Absage: dieses Geraet bekommt die neue Folge nicht
      // auf (kein Hoster, keine Quelle, Player zu). Ohne sie hing die ganze
      // Runde die volle Frist in "Warten auf alle", obwohl feststand, dass die
      // Bereitmeldung nie kommt. Fuer die Wartemenge zaehlt beides gleich; wer
      // absagt, gehoert danach auch nicht mehr zu dieser Schranke.
      if (nachricht.ok === false) {
        eintrag.sync.erwartet?.delete(socket.geraetId);
        // Und er wird freigegeben.
        //
        // Er bekommt keinen gemeinsamen Start mehr - er gehoert nicht mehr zu
        // dieser Schranke. Erfaehrt er aber gar nichts, wartet sein Player
        // weiter auf einen Start, den es fuer ihn nie gibt: die Bedienung
        // bleibt gesperrt, der Play-Knopf tut nichts, entpausieren geht nicht.
        // Gemeldet als "nach dem Folgenwechsel buggt der Play-Knopf rum".
        //
        // Geschickt wird genau das, was auch der Fristablauf schickt: eine
        // Pause ohne Bereitschaftsanforderung und das Ende der Schranke. Beides
        // kennt jeder Client schon.
        const frei = Date.now();
        socket.send(JSON.stringify({
          type: "control", key: eintrag.key, action: "pause",
          position: eintrag.sync.ziel, videoTime: eintrag.sync.ziel, playing: false,
          frameTime: eintrag.sync.frameTime,
          url: eintrag.live?.url || eintrag.url, at: frei, timestamp: frei,
          sequenceId: naechsteNummer(eintrag), syncId: eintrag.sync.id,
          episodeId: folgenKennung(eintrag.season, eintrag.episode),
          hostId: aktuelleHostId(socket.raum, eintrag), reason: "sync-timeout"
        }));
        socket.send(JSON.stringify({
          type: "syncfailed", key: eintrag.key, syncId: eintrag.sync.id
        }));
      }
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
      // Auch hier zaehlt der Host und nicht der letzte Befehl. Beitreten und
      // Wiederverbinden laufen ueber diese Antwort - stand im Rundenstand noch
      // eine alte Pause, startete ein neu dazugekommener Fernseher gar nicht
      // erst, obwohl die Runde lief.
      const angehalten = !stand.laeuft;
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

    // Herausnehmen darf, wer eingestellt hat - und jedes andere Geraet
    // derselben Person. Wer den Geraeteabgleich benutzt, hat kein "der
    // Rechner" und "das Handy", sondern ein Konto; dass ein Titel sich nur
    // dort herausnehmen liess, wo er zufaellig eingestellt wurde, war fuer den
    // Benutzer nicht zu erklaeren.
    if (nachricht.type === "unshare") {
      const key = text(nachricht.key, 300);
      const eintrag = raum.titel.get(key);
      if (!eintrag) return;
      if (!istEinsteller(eintrag, socket)) return;

      raum.titel.delete(key);
      // Der Grabstein haelt ihn draussen, bis ihn jemand bewusst wieder
      // einstellt. Ohne ihn traegt das naechste Geraet, das sich verbindet, den
      // Titel wieder nach - siehe GRAB_LEBENSDAUER_MS.
      if (raum.graeber) {
        raum.graeber.set(key, Date.now());
        while (raum.graeber.size > MAX_GRAEBER_JE_RAUM) {
          raum.graeber.delete(raum.graeber.keys().next().value);
        }
      }
      zustandSpeichernSpaeter();
      zustandSenden(socket.raum);
      return;
    }

    // Fortschritt zaehlt nur von Beigetretenen und geht nur an Beigetretene.
    if (nachricht.type === "progress") {
      const eintrag = raum.titel.get(text(nachricht.key, 300));
      if (!eintrag || !eintrag.members.has(socket.geraetId)) return;
      const fortschritt = fortschrittSaeubern(nachricht.progress);
      if (!fortschritt) return;

      // Der Lebenslauf eines Titels in der Runde.
      //
      // Aktiv, archiviert, wieder aktiv - und der Raum bleibt durch alles
      // hindurch stehen. Archiviert wird, was die Runde hinter sich hat: ein
      // zu Ende geschauter Film, eine Serie, deren letzte verfuegbare Folge
      // abgehakt ist. Ausgerechnet hat das die App - nur sie kennt die
      // Seriengrenzen und weiss, ob nach Folge 8 noch etwas kommt; das Relay
      // fuehrt die Antwort bloss und sorgt dafuer, dass sie sich nicht
      // rueckwaerts umstossen laesst.
      //
      // Deshalb steht hier ein Riegel und keine blosse Zuweisung: solange ein
      // Titel archiviert ist, kommt nur eine *neue Folge* durch. Ein Handy,
      // das eine Woche aus war, meldet beim Start seinen alten Stand - der
      // wuerde den Titel sonst wieder aktiv machen und obendrein die Runde auf
      // eine Folge zurueckdrehen, die alle laengst gesehen haben.
      const weiter = folgeIstNeuer(eintrag, fortschritt);
      if (eintrag.archived && !weiter) return;
      const archivVorher = Boolean(eintrag.archived);
      eintrag.archived = Boolean(fortschritt.archived);

      // Der Zeitpunkt kommt vom Server, nicht vom Geraet: gehen die Uhren
      // auseinander, wuerden die Meldungen des einen dauerhaft als "aelter"
      // verworfen und sein Stand kaeme nie an.
      fortschritt.updatedAt = new Date().toISOString();
      fortschritt.from = fortschritt.from || socket.name;

      // Wessen Stelle der Stand der Runde ist.
      //
      // Bis hierher schrieb ihn jedes Mitglied. Der Slot ist aber einer, und
      // er ist nicht nur Anzeige: `Mitschauen.rundenStelle()` liest ihn als
      // Startstelle fuer den Autostart. Ein Handy, dessen Player gerade erst
      // laedt, meldet dabei position=0 - und zog damit die Runde auf null,
      // sichtbar als Balken, der zwischen der richtigen Stelle und 0 sprang,
      // und als Geraet, das gleich darauf bei 0:00 einstieg.
      //
      // Der Host ist die Zeitquelle, also schreibt er ihn. Die eine Ausnahme
      // ist der Weg nach *vorn*: eine echt neuere Folge darf jedes Geraet
      // melden - daran haengt, dass ein archivierter Titel zurueckkommt und
      // die Runde der naechsten Folge folgt (siehe folgeIstNeuer). Zurueck
      // zieht damit niemand: `weiter` ist streng aufsteigend.
      //
      // Gibt es gar keinen aktiven Host, gibt es auch nichts zu schuetzen:
      // dann meldet hier jemand einen Stand in eine Runde, die niemand fuehrt
      // (ein Geraet, das nach dem Einschalten nachtraegt, ein Raum, in dem
      // gerade niemand schaut). Der gehoert uebernommen - sonst bliebe der
      // Titel fuer immer ohne Stand.
      const hostId = aktuelleHostId(socket.raum, eintrag);
      const istHost = socket.geraetId === hostId;
      const fuehrt = istHost || !hostId || weiter;
      if (fuehrt) {
        eintrag.progress = fortschritt;
        if (fortschritt.url) eintrag.url = fortschritt.url;
        eintrag.season = fortschritt.season || eintrag.season;
        eintrag.episode = fortschritt.episode || eintrag.episode;
      }
      // Die Stelle fuer die Leiste kommt hier laufend herein - von jedem
      // Geraet. Sie steht je Geraet und zieht niemanden mit; genau dafuer ist
      // sie da (Teilnehmerleiste, Driftmessung).
      standSetzen(eintrag, socket.geraetId, socket.name, { position: fortschritt.position });
      standSenden(socket.raum, eintrag);
      // Ein Wechsel zwischen aktiv und archiviert aendert die Karte selbst und
      // nicht nur den Balken darunter - der ganze Zustand geht neu hinaus,
      // damit jedes Geraet den Titel im selben Moment aus "Gemeinsam
      // weiterschauen" nimmt oder zurueckholt.
      if (archivVorher !== Boolean(eintrag.archived)) zustandSenden(socket.raum);
      zustandSpeichernSpaeter();

      // Und weitergesagt wird nur, was auch der Stand der Runde ist. Sonst
      // uebernaehmen die anderen ueber `watchpartyStandUebernehmen` genau die
      // Stelle, die hier gerade nicht gelten soll.
      if (!fuehrt) return;
      const daten = JSON.stringify({ type: "progress", key: eintrag.key, progress: fortschritt });
      for (const client of wss.clients) {
        if (client === socket || client.raum !== socket.raum || client.readyState !== client.OPEN) continue;
        if (!eintrag.members.has(client.geraetId)) continue;
        client.send(daten);
      }
    }
    } catch {
      return;
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
    // Eine neu aufgebaute Verbindung desselben Geraets kann schon bestaetigt
    // sein, bevor der alte WebSocket sein close-Ereignis liefert. In diesem
    // Fall gehoert der Geraetezustand weiterhin der offenen Verbindung. Den
    // alten Socket jetzt nach Geraete-ID abzumelden, wuerde die neue
    // YouTube-Mitgliedschaft sowie ihren Player- und Spoilerstand mit
    // entfernen; danach waere die neue Leitung offen, duerfte aber nichts mehr
    // steuern. Raum und Kennung muessen beide passen: ein echtes Verlassen aus
    // einem anderen Raum oder von einem anderen Geraet bleibt davon unberuehrt.
    const weiterVerbunden = istVerbunden(socket.raum, socket.geraetId);
    // Aus der YouTube-Runde austragen. Wer nur kurz herausfaellt, meldet sich
    // beim naechsten Verbindungsaufbau selbst wieder an.
    if (!weiterVerbunden) {
      youtubeParty.abmelden({
        raumcode: socket.raum,
        geraetId: socket.geraetId,
        verteilen: (antwort, ids) => anMitgliederSenden(socket.raum, antwort, ids)
      });
    }
    const raum = raeume.get(socket.raum);
    let gewechselt = false;
    for (const eintrag of raum?.titel.values() || []) {
      syncTeilnehmerEntfernen(socket.raum, eintrag, socket.geraetId, socket);
      if (weiterVerbunden) continue;
      const spoilerWeg = Boolean(eintrag.spoiler?.delete(socket.geraetId));
      const wartenWeg = Boolean(eintrag.spoilerWartet?.delete(socket.geraetId));
      // Wer weg ist, steht auch nirgends mehr - sonst zeigt die Leiste eine
      // Sekunde von jemandem, der gar nicht mehr zuschaut.
      if (eintrag.stand?.delete(socket.geraetId)) {
        standSenden(socket.raum, eintrag);
        spoilerStandSenden(socket.raum, eintrag);
      } else if (spoilerWeg || wartenWeg) spoilerStandSenden(socket.raum, eintrag);
      // Wer die Verbindung verliert, ist nicht mehr aktiv - damit faellt er
      // aus der Host-Wahl und der naechste in dieser Folge rueckt nach.
      gewechselt = true;
    }
    if (gewechselt) zustandSenden(socket.raum);
    else anRaumSenden(socket.raum, { type: "peers", peers: teilnehmer(socket.raum) });
  });
});

/**
 * Wie oft nachgesehen wird, ob noch jemand bei einer anderen Folge steht.
 */
const NACHZIEHEN_TAKT_MS = 5000;
/**
 * Und wie lange ein Geraet danach in Ruhe gelassen wird.
 *
 * <p>Eine Folgenseite braucht auf einem langsamen Geraet mehr als fuenf
 * Sekunden, bis der Player steht und die neue Folge gemeldet ist. Ohne diese
 * Sperre kaeme im Takt ein zweites, drittes, viertes "navigate" hinterher, und
 * jedes davon laedt die Seite neu - das Geraet kaeme nie an.
 */
const NACHZIEHEN_SPERRE_MS = 25000;

/**
 * Niemand bleibt auf einer anderen Folge sitzen.
 *
 * <p>Ein `navigate` erreicht nur die, die gerade verbunden sind und zuhoeren.
 * Wer beim Wechsel offline war, wer eine Seite lud, wer den Befehl aus einem
 * anderen Grund nicht ausfuehren konnte - der stand danach allein bei der alten
 * Folge, und nichts holte ihn je wieder. Gemeldet als "das Mitziehen
 * funktioniert echt schlecht".
 *
 * <p>Deshalb wird der Zustand regelmaessig verglichen statt einmalig
 * verschickt: der Befehl ist nur der schnelle Weg, dieser Takt ist der sichere.
 * Er schickt genau dem Geraet ein `navigate`, das woanders steht, und sonst
 * niemandem.
 *
 * <p>Wer die Runde auf eine neue Folge zieht, darf jeder sein - `control
 * navigate` ist nicht an den Host gebunden. Dieser Takt bringt dann alle
 * uebrigen hinterher, gleich von wem der Wechsel kam.
 */
function nachzueglerHolen() {
  const jetzt = Date.now();
  for (const socket of wss.clients) {
    if (socket.readyState !== socket.OPEN || !socket.raum || !socket.geraetId) continue;
    const raum = raeume.get(socket.raum);
    if (!raum || !raum.titel) continue;
    for (const eintrag of raum.titel.values()) {
      if (!eintrag.members?.has(socket.geraetId)) continue;
      // Ohne Folge und ohne Adresse gibt es kein Ziel, auf das man ziehen
      // koennte. Ein Film hat keine Folgennummer - da ist auch nichts zu tun.
      if (!eintrag.episode || !eintrag.url) continue;
      // Waehrend eines gemeinsamen Gleichziehens nicht dazwischenfunken: das
      // schickt seine eigenen Wechsel und wartet auf Bereitmeldungen.
      if (eintrag.sync) continue;
      const wert = eintrag.stand?.get(socket.geraetId);
      // Wer noch gar nichts gemeldet hat, schaut nicht - er sitzt vielleicht
      // auf der Startseite. Ungefragt eine Folge aufreissen waere zu viel.
      if (!wert || !wert.episode) continue;
      if (Number(wert.episode) === Number(eintrag.episode)
        && Number(wert.season || 0) === Number(eintrag.season || 0)) continue;

      if (!eintrag.nachgezogen) eintrag.nachgezogen = new Map();
      const ziel = folgenKennung(eintrag.season, eintrag.episode);
      const vorher = eintrag.nachgezogen.get(socket.geraetId);
      if (vorher && vorher.ziel === ziel && jetzt - vorher.at < NACHZIEHEN_SPERRE_MS) continue;
      eintrag.nachgezogen.set(socket.geraetId, { ziel, at: jetzt });

      console.log(`Nachziehen: ${socket.name || socket.geraetId} steht bei `
        + `s${wert.season || 0}e${wert.episode}, die Runde bei ${ziel}`);
      socket.send(JSON.stringify({
        type: "control",
        key: eintrag.key,
        action: "navigate",
        position: 0,
        url: eintrag.url,
        from: "Runde",
        host: false,
        at: jetzt,
        videoTime: 0,
        timestamp: jetzt,
        playing: false,
        sequenceId: naechsteNummer(eintrag),
        episodeId: ziel,
        // Der gespeicherte Host, nicht der gewaehlte.
        //
        // `aktuelleHostId` waehlt bei Bedarf einen neuen und stempelt
        // `hostGesehen` - das ist richtig an den Stellen, an denen jemand
        // etwas tut, und falsch in einem Takt, der nur nachsieht. Alle fuenf
        // Sekunden von aussen angestossen, uebersprang diese Wahl die
        // Gnadenfrist eines kurz abgerissenen Hosts: hostbleibttest 4 sah
        // danach den Nachrueckenden. Ein Takt beobachtet, er entscheidet
        // nicht.
        hostId: eintrag.hostId || ""
      }));
    }
  }
}

setInterval(nachzueglerHolen, NACHZIEHEN_TAKT_MS).unref?.();

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
// Einmal gleich nach dem Laden: ein Relay, das einen Monat aus war, traegt
// abgelaufene Grabsteine mit herein, und die sollen nicht bis zur naechsten
// vollen Stunde liegenbleiben. Raeume ruehrt das nicht an - siehe aufraeumen().
aufraeumen();
server.listen(PORT, () => {
  console.log(`ELFIX Watchparty-Relay ${FASSUNG} auf Port ${PORT} (Ablage: ${STATE_FILE})`);
  // Die Adresse zum Nachsehen gleich mit. Wer den Dienst gerade eingerichtet
  // hat, will als Naechstes wissen, ob er laeuft - und soll dafuer nicht erst
  // im README suchen muessen, wo das steht.
  console.log(`Statusseite: http://localhost:${PORT}/status`);
  // Nur die gepackte Datei haelt sich selbst auf dem neuesten Stand. Wer aus
  // dem Quelltext startet, hat ein Repository und aktualisiert mit git - ihm
  // eine Binaerdatei darueberzulegen waere das Gegenteil von hilfreich.
  if (GEPACKT) {
    require("./aktualisierung").starten({ fassung: FASSUNG, pfad: process.execPath });
  }

  // Das Symbol in der Statusleiste - gruen, solange es laeuft. Wer das Relay
  // gerade installiert hat, sieht damit ohne einen einzigen Handgriff, dass es
  // da ist. Wo keine Leiste ist (systemd, Server, Quelltext), erscheint keins;
  // das entscheidet nicht diese Stelle, sondern das Modul.
  statusleiste.starten({ gepackt: GEPACKT, ordner: STATE_DIR, port: PORT });
  // Und beim allerersten Start einmal die Seite selbst.
  seiteZeigen.vielleichtZeigen({ gepackt: GEPACKT, ordner: STATE_DIR, port: PORT });
});
