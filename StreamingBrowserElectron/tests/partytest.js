"use strict";
// Die zwoelf Faelle aus der Aufgabe, gegen das echte Relay.
const WS = require("../../sync-server/node_modules/ws");

const PORT = Number(process.env.TESTPORT) || 8799;
const ADRESSE = `ws://127.0.0.1:${PORT}`;
const RAUM = "partyraum";
const KEY = "serie:sailormoon";
const folge = (n) => `https://aniworld.to/anime/stream/sailor-moon/staffel-1/episode-${n}`;

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push({ name, ok: Boolean(bedingung) });
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

// Jeder Client pulst, wie der echte Player. Ohne Herzschlag gilt niemand als
// aktiv - und ohne aktive Teilnehmer gibt es keinen Host.
const pulse = [];
function pulsStarten(c, n) {
  c.folge = n;
  const schlag = () => c.send({
    type: "here", key: KEY, position: c.stelle || 0, paused: Boolean(c.pausiert),
    season: 1, episode: c.folge, url: folge(c.folge),
    playerSessionId: `${c.deviceId}-e${c.folge}`
  });
  schlag();
  const t = setInterval(schlag, 700);
  t.unref?.();
  pulse.push(t);
}
function pulsFolge(c, n) { c.folge = n; c.stelle = 0; c.send({
  type: "here", key: KEY, position: 0, paused: Boolean(c.pausiert),
  season: 1, episode: n, url: folge(n), playerSessionId: `${c.deviceId}-e${n}`
}); }

