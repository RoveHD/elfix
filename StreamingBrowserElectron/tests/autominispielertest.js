"use strict";

// Der Desktop-Hauptprozess liefert nur den mit User-Geste ausgefuehrten Auftrag.
// Diese Pruefung deckt die letzte Schutzlinie im Renderer ab: nur das wirklich
// laufende Bild darf automatisch PiP anfordern, eine vorhandene PiP-Sitzung
// bleibt unangetastet und eine abgelehnte Uebergabe gibt den Mini-Status frei.
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const quelle = fs.readFileSync(path.join(__dirname, "../src/renderer/spieler.js"), "utf8").replace(/\r\n/g, "\n");
const start = quelle.indexOf("function spieltFuerAutoMini()");
const ende = quelle.indexOf("function spielenUmschalten()", start);
assert.ok(start >= 0 && ende > start, "Auto-Mini-Funktionen fehlen im Player");
const code = quelle.slice(start, ende);

function umgebung({ playing = true, schonPip = false, fremdesPip = false, lehntAb = false } = {}) {
  let anfragen = 0;
  const status = [];
  const bild = {
    paused: !playing,
    ended: false,
    readyState: 2,
    requestPictureInPicture: async () => {
      anfragen += 1;
      if (lehntAb) throw Error("PiP abgelehnt");
    }
  };
  const document = {
    pictureInPictureEnabled: true,
    get pictureInPictureElement() { return schonPip ? bild : (fremdesPip ? {} : null); }
  };
  const kontext = vm.createContext({
    bild, document, HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
    bruecke: { miniStatus: (wert, vorbereiten) => status.push([wert, Boolean(vorbereiten)]) }
  });
  vm.runInContext(code, kontext);
  return { kontext, anfragen: () => anfragen, status };
}

(async () => {
  let test = umgebung();
  assert.equal(await test.kontext.miniAutomatisch(), true);
  assert.equal(test.anfragen(), 1, "laufendes Bild fordert PiP genau einmal an");
  assert.deepEqual(test.status, [[true, true]], "der Übergang schützt vor der Minimieren-Pause, ohne PiP schon als aktiv auszugeben");

  test = umgebung({ playing: false });
  assert.equal(await test.kontext.miniAutomatisch(), false);
  assert.equal(test.anfragen(), 0, "Pause betritt PiP nie automatisch");

  test = umgebung({ schonPip: true });
  assert.equal(await test.kontext.miniAutomatisch(), true);
  assert.equal(test.anfragen(), 0, "bestehendes manuelles PiP bleibt erhalten");

  test = umgebung({ fremdesPip: true });
  assert.equal(await test.kontext.miniAutomatisch(), false);
  assert.equal(test.anfragen(), 0, "ein fremdes PiP wird nicht ersetzt");

  test = umgebung({ lehntAb: true });
  assert.equal(await test.kontext.miniAutomatisch(), false);
  assert.deepEqual(test.status, [[true, true], [false, false]], "eine abgelehnte Übergabe gibt den Pausenschutz frei");
  console.log("OK Auto-Mini-Player: Playback, Pause, vorhandenes PiP und Ablehnung");
})().catch((fehler) => { console.error(fehler.stack || fehler); process.exitCode = 1; });
