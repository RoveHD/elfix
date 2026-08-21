"use strict";

// Alle Pruefungen der Reihe nach.
//
// Vier davon brauchen ein laufendes Relay - sie pruefen das Zusammenspiel
// zweier Geraete, und genau dort sassen die Fehler, die "node --check" nie
// gesehen hat. Der Server wird je Suite frisch gestartet, damit kein Zustand
// aus dem vorigen Durchlauf hineinredet.

const { spawn, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const HIER = __dirname;
const RELAY = path.join(HIER, "..", "..", "sync-server", "server.js");
const PORT = Number(process.env.TESTPORT) || 8791;

// Ohne Relay: reine Rechenpruefungen.
const OHNE_RELAY = ["kalendertest", "datumtest", "standtest", "knopftest", "synclogiktest", "playertest", "sicherungtest", "titeltest", "empfehlungtest", "begruendungtest", "katalogtest", "metadatentest", "gatewaytest", "externtest", "profiltest", "kacheltest", "leistetest", "mediathektest", "suchetest", "ausschnitttest", "hinweistest", "adblocktest", "verifizierungtest", "youtubetest", "youtubesynctest", "ytleistetest", "wiedergabetest", "anbietermenuetest", "mediathektabtest", "anbieternachtragtest", "autoplaytest", "rueckblicktest", "wrappedtest", "qualitaettest", "schaltertest"];
// Mit Relay: das Zusammenspiel.
const MIT_RELAY = ["hosttest", "partytest", "synctest", "drifttest", "ytpartytest", "chattest"];

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
    await schlaf(1200);
    const r = laufen(datei, { TESTPORT: String(PORT) });
    server.kill();
    await schlaf(200);
    if (!r.ok) alleOk = false;
    console.log(`${r.ok ? "ok  " : "FEHL"}  ${datei.padEnd(14)} ${r.zusammenfassung}`);
    for (const zeile of r.fehler) console.log(`        ${zeile}`);
  }

  fs.rmSync(ablage, { recursive: true, force: true });
  console.log(alleOk ? "\nAlle Pruefungen bestanden." : "\nEs sind Pruefungen fehlgeschlagen.");
  process.exit(alleOk ? 0 : 1);
})();
