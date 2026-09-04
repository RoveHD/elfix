"use strict";
// Die Stelle eines Nicht-Hosts bewegt niemanden.
//
// Der gemeldete Fehler, am 3.9.2026 gegen das echte Relay mitgeschnitten: ein
// Zuschauer spulte von Hand auf 0, sein Player meldete daraufhin "play bei 0",
// und das Relay schickte
//
//   control action=play position=0 playing=true from=ViewerA
//
// an den Host *und* an den zweiten Zuschauer. Beide sprangen auf 0 und wurden
// vom naechsten Ausgleich zum Host zurueckgezogen. Dieselbe Zeile schrieb
// ueber `standFuerAlle` die 0 in den Anzeigeeintrag *aller* Mitglieder - das
// war das periodische Springen der Teilnehmerleiste zwischen richtiger Zeit
// und 0:00.
//
// Nur `seek` war host-gebunden; `play` und `pause` trugen die Stelle des
// Absenders. Die Regel jetzt: den *Zustand* (laeuft, haelt an) darf jeder
// aendern, die *Stelle* kommt immer vom Host.

const WS = require("../../sync-server/node_modules/ws");

const PORT = Number(process.env.TESTPORT) || 8799;
const RAUM = "stellenraum";
const KEY = "serie:stelle";
const URL1 = "https://aniworld.to/anime/stream/stelle/staffel-1/episode-1";

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(Boolean(b)); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name, id) {
  let socket; const eingang = []; const warten = [];
  const api = {
    name, deviceId: id, stelle: 0, pausiert: false, dauer: 1400,
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
    zu: () => { try { socket.close(); } catch { /* zu */ } },
    leeren: () => { eingang.length = 0; },
    alle: (passt) => eingang.filter(passt),
    // Der zuletzt gesehene Stand eines Teilnehmers in der Leiste.
    standVon: (wessen) => {
      const letzte = eingang.filter((m) => m.type === "watchstate");
      for (let i = letzte.length - 1; i >= 0; i -= 1) {
        const treffer = (letzte[i].members || []).find((x) => x.name === wessen);
        if (treffer) return treffer;
      }
      return null;
    },
    // Jeder je gesehene Stand eines Teilnehmers - fuer "war er je bei 0?".
    alleStaendeVon: (wessen) => eingang
      .filter((m) => m.type === "watchstate")
      .flatMap((m) => (m.members || []).filter((x) => x.name === wessen)),
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
      type: "here", key: KEY, position: c.stelle, paused: c.pausiert, duration: c.dauer,
      season: 1, episode: 1, url: URL1, playerSessionId: `${c.deviceId}-e1`
    });
  };
  schlag();
  const t = setInterval(schlag, 500); t.unref?.(); pulse.push(t);
}

async function beitreten(c, teilen) {
  await c.verbinde();
  c.send({ type: "join", room: RAUM, name: c.name, deviceId: c.deviceId });
  await c.erwarte((m) => m.type === "state");
  if (teilen) c.send({ type: "share", item: { key: KEY, url: URL1, title: "Stelle", type: "serie", season: 1, episode: 1 } });
  else c.send({ type: "enter", key: KEY });
  await c.erwarte((m) => m.type === "state" && m.shared?.some((x) => x.memberIds?.includes(c.deviceId)));
}

/** Ein Befehl, der den Empfaenger an den Anfang zieht. */
const anDenAnfang = (m) => m.type === "control"
  && ["seek", "play", "pause", "navigate", "hostzeit"].includes(m.action)
  && Number(m.position) < 300;

