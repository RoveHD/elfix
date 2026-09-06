"use strict";

// Das Bild eines Suchtreffers.
//
// Die Suche geht ueber alle Anbieter gleichzeitig und zeigte ihre Treffer als
// Textzeilen. Auf der Anbieterseite steht das Bild aber unmittelbar daneben -
// im selben Verweis, den die Suche ohnehin schon ausliest. Es wurde nur nicht
// mitgenommen.
//
// Gesucht wird hier deshalb nichts nach: kein zweiter Abruf je Treffer, keine
// aus dem Namen geratene Adresse. Was herauskommt, stand in dem Stueck Markup,
// das der Treffer ohnehin ist. Findet sich dort nichts, bleibt die Karte ohne
// Bild - das ist besser als ein falsches.
//
// Dieselbe Rechnung steht auf Android in Trefferbild.java, samt derselben
// Prueffaelle (tests/trefferbildtest.js hier, TrefferbildTest.java dort). Das
// Modul kennt weder Electron noch das DOM und laesst sich damit fuer sich
// pruefen.

// Was nach einem Bild aussieht, es aber nicht ist: das Abzeichen der Sprache,
// ein Herz, das Logo der Seite, ein durchsichtiges Pixel als Platzhalter fuer
// das, was erst spaeter nachgeladen wird. Steht so etwas auf der Karte, sieht
// sie kaputter aus als ohne Bild.
const BEIWERK = /(logo|sprite|icon|favicon|avatar|placeholder|platzhalter|blank|spacer|pixel|loading|lazy[-_]?load|flagge|flags?\/|1x1|transparent)/i;

// Bilder in diesem Format sind auf diesen Seiten Symbole, keine Titelbilder.
const SYMBOLFORMAT = /\.svg(\?|$)/i;

const BILD = /<img\b([^>]*)>/gi;
const HINTERGRUND = /background(?:-image)?\s*:\s*url\(\s*["']?([^"')]+)["']?\s*\)/gi;
const DATENBILD = /(?:data-bg|data-background|data-poster|data-thumb|data-thumbnail)\s*=\s*["']([^"']+)["']/gi;

// Der Verweis samt Inhalt - so, wie er auf der Trefferseite steht.
const VERWEIS = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

// Eine Adresse aufloesen - dieselbe Regel wie im Rest der Suche. Nur http und
// https: eine eingebettete data:-Grafik ist auf einer Karte kein Titelbild,
// und ein javascript: gehoert ohnehin nirgendwohin.
function absolut(baseUrl, href) {
  try {
    const adresse = new URL(String(href || "").trim(), baseUrl);
    if (adresse.protocol !== "http:" && adresse.protocol !== "https:") return "";
    adresse.hash = "";
    return adresse.href;
  } catch {
    return "";
  }
}

// Die wenigen Entitaeten, die in einer Adresse im Markup wirklich vorkommen.
function entschluesselt(wert) {
  return String(wert || "").split("&amp;").join("&").split("&#38;").join("&").trim();
}

// Ist das ein Titelbild - oder nur Beiwerk?
function geprueft(adresse) {
  if (!adresse) return "";
  if (SYMBOLFORMAT.test(adresse)) return "";
  if (BEIWERK.test(adresse)) return "";
  return adresse;
}

function marke(angaben, name) {
  const treffer = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(String(angaben || ""));
  return treffer ? treffer[1].trim() : "";
}

// Aus einer Auswahlliste die groesste Fassung. Gemessen wird an dem, was
// danebensteht: 2x vor 1x, und bei Breitenangaben die groessere. Ohne Angabe
// zaehlt der erste brauchbare Eintrag.
function ausAuswahlliste(liste, baseUrl) {
  let beste = "";
  let bestwert = -1;
  for (const eintrag of String(liste || "").split(",")) {
    const teile = eintrag.trim().split(/\s+/);
    if (!teile.length || !teile[0]) continue;
    const adresse = geprueft(absolut(baseUrl, entschluesselt(teile[0])));
    if (!adresse) continue;
    let wert = 0;
    if (teile.length > 1 && /^[\d.]+[wx]$/i.test(teile[1])) {
      wert = Number.parseFloat(teile[1]) || 0;
    }
    if (wert > bestwert) {
      bestwert = wert;
      beste = adresse;
    }
  }
  return beste;
}

// Die beste Adresse aus einer Bildmarke. Zuerst die Auswahlliste: dort steht
// die grosse Fassung, und ein Titelbild soll auf einer Kachel nicht ausgefranst
// aussehen. Danach die verzoegerten Adressen, denn wo eine steht, ist src meist
// nur das durchsichtige Pixel. Erst zuletzt src selbst.
function ausBildmarke(angaben, baseUrl) {
  const ausListe = ausAuswahlliste(`${marke(angaben, "data-srcset")}, ${marke(angaben, "srcset")}`, baseUrl);
  if (ausListe) return ausListe;

  for (const feld of ["data-src", "data-lazy-src", "data-original", "data-image", "src"]) {
    const wert = marke(angaben, feld);
    if (!wert) continue;
    const adresse = geprueft(absolut(baseUrl, entschluesselt(wert)));
    if (adresse) return adresse;
  }
  return "";
}

// Das Titelbild aus dem Markup eines Treffers.
//
// markup  - der ganze Verweis samt Inhalt, so wie er auf der Seite steht
// baseUrl - die Seite, von der er stammt; fuer relative Adressen
function ausMarkup(markup, baseUrl) {
  const text = String(markup || "");
  if (!text) return "";

  for (const bild of text.matchAll(BILD)) {
    const gefunden = ausBildmarke(bild[1], baseUrl);
    if (gefunden) return gefunden;
  }

  // Manche Seiten legen das Titelbild als Hintergrund auf den Kasten statt als
  // eigenes Bild. Fuer den Betrachter ist das dasselbe.
  for (const hintergrund of text.matchAll(HINTERGRUND)) {
    const gefunden = geprueft(absolut(baseUrl, entschluesselt(hintergrund[1])));
    if (gefunden) return gefunden;
  }

  for (const daten of text.matchAll(DATENBILD)) {
    const gefunden = geprueft(absolut(baseUrl, entschluesselt(daten[1])));
    if (gefunden) return gefunden;
  }
  return "";
}

// Welche Adresse auf einer Trefferseite welches Bild traegt.
//
// Der Umweg ueber die ganze Seite ist noetig, weil manche Anbieter zwei
// Verweise je Treffer setzen: einen um das Bild, einen um den Titel. Die Suche
// nimmt den mit dem Titel - und stuende das Bild nur im anderen, bliebe die
// Karte leer, obwohl es auf der Seite steht.
function bilderZuAdressen(html, baseUrl) {
  const bilder = new Map();
  for (const verweis of String(html || "").matchAll(VERWEIS)) {
    const href = absolut(baseUrl, verweis[1]);
    if (!href || bilder.has(href)) continue;
    const bild = ausMarkup(verweis[2], baseUrl);
    if (bild) bilder.set(href, bild);
  }
  return bilder;
}

module.exports = { absolut, ausMarkup, bilderZuAdressen };
