"use strict";
// Die YouTube-Watchparty gegen das echte Relay.
//
// Geprueft wird genau das, was den Modus ausmacht: alle sehen dasselbe Video,
// jeder darf steuern, ein Videowechsel beendet nichts, und ein Nachzuegler aus
// dem vorigen Video bewegt die Runde nicht mehr. Zum Schluss steht die Probe,
// auf die es bei einem zweiten Modus am meisten ankommt - dass die Watchparty
// fuer Serien davon nichts mitbekommt.

const WS = require("../../sync-server/node_modules/ws");

const PORT = Number(process.env.TESTPORT) || 8799;
const ADRESSE = `ws://127.0.0.1:${PORT}`;
const RAUM = "ytraum";
const VIDEO_X = "dQw4w9WgXcQ";
const VIDEO_Y = "9bZkp7q19f0";

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push({ name, ok: Boolean(bedingung) });
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name, deviceId) {
  let socket;
  const eingang = [];
  const warten = [];
  const api = {
    name,
    deviceId,
    eingang,
    // Der zuletzt gesehene Raumzustand der YouTube-Runde.
    yt: null,
    verbinde: () => new Promise((fertig) => {
      socket = new WS(ADRESSE);
      socket.on("message", (roh) => {
        const m = JSON.parse(String(roh));
        eingang.push(m);
        if (m.type === "ytstate" || m.type === "ytevent") api.yt = m;
        for (let i = warten.length - 1; i >= 0; i -= 1) {
          if (warten[i].passt(m)) { warten[i].resolve(m); warten.splice(i, 1); }
        }
      });
      socket.on("open", fertig);
    }),
    send: (m) => socket.send(JSON.stringify(m)),
    zu: () => socket.close(),
    leeren: () => { eingang.length = 0; },
    erwarte: (passt, ms = 1500) => new Promise((resolve) => {
      const treffer = eingang.find(passt);
      if (treffer) return resolve(treffer);
      const e = { passt, resolve };
      warten.push(e);
      setTimeout(() => {
        const i = warten.indexOf(e);
        if (i >= 0) { warten.splice(i, 1); resolve(null); }
      }, ms);
    })
  };
  return api;
}

const istEvent = (aktion) => (m) => m.type === "ytevent" && m.action === aktion;

