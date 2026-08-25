"use strict";

// Meine Geraete - die Verbindung.
//
// Die Watchparty ist eine Verabredung zwischen Menschen: einstellen, beitreten,
// zusammen schauen. Hier gibt es nichts zu verabreden. Wer denselben Schluessel
// traegt, ist dieselbe Person, und ihre Geraete sollen denselben Stand haben -
// mehr ist es nicht.
//
// Deshalb eine eigene Verbindung und nicht die der Watchparty. Beides haengt
// zwar am selben Relay, aber nicht am selben Schalter: die Watchparty ist
// ausgeschaltet, solange niemand mit anderen schaut, und die eigenen Geraete
// sollen trotzdem zusammenbleiben.
//
// Was hinausgeht, ist verschlossen (siehe geraete-schluessel.js). Dieses Modul
// entscheidet nur, *wann* etwas hinausgeht und *was* dabei gewinnt:
//
//   - Hinaus geht ein Eintrag, wenn sich sein Stand wirklich geaendert hat.
//     Gemessen am Spiegel - dem, was zuletzt hinausging oder hereinkam. Ohne
//     ihn liefe der Abgleich im Kreis.
//   - Herein kommt ein Eintrag, wenn er neuer ist als der Spiegel. Der aeltere
//     Stand ueberschreibt nie den neueren; das gilt hier wie in der Watchparty.
//   - Geloeschtes hinterlaesst einen Grabstein. Ohne ihn holte das andere
//     Geraet den Titel beim naechsten Abgleich zurueck.
//
// Das Modul kennt weder Electron noch die Ablage der Favoriten: es bekommt beim
// Start Rueckrufe und ist dadurch ohne laufende App pruefbar.

const schluesselModul = require("./geraete-schluessel");
const { websocketAdresse } = require("./watchparty");
const { versatzAusProben } = require("./watchparty-sync");

// Woran eine Sitzung zu erkennen ist. Sie faehrt durch denselben Kanal wie die
// Staende - fuer das Relay ist beides derselbe verschlossene Klumpen -, und der
// Schluessel ist das Einzige, was sie hier auseinanderhaelt.
const SITZUNG_PRAEFIX = "sitzung:";

const RECONNECT_MIN_MS = 2000;
const RECONNECT_MAX_MS = 60000;
// So viel geht in einem Schub hinaus. Danach wird auf die Bestaetigung
// gewartet - ein Geraet, das nach einer Woche zweihundert Eintraege nachtraegt,
// soll dem Relay nicht alles auf einmal vor die Fuesse werfen.
const SCHUB = 25;
const MAX_SCHUB_ZEICHEN = 100 * 1024;
// Der Uhrabgleich wie bei der Watchparty: die Zeitstempel entscheiden, welcher
// Stand gewinnt, und zwei Rechner sind sich darueber selten einig. Gerechnet
// wird deshalb in der Zeit des Relays.
const UHR_PROBEN = 5;
const UHR_ABSTAND_MS = 120;
const UHR_AUFFRISCHEN_MS = 60000;
const UHR_HALTBAR_MS = 300000;
// Bis hierher ist eine leere Liste ein Aufraeumen, darueber ein Verlust.
// Bewusst klein: drei Titel loescht jemand von Hand, zweihundert nicht.
const VERLUST_GRENZE = 3;

