const api = window.streamingBrowser;
// Die Rechnung hinter dem Titelhintergrund. Dasselbe Modul benutzt der
// Hauptprozess beim Speichern - Vorschau, Anzeige und Ablage koennen sich
// deshalb nicht widersprechen.
const bildausschnittModul = globalThis.ELFIX_BILDAUSSCHNITT;
// Die Regeln des persoenlichen Verlaufs. Sie stehen im gemeinsamen Modul,
// damit der Kasten hier und jede Pruefung dieselbe Rechnung anstellen.
const verlaufModul = globalThis.ELFIX_VERLAUF;

let providers = [];
let favorites = [];
/**
 * Wie der Bestand beim letzten Zeichnen aussah - siehe {@link bestandsbild}.
 */
let letztesBestandsbild = "";

/**
 * Alles, was Startseite, Watchlist und Mediathek aus einem Eintrag wirklich
 * zeigen - als eine Zeile zum Vergleichen.
 *
 * <p>Das Gegenstueck zu {@code seitenbild()} in der Android-Fassung, und aus
 * demselben Grund: der Hauptprozess meldet seinen Stand im Fuenfsekundentakt,
 * und ohne diesen Vergleich ist jede Meldung ein kompletter Neuaufbau.
 *
 * <p>Der Fortschritt geht auf ganze Prozent gerundet mit ein. Die Sekunde
 * selbst waere zu fein - dann zeichnete jede Meldung neu, und der Vergleich
 * brachte nichts. Ganz weglassen liesse den Balken stehen, waehrend auf einem
 * anderen Geraet weitergeschaut wird. Ein Prozent einer Folge sind ungefaehr
 * vierzehn Sekunden; so bleibt der Balken ehrlich und die Seite ruhig.
 */
function bestandsbild(liste) {
  const teile = [];
  // Zuerst die Reihenfolge, in der die Startseite sie zeigt.
  //
  // Sie haengt an Zeitstempeln (favoriteTimestamp), und die wandern bei jeder
  // Meldung weiter, ohne dass sich unten am Eintrag etwas aendert. Wer nur die
  // Eintraege vergliche, wuerde ein Umsortieren verschlafen und eine Kachel an
  // der falschen Stelle stehen lassen. Verglichen wird deshalb das Ergebnis der
  // Sortierung und nicht ihre Eingabe - so zaehlt eine neue Zeit nur dann, wenn
  // sie wirklich etwas verschiebt.
  try {
    teile.push(sortedHomeFavorites().map((eintrag) => eintrag?.id).join(","));
  } catch {
    // Vor dem ersten Zeichnen kann die Sortierung noch nichts liefern. Dann
    // entscheidet allein die Liste darunter - und die ist beim ersten Mal
    // ohnehin anders als der leere Anfangswert.
  }
  for (const eintrag of Array.isArray(liste) ? liste : []) {
    if (!eintrag) continue;
    const dauer = Number(eintrag.duration) || 0;
    const stelle = Number(eintrag.currentTime) || Number(eintrag.position) || 0;
    const prozent = dauer > 0 ? Math.round((stelle / dauer) * 100) : 0;
    teile.push([
      eintrag.id,
      eintrag.title,
      eintrag.url,
      eintrag.season,
      eintrag.episode,
      eintrag.thumbnail,
      eintrag.customThumbnail,
      eintrag.customThumbnailCrop && JSON.stringify(eintrag.customThumbnailCrop),
      eintrag.favorite ? 1 : 0,
      eintrag.completed ? 1 : 0,
      eintrag.rewatching ? 1 : 0,
      eintrag.rewatchCount,
      eintrag.hideFromContinue ? 1 : 0,
      eintrag.continuePending ? 1 : 0,
      eintrag.newEpisodeAt,
      eintrag.newEpisodeLabel,
      eintrag.watchpartyRoom,
      eintrag.providerName,
      eintrag.watched ? 1 : 0,
      prozent
    ].join("#"));
  }
  return teile.join("\n");
}
let settings = {};
let appInfo = {};
let updateState = {};
let activeProviderId = null;
let currentRoute = "start";
let routeBeforeSettings = null;
let selectedProviderIndex = -1;
let draggedProviderIndex = -1;
let blockedRequests = [];
let mediaDiagnostics = [];
let filterLists = [];
let searchHistory = JSON.parse(localStorage.getItem("elflix-search-history") || "[]");
let currentUrl = "";
let activeSearchToken = 0;
let autostartPending = false;
let lastSettingsTab = "appearance";
const HERO_ROTATION_COUNT = 5;
const HERO_ROTATION_MS = 15000;
let heroItems = [];
let heroIndex = 0;
let heroTimer = 0;
let heroPaused = false;
let recommendations = [];
let recommendationsLoaded = false;
let recommendationsPending = false;
let recommendationsAt = 0;
let discoverRefreshTimer = 0;
const DISCOVER_REFRESH_MS = 15 * 60 * 1000;
let personalPicks = [];
let personalLoaded = false;
let personalPending = false;
let personalSignature = "";
let watchpartyItems = [];
let watchpartyState = null;
// Die eingetragenen Raumcodes waehrend der Einstellungen offen sind.
let watchpartyRaeume = [];
const thumbnailRepairAttempts = new Set();
// Bilder, die sich nicht laden liessen - Adresse und Zeitpunkt.
//
// Ohne dieses Gedaechtnis gaebe es zwei schlechte Ausgaenge und keinen
// guten: entweder setzt jedes Neuzeichnen dieselbe kaputte Adresse wieder
// in den src und der onerror feuert im Kreis, oder die Adresse wird
// weggeworfen und ein Aussetzer von zehn Sekunden kostet das Bild bis zum
// naechsten Neustart. Gemerkt wird deshalb der *Fehlschlag*, nicht das
// Urteil: nach BILDFEHLER_PAUSE_MS ist die Adresse wieder einen Versuch
// wert, und wer wieder online geht, bekommt ihn sofort.
const bildFehler = new Map();
const BILDFEHLER_PAUSE_MS = 5 * 60 * 1000;
const BILDFEHLER_MAX = 400;

function bildGiltAlsKaputt(url) {
  const seit = bildFehler.get(url);
  if (!seit) return false;
  if (Date.now() - seit < BILDFEHLER_PAUSE_MS) return true;
  bildFehler.delete(url);
  return false;
}

function bildAlsKaputtMerken(url) {
  if (bildFehler.size > BILDFEHLER_MAX) bildFehler.clear();
  bildFehler.set(url, Date.now());
}

// Wieder am Netz heisst: jede Adresse hat einen neuen Versuch verdient.
window.addEventListener("online", () => {
  if (!bildFehler.size) return;
  bildFehler.clear();
  thumbnailRepairAttempts.clear();
  renderFavorites();
  renderHome();
  renderLibraryViews();
});

const appShell = document.querySelector(".app-shell");
const appSidebar = document.querySelector("#appSidebar");
const sidebarToggle = document.querySelector("#sidebarToggle");
const homeSidebarToggle = document.querySelector("#homeSidebarToggle");
const providerRail = document.querySelector("#providerRail");
const homeYoutubeContinue = document.querySelector("#homeYoutubeContinue");
const homeSidebarProviders = document.querySelector("#homeSidebarProviders");
const homeRecommendations = document.querySelector("#homeRecommendations");
const recommendedHomeRow = document.querySelector("#recommendedHomeRow");
const homePersonal = document.querySelector("#homePersonal");
const discoveryView = document.querySelector("#discoveryView");
const discoveryGrid = document.querySelector("#discoveryGrid");
const discoveryFoot = document.querySelector("#discoveryFoot");
const discoverySentinel = document.querySelector("#discoverySentinel");
const discoveryTitle = document.querySelector("#discoveryTitle");
const discoveryCopy = document.querySelector("#discoveryCopy");
const personalHomeRow = document.querySelector("#personalHomeRow");
// Die drei Kategoriereihen unterscheiden sich nur im Medientyp - der Main
// bewertet einmal und filtert danach, deshalb kostet jede Reihe nichts extra.
const categoryRails = [
  { type: "anime", rail: document.querySelector("#homeAnime"), row: document.querySelector("#animeHomeRow") },
  { type: "serie", rail: document.querySelector("#homeSerien"), row: document.querySelector("#serienHomeRow") },
  { type: "film", rail: document.querySelector("#homeFilme"), row: document.querySelector("#filmeHomeRow") }
].map((eintrag) => ({ ...eintrag, items: [], loaded: false, pending: false }));
const homeQuickSearch = document.querySelector("#homeQuickSearch");
const heroEyebrow = document.querySelector("#heroEyebrow");
const heroProgress = document.querySelector("#heroProgress");
const heroProgressFill = document.querySelector("#heroProgressFill");
const heroProgressText = document.querySelector("#heroProgressText");
const heroDetails = document.querySelector("#heroDetails");
const homeSidebarVersion = document.querySelector("#homeSidebarVersion");
const browserFrame = document.querySelector("#browserFrame");
const homeView = document.querySelector("#homeView");
const globalSearchView = document.querySelector("#globalSearchView");
const favoritesView = document.querySelector("#favoritesView");
const libraryView = document.querySelector("#libraryView");
const reviewView = document.querySelector("#reviewView");
const wrappedModal = document.querySelector("#wrappedModal");
const continueView = document.querySelector("#continueView");
const watchpartyView = document.querySelector("#watchpartyView");
const watchpartyGrid = document.querySelector("#watchpartyGrid");
const watchpartyEmpty = document.querySelector("#watchpartyEmpty");
const watchpartyEmptyTitle = document.querySelector("#watchpartyEmptyTitle");
const watchpartyEmptyCopy = document.querySelector("#watchpartyEmptyCopy");
const watchpartyViewStatus = document.querySelector("#watchpartyViewStatus");
const historyView = document.querySelector("#historyView");
const noProvidersState = document.querySelector("#noProvidersState");
const homeHero = document.querySelector("#homeHero");
const heroDots = document.querySelector("#heroDots");
const youtubeHomeRow = document.querySelector("#youtubeHomeRow");
const favoritesHomeRow = document.querySelector("#favoritesHomeRow");
const heroTitle = document.querySelector("#heroTitle");
const heroCopy = document.querySelector("#heroCopy");
const searchTitle = document.querySelector("#searchTitle");
const searchHistoryNode = document.querySelector("#searchHistory");
const globalSearchGrid = document.querySelector("#globalSearchGrid");
const homeFavorites = document.querySelector("#homeFavorites");
const homeWatchpartyContinue = document.querySelector("#homeWatchpartyContinue");
const homeNewEpisodes = document.querySelector("#homeNewEpisodes");
const newEpisodeRow = document.querySelector("#newEpisodeRow");
const watchlistBadge = document.querySelector("#watchlistBadge");
const watchpartyHomeRow = document.querySelector("#watchpartyHomeRow");
const favoritesGrid = document.querySelector("#favoritesGrid");
const favoritesEmpty = document.querySelector("#favoritesEmpty");
const libraryGrid = document.querySelector("#libraryGrid");
const libraryEmpty = document.querySelector("#libraryEmpty");
const continueGrid = document.querySelector("#continueGrid");
const continueEmpty = document.querySelector("#continueEmpty");
const continuePartyGrid = document.querySelector("#continuePartyGrid");
const continuePartyGroup = document.querySelector("#continuePartyGroup");
const historyList = document.querySelector("#historyList");
const historySearch = document.querySelector("#historySearch");
const historySummary = document.querySelector("#historySummary");
const historyRangeFilter = document.querySelector("#historyRangeFilter");
const historyTypeFilter = document.querySelector("#historyTypeFilter");
const historyProviderFilter = document.querySelector("#historyProviderFilter");
const historyEmpty = document.querySelector("#historyEmpty");
const historyClear = document.querySelector("#historyClear");
const toastStack = document.querySelector("#toastStack");
const confirmModal = document.querySelector("#confirmModal");
const confirmEyebrow = document.querySelector("#confirmEyebrow");
const confirmTitle = document.querySelector("#confirmTitle");
const confirmCopy = document.querySelector("#confirmCopy");
const confirmBody = document.querySelector("#confirmBody");
const confirmAccept = document.querySelector("#confirmAccept");
const confirmCancel = document.querySelector("#confirmCancel");
const cropModal = document.querySelector("#cropModal");
const cropStage = document.querySelector("#cropStage");
const cropPreview = document.querySelector("#cropPreview");
const cropModes = document.querySelector("#cropModes");
const cropZoom = document.querySelector("#cropZoom");
const cropZoomValue = document.querySelector("#cropZoomValue");
const cropReset = document.querySelector("#cropReset");
const cropCenter = document.querySelector("#cropCenter");
const cropSave = document.querySelector("#cropSave");
const cropSaveHint = document.querySelector("#cropSaveHint");
const cropBody = document.querySelector("#cropBody");
const cropCancel = document.querySelector("#cropCancel");
const cropApply = document.querySelector("#cropApply");
const omnibox = document.querySelector("#omnibox");
const settingsModal = document.querySelector("#settingsModal");
const settingsSearch = document.querySelector("#settingsSearch");
const settingsSearchResults = document.querySelector("#settingsSearchResults");
const providerSettingsList = document.querySelector("#providerSettingsList");
const providerForm = document.querySelector("#providerForm");
const providerName = document.querySelector("#providerName");
const providerHome = document.querySelector("#providerHome");
const providerSearch = document.querySelector("#providerSearch");
const providerLogo = document.querySelector("#providerLogo");
const providerEnabled = document.querySelector("#providerEnabled");
const providerAdblock = document.querySelector("#providerAdblock");
const adblockEnabled = document.querySelector("#adblockEnabled");
const trackingEnabled = document.querySelector("#trackingEnabled");
const popupBlockingEnabled = document.querySelector("#popupBlockingEnabled");
const redirectBlockingEnabled = document.querySelector("#redirectBlockingEnabled");
const whitelistInput = document.querySelector("#whitelistInput");
const cacheMode = document.querySelector("#cacheMode");
const themeMode = document.querySelector("#themeMode");
const compactHeader = document.querySelector("#compactHeader");
const accentPreset = document.querySelector("#accentPreset");
const accentColor = document.querySelector("#accentColor");
const accentHex = document.querySelector("#accentHex");
const accentStrength = document.querySelector("#accentStrength");
const accentStrengthValue = document.querySelector("#accentStrengthValue");
const uiDensity = document.querySelector("#uiDensity");
const uiDensityValue = document.querySelector("#uiDensityValue");
const cardSize = document.querySelector("#cardSize");
const cardSizeValue = document.querySelector("#cardSizeValue");
const favoriteSize = document.querySelector("#favoriteSize");
const favoriteSizeValue = document.querySelector("#favoriteSizeValue");
const favoriteLayout = document.querySelector("#favoriteLayout");
const favoriteTextSize = document.querySelector("#favoriteTextSize");
const favoriteTextSizeValue = document.querySelector("#favoriteTextSizeValue");
const favoriteArtwork = document.querySelector("#favoriteArtwork");
const cornerStyle = document.querySelector("#cornerStyle");
const backgroundStyle = document.querySelector("#backgroundStyle");
const backgroundColor = document.querySelector("#backgroundColor");
const fontScale = document.querySelector("#fontScale");
const fontScaleValue = document.querySelector("#fontScaleValue");
const animationMode = document.querySelector("#animationMode");
const cardStyle = document.querySelector("#cardStyle");
const shadowStyle = document.querySelector("#shadowStyle");
const showProviderStrip = document.querySelector("#showProviderStrip");
const showHeroHome = document.querySelector("#showHeroHome");
const showHomeYoutube = document.querySelector("#showHomeYoutube");
const showHomeFavorites = document.querySelector("#showHomeFavorites");
const showHomePersonal = document.querySelector("#showHomePersonal");
const showHomeCategories = document.querySelector("#showHomeCategories");
const watchpartyEnabled = document.querySelector("#watchpartyEnabled");
const watchpartyServer = document.querySelector("#watchpartyServer");
const watchpartyRoom = document.querySelector("#watchpartyRoom");
const watchpartyRoomAdd = document.querySelector("#watchpartyRoomAdd");
const watchpartyStatusseite = document.querySelector("#watchpartyStatusseite");
const watchpartyRoomList = document.querySelector("#watchpartyRoomList");
const watchpartyName = document.querySelector("#watchpartyName");
const watchpartyStatus = document.querySelector("#watchpartyStatus");
// Meine Geraete. Der Schluessel steht bewusst nicht im Einstellungsformular:
// er wird ueber eigene Aufrufe gesetzt und geloescht, damit ihn kein
// beilaeufiges Speichern der Einstellungen mitnimmt.
const geraeteKey = document.querySelector("#geraeteKey");
const geraeteKeyUse = document.querySelector("#geraeteKeyUse");
const geraeteKeyNew = document.querySelector("#geraeteKeyNew");
const geraeteKeyCopy = document.querySelector("#geraeteKeyCopy");
const geraeteDisconnect = document.querySelector("#geraeteDisconnect");
const geraeteSyncNow = document.querySelector("#geraeteSyncNow");
const geraeteStatus = document.querySelector("#geraeteStatus");
// Die Fernbedienung. Der Code steht nicht im Einstellungsformular: er wird
// ueber eigene Aufrufe erzeugt und erneuert.
const fernEnabled = document.querySelector("#fernEnabled");
const fernCode = document.querySelector("#fernCode");
const fernAdresse = document.querySelector("#fernAdresse");
const fernCodeCopy = document.querySelector("#fernCodeCopy");
const fernCodeNeu = document.querySelector("#fernCodeNeu");
const fernStatus = document.querySelector("#fernStatus");
const fernRelay = document.querySelector("#fernRelay");
const fernRelayZeile = document.querySelector("#fernRelayZeile");
const fernQr = document.querySelector("#fernQr");
const fernQrHinweis = document.querySelector("#fernQrHinweis");
const watchpartyLiveBanner = document.querySelector("#watchpartyLiveBanner");
const watchpartyLiveLeave = document.querySelector("#watchpartyLiveLeave");
const watchpartyLiveText = document.querySelector("#watchpartyLiveText");
const watchpartyStand = document.querySelector("#watchpartyStand");
// Die YouTube-Watchparty. Eigener Modus, eigene Flaeche - sie zeigt kein Raster
// aus eingestellten Titeln, sondern genau das eine Video der Runde.
const youtubeParty = document.querySelector("#youtubeParty");
const youtubePartyRoom = document.querySelector("#youtubePartyRoom");
const youtubePartyStatus = document.querySelector("#youtubePartyStatus");
const youtubePartyMembers = document.querySelector("#youtubePartyMembers");
const youtubePartyBanner = document.querySelector("#youtubePartyBanner");
const youtubePartyBannerText = document.querySelector("#youtubePartyBannerText");
let youtubePartyState = null;
let watchpartyLiveTimer = 0;
// Der zuletzt gemeldete Stand je Geraet und der Zeitgeber, der die Uhren
// zwischen zwei Meldungen weiterlaufen laesst.
let watchpartyStandDaten = null;
let watchpartyStandTimer = 0;
// Wer zuletzt Pause gedrueckt hat. Das ist nicht dasselbe wie "wer ist gerade
// angehalten": zieht ein zweites Geraet die Pause nur mit, bleibt der
// Ausloeser derselbe.
let watchpartyPausedBy = "";
// Die letzte vollstaendige Meldung. Die Anzeige greift immer darauf zurueck,
// nie auf einen zwischengespeicherten Hostnamen aus einem alten Zwischenruf.
let watchpartyLetzteMeldung = null;
// Der Live-Stand je Titel, nicht nur fuer die offene Seite. Die Karten in
// "Gemeinsam weiterschauen" zeigen damit, wer gerade schaut und wo er steht -
// vorher kam das nur aus dem gebuchten Fortschritt und blieb deshalb leer.
const watchpartyStandKarten = new Map();
const providerCardMeta = document.querySelector("#providerCardMeta");
const showFavoriteMeta = document.querySelector("#showFavoriteMeta");
const animationsEnabled = document.querySelector("#animationsEnabled");
const favoriteLayoutMirror = document.querySelector("#favoriteLayoutMirror");
const favoriteSizeMirror = document.querySelector("#favoriteSizeMirror");
const favoriteSizeMirrorValue = document.querySelector("#favoriteSizeMirrorValue");
const favoriteTextSizeMirror = document.querySelector("#favoriteTextSizeMirror");
const favoriteTextSizeMirrorValue = document.querySelector("#favoriteTextSizeMirrorValue");
const favoriteArtworkMirror = document.querySelector("#favoriteArtworkMirror");
const showFavoriteMetaMirror = document.querySelector("#showFavoriteMetaMirror");
const favoriteProgressMode = document.querySelector("#favoriteProgressMode");
const pauseOnProviderSwitch = document.querySelector("#pauseOnProviderSwitch");
const youtubeInMediathek = document.querySelector("#youtubeInMediathek");
const autoplayNextEpisode = document.querySelector("#autoplayNextEpisode");
const introSkip = document.querySelector("#introSkip");
// SponsorBlock. Ein Schalter fuer das Ganze, fuenf fuer die Kategorien, einer
// fuer die Meldung - in derselben Reihenfolge wie in der Einstellungsseite.
const sponsorblockFelder = {
  enabled: document.querySelector("#sponsorblockEnabled"),
  sponsor: document.querySelector("#sponsorblockSponsor"),
  selfpromo: document.querySelector("#sponsorblockSelfpromo"),
  interaction: document.querySelector("#sponsorblockInteraction"),
  intro: document.querySelector("#sponsorblockIntro"),
  outro: document.querySelector("#sponsorblockOutro"),
  hinweis: document.querySelector("#sponsorblockHinweis")
};
// Was gilt, wenn nichts gespeichert ist. Dieselben Werte wie in
// src/sponsorblock.js - die Oberflaeche kann das Modul nicht laden, also steht
// hier nur, was ein frisches Kaestchen zeigen soll.
const SPONSORBLOCK_STANDARD = {
  enabled: true, sponsor: true, selfpromo: true, interaction: true,
  intro: false, outro: false, hinweis: true
};
const markenStand = document.querySelector("#markenStand");
const markenVergessen = document.querySelector("#markenVergessen");
const rememberLanguage = document.querySelector("#rememberLanguage");
const fassungenStand = document.querySelector("#fassungenStand");
const fassungenVergessen = document.querySelector("#fassungenVergessen");
const showReviewLink = document.querySelector("#showReviewLink");
const wrappedMusik = document.querySelector("#wrappedMusik");
const notifyNewEpisodes = document.querySelector("#notifyNewEpisodes");
const pauseOnMinimize = document.querySelector("#pauseOnMinimize");
const pauseOnBlur = document.querySelector("#pauseOnBlur");
const blockedList = document.querySelector("#blockedList");
const mediaDiagnosticsList = document.querySelector("#mediaDiagnosticsList");
const filterStatus = document.querySelector("#filterStatus");
const filterListNames = document.querySelector("#filterListNames");
const appVersionLabel = document.querySelector("#appVersionLabel");
const updateFeedLabel = document.querySelector("#updateFeedLabel");
const updateStatusLabel = document.querySelector("#updateStatusLabel");
const updateProgressBar = document.querySelector("#updateProgressBar");
const updateProgressValue = document.querySelector("#updateProgressValue");
const updateCheckButton = document.querySelector("#updateCheckButton");
const updateReleaseLink = document.querySelector("#updateReleaseLink");
const settingsMode = document.querySelector("#settingsMode");
const designPreset = document.querySelector("#designPreset");
const autoDeriveColors = document.querySelector("#autoDeriveColors");
const exportAppearanceButton = document.querySelector("#exportAppearanceButton");
const importAppearanceInput = document.querySelector("#importAppearanceInput");
const sidebarExportAppearanceButton = document.querySelector("#sidebarExportAppearanceButton");
const sidebarImportAppearanceInput = document.querySelector("#sidebarImportAppearanceInput");
const sidebarResetSettingsButton = document.querySelector("#sidebarResetSettingsButton");
const sidebarVersionLabel = document.querySelector("#sidebarVersionLabel");
const designPresetInline = document.querySelector("#designPresetInline");
const autoDeriveColorsInline = document.querySelector("#autoDeriveColorsInline");
const autoColorsNote = document.querySelector("#autoColorsNote");
const disableAutoColorsButton = document.querySelector("#disableAutoColorsButton");
const autoCollapseSidebar = document.querySelector("#autoCollapseSidebar");
const showProviderStripNav = document.querySelector("#showProviderStripNav");
const cardScaleInline = document.querySelector("#cardScaleInline");
const cardScaleInlineValue = document.querySelector("#cardScaleInlineValue");
const cardGapInline = document.querySelector("#cardGapInline");
const cardGapInlineValue = document.querySelector("#cardGapInlineValue");
const appearanceControls = Array.from(document.querySelectorAll(".appearance-control"));
const appearanceControlMap = Object.fromEntries(appearanceControls.map((node) => [node.id, node]));

const rangeSettings = {
  uiDensity: {
    node: uiDensity,
    valueNode: uiDensityValue,
    values: ["compact", "comfortable", "roomy"],
    labels: ["Kompakt", "Normal", "Groß"]
  },
  cardSize: {
    node: cardSize,
    valueNode: cardSizeValue,
    values: ["small", "medium", "large"],
    labels: ["Klein", "Mittel", "Groß"]
  },
  favoriteSize: {
    node: favoriteSize,
    valueNode: favoriteSizeValue,
    values: ["small", "medium", "large", "poster"],
    labels: ["Klein", "Mittel", "Groß", "Poster"]
  },
  favoriteTextSize: {
    node: favoriteTextSize,
    valueNode: favoriteTextSizeValue,
    values: ["small", "medium", "large"],
    labels: ["Kleiner", "Normal", "Größer"]
  },
  favoriteSizeMirror: {
    node: favoriteSizeMirror,
    valueNode: favoriteSizeMirrorValue,
    values: ["small", "medium", "large", "poster"],
    labels: ["Klein", "Mittel", "Groß", "Poster"]
  },
  favoriteTextSizeMirror: {
    node: favoriteTextSizeMirror,
    valueNode: favoriteTextSizeMirrorValue,
    values: ["small", "medium", "large"],
    labels: ["Kleiner", "Normal", "Größer"]
  }
};

const DEFAULT_HOME_SETTINGS = {
  showHero: true,
  showYoutube: true,
  showFavorites: true,
  showPersonal: true,
  showCategories: true,
  // Aus: die Statistik draengt sich nicht in die Seitenleiste.
  showReview: false,
  providerCardMeta: "logoName",
  librarySort: "manuell"
};

const DEFAULT_APPEARANCE_SETTINGS = {
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
  // Ob die Dichte einer der drei Voreinstellungen entspricht oder von Hand
  // gesetzt wurde. Frueher merkte sich das layoutStyle mit - dasselbe Feld,
  // das auch die Layout-Voreinstellung (Standard, Netflix, ...) traegt. Dann
  // leuchteten in "Dichte & Groesse" zwei Knoepfe gleichzeitig: der zur
  // eingestellten Dichte und "Benutzerdef.".
  densityMode: "preset",
  cardSize: "medium",
  // Poster von Haus aus: hochkant zeigt mehr Bild und weniger Leerraum, und
  // die Titelbilder der Anbieter sind ohnehin fast alle Hochformat.
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
};

const SETTINGS_INDEX = [
    ["appearance", "Design sichern", "Export Import Backup Datei laden speichern"],
  ["appearance", "Hell oder dunkel", "Theme System OLED Schwarz Modus"],
  ["appearance", "Akzentfarbe", "Farbe Preset Hex Stärke violett blau rot"],
  ["appearance", "Design-Presets", "Cinema OLED Minimal Glass Colorful fertige Designs"],
  ["appearance", "Layout-Stil", "Standard Kompakt Geräumig Netflix Minimal"],
  ["appearance", "Größe der Karten", "Kacheln größer kleiner Dichte"],
  ["appearance", "Watchlist-Karten", "Layout Raster Liste Bild Text Provider anzeigen"],
  ["appearance", "Schriftgröße", "Text größer kleiner lesbar"],
  ["appearance", "Animationen", "Bewegung reduzieren ausschalten"],
  ["appearance", "Anbieter-Leiste", "Leiste oben ein ausblenden Navigation"],
  ["advancedAppearance", "Einzelne Farben", "Hintergrund Panels Karten Text Rahmen Fokus Fehler Erfolg Scrollbalken"],
  ["advancedAppearance", "Größen und Abstände", "Skalierung Abstand Rundung Ecken Buttonhöhe Schatten Hover Tempo"],
  ["homeSettings", "Startseite einrichten", "Hero Anbieter Watchlist Bereiche ausblenden Logo"],
  ["providers", "Anbieter verwalten", "Website hinzufügen löschen sortieren Suche URL Kürzel"],
  ["providers", "Adblock pro Anbieter", "Werbung einzelne Seite ausnehmen"],
  ["playback", "Automatisch pausieren", "Anbieterwechsel Minimieren Fokus verlassen"],
  ["playback", "Weiterschauen-Fortschritt", "nächste Folge weiterrücken stehen bleiben"],
  ["playback", "Nächste Folge von selbst starten", "Autoplay automatisch weiter Countdown Zähler 5 Sekunden abschalten"],
  ["home", "Statistik in der Seitenleiste", "Rückblick Statistik Wrapped Jahresrückblick einblenden ausblenden"],
  ["home", "Musik im Jahresrückblick", "Wrapped Opening Anime Ton Musik Lied Intro stumm"],
  ["playback", "SponsorBlock", "Sponsor Werbung überspringen YouTube Eigenwerbung Interaktion Intro Outro skip"],
  ["browser", "Werbung blockieren", "Adblock Popups Weiterleitungen Tracking Filterlisten"],
  ["browser", "Ausnahmen", "Whitelist Domain erlauben Seite funktioniert nicht"],
  ["browser", "Zwischenspeicher", "Cache Browserdaten löschen Start Reload"],
  ["data", "Version und Updates", "GitHub Release prüfen installieren"],
  ["data", "Aufräumen und Zurücksetzen", "Cache leeren Datenordner Reset alles löschen"],
  ["data", "Media-Diagnose", "Protokoll Wiedergabe erkannt blockiert"]
].map(([tab, title, description]) => ({ tab, title, description }));

init();

async function init() {
  try {
    const state = await api.init();
    providers = state.providers;
    favorites = state.favorites || [];
    settings = state.settings;
    appInfo = state.appInfo || {};
    updateState = state.updateState || {};
    filterLists = state.filterLists || [];
    activeProviderId = state.activeProviderId;
    render();
    bindEvents();
    applyAppearance();
    applySidebarState();
    syncBrowserBounds();
    await api.showHome();
    await api.setShellOpen(true);
  } catch (error) {
    showStartupError(error);
  }
}

function bindEvents() {
  window.addEventListener("resize", syncBrowserBounds);
  window.addEventListener("resize", () => window.setTimeout(syncBrowserBounds, 200));
  new ResizeObserver(syncBrowserBounds).observe(browserFrame);
  cropBinden();
  kartenMenueBinden();

  document.querySelector("#startButton")?.addEventListener("click", showHome);
  document.querySelector("#searchButton")?.addEventListener("click", openSearchView);
  document.querySelector("#favoritesButton")?.addEventListener("click", showFavorites);
  document.querySelector("#settingsButton").addEventListener("click", openSettings);
  startDiscoverRefresh();
  document.querySelector("#watchpartyShareButton")?.addEventListener("click", shareCurrentToWatchparty);
  watchpartyRoomAdd?.addEventListener("click", watchpartyRaumHinzufuegen);
  watchpartyStatusseite?.addEventListener("click", relayStatusseiteOeffnen);
  watchpartyRoom?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    // Sonst schickt Enter das Einstellungsformular ab, statt den Raum zu setzen.
    event.preventDefault();
    watchpartyRaumHinzufuegen();
  });
  api.onWatchpartyState?.(renderWatchpartyStatus);
  geraeteKeyNew?.addEventListener("click", geraeteSchluesselErzeugen);
  geraeteKeyUse?.addEventListener("click", geraeteSchluesselUebernehmen);
  geraeteKeyCopy?.addEventListener("click", geraeteSchluesselKopieren);
  geraeteDisconnect?.addEventListener("click", geraeteTrennen);
  geraeteSyncNow?.addEventListener("click", geraeteJetztAbgleichen);
  geraeteKey?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    // Sonst schickt Enter das Einstellungsformular ab, statt den Schluessel zu
    // uebernehmen.
    event.preventDefault();
    geraeteSchluesselUebernehmen();
  });
  api.onGeraeteState?.(renderGeraeteStatus);
  fernEnabled?.addEventListener("change", fernUmschalten);
  fernCodeNeu?.addEventListener("click", fernNeuerCode);
  fernCodeCopy?.addEventListener("click", fernCodeKopieren);
  api.onFernState?.(renderFernStatus);
  api.getFernStatus?.().then(renderFernStatus).catch(() => {});
  // Was per Tastenkuerzel aus dem Hauptprozess kommt. Die Ansicht wechselt hier
  // und nicht dort: welche Bereiche dabei zu verbergen sind, weiss nur die
  // Oberflaeche.
  api.onTastenBefehl?.((befehl) => {
    if (befehl !== "suche") return;
    openSearchView().catch(() => {});
  });
  api.getGeraeteStatus?.().then(renderGeraeteStatus).catch(() => {});
  api.onWatchpartyLive?.(showWatchpartyLive);
  api.onWatchpartyWatchstate?.(showWatchpartyStand);
  watchpartyLiveLeave?.addEventListener("click", toggleWatchpartyLive);
  watchpartyLiveBanner?.addEventListener("click", switchWatchpartyContext);
  document.querySelector("#watchpartyResync")?.addEventListener("click", resyncWatchparty);
  document.querySelector("#watchpartyHandover")?.addEventListener("click", watchpartyHostWeitergeben);
  api.onWatchpartyItems?.((items) => {
    watchpartyItems = Array.isArray(items) ? items : [];
    renderWatchpartyItems();
  });
  api.getWatchpartyStatus?.().then(renderWatchpartyStatus).catch(() => {});
  loadWatchpartyItems();
  api.onYoutubePartyState?.(renderYoutubeParty);
  youtubePartyRoom?.addEventListener("change", youtubePartyRaumWaehlen);
  document.querySelector("#youtubePartyResync")?.addEventListener("click", youtubePartyAbgleichen);
  document.querySelector("#youtubePartyOpen")?.addEventListener("click", youtubePartyOeffnen);
  youtubePartyBanner?.addEventListener("click", youtubePartyKontextWechseln);
  api.getYoutubePartyStatus?.().then(renderYoutubeParty).catch(() => {});
  // Aus der Watchparty heraus direkt deren Bereich in den Einstellungen.
  const watchpartyEinstellungen = async () => {
    await openSettings();
    activateTab("watchparty");
  };
  document.querySelector("#watchpartySettingsLink")?.addEventListener("click", watchpartyEinstellungen);
  document.querySelector("#watchpartyOpenSettings")?.addEventListener("click", watchpartyEinstellungen);
  document.querySelector("#refreshPersonal")?.addEventListener("click", () => {
    if (personalPending) return;
    personalPicks = [];
    personalLoaded = false;
    homePersonal?.replaceChildren(emptyText("Empfehlungen werden berechnet …"));
    loadPersonalPicks(true);
    // Die Kategoriereihen stammen aus demselben Durchlauf und werden daher
    // gleich mit erneuert - der Main haelt den laufenden Aufruf zusammen.
    for (const reihe of categoryRails) {
      reihe.items = [];
      reihe.loaded = false;
      reihe.rail?.replaceChildren(emptyText("Vorschläge werden geladen …"));
    }
    renderCategoryRows();
  });
  document.querySelector("#heroSettings").addEventListener("click", openSettings);
  // Ueber den waagerechten Reihen scrollt das Mausrad seitwaerts. Am Ende der
  // Reihe wird das Ereignis durchgelassen, damit die Seite normal weiterscrollt.
  for (const rail of document.querySelectorAll(".favorite-rail, .home-provider-grid")) {
    rail.addEventListener("wheel", (event) => {
      if (event.shiftKey || event.deltaY === 0) return;
      if (rail.scrollWidth <= rail.clientWidth + 1) return;
      const vorher = rail.scrollLeft;
      rail.scrollLeft += event.deltaY;
      if (rail.scrollLeft !== vorher) event.preventDefault();
    }, { passive: false });
  }

  // Das Logo fuehrt von ueberall zurueck zur Startseite - auch per Tastatur.
  for (const logo of ["#brandHome", "#sidebarHome", "#homeMiniLogo"]) {
    const node = document.querySelector(logo);
    node?.addEventListener("click", showHome);
    node?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      showHome();
    });
  }
  document.querySelector("#heroWatch").addEventListener("click", openHeroTarget);
  heroDetails?.addEventListener("click", openHeroTarget);
  // Anhalten, solange die Maus auf dem Held liegt - sonst wechselt er einem
  // unter dem Zeiger weg.
  homeHero?.addEventListener("mouseenter", () => {
    heroPaused = true;
    window.clearInterval(heroTimer);
  });
  homeHero?.addEventListener("mouseleave", () => {
    heroPaused = false;
    startHeroRotation();
  });
  document.querySelector("#emptyAddProvider").addEventListener("click", openSettings);
  // Die Reihe zeigt Weiterschauen-Eintraege - der Knopf fuehrte bisher in die
  // Watchlist, also an einen anderen Ort als die Karten darunter.
  document.querySelector("#showAllFavorites").addEventListener("click", showContinue);
  document.querySelector("#showAllWatchpartyContinue")?.addEventListener("click", showContinue);
  document.querySelector("#showAllYoutubeContinue")?.addEventListener("click", showContinue);
  document.querySelector("#dismissNewEpisodes")?.addEventListener("click", dismissNewEpisodes);
  historySearch?.addEventListener("input", () => {
    historyFilter.suche = historySearch.value;
    renderLibraryViews();
  });
  for (const knopf of historyRangeFilter?.querySelectorAll("[data-range]") || []) {
    knopf.addEventListener("click", () => {
      historyFilter.zeitraum = knopf.dataset.range || "all";
      renderLibraryViews();
    });
  }
  document.querySelector("#favoritesOpenProvider").addEventListener("click", openActiveProvider);
  document.querySelector("#calendarReload")?.addEventListener("click", () => ladeKalender(true));
  historyClear?.addEventListener("click", clearHistory);
  document.querySelectorAll("[data-home-action]").forEach((button) => {
    button.addEventListener("click", () => handleHomeAction(button.dataset.homeAction));
  });
  sidebarToggle?.addEventListener("click", toggleSidebar);
  homeSidebarToggle?.addEventListener("click", toggleSidebar);
  homeQuickSearch?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const value = homeQuickSearch.value.trim();
      if (value) {
        omnibox.value = value;
        showGlobalSearch(value);
      } else {
        openSearchView();
      }
    }
  });

  document.querySelector("#backButton").addEventListener("click", () => api.browserCommand("back"));
  document.querySelector("#forwardButton").addEventListener("click", () => api.browserCommand("forward"));
  document.querySelector("#reloadButton").addEventListener("click", () => {
    markiereNeuladen("#reloadButton");
    api.browserCommand("reload");
  });
  document.querySelector("#reloadAllButton").addEventListener("click", async () => {
    markiereNeuladen("#reloadAllButton", 1200);
    const anzahl = providers.filter((provider) => provider.enabled !== false).length;
    const state = await api.browserCommand("reloadAll");
    showToast(anzahl === 1 ? "Anbieter neu geladen" : anzahl + " Anbieter neu geladen");
    activeProviderId = state?.activeProviderId || null;
    currentUrl = state?.url || "";
    await api.showHome();
    activeProviderId = null;
    currentUrl = "";
    hideContentViews();
    homeView.classList.remove("is-hidden");
    renderFavoriteToggle();
    renderHome();
    renderProviders();
    window.setTimeout(syncBrowserBounds, 0);
    showToast("Alles neu geladen");
  });
  document.querySelector("#stopButton").addEventListener("click", () => api.browserCommand("stop"));
  document.querySelector("#homeButton").addEventListener("click", () => api.browserCommand("home"));
  document.querySelector("#favoriteButton").addEventListener("click", toggleFavorite);
  document.querySelector("#fullscreenButton").addEventListener("click", () => api.browserCommand("fullscreen"));
  document.querySelector("#fullscreenExitButton")?.addEventListener("click", () => api.browserCommand("leaveFullscreen"));

  omnibox.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      navigateFromOmnibox();
    }
  });

  document.querySelector("#closeSettingsButton").addEventListener("click", closeSettings);
  settingsModal.addEventListener("click", (event) => {
    if (event.target === settingsModal) closeSettings();
  });
  settingsModal.addEventListener("close", () => {
    // Zurueck dorthin, wo man die Einstellungen geoeffnet hat - wer aus der
    // Watchparty kommt, landet wieder dort. Nur eine gemerkte Ansicht zaehlt;
    // sonst geht es zur Startseite, damit man nicht auf einer halb sichtbaren
    // Zwischenansicht herauskommt.
    const zurueck = routeBeforeSettings;
    routeBeforeSettings = null;
    api.setSettingsOpen(false).then(() => {
      zeigeAnsicht(zurueck);
    });
  });
  document.querySelector("#newProviderButton").addEventListener("click", clearProviderForm);
  document.querySelector("#providerAddButton")?.addEventListener("click", () => { anbieterHinzufuegen().catch(() => {}); });
  // Der Jahresrueckblick: blaettern per Klick, Pfeiltasten und Punkten.
  document.querySelector("#trailerClose")?.addEventListener("click", trailerSchliessen);
  // Escape schliesst den Dialog von selbst - der Rahmen muss trotzdem raus,
  // sonst laeuft der Ton weiter.
  trailerModal?.addEventListener("close", () => trailerRahmen?.replaceChildren());
  // Ein Klick neben den Kasten schliesst ihn ebenfalls: bei einem Video ist das
  // die Bewegung, die jeder kennt.
  trailerModal?.addEventListener("click", (ereignis) => {
    if (ereignis.target === trailerModal) trailerSchliessen();
  });
  document.querySelector("#wrappedClose")?.addEventListener("click", wrappedSchliessen);
  document.querySelector("#wrappedTonKnopf")?.addEventListener("click", (event) => {
    // Sonst blaettert der Klick zugleich eine Karte weiter - die Buehne
    // horcht auf jeden Klick.
    event.stopPropagation();
    wrappedTonUmschalten().catch(() => {});
  });
  document.querySelector("#wrappedNext")?.addEventListener("click", (event) => {
    event.stopPropagation();
    wrappedZeigen(wrappedStelle + 1);
  });
  document.querySelector("#wrappedPrev")?.addEventListener("click", (event) => {
    event.stopPropagation();
    wrappedZeigen(wrappedStelle - 1);
  });
  // Ein Klick auf die Flaeche blaettert weiter - wie man es von solchen
  // Geschichten kennt.
  document.querySelector("#wrappedStage")?.addEventListener("click", () => {
    if (wrappedStelle >= wrappedSeiten.length - 1) return;
    wrappedZeigen(wrappedStelle + 1);
  });
  wrappedModal?.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === " ") { event.preventDefault(); wrappedZeigen(wrappedStelle + 1); }
    if (event.key === "ArrowLeft") { event.preventDefault(); wrappedZeigen(wrappedStelle - 1); }
  });
  // Escape schliesst den Dialog von selbst - die Anbieteransicht muss trotzdem
  // zurueckkommen, und die Musik muss aufhoeren. Sie hing bisher allein am
  // Schliessknopf: wer den Rueckblick mit Escape verliess, hoerte sein Opening
  // weiter, ohne noch einen Knopf zu haben, der es abstellt.
  wrappedModal?.addEventListener("close", () => {
    wrappedTonBeenden();
    api.setWrappedOpen?.(false);
  });

  document.querySelector("#deleteProviderButton").addEventListener("click", deleteSelectedProvider);
  document.querySelector("#relocateProviderButton")?.addEventListener("click", relocateSelectedProvider);
  document.querySelector("#moveUpButton").addEventListener("click", () => moveSelectedProvider(-1));
  document.querySelector("#moveDownButton").addEventListener("click", () => moveSelectedProvider(1));
  providerForm.addEventListener("submit", saveProviderForm);

  document.querySelector("#updateFiltersButton").addEventListener("click", updateFilters);
  document.querySelector("#clearCacheButton").addEventListener("click", () => api.clearCache());
  document.querySelector("#openDataFolderButton").addEventListener("click", () => api.openDataFolder());
  document.querySelector("#exportBackupButton").addEventListener("click", sicherungErstellen);
  document.querySelector("#importBackupButton").addEventListener("click", sicherungEinlesen);
  document.querySelector("#resetSettingsButton").addEventListener("click", resetAllSettings);
  document.querySelector("#resetDataButton").addEventListener("click", resetData);
  updateCheckButton.addEventListener("click", checkForUpdates);
  settingsSearch.addEventListener("input", renderSettingsSearch);
  window.addEventListener("keydown", (event) => {
    if (event.key === "/" && settingsModal.open && document.activeElement !== settingsSearch) {
      event.preventDefault();
      settingsSearch.focus();
    }
  });
  for (const card of document.querySelectorAll("[data-jump-tab]")) {
    card.addEventListener("click", () => activateTab(card.dataset.jumpTab));
  }
  for (const button of document.querySelectorAll("[data-reset-section]")) {
    button.addEventListener("click", () => resetSettingsSection(button.dataset.resetSection));
  }

  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  }

  adblockEnabled.addEventListener("change", saveSettings);
  trackingEnabled.addEventListener("change", saveSettings);
  popupBlockingEnabled.addEventListener("change", saveSettings);
  redirectBlockingEnabled.addEventListener("change", saveSettings);
  whitelistInput.addEventListener("change", saveSettings);
  for (const control of [
    cacheMode,
    settingsMode,
    designPreset,
    autoDeriveColors,
    autoDeriveColorsInline,
    autoCollapseSidebar,
    showProviderStripNav,
    themeMode,
    compactHeader,
    accentPreset,
    accentColor,
    accentHex,
    accentStrength,
    uiDensity,
    cardSize,
    favoriteSize,
    favoriteSizeMirror,
    favoriteLayout,
    favoriteLayoutMirror,
    favoriteTextSize,
    favoriteTextSizeMirror,
    favoriteArtwork,
    favoriteArtworkMirror,
    cornerStyle,
    backgroundStyle,
    backgroundColor,
    fontScale,
    animationMode,
    cardStyle,
    shadowStyle,
    showProviderStrip,
    showHeroHome,
    showHomeYoutube,
    showHomeFavorites,
    showHomePersonal,
    showHomeCategories,
    watchpartyEnabled,
    watchpartyServer,
    watchpartyRoom,
    watchpartyName,
    providerCardMeta,
    showFavoriteMeta,
    showFavoriteMetaMirror,
    animationsEnabled
  ]) {
    if (!control) continue;
    control.addEventListener("change", saveSettings);
    if (control.type === "range") {
      control.addEventListener("input", () => {
        syncRangeLabels();
        saveSettings();
      });
    }
  }
  for (const button of document.querySelectorAll("[data-settings-mode-choice]")) {
    button.addEventListener("click", () => {
      settingsMode.value = button.dataset.settingsModeChoice;
      saveSettings();
    });
  }
  for (const button of document.querySelectorAll("[data-theme-choice]")) {
    button.addEventListener("click", () => {
      const choice = button.dataset.themeChoice;
      themeMode.value = choice === "custom" ? "dark" : choice;
      if (choice === "custom") {
        accentPreset.value = "custom";
        if (autoDeriveColors) autoDeriveColors.checked = false;
        if (autoDeriveColorsInline) autoDeriveColorsInline.checked = false;
      } else {
        // Die gesamte Palette wird aus der Hintergrundfarbe abgeleitet. Ohne
        // diesen Schritt aendert die Theme-Wahl nur eine CSS-Klasse und die
        // App bleibt sichtbar gleich.
        applyThemeBackground(themeMode.value);
      }
      saveSettings();
    });
  }
  for (const button of document.querySelectorAll("[data-accent-choice]")) {
    button.addEventListener("click", () => {
      accentPreset.value = button.dataset.accentChoice;
      const nextColor = accentFromPreset(accentPreset.value);
      accentColor.value = nextColor;
      accentHex.value = nextColor;
      saveSettings();
    });
  }
  for (const button of document.querySelectorAll("[data-layout-choice]")) {
    button.addEventListener("click", () => applyLayoutChoice(button.dataset.layoutChoice));
  }
  for (const button of document.querySelectorAll("[data-nav-choice]")) {
    button.addEventListener("click", () => {
      // Nur die Position setzen: frueher hat diese Wahl zusaetzlich die schmale
      // Kopfzeile und die Anbieter-Leiste umgeschaltet, was man nicht erwartet.
      settings.appearance = { ...DEFAULT_APPEARANCE_SETTINGS, ...(settings.appearance || {}), navStyle: button.dataset.navChoice };
      saveSettings();
    });
  }
  for (const button of document.querySelectorAll("[data-density-choice]")) {
    button.addEventListener("click", () => {
      const choice = button.dataset.densityChoice;
      // Eine der drei Dichten zu waehlen heisst: nicht mehr von Hand gesetzt.
      // Die Layout-Voreinstellung bleibt dabei unberuehrt - sie ist eine
      // andere Frage und wird eine Ueberschrift weiter oben gestellt.
      if (choice !== "custom") setRangeChoice("uiDensity", choice);
      settings.appearance = {
        ...DEFAULT_APPEARANCE_SETTINGS,
        ...(settings.appearance || {}),
        densityMode: choice === "custom" ? "custom" : "preset"
      };
      saveSettings();
    });
  }
  designPresetInline?.addEventListener("change", async () => {
    if (designPreset) designPreset.value = designPresetInline.value;
    await applyDesignPreset(designPresetInline.value);
  });
  cardScaleInline?.addEventListener("input", () => {
    if (appearanceControlMap.uiScale) appearanceControlMap.uiScale.value = cardScaleInline.value;
    syncInlineLabels();
    saveSettings();
  });
  cardGapInline?.addEventListener("input", () => {
    if (appearanceControlMap.cardGap) appearanceControlMap.cardGap.value = cardGapInline.value;
    syncInlineLabels();
    saveSettings();
  });
  for (const control of appearanceControls) {
    control.addEventListener("input", () => {
      if (control.id === "appBackgroundColor" && backgroundColor) backgroundColor.value = normalizeColor(control.value, "#070a10");
      if (control.id !== "appBackgroundColor") markDesignCustom();
      syncAdvancedAppearanceLabels();
      saveSettings();
    });
    control.addEventListener("change", () => {
      if (control.id !== "appBackgroundColor") markDesignCustom();
      saveSettings();
    });
  }
  designPreset?.addEventListener("change", async () => {
    await applyDesignPreset(designPreset.value);
  });
  autoDeriveColors?.addEventListener("change", () => {
    if (autoDeriveColors.checked) deriveAdvancedColors();
    syncAutoColorLock();
    saveSettings();
  });
  disableAutoColorsButton?.addEventListener("click", () => {
    if (autoDeriveColors) autoDeriveColors.checked = false;
    if (autoDeriveColorsInline) autoDeriveColorsInline.checked = false;
    syncAutoColorLock();
    saveSettings();
    showToast("Automatik aus - die Einzelfarben wirken jetzt");
  });
  exportAppearanceButton?.addEventListener("click", exportAppearanceSettings);
  importAppearanceInput?.addEventListener("change", importAppearanceSettings);
  sidebarExportAppearanceButton?.addEventListener("click", exportAppearanceSettings);
  sidebarImportAppearanceInput?.addEventListener("change", importAppearanceSettings);
  sidebarResetSettingsButton?.addEventListener("click", resetAllSettings);
  // Ohne den Wechsel auf "custom" nutzt applyAppearance weiter die Preset-Farbe -
  // die selbst gewaehlte Farbe waere wirkungslos.
  accentHex.addEventListener("input", () => {
    const color = normalizeColor(accentHex.value, "");
    if (color) {
      accentColor.value = color;
      accentPreset.value = "custom";
    }
    saveSettings();
  });
  accentColor.addEventListener("input", () => {
    accentHex.value = normalizeColor(accentColor.value);
    accentPreset.value = "custom";
    saveSettings();
  });
  backgroundColor.addEventListener("input", () => {
    if (appearanceControlMap.appBackgroundColor) appearanceControlMap.appBackgroundColor.value = normalizeColor(backgroundColor.value, "#070a10");
    saveSettings();
  });
  fontScale.addEventListener("input", () => {
    syncRangeLabels();
    saveSettings();
  });
  pauseOnProviderSwitch.addEventListener("change", saveSettings);
  youtubeInMediathek?.addEventListener("change", saveSettings);
  autoplayNextEpisode?.addEventListener("change", saveSettings);
  introSkip?.addEventListener("change", saveSettings);
  for (const feld of Object.values(sponsorblockFelder)) {
    feld?.addEventListener("change", saveSettings);
  }
  markenVergessen?.addEventListener("click", markenVergessenLassen);
  rememberLanguage?.addEventListener("change", saveSettings);
  fassungenVergessen?.addEventListener("click", fassungenVergessenLassen);
  showReviewLink?.addEventListener("change", saveSettings);
  wrappedMusik?.addEventListener("change", saveSettings);
  notifyNewEpisodes?.addEventListener("change", saveSettings);
  favoriteProgressMode.addEventListener("change", saveSettings);
  pauseOnMinimize.addEventListener("change", saveSettings);
  pauseOnBlur.addEventListener("change", saveSettings);

  api.onBrowserState((state) => {
    zeigeLadezustand(Boolean(state.loading));
    activeProviderId = state.activeProviderId;
    currentUrl = state.url || "";
    if (Array.isArray(state.favorites)) {
      favorites = state.favorites;
      // Nur zeichnen, wenn die Seiten danach anders aussaehen.
      //
      // Der Hauptprozess schickt seinen Stand im Fuenfsekundentakt, und bis
      // hierher war jede Sendung ein kompletter Neuaufbau von Startseite,
      // Watchlist und Mediathek. Gemessen am 2026-08-28 in der laufenden App,
      // 45 Sekunden im Leerlauf, ohne dass irgendetwas geschah:
      // 253 ersetzte Teilbaeume, jede Reihe der Startseite elfmal.
      //
      // Teuer war das kaum - keine einzige lange Aufgabe. Sichtbar aber schon:
      // jedes Bild bekam ein neues <img>, jeder Uebergang fing von vorn an,
      // und ein aufgeklapptes Kachelmenue haette keinen Anker mehr gehabt.
      // Eine Oberflaeche, die sich alle fuenf Sekunden selbst ersetzt, kann
      // nicht ruhig wirken, egal wie schnell sie das tut.
      const bild = bestandsbild(favorites);
      if (bild !== letztesBestandsbild) {
        letztesBestandsbild = bild;
        renderFavorites();
        renderHome();
        renderLibraryViews();
      }
    }
    renderProviders();
    renderFavoriteToggle();
  });

  api.onBlocked((items) => {
    blockedRequests = items;
    renderBlocked();
  });

  api.onFullscreen((enabled) => {
    document.querySelector(".app-shell").classList.toggle("is-content-fullscreen", enabled);
    document.body.classList.toggle("is-content-fullscreen", enabled);
    window.setTimeout(syncBrowserBounds, 0);
  });

  // "Mehr anzeigen" an den drei Reihen.
  document.querySelectorAll("[data-discovery]").forEach((knopf) => {
    knopf.addEventListener("click", () => showDiscovery(knopf.dataset.discovery));
  });
  document.querySelector("#discoveryBack")?.addEventListener("click", () => {
    entdeckungMerkeScroll();
    showHome();
  });
  // Scrollposition laufend mitschreiben - wer einen Titel oeffnet, verlaesst
  // die Seite ohne Umweg ueber den Zurueck-Knopf.
  entdeckungsFlaeche()?.addEventListener("scroll", () => {
    if (discoveryView?.classList.contains("is-hidden")) return;
    entdeckungMerkeScroll();
  }, { passive: true });

  // Der Autoplay-Schalter sitzt in der Anbieterseite und stellt dieselbe
  // Einstellung wie die Seitenleiste. Ohne diese Meldung stuende hier weiter
  // der alte Stand - und das naechste Speichern von hier haette ihn still
  // wieder zurueckgedreht.
  api.onSettingsChanged((neu) => {
    if (!neu) return;
    settings = neu;
    if (autoplayNextEpisode) {
      autoplayNextEpisode.checked = settings.playback?.autoplayNextEpisode !== false;
    }
  });

  api.onToast((message) => {
    showToast(message);
  });

  api.onAutostartDone(() => {
    switchToPlayerView();
  });

  api.onUpdateState((state) => {
    updateState = state || {};
    renderUpdateInfo();
  });

  // Klick auf die Benachrichtigung ueber eine neue Folge. Der Titel steht nach
  // dem Fund wieder auf der Watchlist - dorthin also, und die Karte kurz
  // hervorheben, damit man sie zwischen den anderen findet.
  api.onZeigeFavorit?.(async (id) => {
    await showFavorites();
    const karte = [...document.querySelectorAll("#favoritesGrid .favorite-card")]
      .find((k) => k.dataset.favoriteId === String(id || ""));
    if (!karte) return;
    karte.scrollIntoView({ block: "center", behavior: "smooth" });
    karte.classList.add("ist-hervorgehoben");
    window.setTimeout(() => karte.classList.remove("ist-hervorgehoben"), 2600);
  });

  // Der Hauptprozess hat externe Metadaten nachgeholt und damit bessere
  // Grundlagen fuer die Empfehlungen. Die Reihe wird einmal kontrolliert
  // nachgezogen - nicht neu aufgebaut: was schon dasteht, bleibt sichtbar,
  // bis die neue Liste da ist.
  api.onPersonalUpdated?.(() => {
    if (personalPending) return;
    personalLoaded = false;
    loadPersonalPicks();
  });
}

function render() {
  renderProviders();
  renderHome();
  renderFavorites();
  renderLibraryViews();
  renderSettings();
  renderUpdateInfo();
  renderFavoriteToggle();
}

function showStartupError(error) {
  document.body.classList.add("startup-error");
  const message = error?.stack || error?.message || String(error || "Unbekannter Fehler");
  document.body.innerHTML = `
    <main class="startup-error-panel">
      <strong>ELFIX konnte die Oberfläche nicht starten.</strong>
      <span>${escapeHtml(message)}</span>
      <button type="button" onclick="location.reload()">Neu laden</button>
    </main>
  `;
}

/** Wie die Anbieterleiste zuletzt aussah - siehe {@link renderProviders}. */
let letztesAnbieterbild = "";

function renderProviders() {
  const enabled = providers.filter((provider) => provider.enabled !== false);
  // Dieselbe Vorsicht wie beim Bestand: der Hauptprozess meldet seinen Stand
  // im Fuenfsekundentakt, und die Anbieterliste aendert sich dabei so gut wie
  // nie. Sie trotzdem jedes Mal neu zu bauen hiess, alle paar Sekunden jedes
  // Anbieterlogo durch ein frisches Element zu ersetzen.
  //
  // Welcher Anbieter gerade offen ist, gehoert mit ins Bild: providerCard
  // backt die Klasse "is-active" beim Bauen ein, und renderRouteActiveState
  // unten fasst nur die Seitenleiste an. Ohne ihn bliebe die Hervorhebung in
  // der Leiste beim vorigen Anbieter stehen.
  const bild = [activeProviderId, ...enabled
    .map((provider) => [provider.id, provider.name, provider.logo, provider.startUrl].join("#"))]
    .join("\n");
  if (bild !== letztesAnbieterbild) {
    letztesAnbieterbild = bild;
    providerRail.replaceChildren(...enabled.map((provider) => providerCard(provider, false)));
    if (!enabled.length) {
      providerRail.append(emptyText("Keine Anbieter. Settings öffnen."));
    }
    renderSidebarProviders(enabled);
  }
  renderRouteActiveState();
}

function renderSidebarProviders(enabled = providers.filter((provider) => provider.enabled !== false)) {
  if (!homeSidebarProviders) return;
  homeSidebarProviders.replaceChildren(...enabled.map((provider) => sidebarProviderButton(provider)));
}

function renderHome() {
  if (!homeView || !homeHero || !homeFavorites) return;
  const enabled = providers.filter((provider) => provider.enabled !== false);
  const hasProviders = enabled.length > 0;
  const homeSettings = settings.home || DEFAULT_HOME_SETTINGS;
  const heroVisible = hasProviders && homeSettings.showHero !== false;
  noProvidersState?.classList.toggle("is-hidden", hasProviders);
  homeHero.classList.toggle("is-hidden", !heroVisible);

  const continueItems = sortedHomeFavorites();
  const heroProvider = enabled.find((provider) => provider.id === activeProviderId) || enabled[0] || null;
  heroItems = continueItems.slice(0, HERO_ROTATION_COUNT);
  if (heroIndex >= heroItems.length) heroIndex = 0;
  renderHomeHero(heroItems[heroIndex] || null, heroProvider, hasProviders);
  renderHeroDots();
  startHeroRotation();

  renderSidebarProviders(enabled);

  // Der Jahresrueckblick meldet sich hier - dezent und nur im Dezember, nicht
  // als Fenster, das sich vor die App stellt.
  //
  // Einmal fragen, zweimal benutzen. Beide Stellen wollen dieselbe Auskunft,
  // und beide holten sie sich einzeln - im Dezember waren das zwei
  // vollstaendige Auswertungen ueber alle Sitzungen je Aufbau der Startseite,
  // und die Startseite baut sich bei jedem Anbieterwechsel, jeder Aenderung am
  // Bestand und jedem Zuruecknavigieren neu. Ausserhalb der Saison kostet der
  // Aufruf ohnehin nichts: dann faellt die Antwort am Datum, ohne dass etwas
  // gerechnet wird.
  wrappedLageZeigen().catch(() => {});

  renderNewEpisodes();

  // Getrennt: was nur fuer dich zaehlt und was in einer Watchparty laeuft.
  // Dieselben Moeglichkeiten wie im Weiterschauen-Tab: eine Kachel, die hier
  // steht, muss man auch hier wieder loswerden koennen.
  const kartenOptionen = {
    showProgress: true,
    autoplay: true,
    fullscreen: true,
    allowImage: true,
    allowContinueRemove: true,
    allowWatchlistAdd: true
  };
  // YouTube bekommt eine eigene Reihe. Ein angefangenes Video und eine
  // angefangene Serie sind zwei verschiedene Dinge: bei der Serie geht es
  // darum, sie zu Ende zu bringen, bei YouTube schaut man nebenbei. Gemischt
  // schiebt das eine das andere aus der Reihe, und weil YouTube-Videos oft
  // kommen und gehen, waeren es meist die Serien, die verdraengt werden.
  const youtubeItems = continueItems.filter((favorite) => istYoutubeEintrag(favorite)).slice(0, 8);
  const privateItems = continueItems
    .filter((favorite) => !favorite.watchpartyRoom && !istYoutubeEintrag(favorite))
    .slice(0, 8);
  const partyItems = continueItems.filter((favorite) => favorite.watchpartyRoom).slice(0, 8);

  // Was niemand sieht, wird auch nicht gebaut.
  //
  // Die drei Reihen wurden bisher immer gefuellt und danach gegebenenfalls
  // ausgeblendet. Wer "Weiterschauen" oder die YouTube-Reihe in den
  // Einstellungen abgeschaltet hat, liess damit bei jedem Aufbau der
  // Startseite bis zu vierundzwanzig Kacheln bauen, die er nie zu Gesicht
  // bekommt - und jede davon ist ein innerHTML, also ein HTML-Parser-Lauf,
  // plus eine Bildebene.
  //
  // Nebenbei standen sie auch weiterhin im Dokument: unsichtbar, aber mit
  // ihren Bildern und Zuhoerern. Eine leere Reihe ist nicht nur billiger zu
  // bauen, sie haelt auch nichts fest.
  const reiheFuellen = (reihe, kasten, eintraege, sichtbar) => {
    reihe?.classList.toggle("is-hidden", !sichtbar);
    if (!kasten) return;
    kasten.replaceChildren(...(sichtbar
      ? eintraege.map((favorite) => favoriteCard(favorite, false, kartenOptionen))
      : []));
  };

  reiheFuellen(favoritesHomeRow, homeFavorites, privateItems,
    privateItems.length > 0 && homeSettings.showFavorites !== false);
  reiheFuellen(watchpartyHomeRow, homeWatchpartyContinue, partyItems,
    partyItems.length > 0 && homeSettings.showFavorites !== false);
  reiheFuellen(youtubeHomeRow, homeYoutubeContinue, youtubeItems,
    youtubeItems.length > 0 && homeSettings.showYoutube !== false);

  renderRecommendations();
  invalidatePicksIfWatchChanged();
  renderPersonalPicks(homeSettings);
  renderCategoryRows(homeSettings);
  if (homeSidebarVersion) {
    homeSidebarVersion.textContent = appInfo.version ? `ELFIX ${appInfo.version}` : "ELFIX";
  }
}

// Der Held auf der Startseite wechselt selbsttaetig durch die zuletzt
// geschauten Titel. Beim Ueberfahren mit der Maus haelt er an, damit man in
// Ruhe klicken kann.
// Empfehlungen kommen von den Startseiten der Anbieter - gemischt, damit von
// jeder Seite etwas dabei ist. Der Main-Prozess haelt sie eine halbe Stunde
// vor, deshalb kostet ein erneutes Rendern nichts.
function renderRecommendations() {
  if (!homeRecommendations) return;
  const vorhanden = recommendations.length > 0;
  recommendedHomeRow?.classList.toggle("is-hidden", !vorhanden && recommendationsLoaded);
  if (vorhanden) {
    homeRecommendations.replaceChildren(...recommendations.map(discoverCard));
  } else if (!recommendationsLoaded) {
    homeRecommendations.replaceChildren(emptyText("Vorschläge werden geladen …"));
  }
  if (!recommendationsLoaded) loadRecommendations();
}

async function loadRecommendations(refresh = false) {
  if (recommendationsPending) return;
  recommendationsPending = true;
  try {
    const items = await api.getRecommendations({ perProvider: 6, refresh });
    recommendations = Array.isArray(items) ? items : [];
  } catch {
    recommendations = [];
  }
  recommendationsLoaded = true;
  recommendationsPending = false;
  recommendationsAt = Date.now();
  renderRecommendations();
}

// Die Neuheiten der Anbieter aendern sich ueber den Tag. Ist die Startseite
// sichtbar, werden sie deshalb regelmaessig frisch geholt; im Hintergrund
// laufende Abfragen waeren nur Last ohne Nutzen.
function startDiscoverRefresh() {
  if (discoverRefreshTimer) return;
  discoverRefreshTimer = window.setInterval(() => {
    if (currentRoute !== "start" || homeView?.classList.contains("is-hidden")) return;
    if (Date.now() - recommendationsAt < DISCOVER_REFRESH_MS) return;
    loadRecommendations(true);
  }, 60000);
}

// "Empfohlen fuer dich" wird im Main-Prozess aus dem Verlauf berechnet: Genres
// der geschauten Titel als Profil, dazu passende Titel von den Anbietern. Das
// kostet beim ersten Mal ein paar Sekunden, danach liegt alles im Cache.
// Neu berechnet wird nur, wenn tatsaechlich etwas anderes geschaut wurde -
// nicht bei jedem Fortschritts-Tick.
// Absichtlich ohne Zeitstempel: waehrend des Schauens wandert lastWatchedAt
// im Sekundentakt weiter. Neu gerechnet wird erst, wenn ein anderer Titel im
// Verlauf auftaucht.
function watchSignature() {
  return favorites
    .filter((favorite) => favorite.watched || favorite.favorite)
    .map((favorite) => favorite.id)
    .sort()
    .join("|");
}

// Aendert sich der Verlauf, sind alle Vorschlagsreihen veraltet - sie stammen
// aus demselben Durchlauf.
function invalidatePicksIfWatchChanged() {
  const signatur = watchSignature();
  if (signatur === personalSignature) return;
  personalSignature = signatur;
  personalLoaded = false;
  for (const reihe of categoryRails) reihe.loaded = false;
}

function renderCategoryRows(homeSettings = settings.home || DEFAULT_HOME_SETTINGS) {
  const erlaubt = homeSettings.showCategories !== false;
  for (const reihe of categoryRails) {
    if (!reihe.rail) continue;
    const vorhanden = reihe.items.length > 0;
    reihe.row?.classList.toggle("is-hidden", !erlaubt || (!vorhanden && reihe.loaded));
    if (!erlaubt) continue;
    if (vorhanden) {
      reihe.rail.replaceChildren(...reihe.items.map(discoverCard));
    } else if (!reihe.loaded) {
      reihe.rail.replaceChildren(emptyText("Vorschläge werden geladen …"));
    }
    if (!reihe.loaded) loadCategoryRow(reihe);
  }
}

async function loadCategoryRow(reihe, refresh = false) {
  if (reihe.pending) return;
  reihe.pending = true;
  try {
    const homeSettings = settings.home || DEFAULT_HOME_SETTINGS;
    const items = await api.getPersonalRecommendations({
      limit: 20,
      type: reihe.type,
      refresh,
      // Nur was in "Empfohlen fuer dich" wirklich zu sehen ist, wird hier
      // ausgelassen.
      excludeMain: homeSettings.showPersonal !== false
    });
    reihe.items = Array.isArray(items) ? items : [];
  } catch {
    reihe.items = [];
  }
  reihe.loaded = true;
  reihe.pending = false;
  renderCategoryRows();
}

function renderPersonalPicks(homeSettings = settings.home || DEFAULT_HOME_SETTINGS) {
  if (!homePersonal) return;
  const erlaubt = homeSettings.showPersonal !== false;
  const vorhanden = personalPicks.length > 0;
  personalHomeRow?.classList.toggle("is-hidden", !erlaubt || (!vorhanden && personalLoaded));
  if (!erlaubt) return;
  if (vorhanden) {
    homePersonal.replaceChildren(...personalPicks.map(discoverCard));
  } else if (!personalLoaded) {
    homePersonal.replaceChildren(emptyText("Empfehlungen werden berechnet …"));
  }
  if (!personalLoaded) loadPersonalPicks();
}

async function loadPersonalPicks(refresh = false) {
  if (personalPending) return;
  personalPending = true;
  try {
    const items = await api.getPersonalRecommendations({ limit: 24, refresh });
    personalPicks = Array.isArray(items) ? items : [];
  } catch {
    personalPicks = [];
  }
  personalLoaded = true;
  personalPending = false;
  renderPersonalPicks();
}

// Der Verbindungszustand der Watchparty kommt vom Hauptprozess, sobald sich
// etwas aendert - Verbinden, Abbrechen, neue Teilnehmer.
function renderWatchpartyStatus(state) {
  watchpartyState = state;
  renderWatchpartyViewStatus(state);
  // Die Punkte an den Raumchips haengen am Verbindungszustand.
  renderWatchpartyRaeume();
  if (!watchpartyStatus) return;
  if (!state?.enabled) {
    watchpartyStatus.textContent = "Ausgeschaltet.";
    return;
  }
  const raeume = state.rooms || [];
  if (!raeume.length) {
    watchpartyStatus.textContent = "Kein Raum eingetragen.";
    return;
  }
  // Bei mehreren Raeumen zaehlt jeder fuer sich - einer kann stehen, waehrend
  // ein anderer noch verbindet.
  watchpartyStatus.textContent = raeume.map((raum) => {
    if (!raum.connected) return `„${raum.room}“: ${raum.error ? raum.error : "verbinde …"}`;
    const andere = Math.max(0, (raum.peers?.length || 1) - 1);
    const geraete = andere === 0
      ? "noch niemand sonst"
      : `${andere} weiteres Gerät${andere === 1 ? "" : "e"}`;
    return `„${raum.room}“: verbunden, ${geraete}`;
  }).join(" · ");
}

// Was ELFIX bisher an Intros gelernt hat. Ohne diese Zeile waere "Vergessen"
// ein Knopf ins Ungewisse.
async function renderMarkenStand() {
  if (!markenStand) return;
  const stand = await api.getMarkenStand?.().catch(() => null);
  if (!stand || !stand.serien) {
    markenStand.textContent = "Noch nichts gelernt.";
    if (markenVergessen) markenVergessen.disabled = true;
    return;
  }
  const serien = stand.serien === 1 ? "1 Serie" : `${stand.serien} Serien`;
  markenStand.textContent = stand.marken
    ? `${serien} beobachtet, für ${stand.marken} davon steht der Knopf bereit.`
    : `${serien} beobachtet — noch keine Stelle hat sich wiederholt.`;
  if (markenVergessen) markenVergessen.disabled = false;
}

// Dasselbe fuer die Fassungen. Ohne diese Zeile waere nicht zu sehen, ob ELFIX
// ueberhaupt etwas gemerkt hat - und eine Vorwahl, die man nicht kennt, ist
// eine Seite, die sich unerklaerlich anders verhaelt.
async function renderFassungenStand() {
  if (!fassungenStand) return;
  const stand = await api.getFassungenStand?.().catch(() => null);
  if (!stand || !stand.serien) {
    fassungenStand.textContent = "Noch nichts gemerkt.";
    if (fassungenVergessen) fassungenVergessen.disabled = true;
    return;
  }
  const serien = stand.serien === 1 ? "1 Serie" : `${stand.serien} Serien`;
  const namen = (stand.fassungen || []).map((eintrag) => `${eintrag.name} (${eintrag.anzahl})`).join(", ");
  fassungenStand.textContent = namen ? `${serien}: ${namen}` : serien;
  if (fassungenVergessen) fassungenVergessen.disabled = false;
}

async function fassungenVergessenLassen() {
  if (!confirm("Alle gemerkten Fassungen vergessen?")) return;
  await api.forgetFassungen?.();
  renderFassungenStand();
  showToast("Gemerkte Fassungen vergessen");
}

async function markenVergessenLassen() {
  if (!confirm("Alle gelernten Intro-Stellen vergessen?")) return;
  await api.forgetMarken?.();
  renderMarkenStand();
  api.getFernStatus?.().then(renderFernStatus).catch(() => {});
  showToast("Gelernte Intros vergessen");
}

// Die Statusseite des Relays. Sie beantwortet die Frage, die "Nicht verbunden"
// offen laesst: liegt es am Relay oder an dieser Seite? Geoeffnet wird sie im
// richtigen Browser - die Adresse bildet der Hauptprozess aus den
// Einstellungen, von hier geht keine mit.
async function relayStatusseiteOeffnen() {
  const ergebnis = await api.openRelayStatus?.();
  if (ergebnis?.ok) {
    showToast("Statusseite des Relays im Browser geöffnet");
    return;
  }
  showToast(ergebnis?.grund === "keine-adresse"
    ? "Erst die Server-Adresse eintragen — dann gibt es auch eine Statusseite"
    : "Browser konnte nicht geöffnet werden");
}

// --- Fernbedienung ------------------------------------------------------------

function renderFernStatus(status) {
  if (fernEnabled) fernEnabled.checked = status?.enabled === true;
  if (fernCode) fernCode.textContent = status?.code ? status.code.split("").join(" ") : "– – – – – – – –";
  if (fernCodeCopy) fernCodeCopy.disabled = !status?.code;
  // Die Adresse steht bei der Watchparty; hier wird sie nur noch zu der Seite
  // ergaenzt, die das Relay ausliefert.
  if (fernAdresse) {
    const server = (watchpartyServer?.value || "").trim().replace(/\/+$/, "");
    const alsWeb = server.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
    fernAdresse.textContent = alsWeb ? `${alsWeb}/fern/` : "…/fern/ (erst die Server-Adresse bei der Watchparty eintragen)";
  }
  renderFernQr(status);
  // Die Lage drueben. Sie steht nur da, wenn etwas zu tun ist - eine Zeile
  // "alles in Ordnung" liest nach dem zweiten Mal niemand mehr.
  // Nur, wenn die Lage ueberhaupt mitkommt: die Meldungen aus dem Hauptprozess
  // tragen sie nicht, und ohne diese Pruefung verschwaende die Zeile bei jedem
  // Verbindungswechsel und kaeme erst beim naechsten Aufklappen wieder.
  if (fernRelayZeile && fernRelay && status && "relay" in status) {
    const hinweis = status.relay?.hinweis || "";
    fernRelayZeile.style.display = hinweis ? "" : "none";
    fernRelay.textContent = hinweis;
  }
  if (!fernStatus) return;
  if (!status?.enabled) {
    fernStatus.textContent = "Ausgeschaltet — kein Handy kann etwas auslösen.";
    return;
  }
  if (!status.connected) {
    fernStatus.textContent = status.error ? `Nicht verbunden: ${status.error}` : "Verbinde …";
    return;
  }
  fernStatus.textContent = "Verbunden — bereit für das Handy.";
}

// Der QR-Code kommt fertig als SVG aus dem Hauptprozess. Hier wird er nur
// eingesetzt - und wieder weggeraeumt, wenn es nichts zu koppeln gibt.
async function renderFernQr(status) {
  if (!fernQr) return;
  if (!status?.code) {
    fernQr.replaceChildren();
    if (fernQrHinweis) fernQrHinweis.textContent = "";
    return;
  }
  const antwort = await api.getFernQr?.().catch(() => null);
  if (!antwort?.svg) {
    fernQr.replaceChildren();
    if (fernQrHinweis) {
      fernQrHinweis.textContent = "Für den QR-Code fehlt die Server-Adresse — sie steht bei der Watchparty.";
    }
    return;
  }
  // Das SVG kommt aus dem eigenen Hauptprozess und nicht von einer Seite -
  // hier wird nichts Fremdes eingesetzt.
  fernQr.innerHTML = antwort.svg;
  if (fernQrHinweis) {
    fernQrHinweis.textContent = "Mit der Kamera scannen — dann öffnet sich die Fernbedienung und ist gleich verbunden.";
  }
}

async function fernUmschalten() {
  const status = fernEnabled?.checked
    ? await api.enableFern?.()
    : await api.disableFern?.();
  renderFernStatus(status);
}

async function fernNeuerCode() {
  if (!confirm("Neuen Code erzeugen? Bereits gekoppelte Handys müssen danach neu verbunden werden.")) return;
  const status = await api.newFernCode?.();
  renderFernStatus(status);
  showToast("Neuer Code — die alten Handys sind draußen");
}

async function fernCodeKopieren() {
  const code = (fernCode?.textContent || "").replace(/\s/g, "");
  if (!code || code.startsWith("–")) return;
  try {
    await navigator.clipboard.writeText(code);
    showToast("Code kopiert");
  } catch {
    // Ohne Zwischenablage bleibt das Feld - abtippen geht immer.
  }
}

// --- Meine Geraete ----------------------------------------------------------
//
// Der Schluessel steht im Feld, aber er wird nicht mit dem Formular
// gespeichert: erzeugen, uebernehmen und trennen sind eigene Aufrufe. Sonst
// haenge das Zusammenspiel zweier Geraete daran, ob jemand nach dem Eintippen
// noch irgendwo anders speichert.

function renderGeraeteStatus(status) {
  if (geraeteKey && document.activeElement !== geraeteKey) geraeteKey.value = status?.key || geraeteKey.value || "";
  if (geraeteDisconnect) geraeteDisconnect.disabled = !status?.hasKey;
  if (geraeteKeyCopy) geraeteKeyCopy.disabled = !geraeteKey?.value;
  if (geraeteSyncNow) geraeteSyncNow.disabled = !status?.connected;
  if (!geraeteStatus) return;
  if (!status?.hasKey) {
    geraeteStatus.textContent = "Kein Schlüssel — erzeuge einen und trage ihn auf dem zweiten Gerät ein.";
    return;
  }
  if (!status.enabled) {
    geraeteStatus.textContent = "Keine Server-Adresse — sie steht bei der Watchparty.";
    return;
  }
  if (!status.connected) {
    geraeteStatus.textContent = status.error ? `Nicht verbunden: ${status.error}` : "Verbinde …";
    return;
  }
  const stand = status.lastSync
    ? `zuletzt abgeglichen ${new Date(status.lastSync).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`
    : "noch nichts abzugleichen";
  const anzahl = Number.isFinite(Number(status.titel)) ? Number(status.titel) : status.entries;
  const titel = anzahl === 1 ? "1 Titel" : `${anzahl} Titel`;
  geraeteStatus.textContent = `Verbunden, ${titel}, ${stand}.`;
}

async function geraeteSchluesselErzeugen() {
  // Ein neuer Schluessel loest dieses Geraet vom alten. Wer schon zwei
  // zusammenhat, verliert damit die Verbindung zum anderen - das muss vorher
  // dastehen, nicht hinterher.
  if (geraeteKey?.value && !window.confirm("Neuen Schlüssel erzeugen? Dieses Gerät ist danach nicht mehr mit den bisherigen verbunden.")) return;
  const antwort = await api.createGeraeteSchluessel?.();
  if (!antwort) return;
  if (geraeteKey) geraeteKey.value = antwort.key || "";
  renderGeraeteStatus({ ...antwort.status, key: antwort.key });
  showToast("Schlüssel erzeugt — trage ihn auf deinem anderen Gerät ein.");
}

async function geraeteSchluesselUebernehmen() {
  const wert = geraeteKey ? geraeteKey.value.trim() : "";
  if (!wert) return;
  const antwort = await api.setGeraeteSchluessel?.(wert);
  if (!antwort?.ok) {
    showToast(antwort?.reason || "Schlüssel nicht erkannt");
    return;
  }
  if (geraeteKey) geraeteKey.value = antwort.key || "";
  renderGeraeteStatus({ ...antwort.status, key: antwort.key });
  showToast("Schlüssel übernommen — die Geräte gleichen sich ab.");
}

async function geraeteSchluesselKopieren() {
  const wert = geraeteKey ? geraeteKey.value.trim() : "";
  if (!wert) return;
  try {
    await navigator.clipboard.writeText(wert);
    showToast("Schlüssel kopiert");
  } catch {
    // Ohne Zwischenablage bleibt das Feld - abtippen geht immer.
    geraeteKey?.select?.();
  }
}

async function geraeteTrennen() {
  if (!window.confirm("Dieses Gerät trennen? Deine Einträge bleiben hier stehen, gleichen sich aber nicht mehr ab.")) return;
  const status = await api.disconnectGeraete?.();
  if (geraeteKey) geraeteKey.value = "";
  renderGeraeteStatus(status);
  showToast("Getrennt");
}

async function geraeteJetztAbgleichen() {
  const status = await api.syncGeraeteNow?.();
  renderGeraeteStatus(status);
}

// "2026-07-29" -> "29. Juli 2026". Liegt es in der Zukunft, ist es ein
// angekuendigter Start und wird auch so benannt.
function erscheinungsdatum(wert) {
  const teile = String(wert || "").split("-");
  if (teile.length !== 3) return "";
  const monate = ["Januar", "Februar", "März", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const jahr = Number(teile[0]);
  const monat = Number(teile[1]);
  const tag = Number(teile[2]);
  if (!monate[monat - 1]) return "";
  const lesbar = `${tag}. ${monate[monat - 1]} ${jahr}`;
  const zeitpunkt = Date.parse(`${wert}T00:00:00`);
  return Number.isFinite(zeitpunkt) && zeitpunkt > Date.now() ? `Ab ${lesbar}` : lesbar;
}

// --- Entdeckungsseiten --------------------------------------------------------
//
// "Mehr anzeigen" oeffnet je Art eine eigene Seite, die beim Scrollen
// nachlaedt. Der Hauptprozess liefert Abschnitte einer Liste, die zwischen
// zwei Abrufen stabil bleibt - deshalb reicht hier ein Versatz, und kein Titel
// kann doppelt kommen. Die Menge der schon gezeigten Werke wird trotzdem
// mitgefuehrt: derselbe Film liegt bei mehreren Anbietern, und die Engine
// fuehrt ihn zwar als ein Werk, aber sicher ist sicher.
const ENTDECKUNG_STAPEL = 30;
const ENTDECKUNG_TITEL = {
  anime: { titel: "Anime für dich", copy: "Aus deinem Verlauf, deiner Watchlist und dem, was AniList über deine Anime weiß." },
  serie: { titel: "Serien für dich", copy: "Aus deinem Verlauf, deiner Watchlist und dem, was TMDB über deine Serien weiß." },
  film: { titel: "Filme für dich", copy: "Aus deinem Verlauf, deiner Watchlist und dem, was TMDB über deine Filme weiß." }
};

// Je Art ein eigener Zustand. Er ueberdauert das Verlassen der Seite, damit
// jemand, der einen Titel oeffnet und zurueckkommt, wieder dort steht, wo er
// war - und nicht 150 Karten noch einmal laedt.
const entdeckung = new Map();
let entdeckungArt = "";
let entdeckungBeobachter = null;

function entdeckungsZustand(art) {
  if (!entdeckung.has(art)) {
    entdeckung.set(art, {
      items: [], gesehen: new Set(), versatz: 0,
      fertig: false, pending: false, fehler: false, waechst: false,
      nachschlag: 0, versuche: 0, scroll: 0
    });
  }
  return entdeckung.get(art);
}

async function showDiscovery(art) {
  if (!ENTDECKUNG_TITEL[art] || !discoveryView) return;
  await enterInternalMode();
  // Erst schliessen, dann umschalten: `hideContentViews` sichert die
  // Scrollposition der Seite, die gerade verlassen wird - stuende die neue Art
  // schon fest, landete der Wert beim falschen Eintrag.
  hideContentViews();
  const wechsel = entdeckungArt !== art;
  entdeckungArt = art;
  setCurrentRoute(`discovery:${art}`);
  discoveryView.classList.remove("is-hidden");
  // Beim Wechsel der Art muss das Raster leer sein. Es wird sonst nur
  // ergaenzt, und die Karten der vorigen Art blieben oben stehen.
  if (wechsel) discoveryGrid?.replaceChildren();
  const beschriftung = ENTDECKUNG_TITEL[art];
  if (discoveryTitle) discoveryTitle.textContent = beschriftung.titel;
  if (discoveryCopy) discoveryCopy.textContent = beschriftung.copy;

  const zustand = entdeckungsZustand(art);
  renderDiscovery();
  // Erst zeichnen, dann die Scrollposition wiederherstellen - vorher hat die
  // Seite noch keine Hoehe, und jedes Zuruecksetzen liefe ins Leere.
  window.requestAnimationFrame(() => {
    const flaeche = entdeckungsFlaeche();
    if (flaeche && zustand.scroll) flaeche.scrollTop = zustand.scroll;
    entdeckungBeobachten();
    if (!zustand.items.length) loadDiscoveryPage();
    // Wer zurueckkommt und dabei am Ende der Liste stand, soll nicht warten,
    // bis er einmal gescrollt hat.
    else entdeckungNachfassen();
  });
  window.setTimeout(syncBrowserBounds, 0);
}

// In welchem Element wird gescrollt? In der Ansicht selbst: sie liegt
// absolut im Rahmen und traegt `overflow: auto` - der Rahmen darum ist
// bewusst starr. Das ist auch der Bezugspunkt des Beobachters weiter unten;
// mit dem Fenster als Bezug wuerde er nie ausloesen.
function entdeckungsFlaeche() {
  return discoveryView || null;
}

function entdeckungMerkeScroll() {
  if (!entdeckungArt) return;
  const flaeche = entdeckungsFlaeche();
  if (flaeche) entdeckungsZustand(entdeckungArt).scroll = flaeche.scrollTop;
}

// Der Beobachter allein reicht nicht.
//
// Ein IntersectionObserver meldet *Uebergaenge*, nicht Zustaende. Beim Oeffnen
// steht der Beobachtungspunkt sofort im Sichtbereich, ein Stapel wird geladen -
// und danach passiert nichts mehr: dreissig Karten fuellen den Bildschirm samt
// Vorlauf nicht, der Punkt bleibt sichtbar, es gibt keinen neuen Uebergang.
// Genau deshalb lud die Seite erst wieder, wenn man sie verliess und neu
// betrat, denn dabei wird der Beobachter neu gesetzt.
//
// Also nach jedem Stapel selbst nachsehen, ob noch Platz ist. Die Schleife
// endet von allein: `loadDiscoveryPage` steigt bei `pending` und `fertig`
// sofort wieder aus.
function entdeckungNachfassen() {
  if (!discoverySentinel || !entdeckungArt) return;
  if (discoveryView?.classList.contains("is-hidden")) return;
  const zustand = entdeckungsZustand(entdeckungArt);
  if (zustand.pending || zustand.fertig || zustand.fehler) return;
  const flaeche = entdeckungsFlaeche();
  if (!flaeche) return;
  const punkt = discoverySentinel.getBoundingClientRect();
  const rand = flaeche.getBoundingClientRect();
  // Derselbe Vorlauf wie beim Beobachter unten.
  if (punkt.top <= rand.bottom + 800) loadDiscoveryPage();
}

// Nachgeladen wird, bevor das Ende sichtbar ist - deshalb ein Beobachtungspunkt
// mit Vorlauf statt eines Scroll-Zaehlers, der bei jedem Pixel feuert.
function entdeckungBeobachten() {
  if (!discoverySentinel) return;
  entdeckungBeobachter?.disconnect();
  entdeckungBeobachter = new IntersectionObserver((eintraege) => {
    if (!eintraege.some((eintrag) => eintrag.isIntersecting)) return;
    loadDiscoveryPage();
  }, { root: entdeckungsFlaeche(), rootMargin: "800px 0px" });
  entdeckungBeobachter.observe(discoverySentinel);
}

async function loadDiscoveryPage() {
  const art = entdeckungArt;
  if (!art) return;
  const zustand = entdeckungsZustand(art);
  if (zustand.pending || zustand.fertig) return;
  zustand.pending = true;
  zustand.fehler = false;
  renderDiscoveryFoot(art);
  try {
    const antwort = await api.getPersonalPage({
      type: art, offset: zustand.versatz, limit: ENTDECKUNG_STAPEL
    });
    const neue = Array.isArray(antwort?.items) ? antwort.items : [];
    // Derselbe Titel darf in einer Sitzung nur einmal erscheinen.
    const frisch = neue.filter((item) => {
      const schluessel = item.werkKey || item.url;
      if (!schluessel || zustand.gesehen.has(schluessel)) return false;
      zustand.gesehen.add(schluessel);
      return true;
    });
    zustand.items.push(...frisch);
    zustand.versatz += neue.length;
    zustand.waechst = Boolean(antwort?.waechst);
    // "Fertig" nur, wenn wirklich nichts mehr kommt. Holt der Hauptprozess
    // gerade weitere Katalogseiten, ist die Liste nicht zu Ende - sie ist nur
    // noch nicht gewachsen. Dann wird gleich noch einmal gefragt.
    zustand.fertig = Boolean(antwort?.fertig);
    if (frisch.length) zustand.versuche = 0;
    if (!frisch.length && zustand.waechst && !zustand.fertig) {
      // Zwei Wartezeiten stecken dahinter: eine Neuberechnung ist in gut zwei
      // Sekunden da, ein Katalog-Nachschlag braucht laenger. Statt eine feste
      // Zahl zu waehlen, die fuer den einen zu lang und fuer den anderen zu
      // kurz ist, wird schnell zuerst gefragt und dann nachgelassen.
      zustand.versuche += 1;
      const warten = Math.min(8000, 1500 + zustand.versuche * 1500);
      window.clearTimeout(zustand.nachschlag);
      zustand.nachschlag = window.setTimeout(() => {
        if (entdeckungArt === art) loadDiscoveryPage();
      }, warten);
    }
  } catch {
    zustand.fehler = true;
  }
  zustand.pending = false;
  if (entdeckungArt !== art) return;
  renderDiscovery();
  // Erst zeichnen lassen, dann pruefen: vorher stehen die neuen Karten noch
  // nicht im Layout, und der Beobachtungspunkt saesse noch an seiner alten
  // Stelle.
  window.requestAnimationFrame(entdeckungNachfassen);
}

function renderDiscovery() {
  if (!discoveryGrid || !entdeckungArt) return;
  const zustand = entdeckungsZustand(entdeckungArt);
  // Nur anhaengen, was noch nicht steht: die Liste waechst nur am Ende, und
  // ein vollstaendiger Neuaufbau wuerde bei mehreren hundert Karten ruckeln
  // und nebenbei die Scrollposition verlieren.
  const vorhanden = discoveryGrid.childElementCount;
  if (vorhanden > zustand.items.length) discoveryGrid.replaceChildren();
  const anzufuegen = zustand.items.slice(discoveryGrid.childElementCount);
  if (anzufuegen.length) {
    const kasten = document.createDocumentFragment();
    for (const item of anzufuegen) kasten.append(discoverCard(item));
    discoveryGrid.append(kasten);
  }
  renderDiscoveryFoot(entdeckungArt);
}

// Ein laufender Balken plus Text. Beides zusammen, weil eines allein nicht
// reicht: der Balken sagt "es passiert etwas", der Satz sagt "was".
function ladeAnzeige(text, skelette = 6) {
  const kasten = document.createDocumentFragment();
  const balken = document.createElement("div");
  balken.className = "discovery-balken";
  balken.role = "progressbar";
  balken.ariaLabel = text;
  kasten.append(balken);
  if (text) {
    const hinweis = document.createElement("div");
    hinweis.className = "discovery-hinweis";
    hinweis.textContent = text;
    kasten.append(hinweis);
  }
  if (skelette > 0) {
    const reihe = document.createElement("div");
    reihe.className = "discovery-skeletons";
    for (let index = 0; index < skelette; index += 1) {
      const platzhalter = document.createElement("div");
      platzhalter.className = "discovery-skeleton";
      reihe.append(platzhalter);
    }
    kasten.append(reihe);
  }
  return kasten;
}

function renderDiscoveryFoot(art) {
  if (!discoveryFoot) return;
  const zustand = entdeckungsZustand(art);
  discoveryFoot.replaceChildren();
  if (zustand.pending) {
    discoveryFoot.append(ladeAnzeige(zustand.items.length
      ? "Weitere Vorschläge werden geladen …"
      : "Vorschläge werden zusammengestellt …"));
    return;
  }
  if (zustand.fehler) {
    const hinweis = document.createElement("div");
    hinweis.className = "discovery-hinweis";
    // Kein Balken: hier laeuft gerade nichts, und ein laufender Balken waere
    // eine Luege ueber den Zustand.
    const text = document.createElement("span");
    text.textContent = "Weitere Empfehlungen konnten nicht geladen werden.";
    const knopf = document.createElement("button");
    knopf.className = "text-action";
    knopf.type = "button";
    knopf.textContent = "Erneut versuchen";
    knopf.addEventListener("click", () => loadDiscoveryPage());
    hinweis.append(text, knopf);
    discoveryFoot.append(hinweis);
    return;
  }
  // Der Hauptprozess holt gerade weitere Katalogseiten. Das ist kein Ende,
  // sondern eine Pause - und sie wird auch so beschriftet.
  if (zustand.waechst && !zustand.fertig) {
    discoveryFoot.append(ladeAnzeige("Weitere Vorschläge werden gesucht …", 3));
    return;
  }
  if (zustand.fertig && zustand.items.length) {
    const hinweis = document.createElement("div");
    hinweis.className = "discovery-hinweis";
    hinweis.textContent = "Das war alles, was gerade dazu passt.";
    discoveryFoot.append(hinweis);
  }
}

function discoverCard(item) {
  const card = document.createElement("div");
  card.className = "favorite-card";
  card.tabIndex = 0;
  card.role = "button";
  card.title = item.viaSearch ? `${item.title} bei ${item.providerName} suchen` : item.title;
  // Warum dieser Titel vorgeschlagen wird, hat die Empfehlungs-Engine bereits
  // entschieden und ausformuliert - hier wird der Satz nur angezeigt. Reihen
  // ohne Empfehlungslogik ("Neu bei deinen Anbietern") tragen keinen Grund und
  // bekommen deshalb auch keine zusaetzliche Zeile.
  const begruendung = item.grundText || "";
  const untertitel = item.providerName || "";
  if (begruendung && !item.viaSearch) card.title = `${item.title} – ${begruendung}`;
  card.innerHTML = `
    <strong>${escapeHtml(item.title)}</strong>
    ${begruendung ? `<small class="card-reason">${escapeHtml(begruendung)}</small>` : ""}
    <span>${escapeHtml(untertitel)}</span>
    ${item.releasedAt ? `<small class="media-progress-detail">${escapeHtml(erscheinungsdatum(item.releasedAt))}</small>` : ""}
  `;
  // Nach dem Inhalt, sonst raeumt innerHTML die Bildebene gleich wieder weg.
  // Ein Vorschlag traegt das Bild des Anbieters und keinen eigenen Ausschnitt.
  bildEbeneSetzen(card, item.image, null);
  // Vormerken und Abhaken, ohne den Titel vorher oeffnen zu muessen. Vorher
  // fuehrte jeder Weg dorthin ueber die Anbieterseite.
  vorschlagMenueAnhaengen(card, item);
  const oeffnen = () => openDiscoverItem(item);
  card.addEventListener("click", oeffnen);
  card.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    oeffnen();
  });
  return card;
}

async function openDiscoverItem(item) {
  hideContentViews();
  const state = await api.openProviderUrl(item.providerId, item.url);
  activeProviderId = state?.activeProviderId || activeProviderId;
  setCurrentRoute(`provider:${activeProviderId}`);
  renderProviders();
  window.setTimeout(syncBrowserBounds, 0);
}

function renderHeroDots() {
  if (!heroDots) return;
  heroDots.classList.toggle("is-hidden", heroItems.length < 2);
  heroDots.replaceChildren(...heroItems.map((favorite, index) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = index === heroIndex ? "is-active" : "";
    dot.title = displayFavoriteTitle(favorite);
    dot.setAttribute("aria-label", dot.title);
    dot.addEventListener("click", () => showHeroItem(index));
    return dot;
  }));
}

function showHeroItem(index) {
  if (!heroItems.length) return;
  const next = ((index % heroItems.length) + heroItems.length) % heroItems.length;
  if (next === heroIndex && homeHero?.dataset.targetId) return;
  heroIndex = next;
  const enabled = providers.filter((provider) => provider.enabled !== false);
  const provider = enabled.find((item) => item.id === activeProviderId) || enabled[0] || null;

  homeHero?.classList.add("is-switching");
  window.setTimeout(() => {
    renderHomeHero(heroItems[heroIndex] || null, provider, enabled.length > 0);
    renderHeroDots();
    homeHero?.classList.remove("is-switching");
  }, 220);
  startHeroRotation();
}

function startHeroRotation() {
  window.clearInterval(heroTimer);
  heroTimer = 0;
  if (heroItems.length < 2 || heroPaused) return;
  heroTimer = window.setInterval(() => {
    // Nur weiterdrehen, solange die Startseite wirklich sichtbar ist.
    if (!homeView || homeView.classList.contains("is-hidden") || settingsModal?.open) return;
    showHeroItem(heroIndex + 1);
  }, HERO_ROTATION_MS);
}

function renderHomeHero(favorite, provider, hasProviders) {
  if (!homeHero || !heroTitle || !heroCopy) return;
  const target = favorite ? { type: "favorite", id: favorite.id } : provider ? { type: "provider", id: provider.id } : null;
  homeHero.dataset.targetType = target?.type || "";
  homeHero.dataset.targetId = target?.id || "";

  if (favorite) {
    const title = cleanFavoriteTitle(favorite.title, favorite.url) || displayFavoriteTitle(favorite);
    const episode = favoriteEpisodeLabel(favorite.url);
    const progress = favoriteProgressPercent(favorite);
    if (heroEyebrow) heroEyebrow.textContent = "Fortsetzen";
    heroTitle.textContent = title;
    heroCopy.textContent = [episode, favorite.providerName].filter(Boolean).join(" - ") || "Gespeicherter Favorit";
    heroProgress?.classList.toggle("is-hidden", progress <= 0);
    if (heroProgressFill) heroProgressFill.style.width = `${progress}%`;
    if (heroProgressText) heroProgressText.textContent = progress > 0 ? `${progress}%` : "";
    const watchButton = document.querySelector("#heroWatch");
    if (watchButton) watchButton.textContent = "Weiter schauen";
    heroDetails?.classList.remove("is-hidden");
    setHeroArtwork(favoriteBild(favorite), favoriteAusschnitt(favorite));
    return;
  }

  if (heroEyebrow) heroEyebrow.textContent = "ELFIX";
  heroTitle.textContent = provider?.name || "Alles an einem Ort";
  heroCopy.textContent = hasProviders
    ? "Wähle einen Anbieter oder nutze die globale Suche."
    : "Füge Websites in den Einstellungen hinzu und wechsle danach direkt hier zwischen ihnen.";
  heroProgress?.classList.add("is-hidden");
  if (heroProgressFill) heroProgressFill.style.width = "0%";
  if (heroProgressText) heroProgressText.textContent = "";
  const watchButton = document.querySelector("#heroWatch");
  if (watchButton) watchButton.textContent = provider ? "Anbieter öffnen" : "Anbieter hinzufügen";
  heroDetails?.classList.toggle("is-hidden", !provider);
  setHeroArtwork("");
}

// Das Seitenverhaeltnis, das der Titelhintergrund gerade wirklich hat. Es
// haengt an der Fenstergroesse (min-height clamp gegen die volle Breite), also
// gibt es keine Konstante dafuer - es wird gemessen.
//
// Gemerkt wird es, weil der Zuschneide-Editor auch dann das richtige Format
// braucht, wenn die Startseite in dem Moment nicht sichtbar ist - etwa beim
// Bearbeiten aus der Mediathek heraus. Der Rueckfallwert greift nur, solange
// die Startseite in dieser Sitzung noch kein einziges Mal gezeichnet wurde.
const BANNER_SEITE_RUECKFALL = 16 / 9;
let letzteBannerSeite = 0;

function bannerSeite() {
  const kasten = homeHero?.getBoundingClientRect();
  if (kasten && kasten.width > 0 && kasten.height > 0) {
    letzteBannerSeite = kasten.width / kasten.height;
  }
  return letzteBannerSeite || BANNER_SEITE_RUECKFALL;
}

// --- Die Bildebene ------------------------------------------------------------
//
// Eine einzige Stelle setzt jedes Titelbild: die Karten in "Gemeinsam
// weiterschauen", auf der Watchlist, in der Mediathek, bei den Empfehlungen
// und im Kalender - und das Banner der Startseite. Die Live-Vorschau im
// Zuschneide-Editor ruft dieselbe Funktion auf demselben Kartenaufbau auf.
// Deshalb kann die Vorschau nichts anderes zeigen als die fertige Karte.
//
// Gerechnet wird hier nichts: die drei Variablen gehen so, wie sie gespeichert
// sind, ans Stylesheet. Weil keine davon eine Pixelgroesse kennt, gilt
// derselbe Ausschnitt in jeder Kartenform und bei jeder Fenstergroesse.
// Welche Form haben die Karten gerade? Sie steht als Klasse an der Huelle -
// dieselbe Klasse, aus der das Stylesheet die Kartenmasse holt. "Klein" hat
// keinen eigenen Ausschnitt: es ist dieselbe liegende Form wie die
// gewoehnliche Karte, nur kleiner, und ein Ausschnitt haengt am Verhaeltnis
// und nicht an der Groesse.
function kartenFormat() {
  const huelle = document.querySelector(".app-shell");
  const gefunden = ["poster", "large", "medium", "small"]
    .find((groesse) => huelle?.classList.contains(`favorites-${groesse}`));
  return gefunden && gefunden !== "small" ? gefunden : "medium";
}

function bildEbeneSetzen(kasten, bildUrl, ausschnitt, format = kartenFormat()) {
  if (!kasten) return;
  const url = String(bildUrl || "").trim();
  let ebene = kasten.querySelector(":scope > .karten-bild");
  // Keine Adresse - oder eine, die sich eben erst als kaputt erwiesen hat.
  // In beiden Faellen bekommt die Karte die Ersatzgrafik statt einer
  // Flaeche, die nur nach einem Ladefehler aussieht.
  if (!url || bildGiltAlsKaputt(url)) {
    ebene?.remove();
    kasten.classList.remove("has-thumb");
    kasten.classList.toggle("ohne-bild", Boolean(url));
    return;
  }
  kasten.classList.remove("ohne-bild");
  if (!ebene) {
    ebene = document.createElement("div");
    ebene.className = "karten-bild";
    const neuesBild = document.createElement("img");
    neuesBild.alt = "";
    neuesBild.draggable = false;
    neuesBild.decoding = "async";
    ebene.append(neuesBild);
    // Ganz nach vorn in die Karte: Titel, Anbieter und Fortschritt stehen
    // danach im Aufbau und liegen damit ueber dem Bild.
    kasten.prepend(ebene);
  }
  const bild = ebene.querySelector("img");
  // Laedt die Adresse nicht, wird sie gemerkt und die Karte neu gezeichnet -
  // dann greift oben die Ersatzgrafik. Der Horcher haengt an der Adresse und
  // nicht am Bild: sonst meldete er nach dem naechsten Wechsel des src noch
  // einmal fuer das alte, und aus einem Fehlschlag wuerden zwei.
  bild.onerror = () => {
    if (bild.getAttribute("src") !== url) return;
    bildAlsKaputtMerken(url);
    bildEbeneSetzen(kasten, url, ausschnitt, format);
  };
  // Nur bei Bedarf neu setzen - sonst faengt ein eigenes Bild bei jedem
  // Zeichnen wieder von vorn an zu laden, und die Karte blinkt.
  if (bild.getAttribute("src") !== url) bild.src = url;
  for (const [name, wert] of Object.entries(bildausschnittModul.cssWerte(ausschnitt, format))) {
    ebene.style.setProperty(name, wert);
  }
  kasten.classList.add("has-thumb");
}

// Das Banner hat immer die Form "banner" - es ist keine Karte und folgt
// deshalb auch nicht der eingestellten Kartengroesse.
function setHeroArtwork(value, ausschnitt = null) {
  bildEbeneSetzen(homeHero, value, ausschnitt, "banner");
}

// Der Ausschnitt gilt nur fuer ein selbst gewaehltes Bild. Das Bild der
// Anbieterseite kann von einem Durchlauf zum naechsten ein anderes sein - eine
// dafuer gewaehlte Lage waere dann die Lage eines fremden Bildes.
function favoriteAusschnitt(favorite) {
  if (!favorite?.customThumbnail) return null;
  return favorite.customThumbnailCrop || null;
}

function sortedHomeFavorites() {
  return continueEntries()
    .slice()
    .sort((left, right) => favoriteTimestamp(right) - favoriteTimestamp(left));
}

function favoriteTimestamp(favorite) {
  // Eintraege einer Runde bekommen bei jeder fremden Meldung eine neue
  // "zuletzt geschaut"-Zeit - im Sekundentakt. Danach zu sortieren liess die
  // Kacheln staendig die Plaetze tauschen, sobald zwei Leute gleichzeitig
  // schauten. Fuer sie zaehlt deshalb, wann dieses Geraet zuletzt selbst dran
  // war; die Reihe steht damit still, waehrend die Inhalte weiterlaufen.
  const candidates = favorite.watchpartyRoom
    ? [favorite.openedAt, favorite.createdAt, favorite.addedAt, favorite.updatedAt]
    : [favorite.lastWatchedAt, favorite.openedAt, favorite.updatedAt, favorite.createdAt, favorite.addedAt];
  for (const value of candidates) {
    const time = Date.parse(value);
    if (Number.isFinite(time)) return time;
  }
  return 0;
}

function favoriteProgressPercent(favorite) {
  const current = Number(favorite?.currentTime || favorite?.position || 0);
  const duration = Number(favorite?.duration || 0);
  if (Number.isFinite(current) && Number.isFinite(duration) && current >= 0 && duration > 0) {
    return Math.max(0, Math.min(100, Math.round((current / duration) * 100)));
  }
  return null;
}

function sidebarProviderButton(provider) {
  const button = document.createElement("button");
  button.className = "home-side-link provider-side-link";
  button.dataset.providerId = provider.id;
  button.type = "button";
  button.title = provider.name;
  button.innerHTML = `<span class="side-provider-badge side-icon">${escapeHtml(provider.logo || provider.name.slice(0, 2).toUpperCase())}</span><span class="side-label">${escapeHtml(provider.name)}</span>`;
  button.addEventListener("click", () => openProviderFromHome(provider.id));
  return button;
}

async function handleHomeAction(action) {
  if (action === "start") {
    await showHome();
    return;
  }
  if (action === "search") {
    await openSearchView();
    return;
  }
  if (action === "calendar") {
    await showCalendar();
    return;
  }
  if (action === "favorites") {
    await showFavorites();
    return;
  }
  if (action === "library") {
    await showLibrary();
    return;
  }
  if (action === "continue") {
    await showContinue();
    return;
  }
  if (action === "watchparty") {
    await showWatchparty();
    return;
  }
  if (action === "settings" || action === "add-provider") {
    await openSettings(action === "add-provider" ? "add-provider" : "settings");
    return;
  }
  if (action === "history") {
    await showHistory();
    return;
  }
  if (action === "review") {
    await rueckblickOeffnen();
    return;
  }
  if (action === "help") {
    // Hilfe liegt dort, wo auch geantwortet wird: bei den Issues des Projekts.
    // Das oeffnet der Standardbrowser, nicht ELFIX - dort ist der Benutzer bei
    // GitHub angemeldet. Die Ansicht hier bleibt stehen, wo sie war.
    const ergebnis = await api.openHelpIssues();
    showToast(ergebnis?.ok
      ? "Hilfe & Support im Browser geöffnet"
      : "Browser konnte nicht geöffnet werden — github.com/RoveHD/elfix/issues");
  }
}

async function openProviderFromHome(providerId) {
  const provider = providers.find((item) => item.id === providerId && item.enabled !== false);
  if (!provider) return;
  hideContentViews();
  await api.setShellOpen(false);
  const state = await api.openProvider(provider.id);
  activeProviderId = state?.activeProviderId || provider.id;
  setCurrentRoute(`provider:${activeProviderId}`);
  renderProviders();
  renderHome();
}

async function openHeroTarget() {
  const type = homeHero.dataset.targetType;
  const id = homeHero.dataset.targetId;
  if (type === "favorite" && id) {
    const favorite = favorites.find((item) => item.id === id);
    if (favorite) {
      const resume = hasContinueActivity(favorite);
      await openFavoriteEntry(favorite, { autoplay: resume, fullscreen: resume });
      return;
    }
  }
  if (type === "provider" && id) {
    await openProviderFromHome(id);
    return;
  }
  openSettings();
}

function providerCard(provider, large) {
  const card = document.createElement("button");
  // Die Groesse steht im Stylesheet und richtet sich nach der Einstellung
  // "Groesse der Anbieter-Kacheln". Hier standen frueher feste Pixel als
  // Inline-Stil - und der schlaegt jede Regel, weshalb der Regler wirkungslos
  // blieb.
  card.className = [
    "provider-card",
    provider.id === activeProviderId ? "is-active" : "",
    large ? "is-large" : ""
  ].filter(Boolean).join(" ");
  card.type = "button";
  card.innerHTML = `
    <span class="provider-logo">${escapeHtml(provider.logo || provider.name.slice(0, 2).toUpperCase())}</span>
    <span class="provider-name">${escapeHtml(provider.name)}</span>
  `;
  let clickTimer = null;
  const openProviderTab = async (startUrl = false) => {
    hideContentViews();
    const state = startUrl
      ? await api.openProviderUrl(provider.id, provider.startUrl)
      : await api.openProvider(provider.id);
    activeProviderId = state?.activeProviderId || provider.id;
    setCurrentRoute(`provider:${activeProviderId}`);
    renderProviders();
  };
  card.addEventListener("click", () => {
    if (clickTimer) clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      clickTimer = null;
      openProviderTab(false);
    }, 230);
  });
  card.addEventListener("dblclick", (event) => {
    event.preventDefault();
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    openProviderTab(true);
  });
  // Rechtsklick fuehrt dorthin, wo dieser Anbieter eingestellt wird. Der
  // einfache Klick oeffnet ihn ja - beides an denselben Knopf zu haengen geht
  // nur ueber die zweite Maustaste.
  card.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    anbieterMenue(provider, card).catch(() => {});
  });
  return card;
}

// Was der Rechtsklick anbietet. Die Auswahl faellt im Hauptprozess, weil ein
// Menue aus HTML hinter der Anbieterseite verschwaende.
async function anbieterMenue(provider, karte) {
  const anker = karte?.getBoundingClientRect();
  const punkt = anker ? { x: anker.left, y: anker.bottom + 4 } : null;
  const wahl = await api.providerContextMenu?.(provider.name, punkt).catch(() => "");
  if (wahl === "edit") await anbieterBearbeiten(provider);
  else if (wahl === "new") await anbieterHinzufuegen();
}

// Direkt in die Einstellungen dieses einen Anbieters: Seite "Anbieter", er
// selbst ausgewaehlt, sein Formular ausgefuellt.
//
// Die Auswahl wird vor dem Oeffnen gesetzt, nicht danach - openSettings baut
// die Ansicht bereits auf, und eine spaeter gesetzte Auswahl saehe man erst
// beim naechsten Aufbau.
async function anbieterBearbeiten(provider) {
  const stelle = providers.findIndex((eintrag) => eintrag.id === provider.id);
  if (stelle < 0) {
    showToast("Diesen Anbieter gibt es nicht mehr");
    return;
  }
  selectedProviderIndex = stelle;
  await openSettings();
  activateTab("providers");
  renderSettings();
}

// Dasselbe mit leerem Formular. Eine Auswahl von -1 heisst "neu" - dieselbe
// Stellung, die auch der "+ Neu"-Knopf in den Einstellungen herstellt.
async function anbieterHinzufuegen() {
  selectedProviderIndex = -1;
  await openSettings("add-provider");
  activateTab("providers");
  renderSettings();
  providerName?.focus();
}

function emptyText(text) {
  const node = document.createElement("div");
  node.className = "setting-card";
  node.textContent = text;
  return node;
}

async function enterInternalMode() {
  // Sofort ausblenden statt auf die Meldung aus dem Hauptprozess zu warten -
  // in einer eigenen Ansicht gibt es keine Folge zum Steuern.
  showWatchpartyLive({ active: false, live: false, key: "", room: "" });
  const state = await api.showHome();
  activeProviderId = state?.activeProviderId || null;
  currentUrl = state?.url || "";
  if (Array.isArray(state?.favorites)) {
    favorites = state.favorites;
  }
  renderProviders();
  renderFavoriteToggle();
}

async function showHome() {
  await enterInternalMode();
  setCurrentRoute("start");
  hideContentViews();
  homeView.classList.remove("is-hidden");
  renderProviders();
  renderFavoriteToggle();
  renderHome();
  window.setTimeout(syncBrowserBounds, 0);
}

// Der Kalender der Anbieter, nach Wochentagen. Geladen wird beim ersten
// Oeffnen und danach aus dem Zwischenspeicher - die Seiten aendern sich
// hoechstens taeglich.
let kalenderDaten = null;
let kalenderTag = "";
// Anime, Serie oder beides. Getrennt vom Wochentag: man will die Woche
// durchblaettern, ohne die Auswahl jedes Mal neu zu treffen.
let kalenderArt = "alle";
// Und dasselbe fuer die Fassung. Wer nur deutsche Synchronfassungen schaut,
// interessiert sich fuer den Rest der Woche gar nicht - vorher stand alles
// gemischt untereinander und musste Karte fuer Karte gelesen werden.
let kalenderSprache = "alle";

async function showCalendar() {
  await enterInternalMode();
  setCurrentRoute("calendar");
  hideContentViews();
  document.querySelector("#calendarView")?.classList.remove("is-hidden");
  window.setTimeout(syncBrowserBounds, 0);
  if (!kalenderDaten) await ladeKalender();
  else renderKalender();
}

async function ladeKalender(refresh = false) {
  const gitter = document.querySelector("#calendarGrid");
  if (gitter && !kalenderDaten) gitter.replaceChildren(emptyText("Kalender wird geladen …"));
  kalenderDaten = await api.loadCalendar?.(refresh).catch(() => null);
  // Beim ersten Mal auf den heutigen Tag stellen.
  if (!kalenderTag) {
    const heute = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"][new Date().getDay()];
    kalenderTag = heute;
  }
  renderKalender();
}

// Die Reihenfolge der Fassungen: deutsche Synchronfassung zuerst, danach die
// Untertitelfassungen. Dieselbe Regel wie in discover.js, wo die Fassungen
// einer Folge sortiert werden - stuende hier eine andere, sprangen die Knoepfe
// gegenueber der Beschriftung auf den Karten durcheinander.
function kalenderSprachRang(sprache) {
  if (/^Deutsch$/i.test(sprache)) return 0;
  if (/Deutsche Untertitel/i.test(sprache)) return 1;
  if (/Englische Untertitel/i.test(sprache)) return 2;
  return 3;
}

// Welche Fassungen ein Eintrag traegt. Manche Anbieter liefern nur eine, dann
// steht sie im Einzelfeld.
function kalenderSprachen(eintrag) {
  if (eintrag?.languages?.length) return eintrag.languages;
  return eintrag?.language ? [eintrag.language] : [];
}

// Welche Fassungen kommen in diesen Eintraegen vor - deutsche Synchronfassung
// zuerst, danach die Untertitelfassungen, der Rest alphabetisch.
function kalenderSprachAuswahl(eintraege) {
  return [...new Set(eintraege.flatMap(kalenderSprachen))]
    .sort((links, rechts) => kalenderSprachRang(links) - kalenderSprachRang(rechts)
      || links.localeCompare(rechts, "de"));
}

// Ein Eintrag zaehlt zu einer Fassung, wenn er sie traegt. Er kann mehrere
// tragen und steht dann unter jeder - dieselbe Folge gibt es auf Deutsch und
// mit Untertiteln, und wer nach beidem sucht, soll sie beide Male finden.
function kalenderNachSprache(eintraege, sprache) {
  if (!sprache || sprache === "alle") return eintraege;
  return eintraege.filter((eintrag) => kalenderSprachen(eintrag).includes(sprache));
}

// Ein Knopf einer Filterzeile. Beide Zeilen sehen gleich aus und verhalten
// sich gleich - deshalb steht das hier einmal.
function kalenderFilterKnopf(titel, anzahl, aktiv, waehlen) {
  const knopf = document.createElement("button");
  knopf.type = "button";
  knopf.className = `calendar-day${aktiv ? " is-active" : ""}`;
  knopf.textContent = `${titel} (${anzahl})`;
  knopf.addEventListener("click", waehlen);
  return knopf;
}

function renderKalender() {
  const tage = document.querySelector("#calendarDays");
  const gitter = document.querySelector("#calendarGrid");
  const leer = document.querySelector("#calendarEmpty");
  if (!tage || !gitter) return;

  const alle = kalenderDaten?.entries || [];
  leer?.classList.toggle("is-hidden", alle.length > 0);
  if (!alle.length) {
    tage.replaceChildren();
    gitter.replaceChildren();
    document.querySelector("#calendarFilter")?.replaceChildren();
    document.querySelector("#calendarLanguageFilter")?.replaceChildren();
    return;
  }

  // Die Auswahl zwischen Animes und Serien. Angeboten wird nur, was es auch
  // gibt - bei einem Anbieter allein waere die Wahl sinnlos.
  const filter = document.querySelector("#calendarFilter");
  const arten = [
    { wert: "alle", titel: "Alles" },
    { wert: "anime", titel: "Animes" },
    { wert: "serie", titel: "Serien" }
  ].filter((art) => art.wert === "alle" || alle.some((eintrag) => eintrag.type === art.wert));
  if (arten.length < 3) kalenderArt = "alle";
  filter?.replaceChildren(...(arten.length > 2 ? arten.map((art) => kalenderFilterKnopf(
    art.titel,
    art.wert === "alle" ? alle.length : alle.filter((e) => e.type === art.wert).length,
    art.wert === kalenderArt,
    () => { kalenderArt = art.wert; renderKalender(); }
  )) : []));

  const nachArt = kalenderArt === "alle"
    ? alle
    : alle.filter((eintrag) => eintrag.type === kalenderArt);

  // Die Auswahl der Fassung. Wie bei der Art wird nur angeboten, was es auch
  // gibt - und gezaehlt wird innerhalb der schon gewaehlten Art, damit die
  // Zahlen zu dem passen, was danach dasteht. Bei nur einer Fassung waere die
  // Wahl sinnlos, dann bleibt die Zeile leer.
  const sprachFilter = document.querySelector("#calendarLanguageFilter");
  const sprachen = kalenderSprachAuswahl(nachArt);
  if (!sprachen.includes(kalenderSprache)) kalenderSprache = "alle";
  sprachFilter?.replaceChildren(...(sprachen.length > 1 ? [
    kalenderFilterKnopf("Alle Fassungen", nachArt.length, kalenderSprache === "alle",
      () => { kalenderSprache = "alle"; renderKalender(); }),
    ...sprachen.map((sprache) => kalenderFilterKnopf(
      sprache,
      kalenderNachSprache(nachArt, sprache).length,
      sprache === kalenderSprache,
      () => { kalenderSprache = sprache; renderKalender(); }
    ))
  ] : []));

  const eintraege = kalenderNachSprache(nachArt, kalenderSprache);

  tage.replaceChildren(...(kalenderDaten.days || []).map((tag) => {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = `calendar-day${tag === kalenderTag ? " is-active" : ""}`;
    const anzahl = eintraege.filter((eintrag) => eintrag.day === tag).length;
    // Das Datum gehoert dazu - sonst weiss man nicht, welcher Montag gemeint ist.
    const datum = kalenderDatum(kalenderDaten?.dates?.[tag] || "");
    knopf.textContent = [tag, datum, anzahl ? `(${anzahl})` : ""].filter(Boolean).join(" ");
    knopf.disabled = !anzahl;
    knopf.addEventListener("click", () => {
      kalenderTag = tag;
      renderKalender();
    });
    return knopf;
  }));

  const desTages = eintraege.filter((eintrag) => eintrag.day === kalenderTag);
  gitter.replaceChildren(...(desTages.length
    ? desTages.map(kalenderKarte)
    : [emptyText("An diesem Tag erscheint nichts.")]));
}

// "2026-08-17" -> "17.08." - das Jahr steht ohnehin in der Gegenwart.
function kalenderDatum(wert) {
  const teile = String(wert || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return teile ? `${teile[3]}.${teile[2]}.` : "";
}

// Jede Fassung auf eine eigene Zeile. Hintereinander getrennt durch Punkte
// brach der Text mitten im Namen um - "Japanisch, dt. Unter-" auf der einen,
// "titel" auf der naechsten Zeile.
function kalenderFassungen(eintrag) {
  const fassungen = eintrag.languages?.length
    ? eintrag.languages
    : (eintrag.language ? [eintrag.language] : []);
  if (!fassungen.length) return "";
  return `<small class="calendar-language">${fassungen
    .map((fassung) => `<span>${escapeHtml(fassung)}</span>`)
    .join("")}</small>`;
}

function kalenderKarte(eintrag) {
  const karte = document.createElement("div");
  karte.className = "favorite-card";
  karte.tabIndex = 0;
  karte.role = "button";
  karte.title = `${eintrag.title} bei ${eintrag.providerName} öffnen`;
  const folge = eintrag.episode
    ? `S${eintrag.season || 1}E${eintrag.episode}`
    : "";
  // Auf eine Zeile passt das nicht - die Fassung wird sonst abgeschnitten.
  // Also Herkunft und Folge oben, Zeitpunkt und Fassung darunter.
  const herkunft = [eintrag.providerName, folge].filter(Boolean).join(" · ");
  const wann = [kalenderDatum(eintrag.date), eintrag.time ? `${eintrag.time} Uhr` : ""]
    .filter(Boolean).join(" · ");
  karte.innerHTML = `
    <strong>${escapeHtml(eintrag.title)}</strong>
    <span>${escapeHtml(herkunft)}</span>
    ${wann ? `<small class="media-progress-detail">${escapeHtml(wann)}</small>` : ""}
    ${kalenderFassungen(eintrag)}
  `;
  bildEbeneSetzen(karte, eintrag.image, null);
  // Vormerken und Abhaken direkt aus dem Kalender. Vorher fuehrte von hier nur
  // ein Weg zum Anbieter - man sah, dass Freitag eine Folge kommt, und musste
  // den Titel erst dort oeffnen, um ihn vorzumerken.
  vorschlagMenueAnhaengen(karte, eintrag);
  const oeffnen = () => api.openProviderUrl?.(eintrag.providerId, eintrag.url);
  karte.addEventListener("click", oeffnen);
  karte.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      oeffnen();
    }
  });
  return karte;
}

async function showFavorites() {
  await enterInternalMode();
  setCurrentRoute("watchlist");
  hideContentViews();
  favoritesView.classList.remove("is-hidden");
  renderFavorites();
  window.setTimeout(syncBrowserBounds, 0);
}

async function showLibrary() {
  await enterInternalMode();
  setCurrentRoute("library");
  hideContentViews();
  libraryView?.classList.remove("is-hidden");
  renderLibraryViews();
  window.setTimeout(syncBrowserBounds, 0);
}

async function showContinue() {
  await enterInternalMode();
  setCurrentRoute("continue");
  hideContentViews();
  continueView?.classList.remove("is-hidden");
  renderLibraryViews();
  window.setTimeout(syncBrowserBounds, 0);
}

// Die Kopfzeile der Ansicht sagt, ob ueberhaupt eine Verbindung steht.
function renderWatchpartyViewStatus(state) {
  if (!watchpartyViewStatus) return;
  const grund = "Wenn du beitrittst, läuft euer Fortschritt zusammen.";
  if (!state?.enabled) {
    watchpartyViewStatus.textContent = `Watchparty ist ausgeschaltet. ${grund}`;
    return;
  }
  if (!state.connected) {
    watchpartyViewStatus.textContent = state.error
      ? `Nicht verbunden: ${state.error}`
      : "Verbinde mit dem Raum …";
    return;
  }
  const raeume = state.rooms || [];
  const stehen = raeume.filter((raum) => raum.connected);
  const andere = Math.max(0, (state.peers?.length || 1) - 1);
  const geraete = andere === 0 ? "noch niemand sonst" : `${andere} weiteres Gerät${andere === 1 ? "" : "e"}`;
  const wo = stehen.length > 1
    ? `${stehen.length} Räume (${stehen.map((raum) => raum.room).join(", ")})`
    : `Raum „${stehen[0]?.room || state.room}“`;
  watchpartyViewStatus.textContent = `${wo} — ${geraete}. ${grund}`;
}


// --- YouTube-Watchparty ------------------------------------------------------
//
// Bewusst eine andere Flaeche als die Kacheln darunter. Dort stellt jemand eine
// Serie ein und andere treten ihr bei; hier gibt es nur eine Sitzung, in der
// alle dasselbe Video sehen und jeder es wechseln darf. Deshalb steht hier eine
// Raumwahl statt eines Rasters - mehr Bedienung braucht es nicht.

function renderYoutubeParty(state) {
  youtubePartyState = state || null;
  renderYoutubePartyBanner();
  if (!youtubeParty) return;

  const raeume = Array.isArray(state?.rooms) ? state.rooms : [];
  const gewaehlt = state?.enabled ? String(state.room || "") : "";
  youtubeParty.classList.toggle("is-off", !state?.enabled);

  if (youtubePartyRoom) {
    // Nur neu bauen, wenn sich wirklich etwas geaendert hat: sonst klappt eine
    // gerade geoeffnete Auswahlliste bei jeder Statusmeldung wieder zu.
    const soll = ["", ...raeume].join("\u0000");
    if (youtubePartyRoom.dataset.raeume !== soll) {
      youtubePartyRoom.dataset.raeume = soll;
      const aus = document.createElement("option");
      aus.value = "";
      aus.textContent = "Aus";
      const eintraege = [aus];
      for (const raum of raeume) {
        const option = document.createElement("option");
        option.value = raum;
        option.textContent = raum;
        eintraege.push(option);
      }
      youtubePartyRoom.replaceChildren(...eintraege);
    }
    youtubePartyRoom.value = gewaehlt;
    youtubePartyRoom.disabled = raeume.length === 0;
  }

  const offen = document.querySelector("#youtubePartyOpen");
  const abgleich = document.querySelector("#youtubePartyResync");
  const laeuftRunde = Boolean(state?.enabled && state.video?.videoId);
  if (offen) offen.disabled = !laeuftRunde;
  if (abgleich) abgleich.disabled = !state?.enabled;

  if (youtubePartyStatus) youtubePartyStatus.textContent = youtubePartyText(state, raeume);
  if (youtubePartyMembers) {
    const namen = (state?.members || []).map((person) => (
      person.id === state.me ? `${person.name} (du)` : person.name
    ));
    youtubePartyMembers.textContent = state?.enabled && namen.length
      ? `Dabei: ${namen.join(", ")}`
      : "";
  }
}

function youtubePartyText(state, raeume) {
  if (!state?.watchpartyEnabled) return "Die Watchparty ist ausgeschaltet — trage zuerst Server und Raumcode in den Einstellungen ein.";
  if (!raeume.length) return "Noch kein Raum eingetragen. Der YouTube-Modus läuft in einem der Watchparty-Räume.";
  if (!state.enabled) return "Aus. Wähle einen Raum, und ab dann seht ihr alle dasselbe YouTube-Video.";
  if (state.error) return state.error;
  if (!state.connected) return `Raum „${state.room}“ — keine Verbindung. Sobald sie zurück ist, wird der Stand neu geholt.`;
  if (!state.joined) return `Raum „${state.room}“ — wird angemeldet …`;
  if (!state.video?.videoId) return `Raum „${state.room}“ — noch kein Video. Öffne eines auf YouTube, dann sehen es alle anderen auch.`;

  const titel = state.video.title || state.video.videoId;
  const wo = formatClock(Number(state.video.position) || 0);
  const wer = state.video.by ? ` — zuletzt: ${state.video.by}` : "";
  // Stoebern muss dastehen, sonst sieht es nach einem Fehler aus: die Runde
  // laeuft, dieses Fenster zeigt die Startseite, und niemand zieht den anderen.
  // Genau so ist es gemeint - und der Weg zurueck steht gleich daneben.
  if (state.browsing) {
    return `Du stöberst — die Runde läuft ohne dich weiter (${titel}, ${wo}). `
      + "Öffne ein Video, dann sehen es alle; oder geh mit „Zum Video“ zurück.";
  }
  return `${state.video.playing ? "Läuft" : "Pausiert"} bei ${wo} · ${titel}${wer}`;
}

// Oben in der Kopfzeile, und nur auf YouTube: wofuer das Schauen hier zaehlt.
// Auf jeder anderen Seite haette die Anzeige nichts zu sagen - die Runde
// bewegt dort nichts -, deshalb haengt sie an der offenen Seite und nicht am
// Zustand der Runde. Sie ist zugleich der einzige Schalter: privat oder Raum.
function renderYoutubePartyBanner() {
  if (!youtubePartyBanner) return;
  const state = youtubePartyState;
  // Ohne eingerichtete Watchparty bliebe nur "privat" zur Wahl - ein Schalter
  // mit einer Stellung ist keiner.
  const waehlbar = Boolean(state?.watchpartyEnabled && (state.rooms || []).length);
  const sichtbar = aufYoutubeSeite() && (waehlbar || Boolean(state?.enabled));
  youtubePartyBanner.classList.toggle("is-hidden", !sichtbar);
  if (!sichtbar) return;
  youtubePartyBanner.classList.toggle("is-private", !state?.enabled);
  youtubePartyBanner.classList.toggle("is-offline", Boolean(state?.enabled) && !state.connected);
  youtubePartyBanner.title = state?.enabled
    ? `YouTube-Runde „${state.room}“ — klicken, um privat zu schauen oder den Raum zu wechseln`
    : "Zählt nur für dich — klicken, um in eine YouTube-Runde zu wechseln";
  if (!youtubePartyBannerText) return;
  if (!state?.enabled) {
    youtubePartyBannerText.textContent = "YouTube: privat";
    return;
  }
  if (!state.connected) {
    youtubePartyBannerText.textContent = "YouTube-Runde: Verbindung weg …";
    return;
  }
  if (!state.video?.videoId) {
    youtubePartyBannerText.textContent = `YouTube-Runde: ${state.room}`;
    return;
  }
  if (state.browsing) {
    youtubePartyBannerText.textContent = "YouTube-Runde: du stöberst";
    return;
  }
  const wer = state.video.by ? ` · ${state.video.by}` : "";
  youtubePartyBannerText.textContent = `YouTube-Runde: ${state.video.playing ? "läuft" : "pausiert"}${wer}`;
}

// Der Schalter auf der YouTube-Seite. Ein Fenstermenue, kein Kaestchen aus
// HTML: ueber der Anbieterseite waere das nicht anklickbar.
async function youtubePartyKontextWechseln() {
  if (youtubePartyBanner?.classList.contains("is-hidden")) return;
  const anker = youtubePartyBanner?.getBoundingClientRect();
  const punkt = anker ? { x: anker.left, y: anker.bottom + 4 } : null;
  const antwort = await api.switchYoutubePartyContext?.(punkt).catch(() => null);
  if (antwort?.settings) settings = antwort.settings;
  if (antwort?.status) renderYoutubeParty(antwort.status);
  if (!antwort?.switched) return;
  showToast(antwort.room
    ? `YouTube zählt jetzt für „${antwort.room}“ — ihr schaut gemeinsam`
    : "YouTube zählt jetzt nur für dich");
}

async function youtubePartyRaumWaehlen() {
  const wahl = youtubePartyRoom ? youtubePartyRoom.value : "";
  try {
    const antwort = await api.setYoutubePartyRoom?.(wahl);
    if (antwort?.settings) settings = antwort.settings;
    if (antwort?.status) renderYoutubeParty(antwort.status);
    if (antwort && antwort.ok === false) showToast(antwort.reason || "Der Raum konnte nicht gesetzt werden");
    else showToast(wahl ? `YouTube-Watchparty läuft in „${wahl}“` : "YouTube-Watchparty ausgeschaltet");
  } catch {
    showToast("Der Raum konnte nicht gesetzt werden");
  }
}

async function youtubePartyAbgleichen() {
  try {
    renderYoutubeParty(await api.resyncYoutubeParty?.());
    showToast("Mit der Runde abgeglichen");
  } catch {
    showToast("Abgleichen hat nicht geklappt");
  }
}

async function youtubePartyOeffnen() {
  if (!youtubePartyState?.video?.videoId) return;
  try {
    hideContentViews();
    const state = await api.openYoutubeParty?.();
    activeProviderId = state?.activeProviderId || activeProviderId;
    setCurrentRoute(`provider:${activeProviderId}`);
    renderProviders();
    window.setTimeout(syncBrowserBounds, 0);
  } catch {
    showToast("Das Video der Runde ließ sich nicht öffnen");
  }
}

// Getrennt von der eigenen Weiterschauen-Liste: hier steht ausschliesslich,
// was die anderen Geraete im Raum gemeldet haben.
async function showWatchparty() {
  await enterInternalMode();
  setCurrentRoute("watchparty");
  hideContentViews();
  watchpartyView?.classList.remove("is-hidden");
  renderWatchpartyItems();
  loadWatchpartyItems();
  api.getYoutubePartyStatus?.().then(renderYoutubeParty).catch(() => {});
  window.setTimeout(syncBrowserBounds, 0);
}

async function loadWatchpartyItems() {
  try {
    const items = await api.getWatchpartyItems?.();
    watchpartyItems = Array.isArray(items) ? items : [];
  } catch {
    watchpartyItems = [];
  }
  renderWatchpartyItems();
}

function renderWatchpartyItems() {
  if (!watchpartyGrid) return;
  const vorhanden = watchpartyItems.length > 0;
  watchpartyEmpty?.classList.toggle("is-hidden", vorhanden);
  // Fuer ".favorite-grid" gibt es keine Ausblend-Regel im Stylesheet - die
  // Klasse "is-hidden" allein wuerde die Karten stehen lassen. Also leeren.
  watchpartyGrid.replaceChildren(...(vorhanden ? watchpartyKarten() : []));

  if (!vorhanden) {
    const eingerichtet = watchpartyState?.enabled;
    if (watchpartyEmptyTitle) {
      watchpartyEmptyTitle.textContent = eingerichtet ? "Noch nichts eingestellt" : "Noch keine Watchparty";
    }
    if (watchpartyEmptyCopy) {
      watchpartyEmptyCopy.textContent = eingerichtet
        ? "Stelle eine Serie über den ⇄ Knopf oben rechts in den Raum — oder warte, bis jemand anderes eine einstellt."
        : "Trage Server und Raumcode in den Einstellungen ein. Danach stellst du eine Serie über den ⇄ Knopf oben rechts in den Raum.";
    }
  }
}

// Bei mehreren Raeumen bekommt jeder seinen eigenen Abschnitt - sonst stuenden
// die Titel zweier Runden wahllos durcheinander.
function watchpartyKarten() {
  // Gegliedert wird nach den eingerichteten Raeumen, nicht nach denen, in denen
  // schon etwas steht: sonst sieht man bei zwei Raeumen nur eine Reihe Karten
  // und weiss nicht, zu welchem Raum sie gehoert.
  const raeume = (watchpartyState?.rooms || []).map((eintrag) => eintrag.room);
  for (const item of watchpartyItems) {
    const raum = item.room || "";
    if (!raeume.includes(raum)) raeume.push(raum);
  }
  if (raeume.length < 2) return watchpartyItems.map(watchpartyCard);

  const kinder = [];
  for (const raum of raeume) {
    const karten = watchpartyItems.filter((eintrag) => (eintrag.room || "") === raum);
    const stand = watchpartyState?.rooms?.find((eintrag) => eintrag.room === raum);

    const ueberschrift = document.createElement("h2");
    ueberschrift.className = "watchparty-room-heading";
    ueberschrift.textContent = raum || "Ohne Raum";
    const hinweis = document.createElement("small");
    if (stand && !stand.connected) {
      hinweis.textContent = stand.error || "nicht verbunden";
      hinweis.className = "is-problem";
    } else {
      const andere = Math.max(0, (stand?.peers?.length || 1) - 1);
      hinweis.textContent = andere === 0
        ? "nur du"
        : `${andere} weiteres Gerät${andere === 1 ? "" : "e"}`;
    }
    ueberschrift.append(hinweis);
    kinder.push(ueberschrift);

    if (!karten.length) {
      const leer = document.createElement("p");
      leer.className = "watchparty-room-empty";
      leer.textContent = "Noch nichts eingestellt.";
      kinder.push(leer);
      continue;
    }
    for (const item of karten) kinder.push(watchpartyCard(item));
  }
  return kinder;
}

// Wartet, bis der Raum die Aenderung zurueckgemeldet hat. Ohne das meldet die
// Oberflaeche Erfolg, obwohl die Nachricht ins Leere gehen kann.
function warteAufMitgliedschaft(key, sollDabeiSein, room, timeoutMs = 3000) {
  const passt = () => Boolean(watchpartyEintragImRaum(key, room)?.joined) === sollDabeiSein;
  return new Promise((fertig) => {
    if (passt()) {
      fertig(true);
      return;
    }
    const start = Date.now();
    const timer = window.setInterval(() => {
      if (passt()) {
        window.clearInterval(timer);
        fertig(true);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        window.clearInterval(timer);
        fertig(false);
      }
    }, 120);
  });
}

// Ein Titel kann in mehreren Raeumen stehen - gemeint ist immer der eine.
function watchpartyEintragImRaum(key, room) {
  return watchpartyItems.find((eintrag) => (
    eintrag.key === key && (!room || (eintrag.room || "") === room)
  )) || null;
}

function warteAufEntfernen(key, room, timeoutMs = 3000) {
  return new Promise((fertig) => {
    const weg = () => !watchpartyEintragImRaum(key, room);
    if (weg()) {
      fertig(true);
      return;
    }
    const start = Date.now();
    const timer = window.setInterval(() => {
      if (weg()) {
        window.clearInterval(timer);
        fertig(true);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        window.clearInterval(timer);
        fertig(false);
      }
    }, 120);
  });
}

function watchpartyCard(item) {
  const card = document.createElement("div");
  card.className = "favorite-card watchparty-card";

  // Der Stand kommt aus der Watchparty, sobald jemand Beigetretenes weiterschaut.
  const stand = item.progress;
  const folge = stand?.season && stand?.episode
    ? `Staffel ${stand.season} Folge ${stand.episode}`
    : (item.season && item.episode ? `Staffel ${item.season} Folge ${item.episode}` : "");
  const mitglieder = Array.isArray(item.members) ? item.members : [];
  const zeile = [folge, item.providerName].filter(Boolean).join(" · ");
  // Laeuft gerade jemand, steht der Stand direkt auf der Karte.
  const laufend = stand?.duration
    ? `${formatClock(stand.position)} / ${formatClock(stand.duration)}${stand.from ? ` · ${stand.from}` : ""}`
    : "";

  card.innerHTML = `
    <strong>${escapeHtml(item.title)}</strong>
    <span>${escapeHtml(zeile)}</span>
    ${laufend ? `<span class="watchparty-progress">${escapeHtml(laufend)}</span>` : ""}
  `;
  // Genau hier sah es bisher schlecht aus: ein eigenes Titelbild wurde auf der
  // schmalen Karte mittig gedeckt, und was oben oder unten stand, war weg.
  // Jetzt gilt derselbe Ausschnitt, den der Benutzer gewaehlt hat.
  bildEbeneSetzen(card, item.thumbnail, item.thumbnailCrop || null);

  const mitgliederZeile = document.createElement("div");
  mitgliederZeile.className = "watchparty-members";
  if (!mitglieder.length) {
    mitgliederZeile.textContent = "noch niemand dabei";
  } else {
    // Der Host gibt beim Abgleichen den Takt vor - deshalb steht er dabei.
    // Ueber die Kennung, nicht ueber den Namen: zwei Geraete koennen gleich
    // heissen, und ein Namenstreffer verdeckt, dass man selbst gar nicht
    // dabei ist. Nur wenn das Relay keine Kennung liefert, zaehlt der Name.
    const binHost = item.hostId ? item.hostId === item.myId : Boolean(item.hostName) && item.hostName === item.myName;
    const hostHinweis = item.hostName
      ? `${binHost ? "du bist Host" : `Host: ${item.hostName}`} · `
      : "";
    mitgliederZeile.append(`${hostHinweis}${mitglieder.length} dabei: `);
    mitglieder.forEach((name, index) => {
      const id = item.memberIds?.[index];
      const eigenes = id && id === item.myId;
      mitgliederZeile.append(index ? ", " : "");
      // Wer den Takt vorgibt, kann ihn weitergeben - an jemanden, der bei
      // derselben Folge wirklich mitschaut. Das Relay prueft das noch einmal.
      const binHost = Boolean(item.hostId) && item.hostId === item.myId;
      if (binHost && id && !eigenes) {
        const geben = document.createElement("button");
        geben.type = "button";
        geben.className = "watchparty-handover";
        geben.textContent = "⇧";
        geben.title = `Host an ${name} weitergeben`;
        geben.addEventListener("click", async (event) => {
          event.stopPropagation();
          if (geben.disabled) return;
          geben.disabled = true;
          await api.handoverWatchpartyHost?.(item.key, id, item.room);
          showToast(`Host an ${name} weitergegeben`);
        });
        mitgliederZeile.append(geben);
      }
      // Wer die Serie eingestellt hat, kann andere wieder herauswerfen.
      if (item.mine && id && !eigenes) {
        const werfen = document.createElement("button");
        werfen.type = "button";
        werfen.className = "watchparty-kick";
        werfen.textContent = `${name} ✕`;
        werfen.title = `${name} aus dieser Serie entfernen`;
        werfen.addEventListener("click", async (event) => {
          event.stopPropagation();
          if (werfen.disabled) return;
          werfen.disabled = true;
          await api.kickFromWatchparty(item.key, id, item.room);
          showToast(`${name} entfernt`);
        });
        mitgliederZeile.append(werfen);
      } else {
        mitgliederZeile.append(name);
      }
    });
  }
  card.append(mitgliederZeile);

  const aktionen = document.createElement("div");
  aktionen.className = "watchparty-actions";

  const beitreten = document.createElement("button");
  beitreten.type = "button";
  beitreten.className = item.joined ? "secondary-action" : "primary-action";
  beitreten.textContent = item.joined ? "Verlassen" : "Beitreten";
  beitreten.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (beitreten.disabled) return;
    // Nicht der Stand vom Renderzeitpunkt zaehlt, sondern der aktuelle: sonst
    // schickt ein zweiter Klick dieselbe Aktion noch einmal und schaltet
    // zwischen beigetreten und verlassen hin und her.
    const jetztDabei = Boolean(watchpartyEintragImRaum(item.key, item.room)?.joined);
    beitreten.disabled = true;
    try {
      if (jetztDabei) {
        await api.leaveWatchparty(item.key, item.room);
      } else {
        await api.enterWatchparty(item.key, item.room);
      }
      const bestaetigt = await warteAufMitgliedschaft(item.key, !jetztDabei, item.room);
      if (!bestaetigt) {
        showToast("Der Raum hat nicht geantwortet");
      } else if (jetztDabei) {
        showToast(`„${item.title}“ verlassen`);
      } else {
        showToast(`„${item.title}“ beigetreten — ab jetzt läuft der Fortschritt zusammen`);
      }
    } finally {
      beitreten.disabled = false;
    }
  });
  aktionen.append(beitreten);

  const oeffnen = document.createElement("button");
  oeffnen.type = "button";
  oeffnen.className = "secondary-action";
  oeffnen.textContent = "Öffnen";
  oeffnen.disabled = !item.openable;
  oeffnen.title = item.openable ? "" : "Kein passender Anbieter eingerichtet";
  oeffnen.addEventListener("click", async (event) => {
    event.stopPropagation();
    hideContentViews();
    const state = await api.openWatchpartyItem(item.key, item.room);
    activeProviderId = state?.activeProviderId || activeProviderId;
    setCurrentRoute(`provider:${activeProviderId}`);
    renderProviders();
    window.setTimeout(syncBrowserBounds, 0);
  });
  aktionen.append(oeffnen);

  // Wer eine Serie eingestellt hat, kann sie auch wieder herausnehmen.
  if (item.mine) {
    const entfernen = document.createElement("button");
    entfernen.type = "button";
    entfernen.className = "text-action";
    entfernen.textContent = "Entfernen";
    entfernen.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (entfernen.disabled) return;
      entfernen.disabled = true;
      try {
        await api.removeFromWatchparty(item.key, item.room);
        const weg = await warteAufEntfernen(item.key, item.room);
        showToast(weg ? `„${item.title}“ aus der Watchparty genommen` : "Der Raum hat nicht geantwortet");
      } finally {
        entfernen.disabled = false;
      }
    });
    aktionen.append(entfernen);
  }

  card.append(aktionen);
  return card;
}

async function showHistory() {
  await enterInternalMode();
  setCurrentRoute("history");
  hideContentViews();
  historyView?.classList.remove("is-hidden");
  renderLibraryViews();
  window.setTimeout(syncBrowserBounds, 0);
}

// --- Rueckblick --------------------------------------------------------------
// Gerechnet wird im Hauptprozess, aus den gespeicherten Wiedergabesitzungen.
// Hier wird nur gezeigt - und zwar nur, was wirklich bekannt ist.
//
// Der Zeitraum wird nicht behauptet, sondern benannt: die Ueberschrift richtet
// sich danach, wie weit die Daten reichen. Wer ELFIX seit drei Wochen benutzt,
// liest "Deine Zeit mit ELFIX" und nicht "Dein Jahr 2026".
//
// Und wo nichts gemessen wurde, steht nichts. Eine Karte "0 Stunden" waere
// falsch, wenn die Wahrheit "unbekannt" lautet - solche Karten fallen weg und
// die Seite sagt einmal, ab wann gemessen wird.

let reviewZeitraum = "";

const WOCHENTAGE = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"];

function reviewDatum(tag, mitJahr = true) {
  const teile = String(tag || "").slice(0, 10).split("-");
  if (teile.length !== 3) return "";
  return `${Number(teile[2])}. ${MONATE[Number(teile[1]) - 1] || ""}${mitJahr ? " " + teile[0] : ""}`;
}

// Stunden und Minuten, wie man sie sagt. Sekunden sind hier belanglos, und
// "3,7 Stunden" liest niemand gern.
function reviewDauer(sekunden) {
  const gesamt = Math.max(0, Math.round(Number(sekunden) || 0));
  const stunden = Math.floor(gesamt / 3600);
  const minuten = Math.round((gesamt % 3600) / 60);
  if (!stunden) return `${minuten} min`;
  return minuten ? `${stunden} h ${minuten} min` : `${stunden} h`;
}

async function showReview() {
  await enterInternalMode();
  setCurrentRoute("review");
  hideContentViews();
  reviewView?.classList.remove("is-hidden");
  await renderReview();
  window.setTimeout(syncBrowserBounds, 0);
}

async function renderReview() {
  const koerper = document.querySelector("#reviewBody");
  const leer = document.querySelector("#reviewEmpty");
  const titel = document.querySelector("#reviewTitle");
  const spanne = document.querySelector("#reviewSpan");
  const leiste = document.querySelector("#reviewYears");
  if (!koerper) return;

  const antwort = await api.getReview?.(reviewZeitraum).catch(() => null);
  const daten = antwort?.daten || null;
  const zeitraeume = Array.isArray(antwort?.zeitraeume) ? antwort.zeitraeume : [];
  reviewZeitraum = antwort?.gewaehlt || reviewZeitraum;

  const etwasDa = Boolean(daten && daten.sitzungen);
  leer?.classList.toggle("is-hidden", etwasDa);
  koerper.classList.toggle("is-hidden", !etwasDa);
  if (!etwasDa) {
    koerper.replaceChildren();
    leiste?.classList.add("is-hidden");
    if (titel) titel.textContent = "Rückblick";
    if (spanne) spanne.textContent = "Sobald du etwas geschaut hast, entsteht hier deine Bilanz.";
    return;
  }

  if (leiste) {
    leiste.classList.toggle("is-hidden", zeitraeume.length < 2);
    leiste.replaceChildren(...(zeitraeume.length < 2 ? [] : zeitraeume.map((eintrag) => {
      const knopf = document.createElement("button");
      knopf.type = "button";
      knopf.className = `calendar-day${eintrag.wert === reviewZeitraum ? " is-active" : ""}`;
      knopf.textContent = eintrag.titel;
      knopf.addEventListener("click", () => {
        reviewZeitraum = eintrag.wert;
        renderReview().catch(() => {});
      });
      return knopf;
    })));
  }

  if (titel) titel.textContent = reviewUeberschrift(daten, reviewZeitraum);
  if (spanne) {
    spanne.textContent = daten.von
      ? `${reviewDatum(daten.von, false)} bis ${reviewDatum(daten.bis)} · an ${daten.tage} ${daten.tage === 1 ? "Tag" : "Tagen"} lief etwas`
      : "In diesem Zeitraum lief nichts.";
  }

  koerper.replaceChildren(...reviewAbschnitte(daten));
  renderWrappedArchiv().catch(() => {});
}

// Wie der Zeitraum heisst. Ein Kalenderjahr wird als solches benannt, alles
// andere nach seiner tatsaechlichen Laenge - drei Wochen Nutzung sind kein
// Jahresrueckblick, auch wenn sie in einem Jahr liegen.
function reviewUeberschrift(daten, zeitraum) {
  if (/^\d{4}$/.test(String(zeitraum))) {
    const tage = reviewSpannweite(daten);
    return tage >= 90 ? `Dein Jahr ${zeitraum}` : `Dein ELFIX-Rückblick · ${zeitraum}`;
  }
  if (zeitraum === "7tage") return "Deine letzten 7 Tage";
  if (zeitraum === "30tage") return "Deine letzten 30 Tage";
  if (zeitraum === "monat") return "Dieser Monat";
  const tage = reviewSpannweite(daten);
  return tage >= 300 ? "Deine Zeit mit ELFIX" : "Dein ELFIX-Rückblick";
}

function reviewSpannweite(daten) {
  const von = Date.parse(daten?.von || "");
  const bis = Date.parse(daten?.bis || "");
  if (!Number.isFinite(von) || !Number.isFinite(bis)) return 0;
  return Math.round((bis - von) / 86400000) + 1;
}

function reviewAbschnitte(daten) {
  const stuecke = [];
  const zeitBekannt = daten.sekundenBekannt > 0 && daten.sekunden > 0;

  // Die grossen Zahlen zuerst. Die Watchtime steht nur dabei, wenn sie
  // gemessen wurde - sonst faellt die Kachel weg statt eine Null zu zeigen.
  const kopf = document.createElement("div");
  kopf.className = "review-hero";
  kopf.append(
    reviewGross(daten.folgen, daten.folgen === 1 ? "Folge" : "Folgen"),
    reviewGross(daten.folgenAbgeschlossen, "abgeschlossen")
  );
  if (zeitBekannt) kopf.append(reviewGross(reviewDauer(daten.sekunden), "geschaut"));
  stuecke.push(kopf);

  // Der ehrliche Hinweis, sobald ein Teil der Saetze keine gemessene Zeit hat.
  if (daten.sekundenBekannt < daten.sekundenGesamt) {
    const hinweis = document.createElement("p");
    hinweis.className = "review-note";
    hinweis.textContent = zeitBekannt
      ? `Wiedergabezeit ist für ${daten.sekundenBekannt} von ${daten.sekundenGesamt} Einträgen gemessen — ältere stammen aus dem Verlauf und tragen keine Zeit.`
      : "Wiedergabezeit wird erst seit dieser Version gemessen. Was hier steht, stammt aus dem bisherigen Verlauf: Folgen und Tage sind belegt, Stunden nicht.";
    stuecke.push(hinweis);
  }

  const kacheln = document.createElement("div");
  kacheln.className = "review-tiles";
  kacheln.append(reviewKachel(daten.tage, daten.tage === 1 ? "Tag geschaut" : "Tage geschaut"));
  kacheln.append(reviewKachel(daten.strecke.tage, "Tage am Stück",
    daten.strecke.von ? `${reviewDatum(daten.strecke.von, false)} bis ${reviewDatum(daten.strecke.bis, false)}` : ""));
  if (daten.laufendeStrecke > 0) {
    kacheln.append(reviewKachel(daten.laufendeStrecke, "Tage aktuell am Stück"));
  }
  if (daten.folgenJeTag > 0) {
    kacheln.append(reviewKachel(daten.folgenJeTag, "Folgen je Schautag"));
  }
  if (daten.wiederholungen > 0) {
    kacheln.append(reviewKachel(daten.wiederholungen, "Wiederholungen"));
    // Die zweite Zahl daneben, weil die erste allein nicht zu lesen ist:
    // dreissig Wiederholungen sind eine durchgeschaute Lieblingsserie oder
    // dreissig einzelne Folgen aus dreissig Serien.
    if (daten.wiederholteTitel > 1) {
      kacheln.append(reviewKachel(daten.wiederholteTitel, "Titel wiedergesehen"));
    }
  }
  if (zeitBekannt && daten.laengsteSitzung > 0) {
    kacheln.append(reviewKachel(reviewDauer(daten.laengsteSitzung), "längste Sitzung"));
    kacheln.append(reviewKachel(reviewDauer(daten.sitzungsschnitt), "Sitzung im Schnitt"));
  }
  if (daten.aktivsterTag) {
    kacheln.append(reviewKachel(
      daten.aktivsterTag.sekunden > 0 ? reviewDauer(daten.aktivsterTag.sekunden) : daten.aktivsterTag.folgen,
      daten.aktivsterTag.sekunden > 0 ? "stärkster Tag" : "Folgen am stärksten Tag",
      reviewDatum(daten.aktivsterTag.tag)));
  }
  if (daten.aktivsterWochentag) {
    kacheln.append(reviewKachel(WOCHENTAGE[daten.aktivsterWochentag.tag] || "—", "liebster Wochentag",
      daten.aktivsterWochentag.sekunden > 0
        ? reviewDauer(daten.aktivsterWochentag.sekunden)
        : `${daten.aktivsterWochentag.folgen} Folgen`));
  }
  stuecke.push(kacheln);

  stuecke.push(...reviewBalken("Deine Genres",
    daten.genres.map((genre) => ({
      name: genre.label,
      wert: zeitBekannt && genre.sekunden > 0 ? genre.sekunden : genre.titel,
      anzeige: zeitBekannt && genre.sekunden > 0 ? reviewDauer(genre.sekunden) : `${genre.titel}`
    })),
    zeitBekannt
      ? "Läuft ein Titel unter mehreren Genres, wird seine Zeit anteilig verteilt — sonst zählte eine Stunde dreifach."
      : "Gezählt werden Titel, solange keine Wiedergabezeit gemessen ist."));

  stuecke.push(...reviewTitelliste("Deine meistgesehenen Serien", daten.serien, zeitBekannt));
  stuecke.push(...reviewTitelliste("Deine Filme", daten.filme, zeitBekannt));

  // YouTube steht fuer sich - und zwar mit einem Satz dazu, warum.
  //
  // Ohne ihn faende jemand seine Stunde YouTube in der Gesamtzeit nicht wieder
  // und hielte die Statistik fuer kaputt. Sie ist es nicht: ein Reaktionsvideo
  // ist keine Serienfolge, und beides in einem Topf verschiebt jede Zahl
  // daneben - Genres, Folgen, staerkster Tag, Serie des Jahres.
  const videos = daten.videos;
  if (videos && videos.videos > 0) {
    stuecke.push(...reviewTitelliste("Deine YouTube-Videos", videos.liste, zeitBekannt));
    const fuss = document.createElement("p");
    fuss.className = "review-note";
    const dauer = videos.sekunden > 0 ? reviewDauer(videos.sekunden) : "";
    const anzahl = `${videos.videos} ${videos.videos === 1 ? "Video" : "Videos"}`;
    const tage = videos.tage > 0
      ? ` an ${videos.tage} ${videos.tage === 1 ? "Tag" : "Tagen"}`
      : "";
    fuss.textContent = dauer
      ? `${anzahl}${tage}, zusammen ${dauer}. Zählt eigens und ist in keiner Zahl oben enthalten.`
      : `${anzahl}${tage}. Zählt eigens und ist in keiner Zahl oben enthalten.`;
    stuecke.push(fuss);
  }
  if (daten.wiederholteste.length) {
    stuecke.push(...reviewTitelliste("Am häufigsten wiederholt", daten.wiederholteste, zeitBekannt, "wiederholungen"));
  }
  return stuecke;
}

function reviewGross(wert, label) {
  const block = document.createElement("div");
  block.className = "review-big";
  const zahl = document.createElement("strong");
  zahl.textContent = String(wert);
  const name = document.createElement("span");
  name.textContent = label;
  block.append(zahl, name);
  return block;
}

function reviewKachel(wert, oben, unten = "") {
  const kachel = document.createElement("div");
  kachel.className = "review-tile";
  const zahl = document.createElement("strong");
  zahl.textContent = String(wert);
  const label = document.createElement("span");
  label.textContent = oben;
  kachel.append(zahl, label);
  if (unten) {
    const klein = document.createElement("small");
    klein.textContent = unten;
    kachel.append(klein);
  }
  return kachel;
}

// Balken statt Zahlenreihe: die Frage ist die Verteilung, nicht der Betrag.
// Gemessen wird am groessten Wert, nicht an der Summe - ein Titel zaehlt in
// mehreren Genres, eine Prozentangabe waere hier schlicht falsch.
function reviewBalken(ueberschrift, werte, fussnote) {
  const brauchbar = werte.filter((eintrag) => eintrag.wert > 0);
  if (!brauchbar.length) return [];
  const kopf = document.createElement("h2");
  kopf.className = "review-head";
  kopf.textContent = ueberschrift;

  const liste = document.createElement("div");
  liste.className = "review-bars";
  const groesster = Math.max(...brauchbar.map((eintrag) => eintrag.wert), 1);
  for (const eintrag of brauchbar) {
    const zeile = document.createElement("div");
    zeile.className = "review-bar";
    const name = document.createElement("span");
    name.textContent = eintrag.name;
    const schiene = document.createElement("div");
    schiene.className = "review-bar-rail";
    const fuellung = document.createElement("div");
    fuellung.className = "review-bar-fill";
    fuellung.style.width = `${Math.round((eintrag.wert / groesster) * 100)}%`;
    schiene.append(fuellung);
    const zahl = document.createElement("small");
    zahl.textContent = eintrag.anzeige;
    zeile.append(name, schiene, zahl);
    liste.append(zeile);
  }
  const stuecke = [kopf, liste];
  if (fussnote) {
    const hinweis = document.createElement("p");
    hinweis.className = "review-note";
    hinweis.textContent = fussnote;
    stuecke.push(hinweis);
  }
  return stuecke;
}

/**
 * Der Bildplatz einer Statistikzeile - immer da, auch ohne Bild.
 *
 * <p><b>Warum das ein Fehler war.</b> Hier stand {@code if (eintrag.bild)}, und
 * ohne Bild entstand *gar kein* Element. Die Zeile verlor damit ihren
 * Bildplatz, Titel und Anbieter rutschten nach links und standen auf einer
 * Linie - eine Zeile, die anders aussieht als alle anderen, ohne dass ihr
 * anzusehen waere, warum.
 *
 * <p>Und der Grund ist einer, der oefter vorkommt, als es scheint: das Bild
 * kommt aus dem Eintrag der Ablage, die Zeile aus den Sitzungen. Wer einen
 * Titel aus der Mediathek loescht, behaelt seine Sitzungen - so soll es sein,
 * die Statistik vergisst nichts. Nur hat dieser Titel dann kein Bild mehr.
 * "Horse Camp - Sommer der Abenteuer" war genau das: vier Sitzungen, kein
 * Eintrag mehr.
 *
 * <p>Statt eines Lochs steht jetzt derselbe gestaltete Platzhalter wie auf den
 * Karten - die Anfangsbuchstaben. Und ein Bild, das sich nicht laden laesst,
 * faellt einmal auf ihn zurueck; ein zweites Mal kann es nicht, weil der
 * Horcher sich dabei selbst abmeldet.
 */
function reviewPoster(eintrag) {
  const kuerzel = String(eintrag?.titel || "?")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((wort) => wort[0] || "")
    .join("")
    .toUpperCase() || "?";

  const platzhalter = document.createElement("div");
  platzhalter.className = "review-poster review-poster-leer";
  platzhalter.textContent = kuerzel;
  if (!eintrag?.bild) return platzhalter;

  const bild = document.createElement("img");
  bild.className = "review-poster";
  bild.src = eintrag.bild;
  bild.alt = "";
  bild.loading = "lazy";
  bild.addEventListener("error", function beiFehler() {
    bild.removeEventListener("error", beiFehler);
    bild.replaceWith(platzhalter);
  });
  return bild;
}

function reviewTitelliste(ueberschrift, eintraege, zeitBekannt, schluessel = "sekunden") {
  const brauchbar = (eintraege || []).filter((eintrag) => eintrag && eintrag.titel);
  if (!brauchbar.length) return [];
  const kopf = document.createElement("h2");
  kopf.className = "review-head";
  kopf.textContent = ueberschrift;

  const liste = document.createElement("div");
  liste.className = "review-list";
  for (const eintrag of brauchbar) {
    const zeile = document.createElement("div");
    zeile.className = "review-row";
    zeile.append(reviewPoster(eintrag));
    const name = document.createElement("strong");
    name.textContent = eintrag.titel;
    const meta = document.createElement("span");
    meta.className = "review-row-meta";
    meta.textContent = eintrag.anbieter || "";
    const wert = document.createElement("small");
    if (schluessel === "wiederholungen") {
      wert.textContent = `${eintrag.wiederholungen}×`;
    } else {
      wert.textContent = zeitBekannt && eintrag.sekunden > 0
        ? reviewDauer(eintrag.sekunden)
        : `${eintrag.folgen} ${eintrag.folgen === 1 ? "Folge" : "Folgen"}`;
    }
    zeile.append(name, meta, wert);
    liste.append(zeile);
  }
  return [kopf, liste];
}

// --- ELFIX Wrapped -----------------------------------------------------------
//
// Die Statistikseite ist zum Nachschlagen, das hier ist zum Ansehen. Deshalb
// eine Folge einzelner Bilder statt einer Tabelle: wenig Text, eine Aussage je
// Seite, grosse Zahlen.
//
// Gerechnet wird hier nichts. Alle Zahlen stammen aus derselben Auswertung, die
// auch die Statistikseite speist - waeren es zwei Rechenwege, stuenden
// irgendwann zwei verschiedene Folgenzahlen fuer dasselbe Jahr da, und keiner
// waere zu widerlegen.
//
// Jede Seite kennt ihre Bedingung. Fehlt die Grundlage - keine gemessene Zeit,
// keine Wiederholungen, kein Film -, faellt sie aus. Ein Wrapped mit zwoelf
// Seiten, von denen fuenf "0" zeigen, waere schlechter als eines mit sieben.

let wrappedSeiten = [];
let wrappedStelle = 0;
let wrappedJahr = 0;

const WRAPPED_TAGESZEIT = {
  nacht: { name: "Nachteule", satz: "zwischen 22 und 4 Uhr" },
  morgen: { name: "Frühaufsteher", satz: "zwischen 4 und 12 Uhr" },
  nachmittag: { name: "Nachmittagsmensch", satz: "zwischen 12 und 18 Uhr" },
  abend: { name: "Abendmensch", satz: "zwischen 18 und 22 Uhr" }
};

function wrappedZahl(wert) {
  return Number(wert || 0).toLocaleString("de-DE");
}

// Ob ueberhaupt bewegt werden darf. Zwei Quellen, beide gelten: die Einstellung
// in ELFIX und die Systemvorgabe des Betriebssystems.
function wrappedRuhig() {
  if (document.querySelector(".app-shell")?.classList.contains("animations-off")) return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}

// Gibt zurueck, ob der Rueckblick wirklich aufgegangen ist. Daran haengt der
// Eintrag in der Seitenleiste: geht er nicht auf, fuehrt der Klick auf die
// Statistikseite statt ins Leere.
async function wrappedOeffnen(jahr) {
  const antwort = await api.getWrapped?.(jahr).catch(() => null);
  if (!antwort?.daten) {
    showToast("Für dieses Jahr gibt es noch zu wenig zu erzählen");
    return false;
  }
  wrappedJahr = antwort.jahr;
  wrappedSeiten = await wrappedSortieren(wrappedBauen(antwort.daten, antwort.jahr), antwort.jahr);
  wrappedStelle = 0;
  await api.setWrappedOpen?.(true);
  wrappedModal?.showModal();
  wrappedZeigen(0);
  // Gesehen ist gesehen: der Hinweis auf der Startseite verschwindet, und im
  // Dezember draengt sich nichts ein zweites Mal auf.
  api.markWrappedSeen?.(antwort.jahr).then(() => renderWrappedHinweis()).catch(() => {});
  return true;
}

// Die Karten in die Reihenfolge dieses Jahres bringen.
//
// Gebaut werden sie in der Folge, in der sie im Quelltext stehen - und genau
// das war das Problem: damit sah 2027 aus wie 2026 und 2026 wie 2025.
// Dieselben Karten, dieselbe Folge, nur andere Zahlen darauf; einen
// Jahresrueckblick, den man schon kennt, bevor man ihn aufmacht, macht man
// kein zweites Mal auf.
//
// Welche Karten in welcher Folge kommen, entscheidet die geteilte Regel im
// Kern (statistik.wrappedReihenfolge) und nicht diese Stelle - der Fernseher
// fragt dieselbe. Faellt sie aus, bleibt es bei der gebauten Reihenfolge: ein
// Rueckblick in immer derselben Folge ist schlechter als einer, aber besser
// als keiner.
async function wrappedSortieren(seiten, jahr) {
  const schluessel = seiten.map((seite) => seite.schluessel).filter(Boolean);
  const ordnung = await api.getWrappedReihenfolge?.(schluessel, jahr).catch(() => null);
  if (!Array.isArray(ordnung) || !ordnung.length) return seiten;
  const nachSchluessel = new Map(seiten.map((seite) => [seite.schluessel, seite]));
  const sortiert = ordnung.map((k) => nachSchluessel.get(k)).filter(Boolean);
  return sortiert.length ? sortiert : seiten;
}

function wrappedSchliessen() {
  wrappedTonBeenden();
  wrappedModal?.close();
  api.setWrappedOpen?.(false);
}

// --- Die Musik zu den Karten ------------------------------------------------
//
// Der Rueckblick war stumm. Zwei Entscheidungen stecken in der Musik, und die
// zweite ist die wichtigere.
//
// **Woher.** ELFIX hat keinen Ton: nichts im Paket, keine Tonspur ausser der
// des Anbieters. Mitliefern scheidet aus, versteckt bei YouTube abspielen
// hiesse Werbung vor dem Opening. Geholt wird es deshalb bei animethemes.moe,
// einem Katalog der Vor- und Abspaenne von Anime.
//
// **Zu welcher Karte.** Zuerst lief sie nur zur Serie des Jahres, und zwar aus
// Sorge um die Pointe: das Titelbild musste weichen, weil es auf Karte eins
// verriet, worauf der ganze Rueckblick hinauslaeuft ("dann weiss man ja schon
// was man als serie hat"), und Musik verraet dasselbe, nur akustisch.
//
// Diese Sorge trifft aber nur Musik zu einer Karte, die noch gar nicht dran
// ist. Deshalb spielt jetzt jede Karte den Titel, von dem sie selbst handelt -
// die Serie des Jahres, der erste und der letzte Titel des Jahres, der am
// oeftesten wiederholte. Was zu hoeren ist, steht dabei gleichzeitig gross auf
// dem Schirm; vorweg nehmen kann es also nichts.
//
// Karten mit blossen Zahlen haben keinen Titel und wechseln deshalb nichts:
// dort laeuft weiter, was gerade laeuft. Sonst risse der Ton zwischen zwei
// Titelkarten jedes Mal ab, und der Rueckblick klaenge wie ein Sender, der
// staendig umschaltet.
//
// Der Ton kommt nie ungefragt und nie ohne Ausweg: der Knopf oben rechts
// schaltet ihn ab - und dann bleibt er auch auf den folgenden Karten aus, denn
// wer ihn abschaltet, meint nicht nur dieses eine Lied -, die Einstellung
// schaltet ihn ganz aus, und das Schliessen des Rueckblicks beendet ihn.
// Bleibt die Suche ohne Treffer - kein Anime, kein Netz, kein Eintrag im
// Katalog -, bleibt es bei dem, was schon lief.
const WRAPPED_TON_LAUT = 0.45;
let wrappedTonLaeuft = false;
let wrappedTonTreffer = null;
// Der Titel, nach dem zuletzt gefragt wurde. Ohne ihn wuerde dieselbe Karte
// beim Zurueckblaettern ihr Lied von vorn anfangen.
let wrappedTonGesucht = "";
// Vom Benutzer abgeschaltet. Gilt fuer den Rest des Rueckblicks und nicht nur
// fuer die Karte, auf der er den Knopf gedrueckt hat.
let wrappedTonAus = false;
// Laufende Nummer der letzten Anfrage: wer schnell blaettert, hat mehrere
// unterwegs, und ankommen darf nur die zur Karte, die jetzt dasteht.
let wrappedTonWunsch = 0;

function wrappedTonElement() {
  return document.querySelector("#wrappedTon");
}

function wrappedTonBeenden() {
  const ton = wrappedTonElement();
  if (ton) {
    ton.pause();
    ton.removeAttribute("src");
    ton.load();
  }
  wrappedTonLaeuft = false;
  wrappedTonTreffer = null;
  wrappedTonGesucht = "";
  wrappedTonAus = false;
  wrappedTonWunsch += 1;
  document.querySelector("#wrappedTonKnopf")?.classList.add("is-hidden");
}

// Am Knopf steht, was laeuft - und aus welchem Anime.
//
// Der Anime gehoert dazu, weil die Zuordnung nicht mit blossem Auge nachzuvoll-
// ziehen ist: der Katalog fuehrt "Attack on Titan" als "Shingeki no Kyojin"
// und den englischen Titel nur als Zweitnamen. Getroffen wird also ueber einen
// Namen, der auf der Karte gar nicht steht. Wer am Knopf etwas anderes liest,
// als er erwartet hat, sieht sofort, dass danebengegriffen wurde - statt sich
// ueber ein fremdes Lied zu wundern.
function wrappedTonKnopfZeigen(an, treffer) {
  const knopf = document.querySelector("#wrappedTonKnopf");
  if (!knopf) return;
  knopf.classList.remove("is-hidden");
  knopf.classList.toggle("is-aus", !an);
  knopf.textContent = an ? "♪" : "✕";
  const stueck = [treffer?.lied, treffer?.anime].filter(Boolean).join(" — ");
  knopf.title = [stueck, an ? "Musik aus" : "Musik an"].filter(Boolean).join(" · ");
  knopf.setAttribute("aria-label", knopf.title);
}

// Ein Wechsel mitten im Blaettern soll nicht knallen: das neue Stueck kommt
// ueber eine halbe Sekunde herauf, statt sofort in voller Lautstaerke ueber
// dem vorigen zu stehen.
function wrappedTonAufblenden(ton) {
  const start = performance.now();
  ton.volume = 0;
  const schritt = (jetzt) => {
    if (ton.paused) { ton.volume = WRAPPED_TON_LAUT; return; }
    const anteil = Math.min(1, (jetzt - start) / 500);
    ton.volume = WRAPPED_TON_LAUT * anteil;
    if (anteil < 1) requestAnimationFrame(schritt);
  };
  requestAnimationFrame(schritt);
}

// Startet die Musik zu der Karte, die gerade aufgeht - und wechselt sie, wenn
// die naechste Karte von einem anderen Titel handelt.
async function wrappedTonStarten(seite) {
  const quelle = seite?.musik;
  // Eine Karte ohne Titel wechselt nichts.
  if (!quelle?.titel) return;
  if (settings.wrapped?.musik === false || wrappedTonAus) return;
  const ton = wrappedTonElement();
  if (!ton) return;
  // Derselbe Titel wie zuletzt: nicht von vorn anfangen.
  if (quelle.titel === wrappedTonGesucht) return;
  wrappedTonGesucht = quelle.titel;
  const nummer = ++wrappedTonWunsch;

  const treffer = await api.getWrappedOpening?.(quelle.titel, quelle.gattung).catch(() => null);
  // Zwischenzeitlich weitergeblaettert, abgeschaltet oder geschlossen? Dann
  // gehoert dieses Stueck nirgends mehr hin.
  if (nummer !== wrappedTonWunsch || wrappedTonAus || !wrappedModal?.open) return;
  // Kein Treffer heisst nicht Stille: was lief, laeuft weiter.
  if (!treffer?.url) return;
  // Zwei Karten koennen dasselbe Stueck meinen - die Serie des Jahres ist oft
  // auch die am oeftesten wiederholte. Dann laeuft es weiter.
  if (wrappedTonLaeuft && treffer.url === wrappedTonTreffer?.url) return;

  wrappedTonLaeuft = true;
  wrappedTonTreffer = treffer;
  ton.src = treffer.url;
  ton.loop = true;
  ton.volume = 0;
  try {
    await ton.play();
    wrappedTonAufblenden(ton);
    wrappedTonKnopfZeigen(true, treffer);
  } catch {
    // Chromium laesst Ton ohne Zutun des Benutzers nicht immer zu. Dann steht
    // der Knopf da und wartet - besser als ein Rueckblick, der still bleibt,
    // ohne zu sagen, dass es etwas zu hoeren gaebe.
    wrappedTonLaeuft = false;
    ton.volume = WRAPPED_TON_LAUT;
    wrappedTonKnopfZeigen(false, treffer);
  }
}

async function wrappedTonUmschalten() {
  const ton = wrappedTonElement();
  if (!ton || !ton.src) return;
  if (ton.paused) {
    try {
      await ton.play();
      ton.volume = WRAPPED_TON_LAUT;
      wrappedTonLaeuft = true;
      wrappedTonAus = false;
      wrappedTonKnopfZeigen(true, wrappedTonTreffer);
    } catch { /* Bleibt eben aus. */ }
  } else {
    ton.pause();
    wrappedTonLaeuft = false;
    // Aus heisst aus: die naechste Karte faengt nicht ungefragt wieder an.
    wrappedTonAus = true;
    wrappedTonKnopfZeigen(false, wrappedTonTreffer);
  }
}

function wrappedZeigen(stelle) {
  const buehne = document.querySelector("#wrappedStage");
  if (!buehne || !wrappedSeiten.length) return;
  wrappedStelle = Math.max(0, Math.min(wrappedSeiten.length - 1, stelle));
  const seite = wrappedSeiten[wrappedStelle];
  buehne.replaceChildren(seite.knoten);
  buehne.className = `wrapped-stage ${seite.art || ""}`;
  // Neu angehaengt heisst: die Einblendung laeuft von vorn. Ohne das saehe man
  // beim Zurueckblaettern eine Seite, die schon fertig eingeblendet ist.
  if (!wrappedRuhig()) {
    seite.knoten.classList.remove("is-da");
    requestAnimationFrame(() => seite.knoten.classList.add("is-da"));
    wrappedZaehlenStarten(seite.knoten);
  } else {
    seite.knoten.classList.add("is-da");
  }
  renderWrappedPunkte();
  wrappedTonStarten(seite).catch(() => {});
}

// Zahlen laufen hoch. Kurz und ohne Bibliothek: eine Schleife ueber
// requestAnimationFrame, die nach 900 Millisekunden beim echten Wert steht.
function wrappedZaehlenStarten(wurzel) {
  for (const knoten of wurzel.querySelectorAll?.("[data-zaehl]") || []) {
    const ziel = Number(knoten.dataset.zaehl) || 0;
    if (!ziel) continue;
    const start = performance.now();
    const dauer = 900;
    const schritt = (jetzt) => {
      const anteil = Math.min(1, (jetzt - start) / dauer);
      // Zum Ende hin langsamer - sonst wirkt der Stopp wie ein Abbruch.
      const weich = 1 - Math.pow(1 - anteil, 3);
      knoten.textContent = wrappedZahl(Math.round(ziel * weich));
      if (anteil < 1) requestAnimationFrame(schritt);
    };
    requestAnimationFrame(schritt);
  }
}

function renderWrappedPunkte() {
  const leiste = document.querySelector("#wrappedDots");
  if (!leiste) return;
  leiste.replaceChildren(...wrappedSeiten.map((_, i) => {
    const punkt = document.createElement("button");
    punkt.type = "button";
    punkt.className = `wrapped-dot${i === wrappedStelle ? " is-active" : ""}`;
    punkt.setAttribute("aria-label", `Seite ${i + 1}`);
    punkt.addEventListener("click", (event) => { event.stopPropagation(); wrappedZeigen(i); });
    return punkt;
  }));
  document.querySelector("#wrappedPrev")?.classList.toggle("is-hidden", wrappedStelle === 0);
  document.querySelector("#wrappedNext")?.classList.toggle("is-hidden", wrappedStelle >= wrappedSeiten.length - 1);
}

// --- Die Seiten --------------------------------------------------------------

// Kein Titelbild hinter den Karten.
//
// Es lag einmal je Karte ein anderes dahinter, dann - gegen die Unruhe, die
// das machte - ueberall dasselbe: das Poster der Serie des Jahres. Beides war
// falsch, und der zweite Versuch schlimmer als der erste.
//
// "Dann weiss man ja schon, was man als Serie hat." Die Karte "Deine Serie des
// Jahres" ist die Pointe des ganzen Rueckblicks, und ein weichgezeichnetes
// Poster auf Karte eins nimmt sie vorweg. Wer Attack on Titan geschaut hat,
// erkennt Attack on Titan auch verwaschen - das Bild war stark genug, um die
// Stimmung zu tragen, also stark genug, um zu verraten.
//
// Jetzt traegt die Buehne nur ihren eigenen Verlauf. Der ist auf jeder Karte
// derselbe, kostet nichts und verraet nichts; die Poster stehen weiterhin auf
// den Karten, die von einem Titel handeln - dort, wo sie hingehoeren, und wo
// sie nach diesem Umbau sogar mehr auffallen, weil nichts mehr dagegen
// anlaeuft.

// `musik` ist der Titel, von dem die Karte handelt - daran haengt, was zu ihr
// laeuft. Karten mit blossen Zahlen haben keinen und lassen den Ton in Ruhe.
function wrappedSeite(schluessel, art, teile, musik = null) {
  const knoten = document.createElement("div");
  knoten.className = "wrapped-card";
  const inhalt = document.createElement("div");
  inhalt.className = "wrapped-content";
  inhalt.append(...teile.filter(Boolean));
  knoten.append(inhalt);
  return { schluessel, art, knoten, musik };
}

// Woher die Musik einer Karte kommt: aus dem Titel, den sie zeigt.
//
// Filme bleiben aussen vor. Der Katalog dahinter kennt nur Anime, und zu einem
// Film faende die Suche hoechstens etwas Fremdes - ein Opening, das mit dem
// Film nichts zu tun hat, ist schlechter als Stille.
function wrappedMusikQuelle(eintrag) {
  if (!eintrag?.titel || eintrag.gattung === "film") return null;
  return { titel: eintrag.titel, gattung: eintrag.gattung || "" };
}

function wrappedText(klasse, inhalt) {
  const knoten = document.createElement(klasse === "wrapped-huge" ? "strong" : "p");
  knoten.className = klasse;
  knoten.textContent = inhalt;
  return knoten;
}

// Eine grosse Zahl, die hochlaeuft. Der Wert steht im Datenfeld, damit die
// Animation ihn kennt und der Text auch ohne sie stimmt.
// Die Zahl steht in einem eigenen Feld, und das ist kein Schoenheitsfehler,
// sondern der Grund, warum ueberhaupt etwas dastand:
//
// Die Zaehlanimation schreibt bei jedem Bild den Textinhalt ihres Knotens neu.
// Trug derselbe Knoten auch die Einheit, war die nach dem ersten Bild weg -
// auf dem Schirm stand "25" statt "25 Stunden" und "200" statt "200 Folgen",
// und die Karte behauptete nicht mehr, wovon sie handelt. Sichtbar war das nur
// mit Animation; wer sie aus hat, sah die Einheit weiterhin.
function wrappedGrosseZahl(wert, einheit = "") {
  const knoten = document.createElement("strong");
  knoten.className = "wrapped-huge";
  const zahl = document.createElement("span");
  zahl.className = "wrapped-wert";
  if (typeof wert === "number") {
    zahl.dataset.zaehl = String(wert);
    zahl.textContent = wrappedZahl(wert);
  } else {
    zahl.textContent = String(wert);
  }
  knoten.append(zahl);
  if (einheit) {
    const klein = document.createElement("span");
    klein.className = "wrapped-unit";
    klein.textContent = einheit;
    knoten.append(klein);
  }
  return knoten;
}

function wrappedBauen(daten, jahr) {
  const seiten = [];
  const zeitBekannt = daten.sekundenBekannt > 0 && daten.sekunden > 0;
  const topSerie = daten.serien[0] || null;
  const topFilm = daten.filme[0] || null;

  // 1 - Auftakt. Der Zeitraum steht hier und nirgends sonst: er ist die
  // Einschraenkung, unter der alles Folgende gilt.
  seiten.push(wrappedSeite("auftakt", "is-auftakt", [
    wrappedText("wrapped-eyebrow", "ELFIX Wrapped"),
    wrappedText("wrapped-title", String(jahr)),
    wrappedText("wrapped-lead", wrappedAuftakt(daten, jahr)),
    wrappedZeitraumHinweis(daten, jahr)
  ]));

  // 2 - Watchtime. Faellt aus, solange nichts gemessen wurde.
  if (zeitBekannt) {
    const stunden = Math.round(daten.sekunden / 3600);
    const tage = Math.round(daten.sekunden / 86400 * 10) / 10;
    seiten.push(wrappedSeite("zeit", "is-zeit", [
      wrappedGrosseZahl(stunden, "Stunden"),
      wrappedText("wrapped-lead", "hast du dieses Jahr mit ELFIX geschaut."),
      tage >= 1
        ? wrappedText("wrapped-sub",
          `Das sind ${String(tage).replace(".", ",")} ${tage === 1 ? "Tag" : "Tage"} am Stück.`)
        : null
    ]));
  }

  // 3 - Folgen
  if (daten.folgen > 0) {
    seiten.push(wrappedSeite("folgen", "is-folgen", [
      wrappedGrosseZahl(daten.folgen, daten.folgen === 1 ? "Folge" : "Folgen"),
      wrappedText("wrapped-lead", `hast du ${jahr} angesehen.`),
      daten.folgenJeTag > 0
        ? wrappedText("wrapped-sub", `Im Schnitt ${String(daten.folgenJeTag).replace(".", ",")} an jedem Schautag.`)
        : null
    ]));
  }

  // 4/5/6 - Abgeschlossenes, je Gattung und nur wenn es etwas gibt.
  if (daten.abschluesse.serie > 0) {
    seiten.push(wrappedSeite("serien", "is-serien", [
      wrappedGrosseZahl(daten.abschluesse.serie, daten.abschluesse.serie === 1 ? "Serie" : "Serien"),
      wrappedText("wrapped-lead", "hast du abgeschlossen.")
    ]));
  }
  if (daten.abschluesse.film > 0) {
    seiten.push(wrappedSeite("filme", "is-filme", [
      wrappedGrosseZahl(daten.abschluesse.film, daten.abschluesse.film === 1 ? "Film" : "Filme"),
      wrappedText("wrapped-lead", "hast du abgeschlossen.")
    ]));
  }
  if (daten.abschluesse.anime > 0) {
    seiten.push(wrappedSeite("anime", "is-anime", [
      wrappedGrosseZahl(daten.abschluesse.anime, daten.abschluesse.anime === 1 ? "Anime" : "Anime"),
      wrappedText("wrapped-lead", "hast du abgeschlossen.")
    ]));
  }

  // 7 - Serie des Jahres. Ausgewaehlt nach geschauter Zeit, und wo die fehlt,
  // nach Folgen - nicht nach einer erfundenen Punktzahl.
  if (topSerie) {
    seiten.push(wrappedSeite("top-serie", "is-top", [
      wrappedText("wrapped-eyebrow", "Deine Serie des Jahres"),
      wrappedPoster(topSerie.bild),
      wrappedText("wrapped-title", topSerie.titel),
      wrappedText("wrapped-sub", wrappedTitelZahlen(topSerie, zeitBekannt))
    ], wrappedMusikQuelle(topSerie)));
  }
  if (topFilm) {
    seiten.push(wrappedSeite("top-film", "is-top", [
      wrappedText("wrapped-eyebrow", "Dein Film des Jahres"),
      wrappedPoster(topFilm.bild),
      wrappedText("wrapped-title", topFilm.titel),
      wrappedText("wrapped-sub", wrappedTitelZahlen(topFilm, zeitBekannt))
    ]));
  }

  // 8 - Genre des Jahres samt Verfolgerfeld.
  if (daten.genres.length) {
    const erste = daten.genres[0];
    seiten.push(wrappedSeite("genre", "is-genre", [
      wrappedText("wrapped-lead", `Du warst dieses Jahr eindeutig auf ${erste.label}.`),
      wrappedRangliste(daten.genres.slice(0, 3))
    ]));
  }

  // 9 - Der Mix in Prozent. Nur wo Zeit gemessen wurde: eine Prozentangabe auf
  // Titelzahlen waere eine andere Aussage, die genauso aussieht.
  const mix = wrappedMix(daten, zeitBekannt);
  if (mix.length >= 2) {
    seiten.push(wrappedSeite("mix", "is-mix", [
      wrappedText("wrapped-eyebrow", `Dein ${jahr} Mix`),
      wrappedMixBalken(mix)
    ]));
  }

  // 10 - Streak
  if (daten.strecke.tage >= 2) {
    seiten.push(wrappedSeite("streak", "is-streak", [
      wrappedText("wrapped-lead", `Du konntest ${daten.strecke.tage} Tage nicht aufhören.`),
      wrappedGrosseZahl(daten.strecke.tage, "Tage am Stück"),
      wrappedText("wrapped-sub", "Deine längste Strecke ohne Pause.")
    ]));
  }

  // 11 - Wochentag und 12 - Rekordtag sind zwei verschiedene Dinge und stehen
  // deshalb auf zwei Seiten.
  if (daten.aktivsterWochentag) {
    const tag = WOCHENTAGE[daten.aktivsterWochentag.tag] || "";
    seiten.push(wrappedSeite("wochentag", "is-tag", [
      wrappedText("wrapped-lead", `${tag} war dein Tag.`),
      wrappedText("wrapped-sub", daten.aktivsterWochentag.sekunden > 0
        ? `Insgesamt ${reviewDauer(daten.aktivsterWochentag.sekunden)} an ${tag}en.`
        : `${daten.aktivsterWochentag.folgen} Folgen an ${tag}en.`)
    ]));
  }
  if (daten.aktivsterTag) {
    seiten.push(wrappedSeite("rekordtag", "is-tag", [
      wrappedText("wrapped-eyebrow", "Dein intensivster Tag"),
      wrappedText("wrapped-title", reviewDatum(daten.aktivsterTag.tag)),
      wrappedText("wrapped-sub", daten.aktivsterTag.sekunden > 0
        ? reviewDauer(daten.aktivsterTag.sekunden)
        : `${daten.aktivsterTag.folgen} Folgen`)
    ]));
  }

  // 13 - Laengste Sitzung
  if (zeitBekannt && daten.laengsteSitzung >= 1800) {
    seiten.push(wrappedSeite("session", "is-session", [
      wrappedText("wrapped-lead", "Nur noch eine Folge?"),
      wrappedGrosseZahl(reviewDauer(daten.laengsteSitzung)),
      wrappedText("wrapped-sub", "Deine längste Sitzung am Stück.")
    ]));
  }

  // 14 - Tageszeit. Nur bei gemessener Zeit und genug Sitzungen: aus fuenf
  // Abenden folgt kein Typ.
  const zeitfach = wrappedTageszeit(daten, zeitBekannt);
  if (zeitfach) {
    seiten.push(wrappedSeite("tageszeit", "is-nacht", [
      wrappedText("wrapped-lead", `Du bist ${zeitfach.artikel} ${zeitfach.name}.`),
      wrappedGrosseZahl(zeitfach.prozent, "%"),
      wrappedText("wrapped-sub", `deiner Zeit lagen ${zeitfach.satz}.`)
    ]));
  }

  // 15 - Wiederholungen, nur wenn es welche gab.
  if (daten.wiederholteste.length) {
    const oft = daten.wiederholteste[0];
    seiten.push(wrappedSeite("rewatch", "is-rewatch", [
      wrappedText("wrapped-lead", "Das kam dir bekannt vor …"),
      wrappedText("wrapped-title", oft.titel),
      wrappedText("wrapped-sub", daten.wiederholteTitel > 1
        ? `${oft.wiederholungen}× noch einmal gesehen — einer von ${daten.wiederholteTitel} Titeln, zu denen du zurückgekehrt bist.`
        : `${oft.wiederholungen}× noch einmal gesehen.`)
    ], wrappedMusikQuelle(oft)));
  }

  // 16 - Monat des Jahres, mit allen Monaten als kleine Reihe.
  if (daten.aktivsterMonat && daten.monate.length >= 2) {
    seiten.push(wrappedSeite("monat", "is-monat", [
      wrappedText("wrapped-lead", `${wrappedMonatName(daten.aktivsterMonat.monat)} war dein stärkster Monat.`),
      wrappedText("wrapped-sub", daten.aktivsterMonat.sekunden > 0
        ? reviewDauer(daten.aktivsterMonat.sekunden)
        : `${daten.aktivsterMonat.folgen} Folgen`),
      wrappedMonatsreihe(daten.monate)
    ]));
  }

  // 17 - Anfang und Ende. Solange das Jahr laeuft, ist der letzte Titel nur der
  // bisher letzte - alles andere waere eine Behauptung ueber die Zukunft.
  if (daten.erster) {
    seiten.push(wrappedSeite("erster", "is-erster", [
      wrappedText("wrapped-eyebrow", "So hat dein Jahr begonnen"),
      wrappedPoster(daten.erster.bild),
      wrappedText("wrapped-title", daten.erster.titel),
      wrappedText("wrapped-sub", reviewDatum(String(daten.erster.wann).slice(0, 10)))
    ], wrappedMusikQuelle(daten.erster)));
  }
  if (daten.letzter && daten.letzter.titel !== daten.erster?.titel) {
    const laeuftNoch = new Date().getFullYear() === Number(jahr);
    seiten.push(wrappedSeite("letzter", "is-letzter", [
      wrappedText("wrapped-eyebrow", laeuftNoch ? "Dein bisher letzter Titel" : "Und damit hast du das Jahr beendet"),
      wrappedPoster(daten.letzter.bild),
      wrappedText("wrapped-title", daten.letzter.titel),
      wrappedText("wrapped-sub", reviewDatum(String(daten.letzter.wann).slice(0, 10)))
    ], wrappedMusikQuelle(daten.letzter)));
  }

  // 18 - Was sonst noch auffiel. Nur Saetze, deren Zahl eindeutig ist.
  const fakten = wrappedFakten(daten, zeitBekannt);
  if (fakten.length) {
    seiten.push(wrappedSeite("fakten", "is-fakten", [
      wrappedText("wrapped-eyebrow", "Nebenbei"),
      wrappedFaktenListe(fakten)
    ]));
  }

  // 19 - Das Finale. Bewusst als eigener Block gebaut, damit sich daraus
  // spaeter ein Bild erzeugen laesst, ohne den Rest mitzunehmen.
  seiten.push(wrappedFinale(daten, jahr, zeitBekannt));
  return seiten;
}

function wrappedAuftakt(daten, jahr) {
  if (daten.tage >= 200) return `${jahr} hast du kaum einen Abend ausgelassen.`;
  if (daten.folgen >= 300) return `${jahr} war ein gutes Jahr zum Schauen.`;
  if (daten.folgen >= 50) return `Schauen wir uns dein ${jahr} an.`;
  return `Dein ${jahr}, kurz zusammengefasst.`;
}

// Der ehrliche Hinweis unter der Ueberschrift: seit wann es ueberhaupt Daten
// gibt und ob darunter gemessene Zeit ist. Ohne ihn saehe ein angefangenes
// Jahr aus wie ein volles.
function wrappedZeitraumHinweis(daten, jahr) {
  const von = String(daten.von || "").slice(0, 10);
  if (!von) return null;
  const start = new Date(Date.parse(von));
  const teile = [];
  if (start.getMonth() > 0) teile.push(`Daten seit ${MONATE[start.getMonth()]} ${jahr}`);
  if (daten.sekundenBekannt < daten.sekundenGesamt) {
    teile.push(daten.sekundenBekannt
      ? "Wiedergabezeit nur für einen Teil erfasst"
      : "Wiedergabezeit noch nicht erfasst");
  }
  return teile.length ? wrappedText("wrapped-fussnote", teile.join(" · ")) : null;
}

function wrappedTitelZahlen(eintrag, zeitBekannt) {
  const teile = [`${eintrag.folgen} ${eintrag.folgen === 1 ? "Folge" : "Folgen"}`];
  if (zeitBekannt && eintrag.sekunden > 0) teile.push(reviewDauer(eintrag.sekunden));
  return teile.join(" · ");
}

function wrappedPoster(bild) {
  if (!bild) return null;
  const knoten = document.createElement("img");
  knoten.className = "wrapped-poster";
  knoten.src = bild;
  knoten.alt = "";
  return knoten;
}

function wrappedRangliste(eintraege) {
  const liste = document.createElement("ol");
  liste.className = "wrapped-rang";
  eintraege.forEach((eintrag, i) => {
    const zeile = document.createElement("li");
    const platz = document.createElement("span");
    platz.className = "wrapped-rang-platz";
    platz.textContent = `#${i + 1}`;
    const name = document.createElement("strong");
    name.textContent = eintrag.label;
    zeile.append(platz, name);
    liste.append(zeile);
  });
  return liste;
}

// Prozentanteile des Genre-Mixes. Grundlage ist die anteilig verteilte Zeit -
// dadurch ergeben die Anteile zusammen hoechstens hundert Prozent und nicht ein
// Vielfaches davon.
function wrappedMix(daten, zeitBekannt) {
  const werte = daten.genres.map((genre) => ({
    label: genre.label,
    wert: zeitBekannt && genre.sekunden > 0 ? genre.sekunden : genre.titel
  })).filter((eintrag) => eintrag.wert > 0);
  const summe = werte.reduce((a, e) => a + e.wert, 0);
  if (!summe) return [];

  // Jeden Anteil einzeln zu runden ergibt Summen wie 101 Prozent - auf einer
  // Karte, die "dein Mix" heisst, sieht das schlicht falsch aus. Deshalb erst
  // abrunden und die uebrigen Punkte an die groessten Reste vergeben: so
  // stimmt die Summe genau, und keine Zahl weicht um mehr als einen Punkt ab.
  const genau = werte.map((eintrag) => ({ label: eintrag.label, roh: (eintrag.wert / summe) * 100 }));
  const anteile = genau.map((eintrag) => ({ ...eintrag, prozent: Math.floor(eintrag.roh) }));
  let offen = 100 - anteile.reduce((a, e) => a + e.prozent, 0);
  [...anteile]
    .sort((links, rechts) => (rechts.roh % 1) - (links.roh % 1))
    .forEach((eintrag) => { if (offen > 0) { eintrag.prozent += 1; offen -= 1; } });

  const oben = anteile.slice(0, 4).map(({ label, prozent }) => ({ label, prozent }));
  const rest = 100 - oben.reduce((a, e) => a + e.prozent, 0);
  if (rest >= 3) oben.push({ label: "andere", prozent: rest });
  return oben;
}

function wrappedMixBalken(mix) {
  const block = document.createElement("div");
  block.className = "wrapped-mix";
  for (const eintrag of mix) {
    const zeile = document.createElement("div");
    zeile.className = "wrapped-mix-zeile";
    const wert = document.createElement("strong");
    wert.textContent = `${eintrag.prozent} %`;
    const name = document.createElement("span");
    name.textContent = eintrag.label;
    const schiene = document.createElement("div");
    schiene.className = "wrapped-mix-rail";
    const fuellung = document.createElement("div");
    fuellung.className = "wrapped-mix-fill";
    fuellung.style.width = `${eintrag.prozent}%`;
    schiene.append(fuellung);
    zeile.append(wert, name, schiene);
    block.append(zeile);
  }
  return block;
}

function wrappedMonatName(schluessel) {
  return MONATE[Number(String(schluessel).slice(5, 7)) - 1] || "";
}

function wrappedMonatsreihe(monate) {
  const block = document.createElement("div");
  block.className = "wrapped-monate";
  const groesster = Math.max(...monate.map((m) => m.sekunden || m.folgen), 1);
  for (const monat of monate) {
    const saeule = document.createElement("div");
    saeule.className = "wrapped-monat";
    const balken = document.createElement("div");
    balken.className = "wrapped-monat-balken";
    balken.style.height = `${Math.max(6, Math.round(((monat.sekunden || monat.folgen) / groesster) * 100))}%`;
    const name = document.createElement("small");
    name.textContent = wrappedMonatName(monat.monat).slice(0, 3);
    saeule.append(balken, name);
    block.append(saeule);
  }
  return block;
}

// Der Tageszeit-Typ. Zwei Bedingungen, damit daraus keine Behauptung wird: es
// muss gemessene Zeit geben, und der Anteil muss deutlich genug sein.
function wrappedTageszeit(daten, zeitBekannt) {
  if (!zeitBekannt || daten.sitzungen < 15) return null;
  const gesamt = daten.tageszeiten.reduce((a, e) => a + e.sekunden, 0);
  if (!gesamt) return null;
  const beste = [...daten.tageszeiten].sort((a, b) => b.sekunden - a.sekunden)[0];
  const prozent = Math.round((beste.sekunden / gesamt) * 100);
  if (prozent < 35) return null;
  const wort = WRAPPED_TAGESZEIT[beste.fach];
  if (!wort) return null;
  return { ...wort, prozent, artikel: beste.fach === "nacht" ? "eine" : "ein" };
}

function wrappedFakten(daten, zeitBekannt) {
  const fakten = [];
  if (daten.welten >= 3) fakten.push(`Du warst in ${daten.welten} verschiedenen Titeln unterwegs.`);
  if (daten.marathon >= 3) fakten.push(`Dein längster Marathon: ${daten.marathon} Folgen ohne Unterbrechung.`);
  if (zeitBekannt && daten.sitzungsschnitt >= 600) {
    fakten.push(`Deine Sitzungen dauerten im Schnitt ${reviewDauer(daten.sitzungsschnitt)}.`);
  }
  if (daten.folgenJeTag >= 2) {
    fakten.push(`An einem Schautag liefen im Schnitt ${String(daten.folgenJeTag).replace(".", ",")} Folgen.`);
  }
  return fakten.slice(0, 4);
}

function wrappedFaktenListe(fakten) {
  const liste = document.createElement("ul");
  liste.className = "wrapped-fakten";
  for (const satz of fakten) {
    const zeile = document.createElement("li");
    zeile.textContent = satz;
    liste.append(zeile);
  }
  return liste;
}

// Die Abschlusskarte. Sie steht als eigener, in sich geschlossener Block mit
// eigener Kennung - so laesst sich spaeter genau dieser Ausschnitt als Bild
// ausgeben, ohne dass dafuer etwas umgebaut werden muesste.
function wrappedFinale(daten, jahr, zeitBekannt) {
  const karte = document.createElement("div");
  karte.className = "wrapped-summary";
  karte.id = "wrappedSummary";

  const kopf = document.createElement("p");
  kopf.className = "wrapped-eyebrow";
  kopf.textContent = "Dein ELFIX";
  const zahl = document.createElement("strong");
  zahl.className = "wrapped-summary-jahr";
  zahl.textContent = String(jahr);
  karte.append(kopf, zahl);

  const gitter = document.createElement("div");
  gitter.className = "wrapped-summary-grid";
  const zelle = (wert, label) => {
    const block = document.createElement("div");
    const w = document.createElement("strong");
    w.textContent = String(wert);
    const l = document.createElement("span");
    l.textContent = label;
    block.append(w, l);
    return block;
  };
  if (zeitBekannt) gitter.append(zelle(reviewDauer(daten.sekunden), "geschaut"));
  gitter.append(zelle(wrappedZahl(daten.folgen), "Folgen"));
  if (daten.abschluesse.serie) gitter.append(zelle(daten.abschluesse.serie, "Serien"));
  if (daten.abschluesse.film) gitter.append(zelle(daten.abschluesse.film, "Filme"));
  if (daten.abschluesse.anime) gitter.append(zelle(daten.abschluesse.anime, "Anime"));
  if (daten.strecke.tage >= 2) gitter.append(zelle(daten.strecke.tage, "Tage Streak"));
  karte.append(gitter);

  if (daten.genres[0]) {
    const genre = document.createElement("p");
    genre.className = "wrapped-summary-zeile";
    genre.textContent = `Genre des Jahres · ${daten.genres[0].label}`;
    karte.append(genre);
  }
  if (daten.serien[0]) {
    const serie = document.createElement("p");
    serie.className = "wrapped-summary-zeile";
    serie.textContent = `Serie des Jahres · ${daten.serien[0].titel}`;
    karte.append(serie);
  }

  const schluss = document.createElement("button");
  schluss.type = "button";
  schluss.className = "wrapped-ende-knopf";
  schluss.textContent = "Zur Statistik";
  schluss.addEventListener("click", (event) => {
    event.stopPropagation();
    wrappedSchliessen();
    showReview().catch(() => {});
  });

  return wrappedSeite("finale", "is-finale", [karte, schluss]);
}

// Welches Jahr gerade Saison hat - 0 heisst: keine.
//
// Steht hier, weil zwei Stellen es brauchen: der Eintrag in der Seitenleiste,
// der im Dezember leuchtet, und der Klick darauf, der dann geradewegs in die
// Karten fuehrt. Gesetzt wird der Wert von renderRueckblickEintrag; ohne
// Saison bleibt er 0, und alles verhaelt sich wie im Rest des Jahres.
let wrappedSaisonJahr = 0;

// Ob der Punkt "Rueckblick" in der Seitenleiste steht - und wie.
//
// Von Haus aus steht er nicht da: eine Statistik ist etwas fuer den, der sie
// sucht, und nicht fuer jeden, der die App oeffnet. Wer sie will, schaltet sie
// ein - und bekommt dann einen Eintrag wie jeden anderen. Das ist der Punkt:
// wer selbst danach gegriffen hat, will nicht angesprochen werden.
//
// Im Dezember steht er trotzdem da - dann aber wegen der Saison und nicht wegen
// der Einstellung, und deshalb sieht er auch anders aus. Bis hierher tat der
// Dezember nur eines: er blendete den Eintrag ein. Damit sass er als neunter
// Punkt in einer Liste aus acht, und einen neunten Punkt bemerkt niemand. Mit
// `is-saison` bekommt er die Akzentfarbe, einen ruhigen Puls und die Jahreszahl
// daneben - fuenf Wochen im Jahr, danach von selbst wieder wie vorher.
//
// Und ausdruecklich nicht nur, solange der Jahresrueckblick ungesehen ist: er
// soll erreichbar bleiben, nachdem man ihn einmal angesehen hat, sonst
// verschwindet der Weg dorthin genau in dem Moment, in dem man ihn
// wiederfinden moechte.
async function renderRueckblickEintrag(lage) {
  const knopf = document.querySelector("#reviewSideLink");
  if (!knopf) return;
  const antwort = lage !== undefined ? lage : await api.getWrapped?.().catch(() => null);
  const saison = Boolean(antwort?.saison);
  wrappedSaisonJahr = saison ? Number(antwort.jahr) || 0 : 0;

  knopf.classList.toggle("is-hidden", !saison && settings.home?.showReview !== true);
  knopf.classList.toggle("is-saison", saison);
  knopf.title = saison ? `ELFIX Wrapped ${wrappedSaisonJahr} ansehen` : "Rückblick";

  // Die Jahreszahl steht nur in der Saison da. Anfang Januar ist das noch das
  // vergangene Jahr - ohne die Zahl waere genau dann unklar, worauf man klickt.
  let marke = knopf.querySelector(".side-badge");
  if (saison && wrappedSaisonJahr) {
    if (!marke) {
      marke = document.createElement("span");
      marke.className = "side-badge";
      knopf.append(marke);
    }
    marke.textContent = String(wrappedSaisonJahr);
    marke.classList.remove("is-hidden");
  } else if (marke) {
    marke.remove();
  }
}

// Die eine Abfrage fuer beide Stellen: das Banner auf der Startseite und den
// Eintrag in der Seitenleiste.
async function wrappedLageZeigen() {
  const antwort = await api.getWrapped?.().catch(() => null);
  await renderWrappedHinweis(antwort);
  await renderRueckblickEintrag(antwort);
}

// Wohin der Eintrag "Rueckblick" fuehrt.
//
// Ausserhalb der Saison auf die Statistikseite - dort stehen die Zahlen zum
// Nachschlagen, und danach hat gesucht, wer im Juli auf "Rueckblick" klickt.
//
// In der Saison geradewegs in die Karten. Vorher lag dazwischen eine Seite mit
// Reitern, Kacheln und Ranglisten, auf der man den Jahresrueckblick erst
// finden musste - im Archiv, unter der Ueberschrift, als Jahreszahl in einer
// Reihe. Der Weg war da, aber er war keiner, den man von selbst geht.
//
// Faellt der Rueckblick aus - zu wenig Daten, ein Fehler -, bleibt die
// Statistikseite der Rueckfall. Ein Klick, der nichts tut, waere schlechter
// als einer, der woandershin fuehrt.
async function rueckblickOeffnen() {
  if (wrappedSaisonJahr) {
    const geoeffnet = await wrappedOeffnen(wrappedSaisonJahr).catch(() => false);
    if (geoeffnet) return;
  }
  await showReview();
}

// Das Archiv auf der Statistikseite. Hier - und nicht in der Hauptnavigation -
// gehoert es hin: der Rueckblick ist eine Sicht auf dieselben Daten, kein
// eigener Bereich.
async function renderWrappedArchiv() {
  const kasten = document.querySelector("#wrappedArchiv");
  if (!kasten) return;
  const jahre = await api.getWrappedJahre?.().catch(() => []);
  const brauchbar = Array.isArray(jahre) ? jahre : [];
  kasten.classList.toggle("is-hidden", !brauchbar.length);
  if (!brauchbar.length) {
    kasten.replaceChildren();
    return;
  }
  const kopf = document.createElement("span");
  kopf.className = "wrapped-archiv-titel";
  kopf.textContent = brauchbar.length === 1 ? "Dein Rückblick" : "Deine Rückblicke";
  const knoepfe = brauchbar.map((jahr) => {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = "wrapped-archiv-jahr";
    knopf.textContent = String(jahr);
    knopf.addEventListener("click", () => { wrappedOeffnen(jahr).catch(() => {}); });
    return knopf;
  });
  kasten.replaceChildren(kopf, ...knoepfe);
}

// --- Der Hinweis auf der Startseite ------------------------------------------
//
// Kein Popup: der Rueckblick soll auffallen, nicht ueberfallen. Ein Fenster,
// das sich beim Start vor die App legt, ist keine Einladung, sondern eine
// Huerde - man klickt es weg, bevor man gelesen hat, was drinsteht.
//
// Auffallen muss er trotzdem, und das tat er nicht. Als schmale Zeile zwischen
// den Reihen der Startseite sah er aus wie jede andere Karte und wurde
// ueberscrollt. Jetzt ist er ein Banner mit eigener Hoehe, eigener Farbe und
// einem Licht, das darueber wandert - dieselbe Stelle, dasselbe Verhalten, nur
// nicht mehr zu uebersehen.
//
// Er verschwindet, sobald er einmal geoeffnet wurde, und bleibt ueber den
// Eintrag in der Seitenleiste und das Archiv erreichbar.
async function renderWrappedHinweis(lage) {
  const kasten = document.querySelector("#wrappedHinweis");
  if (!kasten) return;
  const antwort = lage !== undefined ? lage : await api.getWrapped?.().catch(() => null);
  const zeigen = Boolean(antwort?.faellig && antwort?.daten);
  kasten.classList.toggle("is-hidden", !zeigen);
  if (!zeigen) return;
  kasten.replaceChildren();

  const text = document.createElement("div");
  // Warum das Banner ueberhaupt da ist. Ohne diese Zeile fragt man sich beim
  // ersten Mal, was sich geaendert hat - und beim zweiten Mal, ob es bleibt.
  const anlass = document.createElement("span");
  anlass.className = "wrapped-hinweis-eyebrow";
  anlass.textContent = "Nur im Dezember";
  const kopf = document.createElement("strong");
  kopf.textContent = `Dein ELFIX Wrapped ${antwort.jahr} ist da`;
  const unten = document.createElement("span");
  unten.textContent = wrappedHinweisZeile(antwort.daten, antwort.jahr);
  text.append(anlass, kopf, unten);

  const knopf = document.createElement("button");
  knopf.type = "button";
  knopf.className = "primary-action";
  knopf.textContent = "Dein Jahr ansehen";
  knopf.addEventListener("click", () => { wrappedOeffnen(antwort.jahr).catch(() => {}); });

  kasten.append(text, knopf);
}

// Ein Satz mit einer Zahl darin statt "Sieh dir dein Jahr an".
//
// Der Unterschied ist nicht Kosmetik: eine Aufforderung kann jeder schreiben,
// eine Zahl aus den eigenen Daten kann nur ELFIX. Wer "195 Folgen" liest,
// weiss, dass dahinter etwas steht - und klickt aus einem anderen Grund.
//
// Gerechnet wird nichts: die Werte stehen bereits in der Auswertung, und was
// nicht gemessen wurde, kommt hier auch nicht vor.
function wrappedHinweisZeile(daten, jahr) {
  const teile = [];
  if (daten?.sekundenBekannt > 0 && daten?.sekunden > 0) teile.push(reviewDauer(daten.sekunden));
  if (daten?.folgen > 0) teile.push(`${daten.folgen} ${daten.folgen === 1 ? "Folge" : "Folgen"}`);
  if (daten?.tage > 0) teile.push(`${daten.tage} ${daten.tage === 1 ? "Tag" : "Tage"}`);
  if (!teile.length) return `Dein ${jahr}, in Karten erzählt.`;
  return `${teile.join(" · ")} — dein ${jahr}, in Karten erzählt.`;
}


async function showGlobalSearch(query) {
  const searchToken = ++activeSearchToken;
  await enterInternalMode();
  setCurrentRoute("search");
  if (query.trim()) rememberSearch(query);
  hideContentViews();
  globalSearchView.classList.remove("is-hidden");
  window.setTimeout(syncBrowserBounds, 0);
  searchTitle.textContent = query.trim() ? `${query} suchen` : "Suchen";
  document.querySelector("#searchCopy").textContent = query.trim()
    ? "ELFIX nutzt nur die Direktsuche deiner Anbieter."
    : "Wähle einen Anbieter aus, um dessen Direktsuche zu öffnen.";
  renderSearchHistory();

  const matchingFavorites = favoriteEntries().filter((favorite) => {
    const haystack = `${favorite.title} ${favorite.providerName}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });
  const enabled = providers.filter((provider) => provider.enabled !== false);
  const nodes = [];
  if (query.trim()) {
    const loading = document.createElement("div");
    loading.className = "search-loading";
    loading.textContent = "Suche alle Anbieter...";
    nodes.push(loading);
  }
  if (matchingFavorites.length) {
    const heading = document.createElement("div");
    heading.className = "search-section-label";
    heading.textContent = "Watchlist";
    nodes.push(heading, ...matchingFavorites.slice(0, 6).map((favorite) => favoriteCard(favorite, true)));
  }
  const providerHeading = document.createElement("div");
  providerHeading.className = "search-section-label direct-search-heading";
  providerHeading.textContent = "Direktsuche";
  nodes.push(providerHeading);
  nodes.push(...enabled.map((provider) => {
    const card = document.createElement("button");
    card.className = "search-result-card";
    card.type = "button";
    card.innerHTML = `<strong>${escapeHtml(provider.name)}</strong><span>Direktsuche öffnen</span>`;
    card.addEventListener("click", async () => {
      hideContentViews();
      const state = await api.openProviderSearch(provider.id, query);
      activeProviderId = state?.activeProviderId || provider.id;
      setCurrentRoute(`provider:${activeProviderId}`);
      renderProviders();
    });
    return card;
  }));
  globalSearchGrid.replaceChildren(...nodes);

  if (!enabled.length) {
    globalSearchGrid.append(emptyText("Kein aktiver Anbieter gespeichert."));
  }
  if (query.trim()) {
    renderProviderResults(query, searchToken);
  }
}

// Ein Suchtreffer: klicken oeffnet ihn, das Herz nimmt ihn ohne Umweg auf die
// Watchlist. Die Karte ist deshalb kein Knopf mehr - ein Knopf im Knopf waere
// kein gueltiges HTML und liesse sich nicht getrennt anklicken.
// Den Suchbegriff im Titel sichtbar machen. Ausschliesslich Darstellung: der
// Titel wird nicht zerlegt, nicht veraendert und nicht ersetzt - er wird nur
// stueckweise in Textknoten geschrieben, von denen einer ausgezeichnet ist.
//
// Wichtig ist das Gegenteil dessen, was der Anbieter tut: dort steckt die
// Hervorhebung im gelieferten Titel und macht aus "Demon" ein "Demo n". Hier
// bleibt `result.title` unberuehrt, und die Zerlegung endet an der Oberflaeche.
function titelMitFundstelle(titel, suche) {
  const ziel = document.createElement("strong");
  const text = String(titel || "");
  const begriff = String(suche || "").trim();
  if (!begriff) {
    ziel.textContent = text;
    return ziel;
  }
  // Ohne Ruecksicht auf Gross- und Kleinschreibung suchen, aber immer die
  // Zeichen des Originals anzeigen.
  const stelle = text.toLowerCase().indexOf(begriff.toLowerCase());
  if (stelle < 0) {
    ziel.textContent = text;
    return ziel;
  }
  const treffer = document.createElement("mark");
  treffer.textContent = text.slice(stelle, stelle + begriff.length);
  // Drei Knoten, kein Leerzeichen dazwischen: davor, die Fundstelle, danach.
  if (stelle > 0) ziel.append(document.createTextNode(text.slice(0, stelle)));
  ziel.append(treffer);
  const rest = text.slice(stelle + begriff.length);
  if (rest) ziel.append(document.createTextNode(rest));
  return ziel;
}

function searchResultCard(result, provider, suche = "") {
  const card = document.createElement("div");
  card.className = "search-result-card provider-result";
  card.tabIndex = 0;
  card.role = "button";
  // Die stabile Kennung des Treffers. Alles, was die Karte spaeter tut, laeuft
  // ueber sie - nie ueber den angezeigten Titel, die Fundstelle oder die
  // Position in der Liste.
  card.dataset.resultUrl = String(result.url || "");
  const meta = [result.genre, provider.providerName].filter(Boolean).join(" · ");
  const untertitel = document.createElement("span");
  untertitel.textContent = meta;
  card.append(titelMitFundstelle(result.title, suche), untertitel);

  const oeffnen = async () => {
    hideContentViews();
    await api.setShellOpen(false);
    const state = await api.openProviderUrl(provider.providerId, result.url);
    activeProviderId = state?.activeProviderId || provider.providerId;
    setCurrentRoute(`provider:${activeProviderId}`);
    renderProviders();
  };
  card.addEventListener("click", oeffnen);
  card.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    oeffnen();
  });

  const herz = document.createElement("button");
  herz.type = "button";
  herz.className = "result-fav";
  const schonDrin = stehtInWatchlist(result.url);
  herz.textContent = schonDrin ? "♥" : "♡";
  herz.classList.toggle("is-active", schonDrin);
  herz.title = schonDrin ? "Steht schon auf der Watchlist" : "Zur Watchlist hinzufügen";
  herz.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (herz.disabled) return;
    herz.disabled = true;
    try {
      const ergebnis = await api.addSearchResultToWatchlist?.({
        providerId: provider.providerId,
        providerName: provider.providerName,
        url: result.url,
        title: result.title,
        thumbnail: result.image || result.thumbnail || ""
      }).catch(() => null);
      if (!ergebnis?.added) {
        showToast(ergebnis?.reason || "Konnte nicht hinzugefügt werden");
        return;
      }
      favorites = ergebnis.favorites || favorites;
      herz.textContent = "♥";
      herz.classList.add("is-active");
      herz.title = "Steht auf der Watchlist";
      renderFavorites();
      renderHome();
      showToast(ergebnis.already
        ? `„${ergebnis.title || result.title}“ steht schon auf der Watchlist`
        : `„${ergebnis.title || result.title}“ zur Watchlist hinzugefügt`);
    } finally {
      herz.disabled = false;
    }
  });
  card.append(herz);
  // Das Herz merkt vor; alles Weitere - vor allem das Abhaken - steht im
  // Menue daneben.
  vorschlagMenueAnhaengen(card, {
    providerId: provider.providerId,
    providerName: provider.providerName,
    url: result.url,
    title: result.title,
    image: result.image || result.thumbnail || ""
  });
  return card;
}

// --- Vorschlaege und Suchtreffer ---------------------------------------------
//
// Ein Vorschlag auf der Startseite und ein Treffer in der Suche sind noch kein
// Eintrag in ELFIX: sie haben keine Kennung, nur Anbieter, Adresse und Titel.
// Beides - vormerken und abhaken - legt sie deshalb erst an. Das erledigt
// dieselbe Bruecke, die schon hinter dem Herzen in der Suche steht.
function vorschlagAlsTreffer(item) {
  return {
    providerId: item.providerId,
    providerName: item.providerName,
    url: item.url,
    title: item.title,
    thumbnail: item.image || item.thumbnail || ""
  };
}

async function vorschlagAnlegen(item) {
  return api.addSearchResultToWatchlist?.(vorschlagAlsTreffer(item)).catch(() => null);
}

// Nach dem Anlegen sind Watchlist, Startseite und Mediathek nicht mehr aktuell.
function listenNeuZeichnen() {
  renderFavorites();
  renderHome();
  renderLibraryViews();
  renderFavoriteToggle();
}

async function vorschlagVormerken(item) {
  const ergebnis = await vorschlagAnlegen(item);
  if (!ergebnis?.added) {
    showToast(ergebnis?.reason || "Konnte nicht vorgemerkt werden");
    return false;
  }
  favorites = ergebnis.favorites || favorites;
  listenNeuZeichnen();
  const titel = ergebnis.title || item.title;
  showToast(ergebnis.already
    ? `„${titel}“ steht schon auf der Watchlist`
    : `„${titel}“ steht auf der Watchlist`);
  return true;
}

// Abhaken in zwei Schritten: erst anlegen, dann abhaken. Der zweite Schritt
// nimmt den Titel gleich wieder von der Watchlist - genau das soll er, denn
// gesehen und vorgemerkt schliessen sich aus.
async function vorschlagAbhaken(item) {
  const titel = item.title || "Dieser Titel";
  const bestaetigt = await confirmAction({
    eyebrow: "Mediathek",
    title: `„${titel}“ als gesehen abhaken?`,
    copy: "Der Titel wandert in die Mediathek, ohne dass du ihn vorher öffnen musst. Er taucht danach nicht mehr in Vorschlägen auf — nur neue Folgen holen ihn zurück.",
    confirmLabel: "Abhaken"
  });
  if (!bestaetigt) return false;

  const angelegt = await vorschlagAnlegen(item);
  if (!angelegt?.added) {
    showToast(angelegt?.reason || "Konnte nicht abgehakt werden");
    return false;
  }
  favorites = angelegt.favorites || favorites;
  const kennung = angelegt.favorite?.id
    || favorites.find((favorite) => gleicheAdresse(favorite.url, item.url))?.id;
  if (!kennung) {
    showToast("Konnte nicht abgehakt werden");
    return false;
  }
  const ergebnis = await api.markFavoriteCompleted?.(kennung).catch(() => null);
  if (!ergebnis?.completed) {
    showToast("Konnte nicht abgehakt werden");
    return false;
  }
  favorites = ergebnis.favorites || favorites;
  listenNeuZeichnen();
  showToast(`„${angelegt.title || titel}“ ist jetzt in der Mediathek`);
  return true;
}

// Das Menue eines Vorschlags oder Treffers. Vormerken faellt weg, wenn er
// schon auf der Watchlist steht - der Eintrag waere ohne Wirkung.
function vorschlagEintraege(item) {
  const eintraege = [];
  if (!stehtInWatchlist(item.url)) {
    eintraege.push({
      gruppe: "vormerken",
      symbol: "♡",
      text: "Auf die Watchlist",
      tun: () => vorschlagVormerken(item)
    });
  }
  eintraege.push({
    gruppe: "vormerken",
    symbol: "✓",
    text: "Als gesehen abhaken",
    tun: () => vorschlagAbhaken(item)
  });
  // Der Trailer gehoert vor allem hierhin. Ein Vorschlag ist ein Titel, den man
  // nicht kennt - und die erste Frage dazu ist nicht "vormerken oder nicht",
  // sondern "was ist das ueberhaupt?". Genau die beantwortet der Trailer.
  eintraege.push({
    gruppe: "info",
    symbol: "▷",
    text: "Trailer ansehen",
    tun: () => trailerZeigen(item.title, item.url)
  });
  return eintraege;
}

// Der Knopf dazu, gleich angehaengt. Ohne eigene Adresse gibt es nichts
// anzulegen: ein Vorschlag, der nur zur Suche des Anbieters fuehrt, wuerde
// sonst mit der Suchadresse in der Watchlist landen.
function vorschlagMenueAnhaengen(karte, item) {
  if (item.viaSearch || !item.url || !item.providerId) return;
  const eintraege = vorschlagEintraege(item);
  const knopf = document.createElement("button");
  knopf.className = "favorite-menu";
  knopf.type = "button";
  knopf.textContent = "⋯";
  knopf.title = "Mehr zu diesem Titel";
  knopf.setAttribute("aria-haspopup", "menu");
  knopf.dataset.menueFuer = `vorschlag:${item.url}`;
  knopf.kartenEintraege = eintraege;
  // Frisch gefragt: zwischen zwei Klicks kann der Titel vorgemerkt worden
  // sein, dann gehoert der Eintrag nicht mehr ins Menue. Der Rechtsklick auf
  // die Kachel geht denselben Weg und fragt ueber diese Funktion nach.
  knopf.eintraegeFrisch = () => vorschlagEintraege(item);
  knopf.addEventListener("click", (event) => {
    event.stopPropagation();
    knopf.kartenEintraege = vorschlagEintraege(item);
    kartenMenueOeffnen(knopf, knopf.kartenEintraege);
  });
  karte.append(knopf);
}

// Grober Abgleich ueber die Adresse - fuer die Anzeige des Herzens und fuer das
// Wiederfinden eines gerade angelegten Eintrags genuegt das. Protokoll und
// abschliessender Schraegstrich sagen nichts ueber den Titel.
function adressSchluessel(url) {
  return String(url || "").replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
}

function gleicheAdresse(links, rechts) {
  const schluessel = adressSchluessel(links);
  return Boolean(schluessel) && schluessel === adressSchluessel(rechts);
}

function stehtInWatchlist(url) {
  const schluessel = adressSchluessel(url);
  if (!schluessel) return false;
  return favorites.some((favorite) => favorite.favorite !== false
    && adressSchluessel(favorite.url) === schluessel);
}

async function renderProviderResults(query, searchToken) {
  const response = await api.searchAll(query);
  if (searchToken !== activeSearchToken) return;

  const resultNodes = [];
  let total = 0;
  for (const provider of response) {
    if (provider.results?.length) {
      const heading = document.createElement("div");
      heading.className = "search-section-label";
      heading.textContent = `${provider.providerName} Treffer`;
      resultNodes.push(heading);
      for (const result of provider.results) {
        total += 1;
        resultNodes.push(searchResultCard(result, provider, query));
      }
    }
  }

  document.querySelectorAll(".search-loading").forEach((node) => node.remove());
  if (resultNodes.length) {
    globalSearchGrid.prepend(...resultNodes);
  } else {
    const empty = emptyText("Keine Direktsuche-Treffer erkannt. Direktsuchen unten öffnen.");
    globalSearchGrid.prepend(empty);
  }
  document.querySelector("#searchCopy").textContent = total
    ? `${total} Treffer aus deinen Anbietern.`
    : "Keine direkten Treffer erkannt. Du kannst weiterhin jede Direktsuche öffnen.";
}

function rememberSearch(query) {
  searchHistory = [query, ...searchHistory.filter((item) => item.toLowerCase() !== query.toLowerCase())].slice(0, 12);
  localStorage.setItem("elflix-search-history", JSON.stringify(searchHistory));
}

function renderSearchHistory() {
  searchHistoryNode.replaceChildren();
  if (!searchHistory.length) return;
  const label = document.createElement("span");
  label.textContent = "Zuletzt gesucht:";
  searchHistoryNode.append(label);
  for (const item of searchHistory) {
    const chip = document.createElement("button");
    chip.className = "history-chip";
    chip.type = "button";
    chip.textContent = item;
    chip.addEventListener("click", () => {
      omnibox.value = item;
      showGlobalSearch(item);
    });
    searchHistoryNode.append(chip);
  }
  updateHistoryClearVisibility();
}

function updateHistoryClearVisibility(historyCount = historyEntries().length) {
  historyClear?.classList.toggle("is-hidden", historyCount === 0 && searchHistory.length === 0);
}

function renderFavorites() {
  const items = favoriteEntries();
  favoritesGrid.replaceChildren(...items.map((favorite) => favoriteCard(favorite, true, {
    showProgress: hasContinueActivity(favorite),
    allowComplete: true
  })));
  favoritesEmpty.classList.toggle("is-hidden", items.length > 0);
}

function renderLibraryViews() {
  const sortierung = mediathekSortierung();
  const tab = mediathekAktiverTab();
  const libraryItems = mediathekTabEintraege(tab, sortierung);
  // Ziehen gibt es nur in der Handsortierung. In einer A-Z-Ansicht waere es
  // sinnlos - die naechste Sortierung wuerde es sofort wieder aufheben - und
  // es wuerde die gespeicherte Handarbeit ueberschreiben.
  const vonHand = sortierung === "manuell";
  libraryGrid?.replaceChildren(...libraryItems.map((favorite) => favoriteCard(favorite, false, {
    allowLibraryRemove: true,
    allowRewatch: true,
    showWatchedDate: true,
    sortable: vonHand
  })));
  libraryEmpty?.classList.toggle("is-hidden", libraryItems.length > 0);
  renderMediathekTabs({
    titel: mediathekTabEintraege("titel", sortierung).length,
    youtube: mediathekTabEintraege("youtube", sortierung).length
  });
  setzeMediathekLeermeldung(tab);
  renderMediathekSortierung(libraryItems.length);
  macheMediathekSortierbar();

  const continueItems = continueEntries();
  const weiterOptionen = {
    showProgress: true, allowContinueRemove: true, allowComplete: true,
    allowWatchlistAdd: true, autoplay: true, fullscreen: true
  };
  // Oben der eigene Stand, darunter abgesetzt die Watchparty-Runden.
  const privatOffen = continueItems.filter((favorite) => !favorite.watchpartyRoom);
  const partyOffen = continueItems.filter((favorite) => favorite.watchpartyRoom);
  continueGrid?.replaceChildren(...privatOffen.map((favorite) => favoriteCard(favorite, false, weiterOptionen)));
  continuePartyGrid?.replaceChildren(...partyOffen.map((favorite) => favoriteCard(favorite, false, weiterOptionen)));
  continuePartyGroup?.classList.toggle("is-hidden", partyOffen.length === 0);
  continueEmpty?.classList.toggle("is-hidden", continueItems.length > 0);

  const historyItems = historyEntries();
  const gezeigt = historyVerdichten(historyGefiltert(historyItems));
  renderHistoryFilters(historyItems);
  historyList?.replaceChildren(...historyKinder(gezeigt));
  historyEmpty?.classList.toggle("is-hidden", historyItems.length > 0);
  updateHistoryClearVisibility(historyItems.length);

  if (historySummary) {
    const eingegrenzt = gezeigt.length !== historyItems.length;
    const titelZahl = new Set(gezeigt.map((eintrag) => eintrag.favorite.id)).size;
    if (!historyItems.length) {
      historySummary.textContent = "";
    } else if (!gezeigt.length) {
      historySummary.textContent = "Nichts gefunden — andere Suche oder Filter versuchen.";
    } else {
      const eintraege = gezeigt.length === 1 ? "1 Eintrag" : `${gezeigt.length} Einträge`;
      const titel = titelZahl === 1 ? "1 Titel" : `${titelZahl} Titeln`;
      historySummary.textContent = eingegrenzt
        ? `${eintraege} zu ${titel} — eingegrenzt`
        : `${eintraege} zu ${titel}`;
    }
  }
}

// Karten der Mediathek lassen sich mit der Maus umsortieren. Die Vorschau
// laeuft im DOM mit, damit man beim Ziehen sieht, wo die Karte landet;
// Die Leiste ueber der Mediathek. Sie erscheint erst, wenn es genug zu
// sortieren gibt - bei drei Titeln waere sie nur im Weg.
function renderMediathekSortierung(anzahl) {
  const leiste = document.querySelector("#librarySort");
  if (!leiste) return;
  if (anzahl < 2) {
    leiste.replaceChildren();
    return;
  }
  const jetzt = mediathekSortierung();
  leiste.replaceChildren(...MEDIATHEK_SORTIERUNGEN.map((art) => {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = `calendar-day${art.wert === jetzt ? " is-active" : ""}`;
    knopf.textContent = art.titel;
    if (art.wert === "manuell") knopf.title = "Deine eigene Reihenfolge — zum Umsortieren die Karten ziehen";
    knopf.addEventListener("click", () => mediathekSortierungSetzen(art.wert));
    return knopf;
  }));
}

async function mediathekSortierungSetzen(sortierung) {
  if (mediathekSortierung() === sortierung) return;
  settings.home = { ...DEFAULT_HOME_SETTINGS, ...(settings.home || {}), librarySort: sortierung };
  // Nur die Ansicht wechselt. libraryOrder bleibt unberuehrt - das ist der
  // ganze Sinn: die Handsortierung wartet, bis man wieder zu ihr zurueckkehrt.
  renderLibraryViews();
  await saveSettings();
}

// gespeichert wird erst beim Loslassen.
let mediathekZiehtId = "";
let mediathekZuletztGezogen = 0;

function macheMediathekSortierbar() {
  if (!libraryGrid || libraryGrid.dataset.sortierbar === "ja") return;
  libraryGrid.dataset.sortierbar = "ja";

  libraryGrid.addEventListener("dragstart", (event) => {
    const karte = event.target.closest(".favorite-card");
    if (!karte?.dataset.favoriteId) return;
    mediathekZiehtId = karte.dataset.favoriteId;
    karte.classList.add("is-dragging");
    libraryGrid.classList.add("is-sorting");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      // Ohne Nutzlast bricht Firefox das Ziehen sofort ab.
      event.dataTransfer.setData("text/plain", mediathekZiehtId);
    }
  });

  libraryGrid.addEventListener("dragover", (event) => {
    if (!mediathekZiehtId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const gezogen = libraryGrid.querySelector(".favorite-card.is-dragging");
    const ueber = event.target.closest(".favorite-card");
    if (!gezogen || !ueber || ueber === gezogen) return;
    // Vor oder hinter die Karte, je nachdem, auf welcher Haelfte man steht.
    const kasten = ueber.getBoundingClientRect();
    const dahinter = event.clientX > kasten.left + kasten.width / 2;
    libraryGrid.insertBefore(gezogen, dahinter ? ueber.nextSibling : ueber);
  });

  libraryGrid.addEventListener("drop", (event) => {
    if (mediathekZiehtId) event.preventDefault();
  });

  libraryGrid.addEventListener("dragend", () => {
    const gezogen = libraryGrid.querySelector(".favorite-card.is-dragging");
    gezogen?.classList.remove("is-dragging");
    libraryGrid.classList.remove("is-sorting");
    if (!mediathekZiehtId) return;
    mediathekZiehtId = "";
    // Der Klick nach dem Loslassen darf den Titel nicht oeffnen.
    mediathekZuletztGezogen = Date.now();
    mediathekReihenfolgeSpeichern();
  });
}

// Ein leerer Reiter soll sagen, welcher leer ist. "Noch keine Mediathek" waere
// auf dem YouTube-Reiter schlicht falsch, solange nebenan zwanzig Serien
// stehen.
function setzeMediathekLeermeldung(tab = mediathekAktiverTab()) {
  const titel = document.querySelector("#libraryEmptyTitle");
  const text = document.querySelector("#libraryEmptyCopy");
  if (!titel || !text) return;
  if (mediathekYoutubeGetrennt() && tab === "youtube") {
    titel.textContent = "Noch keine YouTube-Videos";
    text.textContent = "Fertig geschaute Videos landen hier. Shorts kommen nie hierher.";
    return;
  }
  titel.textContent = "Noch keine Mediathek";
  text.textContent = "Starte einen Inhalt, dann landet er automatisch hier.";
}

// Die Reihenfolge wird je Reiter gespeichert, und das geht gut: der
// Hauptprozess vergibt die Stellen nur fuer die uebergebenen Kennungen. Wer im
// YouTube-Reiter zieht, laesst die Serien unberuehrt und umgekehrt. Dass beide
// Reihen bei null anfangen, faellt nirgends auf - gemischt werden sie ja nie.
async function mediathekReihenfolgeSpeichern() {
  // Doppelter Boden: in einer sortierten Ansicht sind die Karten gar nicht
  // ziehbar, aber wenn hier je etwas anderes ankaeme, duerfte es die
  // Handarbeit nicht ueberschreiben.
  if (mediathekSortierung() !== "manuell") return;
  const ids = [...libraryGrid.querySelectorAll(".favorite-card")]
    .map((karte) => karte.dataset.favoriteId)
    .filter(Boolean);
  if (!ids.length) return;
  const gespeichert = await api.reorderLibrary?.(ids).catch(() => null);
  if (Array.isArray(gespeichert)) favorites = gespeichert;
}

// --- Der Trailer -------------------------------------------------------------
//
// Ein Trailer ist kein Titel, den man schaut. Er zaehlt nicht fuer die
// Statistik, gehoert in keine Watchparty, faengt keine Sitzung an und soll den
// Verlauf nicht anfassen - deshalb laeuft er hier im Fenster der App und nicht
// in der Anbieteransicht, in der all das haengt.
//
// Woher er kommt: aus den Metadaten, die ELFIX ohnehin zu jedem Titel holt.
// TMDB fuehrt die Videos eines Werks, AniList die eines Anime; ausgewaehlt wird
// im Kern (sync-server/metadaten.js, `trailerAus`) - hier steht nur, wie er
// abgespielt wird.
//
// Die Adresse wird aus der Kennung zusammengesetzt und nicht uebernommen. Was
// aus einer fremden Antwort kommt, ist die Kennung, und sie hat die Pruefung in
// metadaten.js hinter sich; alles andere steht hier.
const trailerModal = document.querySelector("#trailerModal");
const trailerRahmen = document.querySelector("#trailerRahmen");
const trailerTitel = document.querySelector("#trailerTitel");
const trailerEyebrow = document.querySelector("#trailerEyebrow");

function trailerAdresse(trailer) {
  const schluessel = String(trailer?.schluessel || "");
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(schluessel)) return "";
  const adresse = new URL(`https://www.youtube-nocookie.com/embed/${schluessel}`);
  adresse.searchParams.set("autoplay", "1");
  // Keine Vorschlaege eines fremden Kanals hinterher: nach dem Trailer ist der
  // Trailer zu Ende.
  adresse.searchParams.set("rel", "0");
  adresse.searchParams.set("modestbranding", "1");
  return adresse.href;
}

function trailerOeffnen(trailer, titel) {
  const adresse = trailerAdresse(trailer);
  if (!adresse || !trailerModal?.showModal) return false;
  const rahmen = document.createElement("iframe");
  rahmen.src = adresse;
  // Ein fremdes Dokument im Fenster der App bekommt nur, was es zum Abspielen
  // braucht: Skripte, den eigenen Ursprung und den Weg ins Vollbild. Kein
  // Navigieren des Hauptfensters, keine Popups.
  rahmen.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation");
  rahmen.setAttribute("allow", "autoplay; encrypted-media; fullscreen; picture-in-picture");
  rahmen.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  rahmen.setAttribute("allowfullscreen", "");
  rahmen.title = titel ? `Trailer zu ${titel}` : "Trailer";
  trailerRahmen?.replaceChildren(rahmen);
  if (trailerTitel) trailerTitel.textContent = titel || "Trailer";
  if (trailerEyebrow) {
    trailerEyebrow.textContent = trailer?.name ? `Trailer · ${trailer.name}` : "Trailer";
  }
  trailerModal.showModal();
  return true;
}

// Ausraeumen und nicht bloss zumachen: ein Rahmen, der weiterhin im Dokument
// steht, spielt weiter - man hoert dann einen Trailer, den man nicht mehr
// sieht.
function trailerSchliessen() {
  trailerRahmen?.replaceChildren();
  if (trailerModal?.open) trailerModal.close();
}

/**
 * Den Trailer zu einem Titel suchen und abspielen.
 *
 * <p>Gefragt wird mit Titel und Adresse und nicht mit einer Kennung aus der
 * Mediathek: ein Vorschlag auf der Startseite hat keine, und gerade dort wird
 * der Trailer gebraucht - er ist die Frage, die man zu einem unbekannten Titel
 * hat ("was ist das?"), waehrend man den eigenen laengst kennt.
 *
 * <p>Gefragt wird erst beim Klick. Die Metadaten aller Kacheln vorab zu holen,
 * nur damit ein Menuepunkt vielleicht dasteht, waere ein Abruf je Kachel - und
 * die allermeisten davon fuer einen Knopf, den niemand drueckt.
 */
async function trailerZeigen(titel, url) {
  const name = String(titel || "");
  const antwort = await api.getTrailer?.(name, url).catch(() => null);
  if (trailerOeffnen(antwort?.trailer, name)) return;
  showToast(trailerGrundText(antwort?.grund, name));
}

// Warum keiner kommt - und was man dagegen tun kann.
//
// "Kein Trailer hinterlegt" war als einzige Auskunft falsch: gemeldet wurde ein
// Film, zu dem TMDB einen deutschen Trailer fuehrt. Der Grund lag woanders, und
// eine Meldung, die den falschen Grund nennt, schickt den Leser in die Irre.
function trailerGrundText(grund, name) {
  if (grund === "kein-dienst") {
    return "Für Trailer braucht ELFIX den Metadaten-Dienst — trage ihn in den Einstellungen unter Watchparty ein";
  }
  if (grund === "dienst-zu-alt") {
    return "Dein Metadaten-Dienst kennt noch keine Trailer — Relay auf 1.89.1 aktualisieren und neu starten";
  }
  if (grund === "nicht-zugeordnet") {
    return `„${name}“ ließ sich keinem Werk zuordnen — deshalb auch kein Trailer`;
  }
  if (grund === "fehler") {
    return `Der Trailer zu „${name}“ ließ sich gerade nicht holen`;
  }
  // Und der ehrliche Rest: es gibt wirklich keinen.
  return `Zu „${name}“ ist kein Trailer hinterlegt`;
}

function trailerZuEintragZeigen(favorite) {
  return trailerZeigen(displayFavoriteTitle(favorite), favorite?.url);
}

// Der persoenliche Verlauf eines Titels.
//
// Gezeigt wird derselbe Kasten wie bei einer Rueckfrage, nur ohne zweite
// Schaltflaeche - hier gibt es nichts zu entscheiden, nur etwas zu lesen.
//
// Was der Kasten zeigt, entscheidet er nicht selbst: die Zusammenfassung der
// Ereignisse zu Folgeneintraegen und die Statusrechnung stehen in
// shared/verlauf.js. Hier steht nur, wie das Ergebnis aussieht.
async function zeigeVerlauf(favorite) {
  // Erst zeichnen, dann nachfragen: die Metadaten koennen einen Netzabruf
  // kosten, und ein Kasten, der Sekunden auf sich warten laesst, ist kaputt.
  // Der Status wird nachgetragen, sobald die Antwort da ist.
  const modell = verlaufModellBauen(favorite);
  const inhalt = document.createElement("div");
  // Die Liste darf fehlen - zu einem Film gibt es keine Staffeln. Die
  // Knopfreihe steht trotzdem da: sie haengt am Titel und nicht am Verlauf.
  inhalt.append(...[titelAktionen(favorite), verlaufListeBauen(modell)].filter(Boolean));
  const geschlossen = confirmAction({
    eyebrow: "Verlauf",
    title: displayFavoriteTitle(favorite),
    copy: verlaufKopfText(modell),
    inhalt,
    confirmLabel: "Schließen",
    nurSchliessen: true,
    mehrzeilig: true
  });

  const metadaten = await api.getLibraryMetadata?.(favorite.id).catch(() => null);
  // Der Kasten kann zwischenzeitlich geschlossen worden sein - dann gehoert
  // die Antwort niemandem mehr.
  if (metadaten && confirmModal?.open) {
    confirmCopy.textContent = verlaufKopfText(verlaufModellBauen(favorite, metadaten));
    // Der Trailer kommt nach, sobald die Metadaten da sind. Er steht nicht von
    // Anfang an da, weil erst die Antwort sagt, ob es ueberhaupt einen gibt -
    // ein Knopf, der beim Druecken "nichts gefunden" sagt, ist ein schlechter
    // Knopf.
    trailerKnopfNachtragen(favorite, metadaten?.trailer);
  }
  await geschlossen;
}

/**
 * Die Knopfreihe ueber dem Verlauf: abspielen, Trailer, vormerken.
 *
 * <p>Der Kasten ist das Naechste, was ELFIX an einer Detailseite hat - er
 * traegt Titel, Stand und Verlauf. Was dort fehlte, war das, was man mit dem
 * Titel tun will; drei Wege, die es laengst gibt, standen nur im Menue der
 * Kachel dahinter.
 */
function titelAktionen(favorite) {
  const reihe = document.createElement("div");
  reihe.className = "titel-aktionen";

  const knopf = (klasse, text, tun) => {
    const feld = document.createElement("button");
    // Ausdruecklich kein "submit": der Kasten steht in einem Formular, und ein
    // gewoehnlicher Knopf darin schloesse ihn bei jedem Klick.
    feld.type = "button";
    feld.className = klasse;
    feld.textContent = text;
    feld.addEventListener("click", tun);
    reihe.append(feld);
    return feld;
  };

  knopf("primary-action", "▶ Abspielen", () => {
    confirmModal?.close();
    openFavoriteEntry(favorite).catch(() => {});
  });

  if (!favorite.favorite) {
    knopf("soft-action", "♡ Auf die Watchlist", async (ereignis) => {
      const ergebnis = await api.setFavoriteWatchlist?.(favorite.id, true).catch(() => null);
      if (!ergebnis?.favorite) {
        showToast("Konnte nicht vorgemerkt werden");
        return;
      }
      favorites = ergebnis.favorites || favorites;
      renderFavorites();
      renderHome();
      renderLibraryViews();
      renderFavoriteToggle();
      ereignis.currentTarget.remove();
      showToast(`„${displayFavoriteTitle(favorite)}“ steht auf der Watchlist`);
    });
  }
  return reihe;
}

// Den Trailer-Knopf in die Reihe haengen, sobald die Metadaten da sind.
function trailerKnopfNachtragen(favorite, trailer) {
  const reihe = confirmBody?.querySelector(".titel-aktionen");
  if (!reihe || !trailerAdresse(trailer)) return;
  const feld = document.createElement("button");
  feld.type = "button";
  feld.className = "soft-action";
  feld.textContent = "▷ Trailer";
  feld.addEventListener("click", () => {
    trailerOeffnen(trailer, displayFavoriteTitle(favorite));
  });
  // Hinter "Abspielen", vor der Watchlist: erst das Werk, dann die Vorschau,
  // dann das Vormerken.
  reihe.insertBefore(feld, reihe.children[1] || null);
}

function verlaufModellBauen(favorite, metadaten = null) {
  if (!verlaufModul) return null;
  return verlaufModul.verlaufBauen(favorites, favorite, { metadaten });
}

const VERLAUF_STATUSTEXT = {
  AUF_AKTUELLEM_STAND: "Auf aktuellem Stand",
  STAFFEL_ABGESCHLOSSEN: "Staffel abgeschlossen",
  SERIE_ABGESCHLOSSEN: "Serie abgeschlossen",
  // Unbekannt bleibt unbeschriftet. Eine Zeile "Status unbekannt" waere fuer
  // den Leser kein Gewinn - sie sagt nur, dass hier nichts steht.
  STATUS_UNBEKANNT: ""
};

// Die Zusammenfassung ueber der Liste. Jede Zeile darf fehlen: was sich aus
// den vorhandenen Daten nicht belegen laesst, steht nicht da.
function verlaufKopfText(modell) {
  if (!modell) return "";
  const zeilen = [];

  if (modell.istSerie) {
    // "X von Y" nur, wenn Y wirklich bekannt ist. Bei mehreren Staffeln nennt
    // der Anbieter keine Gesamtzahl, und eine geschaetzte waere erfunden.
    zeilen.push(modell.verfuegbar
      ? `${modell.gesehenGesamt} von ${modell.verfuegbar} aktuell verfügbaren Folgen gesehen`
      : `${modell.gesehenGesamt} ${modell.gesehenGesamt === 1 ? "Folge" : "Folgen"} gesehen`);
  } else if (modell.filmAbgeschlossen) {
    zeilen.push("Abgeschlossen");
  }

  const status = VERLAUF_STATUSTEXT[modell.status] || "";
  if (status) zeilen.push(status);

  // Ein Datum wird nur genannt, wenn es eines gibt. Ohne verlaessliche Angabe
  // steht hier nichts - erfunden wird keines.
  if (modell.naechsteFolge?.zeit) {
    zeilen.push(`Nächste Folge am ${datumKurz(new Date(modell.naechsteFolge.zeit))}`);
  }

  if (modell.zuletztGesehen) {
    // In der Liste steht die Folge unter ihrer Staffelueberschrift, hier nicht.
    // Bei mehreren Staffeln muss die Nummer deshalb mit - "Folge 1" allein
    // waere bei vier Staffeln keine Auskunft.
    const wo = modell.staffeln.length > 1
      ? `Staffel ${modell.zuletztGesehen.staffel} ${folgeName(modell.zuletztGesehen)}`
      : folgeName(modell.zuletztGesehen);
    zeilen.push(`Zuletzt gesehen: ${wo} am ${datumKurz(new Date(modell.zuletztGesehen.zuletzt))}`);
  } else if (!modell.istSerie && modell.filmZeit) {
    zeilen.push(`Zuletzt gesehen: ${datumKurz(new Date(modell.filmZeit))}`);
  }

  if (modell.tage) {
    zeilen.push(`An ${modell.tage} ${modell.tage === 1 ? "Tag" : "Tagen"} geschaut`);
  }

  return zeilen.join("\n");
}

function folgeName(satz) {
  return `Folge ${satz.folge}`;
}

// "12:41" oder "1:02:41" - so, wie ein Player die Stelle schreibt.
function verlaufZeitspanne(sekunden) {
  const ganz = Math.max(0, Math.round(Number(sekunden) || 0));
  const stunden = Math.floor(ganz / 3600);
  const minuten = Math.floor((ganz % 3600) / 60);
  const rest = ganz % 60;
  const zwei = (wert) => String(wert).padStart(2, "0");
  return stunden ? `${stunden}:${zwei(minuten)}:${zwei(rest)}` : `${minuten}:${zwei(rest)}`;
}

// Was eine Folge ueber sich sagt: abgeschlossen, oder wie weit sie lief.
function verlaufFolgeStand(satz) {
  if (satz.abgeschlossen) return "Abgeschlossen";
  if (satz.position && satz.dauer) {
    return `${verlaufZeitspanne(satz.position)} von ${verlaufZeitspanne(satz.dauer)}`;
  }
  // Der Verlauf belegt, dass die Folge lief, aber nicht wie weit. Das ist der
  // Normalfall bei aelteren Eintraegen - "Angesehen" behauptet nicht mehr.
  return "Angesehen";
}

// Die gegliederte Liste: Staffeln als Ueberschrift, darunter je Folge genau
// eine Zeile. Sortiert wird hoehere Staffel und hoehere Folge zuerst; das
// Datum steht dabei, ordnet aber nichts um.
function verlaufListeBauen(modell) {
  if (!modell?.staffeln?.length) return null;
  const wurzel = document.createElement("div");
  wurzel.className = "verlauf-liste";

  for (const staffel of modell.staffeln) {
    const block = document.createElement("section");
    block.className = "verlauf-staffel";
    const titel = document.createElement("h3");
    titel.textContent = staffel.nummer ? `Staffel ${staffel.nummer}` : "Folgen";
    block.append(titel);

    for (const satz of staffel.folgen) {
      const zeile = document.createElement("div");
      zeile.className = "verlauf-folge";

      const kopf = document.createElement("strong");
      kopf.textContent = `${folgeName(satz)} · ${verlaufFolgeStand(satz)}`;
      zeile.append(kopf);

      if (satz.zuletzt) {
        const wann = document.createElement("span");
        wann.textContent = `Zuletzt gesehen: ${new Date(satz.zuletzt).toLocaleString("de-DE", {
          day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
        })}`;
        zeile.append(wann);
      }

      // Der Raum steht nur dort, wo dieses Geraet die Folge wirklich in der
      // Runde mitgeschaut hat - der Eintrag, aus dem die Folge stammt, gehoert
      // dann zu ihr. Fremder Raumfortschritt kommt hier nie an: er landet im
      // Eintrag, nicht im Verlauf.
      if (satz.raum) {
        const raum = document.createElement("span");
        raum.className = "verlauf-raum";
        raum.textContent = `Mit Raum „${satz.raum}“ angesehen`;
        zeile.append(raum);
      }

      block.append(zeile);
    }
    wurzel.append(block);
  }
  return wurzel;
}

function confirmAction({ eyebrow = "ELFIX", title, copy = "", inhalt = null, confirmLabel = "Löschen", cancelLabel = "Abbrechen", nurSchliessen = false, mehrzeilig = false }) {
  if (!confirmModal?.showModal) return Promise.resolve(window.confirm(title));
  confirmEyebrow.textContent = eyebrow;
  confirmTitle.textContent = title;
  confirmCopy.textContent = copy;
  confirmCopy.classList.toggle("is-hidden", !copy);
  // Beide Merker werden bei jedem Aufruf neu gesetzt, nicht nur eingeschaltet -
  // der Kasten ist derselbe fuer alle Rueckfragen, und ein Rest vom letzten
  // Mal saehe man erst, wenn die naechste Loeschabfrage ploetzlich einspaltig
  // und ohne Abbrechen dastuende.
  confirmCopy.classList.toggle("is-mehrzeilig", Boolean(mehrzeilig));
  confirmCancel.classList.toggle("is-hidden", Boolean(nurSchliessen));
  // Aus demselben Grund wird der Platz fuer eine gegliederte Liste bei jedem
  // Aufruf geleert: sonst stuende der Verlauf des letzten Titels in der
  // naechsten Loeschabfrage.
  if (confirmBody) {
    confirmBody.replaceChildren(...(inhalt ? [inhalt] : []));
    confirmBody.classList.toggle("is-hidden", !inhalt);
  }
  confirmAccept.textContent = confirmLabel;
  confirmCancel.textContent = cancelLabel;
  return new Promise((resolve) => {
    const onClose = () => {
      confirmModal.removeEventListener("close", onClose);
      resolve(confirmModal.returnValue === "confirm");
    };
    confirmModal.addEventListener("close", onClose);
    confirmModal.returnValue = "cancel";
    confirmModal.showModal();
    window.setTimeout(() => confirmCancel.focus(), 0);
  });
}

async function clearHistory() {
  const confirmed = await confirmAction({
    eyebrow: "Verlauf",
    title: "Verlauf löschen?",
    copy: "Der Verlauf und die zuletzt gesuchten Begriffe werden entfernt. Watchlist und Weiterschauen bleiben erhalten."
  });
  if (!confirmed) return;
  const result = await api.clearHistory();
  if (!result?.cleared) return;
  favorites = result.favorites || favorites;
  searchHistory = [];
  localStorage.removeItem("elflix-search-history");
  renderSearchHistory();
  renderFavorites();
  renderLibraryViews();
  showToast("Verlauf und zuletzt gesuchte Begriffe gelöscht");
}

// Der kanonische Schluessel eines Werks - dieselbe Funktion, die auch der
// Hauptprozess, der Geraeteabgleich und das Telefon fragen. Sie kommt ueber die
// Bruecke herein (src/watchlist.js), damit hier keine fuenfte Vorstellung davon
// entsteht, wann zwei Eintraege denselben Titel meinen.
function werkSchluessel(item) {
  return api.werkSchluessel?.(item?.title, item?.url, item?.type) || "";
}

/**
 * Die Watchlist: je Werk genau eine Karte.
 *
 * <p>Und zwar die Karte des Eintrags, der das Werk vorgemerkt hat. Beides war
 * kaputt, und beides haengt zusammen (gemeldet und an der echten Ablage vom
 * 31.08.2026 nachgestellt):
 *
 * <p>Die Ablage trug drei private "Pokémon"-Eintraege, zwei davon vorgemerkt -
 * also zwei Karten. Warum es sie gab, steht im Kopf von src/watchlist.js; hier
 * wird je Werk nur noch eine gezeigt, auch wenn zwischen zwei Ladevorgaengen
 * wieder eine zweite entstanden sein sollte.
 *
 * <p>Schlimmer war das zweite: `.map(weitesterStand)` ersetzte jede Karte durch
 * einen *anderen* Eintrag - den weitesten, und das ist meist der einer
 * Watchparty-Runde. Die Karte trug damit dessen Kennung, und "Aus Watchlist
 * entfernen" traf einen Eintrag, der gar nicht auf der Watchlist stand. Beide
 * Pokémon-Karten trugen dieselbe Kennung (die des Raums "Gummikäse"), sahen
 * deshalb identisch aus und liessen sich nicht entfernen.
 *
 * <p>Der weiteste Stand wird weiterhin angezeigt - dafuer wurde er gebaut -,
 * aber er gibt nur noch den Stand vor, nicht die Kennung.
 */
function favoriteEntries() {
  const nachWerk = new Map();
  const ohneSchluessel = [];
  for (const item of favorites) {
    // Nur Privates. Ein Eintrag einer Watchparty-Runde gehoert dem Raum und
    // nie der eigenen Merkliste - dieselbe Grenze, die watchlist.liste() und
    // Bestand.watchlist() ziehen. Vorgemerkt sein *kann* er trotzdem: der
    // Herz-Knopf des Telefons hat das bis 1.71.0 getan, und ein solcher Stand
    // kann ueber den Geraeteabgleich hier ankommen.
    if (item.watchpartyRoom) continue;
    if (item.favorite === false || item.completed) continue;
    const schluessel = werkSchluessel(item);
    // Ohne Schluessel wird nichts zusammengelegt: lieber eine Karte zu viel
    // als zwei verschmolzene, die nichts miteinander zu tun haben.
    if (!schluessel) { ohneSchluessel.push(item); continue; }
    const bisher = nachWerk.get(schluessel);
    if (!bisher || String(item.createdAt || "") < String(bisher.createdAt || "")) {
      nachWerk.set(schluessel, item);
    }
  }
  return [...nachWerk.values(), ...ohneSchluessel]
    .map((item) => weitesterStand(item))
    .sort((left, right) => favoriteTimestamp(right) - favoriteTimestamp(left));
}

// Denselben Titel gibt es mehrfach: den eigenen Eintrag und je einen pro
// Watchparty-Runde. Auf der Watchlist zaehlt der weiteste Stand - steht die
// Runde bei Folge 3, waehrend der eigene noch auf Folge 1 hing, ist Folge 3
// der Stand, an dem man weitermacht. Vorher zeigte die Watchlist stur den
// eigenen Eintrag und blieb damit hinter der Gruppe zurueck.
function weitesterStand(favorite) {
  // Auch hier der kanonische Schluessel und nicht mehr ein eigener Vergleich.
  // Die Oberflaeche hatte dafuer ihre eigene Vorstellung von "dieselbe Serie"
  // (Adresse ohne Staffel und Folge, sonst der bereinigte Titel) - die vierte
  // im Haus, und jede weitere ist eine Gelegenheit, dass zwei davon
  // auseinanderlaufen.
  const schluessel = werkSchluessel(favorite);
  const gruppe = favorites.filter((anderer) => (
    anderer.id === favorite.id
      || (!anderer.completed && schluessel && werkSchluessel(anderer) === schluessel)
  ));
  if (gruppe.length < 2) return favorite;
  const bester = gruppe.reduce((kandidatBester, kandidat) => (
    folgeVergleich(kandidat, kandidatBester) > 0 ? kandidat : kandidatBester
  ), favorite);
  if (bester === favorite) return favorite;

  // Der Stand des weitesten Eintrags, die Kennung des eigenen. Alles, woran
  // eine Aktion haengt - Kennung, Merkliste, Abschluss, Raum, die gelegte
  // Stelle, das eigene Bild -, bleibt beim Eintrag der Watchlist; uebernommen
  // wird nur, was die Karte *zeigt*.
  //
  // `oeffnenId` ist die eine Ausnahme, und sie ist der Grund, warum diese
  // Zusammenlegung ueberhaupt existiert: geoeffnet wird der weiteste Stand.
  // Ohne sie stuende auf der Karte "Folge 16" und es startete Folge 12.
  return {
    ...favorite,
    oeffnenId: bester.id,
    url: bester.url,
    season: bester.season,
    episode: bester.episode,
    progress: bester.progress,
    currentTime: bester.currentTime,
    position: bester.position,
    duration: bester.duration,
    continuePending: bester.continuePending,
    lastWatchedAt: bester.lastWatchedAt || favorite.lastWatchedAt,
    openedAt: bester.openedAt || favorite.openedAt
  };
}

// Weiter heisst: hoehere Staffel, sonst hoehere Folge, sonst die spaetere
// Stelle. Ohne Folgenangabe entscheidet allein die Stelle.
function folgeVergleich(links, rechts) {
  const staffelL = Number(links?.season || 0);
  const staffelR = Number(rechts?.season || 0);
  if (staffelL !== staffelR) return staffelL - staffelR;
  const folgeL = Number(links?.episode || 0);
  const folgeR = Number(rechts?.episode || 0);
  if (folgeL !== folgeR) return folgeL - folgeR;
  return Number(links?.position || 0) - Number(rechts?.position || 0);
}

// Die Mediathek ist die Ablage fuer Serien und Filme, die man zu Ende gesehen
// hat. YouTube-Videos gehoeren da standardmaessig nicht hinein - man schaut
// dort viel und will es hinterher nicht sammeln. Sie sind trotzdem als
// abgeschlossen gemerkt, damit sie aus "Weiterschauen" verschwinden; nur
// angezeigt werden sie hier nicht.
//
// Der Schalter in den Einstellungen dreht das um, und weil hier nur gefiltert
// und nichts geloescht wird, sind die Eintraege danach sofort wieder da.
const YOUTUBE_KARTEN_HOSTS = ["youtube.com", "youtu.be", "youtube-nocookie.com"];

function istYoutubeEintrag(item) {
  try {
    const host = new URL(String(item?.url || "")).hostname.toLowerCase()
      .replace(/^www\./, "").replace(/^m\./, "").replace(/^music\./, "");
    return YOUTUBE_KARTEN_HOSTS.some((eintrag) => host === eintrag || host.endsWith(`.${eintrag}`));
  } catch {
    return false;
  }
}

// Steht gerade eine YouTube-Seite vorn? Danach richtet sich, ob die Anzeige
// der YouTube-Runde erscheint und ob der ⇄ Knopf der Serien-Watchparty
// verschwindet. Erkannt wird der Anbieter an seiner Startadresse - dieselbe
// Pruefung, mit der auch der Hauptprozess seinen YouTube-Anbieter sucht.
function aufYoutubeSeite() {
  const route = String(currentRoute || "");
  if (!route.startsWith("provider:")) return false;
  const id = route.slice("provider:".length);
  const provider = providers.find((eintrag) => String(eintrag.id) === id);
  return istYoutubeEintrag({ url: provider?.startUrl });
}

// Wie die Mediathek sortiert wird. "manuell" ist die von Hand gelegte
// Reihenfolge; die anderen drei sind nur Ansichten darauf.
//
// Der entscheidende Punkt: keine dieser Ansichten schreibt libraryOrder. Nur
// das Ziehen tut das, und Ziehen gibt es nur in "manuell". Wer sich also von
// Hand eine Reihenfolge gelegt hat, findet sie nach einem Ausflug nach A-Z
// unveraendert wieder vor - ein A-Z, das die Handarbeit ueberschriebe, waere
// keine Sortierung, sondern ein Verlust.
const MEDIATHEK_SORTIERUNGEN = [
  { wert: "manuell", titel: "Von Hand" },
  { wert: "zuletzt", titel: "Zuletzt gesehen" },
  { wert: "titel", titel: "A–Z" },
  { wert: "anbieter", titel: "Nach Anbieter" }
];

function mediathekSortierung() {
  const wert = settings?.home?.librarySort;
  return MEDIATHEK_SORTIERUNGEN.some((art) => art.wert === wert) ? wert : "manuell";
}

// Die Reihenfolge selbst - ohne DOM und ohne Zustand, damit sie sich pruefen
// laesst.
function mediathekSortieren(liste, sortierung) {
  const eintraege = [...liste];
  const titel = (favorite) => displayFavoriteTitle(favorite).toLocaleLowerCase("de");
  const anbieter = (favorite) => String(favorite?.providerName || "").toLocaleLowerCase("de");

  if (sortierung === "zuletzt") {
    return eintraege.sort((links, rechts) =>
      favoriteTimestamp(rechts) - favoriteTimestamp(links)
      || titel(links).localeCompare(titel(rechts), "de"));
  }
  if (sortierung === "titel") {
    return eintraege.sort((links, rechts) => titel(links).localeCompare(titel(rechts), "de"));
  }
  if (sortierung === "anbieter") {
    return eintraege.sort((links, rechts) =>
      anbieter(links).localeCompare(anbieter(rechts), "de")
      || titel(links).localeCompare(titel(rechts), "de"));
  }
  // Von Hand: die gespeicherte Stelle. Frisch abgeschlossene haben noch keine
  // und stehen oben, damit sie nicht unten untergehen.
  return eintraege.sort((links, rechts) => {
    const a = Number.isFinite(Number(links.libraryOrder)) ? Number(links.libraryOrder) : -1;
    const b = Number.isFinite(Number(rechts.libraryOrder)) ? Number(rechts.libraryOrder) : -1;
    if (a !== b) return a - b;
    return favoriteTimestamp(rechts) - favoriteTimestamp(links);
  });
}

// Denselben Titel gibt es absichtlich mehrfach: einmal privat und je
// Watchparty einmal. Auf der Startseite ist das getrennt - "Weiterschauen"
// und "Gemeinsam weiterschauen" sind zwei Reihen. Die Mediathek kennt diese
// Trennung nicht, und dort standen dieselben Filme dann doppelt.
//
// Hier zaehlt das Werk, nicht der Raum, in dem man es geschaut hat. Bleibt der
// private Eintrag - er traegt die von Hand gelegte Stelle und die laengere
// Geschichte. Gibt es nur einen aus einer Runde, steht eben der da.
function mediathekEntdoppeln(liste) {
  const nachWerk = new Map();
  for (const eintrag of liste) {
    // Der kanonische Schluessel, dieselbe Antwort wie ueberall sonst. Vorher
    // stand hier die normalisierte Adresse, und die trennt, was zusammengehoert:
    // steht der private Eintrag auf der letzten Folge und der einer Runde auf
    // einer anderen, sind das zwei Adressen und war es zwei Karten. Solange
    // beide zufaellig gleich endeten, fiel es nicht auf.
    //
    // Ohne Schluessel bleibt die Adresse der Rueckfall: zusammengelegt wird nur,
    // was sich sicher zuordnen laesst.
    const schluessel = werkSchluessel(eintrag) || String(eintrag.normalizedUrl || eintrag.url || eintrag.id);
    const bisher = nachWerk.get(schluessel);
    if (!bisher) {
      nachWerk.set(schluessel, eintrag);
      continue;
    }
    if (istBessererMediathekEintrag(eintrag, bisher)) nachWerk.set(schluessel, eintrag);
  }
  return [...nachWerk.values()];
}

function istBessererMediathekEintrag(neu, bisher) {
  const neuPrivat = !neu.watchpartyRoom;
  const bisherPrivat = !bisher.watchpartyRoom;
  if (neuPrivat !== bisherPrivat) return neuPrivat;
  // Beide gleich privat: der mit der gelegten Stelle, sonst der aeltere -
  // der hat die laengere Geschichte hinter sich.
  const neuStelle = Number.isFinite(Number(neu.libraryOrder));
  const bisherStelle = Number.isFinite(Number(bisher.libraryOrder));
  if (neuStelle !== bisherStelle) return neuStelle;
  return String(neu.createdAt || "") < String(bisher.createdAt || "");
}

// Gefiltert wird vor dem Sortieren: was gar nicht angezeigt wird, soll die
// Reihenfolge auch nicht mitbestimmen.
function libraryEntries(sortierung = mediathekSortierung()) {
  const youtubeErlaubt = settings.playback?.youtubeInMediathek === true;
  const sichtbar = favorites
    .filter((item) => item.completed)
    .filter((item) => youtubeErlaubt || !istYoutubeEintrag(item));
  return mediathekSortieren(mediathekEntdoppeln(sichtbar), sortierung);
}

// YouTube bekommt in der Mediathek einen eigenen Reiter, sobald die Einstellung
// es dort hineinlaesst.
//
// Der Grund ist derselbe wie auf der Startseite, wo YouTube schon eine eigene
// Reihe hat: ein Video und eine abgeschlossene Serie sind nicht dasselbe. Wer
// nachsehen will, was er durchhat, sucht Serien und Filme - und findet sie
// zwischen zwanzig nebenbei geschauten Videos nicht mehr. Getrennt bleiben
// beide auffindbar, und die Einstellung heisst weiterhin, was sie sagt: die
// Videos verschwinden nicht, sie werden abgelegt.
//
// Ist die Einstellung aus, gibt es nichts zu trennen - dann steht kein Reiter
// da, und die Mediathek sieht aus wie zuvor.
const MEDIATHEK_TABS = [
  { wert: "titel", titel: "Serien & Filme" },
  { wert: "youtube", titel: "YouTube" }
];

let mediathekTab = "titel";

function mediathekYoutubeGetrennt() {
  return settings?.playback?.youtubeInMediathek === true;
}

// Welcher Reiter gilt gerade. Ohne YouTube-Reiter gibt es nur einen, und wer
// beim Abschalten der Einstellung auf ihm stand, faellt zurueck - sonst saehe
// er eine leere Mediathek und keinen Weg zurueck.
function mediathekAktiverTab() {
  if (!mediathekYoutubeGetrennt()) return "titel";
  return mediathekTab === "youtube" ? "youtube" : "titel";
}

function mediathekTabEintraege(tab = mediathekAktiverTab(), sortierung = mediathekSortierung()) {
  const alle = libraryEntries(sortierung);
  if (!mediathekYoutubeGetrennt()) return alle;
  return alle.filter((item) => istYoutubeEintrag(item) === (tab === "youtube"));
}

async function mediathekTabSetzen(tab) {
  if (mediathekAktiverTab() === tab) return;
  mediathekTab = tab === "youtube" ? "youtube" : "titel";
  renderLibraryViews();
}

// Die Reiter selbst. Sie stehen auch dann da, wenn einer der beiden leer ist -
// sonst kaeme man von einem leergeraeumten Reiter nicht mehr weg.
function renderMediathekTabs(zahlen) {
  const leiste = document.querySelector("#libraryTabs");
  if (!leiste) return;
  const getrennt = mediathekYoutubeGetrennt();
  leiste.classList.toggle("is-hidden", !getrennt);
  if (!getrennt) {
    leiste.replaceChildren();
    return;
  }
  const jetzt = mediathekAktiverTab();
  leiste.replaceChildren(...MEDIATHEK_TABS.map((art) => {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = `calendar-day${art.wert === jetzt ? " is-active" : ""}`;
    const zahl = Number(zahlen?.[art.wert]) || 0;
    knopf.textContent = zahl ? `${art.titel} (${zahl})` : art.titel;
    knopf.addEventListener("click", () => { mediathekTabSetzen(art.wert).catch(() => {}); });
    return knopf;
  }));
}

function continueEntries() {
  return favorites
    .filter((item) => hasContinueActivity(item)
      // Ein Raum-Eintrag, den die Runde hinter sich hat: der Film ist zu Ende,
      // oder von der Serie gibt es gerade nichts Neues. Wortgleich mit
      // `hasContinueProgressRecord` in src/fortschritt.js und
      // `Favorite.stehtInWeiterschauen` auf Android - die Oberflaeche bekommt
      // die Eintraege als einfache Objekte und kann das Modul nicht laden.
      && !item.watchpartyArchived
      && (!item.completed || istWiederansehen(item))
      && !item.episodeCompleted
      && !item.hideFromContinueWatching)
    .sort((left, right) => favoriteTimestamp(right) - favoriteTimestamp(left));
}

// Laeuft dieser abgeschlossene Titel gerade wieder?
//
// Wortgleich mit `istWiederansehen` in src/fortschritt.js. Die Oberflaeche
// bekommt die Eintraege als einfache Objekte ueber die Bruecke und kann das
// Modul nicht laden; aendert sich die Regel, ist das hier die zweite Stelle.
function istWiederansehen(item) {
  return Boolean(item && item.completed && item.rewatching);
}

// Wie oft der Titel ganz durch ist: der erste Durchlauf steckt in `completed`,
// jeder weitere in `rewatchCount`. Ein gerade laufender zaehlt noch nicht mit.
function durchlaeufe(item) {
  const weitere = Math.max(0, Math.round(Number(item?.rewatchCount) || 0));
  if (!item?.completed && !weitere) return 0;
  return 1 + weitere;
}

function hasContinueActivity(item) {
  if (!item) return false;
  if (item.continuePending) return true;
  if (hasKnownMediaProgress(item)) return true;
  const progress = Number(item.progress || 0);
  const hasStoredProgress = Number.isFinite(progress) && progress > 0;
  const hasStartedHistory = Boolean(item.lastWatchedAt || item.openedAt);
  return hasStartedHistory && hasStoredProgress;
}

// Ob ueberhaupt ein brauchbarer Stand gespeichert ist. Die Prozentzahl
// entscheidet hier nicht mehr mit: ob eine Folge als gesehen gilt, steht in
// "completed"/"episodeCompleted", und danach wird in continueEntries ohnehin
// gefiltert. Mit einer Grenze bei 90 fiel ein Eintrag, der weit vorne steht
// aber nicht als gesehen zaehlt, aus der Liste - er war schlicht verschwunden.
function hasKnownMediaProgress(item) {
  const current = Number(item?.currentTime || item?.position || 0);
  const duration = Number(item?.duration || 0);
  return Number.isFinite(current)
    && Number.isFinite(duration)
    && duration > 0
    && current > 0
    && current <= duration + 3;
}

function historyEntries() {
  const rows = [];
  for (const item of favorites) {
    const activity = Array.isArray(item.activity)
      ? item.activity
      : item.lastWatchedAt ? [{ at: item.lastWatchedAt, url: item.url, label: favoriteEpisodeLabel(item.url) }] : [];
    for (const event of activity) {
      rows.push({ favorite: item, event });
    }
  }
  return rows.sort((left, right) => Date.parse(right.event.at || "") - Date.parse(left.event.at || ""));
}

// --- Verlauf: suchen, eingrenzen, nach Tagen sortiert ------------------------
const historyFilter = { suche: "", zeitraum: "all", art: "", anbieter: "" };

function historyZeitgrenze(zeitraum) {
  const jetzt = new Date();
  if (zeitraum === "today") {
    const start = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate());
    return start.getTime();
  }
  if (zeitraum === "week") return jetzt.getTime() - 7 * 24 * 60 * 60 * 1000;
  if (zeitraum === "month") return jetzt.getTime() - 30 * 24 * 60 * 60 * 1000;
  return 0;
}

function historyGefiltert(rows) {
  const suche = historyFilter.suche.trim().toLowerCase();
  const grenze = historyZeitgrenze(historyFilter.zeitraum);
  return rows.filter((eintrag) => {
    const zeit = Date.parse(eintrag.event.at || "") || 0;
    if (grenze && zeit < grenze) return false;
    if (historyFilter.anbieter && (eintrag.favorite.providerName || "") !== historyFilter.anbieter) return false;
    if (historyFilter.art && favoriteArt(eintrag.favorite) !== historyFilter.art) return false;
    if (!suche) return true;
    const heuhaufen = [
      eintrag.favorite.title,
      eintrag.favorite.providerName,
      eintrag.event.label,
      favoriteEpisodeLabel(eintrag.event.url || eintrag.favorite.url)
    ].filter(Boolean).join(" ").toLowerCase();
    return heuhaufen.includes(suche);
  });
}

function favoriteArt(favorite) {
  const typ = String(favorite?.type || "").toLowerCase();
  if (typ === "film") return "film";
  // Anime und Serie liegen beide als "serie" in der Ablage - die Adresse sagt,
  // was es ist.
  return /\/anime\//i.test(String(favorite?.url || "")) ? "anime" : "serie";
}

// Ueberschrift fuer den Tag, zu dem ein Eintrag gehoert.
function historyTagesTitel(zeit) {
  if (!zeit) return "Ohne Datum";
  const tag = new Date(zeit);
  const heute = new Date();
  const gestern = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() - 1);
  const gleicherTag = (links, rechts) => links.getFullYear() === rechts.getFullYear()
    && links.getMonth() === rechts.getMonth()
    && links.getDate() === rechts.getDate();
  if (gleicherTag(tag, heute)) return "Heute";
  if (gleicherTag(tag, gestern)) return "Gestern";
  const tageHer = Math.floor((heute - tag) / (24 * 60 * 60 * 1000));
  if (tageHer < 7) return tag.toLocaleDateString("de-DE", { weekday: "long" });
  return tag.toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
}

// Die Auswahlmarken fuer Art und Anbieter entstehen aus dem, was wirklich im
// Verlauf steht - eine leere Auswahl waere nur im Weg.
function renderHistoryFilters(alleRows) {
  const arten = [
    ["anime", "Anime"],
    ["serie", "Serien"],
    ["film", "Filme"]
  ].filter(([wert]) => alleRows.some((eintrag) => favoriteArt(eintrag.favorite) === wert));
  const anbieter = [...new Set(alleRows.map((eintrag) => eintrag.favorite.providerName).filter(Boolean))];

  const marke = (beschriftung, aktiv, beiKlick) => {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = `filter-chip${aktiv ? " is-active" : ""}`;
    knopf.textContent = beschriftung;
    knopf.addEventListener("click", beiKlick);
    return knopf;
  };

  historyTypeFilter?.replaceChildren(...(arten.length > 1 ? [
    marke("Alle Arten", !historyFilter.art, () => {
      historyFilter.art = "";
      renderLibraryViews();
    }),
    ...arten.map(([wert, text]) => marke(text, historyFilter.art === wert, () => {
      historyFilter.art = historyFilter.art === wert ? "" : wert;
      renderLibraryViews();
    }))
  ] : []));

  historyProviderFilter?.replaceChildren(...(anbieter.length > 1 ? [
    marke("Alle Anbieter", !historyFilter.anbieter, () => {
      historyFilter.anbieter = "";
      renderLibraryViews();
    }),
    ...anbieter.map((name) => marke(name, historyFilter.anbieter === name, () => {
      historyFilter.anbieter = historyFilter.anbieter === name ? "" : name;
      renderLibraryViews();
    }))
  ] : []));

  for (const knopf of historyRangeFilter?.querySelectorAll("[data-range]") || []) {
    knopf.classList.toggle("is-active", knopf.dataset.range === historyFilter.zeitraum);
  }
}

// Dieselbe Folge am selben Tag ist ein Vorgang, keine zwanzig. Frueher schrieb
// jeder Fortschritts-Takt eine eigene Zeile - der Verlauf war eine Wand aus
// derselben Angabe. Zusammengefasst steht dort die Zeitspanne und wie oft.
function historyVerdichten(rows) {
  const verdichtet = [];
  for (const eintrag of rows) {
    const zeit = Date.parse(eintrag.event.at || "") || 0;
    const label = eintrag.event.label || favoriteEpisodeLabel(eintrag.event.url || eintrag.favorite.url) || "";
    const letzter = verdichtet[verdichtet.length - 1];
    if (letzter
      && letzter.favorite.id === eintrag.favorite.id
      && letzter.label === label
      && historyTagesTitel(letzter.bis) === historyTagesTitel(zeit)) {
      // Die Liste laeuft von neu nach alt: der spaetere Zeitpunkt steht schon.
      letzter.von = Math.min(letzter.von || zeit, zeit);
      letzter.anzahl += 1;
      continue;
    }
    verdichtet.push({ favorite: eintrag.favorite, event: eintrag.event, label, von: zeit, bis: zeit, anzahl: 1 });
  }
  return verdichtet;
}

// Der Verlauf mit Tagesueberschriften. Ohne sie war es eine endlose Liste, in
// der man nicht sah, wo ein Tag aufhoert.
function historyKinder(rows) {
  const kinder = [];
  let letzterTitel = "";
  for (const eintrag of rows) {
    const titel = historyTagesTitel(eintrag.bis);
    if (titel !== letzterTitel) {
      letzterTitel = titel;
      const kopf = document.createElement("h2");
      kopf.className = "history-day";
      kopf.textContent = titel;
      const anzahl = document.createElement("small");
      const wieViele = rows.filter((item) => historyTagesTitel(item.bis) === titel).length;
      anzahl.textContent = wieViele === 1 ? "1 Eintrag" : `${wieViele} Einträge`;
      kopf.append(anzahl);
      kinder.push(kopf);
    }
    kinder.push(historyRow(eintrag));
  }
  return kinder;
}

function historyRow(item) {
  const row = document.createElement("button");
  row.className = "history-row";
  row.type = "button";
  const uhrzeit = (zeit) => new Date(zeit).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  // Innerhalb eines Tages genuegt die Uhrzeit - das Datum steht schon in der
  // Ueberschrift. Zog sich der Vorgang hin, steht die Spanne da.
  const zeitText = item.von && item.bis && item.bis - item.von >= 60000
    ? `${uhrzeit(item.von)} – ${uhrzeit(item.bis)}`
    : uhrzeit(item.bis || Date.parse(item.event.at || "") || Date.now());
  const label = item.label || item.event.label || favoriteEpisodeLabel(item.event.url || item.favorite.url);

  row.innerHTML = `
    <span>${escapeHtml(zeitText)}</span>
    <strong>${escapeHtml(cleanFavoriteTitle(item.favorite.title, item.favorite.url) || "Inhalt")}</strong>
    <em>${escapeHtml(label || item.favorite.providerName || "")}</em>
  `;
  if (item.anzahl > 1) {
    const wieOft = document.createElement("span");
    wieOft.className = "history-count";
    wieOft.textContent = `${item.anzahl}×`;
    wieOft.title = `${item.anzahl} Aufrufe an diesem Tag`;
    row.append(wieOft);
  }
  row.addEventListener("click", () => openFavoriteEntry(item.favorite));
  return row;
}

async function openFavoriteEntry(favorite, options = {}) {
  // Beim Autostart bleibt die aktuelle Seite stehen, bis der Player laeuft und
  // im Vollbild ist - das Umschalten loest dann "app:autostart-done" aus.
  const waitForAutostart = Boolean(options.autoplay);
  if (waitForAutostart) {
    autostartPending = true;
    showToast(`${displayFavoriteTitle(favorite)} wird gestartet …`);
  } else {
    hideContentViews();
  }

  const state = await api.openFavorite(favorite.oeffnenId || favorite.id, options);
  activeProviderId = state?.activeProviderId || activeProviderId;
  favorites = state?.favorites || favorites;
  renderProviders();
  renderFavorites();
  renderLibraryViews();
  if (autostartPending) return;
  hideContentViews();
  setCurrentRoute(`provider:${activeProviderId}`);
}

// Eine einzige Stelle, an der alle internen Ansichten verschwinden. Frueher
// zaehlte jede Ansicht die anderen selbst auf - eine neu hinzugekommene wurde
// dabei zwangslaeufig vergessen und blieb sichtbar.
function hideContentViews() {
  homeView.classList.add("is-hidden");
  globalSearchView.classList.add("is-hidden");
  favoritesView.classList.add("is-hidden");
  libraryView?.classList.add("is-hidden");
  continueView?.classList.add("is-hidden");
  historyView?.classList.add("is-hidden");
  reviewView?.classList.add("is-hidden");
  watchpartyView?.classList.add("is-hidden");
  document.querySelector("#calendarView")?.classList.add("is-hidden");
  // Beim Verlassen die Scrollposition sichern, damit "zurueck" wieder dort
  // landet, wo der Nutzer war.
  if (discoveryView && !discoveryView.classList.contains("is-hidden")) {
    entdeckungMerkeScroll();
    entdeckungBeobachter?.disconnect();
  }
  discoveryView?.classList.add("is-hidden");
}

function switchToPlayerView() {
  if (!autostartPending) return;
  autostartPending = false;
  hideContentViews();
  setCurrentRoute(`provider:${activeProviderId}`);
  renderProviders();
  window.setTimeout(syncBrowserBounds, 0);
}

function formatActivityTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Schaut gerade jemand aus der Watchparty diesen Titel, steht das auf der
// Karte - und der Balken zeigt dessen Stand, nicht den eigenen von vorhin.
// Wer schaut, meldet seinen Stand alle paar Sekunden. Bleibt das aus, ist er
// weg - zwei Minuten waren dafuer viel zu lang: der Hinweis stand noch da,
// als laengst niemand mehr dran war.
const WATCHPARTY_HINWEIS_MS = 25000;
let watchpartyHinweisTimer = 0;
let watchpartyHinweisBis = 0;

function watchpartyHint(favorite) {
  // Zuerst der Live-Stand aus der Runde - dieselbe Quelle, aus der auch der
  // Sekundentakt schoepft. Sonst baut renderHome die Karte ohne die Zeile,
  // der Takt setzt sie eine Sekunde spaeter wieder ein, und genau das
  // flackerte alle paar Sekunden.
  const live = liveKartenText(frischeMitglieder(favorite));
  if (live) return `<small class="media-progress-live">${escapeHtml(live)}</small>`;

  const wer = favorite?.watchpartyFrom;
  const wann = Date.parse(favorite?.watchpartyAt || 0) || 0;
  if (!wer || !wann) return "";
  const laeuftAb = wann + WATCHPARTY_HINWEIS_MS;
  if (Date.now() >= laeuftAb) return "";
  merkeHinweisAblauf(laeuftAb);
  return `<small class="media-progress-live">▶ ${escapeHtml(wer)} schaut gerade</small>`;
}

// Genau dann neu zeichnen, wenn der Hinweis ablaeuft. Ohne das bliebe er
// stehen, bis zufaellig etwas anderes die Ansicht erneuert - und genau das
// passiert nicht mehr, sobald der andere aufgehoert hat.
function merkeHinweisAblauf(bis) {
  if (watchpartyHinweisTimer && watchpartyHinweisBis <= bis) return;
  window.clearTimeout(watchpartyHinweisTimer);
  watchpartyHinweisBis = bis;
  watchpartyHinweisTimer = window.setTimeout(() => {
    watchpartyHinweisTimer = 0;
    watchpartyHinweisBis = 0;
    renderHome();
    renderLibraryViews();
  }, Math.max(250, bis - Date.now()));
}

// Titel und Runde als Kennung - dieselbe Bildung wie beim Ablegen des Stands.
function watchpartyKarteSchluessel(favorite) {
  return `${watchpartySerieSchluessel(favorite)}|${favorite?.watchpartyRoom || ""}`;
}

// Die Kachel kennt ihren Raum-Schluessel nicht direkt; der Live-Stand kommt
// aber unter dem Schluessel der Runde. Beides trifft sich ueber den Titel.
function watchpartySerieSchluessel(favorite) {
  const treffer = watchpartyItems.find((item) => (
    item.room === favorite?.watchpartyRoom
    && normalisierterTitel(item.title) === normalisierterTitel(favorite?.title)
  ));
  return treffer?.key || "";
}

function normalisierterTitel(wert) {
  return String(wert || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Was gerade in einer Runde passiert, in Worte gefasst: wer schaut, wer haelt
// an. Das eigene Geraet bleibt aussen vor - man weiss selbst, was man tut.
function liveKartenText(mitglieder) {
  const andere = mitglieder.filter((person) => !person.me);
  if (!andere.length) return "";
  const laufend = andere.filter((person) => !person.paused).map((person) => person.name);
  const stehend = andere.filter((person) => person.paused).map((person) => person.name);
  if (laufend.length) {
    return `▶ ${laufend.join(", ")} ${laufend.length > 1 ? "schauen" : "schaut"} gerade`;
  }
  return `❚❚ ${stehend.join(", ")} ${stehend.length > 1 ? "pausieren" : "pausiert"}`;
}

// Wer bei diesem Titel gerade meldet - fuer Kartenbau und Sekundentakt
// dieselbe Auskunft.
function frischeMitglieder(favorite) {
  if (!favorite?.watchpartyRoom) return [];
  const daten = watchpartyStandKarten.get(watchpartyKarteSchluessel(favorite));
  if (!daten) return [];
  const seit = (Date.now() - daten.empfangen) / 1000;
  return daten.members.filter((person) => Number(person.age || 0) + seit <= 20);
}

// Die Kacheln in Ort nachziehen, statt die Ansicht neu zu bauen.
function aktualisiereLiveKarten() {
  const jetzt = Date.now();
  for (const [schluessel, daten] of watchpartyStandKarten) {
    const kacheln = document.querySelectorAll(`[data-wp-karte="${CSS.escape(schluessel)}"]`);
    if (!kacheln.length) continue;
    const seit = (jetzt - daten.empfangen) / 1000;
    // Zu alt: dann meldet dort niemand mehr, und der Hinweis muss weg.
    const frisch = daten.members.filter((person) => Number(person.age || 0) + seit <= 20);
    const text = liveKartenText(frisch);
    // Die Stelle des Hosts fuehrt die Kachel - sonst die erste Meldung.
    const fuehrend = frisch.find((person) => person.host) || frisch[0];
    const stelle = fuehrend
      ? Number(fuehrend.position || 0) + (fuehrend.paused ? 0 : Number(fuehrend.age || 0) + seit)
      : 0;

    for (const kachel of kacheln) {
      // Nur den Text auffrischen. Eingefuegt wird die Zeile beim Kartenbau -
      // haenge sie hier an, wuerde jeder Neuaufbau sie wieder wegnehmen.
      const zeile = kachel.querySelector(".media-progress-live");
      if (zeile && zeile.textContent !== text) zeile.textContent = text;
      if (!fuehrend) continue;
      const dauer = Number(kachel.dataset.wpDauer || 0);
      const detail = kachel.querySelector(".media-progress-detail");
      if (detail) detail.textContent = dauer > 0 ? `${formatClock(stelle)} / ${formatClock(dauer)}` : formatClock(stelle);
      const balken = kachel.querySelector(".media-progress b");
      if (balken && dauer > 0) balken.style.width = `${Math.max(1, Math.min(100, (stelle / dauer) * 100))}%`;
    }
  }
}

function progressMarkup(favorite, options = {}) {
  if (!options.showProgress) return "";
  const live = watchpartyHint(favorite);
  if (favorite?.continuePending && !live) {
    return `<i class="media-progress" title="Nächste Folge bereit"><b style="width:0%"></b></i><small class="media-progress-detail">Nächste Folge</small>`;
  }
  const percent = favoriteProgressPercent(favorite);
  const current = Number(favorite?.currentTime || favorite?.position || 0);
  const duration = Number(favorite?.duration || 0);
  const hasStartedPlayback = Number.isFinite(current) && Number.isFinite(duration) && duration > 0 && current > 0;
  if (!Number.isFinite(percent) || (percent <= 0 && !hasStartedPlayback)) return "";
  const width = percent > 0 ? percent : 1;
  const detail = formatMediaTime(current, duration);
  return `<i class="media-progress" title="${escapeHtml(detail)}"><b style="width:${width}%"></b></i>${detail ? `<small class="media-progress-detail">${escapeHtml(detail)}</small>` : ""}${live}`;
}

function formatMediaTime(currentTime, duration) {
  const current = Number(currentTime);
  const total = Number(duration);
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return "";
  return `${formatClock(current)} / ${formatClock(total)}`;
}

function formatClock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

// --- Das Menue einer Karte ------------------------------------------------------
//
// Ein einziges Kaestchen fuer alle Karten, das am Rand des Dokuments haengt und
// nicht in der Karte. Zwei Gruende dafuer:
//
// Erstens schneidet eine Karte mit overflow:hidden alles ab, was ueber ihren
// Rand hinausragt - und ein Menue mit sechs Eintraegen ist hoeher als eine
// Karte von 220 Pixeln. Frueher lag das Menue in der Karte und wurde unten
// abgeschnitten; sichtbar war es nur, weil es die ganze Karte verdeckte.
//
// Zweitens kann ein gemeinsames Kaestchen gar nicht zweimal gleichzeitig offen
// sein. Vorher trug jede Karte ihr eigenes, und wer nacheinander auf drei
// Karten tippte, hatte drei offene Menues nebeneinander.
const kartenMenue = document.querySelector("#kartenMenue");
let kartenMenueKnopf = null;
// Zu welchem Titel das offene Menue gehoert. Es steht getrennt vom Knopf, weil
// der Knopf verschwindet, sobald die Karten neu gezeichnet werden - siehe
// kartenMenuePlatzieren().
let kartenMenueFuer = "";

function kartenMenueOeffnen(knopf, eintraege) {
  if (!kartenMenue || !eintraege.length) return;
  // Ein zweiter Klick auf denselben Knopf macht wieder zu.
  const schonOffen = kartenMenueKnopf === knopf;
  kartenMenueSchliessen();
  if (schonOffen) return;

  kartenMenueKnopf = knopf;
  kartenMenueFuer = String(knopf.dataset.menueFuer || "");
  knopf.classList.add("is-open");
  kartenMenueZeilenSetzen(eintraege);
  kartenMenue.classList.remove("is-hidden");
  kartenMenuePlatzieren();
  kartenMenue.querySelector("button")?.focus();
  requestAnimationFrame(kartenMenueNachfuehren);
}

function kartenMenueZeilenSetzen(eintraege) {
  // Stehen dieselben Eintraege schon da, bleibt alles, wie es ist - sonst
  // verloere ein Neuaufbau die Zeile, ueber der die Maus gerade steht.
  const kennung = eintraege.map((eintrag) => `${eintrag.gruppe}:${eintrag.text}`).join("\u0000");
  if (kartenMenue.dataset.stand === kennung) return;
  kartenMenue.dataset.stand = kennung;

  const kinder = [];
  let letzteGruppe = "";
  for (const eintrag of eintraege) {
    // Eine duenne Linie zwischen den Gruppen. Sie ordnet, ohne Platz zu
    // kosten: drei Bloecke lesen sich schneller als acht gleich aussehende
    // Zeilen untereinander.
    if (letzteGruppe && eintrag.gruppe !== letzteGruppe) {
      const strich = document.createElement("div");
      strich.className = "karten-menue-strich";
      kinder.push(strich);
    }
    letzteGruppe = eintrag.gruppe;

    const zeile = document.createElement("button");
    zeile.type = "button";
    zeile.setAttribute("role", "menuitem");
    if (eintrag.gefahr) zeile.className = "is-danger";
    const symbol = document.createElement("span");
    symbol.className = "karten-menue-symbol";
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = eintrag.symbol || "";
    const text = document.createElement("span");
    text.textContent = eintrag.text;
    zeile.append(symbol, text);
    zeile.addEventListener("click", async (event) => {
      event.stopPropagation();
      // Erst zu, dann handeln: fast jede dieser Aktionen zeichnet die Karten
      // neu, und das Menue haenge sonst an einem Knopf, den es nicht mehr gibt.
      kartenMenueSchliessen();
      await eintrag.tun();
    });
    kinder.push(zeile);
  }
  kartenMenue.replaceChildren(...kinder);
}

function kartenMenueSchliessen() {
  if (!kartenMenue) return;
  kartenMenueKnopf?.classList.remove("is-open");
  kartenMenueKnopf = null;
  kartenMenueFuer = "";
  kartenMenue.classList.add("is-hidden");
  kartenMenue.replaceChildren();
  delete kartenMenue.dataset.stand;
}

// Unter dem Knopf, rechtsbuendig zu ihm. Reicht der Platz nach unten nicht,
// klappt es nach oben; ueber den Fensterrand hinaus geht es nie.
function kartenMenuePlatzieren() {
  if (!kartenMenueKnopf) return;
  // Der Knopf verschwindet, sobald die Karten neu gezeichnet werden - waehrend
  // einer Watchparty geschieht das alle paar Sekunden, gemessen. Das Menue
  // deswegen zuzuklappen hiesse, es dem Benutzer mitten im Lesen wegzunehmen.
  // Stattdessen wird der Knopf derselben Karte wieder gesucht und das Menue
  // haengt sich dort ein; erst wenn es die Karte nicht mehr gibt, ist Schluss.
  if (!kartenMenueKnopf.isConnected) {
    const ersatz = kartenMenueFuer
      ? document.querySelector(`.favorite-menu[data-menue-fuer="${CSS.escape(kartenMenueFuer)}"]`)
      : null;
    if (!ersatz) {
      kartenMenueSchliessen();
      return;
    }
    kartenMenueKnopf = ersatz;
    ersatz.classList.add("is-open");
    // Die Eintraege koennen sich geaendert haben - nach dem Setzen eines
    // eigenen Bildes kommt "Ausschnitt bearbeiten" dazu. Genommen wird
    // deshalb die Liste des neuen Knopfes.
    if (Array.isArray(ersatz.kartenEintraege)) kartenMenueZeilenSetzen(ersatz.kartenEintraege);
  }
  const anker = kartenMenueKnopf.getBoundingClientRect();
  // Ist der Knopf aus dem Bild gescrollt, hat das Menue keinen Bezugspunkt
  // mehr und stuende allein im Fenster.
  if (anker.bottom <= 0 || anker.top >= window.innerHeight
    || anker.right <= 0 || anker.left >= window.innerWidth) {
    kartenMenueSchliessen();
    return;
  }
  const eigen = kartenMenue.getBoundingClientRect();
  const luft = 8;
  let oben = anker.bottom + 6;
  if (oben + eigen.height > window.innerHeight - luft) {
    oben = Math.max(luft, anker.top - eigen.height - 6);
  }
  const links = Math.min(
    Math.max(luft, anker.right - eigen.width),
    Math.max(luft, window.innerWidth - eigen.width - luft)
  );
  kartenMenue.style.left = `${Math.round(links)}px`;
  kartenMenue.style.top = `${Math.round(oben)}px`;
}

// Solange das Menue offen steht, bleibt es an seinem Knopf. Das kostet nur
// waehrend dieser Zeit etwas - und es faengt den Fall ab, dass die Karten
// darunter neu gezeichnet werden: dann gibt es den Knopf nicht mehr, und ein
// Menue ohne Knopf haette nichts, worauf es sich bezieht.
function kartenMenueNachfuehren() {
  if (!kartenMenueKnopf) return;
  kartenMenuePlatzieren();
  if (kartenMenueKnopf) requestAnimationFrame(kartenMenueNachfuehren);
}

// Von der angeklickten Stelle nach oben bis zu der Kachel, die einen
// Menueknopf traegt. Gesucht wird der Knopf selbst und nicht die Kachel: die
// Kacheln heissen je nach Ansicht anders, der Knopf heisst ueberall gleich.
// Beim Rand des Dokuments ist Schluss, damit ein Klick neben alle Kacheln
// nicht doch noch irgendeinen Knopf im Dokument findet.
function kartenMenueKnopfZu(ziel) {
  // Getroffen werden kann auch ein Textknoten; der kennt weder matches() noch
  // querySelector(), traegt aber ein Elternteil - die Schleife geht darueber
  // hinweg, statt sich daran zu verschlucken.
  let knoten = ziel;
  while (knoten && knoten !== document.body) {
    if (knoten.matches?.(".favorite-menu")) return knoten;
    const knopf = knoten.querySelector?.(":scope > .favorite-menu");
    if (knopf) return knopf;
    knoten = knoten.parentElement;
  }
  return null;
}

function kartenMenueBinden() {
  if (!kartenMenue) return;
  // Irgendwo sonst hindruecken macht zu. In der Erfassungsphase, damit es auch
  // dann greift, wenn das Ziel den Klick fuer sich behaelt - Karten tun das.
  document.addEventListener("pointerdown", (event) => {
    if (!kartenMenueKnopf) return;
    // Nicht bei einem Druck ins Menue selbst, und nicht bei einem Druck auf
    // einen Menueknopf: der entscheidet gleich selbst, ob er auf- oder zumacht.
    if (event.target.closest?.("#kartenMenue") || event.target.closest?.(".favorite-menu")) return;
    kartenMenueSchliessen();
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && kartenMenueKnopf) kartenMenueSchliessen();
  });

  // Rechtsklick irgendwo auf eine Kachel oeffnet dasselbe Menue wie der
  // Knopf mit den drei Punkten. Der Knopf ist klein und sitzt in einer Ecke;
  // wer mit der Maus arbeitet, sucht das Menue zuerst dort, wo der Zeiger
  // schon steht. Das Kaestchen haengt sich trotzdem an den Knopf und nicht an
  // den Zeiger - so steht es immer an derselben Stelle der Kachel, und die
  // Nachfuehrung beim Neuzeichnen greift unveraendert.
  document.addEventListener("contextmenu", (event) => {
    const knopf = kartenMenueKnopfZu(event.target);
    if (!knopf) return;
    event.preventDefault();
    // Der Druck der rechten Taste hat das offene Menue oben schon
    // zugemacht. Ein Rechtsklick oeffnet deshalb immer, statt zu schalten.
    if (typeof knopf.eintraegeFrisch === "function") {
      knopf.kartenEintraege = knopf.eintraegeFrisch();
    }
    const eintraege = knopf.kartenEintraege;
    if (!Array.isArray(eintraege) || !eintraege.length) return;
    kartenMenueSchliessen();
    kartenMenueOeffnen(knopf, eintraege);
  });

  // Auf Scrollen und Groessenaendern muss hier nichts horchen: solange das
  // Menue offen ist, laeuft kartenMenueNachfuehren() in jedem Bild und stellt
  // es neu unter seinen Knopf. Ein Horcher auf "scroll" waere sogar schaedlich
  // gewesen - beim Neuzeichnen springt die Scrollposition einer Reihe auf
  // Null, und das Menue ginge jedes Mal zu.
}

// Was in einer Karte steht: Titel mit Staffel und Folge, Anbieter (und Runde,
// wenn der Eintrag zu einer Watchparty gehoert), Fortschrittsbalken und
// Laufzeit. Ausgelagert, weil die Live-Vorschau im Zuschneide-Editor genau
// dieselbe Karte zeigen soll - nicht eine, die so aehnlich aussieht.
// Was im Startbanner steht. Dieselben Zeilen, die renderHomeHero() in das
// echte Banner schreibt - ausgelagert, damit die Vorschau im Zuschneide-Editor
// in der Form "Banner" wirklich wie die Startseite aussieht und nicht wie eine
// breitgezogene Karte.
function heroInhalt(favorite) {
  const titel = cleanFavoriteTitle(favorite?.title, favorite?.url) || displayFavoriteTitle(favorite);
  const folge = favoriteEpisodeLabel(favorite?.url);
  const zeile = [folge, favorite?.providerName].filter(Boolean).join(" - ") || "Gespeicherter Favorit";
  const anteil = favoriteProgressPercent(favorite);
  return `
    <div class="home-hero-content">
      <p class="eyebrow">Fortsetzen</p>
      <h1>${escapeHtml(titel)}</h1>
      <p>${escapeHtml(zeile)}</p>
      <div class="hero-progress${anteil > 0 ? "" : " is-hidden"}">
        <div><span style="width:${anteil}%"></span></div>
        <strong>${anteil > 0 ? `${anteil}%` : ""}</strong>
      </div>
      <div class="hero-actions">
        <button class="primary-action" type="button" tabindex="-1">Weiter schauen</button>
        <button class="secondary-action" type="button" tabindex="-1">Details</button>
        <button class="secondary-action" type="button" tabindex="-1">Einstellungen</button>
      </div>
    </div>
    <div class="hero-dots">
      <button type="button" tabindex="-1"></button>
      <button type="button" tabindex="-1"></button>
      <button type="button" class="is-active" tabindex="-1"></button>
    </div>
  `;
}

// Wann wurde das zuletzt geschaut? "completedAt" ist der Moment, in dem der
// Titel durch war - das ist die Angabe, die in der Mediathek zaehlt. Fehlt sie
// bei aelteren Eintraegen, tut es der letzte Fortschritt.
function gesehenAm(favorite) {
  // Nach einem weiteren Durchlauf zaehlt dessen Ende: "gesehen am" soll das
  // letzte Mal meinen, nicht das erste. Ohne diese Zeile stuende in der
  // Mediathek "3× gesehen" neben einem Datum von vor zwei Jahren.
  const roh = favorite?.rewatchedAt || favorite?.completedAt
    || favorite?.lastWatchedAt || favorite?.openedAt || "";
  const zeit = Date.parse(roh);
  return Number.isFinite(zeit) ? new Date(zeit) : null;
}

function datumKurz(datum) {
  if (!datum) return "";
  return datum.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Was auf der Karte ueber die Durchlaeufe steht.
//
// Zwei verschiedene Aussagen, und sie duerfen sich nicht vermischen:
//
//   - laeuft gerade ein weiterer Durchlauf, steht das da. Das ist der Grund,
//     warum ein Titel aus der Mediathek ueberhaupt wieder in "Weiterschauen"
//     auftaucht - ohne die Zeile saehe das nach einem Fehler aus.
//   - sonst zaehlt die Karte, wie oft der Titel ganz durch ist. Einmal ist der
//     Normalfall und wird nicht beziffert; ab dem zweiten Mal schon.
function wiederansehenMarkup(favorite) {
  if (istWiederansehen(favorite)) {
    return `<small class="favorite-rewatch">↻ ${durchlaeufe(favorite) + 1}. Durchlauf</small>`;
  }
  const male = durchlaeufe(favorite);
  if (male < 2) return "";
  return `<small class="favorite-rewatch is-ruhig">↻ ${male}× gesehen</small>`;
}

function favoriteCardInhalt(favorite, options = {}) {
  const datum = options.showWatchedDate ? datumKurz(gesehenAm(favorite)) : "";
  return `
    <strong>${escapeHtml(displayFavoriteTitle(favorite))}</strong>
    <span>${escapeHtml(favoriteHerkunft(favorite))}</span>
    ${datum ? `<small class="favorite-datum">Gesehen am ${escapeHtml(datum)}</small>` : ""}
    ${wiederansehenMarkup(favorite)}
    ${progressMarkup(favorite, options)}
  `;
}

function favoriteCard(favorite, allowRemove, options = {}) {
  const card = document.createElement("div");
  card.className = "favorite-card";
  card.tabIndex = 0;
  card.role = "button";
  card.innerHTML = favoriteCardInhalt(favorite, options);
  bildEbeneSetzen(card, favoriteBild(favorite), favoriteAusschnitt(favorite));
  // Gehoert die Kachel zu einer Runde, wird sie im Sekundentakt nachgezogen -
  // ohne die ganze Ansicht neu zu bauen, das wuerde beim Scrollen springen.
  if (favorite?.watchpartyRoom) {
    card.dataset.wpKarte = `${watchpartyKarteSchluessel(favorite)}`;
    card.dataset.wpDauer = String(Number(favorite.duration) || 0);
  }
  card.addEventListener("click", async () => {
    // Nach dem Umsortieren kommt noch ein Klick hinterher - der soll den
    // Titel nicht oeffnen.
    if (options.sortable && Date.now() - mediathekZuletztGezogen < 400) return;
    await openFavoriteEntry(favorite, {
      autoplay: Boolean(options.autoplay),
      fullscreen: Boolean(options.fullscreen)
    });
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      card.click();
    }
  });

  // Die Kennung traegt jede Karte, nicht nur die ziehbaren: sie ist der einzige
  // Weg, eine bestimmte Karte spaeter wiederzufinden - etwa nach dem Klick auf
  // eine Benachrichtigung.
  card.dataset.favoriteId = favorite.id;
  if (options.sortable) {
    card.draggable = true;
    card.title = "Zum Umsortieren ziehen";
  }

  // Die Eintraege des Kartenmenues. Sie stehen hier nur als Liste - gezeigt
  // werden sie von kartenMenueOeffnen() in einem gemeinsamen Kaestchen, das
  // nicht in der Karte haengt und deshalb auch nicht von ihr abgeschnitten
  // wird.
  //
  // Geordnet in drei Gruppen, die im Menue durch eine duenne Linie getrennt
  // sind: "vormerken" (was man mit dem Titel vorhat), "bild" (wie er
  // aussieht) und "weg" (was man wegnimmt). Das Wegnehmen steht unten - es
  // ist das Seltenste und das, was man am ehesten aus Versehen trifft.
  const eintraege = [];

  // --- vormerken ---
  //
  // Aus Weiterschauen heraus vormerken. Steht der Titel schon auf der
  // Watchlist, waere der Eintrag sinnlos - dann fehlt er.
  if (options.allowWatchlistAdd && !favorite.favorite) {
    eintraege.push({
      gruppe: "vormerken",
      // Dasselbe Herz, das der Knopf in der Kopfleiste zeigt: hohl, solange der
      // Titel nicht vorgemerkt ist. ELFIX benutzt es seit jeher als Zeichen fuer
      // die Watchlist - ein anderes Symbol waere eine zweite Sprache fuer
      // dieselbe Sache. Alle Symbole hier sind Schriftzeichen und keine
      // farbigen Bildmarken; nebeneinander bilden sie so eine ruhige Spalte,
      // statt dass jede Zeile ein buntes Abzeichen traegt.
      symbol: "♡",
      text: "Auf die Watchlist",
      tun: async () => {
        const ergebnis = await api.setFavoriteWatchlist?.(favorite.id, true).catch(() => null);
        if (!ergebnis?.favorite) {
          showToast("Konnte nicht vorgemerkt werden");
          return;
        }
        favorites = ergebnis.favorites || favorites;
        renderFavorites();
        renderHome();
        renderLibraryViews();
        renderFavoriteToggle();
        showToast(`„${displayFavoriteTitle(favorite)}“ steht auf der Watchlist`);
      }
    });
  }

  // Eine Serie, die man laengst gesehen hat, direkt abhaken - sie wandert in
  // die Mediathek, der Stand bleibt liegen.
  if (options.allowComplete && !favorite.completed) {
    eintraege.push({
      gruppe: "vormerken",
      symbol: "✓",
      text: "Als gesehen abhaken",
      tun: async () => {
        const titel = displayFavoriteTitle(favorite);
        const bestaetigt = await confirmAction({
          eyebrow: "Mediathek",
          title: `„${titel}“ als gesehen abhaken?`,
          copy: "Der Titel wandert in die Mediathek und verschwindet aus Watchlist und Weiterschauen. Der gespeicherte Stand bleibt erhalten, und auch ein erneutes Ansehen holt ihn nicht zurück — nur neue Folgen tun das.",
          confirmLabel: "Abhaken"
        });
        if (!bestaetigt) return;
        const ergebnis = await api.markFavoriteCompleted?.(favorite.id).catch(() => null);
        if (!ergebnis?.completed) {
          showToast("Konnte nicht abgehakt werden");
          return;
        }
        favorites = ergebnis.favorites || favorites;
        renderFavorites();
        renderHome();
        renderLibraryViews();
        renderFavoriteToggle();
        showToast(`„${titel}“ ist jetzt in der Mediathek`);
      }
    });
  }

  // Ein Titel in der Mediathek ist nicht zu Ende, sondern gesehen - und
  // Gesehenes sieht man wieder an. Die Karte selbst oeffnet die gespeicherte
  // Adresse, und die ist bei einer durchgeschauten Serie die letzte Folge;
  // dieser Punkt ist der Weg zum Anfang. Der Titel bleibt dabei in der
  // Mediathek und steht zusaetzlich in "Weiterschauen".
  if (options.allowRewatch && favorite.completed) {
    eintraege.push({
      gruppe: "vormerken",
      symbol: "↻",
      text: istWiederansehen(favorite) ? "Wieder von vorn beginnen" : "Nochmal von vorn ansehen",
      tun: async () => {
        const titel = displayFavoriteTitle(favorite);
        const ergebnis = await api.rewatchFromStart?.(favorite.id).catch(() => null);
        if (!ergebnis?.started) {
          showToast("Konnte nicht gestartet werden");
          return;
        }
        favorites = ergebnis.favorites || favorites;
        renderFavorites();
        renderHome();
        renderLibraryViews();
        renderFavoriteToggle();
        showToast(`„${titel}“ läuft wieder — und bleibt in der Mediathek`);
      }
    });
  }

  // --- bild ---
  //
  // Taugt das Bild der Anbieterseite nichts, nimmt man ein anderes. Ohne
  // eigenes bleibt alles wie bisher.
  if (options.allowImage !== false) {
    eintraege.push({
      gruppe: "bild",
      symbol: "▣",
      text: favorite.customThumbnail ? "Anderes Bild wählen" : "Eigenes Bild wählen",
      tun: () => eigenesBildSetzen(favorite)
    });
    if (favorite.customThumbnail) {
      eintraege.push({
        gruppe: "bild",
        symbol: "✂",
        text: "Ausschnitt bearbeiten",
        tun: () => bildAusschnittBearbeiten(favorite)
      });
      eintraege.push({
        gruppe: "bild",
        symbol: "↺",
        text: "Eigenes Bild entfernen",
        tun: () => eigenesBildEntfernen(favorite)
      });
    }
  }

  // --- weg ---
  if (options.allowContinueRemove) {
    eintraege.push({
      gruppe: "weg",
      symbol: "−",
      text: "Aus Weiterschauen entfernen",
      tun: async () => {
        favorites = await api.hideFromContinue(favorite.id);
        renderHome();
        renderLibraryViews();
        showToast("Weiterschauen auf Anfang zurueckgesetzt");
      }
    });
  }

  if (allowRemove) {
    eintraege.push({
      gruppe: "weg",
      // Und hier das volle Herz: dieser Titel steht auf der Watchlist. Das
      // Symbol zeigt den Zustand, die Beschriftung sagt, was passiert - genau
      // wie beim Knopf in der Kopfleiste.
      symbol: "♥",
      text: "Aus Watchlist entfernen",
      tun: async () => {
        favorites = await api.removeFavorite(favorite.id);
        renderFavorites();
        renderHome();
        renderLibraryViews();
        renderFavoriteToggle();
        showToast("Aus Watchlist entfernt");
      }
    });
  }

  // Der Verlauf steht nur dort, wo es auch einen gibt. Bei einem Titel, von dem
  // eine einzige Folge bekannt ist, waere ein Menuepunkt mit einer Zeile
  // dahinter nur ein Klick ins Leere - das Datum steht ja schon auf der Karte.
  //
  // Gezaehlt werden Folgen, nicht Ereignisse. Frueher entschied die Laenge des
  // Ereignisprotokolls darueber, und damit oeffnete sich der Punkt schon, wenn
  // sich der Player bei derselben Folge zweimal gemeldet hatte.
  //
  // Fuer einen Film gilt das nicht: er hat keine Folgen, und die Bedingung
  // "mehr als eine" war fuer ihn nie erfuellbar. Gemessen an der echten Ablage
  // hiess das, dass neunundzwanzig von achtundvierzig Titeln der Mediathek den
  // Punkt gar nicht mehr bekamen. Bei ihm zaehlt deshalb, woran man bei einem
  // Film ueberhaupt etwas ablesen kann - an wie vielen Tagen er lief.
  const verlaufModell = verlaufModellBauen(favorite);
  const verlaufLohnt = verlaufModell
    ? (verlaufModell.istSerie
      ? (verlaufModell.folgen?.length || 0) > 1
      : (verlaufModell.tage || 0) > 0)
    : false;
  // Der Trailer. Er steht bei jedem Eintrag zur Wahl und nicht nur dort, wo
  // einer bekannt ist: ob es einen gibt, weiss erst der Abruf, und dafuer die
  // Metadaten jeder Kachel im Voraus zu holen waere ein Netzabruf je Kachel.
  // Gibt es keinen, sagt das eine Zeile - das ist ehrlicher als ein Menue, in
  // dem der Punkt mal da ist und mal nicht.
  eintraege.push({
    gruppe: "info",
    symbol: "▷",
    text: "Trailer ansehen",
    tun: async () => {
      await trailerZuEintragZeigen(favorite);
    }
  });

  if (options.allowLibraryRemove && verlaufLohnt) {
    eintraege.push({
      gruppe: "info",
      symbol: "◷",
      text: "Verlauf ansehen",
      tun: async () => {
        await zeigeVerlauf(favorite);
      }
    });
  }

  if (options.allowLibraryRemove) {
    eintraege.push({
      gruppe: "weg",
      symbol: "✕",
      text: "Aus Mediathek löschen",
      gefahr: true,
      tun: async () => {
        const titel = displayFavoriteTitle(favorite);
        const bestaetigt = await confirmAction({
          eyebrow: "Mediathek",
          title: `„${titel}“ löschen?`,
          copy: "Der Eintrag wird mitsamt Fortschritt und Verlauf entfernt. Der Titel selbst bleibt beim Anbieter natürlich bestehen."
        });
        if (!bestaetigt) return;
        const ergebnis = await api.removeFromLibrary?.(favorite.id).catch(() => null);
        if (!ergebnis?.removed) {
          showToast("Konnte nicht gelöscht werden");
          return;
        }
        favorites = ergebnis.favorites || favorites;
        renderFavorites();
        renderHome();
        renderLibraryViews();
        renderFavoriteToggle();
        showToast(`„${titel}“ gelöscht`);
      }
    });
  }

  // Die Gruppen am Stueck und in fester Reihenfolge. Gebaut werden die
  // Eintraege in der Folge, in der die Bedingungen im Quelltext stehen, und
  // die richtet sich nach der Sache und nicht nach der Anzeige: "Aus
  // Weiterschauen entfernen" (weg) entsteht vor "Verlauf ansehen" (info).
  // Ohne diese Ordnung stuenden zwei Gruppen zweimal da, und der Trennstrich
  // im Menue traennte nichts mehr.
  //
  // Stabil sortiert: innerhalb einer Gruppe bleibt die gebaute Folge.
  const gruppenFolge = ["vormerken", "bild", "info", "weg"];
  eintraege.sort((links, rechts) =>
    gruppenFolge.indexOf(links.gruppe) - gruppenFolge.indexOf(rechts.gruppe));

  if (eintraege.length) {
    const menu = document.createElement("button");
    menu.className = "favorite-menu";
    menu.type = "button";
    menu.textContent = "⋯";
    menu.title = "Mehr zu diesem Titel";
    menu.setAttribute("aria-haspopup", "menu");
    // Beides, damit sich das Menue nach einem Neuzeichnen wieder einhaengen
    // kann: woran es haengt und was drinstehen soll.
    menu.dataset.menueFuer = favorite.id;
    menu.kartenEintraege = eintraege;
    menu.addEventListener("click", (event) => {
      event.stopPropagation();
      kartenMenueOeffnen(menu, eintraege);
    });
    card.append(menu);
  }

  queueFavoriteThumbnailRepair(favorite);
  return card;
}

function queueFavoriteThumbnailRepair(favorite) {
  if (!favorite || thumbnailRepairAttempts.has(favorite.id) || !favoriteNeedsProviderThumbnailRepair(favorite)) return;
  if (!isValidProviderThumbnail(favorite)) {
    repairFavoriteThumbnailOnce(favorite.id, false);
    return;
  }

  const probe = new Image();
  probe.onerror = () => repairFavoriteThumbnailOnce(favorite.id, true);
  // Laedt die Adresse, ist nichts zu reparieren - und ein frueherer
  // Fehlschlag war ein Aussetzer und kein Urteil.
  probe.onload = () => bildFehler.delete(favorite.thumbnail);
  probe.src = favorite.thumbnail;
}

async function repairFavoriteThumbnailOnce(favoriteId, force) {
  if (!favoriteId || thumbnailRepairAttempts.has(favoriteId)) return;
  thumbnailRepairAttempts.add(favoriteId);
  const result = await api.repairFavoriteThumbnail(favoriteId, force).catch(() => null);
  if (result?.favorites) {
    favorites = result.favorites;
  }
  // Frueher wurde die Adresse hier geleert, wenn die Reparatur nichts fand.
  // Das machte aus jedem Aussetzer - kein Netz, ein Zeitablauf, ein Anbieter
  // mit Schluckauf - einen dauerhaften Verlust: die Karte blieb leer, und da
  // keine Adresse mehr dastand, konnte sie auch nie wieder etwas anzeigen.
  // Jetzt bleibt die Adresse stehen; sichtbar ist bis zum naechsten Versuch
  // die Ersatzgrafik, und der naechste Versuch ist ueberhaupt moeglich.
  if (!result?.repaired) {
    thumbnailRepairAttempts.delete(favoriteId);
  }
  renderFavorites();
  renderHome();
  renderLibraryViews();
}

function isStoFavorite(favorite) {
  const name = String(favorite?.providerName || "").toLowerCase();
  const url = String(favorite?.url || "");
  return name.includes("s.to") || /^https?:\/\/(?:[^/]*\.)?s\.to\//i.test(url) || /^https?:\/\/\d{1,3}(?:\.\d{1,3}){3}\//.test(url);
}

function isAniWorldFavorite(favorite) {
  const name = String(favorite?.providerName || "").toLowerCase();
  const url = String(favorite?.url || "");
  return name.includes("aniworld") || /^https?:\/\/(?:[^/]*\.)?aniworld\./i.test(url);
}

function favoriteNeedsProviderThumbnailRepair(favorite) {
  // Ein selbst gewaehltes Bild wird nie ersetzt.
  if (favorite?.customThumbnail) return false;
  return isStoFavorite(favorite) || isAniWorldFavorite(favorite);
}

function isValidProviderThumbnail(favorite) {
  if (isStoFavorite(favorite)) return isValidStoThumbnail(favorite.thumbnail);
  if (isAniWorldFavorite(favorite)) return isValidAniWorldThumbnail(favorite.thumbnail);
  return Boolean(favorite?.thumbnail);
}

function isValidStoThumbnail(value) {
  try {
    const url = new URL(String(value || ""));
    return /\/media\/images\/channel\/(?:2x-)?desktop\/[^/?#]+/i.test(url.pathname);
  } catch {
    return false;
  }
}

function isValidAniWorldThumbnail(value) {
  try {
    const url = new URL(String(value || ""));
    return url.hostname.toLowerCase().includes("aniworld")
      && !/(?:logo|favicon|sprite|icon|avatar|flag|placeholder|blank|transparent|loading|spinner|play|button|rating|language|login|register|facebook|twitter|og-image|social|share|default|noimage|no-image)/i.test(url.href)
      && /\/public\/img\/cover\/[^/?#]+\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

async function toggleFavorite() {
  const result = await api.toggleCurrentFavorite();
  favorites = result.favorites || favorites;
  renderFavorites();
  renderHome();
  renderLibraryViews();
  renderFavoriteToggle();
  showToast(result.added ? "Zur Watchlist hinzugefügt" : "Aus Watchlist entfernt");
}

// Steht die offene Seite auf der Watchlist?
//
// Gefragt wird nach dem Werk und nicht nach der Adresse. Vorher verglich diese
// Zeile die offene Adresse mit der Adresse der Karte - und die Karte zeigt den
// weitesten Stand. Wer bei Folge 1 stand, waehrend die Karte Folge 16 trug,
// bekam ein leeres Herz fuer einen Titel, der laengst vorgemerkt war; ein Druck
// darauf legte dann einen zweiten Eintrag an, statt den vorhandenen
// herunterzunehmen.
function renderFavoriteToggle() {
  const button = document.querySelector("#favoriteButton");
  const offen = currentUrl ? werkSchluessel({ url: currentUrl }) : "";
  const active = Boolean(offen && favorites.some((favorite) => favorite.favorite !== false
    && !favorite.completed
    && !favorite.watchpartyRoom
    && werkSchluessel(favorite) === offen));
  button.classList.toggle("is-active", active);
  button.textContent = active ? "♥" : "♡";
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  toastStack.append(toast);
  window.setTimeout(() => {
    toast.remove();
  }, 2600);
}

async function openActiveProvider() {
  const active = providers.find((provider) => provider.id === activeProviderId && provider.enabled !== false)
    || providers.find((provider) => provider.enabled !== false);
  if (!active) {
    openSettings();
    return;
  }
  hideContentViews();
  await api.setShellOpen(false);
  await api.openProvider(active.id);
}

async function openSearchView() {
  await enterInternalMode();
  setCurrentRoute("search");
  const value = omnibox.value.trim();
  if (value && !looksLikeUrl(value)) {
    await showGlobalSearch(value);
    return;
  }
  hideContentViews();
  globalSearchView.classList.remove("is-hidden");
  searchTitle.textContent = "Suchen";
  renderSearchHistory();
  globalSearchGrid.replaceChildren(emptyText("Suchbegriff oben eingeben und Enter drücken."));
  omnibox.focus();
  omnibox.select();
}

function setCurrentRoute(route) {
  currentRoute = route || "start";
  renderRouteActiveState();
}

// Favorit, Watchparty, Stop und Vollbild gehoeren zur offenen Anbieterseite.
// Auf Startseite, Suche oder in der Mediathek gibt es nichts, worauf sie sich
// beziehen koennten - dort sind sie weg.
function renderChromeButtons() {
  const aufSeite = String(currentRoute || "").startsWith("provider:");
  for (const auswahl of ["#favoriteButton", "#watchpartyShareButton", "#stopButton", "#fullscreenButton"]) {
    document.querySelector(auswahl)?.classList.toggle("is-hidden", !aufSeite);
  }
  // Auf YouTube faellt der ⇄ Knopf weg: er stellt einen Titel in einen Raum,
  // und ein YouTube-Video ist keiner. Dort fuehrt der einzige Weg in die Runde
  // ueber deren eigene Anzeige, die im selben Zug mitgezogen wird.
  document.querySelector("#watchpartyShareButton")?.classList
    .toggle("is-hidden", !aufSeite || aufYoutubeSeite());
  renderYoutubePartyBanner();
}

function renderRouteActiveState() {
  renderChromeButtons();
  document.querySelectorAll("[data-home-action]").forEach((button) => {
    const route = sidebarRouteForAction(button.dataset.homeAction);
    button.classList.toggle("is-active", route === currentRoute);
  });
  document.querySelectorAll(".provider-side-link").forEach((button) => {
    button.classList.toggle("is-active", currentRoute === `provider:${button.dataset.providerId}`);
  });
}

// Serien, zu denen seit dem Abschliessen etwas Neues erschienen ist.
function neueFolgenEintraege() {
  return favorites
    .filter((favorite) => favorite.newEpisodeAt)
    .sort((links, rechts) => Date.parse(rechts.newEpisodeAt || 0) - Date.parse(links.newEpisodeAt || 0));
}

// Auf der Startseite eine eigene Reihe, in der Seitenleiste eine Zahl an der
// Watchlist - dort landen die Serien wieder, wenn Nachschub kommt.
function renderNewEpisodes() {
  const neue = neueFolgenEintraege();
  newEpisodeRow?.classList.toggle("is-hidden", neue.length === 0);
  homeNewEpisodes?.replaceChildren(...neue.slice(0, 8).map((favorite) => {
    const karte = favoriteCard(favorite, false, { autoplay: true, fullscreen: true });
    const fahne = document.createElement("span");
    fahne.className = "new-episode-flag";
    fahne.textContent = favorite.newEpisodeLabel || "Neue Folge";
    karte.append(fahne);
    return karte;
  }));

  if (watchlistBadge) {
    watchlistBadge.textContent = neue.length > 9 ? "9+" : String(neue.length);
    watchlistBadge.classList.toggle("is-hidden", neue.length === 0);
    watchlistBadge.title = neue.length === 1
      ? "Zu einer Serie gibt es neue Folgen"
      : `Zu ${neue.length} Serien gibt es neue Folgen`;
  }
}

async function dismissNewEpisodes() {
  favorites = await api.clearNewEpisodeHint?.().catch(() => favorites) || favorites;
  renderHome();
  renderFavorites();
}

function sidebarRouteForAction(action) {
  if (action === "favorites") return "watchlist";
  if (action === "continue") return "continue";
  if (action === "watchparty") return "watchparty";
  if (action === "library") return "library";
  if (action === "history") return "history";
  if (action === "review") return "review";
  if (action === "search") return "search";
  // Ohne diese Zeile faellt "calendar" auf "start" zurueck - dann leuchteten
  // Startseite und Kalender gleichzeitig.
  if (action === "calendar") return "calendar";
  if (action === "settings") return "settings";
  if (action === "add-provider") return "add-provider";
  if (action === "help") return "help";
  return "start";
}

function applySidebarState() {
  const collapsed = localStorage.getItem("elfix-sidebar-collapsed") === "true"
    || (window.innerWidth < 980 && localStorage.getItem("elfix-sidebar-collapsed") !== "false");
  appShell?.classList.toggle("sidebar-collapsed", collapsed);
  appSidebar?.setAttribute("aria-expanded", collapsed ? "false" : "true");
  if (sidebarToggle) {
    // Bei einer Leiste rechts zeigt der Pfeil spiegelverkehrt - sonst deutet er
    // beim Einklappen in die falsche Richtung.
    const rechts = appShell?.classList.contains("navstyle-sidebarRight");
    sidebarToggle.textContent = collapsed === Boolean(rechts) ? "‹" : "›";
    sidebarToggle.title = collapsed ? "Seitenleiste ausklappen" : "Seitenleiste einklappen";
  }
  if (homeSidebarToggle) {
    homeSidebarToggle.title = collapsed ? "Sidebar ausklappen" : "Sidebar einklappen";
  }
  window.setTimeout(syncBrowserBounds, 180);
}

function toggleSidebar() {
  const collapsed = !appShell?.classList.contains("sidebar-collapsed");
  localStorage.setItem("elfix-sidebar-collapsed", collapsed ? "true" : "false");
  applySidebarState();
}

async function navigateFromOmnibox() {
  const value = omnibox.value.trim();
  if (!value) {
    await showHome();
    return;
  }

  if (!looksLikeUrl(value)) {
    await showGlobalSearch(value);
    return;
  }

  hideContentViews();
  await api.setShellOpen(false);
  const state = await api.navigate(value);
  omnibox.value = "";
  if (state?.activeProviderId) {
    activeProviderId = state.activeProviderId;
    renderProviders();
  }
}

function syncBrowserBounds() {
  const rect = browserFrame.getBoundingClientRect();
  api.setBrowserBounds({
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  });
}

// Eine gemerkte Ansicht wieder aufbauen. Anbieterseiten zaehlen nicht dazu:
// beim Wechsel in die Einstellungen werden ihre Ansichten geschlossen.
function zeigeAnsicht(route) {
  switch (route) {
    case "watchparty": return showWatchparty();
    case "library": return showLibrary();
    case "continue": return showContinue();
    case "history": return showHistory();
    case "review": return showReview();
    case "watchlist": return showFavorites();
    case "calendar": return showCalendar();
    default: return showHome();
  }
}

async function openSettings(route = "settings") {
  if (!settingsModal.open && currentRoute !== "settings" && currentRoute !== "add-provider") {
    routeBeforeSettings = currentRoute?.startsWith("provider:") ? "start" : currentRoute;
  }
  await enterInternalMode();
  setCurrentRoute(route);
  renderSettings();
  if (!settingsModal.open) {
    await api.setSettingsOpen(true);
    settingsModal.showModal();
    window.setTimeout(() => {
      const focusTarget = settingsModal.querySelector("input, select, button, textarea");
      focusTarget?.focus();
    }, 0);
  }
}

function closeSettings() {
  settingsModal.close();
}

function renderSettings() {
  renderProviderSettingsList();
  renderProviderForm();
  const appearance = { ...DEFAULT_APPEARANCE_SETTINGS, ...(settings.appearance || {}) };
  const home = { ...DEFAULT_HOME_SETTINGS, ...(settings.home || {}) };
  const browser = settings.browser || {};
  adblockEnabled.checked = Boolean(settings.adblock?.enabled);
  trackingEnabled.checked = Boolean(settings.adblock?.trackingProtection);
  popupBlockingEnabled.checked = settings.adblock?.blockPopups !== false;
  redirectBlockingEnabled.checked = settings.adblock?.blockRedirects !== false;
  whitelistInput.value = (settings.adblock?.whitelist || []).join("\n");
  cacheMode.value = browser.cacheMode || "aggressive";
  pauseOnProviderSwitch.checked = settings.playback?.pauseOnProviderSwitch !== false;
  if (youtubeInMediathek) youtubeInMediathek.checked = settings.playback?.youtubeInMediathek === true;
  if (autoplayNextEpisode) autoplayNextEpisode.checked = settings.playback?.autoplayNextEpisode !== false;
  if (introSkip) introSkip.checked = settings.playback?.introSkip !== false;
  for (const [name, feld] of Object.entries(sponsorblockFelder)) {
    if (feld) feld.checked = settings.sponsorblock?.[name] ?? SPONSORBLOCK_STANDARD[name];
  }
  renderMarkenStand();
  if (rememberLanguage) rememberLanguage.checked = settings.playback?.rememberLanguage !== false;
  renderFassungenStand();
  // Aus, solange nichts anderes dasteht - eine Meldung, die man nicht bestellt
  // hat, ist eine Stoerung.
  if (notifyNewEpisodes) notifyNewEpisodes.checked = settings.notifications?.newEpisodes === true;
  favoriteProgressMode.value = settings.playback?.favoriteProgressMode || "sequential";
  pauseOnMinimize.checked = Boolean(settings.playback?.pauseOnMinimize);
  pauseOnBlur.checked = Boolean(settings.playback?.pauseOnBlur);
  if (settingsMode) settingsMode.value = "advanced";
  if (designPreset) designPreset.value = appearance.designPreset || "elfix";
  if (designPresetInline) designPresetInline.value = appearance.designPreset || "elfix";
  if (autoDeriveColors) autoDeriveColors.checked = appearance.autoDeriveColors !== false;
  if (autoDeriveColorsInline) autoDeriveColorsInline.checked = appearance.autoDeriveColors !== false;
  if (autoCollapseSidebar) autoCollapseSidebar.checked = appearance.autoCollapseSidebar !== false;
  themeMode.value = appearance.themeMode || "dark";
  compactHeader.checked = Boolean(appearance.compactHeader);
  accentPreset.value = appearance.accentPreset || "blue";
  accentColor.value = normalizeColor(appearance.accentColor || "#147eff");
  accentHex.value = normalizeColor(appearance.accentColor || "#147eff");
  accentStrength.value = String(appearance.accentStrength ?? 70);
  setRangeChoice("uiDensity", appearance.uiDensity || "comfortable");
  setRangeChoice("cardSize", appearance.cardSize || "medium");
  setRangeChoice("favoriteSize", appearance.favoriteSize || "medium");
  favoriteLayout.value = appearance.favoriteLayout || "grid";
  setRangeChoice("favoriteTextSize", appearance.favoriteTextSize || "medium");
  favoriteArtwork.value = appearance.favoriteArtwork || "balanced";
  cornerStyle.value = appearance.cornerStyle || "soft";
  backgroundStyle.value = appearance.backgroundStyle || "cinema";
  backgroundColor.value = normalizeColor(appearance.backgroundColor || "#070a10", "#070a10");
  setAdvancedAppearanceControls(appearance);
  fontScale.value = String(appearance.fontScale ?? 100);
  animationMode.value = appearance.animationMode || (appearance.animations === false ? "off" : "full");
  cardStyle.value = appearance.cardStyle || "standard";
  shadowStyle.value = appearance.shadowStyle || "standard";
  showProviderStrip.checked = appearance.showProviderStrip !== false;
  if (showProviderStripNav) showProviderStripNav.checked = appearance.showProviderStrip !== false;
  showHeroHome.checked = home.showHero !== false;
  showHomeYoutube.checked = home.showYoutube !== false;
  showHomeFavorites.checked = home.showFavorites !== false;
  if (showHomePersonal) showHomePersonal.checked = home.showPersonal !== false;
  if (showHomeCategories) showHomeCategories.checked = home.showCategories !== false;
  if (showReviewLink) showReviewLink.checked = home.showReview === true;
  if (wrappedMusik) wrappedMusik.checked = settings.wrapped?.musik !== false;
  const party = settings.watchparty || {};
  if (watchpartyEnabled) watchpartyEnabled.checked = party.enabled === true;
  if (watchpartyServer) watchpartyServer.value = party.serverUrl || "";
  watchpartyRaeume = raumcodes(party.rooms?.length ? party.rooms : [party.room]);
  if (watchpartyRoom) watchpartyRoom.value = "";
  renderWatchpartyRaeume();
  if (watchpartyName) watchpartyName.value = party.deviceName || "";
  providerCardMeta.value = home.providerCardMeta || "logoName";
  showFavoriteMeta.checked = appearance.showFavoriteMeta !== false;
  animationsEnabled.checked = appearance.animations !== false && animationMode.value !== "off";
  filterStatus.textContent = settings.adblock?.lastUpdated ? `Letztes Update: ${settings.adblock.lastUpdated}` : "";
  filterListNames.replaceChildren(...filterLists.map((list) => {
    const row = document.createElement("div");
    row.textContent = `${list.name} · ${list.url}`;
    return row;
  }));
  syncRangeLabels();
  syncAdvancedAppearanceLabels();
  syncInlineLabels();
  syncChoiceCards(appearance);
  document.querySelector(".settings-shell")?.classList.toggle("is-advanced-settings", appearance.settingsMode === "advanced");
  renderSettingsSearch();
  renderUpdateInfo();
  renderBlocked();
}

function renderProviderSettingsList() {
  providerSettingsList.replaceChildren();
  providers.forEach((provider, index) => {
    const item = document.createElement("button");
    item.className = `list-item provider-list-item${index === selectedProviderIndex ? " is-active" : ""}`;
    item.type = "button";
    item.draggable = true;
    item.dataset.index = String(index);
    item.innerHTML = `
      <span class="drag-handle" aria-hidden="true">☰</span>
      <span class="provider-list-logo">${escapeHtml(provider.logo || provider.name.slice(0, 2).toUpperCase())}</span>
      <span class="provider-list-text">
        <strong>${escapeHtml(provider.name)}</strong>
        <small>${escapeHtml(shortHost(provider.startUrl))}</small>
      </span>
      <span class="provider-state-dot${provider.enabled === false ? " is-off" : ""}" title="${provider.enabled === false ? "Ausgeblendet" : "Aktiv"}"></span>
    `;
    item.addEventListener("click", () => {
      selectedProviderIndex = index;
      renderSettings();
    });
    item.addEventListener("dragstart", (event) => {
      draggedProviderIndex = index;
      item.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
    });
    item.addEventListener("dragend", () => {
      draggedProviderIndex = -1;
      item.classList.remove("is-dragging");
      providerSettingsList.querySelectorAll(".is-drop-target").forEach((node) => node.classList.remove("is-drop-target"));
    });
    item.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (draggedProviderIndex !== index) item.classList.add("is-drop-target");
    });
    item.addEventListener("dragleave", () => item.classList.remove("is-drop-target"));
    item.addEventListener("drop", async (event) => {
      event.preventDefault();
      item.classList.remove("is-drop-target");
      const from = Number(event.dataTransfer.getData("text/plain"));
      await moveProviderToIndex(Number.isFinite(from) ? from : draggedProviderIndex, index);
    });
    providerSettingsList.append(item);
  });
}

function renderProviderForm() {
  const provider = providers[selectedProviderIndex];
  providerName.value = provider?.name || "";
  providerHome.value = provider?.startUrl || provider?.homeUrl || "";
  providerSearch.value = provider?.searchUrl || provider?.searchTemplate || "";
  providerLogo.value = provider?.logo || "";
  providerEnabled.checked = provider?.enabled !== false;
  providerAdblock.checked = provider?.adblockEnabled !== false;
}

async function saveProviderForm(event) {
  event.preventDefault();
  const provider = {
    id: providers[selectedProviderIndex]?.id || crypto.randomUUID(),
    name: providerName.value.trim() || providerHome.value.trim(),
    startUrl: normalizeUrl(providerHome.value.trim() || providerName.value.trim()),
    searchUrl: normalizeSearchTemplate(providerSearch.value.trim(), providerHome.value.trim() || providerName.value.trim()),
    logo: providerLogo.value.trim(),
    enabled: providerEnabled.checked,
    adblockEnabled: providerAdblock.checked,
    sortOrder: selectedProviderIndex >= 0 ? providers[selectedProviderIndex].sortOrder : providers.length,
    lastUrl: providers[selectedProviderIndex]?.lastUrl || ""
  };

  if (!isHttpUrl(provider.startUrl)) {
    showToast("Website muss eine gültige http/https-Adresse sein");
    return;
  }

  if (selectedProviderIndex >= 0) providers[selectedProviderIndex] = provider;
  else providers.push(provider);

  const saved = await api.saveProviders(providers);
  providers = saved.providers;
  activeProviderId = saved.activeProviderId;
  selectedProviderIndex = providers.findIndex((item) => item.id === provider.id);
  render();
}

async function deleteSelectedProvider() {
  if (selectedProviderIndex < 0) return;
  const provider = providers[selectedProviderIndex];
  if (!confirm(`Anbieter "${provider?.name || "Unbekannt"}" wirklich löschen?`)) return;
  providers.splice(selectedProviderIndex, 1);
  selectedProviderIndex = Math.min(selectedProviderIndex, providers.length - 1);
  const saved = await api.saveProviders(providers);
  providers = saved.providers;
  activeProviderId = saved.activeProviderId;
  render();
}

// Der Anbieter hat eine neue Adresse.
//
// Die neue steht im Feld, die alte im gespeicherten Anbieter - der Umzug ist
// also die Frage "was liegt zwischen diesen beiden?". Deshalb kein eigenes
// Eingabefeld: das waere ein zweiter Ort fuer dieselbe Angabe, und man muesste
// sie zweimal richtig eintippen.
//
// Gerechnet, gefragt und geschrieben wird im Hauptprozess. Er kennt die
// Watchlist, und die Rueckfrage soll sagen, was wirklich passiert, statt es zu
// schaetzen.
async function relocateSelectedProvider() {
  if (selectedProviderIndex < 0) return;
  const provider = providers[selectedProviderIndex];
  const neueAdresse = providerHome.value.trim();
  if (!provider?.id || !neueAdresse) return;
  const antwort = await api.relocateProvider?.(provider.id, neueAdresse);
  if (!antwort) return;
  if (!antwort.moved) {
    // Kein Grund heisst: abgebrochen. Dann hat der Benutzer gerade selbst
    // entschieden und braucht keine Meldung darueber.
    if (antwort.reason) showToast(antwort.reason);
    return;
  }
  providers = antwort.providers;
  favorites = antwort.favorites;
  render();
  const bericht = antwort.bericht;
  showToast(bericht.eintraege
    ? `Umgezogen auf ${bericht.nachWurzel} — ${bericht.eintraege} Einträge nachgezogen`
    : `Umgezogen auf ${bericht.nachWurzel}`);
}

async function moveSelectedProvider(direction) {
  const target = selectedProviderIndex + direction;
  if (selectedProviderIndex < 0 || target < 0 || target >= providers.length) return;
  await moveProviderToIndex(selectedProviderIndex, target);
}

async function moveProviderToIndex(from, to) {
  if (from < 0 || to < 0 || from >= providers.length || to >= providers.length || from === to) return;
  const [provider] = providers.splice(from, 1);
  providers.splice(to, 0, provider);
  providers.forEach((item, index) => {
    item.sortOrder = index;
  });
  selectedProviderIndex = to;
  const saved = await api.saveProviders(providers);
  providers = saved.providers;
  activeProviderId = saved.activeProviderId;
  render();
}

function shortHost(value) {
  try {
    return new URL(value).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function clearProviderForm() {
  selectedProviderIndex = -1;
  renderSettings();
}

async function saveSettings() {
  syncMirroredFavoriteControls();
  syncMirroredNavigationControls();
  syncMirroredAutoColorControls();
  syncAutoColorLock();
  const chosenAccent = normalizeColor(accentHex.value, "") || normalizeColor(accentColor.value);
  const chosenAnimationMode = animationsEnabled.checked ? animationMode.value : "off";
  settings.adblock = {
    enabled: adblockEnabled.checked,
    trackingProtection: trackingEnabled.checked,
    blockPopups: popupBlockingEnabled.checked,
    blockRedirects: redirectBlockingEnabled.checked,
    whitelist: whitelistInput.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    lastUpdated: settings.adblock?.lastUpdated || ""
  };
  settings.browser = {
    cacheMode: cacheMode.value
  };
  settings.notifications = { newEpisodes: Boolean(notifyNewEpisodes?.checked) };
  settings.playback = {
    pauseOnProviderSwitch: pauseOnProviderSwitch.checked,
    youtubeInMediathek: Boolean(youtubeInMediathek?.checked),
    // Fehlt das Kaestchen, gilt weiter, was gespeichert ist - nicht "aus".
    autoplayNextEpisode: autoplayNextEpisode ? autoplayNextEpisode.checked : settings.playback?.autoplayNextEpisode !== false,
    introSkip: introSkip ? introSkip.checked : settings.playback?.introSkip !== false,
    rememberLanguage: rememberLanguage ? rememberLanguage.checked : settings.playback?.rememberLanguage !== false,
    favoriteProgressMode: favoriteProgressMode.value,
    pauseOnMinimize: pauseOnMinimize.checked,
    pauseOnBlur: pauseOnBlur.checked
  };
  settings.home = {
    showHero: showHeroHome.checked,
    showYoutube: showHomeYoutube.checked,
    showFavorites: showHomeFavorites.checked,
    showPersonal: showHomePersonal ? showHomePersonal.checked : true,
    showCategories: showHomeCategories ? showHomeCategories.checked : true,
    showReview: Boolean(showReviewLink?.checked),
    providerCardMeta: providerCardMeta.value,
    // Die Sortierung der Mediathek hat kein Bedienelement in den
    // Einstellungen - sie wird ueber der Mediathek selbst gewaehlt. Ohne diese
    // Zeile schriebe jedes Speichern sie auf "manuell" zurueck, denn hier wird
    // settings.home vollstaendig aus den Bedienelementen neu gebaut.
    librarySort: mediathekSortierung()
  };
  // Der Merker, welches Jahr schon gesehen wurde, gehoert nicht der
  // Oberflaeche - er wuerde sonst bei jedem Speichern verlorengehen.
  settings.wrapped = {
    ...(settings.wrapped || {}),
    musik: wrappedMusik ? wrappedMusik.checked : true
  };
  settings.sponsorblock = Object.fromEntries(Object.entries(sponsorblockFelder).map(
    ([name, feld]) => [name, feld
      ? feld.checked
      : settings.sponsorblock?.[name] ?? SPONSORBLOCK_STANDARD[name]]));
  settings.watchparty = {
    enabled: watchpartyEnabled ? watchpartyEnabled.checked : false,
    serverUrl: watchpartyServer ? watchpartyServer.value.trim() : "",
    // Was noch im Eingabefeld steht, zaehlt mit: sonst geht ein eben getippter
    // Code verloren, nur weil "Raum hinzufügen" nicht gedrueckt wurde.
    rooms: raumcodes([...watchpartyRaeume, watchpartyRoom ? watchpartyRoom.value : ""]),
    deviceName: watchpartyName ? watchpartyName.value.trim() : "",
    // Die Kennung gehoert nicht ins Formular, muss aber mit: ohne sie bekommt
    // das Geraet beim Speichern eine neue und faellt in jedem Raum aus seinen
    // Mitgliedschaften - es steht dann mit altem Namen, aber fremder Kennung
    // in den Listen und muss ueberall neu beitreten.
    deviceId: settings.watchparty?.deviceId || "",
    // Wie die Kennung: die YouTube-Runde haengt am Raum, hat aber kein
    // Bedienelement in diesem Formular. Ohne diese Zeile schaltete jedes
    // Speichern der Einstellungen eine laufende YouTube-Runde ab.
    youtubeRoom: settings.watchparty?.youtubeRoom || ""
  };
  settings.appearance = {
    settingsMode: "advanced",
    // Das Preset steht bei den Farben unter Darstellung; der alte Zweitregler
    // auf der Allgemein-Seite ist entfallen.
    designPreset: designPresetInline?.value || designPreset?.value || settings.appearance?.designPreset || "elfix",
    autoDeriveColors: autoDeriveColors?.checked !== false,
    layoutStyle: settings.appearance?.layoutStyle || "standard",
    navStyle: settings.appearance?.navStyle || "sidebar",
    autoCollapseSidebar: autoCollapseSidebar?.checked !== false,
    compactHeader: compactHeader.checked,
    themeMode: themeMode.value,
    accentPreset: accentPreset.value,
    accentColor: chosenAccent,
    accentStrength: Number(accentStrength.value),
    uiDensity: getRangeChoice("uiDensity"),
    densityMode: settings.appearance?.densityMode || (settings.appearance?.layoutStyle === "custom" ? "custom" : "preset"),
    cardSize: getRangeChoice("cardSize"),
    favoriteSize: getRangeChoice("favoriteSize"),
    favoriteLayout: favoriteLayout.value,
    favoriteTextSize: getRangeChoice("favoriteTextSize"),
    favoriteArtwork: favoriteArtwork.value,
    cornerStyle: cornerStyle.value,
    backgroundStyle: backgroundStyle.value,
    backgroundColor: normalizeColor(backgroundColor.value, "#070a10"),
    ...readAdvancedAppearanceControls(),
    fontScale: Number(fontScale.value),
    animationMode: chosenAnimationMode,
    cardStyle: cardStyle.value,
    shadowStyle: shadowStyle.value,
    showProviderStrip: showProviderStrip.checked,
    showFavoriteMeta: showFavoriteMeta.checked,
    animations: chosenAnimationMode !== "off"
  };
  settings = await api.saveSettings(settings);
  applyAppearance();
  syncChoiceCards(settings.appearance || DEFAULT_APPEARANCE_SETTINGS);
  syncInlineLabels();
  renderHome();
  renderProviders();
  // Die Mediathek haengt an zwei Einstellungen: ob YouTube ueberhaupt
  // hineindarf und ob es einen eigenen Reiter bekommt. Ohne diese Zeile stand
  // die Reiterleiste erst nach dem naechsten Oeffnen richtig da.
  renderLibraryViews();
  renderRueckblickEintrag().catch(() => {});
  recoverVisibleContent();
  syncBrowserBounds();
}

function recoverVisibleContent() {
  const appViews = [
    homeView,
    globalSearchView,
    favoritesView,
    libraryView,
    continueView,
    historyView
  ].filter(Boolean);
  const hasVisibleAppView = appViews.some((view) => !view.classList.contains("is-hidden"));
  if (!hasVisibleAppView && !currentUrl) {
    appViews.forEach((view) => view.classList.toggle("is-hidden", view !== homeView));
    api.setShellOpen(true);
    renderHome();
  }
}

async function updateFilters() {
  filterStatus.textContent = "Aktualisiere...";
  const result = await api.updateFilters();
  if (!result.ok) {
    filterStatus.textContent = result.error;
    return;
  }
  settings = result.settings;
  filterLists = result.filterLists || filterLists;
  filterStatus.textContent = `${result.ruleCount} Regeln geladen`;
}

async function checkForUpdates() {
  updateCheckButton.disabled = true;
  updateStatusLabel.textContent = "Suche nach ELFIX-Updates...";
  updateProgressBar.style.width = "0%";
  updateProgressValue.textContent = "0%";
  const state = await api.checkForUpdates().catch((error) => ({
    status: "error",
    message: error?.message || "Update konnte nicht geprüft werden.",
    progress: 0
  }));
  updateState = state || updateState;
  renderUpdateInfo();
  updateCheckButton.disabled = isUpdateBusy();
}

function renderUpdateInfo() {
  if (!appVersionLabel) return;
  const version = appInfo.version || updateState.version || "";
  appVersionLabel.textContent = version ? `ELFIX ${version}` : "ELFIX";
  if (sidebarVersionLabel) sidebarVersionLabel.textContent = version ? `ELFIX ${version}` : "ELFIX";
  if (homeSidebarVersion) homeSidebarVersion.textContent = version ? `ELFIX ${version}` : "ELFIX";
  updateFeedLabel.textContent = updateState.feed || "GitHub Releases: RoveHD/elfix";
  const message = updateState.message || "Noch nicht geprüft.";
  const extra = updateState.availableVersion ? ` (${updateState.availableVersion})` : "";
  updateStatusLabel.textContent = `${message}${extra}`;
  const progress = Math.max(0, Math.min(100, Math.round(Number(updateState.progress) || 0)));
  updateProgressBar.style.width = `${progress}%`;
  updateProgressValue.textContent = `${progress}%`;
  updateCheckButton.disabled = isUpdateBusy();
  updateReleaseLink.href = appInfo.repository ? `${appInfo.repository}/releases` : "https://github.com/RoveHD/elfix/releases";
}

function isUpdateBusy() {
  return ["checking", "available", "downloading", "installing"].includes(updateState.status);
}

// Die Rueckfrage vor dem Einlesen stellt der Hauptprozess - er kennt den Inhalt
// der Datei und kann sagen, was drinsteckt. Hier bleibt nur, das Ergebnis zu
// melden und die Ansicht neu zu bauen.
async function sicherungErstellen() {
  const ergebnis = await api.exportBackup?.().catch(() => null);
  if (!ergebnis?.saved) {
    if (ergebnis?.reason) showToast(ergebnis.reason);
    return;
  }
  showToast(`Sicherung erstellt — ${ergebnis.favoriten} Einträge, ${ergebnis.bilder} eigene Bilder`);
}

async function sicherungEinlesen() {
  const ergebnis = await api.importBackup?.().catch(() => null);
  if (!ergebnis?.restored) {
    if (ergebnis?.reason) showToast(ergebnis.reason);
    return;
  }
  providers = ergebnis.providers || providers;
  favorites = ergebnis.favorites || [];
  settings = ergebnis.settings || settings;
  selectedProviderIndex = -1;
  render();
  applyAppearance();
  showToast(`Sicherung eingelesen — ${ergebnis.favoriten} Einträge, ${ergebnis.weiterschauen} mit Weiterschauen-Stand`);
}

async function resetData() {
  if (!confirm("Wirklich alles zurücksetzen? Provider und Watchlist werden gelöscht, Logins bleiben soweit möglich erhalten.")) return;
  const result = await api.resetData();
  if (!result) return;
  providers = result.providers;
  favorites = result.favorites || [];
  settings = result.settings;
  selectedProviderIndex = -1;
  render();
  applyAppearance();
}

async function resetAllSettings() {
  if (!confirm("Alle Einstellungen auf Standard zurücksetzen? Provider und Watchlist bleiben erhalten.")) return;
  settings.adblock = {
    enabled: true,
    trackingProtection: true,
    blockPopups: true,
    blockRedirects: true,
    whitelist: [],
    lastUpdated: settings.adblock?.lastUpdated || ""
  };
  settings.browser = { cacheMode: "aggressive" };
  settings.playback = {
    pauseOnProviderSwitch: true,
    favoriteProgressMode: "sequential",
    pauseOnMinimize: false,
    pauseOnBlur: false,
    youtubeInMediathek: false,
    autoplayNextEpisode: true
  };
  settings.home = { ...DEFAULT_HOME_SETTINGS };
  settings.appearance = { ...DEFAULT_APPEARANCE_SETTINGS };
  renderSettings();
  await saveSettings();
}

function renderBlocked() {
  blockedList.replaceChildren();
  if (!blockedRequests.length) {
    blockedList.textContent = "Noch keine blockierten Requests.";
    return;
  }

  for (const item of blockedRequests) {
    const row = document.createElement("div");
    row.className = "blocked-row";
    // Die Kategorie sagt in einem Wort, warum etwas hier steht - geblockte
    // Regel, Popup, Frame-Umleitung, Overlay oder eine bewusste Ausnahme fuer
    // Wiedergabe und Verifizierung. Alte Eintraege ohne Kategorie bleiben
    // lesbar, deshalb die Ausweiche auf den Typ.
    const kategorie = item.kategorie || String(item.type || "").toUpperCase();
    row.textContent = `${item.time} · ${item.provider} · ${kategorie} · ${item.type} · ${item.rule} · ${item.url}`;
    blockedList.append(row);
  }
}

function activateTab(name) {
  if (name !== "settingsHome") lastSettingsTab = name;
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.tab === name));
  document.querySelectorAll(".settings-page").forEach((page) => page.classList.toggle("is-active", page.dataset.page === name));
}

function renderSettingsSearch() {
  const query = normalizeSettingsQuery(settingsSearch.value);
  settingsSearchResults.replaceChildren();
  settingsSearchResults.classList.toggle("is-empty", !query);
  // Die Treffer stehen auf der Uebersichtsseite - ohne diesen Wechsel tippt man
  // ins Leere, weil die Ergebnisliste auf einer inaktiven Seite haengt.
  if (query) activateTab("settingsHome");
  else if (lastSettingsTab) activateTab(lastSettingsTab);
  if (!query) return;

  const matches = SETTINGS_INDEX.filter((item) => {
    const haystack = normalizeSettingsQuery(`${item.title} ${item.description} ${item.tab}`);
    return haystack.includes(query);
  }).slice(0, 8);

  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "settings-search-empty";
    empty.textContent = "Keine Einstellung gefunden.";
    settingsSearchResults.append(empty);
    return;
  }

  settingsSearchResults.replaceChildren(...matches.map((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "settings-result";
    button.innerHTML = `<strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.description)}</span>`;
    button.addEventListener("click", () => {
      settingsSearch.value = "";
      settingsSearchResults.replaceChildren();
      settingsSearchResults.classList.add("is-empty");
      activateTab(item.tab);
    });
    return button;
  }));
}

async function resetSettingsSection(section) {
  if (section === "home") {
    settings.home = { ...DEFAULT_HOME_SETTINGS };
  } else if (section === "favorites") {
    settings.appearance = {
      ...DEFAULT_APPEARANCE_SETTINGS,
      ...(settings.appearance || {}),
      favoriteSize: DEFAULT_APPEARANCE_SETTINGS.favoriteSize,
      favoriteLayout: DEFAULT_APPEARANCE_SETTINGS.favoriteLayout,
      favoriteTextSize: DEFAULT_APPEARANCE_SETTINGS.favoriteTextSize,
      favoriteArtwork: DEFAULT_APPEARANCE_SETTINGS.favoriteArtwork,
      showFavoriteMeta: DEFAULT_APPEARANCE_SETTINGS.showFavoriteMeta
    };
  } else if (section === "appearance") {
    settings.appearance = { ...DEFAULT_APPEARANCE_SETTINGS };
  } else if (section === "watchparty") {
    // Auch beim Zuruecksetzen bleibt die Kennung dieses Geraets bestehen.
    settings.watchparty = {
      enabled: false,
      serverUrl: "",
      rooms: [],
      deviceName: "",
      deviceId: settings.watchparty?.deviceId || ""
    };
    watchpartyRaeume = [];
  }
  renderSettings();
  await saveSettings();
}

// Die Watchlist- und Navigations-Regler standen frueher doppelt auf eigenen
// Seiten. Die Zweitfassungen sind entfernt - die Funktionen bleiben tolerant,
// falls eine davon irgendwo wieder auftaucht.
function syncMirroredFavoriteControls() {
  const active = document.activeElement;
  if (favoriteSizeMirror) {
    if (active === favoriteSizeMirror) setRangeChoice("favoriteSize", getRangeChoice("favoriteSizeMirror"));
    else setRangeChoice("favoriteSizeMirror", getRangeChoice("favoriteSize"));
  }
  if (favoriteTextSizeMirror) {
    if (active === favoriteTextSizeMirror) setRangeChoice("favoriteTextSize", getRangeChoice("favoriteTextSizeMirror"));
    else setRangeChoice("favoriteTextSizeMirror", getRangeChoice("favoriteTextSize"));
  }
  if (favoriteLayoutMirror) {
    if (active === favoriteLayoutMirror) favoriteLayout.value = favoriteLayoutMirror.value;
    else favoriteLayoutMirror.value = favoriteLayout.value;
  }
  if (favoriteArtworkMirror) {
    if (active === favoriteArtworkMirror) favoriteArtwork.value = favoriteArtworkMirror.value;
    else favoriteArtworkMirror.value = favoriteArtwork.value;
  }
  if (showFavoriteMetaMirror) {
    if (active === showFavoriteMetaMirror) showFavoriteMeta.checked = showFavoriteMetaMirror.checked;
    else showFavoriteMetaMirror.checked = showFavoriteMeta.checked;
  }
}

function syncMirroredNavigationControls() {
  if (!showProviderStripNav) return;
  if (document.activeElement === showProviderStripNav) showProviderStrip.checked = showProviderStripNav.checked;
  else showProviderStripNav.checked = showProviderStrip.checked;
}

function syncMirroredAutoColorControls() {
  if (!autoDeriveColorsInline || !autoDeriveColors) return;
  if (document.activeElement === autoDeriveColorsInline) autoDeriveColors.checked = autoDeriveColorsInline.checked;
  else autoDeriveColorsInline.checked = autoDeriveColors.checked;
}

function syncInlineLabels() {
  const appearance = { ...DEFAULT_APPEARANCE_SETTINGS, ...(settings.appearance || {}) };
  const scaleValue = clampNumber(appearanceControlMap.uiScale?.value ?? appearance.uiScale, 90, 130, 100);
  const gapValue = clampNumber(appearanceControlMap.cardGap?.value ?? appearance.cardGap, 8, 34, 18);
  if (cardScaleInline) cardScaleInline.value = String(scaleValue);
  if (cardScaleInlineValue) cardScaleInlineValue.textContent = `${scaleValue}%`;
  if (cardGapInline) cardGapInline.value = String(gapValue);
  if (cardGapInlineValue) cardGapInlineValue.textContent = `${gapValue}px`;
  updateRangeFill(cardScaleInline);
  updateRangeFill(cardGapInline);
}

function syncChoiceCards(appearance) {
  const activeTheme = appearance.themeMode || "dark";
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    const value = button.dataset.themeChoice;
    button.classList.toggle("is-selected", value === activeTheme || (value === "custom" && appearance.accentPreset === "custom" && appearance.autoDeriveColors === false));
  });
  document.querySelectorAll("[data-accent-choice]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.accentChoice === (appearance.accentPreset || "blue"));
  });
  document.querySelectorAll("[data-layout-choice]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.layoutChoice === (appearance.layoutStyle || "standard"));
  });
  document.querySelectorAll("[data-nav-choice]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.navChoice === (appearance.navStyle || "sidebar"));
  });
  document.querySelectorAll("[data-density-choice]").forEach((button) => {
    // Genau einer leuchtet: entweder "Benutzerdef." oder die Dichte, die
    // gerade gilt. Beides zugleich waeren zwei gewaehlte Knoepfe in einer
    // Reihe, die sich gegenseitig ausschliessen soll.
    const vonHand = eigeneDichte(appearance);
    const istCustom = button.dataset.densityChoice === "custom";
    button.classList.toggle("is-selected",
      istCustom ? vonHand : (!vonHand && button.dataset.densityChoice === appearance.uiDensity));
  });
  document.querySelectorAll("[data-settings-mode-choice]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.settingsModeChoice === (appearance.settingsMode || "simple"));
  });
}

// Ist die Dichte von Hand gesetzt? Aeltere Staende trugen das in layoutStyle
// mit; sie werden hier weiter verstanden, ohne dass irgendwo umgeschrieben
// werden muss.
function eigeneDichte(appearance) {
  if (appearance?.densityMode) return appearance.densityMode === "custom";
  return appearance?.layoutStyle === "custom";
}

async function applyLayoutChoice(choice) {
  const updates = {
    standard: { uiDensity: "comfortable", cardSize: "medium", favoriteSize: "poster", favoriteLayout: "grid", cardStyle: "standard", spacingScale: 100, cardGap: 18 },
    compact: { uiDensity: "compact", cardSize: "small", favoriteSize: "small", favoriteLayout: "grid", cardStyle: "flat", spacingScale: 86, cardGap: 12 },
    roomy: { uiDensity: "roomy", cardSize: "large", favoriteSize: "large", favoriteLayout: "wide", cardStyle: "standard", spacingScale: 118, cardGap: 24 },
    netflix: { uiDensity: "comfortable", cardSize: "large", favoriteSize: "poster", favoriteLayout: "grid", cardStyle: "glass", spacingScale: 108, cardGap: 20 },
    minimal: { uiDensity: "compact", cardSize: "small", favoriteSize: "small", favoriteLayout: "list", cardStyle: "minimal", spacingScale: 90, cardGap: 14 }
  };
  const next = updates[choice] || updates.standard;
  settings.appearance = {
    ...DEFAULT_APPEARANCE_SETTINGS,
    ...(settings.appearance || {}),
    ...next,
    layoutStyle: choice,
    // Der Stil bringt seine eigene Dichte mit - danach ist sie keine eigene
    // Einstellung mehr.
    densityMode: "preset"
  };
  renderSettings();
  await saveSettings();
}

function normalizeSettingsQuery(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function setRangeChoice(key, value) {
  const range = rangeSettings[key];
  if (!range?.node) return;
  const index = Math.max(0, range.values.indexOf(value));
  range.node.value = String(index);
}

function getRangeChoice(key) {
  const range = rangeSettings[key];
  if (!range?.node) return "";
  const index = Math.max(0, Math.min(range.values.length - 1, Number(range.node.value) || 0));
  return range.values[index];
}

const ADVANCED_COLOR_KEYS = [
  "surfaceColor",
  "surfaceSecondaryColor",
  "cardColor",
  "navColor",
  "inputColor",
  "primaryTextColor",
  "secondaryTextColor",
  "mutedTextColor",
  "borderColor",
  "hoverColor",
  "focusColor",
  "selectionColor",
  "successColor",
  "warningColor",
  "errorColor",
  "progressColor",
  "scrollbarColor"
];

const ADVANCED_NUMBER_KEYS = {
  uiScale: [90, 118, "%"],
  spacingScale: [80, 130, "%"],
  cardGap: [8, 34, "px"],
  cardRadius: [4, 32, "px"],
  buttonRadius: [4, 28, "px"],
  buttonHeight: [34, 58, "px"],
  inputRadius: [4, 26, "px"],
  shadowStrength: [0, 100, "%"],
  hoverZoom: [100, 106, "%"],
  hoverBrightness: [95, 120, "%"],
  animationSpeed: [60, 160, "%"]
};

function setAdvancedAppearanceControls(appearance) {
  const next = { ...DEFAULT_APPEARANCE_SETTINGS, ...appearance };
  if (appearanceControlMap.appBackgroundColor) {
    appearanceControlMap.appBackgroundColor.value = normalizeColor(next.backgroundColor, "#070a10");
  }
  for (const key of ADVANCED_COLOR_KEYS) {
    if (appearanceControlMap[key]) {
      appearanceControlMap[key].value = normalizeColor(next[key], DEFAULT_APPEARANCE_SETTINGS[key] || "#147eff");
    }
  }
  for (const key of Object.keys(ADVANCED_NUMBER_KEYS)) {
    if (appearanceControlMap[key]) appearanceControlMap[key].value = String(next[key] ?? DEFAULT_APPEARANCE_SETTINGS[key]);
  }
}

function readAdvancedAppearanceControls() {
  const values = {};
  const background = normalizeColor(appearanceControlMap.appBackgroundColor?.value || backgroundColor.value, "#070a10");
  values.backgroundColor = background;
  for (const key of ADVANCED_COLOR_KEYS) {
    values[key] = normalizeColor(appearanceControlMap[key]?.value, DEFAULT_APPEARANCE_SETTINGS[key] || "#147eff");
  }
  for (const [key, [min, max]] of Object.entries(ADVANCED_NUMBER_KEYS)) {
    values[key] = clampNumber(appearanceControlMap[key]?.value, min, max, DEFAULT_APPEARANCE_SETTINGS[key]);
  }
  if (autoDeriveColors?.checked) {
    Object.assign(values, derivedPalette(background, normalizeColor(accentHex.value, accentColor.value)));
  }
  return values;
}

function syncAdvancedAppearanceLabels() {
  for (const [key, [min, max, suffix]] of Object.entries(ADVANCED_NUMBER_KEYS)) {
    const node = appearanceControlMap[key];
    const valueNode = document.querySelector(`#${key}Value`);
    if (!node || !valueNode) continue;
    const value = clampNumber(node.value, min, max, DEFAULT_APPEARANCE_SETTINGS[key]);
    valueNode.textContent = `${value}${suffix}`;
    updateRangeFill(node);
  }
}

// Bei aktiver Automatik ignoriert applyAppearance() die Einzelfarben. Statt sie
// wirkungslos anzubieten, werden sie gesperrt, zeigen den tatsaechlich
// verwendeten Wert und lassen sich per Knopf freischalten.
function syncAutoColorLock() {
  const locked = (autoDeriveColorsInline?.checked ?? autoDeriveColors?.checked) !== false;
  if (locked) deriveAdvancedColors();
  for (const key of ADVANCED_COLOR_KEYS) {
    const node = appearanceControlMap[key];
    if (!node) continue;
    node.disabled = locked;
    node.closest("label")?.classList.toggle("is-locked", locked);
  }
  autoColorsNote?.classList.toggle("is-hidden", !locked);
}

const THEME_BACKGROUNDS = {
  light: "#eef2f8",
  dark: "#070a10",
  oled: "#000000"
};

function resolveThemeMode(mode) {
  if (mode !== "system") return mode;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

// Setzt Hintergrund und daraus abgeleitete Farben passend zum gewaehlten Theme.
function applyThemeBackground(mode) {
  const background = THEME_BACKGROUNDS[resolveThemeMode(mode)];
  if (!background) return;
  backgroundColor.value = background;
  if (appearanceControlMap.appBackgroundColor) appearanceControlMap.appBackgroundColor.value = background;
  if (backgroundStyle && resolveThemeMode(mode) === "oled") backgroundStyle.value = "black";
  else if (backgroundStyle && backgroundStyle.value === "black") backgroundStyle.value = "cinema";
  deriveAdvancedColors();
}

function deriveAdvancedColors() {
  const background = normalizeColor(appearanceControlMap.appBackgroundColor?.value || backgroundColor.value, "#070a10");
  const accent = normalizeColor(accentHex.value, accentColor.value);
  const palette = derivedPalette(background, accent);
  for (const [key, value] of Object.entries(palette)) {
    if (appearanceControlMap[key]) appearanceControlMap[key].value = value;
  }
}

function derivedPalette(background, accent) {
  const dark = luminance(background) < 0.52;
  return {
    surfaceColor: colorMix(background, dark ? "#1a2434" : "#ffffff", dark ? 0.7 : 0.78),
    surfaceSecondaryColor: colorMix(background, dark ? "#243147" : "#e7eef8", dark ? 0.68 : 0.72),
    cardColor: colorMix(background, dark ? "#233148" : "#f8fbff", dark ? 0.65 : 0.78),
    navColor: colorMix(background, dark ? "#172033" : "#ffffff", dark ? 0.78 : 0.82),
    inputColor: colorMix(background, dark ? "#05090f" : "#ffffff", dark ? 0.74 : 0.9),
    primaryTextColor: dark ? "#f7f8fb" : "#08111f",
    secondaryTextColor: dark ? "#d9e2ef" : "#253349",
    mutedTextColor: dark ? "#a8b2c3" : "#536173",
    borderColor: colorMix(background, dark ? "#334155" : "#9ba8ba", 0.72),
    hoverColor: colorMix(accent, background, dark ? 0.72 : 0.82),
    focusColor: accent,
    selectionColor: colorMix(accent, dark ? "#ffffff" : "#000000", 0.18),
    successColor: "#22c55e",
    warningColor: "#f5b84b",
    errorColor: "#ff4d5e",
    progressColor: accent,
    scrollbarColor: colorMix(accent, background, 0.35)
  };
}

async function applyDesignPreset(name) {
  const preset = designPresets()[name] || designPresets().elfix;
  settings.appearance = {
    ...DEFAULT_APPEARANCE_SETTINGS,
    ...(settings.appearance || {}),
    ...preset,
    designPreset: name
  };
  if (settings.appearance.autoDeriveColors !== false) {
    Object.assign(settings.appearance, derivedPalette(settings.appearance.backgroundColor, accentFromPreset(settings.appearance.accentPreset)));
  }
  renderSettings();
  await saveSettings();
}

function designPresets() {
  return {
    elfix: { themeMode: "dark", accentPreset: "violet", layoutStyle: "standard", navStyle: "sidebar", backgroundStyle: "cinema", backgroundColor: "#070a10", uiDensity: "comfortable", cardStyle: "standard", shadowStyle: "standard", compactHeader: true, cardRadius: 18, buttonRadius: 16, spacingScale: 100 },
    cinema: { themeMode: "dark", accentPreset: "red", backgroundStyle: "poster", backgroundColor: "#08070b", cardStyle: "glass", shadowStyle: "strong", cardRadius: 20, buttonRadius: 18, spacingScale: 108 },
    oled: { themeMode: "oled", accentPreset: "blue", backgroundStyle: "black", backgroundColor: "#000000", cardStyle: "minimal", shadowStyle: "none", surfaceColor: "#050505", cardColor: "#090909", navColor: "#050505" },
    minimal: { themeMode: "dark", accentPreset: "default", backgroundStyle: "plain", backgroundColor: "#0b0f16", uiDensity: "compact", cardStyle: "flat", shadowStyle: "light", cardRadius: 12, buttonRadius: 12, spacingScale: 88 },
    glass: { themeMode: "dark", accentPreset: "turquoise", backgroundStyle: "glass", backgroundColor: "#071018", cardStyle: "glass", shadowStyle: "strong", cardRadius: 24, buttonRadius: 20, hoverBrightness: 112 },
    compact: { themeMode: "dark", accentPreset: "blue", backgroundStyle: "plain", backgroundColor: "#080c12", uiDensity: "compact", cardSize: "small", favoriteSize: "small", compactHeader: true, spacingScale: 82, cardGap: 12, buttonHeight: 38 },
    colorful: { themeMode: "dark", accentPreset: "violet", backgroundStyle: "poster", backgroundColor: "#090816", cardStyle: "glass", shadowStyle: "strong", accentStrength: 92, hoverBrightness: 115, cardRadius: 24 },
    custom: {}
  };
}

function markDesignCustom() {
  if (designPreset && designPreset.value !== "custom") designPreset.value = "custom";
}

function exportAppearanceSettings() {
  const payload = JSON.stringify({ appearance: { ...DEFAULT_APPEARANCE_SETTINGS, ...(settings.appearance || {}) } }, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "elfix-design.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importAppearanceSettings(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const next = payload.appearance || payload;
    settings.appearance = {
      ...DEFAULT_APPEARANCE_SETTINGS,
      ...(settings.appearance || {}),
      ...next,
      designPreset: "custom"
    };
    renderSettings();
    await saveSettings();
    showToast("Design importiert");
  } catch {
    showToast("Design konnte nicht importiert werden");
  } finally {
    event.target.value = "";
  }
}

function syncRangeLabels() {
  if (accentStrengthValue) accentStrengthValue.textContent = `${Math.round(Number(accentStrength.value) || 70)}%`;
  if (fontScaleValue) fontScaleValue.textContent = `${Math.round(Number(fontScale.value) || 100)}%`;
  updateRangeFill(accentStrength);
  updateRangeFill(fontScale);
  for (const range of Object.values(rangeSettings)) {
    if (!range.node || !range.valueNode) continue;
    const index = Math.max(0, Math.min(range.labels.length - 1, Number(range.node.value) || 0));
    range.valueNode.textContent = range.labels[index];
    updateRangeFill(range.node);
  }
}

function updateRangeFill(node) {
  if (!node) return;
  const min = Number(node.min || 0);
  const max = Number(node.max || 100);
  const value = Number(node.value || min);
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  node.closest(".range-row")?.style.setProperty("--range-fill", `${Math.max(0, Math.min(100, fill))}%`);
}

function applyAppearance() {
  const appearance = settings.appearance || {};
  const home = settings.home || DEFAULT_HOME_SETTINGS;
  const shell = document.querySelector(".app-shell");
  if (!shell) return;

  const accent = appearance.accentPreset === "custom"
    ? normalizeColor(appearance.accentColor || "#147eff")
    : accentFromPreset(appearance.accentPreset || "blue");
  const rgb = hexToRgb(accent);
  const strength = Math.max(30, Math.min(100, Number(appearance.accentStrength) || 70)) / 100;
  document.documentElement.style.setProperty("--accent", accent);
  document.documentElement.style.setProperty("--accent-rgb", `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  document.documentElement.style.setProperty("--accent-soft-alpha", (0.08 + strength * 0.16).toFixed(3));
  document.documentElement.style.setProperty("--accent-mid-alpha", (0.18 + strength * 0.28).toFixed(3));
  document.documentElement.style.setProperty("--accent-strong-alpha", (0.36 + strength * 0.42).toFixed(3));
  document.documentElement.style.setProperty("--accent-glow-alpha", (0.1 + strength * 0.22).toFixed(3));
  const appBackground = normalizeColor(appearance.backgroundColor || "#070a10", "#070a10");
  const autoColors = appearance.autoDeriveColors !== false;
  const palette = autoColors
    ? derivedPalette(appBackground, accent)
    : {
        surfaceColor: normalizeColor(appearance.surfaceColor, "#111722"),
        surfaceSecondaryColor: normalizeColor(appearance.surfaceSecondaryColor, "#1a2230"),
        cardColor: normalizeColor(appearance.cardColor, "#1a2230"),
        navColor: normalizeColor(appearance.navColor, "#131922"),
        inputColor: normalizeColor(appearance.inputColor, "#05090f"),
        primaryTextColor: normalizeColor(appearance.primaryTextColor, "#f7f8fb"),
        secondaryTextColor: normalizeColor(appearance.secondaryTextColor, "#d9e2ef"),
        mutedTextColor: normalizeColor(appearance.mutedTextColor, "#a8b2c3"),
        borderColor: normalizeColor(appearance.borderColor, "#243043"),
        hoverColor: normalizeColor(appearance.hoverColor, "#263349"),
        focusColor: normalizeColor(appearance.focusColor, accent),
        selectionColor: normalizeColor(appearance.selectionColor, "#235bbd"),
        successColor: normalizeColor(appearance.successColor, "#22c55e"),
        warningColor: normalizeColor(appearance.warningColor, "#f5b84b"),
        errorColor: normalizeColor(appearance.errorColor, "#ff4d5e"),
        progressColor: normalizeColor(appearance.progressColor, accent),
        scrollbarColor: normalizeColor(appearance.scrollbarColor, accent)
      };
  document.documentElement.style.setProperty("--custom-bg", appBackground);
  document.documentElement.style.setProperty("--bg-app", appBackground);
  document.documentElement.style.setProperty("--page", appBackground);
  document.documentElement.style.setProperty("--bg-surface", palette.surfaceColor);
  document.documentElement.style.setProperty("--bg-card", palette.cardColor);
  document.documentElement.style.setProperty("--bg-card-strong", palette.surfaceSecondaryColor);
  document.documentElement.style.setProperty("--bg-nav", palette.navColor);
  document.documentElement.style.setProperty("--bg-input", palette.inputColor);
  document.documentElement.style.setProperty("--bg-settings", palette.surfaceColor);
  document.documentElement.style.setProperty("--bg-sidebar", palette.surfaceSecondaryColor);
  document.documentElement.style.setProperty("--text", palette.primaryTextColor);
  document.documentElement.style.setProperty("--text-primary", palette.primaryTextColor);
  document.documentElement.style.setProperty("--text-secondary", palette.secondaryTextColor);
  document.documentElement.style.setProperty("--muted", palette.mutedTextColor);
  document.documentElement.style.setProperty("--line", palette.borderColor);
  document.documentElement.style.setProperty("--border-color", palette.borderColor);
  document.documentElement.style.setProperty("--hover", palette.hoverColor);
  document.documentElement.style.setProperty("--focus", palette.focusColor);
  document.documentElement.style.setProperty("--selection", palette.selectionColor);
  document.documentElement.style.setProperty("--success", palette.successColor);
  document.documentElement.style.setProperty("--warning", palette.warningColor);
  document.documentElement.style.setProperty("--error", palette.errorColor);
  document.documentElement.style.setProperty("--progress", palette.progressColor);
  document.documentElement.style.setProperty("--scrollbar", palette.scrollbarColor);
  document.documentElement.style.setProperty("--font-scale", String(Math.max(0.8, Math.min(1.4, Number(appearance.fontScale || 100) / 100))));
  document.documentElement.style.setProperty("--ui-scale", String(clampNumber(appearance.uiScale, 90, 118, 100) / 100));
  document.documentElement.style.setProperty("--spacing-scale", String(clampNumber(appearance.spacingScale, 80, 130, 100) / 100));
  document.documentElement.style.setProperty("--card-gap", `${clampNumber(appearance.cardGap, 8, 34, 18)}px`);
  document.documentElement.style.setProperty("--card-radius", `${clampNumber(appearance.cardRadius, 4, 32, 18)}px`);
  document.documentElement.style.setProperty("--radius", `${clampNumber(appearance.cardRadius, 4, 32, 18)}px`);
  document.documentElement.style.setProperty("--button-radius", `${clampNumber(appearance.buttonRadius, 4, 28, 16)}px`);
  document.documentElement.style.setProperty("--button-height", `${clampNumber(appearance.buttonHeight, 34, 58, 44)}px`);
  document.documentElement.style.setProperty("--input-radius", `${clampNumber(appearance.inputRadius, 4, 26, 14)}px`);
  document.documentElement.style.setProperty("--hover-zoom", String(clampNumber(appearance.hoverZoom, 100, 106, 102) / 100));
  document.documentElement.style.setProperty("--hover-brightness", String(clampNumber(appearance.hoverBrightness, 95, 120, 106) / 100));
  document.documentElement.style.setProperty("--animation-speed", `${clampNumber(appearance.animationSpeed, 60, 160, 100) / 100}`);
  const shadowStrength = clampNumber(appearance.shadowStrength, 0, 100, 45) / 100;
  document.documentElement.style.setProperty("--shadow", `0 ${Math.round(10 + shadowStrength * 22)}px ${Math.round(26 + shadowStrength * 58)}px rgba(0, 0, 0, ${Math.min(0.72, 0.16 + shadowStrength * 0.5).toFixed(2)})`);

  shell.classList.toggle("is-compact-header", Boolean(appearance.compactHeader));
  shell.classList.toggle("settings-advanced", appearance.settingsMode === "advanced");
  document.querySelector(".settings-shell")?.classList.toggle("is-advanced-settings", appearance.settingsMode === "advanced");
  shell.classList.toggle("hide-provider-strip", appearance.showProviderStrip === false);
  shell.classList.toggle("animations-off", appearance.animations === false || appearance.animationMode === "off");
  shell.classList.toggle("animations-reduced", appearance.animationMode === "reduced");
  setShellMode(shell, "density", appearance.uiDensity || "comfortable", ["compact", "comfortable", "roomy"]);
  setShellMode(shell, "cards", appearance.cardSize || "medium", ["small", "medium", "large"]);
  setShellMode(shell, "favorites", appearance.favoriteSize || "medium", ["small", "medium", "large", "poster"]);
  setShellMode(shell, "favlayout", appearance.favoriteLayout || "grid", ["grid", "wide", "list"]);
  setShellMode(shell, "favtext", appearance.favoriteTextSize || "medium", ["small", "medium", "large"]);
  setShellMode(shell, "favart", appearance.favoriteArtwork || "balanced", ["clear", "balanced", "artwork"]);
  setShellMode(shell, "corners", appearance.cornerStyle || "soft", ["sharp", "soft", "round"]);
  setShellMode(shell, "bg", appearance.backgroundStyle || "cinema", ["plain", "cinema", "color", "poster", "black", "gray", "glass"]);
  setShellMode(shell, "theme", appearance.themeMode || "dark", ["system", "dark", "light", "oled"]);
  setShellMode(shell, "cardstyle", appearance.cardStyle || "standard", ["standard", "flat", "glass", "outline", "minimal"]);
  setShellMode(shell, "shadow", appearance.shadowStyle || "standard", ["none", "light", "standard", "strong"]);
  setShellMode(shell, "providermeta", home.providerCardMeta || "logoName", ["logoName", "logo", "name"]);
  setShellMode(shell, "layout", appearance.layoutStyle || "standard", ["standard", "compact", "roomy", "netflix", "minimal", "custom"]);
  setShellMode(shell, "navstyle", appearance.navStyle || "sidebar", ["sidebar", "sidebarRight", "compactSidebar", "top"]);
  shell.classList.toggle("auto-collapse-sidebar", appearance.autoCollapseSidebar !== false);
  shell.classList.toggle("hide-favorite-meta", appearance.showFavoriteMeta === false);
  spiegeleModiInVorschau(shell);
  // Nach einem Seitenwechsel muss der Pfeil neu ausgerichtet werden.
  applySidebarState();
}

// Die Live-Vorschau steht im Einstellungsdialog und liegt damit ausserhalb der
// App-Huelle. Farben und Radien erreichen sie ueber die Variablen, die Modi
// aber haengen an Klassen auf der Huelle - ohne diese Kopie zeigte die
// Vorschau Kartenstil, Ecken, Schatten, Navigationsstil und Anbieter-Kacheln
// gar nicht an.
function spiegeleModiInVorschau(shell) {
  const vorschau = document.querySelector("#appPreview");
  if (!vorschau) return;
  const uebernehmen = [
    "layout-", "cardstyle-", "shadow-", "corners-", "navstyle-", "providermeta-",
    "density-", "cards-", "favart-", "theme-", "bg-"
  ];
  const eigene = [...vorschau.classList].filter((name) => !uebernehmen.some((teil) => name.startsWith(teil))
    && name !== "hide-provider-strip" && name !== "hide-favorite-meta" && name !== "animations-off");
  const vonHuelle = [...shell.classList].filter((name) => uebernehmen.some((teil) => name.startsWith(teil))
    || name === "hide-provider-strip" || name === "hide-favorite-meta" || name === "animations-off");
  vorschau.className = [...eigene, ...vonHuelle].join(" ");
}

function setShellMode(shell, prefix, value, allowed) {
  for (const item of allowed) {
    shell.classList.remove(`${prefix}-${item}`);
  }
  shell.classList.add(`${prefix}-${allowed.includes(value) ? value : allowed[0]}`);
}

function accentFromPreset(preset) {
  return {
    default: "#147eff",
    red: "#e50914",
    blue: "#3b82f6",
    violet: "#7c3aed",
    green: "#22c55e",
    orange: "#f97316",
    pink: "#ec4899",
    turquoise: "#06b6d4",
    yellow: "#facc15",
    gold: "#f5b84b"
  }[preset] || "#147eff";
}

function normalizeColor(value, fallback = "#147eff") {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function hexToRgb(hex) {
  const value = normalizeColor(hex).slice(1);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function colorMix(base, overlay, overlayWeight = 0.5) {
  const a = hexToRgb(base);
  const b = hexToRgb(overlay);
  const weight = Math.max(0, Math.min(1, overlayWeight));
  const channel = (left, right) => Math.round(left * (1 - weight) + right * weight).toString(16).padStart(2, "0");
  return `#${channel(a.r, b.r)}${channel(a.g, b.g)}${channel(a.b, b.b)}`;
}

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return channel(r) * 0.2126 + channel(g) * 0.7152 + channel(b) * 0.0722;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function normalizeSearchTemplate(template, home) {
  if (!template) return providerSearchTemplate(home);
  const normalized = normalizeUrl(template);
  if (isGoogleSiteSearchTemplate(normalized)) return providerSearchTemplate(home || providerUrlFromGoogleSiteSearch(normalized));
  const literalTemplate = promoteLiteralQueryPlaceholder(normalized);
  if (literalTemplate.includes("{query}")) return literalTemplate;
  if (!normalized.includes("{query}")) return providerSearchTemplate(home || normalized);
  return normalized;
}

function providerSearchTemplate(url) {
  try {
    const parsed = new URL(normalizeUrl(url));
    return `${parsed.origin}${usesTermSearch(parsed.hostname) ? "/suche?term={query}" : "/search?q={query}"}`;
  } catch {
    return "";
  }
}

function isGoogleSiteSearchTemplate(value) {
  try {
    const parsed = new URL(value.replace("{query}", "test"));
    return parsed.hostname.endsWith("google.com") && String(parsed.searchParams.get("q") || "").startsWith("site:");
  } catch {
    return false;
  }
}

function providerUrlFromGoogleSiteSearch(value) {
  try {
    const parsed = new URL(value.replace("{query}", "test"));
    const query = String(parsed.searchParams.get("q") || "");
    const host = query.replace(/^site:/i, "").split(/\s|\+/)[0].trim();
    return host ? `https://${host}` : "";
  } catch {
    return "";
  }
}

function promoteLiteralQueryPlaceholder(value) {
  return String(value).replace(/([?&][^=&#]+=)(test|dragonball)(?=(&|#|$))/i, "$1{query}");
}

function usesTermSearch(hostname) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname === "s.to" || hostname.endsWith(".s.to");
}

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(value) || String(value).includes(".");
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeFavoriteUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.href;
  } catch {
    return String(value || "").replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

// Das Bild einer Karte: ein selbst gewaehltes hat Vorrang, sonst bleibt es
// beim Bild der Anbieterseite wie bisher.
function favoriteBild(favorite) {
  return favorite?.customThumbnail || favorite?.thumbnail || "";
}

// Ein Bild von der Platte waehlen, auf Kachelgroesse bringen und am Titel
// ablegen. Verkleinert wird hier, damit die Ablage nicht mit Megabytes
// vollaeuft - eine Kachel ist keine 4000 Pixel breit.
function bildAuswaehlen() {
  return new Promise((fertig) => {
    const feld = document.createElement("input");
    feld.type = "file";
    feld.accept = "image/png,image/jpeg,image/webp,image/gif";
    feld.addEventListener("change", () => {
      const datei = feld.files?.[0];
      if (!datei) {
        fertig("");
        return;
      }
      const leser = new FileReader();
      leser.onerror = () => fertig("");
      leser.onload = () => {
        const bild = new Image();
        bild.onerror = () => fertig("");
        bild.onload = () => {
          const breite = Math.min(bild.naturalWidth || 640, 640);
          const hoehe = Math.round((bild.naturalHeight || 360) * (breite / (bild.naturalWidth || 640)));
          const flaeche = document.createElement("canvas");
          flaeche.width = breite;
          flaeche.height = hoehe;
          flaeche.getContext("2d")?.drawImage(bild, 0, 0, breite, hoehe);
          try {
            fertig(flaeche.toDataURL("image/jpeg", 0.82));
          } catch {
            fertig("");
          }
        };
        bild.src = String(leser.result || "");
      };
      leser.readAsDataURL(datei);
    });
    feld.click();
  });
}

// --- Titelhintergrund zuschneiden --------------------------------------------
//
// Ein eigenes Bild passt selten von selbst in eine Karte. Statt es
// stillschweigend mittig zu beschneiden - und dabei zuverlaessig das Logo oder
// das Gesicht zu erwischen, das oben steht - darf der Benutzer sagen, welcher
// Teil stehen bleiben soll, und zwar fuer jede Form einzeln.
//
// Der Editor baut dafuer keine eigene Darstellung. In den drei Kartenformen
// ist die Vorschau eine .favorite-card mit demselben Inhalt, den
// favoriteCard() erzeugt; in der Form "Banner" ist sie ein
// .home-dashboard-hero mit demselben Inhalt, den renderHomeHero() schreibt.
// Das Bild darin setzt in beiden Faellen bildEbeneSetzen() - dieselbe
// Funktion, die auch die Karten in "Gemeinsam weiterschauen", auf der
// Watchlist, in der Mediathek und bei den Empfehlungen beliefert. Eine
// Vorschau, die anders rechnet als die Anzeige, waere frueher oder spaeter
// eine Vorschau, die luegt.

// Poster und Mittel kommen aus den echten Kartenmassen von ELFIX. Die Zahlen
// stehen nicht hier, sondern im Stylesheet (--favorite-card-min und
// --favorite-card-height); sie werden am lebenden Element gelesen, damit sie
// nicht an zwei Stellen gepflegt werden muessen und nicht auseinanderlaufen.
//
// "Gross" ist 16:9 - so steht eine grosse Karte in einem weiten Raster
// tatsaechlich, denn die Kartenbreite waechst dort ueber ihren Mindestwert
// hinaus. Das Banner wird am laufenden Fenster gemessen; es ist echte
// Bildschirmbreite und passt deshalb nur verkleinert in den Dialog.
const CROP_BANNER_RUECKFALL = { breite: 1280, hoehe: 360 };
// Der Innenabstand der Buehne, doppelt - links und rechts, oben und unten.
const CROP_BUEHNE_LUFT = 24;
// So weit darf die Karte hoechstens vergroessert werden. Eine 290 mal 220
// Pixel kleine Karte waere in der Buehne sonst kaum zu erkennen; mehr als das
// Doppelte wirkt dagegen aufgeblasen.
const CROP_MAX_LUPE = 2.2;
const CROP_RAD_SCHRITT = 0.12;

let cropZustand = null;

// Die Kartenmasse einer Groesse, gelesen aus dem Stylesheet. Ein unsichtbares
// Element mit der passenden Klasse ist der ehrlichste Weg dorthin: es
// beantwortet die Frage mit denselben Regeln, nach denen die echten Karten
// gezeichnet werden.
function cropKartenMasse(groesse) {
  const probe = document.createElement("div");
  probe.className = `app-shell favorites-${groesse}`;
  probe.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none";
  document.body.append(probe);
  const stil = getComputedStyle(probe);
  const breite = Number.parseFloat(stil.getPropertyValue("--favorite-card-min"));
  const hoehe = Number.parseFloat(stil.getPropertyValue("--favorite-card-height"));
  probe.remove();
  return breite > 0 && hoehe > 0 ? { breite, hoehe } : null;
}

function cropFormatMasse(format) {
  if (format === "banner") {
    // Das echte Banner, in echten Pixeln. Es ist breiter als der Dialog und
    // wird deshalb gleich wieder verkleinert - aber nur so stimmen darin auch
    // die Groessenverhaeltnisse von Titel, Zeile und Knoepfen.
    const kasten = homeHero?.getBoundingClientRect();
    return kasten && kasten.width > 0 && kasten.height > 0
      ? { breite: Math.round(kasten.width), hoehe: Math.round(kasten.height) }
      : { ...CROP_BANNER_RUECKFALL };
  }
  if (format === "large") {
    const gross = cropKartenMasse("large") || { hoehe: 260 };
    return { breite: Math.round(gross.hoehe * 16 / 9), hoehe: Math.round(gross.hoehe) };
  }
  const masse = cropKartenMasse(format)
    || (format === "poster" ? { breite: 230, hoehe: 330 } : { breite: 290, hoehe: 220 });
  return { breite: Math.round(masse.breite), hoehe: Math.round(masse.hoehe) };
}

// Der sichtbare Kasten der Vorschau. Gemessen wird bei jedem Zug neu: der
// Dialog faehrt beim Oeffnen mit einer kurzen Vergroesserung auf, und waehrend
// dieser Animation ist der Kasten fuer ein paar Bilder noch nicht so gross wie
// gleich darauf. Das Rechteck traegt die Lupe bereits in sich - der Zeiger
// bewegt sich in denselben Bildschirmpixeln, also passt beides zusammen.
function cropMasse() {
  const kasten = cropPreview.getBoundingClientRect();
  return { breite: kasten.width || 1, hoehe: kasten.height || 1 };
}

// Die Form, die gerade bearbeitet wird, und ihre Lage.
function cropFormat() {
  return cropZustand.ausschnitt.format;
}

function cropLage() {
  return bildausschnittModul.lage(cropZustand.ausschnitt, cropFormat());
}

// Die Vorschau traegt zwei Gestalten: eine Karte und das Startbanner. Getauscht
// wird nur, wenn wirklich gewechselt wird - und die Bildebene wandert dabei
// unveraendert mit, sonst laedt das Bild bei jedem Wechsel neu.
function cropHautSetzen(format) {
  const alsBanner = format === "banner";
  const haut = alsBanner ? "banner" : "karte";
  if (cropZustand.haut === haut) return;
  cropZustand.haut = haut;
  const ebene = cropPreview.querySelector(".karten-bild");
  cropPreview.className = alsBanner
    ? "hero home-dashboard-hero crop-preview is-banner"
    : "favorite-card crop-preview";
  cropPreview.innerHTML = alsBanner
    ? heroInhalt(cropZustand.favorite)
    : favoriteCardInhalt(cropZustand.favorite, { showProgress: true });
  if (ebene) cropPreview.prepend(ebene);
}

// Wie stark die Karte vergroessert wird, damit sie die Buehne fuellt.
//
// Das haengt allein an der Form und an der Groesse der Buehne - und keines von
// beiden aendert sich, waehrend jemand das Bild zieht. Genau deshalb wird hier
// gemerkt, wofuer die Lupe zuletzt gerechnet wurde: eine Lupe, die sich
// mitten im Zug aendert, waere eine Karte, die unter dem Zeiger ihre Groesse
// wechselt - und dann bewegt sich das Bild nicht mehr um die Strecke, die die
// Maus zurueckgelegt hat.
function cropLupeSetzen(erzwingen = false) {
  if (!cropZustand) return;
  const format = cropFormat();
  const kennung = `${format}|${cropStage.clientWidth}x${cropStage.clientHeight}`;
  if (!erzwingen && cropZustand.lupeFuer === kennung) return;
  cropZustand.lupeFuer = kennung;

  const masse = cropFormatMasse(format);
  cropPreview.style.width = `${masse.breite}px`;
  cropPreview.style.height = `${masse.hoehe}px`;
  // Gemessen an der Layoutgroesse der Buehne und nicht an ihrem Rechteck auf
  // dem Schirm: der Dialog faehrt mit einer kurzen Vergroesserung auf, und
  // waehrend dieser Animation waere das Rechteck noch nicht das, was gleich
  // dasteht.
  const platz = {
    breite: (cropStage.clientWidth || masse.breite) - CROP_BUEHNE_LUFT,
    hoehe: (cropStage.clientHeight || masse.hoehe) - CROP_BUEHNE_LUFT
  };
  const lupe = Math.min(platz.breite / masse.breite, platz.hoehe / masse.hoehe, CROP_MAX_LUPE);
  cropPreview.style.setProperty("--crop-lupe", Math.max(0.1, lupe).toFixed(4));
}

function cropZeichnen() {
  if (!cropZustand) return;
  const format = cropFormat();
  const wert = cropLage();

  cropHautSetzen(format);
  cropBody?.classList.toggle("is-banner", format === "banner");

  cropLupeSetzen();

  // Dieselbe Funktion wie an jeder echten Karte. Sie legt die Bildebene beim
  // ersten Mal an und setzt danach nur noch die drei Variablen - das Bild
  // selbst wird nicht neu geladen, sonst blinkte es bei jedem Zug.
  bildEbeneSetzen(cropPreview, cropZustand.dataUrl, cropZustand.ausschnitt, format);

  for (const knopf of cropModes.querySelectorAll("button")) {
    knopf.classList.toggle("is-active", knopf.dataset.cropFormat === format);
  }
  cropZoom.value = String(Math.round(wert.scale * 100));
  cropZoomValue.textContent = `${Math.round(wert.scale * 100)} %`;
}

// Jede Bewegung geht durch diese drei Stellen - und jede fasst nur die Form
// an, die gerade zu sehen ist. Ein Zug im Poster laesst das Banner in Ruhe.
function cropVerschieben(dx, dy) {
  const masse = cropMasse();
  cropZustand.ausschnitt = bildausschnittModul.verschieben(
    cropZustand.ausschnitt, cropFormat(), dx, dy, masse.breite, masse.hoehe, cropZustand.bildSeite
  );
  cropGeaendert();
}

function cropZoomen(skala) {
  cropZustand.ausschnitt = bildausschnittModul.zoomen(cropZustand.ausschnitt, cropFormat(), skala);
  cropGeaendert();
}

// Mausrad und Finger sagen "ein Stueck naeher", nicht "auf diesen Wert".
function cropZoomenUm(faktor) {
  cropZoomen(cropLage().scale * faktor);
}

function cropFormatSetzen(format) {
  cropZustand.ausschnitt = bildausschnittModul.formatSetzen(cropZustand.ausschnitt, format);
  // Die Form selbst ist keine Aenderung am Bild - aber sie soll mitgespeichert
  // werden, damit der Editor beim naechsten Mal hier wieder aufgeht.
  cropGeaendert();
}

// Nach jeder Aenderung ist der gespeicherte Stand nicht mehr der aktuelle.
function cropGeaendert() {
  cropZustand.gespeichert = false;
  cropZeichnen();
  cropStandZeigen("");
}

function cropStandZeigen(text) {
  if (!cropSaveHint) return;
  cropSaveHint.textContent = text;
  cropSaveHint.classList.toggle("is-sichtbar", Boolean(text));
}

// Speichern, ohne den Editor zu schliessen. Damit laesst sich Form fuer Form
// durchgehen: Poster einstellen, speichern, auf Mittel wechseln, einstellen,
// speichern - ohne den Dialog jedes Mal neu aufzumachen.
async function cropSpeichern() {
  if (!cropZustand?.speichern) return true;
  cropSave?.setAttribute("disabled", "disabled");
  cropStandZeigen("Wird gespeichert …");
  const lage = bildausschnittModul.normalisierenOderNull(cropZustand.ausschnitt);
  const ok = await cropZustand.speichern(lage).catch(() => false);
  cropSave?.removeAttribute("disabled");
  if (!cropZustand) return ok;
  cropZustand.gespeichert = Boolean(ok);
  cropStandZeigen(ok ? "Gespeichert" : "Konnte nicht gespeichert werden");
  return ok;
}

// Zwei Finger auf dem Schirm: der Abstand zwischen ihnen ist der Zoom, die
// Mitte zwischen ihnen die Lage. Mehr braucht es nicht, und mehr waere hier
// auch nicht ehrlich zu pruefen.
const cropFinger = new Map();
let cropFingerAbstand = 0;

function cropFingerMitte() {
  const punkte = [...cropFinger.values()];
  return {
    x: (punkte[0].x + punkte[1].x) / 2,
    y: (punkte[0].y + punkte[1].y) / 2
  };
}

function cropAbstand() {
  const punkte = [...cropFinger.values()];
  return Math.hypot(punkte[0].x - punkte[1].x, punkte[0].y - punkte[1].y);
}

function cropBinden() {
  if (!cropModal || !cropStage || !cropPreview) return;
  let zieht = false;
  let letzteX = 0;
  let letzteY = 0;

  // Gezogen wird an der Karte selbst. Die Erfassung des Zeigers sorgt dafuer,
  // dass ein Zug auch dann weiterlaeuft, wenn die Maus dabei ueber den Rand
  // der Karte hinausgeraet - sonst bliebe das Bild mitten in der Bewegung
  // stehen.
  cropPreview.addEventListener("pointerdown", (event) => {
    if (!cropZustand) return;
    // Ohne das faengt der Browser den Zug als Textmarkierung ab: Titel,
    // Anbieter und Laufzeit stehen als Text in der Karte, und beim Ziehen
    // waeren sie blau hinterlegt statt das Bild zu bewegen.
    event.preventDefault();
    cropFinger.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { cropPreview.setPointerCapture(event.pointerId); } catch { /* ohne Erfassung geht es auch */ }
    if (cropFinger.size === 2) {
      cropFingerAbstand = cropAbstand();
      zieht = false;
      return;
    }
    zieht = true;
    letzteX = event.clientX;
    letzteY = event.clientY;
    cropStage.classList.add("is-dragging");
  });

  cropPreview.addEventListener("pointermove", (event) => {
    if (!cropZustand || !cropFinger.has(event.pointerId)) return;
    cropFinger.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (cropFinger.size === 2) {
      const jetzt = cropAbstand();
      if (cropFingerAbstand > 0 && jetzt > 0) cropZoomenUm(jetzt / cropFingerAbstand);
      cropFingerAbstand = jetzt;
      const mitte = cropFingerMitte();
      letzteX = mitte.x;
      letzteY = mitte.y;
      return;
    }

    if (!zieht) return;
    cropVerschieben(event.clientX - letzteX, event.clientY - letzteY);
    letzteX = event.clientX;
    letzteY = event.clientY;
  });

  const loslassen = (event) => {
    cropFinger.delete(event.pointerId);
    if (cropFinger.size < 2) cropFingerAbstand = 0;
    if (cropFinger.size === 0) {
      zieht = false;
      cropStage.classList.remove("is-dragging");
    }
  };
  cropPreview.addEventListener("pointerup", loslassen);
  cropPreview.addEventListener("pointercancel", loslassen);

  cropStage.addEventListener("wheel", (event) => {
    if (!cropZustand) return;
    event.preventDefault();
    const richtung = event.deltaY < 0 ? 1 : -1;
    cropZoomenUm(1 + richtung * CROP_RAD_SCHRITT);
  }, { passive: false });

  cropZoom.addEventListener("input", () => {
    if (!cropZustand) return;
    cropZoomen(Number(cropZoom.value) / 100);
  });

  cropModes.addEventListener("click", (event) => {
    const knopf = event.target.closest("button[data-crop-format]");
    if (!knopf || !cropZustand) return;
    cropFormatSetzen(knopf.dataset.cropFormat);
  });

  cropReset.addEventListener("click", () => {
    if (!cropZustand) return;
    // Zuruecksetzen gilt fuer die Form, die gerade zu sehen ist - die Arbeit
    // an den anderen dreien bleibt stehen.
    cropZustand.ausschnitt = bildausschnittModul.zuruecksetzen(cropZustand.ausschnitt, cropFormat());
    cropGeaendert();
  });

  cropCenter.addEventListener("click", () => {
    if (!cropZustand) return;
    cropZustand.ausschnitt = bildausschnittModul.zentrieren(cropZustand.ausschnitt, cropFormat());
    cropGeaendert();
  });

  // Aendert sich die Fenstergroesse, aendert sich die Buehne mit. Waehrend
  // eines Zugs kann das nicht passieren, also stoert es dort auch nichts.
  new ResizeObserver(() => cropLupeSetzen()).observe(cropStage);

  cropSave?.addEventListener("click", () => { cropSpeichern(); });
  cropCancel.addEventListener("click", () => cropSchliessen({ ok: false, ausschnitt: null }));
  cropApply.addEventListener("click", cropUebernehmen);
  // Escape und der Systemknopf schliessen den Dialog ohne Klick auf Abbrechen -
  // auch dann darf nichts uebernommen werden.
  cropModal.addEventListener("cancel", (event) => {
    event.preventDefault();
    cropSchliessen({ ok: false, ausschnitt: null });
  });
}

function cropSchliessen(ergebnis) {
  const fertig = cropZustand?.fertig;
  cropZustand = null;
  // Die Vorschau bleibt als Element im Dokument stehen. Ohne diese Zeile
  // bliebe auch das Bild darin stehen, und beim naechsten Oeffnen - womoeglich
  // fuer einen ganz anderen Titel - waere fuer einen Augenblick das alte zu
  // sehen, bis das neue dekodiert ist.
  cropPreview?.querySelector(":scope > .karten-bild")?.remove();
  cropPreview?.classList.remove("has-thumb");
  cropFinger.clear();
  cropFingerAbstand = 0;
  cropStage?.classList.remove("is-dragging");
  cropStandZeigen("");
  if (cropModal?.open) cropModal.close();
  fertig?.(ergebnis);
}

function cropUebernehmen() {
  // Deckend, mittig, ohne Zoom in jeder Form ist der Normalfall und wird nicht
  // gespeichert - so bleibt die Ablage frei von Werten, die nichts aendern.
  const gewaehlt = cropZustand?.ausschnitt || null;
  cropSchliessen({ ok: true, ausschnitt: bildausschnittModul.normalisierenOderNull(gewaehlt) });
}

// Liefert { ok, ausschnitt }. `ok: false` heisst abgebrochen - und nur das
// darf den Aufrufer davon abhalten, ueberhaupt zu speichern. Ein Ausschnitt,
// der `null` ist, ist dagegen ein gueltiges Ergebnis: es bedeutet "wie immer",
// also vollflaechig und mittig.
//
// `speichern` ist die Zwischenablage fuer den Knopf "Speichern": eine Funktion,
// die den Ausschnitt sofort wegschreibt, ohne dass der Editor zugeht. Fehlt
// sie, bleibt der Knopf ohne Wirkung und wird ausgeblendet.
function bildAusschnittWaehlen(dataUrl, start, favorite = null, speichern = null) {
  // Ohne Dialog (aelteres Chromium, fehlendes Modul) bleibt es bei dem, was
  // schon galt. Ein Bild waehlen laesst sich dann trotzdem.
  if (!cropModal?.showModal || !bildausschnittModul) {
    return Promise.resolve({ ok: true, ausschnitt: start || null });
  }

  return new Promise((fertig) => {
    const bild = new Image();
    const oeffnen = (bildSeite) => {
      cropZustand = {
        bildSeite,
        dataUrl,
        favorite,
        speichern,
        haut: "",
        gespeichert: true,
        ausschnitt: bildausschnittModul.normalisieren(start || {}),
        fertig
      };
      cropSave?.classList.toggle("is-hidden", !speichern);
      cropStandZeigen("");
      cropModal.showModal();
      cropZeichnen();
      // Der Dialog wird erst mit dem naechsten Bild gemessen, wie er dasteht.
      // Einmal nachfassen, damit die Lupe von Anfang an die richtige ist -
      // danach bleibt sie stehen, solange die Form dieselbe ist.
      requestAnimationFrame(() => {
        if (cropZustand) cropLupeSetzen(true);
      });
      window.setTimeout(() => cropApply.focus(), 0);
    };
    bild.onload = () => oeffnen(bild.naturalHeight > 0 ? bild.naturalWidth / bild.naturalHeight : 0);
    // Ohne lesbares Bild gibt es nichts zuzuschneiden. Dann bleibt es bei dem,
    // was vorher galt - der Aufrufer speichert trotzdem, nur eben ohne Lage.
    bild.onerror = () => fertig({ ok: true, ausschnitt: start || null });
    bild.src = dataUrl;
  });
}

async function eigenesBildSetzen(favorite) {
  const bild = await bildAuswaehlen();
  if (!bild) return;
  // Erst waehlen, dann formatieren. Wer hier abbricht, hat auch kein Bild
  // gewaehlt - sonst haenge ein halb gesetztes Bild in der Ablage.
  //
  // "Speichern" im Editor legt Bild und Ausschnitt sofort ab, ohne den Dialog
  // zu schliessen. Danach laesst sich die naechste Form einstellen und wieder
  // speichern; der Aufrufer unten setzt am Ende nur noch denselben Stand.
  const zwischenspeichern = async (lage) => {
    const stand = await api.setFavoriteImage?.(favorite.id, bild, lage).catch(() => null);
    if (!stand?.saved) return false;
    favorites = stand.favorites || favorites;
    renderFavorites();
    renderHome();
    renderLibraryViews();
    return true;
  };
  const gewaehlt = await bildAusschnittWaehlen(bild, null, favorite, zwischenspeichern);
  if (!gewaehlt.ok) return;
  const ergebnis = await api.setFavoriteImage?.(favorite.id, bild, gewaehlt.ausschnitt).catch(() => null);
  if (!ergebnis?.saved) {
    showToast(ergebnis?.reason || "Bild konnte nicht gesetzt werden");
    return;
  }
  favorites = ergebnis.favorites || favorites;
  renderFavorites();
  renderHome();
  renderLibraryViews();
  // Das Bild haengt am Titel, nicht an der Kachel - steht der Titel auch in
  // einer Watchparty, gilt es dort genauso.
  showToast(Number(ergebnis.entries) > 1
    ? "Eigenes Bild gesetzt — gilt überall für diesen Titel"
    : "Eigenes Bild gesetzt");
}

// Ein gespeichertes Bild noch einmal anders zuschneiden. Das Bild selbst wird
// dabei nicht angefasst - es wandert nicht ueber die Bruecke und wird nicht
// neu abgelegt, es aendern sich vier Zahlen.
async function bildAusschnittBearbeiten(favorite) {
  if (!favorite?.customThumbnail) return;
  const zwischenspeichern = async (lage) => {
    const stand = await api.setFavoriteImageCrop?.(favorite.id, lage).catch(() => null);
    if (!stand?.saved) return false;
    favorites = stand.favorites || favorites;
    renderFavorites();
    renderHome();
    renderLibraryViews();
    return true;
  };
  const gewaehlt = await bildAusschnittWaehlen(
    favorite.customThumbnail, favorite.customThumbnailCrop || null, favorite, zwischenspeichern
  );
  if (!gewaehlt.ok) return;
  const ergebnis = await api.setFavoriteImageCrop?.(favorite.id, gewaehlt.ausschnitt).catch(() => null);
  if (!ergebnis?.saved) {
    showToast(ergebnis?.reason || "Ausschnitt konnte nicht gespeichert werden");
    return;
  }
  favorites = ergebnis.favorites || favorites;
  renderFavorites();
  renderHome();
  renderLibraryViews();
  showToast("Ausschnitt gespeichert");
}

async function eigenesBildEntfernen(favorite) {
  const ergebnis = await api.setFavoriteImage?.(favorite.id, "").catch(() => null);
  if (!ergebnis?.saved) return;
  favorites = ergebnis.favorites || favorites;
  renderFavorites();
  renderHome();
  renderLibraryViews();
  showToast("Eigenes Bild entfernt — es gilt wieder das vom Anbieter");
}

// Unter dem Titel steht der Anbieter - und, wenn der Eintrag zu einer
// Watchparty gehoert, aus welcher Runde er stammt. Denselben Anime kann es
// mehrfach geben: einmal fuer dich und einmal je Raum.
function favoriteHerkunft(favorite) {
  const anbieter = favorite?.providerName || "Provider";
  const raum = String(favorite?.watchpartyRoom || "");
  return raum ? `${anbieter} · ⇄ ${raum}` : anbieter;
}

function displayFavoriteTitle(favorite) {
  const title = cleanFavoriteTitle(favorite?.title, favorite?.url) || "Favorit";
  const progress = favoriteEpisodeLabel(favorite?.url) || favoriteFilmLabel(favorite?.url);
  return progress ? `${title} · ${progress}` : title;
}

function cleanFavoriteTitle(title, url) {
  const raw = String(title || "").replace(/\s+/g, " ").trim();
  const slugTitle = titleFromFavoriteUrl(url);
  if (!raw) return slugTitle;

  const episodeMatch = raw.match(/\b(?:episode|folge)\s+\d+\s*(?:staffel\s+\d+\s*)?(?:von|of)\s+(.+?)(?:\s*[|–-]\s*|\s*$)/i)
    || raw.match(/\bstaffel\s+\d+\s*(?:von|of)\s+(.+?)(?:\s*[|–-]\s*|\s*$)/i);

  let value = episodeMatch ? episodeMatch[1] : raw;
  value = value
    .replace(/\s*\[[^\]]*\]\s*/g, " ")
    .replace(/\s*[|]\s*.*$/g, "")
    .replace(/\s+[–-]\s*(?:Filmo|S\.?to|AniWorld.*|Elflix|ELFIX).*$/i, "")
    .replace(/\b(?:jetzt\s+)?kostenlos\s+streamen\b/gi, "")
    .replace(/\bgratis\s+legal\s+online\s+ansehen\b/gi, "")
    .replace(/\bonline\s+ansehen\b/gi, "")
    .replace(/\bstream\s+starten\b/gi, "")
    .replace(/\banschauen\b/gi, "")
    .replace(/\b(?:AniWorld\.to\s*\/\s*Animes?|AniWorld|Filmo|S\.to|Elflix|ELFIX)\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s|–-]+|[\s|–-]+$/g, "")
    .trim();
  value = collapseRepeatedTitle(value);

  if (!value || isFavoriteTitleNoise(value) || value.length > 58) {
    return slugTitle || niceFavoriteTitle(value);
  }
  return niceFavoriteTitle(value);
}

function collapseRepeatedTitle(value) {
  const text = String(value || "").trim();
  const repeated = text.match(/^(.{3,})\s+\1$/i);
  return repeated ? repeated[1].trim() : text;
}

function isFavoriteTitleNoise(value) {
  return /\b(kostenlos|gratis|online ansehen|episode|folge|staffel|aniworld|filmo|s\.to)\b/i.test(value)
    && value.length > 28;
}

function titleFromFavoriteUrl(url) {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    if (!parts.length) return "";
    const streamIndex = parts.findIndex((part) => /^(stream|serie|film|filme|movie|movies|title)$/i.test(part));
    const preferred = streamIndex >= 0 ? parts[streamIndex + 1] : "";
    const fallback = [...parts].reverse().find((part) => !/^(anime|stream|serie|series|film|filme|movie|movies|watch|title|staffel-\d+|season-\d+|episode-\d+|folge-\d+)$/i.test(part));
    return niceFavoriteTitle(slugToTitle(preferred || fallback || ""));
  } catch {
    return "";
  }
}

function favoriteEpisodeLabel(url) {
  const identity = episodeIdentity(url);
  if (!identity) return "";
  if (identity.season > 0) return `Staffel ${identity.season} Folge ${identity.episode}`;
  return `Folge ${identity.episode}`;
}

function favoriteFilmLabel(url) {
  const number = filmNumberFromUrl(url);
  return number > 0 ? `Film ${number}` : "";
}

function filmNumberFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    for (const part of parts) {
      const match = part.match(/^(?:film|movie)-(\d+)$/i);
      if (match) {
        const number = Number(match[1]);
        if (Number.isFinite(number) && number > 0) return number;
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

function episodeIdentity(value) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    let season = 0;
    let episode = 0;
    for (const part of parts) {
      const seasonMatch = part.match(/^(?:staffel|season)-(\d+)$/i);
      if (seasonMatch) season = Number(seasonMatch[1]);
      const episodeMatch = part.match(/^(?:episode|folge)-(\d+)$/i);
      if (episodeMatch) episode = Number(episodeMatch[1]);
    }
    if (!Number.isFinite(episode) || episode <= 0) return null;
    return { season, episode };
  } catch {
    return null;
  }
}

function slugToTitle(slug) {
  return decodeURIComponent(String(slug || ""))
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function niceFavoriteTitle(value) {
  const trimmed = String(value || "").replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const base = trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed) ? trimmed.toLowerCase() : trimmed;
  return base.replace(/(^|[^\p{L}\p{N}'’])(\p{Ll})/gu, (_match, prefix, char) => `${prefix}${char.toUpperCase()}`);
}

function cssUrl(value) {
  return String(value || "").replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Den gerade geoeffneten Titel in den Raum stellen. Der Hauptprozess kennt die
// Seite, deshalb reicht hier ein Anstoss.
async function shareCurrentToWatchparty() {
  // Bei mehreren Raeumen oeffnet der Hauptprozess unter dem Knopf ein
  // Fenstermenue. Die Stelle dafuer kennt nur die Oberflaeche.
  const anker = document.querySelector("#watchpartyShareButton")?.getBoundingClientRect();
  const punkt = anker ? { x: anker.left, y: anker.bottom + 4 } : null;
  const ergebnis = await api.shareCurrentToWatchparty?.(undefined, punkt).catch(() => null);
  if (ergebnis?.abgebrochen) return;
  if (!ergebnis?.shared) {
    showToast(ergebnis?.reason || "Konnte nicht geteilt werden");
    return;
  }
  showToast(ergebnis.room
    ? `Zu „${ergebnis.room}“ hinzugefügt — die anderen können jetzt beitreten`
    : "Zur Watchparty hinzugefügt — die anderen können jetzt beitreten");
}

// Raumcodes aus Eingaben: getrimmt, Umlaute zusammengezogen (sonst fuehrt das
// Relay je nach Tastatur zwei Raeume), ohne Doppelte, Reihenfolge bleibt.
function raumcodes(werte) {
  const sauber = [];
  for (const roh of werte || []) {
    const code = String(roh || "").trim().normalize("NFC").slice(0, 64);
    if (!code || sauber.includes(code)) continue;
    sauber.push(code);
  }
  return sauber;
}

// Dieselbe Regel wie im Relay: Buchstaben aller Sprachen, Ziffern, Bindestrich
// und Unterstrich, mindestens vier Zeichen.
function watchpartyCodeBeanstandung(code) {
  const sauber = String(code || "").trim().normalize("NFC");
  if (sauber.length < 4) return "Ein Raumcode braucht mindestens vier Zeichen";
  if (sauber.length > 64) return "Ein Raumcode darf höchstens 64 Zeichen haben";
  if (!/^[\p{L}\p{N}_-]+$/u.test(sauber)) {
    return "Erlaubt sind Buchstaben, Ziffern, Bindestrich und Unterstrich — keine Leerzeichen";
  }
  return "";
}

function renderWatchpartyRaeume() {
  if (!watchpartyRoomList) return;
  if (!watchpartyRaeume.length) {
    const leer = document.createElement("small");
    leer.className = "room-empty";
    leer.textContent = "Noch kein Raum eingetragen.";
    watchpartyRoomList.replaceChildren(leer);
    return;
  }
  watchpartyRoomList.replaceChildren(...watchpartyRaeume.map((code) => {
    const chip = document.createElement("span");
    chip.className = "room-chip";
    // Der Verbindungspunkt zeigt je Raum, ob die Leitung wirklich steht.
    const stand = watchpartyState?.rooms?.find((raum) => raum.room === code);
    if (stand) chip.classList.add(stand.connected ? "is-online" : "is-offline");
    chip.append(code);
    const weg = document.createElement("button");
    weg.type = "button";
    weg.textContent = "✕";
    weg.title = `Raum „${code}“ entfernen`;
    weg.addEventListener("click", () => {
      watchpartyRaeume = watchpartyRaeume.filter((eintrag) => eintrag !== code);
      renderWatchpartyRaeume();
      // Die Chips haengen an keinem Formularfeld - ohne das hier bliebe der
      // Raum nach dem Schliessen der Einstellungen weiter verbunden.
      saveSettings();
    });
    chip.append(weg);
    return chip;
  }));
}

function watchpartyRaumHinzufuegen() {
  if (!watchpartyRoom) return;
  const eingabe = watchpartyRoom.value.trim();
  if (!eingabe) {
    showToast("Trage erst einen Raumcode ein");
    return;
  }
  // Dieselbe Regel wie im Relay - sonst steht der Raum in der Liste und meldet
  // erst beim Verbinden "Ungueltiger Raumcode".
  const beanstandung = watchpartyCodeBeanstandung(eingabe);
  if (beanstandung) {
    showToast(beanstandung);
    return;
  }
  const codes = raumcodes([...watchpartyRaeume, eingabe]);
  if (codes.length === watchpartyRaeume.length) {
    showToast("Diesen Raum gibt es schon");
    return;
  }
  if (codes.length > 8) {
    showToast("Mehr als acht Räume gehen nicht");
    return;
  }
  watchpartyRaeume = codes;
  watchpartyRoom.value = "";
  renderWatchpartyRaeume();
  saveSettings();
}

// Oben rechts: ob diese Folge live mitlaeuft, wer zuletzt gesteuert hat und ein
// Schalter dafuer. Es gibt genau zwei Zustaende - privat oder live in einer
// Runde. "Live beitreten" fragt, welche Watchparty gemeint ist; "Live
// verlassen" stellt zurueck auf privat. Die Mitgliedschaft bleibt beides Mal.
let watchpartyLiveKey = "";
let watchpartyLiveOn = false;
let watchpartyLiveRoom = "";

async function toggleWatchpartyLive() {
  if (!watchpartyLiveKey) return;
  const an = !watchpartyLiveOn;
  let ergebnis = await api.toggleWatchpartyLive?.(watchpartyLiveKey, an, an ? "" : watchpartyLiveRoom);
  // Laeuft derselbe Anime in mehreren Runden, fragt der Hauptprozess zurueck,
  // welcher man live folgen will.
  if (ergebnis?.needsRoom) {
    const gewaehlt = await frageLiveRaum(ergebnis.rooms || []);
    if (!gewaehlt) return;
    ergebnis = await api.toggleWatchpartyLive?.(watchpartyLiveKey, an, gewaehlt);
  }
  const raum = an ? (ergebnis?.room || watchpartyLiveRoom) : "";
  showWatchpartyLive({ active: true, live: an, inParty: an, key: watchpartyLiveKey, room: raum });
  showToast(an
    ? (raum ? `Live in „${raum}“ — ihr schaut gemeinsam` : "Live beigetreten — ihr schaut gemeinsam")
    : "Zählt jetzt nur für dich — der Stand bleibt privat");
}

// Umschalten, fuer wen das gerade Geschaute zaehlt: privat oder eine bestimmte
// Runde. Die Anzeige oben ist zugleich der Schalter.
async function switchWatchpartyContext() {
  if (watchpartyLiveBanner?.classList.contains("is-hidden")) return;
  const anker = watchpartyLiveBanner?.getBoundingClientRect();
  const punkt = anker ? { x: anker.left, y: anker.bottom + 4 } : null;
  const ergebnis = await api.switchWatchpartyContext?.(punkt).catch(() => null);
  if (!ergebnis?.switched) return;
  showToast(ergebnis.room
    ? `Zählt jetzt für „${ergebnis.room}“ — Fortschritt läuft dorthin`
    : "Zählt jetzt nur für dich — der Stand bleibt privat");
}

// Auswahl, welcher Runde man live folgt. Wie beim Teilen ein Fenstermenue:
// ueber der Anbieterseite waere ein Kaestchen aus HTML nicht anklickbar.
async function frageLiveRaum(raeume) {
  const anker = document.querySelector("#watchpartyLiveLeave")?.getBoundingClientRect();
  const punkt = anker ? { x: anker.left, y: anker.bottom + 4 } : null;
  return api.chooseWatchpartyRoom?.(raeume, punkt).catch(() => "");
}

// Den Takt an jemand anderen abgeben. Zur Wahl steht, wer gerade wirklich bei
// derselben Folge mitschaut - das weiss die Leiste ohnehin schon.
async function watchpartyHostWeitergeben() {
  if (!watchpartyLiveKey) return;
  const andere = (watchpartyStandDaten?.members || []).filter((person) => !person.me);
  if (!andere.length) {
    showToast("Gerade schaut niemand sonst mit");
    return;
  }
  const knopf = document.querySelector("#watchpartyHandover");
  const anker = knopf?.getBoundingClientRect();
  const punkt = anker ? { x: anker.left, y: anker.bottom + 4 } : null;
  const wen = await api.chooseWatchpartyMember?.(
    andere.map((person) => ({ id: person.id, name: person.name, paused: person.paused })),
    punkt
  ).catch(() => "");
  if (!wen) return;
  await api.handoverWatchpartyHost?.(watchpartyLiveKey, wen, watchpartyLiveRoom);
  const name = andere.find((person) => person.id === wen)?.name || "das Gerät";
  showToast(`Host an ${name} weitergegeben`);
}

// Bringt alle gemeinsam auf dieselbe Stelle: erst halten alle an und springen
// dorthin, dann startet der Raum sie zusammen.
async function resyncWatchparty() {
  if (!watchpartyLiveKey) return;
  const knopf = document.querySelector("#watchpartyResync");
  knopf?.classList.add("is-busy");
  await api.resyncWatchparty?.(watchpartyLiveKey, watchpartyLiveRoom);
  showToast("Alle werden abgeglichen …");
  // Der Ring bleibt, bis der Raum den Abgleich abschliesst - laenger als ein
  // paar Sekunden soll er aber nicht stehen.
  window.setTimeout(() => knopf?.classList.remove("is-busy"), 5000);
}

// Zeigt oben rechts den Live-Zustand. Die Meldung kommt bei jedem Anlass sofort
// aus dem Hauptprozess - Umschalten, Seitenwechsel, Raumaenderung und
// Verbindungswechsel -, deshalb hinkt hier nichts mehr hinterher.
function showWatchpartyLive(info) {
  if (!watchpartyLiveBanner || !watchpartyLiveLeave) return;
  const syncKnopf = document.querySelector("#watchpartyResync");
  watchpartyLiveKey = info?.key || "";
  // Raum und Live-Zustand kommen nur mit der vollen Meldung. Kurze Zwischenrufe
  // ("X hat pausiert") fuehren sie nicht mit und duerfen sie nicht loeschen -
  // sonst faellt die Anzeige mitten im gemeinsamen Schauen auf "Privat".
  if (info && "live" in info) watchpartyLiveOn = Boolean(info.live);
  if (info && "room" in info) watchpartyLiveRoom = info.room || "";
  // Nur die volle Meldung fuehrt den Host mit. Sie wird gemerkt, damit die
  // Anzeige nach einem Zwischenruf wieder auf den bestaetigten Stand
  // zurueckfaellt statt auf einen alten Namen.
  if (info && "hostName" in info) watchpartyLetzteMeldung = info;

  const erkannt = Boolean(info?.active);
  const verbunden = info?.connected !== false;
  // Nur zwei Zustaende: live in einer Runde oder privat. Ein "in der
  // Watchparty, aber nicht live" gibt es nicht mehr - also entscheidet allein
  // watchpartyLiveOn, was hier steht.
  //
  // Die Anzeige selbst steht, sobald dieser Titel in einer Runde laeuft: sie
  // sagt, ob gerade privat oder fuer eine Watchparty geschaut wird, und laesst
  // sich anklicken, um genau das umzustellen.
  watchpartyLiveBanner.classList.toggle("is-hidden", !erkannt);
  // Der Knopf gehoert in beide Zustaende: privat heisst er "Live beitreten",
  // live heisst er "Live verlassen".
  watchpartyLiveLeave.classList.toggle("is-hidden", !erkannt);
  // Abgleichen ergibt nur Sinn, wenn man live dabei und verbunden ist.
  syncKnopf?.classList.toggle("is-hidden", !erkannt || !watchpartyLiveOn || !verbunden);
  // Weitergeben kann nur, wer den Takt hat - und nur, wenn jemand da ist.
  const uebergabeKnopf = document.querySelector("#watchpartyHandover");
  const andereDa = (watchpartyStandDaten?.members || []).some((person) => !person.me);
  uebergabeKnopf?.classList.toggle("is-hidden",
    !erkannt || !watchpartyLiveOn || !verbunden || !info?.host || !andereDa);
  // Die Leiste haengt am selben Zustand: privat gibt es nichts zu vergleichen.
  renderWatchpartyStand();
  if (!erkannt) return;

  watchpartyLiveLeave.disabled = watchpartyLiveOn && !verbunden;
  watchpartyLiveLeave.textContent = watchpartyLiveOn ? "Live verlassen" : "Live beitreten";
  watchpartyLiveLeave.title = watchpartyLiveOn
    ? "Zurück auf privat — du bleibst in der Watchparty, der Stand zählt wieder nur für dich"
    : "Einer Watchparty live folgen — gemeinsam schauen und steuern";

  watchpartyLiveBanner.classList.toggle("is-private", !watchpartyLiveOn);
  if (!watchpartyLiveOn) {
    // Privat: kein Live-Zustand, keine Verbindungsfarbe - nur der Hinweis,
    // dass dieser Stand niemandem sonst gemeldet wird.
    watchpartyLiveBanner.classList.remove("is-offline");
    if (watchpartyLiveText) watchpartyLiveText.textContent = "Privat";
    watchpartyLiveBanner.title = "Zählt nur für dich — klicken, um in eine Watchparty zu wechseln";
    return;
  }

  watchpartyLiveBanner.title = watchpartyLiveRoom
    ? `Watchparty „${watchpartyLiveRoom}“ — klicken, um zu wechseln`
    : "Watchparty — klicken, um zu wechseln";

  // Ohne Verbindung laesst sich weder steuern noch abgleichen.
  if (syncKnopf) syncKnopf.disabled = !verbunden;
  watchpartyLiveBanner.classList.toggle("is-offline", !verbunden);

  if (!watchpartyLiveText) return;
  if (!verbunden) {
    watchpartyLiveText.textContent = "Verbindung weg …";
    return;
  }
  document.querySelector("#watchpartyResync")?.classList.toggle("is-busy", Boolean(info.syncing));
  if (info.syncing) {
    const stelle = Number(info.position || 0);
    watchpartyLiveText.textContent = `Wird abgeglichen${stelle ? ` auf ${formatClock(stelle)}` : ""} …`;
    return;
  }
  if (info.from && info.action) {
    const was = info.action === "pause" ? "hat pausiert"
      : info.action === "play" ? "spielt weiter"
      : info.action === "navigate" ? "hat die Folge gewechselt"
      : "ist gesprungen";
    watchpartyLiveText.textContent = `Live: ${info.from} ${was}`;
    window.clearTimeout(watchpartyLiveTimer);
    watchpartyLiveTimer = window.setTimeout(() => {
      if (watchpartyLiveText && watchpartyLiveOn) {
        watchpartyLiveText.textContent = watchpartyHostText(watchpartyLetzteMeldung || info);
      }
    }, 6000);
    return;
  }
  if (!watchpartyLiveText.textContent.startsWith("Live:")) {
    watchpartyLiveText.textContent = watchpartyHostText(watchpartyLetzteMeldung || info);
  }
}

// Die Leiste in der Kopfzeile: wer steht wo, und wer haengt hinterher. Sie
// gehoert in die Kopfzeile, weil die Anbieterseite ueber der Oberflaeche liegt -
// ein Streifen darunter waere ausgerechnet beim Schauen unsichtbar.
function showWatchpartyStand(info) {
  const mitglieder = Array.isArray(info?.members) ? info.members : [];

  // Fuer die Karten: nach Titel und Runde ablegen, unabhaengig davon, was
  // gerade offen ist.
  const kartenSchluessel = `${info?.key || ""}|${info?.room || ""}`;
  // Auch eine leere Liste wird abgelegt, nicht geloescht: sonst faellt die
  // Karte auf die alte Quelle zurueck und die Zeile springt hin und her. Ob
  // jemand noch dabei ist, entscheidet allein das Alter der Meldung.
  watchpartyStandKarten.set(kartenSchluessel, { members: mitglieder, empfangen: Date.now() });
  aktualisiereLiveKarten();
  if (!watchpartyStandTimer) {
    watchpartyStandTimer = window.setInterval(() => {
      renderWatchpartyStand();
      aktualisiereLiveKarten();
    }, 1000);
  }

  // Kopfzeile und Player betreffen nur die offene Seite.
  if (info && info.offen === false) return;

  watchpartyPausedBy = String(info?.pausedBy || "");
  watchpartyStandDaten = mitglieder.length
    ? {
      key: info.key || "",
      room: info.room || "",
      // Die Folge, die hier offen ist - daran erkennt die Leiste, wer woanders
      // steht.
      season: Number(info.season || 0),
      episode: Number(info.episode || 0),
      members: mitglieder,
      empfangen: Date.now()
    }
    : null;
  renderWatchpartyStand();
  // Pausiert-von und Host gehoeren auch in die Kopfzeile - sofort, nicht erst
  // beim naechsten Anlass.
  if (watchpartyLiveText && watchpartyLiveOn) {
    watchpartyLiveText.textContent = watchpartyHostText(watchpartyLetzteMeldung || {});
  }
  if (watchpartyStandTimer) return;
  // Zwischen zwei Meldungen laufen die Uhren hier weiter, sonst haengt die
  // Anzeige sichtbar hinter dem Bild her.
  watchpartyStandTimer = window.setInterval(renderWatchpartyStand, 1000);
}

// Die Sekunde, bei der ein Geraet jetzt stehen duerfte: die gemeldete Stelle
// plus die Zeit, die seither vergangen ist - aber nur, wenn dort nicht
// angehalten ist.
function standSekunde(mitglied, seit) {
  const gelaufen = mitglied.paused ? 0 : seit + Number(mitglied.age || 0);
  return Math.max(0, Number(mitglied.position || 0) + gelaufen);
}

// "S1E4" statt einer Sekunde, wenn jemand ganz woanders ist.
function folgeKurz(mitglied) {
  const staffel = Number(mitglied.season || 0);
  const folge = Number(mitglied.episode || 0);
  return staffel ? `S${staffel}E${folge}` : `F${folge}`;
}

function renderWatchpartyStand() {
  if (!watchpartyStand) return;
  const daten = watchpartyStandDaten;
  // Allein in der Runde gibt es nichts zu vergleichen.
  const zeigen = Boolean(daten) && watchpartyLiveOn && daten.members.length > 1;
  watchpartyStand.classList.toggle("is-hidden", !zeigen);
  if (!zeigen) {
    watchpartyStand.replaceChildren();
    return;
  }

  const seit = Math.max(0, (Date.now() - daten.empfangen) / 1000);
  // Bleiben Meldungen ganz aus, ist dort niemand mehr an dieser Serie. Das
  // Relay filtert das schon; hier steht der Schutz fuer den Fall, dass gar
  // keine neue Meldung mehr kommt und der letzte Stand stehenbliebe.
  const dabei = daten.members.filter((mitglied) => Number(mitglied.age || 0) + seit <= 20);
  if (dabei.length < 2) {
    watchpartyStand.classList.add("is-hidden");
    watchpartyStand.replaceChildren();
    return;
  }

  const host = dabei.find((mitglied) => mitglied.host);
  const bezug = standSekunde(host || dabei[0], seit);

  watchpartyStand.replaceChildren(...dabei.map((mitglied) => {
    const sekunde = standSekunde(mitglied, seit);
    const abstand = Math.abs(sekunde - bezug);
    // Steht jemand bei einer anderen Folge, sagt der Sekundenvergleich nichts.
    const andereFolge = Boolean(daten.episode) && Boolean(mitglied.episode)
      && (mitglied.episode !== daten.episode || (mitglied.season || 0) !== (daten.season || 0));

    const chip = document.createElement("span");
    chip.className = "stand-chip";
    chip.classList.toggle("is-paused", Boolean(mitglied.paused));
    chip.classList.toggle("is-me", Boolean(mitglied.me));
    chip.classList.toggle("is-host", Boolean(mitglied.host));
    chip.classList.toggle("is-elsewhere", andereFolge);
    // Mehr als zwei Sekunden auseinander faellt beim gemeinsamen Schauen auf.
    chip.classList.toggle("is-drift", !andereFolge && !mitglied.paused && abstand > 2);

    // Ein Zeichen statt eines Punktes: laeuft oder haelt an, das muss man
    // sehen, ohne zwei Grautoene zu vergleichen. Die Farbe kommt dazu, damit
    // es auch dann eindeutig bleibt, wenn eine Schrift das Zeichen nicht hat.
    const zeichen = document.createElement("span");
    zeichen.className = "stand-zeichen";
    zeichen.textContent = mitglied.paused ? "❚❚" : "▶";

    const name = document.createElement("span");
    name.className = "stand-name";
    name.textContent = mitglied.me ? "Du" : mitglied.name;

    const uhr = document.createElement("span");
    uhr.className = "stand-uhr";
    uhr.textContent = andereFolge ? folgeKurz(mitglied) : formatClock(sekunde);

    chip.append(zeichen, name);
    // Wer den Takt vorgibt, steht ausdruecklich dran - vorher war er nur
    // etwas fetter als die anderen und damit kaum zu erkennen.
    if (mitglied.host) {
      const marke = document.createElement("span");
      marke.className = "stand-marke";
      marke.textContent = "Host";
      chip.append(marke);
    }
    chip.append(uhr);
    chip.title = `${mitglied.host ? "Host — " : ""}${mitglied.name}: `
      + (andereFolge
        ? `bei Staffel ${mitglied.season || "?"} Folge ${mitglied.episode} — ${mitglied.paused ? "pausiert" : "läuft"} bei ${formatClock(sekunde)}`
        : `${mitglied.paused ? "pausiert" : "läuft"} bei ${formatClock(sekunde)}`
          + (!mitglied.paused && abstand > 2 ? ` — ${Math.round(abstand)} s Unterschied` : ""));
    return chip;
  }));
}

// Wer den Takt vorgibt, steht in der Anzeige - daran orientiert sich "Sync".
function watchpartyHostText(info) {
  // Bei mehreren Raeumen gehoert dazu, welcher gerade laeuft.
  const raum = (watchpartyState?.rooms?.length || 0) > 1 && watchpartyLiveRoom
    ? ` · ${watchpartyLiveRoom}`
    : "";
  // Steht die Runde, ist die wichtigste Auskunft, wer sie angehalten hat.
  if (watchpartyPausedBy && watchpartyStehtStill()) {
    return `Live · Pausiert von ${watchpartyPausedBy}${raum}`;
  }
  if (info?.host) return `Live · du bist Host${raum}`;
  // Kein Host heisst: in dieser Folge ist gerade niemand sonst am Player. Dann
  // wird auch keiner genannt - vorher stand dort ein Name aus der Vergangenheit.
  if (info?.hostName) return `Live · Host: ${info.hostName}${raum}`;
  return `Live${raum}`;
}

// Steht die Runde? Massgeblich ist der vom Relay bestaetigte Zustand der
// Teilnehmer, nicht ein oertliches Ereignis von vorhin.
function watchpartyStehtStill() {
  const mitglieder = watchpartyStandDaten?.members || [];
  if (!mitglieder.length) return false;
  return mitglieder.every((mitglied) => mitglied.paused);
}

// Rueckmeldung an den Neu-laden-Knoepfen. Der Klick dreht sofort los, damit die
// Aktion spuerbar ist; danach uebernimmt der echte Ladezustand aus dem
// Hauptprozess - so dreht es genau so lange, wie wirklich geladen wird.
let ladeMindestzeit = 0;

function markiereNeuladen(auswahl, dauer = 600) {
  const knopf = document.querySelector(auswahl);
  if (!knopf) return;
  knopf.classList.add("is-reloading");
  ladeMindestzeit = Date.now() + dauer;
  window.setTimeout(() => {
    if (Date.now() >= ladeMindestzeit) knopf.classList.remove("is-reloading");
  }, dauer);
}

function zeigeLadezustand(laeuft) {
  const knopf = document.querySelector("#reloadButton");
  if (!knopf) return;
  if (laeuft) {
    knopf.classList.add("is-reloading");
    return;
  }
  // Nicht mitten in der angestossenen Drehung abbrechen - sonst blitzt es nur
  // kurz auf und wirkt wie nichts passiert.
  const rest = ladeMindestzeit - Date.now();
  if (rest > 0) {
    window.setTimeout(() => knopf.classList.remove("is-reloading"), rest);
    return;
  }
  knopf.classList.remove("is-reloading");
}
