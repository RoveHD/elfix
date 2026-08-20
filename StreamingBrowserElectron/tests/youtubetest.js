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
const yt = require(path.join(WURZEL, "src", "youtube.js"));

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
const main = fs.readFileSync(path.join(WURZEL, "src", "main.js"), "utf8").split("\r\n").join("\n");
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

// Und dass oeffnenAdresse() ueberhaupt nur bei YouTube eingreift.
pruefe("oeffnenAdresse steigt bei fremden Adressen sofort aus",
  /if \(!youtube\.istYoutubeUrl\(adresse\)\) return adresse;/.test(main));
pruefe("oeffnenAdresse haengt am Weiterschauen-Aufruf",
  /await navigateProvider\(provider, oeffnenAdresse\(provider, favorite\)\);/.test(main));

const gut = pruefungen.filter(Boolean).length;
console.log(`\n${gut}/${pruefungen.length} bestanden`);
process.exit(gut === pruefungen.length ? 0 : 1);
