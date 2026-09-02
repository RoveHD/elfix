"use strict";
// Wer bewegt die Runde - und was ist die Wahrheit ueber "laeuft gerade"?
//
// Zwei Fehler, die dieselbe Wurzel haben: das Relay hat an zwei Stellen etwas
// anderes geglaubt als den Host.
//
// Erstens der Sprung. Ein "seek" wurde an alle weitergereicht, egal von wem es
// kam. Der Stand der Runde (eintrag.live) aenderte sich dabei nur beim Host -
// die anderen sprangen also auf die Stelle eines Nicht-Hosts und wurden gleich
// darauf vom Ausgleich wieder zum Host zurueckgezogen. Wer beitrat und dabei
// spulte, riss so die halbe Runde kurz mit sich.
//
// Zweitens der Laufzustand. Ob ein pausiertes Geraet ein Play nachgereicht
// bekommt und was ein Beitretender hoert, entschied "eintrag.live.action" -
// der zuletzt an alle geschickte Befehl. Der veraltet: eine Pause eines
// Nicht-Hosts wird dort vermerkt, sein spaeteres Play aber nicht. Danach stand
// dort "pause", waehrend der Host laengst wieder lief - und ein Fernseher, der
// in dieser Lage beitrat oder stand, blieb stehen.
//
// Die Regel, die hier geprueft wird: der aktive Host ist die Wahrheit fuer
// Stelle und Laufzustand. Nur er bewegt die Runde durch Spulen, und nur sein
// wirklicher Zustand entscheidet ueber play/pause - nicht ein alter Befehl.

const WS = require("../../sync-server/node_modules/ws");
const PORT = Number(process.env.TESTPORT) || 8799;
const RAUM = "autoritaetsraum";
const KEY = "serie:autoritaet";
const URL1 = "https://aniworld.to/anime/stream/autoritaet/staffel-1/episode-1";

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(Boolean(b)); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name, id) {
  let socket; const eingang = []; const warten = [];
  const api = { name, deviceId: id, stelle: 0, pausiert: false, folge: 1,
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
    zu: () => socket.close(),
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
    c.send({ type: "here", key: KEY, position: c.stelle, paused: c.pausiert,
      season: 1, episode: c.folge, url: URL1, playerSessionId: `${c.deviceId}-e${c.folge}` });
  };
  schlag();
  const t = setInterval(schlag, 600); t.unref?.(); pulse.push(t);
}

async function beitreten(c, teilen) {
  await c.verbinde();
  c.send({ type: "join", room: RAUM, name: c.name, deviceId: c.deviceId });
  await c.erwarte((m) => m.type === "state");
  if (teilen) c.send({ type: "share", item: { key: KEY, url: URL1, title: "Autoritaet", type: "serie", season: 1, episode: 1 } });
  else c.send({ type: "enter", key: KEY });
  await c.erwarte((m) => m.type === "state" && m.shared?.some((x) => x.memberIds?.includes(c.deviceId)));
}

