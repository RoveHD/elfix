"use strict";
// Das Nachziehen ueberlebt einen Neustart des Relays.
//
// Gemeldet als "Verbindung weg", wechselnder Host, und zwei Geraete in
// verschiedenen Folgen, die sich nicht mehr einholen. Die Ursache lag nicht in
// der Watchparty, sondern darunter: das Relay stuerzte alle fuenf Sekunden ab
// und kam neu hoch. Ueber Stunden.
//
// Der Takt, der Nachzuegler holt, merkt sich in `eintrag.nachgezogen`, wen er
// wohin geschickt hat. Diese Map stand nicht bei den fluechtigen Feldern, die
// vor dem Speichern geleert werden. JSON.stringify macht aus einer Map `{}` -
// ein leeres, aber wahres Objekt. Beim Laden ueberlebt es den Spread,
// `!eintrag.nachgezogen` ist damit falsch, und der naechste Takt ruft `.get`
// auf einem einfachen Objekt: ein TypeError in einem setInterval, also Ende
// des Prozesses. systemd startet neu, laedt dieselbe Datei, stirbt wieder.
//
// Der bestehende nachziehentest sieht das nicht: er startet das Relay nie neu,
// und damit wird die Ablage nie gelesen. Genau das passiert hier - dieser Test
// bringt sein eigenes Relay mit, weil er es zwischendurch anhalten muss.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const WS = require("../../sync-server/node_modules/ws");

const RELAY = path.join(__dirname, "..", "..", "sync-server", "server.js");
// Ohne Vorgabe einen freien Port nehmen: dieser Test laeuft neben den
// anderen, und zwei Relays auf demselben Port hiesse, dass eines still
// stirbt und gegen fremden Zustand geprueft wird.
let PORT = Number(process.env.TESTPORT) || 0;
let ADRESSE = "";
const portWaehlen = () => new Promise((fertig, scheitern) => {
  if (PORT) { ADRESSE = `ws://127.0.0.1:${PORT}`; return fertig(); }
  const probe = net.createServer();
  probe.on("error", scheitern);
  probe.listen(0, "127.0.0.1", () => {
    PORT = probe.address().port;
    ADRESSE = `ws://127.0.0.1:${PORT}`;
    probe.close((f) => (f ? scheitern(f) : fertig()));
  });
});
const RAUM = "neustartraum";
const KEY = "serie:neustart";
const URL1 = "https://aniworld.to/anime/stream/neustart/staffel-1/episode-1";
const URL2 = "https://aniworld.to/anime/stream/neustart/staffel-1/episode-2";

const ablage = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-neustart-"));
const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(Boolean(b)); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

/* --------------------------------------------------------------- Das Relay */

let relay = null;
let relayTot = false;
let relayFehler = "";

const ersteZeile = (text) => String(text).trim().split("\n")[0] || "ohne Meldung";

