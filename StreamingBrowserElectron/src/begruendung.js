"use strict";

// Warum steht dieser Titel auf der Startseite?
//
// Entschieden wird das in empfehlung.js: dort wird aus den tatsaechlichen
// Score-Beitraegen bestimmt, welches Signal die Empfehlung getragen hat, und
// ob der Beleg dazu stark genug ist, um ihn beim Namen zu nennen. Dieser
// Baustein macht daraus Saetze - mehr nicht. Er rechnet nichts nach und
// entscheidet nichts; die Oberflaeche bekommt den fertigen Text und zeigt ihn
// an.
//
// Die wichtigste Regel: was die Engine nicht belegt, wird nicht behauptet.
// Fehlt der Titel zu einem Grund, wird der Satz allgemeiner - niemals
// konkreter. Woerter wie "beliebt", "im Trend", "gut bewertet", "Klassiker"
// oder "aktuell" sind Datenbehauptungen und stehen deshalb in keinem Satz,
// solange ELFIX die Daten dafuer nicht hat.
//
// --- Was ELFIX zu einem Titel wirklich weiss --------------------------------
//
// Aus den Anbieterseiten kommen: Titel, Adresse, Bild, Genres/Tags (bei
// AniWorld auch feine wie "Fighting-Shounen" oder "Magical Girl"), der Block
// "Das schauen andere", und ob ein Titel in der Neuheiten-Reihe des Anbieters
// steht. Aus der eigenen Ablage kommen: Fortschritt, abgeschlossene Folgen,
// Watchlist, Zeitstempel und die Titel-/Reihenanalyse aus titel.js.
//
// Es gibt NICHT: Besetzung, Regie, Studio, Beschreibung, Erscheinungsjahr,
// Herkunftsland, Bewertungen, Abrufzahlen, Ranglisten.
//
// --- Die Gruende ------------------------------------------------------------
//
// Reason:            NEXT_IN_FRANCHISE
// Benoetigte Daten:  Reihenerkennung aus titel.js, abgeschlossene Teile
// Confidence-Regel:  Reihen-Konfidenz >= 0.7 und eine belegbare Teilnummer
// Ranking-Signal:    m.naechsterTeil (Gewicht 1.6)
// Beispieltext:      "Naechster Teil nach John Wick: Kapitel 2"
//
// Reason:            SAME_FRANCHISE
// Benoetigte Daten:  wie oben, ohne belegbare Reihenfolge; im Graubereich
//                    zusaetzlich die Genres beider Titel
// Confidence-Regel:  Reihen-Konfidenz >= 0.7. Zwischen 0.45 und 0.7 - also
//                    bei einem einzigen gemeinsamen Wort wie "Naruto" in
//                    "Naruto Shippuden" - nur, wenn sich die Inhalte zu
//                    mindestens 75% decken. Genau daran scheitert "Avatar"
//                    gegen "Avatar Aang", und genau so kommt "Naruto
//                    Shippuden" durch, ohne dass ein Titel verdrahtet waere.
// Ranking-Signal:    m.reihe (Gewicht 0.9)
// Beispieltext:      "Aus derselben Reihe wie Naruto"
//
// Reason:            REDISCOVERY
// Benoetigte Daten:  wie SAME_FRANCHISE, dazu der Zeitstempel der Reihe
// Confidence-Regel:  letzter Teil der Reihe laenger als 45 Tage her
// Ranking-Signal:    m.reihe
// Beispieltext:      "Zurueck zu Harry Potter und der Stein der Weisen"
//
// Reason:            SIMILAR_TO_RECENT
// Benoetigte Daten:  Genres von Kandidat und Verlaufstitel
// Confidence-Regel:  >= 2 gemeinsame Genres, Deckung >= 0.6 und 1.6-facher
//                    Vorsprung vor dem zweitbesten Werk des Verlaufs
// Ranking-Signal:    m.verlauf (Gewicht 0.6)
// Beispieltext:      "Aehnlich wie Der Pate"
//
// Reason:            BASED_ON_WATCHLIST
// Benoetigte Daten:  vorgemerkte Titel mit Genres
// Confidence-Regel:  konkreter Titel nur, wenn er >= 60% des Signals traegt
// Ranking-Signal:    m.watchlist (Gewicht 0.35)
// Beispieltext:      "Passend zu Der Exorzist auf deiner Watchlist"
//
// Reason:            SIMILAR_TO_RECENT ist der einzige Titelbezug ausserhalb
//                    der Reihen. Die Anbieter-Verknuepfung ("Das schauen
//                    andere") ist KEIN Grund mehr, sondern nur noch ein
//                    internes Signal - siehe unten.
//
// Reason:            SPECIFIC_TAG
// Benoetigte Daten:  spezifischer Tag (kein breites Sammelgenre) im Profil
// Confidence-Regel:  aus >= 2 Werken, Profilwert >= 0.3, Name in der Tabelle
// Ranking-Signal:    m.genre / m.sitzung - beide sind seit der Gewichtung
//                    nach Seltenheit vor allem von den spezifischen Tags
//                    getragen: "beide sind Fighting-Shounen" wiegt weit
//                    schwerer als "beide sind Action".
// Beispieltext:      "Mehr Fighting-Shounen fuer dich"
//
// Reason:            TAG_COMBINATION
// Benoetigte Daten:  starkes Genre plus belegte Anime-/Serien-/Film-Vorliebe
// Confidence-Regel:  beide Teile einzeln belegt
// Ranking-Signal:    m.genre / m.sitzung
// Beispieltext:      "Mehr Action-Anime fuer dich"
//
// Reason:            BASED_ON_GENRE
// Benoetigte Daten:  breites Genre im Profil
// Confidence-Regel:  aus >= 2 Werken, Profilwert >= 0.5
// Ranking-Signal:    m.genre / m.sitzung
// Beispieltext:      "Weil du oft Action schaust"
//
// Reason:            CURRENT_TASTE
// Benoetigte Daten:  Zeitstempel der letzten Stunden (Sitzungsprofil)
// Confidence-Regel:  Sitzungssignal >= Verlaufs- und Genresignal
// Ranking-Signal:    m.sitzung (Gewicht 0.7)
// Beispieltext:      "Passt zu dem, was du gerade schaust"
//
// Reason:            LONG_TERM_TASTE
// Benoetigte Daten:  Verlauf mit Genres
// Confidence-Regel:  keine - der allgemeinste belegte Grund
// Ranking-Signal:    m.verlauf / m.genre
// Beispieltext:      "Passend zu deinem bisherigen Geschmack"
//
// Reason:            CONTENT_TYPE_PREFERENCE
// Benoetigte Daten:  Art (Anime/Serie/Film) aus der Adresse, Verlauf
// Confidence-Regel:  >= 50% des gewichteten Verlaufs und >= 3 Werke
// Ranking-Signal:    m.genre / m.verlauf
// Beispieltext:      "Mehr Anime fuer dich"
//
// Reason:            NOVELTY
// Benoetigte Daten:  Titel stammt aus der Neuheiten-Reihe des Anbieters
// Confidence-Regel:  via === "new" (die Reihe traegt die Ueberschrift des
//                    Anbieters, etwa "Neue Animes")
// Ranking-Signal:    m.neuheit (Gewicht 0.15)
// Beispieltext:      "Neu bei deinem Anbieter"
//
// Reason:            EXPLORATION
// Benoetigte Daten:  keine
// Confidence-Regel:  kein anderes Signal traegt
// Beispieltext:      "Koennte einen Versuch wert sein"
//
// --- Aus externen Daten -----------------------------------------------------
//
// Seit die App das Metadaten-Tor des Relays benutzt (src/metadaten.js), kommen
// zu jedem sicher zugeordneten Titel Daten von TMDB oder AniList dazu. Damit
// sind Saetze belegbar, die vorher erfunden gewesen waeren. Jeder von ihnen
// setzt eine Zuordnung mit ausreichender Konfidenz voraus - was nur vermutet
// zugeordnet ist, traegt keinen dieser Gruende.
//
// Reason:            EXTERNAL_SEQUEL
// Benoetigte Daten:  AniList-Beziehung SEQUEL zwischen zwei Kennungen, oder
//                    dieselbe TMDB-Sammlung mit spaeterem Erscheinungsjahr
// Confidence-Regel:  beide Titel mindestens HIGH zugeordnet
// Ranking-Signal:    m.externRelation (Gewicht 1.5)
// Beispieltext:      "Fortsetzung von Naruto"
//
// Reason:            EXTERNAL_PREQUEL
// Benoetigte Daten:  wie oben, Richtung umgekehrt
// Beispieltext:      "Die Vorgeschichte zu Naruto Shippuden"
//
// Reason:            EXTERNAL_COLLECTION
// Benoetigte Daten:  gemeinsame TMDB-Sammlungskennung (nur Filme - fuer Serien
//                    fuehrt TMDB dieses Feld nicht)
// Beispieltext:      "Mehr aus der Welt von Iron Man"
//
// Reason:            EXTERNAL_FRANCHISE
// Benoetigte Daten:  AniList-Beziehung SIDE_STORY, SPIN_OFF, PARENT,
//                    ALTERNATIVE oder OTHER
// Beispieltext:      "Aus derselben Reihe wie Bleach"
//
// Reason:            EXTERNAL_TAG_SIMILARITY
// Benoetigte Daten:  gewichtete AniList-Tags bzw. TMDB-Schlagworte beider
//                    Titel
// Confidence-Regel:  >= 3 gemeinsame Merkmale, gewichtete Deckung >= 0.25 und
//                    Vorsprung vor dem zweitbesten Verlaufstitel
// Ranking-Signal:    m.externInhalt (Gewicht 0.85)
// Beispieltext:      "Weil du Naruto geschaut hast"
//
// Reason:            EXTERNAL_RECOMMENDATION
// Benoetigte Daten:  der eine Titel steht in der Empfehlungsliste des anderen
// Ranking-Signal:    m.externEmpfehlung (Gewicht 0.35)
// Beispieltext:      "Ähnlich wie Game of Thrones"
//                    Bewusst schwach formuliert: belegt ist, dass TMDB die
//                    beiden nebeneinanderstellt - nicht, dass sie
//                    zusammengehoeren. Auf der Iron-Man-Seite steht dort auch
//                    Black Adam.
//
// Reason:            SAME_ACTOR / SAME_DIRECTOR / SAME_CREATOR / SAME_STUDIO
// Benoetigte Daten:  Besetzung, Regie, Autoren, Produktionsfirmen von TMDB;
//                    Hauptstudio von AniList
// Ranking-Signal:    m.externPersonen (Gewicht 0.3)
// Beispieltext:      "Mehr mit Robert Downey Jr.", "Vom Regisseur von Iron Man"
//
// --- Bewusst nicht vorhanden ------------------------------------------------
//
// SIMILAR_THEME: Beschreibungen verlassen das Relay nicht - die Normalform
//   fuehrt sie gar nicht. Die Schlagworte leisten dasselbe genauer.
// COUNTRY_AFFINITY: die Normalform gibt kein Herkunftsland aus. (Dass AniWorld
//   ueberwiegend Anime fuehrt, ist eine Aussage ueber den Anbieter, nicht
//   ueber das Land.)
// SAME_UNIVERSE fuer Serien: weiterhin nicht belegbar - und nachgemessen.
//   TMDB fuehrt Sammlungen nur fuer Filme; "Game of Thrones" und "House of the
//   Dragon" haben keine gemeinsame Kennung, keinen gemeinsamen Autor und kein
//   gemeinsames Titelwort. Was es gibt: HotD fuehrt GoT in seiner
//   Empfehlungsliste, beide teilen fuenf Schlagworte und den Sender. Das
//   traegt "Ähnlich wie Game of Thrones" - es traegt nicht "spielt in derselben
//   Welt". Fuer Filme ist genau diese Aussage dagegen belegt, dort heisst sie
//   EXTERNAL_COLLECTION.
// POPULAR / TRENDING / HIGH_RATED: Bewertung und Bekanntheit gibt es jetzt,
//   aber sie bleiben ohne eigenen Grund. Sie sortieren fein (Gewicht 0.1) und
//   sagen nichts ueber diesen Nutzer; "das schauen viele" waere eine Aussage
//   ueber alle anderen. Ausserdem taeuscht ein Durchschnitt aus wenigen
//   Stimmen - unter 500 Stimmen zaehlt er in empfehlung.js gar nicht.
// NEXT_IN_SERIES: Fortschritt und Folgen sind zwar bekannt, die eigene Serie
//   ist in den Empfehlungen aber ausgeschlossen - dafuer gibt es
//   "Weiterschauen" auf derselben Startseite.
//
// Kommen diese Daten spaeter dazu, gehoert hier je ein Grund mit derselben
// Dokumentation hin - und in empfehlung.js ein Merkmal, das ihn traegt.

