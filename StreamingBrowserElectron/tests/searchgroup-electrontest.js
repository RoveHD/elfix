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
  const code = [functionSource(renderer, "titelMitFundstelle"), functionSource(renderer, "searchResultCard"),
    "async " + functionSource(renderer, "renderProviderResults")].join("\n");
  const grouping = fs.readFileSync(path.join(root, "shared/search-grouping.js"), "utf8");
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
    ${grouping}
    const searchGroupingModul = globalThis.ELFIX_SEARCH_GROUPING;
    let activeSearchToken = 1;
    const globalSearchGrid = document.createElement('div');
    document.body.append(globalSearchGrid);
    const copy = document.createElement('p'); copy.id = 'searchCopy'; document.body.append(copy);
    const emptyText = text => Object.assign(document.createElement('p'), { textContent: text });
    const fremdtitelHinweis = () => '';
    const cloudflareHinweis = () => '';
    const artwork = [];
    const trefferbilderNachreichen = (...args) => artwork.push(args);
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
    let report, finish, fail, unsubscribed = 0;
    api.onSearchProgress = callback => { report = callback; return () => { unsubscribed += 1; }; };
    api.searchAll = (_query, requestId) => new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    const loading = document.createElement('div'); loading.className = 'search-loading'; globalSearchGrid.append(loading);
    const search = renderProviderResults('demon', 1);
    const fast = { providerId: 'a', providerName: 'AniWorld', results: [a.result] };
    report({ requestId: 0, query: 'demon', results: [fast] });
    const staleProgressIgnored = globalSearchGrid.querySelectorAll('.provider-result').length === 0;
    report({ requestId: 1, query: 'demon', results: [fast] });
    const firstCard = globalSearchGrid.querySelector('.provider-result');
    const usableBeforeCompletion = !!firstCard && loading.isConnected;
    firstCard.click(); await Promise.resolve(); await Promise.resolve();
    const partialClickable = opens.at(-1).providerId === 'a';
    const late = { providerId: 'b', providerName: 'S.to', results: [b.result] };
    report({ requestId: 1, query: 'demon', results: [late, fast] });
    const merged = firstCard.querySelectorAll('.result-provider-choice');
    const lateSourcesMerged = globalSearchGrid.querySelectorAll('.provider-result').length === 1
      && globalSearchGrid.querySelector('.provider-result') === firstCard && merged.length === 2
      && firstCard.dataset.resultUrl === a.result.url;
    merged[0].click();
    merged[0].focus();
    finish([late, fast]); await search;
    const finalPreservesChoice = globalSearchGrid.querySelector('.provider-result') === firstCard
      && firstCard.dataset.resultUrl === b.result.url && !loading.isConnected && unsubscribed === 1 && artwork.length === 1;
    const keyboardFocusPreserved = document.activeElement === merged[0];
    globalSearchGrid.replaceChildren();
    activeSearchToken = 2;
    const cancelled = renderProviderResults('demon', 2);
    activeSearchToken = 3;
    report({ requestId: 2, query: 'demon', results: [fast] }); finish([fast]); await cancelled;
    const navigationIgnoresProgress = globalSearchGrid.children.length === 0 && unsubscribed === 2;
    activeSearchToken = 4;
    const failed = renderProviderResults('demon', 4);
    report({ requestId: 4, query: 'demon', results: [fast] });
    fail(new Error('IPC getrennt')); await failed;
    const failureKeepsPartialResults = globalSearchGrid.querySelectorAll('.provider-result').length === 1
      && copy.textContent.includes('nicht vollständig') && unsubscribed === 3;
    return { initial, literal, switched, chipKeyboardDoesNotOpen, cardKeyboardOpensSelected, pendingRace,
      staleProgressIgnored, usableBeforeCompletion, partialClickable, lateSourcesMerged, finalPreservesChoice,
      keyboardFocusPreserved, navigationIgnoresProgress, failureKeepsPartialResults };
  })()`);
  for (const [name, ok] of Object.entries(result)) console.log(`${ok ? "OK" : "FAIL"}  ${name}`);
  win.destroy();
  app.exit(Object.values(result).every(Boolean) ? 0 : 1);
}).catch(error => { console.error(error.stack); app.exit(1); });
