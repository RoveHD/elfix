"use strict";

// Alle Pruefungen der Reihe nach.
//
// Vier davon brauchen ein laufendes Relay - sie pruefen das Zusammenspiel
// zweier Geraete, und genau dort sassen die Fehler, die "node --check" nie
// gesehen hat. Der Server wird je Suite frisch gestartet, damit kein Zustand
// aus dem vorigen Durchlauf hineinredet.

const { spawn, spawnSync } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const net = require("net");

const HIER = __dirname;
const RELAY = path.join(HIER, "..", "..", "sync-server", "server.js");
const RELAY_TEST_IDENTITAET = path.join(HIER, "relay-test-identitaet.js");
const PORT = Number(process.env.TESTPORT) || 0;

// Ohne Relay: reine Rechenpruefungen.
const OHNE_RELAY = ["kalendertest", "datumtest", "standtest", "fortschritttest", "brueckentest", "knotentest", "knopftest", "synclogiktest", "watchparty-praezisiontest", "playertest", "sicherungtest", "titeltest", "empfehlungtest", "empfehlungslauftest", "begruendungtest", "katalogtest", "metadatentest", "gatewaytest", "externtest", "profiltest", "kacheltest", "leistetest", "mediathektest", "wiederansehentest", "watchlisttest", "verlauftest", "suchetest", "trefferbildtest", "ausschnitttest", "hinweistest", "adblocktest", "verifizierungtest", "youtubetest", "youtubesynctest", "ytleistetest", "wiedergabetest", "anbietermenuetest", "mediathektabtest", "anbieternachtragtest", "autoplaytest", "naechstefolgetest", "rueckblicktest", "wrappedtest", "openingtest", "sponsorblocktest", "youtubedisliketest", "trailertest", "qualitaettest", "direktquelletest", "direktlauftest", "direktlinkstest", "direktfolgentest", "spielertest", "direktmodustest", "manifesttest", "streamspurtest", "direktprobetest", "direktregressionstest", "schaltertest", "tastentest", "umzugtest", "markentest", "fassungtest", "qrtest", "titelbildtest", "werbefiltertest", "folgenlinktest", "folgentiteltest", "uebersichttest", "relaytest", "bildnachreichungtest", "bildfallbacktest", "startknopftest", "hosterplayertest", "autostarttest", "startphasentest", "startfreigabetest", "bestandschutztest", "raumarchivtest", "nachschubtest"];
// Mit Relay: das Zusammenspiel.
OHNE_RELAY.push("watchpartyvorbereitungtest");
OHNE_RELAY.push("watchpartyquellentest");
OHNE_RELAY.push("androiddirekttest");
OHNE_RELAY.push("ansichtsleistungtest");
OHNE_RELAY.push("verlauflistungtest");
OHNE_RELAY.push("appearancespeichertest");
OHNE_RELAY.push("appearanceeditortest");
OHNE_RELAY.push("uisoundtest");
OHNE_RELAY.push("genautest");
OHNE_RELAY.push("hlsankertest");
OHNE_RELAY.push("herodetailtest");
OHNE_RELAY.push("herometadatentest");
OHNE_RELAY.push("relaystarttest");
OHNE_RELAY.push("hostgnadetest");
OHNE_RELAY.push("startnachladetest");
OHNE_RELAY.push("adblockworkertest");
OHNE_RELAY.push("securitytest");
OHNE_RELAY.push("spielerchatzustandtest");
OHNE_RELAY.push("watchpartypersistenztest");
OHNE_RELAY.push("youtubestarttest");
OHNE_RELAY.push("youtubeteilnehmeranbindungtest");
OHNE_RELAY.push("sponsorblockpartytest");
OHNE_RELAY.push("youtubezusatzracentest");
OHNE_RELAY.push("folgenbarrieretest");
OHNE_RELAY.push("skipsegmentetest");
OHNE_RELAY.push("skipintegrationtest");
OHNE_RELAY.push("untertitelwahltest");
OHNE_RELAY.push("searchgroupingtest");
OHNE_RELAY.push("spielervorschautest");
OHNE_RELAY.push("cache-schreibaufschubtest");
OHNE_RELAY.push("watchpartyabfragetest");
OHNE_RELAY.push("spoilerschutztest");
OHNE_RELAY.push("raumqueuetest");
OHNE_RELAY.push("raumqueueintegrationtest");
OHNE_RELAY.push("raumwarteschlangetest");
OHNE_RELAY.push("queueclienttest");
OHNE_RELAY.push("queuefirsttitletest");
OHNE_RELAY.push("queuecancellationtest");
OHNE_RELAY.push("youtubequeueracetest");
OHNE_RELAY.push("search-coordinatortest");
OHNE_RELAY.push("searchintegrationtest");
OHNE_RELAY.push("search-renderer-racetest");
OHNE_RELAY.push("cache-schreibarbeitertest");
OHNE_RELAY.push("autominispielertest");
OHNE_RELAY.push("miniplayerpresencetest");
OHNE_RELAY.push("gesehenmarkierungtest");
// Bringt sein eigenes Relay mit, weil es das zwischendurch anhalten muss:
// geprueft wird, was ein Neustart aus der Ablage wieder hochholt.
OHNE_RELAY.push("nachziehneustarttest");
const MIT_RELAY = ["hosttest", "partytest", "raumkontotest", "synctest", "drifttest", "ytpartytest", "chattest", "geraetetest", "geraeteandroidtest", "sitzungentest", "mitschauentest", "androidwatchpartytest", "direktpartytest", "tempotest", "watchpartymatrixtest", "watchpartyarchivtest", "hostautoritaettest", "hostbleibttest", "ferntest", "joinruecksturztest", "nichthoststelletest", "nachziehentest", "nachhaltentest", "statusseitetest", "statusleistetest", "standbildtest"];
MIT_RELAY.push("seekframealignmenttest");
MIT_RELAY.push("relayidentitytest");
MIT_RELAY.push("barrierleavetest");
MIT_RELAY.push("barrierstarttest");
MIT_RELAY.push("introskiptest");
MIT_RELAY.push("mitgliederaufraeumtest");
MIT_RELAY.push("queuerelaytest");

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

