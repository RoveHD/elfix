"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "renderer.js"), "utf8");
function between(start, end) {
  const from = source.indexOf(start); const to = source.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`nicht gefunden: ${start}`);
  return source.slice(from, to);
}
const implementation = [
  between("async function enterInternalMode(", "async function showHome"),
  between("async function showGlobalSearch(", "// Ein Suchtreffer"),
  between("function hideContentViews(", "function switchToPlayerView"),
  between("function emptyText(", "async function enterInternalMode")
].join("\n");

function node() {
  return { className: "is-hidden", textContent: "", children: [], dataset: {},
    classList: { add(c) { if (!thisOwner.className.includes(c)) thisOwner.className += ` ${c}`; }, remove(c) { thisOwner.className = thisOwner.className.replace(c, "").trim(); }, contains(c) { return thisOwner.className.includes(c); } },
    replaceChildren(...items) { this.children = items; }, append(...items) { this.children.push(...items); }, addEventListener() {} };
  var thisOwner;
}
// classList braucht eine feste Rueckreferenz, ohne Browser-DOM.
function element() { const n = { className: "", textContent: "", children: [], dataset: {}, replaceChildren(...x) { n.children = x; }, append(...x) { n.children.push(...x); }, addEventListener() {} }; n.classList = { add: c => { if (!n.className.includes(c)) n.className += ` ${c}`; }, remove: c => { n.className = n.className.replace(c, "").trim(); }, contains: c => n.className.includes(c) }; return n; }

(async () => {
  const waits = [];
  let cancels = 0; const rendered = [];
  const globalSearchView = element(); globalSearchView.className = "is-hidden";
  const context = {
    String, Promise, Array, Object, window: { setTimeout() {} },
    api: { showHome: () => new Promise(resolve => waits.push(resolve)), cancelSearch: () => { cancels += 1; return Promise.resolve(); } },
    globalSearchView, homeView: element(), favoritesView: element(), libraryView: null, continueView: null, historyView: null, reviewView: null, watchpartyView: null, discoveryView: null,
    document: { createElement: element, querySelector: () => element(), querySelectorAll: () => [] },
    searchTitle: element(), searchHistoryNode: element(), globalSearchGrid: element(), providers: [], favorites: [],
    activeSearchToken: 0, activeSearchQuery: "", currentUrl: "", activeProviderId: null,
    showWatchpartyLive() {}, renderProviders() {}, renderFavoriteToggle() {}, setCurrentRoute() {}, rememberSearch() {}, renderSearchHistory() {}, favoriteEntries: () => [], emptyText: text => ({ textContent: text }), escapeHtml: x => x,
    syncBrowserBounds() {}, renderProviderResults: (query, token) => rendered.push([query, token]), entdeckungMerkeScroll() {}, entdeckungBeobachter: null
  };
  vm.createContext(context); vm.runInContext(implementation, context);
  const first = context.showGlobalSearch("alt");
  const second = context.showGlobalSearch("neu");
  await Promise.resolve();
  waits[1]({}); await second;
  waits[0]({}); await first;
  assert.deepStrictEqual(rendered.map(x => x[0]), ["neu"]);
  assert.ok(!globalSearchView.classList.contains("is-hidden"));
  const leaving = context.showGlobalSearch("weg");
  await Promise.resolve();
  context.hideContentViews();
  waits[2]({}); await leaving;
  assert.deepStrictEqual(rendered.map(x => x[0]), ["neu"]);
  assert.ok(globalSearchView.classList.contains("is-hidden"));
  const hidden = context.showGlobalSearch("verborgen");
  await Promise.resolve();
  context.hideContentViews();
  waits[3]({}); await hidden;
  assert.deepStrictEqual(rendered.map(x => x[0]), ["neu"]);
  assert.ok(cancels >= 2);
  console.log("OK  schnelle Suche laesst spaetere alte Antwort nicht auferstehen");
  console.log("OK  Navigation weg invalidiert auch waehrend laufendem await");
  console.log("OK  verborgene pending Suche wird beim Ansichtswechsel invalidiert");
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
