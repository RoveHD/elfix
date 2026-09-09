"use strict";

// Der echte Import-Handler mit Dialogersatz und einer isolierten Dateiablage.
// Bereits geladene Caches muessen nach einem Import auch beim Weiterschreiben
// den eingelesenen Bestand bewahren; fehlende Abschnitte bleiben erhalten.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const sicherung = require("../src/sicherung");
const providerModel = require("../shared/provider-model");
const source = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");

function funktion(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}

function buehne(backup, { bestaetigt = true, warm = true } = {}) {
  const dateien = new Map([
    ["backup", JSON.stringify(backup)],
    ["providers", "[]"],
    ["fassungen", JSON.stringify({ version: 1, eintraege: { alt: { key: "1", roh: "german" } } })],
    ["marken", JSON.stringify({ version: 1, eintraege: { alt: { marke: { von: 10, nach: 90 } } } })]
  ]);
  let importieren;
  const geschrieben = [];
  const c = vm.createContext({
    console: { log() {} }, sicherung, providerModel,
    fs: {
      readFileSync(datei) { if (!dateien.has(datei)) throw Error("ENOENT"); return dateien.get(datei); },
      writeFileSync(datei, wert) { geschrieben.push(datei); dateien.set(datei, wert); }
    },
    ipcMain: { handle(_name, handler) { importieren = handler; } },
    dialog: {
      showOpenDialog: async () => ({ filePaths: ["backup"] }),
      showMessageBox: async () => ({ response: bestaetigt ? 1 : 0 })
    },
    mainWindow: {}, settings: { watchparty: {} }, providers: [], favorites: [], watchpartyLokal: {},
    activeProviderId: null, activeView: null,
    providerViews: new Map(), providerViewRecords: new WeakMap(),
    SETTINGS_FILE: "settings", FAVORITES_FILE: "favorites", PROVIDER_FILE: "providers",
    WATCHPARTY_FILE: "watchparty", SESSION_FILE: "sessions", SITZUNG_SCHEMA_VERSION: 1,
    FASSUNGEN_FILE: "fassungen", MARKEN_FILE: "marken",
    fassungSpeicher: null, fassungSchmutzig: false, markenSpeicher: null, markenSchmutzig: false,
    fassungWartet: new Map([["anbieter", 123]]), fassungGemeldet: new Map([["anbieter", "alt"]]),
    sitzungenSpeicher: null, sitzungenSchmutzig: false,
    ensureDataDir() {}, selbstSichern() {}, loadSettings: () => ({}), loadFavorites: () => [],
    loadWatchpartyLocal: () => ({}), loadSitzungen: () => [],
    watchpartyWiederhergestellt: new Set(), watchpartyZustandBestaetigt: new Set(),
    geraete: { ablageSetzen() {} }, syncWatchparty() {}, syncGeraete() {}, syncFern() {},
    sendActiveState() {}, publicSettings: wert => wert
  });
  c.enabledProviders = () => c.providers.filter(provider => provider.enabled);
  vm.runInContext(["loadMarken", "saveMarken", "loadFassungen", "saveFassungen", "loadProviders", "reuseProviderRecords"]
    .map(funktion).join("\n"), c);
  if (warm) {
    c.loadMarken();
    c.loadFassungen();
    // Auch noch ausstehende alte Schreibmarker duerfen den Import nicht
    // zurueckdrehen; bei einer Sicherung ohne diese Teile bleiben sie dagegen.
    c.markenSchmutzig = c.fassungSchmutzig = true;
  }
  const start = source.indexOf('ipcMain.handle("data:backup-import"');
  vm.runInContext(source.slice(start, source.indexOf('\nipcMain.handle("data:confirm-reset"', start)), c);
  return { c, dateien, geschrieben, importieren };
}

const voll = () => ({
  kennung: sicherung.KENNUNG, fassung: sicherung.FASSUNG, providers: [],
  fassungen: { version: 1, eintraege: { neu: { key: "3", roh: "japanese-german" } } },
  marken: { version: 1, eintraege: { neu: { marke: { von: 20, nach: 100 } } } }
});

