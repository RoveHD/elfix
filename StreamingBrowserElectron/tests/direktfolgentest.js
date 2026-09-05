"use strict";
// Welche Folge als naechste kommt.
//
// Das ist die Rechnung, an der ein Abend haengt: der Uebergang laeuft von
// selbst, und wer dabei in der falschen Folge landet, merkt es erst nach dem
// Vorspann. "Nummer plus eins" sieht richtig aus und ist es nicht - hier
// stehen die Faelle, in denen es danebengeht.
//
// Die Liste kommt aus der Anbieterseite (seitendaten.uebersichtSkript), und
// diese Proben tragen deren Form: Staffel, Nummer, Adresse und der Vermerk
// `gesperrt` fuer Nummern, hinter denen keine eigene Folge liegt.

const direktfolgen = require("../src/direktfolgen");

const pruefungen = [];
const pruefe = (name, bedingung, detail = "") => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

const folge = (staffel, nummer, extra = {}) => ({
  staffel,
  folge: nummer,
  url: `https://anbieter.example/anime/stream/serie/staffel-${staffel}/episode-${nummer}`,
  titel: "",
  gesperrt: false,
  ...extra
});
const bei = (season, episode) => ({ season, episode });

/* ------------------------------------------------------------ Der Normalfall */

const einfach = { titel: "Serie", folgen: [folge(1, 1), folge(1, 2), folge(1, 3)] };
pruefe("Nach Folge 1 kommt Folge 2",
  direktfolgen.naechste(einfach, bei(1, 1))?.folge === 2);
pruefe("Nach der letzten Folge kommt nichts",
  direktfolgen.naechste(einfach, bei(1, 3)) === null,
  "das Ende einer Serie ist kein Fehler");
pruefe("Eine Folge, die nicht in der Liste steht, hat keine naechste",
  direktfolgen.naechste(einfach, bei(1, 9)) === null,
  "raten waere hier besonders teuer");

/* ------------------------------------------------------------- Die Sonderfaelle */

const mitLuecke = { folgen: [folge(1, 1), folge(1, 3), folge(1, 4)] };
pruefe("Eine Luecke in der Nummerierung wird uebersprungen",
  direktfolgen.naechste(mitLuecke, bei(1, 1))?.folge === 3,
  "nicht die 2, die es gar nicht gibt");

const mitDoppelfolge = {
  folgen: [folge(1, 1), folge(1, 2, { gesperrt: true }), folge(1, 3)]
};
pruefe("Eine Nummer ohne eigene Folge wird uebergangen",
  direktfolgen.naechste(mitDoppelfolge, bei(1, 1))?.folge === 3,
  "hinter der 2 steht nur der Hinweis auf eine Doppelfolge");

const ohneAdresse = { folgen: [folge(1, 1), folge(1, 2, { url: "" }), folge(1, 3)] };
pruefe("Ein Eintrag ohne Adresse ist keine Folge",
  direktfolgen.naechste(ohneAdresse, bei(1, 1))?.folge === 3);

const zweiStaffeln = { folgen: [folge(1, 1), folge(1, 2), folge(2, 1), folge(2, 2)] };
pruefe("Am Staffelende geht es in der naechsten Staffel weiter",
  direktfolgen.naechste(zweiStaffeln, bei(1, 2))?.staffel === 2
  && direktfolgen.naechste(zweiStaffeln, bei(1, 2))?.folge === 1,
  "die Liste kennt beide Staffeln");

const durcheinander = { folgen: [folge(2, 1), folge(1, 2), folge(1, 1)] };
pruefe("Die Reihenfolge der Seite entscheidet nicht",
  direktfolgen.naechste(durcheinander, bei(1, 1))?.folge === 2,
  "sortiert wird nach Staffel und Nummer");

const nurGesperrte = { folgen: [folge(1, 1), folge(1, 2, { gesperrt: true })] };
pruefe("Folgt nur noch Gesperrtes, gibt es keine naechste",
  direktfolgen.naechste(nurGesperrte, bei(1, 1)) === null);

