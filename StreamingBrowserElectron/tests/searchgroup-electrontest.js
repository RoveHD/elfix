"use strict";

// Echte DOM-Pruefung der Renderer-Karte. Die Produktionsfunktion wird aus der
// Quelle geladen; nur ihre Seiteneffekte (IPC, Menue, Bild) sind lokal ersetzt.
const { app, BrowserWindow } = require("electron");
const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-searchgroup-test-"));
app.setPath("userData", profile);
app.disableHardwareAcceleration();

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw Error(`Funktion fehlt: ${name}`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = brace; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") { quote = char; continue; }
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw Error(`Funktion nicht abgeschlossen: ${name}`);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  const root = path.join(__dirname, "..");
  const renderer = fs.readFileSync(path.join(root, "src/renderer/renderer.js"), "utf8").replace(/\r\n/g, "\n");
  const code = [functionSource(renderer, "titelMitFundstelle"), functionSource(renderer, "searchResultCard")].join("\n");
  await win.loadURL("data:text/html,<main></main>");
  const result = await win.webContents.executeJavaScript(`(async () => {
    const opens = [], toasts = [];
    let resolveFavorite;
    let favorites = [];
    let activeProviderId = null;
    const api = {
      setShellOpen: async () => {},
      openProviderUrl: async (providerId, url) => { opens.push({ providerId, url }); return { activeProviderId: providerId }; },
      addSearchResultToWatchlist: () => new Promise(resolve => { resolveFavorite = resolve; })
    };
    const bildEbeneSetzen = (card, image) => { card.dataset.image = image || ''; };
    const vorschlagMenueAnhaengen = () => {};
    const stehtInWatchlist = (url) => favorites.some(item => item.url === url && item.favorite !== false);
    const hideContentViews = () => {};
    const setCurrentRoute = () => {};
    const renderProviders = () => {};
    const renderFavorites = () => {};
    const renderHome = () => {};
    const posterHinzufuegenEffekt = () => {};
    const showToast = message => toasts.push(message);
    ${code}
    const a = { provider: { providerId: 'a', providerName: 'AniWorld' }, result: { title: 'Demon <img src=x>', url: 'https://a/title', image: 'a.jpg' } };
    const b = { provider: { providerId: 'b', providerName: 'S.to' }, result: { title: 'Demon <img src=x>', url: 'https://b/title', image: 'b.jpg' } };
    const card = searchResultCard(a.result, a.provider, 'demon', [a, b]);
    document.body.append(card);
    const chips = [...card.querySelectorAll('.result-provider-choice')];
    const initial = chips[0].getAttribute('aria-pressed') === 'true' && chips[0].classList.contains('is-active')
      && chips[1].getAttribute('aria-pressed') === 'false';
    const literal = card.querySelector('strong').textContent === a.result.title && !card.querySelector('strong img');
    chips[1].click();
    const switched = card.dataset.resultUrl === b.result.url && card.dataset.image === 'b.jpg'
      && chips[1].getAttribute('aria-pressed') === 'true' && chips[1].classList.contains('is-active');
    chips[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const chipKeyboardDoesNotOpen = opens.length === 0;
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await Promise.resolve();
    const cardKeyboardOpensSelected = opens.length === 1 && opens[0].providerId === 'b' && opens[0].url === b.result.url;
    chips[0].click();
    card.querySelector('.result-fav').click();
    chips[1].click();
    resolveFavorite({ added: true, already: false, title: a.result.title, favorites: [{ url: a.result.url, favorite: true }] });
    await Promise.resolve(); await Promise.resolve();
    const heart = card.querySelector('.result-fav');
    const pendingRace = heart.textContent === '♡' && !heart.classList.contains('is-active')
      && toasts.at(-1).includes(a.result.title);
    return { initial, literal, switched, chipKeyboardDoesNotOpen, cardKeyboardOpensSelected, pendingRace };
  })()`);
  for (const [name, ok] of Object.entries(result)) console.log(`${ok ? "OK" : "FAIL"}  ${name}`);
  win.destroy();
  app.exit(Object.values(result).every(Boolean) ? 0 : 1);
}).catch(error => { console.error(error.stack); app.exit(1); });
