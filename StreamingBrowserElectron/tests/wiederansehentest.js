"use strict";
/*
 * Wiederansehen: die Mediathek ist eine Ablage, keine Sackgasse.
 *
 * Gemeldet war: eine Serie, die man durch hat, liess sich nicht mehr
 * weiterschauen. Sie stand in der Mediathek, und das war richtig - aber sie
 * stand nirgends sonst mehr. Wer sie noch einmal ansah, fand sie weder auf der
 * Startseite noch in "Weiterschauen" noch in der Liste fuers Handy; der
 * Fortschritt lief ins Leere, weil `completed` jede dieser Listen sperrte.
 *
 * Der einzige Weg zurueck fuehrte darueber, den Titel aus der Mediathek zu
 * nehmen - also genau das aufzugeben, was man behalten wollte. Und beim
 * Folgenwechsel geschah das sogar von selbst: favoritNachziehen loeschte den
 * Abschluss, sobald man waehrend des zweiten Durchlaufs eine Folge weiterging.
 *
 * Geprueft wird deshalb an Ergebnissen und nicht an Zeilen: dieselbe Funktion
 * laeuft im Kern der Android-App. Nur die drei Stellen, die die Regel
 * zwangslaeufig ein zweites Mal aussprechen - die Oberflaeche, Favorite.java
 * und der Geraeteabgleich -, werden im Quelltext nachgesehen.
 */

const fs = require("fs");
const path = require("path");
const fortschritt = require("../src/fortschritt");

const WURZEL = path.join(__dirname, "..");
const lies = (datei) => fs.readFileSync(path.join(WURZEL, datei), "utf8").split("\r\n").join("\n");

const pruefungen = [];
const pruefe = (name, bedingung, detail) => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

const ANBIETER = { id: "p1", name: "Aniworld", startUrl: "https://aniworld.to/", logo: "AN" };
const SERIE = "https://aniworld.to/anime/stream/naruto";
const folge = (staffel, nummer) => `${SERIE}/staffel-${staffel}/episode-${nummer}`;
const FILM = "https://filmo.to/film/spiderman";

function verbuche(zustand, url, meta = {}, optionen = {}) {
  return fortschritt.medienStandVerbuchen(
    { favoriten: [], aktiverFavoritId: "", watchpartyFuehrt: false, ...zustand },
    ANBIETER, url, meta, optionen);
}

// Eine Serie mit drei Folgen, die dritte zu Ende geschaut.
const GRENZEN = { finalSeason: 1, finalEpisode: 3 };
const ganzDurch = { currentTime: 1390, duration: 1400, watchedSeconds: 1400, ...GRENZEN };
const mittendrin = (sekunden) => ({ currentTime: sekunden, duration: 1400, watchedSeconds: sekunden, ...GRENZEN });

function fertigeSerie() {
  const erst = verbuche({}, folge(1, 3), ganzDurch);
  return { eintrag: erst.eintrag, favoriten: erst.favoriten };
}

/* --- Der Ausgangspunkt --------------------------------------------------- */

{
  const fertig = fertigeSerie();
  pruefe("Eine durchgeschaute Serie gilt als abgeschlossen",
    fertig.eintrag.completed === true);
  pruefe("Und steht damit nicht mehr in Weiterschauen",
    fortschritt.hasContinueProgressRecord(fertig.eintrag) === false);
  pruefe("Ein frischer Abschluss ist kein Wiederansehen",
    fertig.eintrag.rewatching === false && fortschritt.durchlaeufe(fertig.eintrag) === 1,
    `rewatchCount=${fertig.eintrag.rewatchCount || 0}`);
}

/* --- Wieder anfangen ----------------------------------------------------- */

