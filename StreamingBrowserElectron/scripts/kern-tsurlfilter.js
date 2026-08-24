"use strict";

/*
 * tsurlfilter fuer den Kern der Android-App buendeln.
 *
 * Am Rechner laedt src/adblock-engine.js das Paket ueber import("@adguard/
 * tsurlfilter"). Auf dem Telefon gibt es kein npm und kein Modulsystem: der
 * Kern ist ein WebView, der fertige Quelltexte einspielt. Also wird das Paket
 * hier zu einer einzigen Datei gebuendelt, die ein Browser laden kann.
 *
 * Gebaut wird beim Bauen und nicht von Hand (siehe android/app/build.gradle),
 * aus demselben Grund wie beim Kopieren der Module: eine Datei, die von Hand
 * erneuert werden muesste, ist irgendwann alt - und dann filtert das Telefon
 * nach einer anderen Fassung als der Rechner.
 *
 * Die Form ist Absicht:
 *
 *   iife + globaler Name   Der Kern haengt die Datei als <script> in seine
 *                          Seite (kern.html). Ein Modulsystem gibt es dort
 *                          nicht; adblock-engine.js findet das Paket
 *                          anschliessend unter globalThis.ELFIX_TSURLFILTER.
 *                          Ueber die Bruecke einspielen laesst sie sich nicht:
 *                          1,3 MB Quelltext in einem evaluateJavascript-Aufruf
 *                          laufen in die Groessengrenze zwischen den Prozessen.
 *   target es2019          Die aelteste WebView-Fassung, die ELFIX bedient
 *                          (Android 8 mit aktualisiertem System-WebView).
 *   minify                 2,3 MB werden 1,3 MB. Die Datei liegt in jeder APK.
 */

const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..");
const ZIEL = process.argv[2];

if (!ZIEL) {
  console.error("Aufruf: node scripts/kern-tsurlfilter.js <zieldatei>");
  process.exit(2);
}

let esbuild;
try {
  esbuild = require("esbuild");
} catch (fehler) {
  console.error("esbuild fehlt. Einmalig einrichten:  cd StreamingBrowserElectron && npm ci");
  process.exit(1);
}

if (!fs.existsSync(path.join(WURZEL, "node_modules/@adguard/tsurlfilter/package.json"))) {
  console.error("@adguard/tsurlfilter fehlt. Einmalig einrichten:  cd StreamingBrowserElectron && npm ci");
  process.exit(1);
}

// Der Einstiegspunkt existiert nur waehrend des Bauens. Er muss innerhalb des
// Projekts liegen, sonst findet esbuild das node_modules daneben nicht.
const zwischen = fs.mkdtempSync(path.join(WURZEL, ".kernbau-"));
const eintrag = path.join(zwischen, "tsurlfilter-eintrag.js");
fs.writeFileSync(eintrag, 'export * from "@adguard/tsurlfilter";\n');

try {
  fs.mkdirSync(path.dirname(ZIEL), { recursive: true });
  const ergebnis = esbuild.buildSync({
    entryPoints: [eintrag],
    bundle: true,
    format: "iife",
    globalName: "ELFIX_TSURLFILTER",
    platform: "browser",
    target: "es2019",
    minify: true,
    legalComments: "none",
    outfile: ZIEL,
    logLevel: "warning"
  });
  if (ergebnis.errors && ergebnis.errors.length) process.exit(1);
} finally {
  fs.rmSync(zwischen, { recursive: true, force: true });
}

const fassung = require(path.join(WURZEL, "node_modules/@adguard/tsurlfilter/package.json")).version;
const groesse = fs.statSync(ZIEL).size;
console.log(`tsurlfilter ${fassung} gebuendelt: ${(groesse / 1024 / 1024).toFixed(1)} MB -> ${path.relative(process.cwd(), ZIEL)}`);
