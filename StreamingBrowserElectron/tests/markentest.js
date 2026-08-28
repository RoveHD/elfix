"use strict";
// Intro ueberspringen.
//
// Zwei Haelften: die Regeln - wann ein Sprung als Beleg taugt und wann aus
// Belegen eine Marke wird - und das Skript, das im Player liegt. Das Skript
// wird ausgefuehrt und nicht gelesen: ob ein Knopf wirklich entsteht, ob er im
// richtigen Fenster steht und ob der eigene Sprung nicht als Beleg
// zurueckkommt, sieht man einem Quelltext nicht an.
//
// Der letzte Punkt ist der wichtigste. Lernte die Marke von ihrem eigenen
// Knopf, verschoebe sie sich mit jedem Druck ein Stueck weiter - und niemand
// koennte sagen, warum das Intro nach zehn Folgen mitten in der Handlung
// anfaengt.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const marken = require("../src/marken");

const WURZEL = path.join(__dirname, "..");
const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").replace(/\r/g, "");

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}

// --- Die Regeln ---------------------------------------------------------------

pruefe("Ein Sprung ueber das Intro zaehlt",
  marken.sprungLohnt(62, 152));
pruefe("Rueckwaerts zaehlt nicht",
  !marken.sprungLohnt(152, 62),
  "wer zurueckspult, hat etwas verpasst und nichts uebersprungen");
pruefe("Ein paar Sekunden zaehlen nicht",
  !marken.sprungLohnt(62, 72),
  "das ist ein Verspieler, kein Intro");
pruefe("Eine halbe Folge auch nicht",
  !marken.sprungLohnt(62, 400));
pruefe("Und nichts, was spaet in der Folge liegt",
  !marken.sprungLohnt(900, 990),
  "was dort uebersprungen wird, ist Handlung");

{
  let spruenge = [];
  spruenge = marken.sprungAufnehmen(spruenge, { folge: 1, von: 62, nach: 152 });
  pruefe("Ein Sprung allein ergibt keine Marke",
    marken.markeAus(spruenge) === null,
    "einmal kann Langeweile gewesen sein");

  spruenge = marken.sprungAufnehmen(spruenge, { folge: 1, von: 64, nach: 154 });
  pruefe("Zweimal in derselben Folge auch nicht",
    marken.markeAus(spruenge) === null && spruenge.length === 1,
    "das ist Herumspulen - je Folge zaehlt der letzte Sprung");

  spruenge = marken.sprungAufnehmen(spruenge, { folge: 2, von: 66, nach: 158 });
  const marke = marken.markeAus(spruenge);
  pruefe("Zwei Folgen an derselben Stelle ergeben eine",
    marke && marke.belege === 2,
    JSON.stringify(marke));
  pruefe("Sie liegt zwischen den Belegen",
    marke.von === 65 && marke.dauer === 91,
    `${marke.von}s / ${marke.dauer}s - der Median aus 62/66 und 90/92`);
}

{
  // Ein Ausreisser darf die Marke nicht verziehen: gesucht wird die groesste
  // Gruppe, nicht der Durchschnitt ueber alles.
  const spruenge = [
    { folge: 1, von: 60, dauer: 90 },
    { folge: 2, von: 62, dauer: 91 },
    { folge: 3, von: 300, dauer: 40 },
    { folge: 4, von: 61, dauer: 90 }
  ];
  const marke = marken.markeAus(spruenge);
  pruefe("Ein Ausreisser zieht die Marke nicht mit",
    marke.von === 61 && marke.belege === 3,
    `${marke.von}s aus ${marke.belege} Folgen`);
}

{
  // Ein Intro, das ab einer bestimmten Folge kuerzer wird: die Marke soll
  // nachziehen, sobald die neue Stelle die haeufigere ist.
  let spruenge = [];
  for (const folge of [1, 2]) spruenge = marken.sprungAufnehmen(spruenge, { folge, von: 60, nach: 150 });
  for (const folge of [3, 4, 5]) spruenge = marken.sprungAufnehmen(spruenge, { folge, von: 20, nach: 80 });
  const marke = marken.markeAus(spruenge);
  pruefe("Aendert sich das Intro, zieht die Marke nach",
    marke.von === 20 && marke.belege === 3,
    `${marke.von}s aus ${marke.belege} Folgen`);
}

