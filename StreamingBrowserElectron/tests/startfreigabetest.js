"use strict";
// Wann das Hauptfenster aufgehen darf.
//
// Warum es diese Pruefung gibt. ELFIX startete bis hierher vollstaendig
// sichtbar, lud danach das Update, schloss sich und startete neu - wer gerade
// angefangen hatte zu suchen, verlor es wieder. Die neue Reihenfolge ist
// "erst fragen, dann zeigen", und daran haengt eine unangenehme Eigenschaft:
// solange nicht geantwortet ist, sieht der Benutzer gar nichts. Ein Fehler in
// dieser Entscheidung ist deshalb kein Schoenheitsfehler, sondern eine App,
// die nicht mehr aufgeht.
//
// Geprueft werden die fuenf Faelle, die es wirklich gibt:
//
//   1. Kein Update - das Fenster geht auf, und zwar ohne Vorhang.
//   2. Update - das Fenster bleibt zu, bis installiert wird.
//   3. Die Pruefung schlaegt fehl - das Fenster geht trotzdem auf.
//   4. Der Download schlaegt fehl - dasselbe.
//   5. Keine Schleife: was einmal offen ist, bleibt offen, und was
//      installiert wird, macht kein Fenster mehr auf.
//
// Dazu die Frist: antwortet niemand, startet ELFIX trotzdem.

const fs = require("fs");
const path = require("path");
const startfreigabe = require("../src/startfreigabe");
const MAIN = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8")
  .split("\r\n").join("\n");

