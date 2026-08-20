"use strict";
// Die Statistikbasis: Wiedergabezeit, Sitzungen, Auswertung, Migration.
//
// Der ganze Sinn dieser Datenbasis ist, dass ihre Zahlen in einem Jahr noch
// stimmen. Dann kann sie niemand mehr nachrechnen - eine zu hohe Stundenzahl
// faellt nicht auf, sie steht einfach da. Deshalb liegt der Schwerpunkt hier
// nicht darauf, dass gezaehlt wird, sondern darauf, dass **nicht** gezaehlt
// wird, wo nichts war: Pause, Sprung, Schlaf, doppelte Meldungen, und vor allem
// alte Daten, zu denen es nie eine Messung gab.
//
// Gepruefte Faelle (die Liste aus dem Auftrag):
// normale Wiedergabe, Pause, Sprung vor, Sprung zurueck, Folgenwechsel,
// Serienwechsel, Anbieterwechsel, App zu waehrend der Wiedergabe, Absturz,
// erneute Wiedergabe, abgeschlossene Folge erneut geoeffnet, Hintergrund,
// Ruhezustand, haengender Player, sehr kurze Wiedergabe, mehrere Sitzungen
// derselben Folge, mehrere Folgen hintereinander, Tageswechsel, alte Daten ohne
// Zeit, Titel ohne Genres.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const statistik = require("../src/statistik.js");

const WURZEL = path.join(__dirname, "..");
const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").replace(/\r/g, "");
const RENDERER = fs.readFileSync(path.join(WURZEL, "src/renderer/renderer.js"), "utf8").replace(/\r/g, "");
const PRELOAD = fs.readFileSync(path.join(WURZEL, "src/preload.js"), "utf8").replace(/\r/g, "");

const pruefungen = [];
const pruefe = (name, bedingung, detail) => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

function abschnitt(anfang, ende = "}") {
  const zeilen = MAIN.split("\n");
  const von = zeilen.findIndex((z) => z.startsWith(anfang));
  if (von < 0) throw new Error("nicht gefunden: " + anfang);
  let bis = von;
  while (bis < zeilen.length && zeilen[bis] !== ende) bis += 1;
  return zeilen.slice(von, bis + 1).join("\n");
}

// --- Ein Player, den man steuern kann ---------------------------------------
// Der Takt in der Anbieterseite meldet alle paar Sekunden die kumulativ
// gemessene Zeit. Genau das wird hier nachgestellt - inklusive der Faelle, in
// denen die Zeit gerade *nicht* weiterlaeuft.

function abspieler(grunddaten, start = Date.parse("2026-08-21T20:00:00.000Z")) {
  const zustand = { uhr: start, position: 0, gemessen: 0, offen: null, fertig: [] };
  const melden = (zusatz = {}) => {
    const ergebnis = statistik.meldungEinarbeiten(zustand.offen, {
      ...grunddaten, ...zusatz,
      sekunden: zustand.gemessen,
      position: zustand.position
    }, zustand.uhr);
    if (ergebnis.geschlossen) zustand.fertig.push(ergebnis.geschlossen);
    zustand.offen = ergebnis.offen;
  };
  return {
    zustand,
    // Wiedergabe: Position und gemessene Zeit laufen gemeinsam weiter.
    spielen(sekunden, zusatz) {
      for (let i = 0; i < sekunden; i += 5) {
        zustand.uhr += 5000; zustand.position += 5; zustand.gemessen += 5;
        melden(zusatz);
      }
      return this;
    },
    // Pause: der Takt meldet weiter, aber nichts bewegt sich.
    pausieren(sekunden) {
      for (let i = 0; i < sekunden; i += 5) { zustand.uhr += 5000; melden(); }
      return this;
    },
    // Sprung: die Position springt, die gemessene Zeit nicht - so wie es der
    // Zaehler in der Seite haelt.
    springen(sekunden) { zustand.position = Math.max(0, zustand.position + sekunden); return this; },
    // Ruhezustand oder zugeklappter Deckel: lange Stille, dann meldet sich der
    // Takt wieder, ohne dass sich etwas bewegt haette.
    schlafen(sekunden) { zustand.uhr += sekunden * 1000; melden(); return this; },
    // Neu geladen: der Zaehler in der Seite faengt wieder bei null an.
    neuLaden() { zustand.gemessen = 0; zustand.position = 0; return this; },
    wechseln(zusatz) { melden(zusatz); return this; },
    schliessen() {
      if (zustand.offen) zustand.fertig.push(statistik.sitzungSchliessen(zustand.offen));
      zustand.offen = null;
      return zustand.fertig.filter(Boolean);
    },
    sitzungen: () => zustand.fertig.filter(Boolean),
    laufend: () => zustand.offen
  };
}

