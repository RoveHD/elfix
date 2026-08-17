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
  const abneigung = new Map();
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
      genres: (roh.genres || []).map((g) => (typeof g === "string" ? g : g?.key)).filter(Boolean),
      typ: String(roh.type || "").toLowerCase(),
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
      staerke: e.staerke
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
    genreWert: (key) => lang.get(key) || 0,
    sitzungWert: (key) => kurz.get(key) || 0,
    hatSitzung: kurzGesamt > 0,
    leer: lang.size === 0 && reihen.size === 0,
    umfang: eintraege.length
  };
}

// --- Aehnlichkeit von Genre-Mengen -------------------------------------------

// Zwei Genre-Mengen vergleichen. Gewichtet nach Jaccard: gemeinsame Genres
// gegen alle beteiligten. Damit ist "Action+SciFi+Thriller" gegen
// "Action+SciFi" deutlich aehnlicher als gegen "Action+Comedy+Family".
function genreAehnlichkeit(links, rechts) {
  const a = new Set((links || []).filter(Boolean));
  const b = new Set((rechts || []).filter(Boolean));
  if (!a.size || !b.size) return 0;
  let schnitt = 0;
  for (const key of a) if (b.has(key)) schnitt += 1;
  return schnitt / (a.size + b.size - schnitt);
}

// Wie gut passen die Genres eines Kandidaten zum Profil? Das staerkste Genre
// zaehlt voll, weitere nur anteilig - sonst gewinnen Titel, die in sehr vielen
// Genres stehen.
function profilPassung(keys, werte) {
  const treffer = [...new Set(keys || [])]
    .map((key) => ({ key, wert: werte(key) }))
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
function naechsterTeilInReihe(kandidat, profil) {
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
  if (beste < 0.7 || !bezug || !reihe) return null;

  // Schon gesehen? Dann ist es kein naechster Teil.
  const eigen = titel.schluessel(kandidat.zerlegt.klar);
  if (reihe.teile.some((teil) => titel.schluessel(teil.zerlegt.klar) === eigen)) {
    return { konfidenz: beste, reihe, naechster: false, bezug };
  }

  // Der hoechste Teil, den der Nutzer wirklich fertig hat.
  const fertigeTeile = reihe.teile.filter((teil) => teil.fertig).map((teil) => teil.teil || 1);
  const hoechsterFertig = fertigeTeile.length ? Math.max(...fertigeTeile) : 0;
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
    abstand: Math.max(0, abstand),
    naehe: 1 / (1 + Math.max(0, abstand - 1) * 0.8)
  };
}

// --- Merkmale eines Kandidaten ------------------------------------------------

const GRUND = {
  NAECHSTER_TEIL: "NEXT_IN_FRANCHISE",
  REIHE: "SAME_FRANCHISE",
  AEHNLICH_ZULETZT: "SIMILAR_TO_RECENT",
  ANBIETER_AEHNLICH: "RELATED_BY_PROVIDER",
  GENRE: "BASED_ON_GENRE",
  WATCHLIST: "BASED_ON_WATCHLIST",
  VERLAUF: "BASED_ON_HISTORY",
  ERKUNDUNG: "EXPLORATION"
};

