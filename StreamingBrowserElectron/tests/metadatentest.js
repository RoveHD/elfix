"use strict";
// Die Metadaten-Schicht: was die Anbieterseiten hergeben und was daraus wird.
//
// Der Anlass: fuer die Empfehlungen sahen "Die Legende von Korra" und
// "Paw Patrol" gleich aus - beides "Animation, Abenteuer". Die Seiten selbst
// wissen es besser (FSK 6 gegen FSK 0), nur wurde es nie gelesen. Dasselbe gilt
// fuer die IMDB-Kennung, mit der sich ein Werk exakt aufloesen laesst, statt
// Titel zu vergleichen.

const D = require("../src/discover");

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(b); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };

// --- Ausschnitte, wie die Anbieter sie wirklich ausliefern -------------------

const ANIWORLD = `
<h1 itemprop="name" title="Animes Stream: Naruto" data-alternativeTitles="Naruto Clássico, 火影忍者, Naruto Classic, 나루토"><span>Naruto</span></h1>
<small> (<span itemprop="startDate"><a href="https://aniworld.to/animes/jahr/2002">2002</a></span>
 - <span itemprop="endDate"><a href="https://aniworld.to/animes/jahr/2007">2007</a></span>)</small>
<div title="Empfohlene Altersfreigabe: 12 Jahre" data-fsk="12" class="fsk fsk12">Ab: <span>12</span></div>
<a href="https://www.imdb.com/title/tt0409591" data-imdb="tt0409591" class="imdb-link">IMDB</a>
<li class="seriesDirector"><strong>Regisseure:</strong><ul>
<li itemprop="director" itemscope itemtype="http://schema.org/Person"><a href="/animes/regisseur/hayato-date" itemprop="url"><span itemprop="name">Hayato Date</span></a></li></ul></li>
<ul><li itemprop="actor" itemscope itemtype="http://schema.org/Person"><a href="/x" itemprop="url"><span itemprop="name">Junko Takeuchi</span></a></li>
<li itemprop="actor" itemscope itemtype="http://schema.org/Person"><a href="/y" itemprop="url"><span itemprop="name">Noriaki Sugiyama</span></a></li></ul>`;

const STO_KORRA = `
<h1 class="h2 mb-1 fw-bold"> Die Legende von Korra </h1>
<p class="small text-muted mb-2"><a class="small text-muted" href="/jahr/2012">2012</a>
 – <a class="small text-muted" href="/jahr/2014">2014</a> &bull; FSK 6 </p>
<a href="https://www.imdb.com/title/tt1695360" target="_blank">IMDB</a>`;

const STO_PAW = `
<h1 class="h2 mb-1 fw-bold"> PAW Patrol </h1>
<p class="small text-muted mb-2"><a href="/jahr/2013">2013</a> &bull; FSK 0 </p>
<a href="https://www.imdb.com/title/tt3121722">IMDB</a>`;

const FILMO = `
<h1>Iron Man</h1>
<p>Iron Man Erscheinungsdatum: 2008 &bull; FSK 12</p>`;

// --- AniWorld ---------------------------------------------------------------

const anw = D.extractTitleMeta(ANIWORLD, "https://aniworld.to/anime/stream/naruto");
pruefe("AniWorld: IMDB-Kennung", anw.imdb === "tt0409591", anw.imdb);
pruefe("AniWorld: Altersfreigabe", anw.fsk === 12, String(anw.fsk));
pruefe("AniWorld: Anfangs- und Endjahr", anw.jahr === 2002 && anw.bis === 2007, anw.jahr + "-" + anw.bis);
pruefe("AniWorld: fremdsprachige Titel", anw.titelAlt.includes("火影忍者") && anw.titelAlt.length === 4,
  anw.titelAlt.join(" / "));
pruefe("AniWorld: Regie", anw.regie[0] === "Hayato Date", anw.regie.join(", "));
pruefe("AniWorld: Besetzung", anw.cast.length === 2 && anw.cast[0] === "Junko Takeuchi", anw.cast.join(", "));

// --- S.to -------------------------------------------------------------------

const korra = D.extractTitleMeta(STO_KORRA, "http://186.2.175.5/serie/die-legende-von-korra");
pruefe("S.to: IMDB aus dem Link", korra.imdb === "tt1695360", korra.imdb);
pruefe("S.to: FSK aus dem Text", korra.fsk === 6, String(korra.fsk));
pruefe("S.to: Jahre aus den Links", korra.jahr === 2012 && korra.bis === 2014, korra.jahr + "-" + korra.bis);

const paw = D.extractTitleMeta(STO_PAW, "http://186.2.175.5/serie/paw-patrol");
pruefe("S.to: einzelnes Jahr ohne Endjahr", paw.jahr === 2013 && paw.bis === 0, paw.jahr + "-" + paw.bis);

// Der eigentliche Zweck: die beiden sind fuer die Genres identisch und
// unterscheiden sich trotzdem nachweisbar.
pruefe("Korra und Paw Patrol sind unterscheidbar",
  korra.fsk === 6 && paw.fsk === 0 && korra.fsk !== paw.fsk,
  "Korra FSK " + korra.fsk + " gegen Paw Patrol FSK " + paw.fsk);

// --- Filmo ------------------------------------------------------------------

const filmo = D.extractTitleMeta(FILMO, "https://filmo.to/movies/iron-man");
pruefe("Filmo: Jahr aus dem Erscheinungsdatum", filmo.jahr === 2008, String(filmo.jahr));
pruefe("Filmo: FSK", filmo.fsk === 12, String(filmo.fsk));
pruefe("Filmo: keine IMDB-Kennung, und das ist kein Fehler", filmo.imdb === "");

// --- Was fehlt, bleibt leer -------------------------------------------------
//
// Eine erratene Angabe ist schlechter als keine: an ihr haengt spaeter die
// Zuordnung zu einer externen Datenbank.

for (const [name, wert] of [["leer", ""], ["null", null], ["Fliesstext", "nur text"], ["halbes Tag", "<h1 data-imdb="]]) {
  const m = D.extractTitleMeta(wert, "https://x.to/a");
  pruefe("Ohne Angaben bleibt alles leer (" + name + ")",
    m.imdb === "" && m.fsk === null && m.jahr === 0 && m.bis === 0
    && m.titelAlt.length === 0 && m.cast.length === 0 && m.regie.length === 0);
}

// Unsinnige Werte werden nicht durchgereicht.
pruefe("Unbekannte FSK-Stufe wird verworfen",
  D.extractTitleMeta('<div data-fsk="7">Ab: 7</div>', "https://x.to/a").fsk === null);
pruefe("Jahr ausserhalb des Moeglichen wird verworfen",
  D.extractTitleMeta('<span itemprop="startDate">1543</span>', "https://x.to/a").jahr === 0);
pruefe("Endjahr vor dem Anfangsjahr wird verworfen",
  D.extractTitleMeta('<span itemprop="startDate">2012</span><span itemprop="endDate">2009</span>',
    "https://x.to/a").bis === 0);
pruefe("Zu kurze IMDB-Kennung zaehlt nicht",
  D.extractTitleMeta('<a data-imdb="tt12">x</a>', "https://x.to/a").imdb === "");

const gut = pruefungen.filter(Boolean).length;
console.log(`${gut}/${pruefungen.length} bestanden`);
process.exit(gut === pruefungen.length ? 0 : 1);
