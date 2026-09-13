"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict");
const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
const start = main.indexOf("async function prepareWatchpartySync(");
const source = main.slice(start, main.indexOf("\n}\n", start) + 2);
const navigationStart = main.indexOf("function meldeWatchpartyFolgenwechsel(");
const navigationSource = main.slice(navigationStart, main.indexOf("\n}\n", navigationStart) + 2);
const zielStart = main.indexOf("function spielerRundenNachrichtPasst(");
const zielSource = main.slice(zielStart, main.indexOf("\n}\n", zielStart) + 2);
const zielListeStart = main.indexOf("function watchpartySteuerungHatZiel(");
const zielListeSource = main.slice(zielListeStart, main.indexOf("\n}\n", zielListeStart) + 2);
async function pruefen(phase) {
  let aktuell = true, ausfuehrungen = 0, bereit = 0, fortsetzen;
  const pause = new Promise(resolve => { fortsetzen = resolve; });
  const c = vm.createContext({
    sendWatchpartyLive() {},
    followWatchpartyEpisode: () => phase === "navigation" ? pause : Promise.resolve(),
    providerViews: new Map([[1, { webContents: { getURL: () => "episode" } }]]),
    providers: [{ id: 1 }],
    scheduleProviderAutoplay: () => {}, stopAutoplayRequest: () => {},
    isLiveView: () => true, istGleicheFolge: () => true,
    executeJavaScriptInMediaFrames: () => { ausfuehrungen++; return pause.then(() => ["bereit"]); },
    watchpartyApplyScript: () => "prepare", watchpartyEreignis: x => x,
    watchparty: { bereitZumStart() { bereit++; } }
  });
  vm.runInContext(source, c);
  const lauf = c.prepareWatchpartySync({ key: "film", room: "room" }, { url: "episode", syncId: "old" }, () => aktuell);
  await new Promise(resolve => setImmediate(resolve));
  aktuell = false; // A newer pause was accepted while the older work awaited.
  fortsetzen(); await lauf;
  assert.equal(bereit, 0, "obsolete preparation acknowledged readiness");
  assert.equal(ausfuehrungen, phase === "navigation" ? 0 : 1);
}
(async () => {
  await pruefen("navigation");
  await pruefen("player");
  const relay = fs.readFileSync(path.join(__dirname, "../../sync-server/server.js"), "utf8").replace(/\r\n/g, "\n");
  const von = relay.indexOf("function hostZustandJetzt(");
  let host = { at: 1010, position: 100, paused: true };
  const r = vm.createContext({ aktuellerHost: () => host, Date: { now: () => 1800 } });
  vm.runInContext(relay.slice(von, relay.indexOf("\n}\n", von) + 2), r);
  const eintrag = { startAt: 1000, live: { at: 1000, position: 100, action: "play" } };
  assert.equal(r.hostZustandJetzt("room", eintrag).position, 100.8,
    "delayed preparation heartbeat rewound the next pause to the start frame");
  host = { at: 1400, position: 100.4, paused: true };
  assert.equal(r.hostZustandJetzt("room", eintrag).laeuft, false, "actual later pause was ignored");
  eintrag.live = { at: 1500, position: 100.5, action: "pause" };
  assert.equal(r.hostZustandJetzt("room", eintrag).position, 100.5, "explicit pause did not win");

  const serie = "https://aniworld.to/anime/stream/bleach";
  const gesendet = [];
  const folge = (url) => {
    const treffer = String(url).match(/\/staffel-(\d+)\/episode-(\d+)/);
    return treffer ? { season: Number(treffer[1]), episode: Number(treffer[2]) } : null;
  };
  const schluessel = (url) => String(url).replace(/\/staffel-\d+(?:\/episode-\d+)?\/?$/, "");
  const navigation = vm.createContext({
    watchparty: { aktiv: true, steuernMitAdresse: (...werte) => gesendet.push(werte) },
    spielerLauf: { url: `${serie}/staffel-1/episode-6` },
    episodeIdentity: folge,
    taste: { urlSchluessel: schluessel },
    watchpartySerieForUrl: () => "serie:bleach",
    watchpartyRaumForUrl: () => "room",
    watchpartyLiveAktiv: () => true,
    watchpartyAngeklinkt: new Set()
  });
  vm.runInContext(navigationSource, navigation);
  navigation.meldeWatchpartyFolgenwechsel(`${serie}/staffel-1`);
  assert.equal(gesendet.length, 0, "hidden season-page read was reported as the playing episode");
  navigation.meldeWatchpartyFolgenwechsel(`${serie}/staffel-1/episode-7`);
  assert.equal(gesendet.length, 1, "a real episode navigation was suppressed with the hidden read");

  // Ein unpassender Befehl darf nicht einmal den Reihenfolgenmerker erreichen:
  // sonst macht er eine passende Vorbereitung nach deren await ungueltig,
  // obwohl kein Player ihn angenommen hat.
  const ziel = vm.createContext({
    spielerLauf: { url: `${serie}/staffel-1/episode-6` },
    episodeIdentity: folge,
    taste: { urlSchluessel: schluessel },
    watchpartyPasstZurFolge: (id, url) => {
      const offen = folge(url);
      return !offen || !id || id === `s${offen.season}e${offen.episode}`;
    },
    istGleicheFolge: (a, b) => {
      const links = folge(a), rechts = folge(b);
      return Boolean(links && rechts && links.season === rechts.season && links.episode === rechts.episode
        && schluessel(a) === schluessel(b));
    },
    providerViews: new Map([[1, { webContents: { getURL: () => `${serie}/staffel-1/episode-6` } }]]),
    isLiveView: () => true
  });
  vm.runInContext(`${zielSource}\n${zielListeSource}`, ziel);
  const zielEintrag = { url: `${serie}/staffel-1/episode-6`, live: null };
  assert.equal(ziel.watchpartySteuerungHatZiel(zielEintrag, {
    action: "pause", url: `${serie}/staffel-1/episode-5`, episodeId: "s1e5"
  }, { tun: "anwenden" }), false, "wrong episode was allowed to cancel current preparation");
  assert.equal(ziel.watchpartySteuerungHatZiel(zielEintrag, {
    action: "pause", url: `${serie}/staffel-1/episode-6`, episodeId: "s1e6"
  }, { tun: "anwenden" }), true, "matching episode lost its player target");
  assert.equal(ziel.watchpartySteuerungHatZiel(zielEintrag, {
    action: "syncprepare", url: `${serie}/staffel-1/episode-7`, episodeId: "s1e7"
  }, { tun: "syncprepare" }), true, "preparation could no longer navigate within its series");
  assert.equal(ziel.watchpartySteuerungHatZiel(zielEintrag, {
    action: "syncstart", url: `${serie}/staffel-1`, episodeId: "s1e6"
  }, { tun: "syncstart" }), true, "stale room URL lost the matching native player");

  const applyStart = main.indexOf("async function applyWatchpartyControl(");
  const zielGate = main.indexOf("if (!watchpartySteuerungHatZiel", applyStart);
  const markerWrite = main.indexOf("watchpartyLetztesEreignis.set", applyStart);
  assert.ok(zielGate > applyStart && zielGate < markerWrite,
    "event marker advances before real player identity is accepted");
  console.log("14/14 bestanden");
})().catch(error => { console.error(error); process.exitCode = 1; });
