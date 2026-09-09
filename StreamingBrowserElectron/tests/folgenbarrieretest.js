"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const taste = require("../src/taste");
const sync = require("../src/watchparty-sync");
const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
function funktion(name) {
  const start = main.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return main.slice(start, main.indexOf("\n}", start) + 2);
}
const folge = n => `https://aniworld.to/anime/stream/bleach/staffel-1/episode-${n}`;
const eintrag = { key: "serie:bleach", room: "probe", url: folge(2) };
const prepare = { type: "syncprepare", key: eintrag.key, room: eintrag.room,
  syncId: "folge-zwei", url: folge(2), position: 0, videoTime: 0, playing: false, reason: "episode-change" };
async function pruefen() {
  const befehle = [];
  const meldungen = [];
  let ladenBeenden;
  let ladeOptionen;
  let aktuell = true;
  const context = vm.createContext({
    taste, console, watchpartySync: sync, Date,
    spielerLauf: { id: 1, url: folge(1) }, spielerTakt: { stelle: 120 },
    spielerSyncBereit: null, spielerFolgenVorbereitung: null,
    spielerAnbieter: () => ({ id: "aniworld" }),
    spielerBefehl: befehl => befehle.push(befehl),
    istGleicheFolge: (a, b) => a === b,
    watchpartyPasstZurFolge: () => true,
    episodeIdentity: () => ({ season: 1, episode: 2 }),
    ohneWatchpartyFolgenwechselEcho: (_provider, _url, fn) => fn(),
    direktFolgeSpielen: (_provider, url, optionen) => {
      ladeOptionen = optionen;
      return new Promise(resolve => { ladenBeenden = () => {
        context.spielerLauf = { id: 2, url }; resolve({ ok: true });
      }; });
    },
    watchpartyEreignis: () => ({ videoTime: 0, playing: false }),
    watchpartyLaeuftDanach: () => false,
    watchparty: {
      serverJetzt: () => Date.now(),
      bereitZumStart: (key, room, syncId, ok = true) => meldungen.push({ syncId, ok })
    }, sendToast: () => {}
  });
  vm.runInContext(funktion("spielerRundenNachrichtPasst") + "\n" + funktion("spielerSteuernAusRunde"), context);
  assert.equal(context.spielerRundenNachrichtPasst(eintrag, prepare, { tun: "syncprepare" }), true,
    "Die alte Folge muss die Vorbereitung fuer die neue annehmen");
  const arbeit = context.spielerSteuernAusRunde(eintrag, prepare, { tun: "syncprepare" }, false, () => aktuell);
  assert.equal(befehle.length, 1);
  assert.equal(befehle[0].laufen, false, "Alte Folge stoppt vor dem Laden");
  assert.equal(ladeOptionen.rundeWarten, true, "Neue Quelle darf nicht lokal starten");
  assert.equal(context.spielerSyncBereit, null, "Ladevorgang ist noch keine Bereitschaft");
  ladenBeenden();
  assert.equal(await arbeit, true);
  assert.equal(befehle[1].laufen, false);
  assert.equal(befehle[1].stelle, 0);
  assert.equal(context.spielerSyncBereit.auftragId, 2, "Bereitschaft gilt fuer die neue Quelle");
  assert.equal(context.spielerSyncBereit.syncId, prepare.syncId);
  assert.ok(befehle[1].bereitId);
  context.spielerLauf = { id: 3, url: folge(1) };
  context.spielerSyncBereit = null;
  befehle.length = 0;
  const veraltet = context.spielerSteuernAusRunde(eintrag, prepare, { tun: "syncprepare" }, false, () => aktuell);
  aktuell = false;
  ladenBeenden();
  await veraltet;
  assert.equal(befehle.length, 1, "Ueberholte Vorbereitung darf keine Bereitschaft mehr ausloesen");
  assert.equal(context.spielerSyncBereit, null);
  // Schweigen darf sie aber auch nicht: sonst wartet die Runde die volle
  // Frist auf eine Bereitmeldung, die niemand mehr schickt - das gemeldete
  // "Warten auf alle", bei dem neunzig Sekunden lang nichts ging.
  assert.deepEqual(meldungen, [{ syncId: prepare.syncId, ok: false }],
    "Die aufgegebene Vorbereitung liess die Runde im Ungewissen");
  meldungen.length = 0;
  aktuell = true;
  context.spielerLauf = { id: 4, url: folge(1) };
  const ablauf = context.spielerSteuernAusRunde(eintrag, prepare, { tun: "syncprepare" }, false, () => aktuell);
  const timeout = { ...prepare, reason: "sync-timeout", action: "pause" };
  assert.equal(context.spielerRundenNachrichtPasst(eintrag, timeout, { tun: "anwenden" }), true,
    "Eine Absage muss auch den noch auf der alten Folge ladenden Player erreichen");
  aktuell = false;
  await context.spielerSteuernAusRunde(eintrag, timeout, { tun: "anwenden" }, false);
  assert.equal(context.spielerFolgenVorbereitung, null);
  ladenBeenden();
  await ablauf;
  assert.equal(context.spielerSyncBereit, null, "Nach Ladefrist keine verspaetete Bereitschaft");
  /*
   * Das Nachfassen.
   *
   * Erwartet werden beim Folgenwechsel die Geraete, die den Titel wirklich im
   * Player haben. Wer in genau dem Augenblick keinen frischen Stand hatte -
   * eine Sekunde nach einem Wiederanschluss etwa - bekommt die Vorbereitung
   * nicht. Der gemeinsame Start allein wechselt die Folge nicht: er springt
   * und spielt. Ohne diesen Weg bliebe so jemand auf der alten Folge sitzen.
   */
  aktuell = true;
  befehle.length = 0;
  context.spielerLauf = { id: 5, url: folge(1) };
  context.spielerSyncBereit = null;
  const start = { type: "syncstart", key: eintrag.key, room: eintrag.room, syncId: "folge-zwei",
    url: folge(2), position: 0, videoTime: 0, playing: true, episodeId: "s1e2" };
  const nachfassen = context.spielerSteuernAusRunde(eintrag, start, { tun: "syncstart" }, false, () => aktuell);
  assert.equal(ladeOptionen.rundeWarten, undefined,
    "Das Nachfassen ist keine Vorbereitung mehr - die Runde laeuft schon");
  ladenBeenden();
  assert.equal(await nachfassen, true, "Ein Start fuer eine andere Folge blieb unbeantwortet");
  assert.equal(context.spielerLauf.url, folge(2), "Der Player blieb auf der alten Folge stehen");

  // Und wer schon dort steht, wird davon nicht noch einmal geladen.
  aktuell = true;
  context.spielerLauf = { id: 6, url: folge(2) };
  let nochmalGeladen = false;
  const vorher = context.direktFolgeSpielen;
  context.direktFolgeSpielen = (...args) => { nochmalGeladen = true; return vorher(...args); };
  assert.equal(await context.spielerSteuernAusRunde(eintrag, start, { tun: "syncstart" }, false, () => aktuell), true);
  assert.equal(nochmalGeladen, false, "Derselbe Start lud die schon offene Folge erneut");
  context.direktFolgeSpielen = vorher;

  // Eine andere Serie bleibt tabu - niemand landet ungefragt woanders.
  context.spielerLauf = { id: 7, url: "https://aniworld.to/anime/stream/andere/staffel-1/episode-1" };
  nochmalGeladen = false;
  context.direktFolgeSpielen = (...args) => { nochmalGeladen = true; return vorher(...args); };
  await context.spielerSteuernAusRunde(eintrag, start, { tun: "syncstart" }, false, () => aktuell);
  assert.equal(nochmalGeladen, false, "Ein fremder Titel wurde mitgezogen");
  context.direktFolgeSpielen = vorher;

  console.log("OK Folgenbarriere: neue Folge pausiert laden, erst Player bereit melden, veraltete Vorbereitung verwerfen, verpasste Vorbereitung nachholen");
}
pruefen().catch(error => { console.error(error); process.exitCode = 1; });
