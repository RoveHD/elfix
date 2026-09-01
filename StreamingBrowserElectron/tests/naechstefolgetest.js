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
const TITELBILD_JAVA = TITELBILD;

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

/* ----------------------------------------------- 1b. Die andere Richtung */
//
// Eine Folge zurueck. Am Fernseher haengt sie an derselben Sprungtaste, die
// vorher den Anbieter wechselte - und bis dahin gab es sie ueberhaupt nicht:
// von einer laufenden Folge zurueck kam man nur ueber die Anbieterseite.
//
// Die Regel ist die kuerzere von beiden. Vorwaerts muss geraten werden, wo die
// Serie aufhoert; rueckwaerts steht die Grenze fest, und sie heisst Folge 1.

pruefe("Mitten in der Staffel kommt die Folge davor",
  fortschritt.vorigeEpisodeUrl(folge(1, 4), null) === folge(1, 3));

pruefe("Dafuer braucht es keine bekannte Serienlaenge",
  fortschritt.vorigeEpisodeUrl(folge(3, 12), null) === folge(3, 11),
  "die Grenze steht in der Adresse, nicht im Eintrag");

pruefe("Vor Folge 1 kommt nichts",
  fortschritt.vorigeEpisodeUrl(folge(1, 1), null) === "");

// Ueber die Staffelgrenze geht es nicht zurueck: wie viele Folgen die *vorige*
// Staffel hat, sagt keine der Auskuenfte, die hier vorliegen. Eine Zahl zu
// raten hiesse, auf einer Adresse zu landen, die es nicht gibt.
pruefe("Auch am Staffelanfang wird nicht in die vorige Staffel geraten",
  fortschritt.vorigeEpisodeUrl(folge(2, 1), { seasonLastEpisode: 25 }) === "");

pruefe("Gesperrte Folgen werden auch rueckwaerts uebersprungen",
  fortschritt.vorigeEpisodeUrl(folge(1, 10),
    { unplayableSeason: 1, unplayableEpisodes: [9] }) === folge(1, 8));

pruefe("Sind alle davor gesperrt, gibt es keine vorige Folge",
  fortschritt.vorigeEpisodeUrl(folge(1, 3),
    { unplayableSeason: 1, unplayableEpisodes: [1, 2] }) === "");

pruefe("Was keine Folge ist, hat auch keine davor",
  fortschritt.vorigeEpisodeUrl(BASIS, null) === "");

// Eine Adresse ohne Staffel im Pfad - replaceEpisodeUrl verlangt beides und
// antwortet sonst mit nichts. Genau dafuer gibt es den Rueckfall.
pruefe("Auch eine Adresse ohne Staffel zaehlt herunter",
  fortschritt.vorigeEpisodeUrl("https://s.to/serie/tatort/folge-7", null)
    === "https://s.to/serie/tatort/folge-6");

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
pruefe("und die vorige aus derselben Datei",
  FOLGEN.includes("fortschritt.vorigeEpisodeUrl"),
  "sonst rechnete Android sie sich wieder selbst aus - genau daran ist die alte Taste 9 gescheitert");
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
pruefe("Ein laufender Zaehler holt die Leiste voll zurueck",
  /deckkraft[\s\S]{0,300}!imVollbild \|\| zaehlt\) return 1f/.test(LEISTE));

/* --------------------------------------- Die beiden Fehler auf der Hardware */
//
// Beides ist auf einem echten Telefon aufgefallen und war an keiner Rechnung
// zu sehen - deshalb steht es hier als Sperre gegen einen Rueckfall.