class Geraeteabgleich {
  constructor(optionen = {}) {
    // Ein hereingekommener Stand. Zurueck kommt der Stand, wie er hier
    // tatsaechlich gilt - oder etwas Falsches, wenn dieses Geraet nichts damit
    // anfangen konnte (kein Anbieter dafuer).
    //
    // Warum nicht bloss true: nicht jedes Geraet schreibt denselben Stand. Die
    // Adresse ist auf jedem eine andere - S.to laeuft hier ueber eine IP, dort
    // ueber die Domain -, und der Titel geht durch die eigene Saeuberung. Wer
    // sich das Empfangene merkt, statt das daraus Gewordene, faende beim
    // naechsten Takt einen Unterschied, meldete ihn hinaus, drueben ebenso -
    // und die beiden Geraete schoeben sich denselben Eintrag ewig hin und her.
    this.aufEintrag = optionen.onEintrag || (() => null);
    // Eine Wiedergabesitzung von einem anderen Geraet. Sie ist ein anderer Fall
    // als ein Stand: ein Stand aendert sich, eine abgeschlossene Sitzung nie.
    // Deshalb wird hier nichts verglichen und nichts ueberschrieben - sie kommt
    // dazu oder sie ist schon da.
    this.aufSitzung = optionen.onSitzung || (() => false);
    // Anderswo geloescht. Bekommt den Titelschluessel, nicht die Kennung des
    // Relays - der Rest der App kennt nur den.
    this.aufWeg = optionen.onWeg || (() => false);
    // Ein Schub ist durch. Erst hier wird geschrieben: beim ersten Abgleich
    // kommen leicht zweihundert Eintraege auf einmal herein, und je Eintrag
    // einmal die ganze Ablage zu schreiben, waere zweihundertmal dieselbe
    // Datei.
    this.aufFertig = optionen.onFertig || (() => {});
    this.aufStatus = optionen.onStatus || (() => {});
    // Spiegel und Nummer haben sich geaendert; sie gehoeren auf die Platte,
    // sonst faengt jeder Start von vorn an.
    this.aufSpeichern = optionen.onSpeichern || (() => {});
    this.WebSocketKlasse = optionen.WebSocketKlasse || globalThis.WebSocket;

    this.socket = null;
    this.serverUrl = "";
    this.schluessel = "";
    this.abgeleitet = null;
    this.geraetId = "";
    this.aktiv = false;
    this.verbunden = false;
    this.letzterFehler = "";
    this.versuche = 0;
    this.reconnectTimer = 0;
    this.nachschubTimer = 0;
    // id -> { at, hash, key, art }
    this.spiegel = new Map();
    // Welche Schluessel der Spiegel kennt. Ohne dieses Verzeichnis muesste der
    // Rest der App fuer jede Sitzung einen HMAC rechnen lassen, nur um zu
    // fragen "kennst du die schon?" - bei ein paar tausend Saetzen im
    // Sekundentakt.
    this.nachKey = new Set();
    // Was gerade hinausgeht und noch nicht bestaetigt ist. Nur damit dieselbe
    // Sitzung nicht zweimal in derselben Runde losgeschickt wird; geht eine
    // Nachricht unterwegs verloren, bietet der naechste Takt sie ohnehin
    // wieder an.
    this.unterwegs = new Set();
    // id -> { at, key } fuer alles, was noch auf seine Bestaetigung wartet.
    this.warteAuf = new Map();
    this.eigeneSitzungen = [];
    // Bis hierher kennt dieses Geraet den Raum. Das Relay vergibt die Nummern;
    // sie sind das Einzige, woran sich "was fehlt mir noch?" verlaesslich
    // ablesen laesst.
    this.nr = 0;
    this.offen = false;
    this.nachholen = false;
    this.letzterAbgleich = 0;
    this.uhr = null;
    this.uhrProben = [];
    this.uhrTimer = 0;
    this.uhrAuffrischen = 0;
    this.eigeneStaende = null;
    // Wie oft von aussen etwas hereingekommen ist. Nicht die Zahl der
    // Eintraege, sondern die Zahl der Aenderungen - sie sagt nur, ob sich seit
    // einem bestimmten Augenblick etwas getan hat.
    //
    // Gebraucht wird sie fuer eine einzige Frage, an der sonst ein Bestand
    // haengt: ist die Liste, die der Rest der App zuletzt hereingereicht hat,
    // juenger als das zuletzt Empfangene? Ist sie es nicht, weiss sie von den
    // eben angekommenen Eintraegen nichts - und was sie nicht kennt, duerfte
    // hier sonst als "hier geloescht" hinausgehen.
    this.hereinStand = 0;
    this.eigeneStaendeStand = 0;
    // Ob auf dieser Verbindung schon einmal nachgefasst wurde, weil der
    // Bestand fehlte. Einmal ist ein Weg zurueck, immer wieder ist eine
    // Schleife.
    this.wiederholung = false;
  }