(async () => {
  // A teilt zuerst und ist damit Host. B und C sind Nicht-Hosts.
  const A = client("A", "geraet-a");
  const B = client("B", "geraet-b");
  const C = client("C", "geraet-c");
  await beitreten(A, true);
  await beitreten(B, false);
  await beitreten(C, false);

  A.stelle = 100; puls(A);
  await schlaf(150);
  B.stelle = 100; puls(B);
  C.stelle = 100; puls(C);
  await schlaf(600);

  // --- 1. Ein Nicht-Host spult - und niemand folgt ---------------------------
  A.leeren(); B.leeren(); C.leeren();
  const hostVorher = A.stelle;
  B.stelle = 20;
  B.send({ type: "control", key: KEY, action: "seek", position: 20, url: URL1 });

  const anC = await C.erwarte((m) => m.type === "control" && m.action === "seek" && m.position < 50, 1800);
  pruefe("1. Der Sprung eines Nicht-Hosts erreicht keinen anderen Nicht-Host",
    !anC, anC ? `C bekam seek auf ${anC.position}` : "C blieb unberuehrt");

  const anA = await A.erwarte((m) => m.type === "control" && m.action === "seek" && m.position < 50, 300);
  pruefe("1b. Und schon gar nicht den Host",
    !anA, anA ? `A bekam seek auf ${anA.position}` : "A blieb stehen");
  pruefe("1c. Der Host laeuft unbeirrt weiter",
    A.stelle >= hostVorher, `${hostVorher.toFixed(1)} -> ${A.stelle.toFixed(1)}`);

  // Und der Stand der Runde darf sich davon nicht verschoben haben: sonst
  // zieht der naechste Abgleich alle auf die Stelle des Nicht-Hosts.
  C.leeren();
  C.send({ type: "resync", key: KEY });
  const nachB = await C.erwarte((m) => m.type === "control" && m.resync, 1800);
  pruefe("1d. Der Rundenstand zeigt weiter auf den Host, nicht auf den Springer",
    nachB && nachB.position > 60,
    nachB ? `resync nannte ${nachB.position.toFixed(1)} (Host ~${A.stelle.toFixed(1)})` : "keine Antwort");

  // B zieht sich selbst wieder auf die Runde - lokal, wie es die App taete.
  B.stelle = A.stelle;
  await schlaf(700);

  // --- 2. Der Host spult - und alle folgen -----------------------------------
  A.leeren(); B.leeren(); C.leeren();
  A.stelle = 200;
  A.send({ type: "control", key: KEY, action: "seek", position: 200, url: URL1 });
  const bSprung = await B.erwarte((m) => m.type === "control" && m.action === "seek", 1800);
  const cSprung = await C.erwarte((m) => m.type === "control" && m.action === "seek", 1800);
  pruefe("2. Der Sprung des Hosts erreicht B",
    bSprung && Math.abs(bSprung.position - 200) < 0.01,
    bSprung ? `auf ${bSprung.position}` : "kam nicht");
  pruefe("2b. Und C",
    cSprung && Math.abs(cSprung.position - 200) < 0.01,
    cSprung ? `auf ${cSprung.position}` : "kam nicht");
  pruefe("2c. Als Host gekennzeichnet",
    bSprung && bSprung.host === true, bSprung ? `host=${bSprung.host}` : "-");
  B.stelle = 200; C.stelle = 200;
  await schlaf(700);

  // --- 3. Ein Nicht-Host tritt an falscher Stelle bei ------------------------
  // Genau der gemeldete Fall: der Beitretende spult beim Einsteigen, und die
  // Runde darf das nicht mitmachen.
  const D = client("D", "geraet-d");
  await beitreten(D, false);
  D.stelle = 5; puls(D);
  await schlaf(300);
  A.leeren(); B.leeren(); C.leeren(); D.leeren();
  D.send({ type: "control", key: KEY, action: "seek", position: 5, url: URL1 });

  const bGezogen = await B.erwarte((m) => m.type === "control" && m.action === "seek" && m.position < 50, 1800);
  const cGezogen = await C.erwarte((m) => m.type === "control" && m.action === "seek" && m.position < 50, 300);
  pruefe("3. Kein bestehender Teilnehmer wird zum Beitretenden gezogen",
    !bGezogen && !cGezogen,
    bGezogen || cGezogen ? "jemand sprang auf die Stelle von D" : "B und C blieben stehen");

  // Umgekehrt: D fragt nach und wird zum Host gezogen.
  D.leeren();
  D.send({ type: "resync", key: KEY });
  const dZiel = await D.erwarte((m) => m.type === "control" && m.resync, 1800);
  pruefe("3b. Der Beitretende wird zum Host gezogen",
    dZiel && Math.abs(dZiel.position - A.stelle) < 5,
    dZiel ? `D auf ${dZiel.position.toFixed(1)}, Host ${A.stelle.toFixed(1)}` : "keine Antwort");

  // --- 4. Ein Nicht-Host pausiert und laeuft wieder --------------------------
  // Danach stand im Rundenstand "pause", waehrend alle liefen. Ein Fernseher,
  // der jetzt beitritt, darf davon nichts abbekommen.
  B.pausiert = true;
  B.send({ type: "control", key: KEY, action: "pause", position: B.stelle, url: URL1 });
  await schlaf(500);
  // Alle ziehen die Pause mit, wie es die App tut.
  A.pausiert = true; C.pausiert = true; D.pausiert = true;
  await schlaf(500);
  B.pausiert = false;
  B.send({ type: "control", key: KEY, action: "play", position: B.stelle, url: URL1 });
  await schlaf(300);
  A.pausiert = false; C.pausiert = false; D.pausiert = false;
  await schlaf(900);

  const TV = client("TV", "geraet-tv");
  await beitreten(TV, false);
  TV.stelle = 0; TV.pausiert = true; puls(TV);
  await schlaf(300);
  TV.leeren();
  TV.send({ type: "resync", key: KEY });
  const tvAntwort = await TV.erwarte((m) => m.type === "control" && m.resync, 1800);
  pruefe("4. Ein spaet beitretender Fernseher bekommt den echten Host-Zustand",
    tvAntwort && tvAntwort.action === "play" && tvAntwort.playing === true,
    tvAntwort ? `action=${tvAntwort.action} playing=${tvAntwort.playing}` : "keine Antwort");
  pruefe("4b. Und nicht einen alten Pausenbefehl",
    tvAntwort && tvAntwort.action !== "pause",
    "ein Nicht-Host-Play wird im Rundenstand nicht vermerkt - der Host zaehlt");

  // --- 5. Der Host laeuft, der Fernseher steht ------------------------------
  TV.leeren();
  TV.pausiert = true;
  const nachgereicht = await TV.erwarte((m) => m.type === "control" && m.action === "play" && m.resync, 4000);
  pruefe("5. Ein pausierter Fernseher wird gezielt wieder gestartet",
    nachgereicht, nachgereicht ? `play auf ${nachgereicht.position.toFixed(1)}` : "kam nicht");
  pruefe("5b. Und zwar auf die Stelle des Hosts",
    nachgereicht && Math.abs(nachgereicht.position - A.stelle) < 6,
    nachgereicht ? `${nachgereicht.position.toFixed(1)} gegen Host ${A.stelle.toFixed(1)}` : "-");

  TV.pausiert = false; TV.stelle = A.stelle;
  await schlaf(600);

  // --- 6. Pausiert der Host, bleibt der Fernseher stehen --------------------
  A.pausiert = true;
  A.send({ type: "control", key: KEY, action: "pause", position: A.stelle, url: URL1 });
  await schlaf(600);
  B.pausiert = true; C.pausiert = true; D.pausiert = true;
  TV.pausiert = true;
  TV.leeren();
  const faelschlich = await TV.erwarte((m) => m.type === "control" && m.action === "play", 4000);
  pruefe("6. Pausiert der Host, wird der Fernseher nicht wieder gestartet",
    !faelschlich, faelschlich ? "er bekam faelschlich play" : "er bleibt stehen");

  // Und die Auskunft an einen Nachfrager lautet jetzt ebenfalls "pause".
  TV.leeren();
  TV.send({ type: "resync", key: KEY });
  const imStand = await TV.erwarte((m) => m.type === "control" && m.resync, 1800);
  pruefe("6b. Auch die Nachfrage sagt jetzt \"pausiert\"",
    imStand && imStand.action === "pause" && imStand.playing === false,
    imStand ? `action=${imStand.action} playing=${imStand.playing}` : "keine Antwort");

  const fehler = pruefungen.filter((ok) => !ok).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  for (const t of pulse) clearInterval(t);
  for (const c of [A, B, C, D, TV]) c.zu();
  process.exit(fehler ? 1 : 0);
})();
