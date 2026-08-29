"use strict";
/*
 * Die Regel, nach der ELFIX Fortschritt zaehlt - gemessen, nicht gelesen.
 *
 * Die uebrigen Pruefungen in diesem Ordner sehen oft im Quelltext nach, ob eine
 * Zeile noch dasteht. Das genuegt hier nicht: seit `medienStandVerbuchen` in
 * src/fortschritt.js steht, laeuft dieselbe Funktion auch im Kern der
 * Android-App. Was sie tut, muss sich an Ergebnissen festmachen lassen - sonst
 * faellt ein Unterschied zwischen beiden Geraeten erst dem Benutzer auf.
 *
 * Dieselben Faelle werden auf dem Telefon gegen dieselben Erwartungen gefahren
 * (siehe MainActivity.kernSelbsttest). Wer hier eine Zahl aendert, aendert sie
 * dort mit.
 */

const fortschritt = require("../src/fortschritt");

const pruefungen = [];
const pruefe = (name, bedingung, detail) => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

const ANBIETER = { id: "p1", name: "Aniworld", startUrl: "https://aniworld.to/", logo: "AN" };
const SERIE = "https://aniworld.to/anime/stream/naruto";
const folge = (staffel, nummer) => `${SERIE}/staffel-${staffel}/episode-${nummer}`;

// Ein Aufruf mit leerer Ablage, bequem verpackt.
function verbuche(zustand, url, meta = {}, optionen = {}) {
  return fortschritt.medienStandVerbuchen(
    { favoriten: [], aktiverFavoritId: "", watchpartyFuehrt: false, ...zustand },
    ANBIETER, url, meta, optionen);
}

// Eine Wiedergabe: Position, Laufzeit und wie lange wirklich geschaut wurde.
const lief = (sekunden, laufzeit, geschaut) => ({
  currentTime: sekunden, duration: laufzeit, watchedSeconds: geschaut
});

/* --- Was ueberhaupt einen Eintrag verdient ------------------------------- */

pruefe("Ohne Videodaten und ohne bestehenden Eintrag passiert nichts",
  verbuche({}, folge(3, 7), {}).eintrag === null,
  "sonst fuellt jeder geoeffnete Reiter die Liste");

pruefe("Ein Film wird sofort uebernommen",
  Boolean(verbuche({}, "https://filmo.to/film/spiderman", lief(30, 6000, 30)).eintrag),
  "ein Film hat keine Folge, auf die man warten koennte");

pruefe("Staffel 1 Folge 1 wird sofort uebernommen",
  Boolean(verbuche({}, folge(1, 1), lief(20, 1400, 20)).eintrag),
  "wer eine Serie anfaengt, faengt sie an");

/* --- Die 2:30 fuer alles Weitere ---------------------------------------- */

{
  const zu_frueh = verbuche({}, folge(3, 7), lief(60, 1400, 60));
  pruefe("Mitten in der Serie zaehlt erst ab 2:30",
    zu_frueh.eintrag === null && zu_frueh.diagnosen.some((d) => d.art === "blockiert"),
    `${fortschritt.MIN_WATCH_TIME_SECONDS}s noetig, 60s geschaut`);

  const reicht = verbuche({}, folge(3, 7), lief(160, 1400, 160));
  pruefe("Ab 2:30 steht der Eintrag",
    reicht.eintrag?.season === 3 && reicht.eintrag?.episode === 7);
}

/* --- Die 90 Prozent, und warum sie allein nicht genuegen ---------------- */

function bestehenderStand(zusatz = {}) {
  return {
    id: "e1", providerId: "p1", providerName: "Aniworld", title: "Naruto",
    url: folge(3, 7), normalizedUrl: folge(3, 7), type: "serie",
    season: 3, episode: 7, progress: 20, currentTime: 280, duration: 1400,
    favorite: true, watched: true, completed: false, episodeCompleted: false,
    continuePending: false, completedEpisodes: [], activity: [],
    finalSeason: 5, finalEpisode: 20, hideFromContinueWatching: false,
    createdAt: "2026-01-01T00:00:00.000Z", lastWatchedAt: "2026-01-01T00:00:00.000Z",
    ...zusatz
  };
}

