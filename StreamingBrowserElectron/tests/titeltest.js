"use strict";
// Titel verstehen: Normalisierung, Werk-Identitaet und Filmreihen.
//
// Die Faelle stammen groesstenteils aus einer echten Ablage - samt der Falle,
// die sich dort wirklich findet: "Avatar - Aufbruch nach Pandora" und
// "Avatar Aang: Der Herr der Elemente" fangen mit demselben Wort an und sind
// zwei voellig verschiedene Werke.

const T = require("../src/titel");

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(b); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };

// --- 1. Normalisierung --------------------------------------------------------

const faelle = [
  ["John Wick: Kapitel 4 (2023)", "John Wick: Kapitel 4"],
  ["JOHN WICK - KAPITEL 4", "JOHN WICK - KAPITEL 4"],
  ["Reacher Staffel 1 | SerienStream (S.to)", "Reacher"],
  ["Attack on Titan Ger Dub", "Attack on Titan"],
  ["Attack on Titan Ger Sub", "Attack on Titan"],
  ["One Piece Folge 1071", "One Piece"],
  ["Loki S02E05", "Loki"],
  ["Marvel's The Avengers", "The Avengers"],
  ["Breaking Bad - Staffel 5", "Breaking Bad"]
];
for (const [roh, erwartet] of faelle) {
  const klar = T.zerlegen(roh).klar;
  pruefe(`1. ${JSON.stringify(roh)}`, klar === erwartet, `${JSON.stringify(klar)} statt ${JSON.stringify(erwartet)}`);
}

pruefe("1b. Gross-/Kleinschreibung und Sonderzeichen fallen zusammen",
  T.schluessel("JOHN WICK - KAPITEL 4") === T.schluessel("John Wick: Kapitel 4"),
  T.schluessel("JOHN WICK - KAPITEL 4"));

pruefe("1c. Umlaute werden aufgeloest",
  T.normalisieren("Böse Mädchen") === "boese maedchen", T.normalisieren("Böse Mädchen"));

// Ein Jahr im Titel selbst ist kein Zusatz, sondern der Titel.
pruefe("1d. Ein Filmtitel, der eine Jahreszahl ist, bleibt heil",
  T.zerlegen("1917").klar === "1917" && T.zerlegen("Blade Runner 2049").klar === "Blade Runner 2049",
  `${T.zerlegen("1917").klar} / ${T.zerlegen("Blade Runner 2049").klar}`);

// --- 2. Teilnummern -----------------------------------------------------------

const teile = [
  ["John Wick: Kapitel 4", 4], ["Iron Man 2", 2], ["Rocky II", 2],
  ["Star Wars: Episode V", 5], ["Vol. 3", 3], ["Part II", 2],
  ["Deadpool", 0], ["The Hunger Games", 0], ["Blade Runner 2049", 0], ["1917", 0]
];
for (const [roh, erwartet] of teile) {
  pruefe(`2. Teilnummer aus ${JSON.stringify(roh)}`, T.teilNummer(roh) === erwartet,
    `${T.teilNummer(roh)} statt ${erwartet}`);
}

// --- 3. Reihen erkennen -------------------------------------------------------

const reihen = [
  ["John Wick", "John Wick: Kapitel 2", true],
  ["John Wick: Kapitel 2", "John Wick Kapitel IV", true],
  ["Harry Potter und der Stein der Weisen", "Harry Potter und die Kammer des Schreckens", true],
  ["The Dark Knight", "The Dark Knight Rises", true],
  ["Batman: The Dark Knight Returns, Teil 1", "Batman: The Dark Knight Returns, Teil 2", true],
  ["Iron Man", "Iron Man 2", true],
  ["Deadpool", "Deadpool 2", true],
  ["Spider-Man", "Spider-Man 2", true],
  ["The Amazing Spider-Man 2", "Spider-Man 3", true],
  ["The Hunger Games", "The Hunger Games: Catching Fire", true],
  ["Marvel's The Avengers", "Avengers: Endgame", true],
  ["Es", "Es: Kapitel 2", true],
  ["Der Herr der Ringe: Die Gefaehrten", "Der Herr der Ringe: Die zwei Tuerme", true],
  ["Star Wars: Episode IV", "Star Wars: Episode V", true],
  ["Avatar - Aufbruch nach Pandora", "Avatar: The Way of Water", true],
  // Und die Gegenprobe: gleiches Anfangswort, anderes Werk.
  ["Avatar - Aufbruch nach Pandora", "Avatar Aang: Der Herr der Elemente", false],
  ["Avatar: The Way of Water", "Avatar Aang: Der Herr der Elemente", false],
  ["The Dark Knight", "Batman v Superman: Dawn of Justice", false],
  ["Iron Man 2", "Rush Hour 2", false],
  ["One Piece", "One Punch Man", false],
  ["Game of Thrones", "Lord of the Rings", false],
  ["Loki", "Low Key", false],
  ["Frieren", "One Piece", false]
];
let richtig = 0;
for (const [links, rechts, soll] of reihen) {
  const wert = T.franchiseKonfidenz(links, rechts);
  const ist = wert >= 0.7;
  if (ist === soll) richtig += 1;
  else pruefe(`3. ${JSON.stringify(links)} / ${JSON.stringify(rechts)}`, false,
    `${wert.toFixed(2)} - erwartet ${soll ? "gleiche" : "andere"} Reihe`);
}
pruefe(`3. Alle ${reihen.length} Reihen-Faelle`, richtig === reihen.length, `${richtig}/${reihen.length}`);

