"use strict";

/*
 * Externe Vorspann-, Rueckblick- und Abspannsegmente fuer den nativen Player.
 *
 * Die gemeinsame Regel kennt Anbieter, Cache und Normalisierung. Android
 * stellt nur seinen vorhandenen fetch-Weg bereit; damit bleiben Cookies und
 * die Netzwerkgrenzen des Kern-Hosts an einer Stelle.
 */
(function () {
  const skipsegmente = require("skipsegmente");
  const CACHE_URL = "https://elfix.dateien/skipsegmente.json";
  const STUECK = 256 * 1024;
  let stand = null;
  let client = null;
  let bereit = null;

  async function dateiLesen() {
    const abruf = window.ElfixKern && window.ElfixKern.browserAbruf;
    if (!abruf) return null;
    try {
      const antwort = await abruf(CACHE_URL, { cache: "no-store" });
      return antwort && antwort.ok ? JSON.parse(await antwort.text()) : null;
    } catch (fehler) {
      return null;
    }
  }

  function speichern(daten) {
    stand = daten;
    const brief = window.AndroidEmpfehlung;
    if (!brief || typeof brief.teil !== "function") return;
    let text;
    try { text = JSON.stringify(stand); } catch (fehler) { return; }
    const gesamt = Math.max(1, Math.ceil(text.length / STUECK));
    for (let nummer = 0; nummer < gesamt; nummer += 1) {
      brief.teil("skipsegmente", nummer, text.slice(nummer * STUECK, (nummer + 1) * STUECK));
    }
    brief.fertig("skipsegmente", gesamt);
  }

  async function vorbereiten() {
    if (client) return client;
    if (!bereit) bereit = (async () => {
      stand = await dateiLesen();
      client = skipsegmente.erstellen({
        // Die Response muss unveraendert bleiben: 429 samt Retry-After ist
        // eine Entscheidung der gemeinsamen Regel, keine Android-Ausnahme.
        holen: (url, optionen) => fetch(url, optionen || {}),
        laden: () => stand,
        speichern
      });
      return client;
    })();
    return bereit;
  }

  async function lesen(kontext) {
    try {
      const segmente = await (await vorbereiten()).lesen(kontext || {});
      return Array.isArray(segmente) ? segmente : [];
    } catch (fehler) {
      return [];
    }
  }

  module.exports = { lesen };
})();
