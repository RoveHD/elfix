"use strict";
/*
 * Das Relay als eigenstaendiges Programm - und wie es sich selbst erneuert.
 *
 * Geprueft wird hier die Rechnerei, nicht das Netz: welche Fassung neuer ist,
 * welche Datei zu dieser Maschine gehoert, und wann ein Selbsttausch
 * unterbleiben muss. Genau daran haengt, ob ein Relay im Regal irgendwann
 * still eine falsche Datei einsetzt - und das faellt niemandem auf, weil
 * niemand hinsieht.
 */

const path = require("path");
const aktualisierung = require(path.join(__dirname, "..", "..", "sync-server", "aktualisierung.js"));

const pruefungen = [];
const pruefe = (name, bedingung, detail) => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

const { fassungLesen, istNeuer, plattformName, passendeDatei, darfTauschen } = aktualisierung;

// --- Fassungen ---------------------------------------------------------------

pruefe("Eine Fassung mit v davor ist dieselbe",
  JSON.stringify(fassungLesen("v1.61.0")) === JSON.stringify([1, 61, 0]),
  JSON.stringify(fassungLesen("v1.61.0")));
pruefe("Was keine Fassung ist, ergibt keine", fassungLesen("neuestes") === null);

pruefe("1.62.0 ist neuer als 1.61.0", istNeuer("v1.62.0", "1.61.0"));
pruefe("1.61.1 ist neuer als 1.61.0", istNeuer("1.61.1", "1.61.0"));
pruefe("2.0.0 ist neuer als 1.99.99", istNeuer("2.0.0", "1.99.99"));
pruefe("Dieselbe Fassung ist kein Anlass", !istNeuer("1.61.0", "1.61.0"),
  "sonst laedt das Relay taeglich dieselbe Datei");
pruefe("Eine aeltere Fassung wird nie geholt", !istNeuer("1.60.0", "1.61.0"),
  "sonst genuegte ein zurueckgezogenes Release, um jedes Relay zurueckzudrehen");
pruefe("Und Unsinn ebenso wenig", !istNeuer("", "1.61.0") && !istNeuer("1.62.0", "kaputt"));

// --- Die passende Datei ------------------------------------------------------

const dateien = [
  { name: "ELFIX-Setup-1.62.0-x64.exe" },
  { name: "ELFIX-Android-1.62.0.apk" },
  { name: "ELFIX-Relay-1.62.0-win-x64.exe" },
  { name: "ELFIX-Relay-1.62.0-linux-x64" },
  { name: "ELFIX-Relay-1.62.0-amd64.deb" },
  { name: "latest.yml" }
];

pruefe("Windows nimmt die exe des Relays",
  passendeDatei(dateien, "win32", "x64")?.name === "ELFIX-Relay-1.62.0-win-x64.exe",
  passendeDatei(dateien, "win32", "x64")?.name);
pruefe("Linux nimmt die Binaerdatei",
  passendeDatei(dateien, "linux", "x64")?.name === "ELFIX-Relay-1.62.0-linux-x64",
  passendeDatei(dateien, "linux", "x64")?.name);
pruefe("Das Paket wird nie als Selbsttausch genommen",
  passendeDatei(dateien, "linux", "x64")?.name !== "ELFIX-Relay-1.62.0-amd64.deb",
  "wer ueber apt installiert hat, aktualisiert ueber apt");
pruefe("Die Dateien der App gehen das Relay nichts an",
  !String(passendeDatei(dateien, "win32", "x64")?.name).includes("Setup"));
pruefe("Ohne passende Datei kommt nichts zurueck",
  passendeDatei(dateien, "linux", "arm64") === null,
  "fuer arm64 wird nichts gebaut - dann bleibt es bei der laufenden Fassung");
pruefe("Eine leere Liste ergibt nichts", passendeDatei([], "linux", "x64") === null);

pruefe("Der Plattformname steht fest",
  plattformName("win32", "x64") === "win-x64" && plattformName("linux", "arm64") === "linux-arm64",
  `${plattformName("win32", "x64")} / ${plattformName("linux", "arm64")}`);

// --- Wo nicht getauscht werden darf ------------------------------------------

pruefe("Unter /usr/bin taeuscht sich das Relay nicht selbst aus",
  !darfTauschen("/usr/bin/elfix-relay", "linux"),
  "dort gehoert die Datei dem Paket");
pruefe("Unter /opt schon", darfTauschen("/opt/elfix/elfix-relay", "linux"));
pruefe("Im Heimverzeichnis auch", darfTauschen("/home/elias/elfix-relay", "linux"));
pruefe("Unter Windows immer", darfTauschen("C:/Program Files/ELFIX/elfix-relay.exe", "win32"),
  "dort gibt es keine Paketverwaltung, die widersprechen koennte");

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
