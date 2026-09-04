"use strict";
// Host je Folge, Herzschlag, Attribution der Pause.
const WS = require("../../sync-server/node_modules/ws");

const PORT = Number(process.env.TESTPORT) || 8799;
const RAUM = "hostraum";
const KEY = "serie:testserie";
const folge = (n) => `https://aniworld.to/anime/stream/testserie/staffel-1/episode-${n}`;

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
    name, deviceId, zustand: null, leiste: null,
    verbinde: () => new Promise((fertig) => {
      socket = new WS(`ws://127.0.0.1:${PORT}`);
      socket.on("message", (roh) => {
        const m = JSON.parse(String(roh));
        eingang.push(m);
        if (m.type === "state" && Array.isArray(m.shared)) {
          const t = m.shared.find((x) => x.key === KEY);
          if (t) api.zustand = t;
        }
        if (m.type === "watchstate" && m.key === KEY) api.leiste = m;
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
      const t = eingang.find(passt);
      if (t) return resolve(t);
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

// Ein Herzschlag, wie ihn der Player schickt.
function schlagen(c, n, opt = {}) {
  c.send({
    type: "here", key: KEY,
    position: opt.position ?? 10,
    paused: Boolean(opt.paused),
    season: 1, episode: n,
    url: folge(n),
    playerSessionId: opt.sitzung || `${c.deviceId}-e${n}`
  });
}

async function beitreten(c, teilen = false) {
  await c.verbinde();
  c.send({ type: "join", room: RAUM, name: c.name, deviceId: c.deviceId });
  await c.erwarte((m) => m.type === "state");
  if (teilen) {
    c.send({ type: "share", item: { key: KEY, url: folge(1), title: "Testserie", type: "serie", season: 1, episode: 1 } });
  } else {
    c.send({ type: "enter", key: KEY });
  }
  await c.erwarte((m) => m.type === "state" && m.shared?.some((x) => x.memberIds?.includes(c.deviceId)));
}

const hostVon = (c) => c.zustand?.hostName || "";

(async () => {
  const A = client("A", "geraet-a");
  const B = client("B", "geraet-b");

  // --- 1-3. A oeffnet Folge 1 zuerst, B danach: A ist Host ---------------
  await beitreten(A, true);
  schlagen(A, 1);
  await schlaf(150);
  await beitreten(B);
  schlagen(B, 1);
  await schlaf(300);
  pruefe("1. Wer die Folge zuerst betrat, ist Host", hostVon(B) === "A", `Host=${hostVon(B) || "(keiner)"}`);

  // --- 4-6. A wechselt auf Folge 2 - und bleibt Host ---------------------
  //
  // Frueher rueckte hier B nach, weil Host war, wer die jeweilige Folge zuerst
  // betreten hatte. Ein Folgenwechsel ist aber keine Hostfrage: A ist da, A
  // meldet sich, A fuehrt weiter. Nachgezogen mit der Host-Persistenz.
  A.send({ type: "control", key: KEY, action: "navigate", position: 0, url: folge(2) });
  schlagen(A, 2);
  await schlaf(300);
  schlagen(B, 1);
  await schlaf(300);
  pruefe("6. Ein Folgenwechsel des Hosts loest keine neue Wahl aus",
    hostVon(B) === "A", `Host=${hostVon(B) || "(keiner)"}`);
  pruefe("6b. Und A sieht sich selbst genauso", hostVon(A) === "A", `Host=${hostVon(A) || "(keiner)"}`);

  // --- 7-8. A kommt zurueck auf Folge 1: unveraendert A ------------------
  A.send({ type: "control", key: KEY, action: "navigate", position: 0, url: folge(1) });
  schlagen(A, 1, { sitzung: "geraet-a-e1-neu" });
  await schlaf(300);
  schlagen(B, 1);
  await schlaf(300);
  pruefe("8. Auch ein Neuladen unterwegs kostet ihn die Rolle nicht",
    hostVon(A) === "A" && hostVon(B) === "A", `A sieht ${hostVon(A)}, B sieht ${hostVon(B)}`);

  // --- 11. Host laedt neu: neue Sitzung, er verliert den Host ------------
  B.send({ type: "control", key: KEY, action: "navigate", position: 0, url: folge(1) });
  schlagen(B, 1, { sitzung: "geraet-b-e1-neu" });
  await schlaf(300);
  schlagen(A, 1, { sitzung: "geraet-a-e1-neu" });
  await schlaf(300);
  pruefe("11. Nach einem Neuladen fuehrt der, der laenger dabei ist",
    hostVon(A) === "A", `Host=${hostVon(A) || "(keiner)"}`);

  // --- 14-16. Pause: wer gedrueckt hat, bleibt der Ausloeser -------------
  A.leeren(); B.leeren();
  B.send({ type: "control", key: KEY, action: "pause", position: 20, url: folge(1) });
  await schlaf(200);
  // A zieht die Pause nur mit und meldet sie als Zustand, nicht als Tat.
  schlagen(A, 1, { paused: true, position: 20, sitzung: "geraet-a-e1-neu" });
  schlagen(B, 1, { paused: true, position: 20, sitzung: "geraet-b-e1-neu" });
  await schlaf(300);
  pruefe("16. Pausiert von bleibt beim Ausloeser, nicht beim Mitzieher",
    A.zustand?.pausedBy === "B", `pausedBy=${A.zustand?.pausedBy || "(keiner)"}`);
  const beide = (A.leiste?.members || []);
  pruefe("14. Beide sind als angehalten gefuehrt",
    beide.length === 2 && beide.every((m) => m.paused),
    beide.map((m) => `${m.name}:${m.paused ? "pause" : "laeuft"}`).join(" "));

  // --- 15. Weiterspielen loest den Ausloeser ab --------------------------
  A.send({ type: "control", key: KEY, action: "play", position: 20, url: folge(1) });
  await schlaf(250);
  schlagen(A, 1, { paused: false, position: 21, sitzung: "geraet-a-e1-neu" });
  await schlaf(250);
  pruefe("15. Nach dem Weiterspielen steht keine Pause mehr an",
    !A.zustand?.pausedBy, `pausedBy=${A.zustand?.pausedBy || "(keiner)"}`);

  // --- 9-10. Host schliesst den Tab: kein Host mehr, Stand bleibt --------
  // B geht ganz weg, A hoert auf zu melden -> niemand aktiv.
  B.zu();
  await schlaf(300);
  // A meldet noch einmal, damit ein Zustand verschickt wird, danach Stille.
  schlagen(A, 1, { position: 30, sitzung: "geraet-a-e1-neu" });
  await schlaf(300);
  pruefe("9. Solange A meldet, ist A Host", hostVon(A) === "A", `Host=${hostVon(A) || "(keiner)"}`);

  const letzterStand = A.zustand?.progress?.position ?? A.zustand?.episode;
  pruefe("10. Der letzte Stand bleibt erhalten", letzterStand !== undefined,
    `Folge ${A.zustand?.episode}`);

  // --- Folgenwechsel ohne Wechsel-Befehl ---------------------------------
  // Der Host oeffnet die naechste Folge, ohne dass ein navigate ankommt (etwa
  // ueber die App statt ueber den Link in der Seite). Allein sein Herzschlag
  // muss die Runde mitnehmen.
  // A ist hier Host der Raum-Folge 1 - genau er muss die Runde mitnehmen.
  const vorher = A.zustand?.episode;
  schlagen(A, 9, { sitzung: "geraet-a-e9" });
  await schlaf(500);
  pruefe("Der Herzschlag des Hosts allein nimmt die Runde mit",
    A.zustand?.episode === 9, `vorher Folge ${vorher}, jetzt Folge ${A.zustand?.episode}`);

  // Und ein Zuschauer ebenso - er darf die Runde mitnehmen.
  //
  // Hier stand einmal das Gegenteil: nur der Host nehme die Runde mit. Das war
  // die Regel fuer den Herzschlag, nicht die der Watchparty - `control
  // navigate` durfte schon immer jeder schicken ("es soll jeder jeden in ne
  // neue Folge mitziehen koennen"). Damit hing alles an dieser einen Meldung,
  // und blieb sie aus, blieb die Runde stehen: am Telefon eine Folge weiter,
  // und Rechner und Fernseher ruehrten sich nicht. Was das Relay am
  // Herzschlag wirklich sieht, ist der verlaesslichere Ausloeser.
  const D = client("D", "geraet-d");
  await beitreten(D);
  schlagen(D, 9, { sitzung: "geraet-d-e9" });
  await schlaf(300);
  schlagen(D, 12, { sitzung: "geraet-d-e12" });
  await schlaf(400);
  pruefe("Auch ein Zuschauer nimmt die Runde auf seine neue Folge mit",
    D.zustand?.episode === 12, `Runde steht auf Folge ${D.zustand?.episode}`);
  D.zu();
  await schlaf(200);

  // Wer aber ohnehin woanders stand, zieht niemanden mit: er war nicht dabei,
  // also bestimmt er auch nicht, wohin es weitergeht.
  const G = client("G", "geraet-g");
  await beitreten(G);
  schlagen(G, 3, { sitzung: "geraet-g-e3" });
  await schlaf(300);
  schlagen(G, 4, { sitzung: "geraet-g-e4" });
  await schlaf(400);
  pruefe("Wer woanders steht, zieht die Runde nicht zu sich",
    G.zustand?.episode === 12, `Runde steht auf Folge ${G.zustand?.episode}`);
  G.zu();
  await schlaf(200);
  // Danach meldet A wieder die Raum-Folge, damit der Ablauftest sauber startet.
  schlagen(A, 9, { sitzung: "geraet-a-e9" });
  await schlaf(200);

  // --- Host weitergeben ---------------------------------------------------
  const E = client("E", "geraet-e");
  await beitreten(E);
  schlagen(E, 9, { sitzung: "geraet-e-e9" });
  await schlaf(400);
  pruefe("Vor der Uebergabe fuehrt A", hostVon(E) === "A", `Host=${hostVon(E) || "(keiner)"}`);

  A.send({ type: "handover", key: KEY, memberId: "geraet-e" });
  await schlaf(400);
  pruefe("Der Host laesst sich weitergeben", hostVon(E) === "E" && hostVon(A) === "E",
    `A sieht ${hostVon(A) || "(keiner)"}, E sieht ${hostVon(E) || "(keiner)"}`);

  // Wer nicht Host ist, kann ihn auch nicht verschenken.
  A.send({ type: "handover", key: KEY, memberId: "geraet-a" });
  await schlaf(400);
  pruefe("Nur der Host darf weitergeben", hostVon(E) === "E",
    `Host=${hostVon(E) || "(keiner)"}`);

  // Und nicht an jemanden, der gar nicht mitschaut.
  E.send({ type: "handover", key: KEY, memberId: "geraet-unbekannt" });
  await schlaf(300);
  pruefe("Nicht an jemanden, der nicht dabei ist", hostVon(E) === "E",
    `Host=${hostVon(E) || "(keiner)"}`);
  E.zu();
  await schlaf(200);
  schlagen(A, 9, { sitzung: "geraet-a-e9" });
  await schlaf(300);

  // --- Niemand mehr am Player: kein Host, aber der Stand bleibt ----------
  // A hoert auf zu melden. Nach Ablauf des Herzschlags darf niemand mehr als
  // Host gefuehrt werden - genau der Fall aus der Watchparty-Uebersicht.
  const C = client("C", "geraet-c");
  await beitreten(C);
  console.log("      (warte auf den Ablauf des Herzschlags, ~17 s)");
  await schlaf(17000);
  // C meldet sich, damit ein frischer Zustand verschickt wird - C selbst hat
  // nie einen Player gemeldet, gilt also auch nicht als aktiv.
  C.send({ type: "enter", key: KEY });
  await schlaf(400);
  pruefe("Kein aktiver Teilnehmer, kein Host", !C.zustand?.hostName,
    `Host=${C.zustand?.hostName || "(keiner)"}`);
  pruefe("Der letzte Stand steht trotzdem noch da",
    Boolean(C.zustand?.progress) || Number(C.zustand?.episode) > 0,
    `Folge ${C.zustand?.episode}, Stand ${C.zustand?.progress?.position ?? "-"}`);
  pruefe("Und die Leiste ist leer statt voller Karteileichen",
    (C.leiste?.members || []).length === 0, `${(C.leiste?.members || []).length} Eintraege`);
  C.zu();

  A.zu();
  const fehler = pruefungen.filter((p) => !p.ok);
  console.log(`\n${pruefungen.length - fehler.length}/${pruefungen.length} bestanden`);
  process.exit(fehler.length ? 1 : 0);
})().catch((f) => { console.error("Abgebrochen:", f.message); process.exit(2); });
