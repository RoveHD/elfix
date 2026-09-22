"use strict";

// Derselbe Titel, zweimal in derselben Runde.
//
// Der gemeldete Fall, vom Telefon: in "Gemeinsam weiterschauen" stand "Black
// Torch" zweimal - einmal Staffel 1 Folge 12, einmal Folge 11, beide mit
// "⇄ Bangus". Geschaut war bis Folge 10, und jeden Samstag kommt eine neue.
//
// Die Ursache ist nicht das Archivieren und nicht der Nachschub. Es ist das
// Binden: der lokale Eintrag wurde ueber "irgendein Eintrag dieser Serie" an
// den Raum gehaengt (Bestand.zuSerie), und das war oft der *private*. Er bekam
// den Raum aufgestempelt und stand von da an neben dem echten Raum-Eintrag -
// der lief mit der Runde weiter, der andere blieb stehen. Jede neue Folge trieb
// die beiden weiter auseinander.
//
// Geprueft wird deshalb dreierlei:
//
//   1. die geteilte Regel, nach der ein Raum-Eintrag gefunden wird (Raum und
//      Serie, nie Titel, nie volle Adresse),
//   2. wen das Binden ueberhaupt anfassen darf,
//   3. dass eine Ablage, in der schon zwei stehen, sich wieder geradezieht -
//      ohne dass dabei ein Stand verloren geht.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const fortschritt = require("../src/fortschritt");

const WURZEL = path.join(__dirname, "..");
const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").replace(/\r\n/g, "\n");
const MAIN_ACTIVITY = fs.readFileSync(
  path.join(WURZEL, "../android/app/src/main/java/local/elflix/android/MainActivity.java"), "utf8");
const WATCHPARTY_JAVA = fs.readFileSync(
  path.join(WURZEL, "../android/app/src/main/java/local/elflix/android/Watchparty.java"), "utf8");
const BESTAND_JAVA = fs.readFileSync(
  path.join(WURZEL, "../android/app/src/main/java/local/elflix/android/Bestand.java"), "utf8");
const BRUECKE = fs.readFileSync(
  path.join(WURZEL, "../android/app/src/main/assets/kern/eigen/watchparty-bruecke.js"), "utf8");

const pruefungen = [];
const pruefe = (name, bedingung, detail) => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

const SERIE = "https://aniworld.to/anime/stream/black-torch";
const folge = (nummer) => `${SERIE}/staffel-1/episode-${nummer}`;

function eintrag(nummer, raum, zusatz = {}) {
  return {
    id: `id-${nummer}-${raum || "privat"}`,
    title: "Black Torch",
    url: folge(nummer),
    watchpartyRoom: raum,
    season: 1,
    episode: nummer,
    lastWatchedAt: `2026-09-${String(nummer).padStart(2, "0")}T10:00:00.000Z`,
    ...zusatz
  };
}

// --- 1. Die geteilte Regel ---------------------------------------------------

{
  const raumEintrag = eintrag(12, "Bangus");
  const privat = eintrag(11, "");
  const andereRunde = eintrag(9, "Kaffee");
  const liste = [privat, andereRunde, raumEintrag];

  pruefe("Der Raum-Eintrag wird ueber Raum und Serie gefunden - auch eine Folge weiter",
    fortschritt.watchpartyEintragFinden(liste, "Bangus", folge(13)) === raumEintrag);
  pruefe("Der private Eintrag gehoert keiner Runde",
    fortschritt.watchpartyEintragFinden(liste, "Kaffee", folge(13)) === andereRunde
    && fortschritt.privaterEintragFinden(liste, folge(1)) === privat);
  pruefe("Und ohne Raum wird nichts gefunden",
    fortschritt.watchpartyEintragFinden(liste, "", folge(12)) === null);
  pruefe("Eine fremde Serie trifft nicht",
    fortschritt.watchpartyEintragFinden(liste, "Bangus",
      "https://aniworld.to/anime/stream/bleach/staffel-1/episode-1") === null);
}

// --- 2. Wen das Binden anfassen darf ----------------------------------------

{
  const raumEintrag = eintrag(12, "Bangus");
  const privat = eintrag(11, "");
  const urteil = fortschritt.raumBindungWaehlen([privat, raumEintrag], folge(12), "Bangus");
  pruefe("Gibt es den Eintrag der Runde schon, wird nichts gestempelt",
    urteil.art === "nichts" && urteil.eintrag === raumEintrag,
    "genau hier entstand die Dublette");
}

{
  const privat = eintrag(11, "");
  const urteil = fortschritt.raumBindungWaehlen([privat], folge(12), "Bangus");
  pruefe("Gibt es nur den eigenen, wird er der Eintrag der Runde",
    urteil.art === "binden" && urteil.eintrag === privat);
}

{
  const fremd = eintrag(9, "Kaffee");
  const urteil = fortschritt.raumBindungWaehlen([fremd], folge(12), "Bangus");
  pruefe("Der Eintrag einer anderen Runde wird nie umgehaengt",
    urteil.art === "nichts" && urteil.eintrag === null,
    "er ist der Stand jener Runde");
}

{
  const urteil = fortschritt.raumBindungWaehlen([], folge(12), "Bangus");
  pruefe("Ohne jeden Eintrag geschieht nichts",
    urteil.art === "nichts" && urteil.eintrag === null,
    "er entsteht beim naechsten Raumzustand");
}

// --- 3. Die Reparatur --------------------------------------------------------