// Alle Teilwerte eines Kandidaten. Bewusst getrennt gehalten: so laesst sich
// im Debug-Modus ablesen, woher die Punkte kommen, und einzelne Signale lassen
// sich abschalten, ohne den Rest anzufassen.
function merkmale(kandidat, profil, optionen = {}) {
  const jetzt = optionen.jetzt || Date.now();
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

  // 1. Reihe und naechster Teil.
  const reihe = naechsterTeilInReihe(kandidat, profil);
  if (reihe) {
    if (reihe.naechster) {
      // Nur dieser eine Wert. Die Zugehoerigkeit zur Reihe steckt bereits
      // darin - beides zu addieren hiesse, dasselbe zweimal zu zaehlen, und
      // dann liegt eine Reihe mit vier ungesehenen Teilen so weit vorn, dass
      // sie durch keine Vielfaltsregel mehr einzuholen ist. `naehe` sorgt
      // dafuer, dass der uebernaechste Teil deutlich abfaellt.
      m.naechsterTeil = reihe.konfidenz * reihe.naehe;
      gruende.push(GRUND.NAECHSTER_TEIL);
    } else if (!reihe.zurueck) {
      // Dieselbe Reihe, aber die Reihenfolge ist nicht belegbar - etwa ein
      // Ableger ohne Nummer. Zaehlt als starke Aehnlichkeit, nicht als
      // Fortsetzung.
      m.reihe = reihe.konfidenz * 0.7;
      gruende.push(GRUND.REIHE);
    }
    // Laeuft die Reihe gerade in dieser Sitzung, wiegt das zusaetzlich.
    if (reihe.reihe.kurz) m.sitzung = Math.max(m.sitzung, 0.9);
  }

  // 2. Was der Anbieter selbst als aehnlich ausweist. Das beste externe
  //    Signal, das es gibt - aber es gibt es nicht ueberall.
  if (kandidat.via === "related") {
    m.aehnlichLautAnbieter = Math.min(1, zahl(kandidat.seedWeight) || 0.5);
    gruende.push(GRUND.ANBIETER_AEHNLICH);
  }

  // 3. Genres gegen das langfristige Profil und gegen die Sitzung.
  const lang = profilPassung(kandidat.genres, (key) => profil.genreWert(key));
  const kurz = profilPassung(kandidat.genres, (key) => profil.sitzungWert(key));
  m.genre = lang.wert;
  if (kurz.wert > 0) m.sitzung = Math.max(m.sitzung, kurz.wert);

  // 4. Aehnlichkeit zu einzelnen Titeln des Verlaufs - ueber Genre-Mengen,
  //    gewichtet mit Signalstaerke und Aktualitaet. Das ist etwas anderes als
  //    das Profil oben: hier zaehlt die Uebereinstimmung mit einem konkreten
  //    Titel, nicht mit dem Durchschnitt.
  let besteVerlauf = 0;
  let bestesVorbild = null;
  let watchlistSumme = 0;
  for (const e of profil.eintraege) {
    if (e.abgebrochen) continue;
    const g = genreAehnlichkeit(kandidat.genres, e.genres);
    if (g <= 0) continue;
    // Mehrere aehnliche Titel auf der Watchlist verstaerken einander - ein
    // einzelner vorgemerkter Film sagt wenig, drei in dieselbe Richtung viel.
    if (e.roh.favorite) watchlistSumme += g * 0.5;
    const wert = g * e.staerke * e.frische;
    if (wert > besteVerlauf) { besteVerlauf = wert; bestesVorbild = e; }
  }
  const watchlistWert = Math.min(1, watchlistSumme);
  m.verlauf = Math.min(1, besteVerlauf);
  m.watchlist = Math.min(1, watchlistWert);
  if (m.verlauf > 0.25 && bestesVorbild) {
    gruende.push(bestesVorbild.frische > 0.7 ? GRUND.AEHNLICH_ZULETZT : GRUND.VERLAUF);
  }
  if (m.watchlist > 0.3) gruende.push(GRUND.WATCHLIST);
  if (!gruende.length && m.genre > 0) gruende.push(GRUND.GENRE);

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

  return { m, gruende, reihe };
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
        genres: [...new Set((kandidat.genres || []).filter(Boolean))],
        alternativen: []
      });
      continue;
    }
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
function vielfalt(bewertet, limit) {
  const ergebnis = [];
  const reihenZaehler = new Map();
  const anbieterZaehler = new Map();
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
      const wertung = kandidat.score * (1 - reihenAbzug) - ausAnbieter * 0.06;
      if (wertung > besteWertung) { besteWertung = wertung; bester = index; }
    }
    if (bester < 0) break;
    const gewaehlt = rest.splice(bester, 1)[0];
    ergebnis.push(gewaehlt);
    if (gewaehlt.reiheKey) reihenZaehler.set(gewaehlt.reiheKey, (reihenZaehler.get(gewaehlt.reiheKey) || 0) + 1);
    anbieterZaehler.set(gewaehlt.providerId, (anbieterZaehler.get(gewaehlt.providerId) || 0) + 1);
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
  const bewertet = [];

  for (const kandidat of zusammen) {
    if (ausschluss.has(kandidat.werkKey)) continue;
    const { m, gruende, reihe } = merkmale(kandidat, profil, optionen);

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
      werkKey: kandidat.werkKey,
      reiheKey: reihe ? reihe.reihe.key : titel.franchiseSchluessel(kandidat.zerlegt),
      seedTitle: kandidat.seedTitle || "",
      alternativen: kandidat.alternativen,
      score: Number(score.toFixed(4)),
      confidence: konfidenz(m),
      gruende,
      grund: gruende[0] || GRUND.ERKUNDUNG,
      teilwerte: optionen.debug ? m : undefined
    });
  }

  bewertet.sort((links, rechts) => (
    rechts.score - links.score || streuwert(links.werkKey) - streuwert(rechts.werkKey)
  ));
  return vielfalt(bewertet, limit);
}

// Der Debug-Bericht zu einem Kandidaten - fuer die Konsole, nicht fuer die
// Oberflaeche.
function debugBericht(eintrag) {
  if (!eintrag?.teilwerte) return `${eintrag?.title || "?"}: keine Teilwerte (Debug aus)`;
  const zeilen = Object.entries(eintrag.teilwerte)
    .filter(([, wert]) => Math.abs(wert) > 0.0001)
    .sort((links, rechts) => Math.abs(rechts[1]) - Math.abs(links[1]))
    .map(([name, wert]) => {
      const gewicht = G[name];
      const beitrag = gewicht === undefined ? -wert : gewicht * wert;
      return `  ${name.padEnd(22)} ${beitrag >= 0 ? "+" : ""}${beitrag.toFixed(3)}`;
    });
  return [
    eintrag.title,
    `Total: ${eintrag.score.toFixed(3)}   Confidence: ${eintrag.confidence}`,
    ...zeilen,
    `Reason: ${eintrag.grund}`
  ].join("\n");
}

module.exports = {
  profilBauen,
  signalStaerke,
  istAbgebrochen,
  genreAehnlichkeit,
  naechsterTeilInReihe,
  merkmale,
  punkte,
  konfidenz,
  zusammenfuehren,
  vielfalt,
  empfehlen,
  debugBericht,
  streuwert,
  GRUND,
  GEWICHTE: G
};