function client(name, deviceId) {
  let socket;
  const eingang = [];
  const warten = [];
  const api = {
    name,
    deviceId,
    zustand: null,
    get socket() { return socket; },
    eingang,
    verbinde: () => new Promise((fertig) => {
      socket = new WS(ADRESSE);
      socket.on("message", (roh) => {
        const m = JSON.parse(String(roh));
        eingang.push(m);
        // Getrennt vom Posteingang mitfuehren: leeren() wirft sonst den zuletzt
        // gesehenen Raumzustand mit weg.
        if (m.type === "state" && Array.isArray(m.shared)) {
          const treffer = m.shared.find((x) => x.key === KEY);
          if (treffer) api.zustand = treffer;
        }
        for (let i = warten.length - 1; i >= 0; i -= 1) {
          if (warten[i].passt(m)) { warten[i].resolve(m); warten.splice(i, 1); }
        }
      });
      socket.on("open", fertig);
    }),
    send: (m) => socket.send(JSON.stringify(m)),
    zu: () => socket.close(),
    leeren: () => { eingang.length = 0; },
    erwarte: (passt, was, ms = 1500) => new Promise((resolve) => {
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

// Der Raumzustand, wie ein Client ihn zuletzt gesehen hat.
function letzterEintrag(c) {
  return c.zustand;
}

async function beitreten(c, teilen = false) {
  await c.verbinde();
  c.send({ type: "join", room: RAUM, name: c.name, deviceId: c.deviceId });
  await c.erwarte((m) => m.type === "state", "state");
  if (teilen) {
    c.send({ type: "share", item: { key: KEY, url: folge(1), title: "Sailor Moon", type: "serie", season: 1, episode: 1 } });
  } else {
    c.send({ type: "enter", key: KEY });
  }
  await c.erwarte((m) => m.type === "state" && m.shared?.some((x) => x.memberIds?.includes(c.deviceId)), "beigetreten");
}

(async () => {
  const A = client("A", "geraet-a");
  const B = client("B", "geraet-b");
  const C = client("C", "geraet-c");

  // --- 1. A ist Host, B tritt bei, A bleibt Host -------------------------
  await beitreten(A, true);
  pulsStarten(A, 1);
  await schlaf(200);
  await beitreten(B);
  pulsStarten(B, 1);
  await schlaf(300);
  pruefe("1. A ist Host, B tritt bei, A bleibt Host",
    letzterEintrag(B)?.hostId === A.deviceId, `hostId=${letzterEintrag(B)?.hostId}`);

  // --- 2. A spielt Folge 1, B sieht Folge 1 ------------------------------
  A.leeren(); B.leeren();
  A.send({ type: "control", key: KEY, action: "play", position: 12, url: folge(1) });
  const play1 = await B.erwarte((m) => m.type === "control" && m.action === "play", "play");
  pruefe("2. B bekommt Folge 1 mit der richtigen Adresse",
    play1 && play1.url === folge(1), play1 ? play1.url : "kam nicht");

  // --- 3. Naechste Folge: beide wechseln --------------------------------
  A.leeren(); B.leeren();
  A.send({ type: "control", key: KEY, action: "navigate", position: 0, url: folge(2) });
  pulsFolge(A, 2);
  const nav = await B.erwarte((m) => m.type === "control" && m.action === "navigate", "navigate");
  // B zieht nach, wie es die App tut, sobald der Wechsel ankommt. Ohne das
  // stuende B weiter auf Folge 1 - und ein Befehl aus Folge 2 ginge es
  // zu Recht nichts mehr an.
  await schlaf(120);
  pulsFolge(B, 2);
  const stand2 = await B.erwarte((m) => m.type === "state" && m.shared?.some((x) => x.key === KEY && x.episode === 2), "state E2");
  pruefe("3. Wechsel auf Folge 2 erreicht B", nav?.url === folge(2), nav ? nav.url : "kam nicht");
  pruefe("3b. Die Runde fuehrt sofort Folge 2", Boolean(stand2),
    stand2 ? `S${letzterEintrag(B)?.season}E${letzterEintrag(B)?.episode}` : "Runde blieb auf Folge 1");

  // --- 4. Nach dem Wechsel pausiert A -> B pausiert ----------------------
  A.leeren(); B.leeren();
  await schlaf(150);
  A.send({ type: "control", key: KEY, action: "pause", position: 20, url: folge(2) });
  const pause = await B.erwarte((m) => m.type === "control" && m.action === "pause", "pause");
  pruefe("4. Nach dem Folgenwechsel wirkt Pause bei B", Boolean(pause),
    pause ? `position=${pause.position.toFixed(2)} url=${pause.url ? "mit Adresse" : "ohne"}` : "kam nicht");
  pruefe("4b. Die Pause traegt die Folge mit, nicht den alten Raumstand",
    pause?.url === folge(2), pause?.url || "keine Adresse");

  // --- 5. B startet wieder -> A wird mitgenommen -------------------------
  A.leeren(); B.leeren();
  B.send({ type: "control", key: KEY, action: "play", position: 20, url: folge(2) });
  const zurueck = await A.erwarte((m) => m.type === "control" && m.action === "play", "play an A");
  pruefe("5. B startet, A wird mitgenommen", Boolean(zurueck),
    zurueck ? `position=${zurueck.position.toFixed(2)}` : "kam nicht");

  // --- 6. Mehrfach wechseln, danach jeweils steuern ----------------------
  let allesOk = true;
  const berichte = [];
  for (const n of [3, 4, 5]) {
    // B zieht nach, wie im echten Ablauf kurz nach A.
    A.leeren(); B.leeren();
    A.send({ type: "control", key: KEY, action: "navigate", position: 0, url: folge(n) });
    pulsFolge(A, n);
    await B.erwarte((m) => m.type === "control" && m.action === "navigate", "nav");
    await schlaf(120);
    pulsFolge(B, n);
    await schlaf(120);
    A.leeren(); B.leeren();
    A.send({ type: "control", key: KEY, action: "pause", position: 8, url: folge(n) });
    const p = await B.erwarte((m) => m.type === "control" && m.action === "pause", "pause");
    A.send({ type: "control", key: KEY, action: "play", position: 8, url: folge(n) });
    const w = await B.erwarte((m) => m.type === "control" && m.action === "play", "play");
    A.send({ type: "control", key: KEY, action: "seek", position: 60, url: folge(n) });
    const sp = await B.erwarte((m) => m.type === "control" && m.action === "seek", "seek");
    const raum = letzterEintrag(B);
    const ok = Boolean(p && w && sp) && raum?.episode === n;
    if (!ok) allesOk = false;
    berichte.push(`E${n}:${ok ? "ok" : "fehler"}`);
  }
  pruefe("6. Nach jedem Wechsel wirken Pause, Weiter und Sprung", allesOk, berichte.join(" "));

  // --- 8. Die Runde behauptet nie die alte Folge -------------------------
  A.leeren(); B.leeren();
  A.send({ type: "control", key: KEY, action: "navigate", position: 0, url: folge(6) });
  pulsFolge(A, 6);
  await schlaf(120);
  pulsFolge(B, 6);
  await B.erwarte((m) => m.type === "state" && m.shared?.some((x) => x.key === KEY && x.episode === 6), "state E6");
  pruefe("8. Nach wenigen Sekunden fuehrt die Runde die neue Folge",
    letzterEintrag(B)?.episode === 6, `Folge ${letzterEintrag(B)?.episode}`);

  // --- 8b. Der Fortschritt im Raum folgt der Folge -----------------------
  // Vorher stand die neue Folge da, daneben aber die Stelle der alten.
  const raumJetzt = letzterEintrag(B);
  pruefe("8b. Der Fortschritt im Raum gehoert zur neuen Folge",
    raumJetzt?.progress && raumJetzt.progress.episode === 6 && raumJetzt.progress.position < 10,
    raumJetzt?.progress
      ? `Folge ${raumJetzt.progress.episode} bei ${raumJetzt.progress.position}s`
      : "kein Fortschritt");

  // --- 8c. Wer nicht mehr meldet, faellt aus der Leiste ------------------
  A.leeren();
  const mitBeiden = await A.erwarte((m) => m.type === "watchstate" && m.members.length >= 1, "Leiste");
  pruefe("8c. Nur wer sich meldet, steht in der Leiste",
    mitBeiden?.members.every((m) => m.id === "geraet-a" || m.id === "geraet-b"),
    mitBeiden ? mitBeiden.members.map((m) => m.name).join(", ") : "keine Leiste");

  // --- 9. B reconnectet -> A bleibt Host ---------------------------------
  B.zu();
  await schlaf(300);
  const B2 = client("B", "geraet-b");
  await beitreten(B2);
  pulsStarten(B2, 6);
  await schlaf(300);
  pruefe("9. Nach dem Reconnect von B bleibt A Host",
    letzterEintrag(B2)?.hostId === A.deviceId, `hostId=${letzterEintrag(B2)?.hostId}`);

  // --- 11 vorbereiten: C tritt bei, waehrend A noch Host ist -------------
  await beitreten(C);
  pulsStarten(C, 6);
  await schlaf(300);
  pruefe("11a. C tritt bei, A bleibt Host",
    letzterEintrag(C)?.hostId === A.deviceId, `hostId=${letzterEintrag(C)?.hostId}`);

  // --- 10. A verlaesst die Party -> B wird Host (frueher beigetreten) ----
  B2.leeren(); C.leeren();
  A.send({ type: "leave", key: KEY });
  await B2.erwarte((m) => m.type === "state" && m.shared?.some((x) => x.key === KEY && x.hostId && x.hostId !== A.deviceId), "neuer Host");
  await schlaf(200);
  pruefe("10. A verlaesst die Party, B wird Host (frueher beigetreten als C)",
    letzterEintrag(B2)?.hostId === B2.deviceId, `hostId=${letzterEintrag(B2)?.hostId}`);

  // --- 11. Ein neuer Teilnehmer aendert den Host nicht -------------------
  const D = client("D", "geraet-d");
  await beitreten(D);
  pulsStarten(D, 6);
  await schlaf(300);
  pruefe("11. Ein neuer Teilnehmer aendert den Host nicht",
    letzterEintrag(D)?.hostId === B2.deviceId, `hostId=${letzterEintrag(D)?.hostId}`);

  // --- 12. Kein Echo an den Absender -------------------------------------
  B2.leeren();
  B2.send({ type: "control", key: KEY, action: "play", position: 90, url: folge(6) });
  await schlaf(400);
  const echo = B2.eingang.filter((m) => m.type === "control" && m.action === "play");
  pruefe("12. Ein eigener Befehl kommt nicht als Echo zurueck", echo.length === 0,
    `${echo.length} Echos`);

  for (const t of pulse) clearInterval(t);
  for (const c of [A, B2, C, D]) c.zu();
  const fehler = pruefungen.filter((p) => !p.ok);
  console.log(`\n${pruefungen.length - fehler.length}/${pruefungen.length} bestanden`);
  process.exit(fehler.length ? 1 : 0);
})().catch((fehler) => {
  console.error("Abgebrochen:", fehler.message);
  process.exit(2);
});