{
  // 95 Prozent, aber nur zehn Sekunden gelaufen: hineingesprungen, Regler ans
  // Ende gezogen. Das ist keine geschaute Folge.
  const stand = bestehenderStand();
  const gesprungen = verbuche({ favoriten: [stand] }, folge(3, 7), lief(1330, 1400, 10));
  pruefe("90 Prozent ohne Wiedergabezeit schliessen keine Folge ab",
    gesprungen.eintrag?.episode === 7 && !gesprungen.eintrag?.completedEpisodes.length,
    "sonst kommt man in einer Sekunde ans Serienende");
}

{
  const stand = bestehenderStand();
  const durch = verbuche({ favoriten: [stand] }, folge(3, 7), lief(1330, 1400, 900));
  pruefe("90 Prozent mit 2:30 Wiedergabe schliessen die Folge ab",
    durch.eintrag?.completedEpisodes.length === 1);
  pruefe("Und der Eintrag rueckt auf die naechste Folge",
    durch.eintrag?.episode === 8 && durch.eintrag?.season === 3,
    `steht auf S${durch.eintrag?.season}E${durch.eintrag?.episode}`);
  pruefe("Die naechste Folge steht als offen in Weiterschauen",
    durch.eintrag?.continuePending === true && durch.eintrag?.progress === 0);
}

{
  // Am Staffelende geht es in die naechste Staffel.
  const stand = bestehenderStand({ url: folge(3, 24), season: 3, episode: 24, seasonLastEpisode: 24 });
  const durch = verbuche({ favoriten: [stand] }, folge(3, 24),
    { ...lief(1330, 1400, 900), seasonLastEpisode: 24, finalSeason: 5, finalEpisode: 20 });
  pruefe("Am Staffelende geht es mit Staffel 4 Folge 1 weiter",
    durch.eintrag?.season === 4 && durch.eintrag?.episode === 1,
    `steht auf S${durch.eintrag?.season}E${durch.eintrag?.episode}`);
}

{
  // Die letzte Folge der letzten Staffel beendet die Serie.
  const stand = bestehenderStand({ url: folge(5, 20), season: 5, episode: 20 });
  const durch = verbuche({ favoriten: [stand] }, folge(5, 20),
    { ...lief(1330, 1400, 900), finalSeason: 5, finalEpisode: 20 });
  pruefe("Die letzte Folge schliesst die Serie ab",
    durch.eintrag?.completed === true);
  pruefe("Ein abgeschlossener Titel verlaesst die Watchlist",
    durch.eintrag?.favorite === false,
    "er steht ab jetzt in der Mediathek");
  pruefe("Und verschwindet aus Weiterschauen",
    durch.eintrag?.hideFromContinueWatching === true
    && fortschritt.hasContinueProgressRecord(durch.eintrag) === false);
}

/* --- Die Minute zurueck -------------------------------------------------- */

{
  const stand = bestehenderStand();
  const kurz = verbuche({ favoriten: [stand] }, folge(3, 2), lief(30, 1400, 30));
  pruefe("Zurueck auf eine aeltere Folge braucht mehr als kurzes Reinschauen",
    kurz.eintrag?.episode === 7,
    `${fortschritt.BACKWARD_WATCH_TIME_SECONDS}s noetig, 30s geschaut`);

  const stand2 = bestehenderStand();
  const bewusst = verbuche({ favoriten: [stand2] }, folge(3, 2), lief(70, 1400, 70));
  pruefe("Ab einer Minute geht der Stand wirklich zurueck",
    bewusst.eintrag?.episode === 2);
}

