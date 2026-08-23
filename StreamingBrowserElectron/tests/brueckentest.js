"use strict";
// Die Android-Bruecken.
//
// Zwischen den geteilten Modulen und der Java-Seite liegt je Sache ein kleines
// Modul unter `android/app/src/main/assets/kern/eigen`. Dort steht das, was am
// Rechner in main.js liegt: unter welchem Schluessel etwas gefuehrt wird, wann
// geschrieben wird, was zurueckgemeldet wird. Regeln stehen dort keine.
//
// Genau deshalb muss es geprueft werden. Eine Bruecke, die den Schluessel
// anders bildet als main.js, laesst beide Geraete dasselbe merken und keins
// das des anderen wiederfinden - der Abgleich waere still kaputt, und niemand
// saehe es an den Dateien. Der Vergleich unten holt sich die Ableitung
// deshalb aus main.js selbst und nicht aus einer zweiten Beschreibung davon.
//
// Ausgefuehrt wird die Bruecke wirklich, mit demselben CommonJS-Lader, den
// kern-host.js im WebView aufspannt: Modulnamen ohne Pfad und ohne Endung.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..");
const BRUECKEN = path.join(WURZEL, "..", "android/app/src/main/assets/kern/eigen");
const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").replace(/\r/g, "");

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}

/**
 * Eine Bruecke laden - so, wie der Kern es auf dem Geraet tut.
 *
 * `kern-host.js` loest `require("fassung")` ueber den blossen Dateinamen auf,
 * weil die Module dort flach nebeneinander liegen. Hier wird derselbe Weg
 * nachgestellt und auf `src/` bzw. `shared/` gezeigt; laedt die Bruecke etwas,
 * das gar nicht mitkopiert wird, faellt es hier auf und nicht erst auf dem
 * Telefon.
 */
const KERN_MODULE = new Set(
  fs.readFileSync(path.join(WURZEL, "..", "android/app/build.gradle"), "utf8")
    .split("\n")
    .map((zeile) => (zeile.match(/"((?:src|shared)\/[a-z-]+\.js)"/) || [])[1])
    .filter(Boolean)
    .map((pfad) => path.basename(pfad, ".js"))
);

function brueckeLaden(name) {
  const quelle = fs.readFileSync(path.join(BRUECKEN, `${name}.js`), "utf8");
  const modul = { exports: {} };
  const lader = (gesucht) => {
    if (!KERN_MODULE.has(gesucht)) {
      throw new Error(`"${gesucht}" steht nicht in kernModule und faehrt nicht mit`);
    }
    const unter = fs.existsSync(path.join(WURZEL, "src", `${gesucht}.js`)) ? "src" : "shared";
    return require(path.join(WURZEL, unter, `${gesucht}.js`));
  };
  vm.runInNewContext(quelle, {
    require: lader,
    module: modul,
    exports: modul.exports,
    console,
    // Die Bruecken melden ueber `window.ElfixKern` nach Java. Hier gibt es
    // keins; wer es braucht, bekommt einen Zaehler statt einer Ausnahme.
    window: { ElfixKern: { ereignis: () => {} } }
  });
  return modul.exports;
}

// --- Fassung merken -----------------------------------------------------------

const fassungBruecke = brueckeLaden("fassung-bruecke");
const taste = require("../src/taste");

pruefe("Die Bruecke laedt nur Module, die auch mitkopiert werden",
  typeof fassungBruecke.skript === "function",
  "sonst haette brueckeLaden oben geworfen");

// Der Anbieter und ein Eintrag, wie sie auf dem Geraet vorliegen.
const anbieter = { id: "aniworld", name: "AniWorld", startUrl: "https://aniworld.to/" };
const FOLGE1 = "https://aniworld.to/anime/stream/dandadan/staffel-1/episode-1";
const FOLGE2 = "https://aniworld.to/anime/stream/dandadan/staffel-1/episode-2";
const eintraege = [{ id: "a1", providerId: "aniworld", url: FOLGE1, title: "Dandadan" }];