function laufen(datei, umgebung) {
  const ergebnis = spawnSync(process.execPath, [path.join(HIER, `${datei}.js`)], {
    encoding: "utf8",
    env: { ...process.env, ...umgebung }
  });
  const zeilen = String(ergebnis.stdout || "").trim().split("\n");
  const letzte = zeilen[zeilen.length - 1] || "";
  const fehler = String(ergebnis.stdout || "").split("\n").filter((z) => z.startsWith("FAIL"));
  if (ergebnis.status !== 0 && ergebnis.stderr) fehler.push(String(ergebnis.stderr).trim());
  return { ok: ergebnis.status === 0, zusammenfassung: letzte, fehler, ausgabe: ergebnis.stdout };
}

/** Antwortet auf diesem Port ein Relay? Ohne Ausnahme nach aussen. */
function gesund(port) {
  return new Promise((fertig) => {
    const anfrage = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 500 }, (antwort) => {
      antwort.resume();
      fertig(antwort.statusCode === 200);
    });
    anfrage.on("error", () => fertig(false));
    anfrage.on("timeout", () => { anfrage.destroy(); fertig(false); });
  });
}

async function freierPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function warteAufRelay(port, frist, abbruch, bereit) {
  const bis = Date.now() + frist;
  while (Date.now() < bis) {
    if (abbruch && abbruch()) return false;
    if (bereit() && await gesund(port)) return true;
    await schlaf(100);
  }
  return false;
}

async function warteAufStille(port, frist) {
  const bis = Date.now() + frist;
  while (Date.now() < bis) {
    if (!(await gesund(port))) return true;
    await schlaf(100);
  }
  return false;
}

