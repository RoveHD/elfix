"use strict";

/*
 * SponsorBlock auf Android - die Verkabelung, nicht die Entscheidung.
 *
 * Entschieden wird in `sponsorblock.js`, demselben Modul wie am Rechner: was
 * ein gueltiges Segment ist, welche Kategorien gelten, wann gesprungen wird und
 * wie das Skript aussieht, das in der YouTube-Seite laeuft. Hier steht das
 * Gegenstueck zu main.js - woher die Segmente kommen und was Java bekommt.
 *
 * Zwei Punkte sind hier anders geloest als am Rechner:
 *
 *   Der Abruf  laeuft ueber die Bruecke nach Java (window.fetch im Kern ist
 *              genau das). Ein Zeitlimit bringt dieser fetch nicht mit - er
 *              kennt kein `signal` -, also steht es hier als Wettlauf gegen
 *              einen Zeitgeber. Ohne das haengt im schlechtesten Fall die
 *              Antwort, und die Wiedergabe wartete auf einen fremden Dienst.
 *
 *   Das Ergebnis geht als fertiges Skript zurueck. Java spielt es ein; ein
 *              Java-Gegenstueck zu skipScript gaebe es damit nicht - und genau
 *              solche Doppelungen sind der Grund, warum es diesen Kern gibt.
 *
 * Der Zwischenspeicher liegt hier und nicht in Java: er gehoert zum Abruf, und
 * beide zusammen sind fuenfzehn Zeilen.
 */
(function () {
  const sponsorblock = require("sponsorblock");
  const youtube = require("youtube");

  const FRIST_MS = 4000;
  const ALTER_MS = 30 * 60 * 1000;

  /** videoId -> { segmente, zeit }. Auch das Nichtergebnis wird gemerkt. */
  const gedaechtnis = new Map();

  function mitFrist(versprechen, ms) {
    return Promise.race([
      versprechen,
      new Promise((_, verwerfen) => setTimeout(() => verwerfen(new Error("Zeitlimit")), ms))
    ]);
  }

  async function segmenteHolen(videoId) {
    const gemerkt = gedaechtnis.get(videoId);
    if (gemerkt && Date.now() - gemerkt.zeit < ALTER_MS) return gemerkt.segmente;

    let segmente = [];
    try {
      const adresse = sponsorblock.anfrageUrl(sponsorblock.hashPraefix(videoId));
      if (adresse) {
        const antwort = await mitFrist(fetch(adresse, { cache: "no-store" }), FRIST_MS);
        // Kein Treffer ist ein normaler Zustand: zu diesem Praefix hat noch
        // niemand etwas eingetragen.
        if (antwort && antwort.ok) {
          segmente = sponsorblock.segmenteAus(await antwort.json(), videoId);
        }
      }
    } catch (fehler) {
      // Kein Netz, ein Zeitlimit, eine unerwartete Antwort: alles dasselbe
      // Ergebnis. Gemerkt wird es trotzdem - sonst faellt bei jedem Rahmen
      // eine neue Anfrage an, die genauso ausgeht.
    }
    gedaechtnis.set(videoId, { segmente, zeit: Date.now() });
    return segmente;
  }

  /**
   * Das Skript fuer diese Seite - oder das Abschalten.
   *
   * <p>Gibt "" zurueck, wenn hier gar kein YouTube laeuft. Java spielt dann
   * nichts ein, und ein anderer Anbieter bekommt nie ein Skript zu sehen, das
   * an fremden Sekunden herumspringt.
   */
  async function skript(url, einstellungen) {
    try {
      if (!youtube.istYoutubeUrl(url)) return "";
      const gelesen = sponsorblock.einstellungenLesen(einstellungen);
      const kennung = youtube.videoKennung(url);
      const kategorien = sponsorblock.kategorienAus(gelesen);
      // Ausgeschaltet oder keine Kategorie gewaehlt: dann wird nicht gefragt,
      // und was noch in der Seite haengt, hoert auf.
      if (!kennung || !kennung.id || !kategorien.length) return sponsorblock.abschaltenScript();

      const alle = await segmenteHolen(kennung.id);
      return sponsorblock.skipScript(sponsorblock.gefiltert(alle, gelesen), {
        hinweis: gelesen.hinweis,
        videoId: kennung.id
      });
    } catch (fehler) {
      // Ein Fehler hier darf die Wiedergabe nicht beruehren - kein Skript ist
      // genau der Zustand, den es vorher gab.
      return "";
    }
  }

  function abschalten() {
    return sponsorblock.abschaltenScript();
  }

  /** Ob zu dieser Adresse ueberhaupt gefragt wird - Java spart sich den Gang. */
  function betrifft(url) {
    try {
      return Boolean(youtube.istYoutubeUrl(url) && youtube.videoKennung(url));
    } catch (fehler) {
      return false;
    }
  }

  module.exports = {
    skript,
    abschalten,
    betrifft,
    MELDE: sponsorblock.MELDE
  };
})();
