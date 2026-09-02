"use strict";
// Die Leiste oben auf einer YouTube-Seite.
//
// Zwei Zusagen, die zusammengehoeren:
//
// Auf YouTube gibt es den Teilen-Knopf der Serien-Watchparty nicht. Er stellt
// einen Titel in einen Raum - eine YouTube-Runde ist aber kein Titel, sondern
// die ganze Sitzung. Standen beide nebeneinander, waren es zwei Schalter fuer
// dasselbe, von denen einer das Falsche tat.
//
// Und umgekehrt: die Anzeige der YouTube-Runde gehoert auf die YouTube-Seite
// und sonst nirgendwohin. Sie hing bisher am Zustand der Runde statt an der
// offenen Seite und stand deshalb auch ueber jedem anderen Anbieter.
//
// Geprueft werden die echten Funktionen aus renderer.js, aus der Datei
// geschnitten und in einem Ersatz-DOM ausgefuehrt.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const lies = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8").replace(/\r/g, "");
const RENDERER = lies("src/renderer/renderer.js");
const HTML = lies("src/renderer/index.html");
const MAIN = lies("src/main.js");
const PRELOAD = lies("src/preload.js");

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

// --- Ein Ersatz-DOM ---------------------------------------------------------
// Anders als anderswo im Testordner muss classList.toggle hier das zweite
// Argument koennen: der gepruefte Code schaltet ausschliesslich damit, und ein
// toggle, das den Zustand bloss umdreht, wuerde das Gegenteil messen.

function element() {
  const klassen = new Set();
  return {
    className: "", textContent: "", title: "",
    classList: {
      add: (...c) => c.forEach((x) => klassen.add(x)),
      remove: (...c) => c.forEach((x) => klassen.delete(x)),
      contains: (c) => klassen.has(c),
      toggle(c, an) {
        const soll = an === undefined ? !klassen.has(c) : Boolean(an);
        if (soll) klassen.add(c); else klassen.delete(c);
        return soll;
      }
    },
    getBoundingClientRect: () => ({ left: 100, bottom: 40 })
  };
}

const KNOEPFE = ["#favoriteButton", "#watchpartyShareButton", "#stopButton", "#fullscreenButton"];

// Die Anbieter, wie die Oberflaeche sie kennt: zwei mit YouTube als
// Startadresse, einer ohne.
const ANBIETER = [
  { id: "yt", name: "YouTube", startUrl: "https://www.youtube.com/" },
  { id: "aniworld", name: "AniWorld", startUrl: "https://aniworld.to/" },
  { id: "musik", name: "YouTube Music", startUrl: "https://music.youtube.com/" }
];

function leiste(route, ytStatus) {
  const knoten = new Map(KNOEPFE.map((auswahl) => [auswahl, element()]));
  const banner = element();
  const bannerText = element();
  const kontext = {
    currentRoute: route,
    providers: ANBIETER,
    youtubePartyState: ytStatus,
    youtubePartyBanner: banner,
    youtubePartyBannerText: bannerText,
    document: { querySelector: (auswahl) => knoten.get(auswahl) || null },
    console, Math, Date, String, Number, Boolean, Array, Object, JSON, Set, Map, Promise, URL
  };
  const sandkasten = new Proxy(kontext, {
    has: () => true,
    get: (ziel, name) => (name in ziel ? ziel[name] : (typeof name === "symbol" ? undefined : () => "")),
    set: (ziel, name, wert) => { ziel[name] = wert; return true; }
  });
  vm.createContext(sandkasten);
  const hosts = RENDERER.match(/^const YOUTUBE_KARTEN_HOSTS = .+$/m);
  if (!hosts) throw new Error("YOUTUBE_KARTEN_HOSTS nicht gefunden");
  vm.runInContext(hosts[0], sandkasten);
  for (const name of ["function istYoutubeEintrag(", "function aufYoutubeSeite(",
    "function renderYoutubePartyBanner(", "function renderChromeButtons("]) {
    vm.runInContext(abschnitt(RENDERER, name), sandkasten);
  }
  vm.runInContext("renderChromeButtons()", sandkasten);
  return {
    versteckt: (auswahl) => knoten.get(auswahl).classList.contains("is-hidden"),
    banner,
    bannerText,
    bannerSichtbar: !banner.classList.contains("is-hidden"),
    youtube: vm.runInContext("aufYoutubeSeite()", sandkasten)
  };
}

