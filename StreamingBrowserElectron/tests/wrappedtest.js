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

// Die Regel steht seit dem Fernseher im geteilten Modul: dort fragt sie das
// Telefon ueber den Kern, hier der Hauptprozess unmittelbar. Gefahren wird
// deshalb die Funktion selbst und nicht mehr ein Textblock aus main.js.
const jahrFuer = statistik.wrappedJahrFuer;

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
  jahrFuer(new Date(2028, 0, 7)) === 0);
pruefe("Im November noch nicht",
  jahrFuer(new Date(2027, 10, 30)) === 0);
pruefe("Im Juli erst recht nicht",
  jahrFuer(new Date(2027, 6, 15)) === 0);

const genugDaten = { folgen: 40, tage: 12 };
const dezember = new Date(2027, 11, 20);
pruefe("Faellig ist er nur im Fenster, mit genug Daten und noch ungesehen",
  statistik.wrappedLage(genugDaten, { jetzt: dezember }).faellig === true
  && statistik.wrappedLage(genugDaten, { jetzt: new Date(2027, 6, 15) }).faellig === false
  && statistik.wrappedLage({ folgen: 4, tage: 1 }, { jetzt: dezember }).faellig === false
  && statistik.wrappedLage(genugDaten, { jetzt: dezember, gesehenJahr: 2027 }).faellig === false,
  "alle drei Bedingungen zusammen");
pruefe("Die Saison bleibt stehen, auch wenn er schon gesehen ist",
  statistik.wrappedLage(genugDaten, { jetzt: dezember, gesehenJahr: 2027 }).saison === true,
  "sonst verschwaende der Weg dorthin genau dann, wenn man ihn wiederfinden will");
pruefe("Auf Wunsch laesst er sich jederzeit oeffnen",
  statistik.wrappedLage(genugDaten, { jahrWunsch: 2025, jetzt: new Date(2027, 6, 15) }).jahr === 2025,
  "das Archiv soll auch im Juli funktionieren");
pruefe("Zu wenig Daten heisst: draengt sich nicht auf",
  statistik.wrappedLage({ folgen: 9, tage: 12 }, { jetzt: dezember }).genug === false
  && statistik.wrappedLage({ folgen: 40, tage: 2 }, { jetzt: dezember }).genug === false,
  "wer im Dezember installiert, bekommt keinen Jahresrueckblick ueber vier Folgen");

