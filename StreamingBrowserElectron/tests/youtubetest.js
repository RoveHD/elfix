"use strict";
// YouTube und "Weiterschauen" - und vor allem: dass die anderen davon nichts
// merken.
//
// Anlass: bei YouTube fing "Weiterschauen" wieder bei null an. Zwei Gruende
// steckten dahinter. Die Sekunde wurde beim Oeffnen nie mitgegeben, und
// YouTube haengt an dieselbe Adresse je nach Herkunft "list", "index", "pp"
// oder "si" - fuer ELFIX waren das verschiedene Titel mit eigenem Stand.
//
// Der zweite Teil dieser Pruefung ist der wichtigere: jede Funktion hier muss
// fremde Adressen unveraendert durchreichen. AniWorld, S.to, Filmo und die
// Hoster duerfen von der YouTube-Sonderbehandlung nichts abbekommen.

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const WURZEL = path.join(__dirname, "..");
const lies = (datei) => fs.readFileSync(path.join(WURZEL, datei), "utf8").split("\r\n").join("\n");
const yt = require(path.join(WURZEL, "src", "youtube.js"));
const taste = require(path.join(WURZEL, "src", "taste.js"));

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(Boolean(b)); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };

// Die Adressen, um die es bei den anderen Anbietern geht. Sie kommen unten
// mehrfach vor - jede Funktion muss sie in Ruhe lassen.
const FREMDE = [
  "https://aniworld.to/anime/stream/naruto/staffel-1/episode-1",
  "https://s.to/serie/stream/dark/staffel-1/episode-2",
  "https://filmo.co/film/beispiel",
  "https://voe.sx/e/abc123",
  "https://filemoon.sx/e/xyz",
  "https://streamtape.com/e/abc?t=99",
  "https://example.com/watch?v=ABC123"
];

console.log("-- Erkennen --");
pruefe("Die YouTube-Schreibweisen werden erkannt",
  ["https://www.youtube.com/watch?v=ABC", "https://youtube.com/watch?v=ABC", "https://m.youtube.com/watch?v=ABC",
    "https://music.youtube.com/watch?v=ABC", "https://youtu.be/ABC", "https://www.youtube-nocookie.com/embed/ABC"]
    .every((u) => yt.istYoutubeUrl(u)));
pruefe("Fremde Adressen gelten nicht als YouTube",
  FREMDE.every((u) => !yt.istYoutubeUrl(u)),
  FREMDE.filter((u) => yt.istYoutubeUrl(u)).join(", ") || "keine");

const kennungen = [
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=4", "dQw4w9WgXcQ"],
  ["https://youtu.be/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ"],
  ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ["https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"]
];
pruefe("Die Videokennung wird aus jeder Schreibweise gezogen",
  kennungen.every(([u, id]) => yt.videoKennung(u)?.id === id),
  kennungen.filter(([u, id]) => yt.videoKennung(u)?.id !== id).map(([u]) => u).join(", ") || "alle");
pruefe("Ein Short wird als Short erkannt",
  yt.videoKennung("https://www.youtube.com/shorts/ABC").kurz === true
  && yt.videoKennung("https://www.youtube.com/watch?v=ABC").kurz === false);
pruefe("Die Playlist wird mitgenommen",
  yt.videoKennung("https://www.youtube.com/watch?v=ABC&list=PL9").liste === "PL9");
pruefe("Eine YouTube-Seite ohne Video hat keine Kennung",
  yt.videoKennung("https://www.youtube.com/feed/subscriptions") === null
  && yt.videoKennung("https://www.youtube.com/@kanal") === null);

