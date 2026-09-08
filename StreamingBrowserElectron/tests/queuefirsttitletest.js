"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { Watchparty } = require("../src/watchparty");

const mainSource = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
function functionSource(name) {
  const start = mainSource.search(new RegExp("(?:async )?function " + name + "\\("));
  assert.ok(start >= 0, `missing function ${name}`);
  const end = mainSource.indexOf("\n}", start);
  assert.ok(end >= 0, `unterminated function ${name}`);
  return mainSource.slice(start, end + 2);
}

async function scenario(existing) {
  const room = existing ? "bestand" : "erstes-ziel";
  const sourceKey = "serie:quelle";
  const targetKey = "serie:ziel";
  const oldUrl = "https://aniworld.to/anime/stream/ziel/staffel-1/episode-1";
  const targetUrl = "https://aniworld.to/anime/stream/ziel/staffel-2/episode-5";
  const states = [];
  const acknowledgements = [];
  const loads = [];
  let startPromise = null;
  let context;

  const client = new Watchparty({
    onState: entries => states.push(entries),
    onQueue: message => {
      if (message.type === "queue:start") startPromise = context.raumQueueStarten(message, "normal");
    }
  });
  client.raum = room;
  client.aktiv = true;
  client.verbunden = true;
  client.identitaetBestaetigt = true;
  client.geraetId = "desktop-a";
  client.name = "Desktop";
  client.deviceSecret = "test-secret";
  if (existing) {
    client.geteilt = [{
      key: targetKey, url: oldUrl, title: "Alter Zielstand", providerName: "AniWorld",
      season: 1, episode: 1, memberIds: ["desktop-a"], members: ["Desktop"],
      progress: { url: oldUrl, season: 1, episode: 1, position: 71 }
    }];
  }

  const facade = {
    codes: [room],
    eintraege: () => client.eintraege(),
    status: () => ({ rooms: [{ room, connected: true }] }),
    serverJetzt: () => Date.now()
  };
  context = vm.createContext({
    console: { log() {}, error() {} }, Date, Map, Promise,
    watchparty: facade,
    youtubeParty: {},
    youtube: { istYoutubeUrl: () => false },
    youtubeVideoIdAus: () => "",
    queueStarts: new Map(), queueManuell: new Map(), queueLetzterStart: new Map(), queueVorbereitungen: new Map(),
    spielerLauf: { id: "source-player", url: "https://aniworld.to/anime/stream/quelle/staffel-1/episode-1" },
    spielerTakt: { stelle: 42 },
    spielerRunde: () => ({ raum: room, key: sourceKey }),
    providerForWatchpartyUrl: () => ({ id: "aniworld", name: "AniWorld" }),
    spielerBefehl() {},
    setWatchpartyLive() {},
    ohneWatchpartyFolgenwechselEcho: async (_provider, _url, load) => load(),
    direktFolgeSpielen: async (_provider, url, options) => {
      loads.push({ url, options });
      assert.equal(options.rundeWarten, true);
      assert.equal(options.istAktuell(), true);
      return { ok: true };
    },
    queueStartBestaetigen: (_room, _mode, startId, ok) => acknowledgements.push({ startId, ok }),
    favorites: [],
    activeFavoriteId: "source-favorite",
    activeView: null,
    lokalerWatchpartyEintrag: () => null,
    createWatchpartyFavorite: (key, entry) => ({
      id: `favorite-${key}`, url: entry.url, title: entry.title,
      watchpartyRoom: room, watchpartyKey: key
    }),
    saveFavorites() {}, sendActiveState() {},
    normalizeFavoriteUrl: value => value,
    episodeIdentity: () => ({ season: 2, episode: 5 }),
    istGleicheSerie: () => false,
    sendToast(message) { throw new Error(message); }
  });
  vm.runInContext(`${functionSource("uebernehmeWatchpartyRaum")}\n${functionSource("raumQueueStarten")}`, context);

  client.nachrichtVerarbeiten(JSON.stringify({
    type: "queue:start", room, startId: existing ? "start-existing" : "start-first",
    fromKey: sourceKey, targetKey,
    at: Date.now(), expiresAt: Date.now() + 30_000,
    item: {
      id: "proposal-1", key: targetKey, url: targetUrl, title: "Ziel S2E5",
      providerName: "AniWorld", type: "anime", season: 2, episode: 5
    }
  }));

  assert.ok(startPromise, "queue:start reached Main callback");
  assert.equal(states.length, 0, "provisional queue target leaked through authoritative onState");
  assert.equal(client.eintraege().find(entry => entry.key === targetKey)?.progress?.url, targetUrl);
  if (existing) assert.equal(client.serverEintraege()[0].progress.url, oldUrl, "existing server state was mutated");
  await startPromise;
  assert.deepEqual(acknowledgements, [{ startId: existing ? "start-existing" : "start-first", ok: true }]);
  assert.equal(loads.length, 1);
  assert.equal(loads[0].url, targetUrl);
  assert.equal(context.activeFavoriteId, `favorite-${targetKey}`);

  // Phase two: only the exact authoritative relay state replaces the overlay.
  client.nachrichtVerarbeiten(JSON.stringify({
    type: "state", identityVersion: 2, you: "desktop-a", peers: ["Desktop"], shared: [{
      key: targetKey, url: targetUrl, title: "Ziel S2E5", providerName: "AniWorld",
      season: 2, episode: 5, memberIds: ["desktop-a"], members: ["Desktop"],
      progress: { url: targetUrl, season: 2, episode: 5, position: 0 }
    }]
  }));
  assert.equal(client.queueZiele.size, 0, "authoritative commit did not retire provisional target");
  assert.equal(client.eintraege()[0].queueProvisional, undefined);
  assert.equal(states.at(-1)[0].progress.url, targetUrl);
}

(async () => {
  await scenario(false);
  await scenario(true);
  console.log("OK Queue first title: transient client target drives Main load and ACK without phantom state");
})().catch(error => {
  console.error("FAIL Queue first title:", error);
  process.exitCode = 1;
});
