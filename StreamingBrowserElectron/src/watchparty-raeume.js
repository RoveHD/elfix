"use strict";

// Mehrere Watchpartys nebeneinander.
//
// Ein Raum ist eine Verbindung. Wer mit der Familie und getrennt davon mit
// Freunden schaut, braucht zwei - also fuehrt diese Fassade je Raumcode eine
// eigene Watchparty und laesst den Rest der App weiterarbeiten, als gaebe es
// nur eine: die Eintraege aller Raeume kommen zusammengelegt heraus, jeder mit
// seinem Raum daran.
//
// Verwaltendes (einstellen, beitreten, herausnehmen, rauswerfen) geht an genau
// einen Raum. Alles rund ums Schauen (Fortschritt, Pause, Springen, Abgleich)
// geht an jeden Raum, in dem dieser Titel beigetreten ist - schaut man
// dieselbe Serie in zwei Raeumen mit, laeuft beides mit.

const crypto = require("crypto");
const { Watchparty } = require("./watchparty");

class WatchpartyRaeume {
  constructor(optionen = {}) {
    this.aufZustand = optionen.onState || (() => {});
    this.aufFortschritt = optionen.onProgress || (() => {});
    this.aufStatus = optionen.onStatus || (() => {});
    this.aufKennung = optionen.onDeviceId || (() => {});
    this.aufSteuerung = optionen.onControl || (() => {});
    this.aufStand = optionen.onWatchstate || (() => {});
    // Durchreiche fuer die YouTube-Watchparty: sie faehrt auf denselben
    // Verbindungen, fuehrt aber ihren Zustand selbst.
    this.aufYoutube = optionen.onYoutube || (() => {});
    this.aufVerbindung = optionen.onConnection || (() => {});
    this.WebSocketKlasse = optionen.WebSocketKlasse;

    this.raeume = new Map();
    this.serverUrl = "";
    this.name = "";
    this.geraetId = "";
    this.eingeschaltet = false;
  }

  // "aktiv" und "verbunden" gab es an der einzelnen Watchparty als Felder. Als
  // Getter bleiben die Abfragen im Rest der App unveraendert.
  get aktiv() {
    return this.eingeschaltet && this.raeume.size > 0;
  }

  get verbunden() {
    return [...this.raeume.values()].some((raum) => raum.verbunden);
  }

  get codes() {
    return [...this.raeume.keys()];
  }

  konfigurieren({ enabled, serverUrl, rooms, room, name, deviceId }) {
    this.serverUrl = String(serverUrl || "").trim();
    this.name = String(name || "").slice(0, 40);
    this.eingeschaltet = Boolean(enabled) && Boolean(this.serverUrl);

    // Alle Raeume brauchen dieselbe Kennung. Ohne eigene holt sich jede
    // Verbindung eine vom Relay - und zwar jede eine andere. Dann gilt man in
    // einem Raum als dabei und im naechsten als fremdes Geraet: der Beitritt
    // im einen Raum warf einen aus dem anderen. Also lieber hier eine
    // erzeugen und einmal nach oben melden, damit sie erhalten bleibt.
    const gewuenschteKennung = String(deviceId || "").slice(0, 64);
    if (gewuenschteKennung) {
      this.geraetId = gewuenschteKennung;
    } else if (!this.geraetId) {
      this.geraetId = crypto.randomUUID();
      this.aufKennung(this.geraetId);
    }

    const gewuenscht = raumcodesAufraeumen(rooms?.length ? rooms : [room]);

    for (const code of this.raeume.keys()) {
      if (gewuenscht.includes(code)) continue;
      this.raeume.get(code).konfigurieren({ enabled: false, serverUrl: "", room: "", name: "" });
      this.raeume.delete(code);
    }

    for (const code of gewuenscht) {
      let raum = this.raeume.get(code);
      if (!raum) {
        raum = this.raumAnlegen(code);
        this.raeume.set(code, raum);
      }
      raum.konfigurieren({
        enabled: this.eingeschaltet,
        serverUrl: this.serverUrl,
        room: code,
        name: this.name,
        deviceId: this.geraetId
      });
    }

    this.melde();
    this.aufZustand(this.eintraege(), "");
  }

