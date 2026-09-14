"use strict";

// Das Folgenende in der Runde, nachgestellt am echten Relay.
//
// Gemeldet am 14.9.2026: "bei Ende der Folge startet einfach die Folge neu",
// und "wenn ein Gast Naechste Folge drueckt, kommt der Host nicht mit". Beides
// hatte eine Ursache: bei 90 % rueckt die App den eigenen Eintrag auf die
// naechste Folge vor und meldet "Folge 2 bei 0 s" als Fortschritt - waehrend
// alle noch Folge 1 schauen. Das Relay nahm das als Stand der Runde. Danach
// zog der Nachziehtakt jedes Geraet einzeln, und jedes echte "Weiter" galt als
// "schon dort": der Druecker bekam ein Nachreichen bei 0 s, die anderen nichts.
//
// Die Regel seither: die Folge der Runde wechselt nur durch einen Knopfdruck
// (navigate) oder einen beobachteten Playerwechsel (here) - und wer drueckt,
// nimmt alle mit.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const WS = require("../../sync-server/node_modules/ws");

const PORT = Number(process.env.TESTPORT) || 8799;
const ROOM = "folgenende";
const KEY = "serie:folgenende";
const URL = (n) => `https://aniworld.to/anime/stream/starter/staffel-1/episode-${n}`;
const proof = (id) => crypto.createHash("sha256").update(id).digest("base64url");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let bestanden = 0;
let gesamt = 0;
function pruefe(name, wert) {
  gesamt += 1;
  if (wert) {
    bestanden += 1;
    console.log(`ok   ${name}`);
  } else {
    console.log(`FAIL ${name}`);
  }
}

function client(id, name) {
  const messages = [];
  const socket = new WS(`ws://127.0.0.1:${PORT}`);
  socket.on("message", (raw) => messages.push(JSON.parse(String(raw))));
  const c = {
    id, name, messages, episode: 1, position: 0, paused: false,
    mark: () => messages.length,
    send: (message) => socket.send(JSON.stringify(message)),
    open: () => new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    }),
    close: () => socket.close(),
    // Der Herzschlag des Players: Folge, Stelle, Sitzung.
    here: () => c.send({ type: "here", key: KEY, position: c.position, paused: c.paused,
      duration: 100, url: URL(c.episode), season: 1, episode: c.episode,
      playerSessionId: `${id}-e${c.episode}` }),
    weiter: (ziel, von) => c.send({ type: "control", key: KEY, action: "navigate",
      position: 0, url: URL(ziel), fromEpisodeId: von }),
    ab: (from, filter) => messages.slice(from).filter(filter),
    waitFor: async (from, predicate, label, frist = 2000) => {
      const deadline = Date.now() + frist;
      while (Date.now() < deadline) {
        const found = messages.slice(from).find(predicate);
        if (found) return found;
        await wait(15);
      }
      throw new Error(`${name}: Zeitueberschreitung: ${label}; ${JSON.stringify(messages.slice(from).slice(-5))}`);
    }
  };
  return c;
}

async function schlagen(alle, sekunden) {
  for (let i = 0; i < sekunden; i += 1) {
    await wait(1000);
    for (const c of alle) {
      if (!c.paused) c.position += 1;
      c.here();
    }
  }
}

