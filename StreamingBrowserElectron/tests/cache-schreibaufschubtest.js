"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { erstellen } = require("../src/cache-schreibaufschub");

let miniAktiv = false;
let stand = "eins";
const geschrieben = [];
const uhren = [];
const geloescht = [];
const ablage = erstellen({
  wartenMs: 1500,
  gesperrt: () => miniAktiv,
  schreiben: () => geschrieben.push(stand),
  uhrStellen: (rueckruf, wartenMs) => {
    const uhr = { rueckruf, wartenMs, unref() {} };
    uhren.push(uhr);
    return uhr;
  },
  uhrLoeschen: (uhr) => geloescht.push(uhr)
});

// Schon geplant, dann beginnt PiP: auch dieser alte Timer darf nicht mitten
// in der nativen Fensterbewegung serialisieren oder schreiben.
ablage.planen();
assert.equal(uhren.length, 1);
assert.equal(uhren[0].wartenMs, 1500);
miniAktiv = true;
uhren.shift().rueckruf();
assert.deepEqual(geschrieben, []);

// Weitere Aenderungen im PiP erzeugen weder Arbeit noch einen zweiten Timer.
stand = "zwei";
ablage.planen();
assert.equal(uhren.length, 0);

// Verlassen oder Schliessen gibt genau einen spaeten Schreibvorgang frei. Er
// liest beim Ausfuehren den neuesten Stand, nicht den vor PiP gemerkten.
miniAktiv = false;
ablage.freigeben();
ablage.freigeben();
assert.equal(uhren.length, 1);
uhren.shift().rueckruf();
assert.deepEqual(geschrieben, ["zwei"]);

// Ein normaler spaeter Schreibvorgang bleibt unveraendert gebuendelt.
stand = "drei";
ablage.planen();
ablage.planen();
assert.equal(uhren.length, 1);
uhren.shift().rueckruf();
assert.deepEqual(geschrieben, ["zwei", "drei"]);

// Beim App-Ende wird auch waehrend PiP sofort der letzte Stand geschrieben;
// der alte Timer ist erledigt und kann denselben Stand nicht doppelt ablegen.
stand = "vier";
ablage.planen();
miniAktiv = true;
const alteUhr = uhren.shift();
ablage.sofort();
assert.deepEqual(geloescht, [alteUhr]);
assert.deepEqual(geschrieben, ["zwei", "drei", "vier"]);
alteUhr.rueckruf();
assert.deepEqual(geschrieben, ["zwei", "drei", "vier"]);

console.log("OK Cache-Schreibaufschub: vor PiP geplant, im PiP gebuendelt, nach Exit/Close oder beim App-Ende geschrieben");

// Die echten Hauptprozess-Anbindungen muessen beide Caches auch im normalen
// Player zurueckhalten. Der generische Scheduler allein konnte diesen Fehler
// nicht erkennen: nur PiP war dort als Sperre angeschlossen.
const hauptquelle = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
const timer = [];
const workerAuftraege = [];
const kontext = vm.createContext({
  spielerMiniAktiv: false, spielerView: null,
  TASTE_FILE: "taste.json", METADATEN_FILE: "metadaten.json",
  tasteStand: { fassung: 1 }, metadatenStand: { fassung: 1 },
  loadTasteCache: () => kontext.tasteStand,
  cacheSchreibkanal: { schreiben: (datei, daten) => workerAuftraege.push({ datei, fassung: daten.fassung }) },
  cacheSchreibaufschub: { erstellen: optionen => erstellen({ ...optionen,
    uhrStellen: rueckruf => { const uhr = { rueckruf, unref() {} }; timer.push(uhr); return uhr; },
    uhrLoeschen: uhr => { const index = timer.indexOf(uhr); if (index >= 0) timer.splice(index, 1); }
  }) }
});
for (const name of ["tasteCacheAblage", "metadatenCacheAblage"]) {
  const anfang = hauptquelle.indexOf(`${name} = cacheSchreibaufschub.erstellen({`);
  assert.ok(anfang >= 0, `${name}: produktive Anbindung gefunden`);
  const ende = hauptquelle.indexOf("\n});", anfang);
  vm.runInContext(hauptquelle.slice(anfang, ende + 4), kontext);
}
const freigabeStart = hauptquelle.indexOf("function optionaleCachesNachMiniPlanen() {");
vm.runInContext(hauptquelle.slice(freigabeStart, hauptquelle.indexOf("\n}", freigabeStart) + 2), kontext);
const planen = () => { kontext.tasteCacheAblage.planen(); kontext.metadatenCacheAblage.planen(); };
const ablaufen = () => { for (const uhr of timer.splice(0)) uhr.rueckruf(); };
planen();
assert.equal(timer.length, 2);
kontext.spielerView = { webContents: {} };
ablaufen();
assert.deepEqual(workerAuftraege, [], "vor Playerstart geplante Timer klonen waehrend der Wiedergabe nicht");
kontext.tasteStand.fassung = 2;
kontext.metadatenStand.fassung = 2;
planen();
kontext.spielerMiniAktiv = true;
planen();
kontext.spielerMiniAktiv = false;
kontext.optionaleCachesNachMiniPlanen();
assert.equal(timer.length, 0, "Rueckkehr aus PiP startet keine Cachearbeit im weiterlaufenden Player");
kontext.spielerView = null;
kontext.optionaleCachesNachMiniPlanen();
kontext.optionaleCachesNachMiniPlanen();
assert.equal(timer.length, 2, "Schliessen gibt je Cache genau einen Auftrag frei");
ablaufen();
assert.deepEqual(workerAuftraege, [{ datei: "taste.json", fassung: 2 }, { datei: "metadaten.json", fassung: 2 }]);
kontext.spielerView = { webContents: {} };
kontext.tasteStand.fassung = 3;
kontext.metadatenStand.fassung = 3;
planen();
kontext.tasteCacheAblage.sofort();
kontext.metadatenCacheAblage.sofort();
assert.deepEqual(workerAuftraege.slice(2), [{ datei: "taste.json", fassung: 3 }, { datei: "metadaten.json", fassung: 3 }],
  "App-Ende speichert trotz offenem Player den letzten Stand");
console.log("OK Hauptprozess-Caches: normaler Player, PiP-Rueckkehr, Nachholen und App-Ende");