// Die Gruende, wie empfehlung.js sie vergibt. Als Zeichenketten gefuehrt, weil
// genau diese Werte auch nach aussen gehen - an die Oberflaeche und in die
// Pruefungen.
const GRUND = {
  NAECHSTER_TEIL: "NEXT_IN_FRANCHISE",
  REIHE: "SAME_FRANCHISE",
  WIEDERENTDECKUNG: "REDISCOVERY",
  AEHNLICH_ZULETZT: "STRONG_SEED_SIMILARITY",
  ANBIETER_AEHNLICH: "RELATED_BY_PROVIDER",
  TAG: "SPECIFIC_TAG",
  TAG_PAAR: "TAG_COMBINATION",
  GENRE: "BASED_ON_GENRE",
  WATCHLIST: "BASED_ON_WATCHLIST",
  SITZUNG: "CURRENT_TASTE",
  VERLAUF: "LONG_TERM_TASTE",
  NEUHEIT: "NOVELTY",
  ERKUNDUNG: "EXPLORATION",
  EXTERN_FORTSETZUNG: "EXTERNAL_SEQUEL",
  EXTERN_VORGAENGER: "EXTERNAL_PREQUEL",
  EXTERN_SAMMLUNG: "EXTERNAL_COLLECTION",
  EXTERN_REIHE: "EXTERNAL_FRANCHISE",
  EXTERN_INHALT: "EXTERNAL_TAG_SIMILARITY",
  EXTERN_EMPFEHLUNG: "EXTERNAL_RECOMMENDATION",
  EXTERN_SCHAUSPIELER: "SAME_ACTOR",
  EXTERN_REGIE: "SAME_DIRECTOR",
  EXTERN_AUTOR: "SAME_CREATOR",
  EXTERN_STUDIO: "SAME_STUDIO"
};

