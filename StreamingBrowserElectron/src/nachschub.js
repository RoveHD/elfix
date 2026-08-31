"use strict";

/**
 * Nachschub: kommt zu einer abgeschlossenen Serie noch etwas?
 *
 * <h2>Warum das ein eigenes Modul ist</h2>
 *
 * <p>Diese Frage stand vollstaendig in {@code main.js} - Auswahl der Titel,
 * Abruf der Seiten, Vergleich der Grenzen, Reaktivierung. Was in main.js steht,
 * sieht das Telefon nie. Die Folge war eine Schieflage, die man erst merkt,
 * wenn kein Rechner mehr laeuft: "Black Torch" war am Samstag mit Folge 9 da,
 * und auf dem Fernseher blieb der Titel archiviert, bis irgendwann jemand den
 * PC einschaltete.
 *
 * <p>Deshalb liegt die <em>Entscheidung</em> jetzt hier und die
 * <em>Beschaffung</em> dort, wo sie hingehoert: am Rechner holt Electron die
 * Seite, auf dem Telefon holt Java sie (die Kekse der laufenden Sitzung hat nur
 * Java, und die Anbieterseiten liegen hinter Cloudflare). Beide reichen ihren
 * Abruf als {@code holen} herein - dieselbe Bauweise wie {@code kalender.js}
 * und {@code empfehlungslauf.js}.
 *
 * <h2>Was hier <em>nicht</em> noch einmal steht</h2>
 *
 * <p>Nichts von der eigentlichen Rechnung. Die Folgenidentitaet, der Vergleich
 * zweier Staende, die Frage "liegt das hinter dem, was abgeschlossen wurde"
 * und der Weg zur naechsten Folge kommen aus {@code fortschritt.js}
 * ({@link episodeIdentity}, {@link compareEpisodeIdentity},
 * {@link hasNewEpisodeAfterCompletedFavorite}, {@link nextEpisodeAfterFavoriteUrl});
 * die Seiten liest {@code discover.js}. Hier steht nur, in welcher Reihenfolge
 * das gefragt wird und was daraus folgt.
 *
 * <h2>Die Vorsicht, die eingebaut ist</h2>
 *
 * <p>Ein falscher Nachschub ist teurer als ein verpasster. Er reisst einen
 * Titel aus der Mediathek, setzt ihn auf eine Folge, die es nicht gibt, und
 * stellt eine archivierte Watchparty-Runde wieder auf aktiv. Anbieterseiten
 * antworten aber halb, leer, aus einem Zwischenspeicher oder gar nicht.
 *
 * <p>Reaktiviert wird deshalb nur, wenn der neue Umfang <em>strikt hinter</em>
 * zweierlei liegt: hinter der zuletzt bekannten Grenze <em>und</em> hinter der
 * Folge, auf der der Titel abgeschlossen wurde. Alles andere - gleich, kleiner,
 * unbekannt, unlesbar - laesst den Eintrag, wie er ist.
 */

const fortschritt = require("./fortschritt");
const { extractSeriesBounds, extractUnplayableEpisodes } = require("./discover");

/**
 * Wie viele Serien ein Durchgang prueft.
 *
 * <p>Jede kostet zwei Seitenaufrufe. Sechs sind die Zahl, mit der der Rechner
 * seit jeher faehrt; auf dem Telefon gilt dieselbe, damit "in sinnvollen
 * Abstaenden" auf beiden Geraeten dasselbe heisst.
 */
const PRO_LAUF = 6;

/** Und in welchem Abstand. */
const INTERVALL_MS = 6 * 60 * 60 * 1000;

/**
 * Die Serienseite ohne Staffel und Folge - dort stehen alle Staffeln.
 */
function serienSeiteUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    url.search = "";
    const pfad = url.pathname
      .replace(/\/(?:episode|folge)-\d+\/?$/i, "")
      .replace(/\/(?:staffel|season)-\d+\/?$/i, "");
    if (pfad === url.pathname) return "";
    url.pathname = pfad;
    return url.href;
  } catch {
    return "";
  }
}

/**
 * Die Staffeluebersicht zu einer Folgenadresse.
 *
 * <p>Auf der Episodenseite steht die Folgenliste nicht - dort ist nicht zu
 * sehen, dass die hinteren Nummern nur Hinweise auf eine zusammengefasste
 * Folge sind. Die Uebersicht weiss es.
 */
function staffelSeiteUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    url.search = "";
    const pfad = url.pathname.replace(/\/(?:episode|folge)-\d+\/?$/i, "");
    if (pfad === url.pathname || !/\/(?:staffel|season)-\d+$/i.test(pfad)) return "";
    url.pathname = pfad;
    return url.href;
  } catch {
    return "";
  }
}