  raumAnlegen(code) {
    const optionen = {
      onState: () => {
        this.aufZustand(this.eintraege(), code);
      },
      onProgress: (key, fortschritt) => this.aufFortschritt(key, fortschritt, code),
      onControl: (nachricht) => this.aufSteuerung({ ...nachricht, room: code }),
      onWatchstate: (nachricht) => this.aufStand({ ...nachricht, room: code }),
      // Der Raumcode gehoert an die Nachricht: die YouTube-Watchparty laeuft in
      // genau einem Raum und muss fremde Raeume erkennen und liegenlassen.
      onYoutube: (nachricht) => this.aufYoutube({ ...nachricht, room: nachricht.room || code }),
      onConnection: (offen) => this.aufVerbindung(code, offen),
      onStatus: () => this.melde(code),
      onDeviceId: (kennung) => this.kennungUebernehmen(kennung, code)
    };
    if (this.WebSocketKlasse) optionen.WebSocketKlasse = this.WebSocketKlasse;
    return new Watchparty(optionen);
  }

  // Vergibt ein Raum eine Kennung, gilt sie fuer dieses Geraet insgesamt -
  // sonst zaehlt dasselbe Geraet in jedem Raum als jemand anderes.
  kennungUebernehmen(kennung, herkunft) {
    if (!kennung || kennung === this.geraetId) return;
    this.geraetId = kennung;
    this.aufKennung(kennung);
    for (const [code, raum] of this.raeume) {
      if (code === herkunft || raum.geraetId === kennung) continue;
      raum.konfigurieren({
        enabled: this.eingeschaltet,
        serverUrl: this.serverUrl,
        room: code,
        name: this.name,
        deviceId: kennung
      });
    }
  }

  status() {
    const raeume = [...this.raeume.values()].map((raum) => raum.status());
    const namen = [];
    for (const raum of raeume) {
      for (const peer of raum.peers || []) {
        if (!namen.includes(peer)) namen.push(peer);
      }
    }
    return {
      enabled: this.eingeschaltet,
      connected: raeume.some((raum) => raum.connected),
      // Zusammengefasst fuer alles, was nur wissen will, ob es laeuft; die
      // Aufschluesselung steht in "rooms".
      room: raeume.map((raum) => raum.room).join(", "),
      rooms: raeume,
      peers: namen,
      error: raeume.find((raum) => !raum.connected && raum.error)?.error || ""
    };
  }

  eintraege() {
    const alle = [];
    for (const [code, raum] of this.raeume) {
      for (const eintrag of raum.eintraege()) alle.push({ ...eintrag, room: code });
    }
    return alle;
  }

  istBeigetreten(key) {
    return [...this.raeume.values()].some((raum) => raum.istBeigetreten(key));
  }

  // Der Raum, an den eine Verwaltungsaktion geht: der genannte, sonst der, der
  // den Titel ueberhaupt kennt, sonst der einzige vorhandene.
  raumFuer(key, room) {
    const code = String(room || "").trim();
    if (code && this.raeume.has(code)) return this.raeume.get(code);
    if (key) {
      for (const raum of this.raeume.values()) {
        if (raum.geteilt.some((eintrag) => eintrag.key === key)) return raum;
      }
    }
    if (this.raeume.size === 1) return [...this.raeume.values()][0];
    return null;
  }

  // Zum Einstellen zaehlt nur der ausdruecklich genannte Raum - bei mehreren
  // waere jede Vorauswahl geraten. Gibt es nur einen, ist sie eindeutig.
  raumZumTeilen(room) {
    const code = String(room || "").trim();
    if (code) return this.raeume.get(code) || null;
    if (this.raeume.size === 1) return [...this.raeume.values()][0];
    return null;
  }

  // Alle Raeume, in denen dieser Titel mitlaeuft - oder nur der genannte, wenn
  // die Antwort dorthin gehoert, woher die Nachricht kam.
  raeumeMitTitel(key, room) {
    const code = String(room || "").trim();
    const passend = [...this.raeume.values()].filter((raum) => raum.istBeigetreten(key));
    if (!code) return passend;
    return passend.filter((raum) => raum.raum === code);
  }

  teilen(item, room) {
    const raum = this.raumZumTeilen(room);
    if (!raum) return false;
    raum.teilen(item);
    return true;
  }

  beitreten(key, room) {
    this.raumFuer(key, room)?.beitreten(key);
  }

  verlassen(key, room) {
    this.raumFuer(key, room)?.verlassen(key);
  }

  entfernen(key, room) {
    this.raumFuer(key, room)?.entfernen(key);
  }

