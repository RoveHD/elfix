"use strict";
// Der Host bleibt Host.
//
// Vorher hing die Rolle daran, wer die laufende Folge zuerst betreten hat.
// Damit wurde bei jeder neuen Folge neu gewuerfelt, und gewonnen hat, wessen
// Hoster schneller laedt. Dasselbe beim Neuladen des Players: der Stempel, an
// dem die Reihenfolge hing, wurde bei jeder neuen Player-Sitzung neu gesetzt -
// ein Hosterwechsel oder eine andere Sprache reichte also, um die Rolle zu
// verlieren, ohne dass jemand die Runde verlassen haette.
//
// Jetzt gilt: gewaehlt wird nur, wenn keiner da ist. Abgegeben wird die Rolle
// in vier Faellen - die Folge verlassen, den Titel verlassen, entfernt werden,
// ausdruecklich uebergeben. Ein kurzer Verbindungsabriss gehoert nicht dazu.

const WS = require("../../sync-server/node_modules/ws");
const PORT = Number(process.env.TESTPORT) || 8799;
const RAUM = "bleibtraum";
const KEY = "serie:bleibt";
const adresse = (folge) => `https://aniworld.to/anime/stream/bleibt/staffel-1/episode-${folge}`;

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(Boolean(b)); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name, id) {
  let socket; const eingang = []; const warten = [];
  const api = { name, deviceId: id, stelle: 0, pausiert: false, folge: 4, sitzung: `${id}-s1`,
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
    // Die Host-Kennung, wie dieses Geraet sie zuletzt gemeldet bekommen hat.
    // Der juengste Stand zaehlt - auch ein leerer, denn "gerade keiner" ist
    // eine Auskunft und keine Luecke.
    hostSicht: () => {
      for (let i = eingang.length - 1; i >= 0; i -= 1) {
        const m = eingang[i];
        if (m.type !== "state") continue;
        const t = m.shared?.find((x) => x.key === KEY);
        if (t) return t.hostId || "";
      }
      return null;
    },
    erwarte: (passt, ms = 2000) => new Promise((resolve) => {
      const t = eingang.find(passt);
      if (t) return resolve(t);
      const e = { passt, resolve }; warten.push(e);
      setTimeout(() => { const i = warten.indexOf(e); if (i >= 0) { warten.splice(i, 1); resolve(null); } }, ms);
    })
  };
  return api;
}

const pulse = new Map();
function puls(c) {
  stoppen(c);
  const schlag = () => c.send({ type: "here", key: KEY, position: c.stelle, paused: c.pausiert,
    season: 1, episode: c.folge, url: adresse(c.folge), playerSessionId: c.sitzung });
  schlag();
  const t = setInterval(schlag, 500); t.unref?.();
  pulse.set(c.deviceId, t);
}
function stoppen(c) {
  const t = pulse.get(c.deviceId);
  if (t) { clearInterval(t); pulse.delete(c.deviceId); }
}

async function beitreten(c, teilen) {
  await c.verbinde();
  c.send({ type: "join", room: RAUM, name: c.name, deviceId: c.deviceId });
  await c.erwarte((m) => m.type === "state");
  if (teilen) c.send({ type: "share", item: { key: KEY, url: adresse(4), title: "Bleibt", type: "serie", season: 1, episode: 4 } });
  else c.send({ type: "enter", key: KEY });
  await c.erwarte((m) => m.type === "state" && m.shared?.some((x) => x.memberIds?.includes(c.deviceId)));
}

// Wer ist Host - aus Sicht dieses Geraets, so wie das Relay es ihm gemeldet
// hat. Nicht geleert und nichts erzwungen: das Relay schickt den Zustand von
// sich aus, sobald der Host sich aendert, und genau darauf kommt es an.
async function hostLaut(c) {
  await schlaf(150);
  return c.hostSicht();
}