console.log("\n-- Ein Video, ein Eintrag --");
const varianten = [
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=4",
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ&pp=ygUJdGVzdA%3D%3D",
  "https://youtu.be/dQw4w9WgXcQ?si=xyz",
  "https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=90",
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ#kommentare"
];
const schluessel = new Set(varianten.map((u) => yt.normalisiereYoutubeUrl(u)));
pruefe("Alle sechs Varianten desselben Videos ergeben einen Schluessel",
  schluessel.size === 1 && [...schluessel][0] === "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  [...schluessel].join(" | "));
pruefe("Zwei verschiedene Videos bleiben zwei Eintraege",
  yt.normalisiereYoutubeUrl("https://www.youtube.com/watch?v=AAA")
  !== yt.normalisiereYoutubeUrl("https://www.youtube.com/watch?v=BBB"));
pruefe("Fremde Adressen bekommen keinen YouTube-Schluessel",
  FREMDE.every((u) => yt.normalisiereYoutubeUrl(u) === ""));

console.log("\n-- Weiterschauen --");
const V = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
pruefe("Der Stand landet als t in der Adresse",
  yt.fortsetzenUrl(V, 754, 3600) === "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=754",
  yt.fortsetzenUrl(V, 754, 3600));
pruefe("Krumme Sekunden werden abgerundet",
  yt.fortsetzenUrl(V, 754.87, 3600).endsWith("&t=754"));
pruefe("Die Playlist ueberlebt das Fortsetzen",
  yt.fortsetzenUrl(`${V}&list=PL9`, 300, 3600) === "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL9&t=300",
  yt.fortsetzenUrl(`${V}&list=PL9`, 300, 3600));
pruefe("Ein alter t-Wert in der Adresse wird ersetzt, nicht verdoppelt",
  yt.fortsetzenUrl(`${V}&t=11`, 500, 3600) === "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=500",
  yt.fortsetzenUrl(`${V}&t=11`, 500, 3600));
pruefe("Unter 15 Sekunden wird von vorne begonnen",
  !yt.fortsetzenUrl(V, 9, 3600).includes("t=") && !yt.fortsetzenUrl(V, 0, 3600).includes("t="));
pruefe("Kurz vor dem Ende wird von vorne begonnen",
  !yt.fortsetzenUrl(V, 3550, 3600).includes("t="),
  yt.fortsetzenUrl(V, 3550, 3600));
pruefe("Ohne bekannte Dauer wird der Stand trotzdem uebernommen",
  yt.fortsetzenUrl(V, 754, 0).endsWith("&t=754"));
pruefe("Shorts bekommen keine Startzeit",
  !yt.fortsetzenUrl("https://www.youtube.com/shorts/ABC", 40, 60).includes("t="));
pruefe("youtu.be wird auf die volle Adresse gebracht",
  yt.fortsetzenUrl("https://youtu.be/ABC?si=x", 200, 3600) === "https://www.youtube.com/watch?v=ABC&t=200",
  yt.fortsetzenUrl("https://youtu.be/ABC?si=x", 200, 3600));

pruefe("Der Nachsprung wird nur dann vorgemerkt, wenn er etwas bringt",
  yt.brauchtNachsprung(754, 3600) === true
  && yt.brauchtNachsprung(9, 3600) === false
  && yt.brauchtNachsprung(3550, 3600) === false);

console.log("\n-- Und die anderen Anbieter bleiben unberuehrt --");
pruefe("fortsetzenUrl reicht fremde Adressen unveraendert durch",
  FREMDE.every((u) => yt.fortsetzenUrl(u, 754, 3600) === u),
  FREMDE.filter((u) => yt.fortsetzenUrl(u, 754, 3600) !== u).join(", ") || "alle unveraendert");
pruefe("Auch Unsinn kommt heil zurueck",
  yt.fortsetzenUrl("", 100) === "" && yt.fortsetzenUrl("kein-url", 100) === "kein-url"
  && yt.videoKennung(null) === null && yt.istYoutubeUrl(undefined) === false);

// Die eigentliche Absicherung: normalizeFavoriteUrl aus main.js muss fremde
// Adressen weiter genau so behandeln wie vorher.
// Sie steht seit der Verschiebung in src/fortschritt.js, damit die Android-App
// dieselbe Regel benutzt. Zum Herausschneiden zaehlen beide als eine Quelle.
const main = ["src/main.js", "src/fortschritt.js"]
  .map((datei) => fs.readFileSync(path.join(WURZEL, datei), "utf8").split("\r\n").join("\n"))
  .join("\n");
function abschnitt(quelle, anfang) {
  const zeilen = quelle.split("\n");
  const von = zeilen.findIndex((z) => z.startsWith(anfang));
  if (von < 0) throw new Error("nicht gefunden: " + anfang);
  let bis = von;
  while (bis < zeilen.length && zeilen[bis] !== "}") bis += 1;
  return zeilen.slice(von, bis + 1).join("\n");
}
const sandkasten = { URL, youtube: yt, console };
vm.createContext(sandkasten);
vm.runInContext(abschnitt(main, "function normalizeFavoriteUrl"), sandkasten);
const { normalizeFavoriteUrl } = sandkasten;

pruefe("normalizeFavoriteUrl fasst die YouTube-Varianten zusammen",
  new Set(varianten.map(normalizeFavoriteUrl)).size === 1);
const fremdErwartet = [
  ["https://aniworld.to/anime/stream/naruto/staffel-1/episode-1", "https://aniworld.to/anime/stream/naruto/staffel-1/episode-1"],
  ["https://s.to/serie/stream/dark/staffel-1/episode-2/", "https://s.to/serie/stream/dark/staffel-1/episode-2"],
  ["https://voe.sx/e/abc123#top", "https://voe.sx/e/abc123"],
  ["https://example.com/watch?v=ABC123", "https://example.com/watch?v=ABC123"]
];
pruefe("normalizeFavoriteUrl laesst fremde Adressen wie bisher",
  fremdErwartet.every(([ein, aus]) => normalizeFavoriteUrl(ein) === aus),
  fremdErwartet.filter(([ein, aus]) => normalizeFavoriteUrl(ein) !== aus).map(([ein]) => `${ein} -> ${normalizeFavoriteUrl(ein)}`).join(", ") || "alle");

console.log("\n-- Vollbild --");
// Der allgemeine Notfallpfad zieht das groesste iframe der Seite ins Vollbild.
// Auf YouTube ist das nachgemessen ein unsichtbarer Anmelde-Rahmen von
// accounts.google.com (0 x 0) - der ging ins Vollbild, der Player nicht.
const direkt = yt.vollbildScript();
const ueberKnopf = yt.vollbildScript(true);
pruefe("Das Vollbild-Skript spricht YouTubes Player an",
  direkt.includes("#movie_player") && direkt.includes("requestFullscreen"));
// Ohne Kommentarzeilen: im Skript steht erklaerend, dass documentElement und
// body ausdruecklich nicht angefasst werden - das darf die Pruefung nicht als
// Treffer werten.
const ohneKommentare = (s) => s.split("\n").filter((z) => !z.trim().startsWith("//")).join("\n");
pruefe("Es fasst weder documentElement noch body an",
  !/documentElement|document\.body|querySelector\(["']body["']\)/.test(ohneKommentare(direkt))
  && !/documentElement|document\.body/.test(ohneKommentare(ueberKnopf)));
pruefe("Es greift nie nach einem iframe - genau daran lag der Fehler",
  !/iframe|embed/i.test(direkt) && !/iframe|embed/i.test(ueberKnopf));
pruefe("Der zweite Anlauf benutzt YouTubes eigenen Knopf",
  ueberKnopf.includes(".ytp-fullscreen-button") && ueberKnopf.includes("dispatchEvent"));
pruefe("Ein verdeckter Knopf wird nicht blind geklickt",
  /r\.width < 8 \|\| r\.height < 8/.test(ueberKnopf));
pruefe("Laeuft schon ein Vollbild, wird nichts erneut ausgeloest",
  direkt.includes("yt-vollbild-schon-aktiv") && ueberKnopf.includes("yt-vollbild-schon-aktiv"));
pruefe("Beide Skripte sind gueltiges Javascript", [direkt, ueberKnopf].every((s) => {
  try { new Function(`return ${s};`); return true; } catch { return false; }
}));
pruefe("enterPlayerFullscreen biegt bei YouTube ab und faellt nicht zurueck",
  /if \(youtube\.istYoutubeUrl\(view\.webContents\.getURL\(\)\)\) \{\n\s+await enterYoutubeFullscreen\(provider, request, view\);\n\s+return;/.test(main));
pruefe("Der allgemeine Weg bleibt fuer die anderen Anbieter erhalten",
  /const buttonPass = await startPlaybackInView\(view, \{ mode: "fullscreen" \}\)/.test(main)
  && /mode: "fullscreen-force"/.test(main));

console.log("\n-- Kartenbild --");
// Die allgemeine Bildsuche nimmt das groesste Bild oben auf der Seite. Auf
// YouTube ist das nicht das laufende Video - ein <video> ist gar kein Bild -,
// sondern die erste Empfehlung rechts. Auf der Karte stand deshalb das
// Vorschaubild eines fremden Videos.
const bilder = yt.vorschaubildKandidaten("https://www.youtube.com/watch?v=VlVj3wyEMMw");
pruefe("Das Bild kommt aus der Videokennung, nicht von der Seite",
  bilder.length === 2 && bilder.every((b) => b.includes("VlVj3wyEMMw")),
  bilder.join(" -> "));
pruefe("Zuerst die grosse, dann die immer vorhandene Groesse",
  bilder[0].endsWith("/maxresdefault.jpg") && bilder[1].endsWith("/mqdefault.jpg"));
pruefe("Die Rueckfallgroesse ist 16:9, nicht 4:3",
  bilder[1].includes("mqdefault") && !bilder.some((b) => b.includes("hqdefault")),
  "hqdefault waere 4:3 und haette schwarze Balken");
pruefe("Jede Schreibweise fuehrt zum selben Bild",
  new Set(varianten.map((u) => yt.vorschaubildKandidaten(u)[1])).size === 1);
pruefe("Fremde Adressen bekommen kein YouTube-Bild",
  FREMDE.every((u) => yt.vorschaubildKandidaten(u).length === 0));
pruefe("Ein schon richtiges Bild wird als solches erkannt",
  yt.istVorschaubildUrl("https://i.ytimg.com/vi/ABC/mqdefault.jpg") === true
  && yt.istVorschaubildUrl("https://i9.ytimg.com/vi/ABC/hq720.jpg") === true
  && yt.istVorschaubildUrl("https://aniworld.to/bild.jpg") === false
  && yt.istVorschaubildUrl("") === false);

pruefe("Beim Laden werden alte Karten mit fremdem Bild geradegezogen",
  /if \(youtube\.istYoutubeUrl\(favorite\?\.url \|\| ""\)\) \{/.test(main)
  && /if \(!youtube\.istVorschaubildUrl\(favorite\?\.thumbnail\)\) \{\n\s*const kandidaten = youtube\.vorschaubildKandidaten\(favorite\.url\);/.test(main));
pruefe("Der Bildabruf haelt den Fortschritts-Takt nicht auf",
  /function youtubeBildNachreichen\(view, meta\)/.test(main)
  && !/await [^\n]*erstesErreichbaresBild/.test(main)
  && /pruefeGrossesVorschaubild\(kandidaten\[0\]\);/.test(main));

console.log("\n-- Shorts, Mediathek, 90 Prozent --");
pruefe("Ein Short wird als Short erkannt, ein Video nicht",
  yt.istShortsUrl("https://www.youtube.com/shorts/ABC") === true
  && yt.istShortsUrl("https://www.youtube.com/watch?v=ABC") === false
  && yt.istShortsUrl("https://youtu.be/ABC") === false);
pruefe("Fremde Adressen sind nie Shorts",
  FREMDE.every((u) => yt.istShortsUrl(u) === false));
pruefe("Shorts werden gar nicht erst gemerkt",
  /if \(youtube\.istShortsUrl\(url\)\) return false;/.test(main)
  && /function isTrackableMediaUrl\(url, provider\) \{\n\s*\/\/[\s\S]{0,400}?if \(youtube\.istShortsUrl\(url\)\) return false;/.test(main),
  "steht in isTrackableMediaUrl, also vor jedem Eintrag");

pruefe("YouTube gilt genau ab 90 Prozent als durch - und darunter wieder nicht",
  /if \(hasMediaProgress && youtube\.istYoutubeUrl\(url\) && !entry\.completedManually\) \{\n\s*entry\.completed = progressPercent >= COMPLETED_PROGRESS_PERCENT;/.test(main),
  "in beide Richtungen, sonst bleibt der Merker kleben");
// Der Fehler, der es in die App geschafft hat: "abgeschlossen" wurde nur
// gesetzt, nie zurueckgenommen. Ein Eintrag mit 26 Prozent galt deshalb als
// durch und verschwand aus "Weiterschauen", waehrend er noch lief.
pruefe("Der Merker wird nicht mehr nur gesetzt, sondern neu bestimmt",
  !/if \(!entry\.completed && youtube\.istYoutubeUrl/.test(main));
pruefe("Von Hand Abgehaktes bleibt abgehakt",
  /!entry\.completedManually/.test(main) && /!favorite\.completedManually/.test(main));
pruefe("Beim Laden werden falsch gesetzte Merker geradegezogen",
  /favorite\.completed && !favorite\.completedManually\n\s*&& sanitizeProgress\(favorite\.progress\) < COMPLETED_PROGRESS_PERCENT/.test(main)
  && /favorite\.hideFromContinueWatching = false;/.test(main));
pruefe("Alte Shorts-Eintraege verschwinden beim Laden",
  /\.filter\(\(favorite\) => !youtube\.istShortsUrl\(favorite\.url\)\)/.test(main));
pruefe("Die anderen Anbieter warten weiter auf das Ende der Folge",
  /const wholeItemCompleted = isWholeMediaCompleted\(entry, url, mediaEnded\);/.test(main)
  && /function isWholeMediaCompleted\(entry, url, mediaEnded\) \{\n\s*if \(!mediaEnded\) return false;/.test(main));

// Die Einstellung - und dass sie standardmaessig aus ist.
pruefe("Die Einstellung ist standardmaessig aus",
  /youtubeInMediathek: raw\?\.playback\?\.youtubeInMediathek === true/.test(main)
  && /youtubeInMediathek: false/.test(main),
  "=== true heisst: alles ausser einem ausdruecklichen Ja bleibt aus");

const renderer = lies("src/renderer/renderer.js");
const html = lies("src/renderer/index.html");
pruefe("Die Mediathek blendet YouTube aus, solange die Einstellung aus ist",
  /const youtubeErlaubt = settings\.playback\?\.youtubeInMediathek === true;/.test(renderer)
  && /\.filter\(\(item\) => youtubeErlaubt \|\| !istYoutubeEintrag\(item\)\)/.test(renderer));
pruefe("Dabei wird nur gefiltert, nichts geloescht - der Schalter ist umkehrbar",
  !/favorites\.splice|delete favorite|completed = false/.test(renderer.split("function libraryEntries")[1].slice(0, 600)));
pruefe("Der Schalter steht in den Einstellungen",
  /id="youtubeInMediathek" type="checkbox"/.test(html)
  && /youtubeInMediathek\?\.addEventListener\("change", saveSettings\)/.test(renderer)
  && /youtubeInMediathek: Boolean\(youtubeInMediathek\?\.checked\)/.test(renderer));

// Zwei Hostlisten, die dasselbe meinen muessen: der Renderer kann das Modul
// nicht laden, deshalb steht sie dort ein zweites Mal. Driftet eine ab, faellt
// es hier auf und nicht erst an einer Karte, die im falschen Bereich landet.
const imRenderer = (renderer.match(/const YOUTUBE_KARTEN_HOSTS = \[([^\]]+)\]/) || [])[1] || "";
pruefe("Renderer und Modul kennen dieselben YouTube-Hosts",
  JSON.stringify(imRenderer.split(",").map((s) => s.trim().replace(/"/g, ""))) === JSON.stringify(yt.YOUTUBE_HOSTS),
  imRenderer.replace(/\s+/g, " ").trim());

console.log("\n-- Eigene Reihe auf der Startseite --");
pruefe("YouTube hat eine eigene Reihe im Markup",
  /id="youtubeHomeRow"/.test(html) && /id="homeYoutubeContinue"/.test(html)
  && /<div class="row-title">Weiterschauen auf YouTube<\/div>/.test(html));
pruefe("Die Reihe „Beliebte Anbieter\" ist von der Startseite verschwunden",
  !/id="providersHomeRow"/.test(html) && !/id="homeProviders"/.test(html)
  && !/<div class="row-title">Beliebte Anbieter<\/div>/.test(html));
pruefe("YouTube faellt aus der normalen Weiterschauen-Reihe heraus",
  /\.filter\(\(favorite\) => !favorite\.watchpartyRoom && !istYoutubeEintrag\(favorite\)\)/.test(renderer));
pruefe("Die YouTube-Reihe wird aus denselben Eintraegen gefuellt",
  /const youtubeItems = continueItems\.filter\(\(favorite\) => istYoutubeEintrag\(favorite\)\)/.test(renderer)
  && /reiheFuellen\(youtubeHomeRow, homeYoutubeContinue, youtubeItems,\s*\n\s*youtubeItems\.length > 0 && homeSettings\.showYoutube !== false\)/
    .test(renderer));
pruefe("Abgeschaltet baut sie gar nichts erst",
  /kasten\.replaceChildren\(\.\.\.\(sichtbar\s*\n?\s*\? eintraege\.map/.test(renderer),
  "eine ausgeblendete Reihe hielt sonst ihre Kacheln samt Bildern im Dokument");
pruefe("Die Reihe hat ihren eigenen Schalter, Voreinstellung an",
  /id="showHomeYoutube" type="checkbox"/.test(html)
  && /showYoutube: raw\?\.home\?\.showYoutube \?\? defaults\.home\.showYoutube/.test(main)
  && /showYoutube: true/.test(main));
pruefe("„Alle anzeigen\" der neuen Reihe fuehrt nach Weiterschauen",
  /#showAllYoutubeContinue"\)\?\.addEventListener\("click", showContinue\)/.test(renderer));
// Wird ein Element geloescht, auf das renderHome() prueft, bleibt die ganze
// Startseite leer. Genau das waere hier fast passiert.
pruefe("renderHome prueft nicht mehr auf das geloeschte Anbieter-Element",
  /if \(!homeView \|\| !homeHero \|\| !homeFavorites\) return;/.test(renderer)
  && !/!homeProviders/.test(renderer));
pruefe("Kein Verweis auf Entferntes ist stehengeblieben",
  !/homeProviders|providersHomeRow|showHomeProviders|providerShowcaseCard/.test(renderer)
  && !/homeProviders|providersHomeRow|showHomeProviders/.test(html),
  "sonst wirft der Renderer beim Laden");
pruefe("Die Anbieter bleiben ueber die Seitenleiste erreichbar",
  /renderSidebarProviders\(enabled\)/.test(renderer) && /function sidebarProviderButton\(provider\)/.test(renderer));

console.log("\n-- YouTube als Standard-Anbieter --");
const providerModelPfad = path.join(WURZEL, "shared", "provider-model.js");
const pm = require(providerModelPfad);
const standard = pm.defaultProviders();
const ytAnbieter = standard.find((p) => /youtube/i.test(p.name));
pruefe("YouTube ist bei einer Neuinstallation dabei", Boolean(ytAnbieter),
  standard.map((p) => p.name).join(", "));
pruefe("Startadresse und Suche stimmen",
  ytAnbieter?.startUrl === "https://www.youtube.com/"
  && pm.buildSearchUrl(ytAnbieter, "splatoon raiders") === "https://www.youtube.com/results?search_query=splatoon%20raiders",
  pm.buildSearchUrl(ytAnbieter, "splatoon raiders"));
pruefe("Er steht hinten und ist eingeschaltet",
  ytAnbieter?.sortOrder === 3 && ytAnbieter?.enabled === true && ytAnbieter?.adblockEnabled === true);
pruefe("Er uebersteht die Normalisierung unveraendert",
  (() => {
    const nach = pm.normalizeProviders([ytAnbieter])[0];
    return nach.startUrl === ytAnbieter.startUrl && nach.searchUrl === ytAnbieter.searchUrl
      && nach.name === ytAnbieter.name && nach.logo === ytAnbieter.logo;
  })());
pruefe("Jeder Anbieter hat eine eigene Kennung",
  new Set(standard.map((p) => p.id)).size === standard.length);
// Die drei bisherigen duerfen sich dabei nicht veraendert haben - sie sind das,
// womit ELFIX seit jeher ausgeliefert wird.
pruefe("Aniworld, S.to und Filmo sind unveraendert geblieben",
  standard.slice(0, 3).map((p) => `${p.name}|${p.startUrl}|${p.sortOrder}`).join(" ")
  === "Aniworld|https://aniworld.to/|0 S.to|http://186.2.175.5/|1 Filmo|https://filmo.to/|2",
  standard.slice(0, 3).map((p) => p.name).join(", "));
// Die neue Adresse muss von allem verstanden werden, was diese Datei kann -
// sonst stuende YouTube zwar in der Liste, waere aber fuer den Rest fremd.
pruefe("Das YouTube-Modul erkennt die eigene Standardadresse",
  yt.istYoutubeUrl(ytAnbieter.startUrl) === true
  && yt.istYoutubeUrl(pm.buildSearchUrl(ytAnbieter, "test")) === true);

console.log("\n-- Watchparty: alle werden mitgezogen --");
// Warum das nicht von selbst ging: taste.urlSchluessel() wirft die Abfrage weg,
// und die YouTube-Videokennung steckt genau dort. Fuer die Watchparty sah
// deshalb jedes Video aus wie dasselbe.
pruefe("Der Serienschluessel ist bei allen YouTube-Videos derselbe",
  taste.urlSchluessel("https://www.youtube.com/watch?v=AAA")
  === taste.urlSchluessel("https://www.youtube.com/watch?v=BBB"),
  taste.urlSchluessel("https://www.youtube.com/watch?v=AAA"));

const wpSync = require("../src/watchparty-sync");
const sandkastenWP = { URL, taste, youtube: yt, console };
vm.createContext(sandkastenWP);
vm.runInContext(["function istGleicheFolge", "function episodeIdentity", "function stripWww"]
  .map((n) => abschnitt(main, n)).join("\n\n"), sandkastenWP);
const gleich = sandkastenWP.istGleicheFolge;
const VIDEO_A = "https://www.youtube.com/watch?v=AAA";
const VIDEO_B = "https://www.youtube.com/watch?v=BBB";

pruefe("Zwei verschiedene Videos gelten nicht mehr als dasselbe",
  gleich(VIDEO_A, VIDEO_B) === false,
  "sonst verwarf der Empfaenger den Wechsel als \"steht ja schon dort\"");
pruefe("Dasselbe Video bleibt dasselbe - auch mit Startzeit oder Playlist",
  gleich(VIDEO_A, VIDEO_A) === true
  && gleich(VIDEO_A, `${VIDEO_A}&t=90`) === true
  && gleich(VIDEO_A, `${VIDEO_A}&list=PL9&index=2`) === true);
// Serien duerfen von der Sonderbehandlung nichts abbekommen.
const EP1 = "https://aniworld.to/anime/stream/naruto/staffel-1/episode-1";
pruefe("Folgen und Staffeln werden weiter wie bisher unterschieden",
  gleich(EP1, EP1) === true
  && gleich(EP1, "https://aniworld.to/anime/stream/naruto/staffel-1/episode-2") === false
  && gleich(EP1, "https://aniworld.to/anime/stream/naruto/staffel-2/episode-1") === false
  && gleich(EP1, "https://aniworld.to/anime/stream/bleach/staffel-1/episode-1") === false);
pruefe("Ein Film ohne Folgenangabe bleibt derselbe Film",
  gleich("https://filmo.to/film/x", "https://filmo.to/film/x") === true);

// Die Kette vom Klick bis zum Nachziehen - jedes Glied muss stehen.
pruefe("Der Videowechsel wird gemeldet",
  /function meldeWatchpartyFolgenwechsel\(url\)/.test(main)
  && /watchparty\.steuernMitAdresse\(key, "navigate", 0, url, raum\);/.test(main)
  && /meldeWatchpartyFolgenwechsel\(url\);/.test(main));
// Die Entscheidung "das ist ein Folgenwechsel" liegt seit dem Umbau in
// watchparty-sync.js - dieselbe Funktion, die Android ueber die Bruecke fragt.
// Geprueft wird deshalb beides: dass sie richtig entscheidet, und dass main.js
// die Entscheidung auch ausfuehrt.
pruefe("Ein navigate mit Adresse gilt als Folgenwechsel",
  wpSync.steuerungEntscheiden(
    { action: "navigate", url: "https://www.youtube.com/watch?v=BBB", sequenceId: 2, timestamp: 2000 },
    { letzter: null, binHost: false }
  ).tun === "navigate");
pruefe("Die Gegenseite zieht auf die neue Adresse nach",
  /if \(urteil\.tun === "navigate"\) \{\n\s*await followWatchpartyEpisode\(eintrag, nachricht\);/.test(main)
  && /if \(istGleicheFolge\(offen, ziel\)\) continue;/.test(main)
  && /await navigateProvider\(provider, ziel\);/.test(main));
pruefe("Nur wer live geschaltet ist, wird mitgezogen",
  /if \(!ziel \|\| !watchpartyLiveAktiv\(eintrag\.key, eintrag\.room\)\) return;/.test(main));

// Und der Fehler, den derselbe Fix nebenbei behebt.
pruefe("Eine Pause an Video A trifft nicht mehr den, der Video B schaut",
  gleich(VIDEO_A, VIDEO_B) === false
  && /if \(!istGleicheFolge\(nachricht\.url \|\| eintrag\.live\?\.url \|\| eintrag\.url, offen\)\) continue;/.test(main));

// Und dass oeffnenAdresse() ueberhaupt nur bei YouTube eingreift.
pruefe("oeffnenAdresse steigt bei fremden Adressen sofort aus",
  /if \(!youtube\.istYoutubeUrl\(adresse\)\) return adresse;/.test(main));
// Die Klammer bleibt offen: seit dem Vollbild fuer "Weiterschauen" reicht der
// Aufruf noch Optionen nach. Geprueft ist die Stelle, nicht ihre Stelligkeit.
pruefe("oeffnenAdresse haengt am Weiterschauen-Aufruf",
  /await navigateProvider\(provider, oeffnenAdresse\(provider, favorite\)[,)]/.test(main));

const gut = pruefungen.filter(Boolean).length;
console.log(`\n${gut}/${pruefungen.length} bestanden`);
process.exit(gut === pruefungen.length ? 0 : 1);