{
  const fertig = fertigeSerie();
  const wieder = verbuche(
    { favoriten: fertig.favoriten, aktiverFavoritId: fertig.eintrag.id },
    folge(1, 1), mittendrin(200));

  pruefe("Fortschritt auf einem fertigen Titel wird verbucht",
    Boolean(wieder.eintrag) && wieder.eintrag.id === fertig.eintrag.id);
  pruefe("Der Titel bleibt abgeschlossen - er verlaesst die Mediathek nicht",
    wieder.eintrag.completed === true);
  pruefe("Und er ist als Wiederansehen gemerkt",
    wieder.eintrag.rewatching === true);
  pruefe("Damit steht er wieder in Weiterschauen",
    fortschritt.hasContinueProgressRecord(wieder.eintrag) === true,
    "genau das ging vorher nicht");
  pruefe("Der Stand ist der der neuen Folge, nicht der alte Abschluss",
    wieder.eintrag.season === 1 && wieder.eintrag.episode === 1
    && wieder.eintrag.currentTime === 200 && wieder.eintrag.progress < 90,
    `S${wieder.eintrag.season}F${wieder.eintrag.episode} bei ${wieder.eintrag.progress}%`);
  pruefe("Auf die Watchlist kommt er dadurch nicht",
    wieder.eintrag.favorite === false,
    "Mediathek und Watchlist schliessen einander weiterhin aus");
  pruefe("Die Diagnose sagt, was los ist",
    /laeuft aber wieder/.test(fortschritt.mediaDiagnosticDecisionText(wieder.eintrag, folge(1, 1), {})));
}

/* --- Die Serienlaenge darf den Durchlauf nicht nach vorn werfen ---------- */
//
// hasNewEpisodeAfterCompletedFavorite vergleicht die letzte bekannte Folge mit
// der, auf der der Eintrag steht. Waehrend eines Wiederansehens steht er
// vorne - und das sah bis dahin aus wie Nachschub: der Eintrag waere bei jeder
// Fortschrittsmeldung ans Serienende geworfen worden, ohne Stand und ohne
// Mediathek.

{
  const fertig = fertigeSerie();
  const start = verbuche(
    { favoriten: fertig.favoriten, aktiverFavoritId: fertig.eintrag.id },
    folge(1, 1), mittendrin(200));
  const weiter = verbuche(
    { favoriten: start.favoriten, aktiverFavoritId: start.eintrag.id },
    folge(1, 1), mittendrin(400));

  pruefe("Die bekannte Serienlaenge wirft den Durchlauf nicht ans Ende",
    weiter.eintrag.episode === 1 && weiter.eintrag.season === 1,
    `steht auf S${weiter.eintrag.season}F${weiter.eintrag.episode}`);
  pruefe("Und meldet keine neue Folge",
    weiter.meldungen.every((zeile) => !/neue Folge/i.test(zeile)),
    JSON.stringify(weiter.meldungen));
  pruefe("Der Abschluss bleibt dabei stehen",
    weiter.eintrag.completed === true && weiter.eintrag.rewatching === true);

  // Echter Nachschub waehrend eines Durchlaufs: die Grenzen wandern mit, der
  // Stand des Benutzers bleibt stehen. Erkannt wird der Nachschub, sobald der
  // Durchlauf vorbei ist - waehrenddessen wuerde er nur stoeren.
  const laufend = { ...weiter.eintrag };
  fortschritt.applyFavoriteSeriesBounds(laufend, { finalSeason: 2, finalEpisode: 4 }, folge(1, 1), []);
  pruefe("Auch eine gewachsene Serie holt den Eintrag nicht aus dem Durchlauf",
    laufend.url === folge(1, 1) && laufend.completed === true && laufend.favorite === false,
    `${laufend.url} / completed=${laufend.completed}`);
  pruefe("Die neue Serienlaenge wird trotzdem uebernommen",
    laufend.finalSeason === 2 && laufend.finalEpisode === 4);

  // Und ohne laufenden Durchlauf greift die Erkennung unveraendert.
  const ruhend = { ...weiter.eintrag, rewatching: false, url: folge(1, 3), normalizedUrl: folge(1, 3) };
  const meldungen = [];
  fortschritt.applyFavoriteSeriesBounds(ruhend, { finalSeason: 2, finalEpisode: 4 }, folge(1, 3), meldungen);
  pruefe("Ohne Durchlauf holt eine neue Staffel den Titel wie bisher zurueck",
    ruhend.completed === false && ruhend.favorite === true && ruhend.rewatching === false,
    JSON.stringify(meldungen));
}

