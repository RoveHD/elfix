"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const quelle = fs.readFileSync(path.join(__dirname, "../src/renderer/renderer.js"), "utf8").replace(/\r/g, "");
function funktion(name) {
  const start = quelle.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  return quelle.slice(start, quelle.indexOf("\n}", start) + 2);
}
const ansicht = () => ({ hidden: true, classList: { contains() { return this.view.hidden; } } });
const aufrufe = [];
const kontext = {
  libraryView: ansicht(), continueView: ansicht(), historyView: ansicht(), favoritesView: ansicht(),
  renderLibraryContent: () => aufrufe.push("library"),
  renderContinueContent: () => aufrufe.push("continue"),
  renderHistoryContent: () => aufrufe.push("history"),
  favoriteEntries: () => { aufrufe.push("watchlist"); return []; },
  favoritesGrid: { replaceChildren() {} }, favoritesEmpty: { classList: { toggle() {} } }
};
for (const name of ["libraryView", "continueView", "historyView", "favoritesView"]) {
  kontext[name].classList.view = kontext[name];
}
vm.createContext(kontext);
vm.runInContext(funktion("renderLibraryViews") + "\n" + funktion("renderFavorites"), kontext);
for (let i = 0; i < 100; i += 1) {
  kontext.renderLibraryViews();
  kontext.renderFavorites();
}
assert.equal(aufrufe.length, 0, "100 Hintergrundupdates bauen keine verborgenen Listen");
for (const [view, erwartet] of [["libraryView", "library"], ["continueView", "continue"], ["historyView", "history"], ["favoritesView", "watchlist"]]) {
  kontext[view].hidden = false;
  kontext.renderLibraryViews();
  kontext.renderFavorites();
  assert.equal(aufrufe.pop(), erwartet);
  assert.equal(aufrufe.length, 0, "Nur die sichtbare Ansicht wird aufgebaut");
  kontext[view].hidden = true;
}
for (const name of ["showLibrary", "showContinue", "showHistory", "showFavorites"]) {
  const code = funktion(name);
  assert.ok(code.indexOf('classList.remove("is-hidden")') < code.lastIndexOf("render"), "Navigation zeichnet erst nach dem Einblenden");
}
console.log("OK: 100 Hintergrundupdates ohne Listenaufbau; alle vier Ansichten werden beim Oeffnen aktualisiert.");
