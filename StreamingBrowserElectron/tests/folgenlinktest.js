"use strict";
// Welchen Link die Seite als "naechste Folge" hergibt.
//
// Gemeldet war: bei Attack on Titan landete "naechste Folge" immer bei
// derselben fremden Serie. Der Grund steckte hier: der Fuehler nahm den
// erstbesten Folgenlink der Seite. Auf einer Anbieterseite stehen davon
// Dutzende - "Neue Episoden", "Das schauen andere", die Vorschlagsspalte -,
// und keiner davon gehoert zu dem, was gerade laeuft.
//
// Die Regel darueber (nextEpisodeContinueUrl in fortschritt.js) vergleicht die
// Serienkennung und faengt so einen falschen Vorschlag ab. Ein falscher Wert
// bleibt trotzdem ein falscher Wert: er reist als meta.nextUrl weiter, und der
// Knopf in der Seite meldet sein Ziel auf einem Weg zurueck, den jedes Skript
// der Seite mitbenutzen kann - deshalb steht unten der Torwaechter daneben.
//
// Gefahren wird das echte Skript aus messung.js - nicht eine Nachbildung
// davon - in einer knappen Seite mit genau den Links, die den Fehler
// ausgeloest haben.

const vm = require("vm");
const messung = require("../src/messung");

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}

const AOT = "https://aniworld.to/anime/stream/attack-on-titan/staffel-1/episode-1";

/** Ein Anker, so weit das Skript ihn anfasst. */
function link(href, { text = "", klasse = "", titel = "", rel = "" } = {}) {
  return {
    getAttribute: (name) => (name === "href" ? href : (name === "aria-label" ? "" : null)),
    textContent: text,
    className: klasse,
    title: titel,
    rel
  };
}

/** Ein Video, das laeuft - sonst faellt der Messwert durch den eigenen Filter. */
function video() {
  return {
    currentTime: 300,
    duration: 1400,
    paused: false,
    ended: false,
    readyState: 4,
    currentSrc: "https://hoster.example/stream.m3u8",
    src: "",
    getAttribute: () => "",
    getBoundingClientRect: () => ({ width: 1280, height: 720 })
  };
}

/**
 * Das Skript in einer Seite laufen lassen.
 *
 * Nur was es wirklich anfasst: die Anker, das Video, die Adresse. Alles
 * Weitere fehlt mit Absicht - was das Skript darueber hinaus braeuchte, faellt
 * hier auf und nicht erst auf dem Telefon.
 */
function messen(adresse, anker) {
  const ziel = new URL(adresse);
  const dokument = {
    querySelectorAll(auswahl) {
      if (auswahl.includes("video")) return [video()];
      if (auswahl.includes("a[href]")) return anker;
      return [];
    }
  };
  const kontext = vm.createContext({
    document: dokument,
    location: { href: ziel.href, hostname: ziel.hostname, pathname: ziel.pathname },
    URL, Number, Math, Date, WeakMap, Array, RegExp, JSON, console
  });
  kontext.window = kontext;
  kontext.globalThis = kontext;
  return vm.runInContext(messung.messSkript(), kontext, { filename: "messung.js" });
}

// Der Fall aus der Meldung: die Vorschlagsspalte steht vor dem echten Link,
// traegt einen Pfeil im Namen und zeigt auf Folge 2 einer fremden Serie.
const fremd = link(
  "https://aniworld.to/anime/stream/young-ladies-dont-play-fighting-games/staffel-1/episode-2",
  { klasse: "carousel-next", text: "›" });
const eigen = link(
  "https://aniworld.to/anime/stream/attack-on-titan/staffel-1/episode-2",
  { klasse: "episodeLink", text: "Nächste Episode ›" });

pruefe("Die eigene naechste Folge gewinnt gegen die Vorschlagsspalte",
  messen(AOT, [fremd, eigen]).nextUrl
    === "https://aniworld.to/anime/stream/attack-on-titan/staffel-1/episode-2",
  messen(AOT, [fremd, eigen]).nextUrl);

pruefe("Steht nur die fremde Serie da, gibt es keine naechste Folge",
  messen(AOT, [fremd]).nextUrl === "",
  JSON.stringify(messen(AOT, [fremd]).nextUrl));

// Ohne Pfeil und ohne Beschriftung zaehlt allein die Nummer - auch dort darf
// die fremde Serie nicht einspringen.
const fremdOhneText = link(
  "https://aniworld.to/anime/stream/young-ladies-dont-play-fighting-games/staffel-1/episode-2");
