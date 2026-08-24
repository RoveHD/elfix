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
function hasContinueProgressRecord(entry) {
  if (!entry || entry.completed || entry.episodeCompleted || entry.hideFromContinueWatching) return false;
  if (entry.continuePending) return true;
  const current = sanitizePositiveNumber(entry.currentTime || entry.position);
  const duration = sanitizePositiveNumber(entry.duration);
  if (duration > 0 && current > 0 && current <= duration + 3) return true;
  const progress = sanitizeProgress(entry.progress);
  return Boolean(entry.lastWatchedAt || entry.openedAt) && progress > 0;
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

function titleFromPath(href) {
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

  if (favorite.completed && hasNewEpisodeAfterCompletedFavorite(favorite, previousBounds, nextBounds)) {
    const nextUrl = nextEpisodeAfterFavoriteUrl(favorite, nextFinalSeason, nextFinalEpisode);
    favorite.completed = false;
    favorite.completedManually = false;
    favorite.episodeCompleted = false;
    favorite.favorite = true;
    favorite.hideFromContinueWatching = false;
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
    meldungen.push(`${cleanBaseMediaTitle(favorite.title, favorite.url) || favorite.title || "Serie"} ist wieder in der Watchlist: neue Folge erkannt`);
    changed = true;
  }

  if (gekuerzt && repairTrimmedSeriesTail(favorite, nextFinalSeason, nextFinalEpisode, meldungen)) {
    changed = true;
  }
  return changed;
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
    title: cleanTitle(meta.title || titleFromPath(url) || provider.name),
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
  if (hasMediaProgress) {
    entry.currentTime = sanitizePositiveNumber(meta.currentTime || meta.position);
    entry.position = entry.currentTime;
    entry.duration = sanitizePositiveNumber(meta.duration);
    entry.progress = progressPercent;
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
      entry.continuePending = false;
    }
    if (!entry.completed && !entry.episodeCompleted) {
      entry.hideFromContinueWatching = false;
    }
  } else if (entry.completed) {
    entry.progress = 100;
    entry.continuePending = false;
  } else {
    entry.progress = sanitizeProgress(entry.progress);
  }
  if (entry.completed) {
    entry.favorite = false;
    entry.hideFromContinueWatching = true;
    entry.continuePending = false;
    entry.completedAt = entry.completedAt || now;
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
  // fertigen Titel noch einmal oeffnet, erzeugt keinen zweiten Abschluss. Erst
  // wenn er wieder anfaengt und erneut durchkommt, steht ein zweiter da.
  if (entry.completed && !warBereitsAbgeschlossen) {
    appendMediaActivity(entry, url, "Abgeschlossen");
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
      // Von Hand abgehakte Serien bleiben in der Mediathek, auch wenn man sie
      // noch einmal ansieht. Zurueck holt sie nur, was wirklich neu ist.
      completed: eintrag.completedManually ? eintrag.completed : false,
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
    updatedAt: eintrag?.lastWatchedAt || new Date().toISOString(),
    from: geraetName || ""
  };
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
    watchpartyAt: stand.updatedAt
  };

  if (ziel && ziel !== lokal.url) {
    const identity = episodeIdentity(ziel);
    aenderung.url = ziel;
    aenderung.normalizedUrl = normalizeFavoriteUrl(ziel);
    aenderung.season = identity?.season || stand.season || lokal.season || 0;
    aenderung.episode = identity?.episode || stand.episode || lokal.episode || 0;
  }
  if (!aenderung.completed && !aenderung.episodeCompleted) {
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

module.exports = {
  watchpartyStandUebernehmen,
  watchpartyStand,
  eintragFinden,
  favoritNachziehen,
  repairTrimmedSeriesTail,
  kennungErzeugen,
  nachVornHolen,
  absoluteHttpUrl,
  unplayableEpisodeSet,
  nextEpisodeContinueUrl,
  darfNaechsteFolgeSein,
  appendMediaActivity,
  hasNewEpisodeAfterCompletedFavorite,
  nextEpisodeAfterFavoriteUrl,
  favoriteReplacementKey,
  favoriteMatchesCurrentProviderTitle,
  mediaDiagnosticDecisionText,
  applyFavoriteSeriesBounds,
  medienStandVerbuchen,
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
  firstEpisodeUrl,
  isFavoriteProgressUrl,
  isTrackableMediaUrl,
  titelAusSlug,
  cleanBaseMediaTitle,
  sanitizePositiveNumber,
  sanitizeProgress,
  isCompletedProgress,
  hasContinueProgressRecord,
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