const pruefungen = [];
const pruefe = (n, b, d) => {
  pruefungen.push(Boolean(b));
  console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`);
};

/* ------------------------------------------------------- Der Anfang */

const anfang = startfreigabe.neu();
pruefe("Am Anfang wird gewartet", anfang.zustand === startfreigabe.WARTET, anfang.zustand);
pruefe("Und das Hauptfenster darf noch nicht", !startfreigabe.darfZeigen(anfang));
pruefe("Der Anfang sagt, dass gesucht wird", anfang.text === startfreigabe.TEXT_PRUEFUNG, anfang.text);

pruefe("Ganz am Anfang steht kein Vorhang - der Normalfall ist gleich beantwortet",
  !startfreigabe.vorhangNoetig(anfang, 0));
pruefe("Kurz davor immer noch nicht",
  !startfreigabe.vorhangNoetig(anfang, startfreigabe.VERZUG_MS - 1));
pruefe("Dauert die Pruefung laenger, kommt er doch",
  startfreigabe.vorhangNoetig(anfang, startfreigabe.VERZUG_MS));

/* ------------------------------------------- Fall 1: es gibt nichts Neues */

const aktuell = startfreigabe.melden(anfang, "kein-update");
pruefe("Ohne Update ist das Tor offen", startfreigabe.darfZeigen(aktuell), aktuell.zustand);
pruefe("Und danach braucht es keinen Vorhang mehr",
  !startfreigabe.vorhangNoetig(aktuell, 10000));

/* -------------------------------------------- Fall 2: es gibt ein Update */

const gefunden = startfreigabe.melden(anfang, "update", "1.78.0");
pruefe("Mit Update wird geladen", gefunden.zustand === startfreigabe.LAEDT, gefunden.zustand);
pruefe("Und das Hauptfenster bleibt zu", !startfreigabe.darfZeigen(gefunden));
pruefe("Der Vorhang steht dabei sofort - hier weiss sonst niemand, warum nichts geschieht",
  startfreigabe.vorhangNoetig(gefunden, 0));
pruefe("Er nennt die Fassung", gefunden.text.includes("1.78.0"), gefunden.text);

const bei42 = startfreigabe.melden(gefunden, "fortschritt", 42);
pruefe("Der Fortschritt steht im Text", bei42.text.includes("42"), bei42.text);
pruefe("Und als Zahl daneben", bei42.prozent === 42, String(bei42.prozent));

pruefe("Derselbe Fortschritt aendert nichts - das erspart dem Vorhang eine Runde",
  startfreigabe.melden(bei42, "fortschritt", 42) === bei42);
pruefe("Ueber hundert geht es nicht",
  startfreigabe.melden(bei42, "fortschritt", 140).prozent === 100);
pruefe("Und unter null auch nicht",
  startfreigabe.melden(bei42, "fortschritt", -5).prozent === 0);
pruefe("Unfug faellt auf null",
  startfreigabe.melden(gefunden, "fortschritt", "keine Zahl").prozent === 0);

const geladen = startfreigabe.melden(bei42, "geladen");
pruefe("Geladen heisst installieren", geladen.zustand === startfreigabe.INSTALLIERT, geladen.zustand);
pruefe("Und dabei geht kein Hauptfenster auf", !startfreigabe.darfZeigen(geladen));
pruefe("Der Vorhang bleibt stehen, bis die neue Fassung startet",
  startfreigabe.vorhangNoetig(geladen, 10000));
pruefe("Er sagt auch, was gerade geschieht",
  geladen.text === startfreigabe.TEXT_INSTALLATION, geladen.text);

pruefe("Ein Update, das schon fertig dalag, wird auch aus dem Warten heraus installiert",
  startfreigabe.melden(anfang, "geladen").zustand === startfreigabe.INSTALLIERT);

/* ------------------------------------ Fall 3: die Pruefung schlaegt fehl */

pruefe("Ein Fehler beim Suchen haelt niemanden auf",
  startfreigabe.darfZeigen(startfreigabe.melden(anfang, "fehler")));

/* ------------------------------------ Fall 4: der Download schlaegt fehl */

pruefe("Ein Fehler beim Laden ebenso",
  startfreigabe.darfZeigen(startfreigabe.melden(bei42, "fehler")));

/* ------------------------------------------------- Die Frist und der Rest */

pruefe("Antwortet niemand, startet ELFIX trotzdem",
  startfreigabe.darfZeigen(startfreigabe.melden(anfang, "stille")));
pruefe("Auch mitten im Download",
  startfreigabe.darfZeigen(startfreigabe.melden(bei42, "stille")));
pruefe("Die Frist ist lang genug fuer eine langsame Leitung und kurz genug zum Zusehen",
  startfreigabe.STILLE_MS >= 5000 && startfreigabe.STILLE_MS <= 30000,
  String(startfreigabe.STILLE_MS));
pruefe("Ohne Paket gibt es keinen Updater - und trotzdem ein Fenster",
  startfreigabe.darfZeigen(startfreigabe.melden(anfang, "unverpackt")));
pruefe("Die Meldung, dass gesucht wird, aendert fuer sich nichts",
  startfreigabe.melden(anfang, "pruefung") === anfang);
pruefe("Ein unbekanntes Ereignis auch nicht",
  startfreigabe.melden(anfang, "voellig-unbekannt") === anfang);
pruefe("Fortschritt ohne gefundenes Update ist ein Fortschritt woran - also nichts",
  startfreigabe.melden(anfang, "fortschritt", 30) === anfang);

/* ------------------------- Fall 5: keine Schleife, kein Fenster zurueck */

const offen = startfreigabe.melden(anfang, "kein-update");
for (const spaet of ["update", "fortschritt", "geladen", "fehler", "stille", "pruefung"]) {
  pruefe(`Was offen ist, bleibt offen - auch bei "${spaet}"`,
    startfreigabe.melden(offen, spaet, 50) === offen);
}
for (const spaet of ["update", "kein-update", "fehler", "stille", "unverpackt"]) {
  pruefe(`Waehrend der Installation aendert "${spaet}" nichts mehr`,
    startfreigabe.melden(geladen, spaet) === geladen);
}
pruefe("Insbesondere macht kein Ereignis waehrend der Installation ein Fenster auf",
  ["update", "kein-update", "fehler", "stille", "unverpackt", "geladen"]
    .every((e) => !startfreigabe.darfZeigen(startfreigabe.melden(geladen, e))));

/* ------------------------------- Und was das Tor von aussen umgehen kann */
//
// Die Entscheidung hier oben kann noch so richtig sein - sie nuetzt nichts,
// wenn das Fenster auf einem anderen Weg sichtbar wird. Genau das war der Fall:
// `ready-to-show` maximierte das Hauptfenster, und `maximize()` zeigt ein
// verstecktes Fenster mit ("This will also show (but not focus) the window if
// it isn't being displayed already", Electron-Dokumentation). Zu sehen waren
// zwei Fenster nebeneinander - der Ladevorhang des Updates und dahinter die
// fertige Oberflaeche, die es noch gar nicht geben durfte.

const bereitBlock = (MAIN.match(/mainWindow\.once\("ready-to-show"[\s\S]*?\n  \}\);/) || [""])[0];
pruefe("Beim ready-to-show wird nur gemeldet, nicht gezeigt",
  /hauptfensterBereit = true;/.test(bereitBlock)
  && /hauptfensterZeigen\(\);/.test(bereitBlock),
  "die Meldung ist die halbe Wahrheit - zeigen darf nur das Tor");
pruefe("Und dort wird nicht maximiert",
  !/maximize\(\)/.test(bereitBlock),
  "maximize() zeigt ein verstecktes Fenster mit und umgeht damit das ganze Tor");

const zeigenBlock = (MAIN.match(/function hauptfensterZeigen\(\)[\s\S]*?\n\}/) || [""])[0];
pruefe("Maximiert wird erst unmittelbar vor dem show()",
  /if \(!mainWindow\.isMaximized\(\)\) mainWindow\.maximize\(\);\s*\n\s*mainWindow\.show\(\);/
    .test(zeigenBlock),
  "so bleibt der alte Schoenheitsfehler weg: zwischen beiden liegt kein Bild");
pruefe("Und nur, wenn das Tor es erlaubt",
  /if \(!hauptfensterBereit \|\| !startfreigabe\.darfZeigen\(startLauf\)\) return;/.test(zeigenBlock));
pruefe("Sonst maximiert niemand im Hauptprozess",
  (MAIN.match(/mainWindow\.maximize\(\)/g) || []).length === 1,
  "jede weitere Stelle waere ein zweiter Weg an dem Tor vorbei");

/* ------------------------------------------------------- Unveraenderlich */

pruefe("Der alte Stand bleibt unveraendert - wer ihn noch haelt, sieht ihn so",
  anfang.zustand === startfreigabe.WARTET && gefunden.zustand === startfreigabe.LAEDT
    && bei42.prozent === 42);

const fehlgeschlagen = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehlgeschlagen}/${pruefungen.length} bestanden`);
process.exit(fehlgeschlagen ? 1 : 0);
