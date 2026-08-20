"use strict";
// Der YouTube-Reiter in der Mediathek.
//
// Die Einstellung "YouTube-Videos in die Mediathek" liess die Videos bisher
// zwischen die Serien und Filme laufen. Wer nachsehen wollte, was er durchhat,
// fand sie zwischen zwanzig nebenbei geschauten Videos nicht mehr. Steht die
// Einstellung an, gibt es deshalb zwei Reiter.
//
// Zwei Zusagen, die zusammen die ganze Sache sind:
//
// Es geht nichts verloren und nichts steht doppelt - was vorher in der einen
// Liste stand, steht jetzt in genau einem der beiden Reitern.
//
// Und ohne die Einstellung sieht die Mediathek aus wie zuvor: kein Reiter,
// keine YouTube-Eintraege, keine Trennung.
//
// Geprueft werden die echten Funktionen aus renderer.js. Sortierung und
// Entdoppelung sind dabei absichtlich durch Platzhalter ersetzt: geaendert
// wurde die Aufteilung, nicht die Reihenfolge, und ein Platzhalter macht
// sichtbar, was die Aufteilung selbst tut.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const lies = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8").replace(/\r/g, "");
const RENDERER = lies("src/renderer/renderer.js");
const HTML = lies("src/renderer/index.html");
const CSS = lies("src/renderer/styles.css");
const MAIN = lies("src/main.js");

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

// --- Ersatz-DOM --------------------------------------------------------------

function element() {
  const klassen = new Set();
  const knoten = {
    textContent: "", type: "", kinder: [],
    classList: {
      contains: (c) => klassen.has(c),
      add: (...c) => c.forEach((x) => klassen.add(x)),
      remove: (...c) => c.forEach((x) => klassen.delete(x)),
      toggle(c, an) {
        const soll = an === undefined ? !klassen.has(c) : Boolean(an);
        if (soll) klassen.add(c); else klassen.delete(c);
        return soll;
      }
    },
    addEventListener(name, fn) { this[`on_${name}`] = fn; },
    replaceChildren(...kinder) { this.kinder = kinder; }
  };
  // Im echten DOM sind className und classList dieselbe Sache. Ohne diese
  // Kopplung liefe eine Pruefung auf classList ins Leere, sobald der gepruefte
  // Code className am Stueck setzt - und meldete "nicht hervorgehoben", wo in
  // Wahrheit alles stimmt.
  Object.defineProperty(knoten, "className", {
    get: () => [...klassen].join(" "),
    set(wert) {
      klassen.clear();
      String(wert || "").split(/\s+/).filter(Boolean).forEach((teil) => klassen.add(teil));
    },
    enumerable: true
  });
  return knoten;
}

// Vier Serien, drei YouTube-Videos, ein noch offener Titel.
const EINTRAEGE = [
  { id: "s1", title: "Breaking Bad", completed: true, url: "https://aniworld.to/serie/breaking-bad" },
  { id: "s2", title: "Dark", completed: true, url: "https://s.to/serie/dark" },
  { id: "s3", title: "Arcane", completed: true, url: "https://s.to/serie/arcane" },
  { id: "s4", title: "Sinners", completed: true, url: "https://filmo.to/film/sinners" },
  { id: "y1", title: "Kurzgesagt", completed: true, url: "https://www.youtube.com/watch?v=aaa" },
  { id: "y2", title: "Veritasium", completed: true, url: "https://youtu.be/bbb" },
  { id: "y3", title: "Musikvideo", completed: true, url: "https://music.youtube.com/watch?v=ccc" },
  { id: "o1", title: "Noch offen", completed: false, url: "https://s.to/serie/offen" }
];

