"use strict";

/*
 * Die Watchlist - und die eine Frage, die sie vorher nirgends beantwortet hat:
 * *welcher Titel ist das eigentlich?*
 *
 * --- Warum es diese Datei gibt ------------------------------------------------
 *
 * ELFIX kannte fuer "derselbe Titel" bis hierher vier verschiedene Antworten,
 * je nachdem, wer fragte:
 *
 *   1. `fortschritt.favoriteReplacementKey`  - Anbieter + Art + Slug aus der
 *      Adresse. Damit sucht der Fortschritt, damit sucht das Vormerken.
 *   2. `geraete-stand.titelSchluessel`       - Art + Titelschluessel. Damit
 *      sucht der Geraeteabgleich, und daran haengt auch der Watchparty-Raum.
 *   3. `main.istGleicherTitel`               - Adresse *oder* Titelschluessel.
 *      Damit wandert ein eigenes Bild auf alle Eintraege desselben Titels.
 *   4. `renderer.istGleicheSerieLokal`       - Adresse, sonst Titel. Damit
 *      sucht die Oberflaeche den weitesten Stand.
 *
 * Vier Antworten sind drei zu viel. Wo zwei davon aufeinandertreffen, entsteht
 * genau der Fehler, wegen dem diese Datei geschrieben wurde: der Geraeteabgleich
 * sucht einen Titel unter (2), findet ihn nicht, und legt einen zweiten Eintrag
 * an - obwohl (1) ihn gefunden haette. Nachgemessen an der echten Ablage vom
 * 31.08.2026:
 *
 *   taste.titelSchluessel("Pokémon")  ->  "pokmon"
 *   taste.titelSchluessel("Pokemon")  ->  "pokemon"
 *
 * Das `é` wird ersatzlos gestrichen (gefaltet werden nur ä, ö, ü und ß). Meldet
 * ein Geraet den Titel mit Akzent und das andere ohne - und das tun sie, weil
 * der Titel einmal aus dem Seitentitel und einmal aus der Ablage stammt -, sind
 * das zwei Schluessel fuer dieselbe Serie. In der Ablage standen daraufhin drei
 * private "Pokémon"-Eintraege mit *identischer* Adresse, identischem Anbieter
 * und identischem Slug; zwei davon mit `favorite: true`, und die Watchlist
 * zeigte den Titel folgerichtig zweimal.
 *
 * --- Der kanonische Schluessel ------------------------------------------------
 *
 * Hier steht deshalb genau eine Antwort, und alle fragen sie:
 * {@link werkSchluessel}. Er nimmt die Adresse als Quelle und nicht den Titel.
 * Das ist der entscheidende Unterschied zu (2): eine Adresse schreibt niemand
 * ab. Der Slug einer Serie - `pokmon`, `die-legende-von-korra` - ist auf jedem
 * Geraet, in jeder Schreibweise und unter jedem Wirt derselbe. S.to laeuft hier
 * ueber eine IP und dort ueber seine Domain; der Slug bleibt.
 *
 * Der Wirt gehoert deshalb ausdruecklich *nicht* in den Schluessel, der
 * Anbieter auch nicht: fuer die Watchlist ist eine Serie eine Serie. Genau das
 * ist die Zusage, um die es geht - ein Titel steht dort einmal, egal wo man ihn
 * schaut.
 *
 * Fuer alles ohne Slug - YouTube-Videos vor allem - faellt der Schluessel auf
 * die normalisierte Adresse zurueck, nicht auf den Titel: sechs Videos ohne
 * Slug haetten sonst denselben leeren Schluessel getragen und waeren beim
 * Zusammenfuehren zu einem geworden. Die Rueckfaelle tragen ein eigenes
 * Praefix, damit ein Titel- nie zufaellig auf einen Slug-Schluessel faellt.
 *
 * --- Was hier ausdruecklich *nicht* passiert ----------------------------------
 *
 * `taste.titelSchluessel` bleibt, wie es ist, und `geraete-stand.titelSchluessel`
 * ebenfalls. An beiden haengen Schluessel, die ueber die Leitung gehen: der
 * Raumschluessel einer Watchparty und die Folgenkennung der Statistik. Wer sie
 * anfasst, benennt laufende Raeume um und zaehlt gesehene Folgen ein zweites
 * Mal. Der Abgleich bekommt stattdessen eine *duldsame Suche* (siehe
 * `geraete-stand.eintragFinden`): geschrieben wird weiter der alte Schluessel,
 * gefunden wird auch ueber den kanonischen. Damit entstehen keine Doppelten
 * mehr, ohne dass sich ein einziges Byte auf der Leitung aendert.
 */

