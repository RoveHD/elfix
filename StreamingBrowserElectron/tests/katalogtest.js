"use strict";
// Die Katalogseiten der Anbieter - und die Frage, ob daraus ein Querschnitt
// wird oder nur ein Anfang.
//
// Der Fehler, gegen den diese Pruefungen stehen: die Genre-Uebersichten sind
// blaetterbar und alphabetisch sortiert. Wer nur die erste Seite liest, hat
// fuer immer nur Titel mit "A" und Ziffern im Angebot. Genau das stand auf der
// Startseite - "A Knight of the Seven Kingdoms", "100-man", "Acapulco H.E.A.T."
// -, und keine Bewertung dahinter kann das noch heilen: was nie Kandidat war,
// kann nicht empfohlen werden.

const D = require("../src/discover");

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(b); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };

// --- Blaetterleisten der drei Anbieter ---------------------------------------
//
// Verkuerzt, aber im Aufbau genau wie im Original. AniWorld haengt die
// Seitenzahl an den Pfad, S.to und Filmo nehmen einen Parameter.

const ANIWORLD = `
<div class="hosterSiteDirectNav pagination"><ul>
<li class="active"><a href="#" class="active">1</a>
<li><a href="https://aniworld.to/genre/action/2">2</a></li>
<li><a href="https://aniworld.to/genre/action/3">3</a></li>
<li><a href="https://aniworld.to/genre/action/16">16</a></li>
<li><a href="https://aniworld.to/genre/action/2">&gt;</a></li>
<li><a href="https://aniworld.to/genre/action/36">Ende</a></li>
</ul></div>`;

const STO = `
<nav><ul class="pagination">
<li class="page-item active"><span class="page-link">1</span></li>
<li class="page-item"><a class="page-link" href="http://186.2.175.5/genre/action?page=2">2</a></li>
<li class="page-item"><a class="page-link" href="http://186.2.175.5/genre/action?page=60">60</a></li>
</ul></nav>
<a href="/katalog/0-9">0-9</a>`;

const FILMO = `
<nav class="site-pagination">
<a class="page-link" href="https://filmo.to/genres/action?page=2" rel="next">Weiter &raquo;</a>
<a class="page-link" href="https://filmo.to/genres/action?page=46">46</a>
</nav>`;

const anw = D.extractPagination(ANIWORLD, "https://aniworld.to/genre/action");
pruefe("AniWorld: letzte Seite", anw.letzte === 36, "letzte=" + anw.letzte);
pruefe("AniWorld: Muster am Pfadende", anw.muster === "https://aniworld.to/genre/action/{n}", anw.muster);
pruefe("AniWorld: Seite 7", D.seitenAdresse(anw.muster, 7, "https://aniworld.to/genre/action")
  === "https://aniworld.to/genre/action/7");

const sto = D.extractPagination(STO, "http://186.2.175.5/genre/action");
pruefe("S.to: letzte Seite", sto.letzte === 60, "letzte=" + sto.letzte);
pruefe("S.to: Muster als Parameter", sto.muster === "http://186.2.175.5/genre/action?page={n}", sto.muster);

const filmo = D.extractPagination(FILMO, "https://filmo.to/genres/action");
pruefe("Filmo: letzte Seite", filmo.letzte === 46, "letzte=" + filmo.letzte);

// Seite 1 wird von keinem Anbieter als "/1" verlinkt - sie bleibt die
// Ausgangsadresse, sonst holt der erste Abruf eine Seite, die es nicht gibt.
pruefe("Seite 1 bleibt die Ausgangsadresse",
  D.seitenAdresse(anw.muster, 1, "https://aniworld.to/genre/action") === "https://aniworld.to/genre/action");

// --- Was keine Blaetterleiste ist --------------------------------------------

const OHNE = `<a href="https://aniworld.to/anime/stream/naruto">Naruto</a>
<a href="https://aniworld.to/genre/komoedie">Komoedie</a>`;
const ohne = D.extractPagination(OHNE, "https://aniworld.to/genre/action");
pruefe("Ohne Blaetterleiste bleibt es bei einer Seite", ohne.letzte === 1 && ohne.muster === "", "letzte=" + ohne.letzte);

// Ein Link auf eine andere Seite desselben Anbieters ist keine Seitenzahl.
const FREMD = `<a href="https://aniworld.to/genre/drama/9">Drama 9</a>`;
pruefe("Fremde Genre-Seite zaehlt nicht",
  D.extractPagination(FREMD, "https://aniworld.to/genre/action").letzte === 1);

// Und ein Link auf einen anderen Wirt schon gar nicht.
const ANDERER = `<a href="http://186.2.175.5/genre/action?page=99">99</a>`;
pruefe("Anderer Anbieter zaehlt nicht",
  D.extractPagination(ANDERER, "https://aniworld.to/genre/action").letzte === 1);

