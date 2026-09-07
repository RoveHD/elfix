"use strict";

// Relay regression: a paused host seek must align the rendered frame after the
// next real host heartbeat, just like an ordinary pause.
const WS = require("../../sync-server/node_modules/ws");

const PORT = Number(process.env.TESTPORT) || 8799;
const URL = "https://s.to/serie/stream/frame-test/staffel-1/episode-1";
const ROOM = `seek-frame-${Date.now()}`;
const KEY = "serie:seek-frame-test";
const FRAME = 299.590944;
const POSITION = 299.631605;
const sockets = [];

function client(name, id) {
  const socket = new WS(`ws://127.0.0.1:${PORT}`);
  sockets.push(socket);
  const messages = [];
  const waiters = [];
  socket.on("message", raw => {
    const message = JSON.parse(String(raw));
    messages.push(message);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].test(message)) {
        waiters[i].resolve(message);
        waiters.splice(i, 1);
      }
    }
  });
  return {
    socket,
    open: () => new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    }),
    send: value => socket.send(JSON.stringify(value)),
    messages,
    wait: (test, ms = 1500) => new Promise((resolve, reject) => {
      const found = messages.find(test);
      if (found) return resolve(found);
      const waiter = { test, resolve, reject };
      waiters.push(waiter);
      setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error(`${name}: timeout`));
      }, ms);
    })
  };
}

let stage = "initialization";
let diagnostic = () => "";
(async () => {
  const host = client("host", "seek-host");
  const guest = client("guest", "seek-guest");
  const waitAt = async (label, promise) => {
    stage = label;
    return promise;
  };
  const waitHost = (test, ms) => waitAt("host " + test.toString(), host.wait(test, ms));
  const waitGuest = (test, ms) => waitAt("guest " + test.toString(), guest.wait(test, ms));
  let barrierNumber = 0;
  const barrier = async () => {
    // First prove that the host's preceding message was handled. Then send a
    // ping through the guest connection: any relay message caused by that
    // preceding host message must be queued before this guest acknowledgement.
    const hostMark = `host-${++barrierNumber}`;
    host.send({ type: "time", t0: hostMark });
    await waitHost(m => m.type === "timeack" && m.t0 === hostMark);
    const guestMark = `guest-${barrierNumber}`;
    guest.send({ type: "time", t0: guestMark });
    await waitGuest(m => m.type === "timeack" && m.t0 === guestMark);
  };
  diagnostic = () => JSON.stringify({
    host: host.messages.slice(-6).map(m => ({ type: m.type, action: m.action, position: m.position, frameTime: m.frameTime, resync: m.resync })),
    guest: guest.messages.slice(-8).map(m => ({ type: m.type, action: m.action, position: m.position, frameTime: m.frameTime, resync: m.resync }))
  });
  await Promise.all([host.open(), guest.open()]);

  host.send({ type: "join", room: ROOM, name: "Host", deviceId: "seek-host" });
  await waitHost(m => m.type === "state");
  host.send({ type: "share", item: {
    key: KEY, url: URL, title: "Frame test", type: "serie", season: 1, episode: 1
  }});
  await waitHost(m => m.type === "state" && m.shared?.some(item => item.key === KEY));

  guest.send({ type: "join", room: ROOM, name: "Guest", deviceId: "seek-guest" });
  await waitGuest(m => m.type === "state" && m.shared?.some(item => item.key === KEY));
  guest.send({ type: "enter", key: KEY });
  await waitGuest(m => m.type === "state" && m.shared?.[0]?.memberIds?.includes("seek-guest"));

  const stand = (client, id, frameTime) => client.send({
    type: "here", key: KEY, position: POSITION, paused: true,
    frameTime, duration: 1000, season: 1, episode: 1, url: URL,
    playerSessionId: `${id}-s1e1`
  });
  // Heartbeats travel over independent sockets. Sending both back to back and
  // sleeping does not define which one the relay sees first; whichever valid
  // participant reports first becomes host. Establish and observe the
  // intended authority before the guest reports its player state.
  stand(host, "seek-host", FRAME);
  await waitHost(m => m.type === "watchstate" && m.key === KEY
    && m.members?.some(member => member.id === "seek-host" && member.host));
  stand(guest, "seek-guest", FRAME);
  await waitGuest(m => m.type === "watchstate" && m.key === KEY
    && m.members?.some(member => member.id === "seek-guest"));

  host.send({ type: "control", key: KEY, action: "seek", position: POSITION,
    frameTime: FRAME, url: URL });
  await waitGuest(m => m.type === "control" && m.action === "seek" && !m.resync);

  // The first heartbeat can arrive before the decoder has exposed the newly
  // rendered frame. It must not consume the alignment opportunity.
  stand(host, "seek-host");
  await barrier();
  if (guest.messages.some(m => m.type === "control" && m.action === "seek" && m.resync)) {
    throw new Error("alignment was consumed before a valid host frame existed");
  }

  // The next fresh host heartbeat is the authoritative rendered frame.
  stand(host, "seek-host", FRAME);
  const aligned = await waitGuest(m => m.type === "control" && m.action === "seek"
    && m.resync && m.frameTime != null);
  if (aligned.frameTime !== FRAME || aligned.position !== FRAME) {
    throw new Error(`expected frame ${FRAME}, got position=${aligned.position} frame=${aligned.frameTime}`);
  }
  console.log("OK paused seek aligns the host rendered frame");
  host.socket.close();
  guest.socket.close();
})().catch(error => {
  console.error(`${error.message} [stage: ${stage}] ${diagnostic()}`);
  process.exitCode = 1;
}).finally(() => {
  for (const socket of sockets) socket.terminate();
});
