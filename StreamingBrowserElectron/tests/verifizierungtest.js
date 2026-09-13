"use strict";
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const tor = require("../src/verifizierungstor");

const kandidat = { sichtbar: true, hatVerifizierung: true, knopfText: "Weiter", knopfDeaktiviert: false, geloest: true };
assert.equal(tor.istFreigegebenesTor(kandidat).klicken, true);
for (const extra of [
  { geloest: false }, { geloest: null }, { geloest: undefined }, { sichtbar: false },
  { hatVerifizierung: false }, { knopfDeaktiviert: true }, { knopfText: "Schließen" },
  { knopfText: "Weitere Informationen" }, { knopfText: "Jetzt gewinnen" }
]) assert.equal(tor.istFreigegebenesTor({ ...kandidat, ...extra }).klicken, false, JSON.stringify(extra));
for (const script of [tor.torScript(), tor.zustandScript(), tor.fensterScript(), tor.fensterScript(false)]) {
  assert.doesNotThrow(() => new Function(script));
}

const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
function funktion(name) {
  const start = main.search(new RegExp("(?:async )?function " + name + "\\("));
  assert.ok(start >= 0, name);
  return main.slice(start, main.indexOf("\n}", start) + 2);
}

(async () => {
  // Bereits geladene URL: die alte Abkuerzung uebersprang jede Verifizierung.
  let bestaetigt = 0;
  let geladen = 0;
  const view = { webContents: { getURL: () => "https://s.to/folge", isLoading: () => false } };
  const c = vm.createContext({
    providerModel: { isHttpUrl: () => true }, getProviderView: () => view,
    isLiveView: () => true, seiteGleich: (a, b) => a === b, direktModus: () => true,
    menschentorErkennen: async () => true,
    menschentorLoesenLassen: async (_provider, _view, options) => { bestaetigt++; return options.gueltig(); },
    seiteLaden: async () => { geladen++; return true; }
  });
  vm.runInContext(funktion("werkbankAn"), c);
  assert.equal(await c.werkbankAn({ id: "sto" }, "https://s.to/folge"), view);
  assert.equal(bestaetigt, 1);
  assert.equal(geladen, 0, "keine erneute Anfrage fuer die bestehende Sitzung");
  assert.equal(await c.werkbankAn({ id: "sto" }, "https://s.to/folge", () => false), null);

  const request = { until: 0 };
  const p = vm.createContext({ providerAutoplayRequests: new Map([["sto", request]]),
    Date, MENSCHENTOR_FRIST_MS: 120000, finishAutostart: () => {},
    logNextEpisode: () => {}, torKlickZeit: new Map() });
  vm.runInContext(funktion("torMeldungVerarbeiten"), p);
  p.torMeldungVerarbeiten({ id: "sto" }, "tor-gewartet:Bestätigung erforderlich");
  const frist = request.until;
  assert.equal(request.torWartet, true);
  p.torMeldungVerarbeiten({ id: "sto" }, "tor-gewartet:Bestätigung erforderlich");
  assert.equal(request.until, frist, "wiederholte Meldung verlaengert die Frist nicht endlos");
  p.torMeldungVerarbeiten({ id: "sto" }, "tor-frei");
  assert.equal(request.torWartet, false);
  assert.ok(request.until > Date.now() + 24000);
  let popupZiel = "";
  const popupView = { webContents: { getURL: () => "https://s.to/vorbereitung",
    loadURL: async (url) => { popupZiel = url; } } };
  const popup = vm.createContext({ menschentorFenster: { view: popupView, bestaetigt: false },
    isLiveView: () => true, providerModel: { isHttpUrl: (url) => /^https?:/.test(url) },
    isAllowedNewWindowTarget: (url) => url === "https://hoster.example/video" });
  vm.runInContext(funktion("direktVerifiziertesPopup"), popup);
  assert.equal(popup.direktVerifiziertesPopup({}, popupView, "https://hoster.example/video"), false);
  popup.menschentorFenster.bestaetigt = true;
  assert.equal(popup.direktVerifiziertesPopup({}, popupView, "https://werbung.example"), false);
  assert.equal(popup.direktVerifiziertesPopup({}, popupView, "https://hoster.example/video"), true);
  assert.equal(popupZiel, "https://hoster.example/video");
  console.log("OK Verifizierung: bestaetigte Freigabe, gleiche URL und getrennte Wartefristen");
})().catch((error) => { console.error(error); process.exitCode = 1; });
