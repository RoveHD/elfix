"use strict";

// Das Empfehlungssystem.
//
// Die Kette ist bewusst in Abschnitte getrennt, die einzeln pruefbar sind:
//
//   Profil bauen  ->  Dubletten  ->  Merkmale  ->  Punkte
//                 ->  Filter     ->  Vielfalt  ->  Ergebnis
//
// Was hier NICHT steht, ist genauso wichtig wie das, was drinsteht. ELFIX hat
// zu einem Titel nur: Titel, Adresse, Typ, Anbieter, Genres und den eigenen
// Fortschritt. Es gibt keine Besetzung, keine Regie, keine Beschreibung, kein
// Erscheinungsjahr bei Filmen und keine Franchise-Kennungen. Signale, die
// darauf angewiesen waeren, werden deshalb nicht geschaetzt, sondern
// weggelassen - ein erfundenes Merkmal ist schlechter als ein fehlendes.
//
// Zwei Dinge fallen dadurch besonders ins Gewicht:
//   - Genres sind zu praktisch 100 Prozent vorhanden und anbieteruebergreifend
//     normalisiert. Sie tragen die Aehnlichkeit.
//   - Der "Das schauen andere"-Block der Anbieter gibt es nur bei manchen
//     Seiten (bei AniWorld gar nicht). Wo er fehlt, muss die Titel- und
//     Reihenerkennung einspringen.

const titel = require("./titel");
const begruendung = require("./begruendung");

// --- Gewichte ----------------------------------------------------------------
//
// Keine Kennzahl darf allein entscheiden - mit einer Ausnahme: der naechste
// ungesehene Teil einer Reihe, die gerade laeuft. Das ist der einzige Fall,
// in dem sich die Absicht des Nutzers wirklich sicher ablesen laesst.
const G = {
  naechsterTeil: 1.6,
  reihe: 0.9,
  aehnlichLautAnbieter: 0.8,
  sitzung: 0.7,
  verlauf: 0.6,
  genre: 0.5,
  watchlist: 0.35,
  titel: 0.3,
  neuheit: 0.15
};

// Halbwertszeit des Interesses. Was vor einem Monat lief, zaehlt halb so viel.
const HALBWERT_TAGE = 30;
// So lange gilt etwas als "gerade eben" - daraus entsteht die Sitzung.
const SITZUNG_STUNDEN = 6;
// Ab so vielen Anzeigen ohne einen einzigen Klick wird abgewertet.
const MUEDE_AB = 4;
const MUEDE_MAX = 0.45;

function zahl(wert) {
  const n = Number(wert);
  return Number.isFinite(n) ? n : 0;
}

function zeitpunkt(eintrag) {
  return Date.parse(eintrag?.lastWatchedAt || eintrag?.completedAt || eintrag?.openedAt || eintrag?.createdAt || "") || 0;
}

// --- Wie stark ist ein Signal? ------------------------------------------------

// Wie ernst ist es dem Nutzer mit diesem Titel? Ein Klick sagt fast nichts,
// ein durchgeschauter Film sehr viel.
//
// Die Grenzen dafuer werden NICHT hier erfunden: `completed`, `watched` und
// `progress` setzt die App an anderer Stelle nach ihren eigenen Regeln, und
// die gelten auch hier. Gelesen wird nur, was dort schon entschieden wurde.
function signalStaerke(eintrag) {
  const dauer = zahl(eintrag?.duration);
  const stelle = zahl(eintrag?.position || eintrag?.currentTime);
  const anteil = dauer > 0 ? stelle / dauer : 0;
  const prozent = zahl(eintrag?.progress);
  const folgen = Array.isArray(eintrag?.completedEpisodes) ? eintrag.completedEpisodes.length : 0;

  let staerke = 0.1;
  if (stelle > 0 || prozent > 0) staerke = 0.25;
  if (anteil >= 0.1 || prozent >= 10) staerke = 0.5;
  if (anteil >= 0.5 || prozent >= 50) staerke = 0.8;
  if (eintrag?.watched) staerke = Math.max(staerke, 0.8);
  if (eintrag?.completed || eintrag?.episodeCompleted || anteil >= 0.75 || prozent >= 75) staerke = 1;
  // Die Watchlist ist Interesse, kein Urteil - sie hebt an, ueberholt aber
  // nichts, was wirklich geschaut wurde.
  if (eintrag?.favorite) staerke = Math.max(staerke, 0.6);
  // Wer viele Folgen durchhat, meint es ernst.
  return staerke * (1 + Math.min(folgen, 15) * 0.05);
}

// Wurde hier abgebrochen? Nur, wenn wirklich etwas lief, es lange her ist und
// nie weitergegangen wurde. Ein Titel, der gestern begonnen wurde, ist kein
// Abbruch, sondern offen.
function istAbgebrochen(eintrag, jetzt) {
  if (eintrag?.completed || eintrag?.watched || eintrag?.favorite) return false;
  const dauer = zahl(eintrag?.duration);
  const stelle = zahl(eintrag?.position || eintrag?.currentTime);
  if (dauer <= 0 || stelle <= 0) return false;
  const anteil = stelle / dauer;
  if (anteil <= 0 || anteil >= 0.15) return false;
  const alter = (jetzt - zeitpunkt(eintrag)) / 86400000;
  return alter > 3;
}

// Der Name, den ein Verlaufseintrag in einer Begruendung bekommt. Bereinigt,
// aber nicht normalisiert - er wird gelesen, nicht verglichen.
function anzeigeName(eintrag) {
  if (!eintrag) return "";
  return String(eintrag.zerlegt?.klar || eintrag.roh?.baseTitle || eintrag.roh?.title || "").trim();
}

function aktualitaet(eintrag, jetzt) {
  const wann = zeitpunkt(eintrag);
  if (!wann) return 0.25;
  const tage = Math.max(0, (jetzt - wann) / 86400000);
  return Math.max(0.1, 0.5 ** (tage / HALBWERT_TAGE));
}

// --- Profil -------------------------------------------------------------------