/* --- Die Watchparty fuehrt ---------------------------------------------- */

{
  const stand = bestehenderStand();
  const ohne = verbuche({ favoriten: [stand] }, folge(4, 3), lief(10, 1400, 10));
  pruefe("Ohne Runde bleibt ein kurzer Sprung nach vorn liegen",
    ohne.eintrag?.episode === 7);

  const stand2 = bestehenderStand();
  const mit = verbuche({ favoriten: [stand2], watchpartyFuehrt: true }, folge(4, 3), lief(10, 1400, 10));
  pruefe("Gibt die Runde die Folge vor, gilt sie sofort",
    mit.eintrag?.season === 4 && mit.eintrag?.episode === 3,
    "sonst haengt der eigene Stand hinter der Gruppe her");
}

{
  // In einer Runde reicht eine halbe Minute statt zweieinhalb.
  const stand = bestehenderStand({ watchpartyRoom: "familie" });
  const runde = verbuche({ favoriten: [stand] }, folge(3, 9), lief(40, 1400, 40));
  pruefe("In einer Runde genuegt eine halbe Minute",
    runde.eintrag?.episode === 9,
    `${fortschritt.WATCHPARTY_MIN_WATCH_SECONDS}s statt ${fortschritt.MIN_WATCH_TIME_SECONDS}s`);
}

/* --- Nebenwirkungen bleiben draussen ------------------------------------ */

{
  const vorher = [bestehenderStand()];
  const kopie = JSON.parse(JSON.stringify(vorher));
  const ergebnis = verbuche({ favoriten: vorher }, folge(3, 7), lief(400, 1400, 400));
  pruefe("Die Liste wird zurueckgegeben, nicht im Vorbeigehen ausgetauscht",
    Array.isArray(ergebnis.favoriten) && ergebnis.favoriten.length === 1);
  pruefe("Meldungen werden gesammelt statt angezeigt",
    Array.isArray(ergebnis.meldungen) && Array.isArray(ergebnis.diagnosen),
    "wer sie zeigt, entscheidet das Geraet");
  pruefe("Die Eingabeliste selbst bleibt dieselbe Laenge",
    vorher.length === kopie.length);
}

/* --- Die Schwellen selbst ----------------------------------------------- */

pruefe("Die vier Schwellen stehen, wie sie im README stehen",
  fortschritt.COMPLETED_PROGRESS_PERCENT === 90
  && fortschritt.MIN_WATCH_TIME_SECONDS === 150
  && fortschritt.BACKWARD_WATCH_TIME_SECONDS === 60
  && fortschritt.WATCHPARTY_MIN_WATCH_SECONDS === 30,
  "90 % / 2:30 / 60 s / 0:30");

pruefe("Kurze Folgen koennen trotzdem enden",
  fortschritt.endeSchwelle(120) === 108 && fortschritt.endeSchwelle(1400) === 150,
  "sonst liesse sich ein Zehnminueter nie abschliessen");

/* --- Dieselben Faelle, die auch das Telefon faehrt ----------------------- */

