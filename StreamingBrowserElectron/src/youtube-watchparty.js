"use strict";

// Die YouTube-Watchparty auf der Seite der App.
//
// Sie ist die Gegenstelle zu sync-server/youtube-party.js und haelt genau das,
// was der Raum gerade zeigt: welches Video, wo, ob es laeuft, unter welcher
// Revision und wer es zuletzt bewegt hat. Was daraus fuer den Player folgt,
// entscheidet sie nicht - das steht in youtube-sync.js, und ausgefuehrt wird es
// im Hauptprozess, der als Einziger an die Anbieteransicht kommt.
//
// Von der Serien-Watchparty uebernimmt sie nichts ausser der Leitung: die
// WebSocket-Verbindung, den Raumcode, die Geraetekennung, den Wiederaufbau nach
// einem Abriss und den gemessenen Uhrversatz. Alles, was mit Titeln, Folgen,
// Host und Fortschritt zu tun hat, bleibt drueben - und umgekehrt kennt drueben
// niemand diesen Zustand.
//
// Genau ein Raum zur Zeit. Es gibt einen YouTube-Player, und zwei Runden
// gleichzeitig mitzunehmen hiesse, ihn zwei Videos gleichzeitig zeigen zu
// lassen. Wer die Runde wechselt, verlaesst die alte.

const youtubeSync = require("./youtube-sync");

class YoutubeWatchparty {
  constructor(optionen = {}) {
    // Der Raumzustand hat sich geaendert und der Hauptprozess soll ihn auf den
    // Player bringen: (zustand, hinweis).
    this.aufZustand = optionen.onState || (() => {});
    this.aufStatus = optionen.onStatus || (() => {});
    // Eine Nachricht an das Relay, in den Raum: (raum, nachricht).
    this.hinaus = optionen.senden || (() => {});
    // Die Serverzeit dieses Raums in Millisekunden - oder null, wenn kein
    // belastbarer Uhrversatz vorliegt.
    this.serverJetzt = optionen.serverJetzt || (() => null);

    this.raum = "";
    this.geraetId = "";
    this.verbunden = false;
    this.beigetreten = false;
    this.fehler = "";
    // Der aktuelle Raumzustand, schon auf eine einheitliche Zeitbasis gebracht.
    this.stand = null;
    // Die Ordnung, wie sie das Relay geschickt hat - roh, damit der Vergleich
    // nicht zwischen Server- und Geraetezeit springt.
    this.ordnung = null;
    this.mitglieder = [];
  }

  get aktiv() {
    return Boolean(this.raum);
  }

  status() {
    return {
      enabled: this.aktiv,
      room: this.raum,
      connected: this.verbunden,
      joined: this.beigetreten,
      error: this.fehler,
      members: this.mitglieder,
      me: this.geraetId,
      video: this.stand
        ? {
          videoId: this.stand.videoId,
          url: this.stand.url,
          title: this.stand.title,
          playing: this.stand.playing,
          position: this.jetztPosition(),
          by: this.stand.byName
        }
        : null
    };
  }

  // Wo die Runde in diesem Augenblick steht. Fuer die Oberflaeche - der Player
  // rechnet in seinem eigenen Rahmen noch einmal nach.
  jetztPosition() {
    if (!this.stand) return 0;
    return youtubeSync.zielPosition(this.stand, Date.now() + (this.stand.versatz || 0));
  }

  kennung(geraetId) {
    this.geraetId = String(geraetId || "").slice(0, 64);
  }

  // Den YouTube-Modus fuer einen Raum einschalten. Ein anderer Raum wird dabei
  // ordentlich verlassen, nicht einfach stehengelassen.
  einschalten(room) {
    const code = String(room || "").trim();
    if (!code) return this.ausschalten();
    if (code === this.raum) return;
    if (this.raum) this.hinaus(this.raum, { type: "ytleave" });
    this.raum = code;
    // Ob die Leitung steht, sagt gleich darauf `verbindung` - und erst dort
    // wird angemeldet. Sonst ginge das "ytjoin" ins Leere.
    this.verbunden = false;
    this.beigetreten = false;
    this.stand = null;
    this.ordnung = null;
    this.mitglieder = [];
    this.fehler = "";
    this.melde();
  }

  ausschalten() {
    if (!this.raum) return;
    this.hinaus(this.raum, { type: "ytleave" });
    this.raum = "";
    this.verbunden = false;
    this.beigetreten = false;
    this.stand = null;
    this.ordnung = null;
    this.mitglieder = [];
    this.fehler = "";
    this.melde();
  }

  beitreten() {
    if (!this.raum) return;
    this.hinaus(this.raum, { type: "ytjoin" });
  }

  // Den ganzen Stand neu anfordern. Nach einem Verbindungsabriss ist das der
  // einzige richtige Weg: fragen, was gilt - und nichts nachreichen, was hier
  // in der Zwischenzeit passiert ist.
  anfordern() {
    if (!this.raum || !this.verbunden) return;
    this.hinaus(this.raum, { type: "ytsync" });
  }

