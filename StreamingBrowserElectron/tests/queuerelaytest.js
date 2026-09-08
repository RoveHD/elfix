"use strict";

// End-to-end contract for the relay-owned queues.  The small queue tests cover
// arithmetic; this file deliberately uses real WebSockets to cover membership,
// identity and the two-phase media hand-off at the protocol boundary.

const assert = require("node:assert");
const WS = require("../../sync-server/node_modules/ws");

const PORT = Number(process.env.TESTPORT) || 8799;
const ADDRESS = `ws://127.0.0.1:${PORT}`;
const ROOM = "queue-relay-e2e";
const OTHER_ROOM = "queue-relay-other";
const IDLE_ROOM = "queue-relay-idle";
const SOURCE = "serie:source";
const TARGET = "serie:target";
const SOURCE_URL = "https://aniworld.to/anime/stream/queue-source/staffel-1/episode-1";
const OLD_TARGET_URL = "https://aniworld.to/anime/stream/queue-target/staffel-1/episode-1";
const SELECTED_URL = "https://aniworld.to/anime/stream/queue-target/staffel-2/episode-5";
const checks = [];

function check(name, condition, detail = "") {
  checks.push(Boolean(condition));
  console.log(`${condition ? "OK  " : "FAIL"}  ${name}${detail ? ` -> ${detail}` : ""}`);
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function client(name, deviceId, room = ROOM, account = "") {
  let socket;
  const inbox = [];
  const listeners = [];
  const api = {
    name, deviceId, room, inbox,
    async connect() {
      await new Promise((resolve, reject) => {
        socket = new WS(ADDRESS);
        socket.once("open", resolve);
        socket.once("error", reject);
        socket.on("message", raw => {
          const message = JSON.parse(String(raw));
          inbox.push(message);
          for (let i = listeners.length - 1; i >= 0; i -= 1) {
            if (!listeners[i].predicate(message)) continue;
            const listener = listeners.splice(i, 1)[0];
            listener.resolve(message);
          }
        });
      });
      api.send({ type: "join", room, name, deviceId, ...(account ? { konto: account } : {}) });
      const state = await api.wait(message => message.type === "state", "join state");
      assert(state, `${name} did not join the relay`);
      return api;
    },
    send(message) { socket.send(JSON.stringify(message)); },
    mark() { return inbox.length; },
    wait(predicate, what = "message", timeout = 1600, after = 0) {
      const known = inbox.slice(after).find(predicate);
      if (known) return Promise.resolve(known);
      return new Promise(resolve => {
        const listener = { predicate, resolve };
        listeners.push(listener);
        setTimeout(() => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
          resolve(null);
        }, timeout).unref?.();
      });
    },
    async absent(predicate, timeout = 220, after = 0) {
      return (await api.wait(predicate, "unexpected", timeout, after)) === null;
    },
    close() { socket?.close(); }
  };
  return api;
}

const title = (key, url, season, episode) => ({
  key, url, title: `${key} S${season}E${episode}`, providerName: "Test", type: "serie", season, episode
});
const queueState = message => message.type === "queue:state";
const ytQueueState = message => message.type === "ytqueue:state";

async function shareAndEnter(owner, members, item) {
  owner.send({ type: "share", item });
  await owner.wait(message => message.type === "state" && message.shared?.some(entry => entry.key === item.key));
  for (const member of members) member.send({ type: "enter", key: item.key });
  await sleep(45);
}
function here(who, item, session) {
  who.send({ type: "here", key: item.key, url: item.url, position: 12, paused: false,
    season: item.season, episode: item.episode, playerSessionId: session });
}
async function propose(who, item) {
  const at = who.mark();
  who.send({ type: "queue:propose", item });
  const state = await who.wait(queueState, "queue proposal state", 1600, at);
  assert(state, `proposal state missing for ${item.key}: ${JSON.stringify(who.inbox.slice(at))}`);
  return state;
}

