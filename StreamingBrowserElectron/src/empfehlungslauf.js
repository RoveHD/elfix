/*
 * Der Empfehlungslauf - einmal fuer beide Geraete.
 *
 * Bis hierher stand er in main.js: Geschmacksprofil, Kandidatensuche,
 * Katalogtiefe, Entdeckungsseiten und die Anreicherung mit externen
 * Metadaten - rund elfhundert Zeilen, die an Electron nur durch drei Dinge
 * gebunden waren: den Abruf einer Seite, das Lesen und Schreiben des
 * Geschmacks-Caches und ein Fenster, dem man Bescheid sagt. Android konnte
 * damit nichts anfangen und hatte deshalb ueberhaupt keine Empfehlungen -
 * weder die Reihen der Startseite noch die Entdeckungsseiten dahinter.
 *
 * Ein Nachbau in Java waere der zweite Weg gewesen, die Regel zweimal
 * hinzuschreiben; genau das hat der gemeinsame Kern schon einmal beendet
 * (siehe kern-host.js). Also wandert der Lauf hierher, bekommt seine drei
 * Bindungen als Umgebung gereicht und laeuft danach unveraendert am Rechner
 * wie auf dem Telefon.
 *
 * Die Umgebung, die {@link erstellen} erwartet:
 *
 *   holen(url)        -> Promise<{ html, url } | null>   eine Anbieterseite
 *   cacheLesen()      -> { version, pages, lists, anzeigen, personal }
 *   cacheSchreiben()  -> void            (darf verzoegern und sammeln)
 *   anbieter()        -> Provider[]      nur die eingeschalteten
 *   eintraege()       -> Favorite[]      die ganze Ablage
 *   metadaten()       -> Client aus metadaten.js, oder null
 *   melden()          -> void            "es gibt Neues zu rechnen"
 *   debug             -> boolean         Rechenwege in die Konsole
 *   grenzen           -> { listenGroesse, genreKandidaten, poolGroesse }
 *                        kleinere Werte fuer Geraete mit wenig Speicher;
 *                        fehlen sie, gelten die Zahlen dieser Datei
 *
 * Der Zustand (Caches, laufende Abrufe) liegt in der Instanz. Zwei Instanzen
 * teilen ihn nicht - am Rechner gibt es genau eine, auf dem Telefon ebenso.
 */
const empfehlung = require("./empfehlung");
const titelModul = require("./titel");
const taste = require("./taste");
const { cleanBaseMediaTitle } = require("./fortschritt");
const providerModel = require("../shared/provider-model");
const {
  extractGenres,
  extractRelatedItems,
  extractTitleMeta,
  extractCatalogItems,
  extractPagination,
  seitenStichprobe,
  seitenAdresse,
  extractNewReleaseItems,
  extractHeroItem,
  extractDiscoverItems,
  extractPosterFallbacks,
  extractReleaseDate
} = require("./discover");

// --- Die Zahlen, an denen der Lauf haengt ------------------------------------
//
// Sie standen in main.js zwischen dreihundert anderen. Hier stehen sie bei dem,
// was sie steuert - und gelten dadurch auf beiden Geraeten gleich.

const DISCOVER_CACHE_MS = 15 * 60 * 1000;
// Detailseiten aendern ihre Genres praktisch nie, Uebersichtsseiten schon.
const TASTE_PAGE_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const TASTE_LIST_CACHE_MS = 6 * 60 * 60 * 1000;
// Wie viele Verlaufstitel praegen das Profil? Alle.
//
// Frueher waren es die letzten zwoelf. Wer viel schaut, hat einen
// abgeschlossenen Titel damit nach drei Tagen verloren: gemessen an einem
// echten Verlauf lag "Dragonball Z" auf Platz 47, obwohl es gerade fertig
// geschaut war. Dass alte Titel das Profil verwaessern, verhindert die
// Frische-Kurve in empfehlung.js; die Obergrenze schuetzt nur vor dem
// Entarteten, denn bewertet wird jeder Kandidat gegen jeden Verlaufstitel.
const TASTE_HISTORY_MAX = 500;
const TASTE_ENRICH_LIMIT = 18;
// Die Genre-Uebersichten der Anbieter sind blaetterbar. So viele Seiten werden
// je Liste gelesen - gleichmaessig ueber die ganze Blaetterleiste verteilt,
// damit der Katalog und nicht nur sein Anfang in die Auswahl kommt.
const TASTE_LIST_PAGES = 8;
// Obergrenze je Liste. Die Liste waechst beim Scrollen nach (siehe
// tasteListErweitern); die Grenze steht, damit eine einzelne Liste die Ablage
// nicht sprengt.
const TASTE_LIST_SIZE = 2400;
// So viele Seiten liest ein Nachschlag je Liste. Klein gehalten: das laeuft,
// waehrend jemand scrollt.
const TASTE_LIST_NACHSCHLAG = 4;
// So viele Eintraege werden aus einer einzelnen Katalogseite gelesen.
const TASTE_LIST_ROH = 120;
// Version des Geschmacks-Caches. Wird sie erhoeht, verwirft der Wirt beim Lesen
// die alten Listen.
const TASTE_CACHE_VERSION = 3;
// So viele Titel aus den Genre-Listen gehen ins Ranking. Gekappt wird nach
// Relevanz, nicht nach Listenposition (siehe nachRelevanzKappen).
const TASTE_GENRE_KANDIDATEN = 6000;
// So viele der aussichtsreichsten Kandidaten bekommen vor der endgueltigen
// Bewertung ihre echten Genres von der Detailseite.
const TASTE_TIEFE = 60;
// Ab wie vielen verschiedenen Werken zaehlt ein Genre des Profils voll, wenn es
// darum geht, dafuer einen ganzen Katalog zu holen?
const GENRE_TRAEGER_VOLL = 3;
// So viele Titel je Anbieter zeigt bereits die Reihe "Neu bei deinen Anbietern".
const TASTE_NEW_OFFSET = 6;
const TASTE_FETCH_PARALLEL = 4;
const PERSONAL_CACHE_MS = 15 * 60 * 1000;
const PERSONAL_POOL_SIZE = 150;
// So tief reicht der Pool, aus dem die Entdeckungsseiten schoepfen. Gerechnet
// wird er nur einmal - die Startseite nimmt seinen Anfang.
const ENTDECKUNG_POOL_SIZE = 4000;
const ENTDECKUNG_CACHE_MS = 30 * 60 * 1000;
// So viele Titel gehen an "Empfohlen fuer dich"; die Kategoriereihen bedienen
// sich erst danach.
const PERSONAL_MAIN_SIZE = 24;
// So lange nach einem Anreicherungslauf bleibt es dabei. Ohne diese Bremse
// zoege jeder Durchlauf den naechsten nach sich.
const METADATEN_PAUSE_MS = 90 * 1000;
// So viele Detailseiten liest ein Anreicherungslauf nach.
// So nah am Ende der Entdeckungsliste wird nachgeholt.
// So viele Listen je Katalogrunde, und wie lange zwischen zwei Runden.

/**
 * Ein Empfehlungslauf mit seiner Umgebung.
 *
 * @param umgebung siehe Kopf dieser Datei
 */
