"use strict";
// YouTube einmalig als Anbieter nachtragen.
//
// Eine frisch angelegte Anbieterliste bringt YouTube mit. Wer ELFIX schon
// laenger benutzt, hat seine Liste von einer Fassung geerbt, die es noch nicht
// kannte - und damit auch nichts von dem, was inzwischen daran haengt: eigene
// Reihe auf der Startseite, Reiter in der Mediathek, YouTube-Watchparty.
//
// Die schwierige Haelfte ist nicht das Hinzufuegen, sondern das Aufhoeren.
// Zwei Wege fuehren dahin, dass der Nachtrag ein zweites Mal laeuft und etwas
// zurueckbringt, das jemand bewusst geloescht hat:
//
// Der Merker wird erst nach der Pruefung gesetzt - dann traegt jeder Start
// erneut nach, solange YouTube fehlt.
//
// Oder der Merker faellt beim Speichern der Einstellungen heraus, weil
// normalizeSettings ihn nicht kennt. Die Oberflaeche schickt beim Speichern
// den ganzen Block; was dort nicht steht, ist danach weg. Genau das wird hier
// mitgeprueft.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const providerModel = require("../shared/provider-model.js");
const youtube = require("../src/youtube.js");

const WURZEL = path.join(__dirname, "..");
const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").replace(/\r/g, "");

const pruefungen = [];
const pruefe = (name, bedingung, detail) => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

function abschnitt(anfang, ende = "}") {
  const zeilen = MAIN.split("\n");
  const von = zeilen.findIndex((z) => z.startsWith(anfang));
  if (von < 0) throw new Error("nicht gefunden: " + anfang);
  let bis = von;
  while (bis < zeilen.length && zeilen[bis] !== ende) bis += 1;
  return zeilen.slice(von, bis + 1).join("\n");
}

// --- Der Nachtrag, aus main.js herausgeschnitten -----------------------------

function buehne(anbieter, einstellungen) {
  const gerufen = { anbieterGespeichert: 0, einstellungenGespeichert: 0 };
  const kontext = {
    providers: anbieter.map((eintrag) => ({ ...eintrag })),
    settings: JSON.parse(JSON.stringify(einstellungen)),
    providerModel,
    youtube,
    crypto,
    saveProviders: () => { gerufen.anbieterGespeichert += 1; },
    saveSettings: () => { gerufen.einstellungenGespeichert += 1; },
    console: { log() {} },
    Boolean, String, Number, Array, Object, JSON
  };
  vm.createContext(kontext);
  vm.runInContext(abschnitt("function youtubeAnbieterNachtragen()"), kontext);
  return {
    kontext, gerufen,
    laufen: () => vm.runInContext("youtubeAnbieterNachtragen()", kontext),
    namen: () => kontext.providers.map((eintrag) => eintrag.name),
    youtubeAnbieter: () => kontext.providers.filter((eintrag) => youtube.istYoutubeUrl(eintrag.startUrl))
  };
}

const OHNE_YT = [
  { id: "a", name: "Aniworld", startUrl: "https://aniworld.to/", searchUrl: "https://aniworld.to/search?q={query}", enabled: true, sortOrder: 0 },
  { id: "b", name: "S.to", startUrl: "https://s.to/", searchUrl: "https://s.to/suche?term={query}", enabled: true, sortOrder: 1 }
];
const MIT_YT = [
  ...OHNE_YT,
  { id: "c", name: "Videos", startUrl: "https://www.youtube.com/", searchUrl: "https://www.youtube.com/results?search_query={query}", enabled: true, sortOrder: 2 }
];
const ALT = { migrations: { youtubeProvider: false } };
const SCHON = { migrations: { youtubeProvider: true } };

// --- Nachtragen --------------------------------------------------------------

const neu = buehne(OHNE_YT, ALT);
pruefe("Fehlt YouTube, wird es nachgetragen", neu.laufen() === true);
pruefe("Es steht genau einmal da", neu.youtubeAnbieter().length === 1);
pruefe("und zwar am Ende",
  neu.namen().join(",") === "Aniworld,S.to,YouTube",
  neu.namen().join(","));

const nachgetragen = neu.youtubeAnbieter()[0];
pruefe("Es ist sichtbar", nachgetragen.enabled === true);
pruefe("Es hat eine Suchadresse",
  nachgetragen.searchUrl.includes("{query}"),
  nachgetragen.searchUrl);
pruefe("Es steht hinter den vorhandenen",
  nachgetragen.sortOrder === 2,
  `sortOrder ${nachgetragen.sortOrder}`);
pruefe("Es bekommt eine eigene Kennung",
  typeof nachgetragen.id === "string"
  && nachgetragen.id.length > 8
  && !OHNE_YT.some((eintrag) => eintrag.id === nachgetragen.id));
pruefe("Beides wird gespeichert",
  neu.gerufen.anbieterGespeichert === 1 && neu.gerufen.einstellungenGespeichert === 1);
pruefe("Der Merker steht jetzt", neu.kontext.settings.migrations.youtubeProvider === true);

// --- Nicht nachtragen --------------------------------------------------------