const FOLGE1 = { url: "https://s.to/serie/loki/s1/e1", favoriteId: "loki", titel: "Loki", providerName: "S.to", type: "serie", season: 1, episode: 1, laufzeit: 1440 };
const FOLGE2 = { ...FOLGE1, url: "https://s.to/serie/loki/s1/e2", episode: 2 };

// --- Wiedergabezeit ----------------------------------------------------------

{
  const p = abspieler(FOLGE1);
  p.spielen(300).pausieren(600).spielen(420).springen(480).spielen(120);
  const [sitzung] = p.schliessen();
  pruefe("Normale Wiedergabe, Pause, Sprung vor: nur echt Abgespieltes zaehlt",
    Math.abs(sitzung.sekunden - 840) <= 10,
    `${sitzung.sekunden}s statt rund 840s (5+7+2 Minuten) - die Folge dauert 1440s`);
  pruefe("Die Pause traegt nichts bei",
    sitzung.sekunden < 900,
    "zehn Minuten Pause duerften sonst als Wiedergabe dastehen");
  pruefe("Der Sprung nach vorn traegt nichts bei",
    sitzung.sekunden < 900 && sitzung.endPosition > 1300,
    `Position ${sitzung.endPosition}s, Zeit ${sitzung.sekunden}s - die Position ist weiter als die Zeit`);
}

{
  const p = abspieler(FOLGE1);
  p.spielen(600).springen(-500).spielen(120);
  const [sitzung] = p.schliessen();
  pruefe("Ein Sprung zurueck erzeugt keine Zeit",
    Math.abs(sitzung.sekunden - 720) <= 10,
    `${sitzung.sekunden}s - zurueckspringen ist kein Schauen`);
}

{
  const p = abspieler(FOLGE1);
  p.spielen(300).schlafen(3600).spielen(60);
  const sitzungen = p.schliessen();
  const summe = sitzungen.reduce((a, s) => a + s.sekunden, 0);
  pruefe("Eine Stunde Ruhezustand erzeugt keine Stunde Wiedergabe",
    summe < 400,
    `${summe}s insgesamt - erwartet rund 360s`);
  pruefe("Nach langer Stille beginnt eine neue Sitzung",
    sitzungen.length === 2,
    `${sitzungen.length} Sitzungen - wer stundenlang pausiert, schaut zweimal`);
}

{
  const p = abspieler(FOLGE1);
  p.spielen(120);
  // Ein haengender Player meldet immer denselben Stand.
  for (let i = 0; i < 20; i += 1) p.pausieren(5);
  const [sitzung] = p.schliessen();
  pruefe("Ein haengender Player laesst die Zeit nicht wachsen",
    Math.abs(sitzung.sekunden - 120) <= 10,
    `${sitzung.sekunden}s`);
}

{
  const p = abspieler(FOLGE1);
  p.spielen(60);
  const vorher = p.laufend().sekunden;
  p.wechseln(); p.wechseln(); p.wechseln();
  pruefe("Dieselbe Meldung mehrfach aendert nichts",
    p.laufend().sekunden === vorher,
    "doppelte Ereignisse duerfen die Zeit nicht vervielfachen");
}

// --- Sitzungsgrenzen ---------------------------------------------------------

{
  const p = abspieler(FOLGE1);
  p.spielen(600);
  // Eine neue Folge heisst eine neu geladene Seite: der Zaehler dort faengt
  // wieder bei null an. Alles andere waere ein Pruefstand, der die App nicht
  // abbildet.
  p.neuLaden();
  p.spielen(600, FOLGE2);
  const sitzungen = p.schliessen();
  pruefe("Ein Folgenwechsel schliesst die Sitzung und beginnt eine neue",
    sitzungen.length === 2 && sitzungen[0].episode === 1 && sitzungen[1].episode === 2,
    sitzungen.map((s) => `E${s.episode}:${s.sekunden}s`).join(" "));
  pruefe("Beide Sitzungen tragen ihre eigene Zeit",
    sitzungen.every((s) => Math.abs(s.sekunden - 600) <= 10),
    sitzungen.map((s) => s.sekunden + "s").join(" "));
}

