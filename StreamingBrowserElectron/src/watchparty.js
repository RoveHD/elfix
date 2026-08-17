"use strict";

// Watchparty: gemeinsam an einer Serie dranbleiben.
//
// Nichts wird von selbst geteilt. Jemand stellt eine Serie in den Raum, alle
// sehen sie als Vorschlag, und wer mitmachen will, tritt bei. Erst ab dann
// fliesst der Fortschritt dieser Serie zwischen den Beigetretenen.
//
// Das Modul kennt weder Electron noch die Ablage der Favoriten: es bekommt beim
// Start Rueckrufe und ist dadurch ohne laufende App pruefbar.

const { versatzAusProben } = require("./watchparty-sync");

const RECONNECT_MIN_MS = 2000;
const RECONNECT_MAX_MS = 60000;
const SENDE_VERZOEGERUNG_MS = 1500;

// Uhrabgleich mit dem Relay. Ohne den waere jede Hochrechnung "wo steht der
// Host jetzt?" um die Differenz zweier Systemuhren daneben - und die betraegt
// auf ungepflegten Rechnern gern Minuten.
const UHR_PROBEN = 5;
const UHR_ABSTAND_MS = 120;
// Uhren laufen auseinander, und zwar langsam. Alle halbe Minute nachmessen
// kostet fuenf winzige Nachrichten und haelt den Versatz aktuell.
const UHR_AUFFRISCHEN_MS = 30000;
// Aelter als das, und der Versatz gilt als nicht mehr belastbar: dann wird
// lieber gar nicht hochgerechnet.
const UHR_HALTBAR_MS = 180000;

class Watchparty {
  constructor(optionen = {}) {
    this.aufZustand = optionen.onState || (() => {});
    this.aufFortschritt = optionen.onProgress || (() => {});
    this.aufStatus = optionen.onStatus || (() => {});
    this.aufKennung = optionen.onDeviceId || (() => {});
    this.aufSteuerung = optionen.onControl || (() => {});
    // Wer steht wo: fuer die Leiste, die zeigt, ob alle beieinander sind.
    this.aufStand = optionen.onWatchstate || (() => {});
    this.WebSocketKlasse = optionen.WebSocketKlasse || globalThis.WebSocket;

    this.socket = null;
    this.serverUrl = "";
    this.raum = "";
    this.name = "";
    this.geraetId = "";
    this.aktiv = false;
    this.verbunden = false;
    this.teilnehmer = [];
    this.geteilt = [];
    this.letzterFehler = "";
    this.versuche = 0;
    this.reconnectTimer = 0;
    this.sendeTimer = 0;
    this.warteschlange = new Map();
    // Der gemessene Uhrversatz zum Relay: { versatz, umlauf, at }. Solange er
    // fehlt, wird nirgends hochgerechnet.
    this.uhr = null;
    this.uhrProben = [];
    this.uhrTimer = 0;
    this.uhrAuffrischen = 0;
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

  // Alle geteilten Serien, jeweils mit der Angabe, ob dieses Geraet dabei ist.
  eintraege() {
    return this.geteilt.map((eintrag) => ({
      ...eintrag,
      // Der Raum gehoert an den Eintrag: laufen mehrere nebeneinander, muss
      // jede Aktion wissen, welcher gemeint ist.
      room: this.raum,
      joined: Array.isArray(eintrag.memberIds) && eintrag.memberIds.includes(this.geraetId),
      // Die eigene Kennung braucht die Oberflaeche, um sich selbst in der
      // Mitgliederliste nicht zum Rauswerfen anzubieten.
      myId: this.geraetId,
      myName: this.name,
      // Nur wer eine Serie eingestellt hat, darf sie wieder herausnehmen. Ein
      // aelteres Relay kennt die Geraete-Kennung noch nicht - dann muss der
      // Name herhalten, sonst verschwindet der Knopf ganz.
      mine: eintrag.addedById
        ? eintrag.addedById === this.geraetId
        : Boolean(eintrag.addedBy) && eintrag.addedBy === this.name
    }));
  }

  istBeigetreten(key) {
    return this.eintraege().some((eintrag) => eintrag.key === key && eintrag.joined);
  }

  konfigurieren({ enabled, serverUrl, room, name, deviceId }) {
    const neuerServer = String(serverUrl || "").trim();
    const neuerRaum = String(room || "").trim();
    const gleich = this.serverUrl === neuerServer && this.raum === neuerRaum && this.name === name;

    this.serverUrl = neuerServer;
    this.raum = neuerRaum;
    this.name = String(name || "").slice(0, 40);
    this.geraetId = String(deviceId || "").slice(0, 64);
    this.aktiv = Boolean(enabled) && Boolean(neuerServer) && Boolean(neuerRaum);

    if (!this.aktiv) {
      this.trennen();
      this.geteilt = [];
      this.melde();
      this.aufZustand(this.eintraege());
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
      this.senden({ type: "join", room: this.raum, name: this.name, deviceId: this.geraetId });
      this.melde();
      this.warteschlangeSenden();
      // Sofort messen: das erste Ereignis kann Millisekunden spaeter kommen,
      // und ohne Versatz steigt der smarte Start auf die alte Stelle ein.
      this.uhrMessen();
    };
    socket.onmessage = (ereignis) => this.nachrichtVerarbeiten(ereignis?.data);
    socket.onerror = (ereignis) => {
      this.letzterFehler = String(ereignis?.message || "Verbindung fehlgeschlagen");
    };
    socket.onclose = () => {
      this.verbunden = false;
      this.socket = null;
      this.teilnehmer = [];
      this.uhrAnhalten();
      this.uhr = null;
      this.uhrProben = [];
      this.melde();
      this.spaeterNeuVerbinden();
    };
  }

  // --- Uhrabgleich ----------------------------------------------------------
  //
  // Eine Handvoll Proben kurz hintereinander, dann gilt die mit dem kuerzesten
  // Umlauf. Danach alle halbe Minute nachmessen.
  uhrMessen() {
    this.uhrAnhalten();
    this.uhrProben = [];
    let offen = UHR_PROBEN;
    const probe = () => {
      if (!this.verbunden || !this.socket) {
        this.uhrAnhalten();
        return;
      }
      this.senden({ type: "time", t0: Date.now() });
      offen -= 1;
      if (offen <= 0) {
        this.uhrTimer = 0;
        this.uhrNachmessenPlanen();
        return;
      }
      this.uhrTimer = setTimeout(probe, UHR_ABSTAND_MS);
      this.uhrTimer.unref?.();
    };
    probe();
  }

  uhrNachmessenPlanen() {
    if (this.uhrAuffrischen) return;
    this.uhrAuffrischen = setTimeout(() => {
      this.uhrAuffrischen = 0;
      if (this.verbunden) this.uhrMessen();
    }, UHR_AUFFRISCHEN_MS);
    this.uhrAuffrischen.unref?.();
  }

  uhrAnhalten() {
    if (this.uhrTimer) clearTimeout(this.uhrTimer);
    if (this.uhrAuffrischen) clearTimeout(this.uhrAuffrischen);
    this.uhrTimer = 0;
    this.uhrAuffrischen = 0;
  }

  uhrAntwort(nachricht) {
    const t0 = Number(nachricht.t0);
    const t1 = Number(nachricht.t1);
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) return;
    this.uhrProben.push({ t0, t1, t2: Date.now() });
    if (this.uhrProben.length > UHR_PROBEN) this.uhrProben.shift();
    const beste = versatzAusProben(this.uhrProben);
    // Eine einzige brauchbare Probe reicht zum Anfangen; die naechsten
    // verbessern sie nur, wenn sie schneller zurueckkamen.
    if (beste) this.uhr = { ...beste, at: Date.now() };
  }

