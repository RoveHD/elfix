"use strict";

// Die Datenbasis fuer den Rueckblick.
//
// Hier stehen die Regeln, nicht die Ablage: was als geschaute Zeit zaehlt, wann
// eine Sitzung endet, wie aus einzelnen Folgen ein Abend wird. Das Modul kennt
// weder Electron noch das Dateisystem - deshalb laesst es sich vollstaendig
// pruefen, und genau darauf kommt es an. Eine falsch gemessene Stunde faellt
// niemandem auf; sie steht ein Jahr spaeter als Zahl da und ist nicht mehr zu
// widerlegen.
//
// Der Grundsatz, dem alles Weitere folgt: **es wird nichts hochgerechnet.**
// Eine Folge mit 24 Minuten Laufzeit ergibt keine 24 Minuten Wiedergabe. Was
// nicht gemessen wurde, bleibt unbekannt und wird als unbekannt ausgewiesen -
// nicht als Null, denn Null ist eine Behauptung.

// --- Wiedergabezeit ----------------------------------------------------------
//
// Gemessen wird die Zeit nicht hier, sondern in der Anbieterseite: dort
// vergleicht ein Takt die Position des Players mit der real vergangenen Zeit
// und addiert nur, was zu beidem passt (siehe naturalPlaybackDelta in main.js).
// Pause bewegt die Position nicht, ein Sprung nach vorn bewegt sie zu weit, und
// ein schlafender Rechner bewegt sie gar nicht. Was hier ankommt, ist also
// bereits bereinigt.
//
// Was hier passiert, ist das Zweite, ohne das die Messung wertlos waere: aus
// einer laufenden Zahl werden abgeschlossene Datensaetze, die einen Neustart,
// einen Seitenwechsel und einen Absturz ueberleben.

// Laenger keine Meldung: die Wiedergabe gilt als beendet. Der Fortschritt
// meldet sich im Sekundentakt, solange etwas laeuft - fuenf Minuten Stille
// heissen, dass nichts mehr laeuft.
const SITZUNG_STILLE_MS = 5 * 60 * 1000;

// Beim Auswerten: so lange darf zwischen zwei Folgen Pause sein, damit sie noch
// als ein Abend zaehlen. Wer nach dem Abendessen weiterschaut, hat nicht zweimal
// geschaut; wer am naechsten Tag weitermacht, schon.
const SITZUNG_LUECKE_MS = 30 * 60 * 1000;

// Ein Tag zaehlt als Schautag ab dieser gemessenen Zeit. Dieselbe Schwelle, ab
// der ELFIX eine Folge ueberhaupt als angefangen ansieht - eine zweite Zahl
// dafuer zu erfinden, waere eine zweite Wahrheit.
const SCHAUTAG_SEKUNDEN = 150;

// Wie verlaesslich eine Zahl ist. Der Unterschied gehoert in die Daten, nicht in
// eine Fussnote: aus "abgeschlossen, Zeit unbekannt" darf nie eine Stundenzahl
// werden.
const GEMESSEN = "gemessen";
const REKONSTRUIERT = "rekonstruiert";

