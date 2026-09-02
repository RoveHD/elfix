"use strict";

/*
 * Das Relay als eigenstaendiges Programm.
 *
 * --- Warum ueberhaupt ---------------------------------------------------------
 *
 * Bis hierher war das Relay ein Ordner mit Quelltext: Node installieren,
 * `npm ci`, `node server.js`, systemd-Vorlage von Hand anpassen. Das ist fuer
 * einen Server in Ordnung und fuer jeden anderen eine Huerde - und wer die
 * Watchparty benutzen will, muss das Relay betreiben.
 *
 * Heraus kommt deshalb eine einzelne Datei, die ohne Node laeuft:
 * `ELFIX-Relay-<fassung>-win-x64.exe` und `ELFIX-Relay-<fassung>-linux-x64`,
 * dazu unter Linux ein `.deb`, das den Dienst gleich einrichtet.
 *
 * --- Wie ----------------------------------------------------------------------
 *
 * In drei Schritten, alle mit Bordmitteln:
 *
 *   1. esbuild macht aus server.js und seinen Modulen eine Datei. Die einzige
 *      Abhaengigkeit (`ws`) wandert mit hinein.
 *   2. `node --experimental-sea-config` macht daraus einen Blob.
 *   3. postject spritzt den Blob in eine Kopie der Node-Binaerdatei.
 *
 * Das ist der offizielle Weg (Single Executable Applications, Node 20+). Er
 * bringt keine neue Laufzeitabhaengigkeit mit: was hier gebraucht wird, ist
 * Node selbst, und das steht auf jedem Baurechner ohnehin.
 *
 * --- Warum die Fassung hineingebacken wird ------------------------------------
 *
 * Das Relay soll sich selbst aktualisieren (siehe aktualisierung.js), und dafuer
 * muss es wissen, welche Fassung es ist. Aus package.json zu lesen geht nicht:
 * in der fertigen Datei gibt es keine. Also wird sie beim Bauen eingesetzt.
 *
 * Aufruf:
 *
 *   node bauen.js --fassung 1.61.0            # nur die Binaerdatei
 *   node bauen.js --fassung 1.61.0 --deb      # zusaetzlich das .deb (nur Linux)
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

// Der Helfer fuer die Statusleiste und seine beiden Symbole. Im Paket liegen
// sie als Dateien: unter systemd laeuft das Relay ohne Sitzung und kann sie
// nicht selbst hinlegen - das Symbol gehoert in die Leiste des angemeldeten
// Benutzers, nicht in die des Dienstkontos.
const statusleiste = require("./statusleiste");

const WURZEL = __dirname;
const DIST = path.join(WURZEL, "dist");

function argument(name, vorgabe = "") {
  const stelle = process.argv.indexOf(`--${name}`);
  if (stelle < 0) return vorgabe;
  const wert = process.argv[stelle + 1];
  return wert && !wert.startsWith("--") ? wert : "true";
}

function hatSchalter(name) {
  return process.argv.includes(`--${name}`);
}

/** Wie die Zielplattform in einem Dateinamen heisst. */
function plattform() {
  const art = os.platform() === "win32" ? "win" : os.platform() === "darwin" ? "mac" : "linux";
  const bogen = os.arch() === "arm64" ? "arm64" : "x64";
  return `${art}-${bogen}`;
}

/**
 * esbuild finden.
 *
 * <p>Es liegt in den Abhaengigkeiten der Desktop-App - dieselbe Fassung, mit der
 * auch der Android-Kern gebuendelt wird. Ein zweites esbuild fuer diesen einen
 * Zweck zu installieren waere eine zweite Fassung derselben Sache.
 */
function esbuildPfad() {
  // Der Einstieg des Pakets, nicht der Starter aus .bin: das ist unter Windows
  // eine .cmd, und die laesst sich seit Node 20 nicht mehr ohne Shell
  // ausfuehren (EINVAL). Der Einstieg ist ein Skript und laeuft ueberall
  // gleich - node davor, fertig.
  const kandidaten = [
    path.join(WURZEL, "..", "StreamingBrowserElectron", "node_modules", "esbuild", "bin", "esbuild"),
    path.join(WURZEL, "node_modules", "esbuild", "bin", "esbuild")
  ];
  for (const pfad of kandidaten) {
    if (fs.existsSync(pfad)) return pfad;
  }
  throw new Error("esbuild nicht gefunden - erst `npm ci` in StreamingBrowserElectron");
}

function schritt(text) {
  console.log(`[BAUEN] ${text}`);
}

