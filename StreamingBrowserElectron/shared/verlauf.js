"use strict";

// Der persoenliche Verlauf eines Titels.
//
// --- Warum es diese Datei gibt -------------------------------------------------
//
// Was ELFIX unter `activity` ablegt, ist ein Ereignisprotokoll: jede Meldung
// des Players, jedes Neuladen, jede Watchparty-Synchronisierung hinterlaesst
// dort eine Zeile. Der Verlaufs-Kasten in der Mediathek hat dieses Protokoll
// frueher unveraendert angezeigt, und dann stand bei "BLACK TORCH" achtmal
// "Staffel 1 Folge 8" untereinander - dieselbe Folge, an einem Nachmittag,
// weil der Player sich achtmal gemeldet hat.
//
// Der Nutzer fragt aber nicht, wie oft sich der Player gemeldet hat. Er fragt,
// welche Folgen er gesehen hat. Das sind zwei verschiedene Dinge, und dieses
// Modul rechnet das eine in das andere um:
//
//   Ereignisse (viele je Folge)  ->  Folgeneintraege (genau einer je Folge)
//
// Zusammengefasst wird ueber `Nutzer + Titel + Staffel + Folge`. Der Nutzer
// ist implizit - es ist die eigene Ablage; der Titel kommt aus
// `serienSchluessel`, Staffel und Folge kommen ausschliesslich aus der Adresse
// des Ereignisses selbst. Nie aus dem Eintrag, nie vom Nachbarn: der Zeiger
// `favorite.season/episode` sagt, wo man *jetzt* steht, und nicht, was ein
// Ereignis von vorgestern betraf.
//
// --- Warum hier nichts geloescht wird ------------------------------------------
//
// Das Modul rechnet nur. Es bekommt die Eintraege gereicht und gibt ein
// Anzeigemodell zurueck; die Ablage bleibt unangetastet. Damit braucht es
// keine Migration, kein Backup und keinen zweiten Durchlauf, der schon
// bereinigte Daten noch einmal bereinigt - die Rohdaten bleiben, was sie sind,
// sie werden nur nicht mehr falsch gelesen.
//
// --- Was hier absichtlich fehlt ------------------------------------------------
//
// "X Mal abgeschlossen". Bei einer woechentlich erscheinenden Serie heisst das
// Erreichen der letzten *verfuegbaren* Folge nicht, dass die Serie durch ist -
// es heisst, dass man auf dem Stand ist. Wer Folge 6, dann Folge 7, dann Folge
// 8 sieht, hat drei Folgen beendet und nicht dreimal die Serie. Ein echter
// Wiederholungszaehler liesse sich aus diesen Daten nicht belegen, also gibt
// es keinen.

const NUR_GEOEFFNET = /ge(ö|oe)ffnet/i;
const GENERISCHER_ABSCHLUSS = /^(abgeschlossen|fertig|titel abgeschlossen)$/i;
const FOLGE_AUS_LABEL = /^(?:staffel\s*(\d+)\s*)?folge\s*(\d+)$/i;

/** Die vier Zustaende, die ein Titel haben kann. */
const STATUS = {
  AKTUELL: "AUF_AKTUELLEM_STAND",
  STAFFEL: "STAFFEL_ABGESCHLOSSEN",
  SERIE: "SERIE_ABGESCHLOSSEN",
  UNBEKANNT: "STATUS_UNBEKANNT"
};

// Laeuft noch / ist zu Ende - in den Worten beider Quellen. AniList schreibt
// Grossbuchstaben, TMDB ganze Woerter; beide stehen hier nebeneinander, damit
// der Rest des Moduls die Herkunft nicht kennen muss.
const LAEUFT = new Set(["RELEASING", "NOT_YET_RELEASED", "HIATUS",
  "RETURNING SERIES", "IN PRODUCTION", "PLANNED"]);
const BEENDET = new Set(["FINISHED", "CANCELLED", "ENDED", "CANCELED"]);