// Die Genre-Schluessel der Engine sind vereinheitlicht und umlautfrei
// ("komoedie", "scifi") - so taugen sie nicht als Text, und automatisch
// verschoenern laesst sich das nicht ("actionkomoedie" hat kein "ö" mehr).
// Deshalb eine Tabelle: was hier fehlt, wird nicht genannt, sondern es greift
// der naechste Grund.
const GENRE_NAMEN = new Map(Object.entries({
  action: "Action",
  abenteuer: "Abenteuer",
  animation: "Animation",
  doku: "Dokus",
  drama: "Drama",
  familie: "Familienfilme",
  fantasy: "Fantasy",
  historie: "Historisches",
  horror: "Horror",
  komoedie: "Komödien",
  krieg: "Kriegsfilme",
  krimi: "Krimis",
  musik: "Musikfilme",
  mystery: "Mystery",
  reality: "Reality",
  romanze: "Romantik",
  scifi: "Sci-Fi",
  sport: "Sport",
  superhelden: "Superhelden",
  thriller: "Thriller",
  tvfilm: "Fernsehfilme",
  uebernatuerlich: "Übernatürliches",
  western: "Western",
  zeichentrick: "Zeichentrick"
}));

// Die feinen Tags der Anbieter. Sie sagen mehr ueber den Geschmack aus als
// "Action" - aber nur, wenn sie sich lesbar schreiben lassen.
const TAG_NAMEN = new Map(Object.entries({
  "fighting-shounen": "Fighting-Shounen",
  shounen: "Shounen",
  shoujo: "Shoujo",
  seinen: "Seinen",
  josei: "Josei",
  isekai: "Isekai",
  mecha: "Mecha",
  ecchi: "Ecchi",
  harem: "Harem",
  "magical-girl": "Magical Girl",
  alltagsleben: "Alltagsgeschichten",
  alltagsdrama: "Alltagsdramen",
  psychodrama: "Psychodramen",
  actiondrama: "Actiondramen",
  actionkomoedie: "Actionkomödien",
  "romantische-komoedie": "Romantische Komödien",
  dramedy: "Dramedys",
  "k-drama": "K-Dramas",
  jugend: "Jugendserien",
  ganbatte: "Ganbatte-Anime"
}));

