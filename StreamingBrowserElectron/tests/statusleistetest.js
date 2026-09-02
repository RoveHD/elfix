"use strict";
// Das Relay in der Statusleiste - und die Seite beim ersten Start.
//
// Zwei Dinge, die man dem Quelltext nicht ansieht und die trotzdem genau dann
// stimmen muessen, wenn niemand hinsieht: *wann* ein Symbol erscheinen darf
// (nicht unter systemd, nicht ohne Bildschirm, nicht aus dem Quelltext) und ob
// der Helfer, der es zeigt, ueberhaupt laeuft.
//
// Der Linux-Helfer wird deshalb hier wirklich ausgefuehrt - gegen das echte
// Relay, mit einer Attrappe an der Stelle von GTK. Was er dabei anzeigen
// wuerde, steht danach als Protokoll da: gruen mit Zahlen, wenn das Relay
// antwortet, rot wenn nicht, und Schluss, wenn das Relay weg ist.
//
// Der Windows-Helfer laesst sich hier nicht ausfuehren - PowerShell gibt es auf
// dieser Maschine nicht. Von ihm wird geprueft, was sich lesen laesst: dass er
// dasselbe /health fragt, das Symbol wechselt und sich mit dem Relay beendet.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const statusleiste = require("../../sync-server/statusleiste");
const seiteZeigen = require("../../sync-server/seite-zeigen");

const PORT = Number(process.env.TESTPORT) || 8799;

const pruefungen = [];
const pruefe = (name, bedingung, detail) => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

const ablage = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-leiste-"));

// --- Wann ueberhaupt ein Symbol erscheint ------------------------------------

const linux = { gepackt: true, plattform: "linux", umgebung: { DISPLAY: ":0" } };

pruefe("Auf einem Schreibtisch-Linux erscheint es",
  statusleiste.darfLaufen(linux));
pruefe("Unter Wayland auch",
  statusleiste.darfLaufen({ ...linux, umgebung: { WAYLAND_DISPLAY: "wayland-0" } }));
pruefe("Unter Windows immer",
  statusleiste.darfLaufen({ gepackt: true, plattform: "win32", umgebung: {} }));
pruefe("Ohne Bildschirm nicht",
  !statusleiste.darfLaufen({ ...linux, umgebung: {} }),
  "auf einem Server im Rechenzentrum waere xdg-open ein Aufruf ins Leere");
pruefe("Unter systemd nicht",
  !statusleiste.darfLaufen({ ...linux, umgebung: { DISPLAY: ":0", INVOCATION_ID: "abc" } }),
  "der Dienst laeuft unter einem Konto ohne Sitzung - in wessen Leiste denn?");
pruefe("Aus dem Quelltext nicht",
  !statusleiste.darfLaufen({ ...linux, gepackt: false }),
  "wer node server.js tippt, will kein Symbol beim Entwickeln");
pruefe("Und abgeschaltet nicht",
  !statusleiste.darfLaufen({ ...linux, umgebung: { DISPLAY: ":0", ELFIX_RELAY_LEISTE: "0" } }));

// --- Womit es gestartet wird -------------------------------------------------

const winAufruf = statusleiste.aufruf({
  plattform: "win32", skript: "C:\\\\leiste.ps1", gruen: "g.png", rot: "r.png", port: 8787, pid: 42
});
pruefe("Windows startet PowerShell ohne Fenster",
  winAufruf.datei === "powershell.exe"
  && winAufruf.args.includes("-WindowStyle") && winAufruf.args.includes("Hidden"),
  winAufruf.args.join(" "));
pruefe("Und gibt ihm Port, Prozess und beide Symbole mit",
  winAufruf.args.includes("-Port") && winAufruf.args.includes("8787")
  && winAufruf.args.includes("-ElternPid") && winAufruf.args.includes("42")
  && winAufruf.args.includes("g.png") && winAufruf.args.includes("r.png"));

