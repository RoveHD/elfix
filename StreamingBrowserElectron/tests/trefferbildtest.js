"use strict";
// Welches Bild ein Suchtreffer bekommt.
//
// Gemeldet: die Suche zeigt nur Text. Auf der Anbieterseite steht das Bild
// unmittelbar neben dem Titel - im selben Verweis, den die Suche ohnehin
// ausliest. Es wurde nur nicht mitgenommen.
//
// Die Ausschnitte hier sind so gebaut, wie Trefferlisten wirklich aussehen: ein
// Verweis, darin ein Bild, oft verzoegert geladen und mit einem Pixel im src.
// Genau dort holte man sich sonst das Pixel statt des Posters.
//
// Der zweite Teil ist wichtiger als der erste: was nicht als Titelbild
// durchgehen darf. Ein Logo oder ein Sprachabzeichen auf der Karte sieht
// kaputter aus als gar kein Bild.
//
// Dieselben Faelle laufen auf Android in TrefferbildTest.java gegen
// Trefferbild.java. Weicht eine Seite der beiden ab, faellt es hier auf.

const fs = require("fs");
const path = require("path");
const trefferbild = require("../src/trefferbild");

const WURZEL = path.join(__dirname, "..");
const lies = (datei) => fs.readFileSync(path.join(WURZEL, datei), "utf8").split("\r\n").join("\n");

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}

const BASIS = "https://beispiel.tld/suche?q=bleach";
const bild = (markup, basis = BASIS) => trefferbild.ausMarkup(markup, basis);
const gleich = (name, ist, soll) => pruefe(name, ist === soll, JSON.stringify(ist));

// --- Das Bild steht im Treffer ----------------------------------------------

gleich("Das Bild kommt aus dem Verweis",
  bild('<a href="/anime/bleach"><img src="/cover/bleach.jpg"><span>Bleach</span></a>'),
  "https://beispiel.tld/cover/bleach.jpg");

gleich("Schemalose Adresse",
  bild('<img src="//bilder.tld/a.jpg">'),
  "https://bilder.tld/a.jpg");
gleich("Adresse relativ zum Verzeichnis",
  bild('<img src="a.jpg">', "https://beispiel.tld/suche/"),
  "https://beispiel.tld/suche/a.jpg");
gleich("Adresse relativ zur Wurzel",
  bild('<img src="/cover/a.jpg">', "https://beispiel.tld/suche/x"),
  "https://beispiel.tld/cover/a.jpg");

// Steht ein data-src da, ist das src meist nur der Platzhalter.
gleich("Verzoegert geladene Adressen gehen vor",
  bild('<img src="/img/placeholder.png" data-src="/cover/echt.jpg">'),
  "https://beispiel.tld/cover/echt.jpg");

gleich("Aus einer Auswahlliste die groesste Breite",
  bild('<img srcset="/cover/klein.jpg 200w, /cover/gross.jpg 800w" src="/cover/klein.jpg">'),
  "https://beispiel.tld/cover/gross.jpg");
gleich("Aus einer Auswahlliste die groessere Dichte",
  bild('<img srcset="/cover/einfach.jpg 1x, /cover/zweifach.jpg 2x">'),
  "https://beispiel.tld/cover/zweifach.jpg");

gleich("Das Bild als Hintergrund",
  bild('<a href="/x"><div style="background-image:url(\'/cover/bleach.jpg\')"></div></a>'),
  "https://beispiel.tld/cover/bleach.jpg");
gleich("Das Bild in einer Datenangabe",
  bild('<div data-thumb="/cover/bleach.jpg"></div>'),
  "https://beispiel.tld/cover/bleach.jpg");

gleich("Das Kaufmanns-Und in der Adresse",
  bild('<img src="/bild?id=7&amp;s=400">'),
  "https://beispiel.tld/bild?id=7&s=400");

// --- Was kein Titelbild ist --------------------------------------------------