// Ab hier laeuft nicht mehr dieser Test, sondern der gemeinsame Pruefstand.
// Er liest tests/fortschritt-proben.json, und genau diese Datei liegt auch im
// Paket der Android-App. Stimmt hier alles und dort nicht, liegt es am Geraet
// --- Von Hand vormerken -------------------------------------------------------
//
// Der zweite Weg in die Ablage, und lange der kaputte. Das Telefon hat dafuer
// `medienStandVerbuchen` einen Mindeststand vorgetaeuscht (currentTime 0.1,
// duration 1) - mit zwei Folgen: bei einer Serienuebersicht und bei jeder Folge
// ausser der ersten legte die Regel gar nichts an, der Herz-Knopf tat also
// nichts; und wo sie anlegte, trug der Eintrag zehn Prozent Fortschritt und
// stand damit sofort auch in "Weiterschauen".
{
  const merken = (favoriten, url, angaben = {}) =>
    fortschritt.vonHandAnlegen({ favoriten }, ANBIETER, url, angaben);

  const uebersicht = merken([], SERIE, { title: "Naruto", thumbnail: "https://bild/p.jpg" });
  pruefe("Eine Serienuebersicht laesst sich vormerken",
    Boolean(uebersicht.eintrag) && uebersicht.neu === true,
    "die Fortschrittsregel blockte hier, weil es keine Folge 1 ist");
  pruefe("Und steht danach auf der Watchlist",
    uebersicht.eintrag.favorite === true);
  pruefe("Aber nicht in Weiterschauen",
    uebersicht.eintrag.progress === 0
    && fortschritt.hasContinueProgressRecord(uebersicht.eintrag) === false,
    "vorgemerkt und angefangen sind zwei verschiedene Dinge");
  pruefe("Titel und Bild kommen mit",
    uebersicht.eintrag.title === "Naruto" && uebersicht.eintrag.thumbnail === "https://bild/p.jpg");

  const spaeteFolge = merken([], folge(2, 5), { title: "Naruto" });
  pruefe("Auch eine spaete Folge laesst sich vormerken",
    Boolean(spaeteFolge.eintrag) && spaeteFolge.eintrag.season === 2 && spaeteFolge.eintrag.episode === 5,
    "der haeufigste Fall, und genau der ging vorher nicht");

  const zweimal = merken(uebersicht.favoriten, SERIE, { title: "Naruto" });
  pruefe("Zweimal vormerken legt nichts doppelt an",
    zweimal.favoriten.length === 1 && zweimal.neu === false && zweimal.schonDabei === true,
    `${zweimal.favoriten.length} Eintrag(e)`);

  // Ein abgehakter Titel, der wieder vorgemerkt wird: er darf nicht
  // gleichzeitig in Watchlist und Mediathek stehen.
  const abgehakt = [{
    ...uebersicht.eintrag,
    favorite: false,
    completed: true,
    completedManually: true,
    completedAt: "2026-01-01T00:00:00.000Z",
    hideFromContinueWatching: true
  }];
  const zurueck = merken(abgehakt, SERIE, { title: "Naruto" });
  pruefe("Wieder vormerken holt aus der Mediathek zurueck",
    zurueck.eintrag.favorite === true && zurueck.eintrag.completed === false
    && zurueck.eintrag.completedManually === false && zurueck.eintrag.completedAt === "",
    "sonst stuende der Titel gleichzeitig in beiden Listen");
  pruefe("Und der Fortschritt bleibt, wo er war",
    zurueck.eintrag.progress === abgehakt[0].progress);

  pruefe("Ohne brauchbare Adresse entsteht nichts",
    merken([], "keine-adresse", {}).eintrag === null);

  // Dieselbe Serie, nur eine Folge davon: das ist kein zweiter Titel.
  const gleicheSerie = merken(uebersicht.favoriten, folge(1, 1), { title: "Naruto" });
  pruefe("Eine Folge derselben Serie legt keinen zweiten Eintrag an",
    gleicheSerie.favoriten.length === 1 && gleicheSerie.neu === false,
    `${gleicheSerie.favoriten.length} Eintrag(e)`);

  // Der frisch Vorgemerkte steht vorn - er ist das Letzte, was jemand getan hat.
  const zweiter = merken(uebersicht.favoriten,
    "https://aniworld.to/anime/stream/one-piece", { title: "One Piece" });
  pruefe("Der neue Eintrag steht vorn",
    zweiter.favoriten[0] === zweiter.eintrag && zweiter.favoriten.length === 2,
    `${zweiter.favoriten.length} Eintrag(e)`);
}