const linuxAufruf = statusleiste.aufruf({
  plattform: "linux", skript: "/tmp/leiste.py", gruen: "g.png", rot: "r.png", port: 8787, pid: 42
});
pruefe("Linux startet python3 mit demselben",
  linuxAufruf.datei === "python3" && linuxAufruf.args[0] === "/tmp/leiste.py"
  && linuxAufruf.args.includes("--port") && linuxAufruf.args.includes("--gruen"),
  linuxAufruf.args.join(" "));

// --- Die beiden Punkte -------------------------------------------------------

const gruenesBild = statusleiste.symbol([98, 209, 154]);
pruefe("Das Symbol ist ein PNG",
  gruenesBild.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
pruefe("Es ist 64 mal 64 gross",
  gruenesBild.readUInt32BE(16) === 64 && gruenesBild.readUInt32BE(20) === 64);
pruefe("Und der Punkt ist wirklich rund",
  // Mitte deckend, Ecke durchsichtig - sonst waere es ein Quadrat.
  gruenesBild.length > 200 && !statusleiste.symbol([255, 138, 138]).equals(gruenesBild),
  "gruen und rot muessen sich unterscheiden, sonst zeigt die Leiste nichts an");

const gelegt = statusleiste.ablegen(ablage, "linux");
pruefe("Helfer und Symbole liegen in der Ablage",
  fs.existsSync(gelegt.skript) && fs.existsSync(gelegt.gruen) && fs.existsSync(gelegt.rot),
  path.basename(gelegt.skript));

// --- Der Windows-Helfer, soweit lesbar ---------------------------------------

const ps = statusleiste.POWERSHELL;
pruefe("Windows bekommt ein Symbol in die Leiste",
  ps.includes("System.Windows.Forms.NotifyIcon") && ps.includes("$leiste.Visible = $true"));
pruefe("Es sagt beim Start einmal Bescheid",
  ps.includes("ShowBalloonTip"),
  "der eine Moment, in dem die Meldung erwuenscht ist: gerade installiert");
pruefe("Es fragt dasselbe /health wie die Seite",
  ps.includes("$adresse/health") && ps.includes("Invoke-WebRequest"));
pruefe("Es wechselt das Symbol, wenn keine Antwort kommt",
  ps.includes("$leiste.Icon = $symbolWeg"));
pruefe("Ein Klick oeffnet die Statusseite",
  ps.includes("add_DoubleClick") && ps.includes("$adresse/status"));
pruefe("Und mit dem Relay geht auch das Symbol",
  ps.includes("Get-Process -Id $ElternPid") && ps.includes("$leiste.Visible = $false"),
  "sonst bleibt ein Punkt in der Leiste stehen, hinter dem nichts mehr ist");

// --- Der Linux-Helfer, wirklich ausgefuehrt ----------------------------------

// Eine Attrappe an der Stelle von GTK. Sie schreibt auf, was der Helfer
// anzeigen wuerde, statt es anzuzeigen - so laeuft die Pruefung auch dort, wo
// es keinen Bildschirm gibt.
const ATTRAPPE = `import json, types

protokoll = []

class Element:
    def __init__(self, label=None):
        self.label = label
        self.handler = {}
    def set_sensitive(self, wert): pass
    def set_label(self, wert): protokoll.append(["label", wert])
    def append(self, kind): pass
    def connect(self, name, fn): self.handler[name] = fn
    def show_all(self): pass
    def popup(self, *a): pass

class _Gtk(types.ModuleType):
    Menu = Element
    MenuItem = Element
    SeparatorMenuItem = Element
    class StatusIcon(Element):
        def set_from_file(self, pfad): protokoll.append(["bild", pfad.split("/")[-1]])
        def set_title(self, t): pass
        def set_tooltip_text(self, t): protokoll.append(["tooltip", t])
    @staticmethod
    def main():
        for fn in _GLib.takte:
            fn()
        print(json.dumps(protokoll, ensure_ascii=False))
    @staticmethod
    def main_quit(): protokoll.append(["quit", ""])

class _GLib(types.ModuleType):
    takte = []
    @staticmethod
    def timeout_add_seconds(s, fn): _GLib.takte.append(fn)

Gtk = _Gtk("Gtk")
GLib = _GLib("GLib")
`;

const python = spawnSync("python3", ["-c", "print(1)"], { encoding: "utf8" });
if (python.status !== 0) {
  console.log("--    Der Linux-Helfer wurde nicht ausgefuehrt: kein python3 auf dieser Maschine");
} else {
  const stubOrdner = path.join(ablage, "attrappe", "gi", "repository");
  fs.mkdirSync(stubOrdner, { recursive: true });
  fs.writeFileSync(path.join(ablage, "attrappe", "gi", "__init__.py"),
    "def require_version(name, ver):\n"
    + "    if name not in ('Gtk', 'GLib'):\n"
    + "        raise ValueError(name)\n");
  fs.writeFileSync(path.join(stubOrdner, "__init__.py"), ATTRAPPE);

  const laufen = (args) => spawnSync("python3", [gelegt.skript, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONPATH: path.join(ablage, "attrappe"),
      // Sonst schreibt Python unter Windows in der Codepage der Konsole, und
      // aus "Laeuft" wird auf dem Weg hierher Buchstabensalat. Der Helfer
      // selbst ist davon nicht betroffen - er schreibt nichts, er zeigt an.
      PYTHONIOENCODING: "utf-8"
    }
  });

  const uebersetzt = spawnSync("python3", ["-m", "py_compile", gelegt.skript], { encoding: "utf8" });
  pruefe("Der Linux-Helfer ist gueltiges Python", uebersetzt.status === 0,
    (uebersetzt.stderr || "").split("\n")[0]);

  const gruen = laufen(["--port", String(PORT), "--gruen", "gruen.png", "--rot", "rot.png"]);
  const gruenProtokoll = String(gruen.stdout || "");
  pruefe("Am laufenden Relay zeigt er gruen",
    gruenProtokoll.includes("gruen.png") && !gruenProtokoll.includes("rot.png"),
    gruenProtokoll.trim().slice(0, 80));
  // Auf den Inhalt geprueft und nicht auf den Wortlaut: was hier ankommt, ist
  // durch Pythons Ausgabe und Nodes Lesart gegangen, und ein Umlaut mehr oder
  // weniger auf diesem Weg sagt nichts ueber den Helfer.
  let letzteZeile = "";
  try {
    const eintraege = JSON.parse(gruenProtokoll.trim().split("\n").pop());
    letzteZeile = (eintraege.filter(([art]) => art === "label").pop() || [])[1] || "";
  } catch {
    // Bleibt leer - dann faellt die Pruefung darunter, und zwar mit dem, was
    // wirklich ankam.
  }
  pruefe("Und schreibt die Zahlen daneben",
    /\d+ Verbindungen/.test(letzteZeile) && letzteZeile.includes(String(PORT)),
    letzteZeile || gruenProtokoll.trim().slice(0, 80));

  // Ein Port, auf dem nichts lauscht - genau die Lage, wegen der es das Symbol
  // gibt.
  const rot = laufen(["--port", "8123", "--gruen", "gruen.png", "--rot", "rot.png"]);
  pruefe("Antwortet nichts, wird der Punkt rot",
    String(rot.stdout || "").includes("rot.png")
    && /Antwortet nicht/.test(String(rot.stdout || "")),
    String(rot.stdout || "").trim().slice(0, 80));

  const weg = laufen(["--port", String(PORT), "--pid", "999999", "--gruen", "g.png", "--rot", "r.png"]);
  pruefe("Ist das Relay weg, geht auch das Symbol",
    String(weg.stdout || "").includes("quit"),
    "sonst bleibt ein Punkt in der Leiste stehen, hinter dem nichts mehr ist");
}

