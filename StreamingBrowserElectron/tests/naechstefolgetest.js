"use strict";
// Die naechste Folge - die Regel, ihre Zulieferung und der Weg aufs Telefon.
//
// Anlass: auf Android gab es diese Regel ein zweites Mal. Sie stand als
// JavaScript-Textblock in MainActivity, zaehlte die Folgennummer hoch und
// sprang, wenn die Seite dazu keinen Link hatte, in die naechste Staffel. Sie
// kannte weder das Ende einer Serie noch zusammengefasste Folgen. Zwei Regeln
// fuer dieselbe Frage laufen auseinander, sobald nur eine gepflegt wird -
// genau das war passiert.
//
// Geprueft wird deshalb dreierlei:
//
//   1. Die Regel selbst (nextEpisodeContinueUrl in fortschritt.js): mitten in
//      der Staffel, am Staffelende, am Serienende, mit gesperrten Folgen und
//      mit einem Vorschlag aus der Seite.
//   2. Ihre Zulieferung: seasonLastEpisode aus seitendaten.js. Ohne diese Zahl
//      endet jede Staffel im Nichts - die Regel zaehlt dann nur hoch. Am
//      Rechner kam sie bisher aus der nachgeladenen Staffeluebersicht, die es
//      auf dem Telefon nicht gibt.
//   3. Dass Android wirklich diese Regel fragt und keine eigene mehr hat.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..");
const fortschritt = require(path.join(WURZEL, "src/fortschritt.js"));
const seitendaten = require(path.join(WURZEL, "src/seitendaten.js"));

const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8");
const ANDROID = path.join(WURZEL, "..", "android/app/src/main/java/local/elflix/android");
const FOLGEN = fs.readFileSync(path.join(ANDROID, "Folgen.java"), "utf8");
const HAUPT = fs.readFileSync(path.join(ANDROID, "MainActivity.java"), "utf8");
const TITELBILD = fs.readFileSync(path.join(ANDROID, "Titelbild.java"), "utf8");
const MESSUNG_JAVA = fs.readFileSync(path.join(ANDROID, "Messung.java"), "utf8");
const LEISTE = fs.readFileSync(path.join(ANDROID, "Spielerleiste.java"), "utf8");

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}

const BASIS = "https://aniworld.to/anime/stream/attack-on-titan";
const folge = (staffel, nummer) => `${BASIS}/staffel-${staffel}/episode-${nummer}`;

/* ------------------------------------------------------------- 1. Die Regel */

// Mitten in der Staffel: die naechste Nummer. Die Serienlaenge muss dafuer
// bekannt sein - ohne sie wird nicht geraten.
pruefe("Mitten in der Staffel kommt die naechste Folge",
  fortschritt.nextEpisodeContinueUrl(folge(1, 3), "", { finalSeason: 4, finalEpisode: 28 }, null)
    === folge(1, 4));

pruefe("Ohne bekannte Serienlaenge wird nicht geraten",
  fortschritt.nextEpisodeContinueUrl(folge(1, 3), "", null, null) === "");

pruefe("Hinter der letzten Staffel gibt es nichts mehr",
  fortschritt.nextEpisodeContinueUrl(folge(9, 1), "", { finalSeason: 4, finalEpisode: 28 }, null)
    === "");

// Das Serienende: letzte Folge der letzten Staffel.
pruefe("Die letzte Folge der letzten Staffel ist das Ende",
  fortschritt.nextEpisodeContinueUrl(folge(4, 28), "", { finalSeason: 4, finalEpisode: 28 }, null)
    === "");

pruefe("Eine Folge davor geht es weiter",
  fortschritt.nextEpisodeContinueUrl(folge(4, 27), "", { finalSeason: 4, finalEpisode: 28 }, null)
    === folge(4, 28));

// Der Staffeluebergang. Er haengt an seasonLastEpisode: ohne die Zahl weiss
// niemand, wo die laufende Staffel aufhoert.
pruefe("Die letzte Folge einer Staffel fuehrt in die naechste",
  fortschritt.nextEpisodeContinueUrl(folge(1, 25), "", { finalSeason: 4, finalEpisode: 28 },
    { seasonLastEpisode: 25 }) === folge(2, 1));

pruefe("Ohne seasonLastEpisode wird nur hochgezaehlt",
  fortschritt.nextEpisodeContinueUrl(folge(1, 25), "", { finalSeason: 4, finalEpisode: 28 }, null)
    === folge(1, 26));

