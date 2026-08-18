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

// AniWorld beschriftet seine Poster mit "Cover <Titel>, Poster" bzw.
// "<Titel>, Cover, HD, Anime Stream, ganze Folge". Nur wenn dieser Schwanz
// wirklich dranhaengt, wird auch das vorangestellte "Cover" entfernt - sonst
// wuerde aus einer Serie namens "Cover Story" faelschlich "Story".
const BILDBESCHRIFTUNG = /,\s*(?:cover|poster|hd|anime stream|ganze folge|stream)\b[^]*$/i;

function titelAufraeumen(value) {
  let titel = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s*[|·–-]\s*(?:aniworld|s\.to|serienstream|filmo)[^]*$/i, "")
    .replace(/^(?:jetzt\s+)?(?:ansehen|anschauen|streamen)\s+/i, "")
    // AniWorld haengt an neue Folgen "St. 1 Ep. 6" an - fuer eine Kachel zaehlt
    // der Serientitel, nicht die Folge.
    .replace(/\s+(?:st\.?|staffel|season)\s*\d+\s*(?:(?:ep\.?|episode|folge)\s*\d+)?$/i, "")
    .trim();
  if (BILDBESCHRIFTUNG.test(titel)) {
    titel = titel.replace(BILDBESCHRIFTUNG, "").replace(/^(?:cover|poster)\s+/i, "").trim();
  }
  // AniWorld beschriftet Kacheln als "<Titel> Cover" bzw.
  // "<Titel> Cover, <Titel> Stream".
  return titel.replace(/\s+cover\b\s*(?:,[^]*)?$/i, "").trim() || titel;
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

// Genres stehen bei allen drei Anbietern als Link auf der Detailseite:
// /genre/action (AniWorld, S.to) oder /genres/adventure (Filmo). Sprach- und
// Formatmarken hängen in derselben Liste und sind keine Genres.
const KEIN_GENRE = /^(?:ger|gersub|engsub|engdub|gerdub|dub|sub|omu|deutsch|german|english|englisch|alle|all|az|neu|new|beliebt|popular)$/i;

// Verschiedene Anbieter benennen dasselbe Genre unterschiedlich. Ohne diese
// Tabelle wuerde "Comedy" bei S.to nie zu "Komödie" bei AniWorld passen.
const GENRE_SYNONYME = new Map(Object.entries({
  comedy: "komoedie",
  komodie: "komoedie",
  komoedie: "komoedie",
  adventure: "abenteuer",
  abenteuer: "abenteuer",
  "science-fiction": "scifi",
  sciencefiction: "scifi",
  "sci-fi": "scifi",
  scifi: "scifi",
  romance: "romanze",
  romanze: "romanze",
  liebesfilm: "romanze",
  crime: "krimi",
  krimi: "krimi",
  documentary: "doku",
  dokumentation: "doku",
  doku: "doku",
  family: "familie",
  familie: "familie",
  kinder: "familie",
  kids: "familie",
  animation: "animation",
  anime: "animation",
  war: "krieg",
  kriegsfilm: "krieg",
  krieg: "krieg",
  history: "historie",
  historisch: "historie",
  historie: "historie",
  music: "musik",
  musik: "musik",
  western: "western",
  horror: "horror",
  thriller: "thriller",
  drama: "drama",
  action: "action",
  fantasy: "fantasy",
  mystery: "mystery",
  sport: "sport",
  superhero: "superhelden",
  superhelden: "superhelden",
  supernatural: "uebernatuerlich",
  uebernatuerlich: "uebernatuerlich",
  reality: "reality",
  "tv-movie": "tvfilm",
  fernsehfilm: "tvfilm"
}));

