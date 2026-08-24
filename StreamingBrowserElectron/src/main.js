const { app, BrowserWindow, Menu, WebContentsView, ipcMain, net, session, shell, dialog, webFrameMain, Notification } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("fs");
const path = require("path");
const {
  extractDiscoverItems,
  extractPosterFallbacks,
  extractNewReleaseItems,
  extractHeroItem,
  extractUnplayableEpisodes,
  extractSeriesBounds,
  extractGenres,
  extractCatalogItems,
  extractRelatedItems,
  extractTitleMeta,
  extractPagination,
  seitenAdresse,
  seitenStichprobe,
  extractReleaseDate,
  extractCalendarEntries,
  extractCalendarJson
} = require("./discover");
const taste = require("./taste");
const { WatchpartyRaeume, raumcodesAufraeumen } = require("./watchparty-raeume");
const watchpartySync = require("./watchparty-sync");
// Der Abgleich zwischen den eigenen Geraeten. Er faehrt zum selben Relay wie
// die Watchparty, haengt aber an keinem Raum und an keinem Beitritt: ein
// Schluessel, und Laptop und Rechner haben denselben Stand.
const { Geraeteabgleich, SITZUNG_PRAEFIX } = require("./geraete");
const geraeteSchluessel = require("./geraete-schluessel");
const geraeteStand = require("./geraete-stand");
// Die beste Bildstufe beim Hoster. Eigenes Modul, damit die Auswahl gegen
// nachgebaute Stufenlisten pruefbar bleibt statt nur als Zeichenkette zu reisen.
const voeQualitaet = require("./voe-qualitaet");
// Die YouTube-Watchparty. Eigener Modus, eigene Sync-Logik - sie teilt sich mit
// der Watchparty fuer Serien nur die Leitung.
const { YoutubeWatchparty } = require("./youtube-watchparty");
const youtubeSync = require("./youtube-sync");
const sicherung = require("./sicherung");
const titelModul = require("./titel");
const empfehlung = require("./empfehlung");
const metadatenModul = require("./metadaten");
const statistik = require("./statistik");
const { AdblockEngine } = require("./adblock-engine");
const kosmetik = require("./adblock-kosmetik");
const verifizierungstor = require("./verifizierungstor");
const youtube = require("./youtube");

// Mit ELFIX_EMPFEHLUNG_DEBUG=1 gestartet, schreibt das Empfehlungssystem in
// die Konsole, woher die Punkte jedes Vorschlags kommen. Nicht in der
// Oberflaeche sichtbar - das ist ein Werkzeug zum Nachvollziehen, kein Feature.
const EMPFEHLUNG_DEBUG = process.env.ELFIX_EMPFEHLUNG_DEBUG === "1";
const providerModel = require("../shared/provider-model");
// Ein Anbieter zieht um: welche Adresse mitwandert und welche nicht. Eigenes
// Modul, damit sich das ohne laufende App pruefen laesst - es geht durch jeden
// Eintrag der Watchlist, und ein Fehler darin faellt erst auf, wenn nichts mehr
// zu oeffnen ist.
const umzug = require("./umzug");
// Intro ueberspringen: was ein Sprung als Beleg taugt, wann daraus eine Marke
// wird und was in der Seite dafuer laeuft.
const marken = require("./marken");
const fassung = require("./fassung");
// Das Handy als Fernbedienung: Verbindung zum Relay und der Kopplungscode.
const { Fernbedienung, codeErzeugen, kopplungsAdresse, webAdresse, relayLage, relayHinweis } = require("./fernbedienung");
// Ein QR-Code, selbst gerechnet - fuer das Handy, damit die Adresse samt Code
// nicht abgetippt werden muss.
const qr = require("./qr");
const bildausschnitt = require("../shared/bildausschnitt");

// Die Fortschrittsregeln stehen nicht mehr hier, sondern in ./fortschritt -
// und damit auch der Android-App zur Verfuegung, die dieselbe Datei in ihren
// Kern laedt. Die Namen kommen unveraendert herein, damit jede Aufrufstelle
// bleiben kann, wie sie war.
const fortschritt = require("./fortschritt");
const messung = require("./messung");
const seitendaten = require("./seitendaten");
const {
  absoluteHttpUrl,
  appendMediaActivity,
  favoriteMatchesCurrentProviderTitle,
  favoriteReplacementKey,
  hasNewEpisodeAfterCompletedFavorite,
  mediaDiagnosticDecisionText,
  nextEpisodeAfterFavoriteUrl,
  nextEpisodeContinueUrl,
  darfNaechsteFolgeSein,
  repairTrimmedSeriesTail,
  unplayableEpisodeSet,
  MIN_WATCH_TIME_SECONDS,
  WATCHPARTY_MIN_WATCH_SECONDS,
  BACKWARD_WATCH_TIME_SECONDS,
  COMPLETED_PROGRESS_PERCENT,
  AKTIVITAET_ZUSAMMEN_MS,
  appendCompletedEpisode,
  cleanBaseMediaTitle,
  cleanTitle,
  compareEpisodeIdentity,
  endeSchwelle,
  episodeIdentity,
  favoriteProgressTargetLabel,
  firstEpisodeUrl,
  hasContinueProgressRecord,
  incrementEpisodeUrl,
  inferMediaType,
  isAllowedResultHost,
  isCompletedProgress,
  isExplicitFilmUrl,
  isFavoriteProgressUrl,
  isFirstEpisodeIdentity,
  isSequentialFavoriteProgress,
  isTrackableMediaUrl,
  isValidMediaProgress,
  isWholeMediaCompleted,
  mediaActivityLabel,
  mediaProgressPercent,
  mediaPromotionBlockReason,
  mediaSlugFromUrl,
  mediaTypeForProgressUrl,
  normalizeActivity,
  normalizeCompletedEpisodes,
  normalizeFavoriteUrl,
  normalizeMediaType,
  replaceEpisodeUrl,
  sanitizePositiveNumber,
  sanitizeProgress,
  stripWww,
  titelAusSlug,
  titleFromPath,
  uebernahmeSchwelle,
} = fortschritt;

// Einzige Ausnahme: ob die Runde gerade eine Folge vorgibt, weiss nur der
// Hauptprozess. Die Regel selbst steht im Modul, die Auskunft kommt von hier.
function shouldPromoteMediaProgress(existing, url, progressState) {
  return fortschritt.shouldPromoteMediaProgress(existing, url, {
    ...progressState,
    watchpartyFuehrt: watchpartyGibtFolgeVor(url)
  });
}

// Der Weg vom geteilten Modul zurueck in den Hauptprozess.
//
// Die Regel entscheidet und gibt zurueck, was zu tun ist; hier wird es getan:
// ablegen, anzeigen, in die Diagnose schreiben, der Watchparty melden. Das ist
// die ganze Trennung - dieselbe Rechnung laeuft auf dem Telefon, nur landet sie
// dort in anderen Haenden.
function recordMediaActivity(provider, url, meta = {}, options = {}) {
  const ergebnis = fortschritt.medienStandVerbuchen({
    favoriten: favorites,
    aktiverFavoritId: activeFavoriteId,
    watchpartyFuehrt: watchpartyGibtFolgeVor(url)
  }, provider, url, meta, options);

  favorites = ergebnis.favoriten;
  for (const diagnose of ergebnis.diagnosen) {
    logMediaDiagnostic(provider, url, diagnose.art, diagnose.text, diagnose.angaben);
  }
  for (const meldung of ergebnis.meldungen) sendToast(meldung);
  if (!ergebnis.eintrag) return null;

  saveFavorites();
  sendActiveState();
  reportWatchpartyProgress(ergebnis.eintrag);
  return ergebnis.eintrag;
}

// Dieselbe Trennung fuer die Serien-Eckdaten: die Regel im Modul, die Anzeige
// hier.
function applyFavoriteSeriesBounds(favorite, meta = {}, currentUrl = favorite?.url || "") {
  const meldungen = [];
  const geaendert = fortschritt.applyFavoriteSeriesBounds(favorite, meta, currentUrl, meldungen);
  for (const meldung of meldungen) sendToast(meldung);
  return geaendert;
}

const LEGACY_DATA_DIR = path.join(app.getPath("appData"), "GlobalSearchHub");
const DATA_DIR = path.join(app.getPath("appData"), "ELFIX");
const PROVIDER_FILE = path.join(DATA_DIR, "providers.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
// Die alte Datei aus der Zeit des Eigenbau-Parsers. Sie wird beim Start
// geloescht: ihr Inhalt - ein paar tausend Domainnamen - ist gegenueber den
// echten Listen wertlos, und stehen lassen hiesse, sie nie wieder loszuwerden.
const LEGACY_FILTER_CACHE_FILE = path.join(DATA_DIR, "filter-cache.json");
// Hier liegen die Rohtexte der AdGuard-Listen, eine Datei je Liste. tsurlfilter
// kennt kein eigenes Speicherformat, aus dem sich eine fertige Engine laden
// liesse - gebaut wird sie bei jedem Start neu, aber eben aus der Platte statt
// aus dem Netz. Ohne Internet startet ELFIX damit mit dem letzten guten Stand.
const FILTER_LIST_DIR = path.join(DATA_DIR, "filterlisten");
// Die AdGuard-Nummer der Tracking-Liste. Ueber sie entscheidet der Schalter
// "Tracking-Schutz", ohne dass die Engine dafuer neu gebaut werden muss.
const TRACKING_LISTEN_ID = 3;
const FAVORITES_FILE = path.join(DATA_DIR, "favorites.json");
const SESSION_FILE = path.join(DATA_DIR, "sitzungen.json");
const TASTE_FILE = path.join(DATA_DIR, "taste-cache.json");
// Externe Metadaten liegen in einer eigenen Datei, nicht im Geschmacks-Cache.
// Sie haben eine ganz andere Lebensdauer: Anbieterseiten veralten in Tagen,
// eine TMDB-Sammlung in Jahren. Und beim Verwerfen des einen soll das andere
// nicht mitgehen - die Zuordnung von 800 Titeln noch einmal zu holen, waere
// der teuerste Teil des Ganzen.
const METADATEN_FILE = path.join(DATA_DIR, "metadaten-cache.json");
const WATCHPARTY_FILE = path.join(DATA_DIR, "watchparty.json");
// Der Spiegel des Geraeteabgleichs: was zuletzt hinausging oder hereinkam.
// Ohne ihn faengt jeder Start von vorn an und meldet den ganzen Bestand noch
// einmal - richtig waere das Ergebnis trotzdem, aber es waere viel Laerm.
const GERAETE_FILE = path.join(DATA_DIR, "geraete.json");
// Die gelernten Intro-Marken. Eigene Datei: sie gehoeren keinem Eintrag der
// Watchlist, sondern einer Serie - und die kann in der Watchlist stehen oder
// auch nicht.
const MARKEN_FILE = path.join(DATA_DIR, "marken.json");
// Welche Synchronfassung eine Serie hat - Deutsch, Untertitel, Englisch.
// Ebenfalls eigene Datei und aus demselben Grund: sie gilt der Serie und nicht
// dem Eintrag, unter dem sie gerade in der Watchlist steht.
const FASSUNGEN_FILE = path.join(DATA_DIR, "fassungen.json");
// Wie weit die Fernbedienung springt. Vorwaerts groesser als rueckwaerts: nach
// vorn spult man ueber etwas hinweg, zurueck holt man etwas nach, das man eben
// verpasst hat.
const FERN_VOR_S = 30;
const FERN_ZURUECK_S = 10;
// Das Projekt-Repository. Eine Stelle, an der die Adresse steht: die
// Update-Anzeige verlinkt darauf, und "Hilfe & Support" oeffnet den
// Issue-Bereich darunter.
const REPOSITORY_URL = "https://github.com/RoveHD/elfix";
const SESSION_PARTITION = "persist:streaming-browser";
const MAX_BLOCK_LOG = 400;
const MAX_MEDIA_LOG = 300;
const SETTINGS_SCHEMA_VERSION = 4;
// 2 seit 1.32.0: nachgetragene Saetze tragen die Kennung des Titels statt der
// des Favoriten, damit zwei Geraete dieselbe Vorgeschichte nicht doppelt
// fuehren.
const SITZUNG_SCHEMA_VERSION = 2;
// Die Listennummern sind die von AdGuard - sie stecken spaeter in jedem
// Treffer und machen nachvollziehbar, aus welcher Liste eine Regel kam.
//
// "Social Media" (4) ist bewusst nicht dabei: die Liste raeumt Teilen-Knoepfe
// und Like-Zaehler weg. Auf Anbieter- und Hosterseiten gibt es die kaum, und
// fuer Fake-Gewinnspiele, Casino-Einblendungen und Popunder traegt sie nichts
// bei - sie kostete nur Speicher. "German" (6) ist neu und deckt genau das ab,
// was auf deutschsprachigen Streaming-Seiten laeuft.
const ADGUARD_FILTER_LISTS = [
  {
    id: 2,
    name: "AdGuard Base Filter",
    url: "https://filters.adtidy.org/extension/chromium/filters/2.txt"
  },
  {
    id: 3,
    name: "AdGuard Tracking Protection",
    url: "https://filters.adtidy.org/extension/chromium/filters/3.txt"
  },
  {
    id: 14,
    name: "AdGuard Annoyances",
    url: "https://filters.adtidy.org/extension/chromium/filters/14.txt"
  },
  {
    id: 6,
    name: "AdGuard German Filter",
    url: "https://filters.adtidy.org/extension/chromium/filters/6.txt"
  }
];

let mainWindow;
let browserSession;
let providers = [];
let favorites = [];
let settings = defaultSettings();
let activeProviderId = null;
let activeFavoriteId = null;
let activeView = null;
let browserBounds = { x: 0, y: 130, width: 1200, height: 700 };
let isContentFullscreen = false;
const providerViews = new Map();
const webContentsProvider = new Map();
const attachedProviderViews = new Set();
const providerResumeState = new Map();
const mediaProgressTimers = new Map();
const providerAutoplayRequests = new Map();
const blockedRequests = [];
const mediaDiagnostics = [];
const mediaConsoleLogState = new Map();
const discoverCache = new Map();
// Erscheinungsdaten je Adresse - einmal geholt, dann gemerkt.
const erscheinungsdaten = new Map();
const seasonInfoCache = new Map();
let watchpartyShared = [];
let watchpartyLokal = { shared: [], joined: [] };
const watchpartyWiederhergestellt = new Set();
const watchpartySprung = new Map();
const watchpartyBildNachgereicht = new Set();
// Serien, fuer die dieses Geraet die Live-Steuerung abgeschaltet hat, und
// Folgen, an die es sich schon einmal angehaengt hat.
const watchpartyLiveAus = new Set();
const watchpartyAngeklinkt = new Set();
// Das zuletzt angewendete Ereignis je Runde und Titel: laufende Nummer,
// Zeitstempel und Folge. Daran werden Nachzuegler erkannt, die sich unterwegs
// ueberholt haben - ein verspaetetes Play nach einem neueren Pause etwa.
const watchpartyLetztesEreignis = new Map();
// Kennung des laufenden Players je Anbieter. Sie wechselt bei jeder Navigation
// und damit bei jeder Folge: daran erkennt das Relay, dass hier ein neuer
// Aufenthalt beginnt. Ohne das gaelte ein alter Player weiter als aktiv - und
// jemand, der laengst woanders ist, bliebe Host.
const watchpartySitzung = new Map();
// Woran dieses Geraet zuletzt als anwesend gemeldet war. Verlaesst es die
// Folge - Startseite darueber, andere Serie, auf privat gestellt -, wird das
// ausdruecklich abgemeldet. Nur still zu werden reicht nicht: bis der
// Herzschlag ablaeuft, stuende man bei den anderen noch in der Leiste.
let watchpartyAnwesend = null;
// Ein Sprungwunsch verfaellt, wenn die Folge nicht bald startet.
const WATCHPARTY_SPRUNG_GUELTIG_MS = 3 * 60 * 1000;
// Im Normalfall meldet die Seite selbst, sobald sich etwas tut. Dieser Takt ist
// nur die Rueckfallebene, falls sich das Melde-Skript nicht einhaengen konnte.
const WATCHPARTY_STAND_INTERVALL_MS = 5000;
const nextEpisodePromptState = new Map();
const nextEpisodeAutostartState = new Map();
// "Nach dieser Folge aufhoeren", je Anbieter und je Folge. Einmalig von Bauart:
// der Wechsel zur naechsten Folge loest did-navigate aus, und dort wird der
// Merker geleert - er kann also gar nicht auf die uebernaechste durchschlagen.
const stopNachFolge = new Map();
let nextEpisodeLogState = "";
const DISCOVER_CACHE_MS = 15 * 60 * 1000;
const SEASON_INFO_CACHE_MS = 6 * 60 * 60 * 1000;
// So lange wird auf die Bestaetigung des Raums gewartet, bevor das Teilen als
// gescheitert gilt.
const WATCHPARTY_BESTAETIGUNG_MS = 4000;
// Jeder Raum ist eine eigene Verbindung - irgendwo muss Schluss sein.
const WATCHPARTY_MAX_RAEUME = 8;
// Kennzeichen fuer "kein Raum, nur fuer mich". Eine leere Antwort aus dem
// Auswahlmenue heisst dagegen abgebrochen.
const PRIVAT = "__privat";
// Wie alt die Filterlisten hoechstens sein duerfen, bevor sie beim Start neu
// geholt werden.
const FILTER_MAX_ALTER_MS = 7 * 24 * 60 * 60 * 1000;
// So lange muss der Raum-Zustand ruhen, bevor daraus Schluesse gezogen werden:
// Beitritte nach dem Verbinden brauchen eine Rundreise zum Relay.
const WATCHPARTY_RUHE_MS = 6000;
// Ein eigenes Bild liegt als Data-URL in der Ablage. Die Oberflaeche
// verkleinert vorher; diese Grenze faengt ab, was trotzdem zu gross ankommt.
const CUSTOM_BILD_MAX_ZEICHEN = 3 * 1024 * 1024;
// Abgeschlossene Serien auf Nachschub pruefen: wie viele je Durchgang und wie
// oft. Jede kostet zwei Seitenaufrufe, deshalb in kleinen Portionen.
const NEUE_FOLGEN_PRO_LAUF = 6;
const NEUE_FOLGEN_INTERVALL_MS = 6 * 60 * 60 * 1000;
// Detailseiten aendern ihre Genres praktisch nie, Uebersichtsseiten schon.
const TASTE_PAGE_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const TASTE_LIST_CACHE_MS = 6 * 60 * 60 * 1000;
// Wie viele Verlaufstitel praegen das Profil? Alle.
//
// Frueher waren es die letzten zwoelf. Wer viel schaut, hat einen
// abgeschlossenen Titel damit nach drei Tagen verloren: gemessen an einem
// echten Verlauf lag "Dragonball Z" auf Platz 47, obwohl es gerade fertig
// geschaut war - und die Plaetze 38 bis 48 waren durchgehend abgeschlossene
// Titel, alle innerhalb derselben vier Minuten markiert. Jede feste Zahl
// schneidet mitten durch so einen Block, und was dahinter liegt, existiert
// fuer die Empfehlungen nicht. Die belegte Beziehung "Dragon Ball -> SEQUEL ->
// Dragon Ball Z" war deshalb nie zu sehen.
//
// Dass alte Titel das Profil verwaessern, verhindert die Frische-Kurve in
// empfehlung.js: sie halbiert das Gewicht alle dreissig Tage. Ein Titel von
// vor einem Jahr traegt also kaum noch zum Geschmack bei - seine belegten
// Beziehungen und Reihen behaelt er trotzdem, und genau darum geht es.
//
// Die Kosten sind einmalig: je Titel eine Detailseite, danach liegt sie eine
// Woche im Cache. Die Obergrenze schuetzt nur vor dem Entarteten - das
// Bewerten vergleicht jeden Kandidaten mit jedem Verlaufstitel, und bei
// mehreren tausend Eintraegen waere das keine Empfehlung mehr, sondern eine
// Rechenaufgabe. Fuer eine normale Mediathek greift sie nie.
const TASTE_HISTORY_MAX = 500;
const TASTE_ENRICH_LIMIT = 18;
// Die Genre-Uebersichten der Anbieter sind blaetterbar. So viele Seiten werden
// je Liste gelesen - gleichmaessig ueber die ganze Blaetterleiste verteilt,
// damit der Katalog und nicht nur sein Anfang in die Auswahl kommt.
const TASTE_LIST_PAGES = 8;
// Obergrenze je Liste. Sie war 360 und damit die eigentliche Wand hinter den
// Entdeckungsseiten: die Genre-Uebersichten der Anbieter haben 14 bis 122
// Seiten, gelesen wurden acht davon. Wer weit scrollte, war nach rund 400
// Titeln je Art am Ende - nicht weil der Katalog leer war, sondern weil nie
// mehr davon geholt wurde.
//
// Jetzt waechst die Liste beim Scrollen nach (siehe tasteListErweitern). Die
// Grenze bleibt trotzdem stehen, damit eine einzelne Liste die Ablage nicht
// sprengt.
const TASTE_LIST_SIZE = 2400;
// So viele Seiten liest ein Nachschlag je Liste. Klein gehalten: das laeuft
// waehrend jemand scrollt, und vier Seiten sind bei den Anbietern gut hundert
// neue Titel.
const TASTE_LIST_NACHSCHLAG = 4;
// So viele Eintraege werden aus einer einzelnen Katalogseite gelesen.
// Grosszuegig: die Seiten zeigen dreissig bis zweiundvierzig, gekappt werden
// soll hier nichts mehr.
const TASTE_LIST_ROH = 120;
// Version des Geschmacks-Caches. Wird sie erhoeht, verwirft loadTasteCache die
// alten Listen - sonst haengen sechs Stunden lang die alten, abgeschnittenen
// Kandidaten in der Ablage.
// 3: die Bilderkennung hat sich geaendert. Gespeicherte Kacheln tragen
// deshalb teils das Poster der Nachbarkachel und einen Titel mit angehaengtem
// Genre ("Avatar - Der Herr der Elemente Zeichentrick") - das ist nicht alt,
// sondern falsch, und muss weg.
const TASTE_CACHE_VERSION = 3;
// So viele Titel aus den Genre-Listen gehen ins Ranking. Die Listen liefern
// jetzt den ganzen Katalog - das sind mehrere tausend Eintraege, von denen die
// meisten nur ein einziges Genre mit dem Profil teilen. Gekappt wird nach
// Relevanz, nicht nach Listenposition (siehe nachRelevanzKappen).
// Frueher 900 - das reichte fuer eine Startseite mit zwei Dutzend Karten.
// Die Entdeckungsseiten blaettern durch denselben Pool; bei 900 Kandidaten
// blieben nach Dubletten, Ausschluss und Aufteilung auf drei Arten rund 330
// Titel je Art, also elf Stapel. Mit 2400 sind es rund tausend. Gekappt wird
// weiter nach Relevanz und Genre-Quote, nicht nach Listenposition - der Pool
// wird also breiter, nicht beliebiger.
const TASTE_GENRE_KANDIDATEN = 6000;
// So viele der aussichtsreichsten Kandidaten bekommen vor der endgueltigen
// Bewertung ihre echten Genres von der Detailseite - siehe die zweite Runde in
// buildPersonalRecommendations. Die Seiten liegen danach eine Woche im Cache,
// die Kosten fallen also nur beim ersten Mal an.
const TASTE_TIEFE = 60;
// Ab wie vielen verschiedenen Werken zaehlt ein Genre des Profils voll, wenn es
// darum geht, dafuer einen ganzen Katalog zu holen? Darunter wird es anteilig
// abgeschwaecht.
const GENRE_TRAEGER_VOLL = 3;
// So viele Titel je Anbieter zeigt bereits die Reihe "Neu bei deinen Anbietern".
const TASTE_NEW_OFFSET = 6;
const TASTE_FETCH_PARALLEL = 4;
let tasteCache = null;
let tasteSaveTimer = 0;
let personalPending = null;
// `vollstaendig` unterscheidet den frisch gerechneten Pool von dem, was beim
// Start von der Platte kam - dort liegt nur der Anfang. Die Startseite merkt
// das nicht, eine Entdeckungsseite schon.
let personalCache = { at: 0, items: [], signatur: "", vollstaendig: false };
const PERSONAL_CACHE_MS = 15 * 60 * 1000;
const PERSONAL_POOL_SIZE = 150;
// So tief reicht der Pool, aus dem die Entdeckungsseiten schoepfen.
//
// Gerechnet wird er nur einmal - die Startseite nimmt seinen Anfang, die
// Entdeckungsseiten blaettern durch den Rest. Ihn zweimal zu bauen hiesse,
// dieselben Seiten zweimal zu lesen.
//
// Warum so gross? Gemessen an einem echten Katalog aus 4626 Kandidaten tragen
// 681 Anime, 841 Filme und 647 Serien einen echten Grund (also nicht blosse
// Erkundung). Wer scrollt, soll so weit kommen, bevor die Saetze allgemein
// werden.
// Gemessen an 4626 Kandidaten: 1200 Titel kosten 1458 ms, 4000 kosten 1900 ms.
// Die Vielfaltsregel arbeitet die Restliste ab, wird also mit jedem Platz
// billiger - der grosse Pool ist deshalb fast geschenkt. 4000 sind rund 1300
// je Art und damit vierzig Stapel, bevor ueberhaupt nachgeholt werden muss.
const ENTDECKUNG_POOL_SIZE = 4000;
// Gehalten wird der grosse Pool nur im Speicher. In die Ablage geht sein
// Anfang - tausend Eintraege auf die Platte zu schreiben, damit die Startseite
// zwoelf davon zeigt, waere Unfug.
const ENTDECKUNG_CACHE_MS = 30 * 60 * 1000;
// So viele Titel gehen an "Empfohlen fuer dich"; die Kategoriereihen bedienen
// sich erst danach.
const PERSONAL_MAIN_SIZE = 24;
const autoplayConsoleLogState = new Map();
const AUTOPLAY_POLL_MS = 700;
const NEXT_EPISODE_PROMPT_PERCENT = 90;
const NEXT_EPISODE_COUNTDOWN_SECONDS = 5;
const FRAME_SCRIPT_TIMEOUT_MS = 3000;
const AUTOSTART_REVEAL_TIMEOUT_MS = 22000;
const AUTOSTART_EXTRA_WAIT_MS = 8000;
const CURTAIN_DIR = path.join(DATA_DIR, "curtain");
const VIEW_BACKGROUND_COLOR = "#070a10";
let pendingAutostart = null;
let curtainView = null;
const overlayReasons = new Set();
let adblock;
let updateState = {
  status: "idle",
  message: "Noch nicht geprüft.",
  progress: 0,
  version: app.getVersion(),
  availableVersion: "",
  downloaded: false,
  installing: false,
  error: ""
};

app.setName("ELFIX");
// Ohne diese Kennung zeigt Windows Benachrichtigungen einer Electron-App gar
// nicht an oder schreibt "electron.app.Elfix" darueber. Sie muss zu der aus
// electron-builder passen, sonst findet Windows die App nicht wieder.
if (process.platform === "win32") app.setAppUserModelId("com.rovehd.elfix");

app.whenReady().then(async () => {
  adblock = new AdblockEngine();
  ensureDataDir();
  providers = loadProviders();
  favorites = loadFavorites();
  // Einmalig: eigene Bilder aus der Zeit nachziehen, als sie nur an einer
  // einzelnen Kachel hingen.
  if (verteileEigeneBilder(favorites)) saveFavorites();
  // Wurde beim Laden ein YouTube-Eintrag geradegezogen oder ein Short
  // aussortiert, gilt das sofort - sonst stuende die Reparatur nur im
  // Speicher und die Ablage saehe bis zur naechsten Aenderung weiter falsch
  // aus.
  if (youtubeGeradegezogen) saveFavorites();
  settings = loadSettings();
  saveSettings();
  // Erst jetzt moeglich: der Nachtrag braucht beide Seiten - die Anbieterliste
  // und den Merker aus den Einstellungen.
  youtubeAnbieterNachtragen();
  // Aus dem vorhandenen Verlauf uebernehmen, was sicher ableitbar ist -
  // ohne Wiedergabezeit, die es dort nie gab.
  // Erst die Kennungen angleichen, dann nachtragen: das Nachtragen vergleicht
  // gegen die vorhandenen Kennungen, und die muessen dafuer schon die neuen sein.
  sitzungenKennungenAngleichen();
  sitzungenNachtragen();
  watchpartyLokal = loadWatchpartyLocal();

  browserSession = session.fromPartition(SESSION_PARTITION, { cache: true });
  configureBrowserSession();
  if (settings.browser.cacheMode !== "normal") {
    await clearBrowserDataPreservingLogin();
  }
  installAdblock();
  createMainWindow();
  setupAutoUpdater();
  syncWatchparty();
  // Erst den Spiegel, dann einrichten: ohne ihn haelt der Abgleich den ganzen
  // Bestand fuer neu und meldet ihn beim Start noch einmal hinaus.
  geraete.ablageSetzen(loadGeraeteSpiegel());
  syncGeraete();
  syncFern();
  // Laeuft nebenher: fuer die Reparatur wird je Staffel eine Seite geladen.
  repairStalledSeriesFavorites().catch(() => {});
  // Die Leiste lebt davon, dass jeder laufend sagt, wo er steht.
  setInterval(() => { meldeWatchpartyStand().catch(() => {}); }, WATCHPARTY_STAND_INTERVALL_MS).unref?.();
  // Die Notbremse der YouTube-Watchparty. Sie laeuft immer mit und steigt
  // sofort wieder aus, solange kein YouTube-Modus aktiv ist.
  setInterval(() => { youtubeAbgleichen().catch(() => {}); }, YOUTUBE_ABGLEICH_TAKT_MS).unref?.();
  // Werbefilter. Erst die Engine aus dem bauen, was auf der Platte liegt -
  // das geht ohne Netz und ist der Grund, warum ELFIX auch offline filtert.
  // Danach nachsehen, ob die Listen zu alt sind. Beides nebenher: der Aufbau
  // dauert Sekunden, und solange gilt die eingebaute Notfallliste.
  ladeFilterListenVonPlatte()
    .catch((fehler) => {
      console.log(`[ELFIX ADBLOCK] Aufbau fehlgeschlagen: ${fehler?.message || fehler}`);
    })
    .then(() => new Promise((fertig) => { setTimeout(fertig, 4000); }))
    .then(() => ensureFilterLists())
    .catch((fehler) => {
      console.log(`[ELFIX ADBLOCK] Listen konnten nicht geholt werden: ${fehler?.message || fehler}`);
    });
  // Abgeschlossene Serien auf neue Folgen pruefen - erst nach dem Start, damit
  // das Fenster nicht darauf wartet, danach in ruhigem Takt.
  setTimeout(() => pruefeNeueFolgen().catch(() => {}), 20000).unref?.();
  setInterval(() => pruefeNeueFolgen().catch(() => {}), NEUE_FOLGEN_INTERVALL_MS).unref?.();
});

app.on("before-quit", () => {
  // Was in der Watchparty offen ist, gehoert vor dem Schliessen in die Ablage:
  // sonst geht eine Aenderung der letzten Sekunden verloren und nach dem
  // naechsten Start fehlen die gemeinsamen Staende.
  if (watchparty?.aktiv) rememberWatchpartyState(watchpartyShared);
  // Dasselbe fuer die laufende Wiedergabe: ohne das fehlte die letzte Folge
  // eines Abends in der Bilanz, weil sie nie geschlossen wurde.
  sitzungenSchliessen();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#070a10",
    title: "ELFIX",
    icon: path.join(app.getAppPath(), "build", "icon.ico"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMaximized()) {
      mainWindow.maximize();
    }
  });
  mainWindow.on("resize", () => applyBrowserBounds());
  mainWindow.on("minimize", () => {
    if (settings.playback.pauseOnMinimize) {
      pauseActivePlayback(true);
    }
  });
  mainWindow.on("blur", () => {
    if (settings.playback.pauseOnBlur) {
      pauseActivePlayback(true);
    }
  });
  mainWindow.on("focus", () => {
    if (activeView) {
      activeView.webContents.setAudioMuted(false);
    }
  });
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (tastenkuerzel(input)) event.preventDefault();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on("checking-for-update", () => setUpdateState({ status: "checking", message: "Suche beim Start nach ELFIX-Updates...", progress: 0, downloaded: false, installing: false, error: "" }));
  autoUpdater.on("update-available", (info) => {
    setUpdateState({
      status: "available",
      message: `Update ${info.version || ""} gefunden. Download und Installation laufen automatisch.`,
      availableVersion: info.version || "",
      progress: 0,
      downloaded: false,
      installing: false,
      error: ""
    });
  });
  autoUpdater.on("update-not-available", () => setUpdateState({ status: "current", message: "ELFIX ist aktuell.", progress: 100, error: "" }));
  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.round(progress.percent || 0);
    setUpdateState({ status: "downloading", message: `Update wird geladen: ${percent}%`, progress: percent, error: "" }, [25, 50, 75, 100].includes(percent));
  });
  autoUpdater.on("update-downloaded", () => {
    setUpdateState({
      status: "installing",
      message: "Update geladen. ELFIX installiert es jetzt automatisch und startet neu.",
      progress: 100,
      downloaded: true,
      installing: true,
      error: ""
    });
    setTimeout(() => {
      // Still installieren: ohne das erste Argument zeigt der Installer seine
      // Seiten ("Fuer wen soll installiert werden?") und wartet auf einen
      // Klick. Das Update soll im Hintergrund durchlaufen und ELFIX danach
      // von selbst wieder starten.
      autoUpdater.quitAndInstall(true, true);
    }, 1200);
  });
  autoUpdater.on("error", (error) => {
    setUpdateState({ status: "error", message: "Update konnte nicht automatisch installiert werden.", progress: 0, installing: false, error: error?.message || "Unbekannt" });
  });

  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }, 2500);
}

function setUpdateState(next, toast = true) {
  updateState = {
    ...updateState,
    ...next,
    version: app.getVersion()
  };
  if (toast && updateState.message) sendToast(updateState.message);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("updates:state", publicUpdateState());
  }
}

function publicUpdateState() {
  return {
    ...updateState,
    packaged: app.isPackaged,
    feed: "GitHub Releases: RoveHD/elfix"
  };
}

function configureBrowserSession() {
  browserSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ["fullscreen"].includes(permission);
    callback(allowed);
  });

  browserSession.on("will-download", (_event, item) => {
    const downloads = app.getPath("downloads");
    item.setSavePath(path.join(downloads, item.getFilename()));
  });
}

// Cache und Website-Daten raeumen, ohne dich auszuloggen und ohne dir deine
// Player-Einstellungen zu nehmen.
//
// Cookies bleiben - daher der Name. Der localStorage bleibt inzwischen
// ebenfalls, und das ist kein Detail: dort merkt sich jeder Player die
// Lautstaerke, und dort liegen bei YouTube die Qualitaets- und
// Untertitelwahl. Wer sie mitloescht, stellt nichts zurueck, sondern
// verstellt es - jede Seite fing wieder bei ihrem Standard an, also bei
// voller Lautstaerke. Werbung und Zaehlpixel sitzen ohnehin in Cache,
// Service Workern und dem Cache Storage, und die gehen weiter.
async function clearBrowserDataPreservingLogin() {
  if (!browserSession) return;
  await browserSession.clearCache().catch(() => {});
  if (typeof browserSession.clearCodeCaches === "function") {
    await browserSession.clearCodeCaches({}).catch(() => {});
  }
  if (typeof browserSession.clearHostResolverCache === "function") {
    browserSession.clearHostResolverCache();
  }
  if (typeof browserSession.clearAuthCache === "function") {
    await browserSession.clearAuthCache().catch(() => {});
  }
  await browserSession.clearStorageData({
    storages: [
      "appcache",
      "filesystem",
      "indexdb",
      "shadercache",
      "websql",
      "serviceworkers",
      "cachestorage"
    ]
  }).catch(() => {});
}

function installAdblock() {
  browserSession.webRequest.onBeforeRequest((details, callback) => {
    const providerId = webContentsProvider.get(details.webContentsId);
    const provider = providers.find((item) => item.id === providerId);

    if (!provider) {
      callback({});
      return;
    }

    if (isChallengeOrVerificationUrl(details.url, provider)) {
      callback({});
      return;
    }

    if (details.resourceType === "mainFrame" && shouldBlockProviderNavigation(details.url, provider)) {
      logBlockedUrl(details.url, provider, "site-lock", "navigation");
      callback({ cancel: true });
      return;
    }

    if (!settings.adblock.enabled || provider.adblockEnabled === false) {
      callback({});
      return;
    }

    const urteil = adblockUrteil(details, provider);
    if (urteil.block) {
      logBlocked(details, provider, urteil.rule, urteil.kategorie);
      callback({ cancel: true });
      return;
    }

    // Ausnahmen werden gemeldet, aber nur einmal je Anbieter und Host. Sonst
    // stuende nach zehn Minuten Film ein Eintrag je Videostueck im Protokoll
    // und das Fenster waere nicht mehr zu gebrauchen.
    if (urteil.kategorie) logAusnahme(details.url, provider, urteil.rule, urteil.kategorie);
    callback({});
  });
}

// Fuer Navigationen und Popups: dieselbe Entscheidung, aber ohne echtes
// Request-Objekt.
function shouldBlockTarget(url, provider, resourceType = "mainFrame", quelle = "") {
  if (!provider || !settings.adblock.enabled || provider.adblockEnabled === false || !providerModel.isHttpUrl(url)) {
    return { block: false };
  }
  return adblockUrteil({ url, resourceType, referrer: quelle }, provider);
}

ipcMain.handle("app:init", () => ({
  providers,
  favorites,
  settings: publicSettings(settings),
  filterLists: ADGUARD_FILTER_LISTS,
  activeProviderId,
  appInfo: {
    name: app.getName(),
    version: app.getVersion(),
    packaged: app.isPackaged,
    repository: REPOSITORY_URL
  },
  updateState: publicUpdateState(),
  mediaDiagnostics: mediaDiagnostics.slice(-120).reverse()
}));

ipcMain.handle("updates:check", async () => {
  if (!app.isPackaged) {
    setUpdateState({ status: "dev", message: "Updates funktionieren im installierten Release.", progress: 0, error: "" });
    return publicUpdateState();
  }
  setUpdateState({ status: "checking", message: "Suche nach ELFIX-Updates...", progress: 0, downloaded: false, installing: false, error: "" });
  await autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    setUpdateState({ status: "error", message: "Update konnte nicht automatisch installiert werden.", progress: 0, installing: false, error: error?.message || "Unbekannt" });
  });
  return publicUpdateState();
});

ipcMain.handle("app:show-home", async () => {
  await enterHomeMode();
  return activeState();
});

ipcMain.handle("layout:set-browser-bounds", (_event, bounds) => {
  browserBounds = sanitizeBounds(bounds);
  applyBrowserBounds();
});

ipcMain.handle("settings:set-open", (_event, isOpen) => {
  setOverlayOpen("settings", isOpen);
  return true;
});

ipcMain.handle("shell:set-open", (_event, isOpen) => {
  // Der Nutzer geht selbst zurueck in die Oberflaeche: kein Autostart-Warten mehr.
  if (isOpen) finishAutostart("oberflaeche");
  setOverlayOpen("shell", isOpen);
  return true;
});

ipcMain.handle("provider:open", async (_event, providerId) => {
  const provider = enabledProviders().find((item) => item.id === providerId);
  if (!provider) return null;
  activeFavoriteId = null;
  await navigateProvider(provider, provider.lastUrl || provider.startUrl);
  return activeState();
});

ipcMain.handle("provider:search", async (_event, providerId, query) => {
  const provider = enabledProviders().find((item) => item.id === providerId);
  if (!provider) return null;
  activeFavoriteId = null;
  await navigateProvider(provider, providerModel.buildSearchUrl(provider, query));
  return activeState();
});

ipcMain.handle("provider:navigate", async (_event, providerId, url) => {
  const provider = enabledProviders().find((item) => item.id === providerId);
  if (!provider) return null;
  activeFavoriteId = null;
  await navigateProvider(provider, url);
  return activeState();
});

ipcMain.handle("search:all", async (_event, query) => searchAllProviders(query));

ipcMain.handle("calendar:load", async (_event, refresh = false) => ladeKalender(Boolean(refresh)));

ipcMain.handle("discover:personal", async (_event, options = {}) => {
  const limit = sanitizeNumber(options?.limit, 6, 40, 24);
  const type = sanitizeChoice(options?.type, ["anime", "serie", "film"], "");
  return collectPersonalRecommendations(limit, Boolean(options?.refresh), type, options?.excludeMain !== false);
});

// Eine Seite der Entdeckungsansicht. Der Versatz steht in der Anfrage, damit
// die Oberflaeche den Faden behaelt, auch wenn sie zwischendurch weggeschaltet
// war.
ipcMain.handle("discover:personal-page", async (_event, options = {}) => {
  const type = sanitizeChoice(options?.type, ["anime", "serie", "film"], "");
  if (!type) return { items: [], versatz: 0, gesamt: 0, fertig: true };
  const versatz = sanitizeNumber(options?.offset, 0, 20000, 0);
  const limit = sanitizeNumber(options?.limit, 6, 60, 30);
  return entdeckungsSeite(type, versatz, limit, Boolean(options?.refresh));
});

ipcMain.handle("discover:recommendations", async (_event, options = {}) => {
  const proAnbieter = Math.max(2, Math.min(12, Number(options?.perProvider) || 6));
  return collectRecommendations(proAnbieter, Boolean(options?.refresh));
});

ipcMain.handle("browser:navigate", async (_event, input) => {
  const provider = activeProvider();
  if (!provider) return null;
  activeFavoriteId = null;
  const target = buildNavigationUrl(input, provider);
  await navigateProvider(provider, target);
  return activeState();
});

ipcMain.handle("browser:command", async (_event, command) => {
  if (command === "reloadAll") {
    await reloadAllProviderViews();
    return activeState();
  }

  const view = activeView;
  if (!view) return activeState();

  if (command === "back" && view.webContents.canGoBack()) view.webContents.goBack();
  if (command === "forward" && view.webContents.canGoForward()) view.webContents.goForward();
  if (command === "reload") view.webContents.reload();
  if (command === "stop") view.webContents.stop();
  if (command === "home") {
    const provider = activeProvider();
    if (provider) {
      activeFavoriteId = null;
      await navigateProvider(provider, provider.startUrl);
    }
  }
  if (command === "external" && view.webContents.getURL()) {
    shell.openExternal(view.webContents.getURL());
  }
  if (command === "fullscreen") {
    if (isContentFullscreen) {
      leaveContentFullscreen();
    } else {
      enterContentFullscreen();
    }
  }
  if (command === "leaveFullscreen") {
    leaveContentFullscreen();
  }

  return activeState();
});

ipcMain.handle("favorites:toggle-current", async () => {
  const provider = activeProvider();
  if (!provider || !activeView) return { favorites, favorite: null, added: false };

  const url = activeView.webContents.getURL();
  if (!providerModel.isHttpUrl(url)) return { favorites, favorite: null, added: false };

  const normalized = normalizeFavoriteUrl(url);
  const meta = await readPageMetadata(activeView).catch(() => ({}));
  const nextFavorite = {
    id: crypto.randomUUID(),
    providerId: provider.id,
    providerName: provider.name,
    title: cleanTitle(meta.title || activeView.webContents.getTitle() || provider.name),
    url,
    normalizedUrl: normalized,
    favicon: meta.favicon || "",
    thumbnail: meta.thumbnail || "",
    logo: provider.logo || "",
    favorite: true,
    watched: false,
    completed: false,
    episodeCompleted: false,
    hideFromContinueWatching: false,
    progress: 0,
    duration: 0,
    position: 0,
    currentTime: 0,
    type: inferMediaType(url),
    season: episodeIdentity(url)?.season || 0,
    episode: episodeIdentity(url)?.episode || 0,
    finalSeason: sanitizePositiveNumber(meta.finalSeason),
    finalEpisode: sanitizePositiveNumber(meta.finalEpisode),
    lastWatchedAt: "",
    activity: [],
    createdAt: new Date().toISOString()
  };

  const existingIndex = favorites.findIndex((favorite) => favoriteMatchesCurrentProviderTitle(favorite, provider, url, normalized));
  if (existingIndex >= 0) {
    const existing = favorites[existingIndex];
    const favorite = {
      ...existing,
      ...nextFavorite,
      id: existing.id,
      createdAt: existing.createdAt || nextFavorite.createdAt,
      thumbnail: nextFavorite.thumbnail || (isFilmoProvider(provider) ? "" : existing.thumbnail || ""),
      favorite: true,
      watched: Boolean(existing.watched),
      // Wer einen abgehakten Titel wieder vormerkt, holt ihn bewusst aus der
      // Mediathek zurueck. Dann muss aber alles mitgehen: bliebe
      // `completedManually` stehen, waere der Eintrag weder in der Mediathek
      // (die filtert auf `completed`) noch je wieder zurueckzuholen - genau
      // daran sind vorgemerkte Titel stillschweigend verschwunden.
      completed: false,
      completedManually: false,
      completedAt: "",
      episodeCompleted: false,
      hideFromContinueWatching: Boolean(existing.hideFromContinueWatching),
      progress: sanitizeProgress(existing.progress),
      duration: sanitizePositiveNumber(existing.duration),
      position: sanitizePositiveNumber(existing.position),
      currentTime: sanitizePositiveNumber(existing.currentTime || existing.position),
      finalSeason: sanitizePositiveNumber(nextFavorite.finalSeason || existing.finalSeason),
      finalEpisode: sanitizePositiveNumber(nextFavorite.finalEpisode || existing.finalEpisode),
      lastWatchedAt: existing.lastWatchedAt || "",
      activity: Array.isArray(existing.activity) ? existing.activity : [],
      updatedAt: new Date().toISOString()
    };
    favorites.splice(existingIndex, 1);
    favorites.unshift(favorite);
    activeFavoriteId = favorite.id;
    saveFavorites();
    return { favorites, favorite, added: true, replaced: true };
  }

  const favorite = nextFavorite;
  favorites.unshift(favorite);
  favorites = favorites.slice(0, 500);
  activeFavoriteId = favorite.id;
  saveFavorites();
  return { favorites, favorite, added: true };
});

ipcMain.handle("favorites:remove", (_event, favoriteId) => {
  const index = favorites.findIndex((favorite) => favorite.id === favoriteId);
  if (index < 0) return favorites;
  const favorite = favorites[index];
  if (favorite.watched || favorite.lastWatchedAt || Number(favorite.progress) > 0 || Array.isArray(favorite.activity) && favorite.activity.length) {
    favorite.favorite = false;
    favorite.updatedAt = new Date().toISOString();
  } else {
    favorites.splice(index, 1);
  }
  if (activeFavoriteId === favoriteId) activeFavoriteId = null;
  saveFavorites();
  return favorites;
});

// Aus der Mediathek loeschen heisst wirklich loeschen: "favorites:remove"
// nimmt einen geschauten Titel nur aus der Watchlist, er stuende danach
// weiterhin als abgeschlossen in der Mediathek.
ipcMain.handle("library:remove", (_event, favoriteId) => {
  const index = favorites.findIndex((favorite) => favorite.id === favoriteId);
  if (index < 0) return { favorites, removed: false };
  const [weg] = favorites.splice(index, 1);
  if (activeFavoriteId === favoriteId) activeFavoriteId = null;
  saveFavorites();
  sendActiveState();
  console.log(`[ELFIX] ${weg?.title || favoriteId} aus der Mediathek geloescht`);
  return { favorites, removed: true };
});

// Die selbst gelegte Reihenfolge der Mediathek. Gespeichert wird sie am
// Eintrag: so verschwindet sie mit ihm und ueberlebt jeden Neustart.
// Der Rueckblick. Beides liegt hier: der Verlauf an den Favoriten und die
// Genres im Geschmack-Cache - deshalb wird hier gerechnet und drueben nur
// gezeigt. Der Cache wird gelesen, nicht gefuellt: fehlt er, fehlen Genres,
// und die Seite sagt das auch.
ipcMain.handle("review:data", (_event, zeitraum) => {
  const sitzungen = loadSitzungen();
  if (!sitzungen.length) return { zeitraeume: [], gewaehlt: "", daten: null };

  // Welche Zeitraeume ueberhaupt etwas hergeben. Ein Reiter, hinter dem nichts
  // steht, ist eine Enttaeuschung mit Vorankuendigung - deshalb wird jeder
  // durchgerechnet und nur angeboten, wenn Sitzungen darin liegen.
  const jahre = [...new Set(sitzungen
    .map((sitzung) => new Date(Date.parse(sitzung.begonnenAm)).getFullYear())
    .filter((jahr) => Number.isFinite(jahr)))].sort((links, rechts) => rechts - links);
  const angebot = [
    { wert: "7tage", titel: "7 Tage" },
    { wert: "30tage", titel: "30 Tage" },
    { wert: "monat", titel: "Dieser Monat" },
    ...jahre.map((jahr) => ({ wert: String(jahr), titel: String(jahr) })),
    { wert: "alles", titel: "Gesamt" }
  ].filter((eintrag) => watchStatistik(eintrag.wert).sitzungen > 0);

  // Ohne Wahl der Gesamtzeitraum: er hat immer etwas zu zeigen, ein leerer
  // "diese Woche" waere ein schlechter erster Eindruck.
  const gewaehlt = angebot.some((eintrag) => eintrag.wert === zeitraum)
    ? zeitraum
    : (angebot[angebot.length - 1]?.wert || "alles");
  return { zeitraeume: angebot, gewaehlt, daten: watchStatistik(gewaehlt) };
});

ipcMain.handle("library:reorder", (_event, ids) => {
  const liste = Array.isArray(ids) ? ids.map((wert) => String(wert || "")) : [];
  if (!liste.length) return favorites;
  liste.forEach((id, stelle) => {
    const favorite = favorites.find((item) => item.id === id);
    if (favorite) favorite.libraryOrder = stelle;
  });
  saveFavorites();
  return favorites;
});

// Einen Suchtreffer direkt auf die Watchlist nehmen, ohne ihn zu oeffnen.
// Kennt die App den Titel schon, wird der vorhandene Eintrag markiert statt
// ein zweiter angelegt.
ipcMain.handle("favorites:add-result", async (_event, treffer) => {
  const provider = enabledProviders().find((item) => item.id === treffer?.providerId)
    || enabledProviders().find((item) => item.name === treffer?.providerName);
  if (!provider) return { favorites, added: false, reason: "Anbieter nicht gefunden" };

  // Ohne eigene Adresse bliebe von der Aufloesung die Startseite des Anbieters
  // uebrig - die gehoert nicht auf die Watchlist.
  const roh = String(treffer?.url || "").trim();
  const url = roh ? absoluteHttpUrl(roh, provider.startUrl || "") : "";
  if (!providerModel.isHttpUrl(url)) return { favorites, added: false, reason: "Adresse nicht erkannt" };

  const normalized = normalizeFavoriteUrl(url);
  const vorhanden = favorites.find((favorite) => favoriteMatchesCurrentProviderTitle(favorite, provider, url, normalized));
  if (vorhanden) {
    const schonDabei = vorhanden.favorite !== false && !vorhanden.completed;
    vorhanden.favorite = true;
    vorhanden.updatedAt = new Date().toISOString();
    moveFavoriteToFront(vorhanden);
    saveFavorites();
    sendActiveState();
    // Der Eintrag selbst gehoert mit zurueck: wer einen Suchtreffer nicht
    // vormerken, sondern gleich abhaken will, braucht danach seine Kennung -
    // und die gibt es nur hier, denn der Treffer hatte noch keine.
    return { favorites, added: true, already: schonDabei, title: vorhanden.title, favorite: vorhanden };
  }

  const identity = episodeIdentity(url);
  const favorite = normalizeLoadedFavorite({
    id: crypto.randomUUID(),
    providerId: provider.id,
    providerName: provider.name,
    title: cleanTitle(treffer?.title || titleFromPath(url) || provider.name),
    url,
    normalizedUrl: normalized,
    favicon: "",
    thumbnail: String(treffer?.thumbnail || ""),
    logo: provider.logo || "",
    favorite: true,
    watched: false,
    completed: false,
    episodeCompleted: false,
    hideFromContinueWatching: false,
    progress: 0,
    duration: 0,
    position: 0,
    currentTime: 0,
    type: normalizeMediaType(treffer?.type || inferMediaType(url)),
    season: identity?.season || 0,
    episode: identity?.episode || 0,
    lastWatchedAt: "",
    activity: [],
    createdAt: new Date().toISOString()
  });
  favorites.unshift(favorite);
  // Die Trefferliste der Anbieter bringt oft kein Bild mit - AniWorlds
  // Schnellsuche liefert nur Titel und Adresse. Eine Kachel ohne Bild ist die
  // gemeldete "Luecke" in der Watchlist: sie fuellte sich erst, wenn man den
  // Titel einmal geoeffnet hatte. Deshalb wird das Poster gleich hier geholt,
  // bevor die Oberflaeche die Liste bekommt.
  if (!favorite.thumbnail) {
    await repairFavoriteThumbnailIfNeeded(favorite, provider, true).catch(() => false);
  }
  saveFavorites();
  sendActiveState();
  console.log(`[ELFIX] ${favorite.title} aus der Suche auf die Watchlist genommen`);
  return { favorites, added: true, already: false, title: favorite.title, favorite };
});

// Eigenes Bild fuer einen Titel. Es liegt als Data-URL am Eintrag: die
// Oberflaeche hat es vorher auf eine vernuenftige Groesse gebracht, damit die
// Ablage nicht mit Megabytes vollaeuft.
ipcMain.handle("favorites:set-image", (_event, favoriteId, dataUrl, ausschnitt) => {
  const favorite = favorites.find((item) => item.id === String(favoriteId || ""));
  if (!favorite) return { favorites, saved: false };

  const bild = String(dataUrl || "");
  if (bild && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(bild)) {
    return { favorites, saved: false, reason: "Kein Bild erkannt" };
  }
  if (bild.length > CUSTOM_BILD_MAX_ZEICHEN) {
    return { favorites, saved: false, reason: "Bild ist zu groß" };
  }

  // Ein Bild gehoert zum Titel, nicht zu der Kachel, auf der es gesetzt wurde.
  // Denselben Titel gibt es mehrfach in der Ablage - den eigenen Eintrag und je
  // einen pro Watchparty-Runde. Vorher trug nur die angeklickte Kachel das
  // Bild, und in "Gemeinsam weiterschauen" stand weiter das des Anbieters.
  const betroffen = favorites.filter((item) => istGleicherTitel(item, favorite));
  // Der Ausschnitt gehoert zum Bild und wandert mit ihm. Ohne Bild gibt es
  // auch nichts zuzuschneiden - dann faellt er weg.
  const lage = bild ? bildausschnitt.normalisierenOderNull(ausschnitt) : null;
  for (const eintrag of betroffen) {
    eintrag.customThumbnail = bild;
    eintrag.customThumbnailCrop = lage;
  }
  saveFavorites();
  sendActiveState();
  console.log(`[ELFIX] ${favorite.title}: eigenes Bild ${bild ? "gesetzt" : "entfernt"} (${betroffen.length} Eintraege)`);
  return { favorites, saved: true, hasImage: Boolean(bild), entries: betroffen.length };
});

// Nur den Ausschnitt aendern, ohne das Bild noch einmal zu schicken.
//
// Genau dafuer liegen Bild und Lage getrennt: ein neuer Ausschnitt bewegt ein
// paar Zahlen, nicht ein paar hundert Kilobyte. Wer die Formatierung ein
// zweites Mal anpasst, speichert deshalb nicht ein zweites Bild.
ipcMain.handle("favorites:set-image-crop", (_event, favoriteId, ausschnitt) => {
  const favorite = favorites.find((item) => item.id === String(favoriteId || ""));
  if (!favorite) return { favorites, saved: false };
  if (!favorite.customThumbnail) {
    return { favorites, saved: false, reason: "Für dieses Bild gibt es nichts zuzuschneiden" };
  }

  const lage = bildausschnitt.normalisierenOderNull(ausschnitt);
  // Der Ausschnitt haengt am Titel, nicht an der Kachel - aus demselben Grund
  // wie das Bild selbst.
  const betroffen = favorites.filter((item) => istGleicherTitel(item, favorite));
  for (const eintrag of betroffen) eintrag.customThumbnailCrop = lage;
  saveFavorites();
  sendActiveState();
  return { favorites, saved: true, crop: lage, entries: betroffen.length };
});

// Zeigen zwei Eintraege denselben Titel? Die Adresse entscheidet zuerst - sie
// zeigt verlaesslich auf dieselbe Serie. Der Titel-Schluessel kommt dazu, damit
// es auch ueber Anbieter hinweg derselbe Titel bleibt; der Rueckfalltitel
// "Favorit" zaehlt dabei nicht, sonst waeren alle namenlosen Eintraege gleich.
function istGleicherTitel(links, rechts) {
  if (!links || !rechts) return false;
  if (links.id === rechts.id) return true;
  if (istGleicheSerie(links.url, rechts.url)) return true;
  const hier = watchpartyKey(links);
  const dort = watchpartyKey(rechts);
  return Boolean(hier) && hier === dort && !/:favorit$/.test(hier);
}

// Ein eigenes Bild, das fuer diese Serie schon irgendwo hinterlegt ist.
function bekanntesEigenesBild(url) {
  const treffer = favorites.find((item) => item.customThumbnail && istGleicheSerie(item.url, url));
  return treffer?.customThumbnail || "";
}

// Und der Ausschnitt dazu. Beides kommt aus demselben Eintrag: ein Ausschnitt
// ohne das Bild, fuer das er gewaehlt wurde, waere ein falscher Ausschnitt.
function bekannterBildAusschnitt(url) {
  const treffer = favorites.find((item) => item.customThumbnail && istGleicheSerie(item.url, url));
  return treffer ? bildausschnitt.normalisierenOderNull(treffer.customThumbnailCrop) : null;
}

// Von Hand als gesehen abhaken: die Serie wandert in die Mediathek, ohne dass
// sie dafuer durchlaufen werden muss. Der gespeicherte Stand bleibt liegen -
// wer spaeter neu anfaengt, findet die Folge wieder, an der er war.
ipcMain.handle("favorites:mark-completed", (_event, favoriteId) => {
  const favorite = favorites.find((item) => item.id === String(favoriteId || ""));
  if (!favorite) return { favorites, completed: false };

  favorite.completed = true;
  favorite.completedAt = new Date().toISOString();
  // Von Hand abgehakt zaehlt anders als durchgeschaut: ein spaeteres
  // Wiederansehen soll den Eintrag nicht aus der Mediathek zurueckholen.
  favorite.completedManually = true;
  favorite.episodeCompleted = false;
  favorite.continuePending = false;
  favorite.hideFromContinueWatching = true;
  favorite.favorite = false;
  favorite.newEpisodeAt = "";
  favorite.newEpisodeLabel = "";
  saveFavorites();
  sendActiveState();
  console.log(`[ELFIX] ${favorite.title} von Hand als abgeschlossen abgehakt`);
  return { favorites, completed: true };
});

// Ein Eintrag, den man schon kennt, auf die Watchlist setzen oder wieder
// herunternehmen. Bisher ging das nur ueber das Herz auf der geoeffneten Seite -
// wer einen Titel aus Weiterschauen vormerken wollte, musste ihn dafuer erst
// starten.
//
// Das Gegenstueck zum Abhaken: dort wird der Merker geloescht, hier gesetzt.
// Am Weiterschauen-Stand aendert sich nichts, die beiden Listen sind
// unabhaengig voneinander.
ipcMain.handle("favorites:set-watchlist", (_event, favoriteId, wert) => {
  const favorite = favorites.find((item) => item.id === String(favoriteId || ""));
  if (!favorite) return { favorites, favorite: false, gefunden: false };

  const gemerkt = wert !== false;
  if (favorite.favorite === gemerkt) return { favorites, favorite: gemerkt, gefunden: true };
  favorite.favorite = gemerkt;
  // Was auf der Watchlist steht, gilt nicht mehr als abgehakt - sonst stuende
  // derselbe Titel gleichzeitig in der Mediathek und unter "will ich sehen".
  if (gemerkt && favorite.completed) {
    favorite.completed = false;
    favorite.completedManually = false;
    favorite.completedAt = "";
  }
  favorite.updatedAt = new Date().toISOString();
  saveFavorites();
  sendActiveState();
  return { favorites, favorite: gemerkt, gefunden: true };
});

// Der Hinweis auf neue Folgen verschwindet, sobald der Titel geoeffnet oder
// weggeklickt wurde. Ohne Angabe gilt es fuer alle.
ipcMain.handle("favorites:clear-new", (_event, favoriteId) => {
  const id = String(favoriteId || "");
  let geaendert = false;
  for (const favorite of favorites) {
    if (!favorite.newEpisodeAt || (id && favorite.id !== id)) continue;
    favorite.newEpisodeAt = "";
    favorite.newEpisodeLabel = "";
    geaendert = true;
  }
  if (geaendert) saveFavorites();
  return favorites;
});

ipcMain.handle("continue:hide", (_event, favoriteId) => {
  const favorite = favorites.find((item) => item.id === favoriteId);
  if (!favorite) return favorites;
  resetContinueProgressToStart(favorite);
  saveFavorites();
  return favorites;
});

ipcMain.handle("history:clear", () => {
  for (const favorite of favorites) {
    favorite.activity = [];
  }
  saveFavorites();
  return { favorites, cleared: true };
});

ipcMain.handle("favorites:open", (_event, favoriteId, options = {}) => favoritOeffnen(favoriteId, options));

// Einen Eintrag oeffnen. Eigene Funktion, weil zwei Wege hierher fuehren: die
// Oberflaeche und die Fernbedienung im Handy.
async function favoritOeffnen(favoriteId, options = {}) {
  const favorite = favorites.find((item) => item.id === favoriteId);
  // Wer die Serie oeffnet, hat den Hinweis gesehen.
  if (favorite?.newEpisodeAt) {
    favorite.newEpisodeAt = "";
    favorite.newEpisodeLabel = "";
  }
  if (!favorite) return null;

  const provider = enabledProviders().find((item) => item.id === favorite.providerId)
    || enabledProviders().find((item) => item.name === favorite.providerName)
    || enabledProviders()[0];
  if (!provider) return null;

  activeFavoriteId = favorite.id;
  moveFavoriteToFront(favorite);
  // Kommt der Stand aus der Watchparty, wird nach dem Start genau dorthin
  // gesprungen - die Anbieterseite kennt nur ihren eigenen Stand.
  if (favorite.watchpartyFrom) {
    merkeWatchpartySprung(provider.id, { position: favorite.position || favorite.currentTime });
  }
  recordMediaActivity(provider, favorite.url, {}, { existing: favorite, label: "Geöffnet" });
  await repairFavoriteThumbnailIfNeeded(favorite, provider).catch(() => false);
  if (options?.autoplay) await beginAutostart(provider.id, cleanTitle(favorite.title));
  await navigateProvider(provider, oeffnenAdresse(provider, favorite));
  if (options?.autoplay) scheduleProviderAutoplay(provider, activeView, { fullscreen: Boolean(options?.fullscreen) });
  return activeState();
}

ipcMain.handle("favorites:repair-thumbnail", async (_event, favoriteId, force = false) => {
  const favorite = favorites.find((item) => item.id === favoriteId);
  if (!favorite) return { favorites, favorite: null, repaired: false };

  const provider = enabledProviders().find((item) => item.id === favorite.providerId)
    || enabledProviders().find((item) => item.name === favorite.providerName);
  const repaired = await repairFavoriteThumbnailIfNeeded(favorite, provider, Boolean(force)).catch(() => false);
  return { favorites, favorite, repaired };
});

// Das Kontextmenue eines Anbieters in der Leiste.
//
// Ein Fenstermenue und kein Kaestchen aus HTML: die Leiste steht direkt ueber
// der Anbieterseite, und die ist eine eigene Ansicht, die jedes HTML darunter
// verdeckt. Ein aufgeklapptes Menue waere dort halb unsichtbar und nicht
// anklickbar - dasselbe Problem wie beim Umschalten der Watchparty.
ipcMain.handle("provider:context-menu", async (_event, name, punkt) => {
  if (!mainWindow || mainWindow.isDestroyed()) return "";
  const titel = String(name || "").slice(0, 60);
  return new Promise((fertig) => {
    let gewaehlt = "";
    const menue = Menu.buildFromTemplate([
      { label: titel || "Anbieter", enabled: false },
      { type: "separator" },
      { label: "Bearbeiten", click: () => { gewaehlt = "edit"; } },
      { label: "Neuer Anbieter", click: () => { gewaehlt = "new"; } }
    ]);
    const stelle = punkt && Number.isFinite(punkt.x) && Number.isFinite(punkt.y)
      ? { x: Math.round(punkt.x), y: Math.round(punkt.y) }
      : {};
    menue.popup({ window: mainWindow, ...stelle, callback: () => fertig(gewaehlt) });
  });
});

ipcMain.handle("provider:save-all", (_event, nextProviders) => {
  providers = providerModel.normalizeProviders(nextProviders);
  if (!enabledProviders().some((item) => item.id === activeProviderId)) {
    activeProviderId = null;
    activeView = null;
  }
  saveProviders();
  return { providers, activeProviderId };
});

// Der Anbieter hat eine neue Adresse.
//
// AniWorld und S.to wechseln sie regelmaessig, und danach zeigt jeder Eintrag
// ins Leere - die Watchlist, die Mediathek, die abgehakten Folgen, der Verlauf
// und die Bilder gleich mit. Hier wird der Wirt in allem auf einmal ersetzt.
//
// Gerechnet wird zuerst und geschrieben erst nach der Rueckfrage: was der
// Bericht nennt, ist genau das, was danach anders ist.
ipcMain.handle("provider:relocate", async (_event, providerId, neueAdresse) => {
  const vorschau = umzug.umziehen({
    providers,
    favorites,
    providerId: String(providerId || ""),
    neueAdresse,
    normalisieren: normalizeFavoriteUrl
  });
  if (!vorschau.ok) return { moved: false, reason: vorschau.grund };

  const bericht = vorschau.bericht;
  const dieser = providers.find((eintrag) => eintrag.id === providerId);
  const zeilen = [
    `Von ${bericht.vonHost} auf ${bericht.nachWurzel}.`,
    "",
    bericht.eintraege === 0
      ? "Kein Eintrag der Watchlist zeigt auf die alte Adresse - es ziehen nur die Anbieterangaben um."
      : `${bericht.eintraege} Eintrag/Eintraege ziehen mit, davon ${bericht.mediathek} in der Mediathek.`
      + ` Insgesamt ${bericht.felder} Adressen, Vorschaubilder und abgehakte Folgen inbegriffen.`,
    "",
    "Geaendert wird nur der Wirt. Pfade bleiben, wie sie sind - liegt drueben"
      + " etwas anderes unter demselben Pfad, hilft das hier nicht."
  ];
  if (bericht.bilder) {
    zeilen.push("", `${bericht.bilder} Vorschaubilder liegen beim alten Wirt und ziehen mit.`);
  }
  if (bericht.mitbewohner.length) {
    zeilen.push("", `Achtung: ${bericht.mitbewohner.join(", ")} steht/stehen auf derselben alten Adresse und bleibt/bleiben dort.`);
  }

  const antwort = await dialog.showMessageBox(mainWindow, {
    type: "question",
    buttons: ["Abbrechen", "Umziehen"],
    defaultId: 0,
    cancelId: 0,
    message: `${dieser?.name || "Anbieter"} umziehen?`,
    detail: zeilen.join("\n")
  });
  if (antwort.response !== 1) return { moved: false };

  // Wohin die offene Seite gehoert, muss vor dem Umschreiben feststehen -
  // danach ist die alte Adresse nirgends mehr zu finden.
  const offeneAdresse = activeProvider()?.id === providerId
    ? umzug.adresse(activeView?.webContents?.getURL() || "", vorschau.vonHost, vorschau.nachWurzel)
    : "";

  providers = providerModel.normalizeProviders(vorschau.providers);
  favorites = vorschau.favorites;
  saveProviders();
  // Zieht die neuen Adressen an die anderen Geraete nach. Uebernehmen werden
  // sie den Wirt nicht - jedes Geraet hat seine eigene Anbieterliste, und wer
  // den Anbieter unter einer anderen Adresse erreicht, soll sie behalten.
  saveFavorites();
  sendActiveState();

  const ziel = providers.find((eintrag) => eintrag.id === providerId);
  if (ziel && offeneAdresse) {
    await navigateProvider(ziel, offeneAdresse).catch(() => {});
  }

  console.log(`[ELFIX UMZUG] ${ziel?.name || providerId}: ${bericht.vonHost} -> ${bericht.nachWurzel}, ${bericht.eintraege} Eintraege`);
  return { moved: true, providers, favorites, bericht };
});

// Alles Gelernte vergessen. Der Weg zurueck, wenn eine Marke einmal daneben
// liegt - und der einzige: nachbessern kann man sie nicht, man kann ihr nur
// neue Sprünge zeigen.
ipcMain.handle("marken:vergessen", () => {
  const anzahl = Object.keys(loadMarken()).length;
  markenSpeicher = {};
  markenSchmutzig = true;
  saveMarken();
  // Der Knopf in der offenen Seite verschwindet sofort mit.
  if (isLiveView(activeView)) {
    executeJavaScriptInMediaFrames(activeView,
      "window.__elfixMarke && window.__elfixMarke.entfernen()").catch(() => []);
  }
  console.log(`[ELFIX MARKEN] ${anzahl} Serien vergessen`);
  return { vergessen: anzahl };
});

// Wie viele Serien ELFIX inzwischen kennt - fuer die Zeile in den
// Einstellungen. Ohne sie waere "vergessen" ein Knopf ins Ungewisse.
// --- Fernbedienung: die Aufrufe aus der Oberflaeche --------------------------

ipcMain.handle("fern:status", async () => ({
  ...fernbedienung.status(),
  // Die Lage drueben gehoert dazu: ohne sie steht in den Einstellungen "bereit
  // fuers Handy", waehrend das Handy von einem alten Relay eine Seite bekommt,
  // die sich nicht installieren laesst.
  relay: await relayZustand()
}));

// Das Relay einmal fragen, was es kann. Die Antwort haelt eine Minute - die
// Einstellungen werden oft auf- und zugeklappt, und /health soll davon nicht
// im Sekundentakt getroffen werden.
let relaySpeicher = { at: 0, adresse: "", lage: null };
const RELAY_FRISCH_MS = 60000;

async function relayZustand() {
  const adresse = webAdresse(settings.watchparty?.serverUrl || "");
  if (!adresse) return null;
  if (relaySpeicher.adresse === adresse && Date.now() - relaySpeicher.at < RELAY_FRISCH_MS) {
    return relaySpeicher.lage;
  }
  let gesundheit = null;
  try {
    // Chromiums Netzwerkschicht statt des nackten fetch: sie geht denselben Weg
    // wie alles andere in dieser App, samt Proxy und Zertifikatsspeicher.
    const antwort = await net.fetch(`${adresse}/health`, { cache: "no-store" });
    if (antwort.ok) gesundheit = await antwort.json();
  } catch {
    // Nicht erreichbar ist selbst eine Auskunft - relayLage macht daraus die
    // erste Zeile des Hinweises.
  }
  const lage = relayLage(adresse, gesundheit);
  lage.hinweis = relayHinweis(lage);
  relaySpeicher = { at: Date.now(), adresse, lage };
  return lage;
}

// Der QR-Code fuer das Handy: Adresse und Kopplungscode in einem Bild.
//
// Er wird hier gerechnet und nicht in der Oberflaeche: dort gibt es kein
// require, und ein zweites Mal wollte ich das nicht schreiben. Heraus kommt
// fertiges SVG - die Seite setzt es nur noch ein.
ipcMain.handle("fern:qr", () => {
  const adresse = kopplungsAdresse(settings.watchparty?.serverUrl || "", fernSettings().code || "");
  if (!adresse) return { adresse: "", svg: "" };
  return { adresse, svg: qr.alsSvg(adresse, { hell: "#ffffff", dunkel: "#0b0f16" }) };
});

// Einschalten. Ohne Code gibt es nichts zu koppeln - also entsteht beim ersten
// Mal einer.
ipcMain.handle("fern:einschalten", () => {
  const code = fernSettings().code || codeErzeugen();
  settings.fern = { enabled: true, code };
  saveSettings();
  syncFern();
  meldeEinstellungen();
  return fernbedienung.status();
});

ipcMain.handle("fern:ausschalten", () => {
  // Der Code bleibt stehen. Wer nur kurz abschaltet, soll das Handy danach
  // nicht neu koppeln muessen.
  settings.fern = { ...(settings.fern || {}), enabled: false };
  saveSettings();
  syncFern();
  meldeEinstellungen();
  return fernbedienung.status();
});

// Ein neuer Code loest alle gekoppelten Handys. Der Weg, wenn jemand den alten
// kennt, der ihn nicht kennen soll.
ipcMain.handle("fern:neuer-code", () => {
  settings.fern = { enabled: true, code: codeErzeugen() };
  saveSettings();
  syncFern();
  meldeEinstellungen();
  return fernbedienung.status();
});

ipcMain.handle("marken:stand", () => {
  const eintraege = loadMarken();
  const schluessel = Object.keys(eintraege);
  return {
    serien: schluessel.length,
    marken: schluessel.filter((eintrag) => eintraege[eintrag]?.marke).length
  };
});

// Was ELFIX sich an Fassungen gemerkt hat, und der Weg zurueck. Denselben Weg
// gibt es fuer die Intromarken, und aus demselben Grund: gelernt wird aus dem
// eigenen Verhalten, und was daraus wurde, muss man sehen und loeschen koennen.
ipcMain.handle("fassungen:stand", () => {
  const eintraege = loadFassungen();
  const schluessel = Object.keys(eintraege);
  const namen = new Map();
  for (const eintrag of schluessel) {
    const name = fassung.lesen(eintraege, eintrag)?.name || "";
    if (name) namen.set(name, (namen.get(name) || 0) + 1);
  }
  return {
    serien: schluessel.length,
    // Haeufigste zuerst - das ist die Fassung, in der jemand schaut.
    fassungen: [...namen.entries()]
      .sort((links, rechts) => rechts[1] - links[1])
      .slice(0, 4)
      .map(([name, anzahl]) => ({ name, anzahl }))
  };
});

ipcMain.handle("fassungen:vergessen", () => {
  const anzahl = Object.keys(loadFassungen()).length;
  fassungSpeicher = {};
  fassungSchmutzig = true;
  saveFassungen();
  console.log(`[ELFIX FASSUNG] ${anzahl} Serien vergessen`);
  return { vergessen: anzahl };
});

ipcMain.handle("watchparty:status", () => watchparty.status());

ipcMain.handle("watchparty:items", () => watchpartyItems());

ipcMain.handle("watchparty:open", async (_event, key, room) => openWatchpartyItem(key, room));

ipcMain.handle("watchparty:rooms", () => watchpartyRaumUebersicht());

// Auswahl aus einer Liste von Raeumen - fuer das Live-Beitreten, wenn derselbe
// Titel in mehreren Runden steht.
ipcMain.handle("watchparty:choose-room", async (_event, rooms, punkt) => {
  const erlaubt = Array.isArray(rooms) ? rooms.map((wert) => String(wert || "")).filter(Boolean) : [];
  if (erlaubt.length < 2) return erlaubt[0] || "";
  return frageWatchpartyRaum(punkt, erlaubt);
});

// Umschalten, fuer wen das gerade Geschaute zaehlt: fuer dich allein oder fuer
// eine bestimmte Runde. Das entscheidet, wohin der Fortschritt laeuft und wer
// mitsteuern darf.
ipcMain.handle("watchparty:switch-context", (_event, punkt) => watchpartyKontextWechseln(punkt));

// Wofuer zaehlt das hier? Der Wechsel zwischen dem eigenen Stand und den
// Raeumen, in denen dieser Titel mitlaeuft.
//
// Eigene Funktion, weil zwei Wege hierher fuehren: die Kopfzeile - die einen
// Punkt mitbringt, an dem das Menue aufgehen soll - und das Tastenkuerzel, das
// keinen hat.
async function watchpartyKontextWechseln(punkt) {
  const adresse = activeView?.webContents?.getURL() || "";
  const moeglich = watchpartyRaeumeForUrl(adresse);
  if (!moeglich.length) return { switched: false };

  const aktuell = watchpartyRaumForUrl(adresse) || PRIVAT;
  const wahl = await frageWatchpartyRaum(punkt, moeglich.map((item) => item.room), {
    withPrivate: true,
    aktuell,
    titel: "Wofür zählt das hier?"
  });
  if (!wahl) return { switched: false };

  const key = moeglich[0].key;
  if (wahl === PRIVAT) {
    // Zurueck auf den eigenen Stand: die Live-Steuerung der Runde endet hier,
    // die Mitgliedschaft bleibt bestehen.
    const raum = watchpartyRaumForUrl(adresse);
    if (raum) setWatchpartyLive(key, false, raum);
    setzePrivatenKontext(key, adresse);
    pushWatchpartyLiveState();
    return { switched: true, room: "" };
  }

  // In eine Runde wechseln heisst live dabei sein - etwas dazwischen gibt es
  // nicht mehr. Also gleich den Stand des Hosts nachfragen.
  uebernehmeWatchpartyRaum(key, wahl);
  setWatchpartyLive(key, true, wahl);
  pushWatchpartyLiveState();
  watchpartyAngeklinkt.clear();
  watchparty.abgleichen(key, wahl);
  return { switched: true, room: wahl };
}

ipcMain.handle("watchparty:share-current", async (_event, room, punkt) => {
  const provider = activeProvider();
  const url = activeView?.webContents?.getURL() || "";
  if (!provider || !providerModel.isHttpUrl(url)) {
    return { shared: false, reason: "Kein Titel geöffnet" };
  }

  // Steht der Titel schon in der eigenen Liste, hat er Bild und Fortschritt -
  // sonst wird beides aus der Seite gelesen.
  const normalized = normalizeFavoriteUrl(url);
  let favorite = favorites.find((item) => item.id === activeFavoriteId)
    || favorites.find((item) => item.normalizedUrl === normalized);

  if (!favorite) {
    const meta = await readPageMetadata(activeView).catch(() => ({}));
    const identity = episodeIdentity(url);
    favorite = {
      providerName: provider.name,
      title: cleanTitle(meta.title || activeView.webContents.getTitle() || provider.name),
      url,
      thumbnail: meta.thumbnail || "",
      type: normalizeMediaType(meta.type || inferMediaType(url)),
      season: identity?.season || 0,
      episode: identity?.episode || 0
    };
  }
  return shareWatchpartyFavorite(favorite, room, punkt);
});

ipcMain.handle("watchparty:enter", (_event, key, room) => {
  watchparty.beitreten(String(key || ""), String(room || ""));
  return true;
});

ipcMain.handle("watchparty:leave", (_event, key, room) => {
  watchparty.verlassen(String(key || ""), String(room || ""));
  return true;
});

ipcMain.handle("watchparty:remove", (_event, key, room) => {
  watchparty.entfernen(String(key || ""), String(room || ""));
  return true;
});

// Zwei Zustaende, mehr nicht: privat oder live in genau einer Runde. Den
// Zwischenschritt "in der Watchparty, aber Live aus" gibt es nicht mehr - er
// sah aus wie ein Fehler und niemand konnte sagen, was gerade wohin zaehlt.
ipcMain.handle("watchparty:live-toggle", (_event, key, an, room) => {
  const schluessel = String(key || "");
  const adresse = activeView?.webContents?.getURL() || "";
  const beitreten = Boolean(an);
  let raum = String(room || "") || watchpartyRaumForUrl(adresse);

  // Steht derselbe Anime in mehreren Runden und ist noch keine gewaehlt, muss
  // erst feststehen, welcher man live folgt.
  if (beitreten && !raum) {
    const moeglich = watchpartyRaeumeForUrl(adresse);
    if (moeglich.length > 1) return { needsRoom: true, rooms: moeglich.map((item) => item.room), key: schluessel };
    raum = moeglich[0]?.room || "";
  }
  if (!raum) return { live: false, room: "" };

  if (beitreten) {
    // Live beitreten heisst zugleich: ab jetzt zaehlt der Eintrag dieser Runde.
    uebernehmeWatchpartyRaum(schluessel, raum);
    setWatchpartyLive(schluessel, true, raum);
    // Sofort melden statt auf den naechsten Takt zu warten - sonst springt der
    // Knopf erst Sekunden spaeter um.
    pushWatchpartyLiveState();
    watchpartyAngeklinkt.clear();
    watchparty.abgleichen(schluessel, raum);
    return { live: watchpartyLiveAktiv(schluessel, raum), room: raum };
  }

  // Live verlassen heisst zurueck auf privat: der Stand zaehlt ab jetzt wieder
  // nur fuer dieses Geraet. Die Mitgliedschaft in der Watchparty bleibt.
  setWatchpartyLive(schluessel, false, raum);
  setzePrivatenKontext(schluessel, adresse);
  pushWatchpartyLiveState();
  return { live: false, room: "" };
});

ipcMain.handle("watchparty:resync", async (_event, key, room) => {
  const eintrag = watchpartyEintrag(key, room);
  if (!eintrag) return false;
  // Die eigene Stelle als Vorschlag mitgeben; der Server bevorzugt den Host.
  let position = 0;
  for (const [, view] of providerViews) {
    if (!isLiveView(view)) continue;
    if (!istGleicheFolge(eintrag.url, view.webContents.getURL())) continue;
    const werte = await executeJavaScriptInMediaFrames(view, "(() => { const v = Array.from(document.querySelectorAll('video')).filter((m) => Number(m.duration) > 0).sort((a, b) => b.duration - a.duration)[0]; return v ? Number(v.currentTime.toFixed(2)) : 0; })()").catch(() => []);
    position = Math.max(position, ...(werte || []).map((e) => Number(e?.value ?? e) || 0));
  }
  watchparty.gleichziehen(eintrag.key, position, eintrag.room);
  return true;
});

ipcMain.handle("watchparty:choose-member", async (_event, kandidaten, punkt) => (
  frageWatchpartyMitglied(kandidaten, punkt)
));

ipcMain.handle("watchparty:handover", (_event, key, memberId, room) => {
  watchparty.hostUebergeben(String(key || ""), String(memberId || ""), String(room || ""));
  return true;
});

ipcMain.handle("watchparty:kick", (_event, key, memberId, room) => {
  watchparty.rauswerfen(String(key || ""), String(memberId || ""), String(room || ""));
  return true;
});

// --- YouTube-Watchparty ------------------------------------------------------
// Ein eigener Modus, also auch eigene Kanaele. Nichts hiervon geht durch die
// Steuerung der Watchparty fuer Serien.

ipcMain.handle("youtubeparty:status", () => youtubePartyStatus());

// Die YouTube-Runde ein- oder ausschalten. Leerer Raumcode heisst aus.
//
// Die Einstellungen kommen mit zurueck: die Oberflaeche baut beim naechsten
// Speichern den ganzen Watchparty-Block neu auf und wuerde den Raum sonst
// wieder herausschreiben, weil sie ihn noch nicht kennt.
ipcMain.handle("youtubeparty:set-room", (_event, room) => {
  const code = String(room || "").trim().normalize("NFC").slice(0, 64);
  if (code && !watchparty.codes.includes(code)) {
    return { ok: false, reason: "Diesen Raum gibt es nicht", status: youtubePartyStatus(), settings: publicSettings(settings) };
  }
  settings.watchparty = { ...(settings.watchparty || {}), youtubeRoom: code };
  saveSettings();
  youtubePartySync();
  return { ok: true, status: youtubePartyStatus(), settings: publicSettings(settings) };
});

// Umschalten, fuer wen YouTube gerade zaehlt: privat oder eine bestimmte Runde.
// Auf der YouTube-Seite ist die Anzeige oben der einzige Schalter. Der ⇄ Knopf
// der Serien-Watchparty ist dort weg, denn er stellt einen Titel in einen Raum
// - und eine YouTube-Runde ist kein Titel, sondern die ganze Sitzung.
ipcMain.handle("youtubeparty:switch-context", async (_event, punkt) => {
  if (!watchparty.aktiv || !watchparty.codes.length) return { switched: false, status: youtubePartyStatus() };

  const bisher = String(settings.watchparty?.youtubeRoom || "");
  const wahl = await frageWatchpartyRaum(punkt, watchparty.codes, {
    withPrivate: true,
    aktuell: bisher || PRIVAT,
    titel: "YouTube gemeinsam schauen?"
  });
  // Leer heisst abgebrochen; dieselbe Wahl noch einmal ist keine Aenderung und
  // soll die Runde nicht neu aufbauen.
  if (!wahl) return { switched: false, status: youtubePartyStatus() };
  const code = wahl === PRIVAT ? "" : wahl;
  if (code === bisher) return { switched: false, status: youtubePartyStatus() };

  settings.watchparty = { ...(settings.watchparty || {}), youtubeRoom: code };
  saveSettings();
  youtubePartySync();
  return { switched: true, room: code, status: youtubePartyStatus(), settings: publicSettings(settings) };
});

// Von Hand nachfragen, was gilt, und sich daran anschliessen. Derselbe Weg wie
// nach einem Verbindungsabriss - alte eigene Ereignisse werden dabei nie
// nachgereicht.
ipcMain.handle("youtubeparty:resync", async () => {
  youtubeParty.anfordern();
  await youtubeAnschluss("handbetrieb").catch(() => {});
  return youtubePartyStatus();
});

// Zum Video der Runde springen - ausdruecklich gewollt, deshalb hier auch dann,
// wenn gerade ein anderer Anbieter vorn ist.
ipcMain.handle("youtubeparty:open", async () => {
  const zustand = youtubeParty.stand;
  const provider = enabledProviders().find((eintrag) => youtube.istYoutubeUrl(eintrag.startUrl));
  if (!zustand?.videoId || !provider) return activeState();
  const sekunde = Math.max(0, Math.floor(
    youtubeSync.zielPosition(zustand, Date.now() + (zustand.versatz || 0))
  ));
  youtubeErwartet = { videoId: zustand.videoId, bis: Date.now() + YOUTUBE_ERWARTET_MS };
  await navigateProvider(provider, youtube.fortsetzenUrl(
    zustand.url || `https://www.youtube.com/watch?v=${zustand.videoId}`,
    sekunde
  ));
  scheduleProviderAutoplay(provider, activeView, { fullscreen: false });
  youtubeNachziehenPlanen();
  return activeState();
});

ipcMain.handle("settings:save", (_event, nextSettings) => {
  settings = normalizeSettings(nextSettings);
  saveSettings();
  syncWatchparty();
  syncGeraete();
  syncFern();
  return publicSettings(settings);
});

// --- Meine Geraete: die Aufrufe aus der Oberflaeche --------------------------

ipcMain.handle("geraete:status", () => geraete.status());

// Einen neuen Schluessel erzeugen. Er wird sofort gespeichert und der Abgleich
// eingeschaltet: ein Schluessel, den man erst noch bestaetigen muss, ist auf
// dem zweiten Geraet schon abgetippt und hier noch nicht in Kraft.
ipcMain.handle("geraete:schluessel-erzeugen", () => {
  const schluessel = geraeteSchluessel.erzeugen();
  settings.geraete = { enabled: true, key: schluessel };
  saveSettings();
  syncGeraete();
  meldeEinstellungen();
  return { key: geraeteSchluessel.anzeigen(schluessel), status: geraete.status() };
});

// Einen abgetippten Schluessel uebernehmen.
ipcMain.handle("geraete:schluessel-setzen", (_event, wert) => {
  const schluessel = geraeteSchluessel.normalisieren(wert);
  if (!schluessel) {
    return { ok: false, reason: "Das ist kein ELFIX-Schlüssel", status: geraete.status() };
  }
  settings.geraete = { enabled: true, key: schluessel };
  saveSettings();
  syncGeraete();
  meldeEinstellungen();
  return { ok: true, key: geraeteSchluessel.anzeigen(schluessel), status: geraete.status() };
});

// Dieses Geraet herausloesen. Der Schluessel geht hier weg, die Eintraege
// bleiben - was geschaut wurde, wurde geschaut. Beim Relay bleibt der Raum
// stehen, bis ihn ein halbes Jahr niemand mehr benutzt; die anderen Geraete
// laufen also unveraendert weiter.
ipcMain.handle("geraete:trennen", () => {
  settings.geraete = { enabled: false, key: "" };
  saveSettings();
  syncGeraete();
  meldeEinstellungen();
  return geraete.status();
});

// Von Hand anstossen - fuer den Knopf in den Einstellungen. Ohne ihn muesste
// man raten, ob gerade etwas passiert.
//
// Der Knopf holt dabei den ganzen Raum noch einmal, nicht nur das Neue. Er ist
// der Weg zurueck fuer den einen Fall, den der laufende Abgleich nicht von
// selbst heilt: ein Eintrag, der hier nicht angelegt werden konnte, weil der
// Anbieter dazu fehlte. Ist er inzwischen da, kommt der Titel damit nach.
ipcMain.handle("geraete:jetzt-abgleichen", () => {
  geraete.vollAbgleichen();
  geraete.abgleichen(geraeteStaende());
  geraete.anhaengen(geraeteSitzungen());
  return geraete.status();
});

ipcMain.handle("adblock:update-filters", async () => {
  try {
    const result = await updateFilterLists();
    return { ok: true, ...result, settings: publicSettings(settings), filterLists: ADGUARD_FILTER_LISTS };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("adblock:blocked", () => blockedRequests.slice(-120).reverse());
ipcMain.handle("media:diagnostics", () => mediaDiagnostics.slice(-120).reverse());

ipcMain.handle("data:clear-cache", async () => {
  await clearBrowserDataPreservingLogin();
  return true;
});

ipcMain.handle("data:open-folder", () => {
  shell.openPath(DATA_DIR);
  return true;
});

// "Hilfe & Support" fuehrt zu den Issues des Projekts - und zwar im richtigen
// Browser, nicht in einer Ansicht von ELFIX. Wer ein Problem meldet, braucht
// sein GitHub-Konto, seine Anmeldung und seine Erweiterungen; nichts davon
// liegt hier.
//
// Der Renderer gibt bewusst keine Adresse mit. Waere das hier ein allgemeines
// "oeffne diese URL", muesste jede kuenftige Stelle im Renderer als moegliche
// Quelle einer fremden Adresse gelten. So gibt es genau ein Ziel, und es steht
// in dieser Datei.
ipcMain.handle("help:open-issues", async () => {
  try {
    await shell.openExternal(REPOSITORY_URL + "/issues");
    return { ok: true };
  } catch (error) {
    // Kein Standardbrowser, kein Recht, kein Fenster - der Renderer soll das
    // sagen koennen, ohne dass hier etwas abbricht.
    console.warn("[hilfe] Issues konnten nicht geoeffnet werden:", error?.message || error);
    return { ok: false };
  }
});

// --- Sicherung ---------------------------------------------------------------
//
// Was hineingehoert und was nicht, entscheidet sicherung.js - dort steht auch,
// warum die Geraetekennung draussen bleibt. Hier bleiben Dateien und Dialoge.
function sicherungBauen() {
  return sicherung.bauen({
    settings: publicSettings(settings),
    favorites,
    providers,
    watchparty: watchpartyLokal,
    programm: app.getVersion()
  });
}

ipcMain.handle("data:backup-export", async () => {
  const ziel = await dialog.showSaveDialog(mainWindow, {
    title: "Sicherung speichern",
    defaultPath: sicherung.dateiname(),
    filters: [{ name: "ELFIX-Sicherung", extensions: ["json"] }]
  });
  if (ziel.canceled || !ziel.filePath) return { saved: false };

  try {
    const daten = sicherungBauen();
    fs.writeFileSync(ziel.filePath, JSON.stringify(daten, null, 2));
    const umfang = sicherung.umfang(daten);
    console.log(`[ELFIX] Sicherung geschrieben: ${ziel.filePath} (${umfang.favoriten} Eintraege, ${umfang.bilder} Bilder)`);
    return { saved: true, path: ziel.filePath, ...umfang };
  } catch (fehler) {
    return { saved: false, reason: String(fehler?.message || fehler) };
  }
});

ipcMain.handle("data:backup-import", async () => {
  const wahl = await dialog.showOpenDialog(mainWindow, {
    title: "Sicherung einlesen",
    properties: ["openFile"],
    filters: [{ name: "ELFIX-Sicherung", extensions: ["json"] }]
  });
  if (wahl.canceled || !wahl.filePaths?.length) return { restored: false };

  let daten;
  try {
    daten = JSON.parse(fs.readFileSync(wahl.filePaths[0], "utf8"));
  } catch {
    return { restored: false, reason: "Die Datei liess sich nicht lesen" };
  }
  const geprueft = sicherung.pruefen(daten);
  if (!geprueft.ok) return { restored: false, reason: geprueft.reason };

  const umfang = sicherung.umfang(daten);
  const erstellt = Date.parse(daten.erstellt) ? new Date(daten.erstellt).toLocaleString("de-DE") : "unbekannt";
  const antwort = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["Abbrechen", "Einlesen"],
    defaultId: 0,
    cancelId: 0,
    message: "Sicherung einlesen?",
    detail: [
      `Vom ${erstellt}, erstellt mit ELFIX ${daten.programm || "?"}.`,
      "",
      `Enthalten: ${umfang.favoriten} Eintraege in der Watchlist, davon ${umfang.weiterschauen} mit Weiterschauen-Stand`
        + ` und ${umfang.bilder} mit eigenem Bild. Dazu ${umfang.anbieter} Anbieter`
        + `${umfang.einstellungen ? " und alle Einstellungen" : ""}.`,
      "",
      "Was jetzt hier steht, wird dabei ersetzt. Der bisherige Stand wird vorher"
        + " als Sicherheitskopie in den Datenordner gelegt."
    ].join("\n")
  });
  if (antwort.response !== 1) return { restored: false };

  try {
    ensureDataDir();
    // Erst die Rueckfahrkarte. Wer die falsche Datei erwischt hat, soll nicht
    // seinen ganzen Stand verloren haben.
    const vorher = path.join(DATA_DIR, `vor-dem-einlesen-${Date.now()}.elfix.json`);
    fs.writeFileSync(vorher, JSON.stringify(sicherungBauen(), null, 2));

    // Die eigene Kennung bleibt, was sie ist - sie gehoert zu diesem Rechner,
    // nicht zur Sicherung.
    const uebernommen = sicherung.einstellungenUebernehmen(daten.settings, settings?.watchparty?.deviceId);
    if (uebernommen) {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(normalizeSettings(uebernommen), null, 2));
    }
    if (Array.isArray(daten.favorites)) {
      fs.writeFileSync(FAVORITES_FILE, JSON.stringify(daten.favorites, null, 2));
    }
    if (Array.isArray(daten.providers) && daten.providers.length) {
      fs.writeFileSync(PROVIDER_FILE, JSON.stringify(daten.providers, null, 2));
    }
    if (daten.watchparty) {
      fs.writeFileSync(WATCHPARTY_FILE, JSON.stringify(daten.watchparty));
    }

    // Und jetzt einlesen wie beim Start. Damit laeuft alles durch dieselbe
    // Pruefung wie sonst auch - eine Sicherung von Hand bearbeitet oder aus
    // einer aelteren Fassung kommt so gar nicht erst ungeprueft herein.
    // Die Reihenfolge zaehlt: die Watchparty-Ablage braucht die Raeume aus den
    // Einstellungen.
    settings = loadSettings();
    providers = loadProviders();
    favorites = loadFavorites();
    watchpartyLokal = loadWatchpartyLocal();
    watchpartyWiederhergestellt.clear();
    // Der Spiegel des Geraeteabgleichs gehoert nicht in die Sicherung: er
    // beschreibt, was zuletzt hinausging - und das passt nach dem Einlesen zu
    // nichts mehr. Ohne ihn gilt beim naechsten Verbinden der Stand des Raums,
    // und das ist hier das Richtige: die Sicherung bringt zurueck, was fehlt,
    // ueberschreibt aber nicht den neueren Stand des anderen Geraets.
    geraete.ablageSetzen(null);

      syncWatchparty();
    syncGeraete();
    syncFern();
    sendActiveState();
    console.log(`[ELFIX] Sicherung eingelesen: ${favorites.length} Eintraege, Kopie vorher unter ${vorher}`);
    return {
      restored: true,
      providers,
      favorites,
      settings: publicSettings(settings),
      ...umfang
    };
  } catch (fehler) {
    return { restored: false, reason: String(fehler?.message || fehler) };
  }
});

ipcMain.handle("data:confirm-reset", async () => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["Abbrechen", "Zurücksetzen"],
    defaultId: 0,
    cancelId: 0,
    message: "Provider und Settings zurücksetzen?"
  });
  if (result.response === 1) {
    providers = providerModel.defaultProviders();
    favorites = [];
    settings = defaultSettings();
    saveProviders();
    saveFavorites();
    saveSettings();
      return { providers, favorites, settings: publicSettings(settings) };
  }
  return null;
});

async function navigateProvider(provider, url) {
  if (pendingAutostart && pendingAutostart.providerId !== provider.id) {
    finishAutostart("anbieterwechsel");
  }
  setOverlayOpen("shell", false);
  const previousView = activeView;
  const previousProviderId = activeProviderId;
  if (previousView && previousProviderId !== provider.id && settings.playback.pauseOnProviderSwitch) {
    await pauseProviderForSwitch(previousProviderId, previousView, true);
  }

  activeProviderId = provider.id;
  const view = getProviderView(provider);
  activeView = view;
  view.webContents.setAudioMuted(false);

  // Bei offenem Overlay (Einstellungen, Oberflaeche) bleibt die View abgehaengt.
  if (!attachedProviderViews.has(provider.id) && overlayReasons.size === 0) {
    mainWindow.contentView.addChildView(view);
    attachedProviderViews.add(provider.id);
  }

  for (const [providerId, otherView] of providerViews.entries()) {
    if (providerId !== provider.id && attachedProviderViews.has(providerId)) {
      mainWindow.contentView.removeChildView(otherView);
      attachedProviderViews.delete(providerId);
    }
  }

  applyBrowserBounds();
  if (pendingAutostart) raiseAutostartCurtain();
  let target = providerModel.normalizeUrl(url || provider.startUrl);
  if (shouldBlockProviderNavigation(target, provider)) {
    logBlockedUrl(target, provider, "site-lock:programmatic", "navigation");
    target = provider.startUrl;
  }
  if (target && view.webContents.getURL() !== target) {
    view.webContents.loadURL(target);
  } else {
    resumeProviderAfterSwitch(provider.id, view);
  }
}

async function enterHomeMode() {
  if (mainWindow) {
    for (const [providerId, view] of providerViews.entries()) {
      const provider = providers.find((item) => item.id === providerId);
      if (provider && isLiveView(view)) {
        await syncViewMediaProgress(provider, view, "close").catch(() => {});
        await pauseProviderForSwitch(providerId, view, true).catch(() => {});
      }
      stopMediaProgressPolling(providerId);
      if (attachedProviderViews.has(providerId)) {
        mainWindow.contentView.removeChildView(view);
        attachedProviderViews.delete(providerId);
      }
      if (isLiveView(view)) {
        view.webContents.close();
      }
    }
  }
  providerViews.clear();
  webContentsProvider.clear();
  attachedProviderViews.clear();
  providerResumeState.clear();
  activeProviderId = null;
  activeFavoriteId = null;
  activeView = null;
  overlayReasons.add("shell");
  sendActiveState();
  // Sind die Anbieterseiten zu, bleibt sonst alles liegen, was sie angelegt
  // haben - Cache, Service Worker, lokale Ablagen der Werbenetze. Beim
  // naechsten Oeffnen faengt der Browser jetzt sauber an. Anmeldungen und
  // Player-Einstellungen bleiben: Cookies und localStorage fasst diese
  // Reinigung nicht an.
  clearBrowserDataPreservingLogin().catch(() => {});
}

function getProviderView(provider) {
  if (providerViews.has(provider.id)) {
    return providerViews.get(provider.id);
  }

  const view = new WebContentsView({
    webPreferences: {
      session: browserSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: "no-user-gesture-required",
      backgroundThrottling: false
    }
  });
  // Sonst blitzt beim Seitenwechsel das weisse Standard-Backing durch.
  view.setBackgroundColor(VIEW_BACKGROUND_COLOR);

  webContentsProvider.set(view.webContents.id, provider.id);
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (!providerModel.isHttpUrl(url)) {
      logBlockedUrl(url, provider, "popup:invalid-url", "popup");
      return { action: "deny" };
    }

    if (isAllowedNewWindowTarget(url, provider)) {
      view.webContents.loadURL(url);
    } else {
      logBlockedUrl(url, provider, "popup:block", "popup");
    }
    return { action: "deny" };
  });

  // Aus der Seite heraus: streng pruefen, hier kommen die Werbe-Umleitungen.
  view.webContents.on("will-navigate", (event, url) => {
    syncViewMediaProgress(provider, view, "leave");
    if (shouldCancelNavigation(url, provider, true)) {
      event.preventDefault();
    }
  });
  view.webContents.on("will-redirect", (event, url) => {
    syncViewMediaProgress(provider, view, "leave");
    if (shouldCancelNavigation(url, provider, false)) {
      event.preventDefault();
    }
  });
  // Navigationen innerhalb eingebetteter Rahmen. Gibt es seit Electron 27;
  // faellt die Ereignisart einmal weg, laeuft ELFIX ohne diesen Schutz weiter,
  // statt beim Anlegen der Ansicht auszusteigen.
  try {
    view.webContents.on("will-frame-navigate", (ereignis) => {
      if (ereignis.isMainFrame) return;
      let quelle = "";
      try {
        quelle = ereignis.frame?.url || "";
      } catch {
        quelle = "";
      }
      if (shouldCancelFrameNavigation(ereignis.url, provider, quelle)) {
        ereignis.preventDefault();
      }
    });
  } catch {
    console.log("[ELFIX ADBLOCK] will-frame-navigate steht nicht zur Verfuegung");
  }
  // Kosmetik: nach jeder Navigation in jedem Rahmen neu einspielen. Ein Rahmen,
  // der neu laedt, hat weder Stil noch Beobachter - und genau nach dem Wechsel
  // auf die Hosterseite kommen die Overlays.
  view.webContents.on("did-frame-navigate", (_ereignis, url, _code, _text, istHauptrahmen, prozessId, rahmenId) => {
    kosmetikEinspielen(provider, view, url, istHauptrahmen, prozessId, rahmenId);
  });
  view.webContents.on("dom-ready", () => {
    kosmetikEinspielen(provider, view, view.webContents.getURL(), true);
    // Den Beobachter fuer das Vorbereitungsfenster gleich mit einhaengen, nicht
    // erst wenn ein Autostart laeuft. Er soll schon dastehen, bevor das Fenster
    // aufgeht - sonst waere "sofort" nur das naechste Abfragen.
    torBeobachterEinhaengen(provider, view);
  });
  view.webContents.on("enter-html-full-screen", () => markContentFullscreen(true));
  view.webContents.on("leave-html-full-screen", () => markContentFullscreen(false));
  // Dieselben Kuerzel wie im Fenster. Sie muessen hier noch einmal haengen:
  // liegt die Anbieterseite vorn, bekommt das Fenster den Tastendruck nie zu
  // sehen.
  view.webContents.on("before-input-event", (event, input) => {
    if (tastenkuerzel(input)) event.preventDefault();
  });
  // Rueckkanal des "Naechste Folge"-Knopfes aus der Anbieterseite.
  view.webContents.on("console-message", (...args) => {
    const nachricht = typeof args[0] === "object" && args[0] !== null && "message" in args[0]
      ? args[0].message
      : args[1];
    // Rueckkanal des kosmetischen Filters. Steht vor allem anderen, weil hier
    // die meisten Meldungen ankommen - und weil sie ihren eigenen Rahmen
    // mitbringen muessen: eine Antwort ins Hauptdokument nuetzt einem Overlay
    // im Hosterrahmen nichts.
    if (String(nachricht || "").startsWith(kosmetik.MELDE_PRAEFIX)) {
      let rahmen = null;
      try {
        rahmen = typeof args[0] === "object" && args[0] !== null ? args[0].frame || null : null;
      } catch {
        rahmen = null;
      }
      kosmetikMeldung(provider, view, rahmen, nachricht);
      return;
    }
    // Das Vorbereitungsfenster meldet sich von selbst, sobald es aufgeht - der
    // Beobachter in der Seite wartet nicht auf die naechste Autoplay-Runde.
    if (String(nachricht || "").startsWith(verifizierungstor.TOR_MELDUNG)) {
      torMeldungVerarbeiten(provider, String(nachricht).slice(verifizierungstor.TOR_MELDUNG.length));
      return;
    }
    // Wo dieses Geraet steht. Kommt aus der Seite, sobald sich etwas aendert -
    // deshalb sehen die anderen eine Pause ohne Umweg ueber einen Zeitgeber.
    // Der Bericht der sanften Regelung aus dem Player.
    if (String(nachricht || "").startsWith("__elfix:wp:sync:")) {
      console.log(`[watchparty-sync] ${String(nachricht).slice(16)}`);
      return;
    }
    // Eine Chatzeile aus der Seite. Sie geht an den Raum, in dem gerade
    // geschaut wird - und nur dann, wenn es einen gibt.
    const chat = String(nachricht || "").match(/^__elfix:chat:([\s\S]+)$/);
    if (chat) {
      const key = watchpartyLiveKeyForUrl(view.webContents.getURL());
      if (key) watchparty.chatSenden(key, chat[1]);
      return;
    }
    // Der Rueckkanal der YouTube-Watchparty. Eigenes Praefix, eigener Weg -
    // damit kann keine Meldung des einen Modus im anderen landen.
    if (String(nachricht || "").startsWith("__elfix:yt:sync:")) {
      console.log(`[youtube-party] ${String(nachricht).slice(16)}`);
      return;
    }
    const ytTat = String(nachricht || "").match(/^__elfix:yt:(play|pause|seek):(\d+(?:\.\d+)?):([01])$/);
    if (ytTat) {
      meldeYoutubeAktion(view, ytTat[1], Number(ytTat[2]), ytTat[3] === "1");
      return;
    }
    const stand = String(nachricht || "").match(/^__elfix:wp:stand:(\d+(?:\.\d+)?):([01])$/);
    if (stand) {
      meldeWatchpartyStandAusSeite(view, Number(stand[1]), stand[2] === "1");
      return;
    }
    // Live zuschauen: Pause, Weiter und Springen sofort an die anderen melden.
    const live = String(nachricht || "").match(/^__elfix:wp:(play|pause|seek):(\d+(?:\.\d+)?)$/);
    if (live) {
      const adresse = view.webContents.getURL();
      const key = watchpartyLiveKeyForUrl(adresse);
      // Nur an die Runde, in der gerade geschaut wird - und immer mit der
      // eigenen Adresse. Der Empfaenger prueft damit, ob es dieselbe Folge
      // ist. Frueher ging der Befehl ohne Adresse hinaus und der Empfaenger
      // musste den Raumzustand befragen; hinkte der einer Folge hinterher,
      // verwarf er jede Pause als "andere Folge".
      if (key) watchparty.steuernMitAdresse(key, live[1], Number(live[2]), adresse, watchpartyRaumForUrl(adresse));
      return;
    }
    // "Danach aufhoeren" an- und abgeschaltet. Gemerkt wird die Adresse der
    // laufenden Folge, nicht bloss ein Ja: sonst gaelte die Ansage auch fuer
    // eine ganz andere Folge, die derselbe Anbieter spaeter zeigt.
    // Der Autoplay-Schalter aus der Seite. Er stellt dieselbe Einstellung wie
    // die Seitenleiste - deshalb wird sie hier wirklich geschrieben und nicht
    // bloss gemerkt. Sonst haette der Schalter die Folge ueberdauert, die
    // Einstellung aber nicht.
    const autoplay = String(nachricht || "").match(/^__elfix:autoplay:([01])$/);
    if (autoplay) {
      const an = autoplay[1] === "1";
      settings.playback = { ...(settings.playback || {}), autoplayNextEpisode: an };
      saveSettings();
      // Ein Zaehler, der gerade laeuft, muss die Ansage sofort spueren. Beide
      // Merker zuruecksetzen heisst: der naechste Takt spielt die Einblendung
      // neu ein, und autoplayZaehler() entscheidet dann mit dem neuen Stand.
      nextEpisodePromptState.delete(provider.id);
      nextEpisodeAutostartState.delete(provider.id);
      meldeEinstellungen();
      logNextEpisode(provider, an ? "Autoplay: an" : "Autoplay: aus");
      sendToast(an
        ? "Nächste Folge startet von selbst"
        : "Nächste Folge startet nicht mehr von selbst");
      return;
    }
    const schluss = String(nachricht || "").match(/^__elfix:stop-after-episode:([01])$/);
    if (schluss) {
      const adresse = view.webContents.getURL();
      if (schluss[1] === "1") stopNachFolge.set(provider.id, adresse);
      else stopNachFolge.delete(provider.id);
      logNextEpisode(provider, schluss[1] === "1" ? "Danach aufhoeren: an" : "Danach aufhoeren: aus");
      sendToast(schluss[1] === "1"
        ? "Nach dieser Folge ist Schluss"
        : "Es geht wieder von selbst weiter");
      return;
    }
    // Ein Sprung im Player. Er ist der einzige Weg, auf dem ELFIX je von einem
    // Intro erfaehrt.
    const gesprungen = String(nachricht || "").match(/^__elfix:sprung:(\d+):(\d+)$/);
    if (gesprungen) {
      markeLernen(provider, view.webContents.getURL(), Number(gesprungen[1]), Number(gesprungen[2]));
      return;
    }
    // Welche Fassung dasteht - und welche jemand angeklickt hat.
    const fassungMeldung = fassung.meldung(nachricht);
    if (fassungMeldung) {
      fassungMelden(provider, view.webContents.getURL(), fassungMeldung.art, fassungMeldung.fassung);
      return;
    }
    if (String(nachricht || "") === marken.MELDE_GENUTZT) {
      logMediaDiagnostic(provider, view.webContents.getURL(), "marke", "Intro uebersprungen", {});
      return;
    }
    const treffer = String(nachricht || "").match(/^__elfix:next-episode:(\S+)$/);
    if (!treffer) return;
    logNextEpisode(provider, "Knopf/Countdown ausgeloest");
    playNextEpisode(provider, view, treffer[1]).catch((fehler) => {
      logNextEpisode(provider, "FEHLER beim Wechsel: " + (fehler?.message || fehler));
    });
  });
  view.webContents.on("did-start-loading", () => sendActiveState());
  view.webContents.on("did-stop-loading", () => sendActiveState());
  view.webContents.on("did-navigate", (_event, url) => {
    rememberProviderUrl(provider.id, url);
    // Wer einen Titel wirklich oeffnet, hat ihn nicht ignoriert - die
    // Muedigkeitszaehlung dieses Werks faengt von vorn an.
    vergissEmpfehlungsMuedigkeit(url, cleanBaseMediaTitle("", url), "");
    // Neue Seite: der Merker fuers Anhaengen gilt nicht mehr - wer die Folge
    // erneut betritt, gleicht wieder mit dem Host ab.
    watchpartyAngeklinkt.clear();
    // Neue Seite, neuer Player, neue Sitzung.
    watchpartySitzung.set(provider.id, crypto.randomUUID());
    executeJavaScriptInMediaFrames(view, watchpartySyncZuruecksetzenScript()).catch(() => []);
    meldeWatchpartyFolgenwechsel(url);
    // Ein anderes YouTube-Video ist kein Ende der Runde, sondern ihr
    // haeufigster Vorgang - die anderen ziehen mit.
    meldeYoutubeVideowechsel(view, url).catch(() => {});
    pushWatchpartyLiveState(url);
    nextEpisodePromptState.delete(provider.id);
    // Neue Folge, neue Ansage: die Vorwahl darf hier wieder einmal etwas sagen.
    fassungGemeldet.delete(provider.id);
    // Merker loeschen, sonst wechselt eine erneut angesehene Folge nicht mehr.
    nextEpisodeAutostartState.delete(provider.id);
    // Das macht "Danach aufhoeren" einmalig: die Ansage galt der Folge, die
    // gerade verlassen wurde.
    stopNachFolge.delete(provider.id);
    resumePendingProviderAutoplay(provider, view);
  });
  view.webContents.on("did-navigate-in-page", (_event, url) => {
    rememberProviderUrl(provider.id, url);
    // YouTube wechselt das Video, ohne die Seite neu zu laden: ein Klick auf
    // eine Empfehlung, ein Treffer aus der Suche, das naechste Video. Fuer die
    // Runde ist genau das ein Videowechsel.
    meldeYoutubeVideowechsel(view, url).catch(() => {});
    installYoutubeWiedergabe(view, url).catch(() => {});
    pushWatchpartyLiveState(url);
    resumePendingProviderAutoplay(provider, view);
  });
  view.webContents.on("page-title-updated", () => {
    updateActiveFavoriteTitle(provider.id, view);
    sendActiveState();
  });
  view.webContents.on("did-finish-load", () => {
    installStoPlayerFix(provider, view);
    installAniWorldImageFix(provider, view);
    // Zweiter Lauf: beim dom-ready haengen die eigenen Klickhorcher des
    // Anbieters manchmal noch nicht, und ein Klick ins Leere waehlt nichts aus.
    installFassung(provider, view, view.webContents.getURL(), { nachlauf: true }).catch(() => {});
    syncViewMediaProgress(provider, view, "load");
    updateActiveFavoriteTitle(provider.id, view);
    scheduleFavoriteMetadataRefresh(provider.id, view);
    resumePendingProviderAutoplay(provider, view);
    sendActiveState();
  });
  view.webContents.on("dom-ready", () => {
    installStoPlayerFix(provider, view);
    installAniWorldImageFix(provider, view);
    // Die Horcher fuer Pause und Weiter gehoeren hierhin, nicht erst in den
    // Fortschritts-Takt: sonst blieb das erste Play einer frisch geladenen
    // Folge unbemerkt, weil bis zum ersten Takt noch Sekunden vergehen.
    installWatchpartyControls(provider, view, view.webContents.getURL()).catch(() => {});
    installYoutubePartyControls(provider, view, view.webContents.getURL()).catch(() => {});
    installYoutubeWiedergabe(view, view.webContents.getURL()).catch(() => {});
    installWatchpartyChat(provider, view, view.webContents.getURL()).catch(() => {});
    installHosterQualitaet(view).catch(() => {});
    installAutoplaySchalter(view).catch(() => {});
    installMarke(provider, view, view.webContents.getURL()).catch(() => {});
    // Vor dem Autostart, nicht danach: der Aufruf setzt die Sperre, auf die
    // resumePendingProviderAutoplay() wartet, noch bevor er selbst etwas tut.
    installFassung(provider, view, view.webContents.getURL()).catch(() => {});
    resumePendingProviderAutoplay(provider, view);
  });

  providerViews.set(provider.id, view);
  startMediaProgressPolling(provider, view);
  return view;
}

function startMediaProgressPolling(provider, view) {
  stopMediaProgressPolling(provider.id);
  const timer = setInterval(() => {
    syncViewMediaProgress(provider, view, "poll");
  }, 5000);
  if (typeof timer.unref === "function") timer.unref();
  mediaProgressTimers.set(provider.id, timer);
}

function stopMediaProgressPolling(providerId) {
  const timer = mediaProgressTimers.get(providerId);
  if (timer) clearInterval(timer);
  mediaProgressTimers.delete(providerId);
}

async function syncViewMediaProgress(provider, view, reason = "poll") {
  if (!provider || !isLiveView(view)) return;
  const url = view.webContents.getURL();
  if (!providerModel.isHttpUrl(url) || !isTrackableMediaUrl(url, provider)) return;

  const progressScript = messung.messSkript();
  const progress = await readBestMediaProgress(view, progressScript);

  if (!progress || !isValidMediaProgress(progress)) return;
  // Steht ein Sprung aus der Watchparty an, wird er eingeloest, sobald das
  // Video wirklich laeuft.
  await applyWatchpartySeek(provider, view, progress).catch(() => {});
  await installWatchpartyControls(provider, view, url).catch(() => {});
  // Der Chat gehoert an dieselbe Stelle wie die Steuerung, und aus demselben
  // Grund: beim Laden der Seite steht noch nicht fest, ob hier eine Runde
  // laeuft. Wer erst danach beitritt oder live schaltet, bekaeme sonst nie
  // einen Chat - das Einspielen beim dom-ready allein greift zu frueh.
  await installWatchpartyChat(provider, view, url).catch(() => {});
  // Und die beste Bildstufe. Aus demselben Grund wie oben: beim Laden der
  // Seite steht der Rahmen des Hosters noch nicht, und ohne Manifest kennt
  // sein Player noch keine Stufen.
  await installHosterQualitaet(view).catch(() => {});
  await installAutoplaySchalter(view).catch(() => {});
  // Der Knopf haengt am selben Takt wie die Steuerung der Watchparty: beim
  // Laden steht der Rahmen des Hosters oft noch nicht, und ohne Video gibt es
  // nichts, woran ein Sprung zu merken waere.
  await installMarke(provider, view, url).catch(() => {});
  // Und dem Handy sagen, was hier gerade laeuft. Die Zeile geht nur hinaus,
  // wenn sie sich geaendert hat.
  fernStandMelden().catch(() => {});
  const pageMeta = await readPageMetadata(view).catch(() => ({}));
  applySeasonPlaybackInfo(pageMeta, url);
  const entry = recordMediaActivity(provider, url, {
    currentTime: progress.currentTime,
    position: progress.currentTime,
    duration: progress.duration,
    watchedSeconds: progress.playedSeconds,
    progress: mediaProgressPercent(progress.currentTime, progress.duration),
    completed: Boolean(progress.ended) || mediaProgressPercent(progress.currentTime, progress.duration) >= COMPLETED_PROGRESS_PERCENT,
    title: pageMeta.title,
    type: pageMeta.type,
    thumbnail: pageMeta.thumbnail,
    favicon: pageMeta.favicon,
    nextUrl: progress.nextUrl || "",
    finalSeason: pageMeta.finalSeason,
    finalEpisode: pageMeta.finalEpisode,
    finalEpisodeTrimmed: pageMeta.finalEpisodeTrimmed,
    unplayableSeason: pageMeta.unplayableSeason,
    unplayableEpisodes: pageMeta.unplayableEpisodes
  }, {
    label: progress.ended ? "Abgeschlossen" : undefined,
    updateFavoriteUrl: false
  });
  if (!entry) return;

  // Die gemessene Wiedergabezeit festhalten. Sie entsteht ohnehin schon - der
  // Takt in der Seite rechnet sie aus, damit die 2:30-Schwelle greifen kann -,
  // wurde bisher aber nur geprueft und dann weggeworfen. Ohne sie kann ein
  // Rueckblick nie sagen, wie lange wirklich geschaut wurde.
  sitzungMelden(provider, url, entry, progress);

  const prozent = mediaProgressPercent(progress.currentTime, progress.duration);
  // Bewusst nicht ueber entry.completed: das gilt schon ab 90 Prozent. Hier
  // zaehlt nur das tatsaechliche Ende der Folge.
  const amEnde = Boolean(progress.ended)
    || (progress.duration > 0 && progress.currentTime >= progress.duration - 1.5);
  // Ohne obere Grenze: sonst verschwindet der Knopf in den letzten Sekunden
  // wieder, bevor der automatische Wechsel greift.
  const fastFertig = !amEnde && prozent >= NEXT_EPISODE_PROMPT_PERCENT;

  let naechste = "";
  if (fastFertig || amEnde) {
    const ausDerSeite = progress.nextUrl ? "" : await readNextEpisodeLink(view);
    naechste = nextEpisodeContinueUrl(url, progress.nextUrl || ausDerSeite, entry, pageMeta);
  }

  // Folge durchgelaufen: Countdown einblenden, der von selbst weiterschaltet.
  // Der Merker verhindert, dass der 5-Sekunden-Takt ihn neu startet.
  //
  // Ist der automatische Wechsel abgeschaltet, bleibt der Knopf trotzdem
  // stehen - nur eben ohne Zaehler. Abgeschaltet ist der Automatismus, nicht
  // der Weg zur naechsten Folge: wer selbst entscheiden will, wann es
  // weitergeht, will darum nicht muehsam suchen muessen, wo es weitergeht.
  if (amEnde && naechste) {
    if (nextEpisodeAutostartState.get(provider.id) !== url) {
      nextEpisodeAutostartState.set(provider.id, url);
      nextEpisodePromptState.set(provider.id, "countdown");
      installNextEpisodePrompt(view, naechste, {
        countdown: autoplayZaehler(provider, url),
        schluss: settings.playback?.autoplayNextEpisode !== false,
        schlussScharf: stopNachFolge.get(provider.id) === url
      });
    }
    if (reason !== "poll" || entry.completed) sendActiveState();
    return;
  }

  // Davor nur der Knopf. Nur bei Aenderung einspielen, sonst liefe alle
  // 5 Sekunden ein Script durch saemtliche Frames der Seite.
  const gewuenscht = fastFertig && naechste ? naechste : "";
  if (nextEpisodePromptState.get(provider.id) !== gewuenscht) {
    nextEpisodePromptState.set(provider.id, gewuenscht);
    installNextEpisodePrompt(view, gewuenscht, {
      schluss: settings.playback?.autoplayNextEpisode !== false,
      schlussScharf: stopNachFolge.get(provider.id) === url
    });
  }

  if (reason !== "poll" || entry.completed) sendActiveState();
}

// Wie lange der Zaehler laeuft, bevor die naechste Folge von selbst startet.
//
// Null heisst: gar nicht - dann steht nur der Knopf da. Zwei Wege fuehren
// dorthin, und sie meinen Verschiedenes. Die Einstellung gilt dauerhaft und
// fuer alles; "Danach aufhoeren" gilt fuer diese eine Folge und ist danach
// wieder weg. Beide enden am selben Ergebnis, weil es nur eines gibt: der Weg
// zur naechsten Folge bleibt, allein das Von-selbst faellt aus.
function autoplayZaehler(provider, url) {
  if (settings.playback?.autoplayNextEpisode === false) return 0;
  if (stopNachFolge.get(provider.id) === url) return 0;
  return NEXT_EPISODE_COUNTDOWN_SECONDS;
}

// Der Knopf lebt in der Anbieterseite, weil deren View im Vollbild alles
// ueberdeckt. Er meldet den Klick ueber eine Konsolenzeile zurueck - ohne
// Preload gibt es in einer fremden Seite keinen anderen Kanal.
function installNextEpisodePrompt(view, url, options = {}) {
  if (!isLiveView(view)) return;
  const script = `(() => {
    const ziel = ${JSON.stringify(String(url || ""))};
    const countdown = ${Number(options.countdown) || 0};
    // Ob "Danach aufhoeren" ueberhaupt angeboten wird - ohne Zaehler gaebe es
    // nichts aufzuhalten - und ob es schon scharf ist. Der scharfe Zustand
    // kommt von aussen mit, damit ein erneutes Einspielen ihn nicht vergisst.
    const schlussMoeglich = ${options.schluss === false ? "false" : "true"};
    const schlussScharf = ${options.schlussScharf ? "true" : "false"};
    const id = "__elfixNextEpisode";
    let karte = document.getElementById(id);
    const obenDrauf = window.top === window.self;
    const sichtbaresVideo = Array.from(document.querySelectorAll("video")).some((video) => {
      const rect = video.getBoundingClientRect();
      return rect.width > 120 && rect.height > 80;
    });
    const rahmen = Array.from(document.querySelectorAll("iframe, embed")).some((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 200 && rect.height > 120;
    });

    // Die Karte gehoert in den Frame mit dem Video: im Vollbild ist das
    // Vollbild-Element oft das <iframe> selbst, und ein Kind davon wird nie
    // gezeichnet. Das Hauptdokument uebernimmt nur, wenn dort auch der Player
    // sitzt - sonst gaebe es die Karte doppelt.
    const zustaendig = sichtbaresVideo || (obenDrauf && !rahmen);
    const vollbild = document.fullscreenElement;
    const buehne = zustaendig
      ? (vollbild && vollbild.tagName !== "IFRAME" && vollbild.tagName !== "EMBED" ? vollbild : document.documentElement)
      : null;

    const beenden = () => {
      if (!karte) return;
      if (karte.__timer) clearInterval(karte.__timer);
      if (karte.__ruhe) clearTimeout(karte.__ruhe);
      if (karte.__wach) document.removeEventListener("mousemove", karte.__wach, true);
      karte.remove();
      karte = null;
    };

    if (!ziel || !buehne) {
      beenden();
      return "entfernt@" + location.hostname;
    }

    if (!karte) {
      karte = document.createElement("div");
      karte.id = id;
      Object.assign(karte.style, {
        position: "fixed",
        right: "34px",
        bottom: "86px",
        zIndex: "2147483647",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        opacity: "0",
        transform: "translateY(8px)",
        transition: "opacity 180ms ease, transform 180ms ease"
      });

      const haupt = document.createElement("button");
      haupt.type = "button";
      Object.assign(haupt.style, {
        minHeight: "46px",
        padding: "0 22px",
        border: "0",
        borderRadius: "10px",
        background: "rgba(255, 255, 255, 0.94)",
        color: "#0b0f16",
        font: "800 15px/1 system-ui, sans-serif",
        boxShadow: "0 12px 34px rgba(0, 0, 0, 0.45)",
        cursor: "pointer",
        transition: "background 140ms ease"
      });
      haupt.addEventListener("mouseenter", () => { haupt.style.background = "#ffffff"; });
      haupt.addEventListener("mouseleave", () => { haupt.style.background = "rgba(255, 255, 255, 0.94)"; });
      haupt.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (karte.__timer) clearInterval(karte.__timer);
        karte.__timer = 0;
        haupt.disabled = true;
        haupt.textContent = "Wird geladen …";
        abbrechen.style.display = "none";
        console.log("__elfix:next-episode:" + karte.dataset.url);
      }, true);

      const abbrechen = document.createElement("button");
      abbrechen.type = "button";
      abbrechen.textContent = "Abbrechen";
      Object.assign(abbrechen.style, {
        display: "none",
        minHeight: "46px",
        padding: "0 16px",
        border: "0",
        borderRadius: "10px",
        background: "rgba(12, 16, 24, 0.78)",
        color: "#fff",
        font: "750 14px/1 system-ui, sans-serif",
        boxShadow: "0 12px 34px rgba(0, 0, 0, 0.45)",
        cursor: "pointer"
      });
      // Abbrechen stoppt nur den Countdown - der Knopf bleibt, damit man
      // trotzdem von Hand weiterspringen kann.
      abbrechen.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (karte.__timer) clearInterval(karte.__timer);
        karte.__timer = 0;
        karte.dataset.abgebrochen = "ja";
        haupt.textContent = "Nächste Folge  ›";
        abbrechen.style.display = "none";
      }, true);

      // "Danach aufhoeren": haelt den Zaehler auf, bevor er ueberhaupt
      // anfaengt. Der Knopf daneben bleibt - wer es sich anders ueberlegt,
      // kommt weiter mit einem Klick zur naechsten Folge.
      const schluss = document.createElement("button");
      schluss.type = "button";
      Object.assign(schluss.style, {
        display: "none",
        minHeight: "46px",
        padding: "0 16px",
        border: "0",
        borderRadius: "10px",
        background: "rgba(12, 16, 24, 0.78)",
        color: "#fff",
        font: "750 14px/1 system-ui, sans-serif",
        boxShadow: "0 12px 34px rgba(0, 0, 0, 0.45)",
        cursor: "pointer"
      });
      schluss.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const an = karte.dataset.schluss !== "ja";
        karte.dataset.schluss = an ? "ja" : "";
        if (an) {
          // Laeuft der Zaehler schon, wird er hier angehalten - sonst waere
          // der Klick eine Ansage, die zu spaet kommt.
          if (karte.__timer) clearInterval(karte.__timer);
          karte.__timer = 0;
          karte.__abbrechen.style.display = "none";
          karte.__haupt.textContent = "Nächste Folge  ›";
        } else if (karte.__zaehlerStarten) {
          // Zurueckgenommen: lief die Folge schon aus, faengt der Zaehler
          // wieder an. Sonst passiert hier nichts sichtbares - das Ende kommt
          // ja erst noch, und dann zaehlt er von selbst.
          karte.__zaehlerStarten(Number(karte.dataset.zaehler) || 0);
        }
        karte.__schlussBeschriften();
        console.log("__elfix:stop-after-episode:" + (an ? "1" : "0"));
      }, true);

      karte.__haupt = haupt;
      karte.__abbrechen = abbrechen;
      karte.__schluss = schluss;
      karte.__schlussBeschriften = () => {
        schluss.textContent = karte.dataset.schluss === "ja"
          ? "Danach aufhören ✓"
          : "Danach aufhören";
        schluss.style.background = karte.dataset.schluss === "ja"
          ? "rgba(255, 255, 255, 0.22)"
          : "rgba(12, 16, 24, 0.78)";
      };
      karte.append(haupt, abbrechen, schluss);
      buehne.appendChild(karte);

      // Der Knopf liegt ueber dem Bild und soll beim Schauen nicht stoeren:
      // liegt die Maus fuenf Sekunden still, wird er fast durchsichtig. Jede
      // Bewegung holt ihn sofort zurueck. Steht der Zeiger auf dem Knopf,
      // bleibt er sichtbar - sonst verblasste er unter der eigenen Hand.
      karte.__wach = () => {
        if (!karte) return;
        karte.style.transition = "opacity 140ms ease, transform 180ms ease";
        karte.style.opacity = "1";
        if (karte.__ruhe) clearTimeout(karte.__ruhe);
        karte.__ruhe = setTimeout(() => {
          if (!karte || karte.__ueber) return;
          karte.style.transition = "opacity 600ms ease, transform 180ms ease";
          karte.style.opacity = "0.12";
        }, 5000);
      };
      karte.addEventListener("mouseenter", () => {
        if (!karte) return;
        karte.__ueber = true;
        karte.__wach();
      });
      karte.addEventListener("mouseleave", () => {
        if (!karte) return;
        karte.__ueber = false;
        karte.__wach();
      });
      document.addEventListener("mousemove", karte.__wach, true);

      requestAnimationFrame(() => {
        karte.style.opacity = "1";
        karte.style.transform = "translateY(0)";
        karte.__wach();
      });
    } else if (karte.parentElement !== buehne) {
      buehne.appendChild(karte);
    }

    karte.dataset.url = ziel;

    // Der scharfe Zustand kommt von aussen: ELFIX merkt ihn sich je Folge, und
    // ein erneutes Einspielen soll ihn nicht stillschweigend zuruecknehmen.
    if (schlussScharf) karte.dataset.schluss = "ja";
    karte.__schluss.style.display = schlussMoeglich ? "" : "none";
    karte.__schlussBeschriften();

    // Der Zaehler steht als eigene Funktion an der Karte, weil er von zwei
    // Seiten gebraucht wird: beim Einspielen am Ende der Folge und dann, wenn
    // jemand "Danach aufhoeren" wieder zuruecknimmt. Ohne das waere das
    // Zuruecknehmen eine Ansage ohne Folgen - der Zaehler bliebe stehen.
    karte.__zaehlerStarten = (sekunden) => {
      if (!karte || karte.__timer || !(sekunden > 0)) return false;
      if (karte.dataset.abgebrochen === "ja" || karte.dataset.schluss === "ja") return false;
      // Feste Zielzeit statt Zaehlschritte: ein Intervall driftet, und der
      // Wechsel kaeme sonst spuerbar spaeter als angekuendigt.
      const ende = Date.now() + sekunden * 1000;
      karte.__abbrechen.style.display = "";
      // Der Countdown ist eine Ansage - der Knopf gehoert dafuer sichtbar,
      // auch wenn er gerade verblasst war.
      if (karte.__wach) karte.__wach();
      const tick = () => {
        const rest = Math.ceil((ende - Date.now()) / 1000);
        if (rest > 0) {
          karte.__haupt.textContent = "Nächste Folge in " + rest + " …";
          return;
        }
        clearInterval(karte.__timer);
        karte.__timer = 0;
        karte.__haupt.textContent = "Wird geladen …";
        karte.__abbrechen.style.display = "none";
        console.log("__elfix:next-episode:" + karte.dataset.url);
      };
      tick();
      karte.__timer = setInterval(tick, 200);
      return true;
    };
    // Wie lange gezaehlt wuerde. Gemerkt, damit ein zurueckgenommenes
    // "Danach aufhoeren" denselben Zaehler wieder aufnehmen kann.
    if (countdown > 0) karte.dataset.zaehler = String(countdown);

    if (karte.__zaehlerStarten(countdown)) return "countdown@" + location.hostname;

    if (!countdown && !karte.__timer) {
      karte.__haupt.textContent = "Nächste Folge  ›";
      karte.__abbrechen.style.display = "none";
    }
    return "knopf@" + location.hostname;
  })()`;
  executeJavaScriptInMediaFrames(view, script)
    .then((ergebnisse) => {
      const zusammen = (ergebnisse || []).filter(Boolean).join(", ");
      if (!zusammen || zusammen === nextEpisodeLogState) return;
      nextEpisodeLogState = zusammen;
      console.log(`[ELFIX FOLGE] ${new Date().toLocaleTimeString("de-DE")} | Einblendung: ${zusammen}`);
    })
    .catch(() => {});
}

// Bei AniWorld und S.to laeuft das Video im Frame des Hosters - dort gibt es
// keine Folgenliste. Der Link zur naechsten Folge steht nur im Hauptdokument.
async function readNextEpisodeLink(view) {
  if (!isLiveView(view)) return "";
  const link = await view.webContents.executeJavaScript(`(() => {
    const abs = (value) => {
      try { return value ? new URL(value, location.href).href : ""; } catch (_) { return ""; }
    };
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const currentMatch = location.pathname.match(/\\/(?:episode|folge)-(\\d+)(?:\\/?|$)/i);
    const current = currentMatch ? Number(currentMatch[1]) : 0;
    if (!current) return "";
    // Welche Serie hier laeuft - dieselbe Markerliste wie episodeIdentity().
    // Ohne diese Frage zaehlt die blosse Folgennummer, und die steht auf einer
    // Anbieterseite in jedem Vorschlagsblock.
    const serienName = (pfad) => {
      const teile = String(pfad || "").split("/").filter(Boolean);
      const marken = ["stream", "serie", "film", "filme", "movie", "movies", "title"];
      for (let index = 0; index < teile.length - 1; index += 1) {
        if (marken.includes(teile[index].toLowerCase())) return teile[index + 1].toLowerCase();
      }
      return "";
    };
    const eigene = serienName(location.pathname);
    const gleicheSerie = (href) => {
      try {
        const url = new URL(href, location.href);
        const wirt = (name) => String(name || "").toLowerCase().replace(/^www\\./, "");
        if (wirt(url.hostname) !== wirt(location.hostname)) return false;
        return !eigene || serienName(url.pathname) === eigene;
      } catch (_) {
        return false;
      }
    };
    const muster = new RegExp("\\\\/(?:episode|folge)-" + (current + 1) + "(?:[/?#]|$)", "i");
    const treffer = anchors.find((anchor) => {
      const href = abs(anchor.getAttribute("href"));
      return href && muster.test(href) && gleicheSerie(href);
    });
    return treffer ? abs(treffer.getAttribute("href")) : "";
  })()`).catch(() => "");
  return typeof link === "string" ? link : "";
}

// Gilt fuer beide Wege gleich: Knopf gedrueckt oder Folge durchgelaufen. Die
// naechste Folge wird geladen, gestartet und ins Vollbild gebracht - derselbe
// Ablauf wie beim Start aus "Weiterschauen".
// --- Tastenkuerzel -----------------------------------------------------------
//
// Die Anbieterseite liegt als eigene View **ueber** der Oberflaeche. Ein
// Tastendruck dort geht an die fremde Seite und erreicht den Renderer nie -
// window.addEventListener("keydown") im Renderer taugt fuer diese Kuerzel also
// nicht, und globalShortcut waere das andere Extrem: das naehme die Taste auch
// jedem anderen Programm weg.
//
// Bleibt before-input-event: es sitzt zwischen Fenster und Seite, gilt fuer
// jede View und laesst durch, was hier niemand haben will. Genau das machte
// bisher schon das Escape aus dem Vollbild - an zwei Stellen, mit demselben
// Code. Jetzt gibt es dafuer eine.
//
// Drei Regeln, damit die Kuerzel niemandem im Weg stehen:
//
// Jedes traegt eine Zusatztaste oder ist eine Funktionstaste. Ein blosses "n"
// waere in jedem Suchfeld einer Anbieterseite ein Aerger.
//
// Was hier nicht behandelt wird, geht weiter an die Seite - abgefangen wird nur,
// was wirklich etwas tut. Deshalb gibt jeder Zweig zurueck, ob er zustaendig
// war, statt blind preventDefault zu rufen.
//
// Und was gerade nichts bedeutet, bedeutet nichts: "naechste Folge" greift nur,
// wo es eine naechste Folge gibt, "zurueck" nur, wo es ein Zurueck gibt. Sonst
// bekommt die Seite ihre Taste.
// Welche Tasten es sind, steht nicht hier als Tabelle, sondern nachlesbar in den
// Einstellungen unter *Wiedergabe*. Eine Liste im Hauptprozess, die niemand
// benutzt, waere eine zweite Wahrheit neben der, die man wirklich zu sehen
// bekommt - und die beiden liefen irgendwann auseinander.
function tastenkuerzel(input) {
  if (input?.type !== "keyDown") return false;
  const nurStrg = input.control && !input.alt && !input.shift && !input.meta;
  const nurAlt = input.alt && !input.control && !input.shift && !input.meta;
  const ohneAlles = !input.control && !input.alt && !input.shift && !input.meta;

  // Escape aus dem Vollbild. Steht zuerst, weil es die einzige Taste ohne
  // Zusatztaste ist - und die einzige, die auch dann greifen muss, wenn eine
  // Seite gerade alles ueberdeckt.
  if (input.key === "Escape" && ohneAlles && isContentFullscreen) {
    leaveContentFullscreen();
    return true;
  }

  // Vollbild. Ohne Anbieterseite bleibt es beim Fenster-Vollbild, das Electron
  // von Haus aus auf F11 legt - deshalb hier nichts tun und die Taste
  // durchlassen. Mit Anbieterseite dagegen muss es das Vollbild von ELFIX sein:
  // das bezieht Overlay und Bildflaeche mit ein, das andere nicht.
  if (input.key === "F11" && ohneAlles) {
    if (!isLiveView(activeView)) return false;
    // Derselbe Weg wie der Knopf auf der Fernbedienung: erst den Player, dann
    // das Fenster.
    vollbildUmschalten().catch(() => {});
    return true;
  }

  // Suche. Die Oberflaeche holt sie selbst nach vorn - sie weiss, was dabei zu
  // verbergen ist. Der Tastaturfokus muss aber von hier umgehaengt werden:
  // er liegt in der Anbieterseite, und ein Suchfeld ohne Fokus waere ein
  // Suchfeld, in das man erst klicken muss.
  if (nurStrg && input.key.toLowerCase() === "k") {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (isContentFullscreen) leaveContentFullscreen();
    mainWindow.webContents.send("tasten:befehl", "suche");
    mainWindow.webContents.focus();
    return true;
  }

  // Zurueck. Dieselbe Taste, die jeder Browser dafuer hat.
  if (nurAlt && input.key === "ArrowLeft") {
    if (!isLiveView(activeView) || !activeView.webContents.canGoBack()) return false;
    activeView.webContents.goBack();
    return true;
  }

  // Naechste Folge. Sie tut, was der Knopf im Bild tut - und rechnet dafuer
  // dieselbe Adresse aus, statt eine eigene Vorstellung davon zu haben, was als
  // Naechstes kommt.
  if (nurStrg && input.key === "ArrowRight") {
    if (input.isAutoRepeat) return true;
    const provider = activeProvider();
    if (!provider || !isLiveView(activeView)) return false;
    if (!episodeIdentity(activeView.webContents.getURL())) return false;
    naechsteFolgePerTaste(provider, activeView).catch(() => {});
    return true;
  }

  // Wofuer zaehlt das hier? Derselbe Wechsel wie ueber die Kopfzeile. Ohne
  // Mauszeiger gibt es keinen Punkt, an dem das Menue aufgehen koennte - dann
  // waehlt Electron selbst eine Stelle.
  if (input.control && input.shift && !input.alt && !input.meta
    && input.key.toLowerCase() === "w") {
    watchpartyKontextWechseln(null).catch(() => {});
    return true;
  }

  return false;
}

// Der Zweig fuer die Taste. Er darf nichts tun, wo es nichts zu tun gibt: eine
// Taste, die mitten in der Folge auf gut Glueck weiterschaltet, waere schlimmer
// als keine.
async function naechsteFolgePerTaste(provider, view) {
  const url = view.webContents.getURL();
  const identity = episodeIdentity(url);
  if (!identity) return;
  const eintrag = favorites.find((favorite) => favorite.providerId === provider.id
    && episodeIdentity(favorite.url)?.key === identity.key);
  // Erst die Seite fragen - sie kennt ihre eigenen Folgenlinks -, dann die
  // eigenen Regeln darueber, was ueberhaupt als naechste Folge gelten darf.
  const ausDerSeite = await readNextEpisodeLink(view).catch(() => "");
  const ziel = nextEpisodeContinueUrl(url, ausDerSeite, eintrag, null);
  if (!ziel) {
    sendToast("Hier gibt es keine nächste Folge");
    return;
  }
  logNextEpisode(provider, "Tastenkuerzel ausgeloest");
  await playNextEpisode(provider, view, ziel);
}

async function playNextEpisode(provider, view, url) {
  if (!provider || !isLiveView(view)) {
    logNextEpisode(provider, "abgebrochen - keine lebende Ansicht");
    return;
  }
  // Gemeldet war: bei Attack on Titan landete der Knopf immer bei derselben
  // fremden Serie. Kein Wunder - das Ziel kommt aus der Anbieterseite zurueck,
  // ueber eine Konsolenzeile, und die stand jedem Skript dort offen. Was
  // hereinkommt, wird deshalb geprueft: dieselbe Serie, weiter vorn als die
  // laufende Folge. Alles andere wird nicht gefahren, sondern gemeldet.
  const laufende = view.webContents.getURL();
  const eintrag = favorites.find((favorite) => favorite.id === activeFavoriteId) || null;
  if (!darfNaechsteFolgeSein(url, laufende, eintrag)) {
    logNextEpisode(provider, `abgelehnt - ${kurzeUrl(url)} ist keine naechste Folge von `
      + `${kurzeUrl(laufende || eintrag?.url || "")}`);
    sendToast("Das war nicht die nächste Folge");
    return;
  }
  logNextEpisode(provider, `Wechsel angefordert -> ${kurzeUrl(url)}`);
  nextEpisodePromptState.delete(provider.id);
  // Vorhang wie beim Weiterschauen, damit man das Laden der Folge nicht sieht.
  await beginAutostart(provider.id, naechsteFolgeLabel(provider, url), { snapshot: false });
  await navigateProvider(provider, url);
  logNextEpisode(provider, `Navigation angestossen, Seite zeigt gerade ${kurzeUrl(view.webContents.getURL())}`);
  scheduleProviderAutoplay(provider, activeView, {
    fullscreen: true,
    // Erst auf der Zielseite loslegen, und laenger dranbleiben: das Laden der
    // Folge frisst einen Teil des Zeitfensters.
    expectUrl: url,
    durationMs: 45000
  });
  logNextEpisode(provider, "Autoplay beauftragt (Vollbild an, 45s Fenster)");
}

function naechsteFolgeLabel(provider, url) {
  const identity = episodeIdentity(url);
  const eintrag = favorites.find((favorite) => (
    favorite.providerId === provider?.id && episodeIdentity(favorite.url)?.key === identity?.key
  ));
  const titel = cleanBaseMediaTitle(eintrag?.title || "", url);
  const folge = identity
    ? (identity.season > 0 ? `Staffel ${identity.season} Folge ${identity.episode}` : `Folge ${identity.episode}`)
    : "";
  return [titel, folge].filter(Boolean).join(" · ") || "Nächste Folge";
}

function kurzeUrl(url) {
  try {
    const ziel = new URL(String(url || ""));
    return ziel.host + ziel.pathname;
  } catch {
    return String(url || "(leer)");
  }
}

function logNextEpisode(provider, text) {
  const zeit = new Date().toLocaleTimeString("de-DE");
  console.log(`[ELFIX FOLGE] ${zeit} | ${provider?.name || "?"} | ${text}`);
}

async function readBestMediaProgress(view, script) {
  const samples = await executeJavaScriptInMediaFrames(view, script);
  const valid = samples
    .filter((item) => item && isValidMediaProgress(item))
    .sort((left, right) => {
      if (left.playedSeconds !== right.playedSeconds) return right.playedSeconds - left.playedSeconds;
      if (left.ended !== right.ended) return left.ended ? -1 : 1;
      if (left.paused !== right.paused) return left.paused ? 1 : -1;
      return right.area - left.area;
    });
  return valid[0] || null;
}

async function executeJavaScriptInMediaFrames(view, script) {
  if (!isLiveView(view)) return [];
  const frames = [];
  const collectFrames = (frame) => {
    if (!frame || frames.includes(frame)) return;
    frames.push(frame);
    for (const child of frame.frames || []) collectFrames(child);
  };
  collectFrames(view.webContents.mainFrame);

  // Ein Frame, der waehrend der Ausfuehrung neu geladen oder verworfen wird,
  // loest sein Versprechen nie ein. Ohne Zeitlimit haengt der ganze Durchlauf
  // und damit auch der Autoplay nach einem Folgenwechsel.
  const mitZeitlimit = (versprechen) => Promise.race([
    versprechen,
    new Promise((resolve) => { setTimeout(() => resolve(null), FRAME_SCRIPT_TIMEOUT_MS); })
  ]);

  if (!frames.length) {
    const sample = await mitZeitlimit(view.webContents.executeJavaScript(script, true).catch(() => null));
    return sample ? [sample] : [];
  }

  // userGesture muss mit: play() ohne Stummschaltung und requestFullscreen() verlangen
  // eine "transient user activation", die ein Script ohne dieses Flag nicht mitbringt.
  const samples = await Promise.all(frames.map((frame) => (
    typeof frame.executeJavaScript === "function"
      ? mitZeitlimit(frame.executeJavaScript(script, true).catch(() => null))
      : Promise.resolve(null)
  )));
  return samples.filter(Boolean);
}

function installAniWorldImageFix(provider, view) {
  if (!provider || !isLiveView(view) || !isAniWorldProvider(provider)) return;

  view.webContents.executeJavaScript(`(() => {
    if (window.__elflixAniWorldImageFixV1) return;
    window.__elflixAniWorldImageFixV1 = true;

    const abs = (value) => {
      try { return value ? new URL(value, location.href).href : ""; } catch (_) { return ""; }
    };
    const usefulImage = (value) => {
      const href = abs(value);
      return href && !/(?:logo|favicon|sprite|icon|avatar|flag|placeholder|blank|transparent|loading|spinner)/i.test(href);
    };
    const firstUrlFromSrcset = (value) => String(value || "")
      .split(",")
      .map((entry) => entry.trim().split(/\\s+/)[0])
      .find(Boolean) || "";
    const hydrateImage = (img) => {
      if (!img || img.dataset.elflixHydrated === "1") return;
      const lazySrcset = img.getAttribute("data-srcset") || img.getAttribute("data-lazy-srcset");
      const lazySrc = img.getAttribute("data-src")
        || img.getAttribute("data-lazy-src")
        || img.getAttribute("data-original")
        || img.getAttribute("data-url")
        || img.getAttribute("data-image")
        || firstUrlFromSrcset(lazySrcset);
      if (lazySrcset && !img.getAttribute("srcset")) img.setAttribute("srcset", lazySrcset);
      if (usefulImage(lazySrc) && (!usefulImage(img.getAttribute("src")) || img.complete === false)) {
        img.setAttribute("src", abs(lazySrc));
      }
      img.loading = "eager";
      img.decoding = "async";
      img.dataset.elflixHydrated = "1";
    };
    const hydrateBackground = (node) => {
      if (!node || node.dataset.elflixBgHydrated === "1") return;
      const raw = node.getAttribute("data-bg")
        || node.getAttribute("data-background")
        || node.getAttribute("data-image")
        || node.getAttribute("data-src");
      if (usefulImage(raw)) node.style.backgroundImage = 'url("' + abs(raw).replace(/"/g, "%22") + '")';
      node.dataset.elflixBgHydrated = "1";
    };
    const hideInfoToggles = () => {
      for (const node of Array.from(document.querySelectorAll("button, a, [role='button'], .btn, [class*='button'], [class*='toggle'], [class*='info']"))) {
        const text = String(node.innerText || node.textContent || "").replace(/\\s+/g, " ").trim();
        if (!/^infos?\\s+(?:verstecken|anzeigen)\\b/i.test(text) || text.length > 40) continue;
        node.style.setProperty("display", "none", "important");
        node.setAttribute("aria-hidden", "true");
        node.tabIndex = -1;
      }
    };
    const run = () => {
      document.querySelectorAll("img").forEach(hydrateImage);
      document.querySelectorAll("[data-bg], [data-background], [data-image], [data-src]").forEach(hydrateBackground);
      hideInfoToggles();
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("resize"));
    };
    run();
    const observer = new MutationObserver(run);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-src", "data-srcset", "data-lazy-src", "data-original", "src"] });
    for (const delay of [250, 900, 1800, 3600]) setTimeout(run, delay);
  })()`, true).catch(() => {});
}

function isLiveView(view) {
  return Boolean(view && view.webContents && !view.webContents.isDestroyed());
}

function scheduleFavoriteMetadataRefresh(providerId, view) {
  for (const delay of [900, 2200, 4200]) {
    setTimeout(() => {
      if (!isLiveView(view)) return;
      updateActiveFavoriteTitle(providerId, view);
    }, delay);
  }
}

function installStoPlayerFix(provider, view) {
  if (!provider || !isLiveView(view)) return;
  const name = String(provider.name || "").toLowerCase();
  const host = providerModel.hostFromUrl(provider.startUrl).toLowerCase();
  if (!(name.includes("s.to") || host === "s.to" || host.endsWith(".s.to") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host))) return;

  view.webContents.executeJavaScript(`(() => {
    if (window.__elflixStoPlayerFixV2) return;
    window.__elflixStoPlayerFixV2 = true;

    function textOf(node) {
      return String(node && (node.innerText || node.textContent) || "").replace(/\\s+/g, " ").trim();
    }
    function visible(node) {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 20 && rect.height > 20 && rect.bottom > 0 && rect.right > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    }
    function removeBrokenPrepareModal() {
      for (const node of Array.from(document.querySelectorAll("dialog,section,aside,div"))) {
        const text = textOf(node).toLowerCase();
        if (!text.includes("video wird vorbereitet") && !text.includes("das hat leider nicht geklappt")) continue;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        if (style.position === "fixed" || style.position === "absolute" || rect.width > 300) {
          node.remove();
        }
      }
    }
    function hasPlayerMedia(box) {
      return Boolean(box && Array.from(box.querySelectorAll("iframe,video")).some((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 120 && rect.height > 80;
      }));
    }
    function findPlayerBox() {
      const nodes = Array.from(document.querySelectorAll("main div,section,article,div"));
      let best = null;
      let bestScore = 0;
      for (const node of nodes) {
        if (!visible(node)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width < innerWidth * 0.42 || rect.height < 220) continue;
        if (rect.top < 70 || rect.top > innerHeight * 0.72) continue;
        const text = textOf(node).toLowerCase();
        if (/das schauen andere|kommentare|staffeln:|episoden:|registrieren|anmelden/.test(text)) continue;
        let score = rect.width * rect.height;
        if (/deutsch|voe|spielen|player|stream/.test(text)) score += 400000;
        if (rect.left > innerWidth * 0.72) score -= 900000;
        if (score > bestScore) {
          bestScore = score;
          best = node;
        }
      }
      return best;
    }
    function clickHoster() {
      const candidates = Array.from(document.querySelectorAll("a,button,li,div,span")).filter((node) => {
        if (!visible(node)) return false;
        const text = textOf(node).toLowerCase();
        const cls = String((node.className || "") + " " + (node.id || "")).toLowerCase();
        return /\\bvoe\\b|hoster|language|deutsch|episode/.test(text + " " + cls);
      });
      const target = candidates.find((node) => /\\bvoe\\b/i.test(textOf(node))) || candidates[0];
      if (target) {
        try { target.scrollIntoView({ block: "center", inline: "center" }); } catch (_) {}
        for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
          try { target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch (_) {}
        }
      }
    }
    function clickPlayer(box) {
      const media = box && box.querySelector("video");
      if (media) {
        try {
          const result = media.play();
          if (result && result.catch) result.catch(() => {});
          return;
        } catch (_) {}
      }
      const target = box && (box.querySelector("iframe") || box);
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
        try { target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y })); } catch (_) {}
      }
    }
    function keepStoPlayerClean() {
      const oldButton = document.querySelector(".__elflix-sto-play");
      if (oldButton) oldButton.remove();
    }
    keepStoPlayerClean();
    setInterval(keepStoPlayerClean, 900);
  })()`, true).catch(() => {});
}

function applyBrowserBounds() {
  if (!isLiveView(activeView) || !mainWindow) return;
  if (pendingAutostart) {
    // Waehrend des Autostarts laeuft die View ganz normal sichtbar - nur der
    // Vorhang liegt davor. Versteckt (abgehaengt oder komplett verdeckt) wuerde
    // Chromium sie drosseln und der Player kaeme nicht voran.
    const [width, height] = mainWindow.getContentSize();
    activeView.setBounds({ x: 0, y: 0, width, height });
    return;
  }
  if (isContentFullscreen) {
    const [width, height] = mainWindow.getContentSize();
    activeView.setBounds({ x: 0, y: 0, width, height });
    return;
  }

  const size = mainWindow.getContentSize();
  const bounds = {
    x: clamp(browserBounds.x, 0, size[0]),
    y: clamp(browserBounds.y, 0, size[1]),
    width: clamp(browserBounds.width, 1, size[0]),
    height: clamp(browserBounds.height, 1, size[1])
  };
  activeView.setBounds(bounds);
}

function hideActiveViewForOverlay() {
  if (!mainWindow || !activeView || !activeProviderId) return;
  if (attachedProviderViews.has(activeProviderId)) {
    mainWindow.contentView.removeChildView(activeView);
    attachedProviderViews.delete(activeProviderId);
  }
}

function restoreActiveViewAfterOverlay() {
  if (!mainWindow || !activeView || !activeProviderId) return;
  if (!attachedProviderViews.has(activeProviderId)) {
    mainWindow.contentView.addChildView(activeView);
    attachedProviderViews.add(activeProviderId);
  }
  applyBrowserBounds();
}

// Der Player laeuft waehrend des Autostarts ganz normal sichtbar weiter - davor
// liegt nur ein Vorhang mit einem Standbild der Oberflaeche. Alles andere
// (abhaengen, verschieben, komplett verdecken) macht die Seite fuer Chromium
// unsichtbar und drosselt sie auf ~1 Timer-Tick pro Sekunde ohne jedes Frame.
async function beginAutostart(providerId, title, options = {}) {
  // Bewusst ohne finishAutostart(): ein zweiter Klick waehrend des Startens soll
  // weder umschalten noch den Vorhang kurz aufziehen.
  if (pendingAutostart) clearTimeout(pendingAutostart.timer);
  pendingAutostart = {
    providerId,
    startedAt: Date.now(),
    timer: setTimeout(() => handleAutostartTimeout(providerId), AUTOSTART_REVEAL_TIMEOUT_MS)
  };
  await showAutostartCurtain(title, options).catch(() => {});
  applyBrowserBounds();
}

async function showAutostartCurtain(title, options = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  removeAutostartCurtain();

  let snapshot = "";
  // Beim Folgenwechsel kein Standbild: die Oberflaeche dahinter zeigt die
  // Startseite, waehrend man gerade im Player sitzt - das waere ein Bruch.
  if (options.snapshot !== false) {
    try {
      const image = await mainWindow.webContents.capturePage();
      if (!image.isEmpty()) {
        fs.mkdirSync(CURTAIN_DIR, { recursive: true });
        fs.writeFileSync(path.join(CURTAIN_DIR, "shell.png"), image.toPNG());
        snapshot = `<img src="shell.png" alt="">`;
      }
    } catch {
      // Ohne Standbild bleibt der Vorhang einfach dunkel.
    }
  }

  fs.mkdirSync(CURTAIN_DIR, { recursive: true });
  fs.writeFileSync(path.join(CURTAIN_DIR, "curtain.html"), `<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #070a10; }
  img { position: fixed; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .badge {
    position: fixed; left: 50%; bottom: 54px; transform: translateX(-50%);
    display: flex; align-items: center; gap: 12px; padding: 13px 22px; border-radius: 999px;
    background: rgba(8, 12, 20, 0.88); color: #fff; box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
    font: 800 15px/1 system-ui, sans-serif;
  }
  .dot {
    width: 15px; height: 15px; border-radius: 50%;
    border: 3px solid rgba(255, 255, 255, 0.25); border-top-color: #fff;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
${snapshot}
<div class="badge"><i class="dot"></i><span>${escapeHtmlText(title || "Wiedergabe")} wird gestartet …</span></div>`);

  const view = new WebContentsView({ webPreferences: { contextIsolation: true, sandbox: true } });
  // Ohne das ist eine frische View bis zum ersten Paint weiss - das war der
  // Blitzer beim Aufziehen des Vorhangs.
  view.setBackgroundColor(VIEW_BACKGROUND_COLOR);
  curtainView = view;
  try {
    view.webContents.on("input-event", (_event, input) => {
      if (input.type === "mouseDown" || (input.type === "keyDown" && input.key === "Escape")) {
        finishAutostart("abgebrochen");
      }
    });
  } catch {
    // Aelteres Electron ohne input-event: dann bleibt nur das Zeitlimit.
  }
  // Erst laden, dann einhaengen: so ist der Inhalt beim ersten Frame schon da.
  await view.webContents.loadFile(path.join(CURTAIN_DIR, "curtain.html")).catch(() => {});
  if (curtainView !== view) return;
  raiseAutostartCurtain();
}

// Der Vorhang muss nach der Provider-View eingehaengt werden, sonst liegt er
// darunter. Ein zweites addChildView schiebt ihn wieder nach oben.
function raiseAutostartCurtain() {
  if (!curtainView || !mainWindow || mainWindow.isDestroyed()) return;
  const [width, height] = mainWindow.getContentSize();
  mainWindow.contentView.addChildView(curtainView);
  // 1px oben frei lassen: bei vollstaendiger Ueberdeckung gilt die Player-View
  // als unsichtbar und wird gedrosselt (gemessen: 2 statt 20 Timer-Ticks, 0 Frames).
  curtainView.setBounds({ x: 0, y: 1, width, height: Math.max(1, height - 1) });
}

function escapeHtmlText(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function removeAutostartCurtain() {
  if (!curtainView) return;
  const view = curtainView;
  curtainView = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.contentView.removeChildView(view);
  }
  try {
    view.webContents.close();
  } catch {
    // Bereits geschlossen.
  }
}

function handleAutostartTimeout(providerId) {
  if (!pendingAutostart || pendingAutostart.providerId !== providerId) return;
  const request = providerAutoplayRequests.get(providerId);
  if (request?.sawPlayback && !pendingAutostart.extended) {
    // Der Player laeuft schon, nur das Vollbild fehlt noch: kurz nachfassen,
    // statt mitten im Start umzuschalten.
    pendingAutostart.extended = true;
    pendingAutostart.timer = setTimeout(() => finishAutostart("zeitlimit"), AUTOSTART_EXTRA_WAIT_MS);
    return;
  }
  finishAutostart("zeitlimit");
}

function finishAutostart(reason) {
  if (!pendingAutostart) return;
  clearTimeout(pendingAutostart.timer);
  const seconds = ((Date.now() - pendingAutostart.startedAt) / 1000).toFixed(1);
  console.log(`[ELFIX AUTOSTART] umgeschaltet nach ${seconds}s (${reason})`);
  pendingAutostart = null;
  removeAutostartCurtain();
  applyBrowserBounds();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:autostart-done", { reason });
  }
}

function setOverlayOpen(reason, isOpen) {
  if (isOpen) {
    overlayReasons.add(reason);
  } else {
    overlayReasons.delete(reason);
  }

  if (overlayReasons.size > 0) {
    hideActiveViewForOverlay();
  } else {
    restoreActiveViewAfterOverlay();
  }
}

function pauseActivePlayback(mute) {
  if (activeView) {
    pauseViewPlayback(activeView, mute);
  }
}

function pauseViewPlayback(view, mute) {
  if (!isLiveView(view)) return;
  view.webContents.executeJavaScript(
    "document.querySelectorAll('video, audio').forEach((media) => { try { media.pause(); } catch (_) {} });",
    true
  ).catch(() => {});
  view.webContents.setAudioMuted(Boolean(mute));
}

async function pauseProviderForSwitch(providerId, view, mute) {
  if (!providerId || !isLiveView(view)) return;
  const provider = providers.find((item) => item.id === providerId);
  if (provider) await syncViewMediaProgress(provider, view, "pause");
  // Erst melden, dann schliessen: der Takt oben traegt die letzten Sekunden
  // noch ein, bevor die Sitzung zugemacht wird.
  sitzungenSchliessen(providerId);
  const wasPlaying = await view.webContents.executeJavaScript(
    `(() => {
      let playing = false;
      for (const media of document.querySelectorAll("video, audio")) {
        try {
          if (!media.paused && !media.ended && media.readyState > 1) playing = true;
          media.pause();
        } catch (_) {}
      }
      return playing;
    })()`,
    true
  ).catch(() => false);
  providerResumeState.set(providerId, Boolean(wasPlaying));
  view.webContents.setAudioMuted(Boolean(mute));
}

function resumeProviderAfterSwitch(providerId, view) {
  if (!providerId || !isLiveView(view)) return;
  view.webContents.setAudioMuted(false);
  if (!providerResumeState.get(providerId)) return;
  providerResumeState.delete(providerId);
  view.webContents.executeJavaScript(
    `(() => {
      const media = Array.from(document.querySelectorAll("video, audio"))
        .find((item) => {
          try { return item.paused && !item.ended && item.readyState > 1; } catch (_) { return false; }
        });
      if (media) {
        try {
          media.muted = false;
          const result = media.play();
          if (result && typeof result.catch === "function") result.catch(() => {});
        } catch (_) {}
      }
    })()`,
    true
  ).catch(() => {});
}

async function reloadAllProviderViews() {
  const provider = activeProvider();
  const currentUrl = isLiveView(activeView) ? activeView.webContents.getURL() : "";
  const target = provider && !shouldBlockProviderNavigation(currentUrl, provider)
    ? currentUrl
    : provider?.lastUrl || provider?.startUrl || "";

  for (const [providerId, view] of providerViews.entries()) {
    stopMediaProgressPolling(providerId);
    if (mainWindow && attachedProviderViews.has(providerId)) {
      mainWindow.contentView.removeChildView(view);
    }
    if (isLiveView(view)) {
      view.webContents.close();
    }
  }
  providerViews.clear();
  webContentsProvider.clear();
  attachedProviderViews.clear();
  providerResumeState.clear();
  activeView = null;

  if (settings.browser?.cacheMode === "aggressive") {
    await clearBrowserDataPreservingLogin();
  }

  if (provider) {
    await navigateProvider(provider, target || provider.startUrl);
  } else {
    sendActiveState();
  }

  sendToast("Browserdaten gelöscht und alles neu geladen");
}

function enterContentFullscreen() {
  if (!mainWindow || !activeView) return;
  isContentFullscreen = true;
  installContentFullscreenExitOverlay(activeView);
  mainWindow.setFullScreen(true);
  sendFullscreenState();
  applyBrowserBounds();
}

function markContentFullscreen(enabled) {
  isContentFullscreen = Boolean(enabled);
  if (enabled && isLiveView(activeView)) installContentFullscreenExitOverlay(activeView);
  sendFullscreenState();
  applyBrowserBounds();
}

function installContentFullscreenExitOverlay(view) {
  if (!isLiveView(view)) return;
  view.webContents.executeJavaScript(`(() => {
    const existing = document.querySelector("#__elfixFullscreenExit");
    if (existing) return;
    const button = document.createElement("button");
    button.id = "__elfixFullscreenExit";
    button.type = "button";
    button.title = "Vollbild verlassen";
    button.setAttribute("aria-label", "Vollbild verlassen");
    button.textContent = "↙";
    Object.assign(button.style, {
      position: "fixed",
      top: "16px",
      right: "16px",
      zIndex: "2147483647",
      width: "46px",
      height: "46px",
      border: "0",
      borderRadius: "16px",
      background: "rgba(8, 12, 20, 0.82)",
      color: "#fff",
      fontSize: "22px",
      fontWeight: "900",
      boxShadow: "0 12px 38px rgba(0,0,0,.42)",
      cursor: "pointer",
      pointerEvents: "auto"
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }, true);
    document.documentElement.appendChild(button);
  })()`, true).catch(() => {});
}

function scheduleProviderAutoplay(provider, view, options = {}) {
  if (!provider || !isLiveView(view)) return;
  stopAutoplayRequest(provider.id);
  const request = {
    ...options,
    startedAt: Date.now(),
    until: Date.now() + sanitizePositiveNumber(options.durationMs || 26000)
  };
  providerAutoplayRequests.set(provider.id, request);
  autoplayConsoleLogState.delete(provider.id);
  // Gleichmaessig kurz statt wachsender Abstaende: mit dem alten Raster lagen am
  // Ende 5s zwischen zwei Pruefungen - so lange lief das Video schon, bevor der
  // Start erkannt wurde und das Vollbild ausgeloest hat.
  request.timer = setInterval(() => {
    // Ablauf zuerst pruefen: sonst laeuft der Timer weiter, wenn zwischendurch
    // ein anderer Anbieter aktiv wird und resume...() frueh aussteigt.
    const current = providerAutoplayRequests.get(provider.id);
    if (!current || Date.now() > current.until) {
      stopAutoplayRequest(provider.id);
      return;
    }
    if (!isLiveView(view) || activeView !== view) return;
    resumePendingProviderAutoplay(provider, view);
  }, AUTOPLAY_POLL_MS);
  setTimeout(() => {
    if (isLiveView(view) && activeView === view) resumePendingProviderAutoplay(provider, view);
  }, 250);
}

// Wann zuletzt ein Vorbereitungsfenster bestaetigt wurde. Der Zeitpunkt zaehlt
// gleich zweimal: er verlaengert das Autostart-Fenster und er entscheidet, ob
// ein gleich danach aufspringendes Fenster zur Wiedergabe gehoert.
const torKlickZeit = new Map();
const TOR_NACHLAUF_MS = 8000;

// Den Beobachter in das Hauptdokument des Anbieters einhaengen. Das Fenster
// gehoert der Anbieterseite, nicht dem Hoster-Rahmen.
//
// Der Aufruf ist absichtlich billig und wiederholbar: steht das Skript schon,
// prueft es nur nach; sonst haengt es sich ein. Deshalb darf es sowohl bei
// dom-ready als auch in jeder Autoplay-Runde kommen - ersetzt die Seite ihr
// documentElement, ist der Beobachter beim naechsten Mal wieder da.
function torBeobachterEinhaengen(provider, view) {
  if (!provider || !isLiveView(view)) return Promise.resolve("");
  return view.webContents.executeJavaScript(verifizierungstor.torScript(), true)
    .catch(() => "")
    .then((ergebnis) => {
      torMeldungVerarbeiten(provider, String(ergebnis || ""));
      return String(ergebnis || "");
    });
}

function pruefeVerifizierungsTor(provider, request, view) {
  if (!request || request.sawPlayback || request.torLaeuft) return;
  request.torLaeuft = true;
  torBeobachterEinhaengen(provider, view).then(() => {
    request.torLaeuft = false;
  });
}

// Eine Meldung des Beobachters - egal ob als Rueckgabe oder ueber die Konsole.
function torMeldungVerarbeiten(provider, meldung) {
  if (!provider || !meldung) return;

  if (meldung.startsWith("tor-gewartet:") || meldung.startsWith("tor-fehler:")) {
    logNextEpisode(provider, `Vorbereitungsfenster: ${meldung.slice(meldung.indexOf(":") + 1)}`);
    return;
  }
  if (!meldung.startsWith("tor-geklickt:")) return;

  torKlickZeit.set(provider.id, Date.now());
  logNextEpisode(provider, `Vorbereitungsfenster bestaetigt (${meldung.slice(13)})`);

  // Hinter dem Knopf faengt das Laden erst an. Laeuft gerade ein Autostart,
  // waere sein Zeitfenster sonst meist schon fast aufgebraucht und der Player
  // kaeme zu spaet.
  const request = providerAutoplayRequests.get(provider.id);
  if (request && !request.torVerlaengert) {
    request.torVerlaengert = true;
    request.until = Math.max(request.until, Date.now() + 25000);
    request.startedAt = Date.now();
  }
}

// Hat der Nutzer beziehungsweise der Autostart gerade das Vorbereitungsfenster
// bestaetigt? Dann ist ein Fenster, das sich unmittelbar danach oeffnet, der
// Stream und nicht die uebliche Werbung.
function istTorNachlauf(provider) {
  const zeit = torKlickZeit.get(provider?.id);
  return Boolean(zeit) && Date.now() - zeit < TOR_NACHLAUF_MS;
}

function stopAutoplayRequest(providerId) {
  const request = providerAutoplayRequests.get(providerId);
  if (request?.timer) clearInterval(request.timer);
  providerAutoplayRequests.delete(providerId);
}

function resumePendingProviderAutoplay(provider, view) {
  const request = providerAutoplayRequests.get(provider?.id);
  if (!request || !provider || !isLiveView(view) || activeView !== view) return;
  if (Date.now() > request.until) {
    stopAutoplayRequest(provider.id);
    finishAutostart("abgelaufen");
    return;
  }
  // Nach einem Folgenwechsel steht kurz noch die alte Seite. Ohne diese Sperre
  // startet der erste Versuch das gerade beendete Video neu, wertet das als
  // Erfolg und verbraucht den Auftrag, bevor die neue Folge geladen ist.
  if (request.expectUrl) {
    const aktuell = view.webContents.getURL();
    const angekommen = isExpectedEpisodePage(aktuell, request.expectUrl);
    if (!angekommen && Date.now() - request.startedAt < 12000) {
      // Eine Weiterleitung kann die Adresse veraendern - dann nach kurzer Zeit
      // trotzdem starten, statt gar nichts mehr zu tun.
      if (!request.warteGemeldet) {
        request.warteGemeldet = true;
        logNextEpisode(provider, `warte auf Zielseite ${kurzeUrl(request.expectUrl)} - offen ist noch ${kurzeUrl(aktuell)}`);
      }
      return;
    }
    logNextEpisode(provider, angekommen
      ? `Zielseite erreicht (${kurzeUrl(aktuell)}) - Autoplay startet`
      : `Zielseite nach 12s nicht erkannt (offen: ${kurzeUrl(aktuell)}) - Autoplay startet trotzdem`);
    request.expectUrl = "";
  }
  // Erst die Fassung, dann der Hoster. Die Anbieterseite zeigt nur die Hoster
  // der gewaehlten Fassung; ein Klick davor traefe die, die gerade noch
  // dasteht - und das ist beim Anbieter meistens Deutsch.
  const fassungBis = fassungWartet.get(provider.id) || 0;
  if (Date.now() < fassungBis) return;
  if (fassungBis) fassungWartet.delete(provider.id);

  // Steht das Vorbereitungsfenster im Weg? Dahinter entsteht das <video> erst -
  // ohne diesen Schritt sucht der Autostart die ganze Zeit einen Player, den es
  // noch gar nicht gibt, und laeuft in sein Zeitfenster.
  pruefeVerifizierungsTor(provider, request, view);

  // Zeitgebunden statt nur boolesch: bleibt ein Durchlauf haengen, war der
  // Autoplay danach dauerhaft blockiert.
  if (request.busy && Date.now() < (request.busyUntil || 0)) return;
  request.busy = true;
  request.busyUntil = Date.now() + FRAME_SCRIPT_TIMEOUT_MS + 3000;
  startPlaybackInView(view, { mode: "play" }).then((results) => {
    request.busy = false;
    const values = Array.isArray(results) ? results : [];
    logAutoplayAttempt(provider, request, values);
    const isPlaying = values.some((value) => /(?:video-counting|video-playing|video-started)/i.test(String(value || "")));
    if (!isPlaying) {
      const warming = values.some((value) => /video-warming/i.test(String(value || "")));
      const clickedOverlay = values.some((value) => /overlay-geklickt/i.test(String(value || "")));
      if (clickedOverlay) request.lastClickAt = Date.now();
      if (!warming && !clickedOverlay) clickPlayerCenterIfStalled(provider, request, view);
      return;
    }

    request.sawPlayback = true;
    if (request.fullscreen) {
      // Nur einmal pro Anfrage: sonst zieht ein spaeterer Retry den Nutzer
      // zurueck ins Vollbild, nachdem er es selbst verlassen hat.
      request.fullscreen = false;
      // Erst wenn Vollbild durch ist, wird zum Player umgeschaltet.
      enterPlayerFullscreen(provider, request, view)
        .catch(() => {})
        .then(() => finishAutostart("bereit"));
    } else {
      finishAutostart("laeuft");
    }
    if (values.some((value) => /video-counting/i.test(String(value || "")))) {
      stopAutoplayRequest(provider.id);
    }
  }).catch(() => {
    request.busy = false;
  });
}

// Bewusst ohne mainWindow.setFullScreen(): das Vollbild soll genau das sein, was
// der Vollbild-Knopf im Player macht. Die Fenster-/Bounds-Anpassung uebernimmt
// danach das "enter-html-full-screen"-Event ueber markContentFullscreen().
async function enterPlayerFullscreen(provider, request, view) {
  // YouTube geht einen eigenen Weg und faellt bewusst nicht in den allgemeinen
  // zurueck. Dessen Notfallpfad zieht das groesste iframe der Seite ins
  // Vollbild - bei YouTube ist das ein unsichtbarer Anmelde-Rahmen von
  // accounts.google.com, und dann war "alles" im Vollbild statt des Players.
  if (youtube.istYoutubeUrl(view.webContents.getURL())) {
    await enterYoutubeFullscreen(provider, request, view);
    return;
  }

  const buttonPass = await startPlaybackInView(view, { mode: "fullscreen" }).catch(() => []);
  const marks = Array.isArray(buttonPass) ? buttonPass : [];
  logAutoplayAttempt(provider, request, marks);
  // Nur warten, wenn ueberhaupt etwas ausgeloest wurde - hat der Player keinen
  // eigenen Knopf, waere die Wartezeit reine Verzoegerung.
  const triggered = marks.some((value) => /vollbild-knopf-geklickt|vollbild-schon-aktiv|player-fullscreen/i.test(String(value || "")));
  if (triggered && await waitForPageFullscreen(view, 900)) return;
  if (!triggered && await isPageFullscreen(view)) return;

  // Zweiter Weg: echter Doppelklick auf den Player - dieselbe Geste wie von Hand,
  // also auch derselbe Vollbild-Zustand samt bedienbaren Controls.
  const doubleClick = await doubleClickPlayerCenterInView(view).catch(() => "");
  if (doubleClick) logAutoplayAttempt(provider, request, [doubleClick]);
  const reachedFullscreen = await waitForPageFullscreen(view, 1200);
  if (doubleClick) {
    // Die zwei Einzelklicks darin koennen beim Player als Pause ankommen.
    const resume = await startPlaybackInView(view, { mode: "play" }).catch(() => []);
    logAutoplayAttempt(provider, request, Array.isArray(resume) ? resume : []);
  }
  if (reachedFullscreen) return;

  const forcePass = await startPlaybackInView(view, { mode: "fullscreen-force" }).catch(() => []);
  logAutoplayAttempt(provider, request, Array.isArray(forcePass) ? forcePass : []);
}

// Zwei Anlaeufe, beide nur am Player.
//
// Zuerst direkt: "#movie_player" ins Vollbild, ausgefuehrt mit echter
// Nutzergeste. Das ist der verlaessliche Weg - YouTube stellt seine Bedienung
// ueber "fullscreenchange" selbst um, es sieht also aus wie ein Knopfdruck.
//
// Klappt das nicht, wird YouTubes eigener Knopf gedrueckt. Klappt auch das
// nicht, bleibt es beim Fenster - lieber kein Vollbild als das falsche.
async function enterYoutubeFullscreen(provider, request, view) {
  const direkt = await view.webContents.executeJavaScript(youtube.vollbildScript(), true).catch(() => "");
  logAutoplayAttempt(provider, request, [String(direkt || "yt-vollbild-fehlgeschlagen")]);
  if (String(direkt) === "yt-vollbild-schon-aktiv") return;
  if (await waitForPageFullscreen(view, 1200)) return;

  const ueberKnopf = await view.webContents.executeJavaScript(youtube.vollbildScript(true), true).catch(() => "");
  logAutoplayAttempt(provider, request, [String(ueberKnopf || "yt-knopf-fehlgeschlagen")]);
  await waitForPageFullscreen(view, 1200);
}

async function waitForPageFullscreen(view, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (!isLiveView(view) || activeView !== view) return true;
    if (await isPageFullscreen(view)) return true;
  }
  return false;
}

function isPageFullscreen(view) {
  if (!isLiveView(view)) return Promise.resolve(false);
  return view.webContents
    .executeJavaScript("Boolean(document.fullscreenElement)", true)
    .catch(() => false);
}

// Synthetische Events auf ein <iframe> erreichen das eingebettete Dokument nie -
// bei einem Player in einem fremden Origin hilft nur ein echter Mausklick.
function clickPlayerCenterIfStalled(provider, request, view) {
  if (request.sawPlayback || (request.clicks || 0) >= 3) return;
  const now = Date.now();
  if (now - request.startedAt < 1500) return;
  if (now - (request.lastClickAt || 0) < 4000) return;
  request.lastClickAt = now;
  request.clicks = (request.clicks || 0) + 1;
  clickPlayerCenterInView(view).then((marker) => {
    if (marker) logAutoplayAttempt(provider, request, [marker]);
  }).catch(() => {});
}

async function clickPlayerCenterInView(view) {
  const spot = await playerCenterPoint(view);
  if (!spot) return "";
  sendMouseClick(view, spot, 1);
  return `echter-klick:${spot.tag}`;
}

async function doubleClickPlayerCenterInView(view) {
  const spot = await playerCenterPoint(view);
  if (!spot) return "";
  sendMouseClick(view, spot, 1);
  sendMouseClick(view, spot, 2);
  return `echter-doppelklick:${spot.tag}`;
}

function sendMouseClick(view, point, clickCount) {
  if (!isLiveView(view)) return;
  const base = { x: point.x, y: point.y, button: "left", clickCount };
  if (clickCount === 1) view.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
  view.webContents.sendInputEvent({ type: "mouseDown", ...base });
  view.webContents.sendInputEvent({ type: "mouseUp", ...base });
}

async function playerCenterPoint(view) {
  if (!isLiveView(view)) return null;
  const spot = await view.webContents.executeJavaScript(`(() => {
    const visible = (node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity || 1) > 0.05
        && rect.width >= 200
        && rect.height >= 120;
    };
    const pick = Array.from(document.querySelectorAll("video, iframe, embed"))
      .filter(visible)
      .sort((left, right) => {
        const l = left.getBoundingClientRect();
        const r = right.getBoundingClientRect();
        return (r.width * r.height) - (l.width * l.height);
      })[0];
    if (!pick) return null;
    pick.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const rect = pick.getBoundingClientRect();
    if (rect.width < 200 || rect.height < 120) return null;
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      tag: pick.tagName.toLowerCase()
    };
  })()`, true).catch(() => null);
  if (!spot || !Number.isFinite(spot.x) || !Number.isFinite(spot.y)) return null;
  return spot;
}

function isExpectedEpisodePage(aktuell, erwartet) {
  if (!aktuell || !erwartet) return false;
  if (normalizeFavoriteUrl(aktuell) === normalizeFavoriteUrl(erwartet)) return true;
  const a = episodeIdentity(aktuell);
  const b = episodeIdentity(erwartet);
  return Boolean(a && b && a.key === b.key && a.season === b.season && a.episode === b.episode);
}

function logAutoplayAttempt(provider, request, values) {
  const providerId = provider?.id || "";
  const summary = values.filter(Boolean).join(", ") || "keine Reaktion";
  if (autoplayConsoleLogState.get(providerId) === summary) return;
  autoplayConsoleLogState.set(providerId, summary);
  const time = new Date().toLocaleTimeString("de-DE");
  const remaining = Math.max(0, Math.round((request.until - Date.now()) / 1000));
  console.log(`[ELFIX AUTOPLAY] ${time} | ${provider?.name || providerId || "Provider"} | vollbild=${request.fullscreen ? "ja" : "nein"} | rest=${remaining}s | ${summary}`);
}

async function startPlaybackInView(view, options = {}) {
  const forcePass = options.mode === "fullscreen-force";
  const fullscreenPass = forcePass || options.mode === "fullscreen";
  const script = `(() => {
    const wantFullscreen = ${fullscreenPass ? "true" : "false"};
    const forceFullscreen = ${forcePass ? "true" : "false"};
    const waitForPlayingMs = 900;
    const badText = /close|schliessen|schließen|abbrechen|login|registr|teilen|share|trailer|info|beschreibung|kommentar|melden|verbesserung/i;
    const visible = (node) => {
      if (!node) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity || 1) > 0.05
        && rect.width > 8
        && rect.height > 8;
    };
    const textOf = (node) => String(node && (node.innerText || node.textContent || node.getAttribute("aria-label") || node.title || node.className || "") || "").replace(/\\s+/g, " ").trim();
    const where = () => "@" + location.hostname;
    const clickNode = (node) => {
      try {
        node.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
        const rect = node.getBoundingClientRect();
        const options = { bubbles: true, cancelable: true, view: window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
        node.dispatchEvent(new PointerEvent("pointerdown", options));
        node.dispatchEvent(new MouseEvent("mousedown", options));
        node.dispatchEvent(new PointerEvent("pointerup", options));
        node.dispatchEvent(new MouseEvent("mouseup", options));
        node.dispatchEvent(new MouseEvent("click", options));
        return true;
      } catch (_) {
        try { node.click(); return true; } catch (__) { return false; }
      }
    };
    // closest() liefert den INNERSTEN Treffer - der enthaelt oft nur das Video,
    // nicht die Bedienleiste. Stattdessen so weit hoch, wie der Container noch
    // die Groesse des Players hat: das ist die Wurzel inklusive Controls.
    const playerRootFor = (media) => {
      const base = media.getBoundingClientRect();
      const baseArea = Math.max(1, base.width * base.height);
      let best = media;
      let node = media.parentElement;
      while (node && node !== document.body && node !== document.documentElement) {
        const rect = node.getBoundingClientRect();
        const area = rect.width * rect.height;
        if (area > baseArea * 1.6) break;
        if (area >= baseArea * 0.9) best = node;
        node = node.parentElement;
      }
      return best;
    };
    const requestPlayerFullscreen = (node) => {
      if (!wantFullscreen || document.fullscreenElement) return "";
      const isFrame = node.tagName === "IFRAME" || node.tagName === "EMBED";
      const box = isFrame ? node : playerRootFor(node);
      if (!box || !box.requestFullscreen) return "";
      try {
        const result = box.requestFullscreen();
        if (result && typeof result.then === "function") {
          return result
            .then(() => "player-fullscreen")
            .catch((error) => "vollbild-abgelehnt:" + String((error && error.message) || error).slice(0, 60));
        }
        return "player-fullscreen";
      } catch (error) {
        return "vollbild-abgelehnt:" + String((error && error.message) || error).slice(0, 60);
      }
    };
    const playerFullscreenButton = () => {
      const selectors = [
        ".jw-icon-fullscreen",
        ".vjs-fullscreen-control",
        "[data-plyr='fullscreen']",
        "[class*='icon-fullscreen']",
        "[class*='fullscreen-control']",
        "[class*='btn-fullscreen']",
        "[aria-label*='fullscreen' i]",
        "[aria-label*='vollbild' i]",
        "[title*='fullscreen' i]",
        "[title*='vollbild' i]"
      ];
      for (const selector of selectors) {
        const node = Array.from(document.querySelectorAll(selector))
          .filter(visible)
          .filter((item) => {
            // Nur knopfgrosse Elemente - ein Treffer auf den Player-Container
            // wuerde sonst als Klick auf die Videoflaeche pausieren.
            const rect = item.getBoundingClientRect();
            return rect.width >= 14 && rect.width <= 200 && rect.height >= 14 && rect.height <= 200;
          })[0];
        if (node) return node;
      }
      return null;
    };
    const biggest = (selector) => Array.from(document.querySelectorAll(selector))
      .filter(visible)
      .sort((left, right) => {
        const l = left.getBoundingClientRect();
        const r = right.getBoundingClientRect();
        return (r.width * r.height) - (l.width * l.height);
      })[0];
    if (wantFullscreen) {
      if (document.fullscreenElement) return "vollbild-schon-aktiv" + where();
      const isTopDocument = window.top === window.self;
      if (!forceFullscreen) {
        // Der Knopf des Players selbst ist das beste Ziel: nur so stimmt danach
        // auch dessen interner Zustand (Controls, Seitenverhaeltnis).
        const button = playerFullscreenButton();
        if (button && clickNode(button)) {
          const label = textOf(button).slice(0, 20) || String(button.className).slice(0, 20);
          return "vollbild-knopf-geklickt:" + label + where();
        }
        return "kein-vollbild-knopf" + where();
      }
      // Notfall: nur das Hauptdokument handelt, damit nicht zwei Frames
      // gleichzeitig unterschiedliche Elemente ins Vollbild ziehen.
      if (!isTopDocument) return "";
      const playerFrame = biggest("iframe, embed");
      if (playerFrame) return requestPlayerFullscreen(playerFrame);
      const video = biggest("video");
      return video ? requestPlayerFullscreen(video) : "";
    }
    const isMediaReallyPlaying = (media) => {
      if (!media) return false;
      const current = Number(media.currentTime || 0);
      const last = Number(media.dataset.elfixAutoplayLastTime || 0);
      media.dataset.elfixAutoplayLastTime = String(current);
      return !media.paused && !media.ended && media.readyState > 1 && (current > 0 || current > last);
    };
    const isMediaCounting = (media) => {
      if (!media) return false;
      const current = Number(media.currentTime || 0);
      const last = Number(media.dataset.elfixAutoplayCountTime || 0);
      media.dataset.elfixAutoplayCountTime = String(current);
      return !media.paused && !media.ended && media.readyState > 1 && current > last + 0.25;
    };
    const playMedia = (media) => {
      try {
        media.muted = false;
        media.autoplay = true;
        const before = Number(media.currentTime || 0);
        const playResult = media.play();
        const afterPlay = () => {
          setTimeout(() => {
            if (!isMediaReallyPlaying(media)) return;
            requestPlayerFullscreen(media);
          }, waitForPlayingMs);
        };
        if (playResult && typeof playResult.then === "function") {
          playResult.then(afterPlay).catch(() => {});
        } else {
          afterPlay();
        }
        return !media.paused && Number(media.currentTime || 0) > before ? "video-started" : "video-play-requested";
      } catch (_) {
        return "";
      }
    };
    const playerOverlayButton = () => {
      const selectors = [
        ".jw-icon-display",
        ".jw-display-icon-display",
        ".jw-display-icon-container",
        ".vjs-big-play-button",
        ".plyr__control--overlaid",
        "[class*='big-play']",
        "[class*='play-button']",
        "[class*='playButton']",
        "[class*='display-icon']",
        "[aria-label='Play']",
        "[title='Play']"
      ];
      for (const selector of selectors) {
        const node = Array.from(document.querySelectorAll(selector))
          .filter(visible)
          .filter((item) => !badText.test(textOf(item)))[0];
        if (node) return node;
      }
      return null;
    };
    const media = biggest("video");
    if (media) {
      if (isMediaCounting(media)) {
        requestPlayerFullscreen(media);
        return "video-counting" + where();
      }
      if (isMediaReallyPlaying(media)) {
        requestPlayerFullscreen(media);
        return "video-playing" + where();
      }
      // Laeuft und hat Daten, zaehlt aber noch nicht: puffert gerade, nicht erneut
      // anstossen - ein zweiter Klick wuerde den Player wieder pausieren.
      if (!media.paused && !media.ended && media.readyState >= 2) return "video-warming" + where();
      const result = playMedia(media);
      // paused=false ohne Daten heisst: play() lief ins Leere, die Quelle haengt noch
      // am Play-Overlay des Players. Im selben Dokument erreichen synthetische
      // Klicks den Player - anders als von aussen auf das <iframe>.
      const lastOverlayClick = Number(document.documentElement.dataset.elfixOverlayClickAt || 0);
      if (media.readyState < 2 && Date.now() - lastOverlayClick > 2500) {
        document.documentElement.dataset.elfixOverlayClickAt = String(Date.now());
        const overlay = playerOverlayButton() || media;
        if (clickNode(overlay)) {
          const label = overlay === media ? "video" : (textOf(overlay).slice(0, 24) || String(overlay.className).slice(0, 24));
          return "overlay-geklickt:" + label + ":ready" + media.readyState + where();
        }
      }
      if (result) return result + ":ready" + media.readyState + where();
    }
    // Manche Anbieter legen vor den Player eine Aufforderung - bei Filmo etwa
    // "Tippe auf Play, um die Wiedergabe zu starten". Erst dieser Klick holt
    // den Hoster herein. Das muss vor der Rahmen-Pruefung stehen: die Seite
    // bringt schon einen Rahmen mit, und mit dem Abbruch darunter kam der
    // Autostart nie an den Knopf - Wiedergabe und Vollbild blieben aus.
    const startknopf = () => {
      const auswahl = "button,[role='button'],a,[class*='play'],[class*='Play'],[class*='start'],[class*='poster']";
      const treffer = Array.from(document.querySelectorAll(auswahl))
        .filter(visible)
        .map((node) => {
          const text = textOf(node).toLowerCase();
          const klasse = String(node.className || "").toLowerCase();
          const rect = node.getBoundingClientRect();
          // Weder Briefmarke noch halbe Seite: der Knopf liegt dazwischen.
          if (rect.width < 32 || rect.height < 32) return { node, score: 0 };
          if (rect.width > innerWidth * 0.7 && rect.height > innerHeight * 0.7) return { node, score: 0 };
          let score = 0;
          if (/tippe auf play|auf play|wiedergabe zu starten|zum abspielen|jetzt abspielen|start playback/i.test(text)) score += 2000;
          if (/(^|[^a-z])play([^a-z]|$)/i.test(text)) score += 900;
          // Der runde Knopf traegt oft gar keinen Text, nur eine Klasse wie
          // "vjs-big-play-button" - der muss allein schon reichen. Nur "play"
          // als ganzes Wort: "start" waere zu weit, das steckt bei Bootstrap
          // in jedem "justify-content-start".
          if (/(^|[^a-z])play([^a-z]|$)/i.test(klasse)) score += 900;
          if (badText.test(text)) score -= 2600;
          return { node, score };
        })
        .filter((item) => item.score > 800)
        .sort((a, b) => b.score - a.score);
      return treffer[0]?.node || null;
    };
    const start = startknopf();
    if (start && clickNode(start)) {
      return "startknopf-geklickt:" + (textOf(start).slice(0, 30) || String(start.className).slice(0, 30)) + where();
    }

    const frame = biggest("iframe, embed");
    if (frame) {
      return "iframe-gefunden" + where();
    }
    const candidates = Array.from(document.querySelectorAll([
      "button",
      "a[href]",
      "[role='button']",
      "[onclick]",
      "li",
      ".play",
      "[class*='play']",
      "[class*='hoster']",
      "[class*='stream']",
      "[class*='language']",
      "[data-link]",
      "[data-hoster]",
      "[data-id]"
    ].join(",")))
      .filter(visible)
      .map((node) => {
        const text = textOf(node).toLowerCase();
        const href = String(node.getAttribute && (node.getAttribute("href") || node.getAttribute("data-link") || node.getAttribute("data-hoster") || "") || "").toLowerCase();
        const rect = node.getBoundingClientRect();
        let score = Math.min(500, rect.width * rect.height / 100);
        if (/\\b(play|spielen|stream|watch|ansehen|starten)\\b/i.test(text)) score += 1800;
        if (/\\b(voe|vidmoly|vidoza|filemoon|filelions|dood|speedload|streamtape|streamsb|streamwish|upstream|supervideo|hoster)\\b/i.test(text + " " + href)) score += 1600;
        if (/\\b(deutsch|german|ger|voe)\\b/i.test(text)) score += 420;
        if (/\\/(?:staffel|season)-\\d+\\/(?:episode|folge)-\\d+/i.test(href)) score -= 900;
        if (badText.test(text + " " + href)) score -= 2600;
        if (rect.top >= 0 && rect.top < innerHeight) score += 120;
        if (rect.width < 22 || rect.height < 16) score -= 500;
        return { node, score };
      })
      .filter((item) => item.score > 500)
      .sort((a, b) => b.score - a.score);
    const target = candidates[0]?.node;
    return target && clickNode(target) ? "clicked:" + textOf(target).slice(0, 40) : "";
  })()`;
  return executeJavaScriptInMediaFrames(view, script);
}

function leaveContentFullscreen() {
  if (!mainWindow) return;
  if (isLiveView(activeView)) {
    activeView.webContents.executeJavaScript(
      "if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();",
      true
    ).catch(() => {});
  }
  isContentFullscreen = false;
  mainWindow.setFullScreen(false);
  sendFullscreenState();
  applyBrowserBounds();
}

function sendFullscreenState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("browser:fullscreen", isContentFullscreen);
  }
}

// `streng` gilt fuer Navigationen, die aus der Seite kommen - ein Klick oder
// ein Skript. Serverseitige Weiterleitungen einer bereits erlaubten Navigation
// werden bewusst milder geprueft, sonst bricht der Domainwechsel eines
// Anbieters (aniworld.to -> aniworld.sx) die App.
function shouldCancelNavigation(url, provider, streng = false) {
  if (shouldBlockProviderNavigation(url, provider)) {
    logBlockedUrl(url, provider, "site-lock", "navigation", "MAIN_FRAME_REDIRECT");
    return true;
  }
  if (streng && istPopupNavigation(url, provider)) {
    logBlockedUrl(url, provider, "popup:navigation", "popup", "POPUP");
    return true;
  }
  if (!settings.adblock.blockRedirects) return false;
  const decision = shouldBlockTarget(url, provider, "mainFrame");
  if (!decision.block) return false;
  logBlockedUrl(url, provider, `redirect:${decision.rule}`, "redirect", "MAIN_FRAME_REDIRECT");
  return true;
}

// Dasselbe fuer eingebettete Rahmen.
//
// will-navigate greift nur fuer das Hauptdokument. Ein Werberahmen, der sich
// selbst auf eine Fake-Gewinnspielseite schickt, lief bisher voellig
// ungeprueft - die Seite bleibt ja stehen, es wechselt nur der Rahmen, und
// genau darin sitzt dann das Gewinnspiel.
//
// Hier darf nicht dieselbe Strenge gelten wie oben: der Hosterrahmen leitet im
// Normalbetrieb mehrfach weiter, und ein fremder Rahmen ist nicht schon
// deshalb Werbung, weil er fremd ist. Geprueft wird deshalb gegen die
// Filterlisten - fremd und bekannt boese, das ist der Abbruchgrund.
function shouldCancelFrameNavigation(url, provider, quelle = "") {
  if (!provider || !settings.adblock.enabled || provider.adblockEnabled === false) return false;
  if (!settings.adblock.blockRedirects) return false;
  const adresse = String(url || "");
  if (!adresse || adresse === "about:blank") return false;
  // Fremde Schemata (intent:, market:, ...) sind in einem Rahmen immer eine
  // Weiterleitung in einen App-Store, nie Teil der Wiedergabe.
  if (!providerModel.isHttpUrl(adresse)) {
    logBlockedUrl(adresse, provider, "frame:fremdes-schema", "frame", "FRAME_REDIRECT");
    return true;
  }

  if (isChallengeOrVerificationUrl(adresse, provider) || istCaptchaHost(adresse)) return false;
  if (isKnownAuthHost(adresse)) return false;

  const decision = shouldBlockTarget(adresse, provider, "subFrame", quelle);
  if (!decision.block) return false;
  logBlockedUrl(adresse, provider, `frame:${decision.rule}`, "frame", "FRAME_REDIRECT");
  return true;
}

// Der haeufigste "Popup" auf diesen Seiten ist gar kein zweites Fenster: ein
// Skript im Werberahmen schiebt die ganze Ansicht auf eine Werbeseite, und
// mitten im Schauen ist die Folge weg. Das haengt an keiner Filterliste -
// ohne geladene Listen kam es frueher immer durch. Deshalb zaehlt hier nicht,
// ob die Adresse bekannt boese ist, sondern ob sie ueberhaupt hierher gehoert.
function istPopupNavigation(url, provider) {
  if (!provider || !settings.adblock.enabled || provider.adblockEnabled === false) return false;
  if (!settings.adblock.blockPopups) return false;
  return !istErlaubtesHauptziel(url, provider);
}

// Wohin darf die ganze Ansicht wechseln? Zum Anbieter, zu einem bekannten
// Hoster, zur Verifizierung, zu einer Anmeldung - und zu allem, was von Hand
// auf der Ausnahmeliste steht. Sonst nirgendwohin.
function istErlaubtesHauptziel(url, provider) {
  const adresse = String(url || "");
  if (!adresse || adresse === "about:blank") return true;
  // Fremde Schemata (intent:, market:, ...) sind hier immer eine Weiterleitung
  // in einen App-Store, nie Teil der Seite.
  if (!providerModel.isHttpUrl(adresse)) return false;

  let host;
  try {
    host = new URL(adresse).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (isProviderFirstParty(host, provider)) return true;
  if (isAllowedProviderHost(host, provider)) return true;
  if (isKnownVideoHosterUrl(adresse)) return true;
  if (isChallengeOrVerificationUrl(adresse, provider)) return true;
  if (isKnownAuthHost(adresse)) return true;
  if (isWhitelisted(host, settings.adblock.whitelist)) return true;
  return false;
}

// Auf diesen Seiten ist ein neues Fenster praktisch immer Werbung. Aufgehen
// darf deshalb nur die Verifizierung - bei S.to die Cloudflare-Abfrage "Bist
// du ein Mensch?", dazu die ueblichen Captchas.
//
// Vorher stand hier eine lange Liste von Ausnahmen: alles auf der
// Anbieter-Domain, alle bekannten Hoster und alles, was irgendwo "video",
// "stream" oder "player" in der Adresse hatte. Genau darueber kamen die
// Popups - und weil ein erlaubtes Fenster in der laufenden Ansicht geoeffnet
// wird, landete man mitten im Schauen auf einer Werbeseite.
function isAllowedNewWindowTarget(url, provider) {
  if (shouldBlockProviderNavigation(url, provider)) return false;
  if (!settings.adblock.blockPopups) return true;
  if (istVerifizierungsFenster(url, provider)) return true;
  // Eng gefasste Ausnahme fuer das Vorbereitungsfenster bei S.to: wurde eben
  // "Weiter" bestaetigt und geht daraufhin ein Fenster zu einem bekannten
  // Hoster oder zurueck zum Anbieter auf, ist das der Stream. Ohne diese
  // Ausnahme haette der Popup-Schutz genau den Klick entwertet, den der
  // Autostart gerade gemacht hat.
  //
  // Streng bleibt sie durch dreierlei: es zaehlt nur eine Bestaetigung, die
  // hoechstens acht Sekunden her ist, nur diese Ziele, und geoeffnet wird
  // ohnehin kein zweites Fenster - die Adresse laedt in der laufenden Ansicht.
  if (istTorNachlauf(provider) && (isKnownVideoHosterUrl(url) || isProviderFirstParty(providerModel.hostFromUrl(url), provider))) {
    return true;
  }
  return false;
}

// Streng gefasst: nur echte Abfragen, keine Wiedergabe-Adressen. Der Player
// braucht kein eigenes Fenster - er laeuft im Rahmen der Seite. Anders als
// isChallengeOrVerificationUrl gilt hier auf der Anbieter-Domain also nicht
// "/video", "/stream" oder "hoster" als Grund, ein Fenster aufgehen zu lassen.
function istVerifizierungsFenster(url, provider) {
  if (!providerModel.isHttpUrl(url)) return false;
  if (istCaptchaHost(url)) return true;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // Auf der Seite des Anbieters selbst nur die Abfrage - nicht die Wiedergabe.
  if (!isProviderFirstParty(parsed.hostname, provider)) return false;
  const pfad = parsed.pathname.toLowerCase();
  return /\/(?:cdn-cgi|captcha|check|verify|verification|challenge|turnstile)(?:\/|$)/i.test(pfad)
    || /(?:turnstile|cf_chl|captcha|verify|verification|challenge)/i.test(parsed.search);
}

function shouldBlockProviderNavigation(url, provider) {
  if (!provider || !providerModel.isHttpUrl(url)) return false;
  try {
    const target = new URL(url);
    return isOtherConfiguredProviderHost(target.hostname, provider);
  } catch {
    return false;
  }
}

function isOtherConfiguredProviderHost(hostname, activeProvider) {
  return enabledProviders().some((provider) => provider.id !== activeProvider?.id && isAllowedProviderHost(hostname, provider));
}

function isAllowedProviderHost(hostname, provider) {
  if (!provider) return false;
  return isAllowedResultHost(hostname, providerModel.hostFromUrl(provider.startUrl), provider);
}

// Ein bekannter Hoster - mehr sagt diese Pruefung nicht, und mehr darf sie
// auch nicht sagen. Sie entscheidet, wohin die ganze Ansicht wechseln und
// welcher Rahmen den Player tragen darf. Sie entscheidet nicht mehr, ob eine
// Anfrage am Filter vorbeigeht; das macht wiedergabeAusnahme().
function isKnownVideoHosterUrl(url) {
  const host = providerModel.hostFromUrl(url).toLowerCase();
  return /(voe|v[-.]?o[-.]?e|filemoon|filelions|dood|mixdrop|streamtape|vidmoly|vidoza|upstream|supervideo|streamsb|streamwish|lulustream|savefiles|mp4upload|vidsrc|vidguard|streamcloud|cloudflarestream)/i.test(host);
}

// Die Verifizierungs-Dienste selbst - Cloudflare Turnstile, hCaptcha,
// reCAPTCHA. Ohne die kommt man bei S.to nicht an "Bist du ein Mensch?"
// vorbei, deshalb steht diese Pruefung ueberall vor dem Blocken.
function istCaptchaHost(url) {
  if (!providerModel.isHttpUrl(url)) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const host = stripWww(parsed.hostname);
  const href = parsed.href.toLowerCase();

  if (host === "challenges.cloudflare.com" || host.endsWith(".challenges.cloudflare.com")) return true;
  if ((host === "cloudflare.com" || host.endsWith(".cloudflare.com")) && /turnstile|challenge|cf_chl|cdn-cgi/.test(href)) return true;
  if (host === "static.cloudflareinsights.com" && /turnstile|challenge|cf_chl|cdn-cgi|beacon/.test(href)) return true;
  if (host === "hcaptcha.com" || host.endsWith(".hcaptcha.com")) return true;
  if ((host === "recaptcha.net" || host.endsWith(".recaptcha.net") || host === "gstatic.com" || host.endsWith(".gstatic.com") || host === "google.com" || host.endsWith(".google.com"))
    && /recaptcha|captcha/.test(href)) return true;

  return false;
}

function isChallengeOrVerificationUrl(url, provider) {
  if (!providerModel.isHttpUrl(url)) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const pathName = parsed.pathname.toLowerCase();

  if (istCaptchaHost(url)) return true;

  if (!provider) return false;
  const isProviderAlias = isProviderFirstParty(parsed.hostname, provider);
  if (!isProviderAlias) return false;
  if (isStoProviderLike(provider)) {
    return /\/(?:cdn-cgi|ajax|api|captcha|check|verify|verification|challenge|turnstile|prepare|preparation|video|stream|hoster)(?:\/|$)/i.test(pathName)
      || /(?:turnstile|cf_chl|captcha|verify|verification|challenge|prepare|preparation|hoster)/i.test(parsed.search);
  }
  return /\/(?:cdn-cgi|captcha|check|verify|verification|challenge|turnstile)(?:\/|$)/i.test(pathName);
}

function isStoProviderLike(provider) {
  const name = String(provider?.name || "").toLowerCase();
  const host = providerModel.hostFromUrl(provider?.startUrl || "").toLowerCase();
  return name.includes("s.to") || isStoHost(host);
}

function sanitizeBounds(bounds) {
  return {
    x: Math.max(0, Math.round(Number(bounds?.x) || 0)),
    y: Math.max(0, Math.round(Number(bounds?.y) || 130)),
    width: Math.max(1, Math.round(Number(bounds?.width) || 1200)),
    height: Math.max(1, Math.round(Number(bounds?.height) || 700))
  };
}

function rememberProviderUrl(providerId, url) {
  const provider = providers.find((item) => item.id === providerId);
  if (!provider || !providerModel.isHttpUrl(url)) return;
  provider.lastUrl = url;
  recordMediaActivity(provider, url);
  saveProviders();
  sendActiveState();
}

// Die Entscheidung steht im geteilten Modul; hier wird sie ausgefuehrt.
function updateActiveFavoriteProgress(providerId, url) {
  if (!activeFavoriteId) return;
  const favorite = favorites.find((item) => item.id === activeFavoriteId);
  const provider = providers.find((item) => item.id === providerId);
  if (!favorite || !provider || favorite.providerId !== providerId) return;

  const urteil = fortschritt.favoritNachziehen(favorite, url, provider, settings.playback.favoriteProgressMode);
  if (urteil.art === "nichts") return;
  if (urteil.art === "loesen") {
    activeFavoriteId = null;
    sendActiveState();
    return;
  }

  Object.assign(favorite, urteil.aenderung);
  moveFavoriteToFront(favorite);
  saveFavorites();
  if (urteil.meldung) sendToast(urteil.meldung);
}

// Auf der Episodenseite steht die Folgenliste nicht - dort ist nicht zu sehen,
// dass die hinteren Nummern nur Hinweise auf eine zusammengefasste Folge sind.
// Die Staffeluebersicht weiss es und wird einmal je Staffel nachgeladen. Der
// Abruf laeuft nebenher: der Fortschritts-Takt soll nicht darauf warten.
function seasonPageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    url.search = "";
    const pfad = url.pathname.replace(/\/(?:episode|folge)-\d+\/?$/i, "");
    if (pfad === url.pathname || !/\/(?:staffel|season)-\d+$/i.test(pfad)) return "";
    url.pathname = pfad;
    return url.href;
  } catch {
    return "";
  }
}

// --- Neue Folgen zu abgeschlossenen Serien -----------------------------------
// Eine Serie in der Mediathek ist nicht fuer immer zu Ende: es kommen neue
// Staffeln und einzelne Folgen nach. Geprueft wird von Zeit zu Zeit im
// Hintergrund, und zwar nur, was auch wirklich abgeschlossen ist.

// Die Serienseite ohne Staffel und Folge - dort stehen alle Staffeln.
function serienSeiteUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    url.search = "";
    const pfad = url.pathname
      .replace(/\/(?:episode|folge)-\d+\/?$/i, "")
      .replace(/\/(?:staffel|season)-\d+\/?$/i, "");
    if (pfad === url.pathname) return "";
    url.pathname = pfad;
    return url.href;
  } catch {
    return "";
  }
}

// Was die Anbieterseite ueber den Umfang der Serie sagt: wie viele Staffeln,
// und wie viele Folgen die letzte hat.
async function serienUmfangLaden(favorite) {
  const serienUrl = serienSeiteUrl(favorite.url);
  if (!serienUrl) return null;
  const seite = await fetchProviderHtml(serienUrl).catch(() => null);
  if (!seite?.html) return null;

  const grenzen = extractSeriesBounds(seite.html);
  const staffeln = sanitizePositiveNumber(grenzen.seasons);
  if (!staffeln) return null;

  // Die Folgenzahl der letzten Staffel steht erst auf deren eigener Seite.
  const letzteUrl = replaceEpisodeUrl(favorite.url, staffeln, 1);
  const staffelSeite = letzteUrl ? await fetchProviderHtml(seasonPageUrl(letzteUrl) || letzteUrl).catch(() => null) : null;
  const inStaffel = staffelSeite?.html ? extractSeriesBounds(staffelSeite.html, staffeln) : null;
  const gelistet = staffelSeite?.html ? extractUnplayableEpisodes(staffelSeite.html) : null;
  const folgen = sanitizePositiveNumber(gelistet?.lastPlayable)
    || sanitizePositiveNumber(gelistet?.listed)
    || sanitizePositiveNumber(inStaffel?.episodes);
  return { seasons: staffeln, episodes: folgen };
}

// Kommt zu einer abgeschlossenen Serie etwas Neues, wird sie wieder geoeffnet:
// zurueck in die Watchlist, auf die erste neue Folge gesetzt und mit einem
// Merker versehen, damit die Oberflaeche darauf hinweisen kann.
async function pruefeNeueFolgen() {
  const kandidaten = favorites
    .filter((favorite) => favorite.completed)
    .filter((favorite) => (favorite.type || inferMediaType(favorite.url)) === "serie")
    .filter((favorite) => sanitizePositiveNumber(favorite.finalSeason) && episodeIdentity(favorite.url || ""))
    .sort((links, rechts) => Date.parse(rechts.completedAt || 0) - Date.parse(links.completedAt || 0))
    .slice(0, NEUE_FOLGEN_PRO_LAUF);
  if (!kandidaten.length) return;

  let geaendert = false;
  // Was in diesem Durchlauf neu dazukommt. Nur darueber wird eine Meldung
  // geschickt - newEpisodeAt bleibt am Eintrag stehen, bis der Titel geoeffnet
  // wird, und von dort gemeldet kaeme dieselbe Meldung immer wieder.
  const gemeldet = [];
  for (const favorite of kandidaten) {
    const umfang = await serienUmfangLaden(favorite).catch(() => null);
    if (!umfang) continue;

    const bekannteStaffel = sanitizePositiveNumber(favorite.finalSeason);
    const bekannteFolge = sanitizePositiveNumber(favorite.finalEpisode);
    const neueStaffel = umfang.seasons > bekannteStaffel;
    const neueFolge = umfang.seasons === bekannteStaffel
      && umfang.episodes > bekannteFolge
      && bekannteFolge > 0;
    if (!neueStaffel && !neueFolge) continue;

    // Auf die erste Folge, die noch nicht gesehen wurde.
    const ziel = neueStaffel
      ? replaceEpisodeUrl(favorite.url, bekannteStaffel + 1, 1)
      : replaceEpisodeUrl(favorite.url, bekannteStaffel, bekannteFolge + 1);
    if (!ziel) continue;

    const identity = episodeIdentity(ziel);
    favorite.url = ziel;
    favorite.normalizedUrl = normalizeFavoriteUrl(ziel);
    favorite.season = identity?.season || favorite.season || 0;
    favorite.episode = identity?.episode || favorite.episode || 0;
    favorite.finalSeason = umfang.seasons;
    favorite.finalEpisode = umfang.episodes;
    favorite.completed = false;
    favorite.completedAt = "";
    favorite.completedManually = false;
    favorite.episodeCompleted = false;
    favorite.continuePending = true;
    favorite.hideFromContinueWatching = false;
    favorite.progress = 0;
    favorite.position = 0;
    favorite.currentTime = 0;
    favorite.duration = 0;
    // Zurueck in die Watchlist, damit die Serie auffaellt.
    favorite.favorite = true;
    favorite.newEpisodeAt = new Date().toISOString();
    favorite.newEpisodeLabel = neueStaffel
      ? `Staffel ${bekannteStaffel + 1} ist da`
      : `Folge ${bekannteFolge + 1} ist da`;
    geaendert = true;
    gemeldet.push(favorite);
    console.log(`[ELFIX NEU] ${favorite.title}: ${favorite.newEpisodeLabel}`);
  }

  if (!geaendert) return;
  saveFavorites();
  sendActiveState();
  meldeNeueFolgen(gemeldet);
}

// Eine Windows-Benachrichtigung je neu gefundener Folge.
//
// ELFIX erkennt neue Folgen laengst - es sagte es nur, solange das Fenster
// offen war. Genau dann braucht man es aber nicht.
//
// Gemeldet wird nur, was in diesem Durchlauf neu dazugekommen ist. Die Liste
// steht in newEpisodeAt am Eintrag und bleibt dort stehen, bis der Titel
// geoeffnet wird; wuerde von dort gemeldet, kaeme bei jedem Durchlauf dieselbe
// Meldung wieder.
function meldeNeueFolgen(neue) {
  if (!neue.length) return;
  if (!settings.notifications?.newEpisodes) return;
  if (!Notification.isSupported()) {
    console.log("[ELFIX NEU] Benachrichtigungen sind auf diesem System nicht moeglich");
    return;
  }

  // Bei einem Schwall lieber eine Meldung als zehn. Drei Titel passen noch in
  // eine Zeile, danach wird gezaehlt.
  if (neue.length > 1) {
    const namen = neue.slice(0, 3).map((favorite) => cleanTitle(favorite.title));
    const rest = neue.length - namen.length;
    zeigeHinweis({
      titel: `${neue.length} neue Folgen`,
      text: namen.join(", ") + (rest > 0 ? ` und ${rest} weitere` : ""),
      favorite: neue[0]
    });
    return;
  }

  const favorite = neue[0];
  zeigeHinweis({
    titel: cleanTitle(favorite.title),
    text: favorite.newEpisodeLabel,
    favorite
  });
}

function zeigeHinweis({ titel, text, favorite }) {
  try {
    const hinweis = new Notification({ title: titel, body: text, silent: false });
    // Windows nimmt die Meldung an und liefert sie trotzdem nicht aus, wenn
    // Benachrichtigungen dort abgeschaltet sind - "isSupported" sagt davon
    // nichts. Ohne diese Zeile scheitert das lautlos, und man sucht den Fehler
    // in ELFIX statt in den Windows-Einstellungen.
    hinweis.on("failed", (_ereignis, fehler) => {
      console.log(`[ELFIX NEU] Windows hat die Benachrichtigung nicht angezeigt: ${fehler}`);
      console.log("[ELFIX NEU] Meist sind Benachrichtigungen in den Windows-Einstellungen aus (System > Benachrichtigungen).");
    });
    // Ein Klick soll dorthin fuehren, wovon die Meldung handelt - sonst steht
    // man im Fenster und sucht selbst.
    hinweis.on("click", () => {
      const fenster = BrowserWindow.getAllWindows()[0];
      if (!fenster) return;
      if (fenster.isMinimized()) fenster.restore();
      fenster.focus();
      if (favorite?.id) fenster.webContents.send("elfix:zeige-favorit", favorite.id);
    });
    hinweis.show();
  } catch (fehler) {
    console.log(`[ELFIX NEU] Benachrichtigung fehlgeschlagen: ${fehler?.message || fehler}`);
  }
}

// Wartende Fassung fuer Aufrufer, die nicht im Fortschritts-Takt haengen.
async function seasonPlaybackInfoAsync(url) {
  const seasonUrl = seasonPageUrl(url);
  if (!seasonUrl) return null;
  const gespeichert = seasonInfoCache.get(seasonUrl);
  if (gespeichert?.info && Date.now() - gespeichert.at < SEASON_INFO_CACHE_MS) return gespeichert.info;

  const seite = await fetchProviderHtml(seasonUrl).catch(() => null);
  const info = seite ? extractUnplayableEpisodes(seite.html) : null;
  seasonInfoCache.set(seasonUrl, { at: Date.now(), info });
  return info;
}

// Eine Folge war zu Ende, eine naechste wurde aber nie gesetzt: der Eintrag
// verschwindet dann aus "Weiterschauen", ohne in der Mediathek zu landen.
// Solche Faelle stammen aus der Zeit, als am Ende einer Staffel nicht in die
// naechste gewechselt wurde - beim Start werden sie eingesammelt.
function isStalledSeriesFavorite(favorite) {
  if (!favorite || favorite.completed || !favorite.episodeCompleted) return false;
  const identity = episodeIdentity(favorite.url || "");
  const finalSeason = sanitizePositiveNumber(favorite.finalSeason);
  const finalEpisode = sanitizePositiveNumber(favorite.finalEpisode);
  if (!identity || !finalSeason) return false;
  // Vor der letzten Staffel kommt sicher noch etwas - dafuer muss die
  // Folgenzahl der letzten Staffel nicht bekannt sein.
  if (identity.season < finalSeason) return true;
  if (!finalEpisode) return false;
  return compareEpisodeIdentity(identity, { key: identity.key, season: finalSeason, episode: finalEpisode }) < 0;
}

// Die zuletzt geschauten Serien - mehr muss beim Start nicht geprueft werden,
// und jede Staffel kostet einen Seitenaufruf.
function seriesRepairCandidates() {
  return favorites
    .filter((favorite) => (favorite.type || inferMediaType(favorite.url)) === "serie")
    .filter((favorite) => !favorite.completed && episodeIdentity(favorite.url || ""))
    .sort((links, rechts) => (
      Date.parse(rechts.lastWatchedAt || rechts.openedAt || 0) - Date.parse(links.lastWatchedAt || links.openedAt || 0)
    ))
    .slice(0, 8);
}

// Meldet die Watchparty eine zu Ende geschaute Folge, muss der eigene Eintrag
// nachruecken - sonst faellt der Titel aus "Weiterschauen", bis die App das
// naechste Mal startet. Gesammelt, weil dafuer Staffelseiten geladen werden.
let watchpartyReparaturTimer = 0;

function repariereFolgestaendeSpaeter() {
  if (watchpartyReparaturTimer) return;
  watchpartyReparaturTimer = setTimeout(() => {
    watchpartyReparaturTimer = 0;
    repairStalledSeriesFavorites().catch(() => {});
  }, 4000);
  watchpartyReparaturTimer.unref?.();
}

// Beim Start einsammeln, was schieflaufen konnte: Eintraege, die auf einer
// nicht abspielbaren Folge stehen, und solche, bei denen eine Folge zu Ende
// war, ohne dass eine naechste gesetzt wurde. Ohne die Staffeluebersicht wird
// nichts geraten - lieber bleibt der Eintrag, wie er ist.
async function repairStalledSeriesFavorites() {
  let geaendert = false;
  for (const favorite of seriesRepairCandidates()) {
    const identity = episodeIdentity(favorite.url || "");
    const info = await seasonPlaybackInfoAsync(favorite.url).catch(() => null);
    if (!info || !identity) continue;

    // Die Staffelgrenze nachziehen, wenn hinten zusammengefasste Folgen stehen.
    if (sanitizePositiveNumber(favorite.finalSeason) === identity.season
      && info.lastPlayable
      && sanitizePositiveNumber(favorite.finalEpisode) > info.lastPlayable) {
      favorite.finalEpisode = info.lastPlayable;
      geaendert = true;
    }

    const aufToterFolge = info.episodes.includes(identity.episode);
    if (!aufToterFolge && !isStalledSeriesFavorite(favorite)) continue;

    let ziel = nextEpisodeContinueUrl(favorite.url, "", favorite, {
      unplayableSeason: identity.season,
      unplayableEpisodes: info.episodes,
      seasonLastEpisode: info.lastPlayable
    });
    // Auf einer toten Folge und nichts kommt mehr danach: dann gehoert der
    // Eintrag auf die letzte Folge, die sich wirklich abspielen laesst.
    if (!ziel && aufToterFolge && info.lastPlayable) {
      ziel = replaceEpisodeUrl(favorite.url, identity.season, info.lastPlayable);
    }
    if (!ziel || ziel === favorite.url) continue;

    const zielIdentity = episodeIdentity(ziel);
    favorite.url = ziel;
    favorite.normalizedUrl = normalizeFavoriteUrl(ziel);
    favorite.season = zielIdentity?.season || favorite.season || 0;
    favorite.episode = zielIdentity?.episode || favorite.episode || 0;
    favorite.title = cleanBaseMediaTitle(favorite.title, ziel) || favorite.title;
    favorite.episodeCompleted = false;
    favorite.continuePending = true;
    favorite.hideFromContinueWatching = false;
    favorite.progress = 0;
    favorite.currentTime = 0;
    favorite.position = 0;
    favorite.duration = 0;
    geaendert = true;
  }
  if (geaendert) {
    saveFavorites();
    sendActiveState();
  }
  await refreshMissingThumbnails();
}

// Ein verworfenes Vorschaubild soll nicht bis zum naechsten Seitenbesuch fehlen.
async function refreshMissingThumbnails() {
  const ohneBild = favorites
    .filter((favorite) => !favorite.thumbnail)
    .sort((links, rechts) => (
      Date.parse(rechts.lastWatchedAt || rechts.openedAt || 0) - Date.parse(links.lastWatchedAt || links.openedAt || 0)
    ))
    .slice(0, 12);
  for (const favorite of ohneBild) {
    const provider = enabledProviders().find((item) => item.id === favorite.providerId)
      || enabledProviders().find((item) => item.name === favorite.providerName);
    if (!provider) continue;
    await repairFavoriteThumbnailIfNeeded(favorite, provider, true).catch(() => false);
  }
}

function seasonPlaybackInfo(url) {
  const seasonUrl = seasonPageUrl(url);
  if (!seasonUrl) return null;
  const gespeichert = seasonInfoCache.get(seasonUrl);
  const frisch = gespeichert && Date.now() - gespeichert.at < SEASON_INFO_CACHE_MS;
  if (frisch) return gespeichert.info || null;
  if (gespeichert?.pending) return null;

  seasonInfoCache.set(seasonUrl, { at: Date.now(), pending: true, info: gespeichert?.info || null });
  fetchProviderHtml(seasonUrl)
    .then((seite) => {
      seasonInfoCache.set(seasonUrl, {
        at: Date.now(),
        info: seite ? extractUnplayableEpisodes(seite.html) : null
      });
    })
    .catch(() => seasonInfoCache.set(seasonUrl, { at: Date.now(), info: null }));
  return gespeichert?.info || null;
}

function applySeasonPlaybackInfo(pageMeta, url) {
  if (!pageMeta) return;
  const identity = episodeIdentity(url);
  if (!identity?.season || !seasonPageUrl(url)) return;

  const info = seasonPlaybackInfo(url);
  if (!info) {
    // Noch unbekannt, ob die hinteren Folgen ueberhaupt abspielbar sind. Dann
    // lieber gar keine Staffelgrenze melden als eine zu hohe: der gespeicherte
    // Wert bleibt stehen, bis die Uebersicht geladen ist.
    if (sanitizePositiveNumber(pageMeta.finalSeason) === identity.season) pageMeta.finalEpisode = 0;
    return;
  }

  pageMeta.unplayableSeason = identity.season;
  pageMeta.unplayableEpisodes = info.episodes;
  pageMeta.seasonLastEpisode = info.lastPlayable;

  // Die letzte Folge nur dann kuerzen, wenn diese Staffel auch die letzte ist -
  // sonst wuerde die Folgenzahl einer fruehen Staffel zur Serien-Grenze.
  const finalSeason = sanitizePositiveNumber(pageMeta.finalSeason);
  const finalEpisode = sanitizePositiveNumber(pageMeta.finalEpisode);
  if (finalSeason === identity.season && info.lastPlayable && finalEpisode > info.lastPlayable) {
    pageMeta.finalEpisode = info.lastPlayable;
    pageMeta.finalEpisodeTrimmed = true;
  }
}

async function updateActiveFavoriteTitle(providerId, view) {
  if (!activeFavoriteId || !isLiveView(view)) return;
  const favorite = favorites.find((item) => item.id === activeFavoriteId);
  const provider = providers.find((item) => item.id === providerId);
  const url = view.webContents.getURL();
  if (!favorite || !provider || favorite.providerId !== providerId || !isFavoriteProgressUrl(url, provider)) return;
  if (favorite.normalizedUrl !== normalizeFavoriteUrl(url)) return;

  const meta = await readPageMetadata(view).catch(() => ({}));
  if (!isLiveView(view)) return;
  const title = cleanTitle(meta.title || view.webContents.getTitle() || titleFromPath(url) || favorite.title);
  let changed = false;
  if (title && favorite.title !== title) {
    favorite.title = title;
    changed = true;
  }
  if (meta.thumbnail && favorite.thumbnail !== meta.thumbnail) {
    favorite.thumbnail = meta.thumbnail;
    changed = true;
  }
  if (applyFavoriteSeriesBounds(favorite, meta, url)) {
    changed = true;
  }
  if (changed) {
    saveFavorites();
    sendActiveState();
  }
}

function resetContinueProgressToStart(favorite) {
  if (!favorite) return favorite;
  const identity = episodeIdentity(favorite.url || "");
  const now = new Date().toISOString();

  if (identity) {
    const resetUrl = firstEpisodeUrl(favorite.url);
    if (resetUrl) {
      favorite.url = resetUrl;
      favorite.normalizedUrl = normalizeFavoriteUrl(resetUrl);
    }
    favorite.season = 1;
    favorite.episode = 1;
    favorite.title = cleanBaseMediaTitle(favorite.title || "", favorite.url) || favorite.title;
    favorite.completedEpisodes = [];
    favorite.episodeCompleted = false;
    favorite.continuePending = false;
  }

  favorite.completed = false;
  // Auf Anfang zuruecksetzen heisst: der Titel gilt nicht mehr als abgehakt.
  // Bliebe der Merker stehen, waere der Eintrag weder in der Mediathek noch
  // wieder dorthin zu bekommen - derselbe Widerspruch wie beim Vormerken.
  favorite.completedManually = false;
  favorite.hideFromContinueWatching = true;
  favorite.progress = 0;
  favorite.duration = 0;
  favorite.position = 0;
  favorite.currentTime = 0;
  favorite.lastWatchedAt = "";
  favorite.completedAt = "";
  favorite.updatedAt = now;
  return favorite;
}

function sendActiveState() {
  // Der Live-Zustand haengt an der offenen Seite - bei jedem Wechsel neu melden.
  pushWatchpartyLiveState();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("browser:state", activeState());
  }
}

function sendToast(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:toast", message);
  }
}

function activeState() {
  const view = activeView;
  return {
    activeProviderId,
    url: view?.webContents.getURL() || "",
    title: view?.webContents.getTitle() || "",
    // Fuer die Rueckmeldung am Neu-laden-Knopf: laeuft gerade ein Ladevorgang?
    loading: Boolean(view?.webContents?.isLoading?.()),
    canGoBack: Boolean(view?.webContents.canGoBack()),
    canGoForward: Boolean(view?.webContents.canGoForward()),
    favorites
  };
}

function buildNavigationUrl(input, provider) {
  const value = String(input || "").trim();
  if (value.length === 0) return provider.startUrl;
  if (providerModel.looksLikeUrl(value)) return providerModel.normalizeUrl(value);
  return providerModel.buildSearchUrl(provider, value);
}

async function searchAllProviders(query) {
  const value = String(query || "").trim();
  if (!value) return [];

  const targets = enabledProviders().map((provider) => searchProvider(provider, value));

  return Promise.all(targets);
}

async function searchProvider(provider, query) {
  const variants = searchQueryVariants(query);
  let fallback = null;
  for (const variant of variants) {
    const result = await searchProviderVariant(provider, variant);
    if (result.results.length) {
      return {
        ...result,
        queryVariant: variant,
        queryVariants: variants
      };
    }
    if (!fallback) fallback = result;
  }
  return fallback ? { ...fallback, queryVariants: variants } : providerSearchFailure(provider, providerModel.buildSearchUrl(provider, query), "Keine Suche");
}

async function searchProviderVariant(provider, query) {
  const searchUrl = providerModel.buildSearchUrl(provider, query);
  try {
    const ajaxResults = await searchProviderAjax(provider, query, searchUrl).catch(() => []);
    if (ajaxResults.length) {
      return {
        providerId: provider.id,
        providerName: provider.name,
        searchUrl,
        results: ajaxResults
      };
    }

    const response = await fetch(searchUrl, {
      headers: {
        "accept": "text/html,application/xhtml+xml",
        "user-agent": "Mozilla/5.0 ELFIX/0.2"
      },
      redirect: "follow"
    });
    if (!response.ok) {
      return providerSearchFailure(provider, searchUrl, `HTTP ${response.status}`);
    }
    const html = await response.text();
    return {
      providerId: provider.id,
      providerName: provider.name,
      searchUrl,
      results: extractSearchLinks(html, searchUrl, query, provider)
    };
  } catch (error) {
    return providerSearchFailure(provider, searchUrl, error.message || "Nicht erreichbar");
  }
}

async function searchProviderAjax(provider, query, searchUrl) {
  if (!usesAniWorldAjaxSearch(provider)) return [];
  const endpoint = new URL("/ajax/search", provider.startUrl).href;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "accept": "application/json,text/javascript,*/*",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "user-agent": "Mozilla/5.0 ELFIX/0.2",
      "x-requested-with": "XMLHttpRequest",
      "referer": searchUrl
    },
    body: new URLSearchParams({ keyword: query }),
    redirect: "follow"
  });
  if (!response.ok) return [];
  const payload = await response.json().catch(() => []);
  if (!Array.isArray(payload)) return [];

  const tokens = queryTokens(query);
  const seen = new Set();
  const results = [];
  for (const item of payload) {
    const href = absoluteHttpUrl(item?.link, endpoint);
    if (!href || seen.has(href) || isNoiseUrl(href) || !isProviderResultUrl(href, endpoint, provider)) continue;
    const title = usableResultTitle(cleanAnchorText(item?.title || "")) || titleFromPath(href);
    if (!title || isNoiseTitle(title) || !matchesQuery(title, href, tokens)) continue;
    seen.add(href);
    results.push({ title, url: href });
    if (results.length >= 16) break;
  }
  return results;
}

// Empfehlungen: von jeder aktiven Anbieterseite ein paar Titel von der
// Startseite lesen und abwechselnd mischen, damit jede Seite vorkommt.
// Der Kalender der Anbieter - zwei Bauarten.
//
// AniWorld liefert fertiges HTML unter /animekalender. S.to laedt seinen
// Kalender per JavaScript nach; die Daten liegen unter /api/calendar und sind
// nach Datum geordnet. Probiert wird deshalb erst die Schnittstelle, dann die
// Seite - was zuerst etwas hergibt, gewinnt.
const KALENDER_QUELLEN = [
  { pfad: "api/calendar", art: "json" },
  { pfad: "animekalender", art: "html" },
  { pfad: "serienkalender", art: "html" },
  { pfad: "kalender", art: "html" }
];
const KALENDER_CACHE_MS = 30 * 60 * 1000;
let kalenderCache = null;

async function ladeKalender(refresh) {
  if (!refresh && kalenderCache && Date.now() - kalenderCache.at < KALENDER_CACHE_MS) {
    return kalenderCache.daten;
  }

  const anbieter = enabledProviders();
  const listen = await Promise.all(anbieter.map(async (provider) => {
    const basis = providerModel.normalizeUrl(provider.startUrl || "");
    if (!basis) return [];
    for (const quelle of KALENDER_QUELLEN) {
      try {
        const adresse = new URL(quelle.pfad, basis).href;
        // fetchProviderHtml liefert { html, url } - und null, wenn die Seite
        // nicht antwortet. Beides muss hier ausgepackt werden, sonst sieht der
        // Parser "[object Object]" und findet nie etwas.
        const antwort = await fetchProviderHtml(adresse);
        if (!antwort?.html) continue;
        const eintraege = quelle.art === "json"
          ? extractCalendarJson(antwort.html)
          : extractCalendarEntries(antwort.html);
        if (!eintraege.length) continue;
        console.log(`[ELFIX KALENDER] ${provider.name}: ${eintraege.length} Eintraege aus ${quelle.pfad}`);
        return eintraege.map((eintrag) => ({
          ...eintrag,
          url: absoluteHttpUrl(eintrag.url, basis),
          // Die Cover stehen relativ zur Anbieterseite.
          image: eintrag.image ? absoluteHttpUrl(eintrag.image, basis) : "",
          providerId: provider.id,
          providerName: provider.name || ""
        }));
      } catch {
        // Diese Quelle kennt der Anbieter nicht - die naechste ist dran.
      }
    }
    return [];
  }));

  // Nur die kommende Woche. S.to liefert ueber die Schnittstelle knapp drei
  // Wochen am Stueck - dann stuenden unter "Montag" gleich drei verschiedene
  // Montage untereinander.
  const heute = new Date();
  heute.setHours(0, 0, 0, 0);
  const grenze = new Date(heute);
  grenze.setDate(grenze.getDate() + 7);
  const inDerWoche = (eintrag) => {
    if (!eintrag.date) return true;
    const wann = new Date(`${eintrag.date}T00:00:00`);
    return wann >= heute && wann < grenze;
  };

  const eintraege = listen.flat().filter(inDerWoche);
  // Welches Datum gehoert zu welchem Wochentag? Kommt aus den Eintraegen
  // selbst, damit die Reiter dasselbe zeigen wie die Karten darunter.
  const datumJeTag = {};
  for (const eintrag of eintraege) {
    if (eintrag.date && !datumJeTag[eintrag.day]) datumJeTag[eintrag.day] = eintrag.date;
  }

  const daten = { days: WOCHENTAGE_LISTE, dates: datumJeTag, entries: eintraege };
  kalenderCache = { at: Date.now(), daten };
  return daten;
}

const WOCHENTAGE_LISTE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

async function collectRecommendations(proAnbieter, refresh) {
  const anbieter = enabledProviders();
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
      const html = await fetchProviderHtml(seriesPageUrl(item.url) || item.url);
      erscheinungsdaten.set(item.url, extractReleaseDate(html) || "");
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
  const seite = await fetchProviderHtml(startUrl);
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

// --- Watchparty --------------------------------------------------------------
// Gemeinsam an einer Serie dranbleiben. Nichts wird von selbst geteilt: jemand
// stellt eine Serie in den Raum, alle sehen sie als Vorschlag, und wer mitmacht,
// tritt bei. Erst ab dann fliesst der Fortschritt dieser Serie zwischen den
// Beigetretenen - und zwar in beide Richtungen, also auch in die eigene
// Weiterschauen-Liste.

// Was dieses Geraet eingestellt hat und wo es dabei ist, steht auch lokal.
// Damit ueberlebt die Watchparty ein Update der App genauso wie einen Neustart
// des Relays: fehlt beim Verbinden etwas, wird es wieder eingetragen.
function loadWatchpartyLocal() {
  try {
    const roh = JSON.parse(fs.readFileSync(WATCHPARTY_FILE, "utf8"));
    // Aus der Zeit mit nur einem Raum stehen in "joined" blosse Schluessel.
    // Ohne Raum daran gehoert der Eintrag dem einzigen, den es damals gab.
    const alterRaum = String(settings?.watchparty?.rooms?.[0] || "");
    return {
      shared: (Array.isArray(roh?.shared) ? roh.shared : []).map((eintrag) => ({
        ...eintrag,
        room: String(eintrag?.room || alterRaum)
      })),
      joined: (Array.isArray(roh?.joined) ? roh.joined : []).map((eintrag) => (
        typeof eintrag === "string"
          ? { key: eintrag, room: alterRaum }
          : { key: String(eintrag?.key || ""), room: String(eintrag?.room || alterRaum) }
      )).filter((eintrag) => eintrag.key)
    };
  } catch {
    return { shared: [], joined: [] };
  }
}

function saveWatchpartyLocal() {
  try {
    ensureDataDir();
    fs.writeFileSync(WATCHPARTY_FILE, JSON.stringify(watchpartyLokal));
  } catch {
    // Ohne die Datei geht nur die Wiederherstellung verloren, sonst nichts.
  }
}

function rememberWatchpartyState(eintraege) {
  watchpartyLokal = {
    shared: eintraege.filter((eintrag) => eintrag.mine).map((eintrag) => ({
      key: eintrag.key,
      room: eintrag.room || "",
      url: eintrag.url,
      title: eintrag.title,
      providerName: eintrag.providerName,
      thumbnail: eintrag.thumbnail,
      type: eintrag.type,
      season: eintrag.season,
      episode: eintrag.episode
    })),
    joined: eintraege
      .filter((eintrag) => eintrag.joined)
      .map((eintrag) => ({ key: eintrag.key, room: eintrag.room || "" }))
  };
  saveWatchpartyLocal();
}

// Einmal je Verbindung: fehlende eigene Titel neu einstellen und
// Mitgliedschaften wieder eintragen. Bewusst Verlassenes bleibt draussen, weil
// es beim Verlassen aus der lokalen Liste fliegt.
function restoreWatchparty(eintraege, raum) {
  if (!raum || watchpartyWiederhergestellt.has(raum)) return;
  watchpartyWiederhergestellt.add(raum);
  const imRaum = eintraege.filter((eintrag) => eintrag.room === raum);

  let nachgetragen = 0;
  for (const eigen of watchpartyLokal.shared) {
    if (eigen.room !== raum) continue;
    if (imRaum.some((eintrag) => eintrag.key === eigen.key)) continue;
    watchparty.teilen(eigen, raum);
    nachgetragen += 1;
  }
  for (const dabei of watchpartyLokal.joined) {
    if (dabei.room !== raum) continue;
    const eintrag = imRaum.find((item) => item.key === dabei.key);
    if (!eintrag || eintrag.joined) continue;
    watchparty.beitreten(dabei.key, raum);
    nachgetragen += 1;
  }
  if (nachgetragen) {
    console.log(`[ELFIX WATCHPARTY] ${nachgetragen} Eintrag/Eintraege in „${raum}“ wiederhergestellt`);
  }
}

const watchparty = new WatchpartyRaeume({
  onDeviceId: (kennung) => {
    // Ohne eigene Kennung vergibt das Relay eine. Die wird uebernommen, sonst
    // erkennt sich das Geraet nach jedem Start neu und faellt aus seinen
    // Mitgliedschaften.
    if (!kennung || settings.watchparty?.deviceId === kennung) return;
    settings.watchparty = { ...(settings.watchparty || {}), deviceId: kennung };
    saveSettings();
    console.log(`[ELFIX WATCHPARTY] Kennung vom Raum uebernommen: ${kennung}`);
  },
  onState: (eintraege, raum) => {
    watchpartyShared = eintraege;
    pushWatchpartyLiveState();
    restoreWatchparty(eintraege, raum);
    // Aufraeumen und Merken erst, wenn der Zustand steht: die eben
    // verschickten Beitritte kommen erst mit dem naechsten Zustand zurueck.
    watchpartyZustandSichernSpaeter();
    sendWatchpartyItems();
  },
  onProgress: (key, fortschritt, raum) => applyWatchpartyProgress(key, fortschritt, raum),
  onControl: (nachricht) => applyWatchpartyControl(nachricht).catch(() => {}),
  onWatchstate: (nachricht) => sendWatchpartyWatchstate(nachricht),
  // Alles mit "yt" davor gehoert der YouTube-Watchparty. Hier wird es nur
  // weitergereicht - die Watchparty fuer Serien sieht es nie.
  onYoutube: (nachricht) => { youtubeParty.nachricht(nachricht); },
  // Der Chat aendert nichts am Raumzustand - er wird nur weitergereicht.
  onChat: (nachricht) => watchpartyChatZeigen(nachricht),
  onConnection: (raum, offen) => youtubeParty.verbindung(raum, offen),
  onStatus: (status, raum) => {
    // Nach einem Verbindungsabbruch wird beim naechsten Zustand erneut
    // nachgetragen, was fehlt - je Raum getrennt.
    for (const eintrag of status.rooms || []) {
      if (!eintrag.connected) watchpartyWiederhergestellt.delete(eintrag.room);
    }
    if (raum && !status.rooms?.some((eintrag) => eintrag.room === raum)) {
      watchpartyWiederhergestellt.delete(raum);
    }
    pushWatchpartyLiveState();
    // Der YouTube-Modus haengt am selben Raum: faellt der weg oder kommt er
    // zurueck, muss er das erfahren.
    youtubePartySync();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("watchparty:state", status);
  }
});

// Die Einstellungen haben sich geaendert, ohne dass die Oberflaeche es
// veranlasst hat. Ohne diese Meldung stuende in der Seitenleiste weiter der
// alte Stand - und das naechste Speichern von dort haette den Schalter aus
// der Seite still wieder zurueckgedreht.
function meldeEinstellungen() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("settings:changed", publicSettings(settings));
}

function watchpartySettings() {
  return settings.watchparty || {};
}

function syncWatchparty() {
  const konfiguration = watchpartySettings();
  watchparty.konfigurieren({
    enabled: konfiguration.enabled === true,
    serverUrl: konfiguration.serverUrl || "",
    rooms: Array.isArray(konfiguration.rooms) ? konfiguration.rooms : [],
    name: konfiguration.deviceName || "ELFIX",
    deviceId: konfiguration.deviceId || ""
  });
  youtubePartySync();
}

// --- Meine Geraete ----------------------------------------------------------
//
// Ein Schluessel haelt die Geraete einer Person zusammen. Kein Raum, kein
// Beitreten, keine Mitglieder: was hier privat in "Weiterschauen" steht, steht
// auf dem anderen Geraet genauso.
//
// Was mitgeht, ist der Stand - Folge, Stelle, abgeschlossen, die Reihenfolge in
// der Mediathek. Nicht mit gehen das eigene Bild (es liegt als Data-URL vor und
// ist um ein Vielfaches groesser als alles andere zusammen) und der Verlauf je
// Eintrag (er ist die Chronik dieses Geraets). Was daran zaehlt, steht ohnehin
// im Stand.
//
// Watchparty-Eintraege bleiben ausdruecklich draussen. Sie gehoeren ihrem Raum
// und werden dort abgeglichen; sie hier ein zweites Mal zu verschicken, hiesse
// zwei Wege fuer denselben Stand - und der eine wuerde den anderen ueberholen.
const GERAETE_ABGLEICH_MS = 3000;
let geraeteSpiegelTimer = 0;
let geraeteAbgleichTimer = 0;
let geraeteSpiegel = null;
// Ob nach diesem Schub die Folgestaende nachgezogen werden muessen.
let geraeteFolgestaende = false;

const geraete = new Geraeteabgleich({
  onEintrag: (stand, at) => uebernimmGeraeteStand(stand, at),
  onWeg: (key) => entferneGeraeteEintrag(key),
  onSitzung: (sitzung) => uebernimmGeraeteSitzung(sitzung),
  // Geschrieben wird einmal je Schub, nicht einmal je Eintrag.
  onFertig: (anzahl) => {
    saveFavorites();
    // Angekommene Sitzungen liegen bis hierher nur im Speicher.
    saveSitzungen();
    sendActiveState();
    console.log(`[ELFIX GERAETE] ${anzahl} Eintrag/Eintraege von einem anderen Geraet uebernommen`);
    if (!geraeteFolgestaende) return;
    geraeteFolgestaende = false;
    // Hat das andere Geraet eine Folge zu Ende geschaut, gehoert der eigene
    // Eintrag auf die naechste - sonst verschwindet er aus "Weiterschauen".
    repariereFolgestaendeSpaeter();
  },
  onSpeichern: (ablage) => geraeteSpiegelSichernSpaeter(ablage),
  onStatus: (status) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("geraete:state", status);
  }
});

function geraeteSettings() {
  return settings.geraete || {};
}

function syncGeraete() {
  const konfiguration = geraeteSettings();
  geraete.konfigurieren({
    enabled: konfiguration.enabled === true,
    // Dieselbe Adresse wie die Watchparty: es ist dasselbe Relay. Zwei Felder
    // dafuer waeren zwei Gelegenheiten, sich zu vertippen - und eine Frage
    // mehr, wenn dann eines von beidem nicht geht.
    serverUrl: settings.watchparty?.serverUrl || "",
    schluessel: konfiguration.key || "",
    // Dasselbe Geraet wie in der Watchparty. Es gibt keinen Grund, hier eine
    // zweite Kennung zu fuehren.
    geraetId: settings.watchparty?.deviceId || ""
  });
  // Nach dem Einrichten einmal nachsehen, ob etwas hinaus muss - beim Start
  // ist das der ganze Bestand, wenn dieses Geraet neu dazugekommen ist.
  geraeteAbgleichSpaeter(1000);
}

function loadGeraeteSpiegel() {
  try {
    return JSON.parse(fs.readFileSync(GERAETE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function geraeteSpiegelSichernSpaeter(ablage) {
  geraeteSpiegel = ablage;
  if (geraeteSpiegelTimer) return;
  geraeteSpiegelTimer = setTimeout(() => {
    geraeteSpiegelTimer = 0;
    try {
      ensureDataDir();
      fs.writeFileSync(GERAETE_FILE, JSON.stringify(geraeteSpiegel));
    } catch {
      // Ohne die Datei meldet der naechste Start einmal zu viel. Mehr nicht.
    }
  }, 1000);
  geraeteSpiegelTimer.unref?.();
}

// Alles Private, je Titel einmal. Welche Eintraege das sind und was von
// ihnen hinausgeht, steht in geraete-stand.js - dasselbe Modul, das auch das
// Telefon benutzt.
function geraeteStaende() {
  return geraeteStand.staende(favorites);
}


// Die Wiedergabesitzungen, die dieses Geraet noch nicht gemeldet hat.
//
// Anders als die Staende sind sie ein Ereignis und kein Zustand: eine
// abgeschlossene Sitzung aendert sich nie wieder. Deshalb geht jede genau
// einmal hinaus, und "welche schon?" beantwortet der Spiegel.
//
// Die laufende Sitzung bleibt draussen. Sie waechst noch, und was hier
// hinausginge, waere ein Zwischenstand, der drueben als fertiger Satz
// dastuende.
function geraeteSitzungen() {
  const offen = laufendeSitzungIds();
  const liste = [];
  for (const sitzung of loadSitzungen()) {
    const id = String(sitzung?.id || "");
    if (!id || offen.has(id)) continue;
    const key = `${SITZUNG_PRAEFIX}${id}`;
    if (geraete.kennt(key)) continue;
    liste.push({ key, sitzung });
  }
  // Ungekuerzt. Wie viel davon in einem Zug hinausgeht, entscheidet der Abgleich
  // selbst - er verschickt in Schueben und schiebt den Rest nach. Hier zu kappen
  // hiesse, dass der Rest liegenbleibt, bis zufaellig wieder jemand etwas
  // schaut.
  return liste;
}

// Eine Sitzung von einem anderen Geraet. Sie kommt dazu oder sie ist schon da -
// ueberschrieben wird nie: zwei Geraete koennen denselben Satz nicht
// verschieden wissen.
function uebernimmGeraeteSitzung(sitzung) {
  if (!sitzung?.id || !sitzung?.begonnenAm) return false;
  const { sitzungen, dazu } = statistik.vereinen(loadSitzungen(), [sitzung]);
  if (!dazu) return false;
  sitzungenSpeicher = sitzungen;
  sitzungenSchmutzig = true;
  return true;
}

function geraeteAbgleichSpaeter(verzoegerung = GERAETE_ABGLEICH_MS) {
  if (!geraete.aktiv || geraeteAbgleichTimer) return;
  geraeteAbgleichTimer = setTimeout(() => {
    geraeteAbgleichTimer = 0;
    try {
      geraete.abgleichen(geraeteStaende());
      geraete.anhaengen(geraeteSitzungen());
    } catch (fehler) {
      console.log(`[ELFIX GERAETE] Abgleich fehlgeschlagen: ${fehler?.message || fehler}`);
    }
  }, verzoegerung);
  geraeteAbgleichTimer.unref?.();
}

// Der private Eintrag zu diesem Titel. Ausdruecklich ohne die der Watchparty:
// derselbe Anime kann in zwei Raeumen und einmal privat dastehen, und nur der
// private gehoert diesem Abgleich.
function lokalerGeraeteEintrag(key) {
  return geraeteStand.eintragFinden(favorites, key);
}

// Was dieses Geraet dem gemeinsamen Modul an die Hand gibt: alles, was von der
// laufenden App abhaengt und deshalb nicht in ein teilbares Modul gehoert.
function geraeteUmgebung() {
  return {
    favoriten: favorites,
    anbieterFuer: (url, providerName) => providerForWatchpartyUrl(url, providerName),
    normalisieren: (favorit) => normalizeLoadedFavorite(favorit),
    eigenesBild: (url) => bekanntesEigenesBild(url),
    bildAusschnitt: (url) => bekannterBildAusschnitt(url),
    kennung: () => crypto.randomUUID()
  };
}

// Ein Stand vom anderen Geraet. Rueckgabe ist der Stand, wie er danach hier
// gilt - oder null, wenn nichts daraus wurde. Die Regel steht im gemeinsamen
// Modul; hier bleibt, was danach in dieser App geschehen muss.
function uebernimmGeraeteStand(stand, at) {
  const ergebnis = geraeteStand.uebernehmen(stand, geraeteUmgebung());
  if (!ergebnis) return null;
  if (ergebnis.folgestand) geraeteFolgestaende = true;
  console.log(ergebnis.neu
    ? `[ELFIX GERAETE] ${ergebnis.eintrag.title} von einem anderen Geraet uebernommen`
    : `[ELFIX GERAETE] ${ergebnis.eintrag.title}: Stand von einem anderen Geraet uebernommen`);
  return ergebnis.stand;
}

// Anderswo geloescht. Hier gilt dasselbe wie dort: der Eintrag verschwindet,
// und zwar wirklich - ein Grabstein liegt beim Relay, damit ihn niemand
// zurueckholt.
function entferneGeraeteEintrag(key) {
  const weg = geraeteStand.entfernen(favorites, key);
  if (!weg) return false;
  console.log(`[ELFIX GERAETE] ${weg.title} auf einem anderen Geraet geloescht`);
  return true;
}

// Der Schluessel muss auf jedem Geraet gleich ausfallen. Die Adresse taugt
// dafuer nicht: S.to laeuft hier ueber eine IP, beim naechsten ueber die
// Domain. Titel und Medientyp sind dagegen ueberall dieselben.
function watchpartyKey(favorite) {
  return geraeteStand.titelSchluessel(favorite);
}


// Eine Serie in den Raum stellen - ausgeloest vom Knopf in der Kopfzeile.
// Gemeldet wird erst, wenn der Raum die Serie zurueckspiegelt: sonst hiesse es
// "hinzugefuegt", obwohl die Nachricht ins Leere ging - etwa wenn das Relay
// noch eine aeltere Fassung faehrt, die "share" gar nicht kennt.
// Fragt ueber ein Fenstermenue, in welchen Raum der Titel soll. Kommt keine
// Auswahl, bleibt alles, wie es war.
function frageWatchpartyRaum(punkt, nurDiese = null, optionen = {}) {
  const alle = watchpartyRaumUebersicht();
  const uebersicht = Array.isArray(nurDiese) && nurDiese.length
    ? alle.filter((raum) => nurDiese.includes(raum.room))
    : alle;
  if (!mainWindow || mainWindow.isDestroyed() || !uebersicht.length) return Promise.resolve("");
  return new Promise((fertig) => {
    let gewaehlt = "";
    // "Privat" ist eine eigene Wahl und braucht ein Kennzeichen: eine leere
    // Antwort heisst abgebrochen.
    const privatEintrag = optionen.withPrivate
      ? [{
        label: optionen.aktuell === PRIVAT ? "✓ Privat (nur fuer dich)" : "Privat (nur fuer dich)",
        click: () => {
          gewaehlt = PRIVAT;
        }
      }, { type: "separator" }]
      : [];
    const menue = Menu.buildFromTemplate([
      { label: optionen.titel || "In welchen Raum?", enabled: false },
      { type: "separator" },
      ...privatEintrag,
      ...uebersicht.map((raum) => ({
        label: raum.connected && !raum.error
          ? `${raum.room}   (${raum.items === 1 ? "1 Titel" : `${raum.items} Titel`}, ${raum.peers} verbunden)`
          : `${raum.room}   (${raum.error || "nicht verbunden"})`,
        enabled: raum.connected && !raum.error,
        click: () => {
          gewaehlt = raum.room;
        }
      }))
    ]);
    const stelle = punkt && Number.isFinite(punkt.x) && Number.isFinite(punkt.y)
      ? { x: Math.round(punkt.x), y: Math.round(punkt.y) }
      : {};
    menue.popup({
      window: mainWindow,
      ...stelle,
      // Der Rueckruf kommt erst, nachdem der Klick verarbeitet wurde.
      callback: () => fertig(gewaehlt)
    });
  });
}

// Wen soll der Host bekommen? Gefragt wird ueber ein Fenstermenue - ueber der
// Anbieterseite waere ein Kaestchen aus HTML nicht anklickbar. Zur Wahl stehen
// nur die, die gerade wirklich bei derselben Folge mitschauen.
function frageWatchpartyMitglied(kandidaten, punkt) {
  const liste = Array.isArray(kandidaten) ? kandidaten.filter((person) => person?.id) : [];
  if (!mainWindow || mainWindow.isDestroyed() || !liste.length) return Promise.resolve("");
  return new Promise((fertig) => {
    let gewaehlt = "";
    const menue = Menu.buildFromTemplate([
      { label: "Host weitergeben an", enabled: false },
      { type: "separator" },
      ...liste.map((person) => ({
        label: `${person.name || "Gerät"}${person.paused ? "   (pausiert)" : ""}`,
        click: () => {
          gewaehlt = String(person.id);
        }
      }))
    ]);
    const stelle = punkt && Number.isFinite(punkt.x) && Number.isFinite(punkt.y)
      ? { x: Math.round(punkt.x), y: Math.round(punkt.y) }
      : {};
    menue.popup({ window: mainWindow, ...stelle, callback: () => fertig(gewaehlt) });
  });
}

async function shareWatchpartyFavorite(favorite, room, punkt) {
  if (!favorite?.url) return { shared: false, reason: "Kein Titel geöffnet" };
  if (!watchparty.aktiv) return { shared: false, reason: "Watchparty ist nicht eingerichtet" };
  if (!watchparty.verbunden) return { shared: false, reason: "Keine Verbindung zum Raum" };
  const key = watchpartyKey(favorite);
  if (!key) return { shared: false, reason: "Titel nicht erkannt" };

  // Bei mehreren Raeumen wird gefragt. Das muss ein echtes Menue sein: die
  // Seite des Anbieters liegt als eigene Ansicht ueber der Oberflaeche, ein
  // Kaestchen aus HTML waere dort abgeschnitten und nicht anklickbar.
  let ziel = String(room || "").trim();
  if (!ziel && watchparty.codes.length > 1) {
    ziel = await frageWatchpartyRaum(punkt);
    if (!ziel) return { shared: false, abgebrochen: true };
  }
  if (ziel && !watchparty.codes.includes(ziel)) {
    return { shared: false, reason: `Raum „${ziel}“ ist nicht eingerichtet` };
  }

  const angenommen = watchparty.teilen({
    key,
    url: favorite.url,
    title: cleanBaseMediaTitle(favorite.title, favorite.url) || favorite.title || "",
    providerName: favorite.providerName || "",
    thumbnail: favorite.thumbnail || "",
    type: favorite.type || inferMediaType(favorite.url) || "serie",
    season: sanitizePositiveNumber(favorite.season),
    episode: sanitizePositiveNumber(favorite.episode)
  }, ziel);
  if (!angenommen) return { shared: false, reason: "Kein Raum eingerichtet" };

  const bestaetigt = await waitForSharedTitle(key, WATCHPARTY_BESTAETIGUNG_MS, ziel);
  if (bestaetigt) return { shared: true, key, room: ziel || watchparty.codes[0] || "" };
  return {
    shared: false,
    reason: "Der Raum hat die Serie nicht bestätigt - läuft das Relay schon auf dem neuen Stand?"
  };
}

function waitForSharedTitle(key, timeoutMs, room) {
  const da = () => watchpartyShared.some((eintrag) => (
    eintrag.key === key && (!room || eintrag.room === room)
  ));
  return new Promise((fertig) => {
    if (da()) {
      fertig(true);
      return;
    }
    const start = Date.now();
    const timer = setInterval(() => {
      if (da()) {
        clearInterval(timer);
        fertig(true);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        clearInterval(timer);
        fertig(false);
      }
    }, 150);
    timer.unref?.();
  });
}

// Der Schluessel, unter dem dieser Titel in seiner Runde gefuehrt wird. Er
// kommt aus dem Titel - und genau das ging schief, wenn der Anbieter den
// Seitentitel je Folge anders schreibt: der Fortschritt meldete unter einem
// Schluessel, den der Raum nicht kennt, und in der Runde kam nichts an.
// Passt der Titel-Schluessel zu keiner beigetretenen Serie, entscheidet die
// Adresse - sie zeigt verlaesslich auf dieselbe Serie.
function watchpartySchluesselFuerFavorit(favorite, raum) {
  const key = watchpartyKey(favorite);
  if (key && watchparty.istBeigetreten(key)) return key;
  const treffer = watchpartyShared.find((eintrag) => (
    eintrag.joined
    && String(eintrag.room || "") === String(raum || "")
    && istGleicheSerie(eintrag.url, favorite?.url)
  ));
  return treffer?.key || "";
}

// Beim Schauen: nur melden, was auch geteilt und beigetreten ist.
function reportWatchpartyProgress(favorite) {
  if (!watchparty.aktiv) return;
  // Jeder Eintrag gehoert zu genau einer Runde und meldet nur dorthin. Der
  // eigene Eintrag ohne Raum bleibt privat - sonst liefe der Stand aus dem
  // stillen Schauen in jede Watchparty, in der der Titel zufaellig steht.
  const raum = String(favorite.watchpartyRoom || "");
  if (!raum) return;
  const key = watchpartySchluesselFuerFavorit(favorite, raum);
  if (!key) return;

  // Die Form des Stands steht im geteilten Modul: das Telefon meldet
  // dieselben Felder, sonst versteht die Gegenseite die Haelfte nicht.
  watchparty.fortschrittMelden(key, fortschritt.watchpartyStand(favorite, watchpartySettings().deviceName), raum);
}

function providerForWatchpartyUrl(url, providerName) {
  return geraeteStand.anbieterFinden(enabledProviders(), url, providerName);
}

// Fortschritt eines Mitglieds einarbeiten. Das betrifft nur Serien, denen
// dieses Geraet beigetreten ist - der Server schickt nichts anderes.
function applyWatchpartyProgress(key, stand, room) {
  const eintrag = watchpartyEintrag(key, room);
  const lokal = lokalerWatchpartyEintrag(key, eintrag?.room || room);

  if (!lokal) {
    const provider = providerForWatchpartyUrl(stand.url || eintrag?.url || "", eintrag?.providerName);
    if (!provider) return;
    const neu = createWatchpartyFavorite(key, eintrag, stand, provider);
    if (!neu) return;
    favorites.unshift(neu);
    console.log(`[ELFIX WATCHPARTY] ${neu.title} aus der Watchparty uebernommen`);
    saveFavorites();
    sendActiveState();
    if (neu.episodeCompleted) repariereFolgestaendeSpaeter();
    return;
  }

  // Die Regel steht im geteilten Modul, damit das Telefon einen Stand genauso
  // uebernimmt wie der Rechner. Der Parameter heisst bewusst nicht mehr
  // "fortschritt": so hiess er frueher, und damit verdeckte er das Modul
  // gleichen Namens - der Aufruf hier waere ins Leere gegangen.
  const urteil = fortschritt.watchpartyStandUebernehmen(lokal, stand);
  if (urteil.art !== "aendern") return;

  Object.assign(lokal, urteil.aenderung);
  console.log(`[ELFIX WATCHPARTY] ${lokal.title}: Stand von ${stand.from || "einem Geraet"} uebernommen`);
  saveFavorites();
  sendActiveState();
  if (urteil.folgestaendePruefen) repariereFolgestaendeSpaeter();
}

function createWatchpartyFavorite(key, eintrag, fortschritt, provider) {
  const url = absoluteHttpUrl(fortschritt?.url || eintrag?.url || "", provider.startUrl || "");
  if (!url) return null;
  const identity = episodeIdentity(url);
  return normalizeLoadedFavorite({
    id: crypto.randomUUID(),
    providerId: provider.id,
    providerName: provider.name || eintrag?.providerName || "",
    title: cleanTitle(eintrag?.title || url),
    url,
    normalizedUrl: normalizeFavoriteUrl(url),
    favicon: "",
    thumbnail: eintrag?.thumbnail || "",
    // Ein eigenes Bild gehoert zum Titel: ein neu entstehender Raum-Eintrag
    // uebernimmt es, statt wieder mit dem Bild des Anbieters anzufangen.
    customThumbnail: bekanntesEigenesBild(url),
    customThumbnailCrop: bekannterBildAusschnitt(url),
    logo: provider.logo || "",
    favorite: false,
    watched: true,
    completed: Boolean(fortschritt?.completed),
    episodeCompleted: Boolean(fortschritt?.episodeCompleted),
    continuePending: !fortschritt?.completed && !fortschritt?.episodeCompleted,
    completedEpisodes: [],
    hideFromContinueWatching: false,
    progress: sanitizeProgress(fortschritt?.progress),
    duration: sanitizePositiveNumber(fortschritt?.duration),
    position: sanitizePositiveNumber(fortschritt?.position),
    currentTime: sanitizePositiveNumber(fortschritt?.position),
    type: normalizeMediaType(eintrag?.type || inferMediaType(url)),
    season: identity?.season || fortschritt?.season || 0,
    episode: identity?.episode || fortschritt?.episode || 0,
    // Dieser Eintrag gehoert zu genau einer Runde. Derselbe Anime in einem
    // zweiten Raum bekommt seinen eigenen.
    watchpartyRoom: String(eintrag?.room || ""),
    createdAt: new Date().toISOString(),
    lastWatchedAt: fortschritt?.updatedAt || new Date().toISOString(),
    activity: []
  });
}

// Fuer die Anzeige: geteilte Serien mit Mitgliedern und eigenem Beitritt.
function watchpartyItems() {
  return watchpartyShared.map((eintrag) => {
    // Hatte das einstellende Geraet kein Bild, ist im Raum keines hinterlegt.
    // Kennt dieses Geraet den Titel, wird das eigene Bild genommen - und dem
    // Raum gleich nachgereicht, damit auch die anderen es sehen.
    const lokal = favorites.find((favorite) => watchpartyKey(favorite) === eintrag.key)
      || favorites.find((favorite) => istGleicheSerie(favorite.url, eintrag.url));
    // Ein selbst gewaehltes Bild hat immer Vorrang - es ist eine ausdrueckliche
    // Entscheidung und gilt fuer diesen Titel ueberall, auch hier. Vorher
    // gewann das Bild aus dem Raum, und in der Watchparty stand weiter das des
    // Anbieters, obwohl in "Weiterschauen" laengst ein eigenes hing.
    const eigenes = lokal?.customThumbnail || bekanntesEigenesBild(eintrag.url);
    const geteilt = eintrag.thumbnail || lokal?.thumbnail || "";
    const bild = eigenes || geteilt;
    // Nur nachreichen, wo dieses Geraet ohnehin Mitglied ist: "share" traegt
    // den Absender sonst als Mitglied ein, und ein Bild ist kein Beitritt.
    // Nachgereicht wird nur ein echtes Anbieterbild - ein eigenes liegt als
    // Data-URL vor und gehoert niemandem sonst.
    if (!eintrag.thumbnail && geteilt && eintrag.joined && watchparty.verbunden) {
      nachreichenWatchpartyBild(eintrag, geteilt);
    }
    return {
      ...eintrag,
      thumbnail: bild,
      // Der Ausschnitt gehoert zu dem eigenen Bild und nur zu ihm. Steht auf
      // der Karte das Bild des Anbieters, waere eine dafuer gewaehlte Lage die
      // Lage eines fremden Bildes.
      thumbnailCrop: eigenes
        ? bildausschnitt.normalisierenOderNull(lokal?.customThumbnailCrop || bekannterBildAusschnitt(eintrag.url))
        : null,
      openable: Boolean(providerForWatchpartyUrl(eintrag.url, eintrag.providerName))
    };
  });
}

// Ein fehlendes Bild nur einmal je Titel nachreichen, sonst laeuft bei jedem
// Rendern eine Meldung durchs Netz.
function nachreichenWatchpartyBild(eintrag, bild) {
  const merker = `${eintrag.room || ""}|${eintrag.key}`;
  if (watchpartyBildNachgereicht.has(merker)) return;
  watchpartyBildNachgereicht.add(merker);
  watchparty.teilen({
    key: eintrag.key,
    url: eintrag.url,
    title: eintrag.title,
    providerName: eintrag.providerName,
    thumbnail: bild,
    type: eintrag.type,
    season: eintrag.season,
    episode: eintrag.episode
  }, eintrag.room);
}

// Nach dem Verbinden traegt restoreWatchparty die Mitgliedschaften nach - die
// Antwort darauf kommt erst mit dem naechsten Zustand. Wer sofort aufraeumt,
// loescht genau in diesem Moment alles, was noch nicht bestaetigt ist: nach
// jedem Start waren die gemeinsamen Staende weg. Also erst, wenn Ruhe ist.
let watchpartyRuheTimer = 0;

function watchpartyZustandSichernSpaeter() {
  if (watchpartyRuheTimer) clearTimeout(watchpartyRuheTimer);
  watchpartyRuheTimer = setTimeout(() => {
    watchpartyRuheTimer = 0;
    if (!watchparty.aktiv) return;
    raeumeWatchpartyEintraegeAuf();
    // Beim Ausschalten meldet jeder Raum leer - das darf die Ablage nicht
    // loeschen, sonst ist nach dem Wiedereinschalten alles fort.
    rememberWatchpartyState(watchpartyShared);
  }, WATCHPARTY_RUHE_MS);
  watchpartyRuheTimer.unref?.();
}

// Verlaesst man eine Runde, wird sie aufgeloest oder fliegt man heraus, gehoert
// auch ihr Weiterschauen-Eintrag nicht mehr in die Liste - er ist der Stand
// dieser Runde, nicht der eigene. Der private Eintrag bleibt unberuehrt.
//
// Aufgeraeumt wird nur fuer Raeume, deren Verbindung steht: bei einem Aussetzer
// meldet das Relay nichts, und ein Abbruch duerfte keine Staende loeschen.
function raeumeWatchpartyEintraegeAuf() {
  // Ausgeschaltete Watchparty heisst nicht aufgeloest: dann bleibt alles
  // stehen, bis sie wieder laeuft.
  if (!watchparty.aktiv) return;
  const raeume = watchparty.status().rooms || [];
  const verbunden = new Set(raeume.filter((raum) => raum.connected).map((raum) => raum.room));
  const eingerichtet = new Set(watchparty.codes);
  const dabei = new Set(watchpartyShared
    .filter((eintrag) => eintrag.joined)
    .map((eintrag) => `${eintrag.room}|${eintrag.key}`));

  const behalten = [];
  const entfernt = [];
  for (const favorite of favorites) {
    const raum = String(favorite.watchpartyRoom || "");
    // Ein eingerichteter Raum wird nur angefasst, wenn seine Verbindung steht
    // und seine Mitgliedschaften nachgetragen wurden. Fuer entfernte Raeume
    // gilt das nicht - deren Staende sollen weg.
    if (!raum
      || (eingerichtet.has(raum) && (!verbunden.has(raum) || !watchpartyWiederhergestellt.has(raum)))
      || dabei.has(`${raum}|${watchpartyKey(favorite)}`)) {
      behalten.push(favorite);
      continue;
    }
    entfernt.push(`${favorite.title} (${raum})`);
    if (activeFavoriteId === favorite.id) activeFavoriteId = null;
  }
  if (!entfernt.length) return;

  favorites = behalten;
  saveFavorites();
  sendActiveState();
  console.log(`[ELFIX WATCHPARTY] Stand verworfen, nicht mehr dabei: ${entfernt.join(", ")}`);
}

// Jeder Raum fuehrt seinen eigenen Weiterschauen-Eintrag. Wer denselben Anime
// in zwei Raeumen mitschaut, hat ihn zweimal in der Liste - jeweils mit dem
// Stand dieser Runde. Der Eintrag ohne Raum ist der eigene, private.
function lokalerWatchpartyEintrag(key, room) {
  const raum = String(room || "");
  return favorites.find((favorite) => (
    watchpartyKey(favorite) === key && String(favorite.watchpartyRoom || "") === raum
  )) || null;
}

// Denselben Titel kann es in mehreren Raeumen geben. Ist keiner genannt, zaehlt
// der, in dem dieses Geraet mitschaut - dort steht auch der Fortschritt.
function watchpartyEintrag(key, room) {
  const schluessel = String(key || "");
  const code = String(room || "").trim();
  const treffer = watchpartyShared.filter((eintrag) => eintrag.key === schluessel);
  if (code) return treffer.find((eintrag) => eintrag.room === code) || null;
  return treffer.find((eintrag) => eintrag.joined) || treffer[0] || null;
}

// Womit die Oberflaeche die Raeume benennen kann: Code, Verbindung, Anzahl.
function watchpartyRaumUebersicht() {
  return (watchparty.status().rooms || []).map((raum) => ({
    room: raum.room,
    connected: Boolean(raum.connected),
    error: raum.error || "",
    peers: (raum.peers || []).length,
    items: watchpartyShared.filter((eintrag) => eintrag.room === raum.room).length
  }));
}

function sendWatchpartyItems() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const items = watchpartyItems();
  if (items.length) {
    const uebersicht = items
      .map((item) => `${item.title} [${(item.members || []).length} dabei${item.joined ? ", ich auch" : ""}]`)
      .join(" | ");
    console.log(`[ELFIX WATCHPARTY] ${items.length} Titel im Raum: ${uebersicht}`);
  }
  mainWindow.webContents.send("watchparty:items", items);
}

// Oeffnet wie eine Karte aus "Weiterschauen": Vorhang, Autostart, Vollbild -
// zusaetzlich wird an die Stelle gesprungen, an der das andere Geraet steht.
async function openWatchpartyItem(key, room) {
  const eintrag = watchpartyEintrag(key, room);
  if (!eintrag) return activeState();
  const provider = providerForWatchpartyUrl(eintrag.url, eintrag.providerName);
  if (!provider) return activeState();

  const url = eintrag.progress?.url || eintrag.url;
  merkeWatchpartySprung(provider.id, eintrag.progress);

  // Aus diesem Raum geoeffnet: ab jetzt laeuft der Fortschritt in den Eintrag
  // dieses Raums. Gibt es ihn noch nicht, entsteht er hier - der eigene und
  // die anderen Runden bleiben davon unberuehrt. Ohne Beitritt gibt es keinen
  // gemeinsamen Stand: dann bleibt es beim eigenen Eintrag.
  let favorite = eintrag.joined ? lokalerWatchpartyEintrag(key, eintrag.room) : null;
  if (!favorite && eintrag.joined) {
    favorite = createWatchpartyFavorite(key, eintrag, eintrag.progress || {}, provider);
    if (favorite) favorites.unshift(favorite);
  }
  if (!eintrag.joined) {
    favorite = lokalerWatchpartyEintrag(key, "");
  }
  if (favorite) {
    activeFavoriteId = favorite.id;
    moveFavoriteToFront(favorite);
    recordMediaActivity(provider, url, {}, { existing: favorite, label: "Geöffnet" });
    await repairFavoriteThumbnailIfNeeded(favorite, provider).catch(() => false);
  }

  await beginAutostart(provider.id, cleanTitle(eintrag.title || favorite?.title || ""));
  await navigateProvider(provider, url);
  scheduleProviderAutoplay(provider, activeView, { fullscreen: true });
  return activeState();
}

// --- Live zuschauen ----------------------------------------------------------
// Pause, Weiter und Springen gelten fuer alle Beigetretenen. Dafuer horcht ein
// kleines Skript im Player-Frame auf die Ereignisse des Videos und meldet sie
// ueber die Konsole zurueck - denselben Rueckkanal nutzt schon der
// "Naechste Folge"-Knopf.
// Die Leiste der Mitschauenden - aber im Player, nicht in der Kopfzeile.
//
// Sie muss in die Seite eingespritzt werden: die Anbieteransicht liegt ueber
// der Oberflaeche, ein Element der App waere dort nie zu sehen. Eingehaengt
// wird nur in dem Rahmen, der das Video fuehrt. Damit sitzt sie ueber dem Bild
// und geht im Vollbild mit - dort ist genau dieser Rahmen der Vollbild-Rahmen,
// waehrend ein Element des aeusseren Dokuments verschwinden wuerde.
//
// Sichtbar wird sie mit der Maus, wie die Bedienleiste des Players, und
// verschwindet nach kurzer Ruhe wieder.
function watchpartyLeisteScript() {
  return `(() => {
    if (window.__elfixWpLeisteBereit) return "schon-da";
    const medien = Array.from(document.querySelectorAll("video")).filter((m) => Number(m.duration) > 0);
    // Nur der Rahmen mit dem Video zeigt sie - sonst stuende sie doppelt da,
    // einmal in der Seite und einmal im Player.
    if (!medien.length) return "kein-video";
    window.__elfixWpLeisteBereit = true;

    const kasten = document.createElement("div");
    // Alles ueber die Eigenschaften setzen, nicht ueber ein Stylesheet: viele
    // Hoster verbieten eingebettete Stile per Content-Security-Policy.
    const s = kasten.style;
    s.position = "fixed";
    s.top = "10px";
    s.left = "50%";
    s.transform = "translateX(-50%)";
    s.zIndex = "2147483647";
    s.display = "flex";
    s.gap = "6px";
    s.padding = "5px 8px";
    s.borderRadius = "999px";
    s.background = "rgba(10, 14, 22, 0.82)";
    s.color = "#f7f8fb";
    s.font = "500 12px/1.35 system-ui, sans-serif";
    s.pointerEvents = "none";
    s.opacity = "0";
    s.transition = "opacity 180ms ease";
    s.maxWidth = "92vw";
    s.overflow = "hidden";
    kasten.setAttribute("aria-hidden", "true");
    document.documentElement.appendChild(kasten);

    let ruheTimer = 0;
    const zeigen = () => {
      if (!kasten.childElementCount) return;
      kasten.style.opacity = "1";
      clearTimeout(ruheTimer);
      ruheTimer = setTimeout(() => { kasten.style.opacity = "0"; }, 2600);
    };
    document.addEventListener("mousemove", zeigen, true);
    document.addEventListener("mousedown", zeigen, true);
    document.addEventListener("keydown", zeigen, true);

    // Im Vollbild werden alle Geschwister des Vollbild-Elements ausgeblendet.
    // Also zieht die Leiste dorthin um.
    const umhaengen = () => {
      const ziel = document.fullscreenElement || document.documentElement;
      if (kasten.parentNode !== ziel) ziel.appendChild(kasten);
      zeigen();
    };
    document.addEventListener("fullscreenchange", umhaengen, true);
    document.addEventListener("webkitfullscreenchange", umhaengen, true);

    // Von aussen befuellt: eine Marke je Geraet.
    window.__elfixWpLeiste = (leute) => {
      kasten.replaceChildren();
      for (const person of Array.isArray(leute) ? leute : []) {
        const marke = document.createElement("span");
        const ms = marke.style;
        ms.display = "inline-flex";
        ms.alignItems = "center";
        ms.gap = "5px";
        ms.padding = "2px 8px";
        ms.borderRadius = "999px";
        ms.whiteSpace = "nowrap";
        ms.background = person.me ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.08)";

        const zeichen = document.createElement("span");
        zeichen.textContent = person.paused ? "❚❚" : "▶";
        zeichen.style.fontSize = "9px";
        zeichen.style.color = person.paused ? "#f5b84b" : "#22c55e";

        const name = document.createElement("span");
        name.textContent = person.name || "Gerät";
        if (person.host) name.style.fontWeight = "700";

        marke.append(zeichen, name);
        if (person.host) {
          const host = document.createElement("span");
          host.textContent = "HOST";
          host.style.fontSize = "9px";
          host.style.opacity = "0.8";
          marke.append(host);
        }
        const uhr = document.createElement("span");
        uhr.textContent = person.zeit || "";
        uhr.style.opacity = "0.85";
        uhr.style.fontVariantNumeric = "tabular-nums";
        marke.append(uhr);
        kasten.append(marke);
      }
      if (!kasten.childElementCount) kasten.style.opacity = "0";
    };
    return "installiert";
  })()`;
}

function watchpartyControlScript() {
  return `(() => {
    if (window.__elfixWpInstalled) return "schon-da";
    window.__elfixWpInstalled = true;
    window.__elfixWpErwartet = null;

    const melden = (aktion, media) => {
      // Der eigene Player meldet eine eben ausgefuehrte fremde Anweisung als
      // eigenes Ereignis zurueck - sonst schaukeln sich zwei Player auf. Genau
      // dieses Echo wird verschluckt, aber auch nur das: drueckt jemand Pause,
      // waehrend gerade ein Play hereinkam, ist das eine echte Tat und muss
      // durch. Vorher schwieg das Geraet pauschal ein paar Sekunden lang, und
      // genau in dieser Zeit ging Pausieren nach einem Sync ins Leere.
      const erwartet = window.__elfixWpErwartet;
      if (erwartet && Date.now() < erwartet.bis) {
        // Beim Sprung entscheidet die Stelle: nur der Sprung auf genau das
        // erwartete Ziel ist das Echo. Wer waehrenddessen selbst woandershin
        // spult, meint das ernst - vorher verschluckte diese Pruefung jeden
        // zweiten Sprung, weil sie nur auf die Art schaute.
        if (aktion === "seek") {
          if (Math.abs(Number(media.currentTime) - erwartet.ziel) < 2) return;
        } else if (aktion === erwartet.aktion) {
          return;
        }
      }
      // Auf zwei Nachkommastellen: gerundete Sekunden reichen nicht, wenn alle
      // exakt auf derselben Stelle stehen sollen.
      console.log("__elfix:wp:" + aktion + ":" + (Number(media.currentTime) || 0).toFixed(2));
    };

    // Wo dieses Geraet steht - fuer die Leiste der anderen. Das haengt nicht am
    // Echo-Schutz: eine Standmeldung ist kein Befehl, sie schaukelt nichts auf.
    // Sie geht sofort raus, sobald sich etwas aendert, und waehrend der
    // Wiedergabe nebenher im Sekundentakt. Vorher hat der Hauptprozess dafuer
    // alle Frames der Seite abgefragt - langsam und teuer zugleich.
    let letzteMeldung = 0;
    const standMelden = (media, sofort) => {
      const jetzt = Date.now();
      if (!sofort && jetzt - letzteMeldung < 1000) return;
      letzteMeldung = jetzt;
      console.log("__elfix:wp:stand:"
        + (Number(media.currentTime) || 0).toFixed(2) + ":" + (media.paused ? 1 : 0));
    };

    // Am Dokument in der Abfangphase, nicht an einzelnen Videos: Medien-
    // Ereignisse steigen nicht auf, lassen sich aber abfangen. Damit gilt das
    // auch fuer ein Video, das die Seite spaeter einsetzt.
    //
    // Vorher hingen die Horcher an den Elementen, die beim Einhaengen zufaellig
    // schon da waren. Tauscht der Anbieter den Player aus - anderer Hoster,
    // andere Qualitaet, neu geladener Rahmen -, waren sie an einem Element, das
    // niemand mehr sieht, und das Geraet meldete Pause und Weiter gar nicht
    // mehr. Der Merker stand ja auf "schon eingehaengt".
    const passt = (ziel) => ziel instanceof HTMLMediaElement && Number(ziel.duration) > 0;
    const horchen = (name, tun) => document.addEventListener(name, (ereignis) => {
      if (passt(ereignis.target)) tun(ereignis.target);
    }, true);

    horchen("play", (media) => { melden("play", media); standMelden(media, true); });
    horchen("pause", (media) => { melden("pause", media); standMelden(media, true); });
    horchen("seeked", (media) => { melden("seek", media); standMelden(media, true); });
    // Puffern ist keine Pause, sieht fuer die anderen aber genauso aus:
    // die Stelle bleibt stehen. Also sofort melden, wenn es stockt.
    horchen("waiting", (media) => standMelden(media, true));
    horchen("playing", (media) => standMelden(media, true));
    horchen("timeupdate", (media) => standMelden(media, false));
    return "installiert";
  })()`;
}

// Die Skripte, die im Player-Rahmen laufen, stehen in watchparty-sync.js -
// zusammen mit den Entscheidungen, die sie tragen, und dort gegen ein
// nachgebautes Video geprueft.
function watchpartyDriftScript(ereignis) {
  return watchpartySync.driftScript(ereignis);
}

function watchpartySyncZuruecksetzenScript() {
  return watchpartySync.zuruecksetzenScript();
}

function watchpartyApplyScript(action, ereignis, optionen) {
  return watchpartySync.applyScript(action, ereignis, optionen);
}

// Erster Teil des gemeinsamen Gleichziehens: anhalten und auf die Zielstelle
// springen. Erst wenn alle so weit sind, gibt der Server das Startsignal -
// sonst laufen die Geraete sofort wieder auseinander.
async function prepareWatchpartySync(eintrag, nachricht) {
  sendWatchpartyLive({
    active: true,
    live: true,
    key: eintrag.key,
    title: eintrag.title,
    syncing: true,
    from: nachricht.from,
    position: nachricht.position
  });

  // Steht die falsche Folge offen, erst dorthin wechseln.
  if (nachricht.url) {
    await followWatchpartyEpisode(eintrag, { ...nachricht, action: "navigate" });
  }

  let vorbereitet = false;
  for (const [, view] of providerViews) {
    if (!isLiveView(view)) continue;
    if (!istGleicheFolge(nachricht.url || eintrag.url, view.webContents.getURL())) continue;
    // Anhalten, exakt auf die Stelle des Hosts, und erst zurueckmelden, wenn
    // der Sprung wirklich sitzt und genug gepuffert ist. Der Host haelt nur an,
    // wo er ohnehin steht - seine Stelle ist ja das Ziel.
    await executeJavaScriptInMediaFrames(
      view,
      watchpartyApplyScript("syncprepare", watchpartyEreignis(nachricht, false), {
        genau: true,
        warten: true,
        nichtSpringen: Boolean(eintrag.hostId) && eintrag.hostId === eintrag.myId
      })
    ).catch(() => []);
    vorbereitet = true;
  }
  // Auch wer die Folge gerade nicht offen hat, meldet sich - sonst warten die
  // anderen unnoetig bis zum Zeitlimit.
  watchparty.bereitZumStart(eintrag.key, eintrag.room);
  if (!vorbereitet) {
    sendWatchpartyLive({ active: true, live: true, key: eintrag.key, title: eintrag.title, syncing: false });
  }
}

// Wechselt der Host die Folge, ziehen die anderen nach - aber nur innerhalb
// derselben Serie. Wer bei einem anderen Titel steht, bleibt, wo er ist.
async function followWatchpartyEpisode(eintrag, nachricht) {
  const ziel = nachricht.url;
  if (!ziel || !watchpartyLiveAktiv(eintrag.key, eintrag.room)) return;
  if (taste.urlSchluessel(ziel) !== taste.urlSchluessel(eintrag.url)) return;

  for (const [providerId, view] of providerViews) {
    if (!isLiveView(view)) continue;
    const offen = view.webContents.getURL();
    // Nur Geraete mitnehmen, die bei derselben Serie stehen.
    if (taste.urlSchluessel(offen) !== taste.urlSchluessel(ziel)) continue;
    if (istGleicheFolge(offen, ziel)) continue;

    const provider = providers.find((item) => item.id === providerId);
    if (!provider) continue;
    // Vor dem Wechsel merken: die Navigation verlaesst das Vollbild und setzt
    // den Merker zurueck. Danach gelesen war er immer falsch - wer selbst
    // weiterschaltete, blieb im Vollbild, wer nur mitgezogen wurde, fiel
    // heraus.
    const warVollbild = isContentFullscreen;
    // Tempo, Merker und Sperren gehoeren zur alten Folge.
    executeJavaScriptInMediaFrames(view, watchpartySyncZuruecksetzenScript()).catch(() => []);
    merkeWatchpartySprung(provider.id, { position: nachricht.position });
    await navigateProvider(provider, ziel);
    scheduleProviderAutoplay(provider, view, { fullscreen: warVollbild });
    logMediaDiagnostic(provider, ziel, "watchparty", `${nachricht.from || "Host"}: Folge gewechselt`, {});
    sendWatchpartyLive({
      active: true,
      live: true,
      key: eintrag.key,
      title: eintrag.title,
      from: nachricht.from,
      action: "navigate"
    });
  }
}

// Wechselt dieses Geraet die Folge, erfahren es die anderen - sie ziehen nach,
// solange sie bei derselben Serie stehen und Live an ist.
function meldeWatchpartyFolgenwechsel(url) {
  if (!watchparty.aktiv) return;
  const key = watchpartySerieForUrl(url);
  const raum = watchpartyRaumForUrl(url);
  if (!key || !raum || !watchpartyLiveAktiv(key, raum)) return;
  // Neue Folge, neues Anhaengen: sonst wuerde der alte Merker den Abgleich
  // verhindern.
  watchpartyAngeklinkt.clear();
  watchparty.steuernMitAdresse(key, "navigate", 0, url, raum);
}

// Live laesst sich je Runde abschalten, ohne die Watchparty zu verlassen: die
// Mitgliedschaft (und damit der geteilte Fortschritt) bleibt bestehen. Der
// Merker haengt am Raum, damit man in einer Runde live sein kann und in der
// anderen nicht - auch beim selben Anime.
function liveMerker(key, room) {
  return `${String(room || "")}|${String(key || "")}`;
}

function watchpartyLiveAktiv(key, room) {
  return Boolean(key) && !watchpartyLiveAus.has(liveMerker(key, room));
}

function setWatchpartyLive(key, an, room) {
  if (!key) return;
  if (an) watchpartyLiveAus.delete(liveMerker(key, room));
  else watchpartyLiveAus.add(liveMerker(key, room));
}

// Tritt man hier live bei, gehoert das Geschaute ab jetzt zu dieser Runde:
// der Eintrag dieses Raums wird der aktive. Gibt es ihn noch nicht, entsteht
// er - der eigene, private Stand bleibt davon unberuehrt.
function uebernehmeWatchpartyRaum(key, raum) {
  const eintrag = watchpartyEintrag(key, raum);
  if (!eintrag) return;
  let favorite = lokalerWatchpartyEintrag(key, raum);
  if (!favorite) {
    const provider = providerForWatchpartyUrl(eintrag.url, eintrag.providerName);
    if (!provider) return;
    favorite = createWatchpartyFavorite(key, eintrag, eintrag.progress || {}, provider);
    if (!favorite) return;
    // Die offene Folge zaehlt, nicht der Stand aus dem Raum: man schaut ja
    // gerade hier.
    const offen = activeView?.webContents?.getURL() || "";
    if (offen && istGleicheSerie(offen, favorite.url)) {
      favorite.url = offen;
      favorite.normalizedUrl = normalizeFavoriteUrl(offen);
      const identity = episodeIdentity(offen);
      favorite.season = identity?.season || favorite.season || 0;
      favorite.episode = identity?.episode || favorite.episode || 0;
    }
    favorites.unshift(favorite);
    saveFavorites();
  }
  activeFavoriteId = favorite.id;
  sendActiveState();
}

function istGleicheSerie(links, rechts) {
  return Boolean(links) && Boolean(rechts) && taste.urlSchluessel(links) === taste.urlSchluessel(rechts);
}

// Zurueck auf den eigenen Stand: der Eintrag ohne Raum wird der aktive. Gibt
// es ihn noch nicht, wird keiner erfunden - beim Weiterschauen entsteht er
// von selbst, und zwar ohne Raum, also privat.
function setzePrivatenKontext(key, adresse) {
  const privat = lokalerWatchpartyEintrag(key, "");
  if (privat) {
    activeFavoriteId = privat.id;
  } else {
    const passend = favorites.find((favorite) => (
      !favorite.watchpartyRoom && istGleicheSerie(favorite.url, adresse)
    ));
    activeFavoriteId = passend ? passend.id : null;
  }
  sendActiveState();
}

// In welcher Runde laeuft das gerade Geoeffnete? Der aktive Eintrag sagt es -
// er wurde beim Oeffnen aus der Watchparty gesetzt. Ohne Raum ist es der
// eigene, private Stand.
function aktiverWatchpartyRaum() {
  const favorite = activeFavoriteId ? favorites.find((item) => item.id === activeFavoriteId) : null;
  return String(favorite?.watchpartyRoom || "");
}

// Alle Runden, in denen diese Seite mitlaeuft - fuer die Auswahl bei
// "Live beitreten", wenn derselbe Anime in mehreren Raeumen steht.
function watchpartyRaeumeForUrl(url) {
  return watchpartyShared
    .filter((eintrag) => eintrag.joined && taste.urlSchluessel(eintrag.url) === taste.urlSchluessel(url))
    .map((eintrag) => ({ room: eintrag.room || "", key: eintrag.key, title: eintrag.title || "" }));
}

// Die Runde, die fuer die offene Seite gilt - und zwar nur die, die auch
// wirklich geoeffnet wurde. Ueber Suche oder Adresszeile hereingekommen zaehlt
// nichts automatisch als Watchparty: dort setzt jeder Einstieg den Eintrag
// zurueck, also gilt privat, bis man oben umschaltet oder live beitritt.
function watchpartyRaumForUrl(url) {
  const moeglich = watchpartyRaeumeForUrl(url);
  if (!moeglich.length) return "";
  const aktiv = aktiverWatchpartyRaum();
  return aktiv && moeglich.some((eintrag) => eintrag.room === aktiv) ? aktiv : "";
}

// Fuehrt die Watchparty gerade genau diese Folge? Dann ist ein Ruecksprung
// gewollt und der eigene Eintrag zieht sofort mit.
function watchpartyGibtFolgeVor(url) {
  return watchpartyShared.some((eintrag) => (
    eintrag.joined && istGleicheFolge(eintrag.progress?.url || eintrag.url, url)
  ));
}

// Gesteuert wird nur, wenn wirklich dieselbe Folge laeuft. taste.urlSchluessel
// wirft Staffel und Folge weg - damit galten Folge 2 und Folge 3 als dasselbe,
// und wer in Folge 2 war, wurde von Folge 3 mitpausiert.
function istGleicheFolge(links, rechts) {
  if (!links || !rechts) return false;
  if (taste.urlSchluessel(links) !== taste.urlSchluessel(rechts)) return false;

  // YouTube kennt weder Staffel noch Folge, und der Serienschluessel ist fuer
  // jedes Video derselbe: "www.youtube.com/watch" - die Kennung steckt in der
  // Abfrage, die dort wegfaellt. Ohne diese Zeile sahen deshalb alle
  // YouTube-Videos wie dasselbe aus, und das hatte zwei Folgen. Ein
  // Videowechsel wurde als "steht ja schon dort" verworfen, statt die Runde
  // mitzunehmen. Und eine Pause an einem Video wurde bei jemandem angewendet,
  // der gerade ein voellig anderes schaute.
  //
  // Was ein YouTube-Video ausmacht, ist seine Kennung - danach wird hier
  // verglichen.
  const linksVideo = youtube.videoKennung(links);
  const rechtsVideo = youtube.videoKennung(rechts);
  if (linksVideo || rechtsVideo) {
    return Boolean(linksVideo && rechtsVideo && linksVideo.id === rechtsVideo.id);
  }

  const hier = episodeIdentity(links);
  const dort = episodeIdentity(rechts);
  // Filme und Seiten ohne Folgenangabe: die Serien-Adresse genuegt.
  if (!hier && !dort) return true;
  if (!hier || !dort) return false;
  return hier.season === dort.season && hier.episode === dort.episode;
}

// Die Serie, zu der die offene Seite gehoert - unabhaengig von der Folge.
// Danach richtet sich, ob ein Folgenwechsel uebernommen wird.
function watchpartySerieForUrl(url) {
  // Laeuft fuer diese Adresse der YouTube-Modus, gehoert sie ihm allein. Sonst
  // koennte dasselbe Video in beiden Systemen haengen: die eine Seite meldete
  // Pause als Folgen-Steuerung, die andere als Raumereignis, und beide zoegen
  // aneinander. Diese eine Zeile ist die Trennung - sie sitzt an der Stelle,
  // ueber die jede Live-Entscheidung der Serien-Watchparty geht.
  if (youtubeModusGiltFuer(url)) return "";
  const treffer = watchpartyShared.find((eintrag) => (
    eintrag.joined && taste.urlSchluessel(eintrag.url) === taste.urlSchluessel(url)
  ));
  return treffer?.key || "";
}

// Live gilt fuer die Serie, nicht fuer eine bestimmte Folge: wer Mitglied ist,
// Live anhat und irgendeine Folge dieser Serie offen hat, ist live - auch bei
// pausiertem Player. Frueher haing das an der Folge des Raum-Eintrags, weshalb
// "Live aus" stand, sobald man weiter war als der gespeicherte Stand.
function watchpartyLiveKeyForUrl(url) {
  const key = watchpartySerieForUrl(url);
  const raum = watchpartyRaumForUrl(url);
  // Ohne eindeutige Runde gibt es nichts zu steuern - erst muss klar sein,
  // welcher Watchparty man hier folgt.
  if (!raum) return "";
  return key && watchpartyLiveAktiv(key, raum) ? key : "";
}

// Eine einzige Stelle, die den Live-Zustand meldet. Sie wird bei jedem Anlass
// aufgerufen - Takt, Umschalten, Seitenwechsel, Raumaenderung, Verbindung -,
// damit die Anzeige nie hinterherhinkt.
function pushWatchpartyLiveState(url = "") {
  const adresse = url || activeView?.webContents?.getURL() || "";
  const serieKey = watchparty.aktiv ? watchpartySerieForUrl(adresse) : "";
  const key = watchparty.aktiv ? watchpartyLiveKeyForUrl(adresse) : "";
  // Welche Runden kommen fuer diese Seite in Frage, und welche gilt gerade?
  const moeglich = watchparty.aktiv ? watchpartyRaeumeForUrl(adresse) : [];
  const raum = watchparty.aktiv ? watchpartyRaumForUrl(adresse) : "";
  const eintrag = watchpartyEintrag(serieKey || key, raum);
  // Die Knoepfe gehoeren zur offenen Anbieterseite. Liegt eine eigene Ansicht
  // darueber - Startseite, Mediathek, Watchparty, Einstellungen -, ist keine
  // Seite offen und es gibt nichts zu steuern. Der Rueckgabewert bleibt davon
  // unberuehrt: die Live-Steuerung wird trotzdem eingehaengt.
  const seiteOffen = Boolean(activeView) && overlayReasons.size === 0;

  // Anwesend heisst: diese Folge ist hier wirklich zu sehen und laeuft live in
  // dieser Runde mit. Faellt eine der beiden Bedingungen weg, sofort abmelden.
  const anwesend = seiteOffen && key && raum ? { key, raum } : null;
  if (watchpartyAnwesend && (!anwesend
    || watchpartyAnwesend.key !== anwesend.key
    || watchpartyAnwesend.raum !== anwesend.raum)) {
    watchparty.verlasseStand(watchpartyAnwesend.key, watchpartyAnwesend.raum);
  }
  watchpartyAnwesend = anwesend;

  sendWatchpartyLive({
    // Sichtbar, sobald dieser Titel ueberhaupt in einer Runde laeuft - dann
    // gibt es etwas zu unterscheiden und die Anzeige sagt, was gerade gilt.
    active: seiteOffen && moeglich.length > 0,
    // Zaehlt das Geschaute gerade fuer eine Runde oder nur fuer dich?
    inParty: seiteOffen && Boolean(raum),
    live: seiteOffen && Boolean(key),
    connected: watchparty.verbunden,
    enabled: watchparty.aktiv,
    key: serieKey || key || moeglich[0]?.key || "",
    room: raum,
    // Steht derselbe Anime in mehreren Runden, muss beim Live-Beitreten
    // gefragt werden, welche gemeint ist.
    rooms: moeglich.map((item) => item.room),
    title: eintrag?.title || "",
    // Wer den Takt vorgibt, gehoert in die Anzeige - sonst weiss niemand, an
    // wem sich das Abgleichen orientiert.
    hostName: eintrag?.hostName || "",
    host: Boolean(eintrag?.hostId) && eintrag.hostId === eintrag.myId
  });
  return key;
}

// Die hoechste Bildstufe beim Hoster waehlen. Das Skript geht in alle Frames
// und findet nur dort einen Player, wo der Hoster wirklich sitzt - im Dokument
// von AniWorld gibt es keinen.
// Der Autoplay-Schalter. Anders als der Chat haengt er an keiner Runde: er
// steht in jeder Folge, auch wenn niemand mitschaut.
async function installAutoplaySchalter(view) {
  if (!isLiveView(view)) return;
  const an = settings.playback?.autoplayNextEpisode !== false;
  await executeJavaScriptInMediaFrames(view, autoplaySchalterScript(an)).catch(() => []);
}

// --- Handy als Fernbedienung -------------------------------------------------
//
// Der Rechner meldet sich beim Relay mit seinem Kopplungscode als steuerbar,
// das Handy oeffnet dort eine Seite und tippt denselben Code ein. Auf dem
// Telefon ist nichts zu installieren.
//
// Was hier steht, ist die Uebersetzung: aus einem Knopfdruck wird eine
// Handlung. Welche Knoepfe es gibt, entscheidet diese Liste - das Relay laesst
// nur feste Woerter durch, und was hier nicht steht, tut nichts.
const fernbedienung = new Fernbedienung({
  onBefehl: (befehl) => { fernBefehl(befehl).catch(() => {}); },
  onWach: () => { fernStandMelden().catch(() => {}); },
  // "Was kann ich schauen?" - die Weiterschauen-Liste dieses Rechners.
  onListe: () => { fernbedienung.listeMelden(fernListe()); },
  // Und einen davon oeffnen.
  onOeffnen: (key) => { fernOeffnen(key).catch(() => {}); },
  onStatus: (status) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("fern:state", status);
  }
});

function fernSettings() {
  return settings.fern || {};
}

function syncFern() {
  const konfiguration = fernSettings();
  fernbedienung.konfigurieren({
    enabled: konfiguration.enabled === true,
    // Dasselbe Relay wie die Watchparty und der Geraeteabgleich.
    serverUrl: settings.watchparty?.serverUrl || "",
    code: konfiguration.code || "",
    geraetId: settings.watchparty?.deviceId || ""
  });
}

// Ein Knopfdruck. Er wirkt immer auf das, was gerade vorn liegt - eine
// Fernbedienung steuert, was zu sehen ist, und nicht eine Seite, die man
// vorhin einmal offen hatte.
async function fernBefehl(befehl) {
  const provider = activeProvider();
  if (!isLiveView(activeView)) return;

  if (befehl === "vollbild") {
    await vollbildUmschalten();
    await fernStandMelden();
    return;
  }

  if (befehl === "stumm") {
    activeView.webContents.setAudioMuted(!activeView.webContents.isAudioMuted());
    await fernStandMelden();
    return;
  }

  if (befehl === "naechste") {
    if (!provider || !episodeIdentity(activeView.webContents.getURL())) return;
    // Derselbe Weg wie das Tastenkuerzel und der Knopf im Bild: die Adresse
    // wird aus denselben Regeln gerechnet, nicht geraten.
    await naechsteFolgePerTaste(provider, activeView);
    return;
  }

  if (befehl === "vorherige") {
    await vorherigeFolge(provider, activeView);
    return;
  }

  await executeJavaScriptInMediaFrames(activeView, fernMediaScript(befehl)).catch(() => []);
  // Sofort melden statt auf den naechsten Takt zu warten: fuenf Sekunden
  // Verzoegerung fuehlen sich an, als waere der Druck nicht angekommen.
  await fernStandMelden();
}

// Vollbild heisst: das Bild wird gross, nicht das Fenster.
//
// Das Fenster gross zu machen war das, was hier bisher passierte, und es ist
// nicht dasselbe: die Anbieterseite fuellt dann den Bildschirm, das Video sitzt
// aber weiter in seinem Kasten mittendrin, mit Kopfzeile und Empfehlungen
// ringsum. Gemeint ist der Knopf des Players.
//
// Deshalb wird zuerst der Player gefragt. Gelingt es, meldet die Seite
// "enter-html-full-screen", und der vorhandene Weg zieht Bildflaeche und
// Ausstieg nach - genau wie bei einem Klick auf den Knopf im Player.
//
// Nur wenn dort nichts zu holen ist - kein Video, oder der Rahmen laesst
// Vollbild nicht zu -, bleibt es beim Fenster. Das ist immer noch besser als
// eine Taste, die nichts tut.
async function vollbildUmschalten() {
  if (!isLiveView(activeView)) return false;
  const ergebnisse = await executeJavaScriptInMediaFrames(activeView, vollbildScript()).catch(() => []);
  const gelungen = (ergebnisse || []).some((eintrag) => {
    const wert = String(eintrag?.value ?? eintrag ?? "");
    return wert === "an" || wert === "aus";
  });
  if (gelungen) return true;
  if (isContentFullscreen) leaveContentFullscreen();
  else enterContentFullscreen();
  return true;
}

// requestFullscreen() verlangt eine Nutzergeste. Die bringt
// executeJavaScriptInMediaFrames mit - dafuer steht das Flag dort.
function vollbildScript() {
  return `(() => {
    if (document.fullscreenElement) {
      try {
        document.exitFullscreen();
        return "aus";
      } catch (_) {
        return "fehlgeschlagen";
      }
    }
    const medien = Array.from(document.querySelectorAll("video"))
      .filter((media) => Number(media.duration) > 0 || Number(media.readyState) > 0);
    // Das groesste sichtbare Video - auf Anbieterseiten liegen oft Vorschauen
    // in Briefmarkengroesse daneben.
    const media = medien.sort((links, rechts) => (
      (rechts.clientWidth * rechts.clientHeight) - (links.clientWidth * links.clientHeight)
    ))[0];
    if (!media) return "kein-video";
    // Lieber der Kasten des Players als das nackte Video: dort sitzt seine
    // Steuerung, und die soll im Vollbild mitkommen.
    const ziel = (media.closest && media.closest(".jwplayer, .video-js, .plyr, [data-player], .player")) || media;
    const anfordern = ziel.requestFullscreen || ziel.webkitRequestFullscreen || ziel.mozRequestFullScreen;
    if (typeof anfordern !== "function") return "nicht-moeglich";
    try {
      const versprechen = anfordern.call(ziel);
      if (versprechen && typeof versprechen.catch === "function") versprechen.catch(() => {});
      return "an";
    } catch (_) {
      return "fehlgeschlagen";
    }
  })()`;
}

// Was am Video zu tun ist. Ein Skript, weil das Video im Rahmen des Hosters
// liegt und nicht im Dokument des Anbieters.
function fernMediaScript(befehl) {
  return `(() => {
    const befehl = ${JSON.stringify(String(befehl))};
    const medien = Array.from(document.querySelectorAll("video, audio"))
      .filter((media) => Number(media.duration) > 0 && media.readyState > 0);
    const media = medien.sort((links, rechts) => rechts.duration - links.duration)[0];
    if (!media) return "kein-video";
    try {
      if (befehl === "pause") media.pause();
      else if (befehl === "abspielen") { const p = media.play(); if (p && p.catch) p.catch(() => {}); }
      else if (befehl === "umschalten") {
        if (media.paused) { const p = media.play(); if (p && p.catch) p.catch(() => {}); }
        else media.pause();
      } else if (befehl === "lauter" || befehl === "leiser") {
        const schritt = befehl === "lauter" ? 0.1 : -0.1;
        media.volume = Math.max(0, Math.min(1, Number(media.volume) + schritt));
        // Wer lauter drueckt, will hoeren - eine stumme Wiedergabe lauter zu
        // stellen waere folgenlos.
        if (befehl === "lauter") media.muted = false;
      } else if (befehl === "vor" || befehl === "zurueck") {
        const weite = befehl === "vor" ? ${FERN_VOR_S} : -${FERN_ZURUECK_S};
        // Nicht ueber das Ende hinaus: dort beendet der Player die Folge, und
        // aus einem Vorspulen wuerde ein Folgenwechsel.
        const ziel = Math.max(0, Math.min(media.duration - 5, media.currentTime + weite));
        media.currentTime = ziel;
      } else {
        return "unbekannt";
      }
      return "getan";
    } catch (_) {
      return "fehlgeschlagen";
    }
  })()`;
}

// Die Weiterschauen-Liste fuers Handy.
//
// Bis 1.34.0 ging aus ELFIX nur heraus, was gerade laeuft - die Fernbedienung
// sollte druecken koennen und nicht mitlesen. Das ist jetzt anders: wer nichts
// offen hat, soll vom Sofa aus auswaehlen koennen, und dafuer muss die Liste
// hinaus. Wer den Kopplungscode hat, sieht damit, was in "Weiterschauen" steht -
// Titel und Folge, nicht mehr. Verlauf, Mediathek und Adressen bleiben hier.
function fernListe() {
  const eintraege = [];
  for (const favorite of favorites) {
    if (String(favorite?.watchpartyRoom || "")) continue;
    if (!hasContinueProgressRecord(favorite)) continue;
    const identity = episodeIdentity(favorite.url);
    const dauer = sanitizePositiveNumber(favorite.duration);
    const stelle = sanitizePositiveNumber(favorite.currentTime || favorite.position);
    eintraege.push({
      // Die Kennung des Eintrags, nicht die Adresse: das Handy soll keine
      // Adressen bekommen und auch keine schicken koennen.
      key: String(favorite.id || ""),
      titel: cleanBaseMediaTitle(favorite.title || "", favorite.url) || favorite.title || "",
      folge: identity
        ? (identity.season > 0 ? `S${identity.season} · F${identity.episode}` : `Folge ${identity.episode}`)
        : "",
      anteil: dauer > 0 && stelle > 0 ? Math.round((stelle / dauer) * 100) : sanitizeProgress(favorite.progress)
    });
    if (eintraege.length >= 40) break;
  }
  return eintraege;
}

// Einen Eintrag aus der Liste oeffnen - und gleich losspielen. Wer vom Sofa aus
// waehlt, will nicht danach noch aufstehen und auf Play druecken.
async function fernOeffnen(key) {
  const favorite = favorites.find((eintrag) => eintrag.id === String(key || ""));
  if (!favorite) return;
  console.log(`[ELFIX FERN] ${favorite.title} vom Handy geoeffnet`);
  await favoritOeffnen(favorite.id, { autoplay: true, fullscreen: false });
  await fernStandMelden();
}

// Eine Folge zurueck. Die naechste rechnet ELFIX aus den Regeln der Serie; hier
// genuegt die Folge davor in derselben Staffel - was davor liegt, ist immer
// schon dagewesen.
async function vorherigeFolge(provider, view) {
  if (!provider || !isLiveView(view)) return;
  const url = view.webContents.getURL();
  const identity = episodeIdentity(url);
  if (!identity || identity.episode <= 1) {
    sendToast("Das ist schon die erste Folge");
    return;
  }
  const ziel = replaceEpisodeUrl(url, identity.season, identity.episode - 1);
  if (!ziel || ziel === url) return;
  await beginAutostart(provider.id, naechsteFolgeLabel(provider, ziel), { snapshot: false });
  await navigateProvider(provider, ziel);
  scheduleProviderAutoplay(provider, activeView, { fullscreen: false, expectUrl: ziel, durationMs: 45000 });
}

// Was gerade laeuft, in einer Zeile. Sie geht nur hinaus, wenn sie sich
// geaendert hat - darum kuemmert sich das Modul.
async function fernStandMelden() {
  if (!fernbedienung.aktiv || !fernbedienung.verbunden) return;
  if (!isLiveView(activeView)) {
    fernbedienung.standMelden({ titel: "", folge: "", laeuft: false, position: 0, dauer: 0 });
    return;
  }
  const url = activeView.webContents.getURL();
  const provider = activeProvider();
  const identity = episodeIdentity(url);
  const eintrag = favorites.find((favorite) => favorite.providerId === provider?.id
    && episodeIdentity(favorite.url)?.key === identity?.key);
  const progress = await readBestMediaProgress(activeView, fernStandScript()).catch(() => null);
  fernbedienung.standMelden({
    titel: cleanBaseMediaTitle(eintrag?.title || "", url) || eintrag?.title || provider?.name || "",
    folge: identity
      ? (identity.season > 0 ? `Staffel ${identity.season} · Folge ${identity.episode}` : `Folge ${identity.episode}`)
      : "",
    laeuft: Boolean(progress && !progress.paused),
    position: progress?.currentTime || 0,
    dauer: progress?.duration || 0,
    stumm: activeView.webContents.isAudioMuted()
  });
}

function fernStandScript() {
  return `(() => {
    const medien = Array.from(document.querySelectorAll("video, audio"))
      .filter((media) => Number(media.duration) > 0);
    const media = medien.sort((links, rechts) => rechts.duration - links.duration)[0];
    if (!media) return null;
    return {
      currentTime: Number(media.currentTime) || 0,
      duration: Number(media.duration) || 0,
      paused: Boolean(media.paused)
    };
  })()`;
}

// --- Intro ueberspringen -----------------------------------------------------
//
// Die Regeln stehen in marken.js, hier steht nur, wann gelesen und geschrieben
// wird. Gelernt wird aus den eigenen Sprüngen: wer eine Serie schaut, spult das
// Intro selbst weg, jede Folge an derselben Stelle - das ist das Einzige, was
// ELFIX von einem Intro je erfahren kann.
let markenSpeicher = null;
let markenSchmutzig = false;

function loadMarken() {
  if (markenSpeicher) return markenSpeicher;
  try {
    const roh = JSON.parse(fs.readFileSync(MARKEN_FILE, "utf8"));
    markenSpeicher = roh && typeof roh.eintraege === "object" && roh.eintraege ? roh.eintraege : {};
  } catch {
    markenSpeicher = {};
  }
  return markenSpeicher;
}

function saveMarken() {
  if (!markenSchmutzig) return;
  ensureDataDir();
  try {
    fs.writeFileSync(MARKEN_FILE, JSON.stringify({ version: 1, eintraege: loadMarken() }, null, 2));
    markenSchmutzig = false;
  } catch (fehler) {
    console.log("[ELFIX MARKEN] nicht gespeichert: " + (fehler?.message || fehler));
  }
}

// Unter welchem Schluessel die Marke dieser Seite liegt: Titel und Staffel.
// Ausdruecklich der Titel und nicht die Adresse - ein Anbieterumzug soll die
// gelernten Marken nicht mitnehmen muessen.
function markenSchluesselFuer(provider, url) {
  const identity = episodeIdentity(url);
  if (!identity) return "";
  const eintrag = favorites.find((favorite) => favorite.providerId === provider?.id
    && episodeIdentity(favorite.url)?.key === identity.key);
  const titel = taste.titelSchluessel(eintrag?.title || cleanBaseMediaTitle("", url));
  return marken.schluessel(titel, identity.season);
}

function markeFuer(schluessel) {
  if (!schluessel) return null;
  return loadMarken()[schluessel]?.marke || null;
}

// Ein Sprung aus der Seite. Er wird aufgenommen, und daraus faellt - vielleicht
// - eine Marke.
function markeLernen(provider, url, von, nach) {
  const schluessel = markenSchluesselFuer(provider, url);
  if (!schluessel) return;
  const identity = episodeIdentity(url);
  const eintraege = loadMarken();
  const vorher = eintraege[schluessel] || { spruenge: [], marke: null };
  const spruenge = marken.sprungAufnehmen(vorher.spruenge, {
    folge: identity?.episode || 0,
    von,
    nach
  });
  if (spruenge === vorher.spruenge) return;

  const marke = marken.markeAus(spruenge);
  eintraege[schluessel] = { spruenge, marke };
  markenSchmutzig = true;
  saveMarken();

  const vorherBelege = vorher.marke?.belege || 0;
  if (marke && marke.belege > vorherBelege) {
    console.log(`[ELFIX MARKEN] ${schluessel}: Intro bei ${marke.von}s, ${marke.dauer}s lang (${marke.belege} Folgen)`);
    // Erst ab der zweiten Uebereinstimmung gibt es ueberhaupt etwas zu zeigen.
    if (vorherBelege === 0) sendToast("Intro gemerkt — ab der nächsten Folge steht der Knopf da");
  }
}

// Das Skript in die Seite bringen. Es laeuft im Fortschritts-Takt erneut und
// reicht dann nur die Marke nach - eingerichtet wird es genau einmal je Video.
async function installMarke(provider, view, url) {
  if (!isLiveView(view)) return;
  if (settings.playback?.introSkip === false) {
    // Ausgeschaltet heisst auch: der Knopf verschwindet sofort, nicht erst bei
    // der naechsten Folge.
    await executeJavaScriptInMediaFrames(view,
      "window.__elfixMarke && window.__elfixMarke.entfernen()").catch(() => []);
    return;
  }
  const schluessel = markenSchluesselFuer(provider, url);
  if (!schluessel) return;
  // Waehrend einer laufenden Watchparty wird nicht gelernt. Der Player wird
  // dort staendig auf den Host gezogen, und diese Sprünge sind nicht die
  // Entscheidung dessen, der hier sitzt.
  const lernen = !watchpartyLiveKeyForUrl(url);
  await executeJavaScriptInMediaFrames(view,
    marken.markenScript(markeFuer(schluessel), { lernen })).catch(() => []);
}

// --- Fassung merken ----------------------------------------------------------
//
// Die Regeln stehen in fassung.js, hier steht nur, wann gelesen, geschrieben
// und geklickt wird.
let fassungSpeicher = null;
let fassungSchmutzig = false;
// Solange hier ein Zeitpunkt steht, wartet der Autostart. Grund: die
// Anbieterseite zeigt nur die Hoster der gewaehlten Fassung - wer davor auf
// einen Hoster klickt, startet die falsche und merkt es erst am Ton.
const fassungWartet = new Map();
// Damit die Ansage einmal je Folge kommt und nicht bei jedem Lauf des Skripts.
const fassungGemeldet = new Map();
const FASSUNG_WARTE_MS = 4000;

function loadFassungen() {
  if (fassungSpeicher) return fassungSpeicher;
  try {
    const roh = JSON.parse(fs.readFileSync(FASSUNGEN_FILE, "utf8"));
    fassungSpeicher = roh && typeof roh.eintraege === "object" && roh.eintraege ? roh.eintraege : {};
  } catch {
    fassungSpeicher = {};
  }
  return fassungSpeicher;
}

function saveFassungen() {
  if (!fassungSchmutzig) return;
  ensureDataDir();
  try {
    fs.writeFileSync(FASSUNGEN_FILE, JSON.stringify({ version: 1, eintraege: loadFassungen() }, null, 2));
    fassungSchmutzig = false;
  } catch (fehler) {
    console.log("[ELFIX FASSUNG] nicht gespeichert: " + (fehler?.message || fehler));
  }
}

// Unter welchem Schluessel die Fassung dieser Seite liegt: der Titel, ohne
// Staffel. Anders als beim Intro - das kann sich ab Staffel 2 aendern, die
// Sprache, in der man eine Serie schaut, tut das nicht.
function fassungSchluesselFuer(provider, url) {
  const identity = episodeIdentity(url);
  if (!identity) return "";
  const eintrag = favorites.find((favorite) => favorite.providerId === provider?.id
    && episodeIdentity(favorite.url)?.key === identity.key);
  return taste.titelSchluessel(eintrag?.title || cleanBaseMediaTitle("", url));
}

// Eine Meldung aus der Seite. "stand" ist die Vorgabe des Anbieters und zaehlt
// nur, solange nichts bekannt ist; "wahl" ist ein Klick und gilt immer.
function fassungMelden(provider, url, art, neueFassung) {
  if (settings.playback?.rememberLanguage === false) return;
  const schluessel = fassungSchluesselFuer(provider, url);
  if (!schluessel) return;
  const vorher = fassung.lesen(loadFassungen(), schluessel);
  const nachher = fassung.merken(loadFassungen(), schluessel, neueFassung, { nurWennNeu: art === "stand" });
  if (nachher === fassungSpeicher) return;
  fassungSpeicher = nachher;
  fassungSchmutzig = true;
  saveFassungen();

  const jetzt = fassung.lesen(fassungSpeicher, schluessel);
  console.log(`[ELFIX FASSUNG] ${schluessel}: ${jetzt?.name || jetzt?.roh || "?"} gemerkt (${art})`);
  // Beim ersten Mal ist nichts geschehen, was eine Ansage rechtfertigt - die
  // Folge laeuft ja genau so, wie sie dasteht. Erst ein Wechsel ist eine
  // Entscheidung, von der man wissen will, dass sie gemerkt wurde.
  if (art === "wahl" && vorher && !fassung.gleich(vorher, jetzt) && jetzt?.name) {
    sendToast(`${jetzt.name} gemerkt — ab der nächsten Folge steht sie vorgewählt`);
  }
}

// Die gemerkte Fassung anklicken, bevor der Autostart nach einem Hoster sucht.
async function installFassung(provider, view, url, optionen = {}) {
  if (!isLiveView(view)) return "";
  if (settings.playback?.rememberLanguage === false) return "";
  const schluessel = fassungSchluesselFuer(provider, url);
  if (!schluessel) return "";
  const gewuenscht = fassung.lesen(loadFassungen(), schluessel);
  // Die Sperre muss stehen, bevor irgendetwas darauf wartet - und nur dann,
  // wenn ueberhaupt etwas umzustellen ist. Ohne gemerkte Fassung gibt es
  // nichts zu verzoegern.
  if (gewuenscht && !optionen.nachlauf) fassungWartet.set(provider.id, Date.now() + FASSUNG_WARTE_MS);

  const ergebnisse = await executeJavaScriptInMediaFrames(view, fassung.fassungScript(gewuenscht)).catch(() => []);
  const antwort = (Array.isArray(ergebnisse) ? ergebnisse : [])
    .map((eintrag) => String(eintrag?.value ?? eintrag ?? ""))
    .find((wert) => wert) || "";

  // "geklickt" heisst: gedrueckt, aber die Seite hat noch nicht umgeschaltet.
  // Dann bleibt die Sperre stehen, bis der zweite Lauf sie aufloest oder die
  // Zeit ablaeuft - ein Hoster, der jetzt geklickt wird, waere der falsche.
  if (!antwort.startsWith("geklickt")) fassungWartet.delete(provider.id);

  if (antwort.startsWith("gewechselt") && fassungGemeldet.get(provider.id) !== url) {
    fassungGemeldet.set(provider.id, url);
    console.log(`[ELFIX FASSUNG] ${schluessel}: ${gewuenscht?.name || gewuenscht?.roh} vorgewaehlt`);
    if (gewuenscht?.name) sendToast(`${gewuenscht.name} vorgewählt`);
  }
  return antwort;
}

async function installHosterQualitaet(view) {
  if (!isLiveView(view)) return;
  await executeJavaScriptInMediaFrames(view, voeQualitaet.qualitaetScript()).catch(() => []);
}

async function installWatchpartyControls(provider, view, url) {
  const key = pushWatchpartyLiveState(url);
  if (!key) return;
  const raum = watchpartyRaumForUrl(url);
  if (!raum) return;

  await executeJavaScriptInMediaFrames(view, watchpartyControlScript()).catch(() => []);
  await executeJavaScriptInMediaFrames(view, watchpartyLeisteScript()).catch(() => []);
  // Bei jedem Betreten dieser Folge den Stand des Hosts holen - auch wenn man
  // schon einmal drin war. Der Merker gilt nur fuer den laufenden Aufenthalt
  // und wird beim Verlassen der Seite geloescht.
  if (!watchpartyAngeklinkt.has(raum + key + url)) {
    watchpartyAngeklinkt.add(raum + key + url);
    watchparty.abgleichen(key, raum);
  }
}

// Aus einer Steuernachricht wird ein Ereignis, mit dem der Player rechnen kann:
// Stelle, Zeitpunkt, Laufzustand - und der gemessene Uhrversatz zu dem Relay,
// aus dem die Nachricht kam.
//
// `hatUhr` ist die Notbremse. Ohne belastbare Messung wird nicht hochgerechnet,
// sondern die Stelle genommen, wie sie kommt. Genau das war frueher der Fehler:
// gerechnet wurde mit Date.now() minus dem Zeitstempel des Relays, also aus
// zwei verschiedenen Uhren, und ging die eigene vor, landete jeder Sprung um
// diese Differenz zu weit vorn.
function watchpartyEreignis(nachricht, laeuft) {
  const raum = nachricht.room || aktiverWatchpartyRaum();
  const serverJetzt = watchparty.serverJetzt(raum);
  const stand = watchparty.uhrStand(raum);
  return {
    videoTime: Number(nachricht.videoTime ?? nachricht.position) || 0,
    timestamp: Number(nachricht.timestamp ?? nachricht.at) || 0,
    playing: Boolean(laeuft),
    hatUhr: serverJetzt != null,
    versatz: stand ? stand.versatz : 0
  };
}

// Meint diese Nachricht die Folge, die hier offen ist? Ein aelteres Relay
// schickt die Angabe nicht mit - dann bleibt es bei der Pruefung ueber die
// Adresse, die es schon immer gab.
function watchpartyPasstZurFolge(episodeId, url) {
  const gemeint = String(episodeId || "");
  if (!gemeint) return true;
  const hier = episodeIdentity(url);
  if (!hier) return true;
  return gemeint === `s${Number(hier.season) || 0}e${Number(hier.episode) || 0}`;
}

// Laeuft das Video an der Quelle nach diesem Ereignis weiter? Nur dann wird die
// Laufzeit der Nachricht auf die Stelle aufgeschlagen. Ein aelteres Relay
// schickt das Feld nicht mit - dann entscheidet die Aktion.
function watchpartyLaeuftDanach(nachricht) {
  if (typeof nachricht.playing === "boolean") return nachricht.playing;
  if (nachricht.action === "hostzeit") return nachricht.hostPlaying !== false;
  return nachricht.action === "play" || nachricht.action === "syncstart";
}

async function applyWatchpartyControl(nachricht) {
  // Nur die Runde steuert, in der dieses Geraet gerade schaut. Sonst wuerde
  // eine Pause aus der einen Watchparty die andere mit anhalten, obwohl dort
  // derselbe Anime nur zufaellig auch laeuft.
  const aktiv = aktiverWatchpartyRaum();
  if (!aktiv || (nachricht.room && nachricht.room !== aktiv)) return;
  const eintrag = watchpartyEintrag(nachricht.key, nachricht.room || aktiv);
  if (!eintrag) return;

  // Nachrichten koennen sich unterwegs ueberholen. Ein verspaetetes Play darf
  // nicht nach einem neueren Pause angewendet werden - sonst laeuft ein Geraet
  // weiter, das alle anderen laengst angehalten haben.
  const merker = `${nachricht.room || aktiv}|${nachricht.key}`;
  if (watchpartySync.istVeraltet(watchpartyLetztesEreignis.get(merker), nachricht)) {
    console.log(`[watchparty-sync] {"action":"stale","ignored":"${nachricht.action}"}`);
    return;
  }
  watchpartyLetztesEreignis.set(merker, {
    sequenceId: Number(nachricht.sequenceId) || 0,
    timestamp: Number(nachricht.timestamp ?? nachricht.at) || 0,
    episodeId: String(nachricht.episodeId || "")
  });

  // Bin ich der Host, gilt meine Stelle - ich ruecke nicht, die anderen kommen
  // zu mir. Pause und Weiter mache ich mit, damit ich nicht davonlaufe.
  const binHost = Boolean(eintrag.hostId) && eintrag.hostId === eintrag.myId;

  // Wechselt der Host die Folge, ziehen die anderen nach - aber nur innerhalb
  // derselben Serie, damit niemand ungefragt woanders landet.
  if (nachricht.action === "navigate" && nachricht.url) {
    await followWatchpartyEpisode(eintrag, nachricht);
    return;
  }

  // Gemeinsam gleichziehen: anhalten, auf dieselbe Stelle, Bereitmeldung.
  if (nachricht.action === "syncprepare") {
    await prepareWatchpartySync(eintrag, nachricht);
    return;
  }
  if (nachricht.action === "syncstart") {
    sendWatchpartyLive({ active: true, live: true, key: eintrag.key, title: eintrag.title, syncing: false });
  }

  const ereignis = watchpartyEreignis(nachricht, watchpartyLaeuftDanach(nachricht));
  // Pause, gezielter Sprung, Abgleich und gemeinsamer Start muessen sitzen.
  // Nur beim beilaeufigen "der andere spielt weiter" darf es ungefaehr sein.
  const genau = nachricht.action !== "play" || Boolean(nachricht.resync);

  // Die laufende Messung. Sie ist keine Korrektur - der Player entscheidet
  // selbst, ob daraus etwas folgt, und meistens folgt nichts.
  if (nachricht.action === "hostzeit") {
    // Der Host ist die Zeitquelle und wird nie nachgeregelt.
    if (binHost) return;
    // Und eine Messung von einem Host, der es nicht mehr ist, geht ins Leere:
    // sie beschreibt eine Runde, die es so nicht mehr gibt.
    if (nachricht.hostId && eintrag.hostId && nachricht.hostId !== eintrag.hostId) return;
    for (const [, view] of providerViews) {
      if (!isLiveView(view)) continue;
      const offen = view.webContents.getURL();
      if (!istGleicheFolge(nachricht.url || eintrag.live?.url || eintrag.url, offen)) continue;
      if (!watchpartyPasstZurFolge(nachricht.episodeId, offen)) continue;
      await executeJavaScriptInMediaFrames(
        view,
        watchpartyDriftScript(ereignis)
      ).catch(() => []);
    }
    return;
  }

  // Nur anwenden, wo genau dieselbe Folge offen ist - nicht bloss dieselbe
  // Serie. Wer eine Folge zurueckliegt, soll nicht mitpausiert werden.
  for (const [providerId, view] of providerViews) {
    if (!isLiveView(view)) continue;
    const offen = view.webContents.getURL();
    // Die Adresse des Absenders zaehlt. Danach kommt der laufende Stand der
    // Runde - beides folgt der aktuellen Folge. Der gebuchte Fortschritt stand
    // frueher an zweiter Stelle und war die aelteste Angabe von allen: nach
    // einem Folgenwechsel zeigte er noch minutenlang auf die Folge davor, und
    // damit fiel jede Pause durch diese Pruefung.
    if (!istGleicheFolge(nachricht.url || eintrag.live?.url || eintrag.url, offen)) continue;
    // Und derselbe Riegel noch einmal ueber die Folgenangabe der Nachricht.
    // Die Adresse allein reicht nicht: ein Ereignis der vorigen Folge kann
    // dieselbe Serien-Adresse tragen, wenn der Absender inzwischen gewechselt
    // hat und das Relay die alte Runden-Adresse mitschickt.
    if (!watchpartyPasstZurFolge(nachricht.episodeId, offen)) continue;
    const provider = providers.find((item) => item.id === providerId);
    // Das Ereignis geht als Ganzes in den Player: dort wird die Zielzeit
    // ausgerechnet, und zwar noch einmal unmittelbar vor dem Start. Nur so
    // zaehlt auch die Zeit mit, die das Puffern gekostet hat.
    await executeJavaScriptInMediaFrames(
      view,
      watchpartyApplyScript(nachricht.action, ereignis, { genau, nichtSpringen: binHost })
    ).catch(() => []);
    if (provider) {
      logMediaDiagnostic(provider, offen, "watchparty", `${nachricht.from || "Jemand"}: ${nachricht.action}`, {});
    }
    sendWatchpartyLive({
      active: true,
      live: true,
      connected: watchparty.verbunden,
      key: nachricht.key,
      title: eintrag.title,
      hostName: eintrag.hostName || "",
      host: Boolean(eintrag.hostId) && eintrag.hostId === eintrag.myId,
      from: nachricht.from,
      action: nachricht.action
    });
  }
}

// Die Oberflaeche zeigt an, wer gerade steuert.
function sendWatchpartyLive(info) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("watchparty:live", info);
}

// Der Stand je Geraet fuer die Leiste in der Kopfzeile: nur weiterreichen, was
// zu der Runde gehoert, in der hier gerade geschaut wird. Sonst zeigte die
// Leiste die Sekunden einer Watchparty, die man gar nicht offen hat.
function sendWatchpartyWatchstate(nachricht) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const adresse = activeView?.webContents?.getURL() || "";
  const raum = watchpartyRaumForUrl(adresse);
  // Gilt diese Meldung der Seite, die gerade offen ist? Nur dann gehoert sie
  // in die Kopfzeile und in den Player. In die Karten gehoert sie immer -
  // dort will man sehen, wer bei welchem Titel gerade mitschaut. Vorher wurde
  // alles verworfen, was nicht zur offenen Seite passte, und die Karten
  // blieben stumm.
  const istOffen = Boolean(raum)
    && (!nachricht.room || nachricht.room === raum)
    && watchpartySerieForUrl(adresse) === nachricht.key;

  const hier = istOffen ? episodeIdentity(adresse) : null;
  const mitglieder = (nachricht.members || []).map((mitglied) => ({
    id: String(mitglied.id || ""),
    name: String(mitglied.name || "Gerät"),
    position: sanitizePositiveNumber(mitglied.position),
    paused: Boolean(mitglied.paused),
    host: Boolean(mitglied.host),
    season: sanitizePositiveNumber(mitglied.season),
    episode: sanitizePositiveNumber(mitglied.episode),
    // Wie alt die Meldung ist, in Sekunden. Die Zahl kommt fertig vom Relay
    // und wird hier nicht nachgerechnet: sonst mischten sich zwei Uhren, und
    // jede Abweichung zwischen Rechner und Relay stuende in der Anzeige.
    age: Math.max(0, Number(mitglied.age) || 0),
    me: String(mitglied.id || "") === watchparty.geraetId
  }));

  // Dieselben Angaben dreifach: Kopfzeile, Player und Karten.
  if (istOffen) zeigeLeisteImPlayer(mitglieder);
  mainWindow.webContents.send("watchparty:watchstate", {
    key: nachricht.key,
    room: nachricht.room || raum || "",
    offen: istOffen,
    // Wer zuletzt gedrueckt hat - getrennt davon, wer gerade angehalten ist.
    pausedBy: String(nachricht.pausedBy || ""),
    lastAction: nachricht.lastAction || null,
    season: hier?.season || 0,
    episode: hier?.episode || 0,
    members: mitglieder
  });
}

// Die Leiste im Player befuellen. Allein schaut man niemandem zu - dann bleibt
// sie leer und damit unsichtbar.
function zeigeLeisteImPlayer(mitglieder) {
  if (!isLiveView(activeView)) return;
  const leute = mitglieder.length > 1
    ? mitglieder.map((mitglied) => ({
      name: mitglied.me ? "Du" : mitglied.name,
      paused: mitglied.paused,
      host: mitglied.host,
      me: mitglied.me,
      zeit: formatUhr(mitglied.position + (mitglied.paused ? 0 : mitglied.age))
    }))
    : [];
  const script = `window.__elfixWpLeiste && window.__elfixWpLeiste(${JSON.stringify(leute)})`;
  executeJavaScriptInMediaFrames(activeView, script).catch(() => []);
}

// Sekunden als Uhrzeit - dieselbe Schreibweise wie in der Oberflaeche.
function formatUhr(sekunden) {
  const gesamt = Math.max(0, Math.round(Number(sekunden) || 0));
  const stunden = Math.floor(gesamt / 3600);
  const minuten = Math.floor((gesamt % 3600) / 60);
  const rest = gesamt % 60;
  const zwei = (wert) => String(wert).padStart(2, "0");
  return stunden > 0 ? `${stunden}:${zwei(minuten)}:${zwei(rest)}` : `${minuten}:${zwei(rest)}`;
}

// Die Sitzung des gerade laufenden Players. Fehlt sie noch, entsteht sie hier.
function watchpartySitzungFuer(providerId) {
  if (!watchpartySitzung.has(providerId)) watchpartySitzung.set(providerId, crypto.randomUUID());
  return watchpartySitzung.get(providerId);
}

// Der Weg, den es im Normalfall geht: die Seite meldet von selbst, sobald sich
// etwas tut. Kein Zeitgeber, kein Abfragen aller Frames - und damit ohne die
// Verzoegerung, die eine Umfrage zwangslaeufig hat.
function meldeWatchpartyStandAusSeite(view, position, pausiert) {
  if (!watchparty.aktiv || !isLiveView(view) || view !== activeView) return;
  // Liegt die Startseite oder eine andere Ansicht darueber, schaut hier
  // niemand mehr zu - dann gehoert dieses Geraet auch nicht in die Leiste.
  if (overlayReasons.size > 0) return;
  const adresse = view.webContents.getURL();
  const key = watchpartyLiveKeyForUrl(adresse);
  const raum = watchpartyRaumForUrl(adresse);
  if (!key || !raum) return;

  const identity = episodeIdentity(adresse);
  watchparty.meldeStand(key, {
    position: Number(position) || 0,
    paused: Boolean(pausiert),
    url: adresse,
    season: identity?.season || 0,
    episode: identity?.episode || 0,
    playerSessionId: watchpartySitzungFuer(webContentsProvider.get(view.webContents.id) || "")
  }, raum);
}

// Rueckfallebene fuer Seiten, auf denen sich das Melde-Skript nicht einhaengen
// konnte - etwa weil der Player erst spaeter erscheint. Laeuft in grossem
// Abstand; im Normalfall hat die Seite laengst selbst gemeldet.
async function meldeWatchpartyStand() {
  if (!watchparty.aktiv || !watchparty.verbunden) return;
  if (overlayReasons.size > 0) return;
  const view = activeView;
  if (!isLiveView(view)) return;
  const adresse = view.webContents.getURL();
  const key = watchpartyLiveKeyForUrl(adresse);
  const raum = watchpartyRaumForUrl(adresse);
  if (!key || !raum) return;

  const proben = await executeJavaScriptInMediaFrames(view, `(() => {
    const medien = Array.from(document.querySelectorAll("video")).filter((m) => Number(m.duration) > 0);
    const media = medien.sort((links, rechts) => rechts.duration - links.duration)[0];
    if (!media) return null;
    return { position: Number(media.currentTime) || 0, paused: Boolean(media.paused) };
  })()`).catch(() => []);

  const stand = (proben || [])
    .map((probe) => (probe && typeof probe === "object" && "value" in probe ? probe.value : probe))
    .find((probe) => probe && typeof probe === "object" && Number.isFinite(Number(probe.position)));
  if (!stand) return;

  const identity = episodeIdentity(adresse);
  watchparty.meldeStand(key, {
    position: Number(stand.position) || 0,
    paused: Boolean(stand.paused),
    url: adresse,
    season: identity?.season || 0,
    episode: identity?.episode || 0,
    playerSessionId: watchpartySitzungFuer(webContentsProvider.get(view.webContents.id) || "")
  }, raum);
}

// Ein offener Sprungwunsch je Anbieter. Er wird eingeloest, sobald tatsaechlich
// ein Video laeuft - vorher laesst sich die Stelle nicht setzen.
// Mit welcher Adresse ein Eintrag aus "Weiterschauen" geoeffnet wird.
//
// Fuer alle bisherigen Anbieter ist das unveraendert die gespeicherte Adresse:
// dort ist eine Folge eine Seite, und der Hoster erinnert sich selbst, wo man
// war. Nur YouTube kennt kein "diese Folge", sondern ein stundenlanges Video -
// dort bekommt die Adresse die Sekunde mit, an der es weitergehen soll.
//
// Zusaetzlich wird fuer YouTube der Nachsprung im Player vorgemerkt. YouTube
// ignoriert "t" gelegentlich, etwa wenn es selbst einen Stand gespeichert hat;
// dann zieht dieselbe Mechanik nach, die auch eine Watchparty an die geteilte
// Stelle bringt.
function oeffnenAdresse(provider, favorite) {
  const adresse = String(favorite?.url || "");
  if (!youtube.istYoutubeUrl(adresse)) return adresse;

  const stand = sanitizePositiveNumber(favorite?.currentTime || favorite?.position);
  const dauer = sanitizePositiveNumber(favorite?.duration);
  const ziel = youtube.fortsetzenUrl(adresse, stand, dauer);

  if (youtube.brauchtNachsprung(stand, dauer)) {
    merkeWatchpartySprung(provider.id, { position: stand });
    console.log(`[ELFIX YOUTUBE] weiter bei ${Math.floor(stand)}s: ${ziel}`);
  }
  return ziel;
}

// Merkt vor, dass nach dem Start einmal an eine Stelle gesprungen wird.
// Urspruenglich nur fuer die Watchparty gebaut, inzwischen auch der Weg, auf
// dem YouTube seinen Stand zurueckbekommt - die Mechanik ist dieselbe.
function merkeWatchpartySprung(providerId, fortschritt) {
  const ziel = sanitizePositiveNumber(fortschritt?.position);
  if (!providerId || ziel < 5) return;
  watchpartySprung.set(providerId, { position: ziel, at: Date.now() });
}

// Wurde eine Watchparty-Folge geoeffnet, wird einmal an die geteilte Stelle
// gesprungen. Groessere Abweichungen kommen vor, weil der Hoster selbst einen
// Stand speichert; kleine ignorieren wir, sonst ruckelt es nur.
async function applyWatchpartySeek(provider, view, progress) {
  const wunsch = watchpartySprung.get(provider.id);
  if (!wunsch) return;
  if (Date.now() - wunsch.at > WATCHPARTY_SPRUNG_GUELTIG_MS) {
    watchpartySprung.delete(provider.id);
    return;
  }
  if (!progress?.duration || progress.duration <= 0) return;
  if (Math.abs(Number(progress.currentTime || 0) - wunsch.position) <= 8) {
    watchpartySprung.delete(provider.id);
    return;
  }

  const script = `(() => {
    const ziel = ${wunsch.position};
    const videos = Array.from(document.querySelectorAll("video"))
      .filter((media) => Number(media.duration) > 0 && media.readyState > 1);
    const media = videos.sort((links, rechts) => rechts.duration - links.duration)[0];
    if (!media) return "kein-video";
    if (ziel >= media.duration - 5) return "ausserhalb";
    try {
      media.currentTime = ziel;
      return "gesprungen";
    } catch (_) {
      return "fehlgeschlagen";
    }
  })()`;
  const ergebnisse = await executeJavaScriptInMediaFrames(view, script).catch(() => []);
  const gesprungen = (ergebnisse || []).some((eintrag) => String(eintrag?.value || eintrag) === "gesprungen");
  if (!gesprungen) return;
  watchpartySprung.delete(provider.id);
  logMediaDiagnostic(provider, view.webContents.getURL(), "watchparty", `an ${Math.round(wunsch.position)}s gesprungen`, {});
}

// --- YouTube-Watchparty ------------------------------------------------------
//
// Ein eigener Modus, und zwar von Grund auf. Die Watchparty fuer Serien dreht
// sich um einen Titel: jemand stellt eine Serie ein, andere treten ihr bei, und
// wer etwas anderes oeffnet, ist draussen. Bei YouTube waere das falsch herum
// gedacht - dort ist nicht ein Video die Runde, sondern die Sitzung. Man klickt
// sich durch Empfehlungen, Suche und "Naechstes Video", und genau dieses
// Weiterklicken sollen alle mitmachen.
//
// Deshalb liegt die Wahrheit hier nicht bei einem Host, sondern beim Relay:
// welches Video, wo, ob es laeuft. Jeder darf das bewegen, jede Bewegung
// bekommt dort eine Nummer, und alle richten sich nach der zuletzt vergebenen.
//
// Geteilt wird ausschliesslich die gemeinsame Mediennavigation und Wiedergabe.
// Lautstaerke, Stumm, Vollbild, Fenstergroesse, Scrollstand, Untertitel und
// alles, was sonst am Geraet haengt, bleibt hier - es geht nirgends hinaus und
// kommt nirgendwo an.

// So oft wird nachgesehen, ob dieses Geraet noch bei der Runde steht. Bewusst
// traege: korrigiert wird erst ab 2,5 Sekunden und zweimal bestaetigt.
const YOUTUBE_ABGLEICH_TAKT_MS = 2000;
// So lange gilt ein Videowechsel, den die Runde ausgeloest hat, als erwartet.
// Meldet die Seite genau dieses Video als geoeffnet, ist das das Echo des
// Mitziehens und kein neuer Wunsch.
const YOUTUBE_ERWARTET_MS = 20000;
// Nach dem Laden einer Seite braucht YouTube einen Moment, bis ein Video mit
// Laufzeit dasteht. Deshalb wird der Raumzustand mehrfach nachgereicht statt
// einmal auf gut Glueck.
const YOUTUBE_NACHZIEHEN_MS = [1200, 3000, 6500];

// Das Video, auf das dieses Geraet gerade gezogen wird.
let youtubeErwartet = null;

const youtubeParty = new YoutubeWatchparty({
  senden: (raum, nachricht) => watchparty.youtubeSenden(raum, nachricht),
  // Der gemessene Uhrversatz kommt aus der Verbindung, die beide Modi teilen.
  // Ohne ihn waere jede Hochrechnung "wo steht die Runde jetzt?" um die
  // Differenz zweier Systemuhren daneben.
  serverJetzt: (raum) => watchparty.serverJetzt(raum),
  onState: (zustand, hinweis) => { applyYoutubeParty(zustand, hinweis).catch(() => {}); },
  onStatus: (status) => sendYoutubePartyState(status)
});

// Welcher Raum fuehrt die YouTube-Runde? Genau einer, und nur solange die
// Watchparty ueberhaupt laeuft und diesen Raum kennt.
function youtubePartySync() {
  const konfiguration = watchpartySettings();
  youtubeParty.kennung(watchparty.geraetId || konfiguration.deviceId || "");
  const gewuenscht = String(konfiguration.youtubeRoom || "").trim();
  const raum = (watchparty.status().rooms || []).find((eintrag) => eintrag.room === gewuenscht);
  if (!watchparty.aktiv || !gewuenscht || !raum) {
    youtubeParty.ausschalten();
    return;
  }
  youtubeParty.einschalten(gewuenscht);
  youtubeParty.verbindung(gewuenscht, Boolean(raum.connected));
}

// Die Anbieteransicht, in der YouTube laeuft. Gibt es sie noch nicht - weil
// YouTube in dieser Sitzung nie offen war -, gibt es auch nichts zu steuern:
// beim ersten Oeffnen haengt sich die Runde von selbst an.
function youtubeAnsicht() {
  const provider = enabledProviders().find((eintrag) => youtube.istYoutubeUrl(eintrag.startUrl));
  if (!provider) return null;
  const view = providerViews.get(provider.id);
  return isLiveView(view) ? { provider, view } : null;
}

function youtubeVideoIdAus(url) {
  return youtube.videoKennung(url)?.id || "";
}

// Gehoert diese Adresse dem YouTube-Modus? Diese Frage entscheidet zugleich,
// dass die Watchparty fuer Serien hier nichts zu suchen hat - siehe
// watchpartySerieForUrl.
function youtubeModusGiltFuer(url) {
  return youtubeParty.aktiv && Boolean(youtubeVideoIdAus(url));
}

// "Titel - YouTube" ist der Seitentitel, nicht der des Videos.
function youtubeVideotitel(view) {
  const roh = String(view?.webContents?.getTitle?.() || "").trim();
  return roh.replace(/\s*[-–—]\s*YouTube\s*$/i, "").slice(0, 200);
}

// --- Was hier passiert, erfahren die anderen ---------------------------------

// Play, Pause und Sprung aus dem eigenen Player. Der Echoschutz sitzt in der
// Seite (siehe youtube-sync.js): was gerade auf Anweisung von aussen geschehen
// ist, kommt hier gar nicht erst an.
function meldeYoutubeAktion(view, aktion, position, pausiert) {
  if (!youtubeParty.aktiv) return;
  const ziel = youtubeAnsicht();
  if (!ziel || ziel.view !== view) return;
  const adresse = view.webContents.getURL();
  const videoId = youtubeVideoIdAus(adresse);
  if (!videoId) return;

  const daten = {
    videoId,
    url: youtube.normalisiereYoutubeUrl(adresse) || adresse,
    position,
    title: youtubeVideotitel(view)
  };
  // Beim Spulen gehoert der Laufzustand dazu: YouTube haelt dabei gelegentlich
  // an, und ohne diese Angabe stuende die Runde danach falsch.
  if (aktion === "seek") daten.playing = !pausiert;
  youtubeParty.melden(aktion, daten);
}

// Ein anderes Video. Das ist der wichtigste Unterschied zur Watchparty fuer
// Serien: die Runde endet dadurch nicht, das neue Video wird ihr Video.
//
// Der Weg dorthin ist egal - Empfehlung, Suchtreffer, Kanal, Playlist oder das
// automatisch folgende naechste Video. YouTube wechselt dabei meist ohne
// Neuladen, deshalb haengt das hier an beiden Navigationsereignissen.
async function meldeYoutubeVideowechsel(view, url) {
  if (!youtubeParty.aktiv) return;
  const ziel = youtubeAnsicht();
  if (!ziel || ziel.view !== view) return;
  const videoId = youtubeVideoIdAus(url);
  if (!videoId) return;

  // Das Echo des eigenen Mitziehens. Ohne diese Sperre meldete jedes Geraet das
  // Video, auf das es gerade gezogen wurde, als eigenen Wunsch zurueck.
  if (youtubeErwartet && youtubeErwartet.videoId === videoId && Date.now() < youtubeErwartet.bis) {
    youtubeErwartet = null;
    await executeJavaScriptInMediaFrames(view, youtubeSync.zuruecksetzenScript()).catch(() => []);
    youtubeNachziehenPlanen();
    return;
  }
  // Schon das Video der Runde - dann gibt es nichts zu wechseln. Das Relay
  // wiese es ohnehin ab; hier bleibt dafuer die Nachricht gleich ganz aus.
  if (youtubeParty.stand?.videoId === videoId) return;

  // Neues Video, neue Rechnung: bestaetigte Messungen und Merker gehoeren zum
  // Video davor.
  await executeJavaScriptInMediaFrames(view, youtubeSync.zuruecksetzenScript()).catch(() => []);
  const gemeldet = youtubeParty.melden("video", {
    videoId,
    url: youtube.normalisiereYoutubeUrl(url) || url,
    // Wer mit Startzeit einsteigt, laesst die Runde dort einsteigen.
    position: youtube.startSekunde(url),
    title: youtubeVideotitel(view)
  });
  if (gemeldet) {
    logMediaDiagnostic(ziel.provider, url, "youtube-party", "Video an die Runde gemeldet", {});
  }
}

// --- Was die anderen tun, passiert hier ebenfalls ----------------------------

// Ein neuer Raumzustand. Ob daraus ueberhaupt etwas folgt, hat die
// YoutubeWatchparty schon entschieden: der eigene Zug kommt nur zurueck, damit
// dieses Geraet seine Nummer erfaehrt, und derselbe Stand ein zweites Mal ist
// kein Anlass, im Bild herumzuspringen.
async function applyYoutubeParty(zustand, hinweis) {
  if (!youtubeParty.aktiv || !zustand?.videoId || !hinweis?.anwenden) return;

  const ziel = youtubeAnsicht();
  // YouTube war in dieser Sitzung nie offen. Dann wird nichts erzwungen - beim
  // Oeffnen haengt sich die Runde von selbst an (installYoutubePartyControls).
  if (!ziel) return;

  const offen = ziel.view.webContents.getURL();
  if (youtubeVideoIdAus(offen) !== zustand.videoId) {
    await oeffneYoutubeVideo(ziel, zustand, hinweis.action || "video");
    return;
  }

  await executeJavaScriptInMediaFrames(
    ziel.view,
    youtubeSync.anwendenScript(zustand, { aktion: hinweis.action || "state", versatz: zustand.versatz })
  ).catch(() => []);
  logMediaDiagnostic(ziel.provider, offen, "youtube-party",
    `${zustand.byName || "Jemand"}: ${hinweis.action || "Stand"}`, {});
}

// Das Video der Runde oeffnen.
//
// Die Startsekunde wandert in die Adresse. Das ist deutlich verlaesslicher, als
// nach dem Laden im Player herumzuspringen: YouTube startet dann von sich aus
// an der richtigen Stelle, ohne dass etwas sichtbar zurueckspult.
//
// Wer YouTube gerade vorn hat, wechselt ueber den normalen Weg der App - mit
// Autoplay und Vollbild, wie bei einem Klick. Wer gerade woanders ist, bekommt
// die Seite still im Hintergrund geladen: die Runde soll niemanden aus dem
// herausreissen, was er sich gerade ansieht.
async function oeffneYoutubeVideo({ provider, view }, zustand, grund) {
  const sekunde = Math.max(0, Math.floor(
    youtubeSync.zielPosition(zustand, Date.now() + (zustand.versatz || 0))
  ));
  const basis = zustand.url || `https://www.youtube.com/watch?v=${zustand.videoId}`;
  const adresse = youtube.fortsetzenUrl(basis, sekunde);

  youtubeErwartet = { videoId: zustand.videoId, bis: Date.now() + YOUTUBE_ERWARTET_MS };
  await executeJavaScriptInMediaFrames(view, youtubeSync.zuruecksetzenScript()).catch(() => []);

  if (activeProviderId === provider.id) {
    const warVollbild = isContentFullscreen;
    await navigateProvider(provider, adresse);
    scheduleProviderAutoplay(provider, view, { fullscreen: warVollbild });
  } else {
    view.webContents.loadURL(adresse).catch(() => {});
  }
  logMediaDiagnostic(provider, adresse, "youtube-party",
    `${zustand.byName || "Jemand"}: Video gewechselt (${grund})`, {});
  youtubeNachziehenPlanen();
}

// Nach einem Seitenwechsel steht das Video nicht sofort bereit. Statt einmal
// auf gut Glueck wird der Raumzustand mehrfach nachgereicht - jeder Versuch
// steigt von selbst aus, sobald er nicht mehr passt.
function youtubeNachziehenPlanen() {
  for (const verzoegerung of YOUTUBE_NACHZIEHEN_MS) {
    const timer = setTimeout(() => { youtubeAnschluss("nachziehen").catch(() => {}); }, verzoegerung);
    timer.unref?.();
  }
}

// Dieses Geraet an die Runde anschliessen: richtiges Video, richtige Stelle,
// richtiger Laufzustand. Genau das braucht ein spaeter Beitretender, und genau
// das braucht auch, wer gerade wieder Verbindung bekommen hat.
async function youtubeAnschluss(grund) {
  const zustand = youtubeParty.stand;
  if (!youtubeParty.aktiv || !zustand?.videoId) return;
  const ziel = youtubeAnsicht();
  if (!ziel) return;

  const offen = ziel.view.webContents.getURL();
  if (!youtube.istYoutubeUrl(offen)) return;
  if (youtubeVideoIdAus(offen) !== zustand.videoId) {
    await oeffneYoutubeVideo(ziel, zustand, grund);
    return;
  }
  await executeJavaScriptInMediaFrames(
    ziel.view,
    youtubeSync.anwendenScript(zustand, { aktion: "state", versatz: zustand.versatz })
  ).catch(() => []);
}

// Die Notbremse, im Takt.
//
// Sie tut fast immer nichts - das ist Absicht und steht ausfuehrlich in
// youtube-sync.js. Ein bis zwei Sekunden Versatz sieht beim gemeinsamen Schauen
// niemand; jede Korrektur dagegen laesst YouTube neu puffern, und das Puffern
// erzeugt genau den Versatz, den man beheben wollte.
async function youtubeAbgleichen() {
  const zustand = youtubeParty.stand;
  if (!youtubeParty.aktiv || !youtubeParty.verbunden || !zustand?.videoId) return;
  const ziel = youtubeAnsicht();
  // Nur was hier wirklich zu sehen ist. Liegt eine eigene Ansicht darueber oder
  // ist ein anderer Anbieter vorn, schaut hier gerade niemand YouTube.
  if (!ziel || ziel.view !== activeView || overlayReasons.size > 0) return;
  if (youtubeVideoIdAus(ziel.view.webContents.getURL()) !== zustand.videoId) return;

  await executeJavaScriptInMediaFrames(
    ziel.view,
    youtubeSync.abgleichScript(zustand, { versatz: zustand.versatz })
  ).catch(() => []);
}

// Den Horcher in die Seite haengen und dieses Geraet an die Runde anschliessen.
// Laeuft bei jedem "dom-ready" - der Horcher setzt sich nur einmal, das
// Anschliessen prueft selbst, ob es noch etwas zu tun gibt.
async function installYoutubePartyControls(provider, view, url) {
  if (!youtubeParty.aktiv || !youtube.istYoutubeUrl(url)) return;
  const ziel = youtubeAnsicht();
  if (!ziel || ziel.view !== view) return;

  await executeJavaScriptInMediaFrames(view, youtubeSync.beobachterScript()).catch(() => []);
  youtubeNachziehenPlanen();
}

// Beste Qualitaet, keine Untertitel - einmal je Video.
//
// Das Skript haengt sich selbst in die Seite und bleibt dort, weil YouTube das
// Video ohne Neuladen wechselt. Hier wird es nur angestossen; alles Weitere
// steht in youtube.js, samt der Begruendung, warum genau einmal je Video und
// nicht dauernd nachgestellt wird.
async function installYoutubeWiedergabe(view, url) {
  if (!isLiveView(view) || !youtube.istYoutubeUrl(url)) return;
  await view.webContents.executeJavaScript(youtube.wiedergabeScript(), true).catch(() => {});
}

// --- Was die Oberflaeche davon sieht -----------------------------------------

function sendYoutubePartyState(status) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("youtubeparty:state", youtubePartyStatus(status));
}

function youtubePartyStatus(status) {
  return {
    ...(status || youtubeParty.status()),
    // Welche Raeume ueberhaupt in Frage kommen. Ohne Watchparty gibt es keine.
    rooms: watchparty.aktiv ? watchparty.codes : [],
    watchpartyEnabled: watchparty.aktiv
  };
}

// --- Wiedergabesitzungen -----------------------------------------------------
//
// Die Ablage der gemessenen Wiedergabezeit. Die Regeln stehen in statistik.js -
// hier steht nur, wann geschrieben wird und wohin.
//
// Eigene Datei, nicht an den Favoriten: deren Verlauf ist auf 120 Eintraege je
// Titel gekappt, damit die Ablage nicht auflaeuft. Sitzungen duerfen aber nicht
// wegfallen, sonst schrumpft die Bilanz eines Jahres mit jeder neuen Folge.
//
// Je Anbieter genau eine offene Sitzung: mehr kann es nicht geben, weil je
// Anbieter nur eine Seite vorn steht.
const offeneSitzungen = new Map();

// Welche Saetze gerade noch wachsen. Sie stehen bereits in der Ablage - damit
// ein Absturz sie nicht kostet -, sind aber noch keine fertigen Sitzungen und
// haben deshalb bei den anderen Geraeten nichts verloren.
function laufendeSitzungIds() {
  const offen = new Set();
  for (const sitzung of offeneSitzungen.values()) {
    if (sitzung?.id) offen.add(String(sitzung.id));
  }
  return offen;
}
let sitzungenSpeicher = null;
let sitzungenSchmutzig = false;
let sitzungenZuletztGespeichert = 0;

// So oft wird die laufende Sitzung weggeschrieben. Nicht bei jedem Takt - das
// waeren alle fuenf Sekunden ein Dateizugriff -, aber oft genug, dass ein
// Absturz hoechstens eine halbe Minute kostet.
const SITZUNG_SICHERN_MS = 30 * 1000;

function loadSitzungen() {
  if (sitzungenSpeicher) return sitzungenSpeicher;
  try {
    const roh = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    sitzungenSpeicher = Array.isArray(roh?.sitzungen) ? roh.sitzungen : [];
  } catch {
    sitzungenSpeicher = [];
  }
  return sitzungenSpeicher;
}

function saveSitzungen() {
  if (!sitzungenSchmutzig) return;
  ensureDataDir();
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify({
      version: SITZUNG_SCHEMA_VERSION,
      sitzungen: loadSitzungen()
    }, null, 2));
    sitzungenSchmutzig = false;
    sitzungenZuletztGespeichert = Date.now();
    // Dieselbe Ueberlegung wie bei den Favoriten: der eine Punkt, an dem sich am
    // Bestand wirklich etwas geaendert hat. Die laufende Sitzung faellt beim
    // Sammeln durch den Filter - sie waechst noch.
    geraeteAbgleichSpaeter();
  } catch (fehler) {
    console.log("[ELFIX STATISTIK] Sitzungen nicht gespeichert: " + (fehler?.message || fehler));
  }
}

// Die laufende Sitzung steht bereits in der Liste und wird an Ort und Stelle
// fortgeschrieben. Dadurch ueberlebt sie einen Absturz mit dem Stand des
// letzten Sicherns - eine leere Liste waere das schlechtere Ergebnis.
function sitzungAblegen(sitzung) {
  const liste = loadSitzungen();
  const stelle = liste.findIndex((eintrag) => eintrag.id === sitzung.id);
  if (stelle >= 0) liste[stelle] = sitzung;
  else liste.push(sitzung);
  sitzungenSchmutzig = true;
}

function sitzungVerwerfen(id) {
  const liste = loadSitzungen();
  const stelle = liste.findIndex((eintrag) => eintrag.id === id);
  if (stelle >= 0) {
    liste.splice(stelle, 1);
    sitzungenSchmutzig = true;
  }
}

// Ob diese Folge schon einmal zu Ende gesehen wurde. Genau das macht ein
// erneutes Anschauen zur Wiederholung - und eine Wiederholung zaehlt nicht als
// weitere Folge, sonst stuenden am Ende mehr Folgen da, als es gibt.
function istWiederholung(entry, url) {
  if (!entry) return false;
  const identity = episodeIdentity(url);
  if (identity?.episode) {
    // Derselbe Schluessel, den appendCompletedEpisode vergibt - sonst faende
    // man den vorhandenen Abschluss nie wieder.
    const schluessel = `${identity.key}:s${identity.season}:e${identity.episode}`;
    return (entry.completedEpisodes || []).some((eintrag) => eintrag.key === schluessel);
  }
  return Boolean(entry.completed);
}

function sitzungMelden(provider, url, entry, progress) {
  if (!provider || !entry) return;
  const identity = episodeIdentity(url);
  const jetzt = Date.now();
  const vorher = offeneSitzungen.get(provider.id) || null;

  const ergebnis = statistik.meldungEinarbeiten(vorher, {
    favoriteId: entry.id,
    url,
    titel: entry.title || "",
    providerId: provider.id,
    providerName: provider.name || "",
    type: entry.type || "",
    season: identity?.season || entry.season || 0,
    episode: identity?.episode || entry.episode || 0,
    sekunden: Number(progress?.playedSeconds) || 0,
    position: Number(progress?.currentTime) || 0,
    laufzeit: Number(progress?.duration) || 0,
    abgeschlossen: Boolean(progress?.ended)
      || mediaProgressPercent(progress?.currentTime, progress?.duration) >= COMPLETED_PROGRESS_PERCENT,
    // Zum Zeitpunkt des Beginns gefragt, nicht am Ende: waehrend dieser Sitzung
    // wird die Folge ja gerade abgeschlossen, und danach saehe jede
    // Erstansicht wie eine Wiederholung aus.
    wiederholung: vorher && vorher.url === url ? vorher.wiederholung : istWiederholung(entry, url)
  }, jetzt);

  if (ergebnis.geschlossen) sitzungBeenden(ergebnis.geschlossen);
  offeneSitzungen.set(provider.id, ergebnis.offen);

  if (ergebnis.offen) {
    const stand = statistik.sitzungSchliessen(ergebnis.offen);
    if (statistik.sitzungLohnt(stand)) sitzungAblegen(stand);
    if (jetzt - sitzungenZuletztGespeichert >= SITZUNG_SICHERN_MS) saveSitzungen();
  }
}

function sitzungBeenden(stand) {
  if (!stand) return;
  if (statistik.sitzungLohnt(stand)) sitzungAblegen(stand);
  else sitzungVerwerfen(stand.id);
  saveSitzungen();
}

// Alles offene schliessen: beim Anbieterwechsel, beim Schliessen einer Ansicht
// und beim Beenden der App. Ohne das bliebe die letzte Folge eines Abends
// ungezaehlt.
function sitzungenSchliessen(providerId) {
  const betroffen = providerId ? [providerId] : [...offeneSitzungen.keys()];
  for (const id of betroffen) {
    const offen = offeneSitzungen.get(id);
    offeneSitzungen.delete(id);
    if (offen) sitzungBeenden(statistik.sitzungSchliessen(offen));
  }
}

// Was die Auswertung ueber einen Titel wissen muss - aus den Caches, die
// ohnehin gefuellt sind. Kein einziger zusaetzlicher Abruf.
function sitzungTitelInfo(sitzung, seiten = {}) {
  const favorite = favorites.find((eintrag) => eintrag.id === sitzung?.favoriteId);
  // Nachgesehen wird unter der Adresse des Titels, nicht der der Folge: der
  // Geschmack-Cache kennt Serienseiten, und eine Folgenadresse steht dort nie.
  // Genau daran fielen anfangs alle Genres aus.
  const seite = seiten[String(favorite?.url || "")] || seiten[String(sitzung?.url || "")];
  // Genres kommen vom Anbieter, aus dem Geschmack-Cache. Der Metadaten-Cache
  // haette ebenfalls welche, ist aber nur ueber den asynchronen Client
  // erreichbar - und eine Auswertung soll keine Abrufe ausloesen.
  const eigene = (Array.isArray(seite?.genres) ? seite.genres : [])
    .map((genre) => ({ key: String(genre.key || ""), label: String(genre.label || genre.key || "") }))
    .filter((genre) => genre.key);
  return {
    genres: eigene,
    bild: favorite?.customThumbnail || favorite?.thumbnail || "",
    jahr: Number(seite?.meta?.jahr) || 0
  };
}

// Altdaten uebernehmen - einmalig, und nur was sicher ableitbar ist.
//
// Vor dieser Fassung hat ELFIX die Wiedergabezeit zwar gemessen, aber nur als
// Schwelle benutzt und danach verworfen. Was in der Ablage steht, sind
// Ereignisse: diese Folge lief, dieser Titel war durch, an diesem Tag.
//
// Genau das wird uebernommen - und nichts darueber hinaus. Aus "Folge 8
// abgeschlossen" folgt nicht "24 Minuten geschaut", auch wenn die Folge 24
// Minuten dauert: gesehen haben kann man sie in zwei Minuten Vorspulen. Solche
// Saetze tragen deshalb `qualitaet: "rekonstruiert"` und keine Sekunden, und
// die Auswertung zaehlt ihre Zeit nirgends mit.
//
// Der Unterschied ist nicht kosmetisch. Eine erfundene Stundenzahl laesst sich
// ein Jahr spaeter nicht mehr widerlegen - sie steht dann einfach da.
// Die Kennung eines nachgetragenen Satzes. Sie muss auf jedem Geraet dieselbe
// sein: seit die Geraete ihre Saetze austauschen, tragen beide dieselbe
// Vorgeschichte nach - jedes aus seinen eigenen Favoriten, die inzwischen
// ohnehin dieselben sind. Haenge die Kennung wie frueher an der Kennung des
// Favoriten, kaeme jede alte Folge doppelt heraus.
//
// Der Titel taugt dafuer, die Kennung des Favoriten nicht: sie entsteht beim
// Anlegen und ist auf jedem Geraet eine andere.
function altSchluessel(favorite) {
  // Dieselbe Normalisierung, mit der statistik.js zwei Saetze derselben Folge
  // zusammenbringt - nicht irgendeine. Zwei Rechnungen fuer dieselbe Frage
  // waeren genau die Sorte Unterschied, die man erst ein Jahr spaeter an einer
  // falschen Zahl bemerkt.
  return taste.titelSchluessel(favorite?.title) || String(favorite?.id || "");
}

function sitzungenAusAltdaten(liste) {
  const gebaut = [];
  const gesehen = new Set();

  for (const favorite of liste || []) {
    const basis = {
      favoriteId: String(favorite?.id || ""),
      titel: String(favorite?.title || ""),
      providerId: String(favorite?.providerId || ""),
      anbieter: String(favorite?.providerName || ""),
      gattung: statistik.gattungBestimmen({
        type: favorite?.type,
        providerName: favorite?.providerName,
        url: favorite?.url
      }),
      sekunden: 0,
      qualitaet: statistik.REKONSTRUIERT,
      wiederholung: false
    };

    // Die genaueste Quelle zuerst: abgeschlossene Folgen tragen Nummer und
    // Zeitpunkt.
    for (const folge of favorite?.completedEpisodes || []) {
      const zeit = Date.parse(folge?.completedAt || "");
      if (!Number.isFinite(zeit)) continue;
      const kennung = `alt:${altSchluessel(favorite)}:s${folge.season}:e${folge.episode}`;
      if (gesehen.has(kennung)) continue;
      gesehen.add(kennung);
      gebaut.push({
        ...basis,
        id: kennung,
        url: String(folge?.url || favorite?.url || ""),
        season: Number(folge?.season) || 0,
        episode: Number(folge?.episode) || 0,
        begonnenAm: new Date(zeit).toISOString(),
        beendetAm: new Date(zeit).toISOString(),
        startPosition: 0,
        endPosition: 0,
        laufzeit: 0,
        abgeschlossen: true
      });
    }

    // Ein abgeschlossener Titel ohne jede Folgenangabe - typisch fuer Filme:
    // ihr Verlauf enthaelt oft nur "Film geoeffnet", und das ist keine
    // Wiedergabe. Der Abschluss selbst ist aber belegt und traegt einen
    // Zeitpunkt. Ohne diesen Zweig fehlten in der Bilanz saemtliche Filme.
    const abschlussZeit = Date.parse(favorite?.completedAt || "");
    if (favorite?.completed && Number.isFinite(abschlussZeit) && !(favorite?.completedEpisodes || []).length) {
      const kennung = `altab:${altSchluessel(favorite)}`;
      if (!gesehen.has(kennung)) {
        gesehen.add(kennung);
        gebaut.push({
          ...basis,
          id: kennung,
          url: String(favorite?.url || ""),
          season: Number(favorite?.season) || 0,
          episode: Number(favorite?.episode) || 0,
          begonnenAm: new Date(abschlussZeit).toISOString(),
          beendetAm: new Date(abschlussZeit).toISOString(),
          startPosition: 0,
          endPosition: 0,
          laufzeit: 0,
          abgeschlossen: true
        });
      }
    }

    // Danach der Verlauf: er nennt Folgen mit Zeitpunkt, sagt aber nicht, ob
    // sie zu Ende liefen. "Geoeffnet" bleibt draussen - das ist keine
    // Wiedergabe, sondern eine offene Seite.
    for (const eintrag of favorite?.activity || []) {
      const label = String(eintrag?.label || "");
      if (/ge(ö|oe)ffnet/i.test(label)) continue;
      const zeit = Date.parse(eintrag?.at || "");
      if (!Number.isFinite(zeit)) continue;
      const abschluss = /^abgeschlossen$/i.test(label.trim());
      const folge = Number(eintrag?.episode) || 0;
      // Die Abschlusszeile traegt die Nummer der letzten Folge mit und waere
      // sonst eine Folge zu viel.
      if (abschluss && folge) continue;
      const kennung = `alt:${altSchluessel(favorite)}:s${eintrag?.season || 0}:e${folge}`;
      if (folge && gesehen.has(kennung)) continue;
      if (folge) gesehen.add(kennung);
      gebaut.push({
        ...basis,
        id: `altv:${basis.favoriteId}:${zeit}`,
        url: String(eintrag?.url || favorite?.url || ""),
        season: Number(eintrag?.season) || 0,
        episode: folge,
        begonnenAm: new Date(zeit).toISOString(),
        beendetAm: new Date(zeit).toISOString(),
        startPosition: 0,
        endPosition: 0,
        laufzeit: 0,
        abgeschlossen: abschluss
      });
    }
  }

  return gebaut.sort((links, rechts) => Date.parse(links.begonnenAm) - Date.parse(rechts.begonnenAm));
}

// Einmalig, mit demselben Merker-Verfahren wie beim Nachtragen von YouTube: der
// Merker wird gesetzt, bevor geprueft wird. Wer die uebernommenen Saetze
// spaeter loescht, bekommt sie nicht beim naechsten Start zurueck.
function sitzungenNachtragen() {
  if (settings.migrations?.sitzungen === true) return 0;
  settings.migrations = { ...(settings.migrations || {}), sitzungen: true };
  saveSettings();

  const vorhanden = loadSitzungen();
  const bekannte = new Set(vorhanden.map((eintrag) => eintrag.id));
  const neue = sitzungenAusAltdaten(favorites).filter((eintrag) => !bekannte.has(eintrag.id));
  if (!neue.length) return 0;

  vorhanden.push(...neue);
  sitzungenSchmutzig = true;
  saveSitzungen();
  console.log(`[ELFIX STATISTIK] ${neue.length} Saetze aus dem Verlauf uebernommen (ohne Wiedergabezeit)`);
  return neue.length;
}

// Die Kennungen der nachgetragenen Saetze umstellen - einmalig.
//
// Bis 1.31.0 hingen sie an der Kennung des Favoriten, die auf jedem Geraet eine
// andere ist. Solange die Saetze das Geraet nie verliessen, war das gleichgueltig.
// Seit sie es tun, wuerde dieselbe alte Folge zweimal dastehen: einmal unter der
// Kennung von hier, einmal unter der von drueben.
//
// Umgerechnet wird aus dem Titel, der in jedem Satz steht - dieselbe Rechnung
// wie beim Nachtragen. Faellt dabei ein Satz auf einen schon vergebenen
// Schluessel, war er ein Doppelgaenger und faellt weg.
function sitzungenKennungenAngleichen() {
  if (settings.migrations?.sitzungKennung === true) return 0;
  settings.migrations = { ...(settings.migrations || {}), sitzungKennung: true };
  saveSettings();

  const liste = loadSitzungen();
  const bekannt = new Set();
  const behalten = [];
  let umgestellt = 0;
  let doppelt = 0;

  for (const sitzung of liste) {
    const alt = String(sitzung?.id || "");
    const treffer = /^(alt|altab):/.exec(alt);
    if (!treffer) {
      // Gemessene Saetze tragen schon eine eigene, weltweit eindeutige Kennung.
      if (alt) bekannt.add(alt);
      behalten.push(sitzung);
      continue;
    }
    const schluessel = taste.titelSchluessel(sitzung.titel) || String(sitzung.favoriteId || "");
    const neu = treffer[1] === "altab"
      ? `altab:${schluessel}`
      : `alt:${schluessel}:s${Number(sitzung.season) || 0}:e${Number(sitzung.episode) || 0}`;
    if (bekannt.has(neu)) {
      doppelt += 1;
      continue;
    }
    bekannt.add(neu);
    if (neu !== alt) umgestellt += 1;
    behalten.push({ ...sitzung, id: neu });
  }

  if (!umgestellt && !doppelt) return 0;
  sitzungenSpeicher = behalten;
  sitzungenSchmutzig = true;
  saveSitzungen();
  console.log(`[ELFIX STATISTIK] ${umgestellt} Kennungen umgestellt, ${doppelt} Doppelgaenger entfernt`);
  return umgestellt;
}

// --- Die Auswertung ----------------------------------------------------------

// Ein Zeitraum als Name statt als zwei Zeitstempel. Die Seite fragt nach
// "letzte 30 Tage", nicht nach zwei Millisekundenwerten.
function zeitraumGrenzen(name, jetzt = Date.now()) {
  const heute = new Date(jetzt);
  const tagesBeginn = (datum) => new Date(datum.getFullYear(), datum.getMonth(), datum.getDate()).getTime();
  const vorTagen = (anzahl) => tagesBeginn(new Date(jetzt - anzahl * 86400000));
  switch (String(name || "")) {
    case "7tage": return { von: vorTagen(6), bis: jetzt };
    case "30tage": return { von: vorTagen(29), bis: jetzt };
    case "monat": return { von: new Date(heute.getFullYear(), heute.getMonth(), 1).getTime(), bis: jetzt };
    case "jahr": return { von: new Date(heute.getFullYear(), 0, 1).getTime(), bis: jetzt };
    case "alles": return { von: Number.NEGATIVE_INFINITY, bis: jetzt };
    default: {
      // Eine Jahreszahl - "2025" heisst das ganze Kalenderjahr.
      const jahr = Number(name);
      if (Number.isFinite(jahr) && jahr > 2000) {
        return { von: new Date(jahr, 0, 1).getTime(), bis: new Date(jahr + 1, 0, 1).getTime() - 1 };
      }
      return { von: Number.NEGATIVE_INFINITY, bis: jetzt };
    }
  }
}

// Die eine Stelle, an der Statistiken entstehen. Alles, was die Oberflaeche
// zeigt, kommt hier heraus - damit es keine zweite Rechenart gibt, die
// irgendwann andere Zahlen liefert.
function watchStatistik(zeitraum = "alles") {
  const sitzungen = loadSitzungen();
  const grenzen = zeitraumGrenzen(zeitraum);
  let seiten = {};
  try { seiten = loadTasteCache()?.pages || {}; } catch { seiten = {}; }
  return statistik.auswerten(sitzungen, {
    von: grenzen.von,
    bis: grenzen.bis,
    titel: (sitzung) => sitzungTitelInfo(sitzung, seiten)
  });
}

// --- Watchparty-Chat ---------------------------------------------------------
//
// Ein paar Zeilen ueber dem Video, mehr nicht. Das Relay kannte die Mitglieder
// eines Raums ohnehin und weiss, wer schreibt - der Chat ist deshalb ein
// kleiner Aufsatz darauf und kein eigenes System.
//
// Er lebt in der Anbieterseite, nicht in der Oberflaeche von ELFIX: waehrend
// einer Watchparty liegt die Anbieteransicht vorn und wuerde jedes HTML der App
// verdecken. Dieselbe Ueberlegung wie beim Knopf fuer die naechste Folge, und
// derselbe Rueckkanal ueber eine Konsolenzeile.
//
// Zwei Dinge machen ihn im Betrieb ertraeglich:
//
// Er ist eingeklappt, bis man ihn aufmacht. Eine offene Chatspalte neben einem
// Film ist eine Ablenkung, die man nicht bestellt hat.
//
// Und er verschwindet, wenn die Maus stillsteht - genau wie der Knopf fuer die
// naechste Folge. Wer schaut, bewegt die Maus nicht; wer die Maus bewegt, will
// etwas. Eingeklappt bleibt nur ein kleiner Knopf, und auch der verblasst.
const LEISTE_RUHE_MS = 3500;

// Die Leiste links oben.
//
// Dort liegen die Bedienelemente, die zur Folge gehoeren und nicht zum Player:
// der Chat der Watchparty und der Schalter fuer die naechste Folge. Sie teilen
// sich einen Kasten, damit sie nebeneinander stehen statt uebereinander - und
// damit der eine nicht springt, wenn der andere kommt oder geht.
//
// Die Reihenfolge steht ueber "order", nicht ueber die Reihenfolge im DOM:
// welches Skript zuerst laeuft, haengt davon ab, ob gerade eine Runde laeuft.
// Der Schalter ist immer da und steht deshalb links; der Chat kommt und geht
// und haengt sich rechts daneben.
function leisteQuelltext() {
  return `
  function elfixLeisteLinks() {
    const obenDrauf = window.top === window.self;
    const sichtbaresVideo = Array.from(document.querySelectorAll("video")).some((video) => {
      const rect = video.getBoundingClientRect();
      return rect.width > 120 && rect.height > 80;
    });
    const rahmen = Array.from(document.querySelectorAll("iframe, embed")).some((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 200 && rect.height > 120;
    });
    // Dieselbe Regel wie beim Folgenknopf: die Einblendung gehoert in den Frame
    // mit dem Video, sonst ist sie im Vollbild nicht zu sehen.
    if (!(sichtbaresVideo || (obenDrauf && !rahmen))) return null;

    const vollbild = document.fullscreenElement;
    const buehne = vollbild && vollbild.tagName !== "IFRAME" && vollbild.tagName !== "EMBED"
      ? vollbild : document.documentElement;

    let leiste = document.getElementById("__elfixLeisteLinks");
    // Beim Wechsel ins Vollbild wandert die Buehne. Eine Leiste, die noch am
    // alten Dokument haengt, wuerde dort nie wieder gezeichnet.
    if (leiste && leiste.parentElement !== buehne) {
      leiste.remove();
      leiste = null;
    }
    if (!leiste) {
      leiste = document.createElement("div");
      leiste.id = "__elfixLeisteLinks";
      Object.assign(leiste.style, {
        position: "fixed", left: "22px", top: "22px", zIndex: "2147483646",
        display: "flex", alignItems: "flex-start", gap: "8px"
      });
      buehne.appendChild(leiste);
    }
    return leiste;
  }

  // Bleibt nichts mehr darin, gehoert auch die Leiste weg - ein leerer Kasten
  // ueber dem Bild faengt sonst Klicks ab, die dem Player gehoeren.
  function elfixLeisteAufraeumen() {
    const leiste = document.getElementById("__elfixLeisteLinks");
    if (leiste && leiste.children.length === 0) leiste.remove();
  }
`;
}

// Der Schalter fuer die naechste Folge - wie bei YouTube, an derselben Stelle
// wie der Chat.
//
// Es ist derselbe Schalter wie in den Einstellungen, nicht ein zweiter daneben:
// er schreibt dieselbe Einstellung und gilt damit ueber die Folge hinaus. Was
// nur fuer die laufende Folge gilt, steht schon in der Einblendung am Ende
// ("Danach aufhoeren") - zwei Dinge, die verschieden lange gelten, duerfen
// nicht gleich aussehen.
function autoplaySchalterScript(an) {
  return `(() => {
  ${leisteQuelltext()}
  const id = "__elfixAutoplaySchalter";
  const anfangs = ${an ? "true" : "false"};

  const leiste = elfixLeisteLinks();
  if (!leiste) {
    const alt = document.getElementById(id);
    if (alt) { alt.remove(); elfixLeisteAufraeumen(); }
    return "autoplay-nicht-zustaendig";
  }

  let schalter = document.getElementById(id);
  // Beim Wechsel ins Vollbild baut sich die Leiste neu - dann gehoert der
  // Schalter mit hinueber statt am alten Dokument haengenzubleiben.
  if (schalter && schalter.parentElement !== leiste) {
    schalter.remove();
    schalter = null;
  }
  // Schon da: dann nur den Stand nachziehen. Er kann sich in den
  // Einstellungen geaendert haben, waehrend die Folge lief.
  //
  // Und zwar still. Dieses Skript laeuft im Fortschritts-Takt erneut - alle
  // paar Sekunden. Wer hier jedes Mal aufweckt, laesst die Leiste von selbst
  // aufblenden, ohne dass jemand die Maus bewegt hat, und genau davor sollte
  // das Verblassen ja schuetzen: wer schaut, bewegt die Maus nicht.
  if (schalter) {
    const vorher = schalter.dataset.an === "ja";
    schalter.__setzen(anfangs);
    // Hat sich der Stand wirklich geaendert, gehoert er gezeigt - dann ist es
    // eine Nachricht und kein Takt.
    if (vorher !== anfangs) schalter.__wach();
    return "autoplay-schon-da";
  }

  schalter = document.createElement("button");
  schalter.id = id;
  schalter.type = "button";
  Object.assign(schalter.style, {
    // Links vom Chat: der Schalter ist immer da, der Chat kommt und geht.
    order: "1",
    display: "flex", alignItems: "center", gap: "9px",
    minHeight: "38px", padding: "0 14px", border: "0", borderRadius: "999px",
    background: "rgba(12, 16, 24, 0.86)", color: "#fff",
    font: "700 13px/1 system-ui, sans-serif", cursor: "pointer",
    boxShadow: "0 10px 30px rgba(0, 0, 0, 0.45)",
    opacity: "0", transition: "opacity 220ms ease"
  });

  const beschriftung = document.createElement("span");
  beschriftung.textContent = "Autoplay";
  const bahn = document.createElement("span");
  Object.assign(bahn.style, {
    position: "relative", width: "32px", height: "18px", borderRadius: "999px",
    flex: "0 0 auto", transition: "background 160ms ease"
  });
  const griff = document.createElement("span");
  Object.assign(griff.style, {
    position: "absolute", top: "2px", left: "2px", width: "14px", height: "14px",
    borderRadius: "50%", background: "#fff", transition: "transform 160ms ease"
  });
  bahn.appendChild(griff);
  schalter.append(beschriftung, bahn);
  leiste.appendChild(schalter);

  schalter.__setzen = (zustand) => {
    schalter.dataset.an = zustand ? "ja" : "";
    schalter.setAttribute("aria-pressed", zustand ? "true" : "false");
    schalter.title = zustand
      ? "N\u00e4chste Folge startet von selbst"
      : "N\u00e4chste Folge startet nicht von selbst";
    bahn.style.background = zustand ? "#3ea6ff" : "rgba(255, 255, 255, 0.28)";
    griff.style.transform = zustand ? "translateX(14px)" : "translateX(0)";
  };
  schalter.__setzen(anfangs);

  // Dieselbe Ruhe wie beim Chat: wer schaut, bewegt die Maus nicht.
  let ruhe = 0;
  const wach = () => {
    schalter.style.opacity = "1";
    if (ruhe) clearTimeout(ruhe);
    ruhe = setTimeout(() => {
      if (schalter.__ueber) return;
      schalter.style.opacity = "0";
    }, ${LEISTE_RUHE_MS});
  };
  schalter.__wach = wach;
  schalter.addEventListener("mouseenter", () => { schalter.__ueber = true; wach(); });
  schalter.addEventListener("mouseleave", () => { schalter.__ueber = false; wach(); });
  document.addEventListener("mousemove", wach, true);

  schalter.addEventListener("click", (ereignis) => {
    ereignis.preventDefault();
    ereignis.stopPropagation();
    const neu = schalter.dataset.an !== "ja";
    // Sofort umlegen, nicht erst auf die Antwort warten: die Einstellung liegt
    // eine Prozessgrenze weiter, und ein Schalter, der erst danach reagiert,
    // fuehlt sich kaputt an.
    schalter.__setzen(neu);
    wach();
    console.log("__elfix:autoplay:" + (neu ? "1" : "0"));
  }, true);

  // Sonst nimmt der Player die Leertaste und pausiert, waehrend man schaltet.
  for (const name of ["keydown", "keyup", "keypress"]) {
    schalter.addEventListener(name, (ereignis) => { ereignis.stopPropagation(); }, true);
  }

  requestAnimationFrame(wach);
  return "autoplay-da@" + location.hostname;
})()`;
}

function watchpartyChatScript(optionen = {}) {
  return `(() => {
  ${leisteQuelltext()}
  const id = "__elfixChat";
  const eigenerName = ${JSON.stringify(String(optionen.name || "Du"))};
  // Schon da: dann bleibt alles, wie es ist. Aufgeweckt wird der Chat von einer
  // Mausbewegung und von einer eingehenden Zeile - nicht davon, dass dieses
  // Skript im Fortschritts-Takt noch einmal vorbeikommt.
  if (window.__elfixChat) return "chat-schon-da";

  const leiste = elfixLeisteLinks();
  if (!leiste) return "chat-nicht-zustaendig";

  const kasten = document.createElement("div");
  kasten.id = id;
  Object.assign(kasten.style, {
    display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "8px",
    // Rechts vom Schalter: der ist immer da, der Chat kommt und geht.
    order: "2",
    font: "500 14px/1.4 system-ui, sans-serif", color: "#fff",
    opacity: "0", transition: "opacity 220ms ease"
  });

  // --- Der zusammengeklappte Zustand ---
  const knopf = document.createElement("button");
  knopf.type = "button";
  Object.assign(knopf.style, {
    minHeight: "38px", padding: "0 16px", border: "0", borderRadius: "999px",
    background: "rgba(12, 16, 24, 0.86)", color: "#fff",
    font: "700 13px/1 system-ui, sans-serif", cursor: "pointer",
    boxShadow: "0 10px 30px rgba(0, 0, 0, 0.45)"
  });
  knopf.textContent = "Chat";

  // --- Der aufgeklappte Zustand ---
  const feld = document.createElement("div");
  Object.assign(feld.style, {
    display: "none", flexDirection: "column", width: "min(320px, 34vw)",
    maxHeight: "min(340px, 42vh)", borderRadius: "14px", overflow: "hidden",
    background: "rgba(10, 13, 20, 0.9)", backdropFilter: "blur(10px)",
    boxShadow: "0 18px 50px rgba(0, 0, 0, 0.55)"
  });

  const kopf = document.createElement("div");
  Object.assign(kopf.style, {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "10px 14px", font: "700 13px/1 system-ui, sans-serif",
    borderBottom: "1px solid rgba(255, 255, 255, 0.1)"
  });
  const titel = document.createElement("span");
  titel.textContent = "Watchparty-Chat";
  const zu = document.createElement("button");
  zu.type = "button";
  zu.textContent = "\\u2013";
  Object.assign(zu.style, {
    border: "0", background: "transparent", color: "#fff",
    fontSize: "18px", lineHeight: "1", cursor: "pointer", padding: "0 4px"
  });
  kopf.append(titel, zu);

  const liste = document.createElement("div");
  Object.assign(liste.style, {
    flex: "1", minHeight: "0", overflowY: "auto", padding: "10px 14px",
    display: "flex", flexDirection: "column", gap: "8px"
  });

  const zeile = document.createElement("form");
  Object.assign(zeile.style, {
    display: "flex", gap: "8px", padding: "10px 12px",
    borderTop: "1px solid rgba(255, 255, 255, 0.1)"
  });
  const eingabe = document.createElement("input");
  eingabe.type = "text";
  eingabe.placeholder = "Nachricht …";
  eingabe.maxLength = 500;
  Object.assign(eingabe.style, {
    flex: "1", minWidth: "0", border: "0", borderRadius: "8px",
    padding: "9px 12px", background: "rgba(255, 255, 255, 0.1)",
    color: "#fff", font: "500 13px/1 system-ui, sans-serif"
  });
  const ab = document.createElement("button");
  ab.type = "submit";
  ab.textContent = "\\u2191";
  Object.assign(ab.style, {
    border: "0", borderRadius: "8px", padding: "0 14px",
    background: "rgba(255, 255, 255, 0.9)", color: "#0b0f16",
    font: "700 14px/1 system-ui, sans-serif", cursor: "pointer"
  });
  zeile.append(eingabe, ab);
  feld.append(kopf, liste, zeile);
  // Links oben angeschlagen waechst der Chat nach unten. Der Knopf steht an
  // derselben Ecke wie die Kopfzeile des Feldes, das er ersetzt - deshalb hier
  // vor dem Feld und nicht dahinter.
  kasten.append(knopf, feld);
  leiste.appendChild(kasten);

  // --- Sichtbarkeit ---
  // Der Chat gehoert zur Bedienung, nicht zum Film. Steht die Maus still, geht
  // er weg; jede Bewegung holt ihn zurueck. Waehrend man tippt, bleibt er - es
  // waere absurd, mitten im Satz zu verblassen.
  let ruhe = 0;
  const wach = () => {
    kasten.style.opacity = "1";
    if (ruhe) clearTimeout(ruhe);
    ruhe = setTimeout(() => {
      if (kasten.__offen && (document.activeElement === eingabe || kasten.__ueber)) return;
      if (kasten.__ueber) return;
      kasten.style.opacity = "0";
    }, ${LEISTE_RUHE_MS});
  };
  kasten.addEventListener("mouseenter", () => { kasten.__ueber = true; wach(); });
  kasten.addEventListener("mouseleave", () => { kasten.__ueber = false; wach(); });
  document.addEventListener("mousemove", wach, true);

  const umschalten = (offen) => {
    kasten.__offen = offen;
    feld.style.display = offen ? "flex" : "none";
    knopf.style.display = offen ? "none" : "";
    if (offen) {
      eingabe.focus();
      liste.scrollTop = liste.scrollHeight;
    }
    wach();
  };
  knopf.addEventListener("click", (event) => { event.preventDefault(); umschalten(true); });
  zu.addEventListener("click", (event) => { event.preventDefault(); umschalten(false); });

  // Tasten gehoeren dem Chat, solange man in ihm tippt: sonst nimmt der Player
  // die Leertaste und pausiert mitten im Satz.
  for (const name of ["keydown", "keyup", "keypress"]) {
    eingabe.addEventListener(name, (event) => { event.stopPropagation(); }, true);
  }

  zeile.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = eingabe.value.trim();
    if (!text) return;
    eingabe.value = "";
    console.log("__elfix:chat:" + text);
    wach();
  });

  // --- Eintragen ---
  const anhaengen = (nachricht) => {
    const zeileKnoten = document.createElement("div");
    Object.assign(zeileKnoten.style, { display: "flex", flexDirection: "column", gap: "2px" });
    const wer = document.createElement("small");
    wer.textContent = nachricht.eigen ? eigenerName : (nachricht.from || "Jemand");
    Object.assign(wer.style, {
      fontSize: "11px", opacity: "0.6",
      color: nachricht.eigen ? "#9ec1ff" : "#fff"
    });
    const was = document.createElement("span");
    was.textContent = nachricht.text;
    Object.assign(was.style, { fontSize: "13px", wordBreak: "break-word" });
    zeileKnoten.append(wer, was);
    liste.append(zeileKnoten);
    // Nur die letzten fuenfzig behalten: gespeichert wird nichts, und eine
    // endlos wachsende Liste in einer fremden Seite waere unhoeflich.
    while (liste.children.length > 50) liste.firstChild.remove();
    liste.scrollTop = liste.scrollHeight;
  };

  window.__elfixChat = {
    wach,
    anhaengen,
    // Kommt etwas an, waehrend der Chat zu ist, meldet sich der Knopf - aber
    // leise: ein Punkt, kein Fenster.
    melden: (nachricht) => {
      anhaengen(nachricht);
      if (!kasten.__offen && !nachricht.eigen) {
        knopf.textContent = "Chat \\u2022";
        wach();
      }
    },
    entfernen: () => {
      if (ruhe) clearTimeout(ruhe);
      document.removeEventListener("mousemove", wach, true);
      kasten.remove();
      elfixLeisteAufraeumen();
      window.__elfixChat = null;
    }
  };
  knopf.addEventListener("click", () => { knopf.textContent = "Chat"; });

  umschalten(false);
  requestAnimationFrame(wach);
  return "chat-da@" + location.hostname;
})()`;
}

// In die Seite bringen - aber nur, wo eine Watchparty wirklich laeuft. Auf einer
// Seite ohne Runde haette der Knopf niemanden, mit dem er spraeche.
async function installWatchpartyChat(provider, view, url) {
  if (!isLiveView(view)) return;
  const key = watchpartyLiveKeyForUrl(url);
  if (!key || !watchparty.aktiv) {
    // Keine Runde mehr: der Chat gehoert weg. Ein Eingabefeld, dessen
    // Nachrichten niemand bekommt, ist schlimmer als keines.
    await executeJavaScriptInMediaFrames(view,
      "window.__elfixChat && window.__elfixChat.entfernen()").catch(() => []);
    return;
  }
  await executeJavaScriptInMediaFrames(view, watchpartyChatScript({
    name: settings.watchparty?.deviceName || "Du"
  })).catch(() => []);
}

// Eine eingegangene Nachricht in die offene Seite tragen. Sie geht nur dorthin,
// wo auch geschaut wird - eine Chatzeile auf einer Seite ohne Runde waere ein
// Fremdkoerper.
function watchpartyChatZeigen(nachricht) {
  const eintrag = [...providerViews.entries()].find(([, ansicht]) => isLiveView(ansicht));
  if (!eintrag) return;
  const [, view] = eintrag;
  const adresse = view.webContents.getURL();
  if (!watchpartyLiveKeyForUrl(adresse)) return;
  executeJavaScriptInMediaFrames(view,
    `window.__elfixChat && window.__elfixChat.melden(${JSON.stringify(nachricht)})`).catch(() => []);
}

// --- Jahresrueckblick --------------------------------------------------------
//
// Die Statistikseite ist zum Nachschlagen da; das hier ist zum Ansehen, einmal
// im Jahr. Deshalb meldet es sich von selbst - aber nur unter Bedingungen, die
// eine Enttaeuschung ausschliessen.
//
// Das Fenster reicht vom 1. Dezember bis zum 6. Januar. Der Januar gehoert
// dazu, weil sonst jeder leer ausgeht, der ELFIX im Dezember nicht oeffnet; in
// diesen Tagen zeigt es dann das vergangene Jahr.
const WRAPPED_VON = { monat: 11, tag: 1 };
const WRAPPED_BIS = { monat: 0, tag: 6 };

// Unter diesen Grenzen gibt es nichts zu feiern. Wer ELFIX am 20. Dezember
// installiert, soll keinen Jahresrueckblick ueber vier Folgen bekommen -
// aufrufen kann er ihn trotzdem, er draengt sich nur nicht auf.
const WRAPPED_MIN_FOLGEN = 10;
const WRAPPED_MIN_TAGE = 3;

// Welches Jahr gerade an der Reihe ist - oder null ausserhalb des Fensters.
function wrappedJahrFuer(jetzt = new Date()) {
  const monat = jetzt.getMonth();
  const tag = jetzt.getDate();
  if (monat === WRAPPED_VON.monat && tag >= WRAPPED_VON.tag) return jetzt.getFullYear();
  if (monat === WRAPPED_BIS.monat && tag <= WRAPPED_BIS.tag) return jetzt.getFullYear() - 1;
  return null;
}

function wrappedStatus(jahrWunsch) {
  const imFenster = wrappedJahrFuer();
  // Auf Wunsch jedes Jahr - der Knopf im Rueckblick soll auch im Juli gehen.
  const jahr = Number(jahrWunsch) || imFenster;
  if (!jahr) return { faellig: false, jahr: 0, daten: null };

  const daten = watchStatistik(String(jahr));
  const genug = daten.folgen >= WRAPPED_MIN_FOLGEN && daten.tage >= WRAPPED_MIN_TAGE;
  const schonGesehen = Number(settings.wrapped?.gesehenJahr) === jahr;
  return {
    // "Faellig" heisst: von selbst zeigen. Alles drei muss stimmen.
    faellig: Boolean(imFenster) && imFenster === jahr && genug && !schonGesehen,
    // "Saison" heisst nur: es ist Dezember und es gibt genug zu erzaehlen.
    // Anders als "faellig" bleibt das stehen, nachdem man den Rueckblick
    // angesehen hat - daran haengt, ob der Eintrag in der Seitenleiste
    // sichtbar ist, und der soll nicht mitten in der Saison verschwinden.
    saison: Boolean(imFenster) && imFenster === jahr && genug,
    jahr,
    genug,
    daten: daten.sitzungen ? daten : null
  };
}

ipcMain.handle("wrapped:status", (_event, jahr) => wrappedStatus(jahr));

// Das Archiv: Jahre, fuer die es genug zu erzaehlen gibt. Ein Jahr mit vier
// Folgen wird nicht als grosser Rueckblick angeboten - es stuende sonst als
// Versprechen da, das die Daten nicht halten.
ipcMain.handle("wrapped:jahre", () => {
  const jahre = [...new Set(loadSitzungen()
    .map((sitzung) => new Date(Date.parse(sitzung.begonnenAm)).getFullYear())
    .filter((jahr) => Number.isFinite(jahr)))].sort((links, rechts) => rechts - links);
  return jahre.filter((jahr) => {
    const daten = watchStatistik(String(jahr));
    return daten.folgen >= WRAPPED_MIN_FOLGEN && daten.tage >= WRAPPED_MIN_TAGE;
  });
});

// Gesehen heisst gesehen: der Rueckblick draengt sich in diesem Jahr nicht noch
// einmal auf. Aufrufen laesst er sich danach weiterhin.
ipcMain.handle("wrapped:gesehen", (_event, jahr) => {
  const wert = Number(jahr) || 0;
  if (!wert) return false;
  settings.wrapped = { ...(settings.wrapped || {}), gesehenJahr: wert };
  saveSettings();
  return true;
});

ipcMain.handle("wrapped:set-open", (_event, offen) => {
  setOverlayOpen("wrapped", Boolean(offen));
  return true;
});

// --- Empfohlen fuer dich -----------------------------------------------------
// Baut aus dem Verlauf ein Geschmacksprofil (siehe taste.js) und sucht dazu
// passende Titel: was die Anbieter selbst als aehnlich ausweisen, was in den
// Lieblingsgenres liegt und was neu auf den Startseiten steht.

function loadTasteCache() {
  if (tasteCache) return tasteCache;
  try {
    const roh = JSON.parse(fs.readFileSync(TASTE_FILE, "utf8"));
    // Aeltere Staende haben die Genre-Listen nur von Seite 1 der Anbieter
    // gelesen. Die ist alphabetisch sortiert, also standen dort lauter "A".
    // Solche Listen sind nicht bloss alt, sie sind falsch - sie werden sofort
    // verworfen, statt sechs Stunden lang abzulaufen. Die Detailseiten (pages)
    // sind davon nicht betroffen und bleiben: sie kosten die meiste Zeit.
    const veraltet = (Number(roh?.version) || 0) < TASTE_CACHE_VERSION;
    // Die Detailseiten bleiben - sie kosten die meiste Zeit und tragen die
    // Angaben, aus denen die externe Zuordnung entsteht. Ihr "Das schauen
    // andere"-Block wird aber verworfen und der Zeitstempel auf null gesetzt:
    // er stammt aus derselben Extraktion wie die Kacheln und traegt dieselben
    // falschen Titel und Bilder. Beim naechsten Lesen wird die Seite ohnehin
    // neu geholt, bis dahin bleiben Genres und Angaben nutzbar.
    const seitenRoh = roh?.pages && typeof roh.pages === "object" ? roh.pages : {};
    if (veraltet) {
      for (const eintrag of Object.values(seitenRoh)) {
        if (!eintrag || typeof eintrag !== "object") continue;
        delete eintrag.related;
        eintrag.at = 0;
      }
    }
    tasteCache = {
      version: TASTE_CACHE_VERSION,
      pages: seitenRoh,
      lists: !veraltet && roh?.lists && typeof roh.lists === "object" ? roh.lists : {},
      // Wie oft ein Werk schon vorgeschlagen wurde, ohne geoeffnet zu werden.
      anzeigen: roh?.anzeigen && typeof roh.anzeigen === "object" ? roh.anzeigen : {},
      // Die zuletzt berechneten Vorschlaege. Sie ueberdauern den Neustart,
      // damit die Startseite nicht jedes Mal auf zwei Dutzend Netzabrufe
      // wartet - neu gerechnet wird danach im Hintergrund.
      personal: !veraltet && roh?.personal && Array.isArray(roh.personal.items) ? roh.personal : null
    };
    // Die zuletzt gezeigten Vorschlaege stammen aus denselben kaputten Listen.
    // Sie muessen mit weg, sonst zeigt die Startseite sie weiter an.
    if (veraltet) personalCache = { at: 0, items: [], signatur: "", vollstaendig: false };
  } catch {
    tasteCache = { version: TASTE_CACHE_VERSION, pages: {}, lists: {}, anzeigen: {}, personal: null };
  }
  return tasteCache;
}

// Der Cache wird nur verzoegert geschrieben, damit ein Durchlauf mit vielen
// Seiten nicht dutzende Male dieselbe Datei anfasst.
function saveTasteCacheSoon() {
  if (tasteSaveTimer) return;
  tasteSaveTimer = setTimeout(() => {
    tasteSaveTimer = 0;
    try {
      ensureDataDir();
      fs.writeFileSync(TASTE_FILE, JSON.stringify(loadTasteCache()));
    } catch {
      // Ein fehlender Cache kostet nur Zeit, keine Funktion.
    }
  }, 1500);
  tasteSaveTimer.unref?.();
}

// --- Externe Metadaten --------------------------------------------------------
//
// Die App holt sie nicht selbst bei TMDB, sondern beim eigenen Relay - der
// TMDB-Schluessel darf nicht auf die Geraete. Welches Relay das ist, steht
// schon in den Einstellungen: es ist derselbe Server wie fuer die Watchparty.
// Eine zweite Adresse waere eine zweite Fehlerquelle und eine Einstellung, die
// niemand versteht.
//
// Wichtig ist, was hier NICHT passiert: kein Start wartet darauf. Die
// Empfehlungen entstehen aus dem, was lokal liegt; was fehlt, wird danach im
// Hintergrund geholt und wirkt sich beim naechsten Durchlauf aus.

let metadatenSpeicher = null;
let metadatenSaveTimer = 0;
let metadatenPending = null;
let metadatenZuletzt = 0;
// So lange nach einem Anreicherungslauf bleibt es dabei. Ohne diese Bremse
// zoege jeder Durchlauf den naechsten nach sich: anreichern, neu rechnen,
// wieder anreichern.
//
// Fuenf Minuten waren zu vorsichtig. Ein Lauf holt hoechstens ein paar hundert
// Titel, der Kandidatenpool ist vierstellig - bei fuenf Minuten Abstand haette
// eine Sitzung nicht gereicht, um die sichtbaren Reihen abzudecken. Anderthalb
// Minuten bleiben deutlich unter der Taktbremse des Relays (300 Titel je
// Minute) und decken die Startseite innerhalb weniger Minuten Nutzung ab.
const METADATEN_PAUSE_MS = 90 * 1000;

function metadatenAdresse() {
  const eigen = String(process.env.ELFIX_METADATEN_SERVER || "").trim();
  const roh = eigen || String(settings.watchparty?.serverUrl || "").trim();
  if (!roh) return "";
  // In den Einstellungen darf auch eine ws-Adresse stehen - es ist dieselbe
  // Maschine, nur das andere Protokoll.
  const mitSchema = /^[a-z]+:\/\//i.test(roh) ? roh : "https://" + roh;
  return mitSchema.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:").replace(/\/+$/, "");
}

function metadatenClient() {
  const adresse = metadatenAdresse();
  if (metadatenSpeicher && metadatenSpeicher.adresse === adresse) return metadatenSpeicher.client;
  const client = metadatenModul.erstellen({
    basis: adresse,
    // Chromiums Netzwerkschicht statt Nodes fetch - aus demselben Grund wie
    // bei den Anbieterseiten.
    holen: (url, aufbau) => net.fetch(url, aufbau),
    laden: () => JSON.parse(fs.readFileSync(METADATEN_FILE, "utf8")),
    speichern: (daten) => {
      metadatenStand = daten;
      metadatenSpeichernSoon();
    }
  });
  metadatenSpeicher = { adresse, client };
  return client;
}

let metadatenStand = null;

function metadatenSpeichernSoon() {
  if (metadatenSaveTimer) return;
  metadatenSaveTimer = setTimeout(() => {
    metadatenSaveTimer = 0;
    try {
      ensureDataDir();
      if (metadatenStand) fs.writeFileSync(METADATEN_FILE, JSON.stringify(metadatenStand));
    } catch {
      // Ohne Ablage kostet der naechste Start ein paar Abrufe mehr.
    }
  }, 2000);
  metadatenSaveTimer.unref?.();
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
  return loadTasteCache().pages?.[seite]?.meta || null;
}

// Externe Daten aus dem lokalen Cache - ohne einen einzigen Netzabruf. Das ist
// der Weg, den das Bauen der Empfehlungen nimmt.
function metadatenAusCache(name, url) {
  const wunsch = metadatenWunsch(name, url, seitenMeta(url));
  if (!wunsch) return null;
  try {
    return metadatenClient().ausCache(wunsch) || null;
  } catch {
    return null;
  }
}

// Zu welchem Anbieter gehoert eine Adresse? Gebraucht, um eine Detailseite
// nachzulesen, ohne den Kandidaten selbst mitschleppen zu muessen.
function anbieterZuAdresse(url) {
  try {
    const wirt = new URL(url).host;
    return enabledProviders().find((provider) => {
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
    client = metadatenClient();
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
      if (EMPFEHLUNG_DEBUG) {
        console.log(`[metadaten] ${ergebnisse.size} Titel angereichert,`
          + ` ${JSON.stringify(client.statistik())}`);
      }
      // Jetzt liegen bessere Daten vor als beim letzten Rechnen. Der
      // vorhandene Stand bleibt sichtbar; neu gerechnet wird beim naechsten
      // Abruf, und der kommt gleich - die Oberflaeche wird angestossen.
      personalCache = { ...personalCache, at: 0 };
      for (const fenster of BrowserWindow.getAllWindows()) {
        fenster.webContents.send("discover:personal-updated");
      }
    })
    .catch(() => null)
    .finally(() => {
      if (metadatenPending === lauf) metadatenPending = null;
    });
  metadatenPending = lauf;
  return lauf;
}

// Nodes eingebautes fetch erreicht im Hauptprozess nicht jede Anbieterseite -
// aniworld.to und filmo.to laufen dort in einen Timeout, waehrend dieselbe
// Adresse in der Browser-Ansicht laedt. Chromiums Netzwerkschicht (net.fetch)
// nimmt denselben Weg wie die Ansichten und kommt durch.
async function fetchProviderHtml(url) {
  const response = await net.fetch(url, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 ELFIX/0.2"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(9000)
  });
  if (!response.ok) return null;
  return { html: await response.text(), url: response.url || url };
}

// Detailseite eines Titels: Genres und der "Das schauen andere"-Block.
async function tastePage(url, provider, refresh = false) {
  const cache = loadTasteCache();
  const gespeichert = cache.pages[url];
  // Ein Eintrag ohne `meta` stammt aus der Zeit vor den Seitenangaben. Er ist
  // nicht alt, sondern unvollstaendig - und die fehlenden Angaben sind genau
  // die, mit denen sich ein Werk exakt zuordnen laesst. Also einmal nachlesen,
  // statt eine Woche auf den Ablauf zu warten.
  const vollstaendig = gespeichert && gespeichert.meta;
  if (!refresh && vollstaendig && Date.now() - gespeichert.at < TASTE_PAGE_CACHE_MS) return gespeichert;

  try {
    const seite = await fetchProviderHtml(url);
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
    saveTasteCacheSoon();
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
  const cache = loadTasteCache();
  const gespeichert = cache.lists[url];
  const gueltig = gespeichert
    && Number(gespeichert.version) === TASTE_CACHE_VERSION
    && Date.now() - gespeichert.at < TASTE_LIST_CACHE_MS;
  if (!refresh && gueltig) return gespeichert.items;

  try {
    const erste = await fetchProviderHtml(url);
    if (!erste) return gespeichert?.items || [];
    const blaettern = extractPagination(erste.html, erste.url);
    const seiten = seitenStichprobe(blaettern.letzte, TASTE_LIST_PAGES);

    // Seite 1 liegt schon vor - nur der Rest wird geholt.
    const weitere = seiten
      .filter((nummer) => nummer > 1)
      .map((nummer) => seitenAdresse(blaettern.muster, nummer, erste.url));
    const geladen = await inBatches(weitere, TASTE_FETCH_PARALLEL, (adresse) => fetchProviderHtml(adresse));

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

    const auswahl = gleichmaessigVerteilt(items, TASTE_LIST_SIZE);
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
    saveTasteCacheSoon();
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
  const cache = loadTasteCache();
  const eintrag = cache.lists[url];
  if (!eintrag) return 0;
  if ((eintrag.items || []).length >= TASTE_LIST_SIZE) return 0;

  // Listen aus der Zeit vor dem Nachschlag kennen weder ihr Blaettermuster
  // noch die schon gelesenen Seiten. Beides laesst sich mit einem Abruf
  // nachtragen: das Muster steht auf Seite 1, und gelesen wurde damals genau
  // die Stichprobe, die derselbe Code auch heute zieht.
  if (!eintrag.muster || !eintrag.seiten) {
    const erste = await fetchProviderHtml(url);
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
    const geladen = await inBatches(adressen, TASTE_FETCH_PARALLEL, (adresse) => fetchProviderHtml(adresse));
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
      eintrag.items = [...(eintrag.items || []), ...neue].slice(0, TASTE_LIST_SIZE);
      eintrag.at = Date.now();
    }
    cache.lists[url] = eintrag;
    saveTasteCacheSoon();
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
  const aktive = new Set(enabledProviders().map((provider) => provider.id));
  return favorites
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

let entdeckungCache = new Map();
let katalogPending = null;
let katalogLetzter = 0;
// Wo der naechste Nachschlag je Art ansetzt. Ohne diesen Zeiger holt jede
// Runde dieselben Listen und die uebrigen kaemen nie dran.
const katalogZeiger = new Map();
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
  const listen = loadTasteCache().lists || {};
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
  for (const provider of enabledProviders()) {
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
      if (EMPFEHLUNG_DEBUG) {
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
    const gespeichert = loadTasteCache().personal;
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

  const lauf = buildPersonalRecommendations(ENTDECKUNG_POOL_SIZE, refresh)
    .then((items) => {
      personalCache = { at: Date.now(), items, signatur: verlaufSignatur(), vollstaendig: true };
      const cache = loadTasteCache();
      // Auf die Platte geht nur der Anfang: daraus baut sich die Startseite
      // beim naechsten Start sofort auf. Den langen Rest rechnet die
      // Entdeckungsseite neu, wenn sie geoeffnet wird.
      cache.personal = {
        at: personalCache.at,
        signatur: personalCache.signatur,
        items: items.slice(0, PERSONAL_POOL_SIZE)
      };
      saveTasteCacheSoon();
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
  const anbieter = enabledProviders();
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
  for (const favorite of favorites) {
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
  for (const [adresse, eintrag] of Object.entries(loadTasteCache().pages || {})) {
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
  kandidaten.push(...nachRelevanzKappen([...ausGenres.values()], profil, TASTE_GENRE_KANDIDATEN));

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
    debug: EMPFEHLUNG_DEBUG
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

  if (EMPFEHLUNG_DEBUG) {
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
    ...favorites.map((favorite) => ({
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
  const cache = loadTasteCache();
  const karte = new Map();
  for (const [key, wert] of Object.entries(cache.anzeigen || {})) {
    karte.set(key, Number(wert?.n) || 0);
  }
  return karte;
}

function merkeEmpfehlungAngezeigt(eintraege) {
  const cache = loadTasteCache();
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
  if (geaendert) saveTasteCacheSoon();
}

// Wurde ein Vorschlag wirklich geoeffnet, war er offenbar doch interessant -
// dann faengt die Zaehlung von vorn an.
function vergissEmpfehlungsMuedigkeit(url, titel, typ) {
  const cache = loadTasteCache();
  if (!cache.anzeigen) return;
  const key = titelModul.werkSchluessel(titel || "", typ || candidateMediaType(url));
  if (cache.anzeigen[key]) {
    delete cache.anzeigen[key];
    saveTasteCacheSoon();
  }
}

function usesAniWorldAjaxSearch(provider) {
  const name = String(provider?.name || "").toLowerCase();
  const host = providerModel.hostFromUrl(provider?.startUrl || "").toLowerCase();
  return name.includes("aniworld") || host.includes("aniworld");
}

function providerSearchFailure(provider, searchUrl, error) {
  return {
    providerId: provider.id,
    providerName: provider.name,
    searchUrl,
    error,
    results: []
  };
}

function extractSearchLinks(html, baseUrl, query, provider) {
  const results = [];
  const seen = new Set();
  const tokens = queryTokens(query);
  const anchorPattern = /<a\b([^>]*)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(html)) && results.length < 16) {
    const href = absoluteHttpUrl(match[2], baseUrl);
    if (!href || seen.has(href) || isNoiseUrl(href) || !isProviderResultUrl(href, baseUrl, provider)) continue;

    const rawTitle = cleanAnchorText(match[4]) || cleanAnchorText(`${readHtmlAttribute(match[1], "title")} ${readHtmlAttribute(match[3], "title")} ${readHtmlAttribute(match[1], "aria-label")} ${readHtmlAttribute(match[3], "aria-label")}`);
    const cleaned = normalizeSearchResultTitle(rawTitle, provider, query) || { title: rawTitle, genre: "" };
    const title = usableResultTitle(cleaned.title) || titleFromPath(href);
    if (!title || title.length < 2 || isNoiseTitle(title)) continue;
    if (!matchesQuery(title, href, tokens)) continue;

    seen.add(href);
    results.push({ title, genre: cleaned.genre || "", url: href });
  }
  appendRawContentLinks(results, seen, html, baseUrl, tokens, provider);
  return results;
}

function normalizeSearchResultTitle(title, provider, query) {
  const raw = cleanAnchorText(title);
  if (!raw) return { title: "", genre: "" };
  if (!isFilmoProvider(provider)) return { title: raw, genre: "" };

  const genres = [
    "action",
    "abenteuer",
    "animation",
    "anime",
    "biografie",
    "comedy",
    "crime",
    "dokumentation",
    "drama",
    "familie",
    "fantasy",
    "geschichte",
    "horror",
    "komödie",
    "komoedie",
    "krimi",
    "musik",
    "mystery",
    "romantik",
    "science fiction",
    "sci-fi",
    "thriller",
    "western"
  ];
  const pattern = new RegExp(`^(${genres.map(escapeRegExp).join("|")})\\s+(.{2,})$`, "i");
  const match = raw.match(pattern);
  if (!match) return { title: raw, genre: "" };

  const candidateTitle = match[2].replace(/^[\\s:|–-]+/, "").trim();
  if (!candidateTitle || isNoiseTitle(candidateTitle)) return { title: raw, genre: "" };
  const queryText = normalizeSearchText(query);
  const candidateText = normalizeSearchText(candidateTitle);
  const rawText = normalizeSearchText(raw);
  const shouldSplit = !queryText
    || candidateText.includes(queryText)
    || queryText.split(" ").some((token) => token.length > 2 && candidateText.includes(token))
    || rawText !== candidateText;
  return shouldSplit ? { title: candidateTitle, genre: titleCaseGenre(match[1]) } : { title: raw, genre: "" };
}

function titleCaseGenre(value) {
  return String(value || "")
    .replace(/komoedie/i, "Komödie")
    .split(/\s+/)
    .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : "")
    .join(" ");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function appendRawContentLinks(results, seen, html, baseUrl, tokens, provider) {
  const urlPattern = /(?:href|data-href|data-url)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = urlPattern.exec(html)) && results.length < 16) {
    const href = absoluteHttpUrl(match[1], baseUrl);
    if (!href || seen.has(href) || isNoiseUrl(href) || !isProviderResultUrl(href, baseUrl, provider)) continue;
    const title = titleFromPath(href);
    if (!title || isNoiseTitle(title) || !matchesQuery(title, href, tokens)) continue;
    seen.add(href);
    results.push({ title, url: href });
  }
}

function searchQueryVariants(query) {
  const original = String(query || "").trim().replace(/\s+/g, " ");
  if (!original) return [];

  const variants = new Set();
  const add = (value) => {
    const normalized = String(value || "").trim().replace(/\s+/g, " ");
    if (normalized) variants.add(normalized);
  };

  add(original);
  const ascii = stripSearchAccents(original).toLowerCase();
  add(ascii);
  add(ascii.replace(/[._:]+/g, " "));
  add(ascii.replace(/[-_]+/g, " "));
  add(ascii.replace(/\s+/g, "-"));
  add(ascii.replace(/\s+/g, ""));
  add(ascii.replace(/-/g, ""));
  add(ascii.replace(/-/g, " "));
  add(ascii.replace(/\band\b/g, "und"));
  add(ascii.replace(/\bund\b/g, "and"));
  addSimilarTitleVariants(ascii, add);
  addKnownTitleVariants(ascii, add);

  return Array.from(variants).slice(0, 24);
}

function stripSearchAccents(value) {
  return String(value || "")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function addKnownTitleVariants(query, add) {
  const compact = query.replace(/[^a-z0-9]+/g, "");
  const phrases = [
    ["spider", "man"],
    ["bat", "man"],
    ["super", "man"],
    ["iron", "man"],
    ["ant", "man"],
    ["aqua", "man"],
    ["wonder", "woman"],
    ["dragon", "ball"],
    ["one", "piece"],
    ["one", "punch", "man"],
    ["black", "clover"],
    ["black", "torch"],
    ["chainsaw", "man"],
    ["demon", "slayer"],
    ["jujutsu", "kaisen"],
    ["attack", "on", "titan"],
    ["my", "hero", "academia"],
    ["sword", "art", "online"],
    ["solo", "leveling"],
    ["fairy", "tail"],
    ["death", "note"],
    ["blue", "lock"],
    ["game", "of", "thrones"],
    ["prison", "break"],
    ["star", "wars"],
    ["star", "trek"]
  ];

  for (const parts of phrases) {
    const joined = parts.join("");
    if (compact === joined || compact.includes(joined)) {
      add(parts.join(" "));
      add(parts.join("-"));
      add(joined);
    }
  }
}

function addSimilarTitleVariants(query, add) {
  const tokens = normalizeSearchText(query).split(" ").filter(Boolean);
  if (tokens.length < 2) return;

  const articleWords = new Set(["the", "a", "an", "der", "die", "das", "den", "dem", "ein", "eine"]);
  const variants = new Set();
  const pushTokens = (items) => {
    const cleaned = items.filter(Boolean);
    if (cleaned.length >= 2) variants.add(cleaned.join(" "));
  };

  const singular = tokens.map((token) => singularSearchToken(token));
  pushTokens(singular);
  pushTokens(tokens.filter((token) => !articleWords.has(token)));
  pushTokens(singular.filter((token) => !articleWords.has(token)));

  for (const items of [tokens, singular]) {
    const ofIndex = items.indexOf("of");
    if (ofIndex >= 0 && items[ofIndex + 1] !== "the") {
      pushTokens([...items.slice(0, ofIndex + 1), "the", ...items.slice(ofIndex + 1)]);
    }
  }

  for (const value of variants) {
    add(value);
    add(value.replace(/\s+/g, "-"));
    add(value.replace(/\s+/g, ""));
  }
}

function singularSearchToken(token) {
  if (/ies$/i.test(token) && token.length > 4) return token.replace(/ies$/i, "y");
  if (/ves$/i.test(token) && token.length > 4) return token.replace(/ves$/i, "f");
  if (/s$/i.test(token) && token.length > 3 && !/(ss|us|is)$/i.test(token)) return token.slice(0, -1);
  return token;
}

function queryTokens(query) {
  return stripSearchAccents(query)
    .toLowerCase()
    .match(/[a-z0-9]+/gi)?.filter((token) => token.length > 1) || [];
}

function matchesQuery(title, href, tokens) {
  if (!tokens.length) return true;
  const pathText = searchablePathText(href);
  if (tokens.every((token) => pathText.includes(token))) return true;
  const compactPath = pathText.replace(/\s+/g, "");
  const compactQuery = tokens.join("");
  if (compactQuery && compactPath.includes(compactQuery)) return true;

  const titleText = normalizeSearchText(title);
  const queryPhrase = tokens.join(" ");
  return (titleText === queryPhrase || titleText.replace(/\s+/g, "").includes(compactQuery)) && contentPathLooksPlayable(href);
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function searchablePathText(href) {
  try {
    const url = new URL(href);
    return normalizeSearchText(decodeURIComponentSafe(url.pathname));
  } catch {
    return "";
  }
}

function normalizeSearchText(value) {
  return stripSearchAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentPathLooksPlayable(href) {
  try {
    const pathName = String(href || "").startsWith("/") ? String(href || "") : new URL(href).pathname;
    return /(\/stream\/|\/serie\/|\/series\/|\/anime\/|\/film\/|\/filme\/|\/movie\/|\/movies\/|\/watch\/|\/title\/)/i.test(pathName);
  } catch {
    return false;
  }
}

function isProviderResultUrl(href, baseUrl, provider) {
  try {
    const target = new URL(href);
    const base = new URL(baseUrl);
    if (!isAllowedResultHost(target.hostname, base.hostname, provider)) return false;
    const targetPath = target.pathname.replace(/\/+$/, "") || "/";
    const basePath = base.pathname.replace(/\/+$/, "") || "/";
    if (target.href === base.href || targetPath === basePath) return false;
    if (/(^|\/)(search|suche|login|register|logout|settings|profile|account|language|languages?)(\/|$)/i.test(targetPath)) return false;
    return isKnownContentPath(targetPath, target.hostname, provider);
  } catch {
    return false;
  }
}

function isKnownContentPath(pathName, hostname, provider) {
  const host = String(hostname || "").toLowerCase();
  const name = String(provider?.name || "").toLowerCase();
  if (host.includes("aniworld") || name.includes("aniworld")) {
    return /^\/anime\/stream\/[^/]+\/?$/i.test(pathName);
  }
  if (host === "s.to" || host.endsWith(".s.to") || name === "s.to" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return /^\/serie\/(?:stream\/)?[^/]+\/?$/i.test(pathName);
  }
  if (host.includes("filmo") || name.includes("filmo")) {
    return /^\/(film|filme|movie|movies|stream)\/[^/]+\/?$/i.test(pathName)
      || /^\/[^/]*[a-z][^/]*-[^/]+\/?$/i.test(pathName);
  }
  return contentPathLooksPlayable(pathName);
}

function readHtmlAttribute(attrs, name) {
  const match = String(attrs || "").match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match ? match[1] : "";
}

function usableResultTitle(title) {
  const value = String(title || "").trim();
  if (!value || value.length > 90 || isNoiseTitle(value)) return "";
  return value;
}

function isNoiseUrl(url) {
  return /\/(login|register|logout|impressum|privacy|datenschutz|agb|terms)(\/|$)/i.test(url)
    || /\/(forum|forums|thread|threads|community|support|blog|news|empfehlungen|recommendations?|kommentar|comments?)(\/|$)/i.test(url)
    || /[?&](replytocom|share|utm_)/i.test(url);
}

// Dieselbe Regel wie in discover.js: eine Auszeichnung mitten im Wort darf
// kein Leerzeichen hinterlassen. Die Suche der Anbieter markiert die
// Fundstelle im Titel, und daran ist der Name zerbrochen.
const INLINE_TAGS = /<\/?(?:em|strong|b|i|u|mark|span|small|wbr|font|abbr|cite|q|sub|sup)(?:\s[^>]*)?>/gi;

function cleanAnchorText(value) {
  return decodeHtmlEntities(
    String(value || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(INLINE_TAGS, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function isNoiseTitle(title) {
  return /^(home|start|login|registrieren|register|impressum|datenschutz|mehr|weiter|zurueck|zurück)$/i.test(title)
    || /\b(jan|feb|mar|apr|mai|jun|jul|aug|sep|okt|nov|dez)\b/i.test(title)
    || /\b(20\d{2}|19\d{2})\b.*\b(\d{1,2}:\d{2}|folge|staffel|update|uncut|deutsch|german|verfuegbar|verfügbar|freundliche|gruesse|grüße|wann kommt)\b/i.test(title)
    || /\b(folge|staffel)\b.*\b(vertauscht|falsch|nicht verfuegbar|nicht verfügbar|update|uncut|deutsch|wann kommt)\b/i.test(title);
}

function loadProviders() {
  try {
    const raw = JSON.parse(fs.readFileSync(PROVIDER_FILE, "utf8"));
    const loaded = providerModel.normalizeProviders(raw);
    if (loaded.length) return loaded;
  } catch {
    // Fall through to defaults.
  }
  return providerModel.defaultProviders();
}

function saveProviders() {
  ensureDataDir();
  fs.writeFileSync(PROVIDER_FILE, JSON.stringify(providers, null, 2));
}

// YouTube einmalig nachtragen.
//
// Eine frisch angelegte Anbieterliste bringt YouTube mit. Wer ELFIX schon
// laenger benutzt, hat seine Liste aber von einer Fassung geerbt, die es noch
// nicht kannte - und damit auch nichts von dem, was inzwischen daran haengt:
// die eigene Reihe auf der Startseite, der Reiter in der Mediathek, die
// YouTube-Watchparty. All das setzt den Anbieter voraus.
//
// Einmalig heisst hier wirklich einmalig, und darauf kommt es an. Der Merker
// wird gesetzt, bevor ueberhaupt geprueft wird, ob etwas zu tun ist. Wer
// YouTube danach aus seiner Liste wirft, hat es damit geworfen - ein Nachtrag,
// der bei jedem Start wieder anruecke, waere keine Ergaenzung, sondern eine
// Weigerung, die Entscheidung des Benutzers anzunehmen.
//
// Erkannt wird ein vorhandener Eintrag an seiner Adresse, nicht am Namen: wer
// ihn "YT" oder "Youtube (DE)" genannt hat, soll keinen zweiten bekommen.
function youtubeAnbieterNachtragen() {
  if (settings.migrations?.youtubeProvider === true) return false;
  settings.migrations = { ...(settings.migrations || {}), youtubeProvider: true };
  saveSettings();

  if (providers.some((eintrag) => youtube.istYoutubeUrl(eintrag.startUrl))) return false;
  const vorlage = providerModel.defaultProviders()
    .find((eintrag) => youtube.istYoutubeUrl(eintrag.startUrl));
  if (!vorlage) return false;

  // Ans Ende und sichtbar. Eine eigene Kennung, damit er sich nicht mit einem
  // Eintrag aus einer anderen Ablage beisst.
  providers.push({
    ...vorlage,
    id: crypto.randomUUID(),
    enabled: true,
    sortOrder: providers.length
  });
  saveProviders();
  console.log("[ELFIX] YouTube als Anbieter nachgetragen");
  return true;
}

function loadFavorites() {
  youtubeGeradegezogen = 0;
  try {
    const raw = JSON.parse(fs.readFileSync(FAVORITES_FILE, "utf8"));
    if (!Array.isArray(raw)) return [];
    const geladen = raw.map((favorite) => normalizeLoadedFavorite({
      id: String(favorite.id || crypto.randomUUID()),
      providerId: String(favorite.providerId || ""),
      providerName: String(favorite.providerName || ""),
      title: cleanTitle(favorite.title || favorite.url || "Favorit"),
      url: String(favorite.url || ""),
      normalizedUrl: normalizeFavoriteUrl(favorite.normalizedUrl || favorite.url || ""),
      favicon: String(favorite.favicon || ""),
      thumbnail: String(favorite.thumbnail || ""),
      logo: String(favorite.logo || ""),
      favorite: favorite.favorite !== false,
      watched: Boolean(favorite.watched),
      completed: normalizeStoredCompletion(favorite),
      episodeCompleted: normalizeStoredEpisodeCompletion(favorite),
      continuePending: Boolean(favorite.continuePending),
      completedEpisodes: normalizeCompletedEpisodes(favorite.completedEpisodes),
      hideFromContinueWatching: Boolean(favorite.hideFromContinueWatching),
      progress: sanitizeProgress(favorite.progress),
      duration: sanitizePositiveNumber(favorite.duration),
      position: sanitizePositiveNumber(favorite.position),
      currentTime: sanitizePositiveNumber(favorite.currentTime || favorite.position),
      type: String(favorite.type || inferMediaType(favorite.url || "")),
      season: sanitizePositiveNumber(favorite.season),
      episode: sanitizePositiveNumber(favorite.episode),
      finalSeason: sanitizePositiveNumber(favorite.finalSeason),
      finalEpisode: sanitizePositiveNumber(favorite.finalEpisode),
      lastWatchedAt: String(favorite.lastWatchedAt || ""),
      completedAt: String(favorite.completedAt || ""),
      // Selbst gelegte Stelle in der Mediathek. Ohne diese Zeile faellt sie
      // beim Laden weg, weil hier nur bekannte Felder uebernommen werden.
      libraryOrder: Number.isFinite(Number(favorite.libraryOrder)) && Number(favorite.libraryOrder) >= 0
        ? Number(favorite.libraryOrder)
        : null,
      // Zu welcher Watchparty dieser Eintrag gehoert. Leer heisst: der eigene.
      watchpartyRoom: String(favorite.watchpartyRoom || ""),
      // Selbst gewaehltes Bild - hat Vorrang vor dem der Anbieterseite.
      customThumbnail: String(favorite.customThumbnail || ""),
      // Wie dieses Bild im Banner sitzt. null heisst "wie immer": vollflaechig
      // und mittig. Ohne diese Zeile faellt die Formatierung beim Neustart weg,
      // weil hier nur bekannte Felder uebernommen werden.
      customThumbnailCrop: bildausschnitt.normalisierenOderNull(favorite.customThumbnailCrop),
      // Von Hand abgehakt: bleibt auch beim Wiederansehen in der Mediathek.
      completedManually: Boolean(favorite.completedManually),
      // Hinweis auf Nachschub zu einer Serie, die schon abgeschlossen war.
      newEpisodeAt: String(favorite.newEpisodeAt || ""),
      newEpisodeLabel: String(favorite.newEpisodeLabel || ""),
      activity: normalizeActivity(favorite.activity),
      createdAt: String(favorite.createdAt || new Date().toISOString()),
      openedAt: String(favorite.openedAt || ""),
      updatedAt: String(favorite.updatedAt || "")
    })).filter((favorite) => providerModel.isHttpUrl(favorite.url))
      // Shorts werden seit dem YouTube-Umbau gar nicht mehr gemerkt. Was aus
      // der Zeit davor noch herumliegt, kommt hier weg - sonst blieben die
      // Eintraege ewig in der Ablage stehen, ohne dass man sie je zu sehen
      // bekaeme.
      .filter((favorite) => !youtube.istShortsUrl(favorite.url));
    // Aeltere Staende koennen den Widerspruch schon enthalten: die Titel waren
    // von Hand abgehakt, standen aber nicht mehr in der Mediathek. Sie kommen
    // beim Laden zurueck.
    const gerichtet = widersprucheGeraderichten(geladen);
    if (gerichtet) console.log(`[ELFIX] ${gerichtet} Titel in die Mediathek zurueckgeholt`);
    // Steht bewusst hinter dem Ausgleich: mediathektest prueft, dass
    // widersprucheGeraderichten() beim Laden laeuft, und misst dafuer den
    // Abstand zum Anfang der Funktion. Alles, was nicht davor stehen muss,
    // gehoert dahinter.
    const shortsWeg = raw.length - geladen.length - raw.filter((f) => !providerModel.isHttpUrl(String(f.url || ""))).length;
    if (youtubeGeradegezogen || shortsWeg > 0) {
      console.log(`[ELFIX YOUTUBE] ${youtubeGeradegezogen} wieder offen, ${Math.max(0, shortsWeg)} Short(s) entfernt`);
    }
    return geladen;
  } catch {
    return [];
  }
}

// Bis 1.15.0 klebte ein eigenes Bild an genau der Kachel, auf der es gesetzt
// wurde. Wer es damals gewaehlt hat, soll es nicht noch einmal tun muessen:
// beim Laden wandert es einmal an alle Eintraege desselben Titels. Wer irgendwo
// schon ein eigenes Bild hat, behaelt es - ueberschrieben wird nichts.
function verteileEigeneBilder(liste) {
  let nachgezogen = 0;
  for (const eintrag of liste) {
    if (eintrag.customThumbnail) continue;
    const vorbild = liste.find((item) => item.customThumbnail && istGleicherTitel(item, eintrag));
    if (!vorbild) continue;
    eintrag.customThumbnail = vorbild.customThumbnail;
    // Der Ausschnitt gehoert zu dem Bild, das gerade uebernommen wird - er
    // darf nicht bei dem alten stehenbleiben.
    eintrag.customThumbnailCrop = bildausschnitt.normalisierenOderNull(vorbild.customThumbnailCrop);
    nachgezogen += 1;
  }
  if (nachgezogen) console.log(`[ELFIX] eigenes Bild auf ${nachgezogen} weitere Eintraege uebernommen`);
  return nachgezogen > 0;
}

function normalizeStoredCompletion(favorite) {
  if (!favorite?.completed && !isCompletedProgress(favorite?.progress)) return false;
  const type = String(favorite?.type || inferMediaType(favorite?.url || ""));
  if (type === "film") return true;
  if (type !== "serie") return !episodeIdentity(favorite?.url || "");
  return isWholeMediaCompleted({
    type,
    finalSeason: favorite?.finalSeason,
    finalEpisode: favorite?.finalEpisode
  }, favorite?.url || "", true);
}

function normalizeStoredEpisodeCompletion(favorite) {
  if (normalizeStoredCompletion(favorite)) return false;
  const type = String(favorite?.type || inferMediaType(favorite?.url || ""));
  return type === "serie" && Boolean(favorite?.episodeCompleted || isCompletedProgress(favorite?.progress));
}

// Wie viele Eintraege beim letzten Laden geradegezogen wurden. Ohne diese Zahl
// bliebe die Reparatur nur im Speicher: geschrieben wird die Ablage erst, wenn
// sich sonst etwas aendert, und bis dahin saehe die Datei weiter falsch aus.
let youtubeGeradegezogen = 0;

function normalizeLoadedFavorite(favorite) {
  // YouTube-Karten bekommen ihr Bild aus der Videokennung. Das ist reine
  // Rechnerei, kostet also nichts, und es raeumt gleich die Karten auf, die
  // noch ein zusammengesuchtes Bild aus der Empfehlungsspalte tragen - sonst
  // haetten die es behalten, denn beim Fortschritt wird das Bild eines
  // bestehenden Eintrags nicht mehr angefasst.
  if (youtube.istYoutubeUrl(favorite?.url || "")) {
    if (!youtube.istVorschaubildUrl(favorite?.thumbnail)) {
      const kandidaten = youtube.vorschaubildKandidaten(favorite.url);
      if (kandidaten.length) favorite.thumbnail = kandidaten[kandidaten.length - 1];
    }
    // Der Merker "abgeschlossen" war bei YouTube klebrig: einmal gesetzt, galt
    // das Video fuer immer als durch. Eintraege aus dieser Zeit tragen ihn bei
    // achtundzwanzig Prozent und waren damit aus "Weiterschauen" verschwunden,
    // obwohl sie offen sind. Beim Laden wird das am gespeicherten Stand
    // geradegezogen - von Hand Abgehaktes bleibt abgehakt.
    if (favorite.completed && !favorite.completedManually
      && sanitizeProgress(favorite.progress) < COMPLETED_PROGRESS_PERCENT) {
      favorite.completed = false;
      // Der Bedingung nach ist es hier ohnehin schon false. Es steht trotzdem
      // da: "abgehakt, aber nicht abgeschlossen" ist der Widerspruch, ueber
      // den Titel frueher unrettbar aus der Mediathek verschwanden, und
      // mediathektest besteht zu Recht darauf, dass jede Stelle, die
      // `completed` loescht, den Merker mitloescht.
      favorite.completedManually = false;
      favorite.completedAt = "";
      favorite.hideFromContinueWatching = false;
      youtubeGeradegezogen += 1;
    }
    return favorite;
  }
  if (isStoFavoriteRecord(favorite)) {
    const thumbnail = absoluteHttpUrl(favorite.thumbnail, favorite.url);
    const passend = isStoChannelArtworkUrl(thumbnail) && stoArtworkMatchesFavorite(thumbnail, favorite.url);
    favorite.thumbnail = passend ? thumbnail : "";
    return favorite;
  }
  if (isAniWorldFavoriteRecord(favorite)) {
    const thumbnail = absoluteHttpUrl(favorite.thumbnail, favorite.url);
    favorite.thumbnail = isAniWorldArtworkUrl(thumbnail) ? thumbnail : "";
    return favorite;
  }
  return favorite;
}

// "Von Hand abgehakt" und "nicht abgeschlossen" schliessen einander aus. Trat
// das trotzdem auf, war der Titel aus der Mediathek verschwunden und liess sich
// von dort nicht mehr zurueckholen. Beim Laden und vor jedem Schreiben wird das
// gerade gezogen - einmal an einer Stelle, statt an jeder der acht, die diese
// Felder anfassen.
function widersprucheGeraderichten(liste = favorites) {
  let geaendert = 0;
  for (const favorite of liste) {
    if (!favorite?.completedManually || favorite.completed) continue;
    favorite.completed = true;
    if (!favorite.completedAt) favorite.completedAt = new Date().toISOString();
    favorite.hideFromContinueWatching = true;
    geaendert += 1;
  }
  return geaendert;
}

function saveFavorites() {
  ensureDataDir();
  widersprucheGeraderichten();
  fs.writeFileSync(FAVORITES_FILE, JSON.stringify(favorites, null, 2));
  // Der eine Punkt, an dem sich am Bestand wirklich etwas geaendert hat. Ihn
  // zu nehmen statt der zwei Dutzend Stellen, die Staende anfassen, ist der
  // Grund, warum der Abgleich nichts verpassen kann - auch nicht das Abhaken
  // von Hand oder das Umsortieren der Mediathek.
  geraeteAbgleichSpaeter();
}

function moveFavoriteToFront(favorite) {
  if (!favorite?.id) return false;
  const index = favorites.findIndex((item) => item.id === favorite.id);
  if (index <= 0) {
    favorite.openedAt = new Date().toISOString();
    if (index === 0) saveFavorites();
    return index === 0;
  }
  favorite.openedAt = new Date().toISOString();
  favorites.splice(index, 1);
  favorites.unshift(favorite);
  saveFavorites();
  sendActiveState();
  return true;
}

async function repairFavoriteThumbnailIfNeeded(favorite, provider, force = false) {
  if (!favorite || !isProviderWithSpecificArtwork(favorite, provider)) return false;
  if (!force && !favoriteNeedsThumbnailRepair(favorite, provider)) return false;

  const pageUrl = favoriteArtworkPageUrl(favorite, provider);
  const artwork = await fetchProviderArtwork(pageUrl, favorite, provider).catch(() => "");
  if (!artwork || artwork === favorite.thumbnail) return false;

  favorite.thumbnail = artwork;
  saveFavorites();
  sendActiveState();
  return true;
}

function favoriteNeedsThumbnailRepair(favorite, provider) {
  if (isStoFavoriteRecord(favorite, provider)) {
    const thumbnail = absoluteHttpUrl(favorite.thumbnail, favorite.url || provider?.startUrl || "");
    return !thumbnail || thumbnail !== favorite.thumbnail || !isStoChannelArtworkUrl(thumbnail);
  }
  if (isAniWorldFavoriteRecord(favorite, provider)) {
    const thumbnail = absoluteHttpUrl(favorite.thumbnail, favorite.url || provider?.startUrl || "");
    return !thumbnail || thumbnail !== favorite.thumbnail || !isAniWorldArtworkUrl(thumbnail);
  }
  return false;
}

function isProviderWithSpecificArtwork(favorite, provider) {
  return isStoFavoriteRecord(favorite, provider) || isAniWorldFavoriteRecord(favorite, provider);
}

function favoriteArtworkPageUrl(favorite, provider) {
  if (isStoFavoriteRecord(favorite, provider)) return stoSeriesPageUrlFromFavoriteUrl(favorite.url) || favorite.url;
  if (isAniWorldFavoriteRecord(favorite, provider)) return aniWorldSeriesPageUrlFromFavoriteUrl(favorite.url) || favorite.url;
  return favorite.url;
}

async function fetchProviderArtwork(pageUrl, favorite, provider) {
  if (isStoFavoriteRecord(favorite, provider)) return fetchStoArtwork(pageUrl, favorite);
  if (isAniWorldFavoriteRecord(favorite, provider)) return fetchAniWorldArtwork(pageUrl, favorite);
  const thumbnail = absoluteHttpUrl(favorite.thumbnail, favorite.url || provider?.startUrl || "");
  return thumbnail;
}

async function fetchStoArtwork(pageUrl, favorite) {
  if (!providerModel.isHttpUrl(pageUrl)) return "";
  const response = await fetch(pageUrl, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 ELFIX/0.2"
    },
    redirect: "follow"
  });
  if (!response.ok) return "";
  const html = await response.text();
  return extractStoArtworkFromHtml(html, pageUrl, favorite);
}

async function fetchAniWorldArtwork(pageUrl, favorite) {
  if (!providerModel.isHttpUrl(pageUrl)) return "";
  const response = await fetch(pageUrl, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 ELFIX/0.2",
      "referer": "https://aniworld.to/"
    },
    redirect: "follow"
  });
  if (!response.ok) return "";
  const html = await response.text();
  return extractAniWorldArtworkFromHtml(html, pageUrl, favorite);
}

function extractAniWorldArtworkFromHtml(html, baseUrl, favorite) {
  const expectedTokens = expectedAniWorldArtworkTokens(favorite?.url, favorite?.title);
  const candidates = [];
  const seen = new Set();
  const addCandidate = (href, attrs, context, baseScore) => {
    const url = absoluteHttpUrl(href, baseUrl);
    if (!url || seen.has(url) || !isAniWorldArtworkUrl(url)) return;
    seen.add(url);
    const text = normalizeSearchText(`${decodeHtmlEntities(readHtmlAttribute(attrs, "alt"))} ${decodeHtmlEntities(readHtmlAttribute(attrs, "title"))} ${context} ${url}`);
    const overlap = expectedTokens.filter((token) => text.includes(token)).length;
    if (expectedTokens.length && overlap === 0 && !aniWorldUrlLooksLikeSlug(url, favorite?.url)) return;
    let score = baseScore + overlap * 520;
    if (/cover|poster|series?|serie|anime|stream|detail|description|info/i.test(attrs + " " + context)) score += 260;
    if (aniWorldUrlLooksLikeSlug(url, favorite?.url)) score += 900;
    candidates.push({ href: url, score });
  };

  const metaPattern = /<meta\b[^>]*(?:property|name)\s*=\s*["'](?:og:image|twitter:image)["'][^>]*>/gi;
  let match;
  while ((match = metaPattern.exec(html))) {
    addCandidate(readHtmlAttribute(match[0], "content"), match[0], "meta image", 1200);
  }

  const imagePattern = /<img\b[^>]*(?:src|srcset|data-src|data-srcset|data-lazy-src|data-original)\s*=\s*["'][^"']+["'][^>]*>/gi;
  while ((match = imagePattern.exec(html))) {
    const attrs = match[0];
    const href = bestAniWorldImageFromAttributes(attrs, baseUrl);
    addCandidate(href, attrs, nearbyHtmlText(html, match.index, 900), 1600);
  }

  const bgPattern = /<[^>]+(?:data-bg|data-background|data-image|style)\s*=\s*["'][^"']+(?:url\(|\/)[^"']+["'][^>]*>/gi;
  while ((match = bgPattern.exec(html))) {
    const attrs = match[0];
    const href = readHtmlAttribute(attrs, "data-bg")
      || readHtmlAttribute(attrs, "data-background")
      || readHtmlAttribute(attrs, "data-image")
      || cssBackgroundUrl(readHtmlAttribute(attrs, "style"));
    addCandidate(href, attrs, nearbyHtmlText(html, match.index, 900), 1100);
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.href || "";
}

function bestAniWorldImageFromAttributes(attrs, baseUrl) {
  const srcset = readHtmlAttribute(attrs, "data-srcset") || readHtmlAttribute(attrs, "srcset");
  const fromSrcset = bestGenericSrcsetImage(srcset, baseUrl, isAniWorldArtworkUrl);
  if (fromSrcset) return fromSrcset;

  return absoluteHttpUrl(
    readHtmlAttribute(attrs, "data-src")
      || readHtmlAttribute(attrs, "data-lazy-src")
      || readHtmlAttribute(attrs, "data-original")
      || readHtmlAttribute(attrs, "data-image")
      || readHtmlAttribute(attrs, "src"),
    baseUrl
  );
}

function bestGenericSrcsetImage(srcset, baseUrl, predicate) {
  const candidates = String(srcset || "")
    .split(",")
    .map((entry) => {
      const parts = entry.trim().split(/\s+/);
      const href = absoluteHttpUrl(parts[0], baseUrl);
      const descriptor = parts[1] || "";
      const scale = descriptor.endsWith("x") ? Number.parseFloat(descriptor) || 1 : 1;
      const width = descriptor.endsWith("w") ? Number.parseFloat(descriptor) || 0 : 0;
      return { href, scale, width };
    })
    .filter((candidate) => candidate.href && (!predicate || predicate(candidate.href)))
    .sort((a, b) => (b.scale - a.scale) || (b.width - a.width));
  return candidates[0]?.href || "";
}

function cssBackgroundUrl(value) {
  const match = String(value || "").match(/url\(["']?([^"')]+)["']?\)/i);
  return match ? match[1] : "";
}

function nearbyHtmlText(html, index, radius) {
  const start = Math.max(0, index - radius);
  const end = Math.min(html.length, index + radius);
  return decodeHtmlEntities(html.slice(start, end).replace(/<[^>]+>/g, " "));
}

function expectedAniWorldArtworkTokens(url, title) {
  const slug = aniWorldMediaSlugFromUrl(url);
  const roh = [
    ...normalizeSearchText(slug).split(" "),
    ...normalizeSearchText(title).split(" ")
  ].filter((token) => token.length > 2 && !/^(anime|stream|staffel|folge|episode|kostenlos|gratis|online|ansehen|aniworld|animes)$/i.test(token));
  const ohneFuellwoerter = roh.filter((token) => !FUELLWOERTER.test(token));
  return Array.from(new Set(ohneFuellwoerter.length ? ohneFuellwoerter : roh));
}

function aniWorldUrlLooksLikeSlug(imageUrl, favoriteUrl) {
  const slug = aniWorldMediaSlugFromUrl(favoriteUrl);
  if (!slug) return false;
  return normalizeSearchText(imageUrl).replace(/\s+/g, "-").includes(slug);
}

function extractStoArtworkFromHtml(html, baseUrl, favorite) {
  const expectedTokens = expectedArtworkTokens(favorite?.url, favorite?.title);
  const imagePattern = /<img\b[^>]*(?:src|srcset|data-src|data-srcset)\s*=\s*["'][^"']*\/media\/images\/channel\/[^>]*>/gi;
  let match;
  let best = "";
  let bestScore = 0;
  while ((match = imagePattern.exec(html))) {
    const attrs = match[0];
    const href = bestStoImageFromAttributes(attrs, baseUrl);
    if (!href || !isStoChannelArtworkUrl(href)) continue;

    const text = normalizeSearchText(`${decodeHtmlEntities(readHtmlAttribute(attrs, "alt"))} ${decodeHtmlEntities(readHtmlAttribute(attrs, "title"))} ${href}`);
    const overlap = expectedTokens.filter((token) => text.includes(token)).length;
    if (expectedTokens.length && overlap === 0) continue;

    let score = 1000 + overlap * 500;
    if (/\/2x-desktop\//i.test(href)) score += 220;
    if (/class\s*=\s*["'][^"']*(?:img-fluid|w-100|cover|poster)/i.test(attrs)) score += 80;
    if (score > bestScore) {
      bestScore = score;
      best = href;
    }
  }
  return best;
}

function bestStoImageFromAttributes(attrs, baseUrl) {
  const srcset = readHtmlAttribute(attrs, "data-srcset") || readHtmlAttribute(attrs, "srcset");
  const fromSrcset = bestStoSrcsetImage(srcset, baseUrl);
  if (fromSrcset) return fromSrcset;

  const src = readHtmlAttribute(attrs, "data-src") || readHtmlAttribute(attrs, "src");
  const href = absoluteHttpUrl(src, baseUrl);
  return isStoChannelArtworkUrl(href) ? href : "";
}

function bestStoSrcsetImage(srcset, baseUrl) {
  const candidates = String(srcset || "")
    .split(",")
    .map((entry) => {
      const parts = entry.trim().split(/\s+/);
      const href = absoluteHttpUrl(parts[0], baseUrl);
      const descriptor = parts[1] || "";
      const scale = descriptor.endsWith("x") ? Number.parseFloat(descriptor) || 1 : 1;
      return { href, scale };
    })
    .filter((candidate) => isStoChannelArtworkUrl(candidate.href))
    .sort((a, b) => b.scale - a.scale);
  return candidates[0]?.href || "";
}

// Fuellwoerter taugen nicht zum Abgleich: "Avatar - Der Herr der Elemente" und
// "Die Avengers - Die maechtigsten Helden der Welt" teilen sich das Wort "der",
// und schon galt das Vorschlagsbild einer fremden Serie als passend.
const FUELLWOERTER = /^(?:der|die|das|dem|den|des|ein|eine|einen|einem|eines|und|oder|aber|mit|von|vom|zum|zur|fur|fuer|auf|aus|bei|ist|sind|wie|als|auch|nur|nicht|sich|ihre|sein|seine|dass|dann|the|and|for|with|from|that|this|you|are|was|were|his|her|its|has|had|have|not|but)$/i;
const ARTWORK_MUELLWORT = /^(?:serie|staffel|folge|episode|stream|kostenlos|ansehen|season)$/i;

// Ohne Fuellwoerter bleibt bei manchen Titeln nichts uebrig ("Die Welle") -
// dann ist die ungefilterte Liste immer noch besser als gar kein Abgleich.
function meaningfulTokens(values) {
  const roh = values.filter((token) => token.length > 2 && !ARTWORK_MUELLWORT.test(token));
  const ohneFuellwoerter = roh.filter((token) => !FUELLWOERTER.test(token));
  return Array.from(new Set(ohneFuellwoerter.length ? ohneFuellwoerter : roh));
}

function expectedArtworkTokens(url, title) {
  const slug = stoMediaSlugFromUrl(url);
  return meaningfulTokens([
    ...normalizeSearchText(slug).split(" "),
    ...normalizeSearchText(title).split(" ")
  ]);
}

// Das Bild einer anderen Serie verraet sich im Pfad: S.to legt es unter
// .../channel/desktop/<slug-der-serie>-<kennung> ab. Passt davon kein Wort zum
// Serien-Slug, stammt es aus einem Vorschlagsblock der Seite.
function stoArtworkMatchesFavorite(thumbnail, url) {
  const tokens = meaningfulTokens(normalizeSearchText(stoMediaSlugFromUrl(url)).split(" "));
  if (!tokens.length || !thumbnail) return true;
  try {
    const bildname = new URL(thumbnail).pathname.split("/").filter(Boolean).pop() || "";
    const text = bildname.toLowerCase();
    return tokens.some((token) => text.includes(token));
  } catch {
    return true;
  }
}

function stoSeriesPageUrlFromFavoriteUrl(value) {
  try {
    const url = new URL(value);
    const slug = stoMediaSlugFromUrl(url.href);
    if (!slug) return url.href;
    url.pathname = `/serie/${slug}`;
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function stoMediaSlugFromUrl(value) {
  try {
    const parts = new URL(value).pathname.split("/").filter(Boolean);
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index].toLowerCase();
      if (part === "serie" && parts[index + 1]?.toLowerCase() === "stream" && parts[index + 2]) return parts[index + 2];
      if ((part === "serie" || part === "stream") && parts[index + 1]) return parts[index + 1];
    }
    return "";
  } catch {
    return "";
  }
}

function aniWorldSeriesPageUrlFromFavoriteUrl(value) {
  try {
    const url = new URL(value);
    const slug = aniWorldMediaSlugFromUrl(url.href);
    if (!slug) return url.href;
    url.pathname = `/anime/stream/${slug}`;
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function aniWorldMediaSlugFromUrl(value) {
  try {
    const parts = new URL(value).pathname.split("/").filter(Boolean);
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index].toLowerCase();
      if (part === "anime" && parts[index + 1]?.toLowerCase() === "stream" && parts[index + 2]) return parts[index + 2].toLowerCase();
      if (part === "stream" && parts[index + 1]) return parts[index + 1].toLowerCase();
    }
    return "";
  } catch {
    return "";
  }
}

function isStoFavoriteRecord(favorite, provider) {
  if (!favorite) return false;
  const name = String(provider?.name || favorite.providerName || "").toLowerCase();
  const host = providerModel.hostFromUrl(provider?.startUrl || favorite.url || "").toLowerCase();
  return name.includes("s.to") || isStoHost(host);
}

function isAniWorldFavoriteRecord(favorite, provider) {
  if (!favorite) return false;
  const name = String(provider?.name || favorite.providerName || "").toLowerCase();
  const host = providerModel.hostFromUrl(provider?.startUrl || favorite.url || "").toLowerCase();
  return name.includes("aniworld") || isAniWorldHost(host);
}

function isAniWorldProvider(provider) {
  const name = String(provider?.name || "").toLowerCase();
  const host = providerModel.hostFromUrl(provider?.startUrl || "").toLowerCase();
  return name.includes("aniworld") || isAniWorldHost(host);
}

function isFilmoProvider(provider) {
  const name = String(provider?.name || "").toLowerCase();
  const host = providerModel.hostFromUrl(provider?.startUrl || "").toLowerCase();
  return name.includes("filmo") || host.includes("filmo");
}

function isAniWorldHost(host) {
  return String(host || "").toLowerCase().includes("aniworld");
}

function isStoHost(host) {
  return host === "s.to" || host.endsWith(".s.to") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

function isAniWorldArtworkUrl(value) {
  try {
    const url = new URL(value);
    const href = url.href.toLowerCase();
    if (!isAniWorldHost(url.hostname)) return false;
    if (isRejectedAniWorldArtworkUrl(href)) return false;
    return /\/public\/img\/cover\/[^/?#]+\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function isRejectedAniWorldArtworkUrl(value) {
  return isJunkImageUrl(value) || /(?:\/default\/|-default\.)/i.test(String(value || ""));
}

// Platzhalter und Beiwerk von echten Titelbildern trennen. Der Dateiname
// traegt den Namen der Serie - "avatar-OPQmI5KE", "black-torch-..." -, deshalb
// duerfen titelfaehige Woerter wie avatar, black oder flag nur im Ordnerpfad
// als Ausschluss zaehlen. Sonst bekommt ausgerechnet die Serie "Avatar" nie
// ein Bild und die App greift auf das Poster eines Vorschlags daneben.
const BILD_MUELL_IMMER = /(?:favicon|sprite|placeholder|blank|transparent|loading|spinner|no-?image|og-image)/i;
const BILD_MUELL_ORDNER = /(?:logo|icon|avatar|flag|banner|button|rating|language|login|register|facebook|twitter|social|share|ads?)/i;

function isJunkImageUrl(value) {
  const href = String(value || "");
  if (!href) return true;
  if (BILD_MUELL_IMMER.test(href)) return true;
  try {
    const url = new URL(href);
    const ordner = url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1);
    return BILD_MUELL_ORDNER.test(ordner);
  } catch {
    return BILD_MUELL_ORDNER.test(href.slice(0, Math.max(0, href.lastIndexOf("/"))));
  }
}

function isStoChannelArtworkUrl(value) {
  try {
    const url = new URL(value);
    return isStoHost(url.hostname.toLowerCase())
      && /\/media\/images\/channel\/(?:2x-)?desktop\/[^/?#]+/i.test(url.pathname)
      && !isJunkImageUrl(url.href);
  } catch {
    return false;
  }
}

function loadSettings() {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")));
  } catch {
    return defaultSettings();
  }
}

function saveSettings() {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

async function readPageMetadata(view) {
  const meta = await readPageMetadataRoh(view);
  return youtubeBildNachreichen(view, meta);
}

// Auf YouTube bleibt alles aus der Seite - Titel, Typ, Favicon -, nur das Bild
// wird ersetzt. Die allgemeine Bildsuche nimmt dort das groesste Bild oben auf
// der Seite, und das ist nicht das laufende Video (ein <video> ist gar kein
// Bild), sondern die erste Empfehlung in der rechten Spalte. Auf der Karte
// stand deshalb ein fremdes Vorschaubild.
//
// Wichtig: hier wird nicht auf das Netz gewartet. readPageMetadata() haengt am
// Fortschritts-Takt, und ein zaeher Abruf wuerde das Merken des Standes
// aufhalten. Genommen wird sofort die Groesse, die es garantiert gibt; ob es
// die grosse auch gibt, wird nebenher geklaert und gilt ab dem naechsten Mal.
function youtubeBildNachreichen(view, meta) {
  let adresse = "";
  try {
    adresse = view.webContents.getURL();
  } catch {
    return meta;
  }
  if (!youtube.istYoutubeUrl(adresse)) return meta;

  const kandidaten = youtube.vorschaubildKandidaten(adresse);
  if (!kandidaten.length) return meta;

  const sicher = kandidaten[kandidaten.length - 1];
  const bekannt = youtubeBildCache.get(kandidaten[0]);
  if (bekannt) return { ...meta, thumbnail: bekannt };

  pruefeGrossesVorschaubild(kandidaten[0]);
  return { ...meta, thumbnail: sicher };
}

// "maxresdefault" gibt es nur, wenn das Video in HD hochgeladen wurde - sonst
// antwortet YouTube mit 404 und auf der Karte bliebe ein Loch. Einmal je Video
// nachsehen, das Ergebnis merken; beim naechsten Fortschritts-Takt steht dann
// das grosse Bild an der Karte.
const youtubeBildCache = new Map();
const youtubeBildLaeuft = new Set();

function pruefeGrossesVorschaubild(adresse) {
  if (!adresse || youtubeBildCache.has(adresse) || youtubeBildLaeuft.has(adresse)) return;
  youtubeBildLaeuft.add(adresse);
  net.fetch(adresse, { method: "HEAD", signal: AbortSignal.timeout(8000) })
    .then((antwort) => {
      if (!antwort.ok) return;
      if (youtubeBildCache.size > 200) youtubeBildCache.clear();
      youtubeBildCache.set(adresse, adresse);
    })
    .catch(() => {
      // Kein Netz, Zeitueberschreitung oder das Video hat kein HD-Bild. Dann
      // bleibt es bei der kleinen Groesse - die ist richtig, nur kleiner.
    })
    .then(() => {
      youtubeBildLaeuft.delete(adresse);
    });
}

async function readPageMetadataRoh(view) {
  // Der Quelltext steht in ./seitendaten - dieselbe Datei laedt der Kern der
  // Android-App in seinen WebView. Damit sucht das Telefon sein Titelbild mit
  // demselben Skript wie der Rechner und nicht mit einem zweiten, das
  // irgendwann anders entscheidet.
  return view.webContents.executeJavaScript(seitendaten.seitenSkript(), true);
}

function filterListenDatei(liste) {
  return path.join(FILTER_LIST_DIR, `${liste.id}.txt`);
}

// Die Rohtexte von der Platte. Fehlt eine Liste, fehlt sie eben - die anderen
// ergeben trotzdem eine brauchbare Engine.
function gespeicherteFilterListen() {
  const listen = [];
  for (const liste of ADGUARD_FILTER_LISTS) {
    try {
      const text = fs.readFileSync(filterListenDatei(liste), "utf8");
      if (text.trim()) listen.push({ id: liste.id, name: liste.name, text });
    } catch {
      // Noch nie geholt oder von Hand geloescht.
    }
  }
  return listen;
}

function speichereFilterListe(liste, text) {
  ensureDataDir();
  fs.mkdirSync(FILTER_LIST_DIR, { recursive: true });
  fs.writeFileSync(filterListenDatei(liste), text);
}

// Beim Start: Engine aus dem bauen, was schon da ist - ohne Netz, ohne Warten.
//
// Der Aufbau dauert rund vier Sekunden. Er laeuft deshalb nebenher, und bis er
// fertig ist, filtert die eingebaute Notfallliste weiter. ELFIX startet also
// nie ungeschuetzt und haengt nie am Adblocker.
async function ladeFilterListenVonPlatte() {
  try {
    fs.rmSync(LEGACY_FILTER_CACHE_FILE, { force: true });
  } catch {
    // Wenn die alte Datei nicht weggeht, ist das kein Grund aufzuhoeren.
  }
  const listen = gespeicherteFilterListen();
  if (!listen.length) {
    console.log("[ELFIX ADBLOCK] keine Listen auf der Platte - vorerst nur die eingebauten Regeln");
    return false;
  }
  const start = Date.now();
  const ok = await adblock.bauen(listen);
  if (!ok) {
    console.log("[ELFIX ADBLOCK] tsurlfilter liess sich nicht laden - es gelten nur die eingebauten Regeln");
    return false;
  }
  console.log(`[ELFIX ADBLOCK] ${adblock.ruleCount()} Regeln aus ${listen.length} Listen in ${Date.now() - start} ms`);
  return true;
}

// Ohne geladene Listen blockt nur die eingebaute Notfallliste - und genau dann
// kommen Popups und Werbung durch. Beim Start wird deshalb nachgeholt, was
// fehlt oder zu alt ist; laeuft nebenher, damit das Fenster nicht wartet.
async function ensureFilterLists() {
  if (!settings.adblock?.enabled) return;
  const zuletzt = Date.parse(settings.adblock.lastUpdated || "") || 0;
  const veraltet = !zuletzt || Date.now() - zuletzt > FILTER_MAX_ALTER_MS;
  const vorhanden = adblock.hatGeladeneListen();
  if (vorhanden && !veraltet) return;

  console.log(`[ELFIX ADBLOCK] ${vorhanden ? "Listen sind veraltet" : "keine Listen vorhanden"} - werden geholt`);
  const ergebnis = await updateFilterLists();
  if (ergebnis.fehlend?.length) {
    console.log(`[ELFIX ADBLOCK] nicht erreichbar: ${ergebnis.fehlend.join(", ")}`);
  }
  console.log(`[ELFIX ADBLOCK] ${ergebnis.ruleCount} Regeln aktiv`);
}

async function updateFilterLists() {
  const listen = [];
  const fehlend = [];
  for (const list of ADGUARD_FILTER_LISTS) {
    try {
      // net.fetch nutzt den Netzwerk-Stack von Chromium samt Proxy-Einstellungen
      // des Systems - das globale fetch scheitert hier je nach Umgebung.
      const response = await net.fetch(list.url, { signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (!text.trim()) throw new Error("leere Antwort");
      speichereFilterListe(list, text);
      listen.push({ id: list.id, name: list.name, text });
    } catch (fehler) {
      // Eine hakende Liste darf die anderen nicht mitreissen - lieber etwas
      // weniger Regeln als gar keine. Was schon auf der Platte liegt, wird
      // unten wieder mit eingesammelt.
      fehlend.push(`${list.name} (${fehler?.message || fehler})`);
    }
  }

  // Auch die Listen, die diesmal nicht durchkamen, aber noch vom letzten Mal
  // da sind. Sonst wuerde ein einzelner Netzfehler den Schutz verkleinern.
  const vollstaendig = gespeicherteFilterListen();
  const quelle = vollstaendig.length >= listen.length ? vollstaendig : listen;
  if (!quelle.length) {
    throw new Error(`Keine Filterliste erreichbar: ${fehlend.join(", ")}`);
  }

  await adblock.bauen(quelle);
  settings.adblock.lastUpdated = new Date().toISOString();
  saveSettings();
  kosmetikZuruecksetzen();
  return { ruleCount: adblock.ruleCount(), lastUpdated: settings.adblock.lastUpdated, fehlend };
}

function normalizeSettings(raw) {
  const defaults = defaultSettings();
  const schemaVersion = Number(raw?.version || 0);
  const migrateBackgroundAudio = schemaVersion < 2;
  const migrateFavoriteMeta = schemaVersion < 3;
  return {
    version: SETTINGS_SCHEMA_VERSION,
    adblock: {
      enabled: raw?.adblock?.enabled ?? defaults.adblock.enabled,
      trackingProtection: raw?.adblock?.trackingProtection ?? defaults.adblock.trackingProtection,
      blockPopups: raw?.adblock?.blockPopups ?? defaults.adblock.blockPopups,
      blockRedirects: raw?.adblock?.blockRedirects ?? defaults.adblock.blockRedirects,
      whitelist: Array.isArray(raw?.adblock?.whitelist) ? raw.adblock.whitelist.map(String) : [],
      lastUpdated: raw?.adblock?.lastUpdated || ""
    },
    // Standardmaessig aus: eine Meldung, die man nicht bestellt hat, ist eine
    // Stoerung. Wer sie will, schaltet sie in den Einstellungen ein.
    notifications: {
      newEpisodes: raw?.notifications?.newEpisodes === true
    },
    // Was einmalig schon geschehen ist. Diese Merker muessen hier stehen und
    // nicht bloss in der Datei: die Oberflaeche schickt beim Speichern den
    // ganzen Einstellungsblock, und was normalizeSettings nicht kennt, faellt
    // dabei heraus. Ein verlorener Merker hiesse, die einmalige Aenderung
    // laeuft beim naechsten Start noch einmal - und traegt etwas nach, das
    // man inzwischen bewusst geloescht hat.
    migrations: {
      youtubeProvider: raw?.migrations?.youtubeProvider === true,
      sitzungen: raw?.migrations?.sitzungen === true,
      // Einmalig: die Kennungen der nachgetragenen Saetze auf den Titel
      // umstellen, damit zwei Geraete dieselbe Vorgeschichte nicht doppelt
      // fuehren.
      sitzungKennung: raw?.migrations?.sitzungKennung === true
    },
    // Welches Jahr schon gezeigt wurde. Muss hier stehen, sonst faellt es beim
    // naechsten Speichern der Einstellungen heraus und der Jahresrueckblick
    // draengt sich erneut auf.
    wrapped: {
      gesehenJahr: Number(raw?.wrapped?.gesehenJahr) || 0
    },
    playback: {
      pauseOnProviderSwitch: raw?.playback?.pauseOnProviderSwitch ?? defaults.playback.pauseOnProviderSwitch,
      favoriteProgressMode: sanitizeChoice(raw?.playback?.favoriteProgressMode, ["sequential", "static"], defaults.playback.favoriteProgressMode),
      pauseOnMinimize: migrateBackgroundAudio ? defaults.playback.pauseOnMinimize : raw?.playback?.pauseOnMinimize ?? defaults.playback.pauseOnMinimize,
      pauseOnBlur: migrateBackgroundAudio ? defaults.playback.pauseOnBlur : raw?.playback?.pauseOnBlur ?? defaults.playback.pauseOnBlur,
      // Standardmaessig aus: die Mediathek ist die Ablage fuer Serien und
      // Filme, die man zu Ende gesehen hat. Ein YouTube-Video landet dort
      // ungefragt nicht - wer es doch will, schaltet es hier ein.
      youtubeInMediathek: raw?.playback?.youtubeInMediathek === true,
      // Standardmaessig an, weil es bisher immer so war. Nur ein
      // ausdrueckliches Nein schaltet den Zaehler ab; der Knopf bleibt in
      // jedem Fall.
      autoplayNextEpisode: raw?.playback?.autoplayNextEpisode !== false,
      // Von Haus aus an. Der Knopf kann nichts tun, bevor man ihm das Intro
      // zweimal selbst gezeigt hat - und er springt nie von allein.
      introSkip: raw?.playback?.introSkip !== false,
      // Ebenfalls von Haus aus an. Vorgewaehlt wird nur, was jemand fuer
      // dieselbe Serie schon einmal selbst angeklickt hat - eine eigene
      // Meinung zur richtigen Fassung hat ELFIX nicht.
      rememberLanguage: raw?.playback?.rememberLanguage !== false
    },
    browser: {
      cacheMode: sanitizeChoice(raw?.browser?.cacheMode, ["normal", "clearOnStart", "aggressive"], defaults.browser.cacheMode)
    },
    watchparty: {
      enabled: raw?.watchparty?.enabled === true,
      serverUrl: String(raw?.watchparty?.serverUrl || defaults.watchparty.serverUrl).slice(0, 300).trim(),
      // Frueher gab es genau einen Raumcode. Der wandert in die Liste, damit
      // eine bestehende Watchparty nach dem Update einfach weiterlaeuft.
      rooms: raumcodesAufraeumen([
        ...(Array.isArray(raw?.watchparty?.rooms) ? raw.watchparty.rooms : []),
        raw?.watchparty?.room,
        ...defaults.watchparty.rooms
      ]).slice(0, WATCHPARTY_MAX_RAEUME),
      deviceName: String(raw?.watchparty?.deviceName || defaults.watchparty.deviceName).slice(0, 40).trim(),
      // In welchem Raum die YouTube-Watchparty laeuft. Leer heisst: aus. Es ist
      // bewusst genau einer - es gibt einen YouTube-Player, und zwei Runden
      // gleichzeitig hiessen zwei Videos gleichzeitig.
      // Wie die Kennung: sie kommt aus dem Formular nicht immer mit, und ohne
      // diesen Rueckfall schaltete jedes Speichern der Einstellungen die
      // laufende YouTube-Runde ab. Ausgeschaltet wird sie ueber ihren eigenen
      // Kanal, nicht ueber das Einstellungsformular.
      youtubeRoom: String(raw?.watchparty?.youtubeRoom
        || settings?.watchparty?.youtubeRoom
        || defaults.watchparty.youtubeRoom || "").trim().normalize("NFC").slice(0, 64),
      // Erst die mitgeschickte Kennung, dann die bereits bekannte - eine neue
      // nur, wenn dieses Geraet wirklich noch keine hat. Kaeme hier bei jedem
      // Speichern eine frische heraus, waere das Geraet fuer die Raeume jedes
      // Mal ein anderes und muesste ueberall neu beitreten.
      deviceId: String(raw?.watchparty?.deviceId || settings?.watchparty?.deviceId || "").slice(0, 64)
        || crypto.randomUUID()
    },
    geraete: (() => {
      // Wie die Geraetekennung: der Schluessel gehoert nicht ins
      // Einstellungsformular, muss aber jedes Speichern ueberstehen. Deshalb
      // der Rueckfall auf den bekannten - ein Formular, das ihn nicht kennt,
      // schickt ein leeres Feld, und das darf ihn nicht loeschen. Weg kommt er
      // ueber "Dieses Gerät trennen", nicht nebenbei.
      //
      // Ein unbrauchbarer Schluessel wird hier verworfen statt spaeter still
      // ignoriert: sonst stuende der Abgleich auf "an", ohne dass je etwas
      // geschieht.
      const key = geraeteSchluessel.normalisieren(raw?.geraete?.key || settings?.geraete?.key);
      // Der Schluessel *ist* der Schalter. Ein zweiter daneben koennte nur
      // einen Zustand herstellen, den niemand haben will: Schluessel
      // eingetragen, Abgleich trotzdem aus.
      return { key, enabled: Boolean(key) };
    })(),
    fern: {
      // Wie der Geraeteschluessel: der Code gehoert nicht ins
      // Einstellungsformular, muss aber jedes Speichern ueberstehen.
      code: String(raw?.fern?.code || settings?.fern?.code || "").toUpperCase().slice(0, 16),
      // Hier ist der Schalter ein echter Schalter und nicht der Code: eine
      // Fernbedienung schaltet man ab, ohne den Code wegzuwerfen - sonst
      // muesste man das Handy danach neu koppeln.
      enabled: (raw?.fern?.enabled ?? settings?.fern?.enabled) === true
    },
    home: {
      showHero: raw?.home?.showHero ?? raw?.appearance?.showHero ?? defaults.home.showHero,
      showYoutube: raw?.home?.showYoutube ?? defaults.home.showYoutube,
      showFavorites: raw?.home?.showFavorites ?? defaults.home.showFavorites,
      showPersonal: raw?.home?.showPersonal ?? defaults.home.showPersonal,
      showCategories: raw?.home?.showCategories ?? defaults.home.showCategories,
      // Die Statistikseite ist etwas fuer den, der sie sucht - sie draengt sich
      // nicht in die Seitenleiste. Nur ein ausdrueckliches Ja blendet sie ein.
      // Im Dezember erscheint sie ohnehin, dann aber wegen der Saison und nicht
      // wegen dieser Einstellung.
      showReview: raw?.home?.showReview === true,
      providerCardMeta: sanitizeChoice(raw?.home?.providerCardMeta, ["logoName", "logo", "name"], defaults.home.providerCardMeta),
      // Wie die Mediathek sortiert ist. Ohne diese Zeile faellt die Wahl beim
      // Speichern weg - hier werden nur bekannte Felder uebernommen.
      librarySort: sanitizeChoice(raw?.home?.librarySort, ["manuell", "zuletzt", "titel", "anbieter"], defaults.home.librarySort)
    },
    appearance: {
      settingsMode: sanitizeChoice(raw?.appearance?.settingsMode, ["simple", "advanced"], defaults.appearance.settingsMode),
      designPreset: sanitizeChoice(raw?.appearance?.designPreset, ["elfix", "cinema", "oled", "minimal", "glass", "compact", "colorful", "custom"], defaults.appearance.designPreset),
      autoDeriveColors: raw?.appearance?.autoDeriveColors ?? defaults.appearance.autoDeriveColors,
      layoutStyle: sanitizeChoice(raw?.appearance?.layoutStyle, ["standard", "compact", "roomy", "netflix", "minimal", "custom"], defaults.appearance.layoutStyle),
      navStyle: sanitizeChoice(raw?.appearance?.navStyle, ["sidebar", "sidebarRight", "compactSidebar", "top"], defaults.appearance.navStyle),
      autoCollapseSidebar: raw?.appearance?.autoCollapseSidebar ?? defaults.appearance.autoCollapseSidebar,
      compactHeader: raw?.appearance?.compactHeader ?? defaults.appearance.compactHeader,
      themeMode: sanitizeChoice(raw?.appearance?.themeMode, ["system", "dark", "light", "oled"], defaults.appearance.themeMode),
      accentPreset: sanitizeChoice(raw?.appearance?.accentPreset, ["default", "red", "blue", "violet", "green", "orange", "pink", "turquoise", "yellow", "gold", "custom"], defaults.appearance.accentPreset),
      accentColor: sanitizeColor(raw?.appearance?.accentColor, defaults.appearance.accentColor),
      accentStrength: sanitizeNumber(raw?.appearance?.accentStrength, 30, 100, defaults.appearance.accentStrength),
      uiDensity: sanitizeChoice(raw?.appearance?.uiDensity, ["compact", "comfortable", "roomy"], defaults.appearance.uiDensity),
      // Ob die Dichte einer Voreinstellung entspricht oder von Hand gesetzt
      // wurde. Ohne diese Zeile faellt die Angabe beim Speichern weg - hier
      // werden nur bekannte Felder uebernommen -, und in "Dichte & Groesse"
      // liesse sich "Benutzerdef." nicht mehr auswaehlen.
      densityMode: sanitizeChoice(raw?.appearance?.densityMode, ["preset", "custom"], defaults.appearance.densityMode),
      cardSize: sanitizeChoice(raw?.appearance?.cardSize, ["small", "medium", "large"], defaults.appearance.cardSize),
      favoriteSize: sanitizeChoice(raw?.appearance?.favoriteSize, ["small", "medium", "large", "poster"], defaults.appearance.favoriteSize),
      favoriteLayout: sanitizeChoice(raw?.appearance?.favoriteLayout, ["grid", "wide", "list"], defaults.appearance.favoriteLayout),
      favoriteTextSize: sanitizeChoice(raw?.appearance?.favoriteTextSize, ["small", "medium", "large"], defaults.appearance.favoriteTextSize),
      favoriteArtwork: sanitizeChoice(raw?.appearance?.favoriteArtwork, ["clear", "balanced", "artwork"], defaults.appearance.favoriteArtwork),
      cornerStyle: sanitizeChoice(raw?.appearance?.cornerStyle, ["sharp", "soft", "round"], defaults.appearance.cornerStyle),
      backgroundStyle: sanitizeChoice(raw?.appearance?.backgroundStyle, ["plain", "cinema", "color", "poster", "black", "gray", "glass"], defaults.appearance.backgroundStyle),
      backgroundColor: sanitizeColor(raw?.appearance?.backgroundColor, defaults.appearance.backgroundColor),
      surfaceColor: sanitizeColor(raw?.appearance?.surfaceColor, defaults.appearance.surfaceColor),
      surfaceSecondaryColor: sanitizeColor(raw?.appearance?.surfaceSecondaryColor, defaults.appearance.surfaceSecondaryColor),
      cardColor: sanitizeColor(raw?.appearance?.cardColor, defaults.appearance.cardColor),
      navColor: sanitizeColor(raw?.appearance?.navColor, defaults.appearance.navColor),
      inputColor: sanitizeColor(raw?.appearance?.inputColor, defaults.appearance.inputColor),
      primaryTextColor: sanitizeColor(raw?.appearance?.primaryTextColor, defaults.appearance.primaryTextColor),
      secondaryTextColor: sanitizeColor(raw?.appearance?.secondaryTextColor, defaults.appearance.secondaryTextColor),
      mutedTextColor: sanitizeColor(raw?.appearance?.mutedTextColor, defaults.appearance.mutedTextColor),
      borderColor: sanitizeColor(raw?.appearance?.borderColor, defaults.appearance.borderColor),
      hoverColor: sanitizeColor(raw?.appearance?.hoverColor, defaults.appearance.hoverColor),
      focusColor: sanitizeColor(raw?.appearance?.focusColor, defaults.appearance.focusColor),
      selectionColor: sanitizeColor(raw?.appearance?.selectionColor, defaults.appearance.selectionColor),
      successColor: sanitizeColor(raw?.appearance?.successColor, defaults.appearance.successColor),
      warningColor: sanitizeColor(raw?.appearance?.warningColor, defaults.appearance.warningColor),
      errorColor: sanitizeColor(raw?.appearance?.errorColor, defaults.appearance.errorColor),
      progressColor: sanitizeColor(raw?.appearance?.progressColor, defaults.appearance.progressColor),
      scrollbarColor: sanitizeColor(raw?.appearance?.scrollbarColor, defaults.appearance.scrollbarColor),
      fontScale: sanitizeNumber(raw?.appearance?.fontScale, 80, 140, defaults.appearance.fontScale),
      uiScale: sanitizeNumber(raw?.appearance?.uiScale, 90, 118, defaults.appearance.uiScale),
      spacingScale: sanitizeNumber(raw?.appearance?.spacingScale, 80, 130, defaults.appearance.spacingScale),
      cardGap: sanitizeNumber(raw?.appearance?.cardGap, 8, 34, defaults.appearance.cardGap),
      cardRadius: sanitizeNumber(raw?.appearance?.cardRadius, 4, 32, defaults.appearance.cardRadius),
      buttonRadius: sanitizeNumber(raw?.appearance?.buttonRadius, 4, 28, defaults.appearance.buttonRadius),
      buttonHeight: sanitizeNumber(raw?.appearance?.buttonHeight, 34, 58, defaults.appearance.buttonHeight),
      inputRadius: sanitizeNumber(raw?.appearance?.inputRadius, 4, 26, defaults.appearance.inputRadius),
      shadowStrength: sanitizeNumber(raw?.appearance?.shadowStrength, 0, 100, defaults.appearance.shadowStrength),
      hoverZoom: sanitizeNumber(raw?.appearance?.hoverZoom, 100, 106, defaults.appearance.hoverZoom),
      hoverBrightness: sanitizeNumber(raw?.appearance?.hoverBrightness, 95, 120, defaults.appearance.hoverBrightness),
      animationSpeed: sanitizeNumber(raw?.appearance?.animationSpeed, 60, 160, defaults.appearance.animationSpeed),
      animationMode: sanitizeChoice(raw?.appearance?.animationMode, ["full", "reduced", "off"], defaults.appearance.animationMode),
      cardStyle: sanitizeChoice(raw?.appearance?.cardStyle, ["standard", "flat", "glass", "outline", "minimal"], defaults.appearance.cardStyle),
      shadowStyle: sanitizeChoice(raw?.appearance?.shadowStyle, ["none", "light", "standard", "strong"], defaults.appearance.shadowStyle),
      showProviderStrip: raw?.appearance?.showProviderStrip ?? defaults.appearance.showProviderStrip,
      showFavoriteMeta: migrateFavoriteMeta ? false : raw?.appearance?.showFavoriteMeta ?? defaults.appearance.showFavoriteMeta,
      animations: raw?.appearance?.animations ?? defaults.appearance.animations
    }
  };
}

function publicSettings(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultSettings() {
  return {
    version: SETTINGS_SCHEMA_VERSION,
    adblock: {
      enabled: true,
      trackingProtection: true,
      blockPopups: true,
      blockRedirects: true,
      whitelist: [],
      lastUpdated: ""
    },
    notifications: {
      newEpisodes: false
    },
    // Eine frische Ablage bringt YouTube schon mit - fuer sie ist das
    // Nachtragen von vornherein erledigt.
    wrapped: { gesehenJahr: 0 },
    migrations: {
      youtubeProvider: true,
      // Eine frische Ablage hat keinen Verlauf, aus dem etwas zu uebernehmen
      // waere - sie sammelt von Anfang an gemessene Zeiten.
      sitzungen: true,
      // Und keine Saetze mit alten Kennungen.
      sitzungKennung: true
    },
    playback: {
      introSkip: true,
      rememberLanguage: true,
      pauseOnProviderSwitch: true,
      favoriteProgressMode: "sequential",
      pauseOnMinimize: false,
      pauseOnBlur: false,
      youtubeInMediathek: false,
      autoplayNextEpisode: true
    },
    browser: {
      cacheMode: "aggressive"
    },
    watchparty: {
      enabled: false,
      serverUrl: "",
      rooms: [],
      deviceName: "",
      deviceId: "",
      youtubeRoom: ""
    },
    // Meine Geraete. Ohne Schluessel gibt es nichts abzugleichen, und einen
    // erzeugt nur, wer ihn will.
    geraete: {
      enabled: false,
      key: ""
    },
    // Das Handy als Fernbedienung. Aus, bis jemand sie einschaltet - erst dann
    // entsteht ein Kopplungscode.
    fern: {
      enabled: false,
      code: ""
    },
    home: {
      showHero: true,
      showYoutube: true,
      showFavorites: true,
      showPersonal: true,
      showCategories: true,
      showReview: false,
      providerCardMeta: "logoName",
      librarySort: "manuell"
    },
    appearance: {
      settingsMode: "advanced",
      designPreset: "elfix",
      autoDeriveColors: true,
      layoutStyle: "standard",
      navStyle: "sidebar",
      autoCollapseSidebar: true,
      compactHeader: true,
      themeMode: "dark",
      accentPreset: "violet",
      accentColor: "#7c3aed",
      accentStrength: 72,
      uiDensity: "comfortable",
      densityMode: "preset",
      cardSize: "medium",
      // Poster von Haus aus - dieselbe Werkseinstellung wie in der
      // Oberflaeche. Stuende hier etwas anderes, gaebe der Hauptprozess einer
      // frischen Einrichtung eine andere Kartenform als die Oberflaeche
      // vorsieht, und wer nie an den Einstellungen dreht, saehe nie Poster.
      favoriteSize: "poster",
      favoriteLayout: "grid",
      favoriteTextSize: "medium",
      favoriteArtwork: "clear",
      cornerStyle: "soft",
      backgroundStyle: "cinema",
      backgroundColor: "#070a10",
      surfaceColor: "#111722",
      surfaceSecondaryColor: "#1a2230",
      cardColor: "#1a2230",
      navColor: "#131922",
      inputColor: "#05090f",
      primaryTextColor: "#f7f8fb",
      secondaryTextColor: "#d9e2ef",
      mutedTextColor: "#a8b2c3",
      borderColor: "#243043",
      hoverColor: "#263349",
      focusColor: "#147eff",
      selectionColor: "#235bbd",
      successColor: "#22c55e",
      warningColor: "#f5b84b",
      errorColor: "#ff4d5e",
      progressColor: "#147eff",
      scrollbarColor: "#3b82f6",
      fontScale: 100,
      uiScale: 100,
      spacingScale: 100,
      cardGap: 18,
      cardRadius: 18,
      buttonRadius: 16,
      buttonHeight: 44,
      inputRadius: 14,
      shadowStrength: 45,
      hoverZoom: 102,
      hoverBrightness: 106,
      animationSpeed: 100,
      animationMode: "full",
      cardStyle: "standard",
      shadowStyle: "standard",
      showProviderStrip: true,
      showFavoriteMeta: false,
      animations: true
    }
  };
}

function sanitizeChoice(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function sanitizeColor(value, fallback) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function sanitizeNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function enabledProviders() {
  return providers.filter((item) => item.enabled !== false);
}

function activeProvider() {
  return enabledProviders().find((item) => item.id === activeProviderId) || null;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR) && fs.existsSync(LEGACY_DATA_DIR)) {
    fs.cpSync(LEGACY_DATA_DIR, DATA_DIR, { recursive: true });
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function logBlocked(details, provider, rule, kategorie = "NETWORK_RULE") {
  blockedRequests.push({
    time: new Date().toLocaleTimeString(),
    provider: provider.name,
    kategorie,
    type: details.resourceType,
    url: details.url,
    rule
  });
  if (blockedRequests.length > MAX_BLOCK_LOG) {
    blockedRequests.shift();
  }
  sendBlockedRequests();
}

// Wer durfte durch, obwohl eine Regel ihn erwischt haette? Das ist die Spur,
// an der man einen kaputten Player erkennt - aber nur einmal je Anbieter und
// Host. Ein Film laedt tausende Videostuecke; jedes einzelne zu melden waere
// kein Protokoll mehr, sondern Rauschen.
const ausnahmeGemeldet = new Set();

function logAusnahme(url, provider, rule, kategorie) {
  const host = providerModel.hostFromUrl(url);
  const schluessel = `${provider?.id || ""}|${host}|${kategorie}`;
  if (ausnahmeGemeldet.has(schluessel)) return;
  ausnahmeGemeldet.add(schluessel);
  // Nicht unbegrenzt wachsen lassen - nach einem langen Abend mit vielen
  // Folgen steht hier sonst jeder je gesehene Auslieferungsknoten drin.
  if (ausnahmeGemeldet.size > 500) ausnahmeGemeldet.clear();
  blockedRequests.push({
    time: new Date().toLocaleTimeString(),
    provider: provider?.name || "Unbekannt",
    kategorie,
    type: "ausnahme",
    url: `${host} (erste Anfrage dieser Art)`,
    rule: rule || kategorie
  });
  if (blockedRequests.length > MAX_BLOCK_LOG) {
    blockedRequests.shift();
  }
  sendBlockedRequests();
}

function kosmetikZuruecksetzen() {
  ausnahmeGemeldet.clear();
  kosmetikStand.clear();
}

function logBlockedUrl(url, provider, rule, type, kategorie = "") {
  blockedRequests.push({
    time: new Date().toLocaleTimeString(),
    provider: provider?.name || "Unbekannt",
    kategorie: kategorie || String(type || "").toUpperCase(),
    type,
    url,
    rule
  });
  if (blockedRequests.length > MAX_BLOCK_LOG) {
    blockedRequests.shift();
  }
  sendBlockedRequests();
}

function sendBlockedRequests() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("adblock:blocked", blockedRequests.slice(-120).reverse());
  }
}

function logMediaDiagnostic(provider, url, status, message, meta = {}) {
  const identity = episodeIdentity(url);
  const type = mediaTypeForProgressUrl(url, meta.type);
  const title = cleanTitle(meta.currentTitle || meta.title || titleFromPath(url) || "");
  const row = {
    time: new Date().toLocaleTimeString(),
    provider: provider?.name || "Unbekannt",
    status,
    message,
    title,
    url,
    mediaKey: identity?.key || mediaSlugFromUrl(url) || "",
    target: type === "film" ? `Film: ${title}` : (identity ? favoriteProgressTargetLabel(url) : type),
    watchedSeconds: Math.round(sanitizePositiveNumber(meta.watchedSeconds)),
    currentTime: Math.round(sanitizePositiveNumber(meta.currentTime || meta.position)),
    duration: Math.round(sanitizePositiveNumber(meta.duration)),
    progress: sanitizeProgress(meta.progress),
    favorite: Boolean(meta.favorite),
    continueVisible: Boolean(meta.continueVisible)
  };
  mediaDiagnostics.push(row);
  if (mediaDiagnostics.length > MAX_MEDIA_LOG) {
    mediaDiagnostics.shift();
  }
  if (shouldPrintMediaDiagnostic(row)) {
    console.log(formatMediaDiagnosticLog(row));
  }
  sendMediaDiagnostics();
}

function shouldPrintMediaDiagnostic(row) {
  const key = [
    row.provider,
    row.mediaKey || row.title || row.url,
    row.target
  ].join("|");
  const watchedBucket = Math.floor(row.watchedSeconds / 30);
  const progressBucket = Math.floor(row.progress / 10);
  const completedBucket = row.progress >= COMPLETED_PROGRESS_PERCENT ? "completed" : "open";
  const state = {
    status: row.status,
    favorite: row.favorite,
    continueVisible: row.continueVisible,
    watchedBucket,
    progressBucket,
    completedBucket
  };
  const previous = mediaConsoleLogState.get(key);
  mediaConsoleLogState.set(key, state);

  if (!previous) return true;
  return previous.status !== state.status
    || previous.favorite !== state.favorite
    || previous.continueVisible !== state.continueVisible
    || previous.watchedBucket !== state.watchedBucket
    || previous.progressBucket !== state.progressBucket
    || previous.completedBucket !== state.completedBucket;
}

function formatMediaDiagnosticLog(row) {
  const parts = [
    `[ELFIX MEDIA] ${row.time}`,
    row.provider,
    row.status.toUpperCase(),
    row.mediaKey ? `media=${row.mediaKey}` : "",
    row.target === "unknown" ? "" : row.target,
    row.message,
    `played=${row.watchedSeconds}s`,
    row.duration > 0 ? `time=${row.currentTime}s/${row.duration}s` : "time=unbekannt",
    `progress=${row.progress}%`,
    row.favorite ? "watchlist=ja" : "watchlist=nein",
    row.continueVisible ? "weiterschauen=ja" : "weiterschauen=nein"
  ];
  return parts.filter(Boolean).join(" | ");
}

function sendMediaDiagnostics() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("media:diagnostics", mediaDiagnostics.slice(-120).reverse());
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Was die Wiedergabe wirklich braucht - und sonst nichts.
//
// Frueher stand hier istWiedergabeAnfrage(): "kommt es von VOE, Filemoon,
// StreamWish und so weiter, ist es Wiedergabe" - und die Anfrage lief komplett
// am Filter vorbei. Genau darueber kamen die Popunder-Skripte und die
// Werbenetze herein, denn die liegen auf denselben Hostern.
//
// Jetzt wird unterschieden. Freigegeben wird nur, was ein Player wirklich
// laedt: das Manifest, die Segmente, die Mediendatei, dazu der eine Rahmen,
// mit dem der Anbieter den Hoster einbettet. Ein Skript, ein XHR an ein
// Werbenetz oder ein zweites Iframe im Hosterrahmen bekommt keine Freigabe -
// das prueft tsurlfilter, auch wenn es von voe.sx kommt.
const MEDIEN_ENDUNGEN = /\.(m3u8|mpd|m4s|ts|mp4|m4v|webm|mkv|mov|m4a|aac|mp3|opus|vtt|srt|ass|key)(\?|$|#)/i;
const MEDIEN_PFADE = /\/(hls\d?|dash|manifest|playlist|segment|chunk|videoplayback|get_video|getvid|engine\/hls)/i;
// Nur diese Typen koennen ueberhaupt Medien sein. Ein "script" ist nie ein
// Segment, auch wenn die Adresse auf .ts endet - Typescript-Dateien heissen
// genauso.
const MEDIEN_TYPEN = ["media", "xhr", "other", "object"];

function wiedergabeAusnahme(url, provider, resourceType, quelle) {
  // Chromium kennzeichnet selbst, was ein <video> oder <audio> laedt. Das ist
  // die verlaesslichste Angabe, die es hier gibt - vor jeder Adressenraterei.
  if (resourceType === "media") return "MEDIA_ALLOWED";

  const zielHost = providerModel.hostFromUrl(url);
  const hosterZiel = isKnownVideoHosterUrl(url);
  const hosterQuelle = Boolean(quelle) && isKnownVideoHosterUrl(quelle);
  const eigenerAnbieter = isProviderFirstParty(zielHost, provider);

  if (MEDIEN_TYPEN.includes(resourceType)
    && (hosterZiel || hosterQuelle || eigenerAnbieter)
    && (MEDIEN_ENDUNGEN.test(url) || MEDIEN_PFADE.test(url))) {
    return "MEDIA_ALLOWED";
  }

  // Der Player-Rahmen selbst: der Anbieter bettet den Hoster ein. Was
  // innerhalb dieses Rahmens nachgeladen wird, laeuft wieder ganz normal durch
  // den Filter - die Freigabe gilt nur fuer den Rahmen.
  if (resourceType === "subFrame" && hosterZiel && isProviderFirstParty(providerModel.hostFromUrl(quelle || ""), provider)) {
    return "PLAYER_ALLOWED";
  }

  return "";
}

// Aus welchem Dokument kommt diese Anfrage? Ohne diese Angabe kann keine
// Regel mit $third-party oder $domain= richtig greifen - und genau die
// trennen auf einer Hosterseite die Wiedergabe von der Werbung.
function frameQuelle(details) {
  try {
    const rahmen = details.frame;
    if (rahmen && typeof rahmen.url === "string" && rahmen.url.startsWith("http")) return rahmen.url;
  } catch {
    // Ein Frame, der waehrend der Anfrage verworfen wird, wirft beim Zugriff.
    // Dann bleibt der Verweis.
  }
  const verweis = String(details.referrer || "");
  return verweis.startsWith("http") ? verweis : "";
}

// Das Urteil ueber eine einzelne Anfrage, mit allem, was ELFIX ueber den
// Anbieter weiss. Die Reihenfolge ist die eigentliche Aussage dieser Funktion:
//
//   1. Verifizierung  - Cloudflare und Captchas gehen immer vor
//   2. Ausnahmeliste  - was von Hand freigegeben wurde
//   3. Anbieterdomain - die Seite, auf der man gerade ist
//   4. tsurlfilter    - die eigentliche Entscheidung
//   5. Wiedergabe     - rettet nur noch das, was der Filter fallen liesse
//
// Punkt 5 kam frueher vor Punkt 4. Das war der Fehler: der Hoster-Bypass lief
// vor dem Filter und hat ihn damit fuer alles von diesem Host ausgehebelt.
function adblockUrteil(details, provider) {
  const url = String(details.url || "");
  const resourceType = String(details.resourceType || "other");
  if (!providerModel.isHttpUrl(url)) return { block: false };

  if (isChallengeOrVerificationUrl(url, provider) || istCaptchaHost(url)) {
    return { block: false, kategorie: "CAPTCHA_ALLOWED" };
  }

  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return { block: false };
  }

  if (isWhitelisted(hostname, settings.adblock.whitelist)) {
    return { block: false, kategorie: "FILTER_EXCEPTION", rule: "Ausnahmeliste" };
  }
  if (isProviderFirstParty(hostname, provider)) return { block: false };

  const quelle = frameQuelle(details);
  const urteil = adblock.matchRequest({ url, resourceType, sourceUrl: quelle });

  if (!urteil.block) {
    if (urteil.allowlist) {
      return { block: false, kategorie: "FILTER_EXCEPTION", rule: urteil.rule };
    }
    return { block: false };
  }

  // Der Schalter "Tracking-Schutz" soll etwas tun, ohne dass dafuer die Engine
  // neu gebaut werden muss: steht er aus, faellt genau das weg, was allein aus
  // der Tracking-Liste kommt. Werbung aus den anderen Listen bleibt geblockt.
  if (!settings.adblock.trackingProtection && Number(urteil.listId) === TRACKING_LISTEN_ID) {
    return { block: false, kategorie: "FILTER_EXCEPTION", rule: urteil.rule };
  }

  const ausnahme = wiedergabeAusnahme(url, provider, resourceType, quelle);
  if (ausnahme) return { block: false, kategorie: ausnahme, rule: urteil.rule };

  return { block: true, rule: urteil.rule, kategorie: blockKategorie(resourceType, urteil) };
}

function blockKategorie(resourceType, urteil) {
  if (Number(urteil.listId) === TRACKING_LISTEN_ID) return "TRACKER_BLOCKED";
  if (resourceType === "script") return "SCRIPT_BLOCKED";
  if (["ping", "cspReport"].includes(resourceType)) return "TRACKER_BLOCKED";
  return "NETWORK_RULE";
}

// ---------------------------------------------------------------------------
// Kosmetisches Filtern
//
// tsurlfilter sagt, welche Selektoren auf dieser Seite verborgen gehoeren.
// Eine Browsererweiterung haette dafuer Content Scripts; Electron hat
// frame.executeJavaScript(). Diese Haelfte bringt das eine ins andere.
//
// Eingespielt wird in jeden Rahmen einzeln: das Hauptdokument des Anbieters
// hat andere Regeln als der eingebettete Hosterrahmen, und das Gewinnspiel
// sitzt meistens im zweiten.
// ---------------------------------------------------------------------------

// Was fuer eine Adresse schon berechnet wurde. Der Aufruf kostet rund vier
// Millisekunden - fuer jeden Rahmen und jedes dom-ready neu waere das spuerbar.
const kosmetikStand = new Map();
const KOSMETIK_STAND_MAX = 40;

function kosmetikFuerAdresse(url) {
  const vorhanden = kosmetikStand.get(url);
  if (vorhanden) return vorhanden;
  const daten = adblock.kosmetik(url);
  const eintrag = {
    css: kosmetik.stilAusSelektoren(daten.stile),
    skripte: daten.skripte,
    selektoren: daten.stile.length
  };
  if (kosmetikStand.size > KOSMETIK_STAND_MAX) kosmetikStand.clear();
  kosmetikStand.set(url, eintrag);
  return eintrag;
}

function rahmenFinden(view, istHauptrahmen, prozessId, rahmenId) {
  try {
    if (Number.isInteger(prozessId) && Number.isInteger(rahmenId)) {
      const treffer = webFrameMain.fromId(prozessId, rahmenId);
      if (treffer) return treffer;
    }
  } catch {
    // Ein Rahmen, der beim Nachschlagen schon wieder weg ist.
  }
  try {
    return istHauptrahmen === false ? null : view.webContents.mainFrame;
  } catch {
    return null;
  }
}

// Ein Rahmen kann zwischen Nachschlagen und Aufruf verschwinden - beim
// Folgenwechsel passiert genau das staendig. Electron meldet den Zugriff dann
// als Fehler auf der Konsole, noch bevor das Versprechen entsteht; ohne diese
// Pruefung steht nach jedem Wechsel "Render frame was disposed" im Protokoll.
function rahmenLebt(rahmen) {
  try {
    if (!rahmen || typeof rahmen.executeJavaScript !== "function") return false;
    if (typeof rahmen.isDestroyed === "function" && rahmen.isDestroyed()) return false;
    if (rahmen.detached === true) return false;
    return true;
  } catch {
    return false;
  }
}

function frameAusfuehren(rahmen, script) {
  if (!rahmenLebt(rahmen)) return Promise.resolve(null);
  try {
    return rahmen.executeJavaScript(script, true).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

function kosmetikEinspielen(provider, view, url, istHauptrahmen, prozessId, rahmenId) {
  if (!provider || !settings.adblock?.enabled || provider.adblockEnabled === false) return;
  if (!isLiveView(view) || !providerModel.isHttpUrl(url)) return;

  const host = providerModel.hostFromUrl(url);
  // Wer eine Seite von Hand freigegeben hat, will dort auch nichts verborgen
  // haben - sonst waere die Ausnahmeliste nur eine halbe Ausnahme.
  if (isWhitelisted(host, settings.adblock.whitelist)) return;

  const rahmen = rahmenFinden(view, istHauptrahmen, prozessId, rahmenId);
  if (!rahmen) return;

  const eintrag = kosmetikFuerAdresse(url);
  // Das Seitenskript zuerst: der Stil und das Ausblenden laufen ueber die
  // Schnittstelle, die es anlegt.
  frameAusfuehren(rahmen, kosmetik.seitenScript()).then(() => {
    if (eintrag.css) frameAusfuehren(rahmen, kosmetik.stilAufrufScript(eintrag.css));
    // Scriptlets sind das schaerfste Werkzeug in den Listen: sie klemmen
    // Popunder-Aufrufe direkt im Javascript der Seite ab. Sie greifen damit
    // aber auch am tiefsten ein, deshalb haengen sie am Popup-Schalter - wer
    // einen kaputten Player vermutet, hat genau eine Stelle zum Abschalten.
    if (!settings.adblock.blockPopups) return;
    for (const code of eintrag.skripte) frameAusfuehren(rahmen, code);
  });
}

// Antwort auf eine Meldung aus der Seite.
function kosmetikMeldung(provider, view, rahmen, nachricht) {
  const meldung = kosmetik.meldungLesen(nachricht);
  if (!meldung || meldung.art !== "kandidaten" || !Array.isArray(meldung.daten)) return;
  if (!settings.adblock?.enabled || provider?.adblockEnabled === false) return;

  const ziel = rahmen || rahmenFinden(view, true);
  if (!ziel) return;

  const marken = [];
  for (const kandidat of meldung.daten.slice(0, 6)) {
    const urteil = kosmetik.istWerbeOverlay(kandidat, {
      istWerbeHost: (hostname) => adblock.istWerbeHost(hostname)
    });
    if (!urteil.entfernen) continue;
    marken.push(kandidat.marke);
    logBlockedUrl(
      `${kandidat.tag}${kandidat.id ? "#" + kandidat.id : ""}${kandidat.klassen ? "." + String(kandidat.klassen).trim().split(/\s+/)[0] : ""}`,
      provider,
      `overlay:${urteil.grund}`,
      "overlay",
      "COSMETIC_RULE"
    );
  }
  if (marken.length) frameAusfuehren(ziel, kosmetik.entfernenAufrufScript(marken));
}


function isWhitelisted(hostname, whitelist) {
  return whitelist.some((entry) => {
    const clean = String(entry).trim().replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
    return clean && (hostname === clean || hostname.endsWith(`.${clean}`));
  });
}

function isProviderFirstParty(hostname, provider) {
  if (!provider || !hostname) return false;
  const target = stripWww(hostname);
  const providerHost = stripWww(providerModel.hostFromUrl(provider.startUrl));
  const name = String(provider?.name || "").toLowerCase();
  if (providerHost && (target === providerHost || target.endsWith(`.${providerHost}`))) return true;
  if (name.includes("aniworld")) return target.includes("aniworld");
  if (isStoProviderLike(provider)) return target === "s.to" || target.endsWith(".s.to") || target === providerHost;
  if (name.includes("filmo")) return target.includes("filmo");
  return false;
}

function isKnownAuthHost(url) {
  const authHosts = [
    "accounts.google.com",
    "appleid.apple.com",
    "login.microsoftonline.com",
    "login.live.com",
    "facebook.com",
    "www.facebook.com",
    "challenges.cloudflare.com",
    "hcaptcha.com",
    "recaptcha.net"
  ];
  const host = providerModel.hostFromUrl(url);
  return authHosts.some((item) => host === item || host.endsWith(`.${item}`));
}