{
  // Genau der Bildschirm aus der Meldung.
  const weiter = eintrag(12, "Bangus");
  const stehengeblieben = eintrag(11, "Bangus");
  const urteil = fortschritt.raumDublettenZusammenlegen([weiter, stehengeblieben]);
  pruefe("Zwei in derselben Runde: der weitere bleibt der Eintrag der Runde",
    urteil.geaendert && weiter.watchpartyRoom === "Bangus",
    JSON.stringify(urteil.favoriten.map((e) => `${e.episode}:${e.watchpartyRoom || "privat"}`)));
  pruefe("Der stehengebliebene wird wieder privat, statt geloescht zu werden",
    stehengeblieben.watchpartyRoom === "" && urteil.entfernt.length === 0
    && urteil.favoriten.length === 2,
    "sein Stand ist der eigene und waere sonst weg");
  pruefe("Danach steht in der Runde genau einer",
    urteil.favoriten.filter((e) => e.watchpartyRoom === "Bangus").length === 1);
}

{
  // Und wenn der eigene Stand ohnehin schon dasteht, ist die zweite Kopie nur
  // eine Kopie.
  const weiter = eintrag(12, "Bangus");
  const kopie = eintrag(11, "Bangus");
  const privat = eintrag(10, "");
  const urteil = fortschritt.raumDublettenZusammenlegen([weiter, kopie, privat]);
  pruefe("Gibt es den eigenen Eintrag schon, faellt die Kopie weg",
    urteil.entfernt.includes(kopie) && urteil.favoriten.length === 2
    && urteil.favoriten.includes(privat) && urteil.favoriten.includes(weiter),
    JSON.stringify(urteil.favoriten.map((e) => `${e.episode}:${e.watchpartyRoom || "privat"}`)));
}

{
  const bangus = eintrag(12, "Bangus");
  const kaffee = eintrag(12, "Kaffee");
  const privat = eintrag(11, "");
  const urteil = fortschritt.raumDublettenZusammenlegen([bangus, kaffee, privat]);
  pruefe("Zwei Runden mit demselben Titel bleiben zwei Runden",
    !urteil.geaendert && bangus.watchpartyRoom === "Bangus" && kaffee.watchpartyRoom === "Kaffee",
    "das ist ausdruecklich gewollt");
}

{
  const urteil = fortschritt.raumDublettenZusammenlegen([eintrag(12, "Bangus"), eintrag(4, "")]);
  pruefe("Eine gesunde Ablage wird nicht angefasst", !urteil.geaendert);
}

{
  // Gleiche Folge, aber einer traegt den juengeren Stand der Runde.
  const alt = eintrag(12, "Bangus", { watchpartyAt: "2026-09-01T10:00:00.000Z" });
  const neu = eintrag(12, "Bangus", { watchpartyAt: "2026-09-20T10:00:00.000Z" });
  fortschritt.raumDublettenZusammenlegen([alt, neu]);
  pruefe("Bei gleicher Folge entscheidet der juengere Stand",
    neu.watchpartyRoom === "Bangus" && alt.watchpartyRoom === "");
}

// --- Der Rechner: die zweite Stufe der Suche --------------------------------

{
  const quelle = MAIN.match(/function lokalerWatchpartyEintrag\([^]*?^}/m)[0];
  const kontext = vm.createContext({
    fortschritt,
    String,
    // Der Titelschluessel geht daneben - genau der Fall, den die zweite Stufe
    // auffangen soll ("Pokémon" gegen "Pokemon").
    watchpartyKey: () => "serie:andererschluessel",
    favorites: [eintrag(11, "Bangus"), eintrag(4, "")]
  });
  vm.runInContext(quelle, kontext);
  const treffer = vm.runInContext(
    `lokalerWatchpartyEintrag("serie:blacktorch", "Bangus", ${JSON.stringify(folge(12))})`, kontext);
  pruefe("Am Rechner findet die zweite Stufe den Eintrag ueber die Adresse",
    treffer && treffer.watchpartyRoom === "Bangus",
    "ohne sie legte der Aufrufer einen zweiten an");
  const privat = vm.runInContext(
    `lokalerWatchpartyEintrag("serie:blacktorch", "", ${JSON.stringify(folge(12))})`, kontext);
  pruefe("Und ohne Raum den eigenen", privat && privat.watchpartyRoom === "");
}

pruefe("Der Raumzustand zieht die Ablage gerade",
  /function raumEintraegeSichern\([^]*?raumDublettenHeilen\(\)/m.test(MAIN)
  && /raumDublettenZusammenlegen/.test(BRUECKE),
  "auf beiden Geraeten, sonst bleibt die Dublette auf dem anderen stehen");

// --- Android: die Bindung ----------------------------------------------------
//
// Java laeuft hier nicht. Was sich ohne Geraet festhalten laesst, ist die
// Stelle: es darf an keinem Bindungsweg mehr "irgendein Eintrag der Serie"
// stehen.

pruefe("Android bindet ueber die raumbewusste Regel",
  /public boolean raumBindungSetzen\(/.test(BESTAND_JAVA)
  && /public boolean raumBindungLoesen\(/.test(BESTAND_JAVA)
  && /public Favorite zuSerieImRaum\(/.test(BESTAND_JAVA));
pruefe("Und kein Bindungsweg greift mehr zu zuSerie",
  !/raumBindungNachholen[^]*?zuSerie\(/.test(MAIN_ACTIVITY)
  && !/private void raumAmEintrag\([^]*?zuSerie\([^]*?raumSetzen\(/.test(WATCHPARTY_JAVA)
  && !/public void raumBinden\([^]*?zuSerie\([^]*?raumSetzen\(/.test(WATCHPARTY_JAVA),
  "genau dort bekam der private Eintrag den Raum aufgestempelt");

console.log(`${pruefungen.filter(Boolean).length}/${pruefungen.length} bestanden`);
process.exit(pruefungen.every(Boolean) ? 0 : 1);