/**
 * Welche Titel dieser Durchgang ansieht - und in welcher Reihenfolge.
 *
 * <p><b>Reihum, und nicht immer dieselben.</b> Hier stand einmal die
 * Sortierung nach {@code completedAt}: sechs Titel je Durchgang, und weil die
 * Reihenfolge sich nie aendert, waren es <em>dieselben</em> sechs - bei jedem
 * Durchgang, fuer immer. An einer echten Ablage nachgezaehlt: 18 abgeschlossene
 * Serien mit bekannter Grenze, sechs davon geprueft, zwoelf <b>nie</b>.
 *
 * <p>Sortiert wird deshalb nach dem letzten Blick auf den Titel. Wer noch nie
 * geprueft wurde, steht vorn (kein Stempel = Zeitpunkt null), danach der
 * aelteste Blick; bei Gleichstand entscheidet, was zuletzt zu Ende geschaut
 * wurde.
 *
 * <p>Ausgenommen bleibt ein laufendes Wiederansehen: dort steht der Eintrag auf
 * einer fruehen Folge, und das saehe fuer diese Pruefung aus wie eine Serie,
 * die auf halber Strecke stehengeblieben ist. Nachschub faellt beim naechsten
 * Durchgang auf, wenn der Durchlauf vorbei ist.
 */
function kandidaten(favoriten, hoechstens = PRO_LAUF) {
  const zuletztGeprueft = (favorit) => Date.parse(favorit?.newEpisodeCheckedAt || 0) || 0;
  return (Array.isArray(favoriten) ? favoriten : [])
    .filter((favorit) => favorit && favorit.completed && !favorit.rewatching)
    .filter((favorit) => (favorit.type || fortschritt.inferMediaType(favorit.url)) === "serie")
    .filter((favorit) => fortschritt.sanitizePositiveNumber(favorit.finalSeason)
      && fortschritt.episodeIdentity(favorit.url || ""))
    .sort((links, rechts) => (
      zuletztGeprueft(links) - zuletztGeprueft(rechts)
      || Date.parse(rechts.completedAt || 0) - Date.parse(links.completedAt || 0)
    ))
    .slice(0, Math.max(0, Number(hoechstens) || 0));
}

/**
 * Was die Anbieterseiten ueber den Umfang der Serie sagen.
 *
 * <p>Zwei Seiten, weil eine nicht reicht: die Serienseite nennt die Zahl der
 * Staffeln, die Folgenzahl der <em>letzten</em> steht erst auf deren eigener
 * Seite. Die Staffeluebersicht wird dabei doppelt gelesen - einmal auf die
 * hoechste Folgennummer ({@code extractSeriesBounds}), einmal auf die letzte
 * wirklich <em>abspielbare</em> ({@code extractUnplayableEpisodes}). Die
 * zweite geht vor: eine Nummer, die nur als "in E18 enthalten" dasteht, ist
 * kein Nachschub.
 *
 * @param seiten {{serienHtml: string, staffelHtml: string, staffel: number}}
 * @returns {{seasons: number, episodes: number}|null} - null, wenn sich nicht
 *          einmal die Staffelzahl lesen laesst. Eine leere, halbe oder kaputte
 *          Antwort landet genau hier und fuehrt zu keiner Aenderung.
 */
function umfangLesen(seiten) {
  const serienHtml = String(seiten?.serienHtml || "");
  if (!serienHtml) return null;
  const staffeln = fortschritt.sanitizePositiveNumber(extractSeriesBounds(serienHtml).seasons);
  if (!staffeln) return null;

  const staffelHtml = String(seiten?.staffelHtml || "");
  const inStaffel = staffelHtml ? extractSeriesBounds(staffelHtml, staffeln) : null;
  const gelistet = staffelHtml ? extractUnplayableEpisodes(staffelHtml) : null;
  const folgen = fortschritt.sanitizePositiveNumber(gelistet?.lastPlayable)
    || fortschritt.sanitizePositiveNumber(gelistet?.listed)
    || fortschritt.sanitizePositiveNumber(inStaffel?.episodes);
  return { seasons: staffeln, episodes: folgen };
}

