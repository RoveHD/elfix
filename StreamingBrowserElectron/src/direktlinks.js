"use strict";

/*
 * Welcher Hoster ueberhaupt gefragt wird.
 *
 * Eine Folgenseite bietet mehrere an - bei AniWorld stehen sie als Kaecheln
 * unter dem Player, je Synchronfassung eine eigene Reihe. Bevor irgendetwas
 * aufgeloest werden kann, muss also feststehen, welcher Link gemeint ist. Genau
 * das steht hier: das Skript, das die Liste aus der Seite holt, und die Regel,
 * nach der daraus einer wird.
 *
 * <h2>Warum die Regel nicht "der erste" ist</h2>
 *
 * Die Reihenfolge auf der Seite gehoert dem Anbieter, nicht dem Zuschauer. Sie
 * wechselt, sie kennt keine Fassungen, und sie stellt gern nach vorn, was gerade
 * beworben wird. Entschieden wird deshalb nach drei Dingen, in dieser
 * Reihenfolge:
 *
 *   1. Sichtbar. Die Kaecheln der *nicht* gewaehlten Fassung stehen im
 *      Quelltext genauso da wie die der gewaehlten - nur eben verborgen. Wer
 *      das uebergeht, holt die japanische Fassung, waehrend auf dem Schirm
 *      Deutsch ausgewaehlt ist. Dieselbe Unterscheidung trifft fassung.js.
 *   2. Die gewuenschte Fassung, falls eine gemerkt ist.
 *   3. Der Hoster, den die Aufloesung wirklich lesen kann.
 *
 * <h2>Punkt 3 ist eine Auskunft ueber uns, nicht ueber die Hoster</h2>
 *
 * VOE steht vorn, weil direktquelle.js seinen Block auspacken kann; Vidoza und
 * Streamtape folgen, weil ihre Angaben offen im Quelltext stehen. Doodstream
 * steht hinten, denn dort fuehrt der Weg ueber einen zweiten Abruf mit einem
 * Einmalschluessel - den geht dieses ELFIX (noch) nicht. Ein Hoster, der hier
 * nicht steht, ist damit nicht ausgeschlossen: er kommt nach den bekannten
 * dran, und wenn seine Seite die Adresse hergibt, laeuft er.
 *
 * Wird nichts gefunden, ist das kein Fehler, sondern die Ansage, es beim
 * Rahmen des Hosters zu belassen.
 */

/**
 * Die Hoster in der Reihenfolge, in der die Aufloesung mit ihnen zurechtkommt.
 * Kleingeschrieben, verglichen wird als Teilzeichenkette - "VOE.SX" und
 * "Voe" sind derselbe Hoster.
 */
const HOSTER_REIHE = ["voe", "vidoza", "streamtape", "filemoon", "luluvdo", "doodstream", "dood"];

/** Der Rang eines Hosters; unbekannte kommen nach den bekannten. */
function hosterRang(name) {
  const wert = String(name || "").toLowerCase();
  for (let i = 0; i < HOSTER_REIHE.length; i += 1) {
    if (wert.includes(HOSTER_REIHE[i])) return i;
  }
  return HOSTER_REIHE.length;
}

/**
 * Ein Eintrag, wie das Skript ihn liefert - auf das Noetige beschnitten.
 *
 * Beschnitten wird, weil der Text aus einer fremden Seite kommt: ein Hostername
 * ist ein Wort und keine Seite Text.
 */
function eintragNormalisieren(roh) {
  const adresse = String(roh?.adresse || "").trim();
  if (!adresse) return null;
  return {
    adresse,
    hoster: String(roh?.hoster || "").trim().slice(0, 40),
    sprache: String(roh?.sprache || "").trim().slice(0, 20),
    sichtbar: Boolean(roh?.sichtbar)
  };
}

