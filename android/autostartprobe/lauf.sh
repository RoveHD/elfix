#!/usr/bin/env bash
#
# Die Abkuerzung des Autostarts pruefen - ohne Geraet.
#
# Zwei Schritte: die Probe aus MainActivity.java herausschreiben und sie danach
# gegen nachgebaute Anbieterseiten laufen lassen (node, kein node_modules).
#
# Anders als bei schichtprobe wird hier nicht uebersetzt: MainActivity zieht das
# halbe Android-SDK nach sich, und was geprueft werden soll, ist ein
# Zeichenketten-Literal. Es wird deshalb aus dem Quelltext geschnitten - genau
# wie tests/adblocktest.js es mit den Entscheidungsfunktionen aus main.js macht.
#
# Aufruf: android/autostartprobe/lauf.sh
set -euo pipefail

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WURZEL="$(cd "$HIER/../.." && pwd)"
QUELLE="$WURZEL/android/app/src/main/java/local/elflix/android/MainActivity.java"
BAU="${TMPDIR:-/tmp}/elfix-autostartprobe"

rm -rf "$BAU"; mkdir -p "$BAU"

echo "--- Die Probe aus MainActivity.java herausschreiben ---"
node - "$QUELLE" "$BAU/probe.js" <<'NODE'
const fs = require('fs');
const quelle = fs.readFileSync(process.argv[2], 'utf8').split('\r\n').join('\n');
const name = 'HOSTERLISTE_STATT_PLAYER_JS';

// Vom Feldnamen bis zur Zeile, die das Literal abschliesst.
const zeilen = quelle.split('\n');
const von = zeilen.findIndex((z) => z.includes('String ' + name + ' ='));
if (von < 0) throw new Error('nicht gefunden: ' + name);
let bis = von;
while (bis < zeilen.length && !/;\s*$/.test(zeilen[bis])) bis += 1;
if (bis >= zeilen.length) throw new Error('kein Ende des Literals: ' + name);

// Alle Zeichenketten-Stuecke einsammeln; Java kennt hier nur \" und \\.
const stueck = /"((?:\\.|[^"\\])*)"/g;
let text = '';
for (const zeile of zeilen.slice(von, bis + 1)) {
  // Kommentarzeilen tragen keine Stuecke des Literals.
  if (/^\s*\/\//.test(zeile)) continue;
  let treffer;
  while ((treffer = stueck.exec(zeile)) !== null) {
    text += treffer[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}
if (!text) throw new Error('leeres Literal: ' + name);
fs.writeFileSync(process.argv[3], text);
console.log('ok (' + text.length + ' Zeichen)');
NODE

node --check "$BAU/probe.js"

echo
echo "--- Gegen nachgebaute Anbieterseiten laufen lassen ---"
node "$HIER/probe.js" "$BAU/probe.js"
