"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const dislikes = require("../src/youtube-dislikes.js");

const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r/g, "");
let geprueft = 0;

function pruefe(name, bedingung) {
  geprueft += 1;
  assert.ok(bedingung, name);
  console.log(`OK  ${name}`);
}

pruefe("Die API-Adresse enthaelt genau die Videokennung",
  dislikes.anfrageUrl("dQw4w9WgXcQ") === "https://returnyoutubedislikeapi.com/votes?videoId=dQw4w9WgXcQ");
pruefe("Ungueltige Kennungen erzeugen keinen Abruf",
  dislikes.anfrageUrl("") === "" && dislikes.anfrageUrl("../abc") === "" && dislikes.anfrageUrl("abc def") === "");
pruefe("Die sichere Standardeinstellung ist eingeschaltet",
  dislikes.einstellungenLesen({}).enabled === true && dislikes.einstellungenLesen({ enabled: false }).enabled === false);

const gueltig = dislikes.datenAus({ id: "dQw4w9WgXcQ", dislikes: 498153 }, "dQw4w9WgXcQ");
pruefe("Eine API-Antwort wird auf ID und endliche Zahl begrenzt",
  gueltig?.videoId === "dQw4w9WgXcQ" && gueltig?.dislikes === 498153);
pruefe("Fehlerhafte Werte werden nie zu einer erfundenen Null",
  dislikes.datenAus({ id: "dQw4w9WgXcQ" }, "dQw4w9WgXcQ") === null
  && dislikes.datenAus({ id: "dQw4w9WgXcQ", dislikes: null }, "dQw4w9WgXcQ") === null
  && dislikes.datenAus({ id: "dQw4w9WgXcQ", dislikes: "" }, "dQw4w9WgXcQ") === null
  && dislikes.datenAus({ id: "dQw4w9WgXcQ", dislikes: -1 }, "dQw4w9WgXcQ") === null
  && dislikes.datenAus({ id: "anderesVideo", dislikes: 12 }, "dQw4w9WgXcQ") === null);

const script = dislikes.anzeigeScript(gueltig);
pruefe("Die Anzeige verwendet den nativen Dislike-Knopf",
  /#segmented-dislike-button button/.test(script));
pruefe("Die Anzeige kennzeichnet die Zahl als Schaetzung samt Quelle",
  /Geschätzte Ablehnungen/.test(script) && /Return YouTube Dislike/.test(script)
  && /returnyoutubedislike\.com/.test(script));
pruefe("SPA-Wechsel und ersetzte Bedienelemente bleiben abgesichert",
  /ausAdresse && ausSpieler && ausAdresse !== ausSpieler/.test(script)
  && /MutationObserver/.test(script) && /yt-navigate-finish/.test(script)
  && /zustand\.daten = \{ videoId: naechste\.videoId/.test(script));
pruefe("Die Zahl bleibt zugänglich und verursacht im Leerlauf keine eigene Mutation",
  /aria-label/.test(script) && !/aria-hidden/.test(script)
  && /if \(wert\.textContent !== text\) wert\.textContent = text;/.test(script));
pruefe("Abschalten entfernt nur die eigene Anzeige",
  /elfix-youtube-dislike-count/.test(dislikes.abstellenScript())
  && /__elfixYoutubeDislikes/.test(dislikes.abstellenScript()));

pruefe("Der Desktop fragt den reinen Lese-Endpunkt mit Zeitlimit und Cache",
  /AbortSignal\.timeout\(YOUTUBE_DISLIKE_FRIST_MS\)/.test(main)
  && /youtubeDislikeCache\.set\(kennung, \{ daten, zeit: Date\.now\(\) \}\)/.test(main)
  && /Date\.now\(\) - gemerkt\.zeit < YOUTUBE_DISLIKE_ALTER_MS/.test(main));
pruefe("Die Einstellung wird beim Speichern normalisiert und hat einen Default",
  /youtubeDislikes: youtubeDislikes\.einstellungenLesen\(raw\?\.youtubeDislikes\)/.test(main)
  && /youtubeDislikes: \{ \.\.\.youtubeDislikes\.STANDARD \}/.test(main));
pruefe("Das Ergebnis landet nur noch beim selben YouTube-Video",
  /youtube\.videoKennung\(view\.webContents\.getURL\(\)\)\?\.id !== kennung\.id/.test(main));
pruefe("Laden und YouTubes SPA-Wechsel installieren die Anzeige",
  (main.match(/installYoutubeDislikes\(view, url\)\.catch/g) || []).length === 1
  && (main.match(/installYoutubeDislikes\(view, view\.webContents\.getURL\(\)\)\.catch/g) || []).length === 1);
pruefe("Das Speichern des Schalters aktualisiert das offene YouTube sofort",
  /installYoutubeDislikes\(activeView, activeView\.webContents\.getURL\(\)\)\.catch/.test(main));
pruefe("Ein langsamer Abruf kann einen inzwischen ausgeschalteten Wert nicht einsetzen",
  /await youtubeDislikeDaten\(kennung\.id\)[\s\S]{0,700}?youtubeDislikes\.einstellungenLesen\(settings\.youtubeDislikes\)\.enabled/.test(main)
  && /const aktuell = sponsorblock\.einstellungenLesen\(settings\.sponsorblock\)/.test(main));
pruefe("Beide Fremddienst-Caches bleiben begrenzt",
  /youtubeDislikeCache\.size >= 256/.test(main) && /sponsorblockCache\.size >= 256/.test(main));

console.log(`OK  ${geprueft} YouTube-Dislike-Pruefungen bestanden.`);
