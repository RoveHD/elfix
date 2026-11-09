"use strict";
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const tor = require("../src/verifizierungstor");

const maske = tor.dialogMaskeScript("elfix-klick", "warten");
for (const script of [tor.torScript(), tor.zustandScript(), tor.fensterScript(), tor.fensterScript(false), maske]) {
  assert.doesNotThrow(() => new Function(script));
}
assert.doesNotMatch(tor.torScript(), /\.click\s*\(|requestSubmit\s*\(|\.submit\s*\(/,
  "Verifizierung darf weder klicken noch Formulare absenden");
assert.doesNotMatch(maske, /\.click\s*\(|requestSubmit\s*\(|\.submit\s*\(/,
  "Auch die Maske klickt nicht - sie deckt nur ab und wieder auf");

// Eine Sperre ohne Kasten: die ganze Seite ist die Abfrage.
//
// Gemeldet als "Bestaetigung wird vorbereitet ..." mit einem Balken, der nie
// endet. Die Maske legt eine Abdeckung ueber die Seite und schneidet dann ein
// Loch fuer den Dialog hinein; DDoS-Guard hat keinen Dialog, also blieb die
// Abdeckung ganz liegen und niemand sah je die Abfrage, die er haette
// bestaetigen sollen. Jetzt deckt sie in diesem Fall auf und meldet es.
assert.match(maske, /ganzseitig/, "Die Maske muss die vollflaechige Sperre kennen");
assert.match(maske, /well-known\/ddos-guard/, "DDoS-Guard gehoert zu den Merkmalen");
assert.match(maske, /cdn-cgi\/challenge-platform/, "Cloudflares vollflaechige Fassung ebenso");
// Und die Vorsicht dazu: hinter dem Dienst liegt der ganze Anbieter, sein
// Pruefskript steht auch auf der richtigen Folgenseite. Ohne diese Bedingung
// waere jede Seite eine Sperre.
assert.match(maske, /echterInhalt/, "Ohne Inhaltspruefung waere jede Seite eine Sperre");

// Das Raetselfenster von hCaptcha liegt nicht im Dialog, sondern am Ende der
// Seite. Gemeldet fuer AniWorld: Haekchen gesetzt, und nichts passiert
// sichtbar - das Fenster lag unter der Abdeckung. Das Loch muss um jedes
// sichtbare Abfragefenster mitwachsen, sonst bedient man etwas, das man nicht
// sieht.
assert.match(maske, /hcaptcha\.com/, "Das hCaptcha-Fenster muss ins Loch");
assert.match(maske, /kasten\.contains\(fenster\)/,
  "Ein Fenster im Dialog ist ohnehin schon frei - nur die draussen zaehlen");
assert.match(maske, /nurKasten/,
  "Die Rundung gilt nur ohne zusaetzliches Fenster, sonst schnitte sie es ab");

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
  p.torMeldungVerarbeiten({ id: "sto" }, "tor-bestaetigt:Serverfreigabe wird abgewartet");
  assert.equal(request.torWartet, true, "Token allein gibt den Autostart noch nicht frei");
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