function relayStarten() {
  return new Promise((fertig, scheitern) => {
    relayTot = false;
    relayFehler = "";
    relay = spawn(process.execPath, [RELAY], {
      env: { ...process.env, PORT: String(PORT), STATE_DIRECTORY: ablage },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let ausgabe = "";
    relay.stdout.on("data", (d) => {
      ausgabe += String(d);
      if (ausgabe.includes(`auf Port ${PORT} (Ablage:`)) fertig();
    });
    relay.stderr.on("data", (d) => { relayFehler = (relayFehler + String(d)).slice(-2048); });
    // Ein Relay, das sofort wieder geht, hat den Port nicht bekommen - dann
    // laege dort ein liegengebliebenes aus einem abgebrochenen Lauf, und
    // geprueft wuerde fremder Zustand statt dieser Fassung.
    relay.on("exit", () => {
      relayTot = true;
      scheitern(new Error(`Relay auf Port ${PORT} sofort beendet: ${ersteZeile(relayFehler)}`));
    });
    const frist = setTimeout(() => scheitern(new Error("Relay startet nicht")), 8000);
    frist.unref?.();
  });
}

function relayStoppen() {
  return new Promise((fertig) => {
    if (!relay || relayTot) return fertig();
    relay.once("exit", fertig);
    relay.kill();
    const frist = setTimeout(fertig, 3000);
    frist.unref?.();
  });
}

/* ------------------------------------------------------------- Die Geraete */

const nachweis = (name) => crypto.createHash("sha256").update(name).digest("base64url");

function client(name) {
  const eingang = [];
  const wartende = [];
  let socket;
  const empfangen = (meldung) => {
    eingang.push(meldung);
    for (let i = wartende.length - 1; i >= 0; i -= 1) {
      const w = wartende[i];
      if (eingang.length <= w.ab || !w.passt(meldung)) continue;
      clearTimeout(w.timer);
      wartende.splice(i, 1);
      w.resolve(meldung);
    }
  };
  return {
    name, eingang, folge: 1, url: URL1,
    marke() { return eingang.length; },
    senden(m) { try { socket.send(JSON.stringify(m)); } catch { /* zu */ } },
    warten(ab, passt, was, ms = 3000) {
      const da = eingang.slice(ab).find(passt);
      if (da) return Promise.resolve(da);
      return new Promise((resolve, reject) => {
        const w = { ab, passt, resolve, timer: null };
        w.timer = setTimeout(() => {
          const i = wartende.indexOf(w);
          if (i >= 0) wartende.splice(i, 1);
          reject(new Error(`Zeitueberschreitung: ${name} wartet auf ${was}`));
        }, ms);
        w.timer.unref?.();
        wartende.push(w);
      });
    },
    async verbinden() {
      socket = new WS(ADRESSE);
      socket.on("message", (roh) => empfangen(JSON.parse(String(roh))));
      socket.on("error", () => { /* beim Neustart erwartet */ });
      await new Promise((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      const ab = eingang.length;
      this.senden({ type: "join", room: RAUM, name, deviceProof: nachweis(name) });
      return this.warten(ab, (m) => m.type === "state" && m.you, "Raumbeitritt");
    },
    schliessen() { try { socket?.close(); } catch { /* zu */ } }
  };
}

/**
 * Auf eine Raumkarte warten, die passt.
 *
 * Die Karte ist der einzige Ort, an dem steht, wo die Runde wirklich steht -
 * und nur wer davon abweicht, wird nachgezogen.
 *
 * Gesucht wird ab dem Anfang des Eingangs und nicht ab einer Marke. Die Karte
 * geht hinaus, sobald die Runde umzieht, und das kann vor der Marke gewesen
 * sein: unter Last kam der gemeinsame Start spaeter als die Karte, danach
 * wartete der Test auf eine zweite, die niemand mehr schickte. Eine Karte mit
 * Folge 2 gibt es vorher ohnehin nicht.
 */
const karteWie = (geraet, passt, was) => geraet.warten(0,
  (m) => m.type === "state" && passt(m.shared?.find((e) => e.key === KEY)),
  was, 8000);

const karteBeiFolge = (geraet, folge) =>
  karteWie(geraet, (e) => e?.episode === folge, `Raumkarte bei Folge ${folge}`);

const pulse = [];
function puls(c) {
  const schlag = () => c.senden({
    type: "here", key: KEY, position: 0, paused: true, duration: 1400,
    season: 1, episode: c.folge, url: c.url, playerSessionId: `${c.name}-e${c.folge}`
  });
  schlag();
  const t = setInterval(schlag, 500);
  t.unref?.();
  pulse.push(t);
}

const pulseAus = () => { for (const t of pulse) clearInterval(t); pulse.length = 0; };

/**
 * Eine Marke ueber denselben Socket hinterherschicken.
 *
 * Kommt sie zurueck, hat das Relay das davor Gesendete verarbeitet. Ohne das
 * steht hier nur die Sendereihenfolge - und ueber zwei Sockets sagt die
 * nichts: unter Last kam die Bereitmeldung des Gasts zuerst an, damit fiel
 * ihm die Fuehrung zu, und als Fuehrender zog er die Karte auf seine alte
 * Folge zurueck. Danach gab es keinen Nachzuegler mehr und nichts zu holen.
 */
async function abwarten(geraet) {
  const ab = geraet.marke();
  const marke = `ordnung-${crypto.randomUUID()}`;
  geraet.senden({ type: "chat", text: marke });
  await geraet.warten(ab, (m) => m.type === "chat" && m.text === marke, "Ordnungsmarkierung");
}

async function zustandNach(geraet, senden, passt, was) {
  const ab = geraet.marke();
  senden();
  return geraet.warten(ab, (m) => m.type === "state" && passt(m), was);
}

/** Host teilt, Gast tritt ein, beide melden ihren Playerstand bei Folge 1. */
async function rundeAufbauen(host, gast) {
  await zustandNach(host, () => host.senden({
    type: "share",
    item: { key: KEY, url: URL1, title: "Neustart", type: "serie", season: 1, episode: 1 }
  }), (m) => m.shared?.some((e) => e.key === KEY), "geteilten Titel");
  await zustandNach(host, () => gast.senden({ type: "enter", key: KEY }),
    (m) => m.shared?.find((e) => e.key === KEY)?.memberIds?.length >= 2, "Beitritt des Gasts");
  // Der Host meldet seinen Stand zuerst und bekommt damit die Fuehrung.
  //
  // Nicht bloss Reihenfolge beim Senden: gewartet wird, bis die Karte ihn als
  // Fuehrenden zeigt. Unter Last kam sonst der Stand des Gasts zuerst an, ihm
  // fiel die Fuehrung zu, und als Fuehrender zog er spaeter die ganze Runde
  // auf seine alte Folge zurueck - dann gab es gar keinen Nachzuegler mehr.
  const ab = host.marke();
  puls(host);
  await karteWie(host, (e) => e?.hostName === host.name, "Fuehrung beim Host");
  puls(gast);
  await host.warten(ab, (m) => m.type === "watchstate" && m.key === KEY
    && m.members?.length === 2, "beide Playerstaende");
}

/** Die Runde ueber die Schranke auf Folge 2 bringen - ohne den Gast. */
async function aufFolgeZweiBringen(host, gast) {
  const marken = [host.marke(), gast.marke()];
  // Ausgeloest vom Host. Wer ausloesen darf, ist hier nicht die Frage - das
  // prueft barrierstarttest. Hier soll der Zurueckbleibende zurueckbleiben und
  // nicht selbst die Runde fuehren, sonst zoege er die Karte wieder auf seine
  // Folge und es gaebe gar keinen Nachzuegler.
  host.senden({ type: "control", key: KEY, action: "navigate", position: 0, url: URL2 });
  const [vorH, vorG] = await Promise.all([
    host.warten(marken[0], (m) => m.type === "syncprepare" && m.reason === "episode-change",
      "Folgenvorbereitung beim Host"),
    gast.warten(marken[1], (m) => m.type === "syncprepare" && m.reason === "episode-change",
      "Folgenvorbereitung beim Gast")
  ]);
  const syncId = vorH.syncId;
  if (syncId !== vorG.syncId) throw new Error("keine gemeinsame Barrier-Generation");
  host.folge = 2; host.url = URL2;
  const abH = host.marke();
  host.senden({ type: "syncready", key: KEY, syncId });
  // Erst wenn die Bereitmeldung des Hosts wirklich verarbeitet ist, meldet der
  // Gast sich bereit: die Fuehrung faellt dem Ersten zu, und sie soll bei dem
  // liegen, der auch bei der neuen Folge steht.
  await abwarten(host);
  gast.senden({ type: "syncready", key: KEY, syncId });
  await host.warten(abH, (m) => m.type === "syncstart" && m.syncId === syncId, "gemeinsamen Start");
  // Der Gast meldet weiter Folge 1 - erst damit stehen sie auseinander.
  gast.folge = 1; gast.url = URL1;
  await karteWie(host, (e) => e?.episode === 2 && e?.hostName === host.name,
    "Fuehrung beim Geraet bei Folge 2");
}

const navigateAufZwei = (m) => m.type === "control" && m.action === "navigate"
  && String(m.url || "").includes("episode-2");

const gespeicherterEintrag = () => {
  try {
    const roh = JSON.parse(fs.readFileSync(path.join(ablage, "raeume.json"), "utf8"));
    return roh?.raeume?.[RAUM]?.titel?.find((x) => x.key === KEY) || null;
  } catch { return null; }
};

// Alles hier haengt an Zeitgebern, und die sind bewusst unref'd, damit ein
// abgebrochener Lauf nichts stehen laesst. Waehrend das Relay neu startet ist
// aber gar nichts anderes offen - ohne diesen Halter waere der Prozess an
// dieser Stelle einfach fertig.
const halter = setInterval(() => {}, 1000);

(async () => {
  await portWaehlen();
  await relayStarten();

  // --- Einmal nachziehen lassen, damit der Merker ueberhaupt entsteht ------
  let host = client("NeustartHost");
  let gast = client("NeustartGast");
  await host.verbinden();
  await gast.verbinden();
  await rundeAufbauen(host, gast);
  await aufFolgeZweiBringen(host, gast);

  const ab = gast.marke();
  const geholt = await gast.warten(ab, navigateAufZwei, "Nachziehbefehl", 9000).catch(() => null);
  pruefe("A. Der Takt holt den Nachzuegler", Boolean(geholt), geholt ? "navigate" : "nichts");

  // Die Ablage wird nicht vom Takt geschrieben, sondern beim naechsten
  // Zustandsversand. In einer echten Runde passiert der staendig - hier
  // genuegt ein Dritter, der dazukommt.
  const dritter = client("NeustartDritter");
  await dritter.verbinden();
  await schlaf(1800);
  const eintrag = gespeicherterEintrag();
  pruefe("B. Der Zustand liegt auf der Platte", Boolean(eintrag),
    eintrag ? `Folge ${eintrag.episode}` : "kein Eintrag");
  pruefe("B2. Und traegt keinen leergeschriebenen Nachzieh-Merker",
    Boolean(eintrag) && eintrag.nachgezogen === undefined,
    eintrag ? JSON.stringify(eintrag.nachgezogen) : "-");

  pulseAus();
  host.schliessen(); gast.schliessen(); dritter.schliessen();
  await relayStoppen();

  // --- Das Entscheidende: derselbe Zustand, neuer Prozess ------------------
  //
  // Die Ablage wird hier von Hand vergiftet. Auf dem echten Server liegt genau
  // das schon da: die Datei ist von einer Fassung geschrieben worden, die den
  // Merker mitgespeichert hat, und das Relay muss auch damit hochkommen -
  // nicht erst, nachdem jemand die Datei loescht.
  const roh = JSON.parse(fs.readFileSync(path.join(ablage, "raeume.json"), "utf8"));
  for (const t of roh.raeume[RAUM].titel) if (t.key === KEY) t.nachgezogen = {};
  fs.writeFileSync(path.join(ablage, "raeume.json"), JSON.stringify(roh));

  await relayStarten();
  host = client("NeustartHost");
  gast = client("NeustartGast");
  await host.verbinden();
  await gast.verbinden();
  // Der Titel steht schon in der geladenen Ablage; beide klinken sich ein.
  host.senden({ type: "enter", key: KEY });
  gast.senden({ type: "enter", key: KEY });
  // Wieder auseinander - genau die Lage, in der der Takt den Merker anfasst.
  host.folge = 2; host.url = URL2;
  gast.folge = 1; gast.url = URL1;
  // Der Host meldet sich zuerst: nach einem Neustart ist die Fuehrung offen,
  // und sie soll bei dem liegen, der bei Folge 2 steht. Die Folge steht schon
  // in der geladenen Karte - gewartet wird deshalb auf die Fuehrung.
  puls(host);
  await karteWie(host, (e) => e?.episode === 2 && e?.hostName === host.name,
    "Fuehrung beim Geraet bei Folge 2");
  puls(gast);

  const abNeu = gast.marke();
  // Laenger als ein Takt. Ist der Merker als einfaches Objekt geladen worden,
  // stirbt das Relay genau hier.
  const wieder = await gast.warten(abNeu, navigateAufZwei, "Nachziehbefehl", 9000).catch(() => null);

  pruefe("C. Das Relay ueberlebt den ersten Takt nach dem Neustart",
    !relayTot, relayTot ? (relayFehler.split("\n").find((z) => z.includes("Error")) || "beendet") : "laeuft");
  pruefe("C2. Und holt den Nachzuegler auch nach dem Neustart",
    Boolean(wieder), wieder ? "navigate" : "nichts");

  pulseAus();
  host.schliessen(); gast.schliessen();
  await relayStoppen();
  try { fs.rmSync(ablage, { recursive: true, force: true }); } catch { /* egal */ }

  const fehler = pruefungen.filter((ok) => !ok).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  process.exit(fehler ? 1 : 0);
})().catch((f) => {
  console.log(`FAIL  Ablauf abgebrochen   -> ${f.message}`);
  pulseAus();
  relay?.kill();
  process.exit(1);
});