function genreSchluessel(value) {
  const roh = String(value || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return GENRE_SYNONYME.get(roh) || GENRE_SYNONYME.get(roh.replace(/-/g, "")) || roh;
}

// Liefert die Genres einer Detailseite samt Link auf die Genre-Uebersicht,
// damit spaeter passende Titel desselben Anbieters nachgeladen werden koennen.
function extractGenres(html, baseUrl, limit = 12) {
  const treffer = [];
  const gesehen = new Set();
  for (const match of String(html || "").matchAll(/<a\s([^>]*)>([\s\S]{0,120}?)<\/a>/gi)) {
    if (treffer.length >= limit) break;
    const href = absolut(attribut("<x " + match[1] + ">", "href"), baseUrl);
    if (!href) continue;
    const pfad = new URL(href).pathname;
    const slug = (pfad.match(/\/genres?\/([^/?#]+)/i) || [])[1];
    if (!slug || KEIN_GENRE.test(slug)) continue;

    const label = ohneTags(match[2]) || slug.replace(/[-_]+/g, " ");
    if (!label || label.length > 30 || KEIN_GENRE.test(label)) continue;
    const key = genreSchluessel(slug);
    if (gesehen.has(key)) continue;
    gesehen.add(key);
    treffer.push({ key, label, url: href });
  }
  return treffer;
}

// Poster aus <picture>/<source srcset="...">: Filmo und S.to legen ihre Bilder
// nur dort ab, ein <img src> gibt es teils gar nicht.
function bildAusSrcset(abschnitt, baseUrl) {
  const match = String(abschnitt || "").match(/(?:data-)?srcset\s*=\s*"([^"]+)"/i);
  if (!match) return "";
  let bestes = "";
  let breite = -1;
  for (const eintrag of match[1].split(",")) {
    const teile = eintrag.trim().split(/\s+/);
    const href = absolut(teile[0] || "", baseUrl);
    if (!href || MUELL_BILD.test(href)) continue;
    const w = Number.parseInt(teile[1] || "", 10) || 0;
    if (w > breite) {
      breite = w;
      bestes = href;
    }
  }
  return bestes;
}

// Wie extractDiscoverItems, aber fuer Uebersichtsseiten (Genre-Listen,
// "Das schauen andere"): dort steht das Poster oft ausserhalb des kurzen
// Fensters, das die Startseiten-Extraktion abtastet.
function extractCatalogItems(html, baseUrl, provider = {}, limit = 40) {
  const quelltext = String(html || "");
  const treffer = [];
  const gesehen = new Set();

  for (const match of quelltext.matchAll(/<a\s([^>]*)>/gi)) {
    if (treffer.length >= limit) break;
    const href = absolut(attribut("<x " + match[1] + ">", "href"), baseUrl);
    if (!href || gesehen.has(href)) continue;
    if (MUELL_URL.test(href) || !gleicheSeite(href, baseUrl) || !INHALT_MUSTER.test(new URL(href).pathname)) continue;

    const ende = quelltext.indexOf("</a>", match.index);
    const abschnitt = quelltext.slice(match.index, ende < 0 ? match.index + 8000 : Math.min(ende, match.index + 8000));
    const bildTag = (abschnitt.match(/<img\s[^>]*>/i) || [""])[0];
    const bild = bildAusTag(bildTag, baseUrl)
      || bildAusSrcset(abschnitt, baseUrl)
      || bildInDerNaehe(quelltext, match.index, baseUrl);
    if (!bild) continue;

    const ueberschrift = abschnitt.match(/<h[1-6][^>]*>([\s\S]{0,120}?)<\/h[1-6]>/i);
    const titel = titelAufraeumen(
      attribut(bildTag, "alt")
      || attribut("<x " + match[1] + ">", "title")
      || (ueberschrift ? ohneTags(ueberschrift[1]) : "")
      || ohneTags(abschnitt)
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

// --- Angaben zu einem einzelnen Werk -----------------------------------------
//
// Was auf einer Detailseite ausser Genres noch steht - und wofuer es taugt:
//
//   imdb       AniWorld (data-imdb) und S.to (Link auf imdb.com). Damit laesst
//              sich ein Werk bei TMDB exakt aufloesen, ohne Titelvergleich.
//              Filmo fuehrt keine.
//   jahr/bis   AniWorld (itemprop startDate/endDate), S.to (Links auf /jahr/N),
//              Filmo ("Erscheinungsdatum: 2008"). Ohne Jahr trifft eine Suche
//              nach "Hunter x Hunter" die Fassung von 1999 statt der von 2011.
//   fsk        Alle drei. Die einzige Angabe der Anbieter, die etwas ueber das
//              Publikum sagt: Paw Patrol 0, Korra 6, Naruto 12, One Piece 16.
//              Genres tun das nicht - dort ist beides "Animation, Abenteuer".
//   titelAlt   AniWorld (data-alternativeTitles), inklusive des japanischen
//              Originaltitels. Der beste Aufhaenger fuer eine Anime-Datenbank.
//   cast/regie AniWorld (itemprop actor/director).
//
// Fehlt etwas, fehlt es - geraten wird nichts.

const FSK_STUFEN = new Set([0, 6, 12, 16, 18]);

function jahrAus(wert) {
  const zahl = Number.parseInt(String(wert || "").trim(), 10);
  return zahl >= 1900 && zahl <= 2100 ? zahl : 0;
}

// Personen aus schema.org-Auszeichnung. Der Name steht nicht direkt hinter
// dem itemprop, sondern eine Ebene tiefer:
//   <li itemprop="actor" ...><a itemprop="url"><span itemprop="name">Name</span></a></li>
// Deshalb wird ein Fenster hinter dem Treffer gelesen und daraus der
// verschachtelte Name geholt; ein <meta ... content="Name"> geht auch.
function itemprops(html, name) {
  const treffer = [];
  const quelle = String(html || "");
  const muster = new RegExp('itemprop="' + name + '"', "gi");
  for (const fund of quelle.matchAll(muster)) {
    const fenster = quelle.slice(fund.index, fund.index + 400);
    const wert = (
      attribut((fenster.match(/^[^>]*>/) || [""])[0], "content")
      || ohneTags((fenster.match(/itemprop="name"[^>]*>([^<]{1,80})</i) || [])[1] || "")
    ).trim();
    if (wert && wert.length <= 80 && !treffer.includes(wert)) treffer.push(wert);
  }
  return treffer;
}

function extractTitleMeta(html, baseUrl) {
  const quelle = String(html || "");

  // IMDB: AniWorld schreibt sie als Attribut, S.to verlinkt sie.
  const imdb = (quelle.match(/data-imdb="(tt\d{6,})"/i)
    || quelle.match(/imdb\.com\/title\/(tt\d{6,})/i)
    || [])[1] || "";

  // Altersfreigabe: Attribut zuerst, sonst der Text im Kopf der Seite.
  const fskRoh = (quelle.match(/data-fsk="(\d{1,2})"/i) || quelle.match(/\bFSK\s*:?\s*(\d{1,2})\b/i) || [])[1];
  const fsk = FSK_STUFEN.has(Number(fskRoh)) ? Number(fskRoh) : null;

  // Jahre: drei Schreibweisen, in der Reihenfolge ihrer Verlaesslichkeit.
  let jahr = jahrAus((quelle.match(/itemprop="startDate"[^>]*>(?:\s*<a[^>]*>)?\s*(\d{4})/i) || [])[1]);
  let bis = jahrAus((quelle.match(/itemprop="endDate"[^>]*>(?:\s*<a[^>]*>)?\s*(\d{4})/i) || [])[1]);
  if (!jahr) {
    // S.to verlinkt Anfangs- und Endjahr; das kleinere ist der Anfang.
    const jahre = [...quelle.matchAll(/href="[^"]*\/jahr\/(\d{4})"/gi)].map((t) => jahrAus(t[1])).filter(Boolean);
    if (jahre.length) {
      jahr = Math.min(...jahre);
      if (jahre.length > 1) bis = Math.max(...jahre);
    }
  }
  if (!jahr) jahr = jahrAus((quelle.match(/Erscheinungsdatum:\s*(?:\d{1,2}\.\s*)?(?:\w+\s*)?(\d{4})/i) || [])[1]);
  if (!jahr) {
    const datum = extractReleaseDate(quelle);
    if (datum) jahr = jahrAus(datum.slice(0, 4));
  }

  // Fremdsprachige und alternative Titel.
  const titelAlt = [];
  const rohAlt = (quelle.match(/data-alternativeTitles="([^"]*)"/i) || [])[1] || "";
  for (const teil of entitaetenDekodieren(rohAlt).split(",")) {
    const wert = teil.trim();
    if (wert && wert.length <= 80 && !titelAlt.includes(wert)) titelAlt.push(wert);
  }

  const cast = itemprops(quelle, "actor");
  const regie = itemprops(quelle, "director");

  return {
    imdb,
    fsk,
    jahr: jahr || 0,
    bis: bis && bis >= jahr ? bis : 0,
    titelAlt,
    cast: cast.slice(0, 20),
    regie: regie.slice(0, 5)
  };
}

// --- Paginierung --------------------------------------------------------------
//
// Die Genre-Uebersichten der Anbieter sind blaetterbar und zeigen je Seite nur
// dreissig bis vierzig Titel. Sortiert sind sie alphabetisch (AniWorld, S.to)
// oder nach Erscheinungsdatum (Filmo). Wer nur Seite 1 liest, sieht damit
// entweder nur "A" oder nur die letzten Neuerscheinungen - nie den Katalog.
// Deshalb wird hier ausgelesen, wie viele Seiten es gibt und wie ihre Adressen
// gebaut sind.
//
// Zwei Formen kommen vor:
//   AniWorld:  /genre/action/2      (Seitenzahl am Pfadende)
//   S.to/Filmo: /genre/action?page=2 (Seitenzahl als Parameter)

function regexSicher(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, (z) => "\\" + z);
}

// Liefert { letzte, muster }. `muster` enthaelt "{n}" an der Stelle der
// Seitenzahl; `letzte` ist die hoechste verlinkte Seite. Ohne Blaetterleiste
// bleibt es bei einer Seite.
function extractPagination(html, baseUrl) {
  let basis;
  try {
    basis = new URL(baseUrl);
  } catch {
    return { letzte: 1, muster: "" };
  }
  const basisPfad = basis.pathname.replace(/\/+$/, "");
  const pfadMuster = new RegExp("^" + regexSicher(basisPfad) + "/(\\d+)$");
  let letzte = 1;
  let muster = "";

  for (const match of String(html || "").matchAll(/<a\s([^>]*)>/gi)) {
    const href = absolut(attribut("<x " + match[1] + ">", "href"), baseUrl);
    if (!href) continue;
    let url;
    try {
      url = new URL(href);
    } catch {
      continue;
    }
    if (url.host !== basis.host) continue;
    const pfad = url.pathname.replace(/\/+$/, "");

    let nummer = 0;
    let form = "";
    const parameter = url.searchParams.get("page");
    if (pfad === basisPfad && /^\d+$/.test(parameter || "")) {
      nummer = Number(parameter);
      form = basis.origin + basisPfad + "?page={n}";
    } else {
      const treffer = pfad.match(pfadMuster);
      if (treffer) {
        nummer = Number(treffer[1]);
        form = basis.origin + basisPfad + "/{n}";
      }
    }
    // Eine vierstellige "Seitenzahl" ist keine Blaetterleiste mehr, sondern ein
    // Jahr oder eine Werk-Nummer, die zufaellig so aussieht.
    if (nummer > letzte && nummer <= 5000) {
      letzte = nummer;
      muster = form;
    }
  }
  return { letzte, muster };
}

// Aus dem Muster die Adresse der n-ten Seite. Seite 1 ist immer die
// Ausgangsadresse - die Anbieter verlinken sie nicht als "/1".
function seitenAdresse(muster, nummer, baseUrl) {
  if (nummer <= 1 || !muster) return baseUrl;
  return muster.replace("{n}", String(nummer));
}

// Welche Seiten werden gelesen? Gleichmaessig ueber die ganze Blaetterleiste
// verteilt, Seite 1 immer dabei. Deterministisch: dieselbe Seitenzahl ergibt
// immer dieselbe Auswahl. Damit deckt eine Stichprobe von acht Seiten bei
// alphabetischer Sortierung das ganze Alphabet ab und bei Sortierung nach
// Datum den ganzen Zeitraum - statt in beiden Faellen nur den Anfang.
function seitenStichprobe(letzte, anzahl) {
  const gesamt = Math.max(1, Math.floor(letzte) || 1);
  const wieviele = Math.max(1, Math.min(Math.floor(anzahl) || 1, gesamt));
  if (wieviele >= gesamt) return Array.from({ length: gesamt }, (_, i) => i + 1);
  const schritt = gesamt / wieviele;
  const seiten = [];
  for (let index = 0; index < wieviele; index += 1) {
    const seite = Math.min(gesamt, Math.floor(index * schritt) + 1);
    if (!seiten.includes(seite)) seiten.push(seite);
  }
  return seiten;
}

// S.to blendet unter einer Serie "Das schauen andere" ein, Filmo "Verwandte
// Filme". Das ist die beste Aehnlichkeitsquelle, die die Seiten selbst liefern.
const AEHNLICH_UEBERSCHRIFT = /(?:das schauen andere|schauen andere|verwandte\s+\w+|ähnliche[sr]?|aehnliche[sr]?|empfehlungen|könnte dir (?:auch )?gefallen)/i;

function extractRelatedItems(html, baseUrl, provider = {}, limit = 12) {
  const quelltext = String(html || "");
  const start = quelltext.search(AEHNLICH_UEBERSCHRIFT);
  if (start < 0) return [];
  return extractCatalogItems(quelltext.slice(start, start + 60000), baseUrl, provider, limit);
}

// Die Startseiten der Anbieter zeigen viele Reihen. Fuer "Neu bei deinen
// Anbietern" zaehlt nur die Reihe mit den Neuheiten - bei AniWorld "Neue
// Animes", bei S.to "Neu auf SerienStream", bei Filmo "Neu veroeffentlichte
// Filme". Die Muster werden gegen jede Ueberschrift geprueft, damit auch
// selbst angelegte Anbieter davon profitieren.
const NEUHEITEN_MUSTER = [
  /neue?\s+animes?\b/i,
  /neu\s+auf\s+\S/i,
  /neu\s+ver(?:ö|oe)ffentlicht/i,
  /neu\s+hinzugef(?:ü|ue)gt/i,
  /(?:zuletzt|k(?:ü|ue)rzlich)\s+hinzugef(?:ü|ue)gt/i,
  /neue?\s+(?:serien|filme|folgen|titel|ver(?:ö|oe)ffentlichungen)\b/i
];

// Ueberschriften der Seite samt Position, damit ein Abschnitt bis zur naechsten
// gleichrangigen Ueberschrift abgegrenzt werden kann. Kachel-Titel stehen in
// tieferen Rangstufen und beenden den Abschnitt deshalb nicht.
function ueberschriften(html) {
  const treffer = [];
  // Grosszuegiges Fenster: Filmo packt Icons und Links mit in die Ueberschrift,
  // die erste Fassung einer Reihe ist dadurch mehrere tausend Zeichen lang.
  // Verglichen wird trotzdem nur der Anfang des Textes.
  for (const match of String(html || "").matchAll(/<(h[1-6])\b[^>]*>([\s\S]{0,3000}?)<\/\1>/gi)) {
    treffer.push({
      rang: match[1].toLowerCase(),
      text: ohneTags(match[2]).slice(0, 120),
      start: match.index,
      ende: match.index + match[0].length
    });
  }
  return treffer;
}

// Filmo schreibt dieselbe Reihen-Ueberschrift mehrfach ins HTML (eine Fassung
// je Bildschirmbreite). Der Abschnitt endet deshalb erst bei einer
// Ueberschrift mit anderem Text, sonst waere er nach der ersten Kopie zu Ende.
function abschnittNachUeberschrift(html, kopf, alle) {
  const naechste = alle.find((eintrag) => (
    eintrag.rang === kopf.rang && eintrag.start >= kopf.ende && eintrag.text !== kopf.text
  ));
  const ende = naechste ? naechste.start : kopf.ende + 60000;
  return html.slice(kopf.ende, Math.min(ende, kopf.ende + 60000));
}

// Das grosse Titelbild ganz oben auf der Startseite - bei Filmo der Trending-
// Titel. Erkennungsmerkmal ist ein Bild aus einem "hero"-Verzeichnis. Bewusst
// eng gefasst: S.to legt sein Karussellbild unter backdrop/hero-mobile ab und
// soll hier gerade nicht mitkommen.
function extractHeroItem(html, baseUrl, provider = {}) {
  const kopfbereich = String(html || "").slice(0, 120000);
  for (const item of extractCatalogItems(kopfbereich, baseUrl, provider, 12)) {
    if (/\/hero\//i.test(item.image)) return item;
  }
  return null;
}

// Alle Neuheiten-Abschnitte einer Startseite. Findet sich keiner, gibt die
// Funktion nichts zurueck und der Aufrufer bleibt beim bisherigen Verhalten.
function extractNewReleaseItems(html, baseUrl, provider = {}, limit = 30) {
  const quelltext = String(html || "");
  const koepfe = ueberschriften(quelltext);
  const treffer = [];
  const gesehen = new Set();

  const erledigt = new Set();
  for (const kopf of koepfe) {
    if (treffer.length >= limit) break;
    if (!kopf.text || erledigt.has(kopf.text)) continue;
    if (!NEUHEITEN_MUSTER.some((muster) => muster.test(kopf.text))) continue;
    erledigt.add(kopf.text);

    const abschnitt = abschnittNachUeberschrift(quelltext, kopf, koepfe);
    for (const item of extractCatalogItems(abschnitt, baseUrl, provider, limit)) {
      if (gesehen.has(item.url)) continue;
      gesehen.add(item.url);
      treffer.push(item);
      if (treffer.length >= limit) break;
    }
  }
  return treffer;
}

// Zusammengefasste Folgen: S.to listet Doppelfolgen zwar in der Staffel-
// uebersicht, laesst die aufgegangenen Nummern aber ohne Hoster und schreibt
// "[In E18 enthalten]" in den Titel. Solche Folgen kann niemand abspielen -
// sie duerfen weder das Ende einer Staffel markieren noch beim Weiterschauen
// angesteuert werden.
const SAMMELFOLGE = /\[\s*in\s+(?:e|ep|episode|folge)\s*\d+\s+enthalten\s*\]/i;

function extractUnplayableEpisodes(html) {
  const gesperrt = new Set();
  let gelistet = 0;
  let letzteSpielbare = 0;

  for (const zeile of String(html || "").split(/<tr\b/i).slice(1)) {
    const nummer = Number((zeile.match(/episode-number[^>]*>\s*(\d+)/i) || [])[1])
      || Number((zeile.match(/(?:episode|folge)-(\d+)/i) || [])[1]);
    if (!Number.isFinite(nummer) || nummer <= 0) continue;
    gelistet = Math.max(gelistet, nummer);

    const watchZelle = zeile.match(/(?:episode-watch|watch-cell)[^>]*>[\s\S]*?<\/td>/i);
    const ohneHoster = Boolean(watchZelle) && !/<(?:img|svg|a|button)\b/i.test(watchZelle[0]);
    if (SAMMELFOLGE.test(zeile) || ohneHoster) {
      gesperrt.add(nummer);
    } else {
      letzteSpielbare = Math.max(letzteSpielbare, nummer);
    }
  }
  return {
    episodes: [...gesperrt].sort((links, rechts) => links - rechts),
    listed: gelistet,
    lastPlayable: letzteSpielbare
  };
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

// Wie weit reicht diese Serie? Aus den Staffel- und Folgenlinks einer Seite
// laesst sich das ablesen, ohne die Seite im Browser zu oeffnen - so faellt
// auf, wenn zu einer abgeschlossenen Serie neue Folgen erschienen sind.
function extractSeriesBounds(html, season = 0) {
  const text = String(html || "");
  let staffeln = 0;
  for (const treffer of text.matchAll(/\/(?:staffel|season)-(\d+)/gi)) {
    const nummer = Number(treffer[1]);
    // Filme liegen bei manchen Anbietern unter "staffel-0" - das ist keine.
    if (Number.isFinite(nummer) && nummer > staffeln) staffeln = nummer;
  }

  // Folgen zaehlen nur, wenn sie zur gefragten Staffel gehoeren: die Seite
  // listet in der Auswahl auch Nummern anderer Staffeln.
  let folgen = 0;
  const muster = season > 0
    ? new RegExp(`/(?:staffel|season)-${season}/(?:episode|folge)-(\\d+)`, "gi")
    : /\/(?:episode|folge)-(\d+)/gi;
  for (const treffer of text.matchAll(muster)) {
    const nummer = Number(treffer[1]);
    if (Number.isFinite(nummer) && nummer > folgen) folgen = nummer;
  }
  return { seasons: staffeln, episodes: folgen };
}

// Wann ist das erschienen? Die Anbieter schreiben das an drei Stellen und in
// drei Formaten: als "Erscheinungsdatum" der Serie, als "Veroeffentlicht am"
// der Folge und als "Veroeffentlicht bei uns" im Fuss. Genommen wird das
// frueheste Datum der Serie beziehungsweise Staffel - das ist der Start, nicht
// der Zeitpunkt, an dem die Seite es hochgeladen hat.
//
// Eine leere Angabe kommt dabei als "November 30, -0001" daher; solche Werte
// muessen raus, sonst stuende auf der Kachel ein Datum aus dem Jahr null.
const MONATE = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  januar: 1, februar: 2, maerz: 3, mai: 5, juni: 6, juli: 7, oktober: 10, dezember: 12
};

function datumAusText(text) {
  const wert = String(text || "").replace(/\s+/g, " ").trim();
  if (!wert) return "";

  // 2026-07-29
  const iso = wert.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return pruefeDatum(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // 01.06.2026
  const deutsch = wert.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (deutsch) return pruefeDatum(Number(deutsch[3]), Number(deutsch[2]), Number(deutsch[1]));

  // March 5, 2026 - auch "November 30, -0001"
  const englisch = wert.match(/([A-Za-zäöüÄÖÜ]+)\s+(\d{1,2}),?\s+(-?\d{1,4})/);
  if (englisch) {
    const monat = MONATE[englisch[1].toLowerCase().replace("ä", "ae")];
    if (monat) return pruefeDatum(Number(englisch[3]), monat, Number(englisch[2]));
  }
  return "";
}

// Nur Daten, die es geben kann. Alles vor 1900 ist eine leere Angabe der
// Seite, kein Erscheinungsdatum.
function pruefeDatum(jahr, monat, tag) {
  if (!Number.isFinite(jahr) || jahr < 1900 || jahr > 2200) return "";
  if (!(monat >= 1 && monat <= 12) || !(tag >= 1 && tag <= 31)) return "";
  return `${jahr}-${String(monat).padStart(2, "0")}-${String(tag).padStart(2, "0")}`;
}

// Aus einer Seite das Erscheinungsdatum ziehen. Zuerst die ausdrueckliche
// Angabe der Serie, dann die der Folge - "bei uns veroeffentlicht" bleibt
// aussen vor, das ist das Datum des Uploads.
function extractReleaseDate(html) {
  const text = String(html || "");
  const muster = [
    // Zwischen Beschriftung und Wert koennen mehrere Tags stehen -
    // "</h3><span>" etwa. Also alles ueberspringen, was Auszeichnung ist.
    /Erscheinungsdatum(?:\s|<[^>]*>|[:"'>])*([^<]{4,40})/i,
    /datePublished["'\s:]+["']([^"']{4,40})/i,
    /Ver(?:ö|oe)ffentlicht am[\s:]*([^<|]{4,40})/i
  ];
  for (const regel of muster) {
    const treffer = text.match(regel);
    if (!treffer) continue;
    const datum = datumAusText(treffer[1]);
    if (datum) return datum;
  }
  return "";
}

// Der Kalender der Anbieter.
//
// Zwei Bauarten: AniWorld liefert fertiges HTML, in dem jeder Wochentag eine
// eigene Sektion mit der Kennung des Tages ist. S.to laedt seinen Kalender
// per JavaScript nach und stellt die Daten unter /api/calendar bereit, nach
// Datum geordnet. Beides wird hier auf dieselbe Form gebracht.
const WOCHENTAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

// Aus "2026-08-10" den Wochentag. Ohne Zeitzone gerechnet, sonst kippt das
// Datum je nach Uhrzeit auf den Vortag.
function wochentagAusDatum(datum) {
  const teile = String(datum || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!teile) return "";
  const tag = new Date(Number(teile[1]), Number(teile[2]) - 1, Number(teile[3])).getDay();
  return WOCHENTAGE[(tag + 6) % 7];
}

// AniWorld: je Wochentag eine Sektion, darin die Serien.
function extractCalendarEntries(html) {
  const text = String(html || "");
  const eintraege = [];
  // Die Sektionen tragen den Tag als Kennung - das ist der verlaessliche
  // Anker. Die Reiter oben nennen die Tage ebenfalls, gehoeren aber nicht
  // zu den Eintraegen.
  const sektionen = /<section[^>]*class="[^"]*calendarList[^"]*"[^>]*id="([a-zäöü]+)"[^>]*>([\s\S]*?)(?=<section[^>]*class="[^"]*calendarList|<\/div>\s*<\/div>\s*<footer|$)/gi;
  let sektion;
  while ((sektion = sektionen.exec(text))) {
    const tag = WOCHENTAGE.find((wert) => wert.toLowerCase() === sektion[1].toLowerCase());
    if (!tag) continue;
    const inhalt = sektion[2];
    const datum = (inhalt.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/) || []);
    const iso = datum.length
      ? `${datum[3]}-${String(datum[2]).padStart(2, "0")}-${String(datum[1]).padStart(2, "0")}`
      : "";

    // Je Eintrag: der Link auf die Serie, danach Titel und Folge.
    const teile = inhalt.split(/<a\s+href="/i).slice(1);
    for (const teil of teile) {
      const adresse = (teil.match(/^([^"]+)"/) || [])[1] || "";
      if (!/\/(?:anime|serie)\/stream\//i.test(adresse)) continue;
      const titel = entschaerfe((teil.match(/class="seriesTitle"[^>]*>([\s\S]*?)<\/h3>/i) || [])[1] || "");
      if (!titel) continue;
      const folge = (teil.match(/<small>\s*S(\d{1,3})E(\d{1,4})/i) || []);
      // Das Bild steht als data-src am Platzhalter - src traegt nur ein
      // durchsichtiges Pixel, bis die Seite selbst nachlaedt.
      const bild = (teil.match(/data-src="([^"]+\/cover\/[^"]+)"/i) || [])[1] || "";
      // Dieselbe Folge steht mehrfach da - einmal je Fassung. Welche es ist,
      // sagt die Flagge daneben. Das sind keine Doppelten, sondern die
      // Synchronfassungen, und sie gehoeren einzeln in den Kalender.
      const flagge = (teil.match(/class="flag"[^>]*data-src="[^"]*\/([a-z-]+)\.svg"/i)
        || teil.match(/data-src="[^"]*\/([a-z-]+)\.svg"[^>]*class="flag"/i) || [])[1] || "";
      const uhr = (teil.match(/<small>\s*~?\s*([01]?\d|2[0-3]):([0-5]\d)\s*Uhr/i) || []);
      eintraege.push({
        day: tag,
        date: iso,
        time: uhr.length ? `${String(uhr[1]).padStart(2, "0")}:${uhr[2]}` : "",
        title: titel,
        url: adresse,
        image: bild,
        type: artAusAdresse(adresse),
        language: spracheAusFlagge(flagge),
        season: folge.length ? Number(folge[1]) : 0,
        episode: folge.length ? Number(folge[2]) : 0
      });
    }
  }
  return ohneDoppelte(eintraege);
}

// Die Flaggen der Anbieter in Worte. "japanese-german" heisst: japanischer Ton
// mit deutschem Untertitel - nicht etwa zwei Sprachen.
function spracheAusFlagge(name) {
  const wert = String(name || "").toLowerCase();
  if (!wert) return "";
  if (wert === "german" || wert === "deutsch") return "Deutsch";
  if (wert === "japanese-german") return "Japanisch, Deutsche Untertitel";
  if (wert === "japanese-english") return "Japanisch, Englische Untertitel";
  if (wert === "japanese") return "Japanisch";
  if (wert === "english") return "Englisch";
  if (wert === "english-german") return "Englisch, Deutsche Untertitel";
  return wert.replace(/-/g, ", ");
}

// Eine Folge, ein Eintrag. Die Anbieter listen sie je Synchronfassung einmal -
// dieselbe Folge stand dadurch dreimal untereinander. Zusammengezogen wird auf
// den Titel samt Folge; die Fassungen werden gesammelt und stehen gemeinsam
// auf der Karte.
function ohneDoppelte(eintraege) {
  const nach = new Map();
  for (const eintrag of eintraege) {
    const schluessel = `${eintrag.day}|${eintrag.url}|${eintrag.season}|${eintrag.episode}`;
    const vorhanden = nach.get(schluessel);
    if (!vorhanden) {
      nach.set(schluessel, { ...eintrag, languages: eintrag.language ? [eintrag.language] : [] });
      continue;
    }
    if (!vorhanden.image && eintrag.image) vorhanden.image = eintrag.image;
    if (!vorhanden.time && eintrag.time) vorhanden.time = eintrag.time;
    if (eintrag.language && !vorhanden.languages.includes(eintrag.language)) {
      vorhanden.languages.push(eintrag.language);
    }
  }
  // Deutsch zuerst, danach die Untertitelfassungen - das ist die Reihenfolge,
  // in der man sie sucht.
  for (const eintrag of nach.values()) {
    eintrag.languages.sort((links, rechts) => rang(links) - rang(rechts));
    eintrag.language = eintrag.languages.join(" · ");
  }
  return [...nach.values()];
}

function rang(sprache) {
  if (/^Deutsch$/i.test(sprache)) return 0;
  if (/Deutsche Untertitel/i.test(sprache)) return 1;
  if (/Englische Untertitel/i.test(sprache)) return 2;
  return 3;
}

// S.to: die Schnittstelle liefert je Datum eine Liste.
function extractCalendarJson(rohdaten) {
  let daten;
  try {
    daten = typeof rohdaten === "string" ? JSON.parse(rohdaten) : rohdaten;
  } catch {
    return [];
  }
  if (!daten || typeof daten !== "object") return [];

  const eintraege = [];
  for (const [datum, liste] of Object.entries(daten)) {
    const tag = wochentagAusDatum(datum);
    if (!tag || !Array.isArray(liste)) continue;
    for (const roh of liste) {
      const titel = entschaerfe(String(roh?.title || ""));
      const adresse = String(roh?.url || "");
      if (!titel || !adresse) continue;
      eintraege.push({
        day: tag,
        date: String(roh?.date || datum),
        time: String(roh?.time || "").slice(0, 5),
        title: titel,
        url: adresse,
        image: String(roh?.cover_url || ""),
        type: artAusAdresse(adresse),
        season: Number(roh?.season) || 0,
        episode: Number(roh?.episode) || 0,
        language: String(roh?.language || "")
      });
    }
  }
  return ohneDoppelte(eintraege);
}

// Anime oder Serie? Steht in der Adresse: "/anime/stream/..." gegen
// "/serie/...". Das ist verlaesslicher als der Anbieter - der eine fuehrt
// beides, wenn auch selten.
function artAusAdresse(adresse) {
  return /\/anime\//i.test(String(adresse || "")) ? "anime" : "serie";
}

function entschaerfe(roh) {
  return String(roh || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  extractCalendarEntries,
  artAusAdresse,
  spracheAusFlagge,
  extractCalendarJson,
  wochentagAusDatum,
  WOCHENTAGE,
  extractReleaseDate,
  datumAusText,
  extractSeriesBounds,
  extractDiscoverItems,
  extractPosterFallbacks,
  extractGenres,
  extractCatalogItems,
  extractRelatedItems,
  extractTitleMeta,
  extractPagination,
  seitenAdresse,
  seitenStichprobe,
  extractNewReleaseItems,
  extractHeroItem,
  extractUnplayableEpisodes,
  genreSchluessel
};
