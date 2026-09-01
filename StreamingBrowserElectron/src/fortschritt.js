"use strict";

/*
 * Wie ELFIX Fortschritt zaehlt.
 *
 * Diese Regeln standen bis hierher mitten in main.js und damit fest an
 * Electron. Android hatte deswegen keine Wahl, als sie ein zweites Mal in Java
 * zu schreiben - und dort zaehlte dann anderes: kein Prozentwert, keine
 * Mindestdauer, keine abgeschlossene Folge, sondern nur eine Adresse, die
 * weiterrueckte. Derselbe Abend ergab auf zwei Geraeten zwei verschiedene
 * Staende.
 *
 * Jetzt steht die Regel einmal. Der Hauptprozess holt sie von hier, und die
 * Android-App laedt genau diese Datei in ihren Kern (siehe
 * android/app/src/main/assets/kern/kern-host.js). Was hier steht, gilt also
 * ueberall - das ist der ganze Zweck der Uebung.
 *
 * Die Schwellen in Worten:
 *   90 %    ab hier gilt eine Folge als durchgeschaut
 *   2:30    Wiedergabe, die es zusaetzlich braucht - fuer einen neuen Eintrag,
 *           fuer Spruenge nach vorn und zusaetzlich zu den 90 %
 *   60 s    Wiedergabe, um auf eine *aeltere* Folge zurueckzugehen
 *   0:30    statt 2:30, solange der Eintrag zu einer Watchparty gehoert
 *
 * Das Modul kennt weder Electron noch Node: nur URL, Date und Math. Genau
 * deshalb laeuft es auch im WebView des Telefons.
 */

const providerModel = require("../shared/provider-model");
const youtube = require("./youtube");

// Ab diesem Anteil gilt eine Folge als durchgeschaut - allein reicht das aber
// nicht, es muss auch lange genug gelaufen sein.
const COMPLETED_PROGRESS_PERCENT = 90;
// Mindestdauer fuer einen neuen Eintrag und fuer einen Sprung nach vorn.
const MIN_WATCH_TIME_SECONDS = 2.5 * 60;
// Zurueck auf eine aeltere Folge braucht weniger, aber nicht nichts.
const BACKWARD_WATCH_TIME_SECONDS = 60;
// In einer Runde geht es schneller: dort fuehrt die Gruppe.
const WATCHPARTY_MIN_WATCH_SECONDS = 30;
// Wie nah zwei gleiche Vorgaenge liegen duerfen, um als einer zu zaehlen.
const AKTIVITAET_ZUSAMMEN_MS = 60 * 60 * 1000;

// Steht dieser Eintrag in "Weiterschauen"? Nur "gesehen" und "ausgeblendet"
// nehmen ihn heraus - nicht die Prozentzahl. Eine Folge, die weit vorne steht,
// aber mangels Wiedergabezeit nicht als gesehen zaehlt, ist weiter offen.
//
// Die eine Ausnahme zu "gesehen" ist das Wiederansehen: ein abgeschlossener
// Titel, der gerade wieder laeuft, steht in der Mediathek *und* hier. Siehe
// den Abschnitt "Wiederansehen" in medienStandVerbuchen.
function hasContinueProgressRecord(entry) {
  if (!entry) return false;
  // Ein Raum-Eintrag, den die Runde hinter sich hat: der Film ist zu Ende, oder
  // von der Serie gibt es gerade nichts Neues. Er bleibt liegen - Raum,
  // Mitglieder und Werk werden gebraucht, sobald eine Folge erscheint -, aber
  // er steht nicht mehr in "Gemeinsam weiterschauen". Private Eintraege tragen
  // den Merker nie: sie gehoeren keinem Raum.
  if (entry.watchpartyArchived) return false;
  if (entry.completed && !entry.rewatching) return false;
  if (entry.episodeCompleted || entry.hideFromContinueWatching) return false;
  if (entry.continuePending) return true;
  const current = sanitizePositiveNumber(entry.currentTime || entry.position);
  const duration = sanitizePositiveNumber(entry.duration);
  if (duration > 0 && current > 0 && current <= duration + 3) return true;
  const progress = sanitizeProgress(entry.progress);
  return Boolean(entry.lastWatchedAt || entry.openedAt) && progress > 0;
}

// Laeuft dieser abgeschlossene Titel gerade wieder? Eine Zeile, aber sie steht
// an fuenf Stellen - Karten, Listen, Diagnose - und soll ueberall dieselbe sein.
function istWiederansehen(entry) {
  return Boolean(entry && entry.completed && entry.rewatching);
}

// Wie oft der Titel ganz durch ist. Der erste Durchlauf steckt in `completed`,
// jeder weitere in `rewatchCount` - zusammen ergibt das die Zahl, die auf der
// Karte in der Mediathek steht ("3x gesehen").
//
// Ein laufendes Wiederansehen zaehlt ausdruecklich noch nicht mit: gezaehlt
// wird, was zu Ende gesehen wurde, nicht was gerade begonnen hat.
function durchlaeufe(entry) {
  const weitere = sanitizePositiveNumber(entry?.rewatchCount);
  if (!entry?.completed && !weitere) return 0;
  return 1 + weitere;
}

function isWholeMediaCompleted(entry, url, mediaEnded) {
  if (!mediaEnded) return false;
  const type = entry?.type || inferMediaType(url);
  if (type === "film") return true;
  if (type !== "serie") return !episodeIdentity(url);

  const identity = episodeIdentity(url);
  const finalSeason = sanitizePositiveNumber(entry?.finalSeason);
  const finalEpisode = sanitizePositiveNumber(entry?.finalEpisode);
  if (!identity || !finalSeason || !finalEpisode) return false;
  return identity.season === finalSeason && identity.episode === finalEpisode;
}

// Wie lange muss geschaut sein, bevor ein Eintrag auf eine neue Folge rueckt?
// In einer Runde reicht eine halbe Minute, sonst bleiben es zweieinhalb.
function uebernahmeSchwelle(existing) {
  return existing?.watchpartyRoom ? WATCHPARTY_MIN_WATCH_SECONDS : MIN_WATCH_TIME_SECONDS;
}

function shouldPromoteMediaProgress(existing, url, progressState) {
  if (!progressState?.hasMediaProgress) return true;
  if (progressState.isFilmProgress) return true;
  if (progressState.startsAtFirstEpisode) return true;
  // Laeuft diese Folge gerade in der Watchparty, ist sie gewollt - egal ob
  // vor oder zurueck. Sonst haengt der eigene Eintrag minutenlang hinter der
  // Gruppe her, obwohl alle dieselbe Folge schauen.
  //
  // Ob die Runde gerade fuehrt, weiss nur der Aufrufer - hier steht die Regel,
  // nicht die Verbindung. Der Hauptprozess fragt seine Watchparty, die
  // Android-App ihre; die Entscheidung faellt an derselben Stelle.
  if (progressState.watchpartyFuehrt) return true;
  if (!existing) return progressState.mediaEnded || progressState.watchedSeconds >= uebernahmeSchwelle(existing);

  const nextIdentity = episodeIdentity(url);
  const currentIdentity = episodeIdentity(existing.url);
  if (!nextIdentity || !currentIdentity || nextIdentity.key !== currentIdentity.key) {
    if (normalizeFavoriteUrl(existing.url) === normalizeFavoriteUrl(url)) {
      return hasContinueProgressRecord(existing) || progressState.mediaEnded || progressState.watchedSeconds >= uebernahmeSchwelle(existing);
    }
    return progressState.mediaEnded || progressState.watchedSeconds >= uebernahmeSchwelle(existing);
  }

  const comparison = compareEpisodeIdentity(nextIdentity, currentIdentity);
  if (comparison < 0) {
    const finalSeason = sanitizePositiveNumber(progressState.finalSeason);
    const finalEpisode = sanitizePositiveNumber(progressState.finalEpisode);
    const finalIdentity = finalSeason && finalEpisode
      ? { key: nextIdentity.key, season: finalSeason, episode: finalEpisode }
      : null;
    const existingIsPastKnownFinal = finalIdentity
      && currentIdentity.key === finalIdentity.key
      && compareEpisodeIdentity(currentIdentity, finalIdentity) > 0;
    const nextIsInsideKnownSeries = finalIdentity
      && compareEpisodeIdentity(nextIdentity, finalIdentity) <= 0;
    if (existingIsPastKnownFinal && nextIsInsideKnownSeries) {
      return progressState.mediaEnded || progressState.watchedSeconds >= uebernahmeSchwelle(existing);
    }
    // Ohne Watchparty braucht es bewusstes Schauen. Frueher wurde eine aeltere Folge
    // grundsaetzlich nie uebernommen: der Eintrag liess sich nur ueber Umwege
    // zurueckstellen.
    return progressState.mediaEnded || progressState.watchedSeconds >= BACKWARD_WATCH_TIME_SECONDS;
  }
  if (comparison === 0) {
    return hasContinueProgressRecord(existing) || progressState.mediaEnded || progressState.watchedSeconds >= uebernahmeSchwelle(existing);
  }
  return progressState.mediaEnded || progressState.watchedSeconds >= uebernahmeSchwelle(existing);
}

function incrementEpisodeUrl(value) {
  try {
    const url = new URL(value);
    let changed = false;
    url.pathname = url.pathname.replace(/\/(episode|folge)-(\d+)(?=\/?$)/i, (_match, label, episode) => {
      changed = true;
      return `/${label}-${Number(episode) + 1}`;
    });
    return changed ? url.href : "";
  } catch {
    return "";
  }
}

function appendCompletedEpisode(entry, identity, url, completedAt) {
  if (!entry || !identity) return;
  const completedEpisodes = Array.isArray(entry.completedEpisodes) ? entry.completedEpisodes : [];
  const key = `${identity.key}:s${identity.season}:e${identity.episode}`;
  if (!completedEpisodes.some((item) => item?.key === key)) {
    completedEpisodes.push({
      key,
      season: sanitizePositiveNumber(identity.season),
      episode: sanitizePositiveNumber(identity.episode),
      url,
      completedAt
    });
  }
  entry.completedEpisodes = completedEpisodes.slice(-500);
}

function compareEpisodeIdentity(left, right) {
  const leftSeason = sanitizePositiveNumber(left?.season);
  const rightSeason = sanitizePositiveNumber(right?.season);
  if (leftSeason !== rightSeason) return leftSeason - rightSeason;
  return sanitizePositiveNumber(left?.episode) - sanitizePositiveNumber(right?.episode);
}

function isFirstEpisodeIdentity(identity) {
  return Boolean(identity && sanitizePositiveNumber(identity.episode) === 1 && sanitizePositiveNumber(identity.season) <= 1);
}

function normalizeMediaType(value) {
  const type = String(value || "").toLowerCase();
  if (type === "film" || type === "movie") return "film";
  if (type === "serie" || type === "series" || type === "anime") return "serie";
  return "";
}

function mediaTypeForProgressUrl(url, typeHint = "") {
  const hinted = normalizeMediaType(typeHint);
  const identity = episodeIdentity(url);
  if (identity && hinted === "film" && !isExplicitFilmUrl(url)) return "serie";
  return hinted || inferMediaType(url);
}

function isExplicitFilmUrl(value) {
  try {
    const parts = new URL(value).pathname.split("/").filter(Boolean).map((part) => part.toLowerCase());
    return parts.some((part) => ["film", "filme", "movie", "movies"].includes(part) || /^(?:film|movie)-\d+$/.test(part));
  } catch {
    return false;
  }
}

// Wie lange gesehen werden muss, damit eine Folge ueber 90 Prozent als
// geschaut gilt: 2:30 Minuten - bei kuerzeren Folgen entsprechend weniger,
// sonst liesse sich ein Zehnminueter nie abschliessen.
function endeSchwelle(duration) {
  const laufzeit = sanitizePositiveNumber(duration);
  if (!laufzeit) return MIN_WATCH_TIME_SECONDS;
  return Math.min(MIN_WATCH_TIME_SECONDS, laufzeit * 0.9);
}

