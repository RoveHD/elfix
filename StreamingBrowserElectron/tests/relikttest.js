"use strict";

// Kennungen aus der Zeit vor dem Geraetenachweis.
//
// Seit identityVersion 2 vergibt das Relay die Geraetekennung selbst, je
// Nachweis. Die alten, vom Client gewaehlten Kennungen erreicht kein Nachweis
// mehr - in der Mitgliederliste standen sie trotzdem weiter, neben der neuen
// Kennung desselben Geraets: jeder Name doppelt, und wer einen Titel unter
// seiner alten Kennung eingestellt hatte, war als Ersteller fuer immer weg.
// Niemand konnte mehr rauswerfen (Raum "Bangus", 15.9.2026: fuenf Personen,
// elf Mitglieder, Ersteller verloren).
//
// Bringt sein eigenes Relay mit: der Altzustand muss vor dem Start auf der
// Platte liegen.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const WS = require("../../sync-server/node_modules/ws");

const RAUM = "relikte";
const KEY = "serie:relikt";
const URL = "https://aniworld.to/anime/stream/relikt/staffel-1/episode-1";
const ALT_ELIAS = "alt-elias-kennung";
const ALT_JAKOB = "alt-jakob-kennung";
const ALT_FREMD = "alt-s25-kennung";
const nachweis = (wert) => crypto.createHash("sha256").update(wert).digest("base64url");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let bestanden = 0;
let gesamt = 0;
function pruefe(name, wert, detail = "") {
  gesamt += 1;
  if (wert) { bestanden += 1; console.log(`ok   ${name}`); }
  else console.log(`FAIL ${name}${detail ? "   -> " + detail : ""}`);
}

function client(port, name, geheimnis, konto = "") {
  const messages = [];
  let socket;
  const c = {
    name, messages, deviceId: "",
    mark: () => messages.length,
    send: (m) => socket.send(JSON.stringify(m)),
    close: () => socket?.close(),
    async open() {
      socket = new WS(`ws://127.0.0.1:${port}`);
      socket.on("message", (raw) => messages.push(JSON.parse(String(raw))));
      await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
      const join = { type: "join", room: RAUM, name, deviceProof: nachweis(geheimnis) };
      if (konto) join.accountProof = nachweis(`konto:${konto}`);
      c.send(join);
      const stand = await c.waitFor(0, (m) => m.type === "state" && m.you, "Beitritt");
      c.deviceId = stand.you;
      return stand;
    },
    waitFor: async (from, predicate, label, frist = 2500) => {
      const deadline = Date.now() + frist;
      while (Date.now() < deadline) {
        const found = messages.slice(from).find(predicate);
        if (found) return found;
        await wait(15);
      }
      throw new Error(`${name}: Zeitueberschreitung: ${label}`);
    }
  };
  return c;
}

const titel = (m) => m?.shared?.find((e) => e.key === KEY);

async function freierPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close((fehler) => fehler ? reject(fehler) : resolve(port));
    });
  });
}

