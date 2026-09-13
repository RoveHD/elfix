"use strict";

/*
 * Android-Verkabelung fuer AnimeFillerList.
 *
 * Die Zuordnung und das Parsen bleiben im geteilten Modul. Hier gibt es nur
 * den dauerhaften, atomar geschriebenen Kern-Cache und den Android-fetch aus
 * kern-host.js. Ein Ausfall der freien Quelle ist deshalb stets eine leere
 * Anreicherung und nie ein blockierender Fehler der Folgenwahl.
 */
(function () {
  const animeFiller = require("anime-filler");
  const CACHE_URL = "https://elfix.dateien/animefiller.json";
  const STUECK = 128 * 1024;
  let stand = null;
  let client = null;
  let bereit = null;

  async function laden() {
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
    if (!brief || typeof brief.teil !== "function" || typeof brief.fertig !== "function") return;
    let text;
    try { text = JSON.stringify(stand); } catch (fehler) { return; }
    const gesamt = Math.max(1, Math.ceil(text.length / STUECK));
    for (let nummer = 0; nummer < gesamt; nummer += 1) {
      brief.teil("animefiller", nummer, text.slice(nummer * STUECK, (nummer + 1) * STUECK));
    }
    brief.fertig("animefiller", gesamt);
  }

  async function vorbereiten() {
    if (client) return client;
    if (!bereit) bereit = (async () => {
      stand = await laden();
      client = animeFiller.erstellen({
        // `fetch` ist bereits Kern.nativeFetch: Cookies/CORS und die Frist
        // werden in einer Stelle behandelt, nicht in einem zweiten WebView.
        holen: (url, optionen) => fetch(url, optionen || {}),
        laden: () => stand,
        speichern
      });
      return client;
    })();
    return bereit;
  }

  async function anreichern(uebersicht, kontext) {
    try {
      const wert = await (await vorbereiten()).anreichern(uebersicht || {}, kontext || {});
      return wert && typeof wert === "object" ? wert : (uebersicht || {});
    } catch (fehler) {
      return uebersicht || {};
    }
  }

  module.exports = { anreichern };
})();
