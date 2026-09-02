"use strict";

// Externe Metadaten fuer die App.
//
// Gegenstueck zu sync-server/metadaten.js. Dort liegt der TMDB-Schluessel und
// die Anbindung an TMDB und AniList; hier liegt alles, was das Geraet selbst
// tut: fragen, merken, pruefen und aufgeben, wenn niemand antwortet.
//
// Drei Regeln bestimmen den Aufbau.
//
//   1. Der Start wartet auf nichts. Empfehlungen entstehen aus dem, was im
//      lokalen Cache liegt - auch wenn das nichts ist. Was fehlt, wird im
//      Hintergrund nachgeholt und wirkt sich beim naechsten Durchlauf aus.
//      Deshalb gibt es zwei getrennte Wege: `ausCache` fragt nie das Netz,
//      `nachschlagen` fragt es nur fuer das, was fehlt.
//
//   2. Ein falscher Treffer ist schlimmer als keiner. Der Server liefert eine
//      Konfidenz mit; die wird hier nicht uebernommen, sondern nachgerechnet.
//      Beispiel aus dem echten Betrieb: die Suche nach dem Film "Es" liefert
//      "Es war einmal in Deutschland" - ein Wort, das zufaellig am Anfang eines
//      viel laengeren Titels steht, dazu das passende Jahr. Der Server nennt
//      das HIGH. Hier faellt es durch.
//
//      Die Korrektur geht in beide Richtungen, und das ist Absicht. Sie ging
//      lange nur nach unten - und damit blieb die Haelfte der Fehler stehen:
//      die Anbieter schreiben "Dragonball", AniList "Dragon Ball", der Server
//      sieht keine gemeinsamen Woerter und meldet LOW. Der richtige Treffer
//      war es trotzdem, nur getraut hat sich niemand. Nach oben ist die
//      Korrektur eng gefasst (siehe `pruefen`): identischer Name, passendes
//      Jahr, hoechstens bis HIGH.
//
//   3. Ausfall ist ein Betriebszustand. Kein Netz, ein Timeout, HTTP 429 oder
//      Unsinn im Koerper fuehren zu genau einer Folge: es gibt keine externen
//      Daten, und die Empfehlungen entstehen wie vorher aus den Anbieterdaten.
//      Nach mehreren Fehlschlaegen wird eine Weile gar nicht mehr gefragt,
//      damit nicht jeder Durchlauf in dieselbe Zeitgrenze laeuft.

// Erhoehen, wenn sich aendert, WIE die Konfidenz zustande kommt - dann sind
// gespeicherte Eintraege nicht alt, sondern nach einer anderen Regel bewertet.
// 2: die Nachpruefung korrigiert seither auch nach oben, und "Dragonball" gilt
// als derselbe Name wie "Dragon Ball".
const CACHE_VERSION = 2;

// Wie lange gilt ein Treffer? Beziehungen, Sammlungen und Schlagworte aendern
// sich selten. Bekanntheit und Bewertung aendern sich staendig, sind aber die
// schwaechsten Signale - dafuer lohnt kein zweiter Takt.
const GUT_MS = 21 * 24 * 3600 * 1000;
// "Nicht gefunden" ist ein Ergebnis und wird gemerkt, sonst fragt jeder
// Durchlauf erneut nach denselben zweihundert Titeln. Aber kuerzer: ein Werk
// kann bei TMDB nachgetragen werden.
const NICHT_GEFUNDEN_MS = 5 * 24 * 3600 * 1000;
// Ein Ausfall ist kein Ergebnis. Er wird nur kurz gemerkt, damit ein kaputter
// Durchlauf nicht sofort den naechsten belastet.
const FEHLER_MS = 20 * 60 * 1000;

// Der Server nimmt hoechstens 25 Titel je Anfrage. Anime beantwortet er als
// Stapel (eine AniList-Abfrage fuer zehn Titel), Filme und Serien dagegen
// nacheinander - jeder mit bis zu zwei TMDB-Abrufen. Ein voller Stapel Filme
// dauert deshalb ein Vielfaches eines vollen Stapels Anime. Kleinere Stapel
// halten die einzelne Anfrage kurz genug, um sie sinnvoll begrenzen zu koennen.
const STAPEL_ANIME = 25;
const STAPEL_WERK = 10;
const TIMEOUT_MS = 45 * 1000;
const STATUS_TIMEOUT_MS = 6 * 1000;
// Zwischen zwei Stapeln wird gewartet. Der Server laesst je Adresse 60
// Anfragen und 300 Titel in der Minute zu - das hier bleibt deutlich darunter,
// auch wenn zwei Geraete desselben Anschlusses gleichzeitig anreichern.
const PAUSE_MS = 1200;
// Mehr als das holt ein einzelner Anreicherungslauf nicht. Der Rest kommt beim
// naechsten Mal; die Reihenfolge entscheidet, was zuerst drankommt.
//
// 250 Titel sind rund 25 Anfragen und liegen damit unter beiden Grenzen des
// Relays (60 Anfragen und 300 Titel je Minute), selbst wenn zwei Geraete
// desselben Anschlusses gleichzeitig anreichern. Bei 150 blieb von einem
// Kandidatenpool aus mehreren tausend Titeln zu wenig uebrig: die sichtbaren
// Karten waren nur zu einem Drittel zugeordnet, und ohne Zuordnung gibt es
// keinen externen Grund - unabhaengig davon, wie die Schwellen stehen.
const MAX_JE_LAUF = 250;

