"use strict";
// Der persoenliche Verlauf eines Titels.
//
// Gemeldet war, an "BLACK TORCH": "4 Mal abgeschlossen", mehrere identische
// Zeilen fuer Folge 8, mehrere Zeilen derselben Folge innerhalb weniger
// Minuten, dazu nackte "Abgeschlossen"-Zeilen. Nachgesehen in der echten
// Ablage stand dort genau das - und alles davon war ein Ereignisprotokoll,
// kein Verlauf:
//
//   33 Ereignisse fuer 8 Folgen, davon vier mit dem Label "Abgeschlossen"
//   (nach Folge 3, nach Folge 6 und zweimal nach Folge 8). Bei einer
//   woechentlich erscheinenden Serie ist "die letzte verfuegbare Folge
//   erreicht" kein Serienabschluss, sondern ein Einholen.
//
// Geprueft wird hier die Rechnung in shared/verlauf.js: aus vielen Ereignissen
// wird je Folge genau einer, der Status kommt aus AniList/TMDB und niemals aus
// einem gespeicherten Ereignis, und ein Abschluss haengt immer an einer
// konkreten Staffel und Folge.

const path = require("path");
const verlauf = require(path.join(__dirname, "..", "shared", "verlauf.js"));
const fortschritt = require(path.join(__dirname, "..", "src", "fortschritt.js"));

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(b); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };

const AW = "https://aniworld.to/anime/stream/black-torch";
const folge = (n, s = 1) => `${AW}/staffel-${s}/episode-${n}`;
const zeit = (tag, stunde = 12, minute = 0) => new Date(Date.UTC(2026, 7, tag, stunde, minute)).toISOString();

function serie(extra = {}) {
  return {
    id: "a", title: "BLACK TORCH", type: "serie", url: folge(8),
    season: 1, episode: 8, finalSeason: 1, finalEpisode: 8,
    completedEpisodes: [], activity: [], ...extra
  };
}

const modell = (eintraege, metadaten = null) => verlauf.verlaufBauen(eintraege, eintraege[0], { metadaten });
const folgeVon = (m, nummer, staffel = 1) => m.folgen.find((f) => f.folge === nummer && f.staffel === staffel);

// --- 1. Die Adresse ist die Wahrheit ------------------------------------------
//
// Das gemeinsame Modul muss dieselbe Folge lesen wie der Fortschritt. Liefen
// beide auseinander, stuende im Verlauf eine andere Folge als in der Ablage -
// und niemand saehe, wo der Fehler sitzt.

const ADRESSEN = [
  folge(8), folge(1), folge(12, 3),
  "https://s.to/serie/stream/loki/staffel-2/episode-4",
  "https://s.to/serie/stream/loki/staffel-1",
  "https://aniworld.to/anime/stream/black-torch",
  "https://filmo.to/movies/irgendwas",
  "kaputt"
];
const gleich = ADRESSEN.every((adresse) => {
  const a = verlauf.folgenkennung(adresse);
  const b = fortschritt.episodeIdentity(adresse);
  if (!a || !b) return !a && !b;
  return a.staffel === b.season && a.folge === b.episode && a.schluessel === b.key;
});
pruefe("Verlauf und Fortschritt lesen dieselbe Folge aus einer Adresse", gleich,
  "sonst zeigt der Kasten eine andere Folge als die Ablage fuehrt");

// --- 2. Viele Ereignisse, eine Zeile ------------------------------------------
//
// Der Kern des gemeldeten Fehlers. Fortschrittsmeldungen im Sekundentakt,
// Pause, Sprung, Neuladen, erneutes Oeffnen, Vollbild, Watchparty-Abgleich:
// alles landet als Ereignis in `activity`, und alles betrifft dieselbe Folge.