  // Wie spaet ist es auf dem Relay? Fehlt eine belastbare Messung, kommt null
  // zurueck - dann wird bewusst nicht hochgerechnet.
  serverJetzt() {
    if (!this.uhr || Date.now() - this.uhr.at > UHR_HALTBAR_MS) return null;
    return Date.now() + this.uhr.versatz;
  }

  uhrStand() {
    if (!this.uhr || Date.now() - this.uhr.at > UHR_HALTBAR_MS) return null;
    return { versatz: this.uhr.versatz, umlauf: this.uhr.umlauf, alter: Date.now() - this.uhr.at };
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
    this.uhrAnhalten();
    // Der Versatz gehoert zur Verbindung. Nach einem Wiederaufbau kann es ein
    // anderes Relay sein - oder dieselbe Maschine mit gestellter Uhr.
    this.uhr = null;
    this.uhrProben = [];
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

    if (nachricht?.type === "error") {
      this.letzterFehler = String(nachricht.message || "");
      this.melde();
      return;
    }
    if (nachricht?.type === "peers") {
      this.teilnehmer = Array.isArray(nachricht.peers) ? nachricht.peers : [];
      this.melde();
      return;
    }
    // Die Antwort auf eine Uhrprobe. Sie geht bewusst nicht durch den Block
    // darunter: sie aendert nichts am Zustand und darf nie einen Fehler melden.
    if (nachricht?.type === "timeack") {
      this.uhrAntwort(nachricht);
      return;
    }
    // Ein Fehler beim Einarbeiten wuerde im Ereignis-Handler still
    // verschwinden - deshalb hier festhalten statt verlieren.
    try {
      if (nachricht?.type === "state") {
        // Der Server sagt, unter welcher Kennung dieses Geraet gefuehrt wird.
        // Hatte die App noch keine, ist das ab jetzt ihre - sonst erkennt sie
        // sich in der Mitgliederliste nicht wieder.
        if (nachricht.you && nachricht.you !== this.geraetId) {
          this.geraetId = nachricht.you;
          this.aufKennung(this.geraetId);
        }
        this.geteilt = Array.isArray(nachricht.shared) ? nachricht.shared : [];
        if (Array.isArray(nachricht.peers)) this.teilnehmer = nachricht.peers;
        this.melde();
        this.aufZustand(this.eintraege());
        return;
      }
      if ((nachricht?.type === "syncprepare" || nachricht?.type === "syncstart") && nachricht.key) {
        this.aufSteuerung({ ...nachricht, action: nachricht.type });
        return;
      }
      if (nachricht?.type === "control" && nachricht.key && nachricht.action) {
        this.aufSteuerung(nachricht);
        return;
      }
      // Der Stand je Geraet. Ein aelteres Relay schickt das nicht - dann bleibt
      // die Leiste eben leer, alles andere laeuft unveraendert weiter.
      if (nachricht?.type === "watchstate" && nachricht.key) {
        this.aufStand({ key: nachricht.key, members: Array.isArray(nachricht.members) ? nachricht.members : [] });
        return;
      }
      if (nachricht?.type === "progress" && nachricht.key && nachricht.progress) {
        // Der Fortschritt kommt getrennt vom Zustand. Ohne diese Uebernahme
        // zeigte die Karte weiter den Stand von vorhin - es wirkte, als
        // aktualisiere sich nur alle paar Minuten etwas.
        const eintrag = this.geteilt.find((item) => item.key === nachricht.key);
        if (eintrag) {
          eintrag.progress = nachricht.progress;
          if (nachricht.progress.season) eintrag.season = nachricht.progress.season;
          if (nachricht.progress.episode) eintrag.episode = nachricht.progress.episode;
          this.aufZustand(this.eintraege());
        }
        this.aufFortschritt(nachricht.key, nachricht.progress);
      }
    } catch (fehler) {
      this.letzterFehler = String(fehler?.message || fehler);
      console.error("[ELFIX WATCHPARTY] Empfang fehlgeschlagen:", fehler);
      this.melde();
    }
  }