/* --- Der Durchlauf geht zu Ende ----------------------------------------- */

{
  const fertig = fertigeSerie();
  const start = verbuche(
    { favoriten: fertig.favoriten, aktiverFavoritId: fertig.eintrag.id },
    folge(1, 1), mittendrin(200));
  const zuEnde = verbuche(
    { favoriten: start.favoriten, aktiverFavoritId: start.eintrag.id },
    folge(1, 3), ganzDurch);

  pruefe("Am Ende des zweiten Durchlaufs ist das Wiederansehen vorbei",
    zuEnde.eintrag.rewatching === false);
  pruefe("Der Titel ist weiterhin abgeschlossen",
    zuEnde.eintrag.completed === true);
  pruefe("Und steht wieder allein in der Mediathek",
    fortschritt.hasContinueProgressRecord(zuEnde.eintrag) === false);
  pruefe("Der Durchlauf ist gezaehlt",
    zuEnde.eintrag.rewatchCount === 1 && fortschritt.durchlaeufe(zuEnde.eintrag) === 2,
    `rewatchCount=${zuEnde.eintrag.rewatchCount}`);
  pruefe("Und steht im Verlauf",
    (zuEnde.eintrag.activity || []).some((e) => /2\. Durchlauf abgeschlossen/.test(e.label || "")),
    JSON.stringify((zuEnde.eintrag.activity || []).map((e) => e.label)));

  // Noch eine Meldung vom selben Ende darf nicht ein zweites Mal zaehlen.
  const nochmal = verbuche(
    { favoriten: zuEnde.favoriten, aktiverFavoritId: zuEnde.eintrag.id },
    folge(1, 3), ganzDurch);
  pruefe("Ein weiterer Takt am selben Ende zaehlt nicht doppelt",
    nochmal.eintrag.rewatchCount === 1,
    "gezaehlt wird der Uebergang, nicht der Zustand");
}

/* --- Ein Film ------------------------------------------------------------ */

{
  const erst = verbuche({}, FILM, { currentTime: 5900, duration: 6000, watchedSeconds: 6000 });
  pruefe("Ein durchgesehener Film ist abgeschlossen", erst.eintrag.completed === true);

  const wieder = verbuche(
    { favoriten: erst.favoriten, aktiverFavoritId: erst.eintrag.id },
    FILM, { currentTime: 600, duration: 6000, watchedSeconds: 600 });
  pruefe("Ein Film laesst sich genauso wiedersehen",
    wieder.eintrag.completed === true && wieder.eintrag.rewatching === true
    && fortschritt.hasContinueProgressRecord(wieder.eintrag) === true);
  pruefe("Und behaelt dabei seinen echten Stand statt 100 Prozent",
    wieder.eintrag.progress === 10, `${wieder.eintrag.progress}%`);

  const nochmalDurch = verbuche(
    { favoriten: wieder.favoriten, aktiverFavoritId: wieder.eintrag.id },
    FILM, { currentTime: 5900, duration: 6000, watchedSeconds: 6000 });
  pruefe("Der zweite Durchlauf eines Films wird gezaehlt",
    nochmalDurch.eintrag.rewatchCount === 1 && nochmalDurch.eintrag.rewatching === false);
}

/* --- Der Folgenwechsel ohne Wiedergabe ---------------------------------- */
//
// Das war der zweite Weg hinaus: wer waehrend des Wiederansehens auf die
// naechste Folge blaetterte, verlor den Abschluss - und damit die Mediathek.

