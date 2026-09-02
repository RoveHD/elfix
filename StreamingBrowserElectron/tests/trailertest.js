"use strict";
// Der Trailer.
//
// ELFIX holt zu jedem Titel Metadaten - Genres, Besetzung, Laufstatus. Was
// dabei bisher fehlte, ist das Naheliegendste: der Trailer. TMDB fuehrt ihn zu
// jedem Werk, AniList zu jedem Anime, und beide waren schon angebunden.
//
// Zwei Dinge entscheiden darueber, ob das taugt.
//
// Erstens: es muss der Trailer sein und nicht irgendein Video. TMDB haengt an
// ein Werk alles an, was jemand hochgeladen hat - Clips, Interviews,
// "Behind the Scenes". Der erste Eintrag der Antwort ist regelmaessig eine
// Szene aus der Mitte des Films, und die verraet Handlung, die man noch nicht
// kennen wollte.
//
// Zweitens: ein Trailer ist kein Titel, den man schaut. Er zaehlt nicht fuer
// die Statistik, gehoert in keine Watchparty und faengt keine Sitzung an -
// deshalb laeuft er im Fenster der App und nicht in der Anbieteransicht, an
// der all das haengt.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..");
const lies = (teil) => fs.readFileSync(path.join(WURZEL, teil), "utf8").replace(/\r/g, "");
const RENDERER = lies("src/renderer/renderer.js");
const HTML = lies("src/renderer/index.html");
const CSS = lies("src/renderer/styles.css");
const LAUF = lies("src/empfehlungslauf.js");

const geraet = require("../src/metadaten.js");
const server = require(path.join(WURZEL, "..", "sync-server", "metadaten.js"));

const pruefungen = [];
const pruefe = (name, bedingung, detail) => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

function abschnitt(quelle, anfang, ende = "}") {
  const zeilen = quelle.split("\n");
  const von = zeilen.findIndex((z) => z.startsWith(anfang));
  if (von < 0) throw new Error("nicht gefunden: " + anfang);
  let bis = von;
  while (bis < zeilen.length && zeilen[bis] !== ende) bis += 1;
  return zeilen.slice(von, bis + 1).join("\n");
}

// --- Welches Video der Trailer ist ------------------------------------------

const ECHT = {
  results: [
    { type: "Clip", site: "YouTube", key: "clipmitten1", iso_639_1: "de", official: true },
    { type: "Featurette", site: "YouTube", key: "hinterden1", iso_639_1: "de", official: true },
    { type: "Trailer", site: "YouTube", key: "engtrailer1", iso_639_1: "en", official: true,
      published_at: "2021-05-01T00:00:00.000Z" },
    { type: "Teaser", site: "YouTube", key: "deteaser123", iso_639_1: "de", official: true,
      published_at: "2021-06-01T00:00:00.000Z" },
    { type: "Trailer", site: "YouTube", key: "detrailer12", iso_639_1: "de", official: true,
      published_at: "2021-04-01T00:00:00.000Z" },
    { type: "Trailer", site: "Vimeo", key: "vimeotrail1", iso_639_1: "de", official: true }
  ]
};

pruefe("Ein Trailer schlaegt jeden Clip",
  server.trailerAus(ECHT)?.schluessel === "detrailer12",
  server.trailerAus(ECHT)?.schluessel);
pruefe("Deutsch vor Englisch",
  server.trailerAus(ECHT)?.sprache === "de",
  "die App ist deutsch - gibt es keinen, ist der englische besser als keiner");
pruefe("Ohne deutschen bleibt der englische",
  server.trailerAus({ results: [ECHT.results[2], ECHT.results[0]] })?.schluessel === "engtrailer1");
pruefe("Trailer vor Teaser",
  server.trailerAus({ results: [ECHT.results[3], ECHT.results[4]] })?.schluessel === "detrailer12",
  "auch wenn der Teaser neuer ist");
pruefe("Ohne Trailer ist der Teaser besser als nichts",
  server.trailerAus({ results: [ECHT.results[3]] })?.schluessel === "deteaser123");
pruefe("Der offizielle vor dem nachgeladenen",
  server.trailerAus({ results: [
    { type: "Trailer", site: "YouTube", key: "fankanal12", iso_639_1: "de", official: false },
    { type: "Trailer", site: "YouTube", key: "studio1234", iso_639_1: "de", official: true }
  ] })?.schluessel === "studio1234");