{
  const viele = serie({
    activity: [
      { at: zeit(23, 15, 0), label: "Staffel 1 Folge 8", url: folge(8) },
      { at: zeit(23, 15, 1), label: "Staffel 1 Folge 8", url: folge(8) },
      { at: zeit(23, 15, 30), label: "Staffel 1 Folge 8", url: folge(8) },
      { at: zeit(23, 16, 0), label: "Staffel 1 Folge 8", url: folge(8) },
      { at: zeit(23, 16, 5), label: "Geöffnet", url: folge(8) },
      { at: zeit(23, 16, 40), label: "Staffel 1 Folge 8", url: folge(8) },
      { at: zeit(23, 17, 0), label: "Staffel 1 Folge 8", url: folge(8) }
    ]
  });
  const m = modell([viele]);
  pruefe("Viele Fortschrittsmeldungen derselben Folge ergeben eine Zeile",
    m.folgen.length === 1, `${m.folgen.length} Zeilen aus 7 Ereignissen`);
  pruefe("Pause, Sprung und Neuladen erzeugen keine zweite Zeile",
    m.folgen[0].folge === 8 && m.folgen[0].staffel === 1);
  pruefe("Behalten wird der neueste Zeitpunkt",
    new Date(m.folgen[0].zuletzt).toISOString() === zeit(23, 17, 0),
    new Date(m.folgen[0].zuletzt).toISOString());
}

// Mehrfach gemeldete Abschluesse derselben Sitzung zaehlen einmal - und sie
// zaehlen als Abschluss dieser Folge, nicht als Abschluss des Titels.
{
  const doppelt = serie({
    activity: [
      { at: zeit(23, 15, 40), label: "Staffel 1 Folge 8", url: folge(8) },
      { at: zeit(23, 15, 40), label: "Abgeschlossen", url: folge(8) },
      { at: zeit(23, 15, 43), label: "Abgeschlossen", url: folge(8) },
      { at: zeit(23, 15, 47), label: "Staffel 1 Folge 8", url: folge(8) }
    ]
  });
  const m = modell([doppelt]);
  pruefe("Mehrfache Abschlussmeldungen derselben Sitzung zaehlen einmal",
    m.folgen.length === 1 && m.folgen[0].abgeschlossen === true,
    `${m.folgen.length} Zeilen`);
}

// --- 3. Kein Abschluss ohne Folge ----------------------------------------------
//
// Eine Abschlusszeile, die auf der Serienseite entstand, sagt nicht, was
// endete. Sie darf deshalb weder eine Folge belegen noch eine erfinden.

{
  const nackt = serie({
    url: AW, season: 1, episode: 8,
    activity: [
      { at: zeit(23, 15, 40), label: "Abgeschlossen", url: AW, season: 1, episode: 8 },
      { at: zeit(24, 10, 0), label: "Fertig", url: AW, season: 1, episode: 8 },
      { at: zeit(24, 11, 0), label: "Titel abgeschlossen", url: AW, season: 1, episode: 8 }
    ]
  });
  const m = modell([nackt]);
  pruefe("Generische Abschlusszeilen ohne Folgenadresse belegen keine Folge",
    m.folgen.length === 0,
    `${m.folgen.length} Folgen - die Nummer am Ereignis ist der Zeiger des Eintrags, nicht die Folge`);
  pruefe("Und sie erzeugen keinen Abschluss",
    m.status !== verlauf.STATUS.SERIE && m.status !== verlauf.STATUS.STAFFEL);
  pruefe("Die drei Formen gelten alle als generisch",
    ["Abgeschlossen", "Fertig", "Titel abgeschlossen", "abgeschlossen"]
      .every((label) => verlauf.istGenerischerAbschluss(label))
    && !verlauf.istGenerischerAbschluss("Staffel 1 Folge 8"));
}

// Mit eindeutiger Folgenadresse ist dieselbe Zeile brauchbar: sie belegt den
// Abschluss genau dieser Folge.
{
  const m = modell([serie({
    activity: [{ at: zeit(23, 15, 40), label: "Abgeschlossen", url: folge(8) }]
  })]);
  pruefe("Mit eindeutiger Adresse zaehlt der Abschluss fuer diese Folge",
    m.folgen.length === 1 && m.folgen[0].folge === 8 && m.folgen[0].abgeschlossen === true);
}

// --- 4. Der Status wird gerechnet, nicht gelesen -------------------------------