function mediaPromotionBlockReason(existing, url, state) {
  const nextIdentity = episodeIdentity(url);
  const currentIdentity = episodeIdentity(existing?.url);
  if (nextIdentity && currentIdentity && nextIdentity.key === currentIdentity.key && compareEpisodeIdentity(nextIdentity, currentIdentity) < 0) {
    const finalSeason = sanitizePositiveNumber(state.finalSeason);
    const finalEpisode = sanitizePositiveNumber(state.finalEpisode);
    const finalIdentity = finalSeason && finalEpisode
      ? { key: nextIdentity.key, season: finalSeason, episode: finalEpisode }
      : null;
    if (finalIdentity
      && compareEpisodeIdentity(currentIdentity, finalIdentity) > 0
      && compareEpisodeIdentity(nextIdentity, finalIdentity) <= 0
      && !state.mediaEnded
      && state.watchedSeconds < MIN_WATCH_TIME_SECONDS) {
      return `repariert Fake-Stand erst nach 2:30 Minuten Wiedergabe (${Math.round(state.watchedSeconds)}s / ${MIN_WATCH_TIME_SECONDS}s)`;
    }
    return `ältere Folge bleibt nur im Verlauf (${favoriteProgressTargetLabel(url)} < ${favoriteProgressTargetLabel(existing.url)})`;
  }
  if (!state.mediaEnded && state.watchedSeconds < MIN_WATCH_TIME_SECONDS) {
    return `unter 2:30 Minuten Wiedergabe (${Math.round(state.watchedSeconds)}s / ${MIN_WATCH_TIME_SECONDS}s)`;
  }
  return "nicht als neuer Hauptstand übernommen";
}

function mediaActivityLabel(url, entry) {
  const label = favoriteProgressTargetLabel(url);
  if (label !== "neue Folge") return label;
  return entry?.type === "film" ? "Film geöffnet" : "Geöffnet";
}

// Der Serientitel ohne Folgenangabe. Daran haengt der Schluessel, unter dem
// ein Titel in einer Watchparty gefuehrt wird - er muss ueber alle Folgen
// hinweg derselbe bleiben.
//
// Frueher wurde "Staffel 1 Folge 2" nur weggeschnitten, wenn ein Trennzeichen
// davorstand. S.to schreibt es ohne ("Titel Staffel 1 Folge 2"), also bekam
// dort jede Folge einen eigenen Schluessel: der Fortschritt passte zu keinem
// Raum-Eintrag mehr und nach einem Folgenwechsel war die Runde still.
// Der Serientitel eines Eintrags, in dieser Reihenfolge:
//
//   1. was die Seite sagt - von der Folgenangabe befreit. "Staffel 3 Folge
//      21 von Attack on Titan | AniWorld.to" ist eine Folgenueberschrift und
//      kein Serientitel; als Titel eines Eintrags waere sie beim naechsten
//      Wechsel schon wieder falsch.
//   2. der Serien-Slug der Adresse. Der wechselt mit der Folge nicht.
//   3. der Anbietername - damit ueberhaupt etwas dasteht.
//
// Ohne Punkt 3 wuerde cleanBaseMediaTitle() hier "Favorit" liefern: es gibt
// nie eine leere Zeichenkette zurueck, und damit kaeme der Ersatz nie an.
function serienTitel(rohTitel, url, ersatz = "") {
  const roh = String(rohTitel || "").trim();
  if (roh) return cleanBaseMediaTitle(roh, url);
  const ausAdresse = titleFromPath(url);
  return ausAdresse ? cleanTitle(ausAdresse) : cleanTitle(ersatz);
}

function cleanBaseMediaTitle(title, url) {
  const raw = cleanTitle(title || titleFromPath(url));
  const value = raw
    // Zuerst den Seitennamen hinter dem letzten senkrechten Strich: sonst
    // bleibt "| S.to" stehen und zaehlt spaeter als Teil des Titels.
    .replace(/\s*\|\s*[^|]{1,40}$/, "")
    // Die Angabe kann auch vorn stehen: "Staffel 1 Folge 2 von Titel".
    .replace(/^(?:staffel|season)\s*\d+\s*[-–·|:]?\s*(?:folge|episode|ep\.?)\s*\d+\s*(?:von|of)?\s*[-–·|:]?\s*/i, "")
    .replace(/^s\s*\d{1,3}\s*[.\- ]?\s*e\s*\d{1,4}\s*(?:von|of)?\s*[-–·|:]?\s*/i, "")
    // Und alles ab der Folgenangabe am Ende - mit oder ohne Trennzeichen.
    .replace(/\s*[-–·|:]?\s*(?:staffel|season)\s*\d+\s*[-–·|:]?\s*(?:folge|episode|ep\.?)\s*\d+.*$/i, "")
    .replace(/\s*[-–·|:]?\s*(?:folge|episode|ep\.?)\s*\d+.*$/i, "")
    .replace(/\s*[-–·|:]?\s*(?:staffel|season)\s*\d+\s*$/i, "")
    // Kurzformen: "S1E2", "S01 E02", "1x02".
    .replace(/\s*[-–·|:]?\s*\bs\s*\d{1,3}\s*[.\- ]?\s*e\s*\d{1,4}\b.*$/i, "")
    .replace(/\s*[-–·|:]?\s*\b\d{1,3}x\d{1,4}\b.*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/[\s\-–·|:]+$/, "")
    .trim();
  // Bleibt nichts uebrig, taugt der letzte Pfadteil nicht als Ersatz: bei
  // "/staffel-1/episode-2" waere das "Episode 2" - fuer jede Serie dasselbe.
  // Der Serien-Slug aus der Adresse ist die verlaessliche Rueckfallebene.
  return cleanTitle(value || titelAusSlug(mediaSlugFromUrl(url)) || raw);
}

// "the-office" -> "The Office". Nur fuer den Notfall, wenn der Seitentitel
// nichts hergibt.
function titelAusSlug(slug) {
  return String(slug || "")
    .split(":")[0]
    .split(/[-_]+/)
    .filter(Boolean)
    .map((teil) => teil.charAt(0).toUpperCase() + teil.slice(1))
    .join(" ")
    .trim();
}

function isTrackableMediaUrl(url, provider) {
  // Shorts werden gar nicht erst gemerkt. Sie dauern Sekunden und laufen in
  // einer Schleife - "Weiterschauen" heisst aber, etwas Angefangenes zu Ende
  // zu bringen. Nach einer Viertelstunde Wischen stuenden dort dreissig
  // Eintraege, und alles Echte waere darunter begraben.
  if (youtube.istShortsUrl(url)) return false;
  if (isFavoriteProgressUrl(url, provider)) return true;
  const slug = mediaSlugFromUrl(url);
  if (!slug) return false;
  try {
    const pathname = new URL(url).pathname;
    return !/(\/|^)(search|suche|login|register|profile|account|settings|popular|beliebt)(\/|$)/i.test(pathname);
  } catch {
    return true;
  }
}

// Laeuft auf dieser Adresse ueberhaupt etwas?
//
// isTrackableMediaUrl() beantwortet eine andere Frage: dort geht es darum, ob
// ein Fortschritt gemerkt werden darf, und das gilt schon fuer die Serienseite.
// Hier geht es um die Einblendungen im Bild - und die gehoeren nur dorthin, wo
// wirklich ein Video steht: eine Folge, ein Film, ein YouTube-Video.
//
// Ohne diese Frage entschied allein die Seite: "oberstes Dokument und kein
// grosser Rahmen" trifft auf jede Hosterseite zu - aber eben auch auf die
// Startseite eines Anbieters, die weder Video noch Rahmen hat. Genau dort stand
// der Autoplay-Schalter dann ueber der Serienuebersicht.
function istAbspielseite(url) {
  if (!providerModel.isHttpUrl(url)) return false;
  // Shorts laufen in einer Schleife - eine naechste Folge gibt es dort nicht.
  if (youtube.istShortsUrl(url)) return false;
  if (youtube.istYoutubeUrl(url)) return Boolean(youtube.videoKennung(url));
  return Boolean(episodeIdentity(url)) || isExplicitFilmUrl(url);
}

function isValidMediaProgress(progress) {
  const currentTime = Number(progress?.currentTime);
  const duration = Number(progress?.duration);
  return Number.isFinite(currentTime)
    && Number.isFinite(duration)
    && duration > 0
    && currentTime >= 0
    && currentTime <= duration + 3;
}

function mediaProgressPercent(currentTime, duration) {
  const current = Number(currentTime);
  const total = Number(duration);
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}

function replaceEpisodeUrl(value, season, episode) {
  try {
    const url = new URL(value);
    let hasSeason = false;
    let hasEpisode = false;
    url.pathname = url.pathname
      .replace(/\/(staffel|season)-\d+(?=\/|$)/i, (_match, label) => {
        hasSeason = true;
        return `/${label}-${season}`;
      })
      .replace(/\/(episode|folge)-\d+(?=\/|$)/i, (_match, label) => {
        hasEpisode = true;
        return `/${label}-${episode}`;
      });
    return hasSeason && hasEpisode ? url.href : "";
  } catch {
    return "";
  }
}

function firstEpisodeUrl(value) {
  const fullEpisodeUrl = replaceEpisodeUrl(value, 1, 1);
  if (fullEpisodeUrl) return fullEpisodeUrl;

  try {
    const url = new URL(value);
    let changed = false;
    url.pathname = url.pathname.replace(/\/(episode|folge)-\d+(?=\/|$)/i, (_match, label) => {
      changed = true;
      return `/${label}-1`;
    });
    return changed ? url.href : "";
  } catch {
    return "";
  }
}

function isSequentialFavoriteProgress(previous, next) {
  if (!previous || !next || previous.key !== next.key) return false;
  if (previous.season === next.season && next.episode === previous.episode + 1) return true;
  return previous.season > 0
    && next.season === previous.season + 1
    && previous.episode > 1
    && next.episode === 1;
}

function favoriteProgressTargetLabel(url) {
  const identity = episodeIdentity(url);
  if (!identity) return "neue Folge";
  if (identity.season > 0) return `Staffel ${identity.season} Folge ${identity.episode}`;
  return `Folge ${identity.episode}`;
}

function episodeIdentity(value) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    if (!parts.length) return null;

    const markers = ["stream", "serie", "film", "filme", "movie", "movies", "title"];
    let mediaSlug = "";
    for (let index = 0; index < parts.length - 1; index += 1) {
      if (markers.includes(parts[index].toLowerCase())) {
        mediaSlug = parts[index + 1].toLowerCase();
        break;
      }
    }
    if (!mediaSlug) return null;

    let season = 0;
    let episode = 0;
    for (const part of parts) {
      const seasonMatch = part.match(/^(?:staffel|season)-(\d+)$/i);
      if (seasonMatch) season = Number(seasonMatch[1]);
      const episodeMatch = part.match(/^(?:episode|folge)-(\d+)$/i);
      if (episodeMatch) episode = Number(episodeMatch[1]);
    }
    if (!Number.isFinite(episode) || episode <= 0) return null;
    return {
      key: `${stripWww(url.hostname)}:${mediaSlug}`,
      season,
      episode
    };
  } catch {
    return null;
  }
}

// Die kanonische Serienidentitaet einer Adresse: Wirt und Serien-Slug.
//
// episodeIdentity() kann das auch, verlangt dafuer aber eine Folgennummer -
// und genau die fehlt der Serienseite, der Staffeluebersicht und jeder
// Filmadresse. Fuer die Frage "sind das dieselben zwei Werke?" ist das die
// falsche Huerde: eine Staffelseite ist nicht identitaetslos, sie hat bloss
// keine Folge. Deshalb hier eine Kennung, die auch ohne Folge trägt.
//
// Wirt und Slug zusammen, nicht der Slug allein: derselbe Slug auf zwei
// Anbietern sind zwei Eintraege mit zwei Staenden, und "attack-on-titan" auf
// s.to ist nicht der Eintrag von aniworld.to.
function serienKennungAusUrl(value) {
  const slug = mediaSlugFromUrl(value);
  if (!slug) return "";
  try {
    return `${stripWww(new URL(value).hostname)}:${slug}`;
  } catch {
    return "";
  }
}

