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
  // Wie eine Serveradresse zu lesen und was an ihr zu beanstanden ist, steht in
  // `watchparty.js` - derselben Datei, aus der `websocketAdresse` kommt. Zwei
  // Auslegungen derselben Adresse waeren zwei Fehlerquellen, und eine davon
  // haette der Fernseher gehabt.
  const { serverNormalisieren, serverBeanstandung } = require("watchparty");
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
  // Wie eine Adresse auf ihre Serie zurueckfaellt und wie ein Titel zu einem
  // Schluessel wird, steht in `taste.js` - derselben Datei, aus der der Rechner
  // es holt. Genau hier lag der Fehler: Android bildete den Titelschluessel
  // selbst, aus der Adresse. Der Rechner bildet ihn aus Art und Titel
  // ("serie:bleach"). Damit trug derselbe Anime in derselben Runde auf beiden
  // Geraeten zwei verschiedene Schluessel - und alles, was am Schluessel haengt
  // (Mitgliedschaft, Stand, Steuerung, Host), fand einander nie.
  const taste = require("taste");
  // Der Folgen-Autostart. Die Regel - was ein Auftrag ist, wann er veraltet,
  // was als Naechstes zu tun ist und welches Skript im Player wirklich startet -
  // steht vollstaendig in `watchparty-autostart.js`. Hier liegt nur die
  // Buchfuehrung: welcher Auftrag gerade offen ist und die laufende Nummer je
  // Raum und Titel.
  const autostart = require("watchparty-autostart");

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
    // Wer die Watchparty ausschaltet, meint auch keinen offenen Autostart mehr.
    // Einen oertlichen aber schon: der hat mit der Runde nichts zu tun, und
    // ihn hier mitzuloeschen hiesse, dass "Weiterschauen" nicht mehr startet,
    // sobald jemand die Watchparty abschaltet.
    if (!(einstellungen && einstellungen.enabled) && !(auftrag && auftrag.oertlich)) {
      autostartVerwerfen();
    }
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
  function standMelden(eintrag, geraetName) {
    if (!raeume || !raeume.aktiv) return false;
    const raum = String((eintrag && eintrag.watchpartyRoom) || "");
    // Der Schluessel wird hier gebildet und nicht vom Aufrufer mitgebracht.
    // Genau daran hing es: Java bildete ihn aus der Adresse, der Rechner aus
    // Art und Titel - und der gemeldete Stand landete im Raum unter einem
    // Titel, den es dort gar nicht gab.
    const schluessel = titelSchluessel(eintrag);
    if (!raum || !schluessel) return false;
    raeume.fortschrittMelden(schluessel, fortschritt.watchpartyStand(eintrag, geraetName), raum);
    return true;
  }

  /* -------------------------------------- Titel und Adresse in der Runde */

  /*
   * Der Schluessel, unter dem ein Titel in einer Runde gefuehrt wird.
   *
   * Er muss auf jedem Geraet gleich ausfallen, sonst gibt es den Titel im Raum
   * zweimal - einmal so, wie der Rechner ihn kennt, und einmal so, wie das
   * Telefon ihn kennt. Genau das war der Zustand: der Rechner bildete ihn ueber
   * `geraete-stand.titelSchluessel` aus Art und Titel ("serie:bleach"), Android
   * ueber die Serienadresse. Ein Android-Geraet tauchte deshalb am Rechner
   * weder als Host noch als Mitschauer auf, seine Pause kam nie an, und ein am
   * Rechner eingestellter Titel war auf dem Telefon fuer die Steuerung
   * unsichtbar - alles dasselbe Missverstaendnis, an vier Stellen sichtbar.
   *
   * Die Adresse taugt dafuer ohnehin nicht: s.to laeuft hier ueber eine IP und
   * dort ueber die Domain. Titel und Medientyp sind ueberall dieselben.
   */
  function titelSchluessel(eintrag) {
    return geraeteStand.titelSchluessel(eintrag || {});
  }

  /**
   * Welcher Titel und welche Runde gelten fuer diese Adresse?
   *
   * <p>Dasselbe wie `watchpartySerieForUrl` und `watchpartyRaeumeForUrl` am
   * Rechner: es zaehlt die Serie hinter der Adresse, verglichen ueber
   * `taste.urlSchluessel`. Ein Folgenwechsel innerhalb derselben Serie aendert
   * daran nichts, ein Hosterwechsel auch nicht - der Aufrufer reicht dann die
   * zuletzt offene Folgenseite herein.
   *
   * <p>Java fragt hier und rechnet nicht selbst. Die Antwort ist der einzige
   * Weg vom "was steht gerade offen" zum "welcher Eintrag im Raum ist das" -
   * und sie kommt aus derselben Regel wie am Rechner.
   *
   * @return { key, room, joined, url, season, episode } - leer, wenn diese
   *         Adresse in keiner beigetretenen Runde steht
   */
  function lageFuer(url) {
    const leer = { key: "", room: "", joined: false, url: "", season: 0, episode: 0 };
    const adresse = String(url || "");
    if (!raeume || !adresse) return leer;
    const gesucht = taste.urlSchluessel(adresse);
    if (!gesucht) return leer;
    const treffer = raeume.eintraege().filter((eintrag) => (
      eintrag.joined && taste.urlSchluessel(eintrag.url || "") === gesucht
    ));
    const eintrag = treffer[0];
    if (!eintrag) return leer;
    const stand = eintrag.progress || null;
    return {
      key: String(eintrag.key || ""),
      room: String(eintrag.room || ""),
      joined: true,
      url: String(eintrag.url || ""),
      season: (stand && stand.season) || eintrag.season || 0,
      episode: (stand && stand.episode) || eintrag.episode || 0
    };
  }

  /**
   * Die Serienadresse zu einem Schluessel.
   *
   * <p>Der Rueckweg. Das Relay schickt Fortschritt und Zustaende unter dem
   * Titelschluessel; die Ablage auf dem Geraet kennt Adressen. Vorher war
   * beides dasselbe, seit der Schluessel stimmt nicht mehr - also wird hier
   * uebersetzt, statt in Java einen zweiten Schluesselbegriff zu fuehren.
   */
  function adresseZuSchluessel(key, room) {
    const eintrag = eintragImRaum(String(key || ""), room);
    return eintrag ? String(eintrag.url || "") : "";
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
      // Die Adresse der Serie, nicht die der Folge. Sie ist der Weg zurueck in
      // die eigene Ablage: der Titelschluessel des Relays passt dort auf
      // nichts, seit er wie am Rechner aus Art und Titel gebildet wird.
      serie: eintrag.url || "",
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

    // Steht fuer genau diesen Raum und Titel ein Autostart-Auftrag offen, ist
    // dieser Befehl der Stand des Hosts, auf den er gewartet hat - und dann
    // geht nicht das gewoehnliche Skript in den Player, sondern das des
    // Auftrags.
    //
    // Der Unterschied ist keiner der Rechnung, sondern des Ausgangspunkts:
    // gewoehnlich liegt ein geladener Player vor, hier liegt ein Rahmen mit
    // einem `<video>` ohne Quelle. `applyScript` ruft darauf play() und das
    // laeuft ins Leere; das Skript des Auftrags klickt erst die Ueberlagerung
    // des Hosters, wartet auf die Quelle und rechnet die Stelle danach neu.
    // Das gemeinsame Gleichziehen bleibt aussen vor: es hat seinen eigenen
    // Ablauf (alle springen, alle melden sich bereit, dann startet das Relay).
    // Der Autostart uebernimmt beim darauffolgenden syncstart.
    if (urteil.tun !== "syncprepare" && auftrag && !auftrag.fertig && autostart.auftragGilt(auftrag, {
      jetzt: Date.now(),
      generation: generationen.get(autostartMarke(raum, nachricht && nachricht.key)) || 0,
      raum,
      key: String((nachricht && nachricht.key) || "")
    })) {
      // Ab hier laeuft ein Versuch: bis sein Bericht da ist oder die Frist
      // ablaeuft, schiesst kein zweiter hinterher.
      berichtOffenSeit = Date.now();
      return {
        tun: "autostart",
        grund: urteil.grund,
        auftrag: auftrag.id,
        skript: autostart.startScript(auftrag.id, ereignis, { playing: ereignis.playing })
      };
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

  /* ------------------------------------------------- Der Folgen-Autostart */

  /*
   * Was der Rechner nach einem Folgenwechsel selbstverstaendlich hat und
   * Android nicht hatte: einen laufenden Player.
   *
   * Am Rechner klopft `scheduleProviderAutoplay` im Takt an die frische Seite,
   * drueckt Play und liest zurueck, ob wirklich etwas laeuft. Auf Android
   * endete die Kette im Vollbild - mit Absicht, weil ein blinder Tipp auf eine
   * fremde Seite auch pausieren kann. Fuer eine Runde ist das zu wenig: wer
   * der Runde folgt, sass danach vor einem angehaltenen Bild.
   *
   * Der Auftrag ist der Ersatz fuer den blinden Tipp. Er weiss, wofuer er gilt
   * (Raum, Titel, Folge, laufende Nummer), er gilt nur begrenzt lange, er zaehlt
   * seine Versuche, und er ist erst fertig, wenn der Player gemeldet hat, dass
   * die Stelle wirklich weiterlaeuft.
   */

  /** Der eine offene Auftrag. Es laeuft immer nur ein Player. */
  let auftrag = null;
  /** Die laufende Nummer je Raum und Titel. Sie macht einen aelteren Auftrag ungueltig. */
  const generationen = new Map();
  /** Seit wann ein Versuch auf seinen Bericht wartet. 0 heisst: keiner offen. */
  let berichtOffenSeit = 0;

  function autostartMarke(room, key) {
    return `${String(room || "")}|${String(key || "")}`;
  }

  function autostartLage(lage) {
    // Ein oertlicher Auftrag kennt keinen Raum und keinen Titelschluessel - er
    // gehoert zu einer Serienadresse. Damit dieselbe Buchfuehrung fuer beide
    // gilt, wird er hier auf dieselben zwei Felder abgebildet: Raum leer,
    // Schluessel gleich der Serie hinter der Adresse.
    const oertlich = Boolean(auftrag && auftrag.oertlich);
    const room = oertlich ? "" : ((lage && lage.room) || "");
    const key = oertlich
      ? taste.urlSchluessel(String((lage && lage.url) || ""))
      : ((lage && lage.key) || "");
    return {
      jetzt: Date.now(),
      generation: generationen.get(autostartMarke(room, key)) || 0,
      raum: String(room),
      key: String(key),
      season: Number(lage && lage.season) || 0,
      episode: Number(lage && lage.episode) || 0,
      // Ob dieses Geraet die Runde fuehrt, und wo die Runde steht. Beides
      // zaehlt nur fuer den Start: der Host wartet auf keinen Hostzustand -
      // er ist einer.
      binHost: Boolean(lage && lage.binHost),
      stelle: Number(lage && lage.stelle) || 0,
      berichtOffenSeit
    };
  }

  function autostartAntwort(schritt) {
    return Object.assign({}, schritt, {
      auftrag: auftrag ? auftrag.id : "",
      versuche: auftrag ? auftrag.versuche : 0
    });
  }

  /**
   * Einen Auftrag anlegen - beim Folgenwechsel, den die Runde ausgeloest hat.
   *
   * <p>Die laufende Nummer steigt dabei. Ein Auftrag von vorhin, der noch auf
   * einen langsamen Player wartet, ist damit erledigt: wechselt der Host
   * waehrend des Ladens erneut, startet nur der neueste.
   */
  function autostartAnfordern(angaben) {
    const oertlich = Boolean(angaben && angaben.oertlich);
    const room = oertlich ? "" : ((angaben && angaben.room) || "");
    // Ohne Runde ist die Serie hinter der Adresse der Schluessel. Sie ist
    // stabil ueber den Folgenwechsel hinweg und unterscheidet zwei Titel, die
    // zufaellig bei derselben Folge stehen.
    const key = oertlich
      ? taste.urlSchluessel(String((angaben && angaben.url) || ""))
      : ((angaben && angaben.key) || "");
    if (!key) return null;
    const marke = autostartMarke(room, key);
    const generation = (generationen.get(marke) || 0) + 1;
    generationen.set(marke, generation);
    berichtOffenSeit = 0;
    auftrag = autostart.auftragAnlegen({
      generation,
      raum: room,
      key,
      season: (angaben && angaben.season) || 0,
      episode: (angaben && angaben.episode) || 0,
      url: (angaben && angaben.url) || "",
      hostId: (angaben && angaben.hostId) || "",
      playing: oertlich ? true : Boolean(angaben && angaben.playing),
      oertlich,
      // Der gespeicherte Stand. Er ersetzt beim oertlichen Start genau das,
      // was in einer Runde der Host beisteuert: die Stelle, an der es
      // weitergehen soll.
      stelle: (angaben && angaben.stelle) || 0,
      jetzt: Date.now()
    });
    return { auftrag: auftrag.id, generation, oertlich, key };
  }

  /**
   * Was als Naechstes zu tun ist.
   *
   * <p>Java fragt im Takt und tut, was hier steht: {@code anfordern} heisst
   * "den Stand der Runde neu holen" - die Antwort des Relays traegt den
   * frischen Hostzustand und loest ueber {@link steuerungPruefen} den Versuch
   * aus. {@code warten} heisst, dass ein Versuch noch laeuft oder der Abstand
   * noch nicht um ist. {@code aufgeben} beendet den Auftrag.
   */
  function autostartSchritt(lage) {
    if (!auftrag) return { tun: "aufgeben", grund: "kein auftrag", wartenMs: 0, auftrag: "", versuche: 0 };
    const l = autostartLage(lage);
    // Die Frist gilt in jedem Fall - auch fuer einen Auftrag, dessen Seite nie
    // aufgeht. Sonst klopfte der Takt ewig weiter.
    if (auftrag.erstellt && l.jetzt - auftrag.erstellt > autostart.AUFTRAG_FRIST_MS) {
      const id = auftrag.id;
      auftrag = null;
      berichtOffenSeit = 0;
      return { tun: "aufgeben", grund: "frist abgelaufen", wartenMs: 0, auftrag: id, versuche: 0 };
    }
    // Hier steht gerade ein anderer Titel. Zwei Faelle, und beide heissen
    // "warten" und nicht "aufgeben":
    //
    //   - Die Seite laedt noch. Ein Auftrag entsteht *vor* der Navigation, und
    //     bis sie durch ist, zeigt dieses Geraet noch die Folge davor.
    //   - In einem Raum liegen mehrere Titel. Die Frage nach dem einen darf den
    //     Auftrag des anderen nicht loeschen - Bleach, Korra und BLACK TORCH.
    //
    // Ausgefuehrt wird er dabei nicht: nur wenn Raum und Titel wirklich passen,
    // geht ein Versuch hinaus.
    if (l.raum !== auftrag.raum || l.key !== auftrag.key) {
      return { tun: "warten", grund: "andere seite", wartenMs: 1500, auftrag: auftrag.id, versuche: auftrag.versuche };
    }
    const schritt = autostart.naechsterSchritt(auftrag, l);
    if (schritt.tun === "anfordern") autostart.versuchVermerken(auftrag, l.jetzt);
    // In einer Runde heisst "anfordern": den Stand des Hosts neu holen - die
    // Antwort des Relays traegt ihn und loest ueber steuerungPruefen den
    // Versuch aus. Ohne Runde gibt es niemanden zu fragen: der Stand steht
    // schon im Auftrag, und das Skript kann sofort hinaus. Es ist dasselbe
    // Skript, dieselben Fristen und dieselben Abstaende - nur ohne Umweg.
    //
    // Und dasselbe gilt fuer den Host einer Runde. Er wartet sonst auf einen
    // Hostzustand, den es nicht gibt - er ist der Host. Gemessen am 25.08.2026
    // auf dem Telefon: allein in der Runde, vier Versuche, "Stand der Runde
    // wird geholt", und jedes Mal kam nichts zurueck, weil niemand da war, den
    // das Relay haette fragen koennen. Danach "kein start nach 4 Versuchen" und
    // ein stehendes Bild. Die Stelle der Runde steht im Raumzustand; sie ist
    // hier die richtige Vorgabe.
    if (schritt.tun === "anfordern" && (auftrag.oertlich || l.binHost)) {
      berichtOffenSeit = Date.now();
      const stelle = auftrag.oertlich ? auftrag.stelle : (l.stelle || auftrag.stelle || 0);
      return autostartAntwort({
        tun: "starten",
        grund: schritt.grund + (auftrag.oertlich ? "" : " (als Host)"),
        wartenMs: 0,
        skript: autostart.startScript(auftrag.id, {
          videoTime: stelle,
          timestamp: Date.now(),
          playing: true,
          // Es wird nichts hochgerechnet: die Stelle ist eine Stelle im Video
          // und keine Stelle plus Laufzeit einer Nachricht.
          hatUhr: false
        }, { playing: true })
      });
    }
    const antwort = autostartAntwort(schritt);
    if (schritt.tun === "aufgeben") {
      auftrag = null;
      berichtOffenSeit = 0;
    }
    return antwort;
  }

  /**
   * Den Bericht eines Versuchs einarbeiten.
   *
   * @return null, wenn die Zeile kein Bericht ist; sonst wie er ausging
   */
  function autostartBericht(zeile) {
    const bericht = autostart.berichtLesen(zeile);
    if (!bericht) return null;
    const passt = autostart.berichtVerarbeiten(auftrag, bericht);
    // Nur der eigene Bericht macht den Weg fuer den naechsten Versuch frei.
    // Der Player der vorigen Folge meldet sonst diesen Auftrag als erledigt.
    if (passt) berichtOffenSeit = 0;
    const antwort = {
      passt,
      ok: Boolean(bericht.ok),
      zustand: String(bericht.zustand || ""),
      grund: String(bericht.grund || ""),
      stelle: Number(bericht.stelle) || 0,
      fertig: Boolean(passt && auftrag && auftrag.fertig)
    };
    if (antwort.fertig) auftrag = null;
    return antwort;
  }

  /**
   * Den offenen Auftrag verwerfen - beim Verlassen und beim Ausschalten.
   *
   * <p>Mit einer Lage dazu heisst es: "dieses Geraet ist gerade von sich aus
   * hierhin gegangen". Dann wird nur verworfen, was woandershin zeigt. Ohne
   * diese Unterscheidung loeschte der Weg, den der Auftrag selbst ausgeloest
   * hat, den Auftrag: die Folge ging auf, das Seitenende meldete einen eigenen
   * Wechsel, und der Start war weg - gemessen am 25.08.2026 auf dem Telefon
   * ("Autostart verworfen: eigener Folgenwechsel", eine Sekunde nach
   * "Autostart angefordert").
   *
   * @return ob wirklich einer verworfen wurde
   */
  function autostartVerwerfen(lage) {
    if (!auftrag) return false;
    // Ein oertlicher Auftrag haengt an der Serienadresse und nicht an Raum und
    // Titelschluessel - sonst zeigte die Lage immer woandershin und der
    // Auftrag waere beim ersten eigenen Wechsel weg, auch wenn er genau
    // dorthin fuehrt.
    const oertlich = Boolean(auftrag.oertlich);
    const key = oertlich
      ? taste.urlSchluessel(String((lage && lage.url) || ""))
      : (lage && lage.key ? String(lage.key) : "");
    if (key) {
      const gemeint = autostart.auftragGilt(auftrag, {
        jetzt: Date.now(),
        generation: generationen.get(autostartMarke(oertlich ? "" : (lage && lage.room), key)) || 0,
        raum: oertlich ? "" : String((lage && lage.room) || ""),
        key,
        season: Number(lage && lage.season) || 0,
        episode: Number(lage && lage.episode) || 0
      });
      if (gemeint) return false;
    }
    auftrag = null;
    berichtOffenSeit = 0;
    return true;
  }

  /** Woran Java einen Bericht des Startskripts erkennt. */
  const MELDE_START = autostart.MELDE_START;

  /**
   * Woran Java eine Zwischenmeldung des Startskripts erkennt.
   *
   * <p>Sie traegt den Ladebalken: der Rahmen mit dem Video ist gefunden, die
   * Quelle ist geladen. Beides sind Beobachtungen aus dem Player - was daraus
   * im Ladebildschirm wird, entscheidet `startphasen`.
   */
  const MELDE_PHASE = autostart.MELDE_PHASE;

  // Verwaltendes reicht direkt durch. Eine eigene Pruefung waere hier falsch:
  // was ein gueltiger Raumcode ist, weiss das geteilte Modul.
  const durchreiche = {
    // Der Schluessel wird hier ergaenzt, wenn er fehlt: die Oberflaeche soll
    // ihn nicht selbst bilden - der Rechner tut es auch nicht.
    teilen: (item, room) => sicherstellen().teilen(
      Object.assign({}, item, { key: (item && item.key) || titelSchluessel(item) }), room),
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
    // Titel und Adresse in der Runde.
    titelSchluessel,
    lageFuer,
    adresseZuSchluessel,
    // Eintraege oeffnen.
    oeffnungsZiel,
    eintraegeMitAnbieter,
    // Das Mitschauen.
    steuerungPruefen,
    meldungSenden,
    meldungStand,
    folgenwechselMelden,
    zuruecksetzen,
    // Der Folgen-Autostart.
    autostartAnfordern,
    autostartSchritt,
    autostartBericht,
    autostartVerwerfen,
    MELDE_START,
    MELDE_PHASE,
    phaseLesen: (zeile) => autostart.phaseLesen(zeile),
    // Der Horcher, der im Player Play, Pause und Sprung bemerkt. Woertlich
    // dasselbe Skript, das der Rechner einsetzt.
    beobachterSkript: () => sync.beobachterScript(),
    // Woran Java eine Meldung dieses Horchers erkennt.
    MELDE_AKTION: sync.MELDE_AKTION,
    MELDE_STAND: sync.MELDE_STAND,
    MELDE_SYNC: sync.MELDE_SYNC,
    // Ob die Bedienelemente des Players zu sehen sind. Daran haengt die
    // Teilnehmerleiste im Vollbild.
    MELDE_UI: sync.MELDE_UI,
    uiLesen: (zeile) => sync.uiLesen(zeile),
    // Damit die Oberflaeche einen eingetippten Code beanstanden kann, bevor
    // sie ihn speichert - mit demselben Wortlaut wie am Rechner.
    codeBeanstandung,
    // Dasselbe fuer die Serveradresse. Sie wird auf dem Telefon und am
    // Fernseher eingetippt, also gehoert die Pruefung genau einmal hierher.
    serverNormalisieren,
    serverBeanstandung
  }, durchreiche);
})();
