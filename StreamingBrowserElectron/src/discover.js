"use strict";

// Liest Vorschlaege von der Startseite eines Anbieters: jeder Treffer ist ein
// Link mit Bild, der auf eine Serien-, Film- oder Anime-Seite zeigt.
// Bewusst ein eigenes Modul, damit die Extraktion ohne laufende App gegen echte
// Seiten geprueft werden kann.

const INHALT_MUSTER = /\/(?:anime|serie|series|stream|film|filme|movie|movies|watch|title|show)s?\//i;
const MUELL_URL = /(?:\/(?:login|register|logout|account|profile|kontakt|impressum|datenschutz|agb|search|suche|tag|genre|kalender|calendar|discord|support|faq|news)(?:\/|$)|^javascript:|^mailto:|^#)/i;
const MUELL_BILD = /(?:logo|sprite|icon|favicon|avatar|flag|placeholder|blank|transparent|loading|spinner|banner|ads?[-_.])/i;
const MUELL_TITEL = /^(?:home|start|startseite|anmelden|registrieren|login|mehr|mehr anzeigen|alle|kalender|impressum|datenschutz|agb|kontakt|suche|search|news|discord|weiter|zurueck|zurück)$/i;

function entitaetenDekodieren(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function attribut(tag, name) {
  const match = String(tag || "").match(new RegExp(name + '\\s*=\\s*"([^"]*)"', "i"));
  return match ? entitaetenDekodieren(match[1]).trim() : "";
}

function ohneTags(value) {
  return entitaetenDekodieren(String(value || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function absolut(href, baseUrl) {
  try {
    const url = new URL(String(href || "").trim(), baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function gleicheSeite(href, baseUrl) {
  try {
    return new URL(href).host === new URL(baseUrl).host;
  } catch {
    return false;
  }
}

function titelAufraeumen(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s*[|·–-]\s*(?:aniworld|s\.to|serienstream|filmo)[^]*$/i, "")
    .replace(/^(?:jetzt\s+)?(?:ansehen|anschauen|streamen)\s+/i, "")
    .trim();
}

function istBrauchbarerTitel(titel) {
  if (!titel || titel.length < 2 || titel.length > 90) return false;
  if (MUELL_TITEL.test(titel)) return false;
  return /[a-zA-ZÀ-ÿ0-9]/.test(titel);
}

// Aus dem Pfad einen lesbaren Titel bauen, wenn die Seite keinen mitliefert.
function titelAusPfad(href) {
  try {
    const teile = new URL(href).pathname.split("/").filter(Boolean);
    const letzter = [...teile].reverse().find((teil) => !/^(?:anime|serie|series|stream|film|filme|movie|movies|watch|title|show)s?$/i.test(teil));
    if (!letzter) return "";
    return letzter
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\p{Ll}/gu, (zeichen) => zeichen.toUpperCase());
  } catch {
    return "";
  }
}

function bildAusTag(tag, baseUrl) {
  if (!tag) return "";
  const quelle = attribut(tag, "data-src")
    || attribut(tag, "data-original")
    || attribut(tag, "data-lazy")
    || attribut(tag, "src");
  const bild = absolut(quelle, baseUrl);
  return bild && !MUELL_BILD.test(bild) ? bild : "";
}

// Manche Seiten setzen das Poster nicht in den Link, sondern daneben. Dann in
// einem Fenster um den Link herum nach dem naechsten Bild suchen.
function bildInDerNaehe(html, position, baseUrl) {
  const davor = html.slice(Math.max(0, position - 2500), position);
  const danach = html.slice(position, position + 2500);
  const kandidaten = [
    ...[...davor.matchAll(/<img\s[^>]*>/gi)].reverse(),
    ...danach.matchAll(/<img\s[^>]*>/gi)
  ];
  for (const kandidat of kandidaten) {
    const bild = bildAusTag(kandidat[0], baseUrl);
    if (bild) return bild;
  }
  return "";
}

function extractDiscoverItems(html, baseUrl, provider = {}, limit = 30) {
  const quelltext = String(html || "");
  const treffer = [];
  const gesehen = new Set();

  for (const match of quelltext.matchAll(/<a\s([^>]*)>([\s\S]{0,1500}?)<\/a>/gi)) {
    if (treffer.length >= limit) break;
    const attribute = match[1];
    const inhalt = match[2];

    const href = absolut(attribut("<x " + attribute + ">", "href"), baseUrl);
    if (!href || gesehen.has(href)) continue;
    if (MUELL_URL.test(href) || !gleicheSeite(href, baseUrl) || !INHALT_MUSTER.test(new URL(href).pathname)) continue;

    const bildTag = (inhalt.match(/<img\s[^>]*>/i) || [""])[0];
    const bild = bildAusTag(bildTag, baseUrl) || bildInDerNaehe(quelltext, match.index, baseUrl);
    if (!bild) continue;

    const ueberschrift = inhalt.match(/<h[1-6]\s[^>]*title="([^"]+)"/i);
    const titel = titelAufraeumen(
      attribut(bildTag, "alt")
      || (ueberschrift ? entitaetenDekodieren(ueberschrift[1]) : "")
      || attribut("<x " + attribute + ">", "title")
      || ohneTags(inhalt)
    ) || titelAusPfad(href);
    if (!istBrauchbarerTitel(titel)) continue;

    gesehen.add(href);
    treffer.push({
      title: titel,
      url: href,
      image: bild,
      providerId: provider.id || "",
      providerName: provider.name || ""
    });
  }
  return treffer;
}

// Seiten, die ihre Kacheln erst per JavaScript aufbauen, liefern im HTML nur
// die Bilder mit Titel im alt-Text. Daraus laesst sich zwar kein Direktlink
// bilden, aber ein Aufruf der Suche des Anbieters.
function extractPosterFallbacks(html, baseUrl, provider = {}, limit = 30) {
  const treffer = [];
  const gesehen = new Set();
  const suchvorlage = String(provider.searchUrl || "");

  for (const match of String(html || "").matchAll(/<img\s[^>]*>/gi)) {
    if (treffer.length >= limit) break;
    const tag = match[0];
    const bild = bildAusTag(tag, baseUrl);
    if (!bild || !/(?:packshot|poster|cover|hero|thumb|backdrop|\/img\/)/i.test(bild)) continue;

    const titel = titelAufraeumen(attribut(tag, "alt"));
    if (!istBrauchbarerTitel(titel)) continue;
    const schluessel = titel.toLowerCase();
    if (gesehen.has(schluessel)) continue;

    const url = suchvorlage.includes("{query}")
      ? suchvorlage.replace("{query}", encodeURIComponent(titel))
      : absolut(provider.startUrl || baseUrl, baseUrl);
    if (!url) continue;

    gesehen.add(schluessel);
    treffer.push({
      title: titel,
      url,
      image: bild,
      providerId: provider.id || "",
      providerName: provider.name || "",
      viaSearch: suchvorlage.includes("{query}")
    });
  }
  return treffer;
}

module.exports = { extractDiscoverItems, extractPosterFallbacks };