pruefe("Ohne Liste passiert nichts",
  direktfolgen.naechste(null, bei(1, 1)) === null
  && direktfolgen.naechste(einfach, null) === null);

/* ------------------------------------------------------------ Die Beschriftung */

pruefe("Mit Titel steht der Titel dabei",
  direktfolgen.beschriftung(folge(2, 5, { titel: "Der Anfang" })) === "S2 F5 · Der Anfang");
pruefe("Ohne Titel bleibt es bei der Nummer",
  direktfolgen.beschriftung(folge(2, 5)) === "S2 F5",
  "ein erfundener Titel waere eine Behauptung");
pruefe("Ohne Staffel heisst es einfach Folge",
  direktfolgen.beschriftung(folge(0, 3)) === "Folge 3");
pruefe("Nichts bleibt nichts",
  direktfolgen.beschriftung(null) === "");

/* ---------------------------------------------------------- Was zum Player geht */

const fuerPlayer = direktfolgen.fuerPlayer(
  { titel: "Serie", folgen: [folge(1, 2), folge(1, 1), folge(1, 3, { gesperrt: true })] },
  bei(1, 2)
);
pruefe("Die Liste kommt geordnet beim Player an",
  fuerPlayer.folgen.map((eintrag) => eintrag.folge).join(",") === "1,2,3");
pruefe("Und sie sagt, welche Folge laeuft",
  fuerPlayer.folgen.filter((eintrag) => eintrag.laeuft).length === 1
  && fuerPlayer.folgen.find((eintrag) => eintrag.laeuft).folge === 2,
  "der Player soll aus einer Adresse keine Nummer rechnen muessen");
pruefe("Gesperrte bleiben in der Liste, aber als gesperrt",
  fuerPlayer.folgen[2].gesperrt === true,
  "sie stehen auf der Seite, also stehen sie auch hier - nur anklicken kann man sie nicht");
pruefe("Ohne Stand gibt es keine Liste",
  direktfolgen.fuerPlayer(null, bei(1, 1)) === null);

/* ------------------------------------------------------------ Die Staffeln */

// Die Reiterzeile im Player wurde frueher aus den *Folgen* gebildet - und die
// stammen alle von einer Seite. Also gab es nie mehr als eine Staffel, die
// Zeile blendete sich weg, und man kam aus der laufenden Staffel nicht heraus.
// Die Uebersicht kennt die Staffeln; sie muessen nur mitgehen.
const mitStaffeln = direktfolgen.fuerPlayer({
  titel: "Attack on Titan",
  staffeln: [
    { staffel: 2, url: "https://a.example/serie/aot/staffel-2" },
    { staffel: 1, url: "https://a.example/serie/aot/staffel-1" },
    { staffel: 0, url: "https://a.example/serie/aot/staffel-0" },
    { staffel: 3, url: "" }
  ],
  folgen: [{ staffel: 1, folge: 1, url: "https://a.example/serie/aot/staffel-1/episode-1" }]
}, { season: 1, episode: 1 });

pruefe("Die Staffeln reisen zum Player mit",
  mitStaffeln.staffeln.length === 2,
  JSON.stringify(mitStaffeln.staffeln.map((e) => e.staffel)));
pruefe("Und zwar der Reihe nach",
  mitStaffeln.staffeln[0].staffel === 1 && mitStaffeln.staffeln[1].staffel === 2);
pruefe("Ohne Adresse ist eine Staffel nicht zu oeffnen",
  mitStaffeln.staffeln.every((eintrag) => eintrag.url),
  "ein Reiter, der nichts laedt, ist schlimmer als keiner");
pruefe("Staffel 0 zaehlt nicht",
  mitStaffeln.staffeln.every((eintrag) => eintrag.staffel > 0));
pruefe("Ohne Staffelangabe bleibt die Liste leer statt undefiniert",
  Array.isArray(direktfolgen.fuerPlayer({ titel: "X", folgen: [] }, null).staffeln),
  "der Player laeuft sonst in einen Fehler beim Zeichnen");

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`
${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
