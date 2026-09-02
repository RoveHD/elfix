"use strict";
// Der Autoplay-Schalter in der Anbieterseite.
//
// Er ist kein zweiter Schalter neben dem in den Einstellungen, sondern derselbe:
// er meldet seinen Stand nach aussen, und dort wird die Einstellung geschrieben.
// Deshalb wird hier beides geprueft - was er anzeigt und was er meldet.
//
// Ausgefuehrt, nicht gelesen. Ob ein Knopf wirklich entsteht, ob ein zweites
// Einspielen ihn verdoppelt und ob er nach ein paar Sekunden Stille verschwindet,
// sieht man einem Quelltext nicht an.

const seite = require("./seite");

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}

function schalterBauen(an) {
  const buehne = seite.seiteBauen();
  const ergebnis = buehne.lauf(seite.skriptBauen("autoplaySchalterScript", an));
  const schalter = buehne.holen("__elfixAutoplaySchalter");
  return {
    buehne, ergebnis, schalter,
    leiste: () => buehne.leiste(),
    bahn: () => schalter.children.find((k) => k.tag === "span" && k.children.length === 1),
    griff: () => schalter.children.find((k) => k.tag === "span" && k.children.length === 1).children[0],
    beschriftung: () => schalter.children.find((k) => k.tag === "span" && k.children.length === 0),
    an: () => schalter.dataset.an === "ja",
    klick: () => schalter.ausloesen("click"),
    nochmal: (neu) => buehne.lauf(seite.skriptBauen("autoplaySchalterScript", neu))
  };
}

// --- Er entsteht ------------------------------------------------------------

const s = schalterBauen(true);
pruefe("Der Schalter meldet sich als eingerichtet",
  String(s.ergebnis).startsWith("autoplay-da@"),
  String(s.ergebnis));
pruefe("Er haengt in der Leiste links oben",
  Boolean(s.leiste()) && s.schalter.parentElement === s.leiste(),
  "dieselbe Leiste wie der Chat, sonst laegen sie uebereinander");
pruefe("Die Leiste sitzt links oben",
  s.leiste().style.left === "22px" && s.leiste().style.top === "22px");
pruefe("Er steht links vom Chat",
  s.schalter.style.order === "1",
  "er ist immer da, der Chat kommt und geht - der soll nicht springen");
pruefe("Er ist beschriftet",
  s.beschriftung().textContent === "Autoplay");

// --- Er zeigt den Stand -----------------------------------------------------

pruefe("Eingeschaltet uebernommen: der Schalter steht auf an",
  s.an() && s.schalter.attribute["aria-pressed"] === "true",
  s.schalter.attribute["aria-pressed"]);
pruefe("und sieht auch so aus",
  s.bahn().style.background === "#3ea6ff" && s.griff().style.transform === "translateX(14px)",
  `${s.bahn().style.background} / ${s.griff().style.transform}`);

const aus = schalterBauen(false);
pruefe("Ausgeschaltet uebernommen: der Schalter steht auf aus",
  !aus.an() && aus.schalter.attribute["aria-pressed"] === "false"
  && aus.griff().style.transform === "translateX(0)",
  aus.griff().style.transform);

// --- Er meldet, was er tut --------------------------------------------------

s.klick();
pruefe("Ein Klick legt ihn sofort um",
  !s.an() && s.griff().style.transform === "translateX(0)",
  "die Einstellung liegt eine Prozessgrenze weiter - warten fuehlte sich kaputt an");
pruefe("und meldet den neuen Stand nach aussen",
  s.buehne.meldungen.includes("__elfix:autoplay:0"),
  s.buehne.meldungen.join(" | "));

s.klick();
pruefe("Noch ein Klick schaltet ihn wieder an",
  s.an() && s.buehne.meldungen.includes("__elfix:autoplay:1"),
  s.buehne.meldungen.join(" | "));

// --- Ein zweites Einspielen -------------------------------------------------

const vorher = s.leiste().children.length;
const antwort = s.nochmal(false);
pruefe("Ein zweites Einspielen legt keinen zweiten Schalter an",
  s.leiste().children.length === vorher && antwort === "autoplay-schon-da",
  String(antwort));
pruefe("sondern zieht den Stand nach",
  !s.an(),
  "die Einstellung kann sich geaendert haben, waehrend die Folge lief");

// --- Sichtbarkeit -----------------------------------------------------------

pruefe("Nach einer Mausbewegung ist er da",
  s.schalter.style.opacity === "1");
s.buehne.warten(4000);
pruefe("Steht die Maus still, verschwindet er",
  s.schalter.style.opacity === "0",
  "wer schaut, bewegt die Maus nicht");
s.buehne.mausBewegen();
pruefe("Jede Bewegung holt ihn zurueck",
  s.schalter.style.opacity === "1");

s.schalter.ausloesen("mouseenter");
s.buehne.warten(4000);
pruefe("Unter dem Zeiger bleibt er stehen",
  s.schalter.style.opacity === "1",
  "sonst verblasste er unter der eigenen Hand");
s.schalter.ausloesen("mouseleave");
s.buehne.warten(4000);

// Der Fehler, der ELFIX 1.32.1 ausgeloest hat: das Skript laeuft im
// Fortschritts-Takt erneut, und jedes Einspielen weckte die Leiste. Sie blendete
// sich damit alle paar Sekunden von selbst ein, waehrend man dasass und schaute.
pruefe("Ein erneutes Einspielen weckt ihn nicht",
  (() => {
    s.nochmal(false);
    return s.schalter.style.opacity === "0";
  })(),
  "wer schaut, bewegt die Maus nicht - dann soll auch nichts aufblenden");