pruefe("Bei gleicher Art der neuere",
  server.trailerAus({ results: [
    { type: "Trailer", site: "YouTube", key: "alt2013abc", iso_639_1: "de", official: true,
      published_at: "2013-01-01T00:00:00.000Z" },
    { type: "Trailer", site: "YouTube", key: "neu2024abc", iso_639_1: "de", official: true,
      published_at: "2024-01-01T00:00:00.000Z" }
  ] })?.schluessel === "neu2024abc",
  "zu einer Serie ist die laufende Staffel gemeint");
pruefe("Nur YouTube",
  server.trailerAus({ results: [ECHT.results[5]] }) === null,
  "fuer Vimeo gibt es in ELFIX keinen Weg, der schon da waere");

const unsinn = [
  null, undefined, 0, "x", [], {}, { results: null }, { results: [null, 0, "x"] },
  { results: [{ type: "Trailer", site: "YouTube" }] },
  { results: [{ type: "Trailer", site: "YouTube", key: "" }] },
  { results: [{ type: "Trailer", site: "YouTube", key: "kurz" }] },
  { results: [{ type: "Trailer", site: "YouTube", key: "../../etc/passwd" }] },
  { results: [{ type: "Trailer", site: "YouTube", key: "abc\"><script>x" }] },
  { results: [{ type: "Clip", site: "YouTube", key: "gueltig1234" }] }
];
let geworfen = 0;
let durchgelassen = 0;
for (const fall of unsinn) {
  try {
    if (server.trailerAus(fall) !== null) durchgelassen += 1;
  } catch (fehler) {
    geworfen += 1;
    console.log("   wirft bei:", JSON.stringify(fall)?.slice(0, 60), "->", fehler.message);
  }
}
pruefe("Keine unerwartete Antwort bringt die Auswahl zum Werfen", geworfen === 0,
  `${unsinn.length} Faelle, ${geworfen} Ausnahmen`);
pruefe("Und keine unbrauchbare liefert eine Kennung", durchgelassen === 0,
  `${durchgelassen} von ${unsinn.length}`);

// --- Was davon auf dem Geraet ankommt ---------------------------------------
//
// Die Kennung wird gleich darauf zu einer Adresse zusammengesetzt. Was aus
// einer fremden Antwort kommt, wird deshalb noch einmal geprueft - dieselbe
// Zeichenmenge, die YouTube verwendet.

const voll = geraet.verdichten({
  trailer: { schluessel: "dQw4w9WgXcQ", name: "Offizieller Trailer", sprache: "de", quelle: "tmdb" }
}, "film");
pruefe("Der Trailer ueberlebt das Verdichten",
  voll.trailer?.schluessel === "dQw4w9WgXcQ" && voll.trailer?.name === "Offizieller Trailer");
pruefe("Eine unbrauchbare Kennung nicht",
  ["", "kurz", "javascript:alert(1)", "abc/def", "<script>", null, 42]
    .every((wert) => geraet.verdichten({ trailer: { schluessel: wert } }, "film").trailer === null));
pruefe("Ohne Trailer steht dort null",
  geraet.verdichten({}, "film").trailer === null,
  "kein Trailer ist ein normaler Zustand");
pruefe("Ein Eintrag von vor dem Trailer wird noch einmal gefragt",
  geraet.trailerFehlt({}) === true && geraet.trailerFehlt(voll) === false
  && /client\.trailerFehlt\?\.\(bekannt\)/.test(LAUF),
  "die Cache-Fassung zu erhoehen haette viertausend Zuordnungen weggeworfen");

// --- Die Adresse ------------------------------------------------------------

const sandkasten = { URL, String, Boolean, Number, console };
vm.createContext(sandkasten);
vm.runInContext(abschnitt(RENDERER, "function trailerAdresse("), sandkasten);
const adresse = (trailer) => vm.runInContext("trailerAdresse", sandkasten)(trailer);

pruefe("Die Adresse wird gebaut und nicht uebernommen",
  adresse({ schluessel: "dQw4w9WgXcQ" })
    .startsWith("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?"),
  adresse({ schluessel: "dQw4w9WgXcQ" }));
pruefe("Ohne Kekse und ohne Vorschlaege hinterher",
  adresse({ schluessel: "dQw4w9WgXcQ" }).includes("nocookie")
  && adresse({ schluessel: "dQw4w9WgXcQ" }).includes("rel=0"),
  "nach dem Trailer ist der Trailer zu Ende");
pruefe("Und sie faengt von selbst an",
  adresse({ schluessel: "dQw4w9WgXcQ" }).includes("autoplay=1"));
