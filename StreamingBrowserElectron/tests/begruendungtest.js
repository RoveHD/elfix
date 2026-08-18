"use strict";
// Die sichtbare Begruendung gegen das, was die Empfehlung wirklich getragen hat.
//
// Geprueft wird nicht, dass ein Satz herauskommt, sondern dass er stimmt:
// steht "Naechster Teil nach ..." nur ueber einer Fortsetzung, wird ein
// konkreter Titel nur dann genannt, wenn er die Empfehlung auch erklaert -
// und bleibt der Satz allgemein, wenn die Daten nicht mehr hergeben?
//
// Der Anlass fuer die Haelfte dieser Pruefungen steht in Abschnitt 1: aus dem
// echten Betrieb kamen Saetze wie "Bibi Blocksberg - Aehnlich wie I Parry
// Everything", weil beide Titel dasselbe breite Genre-Set tragen.

const E = require("../src/empfehlung");
const B = require("../src/begruendung");

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(b); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };

const TAG = 86400000;
const JETZT = Date.parse("2026-08-18T20:00:00Z");
const vorTagen = (n) => new Date(JETZT - n * TAG).toISOString();
const vorStunden = (n) => new Date(JETZT - n * 3600000).toISOString();

const gesehen = (title, genres, extra = {}) => ({
  title, genres, type: "film", providerId: "filmo", providerName: "Filmo",
  completed: true, watched: true, progress: 100, lastWatchedAt: vorTagen(2), ...extra
});
const gemerkt = (title, genres, extra = {}) => ({
  title, genres, type: "film", providerId: "filmo", providerName: "Filmo",
  favorite: true, createdAt: vorTagen(3), ...extra
});
const kandidat = (title, genres, extra = {}) => ({
  title, genres, url: `https://filmo.to/filme/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  type: "film", providerId: "filmo", providerName: "Filmo", via: "genre", ...extra
});

const opt = (extra = {}) => ({ jetzt: JETZT, limit: 20, debug: true, ...extra });
// Der ganze Weg: Profil -> Merkmale -> Punkte -> Vielfalt -> Grund -> Satz.
// Der Satz kommt aus der Engine selbst; die Oberflaeche zeigt genau diesen.
const laufen = (verlauf, kandidaten, extra = {}) => E
  .empfehlen(kandidaten, E.profilBauen(verlauf, JETZT), opt(extra));
const finde = (liste, teil) => liste.find((e) => e.title.includes(teil));

// Welchen Titel behauptet dieser Satz? Leer heisst: er nennt keinen - und darf
// dann auch keinen enthalten.
const MUSTER = [
  /^Nächster Teil nach (.+)$/,
  /^Aus derselben Reihe wie (.+)$/,
  /^Ähnlich wie (.+)$/,
  /^Passend zu (.+) auf deiner Watchlist$/,
  /^Vorgeschlagen bei (.+)$/
];
function genannterTitel(satz) {
  for (const muster of MUSTER) {
    const treffer = String(satz || "").match(muster);
    if (treffer) return treffer[1];
  }
  return "";
}

// Was der Satz nennt, muss im Verlauf stehen. Gekuerzte Titel enden auf "…"
// und muessen dann ein Anfang sein.
function belegt(satz, verlauf) {
  const genannt = genannterTitel(satz);
  if (!genannt) return true;
  const titel = verlauf.map((eintrag) => eintrag.title);
  if (genannt.endsWith("…")) {
    const anfang = genannt.slice(0, -1);
    return titel.some((t) => t.startsWith(anfang));
  }
  return titel.includes(genannt);
}

// Erklaert der genannte Grund die Empfehlung auch rechnerisch? Er muss der
// groesste Beitrag sein oder wenigstens ein Viertel des positiven Scores
// ausmachen - sonst erzaehlt die Karte etwas anderes, als das Ranking tat.
function traegt(eintrag) {
  if (eintrag.grund === E.GRUND.ERKUNDUNG) return true;
  const werte = Object.values(eintrag.beitraege);
  const gesamt = werte.reduce((summe, wert) => summe + Math.max(0, wert), 0);
  const groesster = Math.max(...werte, 0);
  const eigen = eintrag.grundKonfidenz * gesamt;
  return eigen >= gesamt * 0.25 || eigen >= groesster - 0.0001;
}

// --- 1. Der Fall aus dem echten Betrieb --------------------------------------
//
// Ein Verlauf, in dem sich alles im selben Genre-Raum bewegt. Genau dort ist
// frueher ein einzelner Titel als "Aehnlich wie ..." an jeden beliebigen
// Kandidaten geraten.

const ANIME_VERLAUF = [
  gesehen("I Parry Everything", ["abenteuer", "action", "fantasy"], { type: "serie", lastWatchedAt: vorStunden(20) }),
  gesehen("One Piece", ["abenteuer", "action", "fantasy", "komoedie", "drama"], { type: "serie", lastWatchedAt: vorStunden(22) }),
  gesehen("Die Legende von Korra", ["animation"], { type: "serie", lastWatchedAt: vorStunden(24) }),
  gesehen("Game of Thrones", ["fantasy", "abenteuer", "action", "drama"], { type: "serie", lastWatchedAt: vorTagen(2) }),
  gesehen("Loki", ["action", "abenteuer", "drama", "fantasy"], { type: "serie", lastWatchedAt: vorTagen(2) }),
  gesehen("BLACK TORCH", ["action", "abenteuer", "drama", "fantasy", "komoedie"], { type: "serie", lastWatchedAt: vorTagen(3) })
];

{
  const liste = laufen(ANIME_VERLAUF, [
    // Teilt zwei Genres mit "I Parry Everything" - mehr nicht.
    kandidat("Bibi Blocksberg", ["abenteuer", "fantasy", "familie"]),
    // Traegt genau dieselben drei Genres - und damit dieselben wie der halbe
    // Verlauf. Kein einzelner Titel erklaert das.
    kandidat("A Knight of the Seven Kingdoms", ["abenteuer", "action", "fantasy"]),
    kandidat("Wicked: Teil 2", ["fantasy", "familie", "musik"])
  ]);

  pruefe("1. Kein Kandidat behauptet eine Aehnlichkeit zu I Parry Everything",
    liste.every((e) => !/I Parry Everything/.test(e.grundText)),
    liste.map((e) => `${e.title}: ${e.grundText}`).join(" | "));
  pruefe("1b. Ueberhaupt kein konkreter Titel wird genannt",
    liste.every((e) => genannterTitel(e.grundText) === ""),
    liste.map((e) => e.grundText).join(" | "));
  pruefe("1c. Stattdessen steht dort das Profil",
    liste.every((e) => [E.GRUND.GENRE, E.GRUND.VERLAUF].includes(e.grund)),
    liste.map((e) => e.grund).join(" | "));
  pruefe("1d. Und der genannte Grund traegt den Score auch wirklich",
    liste.every(traegt), liste.map((e) => `${e.grund} ${e.grundKonfidenz}`).join(" | "));

  const knight = finde(liste, "Knight");
  pruefe("1e. Der beste Seed ist gemessen, aber zu wenig eigenstaendig",
    knight.belege.verlaufDeckung >= 0.9 && knight.belege.verlaufVorsprung < 1.6 && !knight.belege.verlaufTitel,
    `deckung=${knight.belege.verlaufDeckung.toFixed(2)} vorsprung=${knight.belege.verlaufVorsprung.toFixed(2)}`);
  const bibi = finde(liste, "Bibi");
  pruefe("1f. Zwei zufaellig gemeinsame Genres sind keine Deckung",
    bibi.belege.verlaufDeckung < 0.6 && !bibi.belege.verlaufTitel,
    `deckung=${bibi.belege.verlaufDeckung.toFixed(2)}`);
}

// --- 2. Echte Fortsetzung ------------------------------------------------------

{
  const verlauf = [gesehen("John Wick", ["action"])];
  const liste = laufen(verlauf, [
    kandidat("John Wick: Kapitel 2", ["action"]),
    kandidat("Irgendein Actionfilm", ["action"])
  ]);
  const zwei = finde(liste, "Kapitel 2");
  pruefe("2. Die Fortsetzung wird als Fortsetzung begruendet",
    zwei?.grund === E.GRUND.NAECHSTER_TEIL && zwei?.grundText === "Nächster Teil nach John Wick",
    `${zwei?.grund}: ${zwei?.grundText}`);
  pruefe("2b. Und steht ganz oben", liste[0]?.title === "John Wick: Kapitel 2", liste[0]?.title);
}

{
  const verlauf = [
    gesehen("John Wick", ["action"]),
    gesehen("John Wick: Kapitel 2", ["action"], { lastWatchedAt: vorTagen(1) })
  ];
  const liste = laufen(verlauf, [kandidat("John Wick: Kapitel 3", ["action"])]);
  pruefe("2c. Genannt wird der Teil, bei dem der Nutzer steht",
    liste[0]?.grundText === "Nächster Teil nach John Wick: Kapitel 2", liste[0]?.grundText);
}

{
  const verlauf = [gesehen("Harry Potter und der Stein der Weisen", ["fantasy"])];
  const liste = laufen(verlauf, [kandidat("Harry Potter und die Kammer des Schreckens", ["fantasy"])]);
  pruefe("2d. Reihe ohne Nummern wird als Reihe begruendet",
    liste[0]?.grund === E.GRUND.REIHE
    && liste[0]?.grundText === "Aus derselben Reihe wie Harry Potter und der Stein der Weisen",
    `${liste[0]?.grund}: ${liste[0]?.grundText}`);
}

// --- 3. Echte, starke Aehnlichkeit --------------------------------------------

{
  // Ein Verlaufstitel deckt sich vollstaendig mit dem Kandidaten, der Rest gar
  // nicht. Dann ist der konkrete Bezug die ehrlichste Erklaerung.
  const verlauf = [
    gesehen("Der Pate", ["drama", "krimi", "thriller"], { lastWatchedAt: vorStunden(20) }),
    gesehen("Kindergarten Cop", ["komoedie", "familie"], { lastWatchedAt: vorTagen(4) })
  ];
  const liste = laufen(verlauf, [kandidat("Goodfellas", ["drama", "krimi", "thriller"])]);
  pruefe("3. Ein klar herausragender Seed wird beim Namen genannt",
    liste[0]?.grund === E.GRUND.AEHNLICH_ZULETZT && liste[0]?.grundText === "Weil du Der Pate geschaut hast",
    `${liste[0]?.grund}: ${liste[0]?.grundText}`);
  pruefe("3b. Der Beleg dazu ist gemessen, nicht geraten",
    liste[0]?.belege.verlaufGemeinsam === 3 && liste[0]?.belege.verlaufDeckung === 1
    && liste[0]?.belege.verlaufVorsprung > 1.6,
    `gemeinsam=${liste[0]?.belege.verlaufGemeinsam} deckung=${liste[0]?.belege.verlaufDeckung} vorsprung=${liste[0]?.belege.verlaufVorsprung}`);
  pruefe("3c. Und er traegt den Score", traegt(liste[0]), `Anteil ${liste[0]?.grundKonfidenz}`);
}

{
  // Zwei Seeds, sehr ungleich stark: genannt werden darf nur der starke.
  const verlauf = [
    gesehen("Sieben", ["thriller", "krimi", "drama"], { lastWatchedAt: vorStunden(12) }),
    gesehen("Ein Sommer in Rom", ["thriller", "romanze", "familie", "musik", "sport"], { lastWatchedAt: vorStunden(14) })
  ];
  const liste = laufen(verlauf, [kandidat("Zodiac", ["thriller", "krimi", "drama"])]);
  pruefe("4. Bei mehreren Seeds wird der starke genannt",
    /Sieben/.test(liste[0]?.grundText || ""), liste[0]?.grundText);
  pruefe("4b. Und nicht der schwache",
    !/Sommer in Rom/.test(liste[0]?.grundText || ""), liste[0]?.grundText);
}

{
  // Beide Seeds gleich stark: dann erklaert keiner die Empfehlung allein.
  const verlauf = [
    gesehen("Sieben", ["thriller", "krimi", "drama"], { lastWatchedAt: vorStunden(12) }),
    gesehen("Das Schweigen der Laemmer", ["thriller", "krimi", "drama"], { lastWatchedAt: vorStunden(13) })
  ];
  const liste = laufen(verlauf, [kandidat("Zodiac", ["thriller", "krimi", "drama"])]);
  pruefe("4c. Zwei gleich starke Seeds ergeben keinen konkreten Bezug",
    genannterTitel(liste[0]?.grundText) === "", liste[0]?.grundText);
  // Statt eines willkuerlichen Titels steht dort das, was beide gemeinsam
  // haben - das ist genauer als eine Leerformel und genauso wahr.
  pruefe("4d. Stattdessen steht dort das gemeinsame Merkmal",
    /Thriller|Krimi|Drama|Geschmack/.test(liste[0]?.grundText || ""), liste[0]?.grundText);
}

// --- 5. Watchlist -------------------------------------------------------------

{
  const verlauf = [gemerkt("Der Exorzist", ["horror"])];
  const liste = laufen(verlauf, [kandidat("Hereditary", ["horror"])]);
  pruefe("5. Ein einzelner vorgemerkter Titel wird genannt",
    liste[0]?.grund === E.GRUND.WATCHLIST
    && liste[0]?.grundText === "Passend zu Der Exorzist auf deiner Watchlist", liste[0]?.grundText);
  pruefe("5b. Ohne zu behaupten, er sei geschaut worden",
    !/geschaut|gesehen/.test(liste[0]?.grundText || ""), liste[0]?.grundText);
}

{
  // Mehrere vorgemerkte Titel tragen gemeinsam - dann keiner beim Namen.
  const verlauf = [
    gemerkt("Der Exorzist", ["horror", "mystery"]),
    gemerkt("Hereditary", ["horror", "mystery"]),
    gemerkt("The Ring", ["horror", "mystery"])
  ];
  const liste = laufen(verlauf, [kandidat("Sinister", ["horror", "mystery"])]);
  pruefe("5c. Mehrere schwache Watchlist-Signale bleiben allgemein",
    liste[0]?.grund === E.GRUND.WATCHLIST && liste[0]?.grundText === "Passend zu deiner Watchlist",
    `${liste[0]?.grund}: ${liste[0]?.grundText}`);
}

// --- 6. Anbieter-Verknuepfung -------------------------------------------------

{
  // "Das schauen andere" ist eine Verknuepfung, keine Aehnlichkeit.
  const verlauf = [gesehen("Swapped", ["abenteuer", "familie"], { lastWatchedAt: vorStunden(6) })];
  const liste = laufen(verlauf, [
    { ...kandidat("Supergirl", ["superhelden"]), via: "related", seedTitle: "Swapped", seedWeight: 1 }
  ]);
  pruefe("6. Der Anbieterhinweis wird nicht als Aehnlichkeit ausgegeben",
    !/Ähnlich/.test(liste[0]?.grundText || ""), liste[0]?.grundText);
  pruefe("6b. Sie taucht ueberhaupt nicht mehr als Grund auf",
    liste[0]?.grund !== "RELATED_BY_PROVIDER" && !/Vorgeschlagen|Vorschlägen/.test(liste[0]?.grundText || ""),
    `${liste[0]?.grund}: ${liste[0]?.grundText}`);
  pruefe("6c. Sie hebt den Rang aber weiterhin",
    liste[0]?.teilwerte?.aehnlichLautAnbieter > 0, String(liste[0]?.teilwerte?.aehnlichLautAnbieter));
}

{
  // Ohne Bezugstitel bleibt nur ein zurueckhaltender Satz.
  const verlauf = [gesehen("Basis", ["drama"], { lastWatchedAt: vorTagen(200) })];
  const liste = laufen(verlauf, [
    { ...kandidat("Ohne Bezug", ["western"]), via: "related", seedTitle: "", seedWeight: 1 }
  ]);
  pruefe("6d. Ohne jedes eigene Signal wird nichts behauptet",
    genannterTitel(liste[0]?.grundText) === "", liste[0]?.grundText);
}

// --- 7. Genre -----------------------------------------------------------------

{
  // Mehrere abgeschlossene Action-Titel: das Profil traegt den Namen.
  const verlauf = [
    gesehen("Action A", ["action", "thriller"], { lastWatchedAt: vorTagen(40) }),
    gesehen("Action B", ["action", "krimi"], { lastWatchedAt: vorTagen(50) }),
    gesehen("Action C", ["action", "abenteuer"], { lastWatchedAt: vorTagen(60) })
  ];
  const liste = laufen(verlauf, [kandidat("Bunter Mix", ["action", "sport", "familie", "drama"])]);
  pruefe("7. Ein von mehreren Werken getragenes Genre wird genannt",
    liste[0]?.grund === E.GRUND.GENRE && liste[0]?.grundText === "Weil du oft Action schaust",
    `${liste[0]?.grund}: ${liste[0]?.grundText}`);
  pruefe("7b. Der Beleg zaehlt die Werke mit",
    liste[0]?.belege.genreWerke >= 3, `${liste[0]?.belege.genreWerke} Werke`);
}

{
  // Genau ein Action-Titel im Verlauf - daraus folgt kein Geschmack.
  const verlauf = [gesehen("Action A", ["action", "thriller"], { lastWatchedAt: vorTagen(40) })];
  const liste = laufen(verlauf, [kandidat("Bunter Mix", ["action", "sport", "familie", "drama", "horror"])]);
  pruefe("7c. Aus einem einzigen Titel wird kein Genre-Geschmack",
    !/Action/.test(liste[0]?.grundText || ""), liste[0]?.grundText);
  pruefe("7d. Der Satz bleibt allgemein und wahr",
    ["Passt zu deinem Geschmack", "Ein Tipp für dich", "Könnte dir gefallen"].includes(liste[0]?.grundText),
    liste[0]?.grundText);
}

{
  // Was gerade laeuft, wird auch so benannt.
  const verlauf = [
    gesehen("Action A", ["action", "thriller"], { lastWatchedAt: vorStunden(2) }),
    gesehen("Action B", ["action", "krimi"], { lastWatchedAt: vorStunden(4) })
  ];
  const liste = laufen(verlauf, [kandidat("Bunter Mix", ["action", "sport", "familie", "drama"])]);
  pruefe("7e. Die laufende Sitzung wird als solche benannt",
    liste[0]?.grundText === "Weil du zuletzt viel Action geschaut hast", liste[0]?.grundText);
}

{
  // Ein Schluessel ohne hinterlegten Namen wird nicht vorgelesen - auch nicht
  // notduerftig aus dem Schluessel gebaut.
  const verlauf = [
    gesehen("Irgendwas A", ["uebermaessige-gewaltdarstellung", "action"], { lastWatchedAt: vorTagen(40) }),
    gesehen("Irgendwas B", ["uebermaessige-gewaltdarstellung", "krimi"], { lastWatchedAt: vorTagen(50) })
  ];
  const liste = laufen(verlauf, [kandidat("Bunter Mix", ["uebermaessige-gewaltdarstellung", "sport", "familie"])]);
  pruefe("7f. Ein Schluessel ohne Namen wird nicht vorgelesen",
    !/gewalt/i.test(liste[0]?.grundText || ""), liste[0]?.grundText);
}

// --- 7b. Spezifische Tags schlagen breite Genres -------------------------------

{
  // Zwei Werke tragen denselben feinen Tag - dann darf er beim Namen genannt
  // werden, und er ist aussagekraeftiger als "Action".
  const verlauf = [
    gesehen("Shounen A", ["fighting-shounen", "action", "abenteuer"], { type: "serie", lastWatchedAt: vorTagen(3) }),
    gesehen("Shounen B", ["fighting-shounen", "action", "drama"], { type: "serie", lastWatchedAt: vorTagen(5) }),
    gesehen("Shounen C", ["fighting-shounen", "action", "fantasy"], { type: "serie", lastWatchedAt: vorTagen(7) })
  ];
  const liste = laufen(verlauf, [kandidat("Neuer Shounen", ["fighting-shounen", "action", "sport", "familie"], { type: "serie" })]);
  pruefe("7g. Ein spezifischer Tag wird dem breiten Genre vorgezogen",
    liste[0]?.grund === E.GRUND.TAG && /Fighting-Shounen/.test(liste[0]?.grundText || ""),
    `${liste[0]?.grund}: ${liste[0]?.grundText}`);
  pruefe("7h. Und stuetzt sich auf mehrere Werke",
    liste[0]?.belege.tagWerke >= 2, `${liste[0]?.belege.tagWerke} Werke`);

  // Nur ein einziges Werk mit dem Tag: dann nicht.
  const einzeln = laufen([
    gesehen("Ein Kampfanime", ["fighting-shounen", "action"], { type: "serie", lastWatchedAt: vorTagen(3) }),
    gesehen("Actionfilm", ["action", "krimi"], { lastWatchedAt: vorTagen(5) }),
    gesehen("Noch Action", ["action", "thriller"], { lastWatchedAt: vorTagen(9) })
  ], [kandidat("Neuer Kampfanime", ["fighting-shounen", "action", "sport", "familie", "musik"], { type: "serie" })]);
  pruefe("7i. Ein Tag aus einem einzigen Werk wird nicht genannt",
    einzeln[0]?.grund !== E.GRUND.TAG && !/Fighting-Shounen/.test(einzeln[0]?.grundText || ""),
    `${einzeln[0]?.grund}: ${einzeln[0]?.grundText}`);
}

// --- 8. Erkundung -------------------------------------------------------------

{
  const liste = laufen([], [
    kandidat("Irgendein Film", ["action"]),
    { ...kandidat("Ganz neu", ["drama"]), via: "new" }
  ]);
  pruefe("8. Ohne Verlauf wird kein Verlauf erfunden",
    liste.every((e) => !/geschaut|gesehen|zuletzt|Watchlist|Reihe/.test(e.grundText)),
    liste.map((e) => e.grundText).join(" | "));
  pruefe("8b. Ein Titel aus der Neuheiten-Reihe wird so benannt",
    finde(liste, "Ganz neu")?.grund === E.GRUND.NEUHEIT
    && /Anbieter/.test(finde(liste, "Ganz neu")?.grundText || ""), finde(liste, "Ganz neu")?.grundText);
  pruefe("8c. Kein Satz nennt einen Titel",
    liste.every((e) => genannterTitel(e.grundText) === ""), liste.map((e) => e.grundText).join(" | "));
  pruefe("8d. Und keiner behauptet Beliebtheit, Bewertung oder Trend",
    liste.every((e) => !/beliebt|bewertet|trend|angesagt|Klassiker|gefragt/i.test(e.grundText)),
    liste.map((e) => e.grundText).join(" | "));
}

// --- 8b. Anime-, Serien-, Filmvorliebe und aktueller Geschmack ----------------

{
  // Ueberwiegend Anime im Verlauf - dann ist "Mehr Anime fuer dich" belegt.
  const verlauf = [
    gesehen("Anime A", ["abenteuer", "action"], { type: "serie", art: "anime", lastWatchedAt: vorTagen(3) }),
    gesehen("Anime B", ["abenteuer", "drama"], { type: "serie", art: "anime", lastWatchedAt: vorTagen(5) }),
    gesehen("Anime C", ["abenteuer", "fantasy"], { type: "serie", art: "anime", lastWatchedAt: vorTagen(7) }),
    gesehen("Anime D", ["abenteuer", "komoedie"], { type: "serie", art: "anime", lastWatchedAt: vorTagen(9) }),
    gesehen("Ein Film", ["western"], { art: "film", lastWatchedAt: vorTagen(40) })
  ];
  const liste = laufen(verlauf, [
    kandidat("Neuer Anime", ["abenteuer", "sport", "familie", "musik"], { type: "serie", art: "anime" })
  ]);
  const anime = liste[0];
  pruefe("8e. Eine belegte Anime-Vorliebe darf genannt werden",
    [E.GRUND.ART, E.GRUND.TAG_PAAR].includes(anime?.grund) && /Anime/.test(anime?.grundText || ""),
    `${anime?.grund}: ${anime?.grundText}`);
  pruefe("8f. Der Beleg dazu ist der Verlauf, nicht der Kandidat",
    anime?.belege.artAnteil >= 0.5, `Anteil ${anime?.belege.artAnteil.toFixed(2)}`);

  // Umgekehrt: ein einzelner Film im Verlauf macht keine Filmvorliebe.
  const film = laufen(verlauf, [kandidat("Neuer Film", ["western", "sport"], { art: "film" })]);
  pruefe("8g. Aus einem einzelnen Film folgt keine Filmvorliebe",
    !/Filme/.test(film[0]?.grundText || ""), film[0]?.grundText);
}

{
  // Was gerade laeuft, wird als aktueller Geschmack benannt - und nicht als
  // langfristiger.
  const verlauf = [
    gesehen("Gerade A", ["horror", "mystery"], { lastWatchedAt: vorStunden(1) }),
    gesehen("Gerade B", ["horror", "thriller"], { lastWatchedAt: vorStunden(3) }),
    gesehen("Frueher", ["komoedie"], { lastWatchedAt: vorTagen(90) })
  ];
  const liste = laufen(verlauf, [kandidat("Neuer Horror", ["horror", "sport", "familie", "musik", "western"])]);
  pruefe("8h. Der aktuelle Geschmack wird als aktuell benannt",
    [E.GRUND.SITZUNG, E.GRUND.GENRE].includes(liste[0]?.grund)
    && /gerade|zuletzt|aktuell/i.test(liste[0]?.grundText || ""),
    `${liste[0]?.grund}: ${liste[0]?.grundText}`);

  const alt = laufen([
    gesehen("Alt A", ["horror", "mystery"], { lastWatchedAt: vorTagen(60) }),
    gesehen("Alt B", ["horror", "thriller"], { lastWatchedAt: vorTagen(80) })
  ], [kandidat("Neuer Horror", ["horror", "sport", "familie", "musik", "western"])]);
  pruefe("8i. Ein alter Geschmack wird nicht als aktuell ausgegeben",
    !/gerade|zuletzt|aktuell/i.test(alt[0]?.grundText || ""), alt[0]?.grundText);
}

// --- 8c. Wiederentdeckung ------------------------------------------------------

{
  // Dieselbe Reihe, aber lange her.
  const verlauf = [gesehen("Harry Potter und der Stein der Weisen", ["fantasy"], { lastWatchedAt: vorTagen(120) })];
  const liste = laufen(verlauf, [kandidat("Harry Potter und die Kammer des Schreckens", ["fantasy"])]);
  pruefe("8j. Eine lange zurueckliegende Reihe wird zur Wiederentdeckung",
    liste[0]?.grund === E.GRUND.WIEDERENTDECKUNG, `${liste[0]?.grund}: ${liste[0]?.grundText}`);
  pruefe("8k. Und der Satz nennt die Reihe",
    /Harry Potter/.test(liste[0]?.grundText || ""), liste[0]?.grundText);
  pruefe("8l. Eine frische Reihe bleibt eine laufende Reihe",
    laufen([gesehen("Harry Potter und der Stein der Weisen", ["fantasy"], { lastWatchedAt: vorTagen(2) })],
      [kandidat("Harry Potter und die Kammer des Schreckens", ["fantasy"])])[0]?.grund === E.GRUND.REIHE,
    "frisch");
}

// --- 9. Form ------------------------------------------------------------------

{
  const langer = "Der Herr der Ringe: Die Gefaehrten des Rings aus dem Auenland";
  const verlauf = [gesehen(langer, ["fantasy"])];
  const liste = laufen(verlauf, [kandidat("Der Herr der Ringe: Die zwei Tuerme", ["fantasy"])]);
  // Die Karte hat zwei Zeilen - der Satz darf sie fuellen, aber nicht sprengen.
  pruefe("9. Ein langer Titel wird gekuerzt",
    liste[0]?.grundText.length < 70 && liste[0]?.grundText.endsWith("…"),
    `${liste[0]?.grundText.length} Zeichen: ${liste[0]?.grundText}`);
  pruefe("9b. Und bleibt der Anfang des echten Titels",
    belegt(liste[0]?.grundText, verlauf), liste[0]?.grundText);
  pruefe("9c. Kurze Titel werden nicht angefasst",
    B.kuerzen("John Wick") === "John Wick", B.kuerzen("John Wick"));
}

{
  const verlauf = [...ANIME_VERLAUF, gemerkt("Der Exorzist", ["horror"])];
  const liste = laufen(verlauf, [
    kandidat("Bibi Blocksberg", ["abenteuer", "fantasy", "familie"]),
    kandidat("Hereditary", ["horror"]),
    { ...kandidat("Vorschlag vom Anbieter", ["action"]), via: "related", seedTitle: "Loki", seedWeight: 0.9 },
    { ...kandidat("Ganz neu", ["drama"]), via: "new" },
    kandidat("A Knight of the Seven Kingdoms", ["abenteuer", "action", "fantasy"])
  ]);
  pruefe("10. Jeder Vorschlag bekommt eine Begruendung",
    liste.length > 0 && liste.every((e) => e.grundText.length > 0),
    liste.map((e) => `${e.title}: ${e.grundText}`).join(" | "));
  pruefe("10b. Keine Begruendung erfindet einen Titel",
    liste.every((e) => belegt(e.grundText, verlauf)), liste.map((e) => e.grundText).join(" | "));
  pruefe("10c. Jeder Grund traegt den Score, den er erklaert",
    liste.every(traegt), liste.map((e) => `${e.grund} ${e.grundKonfidenz}`).join(" | "));
  pruefe("10d. Kein Satz wird laenger als die Karte vertraegt",
    liste.every((e) => e.grundText.length <= 70), liste.map((e) => e.grundText.length).join(","));
  pruefe("10e. Ohne Grund gibt es keinen Satz",
    B.empfehlungsGrundText({ title: "Neu beim Anbieter" }) === ""
    && B.empfehlungsGrundText(null) === "", "leer");
}

// --- 11. Abwechslung, ohne zu luegen -------------------------------------------

{
  // Zehn Kandidaten, die alle aus demselben Grund oben stehen. Zehnmal
  // derselbe Satz liest sich wie ein Fehler - also andere Formulierungen und
  // Nebengruende, aber nur wahre.
  const verlauf = [
    gesehen("Action A", ["action", "thriller"], { lastWatchedAt: vorTagen(3) }),
    gesehen("Action B", ["action", "krimi"], { lastWatchedAt: vorTagen(6) }),
    gesehen("Action C", ["action", "abenteuer"], { lastWatchedAt: vorTagen(9) })
  ];
  const kandidaten = [];
  for (let index = 0; index < 10; index += 1) {
    kandidaten.push(kandidat(`Actionfilm Nummer ${index}`, ["action", "sport", "familie", "drama"]));
  }
  const liste = laufen(verlauf, kandidaten);
  const texte = liste.map((e) => e.grundText);
  const verschieden = new Set(texte).size;

  pruefe("11. Zehn gleich begruendete Titel bekommen nicht zehnmal denselben Satz",
    verschieden >= 3, `${verschieden} verschiedene: ${[...new Set(texte)].join(" | ")}`);
  pruefe("11b. Kein Satz steht oefter als dreimal",
    texte.every((text) => texte.filter((t) => t === text).length <= 3),
    texte.map((t) => `${t} (${texte.filter((x) => x === t).length})`).slice(0, 3).join(" | "));
  pruefe("11c. Alle Saetze bleiben wahr - kein Titel, kein erfundenes Signal",
    liste.every((e) => belegt(e.grundText, verlauf))
    && !texte.some((t) => /beliebt|bewertet|trend|Klassiker/i.test(t)),
    [...new Set(texte)].join(" | "));
  pruefe("11d. Und jeder gemeldete Grund traegt den Score weiterhin",
    liste.every(traegt), liste.map((e) => `${e.grund} ${e.grundKonfidenz}`).slice(0, 4).join(" | "));
  pruefe("11e. Die Nebengruende werden mitgeliefert",
    liste.every((e) => Array.isArray(e.nebengruende)),
    `${liste[0]?.nebengruende?.length || 0} Nebengruende beim ersten`);
}

{
  // Eine Fortsetzung darf nicht der Abwechslung geopfert werden.
  const verlauf = [
    gesehen("John Wick", ["action"]),
    gesehen("Action B", ["action", "krimi"], { lastWatchedAt: vorTagen(6) }),
    gesehen("Action C", ["action", "abenteuer"], { lastWatchedAt: vorTagen(9) })
  ];
  const liste = laufen(verlauf, [
    kandidat("John Wick: Kapitel 2", ["action"]),
    ...Array.from({ length: 6 }, (unused, index) => kandidat(`Actionfilm ${index}`, ["action", "drama"]))
  ]);
  const wick = finde(liste, "Kapitel 2");
  pruefe("11f. Der staerkste Grund bleibt auch bei viel Wiederholung stehen",
    wick?.grund === E.GRUND.NAECHSTER_TEIL && /John Wick/.test(wick?.grundText || ""),
    `${wick?.grund}: ${wick?.grundText}`);
}

// --- 12. Beziehungsketten -------------------------------------------------------
//
// Der Kern: erkennt ELFIX, was zusammengehoert - und unterscheidet es von dem,
// was nur zufaellig dasselbe Genre traegt?

const serie = (title, genres, extra = {}) => gesehen(title, genres, { type: "serie", art: "anime", ...extra });
const serienKandidat = (title, genres, extra = {}) => kandidat(title, genres, { type: "serie", art: "anime", ...extra });

{
  const verlauf = [gesehen("Spider-Man", ["action", "abenteuer"])];
  const liste = laufen(verlauf, [
    kandidat("Spider-Man 2", ["action", "abenteuer"]),
    kandidat("Spider-Man 3", ["action", "abenteuer"]),
    kandidat("Irgendein Actionfilm", ["action"])
  ]);
  const rang = (teil) => liste.findIndex((e) => e.title.includes(teil));
  pruefe("12. Spider-Man 1 gesehen: Teil 2 vor Teil 3",
    rang("Spider-Man 2") === 0 && rang("Spider-Man 2") < rang("Spider-Man 3"),
    liste.map((e) => e.title).join(" | "));
  pruefe("12b. Und beide vor dem beliebigen Actionfilm",
    rang("Spider-Man 3") < rang("Irgendein"), liste.map((e) => `${e.title} ${e.score}`).join(" | "));
  pruefe("12c. Mit der Fortsetzung als Grund",
    liste[0]?.grund === E.GRUND.NAECHSTER_TEIL && liste[0]?.grundText === "Nächster Teil nach Spider-Man",
    liste[0]?.grundText);
}

{
  const verlauf = [
    gesehen("Spider-Man", ["action", "abenteuer"]),
    gesehen("Spider-Man 2", ["action", "abenteuer"], { lastWatchedAt: vorTagen(1) })
  ];
  const liste = laufen(verlauf, [kandidat("Spider-Man 2", ["action"]), kandidat("Spider-Man 3", ["action", "abenteuer"])]);
  pruefe("12d. Spider-Man 1+2 gesehen: Teil 3 ist dran",
    liste[0]?.title === "Spider-Man 3", liste.map((e) => e.title).join(" | "));
  pruefe("12e. Und Teil 2 kommt nicht erneut",
    !liste.some((e) => e.title === "Spider-Man 2"), liste.map((e) => e.title).join(" | "));
}

{
  // Naruto -> Naruto Shippuden. Der Titel allein gibt das nicht her (ein
  // einziges gemeinsames Wort); erst die uebereinstimmenden Inhalte machen
  // daraus eine Reihe.
  const verlauf = [serie("Naruto", ["fighting-shounen", "action", "abenteuer", "fantasy"])];
  const liste = laufen(verlauf, [
    serienKandidat("Naruto Shippuden", ["fighting-shounen", "action", "abenteuer", "fantasy"]),
    serienKandidat("One Piece", ["fighting-shounen", "action", "abenteuer", "fantasy"]),
    serienKandidat("Hunter x Hunter", ["fighting-shounen", "action", "abenteuer"]),
    kandidat("Irgendein Actionfilm", ["action"]),
    kandidat("Noch ein Actionfilm", ["action", "drama"])
  ]);
  const rang = (teil) => liste.findIndex((e) => e.title.includes(teil));
  const shippuden = finde(liste, "Shippuden");

  pruefe("13. Naruto gesehen: Naruto Shippuden steht ganz oben",
    rang("Shippuden") === 0, liste.map((e) => `${e.title} ${e.score}`).join(" | "));
  pruefe("13b. Und wird als Reihe erklaert, nicht als Aehnlichkeit",
    shippuden?.grund === E.GRUND.REIHE && /Naruto/.test(shippuden?.grundText || ""),
    `${shippuden?.grund}: ${shippuden?.grundText}`);
  pruefe("13c. One Piece kommt stark, aber nicht als Reihe",
    rang("One Piece") > 0 && rang("One Piece") < rang("Irgendein")
    && finde(liste, "One Piece")?.grund !== E.GRUND.REIHE,
    `One Piece auf ${rang("One Piece")} als ${finde(liste, "One Piece")?.grund}`);
  pruefe("13d. Und deutlich vor einem Titel, der nur Action teilt",
    finde(liste, "One Piece").score > finde(liste, "Irgendein").score * 1.8,
    `${finde(liste, "One Piece").score} gegen ${finde(liste, "Irgendein").score}`);
  pruefe("13e. Hunter x Hunter ebenfalls vor dem Actionfilm",
    rang("Hunter") < rang("Irgendein"), liste.map((e) => e.title).join(" | "));
}

{
  // Die Gegenprobe: gleicher Wortanfang, voellig anderer Inhalt. Daraus darf
  // niemals eine Reihe werden.
  const verlauf = [gesehen("Avatar - Aufbruch nach Pandora", ["scifi", "action"])];
  const liste = laufen(verlauf, [
    kandidat("Avatar Aang: Der Herr der Elemente", ["animation", "familie"]),
    kandidat("Avatar: The Way of Water", ["scifi", "action"])
  ]);
  const aang = finde(liste, "Aang");
  const wasser = finde(liste, "Way of Water");
  pruefe("13f. Gleicher Name, anderer Inhalt: keine Reihe",
    !aang || aang.teilwerte.reihe === 0, aang ? `reihe=${aang.teilwerte.reihe}` : "nicht empfohlen");
  pruefe("13g. Die echte Fortsetzung dagegen schon",
    wasser?.teilwerte.reihe > 0.6, `reihe=${wasser?.teilwerte.reihe.toFixed(2)}`);
}

{
  // Ein spezifischer Tag wiegt schwerer als ein Sammelgenre.
  const verlauf = [
    serie("One Piece", ["fighting-shounen", "action", "abenteuer", "fantasy"]),
    serie("Bleach", ["fighting-shounen", "action", "abenteuer"], { lastWatchedAt: vorTagen(4) })
  ];
  const liste = laufen(verlauf, [
    serienKandidat("Demon Slayer", ["fighting-shounen", "action", "abenteuer"]),
    kandidat("Ein Actionfilm", ["action", "abenteuer"]),
    kandidat("Noch ein Actionfilm", ["action", "abenteuer", "krimi"])
  ]);
  pruefe("14. Der Fighting-Shounen-Treffer schlaegt den blossen Action-Treffer",
    liste[0]?.title === "Demon Slayer"
    && liste[0].score > finde(liste, "Ein Actionfilm").score * 1.5,
    liste.map((e) => `${e.title} ${e.score}`).join(" | "));
  pruefe("14b. Und wird auch so begruendet",
    [E.GRUND.TAG, E.GRUND.AEHNLICH_ZULETZT].includes(liste[0]?.grund),
    `${liste[0]?.grund}: ${liste[0]?.grundText}`);
}

{
  // Ein Titel, der ueberall verlinkt ist, ist Werbung und kein Zusammenhang.
  const verlauf = [
    gesehen("Seed A", ["drama"], { lastWatchedAt: vorTagen(2) }),
    gesehen("Seed B", ["komoedie"], { lastWatchedAt: vorTagen(3) }),
    gesehen("Seed C", ["horror"], { lastWatchedAt: vorTagen(4) })
  ];
  const ueberall = ["Seed A", "Seed B", "Seed C"].map((seed) => ({
    ...kandidat("Ueberall verlinkt", ["western"]), via: "related", seedTitle: seed, seedWeight: 1
  }));
  const einmal = { ...kandidat("Nur einmal verlinkt", ["western"]), via: "related", seedTitle: "Seed A", seedWeight: 1 };
  const liste = laufen(verlauf, [...ueberall, einmal]);
  const promo = finde(liste, "Ueberall");
  const echt = finde(liste, "Nur einmal");
  pruefe("15. Ein ueberall verlinkter Titel verliert sein Anbietersignal",
    promo.teilwerte.aehnlichLautAnbieter < echt.teilwerte.aehnlichLautAnbieter,
    `ueberall=${promo.teilwerte.aehnlichLautAnbieter.toFixed(2)} einmal=${echt.teilwerte.aehnlichLautAnbieter.toFixed(2)}`);
  pruefe("15b. Und steht deshalb hinter dem einzeln verlinkten",
    echt.score > promo.score, `${echt.score} gegen ${promo.score}`);
  pruefe("15c. Keiner von beiden nennt den Anbieter als Grund",
    ![promo.grundText, echt.grundText].some((t) => /Vorgeschlagen|Vorschlägen/.test(t)),
    `${promo.grundText} | ${echt.grundText}`);
}

{
  // Mehrere sich bestaetigende Signale schlagen ein einzelnes starkes.
  const verlauf = [
    serie("One Piece", ["fighting-shounen", "action", "abenteuer"], { lastWatchedAt: vorStunden(3) }),
    serie("Bleach", ["fighting-shounen", "action", "drama"], { lastWatchedAt: vorStunden(6) })
  ];
  const liste = laufen(verlauf, [
    serienKandidat("Viele Signale", ["fighting-shounen", "action", "abenteuer"]),
    kandidat("Nur ein Signal", ["action"])
  ]);
  pruefe("16. Mehrere bestaetigende Signale schlagen ein einzelnes",
    liste[0]?.title === "Viele Signale" && liste[0].score > finde(liste, "Nur ein").score * 2,
    liste.map((e) => `${e.title} ${e.score}`).join(" | "));
}

// --- 17. Konkreter Seed gegen aggregiertes Profil --------------------------------
//
// Beides ist richtig - es kommt darauf an, ob ein einzelner Titel die
// Empfehlung wirklich traegt oder ob sie sich auf viele verteilt.

{
  // Ein Seed traegt fast alles: dann wird er genannt.
  const verlauf = [
    serie("Naruto", ["fighting-shounen", "action", "abenteuer", "fantasy"], { lastWatchedAt: vorStunden(6) }),
    gesehen("Ein Liebesfilm", ["romanze", "drama"], { lastWatchedAt: vorTagen(20) })
  ];
  const liste = laufen(verlauf, [serienKandidat("One Piece", ["fighting-shounen", "action", "abenteuer", "fantasy"])]);
  pruefe("17. Ein dominanter Seed wird konkret genannt",
    liste[0]?.grund === E.GRUND.AEHNLICH_ZULETZT && /Naruto/.test(liste[0]?.grundText || ""),
    `${liste[0]?.grund}: ${liste[0]?.grundText}`);
  pruefe("17b. Der Anteil ist gemessen, nicht geraten",
    liste[0]?.belege.verlaufAnteil >= 0.55, `Anteil ${liste[0]?.belege.verlaufAnteil.toFixed(2)}`);
}

{
  // Vier Seeds tragen aehnlich viel: dann waere jede Wahl willkuerlich.
  const verlauf = [
    serie("Naruto", ["fighting-shounen", "action", "abenteuer"], { lastWatchedAt: vorTagen(2) }),
    serie("Dragon Ball", ["fighting-shounen", "action", "abenteuer"], { lastWatchedAt: vorTagen(3) }),
    serie("Demon Slayer", ["fighting-shounen", "action", "abenteuer"], { lastWatchedAt: vorTagen(4) }),
    serie("Hunter x Hunter", ["fighting-shounen", "action", "abenteuer"], { lastWatchedAt: vorTagen(5) })
  ];
  const liste = laufen(verlauf, [serienKandidat("One Piece", ["fighting-shounen", "action", "abenteuer"])]);
  pruefe("17c. Bei verteilten Seeds wird kein Titel genannt",
    genannterTitel(liste[0]?.grundText) === "", liste[0]?.grundText);
  pruefe("17d. Stattdessen steht dort das gemeinsame Merkmal",
    liste[0]?.grund === E.GRUND.TAG && /Fighting-Shounen/.test(liste[0]?.grundText || ""),
    `${liste[0]?.grund}: ${liste[0]?.grundText}`);
}

// --- 18. Content-Type ist kein Grund ---------------------------------------------

{
  // Ein Anime ohne jedes spezifische Signal darf nicht mit "mehr Anime"
  // begruendet werden - das sagt nichts darueber, warum gerade dieser Titel.
  const verlauf = [
    serie("Anime A", ["abenteuer"], { lastWatchedAt: vorTagen(3) }),
    serie("Anime B", ["abenteuer"], { lastWatchedAt: vorTagen(5) }),
    serie("Anime C", ["abenteuer"], { lastWatchedAt: vorTagen(7) }),
    serie("Anime D", ["abenteuer"], { lastWatchedAt: vorTagen(9) })
  ];
  const liste = laufen(verlauf, [
    serienKandidat("Neuer Anime", ["sport", "musik", "reality"]),
    serienKandidat("Passender Anime", ["abenteuer", "sport"])
  ]);
  pruefe("18. Kein Satz macht aus der Art einen Grund",
    liste.every((e) => !/Mehr Anime|deinen Anime|Anime-Geschmack|Mehr Serien|Mehr Filme/.test(e.grundText)),
    liste.map((e) => `${e.title}: ${e.grundText}`).join(" | "));
  pruefe("18b. Und CONTENT_TYPE_PREFERENCE gibt es nicht mehr",
    liste.every((e) => e.grund !== "CONTENT_TYPE_PREFERENCE"), liste.map((e) => e.grund).join(" | "));
}

// --- 19. Sprachmarken sind kein Geschmack ----------------------------------------

{
  const verlauf = [
    serie("Anime A", ["gersub", "dub", "action", "abenteuer"], { lastWatchedAt: vorTagen(3) }),
    serie("Anime B", ["gersub", "dub", "action", "abenteuer"], { lastWatchedAt: vorTagen(5) })
  ];
  const liste = laufen(verlauf, [
    serienKandidat("Nur Sprachmarken", ["gersub", "dub", "omu"]),
    serienKandidat("Wirklich passend", ["action", "abenteuer"])
  ]);
  const marken = finde(liste, "Nur Sprachmarken");
  const passend = finde(liste, "Wirklich passend");
  pruefe("19. Gemeinsame Sprachmarken erzeugen keine Aehnlichkeit",
    !marken || marken.teilwerte.verlauf === 0, marken ? `verlauf=${marken.teilwerte.verlauf}` : "gar nicht empfohlen");
  pruefe("19b. Der inhaltliche Treffer steht deutlich davor",
    passend.score > (marken?.score || 0), `${passend.score} gegen ${marken?.score ?? "-"}`);
  pruefe("19c. Und keine Sprachmarke taucht im Text auf",
    liste.every((e) => !/GerSub|Dub|OmU/i.test(e.grundText)), liste.map((e) => e.grundText).join(" | "));
}

// --- 20. Universum: was die Daten nicht hergeben, wird nicht behauptet -----------

{
  // Iron Man -> Iron Man 2 ist eine Reihe. Iron Man -> Avengers ist ein
  // Universum, und dafuer gibt es in den Anbieterdaten keinen Beleg: kein
  // gemeinsames Titelwort, keine Collection-Kennung. Avengers darf deshalb
  // ueber die Inhalte kommen, aber nie als Reihe oder Universum ausgegeben
  // werden.
  const verlauf = [gesehen("Iron Man", ["action", "scifi", "superhelden"], { lastWatchedAt: vorTagen(2) })];
  const liste = laufen(verlauf, [
    kandidat("Iron Man 2", ["action", "scifi", "superhelden"]),
    kandidat("The Avengers", ["action", "scifi", "superhelden"]),
    kandidat("Hulk", ["action", "scifi", "superhelden"]),
    kandidat("Irgendein Actionfilm", ["action"])
  ]);
  const rang = (teil) => liste.findIndex((e) => e.title.includes(teil));
  pruefe("20. Iron Man 2 steht als Fortsetzung ganz oben",
    rang("Iron Man 2") === 0 && liste[0]?.grund === E.GRUND.NAECHSTER_TEIL,
    `${liste[0]?.title}: ${liste[0]?.grund}`);
  pruefe("20b. Die Universumstitel kommen vor dem beliebigen Actionfilm",
    rang("Avengers") < rang("Irgendein") && rang("Hulk") < rang("Irgendein"),
    liste.map((e) => e.title).join(" | "));
  pruefe("20c. Aber ohne behauptete Reihen- oder Universumsbeziehung",
    [E.GRUND.NAECHSTER_TEIL, E.GRUND.REIHE, E.GRUND.WIEDERENTDECKUNG]
      .includes(finde(liste, "Avengers")?.grund) === false,
    `${finde(liste, "Avengers")?.grund}: ${finde(liste, "Avengers")?.grundText}`);
  pruefe("20d. Und ohne einen Titel zu nennen, der das nicht hergibt",
    !/Iron Man/.test(finde(liste, "Hulk")?.grundText || "") || finde(liste, "Hulk")?.belege.verlaufAnteil >= 0.55,
    finde(liste, "Hulk")?.grundText);
}

const fehler = pruefungen.filter((p) => !p).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