async function run() {
  const host = client("host", "Host");
  const gast1 = client("gast1", "Gast1");
  const gast2 = client("gast2", "Gast2");
  const alle = [host, gast1, gast2];
  try {
    await Promise.all(alle.map((c) => c.open()));
    for (const c of alle) c.send({ type: "join", room: ROOM, name: c.name, deviceProof: proof(c.id) });
    await Promise.all(alle.map((c) => c.waitFor(0, (m) => m.type === "state" && m.you, "Join")));
    let mark = host.mark();
    host.send({ type: "share", item: { key: KEY, url: URL(1), title: "Starter", type: "serie", season: 1, episode: 1 } });
    await host.waitFor(mark, (m) => m.type === "state" && m.shared?.some((item) => item.key === KEY), "Titel");
    for (const gast of [gast1, gast2]) {
      mark = host.mark();
      gast.send({ type: "enter", key: KEY });
      await host.waitFor(mark, (m) => m.type === "state"
        && m.shared?.find((item) => item.key === KEY)?.memberIds?.includes(gast.id) !== undefined, "Eintritt");
    }

    // Alle drei spielen Folge 1, kurz vor dem Ende. Der Host zuerst - die
    // Hostwahl folgt dem ersten bestaetigten Playerstand.
    for (const c of alle) c.position = 92;
    mark = host.mark();
    host.here();
    await host.waitFor(mark, (m) => m.type === "watchstate" && m.key === KEY
      && m.members?.some((member) => member.name === "Host" && member.host), "Hostwahl");
    for (const c of [gast1, gast2]) c.here();
    await host.waitFor(mark, (m) => m.type === "watchstate" && m.members?.length === 3, "drei Player");

    // 1. Bei 90 % rueckt der Eintrag des Hosts auf Folge 2 vor und meldet das
    //    als Fortschritt. Die Runde bleibt trotzdem bei Folge 1: niemand wird
    //    weitergesagt, niemand wird vom Takt gezogen.
    const vorruecken = alle.map((c) => c.mark());
    host.send({ type: "progress", key: KEY, progress: { url: URL(2), season: 1, episode: 2,
      position: 0, duration: 0, progress: 0, completed: false, episodeCompleted: false } });
    // Ueber einen vollen Nachziehtakt (5 s) hinweg weiterschlagen.
    await schlagen(alle, 6);
    pruefe("vorausgebuchte Folge 2 wird niemandem weitergesagt",
      !gast1.ab(vorruecken[1], (m) => m.type === "progress" && m.progress?.episode === 2).length
      && !gast2.ab(vorruecken[2], (m) => m.type === "progress" && m.progress?.episode === 2).length);
    pruefe("der Nachziehtakt zieht niemanden auf Folge 2",
      alle.every((c, i) => !c.ab(vorruecken[i], (m) => m.type === "control" && m.action === "navigate").length));
    const karte = [...host.messages].reverse().find((m) => m.type === "state")?.shared?.find((item) => item.key === KEY);
    pruefe("die Karte der Runde steht weiter bei Folge 1", karte?.episode === 1);

    // 2. Ein Gast drueckt "Naechste Folge". Alle drei bekommen dieselbe
    //    Vorbereitung - der Host eingeschlossen.
    const druck = alle.map((c) => c.mark());
    gast1.weiter(2, "s1e1");
    const vorbereitungen = await Promise.all(alle.map((c, i) => c.waitFor(druck[i],
      (m) => m.type === "syncprepare" && m.reason === "episode-change", "Vorbereitung Folge 2")));
    pruefe("jeder bekommt die Vorbereitung fuer Folge 2",
      vorbereitungen.every((m) => m.url === URL(2) && m.episodeId === "s1e2"));
    pruefe("eine gemeinsame Schranke fuer alle",
      new Set(vorbereitungen.map((m) => m.syncId)).size === 1);

    // Die Countdowns der anderen laufen gleichzeitig ab - ihr "Weiter" kommt
    // Millisekunden spaeter fuer dieselbe Folge. Das darf weder eine zweite
    // Schranke aufmachen noch jemanden bei 0 s pausiert nachreichen.
    const doppelt = alle.map((c) => c.mark());
    host.weiter(2, "s1e1");
    gast2.weiter(2, "s1e1");
    await wait(150);
    pruefe("gleichzeitige Weiter-Druecke oeffnen keine zweite Schranke",
      alle.every((c, i) => c.ab(doppelt[i], (m) => m.type === "syncprepare"
        && m.syncId !== vorbereitungen[0].syncId).length === 0));
    pruefe("und niemand wird einzeln bei 0 s nachgereicht",
      alle.every((c, i) => c.ab(doppelt[i], (m) => m.type === "syncstart" && m.reason === "episode-catchup").length === 0));

    // Alle laden Folge 2 und melden bereit - dann ein gemeinsamer Start.
    const start = alle.map((c) => c.mark());
    for (const c of alle) {
      c.episode = 2; c.position = 0; c.paused = true;
      c.here();
      c.send({ type: "syncready", key: KEY, syncId: vorbereitungen[0].syncId });
    }
    const starts = await Promise.all(alle.map((c, i) => c.waitFor(start[i],
      (m) => m.type === "syncstart" && m.syncId === vorbereitungen[0].syncId, "gemeinsamer Start")));
    pruefe("alle starten Folge 2 gemeinsam bei 0",
      starts.every((m) => m.url === URL(2) && m.position === 0 && m.playing === true));
    pruefe("genau ein Start je Geraet",
      alle.every((c, i) => c.ab(start[i], (m) => m.type === "syncstart").length === 1));
    for (const c of alle) c.paused = false;
    await schlagen(alle, 1);

    // 3. Wer von einer Folge aus weiterdrueckt, die das Relay nicht als
    //    Rundenstand kennt, aber dabei *vor* der Runde landet, wechselt
    //    wirklich. Gast2 ist von sich aus schon auf Folge 3 (die Runde weiss
    //    es nicht: sein Herzschlag kam noch nicht) und drueckt auf Folge 4.
    const voraus = alle.map((c) => c.mark());
    gast2.weiter(4, "s1e3");
    const weiter = await Promise.all(alle.map((c, i) => c.waitFor(voraus[i],
      (m) => m.type === "syncprepare" && m.reason === "episode-change", "Vorbereitung Folge 4")));
    pruefe("ein Wechsel nach vorn nimmt die Runde mit, auch aus unbekannter Ausgangsfolge",
      weiter.every((m) => m.url === URL(4) && m.episodeId === "s1e4"));
    pruefe("kein Nachreichen auf die aeltere Rundenfolge",
      alle.every((c, i) => !c.ab(voraus[i], (m) => m.type === "syncstart" && m.reason === "episode-catchup").length));

    // 4. Wer dagegen hinter der Runde haengt und mit seiner alten Liste auf
    //    eine aeltere Folge drueckt, wird nachgeholt statt alle zurueckzuziehen.
    //    Gast1 meldet zwar bereit, sein Player kommt aber nicht von Folge 2
    //    weg - kein Herzschlag von Folge 4.
    for (const c of alle) {
      if (c !== gast1) { c.episode = 4; c.position = 0; c.paused = true; c.here(); }
      c.send({ type: "syncready", key: KEY, syncId: weiter[0].syncId });
    }
    await host.waitFor(voraus[0], (m) => m.type === "syncstart" && m.syncId === weiter[0].syncId, "Start Folge 4");
    for (const c of alle) c.paused = false;
    await schlagen([host, gast2], 1);
    const spaet = alle.map((c) => c.mark());
    gast1.weiter(3, "s1e2");
    const nachgeholt = await gast1.waitFor(spaet[1], (m) => m.type === "syncstart"
      && m.reason === "episode-catchup", "Nachholen");
    pruefe("ein Ruecksprung aus alter Liste holt die laufende Folge nach", nachgeholt.url === URL(4));
    await wait(100);
    pruefe("und zieht die anderen nicht zurueck",
      !host.ab(spaet[0], (m) => m.type === "syncprepare").length
      && !gast2.ab(spaet[2], (m) => m.type === "syncprepare").length);
  } finally {
    for (const c of alle) c.close();
  }
  console.log(`${bestanden}/${gesamt} bestanden`);
  if (bestanden !== gesamt) process.exitCode = 1;
}

run().catch((error) => { console.error("FAIL", error.message); process.exitCode = 1; });