(async () => {
  const auswahl = new Set(process.argv.slice(2));
  const gewaehlt = (name) => !auswahl.size || auswahl.has(name);
  const ablage = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-tests-"));
  let alleOk = true;

  for (const datei of OHNE_RELAY.filter(gewaehlt)) {
    const r = laufen(datei, {});
    if (!r.ok) alleOk = false;
    console.log(`${r.ok ? "ok  " : "FEHL"}  ${datei.padEnd(14)} ${r.zusammenfassung}`);
    for (const zeile of r.fehler) console.log(`        ${zeile}`);
  }

  // Ohne die Abhaengigkeit des Relays laufen diese Suiten nicht. Das ist kein
  // Fehlschlag - es fehlt schlicht das Werkzeug. Gemeldet wird es trotzdem
  // deutlich, sonst faellt die Abdeckung still weg.
  const relayDa = fs.existsSync(path.join(HIER, "..", "..", "sync-server", "node_modules", "ws"));
  if (!relayDa) {
    console.log("");
    console.log("uebersprungen: " + MIT_RELAY.join(", "));
    console.log("  Diese Pruefungen brauchen ein laufendes Relay.");
    console.log("  Einmalig einrichten:  cd sync-server && npm ci");
  }

  for (const datei of relayDa ? MIT_RELAY.filter(gewaehlt) : []) {
    // Parallele Testlaeufe duerfen niemals dieselben Raeume benutzen.
    const port = PORT || await freierPort();
    // Frischer Server je Suite - sonst faerbt der Zustand des vorigen ab.
    for (const rest of fs.readdirSync(ablage)) fs.rmSync(path.join(ablage, rest), { force: true });
    const server = spawn(process.execPath, [RELAY], {
      env: { ...process.env, PORT: String(port), STATE_DIRECTORY: ablage },
      stdio: ["ignore", "pipe", "pipe"]
    });
    // Ob es wirklich *dieses* Relay ist, das gleich antwortet.
    //
    // Liegt auf dem Port schon eines - ein liegengebliebenes aus einem
    // abgebrochenen Lauf, ein von Hand gestartetes -, dann bekommt der frisch
    // gestartete Prozess EADDRINUSE und beendet sich sofort. Die Pruefungen
    // laufen danach klaglos weiter, nur eben gegen fremden Code und fremden
    // Zustand. Genau so kamen am 4.9.2026 Fehlschlaege zustande, die es im
    // Quelltext gar nicht gab: ein Relay von vor einer Stunde beantwortete
    // Nachrichten nach den Regeln von vor einer Stunde.
    //
    // Ein toter Kindprozess ist der eindeutige Hinweis darauf. Er wird hier
    // gemeldet und nicht verschwiegen: ein Lauf gegen ein fremdes Relay ist
    // kein Lauf.
    let gestorben = false;
    let gestartet = false;
    let ausgabe = "";
    let startFehler = "";
    // /health allein reicht nicht: spawnSync blockiert spaeter das exit-Event,
    // waehrend ein fremdes Relay auf einem belegten Port schon antwortet.
    server.stdout.on("data", data => {
      ausgabe = (ausgabe + String(data)).slice(-4096);
      if (ausgabe.includes(`auf Port ${port} (Ablage:`)) gestartet = true;
    });
    server.stderr.on("data", data => { startFehler = (startFehler + String(data)).slice(-2048); });
    server.on("error", error => { gestorben = true; startFehler = error.message; });
    server.on("exit", () => { gestorben = true; });
    // Gewartet wird auf eine Antwort und nicht auf die Uhr.
    //
    // Hier stand eine feste Pause. Sie war mal zu lang und mal zu kurz: auf
    // einer belasteten Maschine braucht das Relay laenger, und die ersten
    // Nachrichten einer Suite liefen dann ins Leere - sichtbar als
    // Fehlschlaege, die bei jedem Lauf woanders auftauchten und in der
    // Einzelpruefung nie.
    const antwortet = await warteAufRelay(port, 8000, () => gestorben, () => gestartet);
    if (gestorben || !antwortet) {
      console.log(`FEHL  ${datei.padEnd(14)} Relay auf Port ${port} kam nicht hoch`);
      console.log(gestorben
        ? `        Eigener Relay-Prozess beendet: ${startFehler.trim().split("\n").slice(0, 3).join(" ")}`
        : "        Es hat acht Sekunden lang nicht geantwortet.");
      alleOk = false;
      server.kill();
      continue;
    }
    // Die Ablage kommt mit: geraetetest sieht dort nach, was das Relay
    // wirklich auf die Platte schreibt - und vor allem, was nicht.
    const testUmgebung = { TESTPORT: String(port), STATE_DIRECTORY: ablage };
    const echteIdentitaetsUndBarriereTests = new Set([
      "relayidentitytest", "mitschauentest", "direktpartytest", "watchpartymatrixtest",
      "barrierleavetest", "barrierstarttest", "mitgliederaufraeumtest"
    ]);
    if (!echteIdentitaetsUndBarriereTests.has(datei)) {
      const bootstrap = `./${path.relative(process.cwd(), RELAY_TEST_IDENTITAET).replace(/\\/g, "/")}`;
      testUmgebung.NODE_OPTIONS = [process.env.NODE_OPTIONS || "", `--require=${bootstrap}`]
        .filter(Boolean).join(" ");
    }
    const r = laufen(datei, testUmgebung);
    server.kill();
    // Und beim Abraeumen ebenso: erst wenn der Port wieder still ist, darf die
    // naechste Suite ihr eigenes Relay dorthin stellen. Sonst bekommt es
    // EADDRINUSE, beendet sich - und die Suite prueft den Zustand der vorigen.
    await warteAufStille(port, 8000);
    if (!r.ok) alleOk = false;
    console.log(`${r.ok ? "ok  " : "FEHL"}  ${datei.padEnd(14)} ${r.zusammenfassung}`);
    for (const zeile of r.fehler) console.log(`        ${zeile}`);
  }

  fs.rmSync(ablage, { recursive: true, force: true });
  console.log(alleOk ? "\nAlle Pruefungen bestanden." : "\nEs sind Pruefungen fehlgeschlagen.");
  process.exit(alleOk ? 0 : 1);
})();