const taste = require("./taste");
const fortschritt = require("./fortschritt");

// Wie viele Ereignisse ein zusammengefuehrter Eintrag behaelt - dieselbe Grenze
// wie in `fortschritt.appendMediaActivity`, damit ein Merge nicht plotzlich
// mehr Verlauf traegt als das normale Fortschreiben.
const AKTIVITAET_GRENZE = 120;
const ABGESCHLOSSENE_FOLGEN_GRENZE = 500;

/**
 * Der Titelanteil des Schluessels.
 *
 * <p>Erst die deutsche Faltung (ä→ae), dann die restlichen Akzente abstreifen.
 * Die Reihenfolge ist Absicht: umgekehrt wuerde aus "Bär" erst "Bar" und dann
 * "bar" statt "baer", und zwei deutsche Titel fielen zusammen, die sich
 * unterscheiden.
 */
function titelAnteil(wert) {
  const deutsch = String(wert == null ? "" : wert)
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
  // NFD zerlegt "é" in "e" + Akzent; der Akzent faellt weg, das "e" bleibt.
  const ohneAkzente = deutsch.normalize ? deutsch.normalize("NFD").replace(/[̀-ͯ]/g, "") : deutsch;
  return taste.titelSchluessel(ohneAkzente);
}

/** Welche Gattung im Schluessel steht. */
function medienart(url, art) {
  return fortschritt.normalizeMediaType(art) || fortschritt.inferMediaType(url) || "serie";
}

/**
 * Der kanonische Schluessel eines Werks.
 *
 * <p>Die eine Stelle, an der ELFIX entscheidet, ob zwei Eintraege denselben
 * Titel meinen. Sie nimmt nur, was sich nicht abschreiben laesst: die Adresse.
 *
 * @param titel Der Titel des Eintrags - nur als Rueckfall gebraucht.
 * @param url   Die Adresse. Aus ihr kommt der Slug, und der entscheidet.
 * @param art   "serie", "film" - oder leer, dann wird sie aus der Adresse
 *              hergeleitet.
 * @returns Der Schluessel, oder "" wenn sich nichts bestimmen laesst. Ein
 *          leerer Schluessel wird nirgends zusammengefuehrt und nirgends
 *          entdoppelt: lieber ein Eintrag zu viel als zwei verschmolzene, die
 *          nichts miteinander zu tun haben.
 */
function werkSchluessel(titel, url = "", art = "") {
  const adresse = String(url == null ? "" : url);
  const gattung = medienart(adresse, art);

  const slug = fortschritt.mediaSlugFromUrl(adresse);
  if (slug) return `${gattung}:${slug}`;

  // Kein Slug - YouTube und alles, was seine Kennung in der Abfrage traegt.
  // Die normalisierte Adresse ist dort das Genaueste, was es gibt; sie fasst
  // die Varianten derselben Adresse zusammen (list, si, pp) und laesst zwei
  // verschiedene Videos zwei bleiben.
  const adressSchluessel = adresse ? fortschritt.normalizeFavoriteUrl(adresse) : "";
  if (adressSchluessel) return `${gattung}:u:${adressSchluessel}`;

  // Ganz ohne Adresse bleibt der Titel. Der Rueckfalltitel "Favorit" zaehlt
  // dabei nicht: er steht fuer "kein Titel bekannt", und ohne diese Zeile
  // truegen alle namenlosen Eintraege denselben Schluessel und wuerden zu
  // einem zusammengefuehrt. Dieselbe Vorsicht wie in `main.istGleicherTitel`.
  const nachTitel = titelAnteil(fortschritt.cleanBaseMediaTitle(titel, adresse) || titel);
  if (!nachTitel || nachTitel === "favorit") return "";
  return `${gattung}:t:${nachTitel}`;
}