const laufend = { quelle: "anilist", laufStatus: "RELEASING", folgenGesamt: 12, naechsteFolge: null };
const fertig = { quelle: "anilist", laufStatus: "FINISHED", folgenGesamt: 8, naechsteFolge: null };

function achtFolgen(extra = {}) {
  const folgen = [];
  for (let n = 1; n <= 8; n += 1) {
    folgen.push({ key: `bt:s1:e${n}`, season: 1, episode: n, url: folge(n), completedAt: zeit(20 + Math.floor(n / 3), 12, n) });
  }
  return serie({ completedEpisodes: folgen, ...extra });
}

{
  const m = modell([achtFolgen()], laufend);
  pruefe("Alle verfuegbaren Folgen einer laufenden Serie: auf aktuellem Stand",
    m.status === verlauf.STATUS.AKTUELL, m.status);
  pruefe("Gezaehlt werden Folgen, und es sind acht von acht",
    m.gesehenGesamt === 8 && m.verfuegbar === 8, `${m.gesehenGesamt}/${m.verfuegbar}`);
  pruefe("RELEASING ist kein Staffelabschluss",
    m.status !== verlauf.STATUS.STAFFEL && m.status !== verlauf.STATUS.SERIE);
}

{
  // Selbst wenn AniList "FINISHED" meldet: eine bekannte naechste Folge ist
  // der direkte Beleg, dass noch etwas kommt.
  const widerspruch = { quelle: "anilist", laufStatus: "FINISHED", folgenGesamt: 8,
    naechsteFolge: { nummer: 9, zeit: zeit(29, 15, 0) } };
  const m = modell([achtFolgen()], widerspruch);
  pruefe("Eine bekannte naechste Folge verhindert jeden endgueltigen Abschluss",
    m.status === verlauf.STATUS.AKTUELL, m.status);
  pruefe("Und sie wird mit ihrem Datum weitergereicht",
    m.naechsteFolge?.nummer === 9 && new Date(m.naechsteFolge.zeit).toISOString() === zeit(29, 15, 0));
}

{
  const m = modell([achtFolgen()], fertig);
  pruefe("FINISHED plus alle Folgen der Staffel: Staffel abgeschlossen",
    m.status === verlauf.STATUS.STAFFEL, m.status);
}

{
  const tmdbEnde = { quelle: "tmdb", laufStatus: "Ended", folgenGesamt: 8, naechsteFolge: null };
  const m = modell([achtFolgen()], tmdbEnde);
  pruefe("Ended plus alle Folgen der Serie: Serie abgeschlossen",
    m.status === verlauf.STATUS.SERIE, m.status);
}

{
  const tmdbLaeuft = { quelle: "tmdb", laufStatus: "Returning Series", folgenGesamt: 24, naechsteFolge: null };
  const m = modell([achtFolgen()], tmdbLaeuft);
  pruefe("Eine laufende TMDB-Serie wird nicht abgeschlossen",
    m.status === verlauf.STATUS.AKTUELL, m.status);
}

{
  const m = modell([achtFolgen()], null);
  pruefe("Ohne Metadaten wird kein Abschluss behauptet",
    m.status === verlauf.STATUS.AKTUELL, m.status);
  const halb = modell([achtFolgen({ finalEpisode: 12 })], null);
  pruefe("Und ohne Metadaten und ohne Anbieterstand bleibt der Status unbekannt",
    halb.status === verlauf.STATUS.UNBEKANNT, halb.status);
}

{
  // Der wichtigste Fall: der Anbieter hat gerade nichts Neues, die Quelle sagt
  // nichts. Das ist kein Abschluss.
  const m = verlauf.statusBestimmen({
    istSerie: true, anbieterStandGesehen: true, gesehenGesamt: 8,
    metadaten: { quelle: "anilist", laufStatus: "", folgenGesamt: 0 }
  });
  pruefe("Keine naechste Folge beim Anbieter ist kein offizieller Abschluss",
    m === verlauf.STATUS.AKTUELL, m);
  const zuWenig = verlauf.statusBestimmen({
    istSerie: true, anbieterStandGesehen: true, gesehenGesamt: 6,
    metadaten: { quelle: "anilist", laufStatus: "FINISHED", folgenGesamt: 12 }
  });
  pruefe("FINISHED mit ungesehenen Folgen ist kein Staffelabschluss",
    zuWenig === verlauf.STATUS.AKTUELL, zuWenig);
}

