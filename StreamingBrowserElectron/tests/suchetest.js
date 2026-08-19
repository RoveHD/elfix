"use strict";
// Suchtreffer: der Titel und was aus ihm wird.
//
// Zwei gemeldete Fehler, eine Ursache. Die Suche der Anbieter hebt die
// Fundstelle im Titel selbst hervor - AniWorld liefert "<em>Demo</em>n Lord,
// Retry!". Beim Entfernen der Auszeichnung wurde jedes Tag zu einem
// Leerzeichen, und aus dem Titel wurde "Demo n Lord, Retry!".
//
// Damit war der Name schon in den Daten kaputt, nicht erst in der Anzeige: er
// wanderte so auf die Watchlist. Und weil die Schnellsuche ausserdem kein Bild
// mitliefert, blieb die Kachel dort leer - die gemeldete "Luecke", die erst
// verschwand, wenn man den Titel einmal geoeffnet hatte.
//
// Die Regel, die hier gilt: Hervorhebung ist Darstellung. Der Titel und die
// Adresse eines Treffers bleiben unberuehrt.

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const WURZEL = path.join(__dirname, "..");
const lies = (datei) => fs.readFileSync(path.join(WURZEL, datei), "utf8").split("\r\n").join("\n");

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(b); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };

function abschnitt(quelle, anfang, ende = "}") {
  const zeilen = quelle.split("\n");
  const von = zeilen.findIndex((z) => z.startsWith(anfang));
  if (von < 0) throw new Error("nicht gefunden: " + anfang);
  let bis = von;
  while (bis < zeilen.length && zeilen[bis] !== ende) bis += 1;
  return zeilen.slice(von, bis + 1).join("\n");
}

// --- Die Auszeichnung entfernen, ohne den Titel zu zerreissen ---------------
//
// Beide Wege in die Suche haben denselben Schritt: discover.js fuer die
// HTML-Seite, main.js fuer die Schnellsuche. Beide werden geprueft.

function saeuberer(datei, name) {
  const quelle = lies(datei);
  const umgebung = {
    String, RegExp, Object,
    entitaetenDekodieren: (w) => String(w),
    decodeHtmlEntities: (w) => String(w)
  };
  vm.createContext(umgebung);
  vm.runInContext(quelle.match(/const INLINE_TAGS = [^;]+;/)[0], umgebung);
  vm.runInContext(abschnitt(quelle, "function " + name + "("), umgebung);
  return vm.runInContext(name, umgebung);
}

const wege = [
  ["discover.js", saeuberer("src/discover.js", "ohneTags")],
  ["main.js", saeuberer("src/main.js", "cleanAnchorText")]
];

// Genau das, was AniWorld auf "demo" wirklich antwortet.
const ECHT = [
  ["<em>Demo</em>n Lord, Retry!", "Demon Lord, Retry!"],
  ["The Misfit of <em>Demo</em>n King Academy", "The Misfit of Demon King Academy"],
  ["How Not to Summon a <em>Demo</em>n Lord", "How Not to Summon a Demon Lord"],
  ["Welcome to <em>Demo</em>n School! Iruma-kun", "Welcome to Demon School! Iruma-kun"]
];

for (const [wo, saeubern] of wege) {
  for (const [roh, soll] of ECHT) {
    pruefe(`${wo}: ${JSON.stringify(roh).slice(0, 42)}`, saeubern(roh) === soll, JSON.stringify(saeubern(roh)));
  }
  // Die Fundstelle kann ueberall liegen - am Anfang, mitten im Wort, ueber eine
  // Wortgrenze hinweg.
  pruefe(wo + ": Fundstelle am Anfang", saeubern("<em>Dem</em>on Slayer") === "Demon Slayer");
  pruefe(wo + ": Fundstelle ueber die Wortgrenze", saeubern("<em>Demon S</em>layer") === "Demon Slayer");
  pruefe(wo + ": Fundstelle am Ende", saeubern("Attack on <em>Titan</em>") === "Attack on Titan");
  pruefe(wo + ": ganzer Titel markiert", saeubern("<em>Naruto</em>") === "Naruto");
  // Blockelemente trennen weiterhin - sonst klebten getrennte Angaben zusammen.
  pruefe(wo + ": Blockelemente trennen weiter", saeubern("<div>Naruto</div><div>2002</div>") === "Naruto 2002");
  pruefe(wo + ": Zeilenumbruch trennt weiter", saeubern("Naruto<br>Shippuden") === "Naruto Shippuden");
  pruefe(wo + ": leere Eingabe", saeubern("") === "" && saeubern(null) === "");
}

