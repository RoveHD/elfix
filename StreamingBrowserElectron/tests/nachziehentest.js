"use strict";
// Niemand bleibt auf einer anderen Folge sitzen.
//
// Gemeldet als "das Mitziehen funktioniert echt schlecht - es soll jeder jeden
// in ne neue Folge mitziehen koennen". Der Befehl allein reichte dafuer nicht:
// `control navigate` geht einmal hinaus, und wer ihn verpasst - weil er gerade
// eine Seite lud, weil er kurz weg war, weil sein Player noch beim Hoster
// haengt -, stand danach allein bei der alten Folge. Es gab nichts, das ihn je
// wieder geholt haette.
//
// Das Relay vergleicht deshalb im Fuenf-Sekunden-Takt, wer wo steht, und
// schickt genau dem ein `navigate`, der woanders ist. Geprueft wird hier
// dreierlei: dass der Nachzuegler geholt wird, dass die anderen davon nichts
// abbekommen, und dass ihn der Takt danach in Ruhe laesst statt ihm im
// Sekundenrhythmus die Seite neu zu laden.
//
// Ausserdem: der Wechsel selbst haengt nicht am Host. Hier zieht ein Zuschauer
// die Runde weiter, und der Host wird mitgezogen.

const WS = require("../../sync-server/node_modules/ws");

const PORT = Number(process.env.TESTPORT) || 8791;
const RAUM = "nachziehraum";
const KEY = "serie:nachzieh";
const BASIS = "https://aniworld.to/anime/stream/nachzieh";
const URL1 = `${BASIS}/staffel-1/episode-1`;
const URL2 = `${BASIS}/staffel-1/episode-2`;

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
    zu: () => { try { socket.close(); } catch { /* zu */ } },
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
      type: "here", key: KEY, position: c.stelle, paused: c.pausiert, duration: 1400,
      season: 1, episode: c.folge, url: c.url, playerSessionId: `${c.deviceId}-e${c.folge}`
    });
  };
  schlag();
  const t = setInterval(schlag, 500); t.unref?.(); pulse.push(t);
}

async function beitreten(c, teilen) {
  await c.verbinde();
  c.send({ type: "join", room: RAUM, name: c.name, deviceId: c.deviceId });
  await c.erwarte((m) => m.type === "state");
  if (teilen) c.send({ type: "share", item: { key: KEY, url: URL1, title: "Nachzieh", type: "serie", season: 1, episode: 1 } });
  else c.send({ type: "enter", key: KEY });
  await c.erwarte((m) => m.type === "state" && m.shared?.some((x) => x.memberIds?.includes(c.deviceId)));
}

/** Ein Befehl, der auf die zweite Folge zieht. */
const aufFolgeZwei = (m) => m.type === "control" && m.action === "navigate"
  && String(m.url || "").includes("episode-2");

(async () => {
  const H = client("Host", "nachzieh-host");
  const A = client("ViewerA", "nachzieh-a");
  const B = client("ViewerB", "nachzieh-b");
  await beitreten(H, true);
  await beitreten(A, false);
  await beitreten(B, false);

  H.stelle = 400; puls(H);
  A.stelle = 400; puls(A);
  B.stelle = 400; puls(B);
  await schlaf(1200);

  // --- TEST A: Ein Zuschauer zieht die Runde weiter -------------------------
  {
    H.leeren(); B.leeren();
    A.send({ type: "control", key: KEY, action: "navigate", position: 0, url: URL2 });
    const beimHost = await H.erwarte(aufFolgeZwei, 1500);
    pruefe("A. Auch ein Zuschauer zieht die Runde auf eine neue Folge",
      Boolean(beimHost), beimHost ? "Host bekommt navigate" : "nichts beim Host");
    // Eigenes Abwarten und nicht nur nachsehen: das Relay schickt der Reihe
    // nach, und wenn beim Host schon etwas liegt, ist die Nachricht an B
    // vielleicht noch unterwegs.
    const beimZweiten = await B.erwarte(aufFolgeZwei, 1500);
    pruefe("A2. Und der zweite Zuschauer bekommt ihn auch",
      Boolean(beimZweiten), beimZweiten ? "navigate" : "nichts beim zweiten");

    // Alle ausser B folgen. B bleibt sitzen - das ist der Fall, um den es geht.
    A.folge = 2; A.url = URL2; A.stelle = 0;
    H.folge = 2; H.url = URL2; H.stelle = 0;
    await schlaf(800);
  }

  // --- TEST B: Der Takt holt den Nachzuegler ---------------------------------
  {
    B.leeren(); H.leeren(); A.leeren();
    // Laenger als ein Takt, kuerzer als zwei Sperren.
    await schlaf(6500);

    const geholt = B.alle(aufFolgeZwei);
    pruefe("B. Wer bei der alten Folge steht, wird geholt",
      geholt.length > 0, `${geholt.length} Befehle`);
    pruefe("B2. Das Ziel ist die Folge der Runde",
      geholt.length > 0 && geholt[0].url === URL2,
      geholt.length ? geholt[0].url : "-");
    pruefe("B3. Der Befehl faengt bei null an",
      geholt.length > 0 && Number(geholt[0].position) === 0,
      geholt.length ? String(geholt[0].position) : "-");
    pruefe("B4. Und traegt die Kennung der neuen Folge",
      geholt.length > 0 && geholt[0].episodeId === "s1e2",
      geholt.length ? String(geholt[0].episodeId) : "-");

    // Die anderen stehen schon richtig - sie bekommen nichts.
    pruefe("B5. Wer schon dort steht, bekommt nichts",
      H.alle(aufFolgeZwei).length === 0 && A.alle(aufFolgeZwei).length === 0,
      `Host ${H.alle(aufFolgeZwei).length}, ViewerA ${A.alle(aufFolgeZwei).length}`);
  }

  // --- TEST C: Kein Dauerfeuer ----------------------------------------------
  {
    // B laedt - er steht immer noch bei Folge 1. Der Takt darf ihm jetzt nicht
    // alle fuenf Sekunden die Seite neu aufreissen.
    B.leeren();
    await schlaf(11000);
    const nochmal = B.alle(aufFolgeZwei);
    pruefe("C. Der Takt laesst ihn danach in Ruhe",
      nochmal.length === 0, `${nochmal.length} weitere Befehle`);
  }

  // --- TEST D: Angekommen, und Ruhe -----------------------------------------
  {
    B.folge = 2; B.url = URL2; B.stelle = 0;
    B.leeren();
    await schlaf(6500);
    pruefe("D. Wer angekommen ist, bekommt nichts mehr",
      B.alle(aufFolgeZwei).length === 0, `${B.alle(aufFolgeZwei).length} Befehle`);
  }

  const fehler = pruefungen.filter((ok) => !ok).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  for (const t of pulse) clearInterval(t);
  for (const c of [H, A, B]) c.zu();
  process.exit(fehler ? 1 : 0);
})();
