"use strict";
// Das Empfehlungssystem an realistischen Profilen.
//
// Geprueft wird nicht, dass der Code laeuft, sondern dass die Rangfolge stimmt:
// kommt der naechste Teil vor dem uebernaechsten? Verdraengt eine Reihe alles
// andere? Wird ein Abbruch vorsichtig behandelt und eine Watchlist schwaecher
// als ein durchgeschauter Film?

const E = require("../src/empfehlung");

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(b); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };

const TAG = 86400000;
const JETZT = Date.parse("2026-08-18T20:00:00Z");
const vorTagen = (n) => new Date(JETZT - n * TAG).toISOString();
const vorStunden = (n) => new Date(JETZT - n * 3600000).toISOString();

// Ein Verlaufseintrag, wie ihn die Ablage wirklich fuehrt.
const gesehen = (title, genres, extra = {}) => ({
  title, genres, type: "film", providerId: "filmo", providerName: "Filmo",
  completed: true, watched: true, progress: 100, lastWatchedAt: vorTagen(2), ...extra
});
const kandidat = (title, genres, extra = {}) => ({
  title, genres, url: `https://filmo.to/filme/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  type: "film", providerId: "filmo", providerName: "Filmo", via: "genre", ...extra
});

const rang = (liste, teil) => liste.findIndex((e) => e.title.includes(teil));
const opt = (extra = {}) => ({ jetzt: JETZT, limit: 20, ...extra });

// --- 1. Naechster Teil einer Reihe -------------------------------------------

{
  const profil = E.profilBauen([gesehen("John Wick", ["action", "thriller"])], JETZT);
  const liste = E.empfehlen([
    kandidat("John Wick: Kapitel 2", ["action", "thriller"]),
    kandidat("John Wick: Kapitel 3", ["action", "thriller"]),
    kandidat("Irgendein Actionfilm", ["action", "thriller"]),
    kandidat("Eine Komoedie", ["komoedie"])
  ], profil, opt());

  pruefe("1. Teil 2 steht ganz oben", liste[0]?.title === "John Wick: Kapitel 2",
    liste.map((e) => e.title).join(" | "));
  pruefe("1b. Und traegt den richtigen Grund", liste[0]?.grund === E.GRUND.NAECHSTER_TEIL, liste[0]?.grund);
  pruefe("1c. Mit hoher Sicherheit", liste[0]?.confidence === "VERY_HIGH", liste[0]?.confidence);
  pruefe("1d. Teil 3 kommt hinter Teil 2", rang(liste, "Kapitel 3") > rang(liste, "Kapitel 2"),
    `2 auf ${rang(liste, "Kapitel 2")}, 3 auf ${rang(liste, "Kapitel 3")}`);
  pruefe("1e. Und beide vor dem beliebigen Actionfilm",
    rang(liste, "Kapitel 3") < rang(liste, "Irgendein"),
    `3 auf ${rang(liste, "Kapitel 3")}, beliebig auf ${rang(liste, "Irgendein")}`);
}

{
  // Teil 1 und 2 fertig: jetzt ist Teil 3 dran, und Teil 2 darf nicht wieder
  // auftauchen.
  const profil = E.profilBauen([
    gesehen("John Wick", ["action"]),
    gesehen("John Wick: Kapitel 2", ["action"], { lastWatchedAt: vorTagen(1) })
  ], JETZT);
  const liste = E.empfehlen([
    kandidat("John Wick: Kapitel 2", ["action"]),
    kandidat("John Wick: Kapitel 3", ["action"]),
    kandidat("John Wick: Kapitel 4", ["action"])
  ], profil, opt());

  pruefe("2. Nach Teil 2 kommt Teil 3 zuerst", liste[0]?.title === "John Wick: Kapitel 3",
    liste.map((e) => e.title).join(" | "));
  pruefe("2b. Teil 2 wird nicht erneut empfohlen", !liste.some((e) => e.title.includes("Kapitel 2")),
    liste.map((e) => e.title).join(" | "));
  pruefe("2c. Teil 4 steht hinter Teil 3", rang(liste, "Kapitel 4") > rang(liste, "Kapitel 3"),
    `3 auf ${rang(liste, "Kapitel 3")}, 4 auf ${rang(liste, "Kapitel 4")}`);
}

{
  // Reihenfolge ohne Nummern: dieselbe Reihe, aber keine belegbare Folge.
  const profil = E.profilBauen([gesehen("Harry Potter und der Stein der Weisen", ["fantasy"])], JETZT);
  const liste = E.empfehlen([
    kandidat("Harry Potter und die Kammer des Schreckens", ["fantasy"]),
    kandidat("Ein anderer Fantasyfilm", ["fantasy"])
  ], profil, opt());
  pruefe("3. Reihe ohne Nummern wird trotzdem erkannt und bevorzugt",
    liste[0]?.title.includes("Kammer des Schreckens"), liste.map((e) => e.title).join(" | "));
  pruefe("3b. Aber als Reihe, nicht als belegte Fortsetzung",
    liste[0]?.grund === E.GRUND.REIHE, liste[0]?.grund);
}

// --- 4. Kein falsches Franchise ----------------------------------------------

{
  const profil = E.profilBauen([gesehen("Avatar - Aufbruch nach Pandora", ["scifi", "action"])], JETZT);
  const liste = E.empfehlen([
    kandidat("Avatar: The Way of Water", ["scifi", "action"]),
    kandidat("Avatar Aang: Der Herr der Elemente", ["animation", "familie"])
  ], profil, opt({ debug: true }));

  const wasser = liste.find((e) => e.title.includes("Way of Water"));
  const aang = liste.find((e) => e.title.includes("Aang"));
  pruefe("4. Die echte Fortsetzung wird als Reihe erkannt",
    wasser && wasser.teilwerte.reihe > 0.6, wasser ? wasser.teilwerte.reihe.toFixed(2) : "fehlt");
  pruefe("4b. Das gleichnamige fremde Werk nicht",
    !aang || aang.teilwerte.reihe === 0, aang ? `reihe=${aang.teilwerte.reihe}` : "gar nicht dabei");
}

// --- 5. Dubletten ueber Anbieter ----------------------------------------------

{
  const profil = E.profilBauen([gesehen("Irgendwas", ["action"])], JETZT);
  const liste = E.empfehlen([
    { ...kandidat("Attack on Titan Ger Dub", ["action"]), providerId: "aniworld", providerName: "Aniworld", type: "serie" },
    { ...kandidat("Attack on Titan Ger Sub", ["action"]), providerId: "aniworld", providerName: "Aniworld", type: "serie" },
    { ...kandidat("Attack on Titan", ["action"]), providerId: "sto", providerName: "S.to", type: "serie" }
  ], profil, opt());

  const treffer = liste.filter((e) => e.title.toLowerCase().includes("attack on titan"));
  pruefe("5. Drei Fassungen desselben Werks werden zu einer",
    treffer.length === 1, `${treffer.length} Eintraege`);
  pruefe("5b. Die anderen Anbieter haengen als Alternativen daran",
    treffer[0]?.alternativen.length === 2, `${treffer[0]?.alternativen.length} Alternativen`);
}

{
  // Und mit verschmutztem Titel, wie ihn S.to wirklich liefert.
  const profil = E.profilBauen([gesehen("Irgendwas", ["action"])], JETZT);
  const liste = E.empfehlen([
    { ...kandidat("Reacher", ["action"]), providerId: "filmo", type: "serie" },
    { ...kandidat("Reacher Staffel 1 | SerienStream (S.to)", ["action"]), providerId: "sto", type: "serie" }
  ], profil, opt());
  pruefe("5c. Auch ein Titel mit Anbieter- und Staffelzusatz faellt zusammen",
    liste.filter((e) => e.title.toLowerCase().includes("reacher")).length === 1,
    liste.map((e) => e.title).join(" | "));
}

// --- 6. Abgeschlossenes nicht erneut ------------------------------------------

{
  const profil = E.profilBauen([gesehen("The Dark Knight", ["action", "thriller"])], JETZT);
  const liste = E.empfehlen([
    kandidat("The Dark Knight", ["action", "thriller"]),
    kandidat("Ein Actionfilm", ["action", "thriller"])
  ], profil, opt());
  pruefe("6. Ein abgeschlossener Film kommt nicht erneut",
    !liste.some((e) => e.title === "The Dark Knight"), liste.map((e) => e.title).join(" | "));
}

// --- 7. Watchlist schwaecher als Geschautes -----------------------------------

{
  const nurWatchlist = E.profilBauen([
    { title: "Merkzettel-Film", genres: ["horror"], type: "film", providerId: "filmo", favorite: true, createdAt: vorTagen(2) }
  ], JETZT);
  const durchgeschaut = E.profilBauen([gesehen("Fertig-Film", ["horror"])], JETZT);

  const a = E.empfehlen([kandidat("Ein Horrorfilm", ["horror"])], nurWatchlist, opt({ debug: true }));
  const b = E.empfehlen([kandidat("Ein Horrorfilm", ["horror"])], durchgeschaut, opt({ debug: true }));
  pruefe("7. Watchlist wirkt positiv", a[0] && a[0].score > 0, a[0]?.score.toFixed(3));
  pruefe("7b. Aber schwaecher als ein durchgeschauter Film",
    a[0] && b[0] && b[0].score > a[0].score,
    `Watchlist ${a[0]?.score.toFixed(3)} gegen fertig ${b[0]?.score.toFixed(3)}`);
}

// --- 8. Abbruch als vorsichtiges Negativsignal --------------------------------

{
  const einmal = E.profilBauen([
    { title: "Abgebrochen A", genres: ["western"], type: "film", providerId: "filmo",
      duration: 6000, position: 200, lastWatchedAt: vorTagen(20) },
    gesehen("Guter Western", ["western"], { lastWatchedAt: vorTagen(20) })
  ], JETZT);
  const oft = E.profilBauen([
    { title: "Abgebrochen A", genres: ["western"], type: "film", providerId: "filmo", duration: 6000, position: 200, lastWatchedAt: vorTagen(20) },
    { title: "Abgebrochen B", genres: ["western"], type: "film", providerId: "filmo", duration: 6000, position: 150, lastWatchedAt: vorTagen(18) },
    { title: "Abgebrochen C", genres: ["western"], type: "film", providerId: "filmo", duration: 6000, position: 120, lastWatchedAt: vorTagen(16) },
    gesehen("Guter Western", ["western"], { lastWatchedAt: vorTagen(20) })
  ], JETZT);

  const a = E.empfehlen([kandidat("Noch ein Western", ["western"])], einmal, opt({ debug: true }));
  const b = E.empfehlen([kandidat("Noch ein Western", ["western"])], oft, opt({ debug: true }));
  pruefe("8. Ein einzelner Abbruch bestraft das Genre nicht",
    a[0] && a[0].teilwerte.abneigung === 0, `abneigung=${a[0]?.teilwerte.abneigung}`);
  pruefe("8b. Mehrere Abbrueche in dieselbe Richtung schon",
    b[0] && b[0].teilwerte.abneigung > 0, `abneigung=${b[0]?.teilwerte.abneigung.toFixed(3)}`);
  pruefe("8c. Aber vorsichtig - das Genre verschwindet nicht",
    b[0] && b[0].score > 0, `score=${b[0]?.score.toFixed(3)}`);
}

// --- 9. Sitzung schlaegt alten Verlauf ----------------------------------------

{
  const profil = E.profilBauen([
    gesehen("Alter Liebling", ["komoedie"], { lastWatchedAt: vorTagen(120) }),
    gesehen("Gerade eben", ["horror"], { lastWatchedAt: vorStunden(1) })
  ], JETZT);
  const liste = E.empfehlen([
    kandidat("Neuer Horror", ["horror"]),
    kandidat("Neue Komoedie", ["komoedie"])
  ], profil, opt());
  pruefe("9. Was gerade laeuft, zaehlt mehr als der alte Verlauf",
    liste[0]?.title === "Neuer Horror", liste.map((e) => `${e.title} ${e.score.toFixed(2)}`).join(" | "));
  pruefe("9b. Der alte Geschmack faellt aber nicht weg",
    liste.some((e) => e.title === "Neue Komoedie"), liste.map((e) => e.title).join(" | "));
}

// --- 10. Muedigkeit -----------------------------------------------------------

{
  const profil = E.profilBauen([gesehen("Basis", ["scifi"])], JETZT);
  const kandidaten = [kandidat("Oft gezeigt", ["scifi"]), kandidat("Neu dabei", ["scifi"])];
  const frisch = E.empfehlen(kandidaten, profil, opt());
  const oftGezeigt = frisch.find((e) => e.title === "Oft gezeigt");

  const anzeigen = new Map([[oftGezeigt.werkKey, 12]]);
  const spaeter = E.empfehlen(kandidaten, profil, opt({ anzeigen, debug: true }));
  const danach = spaeter.find((e) => e.title === "Oft gezeigt");

  pruefe("10. Oft gezeigt und nie geoeffnet sinkt im Rang",
    danach.score < oftGezeigt.score, `${oftGezeigt.score.toFixed(3)} -> ${danach.score.toFixed(3)}`);
  pruefe("10b. Verschwindet aber nicht ganz",
    spaeter.some((e) => e.title === "Oft gezeigt"), "noch dabei");
  pruefe("10c. Und steht jetzt hinter dem frischen Titel",
    spaeter[0].title === "Neu dabei", spaeter.map((e) => e.title).join(" | "));
}

// --- 11. Fehlende Daten sind kein Treffer -------------------------------------

{
  const profil = E.profilBauen([gesehen("Ohne Genres", [])], JETZT);
  const liste = E.empfehlen([kandidat("Auch ohne Genres", [])], profil, opt({ debug: true }));
  pruefe("11. Zwei Titel ohne Genres gelten nicht als aehnlich",
    !liste.length || liste[0].teilwerte.genre === 0,
    liste.length ? `genre=${liste[0].teilwerte.genre}` : "gar nicht empfohlen");
  pruefe("11b. Leere Genre-Mengen ergeben keine Aehnlichkeit",
    E.genreAehnlichkeit([], []) === 0 && E.genreAehnlichkeit(["action"], []) === 0, "0");
}

// --- 12. Cold Start -----------------------------------------------------------

{
  const leer = E.profilBauen([], JETZT);
  const liste = E.empfehlen([
    kandidat("Irgendein Film", ["action"]),
    kandidat("Noch einer", ["komoedie"]),
    { ...kandidat("Und noch einer", ["drama"]), via: "new" }
  ], leer, opt());
  pruefe("12. Ohne Verlauf bricht nichts", Array.isArray(liste), typeof liste);
  pruefe("12b. Und es kommt trotzdem etwas heraus", liste.length === 3, `${liste.length} Vorschlaege`);
  pruefe("12c. Neues steht dabei vorn", liste[0]?.title === "Und noch einer",
    liste.map((e) => e.title).join(" | "));
}

// --- 13. Vielfalt --------------------------------------------------------------

{
  const profil = E.profilBauen([
    gesehen("John Wick", ["action"]),
    gesehen("Interstellar", ["scifi"], { lastWatchedAt: vorTagen(3) })
  ], JETZT);
  const liste = E.empfehlen([
    kandidat("John Wick: Kapitel 2", ["action"]),
    kandidat("John Wick: Kapitel 3", ["action"]),
    kandidat("John Wick: Kapitel 4", ["action"]),
    kandidat("Ein Scifi-Film", ["scifi"]),
    kandidat("Noch ein Actionfilm", ["action"])
  ], profil, opt({ limit: 4 }));

  const ersteVier = liste.slice(0, 4).map((e) => e.title);
  const wick = ersteVier.filter((t) => t.includes("John Wick")).length;
  pruefe("13. Eine Reihe fuellt nicht die ganze Liste", wick <= 2, ersteVier.join(" | "));
  pruefe("13b. Anderes kommt dazwischen",
    ersteVier.some((t) => !t.includes("John Wick")), ersteVier.join(" | "));
  pruefe("13c. Der naechste Teil bleibt trotzdem vorn",
    ersteVier[0] === "John Wick: Kapitel 2", ersteVier[0]);
}

// --- 14. Stabilitaet -----------------------------------------------------------

{
  const profil = E.profilBauen([gesehen("Basis", ["action", "scifi"])], JETZT);
  const kandidaten = [
    kandidat("A", ["action"]), kandidat("B", ["scifi"]), kandidat("C", ["action", "scifi"]),
    kandidat("D", ["drama"]), kandidat("E", ["action"])
  ];
  const eins = E.empfehlen(kandidaten, profil, opt()).map((e) => e.title).join(",");
  const zwei = E.empfehlen(kandidaten, profil, opt()).map((e) => e.title).join(",");
  const drei = E.empfehlen([...kandidaten].reverse(), profil, opt()).map((e) => e.title).join(",");
  pruefe("14. Gleiches Profil, gleiche Reihenfolge", eins === zwei, eins);
  pruefe("14b. Auch bei anderer Eingabereihenfolge", eins === drei, `${eins} gegen ${drei}`);
}

// --- 15. Anbieter-Aehnlichkeit ist ein starkes Signal --------------------------

{
  const profil = E.profilBauen([gesehen("Vorbild", ["drama"])], JETZT);
  const liste = E.empfehlen([
    { ...kandidat("Laut Anbieter aehnlich", ["drama"]), via: "related", seedTitle: "Vorbild", seedWeight: 1 },
    kandidat("Nur gleiches Genre", ["drama"])
  ], profil, opt());
  pruefe("15. Was der Anbieter als aehnlich ausweist, steht vorn",
    liste[0]?.title === "Laut Anbieter aehnlich", liste.map((e) => e.title).join(" | "));
  // Der Anbieterhinweis darf den Rang heben, aber nie als Erklaerung dastehen:
  // belegt ist damit nur, dass zwei Seiten verlinkt sind.
  pruefe("15b. Aber er wird nicht als Grund angezeigt",
    liste[0]?.grund !== "RELATED_BY_PROVIDER" && !/Vorgeschlagen bei/.test(liste[0]?.grundText || ""),
    `${liste[0]?.grund}: ${liste[0]?.grundText}`);
}

// --- 16. Ausschluss und Debug --------------------------------------------------

{
  const profil = E.profilBauen([gesehen("Basis", ["action"])], JETZT);
  const alle = E.empfehlen([kandidat("Raus damit", ["action"]), kandidat("Bleibt", ["action"])], profil, opt());
  const key = alle.find((e) => e.title === "Raus damit").werkKey;
  const gefiltert = E.empfehlen(
    [kandidat("Raus damit", ["action"]), kandidat("Bleibt", ["action"])],
    profil, opt({ ausschluss: new Set([key]) })
  );
  pruefe("16. Ein Ausschluss wirkt", !gefiltert.some((e) => e.title === "Raus damit"),
    gefiltert.map((e) => e.title).join(" | "));

  const mitDebug = E.empfehlen([kandidat("Bleibt", ["action"])], profil, opt({ debug: true }));
  const bericht = E.debugBericht(mitDebug[0]);
  pruefe("16b. Der Debug-Bericht nennt Punkte, Sicherheit und Grund",
    /Final Score:/.test(bericht) && /Confidence:/.test(bericht)
    && /Selected Reason:/.test(bericht) && /Visible Reason:/.test(bericht),
    bericht.split("\n")[2]);
  pruefe("16c. Und zeigt, woran der Grund gemessen wurde",
    /Staerkster Seed:/.test(bericht) && /Watchlist:/.test(bericht) && /Genre:/.test(bericht),
    bericht.split("\n").find((zeile) => zeile.startsWith("Staerkster")) || "fehlt");
}

// --- 17. Belege zum Grund ------------------------------------------------------
//
// Der Grund allein reicht der Oberflaeche nicht - sie muss ihn benennen
// koennen. Dafuer traegt jeder Vorschlag mit, woran sein Grund haengt. Was
// hier leer bleibt, darf dort nicht behauptet werden.

{
  const profil = E.profilBauen([
    gesehen("John Wick", ["action"]),
    gesehen("John Wick: Kapitel 2", ["action"], { lastWatchedAt: vorTagen(1) })
  ], JETZT);
  const liste = E.empfehlen([kandidat("John Wick: Kapitel 3", ["action"])], profil, opt());

  pruefe("17. Die Fortsetzung nennt den Teil, bei dem der Nutzer steht",
    liste[0]?.grundTitel === "John Wick: Kapitel 2", liste[0]?.grundTitel);
  pruefe("17b. Und nicht den aehnlichsten Teil der Reihe",
    liste[0]?.grundTitel !== "John Wick", liste[0]?.grundTitel);
  pruefe("17c. Die Sicherheit ist der Anteil am positiven Score, nicht die Punktzahl",
    liste[0]?.grundKonfidenz > 0 && liste[0]?.grundKonfidenz <= 1
    && liste[0]?.grundKonfidenz < liste[0]?.score,
    `${liste[0]?.grundKonfidenz} bei ${liste[0]?.score}`);
}

{
  // Ein Titel, der nur vorgemerkt ist, wurde nicht geschaut - der Grund ist
  // dann die Watchlist und nicht der Verlauf.
  const profil = E.profilBauen([
    { title: "Der Exorzist", genres: ["horror"], type: "film", providerId: "filmo", favorite: true, createdAt: vorTagen(3) }
  ], JETZT);
  const liste = E.empfehlen([kandidat("Hereditary", ["horror"])], profil, opt());
  pruefe("17d. Ein nur gemerkter Titel begruendet keine Verlaufs-Aehnlichkeit",
    liste[0]?.grund === E.GRUND.WATCHLIST, liste[0]?.grund);
  pruefe("17e. Genannt wird der vorgemerkte Titel",
    liste[0]?.grundTitel === "Der Exorzist", liste[0]?.grundTitel);
}

{
  // Ohne Profil gibt es nichts zu belegen - und dann steht dort auch nichts.
  const leer = E.profilBauen([], JETZT);
  const liste = E.empfehlen([kandidat("Irgendein Film", ["action"])], leer, opt());
  pruefe("17f. Ohne Verlauf bleibt der Grund Erkundung",
    liste[0]?.grund === E.GRUND.ERKUNDUNG, liste[0]?.grund);
  pruefe("17g. Und es wird kein Beleg erfunden",
    liste[0]?.grundTitel === "" && liste[0]?.grundGenre === "",
    `"${liste[0]?.grundTitel}" / "${liste[0]?.grundGenre}"`);
  pruefe("17h. Der Satz kommt fertig aus der Engine",
    liste[0]?.grundText === "Könnte einen Versuch wert sein", liste[0]?.grundText);
}

{
  // Das Genre traegt den Grund nur, wenn kein einzelner Titel passt. Dann
  // gehoert dazu, ob es aus der laufenden Sitzung stammt oder aus dem Profil.
  const sitzung = E.profilBauen([
    gesehen("Action A", ["action", "thriller"], { lastWatchedAt: vorStunden(2) }),
    gesehen("Action B", ["action", "krimi"], { lastWatchedAt: vorStunden(4) })
  ], JETZT);
  const breit = kandidat("Bunter Mix", ["action", "sport", "familie", "drama"]);
  const jetztGleich = E.empfehlen([breit], sitzung, opt());
  pruefe("17i. Das Genre-Signal nennt das fuehrende Genre",
    jetztGleich[0]?.grund === E.GRUND.GENRE && jetztGleich[0]?.grundGenre === "action",
    `${jetztGleich[0]?.grund} / ${jetztGleich[0]?.grundGenre}`);
  pruefe("17j. Und weist die laufende Sitzung als Quelle aus",
    jetztGleich[0]?.grundSitzung === true, String(jetztGleich[0]?.grundSitzung));

  const alt = E.profilBauen([
    gesehen("Action A", ["action", "thriller"], { lastWatchedAt: vorTagen(40) }),
    gesehen("Action B", ["action", "krimi"], { lastWatchedAt: vorTagen(50) })
  ], JETZT);
  const spaeter = E.empfehlen([breit], alt, opt());
  pruefe("17k. Ein alter Geschmack wird nicht als Sitzung ausgegeben",
    spaeter[0]?.grundGenre === "action" && spaeter[0]?.grundSitzung === false,
    `${spaeter[0]?.grundGenre} / ${spaeter[0]?.grundSitzung}`);
}

{
  // Der Beleg gehoert zum genannten Grund - der eines anderen waere falsch.
  const profil = E.profilBauen([gesehen("Vorbild", ["drama"])], JETZT);
  const liste = E.empfehlen([
    { ...kandidat("Laut Anbieter aehnlich", ["drama"]), via: "related", seedTitle: "Vorbild", seedWeight: 1 }
  ], profil, opt({ debug: true }));
  pruefe("17l. Die Anbieter-Verknuepfung bleibt ein internes Signal",
    liste[0]?.grund !== "RELATED_BY_PROVIDER", liste[0]?.grund);
  pruefe("17m. Sie hebt den Rang trotzdem",
    liste[0]?.teilwerte?.aehnlichLautAnbieter > 0, String(liste[0]?.teilwerte?.aehnlichLautAnbieter));
}

// --- 18. Der Grund kommt aus den Score-Beitraegen ------------------------------
//
// Nicht aus einer Rangtabelle und nicht daraus, wie der Kandidat gefunden
// wurde. Genau das ging frueher auseinander: gefunden ueber die Liste von
// Titel A, gerankt ueber das Genre - genannt wurde A.

{
  const profil = E.profilBauen([
    gesehen("Vorbild", ["drama", "krimi", "thriller"], { lastWatchedAt: vorStunden(4) }),
    gesehen("Anderes", ["komoedie", "familie"], { lastWatchedAt: vorTagen(3) })
  ], JETZT);
  const liste = E.empfehlen([kandidat("Kandidat", ["drama", "krimi", "thriller"])], profil, opt({ debug: true }));
  const b = liste[0].beitraege;

  pruefe("18. Die Beitraege sind Gewicht mal Merkmal",
    Math.abs(b.genre - E.GEWICHTE.genre * liste[0].teilwerte.genre) < 1e-9,
    `${b.genre.toFixed(3)} gegen ${(E.GEWICHTE.genre * liste[0].teilwerte.genre).toFixed(3)}`);
  pruefe("18b. Und summieren sich zur Punktzahl auf",
    Math.abs(Object.values(b).reduce((s, w) => s + w, 0) - E.punkte(liste[0].teilwerte)) < 1e-9,
    `${Object.values(b).reduce((s, w) => s + w, 0).toFixed(3)} gegen ${E.punkte(liste[0].teilwerte).toFixed(3)}`);
  pruefe("18c. Der genannte Grund ist der, der den Score traegt",
    liste[0].grundKonfidenz >= 0.25, `Anteil ${liste[0].grundKonfidenz}`);
}

{
  // Ueber die Liste von A hereingekommen, aber vom Genreprofil getragen: dann
  // erklaert A gar nichts, und A wird auch nicht genannt.
  const profil = E.profilBauen([
    gesehen("Kinderfilm", ["familie"], { lastWatchedAt: vorTagen(30) }),
    gesehen("Actionfilm A", ["action", "thriller"], { lastWatchedAt: vorStunden(3) }),
    gesehen("Actionfilm B", ["action", "krimi"], { lastWatchedAt: vorStunden(5) }),
    gesehen("Actionfilm C", ["action", "abenteuer"], { lastWatchedAt: vorStunden(7) })
  ], JETZT);
  const liste = E.empfehlen([
    { ...kandidat("Ganz woanders her", ["action", "thriller", "krimi", "abenteuer"]),
      via: "related", seedTitle: "Kinderfilm", seedWeight: 0.08 }
  ], profil, opt({ debug: true }));

  pruefe("18d. Ein schwacher Fundort wird nicht als Grund ausgegeben",
    liste[0]?.grundTitel !== "Kinderfilm", `"${liste[0]?.grundTitel}"`);
  pruefe("18e. Genannt wird, was wirklich getragen hat",
    liste[0]?.grund === E.GRUND.GENRE || liste[0]?.grund === E.GRUND.VERLAUF, liste[0]?.grund);
}

{
  // Ein einzelnes gemeinsames Genre ist kein Titelbezug - egal wie stark der
  // Verlaufseintrag sonst ist.
  const profil = E.profilBauen([
    gesehen("Sehr stark", ["animation"], { lastWatchedAt: vorStunden(1), completedEpisodes: new Array(12).fill(1) })
  ], JETZT);
  const liste = E.empfehlen([kandidat("Nur Animation", ["animation"])], profil, opt({ debug: true }));
  pruefe("18f. Ein einziges gemeinsames Genre begruendet keinen Titelbezug",
    liste[0]?.grundTitel === "" && liste[0]?.belege.verlaufGemeinsam === 1,
    `"${liste[0]?.grundTitel}" bei ${liste[0]?.belege.verlaufGemeinsam} gemeinsamen Genres`);
  pruefe("18g. Der Beleg wird trotzdem gemessen und ist nachlesbar",
    liste[0]?.belege.verlaufBester === "Sehr stark" && liste[0]?.belege.verlaufDeckung === 1,
    `${liste[0]?.belege.verlaufBester} / ${liste[0]?.belege.verlaufDeckung}`);
}

{
  // Zwei gleich gute Seeds: keiner erklaert die Empfehlung allein.
  const gleichauf = E.profilBauen([
    gesehen("Seed A", ["drama", "krimi", "thriller"], { lastWatchedAt: vorStunden(4) }),
    gesehen("Seed B", ["drama", "krimi", "thriller"], { lastWatchedAt: vorStunden(5) })
  ], JETZT);
  const a = E.empfehlen([kandidat("Kandidat", ["drama", "krimi", "thriller"])], gleichauf, opt({ debug: true }));
  pruefe("18h. Zwei gleich starke Seeds ergeben keinen konkreten Bezug",
    a[0]?.grundTitel === "" && a[0]?.belege.verlaufAnteil < 0.55,
    `Anteil ${a[0]?.belege.verlaufAnteil.toFixed(2)}`);

  // Derselbe Titel zweimal in der Ablage ist ein Werk, kein zweiter Seed.
  const doppelt = E.profilBauen([
    gesehen("Seed A", ["drama", "krimi", "thriller"], { lastWatchedAt: vorStunden(4) }),
    gesehen("Seed A", ["drama", "krimi", "thriller"], { lastWatchedAt: vorStunden(5), providerId: "sto" }),
    gesehen("Weit weg", ["komoedie"], { lastWatchedAt: vorTagen(9) })
  ], JETZT);
  const b = E.empfehlen([kandidat("Kandidat", ["drama", "krimi", "thriller"])], doppelt, opt({ debug: true }));
  pruefe("18i. Zwei Eintraege desselben Werks nehmen sich nicht den Vorsprung",
    b[0]?.grundTitel === "Seed A", `"${b[0]?.grundTitel}"`);
}

// --- 19. Reihenfolge der Entdeckungsseiten -----------------------------------
//
// Weiter unten soll mehr Erkundung stehen - aber oben darf sie die
// Personalisierung nicht verdraengen, und kein Titel darf zweimal kommen.

{
  const liste = Array.from({ length: 800 }, (_, index) => ({ werkKey: "w" + index, rang: index }));
  // Der Erkundungsmassstab ist hier absichtlich genau gegenlaeufig: was das
  // Profil hinten sieht, steht bei der Erkundung vorn. So laesst sich der
  // Anteil an den Raengen ablesen.
  const geordnet = E.erkundungsReihenfolge(liste, (eintrag) => eintrag.rang);

  pruefe("19a. Es geht kein Titel verloren", geordnet.length === liste.length, String(geordnet.length));
  pruefe("19b. Und keiner kommt doppelt",
    new Set(geordnet.map((e) => e.werkKey)).size === geordnet.length);

  const anteil = (von, bis) => {
    const teil = geordnet.slice(von, bis);
    return teil.filter((e) => e.rang >= liste.length / 2).length / teil.length;
  };
  pruefe("19c. Ganz oben steht fast nur Personalisierung", anteil(0, 30) <= 0.15,
    (100 * anteil(0, 30)).toFixed(0) + "%");
  pruefe("19d. Die ersten Plaetze sind unangetastet",
    geordnet.slice(0, 8).every((e, index) => e.rang === index),
    geordnet.slice(0, 8).map((e) => e.rang).join(","));
  pruefe("19e. In der Mitte waechst der Erkundungsanteil",
    anteil(200, 230) > anteil(0, 30), (100 * anteil(200, 230)).toFixed(0) + "%");
  pruefe("19f. Und weiter unten noch einmal",
    anteil(400, 430) > anteil(200, 230), (100 * anteil(400, 430)).toFixed(0) + "%");
  pruefe("19g. Aber nie ueber den Deckel hinaus", anteil(400, 430) <= 0.45,
    (100 * anteil(400, 430)).toFixed(0) + "%");
}

{
  const eine = [{ werkKey: "a" }];
  pruefe("19h. Eine Liste mit einem Eintrag bleibt unveraendert",
    E.erkundungsReihenfolge(eine, () => 1).length === 1);
  pruefe("19i. Ohne Massstab wird nichts umsortiert",
    E.erkundungsReihenfolge([{ werkKey: "a" }, { werkKey: "b" }], null)
      .map((e) => e.werkKey).join("") === "ab");
  pruefe("19j. Eine leere Liste bleibt leer", E.erkundungsReihenfolge([], () => 1).length === 0);
}

{
  const doppelt = [{ werkKey: "a" }, { werkKey: "b" }, { werkKey: "a" }, { werkKey: "c" }];
  const geordnet = E.erkundungsReihenfolge(doppelt, (e) => (e.werkKey === "c" ? 9 : 0));
  pruefe("19k. Derselbe Werk-Schluessel erscheint nur einmal",
    new Set(geordnet.map((e) => e.werkKey)).size === geordnet.length,
    geordnet.map((e) => e.werkKey).join(","));
}

const fehler = pruefungen.filter((p) => !p).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
