"use strict";
// Die Verdrahtung des eigenen Players.
//
// Ein Player besteht hier aus vier Teilen, die einander nicht kennen: einer
// Seite (renderer/spieler.html), ihrem Skript (renderer/spieler.js), einer
// Bruecke (spieler-preload.js) und dem Hauptprozess (main.js). Zwischen ihnen
// liegen lauter Zeichenketten - Element-Kennungen, Kanalnamen, ein Dateipfad
// zu hls.js. Keine davon faellt beim Uebersetzen auf; sie fallen auf, wenn
// jemand vor einem schwarzen Bild sitzt.
//
// Genau diese Nahtstellen werden hier geprueft, und nur sie. Wie sich ein
// Video anfuehlt, kann kein Test beantworten - ob der Knopf, den das Skript
// sucht, in der Seite auch steht, dagegen schon.

const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..");
const lies = (datei) => fs.readFileSync(path.join(WURZEL, datei), "utf8");

const seite = lies("src/renderer/spieler.html");
const skript = lies("src/renderer/spieler.js");
const bruecke = lies("src/spieler-preload.js");
const haupt = lies("src/main.js");

const pruefungen = [];
const pruefe = (name, bedingung, detail = "") => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

const alle = (text, muster) => [...text.matchAll(muster)].map((treffer) => treffer[1]);

/* -------------------------------------------------------------- Die Seite */