  teilen(item) {
    this.senden({ type: "share", item });
  }

  beitreten(key) {
    this.senden({ type: "enter", key });
  }

  verlassen(key) {
    this.senden({ type: "leave", key });
  }

  entfernen(key) {
    this.senden({ type: "unshare", key });
  }

  // Pause, Weiter oder Springen an die anderen Beigetretenen schicken.
  steuern(key, action, position) {
    this.steuernMitAdresse(key, action, position, "");
  }

  // Beim Folgenwechsel gehoert die neue Adresse dazu.
  steuernMitAdresse(key, action, position, url) {
    if (!this.aktiv || !key || !this.istBeigetreten(key)) return;
    this.senden({ type: "control", key, action, position, url });
  }

  // Wo dieses Geraet gerade steht. Geht im Sekundentakt heraus und ist die
  // Grundlage fuer die Leiste bei den anderen - bewusst getrennt vom
  // Fortschritt, der an der Buchhaltung der Favoriten haengt und nach einem
  // Folgenwechsel schon einmal aussetzt.
  meldeStand(key, stand) {
    if (!this.aktiv || !key || !this.istBeigetreten(key)) return;
    this.senden({ type: "here", key, ...stand });
  }

  // Diese Folge ist hier nicht mehr offen. Sofort abmelden, statt still zu
  // werden - sonst steht man bei den anderen noch, bis der Herzschlag ablaeuft.
  verlasseStand(key) {
    if (!this.aktiv || !key) return;
    this.senden({ type: "bye", key });
  }

  // Den Stand des Hosts anfordern.
  abgleichen(key) {
    if (!this.aktiv || !key || !this.istBeigetreten(key)) return;
    this.senden({ type: "resync", key });
  }

  // Alle gemeinsam auf dieselbe Stelle bringen und zusammen starten.
  gleichziehen(key, position) {
    if (!this.aktiv || !key || !this.istBeigetreten(key)) return;
    this.senden({ type: "syncall", key, position });
  }

  bereitZumStart(key) {
    this.senden({ type: "syncready", key });
  }

  // Den Host an ein anderes Geraet weitergeben.
  hostUebergeben(key, memberId) {
    this.senden({ type: "handover", key, memberId });
  }

  // Ein Mitglied aus einer Serie werfen - nur fuer den, der sie eingestellt hat.
  rauswerfen(key, memberId) {
    this.senden({ type: "kick", key, memberId });
  }

  // Fortschritt wird gesammelt: waehrend des Schauens laeuft er im Sekundentakt
  // und soll nicht jede Sekunde durchs Netz.
  fortschrittMelden(key, fortschritt) {
    if (!this.aktiv || !key || !this.istBeigetreten(key)) return;
    this.warteschlange.set(key, fortschritt);
    if (this.sendeTimer) return;
    this.sendeTimer = setTimeout(() => {
      this.sendeTimer = 0;
      this.warteschlangeSenden();
    }, SENDE_VERZOEGERUNG_MS);
    this.sendeTimer.unref?.();
  }

  warteschlangeSenden() {
    if (!this.verbunden || !this.warteschlange.size) return;
    for (const [key, fortschritt] of this.warteschlange) {
      this.senden({ type: "progress", key, progress: fortschritt });
    }
    this.warteschlange.clear();
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