// Aus dem Verlauf entsteht ein Interessenprofil. Es gibt es zweimal: einmal
// ueber alles (langfristiger Geschmack) und einmal nur ueber die letzten
// Stunden (was gerade laeuft). Beides wird spaeter getrennt verrechnet, weil
// die aktuelle Sitzung viel mehr ueber die naechste Wahl sagt als der
// Durchschnitt der letzten Monate - ohne dass der Durchschnitt verlorengeht.
function profilBauen(verlauf, jetzt = Date.now()) {
  const lang = new Map();
  const kurz = new Map();
  const reihen = new Map();
  const typen = new Map();
  const anbieter = new Map();
  // Anime, Serie oder Film. Getrennt von `typen` gefuehrt, weil `type` Anime
  // und Serie zusammenwirft - fuer die Bewertung reicht das, fuer die
  // Begruendung nicht.
  const arten = new Map();
  const artWerke = new Map();
  const abneigung = new Map();
  // Wie viele verschiedene Werke tragen ein Genre? Ein einzelner Titel macht
  // noch keinen Geschmack - daran entscheidet sich spaeter, ob ein Genre in
  // der Begruendung beim Namen genannt werden darf.
  const genreWerke = new Map();
  const gesehen = new Map();
  const werke = new Set();
  let gesamt = 0;
  let kurzGesamt = 0;

  const eintraege = (verlauf || []).map((roh) => {
    const name = roh.baseTitle || roh.title || "";
    const zerlegt = titel.zerlegen(name);
    return {
      roh,
      zerlegt,
      staerke: signalStaerke(roh),
      frische: aktualitaet(roh, jetzt),
      wann: zeitpunkt(roh),
      genres: inhaltsTags((roh.genres || []).map((g) => (typeof g === "string" ? g : g?.key))),
      typ: String(roh.type || "").toLowerCase(),
      art: String(roh.art || "").toLowerCase(),
      abgebrochen: istAbgebrochen(roh, jetzt),
      // Vorgemerkt, aber nie angeschaut: Interesse, kein Urteil.
      nurGemerkt: Boolean(roh.favorite)
        && !roh.completed && !roh.watched && !roh.episodeCompleted
        && !zahl(roh.position) && !zahl(roh.currentTime) && !zahl(roh.progress)
    };
  });

  const haeufig = titel.haeufigkeiten(eintraege.map((e) => e.zerlegt));

  for (const e of eintraege) {
    werke.add(titel.werkSchluessel(e.zerlegt, e.typ));
    const gewicht = e.staerke * e.frische;

    if (e.abgebrochen) {
      // Abbrueche zaehlen negativ, aber deutlich vorsichtiger als alles
      // Positive: ein einzelner Abbruch heisst nicht, dass jemand ein Genre
      // nicht mag. Erst mehrere in dieselbe Richtung wirken sich aus.
      for (const key of e.genres) abneigung.set(key, (abneigung.get(key) || 0) + 0.25);
      continue;
    }
    if (gewicht <= 0) continue;

    gesamt += gewicht;
    anbieter.set(e.roh.providerId, (anbieter.get(e.roh.providerId) || 0) + gewicht);
    if (e.typ) typen.set(e.typ, (typen.get(e.typ) || 0) + gewicht);
    if (e.art) {
      arten.set(e.art, (arten.get(e.art) || 0) + gewicht);
      const traeger = artWerke.get(e.art) || new Set();
      traeger.add(titel.werkSchluessel(e.zerlegt, e.typ));
      artWerke.set(e.art, traeger);
    }

    // Ein Titel, der nur auf der Watchlist steht, praegt das Genre-Profil
    // nicht mit. Er hat seinen eigenen, schwaecheren Kanal (siehe unten in
    // den Merkmalen) - beides zusammen hiesse, ihn doppelt zu zaehlen, und
    // dann schluege blosses Vormerken das tatsaechliche Anschauen.
    if (!e.nurGemerkt) {
      // Das Hauptgenre steht bei allen Anbietern zuerst; spaetere zaehlen
      // weniger, sonst gewinnen Titel mit vielen Nebengenres.
      e.genres.forEach((key, index) => {
        const anteil = gewicht / (1 + index * 0.35);
        lang.set(key, (lang.get(key) || 0) + anteil);
      });
      const werk = titel.werkSchluessel(e.zerlegt, e.typ);
      for (const key of new Set(e.genres)) {
        const traeger = genreWerke.get(key) || new Set();
        traeger.add(werk);
        genreWerke.set(key, traeger);
      }
    }

    // Die Sitzung: was in den letzten Stunden lief.
    const stunden = e.wann ? (jetzt - e.wann) / 3600000 : Infinity;
    if (stunden <= SITZUNG_STUNDEN) {
      kurzGesamt += e.staerke;
      e.genres.forEach((key, index) => {
        kurz.set(key, (kurz.get(key) || 0) + e.staerke / (1 + index * 0.35));
      });
    }

    // Reihen: welcher Teil wurde wie weit geschaut? Daraus entsteht spaeter
    // der naechste sinnvolle Teil.
    // Unter zwei Schluesseln abgelegt: dem vollen Reihenschluessel und dem
    // ersten Inhaltswort. So findet ein Kandidat die Reihe auch dann, wenn
    // sein Titel anders lang ist als der geschaute Teil. Gefunden zu werden
    // heisst noch nicht dazuzugehoeren - das entscheidet die Konfidenz.
    const teilEintrag = {
      zerlegt: e.zerlegt,
      teil: e.zerlegt.teil,
      fertig: Boolean(e.roh.completed || e.roh.watched),
      staerke: e.staerke,
      // Fuer den Graubereich der Reihenerkennung: nur am Inhalt laesst sich
      // "Naruto Shippuden" von "Avatar Aang" unterscheiden.
      genres: e.genres,
      // Der lesbare Name, so wie er auf der Karte stehen wuerde. Ohne ihn
      // koennte die Begruendung spaeter nur "deine Reihe" sagen.
      name: anzeigeName(e)
    };
    const inhaltsworte = e.zerlegt.stammTokens.filter(titel.istInhaltswort);
    const rk = titel.franchiseSchluessel(e.zerlegt);
    const reihe = reihen.get(rk) || { key: rk, teile: [], gewicht: 0, zuletzt: 0, kurz: false };
    // Dieselbe Reihe nur einmal fuehren. Derselbe Titel steht oft bei zwei
    // Anbietern in der Ablage - er ist deswegen kein zweiter Teil.
    const eigen = titel.schluessel(e.zerlegt.klar);
    if (!reihe.teile.some((teil) => titel.schluessel(teil.zerlegt.klar) === eigen)) {
      reihe.teile.push(teilEintrag);
    }
    reihe.gewicht += gewicht;
    reihe.zuletzt = Math.max(reihe.zuletzt, e.wann);
    if (stunden <= SITZUNG_STUNDEN) reihe.kurz = true;
    reihen.set(rk, reihe);
    // Das erste Inhaltswort verweist auf dieselbe Reihe, statt eine zweite
    // anzulegen: sonst zaehlte jede Reihe doppelt - einmal beim Gewicht, und
    // einmal bei der Vielfaltsregel, die dann zwei verschiedene Reihen sieht.
    const alias = inhaltsworte[0] || "";
    if (alias && alias !== rk && !reihen.has(alias)) reihen.set(alias, reihe);
    gesehen.set(titel.schluessel(e.zerlegt.klar), e);
  }

  const groesster = Math.max(...lang.values(), 0);
  if (groesster > 0) for (const [k, v] of lang) lang.set(k, v / groesster);
  const groesserKurz = Math.max(...kurz.values(), 0);
  if (groesserKurz > 0) for (const [k, v] of kurz) kurz.set(k, v / groesserKurz);

  return {
    genres: lang,
    sitzungGenres: kurz,
    reihen,
    abneigung,
    werke,
    haeufigkeiten: haeufig,
    eintraege,
    // Wie viel des Geschauten ist Film, wie viel Serie? Beeinflusst die
    // Reihenfolge leicht, schliesst aber nie etwas aus.
    typAnteil: (typ) => (gesamt > 0 ? (typen.get(String(typ || "").toLowerCase()) || 0) / gesamt : 0),
    anbieterAnteil: (id) => (gesamt > 0 ? (anbieter.get(id) || 0) / gesamt : 0),
    // Wie viel des Geschauten ist Anime, Serie, Film - und aus wie vielen
    // Werken? Beides zusammen entscheidet, ob sich daraus eine Vorliebe
    // ablesen laesst.
    artAnteil: (art) => (gesamt > 0 ? (arten.get(String(art || "").toLowerCase()) || 0) / gesamt : 0),
    artWerke: (art) => (artWerke.get(String(art || "").toLowerCase())?.size || 0),
    genreWert: (key) => lang.get(key) || 0,
    // Aus wie vielen verschiedenen Werken stammt dieses Genre?
    genreTraeger: (key) => (genreWerke.get(key)?.size || 0),
    sitzungWert: (key) => kurz.get(key) || 0,
    hatSitzung: kurzGesamt > 0,
    leer: lang.size === 0 && reihen.size === 0,
    umfang: eintraege.length
  };
}

// --- Aehnlichkeit von Genre-Mengen -------------------------------------------

// Nicht jedes gemeinsame Genre sagt gleich viel. "Action" tragen hunderte
// Titel, "Fighting-Shounen" ein paar Dutzend - wer beides teilt, teilt vor
// allem das zweite. Deshalb bekommt jedes Genre ein Gewicht aus seiner
// Haeufigkeit im Angebot: selten heisst aussagekraeftig.
//
// Das ist derselbe Gedanke wie bei der Titelanalyse, wo haeufige Woerter
// weniger zaehlen. Ohne ihn ist "beide sind Action" genauso viel wert wie
// "beide sind Fighting-Shounen" - und dann steht ein beliebiger Actionfilm
// neben One Piece.
const GENRE_GEWICHT_MIN = 0.35;

function genreGewichte(mengen) {
  const haeufigkeit = new Map();
  let gesamt = 0;
  for (const menge of mengen || []) {
    const eigen = new Set((menge || []).filter(Boolean));
    if (!eigen.size) continue;
    gesamt += 1;
    for (const key of eigen) haeufigkeit.set(key, (haeufigkeit.get(key) || 0) + 1);
  }
  const gewichte = new Map();
  if (!gesamt) return gewichte;
  // Log-Kehrwert der Haeufigkeit, auf 0..1 gebracht. Ein Genre, das in jedem
  // zweiten Titel steht, landet nahe am Minimum; eines in jedem fuenfzigsten
  // ganz oben.
  const groesste = Math.log(gesamt + 1);
  for (const [key, anzahl] of haeufigkeit) {
    const roh = Math.log((gesamt + 1) / (anzahl + 0.5)) / groesste;
    gewichte.set(key, Math.max(GENRE_GEWICHT_MIN, Math.min(1, roh)));
  }
  return gewichte;
}

// Zwei Genre-Mengen vergleichen: gemeinsame gegen alle beteiligten, jeweils
// mit ihrem Gewicht. Ohne Gewichte ist das der gewoehnliche Jaccard-Wert.
function genreAehnlichkeit(links, rechts, gewichte) {
  const a = new Set((links || []).filter(Boolean));
  const b = new Set((rechts || []).filter(Boolean));
  if (!a.size || !b.size) return 0;
  const wiegen = (key) => (gewichte ? (gewichte.get(key) ?? GENRE_GEWICHT_MIN) : 1);
  let schnitt = 0;
  let vereinigung = 0;
  for (const key of a) {
    vereinigung += wiegen(key);
    if (b.has(key)) schnitt += wiegen(key);
  }
  for (const key of b) if (!a.has(key)) vereinigung += wiegen(key);
  return vereinigung > 0 ? schnitt / vereinigung : 0;
}

// Wie gut passen die Genres eines Kandidaten zum Profil? Das staerkste Genre
// zaehlt voll, weitere nur anteilig - sonst gewinnen Titel, die in sehr vielen
// Genres stehen.
function profilPassung(keys, werte, gewichte) {
  const wiegen = (key) => (gewichte ? (gewichte.get(key) ?? GENRE_GEWICHT_MIN) : 1);
  const treffer = [...new Set(keys || [])]
    // Zwei Werte je Treffer: `wert` ist gewichtet und geht in die Punktzahl -
    // ein seltenes Genre sagt mehr als ein haeufiges. `roh` ist, wie stark das
    // Genre im Profil wirklich steht; nur daran entscheidet sich spaeter, ob
    // es beim Namen genannt werden darf. Sonst haenge die Aussage "du schaust
    // viel Action" davon ab, wie viele Actiontitel gerade zur Wahl stehen.
    .map((key) => ({ key, roh: werte(key), wert: werte(key) * wiegen(key) }))
    .filter((e) => e.wert > 0)
    .sort((l, r) => r.wert - l.wert);
  let summe = 0;
  treffer.forEach((e, index) => { summe += e.wert / (1 + index * 0.6); });
  return { wert: Math.min(1, summe), treffer };
}

// --- Reihen: welcher Teil kommt als Naechstes? --------------------------------

// Ist dieser Kandidat der naechste ungesehene Teil einer Reihe, die der Nutzer
// gerade verfolgt? Das ist das staerkste Signal des Systems.
//
// Rueckgabe enthaelt auch, warum: fuer den Debug-Modus und spaeter fuer die
// Begruendung in der Oberflaeche.
// Ab hier gilt ein Titelpaar als Reihe. Darunter liegt ein Graubereich, in
// dem der Titel allein nicht reicht - dort muss ein zweites, unabhaengiges
// Signal dazukommen (siehe unten).
const REIHE_SICHER = 0.7;
const REIHE_GRAU = 0.45;
// So aehnlich muessen sich die Inhalte sein, damit aus dem Graubereich eine
// Reihe wird. Das ist bewusst hoch: es geht um Titel wie "Naruto" und
// "Naruto Shippuden", die praktisch dieselben Tags tragen.
const REIHE_BESTAETIGUNG = 0.75;
const REIHE_BESTAETIGT = 0.8;

