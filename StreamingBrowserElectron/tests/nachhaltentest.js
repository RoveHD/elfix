"use strict";
// Niemand laeuft allein weiter - und niemand bleibt allein zurueck.
//
// Gemeldet mit zwei Bildern: "am Fernseher spielt es weiter, am Handy und am
// PC ist pausiert" und "ich geh am Handy eine Folge weiter, PC und Fernseher
// machen nix". Zwei Beschwerden, eine Ursache - eine Nachricht, die einmal
// hinausgeht, und niemand, der danach noch einmal nachsieht.
//
// Geprueft wird deshalb beides in der Richtung, in der es bisher fehlte:
//
//   1. Die Runde steht, ein Geraet laeuft: es bekommt seine Pause nachgehalten
//      - genauso wie umgekehrt ein Stehengebliebenes sein Play nachgereicht
//      bekommt. Ohne Dauerfeuer, und nur der, den es angeht.
//   2. Ein Geraet meldet im Herzschlag eine neue Folge, ohne je ein `control
//      navigate` geschickt zu haben: die Runde zieht trotzdem nach, und die
//      anderen werden geholt.
//
// Der Fernseher in diesem Test ist stur: er beantwortet keinen einzigen
// Befehl. Genau darum geht es - ein Geraet, das den einen Befehl verpasst
// hat, muss vom Relay wieder eingefangen werden.

const WS = require("../../sync-server/node_modules/ws");

const PORT = Number(process.env.TESTPORT) || 8791;
const RAUM = "nachhalteraum";
const KEY = "serie:nachhalte";
const BASIS = "https://aniworld.to/anime/stream/nachhalte";
const URL1 = `${BASIS}/staffel-1/episode-1`;
const URL2 = `${BASIS}/staffel-1/episode-2`;

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(Boolean(b)); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