(async () => {
  // Two device IDs sharing this account must still be one queue voter.
  const accountA = "a".repeat(32);
  const a = client("Anna", "queue-a", ROOM, accountA);
  const a2 = client("Anna phone", "queue-a2", ROOM, accountA);
  const b = client("Ben", "queue-b");
  const c = client("Cem", "queue-c");
  const outsider = client("Other room", "queue-other", OTHER_ROOM);
  const idle = client("Idle manual", "queue-idle", IDLE_ROOM);
  const clients = [a, a2, b, c, outsider, idle];
  let reconnected;
  try {
    for (const who of clients) await who.connect();

    const pingAt = a.mark();
    a.send({ type: "time", t0: 17 });
    assert(await a.wait(message => message.type === "timeack" && message.t0 === 17, "relay timeack", 1600, pingAt),
      `relay stopped accepting messages: ${JSON.stringify(a.inbox.slice(pingAt))}`);

    const first = title("serie:vote", "https://aniworld.to/anime/stream/queue-vote/staffel-1/episode-1", 1, 1);
    const proposal = await propose(a, first);
    const id = proposal?.selectedId;
    check("normal proposal creates a selected queue item", Boolean(id) && proposal.items.length === 1);

    let at = a2.mark();
    a2.send({ type: "queue:propose", item: first });
    const duplicateProposal = await a2.wait(queueState, "idempotent proposal", 1600, at);
    // A proposal is not a vote: everyone spends their three weighted votes
    // deliberately, including on their own suggestion.
    check("same account cannot propose an item twice", duplicateProposal?.items.length === 1 && duplicateProposal.items[0].votes === 0);
    // Wait for the state that actually carries the change, not for the next
    // one to come along: an idempotent proposal answers with a state of its
    // own, and it can arrive after the mark for the vote below.
    const queueTally = (points, mine) => message => queueState(message)
      && message.items?.[0]?.votes === points && message.items?.[0]?.myVote === mine;
    at = a2.mark();
    a2.send({ type: "queue:vote", id, value: true });
    const sameAccountVote = await a2.wait(queueTally(1, 1), "same-account vote", 1600, at);
    check("one account has only one vote",
      sameAccountVote?.items[0]?.votes === 1 && sameAccountVote?.items[0]?.voted === true,
      JSON.stringify(sameAccountVote?.items?.[0] || a2.inbox.slice(at).map(m => m.type)));
    check("a plain vote takes the lightest free weight", sameAccountVote?.items[0]?.myVote === 1
      && JSON.stringify(sameAccountVote?.freeWeights) === JSON.stringify([3, 2]),
    JSON.stringify(sameAccountVote?.freeWeights));
    at = b.mark();
    b.send({ type: "queue:vote", id, value: true });
    const secondVote = await b.wait(queueTally(2, 1), "second voter", 1600, at);
    check("independent account adds exactly one vote", secondVote?.items[0]?.votes === 2);
    at = b.mark();
    b.send({ type: "queue:vote", id, value: true });
    b.send({ type: "chat", text: "queue-vote-marker" });
    await b.wait(message => message.type === "chat" && message.text === "queue-vote-marker",
      "order marker after the repeated vote", 1600, at);
    check("repeated vote is idempotent",
      !b.inbox.slice(at).some(message => queueState(message) && message.items?.[0]?.votes !== 2));
    // The weight travels over the wire, and moving it does not leave the old
    // one behind: three weights per person, each of them exactly once.
    at = b.mark();
    b.send({ type: "queue:vote", id, value: 3 });
    const heavyVote = await b.wait(queueTally(4, 3), "weighted vote", 1600, at);
    check("a weighted vote counts three and replaces the light one",
      heavyVote?.items[0]?.votes === 4 && heavyVote?.items[0]?.myVote === 3
      && heavyVote?.items[0]?.voters === 2
      && JSON.stringify(heavyVote?.freeWeights) === JSON.stringify([2, 1]),
    JSON.stringify(heavyVote?.items?.[0]));

    at = a.mark();
    a.send({ type: "queue:remove", id });
    await a.wait(message => queueState(message) && message.items.length === 0, "remove vote fixture", 1600, at);

    at = outsider.mark();
    outsider.send({ type: "queue:propose", item: title("serie:other", "https://aniworld.to/anime/stream/queue-other/staffel-1/episode-1", 1, 1) });
    const otherState = await outsider.wait(queueState, "other room queue", 1600, at);
    check("normal queue state is isolated by room", otherState?.items.length === 1 && otherState.items[0].key === "serie:other");

    // A request without a source is a deliberate, local manual start.
    const manualItem = title("serie:manual", "https://aniworld.to/anime/stream/queue-manual/staffel-1/episode-1", 1, 1);
    const manualState = await propose(idle, manualItem);
    const manualId = manualState?.selectedId;
    const beforeIdle = idle.mark(); const beforeA = a.mark(); const beforeB = b.mark();
    idle.send({ type: "queue:advance", expectedId: manualId, fromKey: "" });
    const manualStart = await idle.wait(message => message.type === "queue:start" && message.item?.id === manualId,
      "manual idle queue start", 1600, beforeIdle);
    check("idle manual start targets only its requester", Boolean(manualStart)
      && await a.absent(message => message.type === "queue:start" && message.startId === manualStart?.startId, 260, beforeA)
      && await b.absent(message => message.type === "queue:start" && message.startId === manualStart?.startId, 260, beforeB));
    idle.send({ type: "queue:started", startId: manualStart?.startId, ok: false });
    await idle.wait(message => message.type === "queue:cancel" && message.startId === manualStart?.startId, "manual rollback");

    // Create a genuine source cohort and a pre-existing target.  C belongs to
    // the source title but is watching another episode; it must not be pulled
    // into A/B's hand-off.
    const source = title(SOURCE, SOURCE_URL, 1, 1);
    const oldTarget = title(TARGET, OLD_TARGET_URL, 1, 1);
    await shareAndEnter(a, [b, c], source);
    await shareAndEnter(a, [b, c], oldTarget);
    let targetMark = a.mark();
    a.send({ type: "progress", key: TARGET, progress: { url: OLD_TARGET_URL, season: 1, episode: 1,
      position: 33, duration: 100, progress: 33, archived: true } });
    const archivedTarget = await a.wait(message => message.type === "state"
      && message.shared?.find(item => item.key === TARGET)?.archived === true, "archive existing target", 1600, targetMark);
    const beforeRollbackTarget = archivedTarget?.shared?.find(item => item.key === TARGET);
    here(a, source, "a-source"); here(b, source, "b-source");
    here(c, oldTarget, "c-other-title");
    await sleep(70);

    // The source cohort has two opt-in reports and one member on another
    // title.  Only the active source viewers influence this intersection.
    const spoilerA = a.mark(); const spoilerB = b.mark();
    a.send({ type: "spoilerstate", key: SOURCE, completed: [[1, 1], [1, 2]] });
    b.send({ type: "spoilerstate", key: SOURCE, completed: [[1, 1], [1, 3]] });
    const aggregate = await a.wait(message => message.type === "spoilerstate" && message.key === SOURCE && message.known === true,
      "known spoiler intersection", 1600, spoilerA);
    check("spoiler state aggregates opt-ins as an intersection", JSON.stringify(aggregate?.completed) === "[[1,1]]" && aggregate?.unknownCount === 0,
      aggregate ? JSON.stringify(aggregate) : "no known aggregate");
    b.send({ type: "spoilerstate", key: SOURCE, completed: null });
    const withdrawn = await a.wait(message => message.type === "spoilerstate" && message.key === SOURCE && message.known === false,
      "withdrawn spoiler state", 1600, spoilerB);
    check("spoiler withdrawal becomes unknown instead of retaining old data", withdrawn?.unknownCount >= 1 && withdrawn?.completed?.length === 0);
    const reoptInAt = a.mark();
    b.send({ type: "spoilerstate", key: SOURCE, completed: [[1, 1], [1, 2]] });
    await a.wait(message => message.type === "spoilerstate" && message.key === SOURCE && message.known === true,
      "re-opted spoiler state", 1600, reoptInAt);

    const selected = title(TARGET, SELECTED_URL, 2, 5);
    const selectedState = await propose(a, selected);
    const selectedId = selectedState?.selectedId;
    const markA = a.mark(), markB = b.mark(), markC = c.mark();
    a.send({ type: "queue:advance", expectedId: selectedId, fromKey: SOURCE });
    const startA = await a.wait(message => message.type === "queue:start" && message.item?.id === selectedId, "A queue start", 1600, markA);
    const startB = await b.wait(message => message.type === "queue:start" && message.startId === startA?.startId, "B queue start", 1600, markB);
    check("active source cohort contains only same-episode viewers", Boolean(startA && startB)
      && await c.absent(message => message.type === "queue:start" && message.startId === startA?.startId, 260, markC));
    check("start message retains the exact selected S2E5 URL", startA?.item?.url === SELECTED_URL && startA?.targetKey === TARGET);

    // A NACK restores both the queue selection and the pre-existing target;
    // importantly it must not emit the later sync barrier.
    const preNackA = a.mark(), preNackB = b.mark();
    a.send({ type: "queue:started", startId: startA?.startId, ok: true });
    b.send({ type: "queue:started", startId: startA?.startId, ok: false });
    const cancelA = await a.wait(message => message.type === "queue:cancel" && message.startId === startA?.startId, "NACK cancel", 1600, preNackA);
    const cancelB = await b.wait(message => message.type === "queue:cancel" && message.startId === startA?.startId, "NACK cancel peer", 1600, preNackB);
    const rolledBack = await a.wait(message => queueState(message) && message.items.some(item => item.id === selectedId), "requeued item");
    // The room card is its own message and can trail the queue state.  Waiting
    // for the card that carries the restored URL keeps this deterministic; the
    // last card in the inbox was sometimes still the pre-rollback one.
    const afterRollbackTarget = (await a.wait(message => message.type === "state"
      && message.shared?.find(item => item.key === TARGET)?.url === OLD_TARGET_URL,
      "rolled back target card", 1600, preNackA))?.shared?.find(item => item.key === TARGET);
    check("load NACK cancels both targets and requeues without playback", cancelA?.reason === "start-failed" && cancelB?.reason === "start-failed"
      && Boolean(rolledBack) && await a.absent(message => message.type === "syncprepare" && message.url === SELECTED_URL, 260, preNackA)
      && afterRollbackTarget?.archived === true && afterRollbackTarget?.url === OLD_TARGET_URL
      && JSON.stringify(afterRollbackTarget?.memberIds) === JSON.stringify(beforeRollbackTarget?.memberIds)
      && JSON.stringify(afterRollbackTarget?.members) === JSON.stringify(beforeRollbackTarget?.members));

    // A new start with every ACK commits only now, then uses the ordinary
    // sync barrier.  The selected URL is checked again after the commit.
    const retryMarkA = a.mark(), retryMarkB = b.mark();
    a.send({ type: "queue:advance", expectedId: selectedId, fromKey: SOURCE });
    const retryA = await a.wait(message => message.type === "queue:start" && message.item?.id === selectedId, "retry start A", 1600, retryMarkA);
    const retryB = await b.wait(message => message.type === "queue:start" && message.startId === retryA?.startId, "retry start B", 1600, retryMarkB);
    a.send({ type: "queue:started", startId: retryA?.startId, ok: true });
    b.send({ type: "queue:started", startId: retryA?.startId, ok: true });
    const prepareA = await a.wait(message => message.type === "syncprepare" && message.reason === "queue-change", "queue syncprepare A");
    const prepareB = await b.wait(message => message.type === "syncprepare" && message.syncId === prepareA?.syncId, "queue syncprepare B");
    check("all ACKs commit the exact target and enter syncprepare", prepareA?.url === SELECTED_URL && prepareB?.url === SELECTED_URL && prepareA?.key === TARGET);
    a.send({ type: "syncready", key: TARGET, syncId: prepareA?.syncId });
    b.send({ type: "syncready", key: TARGET, syncId: prepareA?.syncId });
    const syncStartA = await a.wait(message => message.type === "syncstart" && message.syncId === prepareA?.syncId, "queue syncstart A");
    const syncStartB = await b.wait(message => message.type === "syncstart" && message.syncId === prepareA?.syncId, "queue syncstart B");
    check("all media ready releases the same cohort", Boolean(syncStartA && syncStartB)
      && await c.absent(message => message.type === "syncprepare" && message.syncId === prepareA?.syncId, 260, markC));

    // The alternate protocol has a separate state and message namespace even
    // when it shares the room.  Its proposal cannot enter the normal queue.
    for (const who of [a, b]) {
      who.send({ type: "ytjoin" });
      await who.wait(message => message.type === "ytstate", "YouTube join");
    }
    const normalBeforeYt = a.mark();
    const ytAt = a.mark();
    a.send({ type: "ytqueue:propose", item: { videoId: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "YT only" } });
    const ytProposal = await a.wait(message => ytQueueState(message)
      && message.items?.some(item => item.videoId === "dQw4w9WgXcQ"), "YouTube queue proposal", 1600, ytAt);
    check("YouTube queue uses a separate protocol and state", ytProposal?.items?.[0]?.videoId === "dQw4w9WgXcQ"
      && await a.absent(message => queueState(message) && message.items.some(item => item.videoId), 260, normalBeforeYt));

    // A populated YouTube round has its own two-phase hand-off.  The old
    // video remains authoritative until every joined target accepts the load.
    const oldVideo = "9bZkp7q19f0";
    const newVideo = "dQw4w9WgXcQ";
    const oldUrl = `https://www.youtube.com/watch?v=${oldVideo}`;
    const newUrl = `https://www.youtube.com/watch?v=${newVideo}`;
    let atA = a.mark(), atB = b.mark();
    a.send({ type: "ytevent", action: "video", videoId: oldVideo, url: oldUrl, title: "Old YT", position: 0 });
    await b.wait(message => message.type === "ytevent" && message.action === "video" && message.videoId === oldVideo,
      "seeded YouTube video", 1600, atB);
    atA = a.mark();
    a.send({ type: "ytqueue:advance", expectedId: ytProposal?.selectedId, fromVideoId: oldVideo });
    const ytStartA = await a.wait(message => message.type === "ytqueue:start" && message.item?.id === ytProposal?.selectedId,
      "YT queue start A", 1600, atA);
    const ytStartB = await b.wait(message => message.type === "ytqueue:start" && message.startId === ytStartA?.startId,
      "YT queue start B");
    const nackA = a.mark(); const nackB = b.mark();
    a.send({ type: "ytqueue:started", startId: ytStartA?.startId, ok: true });
    b.send({ type: "ytqueue:started", startId: ytStartA?.startId, ok: false });
    const ytCancelA = await a.wait(message => message.type === "ytqueue:cancel" && message.startId === ytStartA?.startId,
      "YT NACK cancel A", 1600, nackA);
    const ytCancelB = await b.wait(message => message.type === "ytqueue:cancel" && message.startId === ytStartA?.startId,
      "YT NACK cancel B", 1600, nackB);
    check("YT first ACK waits and NACK rolls back without a new video", Boolean(ytStartA && ytStartB)
      && ytCancelA?.reason === "start-failed" && ytCancelB?.reason === "start-failed"
      && await a.absent(message => message.type === "ytevent" && message.action === "video" && message.videoId === newVideo, 260, nackA));
    atA = a.mark(); atB = b.mark();
    a.send({ type: "ytqueue:advance", expectedId: ytProposal?.selectedId, fromVideoId: oldVideo });
    const ytRetryA = await a.wait(message => message.type === "ytqueue:start" && message.item?.id === ytProposal?.selectedId,
      "YT retry A", 1600, atA);
    const ytRetryB = await b.wait(message => message.type === "ytqueue:start" && message.startId === ytRetryA?.startId,
      "YT retry B", 1600, atB);
    a.send({ type: "ytqueue:started", startId: ytRetryA?.startId, ok: true });
    b.send({ type: "ytqueue:started", startId: ytRetryA?.startId, ok: true });
    const ytCommittedA = await a.wait(message => message.type === "ytevent" && message.action === "video"
      && message.reason === "queue-change" && message.startId === ytRetryA?.startId, "YT committed A");
    const ytCommittedB = await b.wait(message => message.type === "ytevent" && message.action === "video"
      && message.reason === "queue-change" && message.startId === ytRetryA?.startId,
      "YT committed B");
    check("YT all ACKs commit the exact queued URL to the joined cohort", ytCommittedA?.videoId === newVideo
      && ytCommittedA?.url === newUrl && ytCommittedB?.url === newUrl,
    JSON.stringify({ a: ytCommittedA, b: ytCommittedB, expected: newUrl }));

    // The fresh join must not reuse B's preceding opt-in from the socket
    // which has gone away.
    b.close();
    await sleep(80);
    reconnected = client("Ben reconnected", "queue-b", ROOM);
    await reconnected.connect();
    reconnected.send({ type: "enter", key: SOURCE });
    here(reconnected, source, "b-reconnected-without-opt-in");
    const reconnectState = await reconnected.wait(message => message.type === "spoilerstate" && message.key === SOURCE,
      "reconnected spoiler state", 1600);
    check("disconnect/reconnect does not retain prior spoiler opt-in", reconnectState?.known === false
      && reconnectState?.unknownCount >= 1 && reconnectState?.completed?.length === 0);
  } finally {
    for (const who of clients) who.close();
    reconnected?.close();
  }
  console.log(checks.every(Boolean) ? "OK Queue relay: RealWS queue, cohort, barrier, mode and spoiler contracts" : "FAIL Queue relay tests");
  process.exitCode = checks.every(Boolean) ? 0 : 1;
})().catch(error => { console.error("FAIL Queue relay:", error); process.exitCode = 1; });
