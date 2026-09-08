"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8")
  .replace(/\r\n/g, "\n");

function extractFunction(name) {
  const start = source.search(new RegExp("(?:async )?function " + name + "\\("));
  assert.ok(start >= 0, "missing function " + name);
  const end = source.indexOf("\n}", start);
  assert.ok(end >= 0, "unterminated function " + name);
  return source.slice(start, end + 2);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function run() {
  const room = "kino";
  const fromKey = "series";
  const startId = "start-1";
  const token = room + "|normal|" + startId;
  const sourceUrl = "https://aniworld.to/anime/stream/test/staffel-1/episode-1";
  const targetUrl = "https://aniworld.to/anime/stream/test/staffel-1/episode-2";
  const previous = {
    id: "run-source",
    providerId: "aniworld",
    url: sourceUrl,
    quelle: { adresse: "https://cdn.example/source.m3u8", typ: "hls", hoehe: 1080 },
    hoster: "Vidmoly",
    link: "source"
  };
  const target = {
    id: "run-target",
    providerId: "aniworld",
    url: targetUrl,
    quelle: { adresse: "https://cdn.example/target.m3u8", typ: "hls", hoehe: 1080 },
    hoster: "Vidmoly",
    link: "target"
  };
  const entered = deferred();
  const late = deferred();
  const acknowledgements = [];
  const restored = [];
  const lateReopens = [];
  const commands = [];
  const toasts = [];

  let context;
  context = vm.createContext({
    console: { log() {}, error() {} },
    AbortController,
    Date,
    Map,
    Promise,
    queueStarts: new Map(),
    queueManuell: new Map(),
    queueLetzterStart: new Map(),
    queueVorbereitungen: new Map(),
    watchparty: {
      codes: [room],
      eintraege: () => [{key:fromKey,room,joined:true}],
      status: () => ({ rooms: [{ room, connected: true }] }),
      serverJetzt: () => Date.now()
    },
    youtubeParty: {},
    youtube: { istYoutubeUrl: () => false },
    activeFavoriteId: "favorite-source",
    spielerLauf: { ...previous },
    spielerTakt: { stelle: 81 },
    direktLaden: new AbortController(),
    spielerRunde: () => ({ raum: room, key: fromKey }),
    queueStartBestaetigen: (_room, _mode, id, ok) => acknowledgements.push({ id, ok }),
    providerForWatchpartyUrl: () => ({ id: "aniworld" }),
    waitForSharedTitle: async () => true,
    watchpartyEintrag: () => ({ joined: true }),
    spielerBefehl: (command) => commands.push(command),
    uebernehmeWatchpartyRaum() {},
    setWatchpartyLive: () => { context.activeFavoriteId = "favorite-target"; },
    ohneWatchpartyFolgenwechselEcho: async (_provider, _url, load) => load(),
    direktFolgeSpielen: async (_provider, url, options) => {
      // Model a target player that has appeared but whose source-resolution
      // continuation is still pending.
      context.spielerLauf = { ...target };
      entered.resolve();
      await late.promise;
      if (!options.istAktuell()) return { ok: false, abgebrochen: true };
      lateReopens.push(url);
      context.spielerLauf = { ...target };
      return { ok: true };
    },
    enabledProviders: () => [{ id: "aniworld" }],
    direktSpielerOeffnen: async (_provider, url, result, options) => {
      restored.push({ url, result, options });
      context.spielerLauf = { ...previous };
      return true;
    },
    raumQueueFehler: (reason) => reason === "start-failed" ? "Ein Geraet konnte den Titel nicht laden." : "",
    sendActiveState() {},
    sendToast: (message) => toasts.push(message)
  });

  vm.runInContext(
    extractFunction("raumQueueStarten") + "\n" + extractFunction("raumQueueAbbrechen"),
    context
  );

  const start = context.raumQueueStarten({
    type: "queue:start",
    room,
    startId,
    fromKey,
    targetKey: fromKey,
    expiresAt: Date.now() + 30_000,
    item: {
      id: "item-2",
      key: fromKey,
      url: targetUrl,
      providerName: "AniWorld",
      title: "Test"
    }
  }, "normal");

  await entered.promise;
  assert.equal(context.activeFavoriteId, "favorite-target");
  assert.equal(context.spielerLauf.url, targetUrl);
  assert.ok(context.queueVorbereitungen.has(token));

  await context.raumQueueAbbrechen({
    type: "queue:cancel",
    room,
    startId,
    fromKey,
    targetKey: fromKey,
    reason: "start-failed"
  }, "normal");

  assert.equal(context.queueVorbereitungen.has(token), false);
  assert.equal(context.queueLetzterStart.has(room + "|normal"), false);
  assert.equal(context.direktLaden.signal.aborted, true);
  assert.equal(context.activeFavoriteId, "favorite-source");
  assert.equal(context.spielerLauf.url, sourceUrl);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].url, sourceUrl);
  assert.equal(restored[0].options.startzeit, 81);
  assert.equal(restored[0].options.rundeWarten, true);
  assert.equal(commands.at(-1).laufen, false);
  assert.match(toasts.at(-1), /konnte den Titel nicht laden/i);

  late.resolve();
  await start;

  assert.deepEqual(lateReopens, [], "a late loader must not reopen the cancelled target");
  assert.deepEqual(acknowledgements, [], "a cancelled generation must not ACK after rollback");
  assert.equal(context.spielerLauf.url, sourceUrl);
  assert.equal(context.activeFavoriteId, "favorite-source");

  console.log("OK queue cancellation restores the paused source and rejects late completion");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
