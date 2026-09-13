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
  const abgleiche = [];
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
    watchpartyLaeuftDanach: (nachricht) => Boolean(nachricht?.playing),
    watchparty: {
      serverJetzt: () => Date.now(),
      bereitZumStart: (key, room, syncId, ok = true) => meldungen.push({ syncId, ok }),
      abgleichen: (key, room) => abgleiche.push({ key, room })
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
  assert.equal(ladeOptionen.rundeWarten, true,
    "Die nachgeholte Quelle darf vor dem autoritativen Rundenstand nicht lokal starten");
  ladenBeenden();
  assert.equal(await nachfassen, true, "Ein Start fuer eine andere Folge blieb unbeantwortet");
  assert.equal(context.spielerLauf.url, folge(2), "Der Player blieb auf der alten Folge stehen");
  assert.equal(befehle.some((befehl) => befehl.laufen === true), false,
    "Ein alter Start-Schnappschuss lief nach dem Laden noch los");
  assert.deepEqual(abgleiche.at(-1), { key: eintrag.key, room: eintrag.room },
    "Nach dem Laden wurde kein frischer Hoststand angefordert");

  // Ist die Runde am Ziel angehalten, muss auch das Nachholen angehalten
  // enden. Der Quellenauftrag darf die neue Folge nicht kurz lokal starten.
  befehle.length = 0;
  context.spielerLauf = { id: 9, url: folge(1) };
  const pauseNachholen = context.spielerSteuernAusRunde(eintrag,
    { ...start, syncId: "folge-zwei-pause", position: 33, videoTime: 33, playing: false },
    { tun: "syncstart" }, false, () => aktuell);
  assert.equal(ladeOptionen.rundeWarten, true);
  ladenBeenden();
  assert.equal(await pauseNachholen, true);
  assert.equal(befehle.some((befehl) => befehl.laufen === true), false,
    "Eine pausierte Runde startete beim Nachholen lokal los");

  // Die Funktion allein ist nicht der echte Empfangsweg. Vor ihr entscheidet
  // der Dispatcher, ob irgendein Player Ziel der Nachricht ist. Genau dort
  // wurde der Nachholpfad bisher als "andere Folge" verworfen und war damit
  // trotz des Tests oben im Betrieb unerreichbar.
  let empfangen = false;
  const dispatch = vm.createContext({
    taste, console, watchpartySync: sync,
    spielerLauf: { id: 8, url: folge(1) },
    providerViews: new Map(),
    watchpartyLetztesEreignis: new Map(),
    aktiverWatchpartyRaum: () => eintrag.room,
    watchpartyEintrag: () => ({ ...eintrag, hostId: "host", myId: "gast" }),
    episodeIdentity: (url) => {
      const treffer = String(url || "").match(/staffel-(\d+)\/episode-(\d+)/);
      return treffer ? { season: Number(treffer[1]), episode: Number(treffer[2]) } : null;
    },
    istGleicheFolge: (a, b) => a === b,
    isLiveView: () => false,
    spielerSteuernAusRunde: async () => { empfangen = true; return true; },
    sendWatchpartyLive: () => {},
    tempoAusRundeSetzen: () => {},
    fassungAusRundeSetzen: async () => {},
    followWatchpartyEpisode: async () => {},
    prepareWatchpartySync: async () => {},
    watchpartyEreignis: () => ({ videoTime: 0, playing: true }),
    watchpartyLaeuftDanach: () => true,
    watchpartyApplyScript: () => "",
    watchpartyDriftScript: () => "",
    watchpartyPasstZurFolge: (episodeId, url) => {
      const offen = String(url).match(/staffel-(\d+)\/episode-(\d+)/);
      return Boolean(offen && episodeId === `s${offen[1]}e${offen[2]}`);
    },
    providers: [],
    executeJavaScriptInMediaFrames: async () => [],
    logMediaDiagnostic: () => {}
  });
  vm.runInContext([
    funktion("spielerRundenNachrichtPasst"),
    funktion("watchpartySteuerungHatZiel"),
    funktion("applyWatchpartyControl")
  ].join("\n"), dispatch);
  await dispatch.applyWatchpartyControl({ ...start, action: "syncstart", sequenceId: 90, timestamp: Date.now() });
  assert.equal(empfangen, true,
    "Der echte Dispatcher verwarf den Folgen-Nachholstart vor dem Player");

  // Waerend die Quelle geladen wird, kann die Runde am Ziel schon wieder
  // pausieren. Diese Pause trifft den noch alten Player absichtlich nicht. Der
  // alte Start-Schnappschuss darf danach aber ebenso wenig loslaufen: der neue
  // Player bleibt wartend und fordert den aktuellen Hoststand an.
  const raceBefehle = [];
  const raceAbgleiche = [];
  let raceLadenBeenden;
  const race = vm.createContext({
    taste, console, watchpartySync: sync, Date,
    spielerLauf: { id: 20, url: folge(1) },
    spielerTakt: { stelle: 0, laeuft: false, puffert: false, at: Date.now() },
    spielerSyncBereit: null, spielerFolgenVorbereitung: null,
    providerViews: new Map(), watchpartyLetztesEreignis: new Map(),
    aktiverWatchpartyRaum: () => eintrag.room,
    watchpartyEintrag: () => ({ ...eintrag, hostId: "host", myId: "gast" }),
    episodeIdentity: (url) => {
      const treffer = String(url || "").match(/staffel-(\d+)\/episode-(\d+)/);
      return treffer ? { season: Number(treffer[1]), episode: Number(treffer[2]) } : null;
    },
    istGleicheFolge: (a, b) => a === b,
    watchpartyPasstZurFolge: (episodeId, url) => {
      const offen = String(url).match(/staffel-(\d+)\/episode-(\d+)/);
      return Boolean(offen && episodeId === `s${offen[1]}e${offen[2]}`);
    },
    isLiveView: () => false,
    spielerAnbieter: () => ({ id: "aniworld" }),
    spielerBefehl: (befehl) => { raceBefehle.push(befehl); return true; },
    ohneWatchpartyFolgenwechselEcho: (_provider, _url, fn) => fn(),
    direktFolgeSpielen: (_provider, url, optionen) => new Promise((resolve) => {
      assert.equal(optionen.rundeWarten, true);
      raceLadenBeenden = () => {
        race.spielerLauf = { id: 21, url };
        resolve({ ok: true });
      };
    }),
    watchparty: {
      verbunden: true,
      serverJetzt: () => Date.now(),
      bereitZumStart: () => {},
      abgleichen: (key, room) => raceAbgleiche.push({ key, room })
    },
    sendToast: () => {}, sendWatchpartyLive: () => {},
    tempoAusRundeSetzen: () => {}, fassungAusRundeSetzen: async () => {},
    followWatchpartyEpisode: async () => {}, prepareWatchpartySync: async () => {},
    watchpartyEreignis: (nachricht) => ({ videoTime: nachricht.position, playing: nachricht.playing }),
    watchpartyLaeuftDanach: (nachricht) => Boolean(nachricht.playing),
    watchpartyApplyScript: () => "", watchpartyDriftScript: () => "",
    providers: [], executeJavaScriptInMediaFrames: async () => [], logMediaDiagnostic: () => {}
  });
  vm.runInContext([
    funktion("spielerRundenNachrichtPasst"),
    funktion("spielerSteuernAusRunde"),
    funktion("watchpartySteuerungHatZiel"),
    funktion("applyWatchpartyControl")
  ].join("\n"), race);
  const raceStart = race.applyWatchpartyControl({
    ...start, action: "syncstart", playing: true, sequenceId: 100, timestamp: 1000
  });
  assert.equal(typeof raceLadenBeenden, "function", "Der Nachholauftrag begann nicht");
  await race.applyWatchpartyControl({
    ...start, action: "pause", playing: false, position: 7, videoTime: 7,
    sequenceId: 101, timestamp: 1001
  });
  raceLadenBeenden();
  await raceStart;
  assert.equal(raceBefehle.some((befehl) => befehl.laufen === true), false,
    "Der alte Catch-up-Start gewann nach dem Laden gegen die neuere Pause");
  assert.deepEqual(raceAbgleiche, [{ key: eintrag.key, room: eintrag.room }],
    "Der neue Player fragte den aktuellen Hoststand nicht nach");

  // Dasselbe gilt fuer den eingebetteten Anbieterplayer. Beim Nachholen muss
  // sein normaler Autostart ausbleiben; erst der pausierte Rundenstand darf
  // auf der neuen Seite angewendet werden.
  let webUrl = folge(1);
  let webVorbereiten = false;
  const webAktionen = [];
  const webAutostarts = [];
  const webAbgleiche = [];
  let webVersuche = 0;
  let ersterWebVersuch;
  const ersterWebVersuchDa = new Promise((resolve) => { ersterWebVersuch = resolve; });
  const webView = { webContents: { getURL: () => webUrl } };
  const webDispatch = vm.createContext({
    taste, console, watchpartySync: sync, Date, setTimeout, Promise,
    spielerLauf: null,
    providerViews: new Map([["aniworld", webView]]),
    watchpartyLetztesEreignis: new Map(),
    aktiverWatchpartyRaum: () => eintrag.room,
    watchpartyEintrag: () => ({ ...eintrag, hostId: "host", myId: "gast" }),
    episodeIdentity: (url) => {
      const treffer = String(url || "").match(/staffel-(\d+)\/episode-(\d+)/);
      return treffer ? { season: Number(treffer[1]), episode: Number(treffer[2]) } : null;
    },
    istGleicheFolge: (a, b) => a === b,
    isLiveView: () => true,
    spielerSteuernAusRunde: async () => false,
    sendWatchpartyLive: () => {},
    tempoAusRundeSetzen: () => {},
    fassungAusRundeSetzen: async () => {},
    followWatchpartyEpisode: async (_eintrag, nachricht) => {
      webVorbereiten = nachricht.vorbereiten;
      webUrl = nachricht.url;
    },
    prepareWatchpartySync: async () => {},
    watchpartyEreignis: (nachricht) => ({ videoTime: nachricht.position, playing: nachricht.playing }),
    watchpartyLaeuftDanach: (nachricht) => Boolean(nachricht.playing),
    watchpartyApplyScript: (aktion) => { webAktionen.push(aktion); return aktion; },
    watchpartyDriftScript: () => "",
    watchpartyPasstZurFolge: (episodeId, url) => {
      const offen = String(url).match(/staffel-(\d+)\/episode-(\d+)/);
      return Boolean(offen && episodeId === `s${offen[1]}e${offen[2]}`);
    },
    watchparty: {
      verbunden: true,
      abgleichen: (key, room) => webAbgleiche.push({ key, room })
    },
    providers: [{ id: "aniworld" }],
    scheduleProviderAutoplay: (provider, _view, optionen) => webAutostarts.push({ provider, optionen }),
    stopAutoplayRequest: () => {},
    executeJavaScriptInMediaFrames: async () => {
      webVersuche += 1;
      if (webVersuche === 1) ersterWebVersuch();
      return [webVersuche < 3 ? "kein-video" : "pausiert"];
    },
    logMediaDiagnostic: () => {}
  });
  vm.runInContext([
    funktion("spielerRundenNachrichtPasst"),
    funktion("watchpartySteuerungHatZiel"),
    funktion("applyWatchpartyControl")
  ].join("\n"), webDispatch);
  const webNachholen = webDispatch.applyWatchpartyControl({
    ...start, action: "syncstart", syncId: "web-start", position: 33,
    videoTime: 33, playing: true, sequenceId: 91, timestamp: 2000
  });
  await ersterWebVersuchDa;
  // Der Autostart hat das Video noch nicht erzeugt. Eine neuere Pause darf den
  // alten Bereitschafts-Waechter trotzdem nicht beenden.
  await webDispatch.applyWatchpartyControl({
    ...start, action: "pause", position: 34, videoTime: 34,
    playing: false, sequenceId: 92, timestamp: 2001
  });
  await webNachholen;
  assert.equal(webUrl, folge(2), "Der eingebettete Player blieb auf der alten Folge");
  assert.equal(webVorbereiten, true, "Der Seiten-Autostart lief neben dem Nachholen weiter");
  assert.ok(webAutostarts.length, "Die Quellenvorbereitung wurde nicht gestartet");
  assert.equal(webAutostarts[0].optionen.preparePaused, true,
    "Die Quellenvorbereitung verwendete noch den spielenden Autostart");
  assert.ok(webAktionen.every((aktion) => aktion === "pause"),
    "Der alte Catch-up-Start lief vor dem frischen Hoststand los");
  assert.deepEqual(webAbgleiche, [{ key: eintrag.key, room: eintrag.room }],
    "Nach fertiger Web-Quelle wurde kein frischer Hoststand angefordert");

  // Der vorbereitende Autostart darf selbst bei einem bereits laufenden Video
  // kein play() ausloesen. Er nutzt dieselbe Suche nach Player/Overlay, endet
  // nach gefundener Quelle aber sicher pausiert.
  let prepareScript = "";
  const prepareContext = vm.createContext({
    watchpartyAutostart: { UEBERLAGERUNG_WAEHLER: [] },
    executeJavaScriptInMediaFrames: async (_view, script) => { prepareScript = script; return []; }
  });
  vm.runInContext(funktion("startPlaybackInView"), prepareContext);
  await prepareContext.startPlaybackInView({}, { mode: "prepare" });
  let plays = 0;
  let pauses = 0;
  const media = {
    paused: false, ended: false, readyState: 4, duration: 100, currentTime: 4,
    dataset: {}, autoplay: true,
    getBoundingClientRect: () => ({ width: 800, height: 450, top: 0, left: 0 }),
    play: () => { plays += 1; },
    pause: () => { pauses += 1; media.paused = true; }
  };
  const fenster = {};
  fenster.top = fenster;
  fenster.self = fenster;
  const prepareDom = vm.createContext({
    window: fenster, location: { hostname: "hoster.test" },
    innerWidth: 1280, innerHeight: 720, setTimeout,
    PointerEvent: function PointerEvent() {}, MouseEvent: function MouseEvent() {},
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    document: {
      fullscreenElement: null, body: {}, documentElement: {},
      querySelectorAll: (selector) => selector === "video" ? [media] : []
    }
  });
  const prepareErgebnis = await vm.runInContext(prepareScript, prepareDom);
  assert.match(prepareErgebnis, /^video-prepared/);
  assert.equal(plays, 0, "Der pausierte Vorbereitungsmodus rief play() auf");
  assert.equal(pauses, 1, "Der pausierte Vorbereitungsmodus hielt die Quelle nicht an");

  // Auch ohne Folgen-Nachholen bleibt ein syncstart mit playing=false eine
  // Pause. Der Nachrichtentyp allein darf den Player nicht starten.
  webAktionen.length = 0;
  await webDispatch.applyWatchpartyControl({
    ...start, action: "syncstart", position: 35, videoTime: 35,
    playing: false, sequenceId: 93, timestamp: 2002
  });
  assert.equal(webAktionen.at(-1), "pause",
    "Ein normaler syncstart ueberschrieb den pausierten Rundenstand");

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
