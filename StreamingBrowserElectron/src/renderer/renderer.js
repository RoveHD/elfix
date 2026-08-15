const api = window.streamingBrowser;

let providers = [];
let favorites = [];
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
const thumbnailRepairAttempts = new Set();

const appShell = document.querySelector(".app-shell");
const appSidebar = document.querySelector("#appSidebar");
const sidebarToggle = document.querySelector("#sidebarToggle");
const homeSidebarToggle = document.querySelector("#homeSidebarToggle");
const providerRail = document.querySelector("#providerRail");
const homeProviders = document.querySelector("#homeProviders");
const homeSidebarProviders = document.querySelector("#homeSidebarProviders");
const homeRecommendations = document.querySelector("#homeRecommendations");
const recommendedHomeRow = document.querySelector("#recommendedHomeRow");
const homePersonal = document.querySelector("#homePersonal");
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
const providersHomeRow = document.querySelector("#providersHomeRow");
const favoritesHomeRow = document.querySelector("#favoritesHomeRow");
const heroTitle = document.querySelector("#heroTitle");
const heroCopy = document.querySelector("#heroCopy");
const searchTitle = document.querySelector("#searchTitle");
const searchHistoryNode = document.querySelector("#searchHistory");
const globalSearchGrid = document.querySelector("#globalSearchGrid");
const homeFavorites = document.querySelector("#homeFavorites");
const favoritesGrid = document.querySelector("#favoritesGrid");
const favoritesEmpty = document.querySelector("#favoritesEmpty");
const libraryGrid = document.querySelector("#libraryGrid");
const libraryEmpty = document.querySelector("#libraryEmpty");
const continueGrid = document.querySelector("#continueGrid");
const continueEmpty = document.querySelector("#continueEmpty");
const historyList = document.querySelector("#historyList");
const historyEmpty = document.querySelector("#historyEmpty");
const historyClear = document.querySelector("#historyClear");
const toastStack = document.querySelector("#toastStack");
const confirmModal = document.querySelector("#confirmModal");
const confirmEyebrow = document.querySelector("#confirmEyebrow");
const confirmTitle = document.querySelector("#confirmTitle");
const confirmCopy = document.querySelector("#confirmCopy");
const confirmAccept = document.querySelector("#confirmAccept");
const confirmCancel = document.querySelector("#confirmCancel");
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
const showHomeProviders = document.querySelector("#showHomeProviders");
const showHomeFavorites = document.querySelector("#showHomeFavorites");
const showHomePersonal = document.querySelector("#showHomePersonal");
const showHomeCategories = document.querySelector("#showHomeCategories");
const watchpartyEnabled = document.querySelector("#watchpartyEnabled");
const watchpartyServer = document.querySelector("#watchpartyServer");
const watchpartyRoom = document.querySelector("#watchpartyRoom");
const watchpartyName = document.querySelector("#watchpartyName");
const watchpartyStatus = document.querySelector("#watchpartyStatus");
const watchpartyLiveBanner = document.querySelector("#watchpartyLiveBanner");
const watchpartyLiveLeave = document.querySelector("#watchpartyLiveLeave");
const watchpartyLiveText = document.querySelector("#watchpartyLiveText");
let watchpartyLiveTimer = 0;
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
  showProviders: true,
  showFavorites: true,
  showPersonal: true,
  showCategories: true,
  providerCardMeta: "logoName"
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
  cardSize: "medium",
  favoriteSize: "medium",
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

  document.querySelector("#startButton")?.addEventListener("click", showHome);
  document.querySelector("#searchButton")?.addEventListener("click", openSearchView);
  document.querySelector("#favoritesButton")?.addEventListener("click", showFavorites);
  document.querySelector("#settingsButton").addEventListener("click", openSettings);
  startDiscoverRefresh();
  document.querySelector("#watchpartyShareButton")?.addEventListener("click", shareCurrentToWatchparty);
  api.onWatchpartyState?.(renderWatchpartyStatus);
  api.onWatchpartyLive?.(showWatchpartyLive);
  watchpartyLiveLeave?.addEventListener("click", toggleWatchpartyLive);
  document.querySelector("#watchpartyResync")?.addEventListener("click", resyncWatchparty);
  api.onWatchpartyItems?.((items) => {
    watchpartyItems = Array.isArray(items) ? items : [];
    renderWatchpartyItems();
  });
  api.getWatchpartyStatus?.().then(renderWatchpartyStatus).catch(() => {});
  loadWatchpartyItems();
  document.querySelector("#watchpartySettingsLink")?.addEventListener("click", () => openSettings());
  document.querySelector("#watchpartyOpenSettings")?.addEventListener("click", () => openSettings());
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
  document.querySelector("#favoritesOpenProvider").addEventListener("click", openActiveProvider);
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
  document.querySelector("#reloadButton").addEventListener("click", () => api.browserCommand("reload"));
  document.querySelector("#reloadAllButton").addEventListener("click", async () => {
    const state = await api.browserCommand("reloadAll");
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
    routeBeforeSettings = null;
    api.setSettingsOpen(false).then(() => {
      // Nach dem Schliessen immer auf der Startseite landen - vorher konnte man
      // auf einer halb sichtbaren Zwischenansicht herauskommen.
      showHome();
    });
  });
  document.querySelector("#newProviderButton").addEventListener("click", clearProviderForm);
  document.querySelector("#deleteProviderButton").addEventListener("click", deleteSelectedProvider);
  document.querySelector("#moveUpButton").addEventListener("click", () => moveSelectedProvider(-1));
  document.querySelector("#moveDownButton").addEventListener("click", () => moveSelectedProvider(1));
  providerForm.addEventListener("submit", saveProviderForm);

  document.querySelector("#updateFiltersButton").addEventListener("click", updateFilters);
  document.querySelector("#clearCacheButton").addEventListener("click", () => api.clearCache());
  document.querySelector("#openDataFolderButton").addEventListener("click", () => api.openDataFolder());
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
    showHomeProviders,
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
      if (choice !== "custom") setRangeChoice("uiDensity", choice);
      settings.appearance = { ...DEFAULT_APPEARANCE_SETTINGS, ...(settings.appearance || {}), layoutStyle: choice === "custom" ? "custom" : settings.appearance?.layoutStyle || "standard" };
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
  favoriteProgressMode.addEventListener("change", saveSettings);
  pauseOnMinimize.addEventListener("change", saveSettings);
  pauseOnBlur.addEventListener("change", saveSettings);

  api.onBrowserState((state) => {
    activeProviderId = state.activeProviderId;
    currentUrl = state.url || "";
    if (Array.isArray(state.favorites)) {
      favorites = state.favorites;
      renderFavorites();
      renderHome();
      renderLibraryViews();
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

function renderProviders() {
  const enabled = providers.filter((provider) => provider.enabled !== false);
  providerRail.replaceChildren(...enabled.map((provider) => providerCard(provider, false)));
  if (!enabled.length) {
    providerRail.append(emptyText("Keine Anbieter. Settings öffnen."));
  }
  renderSidebarProviders(enabled);
  renderRouteActiveState();
}

function renderSidebarProviders(enabled = providers.filter((provider) => provider.enabled !== false)) {
  if (!homeSidebarProviders) return;
  homeSidebarProviders.replaceChildren(...enabled.map((provider) => sidebarProviderButton(provider)));
}

function renderHome() {
  if (!homeView || !homeHero || !homeProviders || !homeFavorites) return;
  const enabled = providers.filter((provider) => provider.enabled !== false);
  const hasProviders = enabled.length > 0;
  const homeSettings = settings.home || DEFAULT_HOME_SETTINGS;
  const heroVisible = hasProviders && homeSettings.showHero !== false;
  noProvidersState?.classList.toggle("is-hidden", hasProviders);
  homeHero.classList.toggle("is-hidden", !heroVisible);
  providersHomeRow?.classList.toggle("is-hidden", !hasProviders || homeSettings.showProviders === false);

  const continueItems = sortedHomeFavorites();
  const heroProvider = enabled.find((provider) => provider.id === activeProviderId) || enabled[0] || null;
  heroItems = continueItems.slice(0, HERO_ROTATION_COUNT);
  if (heroIndex >= heroItems.length) heroIndex = 0;
  renderHomeHero(heroItems[heroIndex] || null, heroProvider, hasProviders);
  renderHeroDots();
  startHeroRotation();

  homeProviders.replaceChildren(...enabled.map((provider) => providerShowcaseCard(provider)));
  if (!enabled.length) {
    homeProviders.append(emptyText("Noch keine Websites gespeichert."));
  }
  renderSidebarProviders(enabled);

  const recentFavorites = continueItems.slice(0, 8);
  favoritesHomeRow?.classList.toggle("is-hidden", recentFavorites.length === 0 || homeSettings.showFavorites === false);
  homeFavorites.replaceChildren(...recentFavorites.map((favorite) => favoriteCard(favorite, false, {
    showProgress: true,
    autoplay: true,
    fullscreen: true
  })));

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
  if (!watchpartyStatus) return;
  if (!state?.enabled) {
    watchpartyStatus.textContent = "Ausgeschaltet.";
    return;
  }
  if (state.error && !state.connected) {
    watchpartyStatus.textContent = `Nicht verbunden: ${state.error}`;
    return;
  }
  if (!state.connected) {
    watchpartyStatus.textContent = "Verbinde …";
    return;
  }
  const andere = Math.max(0, (state.peers?.length || 1) - 1);
  const geraete = andere === 0
    ? "noch niemand sonst"
    : `${andere} weiteres Gerät${andere === 1 ? "" : "e"}`;
  watchpartyStatus.textContent = `Verbunden mit Raum „${state.room}“ — ${geraete}.`;
}

function discoverCard(item) {
  const card = document.createElement("div");
  card.className = `favorite-card${item.image ? " has-thumb" : ""}`;
  card.tabIndex = 0;
  card.role = "button";
  card.title = item.viaSearch ? `${item.title} bei ${item.providerName} suchen` : item.title;
  if (item.image) {
    card.style.backgroundImage = `linear-gradient(180deg, rgba(7, 10, 16, 0.05), rgba(7, 10, 16, 0.94)), url("${cssUrl(item.image)}")`;
  }
  const untertitel = item.reason
    ? `${item.reason} · ${item.providerName || ""}`
    : item.providerName || "";
  if (item.reason && !item.viaSearch) card.title = `${item.title} – ${item.reason}`;
  card.innerHTML = `
    <strong>${escapeHtml(item.title)}</strong>
    <span>${escapeHtml(untertitel)}</span>
  `;
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
    setHeroArtwork(favorite.thumbnail);
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

function setHeroArtwork(value) {
  if (!homeHero) return;
  const image = String(value || "").trim();
  homeHero.style.setProperty("--hero-image", image ? `url("${cssUrl(image)}")` : "none");
  homeHero.classList.toggle("has-artwork", Boolean(image));
}

function sortedHomeFavorites() {
  return continueEntries()
    .slice()
    .sort((left, right) => favoriteTimestamp(right) - favoriteTimestamp(left));
}

function favoriteTimestamp(favorite) {
  const candidates = [favorite.lastWatchedAt, favorite.openedAt, favorite.updatedAt, favorite.createdAt, favorite.addedAt];
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

function providerShowcaseCard(provider) {
  const card = providerCard(provider, true);
  card.classList.add("provider-showcase-card");
  const host = document.createElement("span");
  host.className = "provider-host";
  host.textContent = providerHost(provider);
  card.append(host);
  return card;
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

function providerHost(provider) {
  try {
    return new URL(provider.startUrl || provider.home || provider.searchUrl || "").hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
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
  if (action === "help") {
    setCurrentRoute("help");
    showToast("Hilfe & Support kommt in die Einstellungen");
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
  card.className = `provider-card${provider.id === activeProviderId ? " is-active" : ""}`;
  card.type = "button";
  card.style.flexBasis = large ? "220px" : "";
  card.style.height = large ? "78px" : "";
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
  return card;
}

function emptyText(text) {
  const node = document.createElement("div");
  node.className = "setting-card";
  node.textContent = text;
  return node;
}

async function enterInternalMode() {
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
  const andere = Math.max(0, (state.peers?.length || 1) - 1);
  const geraete = andere === 0 ? "noch niemand sonst" : `${andere} weiteres Gerät${andere === 1 ? "" : "e"}`;
  watchpartyViewStatus.textContent = `Raum „${state.room}“ — ${geraete}. ${grund}`;
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
  watchpartyGrid.replaceChildren(...(vorhanden ? watchpartyItems.map(watchpartyCard) : []));

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

// Wartet, bis der Raum die Aenderung zurueckgemeldet hat. Ohne das meldet die
// Oberflaeche Erfolg, obwohl die Nachricht ins Leere gehen kann.
function warteAufMitgliedschaft(key, sollDabeiSein, timeoutMs = 3000) {
  const passt = () => Boolean(watchpartyItems.find((eintrag) => eintrag.key === key)?.joined) === sollDabeiSein;
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

function warteAufEntfernen(key, timeoutMs = 3000) {
  return new Promise((fertig) => {
    const weg = () => !watchpartyItems.some((eintrag) => eintrag.key === key);
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
  card.className = `favorite-card watchparty-card${item.thumbnail ? " has-thumb" : ""}`;
  if (item.thumbnail) {
    card.style.backgroundImage = `linear-gradient(180deg, rgba(7, 10, 16, 0.05), rgba(7, 10, 16, 0.94)), url("${cssUrl(item.thumbnail)}")`;
  }

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

  const mitgliederZeile = document.createElement("div");
  mitgliederZeile.className = "watchparty-members";
  if (!mitglieder.length) {
    mitgliederZeile.textContent = "noch niemand dabei";
  } else {
    mitgliederZeile.append(`${mitglieder.length} dabei: `);
    mitglieder.forEach((name, index) => {
      const id = item.memberIds?.[index];
      const eigenes = id && id === item.myId;
      mitgliederZeile.append(index ? ", " : "");
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
          await api.kickFromWatchparty(item.key, id);
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
    const jetztDabei = Boolean(watchpartyItems.find((eintrag) => eintrag.key === item.key)?.joined);
    beitreten.disabled = true;
    try {
      if (jetztDabei) {
        await api.leaveWatchparty(item.key);
      } else {
        await api.enterWatchparty(item.key);
      }
      const bestaetigt = await warteAufMitgliedschaft(item.key, !jetztDabei);
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
    const state = await api.openWatchpartyItem(item.key);
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
        await api.removeFromWatchparty(item.key);
        const weg = await warteAufEntfernen(item.key);
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
        const card = document.createElement("button");
        card.className = "search-result-card provider-result";
        card.type = "button";
        const meta = [result.genre, provider.providerName].filter(Boolean).join(" · ");
        card.innerHTML = `<strong>${escapeHtml(result.title)}</strong><span>${escapeHtml(meta)}</span>`;
        card.addEventListener("click", async () => {
          hideContentViews();
          await api.setShellOpen(false);
          const state = await api.openProviderUrl(provider.providerId, result.url);
          activeProviderId = state?.activeProviderId || provider.providerId;
          setCurrentRoute(`provider:${activeProviderId}`);
          renderProviders();
        });
        resultNodes.push(card);
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
  favoritesGrid.replaceChildren(...items.map((favorite) => favoriteCard(favorite, true, { showProgress: hasContinueActivity(favorite) })));
  favoritesEmpty.classList.toggle("is-hidden", items.length > 0);
}

function renderLibraryViews() {
  const libraryItems = libraryEntries();
  libraryGrid?.replaceChildren(...libraryItems.map((favorite) => favoriteCard(favorite, false)));
  libraryEmpty?.classList.toggle("is-hidden", libraryItems.length > 0);

  const continueItems = continueEntries();
  continueGrid?.replaceChildren(...continueItems.map((favorite) => favoriteCard(favorite, false, {
    showProgress: true,
    allowContinueRemove: true,
    autoplay: true,
    fullscreen: true
  })));
  continueEmpty?.classList.toggle("is-hidden", continueItems.length > 0);

  const historyItems = historyEntries();
  historyList?.replaceChildren(...historyItems.map(historyRow));
  historyEmpty?.classList.toggle("is-hidden", historyItems.length > 0);
  updateHistoryClearVisibility(historyItems.length);
}

function confirmAction({ eyebrow = "ELFIX", title, copy = "", confirmLabel = "Löschen", cancelLabel = "Abbrechen" }) {
  if (!confirmModal?.showModal) return Promise.resolve(window.confirm(title));
  confirmEyebrow.textContent = eyebrow;
  confirmTitle.textContent = title;
  confirmCopy.textContent = copy;
  confirmCopy.classList.toggle("is-hidden", !copy);
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

function favoriteEntries() {
  return favorites
    .filter((item) => item.favorite !== false && !item.completed)
    .sort((left, right) => favoriteTimestamp(right) - favoriteTimestamp(left));
}

function libraryEntries() {
  return favorites
    .filter((item) => item.completed)
    .sort((left, right) => favoriteTimestamp(right) - favoriteTimestamp(left));
}

function continueEntries() {
  return favorites
    .filter((item) => hasContinueActivity(item) && !item.completed && !item.episodeCompleted && !item.hideFromContinueWatching)
    .sort((left, right) => favoriteTimestamp(right) - favoriteTimestamp(left));
}

function hasContinueActivity(item) {
  if (!item) return false;
  if (item.continuePending) return true;
  if (hasKnownMediaProgress(item)) return true;
  const progress = Number(item.progress || 0);
  const hasStoredProgress = Number.isFinite(progress) && progress > 0 && progress < 90;
  const hasStartedHistory = Boolean(item.lastWatchedAt || item.openedAt);
  return hasStartedHistory && hasStoredProgress;
}

function hasKnownMediaProgress(item) {
  const current = Number(item?.currentTime || item?.position || 0);
  const duration = Number(item?.duration || 0);
  const progress = favoriteProgressPercent(item);
  return Number.isFinite(current)
    && Number.isFinite(duration)
    && Number.isFinite(progress)
    && duration > 0
    && current > 0
    && current <= duration + 3
    && progress < 90;
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

function historyRow(item) {
  const row = document.createElement("button");
  row.className = "history-row";
  row.type = "button";
  const at = formatActivityTime(item.event.at);
  const label = item.event.label || favoriteEpisodeLabel(item.event.url || item.favorite.url);
  row.innerHTML = `
    <span>${escapeHtml(at)}</span>
    <strong>${escapeHtml(cleanFavoriteTitle(item.favorite.title, item.favorite.url) || "Inhalt")}</strong>
    <em>${escapeHtml(label || item.favorite.providerName || "")}</em>
  `;
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

  const state = await api.openFavorite(favorite.id, options);
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
  watchpartyView?.classList.add("is-hidden");
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
function watchpartyHint(favorite) {
  const wer = favorite?.watchpartyFrom;
  const wann = Date.parse(favorite?.watchpartyAt || 0) || 0;
  if (!wer || !wann) return "";
  // Nach zwei Minuten ohne neue Meldung gilt niemand mehr als "gerade dabei".
  if (Date.now() - wann > 120000) return "";
  return `<small class="media-progress-live">▶ ${escapeHtml(wer)} schaut gerade</small>`;
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

function favoriteCard(favorite, allowRemove, options = {}) {
  const card = document.createElement("div");
  card.className = `favorite-card${favorite.thumbnail ? " has-thumb" : ""}`;
  card.tabIndex = 0;
  card.role = "button";
  if (favorite.thumbnail) {
    card.style.backgroundImage = `linear-gradient(180deg, rgba(7, 10, 16, 0.05), rgba(7, 10, 16, 0.94)), url("${cssUrl(favorite.thumbnail)}")`;
  }
  card.innerHTML = `
    <strong>${escapeHtml(displayFavoriteTitle(favorite))}</strong>
    <span>${escapeHtml(favorite.providerName || "Provider")}</span>
    ${progressMarkup(favorite, options)}
  `;
  card.addEventListener("click", async () => {
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

  if (allowRemove || options.allowContinueRemove) {
    const menu = document.createElement("button");
    menu.className = "favorite-menu";
    menu.type = "button";
    menu.textContent = "⋯";
    menu.addEventListener("click", (event) => {
      event.stopPropagation();
      actions.classList.toggle("is-open");
    });
    const actions = document.createElement("div");
    actions.className = "favorite-actions";
    if (allowRemove) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Aus Watchlist entfernen";
      remove.addEventListener("click", async (event) => {
        event.stopPropagation();
        favorites = await api.removeFavorite(favorite.id);
        renderFavorites();
        renderHome();
        renderLibraryViews();
        renderFavoriteToggle();
        showToast("Aus Watchlist entfernt");
      });
      actions.append(remove);
    }
    if (options.allowContinueRemove) {
      const hideContinue = document.createElement("button");
      hideContinue.type = "button";
      hideContinue.textContent = "Aus Weiterschauen entfernen";
      hideContinue.addEventListener("click", async (event) => {
        event.stopPropagation();
        favorites = await api.hideFromContinue(favorite.id);
        renderHome();
        renderLibraryViews();
        showToast("Weiterschauen auf Anfang zurueckgesetzt");
      });
      actions.append(hideContinue);
    }
    card.append(menu, actions);
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
  probe.src = favorite.thumbnail;
}

async function repairFavoriteThumbnailOnce(favoriteId, force) {
  if (!favoriteId || thumbnailRepairAttempts.has(favoriteId)) return;
  thumbnailRepairAttempts.add(favoriteId);
  const result = await api.repairFavoriteThumbnail(favoriteId, force).catch(() => null);
  if (result?.favorites) {
    favorites = result.favorites;
  }
  if (!result?.repaired) {
    const favorite = favorites.find((item) => item.id === favoriteId);
    if (force && favorite) favorite.thumbnail = "";
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

function renderFavoriteToggle() {
  const button = document.querySelector("#favoriteButton");
  const active = Boolean(currentUrl && favoriteEntries().some((favorite) => normalizeFavoriteUrl(favorite.url) === normalizeFavoriteUrl(currentUrl)));
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

function renderRouteActiveState() {
  document.querySelectorAll("[data-home-action]").forEach((button) => {
    const route = sidebarRouteForAction(button.dataset.homeAction);
    button.classList.toggle("is-active", route === currentRoute);
  });
  document.querySelectorAll(".provider-side-link").forEach((button) => {
    button.classList.toggle("is-active", currentRoute === `provider:${button.dataset.providerId}`);
  });
}

function sidebarRouteForAction(action) {
  if (action === "favorites") return "watchlist";
  if (action === "continue") return "continue";
  if (action === "watchparty") return "watchparty";
  if (action === "library") return "library";
  if (action === "history") return "history";
  if (action === "search") return "search";
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
  showHomeProviders.checked = home.showProviders !== false;
  showHomeFavorites.checked = home.showFavorites !== false;
  if (showHomePersonal) showHomePersonal.checked = home.showPersonal !== false;
  if (showHomeCategories) showHomeCategories.checked = home.showCategories !== false;
  const party = settings.watchparty || {};
  if (watchpartyEnabled) watchpartyEnabled.checked = party.enabled === true;
  if (watchpartyServer) watchpartyServer.value = party.serverUrl || "";
  if (watchpartyRoom) watchpartyRoom.value = party.room || "";
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
  settings.playback = {
    pauseOnProviderSwitch: pauseOnProviderSwitch.checked,
    favoriteProgressMode: favoriteProgressMode.value,
    pauseOnMinimize: pauseOnMinimize.checked,
    pauseOnBlur: pauseOnBlur.checked
  };
  settings.home = {
    showHero: showHeroHome.checked,
    showProviders: showHomeProviders.checked,
    showFavorites: showHomeFavorites.checked,
    showPersonal: showHomePersonal ? showHomePersonal.checked : true,
    showCategories: showHomeCategories ? showHomeCategories.checked : true,
    providerCardMeta: providerCardMeta.value
  };
  settings.watchparty = {
    enabled: watchpartyEnabled ? watchpartyEnabled.checked : false,
    serverUrl: watchpartyServer ? watchpartyServer.value.trim() : "",
    room: watchpartyRoom ? watchpartyRoom.value.trim() : "",
    deviceName: watchpartyName ? watchpartyName.value.trim() : ""
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
    pauseOnBlur: false
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
    row.textContent = `${item.time} · ${item.provider} · ${item.type} · ${item.rule} · ${item.url}`;
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
    settings.watchparty = { enabled: false, serverUrl: "", room: "", deviceName: "" };
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
    const isCustom = button.dataset.densityChoice === "custom" && appearance.layoutStyle === "custom";
    button.classList.toggle("is-selected", button.dataset.densityChoice === appearance.uiDensity || isCustom);
  });
  document.querySelectorAll("[data-settings-mode-choice]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.settingsModeChoice === (appearance.settingsMode || "simple"));
  });
}

async function applyLayoutChoice(choice) {
  const updates = {
    standard: { uiDensity: "comfortable", cardSize: "medium", favoriteSize: "medium", favoriteLayout: "grid", cardStyle: "standard", spacingScale: 100, cardGap: 18 },
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
    layoutStyle: choice
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
  // Nach einem Seitenwechsel muss der Pfeil neu ausgerichtet werden.
  applySidebarState();
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
  const ergebnis = await api.shareCurrentToWatchparty?.().catch(() => null);
  if (!ergebnis?.shared) {
    showToast(ergebnis?.reason || "Konnte nicht geteilt werden");
    return;
  }
  showToast("Zur Watchparty hinzugefügt — die anderen können jetzt beitreten");
}

// Oben rechts: ob diese Folge live mitlaeuft, wer zuletzt gesteuert hat und ein
// Schalter dafuer. Der Schalter trennt nur die Live-Steuerung - die Watchparty
// und der geteilte Fortschritt bleiben bestehen.
let watchpartyLiveKey = "";
let watchpartyLiveOn = false;

function showWatchpartyLive(info) {
  if (!watchpartyLiveBanner || !watchpartyLiveLeave) return;
  watchpartyLiveKey = info?.key || "";
  watchpartyLiveOn = Boolean(info?.live);
  const erkannt = Boolean(info?.active);

  watchpartyLiveBanner.classList.toggle("is-hidden", !erkannt);
  watchpartyLiveLeave.classList.toggle("is-hidden", !erkannt);
  document.querySelector("#watchpartyResync")?.classList.toggle("is-hidden", !erkannt || !watchpartyLiveOn);
  if (!erkannt) return;

  // Waehrend des Gleichziehens steht dran, worauf gewartet wird.
  if (info.syncing) {
    watchpartyLiveBanner.classList.remove("is-paused");
    if (watchpartyLiveText) {
      const stelle = Number(info.position || 0);
      const zeit = stelle ? ` auf ${formatClock(stelle)}` : "";
      watchpartyLiveText.textContent = `Wird abgeglichen${zeit} …`;
    }
    return;
  }

  watchpartyLiveLeave.textContent = watchpartyLiveOn ? "Live verlassen" : "Live beitreten";
  watchpartyLiveLeave.title = watchpartyLiveOn
    ? "Nur die gemeinsame Steuerung beenden - du bleibst in der Watchparty"
    : "Wiedergabe wieder gemeinsam steuern";
  watchpartyLiveBanner.classList.toggle("is-paused", !watchpartyLiveOn);

  if (!watchpartyLiveText) return;
  if (!watchpartyLiveOn) {
    watchpartyLiveText.textContent = "Live aus";
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
      if (watchpartyLiveText && watchpartyLiveOn) watchpartyLiveText.textContent = "Live";
    }, 6000);
    return;
  }
  if (!watchpartyLiveText.textContent.startsWith("Live:")) watchpartyLiveText.textContent = "Live";
}

async function toggleWatchpartyLive() {
  if (!watchpartyLiveKey) return;
  const an = !watchpartyLiveOn;
  await api.toggleWatchpartyLive?.(watchpartyLiveKey, an);
  showWatchpartyLive({ active: true, live: an, key: watchpartyLiveKey });
  showToast(an
    ? "Live beigetreten — ihr steuert wieder gemeinsam"
    : "Live getrennt — du bleibst in der Watchparty, steuerst aber für dich");
}

// Bringt alle gemeinsam auf dieselbe Stelle: erst halten alle an und springen
// dorthin, dann startet der Raum sie zusammen.
async function resyncWatchparty() {
  if (!watchpartyLiveKey) return;
  await api.resyncWatchparty?.(watchpartyLiveKey);
  showToast("Alle werden abgeglichen …");
}
