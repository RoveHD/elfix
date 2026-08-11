const { app, BrowserWindow, WebContentsView, ipcMain, session, shell, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("fs");
const path = require("path");
const providerModel = require("../shared/provider-model");

const DATA_DIR = path.join(app.getPath("appData"), "GlobalSearchHub");
const PROVIDER_FILE = path.join(DATA_DIR, "providers.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const FILTER_CACHE_FILE = path.join(DATA_DIR, "filter-cache.json");
const FAVORITES_FILE = path.join(DATA_DIR, "favorites.json");
const SESSION_PARTITION = "persist:streaming-browser";
const MAX_BLOCK_LOG = 400;
const SETTINGS_SCHEMA_VERSION = 4;
const CACHE_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
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
const blockedRequests = [];
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

app.setName("Elflix");

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
    title: "Elflix",
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

  autoUpdater.on("checking-for-update", () => setUpdateState({ status: "checking", message: "Suche beim Start nach Elflix-Updates...", progress: 0, downloaded: false, installing: false, error: "" }));
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
  autoUpdater.on("update-not-available", () => setUpdateState({ status: "current", message: "Elflix ist aktuell.", progress: 100, error: "" }));
  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.round(progress.percent || 0);
    setUpdateState({ status: "downloading", message: `Update wird geladen: ${percent}%`, progress: percent, error: "" }, [25, 50, 75, 100].includes(percent));
  });
  autoUpdater.on("update-downloaded", () => {
    setUpdateState({
      status: "installing",
      message: "Update geladen. Elflix installiert es jetzt automatisch und startet neu.",
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
  updateState: publicUpdateState()
}));

ipcMain.handle("updates:check", async () => {
  if (!app.isPackaged) {
    setUpdateState({ status: "dev", message: "Updates funktionieren im installierten Release.", progress: 0, error: "" });
    return publicUpdateState();
  }
  setUpdateState({ status: "checking", message: "Suche nach Elflix-Updates...", progress: 0, downloaded: false, installing: false, error: "" });
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
    enterContentFullscreen();
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
  const before = favorites.length;
  favorites = favorites.filter((favorite) => favorite.id !== favoriteId);
  if (activeFavoriteId === favoriteId) activeFavoriteId = null;
  if (favorites.length !== before) saveFavorites();
  return favorites;
});

ipcMain.handle("favorites:open", async (_event, favoriteId) => {
  const favorite = favorites.find((item) => item.id === favoriteId);
  if (!favorite) return null;

  const provider = enabledProviders().find((item) => item.id === favorite.providerId)
    || enabledProviders().find((item) => item.name === favorite.providerName)
    || enabledProviders()[0];
  if (!provider) return null;

  activeFavoriteId = favorite.id;
  moveFavoriteToFront(favorite);
  await repairFavoriteThumbnailIfNeeded(favorite, provider).catch(() => false);
  await navigateProvider(provider, favorite.url);
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

  if (!attachedProviderViews.has(provider.id)) {
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
  const previousView = activeView;
  const previousProviderId = activeProviderId;
  if (previousView && previousProviderId && settings.playback.pauseOnProviderSwitch) {
    await pauseProviderForSwitch(previousProviderId, previousView, true);
  }
  if (mainWindow) {
    for (const [providerId, view] of providerViews.entries()) {
      if (attachedProviderViews.has(providerId)) {
        mainWindow.contentView.removeChildView(view);
        attachedProviderViews.delete(providerId);
      }
    }
  }
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
      autoplayPolicy: "no-user-gesture-required"
    }
  });

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
    if (shouldCancelNavigation(url, provider)) {
      event.preventDefault();
    }
  });
  view.webContents.on("will-redirect", (event, url) => {
    if (shouldCancelNavigation(url, provider)) {
      event.preventDefault();
    }
  });
  view.webContents.on("enter-html-full-screen", () => enterContentFullscreen());
  view.webContents.on("leave-html-full-screen", () => leaveContentFullscreen());
  view.webContents.on("before-input-event", (event, input) => {
    if (input.key === "Escape" && isContentFullscreen) {
      event.preventDefault();
      leaveContentFullscreen();
    }
  });
  view.webContents.on("did-navigate", (_event, url) => rememberProviderUrl(provider.id, url));
  view.webContents.on("did-navigate-in-page", (_event, url) => rememberProviderUrl(provider.id, url));
  view.webContents.on("page-title-updated", () => {
    updateActiveFavoriteTitle(provider.id, view);
    sendActiveState();
  });
  view.webContents.on("did-finish-load", () => {
    installStoPlayerFix(provider, view);
    installAniWorldImageFix(provider, view);
    updateActiveFavoriteTitle(provider.id, view);
    scheduleFavoriteMetadataRefresh(provider.id, view);
    sendActiveState();
  });
  view.webContents.on("dom-ready", () => {
    installStoPlayerFix(provider, view);
    installAniWorldImageFix(provider, view);
  });

  providerViews.set(provider.id, view);
  return view;
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
  mainWindow.setFullScreen(true);
  sendFullscreenState();
  applyBrowserBounds();
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
  updateActiveFavoriteProgress(providerId, url);
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
  moveFavoriteToFront(favorite);
  saveFavorites();
  sendToast(`Favorit auf ${favoriteProgressTargetLabel(url)} geändert`);
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
  if (changed) {
    saveFavorites();
    sendActiveState();
  }
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
        "user-agent": "Mozilla/5.0 Elflix/0.2"
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
      "user-agent": "Mozilla/5.0 Elflix/0.2",
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
      createdAt: String(favorite.createdAt || new Date().toISOString()),
      openedAt: String(favorite.openedAt || "")
    })).filter((favorite) => providerModel.isHttpUrl(favorite.url));
  } catch {
    return [];
  }
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
      "user-agent": "Mozilla/5.0 Elflix/0.2"
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
      "user-agent": "Mozilla/5.0 Elflix/0.2",
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
    if (/\.(?:jpg|jpeg|png|webp)(?:\?|#|$)/i.test(url.pathname)) return true;
    return /(?:cover|poster|thumbnail|thumb|anime|series?|stream|cache|image|img|bilder?|media|uploads?)/i.test(url.pathname);
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
          && (/\\.(?:jpg|jpeg|png|webp)(?:\\?|#|$)/i.test(url.pathname)
            || /(?:cover|poster|thumbnail|thumb|anime|series?|stream|cache|image|img|bilder?|media|uploads?)/i.test(url.pathname));
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
          title: document.title || "",
          favicon: abs(icon && icon.getAttribute("href")),
          thumbnail: infoPanelPoster
        };
      }

      return {
        title: document.title || "",
        favicon: abs(icon && icon.getAttribute("href")),
        thumbnail: ""
      };
    }
    if (isFilmoPage) {
      return {
        title: document.title || "",
        favicon: abs(icon && icon.getAttribute("href")),
        thumbnail: filmoMainImage()
      };
    }
    if (isAniWorldPage) {
      return {
        title: document.title || "",
        favicon: abs(icon && icon.getAttribute("href")),
        thumbnail: aniWorldMainImage()
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
      title: document.title || "",
      favicon: abs(icon && icon.getAttribute("href")),
      thumbnail: candidates[0]?.href || ""
    };
  })()`, true);
}

function cleanTitle(value) {
  const title = String(value || "").replace(/\s+/g, " ").trim();
  return title || "Favorit";
}

function favoriteMatchesCurrentProviderTitle(favorite, provider, url, normalized = normalizeFavoriteUrl(url)) {
  if (!favorite || !provider) return false;
  const sameProvider = favorite.providerId === provider.id || favorite.providerName === provider.name;
  if (!sameProvider) return false;
  if (favorite.normalizedUrl === normalized || normalizeFavoriteUrl(favorite.url) === normalized) return true;
  return favoriteReplacementKey(favorite.url, provider) === favoriteReplacementKey(url, provider);
}

function favoriteReplacementKey(url, provider) {
  const providerKey = String(provider?.id || provider?.name || providerModel.hostFromUrl(provider?.startUrl || url) || "")
    .toLowerCase()
    .trim();
  const slug = mediaSlugFromUrl(url);
  return `${providerKey}:${slug || normalizeFavoriteUrl(url)}`;
}

function mediaSlugFromUrl(value) {
  try {
    const parts = new URL(value).pathname.split("/").filter(Boolean);
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index].toLowerCase();
      if (part === "anime" && parts[index + 1]?.toLowerCase() === "stream" && parts[index + 2]) {
        return parts[index + 2].toLowerCase();
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
      backgroundStyle: sanitizeChoice(raw?.appearance?.backgroundStyle, ["plain", "cinema", "poster", "black", "gray", "glass"], defaults.appearance.backgroundStyle),
      backgroundColor: sanitizeColor(raw?.appearance?.backgroundColor, defaults.appearance.backgroundColor),
      fontScale: sanitizeNumber(raw?.appearance?.fontScale, 80, 140, defaults.appearance.fontScale),
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
