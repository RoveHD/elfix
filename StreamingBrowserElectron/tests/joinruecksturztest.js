"use strict";
// Ein Beitretender wirft die Runde nicht zurueck.
//
// Der gemeldete Fehler: waehrend eine Runde lief, trat ein Handy bei - und die
// anderen sprangen auf 0:00. Dazu die Fortschrittsleiste, die zwischen der
// richtigen Stelle und 0 hin- und hersprang.
//
// Beides hat dieselbe Wurzel, und sie liegt nicht beim Spulen (das ist seit
// dem Host-Umbau abgedichtet, siehe hostautoritaettest). Sie liegt darin, dass
// ein frisch startender Player position=0/duration=0 meldet und das Relay
// diese Null wie einen Stand behandelte:
//
//   - `eintrag.progress` ist *ein* Slot und wurde von jedem Mitglied
//     beschrieben. Er ist nicht nur Anzeige: Mitschauen.rundenStelle() liest
//     ihn als Startstelle. Ein Handy in der Player-Initialisierung zog damit
//     die Runde auf null - und weil sein Stand an alle weiterging, sprang bei
//     den anderen der Balken.
//   - Ein "navigate" auf die *laufende* Folge galt als Wechsel, sobald die
//     Adresse anders geschrieben war (http://186.2.175.5/... gegen
//     https://s.to/...). Dann fiel eintrag.live auf 0 und alle Leisten mit.
//   - Eine Pause eines Nicht-Hosts ohne bekannten Hoststand schrieb seine
//     eigene Stelle als Stand der Runde.
//
// Die Regel, die hier geprueft wird: der Host bestimmt den Stand der Runde.
// Ein anderes Geraet darf ihn nur nach *vorn* bewegen (neue Folge), niemals
// zurueck - und niemals allein dadurch, dass sein Player noch laedt.

const WS = require("../../sync-server/node_modules/ws");
const { watchpartyStandUebernehmen } = require("../src/fortschritt");

const PORT = Number(process.env.TESTPORT) || 8799;
const RAUM = "ruecksturzraum";
const KEY = "serie:ruecksturz";
const URL1 = "https://aniworld.to/anime/stream/ruecksturz/staffel-1/episode-1";
const URL2 = "https://aniworld.to/anime/stream/ruecksturz/staffel-1/episode-2";
// Dieselbe Folge, andere Schreibung - so meldet sie ein anderer Anbieter.
const URL1_ANDERS = "http://186.2.175.5/serie/ruecksturz/staffel-1/episode-1";

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(Boolean(b)); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name, id) {
  let socket; const eingang = []; const warten = [];
  const api = {
    name, deviceId: id, stelle: 0, pausiert: false, folge: 1, url: URL1,
    verbinde: () => new Promise((f) => {
      socket = new WS(`ws://127.0.0.1:${PORT}`);
      socket.on("message", (roh) => {
        const m = JSON.parse(String(roh));
        eingang.push(m);
        for (let i = warten.length - 1; i >= 0; i -= 1) {
          if (warten[i].passt(m)) { warten[i].resolve(m); warten.splice(i, 1); }
        }
      });
      socket.on("open", f);
    }),
    send: (m) => socket.send(JSON.stringify(m)),
    zu: () => { try { socket.close(); } catch { /* schon zu */ } },
    leeren: () => { eingang.length = 0; },
    alle: (passt) => eingang.filter(passt),
    erwarte: (passt, ms = 1500) => new Promise((resolve) => {
      const t = eingang.find(passt);
      if (t) return resolve(t);
      const e = { passt, resolve }; warten.push(e);
      setTimeout(() => { const i = warten.indexOf(e); if (i >= 0) { warten.splice(i, 1); resolve(null); } }, ms);
    })
  };
  return api;
}

const pulse = [];
function puls(c) {
  c.zuletzt = Date.now();
  const schlag = () => {
    const jetzt = Date.now();
    if (!c.pausiert) c.stelle += (jetzt - c.zuletzt) / 1000;
    c.zuletzt = jetzt;
    c.send({
      type: "here", key: KEY, position: c.stelle, paused: c.pausiert,
      season: 1, episode: c.folge, url: c.url, playerSessionId: `${c.deviceId}-e${c.folge}`
    });
  };
  schlag();
  const t = setInterval(schlag, 600); t.unref?.(); pulse.push(t);
  return () => { const i = pulse.indexOf(t); if (i >= 0) pulse.splice(i, 1); clearInterval(t); };
}

