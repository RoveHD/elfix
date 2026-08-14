const { app, BrowserWindow, WebContentsView, ipcMain, session, shell, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("fs");
const path = require("path");
const { extractDiscoverItems, extractPosterFallbacks } = require("./discover");
const providerModel = require("../shared/provider-model");

const LEGACY_DATA_DIR = path.join(app.getPath("appData"), "GlobalSearchHub");
const DATA_DIR = path.join(app.getPath("appData"), "ELFIX");
const PROVIDER_FILE = path.join(DATA_DIR, "providers.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const FILTER_CACHE_FILE = path.join(DATA_DIR, "filter-cache.json");
const FAVORITES_FILE = path.join(DATA_DIR, "favorites.json");
const SESSION_PARTITION = "persist:streaming-browser";
const MAX_BLOCK_LOG = 400;
const MAX_MEDIA_LOG = 300;
const SETTINGS_SCHEMA_VERSION = 4;
const CACHE_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const MIN_WATCH_TIME_SECONDS = 2.5 * 60;
const COMPLETED_PROGRESS_PERCENT = 90;
const ADGUARD_FILTER_LISTS = [
  {
    name: "AdGuard Base Filter",
    url: "https://filters.adtidy.org/extension/chromium/filters/2.txt"
  },
  {
    name: "AdGuard Tracking Protection",
    url: "https://filters.adtidy.org/extension/chromium/filters/3.txt"
  },
  {
    name: "AdGuard Social Media",
    url: "https://filters.adtidy.org/extension/chromium/filters/4.txt"
  },
  {
    name: "AdGuard Annoyances",
    url: "https://filters.adtidy.org/extension/chromium/filters/14.txt"
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
const DISCOVER_CACHE_MS = 30 * 60 * 1000;
const autoplayConsoleLogState = new Map();
const AUTOPLAY_POLL_MS = 700;
const AUTOSTART_REVEAL_TIMEOUT_MS = 22000;
const AUTOSTART_EXTRA_WAIT_MS = 8000;
const CURTAIN_DIR = path.join(DATA_DIR, "curtain");
const VIEW_BACKGROUND_COLOR = "#070a10";
let pendingAutostart = null;
let curtainView = null;
const overlayReasons = new Set();
let adblock;
let cacheCleanupTimer;
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

app.whenReady().then(async () => {
  adblock = new FilterEngine();
  ensureDataDir();
  providers = loadProviders();
  favorites = loadFavorites();
  settings = loadSettings();
  loadFilterCache();

  browserSession = session.fromPartition(SESSION_PARTITION, { cache: true });
  configureBrowserSession();
  if (settings.browser.cacheMode !== "normal") {
    await clearBrowserDataPreservingLogin();
  }
  syncAutomaticCacheCleanup();
  installAdblock();
  createMainWindow();
  setupAutoUpdater();
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
    if (input.key === "Escape" && isContentFullscreen) {
      event.preventDefault();
      leaveContentFullscreen();
    }
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
      autoUpdater.quitAndInstall(false, true);
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
      "localstorage",
      "shadercache",
      "websql",
      "serviceworkers",
      "cachestorage"
    ]
  }).catch(() => {});
}

function startAutomaticCacheCleanup() {
  if (cacheCleanupTimer) clearInterval(cacheCleanupTimer);
  cacheCleanupTimer = setInterval(() => {
    clearBrowserDataPreservingLogin().catch(() => {});
  }, CACHE_CLEANUP_INTERVAL_MS);
  if (typeof cacheCleanupTimer.unref === "function") cacheCleanupTimer.unref();
}

function stopAutomaticCacheCleanup() {
  if (cacheCleanupTimer) clearInterval(cacheCleanupTimer);
  cacheCleanupTimer = null;
}

function syncAutomaticCacheCleanup() {
  if (settings.browser?.cacheMode === "aggressive") startAutomaticCacheCleanup();
  else stopAutomaticCacheCleanup();
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

    if (details.resourceType !== "popup" && isLikelyVideoPlayerUrl(details.url)) {
      callback({});
      return;
    }

    const decision = adblock.shouldBlock(details, settings, provider);
    if (decision.block) {
      logBlocked(details, provider, decision.rule);
      callback({ cancel: true });
      return;
    }

    callback({});
  });
}

