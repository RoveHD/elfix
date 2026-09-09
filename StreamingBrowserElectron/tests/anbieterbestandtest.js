"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const providerModel = require("../shared/provider-model");
const fortschritt = require("../src/fortschritt");
const umzug = require("../src/umzug");
const source = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
function funktion(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}
const anbieter = (id, host) => ({ id, name: id, startUrl: `https://${host}/`,
  searchUrl: `https://${host}/search?q={query}`, enabled: true, adblockEnabled: true });

function buehne() {
  const handlers = new Map();
  class View {
    constructor() {
      this.webContents = new EventEmitter();
      this.url = "https://old.example/episode-1";
      Object.assign(this.webContents, { id: 1, getURL: () => this.url,
        setWindowOpenHandler: handler => { this.popup = handler; } });
    }
    setBackgroundColor() {}
  }
  const c = vm.createContext({
    console: { log() {} }, URL, providerModel, umzug,
    stripWww: fortschritt.stripWww, isAllowedResultHost: fortschritt.isAllowedResultHost,
    normalizeFavoriteUrl: fortschritt.normalizeFavoriteUrl,
    WebContentsView: View, browserSession: {}, VIEW_BACKGROUND_COLOR: "#000",
    providerViews: new Map(), providerViewRecords: new WeakMap(), webContentsProvider: new Map(), activeProviderId: "custom", activeView: null,
    providers: [anbieter("custom", "old.example"), anbieter("other", "other.example")], favorites: [],
    startMediaProgressPolling() {}, syncViewMediaProgress() {}, logBlockedUrl() {},
    settings: { adblock: { enabled: true, blockPopups: true, blockRedirects: false, whitelist: [] } },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    saveProviders() {}, saveFavorites() {}, sendActiveState() {}, mainWindow: {},
    dialog: { showMessageBox: async () => ({ response: 1 }) }
  });
  c.enabledProviders = () => c.providers.filter(provider => provider.enabled);
  c.activeProvider = () => c.providers.find(provider => provider.id === c.activeProviderId);
  c.navigateProvider = async (provider, url) => { c.activeView = c.getProviderView(provider); c.activeView.url = url; };
  vm.runInContext(["reuseProviderRecords", "getProviderView", "shouldCancelNavigation",
    "shouldBlockProviderNavigation", "isOtherConfiguredProviderHost", "isAllowedProviderHost",
    "istPopupNavigation", "istErlaubtesHauptziel", "isProviderFirstParty", "isKnownVideoHosterUrl",
    "isKnownAuthHost", "isWhitelisted", "isStoProviderLike", "isStoHost", "istCaptchaHost",
    "isChallengeOrVerificationUrl"].map(funktion).join("\n"), c);
  for (const name of ["provider:save-all", "provider:relocate"]) {
    const start = source.indexOf(`ipcMain.handle("${name}"`);
    vm.runInContext(source.slice(start, source.indexOf("\n});", start) + 4), c);
  }
  c.activeView = c.getProviderView(c.providers[0]);
  return { c, handlers };
}

function gesperrt(view, url) {
  let blocked = false;
  view.webContents.emit("will-navigate", { preventDefault() { blocked = true; } }, url);
  return blocked;
}

(async () => {
  for (const weg of ["speichern", "umziehen"]) {
    const { c, handlers } = buehne();
    const record = c.providers[0], other = c.providers[1], view = c.activeView;
    assert.equal(gesperrt(view, "https://new.example/episode-2"), true);
    if (weg === "speichern") {
      handlers.get("provider:save-all")({}, [anbieter("custom", "new.example"), { ...other }]);
    } else {
      assert.equal((await handlers.get("provider:relocate")({}, "custom", "https://new.example")).moved, true);
      assert.equal(view.url, "https://new.example/episode-1");
    }
    assert.equal(c.getProviderView(c.providers[0]), view, "Die laufende Ansicht bleibt erhalten");
    assert.equal(c.providers[0], record, "Auch Timer lesen die aktuelle Anbieterdefinition");
    assert.equal(c.providers[1], other);
    assert.equal(gesperrt(view, "https://new.example/episode-2"), false);
    assert.equal(gesperrt(view, "https://old.example/episode-2"), true);
    assert.equal(gesperrt(view, "https://other.example/episode-2"), true);
    handlers.get("provider:save-all")({}, c.providers.map(provider => ({ ...provider, adblockEnabled: false })));
    assert.equal(gesperrt(view, "https://foreign.example/"), false, "Geaenderter Anbieterschalter gilt sofort");
    handlers.get("provider:save-all")({}, []);
    handlers.get("provider:save-all")({}, [anbieter("custom", "restored.example")]);
    assert.equal(c.getProviderView(c.providers[0]), view);
    assert.equal(gesperrt(view, "https://restored.example/episode-3"), false,
      "Auch Loeschen und Wiederherstellen derselben ID aktualisiert die vorhandene Ansicht");
  }

  let datei = "[]";
  const c = vm.createContext({ providerModel, PROVIDER_FILE: "mock", fs: { readFileSync() {
    if (datei === undefined) throw Error("ENOENT"); return datei;
  } } });
  vm.runInContext(funktion("loadProviders"), c);
  assert.equal(c.loadProviders().length, 0);
  for (datei of [undefined, "broken json", "null", "{}", '[{"name":"ungueltig"}]']) {
    assert.equal(c.loadProviders().length, providerModel.defaultProviders().length);
  }
  datei = JSON.stringify([{ ...anbieter("aus", "custom.example"), enabled: false }]);
  assert.equal(c.loadProviders()[0].enabled, false);
  console.log("OK Anbieterbestand: bestehende Ansicht nach Speichern/Umzug, Navigation, Schalter und leere Liste beim Neustart");
})().catch(error => { console.error(error); process.exitCode = 1; });
