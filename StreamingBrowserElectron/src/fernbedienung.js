"use strict";

// Das Handy als Fernbedienung - die Seite des Rechners.
//
// Wenig Zustand, wenig Regeln: ELFIX meldet sich beim Relay mit seinem
// Kopplungscode als steuerbar, schickt im Fortschritts-Takt eine Zeile ueber
// das, was gerade laeuft, und fuehrt aus, was von drueben an Knopfdruecken
// hereinkommt. Mehr ist es nicht.
//
// Eine eigene Verbindung, nicht die der Watchparty oder des Geraeteabgleichs.
// Dieselbe Ueberlegung wie dort: die Fernbedienung soll auch dann gehen, wenn
// niemand mit anderen schaut und die eigenen Geraete nichts abzugleichen haben.
//
// Was hier hinausgeht, ist bewusst duenn - Titel, Folge, Stelle, laeuft oder
// nicht. Kein Verlauf, keine Liste, keine Adresse. Wer den Code hat, soll
// druecken koennen und nicht mitlesen.

const crypto = require("crypto");
const { websocketAdresse } = require("./watchparty");
// Dasselbe Alphabet wie beim Geraeteschluessel: Crockford, ohne die Zeichen,
// die man beim Abtippen verwechselt. Zwei Alphabete fuer zwei Codes waeren
// zwei Gelegenheiten, sich zu vertippen.
const { ALPHABET } = require("./geraete-schluessel");

const RECONNECT_MIN_MS = 2000;
const RECONNECT_MAX_MS = 60000;
// Acht Zeichen aus zweiunddreissig sind vierzig Bit - kurz genug, um es einmal
// abzutippen, und lang genug, dass Raten keine Aussicht hat. Das Relay laesst
// ohnehin nur drei Fehlversuche je Verbindung zu.
const CODE_LAENGE = 8;

function codeErzeugen() {
  const bytes = crypto.randomBytes(CODE_LAENGE);
  let code = "";
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
  return code;
}

function codeNormalisieren(wert) {
  const roh = String(wert == null ? "" : wert)
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  if (roh.length !== CODE_LAENGE) return "";
  for (const zeichen of roh) {
    if (!ALPHABET.includes(zeichen)) return "";
  }
  return roh;
}

class Fernbedienung {
  constructor(optionen = {}) {
    // Ein Knopfdruck vom Handy. Welcher Befehl was tut, entscheidet der
    // Hauptprozess - dieses Modul reicht ihn nur weiter.
    this.aufBefehl = optionen.onBefehl || (() => {});
    // Jemand hat gerade gekoppelt und wartet auf den ersten Stand.
    this.aufWach = optionen.onWach || (() => {});
    this.aufStatus = optionen.onStatus || (() => {});
    this.WebSocketKlasse = optionen.WebSocketKlasse || globalThis.WebSocket;

    this.socket = null;
    this.serverUrl = "";
    this.code = "";
    this.geraetId = "";
    this.aktiv = false;
    this.verbunden = false;
    this.letzterFehler = "";
    this.versuche = 0;
    this.reconnectTimer = 0;
    this.letzterStand = "";
  }

  status() {
    return {
      enabled: this.aktiv,
      connected: this.verbunden,
      code: this.code,
      error: this.letzterFehler
    };
  }

  melde() {
    this.aufStatus(this.status());
  }

  konfigurieren({ enabled, serverUrl, code, geraetId }) {
    const neuerServer = String(serverUrl || "").trim();
    const neuerCode = codeNormalisieren(code);
    const gleich = this.serverUrl === neuerServer && this.code === neuerCode;

    this.serverUrl = neuerServer;
    this.code = neuerCode;
    this.geraetId = String(geraetId || "").slice(0, 64);
    this.aktiv = Boolean(enabled) && Boolean(neuerServer) && Boolean(neuerCode);

    if (!this.aktiv) {
      this.trennen();
      this.melde();
      return;
    }
    if (gleich && this.verbunden) {
      this.melde();
      return;
    }
    this.trennen();
    this.verbinden();
  }

  verbinden() {
    if (!this.aktiv || this.socket || !this.WebSocketKlasse) return;
    this.letzterFehler = "";

    let socket;
    try {
      socket = new this.WebSocketKlasse(websocketAdresse(this.serverUrl));
    } catch (fehler) {
      this.letzterFehler = String(fehler?.message || fehler);
      this.melde();
      this.spaeterNeuVerbinden();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.verbunden = true;
      this.versuche = 0;
      this.senden({ type: "fnbereit", code: this.code, deviceId: this.geraetId });
      // Der naechste Stand soll hinaus, auch wenn sich nichts geaendert hat -
      // nach einem Abriss weiss drueben niemand mehr, was hier laeuft.
      this.letzterStand = "";
      this.melde();
    };
    socket.onmessage = (ereignis) => this.nachrichtVerarbeiten(ereignis?.data);
    socket.onerror = (ereignis) => {
      this.letzterFehler = String(ereignis?.message || "Verbindung fehlgeschlagen");
    };
    socket.onclose = () => {
      this.verbunden = false;
      this.socket = null;
      this.melde();
      this.spaeterNeuVerbinden();
    };
  }

  trennen() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = 0;
    }
    const socket = this.socket;
    this.socket = null;
    this.verbunden = false;
    this.letzterStand = "";
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // Eine bereits geschlossene Verbindung braucht nichts weiter.
    }
  }

  spaeterNeuVerbinden() {
    if (!this.aktiv || this.reconnectTimer) return;
    this.versuche += 1;
    const wartezeit = Math.min(RECONNECT_MIN_MS * 2 ** (this.versuche - 1), RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = 0;
      this.verbinden();
    }, wartezeit);
    this.reconnectTimer.unref?.();
  }

  senden(nachricht) {
    if (!this.socket || this.socket.readyState !== 1) return false;
    try {
      this.socket.send(JSON.stringify(nachricht));
      return true;
    } catch {
      return false;
    }
  }

  nachrichtVerarbeiten(rohdaten) {
    let nachricht;
    try {
      nachricht = JSON.parse(String(rohdaten));
    } catch {
      return;
    }
    if (nachricht?.type === "fnbefehl") {
      this.aufBefehl(String(nachricht.befehl || ""));
      return;
    }
    if (nachricht?.type === "fnwach") {
      // Frisch gekoppelt: der naechste Stand muss hinaus, auch wenn er
      // derselbe ist wie eben.
      this.letzterStand = "";
      this.aufWach();
      return;
    }
    if (nachricht?.type === "fnfehler") {
      this.letzterFehler = String(nachricht.message || "Abgewiesen");
      this.melde();
    }
  }

  // Der Stand geht nur hinaus, wenn er sich geaendert hat - und die Stelle
  // zaehlt dabei nur sekundenweise. Ohne das liefe je Takt eine Nachricht durch
  // die Leitung, auch wenn das Bild seit zehn Minuten steht.
  standMelden(stand) {
    if (!this.aktiv || !this.verbunden) return false;
    const nachricht = {
      type: "fnstand",
      titel: String(stand?.titel || ""),
      folge: String(stand?.folge || ""),
      laeuft: Boolean(stand?.laeuft),
      position: Math.round(Number(stand?.position) || 0),
      dauer: Math.round(Number(stand?.dauer) || 0),
      stumm: Boolean(stand?.stumm)
    };
    const finger = JSON.stringify(nachricht);
    if (finger === this.letzterStand) return false;
    this.letzterStand = finger;
    return this.senden(nachricht);
  }
}

module.exports = { Fernbedienung, codeErzeugen, codeNormalisieren, CODE_LAENGE };