function bauen() {
  const fassung = argument("fassung", "0.0.0");
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  // 1. Buendeln.
  schritt(`Buendeln (Fassung ${fassung})`);
  const gebuendelt = path.join(DIST, "relay.cjs");
  execFileSync(process.execPath, [
    esbuildPfad(),
    path.join(WURZEL, "server.js"),
    "--bundle",
    "--platform=node",
    "--target=node20",
    `--outfile=${gebuendelt}`,
    // Die Fassung als Konstante hinein. Sie steht danach in der fertigen
    // Datei und wird von der Selbstaktualisierung gelesen.
    // JSON.stringify liefert die Anfuehrungszeichen schon mit - sie noch
    // einmal in Hochkommata zu setzen, machte aus der Fassung den Text
    // "1.62.0" *samt* Anfuehrungszeichen. Die Startzeile sah dann richtig
    // aus, und die Selbstaktualisierung fand trotzdem keine Fassung.
    // Ohne Shell dazwischen braucht es keine Hochkommata.
    `--define:process.env.ELFIX_RELAY_FASSUNG=${JSON.stringify(fassung)}`,
    "--log-level=warning"
  ], { stdio: "inherit" });

  // 2. Den Blob.
  schritt("SEA-Blob");
  const seaJson = path.join(DIST, "sea.json");
  fs.writeFileSync(seaJson, JSON.stringify({
    main: "relay.cjs",
    output: "sea-prep.blob",
    disableExperimentalSEAWarning: true
  }, null, 2));
  execFileSync(process.execPath, ["--experimental-sea-config", "sea.json"],
    { cwd: DIST, stdio: "inherit" });

  // 3. Einspritzen.
  const name = os.platform() === "win32"
    ? `ELFIX-Relay-${fassung}-${plattform()}.exe`
    : `ELFIX-Relay-${fassung}-${plattform()}`;
  const ziel = path.join(DIST, name);
  schritt(`Node kopieren nach ${name}`);
  fs.copyFileSync(process.execPath, ziel);
  if (os.platform() !== "win32") fs.chmodSync(ziel, 0o755);

  schritt("Blob einspritzen");
  // Im Zielordner und mit relativen Namen.
  //
  // npx ist unter Windows eine .cmd und braucht deshalb eine Shell - und eine
  // Shell zerlegt Pfade mit Leerzeichen. Der Ordner dieses Projekts hat
  // welche ("Serien Filme und Animes"), und postject bekam davon nur das
  // erste Stueck zu sehen ("Can't read resource file"). Relative Namen haben
  // keine Leerzeichen, und damit stellt sich die Frage nicht.
  //
  // Auf macOS muesste die Signatur weg und danach wieder dran; gebaut wird
  // hier nur fuer Windows und Linux, deshalb steht das nicht drin.
  execFileSync("npx", [
    "--yes", "postject@1.0.0-alpha.6", path.basename(ziel), "NODE_SEA_BLOB",
    "sea-prep.blob",
    "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
  ], { stdio: "inherit", shell: true, cwd: DIST });

  const groesse = Math.round(fs.statSync(ziel).size / 1024 / 1024);
  schritt(`fertig: ${name} (${groesse} MB)`);

  if (hatSchalter("deb")) debBauen(fassung, ziel);
  return ziel;
}

/**
 * Ein .deb daraus.
 *
 * <p>Von Hand gebaut, nicht ueber ein Werkzeug: ein Debian-Paket ist ein
 * ar-Archiv aus drei Dateien, und `dpkg-deb` baut es aus einem Ordner. Ein
 * Paketierer als Abhaengigkeit waere fuer diese eine Datei zu viel.
 *
 * <p>Das Paket bringt die Binaerdatei, die systemd-Einheit und einen Benutzer
 * mit, unter dem der Dienst laeuft. Nach der Installation laeuft er.
 */