/**
 * Die Entscheidung. Genau diese Funktion fragen Rechner und Telefon.
 *
 * <p>Sie fasst nichts an und redet mit niemandem: herein kommt der Eintrag und
 * was die Seiten hergaben, heraus kommt, was daraus folgt. Deshalb laesst sie
 * sich auf beiden Plattformen mit denselben Eingaben pruefen - und deshalb
 * kann es keine zwei Meinungen darueber geben, ob eine Folge Nachschub ist.
 *
 * <p><b>Die beiden Riegel.</b> Der neue Umfang muss strikt hinter der zuletzt
 * bekannten Grenze liegen (sonst waere jede halb geladene Seite ein Anlass) und
 * strikt hinter der Folge, auf der der Titel abgeschlossen wurde (sonst holte
 * eine gewachsene Staffelzahl einen Titel nach vorn, dessen Ende laengst
 * dahinter liegt). Die zweite Frage beantwortet
 * {@code hasNewEpisodeAfterCompletedFavorite} - dieselbe Funktion, mit der die
 * Seitengrenzen beim Schauen entscheiden.
 *
 * @param favorit der abgeschlossene Eintrag
 * @param umfang  {{seasons, episodes}} aus {@link umfangLesen}
 * @returns {{art: "nichts"|"neu", grund: string, aenderung?: object, label?: string}}
 */
function nachschubUrteil(favorit, umfang) {
  const nichts = (grund) => ({ art: "nichts", grund });
  if (!favorit || !umfang) return nichts("kein-umfang");
  if (!favorit.completed || favorit.rewatching) return nichts("nicht-abgeschlossen");

  const identity = fortschritt.episodeIdentity(favorit.url || "");
  if (!identity) return nichts("keine-folge");

  const bekannteStaffel = fortschritt.sanitizePositiveNumber(favorit.finalSeason);
  const bekannteFolge = fortschritt.sanitizePositiveNumber(favorit.finalEpisode);
  if (!bekannteStaffel) return nichts("grenze-unbekannt");

  const neueStaffeln = fortschritt.sanitizePositiveNumber(umfang.seasons);
  const neueFolgen = fortschritt.sanitizePositiveNumber(umfang.episodes);
  if (!neueStaffeln) return nichts("umfang-unlesbar");

  // Eine neue Staffel braucht keine Folgenzahl; eine neue Folge derselben
  // Staffel braucht beide Zahlen, sonst wuerde aus "unbekannt" ein Fortschritt.
  const neueStaffel = neueStaffeln > bekannteStaffel;
  const neueFolge = neueStaffeln === bekannteStaffel
    && bekannteFolge > 0
    && neueFolgen > bekannteFolge;
  if (!neueStaffel && !neueFolge) {
    return nichts(neueStaffeln < bekannteStaffel || (neueStaffeln === bekannteStaffel && neueFolgen < bekannteFolge)
      ? "umfang-geschrumpft"
      : "nichts-neues");
  }

  // Zweiter Riegel: liegt der neue Stand auch hinter der Folge, die hier
  // abgehakt wurde? Bei einer neuen Staffel ist die Folgenzahl der neuen
  // Staffel noch unbekannt oder klein (S2E1 < S1E12 waere sonst ein
  // Rueckschritt) - verglichen wird deshalb ueber die Staffel, und die ist
  // groesser. Die geteilte Regel macht genau diesen Unterschied.
  const schluessel = identity.key || "";
  const vorher = { key: schluessel, season: bekannteStaffel, episode: bekannteFolge };
  const jetzt = {
    key: schluessel,
    season: neueStaffeln,
    episode: neueStaffel ? Math.max(1, neueFolgen) : neueFolgen
  };
  if (!fortschritt.hasNewEpisodeAfterCompletedFavorite(favorit, vorher, jetzt)) {
    return nichts("nicht-hinter-dem-abschluss");
  }

  // Und wohin. Erste Wahl ist die geteilte Regel; sie zaehlt vom Stand des
  // Eintrags aus und nicht von der gespeicherten Grenze - bei einem Eintrag,
  // der auf einer frueheren Folge steht als seine Grenze behauptet, ist das
  // die richtigere Antwort.
  const ziel = fortschritt.nextEpisodeAfterFavoriteUrl(favorit, neueStaffeln, jetzt.episode)
    || (neueStaffel
      ? fortschritt.replaceEpisodeUrl(favorit.url, bekannteStaffel + 1, 1)
      : fortschritt.replaceEpisodeUrl(favorit.url, bekannteStaffel, bekannteFolge + 1));
  if (!ziel || ziel === favorit.url) return nichts("kein-ziel");

  const zielIdentity = fortschritt.episodeIdentity(ziel);
  const imRaum = Boolean(favorit.watchpartyRoom);
  const aenderung = {
    url: ziel,
    normalizedUrl: fortschritt.normalizeFavoriteUrl(ziel),
    season: zielIdentity?.season || favorit.season || 0,
    episode: zielIdentity?.episode || favorit.episode || 0,
    finalSeason: neueStaffeln,
    finalEpisode: neueFolgen || fortschritt.sanitizePositiveNumber(favorit.finalEpisode),
    completed: false,
    completedAt: "",
    completedManually: false,
    rewatching: false,
    episodeCompleted: false,
    continuePending: true,
    hideFromContinueWatching: false,
    progress: 0,
    position: 0,
    currentTime: 0,
    duration: 0
  };

  // Auf die Merkliste kommt nur, was einem selbst gehoert. Ein Raum-Eintrag
  // gehoert seiner Runde - die private Watchlist entsteht nie aus einer
  // Watchparty, und umgekehrt holt genau dieser Fund den archivierten
  // Raumtitel zurueck in "Gemeinsam weiterschauen".
  if (imRaum) aenderung.watchpartyArchived = false;
  else aenderung.favorite = true;

  const label = neueStaffel
    ? `Staffel ${aenderung.season} ist da`
    : `Folge ${aenderung.episode} ist da`;
  return { art: "neu", grund: neueStaffel ? "neue-staffel" : "neue-folge", aenderung, label };
}