// Nach so vielen Fehlschlaegen hintereinander wird eine Weile gar nicht mehr
// gefragt.
const AUSFALL_SCHWELLE = 3;
const AUSFALL_PAUSE_MS = 5 * 60 * 1000;

// So viele Eintraege haelt der Cache. Darueber fliegt der aelteste zuerst.
const CACHE_MAX = 4000;

const KONFIDENZ_RANG = { UNMATCHED: 0, LOW: 1, MEDIUM: 2, HIGH: 3, EXACT: 4 };
const RANG_KONFIDENZ = ["UNMATCHED", "LOW", "MEDIUM", "HIGH", "EXACT"];

function rang(konfidenz) {
  return KONFIDENZ_RANG[String(konfidenz || "").toUpperCase()] ?? 0;
}

// --- Namen vergleichen -------------------------------------------------------

function normalisieren(wert) {
  return String(wert || "").toLowerCase()
    .replace(/[‘’'`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const worte = (wert) => normalisieren(wert).split(" ").filter(Boolean);

// Wie gut deckt ein gesuchter Name einen gefundenen?
//
// Der Unterschied zur Fassung auf dem Server steckt im Praefix. Dort zaehlt
// "der gesuchte Name steht am Anfang des gefundenen" fast voll - das ist fuer
// "Demon Slayer" gegen "Demon Slayer: Kimetsu no Yaiba" richtig und fuer "Es"
// gegen "Es war einmal in Deutschland" falsch. Beide Faelle haben dieselbe
// Form; unterscheiden lassen sie sich nur daran, wie viel vom gefundenen Namen
// ueberhaupt abgedeckt ist. Deshalb faellt der Wert, je weiter die Laengen
// auseinanderliegen: bei zwei von fuenf Woertern bleiben 0.72, bei einem von
// fuenf nur 0.36.
function namensDeckung(suche, name) {
  const links = worte(suche);
  const rechts = worte(name);
  if (!links.length || !rechts.length) return 0;
  if (links.length === rechts.length && links.every((wort, i) => wort === rechts[i])) return 1;
  // Wortgrenzen sind keine Aussage. Die Anbieter schreiben "Dragonball" und
  // "Sailormoon", die Datenbanken "Dragon Ball" und "Sailor Moon" - Buchstabe
  // fuer Buchstabe dasselbe, nur anders getrennt. Ohne diese Zeile ist die
  // Wortmenge leer geschnitten und der Wert null, obwohl es derselbe Titel ist.
  // Zusammengeschrieben verglichen wird nur auf Gleichheit, nicht auf
  // Teilstuecke - "Dragonball" wird so nicht zu "Dragon".
  if (links.join("") === rechts.join("")) return 1;
  const kurz = Math.min(links.length, rechts.length);
  const lang = Math.max(links.length, rechts.length);
  const istPraefix = links.every((wort, i) => rechts[i] === wort)
    || rechts.every((wort, i) => links[i] === wort);
  if (istPraefix) {
    const anteil = kurz / lang;
    return anteil >= 0.5 ? 0.9 : 0.9 * (2 * anteil);
  }
  const menge = new Set(rechts);
  return (2 * links.filter((wort) => menge.has(wort)).length) / (links.length + rechts.length);
}

// Alle Namen, die ein Werk traegt - eigene wie gefundene. Verglichen wird jeder
// mit jedem: der Anbieter fuehrt den deutschen Titel, TMDB den englischen, und
// der deutsche steht dort unter den alternativen Titeln.
function namenVon(form) {
  return [form?.titel, form?.originalTitel, ...(form?.altTitel || [])].filter(Boolean);
}

function besteDeckung(eigene, fremde) {
  let beste = 0;
  for (const links of eigene) {
    for (const rechts of fremde) {
      const wert = namensDeckung(links, rechts);
      if (wert > beste) beste = wert;
      if (beste >= 1) return 1;
    }
  }
  return beste;
}

// --- Wuensche ----------------------------------------------------------------

function jahrVon(wert) {
  const zahl = Number.parseInt(String(wert || "").slice(0, 4), 10);
  return zahl >= 1900 && zahl <= 2100 ? zahl : 0;
}

function artVon(wert) {
  const art = String(wert || "").toLowerCase();
  return art === "anime" || art === "film" ? art : "serie";
}

// Ein Wunsch traegt alles, was ELFIX ueber ein Werk sicher weiss - in der
// Reihenfolge, in der es fuer die Zuordnung taugt:
//
//   1. die IMDB-Kennung von der Anbieterseite. Damit loest TMDB ein Werk
//      eindeutig auf, ohne dass ein Titel verglichen wird.
//   2. Titel und Jahr. Ohne Jahr trifft "Hunter x Hunter" die Fassung von 1999
//      statt der von 2011, und "The Flash" die Serie statt des Films.
//   3. alternative und fremdsprachige Titel, soweit die Seite welche fuehrt.
function wunschBauen(roh) {
  const titel = String(roh?.titel || "").slice(0, 200).trim();
  if (!titel) return null;
  const art = artVon(roh?.art);
  const imdb = /^tt\d{6,10}$/.test(String(roh?.imdb || "")) ? String(roh.imdb) : "";
  const jahr = jahrVon(roh?.jahr);
  const altTitel = [...new Set((Array.isArray(roh?.altTitel) ? roh.altTitel : [])
    .map((wert) => String(wert || "").slice(0, 200).trim())
    .filter((wert) => wert && normalisieren(wert) !== normalisieren(titel)))].slice(0, 8);
  return {
    schluessel: [art, normalisieren(titel), jahr || "", imdb].join("|"),
    art,
    titel,
    jahr,
    imdb,
    altTitel
  };
}

// Der Titel ohne seinen Zusatz: "Avatar - Der Herr der Elemente" -> "Avatar".
//
// Das ist ein zweiter Versuch, kein erster. Die Anbieter fuehren deutsche
// Titel, TMDB durchsucht seinen englischen Bestand - "Avatar - Der Herr der
// Elemente" findet dort nichts, "Avatar" mit Jahr 2005 dagegen die richtige
// Serie. Ob das Ergebnis stimmt, entscheidet danach dieselbe Pruefung wie
// sonst: der volle Titel muss unter den alternativen Titeln des Fundes
// wiederauftauchen. Genau daran scheitert derselbe Versuch bei "Es".
function kurzform(titel) {
  const teil = String(titel || "").split(/\s+[-–—:]\s+|:\s+/)[0].trim();
  if (!teil || teil.length < 3) return "";
  return normalisieren(teil) === normalisieren(titel) ? "" : teil;
}

// --- Normalform ---------------------------------------------------------------

// Was gespeichert wird. Die Feldnamen sind die des Servers - die Empfehlung
// liest dieselbe Form, egal ob sie aus dem Cache oder frisch aus dem Netz kommt.
// Weggelassen wird, was das Ranking nicht benutzt (Rollennamen, Tag-Kategorien),
// damit die Ablage nicht ins Uferlose waechst.
function verdichten(form, art) {
  return mitTrailer(verdichtetOhneTrailer(form, art), form);
}

function verdichtetOhneTrailer(form, art) {
  return {
    quelle: String(form?.quelle || ""),
    externeIds: form?.externeIds && typeof form.externeIds === "object" ? form.externeIds : {},
    titel: String(form?.titel || ""),
    originalTitel: String(form?.originalTitel || ""),
    altTitel: (form?.altTitel || []).slice(0, 12).map(String),
    art: String(form?.art || art || ""),
    jahr: Number(form?.jahr) || 0,
    bisJahr: Number(form?.bisJahr) || 0,
    genres: (form?.genres || []).slice(0, 12).map(String),
    tags: (form?.tags || []).slice(0, 25)
      .map((tag) => ({ name: String(tag?.name || ""), rang: Number(tag?.rang) || 0 }))
      .filter((tag) => tag.name),
    schlagworte: (form?.schlagworte || []).slice(0, 30).map(String).filter(Boolean),
    relationen: (form?.relationen || []).slice(0, 40)
      .map((rel) => ({
        art: String(rel?.art || ""),
        id: Number(rel?.id) || 0,
        titel: String(rel?.titel || "")
      }))
      .filter((rel) => rel.id),
    aehnlich: (form?.aehnlich || []).slice(0, 12)
      .map((eintrag) => ({ id: Number(eintrag?.id) || 0, titel: String(eintrag?.titel || "") }))
      .filter((eintrag) => eintrag.id),
    sammlung: form?.sammlung?.id
      ? { id: Number(form.sammlung.id), titel: String(form.sammlung.titel || "") }
      : null,
    studios: (form?.studios || []).slice(0, 8).map(String).filter(Boolean),
    besetzung: (form?.besetzung || []).slice(0, 12)
      .map((person) => String(person?.name || person || "")).filter(Boolean),
    regie: (form?.regie || []).slice(0, 4).map(String).filter(Boolean),
    autoren: (form?.autoren || []).slice(0, 5).map(String).filter(Boolean),
    bewertung: typeof form?.bewertung === "number" ? form.bewertung : null,
    bewertungStimmen: Number(form?.bewertungStimmen) || 0,
    beliebtheit: Number(form?.beliebtheit) || 0,
    altersfreigabe: typeof form?.altersfreigabe === "number" ? form.altersfreigabe : null,
    // Laeuft das noch? Die drei Felder tragen nichts zum Ranking bei und sind
    // nur fuer den Verlaufs-Kasten der Mediathek da: ohne sie duerfte er nicht
    // zwischen "Auf aktuellem Stand" und "abgeschlossen" unterscheiden.
    //
    // Sie stehen hier ausdruecklich und nicht bedingt - ein Eintrag aus der
    // Zeit davor hat das Feld gar nicht, und genau daran erkennt
    // `laufStatusFehlt`, dass er noch einmal gefragt werden muss.
    laufStatus: String(form?.laufStatus || ""),
    folgenGesamt: Number(form?.folgenGesamt) || 0,
    naechsteFolge: form?.naechsteFolge && (form.naechsteFolge.nummer || form.naechsteFolge.zeit)
      ? { nummer: Number(form.naechsteFolge.nummer) || 0, zeit: String(form.naechsteFolge.zeit || "") }
      : null,
    staffeln: (form?.staffeln || []).slice(0, 60)
      .map((staffel) => ({ nummer: Number(staffel?.nummer) || 0, folgen: Number(staffel?.folgen) || 0 }))
      .filter((staffel) => staffel.nummer > 0),
    konfidenz: String(form?.konfidenz || "UNMATCHED")
  };
}

/**
 * Denselben Datensatz noch einmal, mit dem Trailer.
 *
 * <p><b>Und hier steckt der Unterschied, an dem die erste Fassung gescheitert
 * ist:</b> "kein Trailer" und "von Trailern noch nie gehoert" sind zwei
 * verschiedene Antworten. Ein Dienst, der aelter ist als diese Funktion,
 * schickt das Feld gar nicht - traegt man dann {@code null} ein, steht im
 * Zwischenspeicher "es gibt keinen", und zwar fuer immer: geprueft wird auf das
 * Vorhandensein des Feldes, und das waere ja da.
 *
 * <p>Genau so war es gemeldet - TMDB fuehrt zu "Spider-Man: Brand New Day"
 * einen deutschen Trailer, ELFIX sagte trotzdem "kein Trailer hinterlegt".
 * Deshalb kommt das Feld nur mit, wenn die Antwort es wirklich enthaelt.
 * Fehlt es, bleibt der Eintrag unvollstaendig und wird beim naechsten Oeffnen
 * neu gefragt - dann mit einem Dienst, der es kennt.
 */
function mitTrailer(aus, form) {
  if (form && Object.prototype.hasOwnProperty.call(form, "trailer")) {
    // Streng gelesen: eine Videokennung besteht aus Buchstaben, Ziffern,
    // Strich und Unterstrich. Was hier durchkommt, wird gleich darauf zu einer
    // Adresse zusammengesetzt.
    aus.trailer = trailerLesen(form.trailer);
  }
  return aus;
}

/*
 * Stammt dieser Cache-Eintrag noch aus der Zeit vor den Laufzeit-Feldern?
 *
 * Die Alternative waere gewesen, CACHE_VERSION zu erhoehen - dann waeren
 * viertausend geprueft zugeordnete Titel auf einen Schlag weg gewesen, obwohl
 * an ihrer Zuordnung nichts falsch ist. Stattdessen bleibt der Eintrag stehen,
 * und nur der eine Titel, dessen Verlauf jemand tatsaechlich oeffnet, wird
 * noch einmal gefragt.
 */
/**
 * Die Angaben zum Trailer - oder null.
 *
 * <p>Die Kennung ist das Einzige, was zaehlt, und sie wird gegen dieselbe
 * Zeichenmenge geprueft, die YouTube verwendet. Name und Sprache sind
 * Beiwerk fuer die Beschriftung; eine fertige Adresse kommt bewusst nicht
 * ueber die Leitung, damit niemand sie ungeprueft weiterreicht.
 */
function trailerLesen(roh) {
  const schluessel = String(roh?.schluessel || "");
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(schluessel)) return null;
  return {
    schluessel,
    name: String(roh?.name || "").slice(0, 120),
    sprache: String(roh?.sprache || "").slice(0, 8),
    quelle: String(roh?.quelle || "").slice(0, 16)
  };
}

/*
 * Stammt dieser Eintrag noch aus der Zeit vor dem Trailer?
 *
 * Dieselbe Frage wie bei den Laufzeit-Feldern und aus demselben Grund: die
 * Cache-Fassung zu erhoehen haette viertausend geprueft zugeordnete Titel
 * weggeworfen, obwohl an ihrer Zuordnung nichts falsch ist. Stattdessen wird
 * genau der eine Titel neu gefragt, den jemand wirklich aufmacht.
 */
function trailerFehlt(form) {
  return !form || !Object.prototype.hasOwnProperty.call(form, "trailer");
}

function laufStatusFehlt(form) {
  return !form || !Object.prototype.hasOwnProperty.call(form, "laufStatus");
}

function leerform(art) {
  return verdichten({ konfidenz: "UNMATCHED" }, art);
}

// --- Die Pruefung -------------------------------------------------------------

// Der Server hat zugeordnet, hier wird nachgerechnet.
//
// Drei Dinge werden geprueft, in dieser Reihenfolge:
//
//   1. Die IMDB-Kennung. Haben wir eine mitgeschickt und traegt der Fund
//      dieselbe, ist die Sache entschieden - kein Titel- und kein
//      Jahresvergleich kann daran etwas verbessern oder verschlechtern.
//   2. Das Jahr. Liegt es mehr als ein Jahr daneben, ist es ein anderes Werk -
//      das ist der Fall "The Flash" (2014) gegen "The Flash" (2023).
//   3. Der Name, gegen alle Namen des Fundes. Erst hier faellt "Es".
function pruefen(wunsch, roh) {
  const form = verdichten(roh, wunsch.art);
  if (rang(form.konfidenz) === 0) return form;

  if (wunsch.imdb && form.externeIds?.imdb === wunsch.imdb) {
    form.konfidenz = "EXACT";
    return form;
  }

  const deckung = besteDeckung([wunsch.titel, ...wunsch.altTitel], namenVon(form));
  const jahrPasst = wunsch.jahr && form.jahr ? Math.abs(wunsch.jahr - form.jahr) <= 1 : null;

  // Ein Jahr, das um mehr als eins danebenliegt, kippt den Fund - und zwar
  // auch dann, wenn der Name exakt stimmt. Gerade dann: "The Flash" gibt es
  // als Serie von 2014 und als Film von 2023, "Spider-Man" mehrfach, "Es"
  // zweimal. Ein gleicher Name bei verschiedenem Jahr ist der haeufigste
  // Fehltreffer ueberhaupt, nicht der sicherste Treffer.
  //
  // Die einzige Ausnahme ist die Laufzeit einer Serie: der Anbieter nennt
  // manchmal das Jahr einer spaeteren Staffel, und das liegt dann innerhalb
  // des Zeitraums, den die Datenbank fuer dasselbe Werk fuehrt.
  if (jahrPasst === false) {
    const imFenster = form.bisJahr && wunsch.jahr >= form.jahr && wunsch.jahr <= form.bisJahr;
    if (!imFenster) {
      form.konfidenz = "UNMATCHED";
      form.grund = "jahr-weicht-ab";
      form.deckung = Number(deckung.toFixed(3));
      return form;
    }
  }

  let grenze;
  if (deckung >= 0.95) grenze = "EXACT";
  else if (deckung >= 0.7) grenze = jahrPasst === true ? "HIGH" : "MEDIUM";
  else if (deckung >= 0.5) grenze = jahrPasst === true ? "MEDIUM" : "LOW";
  else if (deckung >= 0.4) grenze = "LOW";
  else grenze = "UNMATCHED";

  if (rang(grenze) < rang(form.konfidenz)) {
    form.konfidenz = grenze;
    if (grenze === "UNMATCHED") form.grund = "name-deckt-nicht";
  } else if (deckung >= 0.99 && jahrPasst === true && rang(form.konfidenz) < rang("HIGH")) {
    // Und die Gegenrichtung, eng gefasst: der Name deckt sich vollstaendig und
    // das Jahr passt - dann ist es dasselbe Werk, auch wenn der Server
    // vorsichtiger war. Das ist keine geratene Sicherheit, sondern dieselbe
    // Rechnung mit dem besseren Namensvergleich (siehe `namensDeckung`, wo
    // "Dragonball" und "Dragon Ball" als gleich gelten).
    //
    // Hoechstens bis HIGH: EXACT bleibt der eindeutigen Aufloesung ueber die
    // IMDB-Kennung vorbehalten, und ohne passendes Jahr passiert hier gar
    // nichts - "Spider-Man" ohne Jahr bleibt MEDIUM.
    form.konfidenz = "HIGH";
    form.grund = "name-und-jahr-eindeutig";
  }
  form.deckung = Number(deckung.toFixed(3));
  return form;
}

// --- Der Client ---------------------------------------------------------------

// `optionen`:
//   basis      Adresse des Relays. Fehlt sie, laeuft alles weiter - nur ohne
//              externe Daten.
//   holen      fetch. In der App Chromiums net.fetch, in Pruefungen ein Doppel.
//   jetzt      Zeitquelle, damit sich Ablaufzeiten pruefen lassen.
//   laden      liefert den gespeicherten Cache (oder null).
//   speichern  nimmt den Cache entgegen. Wird verzoegert aufgerufen.
//   pause      Wartezeit zwischen zwei Stapeln; in Pruefungen 0.
function erstellen(optionen = {}) {
  const jetztFn = optionen.jetzt || Date.now;
  const holen = optionen.holen || globalThis.fetch;
  const basis = String(optionen.basis || "").replace(/\/+$/, "");
  const pauseMs = optionen.pause === undefined ? PAUSE_MS : Number(optionen.pause);
  // Bewusst ohne `unref`: die Pause gehoert zu einem laufenden Abruf. Ein
  // Zeitgeber, der den Prozess nicht am Leben haelt, laesst ein Werkzeug ohne
  // Fenster (Pruefung, Messung) zwischen zwei Stapeln einfach enden - und zwar
  // lautlos, mit halbem Ergebnis.
  const schlafen = optionen.schlafen || ((ms) => new Promise((fertig) => setTimeout(fertig, ms)));

  // Der Cache: Schluessel -> { form, bis }. Reihenfolge ist Alter, das aelteste
  // steht vorn.
  const eintraege = new Map();
  // Gleichzeitige Anfragen nach demselben Titel werden zusammengelegt.
  const laufend = new Map();
  let geladen = false;
  let geaendert = false;
  let ausfaelle = 0;
  let ausfallBis = 0;
  // Was das Relay ueber seine eigenen Quellen sagt - zuletzt gesehen.
  //
  // Es steht in jeder Antwort auf /metadata/lookup und in /metadata/status,
  // und bisher wurde es weggeworfen. Gebraucht wird es fuer eine einzige, aber
  // wichtige Unterscheidung: ohne TMDB-Schluessel gibt es zu Filmen und Serien
  // gar nichts zu holen. Wer das nicht weiss, sucht den Fehler bei der
  // Zuordnung oder bei der Fassung des Relays - und findet ihn dort nie.
  let letzteQuellen = null;

  const zaehler = {
    anfragen: 0, titel: 0,
    cacheTreffer: 0, cacheFehlgriffe: 0,
    EXACT: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNMATCHED: 0,
    herabgestuft: 0, kurzformTreffer: 0,
    anilistTitel: 0, tmdbTitel: 0,
    fehler: 0, gebremst: 0, timeouts: 0, dauerMs: 0
  };

  function laden() {
    if (geladen) return;
    geladen = true;
    let roh = null;
    try {
      roh = optionen.laden ? optionen.laden() : null;
    } catch {
      roh = null;
    }
    if (!roh || Number(roh.version) !== CACHE_VERSION || !roh.eintraege) return;
    for (const [schluessel, eintrag] of Object.entries(roh.eintraege)) {
      if (!eintrag?.form || !Number(eintrag.bis)) continue;
      eintraege.set(schluessel, {
        form: eintrag.form,
        bis: Number(eintrag.bis),
        // Siehe merken(): ein "nicht gefunden" aus der Zeit ohne TMDB-Zugang.
        //
        // Eintraege aus der Zeit vor dieser Marke tragen sie nicht - und
        // ausgerechnet die sind der Anlass: wer den Schluessel nachtraegt,
        // sitzt sonst fuenf Tage auf lauter "nicht gefunden", die nur daher
        // kommen, dass damals niemand fragen konnte. Ein altes UNMATCHED zu
        // einem Werk gilt deshalb als verdaechtig und wird einmal neu gefragt,
        // sobald es einen Schluessel gibt. Anime bleibt aussen vor, das kam nie
        // von TMDB.
        ohneTmdb: eintrag.ohneTmdb === undefined
          ? (eintrag.form?.konfidenz === "UNMATCHED" && eintrag.form?.art !== "anime")
          : Boolean(eintrag.ohneTmdb)
      });
    }
  }

  function speichern() {
    if (!geaendert || !optionen.speichern) return;
    geaendert = false;
    try {
      optionen.speichern({
        version: CACHE_VERSION,
        eintraege: Object.fromEntries([...eintraege.entries()]
          .map(([schluessel, eintrag]) => [schluessel, {
            form: eintrag.form,
            bis: eintrag.bis,
            ohneTmdb: eintrag.ohneTmdb || undefined
          }]))
      });
    } catch {
      // Ein nicht geschriebener Cache kostet beim naechsten Start Zeit, sonst
      // nichts.
    }
  }

  /**
   * Einen Datensatz merken.
   *
   * <p>`ohneTmdb` heisst: dieses "nicht gefunden" ist kein Ergebnis, sondern
   * eine fehlende Quelle. Ohne Schluessel kommt das Relay an Filme und Serien
   * gar nicht heran und liefert zu jedem UNMATCHED - fuenf Tage lang gemerkt.
   * Wer den Schluessel danach eintraegt, bekaeme trotzdem eine Woche lang
   * "liess sich keinem Werk zuordnen" und haette keine Ahnung, warum. Die Marke
   * sorgt dafuer, dass genau diese Eintraege noch einmal gefragt werden, sobald
   * es einen Schluessel gibt (siehe ausCache).
   */
  function merken(schluessel, form, dauer, ohneTmdb = false) {
    eintraege.delete(schluessel);
    eintraege.set(schluessel, { form, bis: jetztFn() + dauer, ohneTmdb });
    while (eintraege.size > CACHE_MAX) {
      const aeltester = eintraege.keys().next().value;
      eintraege.delete(aeltester);
    }
    geaendert = true;
  }

  // Der Weg ohne Netz. Er wird beim Bauen der Empfehlungen benutzt und darf
  // deshalb unter keinen Umstaenden warten.
  function ausCache(roh) {
    laden();
    const wunsch = roh?.schluessel ? roh : wunschBauen(roh);
    if (!wunsch) return null;
    const eintrag = eintraege.get(wunsch.schluessel);
    if (!eintrag) return null;
    if (jetztFn() > eintrag.bis) return null;
    // Ein "nicht gefunden" von damals, und inzwischen gibt es einen Schluessel:
    // dann ist der Eintrag hinfaellig und der Titel wird neu gefragt. Nur bei
    // erwiesenem Schluessel - solange nichts vom Relay gekommen ist, bleibt
    // alles, wie es ist.
    if (eintrag.ohneTmdb && tmdbDa()) {
      eintraege.delete(wunsch.schluessel);
      geaendert = true;
      return null;
    }
    // Wer gelesen wird, rutscht ans Ende: beim Aufraeumen faellt zuerst, was
    // niemand mehr braucht.
    eintraege.delete(wunsch.schluessel);
    eintraege.set(wunsch.schluessel, eintrag);
    return eintrag.form;
  }

  function fehltImCache(roh) {
    const wunsch = roh?.schluessel ? roh : wunschBauen(roh);
    return Boolean(wunsch) && !ausCache(wunsch);
  }

  const bereit = () => Boolean(basis) && Boolean(holen);
  const gesperrt = () => jetztFn() < ausfallBis;

  function ausfallMerken(gruende) {
    ausfaelle += 1;
    if (ausfaelle >= AUSFALL_SCHWELLE) {
      ausfallBis = jetztFn() + AUSFALL_PAUSE_MS;
      ausfaelle = 0;
    }
    zaehler.fehler += 1;
    if (gruende === "timeout") zaehler.timeouts += 1;
  }

  // Eine Anfrage an das Relay. Ein Fehler kommt als Ergebnis zurueck, nicht als
  // Ausnahme - die Anreicherung soll nirgends abbrechen.
  async function anfragen(pfad, aufbau, timeout) {
    const beginn = jetztFn();
    try {
      const antwort = await holen(basis + pfad, {
        ...aufbau,
        signal: AbortSignal.timeout(timeout)
      });
      zaehler.dauerMs += jetztFn() - beginn;
      if (antwort.status === 429) {
        zaehler.gebremst += 1;
        const warten = Number(antwort.headers?.get?.("retry-after")) || 60;
        ausfallBis = jetztFn() + Math.min(10 * 60, Math.max(5, warten)) * 1000;
        return { fehler: "gebremst" };
      }
      if (!antwort.ok) {
        ausfallMerken("status");
        return { fehler: "status-" + antwort.status };
      }
      const daten = await antwort.json();
      if (!daten || typeof daten !== "object") {
        ausfallMerken("kein-json");
        return { fehler: "kein-json" };
      }
      ausfaelle = 0;
      return { daten };
    } catch (fehler) {
      zaehler.dauerMs += jetztFn() - beginn;
      const art = fehler?.name === "TimeoutError" || fehler?.name === "AbortError" ? "timeout" : "netz";
      ausfallMerken(art);
      return { fehler: art };
    }
  }

  function quellenMerken(quellen) {
    if (quellen && typeof quellen === "object") letzteQuellen = quellen;
  }

  /**
   * Ob dem Metadaten-Dienst der TMDB-Schluessel fehlt.
   *
   * <p>Nur wenn es dasteht. Solange nichts vom Relay gekommen ist, ist die
   * Antwort `false` und nicht "vielleicht": eine Meldung, die einen fehlenden
   * Schluessel behauptet, ohne ihn geprueft zu haben, waere genau der Fehler,
   * den sie beheben soll.
   */
  function tmdbFehlt() {
    return Boolean(letzteQuellen) && letzteQuellen.tmdb !== "configured";
  }

  /** Und die Gegenrichtung: erwiesenermassen da. */
  function tmdbDa() {
    return Boolean(letzteQuellen) && letzteQuellen.tmdb === "configured";
  }

  async function status() {
    if (!bereit()) return { metadata: false, grund: "keine-adresse" };
    const antwort = await anfragen("/metadata/status", { method: "GET" }, STATUS_TIMEOUT_MS);
    if (antwort.fehler) return { metadata: false, grund: antwort.fehler };
    quellenMerken(antwort.daten);
    return antwort.daten;
  }

  // Ein Stapel. Der Server beantwortet ihn als Ganzes; faellt er aus, gilt das
  // fuer alle Titel darin.
  async function stapelHolen(wuensche) {
    zaehler.anfragen += 1;
    zaehler.titel += wuensche.length;
    for (const wunsch of wuensche) {
      if (wunsch.art === "anime") zaehler.anilistTitel += 1;
      else zaehler.tmdbTitel += 1;
    }
    const antwort = await anfragen("/metadata/lookup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        titel: wuensche.map((wunsch) => ({
          id: wunsch.schluessel,
          art: wunsch.art,
          titel: wunsch.titel,
          jahr: wunsch.jahr || undefined,
          imdb: wunsch.imdb || undefined,
          altTitel: wunsch.altTitel
        }))
      })
    }, TIMEOUT_MS);
    if (antwort.fehler) return { fehler: antwort.fehler };
    quellenMerken(antwort.daten?.quellen);
    const treffer = Array.isArray(antwort.daten.treffer) ? antwort.daten.treffer : [];
    const nach = new Map();
    for (const eintrag of treffer) {
      if (eintrag?.id) nach.set(String(eintrag.id), eintrag);
    }
    return { nach };
  }

  function ergebnisMerken(wunsch, form) {
    const stufe = form.konfidenz;
    zaehler[stufe] = (zaehler[stufe] || 0) + 1;
    merken(wunsch.schluessel, form, stufe === "UNMATCHED" ? NICHT_GEFUNDEN_MS : GUT_MS,
      // Nur bei Werken: Anime kommt von AniList und ist von TMDB unabhaengig.
      stufe === "UNMATCHED" && wunsch.art !== "anime" && tmdbFehlt());
  }

  // Ein Durchgang ueber eine Liste von Wuenschen: Stapel bilden, holen,
  // pruefen, merken. Die Kurzform-Versuche laufen danach, damit sie nicht die
  // erste Runde verzoegern.
  async function durchgang(offen, ergebnisse) {
    const anime = offen.filter((wunsch) => wunsch.art === "anime");
    const werke = offen.filter((wunsch) => wunsch.art !== "anime");
    const stapel = [];
    for (let i = 0; i < anime.length; i += STAPEL_ANIME) stapel.push(anime.slice(i, i + STAPEL_ANIME));
    for (let i = 0; i < werke.length; i += STAPEL_WERK) stapel.push(werke.slice(i, i + STAPEL_WERK));

    const gescheitert = [];
    for (let index = 0; index < stapel.length; index += 1) {
      if (gesperrt()) break;
      if (index > 0 && pauseMs > 0) await schlafen(pauseMs);
      const teil = stapel[index];
      const antwort = await stapelHolen(teil);
      if (antwort.fehler) {
        // Ein Ausfall wird nicht als "nicht gefunden" gemerkt - sonst haengt
        // ein Titel wegen einer Zeitgrenze tagelang fest. Gemerkt wird nur
        // kurz, damit der naechste Lauf nicht sofort dasselbe versucht.
        for (const wunsch of teil) {
          const form = { ...leerform(wunsch.art), fehler: antwort.fehler };
          zaehler.UNMATCHED += 1;
          merken(wunsch.schluessel, form, FEHLER_MS);
          ergebnisse.set(wunsch.schluessel, form);
        }
        continue;
      }
      for (const wunsch of teil) {
        const roh = antwort.nach.get(wunsch.schluessel);
        if (!roh) {
          const form = leerform(wunsch.art);
          ergebnisMerken(wunsch, form);
          ergebnisse.set(wunsch.schluessel, form);
          continue;
        }
        const geprueft = pruefen(wunsch, roh);
        if (rang(geprueft.konfidenz) < rang(roh.konfidenz)) zaehler.herabgestuft += 1;
        ergebnisMerken(wunsch, geprueft);
        ergebnisse.set(wunsch.schluessel, geprueft);
        if (geprueft.konfidenz === "UNMATCHED") gescheitert.push(wunsch);
      }
    }
    return gescheitert;
  }

  // Zweiter Versuch fuer das, was nichts gefunden hat: derselbe Titel ohne
  // seinen deutschen Zusatz. Nur mit Jahr, sonst ist die Verwechslungsgefahr
  // zu gross - und das Ergebnis muss dieselbe Pruefung bestehen wie jedes
  // andere, gemessen am vollen Titel.
  async function kurzformDurchgang(gescheitert, ergebnisse) {
    const zweite = [];
    for (const wunsch of gescheitert) {
      if (!wunsch.jahr) continue;
      const kurz = kurzform(wunsch.titel);
      if (!kurz) continue;
      zweite.push({
        ...wunschBauen({ art: wunsch.art, titel: kurz, jahr: wunsch.jahr,
          altTitel: [wunsch.titel, ...wunsch.altTitel] }),
        // Gemerkt wird unter dem urspruenglichen Schluessel: gesucht wird
        // spaeter wieder mit dem vollen Titel.
        zielSchluessel: wunsch.schluessel,
        // Geprueft wird gegen den vollen Titel, nicht gegen die Kurzform.
        pruefTitel: wunsch.titel
      });
    }
    if (!zweite.length) return;

    for (let i = 0; i < zweite.length; i += STAPEL_WERK) {
      if (gesperrt()) break;
      if (i > 0 && pauseMs > 0) await schlafen(pauseMs);
      const teil = zweite.slice(i, i + STAPEL_WERK);
      const antwort = await stapelHolen(teil);
      if (antwort.fehler) continue;
      for (const wunsch of teil) {
        const roh = antwort.nach.get(wunsch.schluessel);
        if (!roh) continue;
        const geprueft = pruefen({ ...wunsch, titel: wunsch.pruefTitel }, roh);
        if (geprueft.konfidenz === "UNMATCHED") continue;
        zaehler.kurzformTreffer += 1;
        zaehler[geprueft.konfidenz] = (zaehler[geprueft.konfidenz] || 0) + 1;
        zaehler.UNMATCHED = Math.max(0, zaehler.UNMATCHED - 1);
        merken(wunsch.zielSchluessel, geprueft, GUT_MS);
        ergebnisse.set(wunsch.zielSchluessel, geprueft);
      }
    }
  }

  // Der Weg mit Netz. Was im Cache liegt, geht gar nicht erst hinaus.
  //
  // Die Reihenfolge der uebergebenen Wuensche ist die Reihenfolge der
  // Bearbeitung: wer zuerst kommt, wird zuerst angereichert. Das ist die
  // ganze Priorisierung - sie gehoert dorthin, wo bekannt ist, was wichtig
  // ist, und nicht hierher.
  async function nachschlagen(rohe, optionen = {}) {
    laden();
    const ergebnisse = new Map();
    const wuensche = [];
    const gesehen = new Set();
    // `frisch` uebergeht den Cache fuer genau diesen Aufruf. Gebraucht wird das
    // an einer einzigen Stelle: wenn ein alter Eintrag zwar zugeordnet, aber
    // ohne Laufzeit-Felder ist.
    const frisch = Boolean(optionen.frisch);
    for (const roh of rohe || []) {
      const wunsch = roh?.schluessel ? roh : wunschBauen(roh);
      if (!wunsch || gesehen.has(wunsch.schluessel)) continue;
      gesehen.add(wunsch.schluessel);
      const bekannt = frisch ? null : ausCache(wunsch);
      if (bekannt) {
        zaehler.cacheTreffer += 1;
        ergebnisse.set(wunsch.schluessel, bekannt);
        continue;
      }
      zaehler.cacheFehlgriffe += 1;
      wuensche.push(wunsch);
    }
    if (!wuensche.length || !bereit() || gesperrt()) return ergebnisse;

    const offen = wuensche.slice(0, MAX_JE_LAUF);
    // Zwei Laeufe duerfen denselben Titel nicht doppelt holen.
    const eigene = offen.filter((wunsch) => !laufend.has(wunsch.schluessel));
    for (const wunsch of offen) {
      const fremd = laufend.get(wunsch.schluessel);
      if (fremd) fremd.then((form) => { if (form) ergebnisse.set(wunsch.schluessel, form); }).catch(() => {});
    }

    const lauf = (async () => {
      const gescheitert = await durchgang(eigene, ergebnisse);
      await kurzformDurchgang(gescheitert, ergebnisse);
    })();
    for (const wunsch of eigene) {
      laufend.set(wunsch.schluessel, lauf.then(() => ergebnisse.get(wunsch.schluessel) || null));
    }
    try {
      await lauf;
    } finally {
      for (const wunsch of eigene) laufend.delete(wunsch.schluessel);
      speichern();
    }
    return ergebnisse;
  }

  function statistik() {
    const gesamt = zaehler.cacheTreffer + zaehler.cacheFehlgriffe;
    const zugeordnet = zaehler.EXACT + zaehler.HIGH + zaehler.MEDIUM + zaehler.LOW;
    return {
      ...zaehler,
      cacheGroesse: eintraege.size,
      cacheQuote: gesamt ? Number((zaehler.cacheTreffer / gesamt).toFixed(3)) : 0,
      zugeordnet,
      trefferQuote: zugeordnet + zaehler.UNMATCHED
        ? Number((zugeordnet / (zugeordnet + zaehler.UNMATCHED)).toFixed(3))
        : 0,
      dauerJeAnfrageMs: zaehler.anfragen ? Math.round(zaehler.dauerMs / zaehler.anfragen) : 0,
      gesperrtBis: ausfallBis
    };
  }

  return {
    bereit,
    gesperrt,
    ausCache,
    fehltImCache,
    nachschlagen,
    laufStatusFehlt,
    trailerFehlt,
    tmdbFehlt,
    tmdbDa,
    status,
    statistik,
    wunschBauen,
    // Nur fuer Pruefungen und das Messwerkzeug.
    _speichern: speichern,
    _cacheGroesse: () => eintraege.size
  };
}

module.exports = {
  erstellen,
  wunschBauen,
  laufStatusFehlt,
  trailerFehlt,
  trailerLesen,
  namensDeckung,
  besteDeckung,
  kurzform,
  pruefen,
  verdichten,
  leerform,
  rang,
  RANG_KONFIDENZ,
  GRENZEN: { GUT_MS, NICHT_GEFUNDEN_MS, FEHLER_MS, STAPEL_ANIME, STAPEL_WERK, MAX_JE_LAUF, AUSFALL_SCHWELLE, AUSFALL_PAUSE_MS, CACHE_MAX }
};
