"use strict";

/*
 * Empfehlungen auf dem Telefon - die Verkabelung, nicht die Rechnung.
 *
 * Die Rechnung steht in `empfehlungslauf.js`, demselben Modul wie am Rechner:
 * Geschmacksprofil, Kandidatensuche, Katalogtiefe, Erkundung, Begruendung. Hier
 * steht das Gegenstueck zu main.js - woher der Lauf seine vier Dinge bekommt:
 * eine Anbieterseite, den Geschmacks-Cache, die Ablage und jemanden, dem er
 * Bescheid sagen kann.
 *
 * Zwei Punkte sind auf Android anders geloest als am Rechner, und beide aus
 * demselben Grund: die Bruecke zwischen JavaScript und Java traegt jeden Wert
 * als eine einzige Zeichenkette.
 *
 *   Lesen   Der Geschmacks-Cache wird ueber eine abgefangene Adresse geholt
 *           (siehe Kern.DATEI_WIRT). Der WebView streamt sie von der Platte,
 *           ohne dass ein Byte durch die Bruecke muss - derselbe Kniff, den
 *           die Filterlisten schon benutzen.
 *   Sichern Zurueck geht er in Stuecken. Ein Cache mit mehreren tausend
 *           Katalogtiteln wird megabytegross; ihn in einem Aufruf zu
 *           uebergeben hiesse, die Groessengrenze zwischen den Prozessen zu
 *           suchen.
 *
 * Der Lauf selbst merkt davon nichts: er ruft `cacheLesen()` und bekommt ein
 * Objekt aus dem Arbeitsspeicher, genau wie `loadTasteCache()` am Rechner.
 */
