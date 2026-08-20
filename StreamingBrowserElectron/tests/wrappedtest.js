"use strict";
// ELFIX Wrapped.
//
// Zwei Dinge entscheiden darueber, ob das Ganze taugt.
//
// Erstens: es darf niemals andere Zahlen zeigen als die Statistikseite. Beide
// ziehen aus derselben Auswertung; gaebe es einen zweiten Rechenweg, stuenden
// irgendwann 1046 Folgen auf der einen und 1038 auf der anderen Seite, und
// keiner waere zu widerlegen. Das wird hier am Quelltext festgehalten.
//
// Zweitens: keine Seite darf etwas behaupten, das die Daten nicht hergeben.
// Ohne Wiederholungen keine Rewatch-Seite, ohne gemessene Zeit keine
// Stundenseite, ohne Anime keine Anime-Seite. Ein Rueckblick mit zwoelf Seiten,
// von denen fuenf "0" zeigen, waere schlechter als einer mit sieben.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const statistik = require("../src/statistik.js");

const WURZEL = path.join(__dirname, "..");
const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").replace(/\r/g, "");
const RENDERER = fs.readFileSync(path.join(WURZEL, "src/renderer/renderer.js"), "utf8").replace(/\r/g, "");
const HTML = fs.readFileSync(path.join(WURZEL, "src/renderer/index.html"), "utf8").replace(/\r/g, "");
const CSS = fs.readFileSync(path.join(WURZEL, "src/renderer/styles.css"), "utf8").replace(/\r/g, "");

const pruefungen = [];
const pruefe = (name, bedingung, detail) => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

function abschnitt(quelle, anfang, ende = "}") {
  const zeilen = quelle.split("\n");
  const von = zeilen.findIndex((z) => z.startsWith(anfang));
  if (von < 0) throw new Error("nicht gefunden: " + anfang);
  let bis = von;
  while (bis < zeilen.length && zeilen[bis] !== ende) bis += 1;
  return zeilen.slice(von, bis + 1).join("\n");
}

// --- Wann der Rueckblick faellig ist ----------------------------------------

const fenster = { console, Date, Number, String, Boolean, Math };
vm.createContext(fenster);
vm.runInContext(MAIN.match(/^const WRAPPED_VON = .+$/m)[0], fenster);
vm.runInContext(MAIN.match(/^const WRAPPED_BIS = .+$/m)[0], fenster);
vm.runInContext(abschnitt(MAIN, "function wrappedJahrFuer("), fenster);
const jahrFuer = vm.runInContext("wrappedJahrFuer", fenster);

pruefe("Am 1. Dezember ist das laufende Jahr an der Reihe",
  jahrFuer(new Date(2027, 11, 1)) === 2027);
pruefe("Mitten im Dezember ebenso",
  jahrFuer(new Date(2027, 11, 20)) === 2027);
pruefe("Am 31. Dezember auch",
  jahrFuer(new Date(2027, 11, 31)) === 2027);
pruefe("Anfang Januar zeigt er das vergangene Jahr",
  jahrFuer(new Date(2028, 0, 3)) === 2027,
  "wer ELFIX im Dezember nicht oeffnet, soll ihn nicht ganz verpassen");
pruefe("Nach dem 6. Januar ist das Fenster zu",
  jahrFuer(new Date(2028, 0, 7)) === null);
pruefe("Im November noch nicht",
  jahrFuer(new Date(2027, 10, 30)) === null);
pruefe("Im Juli erst recht nicht",
  jahrFuer(new Date(2027, 6, 15)) === null);

const status = abschnitt(MAIN, "function wrappedStatus(");
pruefe("Faellig ist er nur im Fenster, mit genug Daten und noch ungesehen",
  /faellig: Boolean\(imFenster\) && imFenster === jahr && genug && !schonGesehen/.test(status),
  "alle drei Bedingungen zusammen");
pruefe("Auf Wunsch laesst er sich jederzeit oeffnen",
  /const jahr = Number\(jahrWunsch\) \|\| imFenster;/.test(status),
  "das Archiv soll auch im Juli funktionieren");
