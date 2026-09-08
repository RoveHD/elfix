"use strict";

// Seitenmeldungen kommen im Sekundentakt. Nur bei ihrem Ausbleiben werden
// erneut alle Medienframes abgefragt; laufende Proben werden nicht verdoppelt.
function erstellen({ jetzt = Date.now, frischMs = 4000 } = {}) {
  const staende = new WeakMap();
  function stand(ansicht, kontext) {
    let wert = staende.get(ansicht);
    if (!wert || wert.kontext !== kontext) {
      wert = { kontext, gemeldet: -Infinity, folge: 0, offen: null };
      staende.set(ansicht, wert);
    }
    return wert;
  }
  function melden(ansicht, kontext) {
    const wert = stand(ansicht, kontext);
    wert.gemeldet = jetzt();
    wert.folge += 1;
  }
  function beginnen(ansicht, kontext) {
    const wert = stand(ansicht, kontext);
    const alter = jetzt() - wert.gemeldet;
    if (wert.offen || (alter >= 0 && alter < frischMs)) return null;
    const probe = { wert, folge: wert.folge };
    wert.offen = probe;
    return probe;
  }
  function beenden(ansicht, kontext, probe) {
    const wert = staende.get(ansicht);
    if (!probe || wert !== probe.wert || wert.kontext !== kontext || wert.offen !== probe) return false;
    wert.offen = null;
    // Eine waehrend der Abfrage eingetroffene Seitenmeldung ist neuer.
    return wert.folge === probe.folge;
  }
  function verwerfen(ansicht) { staende.delete(ansicht); }
  return { melden, beginnen, beenden, verwerfen };
}

module.exports = { erstellen };
