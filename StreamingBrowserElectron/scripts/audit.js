"use strict";

// npm audit mit ausdruecklich begruendeten Ausnahmen.
//
// Release und Abhaengigkeitspruefung brechen bei jeder Meldung ab. Eine
// Ausnahme gibt es nur fuer eine Meldung, fuer die keine reparierte Fassung
// existiert und deren Angriffsweg ELFIX nicht trifft. Sie gilt nur bis zu
// ihrem Datum und nur, solange jede betroffene Paketkette allein auf sie
// zurueckgeht. Jede andere Meldung - auch eine zweite im selben Paket - laesst
// die Pruefung weiter scheitern.
const { execFileSync } = require("node:child_process");

const AUSNAHMEN = {
  // sprintf-js <= 1.1.3: Dienstverweigerung ueber unbegrenzte Genauigkeit im
  // Formatstring. 1.1.3 ist die neueste Fassung, eine reparierte gibt es nicht.
  // Die Formatstrings stammen hier nur aus festem Code (AdGuard-Regelparser,
  // argparse, roarr beim Electron-Download), nie aus fremden Eingaben.
  "GHSA-hp3w-g68c-fv3c": { bis: "2026-12-31", paket: "sprintf-js" },
  // zod < 4.6.6: Speichererschoepfung beim Pruefen uebergrosser Zeichenketten
  // mit Laengenbegrenzung. Eine reparierte Fassung gibt es, sie ist hier aber
  // nicht zu erreichen: @adguard/tsurlfilter nagelt zod fest, auch in seiner
  // neuesten Fassung (6.0.4 verlangt genau 3.24.4). Was npm als "fix"
  // vorschlaegt, ist ein Ruecksprung auf tsurlfilter 1.0.81 - fuenf
  // Hauptfassungen zurueck, also keine Reparatur, sondern ein anderer
  // Adblocker. Der Weg dorthin fuehrt durch den Regelparser (agtree) und damit
  // ueber die Filterlisten der eingestellten Quellen; getroffen wuerde der
  // eigene Speicher beim Einlesen einer absichtlich entarteten Liste.
  "GHSA-mrhx-c7xc-m3w5": { bis: "2027-03-31", paket: "zod" },
  // minimatch >= 7 < 11.0.1: Dienstverweigerung ueber aufgeblaehte Glob-Teile.
  // Auch hier existiert eine reparierte Fassung (11.0.1), und auch hier nimmt
  // sie niemand: app-builder-lib verlangt bis heute ^10.2.5 und
  // @electron/universal ^9.0.3 - in electron-builder 26.18.0 ebenso wie in der
  // hier verwendeten. minimatch laeuft in dieser Kette nur beim Bauen, ueber
  // die Dateimuster unserer eigenen Konfiguration; zur Laufzeit ist es nicht
  // dabei.
  "GHSA-g3hv-75wg-m249": { bis: "2027-03-31", paket: "minimatch" }
};

function bericht() {
  try {
    return execFileSync("npm", ["audit", "--json"], { encoding: "utf8", shell: process.platform === "win32" });
  } catch (fehler) {
    // npm audit endet mit Code 1, sobald es etwas meldet; die Ausgabe gilt trotzdem.
    if (fehler.stdout) return fehler.stdout;
    throw fehler;
  }
}

function pruefen(daten, heute = new Date()) {
  const verwundbar = daten.vulnerabilities || {};
  const fehler = [];
  const genutzt = new Set();
  // Schlecht ist ein Paket mit einer nicht entschuldigten eigenen Meldung -
  // und alles, was ueber ein schlechtes Paket kommt. Ringe in den Ketten
  // (app-builder-lib <-> dmg-builder) bleiben so ohne Wirkung.
  const schlecht = new Set();
  for (const [name, eintrag] of Object.entries(verwundbar)) {
    for (const via of eintrag.via || []) {
      if (typeof via !== "object") continue;
      const id = String(via.url || "").split("/").pop();
      const ausnahme = AUSNAHMEN[id];
      if (!ausnahme || ausnahme.paket !== name) { schlecht.add(name); continue; }
      if (heute > new Date(`${ausnahme.bis}T23:59:59Z`)) {
        fehler.push(`Ausnahme ${id} ist am ${ausnahme.bis} abgelaufen`);
        schlecht.add(name);
        continue;
      }
      genutzt.add(id);
    }
    // Ein Eintrag ohne bekannte Herkunft ist nicht entschuldigt.
    if (!(eintrag.via || []).length) schlecht.add(name);
  }
  let geaendert = true;
  while (geaendert) {
    geaendert = false;
    for (const [name, eintrag] of Object.entries(verwundbar)) {
      if (schlecht.has(name)) continue;
      if ((eintrag.via || []).some((v) => typeof v === "string" && (schlecht.has(v) || !verwundbar[v]))) {
        schlecht.add(name);
        geaendert = true;
      }
    }
  }
  for (const name of schlecht) fehler.push(`${name} (${verwundbar[name].severity})`);
  const erlaubt = Object.keys(verwundbar).filter((name) => !schlecht.has(name));
  return { fehler, genutzt: [...genutzt], erlaubt };
}

if (require.main === module) {
  const ergebnis = pruefen(JSON.parse(bericht()));
  if (ergebnis.fehler.length) {
    console.error("npm audit meldet:\n  " + ergebnis.fehler.join("\n  "));
    process.exit(1);
  }
  for (const id of ergebnis.genutzt) {
    console.log(`Ausnahme ${id} (${AUSNAHMEN[id].paket}, bis ${AUSNAHMEN[id].bis}) deckt: ${ergebnis.erlaubt.join(", ")}`);
  }
  console.log("npm audit: keine weiteren Meldungen");
}

module.exports = { pruefen, AUSNAHMEN };