pruefe("Zu wenig Daten heisst: draengt sich nicht auf",
  /const genug = daten\.folgen >= WRAPPED_MIN_FOLGEN && daten\.tage >= WRAPPED_MIN_TAGE;/.test(status),
  "wer im Dezember installiert, bekommt keinen Jahresrueckblick ueber vier Folgen");
pruefe("Einmal gesehen genuegt",
  /const schonGesehen = Number\(settings\.wrapped\?\.gesehenJahr\) === jahr;/.test(status));
pruefe("Der Merker ueberlebt das Speichern der Einstellungen",
  /wrapped: \{\s*\n\s*gesehenJahr: Number\(raw\?\.wrapped\?\.gesehenJahr\) \|\| 0\s*\n\s*\}/.test(MAIN),
  "sonst meldete sich der Hinweis nach jeder Einstellungsaenderung erneut");

// --- Dieselbe Datenquelle ----------------------------------------------------

pruefe("Der Rueckblick rechnet nicht selbst, sondern fragt die Statistik",
  /const daten = watchStatistik\(String\(jahr\)\);/.test(status),
  "eine zweite Rechenart erzeugte irgendwann zwei verschiedene Folgenzahlen");
pruefe("Das Archiv ebenso",
  /const daten = watchStatistik\(String\(jahr\)\);/.test(abschnitt(MAIN, 'ipcMain.handle("wrapped:jahre"', "});")),
  "auch die Frage \"welche Jahre lohnen sich\" darf keine eigene Rechnung sein");
pruefe("Ein Jahr ist genau ein Kalenderjahr, in Ortszeit",
  /return \{ von: new Date\(jahr, 0, 1\)\.getTime\(\), bis: new Date\(jahr \+ 1, 0, 1\)\.getTime\(\) - 1 \};/.test(MAIN),
  "keine Daten aus 2026 im Rueckblick 2027");

// Und die Abgrenzung wirklich ausgefuehrt, nicht nur gelesen.
const zeit = (jahr, monat, tag, stunde = 20) => new Date(jahr, monat, tag, stunde).toISOString();
const satz = (zusatz = {}) => ({
  id: `s${Math.random()}`, favoriteId: "a", url: "u", titel: "Loki", anbieter: "S.to",
  gattung: "serie", season: 1, episode: 1, sekunden: 1800, abgeschlossen: true,
  wiederholung: false, qualitaet: statistik.GEMESSEN,
  begonnenAm: zeit(2027, 5, 1), beendetAm: zeit(2027, 5, 1, 21), ...zusatz
});
{
  const beide = [
    satz({ episode: 1, begonnenAm: zeit(2026, 11, 31, 23) }),
    satz({ episode: 2, begonnenAm: zeit(2027, 0, 1, 1) }),
    satz({ episode: 3, begonnenAm: zeit(2027, 5, 1) })
  ];
  const d2027 = statistik.auswerten(beide, {
    von: new Date(2027, 0, 1).getTime(), bis: new Date(2028, 0, 1).getTime() - 1, titel: () => ({})
  });
  pruefe("Silvester 23 Uhr gehoert noch ins alte Jahr",
    d2027.folgen === 2,
    `${d2027.folgen} statt 2 - der Satz vom 31.12. um 23 Uhr darf nicht mitkommen`);
}

// --- Welche Seiten entstehen -------------------------------------------------
// Der Seitenbau wird wirklich ausgefuehrt, mit einem Ersatz-DOM. Nur so laesst
// sich zeigen, dass eine Seite ohne Grundlage tatsaechlich fehlt.

function element(tag) {
  const knoten = {
    tag, textContent: "", dataset: {}, style: {}, kinder: [], klassen: new Set(),
    classList: { add: (...c) => c.forEach((x) => knoten.klassen.add(x)), remove: () => {}, contains: () => false, toggle: () => false },
    addEventListener() {},
    append(...k) { knoten.kinder.push(...k.filter(Boolean)); },
    querySelectorAll: () => [],
    text() {
      return [knoten.textContent, ...knoten.kinder.map((k) => k.text())].join(" ").trim();
    }
  };
  Object.defineProperty(knoten, "className", {
    get: () => [...knoten.klassen].join(" "),
    set: (w) => { knoten.klassen.clear(); String(w || "").split(/\s+/).filter(Boolean).forEach((t) => knoten.klassen.add(t)); }
  });
  return knoten;
}

