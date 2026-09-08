"use strict";

/**
 * Fasst viele Cache-Aenderungen zu einem spaeten Schreibvorgang zusammen und
 * laesst ihn ruhen, solange eine kurze, ruckelfreie Bedienphase Vorrang hat.
 */
function erstellen({ wartenMs, gesperrt, schreiben, uhrStellen = setTimeout, uhrLoeschen = clearTimeout }) {
  let uhr = null;
  let ausstehend = false;

  function ausfuehren() {
    uhr = null;
    if (!ausstehend || gesperrt()) return;
    ausstehend = false;
    schreiben();
  }

  function planen() {
    ausstehend = true;
    if (uhr || gesperrt()) return;
    uhr = uhrStellen(ausfuehren, wartenMs);
    uhr?.unref?.();
  }

  function freigeben() {
    if (ausstehend) planen();
  }

  function sofort() {
    if (uhr) uhrLoeschen(uhr);
    uhr = null;
    if (!ausstehend) return;
    ausstehend = false;
    schreiben();
  }

  return { planen, freigeben, sofort };
}

module.exports = { erstellen };