// Vierstellige Zahlen im Pfad sind Jahre oder Werk-Nummern, keine Seiten.
const JAHR = `<a href="https://filmo.to/genres/action?page=9999">9999</a>`;
pruefe("Unsinnig hohe Seitenzahl wird verworfen",
  D.extractPagination(JAHR, "https://filmo.to/genres/action").letzte === 1);

// --- Die Stichprobe ----------------------------------------------------------
//
// Sie entscheidet, welcher Ausschnitt des Katalogs ueberhaupt gelesen wird.
// Zwei Dinge muessen stimmen: sie muss bis ans Ende reichen, und sie muss bei
// gleicher Eingabe immer dasselbe liefern.

const stich = D.seitenStichprobe(36, 8);
pruefe("Stichprobe hat die gewuenschte Groesse", stich.length === 8, stich.join(","));
pruefe("Stichprobe faengt bei Seite 1 an", stich[0] === 1, stich.join(","));
pruefe("Stichprobe reicht in die letzte Katalogviertel",
  stich[stich.length - 1] > 36 * 0.75, "letzte gezogene Seite " + stich[stich.length - 1]);
pruefe("Stichprobe ist aufsteigend und ohne Doppel",
  stich.every((wert, i) => i === 0 || wert > stich[i - 1]), stich.join(","));
pruefe("Stichprobe ist deterministisch",
  D.seitenStichprobe(36, 8).join(",") === stich.join(","));

// Der Abstand zwischen zwei gezogenen Seiten darf nicht auseinanderlaufen -
// sonst deckt die Stichprobe wieder vor allem den Anfang ab.
const abstaende = stich.slice(1).map((wert, i) => wert - stich[i]);
pruefe("Stichprobe ist gleichmaessig verteilt",
  Math.max(...abstaende) - Math.min(...abstaende) <= 1, "Abstaende " + abstaende.join(","));

pruefe("Weniger Seiten als Wuensche: alle nehmen",
  D.seitenStichprobe(3, 8).join(",") === "1,2,3");
pruefe("Eine einzige Seite", D.seitenStichprobe(1, 8).join(",") === "1");
pruefe("Unsinnige Seitenzahl faellt auf eine Seite zurueck",
  D.seitenStichprobe(0, 8).join(",") === "1" && D.seitenStichprobe(-5, 8).join(",") === "1");

// --- Der eigentliche Zweck ---------------------------------------------------
//
// Ein alphabetischer Katalog, gelesen ueber die ganze Blaetterleiste, muss ein
// Alphabet ergeben - nicht dreissig Mal "A". Das hier ist die Pruefung, die den
// urspruenglichen Fehler gesehen haette.

const BUCHSTABEN = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
// Ein gedachter Katalog: 26 Seiten, je 30 Titel, alphabetisch sortiert.
const katalog = [];
for (const buchstabe of BUCHSTABEN) {
  for (let n = 0; n < 30; n += 1) katalog.push(buchstabe + String(n).padStart(2, "0"));
}
const seiten = [];
for (let index = 0; index < katalog.length; index += 30) seiten.push(katalog.slice(index, index + 30));

const nurErste = seiten[0];
pruefe("Nur Seite 1: ein einziger Buchstabe",
  new Set(nurErste.map((t) => t[0])).size === 1, [...new Set(nurErste.map((t) => t[0]))].join(""));

const gelesen = D.seitenStichprobe(seiten.length, 8).flatMap((n) => seiten[n - 1]);
const abdeckung = new Set(gelesen.map((t) => t[0]));
pruefe("Stichprobe ueber acht Seiten: acht verschiedene Buchstaben",
  abdeckung.size === 8, [...abdeckung].join(""));
pruefe("Stichprobe reicht ueber das ganze Alphabet",
  [...abdeckung].some((b) => BUCHSTABEN.indexOf(b) > 18), [...abdeckung].join(""));

// --- Auswahl aus einer Guetegruppe -------------------------------------------
//
// Das Gegenstueck zur Stichprobe auf der Kandidatenseite: wenn mehr Titel
// gleich gut passen als Plaetze da sind, darf nicht der Anfang genommen werden.
// Das ist derselbe Fehler wie oben, nur eine Stufe spaeter - und er faellt
// weniger auf, weil die Liste dann schon "bewertet" aussieht.

function gleichmaessigVerteilt(items, anzahl) {
  const liste = items || [];
  if (liste.length <= anzahl) return liste;
  const schritt = liste.length / anzahl;
  const auswahl = [];
  for (let index = 0; index < anzahl; index += 1) auswahl.push(liste[Math.floor(index * schritt)]);
  return auswahl;
}

const gleichGut = BUCHSTABEN.split("").flatMap((b) => [b + "1", b + "2"]);
const gewaehlt = gleichmaessigVerteilt(gleichGut, 8);
pruefe("Gleich gute Kandidaten: Auswahl nimmt nicht den Anfang",
  new Set(gewaehlt.map((t) => t[0])).size === 8, gewaehlt.join(","));
pruefe("Gleich gute Kandidaten: Auswahl reicht bis ans Ende",
  BUCHSTABEN.indexOf(gewaehlt[gewaehlt.length - 1][0]) > 18, gewaehlt.join(","));