function seitenBauen(daten, jahr) {
  const kontext = {
    document: { createElement: element },
    reviewDauer: (s) => `${Math.round(s / 3600)} h`,
    reviewDatum: (t) => String(t),
    Math, Date, Number, String, Boolean, Array, Object, JSON, console
  };
  const sandkasten = new Proxy(kontext, {
    has: () => true,
    get: (z, n) => (n in z ? z[n] : (typeof n === "symbol" ? undefined : () => "")),
    set: (z, n, w) => { z[n] = w; return true; }
  });
  vm.createContext(sandkasten);
  vm.runInContext(RENDERER.match(/^const WOCHENTAGE = .+$/m)[0], sandkasten);
  vm.runInContext(RENDERER.match(/^const MONATE = \[[\s\S]*?\];$/m)[0], sandkasten);
  vm.runInContext(RENDERER.match(/^const WRAPPED_TAGESZEIT = \{[\s\S]*?\n\};$/m)[0], sandkasten);
  for (const f of ["function wrappedZahl(", "function wrappedSeite(", "function wrappedText(",
    "function wrappedGrosseZahl(", "function wrappedAuftakt(", "function wrappedZeitraumHinweis(",
    "function wrappedTitelZahlen(", "function wrappedPoster(", "function wrappedRangliste(",
    "function wrappedMix(", "function wrappedMixBalken(", "function wrappedMonatName(",
    "function wrappedMonatsreihe(", "function wrappedTageszeit(", "function wrappedFakten(",
    "function wrappedFaktenListe(", "function wrappedFinale(", "function wrappedBauen("]) {
    vm.runInContext(abschnitt(RENDERER, f), sandkasten);
  }
  const seiten = vm.runInContext("wrappedBauen", sandkasten)(daten, jahr);
  return {
    arten: seiten.map((s) => s.art),
    text: seiten.map((s) => s.knoten.text()).join(" | "),
    // Einzeln, damit sich eine Aussage einer bestimmten Seite zuordnen laesst -
    // sonst zaehlt man Prozente aus einer ganz anderen mit.
    seite: (art) => seiten.filter((s) => s.art === art).map((s) => s.knoten.text()).join(" | ")
  };
}

const GENRES = [{ key: "action", label: "Action" }, { key: "fantasy", label: "Fantasy" }];
function bilanz(zusatz = {}) {
  return {
    von: "2027-01-04T20:00:00.000Z", bis: "2027-12-20T22:00:00.000Z", sitzungen: 40,
    sekunden: 360000, sekundenBekannt: 40, sekundenGesamt: 40,
    folgen: 120, folgenAbgeschlossen: 100, wiederholungen: 0,
    abschluesse: { gesamt: 12, serie: 8, film: 4, anime: 0 },
    tage: 60, strecke: { tage: 9, von: "2027-03-01", bis: "2027-03-09" }, laufendeStrecke: 0,
    aktivsterTag: { tag: "2027-08-14", sekunden: 29820, folgen: 9 },
    aktivsterWochentag: { tag: 6, sekunden: 71000, folgen: 30 },
    aktivsterMonat: { monat: "2027-08", sekunden: 188280, folgen: 40 },
    laengsteSitzung: 24120, sitzungsschnitt: 5640, folgenJeTag: 4.2,
    genres: GENRES.map((g, i) => ({ ...g, sekunden: 200000 - i * 80000, titel: 8 - i })),
    titel: [], serien: [{ titel: "Demon Slayer", folgen: 38, sekunden: 52000, bild: "p.jpg", wiederholungen: 0 }],
    filme: [{ titel: "Dune", folgen: 1, sekunden: 9000, bild: "d.jpg", wiederholungen: 0 }],
    wiederholteste: [], verlauf: [],
    erster: { titel: "Loki", wann: "2027-01-04", bild: "l.jpg" },
    letzter: { titel: "Arcane", wann: "2027-12-20", bild: "a.jpg" },
    tageszeiten: [{ fach: "nacht", sekunden: 200000, folgen: 60 }, { fach: "abend", sekunden: 160000, folgen: 60 }],
    monate: [{ monat: "2027-07", sekunden: 90000, folgen: 20 }, { monat: "2027-08", sekunden: 188280, folgen: 40 }],
    marathon: 11, welten: 14,
    ...zusatz
  };
}