function buehne(youtubeInMediathek) {
  const knoten = {
    "#libraryTabs": element(),
    "#libraryEmptyTitle": element(),
    "#libraryEmptyCopy": element()
  };
  const gerufen = { aufbauten: 0 };

  const kontext = {
    favorites: EINTRAEGE.map((eintrag) => ({ ...eintrag })),
    settings: { playback: { youtubeInMediathek } },
    document: {
      querySelector: (auswahl) => knoten[auswahl] || null,
      createElement: () => element()
    },
    // Nicht Gegenstand dieser Pruefung - siehe Kopf der Datei.
    mediathekSortieren: (liste) => liste,
    mediathekEntdoppeln: (liste) => liste,
    mediathekSortierung: () => "manuell",
    renderLibraryViews: () => { gerufen.aufbauten += 1; },
    console, Math, Date, String, Number, Boolean, Array, Object, JSON, Set, Map, Promise, URL
  };
  const sandkasten = new Proxy(kontext, {
    has: () => true,
    get: (ziel, name) => (name in ziel ? ziel[name] : (typeof name === "symbol" ? undefined : () => "")),
    set: (ziel, name, wert) => { ziel[name] = wert; return true; }
  });
  vm.createContext(sandkasten);
  vm.runInContext(RENDERER.match(/^const YOUTUBE_KARTEN_HOSTS = .+$/m)[0], sandkasten);
  vm.runInContext(RENDERER.match(/^const MEDIATHEK_TABS = \[[\s\S]*?\n\];$/m)[0], sandkasten);
  vm.runInContext("let mediathekTab = \"titel\";", sandkasten);
  for (const name of ["function istYoutubeEintrag(", "function libraryEntries(",
    "function mediathekYoutubeGetrennt(", "function mediathekAktiverTab(",
    "function mediathekTabEintraege(", "async function mediathekTabSetzen(",
    "function renderMediathekTabs(", "function setzeMediathekLeermeldung("]) {
    vm.runInContext(abschnitt(RENDERER, name), sandkasten);
  }

  const ruf = (ausdruck) => vm.runInContext(ausdruck, sandkasten);
  return {
    knoten, gerufen, ruf,
    tab: () => ruf("mediathekAktiverTab()"),
    ids: (tab) => ruf(`mediathekTabEintraege(${tab === undefined ? "" : JSON.stringify(tab)})`)
      .map((eintrag) => eintrag.id),
    tabsBauen(zahlen) {
      ruf(`renderMediathekTabs(${JSON.stringify(zahlen || {})})`);
      return knoten["#libraryTabs"];
    },
    async waehlen(tab) { await ruf(`mediathekTabSetzen(${JSON.stringify(tab)})`); }
  };
}

// --- Ohne die Einstellung ----------------------------------------------------

const aus = buehne(false);
pruefe("Ohne die Einstellung gibt es nur einen Reiter", aus.tab() === "titel");
pruefe("und keine YouTube-Eintraege",
  aus.ids().join(",") === "s1,s2,s3,s4",
  aus.ids().join(","));
const leisteAus = aus.tabsBauen();
pruefe("Die Reiterleiste bleibt weg",
  leisteAus.classList.contains("is-hidden") && leisteAus.kinder.length === 0,
  "ein einzelner Reiter waere keiner");

// --- Mit der Einstellung -----------------------------------------------------

const an = buehne(true);
pruefe("Mit der Einstellung stehen Serien und Filme im ersten Reiter",
  an.ids("titel").join(",") === "s1,s2,s3,s4",
  an.ids("titel").join(","));
pruefe("und die Videos im YouTube-Reiter",
  an.ids("youtube").join(",") === "y1,y2,y3",
  an.ids("youtube").join(","));

const alle = an.ruf("libraryEntries()").map((eintrag) => eintrag.id);
const zusammen = [...an.ids("titel"), ...an.ids("youtube")].sort();
pruefe("Zusammen ist es genau das, was vorher in der einen Liste stand",
  zusammen.join(",") === [...alle].sort().join(","),
  `${zusammen.join(",")} gegen ${[...alle].sort().join(",")}`);
pruefe("Kein Eintrag steht in beiden Reitern",
  an.ids("titel").every((id) => !an.ids("youtube").includes(id)));
pruefe("Ein noch offener Titel steht in keinem",
  !zusammen.includes("o1"),
  "die Mediathek zeigt Abgeschlossenes, daran aendert der Reiter nichts");
pruefe("music.youtube.com zaehlt als YouTube",
  an.ids("youtube").includes("y3"));

// --- Die Leiste --------------------------------------------------------------

const leiste = an.tabsBauen({ titel: 4, youtube: 3 });
pruefe("Die Reiterleiste steht da", !leiste.classList.contains("is-hidden"));
pruefe("mit beiden Reitern und ihren Zahlen",
  leiste.kinder.map((k) => k.textContent).join(" | ") === "Serien & Filme (4) | YouTube (3)",
  leiste.kinder.map((k) => k.textContent).join(" | "));