// --- 5. "An X Tagen geschaut" --------------------------------------------------
//
// Gezaehlt werden Abende, nicht Meldungen. Und ein Abend bleibt ein Abend,
// auch wenn dieselbe Folge spaeter noch einmal lief.

{
  const abende = serie({
    activity: [
      { at: zeit(23, 14, 0), label: "Staffel 1 Folge 6", url: folge(6) },
      { at: zeit(23, 14, 1), label: "Staffel 1 Folge 6", url: folge(6) },
      { at: zeit(23, 15, 0), label: "Staffel 1 Folge 7", url: folge(7) },
      { at: zeit(24, 10, 0), label: "Staffel 1 Folge 8", url: folge(8) },
      { at: zeit(24, 10, 30), label: "Staffel 1 Folge 8", url: folge(8) },
      { at: zeit(25, 18, 0), label: "Staffel 1 Folge 8", url: folge(8) },
      { at: zeit(26, 9, 0), label: "Geöffnet", url: AW }
    ]
  });
  const m = modell([abende]);
  pruefe("Gezaehlt werden eindeutige Kalendertage mit Wiedergabe",
    m.tage === 3, `${m.tage} Tage`);
  pruefe("Ein Abend, an dem nur geoeffnet wurde, zaehlt nicht mit", m.tage === 3);
  pruefe("Ein frueherer Abend geht nicht verloren, wenn die Folge spaeter noch einmal lief",
    m.tage === 3 && m.folgen.length === 3);
}

// --- 6. Watchparty ------------------------------------------------------------
//
// Der Raumfortschritt landet ueber `watchpartyStandUebernehmen` im Eintrag -
// in Stelle, Laufzeit und Folgennummer -, aber nie in `activity` oder
// `completedEpisodes`. Genau daran haengt, dass ein abwesendes Mitglied keine
// fremden Folgen in seinen Verlauf bekommt.

{
  const abwesend = serie({
    watchpartyRoom: "Animeabend",
    // Der Raum steht bei Folge 10, dieses Geraet hat bis Folge 8 mitgeschaut.
    url: folge(10), season: 1, episode: 10, currentTime: 700, duration: 1400, progress: 50,
    finalEpisode: 10,
    completedEpisodes: [
      { key: "bt:s1:e7", season: 1, episode: 7, url: folge(7), completedAt: zeit(23, 15, 0) },
      { key: "bt:s1:e8", season: 1, episode: 8, url: folge(8), completedAt: zeit(23, 16, 0) }
    ]
  });
  const m = modell([abwesend]);
  pruefe("Abwesende Raummitglieder bekommen keine fremden Folgen",
    m.folgen.every((f) => f.folge <= 8), m.folgen.map((f) => f.folge).join(", "));
  pruefe("Und der Raumstand macht sie nicht zu \"auf aktuellem Stand\"",
    m.anbieterStandGesehen === false && m.status === verlauf.STATUS.UNBEKANNT, m.status);
  pruefe("Tatsaechliche Anwesenheit ist am Folgeneintrag erkennbar",
    folgeVon(m, 8)?.raum === "Animeabend", folgeVon(m, 8)?.raum);
}

{
  // War man dabei, gehoert die eigene Stelle sehr wohl in den Kasten.
  const dabei = serie({
    watchpartyRoom: "Animeabend", url: folge(9), season: 1, episode: 9,
    currentTime: 761, duration: 1450, finalEpisode: 9,
    activity: [{ at: zeit(29, 18, 52), label: "Staffel 1 Folge 9", url: folge(9) }]
  });
  const m = modell([dabei]);
  pruefe("Eine selbst begonnene Folge zeigt ihre Stelle",
    folgeVon(m, 9)?.position === 761 && folgeVon(m, 9)?.dauer === 1450,
    JSON.stringify(folgeVon(m, 9)));
  pruefe("und sie gilt nicht als abgeschlossen",
    folgeVon(m, 9)?.abgeschlossen === false);
}

