const api = window.streamingBrowser;

let providers = [];
let favorites = [];
let settings = {};
let appInfo = {};
let updateState = {};
let activeProviderId = null;
let selectedProviderIndex = -1;
let draggedProviderIndex = -1;
let blockedRequests = [];
let filterLists = [];
let searchHistory = JSON.parse(localStorage.getItem("elflix-search-history") || "[]");
let currentUrl = "";
let activeSearchToken = 0;
const thumbnailRepairAttempts = new Set();

const providerRail = document.querySelector("#providerRail");
const homeProviders = document.querySelector("#homeProviders");
const browserFrame = document.querySelector("#browserFrame");
const homeView = document.querySelector("#homeView");
const globalSearchView = document.querySelector("#globalSearchView");
const favoritesView = document.querySelector("#favoritesView");
const noProvidersState = document.querySelector("#noProvidersState");
const homeHero = document.querySelector("#homeHero");
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
const toastStack = document.querySelector("#toastStack");
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
const filterStatus = document.querySelector("#filterStatus");
const filterListNames = document.querySelector("#filterListNames");
const appVersionLabel = document.querySelector("#appVersionLabel");
const updateFeedLabel = document.querySelector("#updateFeedLabel");
const updateStatusLabel = document.querySelector("#updateStatusLabel");
const updateProgressBar = document.querySelector("#updateProgressBar");
const updateProgressValue = document.querySelector("#updateProgressValue");
const updateCheckButton = document.querySelector("#updateCheckButton");
const updateReleaseLink = document.querySelector("#updateReleaseLink");

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
  providerCardMeta: "logoName"
};

const DEFAULT_APPEARANCE_SETTINGS = {
  compactHeader: true,
  themeMode: "dark",
  accentPreset: "blue",
  accentColor: "#147eff",
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
  fontScale: 100,
  animationMode: "full",
  cardStyle: "standard",
  shadowStyle: "standard",
  showProviderStrip: true,
  showFavoriteMeta: false,
  animations: true
};

const SETTINGS_INDEX = [
  ["appearance", "Theme", "Hell, dunkel oder OLED schwarz einstellen"],
  ["appearance", "Akzentfarbe", "Preset, eigene Farbe, Hex-Code und Stärke"],
  ["appearance", "UI-Dichte", "Kompakt, normal oder groß"],
  ["appearance", "Schriftgröße", "Text größer oder kleiner machen"],
  ["appearance", "Kartenstil", "Favoriten, Suchtreffer, Schatten und Rundung"],
  ["homeSettings", "Startseite", "Hero, Anbieter und Favoriten auf Home steuern"],
  ["favoritesSettings", "Favoriten", "Größe, Layout, Bild und Provider-Anzeige"],
  ["providers", "Streaming-Anbieter", "Websites hinzufügen, löschen und sortieren"],
  ["browser", "Cache", "Browserdaten beim Start oder Reload-All löschen"],
  ["privacy", "Adblock", "Popups, Redirects, Tracking und Filterlisten"],
  ["playback", "Wiedergabe", "Pausieren, Fokusverlust und Favoriten-Fortschritt"],
  ["updates", "Updates", "Version, GitHub Releases und Update-Fortschritt"],
  ["data", "Daten", "Cache leeren, Datenordner öffnen und zurücksetzen"]
].map(([tab, title, description]) => ({ tab, title, description }));

init();

async function init() {
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
  syncBrowserBounds();
  api.setShellOpen(true);
}