  hostUebergeben(key, memberId, room) {
    this.raumFuer(key, room)?.hostUebergeben(key, memberId);
  }

  rauswerfen(key, memberId, room) {
    this.raumFuer(key, room)?.rauswerfen(key, memberId);
  }

  steuern(key, action, position, room) {
    for (const raum of this.raeumeMitTitel(key, room)) raum.steuern(key, action, position);
  }

  steuernMitAdresse(key, action, position, url, room) {
    for (const raum of this.raeumeMitTitel(key, room)) raum.steuernMitAdresse(key, action, position, url);
  }

  meldeStand(key, stand, room) {
    for (const raum of this.raeumeMitTitel(key, room)) raum.meldeStand(key, stand);
  }

  verlasseStand(key, room) {
    for (const raum of this.raeumeMitTitel(key, room)) raum.verlasseStand(key);
  }

  abgleichen(key, room) {
    for (const raum of this.raeumeMitTitel(key, room)) raum.abgleichen(key);
  }

  gleichziehen(key, position, room) {
    for (const raum of this.raeumeMitTitel(key, room)) raum.gleichziehen(key, position);
  }

  bereitZumStart(key, room) {
    for (const raum of this.raeumeMitTitel(key, room)) raum.bereitZumStart(key);
  }

  fortschrittMelden(key, fortschritt, room) {
    for (const raum of this.raeumeMitTitel(key, room)) raum.fortschrittMelden(key, fortschritt);
  }

  // Eine Nachricht der YouTube-Watchparty in genau einen Raum. Gibt es ihn hier
  // nicht, geht nichts hinaus - lieber keine Nachricht als eine in den falschen
  // Raum.
  youtubeSenden(room, nachricht) {
    this.raeume.get(String(room || "").trim())?.youtubeSenden(nachricht);
  }

  // Die Serverzeit des Raums, aus dem eine Nachricht kam. Jeder Raum ist eine
  // eigene Verbindung und misst seinen Uhrversatz selbst - auch wenn dahinter
  // dasselbe Relay steht, ist das die ehrlichere Angabe.
  serverJetzt(room) {
    const raum = this.raeume.get(String(room || "").trim());
    if (raum) return raum.serverJetzt();
    // Ohne Raumangabe zaehlt die beste vorhandene Messung.
    let beste = null;
    for (const kandidat of this.raeume.values()) {
      const stand = kandidat.uhrStand();
      if (stand && (!beste || stand.umlauf < beste.umlauf)) beste = { ...stand, raum: kandidat };
    }
    return beste ? beste.raum.serverJetzt() : null;
  }

  uhrStand(room) {
    return this.raeume.get(String(room || "").trim())?.uhrStand() || null;
  }

  trennen() {
    for (const raum of this.raeume.values()) raum.trennen();
  }

  melde(code = "") {
    this.aufStatus(this.status(), code);
  }
}

// Codes koennen aus einem Textfeld kommen: Leerzeichen weg, Doppelte weg,
// Reihenfolge bleibt. Umlaute werden zusammengezogen (NFC) - je nach Tastatur
// kommt "ä" als ein Zeichen oder als a mit Trema, und das Relay fuehrt sonst
// zwei verschiedene Raeume.
function raumcodesAufraeumen(codes) {
  const sauber = [];
  for (const roh of Array.isArray(codes) ? codes : [codes]) {
    const code = String(roh || "").trim().normalize("NFC").slice(0, 64);
    if (!code || sauber.includes(code)) continue;
    sauber.push(code);
  }
  return sauber;
}

// Dieselbe Regel wie im Relay. Wird sie hier schon geprueft, steht die
// Begruendung beim Eintragen statt spaeter als "Ungueltiger Raumcode".
function codeBeanstandung(code) {
  const sauber = String(code || "").trim().normalize("NFC");
  if (sauber.length < 4) return "Ein Raumcode braucht mindestens vier Zeichen";
  if (sauber.length > 64) return "Ein Raumcode darf höchstens 64 Zeichen haben";
  if (!/^[\p{L}\p{N}_-]+$/u.test(sauber)) {
    return "Erlaubt sind Buchstaben, Ziffern, Bindestrich und Unterstrich — keine Leerzeichen";
  }
  return "";
}

module.exports = { WatchpartyRaeume, raumcodesAufraeumen, codeBeanstandung };