for (const beiwerk of ["/assets/logo.png", "/img/sprite.png", "/img/flags/de.png", "/static/icon-play.png"]) {
  gleich(`Kein Logo, kein Abzeichen: ${beiwerk}`, bild(`<img src="${beiwerk}">`), "");
}
for (const platzhalter of ["/img/placeholder.png", "/img/1x1.gif", "/img/transparent.gif"]) {
  gleich(`Kein Platzhalter: ${platzhalter}`, bild(`<img src="${platzhalter}">`), "");
}
// SVG ist auf diesen Seiten das Format der Symbole, nicht der Poster.
gleich("Keine Zeichnung", bild('<img src="/cover/bleach.svg">'), "");
gleich("Kein eingebettetes Bild",
  bild('<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">'), "");
gleich("Kein javascript:", bild('<img src="javascript:0">'), "");

// Der erste Treffer im Verweis ist oft das Abzeichen. Es zaehlt nicht, und die
// Suche geht weiter statt aufzugeben.
gleich("Ueber das Beiwerk hinweg zum echten Bild",
  bild('<a href="/x"><img src="/img/flags/de.png"><img src="/cover/bleach.jpg"></a>'),
  "https://beispiel.tld/cover/bleach.jpg");

gleich("Ohne Bild bleibt es leer", bild('<a href="/x">Bleach</a>'), "");
gleich("Ohne Markup bleibt es leer", bild(""), "");
gleich("Ohne Eingabe bleibt es leer", bild(null), "");

// --- Zwei Verweise je Treffer ------------------------------------------------
//
// Manche Anbieter setzen einen Verweis um das Bild und einen zweiten um den
// Titel. Die Suche nimmt den mit dem Titel - stuende das Bild nur im anderen,
// bliebe die Karte leer, obwohl es auf der Seite steht.
const SEITE = `
  <div class="treffer">
    <a href="/anime/bleach"><img data-src="/cover/bleach.jpg" src="/img/1x1.gif"></a>
    <a href="/anime/bleach"><h3>Bleach</h3></a>
    <a href="/anime/naruto">Naruto</a>
  </div>`;
const karte = trefferbild.bilderZuAdressen(SEITE, BASIS);
gleich("Das Bild des Bildverweises gehoert zur selben Adresse",
  karte.get("https://beispiel.tld/anime/bleach"), "https://beispiel.tld/cover/bleach.jpg");
pruefe("Ein Verweis ohne Bild steht nicht in der Karte",
  !karte.has("https://beispiel.tld/anime/naruto"));

// Und der Platzhalter im src darf dabei nicht gewinnen.
pruefe("Der Platzhalter im src zaehlt nicht als Bild",
  !String(karte.get("https://beispiel.tld/anime/bleach")).includes("1x1"));

// --- Der Weg durch die Suche -------------------------------------------------

const hauptQuelle = lies("src/main.js");
pruefe("Die Suche kennt das Modul",
  /const trefferbild = require\("\.\/trefferbild"\);/.test(hauptQuelle));
pruefe("Der Treffer traegt sein Bild",
  /results\.push\(\{ title, genre: cleaned\.genre \|\| "", url: href, image \}\)/.test(hauptQuelle));
pruefe("Erst der Verweis selbst, dann die Karte der Seite",
  /trefferbild\.ausMarkup\(match\[0\], baseUrl\) \|\| bilder\.get\(href\)/.test(hauptQuelle));
pruefe("Kein zweiter Abruf fuer das Bild eines Treffers in der Trefferliste",
  !/await[^\n]*fetch[^\n]*\n?[^\n]*extractSearchLinks/.test(hauptQuelle));