(async () => {
  const A = client("A", "bleibt-a");
  const B = client("B", "bleibt-b");
  await beitreten(A, true);
  await schlaf(150);
  await beitreten(B, false);
  A.stelle = 50; puls(A);
  await schlaf(200);
  B.stelle = 50; puls(B);
  await schlaf(900);

  pruefe("0. A fuehrt - er war zuerst da",
    (await hostLaut(A)) === A.deviceId, `hostId=${await hostLaut(A)}`);

  // --- 1. Folgenwechsel ------------------------------------------------------
  A.folge = 5;
  A.send({ type: "control", key: KEY, action: "navigate", position: 0, url: adresse(5) });
  await schlaf(300);
  B.folge = 5;
  await schlaf(1000);
  pruefe("1. Nach dem Wechsel auf Folge 5 fuehrt weiter A",
    (await hostLaut(A)) === A.deviceId, `hostId=${await hostLaut(A)}`);

  // --- 2. B laedt die naechste Folge schneller ------------------------------
  // Der Fall aus der Meldung: der Gast ist zuerst an der neuen Folge.
  A.send({ type: "control", key: KEY, action: "navigate", position: 0, url: adresse(6) });
  B.folge = 6;
  B.sitzung = `${B.deviceId}-s6`;
  await schlaf(900);
  pruefe("2. B ist zuerst an Folge 6 - und A bleibt trotzdem Host",
    (await hostLaut(B)) === A.deviceId,
    `hostId=${await hostLaut(B)} (A=${A.deviceId}, B=${B.deviceId})`);
  A.folge = 6; A.sitzung = `${A.deviceId}-s6`;
  await schlaf(900);
  pruefe("2b. Und auch, nachdem A dort angekommen ist",
    (await hostLaut(A)) === A.deviceId, `hostId=${await hostLaut(A)}`);

  // --- 3. Hosterwechsel: neuer Player, gleiche Folge -------------------------
  A.sitzung = `${A.deviceId}-hoster2`;
  await schlaf(1000);
  pruefe("3. Ein Player-Neuladen kostet den Host seine Rolle nicht",
    (await hostLaut(A)) === A.deviceId, `hostId=${await hostLaut(A)}`);

  // --- 4. Kurzer Verbindungsabriss ------------------------------------------
  stoppen(A);
  A.zu();
  await schlaf(1200);
  const waehrendWeg = await hostLaut(B);
  pruefe("4. Waehrend eines kurzen Abrisses rueckt niemand nach",
    waehrendWeg === A.deviceId, `hostId=${waehrendWeg}`);
  // A kommt zurueck - und es wird nicht hin- und hergewechselt.
  await A.verbinde();
  A.send({ type: "join", room: RAUM, name: A.name, deviceId: A.deviceId });
  await A.erwarte((m) => m.type === "state");
  A.send({ type: "enter", key: KEY });
  puls(A);
  await schlaf(1000);
  pruefe("4b. Und nach der Rueckkehr ist es unveraendert A",
    (await hostLaut(A)) === A.deviceId, `hostId=${await hostLaut(A)}`);

  // --- 5. A verlaesst die Runde wirklich -------------------------------------
  stoppen(A);
  A.send({ type: "bye", key: KEY });
  await schlaf(900);
  pruefe("5. Verlaesst A die Folge wirklich, uebernimmt B",
    (await hostLaut(B)) === B.deviceId, `hostId=${await hostLaut(B)}`);

  // A kommt als gewoehnlicher Teilnehmer zurueck.
  A.folge = 6;
  puls(A);
  await schlaf(1000);
  pruefe("5b. Kehrt A zurueck, bleibt B Host",
    (await hostLaut(A)) === B.deviceId,
    "wer nachgerueckt ist, wird nicht wieder verdraengt");

  // --- 6. Ausdrueckliche Uebergabe ------------------------------------------
  // B gibt an A zurueck - und das muss die naechste Folge ueberleben.
  B.send({ type: "handover", key: KEY, memberId: A.deviceId });
  await schlaf(900);
  pruefe("6. Nach der Uebergabe fuehrt A",
    (await hostLaut(A)) === A.deviceId, `hostId=${await hostLaut(A)}`);
  A.send({ type: "control", key: KEY, action: "navigate", position: 0, url: adresse(7) });
  B.folge = 7; B.sitzung = `${B.deviceId}-s7`;
  await schlaf(400);
  A.folge = 7; A.sitzung = `${A.deviceId}-s7`;
  await schlaf(1000);
  pruefe("6b. Und bleibt es auch auf der naechsten Folge",
    (await hostLaut(B)) === A.deviceId,
    "die Vorreihung allein truege nur bis zum naechsten Folgenwechsel");

  // --- 7. Ein spaeter Beitretender wird nicht durch Tempo Host ---------------
  const C = client("C", "bleibt-c");
  await beitreten(C, false);
  C.folge = 8; C.sitzung = `${C.deviceId}-s8`;
  C.stelle = 0; puls(C);
  // C ist als Einziger schon an Folge 8, bevor die Runde dort ankommt.
  await schlaf(1000);
  pruefe("7. Wer eine neue Folge schneller laedt, wird davon nicht Host",
    (await hostLaut(C)) === A.deviceId, `hostId=${await hostLaut(C)}`);

  // --- 8. Alle sehen dieselbe Kennung ---------------------------------------
  const sichtA = await hostLaut(A);
  const sichtB = await hostLaut(B);
  const sichtC = await hostLaut(C);
  pruefe("8. Desktop, Gast und Nachzuegler sehen dieselbe Host-Kennung",
    sichtA && sichtA === sichtB && sichtB === sichtC,
    `A=${sichtA} B=${sichtB} C=${sichtC}`);

  // --- 9. Und die Host-Autoritaet gilt weiter -------------------------------
  // Der Fix von Problem 1 und 2 muss mit der gehaltenen Rolle zusammenpassen.
  A.folge = 8; A.sitzung = `${A.deviceId}-s8`; A.stelle = 300; A.pausiert = false;
  B.folge = 8; B.sitzung = `${B.deviceId}-s8`; B.stelle = 300;
  await schlaf(1200);
  C.leeren();
  B.send({ type: "control", key: KEY, action: "seek", position: 12, url: adresse(8) });
  await schlaf(1000);
  pruefe("9. Der Gast bewegt die Runde auch jetzt nicht",
    !C.erwarteSofort && !(await C.erwarte((m) => m.type === "control" && m.action === "seek" && m.position < 50, 400)),
    "Host-Autoritaet und gehaltene Rolle passen zusammen");
  C.leeren();
  A.send({ type: "control", key: KEY, action: "seek", position: 320, url: adresse(8) });
  const cFolgt = await C.erwarte((m) => m.type === "control" && m.action === "seek", 2000);
  pruefe("9b. Der gehaltene Host dagegen schon",
    cFolgt && Math.abs(cFolgt.position - 320) < 1,
    cFolgt ? `auf ${cFolgt.position}` : "kam nicht");

  const fehler = pruefungen.filter((ok) => !ok).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  for (const t of pulse.values()) clearInterval(t);
  for (const c of [A, B, C]) c.zu();
  process.exit(fehler ? 1 : 0);
})();