/**
 * Eine positive ganze Zahl oder null.
 *
 * <p><b>Warum der Name so sperrig ist.</b> Die Oberflaeche laedt die Dateien
 * aus {@code shared/} als gewoehnliche Skripte, und die teilen sich <em>einen</em>
 * globalen Namensraum - anders als im Hauptprozess, wo jede Datei ihr eigenes
 * Modul ist. Hier hiess die Funktion {@code zahl}, in
 * {@code shared/bildausschnitt.js} heisst sie ebenso, und die beiden bedeuten
 * nicht dasselbe: dort ist es {@code zahl(wert, ersatz)} ohne Vorzeichenregel,
 * hier {@code zahl(wert)} mit Abrunden und Null als Rueckfall.
 *
 * <p>Die Kollision war nicht theoretisch. Am {@code const schnittstelle} am
 * Ende der Datei brach das Laden mit "Identifier 'schnittstelle' has already
 * been declared" ab - die ganze Datei wurde nie ausgefuehrt, {@code
 * globalThis.ELFIX_VERLAUF} blieb undefiniert, und in der Mediathek fehlte
 * daraufhin bei <em>jedem</em> Titel der Menuepunkt "Verlauf ansehen". In den
 * Pruefungen faellt das nicht auf: die laden dieselbe Datei als CommonJS, und
 * dort hat sie ihren eigenen Namensraum.
 *
 * <p>Deshalb tragen die Namen auf oberster Ebene den Modulnamen. Dass keine
 * zwei geteilten Module denselben vergeben, prueft {@code mediathektest.js}.
 */