function naechsterTeilInReihe(kandidat, profil, gewichte) {
  // Der Schluessel ist nur ein Vorfilter. Gesucht wird unter zwei Formen -
  // dem vollen Reihenschluessel und dem ersten Inhaltswort allein -, damit
  // auch Reihen gefunden werden, deren Titel unterschiedlich lang sind.
  //
  // Das ist bewusst grosszuegig: entschieden wird ausschliesslich ueber die
  // Konfidenz gegen die wirklich geschauten Teile. Ein gemeinsames Wort
  // bringt einen Kandidaten also in die Pruefung, aber nicht durch sie.
  const inhalt = kandidat.zerlegt.stammTokens.filter(titel.istInhaltswort);
  const schluessel = [titel.franchiseSchluessel(kandidat.zerlegt), inhalt[0] || ""];

  let reihe = null;
  let beste = 0;
  let bezug = null;
  for (const key of new Set(schluessel.filter(Boolean))) {
    const treffer = profil.reihen.get(key);
    if (!treffer) continue;
    for (const teil of treffer.teile) {
      const k = titel.franchiseKonfidenz(teil.zerlegt, kandidat.zerlegt);
      if (k > beste) { beste = k; bezug = teil; reihe = treffer; }
    }
  }
  if (!bezug || !reihe || beste < REIHE_GRAU) return null;

  // Der Graubereich: ein einziges gemeinsames Wort. Dieselbe Form haben
  // "Naruto" und "Naruto Shippuden" - und "Avatar" und "Avatar Aang: Der
  // Herr der Elemente". Der Titel kann das nicht entscheiden, aber die
  // Inhalte koennen es: eine Fortsetzung traegt praktisch dieselben Genres
  // und Tags wie ihr Vorgaenger, ein fremdes Werk mit gleichem Namen nicht.
  //
  // Zwei schwache Signale, die sich gegenseitig bestaetigen - kein Titel und
  // keine Reihe ist dafuer fest verdrahtet.
  if (beste < REIHE_SICHER) {
    const deckung = genreAehnlichkeit(kandidat.genres, bezug.genres, gewichte);
    if (deckung < REIHE_BESTAETIGUNG) return null;
    beste = REIHE_BESTAETIGT;
  }

  // Schon gesehen? Dann ist es kein naechster Teil.
  const eigen = titel.schluessel(kandidat.zerlegt.klar);
  if (reihe.teile.some((teil) => titel.schluessel(teil.zerlegt.klar) === eigen)) {
    return { konfidenz: beste, reihe, naechster: false, bezug };
  }

  // Der hoechste Teil, den der Nutzer wirklich fertig hat.
  const fertige = reihe.teile.filter((teil) => teil.fertig);
  const hoechsterFertig = fertige.length ? Math.max(...fertige.map((teil) => teil.teil || 1)) : 0;
  // Genau dieser Teil ist der, nach dem der Kandidat kommt - er und nicht
  // der aehnlichste Titel. Steht der Nutzer bei Teil 2, muss die Begruendung
  // Teil 2 nennen und nicht Teil 1.
  const vorgaenger = fertige.find((teil) => (teil.teil || 1) === hoechsterFertig) || null;
  const eigenerTeil = kandidat.zerlegt.teil;

  // Ohne Nummern laesst sich keine Reihenfolge behaupten. Dann ist es zwar
  // dieselbe Reihe, aber nicht nachweisbar der naechste Teil - und wird auch
  // nicht so behandelt.
  if (!eigenerTeil) {
    return { konfidenz: beste, reihe, naechster: false, bezug, ohneNummer: true };
  }
  // Ein frueherer Teil als der, den man schon fertig hat, ist kein Fortschritt.
  if (hoechsterFertig && eigenerTeil <= hoechsterFertig) {
    return { konfidenz: beste, reihe, naechster: false, bezug, zurueck: true };
  }
  // Genau der naechste ist am staerksten; weiter vorn liegende Teile zaehlen
  // abgeschwaecht, damit nicht Teil 5 vor Teil 2 landet.
  const abstand = hoechsterFertig ? eigenerTeil - hoechsterFertig : eigenerTeil - 1;
  return {
    konfidenz: beste,
    reihe,
    naechster: true,
    bezug,
    vorgaenger,
    abstand: Math.max(0, abstand),
    naehe: 1 / (1 + Math.max(0, abstand - 1) * 0.8)
  };
}

// --- Wann ist ein Beleg stark genug, um ihn zu nennen? ------------------------
//
// ELFIX kennt zu einem Titel nur Genres - keine Besetzung, keine Beschreibung,
// kein Jahr. Zwei Titel, die beide "Abenteuer, Action, Fantasy" tragen, sind
// damit noch lange nicht aehnlich; sie sind nur beide profiltypisch. Ein
// einzelner Titel darf deshalb erst dann als Grund genannt werden, wenn er
// drei Huerden nimmt:
//
//   1. mehr als ein gemeinsames Genre - eines allein ist kein Zusammenhang,
//   2. Genre-Mengen, die sich wirklich weitgehend decken,
//   3. und er muss den Loewenanteil der Aehnlichkeit tragen. Wenn ein Dutzend
//      Verlaufstitel denselben Kandidaten gleich gut stuetzen, erklaert keiner
//      davon die Empfehlung - dann ist es das Profil und nicht der Titel.
//
// Genau diese Unterscheidung trennt "Weil du Naruto geschaut hast" von "Weil
// du oft Fighting-Shounen schaust": im ersten Fall traegt ein Titel fast
// alles, im zweiten verteilt es sich.
//
// Verglichen wird je Werk, nicht je Eintrag: derselbe Titel steht oft zweimal
// in der Ablage (zwei Anbieter, zwei Folgen). Zwei Eintraege desselben Werks
// duerfen sich nicht gegenseitig die Dominanz nehmen.
const SEED_GEMEINSAM = 2;
const SEED_DECKUNG = 0.6;
// Mehr als alle uebrigen Werke zusammen. Bei zwei gleich starken Seeds waere
// die Wahl zwischen ihnen willkuerlich - dann zaehlt das Profil.
const SEED_DOMINANZ = 0.55;
// Dasselbe fuer die Watchlist: erst wenn ein einzelner vorgemerkter Titel das
// Signal traegt, wird er genannt - sonst bleibt es bei "deiner Watchlist".
const WATCHLIST_ANTEIL = 0.6;
// Ein Genre wird nur beim Namen genannt, wenn es aus mehreren Werken stammt
// und im Profil wirklich weit vorn liegt. Aus einem Film folgt kein Geschmack.
const GENRE_WERKE = 2;
const GENRE_KLAR = 0.35;
// Ein spezifischer Tag ("Fighting-Shounen", "Isekai") sagt mehr ueber den
// Geschmack als ein breites Genre - er darf deshalb frueher genannt werden.
// Aus mehreren Werken stammen muss er trotzdem.
const TAG_KLAR = 0.3;
// Eine Vorliebe fuer Anime, Serien oder Filme ist erst eine, wenn sie den
// Verlauf wirklich praegt.
const ART_ANTEIL = 0.5;
const ART_WERKE = 3;
// Ab wann ist eine Reihe "lange her"? Dann wird daraus eine Wiederentdeckung
// statt einer laufenden Reihe.
const WIEDER_TAGE = 45;

// --- Merkmale eines Kandidaten ------------------------------------------------

const GRUND = {
  NAECHSTER_TEIL: "NEXT_IN_FRANCHISE",
  REIHE: "SAME_FRANCHISE",
  WIEDERENTDECKUNG: "REDISCOVERY",
  AEHNLICH_ZULETZT: "STRONG_SEED_SIMILARITY",
  ANBIETER_AEHNLICH: "RELATED_BY_PROVIDER",
  TAG: "SPECIFIC_TAG",
  TAG_PAAR: "TAG_COMBINATION",
  GENRE: "BASED_ON_GENRE",
  WATCHLIST: "BASED_ON_WATCHLIST",
  SITZUNG: "CURRENT_TASTE",
  VERLAUF: "LONG_TERM_TASTE",
  NEUHEIT: "NOVELTY",
  ERKUNDUNG: "EXPLORATION"
};

// Breite Sammelgenres. Alles andere, was die Anbieter als Genre fuehren, ist
// ein spezifischer Tag - "Fighting-Shounen", "Isekai", "Magical Girl". Der
// sagt mehr ueber den Geschmack aus und wird deshalb bevorzugt genannt.
const BREITE_GENRES = new Set([
  "action", "abenteuer", "animation", "doku", "drama", "familie", "fantasy",
  "historie", "horror", "komoedie", "krieg", "krimi", "musik", "mystery",
  "reality", "romanze", "scifi", "sport", "thriller", "tvfilm", "western",
  "superhelden", "uebernatuerlich", "zeichentrick"
]);

function istSpezifisch(key) {
  return Boolean(key) && !BREITE_GENRES.has(String(key).toLowerCase()) && !istTechnisch(key);
}

// Sprach- und Formatmarken. Die Anbieter fuehren sie in derselben Liste wie
// Genres, sie sagen aber nichts ueber den Inhalt: dass zwei Titel beide
// "GerSub" sind, verbindet sie nicht. Discover filtert sie schon beim Lesen
// weg - hier steht die zweite Sicherung, damit kein Weg daran vorbeifuehrt.
const TECHNISCHE_TAGS = new Set([
  "ger", "gersub", "gerdub", "engsub", "engdub", "eng", "dub", "sub", "omu",
  "deutsch", "german", "english", "englisch", "untertitel", "synchro",
  "subbed", "dubbed", "hd", "fhd", "4k", "stream", "vod"
]);

function istTechnisch(key) {
  return TECHNISCHE_TAGS.has(String(key || "").toLowerCase());
}

// Aus einer rohen Genre-Liste wird das, was ueberhaupt Geschmack ausdrueckt.
function inhaltsTags(keys) {
  return [...new Set((keys || []).filter(Boolean))].filter((key) => !istTechnisch(key));
}

