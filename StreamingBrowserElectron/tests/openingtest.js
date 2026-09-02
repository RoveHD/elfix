"use strict";
// Das Opening zur Serie des Jahres.
//
// Diese Datei ist aus einem besonderen Grund ausfuehrlicher als noetig:
// geschrieben wurde die Anbindung gegen eine Schnittstelle, die aus der
// Entwicklungsumgebung *nicht erreichbar* war - api.animethemes.moe ist dort
// von der Netzrichtlinie gesperrt. Kein einziger echter Aufruf war moeglich.
//
// Was hier also geprueft wird, ist nicht "die Antwort wird richtig gelesen" -
// das kann nur ein echter Aufruf zeigen. Geprueft wird das, worauf es bei einer
// blind geschriebenen Anbindung wirklich ankommt: **dass sie bei jeder
// denkbaren Antwort still bleibt statt zu stoeren.** Findet sie nichts, bleibt
// der Rueckblick stumm und laeuft weiter - genau wie vorher.

const path = require("path");
const openings = require(path.join(__dirname, "..", "src", "openings.js"));

const pruefungen = [];
const pruefe = (name, bedingung, detail) => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

// --- Die Anfrage ---

pruefe("Die Anfrage geht an animethemes.moe",
  openings.anfrageUrl("Attack on Titan").startsWith("https://api.animethemes.moe/search?"));
pruefe("Der Titel steht kodiert darin",
  openings.anfrageUrl("Attack on Titan").includes("q=Attack%20on%20Titan"));