// --- Was das Paket mitbringt --------------------------------------------------
//
// Unter systemd kann das Relay kein Symbol anzeigen - es laeuft ohne Sitzung.
// Deshalb legt das .deb den Helfer getrennt ab und startet ihn beim Anmelden.
// Gebaut wird das Paket hier nicht (dpkg-deb gibt es nur unter Linux), aber
// dass bauen.js es vorsieht, laesst sich lesen.

const BAUEN = fs.readFileSync(path.join(__dirname, "..", "..", "sync-server", "bauen.js"), "utf8");

pruefe("Das Paket bringt den Helfer mit",
  /leiste\.py"\), statusleiste\.PYTHON/.test(BAUEN) && /statusleiste\.symbol\(/.test(BAUEN),
  "sonst laege im Paket eine zweite, altere Fassung desselben Skripts");
pruefe("Es startet ihn in jeder Sitzung",
  BAUEN.includes("etc/xdg/autostart/elfix-relay-leiste.desktop")
  && BAUEN.includes("leiste-starten"));
pruefe("Und legt einen Menueeintrag an",
  BAUEN.includes("usr/share/applications/elfix-relay.desktop")
  && BAUEN.includes("elfix-relay-status"));
pruefe("Der Port wird nachgesehen und nicht geraten",
  BAUEN.includes("usr/lib/elfix-relay/port.sh") && BAUEN.includes("systemctl show elfix-relay"),
  "wer den Port geaendert hat, bekaeme sonst eine Seite, die es nicht gibt");