/** Derselbe Schluessel, aber aus einem fertigen Eintrag. */
function schluesselVon(eintrag) {
  return werkSchluessel(eintrag?.title, eintrag?.url, eintrag?.type);
}

/** Meinen diese beiden Eintraege dasselbe Werk? */
function gleichesWerk(links, rechts) {
  const a = schluesselVon(links);
  return Boolean(a) && a === schluesselVon(rechts);
}

/**
 * Gehoert dieser Eintrag dem Nutzer selbst - oder einer Watchparty-Runde?
 *
 * <p>Raum-Eintraege sind bewusst eigene Eintraege: derselbe Anime kann in zwei
 * Runden und einmal privat dastehen, und diese drei Staende haben nichts
 * miteinander zu tun. Die Watchlist ist die private Liste; sie fuehrt nur
 * private Eintraege, und zusammengefuehrt wird auch nur unter privaten.
 */
function istPrivat(eintrag) {
  return !String(eintrag?.watchpartyRoom || "");
}

/** Steht dieser Eintrag auf der Watchlist? Vorgemerkt und noch nicht durch. */
function istVorgemerkt(eintrag) {
  return Boolean(eintrag) && eintrag.favorite !== false && !eintrag.completed;
}

/**
 * Der private Eintrag, der ein Werk auf der Watchlist vertritt.
 *
 * <p>Gibt es mehrere - eine Ablage, die noch nicht durch das Zusammenfuehren
 * gelaufen ist -, gewinnt der vorgemerkte; unter mehreren vorgemerkten der
 * aeltere, denn der traegt die laengere Geschichte.
 */
function traeger(favoriten, schluessel) {
  if (!schluessel) return null;
  let bester = null;
  for (const eintrag of favoriten || []) {
    if (!istPrivat(eintrag) || schluesselVon(eintrag) !== schluessel) continue;
    if (!bester) { bester = eintrag; continue; }
    const hier = istVorgemerkt(eintrag);
    const dort = istVorgemerkt(bester);
    if (hier !== dort) { if (hier) bester = eintrag; continue; }
    if (String(eintrag.createdAt || "") < String(bester.createdAt || "")) bester = eintrag;
  }
  return bester;
}

/**
 * Zu welchem Werk gehoert diese Kennung?
 *
 * <p>Der Weg von einer Kennung zum Schluessel - und der Grund, warum Entfernen
 * jetzt trifft. Die Oberflaeche hat frueher die Kennung des *weitesten* Standes
 * an "aus der Watchlist nehmen" gereicht, und das war oft der Eintrag einer
 * Watchparty-Runde: der stand gar nicht auf der Watchlist, und das Entfernen
 * lief ins Leere, waehrend die Karte stehenblieb.
 */
function schluesselZuId(favoriten, id) {
  const kennung = String(id || "");
  if (!kennung) return "";
  const treffer = (favoriten || []).find((eintrag) => String(eintrag?.id || "") === kennung);
  return treffer ? schluesselVon(treffer) : "";
}

/** Kennung oder Schluessel - beides fuehrt zum Schluessel. */
function schluesselAus(favoriten, was) {
  const wert = String(was || "");
  if (!wert) return "";
  return schluesselZuId(favoriten, wert) || (traeger(favoriten, wert) ? wert : "");
}

/** Steht dieses Werk auf der Watchlist? */
function steht(favoriten, was) {
  const schluessel = typeof was === "object" ? schluesselVon(was) : schluesselAus(favoriten, was);
  if (!schluessel) return false;
  return (favoriten || []).some((eintrag) => istPrivat(eintrag)
    && istVorgemerkt(eintrag)
    && schluesselVon(eintrag) === schluessel);
}