// Als Wortanfang einer Zusammensetzung: "Action-Anime", "Sci-Fi-Serien".
const KOMBI_NAMEN = new Map(Object.entries({
  action: "Action",
  abenteuer: "Abenteuer",
  drama: "Drama",
  fantasy: "Fantasy",
  horror: "Horror",
  komoedie: "Comedy",
  krimi: "Krimi",
  mystery: "Mystery",
  romanze: "Romantik",
  scifi: "Sci-Fi",
  thriller: "Thriller"
}));

const ART_NAMEN = new Map(Object.entries({
  anime: "Anime",
  serie: "Serien",
  film: "Filme"
}));

// So lang darf ein zitierter Titel in der Begruendung werden. Darueber wird
// gekuerzt: die Zeile soll unter den Titel passen, nicht die Karte sprengen.
const TITEL_GRENZE = 44;

function kuerzen(wert, grenze = TITEL_GRENZE) {
  const text = String(wert || "").trim();
  if (text.length <= grenze) return text;
  // Lieber an der Wortgrenze abschneiden - mitten im Wort liest sich ein
  // gekuerzter Titel wie ein anderer Titel.
  const schnitt = text.slice(0, grenze);
  const luecke = schnitt.lastIndexOf(" ");
  const kurz = luecke > grenze * 0.55 ? schnitt.slice(0, luecke) : schnitt;
  return `${kurz.replace(/[\s,:;.–-]+$/, "")}…`;
}

