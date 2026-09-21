"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.join(__dirname, "..");
const standModul = require("../src/geraete-stand");
const schluessel = require("../src/geraete-schluessel");
const copy = (value) => JSON.parse(JSON.stringify(value));
const titel = (name, episode = 3) => ({ id: name, title: name, type: "serie",
  url: `https://aniworld.to/anime/stream/${name}/staffel-1/episode-${episode}`,
  providerName: "AniWorld", providerId: "aniworld", season: 1, episode,
  position: 360, currentTime: 360, duration: 1400, progress: 26,
  lastWatchedAt: "2026-09-21T12:00:00Z", favorite: false, activity: [{ episode: 2 }] });
const stand = (entry) => schluessel.stand({ ...entry, key: standModul.titelSchluessel(entry) });

let transport;
class Transport {
  constructor(callbacks) { transport = callbacks; }
  konfigurieren() {}
  status() { return {}; }
}
const events = [];
const modul = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT,
  "../android/app/src/main/assets/kern/eigen/geraete-bruecke.js"), "utf8"), {
  require: (name) => name === "geraete" ? { Geraeteabgleich: Transport }
    : require(path.join(ROOT, "src", name + ".js")),
  module: modul, exports: modul.exports, console,
  window: { crypto: { randomUUID: () => "neuer-eintrag" },
    ElfixKern: { ereignis: (name, daten) => events.push({ name, daten: copy(daten) }) } }
});
const bridge = modul.exports;
bridge.konfigurieren({ enabled: true });
bridge.anbieterSetzen([{ id: "aniworld", name: "AniWorld", startUrl: "https://aniworld.to/" }]);
function eingang(liste, ...staende) {
  bridge.favoritenSetzen(copy(liste));
  for (const s of staende) transport.onEintrag(s);
  transport.onFertig(staende.length);
  const batch = events.at(-2);
  assert.equal(batch.name, "geraete:aenderungen");
  return batch.daten;
}
let tests = 0;
function pruefe(name, test) { test(); tests++; console.log("OK " + name); }

pruefe("Fremder Titel setzt Wise Man nicht von Folge 4 auf 3 zurueck", () => {
  const alt = titel("wise-mans-grandchild", 3);
  const aktuell = { ...titel("wise-mans-grandchild", 4), currentTime: 900, position: 900 };
  const raum = { ...titel("tomb-raider-king", 6), watchpartyRoom: "runde" };
  const neuLokal = titel("lokal-neu", 1);
  const batch = eingang([alt, raum], stand(titel("dark", 2)));
  const result = bridge.aenderungenUebernehmen([aktuell, raum, neuLokal], batch);
  assert.equal(result.geaendert, true);
  assert.equal(result.favoriten.find((e) => e.id === aktuell.id).episode, 4);
  assert.equal(result.favoriten.find((e) => e.id === aktuell.id).position, 900);
  assert.equal(result.favoriten.length, 4);
  assert.deepEqual(copy(result.favoriten.find((e) => e.id === raum.id)), raum);
});
pruefe("Verspaeteter Stand derselben Serie gewinnt nicht gegen lokale Wiedergabe", () => {
  const alt = titel("wise-mans-grandchild", 3);
  const batch = eingang([alt], stand({ ...alt, position: 400 }));
  const lokal = titel("wise-mans-grandchild", 5);
  const result = bridge.aenderungenUebernehmen([lokal], batch);
  assert.equal(result.geaendert, false);
  assert.deepEqual(copy(result.favoriten), [lokal]);
});
pruefe("Lokale Bilder und Verlauf verhindern keinen gueltigen PC-Fortschritt", () => {
  const alt = titel("wise-mans-grandchild", 3);
  const batch = eingang([alt], stand(titel("wise-mans-grandchild", 4)));
  // org.json darf Objektschluessel beim Weg durch Java anders anordnen.
  batch.aenderungen[0].vorher = Object.fromEntries(Object.entries(batch.aenderungen[0].vorher).reverse());
  const lokal = { ...alt, customThumbnail: "lokales-bild", newEpisodeLabel: "lokaler-hinweis" };
  const result = bridge.aenderungenUebernehmen([lokal], batch);
  assert.equal(result.favoriten[0].episode, 4);
  assert.equal(result.favoriten[0].id, alt.id);
  assert.equal(result.favoriten[0].customThumbnail, "lokales-bild");
  assert.deepEqual(copy(result.favoriten[0].activity), alt.activity);
});
pruefe("Grabstein loescht nur die unveraenderte private Vorversion", () => {
  const alt = titel("wise-mans-grandchild", 3);
  const raum = { ...alt, id: "raum", watchpartyRoom: "familie" };
  bridge.favoritenSetzen(copy([alt, raum]));
  transport.onWeg(standModul.titelSchluessel(alt)); transport.onFertig(1);
  const batch = events.at(-2).daten;
  const unveraendert = bridge.aenderungenUebernehmen([alt, raum], batch);
  assert.equal(unveraendert.favoriten.length, 1);
  assert.equal(unveraendert.favoriten[0].watchpartyRoom, "familie");
  const neuer = bridge.aenderungenUebernehmen([titel("wise-mans-grandchild", 4), raum], batch);
  assert.equal(neuer.geaendert, false);
  assert.equal(neuer.favoriten.length, 2);
});
pruefe("Mehrere empfangene Staende desselben Titels bleiben in Reihenfolge", () => {
  const alt = titel("wise-mans-grandchild", 3);
  const batch = eingang([alt], stand({ ...alt, position: 400 }), stand({ ...alt, position: 500 }));
  const result = bridge.aenderungenUebernehmen([alt], batch);
  assert.equal(result.favoriten[0].position, 500);
  assert.equal(batch.aenderungen.length, 2);
});
pruefe("Neuanlage und zweiter Stand desselben Titels verlieren keine Aenderung", () => {
  const neu = titel("neue-serie", 1);
  const batch = eingang([], stand(neu), stand({ ...neu, position: 700 }));
  const result = bridge.aenderungenUebernehmen([], batch);
  assert.equal(result.favoriten.length, 1);
  assert.equal(result.favoriten[0].position, 700);
});
assert.equal(events.some((e) => e.name === "geraete:favoriten"), false,
  "Der Android-Sync sendet keine alte Gesamtliste mehr");
console.log(`${tests}/${tests} Android-Geraetebestand-Pruefungen bestanden`);
