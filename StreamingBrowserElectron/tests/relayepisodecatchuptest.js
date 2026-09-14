"use strict";

// Hat ein Geraet die Vorbereitung eines bereits abgeschlossenen Wechsels
// verpasst, meldet es beim eigenen "Weiter" noch dieselbe Zieladresse. Das
// Relay muss ihm dann trotzdem die aktuelle Folge gezielt nachreichen.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const WS = require("../../sync-server/node_modules/ws");

const PORT = Number(process.env.TESTPORT) || 8799;
const ROOM = "episode-catchup";
const KEY = "serie:episode-catchup";
const URL1 = "https://aniworld.to/anime/stream/starter/staffel-1/episode-1";
const URL2 = "https://aniworld.to/anime/stream/starter/staffel-1/episode-2";
const URL3 = "https://aniworld.to/anime/stream/starter/staffel-1/episode-3";
const proof = (id) => crypto.createHash("sha256").update(id).digest("base64url");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function client(id) {
  const messages = [];
  const socket = new WS(`ws://127.0.0.1:${PORT}`);
  socket.on("message", (raw) => messages.push(JSON.parse(String(raw))));
  return {
    messages,
    mark: () => messages.length,
    send: (message) => socket.send(JSON.stringify(message)),
    open: () => new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    }),
    close: () => socket.close(),
    waitFor: async (from, predicate, label) => {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const found = messages.slice(from).find(predicate);
        if (found) return found;
        await wait(15);
      }
      throw new Error(`Zeitueberschreitung: ${label}; ${JSON.stringify(messages.slice(from))}`);
    }
  };
}