function verlaufZahl(wert) {
  const n = Number(wert);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function zeitpunkt(wert) {
  const zeit = Date.parse(String(wert || ""));
  return Number.isFinite(zeit) ? zeit : 0;
}

/*
 * Staffel und Folge aus einer Adresse.
 *
 * Dieselbe Regel wie `episodeIdentity` in src/fortschritt.js - dort ist sie
 * Teil des Fortschritts und haengt an dessen Nachbarn. Hier steht sie noch
 * einmal, weil dieses Modul auch als gewoehnliches Skript in der Oberflaeche
 * laeuft, wo es kein `require` gibt. Dass beide dasselbe sagen, prueft
 * tests/verlauftest.js an echten Adressen nach - auseinanderlaufen koennen sie
 * damit nicht unbemerkt.
 */
function folgenkennung(wert) {
  try {
    const adresse = new URL(String(wert || ""));
    const teile = adresse.pathname.split("/").filter(Boolean);
    if (!teile.length) return null;

    const marken = ["stream", "serie", "film", "filme", "movie", "movies", "title"];
    let werk = "";
    for (let i = 0; i < teile.length - 1; i += 1) {
      if (marken.includes(teile[i].toLowerCase())) {
        werk = teile[i + 1].toLowerCase();
        break;
      }
    }
    if (!werk) return null;

    let staffel = 0;
    let folge = 0;
    for (const teil of teile) {
      const s = teil.match(/^(?:staffel|season)-(\d+)$/i);
      if (s) staffel = Number(s[1]);
      const f = teil.match(/^(?:episode|folge)-(\d+)$/i);
      if (f) folge = Number(f[1]);
    }
    if (!Number.isFinite(folge) || folge <= 0) return null;
    return { schluessel: `${adresse.hostname.replace(/^www\./i, "")}:${werk}`, staffel, folge };
  } catch {
    return null;
  }
}

/*
 * Der stabile Schluessel eines Titels.
 *
 * Er muss ueber alle Folgen hinweg derselbe bleiben und darf zwei verschiedene
 * Serien nie zusammenwerfen. Deshalb zuerst die Adresse ohne Staffel- und
 * Folgenteil - die traegt den Serien-Slug des Anbieters -, und erst wenn die
 * fehlt, der Titel ohne seine Folgenangabe.
 */
function serienSchluessel(favorite) {
  const ausAdresse = werkAusAdresse(favorite?.url);
  if (ausAdresse) return ausAdresse;
  const titel = String(favorite?.title || "")
    .replace(/\s*[·|-]?\s*staffel\s*\d+.*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return titel ? `titel:${titel}` : "";
}

function werkAusAdresse(wert) {
  try {
    const adresse = new URL(String(wert || ""));
    const pfad = adresse.pathname
      .replace(/\/(?:staffel|season)-\d+(?:\/(?:episode|folge)-\d+)?\/?$/i, "")
      .replace(/\/+$/, "");
    if (!pfad) return "";
    return `${adresse.hostname.replace(/^www\./i, "")}${pfad}`.toLowerCase();
  } catch {
    return "";
  }
}

/** Alle Eintraege, die zu diesem einen Titel gehoeren - der eigene und die je Raum. */
function gruppeFinden(favoriten, favorite) {
  const schluessel = serienSchluessel(favorite);
  const alle = Array.isArray(favoriten) ? favoriten : [];
  if (!schluessel) return favorite ? [favorite] : [];
  const treffer = alle.filter((anderer) => serienSchluessel(anderer) === schluessel);
  if (favorite && !treffer.includes(favorite)) treffer.push(favorite);
  return treffer;
}

/*
 * Ein Ereignis auf eine konkrete Folge festnageln - oder gar nicht.
 *
 * Die Adresse entscheidet. Sagt sie nichts, darf noch das Label sprechen, denn
 * es wurde seinerzeit aus genau dieser Adresse gebildet ("Staffel 1 Folge 8").
 * Danach ist Schluss: `eintrag.season/episode` sind beim Schreiben aus dem
 * Zeiger des Eintrags aufgefuellt worden, wenn die Adresse nichts hergab - und
 * dieser Zeiger gehoert womoeglich einer ganz anderen Folge.
 */
function folgeDesEreignisses(eintrag) {
  const ausAdresse = folgenkennung(eintrag?.url);
  if (ausAdresse) return { staffel: ausAdresse.staffel, folge: ausAdresse.folge };
  const treffer = String(eintrag?.label || "").trim().match(FOLGE_AUS_LABEL);
  if (!treffer) return null;
  const folge = verlaufZahl(treffer[2]);
  return folge ? { staffel: verlaufZahl(treffer[1]), folge } : null;
}

function istGenerischerAbschluss(label) {
  return GENERISCHER_ABSCHLUSS.test(String(label || "").trim());
}

function istNurGeoeffnet(label) {
  return NUR_GEOEFFNET.test(String(label || ""));
}

function folgenSchluessel(staffel, folge) {
  return `${verlaufZahl(staffel)}|${verlaufZahl(folge)}`;
}

// --- Das Sammeln --------------------------------------------------------------

/*
 * Aus einer Reihe von Eintraegen genau ein Datensatz je Staffel und Folge.
 *
 * Zusammengefasst wird nach den Regeln, die der Auftrag nennt: der neueste
 * gueltige Zeitpunkt gewinnt, der hoechste plausible Fortschritt gewinnt, und
 * ein einmal belegter Abschluss dieser konkreten Folge bleibt stehen. Alles
 * andere - Pause, Sprung, Neuladen, erneutes Oeffnen, Vollbild, Watchparty-
 * Abgleich, mehrfach gemeldeter Abschluss - schreibt nur in den vorhandenen
 * Datensatz hinein und legt keinen zweiten an.
 *
 * Die Abende werden dabei getrennt gezaehlt und nicht hinterher aus den
 * Folgeneintraegen abgelesen. Ein Eintrag behaelt nur seinen *neuesten*
 * Zeitpunkt - wer Folge 3 am Freitag anfaengt und am Sonntag zu Ende sieht,
 * haette den Freitag sonst verloren, obwohl er ein Abend war.
 */
function folgenSammeln(favoriten, grenze = {}) {
  const folgen = new Map();
  const tage = new Set();
  const tagMerken = (zeit) => {
    if (zeit) tage.add(new Date(zeit).toDateString());
  };

  /*
   * Eine Folge, die es in dieser Serie nicht gibt.
   *
   * Gemeldet und in der echten Ablage nachgelesen: bei "Die Legende von Korra"
   * stand im Verlauf "Zuletzt gesehen: Staffel 5 Folge 1 am 25.08.2026". Korra
   * hat vier Buecher. Das Ereignis steht dort woertlich:
   *
   *   {"at":"2026-08-24T22:31:18.219Z", ".../staffel-5/episode-1",
   *    "label":"Staffel 5 Folge 1","season":5,"episode":1}
   *
   * - dreihundert Millisekunden nach dem Abschluss von Staffel 4 Folge 13.
   * Das war der alte Staffeluebergang, der ueber das Ende der Serie hinaus
   * weiterzaehlte, statt sie abzuschliessen. Der Fehler ist behoben, seine
   * Hinterlassenschaft steht aber in jeder Ablage, die damals lief.
   *
   * Aufgeraeumt wird beim Lesen und nicht per Wanderung durch die Datei: der
   * Verlauf ist eine Ansicht auf Ereignisse, und ein Ereignis, das der Serie
   * widerspricht, gehoert nicht hinein. Das heilt jedes Geraet von selbst,
   * auch die, die ihre Ablage nur ueber den Abgleich bekommen.
   *
   * Widersprechen heisst: hinter dem, was der Anbieter ueberhaupt anbietet.
   * Die Folgenzahl gilt dabei nur fuer die letzte Staffel - fuer frueherere
   * nennt der Anbieter keine, und eine geratene Grenze wuerde echte Folgen
   * verschlucken. Ohne bekannte Grenze wird nichts weggelassen.
   */
  const grenzStaffel = verlaufZahl(grenze.letzteStaffel);
  const grenzFolge = verlaufZahl(grenze.letzteFolge);
  const unmoeglich = (staffel, folge) => {
    if (!grenzStaffel) return false;
    const s = verlaufZahl(staffel);
    const f = verlaufZahl(folge);
    if (s > grenzStaffel) return true;
    return Boolean(grenzFolge && s === grenzStaffel && f > grenzFolge);
  };

  const nimm = (staffel, folge) => {
    const schluessel = folgenSchluessel(staffel, folge);
    let satz = folgen.get(schluessel);
    if (!satz) {
      satz = {
        staffel: verlaufZahl(staffel),
        folge: verlaufZahl(folge),
        abgeschlossen: false,
        zuletzt: 0,
        position: 0,
        dauer: 0,
        raum: ""
      };
      folgen.set(schluessel, satz);
    }
    return satz;
  };

  for (const favorite of Array.isArray(favoriten) ? favoriten : []) {
    if (!favorite) continue;
    const raum = String(favorite.watchpartyRoom || "").trim();
    // Was dieser eine Eintrag persoenlich belegt. Der Zeiger des Eintrags
    // (Stelle, Laufzeit) wird weiter unten nur fuer eine Folge uebernommen,
    // die hier drinsteht - alles andere koennte aus der Runde stammen.
    const eigene = new Set();

    // 1. Abgeschlossene Folgen. Die genaueste Quelle: sie tragen Nummer und
    //    Zeitpunkt und entstehen nur aus eigener Wiedergabe.
    for (const folge of Array.isArray(favorite.completedEpisodes) ? favorite.completedEpisodes : []) {
      const nummer = verlaufZahl(folge?.episode);
      if (!nummer) continue;
      if (unmoeglich(folge?.season, nummer)) continue;
      const zeit = zeitpunkt(folge?.completedAt);
      const satz = nimm(folge?.season, nummer);
      satz.abgeschlossen = true;
      if (zeit > satz.zuletzt) satz.zuletzt = zeit;
      if (raum && !satz.raum) satz.raum = raum;
      tagMerken(zeit);
      eigene.add(folgenSchluessel(folge?.season, nummer));
    }

    // 2. Der Verlauf. Er nennt Folgen mit Zeitpunkt, sagt aber nichts ueber
    //    die Stelle - jedes Ereignis ist hier nur ein "war dran, und zwar
    //    dann".
    for (const eintrag of Array.isArray(favorite.activity) ? favorite.activity : []) {
      const zeit = zeitpunkt(eintrag?.at);
      if (!zeit) continue;
      // Eine offene Seite ist keine Wiedergabe. Genau daran lag es frueher,
      // dass ein dreimal geoeffneter Film als dreimal gesehen dastand.
      if (istNurGeoeffnet(eintrag?.label)) continue;

      // Der Tag zaehlt in jedem Fall - auch ohne Folgennummer.
      //
      // Ein Film hat keine Folgen; `folgeDesEreignisses` gibt fuer ihn immer
      // null zurueck. Stuende der Tag erst hinter dem `continue` darunter,
      // haette jeder Film "an 0 Tagen geschaut" - und weil der Menuepunkt
      // "Verlauf ansehen" an dieser Zahl haengt, verschwand er bei
      // neunundzwanzig von achtundvierzig Titeln der Mediathek. Gemessen an
      // der echten Ablage am 2026-08-28.
      //
      // Was 1.54.0 richtig entfernt hat, waren *Zeilen* und *Abschluesse* ohne
      // Zuordnung, nicht die Tage. Ein Tag, an dem etwas lief, ist belegt,
      // ganz gleich ob sich die Folge benennen laesst.
      const stelle = folgeDesEreignisses(eintrag);
      // Eine Folge hinter dem Ende der Serie ist kein Abend, den jemand
      // verbracht hat - sie ist ein Rechenfehler von damals. Deshalb steht
      // dieser Sprung vor dem Tag und nicht dahinter.
      if (stelle && unmoeglich(stelle.staffel, stelle.folge)) continue;

      tagMerken(zeit);

      // Ohne eindeutige Zuordnung wird nicht geraten. Das betrifft vor allem
      // die alten generischen "Abgeschlossen"-Zeilen, die auf der Serienseite
      // statt auf einer Folgenadresse entstanden sind: sie belegen, dass
      // irgendetwas endete, aber nicht was.
      if (!stelle) continue;

      const satz = nimm(stelle.staffel, stelle.folge);
      if (zeit > satz.zuletzt) satz.zuletzt = zeit;
      if (raum && !satz.raum) satz.raum = raum;
      // Eine generische Abschlusszeile mit eindeutiger Folgenadresse zaehlt
      // als Abschluss genau dieser Folge - mehr behauptet sie nicht, und als
      // eigene Zeile erscheint sie nirgends.
      if (istGenerischerAbschluss(eintrag?.label)) satz.abgeschlossen = true;
      eigene.add(folgenSchluessel(stelle.staffel, stelle.folge));
    }

    // 3. Die Stelle, an der dieser Eintrag gerade steht - aber nur, wenn die
    //    Folge oben schon persoenlich belegt ist.
    //
    //    Der Grund ist der Raumfortschritt: `watchpartyStandUebernehmen`
    //    schreibt Stelle, Laufzeit und Folgennummer eines *anderen*
    //    Mitglieds in den eigenen Eintrag, ruehrt aber weder `activity` noch
    //    `completedEpisodes` an. Wer bis Folge 8 dabei war, waehrend der Raum
    //    bis Folge 10 weiterschaute, hat deshalb hier Folge 10 stehen - und
    //    genau die darf nicht in seinem Verlauf auftauchen.
    const zeiger = folgenkennung(favorite.url)
      || (verlaufZahl(favorite.episode) ? { staffel: verlaufZahl(favorite.season), folge: verlaufZahl(favorite.episode) } : null);
    const stelleSek = Number(favorite.currentTime) || Number(favorite.position) || 0;
    if (zeiger && stelleSek > 0 && eigene.has(folgenSchluessel(zeiger.staffel, zeiger.folge))) {
      const satz = nimm(zeiger.staffel, zeiger.folge);
      if (stelleSek > satz.position) {
        satz.position = stelleSek;
        satz.dauer = Number(favorite.duration) || satz.dauer;
      }
    }
  }

  // `tage` haelt oertliche Kalendertage (`toDateString` rechnet in die Zone
  // des Geraets um). Zwanzig Folgen an einem Abend sind ein Tag, und zwanzig
  // Fortschrittsmeldungen derselben Folge erst recht.
  return { folgen, tage };
}

// --- Der Status ---------------------------------------------------------------

function normalisierterLaufStatus(metadaten) {
  return String(metadaten?.laufStatus || "").trim().toUpperCase();
}

function naechsteFolgeLesen(metadaten) {
  const roh = metadaten?.naechsteFolge;
  if (!roh) return null;
  const zeit = zeitpunkt(roh.zeit);
  const nummer = verlaufZahl(roh.nummer);
  if (!zeit && !nummer) return null;
  return { nummer, zeit };
}

/*
 * Der Zustand eines Titels - berechnet, nicht gespeichert.
 *
 * "Auf aktuellem Stand" ist kein Ereignis, das man ablegen koennte: es haengt
 * davon ab, was der Anbieter gerade hat und was AniList beziehungsweise TMDB
 * ueber die Serie sagt. Beides aendert sich, ohne dass der Nutzer etwas tut.
 *
 * Die eine Regel, die ueber allem steht: ein endgueltiger Abschluss wird nie
 * behauptet, solange er nicht belegt ist. "Beim Anbieter kommt gerade nichts
 * mehr" ist kein Beleg - es ist der Normalzustand jeder laufenden Serie
 * zwischen zwei Folgen.
 */
function statusBestimmen(angaben) {
  const {
    istSerie = true,
    anbieterStandGesehen = false,
    gesehenGesamt = 0,
    metadaten = null
  } = angaben || {};

  const lauf = normalisierterLaufStatus(metadaten);
  const naechste = naechsteFolgeLesen(metadaten);
  const folgenGesamt = verlaufZahl(metadaten?.folgenGesamt);
  const quelle = String(metadaten?.quelle || "").toLowerCase();

  // Eine bekannte naechste Folge schlaegt jeden Statuseintrag: sie ist der
  // direkte Beweis, dass noch etwas kommt.
  if (naechste || LAEUFT.has(lauf)) {
    return anbieterStandGesehen ? STATUS.AKTUELL : STATUS.UNBEKANNT;
  }

  if (BEENDET.has(lauf) && folgenGesamt && gesehenGesamt >= folgenGesamt) {
    // AniList fuehrt jede Staffel als eigenes Werk - `folgenGesamt` ist dort
    // die Folgenzahl dieser Staffel. TMDB zaehlt die ganze Serie.
    if (!istSerie) return STATUS.SERIE;
    return quelle === "anilist" ? STATUS.STAFFEL : STATUS.SERIE;
  }

  // Alles andere: entweder fehlen die Zahlen, oder es sind noch nicht alle
  // offiziellen Folgen gesehen. Beides rechtfertigt keinen Abschluss.
  return anbieterStandGesehen ? STATUS.AKTUELL : STATUS.UNBEKANNT;
}

// --- Das Anzeigemodell ---------------------------------------------------------

/**
 * Das fertige Modell fuer den Verlaufs-Kasten.
 *
 * @param favoriten alle Eintraege der Ablage (die Gruppe wird hier gebildet)
 * @param favorite  der Titel, um den es geht
 * @param optionen  { metadaten } - was AniList/TMDB ueber den Titel sagen, oder null
 */
function verlaufBauen(favoriten, favorite, optionen = {}) {
  const gruppe = gruppeFinden(favoriten, favorite);
  const metadaten = optionen.metadaten || null;

  // Was der Anbieter gerade hat. Mehrere Eintraege desselben Titels koennen
  // verschieden alte Staende tragen - der weiteste zaehlt.
  //
  // Das steht vor dem Sammeln und nicht mehr dahinter: die Grenze der Serie
  // entscheidet mit, welche Ereignisse ueberhaupt zaehlen. Siehe
  // {@code unmoeglich} in folgenSammeln - eine Folge hinter dem Ende der
  // Serie ist keine.
  let letzteStaffel = 0;
  let letzteFolge = 0;
  let istSerie = false;
  for (const eintrag of gruppe) {
    if (String(eintrag?.type || "") === "serie" || folgenkennung(eintrag?.url)) istSerie = true;
    const staffel = verlaufZahl(eintrag?.finalSeason);
    const folge = verlaufZahl(eintrag?.finalEpisode);
    if (!staffel || !folge) continue;
    if (staffel > letzteStaffel || (staffel === letzteStaffel && folge > letzteFolge)) {
      letzteStaffel = staffel;
      letzteFolge = folge;
    }
  }

  const { folgen, tage } = folgenSammeln(gruppe, { letzteStaffel, letzteFolge });

  const liste = [...folgen.values()].sort((links, rechts) => (
    rechts.staffel - links.staffel || rechts.folge - links.folge
  ));
  if (liste.length) istSerie = true;

  // Auf dem Stand des Anbieters ist, wer dessen letzte verfuegbare Folge
  // gesehen hat. Das geht bei jeder Staffelzahl - anders als eine Gesamtzahl,
  // die der Anbieter fuer frueherere Staffeln gar nicht mitteilt.
  const anbieterStandGesehen = Boolean(letzteStaffel && letzteFolge
    && folgen.has(folgenSchluessel(letzteStaffel, letzteFolge)));

  // "X von Y verfuegbaren" laesst sich nur bei einer einzigen Staffel ehrlich
  // sagen: fuer frueherere Staffeln nennt der Anbieter keine Folgenzahl, und
  // eine geschaetzte waere eine erfundene.
  const verfuegbar = letzteStaffel === 1 ? letzteFolge : 0;

  const status = statusBestimmen({
    istSerie,
    anbieterStandGesehen,
    gesehenGesamt: liste.length,
    metadaten
  });

  const zuletztGesehen = liste.reduce((bester, satz) => (
    satz.zuletzt && (!bester || satz.zuletzt > bester.zuletzt) ? satz : bester
  ), null);

  const staffeln = [];
  for (const satz of liste) {
    let abschnitt = staffeln.find((eintrag) => eintrag.nummer === satz.staffel);
    if (!abschnitt) {
      abschnitt = { nummer: satz.staffel, folgen: [] };
      staffeln.push(abschnitt);
    }
    abschnitt.folgen.push(satz);
  }

  return {
    titel: String(favorite?.title || ""),
    istSerie,
    folgen: liste,
    staffeln,
    gesehenGesamt: liste.length,
    verfuegbar,
    letzteStaffel,
    letzteFolge,
    anbieterStandGesehen,
    status,
    tage: tage.size,
    zuletztGesehen,
    naechsteFolge: naechsteFolgeLesen(metadaten),
    // Ein Film hat keine Folgen. Sein Abschluss steht am Eintrag selbst - er
    // ist dort eindeutig, weil es nur ein Werk gibt.
    filmAbgeschlossen: !istSerie && gruppe.some((eintrag) => Boolean(eintrag?.completed)),
    filmZeit: gruppe.reduce((bester, eintrag) => Math.max(bester,
      zeitpunkt(eintrag?.completedAt), zeitpunkt(eintrag?.lastWatchedAt)), 0)
  };
}

const verlaufSchnittstelle = {
  STATUS,
  NUR_GEOEFFNET,
  folgenkennung,
  serienSchluessel,
  gruppeFinden,
  folgeDesEreignisses,
  istGenerischerAbschluss,
  folgenSammeln,
  statusBestimmen,
  verlaufBauen
};

// Zwei Verbraucher, ein Modul - wie bei shared/bildausschnitt.js: der
// Hauptprozess und die Pruefungen laden es als CommonJS, die Oberflaeche als
// gewoehnliches Skript.
if (typeof module !== "undefined" && module.exports) module.exports = verlaufSchnittstelle;
if (typeof globalThis !== "undefined") globalThis.ELFIX_VERLAUF = verlaufSchnittstelle;
