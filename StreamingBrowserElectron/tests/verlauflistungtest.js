"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const quelle = fs.readFileSync(path.join(__dirname, "../src/renderer/renderer.js"), "utf8").replace(/\r/g, "");
function funktion(name) {
  const start = quelle.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return quelle.slice(start, quelle.indexOf("\n}", start) + 2);
}
const node = (tag) => ({
  tag, children: [], textContent: "", className: "", innerHTML: "",
  append(...children) { this.children.push(...children); },
  addEventListener() {}
});
const kontext = vm.createContext({
  document: { createElement: node },
  escapeHtml: String,
  cleanFavoriteTitle: (title) => title,
  favoriteEpisodeLabel: () => "",
  openFavoriteEntry() {}
});
const formatStart = quelle.indexOf("const historyDatumsFormat =");
const formatEnd = quelle.indexOf("\n\nfunction historyTagesSchluessel", formatStart);
vm.runInContext(quelle.slice(formatStart, formatEnd) + "\n" + [
  "historyTagesSchluessel", "historyTagesTitel", "historyVerdichten", "historyKinder", "historyRow"
].map(funktion).join("\n"), kontext);

// Viele Zeilen und Tage: jede Tagesueberschrift zaehlt genau ihre Eintraege.
// Die Anzahl der Datumsoperationen prueft die Skalierung ohne fragile Zeitlimits.
let schluesselAufrufe = 0;
let titelAufrufe = 0;
const schluessel = kontext.historyTagesSchluessel;
const titel = kontext.historyTagesTitel;
kontext.historyTagesSchluessel = (zeit) => { schluesselAufrufe++; return schluessel(zeit); };
kontext.historyTagesTitel = (zeit) => { titelAufrufe++; return titel(zeit); };
const favorite = { id: "serie", title: "Serie", url: "https://example.org/serie" };
const rows = [];
for (let tag = 0; tag < 20; tag++) {
  for (let nummer = 0; nummer < 50; nummer++) {
    const bis = new Date(2025, 2, 31 - tag, 12, nummer).getTime();
    rows.push({ favorite, event: {}, label: `Folge ${nummer}`, von: bis, bis, anzahl: 1 });
  }
}
const kinder = kontext.historyKinder(rows);
const koepfe = kinder.filter((kind) => kind.tag === "h2");
assert.equal(kinder.filter((kind) => kind.tag === "button").length, 1000);
assert.equal(koepfe.length, 20);
assert.ok(koepfe.every((kopf) => kopf.children[0].textContent === "50 Einträge"));
assert.ok(schluesselAufrufe <= 2000, "Tageszuordnung bleibt linear");
assert.equal(titelAufrufe, 20, "Datumsbeschriftung nur einmal je Tagesgruppe");

// Wiederholungen bleiben zusammen; ein lokaler Tageswechsel trennt sie.
const event = (datum) => ({ favorite, event: { at: datum.toISOString(), label: "Folge 1" } });
const ereignisse = [event(new Date(2025, 2, 31, 0, 10)), event(new Date(2025, 2, 31, 0, 1)), event(new Date(2025, 2, 30, 23, 59))];
const vorher = JSON.stringify(ereignisse);
const verdichtet = kontext.historyVerdichten(ereignisse);
assert.equal(verdichtet.length, 2);
assert.equal(verdichtet[0].anzahl, 2);
assert.equal(verdichtet[1].anzahl, 1);
assert.equal(JSON.stringify(ereignisse), vorher, "Originalverlauf unveraendert");
assert.equal(kontext.historyKinder(verdichtet).filter((n) => n.tag === "h2").length, 2);
assert.equal(kontext.historyKinder([]).length, 0);

// Auch direkt an der Sieben-Tage-Grenze bleibt ein Kalendertag eine Gruppe.
const grenze = new Date();
grenze.setDate(grenze.getDate() - 7);
const morgens = new Date(grenze.getFullYear(), grenze.getMonth(), grenze.getDate(), 0, 1).getTime();
const abends = new Date(grenze.getFullYear(), grenze.getMonth(), grenze.getDate(), 23, 59).getTime();
const grenzRows = [abends, morgens].map((bis) => ({ favorite, event: {}, label: "Folge", von: bis, bis, anzahl: 1 }));
const grenzKoepfe = kontext.historyKinder(grenzRows).filter((n) => n.tag === "h2");
assert.equal(grenzKoepfe.length, 1);
assert.equal(grenzKoepfe[0].children[0].textContent, "2 Einträge");
console.log("OK: 1000 Verlaufszeilen linear gruppiert; Tageszaehler, Wiederholungen und Tageswechsel erhalten.");
