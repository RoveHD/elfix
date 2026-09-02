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
// Der Fehler, der gemeldet wurde: zu einem Film mit deutschem Trailer bei TMDB
// sagte ELFIX "kein Trailer hinterlegt". Der Dienst des Benutzers war aelter
// als die Funktion und schickte das Feld gar nicht - eingetragen wurde
// trotzdem "keiner", und weil das Feld damit dastand, wurde nie neu gefragt.
pruefe("Ein Dienst, der das Feld nicht kennt, hinterlaesst kein \"keiner\"",
  !("trailer" in geraet.verdichten({ titel: "X" }, "film"))
  && geraet.trailerFehlt(geraet.verdichten({ titel: "X" }, "film")) === true,
  "sonst stuende \"es gibt keinen\" fuer immer im Zwischenspeicher");
pruefe("Ein Dienst, der ihn kennt und keinen findet, bleibt dabei",
  geraet.verdichten({ trailer: null }, "film").trailer === null
  && geraet.trailerFehlt(geraet.verdichten({ trailer: null }, "film")) === false,
  "das ist eine Antwort und keine Luecke");
pruefe("Eine unbrauchbare Kennung nicht",
  ["", "kurz", "javascript:alert(1)", "abc/def", "<script>", null, 42]
    .every((wert) => geraet.verdichten({ trailer: { schluessel: wert } }, "film").trailer === null));
pruefe("Ohne Angabe steht dort gar nichts",
  geraet.verdichten({}, "film").trailer === undefined,
  "unbekannt ist keine Antwort - es wird noch einmal gefragt");
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
  && /const antwort = await api\.getTrailer\?\.\(name, url\)/.test(RENDERER)
  && /getTrailer: \(titel, url\) => ipcRenderer\.invoke\("titel:trailer", titel, url\)/
    .test(lies("src/preload.js")),
  "ein Vorschlag auf der Startseite hat keinen Eintrag in der Mediathek");
pruefe("Und erst beim Klick",
  !/getTrailer\?\.\([^)]*\)[^;]*;[\s\S]{0,80}?forEach/.test(RENDERER),
  "die Metadaten jeder Kachel vorab zu holen waere ein Abruf je Kachel");