// Gehoeren diese Seitenangaben zu dieser Adresse?
//
// Der Fall, der das noetig macht: readPageMetadata() wird erst nach einer
// Reihe von Awaits abgeschickt. Wechselt die Folge in diesem Fenster, liest
// das Skript die *neue* Seite, waehrend der Aufrufer noch die *alte* Adresse
// in der Hand haelt. Wer beides zusammenlegt, schreibt den Titel, das
// Titelbild und die Serienlaenge einer fremden Serie auf einen Eintrag.
//
// Fehlt der Stempel - altes Ergebnis, fehlgeschlagener Abruf, ein Kern, der
// die Angabe noch nicht mitschickt -, wird nicht widersprochen: es gibt dann
// nichts zu pruefen, und ein Nein waere hier so falsch wie ein Ja.
function seitendatenPassenZu(meta, url) {
  const stempel = String(meta?.seiteUrl || "");
  if (!stempel) return true;
  const gelesen = serienKennungAusUrl(stempel);
  const erwartet = serienKennungAusUrl(url);
  // Adressen ohne erkennbaren Slug (Startseite, Suche) lassen sich nicht
  // vergleichen. Dann entscheidet der Wirt allein.
  if (!gelesen || !erwartet) return stripWww(hostOf(stempel)) === stripWww(hostOf(url));
  return gelesen === erwartet;
}

function hostOf(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

// Seitenangaben, die dieser Adresse nicht widersprechen.
//
// Passt der Stempel, kommt alles durch. Passt er nicht, faellt genau das weg,
// was die Identitaet eines Eintrags ausmacht - Titel, Titelbild und die
// Grenzen der Serie. Uebrig bleibt, was von der Adresse unabhaengig ist.
//
// Weggelassen und nicht ersetzt: ein Eintrag, der schon einen bestaetigten
// Titel hat, behaelt ihn. Lieber eine Angabe zu wenig als die einer fremden
// Serie - der Nutzer sieht sonst unter dem Bild von Attack on Titan die
// Beschreibung eines Werks, das er nie geoeffnet hat.
function gepruefteSeitendaten(meta, url) {
  if (!meta || seitendatenPassenZu(meta, url)) return meta || {};
  const {
    title: _titel,
    thumbnail: _bild,
    finalSeason: _staffel,
    finalEpisode: _folge,
    finalEpisodeTrimmed: _gekuerzt,
    seasonLastEpisode: _letzte,
    unplayableSeason: _sperrStaffel,
    unplayableEpisodes: _gesperrt,
    ...rest
  } = meta;
  return rest;
}

function isFavoriteProgressUrl(url, provider) {
  if (!providerModel.isHttpUrl(url)) return false;
  try {
    const parsed = new URL(url);
    const pathName = parsed.pathname.replace(/\/+$/, "") || "/";
    if (pathName === "/" || /(\/|^)(search|suche|login|register|logout|settings|profile|account)(\/|$)/i.test(pathName)) return false;
    return isAllowedResultHost(parsed.hostname, providerModel.hostFromUrl(provider.startUrl), provider);
  } catch {
    return false;
  }
}

function isAllowedResultHost(targetHost, baseHost, provider) {
  const target = stripWww(targetHost);
  const base = stripWww(baseHost);
  const providerHost = stripWww(providerModel.hostFromUrl(provider?.startUrl || ""));
  const name = String(provider?.name || "").toLowerCase();
  if (target === base || target === providerHost) return true;
  if (target.endsWith(`.${base}`) || base.endsWith(`.${target}`)) return true;
  if (providerHost && (target.endsWith(`.${providerHost}`) || providerHost.endsWith(`.${target}`))) return true;
  if (name.includes("aniworld")) return target.includes("aniworld");
  if (name === "s.to" || name.includes("s.to")) return target === "s.to" || target.endsWith(".s.to") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(target);
  if (name.includes("filmo")) return target.includes("filmo");
  return false;
}

function stripWww(hostname) {
  return String(hostname || "").toLowerCase().replace(/^www\./, "");
}

// Ein Titel aus der Adresse - fuer den Fall, dass die Seite keinen hergibt.
//
// Der letzte Pfadteil war dafuer die falsche Wahl: bei
// "/attack-on-titan/staffel-3/episode-21" ist das "Episode 21", und das
// heisst bei jeder Serie gleich. Als Rueckfall fuer einen *Serien*titel ist
// der Serien-Slug das einzig Brauchbare; nur wo die Adresse keinen fuehrt
// (YouTube etwa), bleibt es beim letzten Pfadteil.
function titleFromPath(href) {
  const ausSlug = titelAusSlug(mediaSlugFromUrl(href));
  if (ausSlug) return ausSlug;
  try {
    const parts = new URL(href).pathname.split("/").filter(Boolean);
    const slug = parts[parts.length - 1] || "";
    return slug
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return "";
  }
}

function normalizeActivity(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-120).map((item) => ({
    at: String(item?.at || ""),
    url: String(item?.url || ""),
    label: String(item?.label || ""),
    season: sanitizePositiveNumber(item?.season),
    episode: sanitizePositiveNumber(item?.episode)
  })).filter((item) => item.at || item.url || item.label);
}

function normalizeCompletedEpisodes(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-500).map((item) => ({
    key: String(item?.key || ""),
    season: sanitizePositiveNumber(item?.season),
    episode: sanitizePositiveNumber(item?.episode),
    url: String(item?.url || ""),
    completedAt: String(item?.completedAt || "")
  })).filter((item) => item.key || item.url || item.episode);
}

function cleanTitle(value) {
  const title = String(value || "").replace(/\s+/g, " ").trim();
  return title || "Favorit";
}

function sanitizePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function sanitizeProgress(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function isCompletedProgress(value) {
  return sanitizeProgress(value) >= COMPLETED_PROGRESS_PERCENT;
}

function inferMediaType(value) {
  try {
    const parts = new URL(value).pathname.split("/").map((part) => part.toLowerCase());
    if (parts.some((part) => ["film", "filme", "movie", "movies"].includes(part))) return "film";
    if (parts.some((part) => ["serie", "series", "anime"].includes(part))) return "serie";
  } catch {
    // Ignore malformed URLs.
  }
  return "unknown";
}

function mediaSlugFromUrl(value) {
  try {
    const parts = new URL(value).pathname.split("/").filter(Boolean);
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index].toLowerCase();
      if (part === "anime" && parts[index + 1]?.toLowerCase() === "stream" && parts[index + 2]) {
        const slug = parts[index + 2].toLowerCase();
        const filmIndex = parts.findIndex((item, itemIndex) => itemIndex > index + 2 && /^(?:film|filme|movie|movies)$/i.test(item));
        if (filmIndex >= 0) {
          return `${slug}:filme:${(parts[filmIndex + 1] || "index").toLowerCase()}`;
        }
        const filmPart = parts.find((item, itemIndex) => itemIndex > index + 2 && /^(?:film|movie)-\d+$/i.test(item));
        return filmPart ? `${slug}:filme:${filmPart.toLowerCase()}` : slug;
      }
      if ((part === "serie" || part === "series") && parts[index + 1]?.toLowerCase() === "stream" && parts[index + 2]) {
        return parts[index + 2].toLowerCase();
      }
      if (["stream", "serie", "series", "film", "filme", "movie", "movies", "title", "watch"].includes(part) && parts[index + 1]) {
        return parts[index + 1].toLowerCase();
      }
    }
    return "";
  } catch {
    return "";
  }
}