{
  let spruenge = [];
  for (let folge = 1; folge <= marken.MAX_SPRUENGE + 5; folge += 1) {
    spruenge = marken.sprungAufnehmen(spruenge, { folge, von: 60, nach: 150 });
  }
  pruefe("Die Liste waechst nicht endlos",
    spruenge.length === marken.MAX_SPRUENGE,
    `${spruenge.length} Sprünge`);
}

{
  const marke = { von: 60, dauer: 90 };
  pruefe("Der Knopf steht kurz vor der Marke schon da",
    marken.markePasst(marke, 57));
  pruefe("und noch eine Weile danach",
    marken.markePasst(marke, 80),
    "wer zwei Sekunden zu spaet hinsieht, soll ihn nicht verpasst haben");
  pruefe("Vorher nicht",
    !marken.markePasst(marke, 20));
  pruefe("Und lange danach auch nicht",
    !marken.markePasst(marke, 200));
  pruefe("Gesprungen wird ans Ende des Intros",
    marken.zielZeit(marke, 57) === 150);
  pruefe("Nie zurueck",
    marken.zielZeit(marke, 200) === 201,
    "wer schon weiter ist, soll nicht an den Anfang geholt werden");
}

pruefe("Jede Staffel hat ihre eigene Marke",
  marken.schluessel("onepiece", 1) !== marken.schluessel("onepiece", 2),
  "Intros wechseln zwischen Staffeln");
pruefe("Ohne Titel gibt es keinen Schluessel",
  marken.schluessel("", 1) === "",
  "eine Marke ohne Serie waere eine Marke fuer alles");

// --- Das Skript im Player ------------------------------------------------------

function buehne(marke, optionen = {}) {
  const meldungen = [];
  const horcher = {};
  const koerper = { kinder: [], appendChild(k) { koerper.kinder.push(k); k.parentElement = koerper; }, removeChild(k) { koerper.kinder = koerper.kinder.filter((x) => x !== k); k.parentElement = null; } };
  const video = {
    duration: 1400,
    currentTime: 0,
    addEventListener: (name, fn) => { horcher[name] = horcher[name] || []; horcher[name].push(fn); },
    tag: "video"
  };
  const dokument = {
    fullscreenElement: null,
    body: koerper,
    querySelectorAll: () => [video],
    createElement: () => {
      const knopf = { style: {}, tag: "button", horcher: {}, parentElement: null };
      knopf.addEventListener = (name, fn) => { knopf.horcher[name] = fn; };
      return knopf;
    }
  };
  const fenster = {};
  // Eine Uhr, die nur auf Zuruf laeuft. Das Skript meldet einen Sprung erst,
  // wenn das Spulen zur Ruhe gekommen ist - ohne steuerbare Uhr liesse sich
  // weder pruefen, dass es wartet, noch dass es danach meldet.
  let uhren = [];
  let uhrNummer = 0;
  const kontext = {
    window: fenster, document: dokument, console: { log: (zeile) => meldungen.push(String(zeile)) },
    setTimeout: (fn) => { uhrNummer += 1; uhren.push({ id: uhrNummer, fn }); return uhrNummer; },
    clearTimeout: (id) => { uhren = uhren.filter((uhr) => uhr.id !== id); },
    Array, Number, Math, Date, JSON, String, Boolean, Object
  };
  kontext.globalThis = kontext;
  vm.createContext(kontext);
  const ergebnis = vm.runInContext(marken.markenScript(marke, optionen), kontext);

  const feuern = (name) => {
    for (const fn of horcher[name] || []) fn();
  };
  // Die Ruhe nach dem Spulen: hier laeuft die Uhr ab, auf die das Skript
  // wartet, bevor es einen Lauf als beendet ansieht.
  const ruhen = () => {
    const faellig = uhren;
    uhren = [];
    for (const uhr of faellig) uhr.fn();
  };
  const einmalSpulen = (nach) => { feuern("seeking"); video.currentTime = nach; feuern("seeked"); };
  return {
    ergebnis, meldungen, video, fenster, kontext, koerper, ruhen,
    knopf: () => koerper.kinder[0] || null,
    // Ein Stueck weiterspielen: so, wie der Player es meldet.
    spielen: (bis) => { video.currentTime = bis; feuern("timeupdate"); },
    // Von Hand spulen und die Hand wieder wegnehmen.
    spulen: (nach) => { einmalSpulen(nach); ruhen(); },
    // Mehrere Spruenge ohne Pause dazwischen - Pfeiltasten, oder einmal zu
    // weit und einmal zurueck. Erst am Ende kommt die Ruhe.
    tippen: (...stellen) => { for (const stelle of stellen) einmalSpulen(stelle); ruhen(); },
    // Spulen, ohne die Hand wegzunehmen - zum Pruefen, dass waehrenddessen
    // noch nichts gemeldet wird.
    spulenRoh: einmalSpulen,
    klicken: () => koerper.kinder[0].horcher.click({ preventDefault() {}, stopPropagation() {} }),
    nachreichen: (neu, lernen = true) => fenster.__elfixMarke.aktualisieren(neu, lernen),
    sichtbar: () => koerper.kinder[0]?.style.display === "block",
    sprungMeldungen: () => meldungen.filter((z) => z.startsWith("__elfix:sprung:"))
  };
}