// Der Schluessel: derselbe wie am Rechner. main.js bildet ihn in
// fassungSchluesselFuer() aus dem Titel des gefundenen Eintrags - ohne
// Staffel, weil die Sprache einer Serie sich ueber Staffeln nicht aendert.
pruefe("Derselbe Schluessel wie am Rechner: der Titel, ohne Staffel",
  fassungBruecke.skript(eintraege, anbieter, FOLGE1).schluessel === taste.titelSchluessel("Dandadan"),
  "ein anders gebildeter Schluessel macht den Geraeteabgleich still wirkungslos");
pruefe("Und main.js bildet ihn wirklich so",
  /function fassungSchluesselFuer[\s\S]*?return taste\.titelSchluessel\(/.test(MAIN)
  && !/function fassungSchluesselFuer[\s\S]{0,400}?marken\.schluessel/.test(MAIN),
  "ohne Staffel - anders als bei den Intromarken");
pruefe("Staffel 2 landet unter demselben Schluessel",
  fassungBruecke.skript(eintraege, anbieter,
    "https://aniworld.to/anime/stream/dandadan/staffel-2/episode-1").schluessel
  === fassungBruecke.skript(eintraege, anbieter, FOLGE1).schluessel);
pruefe("Eine Seite ohne Folge hat keinen Schluessel",
  fassungBruecke.skript(eintraege, anbieter, "https://aniworld.to/animes").schluessel === "",
  "auf der Uebersicht gibt es keine Fassung zu waehlen");

// Ohne gemerkte Fassung wird trotzdem eingespielt - nur ohne Sperre.
const frisch = fassungBruecke.skript(eintraege, anbieter, FOLGE1);
pruefe("Ohne gemerkte Fassung laeuft das Skript, aber der Autostart wartet nicht",
  frisch.skript.length > 0 && frisch.wartet === false,
  "es gibt nichts umzustellen, also gibt es nichts zu verzoegern");

// Die Vorgabe des Anbieters beim Laden.
const stand = fassungBruecke.meldung(eintraege, anbieter, FOLGE1,
  "__elfix:fassung:stand:1:german");
pruefe("Die Vorgabe beim Laden wird gemerkt", stand && stand.name === "Deutsch");
pruefe("Sie sagt nichts an",
  stand && stand.ansage === "",
  "die Folge laeuft ja genau so, wie sie dasteht");

// Eine zweite Vorgabe darf die erste nicht ueberschreiben.
const nochmal = fassungBruecke.meldung(eintraege, anbieter, FOLGE2,
  "__elfix:fassung:stand:2:japanese-german");
pruefe("Eine weitere Vorgabe ueberschreibt nichts",
  nochmal === null,
  "sonst haette die Vorwahl sich nach der ersten Folge selbst wieder abgewaehlt");

// Ein echter Klick zaehlt.
const wahl = fassungBruecke.meldung(eintraege, anbieter, FOLGE1,
  "__elfix:fassung:wahl:2:japanese-german");
pruefe("Ein Klick gilt immer",
  wahl && wahl.name === "Japanisch, Deutsche Untertitel");
pruefe("Und wird angesagt",
  wahl && wahl.ansage.includes("ab der nächsten Folge"),
  "ein Wechsel ist eine Entscheidung, von der man wissen will, dass sie ankam");

// Ab jetzt wartet der Autostart.
const gemerkt = fassungBruecke.skript(eintraege, anbieter, FOLGE2);
pruefe("Jetzt wartet der Autostart auf die Umschaltung",
  gemerkt.wartet === true && gemerkt.name === "Japanisch, Deutsche Untertitel",
  "die Anbieterseite zeigt nur die Hoster der gewaehlten Fassung");

// Die Auskunft fuer die Einstellungen.
const bericht = fassungBruecke.stand();
pruefe("Die Auskunft nennt Titel und Fassungen",
  bericht.titel === 1 && bericht.fassungen[0].name === "Japanisch, Deutsche Untertitel");
pruefe("Es gibt einen Weg zurueck",
  fassungBruecke.vergessen() === 1 && fassungBruecke.stand().titel === 0);

// Was aus der Datei kommt, kommt unveraendert an.
pruefe("Ein geladener Bestand wird uebernommen",
  fassungBruecke.laden({ dandadan: { key: "2", roh: "japanese-german", name: "Japanisch, Deutsche Untertitel", at: 1 } }) === 1
  && fassungBruecke.stand().titel === 1,
  "dasselbe Format wie fassungen.json am Rechner");

// --- Intro ueberspringen ------------------------------------------------------

const markenBruecke = brueckeLaden("marken-bruecke");
const marken = require("../src/marken");

// Der Schluessel traegt hier die Staffel - anders als bei der Fassung. Ein
// Intro kann ab Staffel 2 ein anderes sein.
pruefe("Der Markenschluessel traegt die Staffel",
  markenBruecke.skript(eintraege, anbieter, FOLGE1, true).schluessel
  === marken.schluessel(taste.titelSchluessel("Dandadan"), 1));
pruefe("Staffel 2 landet unter einem anderen Schluessel",
  markenBruecke.skript(eintraege, anbieter,
    "https://aniworld.to/anime/stream/dandadan/staffel-2/episode-1", true).schluessel
  !== markenBruecke.skript(eintraege, anbieter, FOLGE1, true).schluessel,
  "sonst traegt die zweite Staffel das Intro der ersten");
pruefe("Und main.js bildet ihn wirklich so",
  MAIN.includes("function markenSchluesselFuer")
  && MAIN.includes("return marken.schluessel(titel, identity.season);"),
  "mit Staffel - anders als bei der Fassung");

// Ein einzelner Sprung ergibt noch keine Marke.
const ersterSprung = markenBruecke.sprung(eintraege, anbieter, FOLGE1, 30, 120);
pruefe("Ein Sprung wird aufgenommen", ersterSprung !== null);
pruefe("Aber ergibt noch keine Marke",
  ersterSprung.marke === null && ersterSprung.ansage === "",
  "ein einzelner Sprung ist kein Intro, sondern ein Sprung");

// Derselbe Sprung in einer anderen Folge macht daraus eine Marke.
const zweiterSprung = markenBruecke.sprung(eintraege, anbieter, FOLGE2, 31, 121);
pruefe("Zwei uebereinstimmende Spruenge in zwei Folgen ergeben eine Marke",
  zweiterSprung && zweiterSprung.marke && zweiterSprung.marke.belege === 2);
pruefe("Und das wird einmal angesagt",
  zweiterSprung.ansage.includes("Intro gemerkt"));

// Ab jetzt traegt das Skript die Marke.
const mitMarke = markenBruecke.skript(eintraege, anbieter, FOLGE1, true);
pruefe("Das Skript bekommt die Marke mit",
  mitMarke.marke && mitMarke.marke.belege === 2 && mitMarke.skript.length > 0);
pruefe("Waehrend einer Watchparty wird nicht gelernt",
  markenBruecke.skript(eintraege, anbieter, FOLGE1, false).skript
  !== markenBruecke.skript(eintraege, anbieter, FOLGE1, true).skript,
  "der Player wird dort auf den Host gezogen - das sind nicht die eigenen Spruenge");

pruefe("Die Meldung aus der Seite wird gelesen",
  JSON.stringify(markenBruecke.sprungLesen("__elfix:sprung:30:120")) === JSON.stringify({ von: 30, nach: 120 }));
pruefe("Eine fremde Zeile nicht",
  markenBruecke.sprungLesen("irgendwas") === null);

pruefe("Die Auskunft zaehlt Staffeln und Marken",
  markenBruecke.stand().titel === 1 && markenBruecke.stand().marken === 1);
pruefe("Es gibt einen Weg zurueck",
  markenBruecke.vergessen() === 1 && markenBruecke.stand().titel === 0);

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