pruefe("Und nach dem Installieren steht da, dass es laeuft",
  BAUEN.includes("systemctl is-active --quiet elfix-relay")
  && BAUEN.includes("ELFIX Relay laeuft."),
  "wer ein Paket installiert, liest sonst nur \"Entpacken ...\"");

// --- Die Seite beim ersten Start ---------------------------------------------

const win = { gepackt: true, plattform: "win32", umgebung: {} };

pruefe("Beim ersten Start geht die Seite auf",
  seiteZeigen.darfZeigen({ ...win, ersterStart: true }));
pruefe("Beim zweiten nicht mehr",
  !seiteZeigen.darfZeigen({ ...win, ersterStart: false }),
  "ein Programm, das bei jeder Anmeldung einen Browser aufreisst, fliegt wieder herunter");
pruefe("Auf Wunsch jedes Mal",
  seiteZeigen.darfZeigen({ ...win, umgebung: { ELFIX_RELAY_SEITE: "1" }, ersterStart: false }));
pruefe("Abgeschaltet nie",
  !seiteZeigen.darfZeigen({ ...win, umgebung: { ELFIX_RELAY_SEITE: "0" }, ersterStart: true }));
pruefe("Unter systemd auch dann nicht, wenn jemand es verlangt",
  !seiteZeigen.darfZeigen({
    ...win, plattform: "linux",
    umgebung: { ELFIX_RELAY_SEITE: "1", INVOCATION_ID: "abc", DISPLAY: ":0" },
    ersterStart: true
  }),
  "dort ist kein Browser, den man aufmachen koennte");
pruefe("Aus dem Quelltext nie",
  !seiteZeigen.darfZeigen({ ...win, gepackt: false, ersterStart: true }),
  "sonst ginge bei jeder Pruefung ein Browser auf");

const markenOrdner = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-marke-"));
pruefe("Der erste Start ist der erste", seiteZeigen.ersterStart(markenOrdner));
pruefe("Und der zweite nicht mehr", !seiteZeigen.ersterStart(markenOrdner),
  "die Marke wird sofort gesetzt, auch wenn kein Browser aufgeht");
pruefe("Laesst sich nichts schreiben, gilt es als nicht der erste",
  !seiteZeigen.ersterStart(path.join(markenOrdner, "gibt-es-nicht")),
  "lieber einmal zu wenig aufgemacht als bei jedem Start");

fs.rmSync(ablage, { recursive: true, force: true });
fs.rmSync(markenOrdner, { recursive: true, force: true });

const fehlerAnzahl = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehlerAnzahl}/${pruefungen.length} bestanden`);
process.exit(fehlerAnzahl ? 1 : 0);