// Eine laufende Runde: Raum gesetzt, verbunden, ein Video steht.
const LAEUFT = {
  enabled: true, connected: true, joined: true, room: "familie", me: "a",
  rooms: ["familie", "wg"], watchpartyEnabled: true,
  video: { videoId: "dQw4w9WgXcQ", playing: true, position: 12, by: "Elias" }
};
const PRIVAT = { enabled: false, connected: false, rooms: ["familie", "wg"], watchpartyEnabled: true };
const OHNE_WATCHPARTY = { enabled: false, connected: false, rooms: [], watchpartyEnabled: false };

// --- Der Teilen-Knopf -------------------------------------------------------

const aufYoutube = leiste("provider:yt", LAEUFT);
const aufAniworld = leiste("provider:aniworld", LAEUFT);
const aufStart = leiste("start", LAEUFT);

pruefe("Die YouTube-Seite wird als solche erkannt", aufYoutube.youtube);
pruefe("Ein anderer Anbieter nicht", !aufAniworld.youtube);
pruefe("Die Startseite ist kein Anbieter", !aufStart.youtube);
pruefe("YouTube Music zaehlt auch als YouTube", leiste("provider:musik", LAEUFT).youtube,
  "music.youtube.com ist ein Unterhost von youtube.com");

pruefe("Auf YouTube gibt es den Teilen-Knopf nicht",
  aufYoutube.versteckt("#watchpartyShareButton"));
pruefe("Auf jedem anderen Anbieter steht er weiter da",
  !aufAniworld.versteckt("#watchpartyShareButton"));
pruefe("Die uebrigen Knoepfe bleiben auf YouTube unberuehrt",
  !aufYoutube.versteckt("#favoriteButton")
  && !aufYoutube.versteckt("#stopButton")
  && !aufYoutube.versteckt("#fullscreenButton"),
  "weg ist nur der eine, nicht die halbe Leiste");
pruefe("Ausserhalb einer Anbieterseite ist die ganze Reihe weg",
  KNOEPFE.every((auswahl) => aufStart.versteckt(auswahl)));

// --- Die Anzeige der Runde --------------------------------------------------

pruefe("Auf YouTube ist die Runde zu sehen", aufYoutube.bannerSichtbar);
pruefe("Auf einem anderen Anbieter nicht - obwohl dieselbe Runde laeuft",
  !aufAniworld.bannerSichtbar,
  "die Anzeige haengt an der offenen Seite, nicht am Zustand der Runde");
pruefe("Auf der Startseite auch nicht", !aufStart.bannerSichtbar);

pruefe("Sie sagt, was die Runde gerade tut und wer zuletzt gedrueckt hat",
  aufYoutube.bannerText.textContent === "YouTube-Runde: läuft · Elias",
  aufYoutube.bannerText.textContent);

const pausiert = leiste("provider:yt", { ...LAEUFT, video: { ...LAEUFT.video, playing: false } });
pruefe("Pausiert steht auch dran",
  pausiert.bannerText.textContent === "YouTube-Runde: pausiert · Elias");

const ohneVideo = leiste("provider:yt", { ...LAEUFT, video: null });
pruefe("Ohne Video nennt sie den Raum, statt zu verschwinden",
  ohneVideo.bannerSichtbar && ohneVideo.bannerText.textContent === "YouTube-Runde: familie",
  "sonst waere der einzige Schalter genau dann weg, wenn man ihn braucht");

const weg = leiste("provider:yt", { ...LAEUFT, connected: false });
pruefe("Ohne Verbindung sagt sie das",
  weg.bannerText.textContent === "YouTube-Runde: Verbindung weg …");