{
  const p = abspieler(FOLGE1);
  p.spielen(300).neuLaden().spielen(200);
  const sitzungen = p.schliessen();
  pruefe("Ein Neuladen derselben Folge ist eine zweite Sitzung",
    sitzungen.length === 2,
    "der Zaehler der Seite faengt neu an - das ist ein zweites Anschauen");
  pruefe("Dabei geht die erste Sitzung nicht verloren",
    Math.abs(sitzungen[0].sekunden - 300) <= 10 && Math.abs(sitzungen[1].sekunden - 200) <= 10,
    sitzungen.map((s) => s.sekunden + "s").join(" "));
}

{
  // ELFIX startet neu, waehrend die Seite schon laenger laeuft: der Zaehler
  // steht bereits bei 400 Sekunden, die aber nicht zu dieser Sitzung gehoeren.
  let offen = null;
  const jetzt = Date.parse("2026-08-21T21:00:00.000Z");
  offen = statistik.meldungEinarbeiten(offen, { ...FOLGE1, sekunden: 400, position: 400 }, jetzt).offen;
  offen = statistik.meldungEinarbeiten(offen, { ...FOLGE1, sekunden: 460, position: 460 }, jetzt + 60000).offen;
  const sitzung = statistik.sitzungSchliessen(offen);
  pruefe("Was vor dem Beginn der Sitzung gemessen wurde, zaehlt nicht zu ihr",
    sitzung.sekunden === 60,
    `${sitzung.sekunden}s statt 60s - sonst zaehlte ein Neustart 400 Sekunden doppelt`);
}

{
  const p = abspieler(FOLGE1);
  p.spielen(15);
  const sitzung = statistik.sitzungSchliessen(p.laufend());
  pruefe("Sehr kurze Wiedergabe wird gespeichert, aber",
    statistik.sitzungLohnt(sitzung));
  const winzig = statistik.sitzungSchliessen(abspieler(FOLGE1).spielen(0).laufend()
    || { sekunden: 0, abgeschlossen: false });
  pruefe("eine Sitzung ohne jede Wiedergabe lohnt nicht",
    !statistik.sitzungLohnt(winzig),
    "sonst fuellte jedes Durchklicken die Ablage");
}

// --- Auswerten ---------------------------------------------------------------

const zeit = (tag, stunde = 20, minute = 0) =>
  new Date(2026, 7, tag, stunde, minute).toISOString();

function satz(zusatz = {}) {
  return {
    id: `s${Math.random()}`, favoriteId: "loki", url: "u", titel: "Loki",
    anbieter: "S.to", gattung: "serie", season: 1, episode: 1,
    begonnenAm: zeit(10), beendetAm: zeit(10, 20, 25), sekunden: 1500,
    abgeschlossen: true, wiederholung: false, qualitaet: statistik.GEMESSEN,
    ...zusatz
  };
}

const GENRES = { genres: [{ key: "action", label: "Action" }, { key: "drama", label: "Drama" }] };
const info = () => GENRES;

{
  const d = statistik.auswerten([
    satz({ episode: 1, begonnenAm: zeit(10, 20, 0), beendetAm: zeit(10, 20, 25) }),
    satz({ episode: 2, begonnenAm: zeit(10, 20, 30), beendetAm: zeit(10, 20, 55) }),
    satz({ episode: 3, begonnenAm: zeit(11, 20, 0), beendetAm: zeit(11, 20, 25) })
  ], { titel: info, heute: "2026-08-11" });
  pruefe("Mehrere Folgen hintereinander ergeben eine Sitzung",
    d.laengsteSitzung === 3000,
    `${d.laengsteSitzung}s - zwei Folgen am selben Abend, die dritte am naechsten Tag`);
  pruefe("Die Zeit wird vollstaendig gezaehlt", d.sekunden === 4500);
  pruefe("Folgen zaehlen einzeln", d.folgen === 3);
  pruefe("Schautage zaehlen Tage, nicht Folgen", d.tage === 2);
  pruefe("Die Genre-Zeit wird anteilig verteilt",
    d.genres.length === 2 && d.genres[0].sekunden === 2250 && d.genres[1].sekunden === 2250,
    `${d.genres.map((g) => g.label + ":" + g.sekunden).join(" ")} - zusammen 4500, nicht 9000`);
  pruefe("Die Summe ueber die Genres uebersteigt die Watchtime nicht",
    d.genres.reduce((a, g) => a + g.sekunden, 0) <= d.sekunden,
    "sonst waechst die Gesamtzeit mit jedem zusaetzlichen Genre");
}