pruefe("Gleich gute Kandidaten: Auswahl ist deterministisch",
  gleichmaessigVerteilt(gleichGut, 8).join(",") === gewaehlt.join(","));
pruefe("Gleich gute Kandidaten: nichts geht verloren, wenn Platz da ist",
  gleichmaessigVerteilt(gleichGut, 100).length === gleichGut.length);

// --- Kachel, Titel und Bild gehoeren zusammen --------------------------------
//
// Der Ausschnitt ist echtes S.to-Markup aus dem "Das schauen andere"-Block.
// Zwei Fallen stecken darin, und beide haben in der App zugeschlagen:
//
//   1. Das Poster liegt unter `.../channel/desktop/avatar-OPQmI5KE`. Das Wort
//      "avatar" steht auf der Muellliste (gedacht fuer Profilbilder), also flog
//      das richtige Bild raus - und die Notfallsuche nahm das der Nachbarkachel.
//      Auf der Karte stand Avatar mit dem Plakat von Supergirl.
//   2. Faellt der Bild-Anker aus, greift der zweite Anker mit dem Titel. Dort
//      stehen zwei Spans: der Titel und darunter das Genre. Zusammengezogen
//      wurde daraus "Avatar - Der Herr der Elemente Zeichentrick" - ein Werk,
//      das es nicht gibt, und das deshalb auch nicht mehr als schon gesehen
//      erkannt wurde. Die Karte begruendete sich am Ende mit sich selbst.

const STO_KACHELN = `
<h2>Das schauen andere</h2>
<div class="swiper-wrapper">
  <div class="swiper-slide"><article class="continue-card">
    <a href="/serie/avatar" class="d-block continue-cover">
      <picture>
        <source type="image/webp" data-srcset=" /media/images/channel/desktop/avatar-OPQmI5KE?format=webp 1024w">
        <img data-src="/media/images/channel/desktop/avatar-OPQmI5KE?format=jpg"
             src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=="
             alt="Avatar - Der Herr der Elemente">
      </picture>
    </a>
    <h3 class="continue-title">
      <a href="/serie/avatar" class="stretched-link">
        <span class="d-block fs-6 fw-semibold mb-1">Avatar - Der Herr der Elemente</span>
        <span class="d-block text-muted">Zeichentrick</span>
      </a>
    </h3>
  </article></div>
  <div class="swiper-slide"><article class="continue-card">
    <a href="/serie/supergirl" class="d-block continue-cover">
      <picture>
        <img data-src="/media/images/channel/desktop/supergirl-f9mn2n41?format=jpg"
             src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=="
             alt="Supergirl">
      </picture>
    </a>
    <h3 class="continue-title">
      <a href="/serie/supergirl" class="stretched-link">
        <span class="d-block fs-6 fw-semibold mb-1">Supergirl</span>
        <span class="d-block text-muted">Action &amp; Adventure</span>
      </a>
    </h3>
  </article></div>
</div>`;

{
  const kacheln = D.extractRelatedItems(STO_KACHELN, "http://sto.test/serie/game-of-thrones",
    { id: "sto", name: "S.to" }, 12);
  const avatar = kacheln.find((k) => /\/serie\/avatar$/.test(k.url));
  const supergirl = kacheln.find((k) => /supergirl/.test(k.url));

  pruefe("Kacheln: beide Werke erkannt, jedes einmal", kacheln.length === 2,
    kacheln.map((k) => k.title).join(" | "));
  pruefe("Kacheln: das Genre klebt nicht am Titel",
    avatar?.title === "Avatar - Der Herr der Elemente", avatar?.title);
  pruefe("Kacheln: das Poster gehoert zum Werk, nicht zum Nachbarn",
    /avatar-OPQmI5KE/.test(avatar?.image || ""), avatar?.image);
  pruefe("Kacheln: der Nachbar behaelt sein eigenes Poster",
    /supergirl-f9mn2n41/.test(supergirl?.image || ""), supergirl?.image);
  pruefe("Kacheln: der Platzhalter aus dem src wird nicht genommen",
    !/base64|data:image/.test(avatar?.image || ""), avatar?.image);
}

{
  // Die Muellliste muss weiter greifen, wo sie soll: ein Profilbild heisst
  // nicht wie das Werk, unter dem es steht.
  const mitLogo = `<a href="/serie/dark"><img src="/assets/avatar-platzhalter.png" alt="Dark"></a>`;
  const kacheln = D.extractCatalogItems(mitLogo, "http://sto.test/", { id: "sto", name: "S.to" }, 5);
  pruefe("Ein Profilbild bleibt aussen vor, wenn es nicht zum Werk gehoert",
    kacheln.length === 0, JSON.stringify(kacheln.map((k) => k.image)));
}

const gesamt = pruefungen.length;
const gut = pruefungen.filter(Boolean).length;
console.log(`${gut}/${gesamt} bestanden`);
process.exit(gut === gesamt ? 0 : 1);