{
  const b = buehne(null);
  pruefe("Ohne Marke steht kein Knopf da",
    b.ergebnis === "ohne-marke" && !b.knopf(),
    b.ergebnis);

  b.spielen(20);
  b.spulen(110);
  pruefe("Ein Sprung wird gemeldet",
    b.sprungMeldungen()[0] === "__elfix:sprung:20:110",
    b.sprungMeldungen().join(","));

  b.spielen(200);
  b.spulen(150);
  pruefe("Zurueckspulen nicht",
    b.sprungMeldungen().length === 1,
    b.sprungMeldungen().join(","));

  b.spielen(300);
  b.spulen(305);
  pruefe("Ein Verspieler auch nicht",
    b.sprungMeldungen().length === 1);

  b.spielen(1000);
  b.spulen(1090);
  pruefe("Und nichts aus dem hinteren Teil der Folge",
    b.sprungMeldungen().length === 1,
    "dort wird Handlung uebersprungen, kein Intro");
}

// --- Ein Lauf aus mehreren Spruengen -------------------------------------------
//
// Gemeldet: "wenn der Host immer mit Pfeiltasten nach vorne skippt bis zum
// Start der Folge" und "wenn man zu weit spult am Anfang und dann zurueck".
// Beides war bisher keine Marke: zehn Spruenge zu je zehn Sekunden sind jeder
// fuer sich kuerzer als MIN_DAUER_S, und beim Zurueckspulen wurde der
// Ueberschuss gelernt statt der Stelle, an der die Folge wirklich anfaengt.
{
  const b = buehne(null);
  b.spielen(4);
  // Zehnmal die Pfeiltaste: 4 -> 14 -> 24 -> ... -> 94.
  b.tippen(14, 24, 34, 44, 54, 64, 74, 84, 94);
  pruefe("Pfeiltasten ergeben einen Sprung, nicht neun",
    b.sprungMeldungen().length === 1,
    b.sprungMeldungen().join(","));
  pruefe("und zwar von dort, wo es losging, bis dorthin, wo es endete",
    b.sprungMeldungen()[0] === "__elfix:sprung:4:94",
    b.sprungMeldungen()[0]);
}

{
  const b = buehne(null);
  b.spielen(0);
  // Zu weit gespult und wieder zurueck.
  b.tippen(120, 95);
  pruefe("Zu weit gespult und zurueck ergibt die Stelle, an der man landet",
    b.sprungMeldungen()[0] === "__elfix:sprung:0:95",
    b.sprungMeldungen().join(","));
  pruefe("Der Ueberschuss wird nicht mitgelernt",
    b.sprungMeldungen().length === 1,
    "sonst stuende die Marke fuenfundzwanzig Sekunden zu weit hinten");
}

{
  const b = buehne(null);
  b.spielen(20);
  b.tippen(110);
  b.spielen(300);
  b.tippen(340);
  pruefe("Ein spaeterer Sprung bleibt eine eigene Bewegung",
    b.sprungMeldungen().join(",") === "__elfix:sprung:20:110,__elfix:sprung:300:340",
    "zwei Meldungen und keine zusammengezogene von 20 bis 340");
}

{
  // Solange die Hand noch spult, wird nichts gemeldet - sonst waere jede
  // Zwischenstation eines Laufs eine eigene Meldung.
  const b = buehne(null);
  b.spielen(4);
  b.spulenRoh(40);
  b.spulenRoh(80);
  pruefe("Waehrend des Spulens wird noch nichts gemeldet",
    b.sprungMeldungen().length === 0,
    b.sprungMeldungen().join(","));
  b.ruhen();
  pruefe("Erst die Ruhe danach meldet den ganzen Lauf",
    b.sprungMeldungen()[0] === "__elfix:sprung:4:80",
    b.sprungMeldungen().join(","));
}

