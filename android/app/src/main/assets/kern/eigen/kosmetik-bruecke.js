"use strict";

/*
 * Die kosmetische Filterung auf Android - wieder nur die Verkabelung.
 *
 * Was ein Werbe-Overlay ist, entscheidet `adblock-kosmetik.js`, dasselbe Modul
 * wie am Rechner: dieselben Schutzmuster, dieselbe Punktevergabe, dieselbe
 * Schwelle. Hier steht nur, wie die Meldung aus der Seite und die Antwort aus
 * Java zusammenkommen.
 *
 * Eine Stelle braucht Hilfe von aussen: `istWerbeOverlay` fragt, ob ein Ziel
 * ein Werbe-Host ist. Am Rechner beantwortet das die tsurlfilter-Engine - die
 * passt mit ihren 480 MB nicht auf einen Fernseher. Auf Android antwortet
 * stattdessen die mitgelieferte Domainliste, und weil sie in Java liegt,
 * kommen die Treffer als fertige Liste herein. Die Entscheidung selbst faellt
 * trotzdem im geteilten Modul.
 */
(function () {
  const kosmetik = require("adblock-kosmetik");

  /** Das Skript, das in der Seite die Kandidaten sucht. Einmal je Seite. */
  function seitenScript() {
    return kosmetik.seitenScript();
  }

  /**
   * Liest eine Konsolenmeldung der Seite und nennt die Hosts, die darin
   * vorkommen - Java prueft sie gegen seine Domainliste.
   *
   * @returns {{hosts: string[], anzahl: number}|null}
   */
  function kandidatenLesen(nachricht) {
    const meldung = kosmetik.meldungLesen(nachricht);
    if (!meldung || meldung.art !== "kandidaten" || !Array.isArray(meldung.daten)) return null;
    const hosts = [];
    for (const kandidat of meldung.daten) {
      for (const host of [...(kandidat.linkHosts || []), ...(kandidat.iframeHosts || [])]) {
        const sauber = String(host || "").toLowerCase();
        if (sauber && !hosts.includes(sauber)) hosts.push(sauber);
      }
    }
    return { hosts, anzahl: meldung.daten.length };
  }

  /**
   * Faellt das Urteil und gibt das Skript zurueck, das die Treffer entfernt.
   *
   * <p>Hoechstens sechs Kandidaten je Meldung - genau wie am Rechner. Wer mehr
   * auf einmal ausblendet, blendet irgendwann die Seite aus.
   */
  function urteile(nachricht, werbeHosts) {
    const meldung = kosmetik.meldungLesen(nachricht);
    if (!meldung || meldung.art !== "kandidaten" || !Array.isArray(meldung.daten)) {
      return { skript: "", entfernt: [], gruende: [] };
    }
    const menge = new Set((werbeHosts || []).map((host) => String(host || "").toLowerCase()));
    const marken = [];
    const gruende = [];
    for (const kandidat of meldung.daten.slice(0, 6)) {
      const urteil = kosmetik.istWerbeOverlay(kandidat, {
        istWerbeHost: (host) => menge.has(String(host || "").toLowerCase())
      });
      if (!urteil.entfernen) continue;
      marken.push(kandidat.marke);
      gruende.push(
        (kandidat.tag || "?")
        + (kandidat.id ? "#" + kandidat.id : "")
        + " - " + urteil.grund);
    }
    return {
      skript: marken.length ? kosmetik.entfernenAufrufScript(marken) : "",
      entfernt: marken,
      gruende
    };
  }

  module.exports = { seitenScript, kandidatenLesen, urteile, MELDE_PRAEFIX: kosmetik.MELDE_PRAEFIX };
})();