// --- 7. Zwei Eintraege, ein Titel ----------------------------------------------
//
// Denselben Titel gibt es in der Ablage mehrfach: den eigenen Eintrag und je
// einen pro Runde. Der Verlauf ist trotzdem einer - und jede Folge steht
// darin genau einmal.

{
  const eigener = serie({
    id: "privat", url: folge(1), season: 1, episode: 1, finalEpisode: 7,
    activity: [
      { at: zeit(16, 14, 5), label: "Staffel 1 Folge 1", url: folge(1) },
      { at: zeit(20, 9, 1), label: "Staffel 1 Folge 3", url: folge(3) }
    ]
  });
  const ausRunde = serie({
    id: "runde", watchpartyRoom: "Bangus",
    completedEpisodes: [
      { key: "bt:s1:e3", season: 1, episode: 3, url: folge(3), completedAt: zeit(23, 13, 39) },
      { key: "bt:s1:e8", season: 1, episode: 8, url: folge(8), completedAt: zeit(25, 16, 52) }
    ]
  });
  const m = verlauf.verlaufBauen([eigener, ausRunde], ausRunde, { metadaten: laufend });
  pruefe("Beide Eintraege desselben Titels bilden einen Verlauf",
    m.gesehenGesamt === 3, m.folgen.map((f) => f.folge).join(", "));
  pruefe("Folge 3 steht darin genau einmal",
    m.folgen.filter((f) => f.folge === 3).length === 1);
  pruefe("Und mit dem neueren ihrer beiden Zeitpunkte",
    new Date(folgeVon(m, 3).zuletzt).toISOString() === zeit(23, 13, 39),
    new Date(folgeVon(m, 3).zuletzt).toISOString());
  pruefe("Der Raum haengt an der Folge, die aus der Runde stammt",
    folgeVon(m, 8).raum === "Bangus" && folgeVon(m, 1).raum === "");
}

{
  // Zwei verschiedene Serien duerfen nie zusammenfallen, auch wenn die
  // Adressen einander aehneln.
  const bt = serie({ id: "bt" });
  const bs = serie({ id: "bs", title: "BLACK SUMMER", url: "https://aniworld.to/anime/stream/black-summer/staffel-1/episode-1" });
  pruefe("Aehnliche Adressen werden nicht zusammengefuehrt",
    verlauf.serienSchluessel(bt) !== verlauf.serienSchluessel(bs));
  pruefe("Dieselbe Serie behaelt ihren Schluessel ueber alle Folgen",
    verlauf.serienSchluessel(serie({ url: folge(1) })) === verlauf.serienSchluessel(serie({ url: folge(12, 3) })));
}

// --- 8. Reihenfolge ------------------------------------------------------------

{
  const quer = serie({
    finalSeason: 2, finalEpisode: 3,
    activity: [
      { at: zeit(20, 9, 0), label: "Staffel 2 Folge 3", url: folge(3, 2) },
      { at: zeit(26, 9, 0), label: "Staffel 1 Folge 2", url: folge(2, 1) },
      { at: zeit(21, 9, 0), label: "Staffel 2 Folge 1", url: folge(1, 2) },
      { at: zeit(22, 9, 0), label: "Staffel 1 Folge 9", url: folge(9, 1) }
    ]
  });
  const m = modell([quer]);
  pruefe("Hoehere Staffel zuerst, darin hoehere Folge zuerst",
    m.folgen.map((f) => `${f.staffel}x${f.folge}`).join(" ") === "2x3 2x1 1x9 1x2",
    m.folgen.map((f) => `${f.staffel}x${f.folge}`).join(" "));
  pruefe("Der spaeteste Zeitpunkt sortiert nichts um",
    m.folgen[0].staffel === 2, "sonst stuende Staffel 1 Folge 2 oben");
  pruefe("Die Staffeln kommen als Gruppen",
    m.staffeln.length === 2 && m.staffeln[0].nummer === 2 && m.staffeln[0].folgen.length === 2);
  pruefe("Bei mehreren Staffeln wird keine Gesamtzahl behauptet",
    m.verfuegbar === 0, "der Anbieter nennt die Folgenzahl frueherer Staffeln nicht");
}