pruefe("3b. Eine gemeinsame Nummer allein macht keine Reihe",
  T.franchiseKonfidenz("Iron Man 2", "Rush Hour 2") === 0, "0");
pruefe("3c. Ein einzelnes gemeinsames Wort bleibt unter der Schwelle",
  T.franchiseKonfidenz("Deadpool 2", "Deadpool & Wolverine") < 0.7,
  T.franchiseKonfidenz("Deadpool 2", "Deadpool & Wolverine").toFixed(2));

// --- 4. Werk-Identitaet (Dubletten) -------------------------------------------

const gleich = (a, b, typ = "serie") => T.werkSchluessel(a, typ) === T.werkSchluessel(b, typ);

pruefe("4. Dub und Sub sind dasselbe Werk", gleich("Attack on Titan Ger Dub", "Attack on Titan Ger Sub"), "gleich");
pruefe("4b. Auch ohne Sprachzusatz", gleich("Attack on Titan", "Attack on Titan Ger Dub"), "gleich");
pruefe("4c. Anbieterzusatz und Staffel aendern nichts",
  gleich("Reacher Staffel 1 | SerienStream (S.to)", "Reacher"), "gleich");
pruefe("4d. Verschiedene Teile sind verschiedene Werke",
  !gleich("Iron Man", "Iron Man 2", "film"), "verschieden");
pruefe("4e. Serie und gleichnamiger Film sind zwei Werke",
  T.werkSchluessel("Der Herr der Ringe", "serie") !== T.werkSchluessel("Der Herr der Ringe", "film"),
  "verschieden");

// --- 5. Wortaehnlichkeit ------------------------------------------------------

pruefe("5. Seltene Woerter wiegen mehr als haeufige",
  T.tokenAehnlichkeit(["john", "wick"], ["john", "wick"]) > T.tokenAehnlichkeit(["der", "film"], ["der", "roman"]),
  "ja");
pruefe("5b. Fuellwoerter allein ergeben kaum Aehnlichkeit",
  T.tokenAehnlichkeit(["der", "die", "das"], ["der", "die", "und"]) < 0.6,
  T.tokenAehnlichkeit(["der", "die", "das"], ["der", "die", "und"]).toFixed(2));
pruefe("5c. Leere Eingaben ergeben null",
  T.tokenAehnlichkeit([], ["a"]) === 0 && T.tokenAehnlichkeit([], []) === 0, "0");
pruefe("5d. Schreibfehler bleiben aehnlich",
  T.zeichenAehnlichkeit("Interstellar", "Intersteller") > 0.85,
  T.zeichenAehnlichkeit("Interstellar", "Intersteller").toFixed(2));
pruefe("5e. Verschiedene Titel nicht",
  T.zeichenAehnlichkeit("Frieren", "One Piece") < 0.35,
  T.zeichenAehnlichkeit("Frieren", "One Piece").toFixed(2));

// --- 6. Nichts stuerzt bei Unsinn ab -------------------------------------------

for (const wert of [null, undefined, "", "   ", "!!!", 42, {}]) {
  const zerlegt = T.zerlegen(wert);
  if (typeof zerlegt.klar !== "string" || !Array.isArray(zerlegt.tokens)) {
    pruefe(`6. Eingabe ${JSON.stringify(wert)}`, false, "kein sauberes Ergebnis");
  }
}
pruefe("6. Leere und unsinnige Eingaben liefern ein leeres Ergebnis statt eines Fehlers", true, "geprueft");
pruefe("6b. Zwei leere Titel sind keine Reihe", T.franchiseKonfidenz("", "") === 0, "0");

const fehler = pruefungen.filter((p) => !p).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
