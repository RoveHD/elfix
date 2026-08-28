"use strict";

/*
 * Meine Geraete auf Android - die Verkabelung, nicht die Sache selbst.
 *
 * Verbindung, Wiederanschluss, Uhrabgleich, Spiegel, Grabsteine, Schuebe und
 * die Frage, welcher Stand gewinnt: alles das steht in `geraete.js`, demselben
 * Modul wie am Rechner. Was ein Stand ist und was von ihm hinausgeht, steht in
 * `geraete-schluessel.js`. Was beim Uebernehmen mit ihm geschieht, in
 * `geraete-stand.js`. Keine Zeile davon ist hier noch einmal geschrieben, und
 * das ist der ganze Punkt: ein zweiter Abgleich waere ein zweiter Abgleich, und
 * zwei Geraete kaemen an derselben Stelle zu verschiedenen Ergebnissen.
 *
 * Hier steht das Gegenstueck zu dem, was am Rechner in main.js liegt: die
 * Favoriten hereinreichen, die Rueckmeldungen nach Java geben, die Ablage
 * anstossen. Am Rechner geht "nach draussen" ueber IPC in die Oberflaeche, hier
 * ueber die Bruecke nach Java.
 *
 * Ein WebView bringt WebSocket mit, deshalb laeuft die Verbindung wirklich in
 * diesem Modul - nicht in Java nachgebaut, sondern dieselbe. Was ihm fehlt,
 * sind Buffer und ein synchrones crypto; beides liefert kern-knoten.js.
 */
