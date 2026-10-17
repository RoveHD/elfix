"use strict";
// Sprachsuche am Desktop: Modell laden und umpacken, das unsichtbare
// Erkennungsfenster mit echtem vosk-browser (WebAssembly im Worker), seine
// Abschottung und das Verwerfen eines kaputten Modells.
//
// Ein echtes Sprachmodell gibt es hier nicht (45 MB, aus dem Netz). Das
// Ersatzmodell hat die Form eines Vosk-Modells, aber keinen Inhalt: vosk
// laedt es bis in den Parser und scheitert dort - genau der Weg, auf dem ein
// beschaedigter Download landen wuerde.
const { app, BrowserWindow, session, ipcMain } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const sprachmodell = require("../src/sprachmodell");

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(Boolean(b)); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d !== undefined ? "   -> " + d : ""}`); };
const frist = setTimeout(() => { console.error("FAIL Zeitlimit"); app.exit(1); }, 150000);
const ablage = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-sprachsuche-"));
app.setPath("userData", path.join(ablage, "profil"));

/** Ein ZIP wie die von Vosk: Ordner obenauf, Dateien teils gepackt. */
function zipBauen(dateien) {
  const lokal = [];
  const zentral = [];
  let stelle = 0;
  for (const [name, inhalt] of dateien) {
    const roh = Buffer.from(inhalt);
    const packen = roh.length > 8;
    const daten = packen ? zlib.deflateRawSync(roh) : roh;
    const namePuffer = Buffer.from(name);
    const kopf = Buffer.alloc(30);
    kopf.writeUInt32LE(0x04034b50, 0); kopf.writeUInt16LE(packen ? 8 : 0, 8);
    kopf.writeUInt32LE(daten.length, 18); kopf.writeUInt32LE(roh.length, 22); kopf.writeUInt16LE(namePuffer.length, 26);
    const eintrag = Buffer.alloc(46);
    eintrag.writeUInt32LE(0x02014b50, 0); eintrag.writeUInt16LE(packen ? 8 : 0, 10);
    eintrag.writeUInt32LE(daten.length, 20); eintrag.writeUInt32LE(roh.length, 24);
    eintrag.writeUInt16LE(namePuffer.length, 28); eintrag.writeUInt32LE(stelle, 42);
    lokal.push(kopf, namePuffer, daten);
    zentral.push(eintrag, namePuffer);
    stelle += 30 + namePuffer.length + daten.length;
  }
  const verzeichnis = Buffer.concat(zentral);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0); ende.writeUInt16LE(dateien.length, 8); ende.writeUInt16LE(dateien.length, 10);
  ende.writeUInt32LE(verzeichnis.length, 12); ende.writeUInt32LE(stelle, 16);
  return Buffer.concat([...lokal, verzeichnis, ende]);
}

function tarNamen(tarGz) {
  const tar = zlib.gunzipSync(tarGz);
  const namen = [];
  for (let stelle = 0; stelle + 512 <= tar.length;) {
    const kopf = tar.subarray(stelle, stelle + 512);
    if (kopf.every((b) => b === 0)) break;
    const name = kopf.toString("utf8", 0, 100).replace(/\0.*$/s, "");
    const groesse = parseInt(kopf.toString("ascii", 124, 136).replace(/\0.*$/s, "").trim() || "0", 8);
    namen.push(name);
    stelle += 512 + Math.ceil(groesse / 512) * 512;
  }
  return namen;
}

const MODELL_DATEIEN = [
  ["vosk-model-small-de-0.15/am/final.mdl", "kein echtes akustisches Modell"],
  ["vosk-model-small-de-0.15/conf/model.conf", "--min-active=200\n"],
  ["vosk-model-small-de-0.15/graph/words.txt", "<eps> 0\n"]
];

app.whenReady().then(async () => {
  // --- Umpacken ---
  const tarGz = sprachmodell.umpacken(zipBauen(MODELL_DATEIEN));
  const namen = tarNamen(tarGz);
  pruefe("Aus dem ZIP wird ein tar.gz mit einem Ordner obenauf", namen[0] === "vosk-model-small-de-0.15/", namen.join(" "));
  pruefe("Jeder Ordner steht vor seinem Inhalt",
    namen.indexOf("vosk-model-small-de-0.15/am/") < namen.indexOf("vosk-model-small-de-0.15/am/final.mdl")
    && namen.includes("vosk-model-small-de-0.15/conf/") && namen.includes("vosk-model-small-de-0.15/graph/"));
  const wirft = (fn) => { try { fn(); return ""; } catch (fehler) { return fehler.message; } };
  pruefe("Ein ZIP ohne Modell wird abgelehnt",
    /fehlt am\/final\.mdl/.test(wirft(() => sprachmodell.umpacken(zipBauen([["x/readme.txt", "hallo"]]))))
    || /fehlt/.test(wirft(() => sprachmodell.umpacken(zipBauen([["x/readme.txt", "hallo"]])))));
  pruefe("Ein Pfad aus dem Archiv hinaus wird abgelehnt",
    /unsicher/.test(wirft(() => sprachmodell.umpacken(zipBauen([["m/../../boese", "x"], ...MODELL_DATEIEN])))));
  pruefe("Kein ZIP wird abgelehnt", /kein ZIP/.test(wirft(() => sprachmodell.umpacken(Buffer.from("<html>Fehler</html>")))));

  // --- Laden ---
  const zip = zipBauen(MODELL_DATEIEN);
  let abrufe = 0;
  const abrufen = async () => {
    abrufe += 1;
    return new Response(new ReadableStream({ start(c) { c.enqueue(zip.subarray(0, 100)); c.enqueue(zip.subarray(100)); c.close(); } }),
      { headers: { "content-length": String(zip.length) } });
  };
  const verzeichnis = path.join(ablage, "modell");
  const modell = sprachmodell.erstellen({ verzeichnis, abrufen });
  pruefe("Vorher ist kein Modell da", !modell.vorhanden());
  const anteile = [];
  const [eins, zwei] = await Promise.all([modell.bereitstellen((a) => anteile.push(a)), modell.bereitstellen()]);
  pruefe("Zwei gleichzeitige Anfragen laden einmal", abrufe === 1 && eins === zwei, `${abrufe} Abrufe`);
  pruefe("Der Fortschritt endet bei 1", anteile.at(-1) === 1, JSON.stringify(anteile));
  // Ersatzmodell ist klein - vorhanden() verlangt mehr als 1 MB. Fuer die
  // Fensterpruefung daher ein eigenes, das sich als vorhanden ausgibt.
  pruefe("Das Archiv liegt in den App-Daten", fs.existsSync(eins) && tarNamen(fs.readFileSync(eins)).length === namen.length);
  const fehlend = sprachmodell.erstellen({ verzeichnis: path.join(ablage, "x"), abrufen: async () => new Response("", { status: 503 }) });
  pruefe("Ein Serverfehler wird als Fehler gemeldet",
    /HTTP 503/.test(await fehlend.bereitstellen().then(() => "", (f) => f.message)));

  // --- Das Erkennungsfenster ---
  const ersatz = path.join(ablage, "ersatz.tar.gz");
  fs.writeFileSync(ersatz, tarGz);
  let da = true;
  const fensterModell = { ziel: ersatz, vorhanden: () => da && fs.existsSync(ersatz), bereitstellen: async () => ersatz };
  const ereignisse = [];
  let warten = null;
  const sprachsuche = require("../src/sprachsuche-fenster").erstellen({ BrowserWindow, session, ipcMain, modell: fensterModell,
    melden: (e) => { ereignisse.push(e); warten?.(e); } });
  const auf = (bedingung, ms = 90000) => new Promise((ok) => {
    if (ereignisse.some(bedingung)) { ok(true); return; }
    const uhr = setTimeout(() => { warten = null; ok(false); }, ms);
    warten = (e) => { if (bedingung(e)) { clearTimeout(uhr); warten = null; ok(true); } };
  });

  await sprachsuche.starten("einmal");
  const inhalt = sprachsuche.fenster.webContents;
  pruefe("Das Fenster bleibt unsichtbar", sprachsuche.fenster.isVisible() === false);
  pruefe("Es hat eine eigene Sitzung", inhalt.session !== session.defaultSession);
  const fremd = await inhalt.executeJavaScript(
    "fetch('https://example.com/').then(r => 'erreicht ' + r.status, e => 'gesperrt')").catch(() => "gesperrt");
  pruefe("Ins Netz kommt die Seite nicht", fremd === "gesperrt", fremd);
  const modellAbruf = await inhalt.executeJavaScript(
    `fetch(${JSON.stringify(sprachsuche.MODELL_URL)}).then(r => r.status + ' ' + r.headers.get('content-type'), e => 'fehler ' + e)`);
  pruefe("Das Modell kommt unter der festen Adresse", modellAbruf === "200 application/gzip", modellAbruf);
  const ohneNode = await inhalt.executeJavaScript("typeof require + ' ' + typeof process");
  pruefe("Kein Node in der Seite", ohneNode === "undefined undefined", ohneNode);

  const gescheitert = await auf((e) => e.typ === "fehler");
  const fehler = ereignisse.find((e) => e.typ === "fehler");
  pruefe("vosk laedt das Ersatzmodell bis in den Parser und meldet den Fehler", gescheitert,
    JSON.stringify(ereignisse));
  pruefe("Die Meldung ist lesbar", fehler?.text === "Das Sprachmodell konnte nicht geladen werden", fehler?.text);
  pruefe("Das kaputte Modell wird verworfen", !fs.existsSync(ersatz));
  pruefe("Der Zustand geht auf aus", ereignisse.at(-1)?.typ === "zustand" && ereignisse.at(-1)?.zustand === "aus",
    JSON.stringify(ereignisse.at(-1)));
  pruefe("Das Fenster ist danach geschlossen", !sprachsuche.fenster);
  da = false;

  // --- Verdrahtung ---
  const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "../src/preload.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../src/renderer/index.html"), "utf8");
  pruefe("Hey Elfix ist standardmaessig aus", /sprachsuche: \{ weckwort: false \}/.test(main)
    && /weckwort: raw\?\.sprachsuche\?\.weckwort === true/.test(main));
  pruefe("Speichern schaltet das Zuhoeren um", /sprachsucheWeckwortAnwenden\(altesWeckwort\)/.test(main));
  pruefe("Das Hauptfenster bekommt kein Mikrofon",
    /mainWindow\.webContents\.session\.setPermissionRequestHandler\(\(_inhalt, _recht, antwort\) => antwort\(false\)\)/.test(main));
  pruefe("Knopf und Ereignisse stehen im preload", /sprachsucheKnopf: \(\) => ipcRenderer\.invoke\("sprachsuche:knopf"\)/.test(preload)
    && /onSprachsuche:/.test(preload));
  pruefe("Mikrofonknopf und Schalter sind in der Oberflaeche", /id="sprachsucheButton"/.test(html) && /id="sprachsucheWeckwort"/.test(html));

  clearTimeout(frist);
  sprachsuche.schliessen();
  console.log(`${pruefungen.filter(Boolean).length}/${pruefungen.length} bestanden`);
  app.exit(pruefungen.every(Boolean) ? 0 : 1);
}).catch((fehler) => { console.error(fehler); app.exit(1); });