// Zusammengefasste Folgen: "[In E10 enthalten]" laesst sich nicht abspielen.
pruefe("Gesperrte Folgen werden uebersprungen",
  fortschritt.nextEpisodeContinueUrl(folge(1, 8), "", { finalSeason: 4, finalEpisode: 28 },
    { unplayableSeason: 1, unplayableEpisodes: [9], seasonLastEpisode: 25 }) === folge(1, 10));

pruefe("Sind alle Folgen bis zum Staffelende gesperrt, geht es in die naechste Staffel",
  fortschritt.nextEpisodeContinueUrl(folge(1, 23), "", { finalSeason: 4, finalEpisode: 28 },
    { unplayableSeason: 1, unplayableEpisodes: [24, 25], seasonLastEpisode: 25 }) === folge(2, 1));

// Der Vorschlag aus der Seite. Er gewinnt, wenn er passt - und faellt durch,
// wenn er zu einer fremden Serie gehoert oder zurueckzeigt.
pruefe("Ein passender Vorschlag der Seite gewinnt",
  fortschritt.nextEpisodeContinueUrl(folge(1, 3), folge(1, 4),
    { finalSeason: 4, finalEpisode: 28 }, null) === folge(1, 4));

pruefe("Eine fremde Serie im Vorschlag zaehlt nicht",
  fortschritt.nextEpisodeContinueUrl(folge(1, 3),
    "https://aniworld.to/anime/stream/one-piece/staffel-1/episode-4",
    { finalSeason: 4, finalEpisode: 28 }, null) === folge(1, 4));

pruefe("Ein Vorschlag zurueck zaehlt nicht",
  fortschritt.nextEpisodeContinueUrl(folge(1, 3), folge(1, 2),
    { finalSeason: 4, finalEpisode: 28 }, null) === folge(1, 4));

// Der Torwaechter davor - dasselbe, was der Rechner vor jedem Wechsel fragt.
pruefe("Der Torwaechter laesst die naechste Folge durch",
  fortschritt.darfNaechsteFolgeSein(folge(1, 4), folge(1, 3), null) === true);
pruefe("und den Sprung in die naechste Staffel",
  fortschritt.darfNaechsteFolgeSein(folge(2, 1), folge(1, 25), null) === true);
pruefe("aber keine fremde Serie",
  fortschritt.darfNaechsteFolgeSein(
    "https://aniworld.to/anime/stream/one-piece/staffel-1/episode-4", folge(1, 3), null) === false);
pruefe("und keinen Ruecksprung",
  fortschritt.darfNaechsteFolgeSein(folge(1, 2), folge(1, 3), null) === false);

/* ------------------------------------------------- 2. Die Zulieferung */

/**
 * Eine Folgenseite, so knapp wie moeglich - nur was das Skript anfasst.
 *
 * @param folgen   die Folgennummern dieser Staffel, wie sie verlinkt sind
 * @param staffeln welche Staffeln die Seite anbietet
 * @param gesperrt Folgen, die als "[In E.. enthalten]" dastehen
 */
function seiteBauen({ adresse, folgen = [], staffeln = [1], gesperrt = [] }) {
  const ziel = new URL(adresse);
  const basis = ziel.pathname.replace(/\/staffel-\d+(?:\/episode-\d+)?\/?$/, "");
  const anker = [];
  for (const staffel of staffeln) anker.push({ href: `${basis}/staffel-${staffel}`, text: "" });
  for (const nummer of folgen) {
    anker.push({ href: `${ziel.pathname.replace(/\/episode-\d+\/?$/, "")}/episode-${nummer}`, text: "" });
  }
  const knoten = (attribute, text = "") => ({
    getAttribute: (name) => (name in attribute ? attribute[name] : null),
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    textContent: text,
    tagName: "A"
  });
  const ankerKnoten = anker.map((eintrag) => knoten({ href: eintrag.href }, eintrag.text));
  // Die Zeilen der Folgenliste. Eine gesperrte traegt den Hinweis im Text -
  // genau so schreibt S.to seine Doppelfolgen.
  const zeilen = folgen.map((nummer) => ({
    getAttribute: (name) => (name === "onclick" ? "" : null),
    querySelector: (auswahl) => {
      if (String(auswahl).includes("episode-number")) return { textContent: String(nummer) };
      if (String(auswahl) === "a[href]") {
        return { getAttribute: () => `${basis}/staffel-1/episode-${nummer}` };
      }
      return null;
    },
    querySelectorAll: () => [],
    textContent: gesperrt.includes(nummer) ? `${nummer} [In E10 enthalten]` : String(nummer),
    tagName: "TR"
  }));
  const dokument = {
    title: "Attack on Titan",
    images: [],
    body: { innerText: "" },
    querySelector: (auswahl) => (String(auswahl).includes("icon") ? knoten({ href: "/favicon.ico" }) : null),
    querySelectorAll: (auswahl) => {
      if (String(auswahl) === "a[href]") return ankerKnoten;
      if (String(auswahl) === "tr, li") return zeilen;
      return [];
    }
  };
  return {
    document: dokument,
    location: { href: ziel.href, hostname: ziel.hostname, pathname: ziel.pathname },
    innerWidth: 1280,
    innerHeight: 800,
    getComputedStyle: () => ({ backgroundImage: "" }),
    URL,
    Number,
    Math,
    JSON,
    console
  };
}