const eigenOhneText = link(
  "https://aniworld.to/anime/stream/attack-on-titan/staffel-1/episode-2");

pruefe("Auch ohne Beschriftung bleibt die fremde Serie draussen",
  messen(AOT, [fremdOhneText]).nextUrl === "",
  JSON.stringify(messen(AOT, [fremdOhneText]).nextUrl));

pruefe("und die eigene wird genommen",
  messen(AOT, [fremdOhneText, eigenOhneText]).nextUrl
    === "https://aniworld.to/anime/stream/attack-on-titan/staffel-1/episode-2",
  messen(AOT, [fremdOhneText, eigenOhneText]).nextUrl);

// Ein anderer Wirt ist nie dieselbe Serie, auch wenn der Pfad zufaellig passt.
pruefe("Ein fremder Wirt zaehlt nicht",
  messen(AOT, [link("https://woanders.example/anime/stream/attack-on-titan/staffel-1/episode-2")]).nextUrl === "");

// www davor ist derselbe Wirt und keine andere Serie.
pruefe("www davor bleibt dieselbe Serie",
  messen(AOT, [link("https://www.aniworld.to/anime/stream/attack-on-titan/staffel-1/episode-2")]).nextUrl
    === "https://www.aniworld.to/anime/stream/attack-on-titan/staffel-1/episode-2");

// Filme haben keine Folgennummer - dort gibt es nichts weiterzuschalten.
pruefe("Auf einer Seite ohne Folgennummer bleibt es leer",
  messen("https://aniworld.to/anime/stream/attack-on-titan/filme/film-1",
    [link("https://aniworld.to/anime/stream/attack-on-titan/staffel-1/episode-2")]).nextUrl === "");

// --- Der Torwaechter -------------------------------------------------------
//
// Der Knopf im Bild und der Zaehler leben in der Anbieterseite; ihr Klick kommt
// ueber eine Konsolenzeile zurueck, weil es in einer fremden Seite ohne Preload
// keinen anderen Kanal gibt. In eine Konsolenzeile kann aber jedes Skript der
// Seite schreiben - deshalb wird geprueft, bevor jemand folgt.

const fortschritt = require("../src/fortschritt");
const AOT2 = "https://aniworld.to/anime/stream/attack-on-titan/staffel-1/episode-2";
const FREMD = "https://aniworld.to/anime/stream/young-ladies-dont-play-fighting-games/staffel-1/episode-2";

pruefe("Die naechste Folge derselben Serie darf",
  fortschritt.darfNaechsteFolgeSein(AOT2, AOT) === true);
pruefe("Eine fremde Serie darf nicht",
  fortschritt.darfNaechsteFolgeSein(FREMD, AOT) === false);
pruefe("Zurueck darf nicht",
  fortschritt.darfNaechsteFolgeSein(AOT, AOT2) === false);
pruefe("Die naechste Staffel darf",
  fortschritt.darfNaechsteFolgeSein(
    "https://aniworld.to/anime/stream/attack-on-titan/staffel-2/episode-1", AOT2) === true);
pruefe("Etwas, das gar keine Folge ist, darf nicht",
  fortschritt.darfNaechsteFolgeSein("https://irgendwo.example/gewinnspiel", AOT) === false);
// Beim Hoster steht im Hauptfenster nicht mehr die Folgenseite. Dann zaehlt der
// Eintrag, der gerade laeuft - sonst waere der Knopf ausgerechnet im Vollbild
// wirkungslos.
pruefe("Vom Hoster aus zaehlt der laufende Eintrag",
  fortschritt.darfNaechsteFolgeSein(AOT2, "https://voe.sx/e/abc123", { url: AOT }) === true);
pruefe("und auch dort bleibt die fremde Serie draussen",
  fortschritt.darfNaechsteFolgeSein(FREMD, "https://voe.sx/e/abc123", { url: AOT }) === false);
pruefe("Ohne jeden Bezug wird nichts gefahren",
  fortschritt.darfNaechsteFolgeSein(AOT2, "https://voe.sx/e/abc123", null) === false);

const bestanden = pruefungen.filter(Boolean).length;
console.log(`${bestanden}/${pruefungen.length} bestanden`);
process.exit(bestanden === pruefungen.length ? 0 : 1);
