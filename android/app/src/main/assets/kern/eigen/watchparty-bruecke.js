"use strict";

/*
 * Die Watchparty auf Android - die Verkabelung, nicht die Sache selbst.
 *
 * Alles, was eine Watchparty ausmacht, steht in den geteilten Modulen:
 * `watchparty.js` fuehrt eine Verbindung samt Wiederanschluss und
 * Uhrenabgleich, `watchparty-raeume.js` mehrere davon nebeneinander,
 * `watchparty-sync.js` rechnet Drift und Zielzeit. Keine Zeile davon ist hier
 * noch einmal geschrieben.
 *
 * Was hier steht, ist das Gegenstueck zu dem, was am Rechner in main.js liegt:
 * die Instanz anlegen, ihre Rueckmeldungen nach draussen reichen und die
 * Befehle von draussen hereinlassen. Am Rechner geht "draussen" ueber IPC in
 * die Oberflaeche, hier ueber die Bruecke nach Java. Der Unterschied ist der
 * Transportweg, nicht die Regel.
 *
 * Ein WebView bringt WebSocket mit, deshalb laeuft die Verbindung wirklich in
 * diesem Modul - nicht in Java nachgebaut, sondern dieselbe.
 */
(function () {
  const { WatchpartyRaeume, codeBeanstandung } = require("watchparty-raeume");
  const fortschritt = require("fortschritt");
  // Dieselbe Sync-Strategie wie am Rechner: Zielzeit, Drift, Veraltung, der
  // Horcher am Player und die Entscheidung, was mit einem eingehenden Befehl
  // zu geschehen hat. Kein Stueck davon steht hier noch einmal.
  const sync = require("watchparty-sync");
  // Wer zu einer Adresse gehoert, entscheidet dieselbe Funktion wie am
  // Rechner (siehe providerForWatchpartyUrl in main.js). Eine eigene
  // Zuordnung hier waere die zweite - und zwei Zuordnungen kommen
  // irgendwann zu zwei Anbietern.
  const geraeteStand = require("geraete-stand");

  let raeume = null;
  let letzterStatus = null;

  // Jede Rueckmeldung der Raeume geht unter ihrem Namen nach Java. Dort
  // entscheidet die Oberflaeche, was davon sie zeigt.
  function ereignis(name, nutzlast) {
    if (window.ElfixKern && typeof window.ElfixKern.ereignis === "function") {
      window.ElfixKern.ereignis(name, nutzlast);
    }
  }

  function sicherstellen() {
    if (raeume) return raeume;
    raeume = new WatchpartyRaeume({
      onState: (eintraege, raum) => ereignis("watchparty:zustand", { eintraege, raum }),
      // Drei Argumente, kein Objekt: Schluessel, Stand, Raum. Sie werden hier
      // zusammengefasst, weil die Bruecke nach Java nur eine Nutzlast kennt.
      onProgress: (schluessel, stand, raum) =>
        ereignis("watchparty:fortschritt", { key: schluessel, progress: stand, room: raum }),
      onStatus: () => {
        letzterStatus = raeume.status();
        ereignis("watchparty:status", letzterStatus);
      },
      onDeviceId: (kennung) => ereignis("watchparty:kennung", { kennung }),
      onControl: (steuerung) => ereignis("watchparty:steuerung", steuerung),
      onWatchstate: (stand) => ereignis("watchparty:stand", stand),
      onChat: (zeile) => ereignis("watchparty:chat", zeile),
      onConnection: (info) => ereignis("watchparty:verbindung", info)
    });
    return raeume;
  }

  /**
   * Einstellungen uebernehmen. Dieselben Felder wie am Desktop
   * (`settings.watchparty`), damit eine Sicherung von dort hier passt.
   */
  function konfigurieren(einstellungen) {
    const wp = sicherstellen();
    wp.konfigurieren({
      enabled: Boolean(einstellungen && einstellungen.enabled),
      serverUrl: (einstellungen && einstellungen.serverUrl) || "",
      rooms: (einstellungen && einstellungen.rooms) || [],
      name: (einstellungen && einstellungen.deviceName) || "",
      deviceId: (einstellungen && einstellungen.deviceId) || ""
    });
    return wp.status();
  }

  function status() {
    return raeume ? raeume.status() : { enabled: false, connected: false, rooms: [], peers: [], error: "" };
  }

  function eintraege() {
    return raeume ? raeume.eintraege() : [];
  }

  /**
   * Meldet den Stand eines Eintrags in seine Runde.
   *
   * <p>Nur Eintraege mit Raum melden - der eigene, private Stand bleibt privat.
   * Dieselbe Bedingung wie in `reportWatchpartyProgress` am Rechner, und der
   * Inhalt kommt aus derselben Funktion.
   */
  function standMelden(eintrag, schluessel, geraetName) {
    if (!raeume || !raeume.aktiv) return false;
    const raum = String((eintrag && eintrag.watchpartyRoom) || "");
    if (!raum || !schluessel) return false;
    raeume.fortschrittMelden(schluessel, fortschritt.watchpartyStand(eintrag, geraetName), raum);
    return true;
  }

  /* --------------------------------------------------- Eintraege oeffnen */

  /*
   * Was der Rechner unter `openWatchpartyItem` tut - und was Android bisher
   * gar nicht konnte.
   *
   * Auf dem Telefon und am Fernseher stand unter jedem Eintrag genau ein
   * Knopf: "Verlassen". Die Folge liess sich nicht oeffnen. Dabei liegt alles
   * Noetige schon im Eintrag, den das Relay ohnehin schickt - die Adresse der
   * Serie, der Anbietername und, sobald jemand aus der Runde weiterschaut,
   * der Stand mit der Adresse der *Folge*.
   *
   * Genau diese Auswahl trifft der Rechner:
   *
   *   const url = eintrag.progress?.url || eintrag.url;
   *
   * Die Folgenadresse geht vor. Sonst landet man auf der Serienuebersicht,
   * waehrend die Runde bei Staffel 3 Folge 8 steht.
   */

  /** Der Eintrag zu genau einem Titel in genau einem Raum. */
  function eintragImRaum(key, room) {
    if (!raeume || !key) return null;
    const raum = String(room || "");
    return raeume.eintraege().find((eintrag) => (
      eintrag.key === key && (!raum || String(eintrag.room || "") === raum)
    )) || null;
  }

  /**
   * Wohin ein Eintrag fuehrt, wenn man ihn oeffnet.
   *
   * <p>Java bekommt eine fertige Auskunft und sucht sich nichts selbst
   * zusammen: Anbieter, Adresse, Staffel, Folge und die Stelle, an der die
   * Runde steht.
   *
   * @param anbieter die eingerichteten Anbieter, wie sie der Kern kennt
   * @return {@code null}, wenn es den Eintrag nicht gibt; sonst ein Objekt mit
   *         {@code providerId} (leer, wenn kein Anbieter passt) und
   *         {@code url}
   */
  function oeffnungsZiel(key, room, anbieter) {
    const eintrag = eintragImRaum(key, room);
    if (!eintrag) return null;
    const provider = geraeteStand.anbieterFinden(anbieter || [], eintrag.url, eintrag.providerName);
    const stand = eintrag.progress || null;
    // Die Folgenadresse vor der Serienadresse - dieselbe Reihenfolge wie am
    // Rechner. Ohne sie oeffnet ein Klick auf "Bleach" die Uebersicht statt
    // der Folge, bei der die Runde gerade steht.
    const url = (stand && stand.url) || eintrag.url || "";
    return {
      key: eintrag.key,
      room: String(eintrag.room || ""),
      providerId: provider ? provider.id : "",
      providerName: (provider && provider.name) || eintrag.providerName || "",
      url,
      titel: eintrag.title || "",
      // Was die Runde ueber die Folge weiss. Der Stand geht vor: er ist
      // juenger als die Angabe am Titel.
      season: (stand && stand.season) || eintrag.season || 0,
      episode: (stand && stand.episode) || eintrag.episode || 0,
      position: (stand && stand.position) || 0,
      dabei: Boolean(eintrag.joined),
      thumbnail: eintrag.thumbnail || ""
    };
  }

  /**
   * Die Eintraege samt der Frage, ob sie sich ueberhaupt oeffnen lassen.
   *
   * <p>Dasselbe `openable` wie am Rechner: ohne passenden eingerichteten
   * Anbieter fuehrt der Knopf nirgendwohin, und ein Knopf, der nichts tut,
   * ist schlimmer als keiner.
   */
  function eintraegeMitAnbieter(anbieter) {
    const liste = anbieter || [];
    return eintraege().map((eintrag) => {
      const provider = geraeteStand.anbieterFinden(liste, eintrag.url, eintrag.providerName);
      const stand = eintrag.progress || null;
      return Object.assign({}, eintrag, {
        openable: Boolean(provider),
        providerId: provider ? provider.id : "",
        // Ausgerechnet, damit die Oberflaeche nicht zweimal dieselbe
        // Vorrangregel schreiben muss - einmal fuer die Anzeige, einmal
        // fuers Oeffnen.
        staffel: (stand && stand.season) || eintrag.season || 0,
        folge: (stand && stand.episode) || eintrag.episode || 0,
        stelle: (stand && stand.position) || 0,
        dauer: (stand && stand.duration) || 0,
        von: (stand && stand.from) || ""
      });
    });
  }

  /* ------------------------------------------------------- Das Mitschauen */

  /*
   * Was hier dazukommt, ist der Teil, den Android bis hierher nicht hatte.
   *
   * Die Watchparty lief auf dem Telefon und auf dem Fernseher nur als
   * Fortschrittsabgleich: derselbe Raumcode, derselbe Weiterschauen-Stand -
   * aber kein Play, kein Pause, kein Sprung. Es fehlte nicht die Fachlogik,
   * die stand von Anfang an in den geteilten Modulen; es fehlte die
   * Verkabelung zwischen ihr und dem Player im WebView.
   *
   * Genau die steht jetzt hier. Java bekommt fertige Skripte und fertige
   * Urteile - es entscheidet nichts selbst, es fuehrt aus. Damit gibt es
   * weiterhin genau eine Fassung jeder Regel, und sie ist die des Rechners.
   */

  /** Der letzte angewendete Befehl je Raum und Titel - fuer die Veraltungspruefung. */
  const letzteEreignisse = new Map();

  /**
   * Was mit einem eingehenden Steuerbefehl zu geschehen ist.
   *
   * <p>Die Buchfuehrung ueber "was war zuletzt" liegt hier und nicht in Java:
   * sie gehoert zur Regel, und eine Regel mit ihrem Zustand an zwei
   * verschiedenen Orten ist keine Regel mehr.
   *
   * @param nachricht der Befehl, wie das Relay ihn geschickt hat
   * @param lage      { binHost, hostId, gleicheAdresse, season, episode }
   * @return { tun, genau, warten, nichtSpringen, grund, skript }
   */
  function steuerungPruefen(nachricht, lage) {
    const raum = (nachricht && nachricht.room) || "";
    const merker = `${raum}|${(nachricht && nachricht.key) || ""}`;
    const urteil = sync.steuerungEntscheiden(nachricht, {
      letzter: letzteEreignisse.get(merker),
      binHost: Boolean(lage && lage.binHost),
      hostId: (lage && lage.hostId) || "",
      gleicheAdresse: !lage || lage.gleicheAdresse !== false,
      offen: { season: (lage && lage.season) || 0, episode: (lage && lage.episode) || 0 }
    });
    if (urteil.merken) letzteEreignisse.set(merker, urteil.merken);
    if (urteil.tun === "nichts") return { tun: "nichts", grund: urteil.grund, skript: "" };

    // Der Uhrversatz gehoert zum Raum, aus dem die Nachricht kam: jeder Raum
    // ist eine eigene Verbindung und misst ihn selbst.
    const stand = raeume ? raeume.uhrStand(raum) : null;
    const ereignis = sync.ereignisFuerPlayer(
      nachricht, sync.laeuftDanach(nachricht), stand ? stand.versatz : 0, Boolean(stand)
    );

    if (urteil.tun === "navigate") {
      return { tun: "navigate", grund: urteil.grund, url: String(nachricht.url || ""), skript: "" };
    }
    if (urteil.tun === "drift") {
      return { tun: "drift", grund: urteil.grund, skript: sync.driftScript(ereignis) };
    }
    // syncprepare und syncstart gehen denselben Weg wie ein gewoehnlicher
    // Befehl - nur mit anderen Flaggen. Beim Vorbereiten wartet das Skript,
    // bis der Sprung wirklich sitzt; erst dann meldet Java "bereit".
    const aktion = urteil.tun === "syncprepare" ? "syncprepare" : String(nachricht.action);
    return {
      tun: urteil.tun,
      grund: urteil.grund,
      skript: sync.applyScript(aktion, ereignis, {
        genau: urteil.genau,
        warten: urteil.warten,
        nichtSpringen: urteil.nichtSpringen
      })
    };
  }

  /**
   * Ein Befehl dieses Geraets, wie ihn der Horcher im Player gemeldet hat.
   *
   * <p>Java liest die Konsolenzeile nicht selbst - es reicht sie herein, und
   * hier wird sie mit derselben Funktion zerlegt, die sie am Rechner zerlegt.
   * Eine zweite Auslegung derselben Zeichenkette waere die naechste Stelle,
   * an der die Geraete auseinanderlaufen.
   *
   * @return was gesendet wurde, oder null
   */
  function meldungSenden(zeile, key, url, room) {
    const tat = sync.aktionLesen(zeile);
    if (!tat || !raeume || !key) return null;
    raeume.steuernMitAdresse(key, tat.aktion, tat.position, String(url || ""), room);
    return tat;
  }

  /** Eine Standmeldung des Horchers: Position und ob es steht. */
  function meldungStand(zeile, key, stand, room) {
    const wert = sync.standLesen(zeile);
    if (!wert || !raeume || !key) return null;
    raeume.meldeStand(key, Object.assign({}, stand, {
      position: wert.position,
      paused: wert.paused
    }), room);
    return wert;
  }

  /** Ein Folgenwechsel dieses Geraets. */
  function folgenwechselMelden(key, url, room) {
    if (!raeume || !key) return false;
    raeume.steuernMitAdresse(key, "navigate", 0, String(url || ""), room);
    return true;
  }

  /**
   * Der Zustand faengt von vorn an - beim Folgenwechsel und beim Hosterwechsel.
   *
   * <p>Beides ist ein neues Dokument mit einem neuen Videoelement. Die
   * bestaetigten Driftmessungen, die Ruhezeit und die Veraltungsbuchhaltung
   * gehoeren zur Folge davor; blieben sie stehen, wiese der neue Player die
   * ersten Befehle der neuen Folge als "veraltet" ab.
   */
  function zuruecksetzen(key, room) {
    if (key) letzteEreignisse.delete(`${room || ""}|${key}`);
    else letzteEreignisse.clear();
    return sync.zuruecksetzenScript();
  }

  // Verwaltendes reicht direkt durch. Eine eigene Pruefung waere hier falsch:
  // was ein gueltiger Raumcode ist, weiss das geteilte Modul.
  const durchreiche = {
    teilen: (item, room) => sicherstellen().teilen(item, room),
    beitreten: (key, room) => sicherstellen().beitreten(key, room),
    verlassen: (key, room) => sicherstellen().verlassen(key, room),
    entfernen: (key, room) => sicherstellen().entfernen(key, room),
    rauswerfen: (key, memberId, room) => sicherstellen().rauswerfen(key, memberId, room),
    hostUebergeben: (key, memberId, room) => sicherstellen().hostUebergeben(key, memberId, room),
    steuern: (key, action, position, room) => sicherstellen().steuern(key, action, position, room),
    steuernMitAdresse: (key, action, position, url, room) =>
      sicherstellen().steuernMitAdresse(key, action, position, url, room),
    gleichziehen: (key, position, room) => sicherstellen().gleichziehen(key, position, room),
    bereitZumStart: (key, room) => sicherstellen().bereitZumStart(key, room),
    abgleichen: (key, room) => sicherstellen().abgleichen(key, room),
    meldeStand: (key, stand, room) => sicherstellen().meldeStand(key, stand, room),
    verlasseStand: (key, room) => sicherstellen().verlasseStand(key, room),
    chatSenden: (key, zeile, room) => sicherstellen().chatSenden(key, zeile, room),
    istBeigetreten: (key) => Boolean(raeume && raeume.istBeigetreten(key)),
    trennen: () => { if (raeume) raeume.trennen(); }
  };

  // Als Modul im Kern erreichbar: Java ruft "watchparty-bruecke.konfigurieren".
  module.exports = Object.assign({
    konfigurieren,
    status,
    eintraege,
    standMelden,
    // Eintraege oeffnen.
    oeffnungsZiel,
    eintraegeMitAnbieter,
    // Das Mitschauen.
    steuerungPruefen,
    meldungSenden,
    meldungStand,
    folgenwechselMelden,
    zuruecksetzen,
    // Der Horcher, der im Player Play, Pause und Sprung bemerkt. Woertlich
    // dasselbe Skript, das der Rechner einsetzt.
    beobachterSkript: () => sync.beobachterScript(),
    // Woran Java eine Meldung dieses Horchers erkennt.
    MELDE_AKTION: sync.MELDE_AKTION,
    MELDE_STAND: sync.MELDE_STAND,
    MELDE_SYNC: sync.MELDE_SYNC,
    // Damit die Oberflaeche einen eingetippten Code beanstanden kann, bevor
    // sie ihn speichert - mit demselben Wortlaut wie am Rechner.
    codeBeanstandung
  }, durchreiche);
})();