// --- Die Hervorhebung: nur Darstellung -------------------------------------

function element(tag) {
  return {
    tagName: tag, className: "", textContent: "", dataset: {}, children: [],
    append(...k) { this.children.push(...k); },
    addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }
  };
}
function textknoten(wert) { return { tagName: "#text", textContent: String(wert) }; }

const rendererQuelle = lies("src/renderer/renderer.js");
const umgebung = {
  document: { createElement: element, createTextNode: textknoten },
  String, Number, Boolean, Array, Object
};
vm.createContext(umgebung);
vm.runInContext(abschnitt(rendererQuelle, "function titelMitFundstelle("), umgebung);
const hervorheben = vm.runInContext("titelMitFundstelle", umgebung);

// Der sichtbare Text muss immer genau der Titel sein - Zeichen fuer Zeichen.
const sichtbar = (knoten) => (knoten.children.length
  ? knoten.children.map((k) => (k.children?.length ? sichtbar(k) : k.textContent)).join("")
  : knoten.textContent);

const TITEL = "Demon Slayer";
for (const suche of ["dem", "demo", "demon", "demon s", "slay", "Demon Slayer", "DEMO", "xyz", ""]) {
  const knoten = hervorheben(TITEL, suche);
  pruefe(`Suche "${suche}": der Titel bleibt Zeichen fuer Zeichen erhalten`,
    sichtbar(knoten) === TITEL, JSON.stringify(sichtbar(knoten)));
}

// Und kein kuenstliches Leerzeichen zwischen den Stuecken.
const geteilt = hervorheben(TITEL, "demo");
pruefe("Kein Leerzeichen zwischen Fundstelle und Rest",
  !/demo\s+n/i.test(sichtbar(geteilt)), JSON.stringify(sichtbar(geteilt)));
pruefe("Die Fundstelle ist ausgezeichnet",
  geteilt.children.some((k) => k.tagName === "mark" && k.textContent === "Demo"),
  JSON.stringify(geteilt.children.map((k) => k.tagName + ":" + (k.textContent || ""))));
pruefe("Die Fundstelle zeigt die Schreibweise des Originals",
  hervorheben(TITEL, "DEMO").children.find((k) => k.tagName === "mark")?.textContent === "Demo");
pruefe("Ohne Treffer bleibt es ein einziger Knoten",
  hervorheben(TITEL, "xyz").children.length === 0);
pruefe("Ohne Suchbegriff bleibt es ein einziger Knoten",
  hervorheben(TITEL, "").children.length === 0);

// --- Die Architekturregel ---------------------------------------------------

const karte = abschnitt(rendererQuelle, "function searchResultCard(");
pruefe("Die Karte fuehrt die Adresse als stabile Kennung",
  /card\.dataset\.resultUrl = String\(result\.url/.test(karte));
pruefe("Watchlist-Aktion laeuft ueber die Adresse, nicht ueber den Anzeigetitel",
  /url: result\.url/.test(karte) && !/title: card\.|querySelector\("strong"\)/.test(karte));
pruefe("Der Titel wird nicht mehr als HTML zusammengebaut",
  !/innerHTML\s*=\s*`<strong>/.test(karte), "kein innerHTML fuer den Titel");
pruefe("Die Hervorhebung bekommt den Originaltitel, nicht ein Bruchstueck",
  /titelMitFundstelle\(result\.title, suche\)/.test(karte));

// Die Luecke in der Watchlist: das Poster wird beim Hinzufuegen geholt.
const hauptQuelle = lies("src/main.js");
const zufuegen = abschnitt(hauptQuelle, 'ipcMain.handle("favorites:add-result"', "});");
pruefe("Beim Hinzufuegen aus der Suche wird das Poster nachgeholt",
  /if \(!favorite\.thumbnail\)[\s\S]{0,120}repairFavoriteThumbnailIfNeeded/.test(zufuegen));
pruefe("Der Handler wartet darauf, bevor er antwortet",
  /ipcMain\.handle\("favorites:add-result", async /.test(hauptQuelle));

const gut = pruefungen.filter(Boolean).length;
console.log(`${gut}/${pruefungen.length} bestanden`);
process.exit(gut === pruefungen.length ? 0 : 1);