(async () => {
  const H = client("Host", "stelle-host");
  const A = client("ViewerA", "stelle-a");
  const B = client("ViewerB", "stelle-b");
  await beitreten(H, true);
  await beitreten(A, false);
  await beitreten(B, false);

  H.stelle = 600; puls(H);
  await schlaf(120);
  A.stelle = 600; puls(A);
  B.stelle = 600; puls(B);
  await schlaf(1200);

  // --- TEST A: Nicht-Host spult von Hand auf 0 ------------------------------
  {
    H.leeren(); B.leeren();
    const hostVorher = H.stelle;
    const bVorher = B.stelle;

    // So meldet es ein echter Player: anhalten, springen, weiterlaufen.
    A.pausiert = true;
    A.send({ type: "control", key: KEY, action: "pause", position: A.stelle, url: URL1 });
    await schlaf(300);
    A.stelle = 0;
    A.send({ type: "control", key: KEY, action: "seek", position: 0, url: URL1 });
    await schlaf(300);
    A.pausiert = false;
    A.send({ type: "control", key: KEY, action: "play", position: 0, url: URL1 });
    await schlaf(1200);

    pruefe("A. Der Host bekommt keinen Befehl an den Anfang",
      H.alle(anDenAnfang).length === 0,
      H.alle(anDenAnfang).map((m) => `${m.action}@${Math.round(m.position)}`).join(",") || "nichts");
    pruefe("A2. Der zweite Zuschauer ebenso wenig",
      B.alle(anDenAnfang).length === 0,
      B.alle(anDenAnfang).map((m) => `${m.action}@${Math.round(m.position)}`).join(",") || "nichts");
    pruefe("A3. Der Host laeuft unbeirrt weiter",
      H.stelle >= hostVorher, `${hostVorher.toFixed(0)} -> ${H.stelle.toFixed(0)}`);
    pruefe("A4. Und der zweite Zuschauer auch",
      B.stelle >= bVorher, `${bVorher.toFixed(0)} -> ${B.stelle.toFixed(0)}`);

    // Und die Leiste: ViewerB darf nie auf 0 gestanden haben, auch nicht fuer
    // einen einzigen Takt.
    const bJe = B.alleStaendeVon("ViewerB").filter((x) => Number(x.position) < 300);
    pruefe("A5. ViewerB stand in der Leiste nie bei 0 - keinen Takt lang",
      bJe.length === 0, bJe.length ? `${bJe.length} Meldungen unter 300s` : "nie");
    const hJe = B.alleStaendeVon("Host").filter((x) => Number(x.position) < 300);
    pruefe("A6. Und der Host ebenso wenig",
      hJe.length === 0, hJe.length ? `${hJe.length} Meldungen unter 300s` : "nie");

    // ViewerA selbst darf und soll bei 0 stehen - das ist sein Ist-Stand.
    const aStand = B.standVon("ViewerA");
    pruefe("A7. ViewerA steht in der Leiste bei seiner echten Stelle",
      aStand && Number(aStand.position) < 60,
      aStand ? `${Math.round(aStand.position)}s` : "kein Stand");
  }

  // --- TEST B: zwei Nicht-Hosts beeinflussen einander nicht -----------------
  {
    A.stelle = 100; B.stelle = 500;
    A.send({ type: "control", key: KEY, action: "play", position: 100, url: URL1 });
    await schlaf(300);
    B.leeren(); A.leeren();
    B.send({ type: "control", key: KEY, action: "play", position: 500, url: URL1 });
    await schlaf(900);

    const anA = A.alle((m) => m.type === "control" && Math.abs(Number(m.position) - 500) < 5);
    const anB = B.alle((m) => m.type === "control" && Math.abs(Number(m.position) - 100) < 5);
    pruefe("B. Die Stelle des einen Zuschauers erreicht den anderen nicht",
      anA.length === 0 && anB.length === 0,
      `${anA.length} an A, ${anB.length} an B`);
  }

  // --- TEST C: ein unfertiges Sample loescht keinen gueltigen Stand ---------
  {
    A.stelle = 500; A.dauer = 1400; A.pausiert = false;
    A.send({ type: "here", key: KEY, position: 500, paused: false, duration: 1400,
      season: 1, episode: 1, url: URL1, playerSessionId: "stelle-a-e1" });
    await schlaf(400);
    B.leeren();
    // Der Player laedt neu: weder Stelle noch Laufzeit.
    A.send({ type: "here", key: KEY, position: 0, paused: true, duration: 0,
      season: 1, episode: 1, url: URL1, playerSessionId: "stelle-a-e1" });
    await schlaf(600);
    const nachUnfertig = B.standVon("ViewerA");
    pruefe("C. Ein Sample ohne Stelle und ohne Laufzeit setzt nicht auf 0",
      nachUnfertig && Number(nachUnfertig.position) > 400,
      nachUnfertig ? `${Math.round(nachUnfertig.position)}s` : "kein Stand");

    A.stelle = 501;
    A.send({ type: "here", key: KEY, position: 501, paused: false, duration: 1400,
      season: 1, episode: 1, url: URL1, playerSessionId: "stelle-a-e1" });
    await schlaf(600);
    const danach = B.standVon("ViewerA");
    pruefe("C2. Und der naechste gueltige Wert kommt normal an",
      danach && Math.abs(Number(danach.position) - 501) < 5,
      danach ? `${Math.round(danach.position)}s` : "kein Stand");
  }

  // --- TEST D: ein echtes 0:00 bleibt ein echtes 0:00 ----------------------
  {
    B.leeren();
    // Zuerst der Herzschlag, dann die Meldung.
    //
    // `puls(A)` schickt weiter alle 500 ms A's eigene Stelle. Wer nur die
    // einzelne Meldung hier absetzt, prueft anschliessend gegen ein Rennen:
    // liegt der naechste Herzschlag dazwischen, steht dort wieder 502s. Genau
    // daran ist diese Pruefung in der Werkbank gescheitert, waehrend sie hier
    // durchging - dieselbe Reihenfolge, andere Maschine.
    //
    // Ein Player, der wirklich an den Anfang gespult hat, meldet die Null auch
    // im Herzschlag. Also wird sie hier auch dort gesetzt.
    A.stelle = 0;
    A.pausiert = false;
    // Gueltiger Player, bewusst an den Anfang gespult: Laufzeit steht.
    A.send({ type: "here", key: KEY, position: 0, paused: false, duration: 1400,
      season: 1, episode: 1, url: URL1, playerSessionId: "stelle-a-e1" });
    await schlaf(600);
    const echt = B.standVon("ViewerA");
    pruefe("D. Ein echtes 0:00 mit gueltiger Laufzeit wird angezeigt",
      echt && Number(echt.position) < 60,
      echt ? `${Math.round(echt.position)}s` : "kein Stand");
  }

  // --- TEST F: ein neuer Zuschauer zieht niemanden mit ----------------------
  {
    H.stelle = 800;
    H.send({ type: "control", key: KEY, action: "seek", position: 800, url: URL1 });
    await schlaf(500);
    B.stelle = 800;
    await schlaf(600);

    H.leeren(); B.leeren();
    const C = client("Neu", "stelle-c");
    await beitreten(C, false);
    C.send({ type: "here", key: KEY, position: 0, paused: true, duration: 0,
      season: 1, episode: 1, url: URL1, playerSessionId: "stelle-c-e1" });
    await schlaf(900);

    pruefe("F. Der Beitretende bewegt den Host nicht",
      H.alle(anDenAnfang).length === 0,
      H.alle(anDenAnfang).map((m) => m.action).join(",") || "nichts");
    pruefe("F2. Und den bestehenden Zuschauer nicht",
      B.alle(anDenAnfang).length === 0,
      B.alle(anDenAnfang).map((m) => m.action).join(",") || "nichts");

    C.leeren();
    C.send({ type: "resync", key: KEY });
    const anC = await C.erwarte((m) => m.type === "control" && m.resync, 1800);
    pruefe("F3. Nur er selbst wird auf den Host gezogen",
      anC && Number(anC.position) > 700,
      anC ? `auf ${Math.round(anC.position)}s` : "keine Antwort");
    C.zu();
  }

  // --- Und die gewoehnlichen Regeln gelten weiter ---------------------------
  {
    B.leeren();
    H.stelle = 900;
    H.send({ type: "control", key: KEY, action: "seek", position: 900, url: URL1 });
    const bSeek = await B.erwarte((m) => m.type === "control" && m.action === "seek", 1800);
    pruefe("G. Der Sprung des Hosts erreicht die Zuschauer weiterhin",
      bSeek && Math.abs(Number(bSeek.position) - 900) < 5,
      bSeek ? `auf ${Math.round(bSeek.position)}s` : "kein Sprung");

    // Und eine Pause eines Zuschauers haelt die Runde weiterhin an - das ist
    // eine Zustandsaenderung und keine Stelle.
    B.leeren();
    A.send({ type: "control", key: KEY, action: "pause", position: 5, url: URL1 });
    const bPause = await B.erwarte((m) => m.type === "control" && m.action === "pause", 1800);
    pruefe("G2. Die Pause eines Zuschauers haelt die Runde weiterhin an",
      Boolean(bPause), bPause ? "ja" : "nein");
    pruefe("G3. Aber mit der Stelle des Hosts, nicht seiner eigenen",
      bPause && Number(bPause.position) > 700,
      bPause ? `${Math.round(bPause.position)}s` : "-");
  }

  // --- Die Anwesenheitsmeldung traegt keine Stelle ------------------------
  //
   // Der zweite gemeldete Fall: "alle paar Sekunden steht bei irgendwem 0:00".
  // Die Anwesenheitsmeldung ("ich bin hier") trug bis hierher die Stelle der
  // Runde - bei einem Geraet, das nicht fuehrt, ist die oft gar nicht bekannt,
  // und dann stand da eine 0. Ohne Laufzeit ging sie als echter Stand durch.
  {
    B.leeren();
    A.stelle = 640;
    A.send({ type: "here", key: KEY, position: 640, paused: false, duration: 1400,
      season: 1, episode: 1, url: URL1, playerSessionId: "stelle-a-e1" });
    await schlaf(400);

    // Genau so meldet sich ein Geraet an: ohne Stelle, angehalten.
    A.send({ type: "here", key: KEY, paused: true,
      season: 1, episode: 1, url: URL1, playerSessionId: "stelle-a-e1" });
    await schlaf(600);

    const nachAnwesend = B.standVon("ViewerA");
    pruefe("H. Eine Anwesenheitsmeldung ohne Stelle setzt nicht auf 0",
      nachAnwesend && Number(nachAnwesend.position) > 600,
      nachAnwesend ? `${Math.round(nachAnwesend.position)}s` : "kein Stand");
  }

  // --- Der Knopf haelt alle an - und startet sie nicht wieder -------------
  {
    // Erst laeuft wieder alles.
    H.pausiert = false;
    H.stelle = 1000;
    H.send({ type: "control", key: KEY, action: "play", position: 1000, url: URL1 });
    await schlaf(600);

    B.leeren(); H.leeren();
    B.send({ type: "syncall", key: KEY, position: B.stelle });

    const halt = await B.erwarte((m) => m.type === "syncprepare", 1800);
    pruefe("I. Der Knopf haelt alle an",
      halt && halt.playing === false,
      halt ? `playing=${halt.playing} bei ${Math.round(halt.position)}s` : "kein syncprepare");
    pruefe("I2. Auf der Stelle des Hosts",
      halt && Number(halt.position) > 900,
      halt ? `${Math.round(halt.position)}s` : "-");
    pruefe("I3. Und der Host bekommt es auch",
      H.alle((m) => m.type === "syncprepare").length > 0,
      `${H.alle((m) => m.type === "syncprepare").length} Meldungen`);

    // Und es bleibt dabei: kein Start hinterher.
    B.leeren(); H.leeren();
    await schlaf(5000);
    const start = B.alle((m) => m.type === "syncstart"
      || (m.type === "control" && m.action === "play"));
    pruefe("I4. Danach wird nichts wieder gestartet",
      start.length === 0,
      start.length ? start.map((m) => m.type + "/" + m.action).join(",") : "nichts");
  }
  const fehler = pruefungen.filter((ok) => !ok).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  for (const t of pulse) clearInterval(t);
  for (const c of [H, A, B]) c.zu();
  process.exit(fehler ? 1 : 0);
})();
