"use strict";

/*
 * Der gemeinsame Pruefstand fuer die Fortschrittsregel.
 *
 * Dass Desktop und Android dieselbe Datei laden, sagt fuer sich noch nicht,
 * dass auch dasselbe herauskommt: die eine Seite laeuft in Node, die andere in
 * einem WebView, und schon eine abweichende Zeitzone oder ein anderes
 * Zahlenformat koennte den Unterschied machen. Deshalb faehrt hier beides
 * dieselben Faelle aus derselben Datei durch dieselbe Auswertung.
 *
 * Die Kurzform ist bewusst knapp gehalten - "S3E8 offen weiter=ja folgen=1".
 * Sie muss sich in einer Logzeile vergleichen lassen, denn auf dem Telefon ist
 * das der einzige Weg, an das Ergebnis zu kommen.
 */

const fortschritt = require("./fortschritt");

// Wie ein Ergebnis aussieht, wenn man es in eine Zeile schreiben will.
function kurzform(eintrag) {
  if (!eintrag) return "kein Eintrag";
  const staffel = Number(eintrag.season) || 0;
  const folge = Number(eintrag.episode) || 0;
  const stand = eintrag.completed ? "abgeschlossen" : "offen";
  const weiter = eintrag.continuePending ? "ja" : "nein";
  const folgen = Array.isArray(eintrag.completedEpisodes) ? eintrag.completedEpisodes.length : 0;
  return `S${staffel}E${folge} ${stand} weiter=${weiter} folgen=${folgen}`;
}

// Ein Fall: Ausgangsstand herstellen, verbuchen, Kurzform bilden.
function fahreFall(proben, fall) {
  const stand = fall.mitStand
    ? [Object.assign(JSON.parse(JSON.stringify(proben.stand)), fall.standAenderung || {})]
    : [];
  const ergebnis = fortschritt.medienStandVerbuchen({
    favoriten: stand,
    aktiverFavoritId: "",
    watchpartyFuehrt: Boolean(fall.watchpartyFuehrt)
  }, proben.anbieter, fall.url, fall.meta || {}, {});
  return kurzform(ergebnis.eintrag);
}

/**
 * Faehrt alle Faelle und vergleicht mit dem, was danebensteht.
 *
 * @returns {{name: string, ist: string, soll: string, ok: boolean}[]}
 */
function fahre(proben) {
  return (proben.faelle || []).map((fall) => {
    let ist;
    try {
      ist = fahreFall(proben, fall);
    } catch (fehler) {
      ist = "Fehler: " + (fehler && fehler.message ? fehler.message : fehler);
    }
    return { name: fall.name, ist, soll: fall.erwartet, ok: ist === fall.erwartet };
  });
}

/** Eine Zeile, die sich im Logbuch des Telefons lesen laesst. */
function bericht(ergebnisse) {
  const durch = ergebnisse.filter((e) => e.ok).length;
  const abweichungen = ergebnisse
    .filter((e) => !e.ok)
    .map((e) => `${e.name}: ist "${e.ist}", soll "${e.soll}"`);
  return {
    bestanden: durch,
    gesamt: ergebnisse.length,
    zeile: `${durch}/${ergebnisse.length} Proben stimmen`
      + (abweichungen.length ? " | ABWEICHUNG " + abweichungen.join(" | ") : ""),
    abweichungen
  };
}

/** Beides in einem Zug - was die Android-App aus einem einzigen Aufruf braucht. */
function pruefen(proben) {
  return bericht(fahre(proben));
}

module.exports = { kurzform, fahre, bericht, pruefen };
