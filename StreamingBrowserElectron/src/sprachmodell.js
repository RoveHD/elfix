"use strict";

// Das deutsche Sprachmodell der Sprachsuche.
//
// Erkannt wird offline mit Vosk (vosk-browser, WebAssembly) - keine Aufnahme
// verlaesst den Rechner. Die Erkennung braucht dafuer ein Modell, das nicht
// im Installer steckt: rund 45 MB, die nur laedt, wer die Sprachsuche nutzt.
//
// Vosk veroeffentlicht seine Modelle als ZIP, vosk-browser liest aber nur
// tar.gz mit einem Ordner obenauf. Umgepackt wird hier einmal nach dem Laden;
// danach liegt das Archiv in den App-Daten und wird nie wieder abgerufen.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const MODELL = {
  name: "vosk-model-small-de-0.15",
  url: "https://alphacephei.com/vosk/models/vosk-model-small-de-0.15.zip",
  // Ohne diese Dateien ist es kein Vosk-Modell; vosk-browser scheiterte sonst
  // erst im Worker mit einer Meldung, die niemand zuordnen kann.
  pflicht: ["am/final.mdl", "conf/model.conf"]
};
const HOECHSTENS = 200 * 1024 * 1024;

/** Die Eintraege eines ZIP-Archivs (gespeichert oder Deflate, ohne ZIP64). */
function zipEintraege(puffer) {
  let ende = -1;
  for (let i = puffer.length - 22; i >= Math.max(0, puffer.length - 65557); i -= 1) {
    if (puffer.readUInt32LE(i) === 0x06054b50) { ende = i; break; }
  }
  if (ende < 0) throw new Error("kein ZIP-Archiv");
  const anzahl = puffer.readUInt16LE(ende + 10);
  let stelle = puffer.readUInt32LE(ende + 16);
  const eintraege = [];
  for (let n = 0; n < anzahl; n += 1) {
    if (puffer.readUInt32LE(stelle) !== 0x02014b50) throw new Error("ZIP-Verzeichnis beschaedigt");
    const methode = puffer.readUInt16LE(stelle + 10);
    const gepackt = puffer.readUInt32LE(stelle + 20);
    const groesse = puffer.readUInt32LE(stelle + 24);
    const nameLaenge = puffer.readUInt16LE(stelle + 28);
    const extraLaenge = puffer.readUInt16LE(stelle + 30);
    const kommentarLaenge = puffer.readUInt16LE(stelle + 32);
    const kopf = puffer.readUInt32LE(stelle + 42);
    const name = puffer.toString("utf8", stelle + 46, stelle + 46 + nameLaenge);
    stelle += 46 + nameLaenge + extraLaenge + kommentarLaenge;
    if (name.startsWith("/") || name.split(/[\\/]/).includes("..")) throw new Error("unsicherer Pfad im Archiv");
    if (name.endsWith("/")) { eintraege.push({ name, ordner: true, daten: Buffer.alloc(0) }); continue; }
    if (puffer.readUInt32LE(kopf) !== 0x04034b50) throw new Error("ZIP-Eintrag beschaedigt");
    const start = kopf + 30 + puffer.readUInt16LE(kopf + 26) + puffer.readUInt16LE(kopf + 28);
    const roh = puffer.subarray(start, start + gepackt);
    const daten = methode === 0 ? Buffer.from(roh)
      : methode === 8 ? zlib.inflateRawSync(roh)
        : null;
    if (!daten) throw new Error(`ZIP-Methode ${methode} nicht unterstuetzt`);
    if (daten.length !== groesse) throw new Error("ZIP-Eintrag hat die falsche Groesse");
    eintraege.push({ name, ordner: false, daten });
  }
  return eintraege;
}

function oktal(wert, laenge) {
  return wert.toString(8).padStart(laenge - 1, "0") + "\0";
}

/**
 * Jeder Ordner bekommt einen eigenen Eintrag vor seinem Inhalt. vosk-browser
 * entpackt sonst Dateien in Ordner, die es nicht angelegt hat, und scheitert
 * danach beim Ablegen in IndexedDB ("FS error") - ZIPs fuehren Ordner nicht
 * immer als eigene Eintraege.
 */
function mitOrdnern(eintraege) {
  const ordner = new Set();
  for (const eintrag of eintraege) {
    const teile = eintrag.name.split("/").filter(Boolean);
    const tiefe = eintrag.ordner ? teile.length : teile.length - 1;
    for (let i = 1; i <= tiefe; i += 1) ordner.add(teile.slice(0, i).join("/") + "/");
  }
  const sortiert = [...ordner].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  return [
    ...sortiert.map((name) => ({ name, ordner: true, daten: Buffer.alloc(0) })),
    ...eintraege.filter((e) => !e.ordner)
  ];
}