{
  const fertig = fertigeSerie();
  const urteil = fortschritt.favoritNachziehen(
    { ...fertig.eintrag, url: folge(1, 1), normalizedUrl: folge(1, 1) },
    folge(1, 2), ANBIETER, "sequential");
  pruefe("Der Folgenwechsel zieht den Eintrag nach", urteil.art === "nachziehen");
  pruefe("Und nimmt ihm den Abschluss nicht mehr weg",
    urteil.aenderung.completed === true,
    "bis 1.69.0 stand hier false - der Titel fiel aus der Mediathek");
  pruefe("Er gilt dabei als Wiederansehen",
    urteil.aenderung.rewatching === true);

  const offen = fortschritt.favoritNachziehen(
    { id: "x", url: folge(1, 1), normalizedUrl: folge(1, 1), completed: false },
    folge(1, 2), ANBIETER, "sequential");
  pruefe("Ein offener Titel wird davon nicht zum Wiederansehen",
    offen.aenderung.completed === false && offen.aenderung.rewatching === false);
}

/* --- Von vorn beginnen --------------------------------------------------- */

{
  const fertig = fertigeSerie();
  const aenderung = fortschritt.wiederansehenBeginnen(fertig.eintrag);
  pruefe("Von vorn heisst Staffel 1 Folge 1",
    aenderung.url === folge(1, 1) && aenderung.season === 1 && aenderung.episode === 1,
    aenderung.url);
  pruefe("Der Stand wird geleert",
    aenderung.progress === 0 && aenderung.currentTime === 0 && aenderung.duration === 0);
  pruefe("Der Eintrag ist sofort wieder sichtbar",
    aenderung.hideFromContinueWatching === false && aenderung.continuePending === true
    && aenderung.rewatching === true);
  pruefe("Der Abschluss wird nicht angefasst",
    !("completed" in aenderung),
    "was nicht drinsteht, kann die Mediathek auch nicht verlieren");

  const angewandt = { ...fertig.eintrag, ...aenderung };
  pruefe("Angewandt steht der Titel in beiden Listen",
    angewandt.completed === true && fortschritt.hasContinueProgressRecord(angewandt) === true);

  const film = fortschritt.wiederansehenBeginnen({ url: FILM, completed: true, title: "Spiderman" });
  pruefe("Ein Film hat keine erste Folge und behaelt seine Adresse",
    !("url" in film) && film.rewatching === true);
}

/* --- Zaehlen ------------------------------------------------------------- */

pruefe("Ohne Abschluss und ohne Durchlaeufe zaehlt nichts",
  fortschritt.durchlaeufe({ completed: false }) === 0);
pruefe("Ein Abschluss ist ein Durchlauf",
  fortschritt.durchlaeufe({ completed: true }) === 1);
pruefe("Jeder weitere zaehlt dazu",
  fortschritt.durchlaeufe({ completed: true, rewatchCount: 2 }) === 3);
pruefe("Ein laufender Durchlauf zaehlt noch nicht mit",
  fortschritt.durchlaeufe({ completed: true, rewatching: true }) === 1,
  "gezaehlt wird, was zu Ende gesehen wurde");
pruefe("istWiederansehen gilt nur mit Abschluss",
  fortschritt.istWiederansehen({ completed: true, rewatching: true }) === true
  && fortschritt.istWiederansehen({ completed: false, rewatching: true }) === false);

/* --- Der Neustart -------------------------------------------------------- */
//
// Beim Laden wird der Abschluss einer Serie aus der Adresse hergeleitet: nur
// wer auf der letzten Folge steht, ist durch. Mitten im zweiten Durchlauf steht
// der Eintrag aber auf Folge 1 - und verlor so lautlos die Mediathek.