// hls.js kommt aus node_modules und wird von der Seite als Datei geladen. Ein
// Paket, das seine Dateien umbenennt, faellt sonst erst im Betrieb auf - und
// zwar als Player, der bei jeder HLS-Quelle "fehlt der Abspieler" sagt.
const hlsPfad = /<script src="([^"]*hls[^"]*\.js)"/.exec(seite)?.[1] || "";
pruefe("Die Seite laedt hls.js von einem Pfad",
  Boolean(hlsPfad),
  hlsPfad);
pruefe("Und diese Datei liegt wirklich dort",
  Boolean(hlsPfad) && fs.existsSync(path.join(WURZEL, "src", "renderer", hlsPfad)),
  path.join("src/renderer", hlsPfad));
pruefe("hls.js steht als Abhaengigkeit in der package.json",
  Boolean(JSON.parse(lies("package.json")).dependencies["hls.js"]),
  "sonst fehlt es nach npm ci --omit=dev in der gebauten App");

const kennungen = [...new Set(alle(skript, /getElementById\("([^"]+)"\)/g))];
const fehlend = kennungen.filter((kennung) => !seite.includes(`id="${kennung}"`));
pruefe("Jedes Element, das das Skript sucht, steht in der Seite",
  fehlend.length === 0,
  fehlend.join(", ") || `${kennungen.length} geprüft`);

pruefe("Die Seite laedt ihr eigenes Skript",
  seite.includes('<script src="spieler.js"></script>'));

/* ------------------------------------------------------------- Die Bruecke */

// Was das Skript an der Bruecke aufruft, muss die Bruecke auch anbieten. Der
// Ersatz oben in spieler.js (das leere Objekt) faengt ein fehlendes `window`
// ab - aber nicht eine Bruecke, die eine Sache weniger kann als gedacht.
const genutzt = [...new Set(alle(skript, /\bbruecke\.(\w+)\(/g))];
const angeboten = alle(bruecke, /^\s*(\w+):/gm);
const unbekannt = genutzt.filter((name) => !angeboten.includes(name));
pruefe("Die Bruecke kann alles, was das Skript von ihr verlangt",
  unbekannt.length === 0,
  unbekannt.join(", ") || genutzt.join(", "));
pruefe("Der Ersatz kennt dieselben Namen",
  genutzt.every((name) => new RegExp(`${name}\\(\\)\\s*\\{\\}`).test(skript)),
  "ohne window.elfixSpieler darf das Skript nicht schon beim Laden umfallen");

/* --------------------------------------------------------- Die Kanaele */

const gesendet = [...new Set(alle(bruecke, /ipcRenderer\.send\("([^"]+)"/g))];
const gehoert = alle(haupt, /ipcMain\.on\("(spieler:[^"]+)"/g);
const ungehoert = gesendet.filter((kanal) => !gehoert.includes(kanal));
pruefe("Jede Meldung der Bruecke hat im Hauptprozess einen Empfaenger",
  ungehoert.length === 0,
  ungehoert.join(", ") || gesendet.join(", "));

const empfangen = alle(bruecke, /ipcRenderer\.on\("([^"]+)"/g);
pruefe("Und was die Bruecke erwartet, schickt der Hauptprozess auch",
  empfangen.every((kanal) => haupt.includes(`send("${kanal}"`)),
  empfangen.join(", "));

// Die Nachfragen des Players (Folgenliste, Wechsel, Hoster) gehen ueber
// invoke und brauchen drueben ein handle. Ein fehlendes handle faellt zur
// Laufzeit als abgewiesenes Versprechen auf - also hier.
const gefragt = [...new Set(alle(bruecke, /ipcRenderer\.invoke\("([^"]+)"/g))];
const unbeantwortet = gefragt.filter((kanal) => !haupt.includes(`ipcMain.handle("${kanal}"`));
pruefe("Jede Nachfrage des Players wird im Hauptprozess beantwortet",
  unbeantwortet.length === 0,
  unbeantwortet.join(", ") || gefragt.join(", "));

pruefe("Die Oberflaeche kann den Player starten und beenden",
  /startDirekt:/.test(lies("src/preload.js"))
  && haupt.includes('ipcMain.handle("direkt:starten"')
  && haupt.includes('ipcMain.handle("direkt:beenden"'));

/* ------------------------------------------------- Was nicht passieren darf */

// Jede Meldung aus der Player-Ansicht wird gegen deren webContents geprueft.
// Ohne das koennte jede beliebige Seite der App Fortschritt verbuchen - und
// eine Anbieterseite ist fremder Code.
const stellen = alle(haupt, /ipcMain\.on\("spieler:[^"]+", \((\w+)/g);
pruefe("Es gibt Empfaenger fuer die Meldungen des Players",
  stellen.length >= 4,
  String(stellen.length));
const abschnitt = haupt.slice(haupt.indexOf('ipcMain.on("spieler:bereit"'));
const bereich = abschnitt.slice(0, abschnitt.indexOf('ipcMain.handle("direkt:starten"'));
const empfaenger = bereich.split('ipcMain.on("spieler:').slice(1);
// Geprueft wird entweder von Hand oder ueber `vomSpieler` - und dass dieser
// Pruefer wirklich den Absender vergleicht, steht gleich darunter. Ohne beides
// koennte jede beliebige Seite der App Fortschritt verbuchen; eine
// Anbieterseite ist fremder Code.
const bewacht = (teil) => teil.includes("ereignis.sender !== spielerView.webContents")
  || teil.includes("vomSpieler(ereignis)");
pruefe("Jeder von ihnen prueft, dass die Meldung wirklich vom Player kommt",
  empfaenger.length > 0 && empfaenger.every(bewacht),
  `${empfaenger.length} Empfänger`);
pruefe("Und der gemeinsame Pruefer vergleicht wirklich den Absender",
  /function vomSpieler\(ereignis\) \{[\s\S]*?ereignis\.sender === spielerView\.webContents/.test(haupt));
const nachgefragt = haupt.split('ipcMain.handle("spieler:').slice(1);
pruefe("Auch jede Nachfrage wird auf ihren Absender geprueft",
  nachgefragt.length > 0 && nachgefragt.every((teil) => teil.includes("vomSpieler(ereignis)")),
  `${nachgefragt.length} Nachfragen`);

// Die Watchparty laeuft jetzt gegen den eigenen Player: er meldet seinen Takt,
// meldet seine Taten und nimmt Befehle entgegen. Die Entscheidungen dahinter
// bleiben in watchparty-sync.js - dieselben, die auf dem Telefon fallen.
pruefe("Der Player meldet seinen Takt und seine Taten in die Runde",
  haupt.includes('ipcMain.on("spieler:takt"') && haupt.includes('ipcMain.on("spieler:aktion"')
  && haupt.includes("meldeWatchpartyStandAusSpieler"));
pruefe("Befehle der Runde erreichen ihn, bevor sie in die Ansichten gehen",
  haupt.includes("if (spielerLauf && await spielerSteuernAusRunde(eintrag, nachricht, urteil, binHost)) return;"));
pruefe("Gerechnet wird mit den Regeln der Runde und nicht mit eigenen",
  haupt.includes("watchpartySync.zielZeitBerechnen(ereignis, watchparty.serverJetzt(eintrag.room))")
  && haupt.includes("watchpartySync.driftEntscheiden(spielerDrift"),
  "sonst entschiede der Rechner anders als das Telefon");
pruefe("Was aus der Runde kam, geht nicht als eigene Tat zurueck",
  skript.includes("if (!inRunde || ausRunde()) return;"),
  "sonst haette jede Pause eine Antwort und die Antwort eine Antwort");

pruefe("Der Player wird geschlossen, wenn die Folge verlassen wird",
  haupt.includes('direktSpielerSchliessen("navigation")')
  && haupt.includes('direktSpielerSchliessen("startseite")'));

pruefe("Die Ansicht dahinter schweigt, solange der eigene Player laeuft",
  haupt.includes("setAudioMuted(true)"),
  "sonst laeuft ein Werbevideo der Anbieterseite unsichtbar mit");

// Die Webpruefung faellt nur dort, wo sie fallen muss - und die Ansicht, in
// der sie faellt, laesst nichts Fremdes herein. Beides gehoert zusammen: die
// Ausnahme ist nur so viel wert wie ihre Eingrenzung.
pruefe("Die Webpruefung faellt an genau einer Stelle",
  (haupt.match(/webSecurity:\s*false/g) || []).length === 1,
  String((haupt.match(/webSecurity:\s*false/g) || []).length));
pruefe("Und diese Ansicht bleibt bei ihrer eigenen Seite",
  haupt.includes('if (!String(ziel || "").startsWith("file://")) ereignis.preventDefault();'),
  "keine fremde Adresse in einer Ansicht ohne Webpruefung");

pruefe("Der Player laeuft in einer eigenen Sitzung",
  haupt.includes('const SPIELER_PARTITION = "persist:elfix-spieler"')
  && haupt.includes("spielerSessionHolen()"),
  "die Kopfzeilen der Quelle haben in der Sitzung der Anbieter nichts zu suchen");

/* --------------------------------------------- Was kein Fehler sein darf */

// `play()` wird abgelehnt, sobald vor der Einloesung etwas anderes am Video
// passiert - beim Tippen auf Pause, beim Hosterwechsel, und wenn der Browser
// ohne Zutun keinen Ton zulaesst. Beides ist kein Fehlschlag der Quelle.
// Vorher stand deshalb "Die Quelle spielt nicht" ueber einer sichtbar
// laufenden Folge, mit dem Rat, einen anderen Hoster zu nehmen.
pruefe("Ein abgebrochenes play() gilt nicht als kaputte Quelle",
  /HARMLOSE_ABLEHNUNG\s*=\s*\[[^\]]*"AbortError"/.test(skript)
  && /HARMLOSE_ABLEHNUNG\s*=\s*\[[^\]]*"NotAllowedError"/.test(skript),
  "AbortError und NotAllowedError");
pruefe("Und die Ablehnung wird wirklich vor dem Aufgeben geprueft",
  /HARMLOSE_ABLEHNUNG\.includes\(String\(fehler\?\.name[\s\S]{0,220}?aufgeben\(/.test(skript),
  "sonst stuende die Pruefung da und der Kasten trotzdem");
pruefe("Ein echter Fehler kommt weiterhin an",
  /aufgeben\(String\(fehler\?\.message \|\| fehler\), "play"\)/.test(skript),
  "entschaerfen heisst nicht verschlucken");

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`
${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