/**
 * Die Watchlist: je Werk genau ein Eintrag.
 *
 * <p>Die Entdoppelung hier ist kein Filter ueber einen Fehler, sondern die
 * Definition der Liste. Zusammengefuehrt wird beim Laden; was hier noch doppelt
 * ankommt, ist zwischen zwei Ladevorgaengen entstanden - etwa durch einen
 * Abgleich, der gerade lief.
 */
function liste(favoriten) {
  const nachWerk = new Map();
  const ohneSchluessel = [];
  for (const eintrag of favoriten || []) {
    if (!istPrivat(eintrag) || !istVorgemerkt(eintrag)) continue;
    const schluessel = schluesselVon(eintrag);
    if (!schluessel) { ohneSchluessel.push(eintrag); continue; }
    const bisher = nachWerk.get(schluessel);
    if (!bisher || String(eintrag.createdAt || "") < String(bisher.createdAt || "")) {
      nachWerk.set(schluessel, eintrag);
    }
  }
  return [...nachWerk.values(), ...ohneSchluessel];
}

/**
 * Ein Werk vormerken.
 *
 * <p>Angelegt wird hier nichts - das kann nur {@code fortschritt.vonHandAnlegen},
 * denn dafuer braucht es Anbieter und Adresse. Hier wird ein vorhandener
 * Eintrag vorgemerkt, und zwar der eine, der das Werk vertritt.
 *
 * @returns {{favoriten, eintrag, geaendert, schonDabei}}
 */
function aufnehmen(favoriten, was) {
  const liste2 = Array.isArray(favoriten) ? favoriten : [];
  const schluessel = typeof was === "object" ? schluesselVon(was) : schluesselAus(liste2, was);
  const eintrag = traeger(liste2, schluessel);
  if (!eintrag) return { favoriten: liste2, eintrag: null, geaendert: false, schonDabei: false };

  const schonDabei = istVorgemerkt(eintrag);
  if (schonDabei) return { favoriten: liste2, eintrag, geaendert: false, schonDabei: true };

  eintrag.favorite = true;
  // Was auf der Watchlist steht, gilt nicht mehr als abgehakt - sonst stuende
  // derselbe Titel gleichzeitig in der Mediathek und unter "will ich sehen".
  // Dieselbe Aufloesung wie in `favorites:set-watchlist`.
  if (eintrag.completed) {
    eintrag.completed = false;
    eintrag.completedManually = false;
    eintrag.completedAt = "";
    eintrag.rewatching = false;
  }
  eintrag.updatedAt = new Date().toISOString();
  return { favoriten: liste2, eintrag, geaendert: true, schonDabei: false };
}

/**
 * Ein Werk von der Watchlist nehmen.
 *
 * <p>Und zwar jeden Eintrag, der dazu gehoert - auch den einer Runde. Ein
 * Raum-Eintrag gehoert nie auf die Watchlist; steht er trotzdem darauf (der
 * Herz-Knopf des Telefons konnte das), waere er nach dem Entfernen des privaten
 * immer noch da, und die Karte kaeme zurueck.
 *
 * @returns {{favoriten, entfernt, geaendert}}
 */
function entfernen(favoriten, was) {
  const liste2 = Array.isArray(favoriten) ? favoriten : [];
  const schluessel = typeof was === "object" ? schluesselVon(was) : schluesselAus(liste2, was);
  if (!schluessel) return { favoriten: liste2, entfernt: [], geaendert: false };

  const entfernt = [];
  const jetzt = new Date().toISOString();
  for (const eintrag of liste2) {
    if (schluesselVon(eintrag) !== schluessel) continue;
    if (eintrag.favorite === false) continue;
    eintrag.favorite = false;
    eintrag.updatedAt = jetzt;
    entfernt.push(eintrag);
  }
  return { favoriten: liste2, entfernt, geaendert: entfernt.length > 0 };
}