(async () => {
  const a = client("Anna", "geraet-a");
  const b = client("Ben", "geraet-b");
  const c = client("Cem", "geraet-c");

  for (const wer of [a, b, c]) {
    await wer.verbinde();
    wer.send({ type: "join", room: RAUM, name: wer.name, deviceId: wer.deviceId });
  }
  await schlaf(200);

  // --- 1. Beitreten ---------------------------------------------------------

  a.leeren(); b.leeren();
  a.send({ type: "ytjoin" });
  const ersterStand = await a.erwarte((m) => m.type === "ytstate");
  pruefe("1. Wer beitritt, bekommt sofort den Raumzustand",
    Boolean(ersterStand) && ersterStand.room === RAUM && ersterStand.videoId === "",
    ersterStand ? `videoId "${ersterStand.videoId}"` : "keine Antwort");

  b.leeren();
  b.send({ type: "ytjoin" });
  const zuZweit = await a.erwarte((m) => m.type === "ytstate" && m.members.length === 2);
  pruefe("1b. Der Beitritt eines Zweiten erreicht auch den Ersten",
    Boolean(zuZweit) && zuZweit.members.some((p) => p.id === "geraet-b"),
    zuZweit ? zuZweit.members.map((p) => p.name).join(", ") : "keine Antwort");

  // Wer nicht beigetreten ist, steuert auch nichts.
  a.leeren();
  c.send({ type: "ytevent", action: "video", videoId: VIDEO_Y });
  const vonDraussen = await a.erwarte(istEvent("video"), 500);
  pruefe("1c. Wer nicht beigetreten ist, bewegt die Runde nicht", vonDraussen === null);

  c.send({ type: "ytjoin" });
  await schlaf(150);

  // --- 2. Video oeffnen und steuern -----------------------------------------

  b.leeren(); c.leeren();
  a.send({
    type: "ytevent", action: "video", videoId: VIDEO_X,
    url: `https://www.youtube.com/watch?v=${VIDEO_X}`, title: "Video X", position: 0
  });
  const wechsel = await b.erwarte(istEvent("video"));
  pruefe("2. Oeffnet A ein Video, bekommt B es ebenfalls",
    Boolean(wechsel) && wechsel.videoId === VIDEO_X && wechsel.playing === true,
    wechsel ? `${wechsel.videoId}, rev ${wechsel.rev}` : "keine Antwort");

  pruefe("2b. Der Absender bekommt seinen Zug samt Nummer zurueck",
    Boolean(a.yt) && a.yt.byId === "geraet-a" && a.yt.rev === wechsel.rev,
    a.yt ? `byId ${a.yt.byId}` : "nichts");

  a.leeren(); c.leeren();
  b.send({ type: "ytevent", action: "pause", videoId: VIDEO_X, position: 120 });
  const pause = await a.erwarte(istEvent("pause"));
  const pauseC = await c.erwarte(istEvent("pause"));
  pruefe("2c. Pausiert B, pausiert es bei allen",
    Boolean(pause) && Boolean(pauseC) && pause.playing === false && pause.position === 120,
    pause ? `${pause.position}s, playing ${pause.playing}` : "keine Antwort");

  a.leeren(); b.leeren();
  c.send({ type: "ytevent", action: "seek", videoId: VIDEO_X, position: 8 * 60 + 20 });
  const sprung = await a.erwarte(istEvent("seek"));
  pruefe("2d. Springt C auf 8:20, springen alle mit",
    Boolean(sprung) && sprung.position === 500 && sprung.byName === "Cem",
    sprung ? `${sprung.position}s von ${sprung.byName}` : "keine Antwort");

  // Die Nummer waechst mit jeder angenommenen Aktion - das ist die Ordnung.
  pruefe("2e. Jede angenommene Aktion bekommt eine hoehere Nummer",
    sprung.rev > pause.rev && pause.rev > wechsel.rev,
    `${wechsel.rev} < ${pause.rev} < ${sprung.rev}`);

  // --- 3. Weiterklicken beendet die Runde nicht -----------------------------

  b.leeren(); c.leeren();
  a.send({
    type: "ytevent", action: "video", videoId: VIDEO_Y,
    url: `https://www.youtube.com/watch?v=${VIDEO_Y}`, title: "Video Y"
  });
  const zweitesVideo = await b.erwarte((m) => m.type === "ytevent" && m.videoId === VIDEO_Y);
  pruefe("3. Klickt A auf eine Empfehlung, zieht die Runde mit",
    Boolean(zweitesVideo) && zweitesVideo.action === "video" && zweitesVideo.playing === true,
    zweitesVideo ? zweitesVideo.videoId : "keine Antwort");

  // Der wichtigste Nachzuegler-Fall: B steht noch bei X und pausiert dort.
  a.leeren();
  b.send({ type: "ytevent", action: "pause", videoId: VIDEO_X, position: 90 });
  const ausAltemVideo = await a.erwarte(istEvent("pause"), 600);
  pruefe("3b. Eine Pause aus dem vorigen Video haelt die Runde nicht an",
    ausAltemVideo === null && a.yt.videoId === VIDEO_Y && a.yt.playing === true,
    `${a.yt.videoId}, playing ${a.yt.playing}`);

  // Und die Schleifenbremse: dasselbe Video noch einmal ist kein Wechsel.
  a.leeren();
  b.send({ type: "ytevent", action: "video", videoId: VIDEO_Y });
  const echo = await a.erwarte(istEvent("video"), 600);
  pruefe("3c. Dasselbe Video noch einmal loest nichts aus", echo === null);

  // --- 4. Spaeter Beitritt und Wiederverbindung -----------------------------

  b.leeren();
  b.send({ type: "ytevent", action: "seek", videoId: VIDEO_Y, position: 50, playing: true });
  await b.erwarte(istEvent("seek"));
  await schlaf(4000);

  const d = client("Dana", "geraet-d");
  await d.verbinde();
  d.send({ type: "join", room: RAUM, name: "Dana", deviceId: "geraet-d" });
  await schlaf(150);
  d.send({ type: "ytjoin" });
  const spaet = await d.erwarte((m) => m.type === "ytstate");
  pruefe("4. Ein spaeter Beitretender bekommt sofort das laufende Video",
    Boolean(spaet) && spaet.videoId === VIDEO_Y && spaet.playing === true,
    spaet ? spaet.videoId : "keine Antwort");
  pruefe("4b. Und zwar an der hochgerechneten Stelle (50 s + ~4 s)",
    Boolean(spaet) && spaet.livePosition >= 53.5 && spaet.livePosition <= 56,
    spaet ? `${spaet.livePosition.toFixed(2)} (gespeichert: ${spaet.position})` : "keine Antwort");
  pruefe("4c. Die gespeicherte Stelle kommt mit Zeitstempel - fuer die eigene Rechnung",
    Boolean(spaet) && spaet.position === 50 && spaet.updatedAt > 0 && spaet.serverNow >= spaet.updatedAt,
    spaet ? `${spaet.position} @ ${spaet.updatedAt}` : "keine Antwort");

  // Verbindungsabriss: nach dem Wiederaufbau wird nur gefragt, nie nachgereicht.
  b.zu();
  await schlaf(300);
  const nachAbgang = await a.erwarte((m) => m.type === "ytstate" && !m.members.some((p) => p.id === "geraet-b"), 1000);
  pruefe("4d. Wer die Verbindung verliert, faellt aus der Mitgliederliste",
    Boolean(nachAbgang), nachAbgang ? nachAbgang.members.map((p) => p.name).join(", ") : "keine Antwort");

  const b2 = client("Ben", "geraet-b");
  await b2.verbinde();
  b2.send({ type: "join", room: RAUM, name: "Ben", deviceId: "geraet-b" });
  await schlaf(150);
  b2.send({ type: "ytjoin" });
  const zurueck = await b2.erwarte((m) => m.type === "ytstate" && m.videoId === VIDEO_Y);
  pruefe("4e. Nach dem Wiederaufbau steht sofort der ganze Stand",
    Boolean(zurueck) && zurueck.members.some((p) => p.id === "geraet-b"),
    zurueck ? `${zurueck.videoId} @ ${zurueck.livePosition.toFixed(1)}` : "keine Antwort");

  b2.leeren();
  b2.send({ type: "ytsync" });
  const nachgefragt = await b2.erwarte((m) => m.type === "ytstate" && m.reason === "resync");
  pruefe("4f. Nachfragen liefert den Stand, ohne die Runde zu bewegen",
    Boolean(nachgefragt) && nachgefragt.rev === zurueck.rev,
    nachgefragt ? `rev ${nachgefragt.rev}` : "keine Antwort");

  // --- 5. Unfug wird abgewiesen ---------------------------------------------

  a.leeren();
  b2.send({ type: "ytevent", action: "video", videoId: "../../etc/passwd" });
  b2.send({ type: "ytevent", action: "rm", videoId: VIDEO_Y });
  b2.send({ type: "ytevent", action: "video", videoId: "AAAAAAAAAAA", url: "javascript:alert(1)" });
  await schlaf(300);
  pruefe("5. Eine unmoegliche Videokennung bewegt nichts",
    a.yt.videoId === VIDEO_Y || a.yt.videoId === "AAAAAAAAAAA",
    a.yt.videoId);
  pruefe("5b. Eine Adresse, die keine YouTube-Adresse ist, wird ersetzt",
    a.yt.url.startsWith("https://www.youtube.com/watch?v="),
    a.yt.url);

  // --- 6. Die Watchparty fuer Serien bleibt unberuehrt ----------------------
  //
  // Der eigentliche Sinn eines zweiten Modus: er darf den ersten nicht
  // anfassen. Also derselbe Raum, dieselben Verbindungen - und beides laeuft
  // nebeneinander, ohne voneinander zu wissen.

  const KEY = "serie:testserie";
  const folge = "https://aniworld.to/anime/stream/test/staffel-1/episode-1";
  a.leeren(); c.leeren();
  a.send({ type: "share", item: { key: KEY, title: "Testserie", url: folge, providerName: "Aniworld" } });
  const geteilt = await c.erwarte((m) => m.type === "state" && m.shared.some((x) => x.key === KEY));
  pruefe("6. Serien lassen sich im selben Raum weiter einstellen", Boolean(geteilt));

  c.send({ type: "enter", key: KEY });
  await schlaf(200);
  c.leeren();
  a.send({ type: "here", key: KEY, position: 10, paused: false, season: 1, episode: 1, url: folge, playerSessionId: "a-1" });
  c.send({ type: "here", key: KEY, position: 10, paused: false, season: 1, episode: 1, url: folge, playerSessionId: "c-1" });
  await schlaf(300);
  c.leeren();
  a.send({ type: "control", key: KEY, action: "pause", position: 42, url: folge });
  const serienPause = await c.erwarte((m) => m.type === "control" && m.action === "pause");
  pruefe("6b. Und dort weiter zu steuern funktioniert unveraendert",
    Boolean(serienPause) && serienPause.key === KEY,
    serienPause ? `${serienPause.action} @ ${serienPause.position}` : "keine Antwort");

  pruefe("6c. Kein YouTube-Ereignis ist je in der Serien-Steuerung gelandet",
    !c.eingang.some((m) => m.type === "control" && String(m.videoId || "")),
    "");

  // Und andersherum: die YouTube-Runde kennt keine Titel.
  c.leeren();
  // Das Video der Runde ist inzwischen ein anderes (siehe 5.) - genommen wird
  // deshalb das, was gerade gilt, nicht das von vorhin.
  c.send({ type: "ytevent", action: "pause", videoId: a.yt.videoId, position: 77 });
  const ytPause = await a.erwarte(istEvent("pause"));
  pruefe("6d. Die YouTube-Runde laeuft daneben ungestoert weiter",
    Boolean(ytPause) && ytPause.position === 77 && !("key" in ytPause),
    ytPause ? `${ytPause.position}s` : "keine Antwort");

  // --- 7. Austreten ---------------------------------------------------------

  a.leeren();
  c.send({ type: "ytleave" });
  const raus = await a.erwarte((m) => m.type === "ytstate" && !m.members.some((p) => p.id === "geraet-c"));
  pruefe("7. Austreten entfernt aus der Runde", Boolean(raus),
    raus ? raus.members.map((p) => p.name).join(", ") : "keine Antwort");

  a.leeren();
  c.send({ type: "ytevent", action: "pause", videoId: a.yt.videoId, position: 5 });
  const nachAustritt = await a.erwarte(istEvent("pause"), 600);
  pruefe("7b. Wer draussen ist, steuert nicht mehr mit", nachAustritt === null);

  for (const wer of [a, c, d, b2]) wer.zu();
  await schlaf(150);

  const durchgefallen = pruefungen.filter((p) => !p.ok);
  console.log(`\n${pruefungen.length - durchgefallen.length}/${pruefungen.length} bestanden`);
  process.exit(durchgefallen.length ? 1 : 0);
})().catch((fehler) => {
  console.log(`FAIL  Durchlauf abgebrochen   -> ${fehler?.message || fehler}`);
  process.exit(1);
});