pruefe("Der Hauptprozess antwortet auch ohne Dienst und ohne Netz",
  // Das Fenster ist gross genug fuer den Handler samt seiner Begruendungen -
  // gesucht wird, dass am Ende ein catch steht, nicht wie kurz der Weg dahin ist.
  /ipcMain\.handle\("titel:trailer"[\s\S]{0,2600}?catch \{\s*\n\s*return \{ trailer: null, grund: "fehler" \};/
    .test(lies("src/main.js")),
  "eine Ausnahme darf die Kachel nicht stehenlassen");
pruefe("Gibt es keinen, sagt das eine Zeile - und welchen Grund",
  /function trailerGrundText\(grund, name\)/.test(RENDERER)
  && /kein-dienst/.test(RENDERER) && /dienst-zu-alt/.test(RENDERER)
  && /nicht-zugeordnet/.test(RENDERER) && /ist kein Trailer hinterlegt/.test(RENDERER),
  "vier Ursachen, drei davon behebbar - aber nur, wenn dasteht, welche es ist");
pruefe("Und der Hauptprozess nennt ihn",
  /return \{ trailer: null, grund: "kein-dienst" \};/.test(lies("src/main.js"))
  && /if \(metadatenModul\.trailerFehlt\(form\)\) return \{ trailer: null, grund: "dienst-zu-alt" \};/
    .test(lies("src/main.js")),
  "ein zu alter Metadaten-Dienst ist der haeufigste Fall nach einem Update");
// --- Der fehlende TMDB-Schluessel --------------------------------------------
//
// Ohne ihn kommt das Relay an Filme und Serien gar nicht heran. Was die App
// davon sieht, ist ein Werk, das sich nicht zuordnen laesst, oder ein Datensatz
// ohne Trailerfeld - und beide Meldungen dazu schickten den Leser hinter der
// falschen Ursache her: zur Zuordnung oder zum Aktualisieren eines Relays, das
// schon die neueste Fassung ist.

const HAUPT = lies("src/main.js");

pruefe("Der Grund steht vor den beiden, die er verursacht",
  HAUPT.indexOf('grund: "kein-tmdb"') > 0
  && HAUPT.indexOf('grund: "kein-tmdb"') < HAUPT.indexOf('grund: "nicht-zugeordnet"')
  && HAUPT.indexOf('grund: "kein-tmdb"') < HAUPT.indexOf('grund: "dienst-zu-alt"'),
  "sonst gewinnt die Folge gegen die Ursache");
pruefe("Anime bleibt aussen vor",
  /form\?\.art !== "anime" && metadatenClient\(\)\.tmdbFehlt\?\.\(\)/.test(HAUPT),
  "das kommt von AniList und braucht keinen Schluessel");
pruefe("Und die Zeile dazu nennt den Schluessel",
  /grund === "kein-tmdb"/.test(RENDERER) && /TMDB-Schlüssel/.test(RENDERER));

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

// --- Der Rahmen und seine Herkunft -------------------------------------------
//
// Die Oberflaeche kommt von der Platte (file://), und ein Dokument von dort hat
// keinen Ursprung, den YouTube gelten laesst. Der eingebettete Player prueft
// die Herkunft, findet nichts und zeigt statt des Videos "Fehler bei der
// Konfiguration des Videoplayers - Fehler 153". Also wird ihm gesagt, auf
// welcher Seite er steht - und nur ihm.
//
// Welche Seite man nennt, entscheidet aber mit, und der naheliegende Wert war
// der falsche. Nachgemessen in einem echten file://-Fenster (Electron, vier
// Videos nebeneinander, darunter der gemeldete Trailer vwwIVikRA1I und ein
// beliebig einbettbares Kontrollvideo):
//
//   ohne Herkunft                      Fehler 153
//   Referer https://www.youtube.com/   "Dieses Video ist nicht verfuegbar
//                                       - Fehlercode: 152 - 4"
//   Referer https://elfix.local/       spielt, alle vier
//
// Mit "youtube.com" behauptet der Rahmen, YouTube bette sich selbst ein. Das
// laesst YouTube nicht gelten - der zweite Fehler war also kein Rest des
// ersten, sondern seine Folge. Es muss eine fremde Seite sein; dann taugt jede,
// und ELFIX nennt sich selbst.

const yt = require("../src/youtube.js");
const HAUPT2 = lies("src/main.js");

pruefe("Eine Einbettung wird als solche erkannt",
  yt.istEinbettung("https://www.youtube-nocookie.com/embed/ABCdef12345?autoplay=1")
  && yt.istEinbettung("https://www.youtube.com/embed/ABCdef12345"));
pruefe("Eine gewoehnliche YouTube-Seite nicht",
  !yt.istEinbettung("https://www.youtube.com/watch?v=ABCdef12345"),
  "die laeuft in der Anbieteransicht und geht diesen Weg nichts an");
pruefe("Und nichts Fremdes",
  !yt.istEinbettung("https://beispiel.de/embed/ABCdef12345")
  && !yt.istEinbettung("http://www.youtube.com/embed/ABCdef12345")
  && !yt.istEinbettung("https://www.youtube.com/embed/../etwas"),
  "kein http, kein fremder Wirt, kein Pfad, der wegfuehrt");

const koepfe = yt.einbettungsKoepfe("https://www.youtube-nocookie.com/embed/ABCdef12345", { "User-Agent": "x" });
pruefe("Der Rahmen bekommt eine Herkunft mit",
  koepfe.Referer === yt.EINBETTUNGS_HERKUNFT && koepfe["User-Agent"] === "x",
  "und behaelt, was sonst im Kopf steht");
pruefe("Und es ist eine fremde Seite, nicht YouTube selbst",
  !/(^|\.)youtube(-nocookie)?\.com/.test(new URL(yt.EINBETTUNGS_HERKUNFT).hostname)
  && new URL(yt.EINBETTUNGS_HERKUNFT).protocol === "https:",
  "genau das war Fehlercode 152 - 4: YouTube laesst sich nicht in sich selbst einbetten");
pruefe("Ein Origin wird nicht erfunden",
  !("Origin" in koepfe) && !("origin" in koepfe),
  "zu einer Navigation schickt auch ein Browser keinen - und gemessen aendert er nichts");
pruefe("Eine vorhandene Herkunft wird nicht ueberschrieben",
  yt.einbettungsKoepfe("https://www.youtube.com/embed/ABCdef12345",
    { referer: "https://andere.de" }) === null);
pruefe("Alles andere bleibt unangetastet",
  yt.einbettungsKoepfe("https://www.youtube.com/watch?v=ABCdef12345", {}) === null);

pruefe("Der Hauptprozess haengt das an die Sitzung des Fensters",
  /session\.defaultSession\.webRequest\.onBeforeSendHeaders\(muster/.test(HAUPT2)
  && /youtube\.einbettungsKoepfe\(details\.url, details\.requestHeaders\)/.test(HAUPT2),
  "nicht an die der Anbieter - dort haengt der Werbefilter, und die beiden haben nichts miteinander zu tun");
pruefe("Und nur an Einbettungen",
  /urls: \["https:\/\/\*\.youtube\.com\/embed\/\*", "https:\/\/\*\.youtube-nocookie\.com\/embed\/\*"\]/
    .test(HAUPT2));

// --- Und wenn der Player trotzdem nein sagt ----------------------------------

pruefe("Unter dem Rahmen steht ein Ausweg",
  HTML.includes('id="trailerExtern"') && /Auf YouTube ansehen/.test(HTML));
pruefe("Er haengt an einer Funktion",
  /#trailerExtern"\)\?\.addEventListener\("click", trailerExternOeffnen\)/.test(RENDERER));
pruefe("Der Renderer gibt dabei nur die Kennung mit",
  /api\.openTrailerExtern\?\.\(trailerSchluessel\)/.test(RENDERER)
  && !/openTrailerExtern\?\.\(`/.test(RENDERER),
  "die Adresse baut der Hauptprozess - sonst waere jede Stelle im Renderer eine moegliche Quelle einer fremden");
pruefe("Der Hauptprozess prueft sie und baut die Adresse selbst",
  /ipcMain\.handle\("titel:trailer-extern"/.test(HAUPT2)
  && /\^\[A-Za-z0-9_-\]\{6,20\}\$/.test(HAUPT2)
  && /shell\.openExternal\(`https:\/\/www\.youtube\.com\/watch\?v=\$\{kennung\}`\)/.test(HAUPT2));
pruefe("Und der Rahmen vergisst die Kennung beim Schliessen",
  /function trailerSchliessen\(\) \{[\s\S]{0,120}?trailerSchluessel = "";/.test(RENDERER),
  "ein Knopf, der noch das Video von vorhin oeffnet, waere schlimmer als keiner");

// Und woher die App das weiss: das Relay sagt es in jeder Antwort.

// Ein Klient, dem man die Antwort des Relays vorgeben kann.
function klientBauen(vorgabe, ablage = {}) {
  return geraet.erstellen({
    basis: "http://relay.beispiel",
    holen: async () => ({
      ok: true,
      status: 200,
      json: async () => vorgabe.antwort
    }),
    laden: () => ablage.stand || {},
    speichern: (daten) => { ablage.stand = daten; }
  });
}

const vorgabe = {
  antwort: {
    treffer: [{ id: "a", art: "film", konfidenz: "UNMATCHED", trailer: null }],
    quellen: null
  }
};
const client = klientBauen(vorgabe);

pruefe("Ohne Auskunft wird nichts behauptet", !client.tmdbFehlt(),
  "eine Meldung ueber einen fehlenden Schluessel, ohne ihn geprueft zu haben, waere derselbe Fehler");

(async () => {
  const werk = (titel, art = "film") => geraet.wunschBauen({ titel, art });

  const ohne = { metadata: true, tmdb: "unavailable", anilist: "available" };
  const mit = { metadata: true, tmdb: "configured", anilist: "available" };

  vorgabe.antwort.quellen = ohne;
  await client.nachschlagen([werk("Spider-Man")]);
  pruefe("Sagt das Relay, der Schluessel fehle, merkt die App es sich", client.tmdbFehlt());

  vorgabe.antwort.quellen = mit;
  await client.nachschlagen([werk("Spider-Man 2")]);
  pruefe("Und wenn er nachgetragen wird, verschwindet die Meldung wieder",
    !client.tmdbFehlt() && client.tmdbDa(),
    "sonst bliebe die Zeile stehen, bis jemand die App neu startet");

  // --- Was der Schluessel an alten Eintraegen aendert -------------------------
  //
  // Ohne Schluessel ist jedes Werk "nicht gefunden", und das wird fuenf Tage
  // gemerkt. Wer den Schluessel danach eintraegt, saesse eine knappe Woche auf
  // lauter Absagen, die niemand mehr erklaeren kann.

  const ablage = {};
  const zweiter = klientBauen(vorgabe, ablage);
  vorgabe.antwort.quellen = ohne;
  vorgabe.antwort.treffer = [{ id: werk("Dune").schluessel, art: "film", konfidenz: "UNMATCHED" }];
  await zweiter.nachschlagen([werk("Dune")]);

  pruefe("Solange der Schluessel fehlt, bleibt das Nicht-Gefunden stehen",
    Boolean(zweiter.ausCache(werk("Dune"))),
    "sonst fragte jeder Durchlauf dieselben zweihundert Titel neu");

  vorgabe.antwort.quellen = mit;
  vorgabe.antwort.treffer = [{ id: werk("Irgendwas").schluessel, art: "film", konfidenz: "UNMATCHED" }];
  await zweiter.nachschlagen([werk("Irgendwas")]);
  pruefe("Ist der Schluessel da, gilt die alte Absage nicht mehr",
    zweiter.ausCache(werk("Dune")) === null,
    "genau das ist der Fall, in dem die App sonst tagelang bei ihrer falschen Auskunft bleibt");

  const anime = { metadata: true, tmdb: "unavailable", anilist: "available" };
  const dritter = klientBauen(vorgabe, {});
  vorgabe.antwort.quellen = anime;
  vorgabe.antwort.treffer = [{ id: werk("Kein Anime", "anime").schluessel, art: "anime", konfidenz: "UNMATCHED" }];
  await dritter.nachschlagen([werk("Kein Anime", "anime")]);
  vorgabe.antwort.quellen = mit;
  vorgabe.antwort.treffer = [{ id: werk("Egal").schluessel, art: "film", konfidenz: "UNMATCHED" }];
  await dritter.nachschlagen([werk("Egal")]);
  pruefe("Anime bleibt davon unberuehrt",
    Boolean(dritter.ausCache(werk("Kein Anime", "anime"))),
    "das kam nie von TMDB, also aendert ein Schluessel daran nichts");

  // Und der Fall, der den Anlass gab: Eintraege von vor dieser Marke.
  const alt = { stand: JSON.parse(JSON.stringify(ablage.stand)) };
  for (const eintrag of Object.values(alt.stand.eintraege)) delete eintrag.ohneTmdb;
  const vierter = klientBauen(vorgabe, alt);
  vorgabe.antwort.quellen = mit;
  vorgabe.antwort.treffer = [{ id: werk("Noch was").schluessel, art: "film", konfidenz: "UNMATCHED" }];
  await vierter.nachschlagen([werk("Noch was")]);
  pruefe("Auch ein Eintrag von vor der Marke wird noch einmal gefragt",
    vierter.ausCache(werk("Dune")) === null,
    "sonst haette gerade der, der den Fehler erlebt hat, nichts davon");

  const fehlerAnzahl = pruefungen.filter((ok) => !ok).length;
  console.log(`\n${pruefungen.length - fehlerAnzahl}/${pruefungen.length} bestanden`);
  process.exit(fehlerAnzahl ? 1 : 0);
})();