// und nicht an der Regel - das ist der Zweck der Aufteilung.
{
  const pruefstand = require("../src/fortschritt-proben");
  const proben = require("./fortschritt-proben.json");
  const ergebnisse = pruefstand.fahre(proben);
  for (const ergebnis of ergebnisse) {
    pruefe(`Probe: ${ergebnis.name}`, ergebnis.ok, ergebnis.ok ? ergebnis.ist : `ist "${ergebnis.ist}", soll "${ergebnis.soll}"`);
  }
  pruefe("Der Pruefstand hat wirklich Faelle gefahren",
    ergebnisse.length >= 10, `${ergebnisse.length} Faelle`);
}


// --- Der Eintrag zu einer Runde ----------------------------------------------
//
// Gemeldet: auf Android bleibt "Gemeinsam weiterschauen" leer, waehrend die
// Reihe am Rechner dasteht.
//
// Die Ursache war kein Anzeigefehler. Beide Seiten zeigen dieselbe Bedingung -
// Eintraege mit `watchpartyRoom` -, aber angelegt hat einen solchen Eintrag nur
// der Rechner: `createWatchpartyFavorite` stand in main.js, also an einem Ort,
// den das Telefon nie sieht. Android stieg aus, sobald ein hereinkommender
// Stand keinen Eintrag fand.
//
// Am Geraet nachgestellt (Emulator, echtes Relay, ein zweites Mitglied, das
// meldet): nach zwanzig Sekunden zwei Eintraege in der Ablage, *keiner* mit
// Raum, der eingestellte Titel gar nicht. Die Regel steht jetzt hier, und beide
// Seiten rufen sie.
{
  const anbieter = {
    id: "aniworld", name: "Aniworld", logo: "AN", startUrl: "https://aniworld.to/"
  };
  const raumEintrag = {
    title: "BLACK TORCH", type: "serie", thumbnail: "cover.jpg",
    url: "https://aniworld.to/anime/stream/black-torch/staffel-1/episode-4"
  };
  const stand = {
    url: raumEintrag.url, season: 1, episode: 4,
    position: 420, duration: 1400, progress: 30,
    from: "Rechner", updatedAt: "2026-08-28T10:00:00.000Z"
  };

  const erst = fortschritt.watchpartyEintragAnlegen({ favoriten: [] }, anbieter, "Probe",
    raumEintrag, stand);
  pruefe("Ein Stand aus der Runde legt einen Eintrag an", erst.neu === true && Boolean(erst.eintrag));
  pruefe("Und der traegt seinen Raum",
    erst.eintrag.watchpartyRoom === "Probe", JSON.stringify(erst.eintrag.watchpartyRoom));
  pruefe("Mit Folge und Stelle aus der Meldung",
    erst.eintrag.season === 1 && erst.eintrag.episode === 4 && erst.eintrag.position === 420,
    `S${erst.eintrag.season}E${erst.eintrag.episode} bei ${erst.eintrag.position}`);
  pruefe("Angesehen, aber nicht vorgemerkt",
    erst.eintrag.watched === true && erst.eintrag.favorite === false,
    "er kommt aus der Runde, niemand hat ihn gemerkt");

  const zustand = { favoriten: erst.favoriten };
  const zweit = fortschritt.watchpartyEintragAnlegen(zustand, anbieter, "Probe", raumEintrag, stand);
  pruefe("Der zweite Stand legt keinen zweiten Eintrag an",
    zweit.neu === false && zweit.eintrag === erst.eintrag);

  // Der Raum steht bei Folge 9, der Eintrag noch bei Folge 4 - gesucht wird
  // ueber die Serie, nicht ueber die volle Adresse.
  const spaeter = "https://aniworld.to/anime/stream/black-torch/staffel-1/episode-9";
  const weiter = fortschritt.watchpartyEintragAnlegen(zustand, anbieter, "Probe",
    { ...raumEintrag, url: spaeter }, { ...stand, url: spaeter, episode: 9 });
  pruefe("Eine spaetere Folge findet denselben Eintrag", weiter.neu === false);

  // Der eigene, private Eintrag darf nie der der Runde werden: sonst liefe der
  // fremde Stand in den eigenen Verlauf. Genau das tat die Android-Fassung mit
  // ihrem zuSerie(), das den Raum gar nicht ansah.
  const privat = { id: "privat", url: raumEintrag.url, watchpartyRoom: "" };
  const nebenPrivat = fortschritt.watchpartyEintragAnlegen({ favoriten: [privat] }, anbieter,
    "Probe", raumEintrag, stand);
  pruefe("Der private Eintrag wird nicht zum Eintrag der Runde",
    nebenPrivat.neu === true && nebenPrivat.eintrag !== privat && privat.watchpartyRoom === "");

  // Jeder Raum fuehrt seinen eigenen Stand.
  const zweiterRaum = fortschritt.watchpartyEintragAnlegen({ favoriten: erst.favoriten }, anbieter,
    "Anderer", raumEintrag, stand);
  pruefe("Ein zweiter Raum bekommt einen eigenen Eintrag", zweiterRaum.neu === true);

  // Ohne Raum gehoert nichts angelegt: der eigene Stand bleibt privat.
  const ohneRaum = fortschritt.watchpartyEintragAnlegen({ favoriten: [] }, anbieter, "",
    raumEintrag, stand);
  pruefe("Ohne Raumcode entsteht kein Eintrag", ohneRaum.eintrag === null);
  const ohneAnbieter = fortschritt.watchpartyEintragAnlegen({ favoriten: [] }, null, "Probe",
    raumEintrag, stand);
  pruefe("Und ohne Anbieter ebenfalls nicht", ohneAnbieter.eintrag === null);

  /* --- Ein Eintrag, der stehengeblieben ist ------------------------------ */
  //
  // Gemeldet am 29.08.2026: "Avatar Aang" wurde am Rechner in der Runde
  // "Bangus" zu Ende geschaut und stand am Fernseher drei Tage spaeter immer
  // noch in "Gemeinsam weiterschauen". Kein Wunder - ein Stand aus der Runde
  // wurde bisher nur uebernommen, wenn er als *Meldung* hereinkam, also nur
  // von einem Geraet, das gerade lief. Der Raumzustand traegt ihn trotzdem
  // mit, bei jedem Verbinden.
  const alt = { ...erst.eintrag, watchpartyAt: "2026-08-28T10:00:00.000Z" };
  const fertig = { ...stand, completed: true, progress: 100, position: 1400,
    updatedAt: "2026-08-28T22:00:00.000Z" };
  const nachgezogen = fortschritt.watchpartyEintragAbgleichen(alt, fertig);
  pruefe("Ein juengerer Stand aus dem Raumzustand zieht den Eintrag nach",
    nachgezogen.art === "aendern" && nachgezogen.aenderung.completed === true,
    JSON.stringify(nachgezogen.art));

  // Aber nur, wenn er wirklich juenger ist: sonst ueberschriebe ein
  // liegengebliebener Raumzustand den Stand eines Geraets, das gerade selbst
  // weitergeschaut hat.
  const neuerHier = { ...erst.eintrag, watchpartyAt: "2026-08-29T09:00:00.000Z" };
  pruefe("Ein aelterer Stand aendert nichts",
    fortschritt.watchpartyEintragAbgleichen(neuerHier, fertig).art === "nichts");
  pruefe("Und derselbe Zeitpunkt auch nicht",
    fortschritt.watchpartyEintragAbgleichen(
      { ...erst.eintrag, watchpartyAt: fertig.updatedAt }, fertig).art === "nichts");
  pruefe("Ohne Zeitpunkt im Stand geschieht nichts",
    fortschritt.watchpartyEintragAbgleichen(alt, { ...fertig, updatedAt: "" }).art === "nichts");
}

const fehler = pruefungen.filter((x) => !x).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