{
  const d = statistik.auswerten([
    satz({ episode: 1, begonnenAm: zeit(1) }),
    satz({ episode: 1, begonnenAm: zeit(2), wiederholung: true }),
    satz({ episode: 1, begonnenAm: zeit(3), wiederholung: true })
  ], { titel: info, heute: "2026-08-03" });
  pruefe("Dieselbe Folge mehrfach gesehen bleibt eine Folge",
    d.folgen === 1,
    `${d.folgen} - sonst stuenden mehr Folgen da, als es gibt`);
  pruefe("Die Wiederholungen werden eigens gezaehlt", d.wiederholungen === 2);
  pruefe("Ihre Zeit zaehlt trotzdem mit",
    d.sekunden === 4500,
    "gesehen wurde sie ja");
  pruefe("Der meistwiederholte Titel steht fest",
    d.wiederholteste[0]?.titel === "Loki" && d.wiederholteste[0].wiederholungen === 2);
}

{
  const d = statistik.auswerten([
    satz({ begonnenAm: zeit(1) }), satz({ begonnenAm: zeit(2) }), satz({ begonnenAm: zeit(3) }),
    satz({ begonnenAm: zeit(6) }), satz({ begonnenAm: zeit(7) })
  ], { titel: info, heute: "2026-08-07" });
  pruefe("Die laengste Strecke bricht an der Luecke ab",
    d.strecke.tage === 3 && d.strecke.von === "2026-08-01",
    JSON.stringify(d.strecke));
  pruefe("Die laufende Strecke reicht bis heute", d.laufendeStrecke === 2);
  const gestern = statistik.auswerten([satz({ begonnenAm: zeit(6) })], { titel: info, heute: "2026-08-07" });
  pruefe("Sie bleibt stehen, wenn heute noch nichts lief",
    gestern.laufendeStrecke === 1,
    "sonst waere die Strecke jeden Morgen weg");
  const vorgestern = statistik.auswerten([satz({ begonnenAm: zeit(5) })], { titel: info, heute: "2026-08-07" });
  pruefe("Nach einem ganzen Tag Pause ist sie vorbei", vorgestern.laufendeStrecke === 0);
}

{
  // Tageswechsel waehrend der Wiedergabe: die Sitzung zaehlt zu dem Tag, an dem
  // sie begonnen hat - sonst zerfiele ein Abend in zwei halbe.
  const d = statistik.auswerten([
    satz({ begonnenAm: new Date(2026, 7, 10, 23, 40).toISOString(), beendetAm: new Date(2026, 7, 11, 0, 20).toISOString() })
  ], { titel: info, heute: "2026-08-11" });
  pruefe("Eine Sitzung ueber Mitternacht zaehlt zu ihrem Anfangstag",
    d.tage === 1 && d.verlauf[0].tag === "2026-08-10",
    JSON.stringify(d.verlauf.map((v) => v.tag)));
}

// --- Alte Daten ohne Zeit ----------------------------------------------------

{
  const d = statistik.auswerten([
    satz({ episode: 1, sekunden: 0, qualitaet: statistik.REKONSTRUIERT, begonnenAm: zeit(1) }),
    satz({ episode: 2, sekunden: 0, qualitaet: statistik.REKONSTRUIERT, begonnenAm: zeit(2) })
  ], { titel: info, heute: "2026-08-02" });
  pruefe("Aus alten Abschluessen entsteht keine Wiedergabezeit",
    d.sekunden === 0 && d.sekundenBekannt === 0,
    "eine Folge mit 24 Minuten Laufzeit ist keine 24 Minuten Wiedergabe");
  pruefe("Die Seite kann erkennen, dass nichts gemessen wurde",
    d.sekundenGesamt === 2 && d.sekundenBekannt === 0,
    "0 von 2 - daran haengt, ob eine Stundenkarte gezeigt wird");
  pruefe("Folgen und Abschluesse sind trotzdem belegt",
    d.folgen === 2 && d.folgenAbgeschlossen === 2);
  pruefe("Und die Tage ebenso",
    d.tage === 2 && d.strecke.tage === 2,
    "dass an diesen Tagen geschaut wurde, steht fest - nur nicht wie lange");
}