const vorhanden = buehne(MIT_YT, ALT);
pruefe("Ist YouTube schon da, kommt kein zweites dazu",
  vorhanden.laufen() === false && vorhanden.youtubeAnbieter().length === 1);
pruefe("Erkannt wird es an der Adresse, nicht am Namen",
  vorhanden.namen().join(",") === "Aniworld,S.to,Videos",
  "wer ihn umbenannt hat, soll keinen zweiten bekommen");
pruefe("Die Anbieterliste wird dann gar nicht erst geschrieben",
  vorhanden.gerufen.anbieterGespeichert === 0);
pruefe("Der Merker wird trotzdem gesetzt",
  vorhanden.kontext.settings.migrations.youtubeProvider === true,
  "sonst liefe die Pruefung bei jedem Start erneut");

const fertig = buehne(OHNE_YT, SCHON);
pruefe("Ist der Nachtrag schon gelaufen, passiert nichts mehr",
  fertig.laufen() === false
  && fertig.youtubeAnbieter().length === 0
  && fertig.gerufen.anbieterGespeichert === 0
  && fertig.gerufen.einstellungenGespeichert === 0);

// Der Fall, um den es eigentlich geht: erst nachtragen, dann loeschen.
const geloescht = buehne(OHNE_YT, ALT);
geloescht.laufen();
geloescht.kontext.providers = geloescht.kontext.providers
  .filter((eintrag) => !youtube.istYoutubeUrl(eintrag.startUrl));
pruefe("Wer YouTube danach loescht, behaelt es geloescht",
  geloescht.laufen() === false && geloescht.youtubeAnbieter().length === 0,
  "ein Nachtrag, der bei jedem Start wiederkaeme, waere eine Weigerung");

// --- Der Merker muss das Speichern ueberleben --------------------------------

// normalizeSettings zieht den ganzen Einstellungsblock durch und braucht dabei
// Helfer, die mit dieser Frage nichts zu tun haben. Unbekannte Namen werden
// deshalb zu harmlosen Platzhaltern - geprueft wird hier allein, was mit dem
// Merker geschieht.
// Der Geraeteschluessel ist kein Platzhalter: normalizeSettings prueft mit ihm,
// ob ein Schluessel ueberhaupt einer ist. Ein Platzhalter, der eine leere Liste
// zurueckgibt, machte daraus stillschweigend "kein Schluessel".
const roheUmgebung = {
  console: { log() {} }, crypto, Boolean, String, Number, Array, Object, JSON, Math, Date,
  geraeteSchluessel: require("../src/geraete-schluessel")
};
const umgebung = new Proxy(roheUmgebung, {
  has: () => true,
  get: (ziel, name) => (name in ziel ? ziel[name] : (typeof name === "symbol" ? undefined : () => [])),
  set: (ziel, name, wert) => { ziel[name] = wert; return true; }
});
vm.createContext(umgebung);
vm.runInContext(MAIN.match(/^const SETTINGS_SCHEMA_VERSION = \d+;$/m)[0], umgebung);
for (const name of ["function sanitizeChoice(", "function defaultSettings(", "function normalizeSettings("]) {
  vm.runInContext(abschnitt(name), umgebung);
}
const durch = (roh) => vm.runInContext("normalizeSettings", umgebung)(roh);

pruefe("normalizeSettings kennt den Merker",
  durch({ migrations: { youtubeProvider: true } }).migrations.youtubeProvider === true,
  "faellt er beim Speichern heraus, laeuft der Nachtrag wieder");
pruefe("Ohne Merker steht er auf falsch",
  durch({}).migrations.youtubeProvider === false,
  "eine bestehende Ablage soll den Nachtrag bekommen");
pruefe("Nur ein ausdrueckliches Ja zaehlt",
  durch({ migrations: { youtubeProvider: "ja" } }).migrations.youtubeProvider === false);
pruefe("Eine frische Ablage hat ihn schon",
  vm.runInContext("defaultSettings()", umgebung).migrations.youtubeProvider === true,
  "sie bringt YouTube ohnehin mit");

// --- Der Weg in den Start ----------------------------------------------------

pruefe("Der Nachtrag laeuft beim Start",
  /youtubeAnbieterNachtragen\(\);/.test(MAIN.slice(MAIN.indexOf("app.whenReady()"), MAIN.indexOf("app.whenReady()") + 2000)));
pruefe("und zwar erst, wenn Anbieter und Einstellungen geladen sind",
  MAIN.indexOf("providers = loadProviders();") < MAIN.indexOf("youtubeAnbieterNachtragen();")
  && MAIN.indexOf("settings = loadSettings();") < MAIN.indexOf("youtubeAnbieterNachtragen();"),
  "er braucht beide Seiten");
pruefe("Der Merker wird vor der Pruefung gesetzt",
  MAIN.indexOf("settings.migrations = {", MAIN.indexOf("function youtubeAnbieterNachtragen()"))
  < MAIN.indexOf("providers.some((eintrag) => youtube.istYoutubeUrl", MAIN.indexOf("function youtubeAnbieterNachtragen()")),
  "danach gesetzt hiesse: jeder Start traegt erneut nach");

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
