"use strict";

// Android wiring; parsing, ranking and redirect rules stay in the desktop modules.
const lauf = require("./direktlauf");
const links = require("./direktlinks");
const folgen = require("./direktfolgen");
const fortschritt = require("./fortschritt");
const beobachtung = require("./direktbeobachtung");
let offen = null;

// Older Android TV WebViews have AbortController but not these static helpers.
if (!AbortSignal.timeout) AbortSignal.timeout = function (ms) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
};
if (!AbortSignal.any) AbortSignal.any = function (signals) {
  const controller = new AbortController();
  const abort = () => {
    controller.abort();
    signals.forEach(signal => signal.removeEventListener("abort", abort));
  };
  signals.forEach(signal => signal.addEventListener("abort", abort, { once: true }));
  if (signals.some(signal => signal.aborted)) abort();
  return controller.signal;
};

function abbrechen() {
  if (offen) offen.abort();
  offen = null;
}
async function aufloesen(adresse, referer, kennung) {
  abbrechen();
  const controller = new AbortController();
  offen = controller;
  try {
    return await lauf.erstellen({
      kennung,
      holen: (url, options) => fetch(url, { ...options, maxBytes: lauf.HOECHSTGROESSE })
    }).aufloesen(adresse, referer, { signal: controller.signal });
  } finally {
    if (offen === controller) offen = null;
  }
}

function ordnen(liste, sprache) { return links.linksOrdnen(liste, sprache || "de"); }
function naechste(stand, adresse) {
  return folgen.naechste(stand, fortschritt.episodeIdentity(adresse));
}
function naechsteStaffel(stand, adresse) {
  const jetzt = fortschritt.episodeIdentity(adresse);
  if (!jetzt || !stand || !(stand.folgen || []).some(f => folgen.istLaufende(f, jetzt))) return null;
  if (naechste(stand, adresse)) return null;
  return (stand.staffeln || []).filter(s => Number(s.staffel) > jetzt.season && s.url)
    .sort((a, b) => a.staffel - b.staffel)[0] || null;
}
async function pruefen(adresse, seite, kennung) {
  abbrechen();
  const controller = new AbortController();
  offen = controller;
  const kopfzeilen = lauf.kopfzeilenFuer(seite, kennung);
  try {
    const ok = await beobachtung.playlistPruefen(
      (url, options) => fetch(url, { ...options, maxBytes: lauf.HOECHSTGROESSE }),
      adresse, kopfzeilen, AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]));
    return ok >= 120 ? { ok: true, quelle: { adresse, typ: "hls" }, kopfzeilen } : { ok: false };
  } finally { if (offen === controller) offen = null; }
}
function befehlJetzt(urteil) {
  const e = urteil.ereignis;
  return { ...urteil, position: e ? require("./watchparty-sync").zielZeitBerechnen(e, Date.now() + (e.versatz || 0)) : urteil.position };
}
function intro(marke, position) {
  const regeln = require("./marken");
  return { sichtbar: regeln.markePasst(marke, position), ziel: regeln.zielZeit(marke, position) };
}
module.exports = { aufloesen, abbrechen, ordnen, naechste, naechsteStaffel, pruefen, befehlJetzt, intro };