const status = abschnitt(MAIN, "function wrappedStatus(");
pruefe("Der Rechner rechnet das nicht selbst nach",
  /statistik\.wrappedLage\(daten, \{/.test(status) && !/WRAPPED_MIN_FOLGEN/.test(MAIN),
  "eine zweite Vorstellung davon, wann Dezember genug Dezember ist, waere die naechste Abweichung");
pruefe("Und reicht das gesehene Jahr aus seinen Einstellungen hinein",
  /gesehenJahr: settings\.wrapped\?\.gesehenJahr/.test(status));
pruefe("Der Merker ueberlebt das Speichern der Einstellungen",
  /gesehenJahr: Number\(raw\?\.wrapped\?\.gesehenJahr\) \|\| 0/.test(MAIN)
  && /settings\.wrapped = \{\s*\n\s*\.\.\.\(settings\.wrapped \|\| \{\}\),/.test(RENDERER),
  "sonst meldete sich der Hinweis nach jeder Einstellungsaenderung erneut");
pruefe("Und der Musikschalter nimmt ihn nicht mit",
  !/settings\.wrapped = \{\s*\n\s*musik:/.test(RENDERER),
  "die Oberflaeche kennt das gesehene Jahr nicht - sie darf es nicht ueberschreiben");

// --- Dieselbe Datenquelle ----------------------------------------------------

pruefe("Der Rueckblick rechnet nicht selbst, sondern fragt die Statistik",
  /const daten = watchStatistik\(String\(jahr\)\);/.test(status),
  "eine zweite Rechenart erzeugte irgendwann zwei verschiedene Folgenzahlen");
pruefe("Das Archiv ebenso",
  /watchStatistik\(String\(jahr\)\)/.test(abschnitt(MAIN, 'ipcMain.handle("wrapped:jahre"', "});")),
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
// --- Der Eintrag in der Seitenleiste ---

pruefe("Der Punkt ist von Haus aus nicht zu sehen",
  /id="reviewSideLink" data-home-action="review"/.test(HTML)
  && /class="home-side-link is-hidden" type="button" id="reviewSideLink"/.test(HTML),
  "eine Statistik ist etwas fuer den, der sie sucht");
pruefe("Die Einstellung steht bei den uebrigen Sichtbarkeits-Schaltern",
  /id="showReviewLink" type="checkbox"/.test(HTML));
pruefe("Von Haus aus steht sie auf aus",
  /showReview: raw\?\.home\?\.showReview === true/.test(MAIN)
  && /showReview: false/.test(MAIN),
  "nur ein ausdrueckliches Ja blendet den Punkt ein");
pruefe("Eingeschaltet steht er da - und in der Saison auch ohne die Einstellung",
  /knopf\.classList\.toggle\("is-hidden", !saison && settings\.home\?\.showReview !== true\)/
    .test(RENDERER));

// --- Und im Dezember leuchtet er ---
//
// Der Dezember blendete den Eintrag bis hierher nur ein. Damit sass er als
// neunter Punkt in einer Liste aus acht Punkten - dieselbe Farbe, dieselbe
// Hoehe, dieselbe Schrift -, und einen neunten Punkt bemerkt niemand.
//
// Der Unterschied zur Einstellung ist Absicht und keine Doppelung: wer die
// Statistik selbst einschaltet, will sie dahaben und nicht angesprochen werden.
// Nur die Saison ist der Fall, in dem ELFIX von sich aus etwas anbietet.
pruefe("In der Saison leuchtet der Eintrag",
  /knopf\.classList\.toggle\("is-saison", saison\)/.test(RENDERER)
  && /\.home-side-link\.is-saison \{[\s\S]*?animation: wrapped-pochen/.test(CSS),
  "sonst ist er ein Punkt mehr in einer Liste, und den bemerkt niemand");
pruefe("Eingeschaltet bleibt er unauffaellig",
  !/settings\.home\?\.showReview === true[\s\S]{0,200}is-saison/.test(RENDERER),
  "wer selbst danach gegriffen hat, will nicht angesprochen werden");
pruefe("Die Jahreszahl steht daneben",
  /marke\.textContent = String\(wrappedSaisonJahr\)/.test(RENDERER),
  "Anfang Januar geht es noch um das vergangene Jahr");
pruefe("Und der Klick fuehrt in der Saison geradewegs in die Karten",
  /async function rueckblickOeffnen\(\)[\s\S]{0,400}wrappedOeffnen\(wrappedSaisonJahr\)/.test(RENDERER)
  && /action === "review"\)[\s\S]{0,60}rueckblickOeffnen\(\)/.test(RENDERER),
  "sonst liegt die Statistikseite mit Reitern und Ranglisten dazwischen");
pruefe("Geht der Rueckblick nicht auf, bleibt die Statistikseite der Rueckfall",
  /const geoeffnet = await wrappedOeffnen\(wrappedSaisonJahr\)[\s\S]{0,120}await showReview\(\)/
    .test(RENDERER),
  "ein Klick, der nichts tut, waere schlechter als einer, der woandershin fuehrt");
pruefe("Ausserhalb der Saison bleibt es die Statistikseite",
  /wrappedSaisonJahr = saison \? Number\(antwort\.jahr\) \|\| 0 : 0/.test(RENDERER),
  "wer im Juli auf Rueckblick klickt, sucht die Zahlen");
pruefe("Die Sichtbarkeit haengt an der Saison und nicht am Faelligsein",
  /saison: lage\.saison,/.test(MAIN),
  "die Saison bleibt stehen, nachdem man den Rueckblick gesehen hat - siehe oben");
pruefe("Die Sichtbarkeit wird beim Speichern der Einstellungen nachgezogen",
  (RENDERER.match(/renderRueckblickEintrag\(|wrappedLageZeigen\(/g) || []).length >= 4,
  "sonst stuende der Punkt erst nach einem Neustart richtig da");
pruefe("Startseite und Seitenleiste fragen dafuer nur einmal",
  /async function wrappedLageZeigen\(\)[\s\S]{0,260}?const antwort = await api\.getWrapped[\s\S]{0,200}?renderWrappedHinweis\(antwort\)[\s\S]{0,80}?renderRueckblickEintrag\(antwort\)/
    .test(RENDERER),
  "im Dezember waren das sonst zwei volle Auswertungen je Aufbau der Startseite");
pruefe("Die Suche in den Einstellungen findet sie",
  /\["home", "Statistik in der Seitenleiste"/.test(RENDERER));

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

/* ------------------------------------------------- Und dasselbe auf dem Telefon */
//
// Gemeldet: "das Wrapped sieht in der APK echt schlecht aus, ohne Bilder und
// so". Es stimmte. Am Rechner traegt jede Karte ein Titelbild - heruntergedimmt
// und weich, damit es die Stimmung traegt und nicht die Aussage. Auf dem
// Telefon stand ein grauer Kasten mit linksbuendigem Text, obwohl die Bilder
// laengst in derselben Auswertung stehen, aus der die Zahlen kommen.
{
  const RUECKBLICK = fs.readFileSync(
    path.join(WURZEL, "..", "android", "app", "src", "main", "java", "local", "elflix",
      "android", "Rueckblick.java"), "utf8");
  const HAUPT = fs.readFileSync(
    path.join(WURZEL, "..", "android", "app", "src", "main", "java", "local", "elflix",
      "android", "MainActivity.java"), "utf8");

  // --- Und warum jetzt gar keines mehr ---
  //
  // Erst trug jede Karte das Poster des Titels, von dem sie handelte, und die
  // Karten mit blossen Zahlen gar keines - das war unruhig. Dann trugen alle
  // dasselbe, naemlich das der Serie des Jahres - und das war schlimmer:
  //
  //   "dann weiss man ja schon was man als serie hat"
  //
  // Die Karte "Deine Serie des Jahres" ist die Pointe des ganzen Rueckblicks.
  // Ein weichgezeichnetes Poster auf Karte eins nimmt sie vorweg; wer eine
  // Serie geschaut hat, erkennt sie auch verwaschen. Das Bild war stark genug,
  // um die Stimmung zu tragen - also stark genug, um zu verraten.
  //
  // Zurueck zum ersten Zustand ist keine Loesung: der war ja der Anlass fuer
  // den zweiten. Einheitlich *und* ohne Verrat geht nur ohne Titelbild.
  pruefe("Keine Karte des Telefons traegt ein Titelbild",
    !/bildkarte/.test(RUECKBLICK)
    && !/HINTERGRUND_DECKKRAFT/.test(RUECKBLICK)
    && /private static View karte\(Context context, View\.\.\. zeilen\)/.test(RUECKBLICK),
    "die Serie des Jahres darf nicht auf Karte eins stehen");
  pruefe("Und es wird auch keines mehr geholt",
    !/Bilder\.laden\(hintergrund/.test(RUECKBLICK),
    "kein Bild, kein Ladevorgang");
  pruefe("Die Karte behaelt ihren eigenen Verlauf",
    /GradientDrawable grund = new GradientDrawable\(GradientDrawable\.Orientation\.TOP_BOTTOM/
      .test(RUECKBLICK),
    "einheitlich war ja richtig - nur nicht mit einem Poster");

  pruefe("Serie und Film des Jahres bekommen ihr Poster",
    (RUECKBLICK.match(/poster\(context, top(Serie|Film)\.optString\("titel", ""\)/g) || []).length === 2);
  pruefe("Und ohne Bild stehen dort die Anfangsbuchstaben",
    /MobileViews\.poster\(context, null, titel, bildUrl/.test(RUECKBLICK),
    "derselbe Rueckfall wie auf jeder Kachel - keine leere Flaeche");

  // --- Die Knoepfe, die man nicht immer sah ---
  //
  // Gemeldet als "buttons sind nicht immer sichtbar bei android". Das "nicht
  // immer" war der Hinweis: das Wrapped stand auf mobilePage() bzw. tvPage(),
  // und beide sind ScrollViews. Die Bedienung hing damit unten am Inhalt - bei
  // einer kurzen Karte sah man sie, bei einer langen (Mix, Monatsreihe,
  // Nebenbei-Liste) rutschte sie unter den Falz. Am Fernseher schlimmer als am
  // Telefon: dort gibt es keinen Daumen zum Schieben, nur den Fokus.
  pruefe("Die Karte fuellt, die Bedienung steht fest",
    /private LinearLayout wrappedGeruest\(\)/.test(HAUPT)
    && /rahmen\.addView\(platz, new LinearLayout\.LayoutParams\([\s\S]{0,80}?MATCH_PARENT, 0, 1\)\)/
      .test(HAUPT),
    "die Karte bekommt, was nach der Leiste uebrig bleibt - nicht umgekehrt");
  pruefe("Punkte und Knoepfe gehen in die feste Leiste",
    /addSpacing\(wrappedLeiste, Rueckblick\.punkte/.test(HAUPT)
    && /addSpacing\(wrappedLeiste, knoepfe/.test(HAUPT)
    && !/addSpacing\(wrappedPlatz, knoepfe/.test(HAUPT),
    "sonst haengen sie wieder am Inhalt und wandern mit ihm");
  pruefe("Und die Karte hat keine feste Hoehe mehr",
    !/rahmen\.setMinimumHeight\(MobileViews\.dp\(context, KARTE_HOEHE_DP\)\)/.test(RUECKBLICK),
    "auf einem kleinen Schirm schoebe sie genau die Knoepfe hinaus, um die es ging");
  pruefe("Was nicht aufgeht, rollt in der Karte",
    /ScrollView rolle = new android\.widget\.ScrollView\(context\)/.test(RUECKBLICK)
    && /rolle\.setFillViewport\(true\)/.test(RUECKBLICK),
    "fillViewport, damit eine kurze Karte trotzdem mittig steht");
  pruefe("Das Geruest raeumt auf wie die Seiten, die es ersetzt",
    /private LinearLayout wrappedGeruest\(\)[\s\S]{0,900}?bildKacheln\.clear\(\);[\s\S]{0,200}?seitenScroll = null;/
      .test(HAUPT),
    "sonst haelt die Liste die Kacheln der vorigen Seite am Leben");
  pruefe("Die Rolle nimmt dem Steuerkreuz nicht den Fokus",
    /rolle\.setFocusable\(false\)/.test(RUECKBLICK),
    "sonst haengt das Kreuz in der Karte fest, statt auf \u201eWeiter\u201c zu gehen");
  pruefe("Der Text steht mittig wie am Rechner",
    /private static void mittig\(View ansicht\)/.test(RUECKBLICK)
    && /inhalt\.setGravity\(Gravity\.CENTER\)/.test(RUECKBLICK));
  // Der Weg hinein - am Fernseher gab es ihn nicht.
  const STATISTIK_JAVA = fs.readFileSync(
    path.join(WURZEL, "..", "android", "app", "src", "main", "java", "local", "elflix",
      "android", "Statistik.java"), "utf8");
  const STARTSEITE = fs.readFileSync(
    path.join(WURZEL, "..", "android", "app", "src", "main", "java", "local", "elflix",
      "android", "Startseite.java"), "utf8");

  pruefe("Der Fernseher hat eine Reihe fuer den Rueckblick",
    /private void tvRueckblicksReihe\(LinearLayout page\)/.test(HAUPT)
    && /tvRueckblicksReihe\(page\);/.test(HAUPT));
  pruefe("Sie steht da, wenn die Einstellung an ist oder Saison ist",
    (HAUPT.match(/if \(!zeigt\(Startseite\.RUECKBLICK\) && !saison\) return;/g) || []).length === 2,
    "dieselbe Bedingung am Telefon und am Fernseher");
  pruefe("Und fuehrt geradewegs in die Karten",
    /tvRueckblicksReihe[\s\S]{0,1200}?"Ansehen", \(\) -> zeigeWrapped\(jahr\)/.test(HAUPT),
    "die Statistikseite ist eine Tabelle - die liest niemand aus drei Metern");

  pruefe("Auch das Telefon fragt die geteilte Regel nach der Reihenfolge",
    /kern\.rufe\("statistik\.wrappedReihenfolge"/.test(STATISTIK_JAVA)
    && /statistik\.wrappedReihenfolge\(schluessel, jahr, ordnung ->/.test(HAUPT),
    "eine zweite Regel hiesse: zwei Geraete erzaehlen denselben Rueckblick verschieden");
  pruefe("Dafuer sagt auch dort jede Karte, welche sie ist",
    /static final class Karte \{/.test(RUECKBLICK)
    && /static List<Karte> wrapped\(Context context, JSONObject daten, int jahr\)/.test(RUECKBLICK),
    "eine View allein kann das nicht");
  pruefe("Faellt der Aufruf aus, bleibt auch dort die gebaute Folge",
    /if \(ordnung == null \|\| ordnung\.isEmpty\(\)\) return gebaut;/.test(HAUPT));

  pruefe("Wann Saison ist, entscheidet die geteilte Regel",
    /kern\.rufe\("statistik\.wrappedJahrFuer"/.test(STATISTIK_JAVA)
    && /kern\.rufe\("statistik\.wrappedLage"/.test(STATISTIK_JAVA),
    "Android rechnet das Fenster nicht selbst nach");
  pruefe("Ausserhalb des Fensters wird nichts ausgewertet",
    /int jahr = ganzeZahl\(wert\);[\s\S]{0,200}?if \(fehler != null \|\| jahr <= 0\) \{[\s\S]{0,80}?antwort\.fertig\(0\);/
      .test(STATISTIK_JAVA),
    "elf Monate im Jahr waere die Auswertung aller Sitzungen umsonst");
  pruefe("Die Antwort wird gemerkt und nicht bei jedem Zeichnen geholt",
    /WRAPPED_SAISON_FRIST_MS/.test(HAUPT)
    && /if \(jahr == wrappedSaisonJahr\) return;/.test(HAUPT),
    "sonst baut sich die Startseite endlos selbst neu");

  pruefe("Am Fernseher traegt das Geruest den groesseren Rand",
    /int rand = dp\(fernseher \? TvViews\.SCREEN_PADDING : MobileViews\.SCREEN_PADDING\)/.test(HAUPT));
  pruefe("Und die Karte bleibt dort begrenzt",
    /fernseher \? dp\(WRAPPED_TV_BREITE_DP\) : ViewGroup\.LayoutParams\.MATCH_PARENT/.test(HAUPT),
    "ueber die ganze Breite gezogen waere sie ein Band mit einem Wort in der Mitte");
  pruefe("Mit fokussierbaren Knoepfen und Fokus auf \u201eWeiter\u201c",
    /TvViews\.hauptPillButton\(this, letzte \? "Fertig" : "Weiter", weiter\)/.test(HAUPT)
    && /vor\.post\(vor::requestFocus\)/.test(HAUPT),
    "sonst sieht man einen Knopf, den das Steuerkreuz nie erreicht");
  pruefe("Und Zurueck fuehrt dort nach Hause statt in die Tabelle",
    /if \("wrapped"\.equals\(currentScreen\)\) \{[\s\S]{0,200}?if \(isTelevision\(\)\) showHome\(\);/
      .test(HAUPT));
  pruefe("Die Einstellung sagt, dass der Dezember sie ueberstimmt",
    /Im Dezember steht der Jahresrückblick/.test(STARTSEITE),
    "sonst wundert sich jemand, warum die Reihe dasteht, obwohl der Schalter aus ist");

  pruefe("Die Ueberschrift steht nicht zweimal uebereinander",
    !/page\.addView\(MobileViews\.eyebrow\(this, "ELFIX Wrapped"\)\)/.test(HAUPT),
    "die erste Karte sagt es ohnehin - der Seitenkopf nahm ihr nur die Hoehe");

  // --- Und wo die Bilder blieben ---
  //
  // Die Karten konnten laengst eines tragen (siehe oben), nur kam nie eines an:
  // gemeldet als "wrapped sieht am Handy und am Fernseher noch ohne Bilder".
  //
  // Der Grund lag eine Ebene tiefer und war unsichtbar. Am Rechner bekommt
  // `statistik.auswerten` eine Nachschlagefunktion mitgereicht - dort laeuft
  // sie im selben Prozess wie die Favoriten. Android ruft dasselbe Modul ueber
  // den Kern, und durch diese Bruecke passt JSON, aber keine Funktion.
  // Hinueber ging also nur der Zeitraum, und jeder Titel kam ohne `bild`
  // zurueck - auf beiden Geraeten, seit es den Rueckblick dort gibt.
  pruefe("Die Auswertung nimmt den Titel-Nachschlag auch als Tabelle",
    typeof statistik.titelNachschlag === "function",
    "durch den Kern passt JSON, aber keine Funktion");
  {
    const sitzungen = [
      { id: "a", titel: "Attack on Titan", favoriteId: "hier-1", season: 1, episode: 1,
        sekunden: 1400, begonnenAm: "2026-08-14T20:00:00.000Z", qualitaet: statistik.GEMESSEN,
        gattung: "anime" },
      // Derselbe Titel, anders geschrieben, und mit der Kennung eines fremden
      // Geraets: genau der Fall, den der Abgleich seit dem Austausch erzeugt.
      { id: "b", titel: "attack on titan!", favoriteId: "fremd-9", season: 1, episode: 2,
        sekunden: 1400, begonnenAm: "2026-08-15T20:00:00.000Z", qualitaet: statistik.GEMESSEN,
        gattung: "anime" }
    ];
    const karte = [{ id: "hier-1", titel: "Attack on Titan", bild: "https://elfix.test/poster.jpg" }];
    const mitKarte = statistik.auswerten(sitzungen, { von: 0, bis: Date.now(), titelKarte: karte });
    const ohneKarte = statistik.auswerten(sitzungen, { von: 0, bis: Date.now() });

    pruefe("Damit tragen die Titel der Auswertung ein Bild",
      mitKarte.serien.every((eintrag) => eintrag.bild === "https://elfix.test/poster.jpg"),
      "das Stimmungsbild jeder Karte kommt von hier");
    pruefe("Auch der erste Titel des Jahres",
      mitKarte.erster?.bild === "https://elfix.test/poster.jpg");
    pruefe("Und zwar ueber den Titel, nicht ueber die Kennung des Favoriten",
      mitKarte.serien.length === 2,
      "eine Sitzung vom Rechner traegt eine Kennung, die es auf dem Telefon nicht gibt");
    pruefe("Ohne Tabelle rechnet sie wie vorher",
      ohneKarte.folgen === mitKarte.folgen && ohneKarte.sekunden === mitKarte.sekunden
      && ohneKarte.serien.every((eintrag) => eintrag.bild === ""),
      "die Bilder sind eine Zugabe und keine Bedingung");
  }
  pruefe("Android reicht sie mit der Auswertung hinueber",
    /optionen\.put\("titelKarte", tabelle\)/.test(STATISTIK_JAVA)
    && /public interface Titelquelle \{/.test(STATISTIK_JAVA));
  pruefe("Und sie kommt aus den Favoriten - ohne einen einzigen Abruf",
    /private JSONArray titeltabelle\(\)[\s\S]{0,900}?for \(Favorite eintrag : bestand\.alle\(\)\)/
      .test(HAUPT)
    && /statistik\.setzeTitelquelle\(this::titeltabelle\)/.test(HAUPT),
    "dieselbe Quelle, aus der die Kacheln der Startseite ihr Bild nehmen");
  pruefe("Geschluesselt wird im Kern und nicht ein zweites Mal in Java",
    !/titelSchluessel/.test(HAUPT) && /taste\.titelSchluessel\(eintrag\?\.titel\)/
      .test(fs.readFileSync(path.join(WURZEL, "src/statistik.js"), "utf8")),
    "zwei Normalisierungen sind zwei Wahrheiten");
  pruefe("Ein Fehler dabei kostet die Bilder und nicht die Zahlen",
    /catch \(Exception fehler\) \{[\s\S]{0,160}?Log\.e\(TAG, "Titeltabelle nicht lesbar", fehler\);[\s\S]{0,40}?return null;/
      .test(STATISTIK_JAVA));
}

// --- Die Buehne am Rechner ---------------------------------------------------
//
// Gemeldet als "am PC bisschen Hintergrund rein, sieht so leer aus". Es stimmte:
// die Buehne war die flache Hintergrundfarbe, in der Mitte drei Zeilen Text,
// ringsum nichts. Am Telefon faellt das nicht auf - dort ist der Schirm so gross
// wie die Karte. An einem Bildschirm mit 27 Zoll sind achtzig Prozent der
// Flaeche schlicht unbenutzt, und die Seiten ohne Titelbild - der Mix, die
// Streak, die Nebenbei-Liste - hatten ueberhaupt keinen Hintergrund.

pruefe("Die Buehne traegt einen Verlauf statt einer flachen Farbe",
  /\.wrapped-modal \{[\s\S]{0,900}?background:\s*\n?\s*radial-gradient\([^;]*rgba\(var\(--accent-rgb\)[^;]*var\(--bg-app\);/
    .test(CSS),
  "derselbe Aufbau wie auf der Startseite von ELFIX");
pruefe("Und ein Licht, das sich bewegt",
  /\.wrapped-stage::before \{[\s\S]*?animation: wrapped-schweben/.test(CSS)
  && /@keyframes wrapped-schweben/.test(CSS),
  "auch die Seiten ohne Titelbild sollen einen Hintergrund haben");
pruefe("Langsam genug, dass es vom Text nicht ablenkt",
  Number((CSS.match(/animation: wrapped-schweben (\d+)s/) || [])[1]) >= 20,
  "schneller waere es eine Animation, die den Blick von der Zahl holt");
pruefe("Wer keine Bewegung will, bekommt auch hier keine",
  /animations-off[\s\S]{0,400}?\.wrapped-stage::before/.test(CSS)
  && /prefers-reduced-motion[\s\S]{0,400}?\.wrapped-stage::before/.test(CSS));
pruefe("Die Vignette liegt unter dem Text und nicht darueber",
  /\.wrapped-content \{[\s\S]{0,200}?z-index: 3;/.test(CSS)
  && /\.wrapped-stage::after \{[\s\S]{0,400}?z-index: 2;/.test(CSS),
  "sonst legt sie sich an den Raendern ueber die Fussnote");

// --- Jedes Jahr eine andere Folge ------------------------------------------
//
// Gemeldet als "und jedes jahr andere sachen zeigen beim wrapped". Bis hierher
// bauten beide Geraete ihre Karten in der Reihenfolge, in der sie im Quelltext
// stehen - und zeigten sie auch so. Damit sah 2027 aus wie 2026 und 2026 wie
// 2025: dieselben Karten, dieselbe Folge, nur andere Zahlen darauf.
//
// Zwei Eigenschaften muessen zugleich gelten, und sie widersprechen sich fast:
// verschieden von Jahr zu Jahr, und innerhalb eines Jahres immer gleich. Ohne
// die zweite koennte man niemandem zeigen, was man gerade gesehen hat.
{
  const alle = statistik.WRAPPED_KARTEN;

  pruefe("Ein Jahr sieht immer gleich aus",
    statistik.wrappedReihenfolge(alle, 2026).join() === statistik.wrappedReihenfolge(alle, 2026).join(),
    "sonst koennte man niemandem zeigen, was man gerade gesehen hat");
  pruefe("Zwei Jahre sehen verschieden aus",
    statistik.wrappedReihenfolge(alle, 2026).join() !== statistik.wrappedReihenfolge(alle, 2027).join());

  // Der Rahmen bleibt: der Auftakt eroeffnet, das Finale schliesst, und Zeit
  // und Folgen stehen gleich danach - sie setzen den Massstab. Ein Rueckblick,
  // der mit "Montag war dein Tag" anfaengt, bevor er gesagt hat, wie viel
  // ueberhaupt lief, erzaehlt die Pointe vor dem Witz.
  let verstoesse = 0;
  let ohneGesetzte = 0;
  let laengen = new Set();
  for (let jahr = 2000; jahr < 2200; jahr += 1) {
    const r = statistik.wrappedReihenfolge(alle, jahr);
    if (r[0] !== "auftakt" || r[r.length - 1] !== "finale") verstoesse += 1;
    if (r[1] !== "zeit" || r[2] !== "folgen") verstoesse += 1;
    if (!r.includes("top-serie") || !r.includes("top-film")) ohneGesetzte += 1;
    if (new Set(r).size !== r.length) verstoesse += 1;
    laengen.add(r.length);
  }
  pruefe("Der Rahmen steht in jedem Jahr", verstoesse === 0,
    "Auftakt, Zeit, Folgen vorn - Finale hinten, und keine Karte doppelt");
  pruefe("Serie und Film des Jahres fallen nie weg", ohneGesetzte === 0,
    "sie sind der Grund, warum jemand den Rueckblick ueberhaupt aufmacht");
  pruefe("Und es sind jedes Jahr gleich viele", laengen.size === 1,
    `sonst waere ein Jahr laenger als das andere - ${[...laengen].join("/")}`);

  // Gekuerzt wird nur, wo es mehr Kandidaten gibt als Plaetze. Wer wenig
  // geschaut hat, verliert nichts.
  const wenig = ["auftakt", "zeit", "folgen", "top-serie", "genre", "streak", "finale"];
  pruefe("Wer wenig hat, verliert nichts",
    statistik.wrappedReihenfolge(wenig, 2026).length === wenig.length);
  pruefe("Wer viel hat, sieht eine Auswahl",
    statistik.wrappedReihenfolge(alle, 2026).length < alle.length,
    "acht von dreizehn sind eine Auswahl, dreizehn von dreizehn sind eine Liste");

  // Und die Ordnung haelt, waehrend das Jahr laeuft. Gemischt wird die ganze
  // Liste und erst danach auf das Vorhandene gekuerzt - wuerde nur das
  // Vorhandene gemischt, saehe der Rueckblick nach jeder neuen Folge anders
  // aus, weil eine Karte mehr im Topf alles neu wirft.
  const mehr = [...wenig, "mix", "rewatch", "monat"];
  const vorher = statistik.wrappedReihenfolge(wenig, 2026);
  const nachher = statistik.wrappedReihenfolge(mehr, 2026).filter((k) => wenig.includes(k));
  pruefe("Eine Karte, die im Laufe des Jahres dazukommt, wirft nichts um",
    vorher.join() === nachher.join(),
    "sonst saehe der Rueckblick nach jeder neuen Folge anders aus");

  pruefe("Erfunden wird dabei nichts",
    statistik.wrappedReihenfolge(wenig, 2026).every((k) => wenig.includes(k)),
    "die Regel darf kuerzen und ordnen - nicht hinzufuegen");
  pruefe("Ohne Karten keine Reihenfolge",
    statistik.wrappedReihenfolge([], 2026).length === 0
    && statistik.wrappedReihenfolge(null, 2026).length === 0);
}

// Und beide Geraete fragen dieselbe Regel - eine zweite waere die Sorte
// Unterschied, die man erst bemerkt, wenn zwei Geraete denselben Rueckblick
// verschieden erzaehlen.
pruefe("Der Rechner holt die Reihenfolge aus dem Kern",
  /ipcMain\.handle\("wrapped:reihenfolge"[\s\S]{0,140}?statistik\.wrappedReihenfolge/.test(MAIN)
  && /async function wrappedSortieren\(seiten, jahr\)/.test(RENDERER)
  && /wrappedSeiten = await wrappedSortieren\(wrappedBauen\(/.test(RENDERER));
pruefe("Und jede Karte sagt, welche sie ist",
  /function wrappedSeite\(schluessel, art, teile/.test(RENDERER)
  && /return \{ schluessel, art, knoten \};/.test(RENDERER),
  "zwei Karten teilen sich dieselbe Art - is-top und is-tag gibt es je zweimal");
pruefe("Faellt die Regel aus, bleibt die gebaute Folge",
  /if \(!Array\.isArray\(ordnung\) \|\| !ordnung\.length\) return seiten;/.test(RENDERER),
  "immer dieselbe Folge ist schlechter als eine wechselnde, aber besser als keine");

// --- Ein Hintergrund, der nichts verraet ------------------------------------
//
// Zwei Anlaeufe, beide falsch. Erst trug jede Karte das Poster des Titels, von
// dem sie handelte - unruhig, gemeldet als "background sieht immer
// unterschiedlich aus". Dann trugen alle dasselbe, das der Serie des Jahres -
// einheitlich, aber: "dann weiss man ja schon was man als serie hat".
//
// Die Karte "Deine Serie des Jahres" ist die Pointe. Einheitlich *und* ohne
// Verrat geht nur ohne Titelbild: die Buehne traegt ihren eigenen Verlauf, und
// der ist auf jeder Karte derselbe.

pruefe("Keine Karte traegt ein Titelbild",
  !/wrappedStimmungsbild/.test(RENDERER)
  && !/wrapped-backdrop/.test(RENDERER)
  && /function wrappedSeite\(schluessel, art, teile\) \{/.test(RENDERER),
  "die Serie des Jahres darf nicht auf Karte eins stehen");
pruefe("Auch nicht ueber das Stylesheet",
  !/wrapped-backdrop/.test(CSS) && !/wrapped-heranziehen/.test(CSS),
  "eine Regel ohne Element ist eine Falle fuer den naechsten");
pruefe("Die Buehne bleibt trotzdem auf jeder Karte dieselbe",
  /\.wrapped-stage::before \{[\s\S]*?animation: wrapped-schweben/.test(CSS)
  && /\.wrapped-card::after \{/.test(CSS),
  "einheitlich war ja richtig - nur nicht mit einem Poster");
pruefe("Und die Poster stehen weiter auf den Karten, die von einem Titel handeln",
  (RENDERER.match(/wrappedPoster\(/g) || []).length >= 4,
  "dort fallen sie auf, ohne etwas vorwegzunehmen");

// --- Musik zur Serie des Jahres ---------------------------------------------
//
// Der Rueckblick war stumm. Geholt wird das Opening jetzt bei animethemes.moe -
// nur fuer Anime, denn nur dafuer gibt es so einen Katalog.
//
// Der Punkt, an dem es leicht schiefgegangen waere: **ab wann sie laeuft.** Das
// Titelbild musste weichen, weil es die Serie des Jahres auf Karte eins
// verriet - und Musik verraet dieselbe Pointe, nur akustisch. Wer sein
// Lieblings-Opening nach zwei Takten erkennt, braucht die Karte nicht mehr.

pruefe("Die Musik faengt erst auf der Karte an, die die Serie zeigt",
  /if \(wrappedTonLaeuft \|\| seite\?\.schluessel !== "top-serie"\) return;/.test(RENDERER),
  "sonst verraet der Ton, was das Bild nicht mehr verraet");
pruefe("Und laeuft dann weiter, statt beim Blaettern abzubrechen",
  /if \(wrappedTonLaeuft/.test(RENDERER) && /ton\.loop = true;/.test(RENDERER));
pruefe("Gefragt wird nur bei Anime",
  /String\(gattung \|\| ""\) !== "anime"\) return null;/.test(MAIN),
  "fuer Serien und Filme gibt es keinen solchen Katalog");
pruefe("Die Einstellung verhindert schon die Anfrage",
  /if \(settings\.wrapped\?\.musik === false\) return;/.test(RENDERER),
  "wer sie aus hat, soll auch keinen fremden Dienst befragen");
pruefe("Schliessen beendet den Ton",
  /function wrappedSchliessen\(\) \{\s*\n\s*wrappedTonBeenden\(\);/.test(RENDERER));
pruefe("Der Knopf blaettert nicht zugleich weiter",
  /wrappedTonKnopf"\)\?\.addEventListener\("click", \(event\) => \{[\s\S]{0,220}?event\.stopPropagation\(\);/
    .test(RENDERER),
  "die Buehne horcht auf jeden Klick");

// Und die Vorsicht gegenueber einem fremden Dienst.
pruefe("Die Anfrage hat ein Zeitlimit",
  /AbortSignal\.timeout\(OPENING_FRIST_MS\)/.test(MAIN),
  "ein Rueckblick darf nicht warten, bis jemand anderes antwortet");
pruefe("Und ein Gedaechtnis, auch fuer das Nichtergebnis",
  /openingCache\.has\(name\)/.test(MAIN) && /openingCache\.set\(name, gefunden\)/.test(MAIN),
  "einen oeffentlichen Dienst im Sekundentakt zu fragen sperrt einen zu Recht aus");
pruefe("Jeder Fehler endet als Stille",
  /ipcMain\.handle\("wrapped:opening"[\s\S]{0,160}?catch\(\(\) => null\)/.test(MAIN),
  "kein Netz, kein Treffer, unerwartete Antwort - alles dasselbe Ergebnis");
pruefe("Gelesen wird die Antwort in einem Modul ohne Netz",
  /const openings = require\("\.\/openings"\);/.test(MAIN),
  "sonst liesse sich das Lesen nicht ohne die Schnittstelle pruefen");

// --- Und der Hinweis, den man uebersah ---------------------------------------

pruefe("Der Hinweis auf der Startseite faellt auf",
  /\.wrapped-hinweis \{[\s\S]*?border: 1px solid rgba\(var\(--accent-rgb\)/.test(CSS)
  && /\.wrapped-hinweis::before \{[\s\S]*?animation: wrapped-schimmer/.test(CSS),
  "als schmale Zeile sah er aus wie jede andere Karte und wurde ueberscrollt");
pruefe("Er bleibt trotzdem ein Banner und wird kein Fenster",
  /<div class="wrapped-hinweis is-hidden" id="wrappedHinweis">/.test(HTML),
  "auffallen heisst gross und hell, nicht ungefragt im Weg");
pruefe("Er sagt, warum er da ist",
  /anlass\.textContent = "Nur im Dezember"/.test(RENDERER),
  "sonst fragt man sich beim zweiten Mal, ob das jetzt so bleibt");
pruefe("Und er nennt eine Zahl statt einer Aufforderung",
  /function wrappedHinweisZeile\(daten, jahr\)/.test(RENDERER)
  && /daten\?\.sekundenBekannt > 0 && daten\?\.sekunden > 0/.test(RENDERER),
  "eine Aufforderung kann jeder schreiben, die Zahl kann nur ELFIX");

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