/**
 * Vormerken oder herunternehmen - je nachdem, was gerade gilt.
 *
 * <p>Fuer den Herz-Knopf. Er kennt die offene Adresse und sonst nichts, und
 * genau das reicht: der kanonische Schluessel kommt aus der Adresse. Vorher
 * fragte das Telefon dafuer den *aktiven* Eintrag, und waehrend einer
 * Watchparty ist das der des Raums - der Knopf merkte dann einen Raum-Eintrag
 * vor, der auf der eigenen Merkliste nichts zu suchen hat.
 *
 * @param was Kennung, Schluessel oder ein Objekt mit Titel, Adresse und Art
 * @returns {{favoriten, vorgemerkt, geaendert, gefunden}} - `gefunden: false`
 *          heisst "diesen Titel gibt es hier noch nicht"; dann ist
 *          {@code fortschritt.vonHandAnlegen} zustaendig.
 */
function umschalten(favoriten, was) {
  const liste2 = Array.isArray(favoriten) ? favoriten : [];
  const schluessel = typeof was === "object" ? schluesselVon(was) : schluesselAus(liste2, was);
  const eintrag = traeger(liste2, schluessel);
  if (!eintrag) return { favoriten: liste2, vorgemerkt: false, geaendert: false, gefunden: false };

  if (istVorgemerkt(eintrag)) {
    const urteil = entfernen(liste2, schluessel);
    return { favoriten: urteil.favoriten, vorgemerkt: false, geaendert: urteil.geaendert, gefunden: true };
  }
  const urteil = aufnehmen(liste2, schluessel);
  return { favoriten: urteil.favoriten, vorgemerkt: true, geaendert: urteil.geaendert, gefunden: true };
}

// --- Zusammenfuehren ---------------------------------------------------------
//
// Die einmalige Bereinigung. Sie laeuft bei jedem Laden, tut aber nur dann
// etwas, wenn wirklich zwei Eintraege dasselbe Werk meinen - und dann fuehrt
// sie zusammen, statt zu loeschen.