(function () {
  const empfehlungslauf = require("empfehlungslauf");
  const metadatenModul = require("metadaten");

  // So lange wird gesammelt, bevor der Cache wirklich auf die Platte geht. Am
  // Rechner sind es 1,5 Sekunden; hier etwas mehr, weil jedes Sichern die
  // Stuecke einzeln ueber die Bruecke schickt.
  const SICHERN_VERZUG_MS = 4000;
  const STUECK = 256 * 1024;

  let lauf = null;
  let geschmack = null;
  let metadaten = null;
  let metadatenStand = null;
  let anbieter = [];
  let ablage = [];
  let sichernTimer = 0;
  let metadatenTimer = 0;

  function java() {
    return window.AndroidEmpfehlung || null;
  }

  function leererGeschmack() {
    return { version: empfehlungslauf.TASTE_CACHE_VERSION, pages: {}, lists: {}, anzeigen: {}, personal: null };
  }

  /**
   * Eine Datei, die Java bereitlegt.
   *
   * <p>Bewusst ueber den eigenen Abruf des WebViews (`browserAbruf`) und nicht
   * ueber das ueberschriebene `fetch`: dieses geht nach Java und braechte die
   * Antwort als Text zurueck - also genau der Weg, den diese Adresse vermeiden
   * soll.
   */
  async function dateiLesen(adresse) {
    const abruf = window.ElfixKern && window.ElfixKern.browserAbruf;
    if (!abruf || !adresse) return null;
    try {
      const antwort = await abruf(adresse, { cache: "no-store" });
      if (!antwort || !antwort.ok) return null;
      const text = await antwort.text();
      return text ? JSON.parse(text) : null;
    } catch (fehler) {
      // Kein Cache heisst: der erste Lauf kostet ein paar Abrufe mehr. Sonst
      // nichts - deshalb ist das hier kein Fehler, den jemand sehen muesste.
      return null;
    }
  }

  /** Eine Zeichenkette in Stuecken nach Java. */
  function dateiSchreiben(art, text) {
    const brief = java();
    if (!brief || typeof brief.teil !== "function") return;
    const gesamt = Math.max(1, Math.ceil(text.length / STUECK));
    for (let nummer = 0; nummer < gesamt; nummer += 1) {
      brief.teil(art, nummer, text.slice(nummer * STUECK, (nummer + 1) * STUECK));
    }
    brief.fertig(art, gesamt);
  }

  function geschmackSichernBald() {
    if (sichernTimer) return;
    sichernTimer = setTimeout(() => {
      sichernTimer = 0;
      try {
        dateiSchreiben("geschmack", JSON.stringify(geschmack || leererGeschmack()));
      } catch (fehler) {
        melde("fehler", "Geschmacks-Cache nicht gesichert: " + fehler);
      }
    }, SICHERN_VERZUG_MS);
  }

  function metadatenSichernBald() {
    if (metadatenTimer) return;
    metadatenTimer = setTimeout(() => {
      metadatenTimer = 0;
      try {
        if (metadatenStand) dateiSchreiben("metadaten", JSON.stringify(metadatenStand));
      } catch (fehler) {
        melde("fehler", "Metadaten-Cache nicht gesichert: " + fehler);
      }
    }, SICHERN_VERZUG_MS);
  }

  function melde(stufe, text) {
    const brief = window.AndroidKern;
    if (brief && typeof brief.protokoll === "function") brief.protokoll(stufe, text);
  }

  /**
   * Den Lauf aufsetzen.
   *
   * <p>Erst danach beantwortet dieses Modul irgendetwas - vorher fehlt ihm der
   * Cache, und ohne ihn wuerde der erste Abruf zwei Dutzend Anbieterseiten
   * holen, die schon auf der Platte liegen.
   *
   * @param vorgaben { geschmackUrl, metadatenUrl, relay, grenzen, debug }
   */
  async function starten(vorgaben) {
    const angaben = vorgaben || {};
    geschmack = (await dateiLesen(angaben.geschmackUrl)) || leererGeschmack();
    // Eine aeltere Fassung des Caches traegt Listen, die nur den Anfang des
    // Alphabets kennen. Dieselbe Entscheidung wie am Rechner: die Detailseiten
    // bleiben, die Listen fliegen.
    if (Number(geschmack.version) !== empfehlungslauf.TASTE_CACHE_VERSION) {
      const seiten = geschmack.pages && typeof geschmack.pages === "object" ? geschmack.pages : {};
      for (const eintrag of Object.values(seiten)) {
        if (!eintrag || typeof eintrag !== "object") continue;
        delete eintrag.related;
        eintrag.at = 0;
      }
      geschmack = {
        version: empfehlungslauf.TASTE_CACHE_VERSION,
        pages: seiten, lists: {}, anzeigen: {}, personal: null
      };
    }
    if (!geschmack.pages) geschmack.pages = {};
    if (!geschmack.lists) geschmack.lists = {};
    if (!geschmack.anzeigen) geschmack.anzeigen = {};

    metadatenStand = await dateiLesen(angaben.metadatenUrl);
    metadaten = metadatenModul.erstellen({
      basis: String(angaben.relay || ""),
      laden: () => metadatenStand,
      speichern: (daten) => {
        metadatenStand = daten;
        metadatenSichernBald();
      }
    });

    lauf = empfehlungslauf.erstellen({
      // `fetch` geht hier bereits ueber Java (siehe kern-host.js) und traegt
      // damit die Kekse der laufenden Anbieter-Sitzung.
      holen: async (url) => {
        try {
          const antwort = await fetch(url, { headers: { accept: "text/html,application/xhtml+xml" } });
          if (!antwort || !antwort.ok) return null;
          return { html: await antwort.text(), url: antwort.url || url };
        } catch (fehler) {
          return null;
        }
      },
      cacheLesen: () => geschmack,
      cacheSchreiben: geschmackSichernBald,
      anbieter: () => anbieter,
      eintraege: () => ablage,
      metadaten: () => metadaten,
      melden: () => window.ElfixKern.ereignis("empfehlung.neu", null),
      grenzen: angaben.grenzen || {},
      debug: Boolean(angaben.debug)
    });
    return {
      seiten: Object.keys(geschmack.pages).length,
      listen: Object.keys(geschmack.lists).length,
      metadaten: metadatenStand ? Object.keys(metadatenStand.eintraege || {}).length : 0
    };
  }

  /**
   * Anbieter und Ablage nachreichen.
   *
   * <p>Beides aendert sich waehrend der Sitzung - eine Folge wird geschaut, ein
   * Titel kommt auf die Watchlist. Der Lauf fragt beides bei jedem Durchgang
   * neu ab, deshalb genuegt es, den Stand hier abzulegen; gerechnet wird
   * dadurch nichts.
   */
  function standSetzen(neueAnbieter, neueAblage) {
    anbieter = Array.isArray(neueAnbieter) ? neueAnbieter : [];
    ablage = Array.isArray(neueAblage) ? neueAblage : [];
    return { anbieter: anbieter.length, eintraege: ablage.length };
  }

  function bereit() {
    return Boolean(lauf);
  }

  async function neuesVonAnbietern(proAnbieter, refresh) {
    if (!lauf) return [];
    return lauf.neuesVonAnbietern(Number(proAnbieter) || 6, Boolean(refresh));
  }

  async function persoenlich(limit, art, refresh, ohneHaupt) {
    if (!lauf) return [];
    return lauf.persoenlich(Number(limit) || 24, Boolean(refresh),
      String(art || ""), ohneHaupt !== false);
  }

  async function entdeckungsSeite(art, versatz, limit, refresh) {
    if (!lauf) return { items: [], versatz: 0, gesamt: 0, fertig: true, waechst: false };
    return lauf.entdeckungsSeite(String(art || ""), Number(versatz) || 0,
      Number(limit) || 30, Boolean(refresh));
  }

  function vergissMuedigkeit(url, titel, art) {
    if (lauf) lauf.vergissMuedigkeit(url, titel, art);
    return null;
  }

  function poolVerwerfen() {
    if (lauf) lauf.poolVerwerfen();
    return null;
  }

  module.exports = {
    starten,
    standSetzen,
    bereit,
    neuesVonAnbietern,
    persoenlich,
    entdeckungsSeite,
    vergissMuedigkeit,
    poolVerwerfen
  };
})();