/**
 * Ein Durchgang - die Verkabelung um die Entscheidung herum.
 *
 * <p>Was hier passiert, ist auf beiden Geraeten dasselbe und steht deshalb
 * auch nur einmal da: Kandidaten waehlen, je Kandidat zwei Seiten holen,
 * {@link nachschubUrteil} fragen, das Ergebnis auf den Eintrag legen.
 *
 * <p><b>Gestempelt wird der Versuch und nicht der Erfolg.</b> Ein Titel, dessen
 * Seite gerade nicht antwortet, stuende sonst beim naechsten Durchgang wieder
 * ganz vorn und verstopfte die Runde fuer alle anderen - genau die Verstopfung,
 * die die Sortierung in {@link kandidaten} beheben soll.
 *
 * @param holen     {(url) => Promise<{html: string}|null>} der Abruf der
 *                  Plattform. Ein Fehler darf hier geworfen werden; er wird
 *                  gefangen und zaehlt wie "keine Antwort".
 * @param protokoll optional, bekommt eine Zeile je Fund
 * @param jetzt     optional, fuer die Pruefungen
 */
function erstellen({ holen, protokoll = null, jetzt = () => new Date() } = {}) {
  async function seite(url) {
    if (!url) return "";
    try {
      const antwort = await holen(url);
      return String(antwort?.html || "");
    } catch {
      return "";
    }
  }

  async function umfangLaden(favorit) {
    const serienHtml = await seite(serienSeiteUrl(favorit.url));
    if (!serienHtml) return null;
    const staffeln = fortschritt.sanitizePositiveNumber(extractSeriesBounds(serienHtml).seasons);
    if (!staffeln) return null;
    // Die Folgenzahl der letzten Staffel steht auf deren eigener Seite.
    const letzteUrl = fortschritt.replaceEpisodeUrl(favorit.url, staffeln, 1);
    const staffelHtml = letzteUrl
      ? await seite(staffelSeiteUrl(letzteUrl) || letzteUrl)
      : "";
    return umfangLesen({ serienHtml, staffelHtml, staffel: staffeln });
  }

  /**
   * @returns {{geprueft: Array, gefunden: Array, geaendert: boolean}} -
   *          `gefunden` sind die Eintraege, die in <em>diesem</em> Durchgang
   *          neu dazugekommen sind. Nur ueber die wird gemeldet: `newEpisodeAt`
   *          bleibt am Eintrag stehen, bis der Titel geoeffnet wird, und von
   *          dort gemeldet kaeme dieselbe Meldung immer wieder.
   */
  async function lauf(favoriten, hoechstens = PRO_LAUF) {
    const liste = kandidaten(favoriten, hoechstens);
    const geprueft = [];
    const gefunden = [];
    let geaendert = false;

    for (const favorit of liste) {
      favorit.newEpisodeCheckedAt = jetzt().toISOString();
      geaendert = true;
      geprueft.push(favorit);

      const umfang = await umfangLaden(favorit);
      const urteil = nachschubUrteil(favorit, umfang);
      if (urteil.art !== "neu") continue;

      Object.assign(favorit, urteil.aenderung);
      favorit.newEpisodeAt = jetzt().toISOString();
      favorit.newEpisodeLabel = urteil.label;
      gefunden.push(favorit);
      if (protokoll) protokoll(`${favorit.title || favorit.url}: ${urteil.label}`);
    }
    return { geprueft, gefunden, geaendert };
  }

  return { lauf, umfangLaden };
}

module.exports = {
  erstellen,
  kandidaten,
  nachschubUrteil,
  umfangLesen,
  serienSeiteUrl,
  staffelSeiteUrl,
  PRO_LAUF,
  INTERVALL_MS
};
