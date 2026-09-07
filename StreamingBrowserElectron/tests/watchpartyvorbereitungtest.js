"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict");
const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
const start = main.indexOf("async function prepareWatchpartySync(");
const source = main.slice(start, main.indexOf("\n}\n", start) + 2);
async function pruefen(phase) {
  let aktuell = true, ausfuehrungen = 0, bereit = 0, fortsetzen;
  const pause = new Promise(resolve => { fortsetzen = resolve; });
  const c = vm.createContext({
    sendWatchpartyLive() {},
    followWatchpartyEpisode: () => phase === "navigation" ? pause : Promise.resolve(),
    providerViews: new Map([[1, { webContents: { getURL: () => "episode" } }]]),
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
  const relay = fs.readFileSync(path.join(__dirname, "../../sync-server/server.js"), "utf8");
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
  console.log("7/7 bestanden");
})().catch(error => { console.error(error); process.exitCode = 1; });