// AniWorld schickt in der Schnellsuche kein Bild mit - dort wird einzeln
// nachgeholt, und zwar gemerkt.
pruefe("Nachgeholt wird ueber einen eigenen Kanal",
  /ipcMain\.handle\("search:artwork"/.test(hauptQuelle));
pruefe("Ein Bild wird nur einmal je Adresse geholt",
  /if \(suchbilder\.has\(adresse\)\) return suchbilder\.get\(adresse\)/.test(hauptQuelle)
  && /suchbilderLaufen\.has\(adresse\)/.test(hauptQuelle));
pruefe("Auch ein leeres Ergebnis wird gemerkt",
  /suchbildMerken\(adresse, String\(bild \|\| ""\)\)/.test(hauptQuelle));

// --- Die Falle mit der leeren Grundlage --------------------------------------
//
// Gemeldet: "bei AniWorld geht es nicht, bei den anderen schon." Es lag nicht an
// AniWorld. `new URL(adresse, "")` zerbricht an der leeren Grundlage, auch wenn
// die Adresse selbst vollstaendig ist - die Nachreichung verwarf also jede
// Adresse, noch bevor sie irgendetwas holte. Die anderen Anbieter schicken ihr
// Bild in der Trefferliste mit und kamen an dieser Stelle nie vorbei. Genau
// deshalb sah der Fehler nach einem Anbieterproblem aus.
const { absoluteHttpUrl } = require("../src/fortschritt");
const ADRESSE = "https://aniworld.to/anime/stream/naruto";
pruefe("Eine leere Grundlage verwirft auch eine vollstaendige Adresse",
  absoluteHttpUrl(ADRESSE, "") === "");
gleich("Mit der Startseite des Anbieters bleibt sie erhalten",
  absoluteHttpUrl(ADRESSE, "https://aniworld.to/"), ADRESSE);

const nachreichung = hauptQuelle.slice(hauptQuelle.indexOf("async function sucheTrefferbild("));
pruefe("Das Nachreichen nimmt die Startseite des Anbieters als Grundlage",
  /absoluteHttpUrl\(url, provider\.startUrl/.test(nachreichung));
pruefe("Der Anbieter steht deshalb vor der Adresse",
  nachreichung.indexOf("enabledProviders()") < nachreichung.indexOf("absoluteHttpUrl(url,"));

const preload = lies("src/preload.js");
pruefe("Die Oberflaeche kommt an den Kanal heran",
  /searchArtwork: \(treffer\) => ipcRenderer\.invoke\("search:artwork", treffer\)/.test(preload));

const rendererQuelle = lies("src/renderer/renderer.js");
pruefe("Die Trefferkarte bekommt eine Bildebene",
  /bildEbeneSetzen\(card, result\.image \|\| result\.thumbnail \|\| "", null\)/.test(rendererQuelle));
pruefe("Ein Treffer bekommt keinen eigenen Ausschnitt",
  !/bildEbeneSetzen\(card, result\.image[^\n]*, favoriteAusschnitt/.test(rendererQuelle));
pruefe("Das Nachreichen laeuft erst nach dem Zeichnen",
  /globalSearchGrid\.prepend\([\s\S]{0,600}trefferbilderNachreichen\(ohneBild, searchToken\)/.test(rendererQuelle));
pruefe("Eine neue Suche bricht das Nachreichen ab",
  /if \(searchToken !== activeSearchToken\) return;[\s\S]{0,400}api\.searchArtwork\(/.test(rendererQuelle));
pruefe("Nachgereicht wird nur, wo kein Bild kam",
  /if \(!result\.image && !result\.thumbnail && result\.url\)/.test(rendererQuelle));

const stile = lies("src/renderer/styles.css");
pruefe("Die Trefferkarte ist ein eigener Stapel - sonst faellt die Bildebene hinter sie",
  /\.search-result-card\.provider-result \{[^}]*isolation: isolate/.test(stile));
pruefe("Titel und Anbieter stehen ueber dem Bild",
  /\.search-result-card\.provider-result span \{[^}]*z-index: 1/.test(stile));

const gut = pruefungen.filter(Boolean).length;
console.log(`${gut}/${pruefungen.length} bestanden`);
process.exit(gut === pruefungen.length ? 0 : 1);