// Alle Teilwerte eines Kandidaten. Bewusst getrennt gehalten: so laesst sich
// im Debug-Modus ablesen, woher die Punkte kommen, und einzelne Signale lassen
// sich abschalten, ohne den Rest anzufassen.
function merkmale(kandidat, profil, optionen = {}) {
  const jetzt = optionen.jetzt || Date.now();
  // Wie aussagekraeftig ist welches Genre? Kommt aus dem ganzen Angebot,
  // nicht aus diesem einen Titel - deshalb einmal je Durchlauf berechnet.
  const gewichte = optionen.gewichte;
  const m = {
    naechsterTeil: 0,
    reihe: 0,
    aehnlichLautAnbieter: 0,
    sitzung: 0,
    verlauf: 0,
    genre: 0,
    watchlist: 0,
    titel: 0,
    neuheit: 0,
    abneigung: 0,
    schonGesehen: 0,
    muede: 0
  };
  const gruende = [];
  // Die Belege zu den Gruenden: woran genau die Empfehlung haengt. Sie
  // aendern nichts an der Bewertung - sie halten nur fest, welcher Titel und
  // welches Genre den Ausschlag gegeben haben, damit die Oberflaeche den
  // Grund benennen kann, statt ihn zu umschreiben. Was hier leer bleibt, darf
  // dort nicht behauptet werden.
  const belege = {
    reiheTitel: "", reiheKonfidenz: 0, reiheTage: 0,
    anbieterSeiten: 0, anbieterBreite: 0,
    anbieterTitel: "",
    // `verlaufTitel` ist der Titel, der genannt werden DARF. `verlaufBester`
    // ist nur, wer am besten passte - der steht auch im Debug-Bericht, wenn er
    // die Huerden nicht nimmt.
    verlaufTitel: "", verlaufBester: "", verlaufAnteil: 0, verlaufDeckung: 0, verlaufGemeinsam: 0,
    verlaufGeschaut: false,
    watchlistTitel: "", watchlistBester: "", watchlistAnteil: 0,
    genre: "", genreBestes: "", genreSitzung: false, genreWerke: 0,
    tag: "", tagWerke: 0,
    art: "", artAnteil: 0
  };
  const eigeneGenres = [...new Set(kandidat.genres || [])].filter(Boolean);

  // 1. Reihe und naechster Teil.
  const reihe = naechsterTeilInReihe(kandidat, profil, gewichte);
  if (reihe) {
    if (reihe.naechster) {
      // Nur dieser eine Wert. Die Zugehoerigkeit zur Reihe steckt bereits
      // darin - beides zu addieren hiesse, dasselbe zweimal zu zaehlen, und
      // dann liegt eine Reihe mit vier ungesehenen Teilen so weit vorn, dass
      // sie durch keine Vielfaltsregel mehr einzuholen ist. `naehe` sorgt
      // dafuer, dass der uebernaechste Teil deutlich abfaellt.
      m.naechsterTeil = reihe.konfidenz * reihe.naehe;
      gruende.push(GRUND.NAECHSTER_TEIL);
      belege.reiheTitel = reihe.vorgaenger?.name || reihe.bezug?.name || "";
      belege.reiheKonfidenz = reihe.konfidenz;
    } else if (!reihe.zurueck) {
      // Dieselbe Reihe, aber die Reihenfolge ist nicht belegbar - etwa ein
      // Ableger ohne Nummer. Zaehlt als starke Aehnlichkeit, nicht als
      // Fortsetzung.
      m.reihe = reihe.konfidenz * 0.7;
      gruende.push(GRUND.REIHE);
      belege.reiheTitel = reihe.bezug?.name || "";
      belege.reiheKonfidenz = reihe.konfidenz;
    }
    // Wie lange ist der letzte Teil her? Eine Reihe, die vor Monaten lief,
    // ist eine Wiederentdeckung und keine laufende Reihe.
    belege.reiheTage = reihe.reihe.zuletzt ? (jetzt - reihe.reihe.zuletzt) / 86400000 : 0;
    // Laeuft die Reihe gerade in dieser Sitzung, wiegt das zusaetzlich.
    if (reihe.reihe.kurz) m.sitzung = Math.max(m.sitzung, 0.9);
  }

  // 2. Was der Anbieter selbst als aehnlich ausweist. Das beste externe
  //    Signal, das es gibt - aber es gibt es nicht ueberall.
  if (kandidat.via === "related") {
    // Der Anbieterhinweis zaehlt nur so weit, wie er ueberhaupt unterscheidet.
    // Steht ein Titel auf der Haelfte aller Seiten, bleibt davon fast nichts.
    const seiten = zahl(optionen.seedSeiten);
    const verlinkt = kandidat.seeds?.size || 1;
    belege.anbieterSeiten = verlinkt;
    belege.anbieterBreite = seiten > 1 ? verlinkt / seiten : 0;
    const eigenstaendig = seiten > 2 ? Math.max(0, 1 - (verlinkt - 1) / (seiten - 1)) : 1;
    m.aehnlichLautAnbieter = Math.min(1, zahl(kandidat.seedWeight) || 0.5) * eigenstaendig;
    gruende.push(GRUND.ANBIETER_AEHNLICH);
    // Auf wessen Seite der Anbieter diesen Titel fuehrt. Das ist ein Beleg
    // fuer eine Verknuepfung, nicht fuer Aehnlichkeit - die Formulierung darf
    // spaeter nicht mehr behaupten, als der Anbieter hergibt.
    belege.anbieterTitel = String(kandidat.seedTitle || "").trim();
  }

  // 3. Genres gegen das langfristige Profil und gegen die Sitzung.
  const lang = profilPassung(kandidat.genres, (key) => profil.genreWert(key), gewichte);
  const kurz = profilPassung(kandidat.genres, (key) => profil.sitzungWert(key), gewichte);
  m.genre = lang.wert;
  if (kurz.wert > 0) m.sitzung = Math.max(m.sitzung, kurz.wert);
  // Welches Genre traegt die Passung? Genannt wird nur das staerkste - und
  // dazu, ob es aus der laufenden Sitzung stammt oder aus dem langen Profil.
  // Das ist der Unterschied zwischen "zuletzt viel Action" und "oft Action".
  const sitzungFuehrt = Boolean(kurz.treffer.length) && kurz.wert >= lang.wert;
  const fuehrendesGenre = (sitzungFuehrt ? kurz.treffer[0] : lang.treffer[0]) || null;
  belege.genreBestes = fuehrendesGenre ? fuehrendesGenre.key : "";
  belege.genreSitzung = Boolean(fuehrendesGenre) && sitzungFuehrt;
  belege.genreWerke = fuehrendesGenre ? profil.genreTraeger(fuehrendesGenre.key) : 0;
  // Beim Namen genannt wird ein Genre nur, wenn es mehrere Werke tragen und
  // es im Profil wirklich vorn liegt. Gesucht wird dafuer das beste Genre,
  // das diese Bedingung erfuellt - nicht nur das erste: das staerkste
  // Signal kann von einem seltenen Genre kommen, das der Nutzer kaum
  // schaut, und dann waere "weil du oft X schaust" schlicht falsch.
  const nennbares = (sitzungFuehrt ? kurz.treffer : lang.treffer)
    .find((treffer) => treffer.roh >= GENRE_KLAR && profil.genreTraeger(treffer.key) >= GENRE_WERKE);
  belege.genre = nennbares ? nennbares.key : "";
  if (nennbares) belege.genreWerke = profil.genreTraeger(nennbares.key);

  // Der staerkste spezifische Tag, den der Kandidat mit dem Profil teilt.
  // Spezifisch heisst: kein breites Sammelgenre - "Fighting-Shounen" statt
  // "Action". Auch er muss aus mehreren Werken stammen.
  const tagTreffer = (sitzungFuehrt ? kurz.treffer : lang.treffer)
    .filter((treffer) => istSpezifisch(treffer.key))
    .find((treffer) => treffer.roh >= TAG_KLAR && profil.genreTraeger(treffer.key) >= GENRE_WERKE);
  belege.tag = tagTreffer ? tagTreffer.key : "";
  belege.tagWerke = tagTreffer ? profil.genreTraeger(tagTreffer.key) : 0;

  // Anime, Serie oder Film: nur wenn der Verlauf das wirklich hergibt.
  const art = String(kandidat.art || "").toLowerCase();
  belege.artAnteil = art ? profil.artAnteil(art) : 0;
  belege.art = art && belege.artAnteil >= ART_ANTEIL && profil.artWerke(art) >= ART_WERKE ? art : "";

  // 4. Aehnlichkeit zu einzelnen Titeln des Verlaufs - ueber Genre-Mengen,
  //    gewichtet mit Signalstaerke und Aktualitaet. Das ist etwas anderes als
  //    das Profil oben: hier zaehlt die Uebereinstimmung mit einem konkreten
  //    Titel, nicht mit dem Durchschnitt.
  let besteVerlauf = 0;
  let bestesVorbild = null;
  let watchlistSumme = 0;
  // Welcher einzelne vorgemerkte Titel passt am besten? Die Summe oben sagt,
  // wie stark das Signal ist, aber nicht, wovon es kommt.
  let besteWatchlist = 0;
  let bestesWatchlistVorbild = null;
  // Wie verteilt sich die Aehnlichkeit ueber den Verlauf? Ein einzelner Titel
  // erklaert nur dann etwas, wenn er sich vom Rest abhebt - sonst ist es das
  // Profil, das den Kandidaten traegt.
  const jeWerk = new Map();
  for (const e of profil.eintraege) {
    if (e.abgebrochen) continue;
    const g = genreAehnlichkeit(kandidat.genres, e.genres, gewichte);
    if (g <= 0) continue;
    // Mehrere aehnliche Titel auf der Watchlist verstaerken einander - ein
    // einzelner vorgemerkter Film sagt wenig, drei in dieselbe Richtung viel.
    if (e.roh.favorite) {
      watchlistSumme += g * 0.5;
      if (g > besteWatchlist) { besteWatchlist = g; bestesWatchlistVorbild = e; }
    }
    const wert = g * e.staerke * e.frische;
    if (wert > besteVerlauf) { besteVerlauf = wert; bestesVorbild = e; }
    const werk = titel.werkSchluessel(e.zerlegt, e.typ);
    const bisher = jeWerk.get(werk);
    if (!bisher || wert > bisher.wert) {
      jeWerk.set(werk, {
        wert,
        deckung: g,
        gemeinsam: eigeneGenres.filter((key) => e.genres.includes(key)).length,
        eintrag: e
      });
    }
  }
  const werke = [...jeWerk.values()].sort((links, rechts) => rechts.wert - links.wert);
  const bestesWerk = werke[0] || null;
  const zweitbestes = werke[1] || null;
  // Gezaehlt wird je Werk. Derselbe Titel steht oft zweimal in der Ablage -
  // wuerde jeder Eintrag einzeln zaehlen, naehme sich ein Werk seine eigene
  // Dominanz weg.
  const seedSumme = werke.reduce((summe, werk) => summe + werk.wert, 0);
  const watchlistWert = Math.min(1, watchlistSumme);
  m.verlauf = Math.min(1, besteVerlauf);
  m.watchlist = Math.min(1, watchlistWert);
  if (m.verlauf > 0.25 && bestesVorbild) {
    gruende.push(bestesVorbild.frische > 0.7 ? GRUND.AEHNLICH_ZULETZT : GRUND.VERLAUF);
  }
  if (m.watchlist > 0.3) gruende.push(GRUND.WATCHLIST);
  if (!gruende.length && m.genre > 0) gruende.push(GRUND.GENRE);

  // Was davon darf spaeter als Titel dastehen?
  belege.verlaufBester = anzeigeName(bestesWerk?.eintrag);
  belege.verlaufAnteil = seedSumme > 0 ? (bestesWerk?.wert || 0) / seedSumme : 0;
  belege.verlaufDeckung = bestesWerk?.deckung || 0;
  belege.verlaufGemeinsam = bestesWerk?.gemeinsam || 0;
  belege.verlaufVorsprung = bestesWerk && zweitbestes?.wert > 0
    ? bestesWerk.wert / zweitbestes.wert
    : Infinity;
  // Steckt hinter der Verlaufs-Aehnlichkeit ueberhaupt etwas Geschautes? Wenn
  // nur vorgemerkte Titel beitragen, darf kein Satz vom Schauen reden - dann
  // ist die Watchlist der Grund und nicht der Verlauf.
  belege.verlaufGeschaut = werke.some((werk) => werk.wert > 0 && !werk.eintrag.nurGemerkt);
  // Ein nur vorgemerkter Titel wurde nicht geschaut - der begruendet die
  // Watchlist, nie den Verlauf.
  const seedTraegt = Boolean(bestesWerk)
    && !bestesWerk.eintrag.nurGemerkt
    && bestesWerk.gemeinsam >= SEED_GEMEINSAM
    && bestesWerk.deckung >= SEED_DECKUNG
    && belege.verlaufAnteil >= SEED_DOMINANZ;
  belege.verlaufTitel = seedTraegt ? belege.verlaufBester : "";

  belege.watchlistBester = anzeigeName(bestesWatchlistVorbild);
  belege.watchlistAnteil = watchlistSumme > 0 ? (besteWatchlist * 0.5) / watchlistSumme : 0;
  belege.watchlistTitel = belege.watchlistAnteil >= WATCHLIST_ANTEIL ? belege.watchlistBester : "";

  // 5. Titelaehnlichkeit - schwaches Signal, aber es faengt Reihen, die die
  //    Konfidenz knapp verfehlen, und Fortsetzungen ohne Nummer.
  if (!m.reihe) {
    let besteTitel = 0;
    for (const e of profil.eintraege) {
      if (e.abgebrochen) continue;
      const s = titel.tokenAehnlichkeit(kandidat.zerlegt.tokens, e.zerlegt.tokens, profil.haeufigkeiten);
      if (s > besteTitel) besteTitel = s;
    }
    m.titel = besteTitel > 0.35 ? besteTitel : 0;
  }

  // 6. Abneigung: mehrere Abbrueche in dieselbe Richtung.
  let abneigung = 0;
  for (const key of kandidat.genres || []) abneigung += profil.abneigung.get(key) || 0;
  // Gedeckelt, und erst ab dem zweiten Abbruch spuerbar.
  m.abneigung = Math.min(0.5, Math.max(0, abneigung - 0.25) * 0.3);

  // 7. Schon gesehen. Ein abgeschlossener Titel gehoert nicht in die normalen
  //    Empfehlungen - er wird nicht nur abgewertet, sondern spaeter gefiltert.
  if (profil.werke.has(titel.werkSchluessel(kandidat.zerlegt, kandidat.type))) m.schonGesehen = 1;

  // 8. Muedigkeit: oft gezeigt, nie geoeffnet.
  const anzeigen = zahl(optionen.anzeigen?.get(kandidat.werkKey));
  if (anzeigen > MUEDE_AB) {
    m.muede = Math.min(MUEDE_MAX, (anzeigen - MUEDE_AB) * 0.08);
  }

  // 9. Neuheit. Bewusst klein und ohne Zufall: ein stabiler Wert je Titel,
  //    damit die Startseite sich nicht bei jedem Aufruf umsortiert.
  m.neuheit = kandidat.via === "new" ? 0.6 : 0.2;

  return { m, gruende, reihe, belege };
}

