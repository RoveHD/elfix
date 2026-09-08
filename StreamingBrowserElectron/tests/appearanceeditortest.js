"use strict";

// Kleiner VM-Harness fuer die echten Renderer-Funktionen. Er testet keine
// nachgebaute Queue, sondern laesst saveSettings/applyDesignPreset aus dem
// aktuellen renderer.js gegen kontrollierte IPC-Antworten laufen.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const rendererPath = path.join(__dirname, "..", "src", "renderer", "renderer.js");
const source = fs.readFileSync(rendererPath, "utf8").replace(/\r/g, "");

function extractFunction(name) {
  const functionStart = source.indexOf(`function ${name}(`);
  if (functionStart < 0) throw new Error(`function not found: ${name}`);
  const start = source.slice(Math.max(0, functionStart - 6), functionStart) === "async "
    ? functionStart - 6 : functionStart;
  // Die Signatur von saveSettings hat einen Default-Objektwert ({}); der
  // erste einfache "{" waere daher nicht der Funktionsrumpf.
  const open = source.indexOf(") {", start) + 2;
  if (open < 2) throw new Error(`body not found: ${name}`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === "\"" || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function: ${name}`);
}

const DEFAULT = {
  themeMode: "dark", accentPreset: "blue", accentColor: "#147eff",
  accentStrength: 70, autoDeriveColors: true, settingsMode: "advanced",
  layoutStyle: "standard", navStyle: "sidebar", autoCollapseSidebar: true,
  compactHeader: false, uiDensity: "comfortable", densityMode: "preset",
  cardSize: "medium", favoriteSize: "medium", favoriteLayout: "grid",
  favoriteTextSize: "medium", favoriteArtwork: "balanced", cornerStyle: "soft",
  backgroundStyle: "cinema", backgroundColor: "#070a10", fontScale: 100,
  animationMode: "full", animations: true, animationSpeed: 100,
  hoverZoom: 102, hoverBrightness: 106, uiSounds: true, uiSoundVolume: 20,
  cardStyle: "standard", shadowStyle: "standard", buttonHeight: 44, showProviderStrip: true,
  showFavoriteMeta: true, cardRadius: 18, buttonRadius: 16, spacingScale: 100,
  cardGap: 18
};

const field = (value = "") => ({ value: String(value), checked: false });
const ids = [
  "cacheMode", "settingsMode", "designPreset", "designPresetInline",
  "autoDeriveColors", "autoDeriveColorsInline", "autoCollapseSidebar",
  "showProviderStripNav", "themeMode", "compactHeader", "accentPreset",
  "accentColor", "accentHex", "accentStrength", "uiDensity", "cardSize",
  "favoriteSize", "favoriteSizeMirror", "favoriteLayout", "favoriteLayoutMirror",
  "favoriteTextSize", "favoriteTextSizeMirror", "favoriteArtwork",
  "favoriteArtworkMirror", "cornerStyle", "backgroundStyle", "backgroundColor",
  "fontScale", "animationMode", "cardStyle", "shadowStyle", "showProviderStrip",
  "showHeroHome", "showHomeYoutube", "showHomeFavorites", "showHomePersonal",
  "showHomeCategories", "showReviewLink", "watchpartyEnabled", "watchpartyServer", "watchpartyRoom",
  "watchpartyName", "providerCardMeta", "showFavoriteMeta", "showFavoriteMetaMirror",
  "animationsEnabled", "uiSounds", "youtubeInMediathek", "autoplayNextEpisode",
  "introSkip", "direktModus", "youtubeDislikesEnabled", "rememberLanguage", "favoriteProgressMode",
  "pauseOnProviderSwitch", "pauseOnMinimize", "pauseOnBlur", "notifyNewEpisodes", "wrappedMusik",
  "whitelistInput", "adblockEnabled", "trackingEnabled", "popupBlockingEnabled",
  "redirectBlockingEnabled"
];

const controls = Object.fromEntries(ids.map((id) => [id, field()]));
controls.designPresetInline.value = "cinema";
controls.designPreset.value = "cinema";
controls.accentHex.value = "#147eff";
controls.accentColor.value = "#147eff";
controls.animationMode.value = "reduced";
controls.animationsEnabled.checked = true;
controls.uiSounds.checked = false;
controls.uiSoundVolume = field(61);
for (const [id, value] of [["animationSpeed", 73], ["hoverZoom", 105], ["hoverBrightness", 110], ["cardGap", 27], ["buttonHeight", 51]]) {
  controls[id] = field(value);
}

const pendingResolvers = [];
const calls = [];
const appearancePage = { classList: { contains: () => true } };
const context = {
  DEFAULT_APPEARANCE_SETTINGS: DEFAULT,
  settings: {
    appearance: {
      ...DEFAULT, animationMode: "reduced", animations: true,
      animationSpeed: 73, hoverZoom: 105, hoverBrightness: 110,
      uiSounds: false, uiSoundVolume: 61
    },
    playback: { autoplayNextEpisode: false },
    home: {}, watchparty: {}, wrapped: {}, sponsorblock: {}, adblock: {}, browser: {}
  },
  settingsModal: { open: true },
  settingsFormBereit: true,
  settingsSaveRevision: 0,
  settingsSavePending: false,
  settingsExternalUpdate: null,
  settingsSaveQueue: Promise.resolve(),
  watchpartyRaeume: [],
  sponsorblockFelder: {},
  SPONSORBLOCK_STANDARD: {},
  controls,
  document: {
    querySelector: (selector) => String(selector).includes("data-page=\"appearance\"") ? appearancePage : null
  },
  api: {
    saveAppearance: (appearance) => {
      calls.push(JSON.parse(JSON.stringify(appearance)));
      return new Promise((resolve) => pendingResolvers.push(() => resolve({
        ...context.settings,
        appearance: JSON.parse(JSON.stringify(appearance))
      })));
    },
    saveSettings: async (settings) => settings
  },
  JSON, Number, Boolean, String, Object, Array, Math, Promise,
  normalizeColor: (value, fallback = "#147eff") => /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : fallback,
  getRangeChoice: (name) => controls[name]?.value || "medium",
  readAdvancedAppearanceControls: () => ({
    animationSpeed: Number(controls.animationSpeed.value),
    hoverZoom: Number(controls.hoverZoom.value),
    hoverBrightness: Number(controls.hoverBrightness.value),
    cardGap: Number(controls.cardGap.value),
    buttonHeight: Number(controls.buttonHeight.value),
    uiSoundVolume: Number(controls.uiSoundVolume.value)
  }),
  syncMirroredFavoriteControls() {}, syncMirroredNavigationControls() {},
  syncMirroredAutoColorControls() {}, syncAutoColorLock() {}, applyAppearance() {},
  syncChoiceCards() {}, syncInlineLabels() {}, syncRangeLabels() {}, renderHome() {},
  renderProviders() {}, renderLibraryViews() {}, renderRueckblickEintrag: async () => {},
  recoverVisibleContent() {}, syncBrowserBounds() {}, showToast() {},
  mediathekSortierung: () => "manual", raumcodes: (rooms) => rooms.filter(Boolean),
  renderSettings() {
    const appearance = context.settings.appearance || {};
    for (const id of ["animationSpeed", "hoverZoom", "hoverBrightness", "cardGap", "buttonHeight", "uiSoundVolume"]) {
      if (controls[id] && appearance[id] !== undefined) controls[id].value = String(appearance[id]);
    }
    controls.uiSounds.checked = appearance.uiSounds !== false;
  }, derivedPalette: () => ({}), accentFromPreset: () => "#147eff",
  designPresets: () => ({ cinema: { themeMode: "dark", accentPreset: "red" }, custom: {} })
};
for (const [id, value] of Object.entries(controls)) context[id] = value;
vm.createContext(context);
vm.runInContext(`(${extractFunction("saveSettings")})`, context);
vm.runInContext(`(${extractFunction("applyDesignPreset")})`, context);
vm.runInContext(`(${extractFunction("designPresets")})`, context);
context.saveSettings = vm.runInContext(`(${extractFunction("saveSettings")})`, context);
context.applyDesignPreset = vm.runInContext(`(${extractFunction("applyDesignPreset")})`, context);
context.designPresets = vm.runInContext(`(${extractFunction("designPresets")})`, context);

const checks = [];
function check(name, condition) {
  checks.push(Boolean(condition));
  console.log(`${condition ? "OK  " : "FAIL"}  ${name}`);
}

(async () => {
  const first = context.saveSettings();
  first.catch((error) => console.error("first save error", error.stack || error));
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  check("erster Save ist vor dem zweiten IPC-Aufruf in-flight", calls.length === 1);
  controls.accentHex.value = "#e50914";
  controls.accentColor.value = "#e50914";
  const second = context.saveSettings();
  check("beide Aufrufe werden sofort als pending markiert", context.settingsSavePending === true);
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  if (!pendingResolvers.length) throw new Error("first appearance IPC was not called");
  pendingResolvers.shift()();
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  check("stale Antwort rollt den neueren Reglerstand nicht zurück", context.settings.appearance.accentColor === "#e50914");
  check("neueste Revision wird nach dem alten Abschluss geschrieben", calls.length === 2 && calls[1].accentColor === "#e50914");
  if (!pendingResolvers.length) throw new Error("latest appearance IPC was not called");
  pendingResolvers.shift()();
  await Promise.all([first, second]);
  check("pending endet nach der neuesten Antwort", context.settingsSavePending === false);

  context.settingsExternalUpdate = { ...context.settings, playback: { autoplayNextEpisode: true } };
  context.settings.appearance = { ...context.settings.appearance, accentColor: "#22c55e" };
  controls.accentHex.value = "#22c55e";
  controls.accentColor.value = "#22c55e";
  const externalMerge = context.saveSettings();
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  if (!pendingResolvers.length) throw new Error("external appearance IPC was not called");
  pendingResolvers.shift()();
  await externalMerge;
  check("externe Playback-Aenderung bleibt beim Appearance-Save erhalten", context.settings.playback.autoplayNextEpisode === true);

  context.settings.appearance = {
    ...context.settings.appearance,
    animationSpeed: 73, hoverZoom: 105, hoverBrightness: 110,
    uiSounds: false, uiSoundVolume: 61
  };
  context.api.saveAppearance = async (appearance) => ({ ...context.settings, appearance: JSON.parse(JSON.stringify(appearance)) });
  await context.applyDesignPreset("cinema");
  check("Preset bewahrt Animationstempo", context.settings.appearance.animationSpeed === 73);
  check("Preset bewahrt Hover-Zoom", context.settings.appearance.hoverZoom === 105);
  check("Preset bewahrt Sound-Einstellungen", context.settings.appearance.uiSounds === false && context.settings.appearance.uiSoundVolume === 61);
  check("Preset setzt nicht konfigurierte Kartendistanz deterministisch", context.settings.appearance.cardGap === 18);
  check("Preset setzt nicht konfigurierte Buttonhoehe deterministisch", context.settings.appearance.buttonHeight === 44);

  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} bestanden`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