async function gesund(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 300 }, (res) => {
      res.resume(); resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

async function run() {
  const ablage = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-relikt-"));
  // Der Altzustand: drei Mitglieder mit Kennungen, die kein Nachweis kennt.
  // Elias hat den Titel eingestellt.
  fs.writeFileSync(path.join(ablage, "raeume.json"), JSON.stringify({
    raeume: {
      [RAUM]: {
        at: Date.now(),
        titel: [{
          key: KEY, url: URL, title: "Relikt", type: "serie", season: 1, episode: 1,
          addedBy: "Elias", addedById: ALT_ELIAS, addedByKonto: "",
          addedAt: new Date().toISOString(), archived: false, progress: null,
          members: [[ALT_ELIAS, "Elias"], [ALT_JAKOB, "Jakob"], [ALT_FREMD, "S25 Jakob"]]
        }]
      }
    },
    identitaeten: []
  }));
  const port = await freierPort();
  const relay = spawn(process.execPath, [path.join(__dirname, "../../sync-server/server.js")], {
    env: { ...process.env, PORT: String(port), STATE_DIRECTORY: ablage,
      ELFIX_RELAY_SEITE: "0", ELFIX_RELAY_LEISTE: "0" },
    stdio: "ignore"
  });
  const konto = crypto.randomBytes(16).toString("hex");
  const elias = client(port, "Elias", "elias-neu", konto);
  const eliasTv = client(port, "Elias TV", "elias-tv-neu", konto);
  const jakob = client(port, "Jakob", "jakob-neu");
  try {
    const bis = Date.now() + 8000;
    while (Date.now() < bis && !(await gesund(port))) await wait(100);
    assert.ok(await gesund(port), "Relay startet nicht");

    // 1. Elias verbindet sich mit neuer Kennung und tritt ein: sein Relikt
    //    verschwindet, der Titel gehoert ihm wieder.
    await elias.open();
    pruefe("Die neue Kennung ist nicht die alte", elias.deviceId !== ALT_ELIAS);
    let mark = elias.mark();
    elias.send({ type: "enter", key: KEY });
    const nachEintritt = await elias.waitFor(mark, (m) => m.type === "state"
      && titel(m)?.memberIds?.includes(elias.deviceId), "Eintritt");
    const t1 = titel(nachEintritt);
    pruefe("Das Relikt mit demselben Namen ist weg", !t1.memberIds.includes(ALT_ELIAS), JSON.stringify(t1.members));
    pruefe("Der Name steht nur einmal", t1.members.filter((n) => n === "Elias").length === 1);
    pruefe("Fremde Relikte bleiben stehen", t1.memberIds.includes(ALT_JAKOB) && t1.memberIds.includes(ALT_FREMD));
    pruefe("Der Ersteller ist wieder Ersteller", t1.mine === true && t1.addedById === elias.deviceId);

    // 2. Ueber das Konto sind alle seine Geraete Ersteller - auch eines, das
    //    nie ein Relikt hatte.
    const tvStand = await eliasTv.open();
    pruefe("Das zweite Geraet derselben Person gilt als Ersteller", titel(tvStand)?.mine === true);

    // 3. Und der Ersteller kann wieder rauswerfen: das fremde Relikt fliegt.
    mark = elias.mark();
    eliasTv.send({ type: "kick", key: KEY, memberId: ALT_FREMD });
    const nachKick = await elias.waitFor(mark, (m) => m.type === "state"
      && titel(m) && !titel(m).memberIds.includes(ALT_FREMD), "Rauswurf des Relikts");
    pruefe("Ein Relikt laesst sich rauswerfen", !titel(nachKick).memberIds.includes(ALT_FREMD));

    // 4. Jakob ohne Konto: sein Relikt raeumt sich beim blossen Verbinden auf,
    //    sobald er Mitglied ist - hier tritt er erst ein.
    await jakob.open();
    mark = jakob.mark();
    jakob.send({ type: "enter", key: KEY });
    const jakobDrin = await jakob.waitFor(mark, (m) => m.type === "state"
      && titel(m)?.memberIds?.includes(jakob.deviceId), "Jakobs Eintritt");
    const t4 = titel(jakobDrin);
    pruefe("Auch ohne Konto verschwindet das Relikt gleichen Namens", !t4.memberIds.includes(ALT_JAKOB), JSON.stringify(t4.members));
    pruefe("Jakob ist nicht Ersteller geworden", t4.mine === false);
    pruefe("Am Ende genau die echten Geraete",
      t4.memberIds.length === 2 && ["Elias", "Jakob"].every((n) => t4.members.includes(n)),
      JSON.stringify(t4.members));

    // 5. Ein Relikt, dessen Kennung ein Nachweis inzwischen wieder traegt, ist
    //    keines: gleicher Name, aber nachweislich ein anderes Konto.
    const fremderElias = client(port, "Elias", "anderer-elias", crypto.randomBytes(16).toString("hex"));
    await fremderElias.open();
    mark = fremderElias.mark();
    fremderElias.send({ type: "enter", key: KEY });
    const t5 = titel(await fremderElias.waitFor(mark, (m) => m.type === "state"
      && titel(m)?.memberIds?.includes(fremderElias.deviceId), "fremder Elias"));
    pruefe("Ein echtes Geraet mit gleichem Namen und anderem Konto bleibt unangetastet",
      t5.memberIds.includes(elias.deviceId) && t5.memberIds.includes(fremderElias.deviceId));
    pruefe("und uebernimmt nichts", t5.mine === false && t5.addedById === elias.deviceId);
    fremderElias.close();
  } finally {
    for (const c of [elias, eliasTv, jakob]) c.close();
    relay.kill();
  }
  console.log(`${bestanden}/${gesamt} bestanden`);
  if (bestanden !== gesamt) process.exitCode = 1;
}

run().catch((error) => { console.error("FAIL", error.stack || error.message); process.exitCode = 1; });