pruefe("Der geltende Reiter ist hervorgehoben",
  leiste.kinder[0].classList.contains("is-active")
  && !leiste.kinder[1].classList.contains("is-active"));

const leer = buehne(true);
leer.ruf("favorites = favorites.filter((eintrag) => eintrag.id[0] !== \"y\");");
const leisteLeer = leer.tabsBauen({ titel: 4, youtube: 0 });
pruefe("Auch ein leerer Reiter wird angeboten",
  leisteLeer.kinder.length === 2 && leisteLeer.kinder[1].textContent === "YouTube",
  "sonst kaeme man von einem leergeraeumten Reiter nicht mehr weg");

// --- Umschalten --------------------------------------------------------------

(async () => {
  const u = buehne(true);
  await u.waehlen("youtube");
  pruefe("Ein Klick wechselt den Reiter", u.tab() === "youtube");
  pruefe("und baut die Ansicht neu auf", u.gerufen.aufbauten === 1);
  pruefe("Der YouTube-Reiter zeigt dann die Videos",
    u.ids().join(",") === "y1,y2,y3",
    u.ids().join(","));

  await u.waehlen("youtube");
  pruefe("Derselbe Reiter noch einmal baut nicht neu auf", u.gerufen.aufbauten === 1);

  // Der Fall, der ohne Rueckfall eine leere Mediathek ohne Ausweg ergaebe.
  u.ruf("settings.playback.youtubeInMediathek = false;");
  pruefe("Wird die Einstellung abgeschaltet, faellt der Reiter zurueck",
    u.tab() === "titel",
    "sonst stuende man auf einem Reiter, den es nicht mehr gibt");
  pruefe("und die Mediathek zeigt wieder Serien und Filme",
    u.ids().join(",") === "s1,s2,s3,s4");

  // --- Die Leermeldung ---
  const m = buehne(true);
  m.ruf("setzeMediathekLeermeldung(\"youtube\")");
  pruefe("Ein leerer YouTube-Reiter sagt, dass YouTube leer ist",
    m.knoten["#libraryEmptyTitle"].textContent === "Noch keine YouTube-Videos",
    "\"Noch keine Mediathek\" waere daneben falsch");
  m.ruf("setzeMediathekLeermeldung(\"titel\")");
  pruefe("Der andere sagt weiter das Gewohnte",
    m.knoten["#libraryEmptyTitle"].textContent === "Noch keine Mediathek");

  // --- Der Weg in die Ansicht ---

  pruefe("Die Mediathek baut aus dem geltenden Reiter",
    /const libraryItems = mediathekTabEintraege\(tab, sortierung\);/.test(RENDERER));
  pruefe("Die Zahlen an den Reitern kommen aus beiden Seiten",
    /titel: mediathekTabEintraege\("titel", sortierung\)\.length/.test(RENDERER)
    && /youtube: mediathekTabEintraege\("youtube", sortierung\)\.length/.test(RENDERER));
  pruefe("Ein Umschalten der Einstellung wirkt sofort",
    /renderProviders\(\);[\s\S]{0,300}renderLibraryViews\(\);/.test(RENDERER.slice(RENDERER.indexOf("async function saveSettings("))),
    "sonst stuende die Reiterleiste erst nach dem naechsten Oeffnen richtig da");
  pruefe("Die Leiste steht ueber der Sortierung",
    /id="libraryTabs"[\s\S]{0,200}id="librarySort"/.test(HTML),
    "erst was gezeigt wird, dann in welcher Reihenfolge");
  pruefe("und ist von ihr abgesetzt",
    /\.library-tabs \{[^}]*border-bottom:/.test(CSS),
    "sonst lesen sich beide Reihen als eine einzige Leiste");

  // Ziehen im einen Reiter darf den anderen nicht umsortieren.
  const reorder = MAIN.slice(MAIN.indexOf('ipcMain.handle("library:reorder"'), MAIN.indexOf('ipcMain.handle("library:reorder"') + 500);
  pruefe("Die Reihenfolge wird nur fuer die uebergebenen Eintraege gesetzt",
    /liste\.forEach\(\(id, stelle\) => \{[\s\S]{0,160}if \(favorite\) favorite\.libraryOrder = stelle;/.test(reorder),
    "deshalb laesst Ziehen im YouTube-Reiter die Serien unberuehrt");

  const fehler = pruefungen.filter((ok) => !ok).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  process.exit(fehler ? 1 : 0);
})();