{
  const b = buehne({ von: 60, dauer: 90 });
  pruefe("Mit Marke entsteht ein Knopf",
    b.ergebnis === "marke" && Boolean(b.knopf()));
  pruefe("Am Anfang der Folge ist er unsichtbar",
    !b.sichtbar());

  b.spielen(58);
  pruefe("Im Fenster erscheint er",
    b.sichtbar());
  pruefe("und heisst, was er tut",
    b.knopf().textContent === "Intro überspringen");

  b.spielen(200);
  pruefe("Danach verschwindet er wieder",
    !b.sichtbar());

  b.spielen(58);
  b.klicken();
  pruefe("Ein Klick springt ans Ende des Intros",
    b.video.currentTime === 150,
    String(b.video.currentTime));
  pruefe("und meldet das",
    b.meldungen.includes("__elfix:marke:genutzt"));
  pruefe("Danach ist der Knopf weg",
    !b.sichtbar());

  // Der Kern: der eigene Sprung darf nicht als Beleg zurueckkommen.
  const vorher = b.sprungMeldungen().length;
  b.spulen(150);
  pruefe("Der eigene Sprung wird nicht gelernt",
    b.sprungMeldungen().length === vorher,
    "sonst zoege sich die Marke mit jedem Druck weiter nach hinten");
}

{
  const b = buehne({ von: 60, dauer: 90 });
  const zweites = vm.runInContext(marken.markenScript({ von: 10, dauer: 20 }), b.kontext);
  pruefe("Ein zweites Einspielen richtet nichts neu ein",
    zweites === "marke" && b.koerper.kinder.length === 1,
    `${b.koerper.kinder.length} Knoepfe`);
  b.spielen(12);
  pruefe("sondern reicht nur die neue Marke nach",
    b.sichtbar(),
    "sonst meldete jeder Sprung sich doppelt");

  b.spielen(20);
  b.spulen(110);
  pruefe("Und jeder Sprung wird genau einmal gemeldet",
    b.sprungMeldungen().length === 1,
    b.sprungMeldungen().join(","));
}

{
  const b = buehne(null, { lernen: false });
  b.spielen(20);
  b.spulen(110);
  pruefe("Wo nicht gelernt werden soll, wird nichts gemeldet",
    b.sprungMeldungen().length === 0,
    "waehrend einer Watchparty zieht der Host den Player - das ist nicht die eigene Entscheidung");
}

{
  const b = buehne({ von: 60, dauer: 90 });
  b.spielen(58);
  b.fenster.__elfixMarke.entfernen();
  pruefe("Entfernen nimmt den Knopf aus der Seite",
    b.koerper.kinder.length === 0);
}

// --- Die Verdrahtung -----------------------------------------------------------

pruefe("Das Skript wird beim Laden und im Takt eingespielt",
  (MAIN.match(/installMarke\(provider, view,[^\n]*catch/g) || []).length === 2,
  "beim Laden steht der Rahmen des Hosters oft noch nicht");
pruefe("Der Rueckkanal fuehrt ins Lernen",
  /__elfix:sprung:\(\\d\+\):\(\\d\+\)/.test(MAIN) && /markeLernen\(provider, view\.webContents\.getURL\(\)/.test(MAIN));
pruefe("Ausgeschaltet verschwindet der Knopf sofort",
  /if \(settings\.playback\?\.introSkip === false\) \{/.test(MAIN)
  && /window\.__elfixMarke && window\.__elfixMarke\.entfernen\(\)/.test(MAIN),
  "nicht erst bei der naechsten Folge");
pruefe("Waehrend einer Watchparty lernt der Gast nicht",
  /const lernen = !liveKey \|\| istWatchpartyHostFuer\(liveKey, url\);/.test(MAIN),
  "sein Player wird gezogen - das ist nicht seine Entscheidung");
pruefe("Der Host schon",
  /function istWatchpartyHostFuer\(key, url\) \{/.test(MAIN)
  && /return Boolean\(eintrag\?\.hostId\) && eintrag\.hostId === eintrag\.myId;/.test(MAIN),
  "er ist derjenige, der den Player faehrt");
pruefe("Die Marke haengt am Titel, nicht an der Adresse",
  /const titel = taste\.titelSchluessel\(eintrag\?\.title \|\| cleanBaseMediaTitle\("", url\)\);/.test(MAIN),
  "ein Anbieterumzug soll die gelernten Marken nicht mitnehmen muessen");

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
