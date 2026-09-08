"use strict";

// Watchparty: gemeinsam an einer Serie dranbleiben.
//
// Nichts wird von selbst geteilt. Jemand stellt eine Serie in den Raum, alle
// sehen sie als Vorschlag, und wer mitmachen will, tritt bei. Erst ab dann
// fliesst der Fortschritt dieser Serie zwischen den Beigetretenen.
//
// Das Modul kennt weder Electron noch die Ablage der Favoriten: es bekommt beim
// Start Rueckrufe und ist dadurch ohne laufende App pruefbar.

const crypto = require("crypto");
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

function datenObjekt(wert) {
  return Boolean(wert) && typeof wert === "object" && !Array.isArray(wert);
}

function nachrichtenText(wert, laenge = 500) {
  return typeof wert === "string" ? wert.slice(0, laenge) : "";
}

function nachrichtenZahl(wert, ersatz = 0) {
  return typeof wert === "number" && Number.isFinite(wert) ? wert : ersatz;
}

// Relay-Zustand bleibt Datenmaterial: verschachtelte Objekte in Feldern, die
// laut Protokoll Skalare sind, werden nicht spaeter bis in UI-Rueckrufe
// getragen. Die drei echten Unterobjekte enthalten selbst nur Skalare.
function flacheDaten(roh) {
  if (!datenObjekt(roh)) return null;
  const sauber = {};
  for (const [key, wert] of Object.entries(roh).slice(0, 100)) {
    if (typeof wert === "string" || typeof wert === "boolean"
      || (typeof wert === "number" && Number.isFinite(wert)) || wert === null) {
      sauber[key] = wert;
    }
  }
  return sauber;
}

function geteilterEintrag(roh) {
  if (!datenObjekt(roh) || typeof roh.key !== "string" || !roh.key) return null;
  const sauber = flacheDaten(roh);
  for (const feld of ["members", "memberIds"]) {
    if (Array.isArray(roh[feld])) sauber[feld] = roh[feld]
      .filter((wert) => typeof wert === "string").slice(0, 1000);
  }
  for (const feld of ["progress", "live", "lastAction"]) {
    if (roh[feld] === null) sauber[feld] = null;
    else {
      const wert = flacheDaten(roh[feld]);
      if (wert) sauber[feld] = wert;
    }
  }
  return sauber;
}

function mitgliederListe(roh) {
  return Array.isArray(roh) ? roh.map(flacheDaten).filter(Boolean).slice(0, 1000) : [];
}

function peerListe(roh) {
  return Array.isArray(roh) ? roh.filter((wert) => typeof wert === "string").slice(0, 1000) : [];
}