function zahl(wert) {
  const n = Number(wert);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function text(wert) {
  return String(wert == null ? "" : wert);
}

// Der Kalendertag in der Zeit des Geraets. Ausdruecklich nicht UTC: wer um
// halb eins nachts eine Folge schaut, hat das an diesem Abend getan und nicht
// am Tag davor. Eine feste Zeitzone waere genauso falsch - ELFIX laeuft dort,
// wo sein Benutzer sitzt.
function tagesschluessel(zeit) {
  const datum = zeit instanceof Date ? zeit : new Date(zeit);
  if (!Number.isFinite(datum.getTime())) return "";
  return `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, "0")}-${String(datum.getDate()).padStart(2, "0")}`;
}

// Welche Gattung. Der vorhandene Typ an den Favoriten kennt nur Serie und Film -
// "anime" wird dort seit jeher zu "serie" zusammengefasst, und daran haengen
// Mediathek, Empfehlungen und die Fortschrittslogik. Statt das anzufassen, wird
// die Gattung hier eigens bestimmt und nur fuer die Statistik gefuehrt.
//
// Die Reihenfolge ist Absicht: eine AniList-Kennung ist ein Beleg, ein
// Anbietername ein starkes Indiz, ein Pfadbestandteil ein schwaches.
function gattungBestimmen(quelle = {}) {
  if (String(quelle.type || "").toLowerCase() === "film") return "film";
  if (quelle.anilist) return "anime";
  if (/aniworld/i.test(text(quelle.providerName))) return "anime";
  if (/\/anime(?:\/|$)/i.test(text(quelle.url))) return "anime";
  return String(quelle.type || "").toLowerCase() === "serie" ? "serie" : "serie";
}

// --- Die laufende Sitzung ----------------------------------------------------

// Eine Meldung des Fortschritts-Takts wird in die offene Sitzung eingearbeitet.
// Zurueck kommt, was zu tun ist: weiterschreiben, abschliessen und neu
// beginnen, oder nichts.
//
// Drei Faelle beenden eine Sitzung und beginnen eine neue:
//
// Eine andere Adresse - also eine andere Folge, ein anderer Titel, ein anderer
// Anbieter.
//
// Ein Rueckschritt der gemessenen Zeit. Der Zaehler in der Seite beginnt bei
// jedem Laden neu; faellt er, wurde die Seite neu geladen, und das ist ein
// zweites Anschauen derselben Folge.
//
// Und eine lange Stille davor. Wer eine Folge offen liegen laesst und Stunden
// spaeter weiterschaut, hat zweimal geschaut.
function meldungEinarbeiten(offen, meldung, jetzt = Date.now()) {
  const gemeldet = zahl(meldung?.sekunden);
  const adresse = text(meldung?.url);
  if (!adresse) return { tat: "nichts", offen };

  if (!offen) {
    return { tat: "beginnen", offen: sitzungBeginnen(meldung, jetzt) };
  }

  const andereAdresse = offen.url !== adresse;
  const zaehlerNeu = gemeldet + 0.5 < zahl(offen.gemeldet);
  const langeStill = jetzt - zahl(offen.zuletzt) > SITZUNG_STILLE_MS;

  if (andereAdresse || zaehlerNeu || langeStill) {
    return {
      tat: "wechseln",
      geschlossen: sitzungSchliessen(offen),
      offen: sitzungBeginnen(meldung, jetzt)
    };
  }

  return { tat: "weiter", offen: sitzungFortschreiben(offen, meldung, jetzt) };
}

function sitzungBeginnen(meldung, jetzt) {
  const beginn = new Date(jetzt).toISOString();
  return {
    id: text(meldung?.id) || `s${jetzt}-${Math.random().toString(36).slice(2, 8)}`,
    favoriteId: text(meldung?.favoriteId),
    url: text(meldung?.url),
    titel: text(meldung?.titel),
    providerId: text(meldung?.providerId),
    anbieter: text(meldung?.providerName),
    gattung: gattungBestimmen(meldung),
    season: zahl(meldung?.season),
    episode: zahl(meldung?.episode),
    begonnenAm: beginn,
    beendetAm: beginn,
    // Die gemessene Zeit der Seite ist kumulativ, seit ihr Zaehler laeuft.
    // Beginnt eine Sitzung mitten darin - etwa nach einem Neustart von ELFIX -,
    // gehoert das schon Gezaehlte nicht dazu: gemessen wurde es, aber nicht in
    // dieser Sitzung. Deshalb der Versatz.
    versatz: zahl(meldung?.sekunden),
    gemeldet: zahl(meldung?.sekunden),
    sekunden: 0,
    startPosition: zahl(meldung?.position),
    endPosition: zahl(meldung?.position),
    laufzeit: zahl(meldung?.laufzeit),
    abgeschlossen: Boolean(meldung?.abgeschlossen),
    wiederholung: Boolean(meldung?.wiederholung),
    qualitaet: GEMESSEN,
    zuletzt: jetzt
  };
}

function sitzungFortschreiben(offen, meldung, jetzt) {
  const gemeldet = zahl(meldung?.sekunden);
  return {
    ...offen,
    gemeldet,
    // Nie kleiner werden: ein zwischenzeitlich verlorener Takt darf die
    // gemessene Zeit nicht wieder abschmelzen.
    sekunden: Math.max(zahl(offen.sekunden), Math.max(0, gemeldet - zahl(offen.versatz))),
    endPosition: zahl(meldung?.position) || zahl(offen.endPosition),
    laufzeit: zahl(meldung?.laufzeit) || zahl(offen.laufzeit),
    // Einmal abgeschlossen bleibt abgeschlossen: der Stand faellt nicht
    // zurueck, nur weil der Abspann laeuft und die Prozentzahl kippt.
    abgeschlossen: Boolean(offen.abgeschlossen) || Boolean(meldung?.abgeschlossen),
    beendetAm: new Date(jetzt).toISOString(),
    zuletzt: jetzt
  };
}

// Was in die Ablage geht. Die Felder, die nur waehrend des Laufens gebraucht
// werden, bleiben draussen - sie waeren beim naechsten Start bedeutungslos.
function sitzungSchliessen(offen) {
  if (!offen) return null;
  const { versatz, gemeldet, zuletzt, ...rest } = offen;
  void versatz; void gemeldet; void zuletzt;
  return { ...rest, sekunden: Math.round(zahl(offen.sekunden)) };
}

// Eine Sitzung, die nichts hergibt, gehoert nicht in die Ablage. Zwei Sekunden
// beim Durchklicken sind kein Schauen, und tausend solcher Zeilen machen jede
// spaetere Auswertung langsamer und ungenauer.
function sitzungLohnt(sitzung) {
  return Boolean(sitzung) && (zahl(sitzung.sekunden) >= 5 || sitzung.abgeschlossen);
}

// --- Auswerten ---------------------------------------------------------------

function imZeitraum(sitzung, von, bis) {
  const zeit = Date.parse(sitzung?.begonnenAm || "");
  if (!Number.isFinite(zeit)) return false;
  if (Number.isFinite(von) && zeit < von) return false;
  if (Number.isFinite(bis) && zeit > bis) return false;
  return true;
}

// Aufeinanderfolgende Sitzungen zu einem Abend verketten. Gruppiert wird nach
// Zeit, nicht nach Titel: wer drei Folgen und danach einen Film schaut, hat
// einen Abend verbracht und nicht zwei.
function abende(sitzungen, luecke = SITZUNG_LUECKE_MS) {
  const sortiert = [...sitzungen].sort((links, rechts) =>
    Date.parse(links.begonnenAm) - Date.parse(rechts.begonnenAm));
  const gruppen = [];
  for (const sitzung of sortiert) {
    const beginn = Date.parse(sitzung.begonnenAm);
    // Nie vor dem Anfang: ein Satz mit verdrehten Zeitstempeln - aus einem
    // Absturz oder einer verstellten Systemuhr - wuerde sonst jede folgende
    // Sitzung aus der Gruppe werfen und den Abend in Einzelteile zerlegen.
    const ende = Math.max(beginn, Date.parse(sitzung.beendetAm) || beginn);
    const letzte = gruppen[gruppen.length - 1];
    if (letzte && beginn - letzte.ende <= luecke) {
      letzte.ende = Math.max(letzte.ende, ende);
      letzte.sekunden += zahl(sitzung.sekunden);
      letzte.teile += 1;
      continue;
    }
    gruppen.push({ beginn, ende, sekunden: zahl(sitzung.sekunden), teile: 1 });
  }
  return gruppen;
}

// Die laengste Folge aufeinanderliegender Tage. Ein Tag Pause beendet sie.
function strecke(tage) {
  const sortiert = [...new Set(tage)].sort();
  if (!sortiert.length) return { tage: 0, von: "", bis: "" };
  const alsZahl = (tag) => Math.floor(Date.parse(`${tag}T12:00:00`) / 86400000);
  let beste = { tage: 1, von: sortiert[0], bis: sortiert[0] };
  let laenge = 1;
  let start = sortiert[0];
  for (let i = 1; i < sortiert.length; i += 1) {
    if (alsZahl(sortiert[i]) - alsZahl(sortiert[i - 1]) === 1) laenge += 1;
    else { laenge = 1; start = sortiert[i]; }
    if (laenge > beste.tage) beste = { tage: laenge, von: start, bis: sortiert[i] };
  }
  return beste;
}

// Die Strecke, die bis heute reicht - null, wenn gestern und heute nichts lief.
function laufendeStrecke(tage, heute) {
  const gesetzt = new Set(tage);
  const alsZahl = (tag) => Math.floor(Date.parse(`${tag}T12:00:00`) / 86400000);
  const vomTag = (zahlwert) => {
    const datum = new Date(zahlwert * 86400000 + 43200000);
    return tagesschluessel(datum);
  };
  const heuteZahl = alsZahl(heute);
  let start = heuteZahl;
  if (!gesetzt.has(vomTag(heuteZahl))) {
    // Heute noch nichts: die Strecke darf trotzdem stehen, solange gestern
    // gelaufen ist. Sonst waere sie jeden Morgen weg.
    if (!gesetzt.has(vomTag(heuteZahl - 1))) return 0;
    start = heuteZahl - 1;
  }
  let laenge = 0;
  while (gesetzt.has(vomTag(start - laenge))) laenge += 1;
  return laenge;
}

// Zeit anteilig auf die Genres eines Titels verteilen.
//
// Ein Titel mit drei Genres und einer Stunde Wiedergabe ergibt dreimal zwanzig
// Minuten, nicht dreimal eine Stunde. Sonst summierte sich die Zeit ueber die
// Genres auf ein Vielfaches der tatsaechlich geschauten - eine Zahl, die
// niemand nachvollziehen kann und die mit jedem zusaetzlichen Genre waechst.
function genreAnteile(genres, sekunden) {
  const liste = (genres || []).filter((eintrag) => eintrag && eintrag.key);
  if (!liste.length) return [];
  const anteil = zahl(sekunden) / liste.length;
  return liste.map((genre) => ({ key: genre.key, label: genre.label || genre.key, sekunden: anteil }));
}

// Sortiert nach dem gefragten Wert - und wo der ueberall null ist, nach der
// Anzahl. Ohne diesen zweiten Schluessel faellt eine Liste aus uebernommenen
// Daten auf die alphabetische Reihenfolge zurueck, und ganz oben steht der
// Titel, der zufaellig mit einer Ziffer beginnt.
function bestenliste(karte, schluessel = "sekunden", grenze = 10) {
  return [...karte.values()]
    .sort((links, rechts) => (rechts[schluessel] - links[schluessel])
      || (zahl(rechts.folgen) - zahl(links.folgen))
      || (zahl(rechts.titel) - zahl(links.titel))
      || String(links.label || links.titel || "").localeCompare(String(rechts.label || rechts.titel || ""), "de"))
    .slice(0, grenze);
}

// Die eine Auswertung, aus der die Seite alles bezieht.
//
// `sitzungen` sind die gespeicherten Datensaetze, `titel` liefert zu einer
// Adresse, was die vorhandenen Caches ueber den Titel wissen - Genres, Poster,
// Kennungen. Nichts davon wird hier geholt: dieses Modul rechnet nur.
function auswerten(sitzungen, optionen = {}) {
  const von = Number.isFinite(optionen.von) ? optionen.von : Date.parse(optionen.von || "");
  const bis = Number.isFinite(optionen.bis) ? optionen.bis : Date.parse(optionen.bis || "");
  const heute = optionen.heute || tagesschluessel(new Date());
  const titelInfo = typeof optionen.titel === "function" ? optionen.titel : () => ({});

  const gewaehlt = (sitzungen || []).filter((sitzung) => imZeitraum(sitzung, von, bis));
  const gemessene = gewaehlt.filter((sitzung) => sitzung.qualitaet !== REKONSTRUIERT);

  const sekunden = gemessene.reduce((summe, sitzung) => summe + zahl(sitzung.sekunden), 0);
  const jeTag = new Map();
  const genres = new Map();
  const titel = new Map();
  const wochentage = new Map();
  const monate = new Map();
  const tageszeiten = new Map();
  const folgenSchluessel = new Set();
  const abgeschlosseneFolgen = new Set();
  // Abgeschlossene Titel je Gattung. Gezaehlt wird der Titel, nicht die Folge:
  // eine Serie mit zwoelf abgeschlossenen Folgen ist eine abgeschlossene Serie,
  // nicht zwoelf.
  const fertigeTitel = new Map();
  let wiederholungen = 0;

  for (const sitzung of gewaehlt) {
    const zeit = Date.parse(sitzung.begonnenAm);
    const tag = tagesschluessel(new Date(zeit));
    const eigene = zahl(sitzung.sekunden);
    const stand = jeTag.get(tag) || { tag, sekunden: 0, sitzungen: 0, folgen: 0 };
    stand.sekunden += eigene;
    stand.sitzungen += 1;
    jeTag.set(tag, stand);

    // Wochentag und Monat tragen beides: gemessene Zeit und Anzahl. Ohne die
    // Anzahl waeren beide Angaben aus uebernommenen Daten immer null - und ein
    // "aktivster Wochentag: Sonntag, 0 Minuten" ist keine Aussage, sondern ein
    // Artefakt.
    const wochentag = new Date(zeit).getDay();
    const wStand = wochentage.get(wochentag) || { tag: wochentag, sekunden: 0, folgen: 0 };
    wStand.sekunden += eigene;
    wStand.folgen += sitzung.wiederholung ? 0 : 1;
    wochentage.set(wochentag, wStand);
    // Tageszeit: nach dem Beginn der Sitzung. Die Grenzen stehen fest und
    // ausdruecklich im Code, damit "Nachteule" eine Definition hat und keine
    // Stimmung ist: 22 bis 4 Uhr.
    const stunde = new Date(zeit).getHours();
    const fach = stunde >= 22 || stunde < 4 ? "nacht"
      : stunde < 12 ? "morgen"
        : stunde < 18 ? "nachmittag" : "abend";
    const tStand = tageszeiten.get(fach) || { fach, sekunden: 0, folgen: 0 };
    tStand.sekunden += eigene;
    tStand.folgen += sitzung.wiederholung ? 0 : 1;
    tageszeiten.set(fach, tStand);

    const monat = tag.slice(0, 7);
    const mStand = monate.get(monat) || { monat, sekunden: 0, folgen: 0 };
    mStand.sekunden += eigene;
    mStand.folgen += sitzung.wiederholung ? 0 : 1;
    monate.set(monat, mStand);

    // Eine Folge zaehlt einmal, auch wenn sie ueber mehrere Sitzungen lief.
    // Ein zweites Anschauen ist keine zweite Folge, sondern eine Wiederholung -
    // sonst stuenden am Ende mehr Folgen da, als es gibt.
    const kennung = sitzung.favoriteId
      ? `${sitzung.favoriteId}|${sitzung.season}|${sitzung.episode}`
      : sitzung.url;
    if (sitzung.wiederholung) wiederholungen += 1;
    else folgenSchluessel.add(kennung);
    if (sitzung.abgeschlossen && !sitzung.wiederholung) {
      abgeschlosseneFolgen.add(kennung);
      const titelKennung = sitzung.favoriteId || sitzung.titel || sitzung.url;
      if (titelKennung) fertigeTitel.set(titelKennung, sitzung.gattung || "serie");
    }
    stand.folgen = stand.folgen + (sitzung.wiederholung ? 0 : 1);

    const info = titelInfo(sitzung) || {};
    const name = sitzung.titel || info.titel || sitzung.url;
    const titelStand = titel.get(name) || {
      titel: name,
      gattung: sitzung.gattung,
      anbieter: sitzung.anbieter,
      bild: info.bild || "",
      sekunden: 0,
      folgen: 0,
      wiederholungen: 0
    };
    titelStand.sekunden += eigene;
    titelStand.folgen += sitzung.wiederholung ? 0 : 1;
    titelStand.wiederholungen += sitzung.wiederholung ? 1 : 0;
    if (!titelStand.bild && info.bild) titelStand.bild = info.bild;
    titel.set(name, titelStand);

    for (const anteil of genreAnteile(info.genres, eigene)) {
      const genreStand = genres.get(anteil.key)
        || { key: anteil.key, label: anteil.label, sekunden: 0, titel: new Set() };
      genreStand.sekunden += anteil.sekunden;
      genreStand.titel.add(name);
      genres.set(anteil.key, genreStand);
    }
  }

  // Schautage: Tage, an denen wirklich geschaut wurde. Ein Tag, an dem ELFIX
  // nur offen stand, ist keiner - solche Ereignisse kommen hier gar nicht an.
  //
  // Die Zeitschwelle greift nur, wo Zeit gemessen wurde. Aus uebernommenen
  // Altdaten ist bekannt, DASS an einem Tag eine Folge lief, nicht wie lange;
  // diese Tage an einer Sekundenschwelle scheitern zu lassen hiesse, eine
  // ganze Vorgeschichte zu verlieren, die tatsaechlich stattgefunden hat.
  const schautage = [...jeTag.values()]
    .filter((stand) => stand.sekunden >= SCHAUTAG_SEKUNDEN
      || (stand.sekunden === 0 && stand.folgen > 0))
    .map((stand) => stand.tag)
    .sort();

  // Fuer die Sitzungsdauer zaehlt nur Gemessenes - ohne Zeit gibt es keine
  // Sitzungslaenge. Fuer den Marathon dagegen zaehlt jede Sitzung: wie viele
  // Folgen an einem Stueck liefen, weiss man auch ohne Uhr.
  const bloecke = abende(gemessene);
  const alleBloecke = abende(gewaehlt);
  const marathon = alleBloecke.reduce((beste, block) =>
    (!beste || block.teile > beste.teile ? block : beste), null);
  const laengster = bloecke.reduce((beste, block) =>
    (!beste || block.sekunden > beste.sekunden ? block : beste), null);
  const bestesTag = [...jeTag.values()]
    .sort((links, rechts) => (rechts.sekunden - links.sekunden)
      || (rechts.folgen - links.folgen) || links.tag.localeCompare(rechts.tag))[0] || null;

  const nachZeit = [...gewaehlt].sort((links, rechts) =>
    Date.parse(links.begonnenAm) - Date.parse(rechts.begonnenAm));

  return {
    // Der Zeitraum, den die Zahlen wirklich abdecken - nicht der angefragte.
    von: nachZeit[0]?.begonnenAm || "",
    bis: nachZeit[nachZeit.length - 1]?.beendetAm || "",
    sitzungen: gewaehlt.length,

    // Wiedergabezeit steht nur, wenn sie gemessen wurde. `sekundenBekannt`
    // sagt, fuer wie viele Sitzungen das gilt - ohne diese Zahl waere die
    // Stundenangabe eine Behauptung ueber alles.
    sekunden: Math.round(sekunden),
    sekundenBekannt: gemessene.length,
    sekundenGesamt: gewaehlt.length,

    folgen: folgenSchluessel.size,
    folgenAbgeschlossen: abgeschlosseneFolgen.size,
    abschluesse: {
      gesamt: fertigeTitel.size,
      serie: [...fertigeTitel.values()].filter((art) => art === "serie").length,
      film: [...fertigeTitel.values()].filter((art) => art === "film").length,
      anime: [...fertigeTitel.values()].filter((art) => art === "anime").length
    },
    wiederholungen,

    tage: schautage.length,
    strecke: strecke(schautage),
    laufendeStrecke: laufendeStrecke(schautage, heute),
    aktivsterTag: bestesTag,
    // Sortiert nach dem, was bekannt ist: gibt es gemessene Zeit, entscheidet
    // sie; sonst die Anzahl der Folgen.
    aktivsterWochentag: [...wochentage.values()]
      .sort((links, rechts) => (rechts.sekunden - links.sekunden)
        || (rechts.folgen - links.folgen) || (links.tag - rechts.tag))[0] || null,
    aktivsterMonat: [...monate.values()]
      .sort((links, rechts) => (rechts.sekunden - links.sekunden)
        || (rechts.folgen - links.folgen) || links.monat.localeCompare(rechts.monat))[0] || null,

    // Der erste und der letzte Titel des Zeitraums - fuer den Anfang und das
    // Ende der Geschichte.
    erster: nachZeit[0]
      ? { titel: nachZeit[0].titel, wann: nachZeit[0].begonnenAm, gattung: nachZeit[0].gattung,
        bild: (titelInfo(nachZeit[0]) || {}).bild || "" }
      : null,
    letzter: nachZeit.length
      ? { titel: nachZeit[nachZeit.length - 1].titel, wann: nachZeit[nachZeit.length - 1].begonnenAm,
        gattung: nachZeit[nachZeit.length - 1].gattung,
        bild: (titelInfo(nachZeit[nachZeit.length - 1]) || {}).bild || "" }
      : null,
    tageszeiten: [...tageszeiten.values()],
    monate: [...monate.values()].sort((links, rechts) => links.monat.localeCompare(rechts.monat)),
    marathon: marathon && marathon.teile > 1 ? marathon.teile : 0,
    // Wie viele verschiedene Titel ueberhaupt liefen.
    welten: titel.size,

    laengsteSitzung: laengster ? Math.round(laengster.sekunden) : 0,
    sitzungsschnitt: bloecke.length ? Math.round(sekunden / bloecke.length) : 0,
    folgenJeTag: schautage.length
      ? Math.round((folgenSchluessel.size / schautage.length) * 10) / 10
      : 0,

    genres: bestenliste(new Map([...genres].map(([key, wert]) =>
      [key, { ...wert, titel: wert.titel.size, sekunden: Math.round(wert.sekunden) }])), "sekunden", 8),
    titel: bestenliste(titel, "sekunden", 10),
    serien: bestenliste(new Map([...titel].filter(([, wert]) => wert.gattung !== "film")), "sekunden", 5),
    filme: bestenliste(new Map([...titel].filter(([, wert]) => wert.gattung === "film")), "sekunden", 5),
    wiederholteste: bestenliste(titel, "wiederholungen", 3).filter((eintrag) => eintrag.wiederholungen > 0),
    verlauf: [...jeTag.values()].sort((links, rechts) => links.tag.localeCompare(rechts.tag))
  };
}

module.exports = {
  SITZUNG_STILLE_MS,
  SITZUNG_LUECKE_MS,
  SCHAUTAG_SEKUNDEN,
  GEMESSEN,
  REKONSTRUIERT,
  tagesschluessel,
  gattungBestimmen,
  meldungEinarbeiten,
  sitzungSchliessen,
  sitzungLohnt,
  abende,
  strecke,
  laufendeStrecke,
  genreAnteile,
  auswerten
};