(function () {
  const { Geraeteabgleich } = require("geraete");
  const schluesselModul = require("geraete-schluessel");
  const geraeteStand = require("geraete-stand");
  const statistik = require("statistik");

  let abgleich = null;
  /** Raeume und Beitritte dieses Kontos - siehe watchpartySetzen. */
  let watchpartySatz = null;
  let letzterStatus = null;
  // Die Favoriten in genau der Form, die favorites.json traegt. Das Modul
  // aendert sie an Ort und Stelle - deshalb liegt hier die Liste selbst und
  // nicht eine Abschrift davon.
  let favoriten = [];
  let sitzungen = [];
  // Welche Sitzungen gerade noch wachsen. Sie stehen bereits in der Liste -
  // damit ein Prozessabbruch sie nicht kostet -, sind aber noch keine fertigen
  // Saetze und haben deshalb bei den anderen Geraeten nichts verloren.
  // Dieselbe Unterscheidung wie `laufendeSitzungIds` am Rechner; ohne sie ginge
  // ein Zwischenstand hinaus und stuende drueben fuer immer als fertige
  // Sitzung da - eine Sitzung wird nie ueberschrieben.
  let offeneSitzungen = new Set();
  let anbieter = [];
  // Was sich seit der letzten Meldung an Java geaendert hat. Gesammelt, weil
  // beim ersten Abgleich leicht zweihundert Eintraege auf einmal hereinkommen
  // und jede einzelne Datei zu schreiben zweihundertmal dieselbe Datei waere.
  let favoritenSchmutzig = false;
  // Was in diesem Schub wirklich neu hereinkam - nicht die ganze Liste.
  //
  // Vorher ging die vollstaendige Liste nach Java, und Java schrieb sie ueber
  // seinen eigenen Stand. Damit entschied die Reihenfolge zweier Nachrichten
  // darueber, ob eine Sitzung ueberlebt, die hier gerade erst entstanden ist.
  // Ein Zuwachs ist dagegen immer richtig: eine abgeschlossene Sitzung ist ein
  // Ereignis, und Ereignisse addieren sich.
  let sitzungenDazu = [];

  function ereignis(name, nutzlast) {
    if (window.ElfixKern && typeof window.ElfixKern.ereignis === "function") {
      window.ElfixKern.ereignis(name, nutzlast);
    }
  }

  function sicherstellen() {
    if (abgleich) return abgleich;
    abgleich = new Geraeteabgleich({
      onEintrag: (stand) => {
        const ergebnis = geraeteStand.uebernehmen(stand, umgebung());
        if (!ergebnis) return null;
        favoritenSchmutzig = true;
        return ergebnis.stand;
      },
      onWeg: (key) => {
        const weg = geraeteStand.entfernen(favoriten, key);
        if (!weg) return false;
        favoritenSchmutzig = true;
        return true;
      },
      // Eine Sitzung kommt dazu oder sie ist schon da - ueberschrieben wird
      // nie: zwei Geraete koennen denselben Satz nicht verschieden wissen.
      onSitzung: (sitzung) => {
        if (!sitzung || !sitzung.id || !sitzung.begonnenAm) return false;
        const { sitzungen: vereint, dazu } = statistik.vereinen(sitzungen, [sitzung]);
        if (!dazu) return false;
        sitzungen = vereint;
        sitzungenDazu.push(sitzung);
        return true;
      },
      // Raeume und Beitritte eines anderen Geraets desselben Kontos. Ein
      // Zustand, kein Ereignis: der neuere gilt, und Java entscheidet, was
      // damit zu tun ist - Einstellungen schreiben und beitreten kann nur die
      // App, nicht dieses Modul.
      onWatchparty: (satz) => {
        if (!satz || typeof satz !== "object") return false;
        ereignis("geraete:watchparty", satz);
        return true;
      },
      // Geschrieben wird einmal je Schub, nicht einmal je Eintrag.
      onFertig: (anzahl) => {
        if (favoritenSchmutzig) {
          favoritenSchmutzig = false;
          ereignis("geraete:favoriten", favoriten);
        }
        if (sitzungenDazu.length) {
          const neue = sitzungenDazu;
          sitzungenDazu = [];
          ereignis("geraete:sitzungen", neue);
        }
        ereignis("geraete:uebernommen", { anzahl });
      },
      onSpeichern: (ablage) => ereignis("geraete:spiegel", ablage),
      onStatus: (status) => {
        letzterStatus = status;
        ereignis("geraete:zustand", status);
      }
    });
    return abgleich;
  }

  /**
   * Was das Geraet dem gemeinsamen Modul an die Hand gibt.
   *
   * <p>Dieselben fuenf Rueckrufe wie am Rechner. Zwei davon fallen hier
   * schlanker aus: eigene Bilder gibt es auf Android noch nicht, also gibt es
   * auch keine, die zu einem uebernommenen Titel passen wuerden. Das ist kein
   * Unterschied im Abgleich - eigene Bilder gehen ohnehin nie hinaus.
   */
  function umgebung() {
    return {
      favoriten,
      anbieterFuer: (url, providerName) => geraeteStand.anbieterFinden(anbieter, url, providerName),
      normalisieren: (favorit) => favorit,
      eigenesBild: () => "",
      bildAusschnitt: () => null,
      kennung: () => (window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID()
        : String(Date.now()) + Math.random().toString(16).slice(2))
    };
  }

  // --- Was Java hereinreicht ---------------------------------------------

  function konfigurieren(einstellungen) {
    const abg = sicherstellen();
    abg.konfigurieren({
      enabled: einstellungen && einstellungen.enabled === true,
      // Dieselbe Adresse wie die Watchparty: es ist dasselbe Relay.
      serverUrl: (einstellungen && einstellungen.serverUrl) || "",
      schluessel: (einstellungen && einstellungen.schluessel) || "",
      geraetId: (einstellungen && einstellungen.geraetId) || ""
    });
    return abg.status();
  }

  /** Der Spiegel aus der Datei. Ohne ihn faengt jeder Start von vorn an. */
  function spiegelSetzen(roh) {
    sicherstellen().ablageSetzen(roh || null);
    return true;
  }

  function favoritenSetzen(liste) {
    favoriten = Array.isArray(liste) ? liste : [];
    return favoriten.length;
  }

  /**
   * Die Sitzungen, wie Java sie gerade wirklich haelt.
   *
   * <p>Wird nicht mehr nur einmal beim Start gereicht, sondern nach jeder
   * Aenderung. Genau daran hing der Fehler: der Abgleich kannte bis zum
   * naechsten App-Start nur die Liste von damals, und alles, was an diesem
   * Abend gemessen wurde, ging nie hinaus. Die Bilanz blieb je Geraet stehen.
   *
   * @param offene die Kennungen der Sitzungen, die noch laufen - sie bleiben
   *               beim Abgleich draussen
   */
  function sitzungenSetzen(liste, offene) {
    sitzungen = Array.isArray(liste) ? liste : [];
    offeneSitzungen = new Set(
      (Array.isArray(offene) ? offene : []).map((id) => String(id || "")).filter(Boolean)
    );
    return sitzungen.length;
  }

  function anbieterSetzen(liste) {
    anbieter = Array.isArray(liste) ? liste : [];
    return anbieter.length;
  }

  /**
   * Die Watchparty-Einstellungen dieses Kontos, die hinausgehen sollen.
   *
   * <p>Raeume und Beitritte, sonst nichts - dieselbe Auswahl wie am Rechner
   * (`geraeteWatchparty` in main.js). Die Serveradresse bleibt ausdruecklich
   * draussen: sie kann je Geraet eine andere sein, und sie zu ueberschreiben
   * hiesse, ein funktionierendes Geraet abzuhaengen. Die Geraetekennung
   * ebenso - sie gehoert dem Geraet, nicht dem Konto.
   */
  function watchpartySetzen(satz) {
    // Gemerkt und nicht durchgereicht.
    //
    // Java meldet den Satz einmal, beim Einrichten - und da ist der Abgleich
    // noch nicht scharf: er hat weder Schluessel noch Verbindung und wirft
    // alles weg, was vor "konfigurieren" hereinkommt. Der Satz waere damit
    // fuer immer verloren, denn Java schickt denselben kein zweites Mal.
    //
    // Also liegt er hier, und jeder Abgleich reicht ihn erneut hinein - genau
    // wie die Staende, die ebenfalls bei jedem Durchgang neu aus den Favoriten
    // kommen. Ob wirklich etwas hinausgeht, entscheidet das Modul am Hash.
    watchpartySatz = satz && typeof satz === "object" ? satz : null;
    return watchpartySatz ? 1 : 0;
  }

  /**
   * Einmal nachsehen, ob etwas hinaus muss.
   *
   * <p>Staende und Sitzungen in einem Zug - genau wie am Rechner. Was davon
   * wirklich hinausgeht, entscheidet das Modul am Spiegel; hier wird nichts
   * gefiltert.
   */
  function abgleichen() {
    const abg = sicherstellen();
    // Die zurueckgehaltenen Titel gehen mit - sonst liest der Abgleich ihr
    // Fehlen als Loeschung und schickt Grabsteine an alle Geraete. Dieselbe
    // Uebergabe wie am Rechner.
    const hinaus = abg.abgleichen(
      geraeteStand.staende(favoriten), geraeteStand.zurueckgehalten(favoriten));
    const offene = [];
    for (const sitzung of sitzungen) {
      const id = String((sitzung && sitzung.id) || "");
      if (!id || offeneSitzungen.has(id)) continue;
      const key = `sitzung:${id}`;
      if (abg.kennt(key)) continue;
      offene.push({ key, sitzung });
    }
    // Raeume und Beitritte gehen bei jedem Durchgang mit - siehe
    // watchpartySetzen.
    if (watchpartySatz) abg.watchpartySetzen(watchpartySatz);
    return { staende: hinaus, sitzungen: abg.anhaengen(offene) };
  }

  /** Alles noch einmal holen - der Weg zurueck, wenn hier etwas fehlt. */
  function vollAbgleichen() {
    const abg = sicherstellen();
    abg.vollAbgleichen();
    return abgleichen();
  }

  function status() {
    return abgleich ? abgleich.status() : letzterStatus;
  }

  // --- Der Schluessel ------------------------------------------------------

  function erzeugen() {
    return schluesselModul.erzeugen();
  }

  /**
   * Einen abgetippten Schluessel pruefen und geradeziehen.
   *
   * <p>Dieselbe Regel wie am Rechner: Kleinschreibung, Striche und Leerzeichen
   * sind egal, und I/L werden zur Eins, O zur Null - die drei Verwechslungen,
   * die beim Abschreiben wirklich vorkommen. Ein "fast richtig" gibt es nicht.
   */
  function pruefen(wert) {
    const sauber = schluesselModul.normalisieren(wert);
    if (!sauber) return { ok: false, key: "" };
    return { ok: true, key: sauber, anzeige: schluesselModul.anzeigen(sauber) };
  }

  function anzeigen(wert) {
    return schluesselModul.anzeigen(wert);
  }

  module.exports = {
    konfigurieren,
    spiegelSetzen,
    favoritenSetzen,
    sitzungenSetzen,
    watchpartySetzen,
    anbieterSetzen,
    abgleichen,
    vollAbgleichen,
    status,
    erzeugen,
    pruefen,
    anzeigen
  };
})();