/**
 * Die Liste, geordnet - und zwar vollstaendig, nicht nur ihr Kopf.
 *
 * Zurueck kommt die ganze Reihenfolge und nicht nur der Sieger, weil der
 * Aufrufer sie braucht: gibt der erste Hoster nichts her, ist der zweite dran.
 * Ein Aufloesungsversuch ist billig, ein Zuschauer vor einem schwarzen Bild
 * ist teuer.
 */
function linksOrdnen(liste, wunschSprache = "") {
  const eintraege = (Array.isArray(liste) ? liste : [])
    .map(eintragNormalisieren)
    .filter(Boolean);

  const gesehen = new Set();
  const einmalig = eintraege.filter((eintrag) => {
    if (gesehen.has(eintrag.adresse)) return false;
    gesehen.add(eintrag.adresse);
    return true;
  });

  const wunsch = String(wunschSprache || "").trim();
  const punkte = (eintrag) => (eintrag.sichtbar ? 0 : 2) + (wunsch && eintrag.sprache !== wunsch ? 1 : 0);

  return einmalig
    .map((eintrag, stelle) => ({ eintrag, stelle }))
    .sort((links, rechts) => {
      const abstand = punkte(links.eintrag) - punkte(rechts.eintrag);
      if (abstand) return abstand;
      const rang = hosterRang(links.eintrag.hoster) - hosterRang(rechts.eintrag.hoster);
      if (rang) return rang;
      return links.stelle - rechts.stelle;
    })
    .map((eintrag) => eintrag.eintrag);
}

/** Der eine Link, mit dem angefangen wird. */
function besterLink(liste, wunschSprache = "") {
  return linksOrdnen(liste, wunschSprache)[0] || null;
}

/**
 * Das Skript, das die Liste aus der Folgenseite holt.
 *
 * Es laeuft im Hauptdokument des Anbieters, nicht im Rahmen des Hosters - dort
 * stehen die Kaecheln. Gesucht wird an zwei Stellen, weil die Anbieter es
 * unterschiedlich halten: der Link selbst (`/redirect/…`) und die Kachel, die
 * ihr Ziel als Attribut traegt.
 *
 * "Sichtbar" wird an `offsetParent` gemessen und nicht an einer Klasse: wie
 * eine Seite ihre nicht gewaehlte Fassung wegblendet, ist ihre Sache, aber
 * weggeblendet ist weggeblendet.
 */
function hosterlinkScript() {
  return `(() => {
    const raus = [];
    const gesehen = new Set();
    const nimm = (knoten, adresse) => {
      if (!adresse || gesehen.has(adresse)) return;
      gesehen.add(adresse);
      const kachel = knoten.closest("li, .generateInlinePlayer, .hosterSiteVideo li") || knoten;
      const name = kachel.querySelector("h4, .hoster, [class*='oster']");
      const beschriftung = String((name && name.textContent) || kachel.getAttribute("title") || "").trim();
      // Der Hostername steht als Ueberschrift in der Kachel. Fehlt er, taugt
      // die Adresse selbst als Auskunft - aber nur die des Anbieters, denn
      // "/redirect/123" nennt keinen Hoster. Dann bleibt es leer, und die
      // Reihenfolge entscheidet.
      raus.push({
        adresse,
        hoster: beschriftung.slice(0, 40),
        sprache: String(kachel.getAttribute("data-lang-key") || ""),
        sichtbar: Boolean(kachel.offsetParent) || kachel.getClientRects().length > 0
      });
    };
    document.querySelectorAll("a[href*='/redirect/'], a.watchEpisode").forEach((knoten) => {
      nimm(knoten, knoten.href || "");
    });
    document.querySelectorAll("[data-link-target]").forEach((knoten) => {
      const ziel = knoten.getAttribute("data-link-target") || "";
      if (!ziel) return;
      try { nimm(knoten, new URL(ziel, location.href).href); } catch (_) {}
    });
    return JSON.stringify(raus.slice(0, 40));
  })()`;
}

module.exports = {
  hosterlinkScript,
  linksOrdnen,
  besterLink,
  hosterRang,
  HOSTER_REIHE
};