/** Ein ustar-Archiv aus den Eintraegen. */
function tarAus(liste) {
  const eintraege = mitOrdnern(liste);
  const teile = [];
  for (const eintrag of eintraege) {
    let name = eintrag.name;
    let praefix = "";
    if (Buffer.byteLength(name) > 100) {
      const schnitt = name.lastIndexOf("/", name.length - 2);
      praefix = name.slice(0, schnitt);
      name = name.slice(schnitt + 1);
      if (Buffer.byteLength(name) > 100 || Buffer.byteLength(praefix) > 155) throw new Error("Pfad zu lang");
    }
    const kopf = Buffer.alloc(512);
    kopf.write(name, 0, 100, "utf8");
    kopf.write(oktal(eintrag.ordner ? 0o755 : 0o644, 8), 100, "ascii");
    kopf.write(oktal(0, 8), 108, "ascii");
    kopf.write(oktal(0, 8), 116, "ascii");
    kopf.write(oktal(eintrag.daten.length, 12), 124, "ascii");
    kopf.write(oktal(0, 12), 136, "ascii");
    kopf.write("        ", 148, "ascii");
    kopf.write(eintrag.ordner ? "5" : "0", 156, "ascii");
    kopf.write("ustar\0" + "00", 257, "ascii");
    kopf.write(praefix, 345, 155, "utf8");
    let summe = 0;
    for (const byte of kopf) summe += byte;
    kopf.write(summe.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
    teile.push(kopf, eintrag.daten);
    const rest = eintrag.daten.length % 512;
    if (rest) teile.push(Buffer.alloc(512 - rest));
  }
  teile.push(Buffer.alloc(1024));
  return Buffer.concat(teile);
}

/** ZIP des Modells -> tar.gz fuer vosk-browser, mit Pruefung auf ein Modell. */
function umpacken(zip, modell = MODELL) {
  const eintraege = zipEintraege(zip);
  const ordner = new Set(eintraege.map((e) => e.name.split("/")[0]));
  if (ordner.size !== 1) throw new Error("Das Archiv hat keinen einzelnen Modellordner");
  const wurzel = [...ordner][0];
  for (const datei of modell.pflicht) {
    if (!eintraege.some((e) => !e.ordner && e.name === `${wurzel}/${datei}`)) {
      throw new Error(`Im Modell fehlt ${datei}`);
    }
  }
  return zlib.gzipSync(tarAus(eintraege), { level: 1 });
}

/**
 * Den Pfad des fertigen Archivs - bei Bedarf erst laden und umpacken.
 * `abrufen` ist fetch (in der App net.fetch), `fortschritt(0..1)` meldet den
 * Download. Laeuft schon ein Laden, warten alle auf dasselbe.
 */
function erstellen({ verzeichnis, abrufen, modell = MODELL }) {
  const ziel = path.join(verzeichnis, `${modell.name}.tar.gz`);
  let laufend = null;
  const vorhanden = () => {
    try { return fs.statSync(ziel).size > 1024 * 1024; } catch { return false; }
  };
  async function laden(fortschritt = () => {}) {
    const antwort = await abrufen(modell.url);
    if (!antwort.ok) throw new Error(`Sprachmodell nicht erreichbar (HTTP ${antwort.status})`);
    const gesamt = Number(antwort.headers.get("content-length")) || 0;
    if (gesamt > HOECHSTENS) throw new Error("Sprachmodell unerwartet gross");
    const teile = [];
    let geladen = 0;
    const leser = antwort.body.getReader();
    for (;;) {
      const { done, value } = await leser.read();
      if (done) break;
      geladen += value.length;
      if (geladen > HOECHSTENS) throw new Error("Sprachmodell unerwartet gross");
      teile.push(Buffer.from(value));
      if (gesamt) fortschritt(Math.min(1, geladen / gesamt));
    }
    const archiv = umpacken(Buffer.concat(teile), modell);
    fs.mkdirSync(verzeichnis, { recursive: true });
    const zwischen = `${ziel}.${process.pid}.tmp`;
    fs.writeFileSync(zwischen, archiv);
    fs.renameSync(zwischen, ziel);
    return ziel;
  }
  return {
    ziel,
    vorhanden,
    bereitstellen(fortschritt) {
      if (vorhanden()) return Promise.resolve(ziel);
      if (!laufend) laufend = laden(fortschritt).finally(() => { laufend = null; });
      return laufend;
    }
  };
}

module.exports = { MODELL, zipEintraege, tarAus, umpacken, erstellen };
