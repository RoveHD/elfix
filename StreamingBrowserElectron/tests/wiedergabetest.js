"use strict";
// Lautstaerke, YouTube-Qualitaet und Untertitel.
//
// Der Befund, aus dem beides hier entstand: ELFIX loeschte den localStorage der
// Websites mit. Dort merkt sich jeder Player die Lautstaerke, und dort liegen
// bei YouTube Qualitaets- und Untertitelwahl. Weg heisst nicht "zurueckgesetzt",
// sondern "verstellt" - jede Seite fing wieder bei ihrem eigenen Standard an,
// also bei voller Lautstaerke.
//
// Zwei Teile werden geprueft:
//
// Die Reinigung nimmt den localStorage nicht mehr mit, und der Taktgeber, der
// zusaetzlich alle 15 Minuten mitten im Film loeschte, ist weg.
//
// Und das Skript, das auf YouTube beste Qualitaet setzt und Untertitel
// abschaltet - ausgefuehrt, nicht gelesen, mit einem nachgebauten Player. Die
// wichtigste Frage daran ist nicht, ob es setzt, sondern ob es danach aufhoert:
// wer Untertitel fuer eine Szene einschaltet, soll sie behalten duerfen.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const youtube = require("../src/youtube.js");

const lies = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8").replace(/\r/g, "");
const MAIN = lies("src/main.js");
const HTML = lies("src/renderer/index.html");

const pruefungen = [];
const pruefe = (name, bedingung, detail) => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

// --- Was die Reinigung anfasst ----------------------------------------------

const reinigung = MAIN.slice(
  MAIN.indexOf("async function clearBrowserDataPreservingLogin()"),
  MAIN.indexOf("function installAdblock()")
);

pruefe("Der localStorage wird nicht mehr geloescht",
  !/"localstorage"/.test(reinigung),
  "dort liegen Lautstaerke, Qualitaet und Untertitelwahl");
pruefe("Cache, Service Worker und Cache Storage gehen weiter",
  /clearCache\(\)/.test(reinigung)
  && /"serviceworkers"/.test(reinigung)
  && /"cachestorage"/.test(reinigung),
  "die Werbedaten sind der Grund, warum ueberhaupt geraeumt wird");
pruefe("Cookies fasst sie weiterhin nicht an",
  !/"cookies"/.test(reinigung),
  "sonst waerst du nach jedem Start ausgeloggt");

pruefe("Der 15-Minuten-Taktgeber ist weg",
  !/CACHE_CLEANUP_INTERVAL_MS|cacheCleanupTimer|AutomaticCacheCleanup/.test(MAIN),
  "er loeschte auch mitten im Film, und in der Einstellung stand davon nichts");
pruefe("Geloescht wird nur noch bei Start und bei \"Alles neu laden\"",
  (MAIN.match(/clearBrowserDataPreservingLogin\(\)/g) || []).length === 5,
  "Aufruf, Definition, Start, Handbetrieb, Alles-neu-laden");
pruefe("Die Einstellung sagt jetzt, was wirklich bleibt",
  /localStorage der Seiten bleiben/.test(HTML)
  && /Lautstärke, Qualität und Untertitel/.test(HTML));

// --- Ein nachgebauter YouTube-Player ----------------------------------------

function buehne(stufen, videoId = "aaa") {
  const gerufen = { range: [], quality: [], entladen: [], optionen: [] };
  const zustand = { stufen, videoId, spielerDa: true };
  const auftraege = [];
  const horcher = new Map();

  const player = {
    getAvailableQualityLevels: () => zustand.stufen,
    getVideoData: () => ({ video_id: zustand.videoId }),
    setPlaybackQualityRange: (von, bis) => gerufen.range.push([von, bis]),
    setPlaybackQuality: (q) => gerufen.quality.push(q),
    unloadModule: (m) => gerufen.entladen.push(m),
    setOption: (modul, schluessel, wert) => gerufen.optionen.push([modul, schluessel, wert])
  };

  const kontext = {
    window: {
      addEventListener: (name, fn) => {
        if (!horcher.has(name)) horcher.set(name, []);
        horcher.get(name).push(fn);
      }
    },
    document: {
      querySelector: (auswahl) => {
        if (!zustand.spielerDa) return null;
        return (auswahl === "#movie_player" || auswahl === ".html5-video-player") ? player : null;
      }
    },
    location: { href: "https://www.youtube.com/watch?v=" + videoId },
    setInterval: (fn) => { auftraege.push(fn); return auftraege.length; },
    clearInterval: (nummer) => { if (nummer) auftraege[nummer - 1] = null; },
    URL, Set, String, Number, Boolean, Array, Object, JSON
  };
  kontext.window.location = kontext.location;
  vm.createContext(kontext);

  return {
    gerufen, zustand, player, kontext,
    starten: () => vm.runInContext(youtube.wiedergabeScript(), kontext),
    // Ein Schlag der Uhr: jeder Takt, der noch laeuft, kommt dran. Ein
    // abgestellter steht als Luecke drin und wird uebergangen - so laesst sich
    // pruefen, ob wirklich angehalten wurde.
    ticken(male = 1) {
      for (let i = 0; i < male; i += 1) {
        for (const auftrag of auftraege.slice()) if (auftrag) auftrag();
      }
    },
    laeuft: () => auftraege.some(Boolean),
    wechseln(neueId) {
      zustand.videoId = neueId;
      kontext.location.href = "https://www.youtube.com/watch?v=" + neueId;
      for (const fn of horcher.get("yt-navigate-finish") || []) fn();
    },
    hatHorcher: () => (horcher.get("yt-navigate-finish") || []).length
  };
}