pruefe("Sonderzeichen brechen die Adresse nicht",
  !/[ "<>]/.test(openings.anfrageUrl('Re:ZERO "Anfang" & Ende /2')),
  openings.anfrageUrl('Re:ZERO "Anfang" & Ende /2'));
pruefe("Ohne Titel keine Anfrage",
  openings.anfrageUrl("") === "" && openings.anfrageUrl(null) === ""
  && openings.anfrageUrl(undefined) === "");

// --- Der Titelvergleich ---
//
// Streng, und zwar mit Absicht: eine Suche liefert auch Aehnliches, und das
// Opening der falschen Serie ist schlechter als gar keins.

pruefe("Dieselbe Serie in anderer Schreibweise passt",
  openings.passt("Attack on Titan", "attack on titan!")
  && openings.passt("Re:ZERO", "Re Zero"));
pruefe("Eine andere Serie passt nicht",
  !openings.passt("Naruto", "Naruto Shippuden")
  && !openings.passt("Attack on Titan", "Attack on Titan: Final Season"),
  "lieber kein Opening als das falsche");
pruefe("Leeres passt auf nichts",
  !openings.passt("", "") && !openings.passt("Naruto", "") && !openings.passt("", "Naruto"));

// --- Die Antwort ---

// So stellt sich die Anbindung die Antwort vor. Ob sie wirklich so aussieht,
// weiss erst der erste echte Aufruf - deshalb steht darunter dieselbe Probe in
// mehreren anderen Formen.
const antwort = {
  search: {
    anime: [{
      name: "Attack on Titan",
      animethemes: [
        { type: "ED", sequence: 1, song: { title: "Utsukushiki Zankoku na Sekai" },
          animethemeentries: [{ videos: [{ audio: { link: "https://a.animethemes.moe/ed1.ogg" } }] }] },
        { type: "OP", sequence: 2, song: { title: "Jiyuu no Tsubasa" },
          animethemeentries: [{ videos: [{ audio: { link: "https://a.animethemes.moe/op2.ogg" } }] }] },
        { type: "OP", sequence: 1, song: { title: "Guren no Yumiya" },
          animethemeentries: [{ videos: [{ audio: { link: "https://a.animethemes.moe/op1.ogg" } }] }] }
      ]
    }]
  }
};

const gefunden = openings.openingAus(antwort, "Attack on Titan");
pruefe("Das erste Opening gewinnt",
  gefunden?.url === "https://a.animethemes.moe/op1.ogg",
  gefunden?.url || "nichts");
pruefe("Und der Liedname kommt mit",
  gefunden?.lied === "Guren no Yumiya", gefunden?.lied || "nichts");
pruefe("Der Vorspann schlaegt den Abspann",
  !gefunden?.url.includes("ed"), "OP vor ED, kleine Nummer vor grosser");

pruefe("Ein fremder Titel gewinnt nicht",
  openings.openingAus(antwort, "One Piece") === null,
  "die Suche liefert auch Aehnliches");

// Dieselben Daten, anders verschachtelt: flach, ohne search-Kasten, mit der
// Tonspur direkt am Video. Der Leser sucht nach Namen und nicht nach Pfaden -
// genau dafuer.
pruefe("Auch ohne den search-Kasten",
  openings.openingAus({ anime: antwort.search.anime }, "Attack on Titan")?.url
    === "https://a.animethemes.moe/op1.ogg");
pruefe("Auch mit der Adresse direkt am Video",
  openings.openingAus({
    anime: [{ name: "Naruto", animethemes: [{ type: "OP", sequence: 1,
      animethemeentries: [{ videos: [{ link: "https://v.animethemes.moe/naruto-op1.webm" }] }] }] }]
  }, "Naruto")?.url === "https://v.animethemes.moe/naruto-op1.webm");
pruefe("Auch wenn der Name des Anime unter title steht",
  openings.openingAus({
    anime: [{ title: "Bleach", animethemes: [{ type: "OP", sequence: 1,
      animethemeentries: [{ videos: [{ audio: { link: "https://a.animethemes.moe/b.ogg" } }] }] }] }]
  }, "Bleach")?.url === "https://a.animethemes.moe/b.ogg");

// --- Und jetzt der eigentliche Punkt: nichts davon darf werfen ---

const unsinn = [
  null, undefined, 0, 1, "", "kein json", true, [], {},
  { anime: null }, { anime: [] }, { anime: [null, 0, "x"] },
  { anime: [{ name: "Attack on Titan" }] },
  { anime: [{ name: "Attack on Titan", animethemes: null }] },
  { anime: [{ name: "Attack on Titan", animethemes: [{}] }] },
  { anime: [{ name: "Attack on Titan", animethemes: [{ type: "OP" }] }] },
  { anime: [{ name: "Attack on Titan", animethemes: [{ type: "OP",
    animethemeentries: [{ videos: [{ audio: { link: "javascript:alert(1)" } }] }] }] }] },
  { anime: [{ name: "Attack on Titan", animethemes: [{ type: "OP",
    animethemeentries: [{ videos: [{ audio: { link: 42 } }] }] }] }] },
  { fehler: "Not Found" }, { errors: [{ detail: "rate limit" }] }
];
let geworfen = 0;
let nichtNull = 0;
for (const fall of unsinn) {
  try {
    const wert = openings.openingAus(fall, "Attack on Titan");
    if (wert !== null) nichtNull += 1;
  } catch (fehler) {
    geworfen += 1;
    console.log("   wirft bei:", JSON.stringify(fall)?.slice(0, 60), "->", fehler.message);
  }
}
pruefe("Keine Antwort bringt den Leser zum Werfen", geworfen === 0,
  `${unsinn.length} Faelle, ${geworfen} Ausnahmen`);
pruefe("Und keine unbrauchbare liefert eine Adresse", nichtNull === 0,
  `${nichtNull} von ${unsinn.length} lieferten etwas`);
pruefe("Nur http und https zaehlen als Adresse",
  openings.openingAus({ anime: [{ name: "X", animethemes: [{ type: "OP",
    animethemeentries: [{ videos: [{ audio: { link: "javascript:alert(1)" } }] }] }] }] }, "X") === null,
  "eine Adresse aus einer fremden Antwort wird nicht blind uebernommen");

// Auch eine tief oder im Kreis verschachtelte Antwort darf nicht haengen.
const kreis = { anime: [{ name: "Attack on Titan", animethemes: [] }] };
kreis.selbst = kreis;
let hing = false;
try { openings.openingAus(kreis, "Attack on Titan"); } catch { hing = true; }
pruefe("Eine ringfoermige Antwort haengt nicht", !hing,
  "die Suche steigt hoechstens acht Ebenen tief");

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
