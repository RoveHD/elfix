"use strict";

// Was beim Geraeteabgleich mit einem Stand geschieht.
//
// Bis hierher stand das in main.js und war damit an Electron gebunden - was
// bedeutete, dass das Telefon es ein zweites Mal haette schreiben muessen. Zwei
// Abschriften derselben Regel laufen auseinander, sobald nur eine gepflegt
// wird, und bei einem Abgleich faellt das nicht einmal auf: beide Geraete
// melden "verbunden", und trotzdem kommt drueben etwas anderes an.
//
// Deshalb steht es jetzt hier, und beide benutzen es. Das Modul kennt weder
// Electron noch die Ablage: alles, was es von aussen braucht, kommt als
// Umgebung herein - die Favoritenliste selbst, der Anbieter zu einer Adresse,
// die Saeuberung eines frisch angelegten Eintrags. Dadurch laesst es sich ohne
// laufende App pruefen, und Android reicht dieselben vier Rueckrufe herein.
//
// Die Regeln sind unveraendert aus main.js uebernommen. Insbesondere:
//
//   - Der Titelschluessel entsteht aus Titel und Medientyp, nie aus der
//     Adresse: S.to laeuft hier ueber eine IP und dort ueber die Domain.
//   - Ohne passenden Anbieter entsteht kein Eintrag. Eine Karte, die sich
//     nicht oeffnen laesst, ist schlechter als keine.
//   - Beim selben Wirt passt die Adresse direkt, sonst wird nur die Folge auf
//     die eigene Adresse umgeschrieben.
//   - "Von Hand abgehakt" geht nur mit, wo es auch stimmen kann.
//   - Ein Titelbild nur, wo hier keines ist.

const fortschritt = require("./fortschritt");
const providerModel = require("../shared/provider-model");
const taste = require("./taste");
const schluesselModul = require("./geraete-schluessel");

/**
 * Der Schluessel, unter dem ein Titel auf jedem Geraet zu finden ist.
 *
 * <p>Die Adresse taugt dafuer nicht: derselbe Anbieter ist hier unter einer IP
 * und dort unter seiner Domain erreichbar. Titel und Medientyp sind dagegen
 * ueberall dieselben.
 */
function titelSchluessel(favorit) {
  const titel = fortschritt.cleanBaseMediaTitle(favorit?.title, favorit?.url) || favorit?.title || "";
  const schluessel = taste.titelSchluessel(titel);
  if (!schluessel) return "";
  return `${favorit?.type || fortschritt.inferMediaType(favorit?.url) || "serie"}:${schluessel}`;
}

/**
 * Der private Eintrag zu diesem Titel.
 *
 * <p>Ausdruecklich ohne die der Watchparty: derselbe Anime kann in zwei Raeumen
 * und einmal privat dastehen, und nur der private gehoert diesem Abgleich.
 */
function eintragFinden(favoriten, key) {
  return (favoriten || []).find((favorit) => !String(favorit?.watchpartyRoom || "")
    && titelSchluessel(favorit) === key) || null;
}

/**
 * Alles Private, je Titel einmal.
 *
 * <p>Steht derselbe Titel mehrfach in der Liste, zaehlt der vorderste: die
 * Liste ist nach zuletzt geoeffnet sortiert, und hinten liegt in dem Fall eine
 * Karteileiche.
 */
function staende(favoriten) {
  const liste = [];
  const gesehen = new Set();
  for (const favorit of favoriten || []) {
    if (String(favorit?.watchpartyRoom || "")) continue;
    const key = titelSchluessel(favorit);
    if (!key || gesehen.has(key)) continue;
    gesehen.add(key);
    liste.push(schluesselModul.stand({ ...favorit, key }));
  }
  return liste;
}

/**
 * Die Titel, die es hier gibt, die aber bewusst nicht abgeglichen werden.
 *
 * <p>Der Stand einer Watchparty gehoert der Runde und nicht diesem Konto -
 * deshalb laesst {@link staende} raumgebundene Eintraege aus. Das ist richtig
 * und war trotzdem gefaehrlich: der Abgleich leitet aus dem, was in seiner
 * Liste <em>fehlt</em>, ab, was hier geloescht wurde. Ein Titel, der nur
 * zurueckgehalten wird, sah damit aus wie einer, den jemand weggeworfen hat -
 * und ging als Grabstein an alle anderen Geraete.
 *
 * <p>Am 25.08.2026 hat genau das einen Bestand gekostet. "Zurueckgehalten" und
 * "geloescht" sind seither zwei verschiedene Auskuenfte.
 */
function zurueckgehalten(favoriten) {
  const keys = new Set();
  for (const favorit of favoriten || []) {
    if (!String(favorit?.watchpartyRoom || "")) continue;
    const key = titelSchluessel(favorit);
    if (key) keys.add(key);
  }
  return [...keys];
}

