"use strict";

/*
 * Return YouTube Dislike auf Android/TV.
 *
 * Das Gegenstueck zur Desktop-Verkabelung in main.js: Der gemeinsame Parser
 * und das Seitenskript kommen aus youtube-dislikes.js; diese Datei macht nur
 * den Abruf ueber den Kern, weil eine YouTube-Seite die fremde API wegen CORS
 * nicht selbst lesen darf. Es werden keine Stimmen und keine Klicks gesendet.
 */
(function () {
  const dislikes = require("youtube-dislikes");
  const youtube = require("youtube");
  const FRIST_MS = 4000;
  const ALTER_MS = 30 * 60 * 1000;
  const gedaechtnis = new Map();

  function mitFrist(versprechen, ms) {
    return Promise.race([
      versprechen,
      new Promise((_, verwerfen) => setTimeout(() => verwerfen(new Error("Zeitlimit")), ms))
    ]);
  }

  async function holen(videoId) {
    const gemerkt = gedaechtnis.get(videoId);
    if (gemerkt && Date.now() - gemerkt.zeit < ALTER_MS) return gemerkt.daten;
    let daten = null;
    try {
      const adresse = dislikes.anfrageUrl(videoId);
      if (adresse) {
        const antwort = await mitFrist(fetch(adresse, { cache: "no-store" }), FRIST_MS);
        if (antwort && antwort.ok) daten = dislikes.datenAus(await antwort.json(), videoId);
      }
    } catch (_) {
      // Fehler, Rate-Limit und Zeitlimit sind fuer die Wiedergabe unsichtbar;
      // der leere Befund bleibt trotzdem im Cache und erzeugt keinen Sturm.
    }
    gedaechtnis.set(videoId, { daten, zeit: Date.now() });
    return daten;
  }

  async function skript(url, einstellungen) {
    try {
      if (!youtube.istYoutubeUrl(url)) return "";
      const gelesen = dislikes.einstellungenLesen(einstellungen);
      const kennung = youtube.videoKennung(url);
      if (!gelesen.enabled || !kennung || !kennung.id) return dislikes.abstellenScript();
      const daten = await holen(kennung.id);
      return daten ? dislikes.anzeigeScript(daten) : dislikes.abstellenScript();
    } catch (_) {
      return "";
    }
  }

  module.exports = { skript, abschalten: dislikes.abstellenScript };
})();
