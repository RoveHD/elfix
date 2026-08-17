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
  pruefe("15b. Mit passendem Grund", liste[0]?.grund === E.GRUND.ANBIETER_AEHNLICH, liste[0]?.grund);
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
    /Total:/.test(bericht) && /Confidence:/.test(bericht) && /Reason:/.test(bericht),
    bericht.split("\n")[1]);
}

const fehler = pruefungen.filter((p) => !p).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