{
  const voll = seitenBauen(bilanz(), 2027);
  pruefe("Mit vollen Daten entsteht eine Geschichte mit vielen Seiten",
    voll.arten.length >= 12,
    `${voll.arten.length} Seiten`);
  pruefe("Sie beginnt mit dem Auftakt und endet mit dem Finale",
    voll.arten[0] === "is-auftakt" && voll.arten[voll.arten.length - 1] === "is-finale",
    voll.arten.join(" "));
  pruefe("Die Watchtime steht als eigene Seite",
    voll.arten.includes("is-zeit") && /100.*Stunden/.test(voll.text),
    "360000 Sekunden sind 100 Stunden");
  pruefe("Serie und Film des Jahres bekommen eigene Seiten",
    voll.text.includes("Demon Slayer") && voll.text.includes("Dune"));
  pruefe("Das Genre des Jahres wird benannt",
    /eindeutig auf Action/.test(voll.text));
  pruefe("Die Streak nennt die exakte Zahl aus der Streak-Logik",
    /9 Tage nicht aufhören/.test(voll.text),
    "der Satz darf spielerisch sein, die Zahl nicht");
  pruefe("Wochentag und Rekordtag sind zwei verschiedene Seiten",
    voll.arten.filter((a) => a === "is-tag").length === 2,
    "\"Samstag war dein Tag\" und \"dein intensivster Tag\" sind nicht dasselbe");
  pruefe("Die Nachteule braucht einen deutlichen Anteil",
    /Nachteule/.test(voll.text) && /56/.test(voll.text),
    "200000 von 360000 Sekunden sind 56 Prozent");
}

{
  const ohneRewatch = seitenBauen(bilanz(), 2027);
  pruefe("Ohne Wiederholungen faellt die Rewatch-Seite weg",
    !ohneRewatch.arten.includes("is-rewatch"),
    "eine Seite \"0 Rewatches\" waere eine Seite zu viel");
  const mitRewatch = seitenBauen(bilanz({
    wiederholungen: 3,
    wiederholteste: [{ titel: "Demon Slayer", wiederholungen: 3, bild: "p.jpg", folgen: 12, sekunden: 100 }]
  }), 2027);
  pruefe("Mit Wiederholungen kommt sie dazu",
    mitRewatch.arten.includes("is-rewatch") && /3× noch einmal/.test(mitRewatch.text));
}

{
  const ohneZeit = seitenBauen(bilanz({
    sekunden: 0, sekundenBekannt: 0, laengsteSitzung: 0, sitzungsschnitt: 0,
    tageszeiten: [], aktivsterTag: { tag: "2027-08-14", sekunden: 0, folgen: 9 },
    aktivsterWochentag: { tag: 6, sekunden: 0, folgen: 30 },
    aktivsterMonat: { monat: "2027-08", sekunden: 0, folgen: 40 },
    genres: GENRES.map((g, i) => ({ ...g, sekunden: 0, titel: 8 - i }))
  }), 2027);
  pruefe("Ohne gemessene Zeit faellt die Stundenseite weg",
    !ohneZeit.arten.includes("is-zeit"),
    "\"0 Stunden\" waere falsch, wenn die Wahrheit \"unbekannt\" lautet");
  pruefe("Ebenso die Seite zur laengsten Sitzung",
    !ohneZeit.arten.includes("is-session"));
  pruefe("und die Tageszeit-Seite",
    !ohneZeit.arten.includes("is-nacht"),
    "aus Folgenzahlen folgt keine Nachteule");
  pruefe("Folgen, Abschluesse und Streak bleiben aber stehen",
    ohneZeit.arten.includes("is-folgen") && ohneZeit.arten.includes("is-serien")
    && ohneZeit.arten.includes("is-streak"),
    "das ist belegt, auch ohne Uhr");
  pruefe("Und der Rueckblick sagt, dass die Zeit fehlt",
    /Wiedergabezeit noch nicht erfasst/.test(ohneZeit.text));
}

