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

const HIER = __dirname;
const RELAY = path.join(HIER, "..", "..", "sync-server", "server.js");
const PORT = Number(process.env.TESTPORT) || 8791;

// Ohne Relay: reine Rechenpruefungen.
const OHNE_RELAY = ["kalendertest", "datumtest", "standtest", "fortschritttest", "brueckentest", "knotentest", "knopftest", "synclogiktest", "playertest", "sicherungtest", "titeltest", "empfehlungtest", "empfehlungslauftest", "begruendungtest", "katalogtest", "metadatentest", "gatewaytest", "externtest", "profiltest", "kacheltest", "leistetest", "mediathektest", "wiederansehentest", "watchlisttest", "verlauftest", "suchetest", "ausschnitttest", "hinweistest", "adblocktest", "verifizierungtest", "youtubetest", "youtubesynctest", "ytleistetest", "wiedergabetest", "anbietermenuetest", "mediathektabtest", "anbieternachtragtest", "autoplaytest", "naechstefolgetest", "rueckblicktest", "wrappedtest", "openingtest", "sponsorblocktest", "trailertest", "qualitaettest", "schaltertest", "tastentest", "umzugtest", "markentest", "fassungtest", "qrtest", "titelbildtest", "werbefiltertest", "folgenlinktest", "folgentiteltest", "uebersichttest", "relaytest", "bildnachreichungtest", "bildfallbacktest", "startknopftest", "hosterplayertest", "autostarttest", "startphasentest", "startfreigabetest", "bestandschutztest", "raumarchivtest", "nachschubtest"];
// Mit Relay: das Zusammenspiel.
const MIT_RELAY = ["hosttest", "partytest", "raumkontotest", "synctest", "drifttest", "ytpartytest", "chattest", "geraetetest", "geraeteandroidtest", "sitzungentest", "mitschauentest", "androidwatchpartytest", "watchpartymatrixtest", "watchpartyarchivtest", "hostautoritaettest", "hostbleibttest", "ferntest", "joinruecksturztest", "nichthoststelletest", "nachziehentest", "nachhaltentest", "statusseitetest", "statusleistetest"];

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

function laufen(datei, umgebung) {
  const ergebnis = spawnSync(process.execPath, [path.join(HIER, `${datei}.js`)], {
    encoding: "utf8",
    env: { ...process.env, ...umgebung }
  });
  const zeilen = String(ergebnis.stdout || "").trim().split("\n");
  const letzte = zeilen[zeilen.length - 1] || "";
  const fehler = String(ergebnis.stdout || "").split("\n").filter((z) => z.startsWith("FAIL"));
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

async function warteAufRelay(port, frist, abbruch) {
  const bis = Date.now() + frist;
  while (Date.now() < bis) {
    if (abbruch && abbruch()) return false;
    if (await gesund(port)) return true;
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
  const ablage = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-tests-"));
  let alleOk = true;

  for (const datei of OHNE_RELAY) {
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

  for (const datei of relayDa ? MIT_RELAY : []) {
    // Frischer Server je Suite - sonst faerbt der Zustand des vorigen ab.
    for (const rest of fs.readdirSync(ablage)) fs.rmSync(path.join(ablage, rest), { force: true });
    const server = spawn(process.execPath, [RELAY], {
      env: { ...process.env, PORT: String(PORT), STATE_DIRECTORY: ablage },
      stdio: "ignore"
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
    server.on("exit", () => { gestorben = true; });
    // Gewartet wird auf eine Antwort und nicht auf die Uhr.
    //
    // Hier stand eine feste Pause. Sie war mal zu lang und mal zu kurz: auf
    // einer belasteten Maschine braucht das Relay laenger, und die ersten
    // Nachrichten einer Suite liefen dann ins Leere - sichtbar als
    // Fehlschlaege, die bei jedem Lauf woanders auftauchten und in der
    // Einzelpruefung nie.
    const antwortet = await warteAufRelay(PORT, 8000, () => gestorben);
    if (gestorben || !antwortet) {
      console.log(`FEHL  ${datei.padEnd(14)} Relay auf Port ${PORT} kam nicht hoch`);
      console.log(gestorben
        ? "        Dort laeuft schon eines. Beenden, sonst pruefen die Tests fremden Code."
        : "        Es hat acht Sekunden lang nicht geantwortet.");
      alleOk = false;
      server.kill();
      continue;
    }
    // Die Ablage kommt mit: geraetetest sieht dort nach, was das Relay
    // wirklich auf die Platte schreibt - und vor allem, was nicht.
    const r = laufen(datei, { TESTPORT: String(PORT), STATE_DIRECTORY: ablage });
    server.kill();
    // Und beim Abraeumen ebenso: erst wenn der Port wieder still ist, darf die
    // naechste Suite ihr eigenes Relay dorthin stellen. Sonst bekommt es
    // EADDRINUSE, beendet sich - und die Suite prueft den Zustand der vorigen.
    await warteAufStille(PORT, 8000);
    if (!r.ok) alleOk = false;
    console.log(`${r.ok ? "ok  " : "FEHL"}  ${datei.padEnd(14)} ${r.zusammenfassung}`);
    for (const zeile of r.fehler) console.log(`        ${zeile}`);
  }

  fs.rmSync(ablage, { recursive: true, force: true });
  console.log(alleOk ? "\nAlle Pruefungen bestanden." : "\nEs sind Pruefungen fehlgeschlagen.");
  process.exit(alleOk ? 0 : 1);
})();