(async () => {
  for (const warm of [true, false]) {
    const b = buehne(voll(), { warm });
    assert.equal((await b.importieren()).restored, true);
    assert.deepEqual(Object.keys(b.c.loadFassungen()), ["neu"]);
    assert.deepEqual(Object.keys(b.c.loadMarken()), ["neu"]);
    assert.equal(b.c.fassungSchmutzig, false);
    assert.equal(b.c.markenSchmutzig, false);
    assert.equal(b.c.fassungWartet.size, 0);
    assert.equal(b.c.fassungGemeldet.size, 0);
    b.c.loadFassungen().danach = { key: "2", roh: "english" };
    b.c.loadMarken().danach = { marke: { von: 30, nach: 120 } };
    b.c.fassungSchmutzig = b.c.markenSchmutzig = true;
    b.c.saveFassungen(); b.c.saveMarken();
    for (const datei of ["fassungen", "marken"]) {
      assert.deepEqual(Object.keys(JSON.parse(b.dateien.get(datei)).eintraege), ["neu", "danach"]);
    }
  }

  for (const fehlend of [{}, { fassungen: null, marken: null }]) {
    const b = buehne({ kennung: sicherung.KENNUNG, fassung: 1, ...fehlend });
    const sprachen = b.c.loadFassungen(), marken = b.c.loadMarken();
    assert.equal((await b.importieren()).restored, true);
    assert.equal(b.c.loadFassungen(), sprachen);
    assert.equal(b.c.loadMarken(), marken);
    assert.equal(b.c.fassungSchmutzig, true);
    assert.equal(b.c.markenSchmutzig, true);
    assert.equal(b.geschrieben.includes("fassungen"), false);
    assert.equal(b.geschrieben.includes("marken"), false);
  }

  const leer = buehne({ ...voll(), fassungen: { version: 1, eintraege: {} }, marken: { version: 1, eintraege: {} } });
  assert.equal((await leer.importieren()).restored, true);
  assert.equal(Object.keys(leer.c.loadFassungen()).length, 0);
  assert.equal(Object.keys(leer.c.loadMarken()).length, 0);
  assert.equal(leer.c.providers.length, 0);
  assert.equal(leer.geschrieben.includes("providers"), true);

  const anbieter = { id: "aktiv", name: "Aktiv", startUrl: "https://old.example/", enabled: true };
  for (const providers of [[], [{ ...anbieter, id: "anders" }], [{ ...anbieter, enabled: false }]]) {
    const b = buehne({ ...voll(), providers });
    b.c.providers = [{ ...anbieter }];
    b.c.activeProviderId = anbieter.id;
    b.c.activeView = {};
    assert.equal((await b.importieren()).restored, true);
    assert.equal(b.c.activeProviderId, null, "Entfernte oder deaktivierte Anbieter bleiben nicht aktiv");
    assert.equal(b.c.activeView, null, "Schliessen der Einstellungen holt keine entfernte Ansicht zurueck");
  }
  const behalten = buehne({ ...voll(), providers: [{ ...anbieter, startUrl: "https://new.example/" }] });
  const record = { ...anbieter }, view = {};
  behalten.c.providers = [record];
  behalten.c.activeProviderId = record.id;
  behalten.c.activeView = view;
  behalten.c.providerViews.set(record.id, view);
  behalten.c.providerViewRecords.set(view, record);
  assert.equal((await behalten.importieren()).restored, true);
  assert.equal(behalten.c.activeProviderId, record.id);
  assert.equal(behalten.c.activeView, view);
  assert.equal(behalten.c.providers[0], record);
  assert.equal(record.startUrl, "https://new.example/");

  const abgesagt = buehne(voll(), { bestaetigt: false });
  assert.equal((await abgesagt.importieren()).restored, false);
  assert.equal(abgesagt.geschrieben.length, 0);
  assert.deepEqual(Object.keys(abgesagt.c.loadFassungen()), ["alt"]);
  console.log("OK Sicherungsimport: warme/kalte Caches, Weiterschreiben, alte Formate, leere Abschnitte und Abbruch");
})().catch(error => { console.error(error); process.exitCode = 1; });
