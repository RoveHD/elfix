"use strict";

// Watchparty: teilt den Weiterschauen-Fortschritt zwischen mehreren Geraeten.
// Wer weiterschaut, schickt den Stand an das Relay (siehe sync-server/), die
// anderen Geraete ziehen nach. Bewusst nur Fortschritt - die Wiedergabe selbst
// laeuft auf jedem Geraet fuer sich.
//
// Das Modul kennt weder Electron noch die Ablage der Favoriten: es bekommt beim
// Start zwei Rueckrufe und ist dadurch ohne laufende App pruefbar.

const RECONNECT_MIN_MS = 2000;
const RECONNECT_MAX_MS = 60000;
const SENDE_VERZOEGERUNG_MS = 1200;

class Watchparty {
  constructor(optionen = {}) {
    this.aufEintraege = optionen.onItems || (() => {});
    this.aufStatus = optionen.onStatus || (() => {});
    this.WebSocketKlasse = optionen.WebSocketKlasse || globalThis.WebSocket;

    this.socket = null;
    this.serverUrl = "";
    this.raum = "";
    this.name = "";
    this.aktiv = false;
    this.verbunden = false;
    this.teilnehmer = [];
    this.letzterFehler = "";
    this.versuche = 0;
    this.reconnectTimer = 0;
    this.sendeTimer = 0;
    this.warteschlange = new Map();
  }

  status() {
    return {
      enabled: this.aktiv,
      connected: this.verbunden,
      room: this.raum,
      peers: this.teilnehmer,
      error: this.letzterFehler
    };
  }

  // Einstellungen anwenden. Aendert sich nichts Wesentliches, bleibt die
  // bestehende Verbindung stehen.
  konfigurieren({ enabled, serverUrl, room, name }) {
    const neuerServer = String(serverUrl || "").trim();
    const neuerRaum = String(room || "").trim();
    const gleich = this.serverUrl === neuerServer && this.raum === neuerRaum && this.name === name;

    this.serverUrl = neuerServer;
    this.raum = neuerRaum;
    this.name = String(name || "").slice(0, 40);
    this.aktiv = Boolean(enabled) && Boolean(neuerServer) && Boolean(neuerRaum);

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
      socket = new this.WebSocketKlasse(this.websocketAdresse());
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
      this.senden({ type: "join", room: this.raum, name: this.name });
      this.melde();
      this.warteschlangeSenden();
    };
    socket.onmessage = (ereignis) => this.nachrichtVerarbeiten(ereignis?.data);
    socket.onerror = (ereignis) => {
      this.letzterFehler = String(ereignis?.message || "Verbindung fehlgeschlagen");
    };
    socket.onclose = () => {
      this.verbunden = false;
      this.socket = null;
      this.teilnehmer = [];
      this.melde();
      this.spaeterNeuVerbinden();
    };
  }

  // http(s)-Adressen bequem eintippen koennen - verbunden wird ueber ws(s).
  websocketAdresse() {
    const roh = this.serverUrl;
    if (/^wss?:\/\//i.test(roh)) return roh;
    if (/^https:\/\//i.test(roh)) return roh.replace(/^https:/i, "wss:");
    if (/^http:\/\//i.test(roh)) return roh.replace(/^http:/i, "ws:");
    return `wss://${roh}`;
  }

  trennen() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = 0;
    }
    const socket = this.socket;
    this.socket = null;
    this.verbunden = false;
    this.teilnehmer = [];
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

  // Abstand wachsen lassen, damit ein schlafender Server nicht im Sekundentakt
  // angeklopft wird.
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

  nachrichtVerarbeiten(rohdaten) {
    let nachricht;
    try {
      nachricht = JSON.parse(String(rohdaten));
    } catch {
      return;
    }
    if (nachricht?.type === "peers") {
      this.teilnehmer = Array.isArray(nachricht.peers) ? nachricht.peers : [];
      this.melde();
      return;
    }
    if (nachricht?.type === "error") {
      this.letzterFehler = String(nachricht.message || "");
      this.melde();
      return;
    }
    if (nachricht?.type === "sync" || nachricht?.type === "progress") {
      const eintraege = Array.isArray(nachricht.items) ? nachricht.items : [];
      if (!eintraege.length) return;
      // Ein Fehler beim Einarbeiten wuerde im Ereignis-Handler still
      // verschwinden - deshalb hier festhalten statt verlieren.
      try {
        this.aufEintraege(eintraege);
      } catch (fehler) {
        this.letzterFehler = String(fehler?.message || fehler);
        console.error("[ELFIX WATCHPARTY] Empfang fehlgeschlagen:", fehler);
        this.melde();
      }
    }
  }

  // Meldungen werden kurz gesammelt: waehrend des Schauens laeuft der
  // Fortschritt im Sekundentakt und soll nicht jede Sekunde durchs Netz.
  melden(eintraege) {
    if (!this.aktiv) return;
    for (const eintrag of eintraege || []) {
      if (eintrag?.key) this.warteschlange.set(eintrag.key, eintrag);
    }
    if (!this.warteschlange.size || this.sendeTimer) return;
    this.sendeTimer = setTimeout(() => {
      this.sendeTimer = 0;
      this.warteschlangeSenden();
    }, SENDE_VERZOEGERUNG_MS);
    this.sendeTimer.unref?.();
  }

  warteschlangeSenden() {
    if (!this.verbunden || !this.warteschlange.size) return;
    const items = [...this.warteschlange.values()];
    this.warteschlange.clear();
    this.senden({ type: "progress", items });
  }

  senden(nachricht) {
    if (!this.socket || this.socket.readyState !== 1) return;
    try {
      this.socket.send(JSON.stringify(nachricht));
    } catch {
      // Bricht die Leitung weg, uebernimmt onclose.
    }
  }

  melde() {
    this.aufStatus(this.status());
  }
}

module.exports = { Watchparty };