function shouldBlockTarget(url, provider, resourceType = "mainFrame") {
  if (!provider || !settings.adblock.enabled || provider.adblockEnabled === false || !providerModel.isHttpUrl(url)) {
    return { block: false };
  }
  if (isChallengeOrVerificationUrl(url, provider)) {
    return { block: false };
  }

  return adblock.shouldBlock(
    {
      url,
      resourceType,
      webContentsId: getProviderView(provider).webContents.id
    },
    settings,
    provider
  );
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
    repository: "https://github.com/RoveHD/elfix"
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
      completed: false,
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

ipcMain.handle("favorites:open", async (_event, favoriteId, options = {}) => {
  const favorite = favorites.find((item) => item.id === favoriteId);
  if (!favorite) return null;

  const provider = enabledProviders().find((item) => item.id === favorite.providerId)
    || enabledProviders().find((item) => item.name === favorite.providerName)
    || enabledProviders()[0];
  if (!provider) return null;

  activeFavoriteId = favorite.id;
  moveFavoriteToFront(favorite);
  recordMediaActivity(provider, favorite.url, {}, { existing: favorite, label: "Geöffnet" });
  await repairFavoriteThumbnailIfNeeded(favorite, provider).catch(() => false);
  if (options?.autoplay) await beginAutostart(provider.id, cleanTitle(favorite.title));
  await navigateProvider(provider, favorite.url);
  if (options?.autoplay) scheduleProviderAutoplay(provider, activeView, { fullscreen: Boolean(options?.fullscreen) });
  return activeState();
});

ipcMain.handle("favorites:repair-thumbnail", async (_event, favoriteId, force = false) => {
  const favorite = favorites.find((item) => item.id === favoriteId);
  if (!favorite) return { favorites, favorite: null, repaired: false };

  const provider = enabledProviders().find((item) => item.id === favorite.providerId)
    || enabledProviders().find((item) => item.name === favorite.providerName);
  const repaired = await repairFavoriteThumbnailIfNeeded(favorite, provider, Boolean(force)).catch(() => false);
  return { favorites, favorite, repaired };
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

ipcMain.handle("settings:save", (_event, nextSettings) => {
  settings = normalizeSettings(nextSettings);
  saveSettings();
  syncAutomaticCacheCleanup();
  return publicSettings(settings);
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
    syncAutomaticCacheCleanup();
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

  view.webContents.on("will-navigate", (event, url) => {
    syncViewMediaProgress(provider, view, "leave");
    if (shouldCancelNavigation(url, provider)) {
      event.preventDefault();
    }
  });
  view.webContents.on("will-redirect", (event, url) => {
    syncViewMediaProgress(provider, view, "leave");
    if (shouldCancelNavigation(url, provider)) {
      event.preventDefault();
    }
  });
  view.webContents.on("enter-html-full-screen", () => markContentFullscreen(true));
  view.webContents.on("leave-html-full-screen", () => markContentFullscreen(false));
  view.webContents.on("before-input-event", (event, input) => {
    if (input.key === "Escape" && isContentFullscreen) {
      event.preventDefault();
      leaveContentFullscreen();
    }
  });
  view.webContents.on("did-navigate", (_event, url) => {
    rememberProviderUrl(provider.id, url);
    resumePendingProviderAutoplay(provider, view);
  });
  view.webContents.on("did-navigate-in-page", (_event, url) => {
    rememberProviderUrl(provider.id, url);
    resumePendingProviderAutoplay(provider, view);
  });
  view.webContents.on("page-title-updated", () => {
    updateActiveFavoriteTitle(provider.id, view);
    sendActiveState();
  });
  view.webContents.on("did-finish-load", () => {
    installStoPlayerFix(provider, view);
    installAniWorldImageFix(provider, view);
    syncViewMediaProgress(provider, view, "load");
    updateActiveFavoriteTitle(provider.id, view);
    scheduleFavoriteMetadataRefresh(provider.id, view);
    resumePendingProviderAutoplay(provider, view);
    sendActiveState();
  });
  view.webContents.on("dom-ready", () => {
    installStoPlayerFix(provider, view);
    installAniWorldImageFix(provider, view);
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

  const progressScript = `(() => {
    const finite = (value) => Number.isFinite(value) ? value : 0;
    const abs = (value) => {
      try { return value ? new URL(value, location.href).href : ""; } catch (_) { return ""; }
    };
    const nextEpisodeUrl = () => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const currentEpisodeMatch = location.pathname.match(/\\/(?:episode|folge)-(\\d+)(?:\\/?|$)/i);
      const currentEpisode = currentEpisodeMatch ? Number(currentEpisodeMatch[1]) : 0;
      const nextTextPattern = /\\b(next|weiter|naechste|nächste)\\b|[›»→]/i;
      const semantic = anchors.find((anchor) => {
        const label = [
          anchor.rel,
          anchor.textContent,
          anchor.title,
          anchor.getAttribute("aria-label"),
          anchor.className
        ].join(" ");
        const href = abs(anchor.getAttribute("href"));
        return href && nextTextPattern.test(label) && /\\/(?:episode|folge)-\\d+(?:[/?#]|$)/i.test(href);
      });
      if (semantic) return abs(semantic.getAttribute("href"));
      if (!currentEpisode) return "";
      const directPattern = new RegExp("\\\\/(?:episode|folge)-" + (currentEpisode + 1) + "(?:[/?#]|$)", "i");
      const direct = anchors.find((anchor) => directPattern.test(abs(anchor.getAttribute("href"))));
      return direct ? abs(direct.getAttribute("href")) : "";
    };
    const visibleArea = (node) => {
      try {
        const rect = node.getBoundingClientRect();
        return Math.max(0, rect.width) * Math.max(0, rect.height);
      } catch (_) {
        return 0;
      }
    };
    const now = Date.now();
    window.__elfixMediaWatchTracker = window.__elfixMediaWatchTracker || new WeakMap();
    const medias = Array.from(document.querySelectorAll("video, audio"))
      .map((media) => {
        const currentTime = finite(media.currentTime);
        const duration = finite(media.duration);
        const sourceKey = [location.href, media.currentSrc || media.src || media.getAttribute("src") || ""].join("|");
        const paused = Boolean(media.paused);
        const ended = Boolean(media.ended);
        const stored = window.__elfixMediaWatchTracker.get(media);
        const previous = stored && stored.sourceKey === sourceKey ? stored : {
          currentTime,
          sampledAt: now,
          playedSeconds: 0,
          sourceKey
        };
        const timeDelta = Math.max(0, (now - previous.sampledAt) / 1000);
        const mediaDelta = currentTime - previous.currentTime;
        const naturalPlaybackDelta = mediaDelta > 0 && mediaDelta <= timeDelta + 2
          ? Math.min(mediaDelta, timeDelta + 2)
          : 0;
        const playedSeconds = Math.min(duration || Number.MAX_SAFE_INTEGER, previous.playedSeconds + naturalPlaybackDelta);
        window.__elfixMediaWatchTracker.set(media, {
          currentTime,
          sampledAt: now,
          playedSeconds,
          sourceKey
        });
        return {
          currentTime,
          duration,
          playedSeconds,
          paused,
          ended,
          readyState: Number(media.readyState || 0),
          area: visibleArea(media),
          frameUrl: location.href,
          nextUrl: nextEpisodeUrl()
        };
      })
      .filter((item) => item.duration > 0 && item.currentTime >= 0 && item.currentTime <= item.duration + 3 && item.readyState > 0)
      .sort((left, right) => {
        if (left.ended !== right.ended) return left.ended ? -1 : 1;
        if (left.paused !== right.paused) return left.paused ? 1 : -1;
        return right.area - left.area;
      });
    return medias[0] || null;
  })()`;
  const progress = await readBestMediaProgress(view, progressScript);

  if (!progress || !isValidMediaProgress(progress)) return;
  const pageMeta = await readPageMetadata(view).catch(() => ({}));
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
    finalEpisode: pageMeta.finalEpisode
  }, {
    label: progress.ended ? "Abgeschlossen" : undefined,
    updateFavoriteUrl: false
  });
  if (!entry) return;
  if (reason !== "poll" || entry.completed) sendActiveState();
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

  if (!frames.length) {
    const sample = await view.webContents.executeJavaScript(script, true).catch(() => null);
    return sample ? [sample] : [];
  }

  // userGesture muss mit: play() ohne Stummschaltung und requestFullscreen() verlangen
  // eine "transient user activation", die ein Script ohne dieses Flag nicht mitbringt.
  const samples = await Promise.all(frames.map((frame) => (
    typeof frame.executeJavaScript === "function"
      ? frame.executeJavaScript(script, true).catch(() => null)
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
async function beginAutostart(providerId, title) {
  // Bewusst ohne finishAutostart(): ein zweiter Klick waehrend des Startens soll
  // weder umschalten noch den Vorhang kurz aufziehen.
  if (pendingAutostart) clearTimeout(pendingAutostart.timer);
  pendingAutostart = {
    providerId,
    startedAt: Date.now(),
    timer: setTimeout(() => handleAutostartTimeout(providerId), AUTOSTART_REVEAL_TIMEOUT_MS)
  };
  await showAutostartCurtain(title).catch(() => {});
  applyBrowserBounds();
}

async function showAutostartCurtain(title) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  removeAutostartCurtain();

  let snapshot = "";
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
  if (request.busy) return;
  request.busy = true;
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

function shouldCancelNavigation(url, provider) {
  if (shouldBlockProviderNavigation(url, provider)) {
    logBlockedUrl(url, provider, "site-lock", "navigation");
    return true;
  }
  if (!settings.adblock.blockRedirects) return false;
  const decision = shouldBlockTarget(url, provider, "mainFrame");
  if (!decision.block) return false;
  logBlockedUrl(url, provider, `redirect:${decision.rule}`, "redirect");
  return true;
}

function isAllowedNewWindowTarget(url, provider) {
  if (shouldBlockProviderNavigation(url, provider)) return false;
  if (!settings.adblock.blockPopups) return true;
  if (isChallengeOrVerificationUrl(url, provider)) return true;
  if (isProviderFirstParty(providerModel.hostFromUrl(url), provider)) return true;
  if (isKnownAuthHost(url)) return true;
  if (isKnownVideoHosterUrl(url)) return true;
  if (isLikelyVideoPlayerUrl(url)) {
    const decision = shouldBlockTarget(url, provider, "popup");
    return !decision.block;
  }

  const decision = shouldBlockTarget(url, provider, "popup");
  return !decision.block && false;
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

function isLikelyVideoPlayerUrl(url) {
  const host = providerModel.hostFromUrl(url).toLowerCase();
  const pathName = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  return /(voe|v[-.]?o[-.]?e|vid|video|player|stream|filemoon|filelions|dood|mixdrop|streamtape|vidmoly|vidoza|upstream|supervideo|streamsb|streamwish|lulustream|savefiles|mp4upload|vidsrc|embed|hoster)/i.test(host)
    || /(embed|player|watch|stream|hoster|video)/i.test(pathName)
    || /\.(m3u8|mp4|webm)(\?|$)/i.test(pathName);
}

function isKnownVideoHosterUrl(url) {
  const host = providerModel.hostFromUrl(url).toLowerCase();
  return /(voe|v[-.]?o[-.]?e|filemoon|filelions|dood|mixdrop|streamtape|vidmoly|vidoza|upstream|supervideo|streamsb|streamwish|lulustream|savefiles|mp4upload|vidsrc|vidguard|streamcloud|cloudflarestream)/i.test(host);
}

function isChallengeOrVerificationUrl(url, provider) {
  if (!providerModel.isHttpUrl(url)) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const host = stripWww(parsed.hostname);
  const href = parsed.href.toLowerCase();
  const pathName = parsed.pathname.toLowerCase();

  if (host === "challenges.cloudflare.com" || host.endsWith(".challenges.cloudflare.com")) return true;
  if ((host === "cloudflare.com" || host.endsWith(".cloudflare.com")) && /turnstile|challenge|cf_chl|cdn-cgi/.test(href)) return true;
  if (host === "static.cloudflareinsights.com" && /turnstile|challenge|cf_chl|cdn-cgi|beacon/.test(href)) return true;
  if (host === "hcaptcha.com" || host.endsWith(".hcaptcha.com")) return true;
  if ((host === "recaptcha.net" || host.endsWith(".recaptcha.net") || host === "gstatic.com" || host.endsWith(".gstatic.com") || host === "google.com" || host.endsWith(".google.com"))
    && /recaptcha|captcha/.test(href)) return true;

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

function updateActiveFavoriteProgress(providerId, url) {
  if (!activeFavoriteId) return;
  const favorite = favorites.find((item) => item.id === activeFavoriteId);
  const provider = providers.find((item) => item.id === providerId);
  if (!favorite || !provider || favorite.providerId !== providerId || !isFavoriteProgressUrl(url, provider)) return;
  const normalized = normalizeFavoriteUrl(url);
  if (favorite.normalizedUrl === normalized) return;
  const previousEpisode = episodeIdentity(favorite.url);
  const nextEpisode = episodeIdentity(url);
  if (!previousEpisode || !nextEpisode) return;

  if (settings.playback.favoriteProgressMode !== "sequential" || !isSequentialFavoriteProgress(previousEpisode, nextEpisode)) {
    activeFavoriteId = null;
    sendActiveState();
    return;
  }

  favorite.url = url;
  favorite.normalizedUrl = normalized;
  favorite.providerName = provider.name;
  favorite.logo = provider.logo || favorite.logo || "";
  favorite.watched = true;
  favorite.completed = false;
  favorite.progress = 0;
  favorite.currentTime = 0;
  favorite.position = 0;
  favorite.duration = 0;
  favorite.episodeCompleted = false;
  favorite.hideFromContinueWatching = false;
  favorite.lastWatchedAt = new Date().toISOString();
  favorite.season = nextEpisode.season || favorite.season || 0;
  favorite.episode = nextEpisode.episode || favorite.episode || 0;
  moveFavoriteToFront(favorite);
  saveFavorites();
  sendToast(`Favorit auf ${favoriteProgressTargetLabel(url)} geändert`);
}

function recordMediaActivity(provider, url, meta = {}, options = {}) {
  if (!provider || !providerModel.isHttpUrl(url) || !isTrackableMediaUrl(url, provider)) return null;

  const normalized = normalizeFavoriteUrl(url);
  const now = new Date().toISOString();
  const requestedType = mediaTypeForProgressUrl(url, meta.type);
  const existing = options.existing || favorites.find((favorite) => favoriteMatchesCurrentProviderTitle(favorite, provider, url, normalized, requestedType));
  const identity = episodeIdentity(url);
  const hasMediaProgress = isValidMediaProgress({
    currentTime: meta.currentTime || meta.position,
    duration: meta.duration
  });
  if (!existing && !hasMediaProgress) {
    logMediaDiagnostic(provider, url, "ignoriert", "keine Videodaten erkannt", meta);
    return null;
  }

  const watchedSeconds = sanitizePositiveNumber(meta.watchedSeconds);
  const progressPercent = hasMediaProgress
    ? mediaProgressPercent(meta.currentTime || meta.position, meta.duration)
    : sanitizeProgress(meta.progress);
  const mediaEnded = Boolean(meta.completed) || isCompletedProgress(progressPercent);
  const startsAtFirstEpisode = isFirstEpisodeIdentity(identity);
  const isFilmProgress = requestedType === "film";
  const qualifiesForPrimaryProgress = mediaEnded || isFilmProgress || startsAtFirstEpisode || watchedSeconds >= MIN_WATCH_TIME_SECONDS;

  const shouldPromotePrimary = shouldPromoteMediaProgress(existing, url, {
    hasMediaProgress,
    mediaEnded,
    watchedSeconds,
    isFilmProgress,
    startsAtFirstEpisode,
    finalSeason: meta.finalSeason,
    finalEpisode: meta.finalEpisode
  });
  if (!existing && hasMediaProgress && !qualifiesForPrimaryProgress) {
    logMediaDiagnostic(provider, url, "blockiert", mediaPromotionBlockReason(existing, url, {
      mediaEnded,
      watchedSeconds,
      isFilmProgress,
      startsAtFirstEpisode,
      finalSeason: meta.finalSeason,
      finalEpisode: meta.finalEpisode
    }), {
      ...meta,
      progress: progressPercent,
      favorite: false,
      continueVisible: false
    });
    return null;
  }
  if (existing && hasMediaProgress && !shouldPromotePrimary) {
    logMediaDiagnostic(provider, url, "blockiert", mediaPromotionBlockReason(existing, url, {
      mediaEnded,
      watchedSeconds,
      isFilmProgress,
      startsAtFirstEpisode
    }), {
      ...meta,
      progress: progressPercent,
      currentTitle: existing.title,
      currentUrl: existing.url,
      favorite: existing.favorite,
      continueVisible: hasContinueProgressRecord(existing)
    });
    appendMediaActivity(existing, url, options.label || mediaActivityLabel(url, existing));
    existing.updatedAt = now;
    saveFavorites();
    return existing;
  }

  const preserveActiveFavoriteTarget = Boolean(existing?.favorite && !options.updateFavoriteUrl && !hasMediaProgress);
  const preserveProgressTarget = preserveActiveFavoriteTarget || Boolean(existing && !hasMediaProgress);
  const entry = existing || {
    id: crypto.randomUUID(),
    providerId: provider.id,
    providerName: provider.name,
    title: cleanTitle(meta.title || titleFromPath(url) || provider.name),
    url,
    normalizedUrl: normalized,
    favicon: meta.favicon || "",
    thumbnail: meta.thumbnail || "",
    logo: provider.logo || "",
    favorite: false,
    watched: false,
    completed: false,
    episodeCompleted: false,
    continuePending: false,
    completedEpisodes: [],
    hideFromContinueWatching: false,
    progress: 0,
    duration: 0,
    position: 0,
    currentTime: 0,
    type: inferMediaType(url),
    season: 0,
    episode: 0,
    createdAt: now,
    openedAt: "",
    lastWatchedAt: "",
    activity: []
  };

  entry.providerId = provider.id;
  entry.providerName = provider.name;
  if (!preserveProgressTarget) {
    entry.url = url;
    entry.normalizedUrl = normalized;
  }
  entry.logo = provider.logo || entry.logo || "";
  entry.type = requestedType || entry.type || inferMediaType(url);
  if (meta.title && (!existing || entry.type === "film")) {
    entry.title = cleanTitle(meta.title);
  }
  entry.watched = true;
  applyFavoriteSeriesBounds(entry, meta, url);
  const wholeItemCompleted = isWholeMediaCompleted(entry, url, mediaEnded);
  const shouldAdvanceEpisode = Boolean(mediaEnded && !wholeItemCompleted && identity && (entry.type === "serie" || inferMediaType(url) === "serie"));
  const nextContinueUrl = shouldAdvanceEpisode ? nextEpisodeContinueUrl(url, meta.nextUrl, entry) : "";
  let advancedToNextEpisode = false;
  entry.completed = Boolean(entry.completed || wholeItemCompleted);
  if (hasMediaProgress) {
    entry.currentTime = sanitizePositiveNumber(meta.currentTime || meta.position);
    entry.position = entry.currentTime;
    entry.duration = sanitizePositiveNumber(meta.duration);
    entry.progress = progressPercent;
    if (shouldAdvanceEpisode) {
      appendCompletedEpisode(entry, identity, url, now);
      if (nextContinueUrl) {
        const nextIdentity = episodeIdentity(nextContinueUrl);
        entry.url = nextContinueUrl;
        entry.normalizedUrl = normalizeFavoriteUrl(nextContinueUrl);
        entry.season = nextIdentity?.season || identity.season || entry.season || 0;
        entry.episode = nextIdentity?.episode || identity.episode + 1 || entry.episode || 0;
        entry.title = cleanBaseMediaTitle(entry.title, nextContinueUrl);
        entry.currentTime = 0;
        entry.position = 0;
        entry.duration = 0;
        entry.progress = 0;
        entry.episodeCompleted = false;
        entry.continuePending = true;
        entry.hideFromContinueWatching = false;
        advancedToNextEpisode = true;
      } else {
        entry.episodeCompleted = true;
        entry.continuePending = false;
      }
    } else {
      entry.episodeCompleted = Boolean(mediaEnded && !entry.completed);
      entry.continuePending = false;
    }
    if (!entry.completed && !entry.episodeCompleted) {
      entry.hideFromContinueWatching = false;
    }
  } else if (entry.completed) {
    entry.progress = 100;
    entry.continuePending = false;
  } else {
    entry.progress = sanitizeProgress(entry.progress);
  }
  if (entry.completed) {
    entry.favorite = false;
    entry.hideFromContinueWatching = true;
    entry.continuePending = false;
    entry.completedAt = entry.completedAt || now;
  }
  if (hasMediaProgress || !existing) {
    entry.lastWatchedAt = now;
  } else {
    entry.openedAt = now;
  }
  if (identity && !preserveProgressTarget && !advancedToNextEpisode) {
    entry.season = identity.season || entry.season || 0;
    entry.episode = identity.episode || entry.episode || 0;
  }
  appendMediaActivity(entry, url, options.label || mediaActivityLabel(url, entry));

  if (!existing) {
    favorites.unshift(entry);
    favorites = favorites.slice(0, 600);
  } else {
    moveFavoriteToFront(entry);
  }
  saveFavorites();
  logMediaDiagnostic(provider, url, entry.completed ? "abgeschlossen" : "aktualisiert", mediaDiagnosticDecisionText(entry, url, {
    hasMediaProgress,
    watchedSeconds,
    mediaEnded,
    progressPercent
  }), {
    ...meta,
    progress: progressPercent,
    favorite: entry.favorite,
    continueVisible: hasContinueProgressRecord(entry)
  });
  return entry;
}

function hasContinueProgressRecord(entry) {
  if (!entry || entry.completed || entry.episodeCompleted || entry.hideFromContinueWatching) return false;
  if (entry.continuePending) return true;
  const current = sanitizePositiveNumber(entry.currentTime || entry.position);
  const duration = sanitizePositiveNumber(entry.duration);
  if (duration > 0 && current > 0 && current <= duration + 3) {
    return mediaProgressPercent(current, duration) < COMPLETED_PROGRESS_PERCENT;
  }
  const progress = sanitizeProgress(entry.progress);
  return Boolean(entry.lastWatchedAt || entry.openedAt) && progress > 0 && progress < COMPLETED_PROGRESS_PERCENT;
}

function isWholeMediaCompleted(entry, url, mediaEnded) {
  if (!mediaEnded) return false;
  const type = entry?.type || inferMediaType(url);
  if (type === "film") return true;
  if (type !== "serie") return !episodeIdentity(url);

  const identity = episodeIdentity(url);
  const finalSeason = sanitizePositiveNumber(entry?.finalSeason);
  const finalEpisode = sanitizePositiveNumber(entry?.finalEpisode);
  if (!identity || !finalSeason || !finalEpisode) return false;
  return identity.season === finalSeason && identity.episode === finalEpisode;
}

function shouldPromoteMediaProgress(existing, url, progressState) {
  if (!progressState?.hasMediaProgress) return true;
  if (progressState.isFilmProgress) return true;
  if (progressState.startsAtFirstEpisode) return true;
  if (!existing) return progressState.mediaEnded || progressState.watchedSeconds >= MIN_WATCH_TIME_SECONDS;

  const nextIdentity = episodeIdentity(url);
  const currentIdentity = episodeIdentity(existing.url);
  if (!nextIdentity || !currentIdentity || nextIdentity.key !== currentIdentity.key) {
    if (normalizeFavoriteUrl(existing.url) === normalizeFavoriteUrl(url)) {
      return hasContinueProgressRecord(existing) || progressState.mediaEnded || progressState.watchedSeconds >= MIN_WATCH_TIME_SECONDS;
    }
    return progressState.mediaEnded || progressState.watchedSeconds >= MIN_WATCH_TIME_SECONDS;
  }

  const comparison = compareEpisodeIdentity(nextIdentity, currentIdentity);
  if (comparison < 0) {
    const finalSeason = sanitizePositiveNumber(progressState.finalSeason);
    const finalEpisode = sanitizePositiveNumber(progressState.finalEpisode);
    const finalIdentity = finalSeason && finalEpisode
      ? { key: nextIdentity.key, season: finalSeason, episode: finalEpisode }
      : null;
    const existingIsPastKnownFinal = finalIdentity
      && currentIdentity.key === finalIdentity.key
      && compareEpisodeIdentity(currentIdentity, finalIdentity) > 0;
    const nextIsInsideKnownSeries = finalIdentity
      && compareEpisodeIdentity(nextIdentity, finalIdentity) <= 0;
    if (existingIsPastKnownFinal && nextIsInsideKnownSeries) {
      return progressState.mediaEnded || progressState.watchedSeconds >= MIN_WATCH_TIME_SECONDS;
    }
    return false;
  }
  if (comparison === 0) {
    return hasContinueProgressRecord(existing) || progressState.mediaEnded || progressState.watchedSeconds >= MIN_WATCH_TIME_SECONDS;
  }
  return progressState.mediaEnded || progressState.watchedSeconds >= MIN_WATCH_TIME_SECONDS;
}

function nextEpisodeContinueUrl(currentUrl, preferredUrl = "", entry = null) {
  const currentIdentity = episodeIdentity(currentUrl);
  const resolvedPreferred = absoluteHttpUrl(preferredUrl, currentUrl);
  const preferredIdentity = episodeIdentity(resolvedPreferred);
  if (resolvedPreferred
    && preferredIdentity
    && currentIdentity
    && preferredIdentity.key === currentIdentity.key
    && compareEpisodeIdentity(preferredIdentity, currentIdentity) > 0) {
    return resolvedPreferred;
  }
  if (!currentIdentity) return "";
  const finalSeason = sanitizePositiveNumber(entry?.finalSeason);
  const finalEpisode = sanitizePositiveNumber(entry?.finalEpisode);
  if (!finalSeason || !finalEpisode) return "";
  if (currentIdentity.season !== finalSeason) return "";
  if (currentIdentity.season === finalSeason && currentIdentity.episode >= finalEpisode) return "";
  return incrementEpisodeUrl(currentUrl);
}

function incrementEpisodeUrl(value) {
  try {
    const url = new URL(value);
    let changed = false;
    url.pathname = url.pathname.replace(/\/(episode|folge)-(\d+)(?=\/?$)/i, (_match, label, episode) => {
      changed = true;
      return `/${label}-${Number(episode) + 1}`;
    });
    return changed ? url.href : "";
  } catch {
    return "";
  }
}

function appendCompletedEpisode(entry, identity, url, completedAt) {
  if (!entry || !identity) return;
  const completedEpisodes = Array.isArray(entry.completedEpisodes) ? entry.completedEpisodes : [];
  const key = `${identity.key}:s${identity.season}:e${identity.episode}`;
  if (!completedEpisodes.some((item) => item?.key === key)) {
    completedEpisodes.push({
      key,
      season: sanitizePositiveNumber(identity.season),
      episode: sanitizePositiveNumber(identity.episode),
      url,
      completedAt
    });
  }
  entry.completedEpisodes = completedEpisodes.slice(-500);
}

function compareEpisodeIdentity(left, right) {
  const leftSeason = sanitizePositiveNumber(left?.season);
  const rightSeason = sanitizePositiveNumber(right?.season);
  if (leftSeason !== rightSeason) return leftSeason - rightSeason;
  return sanitizePositiveNumber(left?.episode) - sanitizePositiveNumber(right?.episode);
}

function isFirstEpisodeIdentity(identity) {
  return Boolean(identity && sanitizePositiveNumber(identity.episode) === 1 && sanitizePositiveNumber(identity.season) <= 1);
}

function normalizeMediaType(value) {
  const type = String(value || "").toLowerCase();
  if (type === "film" || type === "movie") return "film";
  if (type === "serie" || type === "series" || type === "anime") return "serie";
  return "";
}

function mediaTypeForProgressUrl(url, typeHint = "") {
  const hinted = normalizeMediaType(typeHint);
  const identity = episodeIdentity(url);
  if (identity && hinted === "film" && !isExplicitFilmUrl(url)) return "serie";
  return hinted || inferMediaType(url);
}

function isExplicitFilmUrl(value) {
  try {
    const parts = new URL(value).pathname.split("/").filter(Boolean).map((part) => part.toLowerCase());
    return parts.some((part) => ["film", "filme", "movie", "movies"].includes(part) || /^(?:film|movie)-\d+$/.test(part));
  } catch {
    return false;
  }
}

function mediaPromotionBlockReason(existing, url, state) {
  const nextIdentity = episodeIdentity(url);
  const currentIdentity = episodeIdentity(existing?.url);
  if (nextIdentity && currentIdentity && nextIdentity.key === currentIdentity.key && compareEpisodeIdentity(nextIdentity, currentIdentity) < 0) {
    const finalSeason = sanitizePositiveNumber(state.finalSeason);
    const finalEpisode = sanitizePositiveNumber(state.finalEpisode);
    const finalIdentity = finalSeason && finalEpisode
      ? { key: nextIdentity.key, season: finalSeason, episode: finalEpisode }
      : null;
    if (finalIdentity
      && compareEpisodeIdentity(currentIdentity, finalIdentity) > 0
      && compareEpisodeIdentity(nextIdentity, finalIdentity) <= 0
      && !state.mediaEnded
      && state.watchedSeconds < MIN_WATCH_TIME_SECONDS) {
      return `repariert Fake-Stand erst nach 2:30 Minuten Wiedergabe (${Math.round(state.watchedSeconds)}s / ${MIN_WATCH_TIME_SECONDS}s)`;
    }
    return `ältere Folge bleibt nur im Verlauf (${favoriteProgressTargetLabel(url)} < ${favoriteProgressTargetLabel(existing.url)})`;
  }
  if (!state.mediaEnded && state.watchedSeconds < MIN_WATCH_TIME_SECONDS) {
    return `unter 2:30 Minuten Wiedergabe (${Math.round(state.watchedSeconds)}s / ${MIN_WATCH_TIME_SECONDS}s)`;
  }
  return "nicht als neuer Hauptstand übernommen";
}

function mediaDiagnosticDecisionText(entry, url, state) {
  if (entry.completed) return "Medium abgeschlossen, aus Watchlist/Weiterschauen entfernt und in Mediathek sichtbar";
  if (state.hasMediaProgress) {
    const target = entry?.type === "film" ? "Film" : favoriteProgressTargetLabel(url);
    const watched = Math.round(state.watchedSeconds || 0);
    const progress = Number.isFinite(state.progressPercent) ? `${state.progressPercent}%` : "ohne Prozent";
    return `${target} gespeichert - Wiedergabe ${watched}s - Fortschritt ${progress}`;
  }
  return "Verlauf gespeichert";
}

function appendMediaActivity(entry, url, label) {
  if (!entry) return;
  const activity = Array.isArray(entry.activity) ? entry.activity : [];
  const identity = episodeIdentity(url);
  activity.push({
    at: new Date().toISOString(),
    url,
    label: label || mediaActivityLabel(url, entry),
    season: identity?.season || entry.season || 0,
    episode: identity?.episode || entry.episode || 0
  });
  entry.activity = activity.slice(-120);
}

function mediaActivityLabel(url, entry) {
  const label = favoriteProgressTargetLabel(url);
  if (label !== "neue Folge") return label;
  return entry?.type === "film" ? "Film geöffnet" : "Geöffnet";
}

function cleanBaseMediaTitle(title, url) {
  const fromUrl = titleFromPath(url);
  const raw = cleanTitle(title || fromUrl);
  const value = raw
    .replace(/\s*[·|]\s*(?:staffel|season)\s*\d+\s*(?:folge|episode)\s*\d+.*$/i, "")
    .replace(/\s*[·|]\s*(?:folge|episode)\s*\d+.*$/i, "")
    .replace(/\s*[-–]\s*(?:staffel|season)\s*\d+\s*(?:folge|episode)\s*\d+.*$/i, "")
    .replace(/\s*[-–]\s*(?:folge|episode)\s*\d+.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleanTitle(value || fromUrl || raw);
}

function isTrackableMediaUrl(url, provider) {
  if (isFavoriteProgressUrl(url, provider)) return true;
  const slug = mediaSlugFromUrl(url);
  if (!slug) return false;
  try {
    const pathname = new URL(url).pathname;
    return !/(\/|^)(search|suche|login|register|profile|account|settings|popular|beliebt)(\/|$)/i.test(pathname);
  } catch {
    return true;
  }
}

function isValidMediaProgress(progress) {
  const currentTime = Number(progress?.currentTime);
  const duration = Number(progress?.duration);
  return Number.isFinite(currentTime)
    && Number.isFinite(duration)
    && duration > 0
    && currentTime >= 0
    && currentTime <= duration + 3;
}

function mediaProgressPercent(currentTime, duration) {
  const current = Number(currentTime);
  const total = Number(duration);
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
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

function applyFavoriteSeriesBounds(favorite, meta = {}, currentUrl = favorite?.url || "") {
  const mediaType = favorite?.type === "serie" ? "serie" : inferMediaType(currentUrl || favorite?.url || "");
  if (!favorite || mediaType !== "serie") return false;
  const nextFinalSeason = sanitizePositiveNumber(meta.finalSeason);
  const nextFinalEpisode = sanitizePositiveNumber(meta.finalEpisode);
  if (!nextFinalSeason || !nextFinalEpisode) return false;

  const previousFinalSeason = sanitizePositiveNumber(favorite.finalSeason);
  const previousFinalEpisode = sanitizePositiveNumber(favorite.finalEpisode);
  const hadKnownFinal = Boolean(previousFinalSeason && previousFinalEpisode);
  const nextBounds = { key: episodeIdentity(currentUrl)?.key || episodeIdentity(favorite.url)?.key || "", season: nextFinalSeason, episode: nextFinalEpisode };
  const previousBounds = { key: nextBounds.key, season: previousFinalSeason, episode: previousFinalEpisode };
  if (hadKnownFinal && compareEpisodeIdentity(nextBounds, previousBounds) < 0) return false;

  let changed = false;
  if (favorite.finalSeason !== nextFinalSeason) {
    favorite.finalSeason = nextFinalSeason;
    changed = true;
  }
  if (favorite.finalEpisode !== nextFinalEpisode) {
    favorite.finalEpisode = nextFinalEpisode;
    changed = true;
  }

  if (favorite.completed && hasNewEpisodeAfterCompletedFavorite(favorite, previousBounds, nextBounds)) {
    const nextUrl = nextEpisodeAfterFavoriteUrl(favorite, nextFinalSeason, nextFinalEpisode);
    favorite.completed = false;
    favorite.episodeCompleted = false;
    favorite.favorite = true;
    favorite.hideFromContinueWatching = false;
    favorite.continuePending = true;
    favorite.completedAt = "";
    favorite.progress = 0;
    favorite.currentTime = 0;
    favorite.position = 0;
    favorite.duration = 0;
    if (nextUrl) {
      favorite.url = nextUrl;
      favorite.normalizedUrl = normalizeFavoriteUrl(nextUrl);
      const nextIdentity = episodeIdentity(nextUrl);
      favorite.season = nextIdentity?.season || favorite.season || 0;
      favorite.episode = nextIdentity?.episode || favorite.episode || 0;
    }
    sendToast(`${cleanBaseMediaTitle(favorite.title, favorite.url) || favorite.title || "Serie"} ist wieder in der Watchlist: neue Folge erkannt`);
    changed = true;
  }
  return changed;
}

function hasNewEpisodeAfterCompletedFavorite(favorite, previousBounds, nextBounds) {
  const completedIdentity = episodeIdentity(favorite?.url || "");
  if (!completedIdentity || !nextBounds?.season || !nextBounds?.episode) return false;
  if (nextBounds.key && completedIdentity.key && nextBounds.key !== completedIdentity.key) return false;
  if (compareEpisodeIdentity(nextBounds, completedIdentity) > 0) return true;
  return previousBounds?.season
    && previousBounds?.episode
    && compareEpisodeIdentity(nextBounds, previousBounds) > 0;
}

function nextEpisodeAfterFavoriteUrl(favorite, finalSeason, finalEpisode) {
  const identity = episodeIdentity(favorite?.url || "");
  if (!identity) return "";
  if (identity.season < finalSeason) {
    return replaceEpisodeUrl(favorite.url, identity.season + 1, 1);
  }
  if (identity.season === finalSeason && identity.episode < finalEpisode) {
    return replaceEpisodeUrl(favorite.url, identity.season, identity.episode + 1);
  }
  return "";
}

function replaceEpisodeUrl(value, season, episode) {
  try {
    const url = new URL(value);
    let hasSeason = false;
    let hasEpisode = false;
    url.pathname = url.pathname
      .replace(/\/(staffel|season)-\d+(?=\/|$)/i, (_match, label) => {
        hasSeason = true;
        return `/${label}-${season}`;
      })
      .replace(/\/(episode|folge)-\d+(?=\/|$)/i, (_match, label) => {
        hasEpisode = true;
        return `/${label}-${episode}`;
      });
    return hasSeason && hasEpisode ? url.href : "";
  } catch {
    return "";
  }
}

function firstEpisodeUrl(value) {
  const fullEpisodeUrl = replaceEpisodeUrl(value, 1, 1);
  if (fullEpisodeUrl) return fullEpisodeUrl;

  try {
    const url = new URL(value);
    let changed = false;
    url.pathname = url.pathname.replace(/\/(episode|folge)-\d+(?=\/|$)/i, (_match, label) => {
      changed = true;
      return `/${label}-1`;
    });
    return changed ? url.href : "";
  } catch {
    return "";
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

function isSequentialFavoriteProgress(previous, next) {
  if (!previous || !next || previous.key !== next.key) return false;
  if (previous.season === next.season && next.episode === previous.episode + 1) return true;
  return previous.season > 0
    && next.season === previous.season + 1
    && previous.episode > 1
    && next.episode === 1;
}

function favoriteProgressTargetLabel(url) {
  const identity = episodeIdentity(url);
  if (!identity) return "neue Folge";
  if (identity.season > 0) return `Staffel ${identity.season} Folge ${identity.episode}`;
  return `Folge ${identity.episode}`;
}

function episodeIdentity(value) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    if (!parts.length) return null;

    const markers = ["stream", "serie", "film", "filme", "movie", "movies", "title"];
    let mediaSlug = "";
    for (let index = 0; index < parts.length - 1; index += 1) {
      if (markers.includes(parts[index].toLowerCase())) {
        mediaSlug = parts[index + 1].toLowerCase();
        break;
      }
    }
    if (!mediaSlug) return null;

    let season = 0;
    let episode = 0;
    for (const part of parts) {
      const seasonMatch = part.match(/^(?:staffel|season)-(\d+)$/i);
      if (seasonMatch) season = Number(seasonMatch[1]);
      const episodeMatch = part.match(/^(?:episode|folge)-(\d+)$/i);
      if (episodeMatch) episode = Number(episodeMatch[1]);
    }
    if (!Number.isFinite(episode) || episode <= 0) return null;
    return {
      key: `${stripWww(url.hostname)}:${mediaSlug}`,
      season,
      episode
    };
  } catch {
    return null;
  }
}

function isFavoriteProgressUrl(url, provider) {
  if (!providerModel.isHttpUrl(url)) return false;
  try {
    const parsed = new URL(url);
    const pathName = parsed.pathname.replace(/\/+$/, "") || "/";
    if (pathName === "/" || /(\/|^)(search|suche|login|register|logout|settings|profile|account)(\/|$)/i.test(pathName)) return false;
    return isAllowedResultHost(parsed.hostname, providerModel.hostFromUrl(provider.startUrl), provider);
  } catch {
    return false;
  }
}

function sendActiveState() {
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
  return gemischt;
}

async function discoverForProvider(provider, refresh) {
  const cached = discoverCache.get(provider.id);
  if (!refresh && cached && Date.now() - cached.at < DISCOVER_CACHE_MS) return cached.items;

  const startUrl = providerModel.normalizeUrl(provider.startUrl || "");
  if (!startUrl) return [];
  const response = await fetch(startUrl, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 ELFIX/0.2"
    },
    redirect: "follow"
  });
  if (!response.ok) return cached?.items || [];

  const html = await response.text();
  const basis = response.url || startUrl;
  // Seiten, die ihre Kacheln per JavaScript nachladen, liefern nur Poster mit
  // Titel - dann wird der Titel spaeter ueber die Suche des Anbieters geoeffnet.
  let items = extractDiscoverItems(html, basis, provider);
  if (items.length < 4) {
    const ersatz = extractPosterFallbacks(html, basis, provider);
    if (ersatz.length > items.length) items = ersatz;
  }
  if (items.length) discoverCache.set(provider.id, { at: Date.now(), items });
  return items;
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

function isAllowedResultHost(targetHost, baseHost, provider) {
  const target = stripWww(targetHost);
  const base = stripWww(baseHost);
  const providerHost = stripWww(providerModel.hostFromUrl(provider?.startUrl || ""));
  const name = String(provider?.name || "").toLowerCase();
  if (target === base || target === providerHost) return true;
  if (target.endsWith(`.${base}`) || base.endsWith(`.${target}`)) return true;
  if (providerHost && (target.endsWith(`.${providerHost}`) || providerHost.endsWith(`.${target}`))) return true;
  if (name.includes("aniworld")) return target.includes("aniworld");
  if (name === "s.to" || name.includes("s.to")) return target === "s.to" || target.endsWith(".s.to") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(target);
  if (name.includes("filmo")) return target.includes("filmo");
  return false;
}

function stripWww(hostname) {
  return String(hostname || "").toLowerCase().replace(/^www\./, "");
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

function titleFromPath(href) {
  try {
    const parts = new URL(href).pathname.split("/").filter(Boolean);
    const slug = parts[parts.length - 1] || "";
    return slug
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return "";
  }
}

function absoluteHttpUrl(href, baseUrl) {
  try {
    const url = new URL(String(href || ""), baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function isNoiseUrl(url) {
  return /\/(login|register|logout|impressum|privacy|datenschutz|agb|terms)(\/|$)/i.test(url)
    || /\/(forum|forums|thread|threads|community|support|blog|news|empfehlungen|recommendations?|kommentar|comments?)(\/|$)/i.test(url)
    || /[?&](replytocom|share|utm_)/i.test(url);
}

function cleanAnchorText(value) {
  return decodeHtmlEntities(
    String(value || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
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

function loadFavorites() {
  try {
    const raw = JSON.parse(fs.readFileSync(FAVORITES_FILE, "utf8"));
    if (!Array.isArray(raw)) return [];
    return raw.map((favorite) => normalizeLoadedFavorite({
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
      activity: normalizeActivity(favorite.activity),
      createdAt: String(favorite.createdAt || new Date().toISOString()),
      openedAt: String(favorite.openedAt || ""),
      updatedAt: String(favorite.updatedAt || "")
    })).filter((favorite) => providerModel.isHttpUrl(favorite.url));
  } catch {
    return [];
  }
}

function normalizeActivity(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-120).map((item) => ({
    at: String(item?.at || ""),
    url: String(item?.url || ""),
    label: String(item?.label || ""),
    season: sanitizePositiveNumber(item?.season),
    episode: sanitizePositiveNumber(item?.episode)
  })).filter((item) => item.at || item.url || item.label);
}

function normalizeCompletedEpisodes(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-500).map((item) => ({
    key: String(item?.key || ""),
    season: sanitizePositiveNumber(item?.season),
    episode: sanitizePositiveNumber(item?.episode),
    url: String(item?.url || ""),
    completedAt: String(item?.completedAt || "")
  })).filter((item) => item.key || item.url || item.episode);
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

function normalizeLoadedFavorite(favorite) {
  if (isStoFavoriteRecord(favorite)) {
    const thumbnail = absoluteHttpUrl(favorite.thumbnail, favorite.url);
    favorite.thumbnail = isStoChannelArtworkUrl(thumbnail) ? thumbnail : "";
    return favorite;
  }
  if (isAniWorldFavoriteRecord(favorite)) {
    const thumbnail = absoluteHttpUrl(favorite.thumbnail, favorite.url);
    favorite.thumbnail = isAniWorldArtworkUrl(thumbnail) ? thumbnail : "";
    return favorite;
  }
  return favorite;
}

function saveFavorites() {
  ensureDataDir();
  fs.writeFileSync(FAVORITES_FILE, JSON.stringify(favorites, null, 2));
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
  const tokens = new Set([
    ...normalizeSearchText(slug).split(" "),
    ...normalizeSearchText(title).split(" ")
  ].filter((token) => token.length > 2 && !/^(anime|stream|staffel|folge|episode|kostenlos|gratis|online|ansehen|aniworld|animes)$/i.test(token)));
  return Array.from(tokens);
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

function expectedArtworkTokens(url, title) {
  const slug = stoMediaSlugFromUrl(url);
  const tokens = new Set([
    ...normalizeSearchText(slug).split(" "),
    ...normalizeSearchText(title).split(" ")
  ].filter((token) => token.length > 2 && !/^(serie|staffel|folge|episode|stream|kostenlos|ansehen|season)$/i.test(token)));
  return Array.from(tokens);
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
  return /(?:logo|favicon|sprite|icon|avatar|flag|placeholder|blank|transparent|loading|spinner|play|button|rating|language|login|register|facebook|twitter|og-image|social|share|default|noimage|no-image)/i.test(String(value || ""));
}

function isStoChannelArtworkUrl(value) {
  try {
    const url = new URL(value);
    return isStoHost(url.hostname.toLowerCase())
      && /\/media\/images\/channel\/(?:2x-)?desktop\/[^/?#]+/i.test(url.pathname)
      && !/(?:logo|favicon|sprite|icon|avatar|flag|placeholder|blank|transparent|black)/i.test(url.href);
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
  return view.webContents.executeJavaScript(`(() => {
    const abs = (value) => {
      try { return value ? new URL(value, location.href).href : ""; } catch (_) { return ""; }
    };
    const imageUrl = (node) => node && (
      node.currentSrc
      || node.src
      || node.getAttribute("data-src")
      || node.getAttribute("data-lazy-src")
      || node.getAttribute("data-original")
      || node.getAttribute("data-image")
      || node.getAttribute("src")
    );
    const imageMeta = document.querySelector("meta[property='og:image'], meta[name='twitter:image']");
    const icon = document.querySelector("link[rel~='icon'], link[rel='shortcut icon']");
    const candidates = [];
    const isStoPage = location.hostname === "s.to"
      || location.hostname.endsWith(".s.to")
      || /^\\d{1,3}(?:\\.\\d{1,3}){3}$/.test(location.hostname);
    const isFilmoPage = location.hostname.toLowerCase().includes("filmo");
    const isAniWorldPage = location.hostname.toLowerCase().includes("aniworld");
    const pushCandidate = (url, score) => {
      const href = abs(url);
      if (!href || /(?:logo|favicon|sprite|icon|avatar|flag|placeholder|blank)/i.test(href)) return;
      candidates.push({ href, score });
    };
    const imageText = (img) => [
      img.alt,
      img.title,
      img.className,
      img.id,
      img.closest("[class], [id]") && img.closest("[class], [id]").className,
      img.closest("[class], [id]") && img.closest("[class], [id]").id
    ].join(" ");
    const nearbyText = (node, depth) => {
      const parts = [];
      let current = node;
      for (let index = 0; current && index < depth; index += 1) {
        parts.push(current.textContent || "");
        if (current.previousElementSibling) parts.push(current.previousElementSibling.textContent || "");
        if (current.nextElementSibling) parts.push(current.nextElementSibling.textContent || "");
        current = current.parentElement;
      }
      return parts.join(" ").replace(/\\s+/g, " ").trim();
    };
    const styleImageUrl = (node) => {
      try {
        const value = getComputedStyle(node).backgroundImage || "";
        const match = value.match(/url\\(["']?([^"')]+)["']?\\)/i);
        return match ? match[1] : "";
      } catch (_) {
        return "";
      }
    };
    const nodeImageUrl = (node) => node && node.tagName === "IMG" ? imageUrl(node) : styleImageUrl(node);
    const mediaSlug = (() => {
      const parts = location.pathname.split("/").filter(Boolean);
      for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index].toLowerCase();
        if (part === "anime" && parts[index + 1]?.toLowerCase() === "stream" && parts[index + 2]) return parts[index + 2];
        if (part === "serie" && parts[index + 1]?.toLowerCase() === "stream" && parts[index + 2]) return parts[index + 2];
        if ((part === "serie" || part === "stream") && parts[index + 1]) return parts[index + 1];
      }
      return parts.find((part) => !/^(anime|serie|stream|staffel-\\d+|episode-\\d+)$/i.test(part)) || "";
    })().toLowerCase();
    const normalizeText = (value) => String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\\s+/g, " ")
      .trim();
    const mediaTokens = mediaSlug.split(/[-_]+/).filter((token) => token.length > 2);
    const titleTokens = normalizeText((document.querySelector("h1")?.textContent || "") + " " + (document.title || ""))
      .split(" ")
      .filter((token) => token.length > 2 && !/^(serie|staffel|folge|episode|stream|kostenlos|ansehen|season)$/i.test(token));
    const expectedTokens = Array.from(new Set([...mediaTokens, ...titleTokens]));
    const episodeIdentityFromHref = (href) => {
      try {
        const url = new URL(href, location.href);
        const parts = url.pathname.split("/").filter(Boolean);
        let slug = "";
        let season = 0;
        let episode = 0;
        for (let index = 0; index < parts.length; index += 1) {
          const part = parts[index].toLowerCase();
          if (part === "anime" && parts[index + 1]?.toLowerCase() === "stream" && parts[index + 2]) slug = parts[index + 2].toLowerCase();
          if (part === "serie" && parts[index + 1]?.toLowerCase() === "stream" && parts[index + 2]) slug = parts[index + 2].toLowerCase();
          if ((part === "serie" || part === "stream") && parts[index + 1] && !slug) slug = parts[index + 1].toLowerCase();
          const seasonMatch = part.match(/^(?:staffel|season)-(\\d+)$/i);
          if (seasonMatch) season = Number(seasonMatch[1]);
          const episodeMatch = part.match(/^(?:episode|folge)-(\\d+)$/i);
          if (episodeMatch) episode = Number(episodeMatch[1]);
        }
        if (!episode || !Number.isFinite(episode)) return null;
        if (mediaSlug && slug && slug !== mediaSlug) return null;
        return { season: season || 1, episode, href: url.href };
      } catch (_) {
        return null;
      }
    };
    const seriesBounds = (() => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const links = anchors
        .map((anchor) => episodeIdentityFromHref(anchor.getAttribute("href")))
        .filter(Boolean);
      const seasonNumbers = anchors
        .map((anchor) => {
          const href = abs(anchor.getAttribute("href"));
          const hrefMatch = href.match(/\\/(?:staffel|season)-(\\d+)(?:[/?#]|$)/i);
          return hrefMatch ? Number(hrefMatch[1]) : 0;
        })
        .filter((number) => Number.isFinite(number) && number > 0);
      const finalSeason = Math.max(0, ...seasonNumbers, ...links.map((link) => link.season || 0));
      const best = links
        .filter((link) => !finalSeason || link.season === finalSeason)
        .sort((left, right) => right.episode - left.episode)[0];
      return {
        finalSeason,
        finalEpisode: best?.episode || 0
      };
    })();
    const visibleTitle = () => {
      const h1 = document.querySelector("h1");
      const mainTitle = String(h1?.textContent || "").replace(/\\s+/g, " ").trim();
      if (mainTitle) return mainTitle;
      return String(document.title || "").replace(/\\s+/g, " ").trim();
    };
    const currentFilmTitle = () => {
      const path = location.pathname.toLowerCase();
      const match = path.match(/\\/(?:filme|film|movies|movie)\\/(?:film|movie)?-?(\\d+)(?:\\/|$)/i)
        || path.match(/\\/(?:film|movie)-(\\d+)(?:\\/|$)/i);
      if (!match) return "";
      const number = Number(match[1]);
      if (!Number.isFinite(number) || number <= 0) return "";
      const targetHref = new RegExp("/(?:filme|film|movies|movie)/(?:film|movie)?-?" + number + "(?:/|$)|/(?:film|movie)-" + number + "(?:/|$)", "i");
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const matchingAnchor = anchors.find((anchor) => targetHref.test(abs(anchor.getAttribute("href"))));
      const row = matchingAnchor?.closest("tr, li, .row, [class*='episode'], [class*='film'], [class*='movie']");
      const raw = String(row?.textContent || matchingAnchor?.textContent || "")
        .replace(/\\s+/g, " ")
        .trim();
      const cleaned = raw
        .replace(new RegExp("^Film\\\\s*" + number + "\\\\s*", "i"), "")
        .replace(/\\b(?:hoster|sprache|deutsch|english|voe|streamtape|doodstream|vidoza)\\b.*$/i, "")
        .replace(/\\s+/g, " ")
        .trim();
      if (cleaned) return cleaned;

      const seriesTitle = normalizeText(visibleTitle());
      const lines = String(document.body?.innerText || "")
        .split(/\\n+/)
        .map((line) => line.replace(/\\s+/g, " ").trim())
        .filter((line) => line.length >= 8 && line.length <= 180);
      return lines.find((line) => {
        const normalized = normalizeText(line);
        if (!normalized || normalized === seriesTitle) return false;
        if (/^(home|animes|staffeln?|filme|film\\s*\\d+|episoden?|hoster|sprache|kommentare)$/i.test(line)) return false;
        return /\\[(?:movie|film|ova)[^\\]]*\\]|\\b(?:movie|ova|film)\\b/i.test(line);
      }) || "";
    };
    const mediaTitle = () => currentFilmTitle() || visibleTitle();
    const activeMediaType = () => {
      const path = location.pathname.toLowerCase();
      if (/\\/(?:staffel|season)-\\d+(?:\\/|$)/i.test(path) || /\\/(?:episode|folge)-\\d+(?:\\/|$)/i.test(path)) {
        return "serie";
      }
      if (/\\/(?:filme|film|movie|movies)(?:\\/|$)/i.test(path) || /\\/(?:film|movie)-\\d+(?:\\/|$)/i.test(path)) {
        return "film";
      }
      const pageText = [
        ...Array.from(document.querySelectorAll(".breadcrumb, nav, [class*='breadcrumb'], [class*='season'], [class*='staffel']"))
          .slice(0, 12)
          .map((node) => node.textContent || "")
      ].join(" ");
      const activeTabText = Array.from(document.querySelectorAll(".active, .selected, [aria-current='page'], [class*='active']"))
        .map((node) => node.textContent || "")
        .join(" ");
      if (isAniWorldPage && /(?:^|\\s|›|>)(filme|film)(?:\\s|$|›|>)/i.test(activeTabText || pageText)) return "film";
      if (isFilmoPage) return "film";
      if (isStoPage || isAniWorldPage) return "serie";
      return "";
    };
    const isRecommendationArea = (img) => {
      const text = nearbyText(img, 4).toLowerCase();
      if (/(?:das schauen andere|schauen andere|empfehlungen|aehnliche|ähnliche|kommentare|kommentar)/i.test(text)) return true;
      let current = img;
      for (let index = 0; current && index < 8; index += 1) {
        let sibling = current.previousElementSibling;
        for (let count = 0; sibling && count < 4; count += 1) {
          if (/(?:das schauen andere|schauen andere|empfehlungen|aehnliche|ähnliche|kommentare)/i.test(sibling.textContent || "")) return true;
          sibling = sibling.previousElementSibling;
        }
        current = current.parentElement;
      }
      return false;
    };
    const isStoChannelArtwork = (href) => /\\/media\\/images\\/channel\\/(?:2x-)?desktop\\/[^?#]+/i.test(href)
      && !/(?:logo|favicon|sprite|icon|avatar|flag|placeholder|blank|transparent|black)/i.test(href);
    const bestSrcsetImage = (img) => {
      const srcset = img.getAttribute("data-srcset") || img.getAttribute("srcset") || "";
      const candidates = srcset.split(",")
        .map((entry) => {
          const parts = entry.trim().split(/\\s+/);
          const href = abs(parts[0] || "");
          const descriptor = parts[1] || "";
          const scale = descriptor.endsWith("x") ? Number.parseFloat(descriptor) || 1 : 1;
          return { href, scale };
        })
        .filter((candidate) => isStoChannelArtwork(candidate.href))
        .sort((a, b) => b.scale - a.scale);
      return candidates[0]?.href || "";
    };
    const stoChannelImageUrl = (img) => {
      const fromSrcset = bestSrcsetImage(img);
      if (fromSrcset) return fromSrcset;
      const raw = img.getAttribute("data-src")
        || img.getAttribute("src")
        || img.currentSrc
        || img.src
        || "";
      const href = abs(raw);
      return isStoChannelArtwork(href) ? href : "";
    };
    const stoInfoPanelImage = () => {
      const nodes = Array.from(document.querySelectorAll([
        "img[src*='/media/images/channel/']",
        "img[data-src*='/media/images/channel/']",
        "img[srcset*='/media/images/channel/']",
        "img[data-srcset*='/media/images/channel/']"
      ].join(",")));
      let best = null;
      let bestScore = 0;
      for (const img of nodes) {
        const href = stoChannelImageUrl(img);
        if (!href) continue;
        if (isRecommendationArea(img)) continue;
        const rect = img.getBoundingClientRect();
        const width = img.naturalWidth || rect.width || 0;
        const height = img.naturalHeight || rect.height || 0;
        const ratio = width / Math.max(1, height);
        if (width < 80 || height < 110 || ratio < 0.35 || ratio > 1.05) continue;

        const near = nearbyText(img, 8).toLowerCase();
        const combined = normalizeText(imageText(img) + " " + near + " " + href);
        const overlap = expectedTokens.filter((token) => combined.includes(token)).length;
        if (expectedTokens.length && overlap === 0) continue;
        let score = 1800;
        if (/\\/2x-desktop\\//i.test(href)) score += 320;
        score += overlap * 420;
        if (/(?:staffeln?:|episoden?:|fsk\\s*\\d+|mehr anzeigen|beschreibung|bewertungen|veröffentlicht|veroeffentlicht)/i.test(near)) score += 900;
        if (rect.left > innerWidth * 0.42) score += 420;
        if (rect.top >= 0 && rect.top < Math.max(780, innerHeight)) score += 260;
        if (/(?:das schauen andere|schauen andere|empfehlungen|kommentare)/i.test(near)) score -= 4000;
        score += Math.max(0, 220 - Math.abs(ratio - 0.68) * 350);
        if (score > bestScore) {
          bestScore = score;
          best = href;
        }
      }
      return best || "";
    };
    const isAniWorldArtwork = (href) => {
      try {
        const url = new URL(href, location.href);
        const value = url.href.toLowerCase();
        return url.hostname.toLowerCase().includes("aniworld")
          && !/(?:logo|favicon|sprite|icon|avatar|flag|placeholder|blank|transparent|loading|spinner|play|button|rating|language|login|register|facebook|twitter|og-image|social|share|default|noimage|no-image)/i.test(value)
          && /\\/public\\/img\\/cover\\/[^/?#]+\\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname);
      } catch (_) {
        return false;
      }
    };
    const bestAniWorldSrcsetImage = (node) => {
      const srcset = node.getAttribute("data-srcset") || node.getAttribute("srcset") || "";
      const candidates = srcset.split(",")
        .map((entry) => {
          const parts = entry.trim().split(/\\s+/);
          const href = abs(parts[0] || "");
          const descriptor = parts[1] || "";
          const scale = descriptor.endsWith("x") ? Number.parseFloat(descriptor) || 1 : 1;
          const width = descriptor.endsWith("w") ? Number.parseFloat(descriptor) || 0 : 0;
          return { href, scale, width };
        })
        .filter((candidate) => isAniWorldArtwork(candidate.href))
        .sort((a, b) => (b.scale - a.scale) || (b.width - a.width));
      return candidates[0]?.href || "";
    };
    const aniWorldNodeImageUrl = (node) => {
      if (!node) return "";
      if (node.tagName === "IMG") {
        return bestAniWorldSrcsetImage(node)
          || abs(node.getAttribute("data-src"))
          || abs(node.getAttribute("data-lazy-src"))
          || abs(node.getAttribute("data-original"))
          || abs(node.getAttribute("data-image"))
          || abs(node.currentSrc || node.src || node.getAttribute("src"));
      }
      return abs(
        node.getAttribute("data-bg")
        || node.getAttribute("data-background")
        || node.getAttribute("data-image")
        || styleImageUrl(node)
      );
    };
    const aniWorldMainImage = () => {
      const metaHref = abs(imageMeta && imageMeta.getAttribute("content"));
      const nodes = [
        ...Array.from(document.querySelectorAll("main img, article img, aside img, [class*='cover'] img, [class*='poster'] img, [class*='series'] img, [class*='anime'] img, [class*='description'] img, [class*='info'] img")),
        ...Array.from(document.querySelectorAll("main [style*='background-image'], article [style*='background-image'], aside [style*='background-image'], [class*='cover'][style*='background-image'], [class*='poster'][style*='background-image'], [class*='anime'][style*='background-image']"))
      ];
      const seen = new Set();
      let best = "";
      let bestScore = 0;
      const currentSlug = mediaSlug;
      const badContext = (node) => {
        let current = node;
        for (let depth = 0; current && depth < 7; depth += 1) {
          const label = String(current.className || "") + " " + String(current.id || "") + " " + String(current.textContent || "");
          if (/(?:recommend|similar|carousel|slider|popular|beliebt|kommentare|comment|episode-list|language|login|register)/i.test(label)) return true;
          current = current.parentElement;
        }
        return false;
      };
      const add = (href, node, baseScore) => {
        if (!href || seen.has(href) || !isAniWorldArtwork(href)) return;
        seen.add(href);
        const context = normalizeText((node ? imageText(node) + " " + nearbyText(node, 8) : "") + " " + href + " " + (document.querySelector("h1")?.textContent || ""));
        const overlap = expectedTokens.filter((token) => context.includes(token)).length;
        if (expectedTokens.length && overlap === 0 && !(currentSlug && href.toLowerCase().includes(currentSlug))) return;
        let score = baseScore + overlap * 560;
        if (currentSlug && href.toLowerCase().includes(currentSlug)) score += 900;
        if (node && /cover|poster|series?|serie|anime|stream|description|info/i.test(imageText(node) + " " + nearbyText(node, 4))) score += 320;
        if (node) {
          const rect = node.getBoundingClientRect();
          if (rect.top >= -120 && rect.top < Math.max(900, innerHeight * 1.3)) score += 160;
          if (rect.left > innerWidth * 0.35) score += 120;
        }
        if (score > bestScore) {
          bestScore = score;
          best = href;
        }
      };

      add(metaHref, null, 1400);
      for (const node of nodes) {
        if (badContext(node)) continue;
        const href = aniWorldNodeImageUrl(node);
        if (!href) continue;
        const rect = node.getBoundingClientRect();
        const width = node.naturalWidth || rect.width || 0;
        const height = node.naturalHeight || rect.height || 0;
        if (node.tagName === "IMG" && width > 0 && height > 0 && (width < 70 || height < 70)) continue;
        add(href, node, 1800);
      }
      return best || "";
    };
    const filmoImageUrl = (node) => {
      if (!node) return "";
      if (node.tagName === "IMG") {
        const srcset = node.getAttribute("data-srcset") || node.getAttribute("srcset") || "";
        const best = srcset.split(",")
          .map((entry) => {
            const parts = entry.trim().split(/\\s+/);
            const href = abs(parts[0] || "");
            const descriptor = parts[1] || "";
            const scale = descriptor.endsWith("x") ? Number.parseFloat(descriptor) || 1 : 1;
            return { href, scale };
          })
          .filter((item) => item.href && !/(?:logo|favicon|sprite|icon|avatar|flag|placeholder|blank|transparent|play|spinner)/i.test(item.href))
          .sort((a, b) => b.scale - a.scale)[0]?.href || "";
        if (best) return best;
        return abs(imageUrl(node));
      }
      return abs(
        node.getAttribute("data-bg")
        || node.getAttribute("data-background")
        || node.getAttribute("data-image")
        || styleImageUrl(node)
      );
    };
    const filmoMainImage = () => {
      const metaHref = abs(imageMeta && imageMeta.getAttribute("content"));
      const nodes = [
        ...Array.from(document.querySelectorAll("main img, article img, [class*='hero'] img, [class*='detail'] img, [class*='cover'] img, [class*='poster'] img")),
        ...Array.from(document.querySelectorAll("main [style*='background-image'], article [style*='background-image'], [class*='hero'][style*='background-image'], [class*='detail'][style*='background-image'], [class*='cover'][style*='background-image'], [class*='poster'][style*='background-image']"))
      ];
      const seen = new Set();
      let best = "";
      let bestScore = 0;
      const badContext = (node) => {
        let current = node;
        for (let depth = 0; current && depth < 7; depth += 1) {
          const label = String(current.className || "") + " " + String(current.id || "");
          if (/(?:recommend|similar|carousel|slider|popular|beliebt|entdecken)/i.test(label)) return true;
          let sibling = current.previousElementSibling;
          for (let count = 0; sibling && count < 4; count += 1) {
            if (/(?:das schauen andere|schauen andere|empfehlungen|aehnliche|ähnliche|beliebt|entdecken|kinder|familienfilme|neu veröffentlicht|neu veroeffentlicht|mehr anzeigen|kommentare)/i.test(sibling.textContent || "")) return true;
            sibling = sibling.previousElementSibling;
          }
          current = current.parentElement;
        }
        return false;
      };
      const add = (href, context, baseScore) => {
        if (!href || seen.has(href)) return;
        seen.add(href);
        if (/(?:logo|favicon|sprite|icon|avatar|flag|placeholder|blank|transparent|play|spinner|language|rating)/i.test(href)) return;
        const combined = normalizeText(context + " " + href);
        const overlap = expectedTokens.filter((token) => combined.includes(token)).length;
        if (expectedTokens.length && overlap === 0) return;
        let score = baseScore + overlap * 650;
        if (/\\.(?:jpg|jpeg|png|webp)(?:\\?|$)/i.test(href)) score += 80;
        if (mediaSlug && href.toLowerCase().includes(mediaSlug)) score += 500;
        if (score > bestScore) {
          bestScore = score;
          best = href;
        }
      };

      add(metaHref, String(document.title || "") + " " + mediaSlug, 2100);
      for (const node of nodes) {
        const href = filmoImageUrl(node);
        if (!href || badContext(node)) continue;
        const rect = node.getBoundingClientRect();
        const width = node.naturalWidth || rect.width || 0;
        const height = node.naturalHeight || rect.height || 0;
        if (node.tagName === "IMG" && (width < 90 || height < 90)) continue;
        const context = imageText(node) + " " + nearbyText(node, 8) + " " + (document.querySelector("h1")?.textContent || "");
        let score = 1200;
        if (/hero|detail|cover|poster|backdrop|title|movie|film/i.test(imageText(node))) score += 320;
        if (rect.top >= -120 && rect.top < Math.max(900, innerHeight * 1.2)) score += 180;
        add(href, context, score);
      }
      return best || "";
    };
    if (isStoPage) {
      const infoPanelPoster = stoInfoPanelImage();
      if (infoPanelPoster) {
        return {
          title: mediaTitle(),
          type: activeMediaType(),
          favicon: abs(icon && icon.getAttribute("href")),
          thumbnail: infoPanelPoster,
          ...seriesBounds
        };
      }

      return {
        title: mediaTitle(),
        type: activeMediaType(),
        favicon: abs(icon && icon.getAttribute("href")),
        thumbnail: "",
        ...seriesBounds
      };
    }
    if (isFilmoPage) {
      return {
        title: mediaTitle(),
        type: activeMediaType(),
        favicon: abs(icon && icon.getAttribute("href")),
        thumbnail: filmoMainImage(),
        ...seriesBounds
      };
    }
    if (isAniWorldPage) {
      return {
        title: mediaTitle(),
        type: activeMediaType(),
        favicon: abs(icon && icon.getAttribute("href")),
        thumbnail: aniWorldMainImage(),
        ...seriesBounds
      };
    }
    pushCandidate(imageMeta && imageMeta.getAttribute("content"), 70);
    for (const img of Array.from(document.images || [])) {
      const href = imageUrl(img);
      if (!href) continue;
      const rect = img.getBoundingClientRect();
      const width = img.naturalWidth || rect.width || 0;
      const height = img.naturalHeight || rect.height || 0;
      const text = imageText(img);
      const lower = text.toLowerCase();
      const urlLower = String(href).toLowerCase();
      const combined = lower + " " + urlLower;
      if (/(?:logo|favicon|sprite|icon|avatar|flag|language|rating|play|spinner)/i.test(combined)) continue;
      if (width < 90 || height < 90) continue;
      const ratio = width / Math.max(1, height);
      let score = Math.min(45, Math.round(Math.max(width, height) / 18));
      if (isStoPage) {
        if (rect.left > innerWidth * 0.45 && ratio > 0.42 && ratio < 0.92) score += 220;
        if (ratio >= 1.15 || rect.left < innerWidth * 0.35) score -= 180;
      }
      if (/cover|poster|series?|serie|film|movie|anime|stream|title|thumbnail|teaser/i.test(combined)) score += 52;
      if (ratio > 0.48 && ratio < 0.86) score += 34;
      if (ratio >= 0.86 && ratio < 1.9) score += 16;
      if (rect.top >= -80 && rect.top < Math.max(900, innerHeight * 1.4)) score += 12;
      pushCandidate(href, score);
    }
    candidates.sort((a, b) => b.score - a.score);
    return {
      title: mediaTitle(),
      type: activeMediaType(),
      favicon: abs(icon && icon.getAttribute("href")),
      thumbnail: candidates[0]?.href || "",
      ...seriesBounds
    };
  })()`, true);
}

function cleanTitle(value) {
  const title = String(value || "").replace(/\s+/g, " ").trim();
  return title || "Favorit";
}

function favoriteMatchesCurrentProviderTitle(favorite, provider, url, normalized = normalizeFavoriteUrl(url), requestedType = "") {
  if (!favorite || !provider) return false;
  const sameProvider = favorite.providerId === provider.id || favorite.providerName === provider.name;
  if (!sameProvider) return false;
  const favoriteType = normalizeMediaType(favorite.type) || inferMediaType(favorite.url || "");
  if (requestedType && favoriteType && favoriteType !== "unknown" && favoriteType !== requestedType) return false;
  if (favorite.normalizedUrl === normalized || normalizeFavoriteUrl(favorite.url) === normalized) return true;
  return favoriteReplacementKey(favorite.url, provider, favoriteType) === favoriteReplacementKey(url, provider, requestedType);
}

function favoriteReplacementKey(url, provider, type = "") {
  const providerKey = String(provider?.id || provider?.name || providerModel.hostFromUrl(provider?.startUrl || url) || "")
    .toLowerCase()
    .trim();
  const slug = mediaSlugFromUrl(url);
  const mediaType = normalizeMediaType(type) || inferMediaType(url);
  return `${providerKey}:${mediaType || "unknown"}:${slug || normalizeFavoriteUrl(url)}`;
}

function sanitizePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function sanitizeProgress(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function isCompletedProgress(value) {
  return sanitizeProgress(value) >= COMPLETED_PROGRESS_PERCENT;
}

function inferMediaType(value) {
  try {
    const parts = new URL(value).pathname.split("/").map((part) => part.toLowerCase());
    if (parts.some((part) => ["film", "filme", "movie", "movies"].includes(part))) return "film";
    if (parts.some((part) => ["serie", "series", "anime"].includes(part))) return "serie";
  } catch {
    // Ignore malformed URLs.
  }
  return "unknown";
}

function mediaSlugFromUrl(value) {
  try {
    const parts = new URL(value).pathname.split("/").filter(Boolean);
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index].toLowerCase();
      if (part === "anime" && parts[index + 1]?.toLowerCase() === "stream" && parts[index + 2]) {
        const slug = parts[index + 2].toLowerCase();
        const filmIndex = parts.findIndex((item, itemIndex) => itemIndex > index + 2 && /^(?:film|filme|movie|movies)$/i.test(item));
        if (filmIndex >= 0) {
          return `${slug}:filme:${(parts[filmIndex + 1] || "index").toLowerCase()}`;
        }
        const filmPart = parts.find((item, itemIndex) => itemIndex > index + 2 && /^(?:film|movie)-\d+$/i.test(item));
        return filmPart ? `${slug}:filme:${filmPart.toLowerCase()}` : slug;
      }
      if ((part === "serie" || part === "series") && parts[index + 1]?.toLowerCase() === "stream" && parts[index + 2]) {
        return parts[index + 2].toLowerCase();
      }
      if (["stream", "serie", "series", "film", "filme", "movie", "movies", "title", "watch"].includes(part) && parts[index + 1]) {
        return parts[index + 1].toLowerCase();
      }
    }
    return "";
  } catch {
    return "";
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

function loadFilterCache() {
  try {
    const cache = JSON.parse(fs.readFileSync(FILTER_CACHE_FILE, "utf8"));
    adblock.load(cache);
  } catch {
    adblock.load({ domains: defaultAdDomains(), trackers: defaultTrackerDomains(), rules: [] });
  }
}

function saveFilterCache() {
  ensureDataDir();
  fs.writeFileSync(FILTER_CACHE_FILE, JSON.stringify(adblock.serialize(), null, 2));
}

async function updateFilterLists() {
  const texts = [];
  for (const list of ADGUARD_FILTER_LISTS) {
    const response = await fetch(list.url);
    if (!response.ok) {
      throw new Error(`Filterliste konnte nicht geladen werden: ${list.name}`);
    }
    texts.push(await response.text());
  }

  adblock.parseLists(texts);
  settings.adblock.lastUpdated = new Date().toISOString();
  saveFilterCache();
  saveSettings();
  return { ruleCount: adblock.ruleCount(), lastUpdated: settings.adblock.lastUpdated };
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
    playback: {
      pauseOnProviderSwitch: raw?.playback?.pauseOnProviderSwitch ?? defaults.playback.pauseOnProviderSwitch,
      favoriteProgressMode: sanitizeChoice(raw?.playback?.favoriteProgressMode, ["sequential", "static"], defaults.playback.favoriteProgressMode),
      pauseOnMinimize: migrateBackgroundAudio ? defaults.playback.pauseOnMinimize : raw?.playback?.pauseOnMinimize ?? defaults.playback.pauseOnMinimize,
      pauseOnBlur: migrateBackgroundAudio ? defaults.playback.pauseOnBlur : raw?.playback?.pauseOnBlur ?? defaults.playback.pauseOnBlur
    },
    browser: {
      cacheMode: sanitizeChoice(raw?.browser?.cacheMode, ["normal", "clearOnStart", "aggressive"], defaults.browser.cacheMode)
    },
    home: {
      showHero: raw?.home?.showHero ?? raw?.appearance?.showHero ?? defaults.home.showHero,
      showProviders: raw?.home?.showProviders ?? defaults.home.showProviders,
      showFavorites: raw?.home?.showFavorites ?? defaults.home.showFavorites,
      providerCardMeta: sanitizeChoice(raw?.home?.providerCardMeta, ["logoName", "logo", "name"], defaults.home.providerCardMeta)
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
    playback: {
      pauseOnProviderSwitch: true,
      favoriteProgressMode: "sequential",
      pauseOnMinimize: false,
      pauseOnBlur: false
    },
    browser: {
      cacheMode: "aggressive"
    },
    home: {
      showHero: true,
      showProviders: true,
      showFavorites: true,
      providerCardMeta: "logoName"
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

function logBlocked(details, provider, rule) {
  blockedRequests.push({
    time: new Date().toLocaleTimeString(),
    provider: provider.name,
    type: details.resourceType,
    url: details.url,
    rule
  });
  if (blockedRequests.length > MAX_BLOCK_LOG) {
    blockedRequests.shift();
  }
  sendBlockedRequests();
}

function logBlockedUrl(url, provider, rule, type) {
  blockedRequests.push({
    time: new Date().toLocaleTimeString(),
    provider: provider?.name || "Unbekannt",
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

function defaultAdDomains() {
  return [
    "doubleclick.net",
    "googlesyndication.com",
    "googleadservices.com",
    "adservice.google.com",
    "adsystem.com",
    "taboola.com",
    "outbrain.com",
    "scorecardresearch.com",
    "adnxs.com",
    "pubmatic.com",
    "rubiconproject.com",
    "criteo.com",
    "zedo.com",
    "popads.net",
    "popcash.net",
    "onclickads.net",
    "propellerads.com",
    "propeller-tracking.com",
    "adsterra.com",
    "exoclick.com",
    "trafficjunky.net",
    "juicyads.com",
    "hilltopads.net"
  ];
}

function defaultTrackerDomains() {
  return [
    "google-analytics.com",
    "googletagmanager.com",
    "facebook.net",
    "facebook.com",
    "hotjar.com",
    "mixpanel.com",
    "segment.io",
    "clarity.ms",
    "amplitude.com"
  ];
}

class FilterEngine {
  constructor() {
    this.domains = new Set(defaultAdDomains());
    this.trackers = new Set(defaultTrackerDomains());
    this.substringRules = [];
  }

  load(cache) {
    this.domains = new Set([...sanitizeCachedRules(cache?.domains), ...defaultAdDomains()]);
    this.trackers = new Set([...sanitizeCachedRules(cache?.trackers), ...defaultTrackerDomains()]);
    this.substringRules = Array.isArray(cache?.rules) ? cache.rules.slice(0, 3000) : [];
  }

  serialize() {
    return {
      domains: [...this.domains],
      trackers: [...this.trackers],
      rules: this.substringRules
    };
  }

  parseLists(texts) {
    const domains = new Set(defaultAdDomains());
    const trackers = new Set(defaultTrackerDomains());
    const rules = [];

    for (const text of texts) {
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("!") || line.startsWith("[") || line.startsWith("@@")) continue;
        if (line.includes("$document") || line.includes("$generichide") || line.includes("$elemhide")) continue;

        const domainMatch = line.match(/^\|\|([a-z0-9.-]+)\^?(?:[$/]|$)/i);
        if (domainMatch) {
          const domain = domainMatch[1].replace(/^\.+|\.+$/g, "").toLowerCase();
          if (domain.includes(".") && domain.length < 120 && isLikelyAdOrTrackerRule(line, domain)) {
            if (line.includes("track") || line.includes("privacy")) trackers.add(domain);
            else domains.add(domain);
          }
          continue;
        }

        if (line.startsWith("/") || line.includes("##") || line.includes("#@#")) continue;
        const cleaned = line.replace(/[|^*]/g, "").split("$")[0].trim();
        if (cleaned.length >= 8 && cleaned.length <= 100 && !cleaned.includes("{")) {
          rules.push(cleaned);
        }
      }
    }

    this.domains = domains;
    this.trackers = trackers;
    this.substringRules = [...new Set(rules)].slice(0, 5000);
  }

  ruleCount() {
    return this.domains.size + this.trackers.size + this.substringRules.length;
  }

  shouldBlock(details, activeSettings, provider) {
    let hostname;
    try {
      hostname = new URL(details.url).hostname.toLowerCase();
    } catch {
      return { block: false };
    }

    if (isChallengeOrVerificationUrl(details.url, provider)) {
      return { block: false };
    }

    if (isWhitelisted(hostname, activeSettings.adblock.whitelist) || isProviderFirstParty(hostname, provider)) {
      return { block: false };
    }

    if (isPageCriticalResource(details.resourceType)) {
      return { block: false };
    }

    const domainRule = findDomainRule(hostname, this.domains);
    if (domainRule) return { block: true, rule: domainRule };

    const thirdParty = isThirdParty(details, provider);
    if (activeSettings.adblock.trackingProtection && thirdParty) {
      const trackerRule = findDomainRule(hostname, this.trackers);
      if (trackerRule) return { block: true, rule: trackerRule };
    }

    const lowerUrl = details.url.toLowerCase();
    if (allowsSubstringBlocking(details.resourceType)) {
      for (const rule of this.substringRules) {
        if (lowerUrl.includes(rule.toLowerCase())) {
          return { block: true, rule };
        }
      }
    }

    return { block: false };
  }
}

function sanitizeCachedRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules
    .map((rule) => String(rule || "").trim().toLowerCase())
    .filter((rule) => rule.includes(".") && rule.length < 120 && isLikelyAdOrTrackerRule(rule, rule));
}

function isPageCriticalResource(resourceType) {
  return ["image", "stylesheet", "font", "media"].includes(resourceType || "");
}

function allowsSubstringBlocking(resourceType) {
  return ["popup", "ping", "cspReport"].includes(resourceType || "");
}

function isLikelyAdOrTrackerRule(line, domain) {
  const value = `${domain} ${line}`.toLowerCase();
  return /(^|[_.-])(ad|ads|adv|advert|analytics|beacon|click|metric|pixel|pop|promo|sponsor|stat|track|tracker|tracking)([_.-]|$)/.test(value)
    || value.includes("doubleclick")
    || value.includes("googlesyndication")
    || value.includes("googleadservices");
}

function findDomainRule(hostname, rules) {
  for (const rule of rules) {
    if (hostname === rule || hostname.endsWith(`.${rule}`)) {
      return rule;
    }
  }
  return "";
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

function isThirdParty(details, provider) {
  try {
    const targetHost = new URL(details.url).hostname;
    return !isProviderFirstParty(targetHost, provider);
  } catch {
    return true;
  }
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
