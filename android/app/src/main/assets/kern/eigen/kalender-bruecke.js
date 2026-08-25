"use strict";

/*
 * Der Anbieterkalender auf dem Telefon - die Verkabelung, nicht die Rechnung.
 *
 * Die Rechnung steht in `kalender.js`, demselben Modul wie am Rechner: welche
 * Adressen probiert werden, wie lange eine Antwort gilt und auf welche Woche
 * gekuerzt wird. Die Parser darunter liegen ohnehin schon im gemeinsamen
 * `discover.js`. Hier steht nur das Gegenstueck zu main.js: woher der Lauf
 * seine eine Bindung bekommt - eine Anbieterseite.
 *
 * Der Abruf laeuft wie beim Empfehlungslauf ueber Java (siehe kern-host.js).
 * Das ist hier kein Umweg, sondern Voraussetzung: die Kalenderseiten liegen
 * hinter demselben Cloudflare-Schutz wie der Rest des Anbieters, und die Kekse
 * der laufenden Sitzung hat nur Java.
 */
(function () {
  const kalender = require("kalender");

  let lauf = null;
  let anbieter = [];

  function melde(stufe, text) {
    const brief = window.AndroidKern;
    if (brief && typeof brief.protokoll === "function") brief.protokoll(stufe, text);
  }

  function sicherstellen() {
    if (lauf) return lauf;
    lauf = kalender.erstellen({
      holen: async (url) => {
        try {
          const antwort = await fetch(url, {
            headers: { accept: "text/html,application/xhtml+xml,application/json" }
          });
          if (!antwort || !antwort.ok) return null;
          return { html: await antwort.text(), url: antwort.url || url };
        } catch (fehler) {
          return null;
        }
      },
      anbieter: () => anbieter,
      protokoll: (zeile) => melde("info", "Kalender " + zeile)
    });
    return lauf;
  }

  /**
   * Die eingeschalteten Anbieter nachreichen.
   *
   * <p>Sie aendern sich waehrend der Sitzung. Der Lauf fragt sie bei jedem
   * Durchgang neu ab, deshalb genuegt es, den Stand hier abzulegen.
   */
  function anbieterSetzen(neue) {
    anbieter = Array.isArray(neue) ? neue : [];
    return { anbieter: anbieter.length };
  }

  /**
   * Die Woche holen.
   *
   * <p>Kommt nichts herein - kein Netz, kein Anbieter mit Kalender -, wird die
   * letzte gehaltene Woche zurueckgegeben statt einer leeren. Was gestern galt,
   * ist naeher an der Wahrheit als "diese Woche kommt nichts"; dass es alt ist,
   * sagt die Oberflaeche dazu.
   */
  async function laden(refresh) {
    const daten = await sicherstellen().laden(Boolean(refresh));
    if (daten && daten.entries && daten.entries.length) return { ...daten, ausCache: false };
    const alt = sicherstellen().ausCache();
    if (alt && alt.entries.length) return { ...alt, ausCache: true };
    return { ...(daten || { days: [], dates: {}, entries: [] }), ausCache: false };
  }

  module.exports = { anbieterSetzen, laden };
})();