/** Ein Eintrag, wie ihn ein Stand von einem anderen Geraet hergibt. */
function erzeugen(stand, provider, umgebung = {}) {
  const url = fortschritt.absoluteHttpUrl(stand?.url || "", provider.startUrl || "");
  if (!url) return null;
  const identity = fortschritt.episodeIdentity(url);
  const normalisieren = umgebung.normalisieren || ((wert) => wert);
  return normalisieren({
    id: (umgebung.kennung || fortschritt.kennungErzeugen)(),
    providerId: provider.id,
    providerName: provider.name || stand?.providerName || "",
    title: fortschritt.cleanTitle(stand?.title || url),
    url,
    normalizedUrl: fortschritt.normalizeFavoriteUrl(url),
    favicon: "",
    thumbnail: stand?.thumbnail || "",
    // Ein eigenes Bild gehoert zum Titel. Es kommt nicht ueber den Abgleich,
    // aber wenn es hier schon zu dieser Serie liegt, gilt es auch hier.
    customThumbnail: (umgebung.eigenesBild || (() => ""))(url),
    customThumbnailCrop: (umgebung.bildAusschnitt || (() => null))(url),
    logo: provider.logo || "",
    favorite: stand?.favorite !== false,
    watched: Boolean(stand?.watched),
    completed: Boolean(stand?.completed),
    completedManually: Boolean(stand?.completedManually && stand?.completed),
    completedAt: String(stand?.completedAt || ""),
    episodeCompleted: Boolean(stand?.episodeCompleted),
    continuePending: Boolean(stand?.continuePending),
    hideFromContinueWatching: Boolean(stand?.hideFromContinueWatching),
    completedEpisodes: Array.isArray(stand?.completedEpisodes) ? stand.completedEpisodes : [],
    progress: fortschritt.sanitizeProgress(stand?.progress),
    duration: fortschritt.sanitizePositiveNumber(stand?.duration),
    position: fortschritt.sanitizePositiveNumber(stand?.position),
    currentTime: fortschritt.sanitizePositiveNumber(stand?.position),
    type: fortschritt.normalizeMediaType(stand?.type || fortschritt.inferMediaType(url)),
    season: identity?.season || stand?.season || 0,
    episode: identity?.episode || stand?.episode || 0,
    finalSeason: fortschritt.sanitizePositiveNumber(stand?.finalSeason),
    finalEpisode: fortschritt.sanitizePositiveNumber(stand?.finalEpisode),
    libraryOrder: stand?.libraryOrder == null ? null : Number(stand.libraryOrder),
    // Der eigene Bestand, kein Raum.
    watchpartyRoom: "",
    createdAt: String(stand?.createdAt || new Date().toISOString()),
    lastWatchedAt: String(stand?.lastWatchedAt || ""),
    activity: []
  });
}

/**
 * Ein Stand vom anderen Geraet.
 *
 * <p>Zurueck kommt der Stand, wie er danach *hier* gilt - nicht der, der
 * hereinkam. Der Unterschied ist der Grund, warum sich zwei Geraete nicht
 * gegenseitig aufschaukeln: die Adresse ist auf jedem eine andere, und der
 * Titel geht durch die eigene Saeuberung. Wer sich das Empfangene merkte,
 * faende beim naechsten Takt einen Unterschied und meldete ihn wieder hinaus.
 *
 * @returns {{stand: object, neu: boolean, folgestand: boolean}|null}
 */
