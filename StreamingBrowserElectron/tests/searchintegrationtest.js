"use strict";

// Diese Pruefung laedt die echten Suchfunktionen aus main.js, aber ohne
// Electron. Der lokale Server zeigt dadurch, dass das Signal wirklich durch
// Ajax, HTML-Fallback und Varianten wandert.
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const vm = require("vm");
const { createSearchCoordinator } = require("../src/search-coordinator");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
const from = source.indexOf("async function searchAllProviders(");
const to = source.indexOf("// --- Das Bild eines Treffers", from);
if (from < 0 || to < 0) throw new Error("Suchfunktionen in main.js nicht gefunden");
const actualSearch = source.slice(from, to);
const checks = [];
const check = (name, value) => { checks.push(Boolean(value)); console.log(`${value ? "OK  " : "FAIL"}  ${name}`); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function startServer() {
  let ajax = 0; let html = 0; let ajaxClosed = 0;
  const app = http.createServer((req, res) => {
    if (req.url === "/ajax/search") {
      ajax += 1;
      req.on("close", () => { if (!res.writableEnded) ajaxClosed += 1; });
      setTimeout(() => { if (!res.writableEnded) res.end(JSON.stringify([])); }, 120);
      return;
    }
    html += 1;
    res.setHeader("content-type", "text/html");
    res.end('<a href="/show/demo">Demo</a>');
  });
  await new Promise(resolve => app.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  return { base, counts: () => ({ ajax, html, ajaxClosed }), close: () => new Promise(resolve => app.close(resolve)) };
}

(async () => {
  const server = await startServer();
  try {
    const context = {
      fetch, URL, URLSearchParams, Set, Array, String, Object, Promise,
      providerModel: { buildSearchUrl: (provider, query) => `${provider.startUrl}/search?q=${encodeURIComponent(query)}` },
      enabledProviders: () => [],
      searchQueryVariants: query => [query, `${query}-alias`],
      usesAniWorldAjaxSearch: provider => provider.ajax === true,
      absoluteHttpUrl: (href, base) => new URL(href, base).href,
      isNoiseUrl: () => false, isProviderResultUrl: () => true,
      usableResultTitle: value => String(value || "").replace(/<[^>]*>/g, "").trim(),
      cleanAnchorText: value => String(value || "").replace(/<[^>]*>/g, "").trim(),
      titleFromPath: () => "", isNoiseTitle: () => false, matchesQuery: () => true,
      queryTokens: () => [],
      extractSearchLinks: (html, base) => html.includes("Demo") ? [{ title: "Demo", url: new URL("/show/demo", base).href }] : [],
      providerSearchFailure: (provider, searchUrl, error) => ({ providerId: provider.id, searchUrl, error, results: [] })
    };
    vm.createContext(context); vm.runInContext(actualSearch, context);
    const ajaxProvider = { id: "ani", name: "AniWorld", startUrl: server.base, ajax: true };
    const controller = new AbortController();
    const cancelled = context.searchProvider(ajaxProvider, "alt", controller.signal);
    await sleep(25); controller.abort();
    await assert.rejects(cancelled, error => error.name === "AbortError");
    await sleep(25);
    check("abgebrochenes Ajax startet weder HTML-Fallback noch Alias-Variante", server.counts().ajax === 1 && server.counts().html === 0);
    check("Ajax-Fetch erhielt und befolgte das Signal", server.counts().ajaxClosed >= 1);

    const htmlProvider = { id: "html", name: "HTML", startUrl: server.base, ajax: false };
    const fallback = await context.searchProvider(htmlProvider, "demo", new AbortController().signal);
    check("normaler HTML-Fallback bleibt funktionsfaehig", fallback.results.length === 1 && fallback.results[0].title === "Demo");

    const coordinator = createSearchCoordinator({ ttlMs: 1000, maxEntries: 4 });
    const before = server.counts().html;
    const run = () => coordinator.request({ key: "same-provider-snapshot", owner: "renderer", execute: signal => context.searchAllProviders("demo", signal, [htmlProvider]) });
    await run(); await run();
    check("identische erfolgreiche Hauptprozess-Suche wird einmal ausgefuehrt", server.counts().html === before + 1);
  } finally { await server.close(); }
  console.log(`${checks.filter(Boolean).length}/${checks.length} bestanden`);
  process.exit(checks.every(Boolean) ? 0 : 1);
})().catch(error => { console.error(error); process.exit(1); });