function zahl(wert) {
  const n = Number(wert);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Der spaetere von zwei Zeitstempeln; leere Angaben verlieren immer. */
function spaeter(links, rechts) {
  const a = String(links || "");
  const b = String(rechts || "");
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function frueher(links, rechts) {
  const a = String(links || "");
  const b = String(rechts || "");
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

/**
 * Wie weit ist dieser Eintrag? Staffel, dann Folge, dann die Stelle.
 *
 * <p>Dieselbe Ordnung, nach der die Oberflaeche den "weitesten Stand" sucht.
 */
function standVergleich(links, rechts) {
  const staffel = zahl(links?.season) - zahl(rechts?.season);
  if (staffel) return staffel;
  const folge = zahl(links?.episode) - zahl(rechts?.episode);
  if (folge) return folge;
  return zahl(links?.currentTime || links?.position) - zahl(rechts?.currentTime || rechts?.position);
}

/**
 * Welcher der doppelten Eintraege den Zustand vorgibt.
 *
 * <p>Der weiteste - das ist der Stand, den der Benutzer bisher auch gesehen
 * hat, denn die Oberflaeche zeigte ihn schon vorher an. Bei Gleichstand
 * entscheidet, wer mehr erlebt hat (Ereignisse, abgeschlossene Folgen), zuletzt
 * das Alter.
 */
function leiteintragWaehlen(gruppe) {
  return gruppe.reduce((bester, kandidat) => {
    const weite = standVergleich(kandidat, bester);
    if (weite !== 0) return weite > 0 ? kandidat : bester;
    const erlebt = (kandidat.activity?.length || 0) + (kandidat.completedEpisodes?.length || 0)
      - ((bester.activity?.length || 0) + (bester.completedEpisodes?.length || 0));
    if (erlebt !== 0) return erlebt > 0 ? kandidat : bester;
    return String(kandidat.createdAt || "") < String(bester.createdAt || "") ? kandidat : bester;
  });
}

function ereignisseVereinen(gruppe) {
  const alle = [];
  for (const eintrag of gruppe) {
    for (const ereignis of Array.isArray(eintrag.activity) ? eintrag.activity : []) {
      if (ereignis) alle.push(ereignis);
    }
  }
  const gesehen = new Set();
  const einmal = [];
  for (const ereignis of alle) {
    const marke = `${ereignis.at || ""}|${ereignis.url || ""}|${ereignis.label || ""}`;
    if (gesehen.has(marke)) continue;
    gesehen.add(marke);
    einmal.push(ereignis);
  }
  einmal.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
  return einmal.slice(-AKTIVITAET_GRENZE);
}

function folgenVereinen(gruppe) {
  const nachSchluessel = new Map();
  for (const eintrag of gruppe) {
    for (const folge of Array.isArray(eintrag.completedEpisodes) ? eintrag.completedEpisodes : []) {
      const marke = String(folge?.key || "");
      if (!marke || nachSchluessel.has(marke)) continue;
      nachSchluessel.set(marke, folge);
    }
  }
  return [...nachSchluessel.values()].slice(-ABGESCHLOSSENE_FOLGEN_GRENZE);
}

/**
 * Mehrere Eintraege desselben Werks zu einem machen.
 *
 * <p>Der Leiteintrag gibt den Zustand vor - Adresse, Stelle, Fortschritt. Alles
 * andere ist Geschichte und wird vereinigt, nicht ausgewaehlt: Ereignisse,
 * abgeschlossene Folgen, das eigene Bild, die gelegte Stelle in der Mediathek,
 * die Serienlaenge, die Zahl der Durchlaeufe. Es geht nichts verloren.
 */
function verschmelzen(gruppe) {
  const leit = leiteintragWaehlen(gruppe);
  const andere = gruppe.filter((eintrag) => eintrag !== leit);
  if (!andere.length) return leit;

  // Vorgemerkt ist, wer irgendwo vorgemerkt war. Zwei Eintraege desselben Werks
  // sind ein Versehen der Ablage und keine Aussage des Benutzers - aus einem
  // "steht auf der Watchlist" und einem "steht nicht" laesst sich nicht
  // herauslesen, dass er ihn herunternehmen wollte. Der Zweifel geht zugunsten
  // des Behaltens: eine Karte zu viel sieht man und nimmt sie weg, eine zu
  // wenig fehlt unbemerkt.
  leit.favorite = gruppe.some((eintrag) => eintrag.favorite !== false);

  // Von Hand abgehakt ist eine Entscheidung und ueberlebt jede Zusammenlegung;
  // sie zieht `completed` mit, sonst entstuende genau der Widerspruch, den
  // widersprucheGeraderichten() aufraeumt.
  if (gruppe.some((eintrag) => eintrag.completedManually)) {
    leit.completedManually = true;
    leit.completed = true;
  }
  if (leit.completed) leit.favorite = false;

  leit.activity = ereignisseVereinen(gruppe);
  leit.completedEpisodes = folgenVereinen(gruppe);

  for (const eintrag of andere) {
    if (!leit.thumbnail && eintrag.thumbnail) leit.thumbnail = eintrag.thumbnail;
    if (!leit.favicon && eintrag.favicon) leit.favicon = eintrag.favicon;
    if (!leit.logo && eintrag.logo) leit.logo = eintrag.logo;
    if (!leit.customThumbnail && eintrag.customThumbnail) {
      leit.customThumbnail = eintrag.customThumbnail;
      // Der Ausschnitt gehoert zu dem Bild, das gerade uebernommen wird - er
      // darf nicht bei einem anderen stehenbleiben.
      leit.customThumbnailCrop = eintrag.customThumbnailCrop || null;
    }
    if (!Number.isFinite(Number(leit.libraryOrder)) && Number.isFinite(Number(eintrag.libraryOrder))) {
      leit.libraryOrder = Number(eintrag.libraryOrder);
    }
    if (zahl(eintrag.finalSeason) > zahl(leit.finalSeason)
      || (zahl(eintrag.finalSeason) === zahl(leit.finalSeason) && zahl(eintrag.finalEpisode) > zahl(leit.finalEpisode))) {
      leit.finalSeason = zahl(eintrag.finalSeason) || leit.finalSeason;
      leit.finalEpisode = zahl(eintrag.finalEpisode) || leit.finalEpisode;
    }
    leit.rewatchCount = Math.max(zahl(leit.rewatchCount), zahl(eintrag.rewatchCount));
    leit.rewatchedAt = spaeter(leit.rewatchedAt, eintrag.rewatchedAt);
    leit.createdAt = frueher(leit.createdAt, eintrag.createdAt);
    leit.lastWatchedAt = spaeter(leit.lastWatchedAt, eintrag.lastWatchedAt);
    leit.openedAt = spaeter(leit.openedAt, eintrag.openedAt);
    leit.updatedAt = spaeter(leit.updatedAt, eintrag.updatedAt);
    leit.completedAt = spaeter(leit.completedAt, eintrag.completedAt);
    leit.newEpisodeAt = spaeter(leit.newEpisodeAt, eintrag.newEpisodeAt);
    if (!leit.newEpisodeLabel && eintrag.newEpisodeLabel) leit.newEpisodeLabel = eintrag.newEpisodeLabel;
    leit.watched = Boolean(leit.watched || eintrag.watched);
  }
  return leit;
}

/**
 * Doppelte Eintraege zusammenfuehren - die Bereinigung beim Laden.
 *
 * <p>Sie arbeitet ueber den kanonischen Schluessel und nicht ueber den
 * sichtbaren Namen: zwei Titel koennen gleich heissen und verschiedene Werke
 * sein, und zwei Schreibweisen desselben Werks sehen verschieden aus. Genau
 * daran ist die Ablage vorher zerfallen.
 *
 * <p>Angefasst wird nur, was privat ist. Die Eintraege der Watchparty-Raeume
 * bleiben unberuehrt - sie sind bewusst eigene Staende.
 *
 * @returns {{favoriten, zusammengefuehrt, berichte}} `zusammengefuehrt` ist die
 *          Zahl der *entfernten* Eintraege, nicht die der betroffenen Werke.
 */
function doppelteZusammenfuehren(favoriten) {
  const eingang = Array.isArray(favoriten) ? favoriten : [];
  const gruppen = new Map();
  for (const eintrag of eingang) {
    if (!eintrag || !istPrivat(eintrag)) continue;
    const schluessel = schluesselVon(eintrag);
    if (!schluessel) continue;
    if (!gruppen.has(schluessel)) gruppen.set(schluessel, []);
    gruppen.get(schluessel).push(eintrag);
  }

  const weg = new Set();
  const berichte = [];
  for (const [schluessel, gruppe] of gruppen) {
    if (gruppe.length < 2) continue;
    const leit = verschmelzen(gruppe);
    for (const eintrag of gruppe) if (eintrag !== leit) weg.add(eintrag);
    berichte.push({
      schluessel,
      titel: String(leit.title || ""),
      behalten: String(leit.id || ""),
      entfernt: gruppe.filter((eintrag) => eintrag !== leit).map((eintrag) => String(eintrag.id || ""))
    });
  }
  if (!weg.size) return { favoriten: eingang, zusammengefuehrt: 0, berichte };

  const bereinigt = eingang.filter((eintrag) => !weg.has(eintrag));
  // In derselben Liste weiterarbeiten: die Aufrufer halten eine Referenz
  // darauf (`favorites` im Hauptprozess), und ein Austausch ginge an ihnen
  // vorbei.
  eingang.length = 0;
  eingang.push(...bereinigt);
  return { favoriten: eingang, zusammengefuehrt: weg.size, berichte };
}

module.exports = {
  werkSchluessel,
  schluesselVon,
  gleichesWerk,
  istPrivat,
  istVorgemerkt,
  traeger,
  schluesselZuId,
  schluesselAus,
  steht,
  liste,
  aufnehmen,
  entfernen,
  umschalten,
  verschmelzen,
  doppelteZusammenfuehren
};