function uebernehmen(stand, umgebung = {}) {
  const favoriten = umgebung.favoriten || [];
  const key = String(stand?.key || "");
  if (!key) return null;
  const lokal = eintragFinden(favoriten, key);

  if (!lokal) {
    // Ohne passenden Anbieter waere der Eintrag eine Karte, die sich nicht
    // oeffnen laesst. Dann lieber keine.
    const provider = (umgebung.anbieterFuer || (() => null))(stand.url || "", stand.providerName);
    if (!provider) return null;
    const neu = erzeugen(stand, provider, umgebung);
    if (!neu) return null;
    favoriten.unshift(neu);
    return {
      stand: schluesselModul.stand({ ...neu, key }),
      neu: true,
      eintrag: neu,
      // Hat das andere Geraet eine Folge zu Ende geschaut, gehoert der eigene
      // Eintrag auf die naechste - sonst verschwindet er aus "Weiterschauen".
      folgestand: Boolean(neu.episodeCompleted && !neu.completed)
    };
  }

  // Die Adresse ist auf jedem Geraet eine andere, sobald der Anbieter unter
  // zwei Namen erreichbar ist. Beim selben Wirt passt sie direkt, sonst wird
  // nur die Folge auf die eigene Adresse umgeschrieben - genauso wie in der
  // Watchparty.
  const gleicherAnbieter = providerModel.hostFromUrl(lokal.url).toLowerCase()
    === providerModel.hostFromUrl(stand.url || "").toLowerCase();
  const ziel = gleicherAnbieter
    ? stand.url
    : (stand.season && stand.episode
      ? fortschritt.replaceEpisodeUrl(lokal.url, stand.season, stand.episode)
      : "");
  if (ziel && ziel !== lokal.url) {
    lokal.url = ziel;
    lokal.normalizedUrl = fortschritt.normalizeFavoriteUrl(ziel);
    const identity = fortschritt.episodeIdentity(ziel);
    lokal.season = identity?.season || stand.season || lokal.season || 0;
    lokal.episode = identity?.episode || stand.episode || lokal.episode || 0;
  } else if (stand.season || stand.episode) {
    lokal.season = stand.season || lokal.season || 0;
    lokal.episode = stand.episode || lokal.episode || 0;
  }

  lokal.position = stand.position;
  lokal.currentTime = stand.position;
  lokal.duration = stand.duration || lokal.duration;
  lokal.progress = stand.progress;
  lokal.completed = stand.completed;
  lokal.episodeCompleted = stand.episodeCompleted;
  // "Von Hand abgehakt" und "abgeschlossen" schliessen einander nicht aus,
  // sondern bedingen sich. Also geht der Merker nur mit, wo er auch stimmen
  // kann.
  lokal.completedManually = Boolean(stand.completedManually && stand.completed);
  if (stand.completedAt) lokal.completedAt = stand.completedAt;
  lokal.hideFromContinueWatching = Boolean(stand.hideFromContinueWatching);
  lokal.continuePending = Boolean(stand.continuePending);
  lokal.watched = Boolean(stand.watched) || lokal.watched;
  lokal.favorite = stand.favorite !== false;
  if (stand.finalSeason) lokal.finalSeason = stand.finalSeason;
  if (stand.finalEpisode) lokal.finalEpisode = stand.finalEpisode;
  if (Array.isArray(stand.completedEpisodes)) lokal.completedEpisodes = stand.completedEpisodes;
  if (stand.libraryOrder != null) lokal.libraryOrder = stand.libraryOrder;
  if (stand.lastWatchedAt) lokal.lastWatchedAt = stand.lastWatchedAt;
  // Ein Titelbild nur, wo hier keines ist: das eigene Bild bleibt ohnehin
  // draussen, und ein Anbieterbild ist besser als gar keines.
  if (!lokal.thumbnail && stand.thumbnail) lokal.thumbnail = stand.thumbnail;

  return {
    stand: schluesselModul.stand({ ...lokal, key }),
    neu: false,
    eintrag: lokal,
    folgestand: Boolean(lokal.episodeCompleted && !lokal.completed)
  };
}

/**
 * Anderswo geloescht.
 *
 * <p>Hier gilt dasselbe wie dort: der Eintrag verschwindet, und zwar wirklich -
 * ein Grabstein liegt beim Relay, damit ihn niemand zurueckholt.
 *
 * @returns der entfernte Eintrag, oder null
 */
function entfernen(favoriten, key) {
  const lokal = eintragFinden(favoriten, key);
  if (!lokal) return null;
  const stelle = (favoriten || []).indexOf(lokal);
  if (stelle < 0) return null;
  favoriten.splice(stelle, 1);
  return lokal;
}

/**
 * Der Anbieter zu einer Adresse.
 *
 * <p>Erst ueber den Wirt, dann ueber den Namen. Der Name ist der Rueckfall fuer
 * den Fall, dass derselbe Anbieter hier unter einer anderen Adresse laeuft als
 * dort - dann passt der Wirt nicht, und der Name ist alles, was bleibt.
 *
 * <p>Uebergeben wird ausdruecklich die Liste der *eingeschalteten* Anbieter:
 * ein abgeschalteter waere eine Karte, die sich nicht oeffnen laesst.
 */
function anbieterFinden(anbieter, url, providerName) {
  const wirt = providerModel.hostFromUrl(url).toLowerCase();
  const liste = anbieter || [];
  return liste.find((eintrag) => providerModel.hostFromUrl(eintrag?.startUrl).toLowerCase() === wirt)
    || liste.find((eintrag) => String(eintrag?.name || "").toLowerCase()
      === String(providerName || "").toLowerCase())
    || null;
}

module.exports = {
  titelSchluessel,
  zurueckgehalten,
  anbieterFinden,
  eintragFinden,
  staende,
  erzeugen,
  uebernehmen,
  entfernen
};