// --- Welche Gruende gibt es, und welcher wird genannt? -----------------------
//
// Die Begruendung soll erklaeren, warum dieser Titel *im fertigen Ranking*
// steht - nicht, wie er in die Auswahl gekommen ist. Das sind zwei
// verschiedene Dinge: ein Kandidat kann ueber die "Das schauen andere"-Liste
// von Titel A hereinkommen und am Ende ganz von seinem Genre getragen werden.
// Frueher blieb dann A als sichtbarer Grund stehen, obwohl A nichts dazu
// beigetragen hat.
//
// Deshalb wird jeder moegliche Grund an denselben Zahlen gemessen, aus denen
// auch die Punktzahl entsteht: Gewicht mal Merkmal. Ein Grund kommt nur in
// Frage, wenn er
//
//   - einen Beleg hat, der die Huerden oben nimmt (Deckung, Vorsprung,
//     tragende Werke), und
//   - am positiven Gesamtbeitrag spuerbar beteiligt ist.
//
// Welche Daten es dafuer gibt, steht in begruendung.js - dort ist auch
// festgehalten, welche Gruende ELFIX bewusst NICHT kennt, weil die Daten
// fehlen (Besetzung, Regie, Studio, Bewertungen, Popularitaet).

// Die Beitraege zum Score, aufgeschluesselt. `punkte` summiert genau diese
// Werte - beide muessen dieselben Gewichte benutzen.
function beitraege(m) {
  return {
    naechsterTeil: G.naechsterTeil * m.naechsterTeil,
    reihe: G.reihe * m.reihe,
    anbieter: G.aehnlichLautAnbieter * m.aehnlichLautAnbieter,
    sitzung: G.sitzung * m.sitzung,
    verlauf: G.verlauf * m.verlauf,
    genre: G.genre * m.genre,
    watchlist: G.watchlist * m.watchlist,
    titel: G.titel * m.titel,
    neuheit: G.neuheit * m.neuheit
  };
}

// So viel muss ein Signal am positiven Gesamtbeitrag halten, um ueberhaupt
// genannt zu werden - es sei denn, es ist ohnehin das groesste.
const GRUND_RELEVANZ = 0.25;

// Wie sehr ist einem Grund zu trauen? Fakten ueber genau dieses Titelpaar
// (Reihe, belegter Seed, Anbieter-Verknuepfung) stehen ueber Aussagen ueber
// das Profil, und die wieder ueber blosser Neuheit.
const VERTRAUEN = { paar: 1, tag: 0.85, profil: 0.75, rest: 0.5 };

// Wie viel sagt der Satz aus? "Naechster Teil nach X" ist eine Aussage ueber
// genau diesen Titel, "Etwas Neues fuer dich" ueber gar nichts. Bei aehnlicher
// Belastbarkeit gewinnt der spezifischere Grund - genau deshalb steht hier
// eine Zahl und keine feste Wenn-dann-Kette.
function gueteVon(grund) {
  const roh = grund.anteil * grund.vertrauen * (0.6 + 0.4 * grund.spezifitaet);
  return Number(roh.toFixed(6));
}

// Nicht jede Beziehung ist von derselben Art. Eine belegte Fortsetzung ist
// etwas grundsaetzlich anderes als "passt zum Geschmack" - und zwar auch
// dann, wenn das Geschmackssignal rechnerisch etwas mehr beitraegt. Deshalb
// zaehlt zuerst die Klasse der Beziehung und erst danach ihr Gewicht.
//
// Die Klassen sind bewusst grob: alles unterhalb der Reihen wird ueber die
// Guete sortiert, damit sich Spezifitaet und Beitrag dort frei auswirken.
const KLASSE = { fortsetzung: 0, reihe: 1, rest: 2 };

function klasseVon(grund) {
  if (grund.grund === GRUND.NAECHSTER_TEIL) return KLASSE.fortsetzung;
  if (grund.grund === GRUND.REIHE || grund.grund === GRUND.WIEDERENTDECKUNG) return KLASSE.reihe;
  return KLASSE.rest;
}

