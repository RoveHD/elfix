"use strict";
// Das Opening zur Serie des Jahres.
//
// Geschrieben wurde die Anbindung blind: api.animethemes.moe ist aus der
// Entwicklungsumgebung gesperrt, kein einziger Aufruf war moeglich. Und sie war
// falsch - herausgekommen ist das erst, als eine *echte* Antwort vorlag.
//
// Sie liegt jetzt in proben/animethemes-shingeki.json und ist die Grundlage
// dieser Datei. Zwei Dinge hat sie aufgedeckt, die kein noch so vorsichtiger
// Leser haette erraten koennen:
//
//   Der Titelvergleich war zu streng. Die Anbieter nennen die Serie "Attack on
//   Titan", der Katalog fuehrt sie als "Shingeki no Kyojin" - kein Treffer,
//   keine Musik, und zwar bei so ziemlich jedem Anime mit englischem Titel.
//
//   `sequence` ist oft null. Die Nummer steht dann nur im slug ("OP1", "OP2").
//   Ohne Rueckfall darauf waeren alle Openings gleichauf.
//
// Der zweite Teil bleibt, was er war: dass die Anbindung bei jeder unerwarteten
// Antwort still bleibt statt zu stoeren.

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

// --- Gegen die echte Antwort ---

const echt = require(path.join(__dirname, "proben", "animethemes-shingeki.json"));
const aot = openings.openingAus(echt, "Attack on Titan");

pruefe("Der englische Titel findet die japanische Serie",
  aot !== null,
  "die Anbieter sagen \"Attack on Titan\", der Katalog \"Shingeki no Kyojin\"");
pruefe("Und zwar das erste Opening der Grundserie",
  aot?.lied === "Guren no Yumiya", aot?.lied || "nichts");
pruefe("Aus der Fernsehfassung, nicht aus dem Recap-Film",
  aot?.anime === "Shingeki no Kyojin", aot?.anime || "nichts");
pruefe("Die Adresse zeigt auf die Tonspur",
  aot?.url === "https://a.animethemes.moe/ShingekiNoKyojin-OP1.ogg", aot?.url || "nichts");

// Das waere der naheliegende Fehler gewesen: der erste Treffer der Suche ist
// "Shingeki no Kyojin: Chronicle", ein Zusammenschnitt, dessen einziges Stueck
// ein Abspann ist - und den der Katalog selbst als Spoiler kennzeichnet.
pruefe("Der erste Treffer der Suche gewinnt nicht einfach",
  echt.search.anime[0].name === "Shingeki no Kyojin: Chronicle"
  && aot?.anime !== "Shingeki no Kyojin: Chronicle",
  "ein Recap-Film mit einem Abspann ist nicht das Opening der Serie");
pruefe("Die Schulparodie auch nicht",
  aot?.lied !== "Seishun wa Hanabi no You ni",
  "Shingeki! Kyojin Chuugakkou ist eine andere Serie");
pruefe("Und die Fortsetzungen ebenfalls nicht",
  aot?.lied !== "Shinzou wo Sasageyo!" && aot?.lied !== "Boku no Sensou",
  "zwischen Grundserie und fuenf Fortsetzungen ist die aelteste gemeint");

pruefe("Der genaue Titel bleibt die erste Wahl",
  openings.openingAus(echt, "Shingeki no Kyojin")?.lied === "Guren no Yumiya",
  "wo er trifft, ist er unbestechlich");

// Gefragt wird der Katalog inzwischen auch zu Titeln, die die Anbieter als
// gewoehnliche Serie fuehren - darunter sind reichlich Anime. Fuer die faellt
// aber die Nachsicht der Suche weg: raten darf sie nur, wo Anime draufsteht.
pruefe("Ohne Anime als Gattung wird nicht geraten",
  openings.openingAus(echt, "Attack on Titan", false) === null,
  "eine Krimiserie bekaeme sonst das Opening des aehnlichsten Anime");
pruefe("Der genaue Treffer zaehlt trotzdem",
  openings.openingAus(echt, "Shingeki no Kyojin", false)?.lied === "Guren no Yumiya",
  "so bekommt der als Serie gefuehrte Anime seine Musik doch");
pruefe("Und geraten wird nur ohne genauen Treffer",
  openings.besterAnime([{ name: "Naruto", media_format: "TV", year: 2002 }], "Naruto", false).length === 1
  && openings.besterAnime([{ name: "Bleach", media_format: "TV", year: 2004 }], "Naruto", false).length === 0);

// sequence ist in der echten Antwort oft null - die Nummer steht im slug.
pruefe("Die Nummer kommt notfalls aus dem slug",
  openings.nummerAus({ sequence: null, slug: "OP2" }) === 2
  && openings.nummerAus({ sequence: 1, slug: "OP1" }) === 1
  && openings.nummerAus({ sequence: null, slug: "OP1-TV" }) === 1
  && openings.nummerAus({}) === 1);
pruefe("Bei gleicher Nummer schlaegt der Vorspann den Abspann",
  openings.openingAus({ anime: [{ name: "X", media_format: "TV", animethemes: [
    { type: "ED", slug: "ED1", song: { title: "Abspann" }, animethemeentries: [
      { videos: [{ audio: { link: "https://a/ed.ogg" } }] }] },
    { type: "OP", slug: "OP1", song: { title: "Vorspann" }, animethemeentries: [
      { videos: [{ audio: { link: "https://a/op.ogg" } }] }] }
  ] }] }, "X")?.lied === "Vorspann");

// Der Katalog kennzeichnet Stuecke, die das Ende verraten. Ein Rueckblick, der
// seine eigene Pointe schuetzt, sollte nicht die der Serie ausplaudern.
pruefe("Ein als Spoiler gekennzeichnetes Stueck kommt zuletzt",
  openings.openingAus({ anime: [{ name: "X", media_format: "TV", animethemes: [
    { type: "OP", slug: "OP1", song: { title: "Verraet das Ende" }, animethemeentries: [
      { spoiler: true, videos: [{ audio: { link: "https://a/spoiler.ogg" } }] }] },
    { type: "ED", slug: "ED1", song: { title: "Harmlos" }, animethemeentries: [
      { spoiler: false, videos: [{ audio: { link: "https://a/ok.ogg" } }] }] }
  ] }] }, "X")?.lied === "Harmlos");

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