function normalizeFavoriteUrl(value) {
  // YouTube haengt an dieselbe Adresse je nach Herkunft "list", "index", "pp"
  // oder "si" an. Ohne diese Zeile ist jede Variante ein eigener Eintrag mit
  // eigenem Stand - und in "Weiterschauen" landete dann oft der frische mit
  // null Prozent. Das sah aus wie "faengt von vorne an".
  const alsYoutube = youtube.normalisiereYoutubeUrl(value);
  if (alsYoutube) return alsYoutube;

  try {
    const url = new URL(value);
    url.hash = "";
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.href;
  } catch {
    return String(value || "").replace(/#.*$/, "").replace(/\/+$/, "");
  }
}


// Eine Kennung fuer einen neuen Eintrag. crypto.randomUUID gibt es im
// Hauptprozess wie im WebView; nur bei sehr alten Fassungen fehlt es.
function kennungErzeugen() {
  const kryptо = globalThis.crypto;
  if (kryptо && typeof kryptо.randomUUID === "function") return kryptо.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

// Der zuletzt geoeffnete Eintrag steht vorn. Frueher schrieb das direkt in die
// Ablage; jetzt gibt es die geaenderte Liste zurueck.
function nachVornHolen(liste, eintrag) {
  if (!eintrag?.id) return liste;
  const index = liste.findIndex((item) => item.id === eintrag.id);
  eintrag.openedAt = new Date().toISOString();
  if (index <= 0) return liste;
  const kopie = liste.slice();
  kopie.splice(index, 1);
  kopie.unshift(eintrag);
  return kopie;
}

function absoluteHttpUrl(href, baseUrl) {
  try {
    const url = new URL(String(href || ""), baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

// Die Seite meldet die nicht abspielbaren Folgen der gerade gezeigten Staffel.
function unplayableEpisodeSet(meta, season) {
  const nummern = Array.isArray(meta?.unplayableEpisodes) ? meta.unplayableEpisodes : [];
  const gemeldeteStaffel = sanitizePositiveNumber(meta?.unplayableSeason);
  if (!nummern.length) return new Set();
  if (season && gemeldeteStaffel && season !== gemeldeteStaffel) return new Set();
  return new Set(nummern.map((wert) => Number(wert)).filter((wert) => Number.isFinite(wert) && wert > 0));
}

/**
 * Darf ELFIX dieser Adresse als "naechste Folge" folgen?
 *
 * <p>Der Knopf und der Zaehler leben in der Anbieterseite - im Vollbild deckt
 * deren Fenster alles zu, ein anderer Platz waere unsichtbar. Ihr Klick kommt
 * ueber eine Konsolenzeile zurueck, den einzigen Kanal, den es in einer fremden
 * Seite ohne Preload gibt. Genau das ist aber auch die Schwaeche: in eine
 * Konsolenzeile kann jedes Skript der Seite schreiben, und was dort steht, war
 * bis hierher Anweisung genug. Ein Ziel aus der Seite wird deshalb geprueft,
 * bevor ihm jemand folgt.
 *
 * <p>Geprueft wird gegen die Folge, bei der wir stehen - und wenn das
 * Hauptfenster gerade beim Hoster ist, gegen den Eintrag, der dazu gehoert.
 * Es muss dieselbe Serie sein und weiter vorn liegen als die laufende Folge.
 *
 * @param zielUrl    was die Seite meldet
 * @param currentUrl wo das Hauptfenster gerade steht
 * @param entry      der Eintrag, der gerade laeuft (darf fehlen)
 */
function darfNaechsteFolgeSein(zielUrl, currentUrl, entry = null) {
  const ziel = episodeIdentity(zielUrl);
  if (!ziel) return false;
  const bezug = episodeIdentity(currentUrl) || episodeIdentity(entry?.url || "");
  if (!bezug) return false;
  return ziel.key === bezug.key && compareEpisodeIdentity(ziel, bezug) > 0;
}

function nextEpisodeContinueUrl(currentUrl, preferredUrl = "", entry = null, meta = null) {
  const currentIdentity = episodeIdentity(currentUrl);
  const resolvedPreferred = absoluteHttpUrl(preferredUrl, currentUrl);
  const preferredIdentity = episodeIdentity(resolvedPreferred);
  const gesperrt = unplayableEpisodeSet(meta, currentIdentity?.season);
  if (resolvedPreferred
    && preferredIdentity
    && currentIdentity
    && preferredIdentity.key === currentIdentity.key
    && !gesperrt.has(preferredIdentity.episode)
    && compareEpisodeIdentity(preferredIdentity, currentIdentity) > 0) {
    return resolvedPreferred;
  }
  if (!currentIdentity) return "";
  const finalSeason = sanitizePositiveNumber(entry?.finalSeason);
  const finalEpisode = sanitizePositiveNumber(entry?.finalEpisode);
  if (!finalSeason) return "";
  if (currentIdentity.season > finalSeason) return "";

  // In der letzten Staffel endet die Serie mit der letzten Folge. In frueheren
  // Staffeln endet nur die Staffel - danach geht es mit Folge 1 der naechsten
  // weiter. Fehlt die Folgenzahl der laufenden Staffel noch, wird einfach
  // hochgezaehlt; die Staffeluebersicht liefert sie kurz darauf nach.
  const istLetzteStaffel = currentIdentity.season === finalSeason;
  // Nur in der letzten Staffel entscheidet diese Zahl darueber, ob ueberhaupt
  // noch etwas kommt. Vorher ist sie ohne Belang: wer in Staffel 1 von 25
  // steht, hat sicher eine naechste Folge. Frueher blockierte sie jedes
  // Nachruecken, solange die letzte Staffel nie geoeffnet worden war.
  if (istLetzteStaffel && !finalEpisode) return "";
  const staffelEnde = istLetzteStaffel
    ? finalEpisode
    : sanitizePositiveNumber(meta?.seasonLastEpisode);

  // Zusammengefasste Folgen ueberspringen: steht die naechste Nummer nur als
  // Hinweis in der Liste ("[In E10 enthalten]"), gibt es dort nichts
  // abzuspielen - also weiter bis zur naechsten echten Folge.
  let naechste = currentIdentity.episode + 1;
  while (gesperrt.has(naechste) && (!staffelEnde || naechste <= staffelEnde)) naechste += 1;

  if (!staffelEnde || naechste <= staffelEnde) {
    return replaceEpisodeUrl(currentUrl, currentIdentity.season, naechste) || incrementEpisodeUrl(currentUrl);
  }
  if (currentIdentity.season < finalSeason) {
    return replaceEpisodeUrl(currentUrl, currentIdentity.season + 1, 1);
  }
  return "";
}

/**
 * Welche Folge <em>vor</em> dieser kommt.
 *
 * <p>Das Gegenstueck zu {@link nextEpisodeContinueUrl}, und bewusst die
 * kuerzere Regel. Vorwaerts muss geraten werden, wo die Serie aufhoert -
 * rueckwaerts steht die Grenze fest: Folge 1. Was es dazwischen zu wissen gibt,
 * steht schon in den Angaben der Seite, naemlich welche Nummern sich nicht
 * abspielen lassen ("[In E10 enthalten]"); die werden hier ebenso
 * uebersprungen wie in der anderen Richtung.
 *
 * <p>Ueber die Staffelgrenze geht es nicht zurueck. Wie viele Folgen die
 * <em>vorige</em> Staffel hat, sagt keine der Auskuenfte, die hier vorliegen -
 * {@code seasonLastEpisode} gilt fuer die laufende. Eine Zahl zu raten hiesse,
 * auf einer Adresse zu landen, die es nicht gibt; die ehrliche Antwort ist
 * "keine".
 *
 * <p>Der Torwaechter {@link darfNaechsteFolgeSein} hat hier kein Gegenstueck
 * und braucht auch keins: die Adresse entsteht aus der laufenden, nicht aus
 * etwas, das die Anbieterseite gemeldet hat. Geprueft wird, was von aussen
 * kommt - und von aussen kommt hier nichts.
 */
function vorigeEpisodeUrl(currentUrl, meta = null) {
  const identity = episodeIdentity(currentUrl);
  if (!identity) return "";
  const gesperrt = unplayableEpisodeSet(meta, identity.season);
  let vorige = identity.episode - 1;
  while (vorige >= 1 && gesperrt.has(vorige)) vorige -= 1;
  if (vorige < 1) return "";
  return replaceEpisodeUrl(currentUrl, identity.season, vorige)
    || setzeFolgenNummer(currentUrl, vorige);
}

/**
 * Dieselbe Adresse mit einer anderen Folgennummer - auch ohne Staffel im Pfad.
 *
 * <p>{@link replaceEpisodeUrl} verlangt beides, Staffel und Folge, und
 * antwortet sonst mit nichts. Fuer eine Adresse, die nur {@code /folge-7}
 * traegt, ist das der Rueckfall - dieselbe Stelle, an der die andere Richtung
 * {@link incrementEpisodeUrl} benutzt.
 */
function setzeFolgenNummer(value, episode) {
  try {
    const url = new URL(value);
    let changed = false;
    url.pathname = url.pathname.replace(/\/(episode|folge)-\d+(?=\/?$)/i, (_match, label) => {
      changed = true;
      return `/${label}-${episode}`;
    });
    return changed ? url.href : "";
  } catch {
    return "";
  }
}

function appendMediaActivity(entry, url, label) {
  if (!entry) return;
  const activity = Array.isArray(entry.activity) ? entry.activity : [];
  const identity = episodeIdentity(url);
  const text = label || mediaActivityLabel(url, entry);
  const letzter = activity[activity.length - 1];

  // Derselbe Vorgang in kurzer Folge ist kein neuer Eintrag. Der Fortschritt
  // meldet sich im Sekundentakt, und der Verlauf lief mit Dutzenden gleichen
  // Zeilen voll - dieselbe Folge, dieselbe Minute. Stattdessen wird der
  // vorhandene Eintrag weitergeschrieben.
  if (letzter
    && letzter.url === url
    && letzter.label === text
    && Date.now() - (Date.parse(letzter.at) || 0) < AKTIVITAET_ZUSAMMEN_MS) {
    letzter.at = new Date().toISOString();
    return;
  }

  activity.push({
    at: new Date().toISOString(),
    url,
    label: text,
    season: identity?.season || entry.season || 0,
    episode: identity?.episode || entry.episode || 0
  });
  entry.activity = activity.slice(-120);
}

function hasNewEpisodeAfterCompletedFavorite(favorite, previousBounds, nextBounds) {
  const completedIdentity = episodeIdentity(favorite?.url || "");
  if (!completedIdentity || !nextBounds?.season || !nextBounds?.episode) return false;
  if (nextBounds.key && completedIdentity.key && nextBounds.key !== completedIdentity.key) return false;
  if (compareEpisodeIdentity(nextBounds, completedIdentity) > 0) return true;
  return previousBounds?.season
    && previousBounds?.episode
    && compareEpisodeIdentity(nextBounds, previousBounds) > 0;
}

function nextEpisodeAfterFavoriteUrl(favorite, finalSeason, finalEpisode) {
  const identity = episodeIdentity(favorite?.url || "");
  if (!identity) return "";
  if (identity.season < finalSeason) {
    return replaceEpisodeUrl(favorite.url, identity.season + 1, 1);
  }
  if (identity.season === finalSeason && identity.episode < finalEpisode) {
    return replaceEpisodeUrl(favorite.url, identity.season, identity.episode + 1);
  }
  return "";
}

function favoriteReplacementKey(url, provider, type = "") {
  const providerKey = String(provider?.id || provider?.name || providerModel.hostFromUrl(provider?.startUrl || url) || "")
    .toLowerCase()
    .trim();
  const slug = mediaSlugFromUrl(url);
  const mediaType = normalizeMediaType(type) || inferMediaType(url);
  return `${providerKey}:${mediaType || "unknown"}:${slug || normalizeFavoriteUrl(url)}`;
}

function favoriteMatchesCurrentProviderTitle(favorite, provider, url, normalized = normalizeFavoriteUrl(url), requestedType = "") {
  if (!favorite || !provider) return false;
  const sameProvider = favorite.providerId === provider.id || favorite.providerName === provider.name;
  if (!sameProvider) return false;
  const favoriteType = normalizeMediaType(favorite.type) || inferMediaType(favorite.url || "");
  if (requestedType && favoriteType && favoriteType !== "unknown" && favoriteType !== requestedType) return false;
  if (favorite.normalizedUrl === normalized || normalizeFavoriteUrl(favorite.url) === normalized) return true;
  return favoriteReplacementKey(favorite.url, provider, favoriteType) === favoriteReplacementKey(url, provider, requestedType);
}

function mediaDiagnosticDecisionText(entry, url, state) {
  if (istWiederansehen(entry)) {
    return `Medium abgeschlossen, laeuft aber wieder - ${durchlaeufe(entry) + 1}. Durchlauf, in Mediathek und Weiterschauen sichtbar`;
  }
  if (entry.completed) return "Medium abgeschlossen, aus Watchlist/Weiterschauen entfernt und in Mediathek sichtbar";
  if (state.hasMediaProgress) {
    const target = entry?.type === "film" ? "Film" : favoriteProgressTargetLabel(url);
    const watched = Math.round(state.watchedSeconds || 0);
    const progress = Number.isFinite(state.progressPercent) ? `${state.progressPercent}%` : "ohne Prozent";
    return `${target} gespeichert - Wiedergabe ${watched}s - Fortschritt ${progress}`;
  }
  return "Verlauf gespeichert";
}

// Der Hinweis auf eine neue Folge wird gesammelt, nicht gesendet: wer ihn
// anzeigt, weiss der Aufrufer - am Rechner eine Einblendung, auf dem
// Telefon ein Toast.
function applyFavoriteSeriesBounds(favorite, meta = {}, currentUrl = favorite?.url || "", meldungen = []) {
  const mediaType = favorite?.type === "serie" ? "serie" : inferMediaType(currentUrl || favorite?.url || "");
  if (!favorite || mediaType !== "serie") return false;
  const nextFinalSeason = sanitizePositiveNumber(meta.finalSeason);
  const nextFinalEpisode = sanitizePositiveNumber(meta.finalEpisode);
  if (!nextFinalSeason || !nextFinalEpisode) return false;

  const previousFinalSeason = sanitizePositiveNumber(favorite.finalSeason);
  const previousFinalEpisode = sanitizePositiveNumber(favorite.finalEpisode);
  const hadKnownFinal = Boolean(previousFinalSeason && previousFinalEpisode);
  const nextBounds = { key: episodeIdentity(currentUrl)?.key || episodeIdentity(favorite.url)?.key || "", season: nextFinalSeason, episode: nextFinalEpisode };
  const previousBounds = { key: nextBounds.key, season: previousFinalSeason, episode: previousFinalEpisode };
  // Eine kleinere letzte Folge ist sonst verdaechtig (halb geladene Seite) und
  // wird ignoriert. Hat die Seite dagegen selbst gemeldet, dass die hinteren
  // Folgen nicht abspielbar sind, ist die Kuerzung gewollt.
  const gekuerzt = Boolean(meta.finalEpisodeTrimmed);
  if (hadKnownFinal && !gekuerzt && compareEpisodeIdentity(nextBounds, previousBounds) < 0) return false;

  let changed = false;
  if (favorite.finalSeason !== nextFinalSeason) {
    favorite.finalSeason = nextFinalSeason;
    changed = true;
  }
  if (favorite.finalEpisode !== nextFinalEpisode) {
    favorite.finalEpisode = nextFinalEpisode;
    changed = true;
  }

  // Ausdruecklich nicht waehrend eines Wiederansehens. Dort steht der Eintrag
  // auf einer fruehen Folge, waehrend die letzte Folge der Serie laengst
  // bekannt ist - und genau das sieht fuer hasNewEpisodeAfterCompletedFavorite
  // aus wie Nachschub. Der Eintrag wuerde bei jeder Fortschrittsmeldung nach
  // vorn geworfen: mitten im zweiten Durchlauf ploetzlich in der letzten
  // Staffel, ohne Fortschritt und ohne Mediathek.
  if (favorite.completed && !favorite.rewatching
    && hasNewEpisodeAfterCompletedFavorite(favorite, previousBounds, nextBounds)) {
    const nextUrl = nextEpisodeAfterFavoriteUrl(favorite, nextFinalSeason, nextFinalEpisode);
    const imRaum = Boolean(favorite.watchpartyRoom);
    favorite.completed = false;
    favorite.completedManually = false;
    favorite.episodeCompleted = false;
    // Auf die Merkliste kommt nur, was einem selbst gehoert. Ein Raum-Eintrag
    // gehoert seiner Runde: er darf wieder aktiv werden, aber die private
    // Watchlist entsteht nie aus einem Watchparty-Eintrag - sonst stuende
    // derselbe Titel zweimal da, einmal als eigener Vorsatz und einmal als
    // Verabredung, die man nie gefasst hat.
    if (!imRaum) favorite.favorite = true;
    // Und die Runde nimmt ihn aus dem Archiv zurueck: genau dafuer ist der
    // Eintrag dort liegengeblieben.
    if (imRaum) favorite.watchpartyArchived = false;
    favorite.hideFromContinueWatching = false;
    favorite.rewatching = false;
    favorite.continuePending = true;
    favorite.completedAt = "";
    favorite.progress = 0;
    favorite.currentTime = 0;
    favorite.position = 0;
    favorite.duration = 0;
    if (nextUrl) {
      favorite.url = nextUrl;
      favorite.normalizedUrl = normalizeFavoriteUrl(nextUrl);
      const nextIdentity = episodeIdentity(nextUrl);
      favorite.season = nextIdentity?.season || favorite.season || 0;
      favorite.episode = nextIdentity?.episode || favorite.episode || 0;
    }
    meldungen.push(imRaum
      ? `${cleanBaseMediaTitle(favorite.title, favorite.url) || favorite.title || "Serie"} ist wieder in der Runde „${favorite.watchpartyRoom}“: neue Folge erkannt`
      : `${cleanBaseMediaTitle(favorite.title, favorite.url) || favorite.title || "Serie"} ist wieder in der Watchlist: neue Folge erkannt`);
    changed = true;
  }

  if (gekuerzt && repairTrimmedSeriesTail(favorite, nextFinalSeason, nextFinalEpisode, meldungen)) {
    changed = true;
  }
  return changed;
}

/**
 * Einen Eintrag von Hand anlegen - vorgemerkt, nicht angefangen.
 *
 * <p>Der zweite Weg, auf dem ein Titel in die Ablage kommt. Der erste ist
 * {@link medienStandVerbuchen}: dort meldet sich ein laufendes Video, und die
 * Regel entscheidet, ob daraus ein Stand wird. Hier gibt es kein Video - jemand
 * hat auf ein Herz getippt oder einen Vorschlag vorgemerkt, und die Absicht ist
 * eindeutig.
 *
 * <p>Warum das nicht ueber medienStandVerbuchen geht, obwohl es verlockend
 * aussieht: die Regel dort verlangt zu Recht Videodaten, sonst fuellte jeder
 * geoeffnete Reiter die Liste. Android hat ihr deshalb einen Mindeststand
 * vorgetaeuscht (currentTime 0.1, duration 1) - mit zwei Folgen, die beide
 * falsch sind. Erstens wurde der Eintrag bei einer Serienuebersicht und bei
 * jeder Folge ausser der ersten gar nicht angelegt: ohne 2:30 Wiedergabe und
 * ohne Folge 1 blockiert die Regel, und der Herz-Knopf tat schlicht nichts.
 * Zweitens trug ein angelegter Eintrag zehn Prozent Fortschritt und stand
 * damit sofort in "Weiterschauen" - vorgemerkt und angefangen sind aber zwei
 * verschiedene Dinge.
 *
 * <p>Gibt es den Titel schon, wird er nur wieder auf die Merkliste gesetzt und
 * nach vorn geholt; sein Fortschritt bleibt unangetastet.
 *
 * @param zustand  { favoriten, aktiverFavoritId }
 * @param angaben  { title, thumbnail, type } - alles freiwillig
 * @returns {{ eintrag, favoriten, neu, schonDabei }} oder `eintrag: null`,
 *          wenn die Adresse nichts hergibt
 */
function vonHandAnlegen(zustand, provider, url, angaben = {}) {
  const favoriten = Array.isArray(zustand?.favoriten) ? zustand.favoriten.slice() : [];
  const leer = { eintrag: null, favoriten, neu: false, schonDabei: false };
  if (!provider || !providerModel.isHttpUrl(url)) return leer;

  const normalized = normalizeFavoriteUrl(url);
  const jetzt = new Date().toISOString();
  // Zwei Fragen, in dieser Reihenfolge: kennt der Fortschritt diesen Eintrag
  // (Anbieter + Slug), und - wenn nicht - kennt ihn die Watchlist unter ihrem
  // kanonischen Schluessel? Die zweite Frage ist neu. Ohne sie legte ein
  // zweites Vormerken desselben Werks einen zweiten Eintrag an, sobald sich
  // der Anbieter nicht wiedererkennen liess; genau solche Doppelten standen in
  // der Ablage.
  //
  // Das require steht hier und nicht oben: watchlist.js braucht dieses Modul,
  // und ein gegenseitiges require auf oberster Ebene bekaeme die Haelfte der
  // Exporte. Zum Zeitpunkt des Aufrufs ist beides fertig geladen.
  const watchlistModul = require("./watchlist");
  const werk = watchlistModul.werkSchluessel(angaben.title, url, angaben.type);
  const vorhanden = favoriten.find(
    (favorit) => favoriteMatchesCurrentProviderTitle(favorit, provider, url, normalized))
    || (werk ? favoriten.find((favorit) => watchlistModul.istPrivat(favorit)
      && watchlistModul.schluesselVon(favorit) === werk) : null);
  if (vorhanden) {
    const schonDabei = vorhanden.favorite !== false && !vorhanden.completed;
    vorhanden.favorite = true;
    // Wieder auf der Merkliste heisst: nicht mehr abgeschlossen. Sonst stuende
    // der Titel gleichzeitig in Watchlist und Mediathek - derselbe Widerspruch,
    // den watchlistSetzen an seiner Stelle aufloest.
    if (vorhanden.completed) {
      vorhanden.completed = false;
      vorhanden.completedManually = false;
      vorhanden.completedAt = "";
      vorhanden.hideFromContinueWatching = false;
      // Ohne Abschluss kein Wiederansehen: der Titel ist jetzt schlicht offen.
      // Die Zahl der bisherigen Durchlaeufe bleibt stehen - sie ist Geschichte
      // und keine Zustandsangabe.
      vorhanden.rewatching = false;
    }
    vorhanden.updatedAt = jetzt;
    const ohne = favoriten.filter((favorit) => favorit !== vorhanden);
    return { eintrag: vorhanden, favoriten: [vorhanden, ...ohne], neu: false, schonDabei };
  }

  const identity = episodeIdentity(url);
  const eintrag = {
    id: kennungErzeugen(),
    providerId: provider.id,
    providerName: provider.name || "",
    title: serienTitel(angaben.title, url, provider.name || ""),
    url,
    normalizedUrl: normalized,
    favicon: String(angaben.favicon || ""),
    thumbnail: String(angaben.thumbnail || ""),
    logo: provider.logo || "",
    favorite: true,
    watched: false,
    completed: false,
    episodeCompleted: false,
    continuePending: false,
    completedEpisodes: [],
    hideFromContinueWatching: false,
    rewatching: false,
    rewatchCount: 0,
    // Null, und das ist der Punkt: vorgemerkt ist nicht angefangen. Mit einem
    // Fortschritt stuende der Titel in derselben Sekunde auch in
    // "Weiterschauen", und dort gehoert er erst hin, wenn wirklich etwas lief.
    progress: 0,
    duration: 0,
    position: 0,
    currentTime: 0,
    type: normalizeMediaType(angaben.type || inferMediaType(url)),
    season: identity?.season || 0,
    episode: identity?.episode || 0,
    lastWatchedAt: "",
    activity: [],
    createdAt: jetzt
  };
  return { eintrag, favoriten: [eintrag, ...favoriten], neu: true, schonDabei: false };
}

/**
 * Den Eintrag zu einer Runde finden - und anlegen, wenn es ihn nicht gibt.
 *
 * <h2>Warum das hier steht und nicht im Hauptprozess</h2>
 *
 * <p>Am Rechner stand diese Regel als {@code createWatchpartyFavorite} in
 * {@code main.js}, also an einem Ort, den das Telefon nie sieht. Die Folge war
 * genau der gemeldete Fehler: auf Android blieb "Gemeinsam weiterschauen"
 * leer, egal wie lange die Runde lief.
 *
 * <p>Am Geraet nachgestellt (Emulator, echtes Relay, ein zweites Mitglied, das
 * Fortschritt meldet): Android trat dem Titel bei, das Relay leitete den Stand
 * weiter - und {@code Bestand.watchpartyStandUebernehmen} stieg bei
 * {@code lokal == null} wortlos aus. Nach zwanzig Sekunden standen zwei
 * Eintraege in der Ablage, <em>keiner</em> mit Raum, und der eingestellte Titel
 * gar nicht. Der Rechner haette an derselben Stelle einen Eintrag angelegt.
 *
 * <h2>Warum je Raum ein eigener Eintrag</h2>
 *
 * <p>Ein Titel kann privat laufen und zugleich in zwei Runden stehen, und die
 * drei Staende haben nichts miteinander zu tun. Gesucht wird deshalb nach
 * Serie <em>und</em> Raum. Der Eintrag ohne Raum ist der eigene und wird hier
 * nie angefasst - sonst liefe der Stand der Runde in den privaten Verlauf.
 *
 * @param zustand   {{favoriten: Array}}
 * @param provider  der Anbieter, dem die Adresse gehoert
 * @param raum      der Raumcode; ohne ihn wird nichts angelegt
 * @param eintrag   was der Raum ueber den Titel weiss (title, thumbnail, type, url)
 * @param stand     der gemeldete Fortschritt, darf leer sein
 * @returns {{eintrag: object|null, favoriten: Array, neu: boolean}}
 */
function watchpartyEintragAnlegen(zustand, provider, raum, eintrag = {}, stand = {}) {
  const favoriten = Array.isArray(zustand?.favoriten) ? zustand.favoriten.slice() : [];
  const leer = { eintrag: null, favoriten, neu: false };
  const code = String(raum || "").trim();
  if (!provider || !code) return leer;

  const url = absoluteHttpUrl(stand?.url || eintrag?.url || "", provider.startUrl || "");
  if (!url) return leer;

  // Gesucht wird ueber die Serienkennung, nicht ueber die volle Adresse: der
  // Raum steht bei Folge 4, der eigene Eintrag vielleicht noch bei Folge 2.
  const serie = serienKennungAusUrl(url);
  const vorhanden = favoriten.find((favorit) => (
    String(favorit?.watchpartyRoom || "") === code
    && serie && serienKennungAusUrl(favorit?.url) === serie
  ));
  if (vorhanden) return { eintrag: vorhanden, favoriten, neu: false };

  const identity = episodeIdentity(url);
  const jetzt = new Date().toISOString();
  const neu = {
    id: kennungErzeugen(),
    providerId: provider.id,
    providerName: provider.name || eintrag?.providerName || "",
    title: cleanTitle(eintrag?.title || url),
    url,
    normalizedUrl: normalizeFavoriteUrl(url),
    favicon: "",
    thumbnail: String(eintrag?.thumbnail || ""),
    logo: provider.logo || "",
    favorite: false,
    // Angesehen, aber nicht vorgemerkt: der Titel gehoert nach
    // "Weiterschauen", nicht auf die Watchlist. Niemand hat ihn hier von Hand
    // gemerkt - er kommt aus der Runde.
    watched: true,
    completed: Boolean(stand?.completed),
    episodeCompleted: Boolean(stand?.episodeCompleted),
    continuePending: !stand?.completed && !stand?.episodeCompleted,
    completedEpisodes: [],
    hideFromContinueWatching: false,
    rewatching: false,
    rewatchCount: 0,
    progress: Number(stand?.progress) > 0 ? Number(stand.progress) : 0,
    duration: Number(stand?.duration) > 0 ? Number(stand.duration) : 0,
    position: Number(stand?.position) > 0 ? Number(stand.position) : 0,
    currentTime: Number(stand?.position) > 0 ? Number(stand.position) : 0,
    type: normalizeMediaType(eintrag?.type || inferMediaType(url)),
    season: identity?.season || Number(stand?.season) || Number(eintrag?.season) || 0,
    episode: identity?.episode || Number(stand?.episode) || Number(eintrag?.episode) || 0,
    // Dieser Eintrag gehoert zu genau einer Runde. Derselbe Titel in einem
    // zweiten Raum bekommt seinen eigenen.
    watchpartyRoom: code,
    watchpartyFrom: String(stand?.from || ""),
    watchpartyAt: String(stand?.updatedAt || ""),
    watchpartyArchived: Boolean(stand?.archived),
    createdAt: jetzt,
    lastWatchedAt: String(stand?.updatedAt || jetzt),
    activity: []
  };
  return { eintrag: neu, favoriten: [neu, ...favoriten], neu: true };
}

/**
 * Verbucht, was gerade lief - die Regel, nach der ELFIX Fortschritt zaehlt.
 *
 * Bekommt ihren Zustand herein und fasst nichts ausserhalb an: sie legt keine
 * Datei an, zeigt nichts an und redet mit keinem Server. Was zu tun ist, steht
 * im Rueckgabewert. Genau deshalb kann sie am Rechner und auf dem Telefon
 * dieselbe sein.
 *
 * @param zustand {{favoriten: Array, aktiverFavoritId: string, watchpartyFuehrt: boolean}}
 * @returns {{eintrag: object|null, favoriten: Array, neu: boolean, meldungen: string[], diagnosen: object[]}}
 */
function medienStandVerbuchen(zustand, provider, url, meta = {}, options = {}) {
  let favorites = Array.isArray(zustand?.favoriten) ? zustand.favoriten.slice() : [];
  const activeFavoriteId = zustand?.aktiverFavoritId || "";
  const meldungen = [];
  const diagnosen = [];
  const logMediaDiagnostic = (_provider, _url, art, text, angaben) => {
    diagnosen.push({ art, text, angaben });
  };
  const leer = (eintrag = null) => ({ eintrag, favoriten: favorites, neu: false, meldungen, diagnosen });
  if (!provider || !providerModel.isHttpUrl(url) || !isTrackableMediaUrl(url, provider)) return leer();

  const normalized = normalizeFavoriteUrl(url);
  const now = new Date().toISOString();
  const requestedType = mediaTypeForProgressUrl(url, meta.type);
  // Denselben Titel kann es mehrfach geben - einmal privat und je Watchparty
  // einmal. Dann entscheidet der gerade geoeffnete Eintrag, wohin der
  // Fortschritt laeuft; ohne das traefe es immer den erstbesten.
  const geoeffnet = activeFavoriteId ? favorites.find((favorite) => favorite.id === activeFavoriteId) : null;
  const existing = options.existing
    || (geoeffnet && favoriteMatchesCurrentProviderTitle(geoeffnet, provider, url, normalized, requestedType) ? geoeffnet : null)
    || favorites.find((favorite) => favoriteMatchesCurrentProviderTitle(favorite, provider, url, normalized, requestedType));
  const identity = episodeIdentity(url);
  // Vor jeder Aenderung festhalten: nur der Uebergang von "offen" auf "durch"
  // ist ein Abschluss. Danach gelesen waere es immer "war schon fertig".
  const warBereitsAbgeschlossen = Boolean(existing?.completed);
  // Und ob schon ein weiterer Durchlauf lief. Ebenfalls vorher gelesen: der
  // Merker wird gleich gesetzt, und danach saehe jeder erste Takt aus wie die
  // Mitte eines Durchlaufs.
  const warWiederansehen = Boolean(existing?.rewatching);
  const hasMediaProgress = isValidMediaProgress({
    currentTime: meta.currentTime || meta.position,
    duration: meta.duration
  });
  if (!existing && !hasMediaProgress) {
    logMediaDiagnostic(provider, url, "ignoriert", "keine Videodaten erkannt", meta);
    return leer();
  }

  const watchedSeconds = sanitizePositiveNumber(meta.watchedSeconds);
  const progressPercent = hasMediaProgress
    ? mediaProgressPercent(meta.currentTime || meta.position, meta.duration)
    : sanitizeProgress(meta.progress);
  // Ueber 90 Prozent allein macht eine Folge nicht zur gesehenen: es muss auch
  // wirklich geschaut worden sein. Wer hineinspringt und den Regler ans Ende
  // zieht, kommt sonst in einer Sekunde ans Serienende. Beides muss zusammen
  // erfuellt sein - dieselbe Wartezeit wie fuer jeden anderen Stand.
  const mediaEnded = (Boolean(meta.completed) || isCompletedProgress(progressPercent))
    && watchedSeconds >= endeSchwelle(meta.duration);
  const startsAtFirstEpisode = isFirstEpisodeIdentity(identity);
  const isFilmProgress = requestedType === "film";
  const qualifiesForPrimaryProgress = mediaEnded || isFilmProgress || startsAtFirstEpisode || watchedSeconds >= uebernahmeSchwelle(existing);

  const shouldPromotePrimary = shouldPromoteMediaProgress(existing, url, {
    hasMediaProgress,
    mediaEnded,
    watchedSeconds,
    isFilmProgress,
    startsAtFirstEpisode,
    finalSeason: meta.finalSeason,
    finalEpisode: meta.finalEpisode,
    watchpartyFuehrt: Boolean(zustand?.watchpartyFuehrt)
  });
  if (!existing && hasMediaProgress && !qualifiesForPrimaryProgress) {
    logMediaDiagnostic(provider, url, "blockiert", mediaPromotionBlockReason(existing, url, {
      mediaEnded,
      watchedSeconds,
      isFilmProgress,
      startsAtFirstEpisode,
      finalSeason: meta.finalSeason,
      finalEpisode: meta.finalEpisode
    }), {
      ...meta,
      progress: progressPercent,
      favorite: false,
      continueVisible: false
    });
    return leer();
  }
  if (existing && hasMediaProgress && !shouldPromotePrimary) {
    logMediaDiagnostic(provider, url, "blockiert", mediaPromotionBlockReason(existing, url, {
      mediaEnded,
      watchedSeconds,
      isFilmProgress,
      startsAtFirstEpisode
    }), {
      ...meta,
      progress: progressPercent,
      currentTitle: existing.title,
      currentUrl: existing.url,
      favorite: existing.favorite,
      continueVisible: hasContinueProgressRecord(existing)
    });
    appendMediaActivity(existing, url, options.label || mediaActivityLabel(url, existing));
    existing.updatedAt = now;
    return { eintrag: existing, favoriten: favorites, neu: false, meldungen, diagnosen };
  }

  const preserveActiveFavoriteTarget = Boolean(existing?.favorite && !options.updateFavoriteUrl && !hasMediaProgress);
  const preserveProgressTarget = preserveActiveFavoriteTarget || Boolean(existing && !hasMediaProgress);
  const entry = existing || {
    id: kennungErzeugen(),
    providerId: provider.id,
    providerName: provider.name,
    title: serienTitel(meta.title, url, provider.name),
    url,
    normalizedUrl: normalized,
    favicon: meta.favicon || "",
    thumbnail: meta.thumbnail || "",
    logo: provider.logo || "",
    favorite: false,
    watched: false,
    completed: false,
    episodeCompleted: false,
    continuePending: false,
    completedEpisodes: [],
    hideFromContinueWatching: false,
    // Wiederansehen: laeuft gerade ein weiterer Durchlauf, und wie viele davon
    // schon zu Ende sind. Bei einem frischen Eintrag beides null.
    rewatching: false,
    rewatchCount: 0,
    progress: 0,
    duration: 0,
    position: 0,
    currentTime: 0,
    type: inferMediaType(url),
    season: 0,
    episode: 0,
    createdAt: now,
    openedAt: "",
    lastWatchedAt: "",
    activity: []
  };

  entry.providerId = provider.id;
  entry.providerName = provider.name;
  if (!preserveProgressTarget) {
    entry.url = url;
    entry.normalizedUrl = normalized;
  }
  entry.logo = provider.logo || entry.logo || "";
  entry.type = requestedType || entry.type || inferMediaType(url);
  if (meta.title && (!existing || entry.type === "film")) {
    entry.title = cleanTitle(meta.title);
  }
  entry.watched = true;

  // --- Wiederansehen, erster Teil: der Merker ---------------------------------
  //
  // Er wird hier gesetzt und nicht weiter unten, und das ist keine Kosmetik.
  // Die Adresse des Eintrags ist ein paar Zeilen darueber bereits auf die
  // laufende Folge umgeschrieben worden, und applyFavoriteSeriesBounds
  // vergleicht genau sie mit der letzten bekannten Folge der Serie. Wer eine
  // fertige Serie von vorn ansieht, steht dort auf Folge 1 von 12 - und das
  // sah bis dahin aus wie Nachschub: der Eintrag wurde ans Serienende
  // geworfen, ohne Stand und ohne Mediathek, und zwar bei jedem Takt neu.
  //
  // Fortschritt auf einem Titel, der schon durch war, ist ein weiterer
  // Durchlauf. Mehr sagt der Merker nicht - `completed` bleibt unangetastet,
  // der Titel bleibt in der Mediathek.
  if (warBereitsAbgeschlossen && hasMediaProgress) entry.rewatching = true;

  applyFavoriteSeriesBounds(entry, meta, url, meldungen);
  const wholeItemCompleted = isWholeMediaCompleted(entry, url, mediaEnded);
  const shouldAdvanceEpisode = Boolean(mediaEnded && !wholeItemCompleted && identity && (entry.type === "serie" || inferMediaType(url) === "serie"));
  const nextContinueUrl = shouldAdvanceEpisode ? nextEpisodeContinueUrl(url, meta.nextUrl, entry, meta) : "";
  let advancedToNextEpisode = false;
  entry.completed = Boolean(entry.completed || wholeItemCompleted);
  // Bei YouTube entscheidet allein der Fortschritt - und zwar in beide
  // Richtungen.
  //
  // Sonst ist "abgeschlossen" ein Merker, der einmal gesetzt wird und stehen
  // bleibt: bei einer Serie ist das richtig, denn die letzte Folge bleibt
  // gesehen, egal was man danach anfaengt. Ein YouTube-Video ist aber ein
  // einzelnes Werk unter einer einzigen Adresse. Blieb der Merker dort einmal
  // haengen, galt das Video fuer immer als durch - auch bei sechsundzwanzig
  // Prozent, und dann verschwand es aus "Weiterschauen", waehrend man es noch
  // schaute.
  //
  // Deshalb wird der Merker hier bei jedem Stand neu bestimmt. Faellt der
  // Fortschritt wieder unter neunzig Prozent - weil man zurueckspringt oder
  // das Video neu beginnt -, ist es auch wieder offen.
  //
  // "Von Hand abgehakt" bleibt davon unberuehrt: das ist eine Entscheidung des
  // Nutzers und keine Messung.
  if (hasMediaProgress && youtube.istYoutubeUrl(url) && !entry.completedManually) {
    entry.completed = progressPercent >= COMPLETED_PROGRESS_PERCENT;
  }

  // --- Wiederansehen, zweiter Teil: zaehlen und beenden ----------------------
  //
  // `rewatchCount` zaehlt die *abgeschlossenen* weiteren Durchlaeufe; der erste
  // steckt in `completed`. Gezaehlt wird der Uebergang und nicht der Zustand:
  // der Player meldet sein Ende sekundenlang weiter, und ein Zustand liesse
  // sich so ein Dutzend Mal zaehlen. Deshalb `warWiederansehen` - der Merker,
  // wie er *vor* diesem Takt stand.
  //
  // Ein einzelner Takt, der schon am Ende ankommt, ist damit ausdruecklich kein
  // Durchlauf: ein Neustart bei 99 Prozent einer laengst fertigen Folge zaehlt
  // nichts.
  let durchlaufBeendet = false;
  if (hasMediaProgress && entry.completed) {
    if (wholeItemCompleted) {
      // Wieder am Ende des ganzen Werks: der Durchlauf ist vorbei, der Eintrag
      // ruht wieder allein in der Mediathek.
      if (warWiederansehen) {
        entry.rewatchCount = sanitizePositiveNumber(entry.rewatchCount) + 1;
        entry.rewatchedAt = now;
        durchlaufBeendet = true;
      }
      entry.rewatching = false;
    }
  } else if (!entry.completed) {
    entry.rewatching = false;
  }

  if (hasMediaProgress) {
    entry.currentTime = sanitizePositiveNumber(meta.currentTime || meta.position);
    entry.position = entry.currentTime;
    entry.duration = sanitizePositiveNumber(meta.duration);
    entry.progress = progressPercent;
    // Die letzte Folge einer Serie wurde nirgends als abgeschlossene Folge
    // vermerkt: `shouldAdvanceEpisode` ist bei ihr falsch (es rueckt ja nichts
    // mehr nach), und damit lief sie an `appendCompletedEpisode` vorbei. In der
    // Ablage stand deshalb bei "BLACK TORCH" Folge 2 bis 7 unter
    // `completedEpisodes` - und Folge 8, die eigentlich gemeinte, fehlte. Der
    // Abschluss der Serie war zwar vermerkt, aber ohne Folgenangabe, und genau
    // solche Zeilen sind hinterher nicht mehr zuzuordnen.
    if (mediaEnded && identity && wholeItemCompleted) {
      appendCompletedEpisode(entry, identity, url, now);
    }
    if (shouldAdvanceEpisode) {
      appendCompletedEpisode(entry, identity, url, now);
      if (nextContinueUrl) {
        const nextIdentity = episodeIdentity(nextContinueUrl);
        entry.url = nextContinueUrl;
        entry.normalizedUrl = normalizeFavoriteUrl(nextContinueUrl);
        entry.season = nextIdentity?.season || identity.season || entry.season || 0;
        entry.episode = nextIdentity?.episode || identity.episode + 1 || entry.episode || 0;
        entry.title = cleanBaseMediaTitle(entry.title, nextContinueUrl);
        entry.currentTime = 0;
        entry.position = 0;
        entry.duration = 0;
        entry.progress = 0;
        entry.episodeCompleted = false;
        entry.continuePending = true;
        entry.hideFromContinueWatching = false;
        advancedToNextEpisode = true;
      } else {
        entry.episodeCompleted = true;
        entry.continuePending = false;
      }
    } else {
      entry.episodeCompleted = Boolean(mediaEnded && !entry.completed);
      // "Die naechste Folge steht an" faellt erst weg, wenn an ihr wirklich
      // etwas gelaufen ist.
      //
      // Vorher genuegte das blosse Oeffnen: die Seite meldete sich, hier stand
      // noch Stelle 0, und der Merker war weg. Damit war der Eintrag aus
      // "Weiterschauen" verschwunden - er hat keinen Fortschritt auf dieser
      // Folge (0 %), keinen auf der vorigen (die ist abgehakt), und
      // hasContinueProgressRecord findet nichts mehr, woran es ihn halten
      // koennte. Gemessen am 26.08.2026 an "Attack on Titan": Staffel 3 Folge
      // 21 zu Ende geschaut, Folge 22 aufgemacht, und die Serie war aus der
      // Liste. Genau in dem Augenblick, in dem man weiterschauen wollte.
      const etwasGelaufen = sanitizePositiveNumber(entry.currentTime) > 0;
      entry.continuePending = Boolean(entry.continuePending) && !etwasGelaufen;
    }
    if ((!entry.completed || entry.rewatching) && !entry.episodeCompleted) {
      entry.hideFromContinueWatching = false;
    }
  } else if (entry.completed && !entry.rewatching) {
    entry.progress = 100;
    entry.continuePending = false;
  } else {
    entry.progress = sanitizeProgress(entry.progress);
  }
  if (entry.completed) {
    entry.favorite = false;
    entry.completedAt = entry.completedAt || now;
    // Waehrend eines Wiederansehens bleibt der Eintrag sichtbar. Ohne diese
    // Bedingung setzte die naechste Fortschrittsmeldung den Titel in derselben
    // Sekunde wieder auf unsichtbar, in der er sich zurueckgemeldet hat.
    if (!entry.rewatching) {
      entry.hideFromContinueWatching = true;
      entry.continuePending = false;
    }
  }
  if (hasMediaProgress || !existing) {
    entry.lastWatchedAt = now;
  } else {
    entry.openedAt = now;
  }
  if (identity && !preserveProgressTarget && !advancedToNextEpisode) {
    entry.season = identity.season || entry.season || 0;
    entry.episode = identity.episode || entry.episode || 0;
  }
  appendMediaActivity(entry, url, options.label || mediaActivityLabel(url, entry));
  // Der Moment, in dem ein Titel durch ist, wurde nirgends festgehalten. Im
  // Verlauf standen deshalb nur "Film geoeffnet"-Zeilen, und dreimal geoeffnet
  // sah aus wie dreimal geschaut. Ein "Abgeschlossen" gab es zwar als Label,
  // aber nur, wenn der Player wirklich ein Ende meldete - bei einem Film, der
  // ueber die 90 Prozent oder von Hand fertig wird, nie.
  //
  // Der Uebergang wird deshalb hier vermerkt, und nur der Uebergang: wer einen
  // fertigen Titel noch einmal oeffnet, erzeugt keinen zweiten Abschluss.
  //
  // Bei einer Serie steht diese Zeile inzwischen nicht mehr da. Sie war
  // generisch - "Abgeschlossen", ohne Staffel und Folge -, und bei einer
  // woechentlich erscheinenden Serie entstand sie jedes Mal neu, wenn der
  // Nutzer die zu diesem Zeitpunkt letzte verfuegbare Folge erreichte. Bei
  // "BLACK TORCH" lagen so vier davon in der Ablage (nach Folge 3, 6 und
  // zweimal nach Folge 8), und der Verlaufs-Kasten las sie als vier
  // Serienabschluesse. Der Abschluss der konkreten Folge steht jetzt weiter
  // oben in `completedEpisodes`, wo er hingehoert - mit Staffel und Folge.
  //
  // Fuer alles ohne Folgenzaehlung - Filme, YouTube-Videos - bleibt sie: dort
  // ist "abgeschlossen" eindeutig, weil es nur ein Werk gibt.
  if (entry.completed && !warBereitsAbgeschlossen && !identity) {
    appendMediaActivity(entry, url, "Abgeschlossen");
  }
  // Ein weiterer Durchlauf dagegen bekommt seine Zeile immer - auch bei einer
  // Serie. Er ist eindeutig datierbar (er endet an der letzten Folge), er
  // kommt nicht woechentlich neu, und er ist genau das, was der Verlaufs-Kasten
  // sonst nirgends hergibt: dass jemand denselben Titel ein zweites Mal ganz
  // gesehen hat.
  if (durchlaufBeendet) {
    appendMediaActivity(entry, url, `${durchlaeufe(entry)}. Durchlauf abgeschlossen`);
  }

  if (!existing) {
    favorites.unshift(entry);
    favorites = favorites.slice(0, 600);
  } else {
    favorites = nachVornHolen(favorites, entry);
  }
  logMediaDiagnostic(provider, url, entry.completed ? "abgeschlossen" : "aktualisiert", mediaDiagnosticDecisionText(entry, url, {
    hasMediaProgress,
    watchedSeconds,
    mediaEnded,
    progressPercent
  }), {
    ...meta,
    progress: progressPercent,
    favorite: entry.favorite,
    continueVisible: hasContinueProgressRecord(entry)
  });
  return { eintrag: entry, favoriten: favorites, neu: !existing, meldungen, diagnosen };
}

// Wird die letzte Folge nach unten korrigiert, steht der Eintrag womoeglich auf
// einer Folge, die es zum Abspielen nie gab - die Serie war dann bis zur echten
// letzten Folge durchgeschaut, galt aber nie als abgeschlossen. Das wird hier
// nachgezogen.
function repairTrimmedSeriesTail(favorite, finalSeason, finalEpisode, meldungen = []) {
  const identity = episodeIdentity(favorite?.url || "");
  if (!identity || identity.season !== finalSeason || identity.episode <= finalEpisode) return false;

  const schluessel = `${identity.key}:s${finalSeason}:e${finalEpisode}`;
  const letzteGesehen = Array.isArray(favorite.completedEpisodes)
    && favorite.completedEpisodes.some((eintrag) => eintrag?.key === schluessel);
  if (!letzteGesehen) return false;

  const letzteUrl = replaceEpisodeUrl(favorite.url, finalSeason, finalEpisode);
  if (letzteUrl) {
    favorite.url = letzteUrl;
    favorite.normalizedUrl = normalizeFavoriteUrl(letzteUrl);
    favorite.season = finalSeason;
    favorite.episode = finalEpisode;
    favorite.title = cleanBaseMediaTitle(favorite.title, letzteUrl) || favorite.title;
  }
  favorite.completed = true;
  favorite.episodeCompleted = true;
  favorite.continuePending = false;
  favorite.favorite = false;
  favorite.hideFromContinueWatching = true;
  favorite.progress = 100;
  favorite.completedAt = favorite.completedAt || new Date().toISOString();
  meldungen.push(`${cleanBaseMediaTitle(favorite.title, favorite.url) || favorite.title || "Serie"} ist abgeschlossen: die restlichen Folgen sind in Folge ${finalEpisode} enthalten`);
  return true;
}

/**
 * Zieht den geoeffneten Eintrag auf die Folge nach, die gerade aufgerufen
 * wurde - ohne dass dafuer etwas gelaufen sein muss.
 *
 * <p>Das ist der zweite Weg, auf dem sich ein Stand bewegt: nicht durch
 * Wiedergabe, sondern durch Blaettern. Wer die naechste Folge oeffnet, will sie
 * sehen; der Eintrag darf dann nicht auf der vorigen stehenbleiben. Weiter als
 * eine Folge geht es aber nie, und rueckwaerts gar nicht - sonst wuerde ein
 * Blick in die Staffeluebersicht den Stand verwerfen.
 *
 * Gibt zurueck, was zu tun ist. "loesen" heisst: dieser Eintrag ist nicht mehr
 * der geoeffnete, denn der Benutzer ist woandershin gegangen.
 *
 * @returns {{art: "nichts"|"loesen"|"nachziehen", aenderung?: object, meldung?: string}}
 */
function favoritNachziehen(eintrag, url, provider, folgemodus = "sequential") {
  if (!eintrag || !provider || !isFavoriteProgressUrl(url, provider)) return { art: "nichts" };
  const normalized = normalizeFavoriteUrl(url);
  if (eintrag.normalizedUrl === normalized) return { art: "nichts" };
  const vorher = episodeIdentity(eintrag.url);
  const nachher = episodeIdentity(url);
  if (!vorher || !nachher) return { art: "nichts" };

  if (folgemodus !== "sequential" || !isSequentialFavoriteProgress(vorher, nachher)) {
    return { art: "loesen" };
  }

  return {
    art: "nachziehen",
    meldung: `Favorit auf ${favoriteProgressTargetLabel(url)} geändert`,
    aenderung: {
      url,
      normalizedUrl: normalized,
      providerName: provider.name,
      logo: provider.logo || eintrag.logo || "",
      watched: true,
      // Abgeschlossene Serien bleiben in der Mediathek, auch wenn man sie noch
      // einmal ansieht - fuer von Hand abgehakte galt das schon immer, fuer
      // durchgeschaute bis 1.69.0 nicht: dort loeschte diese Zeile den
      // Abschluss, sobald man beim Wiederansehen die Folge wechselte, und der
      // Titel war aus der Mediathek verschwunden.
      //
      // Zurueck holt einen Abschluss nur, was wirklich neu ist (siehe
      // applyFavoriteSeriesBounds). Der Folgenwechsel eroeffnet stattdessen
      // einen weiteren Durchlauf.
      completed: eintrag.completed,
      rewatching: Boolean(eintrag.completed),
      progress: 0,
      currentTime: 0,
      position: 0,
      duration: 0,
      episodeCompleted: false,
      hideFromContinueWatching: false,
      lastWatchedAt: new Date().toISOString(),
      season: nachher.season || eintrag.season || 0,
      episode: nachher.episode || eintrag.episode || 0
    }
  };
}

/**
 * Von vorn ansehen - und dabei in der Mediathek bleiben.
 *
 * <p>Der Weg dorthin fehlte ganz. Eine Karte in der Mediathek oeffnet die
 * gespeicherte Adresse, und die ist bei einer durchgeschauten Serie die letzte
 * Folge: das Ende, nicht der Anfang. Wer wirklich von vorn wollte, musste den
 * Titel aus der Mediathek nehmen - also genau das aufgeben, was er behalten
 * wollte.
 *
 * <p>`completed` bleibt deshalb unangetastet. Zurueck kommt nur, was sich
 * aendert; wer es anwendet, entscheidet der Aufrufer - am Rechner der
 * Hauptprozess, auf dem Telefon {@code Bestand.wiederansehenStarten}. Dieselbe
 * Bauart wie {@link favoritNachziehen}, und aus demselben Grund: eine zweite
 * Vorstellung davon, wie ein Durchlauf beginnt, waere eine zweite Wahrheit.
 *
 * <p>Ein Film hat keine erste Folge. Bei ihm bleibt die Adresse, und es genuegt
 * der leere Stand.
 */
function wiederansehenBeginnen(eintrag) {
  const url = String(eintrag?.url || "");
  const ziel = firstEpisodeUrl(url) || url;
  const aenderung = {
    progress: 0,
    duration: 0,
    position: 0,
    currentTime: 0,
    episodeCompleted: false,
    // Die naechste Folge steht an, gelaufen ist sie noch nicht - derselbe
    // Zustand wie nach einem Folgenwechsel. Ohne ihn haette der Eintrag weder
    // Fortschritt noch Merker und faende sich in "Weiterschauen" nicht wieder.
    continuePending: true,
    hideFromContinueWatching: false,
    // Nur ein abgeschlossener Titel kann wieder angesehen werden. Bei einem
    // offenen ist "von vorn" schlicht ein Sprung an den Anfang.
    rewatching: Boolean(eintrag?.completed),
    updatedAt: new Date().toISOString()
  };
  if (!ziel || ziel === url) return aenderung;

  const identity = episodeIdentity(ziel);
  aenderung.url = ziel;
  aenderung.normalizedUrl = normalizeFavoriteUrl(ziel);
  aenderung.season = identity?.season || 1;
  aenderung.episode = identity?.episode || 1;
  aenderung.title = cleanBaseMediaTitle(eintrag?.title || "", ziel) || String(eintrag?.title || "");
  return aenderung;
}

/**
 * Sucht den Eintrag, der zu dieser Seite gehoert - und gibt seine Kennung
 * zurueck, nicht den Eintrag selbst.
 *
 * <p>Der Hauptprozess hat die Liste ohnehin zur Hand und braucht das nicht.
 * Die Android-App fragt ueber die Bruecke, und dort reist ein ganzer Eintrag
 * unnoetig weit: gebraucht wird nur, welcher es ist. Die Regel selbst -
 * derselbe Anbieter, dieselbe Adresse oder derselbe Titel unter anderer
 * Folgennummer - steht in {@link favoriteMatchesCurrentProviderTitle} und gilt
 * fuer beide.
 */
function eintragFinden(favoriten, provider, url, typHinweis = "") {
  if (!Array.isArray(favoriten) || !provider || !url) return "";
  const normalized = normalizeFavoriteUrl(url);
  const typ = mediaTypeForProgressUrl(url, typHinweis);
  const treffer = favoriten.find((eintrag) => (
    favoriteMatchesCurrentProviderTitle(eintrag, provider, url, normalized, typ)
  ));
  return treffer ? String(treffer.id || "") : "";
}

/**
 * Der Stand, wie er in die Runde geht.
 *
 * <p>Was ein Geraet der Watchparty ueber einen Titel mitteilt - Adresse,
 * Folge, Stelle, Fortschritt. Die Form muss auf jedem Geraet dieselbe sein,
 * sonst versteht die Gegenseite die Haelfte nicht: das Relay reicht die Felder
 * nur durch, gelesen werden sie erst wieder in der App. Deshalb steht der
 * Bauplan hier und nicht zweimal.
 */
function watchpartyStand(eintrag, geraetName = "") {
  return {
    url: eintrag?.url || "",
    season: sanitizePositiveNumber(eintrag?.season),
    episode: sanitizePositiveNumber(eintrag?.episode),
    position: sanitizePositiveNumber(eintrag?.position || eintrag?.currentTime),
    duration: sanitizePositiveNumber(eintrag?.duration),
    progress: sanitizeProgress(eintrag?.progress),
    completed: Boolean(eintrag?.completed),
    episodeCompleted: Boolean(eintrag?.episodeCompleted),
    // Ob die Runde mit diesem Titel durch ist.
    //
    // Das Relay kann das nicht selbst entscheiden: es kennt keine
    // Seriengrenzen und weiss nicht, ob nach Folge 8 noch etwas kommt. Hier
    // ist es dagegen bekannt - entweder weil das ganze Werk abgeschlossen ist
    // (ein Film, ein Serienfinale), oder weil die Folgenpflege festgestellt
    // hat, dass nach der abgehakten Folge nichts mehr kommt und deshalb
    // `watchpartyArchived` gesetzt hat.
    //
    // Ein laufendes Wiederansehen zaehlt ausdruecklich nicht: da ist der Titel
    // zwar abgeschlossen, die Runde aber gerade wieder unterwegs.
    archived: Boolean(eintrag?.watchpartyArchived)
      || (Boolean(eintrag?.completed) && !istWiederansehen(eintrag)),
    updatedAt: eintrag?.lastWatchedAt || new Date().toISOString(),
    from: geraetName || ""
  };
}

/**
 * Ob ein Raum-Eintrag hier noch als aktiv gilt.
 *
 * <p>Die Gegenrichtung zu {@link watchpartyStand}: dort geht der Merker
 * hinaus, hier kommt er zurueck. Aufgerufen wird das ueberall, wo ein
 * Raumzustand ankommt - am Rechner in {@code raumEintraegeSichern}, auf dem
 * Telefon in der gleichnamigen Bruecke. Beide fragen dieselbe Regel, damit ein
 * Titel nicht auf dem einen Geraet in "Gemeinsam weiterschauen" steht und auf
 * dem anderen nicht.
 *
 * <p>Angefasst wird ausdruecklich nur dieser eine Merker. Fortschritt, Folge
 * und Verlauf bleiben, wie sie sind: ein archivierter Titel verschwindet aus
 * der Reihe, aus der Mediathek verschwindet er nicht.
 *
 * @returns wie {@link watchpartyStandUebernehmen}
 */
function watchpartyArchivAbgleichen(lokal, archiviert) {
  if (!lokal) return { art: "nichts" };
  const jetzt = Boolean(archiviert);
  if (Boolean(lokal.watchpartyArchived) === jetzt) return { art: "nichts" };
  return { art: "aendern", aenderung: { watchpartyArchived: jetzt } };
}

/**
 * Uebernimmt einen Stand aus der Runde in den eigenen Eintrag.
 *
 * <p>Bewusst ohne Vergleich mit der eigenen Uhr: das Relay laesst ohnehin nur
 * den neuesten Stand durch, und Uhren auf verschiedenen Geraeten gehen
 * auseinander. Wer hier die Zeiten vergliche, wuerfe den Stand eines Mitglieds
 * dauerhaft weg, dessen Uhr nachgeht.
 *
 * <p>Beim selben Anbieter passt die Adresse direkt; bei einem anderen wird nur
 * die Folgennummer auf die eigene Adresse umgeschrieben - dieselbe Serie steht
 * bei jedem Anbieter unter einem anderen Pfad.
 *
 * @returns {{art: "nichts"|"aendern", aenderung?: object, folgestaendePruefen?: boolean}}
 */
function watchpartyStandUebernehmen(lokal, stand) {
  if (!lokal || !stand?.updatedAt) return { art: "nichts" };

  const gleicherAnbieter = providerModel.hostFromUrl(lokal.url).toLowerCase()
    === providerModel.hostFromUrl(stand.url || "").toLowerCase();
  const ziel = gleicherAnbieter
    ? stand.url
    : (stand.season && stand.episode ? replaceEpisodeUrl(lokal.url, stand.season, stand.episode) : "");

  const aenderung = {
    position: stand.position,
    currentTime: stand.position,
    duration: stand.duration || lokal.duration,
    progress: stand.progress,
    completed: Boolean(stand.completed),
    episodeCompleted: Boolean(stand.episodeCompleted),
    watched: true,
    lastWatchedAt: stand.updatedAt,
    // Fuer die Karte: wer gerade schaut und wann zuletzt gemeldet wurde.
    watchpartyFrom: stand.from || "",
    watchpartyAt: stand.updatedAt,
    // Und ob die Runde mit dem Titel durch ist. Das Relay laesst nur einen
    // Stand durch, der wirklich gilt - eine neue Folge weckt einen
    // archivierten Titel, ein nachgereichter alter Stand nicht -, also gilt
    // hier, was ankommt.
    watchpartyArchived: Boolean(stand.archived)
  };

  if (ziel && ziel !== lokal.url) {
    const identity = episodeIdentity(ziel);
    aenderung.url = ziel;
    aenderung.normalizedUrl = normalizeFavoriteUrl(ziel);
    aenderung.season = identity?.season || stand.season || lokal.season || 0;
    aenderung.episode = identity?.episode || stand.episode || lokal.episode || 0;
  }
  if (!aenderung.completed && !aenderung.episodeCompleted && !aenderung.watchpartyArchived) {
    aenderung.continuePending = true;
    aenderung.hideFromContinueWatching = false;
  }

  return {
    art: "aendern",
    aenderung,
    // Hat das andere Geraet die Folge zu Ende geschaut, gehoert der eigene
    // Eintrag auf die naechste - sonst verschwindet er aus "Weiterschauen".
    folgestaendePruefen: Boolean(aenderung.episodeCompleted && !aenderung.completed)
  };
}

/**
 * Einen Raum-Eintrag nachziehen, der stehengeblieben ist.
 *
 * <p><b>Der gemeldete Fehler.</b> Ein Stand aus der Runde wird bisher nur
 * uebernommen, wenn er als <em>Meldung</em> hereinkommt - also nur von einem
 * Geraet, das gerade laeuft. Wer waehrenddessen aus war, behaelt seinen alten
 * Eintrag: am 26.08.2026 wurde "Avatar Aang" am Rechner in der Runde "Bangus"
 * zu Ende geschaut, und am Fernseher stand er drei Tage spaeter immer noch in
 * "Gemeinsam weiterschauen".
 *
 * <p>Dabei weiss der Raum es laengst: sein Zustand traegt zu jedem Titel den
 * zuletzt gemeldeten Stand, und der kommt bei jedem Verbinden mit. Er wird
 * hier angewandt - aber nur, wenn er wirklich juenger ist als das, was hier
 * zuletzt galt. Sonst ueberschriebe ein liegengebliebener Raumzustand den
 * Stand eines Geraets, das gerade selbst weitergeschaut hat.
 *
 * @returns wie {@link watchpartyStandUebernehmen}
 */
function watchpartyEintragAbgleichen(lokal, stand) {
  if (!lokal || !stand?.updatedAt) return { art: "nichts" };
  const gemeldet = Date.parse(stand.updatedAt);
  if (!Number.isFinite(gemeldet)) return { art: "nichts" };
  const hier = Date.parse(lokal.watchpartyAt || lokal.lastWatchedAt || "");
  if (Number.isFinite(hier) && gemeldet <= hier) return { art: "nichts" };
  return watchpartyStandUebernehmen(lokal, stand);
}

module.exports = {
  watchpartyStandUebernehmen,
  watchpartyEintragAbgleichen,
  watchpartyArchivAbgleichen,
  watchpartyStand,
  eintragFinden,
  favoritNachziehen,
  wiederansehenBeginnen,
  repairTrimmedSeriesTail,
  kennungErzeugen,
  nachVornHolen,
  absoluteHttpUrl,
  unplayableEpisodeSet,
  nextEpisodeContinueUrl,
  vorigeEpisodeUrl,
  darfNaechsteFolgeSein,
  appendMediaActivity,
  hasNewEpisodeAfterCompletedFavorite,
  nextEpisodeAfterFavoriteUrl,
  favoriteReplacementKey,
  favoriteMatchesCurrentProviderTitle,
  mediaDiagnosticDecisionText,
  applyFavoriteSeriesBounds,
  medienStandVerbuchen,
  vonHandAnlegen,
  watchpartyEintragAnlegen,
  COMPLETED_PROGRESS_PERCENT,
  MIN_WATCH_TIME_SECONDS,
  BACKWARD_WATCH_TIME_SECONDS,
  WATCHPARTY_MIN_WATCH_SECONDS,
  AKTIVITAET_ZUSAMMEN_MS,
  stripWww,
  titleFromPath,
  cleanTitle,
  isAllowedResultHost,
  mediaSlugFromUrl,
  serienKennungAusUrl,
  seitendatenPassenZu,
  gepruefteSeitendaten,
  normalizeFavoriteUrl,
  inferMediaType,
  normalizeMediaType,
  isExplicitFilmUrl,
  mediaTypeForProgressUrl,
  episodeIdentity,
  compareEpisodeIdentity,
  isFirstEpisodeIdentity,
  isSequentialFavoriteProgress,
  favoriteProgressTargetLabel,
  incrementEpisodeUrl,
  replaceEpisodeUrl,
  setzeFolgenNummer,
  firstEpisodeUrl,
  isFavoriteProgressUrl,
  isTrackableMediaUrl,
  istAbspielseite,
  titelAusSlug,
  cleanBaseMediaTitle,
  serienTitel,
  sanitizePositiveNumber,
  sanitizeProgress,
  isCompletedProgress,
  hasContinueProgressRecord,
  istWiederansehen,
  durchlaeufe,
  isWholeMediaCompleted,
  uebernahmeSchwelle,
  endeSchwelle,
  shouldPromoteMediaProgress,
  mediaPromotionBlockReason,
  appendCompletedEpisode,
  isValidMediaProgress,
  mediaProgressPercent,
  normalizeActivity,
  normalizeCompletedEpisodes,
  mediaActivityLabel
};
