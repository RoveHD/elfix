"use strict";

/*
 * Sub bleibt Sub - die Verkabelung, nicht die Regel.
 *
 * Was eine Fassung ist, wann sie gemerkt wird und welche Meldung zaehlt, steht
 * in `fassung.js`, demselben Modul wie am Rechner. Hier steht nur, was am
 * Rechner in main.js liegt: unter welchem Schluessel die Fassung dieser Seite
 * gefuehrt wird, welcher Bestand gerade gilt und was davon Java zu speichern
 * hat.
 *
 * Der Bestand liegt bewusst hier und nicht in Java. Er ist ein einfaches
 * Objekt in genau der Form, die `fassungen.json` am Rechner traegt, und
 * `fassung.merken` arbeitet unmittelbar darauf - wuerde Java ihn nachbauen,
 * waere die Verdraengung der aeltesten Eintraege ein zweites Mal geschrieben
 * und liefe irgendwann anders. Java haelt die Datei, nicht ihren Inhalt.
 *
 * Eine Stelle ist auf Android einfacher als am Rechner: das Skript geht nur in
 * das Hauptdokument. Das genuegt, weil die Flaggenreihe dort steht - im Rahmen
 * des Hosters gibt es nichts zu waehlen, und `fassungScript` steigt dort von
 * sich aus wieder aus (`window.top !== window`).
 */
(function () {
  const fassung = require("fassung");
  const fortschritt = require("fortschritt");
  const taste = require("taste");

  // Der Bestand in der Form der Datei: Schluessel -> {key, roh, name, at}.
  let bestand = {};

  /** Den Bestand aus der Datei uebernehmen. Einmal beim Start. */
  function laden(eintraege) {
    bestand = eintraege && typeof eintraege === "object" ? eintraege : {};
    return Object.keys(bestand).length;
  }

  /**
   * Unter welchem Schluessel die Fassung dieser Seite liegt: der Titel, ohne
   * Staffel. Anders als beim Intro - das kann sich ab Staffel 2 aendern, die
   * Sprache, in der man eine Serie schaut, tut das nicht.
   *
   * <p>Dieselbe Ableitung wie am Rechner, damit ein abgeglichener Bestand auf
   * beiden Geraeten unter demselben Schluessel gefunden wird.
   */
  function schluesselFuer(eintraege, anbieter, url) {
    const identity = fortschritt.episodeIdentity(url);
    if (!identity) return "";
    const liste = Array.isArray(eintraege) ? eintraege : [];
    const treffer = liste.find((eintrag) => eintrag
      && eintrag.providerId === (anbieter && anbieter.id)
      && (fortschritt.episodeIdentity(eintrag.url) || {}).key === identity.key);
    return taste.titelSchluessel((treffer && treffer.title) || fortschritt.cleanBaseMediaTitle("", url));
  }

  /**
   * Das Skript, das die gemerkte Fassung anklickt - und ob ueberhaupt eines
   * noetig ist.
   *
   * <p>Ohne gemerkte Fassung wird trotzdem eingespielt: das Skript meldet dann
   * nur, was dasteht, und genau daraus lernt die erste Folge.
   */
  function skript(eintraege, anbieter, url) {
    const schluessel = schluesselFuer(eintraege, anbieter, url);
    if (!schluessel) return { skript: "", schluessel: "", name: "", wartet: false };
    const gewuenscht = fassung.lesen(bestand, schluessel);
    return {
      skript: fassung.fassungScript(gewuenscht),
      schluessel,
      name: (gewuenscht && (gewuenscht.name || gewuenscht.roh)) || "",
      // Nur wenn etwas umzustellen ist, muss der Autostart warten. Ohne
      // gemerkte Fassung gibt es nichts zu verzoegern.
      wartet: Boolean(gewuenscht)
    };
  }

  /**
   * Eine Konsolenzeile aus der Seite.
   *
   * <p>"stand" ist die Vorgabe des Anbieters und zaehlt nur, solange nichts
   * bekannt ist; "wahl" ist ein Klick und gilt immer. Zurueck kommt der neue
   * Bestand nur dann, wenn sich wirklich etwas geaendert hat - sonst schreibt
   * Java die Datei bei jedem Seitenaufruf neu.
   */
  function meldung(eintraege, anbieter, url, zeile) {
    const gelesen = fassung.meldung(zeile);
    if (!gelesen) return null;
    const schluessel = schluesselFuer(eintraege, anbieter, url);
    if (!schluessel) return null;

    const vorher = fassung.lesen(bestand, schluessel);
    const nachher = fassung.merken(bestand, schluessel, gelesen.fassung, {
      nurWennNeu: gelesen.art === "stand"
    });
    if (nachher === bestand) return null;
    bestand = nachher;

    const jetzt = fassung.lesen(bestand, schluessel);
    // Beim ersten Mal ist nichts geschehen, was eine Ansage rechtfertigt - die
    // Folge laeuft ja genau so, wie sie dasteht. Erst ein Wechsel ist eine
    // Entscheidung, von der man wissen will, dass sie gemerkt wurde.
    const ansage = gelesen.art === "wahl" && vorher && !fassung.gleich(vorher, jetzt) && jetzt && jetzt.name
      ? `${jetzt.name} gemerkt — ab der nächsten Folge steht sie vorgewählt`
      : "";
    return {
      eintraege: bestand,
      schluessel,
      art: gelesen.art,
      name: (jetzt && (jetzt.name || jetzt.roh)) || "",
      ansage
    };
  }

  /**
   * Was gemerkt wurde, fuer die Einstellungen - haeufigste Fassung zuerst.
   * Dieselbe Auskunft wie der Rechner sie unter "fassungen:stand" gibt.
   */
  function stand() {
    const namen = new Map();
    for (const schluessel of Object.keys(bestand)) {
      const name = (fassung.lesen(bestand, schluessel) || {}).name || "";
      if (name) namen.set(name, (namen.get(name) || 0) + 1);
    }
    return {
      titel: Object.keys(bestand).length,
      fassungen: [...namen.entries()]
        .sort((links, rechts) => rechts[1] - links[1])
        .map(([name, anzahl]) => ({ name, anzahl }))
    };
  }

  /** Alles vergessen. Der Aufrufer schreibt den leeren Bestand weg. */
  function vergessen() {
    const anzahl = Object.keys(bestand).length;
    bestand = {};
    return anzahl;
  }

  module.exports = {
    laden,
    skript,
    meldung,
    stand,
    vergessen,
    MELDE_STAND: fassung.MELDE_STAND,
    MELDE_WAHL: fassung.MELDE_WAHL
  };
})();
