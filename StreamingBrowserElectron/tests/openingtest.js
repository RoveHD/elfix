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
//   Der Ausweg war zuerst falsch gewaehlt: ohne Treffer wurde genommen, was die
//   Suche eben ausgeworfen hatte, und damit lief unter "Prison Break" irgendein
//   Anime-Opening. Geholt werden jetzt die Zweitnamen, und ohne Treffer bleibt
//   es still.
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
const snk = openings.openingAus(echt, "Shingeki no Kyojin");

pruefe("Aus der echten Antwort kommt das erste Opening der Grundserie",
  snk?.lied === "Guren no Yumiya", snk?.lied || "nichts");
pruefe("Aus der Fernsehfassung, nicht aus dem Recap-Film",
  snk?.anime === "Shingeki no Kyojin", snk?.anime || "nichts");
pruefe("Die Adresse zeigt auf die Tonspur",
  snk?.url === "https://a.animethemes.moe/ShingekiNoKyojin-OP1.ogg", snk?.url || "nichts");

// Das waere der naheliegende Fehler gewesen: der erste Treffer der Suche ist
// "Shingeki no Kyojin: Chronicle", ein Zusammenschnitt, dessen einziges Stueck
// ein Abspann ist - und den der Katalog selbst als Spoiler kennzeichnet.
pruefe("Der erste Treffer der Suche gewinnt nicht einfach",
  echt.search.anime[0].name === "Shingeki no Kyojin: Chronicle"
  && snk?.anime !== "Shingeki no Kyojin: Chronicle",
  "ein Recap-Film mit einem Abspann ist nicht das Opening der Serie");
pruefe("Die Schulparodie auch nicht",
  snk?.lied !== "Seishun wa Hanabi no You ni",
  "Shingeki! Kyojin Chuugakkou ist eine andere Serie");
pruefe("Und die Fortsetzungen ebenfalls nicht",
  snk?.lied !== "Shinzou wo Sasageyo!" && snk?.lied !== "Boku no Sensou",
  "zwischen Grundserie und fuenf Fortsetzungen ist die aelteste gemeint");
pruefe("Eine Fortsetzung zaehlt trotzdem als dieselbe Serie",
  openings.istFortsetzung("Shingeki no Kyojin", "Shingeki no Kyojin Season 2")
  && !openings.istFortsetzung("Naruto", "Naruto Shippuuden"),
  "gaebe es die Grundserie nicht, waere ihr zweiter Teil richtiger als nichts");

// --- Und der Fehler in die andere Richtung -----------------------------------
//
// Zwischendurch wurde geraten: ohne Titeltreffer nahm der Leser, was die Suche
// eben ausgeworfen hatte. Zu "Prison Break" liefert eine Anime-Suche trotzdem
// Anime, und darunter lief dann irgendein fremdes Opening - gemeldet als
// "spielt absolut falsche Musik". Eine Serie, zu der es nichts gibt, hat kein
// Opening.

const fremd = {
  search: {
    anime: [
      { name: "Break Blade", media_format: "TV", year: 2010, animethemes: [
        { type: "OP", slug: "OP1", song: { title: "Fate" }, animethemeentries: [
          { videos: [{ audio: { link: "https://a/fremd.ogg" } }] }] }] },
      { name: "Prison School", media_format: "TV", year: 2015, animethemes: [
        { type: "OP", slug: "OP1", song: { title: "Ai no Prison" }, animethemeentries: [
          { videos: [{ audio: { link: "https://a/fremd2.ogg" } }] }] }] }
    ]
  }
};
pruefe("Ohne Titeltreffer bleibt es still",
  openings.openingAus(fremd, "Prison Break") === null,
  "lieber kein Opening als das einer fremden Serie");
pruefe("Auch die echte Antwort gibt zu einem fremden Titel nichts her",
  openings.openingAus(echt, "Prison Break") === null);

// --- Die Zweitnamen ----------------------------------------------------------
//
// Und genau deshalb werden sie mitgeholt: der Katalog fuehrt die Serie als
// "Shingeki no Kyojin" und "Attack on Titan" als Zweitnamen. Ohne sie muesste
// zwischen "kein Treffer" und "irgendetwas nehmen" gewaehlt werden, und beides
// war schon falsch.

pruefe("Die Anfrage holt die Zweitnamen mit",
  openings.anfrageUrl("Attack on Titan").includes("animesynonyms"),
  "sonst findet der englische Titel die japanische Serie nicht");

const mitZweitnamen = { anime: [{
  name: "Shingeki no Kyojin", media_format: "TV", year: 2013,
  animesynonyms: [{ text: "Attack on Titan" }],
  animethemes: [{ type: "OP", slug: "OP1", song: { title: "Guren no Yumiya" },
    animethemeentries: [{ videos: [{ audio: { link: "https://a/op.ogg" } }] }] }]
}] };
pruefe("Der englische Titel findet die japanische Serie ueber den Zweitnamen",
  openings.openingAus(mitZweitnamen, "Attack on Titan")?.lied === "Guren no Yumiya",
  "die Anbieter sagen \"Attack on Titan\", der Katalog \"Shingeki no Kyojin\"");
pruefe("Ein fremder Titel trifft auch dort nicht",
  openings.openingAus(mitZweitnamen, "Prison Break") === null);
pruefe("Die Liedtitel zaehlen nicht als Name der Serie",
  openings.namenVon(mitZweitnamen.anime[0]).join("|") === "Shingeki no Kyojin|Attack on Titan",
  "eine Serie, die heisst wie irgendein Opening, waere sonst ein Treffer");

// Die aufgezeichnete Antwort stammt aus der Zeit vor den Zweitnamen - die
// Anfrage holte sie noch nicht. Sie kann den englischen Titel deshalb nicht
// finden, und das steht hier, damit niemand daraus schliesst, es sei kaputt.
pruefe("Die alte Aufzeichnung kennt keine Zweitnamen",
  JSON.stringify(echt).includes("synonym") === false
  && openings.openingAus(echt, "Attack on Titan") === null,
  "sie wurde ohne include[anime]=animesynonyms geholt");

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
