const { app, BrowserWindow, Menu, WebContentsView, ipcMain, net, session, shell, dialog } = require("electron");
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
  extractRelatedItems
} = require("./discover");
const taste = require("./taste");
const { WatchpartyRaeume, raumcodesAufraeumen } = require("./watchparty-raeume");
const providerModel = require("../shared/provider-model");

const LEGACY_DATA_DIR = path.join(app.getPath("appData"), "GlobalSearchHub");
const DATA_DIR = path.join(app.getPath("appData"), "ELFIX");
const PROVIDER_FILE = path.join(DATA_DIR, "providers.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const FILTER_CACHE_FILE = path.join(DATA_DIR, "filter-cache.json");
const FAVORITES_FILE = path.join(DATA_DIR, "favorites.json");
const TASTE_FILE = path.join(DATA_DIR, "taste-cache.json");
const WATCHPARTY_FILE = path.join(DATA_DIR, "watchparty.json");
const SESSION_PARTITION = "persist:streaming-browser";
const MAX_BLOCK_LOG = 400;
const MAX_MEDIA_LOG = 300;
const SETTINGS_SCHEMA_VERSION = 4;
const CACHE_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const MIN_WATCH_TIME_SECONDS = 2.5 * 60;
// In einer Watchparty gilt eine kuerzere Schwelle: dort schauen mehrere
// dieselbe Folge, und die Runde soll nicht minutenlang die vorige anzeigen.
// Nach einer halben Minute steht fest, dass diese Folge wirklich laeuft.
const WATCHPARTY_MIN_WATCH_SECONDS = 30;
// Zurueck auf eine aeltere Folge: kurzes Reinschauen soll den Stand nicht
// zerstoeren, eine Minute bewusstes Schauen aber schon.
const BACKWARD_WATCH_TIME_SECONDS = 60;
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
// Ein Sprungwunsch verfaellt, wenn die Folge nicht bald startet.
const WATCHPARTY_SPRUNG_GUELTIG_MS = 3 * 60 * 1000;
// Im Normalfall meldet die Seite selbst, sobald sich etwas tut. Dieser Takt ist
// nur die Rueckfallebene, falls sich das Melde-Skript nicht einhaengen konnte.
const WATCHPARTY_STAND_INTERVALL_MS = 5000;
const nextEpisodePromptState = new Map();
const nextEpisodeAutostartState = new Map();
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
// So lange gilt dieselbe Folge als derselbe Vorgang im Verlauf.
const AKTIVITAET_ZUSAMMEN_MS = 60 * 60 * 1000;
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
const TASTE_HISTORY_SIZE = 12;
const TASTE_ENRICH_LIMIT = 18;
// So viele Titel je Anbieter zeigt bereits die Reihe "Neu bei deinen Anbietern".
const TASTE_NEW_OFFSET = 6;
const TASTE_FETCH_PARALLEL = 4;
let tasteCache = null;
let tasteSaveTimer = 0;
let personalPending = null;
let personalCache = { at: 0, items: [] };
const PERSONAL_CACHE_MS = 15 * 60 * 1000;
const PERSONAL_POOL_SIZE = 150;
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
  // Einmalig: eigene Bilder aus der Zeit nachziehen, als sie nur an einer
  // einzelnen Kachel hingen.
  if (verteileEigeneBilder(favorites)) saveFavorites();
  settings = loadSettings();
  saveSettings();
  watchpartyLokal = loadWatchpartyLocal();
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
  syncWatchparty();
  // Laeuft nebenher: fuer die Reparatur wird je Staffel eine Seite geladen.
  repairStalledSeriesFavorites().catch(() => {});
  // Die Leiste lebt davon, dass jeder laufend sagt, wo er steht.
  setInterval(() => { meldeWatchpartyStand().catch(() => {}); }, WATCHPARTY_STAND_INTERVALL_MS).unref?.();
  // Werbefilter: fehlende oder alte Listen nachladen, ohne den Start zu bremsen.
  setTimeout(() => ensureFilterLists().catch((fehler) => {
    console.log(`[ELFIX ADBLOCK] Listen konnten nicht geholt werden: ${fehler?.message || fehler}`);
  }), 4000).unref?.();
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

    // Die Wiedergabe darf der Filter nicht zerlegen - aber nur, was wirklich
    // dazugehoert. Frueher genuegte "video", "stream" oder "player" irgendwo
    // in der Adresse; damit lief jedes Werbenetz mit passendem Pfad ungeprueft
    // durch, egal welche Liste geladen war.
    if (details.resourceType !== "popup" && istWiedergabeAnfrage(details.url, provider)) {
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

ipcMain.handle("discover:personal", async (_event, options = {}) => {
  const limit = sanitizeNumber(options?.limit, 6, 40, 24);
  const type = sanitizeChoice(options?.type, ["anime", "serie", "film"], "");
  return collectPersonalRecommendations(limit, Boolean(options?.refresh), type, options?.excludeMain !== false);
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
ipcMain.handle("favorites:add-result", (_event, treffer) => {
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
    return { favorites, added: true, already: schonDabei, title: vorhanden.title };
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
  saveFavorites();
  sendActiveState();
  console.log(`[ELFIX] ${favorite.title} aus der Suche auf die Watchlist genommen`);
  return { favorites, added: true, already: false, title: favorite.title };
});

// Eigenes Bild fuer einen Titel. Es liegt als Data-URL am Eintrag: die
// Oberflaeche hat es vorher auf eine vernuenftige Groesse gebracht, damit die
// Ablage nicht mit Megabytes vollaeuft.
ipcMain.handle("favorites:set-image", (_event, favoriteId, dataUrl) => {
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
  for (const eintrag of betroffen) eintrag.customThumbnail = bild;
  saveFavorites();
  sendActiveState();
  console.log(`[ELFIX] ${favorite.title}: eigenes Bild ${bild ? "gesetzt" : "entfernt"} (${betroffen.length} Eintraege)`);
  return { favorites, saved: true, hasImage: Boolean(bild), entries: betroffen.length };
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

ipcMain.handle("favorites:open", async (_event, favoriteId, options = {}) => {
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
ipcMain.handle("watchparty:switch-context", async (_event, punkt) => {
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
});

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

ipcMain.handle("watchparty:kick", (_event, key, memberId, room) => {
  watchparty.rauswerfen(String(key || ""), String(memberId || ""), String(room || ""));
  return true;
});

ipcMain.handle("settings:save", (_event, nextSettings) => {
  settings = normalizeSettings(nextSettings);
  saveSettings();
  syncAutomaticCacheCleanup();
  syncWatchparty();
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
  view.webContents.on("enter-html-full-screen", () => markContentFullscreen(true));
  view.webContents.on("leave-html-full-screen", () => markContentFullscreen(false));
  view.webContents.on("before-input-event", (event, input) => {
    if (input.key === "Escape" && isContentFullscreen) {
      event.preventDefault();
      leaveContentFullscreen();
    }
  });
  // Rueckkanal des "Naechste Folge"-Knopfes aus der Anbieterseite.
  view.webContents.on("console-message", (...args) => {
    const nachricht = typeof args[0] === "object" && args[0] !== null && "message" in args[0]
      ? args[0].message
      : args[1];
    // Wo dieses Geraet steht. Kommt aus der Seite, sobald sich etwas aendert -
    // deshalb sehen die anderen eine Pause ohne Umweg ueber einen Zeitgeber.
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
    // Neue Seite: der Merker fuers Anhaengen gilt nicht mehr - wer die Folge
    // erneut betritt, gleicht wieder mit dem Host ab.
    watchpartyAngeklinkt.clear();
    meldeWatchpartyFolgenwechsel(url);
    pushWatchpartyLiveState(url);
    nextEpisodePromptState.delete(provider.id);
    // Merker loeschen, sonst wechselt eine erneut angesehene Folge nicht mehr.
    nextEpisodeAutostartState.delete(provider.id);
    resumePendingProviderAutoplay(provider, view);
  });
  view.webContents.on("did-navigate-in-page", (_event, url) => {
    rememberProviderUrl(provider.id, url);
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
  // Steht ein Sprung aus der Watchparty an, wird er eingeloest, sobald das
  // Video wirklich laeuft.
  await applyWatchpartySeek(provider, view, progress).catch(() => {});
  await installWatchpartyControls(provider, view, url).catch(() => {});
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
  if (amEnde && naechste) {
    if (nextEpisodeAutostartState.get(provider.id) !== url) {
      nextEpisodeAutostartState.set(provider.id, url);
      nextEpisodePromptState.set(provider.id, "countdown");
      installNextEpisodePrompt(view, naechste, { countdown: NEXT_EPISODE_COUNTDOWN_SECONDS });
    }
    if (reason !== "poll" || entry.completed) sendActiveState();
    return;
  }

  // Davor nur der Knopf. Nur bei Aenderung einspielen, sonst liefe alle
  // 5 Sekunden ein Script durch saemtliche Frames der Seite.
  const gewuenscht = fastFertig && naechste ? naechste : "";
  if (nextEpisodePromptState.get(provider.id) !== gewuenscht) {
    nextEpisodePromptState.set(provider.id, gewuenscht);
    installNextEpisodePrompt(view, gewuenscht);
  }

  if (reason !== "poll" || entry.completed) sendActiveState();
}

// Der Knopf lebt in der Anbieterseite, weil deren View im Vollbild alles
// ueberdeckt. Er meldet den Klick ueber eine Konsolenzeile zurueck - ohne
// Preload gibt es in einer fremden Seite keinen anderen Kanal.
function installNextEpisodePrompt(view, url, options = {}) {
  if (!isLiveView(view)) return;
  const script = `(() => {
    const ziel = ${JSON.stringify(String(url || ""))};
    const countdown = ${Number(options.countdown) || 0};
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

      karte.__haupt = haupt;
      karte.__abbrechen = abbrechen;
      karte.append(haupt, abbrechen);
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

    if (countdown > 0 && !karte.__timer && karte.dataset.abgebrochen !== "ja") {
      // Feste Zielzeit statt Zaehlschritte: ein Intervall driftet, und der
      // Wechsel kaeme sonst spuerbar spaeter als angekuendigt.
      const ende = Date.now() + countdown * 1000;
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
      return "countdown@" + location.hostname;
    }

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
    const muster = new RegExp("\\\\/(?:episode|folge)-" + (current + 1) + "(?:[/?#]|$)", "i");
    const treffer = anchors.find((anchor) => muster.test(abs(anchor.getAttribute("href"))));
    return treffer ? abs(treffer.getAttribute("href")) : "";
  })()`).catch(() => "");
  return typeof link === "string" ? link : "";
}

// Gilt fuer beide Wege gleich: Knopf gedrueckt oder Folge durchgelaufen. Die
// naechste Folge wird geladen, gestartet und ins Vollbild gebracht - derselbe
// Ablauf wie beim Start aus "Weiterschauen".
async function playNextEpisode(provider, view, url) {
  if (!provider || !isLiveView(view)) {
    logNextEpisode(provider, "abgebrochen - keine lebende Ansicht");
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
    logBlockedUrl(url, provider, "site-lock", "navigation");
    return true;
  }
  if (streng && istPopupNavigation(url, provider)) {
    logBlockedUrl(url, provider, "popup:navigation", "popup");
    return true;
  }
  if (!settings.adblock.blockRedirects) return false;
  const decision = shouldBlockTarget(url, provider, "mainFrame");
  if (!decision.block) return false;
  logBlockedUrl(url, provider, `redirect:${decision.rule}`, "redirect");
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
  return istVerifizierungsFenster(url, provider);
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

// Gehoert diese Anfrage zum Abspielen? Nur der Anbieter selbst, die bekannten
// Hoster und die Videodateien - sonst nichts. Das haelt den Player am Laufen,
// ohne den Filter fuer alles andere auszuhebeln.
function istWiedergabeAnfrage(url, provider) {
  if (!providerModel.isHttpUrl(url)) return false;
  if (isKnownVideoHosterUrl(url)) return true;
  if (isProviderFirstParty(providerModel.hostFromUrl(url), provider)) return true;
  return /\.(m3u8|mpd|mp4|webm|ts)(\?|$)/i.test(url);
}


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
  // Von Hand abgehakte Serien bleiben in der Mediathek, auch wenn man sie
  // noch einmal ansieht. Zurueck holt sie nur, was wirklich neu ist.
  if (!favorite.completedManually) favorite.completed = false;
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
  // Denselben Titel kann es mehrfach geben - einmal privat und je Watchparty
  // einmal. Dann entscheidet der gerade geoeffnete Eintrag, wohin der
  // Fortschritt laeuft; ohne das traefe es immer den erstbesten.
  const geoeffnet = activeFavoriteId ? favorites.find((favorite) => favorite.id === activeFavoriteId) : null;
  const existing = options.existing
    || (geoeffnet && favoriteMatchesCurrentProviderTitle(geoeffnet, provider, url, normalized, requestedType) ? geoeffnet : null)
    || favorites.find((favorite) => favoriteMatchesCurrentProviderTitle(favorite, provider, url, normalized, requestedType));
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
  // Ueber 90 Prozent allein macht eine Folge nicht zur gesehenen: es muss auch
  // wirklich geschaut worden sein. Wer hineinspringt und den Regler ans Ende
  // zieht, kommt sonst in einer Sekunde ans Serienende. Beides muss zusammen
  // erfuellt sein - dieselbe Wartezeit wie fuer jeden anderen Stand.
  const mediaEnded = (Boolean(meta.completed) || isCompletedProgress(progressPercent))
    && watchedSeconds >= endeSchwelle(meta.duration);
  const startsAtFirstEpisode = isFirstEpisodeIdentity(identity);
  const isFilmProgress = requestedType === "film";
  const qualifiesForPrimaryProgress = mediaEnded || isFilmProgress || startsAtFirstEpisode || watchedSeconds >= uebernahmeSchwelle(existing);

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
  const nextContinueUrl = shouldAdvanceEpisode ? nextEpisodeContinueUrl(url, meta.nextUrl, entry, meta) : "";
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
  reportWatchpartyProgress(entry);
  return entry;
}

// Steht dieser Eintrag in "Weiterschauen"? Nur "gesehen" und "ausgeblendet"
// nehmen ihn heraus - nicht die Prozentzahl. Eine Folge, die weit vorne steht,
// aber mangels Wiedergabezeit nicht als gesehen zaehlt, ist weiter offen.
function hasContinueProgressRecord(entry) {
  if (!entry || entry.completed || entry.episodeCompleted || entry.hideFromContinueWatching) return false;
  if (entry.continuePending) return true;
  const current = sanitizePositiveNumber(entry.currentTime || entry.position);
  const duration = sanitizePositiveNumber(entry.duration);
  if (duration > 0 && current > 0 && current <= duration + 3) return true;
  const progress = sanitizeProgress(entry.progress);
  return Boolean(entry.lastWatchedAt || entry.openedAt) && progress > 0;
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

// Wie lange muss geschaut sein, bevor ein Eintrag auf eine neue Folge rueckt?
// In einer Runde reicht eine halbe Minute, sonst bleiben es zweieinhalb.
function uebernahmeSchwelle(existing) {
  return existing?.watchpartyRoom ? WATCHPARTY_MIN_WATCH_SECONDS : MIN_WATCH_TIME_SECONDS;
}

function shouldPromoteMediaProgress(existing, url, progressState) {
  if (!progressState?.hasMediaProgress) return true;
  if (progressState.isFilmProgress) return true;
  if (progressState.startsAtFirstEpisode) return true;
  // Laeuft diese Folge gerade in der Watchparty, ist sie gewollt - egal ob
  // vor oder zurueck. Sonst haengt der eigene Eintrag minutenlang hinter der
  // Gruppe her, obwohl alle dieselbe Folge schauen.
  if (watchpartyGibtFolgeVor(url)) return true;
  if (!existing) return progressState.mediaEnded || progressState.watchedSeconds >= uebernahmeSchwelle(existing);

  const nextIdentity = episodeIdentity(url);
  const currentIdentity = episodeIdentity(existing.url);
  if (!nextIdentity || !currentIdentity || nextIdentity.key !== currentIdentity.key) {
    if (normalizeFavoriteUrl(existing.url) === normalizeFavoriteUrl(url)) {
      return hasContinueProgressRecord(existing) || progressState.mediaEnded || progressState.watchedSeconds >= uebernahmeSchwelle(existing);
    }
    return progressState.mediaEnded || progressState.watchedSeconds >= uebernahmeSchwelle(existing);
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
      return progressState.mediaEnded || progressState.watchedSeconds >= uebernahmeSchwelle(existing);
    }
    // Ohne Watchparty braucht es bewusstes Schauen. Frueher wurde eine aeltere Folge
    // grundsaetzlich nie uebernommen: der Eintrag liess sich nur ueber Umwege
    // zurueckstellen.
    return progressState.mediaEnded || progressState.watchedSeconds >= BACKWARD_WATCH_TIME_SECONDS;
  }
  if (comparison === 0) {
    return hasContinueProgressRecord(existing) || progressState.mediaEnded || progressState.watchedSeconds >= uebernahmeSchwelle(existing);
  }
  return progressState.mediaEnded || progressState.watchedSeconds >= uebernahmeSchwelle(existing);
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
    console.log(`[ELFIX NEU] ${favorite.title}: ${favorite.newEpisodeLabel}`);
  }

  if (!geaendert) return;
  saveFavorites();
  sendActiveState();
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

function nextEpisodeContinueUrl(currentUrl, preferredUrl = "", entry = null, meta = null) {
  const currentIdentity = episodeIdentity(currentUrl);
  const resolvedPreferred = absoluteHttpUrl(preferredUrl, currentUrl);
  const preferredIdentity = episodeIdentity(resolvedPreferred);
  const gesperrt = unplayableEpisodeSet(meta, currentIdentity?.season);
  if (resolvedPreferred
    && preferredIdentity
    && currentIdentity
    && preferredIdentity.key === currentIdentity.key
    && !gesperrt.has(preferredIdentity.episode)
    && compareEpisodeIdentity(preferredIdentity, currentIdentity) > 0) {
    return resolvedPreferred;
  }
  if (!currentIdentity) return "";
  const finalSeason = sanitizePositiveNumber(entry?.finalSeason);
  const finalEpisode = sanitizePositiveNumber(entry?.finalEpisode);
  if (!finalSeason) return "";
  if (currentIdentity.season > finalSeason) return "";

  // In der letzten Staffel endet die Serie mit der letzten Folge. In frueheren
  // Staffeln endet nur die Staffel - danach geht es mit Folge 1 der naechsten
  // weiter. Fehlt die Folgenzahl der laufenden Staffel noch, wird einfach
  // hochgezaehlt; die Staffeluebersicht liefert sie kurz darauf nach.
  const istLetzteStaffel = currentIdentity.season === finalSeason;
  // Nur in der letzten Staffel entscheidet diese Zahl darueber, ob ueberhaupt
  // noch etwas kommt. Vorher ist sie ohne Belang: wer in Staffel 1 von 25
  // steht, hat sicher eine naechste Folge. Frueher blockierte sie jedes
  // Nachruecken, solange die letzte Staffel nie geoeffnet worden war.
  if (istLetzteStaffel && !finalEpisode) return "";
  const staffelEnde = istLetzteStaffel
    ? finalEpisode
    : sanitizePositiveNumber(meta?.seasonLastEpisode);

  // Zusammengefasste Folgen ueberspringen: steht die naechste Nummer nur als
  // Hinweis in der Liste ("[In E10 enthalten]"), gibt es dort nichts
  // abzuspielen - also weiter bis zur naechsten echten Folge.
  let naechste = currentIdentity.episode + 1;
  while (gesperrt.has(naechste) && (!staffelEnde || naechste <= staffelEnde)) naechste += 1;

  if (!staffelEnde || naechste <= staffelEnde) {
    return replaceEpisodeUrl(currentUrl, currentIdentity.season, naechste) || incrementEpisodeUrl(currentUrl);
  }
  if (currentIdentity.season < finalSeason) {
    return replaceEpisodeUrl(currentUrl, currentIdentity.season + 1, 1);
  }
  return "";
}

// Die Seite meldet die nicht abspielbaren Folgen der gerade gezeigten Staffel.
function unplayableEpisodeSet(meta, season) {
  const nummern = Array.isArray(meta?.unplayableEpisodes) ? meta.unplayableEpisodes : [];
  const gemeldeteStaffel = sanitizePositiveNumber(meta?.unplayableSeason);
  if (!nummern.length) return new Set();
  if (season && gemeldeteStaffel && season !== gemeldeteStaffel) return new Set();
  return new Set(nummern.map((wert) => Number(wert)).filter((wert) => Number.isFinite(wert) && wert > 0));
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

// Wie lange gesehen werden muss, damit eine Folge ueber 90 Prozent als
// geschaut gilt: 2:30 Minuten - bei kuerzeren Folgen entsprechend weniger,
// sonst liesse sich ein Zehnminueter nie abschliessen.
function endeSchwelle(duration) {
  const laufzeit = sanitizePositiveNumber(duration);
  if (!laufzeit) return MIN_WATCH_TIME_SECONDS;
  return Math.min(MIN_WATCH_TIME_SECONDS, laufzeit * 0.9);
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
  const text = label || mediaActivityLabel(url, entry);
  const letzter = activity[activity.length - 1];

  // Derselbe Vorgang in kurzer Folge ist kein neuer Eintrag. Der Fortschritt
  // meldet sich im Sekundentakt, und der Verlauf lief mit Dutzenden gleichen
  // Zeilen voll - dieselbe Folge, dieselbe Minute. Stattdessen wird der
  // vorhandene Eintrag weitergeschrieben.
  if (letzter
    && letzter.url === url
    && letzter.label === text
    && Date.now() - (Date.parse(letzter.at) || 0) < AKTIVITAET_ZUSAMMEN_MS) {
    letzter.at = new Date().toISOString();
    return;
  }

  activity.push({
    at: new Date().toISOString(),
    url,
    label: text,
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

// Der Serientitel ohne Folgenangabe. Daran haengt der Schluessel, unter dem
// ein Titel in einer Watchparty gefuehrt wird - er muss ueber alle Folgen
// hinweg derselbe bleiben.
//
// Frueher wurde "Staffel 1 Folge 2" nur weggeschnitten, wenn ein Trennzeichen
// davorstand. S.to schreibt es ohne ("Titel Staffel 1 Folge 2"), also bekam
// dort jede Folge einen eigenen Schluessel: der Fortschritt passte zu keinem
// Raum-Eintrag mehr und nach einem Folgenwechsel war die Runde still.
function cleanBaseMediaTitle(title, url) {
  const raw = cleanTitle(title || titleFromPath(url));
  const value = raw
    // Zuerst den Seitennamen hinter dem letzten senkrechten Strich: sonst
    // bleibt "| S.to" stehen und zaehlt spaeter als Teil des Titels.
    .replace(/\s*\|\s*[^|]{1,40}$/, "")
    // Die Angabe kann auch vorn stehen: "Staffel 1 Folge 2 von Titel".
    .replace(/^(?:staffel|season)\s*\d+\s*[-–·|:]?\s*(?:folge|episode|ep\.?)\s*\d+\s*(?:von|of)?\s*[-–·|:]?\s*/i, "")
    .replace(/^s\s*\d{1,3}\s*[.\- ]?\s*e\s*\d{1,4}\s*(?:von|of)?\s*[-–·|:]?\s*/i, "")
    // Und alles ab der Folgenangabe am Ende - mit oder ohne Trennzeichen.
    .replace(/\s*[-–·|:]?\s*(?:staffel|season)\s*\d+\s*[-–·|:]?\s*(?:folge|episode|ep\.?)\s*\d+.*$/i, "")
    .replace(/\s*[-–·|:]?\s*(?:folge|episode|ep\.?)\s*\d+.*$/i, "")
    .replace(/\s*[-–·|:]?\s*(?:staffel|season)\s*\d+\s*$/i, "")
    // Kurzformen: "S1E2", "S01 E02", "1x02".
    .replace(/\s*[-–·|:]?\s*\bs\s*\d{1,3}\s*[.\- ]?\s*e\s*\d{1,4}\b.*$/i, "")
    .replace(/\s*[-–·|:]?\s*\b\d{1,3}x\d{1,4}\b.*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/[\s\-–·|:]+$/, "")
    .trim();
  // Bleibt nichts uebrig, taugt der letzte Pfadteil nicht als Ersatz: bei
  // "/staffel-1/episode-2" waere das "Episode 2" - fuer jede Serie dasselbe.
  // Der Serien-Slug aus der Adresse ist die verlaessliche Rueckfallebene.
  return cleanTitle(value || titelAusSlug(mediaSlugFromUrl(url)) || raw);
}

// "the-office" -> "The Office". Nur fuer den Notfall, wenn der Seitentitel
// nichts hergibt.
function titelAusSlug(slug) {
  return String(slug || "")
    .split(":")[0]
    .split(/[-_]+/)
    .filter(Boolean)
    .map((teil) => teil.charAt(0).toUpperCase() + teil.slice(1))
    .join(" ")
    .trim();
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
  // Eine kleinere letzte Folge ist sonst verdaechtig (halb geladene Seite) und
  // wird ignoriert. Hat die Seite dagegen selbst gemeldet, dass die hinteren
  // Folgen nicht abspielbar sind, ist die Kuerzung gewollt.
  const gekuerzt = Boolean(meta.finalEpisodeTrimmed);
  if (hadKnownFinal && !gekuerzt && compareEpisodeIdentity(nextBounds, previousBounds) < 0) return false;

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
    favorite.completedManually = false;
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

  if (gekuerzt && repairTrimmedSeriesTail(favorite, nextFinalSeason, nextFinalEpisode)) {
    changed = true;
  }
  return changed;
}

// Wird die letzte Folge nach unten korrigiert, steht der Eintrag womoeglich auf
// einer Folge, die es zum Abspielen nie gab - die Serie war dann bis zur echten
// letzten Folge durchgeschaut, galt aber nie als abgeschlossen. Das wird hier
// nachgezogen.
function repairTrimmedSeriesTail(favorite, finalSeason, finalEpisode) {
  const identity = episodeIdentity(favorite?.url || "");
  if (!identity || identity.season !== finalSeason || identity.episode <= finalEpisode) return false;

  const schluessel = `${identity.key}:s${finalSeason}:e${finalEpisode}`;
  const letzteGesehen = Array.isArray(favorite.completedEpisodes)
    && favorite.completedEpisodes.some((eintrag) => eintrag?.key === schluessel);
  if (!letzteGesehen) return false;

  const letzteUrl = replaceEpisodeUrl(favorite.url, finalSeason, finalEpisode);
  if (letzteUrl) {
    favorite.url = letzteUrl;
    favorite.normalizedUrl = normalizeFavoriteUrl(letzteUrl);
    favorite.season = finalSeason;
    favorite.episode = finalEpisode;
    favorite.title = cleanBaseMediaTitle(favorite.title, letzteUrl) || favorite.title;
  }
  favorite.completed = true;
  favorite.episodeCompleted = true;
  favorite.continuePending = false;
  favorite.favorite = false;
  favorite.hideFromContinueWatching = true;
  favorite.progress = 100;
  favorite.completedAt = favorite.completedAt || new Date().toISOString();
  sendToast(`${cleanBaseMediaTitle(favorite.title, favorite.url) || favorite.title || "Serie"} ist abgeschlossen: die restlichen Folgen sind in Folge ${finalEpisode} enthalten`);
  return true;
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
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("watchparty:state", status);
  }
});

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
}

// Der Schluessel muss auf jedem Geraet gleich ausfallen. Die Adresse taugt
// dafuer nicht: S.to laeuft hier ueber eine IP, beim naechsten ueber die
// Domain. Titel und Medientyp sind dagegen ueberall dieselben.
function watchpartyKey(favorite) {
  const titel = cleanBaseMediaTitle(favorite?.title, favorite?.url) || favorite?.title || "";
  const schluessel = taste.titelSchluessel(titel);
  if (!schluessel) return "";
  return `${favorite?.type || inferMediaType(favorite?.url) || "serie"}:${schluessel}`;
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

  watchparty.fortschrittMelden(key, {
    url: favorite.url,
    season: sanitizePositiveNumber(favorite.season),
    episode: sanitizePositiveNumber(favorite.episode),
    position: sanitizePositiveNumber(favorite.position || favorite.currentTime),
    duration: sanitizePositiveNumber(favorite.duration),
    progress: sanitizeProgress(favorite.progress),
    completed: Boolean(favorite.completed),
    episodeCompleted: Boolean(favorite.episodeCompleted),
    updatedAt: favorite.lastWatchedAt || new Date().toISOString(),
    from: watchpartySettings().deviceName || ""
  }, raum);
}

function providerForWatchpartyUrl(url, providerName) {
  const host = providerModel.hostFromUrl(url).toLowerCase();
  const aktive = enabledProviders();
  return aktive.find((provider) => providerModel.hostFromUrl(provider.startUrl).toLowerCase() === host)
    || aktive.find((provider) => String(provider.name || "").toLowerCase() === String(providerName || "").toLowerCase())
    || null;
}

// Fortschritt eines Mitglieds einarbeiten. Das betrifft nur Serien, denen
// dieses Geraet beigetreten ist - der Server schickt nichts anderes.
function applyWatchpartyProgress(key, fortschritt, room) {
  const eintrag = watchpartyEintrag(key, room);
  const lokal = lokalerWatchpartyEintrag(key, eintrag?.room || room);

  if (!lokal) {
    const provider = providerForWatchpartyUrl(fortschritt.url || eintrag?.url || "", eintrag?.providerName);
    if (!provider) return;
    const neu = createWatchpartyFavorite(key, eintrag, fortschritt, provider);
    if (!neu) return;
    favorites.unshift(neu);
    console.log(`[ELFIX WATCHPARTY] ${neu.title} aus der Watchparty uebernommen`);
    saveFavorites();
    sendActiveState();
    if (neu.episodeCompleted) repariereFolgestaendeSpaeter();
    return;
  }

  // Kein Vergleich mit der eigenen Uhr: das Relay laesst ohnehin nur den
  // neuesten Stand durch, und Uhren auf verschiedenen Geraeten gehen
  // auseinander. Frueher fiel dadurch der Stand eines Mitglieds dauerhaft weg.
  if (!fortschritt?.updatedAt) return;

  // Beim selben Anbieter passt die Adresse direkt, sonst wird nur die Folge
  // auf den eigenen Anbieter umgeschrieben.
  const gleicherAnbieter = providerModel.hostFromUrl(lokal.url).toLowerCase()
    === providerModel.hostFromUrl(fortschritt.url || "").toLowerCase();
  const ziel = gleicherAnbieter
    ? fortschritt.url
    : (fortschritt.season && fortschritt.episode ? replaceEpisodeUrl(lokal.url, fortschritt.season, fortschritt.episode) : "");

  if (ziel && ziel !== lokal.url) {
    lokal.url = ziel;
    lokal.normalizedUrl = normalizeFavoriteUrl(ziel);
    const identity = episodeIdentity(ziel);
    lokal.season = identity?.season || fortschritt.season || lokal.season || 0;
    lokal.episode = identity?.episode || fortschritt.episode || lokal.episode || 0;
  }
  lokal.position = fortschritt.position;
  lokal.currentTime = fortschritt.position;
  lokal.duration = fortschritt.duration || lokal.duration;
  lokal.progress = fortschritt.progress;
  lokal.completed = fortschritt.completed;
  lokal.episodeCompleted = fortschritt.episodeCompleted;
  lokal.watched = true;
  lokal.lastWatchedAt = fortschritt.updatedAt;
  // Fuer die Karte: wer gerade schaut und wann zuletzt gemeldet wurde.
  lokal.watchpartyFrom = fortschritt.from || "";
  lokal.watchpartyAt = fortschritt.updatedAt;
  if (!lokal.completed && !lokal.episodeCompleted) {
    lokal.continuePending = true;
    lokal.hideFromContinueWatching = false;
  }
  console.log(`[ELFIX WATCHPARTY] ${lokal.title}: Stand von ${fortschritt.from || "einem Geraet"} uebernommen`);
  saveFavorites();
  sendActiveState();
  // Hat das andere Geraet die Folge zu Ende geschaut, gehoert der eigene
  // Eintrag auf die naechste - sonst verschwindet er aus "Weiterschauen".
  if (lokal.episodeCompleted && !lokal.completed) repariereFolgestaendeSpaeter();
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
    const lokal = favorites.find((favorite) => watchpartyKey(favorite) === eintrag.key);
    const bild = eintrag.thumbnail || lokal?.thumbnail || "";
    // Nur nachreichen, wo dieses Geraet ohnehin Mitglied ist: "share" traegt
    // den Absender sonst als Mitglied ein, und ein Bild ist kein Beitritt.
    if (!eintrag.thumbnail && bild && eintrag.joined && watchparty.verbunden) {
      nachreichenWatchpartyBild(eintrag, bild);
    }
    return {
      ...eintrag,
      thumbnail: bild,
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
        if (aktion === erwartet.aktion) return;
        if (aktion === "seek" && Math.abs(Number(media.currentTime) - erwartet.ziel) < 2) return;
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

// Ein Befehl von aussen. Waehrend er ausgefuehrt wird, meldet dieses Geraet
// selbst nichts zurueck.
//
// `genau` heisst: auf die Stelle des Hosts springen, auch wenn es nur eine
// Sekunde ist. Das gilt fuer jede Pause und fuers gemeinsame Gleichziehen -
// dort ist "ungefaehr" zu wenig. Beim blossen Mitlaufen bleibt es bei einer
// groben Toleranz, sonst puffert der Hoster bei jedem Takt neu.
// `warten` haelt das Versprechen offen, bis der Sprung wirklich vollzogen und
// genug gepuffert ist - erst dann darf gemeldet werden, dass dieses Geraet
// startbereit ist.
function watchpartyApplyScript(action, position, optionen = {}) {
  const genau = optionen.genau ? "true" : "false";
  const warten = optionen.warten ? "true" : "false";
  // Der Host springt nie. Er gibt den Takt vor - alle anderen richten sich nach
  // ihm, nicht umgekehrt. Anhalten und Weiterlaufen gelten fuer ihn trotzdem,
  // sonst liefe er waehrend eines Abgleichs davon.
  const nichtSpringen = optionen.nichtSpringen ? "true" : "false";
  return `(() => {
    const medien = Array.from(document.querySelectorAll("video")).filter((m) => Number(m.duration) > 0);
    const media = medien.sort((links, rechts) => rechts.duration - links.duration)[0];
    if (!media) return "kein-video";

    const aktion = "${action}";
    const ziel = ${Number(position) || 0};
    const genau = ${genau};
    const warten = ${warten};
    const nichtSpringen = ${nichtSpringen};
    const anhalten = aktion === "pause" || aktion === "syncprepare";
    const laufen = aktion === "play" || aktion === "syncstart";
    // Was der eigene Player gleich von sich aus melden wird, ist nur das Echo
    // dieser Anweisung. Nur genau das wird verschluckt - eine Gegenrichtung
    // kommt weiter durch, damit Pausieren auch direkt nach einem Sync wirkt.
    window.__elfixWpErwartet = {
      aktion: anhalten ? "pause" : (laufen ? "play" : "seek"),
      ziel,
      bis: Date.now() + (warten ? 4000 : 1500)
    };

    try {
      // Bei einer Pause und beim Gleichziehen sitzt jeder auf derselben Stelle
      // wie der Host - da zaehlt der Bruchteil. Nur beim beilaeufigen
      // Mitlaufen darf es ungefaehr sein, sonst puffert der Hoster staendig neu.
      const toleranz = genau ? 0.05 : 1.5;
      const springbar = !nichtSpringen && ziel >= 0 && ziel < media.duration - 1 && (genau || ziel > 0);
      if (springbar && Math.abs(Number(media.currentTime) - ziel) > toleranz) {
        media.currentTime = ziel;
      }
      if (anhalten) media.pause();
      if (laufen) {
        const p = media.play();
        if (p && typeof p.then === "function") p.catch(() => {});
      }
      if (!warten) return anhalten ? "pausiert" : (laufen ? "laeuft" : "gesprungen");

      // media.currentTime = x ist nicht sofort erledigt. Wer hier zu frueh
      // "bereit" meldet, startet gleich darauf mitten im Nachladen und liegt
      // sofort wieder hinter den anderen.
      return new Promise((resolve) => {
        const frist = Date.now() + 2200;
        const pruefen = () => {
          // Wer nicht springt, ist schon dort, wo er sein soll - fuer ihn
          // zaehlt nur, ob genug geladen ist.
          const nah = nichtSpringen || Math.abs(Number(media.currentTime) - ziel) <= 0.5;
          if (nah && media.readyState >= 3) {
            resolve("bereit");
            return;
          }
          if (Date.now() > frist) {
            resolve(nah ? "bereit" : "ungenau");
            return;
          }
          setTimeout(pruefen, 80);
        };
        pruefen();
      });
    } catch (_) {
      return "fehlgeschlagen";
    }
  })()`;
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
      watchpartyApplyScript("syncprepare", nachricht.position, {
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
    merkeWatchpartySprung(provider.id, { position: nachricht.position });
    await navigateProvider(provider, ziel);
    scheduleProviderAutoplay(provider, view, { fullscreen: isContentFullscreen });
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

async function installWatchpartyControls(provider, view, url) {
  const key = pushWatchpartyLiveState(url);
  if (!key) return;
  const raum = watchpartyRaumForUrl(url);
  if (!raum) return;

  await executeJavaScriptInMediaFrames(view, watchpartyControlScript()).catch(() => []);
  // Bei jedem Betreten dieser Folge den Stand des Hosts holen - auch wenn man
  // schon einmal drin war. Der Merker gilt nur fuer den laufenden Aufenthalt
  // und wird beim Verlassen der Seite geloescht.
  if (!watchpartyAngeklinkt.has(raum + key + url)) {
    watchpartyAngeklinkt.add(raum + key + url);
    watchparty.abgleichen(key, raum);
  }
}

async function applyWatchpartyControl(nachricht) {
  // Nur die Runde steuert, in der dieses Geraet gerade schaut. Sonst wuerde
  // eine Pause aus der einen Watchparty die andere mit anhalten, obwohl dort
  // derselbe Anime nur zufaellig auch laeuft.
  const aktiv = aktiverWatchpartyRaum();
  if (!aktiv || (nachricht.room && nachricht.room !== aktiv)) return;
  const eintrag = watchpartyEintrag(nachricht.key, nachricht.room || aktiv);
  if (!eintrag) return;

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

  // Die Stelle wird genommen, wie sie kommt. Frueher stand hier ein Zuschlag
  // fuer die Zeit "unterwegs", berechnet als Date.now() minus dem Zeitstempel
  // des Relays - also aus zwei verschiedenen Uhren. Geht die eigene Uhr vor,
  // landete jeder Sprung genau um diese Differenz zu weit vorn.
  //
  // Das Relay verschickt sofort, nachdem es die Stelle bestimmt hat; zu
  // begradigen bleibt nur die reine Leitungszeit, und die laesst sich ohne
  // abgeglichene Uhren nicht messen. Sie liegt bei Millisekunden - deutlich
  // weniger als der Fehler, den die Rechnerei verursacht hat.
  const position = Number(nachricht.position || 0);
  // Pause, gezielter Sprung, Abgleich und gemeinsamer Start muessen sitzen.
  // Nur beim beilaeufigen "der andere spielt weiter" darf es ungefaehr sein.
  const genau = nachricht.action !== "play" || Boolean(nachricht.resync);
  // Bin ich der Host, gilt meine Stelle - ich ruecke nicht, die anderen kommen
  // zu mir. Pause und Weiter mache ich mit, damit ich nicht davonlaufe.
  const binHost = Boolean(eintrag.hostId) && eintrag.hostId === eintrag.myId;

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
    const provider = providers.find((item) => item.id === providerId);
    // Frueher stand hier nachricht.position: die eben berechnete Stelle samt
    // Laufzeit wurde verworfen, und alle lagen dauerhaft hinter dem Host.
    await executeJavaScriptInMediaFrames(
      view,
      watchpartyApplyScript(nachricht.action, position, { genau, nichtSpringen: binHost })
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
  if (!raum || (nachricht.room && nachricht.room !== raum)) return;
  if (watchpartySerieForUrl(adresse) !== nachricht.key) return;

  const hier = episodeIdentity(adresse);
  mainWindow.webContents.send("watchparty:watchstate", {
    key: nachricht.key,
    room: nachricht.room || raum,
    season: hier?.season || 0,
    episode: hier?.episode || 0,
    members: (nachricht.members || []).map((mitglied) => ({
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
    }))
  });
}

// Der Weg, den es im Normalfall geht: die Seite meldet von selbst, sobald sich
// etwas tut. Kein Zeitgeber, kein Abfragen aller Frames - und damit ohne die
// Verzoegerung, die eine Umfrage zwangslaeufig hat.
function meldeWatchpartyStandAusSeite(view, position, pausiert) {
  if (!watchparty.aktiv || !isLiveView(view) || view !== activeView) return;
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
    episode: identity?.episode || 0
  }, raum);
}

// Rueckfallebene fuer Seiten, auf denen sich das Melde-Skript nicht einhaengen
// konnte - etwa weil der Player erst spaeter erscheint. Laeuft in grossem
// Abstand; im Normalfall hat die Seite laengst selbst gemeldet.
async function meldeWatchpartyStand() {
  if (!watchparty.aktiv || !watchparty.verbunden) return;
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
    episode: identity?.episode || 0
  }, raum);
}

// Ein offener Sprungwunsch je Anbieter. Er wird eingeloest, sobald tatsaechlich
// ein Video laeuft - vorher laesst sich die Stelle nicht setzen.
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

// --- Empfohlen fuer dich -----------------------------------------------------
// Baut aus dem Verlauf ein Geschmacksprofil (siehe taste.js) und sucht dazu
// passende Titel: was die Anbieter selbst als aehnlich ausweisen, was in den
// Lieblingsgenres liegt und was neu auf den Startseiten steht.

function loadTasteCache() {
  if (tasteCache) return tasteCache;
  try {
    const roh = JSON.parse(fs.readFileSync(TASTE_FILE, "utf8"));
    tasteCache = {
      pages: roh?.pages && typeof roh.pages === "object" ? roh.pages : {},
      lists: roh?.lists && typeof roh.lists === "object" ? roh.lists : {}
    };
  } catch {
    tasteCache = { pages: {}, lists: {} };
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
  if (!refresh && gespeichert && Date.now() - gespeichert.at < TASTE_PAGE_CACHE_MS) return gespeichert;

  try {
    const seite = await fetchProviderHtml(url);
    if (!seite) return gespeichert || null;
    const eintrag = {
      at: Date.now(),
      genres: extractGenres(seite.html, seite.url),
      related: extractRelatedItems(seite.html, seite.url, provider, 10)
    };
    cache.pages[url] = eintrag;
    saveTasteCacheSoon();
    return eintrag;
  } catch {
    return gespeichert || null;
  }
}

// Uebersichtsseite (Genre-Liste) mit den Titeln, die dort stehen.
async function tasteList(url, provider, refresh = false) {
  const cache = loadTasteCache();
  const gespeichert = cache.lists[url];
  if (!refresh && gespeichert && Date.now() - gespeichert.at < TASTE_LIST_CACHE_MS) return gespeichert.items;

  try {
    const seite = await fetchProviderHtml(url);
    if (!seite) return gespeichert?.items || [];
    const items = extractCatalogItems(seite.html, seite.url, provider, 40);
    cache.lists[url] = { at: Date.now(), items };
    saveTasteCacheSoon();
    return items;
  } catch {
    return gespeichert?.items || [];
  }
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

// Kleiner, ueber den Tag stabiler Zufallswert. Genre-Listen sind alphabetisch
// sortiert - ohne diesen Anstoss staenden dort immer dieselben Titel vorn.
function dailyJitter(value) {
  const text = `${value}#${Math.floor(Date.now() / (24 * 60 * 60 * 1000))}`;
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return (Math.abs(hash) % 1000) / 1000;
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
    .slice(0, TASTE_HISTORY_SIZE);
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
  if (!type) return alle.slice(0, limit);

  const vergeben = new Set(haupt.map((item) => taste.urlSchluessel(item.url)));
  return alle
    .filter((item) => candidateMediaType(item.url) === type)
    .filter((item) => !vergeben.has(taste.urlSchluessel(item.url)))
    .slice(0, limit);
}

async function personalRecommendationPool(refresh) {
  const frisch = personalCache.items.length && Date.now() - personalCache.at < PERSONAL_CACHE_MS;
  if (!refresh && frisch) return personalCache.items;
  if (personalPending) return personalPending;

  const lauf = buildPersonalRecommendations(PERSONAL_POOL_SIZE, refresh)
    .then((items) => {
      personalCache = { at: Date.now(), items };
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
      title: cleanBaseMediaTitle(favorite.title, favorite.url) || favorite.title,
      providerId: provider.id,
      weight: taste.watchWeight(favorite, jetzt),
      genres: seite?.genres || [],
      related: seite?.related || []
    };
  })).filter(Boolean);
  if (!saat.length) return [];

  const profil = taste.buildTasteProfile(saat, jetzt);

  // 2. Was schon im Verlauf oder auf der Watchlist steht, faellt raus.
  const ausschluss = new Set();
  for (const favorite of favorites) {
    for (const wert of [favorite.url, favorite.normalizedUrl, seriesPageUrl(favorite.url)]) {
      if (wert) ausschluss.add(taste.urlSchluessel(wert));
    }
    const titel = cleanBaseMediaTitle(favorite.title, favorite.url) || favorite.title;
    if (titel) ausschluss.add(taste.titelSchluessel(titel));
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

  // 3b. Titel aus den Lieblingsgenres.
  const genreSeiten = [];
  for (const genre of profil.genres.slice(0, 6)) {
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
        genreLabel: treffer.seite.genre.label,
        bonus: dailyJitter(item.url) * 0.3
      });
    }
  }
  kandidaten.push(...ausGenres.values());

  // 3c. Neues von den Startseiten - die Genres dazu werden gleich nachgeholt.
  const startseiten = await Promise.all(anbieter.map((provider) => (
    discoverForProvider(provider, false).catch(() => [])
  )));

  // Was die Reihe "Neu bei deinen Anbietern" bereits zeigt, gehoert nicht noch
  // einmal in die Vorschlaege - auf der Startseite soll nichts doppelt stehen.
  for (const liste of startseiten) {
    for (const item of liste.slice(0, TASTE_NEW_OFFSET)) {
      ausschluss.add(taste.urlSchluessel(item.url));
      ausschluss.add(taste.titelSchluessel(item.title));
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
    .filter((item) => !item.viaSearch && !ausschluss.has(taste.urlSchluessel(item.url)) && !ausschluss.has(taste.titelSchluessel(item.title)))
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

  return taste.scoreCandidates(kandidaten, profil, { limit, exclude: ausschluss, perSeed: 3 });
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
      // Selbst gelegte Stelle in der Mediathek. Ohne diese Zeile faellt sie
      // beim Laden weg, weil hier nur bekannte Felder uebernommen werden.
      libraryOrder: Number.isFinite(Number(favorite.libraryOrder)) && Number(favorite.libraryOrder) >= 0
        ? Number(favorite.libraryOrder)
        : null,
      // Zu welcher Watchparty dieser Eintrag gehoert. Leer heisst: der eigene.
      watchpartyRoom: String(favorite.watchpartyRoom || ""),
      // Selbst gewaehltes Bild - hat Vorrang vor dem der Anbieterseite.
      customThumbnail: String(favorite.customThumbnail || ""),
      // Von Hand abgehakt: bleibt auch beim Wiederansehen in der Mediathek.
      completedManually: Boolean(favorite.completedManually),
      // Hinweis auf Nachschub zu einer Serie, die schon abgeschlossen war.
      newEpisodeAt: String(favorite.newEpisodeAt || ""),
      newEpisodeLabel: String(favorite.newEpisodeLabel || ""),
      activity: normalizeActivity(favorite.activity),
      createdAt: String(favorite.createdAt || new Date().toISOString()),
      openedAt: String(favorite.openedAt || ""),
      updatedAt: String(favorite.updatedAt || "")
    })).filter((favorite) => providerModel.isHttpUrl(favorite.url));
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
    nachgezogen += 1;
  }
  if (nachgezogen) console.log(`[ELFIX] eigenes Bild auf ${nachgezogen} weitere Eintraege uebernommen`);
  return nachgezogen > 0;
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
    // Fuellwoerter wie "der" oder "the" stehen in fast jedem Titel und wuerden
    // das Bild einer fremden Serie als passend durchgehen lassen. Bleibt nach
    // dem Aussortieren nichts uebrig, wird die ungefilterte Liste genommen.
    const fuellwoerter = /^(?:der|die|das|dem|den|des|ein|eine|einen|einem|eines|und|oder|aber|mit|von|vom|zum|zur|fur|fuer|auf|aus|bei|ist|sind|wie|als|auch|nur|nicht|sich|ihre|sein|seine|dass|dann|the|and|for|with|from|that|this|you|are|was|were|his|her|its|has|had|have|not|but)$/i;
    const mediaTokens = mediaSlug.split(/[-_]+/).filter((token) => token.length > 2);
    const titleTokens = normalizeText((document.querySelector("h1")?.textContent || "") + " " + (document.title || ""))
      .split(" ")
      .filter((token) => token.length > 2 && !/^(serie|staffel|folge|episode|stream|kostenlos|ansehen|season)$/i.test(token));
    const alleTokens = Array.from(new Set([...mediaTokens, ...titleTokens]));
    const ohneFuellwoerter = alleTokens.filter((token) => !fuellwoerter.test(token));
    const expectedTokens = ohneFuellwoerter.length ? ohneFuellwoerter : alleTokens;
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
    // Manche Folgen sind auf der Uebersicht gelistet, aber nicht abspielbar:
    // S.to fasst z. B. Doppelfolgen zusammen und schreibt in die restlichen
    // Zeilen "[In E18 enthalten]" - ohne Hoster und ohne Sprachfahne. Wuerde
    // eine solche Folge als letzte gelten, liesse sich die Serie nie
    // abschliessen, weil sie niemand abspielen kann.
    const unplayableEpisodes = (() => {
      const gesperrt = new Set();
      const rows = Array.from(document.querySelectorAll("tr, li"));
      for (const row of rows) {
        const nummerZelle = row.querySelector("[class*='episode-number']");
        const ausZelle = Number(String(nummerZelle?.textContent || "").trim());
        const linkTreffer = String(row.getAttribute("onclick") || "")
          .concat(" ", row.querySelector("a[href]")?.getAttribute("href") || "")
          .match(/(?:episode|folge)-(\\d+)/i);
        const nummer = Number.isFinite(ausZelle) && ausZelle > 0
          ? ausZelle
          : Number(linkTreffer?.[1] || 0);
        if (!Number.isFinite(nummer) || nummer <= 0) continue;

        const text = String(row.textContent || "");
        const sammelfolge = /\\[\\s*in\\s+(?:e|ep|episode|folge)\\s*\\d+\\s+enthalten\\s*\\]/i.test(text);
        const watchZelle = row.querySelector("[class*='watch-cell'], [class*='episode-watch']");
        const ohneHoster = Boolean(watchZelle)
          && !watchZelle.querySelector("img, svg, a, button, [class*='watch-link']");
        if (sammelfolge || ohneHoster) gesperrt.add(nummer);
      }
      return gesperrt;
    })();
    const pageSeason = (() => {
      const match = location.pathname.match(/\\/(?:staffel|season)-(\\d+)/i);
      return match ? Number(match[1]) : 0;
    })();
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
      const derStaffel = links
        .filter((link) => !finalSeason || link.season === finalSeason)
        .sort((left, right) => right.episode - left.episode);
      const hoechste = derStaffel[0];

      // Nur die Folgen der gerade angezeigten Staffel lassen sich beurteilen -
      // fuer andere Staffeln steht keine Liste auf der Seite.
      const beurteilbar = !pageSeason || !finalSeason || pageSeason === finalSeason;
      const spielbar = beurteilbar
        ? derStaffel.filter((link) => !unplayableEpisodes.has(link.episode))
        : derStaffel;
      const best = spielbar[0] || hoechste;
      return {
        finalSeason,
        finalEpisode: best?.episode || 0,
        finalEpisodeTrimmed: Boolean(best && hoechste && best.episode < hoechste.episode),
        unplayableSeason: pageSeason,
        unplayableEpisodes: beurteilbar || pageSeason ? Array.from(unplayableEpisodes) : []
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
    // Titelfaehige Woerter (avatar, black, flag) nur im Ordnerpfad als
    // Ausschluss werten - im Dateinamen steht der Name der Serie.
    const istMuellBild = (href) => {
      const wert = String(href || "");
      if (!wert || /(?:favicon|sprite|placeholder|blank|transparent|loading|spinner|no-?image|og-image)/i.test(wert)) return true;
      const ohneQuery = wert.split(/[?#]/)[0];
      const ordner = ohneQuery.slice(0, ohneQuery.lastIndexOf("/") + 1);
      return /(?:logo|icon|avatar|flag|banner|button|rating|language|login|register|facebook|twitter|social|share|ads?)/i.test(ordner);
    };
    const isStoChannelArtwork = (href) => /\\/media\\/images\\/channel\\/(?:2x-)?desktop\\/[^?#]+/i.test(href)
      && !istMuellBild(href);
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

// Ohne geladene Listen blockt nur die eingebaute Heuristik - und genau dann
// kommen Popups und Werbung durch. Beim Start wird deshalb nachgeholt, was
// fehlt oder zu alt ist; laeuft nebenher, damit das Fenster nicht wartet.
async function ensureFilterLists() {
  if (!settings.adblock?.enabled) return;
  const zuletzt = Date.parse(settings.adblock.lastUpdated || "") || 0;
  const veraltet = !zuletzt || Date.now() - zuletzt > FILTER_MAX_ALTER_MS;
  const vorhanden = adblock.hatGeladeneListen();
  if (vorhanden && !veraltet) return;

  console.log(`[ELFIX ADBLOCK] ${vorhanden ? "Listen sind veraltet" : "nur die eingebauten Regeln aktiv"} - werden geholt`);
  const ergebnis = await updateFilterLists();
  if (ergebnis.fehlend?.length) {
    console.log(`[ELFIX ADBLOCK] nicht erreichbar: ${ergebnis.fehlend.join(", ")}`);
  }
  console.log(`[ELFIX ADBLOCK] ${ergebnis.ruleCount} Regeln aktiv`);
}

async function updateFilterLists() {
  const texts = [];
  const fehlend = [];
  for (const list of ADGUARD_FILTER_LISTS) {
    try {
      // net.fetch nutzt den Netzwerk-Stack von Chromium samt Proxy-Einstellungen
      // des Systems - das globale fetch scheitert hier je nach Umgebung.
      const response = await net.fetch(list.url, { signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      texts.push(await response.text());
    } catch (fehler) {
      // Eine hakende Liste darf die anderen drei nicht mitreissen - lieber
      // etwas weniger Regeln als gar keine.
      fehlend.push(`${list.name} (${fehler?.message || fehler})`);
    }
  }

  if (!texts.length) {
    throw new Error(`Keine Filterliste erreichbar: ${fehlend.join(", ")}`);
  }

  adblock.parseLists(texts);
  settings.adblock.lastUpdated = new Date().toISOString();
  saveFilterCache();
  saveSettings();
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
    playback: {
      pauseOnProviderSwitch: raw?.playback?.pauseOnProviderSwitch ?? defaults.playback.pauseOnProviderSwitch,
      favoriteProgressMode: sanitizeChoice(raw?.playback?.favoriteProgressMode, ["sequential", "static"], defaults.playback.favoriteProgressMode),
      pauseOnMinimize: migrateBackgroundAudio ? defaults.playback.pauseOnMinimize : raw?.playback?.pauseOnMinimize ?? defaults.playback.pauseOnMinimize,
      pauseOnBlur: migrateBackgroundAudio ? defaults.playback.pauseOnBlur : raw?.playback?.pauseOnBlur ?? defaults.playback.pauseOnBlur
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
      // Erst die mitgeschickte Kennung, dann die bereits bekannte - eine neue
      // nur, wenn dieses Geraet wirklich noch keine hat. Kaeme hier bei jedem
      // Speichern eine frische heraus, waere das Geraet fuer die Raeume jedes
      // Mal ein anderes und muesste ueberall neu beitreten.
      deviceId: String(raw?.watchparty?.deviceId || settings?.watchparty?.deviceId || "").slice(0, 64)
        || crypto.randomUUID()
    },
    home: {
      showHero: raw?.home?.showHero ?? raw?.appearance?.showHero ?? defaults.home.showHero,
      showProviders: raw?.home?.showProviders ?? defaults.home.showProviders,
      showFavorites: raw?.home?.showFavorites ?? defaults.home.showFavorites,
      showPersonal: raw?.home?.showPersonal ?? defaults.home.showPersonal,
      showCategories: raw?.home?.showCategories ?? defaults.home.showCategories,
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
    watchparty: {
      enabled: false,
      serverUrl: "",
      rooms: [],
      deviceName: "",
      deviceId: ""
    },
    home: {
      showHero: true,
      showProviders: true,
      showFavorites: true,
      showPersonal: true,
      showCategories: true,
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

// Diese Liste gilt immer, auch wenn keine einzige AdGuard-Liste geladen werden
// konnte. Sie deckt die Netze ab, die auf Streaming-Seiten die Popups und
// Popunder ausliefern - ohne sie haengt der Schutz an einem Download.
function defaultAdDomains() {
  return [
    // Anzeigen-Vermarkter
    "doubleclick.net",
    "googlesyndication.com",
    "googleadservices.com",
    "adservice.google.com",
    "adsystem.com",
    "amazon-adsystem.com",
    "taboola.com",
    "outbrain.com",
    "scorecardresearch.com",
    "adnxs.com",
    "pubmatic.com",
    "rubiconproject.com",
    "criteo.com",
    "zedo.com",
    "smartadserver.com",
    "adform.net",
    "openx.net",
    "casalemedia.com",
    "moatads.com",
    "media.net",
    "mgid.com",
    "adskeeper.com",
    "revcontent.com",
    // Popup- und Popunder-Netze
    "popads.net",
    "popcash.net",
    "popunder.net",
    "popmyads.com",
    "poptm.com",
    "onclickads.net",
    "onclickalgo.com",
    "clickadu.com",
    "adcash.com",
    "propellerads.com",
    "propeller-tracking.com",
    "propu.sh",
    "adsterra.com",
    "adsterra.net",
    "highperformanceformat.com",
    "profitableratecpm.com",
    "effectiveratecpm.com",
    "displaycontentnetwork.com",
    "exoclick.com",
    "exosrv.com",
    "exdynsrv.com",
    "realsrv.com",
    "trafficjunky.net",
    "trafficstars.com",
    "tsyndicate.com",
    "juicyads.com",
    "hilltopads.net",
    "hilltopads.com",
    "adspyglass.com",
    "bidgear.com",
    "adnium.com",
    "adsupply.com"
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

  // Steht hier mehr als das eingebaute Grundgeruest? ruleCount() ist nie null,
  // weil die Standarddomains immer dabei sind - fuer "sind Listen da?" taugt
  // die Zahl deshalb nicht.
  hatGeladeneListen() {
    return this.substringRules.length > 0 || this.domains.size > defaultAdDomains().length;
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