// --- 9. Die echten Daten von BLACK TORCH ---------------------------------------
//
// Der gemeldete Fall, Ereignis fuer Ereignis aus der Ablage uebernommen: zwei
// Eintraege (der eigene und der aus dem Raum "Bangus"), 33 + 17 Ereignisse,
// vier "Abgeschlossen"-Zeilen, sechs abgeschlossene Folgen.

{
  const raumEintrag = {
    id: "cca6", title: "BLACK TORCH", type: "serie", url: folge(8),
    season: 1, episode: 8, finalSeason: 1, finalEpisode: 8,
    completed: true, completedAt: "2026-08-23T15:40:44.938Z",
    watchpartyRoom: "Bangus", progress: 94, duration: 1425.132, currentTime: 1335.861187,
    completedEpisodes: [2, 3, 4, 5, 6, 7].map((n) => ({
      key: `aniworld.to:black-torch:s1:e${n}`, season: 1, episode: n, url: folge(n),
      completedAt: `2026-08-23T1${n < 5 ? 3 : 5}:${10 + n}:00.000Z`
    })),
    activity: [
      { at: "2026-08-23T13:41:28.753Z", label: "Staffel 1 Folge 3", url: folge(3) },
      { at: "2026-08-23T13:41:38.769Z", label: "Abgeschlossen", url: folge(3) },
      { at: "2026-08-23T14:56:40.773Z", label: "Staffel 1 Folge 6", url: folge(6) },
      { at: "2026-08-23T14:56:45.782Z", label: "Abgeschlossen", url: folge(6) },
      { at: "2026-08-23T15:40:44.938Z", label: "Staffel 1 Folge 8", url: folge(8) },
      { at: "2026-08-23T15:40:44.938Z", label: "Abgeschlossen", url: folge(8) },
      { at: "2026-08-23T15:43:10.166Z", label: "Staffel 1 Folge 8", url: folge(8) },
      { at: "2026-08-23T15:43:21.308Z", label: "Abgeschlossen", url: folge(8) },
      { at: "2026-08-23T15:47:23.724Z", label: "Staffel 1 Folge 8", url: folge(8) },
      { at: "2026-08-23T23:17:19.544Z", label: "Geöffnet", url: AW },
      { at: "2026-08-24T17:28:31.674Z", label: "Geöffnet", url: folge(4) },
      { at: "2026-08-24T17:28:42.243Z", label: "Staffel 1 Folge 4", url: folge(4) },
      { at: "2026-08-24T17:28:44.563Z", label: "Staffel 1 Folge 8", url: folge(8) },
      { at: "2026-08-24T17:28:45.377Z", label: "Staffel 1 Folge 4", url: folge(4) },
      { at: "2026-08-24T17:29:37.535Z", label: "Staffel 1 Folge 8", url: folge(8) },
      { at: "2026-08-25T16:52:07.725Z", label: "Staffel 1 Folge 8", url: folge(8) }
    ]
  };
  const eigenerEintrag = {
    id: "b86a", title: "BLACK TORCH", type: "serie", url: folge(1),
    season: 1, episode: 1, finalSeason: 1, finalEpisode: 7,
    completed: false, completedAt: "", watchpartyRoom: "",
    completedEpisodes: [],
    activity: [
      { at: "2026-08-16T14:05:06.327Z", label: "Staffel 1 Folge 1", url: folge(1) },
      { at: "2026-08-16T18:24:33.866Z", label: "Staffel 1 Folge 1", url: folge(1) },
      { at: "2026-08-17T08:45:56.646Z", label: "Geöffnet", url: AW },
      { at: "2026-08-20T09:01:40.745Z", label: "Staffel 1 Folge 2", url: folge(2) },
      { at: "2026-08-20T09:01:48.536Z", label: "Staffel 1 Folge 3", url: folge(3) },
      { at: "2026-08-21T03:12:55.573Z", label: "Staffel 1 Folge 3", url: folge(3) }
    ]
  };
  const m = verlauf.verlaufBauen([raumEintrag, eigenerEintrag], raumEintrag, {
    metadaten: { quelle: "anilist", laufStatus: "RELEASING", folgenGesamt: 0,
      naechsteFolge: { nummer: 9, zeit: "2026-08-29T15:00:00.000Z" } }
  });

  pruefe("BLACK TORCH: acht Folgen, jede genau einmal",
    m.gesehenGesamt === 8 && new Set(m.folgen.map((f) => f.folge)).size === 8,
    m.folgen.map((f) => f.folge).join(", "));
  pruefe("Folge 8 steht einmal da, nicht achtmal",
    m.folgen.filter((f) => f.folge === 8).length === 1);
  pruefe("Acht von acht aktuell verfuegbaren Folgen",
    m.gesehenGesamt === 8 && m.verfuegbar === 8);
  pruefe("Auf aktuellem Stand - nicht viermal abgeschlossen",
    m.status === verlauf.STATUS.AKTUELL, m.status);
  pruefe("Zuletzt gesehen: Folge 8 am 25.08.2026",
    m.zuletztGesehen.folge === 8
    && new Date(m.zuletztGesehen.zuletzt).toISOString() === "2026-08-25T16:52:07.725Z",
    new Date(m.zuletztGesehen.zuletzt).toISOString());
  pruefe("Die vier Abschlusszeilen ergeben Folgenabschluesse, keinen Serienabschluss",
    [3, 6, 8].every((n) => folgeVon(m, n).abgeschlossen === true)
    && m.status !== verlauf.STATUS.SERIE);
  pruefe("Folge 1 kommt aus dem eigenen Eintrag und traegt keinen Raum",
    folgeVon(m, 1) !== undefined && folgeVon(m, 1).raum === "");
  pruefe("Bestehende persoenliche Fortschritte bleiben erhalten",
    m.folgen.every((f) => f.zuletzt > 0));
}

