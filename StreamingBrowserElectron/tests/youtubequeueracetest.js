"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness(options = {}) {
  const events = [];
  let muted = true;
  let url = "https://www.youtube.com/watch?v=video-a";
  const release = deferred();
  const apply = deferred();
  const view = {
    webContents: {
      isAudioMuted: () => muted,
      setAudioMuted: value => { muted = Boolean(value); events.push("mute:" + muted); },
      getURL: () => url,
      executeJavaScript: code => {
        if (code === "release:start-a") {
          events.push("release-a");
          return release.promise;
        }
        if (code === "prepare:video-b:start-b") {
          events.push("prepare-b");
          return Promise.resolve("ready");
        }
        throw new Error("unexpected page script: " + code);
      }
    }
  };
  const provider = { id: "youtube" };
  const previous = {
    videoId: "video-a",
    url,
    title: "A",
    position: 42,
    playing: false,
    versatz: 0
  };
  const preparationA = {
    startId: "start-a",
    videoId: "video-next-a",
    previous,
    previousMuted: false,
    view,
    lauf: { room: "kino", startId: "start-a", cancelled: true },
    transition: null
  };
  const context = vm.createContext({
    console: { log() {}, error() {} },
    Date,
    Map,
    Promise,
    setTimeout,
    youtubeQueueVorbereitung: preparationA,
    youtubeErwartet: null,
    youtubeAnsicht: () => ({ provider, view }),
    youtubeParty: {
      aktiv: true,
      raum: "kino",
      beigetreten: true,
      verbunden: true,
      stand: previous
    },
    youtubeVideoIdAus: value => {
      const match = String(value || "").match(/[?&]v=([^&]+)/);
      return match ? match[1] : "";
    },
    youtubeQueue: {
      vorbereitenScript: (videoId, startId) => `prepare:${videoId}:${startId}`,
      freigebenScript: startId => `release:${startId}`
    },
    youtubeSync: {
      anwendenScript: stand => `apply:${stand.videoId}`
    },
    navigateProvider: async (_provider, target) => {
      events.push("navigate:" + target);
      url = target;
    },
    executeJavaScriptInMediaFrames: async (_view, code) => {
      events.push(code);
      if (options.holdApply && code === "apply:video-next-a") return apply.promise;
      return [];
    },
    stopAutoplayRequest: id => events.push("stop-autoplay:" + id),
    isLiveView: value => value === view,
    youtubeStoebertGerade: () => false,
    oeffneYoutubeVideo: async () => { throw new Error("unexpected queue commit navigation"); },
    logMediaDiagnostic() {}
  });
  vm.runInContext([
    extractFunction("youtubeQueueVorbereiten"),
    extractFunction("youtubeQueueAbbrechen"),
    extractFunction("applyYoutubeParty")
  ].join("\n"), context);
  return {
    context,
    events,
    preparationA,
    release,
    apply,
    getMuted: () => muted,
    setUrl: value => { url = value; }
  };
}

async function nextTurn() {
  await Promise.resolve();
  await Promise.resolve();
}

async function cancellationCannotClobberNextStart() {
  const h = harness();
  const cancel = h.context.youtubeQueueAbbrechen(h.preparationA.lauf);
  await nextTurn();
  const laufB = { room: "kino", startId: "start-b", cancelled: false };
  const startB = h.context.youtubeQueueVorbereiten({
    room: "kino",
    startId: "start-b",
    item: { url: "https://www.youtube.com/watch?v=video-b" }
  }, laufB);
  await nextTurn();
  assert.equal(h.events.some(event => event.includes("video-b")), false,
    "next generation must wait for rollback");

  h.release.resolve(true);
  await cancel;
  assert.deepEqual(h.events.slice(0, 4), [
    "release-a",
    "navigate:https://www.youtube.com/watch?v=video-a",
    "apply:video-a",
    "mute:false"
  ]);
  assert.equal(await startB, true);
  assert.equal(h.context.youtubeQueueVorbereitung.startId, "start-b");
  assert.equal(h.getMuted(), true, "new preparation owns the temporary mute");
  assert.ok(h.events.indexOf("prepare-b") > h.events.indexOf("apply:video-a"));
}

async function commitCannotOverlapNextStart() {
  const h = harness({ holdApply: true });
  h.preparationA.videoId = "video-next-a";
  h.setUrl("https://www.youtube.com/watch?v=video-next-a");
  const commit = h.context.applyYoutubeParty({
    videoId: "video-next-a",
    url: "https://www.youtube.com/watch?v=video-next-a",
    playing: true,
    versatz: 0,
    byName: "A"
  }, { reason: "queue-change", action: "video", anwenden: true });
  await nextTurn();
  const startB = h.context.youtubeQueueVorbereiten({
    room: "kino",
    startId: "start-b",
    item: { url: "https://www.youtube.com/watch?v=video-b" }
  }, { room: "kino", startId: "start-b", cancelled: false });

  h.release.resolve(true);
  await nextTurn();
  assert.ok(h.events.includes("apply:video-next-a"));
  assert.equal(h.events.some(event => event.includes("video-b")), false,
    "next generation must wait for authoritative apply");

  h.apply.resolve([]);
  await commit;
  assert.equal(await startB, true);
  assert.equal(h.context.youtubeQueueVorbereitung.startId, "start-b");
  assert.ok(h.events.indexOf("prepare-b") > h.events.indexOf("apply:video-next-a"));
}

Promise.resolve()
  .then(cancellationCannotClobberNextStart)
  .then(commitCannotOverlapNextStart)
  .then(() => console.log("OK YouTube queue generations serialize rollback, commit and the next hold"))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
