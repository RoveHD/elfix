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
  "GHSA-hp3w-g68c-fv3c": { bis: "2026-12-31", paket: "sprintf-js" }
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