// Ein Geraet, das sich wie ein Player benimmt: es befolgt, was hereinkommt -
// es sei denn, es ist "stur". Ein sturer Teilnehmer ist der Fernseher aus der
// Meldung: der Befehl kam nie bei ihm an, und er laeuft munter weiter.
function client(name, id, stur) {
  let socket; const eingang = []; const warten = [];
  const api = {
    name, deviceId: id, stur: Boolean(stur), stelle: 0, pausiert: false, folge: 1, url: URL1,
    verbinde: () => new Promise((f) => {
      socket = new WS(`ws://127.0.0.1:${PORT}`);
      socket.on("message", (roh) => {
        const m = JSON.parse(String(roh));
        eingang.push(m);
        if (m.type === "control" && !api.stur) api.befolgen(m);
        for (let i = warten.length - 1; i >= 0; i -= 1) {
          if (warten[i].passt(m)) { warten[i].resolve(m); warten.splice(i, 1); }
        }
      });
      socket.on("open", f);
    }),
    // Was ein Player mit einem Befehl macht. Die Messung ("hostzeit") ist
    // keine Anweisung - der Player entscheidet dort selbst, und hier heisst
    // das: nichts tun.
    befolgen: (m) => {
      if (m.action === "play") { api.pausiert = false; api.stelle = Number(m.position) || api.stelle; }
      else if (m.action === "pause") { api.pausiert = true; api.stelle = Number(m.position) || api.stelle; }
      else if (m.action === "seek") { api.stelle = Number(m.position) || api.stelle; }
      else if (m.action === "navigate") {
        api.url = String(m.url || api.url);
        const treffer = api.url.match(/episode-(\d+)/);
        if (treffer) api.folge = Number(treffer[1]);
        api.stelle = 0;
      }
    },
    send: (m) => socket.send(JSON.stringify(m)),
    zu: () => { try { socket.close(); } catch { /* zu */ } },
    leeren: () => { eingang.length = 0; },
    alle: (passt) => eingang.filter(passt),
    letzte: (passt) => eingang.filter(passt).slice(-1)[0] || null,
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
  if (teilen) c.send({ type: "share", item: { key: KEY, url: URL1, title: "Nachhalte", type: "serie", season: 1, episode: 1 } });
  else c.send({ type: "enter", key: KEY });
  await c.erwarte((m) => m.type === "state" && m.shared?.some((x) => x.memberIds?.includes(c.deviceId)));
}

/** Eine nachgehaltene Pause: an genau ein Geraet, mit der Stelle des Hosts. */
const nachgehalten = (m) => m.type === "control" && m.action === "pause" && m.resync === true;
/** Ein Befehl, der auf die zweite Folge zieht. */
const aufFolgeZwei = (m) => m.type === "control" && m.action === "navigate"
  && String(m.url || "").includes("episode-2");
/** Die Folge, bei der die Runde steht - aus dem zuletzt gemeldeten Zustand. */
function rundenFolge(c) {
  const zustand = c.letzte((m) => m.type === "state" && m.shared?.some((x) => x.key === KEY));
  const eintrag = zustand?.shared?.find((x) => x.key === KEY);
  return eintrag ? Number(eintrag.episode || 0) : 0;
}

(async () => {
  // H fuehrt (er teilt den Titel und ist zuerst am Player), TV ist stur,
  // Handy macht mit.
  const H = client("Host", "nachhalte-host", false);
  const TV = client("Fernseher", "nachhalte-tv", true);
  const Handy = client("Handy", "nachhalte-handy", false);
  await beitreten(H, true);
  await beitreten(TV, false);
  await beitreten(Handy, false);

  H.stelle = 400; puls(H);
  TV.stelle = 400; puls(TV);
  Handy.stelle = 400; puls(Handy);
  await schlaf(1200);

  {
    const zustand = H.letzte((m) => m.type === "state" && m.shared?.some((x) => x.key === KEY));
    const eintrag = zustand?.shared?.find((x) => x.key === KEY);
    pruefe("0. Der Host fuehrt die Runde", eintrag?.hostId === H.deviceId,
      `hostId ${eintrag?.hostId || "-"}`);
  }

  // --- TEST A: Die Runde steht, der Fernseher laeuft ------------------------
  {
    H.leeren(); TV.leeren(); Handy.leeren();
    // Der Host haelt an. Handy befolgt es, der Fernseher bekommt den Befehl
    // nie zu Gesicht - er laeuft weiter.
    H.pausiert = true;
    H.send({ type: "control", key: KEY, action: "pause", position: H.stelle });

    const beimHandy = await Handy.erwarte((m) => m.type === "control" && m.action === "pause", 1500);
    pruefe("A. Die Pause geht an die Runde", Boolean(beimHandy), beimHandy ? "angekommen" : "nichts");

    TV.leeren();
    const nachgereicht = await TV.erwarte(nachgehalten, 4000);
    pruefe("A2. Wer weiterlaeuft, bekommt die Pause nachgehalten",
      Boolean(nachgereicht), nachgereicht ? "pause resync" : "nichts beim Fernseher");
    pruefe("A3. Und zwar auf die Stelle des Hosts",
      Boolean(nachgereicht) && Math.abs(Number(nachgereicht.position) - H.stelle) < 2,
      nachgereicht ? `${Math.round(nachgereicht.position)} statt ${Math.round(H.stelle)}` : "-");
    pruefe("A4. Sie meint die Folge, die dort offen steht",
      Boolean(nachgereicht) && nachgereicht.episodeId === "s1e1",
      nachgereicht ? String(nachgereicht.episodeId) : "-");
    pruefe("A5. Und sie laeuft danach nicht weiter",
      Boolean(nachgereicht) && nachgereicht.playing === false,
      nachgereicht ? String(nachgereicht.playing) : "-");
  }

  // --- TEST B: Kein Dauerfeuer, aber auch kein Aufgeben ---------------------
  {
    TV.leeren(); Handy.leeren();
    await schlaf(5000);
    const wiederholt = TV.alle(nachgehalten);
    pruefe("B. Der Sture wird weiter geholt, aber nicht im Sekundentakt",
      wiederholt.length >= 1 && wiederholt.length <= 3, `${wiederholt.length} Pausen in 5 s`);
    pruefe("B2. Wer schon steht, bekommt keine",
      Handy.alle(nachgehalten).length === 0, `${Handy.alle(nachgehalten).length} beim Handy`);
    pruefe("B3. Und der Host bekommt seine eigene Pause nicht zurueck",
      H.alle(nachgehalten).length === 0, `${H.alle(nachgehalten).length} beim Host`);
  }

  // --- TEST C: Angekommen, und Ruhe -----------------------------------------
  {
    TV.pausiert = true; TV.stelle = H.stelle;
    TV.leeren();
    await schlaf(4000);
    pruefe("C. Wer angehalten hat, bekommt nichts mehr",
      TV.alle(nachgehalten).length === 0, `${TV.alle(nachgehalten).length} Pausen`);
  }

  // --- TEST D: Ein Play eines Zuschauers wird nicht zurueckgestoppt ---------
  {
    // Das Handy drueckt Play. Der Host befolgt es (sein Player laeuft an), und
    // damit laeuft die Runde - niemand darf jetzt eine Pause hinterhergeschickt
    // bekommen, nur weil der letzte Rundenbefehl "pause" hiess.
    H.leeren(); TV.leeren(); Handy.leeren();
    TV.stur = false;
    Handy.pausiert = false;
    Handy.send({ type: "control", key: KEY, action: "play", position: Handy.stelle });
    await schlaf(2500);
    pruefe("D. Ein Play der Runde wird nicht zurueckgestoppt",
      Handy.alle(nachgehalten).length === 0 && TV.alle(nachgehalten).length === 0,
      `Handy ${Handy.alle(nachgehalten).length}, Fernseher ${TV.alle(nachgehalten).length}`);
    pruefe("D2. Und alle laufen wieder",
      !H.pausiert && !TV.pausiert && !Handy.pausiert,
      `Host ${H.pausiert}, Fernseher ${TV.pausiert}, Handy ${Handy.pausiert}`);
  }

  // --- TEST D2: Der Host puffert erst - das kostet kein Zurueckstoppen ------
  {
    // Alle stehen, dann drueckt das Handy Play. Der Host ist hier stur: sein
    // Player laeuft nicht sofort an, er meldet also weiter "angehalten". Genau
    // diese Luecke darf das Weiterschauen nicht mit einem Ruck beginnen
    // lassen.
    H.pausiert = true;
    H.send({ type: "control", key: KEY, action: "pause", position: H.stelle });
    await schlaf(600);
    H.stur = true;
    H.leeren(); TV.leeren(); Handy.leeren();
    Handy.pausiert = false;
    Handy.send({ type: "control", key: KEY, action: "play", position: Handy.stelle });
    await schlaf(2200);
    pruefe("D3. Waehrend der Host puffert, wird niemand zurueckgestoppt",
      Handy.alle(nachgehalten).length === 0, `${Handy.alle(nachgehalten).length} Pausen`);

    // Laeuft er auch danach nicht an, gilt wieder allein sein Stand: er ist
    // die Zeitquelle, und wer laeuft, waehrend er steht, wird angehalten.
    const spaeter = await Handy.erwarte(nachgehalten, 4000);
    pruefe("D4. Bleibt er stehen, gilt danach wieder sein Stand",
      Boolean(spaeter), spaeter ? "pause" : "keine Pause");

    H.stur = false;
    H.pausiert = false;
    Handy.pausiert = false;
    TV.pausiert = false;
    H.send({ type: "control", key: KEY, action: "play", position: H.stelle });
    await schlaf(600);
  }

  // --- TEST E: Eine Folge weiter, ohne ein einziges navigate ----------------
  {
    H.leeren(); TV.leeren(); Handy.leeren();
    // Das Handy geht eine Folge weiter. Es schickt *kein* `control navigate` -
    // genau der Fall, in dem die Runde bisher sitzen blieb.
    Handy.folge = 2; Handy.url = URL2; Handy.stelle = 0;

    const beimHost = await H.erwarte(aufFolgeZwei, 3000);
    pruefe("E. Ein gemeldeter Folgenwechsel zieht die Runde nach",
      Boolean(beimHost), beimHost ? "Host bekommt navigate" : "nichts beim Host");
    const beimTV = await TV.erwarte(aufFolgeZwei, 3000);
    pruefe("E2. Und der Fernseher wird mitgenommen",
      Boolean(beimTV), beimTV ? "navigate" : "nichts beim Fernseher");
    pruefe("E3. Der Befehl faengt bei null an",
      Boolean(beimHost) && Number(beimHost.position) === 0,
      beimHost ? String(beimHost.position) : "-");
    await schlaf(800);
    pruefe("E4. Die Runde steht jetzt bei der neuen Folge", rundenFolge(H) === 2,
      `Folge ${rundenFolge(H)}`);
    pruefe("E5. Und der, der gewechselt hat, wird nicht zurueckgezogen",
      Handy.alle((m) => m.type === "control" && m.action === "navigate"
        && String(m.url || "").includes("episode-1")).length === 0,
      "kein Rueckzug");
  }

  // --- TEST F: Ein Beitretender wirft die Runde nicht zurueck ---------------
  {
    const Neu = client("Spaeter", "nachhalte-neu", false);
    await beitreten(Neu, false);
    Neu.stelle = 0; Neu.folge = 1; Neu.url = URL1; puls(Neu);
    H.leeren(); TV.leeren();
    await schlaf(2000);
    pruefe("F. Wer bei der alten Folge dazukommt, zieht die Runde nicht zurueck",
      rundenFolge(H) === 2, `Folge ${rundenFolge(H)}`);
    pruefe("F2. Die anderen bekommen kein navigate auf die alte Folge",
      H.alle((m) => m.type === "control" && m.action === "navigate"
        && String(m.url || "").includes("episode-1")).length === 0,
      "nichts");
    const geholt = await Neu.erwarte(aufFolgeZwei, 6000);
    pruefe("F3. Stattdessen wird er selbst geholt", Boolean(geholt),
      geholt ? "navigate" : "nichts");
    Neu.zu();
  }

  const fehler = pruefungen.filter((ok) => !ok).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  for (const t of pulse) clearInterval(t);
  for (const c of [H, TV, Handy]) c.zu();
  process.exit(fehler ? 1 : 0);
})();