{
  const gemischt = statistik.auswerten([
    satz({ episode: 1, sekunden: 0, qualitaet: statistik.REKONSTRUIERT, begonnenAm: zeit(1) }),
    satz({ episode: 2, sekunden: 1500, begonnenAm: zeit(2) })
  ], { titel: info, heute: "2026-08-02" });
  pruefe("Gemischte Daten zaehlen nur die gemessene Zeit",
    gemischt.sekunden === 1500 && gemischt.sekundenBekannt === 1 && gemischt.sekundenGesamt === 2,
    `${gemischt.sekunden}s aus ${gemischt.sekundenBekannt}/${gemischt.sekundenGesamt}`);
}

{
  const ohne = statistik.auswerten([satz({})], { titel: () => ({}), heute: "2026-08-10" });
  pruefe("Ein Titel ohne Genres bringt nichts zum Absturz",
    ohne.genres.length === 0 && ohne.folgen === 1);
  pruefe("Ohne Sitzungen kommt eine leere Bilanz zurueck",
    statistik.auswerten([], {}).folgen === 0);
}

// --- Migration ---------------------------------------------------------------

const umgebung = { statistik, console, Date, Number, String, Boolean, Array, Object, Set, Map, Math, JSON };
vm.createContext(umgebung);
vm.runInContext(abschnitt("function sitzungenAusAltdaten("), umgebung);
const ausAlt = vm.runInContext("sitzungenAusAltdaten", umgebung);

{
  const alt = ausAlt([{
    id: "a", title: "Loki", providerName: "S.to", type: "serie", url: "https://s.to/serie/loki",
    completed: true, completedAt: zeit(5),
    completedEpisodes: [{ key: "loki:s1:e1", season: 1, episode: 1, url: "u1", completedAt: zeit(3) }],
    activity: [
      { at: zeit(3), label: "Staffel 1 Folge 1", season: 1, episode: 1 },
      { at: zeit(4), label: "Staffel 1 Folge 2", season: 1, episode: 2 },
      { at: zeit(4), label: "Geöffnet", season: 1, episode: 2 },
      { at: zeit(5), label: "Abgeschlossen", season: 1, episode: 2 }
    ]
  }]);
  pruefe("Uebernommen wird ohne jede Wiedergabezeit",
    alt.every((eintrag) => eintrag.sekunden === 0),
    "das ist der Kern: kein Hochrechnen");
  pruefe("und ausdruecklich als rekonstruiert gekennzeichnet",
    alt.every((eintrag) => eintrag.qualitaet === statistik.REKONSTRUIERT));
  pruefe("\"Geöffnet\" wird nicht uebernommen",
    alt.length === 2,
    `${alt.length} Saetze - erwartet 2 (Folge 1 aus dem Abschluss, Folge 2 aus dem Verlauf)`);
  pruefe("Eine Folge steht nicht doppelt drin",
    new Set(alt.map((e) => `${e.season}:${e.episode}`)).size === alt.length,
    "der Abschluss von Folge 1 und ihre Verlaufszeile sind dieselbe Folge");
  pruefe("Der Abschluss bleibt erhalten",
    alt.find((e) => e.episode === 1)?.abgeschlossen === true);
}

{
  const film = ausAlt([{
    id: "f", title: "Spider-Man", providerName: "Filmo", type: "film",
    url: "https://filmo.to/film/spiderman", completed: true, completedAt: zeit(6),
    completedEpisodes: [],
    activity: [{ at: zeit(6), label: "Film geöffnet", season: 0, episode: 0 }]
  }]);
  pruefe("Ein abgeschlossener Film wird uebernommen, obwohl sein Verlauf nur \"geöffnet\" kennt",
    film.length === 1 && film[0].abgeschlossen && film[0].gattung === "film",
    "ohne diesen Zweig fehlten saemtliche Filme in der Bilanz");
}