function lesen(angaben) {
  return vm.runInNewContext(seitendaten.seitenSkript(), vm.createContext(seiteBauen(angaben)));
}

const staffelSeite = lesen({
  adresse: folge(1, 3),
  folgen: [1, 2, 3, 4, 5],
  staffeln: [1, 2, 3, 4]
});
pruefe("Die Seite meldet, wo ihre Staffel aufhoert",
  staffelSeite.seasonLastEpisode === 5, JSON.stringify(staffelSeite.seasonLastEpisode));
pruefe("und wie viele Staffeln es gibt",
  staffelSeite.finalSeason === 4, JSON.stringify(staffelSeite.finalSeason));

// Der Schutz gegen eine halb geladene Liste: steht die laufende Folge gar
// nicht darin, ist die Liste nicht zu gebrauchen. Eine zu kleine Zahl hiesse,
// mitten in der Staffel in die naechste zu springen.
const halbeSeite = lesen({
  adresse: folge(1, 9),
  folgen: [1, 2, 3],
  staffeln: [1, 2, 3, 4]
});
pruefe("Fehlt die laufende Folge in der Liste, gibt es keine Auskunft",
  halbeSeite.seasonLastEpisode === 0, JSON.stringify(halbeSeite.seasonLastEpisode));

// Eine gesperrte letzte Folge ist kein Staffelende, das man erreichen koennte.
const mitSperre = lesen({
  adresse: folge(1, 3),
  folgen: [1, 2, 3, 4, 5],
  staffeln: [1, 2, 3, 4],
  gesperrt: [5]
});
pruefe("Eine nicht abspielbare letzte Folge zaehlt nicht als Staffelende",
  mitSperre.seasonLastEpisode === 4, JSON.stringify(mitSperre.seasonLastEpisode));
pruefe("und wird als gesperrt gemeldet",
  Array.isArray(mitSperre.unplayableEpisodes) && mitSperre.unplayableEpisodes.includes(5),
  JSON.stringify(mitSperre.unplayableEpisodes));

// Und die beiden zusammen: die Seite sagt, wo die Staffel aufhoert, die Regel
// macht daraus den Staffeluebergang.
pruefe("Seite und Regel zusammen fuehren ueber die Staffelgrenze",
  fortschritt.nextEpisodeContinueUrl(folge(1, 5), "",
    { finalSeason: 4, finalEpisode: 28 }, staffelSeite) === folge(2, 1));

/* ------------------------------------------------- 3. Der Weg aufs Telefon */

pruefe("Android holt die naechste Folge aus der geteilten Regel",
  FOLGEN.includes("fortschritt.nextEpisodeContinueUrl"));
pruefe("und fragt denselben Torwaechter davor",
  FOLGEN.includes("fortschritt.darfNaechsteFolgeSein"));
pruefe("und fragt die geteilte Regel, wo die Leiste ueberhaupt hingehoert",
  FOLGEN.includes("fortschritt.istAbspielseite"));

// Die alte zweite Regel. Sie stand als JavaScript-Textblock in MainActivity
// und darf nicht zurueckkommen.
pruefe("MainActivity rechnet die naechste Folge nicht mehr selbst",
  !HAUPT.includes("'/staffel-'+(season+1)") && !HAUPT.includes("end-of-series"));

