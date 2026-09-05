"use strict";

/*
 * Welche der beobachteten Adressen der Film ist.
 *
 * Das ist die zweite Stufe der Auflösung: findet direktquelle.js im Quelltext
 * nichts, wird der Hoster geladen und dabei zugesehen, was er holt. Danach
 * liegt eine Liste vor - und die ist voller falscher Antworten.
 *
 * <h2>Was auf so einer Seite alles vorbeikommt</h2>
 *
 * Ein Werbe-Vorspann als eigene HLS-Playlist. Ein Vorschauvideo fuer den
 * Streifen unter dem Fortschrittsbalken. Zaehlpixel mit ".mp4" im Pfad. Die
 * Stuecke des laufenden Films, hunderte davon. Zwei Master-Playlists desselben
 * Streams von verschiedenen Kanten. Und irgendwo dazwischen der Film.
 *
 * <b>"Die erste .m3u8 gewinnt" ist deshalb regelmaessig falsch:</b> die Werbung
 * ist kleiner, kommt frueher und wird zuerst geladen.
 *
 * <h2>Die Regeln, in dieser Reihenfolge</h2>
 *
 * <ol>
 *   <li><b>Was das Videoelement wirklich benutzt, schlaegt alles.</b> Steht in
 *       `currentSrc` keine `blob:`-Adresse, ist die Frage beantwortet.
 *   <li><b>Segmente sind nie die Antwort - aber sie sind der beste Zeuge.</b>
 *       Ein Stueck beweist, dass die Playlist darueber gerade laeuft. Genau das
 *       macht die Beobachtung wertvoll, obwohl ein Stueck selbst nie zurueck
 *       gegeben wird.
 *   <li><b>Die Laufzeit entscheidet.</b> Wo ein Manifest gelesen wurde, faellt
 *       alles unter zwei Minuten heraus: das ist ein Vorspann, kein Film.
 *   <li><b>Herkunft zaehlt.</b> Was von einem Werbenetz kommt, ist keine Folge -
 *       und wer ein Werbenetz ist, weiss der Filter der App laengst.
 * </ol>
 *
 * <h2>Und was hier nicht steht</h2>
 *
 * Kein Netz, kein DOM, keine Hosternamen. Was gemessen wurde, reicht der
 * Aufrufer herein; was daraus folgt, steht hier. So laesst sich jede Spielart
 * als Probe hinlegen (tests/streamspurtest.js) statt sie am lebenden Hoster
 * nachzustellen.
 */

/** Kuerzer als das ist kein Film, sondern ein Vorspann. */
const MINDESTLAUFZEIT_S = 120;