function genreName(schluessel) {
  return GENRE_NAMEN.get(String(schluessel || "").toLowerCase()) || "";
}

function tagName(schluessel) {
  return TAG_NAMEN.get(String(schluessel || "").toLowerCase()) || "";
}

function artName(schluessel) {
  return ART_NAMEN.get(String(schluessel || "").toLowerCase()) || "";
}

// "action" + "anime" -> "Action-Anime". Nur aus Bausteinen, die sich ohne
// Beugung zusammensetzen lassen - deutsche Mehrzahl ist zu heikel, um sie zu
// raten.
function kombiName(genre, art) {
  const stamm = KOMBI_NAMEN.get(String(genre || "").toLowerCase());
  const kopf = artName(art);
  return stamm && kopf ? `${stamm}-${kopf}` : "";
}

// Alle Saetze, die fuer diesen Grund wahr sind - der aussagekraeftigste zuerst.
// Die Engine sucht sich daraus einen aus; sie darf jeden nehmen, ohne dass
// etwas falsch wird.
function textVarianten(item) {
  if (!item || !item.grund) return [];
  const titel = kuerzen(item.grundTitel);
  const tag = tagName(item.grundTag);
  const genre = genreName(item.grundGenre);
  const kombi = kombiName(item.grundGenre, item.grundArt);
  // Namen von Personen und Studios kommen aus TMDB und AniList. Sie werden
  // nur gekuerzt, nicht uebersetzt oder gebeugt - "Mehr mit Robert Downey Jr."
  // ist richtig, alles Weitergehende waere geraten.
  const person = kuerzen(item.grundPerson, 32);

  switch (item.grund) {
    case GRUND.NAECHSTER_TEIL:
      return titel
        ? [`Nächster Teil nach ${titel}`, `Weiter nach ${titel}`, "Der nächste Teil deiner Reihe"]
        : ["Der nächste Teil deiner Reihe", "Als Nächstes in dieser Reihe", "Die Reihe geht weiter"];

    case GRUND.REIHE:
      return titel
        ? [`Aus derselben Reihe wie ${titel}`, `Gehört zur Reihe von ${titel}`, "Mehr aus einer Reihe, die du schaust"]
        : ["Mehr aus einer Reihe, die du schaust", "Gehört zu einer Reihe, die du schaust"];

    case GRUND.WIEDERENTDECKUNG:
      return titel
        ? [`Zurück zu ${titel}`, `Aus der Reihe von ${titel}, die du mal geschaut hast`]
        : ["Zurück zu einer Reihe, die du mal geschaut hast", "Vielleicht wieder etwas für dich"];

    // Diesen Grund vergibt die Engine nur, wenn der Titel die Huerden genommen
    // hat. Ohne Titel gaebe es nichts zu vergleichen.
    case GRUND.AEHNLICH_ZULETZT:
      return titel
        ? [`Weil du ${titel} geschaut hast`, `Ähnlich wie ${titel}`, `Passend zu ${titel}`,
          `Mehr wie ${titel}`]
        : [];

    case GRUND.WATCHLIST:
      return titel
        ? [`Passend zu ${titel} auf deiner Watchlist`, `Ähnlich zu ${titel} auf deiner Watchlist`]
        : ["Passend zu deiner Watchlist", "Ähnlich zu deinen vorgemerkten Titeln",
          "Passt zu dem, was du dir gemerkt hast"];

    // Belegt ist hier nur, dass der Anbieter diesen Titel auf der Seite des
    // anderen fuehrt. Das ist keine inhaltliche Aehnlichkeit, und die Saetze
    // behaupten auch keine.
    case GRUND.ANBIETER_AEHNLICH:
      return titel
        ? [`Vorgeschlagen bei ${titel}`, `Steht bei ${titel} unter den Vorschlägen`]
        : ["Könnte dir gefallen"];

    case GRUND.TAG:
      if (!tag) return [];
      return item.grundSitzung
        ? [`Weil du zuletzt viel ${tag} schaust`, `Passt zu deinem aktuellen ${tag}-Lauf`,
          `Mehr ${tag} für dich`]
        : [`Mehr ${tag} für dich`, `Weil du gerne ${tag} schaust`, `Passt zu deinem ${tag}-Geschmack`,
          `Weil du oft ${tag} schaust`, `Noch mehr ${tag} für dich`];

    case GRUND.TAG_PAAR:
      if (!kombi) return [];
      return item.grundSitzung
        ? [`Weil du gerade viele ${kombi} schaust`, `Mehr ${kombi} für dich`]
        : [`Mehr ${kombi} für dich`, `Passend zu deinen ${kombi}`, `Weil du gerne ${kombi} schaust`];

    case GRUND.GENRE:
      if (!genre) return [];
      return item.grundSitzung
        ? [`Weil du zuletzt viel ${genre} geschaut hast`, `Passt zu deinem aktuellen ${genre}-Lauf`,
          `Gerade viel ${genre} bei dir`]
        : [`Weil du oft ${genre} schaust`, `Mehr ${genre} für dich`, `Passt zu deinem ${genre}-Geschmack`,
          `Weil du gerne ${genre} schaust`, `Noch mehr ${genre} für dich`];

    case GRUND.SITZUNG:
      return ["Passt zu dem, was du gerade schaust", "Passend zu deinem aktuellen Geschmack"];

    case GRUND.VERLAUF:
      return ["Passt zu deinem Geschmack", "Ein Tipp für dich", "Könnte dir gefallen"];

    // "Neu" ist eine Aussage ueber die Anbieterseite - der Titel steht dort in
    // der Neuheiten-Reihe. Ueber den Nutzer sagt das nichts.
    case GRUND.NEUHEIT:
      return ["Neu bei deinem Anbieter", "Frisch im Angebot deines Anbieters"];

    case GRUND.ERKUNDUNG:
      return ["Könnte einen Versuch wert sein", "Mal etwas anderes", "Ein neuer Tipp für dich",
        "Noch nicht von dir entdeckt"];

    // Ab hier: Saetze, die auf externen Daten stehen. Ohne den Bezugstitel
    // gibt es keinen Satz - "eine Fortsetzung" ohne zu sagen, wovon, ist
    // keine Auskunft.
    case GRUND.EXTERN_FORTSETZUNG:
      return titel
        ? [`Fortsetzung von ${titel}`, `Nächster Teil nach ${titel}`, `Weiter nach ${titel}`,
          `Geht weiter nach ${titel}`]
        : [];

    case GRUND.EXTERN_VORGAENGER:
      return titel
        ? [`Die Vorgeschichte zu ${titel}`, `Spielt vor ${titel}`, `Was vor ${titel} geschah`]
        : [];

    // Belegt ist eine gemeinsame Sammlung bzw. eine belegte Reihenbeziehung -
    // also mehr als Aehnlichkeit und weniger als eine Fortsetzung.
    case GRUND.EXTERN_SAMMLUNG:
    case GRUND.EXTERN_REIHE:
      return titel
        ? [`Mehr aus der Welt von ${titel}`, `Aus derselben Reihe wie ${titel}`,
          `Gehört zur Reihe von ${titel}`]
        : [];

    case GRUND.EXTERN_INHALT:
      return titel
        ? [`Weil du ${titel} geschaut hast`, `Ähnlich wie ${titel}`, `Passend zu ${titel}`,
          `Mehr wie ${titel}`]
        : [];

    // Bewusst zurueckhaltend: belegt ist, dass die Datenbank die beiden
    // nebeneinanderstellt.
    case GRUND.EXTERN_EMPFEHLUNG:
      return titel ? [`Ähnlich wie ${titel}`, `Passt zu ${titel}`] : [];

    case GRUND.EXTERN_SCHAUSPIELER:
      return person ? [`Mehr mit ${person}`, `Auch mit ${person}`] : [];

    case GRUND.EXTERN_REGIE:
      if (!person) return [];
      return titel ? [`Vom Regisseur von ${titel}`, `Von ${person}`] : [`Von ${person}`];

    case GRUND.EXTERN_AUTOR:
      if (!person) return [];
      return titel ? [`Von den Machern von ${titel}`, `Von ${person}`] : [`Von ${person}`];

    case GRUND.EXTERN_STUDIO:
      if (!person) return [];
      return titel ? [`Aus demselben Studio wie ${titel}`, `Von ${person}`] : [`Von ${person}`];

    default:
      return [];
  }
}

// Ein Satz je Vorschlag. Leer heisst: zu diesem Eintrag gibt es keinen Grund
// aus der Engine - dann steht auch keiner an der Karte. Das betrifft die
// Reihen, die gar nicht aus dem Empfehlungssystem kommen (etwa "Neu bei
// deinen Anbietern").
function empfehlungsGrundText(item) {
  return textVarianten(item)[0] || "";
}

module.exports = { empfehlungsGrundText, textVarianten, kuerzen, genreName, tagName, GRUND };