function erstellen(umgebung) {
  // Drei Zahlen darf der Wirt kleiner stellen, und nur diese drei: sie
  // entscheiden ueber Speicher und Rechenzeit, nicht ueber die Rangfolge. Ein
  // Telefon hat weder den Arbeitsspeicher eines Rechners noch dessen Ruhe -
  // der Kern-WebView traegt daneben schon den Werbefilter. Was dabei
  // herauskommt, ist dieselbe Liste, nur kuerzer; ein Titel, der am Rechner auf
  // Platz 12 steht, steht auf dem Telefon nicht auf Platz 40.
  const grenzen = umgebung.grenzen || {};
  const listenGroesse = Number(grenzen.listenGroesse) > 0 ? Number(grenzen.listenGroesse) : TASTE_LIST_SIZE;
  const genreKandidaten = Number(grenzen.genreKandidaten) > 0
    ? Number(grenzen.genreKandidaten) : TASTE_GENRE_KANDIDATEN;
  const poolGroesse = Number(grenzen.poolGroesse) > 0 ? Number(grenzen.poolGroesse) : ENTDECKUNG_POOL_SIZE;
  // Der Zustand des Laufs. Er ueberdauert einzelne Abrufe, aber nicht die
  // Instanz - beim Rechner das Programm, auf dem Telefon den Kern-WebView.
  const discoverCache = new Map();
  const erscheinungsdaten = new Map();
  const entdeckungCache = new Map();
  const katalogZeiger = new Map();
  let katalogPending = null;
  let katalogLetzter = 0;
  let personalPending = null;
  // `vollstaendig` unterscheidet den frisch gerechneten Pool von dem, was beim
  // Start von der Platte kam - dort liegt nur der Anfang. Die Startseite merkt
  // das nicht, eine Entdeckungsseite schon.
  let personalCache = { at: 0, items: [], signatur: "", vollstaendig: false };
  let metadatenPending = null;
  let metadatenZuletzt = 0;


  async function collectRecommendations(proAnbieter, refresh) {
    const anbieter = umgebung.anbieter();
    if (!anbieter.length) return [];
    const listen = await Promise.all(anbieter.map((provider) => (
      discoverForProvider(provider, refresh).catch(() => [])
    )));

    const gemischt = [];
    for (let index = 0; index < proAnbieter; index += 1) {
      for (const liste of listen) {
        if (liste[index]) gemischt.push(liste[index]);
      }
    }
    await ergaenzeErscheinungsdaten(gemischt);
    return gemischt;
  }

  // Das Erscheinungsdatum steht nicht auf der Startseite des Anbieters, sondern
  // erst auf der Seite des Titels. Es wird deshalb nachgeholt - nur fuer die
  // Kacheln, die wirklich in der Reihe stehen, und gemerkt, damit dieselbe Seite
  // nicht mehrfach geladen wird.
  async function ergaenzeErscheinungsdaten(items) {
    const offen = items.filter((item) => item?.url && !erscheinungsdaten.has(item.url));
    await inBatches(offen, TASTE_FETCH_PARALLEL, async (item) => {
      try {
        // Der Abruf liefert `{ html, url }`, nicht den Quelltext. Vorher ging
        // das ganze Objekt in die Extraktion; `String(...)` machte daraus
        // "[object Object]", und damit fand kein Muster je ein Datum. Deshalb
        // stand auf keiner Kachel von "Neu bei deinen Anbietern" jemals eines.
        const seite = await umgebung.holen(seriesPageUrl(item.url) || item.url);
        erscheinungsdaten.set(item.url, extractReleaseDate(seite?.html) || "");
      } catch {
        erscheinungsdaten.set(item.url, "");
      }
      return null;
    });
    for (const item of items) {
      const datum = erscheinungsdaten.get(item.url);
      if (datum) item.releasedAt = datum;
    }
  }

  async function discoverForProvider(provider, refresh) {
    const cached = discoverCache.get(provider.id);
    if (!refresh && cached && Date.now() - cached.at < DISCOVER_CACHE_MS) return cached.items;

    const startUrl = providerModel.normalizeUrl(provider.startUrl || "");
    if (!startUrl) return [];
    const seite = await umgebung.holen(startUrl);
    if (!seite) return cached?.items || [];

    const html = seite.html;
    const basis = seite.url;
    // Zuerst die Neuheiten-Reihe der Seite ("Neue Animes", "Neu auf
    // SerienStream", "Neu veroeffentlichte Filme") - nur die gehoert in diese
    // Reihe. Dazu das grosse Titelbild der Startseite, wo es eines gibt.
    let items = extractNewReleaseItems(html, basis, provider, 30);
    const hero = extractHeroItem(html, basis, provider);
    if (hero && !items.some((item) => item.url === hero.url)) items.unshift(hero);

    // Kennt eine Seite keine solche Reihe, bleibt es beim bisherigen Verhalten:
    // alles von der Startseite, notfalls nur Poster mit Titel.
    if (!items.length) {
      items = extractDiscoverItems(html, basis, provider);
      if (items.length < 4) {
        const ersatz = extractPosterFallbacks(html, basis, provider);
        if (ersatz.length > items.length) items = ersatz;
      }
    }
    if (items.length) discoverCache.set(provider.id, { at: Date.now(), items });
    return items;
  }


  // Was ELFIX ueber ein Werk weiss, in der Form, die das Relay erwartet. Die
  // Angaben stammen von der Detailseite des Anbieters (siehe tastePage) - ohne
  // sie bleibt der Titel, und damit faengt die Verwechslungsgefahr an.
  function metadatenWunsch(name, url, meta) {
    const titel = String(name || "").trim();
    if (!titel) return null;
    return {
      art: candidateMediaType(url) || "serie",
      titel,
      jahr: meta?.jahr || 0,
      imdb: meta?.imdb || "",
      altTitel: meta?.titelAlt || []
    };
  }

  // Die Seitenangaben zu einer Adresse, soweit sie schon einmal gelesen wurde.
  function seitenMeta(url) {
    const seite = seriesPageUrl(url);
    if (!seite) return null;
    return umgebung.cacheLesen().pages?.[seite]?.meta || null;
  }

  // Externe Daten aus dem lokalen Cache - ohne einen einzigen Netzabruf. Das ist
  // der Weg, den das Bauen der Empfehlungen nimmt.
  function metadatenAusCache(name, url) {
    const wunsch = metadatenWunsch(name, url, seitenMeta(url));
    if (!wunsch) return null;
    try {
      return umgebung.metadaten().ausCache(wunsch) || null;
    } catch {
      return null;
    }
  }

  /*
   * Was AniList beziehungsweise TMDB ueber genau diesen einen Titel sagen.
   *
   * Der Verlaufs-Kasten in der Mediathek fragt danach: ob eine Serie noch
   * laeuft, entscheidet dort ueber "Auf aktuellem Stand" gegen "Staffel
   * abgeschlossen", und das ist nichts, was in der eigenen Ablage stuende.
   *
   * Der Wunsch wird mit derselben Funktion gebaut wie im Anreicherungslauf -
   * gefragt wird sonst unter einem anderen Schluessel, und der Cache, den der
   * Lauf gerade gefuellt hat, waere fuer den Kasten leer.
   *
   * Ein Netzabruf ist erlaubt, aber nie Pflicht: liegt nichts im Cache und ist
   * das Relay nicht erreichbar, kommt `null` zurueck und der Kasten rechnet
   * ohne externe Angaben weiter.
   */
  async function titelMetadaten(name, url) {
    const wunsch = metadatenWunsch(name, url, seitenMeta(url));
    if (!wunsch) return null;
    let client;
    try {
      client = umgebung.metadaten();
    } catch {
      return null;
    }
    const bekannt = client.ausCache(wunsch);
    // Ein Eintrag aus der Zeit vor den Laufzeit-Feldern ist nicht falsch, nur
    // unvollstaendig. Er wird deshalb nicht verworfen - dieser eine Titel wird
    // frisch gefragt, und der naechste Aufruf findet ihn vollstaendig vor.
    // Dasselbe gilt fuer den Trailer: ein Eintrag aus der Zeit davor kennt das
    // Feld nicht, und wer die Karte aufmacht, soll den Knopf sehen und nicht
    // erst beim uebernaechsten Mal.
    const unvollstaendig = bekannt
      && (client.laufStatusFehlt(bekannt) || client.trailerFehlt?.(bekannt));
    if (bekannt && !unvollstaendig) return bekannt;
    if (!client.bereit() || client.gesperrt()) return bekannt || null;
    try {
      const ergebnisse = await client.nachschlagen([wunsch], { frisch: Boolean(unvollstaendig) });
      return ergebnisse?.get(wunsch.schluessel) || bekannt || null;
    } catch {
      return bekannt || null;
    }
  }

  // Zu welchem Anbieter gehoert eine Adresse? Gebraucht, um eine Detailseite
  // nachzulesen, ohne den Kandidaten selbst mitschleppen zu muessen.
  function anbieterZuAdresse(url) {
    try {
      const wirt = new URL(url).host;
      return umgebung.anbieter().find((provider) => {
        try {
          return new URL(provider.startUrl || "").host === wirt;
        } catch {
          return false;
        }
      }) || null;
    } catch {
      return null;
    }
  }

  // So viele Detailseiten liest ein Anreicherungslauf nach.
  //
  // Das ist der Schritt, an dem die Zuordnung wirklich haengt. Gemessen an einem
  // echten Profil: von 49 Filmen im Vorschlagspool hatte KEINER eine
  // IMDB-Kennung und nur elf ein Erscheinungsjahr - Filmo fuehrt keine Kennung,
  // und die Detailseiten der uebrigen waren nie gelesen worden. Damit bleibt fuer
  // die Anfrage nur der deutsche Titel, und mit dem allein findet TMDB "Die
  // Odyssee" oder "Der letzte Tempelritter" nicht. Bei Anime faellt das nicht
  // auf: AniList sucht ueber Romaji- und Englischtitel, die die Anbieter ohnehin
  // fuehren - dort waren 46 von 51 zugeordnet.
  const METADATEN_SEITEN_JE_LAUF = 60;

  // Die Anreicherung im Hintergrund. Die Reihenfolge der Eintraege ist die
  // Rangfolge: erst der Verlauf, dann die Vorschlaege, dann der Rest der Ablage.
  // Was nicht mehr in einen Lauf passt, kommt beim naechsten Mal.
  //
  // Zwei Schritte, und der erste ist der wichtigere: erst die Detailseiten, dann
  // die Datenbank. Ohne Jahr und Kennung ist die zweite Anfrage ein Titelraten.
  async function metadatenAnreichern(eintraege) {
    if (metadatenPending) return metadatenPending;
    const jetzt = Date.now();
    if (jetzt - metadatenZuletzt < METADATEN_PAUSE_MS) return null;
    let client;
    try {
      client = umgebung.metadaten();
    } catch {
      return null;
    }
    if (!client.bereit() || client.gesperrt()) return null;

    const liste = (eintraege || []).filter((eintrag) => eintrag?.titel && eintrag?.url);
    const wunschVon = (eintrag) => metadatenWunsch(eintrag.titel, eintrag.url, seitenMeta(eintrag.url));
    if (!liste.some((eintrag) => client.fehltImCache(wunschVon(eintrag)))) return null;
    metadatenZuletzt = jetzt;

    const lauf = (async () => {
      // Schritt 1: fehlende Seitenangaben nachlesen. Die Seiten liegen danach
      // eine Woche im Cache, die Kosten fallen also einmal je Titel an.
      const ohneAngaben = liste
        .filter((eintrag) => !seitenMeta(eintrag.url))
        .filter((eintrag) => client.fehltImCache(wunschVon(eintrag)))
        .slice(0, METADATEN_SEITEN_JE_LAUF);
      if (ohneAngaben.length) {
        await inBatches(ohneAngaben, TASTE_FETCH_PARALLEL, async (eintrag) => {
          const provider = anbieterZuAdresse(eintrag.url);
          const seite = seriesPageUrl(eintrag.url);
          if (!provider || !seite) return null;
          await tastePage(seite, provider, false);
          return null;
        });
      }

      // Schritt 2: jetzt erst fragen - mit allem, was die Seiten hergeben.
      const offen = liste.map(wunschVon).filter(Boolean)
        .filter((wunsch) => client.fehltImCache(wunsch));
      if (!offen.length) return new Map();
      return client.nachschlagen(offen);
    })()
      .then((ergebnisse) => {
        if (!ergebnisse || !ergebnisse.size) return;
        if (umgebung.debug) {
          console.log(`[metadaten] ${ergebnisse.size} Titel angereichert,`
            + ` ${JSON.stringify(client.statistik())}`);
        }
        // Jetzt liegen bessere Daten vor als beim letzten Rechnen. Der
        // vorhandene Stand bleibt sichtbar; neu gerechnet wird beim naechsten
        // Abruf, und der kommt gleich - die Oberflaeche wird angestossen.
        personalCache = { ...personalCache, at: 0 };
        umgebung.melden();
      })
      .catch(() => null)
      .finally(() => {
        if (metadatenPending === lauf) metadatenPending = null;
      });
    metadatenPending = lauf;
    return lauf;
  }

  // Detailseite eines Titels: Genres und der "Das schauen andere"-Block.
  async function tastePage(url, provider, refresh = false) {
    const cache = umgebung.cacheLesen();
    const gespeichert = cache.pages[url];
    // Ein Eintrag ohne `meta` stammt aus der Zeit vor den Seitenangaben. Er ist
    // nicht alt, sondern unvollstaendig - und die fehlenden Angaben sind genau
    // die, mit denen sich ein Werk exakt zuordnen laesst. Also einmal nachlesen,
    // statt eine Woche auf den Ablauf zu warten.
    const vollstaendig = gespeichert && gespeichert.meta;
    if (!refresh && vollstaendig && Date.now() - gespeichert.at < TASTE_PAGE_CACHE_MS) return gespeichert;

    try {
      const seite = await umgebung.holen(url);
      if (!seite) return gespeichert || null;
      const eintrag = {
        at: Date.now(),
        genres: extractGenres(seite.html, seite.url),
        related: extractRelatedItems(seite.html, seite.url, provider, 10),
        // IMDB-Kennung, Jahr, Altersfreigabe und fremdsprachige Titel. Sie
        // stehen auf denselben Seiten und wurden bisher gelesen und
        // weggeworfen. Fuer die Zuordnung zu TMDB und AniList sind sie das
        // Wertvollste, was ELFIX hat: mit einer IMDB-Kennung wird aus einem
        // Titelvergleich eine eindeutige Aufloesung.
        meta: extractTitleMeta(seite.html, seite.url)
      };
      cache.pages[url] = eintrag;
      umgebung.cacheSchreiben();
      return eintrag;
    } catch {
      return gespeichert || null;
    }
  }

  // Uebersichtsseite (Genre-Liste) mit den Titeln, die dort stehen.
  //
  // Eine solche Uebersicht ist blaetterbar und zeigt je Seite nur dreissig bis
  // vierzig Titel von mehreren tausend. Wer nur die erste Seite liest, bekommt
  // bei AniWorld und S.to den Anfang des Alphabets ("#Compass", "100-man",
  // "A Certain Magical Index", "Acapulco H.E.A.T.") und bei Filmo die letzten
  // Neuerscheinungen - in beiden Faellen keinen Querschnitt des Katalogs. Genau
  // daher kamen die vielen A-Titel und die Kinderanimation in den Empfehlungen.
  //
  // Deshalb wird die Blaetterleiste ausgelesen und ueber ihre ganze Laenge
  // gleichmaessig gelesen. Kein Zufall: dieselbe Seitenzahl ergibt immer
  // dieselben Seiten, sonst sortierte sich die Startseite bei jedem Durchlauf um.
  async function tasteList(url, provider, refresh = false) {
    const cache = umgebung.cacheLesen();
    const gespeichert = cache.lists[url];
    const gueltig = gespeichert
      && Number(gespeichert.version) === TASTE_CACHE_VERSION
      && Date.now() - gespeichert.at < TASTE_LIST_CACHE_MS;
    if (!refresh && gueltig) return gespeichert.items;

    try {
      const erste = await umgebung.holen(url);
      if (!erste) return gespeichert?.items || [];
      const blaettern = extractPagination(erste.html, erste.url);
      const seiten = seitenStichprobe(blaettern.letzte, TASTE_LIST_PAGES);

      // Seite 1 liegt schon vor - nur der Rest wird geholt.
      const weitere = seiten
        .filter((nummer) => nummer > 1)
        .map((nummer) => seitenAdresse(blaettern.muster, nummer, erste.url));
      const geladen = await inBatches(weitere, TASTE_FETCH_PARALLEL, (adresse) => umgebung.holen(adresse));

      const items = [];
      const gesehen = new Set();
      for (const seite of [erste, ...geladen]) {
        if (!seite) continue;
        for (const item of extractCatalogItems(seite.html, seite.url, provider, TASTE_LIST_ROH)) {
          if (gesehen.has(item.url)) continue;
          gesehen.add(item.url);
          items.push(item);
        }
      }
      // Faellt die Blaetterleiste aus (Anbieter ohne Paginierung, Fehler beim
      // Nachladen), bleibt der alte Stand die bessere Auskunft als eine Liste,
      // die wieder nur den Anfang enthaelt.
      if (!items.length) return gespeichert?.items || [];

      const auswahl = gleichmaessigVerteilt(items, listenGroesse);
      cache.lists[url] = {
        at: Date.now(),
        version: TASTE_CACHE_VERSION,
        seiten: blaettern.letzte,
        // Welche Seiten schon gelesen wurden. Ohne diese Liste weiss ein
        // Nachschlag nicht, wo er anfangen soll, und holt wieder dieselben.
        geholt: seiten,
        muster: blaettern.muster,
        basis: erste.url,
        items: auswahl
      };
      umgebung.cacheSchreiben();
      return auswahl;
    } catch {
      return gespeichert?.items || [];
    }
  }

  // Eine schon gelesene Genre-Liste um weitere Seiten ergaenzen.
  //
  // Das ist der Unterschied zwischen "die ersten vierhundert Titel" und einer
  // Seite, die weiterlaedt, solange es etwas zu laden gibt. Geholt werden nur
  // Seiten, die noch nicht dran waren - gleichmaessig ueber den Rest verteilt,
  // damit nicht nur das Alphabet weiterwaechst.
  //
  // Rueckgabe: wie viele Titel wirklich dazugekommen sind. Null heisst, dass die
  // Liste erschoepft ist - und nur dann darf die Oberflaeche sagen, dass es
  // nichts mehr gibt.
  async function tasteListErweitern(url, provider) {
    const cache = umgebung.cacheLesen();
    const eintrag = cache.lists[url];
    if (!eintrag) return 0;
    if ((eintrag.items || []).length >= listenGroesse) return 0;

    // Listen aus der Zeit vor dem Nachschlag kennen weder ihr Blaettermuster
    // noch die schon gelesenen Seiten. Beides laesst sich mit einem Abruf
    // nachtragen: das Muster steht auf Seite 1, und gelesen wurde damals genau
    // die Stichprobe, die derselbe Code auch heute zieht.
    if (!eintrag.muster || !eintrag.seiten) {
      const erste = await umgebung.holen(url);
      if (!erste) return 0;
      const blaettern = extractPagination(erste.html, erste.url);
      if (!blaettern.muster || !blaettern.letzte) return 0;
      eintrag.muster = blaettern.muster;
      eintrag.basis = erste.url;
      eintrag.seiten = blaettern.letzte;
      eintrag.geholt = seitenStichprobe(blaettern.letzte, TASTE_LIST_PAGES);
      cache.lists[url] = eintrag;
    }

    const geholt = new Set(eintrag.geholt || []);
    const offen = [];
    for (let nummer = 1; nummer <= eintrag.seiten; nummer += 1) {
      if (!geholt.has(nummer)) offen.push(nummer);
    }
    if (!offen.length) return 0;
    const naechste = gleichmaessigVerteilt(offen, TASTE_LIST_NACHSCHLAG);

    try {
      const adressen = naechste.map((nummer) => seitenAdresse(eintrag.muster, nummer, eintrag.basis || url));
      const geladen = await inBatches(adressen, TASTE_FETCH_PARALLEL, (adresse) => umgebung.holen(adresse));
      const bekannt = new Set((eintrag.items || []).map((item) => item.url));
      const neue = [];
      for (const seite of geladen) {
        if (!seite) continue;
        for (const item of extractCatalogItems(seite.html, seite.url, provider, TASTE_LIST_ROH)) {
          if (bekannt.has(item.url)) continue;
          bekannt.add(item.url);
          neue.push(item);
        }
      }
      // Auch ohne Ertrag gelten die Seiten als gelesen - sonst versucht es der
      // naechste Nachschlag endlos mit denselben.
      eintrag.geholt = [...geholt, ...naechste];
      if (neue.length) {
        eintrag.items = [...(eintrag.items || []), ...neue].slice(0, listenGroesse);
        eintrag.at = Date.now();
      }
      cache.lists[url] = eintrag;
      umgebung.cacheSchreiben();
      return neue.length;
    } catch {
      return 0;
    }
  }

  // Wie schwer wiegt ein Genre des Profils, wenn daraus Kandidaten geholt werden?
  //
  // Nicht einfach sein Gewicht. Ein Genre, das nur an ein oder zwei Werken
  // haengt, holt sonst einen ganzen Katalog herbei: "Die Legende von Korra"
  // laeuft bei S.to unter "Zeichentrick", und daraus wurde das komplette
  // Animationsangebot - also vor allem Kinderfilme. Dieselbe Regel steht in
  // empfehlung.js schon fuer die Begruendung ("Aus einem Film folgt kein
  // Geschmack"); hier entscheidet sie ueber den Pool.
  //
  // Ein spezifischer Tag ("Fighting-Shounen", "Isekai") zaehlt umgekehrt mehr als
  // ein Sammelgenre, das halbe Kataloge umfasst.

  function profilGenreGewicht(profil, key) {
    return profil.genreWert(key)
      * (empfehlung.istSpezifisch(key) ? 1.6 : 1)
      * Math.min(1, profil.genreTraeger(key) / GENRE_TRAEGER_VOLL);
  }

  // Wie gut passt ein einzelner Katalogtitel zum Profil? Mehr als die Listen
  // hergeben, ist es nicht: in wie vielen Lieblingsgenres er steht, wie schwer
  // die wiegen, und ob er zu einer Reihe gehoert, die im Verlauf vorkommt -
  // "Naruto Shippuden" neben "Naruto" ist der Grund, warum es diese Auswahl
  // ueberhaupt gibt. Gerundet, damit "gleich gut" auch wirklich eine Gruppe
  // bildet und nicht an der fuenfzehnten Nachkommastelle auseinanderfaellt.
  function katalogGuete(item, profil) {
    let wert = 0;
    for (const key of item.genres || []) wert += profil.genreWert(key);
    const reihe = titelModul.franchiseSchluessel(titelModul.zerlegen(item.title || ""));
    if (reihe && profil.reihen.has(reihe)) wert += 2;
    wert += 0.05 * profil.anbieterAnteil(item.providerId);
    return Math.round(wert * 1000) / 1000;
  }

  // Die besten "anzahl" aus einer Menge - aber ohne die Reihenfolge der
  // Anbieterliste durchschlagen zu lassen. Gleichauf liegende Titel sind die
  // Mehrheit, und wer von ihnen den Anfang nimmt, nimmt das Alphabet. Volle
  // Guetegruppen wandern ganz hinein, die eine ueberlaufende wird gleichmaessig
  // ueber ihre Laenge verteilt.
  function besteAusMenge(menge, anzahl, guete) {
    if (anzahl <= 0) return [];
    if (menge.length <= anzahl) return menge;
    const gruppen = new Map();
    for (const item of menge) {
      const wert = guete(item);
      const fach = gruppen.get(wert) || [];
      fach.push(item);
      gruppen.set(wert, fach);
    }
    const auswahl = [];
    for (const wert of [...gruppen.keys()].sort((links, rechts) => rechts - links)) {
      const rest = anzahl - auswahl.length;
      if (rest <= 0) break;
      const fach = gruppen.get(wert);
      auswahl.push(...(fach.length <= rest ? fach : gleichmaessigVerteilt(fach, rest)));
    }
    return auswahl;
  }

  // Aus tausenden Katalogtiteln die aussichtsreichsten waehlen.
  //
  // Drei Dinge sollen dabei nicht passieren.
  //
  // Erstens darf die Reihenfolge der Anbieterliste nicht durchschlagen - sie ist
  // alphabetisch, und wer von ihr den Anfang nimmt, empfiehlt wieder nur "A".
  //
  // Zweitens soll die Auswahl nicht gewuerfelt sein: derselbe Geschmack muss
  // dieselben Kandidaten ergeben.
  //
  // Drittens - und das ist der Grund fuer die Quoten - darf der Pool nicht auf
  // das staerkste Genre zusammenfallen. Wer nach blosser Passung kappt, waehlt
  // fast nur noch Titel des Spitzengenres aus: bei diesem Verlauf trugen 81% der
  // Kandidaten "Abenteuer", und die Reihe "Anime fuer dich" wurde zu einer Liste
  // beliebiger Abenteuer-Anime. Das Profil ist aber nicht ein Genre, sondern eine
  // Mischung. Also bekommt jedes Lieblingsgenre einen Anteil an den Plaetzen, der
  // seinem Gewicht im Profil entspricht - und innerhalb seines Anteils
  // entscheidet wieder die Passung.
  function nachRelevanzKappen(kandidaten, profil, grenze) {
    const liste = kandidaten || [];
    if (liste.length <= grenze) return liste;
    const guete = (item) => katalogGuete(item, profil);

    // Welche Profilgenres kommen im Angebot ueberhaupt vor?
    const gewichte = new Map();
    for (const item of liste) {
      for (const key of item.genres || []) {
        if (gewichte.has(key)) continue;
        const wert = profilGenreGewicht(profil, key);
        if (wert > 0) gewichte.set(key, wert);
      }
    }
    const genres = [...gewichte.entries()].sort((links, rechts) => (
      rechts[1] - links[1] || (links[0] < rechts[0] ? -1 : 1)
    ));
    const summe = genres.reduce((wert, [, gewicht]) => wert + gewicht, 0);
    // Ohne Profilgenres gibt es nichts zu quotieren - dann bleibt nur, den
    // Katalog gleichmaessig auszuduennen.
    if (!summe) return gleichmaessigVerteilt(liste, grenze);

    const vergeben = new Set();
    const auswahl = [];
    for (const [key, gewicht] of genres) {
      const rest = grenze - auswahl.length;
      if (rest <= 0) break;
      // Mindestens einer je Genre: auch ein schwaches Lieblingsgenre soll
      // ueberhaupt vorkommen.
      const anteil = Math.min(rest, Math.max(1, Math.round(grenze * gewicht / summe)));
      const fach = liste.filter((item) => !vergeben.has(item) && (item.genres || []).includes(key));
      for (const item of besteAusMenge(fach, anteil, guete)) {
        vergeben.add(item);
        auswahl.push(item);
      }
    }

    // Bleiben Plaetze frei - etwa weil ein Genre weniger Titel hat als seine
    // Quote -, gehen sie an die beste uebrige Passung.
    if (auswahl.length < grenze) {
      const uebrig = liste.filter((item) => !vergeben.has(item));
      auswahl.push(...besteAusMenge(uebrig, grenze - auswahl.length, guete));
    }
    return auswahl;
  }

  // Aus einer langen Liste gleichmaessig verteilt auswaehlen. Deterministisch:
  // dieselbe Liste ergibt immer dieselbe Auswahl, sonst sortierte sich die
  // Startseite bei jedem Durchlauf um.
  function gleichmaessigVerteilt(items, anzahl) {
    const liste = items || [];
    if (liste.length <= anzahl) return liste;
    const schritt = liste.length / anzahl;
    const auswahl = [];
    for (let index = 0; index < anzahl; index += 1) {
      auswahl.push(liste[Math.floor(index * schritt)]);
    }
    return auswahl;
  }

  // Aus einer Episoden-Adresse die Seite der Serie machen - nur dort stehen
  // Genres und Aehnlichkeitsblock.
  function seriesPageUrl(value) {
    try {
      const url = new URL(String(value || ""));
      url.hash = "";
      url.search = "";
      url.pathname = url.pathname
        .replace(/\/(?:episode|folge|film)-\d+\/?$/i, "")
        .replace(/\/(?:staffel|season)-\d+\/?$/i, "")
        .replace(/\/+$/, "");
      return url.href;
    } catch {
      return "";
    }
  }

  async function inBatches(items, size, worker) {
    const ergebnisse = [];
    for (let index = 0; index < items.length; index += size) {
      const teil = items.slice(index, index + size);
      ergebnisse.push(...await Promise.all(teil.map((item) => worker(item).catch(() => null))));
    }
    return ergebnisse;
  }

  // Der Verlauf, aus dem das Profil entsteht: zuletzt Geschautes zuerst, nur von
  // Anbietern, die noch eingeschaltet sind.
  function tasteHistoryEntries() {
    const aktive = new Set(umgebung.anbieter().map((provider) => provider.id));
    return umgebung.eintraege()
      .filter((favorite) => aktive.has(favorite.providerId))
      .filter((favorite) => favorite.watched || favorite.favorite || favorite.completed || Number(favorite.position) > 0)
      .slice()
      .sort((links, rechts) => (
        Date.parse(rechts.lastWatchedAt || rechts.openedAt || rechts.createdAt || 0)
        - Date.parse(links.lastWatchedAt || links.openedAt || links.createdAt || 0)
      ))
      .slice(0, TASTE_HISTORY_MAX);
  }

  // Anime, Serie oder Film - abgelesen an der Adresse, nicht am Anbieter, damit
  // auch selbst angelegte Seiten in den Kategoriereihen landen. Anime-Filme
  // bleiben bewusst bei Anime.
  function candidateMediaType(value) {
    try {
      const pfad = new URL(String(value || "")).pathname.toLowerCase();
      if (/\/anime(?:\/|$)/.test(pfad)) return "anime";
      if (/\/(?:movies?|filme?)(?:\/|-)/.test(pfad)) return "film";
      if (/\/(?:serie|series|show|tv)(?:\/|$)/.test(pfad)) return "serie";
      return "";
    } catch {
      return "";
    }
  }

  // Alle vier Reihen der Startseite fragen gleichzeitig an. Sie teilen sich
  // deshalb einen Durchlauf: einmal bewerten, danach nur noch filtern.
  async function collectPersonalRecommendations(limit, refresh, type = "", excludeMain = true) {
    const alle = await personalRecommendationPool(refresh);
    // "Empfohlen fuer dich" bekommt den Anfang der Liste. Die Kategoriereihen
    // fangen dahinter an, damit kein Titel zweimal auf der Startseite steht.
    // Ist die Hauptreihe ausgeblendet, waeren diese Titel sonst gar nicht zu
    // sehen - dann greifen die Kategorien auf die ganze Liste zu.
    const haupt = excludeMain ? alle.slice(0, PERSONAL_MAIN_SIZE) : [];
    if (!type) {
      const gezeigt = alle.slice(0, limit);
      merkeEmpfehlungAngezeigt(gezeigt);
      return gezeigt;
    }

    const vergeben = new Set(haupt.map((item) => item.werkKey));
    const gezeigt = alle
      .filter((item) => candidateMediaType(item.url) === type)
      .filter((item) => !vergeben.has(item.werkKey))
      .slice(0, limit);
    merkeEmpfehlungAngezeigt(gezeigt);
    return gezeigt;
  }

  // --- Entdeckungsseiten ---------------------------------------------------------
  //
  // "Mehr anzeigen" oeffnet je Art eine eigene Seite, die beim Scrollen
  // nachlaedt. Sie benutzt denselben Pool und dieselbe Engine wie die Startseite
  // - nur tiefer. Neu ist hier genau eine Ueberlegung: was passiert, wenn die
  // starken persoenlichen Treffer ausgehen?
  //
  // Nicht aufhoeren, und auch nicht in eine Bestenliste kippen. Stattdessen
  // mischt sich mit wachsender Tiefe Erkundung dazu: Titel, die zum Profil
  // weniger zu sagen haben, dafuer aber extern gut belegt sind. Oben bleibt es
  // bei einem Zehntel, weit unten sind es zwei Fuenftel. Der Anteil waechst
  // stetig, nicht in Stufen - der Nutzer soll keine Grenze bemerken.
  // Aus der nach Punkten sortierten Liste wird die Reihenfolge, die der Nutzer
  // sieht - das Mischen selbst steht in empfehlung.js, hier steht nur, woran
  // sich die Erkundung orientiert.
  //
  // Wie gut ist ein Titel unabhaengig vom Profil belegt? Bewertung nur, wo sie
  // auf genug Stimmen steht - sonst zaehlt die Bekanntheit, und wo auch die
  // fehlt, entscheidet der stabile Streuwert, damit dieselbe Liste immer gleich
  // aussieht.
  function erkundungsWert(eintrag) {
    // Auch ein Erkundungsplatz soll nach Moeglichkeit etwas sagen koennen. Ein
    // Titel, zu dem die Engine einen belegten Grund gefunden hat, geht deshalb
    // vor - sonst sammeln sich ausgerechnet auf den eingeschobenen Plaetzen die
    // Karten ohne Aussage, und je tiefer man scrollt, desto oefter steht dort
    // "Koennte einen Versuch wert sein".
    const sagbar = eintrag.grund && eintrag.grund !== "EXPLORATION" ? 0.25 : 0;
    const extern = metadatenAusCache(eintrag.title, eintrag.url);
    if (!extern) return sagbar + empfehlung.streuwert(eintrag.werkKey) * 0.1;
    const stimmen = Number(extern.bewertungStimmen) || 0;
    const beliebt = Number(extern.beliebtheit) || 0;
    const bewertung = typeof extern.bewertung === "number" ? extern.bewertung : 0;
    const belegt = extern.quelle === "anilist" ? beliebt >= 10000 : stimmen >= 500;
    const guete = belegt ? Math.max(0, Math.min(1, (bewertung - 5) / 5)) : 0;
    // Bekanntheit logarithmisch: zwischen 1000 und 10000 Nutzern liegt mehr als
    // zwischen 100000 und 110000.
    const reichweite = beliebt > 0 ? Math.min(1, Math.log10(beliebt + 1) / 6) : 0;
    return sagbar + guete * 0.7 + reichweite * 0.3 + empfehlung.streuwert(eintrag.werkKey) * 0.05;
  }

  // katalogZeiger merkt sich, wo der naechste Nachschlag je Art ansetzt. Ohne
  // ihn holt jede Runde dieselben Listen und die uebrigen kaemen nie dran.
  // So viele Listen je Runde. Klein gehalten, und das ist der Punkt: eine Runde
  // soll in Sekunden fertig sein und ihre neuen Titel sofort sichtbar machen.
  // Alle 23 Listen auf einmal zu erweitern hiess, den Nutzer eine Minute vor
  // einem Skelett warten zu lassen, bevor irgendetwas erscheint.
  const KATALOG_LISTEN_JE_RUNDE = 3;
  // Zwischen zwei Nachschlaegen. Sie kosten Anbieterseiten, und wer schnell
  // scrollt, soll sie nicht im Sekundentakt ausloesen.
  const KATALOG_PAUSE_MS = 20 * 1000;
  // So nah am Ende der Liste wird nachgeholt - lange bevor der Nutzer es sieht.
  const ENTDECKUNG_VORLAUF = 90;

  // Den Katalog verbreitern, wenn die Entdeckungsseite gegen ihr Ende laeuft.
  //
  // Geholt werden weitere Seiten der Genre-Uebersichten, die ohnehin schon im
  // Cache liegen - dieselbe Quelle, nur tiefer. Danach wird der Pool neu
  // gerechnet; die Entdeckungsseiten haengen ihre neuen Titel hinten an, statt
  // die Reihenfolge zu verwerfen (siehe entdeckungsListe).
  // Welche Listen tragen ueberhaupt zu dieser Art bei? Abgelesen an dem, was
  // schon in ihnen steht - ein Anbieter kann mehrere Arten fuehren, und eine
  // Filmliste zu erweitern hilft der Anime-Seite nicht.
  function listenFuerArt(type) {
    const listen = umgebung.cacheLesen().lists || {};
    const passende = [];
    for (const [url, eintrag] of Object.entries(listen)) {
      const items = eintrag?.items || [];
      if (!items.length) continue;
      const treffer = items.filter((item) => candidateMediaType(item.url) === type).length;
      if (treffer / items.length >= 0.5) passende.push(url);
    }
    return passende;
  }

  function katalogErweitern(type) {
    if (katalogPending) return katalogPending;
    const jetzt = Date.now();
    if (jetzt - katalogLetzter < KATALOG_PAUSE_MS) return null;

    const anbieterNachWirt = new Map();
    for (const provider of umgebung.anbieter()) {
      try {
        anbieterNachWirt.set(new URL(provider.startUrl || "").host, provider);
      } catch {
        // Ohne brauchbare Startadresse laesst sich kein Wirt zuordnen.
      }
    }
    const alle = listenFuerArt(type);
    if (!alle.length) return null;
    // Reihum, damit ueber mehrere Runden jede Liste drankommt.
    const zeiger = katalogZeiger.get(type) || 0;
    const listen = [];
    for (let index = 0; index < Math.min(KATALOG_LISTEN_JE_RUNDE, alle.length); index += 1) {
      listen.push(alle[(zeiger + index) % alle.length]);
    }
    katalogZeiger.set(type, (zeiger + listen.length) % alle.length);
    katalogLetzter = jetzt;

    const lauf = inBatches(listen, 2, async (url) => {
      let provider = null;
      try {
        provider = anbieterNachWirt.get(new URL(url).host) || null;
      } catch {
        return 0;
      }
      if (!provider) return 0;
      return tasteListErweitern(url, provider);
    })
      .then((ergebnisse) => {
        const dazu = ergebnisse.reduce((summe, wert) => summe + (Number(wert) || 0), 0);
        if (umgebung.debug) {
          console.log(`[katalog] ${type}: ${dazu} neue Titel aus ${listen.length} Listen`);
        }
        if (dazu > 0) {
          // Neu rechnen, damit die neuen Titel bewertet werden. Die bestehende
          // Reihenfolge der Entdeckungsseiten bleibt erhalten.
          personalCache = { ...personalCache, at: 0 };
        }
        return dazu;
      })
      .catch(() => 0)
      .finally(() => {
        if (katalogPending === lauf) katalogPending = null;
      });
    katalogPending = lauf;
    return lauf;
  }

  // Die fertige Reihenfolge je Art. Sie wird einmal gebaut und dann nur noch
  // geschnitten - sonst verschoebe sich die Liste unter dem Nutzer, waehrend er
  // scrollt.
  async function entdeckungsListe(type, refresh) {
    const alle = await personalRecommendationPool(refresh);
    const signatur = verlaufSignatur();
    const bekannt = entdeckungCache.get(type);
    if (!refresh && bekannt && bekannt.signatur === signatur
      && Date.now() - bekannt.at < ENTDECKUNG_CACHE_MS) {
      return bekannt.items;
    }
    const eigene = (alle || []).filter((eintrag) => candidateMediaType(eintrag.url) === type);
    const geordnet = empfehlung.erkundungsReihenfolge(eigene, erkundungsWert);

    // Was der Nutzer schon gesehen hat, bleibt an seinem Platz - Neues haengt
    // hinten an. Sonst verschoebe sich die Liste unter ihm, waehrend er scrollt,
    // und der Versatz zeigte auf einen anderen Titel als beim vorigen Abruf.
    // Das gilt fuer beide Faelle: gewachsener Katalog und nachgerechneter Pool.
    const vorher = bekannt?.signatur === signatur ? bekannt.items : null;
    let liste = geordnet;
    if (vorher?.length) {
      const gesehen = new Set(vorher.map((eintrag) => eintrag.werkKey));
      liste = [...vorher, ...geordnet.filter((eintrag) => !gesehen.has(eintrag.werkKey))];
    }

    // Kam der Pool gekuerzt von der Platte, ist diese Reihenfolge vorlaeufig.
    // Gemerkt wird sie trotzdem, damit die ersten Karten ihren Platz behalten -
    // aber mit Zeitstempel 0, sodass der naechste Abruf sie ergaenzt, statt sie
    // fuer bare Muenze zu nehmen.
    const vorlaeufig = !personalCache.vollstaendig;
    if (vorlaeufig) personalRecommendationPool(false, true).catch(() => null);
    entdeckungCache.set(type, { at: vorlaeufig ? 0 : Date.now(), signatur, items: liste });
    return liste;
  }

  // Ein Abschnitt der Liste. Der Versatz kommt von der Oberflaeche, und weil die
  // Liste zwischen zwei Abrufen dieselbe bleibt, kann kein Titel doppelt kommen.
  async function entdeckungsSeite(type, versatz, limit, refresh) {
    const liste = await entdeckungsListe(type, refresh);
    const teil = liste.slice(versatz, versatz + limit);
    // Was als Naechstes drankaeme, wird schon einmal angereichert - dann steht
    // beim Weiterscrollen mehr fest als ein Genre. Das laeuft im Hintergrund und
    // haelt diese Antwort nicht auf.
    const naechste = liste.slice(versatz + limit, versatz + limit * 3);
    metadatenAnreichern([...teil, ...naechste]
      .map((eintrag) => ({ titel: eintrag.title, url: eintrag.url })));

    // Waechst da noch etwas? Zwei ganz verschiedene Faelle, und sie zu
    // verwechseln kostet den Nutzer eine Minute vor einem Skelett.
    //
    //   1. Der Pool kam gekuerzt von der Platte. Dann ist die Liste kurz, das
    //      Ende sofort erreicht - aber es fehlt nur die Rechnung, nicht der
    //      Katalog. Sie laeuft bereits (siehe entdeckungsListe) und ist in
    //      Sekunden da. Hier darf auf keinen Fall der Anbieter befragt werden.
    //   2. Der Pool ist vollstaendig und trotzdem zu Ende. Erst dann lohnt es,
    //      weitere Katalogseiten zu holen.
    let waechst = false;
    if (!personalCache.vollstaendig) {
      waechst = true;
    } else if (versatz + limit >= liste.length - ENTDECKUNG_VORLAUF) {
      waechst = Boolean(katalogErweitern(type)) || Boolean(katalogPending);
    }
    return {
      items: teil,
      versatz,
      gesamt: liste.length,
      // "Fertig" heisst: es kommt nichts mehr. Solange noch Seiten nachgeholt
      // werden, ist das schlicht nicht wahr.
      fertig: versatz + teil.length >= liste.length && !waechst,
      waechst
    };
  }

  // Woran haengt die Gueltigkeit der Empfehlungen? Nur an dem, was den Geschmack
  // wirklich veraendert: was abgeschlossen wurde, was auf der Watchlist steht,
  // was verschwunden ist. Nicht an jeder Sekunde Wiedergabezeit - sonst rechnet
  // die App dauernd neu und holt dabei zwei Dutzend Seiten.
  function verlaufSignatur() {
    return tasteHistoryEntries()
      .map((favorite) => [
        favorite.id,
        favorite.completed ? 1 : 0,
        favorite.watched ? 1 : 0,
        favorite.favorite ? 1 : 0,
        Math.floor((Number(favorite.progress) || 0) / 10),
        (favorite.completedEpisodes || []).length
      ].join("."))
      .join("|");
  }

  // `refresh` und `neuRechnen` sind zwei verschiedene Dinge, und sie zu
  // verwechseln kostet zweihundertsechzig Anbieterseiten.
  //
  //   refresh     alles noch einmal holen - Detailseiten, Genre-Listen, alles.
  //               Das ist die Wirkung des Knopfs "Neu berechnen".
  //   neuRechnen  nur die Rechnung wiederholen, aus dem, was schon im Cache
  //               liegt. Das braucht die Entdeckungsseite, wenn der Pool von der
  //               Platte kam und deshalb gekuerzt ist - dabei hat sich an den
  //               Seiten nichts geaendert, nur an der gewuenschten Tiefe.
  async function personalRecommendationPool(refresh, neuRechnen = false) {
    // Beim ersten Zugriff nach dem Start liegen die Empfehlungen des letzten
    // Laufs in der Ablage. Sie werden sofort ausgeliefert, damit die Startseite
    // nicht auf zwei Dutzend Netzabrufe wartet.
    if (!personalCache.items.length) {
      const gespeichert = umgebung.cacheLesen().personal;
      if (gespeichert?.items?.length) {
        personalCache = {
          at: Number(gespeichert.at) || 0,
          items: gespeichert.items,
          signatur: gespeichert.signatur || "",
          vollstaendig: false
        };
      }
    }
    const signatur = verlaufSignatur();
    const passt = personalCache.signatur === undefined || personalCache.signatur === signatur;
    const frisch = personalCache.items.length && passt && Date.now() - personalCache.at < PERSONAL_CACHE_MS;
    if (!refresh && !neuRechnen && frisch) return personalCache.items;
    // Veraltet, aber vorhanden: erst die alten Vorschlaege zeigen und im
    // Hintergrund neu rechnen. Nur wenn gar nichts da ist, wird gewartet.
    if (personalPending) {
      return personalCache.items.length && !refresh && !neuRechnen ? personalCache.items : personalPending;
    }

    const lauf = buildPersonalRecommendations(poolGroesse, refresh)
      .then((items) => {
        personalCache = { at: Date.now(), items, signatur: verlaufSignatur(), vollstaendig: true };
        const cache = umgebung.cacheLesen();
        // Auf die Platte geht nur der Anfang: daraus baut sich die Startseite
        // beim naechsten Start sofort auf. Den langen Rest rechnet die
        // Entdeckungsseite neu, wenn sie geoeffnet wird.
        cache.personal = {
          at: personalCache.at,
          signatur: personalCache.signatur,
          items: items.slice(0, PERSONAL_POOL_SIZE)
        };
        umgebung.cacheSchreiben();
        return items;
      })
      .catch(() => personalCache.items)
      .finally(() => {
        if (personalPending === lauf) personalPending = null;
      });
    personalPending = lauf;
    return lauf;
  }

  async function buildPersonalRecommendations(limit, refresh) {
    const anbieter = umgebung.anbieter();
    const verlauf = tasteHistoryEntries();
    if (!anbieter.length || !verlauf.length) return [];
    const anbieterNach = new Map(anbieter.map((provider) => [provider.id, provider]));
    const jetzt = Date.now();

    // 1. Geschmacksprofil aus den geschauten Titeln.
    const saat = (await inBatches(verlauf, TASTE_FETCH_PARALLEL, async (favorite) => {
      const provider = anbieterNach.get(favorite.providerId);
      const url = seriesPageUrl(favorite.url || favorite.normalizedUrl);
      if (!provider || !url) return null;
      const seite = await tastePage(url, provider, refresh);
      return {
        favoriteId: favorite.id,
        title: cleanBaseMediaTitle(favorite.title, favorite.url) || favorite.title,
        providerId: provider.id,
        url,
        weight: empfehlung.signalStaerke(favorite),
        genres: seite?.genres || [],
        related: seite?.related || [],
        // Jahr, IMDB-Kennung und fremdsprachige Titel - die Grundlage jeder
        // Zuordnung zu TMDB oder AniList.
        meta: seite?.meta || null
      };
    })).filter(Boolean);
    if (!saat.length) return [];

    // Das Profil entsteht aus den Eintraegen selbst - mit Fortschritt,
    // Zeitstempeln und den eben geholten Genres. Frueher ging nur ein Auszug
    // hinein; damit fehlten dem Ranking Abbrueche, Watchlist und Sitzung.
    const genreNach = new Map(saat.map((eintrag) => [eintrag.favoriteId, eintrag.genres.map((g) => g.key)]));
    // Externe Daten zum Verlauf, ausschliesslich aus dem lokalen Cache. Ein
    // fehlender Eintrag ist hier kein Problem, sondern der Normalfall beim
    // ersten Start - dann rechnet alles wie vorher, und der naechste Durchlauf
    // weiss mehr.
    const externNach = new Map(saat.map((eintrag) => [
      eintrag.favoriteId,
      metadatenAusCache(eintrag.title, eintrag.url)
    ]));
    const profil = empfehlung.profilBauen(verlauf.map((favorite) => ({
      ...favorite,
      baseTitle: cleanBaseMediaTitle(favorite.title, favorite.url) || favorite.title,
      // Anime, Serie oder Film - feiner als `type`, das Anime und Serie
      // zusammenwirft. Fuer die Bewertung aendert das nichts; die Begruendung
      // kann damit sagen, dass jemand vor allem Anime schaut.
      art: candidateMediaType(favorite.url) || favorite.type || "",
      genres: genreNach.get(favorite.id) || [],
      extern: externNach.get(favorite.id) || null
    })), jetzt);

    // 2. Was schon in der Ablage steht, faellt raus - anhand der Werk-Identitaet,
    // damit derselbe Titel bei einem anderen Anbieter ebenfalls erkannt wird.
    const ausschluss = new Set();
    for (const favorite of umgebung.eintraege()) {
      const name = cleanBaseMediaTitle(favorite.title, favorite.url) || favorite.title;
      if (!name) continue;
      const art = candidateMediaType(favorite.url) === "film" ? "film" : favorite.type;
      ausschluss.add(titelModul.werkSchluessel(name, art));
    }

    const kandidaten = [];

    // 3a. Was der Anbieter selbst als aehnlich ausweist - das staerkste Signal.
    const staerksteSaat = Math.max(...saat.map((eintrag) => eintrag.weight), 1e-9);
    for (const eintrag of saat) {
      for (const item of eintrag.related) {
        kandidaten.push({
          ...item,
          via: "related",
          seedTitle: eintrag.title,
          seedWeight: eintrag.weight / staerksteSaat,
          genres: []
        });
      }
    }

    // 3b. Titel aus den Lieblingsgenres. Welche Adresse zu einem Genre gehoert,
    // wissen nur die Detailseiten - also von dort einsammeln und den Genres des
    // Profils zuordnen.
    const genreAdressen = new Map();
    const merkeGenreAdresse = (providerId, genre) => {
      if (!providerId || !genre?.key || !genre.url) return;
      const bekannt = genreAdressen.get(genre.key) || { key: genre.key, label: genre.label, urls: new Map() };
      if (!bekannt.urls.has(providerId)) bekannt.urls.set(providerId, genre.url);
      genreAdressen.set(genre.key, bekannt);
    };
    for (const eintrag of saat) {
      for (const genre of eintrag.genres) merkeGenreAdresse(eintrag.providerId, genre);
    }
    // Die zwoelf Titel des Verlaufs reichen dafuer nicht aus. Ob Filmos
    // Action-Katalog ueberhaupt erreichbar ist, haengt sonst daran, ob gerade
    // zufaellig ein Actionfilm unter den letzten zwoelf steht - faellt er heraus,
    // besteht die Reihe "Filme fuer dich" ploetzlich nur noch aus Abenteuer- und
    // Animationsfilmen, also vor allem Familienkino. Deshalb zaehlt jede
    // Detailseite mit, die schon einmal gelesen wurde: welche Adresse ein Genre
    // bei einem Anbieter hat, aendert sich nicht.
    const anbieterNachWirt = new Map();
    for (const provider of anbieter) {
      try {
        anbieterNachWirt.set(new URL(provider.startUrl || "").host, provider.id);
      } catch {
        // Ohne brauchbare Startadresse laesst sich kein Wirt zuordnen.
      }
    }
    for (const [adresse, eintrag] of Object.entries(umgebung.cacheLesen().pages || {})) {
      let providerId = "";
      try {
        providerId = anbieterNachWirt.get(new URL(adresse).host) || "";
      } catch {
        continue;
      }
      for (const genre of eintrag?.genres || []) merkeGenreAdresse(providerId, genre);
    }
    // Welche Genre-Listen werden geholt? Die schwersten des Profils - gewichtet
    // wie in profilGenreGewicht beschrieben, also nicht nach blossem Gewicht.
    const beliebteste = [...profil.genres.entries()]
      .map(([key]) => [key, profilGenreGewicht(profil, key)])
      .sort((links, rechts) => rechts[1] - links[1])
      .slice(0, 6)
      .map(([key]) => genreAdressen.get(key))
      .filter(Boolean);

    const genreSeiten = [];
    for (const genre of beliebteste) {
      for (const [providerId, url] of genre.urls) {
        if (!anbieterNach.has(providerId)) continue;
        genreSeiten.push({ genre, providerId, url });
      }
    }
    const genreListen = await inBatches(genreSeiten, TASTE_FETCH_PARALLEL, async (seite) => {
      const provider = anbieterNach.get(seite.providerId);
      const items = await tasteList(seite.url, provider, refresh);
      return { seite, items };
    });
    // Steht ein Titel in mehreren Lieblingsgenres, ist das der beste Hinweis, den
    // die Listen hergeben - also die Genres pro Titel zusammenfuehren, statt ihn
    // mehrfach mit je einem Genre zu fuehren.
    const ausGenres = new Map();
    for (const treffer of genreListen) {
      if (!treffer?.items?.length) continue;
      for (const item of treffer.items) {
        const schluessel = taste.urlSchluessel(item.url);
        const vorhanden = ausGenres.get(schluessel);
        if (vorhanden) {
          if (!vorhanden.genres.includes(treffer.seite.genre.key)) vorhanden.genres.push(treffer.seite.genre.key);
          continue;
        }
        ausGenres.set(schluessel, {
          ...item,
          via: "genre",
          genres: [treffer.seite.genre.key],
          genreLabel: treffer.seite.genre.label
        });
      }
    }
    // Der Katalog ist gross - was davon ueberhaupt zur Wahl steht, entscheidet
    // die Passung zum Profil, nicht die Position in der Anbieterliste.
    kandidaten.push(...nachRelevanzKappen([...ausGenres.values()], profil, genreKandidaten));

    // 3c. Neues von den Startseiten - die Genres dazu werden gleich nachgeholt.
    const startseiten = await Promise.all(anbieter.map((provider) => (
      discoverForProvider(provider, false).catch(() => [])
    )));

    // Was die Reihe "Neu bei deinen Anbietern" bereits zeigt, gehoert nicht noch
    // einmal in die Vorschlaege - auf der Startseite soll nichts doppelt stehen.
    for (const liste of startseiten) {
      for (const item of liste.slice(0, TASTE_NEW_OFFSET)) {
        ausschluss.add(titelModul.werkSchluessel(item.title, candidateMediaType(item.url)));
      }
    }
    // Die vorderen Titel jeder Startseite stehen schon in der Reihe "Neu bei
    // deinen Anbietern" - hier faengt es dahinter an, sonst steht derselbe Titel
    // zweimal untereinander.
    const neu = [];
    for (let index = TASTE_NEW_OFFSET; index < TASTE_NEW_OFFSET + 8; index += 1) {
      for (const liste of startseiten) {
        if (liste[index]) neu.push({ ...liste[index], via: "new", genres: [] });
      }
    }

    // 4. Fuer die neuen Titel die Genres nachladen, damit sie ueberhaupt zum
    // Profil passen koennen. Streng begrenzt, der Rest bleibt ungenutzt.
    const anzureichern = neu
      .filter((item) => !item.viaSearch
        && !ausschluss.has(titelModul.werkSchluessel(item.title, candidateMediaType(item.url))))
      .slice(0, TASTE_ENRICH_LIMIT);
    await inBatches(anzureichern, TASTE_FETCH_PARALLEL, async (item) => {
      const provider = anbieterNach.get(item.providerId);
      const url = seriesPageUrl(item.url);
      if (!provider || !url) return null;
      const seite = await tastePage(url, provider, false);
      item.genres = (seite?.genres || []).map((genre) => genre.key);
      // Die Startseiten verlinken die neueste Folge. Als Empfehlung ist die
      // Uebersichtsseite der Serie richtig.
      item.url = url;
      return null;
    });
    kandidaten.push(...anzureichern.filter((item) => item.genres.length));

    // 5. Bewerten. Der Typ gehoert an jeden Kandidaten - er entscheidet ueber
    // die Werk-Identitaet (eine Serie und ein gleichnamiger Film sind zwei
    // Werke) und ueber die leichte Bevorzugung der Art, die gerade laeuft.
    const bewertbar = kandidaten.map((item) => ({
      ...item,
      type: candidateMediaType(item.url) === "film" ? "film" : "serie",
      art: candidateMediaType(item.url) || ""
    }));
    const laufOptionen = {
      jetzt,
      ausschluss,
      anzeigen: empfehlungAnzeigen(),
      debug: umgebung.debug
    };

    // Zweite Runde: die vordersten Kandidaten bekommen ihre echten Genres.
    //
    // Ein Titel aus einer Genre-Liste weiss von sich nur, in welchen der sechs
    // geholten Listen er vorkam. "Naruto Shippuden" stand in "Fighting-Shounen"
    // und "Abenteuer" und galt damit als Titel mit zwei Genres - obwohl seine
    // Seite dieselben sechs nennt wie Naruto selbst. Ein Titel von der Startseite
    // wurde dagegen laengst angereichert und trat mit allen Genres an. So
    // bewerten sich zwei Quellen mit ungleichem Wissen gegeneinander, und der
    // Katalogtitel verliert immer.
    //
    // Ausgewaehlt wird nach der Katalogguete, nicht nach einer Vorbewertung: wer
    // zu wenige Genres kennt, kaeme dort nie nach vorn und bekaeme seine Genres
    // deshalb nie - ein Zirkelschluss, an dem genau die gesuchten Titel haengen
    // blieben. Die Guete misst dagegen, in welchen Lieblingslisten ein Titel
    // steht, und die kleinen, spezifischen Listen sind die aussagekraeftigen.
    //
    // Getrennt nach Anime, Serie und Film, damit die Vertiefung nicht einer
    // einzigen Reihe der Startseite zugutekommt.
    const nachWelt = new Map();
    for (const item of bewertbar) {
      if (item.via !== "genre" || item.vertieft) continue;
      const welt = item.art || "serie";
      const fach = nachWelt.get(welt) || [];
      fach.push(item);
      nachWelt.set(welt, fach);
    }
    const jeWelt = Math.max(1, Math.ceil(TASTE_TIEFE / Math.max(1, nachWelt.size)));
    const zuVertiefen = [...nachWelt.values()].flatMap((fach) => (
      besteAusMenge(fach, jeWelt, (item) => katalogGuete(item, profil))
    ));
    await inBatches(zuVertiefen, TASTE_FETCH_PARALLEL, async (item) => {
      const provider = anbieterNach.get(item.providerId);
      const url = seriesPageUrl(item.url);
      if (!provider || !url) return null;
      const seite = await tastePage(url, provider, false);
      const echte = (seite?.genres || []).map((genre) => genre.key);
      // Die Listen-Genres bleiben stehen: dass ein Titel in einer Lieblingsliste
      // stand, ist wahr, auch wenn seine Seite es anders nennt.
      if (echte.length) item.genres = [...new Set([...(item.genres || []), ...echte])];
      item.vertieft = true;
      return null;
    });

    // Erst jetzt die externen Daten anhaengen - die Vertiefung oben hat gerade
    // Detailseiten geholt, und damit gibt es zu diesen Kandidaten Jahr und
    // IMDB-Kennung. Gelesen wird nur der lokale Cache: dieser Durchlauf soll auf
    // nichts warten.
    for (const item of bewertbar) {
      item.extern = metadatenAusCache(item.baseTitle || item.title, item.url);
    }

    const ergebnis = empfehlung.empfehlen(bewertbar, profil, { ...laufOptionen, limit });

    if (umgebung.debug) {
      console.log(`[empfehlung] ${ergebnis.length} Vorschlaege aus ${kandidaten.length} Kandidaten,`
        + ` Profil aus ${profil.umfang} Eintraegen, ${profil.reihen.size} Reihen`);
      for (const eintrag of ergebnis.slice(0, 5)) console.log(empfehlung.debugBericht(eintrag));
    }

    // Und zum Schluss anstossen, was fehlt. Die Reihenfolge ist die Rangfolge:
    // was wirklich geschaut wurde, dann was vorgemerkt ist, dann die Titel, die
    // es gerade nach vorn geschafft haben, und erst danach der Rest. So werden
    // die Empfehlungen schnell besser, ohne dass tausend Kandidaten auf einmal
    // durch fremde Schnittstellen laufen.
    //
    // Die Reihenfolge ist nicht beliebig: sie entscheidet, was innerhalb des
    // ersten Laufs fertig wird. Gemessen an einem echten Profil standen zuerst
    // alle 75 Ablage-Eintraege vor den Vorschlaegen - und damit war das
    // Kontingent aufgebraucht, bevor die Titel drankamen, die der Nutzer
    // tatsaechlich vor sich sieht. Deshalb kommen jetzt direkt nach dem Verlauf
    // die Vorschlaege selbst, und erst danach der Rest der Ablage.
    const wuensche = [
      ...saat.map((eintrag) => ({ titel: eintrag.title, url: eintrag.url })),
      ...ergebnis.map((eintrag) => ({ titel: eintrag.title, url: eintrag.url })),
      ...umgebung.eintraege().map((favorite) => ({
        titel: cleanBaseMediaTitle(favorite.title, favorite.url) || favorite.title,
        url: favorite.url
      })),
      ...zuVertiefen.map((item) => ({ titel: item.baseTitle || item.title, url: item.url }))
    ];
    metadatenAnreichern(wuensche);

    return ergebnis;
  }

  // --- Muedigkeit ---------------------------------------------------------------
  //
  // Wie oft wurde ein Werk schon vorgeschlagen, ohne dass es jemanden
  // interessiert hat? Das wird mitgezaehlt, damit derselbe Titel nicht ewig
  // oben steht.
  //
  // Wichtig: gezaehlt wird nur das Anzeigen. Eine Anzeige ist kein Interesse -
  // sie darf das Profil nicht beeinflussen, sonst verstaerkt sich das System
  // selbst und empfiehlt immer mehr von dem, was es ohnehin schon zeigt.
  function empfehlungAnzeigen() {
    const cache = umgebung.cacheLesen();
    const karte = new Map();
    for (const [key, wert] of Object.entries(cache.anzeigen || {})) {
      karte.set(key, Number(wert?.n) || 0);
    }
    return karte;
  }

  function merkeEmpfehlungAngezeigt(eintraege) {
    const cache = umgebung.cacheLesen();
    if (!cache.anzeigen) cache.anzeigen = {};
    let geaendert = false;
    for (const eintrag of eintraege || []) {
      if (!eintrag?.werkKey) continue;
      const bekannt = cache.anzeigen[eintrag.werkKey] || { n: 0, at: 0 };
      // Hoechstens einmal je Stunde zaehlen: die Startseite baut sich oft neu
      // auf, und jedes Neuzeichnen als eigene Anzeige zu werten waere unfair.
      if (Date.now() - (Number(bekannt.at) || 0) < 3600000) continue;
      cache.anzeigen[eintrag.werkKey] = { n: (Number(bekannt.n) || 0) + 1, at: Date.now() };
      geaendert = true;
    }
    if (geaendert) umgebung.cacheSchreiben();
  }

  // Wurde ein Vorschlag wirklich geoeffnet, war er offenbar doch interessant -
  // dann faengt die Zaehlung von vorn an.
  function vergissEmpfehlungsMuedigkeit(url, titel, typ) {
    const cache = umgebung.cacheLesen();
    if (!cache.anzeigen) return;
    const key = titelModul.werkSchluessel(titel || "", typ || candidateMediaType(url));
    if (cache.anzeigen[key]) {
      delete cache.anzeigen[key];
      umgebung.cacheSchreiben();
    }
  }

  return {
    // "Neu bei deinen Anbietern" - die Neuheiten-Reihen der Startseiten.
    neuesVonAnbietern: collectRecommendations,
    // "Empfohlen fuer dich" und die drei Kategoriereihen.
    persoenlich: collectPersonalRecommendations,
    // Eine Seite der Entdeckungsansicht ("Mehr anzeigen").
    entdeckungsSeite,
    // Wurde ein Vorschlag geoeffnet, faengt seine Muedigkeit von vorn an.
    vergissMuedigkeit: vergissEmpfehlungsMuedigkeit,
    // Was AniList/TMDB ueber einen einzelnen Titel sagen - fuer den
    // Verlaufs-Kasten der Mediathek.
    titelMetadaten,
    // Der Pool ist veraltet - etwa weil der Wirt seinen Cache verworfen hat.
    poolVerwerfen() {
      personalCache = { at: 0, items: [], signatur: "", vollstaendig: false };
      entdeckungCache.clear();
    },
    // Fuer Pruefungen und die Diagnose: was gerade im Speicher liegt.
    stand() {
      return {
        pool: personalCache.items.length,
        vollstaendig: personalCache.vollstaendig,
        arten: [...entdeckungCache.keys()]
      };
    }
  };
}

module.exports = { erstellen, TASTE_CACHE_VERSION, PERSONAL_MAIN_SIZE };
