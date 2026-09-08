"use strict";

// Reine Regel fuer den optionalen Spoiler-Schutz.
//
// Ein gespeicherter Wiedereinstieg (`position`, `progress`, `season` oder
// `episode`) ist kein Beleg, dass eine Folge gesehen wurde: Er kann aus einem
// Sprung, aus "naechste Folge" oder aus einer Watchparty stammen. Als
// persoenlicher Nachweis zaehlen daher nur ausdrueckliche Belege: die
// abgeschlossenen Folgen und der Verlauf, der festhaelt, welche Folge wann
// wirklich lief (`ausVerlauf`).

const verlauf = require("../shared/verlauf");

function positiveInteger(value) {
  if (!["number", "string"].includes(typeof value)) return 0;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function seasonNumber(value) {
  if (!["number", "string"].includes(typeof value) || String(value).trim() === "") return -1;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : -1;
}

function episodenSchluessel(value) {
  const episode = positiveInteger(value?.episode ?? value?.folge);
  if (!episode) return "";
  const season = seasonNumber(value?.season ?? value?.staffel);
  if (season < 0) return "";
  return `${season}|${episode}`;
}

/**
 * Gesehene Folgen aus dem Verlauf eines Titels.
 *
 * `completedEpisodes` entsteht nur, wenn ELFIX eine Folge selbst zu Ende
 * gespielt hat. Der Verlauf weiss mehr: er haelt fest, welche Folge wann
 * wirklich lief, und die Mediathek zeigt das laengst an. Diese Zeilen nicht zu
 * zaehlen hiess, dass eine Folge, die man nachweislich geschaut hat, im Player
 * weiter "Noch nicht gesehen" heisst.
 *
 * Die Grenze bleibt dieselbe wie in der Mediathek und steht in verlauf.js: eine
 * bloss geoeffnete Seite ist keine Wiedergabe, und ohne eindeutige Folge wird
 * nicht geraten.
 */
function ausVerlauf(activity) {
  const folgen = new Map();
  for (const eintrag of Array.isArray(activity) ? activity : []) {
    if (verlauf.NUR_GEOEFFNET.test(String(eintrag?.label || ""))) continue;
    const stelle = verlauf.folgeDesEreignisses(eintrag);
    if (!stelle) continue;
    const folge = { season: stelle.staffel, episode: stelle.folge };
    const key = episodenSchluessel(folge);
    if (key) folgen.set(key, folge);
  }
  return [...folgen.values()];
}

function abgeschlosseneFolgenSet(completedEpisodes) {
  if (completedEpisodes instanceof Set) return completedEpisodes;
  const result = new Set();
  for (const episode of Array.isArray(completedEpisodes) ? completedEpisodes : []) {
    const key = episodenSchluessel(episode);
    if (key) result.add(key);
  }
  return result;
}

function folgeIstGesehen(episode, completedEpisodes) {
  const key = episodenSchluessel(episode);
  return Boolean(key && abgeschlosseneFolgenSet(completedEpisodes).has(key));
}

// `null`, `undefined` und Objekte ohne `completedEpisodes` bedeuten bewusst
// "unbekannt". Ein leeres Array dagegen ist eine ausdrueckliche Auskunft:
// dieses Mitglied hat noch keine Folge abgeschlossen.
function mitgliedsAbschluesse(member) {
  if (Array.isArray(member) || member instanceof Set) return member;
  return Array.isArray(member?.completedEpisodes) || member?.completedEpisodes instanceof Set ? member.completedEpisodes : null;
}

function raumFolgeIstFuerAlleGesehen(episode, roomMemberCompletions) {
  const key = episodenSchluessel(episode);
  if (!key || !Array.isArray(roomMemberCompletions) || !roomMemberCompletions.length) return false;
  return roomMemberCompletions.every((member) => {
    const completedEpisodes = mitgliedsAbschluesse(member);
    return completedEpisodes !== null && abgeschlosseneFolgenSet(completedEpisodes).has(key);
  });
}

/**
 * Ob die Angaben einer Folge verborgen werden muessen.
 *
 * In einer aktiven Raum-Mindestansicht gilt der Schnitt aller explizit
 * gemeldeten Abschluesse. Fehlt auch nur einem Mitglied diese Meldung, bleibt
 * die Folge verborgen. Die aktuelle Raumposition wird absichtlich nie als
 * Abschluss interpretiert.
 */
function folgeVerbergen(optionen = {}) {
  if (!optionen.enabled || !episodenSchluessel(optionen.episode)) return false;
  if (!folgeIstGesehen(optionen.episode, optionen.completedEpisodes)) return true;
  if (optionen.roomMinimum && optionen.roomActive) {
    return !raumFolgeIstFuerAlleGesehen(optionen.episode, optionen.roomMemberCompletions);
  }
  return false;
}

/**
 * Eine Folge fuer eine sichtbare Liste vorbereiten, ohne ihre
 * Navigationsdaten zu veraendern.
 *
 * `seen` beschreibt immer nur den eigenen, explizit belegten Abschluss. In
 * einer Watchparty kann eine selbst gesehene Folge wegen des Raum-Minimums
 * trotzdem noch `spoilerProtected` sein.
 */
function protectEpisode(episode, optionen = {}) {
  const quelle = episode && typeof episode === "object" && !Array.isArray(episode) ? episode : {};
  const kontext = { ...optionen, episode: quelle };
  const seen = folgeIstGesehen(quelle, optionen.completedEpisodes);
  const spoilerProtected = folgeVerbergen(kontext);
  const projektion = { ...quelle, seen, spoilerProtected };
  if (!spoilerProtected) return projektion;

  // Text bleibt als neutrale, gleich lange Aussage sichtbar. Bildfelder werden
  // geleert statt mit einem Serienposter ersetzt: ein Serienposter gehoert zum
  // Werk, nicht zu dieser Folge, und darf nie eine Folgenaufnahme verdecken.
  for (const feld of ["titel", "title", "beschreibung", "description", "overview"]) {
    if (Object.hasOwn(quelle, feld)) projektion[feld] = "Noch nicht gesehen";
  }
  for (const feld of ["image", "imageUrl", "thumbnail"]) {
    if (Object.hasOwn(quelle, feld)) projektion[feld] = "";
  }
  return projektion;
}

function protectEpisodes(episodes, options = {}) {
  const prepared = { ...options, completedEpisodes: abgeschlosseneFolgenSet(options.completedEpisodes),
    roomMemberCompletions: (Array.isArray(options.roomMemberCompletions) ? options.roomMemberCompletions : []).map(member => {
      const completed = mitgliedsAbschluesse(member);
      return completed === null ? null : abgeschlosseneFolgenSet(completed);
    }) };
  return (Array.isArray(episodes) ? episodes : []).map(episode => protectEpisode(episode, prepared));
}
module.exports = {
  protectEpisodes,
  ausVerlauf,
  episodenSchluessel,
  abgeschlosseneFolgenSet,
  folgeIstGesehen,
  raumFolgeIstFuerAlleGesehen,
  folgeVerbergen,
  protectEpisode
};