pruefe("und ist als offline gekennzeichnet", weg.banner.classList.contains("is-offline"));

const privat = leiste("provider:yt", PRIVAT);
pruefe("Privat ist sie trotzdem da - sie ist ja der Schalter", privat.bannerSichtbar);
pruefe("und sagt, dass es gerade nur fuer dich zaehlt",
  privat.bannerText.textContent === "YouTube: privat"
  && privat.banner.classList.contains("is-private"));

const ohne = leiste("provider:yt", OHNE_WATCHPARTY);
pruefe("Ohne eingerichtete Watchparty bleibt sie weg",
  !ohne.bannerSichtbar,
  "ein Schalter mit einer einzigen Stellung ist keiner");

// --- Der Weg vom Klick zum Raum ---------------------------------------------

pruefe("Der Klick auf die Anzeige schaltet um, statt zum Video zu springen",
  /youtubePartyBanner\?\.addEventListener\("click", youtubePartyKontextWechseln\)/.test(RENDERER)
  && !/youtubePartyBanner\?\.addEventListener\("click", youtubePartyOeffnen\)/.test(RENDERER));
pruefe("Zum Video der Runde fuehrt weiter der Knopf in der Watchparty-Ansicht",
  /#youtubePartyOpen"\)\?\.addEventListener\("click", youtubePartyOeffnen\)/.test(RENDERER));
pruefe("Die Anzeige traegt den Hinweis aufs Umschalten",
  /id="youtubePartyBanner" title="Umschalten: privat oder YouTube-Runde"/.test(HTML));
pruefe("und das Zeichen, dass sich darunter etwas aufklappt",
  /youtubePartyBannerText[^]{0,120}banner-caret/.test(HTML));

// Der Umschalter selbst: ein Fenstermenue im Hauptprozess, weil ein Kaestchen
// aus HTML ueber der Anbieterseite nicht anklickbar waere.
const handler = MAIN.slice(MAIN.indexOf('ipcMain.handle("youtubeparty:switch-context"'));
pruefe("Der Hauptprozess kennt den Umschalter",
  MAIN.includes('ipcMain.handle("youtubeparty:switch-context"'));
pruefe("Er bietet Privat und die Raeume an",
  /frageWatchpartyRaum\(punkt, watchparty\.codes, \{[^}]*withPrivate: true/.test(handler.slice(0, 1200)));
pruefe("Ohne Raeume tut er nichts",
  /if \(!watchparty\.aktiv \|\| !watchparty\.codes\.length\) return \{ switched: false/.test(handler.slice(0, 500)));
pruefe("Abbrechen und dieselbe Wahl aendern nichts",
  /if \(!wahl\) return \{ switched: false/.test(handler.slice(0, 1400))
  && /if \(code === bisher\) return \{ switched: false/.test(handler.slice(0, 1600)),
  "sonst baute jeder Klick die Runde neu auf");
pruefe("Die Wahl wird gespeichert und die Runde nachgezogen",
  /youtubeRoom: code[^]{0,160}saveSettings\(\);[^]{0,60}youtubePartySync\(\);/.test(handler.slice(0, 2000)));
pruefe("Die Bruecke steht im preload",
  /switchYoutubePartyContext: \(punkt\) => ipcRenderer\.invoke\("youtubeparty:switch-context", punkt\)/.test(PRELOAD));
pruefe("Die Oberflaeche uebernimmt die Antwort samt Einstellungen",
  /api\.switchYoutubePartyContext\?\.\(punkt\)/.test(RENDERER)
  && /if \(antwort\?\.settings\) settings = antwort\.settings;/.test(RENDERER),
  "sonst schriebe das naechste Speichern den Raum wieder heraus");

// --- Stoebern: auf die Startseite duerfen -----------------------------------
//
// Gemeldet: waehrend die Runde laeuft, will jemand auf die Startseite - das
// naechste Video suchen. Bisher ging das nicht. Er wurde in das Video der
// Runde zurueckgeholt, und weil das Zurueckholen die Seite neu laedt und den
// Player anlaufen laesst, meldete sein Geraet gleich darauf Stelle und
// Laufzustand: ein Blick auf die Startseite riss die ganze Runde herum.
//
// Beide Richtungen waren gemeint, und beide stehen hier.

pruefe("Von einem Video weg auf eine Seite ohne Video heisst stoebern",
  /if \(youtubeLetzteId && !youtubeStoebern\) \{/.test(MAIN),
  "wer YouTube frisch oeffnet, landet auch auf der Startseite - der gehoert geholt");
pruefe("Wieder ein Video heisst: nicht mehr stoebern",
  /if \(videoId\) \{\s*\n\s*youtubeStoebern = false;\s*\n\s*youtubeLetzteId = videoId;/.test(MAIN),
  "und genau so waehlt man ein neues Video fuer alle aus");
pruefe("Wer stoebert, wird nicht zurueckgeholt",
  /if \(youtubeStoebertGerade\(\)\) return;/.test(MAIN)
  && /if \(grund !== "handbetrieb" && youtubeStoebertGerade\(\)\) return;/.test(MAIN),
  "weder beim Raumzustand noch beim Nachziehen nach dem Seitenaufbau");
pruefe("Und zieht dabei auch niemanden mit",
  /function meldeYoutubeAktion\(view, aktion, position, pausiert\) \{[^]{0,260}?if \(youtubeStoebertGerade\(\)\) return;/
    .test(MAIN),
  "das Pausieren beim Verlassen des Videos haette alle anderen angehalten");
pruefe("Der Weg zurueck beendet es ausdruecklich",
  /ipcMain\.handle\("youtubeparty:open", async \(\) => \{\s*\n\s*youtubeStoebernBeenden\(\);/.test(MAIN)
  && /youtubeParty\.anfordern\(\);\s*\n\s*youtubeStoebernBeenden\(\);/.test(MAIN),
  "\"Zum Video\" und \"Abgleichen\" sind der Ausweg");
pruefe("Ein Raumwechsel raeumt den Merker weg",
  /youtubeParty\.ausschalten\(\);\s*\n\s*youtubeStoebern = false;/.test(MAIN));
pruefe("Und die Oberflaeche erfaehrt davon",
  /browsing: youtubeStoebertGerade\(\),/.test(MAIN));

// Die Statuszeile kommt aus derselben Funktion wie in der App - geschnitten
// und in einem eigenen Sandkasten gefahren, weil sie nur formatClock braucht.
function statusText(state) {
  const sandkasten = {
    formatClock: (sekunden) => `0:${String(Math.round(Number(sekunden) || 0)).padStart(2, "0")}`,
    console, Math, Number, String, Boolean, Object, Array, JSON
  };
  vm.createContext(sandkasten);
  vm.runInContext(abschnitt(RENDERER, "function youtubePartyText("), sandkasten);
  return vm.runInContext("youtubePartyText", sandkasten)(state, state.rooms || []);
}

const stoebernd = { ...LAEUFT, browsing: true };
pruefe("Die Statuszeile sagt, dass die Runde ohne einen weiterlaeuft",
  /Du stöberst/.test(statusText(stoebernd)) && /Zum Video/.test(statusText(stoebernd)),
  statusText(stoebernd));
pruefe("Und nennt trotzdem, wo die Runde steht",
  statusText(stoebernd).includes(LAEUFT.video.videoId)
  || /0:12/.test(statusText(stoebernd)),
  "sonst weiss man nicht, wohin man zurueckkaeme");
pruefe("Das Band oben sagt es ebenfalls",
  leiste("provider:yt", stoebernd).bannerText.textContent === "YouTube-Runde: du stöberst");
pruefe("Ohne Stoebern bleibt alles wie vorher",
  /Läuft bei/.test(statusText(LAEUFT))
  && leiste("provider:yt", LAEUFT).bannerText.textContent === "YouTube-Runde: läuft · Elias");

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
