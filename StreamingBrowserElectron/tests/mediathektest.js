"use strict";
// Die Mediathek und der Zustand, den es nicht geben darf.
//
// Gemeldet war: von Hand abgehakte Titel verschwanden wieder. In der echten
// Ablage standen vierzehn Eintraege mit `completedManually: true` und
// gleichzeitig `completed: false` - von Hand abgehakt, aber nicht
// abgeschlossen. Die Mediathek filtert auf `completed`, also fielen sie heraus;
// und weil `completedManually` stehenblieb, holte sie auch nichts zurueck.
//
// Ursache war favorites:toggle-current: der Handler baut einen vorhandenen
// Eintrag neu zusammen und setzt `completed: false` fest, waehrend
// `completedManually` ueber den Spread aus dem alten Eintrag ueberlebt.

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const WURZEL = path.join(__dirname, "..");
const QUELLE = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").split("\r\n").join("\n");

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(b); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };

function abschnitt(anfang, ende = "}") {
  const zeilen = QUELLE.split("\n");
  const von = zeilen.findIndex((z) => z.startsWith(anfang));
  if (von < 0) throw new Error("nicht gefunden: " + anfang);
  let bis = von;
  while (bis < zeilen.length && zeilen[bis] !== ende) bis += 1;
  return zeilen.slice(von, bis + 1).join("\n");
}

// --- Der Ausgleich, aus main.js herausgeschnitten ---------------------------

function ausgleichBauen() {
  const umgebung = { favorites: [], Date, Boolean, String, Number, Array, Object, console: { log() {} } };
  vm.createContext(umgebung);
  vm.runInContext(abschnitt("function widersprucheGeraderichten("), umgebung);
  return (liste) => ({ geaendert: vm.runInContext("widersprucheGeraderichten", umgebung)(liste), liste });
}
const ausgleich = ausgleichBauen();

const abgehakt = (extra = {}) => ({
  id: "a", title: "Breaking Bad", completed: true, completedManually: true,
  completedAt: "2026-08-16T11:48:37.139Z", hideFromContinueWatching: true, favorite: false, ...extra
});

// Genau der Zustand aus der echten Ablage.
const kaputt = [abgehakt({ completed: false })];
const r1 = ausgleich(kaputt);
pruefe("Von Hand abgehakt ohne completed wird zurueckgeholt",
  r1.geaendert === 1 && kaputt[0].completed === true, JSON.stringify(kaputt[0].completed));
pruefe("Der Titel verschwindet dabei nicht aus Weiterschauen-Sicht",
  kaputt[0].hideFromContinueWatching === true);
pruefe("Ein fehlendes Datum wird nachgetragen", Boolean(kaputt[0].completedAt));

// Ein fehlendes completedAt darf kein Grund sein, nichts zu tun.
const ohneDatum = [abgehakt({ completed: false, completedAt: "" })];
ausgleich(ohneDatum);
pruefe("Auch ohne Datum wird zurueckgeholt",
  ohneDatum[0].completed === true && ohneDatum[0].completedAt !== "");

// Was in Ordnung ist, bleibt unberuehrt.
const heil = [
  abgehakt(),
  { id: "b", title: "Loki", completed: false, completedManually: false },
  { id: "c", title: "Naruto", completed: true, completedManually: false },
  { id: "d", title: "Leer" }
];
const vorher = JSON.stringify(heil);
const r2 = ausgleich(heil);
pruefe("Heile Eintraege werden nicht angefasst", r2.geaendert === 0 && JSON.stringify(heil) === vorher);

// Ein Titel, den neue Folgen zurueckgeholt haben, hat completedManually: false
// - der darf nicht faelschlich in die Mediathek wandern.
const neueFolge = [{ id: "e", title: "One Piece", completed: false, completedManually: false, favorite: true }];
ausgleich(neueFolge);
pruefe("Zurueckgeholte Serien bleiben ausserhalb der Mediathek", neueFolge[0].completed === false);

// --- Die Ursache ------------------------------------------------------------

const toggle = abschnitt('ipcMain.handle("favorites:toggle-current"', "});");
pruefe("Vormerken loescht das Abhaken jetzt vollstaendig",
  /completed: false,\s*\n\s*completedManually: false,\s*\n\s*completedAt: "",/.test(toggle),
  toggle.includes("completedManually: false") ? "completedManually wird mitgeloescht" : "FEHLT");

// Wer in der Ablage sucht, findet den Widerspruch sonst nirgends mehr: jede
// Stelle, die `completed` loescht, muss `completedManually` mitloeschen - sonst
// entsteht derselbe Zustand an anderer Stelle wieder.
// Geprueft werden nur Zuweisungen an einen *vorhandenen* Eintrag. Die
// Vorlagen fuer neue Eintraege ({ completed: false, ... }) koennen den
// Widerspruch nicht erzeugen: dort gibt es noch kein completedManually.
const zeilen = QUELLE.split(String.fromCharCode(10));
const stellen = zeilen
  .map((zeile, i) => ({ zeile: zeile.trim(), nr: i + 1 }))
  .filter((z) => z.zeile === "favorite.completed = false;" || z.zeile === "lokal.completed = false;");
const ohneNachzug = stellen.filter((z) => (
  !/completedManually\s*=\s*false/.test(zeilen.slice(z.nr - 1, z.nr + 6).join(String.fromCharCode(10)))
));
pruefe("Jede Zuweisung completed=false zieht completedManually nach",
  ohneNachzug.length === 0,
  ohneNachzug.length ? "offen in Zeile " + ohneNachzug.map((z) => z.nr).join(", ") : "alle " + stellen.length + " Stellen");

pruefe("Der Ausgleich laeuft vor jedem Schreiben",
  /function saveFavorites\(\) \{[\s\S]{0,200}?widersprucheGeraderichten\(\)/.test(QUELLE));
pruefe("Der Ausgleich laeuft auch beim Laden",
  /function loadFavorites\(\)[\s\S]{0,4000}?widersprucheGeraderichten\(geladen\)/.test(QUELLE));

const gut = pruefungen.filter(Boolean).length;
console.log(`${gut}/${pruefungen.length} bestanden`);
process.exit(gut === pruefungen.length ? 0 : 1);
