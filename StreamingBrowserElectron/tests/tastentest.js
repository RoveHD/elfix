"use strict";
// Die Tastenkuerzel.
//
// Geprueft wird die Weiche selbst, ausgefuehrt: `tastenkuerzel` laeuft in einem
// Ersatzkontext, und hineingereicht werden echte Ereignisse, wie sie
// before-input-event liefert. Ein Textvergleich ueber main.js wuerde hier
// wenig sagen - die Frage ist nicht, ob die Taste dasteht, sondern ob sie
// zugreift und vor allem: wann sie es *nicht* tut.
//
// Denn das ist das Heikle daran. Jede Taste, die hier abgefangen wird, fehlt
// der Anbieterseite. Wo ein Kuerzel gerade nichts bedeutet - kein Zurueck,
// keine naechste Folge, kein Vollbild ohne Bild -, muss es die Taste
// durchlassen, statt sie zu schlucken.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..");
const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").replace(/\r/g, "");
const PRELOAD = fs.readFileSync(path.join(WURZEL, "src/preload.js"), "utf8").replace(/\r/g, "");
const RENDERER = fs.readFileSync(path.join(WURZEL, "src/renderer/renderer.js"), "utf8").replace(/\r/g, "");
const HTML = fs.readFileSync(path.join(WURZEL, "src/renderer/index.html"), "utf8").replace(/\r/g, "");
const CSS = fs.readFileSync(path.join(WURZEL, "src/renderer/styles.css"), "utf8").replace(/\r/g, "");

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}

function abschnitt(anfang, ende = "}") {
  const zeilen = MAIN.split("\n");
  const von = zeilen.findIndex((z) => z.startsWith(anfang));
  if (von < 0) throw new Error("nicht gefunden: " + anfang);
  let bis = von;
  while (bis < zeilen.length && zeilen[bis] !== ende) bis += 1;
  return zeilen.slice(von, bis + 1).join("\n");
}

// Die Buehne: alles, was tastenkuerzel anfasst, als Attrappe mit Protokoll.
function buehne(zustand = {}) {
  const getan = [];
  const seite = {
    webContents: {
      getURL: () => zustand.url || "https://aniworld.to/anime/stream/one-piece/staffel-1/episode-3",
      canGoBack: () => zustand.zurueckMoeglich !== false,
      goBack: () => getan.push("zurueck"),
      focus: () => getan.push("fokus"),
      send: (kanal, wert) => getan.push(`senden:${kanal}:${wert}`)
    }
  };
  const umgebung = {
    console: { log() {} },
    getan,
    isContentFullscreen: Boolean(zustand.vollbild),
    activeView: zustand.ohneAnsicht ? null : seite,
    mainWindow: { isDestroyed: () => false, webContents: seite.webContents },
    isLiveView: (view) => Boolean(view) && !zustand.toteAnsicht,
    leaveContentFullscreen: () => { getan.push("vollbild-aus"); umgebung.isContentFullscreen = false; },
    enterContentFullscreen: () => { getan.push("vollbild-an"); umgebung.isContentFullscreen = true; },
    // Seit 1.34.0 geht F11 denselben Weg wie der Knopf auf der Fernbedienung:
    // erst den Player fragen, erst dann das Fenster.
    vollbildUmschalten: async () => { getan.push("vollbild"); },
    activeProvider: () => (zustand.ohneAnbieter ? null : { id: "aniworld", name: "AniWorld" }),
    episodeIdentity: (url) => (/episode-\d+/.test(String(url)) ? { key: "one-piece", season: 1, episode: 3 } : null),
    naechsteFolgePerTaste: async () => { getan.push("naechste-folge"); },
    watchpartyKontextWechseln: async () => { getan.push("kontext"); },
    Boolean, String, Number, Promise
  };
  vm.createContext(umgebung);
  vm.runInContext(abschnitt("function tastenkuerzel("), umgebung);
  const taste = (key, zusatz = {}) => vm.runInContext("tastenkuerzel", umgebung)({
    type: "keyDown", key, control: false, shift: false, alt: false, meta: false,
    isAutoRepeat: false, ...zusatz
  });
  return { taste, getan, umgebung };
}

// --- Die fuenf ---------------------------------------------------------------

{
  const b = buehne();
  pruefe("Strg+K oeffnet die Suche",
    b.taste("k", { control: true }) === true
    && b.getan.includes("senden:tasten:befehl:suche"),
    b.getan.join(","));
  pruefe("und holt den Tastaturfokus mit",
    b.getan.includes("fokus"),
    "er liegt in der Anbieterseite - ein Suchfeld ohne Fokus muesste man erst anklicken");
}

{
  const b = buehne();
  pruefe("Alt+Links geht zurueck",
    b.taste("ArrowLeft", { alt: true }) === true && b.getan.includes("zurueck"));
}

{
  const b = buehne();
  pruefe("F11 schaltet das Vollbild um",
    b.taste("F11") === true && b.getan.includes("vollbild"));
  pruefe("und zwar ueber den Player, nicht ueber das Fenster",
    !b.getan.includes("vollbild-an"),
    "das Fenster gross zu machen laesst das Video in seinem Kasten sitzen");
}

{
  const b = buehne();
  pruefe("Strg+Rechts schaltet auf die naechste Folge",
    b.taste("ArrowRight", { control: true }) === true && b.getan.includes("naechste-folge"));
}

{
  const b = buehne();
  pruefe("Strg+Umschalt+W fragt, wofuer das hier zaehlt",
    b.taste("w", { control: true, shift: true }) === true && b.getan.includes("kontext"));
}

