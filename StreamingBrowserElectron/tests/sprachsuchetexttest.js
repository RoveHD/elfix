"use strict";
// Weckwort und Bereinigung der Sprachsuche. Die Faelle spiegeln, was eine
// deutsche Offline-Erkennung aus "Hey Elfix" macht - sie kennt das Wort nicht.
const { weckwort, bereinigen } = require("../shared/sprachsuche-text");

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(Boolean(b)); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d !== undefined ? "   -> " + d : ""}`); };

for (const satz of ["hey elfix", "hey elf fix", "he elf ix", "hallo elfix", "okay elf fix", "hey helfix",
  "hey elfi", "hey elf fixe", "elfix", "elf fix such avatar", "Hey, Elfix!", "ja hey elf fix"]) {
  pruefe(`"${satz}" weckt`, weckwort(satz).erkannt);
}
for (const satz of ["", "elf", "es ist elf uhr", "der fix ist da", "hey du", "um elf fix fertig", "hey elfen",
  "elfmeter", "der elf fix"]) {
  pruefe(`"${satz}" weckt nicht`, !weckwort(satz).erkannt, JSON.stringify(weckwort(satz)));
}
pruefe("Was nach dem Weckwort kommt, ist die Suche",
  weckwort("hey elf fix such mal nach avatar die sieben häfen").rest === "avatar die sieben häfen",
  weckwort("hey elf fix such mal nach avatar die sieben häfen").rest);
pruefe("Nur das Weckwort laesst die Suche offen", weckwort("hey elfix").rest === "");

const FAELLE = [
  ["Avatar die sieben Häfen", "avatar die sieben häfen"],
  ["such nach breaking bad", "breaking bad"],
  ["suche mal nach der serie dark", "dark"],
  ["zeig mir one piece", "one piece"],
  ["spiele game of thrones ab", "game of thrones"],
  ["ich will naruto sehen", "naruto"],
  ["öffne mal bitte den film inception", "inception"],
  ["hey elfix such avatar", "avatar"],
  ["finde attack on titan bitte", "attack on titan"],
  ["  Hunter X Hunter.  ", "hunter x hunter"]
];
for (const [gesagt, erwartet] of FAELLE) {
  pruefe(`"${gesagt.trim()}" -> "${erwartet}"`, bereinigen(gesagt) === erwartet, bereinigen(gesagt));
}

console.log(`${pruefungen.filter(Boolean).length}/${pruefungen.length} bestanden`);
process.exit(pruefungen.every(Boolean) ? 0 : 1);