// 1. Die Leiste verschwand - und kam nicht wieder. Sie uebernahm den Rueckfall
//    des Livestreifens (View.GONE nach kurzer Ruhe), dessen Ausloeser aber nur
//    existiert, wenn eine Watchparty laeuft: den Horcher setzt
//    Mitschauen.anPlayer ein, und das tut es nur bei eingeschalteter
//    Watchparty. Wer allein schaut, bekam nie eine Meldung.
//
//    Sie darf inzwischen wieder ganz verschwinden - aber nur, weil der
//    Rueckweg ein anderer ist: jede Beruehrung und jede Taste holt sie zurueck.
//    Genau das wird hier festgehalten, samt der drei Schritte dorthin.
pruefe("Die Leiste geht in drei Schritten",
  /enum Stufe \{[\s\S]{0,200}VOLL,[\s\S]{0,200}GEDIMMT,[\s\S]{0,200}WEG/.test(LEISTE));
pruefe("Der mittlere Schritt ist ein Verblassen, kein Verschwinden",
  /RUHE_DECKKRAFT\s*=\s*0?\.\d+f/.test(LEISTE) && LEISTE.includes("wurzel.setAlpha"));
pruefe("Und zusammen sind es zehn Sekunden",
  /RUHE_MS\s*=\s*5000/.test(LEISTE) && /VERBLASSEN_MS\s*=\s*5000/.test(LEISTE));
pruefe("Der Rueckweg haengt an Beruehrung und Taste, nicht an der Watchparty",
  HAUPT.includes("spielerleiste.regung()") && /void regung\(\)\s*\{\s*zeigen\(\);/.test(LEISTE));
pruefe("Der Horcher fuer die Player-Steuerung braucht weiterhin die Watchparty",
  fs.readFileSync(path.join(ANDROID, "Mitschauen.java"), "utf8")
    .includes("if (watchparty == null || !watchparty.istEingeschaltet()) return;"));

// 3. Der leere Kasten. Die Leiste war sichtbar, solange ueberhaupt eine Folge
//    lief - auch mit beiden Knoepfen auf GONE. Uebrig blieb ihr eigener
//    Hintergrund: ein dunkler Punkt unten rechts, der die ersten neunzig
//    Prozent jeder Folge im Bild klebte.
pruefe("Ohne Inhalt wird die Leiste gar nicht erst gezeichnet",
  /boolean inhaltDa = knopfDa \|\| zaehlt\(\)/.test(LEISTE)
    && /leisteSichtbar\(amSchauen, inhaltDa/.test(LEISTE));
pruefe("Und die Regel dazu steht ohne Ansicht da, also pruefbar",
  /static boolean leisteSichtbar\(/.test(LEISTE));

// 2. Die Serienlaenge kam nie an. Titelbild hatte genau einen Platz, und auf
//    dem Telefon nimmt der Hoster den Hauptrahmen: sein onPageFinished loeschte
//    die Angaben der Folgenseite. Danach war finalSeason weg, und ohne
//    finalSeason gibt nextEpisodeContinueUrl nichts zurueck - kein Knopf, nie.
pruefe("Titelbild merkt sich die Angaben je Adresse",
  TITELBILD_JAVA.includes("LinkedHashMap<String, Fund>")
    && /angaben\(String seitenAdresse\)[\s\S]{0,200}funde\.get\(seitenAdresse\)/
      .test(TITELBILD_JAVA));
pruefe("und nicht mehr in einem Platz, den die naechste Seite loescht",
  !/private JSONObject seitendaten = new JSONObject\(\);/.test(TITELBILD_JAVA));
pruefe("Gelesen wird schon beim Seitenanfang",
  /onPageStarted[\s\S]{0,3000}titelbild\.suchen\(view, provider, url\)/.test(HAUPT));
pruefe("Ohne finalSeason gibt die Regel nichts zurueck - der gepruefte Fall",
  fortschritt.nextEpisodeContinueUrl(folge(1, 3), "", {}, null) === "");

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

/* -------------------------------------- 4. Die Sprungtasten am Fernseher */
//
// Sie wechselten den Anbieter. Das war die falsche Aufgabe fuer sie: wer am
// Fernseher eine Serie schaut, will die naechste Folge - der Anbieter steht
// ohnehin einen Druck entfernt auf der Startseite. Die Folge davor dagegen war
// von der Fernbedienung aus gar nicht zu erreichen.

const sprungtasten = HAUPT.match(
  /case KeyEvent\.KEYCODE_MEDIA_REWIND:[\s\S]{0,600}?case KeyEvent\.KEYCODE_MEDIA_PLAY_PAUSE:/);
pruefe("Die Sprungtasten stehen noch in der Weiche", Boolean(sprungtasten));
pruefe("Zurueck blaettert eine Folge zurueck",
  Boolean(sprungtasten) && /KEYCODE_MEDIA_PREVIOUS:[\s\S]{0,200}?vorigeFolgeStarten\("Fernbedienung"\)/
    .test(sprungtasten[0]));
pruefe("Vor blaettert eine Folge weiter",
  Boolean(sprungtasten) && /KEYCODE_MEDIA_NEXT:[\s\S]{0,200}?naechsteFolgeStarten\("Fernbedienung"\)/
    .test(sprungtasten[0]));
pruefe("und beide nur dort, wo eine Folge laufen kann",
  Boolean(sprungtasten) && (sprungtasten[0].match(/if \(!onWebsite\) return false;/g) || []).length === 2,
  "auf der Startseite gehoert die Taste der Oberflaeche");
pruefe("Der Anbieterwechsel per Taste ist damit weg",
  !HAUPT.includes("cycleProvider"),
  "eine Weiche, die niemand mehr aufruft, waere nur noch eine Falle fuer den naechsten Leser");

// Der Weg dahinter ist derselbe wie beim Knopf: Vorhang, Autostart, Vollbild.
pruefe("Auch rueckwaerts wird die Folge begleitet gestartet",
  /private void vorigeFolgeStarten\([\s\S]{0,1200}?folgeWirklichOeffnen\(provider, ziel, anlass\)/
    .test(HAUPT));
pruefe("Ein laufender Folgenwechsel schluckt den zweiten Druck",
  /private void vorigeFolgeStarten\([\s\S]{0,300}?folgenwechselLaeuft\(\)/.test(HAUPT),
  "sonst rauscht ein liegengebliebener Finger durch eine halbe Staffel");
pruefe("Am Anfang der Serie gibt es eine Auskunft und keinen Rauswurf",
  /vorigeFolgeStarten\([\s\S]{0,1200}?keine vorherige Folge[\s\S]{0,200}?\}/.test(HAUPT)
    && !/vorigeFolgeStarten\([\s\S]{0,1200}?folgenendeAmFernseher\(\)/.test(HAUPT));

const bestanden = pruefungen.filter(Boolean).length;
console.log(`${bestanden}/${pruefungen.length} bestanden`);
process.exit(bestanden === pruefungen.length ? 0 : 1);