{
  const b = buehne({ vollbild: true });
  pruefe("Escape verlaesst das Vollbild",
    b.taste("Escape") === true && b.getan.includes("vollbild-aus"));
}

// --- Und wann sie nichts tun --------------------------------------------------

{
  const b = buehne({ vollbild: false });
  pruefe("Escape ausserhalb des Vollbilds bleibt der Seite",
    b.taste("Escape") === false,
    "Escape schliesst auf Anbieterseiten deren eigene Fenster");
}

{
  const b = buehne({ ohneAnsicht: true });
  pruefe("F11 ohne Anbieterseite geht durch",
    b.taste("F11") === false,
    "dann macht Electron sein Fenster-Vollbild, und das ist hier das Richtige");
  pruefe("Zurueck ohne Anbieterseite ebenfalls",
    b.taste("ArrowLeft", { alt: true }) === false);
  pruefe("Und die naechste Folge auch",
    b.taste("ArrowRight", { control: true }) === false && !b.getan.includes("naechste-folge"));
}

{
  const b = buehne({ zurueckMoeglich: false });
  pruefe("Zurueck ohne Verlauf geht durch",
    b.taste("ArrowLeft", { alt: true }) === false,
    "die Seite darf ihre eigene Belegung behalten, wo hier nichts zu tun ist");
}

{
  const b = buehne({ url: "https://aniworld.to/anime/stream/one-piece" });
  pruefe("Die naechste Folge nur auf einer Folgenseite",
    b.taste("ArrowRight", { control: true }) === false && !b.getan.includes("naechste-folge"),
    "auf einer Uebersicht gibt es keine naechste Folge");
}

{
  const b = buehne();
  pruefe("Eine gehaltene Taste schaltet nicht mehrfach weiter",
    b.taste("ArrowRight", { control: true, isAutoRepeat: true }) === true
    && !b.getan.includes("naechste-folge"),
    "sonst rauschte ein liegengebliebener Finger durch eine halbe Staffel");
}

// --- Was der Seite gehoert ----------------------------------------------------

{
  const b = buehne();
  for (const taste of ["k", "w", "n", "f", "ArrowLeft", "ArrowRight", " ", "Enter"]) {
    pruefe(`Ein blosses „${taste === " " ? "Leerzeichen" : taste}“ bleibt der Seite`,
      b.taste(taste) === false,
      "sonst waere jedes Suchfeld einer Anbieterseite unbenutzbar");
  }
  pruefe("Strg+Umschalt+K ist nicht Strg+K",
    b.taste("k", { control: true, shift: true }) === false,
    "jede Kombination gilt genau fuer sich");
  pruefe("Alt+Rechts ist nicht Strg+Rechts",
    b.taste("ArrowRight", { alt: true }) === false);
  pruefe("Und beim Loslassen geschieht nichts",
    vm.runInContext("tastenkuerzel", b.umgebung)({ type: "keyUp", key: "k", control: true }) === false,
    "sonst liefe jedes Kuerzel zweimal");
}

// --- Wo sie haengen -----------------------------------------------------------
//
// Dreimal, und das muss so sein: liegen Anbieteransicht oder eigener Player
// vorn, bekommt das Fenster den Tastendruck nie zu sehen. Gerade der Player
// darf Escape im Vollbild nicht als "Player schliessen" behandeln - sonst
// bleibt die dahinter ausgeblendete Oberflaeche schwarz.

const stellen = MAIN.match(/before-input-event", \(event, input\) => \{\s*\n\s*if \(tastenkuerzel\(input\)\) event\.preventDefault\(\);/g) || [];
pruefe("Die Kuerzel haengen am Fenster, an jeder Anbieteransicht und am eigenen Player",
  stellen.length === 3,
  `${stellen.length} Stellen`);
pruefe("und alle rufen dieselbe Weiche",
  !/if \(input\.key === "Escape" && isContentFullscreen\)/.test(MAIN),
  "vorher stand dieselbe Behandlung zweimal da");

pruefe("Der Suchbefehl hat einen Weg in die Oberflaeche",
  /onTastenBefehl: \(callback\) => ipcRenderer\.on\("tasten:befehl"/.test(PRELOAD)
  && /api\.onTastenBefehl\?\.\(\(befehl\) => \{/.test(RENDERER),
  "ohne die Bruecke ginge die Meldung ins Leere");
pruefe("und die Oberflaeche macht daraus die Suche",
  /if \(befehl !== "suche"\) return;\s*\n\s*openSearchView\(\)/.test(RENDERER));

// --- Nachzulesen --------------------------------------------------------------

for (const eintrag of ["Strg</kbd><kbd>K", "Alt</kbd><kbd>←", "F11", "Strg</kbd><kbd>→", "Umschalt</kbd><kbd>W"]) {
  pruefe(`Die Einstellungen nennen ${eintrag.replace(/<\/?kbd>/g, "+")}`,
    HTML.includes(eintrag),
    "ein Kuerzel, das nirgends steht, findet niemand");
}
pruefe("Die Liste hat eine eigene Regel im Stylesheet",
  /\.tasten-liste \{/.test(CSS),
  "ohne sie stuenden Tasten und Bedeutung untereinander statt nebeneinander");

pruefe("Im Hauptprozess steht keine zweite Liste davon",
  !/const TASTENKUERZEL/.test(MAIN),
  "eine Tabelle, die niemand benutzt, liefe irgendwann neben der auseinander, die man zu sehen bekommt");

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