// --- Setzen ------------------------------------------------------------------

const a = buehne(["hd1080", "hd720", "medium", "small"]);
pruefe("Das Skript meldet sich als gesetzt", a.starten() === "yt-prefs-gesetzt");
a.ticken();

pruefe("Die beste angebotene Stufe wird genommen",
  a.gerufen.quality[0] === "hd1080" && String(a.gerufen.range[0]) === "hd1080,hd1080",
  JSON.stringify(a.gerufen.range[0]));
pruefe("Untertitel werden abgeschaltet",
  a.gerufen.entladen.includes("captions") && a.gerufen.entladen.includes("cc"),
  "der Baustein heisst je nach Alter des Players anders");
pruefe("und die Spur zusaetzlich geleert",
  a.gerufen.optionen.some(([modul, schluessel]) => modul === "captions" && schluessel === "track"));

const b = buehne(["auto", "hd2160", "hd1440"]);
b.starten();
b.ticken();
pruefe("\"auto\" wird uebersprungen",
  b.gerufen.quality[0] === "hd2160",
  "auto ist genau das Gegenteil dessen, was hier gewollt ist");

// --- Und danach aufhoeren ----------------------------------------------------

const c = buehne(["hd1080", "hd720"]);
c.starten();
c.ticken();
c.ticken();
c.ticken();
pruefe("Gesetzt wird genau einmal je Video, obwohl es mehrere Anlaeufe gibt",
  c.gerufen.quality.length === 1 && c.gerufen.entladen.length === 2,
  `${c.gerufen.quality.length}x Qualitaet, ${c.gerufen.entladen.length}x Modul entladen`);

// Der Fall, auf den es ankommt: jemand schaltet Untertitel selbst wieder ein.
// Danach darf ELFIX sie nicht erneut wegnehmen.
c.gerufen.entladen.length = 0;
c.ticken();
pruefe("Eine eigene Aenderung am selben Video bleibt stehen",
  c.gerufen.entladen.length === 0,
  "sonst waere die Vorgabe keine Vorgabe, sondern eine Sperre");
pruefe("Bei einem Player, der sofort dasteht, laeuft gar kein Takt an",
  !c.laeuft(),
  "der haeufigste Fall soll nichts kosten");

const d = buehne(["hd1080", "hd720"]);
d.starten();
d.ticken();
d.gerufen.quality.length = 0;
d.wechseln("bbb");
d.ticken();
pruefe("Beim naechsten Video wird wieder gesetzt",
  d.gerufen.quality[0] === "hd1080",
  "YouTube wechselt ohne Neuladen - ohne den Horcher passierte hier nichts");
pruefe("Dafuer haengt genau ein Horcher an yt-navigate-finish", d.hatHorcher() === 1);

// --- Wenn der Player noch nicht da ist ---------------------------------------

const e = buehne(["hd1080"]);
e.zustand.spielerDa = false;
e.starten();
e.ticken();
pruefe("Ohne Player wird nichts gesetzt und nichts geworfen",
  e.gerufen.quality.length === 0);
e.zustand.spielerDa = true;
e.ticken();
pruefe("Sobald er da ist, greift ein spaeterer Anlauf",
  e.gerufen.quality[0] === "hd1080",
  "nach dem Laden dauert es, bis YouTube den Player stellt");

pruefe("Nach dem Setzen steht der Takt still", !e.laeuft());

// Ohne Grenze liefe der Takt auf jeder Seite ohne Player ewig weiter.
const grenze = buehne(["hd1080"]);
grenze.zustand.spielerDa = false;
grenze.starten();
grenze.ticken(60);
pruefe("Auf einer Seite ganz ohne Player gibt der Takt irgendwann auf",
  !grenze.laeuft(),
  "sonst liefe er auf der Startseite von YouTube endlos mit");
grenze.zustand.spielerDa = true;
grenze.ticken();
pruefe("und meldet sich dann auch nicht mehr", grenze.gerufen.quality.length === 0);

const f = buehne([]);
f.starten();
f.ticken();
pruefe("Eine noch leere Stufenliste setzt nichts",
  f.gerufen.quality.length === 0 && f.gerufen.entladen.length === 0,
  "beim Videowechsel steht sie kurz leer da");
f.zustand.stufen = ["hd720"];
f.ticken();
pruefe("und wird nachgeholt, sobald die Liste steht", f.gerufen.quality[0] === "hd720");

// --- Zweimal einspielen ------------------------------------------------------

const g = buehne(["hd1080"]);
g.starten();
g.ticken();
g.gerufen.quality.length = 0;
pruefe("Ein zweites Einspielen installiert nicht noch einmal",
  g.starten() === "yt-prefs-schon-da" && g.hatHorcher() === 1);
g.ticken();
pruefe("sondern stoesst nur an - und aendert am fertigen Video nichts",
  g.gerufen.quality.length === 0);

// --- Der Weg in die Seite ----------------------------------------------------

pruefe("Angestossen wird beim Laden der Seite",
  /installYoutubeWiedergabe\(view, view\.webContents\.getURL\(\)\)/.test(MAIN));
pruefe("und beim Videowechsel ohne Neuladen",
  /installYoutubeWiedergabe\(view, url\)/.test(MAIN));
pruefe("Nur auf YouTube",
  /if \(!isLiveView\(view\) \|\| !youtube\.istYoutubeUrl\(url\)\) return;/.test(MAIN));

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