function debBauen(fassung, binaer) {
  if (os.platform() !== "linux") {
    schritt("Debian-Paket uebersprungen - das geht nur unter Linux (dpkg-deb)");
    return;
  }
  schritt("Debian-Paket");
  const bau = path.join(DIST, "deb");
  const legen = (unterordner) => {
    const voll = path.join(bau, unterordner);
    fs.mkdirSync(voll, { recursive: true });
    return voll;
  };
  legen("DEBIAN");
  legen("usr/bin");
  legen("lib/systemd/system");
  legen("usr/lib/elfix-relay");
  legen("usr/share/applications");
  legen("etc/xdg/autostart");

  fs.copyFileSync(binaer, path.join(bau, "usr/bin/elfix-relay"));
  fs.chmodSync(path.join(bau, "usr/bin/elfix-relay"), 0o755);

  // Die Einheit fuer das Paket - anders als die Vorlage im Repository braucht
  // sie nichts von Hand: Benutzer, Pfad und Ablage stehen fest.
  fs.writeFileSync(path.join(bau, "lib/systemd/system/elfix-relay.service"), [
    "[Unit]",
    "Description=ELFIX Watchparty-Relay",
    "Documentation=https://github.com/RoveHD/elfix",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    "ExecStart=/usr/bin/elfix-relay",
    "Environment=NODE_ENV=production",
    "Environment=PORT=8787",
    "# Der TMDB-Schluessel fuer das Metadaten-Tor. Fehlt die Datei, ist das kein",
    "# Fehler - dann fehlen nur Film- und Seriendaten.",
    "EnvironmentFile=-/etc/elfix-relay.env",
    "User=elfix-relay",
    "Group=elfix-relay",
    "StateDirectory=elfix-relay",
    "Restart=always",
    "RestartSec=5",
    "NoNewPrivileges=true",
    "PrivateTmp=true",
    "ProtectSystem=strict",
    "ProtectHome=true",
    "RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX",
    "MemoryMax=256M",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    ""
  ].join("\n"));

  // Auf welchem Port das Relay lauscht - die Frage stellt sich zweimal, fuer
  // den Menueeintrag und fuer das Symbol in der Leiste, und beide Male darf die
  // Antwort nicht einfach 8787 lauten. Wer den Port in /etc/elfix-relay.env
  // geaendert hat, bekaeme sonst eine Seite, die es nicht gibt.
  //
  // Die Datei selbst gehoert root und ist 0600 - ein angemeldeter Benutzer kann
  // sie also gar nicht lesen. Deshalb zuerst der Dienst: `systemctl show` darf
  // jeder, und es kennt die Umgebung, mit der die Einheit wirklich laeuft.
  fs.writeFileSync(path.join(bau, "usr/lib/elfix-relay/port.sh"), [
    "#!/bin/sh",
    "# Gibt den Port des Relays aus. Erst der laufende Dienst, dann die",
    "# Umgebungsdatei, sonst der Vorgabewert.",
    "aus_dienst=$(systemctl show elfix-relay -p Environment --value 2>/dev/null \\",
    "  | tr ' ' '\\n' | sed -n 's/^PORT=//p' | tail -n 1)",
    "if [ -n \"$aus_dienst\" ]; then",
    "  echo \"$aus_dienst\"",
    "  exit 0",
    "fi",
    "if [ -r /etc/elfix-relay.env ]; then",
    "  aus_datei=$(sed -n 's/^ *PORT=//p' /etc/elfix-relay.env | tr -d '\"' | tail -n 1)",
    "  if [ -n \"$aus_datei\" ]; then",
    "    echo \"$aus_datei\"",
    "    exit 0",
    "  fi",
    "fi",
    "echo 8787",
    ""
  ].join("\n"));
  fs.chmodSync(path.join(bau, "usr/lib/elfix-relay/port.sh"), 0o755);

  // Nachsehen, ob es laeuft - der Weg fuer Leute, die kein Terminal aufmachen
  // wollen.
  fs.writeFileSync(path.join(bau, "usr/bin/elfix-relay-status"), [
    "#!/bin/sh",
    "# Oeffnet die Statusseite des Relays im Browser.",
    "port=$(/usr/lib/elfix-relay/port.sh)",
    "exec xdg-open \"http://localhost:${port}/status\"",
    ""
  ].join("\n"));
  fs.chmodSync(path.join(bau, "usr/bin/elfix-relay-status"), 0o755);

  // Der Helfer fuer die Statusleiste, samt seinen beiden Punkten.
  fs.writeFileSync(path.join(bau, "usr/lib/elfix-relay/leiste.py"), statusleiste.PYTHON);
  fs.writeFileSync(path.join(bau, "usr/lib/elfix-relay/leiste-gruen.png"), statusleiste.symbol([98, 209, 154]));
  fs.writeFileSync(path.join(bau, "usr/lib/elfix-relay/leiste-rot.png"), statusleiste.symbol([255, 138, 138]));

  // Und der Starter dazu. Er steht hier und nicht in der Autostart-Datei, weil
  // der Port erst nachgesehen werden muss - eine Desktop-Datei kann das nicht.
  fs.writeFileSync(path.join(bau, "usr/lib/elfix-relay/leiste-starten"), [
    "#!/bin/sh",
    "# Startet das Symbol in der Statusleiste. Ohne --pid: es haengt an keinem",
    "# Prozess, sondern fragt /health - der Dienst laeuft unter systemd und",
    "# ueberdauert jede Sitzung.",
    "port=$(/usr/lib/elfix-relay/port.sh)",
    "exec /usr/bin/python3 /usr/lib/elfix-relay/leiste.py \\",
    "  --port \"$port\" \\",
    "  --gruen /usr/lib/elfix-relay/leiste-gruen.png \\",
    "  --rot /usr/lib/elfix-relay/leiste-rot.png",
    ""
  ].join("\n"));
  fs.chmodSync(path.join(bau, "usr/lib/elfix-relay/leiste-starten"), 0o755);

  // Im Anwendungsmenue, damit "laeuft es?" eine Antwort hat, die man anklicken
  // kann.
  fs.writeFileSync(path.join(bau, "usr/share/applications/elfix-relay.desktop"), [
    "[Desktop Entry]",
    "Type=Application",
    "Name=ELFIX Relay",
    "Comment=Zeigt, ob das Relay laeuft",
    "Exec=/usr/bin/elfix-relay-status",
    "Icon=/usr/lib/elfix-relay/leiste-gruen.png",
    "Terminal=false",
    "Categories=Network;Utility;",
    "Keywords=ELFIX;Watchparty;Relay;",
    ""
  ].join("\n"));

  // Und in der Statusleiste jeder Sitzung.
  //
  // Der Aufruf haelt selbst still, wenn python3-gi fehlt: dann gibt es kein
  // Symbol und sonst nichts.
  fs.writeFileSync(path.join(bau, "etc/xdg/autostart/elfix-relay-leiste.desktop"), [
    "[Desktop Entry]",
    "Type=Application",
    "Name=ELFIX Relay (Statusleiste)",
    "Comment=Zeigt in der Leiste, ob das Relay laeuft",
    "Exec=/usr/lib/elfix-relay/leiste-starten",
    "Icon=/usr/lib/elfix-relay/leiste-gruen.png",
    "Terminal=false",
    "NoDisplay=true",
    "X-GNOME-Autostart-enabled=true",
    ""
  ].join("\n"));

  fs.writeFileSync(path.join(bau, "DEBIAN/control"), [
    "Package: elfix-relay",
    `Version: ${fassung}`,
    "Section: net",
    "Priority: optional",
    "Architecture: amd64",
    "Maintainer: RoveHD <https://github.com/RoveHD/elfix>",
    "Description: ELFIX Watchparty-Relay",
    " Kleines Relay, ueber das ELFIX-Geraete ihren Weiterschauen-Fortschritt",
    " teilen. Bringt seine eigene Laufzeit mit und braucht kein Node.",
    ""
  ].join("\n"));

  // Benutzer anlegen und den Dienst starten. `set -e` steht bewusst nicht da:
  // schlaegt ein Schritt fehl, soll die Installation trotzdem zu Ende gehen -
  // ein Dienst, der nicht startet, ist besser als ein halb entpacktes Paket.
  fs.writeFileSync(path.join(bau, "DEBIAN/postinst"), [
    "#!/bin/sh",
    "if ! getent passwd elfix-relay >/dev/null; then",
    "  useradd --system --no-create-home --shell /usr/sbin/nologin elfix-relay || true",
    "fi",
    "systemctl daemon-reload || true",
    "systemctl enable --now elfix-relay || true",
    "# Und sagen, was daraus geworden ist. Wer ein Paket installiert, bekommt",
    "# sonst nur \"Entpacken...\" zu lesen und weiss nicht, ob der Dienst laeuft.",
    "sleep 1",
    "if systemctl is-active --quiet elfix-relay; then",
    "  echo \"\"",
    "  echo \"ELFIX Relay laeuft.\"",
    "  echo \"  Nachsehen:      http://localhost:8787/status\"",
    "  echo \"  Im Menue:       ELFIX Relay\"",
    "  echo \"  In der Leiste:  ab der naechsten Anmeldung ein Punkt - gruen heisst laeuft\"",
    "  echo \"\"",
    "else",
    "  echo \"\"",
    "  echo \"ELFIX Relay wurde eingerichtet, laeuft aber noch nicht.\"",
    "  echo \"  Nachsehen: systemctl status elfix-relay\"",
    "  echo \"\"",
    "fi",
    "exit 0",
    ""
  ].join("\n"));
  fs.chmodSync(path.join(bau, "DEBIAN/postinst"), 0o755);

  fs.writeFileSync(path.join(bau, "DEBIAN/prerm"), [
    "#!/bin/sh",
    "if [ \"$1\" = remove ]; then",
    "  systemctl disable --now elfix-relay || true",
    "fi",
    "exit 0",
    ""
  ].join("\n"));
  fs.chmodSync(path.join(bau, "DEBIAN/prerm"), 0o755);

  const debName = `ELFIX-Relay-${fassung}-amd64.deb`;
  execFileSync("dpkg-deb", ["--build", "--root-owner-group", bau, path.join(DIST, debName)],
    { stdio: "inherit" });
  schritt(`fertig: ${debName}`);
}

if (require.main === module) {
  try {
    bauen();
  } catch (fehler) {
    console.error("[BAUEN] fehlgeschlagen:", fehler?.message || fehler);
    process.exit(1);
  }
}

// debBauen ist ausgestellt, damit die Pruefungen das Paket wirklich bauen und
// hineinsehen koennen - ob Menueeintrag, Autostart und Helfer darin liegen,
// sieht man einem Quelltext nicht an.
module.exports = { plattform, debBauen };