// Alle Gruende, die dieser Kandidat wirklich hergibt - der beste zuerst.
// Jeder Eintrag traegt mit, worauf er sich stuetzt, damit die Auswahl
// nachvollziehbar bleibt und die Oberflaeche nichts nachrechnen muss.
function gruendeSammeln(m, belege, kandidat) {
  const b = beitraege(m);
  // Gemessen wird am erklaerbaren Teil des Scores. Die Anbieter-Verknuepfung
  // gehoert nicht dazu: sie hebt den Rang, laesst sich dem Nutzer aber nicht
  // als Grund sagen. Zaehlte sie mit, faenden Titel, die vor allem ueber die
  // Anbieterliste hereinkommen, gar keine Erklaerung mehr - obwohl ihre
  // uebrigen Signale echt sind.
  const erklaerbar = Object.entries(b).filter(([name]) => name !== "anbieter").map(([, wert]) => wert);
  const gesamt = erklaerbar.reduce((summe, wert) => summe + Math.max(0, wert), 0);
  const groesster = Math.max(...erklaerbar, 0);
  const zaehlt = (wert) => wert > 0 && (wert >= gesamt * GRUND_RELEVANZ || wert >= groesster);
  const gefunden = [];
  const nimm = (grund, wert, spezifitaet, vertrauen, extra = {}) => {
    if (!zaehlt(wert)) return;
    gefunden.push({
      grund,
      titel: "",
      genre: "",
      tag: "",
      art: "",
      sitzung: false,
      beitrag: wert,
      anteil: gesamt > 0 ? wert / gesamt : 0,
      spezifitaet,
      vertrauen,
      ...extra
    });
  };

  // 1. Reihen. Der naechste ungesehene Teil ist das staerkste Signal, das es
  //    gibt; eine Reihe, die lange her ist, wird zur Wiederentdeckung.
  nimm(GRUND.NAECHSTER_TEIL, b.naechsterTeil, 1, VERTRAUEN.paar, { titel: belege.reiheTitel });
  if (belege.reiheTage > WIEDER_TAGE) {
    nimm(GRUND.WIEDERENTDECKUNG, b.reihe, 0.9, VERTRAUEN.paar, { titel: belege.reiheTitel });
  } else {
    nimm(GRUND.REIHE, b.reihe, 0.95, VERTRAUEN.paar, { titel: belege.reiheTitel });
  }

  // 2. Ein einzelner Titel aus dem Verlauf - nur mit belegtem Bezug.
  if (belege.verlaufTitel) {
    nimm(GRUND.AEHNLICH_ZULETZT, b.verlauf, 0.9, VERTRAUEN.paar, { titel: belege.verlaufTitel });
  }

  // 3. Watchlist - einmal mit tragendem Einzeltitel, einmal ohne.
  if (belege.watchlistTitel) {
    nimm(GRUND.WATCHLIST, b.watchlist, 0.8, VERTRAUEN.paar, { titel: belege.watchlistTitel });
  } else {
    nimm(GRUND.WATCHLIST, b.watchlist, 0.45, VERTRAUEN.profil);
  }

  // 4. Die Anbieter-Verknuepfung ("Das schauen andere") bleibt ein reines
  //    internes Signal: sie bringt Kandidaten herein und hebt sie ein wenig,
  //    taugt aber nicht als Erklaerung. Belegt ist damit nur, dass der
  //    Anbieter zwei Seiten verlinkt - bei Filmo haengt derselbe Block unter
  //    praktisch jedem Titel. Wer daraus "vorgeschlagen bei X" macht, nennt
  //    dem Nutzer Werbung als Grund.

  // 5. Ein spezifischer Tag schlaegt das breite Genre - er sagt mehr aus und
  //    stuetzt sich auf dieselbe Rechnung.
  const profilBeitrag = Math.max(b.genre, b.sitzung);
  if (belege.tag) {
    nimm(GRUND.TAG, profilBeitrag, 0.7, VERTRAUEN.tag, { tag: belege.tag, sitzung: belege.genreSitzung });
  }
  // Genre und Art zusammen ("Action-Anime") - nur wenn beides fuer sich schon
  // belegt ist.
  if (belege.genre && belege.art) {
    nimm(GRUND.TAG_PAAR, profilBeitrag, 0.65, VERTRAUEN.tag, {
      genre: belege.genre, art: belege.art, sitzung: belege.genreSitzung
    });
  }
  if (belege.genre) {
    nimm(GRUND.GENRE, profilBeitrag, 0.5, VERTRAUEN.profil, {
      genre: belege.genre, sitzung: belege.genreSitzung
    });
  }

  // 6. Der Geschmack ohne Namen. Kurzfristig und langfristig bleiben getrennt:
  //    "gerade" und "immer wieder" sind zwei verschiedene Aussagen.
  //
  //    Was nur von vorgemerkten Titeln kommt, zaehlt hier nicht mit: "passend
  //    zu deinem bisherigen Geschmack" redet vom Schauen, nicht vom Merken.
  //
  //    Und nur, wenn es nichts Genaueres gibt: ein Satz ueber "deinen
  //    bisherigen Geschmack" ist der schwaechste, den ELFIX kennt. Solange
  //    ein Tag oder ein Genre benannt werden kann, hat der Vorrang - sonst
  //    stuende auf jeder zweiten Karte dieselbe Leerformel.
  const geschaut = belege.verlaufGeschaut ? b.verlauf : 0;
  const profilOhneNamen = Math.max(geschaut, b.genre);
  const hatNamen = Boolean(belege.tag || belege.genre);
  if (!hatNamen) {
    if (b.sitzung >= geschaut && b.sitzung >= b.genre) {
      nimm(GRUND.SITZUNG, b.sitzung, 0.35, VERTRAUEN.profil, { sitzung: true });
    }
    nimm(GRUND.VERLAUF, profilOhneNamen, 0.3, VERTRAUEN.profil);
  }

  // 7. Anime, Serie oder Film sagt nur, WAS der Titel ist - nicht, warum er
  //    empfohlen wird. Als Grund taugt das nicht; die Welt trennt stattdessen
  //    die Kandidatenpools und die Vielfalt (siehe vielfalt()).

  // 8. Der Titel stammt aus der Neuheiten-Reihe des Anbieters. Das ist eine
  //    Aussage ueber den Anbieter, keine ueber den Nutzer.
  if (kandidat.via === "new") nimm(GRUND.NEUHEIT, b.neuheit, 0.4, VERTRAUEN.rest);

  gefunden.sort((links, rechts) => klasseVon(links) - klasseVon(rechts) || gueteVon(rechts) - gueteVon(links));
  // Ohne jeden belegten Grund bleibt die Erkundung - sie behauptet nichts.
  if (!gefunden.length) {
    gefunden.push({
      grund: GRUND.ERKUNDUNG,
      titel: "", genre: "", tag: "", art: "", sitzung: false,
      beitrag: b.neuheit,
      anteil: gesamt > 0 ? b.neuheit / gesamt : 0,
      spezifitaet: 0.1,
      vertrauen: VERTRAUEN.rest
    });
  }
  return gefunden;
}

// Aus den Teilwerten die Gesamtpunktzahl.
function punkte(m) {
  let summe = 0;
  summe += G.naechsterTeil * m.naechsterTeil;
  summe += G.reihe * m.reihe;
  summe += G.aehnlichLautAnbieter * m.aehnlichLautAnbieter;
  summe += G.sitzung * m.sitzung;
  summe += G.verlauf * m.verlauf;
  summe += G.genre * m.genre;
  summe += G.watchlist * m.watchlist;
  summe += G.titel * m.titel;
  summe += G.neuheit * m.neuheit;
  summe -= m.abneigung;
  summe -= m.muede;
  return summe;
}

// Wie sicher ist diese Empfehlung? Etwas anderes als die Punktzahl: ein Titel
// kann aus wenigen Daten viele Punkte holen. Die Konfidenz sagt, auf wie
// vielen unabhaengigen Signalen das Ergebnis steht.
function konfidenz(m) {
  if (m.naechsterTeil >= 0.6) return "VERY_HIGH";
  const signale = [m.reihe, m.aehnlichLautAnbieter, m.sitzung, m.verlauf, m.genre, m.watchlist]
    .filter((wert) => wert > 0.2).length;
  if (signale >= 3) return "HIGH";
  if (signale === 2) return "MEDIUM";
  return "LOW";
}