async function beitreten(c, teilen) {
  await c.verbinde();
  c.send({ type: "join", room: RAUM, name: c.name, deviceId: c.deviceId });
  await c.erwarte((m) => m.type === "state");
  if (teilen) {
    c.send({ type: "share", item: { key: KEY, url: URL1, title: "Ruecksturz", type: "serie", season: 1, episode: 1 } });
  } else {
    c.send({ type: "enter", key: KEY });
  }
  await c.erwarte((m) => m.type === "state" && m.shared?.some((x) => x.memberIds?.includes(c.deviceId)));
}

/** Ein Befehl, der jemanden an den Anfang zieht. Genau der darf nicht kommen. */
const zieahtAufNull = (m) => m.type === "control"
  && ["seek", "pause", "play", "navigate"].includes(m.action)
  && Number(m.position) < 60;

/** Der Stand, den ein Fortschritt in der Runde hinterlassen hat. */
function rundenstand(c) {
  const letzte = c.alle((m) => m.type === "progress");
  return letzte.length ? letzte[letzte.length - 1].progress : null;
}

(async () => {
  // A teilt zuerst und ist damit Host. B ist Zuschauer. C ist das Handy.
  const A = client("Host", "geraet-a");
  const B = client("Zuschauer", "geraet-b");
  const C = client("Handy", "geraet-c");
  await beitreten(A, true);
  await beitreten(B, false);

  A.stelle = 600; puls(A);
  await schlaf(150);
  B.stelle = 600; puls(B);
  await schlaf(700);

  // --- 1. Ein Beitretender mit 0/0 bewegt niemanden -------------------------
  {
    A.leeren(); B.leeren();
    const hostVorher = A.stelle;
    const bVorher = B.stelle;

    await beitreten(C, false);
    // So meldet sich ein Android-Player, dessen Quelle noch laedt.
    C.stelle = 0; C.pausiert = true;
    C.send({ type: "here", key: KEY, position: 0, paused: true, season: 1, episode: 1, url: URL1, playerSessionId: "c-e1" });
    C.send({
      type: "progress", key: KEY,
      progress: { url: URL1, season: 1, episode: 1, position: 0, duration: 0, progress: 0, updatedAt: new Date().toISOString(), from: "Handy" }
    });
    await schlaf(900);

    const anA = A.alle(zieahtAufNull);
    const anB = B.alle(zieahtAufNull);
    pruefe("1. Der Host bekommt keinen Befehl an den Anfang",
      anA.length === 0, anA.length ? `${anA[0].action} auf ${anA[0].position}` : "nichts");
    pruefe("1b. Der Zuschauer ebenso wenig",
      anB.length === 0, anB.length ? `${anB[0].action} auf ${anB[0].position}` : "nichts");
    pruefe("1c. Der Host laeuft unbeirrt weiter",
      A.stelle >= hostVorher, `${hostVorher.toFixed(0)} -> ${A.stelle.toFixed(0)}`);
    pruefe("1d. Und der Zuschauer auch",
      B.stelle >= bVorher, `${bVorher.toFixed(0)} -> ${B.stelle.toFixed(0)}`);

    // Und der Stand der Runde selbst steht weiter beim Host.
    const standBeiB = rundenstand(B);
    pruefe("1e. Der Stand der Runde bleibt beim Host",
      !standBeiB || Number(standBeiB.position) > 300,
      standBeiB ? `Runde bei ${Math.round(standBeiB.position)}s` : "kein fremder Stand weitergereicht");

    // C selbst wird dagegen sehr wohl auf den Host gezogen.
    C.leeren();
    C.send({ type: "resync", key: KEY });
    const anC = await C.erwarte((m) => m.type === "control" && m.resync, 1800);
    pruefe("1f. Nur das Handy wird auf den Host synchronisiert",
      anC && Number(anC.position) > 300, anC ? `auf ${Math.round(anC.position)}s` : "keine Antwort");
  }

  // --- 2. Mehrfach 0 waehrend der Initialisierung ---------------------------
  {
    A.leeren(); B.leeren();
    for (let i = 0; i < 3; i += 1) {
      C.send({ type: "here", key: KEY, position: 0, paused: true, season: 1, episode: 1, url: URL1, playerSessionId: "c-e1" });
      C.send({
        type: "progress", key: KEY,
        progress: { url: URL1, season: 1, episode: 1, position: 0, duration: 0, progress: 0, updatedAt: new Date().toISOString(), from: "Handy" }
      });
      await schlaf(200);
    }
    // Und danach der echte Stand.
    C.stelle = 600; C.pausiert = false;
    C.send({ type: "here", key: KEY, position: 600, paused: false, season: 1, episode: 1, url: URL1, playerSessionId: "c-e1" });
    await schlaf(700);

    pruefe("2. Auch dreimal 0 bewegt keinen anderen Teilnehmer",
      A.alle(zieahtAufNull).length === 0 && B.alle(zieahtAufNull).length === 0,
      `Host ${A.alle(zieahtAufNull).length}, Zuschauer ${B.alle(zieahtAufNull).length} Befehle an den Anfang`);
  }

  // --- 3. Der Host laeuft waehrend des Beitritts weiter ---------------------
  {
    await schlaf(1200);
    const hostJetzt = A.stelle;
    C.leeren();
    C.send({ type: "resync", key: KEY });
    const antwort = await C.erwarte((m) => m.type === "control" && m.resync, 1800);
    pruefe("3. Der Beitretende bekommt die hochgerechnete Hoststelle",
      antwort && Math.abs(Number(antwort.position) - hostJetzt) < 4,
      antwort ? `Host ${hostJetzt.toFixed(0)}s, Antwort ${Number(antwort.position).toFixed(0)}s` : "keine Antwort");
    pruefe("3b. Und sie ist kein veralteter Schnappschuss",
      antwort && Number(antwort.position) > 600,
      antwort ? `${Number(antwort.position).toFixed(0)}s` : "-");
  }

  // --- 4. Der Host ist pausiert ---------------------------------------------
  {
    A.pausiert = true;
    A.send({ type: "control", key: KEY, action: "pause", position: A.stelle, url: URL1 });
    await schlaf(700);
    const standBeimHalt = A.stelle;

    B.leeren();
    const D = client("Spaet", "geraet-d");
    await beitreten(D, false);
    D.send({ type: "here", key: KEY, position: 0, paused: true, season: 1, episode: 1, url: URL1, playerSessionId: "d-e1" });
    await schlaf(300);
    D.leeren();
    D.send({ type: "resync", key: KEY });
    const anD = await D.erwarte((m) => m.type === "control" && m.resync, 1800);

    pruefe("4. Beim pausierten Host landet der Neue an dessen Stelle",
      anD && Math.abs(Number(anD.position) - standBeimHalt) < 4,
      anD ? `Host ${standBeimHalt.toFixed(0)}s, Neuer ${Number(anD.position).toFixed(0)}s` : "keine Antwort");
    pruefe("4b. Und er bekommt Pause, nicht Play",
      anD && anD.action === "pause" && anD.playing === false,
      anD ? `action=${anD.action} playing=${anD.playing}` : "-");
    pruefe("4c. Die bestehenden Teilnehmer bekommen dabei nichts",
      B.alle(zieahtAufNull).length === 0,
      `${B.alle(zieahtAufNull).length} Befehle an den Anfang`);
    D.zu();
    A.pausiert = false;
    A.send({ type: "control", key: KEY, action: "play", position: A.stelle, url: URL1 });
    await schlaf(400);
  }

  // --- 5. Unfertige Werte duerfen eine gueltige Anzeige nicht loeschen ------
  //     Reine Rechnung, ohne Relay: die Regel im Client.
  {
    const lokal = { url: URL1, season: 1, episode: 1, position: 742, duration: 1440 };
    const jetzt = new Date().toISOString();

    const nullStand = watchpartyStandUebernehmen(lokal,
      { url: URL1, season: 1, episode: 1, position: 0, duration: 0, updatedAt: jetzt });
    pruefe("5. position=0/duration=0 loescht eine gueltige Stelle nicht",
      nullStand.art === "nichts", nullStand.art);

    const ohneLaufzeit = watchpartyStandUebernehmen(lokal,
      { url: URL1, season: 1, episode: 1, position: 0, duration: Number.NaN, updatedAt: jetzt });
    pruefe("5b. Und eine NaN-Laufzeit ebenso wenig",
      ohneLaufzeit.art === "nichts", ohneLaufzeit.art);

    // Eine echte Null *mit* Laufzeit ist dagegen eine Auskunft: die Folge
    // faengt an. Sie muss durchkommen.
    const echterAnfang = watchpartyStandUebernehmen(lokal,
      { url: URL1, season: 1, episode: 1, position: 0, duration: 1440, updatedAt: jetzt });
    pruefe("5c. Ein echter Anfang mit Laufzeit kommt durch",
      echterAnfang.art === "aendern" && echterAnfang.aenderung.position === 0,
      echterAnfang.art);

    // Und eine neue Folge faengt selbstverstaendlich bei 0 an.
    const neueFolge = watchpartyStandUebernehmen(lokal,
      { url: URL2, season: 1, episode: 2, position: 0, duration: 0, updatedAt: jetzt });
    pruefe("5d. Eine neue Folge darf bei 0 anfangen",
      neueFolge.art === "aendern", neueFolge.art);

    // Der gewoehnliche Fall bleibt unberuehrt.
    const normal = watchpartyStandUebernehmen(lokal,
      { url: URL1, season: 1, episode: 1, position: 900, duration: 1440, updatedAt: jetzt });
    pruefe("5e. Ein gewoehnlicher Stand wird weiterhin uebernommen",
      normal.art === "aendern" && normal.aenderung.position === 900, normal.art);
  }

  // --- 6. Nach dem Beitritt gelten die gewoehnlichen Regeln wieder ----------
  {
    B.leeren(); C.leeren();
    const ziel = A.stelle + 300;
    A.stelle = ziel;
    A.send({ type: "control", key: KEY, action: "seek", position: ziel, url: URL1 });
    const bSeek = await B.erwarte((m) => m.type === "control" && m.action === "seek", 1800);
    pruefe("6. Der Sprung des Hosts erreicht die anderen weiterhin",
      bSeek && Math.abs(Number(bSeek.position) - ziel) < 4,
      bSeek ? `auf ${Number(bSeek.position).toFixed(0)}s` : "kein Sprung angekommen");

    // Und der Sprung eines Nicht-Hosts weiterhin nicht.
    B.leeren(); A.leeren();
    C.send({ type: "control", key: KEY, action: "seek", position: 5, url: URL1 });
    await schlaf(700);
    pruefe("6b. Der Sprung eines Nicht-Hosts weiterhin nicht",
      A.alle(zieahtAufNull).length === 0 && B.alle(zieahtAufNull).length === 0,
      `${A.alle(zieahtAufNull).length + B.alle(zieahtAufNull).length} Befehle`);

    // Play und Pause des Hosts kommen an.
    B.leeren();
    A.pausiert = true;
    A.send({ type: "control", key: KEY, action: "pause", position: A.stelle, url: URL1 });
    const bPause = await B.erwarte((m) => m.type === "control" && m.action === "pause", 1800);
    pruefe("6c. Pause des Hosts kommt an", Boolean(bPause), bPause ? "ja" : "nein");
    A.pausiert = false;
    B.leeren();
    A.send({ type: "control", key: KEY, action: "play", position: A.stelle, url: URL1 });
    const bPlay = await B.erwarte((m) => m.type === "control" && m.action === "play", 1800);
    pruefe("6d. Und Play ebenso", Boolean(bPlay), bPlay ? "ja" : "nein");
    await schlaf(300);
  }

  // --- 7. Folgenwechsel rund um den Beitritt --------------------------------
  {
    // Erst der Fall, der den Rueckwurf ausloeste: ein Geraet meldet einen
    // "Wechsel" auf die Folge, bei der die Runde laengst steht - nur unter
    // der Adresse eines anderen Anbieters.
    A.leeren(); B.leeren();
    const hostVorher = A.stelle;
    C.send({ type: "control", key: KEY, action: "navigate", position: 0, url: URL1_ANDERS });
    await schlaf(800);

    pruefe("7. Ein Nachziehen auf die laufende Folge wirft die Runde nicht zurueck",
      A.alle(zieahtAufNull).length === 0 && B.alle(zieahtAufNull).length === 0,
      `${A.alle(zieahtAufNull).length + B.alle(zieahtAufNull).length} Befehle an den Anfang`);
    pruefe("7b. Der Host laeuft weiter",
      A.stelle >= hostVorher, `${hostVorher.toFixed(0)} -> ${A.stelle.toFixed(0)}`);

    B.leeren();
    B.send({ type: "resync", key: KEY });
    const standNachher = await B.erwarte((m) => m.type === "control" && m.resync, 1800);
    pruefe("7c. Und der Stand der Runde steht weiterhin beim Host",
      standNachher && Number(standNachher.position) > 300,
      standNachher ? `${Number(standNachher.position).toFixed(0)}s` : "keine Antwort");

    // Ein *echter* Folgenwechsel muss dagegen weiterhin durchkommen - auch von
    // einem Nicht-Host.
    B.leeren();
    C.send({ type: "control", key: KEY, action: "navigate", position: 0, url: URL2 });
    const wechsel = await B.erwarte((m) => m.type === "control" && m.action === "navigate", 1800);
    pruefe("7d. Ein echter Folgenwechsel kommt weiterhin an - auch vom Nicht-Host",
      wechsel && String(wechsel.url).includes("episode-2"),
      wechsel ? String(wechsel.url).slice(-12) : "kein Wechsel");
  }

  const fehler = pruefungen.filter((ok) => !ok).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  for (const t of pulse) clearInterval(t);
  for (const c of [A, B, C]) c.zu();
  process.exit(fehler ? 1 : 0);
})();
