"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { erstellen } = require("../src/watchparty-abfrage");
const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
const anfang = main.indexOf("function meldeWatchpartyStandAusSeite(");
const ende = main.indexOf("// Ein offener Sprungwunsch", anfang);
assert.ok(anfang > 0 && ende > anfang);
let uhr = 0, abfragen = 0, url = "https://aniworld.to/anime/stream/a/staffel-1/episode-1";
let raum = "raum-a", sitzung = "eins", antwort;
const meldungen = [];
const view = { webContents: { id: 1, getURL: () => url } };
const gate = erstellen({ jetzt: () => uhr });
const kontext = vm.createContext({
  watchpartyAbfrage: gate,
  watchparty: { aktiv: true, verbunden: true, meldeStand: (...args) => meldungen.push(args) },
  isLiveView: v => Boolean(v?.webContents), activeView: view, overlayReasons: new Set(),
  spielerLauf: null, spielerView: null,
  watchpartyLiveKeyForUrl: () => "titel", watchpartyRaumForUrl: () => raum,
  watchpartySitzungFuer: () => sitzung, webContentsProvider: new Map([[1, "aniworld"]]),
  episodeIdentity: () => ({ season: 1, episode: 1 }),
  executeJavaScriptInMediaFrames: () => { abfragen++; return new Promise(resolve => { antwort = resolve; }); }
});
vm.runInContext(main.slice(anfang, ende), kontext);
const push = () => kontext.meldeWatchpartyStandAusSeite(view, 42, false, 41.98);
const poll = () => kontext.meldeWatchpartyStand();
async function ergebnis(durchlauf, position = 41) {
  antwort([{ position, paused: false }]);
  await durchlauf;
}
(async () => {
  // Zwei Minuten echte Main-Aufrufwege mit sekündlichen Meldungen: der alte
  // feste 5-s-Abruf haette 24 Frame-Durchlaeufe gestartet, jetzt keinen.
  for (uhr = 1000; uhr <= 120000; uhr += 1000) {
    push();
    if (uhr % 5000 === 0) await poll();
  }
  assert.equal(abfragen, 0);
  assert.equal(meldungen.length, 120);
  assert.equal(meldungen.at(-1)[1].frameTime, 41.98);
  uhr += 5000;
  const erster = poll();
  await poll();
  assert.equal(abfragen, 1, "Keine parallelen Ersatzabfragen");
  await ergebnis(erster);
  assert.equal(meldungen.length, 121, "Ausbleibende Meldungen aktivieren den Ersatzweg");
  const ueberholt = poll();
  push();
  const nachPush = meldungen.length;
  await ergebnis(ueberholt, 3);
  assert.equal(meldungen.length, nachPush, "Frische Framezeit gewinnt gegen alte Ersatzantwort");
  await poll();
  assert.equal(abfragen, 2, "Nach Erholung ruhen Ersatzabfragen wieder");

  uhr += 5000;
  const navigiert = poll();
  gate.verwerfen(view.webContents);
  await ergebnis(navigiert);
  assert.equal(meldungen.length, nachPush, "Auch Neuladen derselben URL verwirft alte Proben");
  const andererRaum = poll();
  raum = "raum-b";
  await ergebnis(andererRaum);
  assert.equal(meldungen.length, nachPush);
  const andereSitzung = poll();
  sitzung = "zwei";
  await ergebnis(andereSitzung);
  assert.equal(meldungen.length, nachPush);
  const andereAnsicht = poll();
  kontext.activeView = null;
  await ergebnis(andereAnsicht);
  assert.equal(meldungen.length, nachPush);
  kontext.activeView = view;

  kontext.spielerLauf = { id: 1 };
  kontext.spielerView = view;
  const vorMini = abfragen;
  const vorMiniMeldungen = meldungen.length;
  push();
  assert.equal(meldungen.length, vorMiniMeldungen, "Eine besuchte Anbieterseite ueberschreibt nie die laufende Player-Meldung");
  await poll();
  assert.equal(abfragen, vorMini, "Eigener Player/Miniplayer hat seinen eigenen Meldeweg");
  kontext.spielerLauf = null;
  kontext.spielerView = null;
  kontext.executeJavaScriptInMediaFrames = async () => { throw Error("Frame nicht erreichbar"); };
  await assert.doesNotReject(poll());
  kontext.executeJavaScriptInMediaFrames = async () => [{ position: 50, paused: true }];
  await poll();
  assert.equal(meldungen.at(-1)[1].position, 50, "Fehler geben den Abfrageriegel wieder frei");
  assert.equal(meldungen.at(-1)[1].paused, true);
  console.log("OK Watchparty-Ersatzabfrage: 24 auf 0 bei gesunden Meldungen; Ausfall, Erholung, Ueberlappung, Navigation, Raum, Sitzung und Miniplayer geprueft");
})().catch(error => { console.error(error); process.exitCode = 1; });