// --- 10. Zweimal rechnen aendert nichts ----------------------------------------
//
// Es gibt keine Migration - gerechnet wird bei jeder Anzeige neu, aus den
// unveraenderten Rohdaten. Der Beweis dafuer ist, dass zwei Durchlaeufe
// dasselbe ergeben und die Eingabe danach unveraendert ist.

{
  const eintraege = [achtFolgen()];
  const vorher = JSON.stringify(eintraege);
  const eins = modell(eintraege, laufend);
  const zwei = modell(eintraege, laufend);
  pruefe("Ein zweiter Durchlauf ergibt dasselbe",
    JSON.stringify(eins) === JSON.stringify(zwei));
  pruefe("Und die Rohdaten bleiben unangetastet",
    JSON.stringify(eintraege) === vorher, "keine Migration, kein Datenverlust");
}

// --- 11. Kaputtes ---------------------------------------------------------------

{
  const kaputt = serie({
    activity: [
      { at: "unsinn", label: "Staffel 1 Folge 4", url: folge(4) },
      { at: zeit(23, 9, 0), label: "", url: "" },
      null,
      { at: zeit(23, 9, 0), label: "Staffel 1 Folge 5", url: folge(5) }
    ]
  });
  const m = modell([kaputt]);
  pruefe("Kaputte Zeitangaben und leere Ereignisse fliegen raus",
    m.folgen.length === 1 && m.folgen[0].folge === 5, m.folgen.map((f) => f.folge).join(", "));
  const leer = verlauf.verlaufBauen([], null, {});
  pruefe("Ohne jeden Eintrag faellt nichts um",
    leer.folgen.length === 0 && leer.status === verlauf.STATUS.UNBEKANNT);
}

const gut = pruefungen.filter(Boolean).length;
console.log(`${gut}/${pruefungen.length} bestanden`);
process.exit(gut === pruefungen.length ? 0 : 1);