{
  const QUELLE = lies("src/main.js");
  const umgebung = {
    Boolean, String, Number, Math, Array, Object, RegExp, URL,
    inferMediaType: fortschritt.inferMediaType,
    episodeIdentity: fortschritt.episodeIdentity,
    isCompletedProgress: fortschritt.isCompletedProgress,
    isWholeMediaCompleted: fortschritt.isWholeMediaCompleted,
    sanitizePositiveNumber: fortschritt.sanitizePositiveNumber
  };
  const vm = require("vm");
  vm.createContext(umgebung);
  const anfang = QUELLE.indexOf("function normalizeStoredCompletion(");
  const ende = QUELLE.indexOf(String.fromCharCode(10) + "}", anfang) + 2;
  vm.runInContext(QUELLE.slice(anfang, ende), umgebung);
  const geladen = vm.runInContext("normalizeStoredCompletion", umgebung);

  const laufend = {
    type: "serie", url: folge(1, 1), completed: true, rewatching: true,
    progress: 14, finalSeason: 1, finalEpisode: 3
  };
  pruefe("Ein laufender Durchlauf behaelt beim Neustart seinen Abschluss",
    geladen(laufend) === true,
    "sonst faellt der Titel beim naechsten Start aus der Mediathek");

  const halb = { ...laufend, rewatching: false };
  pruefe("Ohne Durchlauf entscheidet weiterhin die Adresse",
    geladen(halb) === false,
    "eine Serie auf Folge 1 von 3 ist nicht abgeschlossen");
  pruefe("Und die letzte Folge gilt unveraendert als Abschluss",
    geladen({ ...halb, url: folge(1, 3) }) === true);
}

/* --- Die drei Stellen, die die Regel ein zweites Mal aussprechen --------- */