async function run() {
  const host = client("host");
  const guest = client("guest");
  try {
    await Promise.all([host.open(), guest.open()]);
    host.send({ type: "join", room: ROOM, name: "Host", deviceProof: proof("host") });
    guest.send({ type: "join", room: ROOM, name: "Gast", deviceProof: proof("guest") });
    await Promise.all([
      host.waitFor(0, (m) => m.type === "state" && m.you, "Host-Join"),
      guest.waitFor(0, (m) => m.type === "state" && m.you, "Gast-Join")
    ]);

    let mark = host.mark();
    host.send({ type: "share", item: { key: KEY, url: URL1, title: "Starter", type: "serie", season: 1, episode: 1 } });
    await host.waitFor(mark, (m) => m.type === "state" && m.shared?.some((item) => item.key === KEY), "Titel");
    mark = host.mark();
    guest.send({ type: "enter", key: KEY });
    await host.waitFor(mark, (m) => m.type === "state" && m.shared?.find((item) => item.key === KEY)?.memberIds?.length === 2, "Gast-Eintritt");

    // Die Hostwahl folgt dem ersten bestaetigten Playerstand. Zwei parallel
    // gesendete `here` auf verschiedenen Sockets haben keine feste Reihenfolge.
    const firstPlayerMark = host.mark();
    host.send({ type: "here", key: KEY, position: 10, paused: false, url: URL1,
      season: 1, episode: 1, playerSessionId: "host-e1" });
    await host.waitFor(firstPlayerMark, (m) => m.type === "watchstate" && m.key === KEY
      && m.members?.some((member) => member.name === "Host" && member.host), "bestaetigte Hostwahl");
    const playerMark = host.mark();
    guest.send({ type: "here", key: KEY, position: 10, paused: false, url: URL1,
      season: 1, episode: 1, playerSessionId: "guest-e1" });
    await host.waitFor(playerMark, (m) => m.type === "watchstate" && m.key === KEY && m.members?.length === 2, "beide Player");

    const hostMark = host.mark();
    const guestMark = guest.mark();
    host.send({ type: "control", key: KEY, action: "navigate", position: 0, url: URL2 });
    const prepareHost = await host.waitFor(hostMark, (m) => m.type === "syncprepare" && m.reason === "episode-change", "Host-Vorbereitung");
    const prepareGuest = await guest.waitFor(guestMark, (m) => m.type === "syncprepare" && m.reason === "episode-change", "Gast-Vorbereitung");
    assert.equal(prepareHost.syncId, prepareGuest.syncId, "eine gemeinsame Barrier-Generation");
    host.send({ type: "syncready", key: KEY, syncId: prepareHost.syncId });
    // Der Gast ist noch auf der alten Folge und drueckt erneut weiter. Das
    // darf weder die Schranke ersetzen noch die bereits fertige Host-Seite
    // erneut vorbereiten; dieselbe Generation wird nur an ihn wiederholt.
    const replayHostMark = host.mark();
    const replayGuestMark = guest.mark();
    guest.send({ type: "control", key: KEY, action: "navigate", position: 0, url: URL2 });
    const replay = await guest.waitFor(replayGuestMark,
      (m) => m.type === "syncprepare" && m.syncId === prepareHost.syncId,
      "Wiederholung der bestehenden Vorbereitung");
    assert.equal(replay.reason, "episode-change");
    await wait(50);
    assert.equal(host.messages.slice(replayHostMark).filter((m) => m.type === "syncprepare" || m.type === "syncstart").length, 0,
      "der erneute Gast-Klick haelt oder startet die uebrigen nicht neu");
    // Der alte Player bucht beim Schliessen noch seinen Fortschritt. Auch
    // beim Host darf diese spaete Meldung das vereinbarte Ziel nicht ersetzen.
    const oldProgressMark = guest.mark();
    host.send({ type: "progress", key: KEY, progress: { url: URL1, season: 1, episode: 1,
      position: 99, duration: 100, progress: 99, completed: true, episodeCompleted: true } });
    await wait(80);
    assert.equal(guest.messages.slice(oldProgressMark).filter((m) => m.type === "progress"
      && m.progress?.episode === 1).length, 0, "alter Host-Fortschritt zieht die offene Schranke nicht zurueck");
    host.send({ type: "progress", key: KEY, progress: { url: URL3, season: 1, episode: 3,
      position: 0, duration: 100, progress: 0 } });
    await wait(80);
    assert.equal(guest.messages.slice(oldProgressMark).filter((m) => m.type === "progress"
      && m.progress?.episode === 3).length, 0, "vorausgebuchter Fortschritt ersetzt keine offene Zielfolge");
    const newPlayerMark = host.mark();
    host.send({ type: "here", key: KEY, position: 0, paused: true, duration: 100,
      url: URL2, season: 1, episode: 2, playerSessionId: "host-e2" });
    await host.waitFor(newPlayerMark, (m) => m.type === "watchstate" && m.members?.some(
      (member) => member.name === "Host" && member.episode === 2), "neuer Host-Player vor Freigabe");
    host.send({ type: "here", key: KEY, position: 99, paused: false, duration: 100,
      url: URL1, season: 1, episode: 1, playerSessionId: "host-e1" });
    await wait(100);
    guest.send({ type: "syncready", key: KEY, syncId: prepareHost.syncId });
    const start = await host.waitFor(hostMark, (m) => m.type === "syncstart" && m.syncId === prepareHost.syncId, "gemeinsamer Start");
    assert.equal(start.url, URL2, "die Startadresse bleibt die gewaehlte Folge");
    assert.equal(start.episodeId, "s1e2", "Startadresse und Folgenkennung bleiben konsistent");
    await wait(50);
    assert.equal(host.messages.slice(hostMark).filter((m) => m.type === "syncstart" && m.syncId === prepareHost.syncId).length, 1,
      "die Barrier startet genau einmal");
    const targetPlayerMark = host.mark();
    host.send({ type: "here", key: KEY, position: 23, paused: false, url: URL2,
      season: 1, episode: 2, playerSessionId: "host-e2" });
    await host.waitFor(targetPlayerMark, (m) => m.type === "watchstate" && m.key === KEY
      && m.members?.some((member) => member.name === "Host" && member.host
        && member.episode === 2 && member.paused === false), "Host spielt die Zielfolge");
    const staleAfterStartMark = guest.mark();
    host.send({ type: "progress", key: KEY, progress: { url: URL1, season: 1, episode: 1,
      position: 99, duration: 100, progress: 99, completed: true, archived: true } });
    await wait(80);
    assert.equal(guest.messages.slice(staleAfterStartMark).some((m) => m.type === "progress"
      && m.progress?.episode === 1), false, "alter Fortschritt bleibt auch nach dem Start wirkungslos");

    // Der Gast hat seinen alten Playerstand noch nicht mit einem `here` auf
    // Folge 2 bestaetigt. Sein manuelles Weiter schickt die Zieladresse, wird
    // bisher als `schonDort` erkannt und ohne jede Antwort verschluckt.
    const retryMark = guest.mark();
    const hostCatchupMark = host.mark();
    guest.send({ type: "control", key: KEY, action: "navigate", position: 0, url: URL2 });
    const catchup = await guest.waitFor(retryMark,
      (m) => m.type === "syncstart" && m.reason === "episode-catchup" && m.url === URL2,
      "gezieltes Nachreichen des Rundenstands");
    assert.equal(catchup.episodeId, "s1e2");
    assert.equal(catchup.playing, true, "der laufende Rundenstand bleibt laufend");
    assert.equal(catchup.startAt, 0, "Nachreichen rechnet vom aktuellen Zeitstempel statt von einem neuen Rundenstart");
    assert.equal(host.messages.slice(hostCatchupMark).filter((m) => m.type === "syncprepare" || m.type === "syncstart").length, 0,
      "Catch-up an den Gast belaesst die Peers unveraendert");

    // Derselbe Nachholweg darf eine pausierte Ziel-Folge nicht wieder starten.
    const pauseMark = host.mark();
    host.send({ type: "control", key: KEY, action: "pause", position: 23, url: URL2 });
    await host.waitFor(pauseMark, (m) => m.type === "control" && m.action === "pause", "Pause der Ziel-Folge");
    const pausedRetryMark = guest.mark();
    guest.send({ type: "control", key: KEY, action: "navigate", position: 0, url: URL2 });
    const pausedCatchup = await guest.waitFor(pausedRetryMark,
      (m) => m.type === "syncstart" && m.reason === "episode-catchup", "pausiertes Nachreichen");
    assert.equal(pausedCatchup.playing, false, "eine pausierte Runde bleibt beim Nachholen angehalten");
    assert.equal(pausedCatchup.position, 23, "der pausierte Stand wird beibehalten");

    // Nach Reconnect gibt es fuer die stabile ID zunaechst noch keinen `here`.
    // Auch dann darf das identische Ziel nicht still verworfen werden.
    const beforeBye = host.mark();
    guest.send({ type: "bye", key: KEY });
    await host.waitFor(beforeBye, (m) => m.type === "watchstate" && m.key === KEY
      && m.members?.length === 1 && m.members[0].name === "Host", "Gast-Player abgemeldet");
    const missingHereMark = guest.mark();
    guest.send({ type: "control", key: KEY, action: "navigate", position: 0, url: URL2 });
    const missingHere = await guest.waitFor(missingHereMark,
      (m) => m.type === "syncstart" && m.reason === "episode-catchup", "Nachholen ohne frischen Playerstand");
    assert.equal(missingHere.playing, false, "ohne here bleibt der pausierte Raum pausiert");

    // Fortschritt kann der laufenden Folge voraus sein: bei 90 % rueckt die App
    // ihren Eintrag auf Folge 3 vor und meldet "Folge 3 bei 0", waehrend der
    // Player noch Folge 2 spielt. Solange jemand Folge 2 wirklich schaut, ist
    // das kein Stand der Runde - er wird weder uebernommen noch weitergesagt.
    // Sonst galt die Runde als "schon bei Folge 3", der Nachziehtakt riss jedes
    // Geraet einzeln dorthin, und das echte "Weiter" fand keine Runde mehr vor.
    const progressMark = guest.mark();
    host.send({ type: "progress", key: KEY, progress: { url: URL3, season: 1, episode: 3,
      position: 0, duration: 100, progress: 0, completed: false, episodeCompleted: false } });
    await wait(80);
    assert.equal(guest.messages.slice(progressMark).some((m) => m.type === "progress"
      && m.progress?.episode === 3), false, "vorausgebuchter Fortschritt rueckt die laufende Runde nicht vor");
    const stateNachProgress = [...host.messages].reverse().find((m) => m.type === "state");
    assert.equal(stateNachProgress?.shared?.find((item) => item.key === KEY)?.episode, 2,
      "die Runde bleibt bei der Folge, die gerade laeuft");
    const aheadMark = host.mark();
    host.send({ type: "control", key: KEY, action: "navigate", position: 0, url: URL3 });
    const aheadPrepare = await host.waitFor(aheadMark,
      (m) => m.type === "syncprepare" && m.reason === "episode-change" && m.url === URL3,
      "echte Vorbereitung trotz vorausgebuchtem Fortschritt");
    assert.ok(aheadPrepare.syncId, "der echte Wechsel hat eine neue Barrier-Generation");

    host.send({ type: "syncready", key: KEY, syncId: aheadPrepare.syncId });
    const aheadStart = await host.waitFor(aheadMark, (m) => m.type === "syncstart"
      && m.syncId === aheadPrepare.syncId, "Start Folge 3");
    await wait(Math.max(0, aheadStart.startAt - Date.now()) + 30);
    const arrivedMark = host.mark();
    host.send({ type: "here", key: KEY, url: URL3, season: 1, episode: 3,
      position: 12, paused: false, playerSessionId: "host-e3" });
    await host.waitFor(arrivedMark, (m) => m.type === "watchstate" && m.members?.some(
      (member) => member.name === "Host" && member.episode === 3), "Host bei Folge 3 angekommen");

    // Ein verzoegerter Weiter-Klick eines zurueckliegenden Players darf die
    // bereits laufende Folge 3 nicht durch einen Neustart von Folge 2 ersetzen.
    const laggerMark = host.mark();
    guest.send({ type: "here", key: KEY, url: URL1, season: 1, episode: 1,
      position: 99, paused: true, playerSessionId: "guest-late-e1" });
    await host.waitFor(laggerMark, (m) => m.type === "watchstate" && m.members?.some(
      (member) => member.name === "Gast" && member.episode === 1), "zurueckliegender Gast");
    const lateNextHost = host.mark();
    const lateNextGuest = guest.mark();
    guest.send({ type: "control", key: KEY, action: "navigate", position: 0, url: URL2 });
    const caughtUp = await guest.waitFor(lateNextGuest, (m) => m.type === "syncstart"
      && m.reason === "episode-catchup", "veraltetes Weiter holt aktuelle Folge nach");
    assert.equal(caughtUp.url, URL3);
    assert.ok(caughtUp.position >= 12 && caughtUp.position < 14,
      "die laufende Folge wird beim Nachholen nicht auf null gesetzt");
    assert.equal(host.messages.slice(lateNextHost).some((m) => m.type === "syncprepare"), false,
      "veraltetes Weiter startet keine rueckwaertige Schranke");
    const explicitStaleMark = guest.mark();
    guest.send({ type: "control", key: KEY, action: "navigate", position: 0,
      url: URL2, fromEpisodeId: "s1e1" });
    const explicitStale = await guest.waitFor(explicitStaleMark, (m) => m.type === "syncstart"
      && m.reason === "episode-catchup", "ausdruecklich veraltete Ausgangsfolge");
    assert.equal(explicitStale.url, URL3);
    guest.send({ type: "bye", key: KEY });
    await host.waitFor(host.mark(), (m) => m.type === "watchstate" && m.members?.length === 1,
      "Gast vor eigenstaendigen Staffeltests abgemeldet");

    // Die Nummer geht beim Staffelwechsel wieder auf eins. Spaete Meldungen
    // aus Staffel 1 bleiben alt; eine bewusst rueckwaerts gewaehlte Folge
    // funktioniert trotzdem und darf normal Fortschritt buchen.
    for (const target of [
      { url: URL1.replace("staffel-1", "staffel-2"), season: 2, episode: 1 },
      { url: URL1, season: 1, episode: 1 }
    ]) {
      const targetMark = host.mark();
      host.send({ type: "control", key: KEY, action: "navigate", position: 0, url: target.url,
        fromEpisodeId: target.season === 2 ? "s1e3" : "s2e1" });
      const prepare = await host.waitFor(targetMark, (m) => m.type === "syncprepare"
        && m.url === target.url, "Staffel-/Rueckwaerts-Wechsel");
      const lateMark = guest.mark();
      host.send({ type: "progress", key: KEY, progress: { url: URL3, season: 1, episode: 3,
        position: 99, duration: 100, progress: 99 } });
      await wait(80);
      assert.equal(guest.messages.slice(lateMark).some((m) => m.type === "progress"), false,
        "keine alte Folge waehrend Staffel- oder Rueckwaerts-Wechsel");
      host.send({ type: "syncready", key: KEY, syncId: prepare.syncId });
      const targetStart = await host.waitFor(targetMark, (m) => m.type === "syncstart"
        && m.syncId === prepare.syncId, "Start der ausgewaehlten Folge");
      assert.equal(targetStart.url, target.url);
      assert.equal(targetStart.episodeId, `s${target.season}e${target.episode}`);
      // Absichtlich noch kein here: ein bereits bereiter Player darf sofort
      // erneut wechseln, auch rueckwaerts, bevor der naechste Status-Takt kommt.
      const lateAfterStart = guest.mark();
      host.send({ type: "progress", key: KEY, progress: { url: URL3, season: 1, episode: 3,
        position: 99, duration: 100, progress: 99 } });
      await wait(80);
      assert.equal(guest.messages.slice(lateAfterStart).some((m) => m.type === "progress"), false,
        "auch nach Rueckwaerts-Start bleibt der hoehere alte Stand wirkungslos");
      const acceptedMark = guest.mark();
      host.send({ type: "progress", key: KEY, progress: { ...target, position: 12, duration: 100, progress: 12 } });
      await guest.waitFor(acceptedMark, (m) => m.type === "progress" && m.progress?.url === target.url,
        "regulaerer Fortschritt der bewusst gewaehlten Folge");
    }
    const returnMark = host.mark();
    host.send({ type: "control", key: KEY, action: "navigate", position: 0, url: URL3,
      fromEpisodeId: "s1e1" });
    const returnPrepare = await host.waitFor(returnMark, (m) => m.type === "syncprepare"
      && m.url === URL3, "fruehere Folge bewusst erneut waehlen");
    host.send({ type: "syncready", key: KEY, syncId: returnPrepare.syncId });
    await host.waitFor(returnMark, (m) => m.type === "syncstart" && m.syncId === returnPrepare.syncId,
      "erneuter Start einer zuvor verlassenen Folge");
    const returnProgressMark = guest.mark();
    host.send({ type: "progress", key: KEY, progress: { url: URL3, season: 1, episode: 3,
      position: 12, duration: 100, progress: 12 } });
    await guest.waitFor(returnProgressMark, (m) => m.type === "progress" && m.progress?.episode === 3,
      "erneut gewaehlte Folge darf wieder Fortschritt buchen");
    console.log("OK bereits bekannte Ziel-Folge holt den zurueckliegenden Ausloeser nach");
  } finally {
    host.close();
    guest.close();
  }
}

run().catch((error) => { console.error("FAIL", error.message); process.exitCode = 1; });