pruefe("Ein geaenderter Stand dagegen schon",
  (() => {
    s.nochmal(true);
    return s.schalter.style.opacity === "1";
  })(),
  "das ist eine Nachricht und kein Takt");
s.buehne.warten(4000);
pruefe("und verblasst danach wieder",
  s.schalter.style.opacity === "0");

// --- Tasten -----------------------------------------------------------------

pruefe("Tasten auf dem Schalter erreichen den Player nicht",
  s.schalter.ausloesen("keydown").gestoppt === true,
  "sonst pausierte die Leertaste, waehrend man schaltet");

// --- Zusammen mit dem Chat --------------------------------------------------

const zusammen = seite.seiteBauen();
zusammen.lauf(seite.skriptBauen("autoplaySchalterScript", true));
zusammen.lauf(seite.skriptBauen("watchpartyChatScript", { name: "Du" }));
const leiste = zusammen.leiste();
pruefe("Chat und Schalter teilen sich eine Leiste",
  leiste.children.length === 2,
  `${leiste.children.length} Kinder`);
pruefe("Der Schalter steht links, der Chat rechts",
  zusammen.holen("__elfixAutoplaySchalter").style.order === "1"
  && zusammen.holen("__elfixChat").style.order === "2");

// Der Chat geht, der Schalter bleibt - und mit ihm die Leiste.
zusammen.lauf("window.__elfixChat.entfernen()");
pruefe("Endet die Runde, bleibt der Schalter stehen",
  Boolean(zusammen.leiste()) && zusammen.leiste().children.length === 1
  && Boolean(zusammen.holen("__elfixAutoplaySchalter")),
  "der Schalter haengt an keiner Watchparty");

// Und ohne alles gehoert auch die Leiste weg.
const alleine = seite.seiteBauen();
alleine.lauf(seite.skriptBauen("watchpartyChatScript", { name: "Du" }));
alleine.lauf("window.__elfixChat.entfernen()");
pruefe("Bleibt nichts uebrig, verschwindet die Leiste",
  !alleine.leiste(),
  "ein leerer Kasten ueber dem Bild finge Klicks ab, die dem Player gehoeren");

// --- Wo er ueberhaupt hingehoert --------------------------------------------
//
// Der Fehler dahinter: die Seite entschied allein, und ihre Regel lautete
// "oberstes Dokument und kein grosser Rahmen". Das trifft auf jede Hosterseite
// zu - aber genauso auf die Startseite eines Anbieters, die weder Video noch
// Rahmen hat. Dort klebte der Schalter dann ueber der Serienuebersicht.

const { istAbspielseite } = require("../src/fortschritt");

const seiten = [
  ["Startseite des Anbieters", "https://s.to/", false],
  ["Suche", "https://s.to/suche?term=reacher", false],
  ["Serienuebersicht", "https://s.to/serie/stream/reacher", false],
  ["Staffeluebersicht", "https://s.to/serie/stream/reacher/staffel-1", false],
  ["Folge", "https://s.to/serie/stream/reacher/staffel-1/episode-3", true],
  ["Film", "https://filmo.to/film/beispiel", true],
  ["YouTube-Startseite", "https://www.youtube.com/", false],
  ["YouTube-Suche", "https://www.youtube.com/results?search_query=reacher", false],
  // Auf YouTube nirgends. Der Schalter heisst "naechste Folge von selbst
  // starten", und die gibt es dort nicht - YouTube entscheidet selbst, was
  // nach einem Video kommt, und hat seinen eigenen Schalter dafuer.
  ["YouTube-Video", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", false],
  ["YouTube-Shorts", "https://www.youtube.com/shorts/abcdefghijk", false],
  ["YouTube-Video ueber youtu.be", "https://youtu.be/dQw4w9WgXcQ", false],
  ["Eingebettetes YouTube-Video", "https://www.youtube.com/embed/dQw4w9WgXcQ", false]
];
for (const [name, url, erwartet] of seiten) {
  pruefe(`${erwartet ? "Dort gehoert er hin" : "Dort nicht"}: ${name}`,
    istAbspielseite(url) === erwartet,
    url);
}

// --- Und der Weg zurueck ----------------------------------------------------
//
// YouTube wechselt die Seite, ohne das Dokument neu zu laden: kein dom-ready,
// kein frisches Dokument. Wer vom Video auf die Startseite geht, behielte den
// Schalter sonst - der Player von vorhin steht dort ja noch.

const weg = seite.seiteBauen();
weg.lauf(seite.skriptBauen("autoplaySchalterScript", true));
const wegAntwort = weg.lauf(seite.skriptBauen("autoplaySchalterEntfernenScript"));
pruefe("Auf einer Seite ohne Video wird er wieder entfernt",
  !weg.holen("__elfixAutoplaySchalter") && wegAntwort === "autoplay-entfernt",
  String(wegAntwort));
pruefe("und die leere Leiste gleich mit",
  !weg.leiste(),
  "ein leerer Kasten ueber dem Bild finge Klicks ab, die dem Player gehoeren");

const chatBleibt = seite.seiteBauen();
chatBleibt.lauf(seite.skriptBauen("autoplaySchalterScript", true));
chatBleibt.lauf(seite.skriptBauen("watchpartyChatScript", { name: "Du" }));
chatBleibt.lauf(seite.skriptBauen("autoplaySchalterEntfernenScript"));
pruefe("Laeuft eine Runde, bleibt der Chat stehen",
  Boolean(chatBleibt.leiste()) && Boolean(chatBleibt.holen("__elfixChat")),
  "entfernt wird der Schalter, nicht die Leiste");

pruefe("Zweimal entfernen ist kein Fehler",
  weg.lauf(seite.skriptBauen("autoplaySchalterEntfernenScript")) === "autoplay-nicht-da",
  "der Aufruf kommt bei jedem Seitenwechsel");

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