class Watchparty {
  constructor(optionen = {}) {
    this.aufZustand = optionen.onState || (() => {});
    this.aufFortschritt = optionen.onProgress || (() => {});
    this.aufStatus = optionen.onStatus || (() => {});
    this.aufKennung = optionen.onDeviceId || (() => {});
    this.aufIdentitaet = optionen.onDeviceIdentity || (() => {});
    this.aufSteuerung = optionen.onControl || (() => {});
    // Wer steht wo: fuer die Leiste, die zeigt, ob alle beieinander sind.
    this.aufStand = optionen.onWatchstate || (() => {});
    // Die YouTube-Watchparty faehrt auf derselben Leitung, hat aber ihre eigene
    // Logik. Alles, was mit "yt" anfaengt, wird hier nur durchgereicht - dieses
    // Modul weiss nichts davon, was drueben damit geschieht, und drueben nichts
    // von Serien, Folgen und Host.
    this.aufYoutube = optionen.onYoutube || (() => {});
    this.aufChat = optionen.onChat || (() => {});
    // Leitung auf oder zu. Der YouTube-Modus meldet sich danach selbst wieder
    // an und holt den Raumzustand.
    this.aufVerbindung = optionen.onConnection || (() => {});
    this.WebSocketKlasse = optionen.WebSocketKlasse || globalThis.WebSocket;

    this.socket = null;
    this.serverUrl = "";
    this.raum = "";
    this.name = "";
    this.geraetId = "";
    this.deviceSecret = "";
    this.identitaetBestaetigt = false;
    this.unvereinbar = false;
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
    // Eine negative Zeitmarke dient als geordnete Rundlauf-Barriere. Das
    // bestehende Relay reicht t0 unveraendert zurueck; damit ist sicher, dass
    // es alle davor gesendeten Verwaltungsbefehle bereits bearbeitet hat.
    this.barriereNummer = 0;
    this.barrieren = new Map();
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
      // Besitzrechte entscheidet das Relay je Empfaenger. Geheime Konto- oder
      // Geraetenachweise duerfen dafuer niemals im Raumzustand auftauchen.
      mine: eintrag.mine === true
    }));
  }

  istBeigetreten(key) {
    return this.eintraege().some((eintrag) => eintrag.key === key && eintrag.joined);
  }

  konfigurieren({ enabled, serverUrl, room, name, deviceId, deviceSecret, konto }) {
    // Das Konto: alle Geraete einer Person unter einer Kennung. Leer, solange
    // der Geraeteabgleich aus ist - dann entscheidet allein das Geraet, wie
    // bisher.
    const neuesKonto = String(konto || "").slice(0, 64);
    const neuerServer = String(serverUrl || "").trim();
    const neuerRaum = String(room || "").trim();
    const neuerName = String(name || "").slice(0, 40);
    const neueKennung = String(deviceId || "").slice(0, 64);
    const neuerNachweis = /^[A-Za-z0-9_-]{43}$/.test(String(deviceSecret || ""))
      ? String(deviceSecret) : "";
    const gleich = this.serverUrl === neuerServer && this.raum === neuerRaum
      && this.name === neuerName && this.deviceSecret === neuerNachweis
      && this.konto === neuesKonto;

    this.serverUrl = neuerServer;
    this.raum = neuerRaum;
    this.name = neuerName;
    this.geraetId = neueKennung || this.geraetId;
    this.deviceSecret = neuerNachweis;
    this.konto = neuesKonto;
    this.aktiv = Boolean(enabled) && Boolean(neuerServer) && Boolean(neuerRaum);
    if (!gleich) this.unvereinbar = false;

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

    const adresse = this.websocketAdresse();
    if (!istSichereWatchpartyAdresse(adresse)) {
      this.unvereinbar = true;
      this.letzterFehler = "Die Watchparty braucht außerhalb dieses Geräts eine verschlüsselte https://- oder wss://-Adresse";
      this.melde();
      return;
    }

    let socket;
    try {
      socket = new this.WebSocketKlasse(adresse);
    } catch (fehler) {
      this.letzterFehler = String(fehler?.message || fehler);
      this.melde();
      this.spaeterNeuVerbinden();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.verbunden = true;
      this.identitaetBestaetigt = false;
      this.versuche = 0;
      this.senden({
        type: "join",
        room: this.raum,
        name: this.name,
        // Der gespeicherte Wurzelnachweis verlaesst das Geraet nie. Jede
        // Relay-Adresse bekommt ihren eigenen HMAC und kann damit keinen
        // Nachweis gegen ein anderes Relay wiederverwenden.
        deviceProof: geraeteNachweisFuerServer(this.deviceSecret, adresse),
        accountProof: kontoNachweisFuerServer(this.konto, adresse)
      });
      this.melde();
      // Sofort messen: das erste Ereignis kann Millisekunden spaeter kommen,
      // und ohne Versatz steigt der smarte Start auf die alte Stelle ein.
      this.uhrMessen();
      // Die erste Antwort des YouTube-Modus faellt damit noch vor die erste
      // Uhrprobe. Das ist eingeplant: fuer diesen einen Fall schickt das Relay
      // die schon hochgerechnete Stelle mit, und der Fehler ist die Laufzeit
      // der Nachricht statt der Gang zweier Systemuhren.
    };
    socket.onmessage = (ereignis) => this.nachrichtVerarbeiten(ereignis?.data);
    socket.onerror = (ereignis) => {
      this.letzterFehler = String(ereignis?.message || "Verbindung fehlgeschlagen");
    };
    socket.onclose = () => {
      const warBestaetigt = this.identitaetBestaetigt;
      this.verbunden = false;
      this.identitaetBestaetigt = false;
      this.socket = null;
      this.teilnehmer = [];
      if (warBestaetigt) this.aufVerbindung(false);
      this.uhrAnhalten();
      this.uhr = null;
      this.uhrProben = [];
      this.barrieren.clear();
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
    const t0 = nachrichtenZahl(nachricht.t0, NaN);
    const t1 = nachrichtenZahl(nachricht.t1, NaN);
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) return;
    const fertig = this.barrieren.get(t0);
    if (fertig) {
      this.barrieren.delete(t0);
      try { fertig(); } catch {}
      return;
    }
    // Negative Marken gehoeren ausschliesslich zu Barrieren. Eine verspaetete
    // Antwort aus einer abgebrochenen Verbindung oder eine fremde Marke darf
    // weder einen Rueckruf ausloesen noch die Uhrmessung verfaelschen.
    if (t0 < 0) return;
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

  websocketAdresse() {
    return websocketAdresse(this.serverUrl);
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
    this.barrieren.clear();
    const socket = this.socket;
    this.socket = null;
    this.verbunden = false;
    const warBestaetigt = this.identitaetBestaetigt;
    this.identitaetBestaetigt = false;
    this.teilnehmer = [];
    if (!socket) return;
    if (warBestaetigt) this.aufVerbindung(false);
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
    if (!this.aktiv || this.unvereinbar || this.reconnectTimer) return;
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
    if (!nachricht || typeof nachricht !== "object" || Array.isArray(nachricht)) return;

    // Auch ein kompromittiertes Relay darf mit falsch typisierten Feldern
    // keinen Fehler aus dem WebSocket-Ereignis in den Hauptprozess tragen.
    try {

    // Erst der bestaetigte v2-Zustand bindet diese Leitung an die geheime
    // Geraeteidentitaet. Ein altes Relay wuerde die sichtbare Kennung weiterhin
    // ungeprueft annehmen; dagegen darf der neue Client nicht still weiterlaufen.
    if (nachricht.type === "state" && nachricht.identityVersion !== 2) {
      this.unvereinbar = true;
      this.letzterFehler = "Das Watchparty-Relay muss für sichere Geräteidentitäten aktualisiert werden";
      this.melde();
      this.trennen();
      return;
    }

    if (!this.identitaetBestaetigt
      && !["state", "error", "timeack"].includes(nachricht.type)) return;

    // Die YouTube-Watchparty. Sie kommt vor allem anderen und wird nur
    // weitergereicht: ihr Zustand, ihre Ordnung und ihre Entscheidungen liegen
    // vollstaendig woanders. Nichts unterhalb dieser Zeile sieht sie je.
    if (this.identitaetBestaetigt && typeof nachricht.type === "string" && nachricht.type.startsWith("yt")) {
      this.aufYoutube(nachricht);
      return;
    }

    if (nachricht?.type === "error") {
      this.letzterFehler = nachrichtenText(nachricht.message);
      this.melde();
      return;
    }
    // Der Chat geht wie die Uhrprobe an der Zustandsverarbeitung vorbei: er
    // aendert nichts an Raum, Titel oder Stand und darf deshalb auch nie einen
    // Fehler in den Zustand schreiben.
    if (nachricht?.type === "chat") {
      this.aufChat({
        text: nachrichtenText(nachricht.text),
        from: nachrichtenText(nachricht.from, 40),
        deviceId: nachrichtenText(nachricht.deviceId, 64),
        at: nachrichtenZahl(nachricht.at, Date.now()),
        eigen: nachrichtenText(nachricht.deviceId, 64) === this.geraetId
      });
      return;
    }
    if (nachricht?.type === "peers") {
      this.teilnehmer = peerListe(nachricht.peers);
      this.melde();
      return;
    }
    // Die Antwort auf eine Uhrprobe. Sie geht bewusst nicht durch den Block
    // darunter: sie aendert nichts am Zustand und darf nie einen Fehler melden.
    if (nachricht?.type === "timeack") {
      this.uhrAntwort(nachricht);
      return;
    }
      if (nachricht?.type === "state") {
        const kennung = nachrichtenText(nachricht.you, 64);
        if (!kennung || !this.deviceSecret) return;
        const warBestaetigt = this.identitaetBestaetigt;
        this.identitaetBestaetigt = true;
        if (kennung !== this.geraetId) this.geraetId = kennung;
        this.aufKennung(this.geraetId);
        this.aufIdentitaet({ deviceId: this.geraetId, deviceSecret: this.deviceSecret });
        this.geteilt = Array.isArray(nachricht.shared)
          ? nachricht.shared.map(geteilterEintrag).filter(Boolean).slice(0, 1000) : [];
        if (Array.isArray(nachricht.peers)) this.teilnehmer = peerListe(nachricht.peers);
        this.melde();
        this.aufZustand(this.eintraege());
        if (!warBestaetigt) {
          this.warteschlangeSenden();
          this.aufVerbindung(true);
        }
        return;
      }
      if (!this.identitaetBestaetigt) return;
      if ((nachricht?.type === "syncprepare" || nachricht?.type === "syncstart") && nachricht.key) {
        const steuerung = flacheDaten(nachricht);
        if (!steuerung || typeof steuerung.key !== "string") return;
        this.aufSteuerung({ ...steuerung, action: nachricht.type });
        return;
      }
      if (nachricht?.type === "control" && nachricht.key && nachricht.action) {
        const steuerung = flacheDaten(nachricht);
        if (!steuerung || typeof steuerung.key !== "string"
          || typeof steuerung.action !== "string") return;
        this.aufSteuerung(steuerung);
        return;
      }
      // Der Stand je Geraet. Ein aelteres Relay schickt das nicht - dann bleibt
      // die Leiste eben leer, alles andere laeuft unveraendert weiter.
      if (nachricht?.type === "watchstate" && nachricht.key) {
        // Mitgereicht wird auch, wer zuletzt gedrueckt hat. Das ist etwas
        // anderes als "wer steht gerade": zieht ein zweites Geraet die Pause
        // nur mit, bleibt der Ausloeser derselbe. Beide Felder wurden hier
        // frueher weggeworfen - und weiter oben gelesen, wo sie deshalb nie
        // ankamen.
        this.aufStand({
          key: nachrichtenText(nachricht.key, 300),
          tempo: nachrichtenZahl(nachricht.tempo, 1) > 0 ? nachrichtenZahl(nachricht.tempo, 1) : 1,
          members: mitgliederListe(nachricht.members),
          pausedBy: nachrichtenText(nachricht.pausedBy, 40),
          lastAction: flacheDaten(nachricht.lastAction)
        });
        return;
      }
      if (nachricht?.type === "progress" && nachricht.key && nachricht.progress) {
        // Der Fortschritt kommt getrennt vom Zustand. Ohne diese Uebernahme
        // zeigte die Karte weiter den Stand von vorhin - es wirkte, als
        // aktualisiere sich nur alle paar Minuten etwas.
        const key = nachrichtenText(nachricht.key, 300);
        const fortschritt = flacheDaten(nachricht.progress);
        if (!key || !fortschritt) return;
        const eintrag = this.geteilt.find((item) => item.key === key);
        if (eintrag) {
          eintrag.progress = fortschritt;
          if (fortschritt.season) eintrag.season = fortschritt.season;
          if (fortschritt.episode) eintrag.episode = fortschritt.episode;
          this.aufZustand(this.eintraege());
        }
        this.aufFortschritt(key, fortschritt);
      }
    } catch (fehler) {
      this.letzterFehler = String(fehler?.message || fehler);
      console.error("[ELFIX WATCHPARTY] Empfang fehlgeschlagen:", fehler);
      this.melde();
    }
  }

  // Der Ausgang der YouTube-Watchparty. Sie baut ihre Nachrichten selbst; hier
  // wird nur die Leitung geteilt.
  youtubeSenden(nachricht) {
    if (!this.aktiv) return;
    this.senden(nachricht);
  }

  chatSenden(zeile) {
    const text = String(zeile || "").trim().slice(0, 500);
    if (!text) return false;
    this.senden({ type: "chat", text });
    return true;
  }

  /**
   * Einen Titel in die Runde stellen.
   *
   * @param nachtrag `true`, wenn das kein Wunsch des Benutzers ist, sondern
   *        das Nachtragen beim Verbinden. Das Relay laesst einen nachgetragenen
   *        Titel liegen, wenn ihn jemand herausgenommen hat - sonst holte ihn
   *        das naechste Geraet, das sich verbindet, jedes Mal zurueck.
   */
  teilen(item, nachtrag = false) {
    this.senden({ type: "share", item, restore: Boolean(nachtrag) });
  }

  beitreten(key) {
    this.senden({ type: "enter", key });
  }

  // Quittiert nicht einen einzelnen Befehl, sondern die Reihenfolge dieser
  // WebSocket-Verbindung: Trifft die passende timeack-Antwort ein, hat das
  // Relay jeden davor gesendeten Share/Enter verarbeitet und jeden daraus
  // entstandenen Zustand bereits auf denselben Socket geschrieben. So lassen
  // sich auch absichtlich verworfene Nachtraege (Grabstein, geloeschter Titel)
  // eindeutig von einem Verbindungsabbruch unterscheiden, ohne einen Timeout.
  barriere(fertig) {
    if (!this.verbunden || !this.identitaetBestaetigt || !this.socket
      || this.socket.readyState !== 1 || typeof fertig !== "function") return false;
    this.barriereNummer = (this.barriereNummer % 1000000) + 1;
    const marke = -this.barriereNummer;
    this.barrieren.set(marke, fertig);
    try {
      this.socket.send(JSON.stringify({ type: "time", t0: marke }));
      return true;
    } catch {
      this.barrieren.delete(marke);
      return false;
    }
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

  // Tempo und Fassung tragen keinen Ort, sondern eine Einstellung. Sie reisen
  // deshalb als eigene Felder mit - das Relay nimmt nur die an, die es kennt,
  // und nur vom Host.
  steuernMitEinstellung(key, action, position, url, einstellung = {}) {
    if (!this.aktiv || !key || !this.istBeigetreten(key)) return;
    this.senden({ type: "control", key, action, position, url, ...einstellung });
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

  bereitZumStart(key, syncId) {
    this.senden({ type: "syncready", key, syncId: String(syncId || "") });
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
    if (!this.identitaetBestaetigt && !["join", "time"].includes(nachricht?.type)) return;
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

// http(s)-Adressen bequem eintippen koennen - verbunden wird ueber ws(s).
// Steht modulweit, weil der Geraeteabgleich zum selben Relay faehrt: zwei
// Auslegungen derselben Adresse waeren zwei Fehlerquellen.
function websocketAdresse(wert) {
  const roh = serverNormalisieren(wert);
  if (/^wss?:\/\//i.test(roh)) return roh;
  if (/^https:\/\//i.test(roh)) return roh.replace(/^https:/i, "wss:");
  if (/^http:\/\//i.test(roh)) return roh.replace(/^http:/i, "ws:");
  return `wss://${roh}`;
}

function istSichereWatchpartyAdresse(wert) {
  try {
    const adresse = new URL(String(wert || ""));
    if (adresse.protocol === "wss:") return true;
    if (adresse.protocol !== "ws:") return false;
    const host = adresse.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
  } catch {
    return false;
  }
}

function geraeteNachweisFuerServer(deviceSecret, wert) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(deviceSecret || ""))) return "";
  return serverGebundenerNachweis(deviceSecret, wert, "device");
}

function kontoNachweisFuerServer(konto, wert) {
  if (!/^[0-9a-f]{32}$/.test(String(konto || ""))) return "";
  return serverGebundenerNachweis(konto, wert, "account");
}

function serverGebundenerNachweis(geheimnis, wert, art) {
  let adresse;
  try {
    adresse = new URL(websocketAdresse(wert));
  } catch {
    return "";
  }
  const gebunden = `elfix-watchparty-${art}-v2\0${adresse.href}`;
  return crypto.createHmac("sha256", geheimnis).update(gebunden, "utf8").digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Die Adresse so, wie sie gespeichert gehoert.
//
// Sie steht an drei Stellen - Rechner, Telefon, Fernseher - und wurde an jeder
// ein bisschen anders behandelt. Was am Fernseher eingetippt wird, kommt mit
// Leerzeichen aus der Bildschirmtastatur und gern mit einem Schraegstrich am
// Ende; beides ergibt eine andere Zeichenkette und damit einen unnoetigen
// Neuaufbau der Verbindung, obwohl dasselbe Relay gemeint ist.
//
// Bewusst *ohne* Ergaenzung eines Protokolls: was jemand eintippt, bleibt
// stehen. `websocketAdresse` weiss, wie daraus ws(s) wird.
function serverNormalisieren(wert) {
  return String(wert === undefined || wert === null ? "" : wert)
    .trim()
    // Was aus einer Fernbedienungstastatur kommt, traegt gern unsichtbare
    // Zeichen mit - die machen aus einer richtigen Adresse eine falsche.
    .replace(/[\u0000-\u001f\u007f\u00a0\u200b-\u200f\ufeff]/g, "")
    // Nur die Schraegstriche am Ende des Pfades. Die des Protokolls bleiben
    // stehen: aus "https://" ein "https:/" zu machen war der kuerzeste Weg zu
    // einer Beanstandung, die vom falschen Fehler spricht.
    .replace(/([^:/])\/+$/, "$1");
}

/**
 * Was an einer eingetippten Serveradresse nicht stimmt.
 *
 * <p>Derselbe Wortlaut auf allen Geraeten, und dieselbe Strenge - nach dem
 * Vorbild von {@code codeBeanstandung}. Eine leere Eingabe ist ausdruecklich
 * *keine* Beanstandung: sie heisst "keine Adresse", und dann bleibt die
 * Watchparty eben aus. Wer sie loeschen will, soll das koennen.
 *
 * @return leer, wenn sie in Ordnung ist, sonst die Beanstandung im Klartext
 */
function serverBeanstandung(wert) {
  const sauber = serverNormalisieren(wert);
  if (!sauber) return "";
  if (/\s/.test(sauber)) return "Eine Adresse enthält keine Leerzeichen";
  if (!/^[a-z]+:\/\//i.test(sauber)) {
    return "Die Adresse braucht ein Protokoll — http:// oder https://";
  }
  if (!/^(https?|wss?):\/\//i.test(sauber)) {
    return "Erlaubt sind http://, https://, ws:// und wss://";
  }
  // Der Port zuerst, und zwar an der eingetippten Zeichenkette. `new URL`
  // raeumt ihn naemlich auf: aus "relay.example.org:" wird dort klaglos
  // "relay.example.org", und der haengende Doppelpunkt - der immer ein
  // Vertipper ist - kaeme nie zur Sprache.
  const autoritaet = sauber.replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0];
  // Gesucht wird hinter der letzten Klammer, damit eine IPv6-Adresse nicht in
  // ihre eigenen Doppelpunkte laeuft: [::1]:8787.
  const doppelpunkt = autoritaet.lastIndexOf(":");
  if (doppelpunkt > autoritaet.lastIndexOf("]")) {
    const port = autoritaet.slice(doppelpunkt + 1);
    if (!port) return "Der Port fehlt hinter dem Doppelpunkt";
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      return "Der Port muss eine Zahl zwischen 1 und 65535 sein";
    }
  }
  let zerlegt = null;
  try {
    zerlegt = new URL(sauber);
  } catch (_) {
    return "Die Adresse ist unvollständig";
  }
  if (!zerlegt.hostname) return "Der Adresse fehlt der Rechnername";
  return "";
}

module.exports = {
  Watchparty,
  websocketAdresse,
  serverNormalisieren,
  serverBeanstandung,
  istSichereWatchpartyAdresse,
  geraeteNachweisFuerServer,
  kontoNachweisFuerServer
};
