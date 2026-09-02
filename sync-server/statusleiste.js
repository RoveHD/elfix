"use strict";

/*
 * Das Relay als Symbol in der Statusleiste.
 *
 * --- Warum ---------------------------------------------------------------------
 *
 * Die Statusseite beantwortet die Frage "laeuft es?", aber man muss sie
 * aufrufen. Ein Dienst, der im Hintergrund laeuft, gehoert dorthin, wo alle
 * anderen Hintergrunddienste stehen: unten in der Leiste. Ein Blick, keine
 * Adresse, kein Terminal - gruen heisst laeuft, rot heisst es antwortet nicht.
 * Ein Klick oeffnet die Statusseite.
 *
 * --- Wie, ohne eine einzige neue Abhaengigkeit ----------------------------------
 *
 * Ein Symbol in der Leiste ist Sache des Fenstersystems, und Node kann das
 * nicht. Eine Bibliothek dafuer waere eine native Abhaengigkeit - die laesst
 * sich nicht in eine SEA-Datei packen, und damit waere die eine Datei, die
 * ohne Node laeuft, wieder eine Installation.
 *
 * Deshalb macht es das, was auf der jeweiligen Maschine ohnehin da ist:
 *
 *   Windows: PowerShell mit System.Windows.Forms.NotifyIcon. Auf jedem Windows
 *            vorhanden, seit es Windows 7 gibt.
 *   Linux:   python3 mit GTK (AppIndicator, sonst Gtk.StatusIcon). Auf jedem
 *            Schreibtisch-Linux vorhanden - Cinnamon, GNOME und Xfce sind
 *            selbst damit gebaut.
 *
 * Beide Helfer stehen hier als Zeichenkette, aus demselben Grund wie die
 * Seiten: beim Aktualisieren des Relays werden .js-Dateien kopiert, und ein
 * Skript daneben waere genau das, was dabei liegenbliebe. Beim Start werden sie
 * in die Ablage geschrieben und gestartet.
 *
 * Fehlt der Helfer oder das Fenstersystem, gibt es kein Symbol - und sonst
 * nichts. Ein Relay, das ohne Leiste nicht vermittelt, waere die schlechtere
 * Fassung seiner selbst.
 *
 * --- Wo ausdruecklich nichts erscheint -------------------------------------------
 *
 * Unter systemd. Der Dienst laeuft dort unter einem eigenen Konto ohne
 * Sitzung; ein Symbol in *wessen* Leiste denn? Fuer diesen Fall legt das
 * .deb-Paket den Helfer getrennt ab und startet ihn in der Sitzung des
 * angemeldeten Benutzers (siehe bauen.js) - er fragt dann dasselbe /health und
 * zeigt dasselbe Symbol, nur ohne Kind eines Relays zu sein.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { spawn } = require("child_process");

/* ------------------------------------------------------------- Die Symbole */

// Zwei Punkte, hier gerechnet statt mitgeliefert.
//
// Ein PNG ist an dieser Stelle wenig mehr als ein zlib-Klumpen mit drei
// Bloecken davor und dahinter; das steht unten. Der Grund, es zu rechnen: das
// Symbol soll die Lage zeigen, und dafuer braucht es zwei Fassungen desselben
// Bildes. Zwei Bilder als Base64 waeren zwei Dateien mehr, die auseinander
// laufen koennen.
const GRUEN = [98, 209, 154];
const ROT = [255, 138, 138];

function crcTabelle() {
  const tabelle = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabelle[n] = c;
  }
  return tabelle;
}
const CRC = crcTabelle();