pruefe("Das Telefon nimmt seasonLastEpisode von der Seite mit",
  TITELBILD.includes('"seasonLastEpisode"'));

// Die Trennung, um die es geht: der Zaehler haengt am Ende der Folge und nicht
// an der Prozentschwelle, ab der sie als gesehen gilt.
pruefe("Der Messtakt reicht beide Stufen an die Leiste",
  HAUPT.includes("Folgen.nahAmEnde(position, laufzeit, beendet)")
    && HAUPT.includes("Folgen.amEnde(position, laufzeit, beendet)"));
pruefe("und entscheidet den Wechsel nicht mehr selbst",
  !HAUPT.includes("naechsteFolgeStarten(\"Autoplay\""));

// Die drei Abschnitte einer Folge - und dass es an beiden Geraeten dieselben
// Zahlen sind. Eine Schwelle, die nur an einer Stelle gepflegt wird, ist die
// naechste Stelle, an der Telefon und Rechner auseinanderlaufen.
const desktopProzent = Number(
  (MAIN.match(/NEXT_EPISODE_PROMPT_PERCENT\s*=\s*(\d+)/) || [])[1]);
const desktopZaehler = Number(
  (MAIN.match(/NEXT_EPISODE_COUNTDOWN_SECONDS\s*=\s*(\d+)/) || [])[1]);
const androidProzent = Number(
  (FOLGEN.match(/KNOPF_AB_PROZENT\s*=\s*(\d+)/) || [])[1]);
const androidZaehler = Number(
  (FOLGEN.match(/ZAEHLER_SEKUNDEN\s*=\s*(\d+)/) || [])[1]);

pruefe("Der Knopf kommt am Telefon bei derselben Prozentzahl wie am Rechner",
  desktopProzent === 90 && androidProzent === desktopProzent,
  `Rechner ${desktopProzent}, Telefon ${androidProzent}`);
pruefe("und der Zaehler laeuft gleich lang",
  desktopZaehler === 5 && androidZaehler === desktopZaehler,
  `Rechner ${desktopZaehler}s, Telefon ${androidZaehler}s`);

// Und die Entkopplung: der Schalter haengt nicht am Knopf.
pruefe("Der Knopf steht erst ab der Schwelle da",
  LEISTE.includes("hatZiel && (nahAmEnde || amEnde)"));
pruefe("Der Schalter dagegen steht, solange etwas laeuft",
  !/knopfAutoplay\.setVisibility/.test(LEISTE));
pruefe("Gezaehlt wird nur am Ende",
  /zaehlenSoll\s*=\s*hatZiel\s*&&\s*amEnde/.test(LEISTE));
pruefe("Ein Abbruch gilt fuer diese Folge und laesst den Knopf stehen",
  LEISTE.includes("abgebrochenFuer = ziel") && LEISTE.includes("knopfAbbrechen"));
pruefe("Ein laufender Zaehler nimmt die Leiste nicht weg",
  LEISTE.includes("steuerungAn || zaehlt"));

// Der Schalter muss einen Neustart ueberstehen - sonst ist er keine
// Einstellung, sondern eine Laune.
pruefe("Der Autoplay-Schalter wird gespeichert",
  FOLGEN.includes("getSharedPreferences(ABLAGE") && FOLGEN.includes("putBoolean"));
pruefe("und ist wie am Rechner vorgabemaessig an",
  FOLGEN.includes("getBoolean(SCHLUESSEL_AUTOPLAY, true)"));

// Ein zweiter Takt neben der Messung waere eine zweite Uhr.
pruefe("Der Autoplay haengt am Messtakt und nicht an einem eigenen",
  MESSUNG_JAVA.includes("interface Spielstand") && HAUPT.includes("messung.setzeSpielstand"));

// In einer Runde entscheidet die Runde. Ein eigener Wechsel daneben waere
// einer zu viel.
pruefe("Wer der Runde folgt, laesst den Zaehler gar nicht erst anfangen",
  /zaehlerErlaubt[\s\S]{0,400}mitschauen\.folgtDerRunde\(\)/.test(HAUPT));

const bestanden = pruefungen.filter(Boolean).length;
console.log(`${bestanden}/${pruefungen.length} bestanden`);
process.exit(bestanden === pruefungen.length ? 0 : 1);