/** Endungen, hinter denen ein einzelnes Stueck liegt - nie ein ganzer Film. */
const STUECK = /\.(ts|m4s|aac|vtt|key)(\?|#|$)/i;

/** Namen, die ein Stueck auch ohne solche Endung verraten. */
const STUECKNAME = /(^|[/_-])(init|seg|segment|chunk|frag|part)[-_]?\d*\.(mp4|m4s|ts|webm)(\?|#|$)/i;

/** Was nach Vorschau, Probe oder Werbung aussieht - nie der Hauptfilm. */
const NEBENSACHE = /(preview|vorschau|trailer|sample|thumb|sprite|storyboard|preroll|midroll|advert|\/ads?\/)/i;

/** Eine Playlist. */
const PLAYLIST = /\.(m3u8|mpd)(\?|#|$)/i;

/** Eine Datei, die man am Stueck spielen kann. */
const DATEI = /\.(mp4|webm|mkv|mov)(\?|#|$)/i;

/* ------------------------------------------------------------------ Einordnen */

/**
 * Was ist diese Adresse?
 *
 * "stueck" ist die wichtigste der vier Antworten: sie schliesst die Adresse als
 * Ergebnis aus und macht sie gleichzeitig zum Beleg fuer ihre Playlist.
 */
function art(adresse) {
  const wert = String(adresse || "");
  if (!wert) return "nichts";
  if (PLAYLIST.test(wert)) return "playlist";
  if (STUECK.test(wert) || STUECKNAME.test(wert)) return "stueck";
  if (DATEI.test(wert)) return "datei";
  return "nichts";
}

/** Der Ordner einer Adresse - der Bezug zwischen Stueck und Playlist. */
function ordner(adresse) {
  try {
    const ziel = new URL(String(adresse || ""));
    ziel.search = "";
    ziel.hash = "";
    ziel.pathname = ziel.pathname.replace(/[^/]*$/, "");
    return ziel.href;
  } catch (_) {
    return "";
  }
}

function wirt(adresse) {
  try {
    return new URL(String(adresse || "")).hostname.toLowerCase();
  } catch (_) {
    return "";
  }
}

/**
 * Eine Beobachtung aufnehmen.
 *
 * Doppelte fallen weg, aber sie zaehlen: dass eine Playlist zehnmal geholt
 * wurde, ist eine Auskunft ueber sie (ein laufender Player laedt seine Media-
 * Playlist immer wieder nach). Deshalb `treffer`.
 */
function aufnehmen(liste, eintrag) {
  const bestand = Array.isArray(liste) ? liste : [];
  const adresse = String(eintrag?.adresse || "").trim();
  if (!adresse || !/^https?:/i.test(adresse)) return bestand;
  const vorhanden = bestand.find((wert) => wert.adresse === adresse);
  if (vorhanden) {
    vorhanden.treffer += 1;
    return bestand;
  }
  return [...bestand, {
    adresse,
    art: art(adresse),
    treffer: 1,
    vonWerbung: Boolean(eintrag?.vonWerbung),
    rahmen: String(eintrag?.rahmen || ""),
    groesse: Number(eintrag?.groesse) || 0,
    laufzeit: Number(eintrag?.laufzeit) || 0
  }];
}

/* -------------------------------------------------------------- Die Auswahl */

/**
 * Der Hauptstream aus dem Beobachteten.
 *
 * `lage` traegt zusammen, was ausserhalb dieser Liste bekannt ist:
 *
 *   `currentSrc`  was im Videoelement steht (auch `blob:` - dann zaehlt es nicht)
 *   `rahmen`      die Adresse des Rahmens, in dem der Player liegt
 *   `laufzeiten`  Adresse -> Sekunden, soweit ein Manifest gelesen wurde
 *
 * Zurueck kommt immer auch, was verworfen wurde und warum. Ohne das ist ein
 * falscher Treffer nicht zu untersuchen - und genau das wird der Fall sein,
 * den man nachvollziehen will.
 */
function waehlen(beobachtungen, lage = {}) {
  const liste = (Array.isArray(beobachtungen) ? beobachtungen : []).filter(Boolean);
  const verworfen = [];
  const weg = (eintrag, grund) => {
    verworfen.push({ adresse: eintrag.adresse, grund });
    return false;
  };

  // 1. Das Videoelement selbst. Eine echte Adresse dort ist keine Vermutung,
  //    sondern der laufende Zustand.
  const ausElement = String(lage.currentSrc || "");
  if (ausElement && !/^blob:/i.test(ausElement) && art(ausElement) !== "nichts"
    && art(ausElement) !== "stueck") {
    return {
      quelle: ausElement,
      art: art(ausElement),
      grund: "aus dem Videoelement",
      verworfen
    };
  }

  // 2. Stuecke belegen ihre Playlist. Gezaehlt wird je Ordner - die Playlist
  //    liegt ueber ihren Stuecken.
  const belege = new Map();
  for (const eintrag of liste) {
    if (eintrag.art !== "stueck") continue;
    const heim = ordner(eintrag.adresse);
    if (heim) belege.set(heim, (belege.get(heim) || 0) + eintrag.treffer);
  }

  const kandidaten = liste.filter((eintrag) => {
    if (eintrag.art === "stueck") return weg(eintrag, "Stück, kein Stream");
    if (eintrag.art === "nichts") return weg(eintrag, "kein Medium");
    if (eintrag.vonWerbung) return weg(eintrag, "Werbenetz");
    if (NEBENSACHE.test(eintrag.adresse)) return weg(eintrag, "Vorschau oder Werbung");
    const laufzeit = Number(lage.laufzeiten?.[eintrag.adresse] ?? eintrag.laufzeit) || 0;
    if (laufzeit > 0 && laufzeit < MINDESTLAUFZEIT_S) {
      return weg(eintrag, `nur ${Math.round(laufzeit)} s - Vorspann`);
    }
    return true;
  });

  if (!kandidaten.length) {
    return { quelle: "", art: "", grund: "nichts Brauchbares beobachtet", verworfen };
  }

  // 3. Die Reihenfolge: belegte Playlists zuerst, dann Playlists, dann Dateien.
  //    Innerhalb dessen entscheidet die Laufzeit, dann die Zahl der Abrufe,
  //    dann die Naehe zum Rahmen des Players.
  const rahmenWirt = wirt(lage.rahmen || "");
  const punkte = (eintrag) => {
    const laufzeit = Number(lage.laufzeiten?.[eintrag.adresse] ?? eintrag.laufzeit) || 0;
    let wert = 0;
    if (belege.get(ordner(eintrag.adresse))) wert += 1000;
    if (eintrag.art === "playlist") wert += 200;
    if (laufzeit >= MINDESTLAUFZEIT_S) wert += 400;
    if (rahmenWirt && wirt(eintrag.adresse) === rahmenWirt) wert += 50;
    wert += Math.min(eintrag.treffer, 20);
    return wert;
  };

  const sortiert = kandidaten
    .map((eintrag, stelle) => ({ eintrag, stelle, wert: punkte(eintrag) }))
    .sort((links, rechts) => (rechts.wert - links.wert) || (links.stelle - rechts.stelle));

  const beste = sortiert[0].eintrag;
  for (const rest of sortiert.slice(1)) {
    verworfen.push({ adresse: rest.eintrag.adresse, grund: "schwächerer Beleg" });
  }
  const belegt = belege.get(ordner(beste.adresse)) || 0;
  return {
    quelle: beste.adresse,
    art: beste.art,
    grund: belegt
      ? `${belegt} Stücke belegen sie`
      : (beste.art === "playlist" ? "einzige brauchbare Playlist" : "einzige brauchbare Datei"),
    verworfen
  };
}

/* ------------------------------------------------------------- Der Schutz */

/** Felder, deren Wert nie in ein Protokoll gehoert. */
const GEHEIM = /^(token|expires?|ip|hash|sig|signature|md5|key|secure|session|sid|auth|s|e|st)$/i;

/**
 * Eine Adresse, wie man sie aufschreiben darf.
 *
 * Signierte Adressen tragen genau das mit, was man nicht weitergibt: einen
 * Schluessel, eine Frist und oft die eigene IP. Ein Bericht, der sie im
 * Klartext enthaelt, ist ein Bericht, den man nicht herumzeigen kann - und
 * genau dafuer ist er da.
 *
 * Gekuerzt wird der Wert, nicht der Name: dass ein `token` verlangt wird, ist
 * die Auskunft, auf die es ankommt.
 */
function adresseKuerzen(roh) {
  const wert = String(roh || "");
  if (!wert) return "";
  let ziel;
  try {
    ziel = new URL(wert);
  } catch (_) {
    return "<keine Adresse>";
  }
  const teile = [];
  for (const [name, inhalt] of ziel.searchParams.entries()) {
    teile.push(`${name}=${GEHEIM.test(name) || inhalt.length > 24 ? "<gekürzt>" : inhalt}`);
  }
  // Auch im Pfad stehen Schluessel - bei den meisten Hostern sogar dort. Lange
  // Stuecke ohne Punkt sind fast immer genau das.
  const pfad = ziel.pathname.split("/")
    .map((stueck) => (stueck.length > 24 && !stueck.includes(".") ? "<gekürzt>" : stueck))
    .join("/");
  return `${ziel.origin}${pfad}${teile.length ? `?${teile.join("&")}` : ""}`;
}

/** Nur die Namen der Kekse, nie ihre Werte. */
function kekseKuerzen(roh) {
  return String(roh || "")
    .split(";")
    .map((stueck) => stueck.split("=")[0].trim())
    .filter(Boolean);
}

module.exports = {
  art,
  ordner,
  aufnehmen,
  waehlen,
  adresseKuerzen,
  kekseKuerzen,
  MINDESTLAUFZEIT_S
};