function crc32(daten) {
  let c = 0xffffffff;
  for (const wert of daten) c = CRC[(c ^ wert) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function block(art, inhalt) {
  const laenge = Buffer.alloc(4);
  laenge.writeUInt32BE(inhalt.length);
  const koerper = Buffer.concat([Buffer.from(art, "ascii"), inhalt]);
  const pruef = Buffer.alloc(4);
  pruef.writeUInt32BE(crc32(koerper));
  return Buffer.concat([laenge, koerper, pruef]);
}

// Der dunkle Rand um den Punkt. Ohne ihn verschwindet Gruen auf einer hellen
// Leiste und Rot auf einer dunklen - eine Anzeige, die auf der Haelfte aller
// Schreibtische nicht zu sehen ist, ist keine.
const RAND = [11, 15, 22];

/**
 * Ein runder Punkt in der gewuenschten Farbe, 64x64 mit weichem Rand.
 *
 * <p>Weich, weil ein harter Kreis in der Leiste auf 22 Pixel heruntergerechnet
 * ausgefranst aussieht; die Kanten werden ueber den Abstand zum Mittelpunkt
 * ausgeblendet.
 */
function symbol(farbe) {
  const groesse = 64;
  const mitte = (groesse - 1) / 2;
  const radius = groesse * 0.44;
  const kern = radius - 5;
  const zeilen = [];
  for (let y = 0; y < groesse; y += 1) {
    const zeile = Buffer.alloc(1 + groesse * 4);
    for (let x = 0; x < groesse; x += 1) {
      const abstand = Math.hypot(x - mitte, y - mitte);
      // Ein Pixel breiter Uebergang - genug, damit nichts stuft.
      const deckung = Math.max(0, Math.min(1, radius - abstand));
      // Innen die Farbe, aussen der Rand, dazwischen wird gemischt.
      const anteil = Math.max(0, Math.min(1, kern + 1 - abstand));
      const stelle = 1 + x * 4;
      for (let kanal = 0; kanal < 3; kanal += 1) {
        zeile[stelle + kanal] = Math.round(farbe[kanal] * anteil + RAND[kanal] * (1 - anteil));
      }
      zeile[stelle + 3] = Math.round(deckung * 255);
    }
    zeilen.push(zeile);
  }
  const kopf = Buffer.alloc(13);
  kopf.writeUInt32BE(groesse, 0);
  kopf.writeUInt32BE(groesse, 4);
  kopf[8] = 8;   // acht Bit je Kanal
  kopf[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    block("IHDR", kopf),
    block("IDAT", zlib.deflateSync(Buffer.concat(zeilen))),
    block("IEND", Buffer.alloc(0))
  ]);
}

/* -------------------------------------------------------------- Die Helfer */

// Linux. Zuerst der AppIndicator (GNOME, Ubuntu, moderne Leisten), sonst das
// alte Gtk.StatusIcon - Cinnamon, Xfce und MATE zeigen es bis heute an.
const PYTHON = `#!/usr/bin/env python3
# ELFIX Relay in der Statusleiste. Geschrieben vom Relay selbst - Aenderungen
# hier werden beim naechsten Start ueberschrieben (siehe statusleiste.js).
import argparse
import json
import os
import signal
import urllib.error
import urllib.request
import webbrowser

import gi
gi.require_version("Gtk", "3.0")
from gi.repository import GLib, Gtk

zeiger = argparse.ArgumentParser()
zeiger.add_argument("--port", type=int, default=8787)
zeiger.add_argument("--pid", type=int, default=0)
zeiger.add_argument("--gruen", required=True)
zeiger.add_argument("--rot", required=True)
argumente = zeiger.parse_args()

ADRESSE = "http://localhost:%d" % argumente.port


def lage():
    """Antwortet das Relay - und mit welchen Zahlen."""
    try:
        with urllib.request.urlopen(ADRESSE + "/health", timeout=2) as antwort:
            return json.loads(antwort.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError):
        return None


def elternteil_weg():
    """Ist das Relay, zu dem dieses Symbol gehoert, noch da?"""
    if not argumente.pid:
        return False
    try:
        os.kill(argumente.pid, 0)
        return False
    except OSError:
        return True


class Leiste:
    def __init__(self):
        self.menue = Gtk.Menu()
        self.zeile = Gtk.MenuItem(label="Wird gefragt \\u2026")
        self.zeile.set_sensitive(False)
        self.menue.append(self.zeile)
        self.menue.append(Gtk.SeparatorMenuItem())

        seite = Gtk.MenuItem(label="Statusseite \\u00f6ffnen")
        seite.connect("activate", lambda *_: webbrowser.open(ADRESSE + "/status"))
        self.menue.append(seite)

        if argumente.pid:
            beenden = Gtk.MenuItem(label="Relay beenden")
            beenden.connect("activate", self.relay_beenden)
            self.menue.append(beenden)

        ausblenden = Gtk.MenuItem(label="Symbol ausblenden")
        ausblenden.connect("activate", lambda *_: Gtk.main_quit())
        self.menue.append(ausblenden)
        self.menue.show_all()

        self.anzeige = self.anzeige_bauen()
        self.pruefen()
        GLib.timeout_add_seconds(5, self.pruefen)

    def anzeige_bauen(self):
        """Der neue Weg, sonst der alte. Beide zeigen dasselbe Bild."""
        for name in ("AyatanaAppIndicator3", "AppIndicator3"):
            try:
                gi.require_version(name, "0.1")
                modul = getattr(__import__("gi.repository", fromlist=[name]), name)
            except (ValueError, ImportError):
                continue
            anzeige = modul.Indicator.new(
                "elfix-relay", argumente.gruen,
                modul.IndicatorCategory.APPLICATION_STATUS)
            anzeige.set_status(modul.IndicatorStatus.ACTIVE)
            anzeige.set_menu(self.menue)
            anzeige.set_title("ELFIX Relay")
            return ("indicator", anzeige)

        symbol = Gtk.StatusIcon()
        symbol.set_from_file(argumente.gruen)
        symbol.set_title("ELFIX Relay")
        # Linksklick oeffnet die Seite, Rechtsklick zeigt das Menue.
        symbol.connect("activate", lambda *_: webbrowser.open(ADRESSE + "/status"))
        symbol.connect("popup-menu", lambda _s, knopf, zeit:
                       self.menue.popup(None, None, None, None, knopf, zeit))
        return ("statusicon", symbol)

    def bild_setzen(self, pfad):
        art, anzeige = self.anzeige
        if art == "indicator":
            anzeige.set_icon_full(pfad, "ELFIX Relay")
        else:
            anzeige.set_from_file(pfad)

    def hinweis_setzen(self, text):
        art, anzeige = self.anzeige
        self.zeile.set_label(text)
        if art == "statusicon":
            anzeige.set_tooltip_text("ELFIX Relay \\u2014 " + text)

    def relay_beenden(self, *_):
        try:
            os.kill(argumente.pid, signal.SIGTERM)
        except OSError:
            pass
        Gtk.main_quit()

    def pruefen(self):
        if elternteil_weg():
            Gtk.main_quit()
            return False
        stand = lage()
        if stand:
            self.bild_setzen(argumente.gruen)
            self.hinweis_setzen("L\\u00e4uft \\u2014 %s Verbindungen, Port %d"
                                % (stand.get("verbindungen", 0), argumente.port))
        else:
            self.bild_setzen(argumente.rot)
            self.hinweis_setzen("Antwortet nicht \\u2014 Port %d" % argumente.port)
        return True


Leiste()
Gtk.main()
`;

// Windows. NotifyIcon aus System.Windows.Forms - dieselbe Leiste, in der auch
// alles andere sitzt, was im Hintergrund laeuft.
const POWERSHELL = `# ELFIX Relay in der Statusleiste. Geschrieben vom Relay selbst - Aenderungen
# hier werden beim naechsten Start ueberschrieben (siehe statusleiste.js).
param(
  [int] $Port = 8787,
  [int] $ElternPid = 0,
  [string] $Gruen = "",
  [string] $Rot = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$adresse = "http://localhost:$Port"

function Neues-Symbol([string] $pfad) {
  # NotifyIcon will ein Icon und kein Bitmap - der Umweg ueber GetHicon ist der
  # uebliche, und das Handle bleibt am Symbol haengen, solange es angezeigt wird.
  $bild = [System.Drawing.Bitmap]::FromFile($pfad)
  $zeiger = $bild.GetHicon()
  return [System.Drawing.Icon]::FromHandle($zeiger)
}

$symbolLaeuft = Neues-Symbol $Gruen
$symbolWeg = Neues-Symbol $Rot

$leiste = New-Object System.Windows.Forms.NotifyIcon
$leiste.Icon = $symbolLaeuft
$leiste.Text = "ELFIX Relay"
$leiste.Visible = $true

$menue = New-Object System.Windows.Forms.ContextMenuStrip
$zeile = $menue.Items.Add("Wird gefragt ...")
$zeile.Enabled = $false
$menue.Items.Add("-") | Out-Null
$seite = $menue.Items.Add("Statusseite oeffnen")
$seite.add_Click({ Start-Process "$adresse/status" })
if ($ElternPid -gt 0) {
  $beenden = $menue.Items.Add("Relay beenden")
  $beenden.add_Click({
    try { Stop-Process -Id $ElternPid -ErrorAction SilentlyContinue } catch { }
    $leiste.Visible = $false
    [System.Windows.Forms.Application]::Exit()
  })
}
$ausblenden = $menue.Items.Add("Symbol ausblenden")
$ausblenden.add_Click({
  $leiste.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})
$leiste.ContextMenuStrip = $menue
$leiste.add_DoubleClick({ Start-Process "$adresse/status" })

# Einmal beim Start sagen, dass es laeuft. Das ist der eine Moment, in dem die
# Meldung erwuenscht ist: gerade installiert, gerade gestartet.
$leiste.ShowBalloonTip(6000, "ELFIX Relay", "Laeuft auf Port $Port. Klick fuer die Statusseite.", [System.Windows.Forms.ToolTipIcon]::Info)

$takt = New-Object System.Windows.Forms.Timer
$takt.Interval = 5000
$takt.add_Tick({
  if ($ElternPid -gt 0 -and -not (Get-Process -Id $ElternPid -ErrorAction SilentlyContinue)) {
    $leiste.Visible = $false
    [System.Windows.Forms.Application]::Exit()
    return
  }
  try {
    $antwort = Invoke-WebRequest -Uri "$adresse/health" -UseBasicParsing -TimeoutSec 2
    $stand = $antwort.Content | ConvertFrom-Json
    $leiste.Icon = $symbolLaeuft
    $leiste.Text = "ELFIX Relay - laeuft, $($stand.verbindungen) Verbindungen"
    $zeile.Text = "Laeuft - $($stand.verbindungen) Verbindungen, Port $Port"
  } catch {
    $leiste.Icon = $symbolWeg
    $leiste.Text = "ELFIX Relay - antwortet nicht"
    $zeile.Text = "Antwortet nicht - Port $Port"
  }
})
$takt.Start()

[System.Windows.Forms.Application]::Run()
$leiste.Visible = $false
`;

/* --------------------------------------------------------------- Die Regeln */

/**
 * Ob ein Symbol ueberhaupt in Frage kommt.
 *
 * <p>Dieselben Ueberlegungen wie beim Oeffnen der Seite (seite-zeigen.js), mit
 * einem Unterschied: das Symbol erscheint bei *jedem* Start. Es ist keine
 * Meldung, die man einmal liest, sondern die Anzeige selbst - eine, die beim
 * zweiten Start verschwindet, waere keine.
 */
function darfLaufen({ gepackt, plattform, umgebung = {} } = {}) {
  if (String(umgebung.ELFIX_RELAY_LEISTE || "") === "0") return false;
  // Unter systemd hat niemand eine Leiste. Dort uebernimmt der Helfer, den das
  // Paket in die Sitzung des Benutzers legt.
  if (umgebung.INVOCATION_ID) return false;
  if (!gepackt) return false;
  if (plattform === "win32") return true;
  if (plattform === "darwin") return false;
  return Boolean(umgebung.DISPLAY || umgebung.WAYLAND_DISPLAY);
}

/** Wie der Helfer auf dieser Plattform gestartet wird. */
function aufruf({ plattform, skript, gruen, rot, port, pid }) {
  if (plattform === "win32") {
    return {
      datei: "powershell.exe",
      args: [
        "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden",
        "-ExecutionPolicy", "Bypass", "-File", skript,
        "-Port", String(port), "-ElternPid", String(pid),
        "-Gruen", gruen, "-Rot", rot
      ]
    };
  }
  return {
    datei: "python3",
    args: [skript, "--port", String(port), "--pid", String(pid), "--gruen", gruen, "--rot", rot]
  };
}

/** Helfer und Symbole in die Ablage schreiben. Gibt die Pfade zurueck. */
function ablegen(ordner, plattform = process.platform) {
  const gruen = path.join(ordner, "leiste-gruen.png");
  const rot = path.join(ordner, "leiste-rot.png");
  const skript = path.join(ordner, plattform === "win32" ? "leiste.ps1" : "leiste.py");
  fs.writeFileSync(gruen, symbol(GRUEN));
  fs.writeFileSync(rot, symbol(ROT));
  // Jedes Mal neu geschrieben: nach einer Aktualisierung des Relays soll der
  // Helfer der neue sein und nicht der von vorletzter Woche.
  fs.writeFileSync(skript, plattform === "win32" ? POWERSHELL : PYTHON);
  return { gruen, rot, skript };
}

/**
 * Das Symbol anzeigen, wenn es geht.
 *
 * @returns {boolean} ob ein Helfer gestartet wurde
 */
function starten({ gepackt, ordner, port, protokoll = console.log } = {}) {
  const plattform = process.platform;
  if (!darfLaufen({ gepackt, plattform, umgebung: process.env })) return false;
  let pfade;
  try {
    pfade = ablegen(ordner, plattform);
  } catch (fehler) {
    protokoll(`[LEISTE] nicht angelegt: ${fehler?.message || fehler}`);
    return false;
  }
  const { datei, args } = aufruf({ plattform, ...pfade, port, pid: process.pid });
  try {
    const kind = spawn(datei, args, { detached: true, stdio: "ignore" });
    // Fehlt python3 oder PowerShell, kommt genau hier ein ENOENT - und mehr
    // passiert dann auch nicht.
    kind.on("error", (fehler) => {
      protokoll(`[LEISTE] kein Symbol: ${fehler?.message || fehler}`);
    });
    kind.unref();
    return true;
  } catch (fehler) {
    protokoll(`[LEISTE] kein Symbol: ${fehler?.message || fehler}`);
    return false;
  }
}

module.exports = { darfLaufen, aufruf, ablegen, symbol, starten, PYTHON, POWERSHELL };