  status() {
    return {
      enabled: this.aktiv,
      connected: this.verbunden,
      hasKey: Boolean(this.schluessel),
      // Der Schluessel geht an die eigene Oberflaeche - dort muss er ja
      // abzulesen sein, um ihn auf das zweite Geraet zu bringen. Aus dem
      // Hauptprozess heraus geht er nirgendwo sonst hin.
      key: this.schluessel ? schluesselModul.anzeigen(this.schluessel) : "",
      entries: this.spiegel.size,
      // Was davon wirklich ein Titel ist. `entries` ist die Groesse des
      // Spiegels und zaehlt Wiedergabesitzungen und Grabsteine mit - eine Zahl
      // fuer die Buchfuehrung, keine fuer den Menschen davor. Wer "231 Titel"
      // liest und eine leere Mediathek sieht, sucht den Fehler an der falschen
      // Stelle.
      titel: this.lebendeStaende(),
      lastSync: this.letzterAbgleich,
      error: this.letzterFehler
    };
  }

  melde() {
    this.aufStatus(this.status());
  }

  // --- Einrichten -----------------------------------------------------------

  konfigurieren({ enabled, serverUrl, schluessel, geraetId }) {
    const neuerServer = String(serverUrl || "").trim();
    const neuerSchluessel = schluesselModul.normalisieren(schluessel);
    const gleich = this.serverUrl === neuerServer && this.schluessel === neuerSchluessel;

    // Ein anderer Schluessel ist ein anderer Raum. Was vom alten im Spiegel
    // steht, gilt dort nicht - und die Nummern des einen Raums sagen ueber den
    // anderen gar nichts.
    // Nur bei einem echten Wechsel. Beim ersten Einrichten nach dem Start ist
    // der alte Schluessel leer, und der eben von der Platte gelesene Spiegel
    // gehoert genau zu diesem neuen - er darf hier nicht wegfallen.
    if (this.schluessel && neuerSchluessel !== this.schluessel) {
      this.spiegel.clear();
      this.nr = 0;
      this.aufSpeichern(this.ablage());
    }

    this.serverUrl = neuerServer;
    this.schluessel = neuerSchluessel;
    this.abgeleitet = neuerSchluessel ? schluesselModul.ableiten(neuerSchluessel) : null;
    this.geraetId = String(geraetId || "").slice(0, 64);
    this.aktiv = Boolean(enabled) && Boolean(neuerServer) && Boolean(neuerSchluessel);

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

  // Jeder Eintrag im Spiegel geht durch diese eine Stelle - sonst laeuft das
  // Schluesselverzeichnis irgendwann auseinander, und "kennst du die schon?"
  // beantwortet sich falsch.
  merken(id, eintrag) {
    this.spiegel.set(id, eintrag);
    if (eintrag.key) this.nachKey.add(eintrag.key);
  }

  vergessen(id) {
    const eintrag = this.spiegel.get(id);
    if (eintrag?.key) this.nachKey.delete(eintrag.key);
    this.spiegel.delete(id);
  }

  // Kennt der Spiegel diesen Schluessel? Fuer alles, was nur einmal hinaus
  // muss.
  kennt(key) {
    return this.nachKey.has(String(key || ""));
  }

  /** Wie viele Titel der Spiegel kennt - ohne Grabsteine, ohne Sitzungen. */
  lebendeStaende() {
    let anzahl = 0;
    for (const eintrag of this.spiegel.values()) {
      if (!eintrag.weg && eintrag.art !== "sitzung") anzahl += 1;
    }
    return anzahl;
  }

  /**
   * Den Spiegel vergessen - bis auf die Grabsteine.
   *
   * <p>Geloescht bleibt geloescht: ein Grabstein steht fuer eine Entscheidung,
   * die jemand getroffen hat, und die holt kein Nachfassen zurueck.
   */
  spiegelVergessen() {
    for (const [id, eintrag] of [...this.spiegel]) {
      if (!eintrag.weg) this.vergessen(id);
    }
  }

  // Was auf die Platte gehoert und beim naechsten Start wieder hereinkommt.
  ablage() {
    return {
      nr: this.nr,
      // Der Schluessel steht nicht mit drin: er liegt in den Einstellungen, und
      // zweimal aufbewahrt ist einmal zu oft.
      eintraege: [...this.spiegel.entries()].map(([id, eintrag]) => ({
        id, at: eintrag.at, hash: eintrag.hash, key: eintrag.key, art: eintrag.art || "stand",
        weg: eintrag.weg ? true : undefined
      }))
    };
  }

  ablageSetzen(roh) {
    this.spiegel.clear();
    this.nachKey.clear();
    for (const eintrag of roh?.eintraege || []) {
      if (!eintrag?.id) continue;
      this.merken(String(eintrag.id), {
        at: Number(eintrag.at) || 0,
        hash: String(eintrag.hash || ""),
        key: String(eintrag.key || ""),
        art: eintrag.art === "sitzung" ? "sitzung" : "stand",
        weg: Boolean(eintrag.weg)
      });
    }
    this.nr = Number(roh?.nr) || 0;
  }

  // --- Verbindung -----------------------------------------------------------

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
      this.offen = false;
      this.wiederholung = false;
      // Zuerst die Uhr, dann anmelden: die Zeitstempel der eigenen Meldungen
      // sollen von Anfang an in Relayzeit stehen.
      this.uhrMessen();
      this.senden({ type: "grhello", room: this.abgeleitet?.raum || "", seit: this.nr });
      this.melde();
    };
    socket.onmessage = (ereignis) => this.nachrichtVerarbeiten(ereignis?.data);
    socket.onerror = (ereignis) => {
      this.letzterFehler = String(ereignis?.message || "Verbindung fehlgeschlagen");
    };
    socket.onclose = () => {
      this.verbunden = false;
      this.socket = null;
      this.offen = false;
      // Was unterwegs war, ist es nicht mehr. Ob es angekommen ist, sagt jetzt
      // niemand mehr - also wird es beim naechsten Mal neu angeboten.
      this.unterwegs.clear();
      this.warteAuf.clear();
      this.uhrAnhalten();
      this.uhr = null;
      this.uhrProben = [];
      this.melde();
      this.spaeterNeuVerbinden();
    };
  }

  trennen() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = 0;
    }
    if (this.nachschubTimer) {
      clearTimeout(this.nachschubTimer);
      this.nachschubTimer = 0;
    }
    this.uhrAnhalten();
    this.uhr = null;
    this.uhrProben = [];
    const socket = this.socket;
    this.socket = null;
    this.verbunden = false;
    this.offen = false;
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

  // --- Uhr ------------------------------------------------------------------

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

  // Jetzt, aber auf der Uhr des Relays. Fehlt eine belastbare Messung, bleibt
  // es bei der eigenen - ein Zeitstempel muss sein, sonst faellt der Eintrag
  // beim Vergleich durch.
  jetzt() {
    if (!this.uhr || Date.now() - this.uhr.at > UHR_HALTBAR_MS) return Date.now();
    return Date.now() + this.uhr.versatz;
  }

  // --- Hinaus ---------------------------------------------------------------

  // Der ganze private Bestand dieses Geraets, als Liste von Staenden. Was sich
  // gegenueber dem Spiegel geaendert hat, geht hinaus; was fehlt, bekommt einen
  // Grabstein.
  //
  // Uebergeben wird immer alles, nicht das Geaenderte: der Rest der App muesste
  // sonst mitfuehren, was sich seit wann geaendert hat, und genau das ist die
  // Sorte Buchhaltung, die irgendwann nicht mehr stimmt.
  abgleichen(staende, zurueckgehalten = []) {
    if (!this.aktiv || !this.abgeleitet) return 0;
    this.eigeneStaende = Array.isArray(staende) ? staende : [];
    // Titel, die es hier gibt, die aber nicht abgeglichen werden - der Stand
    // einer Watchparty gehoert der Runde. Sie duerfen niemals als Loeschung
    // hinausgehen: sie fehlen in der Liste, weil sie zurueckgehalten werden,
    // nicht weil jemand sie weggeworfen hat. Genau diese Verwechslung hat am
    // 25.08.2026 einen ganzen Bestand als Grabsteine an alle Geraete geschickt.
    this.eigeneZurueckgehalten = Array.isArray(zurueckgehalten) ? zurueckgehalten : [];
    // Der Augenblick, aus dem diese Liste stammt. Ab hier ist sie ein
    // Schnappschuss und altert; was danach hereinkommt, steht nicht in ihr.
    this.eigeneStaendeStand = this.hereinStand;
    if (!this.verbunden || !this.offen) {
      // Noch nicht angemeldet: nachholen, sobald der Zustand da ist. Vorher
      // hinauszuschicken hiesse, gegen einen Stand zu schreiben, den man noch
      // gar nicht kennt.
      this.nachholen = true;
      return 0;
    }
    return this.hinausschicken();
  }

  // Sitzungen. Uebergeben wird alles, was der Spiegel noch nicht kennt - der
  // Rest der App filtert das ueber kennt(). Hier wird nur noch verschickt.
  anhaengen(sitzungen) {
    if (!this.aktiv || !this.abgeleitet) return 0;
    this.eigeneSitzungen = Array.isArray(sitzungen) ? sitzungen : [];
    if (!this.verbunden || !this.offen) {
      this.nachholen = true;
      return 0;
    }
    return this.hinausschicken();
  }

  hinausschicken() {
    const staende = this.eigeneStaende || [];
    const gesehen = new Set();
    const aufgaben = [];

    // Ist der Schnappschuss juenger als das zuletzt Empfangene?
    //
    // Er muss es sein, denn gleich wird aus ihm abgeleitet, was hier *fehlt* -
    // und was hier fehlt, geht als Loeschung hinaus. Eine Liste, die vor dem
    // letzten Eingang entstanden ist, kennt die eben angekommenen Eintraege
    // nicht: sie fehlen in ihr, weil sie noch nicht in ihr stehen konnten,
    // nicht weil jemand sie geloescht haette.
    //
    // Genau das ist der teuerste Fehler dieses Moduls, und er trifft den
    // Normalfall: ein frisch eingerichtetes Geraet sieht einmal nach, ob etwas
    // hinaus muss ("noch nichts da"), bekommt einen Augenblick spaeter den
    // ganzen Bestand des anderen - und schickte daraufhin fuer jeden einzelnen
    // dieser Eintraege einen Grabstein zurueck. Am Ende steht der Bestand
    // nirgends mehr.
    //
    // Also: veralteter Schnappschuss, dann geht von den Staenden nichts hinaus.
    // Der Rest der App reicht seine Liste ohnehin gleich wieder herein - am
    // Rechner nach dem Schreiben, am Telefon, sobald der Bestand steht -, und
    // dann ist sie juenger als der Eingang und alles Weitere gilt.
    const frisch = this.eigeneStaendeStand === this.hereinStand;

    if (frisch) {
      for (const stand of staende) {
        const key = String(stand?.key || "");
        if (!key) continue;
        const id = schluesselModul.eintragId(this.abgeleitet, key);
        if (!id) continue;
        gesehen.add(id);
        const hash = schluesselModul.standHash(stand);
        const bekannt = this.spiegel.get(id);
        if (bekannt && bekannt.hash === hash) continue;
        aufgaben.push({ id, key, hash, stand });
      }
    }

    // Was der Spiegel kennt und dieses Geraet nicht mehr hat, ist hier
    // geloescht worden. Ein Grabstein sagt das dem anderen Geraet; ohne ihn
    // faende es den Titel beim naechsten Abgleich wieder vor.
    //
    // Ausdruecklich nur fuer Staende: Sitzungen stehen nicht in dieser Liste,
    // und ein Grabstein fuer jede von ihnen waere das Gegenteil dessen, was
    // hier gewollt ist.
    //
    // Und ausdruecklich nur, wenn dieses Geraet ueberhaupt etwas hat.
    // Eine leere Liste neben einem Spiegel voller Titel ist fast nie "ich habe
    // alles geloescht". Wer wirklich aufraeumt, loescht Stueck fuer Stueck,
    // und jedes davon geht einzeln hinaus. Auf einen Schlag verschwindet ein
    // Bestand nur, wenn er abhanden gekommen ist: eine geleerte Ablage, eine
    // Datei, die sich nicht lesen liess, eine Fassung, die ihn woanders
    // suchte.
    //
    // Den Unterschied macht die Zahl, und nur sie kann ihn machen - dem
    // einzelnen Eintrag sieht niemand an, warum er fehlt. Ein paar wenige sind
    // ein Aufraeumen und gehen als Grabstein hinaus; eine ganze Mediathek ist
    // ein Verlust und geht als Frage zurueck.
    const verloren = frisch && gesehen.size === 0 && this.lebendeStaende() > VERLUST_GRENZE;

    // Was hier nur zurueckgehalten wird, ist kein Grabstein.
    const zurueck = new Set();
    for (const key of this.eigeneZurueckgehalten || []) {
      const id = schluesselModul.eintragId(this.abgeleitet, String(key || ""));
      if (id) zurueck.add(id);
    }

    if (frisch && !verloren) {
      for (const [id, eintrag] of this.spiegel) {
        if (gesehen.has(id) || zurueck.has(id) || eintrag.weg || eintrag.art === "sitzung") continue;
        aufgaben.push({ id, key: eintrag.key, hash: "", stand: null });
      }
    } else if (verloren && !this.wiederholung) {
      // Loeschen waere hier das Falscheste von allem, und Nichtstun das
      // Zweitfalscheste: der Spiegel behauptet ja, alles zu kennen, also
      // reicht das Relay von sich aus nichts mehr nach, und das Geraet bliebe
      // fuer immer leer. Also das Gegenteil des Loeschens - den Spiegel
      // vergessen und alles noch einmal holen.
      this.spiegelVergessen();
      this.wiederholung = true;
      this.vollAbgleichen();
      return 0;
    }

    // Und die Sitzungen. Sie werden nie verglichen und nie zurueckgenommen -
    // eine abgeschlossene Sitzung ist ein Ereignis, kein Zustand.
    for (const sitzung of this.eigeneSitzungen) {
      // Genug fuer diesen Durchgang. Beim ersten Abgleich eines Geraets liegen
      // hier ein paar tausend Saetze, und fuer jeden einen Schluessel zu
      // rechnen, von denen dann hundert verschickt werden, waere Arbeit fuer
      // nichts. Der Rest folgt gleich - dafuer steht der Nachschub unten.
      if (aufgaben.length >= SCHUB * 4) break;
      const key = String(sitzung?.key || "");
      if (!key || this.kennt(key)) continue;
      const id = schluesselModul.eintragId(this.abgeleitet, key);
      if (!id || this.unterwegs.has(id)) continue;
      aufgaben.push({ id, key, hash: "", stand: sitzung, art: "sitzung" });
    }

    if (!aufgaben.length) return 0;

    let hinaus = 0;
    let teil = [];
    let umfang = 0;
    const abschicken = () => {
      if (!teil.length) return;
      this.senden({ type: "grput", eintraege: teil });
      teil = [];
      umfang = 0;
    };

    for (const eintrag of aufgaben.slice(0, SCHUB * 4)) {
      const at = this.jetzt();
      const blob = eintrag.stand ? schluesselModul.verschluesseln(this.abgeleitet, eintrag.stand) : "";
      if (eintrag.stand && !blob) continue;
      const nachricht = eintrag.stand
        ? { id: eintrag.id, at, blob }
        : { id: eintrag.id, at, weg: true };
      if (teil.length >= SCHUB || umfang + blob.length > MAX_SCHUB_ZEICHEN) abschicken();
      teil.push(nachricht);
      umfang += blob.length + 120;
      hinaus += 1;
      // Der Spiegel wird sofort fortgeschrieben, nicht erst mit der
      // Bestaetigung. Sonst schickte der naechste Takt - er kommt alle paar
      // Sekunden - dasselbe noch einmal, und bei stockender Leitung waere das
      // eine Schleife.
      //
      // Fuer Sitzungen gilt das Gegenteil: sie stehen nur hier. Ein Stand
      // ergibt sich beim naechsten Takt wieder aus den Favoriten, eine
      // verlorene Sitzung waere weg. Also erst mit der Bestaetigung - bis dahin
      // gilt sie als unterwegs und wird nicht noch einmal losgeschickt.
      if (eintrag.art === "sitzung") {
        this.unterwegs.add(eintrag.id);
        this.warteAuf.set(eintrag.id, { at, key: eintrag.key });
      } else if (eintrag.stand) {
        this.merken(eintrag.id, { at, hash: eintrag.hash, key: eintrag.key, art: "stand" });
      } else {
        this.vergessen(eintrag.id);
      }
    }
    abschicken();
    // Mehr als ein Schwung auf einmal geht nicht hinaus. Der Rest folgt gleich
    // - liegenbleiben darf er nicht: sonst haengt der Nachtrag eines Geraets,
    // das lange aus war, bis zufaellig wieder jemand etwas schaut.
    if ((aufgaben.length > hinaus || this.eigeneSitzungen.some((eintrag) => !this.kennt(String(eintrag?.key || ""))))
      && !this.nachschubTimer) {
      this.nachschubTimer = setTimeout(() => {
        this.nachschubTimer = 0;
        if (this.verbunden && this.offen) this.hinausschicken();
      }, 1000);
      this.nachschubTimer.unref?.();
    }
    this.letzterAbgleich = Date.now();
    this.aufSpeichern(this.ablage());
    this.melde();
    return hinaus;
  }

  // Alles noch einmal holen. Der Weg zurueck fuer den Fall, dass ein Eintrag
  // hier nicht ankam - etwa, weil der Anbieter dazu damals fehlte und
  // inzwischen angelegt wurde. Teuer ist das nicht: was hier schon steht,
  // traegt denselben Zeitstempel wie drueben und faellt beim Vergleich
  // heraus.
  vollAbgleichen() {
    if (!this.aktiv) return false;
    this.nr = 0;
    this.offen = false;
    this.nachholen = true;
    if (!this.verbunden) {
      // Nicht verbunden: der naechste Verbindungsaufbau holt ohnehin alles,
      // denn die Nummer steht jetzt wieder auf null.
      this.aufSpeichern(this.ablage());
      return false;
    }
    this.senden({ type: "grhello", room: this.abgeleitet?.raum || "", seit: 0 });
    return true;
  }

  // --- Herein ---------------------------------------------------------------

  nachrichtVerarbeiten(rohdaten) {
    let nachricht;
    try {
      nachricht = JSON.parse(String(rohdaten));
    } catch {
      return;
    }

    if (nachricht?.type === "timeack") {
      const t0 = Number(nachricht.t0);
      const t1 = Number(nachricht.t1);
      if (!Number.isFinite(t0) || !Number.isFinite(t1)) return;
      this.uhrProben.push({ t0, t1, t2: Date.now() });
      if (this.uhrProben.length > UHR_PROBEN) this.uhrProben.shift();
      const beste = versatzAusProben(this.uhrProben);
      if (beste) this.uhr = { ...beste, at: Date.now() };
      return;
    }

    if (nachricht?.type === "grerror") {
      this.letzterFehler = String(nachricht.message || "Abgleich abgewiesen");
      this.melde();
      return;
    }

    if (nachricht?.type === "grstate") {
      this.uebernehmen(nachricht.eintraege);
      // Der Wasserstand erst mit dem letzten Teil. Ein grosser Nachschub kommt
      // in mehreren Nachrichten; reisst die Leitung dazwischen ab und die
      // Nummer stuende schon auf dem Ende, fragte dieses Geraet beim naechsten
      // Verbinden nach allem *danach* - und der ausgefallene Rest kaeme nie.
      if (!nachricht.fertig) return;
      if (Number(nachricht.nr) > this.nr) this.nr = Number(nachricht.nr);
      // Erst jetzt ist der Stand des Raums bekannt - und erst jetzt darf dieses
      // Geraet sagen, was es selbst hat. Andersherum wuerde es einen Stand
      // ueberschreiben, den es noch nicht gesehen hat.
      this.offen = true;
      this.aufSpeichern(this.ablage());
      if (this.nachholen || this.eigeneStaende) {
        this.nachholen = false;
        this.hinausschicken();
      }
      this.melde();
      return;
    }

    if (nachricht?.type === "grput") {
      this.uebernehmen(nachricht.eintraege);
      if (Number(nachricht.nr) > this.nr) this.nr = Number(nachricht.nr);
      this.aufSpeichern(this.ablage());
      this.melde();
      return;
    }

    if (nachricht?.type === "grack") {
      if (Number(nachricht.nr) > this.nr) this.nr = Number(nachricht.nr);
      // Erst jetzt gilt eine Sitzung als abgelegt. Was nicht angenommen wurde,
      // faellt aus der Warteschlange und wird beim naechsten Takt erneut
      // angeboten - der Rest der App reicht ohnehin alles herein, was der
      // Spiegel nicht kennt.
      for (const id of nachricht.angenommen || []) {
        const offen = this.warteAuf.get(id);
        if (!offen) continue;
        this.merken(String(id), { at: offen.at, hash: "", key: offen.key, art: "sitzung" });
      }
      for (const id of this.unterwegs) this.warteAuf.delete(id);
      this.unterwegs.clear();
      this.letzterAbgleich = Date.now();
      this.aufSpeichern(this.ablage());
      this.melde();
    }
  }

  uebernehmen(eintraege) {
    if (!Array.isArray(eintraege) || !eintraege.length) return;
    let geaendert = 0;
    for (const roh of eintraege) {
      const id = String(roh?.id || "");
      const at = Number(roh?.at) || 0;
      if (!id || !at) continue;
      const bekannt = this.spiegel.get(id);
      // Der aeltere Stand ueberschreibt nie den neueren - dieselbe Regel wie in
      // der Watchparty. Gleichstand ist der eigene, eben gemeldete Eintrag, der
      // vom Relay zurueckkommt: da gibt es nichts zu tun.
      if (bekannt && bekannt.at >= at) continue;
      // Ab hier aendert dieser Eintrag den Spiegel - gleich ob als Stand, als
      // Sitzung oder als Grabstein. Damit ist jede Liste, die vorher
      // hereingereicht wurde, veraltet.
      this.hereinStand += 1;

      if (roh.weg) {
        const key = bekannt?.key || "";
        if (key && this.aufWeg(key)) geaendert += 1;
        // Der Grabstein bleibt im Spiegel stehen, bis das Relay ihn vergisst.
        // Ohne ihn meldete dieses Geraet den Titel beim naechsten Takt als
        // "neu bei mir" wieder hinaus - es hat ihn ja gerade geloescht.
        this.merken(id, { at, hash: "", key, art: "stand", weg: true });
        continue;
      }

      const inhalt = schluesselModul.entschluesseln(this.abgeleitet, roh.blob);
      if (!inhalt?.key) {
        this.letzterFehler = "Ein Eintrag liess sich nicht lesen";
        continue;
      }

      // Eine Sitzung. Sie wird nicht verglichen und nicht zurueckgeschrieben -
      // sie kommt dazu. Steht sie schon da, war es dieselbe.
      if (String(inhalt.key).startsWith(SITZUNG_PRAEFIX)) {
        if (this.aufSitzung(inhalt.sitzung, at)) geaendert += 1;
        // Gemerkt wird sie so oder so: dass dieses Geraet sie kennt, haengt
        // nicht daran, ob sie neu war.
        this.merken(id, { at, hash: "", key: String(inhalt.key), art: "sitzung" });
        continue;
      }

      const hier = this.aufEintrag(inhalt, at);
      if (!hier) continue;
      // Gemerkt wird, was hier steht - nicht, was hereinkam.
      this.merken(id, {
        at,
        hash: schluesselModul.standHash(typeof hier === "object" ? hier : inhalt),
        key: String(inhalt.key),
        art: "stand"
      });
      geaendert += 1;
    }
    if (!geaendert) return;
    this.letzterAbgleich = Date.now();
    this.aufFertig(geaendert);
  }
}

module.exports = { Geraeteabgleich, SITZUNG_PRAEFIX };
