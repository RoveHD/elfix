"use strict";
// Die Seitenleiste beim Kleinerziehen des Fensters.
//
// Zwei Fehler, die zusammen so aussahen, als loese sich die Leiste auf:
//
// Niedriges Fenster: ".app-sidebar" trug "overflow: hidden". Was nicht mehr
// hineinpasste, war weg - Anbieter, Einstellungen und Hilfe standen unterhalb
// der Kante und liessen sich mit nichts erreichen.
//
// Schmales Fenster: eine Regel aus der Zeit, als die Leiste noch in
// ".desktop-home-shell" sass und dort auf 78 Pixel schrumpfte, blendete ab
// 1180 Pixeln Zeichen und Beschriftung jedes Eintrags aus. Die Leiste selbst
// behaelt bis 980 Pixel ihre vollen 232 - zurueck blieben 232 Pixel breite,
// leere Streifen, ueber denen nur die Ueberschriften standen.
//
// Geprueft wird die echte Datei. Ein Stylesheet laesst sich hier nicht
// zeichnen, deshalb werden die Regeln gelesen: welcher Block welche Erklaerung
// traegt.

const fs = require("fs");
const path = require("path");

const ROH = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "styles.css"), "utf8")
  .replace(/\r/g, "");
// Ohne Kommentare gelesen: sonst zaehlt ein Satz ueber eine alte Regel als die
// Regel selbst - der Block hier erklaert ausdruecklich, was frueher dastand.
const QUELLE = ROH.replace(/\/\*[\s\S]*?\*\//g, "");

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(b); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };

// Der Rumpf des Blocks, der an dieser Stelle beginnt - ueber Klammern gezaehlt.
// In CSS gibt es keine Vorlagen-Literale, die dabei stoeren koennten.
function blockAb(von) {
  let tiefe = 0;
  for (let i = QUELLE.indexOf("{", von); i < QUELLE.length; i += 1) {
    if (QUELLE[i] === "{") tiefe += 1;
    if (QUELLE[i] === "}") {
      tiefe -= 1;
      if (tiefe === 0) return QUELLE.slice(von, i + 1);
    }
  }
  throw new Error("Block ohne Ende bei " + von);
}

function block(anfang) {
  const von = QUELLE.indexOf(anfang);
  if (von < 0) throw new Error("nicht gefunden: " + anfang);
  return blockAb(von);
}

// Alle Bloecke eines Umbruchpunkts - er kommt mehrfach vor.
function bloecke(anfang) {
  const teile = [];
  for (let von = QUELLE.indexOf(anfang); von >= 0; von = QUELLE.indexOf(anfang, von + anfang.length)) {
    teile.push(blockAb(von));
  }
  return teile;
}

// --- Niedriges Fenster: die Leiste scrollt ----------------------------------

const leiste = block(".app-sidebar {");
pruefe("Die Leiste scrollt laengs", /overflow-y:\s*auto/.test(leiste), leiste.match(/overflow[^;]*;/g)?.join(" "));
pruefe("Quer bleibt sie zu", /overflow-x:\s*hidden/.test(leiste));
pruefe("Und schneidet nicht mehr ab", !/overflow:\s*hidden/.test(leiste));
pruefe("Sie darf in ihrem Feld auch wirklich kleiner werden als ihr Inhalt",
  /min-height:\s*0/.test(leiste));

// In einer Spalte gibt Flex sonst jedem Kind nach, bis von den Abschnitten
// nichts mehr uebrig ist. Sie behalten ihre Hoehe und scrollen lieber.
const kinder = block(".home-sidebar > * {");
pruefe("Die Abschnitte der Leiste geben nicht nach", /flex:\s*0 0 auto/.test(kinder), kinder.trim());

// --- Schmales Fenster: die Eintraege bleiben lesbar --------------------------

const bei1180 = bloecke("@media (max-width: 1180px)");
pruefe("Es gibt den Umbruchpunkt bei 1180 noch", bei1180.length >= 1, `${bei1180.length} Block/Bloecke`);
for (const [nummer, teil] of bei1180.entries()) {
  pruefe(`1180 (${nummer + 1}): kein Eintrag der Leiste wird ausgeblendet`,
    !/\.home-side-link\s+span/.test(teil) && !/\.side-label/.test(teil) && !/\.side-icon/.test(teil),
    teil.split("\n").filter((z) => z.includes("side-")).join(" ").trim());
  pruefe(`1180 (${nummer + 1}): die Ueberschriften bleiben stehen`,
    !/\.home-sidebar-section p/.test(teil));
  pruefe(`1180 (${nummer + 1}): die Wortmarke bleibt stehen`,
    !/\.sidebar-wordmark/.test(teil));
}

// Erst ab 980 wird die Leiste zur Zeichenspalte - dort weichen die
// Beschriftungen, die Zeichen bleiben.
const bei980 = bloecke("@media (max-width: 980px)").find((t) => t.includes("--sidebar-width"));
pruefe("Ab 980 wird die Leiste so schmal wie eingeklappt",
  /--sidebar-width:\s*var\(--sidebar-collapsed-width\)/.test(bei980));
pruefe("Dort weichen die Beschriftungen", /\.side-label/.test(bei980) && /opacity:\s*0/.test(bei980));
pruefe("Die Zeichen bleiben", !/\.side-icon\s*,?[^{]*\{[^}]*display:\s*none/.test(bei980));

// Die Wortmarke muss dort mit dem Elternteil davor stehen, sonst holt
// ".app-sidebar .sidebar-wordmark" sie wieder hervor - eine Klasse mehr wiegt
// schwerer als ein Umbruchpunkt. Vorher blieb ein Streifen von ihr stehen und
// schob das Zeichen aus der 64 Pixel breiten Leiste.
pruefe("Die Wortmarke weicht dort mit genug Gewicht",
  /\.app-shell\s+\.app-sidebar\s+\.sidebar-wordmark\s*\{\s*display:\s*none/.test(bei980),
  bei980.split("\n").filter((z) => z.includes("wordmark")).join(" ").trim());

// Auf 64 Pixeln bleiben nach dem Innenabstand 48 - das Zeichen misst 34, der
// Pfeil daneben 32. Beides passt nicht nebeneinander.
pruefe("Der Pfeil weicht dem Zeichen", /\.app-sidebar\s+\.sidebar-collapse\s*\{\s*display:\s*none/.test(bei980));
pruefe("Und eingeklappt steht das Zeichen dann trotzdem da",
  /\.app-shell\.sidebar-collapsed\s+\.sidebar-mark\s*\{\s*display:\s*grid/.test(bei980));

const gut = pruefungen.filter(Boolean).length;
console.log(`${gut}/${pruefungen.length} bestanden`);
process.exit(gut === pruefungen.length ? 0 : 1);