{
  const spaet = seitenBauen(bilanz({ von: "2026-08-14T20:00:00.000Z" }), 2026);
  pruefe("Ein angefangenes Jahr sagt, ab wann es Daten gibt",
    /Daten seit August 2026/.test(spaet.text),
    "Januar bis Juli duerfen nicht als ausgewertet erscheinen");
  const ganz = seitenBauen(bilanz({ von: "2027-01-02T20:00:00.000Z" }), 2027);
  pruefe("Ein volles Jahr braucht den Hinweis nicht",
    !/Daten seit/.test(ganz.text));
}

{
  const anime = seitenBauen(bilanz({ abschluesse: { gesamt: 12, serie: 8, film: 4, anime: 5 } }), 2027);
  pruefe("Anime bekommt eine Seite, wenn es welche gibt",
    anime.arten.includes("is-anime") && /5\s*Anime/.test(anime.text));
  const ohneAnime = seitenBauen(bilanz(), 2027);
  pruefe("und keine, wenn nicht",
    !ohneAnime.arten.includes("is-anime"));
}

{
  const mix = seitenBauen(bilanz(), 2027);
  const teile = [...mix.seite("is-mix").matchAll(/(\d+) %/g)].map((t) => Number(t[1]));
  pruefe("Der Mix rechnet Prozente aus der anteiligen Zeit",
    teile.length >= 2 && teile[0] > teile[1],
    teile.join(" + "));
  pruefe("und seine Anteile ergeben genau hundert Prozent",
    teile.reduce((a, b) => a + b, 0) === 100,
    `${teile.join(" + ")} = ${teile.reduce((a, b) => a + b, 0)}`);
}

// --- Oberflaeche und Bedienung -----------------------------------------------

pruefe("Der Rueckblick ist ein eigener Vollbild-Dialog",
  /<dialog class="wrapped-modal" id="wrappedModal"/.test(HTML));
pruefe("Er meldet dem Hauptprozess, dass er offen ist",
  /ipcMain\.handle\("wrapped:set-open"/.test(MAIN)
  && /setOverlayOpen\("wrapped", Boolean\(offen\)\)/.test(MAIN),
  "sonst laege die Anbieteransicht darueber");
pruefe("Der Hinweis steht auf der Startseite, nicht als Fenster",
  /<div class="wrapped-hinweis is-hidden" id="wrappedHinweis">/.test(HTML)
  && !/wrappedOeffnen\(\)[\s\S]{0,80}beimStart/.test(RENDERER),
  "kein Popup bei jedem Start");
pruefe("Er verschwindet, sobald der Rueckblick geoeffnet wurde",
  /api\.markWrappedSeen\?\.\(antwort\.jahr\)\.then\(\(\) => renderWrappedHinweis\(\)\)/.test(RENDERER));
pruefe("Das Archiv sitzt auf der Statistikseite",
  /<div class="wrapped-archiv is-hidden" id="wrappedArchiv">/.test(HTML)
  && /renderWrappedArchiv\(\)/.test(RENDERER),
  "kein zusaetzlicher Eintrag in der Hauptnavigation");
pruefe("Geblaettert wird per Klick, Pfeil und Punkt",
  /wrappedZeigen\(wrappedStelle \+ 1\)/.test(RENDERER)
  && /event\.key === "ArrowLeft"/.test(RENDERER));
pruefe("Die Animationen achten auf beide Vorgaben",
  /prefers-reduced-motion: reduce/.test(CSS)
  && /animations-off \.wrapped-modal/.test(CSS),
  "die ELFIX-Einstellung und die des Systems");
pruefe("Der Inhalt wird nicht vorgehalten",
  !/\.wrapped-card \.wrapped-content > \* \{\s*\n\s*opacity: 0;/.test(CSS),
  "sonst blieben die Seiten bei abgeschalteter Animation unsichtbar");
pruefe("Die Abschlusskarte ist ein geschlossener Block mit eigener Kennung",
  /karte\.id = "wrappedSummary";/.test(RENDERER),
  "daraus laesst sich spaeter ein Bild erzeugen, ohne umzubauen");
pruefe("Das Theme wird durchgehend benutzt",
  !/#[0-9a-f]{6}/i.test(CSS.slice(CSS.indexOf("--- ELFIX Wrapped"))),
  "keine festen Farben - Hell, Dunkel und eigene Akzente muessen weiter gelten");

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
