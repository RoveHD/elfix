"use strict";

// Der Renderer hat kein Node/DOM-Testbett. Diese Probe prueft deshalb die
// vertragliche Grenze: Die Projektion behaelt das Badge, waehrend der
// Hauptprozess die Netzarbeit nur nach dem sofortigen Listen-Ergebnis startet.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const direktfolgen = require("../src/direktfolgen");

const WURZEL = path.join(__dirname, "..");
const main = fs.readFileSync(path.join(WURZEL, "src", "main.js"), "utf8").replace(/\r/g, "");
const spieler = fs.readFileSync(path.join(WURZEL, "src", "renderer", "spieler.js"), "utf8").replace(/\r/g, "");
const preload = fs.readFileSync(path.join(WURZEL, "src", "spieler-preload.js"), "utf8").replace(/\r/g, "");

const filler = {
  type: "mixed_canon/filler", label: "Canon / Filler", source: "AnimeFillerList",
  sourceUrl: "https://www.animefillerlist.com/shows/example", episode: 14
};
const projektion = direktfolgen.fuerPlayer({
  titel: "Example", folgen: [{ staffel: 1, folge: 14, url: "https://aniworld.to/anime/stream/example/staffel-1/episode-14", filler }]
}, { season: 1, episode: 14 });

assert.deepStrictEqual(projektion.folgen[0].filler, filler, "Filler-Metadaten erreichen den Player");
assert.notStrictEqual(projektion.folgen[0].filler, filler, "die Player-Projektion teilt kein wandelbares Filler-Objekt");
assert.match(preload, /filler: \(staffelUrl = ""\) => ipcRenderer\.invoke\("spieler:folgen-filler"/,
  "die sichere Preload-Bruecke fragt den Nachtrag erst nach dem Zeichnen an");
assert.match(main, /const lauf = spielerLauf;[\s\S]{0,700}await folgenlisteLesen[\s\S]{0,130}spielerLauf !== lauf/,
  "eine alte Listenantwort wird nach dem await verworfen");
assert.match(main, /anreichern\(stand, \{ url: ziel \}\)/,
  "Nicht-Anime wird nicht durch ein erzwungenes art: anime etikettiert");
assert.match(spieler, /badge\.title = `Quelle: \$\{filler\.source \|\| "AnimeFillerList"\}/,
  "das Badge nennt die Quelle, ohne die gesperrte Player-Navigation zu oeffnen");

const start = spieler.indexOf("async function fillerNachtragen");
const ende = spieler.indexOf("\n/**", start);
assert.ok(start >= 0 && ende > start, "der Renderer hat einen isolierten Nachtragspfad");
const nachtragCode = spieler.slice(start, ende);
const wartend = [];
const context = {
  Map, JSON,
  folgenFassung: 1,
  folgenStand: { folgen: [{ url: "folge-1", filler: undefined }] },
  folgenPanel: { hidden: true },
  folgenListe: { querySelectorAll: () => [] },
  fillerBadgeSetzen() {},
  bruecke: { filler: () => new Promise((resolve) => wartend.push(resolve)) }
};
vm.createContext(context);
vm.runInContext(`${nachtragCode}; globalThis.fillerNachtragen = fillerNachtragen;`, context);

(async () => {
  // Warm oder kalt: erst nachdem `folgenStand` bereits gesetzt wurde, startet
  // der Request. Ein sofort erfuellter Nachtrag findet darum immer eine Liste.
  const warm = context.fillerNachtragen("staffel-1", context.folgenFassung);
  wartend.shift()({ folgen: [{ url: "folge-1", filler }] });
  await warm;
  assert.deepStrictEqual(context.folgenStand.folgen[0].filler, filler,
    "ein sofortiger Cache-Nachtrag erreicht die bereits gezeichnete Liste");

  // Staffel B darf die noch laufende Einordnung von A nicht verwerfen. Beide
  // Antworten treffen in derselben Titelliste ein, auch wenn B zuerst fertig
  // wird und A danach schon aus dem lokalen Folgenbestand angezeigt wird.
  const a = { ...filler, episode: 1 };
  const b = { ...filler, type: "filler", label: "Filler", episode: 2 };
  context.folgenStand = { folgen: [{ url: "staffel-a", filler: undefined }, { url: "staffel-b", filler: undefined }] };
  const langsamA = context.fillerNachtragen("staffel-a", context.folgenFassung);
  const schnellB = context.fillerNachtragen("staffel-b", context.folgenFassung);
  const loeseA = wartend.shift();
  const loeseB = wartend.shift();
  loeseB({ folgen: [{ url: "staffel-b", filler: b }] });
  await schnellB;
  loeseA({ folgen: [{ url: "staffel-a", filler: a }] });
  await langsamA;
  assert.deepStrictEqual(context.folgenStand.folgen.map((eintrag) => eintrag.filler), [a, b],
    "eine spaete Staffel-A-Antwort bleibt nach dem Laden von Staffel B erhalten");

  const alt = context.fillerNachtragen("staffel-1", context.folgenFassung);
  context.folgenFassung++;
  context.folgenStand = { folgen: [{ url: "neuer-titel", filler: undefined }] };
  wartend.shift()({ folgen: [{ url: "folge-1", filler }] });
  await alt;
  assert.equal(context.folgenStand.folgen[0].filler, undefined,
    "ein spaeter Nachtrag schreibt nicht in den inzwischen anderen Titel");
  console.log("OK Desktop-Filler: Projektion, warme und parallele Staffel-Nachtraege, Titelwechsel-Sperre");
})().catch((fehler) => { console.error(fehler); process.exitCode = 1; });
