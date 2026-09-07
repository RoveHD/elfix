"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/renderer/renderer.js"), "utf8");
function extract(name) {
  const start = source.indexOf(`async function ${name}(`);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}
let opened = 0, fetched = 0;
const favorite = { id: "anime", title: "Ein Titel" };
const context = {
  heroMetadataCache: new Map(), titelDetailsBauen: () => ({ replaceWith() {} }),
  favorites: [favorite], homeHero: { dataset: { targetType: "favorite", targetId: "anime" } },
  document: { createElement: () => ({ append() {} }) },
  verlaufModellBauen: item => item, titelAktionen: () => null, verlaufListeBauen: () => null,
  displayFavoriteTitle: item => item.title, verlaufKopfText: () => "Stand",
  confirmAction: options => { assert.equal(options.title, "Ein Titel"); opened++; return Promise.resolve(); },
  api: { getLibraryMetadata: () => { fetched++; return Promise.resolve(null); } }
};
vm.createContext(context);
vm.runInContext(extract("zeigeVerlauf") + "\n" + extract("openHeroDetails"), context);
(async () => {
  assert.match(source, /heroDetails\?\.addEventListener\("click", openHeroDetails\)/);
  await context.openHeroDetails();
  assert.equal(opened, 1, "Details oeffnet Titelinformationen");
  assert.equal(fetched, 1, "Details nutzt die vorhandene Metadatenabfrage");
  context.homeHero.dataset.targetId = "geloescht";
  await context.openHeroDetails();
  context.homeHero.dataset.targetType = "provider";
  await context.openHeroDetails();
  assert.equal(opened, 1, "Veraltete und Anbieter-Ziele bleiben ohne Wirkung");
  await context.zeigeVerlauf(favorite);
  assert.equal(fetched, 2, "Bisheriger Verlauf behaelt seinen Metadatenabruf");
  let resolveMetadata;
  context.confirmModal = { open: true, contains: () => false };
  context.confirmCopy = { textContent: "Andere Rueckfrage" };
  context.trailerKnopfNachtragen = () => { throw Error("Falscher Dialog"); };
  context.api.getLibraryMetadata = () => new Promise(resolve => { resolveMetadata = resolve; });
  const pending = context.zeigeVerlauf(favorite);
  resolveMetadata({ titel: "Ein Titel" });
  await pending;
  assert.equal(context.confirmCopy.textContent, "Andere Rueckfrage", "Spaete Metadaten duerfen keinen anderen Dialog veraendern");
  const knoten = () => ({ children: [], append(child) { this.children.push(child); },
    addEventListener(name, fn) { this[name] = fn; }, remove() { this.removed = true; } });
  let resolveFavorite;
  const actions = {
    document: { createElement: knoten },
    api: { setFavoriteWatchlist: () => new Promise(resolve => { resolveFavorite = resolve; }) },
    favorites: [], renderFavorites() {}, renderHome() {}, renderLibraryViews() {}, renderFavoriteToggle() {}, showToast() {},
    displayFavoriteTitle: item => item.title
  };
  const actionStart = source.indexOf("function titelAktionen(");
  vm.createContext(actions);
  vm.runInContext(source.slice(actionStart, source.indexOf("\n}", actionStart) + 2), actions);
  const watchButton = actions.titelAktionen(favorite).children[1];
  const event = { currentTarget: watchButton };
  const saved = watchButton.click(event);
  // Nach dem Event-Dispatch setzt der Browser currentTarget auf null.
  event.currentTarget = null;
  resolveFavorite({ favorite: { ...favorite, favorite: true } });
  await saved;
  assert.equal(watchButton.removed, true, "Watchlist-Aktion funktioniert nach asynchronem Speichern");
  console.log("OK: Details ohne Autoplay, mit vorhandenen Metadaten; Dialogwechsel und Watchlist-Aktion bleiben sicher.");
})().catch(error => { console.error(error); process.exitCode = 1; });