pruefe("Aus einer unbrauchbaren Kennung wird keine Adresse",
  ["", "kurz", "abc/../evil", "a\">b", null, undefined]
    .every((wert) => adresse({ schluessel: wert }) === "")
  && adresse(null) === "" && adresse({}) === "");

// --- Wo er laeuft -----------------------------------------------------------

pruefe("Der Trailer laeuft im Fenster der App",
  /<dialog class="trailer-modal" id="trailerModal"/.test(HTML)
  && /id="trailerRahmen"/.test(HTML),
  "nicht in der Anbieteransicht - dort haengen Statistik, Sitzung und Watchparty");
pruefe("Das fremde Dokument bekommt nur, was es zum Abspielen braucht",
  /setAttribute\("sandbox", "allow-scripts allow-same-origin allow-presentation"\)/.test(RENDERER)
  && /setAttribute\("allow", "autoplay; encrypted-media; fullscreen; picture-in-picture"\)/.test(RENDERER),
  "kein Navigieren des Hauptfensters, keine Popups");
pruefe("Schliessen raeumt den Rahmen aus",
  /function trailerSchliessen\(\) \{\s*\n\s*trailerRahmen\?\.replaceChildren\(\);/.test(RENDERER),
  "ein Rahmen, der stehen bleibt, spielt weiter - man hoerte einen Trailer, den man nicht sieht");
pruefe("Auch mit Escape und mit einem Klick daneben",
  /trailerModal\?\.addEventListener\("close", \(\) => trailerRahmen\?\.replaceChildren\(\)\)/.test(RENDERER)
  && /if \(ereignis\.target === trailerModal\) trailerSchliessen\(\)/.test(RENDERER));
pruefe("Der Kasten hat das Seitenverhaeltnis eines Videos",
  /\.trailer-rahmen \{[\s\S]{0,120}?aspect-ratio: 16 \/ 9;/.test(CSS));

// --- Und wie man hinkommt ---------------------------------------------------

pruefe("Jede Karte bietet ihn an",
  (RENDERER.match(/text: "Trailer ansehen"/g) || []).length === 2
  && /symbol: "▷"/.test(RENDERER),
  "die eigenen Kacheln und die Vorschlaege - zwei Menues, zwei Eintraege");
pruefe("Vor allem die Vorschlaege",
  /tun: \(\) => trailerZeigen\(item\.title, item\.url\)/.test(RENDERER),
  "ein Vorschlag ist ein Titel, den man nicht kennt - genau da fragt man danach");
pruefe("Gefragt wird mit Titel und Adresse, nicht mit einer Kennung",
  /async function trailerZeigen\(titel, url\)/.test(RENDERER)
  && /const trailer = await api\.getTrailer\?\.\(name, url\)/.test(RENDERER)
  && /getTrailer: \(titel, url\) => ipcRenderer\.invoke\("titel:trailer", titel, url\)/
    .test(lies("src/preload.js")),
  "ein Vorschlag auf der Startseite hat keinen Eintrag in der Mediathek");
pruefe("Und erst beim Klick",
  !/getTrailer\?\.\([^)]*\)[^;]*;[\s\S]{0,80}?forEach/.test(RENDERER),
  "die Metadaten jeder Kachel vorab zu holen waere ein Abruf je Kachel");
pruefe("Der Hauptprozess antwortet auch ohne Gateway",
  /ipcMain\.handle\("titel:trailer"[\s\S]{0,420}?catch \{[\s\S]{0,220}?return null;/
    .test(lies("src/main.js")),
  "kein Gateway, kein Treffer, kein Netz - alles dasselbe Ergebnis");
pruefe("Gibt es keinen, sagt das eine Zeile",
  /ist kein Trailer hinterlegt/.test(RENDERER),
  "nicht zu jedem Titel gibt es einen");
pruefe("Und im Titelkasten steht die Knopfreihe",
  /function titelAktionen\(favorite\)/.test(RENDERER)
  && /"▶ Abspielen"/.test(RENDERER) && /"♡ Auf die Watchlist"/.test(RENDERER));
pruefe("Der Trailer-Knopf kommt nach, sobald die Metadaten da sind",
  /trailerKnopfNachtragen\(favorite, metadaten\?\.trailer\)/.test(RENDERER),
  "erst die Antwort sagt, ob es ueberhaupt einen gibt");
pruefe("Die Knoepfe schliessen den Kasten nicht aus Versehen",
  /\/\/ gewoehnlicher Knopf darin schloesse ihn bei jedem Klick\.[\s\S]{0,60}?feld\.type = "button";/
    .test(RENDERER)
  || /feld\.type = "button";/.test(RENDERER),
  "der Kasten steht in einem Formular");

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
