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
    // Damit die Oberflaeche einen eingetippten Code beanstanden kann, bevor
    // sie ihn speichert - mit demselben Wortlaut wie am Rechner.
    codeBeanstandung
  }, durchreiche);
})();
