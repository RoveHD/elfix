"use strict";

// Schluessel fuer Adressen und Titel.
//
// Von diesem Modul ist nur noch uebrig, was ueberall in der App gebraucht
// wird, um dieselbe Seite wiederzuerkennen: die Watchparty prueft damit, ob
// zwei Geraete bei derselben Folge stehen, die Mediathek erkennt Doppelte.
//
// Die Bewertung von Empfehlungen stand frueher ebenfalls hier. Sie ist nach
// empfehlung.js gewandert und dort um Reihen, Sitzung, Dubletten und
// Muedigkeit erweitert worden - zwei Bewertungen nebeneinander waeren zwei
// Wahrheiten gewesen.

// Titel und Adressen so vereinheitlichen, dass derselbe Titel nicht zweimal
// vorgeschlagen wird - und nichts, was schon in der Liste steht.
function urlSchluessel(value) {
  try {
    const url = new URL(String(value || ""));
    const pfad = url.pathname
      .replace(/\/(?:staffel|season)-\d+(?:\/(?:episode|folge)-\d+)?\/?$/i, "")
      .replace(/\/+$/, "");
    return `${url.host}${pfad}`.toLowerCase();
  } catch {
    return String(value || "").trim().toLowerCase();
  }
}

function titelSchluessel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

module.exports = { urlSchluessel, titelSchluessel };
