"use strict";
// Spulen - und die Frage, wann ein auseinandergelaufenes Geraet ueberhaupt noch
// zurueckgeholt wird. Seit dem Umstieg auf reinen Ereignis-Abgleich lautet die
// Antwort: erst bei weitem Versatz, sonst nie.
const WS = require("../../sync-server/node_modules/ws");
const PORT = Number(process.env.TESTPORT) || 8799;
const RAUM = "driftraum";
const KEY = "serie:drift";
const URL1 = "https://aniworld.to/anime/stream/drift/staffel-1/episode-1";

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(b); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };
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

(async () => {
  const A = client("A", "geraet-a");
  const B = client("B", "geraet-b");
  for (const [c, teilen] of [[A, true], [B, false]]) {
    await c.verbinde();
    c.send({ type: "join", room: RAUM, name: c.name, deviceId: c.deviceId });
    await c.erwarte((m) => m.type === "state");
    if (teilen) c.send({ type: "share", item: { key: KEY, url: URL1, title: "Drift", type: "serie", season: 1, episode: 1 } });
    else c.send({ type: "enter", key: KEY });
    await c.erwarte((m) => m.type === "state" && m.shared?.some((x) => x.memberIds?.includes(c.deviceId)));
  }
  A.stelle = 100; puls(A);
  await schlaf(200);
  B.stelle = 100; puls(B);
  await schlaf(400);

  // --- 1. Spulen erreicht den anderen exakt ------------------------------
  A.leeren(); B.leeren();
  A.stelle = 400;
  A.send({ type: "control", key: KEY, action: "seek", position: 400, url: URL1 });
  const sprung = await B.erwarte((m) => m.type === "control" && m.action === "seek");
  pruefe("1. Ein Sprung erreicht den anderen mit genauer Stelle",
    sprung && Math.abs(sprung.position - 400) < 0.001, sprung ? `position=${sprung.position}` : "kam nicht");
  // B folgt dem Sprung, wie es die App auch taete.
  B.stelle = 400;

  // --- 2. Kleiner Versatz bleibt stehen ----------------------------------
  // Das ist der Kern dieser Fassung: der Zeitversatz, der im Lauf von allein
  // entsteht, wird nicht mehr ausgeglichen. B landet nach dem Sprung auf einem
  // anderen Schluesselbild - drei Sekunden daneben - und wird in Ruhe gelassen.
  //
  // Vorher die Ruhezeit einer moeglichen Meldung aus dem Sprung eben abwarten,
  // sonst koennte deren Sperre das Ergebnis vortaeuschen.
  B.stelle = 400;
  await schlaf(5500);
  B.stelle = A.stelle - 3;
  B.leeren();
  const kleiner = await B.erwarte((m) => m.type === "control" && m.action === "hostzeit", 3000);
  pruefe("2. Drei Sekunden Versatz werden in Ruhe gelassen", !kleiner,
    kleiner ? `wurde auf ${kleiner.position.toFixed(2)} gerueckt` : "bleibt stehen");

  // --- 2b. Weiter Versatz wird dagegen gemeldet --------------------------
  B.stelle = A.stelle - 20;
  B.leeren();
  const ausgleich = await B.erwarte((m) => m.type === "control" && m.action === "hostzeit", 3000);
  pruefe("2b. Zwanzig Sekunden Versatz bekommen die Host-Zeit gemeldet",
    Boolean(ausgleich), ausgleich ? `auf ${ausgleich.position.toFixed(2)}` : "kein Ausgleich");
  pruefe("2c. Gemeldet wird die Stelle des Hosts",
    ausgleich && Math.abs(ausgleich.position - A.stelle) < 2.5,
    ausgleich ? `Ziel ${ausgleich.position.toFixed(2)}, Host ${A.stelle.toFixed(2)}` : "-");

  // --- 3. Der Host selbst wird nie gerueckt ------------------------------
  A.leeren();
  A.stelle = 380;
  const anHost = await A.erwarte((m) => m.type === "control" && m.action === "hostzeit", 2500);
  pruefe("3. Der Host bekommt nie eine Korrektur", !anHost, anHost ? "er wurde gerueckt" : "bleibt stehen");

  // --- 4./5. Takt der Meldungen ------------------------------------------
  // Ob aus der gemeldeten Host-Zeit ein Sprung wird, entscheidet der Player -
  // das laesst sich von hier nicht pruefen. Das Relay meldet sie hoechstens
  // alle fuenf Sekunden; genau das wird hier gemessen.
  B.stelle = 300;
  B.leeren();
  // Grosszuegig warten: aus 2b kann noch eine Ruhezeit laufen.
  const ersteMeldung = await B.erwarte((m) => m.type === "control" && m.action === "hostzeit", 7000);
  const seitdem = Date.now();
  B.leeren();
  const zweiteMeldung = await B.erwarte((m) => m.type === "control" && m.action === "hostzeit", 7000);
  pruefe("4. Die Host-Zeit kommt bei weitem Versatz an", Boolean(ersteMeldung),
    ersteMeldung ? `position=${ersteMeldung.position.toFixed(2)}` : "kam nicht");
  pruefe("5. Und hoechstens alle fuenf Sekunden",
    !zweiteMeldung || Date.now() - seitdem >= 4500,
    zweiteMeldung ? `${Date.now() - seitdem} ms Abstand` : "keine zweite");

  // --- 6. Pausierte werden nicht gerueckt --------------------------------
  B.pausiert = true; B.stelle = 200;
  B.leeren();
  const beiPause = await B.erwarte((m) => m.type === "control" && m.action === "hostzeit", 2500);
  pruefe("6. Wer pausiert ist, wird nicht nachgezogen", !beiPause,
    beiPause ? "wurde gerueckt" : "in Ruhe gelassen");

  // --- 7. Eine Pause aus einer anderen Folge haelt die Runde nicht an ----
  B.pausiert = false; B.stelle = 380; B.folge = 3;
  await schlaf(800);
  A.leeren();
  B.pausiert = true;
  B.send({ type: "control", key: KEY, action: "pause", position: 50,
    url: "https://aniworld.to/anime/stream/drift/staffel-1/episode-3" });
  const fremdePause = await A.erwarte((m) => m.type === "control" && m.action === "pause", 1200);
  pruefe("7. Eine Pause aus einer anderen Folge erreicht die Runde nicht",
    !fremdePause, fremdePause ? "kam trotzdem an" : "bleibt in ihrer Folge");

  // Und die Runde laeuft weiter: A bekommt weder Pause noch Ausrichtung.
  A.leeren();
  const nachwirkung = await A.erwarte((m) => m.type === "control", 1500);
  pruefe("7b. Die laufende Folge bleibt davon unberuehrt", !nachwirkung,
    nachwirkung ? `bekam ${nachwirkung.action}` : "laeuft weiter");

  // --- 8. Abmelden wirkt sofort, nicht erst nach dem Herzschlag ----------
  // B stellt auf Startseite um: die App meldet ab, statt still zu werden.
  B.pausiert = false; B.folge = 1; B.stelle = 500;
  await schlaf(800);
  A.leeren();
  const vorherDrin = await A.erwarte((m) => m.type === "watchstate"
    && m.members.some((x) => x.id === "geraet-b"), 2000);
  pruefe("8. Vorher steht B in der Leiste", Boolean(vorherDrin),
    vorherDrin ? vorherDrin.members.map((m) => m.name).join(", ") : "war nicht drin");

  A.leeren();
  const abgemeldet = Date.now();
  B.send({ type: "bye", key: KEY });
  const ohneB = await A.erwarte((m) => m.type === "watchstate"
    && !m.members.some((x) => x.id === "geraet-b"), 2000);
  pruefe("8b. Nach dem Abmelden ist B sofort weg", Boolean(ohneB),
    ohneB ? `nach ${Date.now() - abgemeldet} ms` : "blieb stehen");

  // Und der Host wandert mit, wenn der Abgemeldete Host war.
  pruefe("8c. Die Leiste zeigt danach nur noch die Verbliebenen",
    (ohneB?.members || []).every((m) => m.id !== "geraet-b"),
    (ohneB?.members || []).map((m) => m.name).join(", ") || "leer");

  for (const t of pulse) clearInterval(t);
  A.zu(); B.zu();
  const fehler = pruefungen.filter((p) => !p).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  process.exit(fehler ? 1 : 0);
})().catch((f) => { console.error("Abgebrochen:", f.message); process.exit(2); });