// Ein stabiler Wert je Titel zwischen 0 und 1 - fuer Erkundung und um
// gleichauf liegende Kandidaten immer gleich zu sortieren. Kein Zufall: bei
// gleichem Profil soll dieselbe Reihenfolge herauskommen.
function streuwert(text) {
  let hash = 2166136261;
  const wert = String(text || "");
  for (let index = 0; index < wert.length; index += 1) {
    hash ^= wert.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

// --- Die Kette ----------------------------------------------------------------

// Dubletten zusammenfuehren. Derselbe Film bei drei Anbietern ist eine
// Empfehlung, nicht drei - und "Ger Dub" neben "Ger Sub" schon gar nicht.
// Behalten wird der Kandidat mit dem staerksten Herkunftssignal; die anderen
// Anbieter haengen als Alternativen daran.
// Anime, Serie, Film: drei Welten mit eigenem Publikum. Sie werden getrennt
// gehalten, damit die eine nicht die andere verdraengt - nur eine belegte
// Reihe darf ueber die Grenze hinweg empfehlen.
function welt(kandidat) {
  const art = String(kandidat?.art || "").toLowerCase();
  if (art === "anime" || art === "serie" || art === "film") return art;
  return String(kandidat?.type || "").toLowerCase() === "film" ? "film" : "serie";
}

function zusammenfuehren(kandidaten) {
  const nach = new Map();
  for (const kandidat of kandidaten || []) {
    if (!kandidat?.url || !kandidat?.title) continue;
    const zerlegt = titel.zerlegen(kandidat.baseTitle || kandidat.title);
    if (!zerlegt.klar) continue;
    const typ = kandidat.type || "";
    const werkKey = titel.werkSchluessel(zerlegt, typ);

    const vorhanden = nach.get(werkKey);
    if (!vorhanden) {
      nach.set(werkKey, {
        ...kandidat,
        zerlegt,
        werkKey,
        type: typ,
        welt: welt(kandidat),
        genres: inhaltsTags(kandidat.genres),
        // Auf wessen Seiten dieses Werk als verwandt gefuehrt wird. Ein Titel,
        // der bei jedem zweiten Seed auftaucht, ist Bewerbung und keine
        // Beziehung - das laesst sich nur an der Menge erkennen.
        seeds: new Set(kandidat.via === "related" && kandidat.seedTitle ? [kandidat.seedTitle] : []),
        alternativen: []
      });
      continue;
    }
    if (kandidat.via === "related" && kandidat.seedTitle) vorhanden.seeds.add(kandidat.seedTitle);
    // Genres der Fassungen zusammenlegen - ein Anbieter kennt oft mehr als
    // der andere.
    for (const g of kandidat.genres || []) {
      if (g && !vorhanden.genres.includes(g)) vorhanden.genres.push(g);
    }
    vorhanden.alternativen.push({
      url: kandidat.url,
      providerId: kandidat.providerId,
      providerName: kandidat.providerName
    });
    // "related" ist das beste Herkunftssignal - wenn eine Fassung so
    // hereinkam, gilt das fuer das Werk.
    const besser = kandidat.via === "related" && vorhanden.via !== "related";
    const staerker = kandidat.via === vorhanden.via && zahl(kandidat.seedWeight) > zahl(vorhanden.seedWeight);
    if (besser || staerker) {
      vorhanden.via = kandidat.via;
      vorhanden.seedTitle = kandidat.seedTitle || vorhanden.seedTitle;
      vorhanden.seedWeight = kandidat.seedWeight;
    }
    if (!vorhanden.image && kandidat.image) vorhanden.image = kandidat.image;
  }
  return [...nach.values()];
}

// Nach dem Ranking noch einmal durchmischen, damit nicht eine einzige Reihe
// oder ein einziger Anbieter die Liste fuellt.
//
// Ausnahme sind die Fortsetzungen: der naechste Teil einer laufenden Reihe
// darf ganz vorn stehen und wird von der Vielfaltsregel nicht verdraengt.
// Wie stark wird eine Welt gebremst, die schon mehrfach in der Liste steht?
// Anime, Serien und Filme haben verschiedene Kataloggroessen - ohne Bremse
// fuellt die groesste Welt die ganze Reihe, und wer abends einen Film sucht,
// sieht zwanzig Animes.
const WELT_BREMSE = 0.12;
const WELT_MAX = 0.5;

function vielfalt(bewertet, limit) {
  const ergebnis = [];
  const reihenZaehler = new Map();
  const anbieterZaehler = new Map();
  const weltZaehler = new Map();
  const rest = [...bewertet];

  while (ergebnis.length < limit && rest.length) {
    let bester = -1;
    let besteWertung = -Infinity;
    for (let index = 0; index < rest.length; index += 1) {
      const kandidat = rest[index];
      const reihe = kandidat.reiheKey || "";
      const ausReihe = reihe ? reihenZaehler.get(reihe) || 0 : 0;
      const ausAnbieter = anbieterZaehler.get(kandidat.providerId) || 0;

      // Der naechste Teil einer Reihe ist von der Bremse ausgenommen - aber
      // nur der erste. Sonst belegt eine Reihe mit vier ungesehenen Teilen die
      // ganze Liste, und genau das soll die Vielfalt verhindern: nach dem
      // naechsten Teil kommt etwas anderes, der uebernaechste kann warten.
      const istFortsetzung = kandidat.gruende.includes(GRUND.NAECHSTER_TEIL);
      // Anteilig, nicht als fester Abzug: die Punktzahlen liegen je nach
      // Profil weit auseinander, und ein fester Betrag waere mal alles und
      // mal nichts. So verliert jeder weitere Titel derselben Reihe
      // verlaesslich knapp die Haelfte seines Gewichts.
      const reihenAbzug = istFortsetzung && ausReihe === 0 ? 0 : Math.min(0.85, ausReihe * 0.45);
      // Dieselbe Bremse fuer die Welt - aber deutlich sanfter als bei Reihen:
      // wer fast nur Anime schaut, soll auch ueberwiegend Anime bekommen, nur
      // eben nicht ausschliesslich. Belegte Fortsetzungen sind ausgenommen.
      const ausWelt = weltZaehler.get(kandidat.welt) || 0;
      const weltAbzug = istFortsetzung ? 0 : Math.min(WELT_MAX, ausWelt * WELT_BREMSE);
      const wertung = kandidat.score * (1 - reihenAbzug) * (1 - weltAbzug) - ausAnbieter * 0.06;
      if (wertung > besteWertung) { besteWertung = wertung; bester = index; }
    }
    if (bester < 0) break;
    const gewaehlt = rest.splice(bester, 1)[0];
    ergebnis.push(gewaehlt);
    if (gewaehlt.reiheKey) reihenZaehler.set(gewaehlt.reiheKey, (reihenZaehler.get(gewaehlt.reiheKey) || 0) + 1);
    anbieterZaehler.set(gewaehlt.providerId, (anbieterZaehler.get(gewaehlt.providerId) || 0) + 1);
    weltZaehler.set(gewaehlt.welt, (weltZaehler.get(gewaehlt.welt) || 0) + 1);
  }
  return ergebnis;
}

// Der ganze Durchlauf.
//
// `optionen`:
//   jetzt      - Zeitpunkt, fuer pruefbare Ergebnisse
//   limit      - wie viele am Ende
//   anzeigen   - Map werkKey -> wie oft schon gezeigt, ohne geoeffnet zu werden
//   ausschluss - Set von Werk-Schluesseln, die nie erscheinen duerfen
//   debug      - true: jeder Kandidat traegt seine Teilwerte mit sich
function empfehlen(kandidaten, profil, optionen = {}) {
  const limit = optionen.limit || 24;
  const ausschluss = optionen.ausschluss || new Set();
  const zusammen = zusammenfuehren(kandidaten);
  // Die Gewichte der Genres entstehen aus dem, was gerade zur Wahl steht:
  // je seltener ein Genre im Angebot, desto mehr sagt eine Uebereinstimmung.
  // Der Verlauf zaehlt mit, sonst faellt ein Tag durch, den nur der Nutzer
  // hat.
  const gewichte = optionen.gewichte || genreGewichte([
    ...zusammen.map((kandidat) => kandidat.genres),
    ...profil.eintraege.map((eintrag) => eintrag.genres)
  ]);
  // Wie viele verschiedene Seiten verlinken ueberhaupt etwas? Daran misst
  // sich, ob eine Verlinkung etwas bedeutet: Filmo haengt an jede Seite
  // denselben Werbeblock, und wer ueberall steht, sagt ueber keinen einzelnen
  // Titel etwas aus.
  const seedSeiten = new Set();
  for (const kandidat of zusammen) for (const seed of kandidat.seeds || []) seedSeiten.add(seed);
  const laufOptionen = { ...optionen, gewichte, seedSeiten: seedSeiten.size };
  const bewertet = [];

  for (const kandidat of zusammen) {
    if (ausschluss.has(kandidat.werkKey)) continue;
    const { m, gruende, reihe, belege } = merkmale(kandidat, profil, laufOptionen);

    // Schon gesehen kommt nicht in die normalen Empfehlungen. Der naechste
    // Teil einer Reihe ist davon nicht betroffen - der ist ja gerade nicht
    // gesehen.
    if (m.schonGesehen) continue;

    let score = punkte(m);
    // Leichte Angleichung an die Art, die gerade bevorzugt wird. Nie ein
    // Ausschluss - nur eine Nuance, damit Serienschauer nicht dauernd Filme
    // vorgeschlagen bekommen.
    if (kandidat.type) score *= 1 + (profil.typAnteil(kandidat.type) - 0.5) * 0.12;
    score += 0.04 * profil.anbieterAnteil(kandidat.providerId);
    // Mehrere unabhaengige Signale bestaetigen einander. Ein Titel, der nur
    // ueber ein einziges Merkmal hereinkommt - etwa "auch Action" -, soll
    // nicht so weit oben stehen wie einer, bei dem Reihe, Tags und Sitzung
    // zusammenkommen. Bewusst ein Zuschlag und kein Abzug: das verschiebt die
    // Rangfolge, ohne schwache Kandidaten ganz zu verdraengen.
    const signale = [m.naechsterTeil, m.reihe, m.aehnlichLautAnbieter, m.sitzung,
      m.verlauf, m.genre, m.watchlist].filter((wert) => wert > 0.2).length;
    score *= 1 + 0.12 * Math.min(2, Math.max(0, signale - 1));

    // Erkundung: ein kleiner, stabiler Anteil, damit auch Neues eine Chance
    // hat. Kein Zufall - derselbe Titel bekommt immer denselben Wert.
    const erkundung = streuwert(kandidat.werkKey);
    score += erkundung * 0.08;

    // Ohne Verlauf gibt es nichts zu passen - dann zaehlt, was ueberhaupt da
    // ist. Die Mindestpunktzahl wuerde hier nur dazu fuehren, dass ein neuer
    // Nutzer eine leere Startseite sieht.
    if (!profil.leer && score <= 0.05) continue;
    bewertet.push({
      title: kandidat.title,
      url: kandidat.url,
      image: kandidat.image || "",
      providerId: kandidat.providerId,
      providerName: kandidat.providerName,
      viaSearch: Boolean(kandidat.viaSearch),
      via: kandidat.via,
      type: kandidat.type,
      welt: kandidat.welt,
      werkKey: kandidat.werkKey,
      reiheKey: reihe ? reihe.reihe.key : titel.franchiseSchluessel(kandidat.zerlegt),
      seedTitle: kandidat.seedTitle || "",
      alternativen: kandidat.alternativen,
      score: Number(score.toFixed(4)),
      confidence: konfidenz(m),
      gruende,
      // Merkmale und Belege reisen bis zum Schluss mit: der Grund wird erst
      // bestimmt, wenn die Liste steht (siehe unten).
      merkmale: m,
      belege,
      teilwerte: optionen.debug ? m : undefined
    });
  }

  bewertet.sort((links, rechts) => (
    rechts.score - links.score || streuwert(links.werkKey) - streuwert(rechts.werkKey)
  ));
  // Erst die fertige Liste, dann die Erklaerung. Der Grund gehoert ans Ende der
  // Kette, nicht an den Anfang: erklaert werden soll, warum ein Titel hier
  // steht - und das steht vorher nicht fest.
  return abwechslung(vielfalt(bewertet, limit).map(erklaerungAnhaengen));
}

// Aus Merkmalen und Belegen werden die Gruende. Der beste wird der sichtbare,
// die uebrigen bleiben als `nebengruende` haengen - sie sind genauso wahr und
// dienen weiter unten der Abwechslung.
// Ein Grund, wie ihn die Oberflaeche und begruendung.js sehen: mit den
// Feldern, aus denen der Satz gebaut wird.
function alsFelder(grund) {
  return {
    grund: grund.grund,
    grundTitel: grund.titel || "",
    grundGenre: grund.genre || "",
    grundTag: grund.tag || "",
    grundArt: grund.art || "",
    grundSitzung: Boolean(grund.sitzung)
  };
}

// Zu manchen Gruenden gibt es keinen lesbaren Satz - etwa zu einem Tag, fuer
// den kein Name hinterlegt ist. Ein Grund ohne Satz ist kein Grund; dann
// zaehlt der naechste.
function sagbar(grund) {
  return begruendung.textVarianten(alsFelder(grund)).length > 0;
}

const ERKUNDUNG_GRUND = {
  grund: GRUND.ERKUNDUNG,
  titel: "", genre: "", tag: "", art: "", sitzung: false,
  beitrag: 0, anteil: 0, spezifitaet: 0.1, vertrauen: VERTRAUEN.rest
};

function erklaerungAnhaengen(eintrag) {
  const { merkmale: m, belege, ...rest } = eintrag;
  const gruende = gruendeSammeln(m, belege, eintrag).filter(sagbar);
  if (!gruende.length) gruende.push(ERKUNDUNG_GRUND);
  const [bester, ...weitere] = gruende;
  const ergebnis = {
    ...rest,
    grund: bester.grund,
    // Leer heisst leer: dann formuliert der Satz allgemeiner, statt sich etwas
    // auszudenken.
    grundTitel: bester.titel,
    grundGenre: bester.genre,
    grundTag: bester.tag,
    grundArt: bester.art,
    grundSitzung: bester.sitzung,
    // Wie viel des positiven Gesamtbeitrags erklaert dieser Grund?
    grundKonfidenz: Number(bester.anteil.toFixed(3)),
    nebengruende: weitere.map((grund) => ({
      ...alsFelder(grund),
      anteil: Number(grund.anteil.toFixed(3))
    })),
    grundText: ""
  };
  ergebnis.grundText = begruendung.empfehlungsGrundText(ergebnis);
  if (rest.teilwerte) {
    ergebnis.beitraege = beitraege(m);
    ergebnis.belege = belege;
    ergebnis.gueten = gruende.map((grund) => `${grund.grund} ${gueteVon(grund).toFixed(3)}`);
  }
  return ergebnis;
}

// Zehnmal derselbe Satz untereinander liest sich wie ein Fehler, auch wenn
// jeder einzelne stimmt. Deshalb bekommt jeder Vorschlag den besten Satz, der
// noch nicht zu oft dasteht - erst andere Formulierungen desselben Grundes,
// dann ein Nebengrund, der ebenso belegt ist. Erfunden wird dabei nichts: alle
// Saetze, die hier zur Wahl stehen, sind fuer diesen Titel wahr.
//
// Ein Nebengrund darf den Hauptgrund nur ersetzen, wenn er ihm nahekommt -
// eine schwache Aussage ist keine Abwechslung, sondern ein schlechterer Grund.
const NEBENGRUND_NAHE = 0.6;

function abwechslung(liste) {
  const benutzt = new Map();
  const zaehlen = (text) => benutzt.get(text) || 0;

  return liste.map((eintrag) => {
    const wahl = [];
    const hauptGuete = eintrag.grundKonfidenz;
    for (const text of begruendung.textVarianten(eintrag)) wahl.push({ text, grund: null });
    for (const neben of eintrag.nebengruende || []) {
      if (neben.anteil < hauptGuete * NEBENGRUND_NAHE) continue;
      for (const text of begruendung.textVarianten(neben)) wahl.push({ text, grund: neben });
    }
    // Der erste Satz, der noch gar nicht dasteht; sonst der am seltensten
    // benutzte. Bei Gleichstand bleibt es bei der Reihenfolge oben, also beim
    // besten Grund und seiner ersten Formulierung.
    let beste = wahl[0];
    for (const eintragWahl of wahl) {
      if (zaehlen(eintragWahl.text) < zaehlen(beste.text)) beste = eintragWahl;
      if (zaehlen(beste.text) === 0) break;
    }
    if (!beste) return eintrag;
    benutzt.set(beste.text, zaehlen(beste.text) + 1);
    if (!beste.grund) return { ...eintrag, grundText: beste.text };
    // Ein Nebengrund hat gewonnen - dann wird auch er als Grund ausgewiesen,
    // damit Text und gemeldeter Grund nicht auseinandergehen.
    return {
      ...eintrag,
      ...beste.grund,
      grundKonfidenz: beste.grund.anteil,
      grundText: beste.text
    };
  });
}

// Der Debug-Bericht zu einem Kandidaten - fuer die Konsole, nicht fuer die
// Oberflaeche.
//
// Er zeigt beides: die Beitraege, aus denen die Punktzahl entsteht, und den
// staerksten Seed samt seinem Anteil - auch dann, wenn er die Huerden nicht
// genommen hat. Genau daran laesst sich ablesen, warum ein Titel *nicht* mit
// einem konkreten Bezug erklaert wurde.
function debugBericht(eintrag) {
  if (!eintrag?.teilwerte) return `${eintrag?.title || "?"}: keine Teilwerte (Debug aus)`;
  const b = eintrag.beitraege || beitraege(eintrag.teilwerte);
  const belege = eintrag.belege || {};
  const zeilen = Object.entries(b)
    .filter(([, wert]) => Math.abs(wert) > 0.0001)
    .sort((links, rechts) => Math.abs(rechts[1]) - Math.abs(links[1]))
    .map(([name, wert]) => `  ${name.padEnd(22)} ${wert >= 0 ? "+" : ""}${wert.toFixed(3)}`);
  const abzuege = ["abneigung", "muede"]
    .filter((name) => Math.abs(eintrag.teilwerte[name]) > 0.0001)
    .map((name) => `  ${name.padEnd(22)} -${eintrag.teilwerte[name].toFixed(3)}`);

  const seed = belege.verlaufBester
    ? `  ${belege.verlaufBester}\n`
      + `  Deckung ${(belege.verlaufDeckung || 0).toFixed(2)}`
      + `   gemeinsame Genres ${belege.verlaufGemeinsam || 0}`
      + `   Anteil am Verlauf ${(100 * (belege.verlaufAnteil || 0)).toFixed(0)}%`
      + `   Vorsprung ${Number.isFinite(belege.verlaufVorsprung) ? `${belege.verlaufVorsprung.toFixed(2)}x` : "allein"}`
      + `   ${belege.verlaufTitel ? "-> darf genannt werden" : "-> zu schwach, nicht genannt"}`
    : "  (keiner)";
  const watchlist = belege.watchlistBester
    ? `  ${belege.watchlistBester}   Anteil ${(100 * (belege.watchlistAnteil || 0)).toFixed(0)}%`
      + `   ${belege.watchlistTitel ? "-> darf genannt werden" : "-> zu schwach, nicht genannt"}`
    : "  (keiner)";
  const genre = belege.genreBestes
    ? `  ${belege.genreBestes}   aus ${belege.genreWerke || 0} Werken`
      + `   ${belege.genreSitzung ? "(Sitzung)" : "(Profil)"}`
      + `   ${belege.genre ? "-> darf genannt werden" : "-> zu schwach, nicht genannt"}`
    : "  (keines)";
  const tag = belege.tag
    ? `  ${belege.tag}   aus ${belege.tagWerke} Werken   -> darf genannt werden`
    : "  (keiner stark genug)";
  const art = belege.artAnteil
    ? `  Anteil am Verlauf ${(100 * belege.artAnteil).toFixed(0)}%`
      + `   ${belege.art ? "-> darf genannt werden" : "-> zu schwach, nicht genannt"}`
    : "  (unbekannt)";
  const neben = (eintrag.nebengruende || []).length
    ? eintrag.nebengruende.map((g) => `  ${g.grund}${g.grundTitel ? ` <- ${g.grundTitel}` : ""}`
      + `${g.grundTag ? ` <- ${g.grundTag}` : ""}${g.grundGenre ? ` <- ${g.grundGenre}` : ""}`
      + `   ${(100 * g.anteil).toFixed(0)}%`).join(String.fromCharCode(10))
    : "  (keine)";

  // Warum nicht genauer? Das ist die Frage, die man beim Lesen einer
  // Begruendung wirklich hat - also steht die Antwort im Bericht.
  const warumNichtGenauer = eintrag.grundTitel ? ""
    : belege.verlaufBester
      ? `bester Seed "${belege.verlaufBester}": ${belege.verlaufGemeinsam} gemeinsame Genres,`
        + ` Deckung ${(belege.verlaufDeckung || 0).toFixed(2)},`
        + ` Anteil ${(100 * (belege.verlaufAnteil || 0)).toFixed(0)}% - zu wenig fuer einen Titelbezug`
      : "kein einzelner Verlaufstitel passt";

  return [
    `Titel: ${eintrag.title}`,
    `Welt:  ${eintrag.welt || "?"}`,
    "",
    `Final Score: ${eintrag.score.toFixed(3)}`,
    `Confidence:  ${eintrag.confidence}`,
    "",
    ...zeilen,
    ...abzuege,
    "",
    "Staerkster Seed:",
    seed,
    "Watchlist:",
    watchlist,
    "Genre:",
    genre,
    "Spezifischer Tag:",
    tag,
    "Anime/Serie/Film:",
    art,
    "",
    `Anbieter-Verknuepfung: ${belege.anbieterTitel || "(keine)"}`,
    `Reihe: ${belege.reiheTitel || "(keine)"}`
      + (belege.reiheKonfidenz ? `   Konfidenz ${belege.reiheKonfidenz.toFixed(2)}` : ""),
    "",
    `Selected Reason: ${eintrag.grund}`
      + `${eintrag.grundTitel ? ` <- ${eintrag.grundTitel}` : ""}`
      + `${eintrag.grundGenre ? ` <- ${eintrag.grundGenre}` : ""}`
      + `   (erklaert ${(100 * eintrag.grundKonfidenz).toFixed(0)}% des positiven Scores)`,
    `Visible Reason:  „${eintrag.grundText}“`,
    "",
    "Secondary Reasons:",
    neben,
    ...(warumNichtGenauer ? ["", `Warum nicht genauer: ${warumNichtGenauer}`] : []),
    ...(eintrag.gueten ? ["", `Guete je Grund: ${eintrag.gueten.join("  |  ")}`] : [])
  ].join("\n");
}

module.exports = {
  profilBauen,
  signalStaerke,
  istAbgebrochen,
  genreAehnlichkeit,
  genreGewichte,
  naechsterTeilInReihe,
  merkmale,
  punkte,
  konfidenz,
  beitraege,
  gruendeSammeln,
  istSpezifisch,
  zusammenfuehren,
  vielfalt,
  empfehlen,
  debugBericht,
  streuwert,
  GRUND,
  GEWICHTE: G
};