  // Die Verbindung dieses Raums ist auf- oder abgegangen.
  verbindung(room, offen) {
    const code = String(room || "").trim();
    if (!this.raum || code !== this.raum) return;
    const vorher = this.verbunden;
    this.verbunden = Boolean(offen);
    if (!this.verbunden) {
      this.beigetreten = false;
    } else if (!vorher || !this.beigetreten) {
      // Neu anmelden statt nur nachfragen: nach einem Abriss weiss das Relay
      // nichts mehr von diesem Geraet. Steht die Anmeldung schon, passiert
      // hier nichts - dieser Aufruf kommt bei jeder Statusmeldung vorbei.
      this.beitreten();
    }
    this.melde();
  }

  // Eine Nachricht des Relays. Rueckgabe sagt, ob sie zu diesem Modus gehoerte.
  nachricht(nachricht) {
    const art = String(nachricht?.type || "");
    if (!art.startsWith("yt")) return false;
    const code = String(nachricht.room || "").trim();
    // Eine Nachricht aus einem Raum, in dem der YouTube-Modus hier nicht laeuft,
    // wird nicht angewendet - sonst zoege ein fremder Raum diesen Player mit.
    if (!this.raum || (code && code !== this.raum)) return true;

    if (art === "yterror") {
      this.fehler = String(nachricht.message || "");
      this.melde();
      return true;
    }
    if (art !== "ytstate" && art !== "ytevent") return true;

    this.fehler = "";
    this.mitglieder = Array.isArray(nachricht.members) ? nachricht.members : [];
    this.beigetreten = this.mitglieder.some((person) => person && person.id === this.geraetId);

    // Die Ordnung wird auf den rohen Angaben des Relays geprueft. Ein
    // Nachzuegler darf einen neueren Stand nie ueberschreiben.
    const roh = { rev: Number(nachricht.rev) || 0, updatedAt: Number(nachricht.updatedAt) || 0 };
    if (youtubeSync.istVeraltet(this.ordnung, roh)) {
      this.melde();
      return true;
    }

    const vorher = this.stand;
    const neu = this.normalisieren(nachricht);
    this.ordnung = roh;
    this.stand = neu;

    const selbst = Boolean(this.geraetId) && neu.byId === this.geraetId;
    const anwenden = youtubeSync.brauchtAnwendung(vorher, neu, this.geraetId);
    const videowechsel = Boolean(neu.videoId) && (!vorher || vorher.videoId !== neu.videoId);

    this.melde();
    this.aufZustand(neu, {
      room: this.raum,
      action: art === "ytevent" ? String(nachricht.action || "") : "",
      reason: String(nachricht.reason || ""),
      selbst,
      anwenden,
      videowechsel
    });
    return true;
  }

  // Server- und Geraetezeit sauber auseinanderhalten.
  //
  // Liegt ein gemessener Uhrversatz vor, wird mit der Serverzeit gerechnet -
  // das ist die genaue Rechnung und haelt auch dann, wenn die Nachricht Minuten
  // alt ist. Fehlt er, zaehlt die vom Relay beim Absenden hochgerechnete
  // Stelle, gestempelt mit der eigenen Uhr beim Empfang: dann ist der Fehler
  // die Laufzeit der Nachricht statt der Gang zweier Systemuhren.
  normalisieren(nachricht) {
    const serverJetzt = this.serverJetzt(this.raum);
    const versatz = Number.isFinite(serverJetzt) ? serverJetzt - Date.now() : null;
    const stempel = Number(nachricht.updatedAt) || 0;
    const mitServerzeit = versatz !== null && stempel > 0;
    return {
      videoId: String(nachricht.videoId || ""),
      url: String(nachricht.url || ""),
      title: String(nachricht.title || ""),
      playing: Boolean(nachricht.playing),
      rev: Number(nachricht.rev) || 0,
      byId: String(nachricht.byId || ""),
      byName: String(nachricht.byName || ""),
      position: mitServerzeit
        ? Number(nachricht.position) || 0
        : Number(nachricht.livePosition ?? nachricht.position) || 0,
      updatedAt: mitServerzeit ? stempel : Date.now(),
      versatz: mitServerzeit ? versatz : 0,
      zeitbasis: mitServerzeit ? "server" : "lokal",
      empfangen: Date.now()
    };
  }

  // Eine eigene Tat an die Runde. Sie wird hier nicht vorweggenommen: was gilt,
  // sagt das Relay - der eigene Zug kommt gleich mit seiner Nummer zurueck.
  melden(action, daten = {}) {
    if (!this.raum || !this.verbunden || !this.beigetreten) return false;
    const videoId = String(daten.videoId || "");
    if (!videoId) return false;
    // Steuerbefehle gelten nur fuer das Video, das die Runde gerade zeigt. Wer
    // noch beim vorigen steht, haelt damit nicht das neue an.
    if (action !== "video" && this.stand && this.stand.videoId && this.stand.videoId !== videoId) {
      return false;
    }
    const nachricht = {
      type: "ytevent",
      action,
      videoId,
      position: Math.max(0, Number(daten.position) || 0)
    };
    if (daten.url) nachricht.url = String(daten.url);
    if (daten.title) nachricht.title = String(daten.title).slice(0, 200);
    if (typeof daten.playing === "boolean") nachricht.playing = daten.playing;
    this.hinaus(this.raum, nachricht);
    return true;
  }

  melde() {
    this.aufStatus(this.status());
  }
}

module.exports = { YoutubeWatchparty };