{
  pruefe("Aniworld gilt als Anime",
    statistik.gattungBestimmen({ type: "serie", providerName: "Aniworld", url: "https://aniworld.to/anime/x" }) === "anime");
  pruefe("Ein Film bleibt ein Film, auch bei Aniworld",
    statistik.gattungBestimmen({ type: "film", providerName: "Aniworld" }) === "film",
    "die Gattung Film schlaegt jedes Anzeichen fuer Anime");
  pruefe("Eine gewoehnliche Serie bleibt Serie",
    statistik.gattungBestimmen({ type: "serie", providerName: "S.to", url: "https://s.to/serie/loki" }) === "serie");
  pruefe("Der bestehende Typ an den Favoriten wird nicht angefasst",
    /if \(type === "serie" \|\| type === "series" \|\| type === "anime"\) return "serie";/.test(MAIN),
    "Mediathek, Empfehlungen und Fortschritt haengen daran");
}

// --- Anbindung ---------------------------------------------------------------

pruefe("Die gemessene Zeit wird bei jedem Takt gemeldet",
  /sitzungMelden\(provider, url, entry, progress\);/.test(MAIN));
pruefe("Sie stammt aus dem vorhandenen Messwert der Seite",
  /sekunden: Number\(progress\?\.playedSeconds\) \|\| 0/.test(MAIN),
  "playedSeconds gab es schon - es wurde nur nie gespeichert");
pruefe("Beim Beenden der App wird offen Stehendes geschlossen",
  /sitzungenSchliessen\(\);/.test(MAIN));
pruefe("Beim Anbieterwechsel ebenso",
  /sitzungenSchliessen\(providerId\);/.test(MAIN));
pruefe("Die laufende Sitzung wird regelmaessig gesichert",
  /jetzt - sitzungenZuletztGespeichert >= SITZUNG_SICHERN_MS/.test(MAIN),
  "ein Absturz kostet damit hoechstens eine halbe Minute");
pruefe("Sitzungen liegen in einer eigenen Datei",
  /const SESSION_FILE = path\.join\(DATA_DIR, "sitzungen\.json"\)/.test(MAIN),
  "der Verlauf an den Favoriten ist auf 120 Eintraege gekappt");
pruefe("Die Migration laeuft einmalig",
  /if \(settings\.migrations\?\.sitzungen === true\) return 0;/.test(MAIN)
  && /settings\.migrations = \{ \.\.\.\(settings\.migrations \|\| \{\}\), sitzungen: true \};/.test(MAIN));
pruefe("Der Merker ueberlebt das Speichern der Einstellungen",
  /sitzungen: raw\?\.migrations\?\.sitzungen === true/.test(MAIN));
pruefe("Die Auswertung loest keine Abrufe aus",
  /loadTasteCache\(\)\?\.pages/.test(MAIN)
  && !/await .*metadaten/i.test(abschnitt("function watchStatistik(")),
  "gelesen wird nur, was ohnehin im Cache liegt");
pruefe("Genres werden unter der Titeladresse nachgesehen",
  /seiten\[String\(favorite\?\.url \|\| ""\)\]/.test(MAIN),
  "eine Folgenadresse steht nie im Geschmack-Cache");
pruefe("Die Oberflaeche fragt nach Zeitraeumen",
  /getReview: \(jahr\) => ipcRenderer\.invoke\("review:data", jahr\)/.test(PRELOAD));
pruefe("Sie zeigt keine Stundenkarte ohne gemessene Zeit",
  /if \(zeitBekannt\) kopf\.append\(reviewGross\(reviewDauer\(daten\.sekunden\), "geschaut"\)\);/.test(RENDERER),
  "0 Stunden waere falsch, wenn die Wahrheit \"unbekannt\" lautet");
pruefe("und sagt stattdessen, ab wann gemessen wird",
  /Wiedergabezeit wird erst seit dieser Version gemessen/.test(RENDERER));
pruefe("Der Zeitraum wird benannt, nicht behauptet",
  /tage >= 90 \? `Dein Jahr \$\{zeitraum\}` : `Dein ELFIX-Rückblick · \$\{zeitraum\}`/.test(RENDERER),
  "drei Wochen in einem Jahr sind kein Jahresrueckblick");

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
