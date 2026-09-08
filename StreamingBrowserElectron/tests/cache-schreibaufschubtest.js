"use strict";

const assert = require("node:assert/strict");
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