{
  const RENDERER = lies("src/renderer/renderer.js");
  // Das Fenster ist grosszuegig: in continueEntries steht inzwischen auch der
  // Merker fuer archivierte Raum-Eintraege samt seiner Begruendung. Gemeint
  // ist weiterhin dasselbe - die Ausnahme muss *in* dieser Funktion stehen und
  // nicht irgendwo in der Datei.
  pruefe("Die Oberflaeche kennt die Ausnahme in Weiterschauen",
    /function continueEntries\(\)[\s\S]{0,900}?!item\.completed \|\| istWiederansehen\(item\)/.test(RENDERER));
  pruefe("Die Mediathek filtert weiterhin allein auf completed",
    /function libraryEntries\([\s\S]{0,400}?\.filter\(\(item\) => item\.completed\)/.test(RENDERER),
    "sonst faellt ein laufender Durchlauf aus der Mediathek");
  pruefe("Die Karte sagt, dass ein Durchlauf laeuft",
    /function wiederansehenMarkup\([\s\S]{0,500}?Durchlauf/.test(RENDERER)
    && /wiederansehenMarkup\(favorite\)/.test(RENDERER));
  pruefe("Und wie oft der Titel gesehen wurde",
    /× gesehen/.test(RENDERER));
  pruefe("Die Signatur traegt den Zustand mit",
    /eintrag\.rewatching \? 1 : 0/.test(RENDERER),
    "sonst zeichnet die Oberflaeche den Wechsel nie neu");
  pruefe("Die Mediathek bietet den Weg von vorn an",
    /allowRewatch: true/.test(RENDERER) && /rewatchFromStart/.test(RENDERER));
}

{
  const JAVA = fs.readFileSync(
    path.join(WURZEL, "..", "android", "app", "src", "main", "java", "local", "elflix",
      "android", "Favorite.java"), "utf8");
  pruefe("Favorite.java kennt dieselbe Ausnahme",
    /istAbgeschlossen\(\) && !istWiederansehen\(\)\) return false;/.test(JAVA),
    "die Liste auf dem Telefon zeichnet ohne Kern und muss die Regel mitfuehren");
  pruefe("Und zaehlt die Durchlaeufe gleich",
    /public int durchlaeufe\(\)[\s\S]{0,300}?return 1 \+ weitere;/.test(JAVA));
}

// Der Weg dorthin auf dem Telefon und am Fernseher: die Kachel selbst.
//
// Am Rechner steht er im Aktionsmenue, und mit einer Maus ist das ein
// Rechtsklick. Mit einem Steuerkreuz sind es drei Schritte - und solange der
// Tipp die gespeicherte Adresse oeffnete, landete er am *Ende* der Serie, die
// man gerade durchgeschaut hatte.
{
  const HAUPT = fs.readFileSync(
    path.join(WURZEL, "..", "android", "app", "src", "main", "java", "local", "elflix",
      "android", "MainActivity.java"), "utf8");

  pruefe("Ein Tipp auf einen durchgeschauten Titel faengt von vorn an",
    /private void openFavorite\(Favorite favorite\)[\s\S]{0,1200}?bestand\.wiederansehenStarten\(favorite\.id\(\)/
      .test(HAUPT));
  pruefe("aber nur, solange kein Durchlauf laeuft",
    /favorite\.istAbgeschlossen\(\) && !favorite\.istWiederansehen\(\)/.test(HAUPT),
    "sonst setzte jeder Tipp in Weiterschauen die Serie wieder an den Anfang");
  pruefe("Geoeffnet wird der frische Eintrag, nicht der aus der Hand",
    /wiederansehenStarten\([\s\S]{0,400}?bestand\.mitId\(favorite\.id\(\)\)/.test(HAUPT),
    "der in der Hand traegt noch die letzte Folge");
  pruefe("Der Doppeltipp-Schutz haelt den eigenen zweiten Aufruf nicht auf",
    /wiederansehenStarten\([\s\S]{0,500}?favoritOeffnen\(frisch/.test(HAUPT),
    "ueber openFavorite liefe er in die Sperre, die der erste Tipp gerade gesetzt hat");

  const BESTAND = fs.readFileSync(
    path.join(WURZEL, "..", "android", "app", "src", "main", "java", "local", "elflix",
      "android", "Bestand.java"), "utf8");
  pruefe("Die Regel dahinter bleibt die geteilte",
    /kern\.rufe\("fortschritt\.wiederansehenBeginnen"/.test(BESTAND),
    "welche Folge die erste ist, entscheidet der Kern und nicht Java");
}

{
  const SCHLUESSEL = lies("src/geraete-schluessel.js");
  const STAND = lies("src/geraete-stand.js");
  pruefe("Der Abgleich nimmt den Zustand mit",
    /rewatching: Boolean\(favorit\?\.rewatching && favorit\?\.completed\)/.test(SCHLUESSEL)
    && /rewatchCount/.test(SCHLUESSEL),
    "sonst blendet das andere Geraet den Titel mitten im Durchlauf aus");
  pruefe("Und die Zahl der Durchlaeufe kann dabei nur wachsen",
    /lokal\.rewatchCount = Math\.max\(/.test(STAND));
}

{
  const MAIN = lies("src/main.js");
  pruefe("Die Ablage merkt sich beides ueber den Neustart",
    /rewatching: Boolean\(favorite\.rewatching\) && normalizeStoredCompletion\(favorite\)/.test(MAIN)
    && /rewatchCount: sanitizePositiveNumber\(favorite\.rewatchCount\)/.test(MAIN));
  pruefe("Die Suche nach neuen Folgen laesst laufende Durchlaeufe in Ruhe",
    /favorite\.completed && !favorite\.rewatching/.test(MAIN));
  pruefe("Von Hand abhaken beendet einen laufenden Durchlauf",
    /favorite\.hideFromContinueWatching = true;[\s\S]{0,400}?favorite\.rewatching = false;/.test(MAIN));
}

const fehler = pruefungen.filter((x) => !x).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