function bindEvents() {
  window.addEventListener("resize", syncBrowserBounds);
  new ResizeObserver(syncBrowserBounds).observe(browserFrame);

  document.querySelector("#startButton").addEventListener("click", showHome);
  document.querySelector("#searchButton").addEventListener("click", openSearchView);
  document.querySelector("#favoritesButton").addEventListener("click", showFavorites);
  document.querySelector("#settingsButton").addEventListener("click", openSettings);
  document.querySelector("#heroSettings").addEventListener("click", openSettings);
  document.querySelector("#heroWatch").addEventListener("click", openActiveProvider);
  document.querySelector("#emptyAddProvider").addEventListener("click", openSettings);
  document.querySelector("#showAllFavorites").addEventListener("click", showFavorites);
  document.querySelector("#favoritesOpenProvider").addEventListener("click", openActiveProvider);

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
    homeView.classList.remove("is-hidden");
    globalSearchView.classList.add("is-hidden");
    favoritesView.classList.add("is-hidden");
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

  omnibox.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      navigateFromOmnibox();
    }
  });

  document.querySelector("#closeSettingsButton").addEventListener("click", closeSettings);
  settingsModal.addEventListener("close", () => {
    api.setSettingsOpen(false).then(() => {
      recoverVisibleContent();
      syncBrowserBounds();
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
    providerCardMeta,
    showFavoriteMeta,
    showFavoriteMetaMirror,
    animationsEnabled
  ]) {
    control.addEventListener("change", saveSettings);
    if (control.type === "range") {
      control.addEventListener("input", () => {
        syncRangeLabels();
        saveSettings();
      });
    }
  }
  accentHex.addEventListener("input", () => {
    const color = normalizeColor(accentHex.value, "");
    if (color) accentColor.value = color;
  });
  accentColor.addEventListener("input", () => {
    accentHex.value = normalizeColor(accentColor.value);
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
    window.setTimeout(syncBrowserBounds, 0);
  });

  api.onToast((message) => {
    showToast(message);
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
  renderSettings();
  renderUpdateInfo();
  renderFavoriteToggle();
}

function renderProviders() {
  const enabled = providers.filter((provider) => provider.enabled !== false);
  providerRail.replaceChildren(...enabled.map((provider) => providerCard(provider, false)));
  if (!enabled.length) {
    providerRail.append(emptyText("Keine Anbieter. Settings öffnen."));
  }
}

function renderHome() {
  const enabled = providers.filter((provider) => provider.enabled !== false);
  const hasProviders = enabled.length > 0;
  const homeSettings = settings.home || DEFAULT_HOME_SETTINGS;
  const heroVisible = hasProviders && homeSettings.showHero !== false;
  noProvidersState.classList.toggle("is-hidden", hasProviders);
  homeHero.classList.toggle("is-hidden", !heroVisible);
  providersHomeRow.classList.toggle("is-hidden", !hasProviders || homeSettings.showProviders === false);

  heroTitle.textContent = "Alles an einem Ort";
  heroCopy.textContent = hasProviders
    ? "Wähle einen Anbieter oder nutze die globale Suche."
    : "Füge Websites in den Einstellungen hinzu und wechsle danach direkt hier zwischen ihnen.";
  homeProviders.replaceChildren(...enabled.map((provider) => providerCard(provider, true)));
  if (!enabled.length) {
    homeProviders.append(emptyText("Noch keine Websites gespeichert."));
  }

  const recentFavorites = favorites.slice(0, 8);
  favoritesHomeRow.classList.toggle("is-hidden", !hasProviders || recentFavorites.length === 0 || homeSettings.showFavorites === false);
  homeFavorites.replaceChildren(...recentFavorites.map((favorite) => favoriteCard(favorite, false)));
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
    homeView.classList.add("is-hidden");
    globalSearchView.classList.add("is-hidden");
    favoritesView.classList.add("is-hidden");
    const state = startUrl
      ? await api.openProviderUrl(provider.id, provider.startUrl)
      : await api.openProvider(provider.id);
    activeProviderId = state?.activeProviderId || provider.id;
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

async function showHome() {
  const state = await api.showHome();
  activeProviderId = state?.activeProviderId || null;
  currentUrl = state?.url || "";
  homeView.classList.remove("is-hidden");
  globalSearchView.classList.add("is-hidden");
  favoritesView.classList.add("is-hidden");
  renderProviders();
  renderFavoriteToggle();
  renderHome();
  window.setTimeout(syncBrowserBounds, 0);
}

function showFavorites() {
  api.setShellOpen(true);
  homeView.classList.add("is-hidden");
  globalSearchView.classList.add("is-hidden");
  favoritesView.classList.remove("is-hidden");
  renderFavorites();
  window.setTimeout(syncBrowserBounds, 0);
}

function showGlobalSearch(query) {
  const searchToken = ++activeSearchToken;
  api.setShellOpen(true);
  if (query.trim()) rememberSearch(query);
  homeView.classList.add("is-hidden");
  globalSearchView.classList.remove("is-hidden");
  favoritesView.classList.add("is-hidden");
  window.setTimeout(syncBrowserBounds, 0);
  searchTitle.textContent = query.trim() ? `"${query}" suchen` : "Suchen";
  document.querySelector("#searchCopy").textContent = query.trim()
    ? "Elflix nutzt nur die Direktsuche deiner Anbieter."
    : "Wähle einen Anbieter aus, um dessen Direktsuche zu öffnen.";
  renderSearchHistory();

  const matchingFavorites = favorites.filter((favorite) => {
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
    heading.textContent = "Favoriten";
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
      homeView.classList.add("is-hidden");
      globalSearchView.classList.add("is-hidden");
      const state = await api.openProviderSearch(provider.id, query);
      activeProviderId = state?.activeProviderId || provider.id;
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
          homeView.classList.add("is-hidden");
          globalSearchView.classList.add("is-hidden");
          favoritesView.classList.add("is-hidden");
          await api.setShellOpen(false);
          const state = await api.openProviderUrl(provider.providerId, result.url);
          activeProviderId = state?.activeProviderId || provider.providerId;
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
}

function renderFavorites() {
  favoritesGrid.replaceChildren(...favorites.map((favorite) => favoriteCard(favorite, true)));
  favoritesEmpty.classList.toggle("is-hidden", favorites.length > 0);
}

function favoriteCard(favorite, allowRemove) {
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
  `;
  card.addEventListener("click", async () => {
    homeView.classList.add("is-hidden");
    globalSearchView.classList.add("is-hidden");
    favoritesView.classList.add("is-hidden");
    const state = await api.openFavorite(favorite.id);
    activeProviderId = state?.activeProviderId || activeProviderId;
    renderProviders();
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      card.click();
    }
  });

  if (allowRemove) {
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
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Aus Favoriten entfernen";
    remove.addEventListener("click", async (event) => {
      event.stopPropagation();
      favorites = await api.removeFavorite(favorite.id);
      renderFavorites();
      renderHome();
      renderFavoriteToggle();
      showToast("Aus Favoriten entfernt");
    });
    actions.append(remove);
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
      && !/(?:logo|favicon|sprite|icon|avatar|flag|placeholder|blank|transparent|loading|spinner|play|button|rating|language|login|register)/i.test(url.href)
      && (/\.(?:jpg|jpeg|png|webp)(?:\?|#|$)/i.test(url.pathname)
        || /(?:cover|poster|thumbnail|thumb|anime|series?|stream|cache|image|img|bilder?|media|uploads?)/i.test(url.pathname));
  } catch {
    return false;
  }
}

async function toggleFavorite() {
  const result = await api.toggleCurrentFavorite();
  favorites = result.favorites || favorites;
  renderFavorites();
  renderHome();
  renderFavoriteToggle();
  showToast(result.added ? "Zu Favoriten hinzugefügt" : "Aus Favoriten entfernt");
}

function renderFavoriteToggle() {
  const button = document.querySelector("#favoriteButton");
  const active = Boolean(currentUrl && favorites.some((favorite) => normalizeFavoriteUrl(favorite.url) === normalizeFavoriteUrl(currentUrl)));
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
  homeView.classList.add("is-hidden");
  globalSearchView.classList.add("is-hidden");
  favoritesView.classList.add("is-hidden");
  await api.setShellOpen(false);
  await api.openProvider(active.id);
}

function openSearchView() {
  api.setShellOpen(true);
  const value = omnibox.value.trim();
  if (value && !looksLikeUrl(value)) {
    showGlobalSearch(value);
    return;
  }
  homeView.classList.add("is-hidden");
  favoritesView.classList.add("is-hidden");
  globalSearchView.classList.remove("is-hidden");
  searchTitle.textContent = "Suchen";
  renderSearchHistory();
  globalSearchGrid.replaceChildren(emptyText("Suchbegriff oben eingeben und Enter drücken."));
  omnibox.focus();
  omnibox.select();
}

async function navigateFromOmnibox() {
  const value = omnibox.value.trim();
  if (!value) {
    showHome();
    return;
  }

  if (!looksLikeUrl(value)) {
    showGlobalSearch(value);
    return;
  }

  homeView.classList.add("is-hidden");
  globalSearchView.classList.add("is-hidden");
  favoritesView.classList.add("is-hidden");
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

async function openSettings() {
  renderSettings();
  if (!settingsModal.open) {
    await api.setSettingsOpen(true);
    settingsModal.showModal();
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
  themeMode.value = appearance.themeMode || "dark";
  compactHeader.checked = Boolean(appearance.compactHeader);
  accentPreset.value = appearance.accentPreset || "blue";
  accentColor.value = normalizeColor(appearance.accentColor || "#147eff");
  accentHex.value = normalizeColor(appearance.accentColor || "#147eff");
  accentStrength.value = String(appearance.accentStrength ?? 70);
  setRangeChoice("uiDensity", appearance.uiDensity || "comfortable");
  setRangeChoice("cardSize", appearance.cardSize || "medium");
  setRangeChoice("favoriteSize", appearance.favoriteSize || "medium");
  setRangeChoice("favoriteSizeMirror", appearance.favoriteSize || "medium");
  favoriteLayout.value = appearance.favoriteLayout || "grid";
  favoriteLayoutMirror.value = favoriteLayout.value;
  setRangeChoice("favoriteTextSize", appearance.favoriteTextSize || "medium");
  setRangeChoice("favoriteTextSizeMirror", appearance.favoriteTextSize || "medium");
  favoriteArtwork.value = appearance.favoriteArtwork || "balanced";
  favoriteArtworkMirror.value = favoriteArtwork.value;
  cornerStyle.value = appearance.cornerStyle || "soft";
  backgroundStyle.value = appearance.backgroundStyle || "cinema";
  backgroundColor.value = normalizeColor(appearance.backgroundColor || "#070a10", "#070a10");
  fontScale.value = String(appearance.fontScale ?? 100);
  animationMode.value = appearance.animationMode || (appearance.animations === false ? "off" : "full");
  cardStyle.value = appearance.cardStyle || "standard";
  shadowStyle.value = appearance.shadowStyle || "standard";
  showProviderStrip.checked = appearance.showProviderStrip !== false;
  showHeroHome.checked = home.showHero !== false;
  showHomeProviders.checked = home.showProviders !== false;
  showHomeFavorites.checked = home.showFavorites !== false;
  providerCardMeta.value = home.providerCardMeta || "logoName";
  showFavoriteMeta.checked = appearance.showFavoriteMeta !== false;
  showFavoriteMetaMirror.checked = showFavoriteMeta.checked;
  animationsEnabled.checked = appearance.animations !== false && animationMode.value !== "off";
  filterStatus.textContent = settings.adblock?.lastUpdated ? `Letztes Update: ${settings.adblock.lastUpdated}` : "";
  filterListNames.replaceChildren(...filterLists.map((list) => {
    const row = document.createElement("div");
    row.textContent = `${list.name} · ${list.url}`;
    return row;
  }));
  syncRangeLabels();
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
    providerCardMeta: providerCardMeta.value
  };
  settings.appearance = {
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
  renderHome();
  renderProviders();
  recoverVisibleContent();
  syncBrowserBounds();
}

function recoverVisibleContent() {
  const hasVisibleAppView = !homeView.classList.contains("is-hidden")
    || !globalSearchView.classList.contains("is-hidden")
    || !favoritesView.classList.contains("is-hidden");
  if (!hasVisibleAppView && !currentUrl) {
    homeView.classList.remove("is-hidden");
    globalSearchView.classList.add("is-hidden");
    favoritesView.classList.add("is-hidden");
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
  updateStatusLabel.textContent = "Suche nach Elflix-Updates...";
  updateProgressBar.style.width = "0%";
  updateProgressValue.textContent = "0%";
  const state = await api.checkForUpdates().catch((error) => ({
    status: "error",
    message: error?.message || "Update konnte nicht geprüft werden.",
    progress: 0
  }));
  updateState = state || updateState;
  renderUpdateInfo();
  updateCheckButton.disabled = false;
}

function renderUpdateInfo() {
  if (!appVersionLabel) return;
  const version = appInfo.version || updateState.version || "";
  appVersionLabel.textContent = version ? `Elflix ${version}` : "Elflix";
  updateFeedLabel.textContent = updateState.feed || "GitHub Releases: RoveHD/elfix";
  const message = updateState.message || "Noch nicht geprüft.";
  const extra = updateState.availableVersion ? ` (${updateState.availableVersion})` : "";
  updateStatusLabel.textContent = `${message}${extra}`;
  const progress = Math.max(0, Math.min(100, Math.round(Number(updateState.progress) || 0)));
  updateProgressBar.style.width = `${progress}%`;
  updateProgressValue.textContent = `${progress}%`;
  updateCheckButton.disabled = updateState.status === "checking" || updateState.status === "downloading";
  updateReleaseLink.href = appInfo.repository ? `${appInfo.repository}/releases` : "https://github.com/RoveHD/elfix/releases";
}

async function resetData() {
  if (!confirm("Wirklich alles zurücksetzen? Provider und Favoriten werden gelöscht, Logins bleiben soweit möglich erhalten.")) return;
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
  if (!confirm("Alle Einstellungen auf Standard zurücksetzen? Provider und Favoriten bleiben erhalten.")) return;
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
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.tab === name));
  document.querySelectorAll(".settings-page").forEach((page) => page.classList.toggle("is-active", page.dataset.page === name));
}

function renderSettingsSearch() {
  const query = normalizeSettingsQuery(settingsSearch.value);
  settingsSearchResults.replaceChildren();
  settingsSearchResults.classList.toggle("is-empty", !query);
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
    button.addEventListener("click", () => activateTab(item.tab));
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
  }
  renderSettings();
  await saveSettings();
}

function syncMirroredFavoriteControls() {
  const active = document.activeElement;
  if (active === favoriteSizeMirror) setRangeChoice("favoriteSize", getRangeChoice("favoriteSizeMirror"));
  else setRangeChoice("favoriteSizeMirror", getRangeChoice("favoriteSize"));

  if (active === favoriteTextSizeMirror) setRangeChoice("favoriteTextSize", getRangeChoice("favoriteTextSizeMirror"));
  else setRangeChoice("favoriteTextSizeMirror", getRangeChoice("favoriteTextSize"));

  if (active === favoriteLayoutMirror) favoriteLayout.value = favoriteLayoutMirror.value;
  else favoriteLayoutMirror.value = favoriteLayout.value;

  if (active === favoriteArtworkMirror) favoriteArtwork.value = favoriteArtworkMirror.value;
  else favoriteArtworkMirror.value = favoriteArtwork.value;

  if (active === showFavoriteMetaMirror) showFavoriteMeta.checked = showFavoriteMetaMirror.checked;
  else showFavoriteMetaMirror.checked = showFavoriteMeta.checked;
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
  if (!range) return;
  const index = Math.max(0, range.values.indexOf(value));
  range.node.value = String(index);
}

function getRangeChoice(key) {
  const range = rangeSettings[key];
  if (!range) return "";
  const index = Math.max(0, Math.min(range.values.length - 1, Number(range.node.value) || 0));
  return range.values[index];
}

function syncRangeLabels() {
  if (accentStrengthValue) accentStrengthValue.textContent = `${Math.round(Number(accentStrength.value) || 70)}%`;
  if (fontScaleValue) fontScaleValue.textContent = `${Math.round(Number(fontScale.value) || 100)}%`;
  for (const range of Object.values(rangeSettings)) {
    const index = Math.max(0, Math.min(range.labels.length - 1, Number(range.node.value) || 0));
    range.valueNode.textContent = range.labels[index];
  }
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
  document.documentElement.style.setProperty("--custom-bg", normalizeColor(appearance.backgroundColor || "#070a10", "#070a10"));
  document.documentElement.style.setProperty("--font-scale", String(Math.max(0.8, Math.min(1.4, Number(appearance.fontScale || 100) / 100))));

  shell.classList.toggle("is-compact-header", Boolean(appearance.compactHeader));
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
  setShellMode(shell, "bg", appearance.backgroundStyle || "cinema", ["plain", "cinema", "poster", "black", "gray", "glass"]);
  setShellMode(shell, "theme", appearance.themeMode || "dark", ["system", "dark", "light", "oled"]);
  setShellMode(shell, "cardstyle", appearance.cardStyle || "standard", ["standard", "flat", "glass", "outline", "minimal"]);
  setShellMode(shell, "shadow", appearance.shadowStyle || "standard", ["none", "light", "standard", "strong"]);
  setShellMode(shell, "providermeta", home.providerCardMeta || "logoName", ["logoName", "logo", "name"]);
  shell.classList.toggle("hide-favorite-meta", appearance.showFavoriteMeta === false);
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
  const progress = favoriteEpisodeLabel(favorite?.url);
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
    .replace(/\s*[|]\s*.*$/g, "")
    .replace(/\s+[–-]\s*(?:Filmo|S\.?to|AniWorld.*|Elflix).*$/i, "")
    .replace(/\b(?:jetzt\s+)?kostenlos\s+streamen\b/gi, "")
    .replace(/\bgratis\s+legal\s+online\s+ansehen\b/gi, "")
    .replace(/\bonline\s+ansehen\b/gi, "")
    .replace(/\bstream\s+starten\b/gi, "")
    .replace(/\banschauen\b/gi, "")
    .replace(/\b(?:AniWorld\.to\s*\/\s*Animes?|AniWorld|Filmo|S\.to|Elflix)\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s|–-]+|[\s|–-]+$/g, "")
    .trim();

  if (!value || isFavoriteTitleNoise(value) || value.length > 58) {
    return slugTitle || niceFavoriteTitle(value);
  }
  return niceFavoriteTitle(value);
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
  if (trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) {
    return trimmed.toLowerCase().replace(/\b[a-z0-9]/g, (char) => char.toUpperCase());
  }
  return trimmed.replace(/\b[a-z]/g, (char) => char.toUpperCase());
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
