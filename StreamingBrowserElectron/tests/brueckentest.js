"use strict";
// Die Android-Bruecken.
//
// Zwischen den geteilten Modulen und der Java-Seite liegt je Sache ein kleines
// Modul unter `android/app/src/main/assets/kern/eigen`. Dort steht das, was am
// Rechner in main.js liegt: unter welchem Schluessel etwas gefuehrt wird, wann
// geschrieben wird, was zurueckgemeldet wird. Regeln stehen dort keine.
//
// Genau deshalb muss es geprueft werden. Eine Bruecke, die den Schluessel
// anders bildet als main.js, laesst beide Geraete dasselbe merken und keins
// das des anderen wiederfinden - der Abgleich waere still kaputt, und niemand
// saehe es an den Dateien. Der Vergleich unten holt sich die Ableitung
// deshalb aus main.js selbst und nicht aus einer zweiten Beschreibung davon.
//
// Ausgefuehrt wird die Bruecke wirklich, mit demselben CommonJS-Lader, den
// kern-host.js im WebView aufspannt: Modulnamen ohne Pfad und ohne Endung.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..");
const BRUECKEN = path.join(WURZEL, "..", "android/app/src/main/assets/kern/eigen");
const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").replace(/\r/g, "");

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}

/**
 * Eine Bruecke laden - so, wie der Kern es auf dem Geraet tut.
 *
 * `kern-host.js` loest `require("fassung")` ueber den blossen Dateinamen auf,
 * weil die Module dort flach nebeneinander liegen. Hier wird derselbe Weg
 * nachgestellt und auf `src/` bzw. `shared/` gezeigt; laedt die Bruecke etwas,
 * das gar nicht mitkopiert wird, faellt es hier auf und nicht erst auf dem
 * Telefon.
 */
const KERN_MODULE = new Set(
  fs.readFileSync(path.join(WURZEL, "..", "android/app/build.gradle"), "utf8")
    .split("\n")
    .map((zeile) => (zeile.match(/"((?:src|shared)\/[a-z-]+\.js)"/) || [])[1])
    .filter(Boolean)
    .map((pfad) => path.basename(pfad, ".js"))
);

function brueckeLaden(name) {
  const quelle = fs.readFileSync(path.join(BRUECKEN, `${name}.js`), "utf8");
  const modul = { exports: {} };
  const lader = (gesucht) => {
    if (!KERN_MODULE.has(gesucht)) {
      throw new Error(`"${gesucht}" steht nicht in kernModule und faehrt nicht mit`);
    }
    const unter = fs.existsSync(path.join(WURZEL, "src", `${gesucht}.js`)) ? "src" : "shared";
    return require(path.join(WURZEL, unter, `${gesucht}.js`));
  };
  vm.runInNewContext(quelle, {
    require: lader,
    module: modul,
    exports: modul.exports,
    console,
    // Die Bruecken melden ueber `window.ElfixKern` nach Java. Hier gibt es
    // keins; wer es braucht, bekommt einen Zaehler statt einer Ausnahme.
    window: { ElfixKern: { ereignis: () => {} } }
  });
  return modul.exports;
}

// --- Die Watchparty: der Folgen-Autostart -------------------------------------
//
// Der Auftrag liegt in der Bruecke und nicht in Java. Das ist der Kern der
// Reparatur: `autoStartRequested` und `autoStartUrl` gehoerten dem WebView und
// waren nach der Navigation weg - also konnte danach nichts mehr starten.
//
// Geprueft wird hier die Buchfuehrung, die dabei entsteht: wem ein Auftrag
// gehoert, wann er veraltet, und dass in einem Raum mit Bleach, Korra und
// BLACK TORCH kein Ereignis des einen den Start des anderen ausloest.

const wpBruecke = brueckeLaden("watchparty-bruecke");

const BLEACH = "https://aniworld.to/anime/stream/bleach";
const KORRA = "https://aniworld.to/anime/stream/korra";
const RAUM = "wohnzimmer";

pruefe("Die Watchparty-Bruecke laedt nur Module, die auch mitkopiert werden",
  typeof wpBruecke.autostartAnfordern === "function",
  "sonst haette brueckeLaden oben geworfen - watchparty-autostart muss in kernModule stehen");

// Ohne Auftrag ist nichts zu tun. Kein Takt, kein Skript, kein Nachklopfen.
pruefe("Ohne Auftrag gibt es nichts zu tun",
  wpBruecke.autostartSchritt({ room: RAUM, key: BLEACH }).tun === "aufgeben");

// Ein Auftrag fuer Bleach.
const ersterAuftrag = wpBruecke.autostartAnfordern({
  key: BLEACH, room: RAUM, url: BLEACH + "/staffel-1/episode-5",
  season: 1, episode: 5, hostId: "rechner", playing: true
});
pruefe("Ein Auftrag traegt Raum, Titel und eine laufende Nummer",
  ersterAuftrag && ersterAuftrag.auftrag.startsWith(RAUM + "|" + BLEACH + "|s1e5|")
    && ersterAuftrag.generation === 1,
  ersterAuftrag && ersterAuftrag.auftrag);

pruefe("Und er will sofort losgehen",
  wpBruecke.autostartSchritt({ room: RAUM, key: BLEACH, season: 1, episode: 5 }).tun === "anfordern");

// Steht eine andere Folge offen, ruehrt sich nichts - der Auftrag von vorhin
// darf spaeter nicht die falsche Folge starten.
pruefe("Steht eine andere Folge offen, gibt der Auftrag auf",
  wpBruecke.autostartSchritt({ room: RAUM, key: BLEACH, season: 1, episode: 9 }).tun === "aufgeben",
  "sonst startete ein Auftrag von vorhin die Folge, die man gerade verlassen hat");

// Waehrend die Seite noch laedt, steht hier noch der Titel von vorhin. Das ist
// kein Grund aufzugeben - der Auftrag entsteht ja *vor* der Navigation.
wpBruecke.autostartAnfordern({
  key: BLEACH, room: RAUM, url: BLEACH + "/staffel-1/episode-5",
  season: 1, episode: 5, hostId: "rechner", playing: true
});
{
  const waehrendLadens = wpBruecke.autostartSchritt({ room: RAUM, key: KORRA, season: 2, episode: 3 });
  pruefe("Steht noch ein anderer Titel, wird gewartet statt aufgegeben",
    waehrendLadens.tun === "warten" && waehrendLadens.grund === "andere seite",
    `${waehrendLadens.tun}/${waehrendLadens.grund}`);
  pruefe("Und der Auftrag lebt weiter",
    wpBruecke.autostartSchritt({ room: RAUM, key: BLEACH, season: 1, episode: 5 }).tun === "anfordern");
}

// Ein zweiter Auftrag - der Host hat waehrend des Ladens erneut gewechselt.
const vorher = wpBruecke.autostartAnfordern({
  key: BLEACH, room: RAUM, url: BLEACH + "/staffel-1/episode-5",
  season: 1, episode: 5, hostId: "rechner", playing: true
});
const zweiter = wpBruecke.autostartAnfordern({
  key: BLEACH, room: RAUM, url: BLEACH + "/staffel-1/episode-6",
  season: 1, episode: 6, hostId: "rechner", playing: true
});
pruefe("Ein erneuter Wechsel erhoeht die laufende Nummer",
  zweiter.generation === vorher.generation + 1,
  `${vorher.generation} -> ${zweiter.generation}`);
pruefe("Und nur der neueste Auftrag ist noch offen",
  wpBruecke.autostartSchritt({ room: RAUM, key: BLEACH, season: 1, episode: 6 })
    .auftrag === zweiter.auftrag,
  "der aeltere kann keine Folge mehr starten");

// Der Bericht des alten Auftrags kommt trotzdem noch an - er gehoert nicht
// hierher.
pruefe("Ein Bericht des alten Auftrags wird abgewiesen",
  wpBruecke.autostartBericht(
    wpBruecke.MELDE_START + JSON.stringify({ auftrag: ersterAuftrag.auftrag, ok: true })
  ).passt === false,
  "sonst meldete der Player der vorigen Folge diesen Auftrag als erledigt");

pruefe("Und alles, was kein Bericht ist, ist auch keiner",
  wpBruecke.autostartBericht("__elfix:wp:stand:{}") === null
    && wpBruecke.autostartBericht("egal") === null);

// Der eigene Bericht beendet ihn.
const fertig = wpBruecke.autostartBericht(
  wpBruecke.MELDE_START + JSON.stringify({
    auftrag: zweiter.auftrag, ok: true, zustand: "laeuft", stelle: 17.4
  }));
pruefe("Der eigene Bericht schliesst den Auftrag ab",
  fertig.passt === true && fertig.fertig === true && fertig.zustand === "laeuft"
    && fertig.stelle === 17.4,
  JSON.stringify(fertig));
pruefe("Danach wird nicht weiter angeklopft",
  wpBruecke.autostartSchritt({ room: RAUM, key: BLEACH, season: 1, episode: 6 }).tun === "aufgeben",
  "kein sekuendliches Nachklopfen nach einem gelungenen Start");

// Mehrere Titel im selben Raum: ein Auftrag fuer Korra geht Bleach nichts an.
const korraAuftrag = wpBruecke.autostartAnfordern({
  key: KORRA, room: RAUM, url: KORRA + "/staffel-2/episode-3",
  season: 2, episode: 3, hostId: "rechner", playing: true
});
pruefe("Ein Raum traegt mehrere Titel, jeder mit eigener laufender Nummer",
  korraAuftrag.generation === 1 && korraAuftrag.auftrag.includes(KORRA),
  korraAuftrag.auftrag);
pruefe("Und Bleach loest den Auftrag von Korra nicht aus",
  wpBruecke.autostartSchritt({ room: RAUM, key: BLEACH, season: 1, episode: 6 }).tun !== "anfordern",
  "ein Ereignis eines anderen Titels darf keinen Folgen-Autostart ausloesen");
pruefe("Korra selbst schon",
  wpBruecke.autostartSchritt({ room: RAUM, key: KORRA, season: 2, episode: 3 }).tun === "anfordern");

// Verwerfen - aber nicht das, was der Auftrag selbst ausgeloest hat.
//
// Aus der Watchparty-Seite heraus geoeffnet meldet das Seitenende einen
// "eigenen Folgenwechsel" auf genau die Folge, fuer die der Auftrag gilt.
// Verwarf das den Auftrag, war der Start weg, eine Sekunde nachdem er
// angefordert wurde - so gemessen am 25.08.2026 auf dem Telefon.
pruefe("Ein Wechsel auf genau die Folge des Auftrags verwirft ihn nicht",
  wpBruecke.autostartVerwerfen({ room: RAUM, key: KORRA, season: 2, episode: 3 }) === false
    && wpBruecke.autostartSchritt({ room: RAUM, key: KORRA, season: 2, episode: 3 }).tun !== "aufgeben",
  "sonst loescht der Weg zum Ziel den Auftrag, der dorthin fuehren sollte");
pruefe("Ein Wechsel woandershin schon",
  wpBruecke.autostartVerwerfen({ room: RAUM, key: BLEACH, season: 1, episode: 1 }) === true);
pruefe("Und ohne Lage wird immer verworfen",
  wpBruecke.autostartAnfordern({
    key: KORRA, room: RAUM, url: KORRA + "/staffel-2/episode-3",
    season: 2, episode: 3, hostId: "rechner", playing: true
  }) !== null
    && wpBruecke.autostartVerwerfen() === true
    && wpBruecke.autostartSchritt({ room: RAUM, key: KORRA, season: 2, episode: 3 }).tun === "aufgeben");

// Der eingehende Befehl der Runde traegt den Start.
{
  wpBruecke.autostartAnfordern({
    key: BLEACH, room: RAUM, url: BLEACH + "/staffel-1/episode-5",
    season: 1, episode: 5, hostId: "rechner", playing: true
  });
  const jetzt = Date.now();
  const nachricht = {
    type: "control", action: "play", key: BLEACH, room: RAUM,
    position: 12, videoTime: 12, timestamp: jetzt - 5000, at: jetzt - 5000,
    playing: true, resync: true, sequenceId: 7, episodeId: "s1e5", hostId: "rechner"
  };
  const urteil = wpBruecke.steuerungPruefen(nachricht,
    { binHost: false, hostId: "rechner", gleicheAdresse: true, season: 1, episode: 5 });
  pruefe("Steht ein Auftrag offen, traegt der Befehl der Runde den Autostart",
    urteil.tun === "autostart" && urteil.skript.length > 0
      && urteil.skript.includes("__elfix:wp:start:"),
    urteil.tun);
  pruefe("Und das Skript kennt den Auftrag, zu dem es gehoert",
    urteil.skript.includes(urteil.auftrag), urteil.auftrag);

  // Solange dieser Versuch laeuft, schiesst kein zweiter hinterher.
  pruefe("Ein laufender Versuch wird nicht ueberholt",
    wpBruecke.autostartSchritt({ room: RAUM, key: BLEACH, season: 1, episode: 5 }).tun === "warten",
    "zwei gleichzeitige Anlaeufe pausieren einander zuverlaessig");

  // Ein Befehl fuer Korra darf denselben Auftrag nicht anfassen.
  const fremd = wpBruecke.steuerungPruefen(
    { ...nachricht, key: KORRA, sequenceId: 8 },
    { binHost: false, hostId: "rechner", gleicheAdresse: true, season: 1, episode: 5 });
  pruefe("Ein Befehl eines anderen Titels loest den Autostart nicht aus",
    fremd.tun !== "autostart", fremd.tun);
  wpBruecke.autostartVerwerfen();
}

// --- Der oertliche Start: "Weiterschauen" ohne Runde -------------------------
//
// Der gemeldete Fehler war: ein Tipp auf Weiterschauen oeffnete das Vollbild,
// und darin stand ein Player, der nie eine Quelle bekommen hatte. Die Kette
// endete dort mit Absicht ("The chain stops here, with the player up in
// fullscreen and paused") - was fehlte, war der Ablauf, der einen VOE-Player
// wirklich startet. Den gibt es seit dem Folgen-Autostart; er hing nur an
// einer Runde. Hier wird geprueft, dass er auch ohne eine gilt.
{
  wpBruecke.autostartVerwerfen();
  const FOLGE = BLEACH + "/staffel-3/episode-2";
  const auftrag = wpBruecke.autostartAnfordern({
    oertlich: true, url: FOLGE, stelle: 312.5, season: 3, episode: 2
  });
  pruefe("Ein oertlicher Auftrag braucht weder Raum noch Titelschluessel",
    Boolean(auftrag) && auftrag.oertlich === true && auftrag.auftrag.startsWith("|"),
    auftrag && auftrag.auftrag);

  const schritt = wpBruecke.autostartSchritt({ url: FOLGE, season: 3, episode: 2 });
  pruefe("Er wartet auf niemanden - der Stand steht schon im Auftrag",
    schritt.tun === "starten" && schritt.skript.length > 0,
    schritt.tun);
  pruefe("Und das Skript springt auf den gespeicherten Stand",
    schritt.skript.includes("312.5"),
    "sonst faengt Weiterschauen wieder bei null an");
  pruefe("Es klickt die Ueberlagerung des Hosters",
    schritt.skript.includes("jw-icon-display"),
    "ohne diesen Klick hat das <video> keine Quelle und play() laeuft ins Leere");
  pruefe("Und es berichtet, ob wirklich etwas laeuft",
    schritt.skript.includes("__elfix:wp:start:") && schritt.skript.includes("laeuft"),
    "erst dieser Bericht darf das Vollbild ausloesen");

  // Steht eine andere Serie offen, gilt der Auftrag nicht mehr.
  pruefe("Fuer eine andere Serie gilt er nicht",
    wpBruecke.autostartSchritt({ url: KORRA + "/staffel-3/episode-2" }).tun === "warten",
    "der Auftrag gehoert zu seiner Serienadresse");

  // Der Bericht schliesst ihn ab - und zwar nur der eigene.
  pruefe("Ein fremder Bericht schliesst ihn nicht ab",
    wpBruecke.autostartBericht(
      wpBruecke.MELDE_START + JSON.stringify({ auftrag: "irgendwas", ok: true })).passt === false);
  const fertig = wpBruecke.autostartBericht(
    wpBruecke.MELDE_START + JSON.stringify({
      auftrag: auftrag.auftrag, ok: true, zustand: "laeuft", stelle: 313.1
    }));
  pruefe("Der eigene Bericht schliesst ihn ab",
    fertig.passt === true && fertig.fertig === true && fertig.zustand === "laeuft",
    JSON.stringify(fertig));
  pruefe("Danach klopft nichts mehr an",
    wpBruecke.autostartSchritt({ url: FOLGE, season: 3, episode: 2 }).tun === "aufgeben");

  // Ohne gespeicherten Stand faengt er vorn an - und springt nicht irgendwohin.
  wpBruecke.autostartVerwerfen();
  wpBruecke.autostartAnfordern({ oertlich: true, url: FOLGE, stelle: 0, season: 3, episode: 2 });
  const ohneStand = wpBruecke.autostartSchritt({ url: FOLGE, season: 3, episode: 2 });
  pruefe("Ohne gespeicherten Stand faengt er bei null an",
    ohneStand.tun === "starten" && ohneStand.skript.includes('"videoTime":0'),
    "ein Eintrag ohne Fortschritt darf nicht irgendwohin springen");
  wpBruecke.autostartVerwerfen();

  // Und die Runde hat Vorrang: laeuft dort ein Auftrag, gehoert ihm der Player.
  wpBruecke.autostartAnfordern({
    key: BLEACH, room: RAUM, url: BLEACH + "/staffel-1/episode-5",
    season: 1, episode: 5, hostId: "rechner", playing: true
  });
  pruefe("Ein Auftrag der Runde bleibt ein Auftrag der Runde",
    wpBruecke.autostartSchritt({ room: RAUM, key: BLEACH, season: 1, episode: 5 }).tun === "anfordern",
    "er holt den Stand des Hosts - das ist die genauere Antwort");
  wpBruecke.autostartVerwerfen();
}

// --- Die Bedienelemente des Players ------------------------------------------
//
// Die Teilnehmerleiste im Vollbild haengt daran: sie soll mit ihnen kommen und
// mit ihnen gehen. Gelesen wird die Meldung im Kern, damit Java nicht selbst
// an einer Zeichenkette herumschneidet.
{
  pruefe("Eine Sichtbarkeitsmeldung wird gelesen",
    wpBruecke.uiLesen(wpBruecke.MELDE_UI + "1").sichtbar === true
      && wpBruecke.uiLesen(wpBruecke.MELDE_UI + "0").sichtbar === false);
  pruefe("Und alles andere ist keine",
    wpBruecke.uiLesen("__elfix:wp:stand:12.00:0") === null
      && wpBruecke.uiLesen("__elfix:wp:ui:ja") === null,
    "eine unlesbare Zeile darf die Leiste nicht wegnehmen");
  const horcher = wpBruecke.beobachterSkript();
  pruefe("Der Horcher misst die Leiste des Players und nicht ihren Rahmen",
    horcher.includes("jw-controlbar") && horcher.includes("vjs-control-bar")
      && horcher.includes("sichtbarerKnoten") && !horcher.includes('".jw-controls",'),
    "gemessen am 25.08.2026: .jw-controls bleibt deckend, .jw-controlbar wird "
    + "auf Deckkraft 0 gesetzt - wer den Rahmen misst, meldet immer 'sichtbar'");
  pruefe("Und er sieht sich alle Leisten an, nicht nur die erste",
    horcher.includes("gefunden.some(sichtbarerKnoten)"),
    "die Seite traegt eine fremde, dauerhaft unsichtbare Leiste - "
    + "wer bei der stehen bleibt, meldet dauernd 'ausgeblendet'");
  pruefe("Und hat einen Rueckfall ueber die Regung",
    horcher.includes("letzteRegung") && horcher.includes("__elfixWpRegung"),
    "fuer Player, deren Leiste sich nicht finden laesst");
  pruefe("Gemeldet wird nur die Aenderung",
    horcher.includes("if (jetzt === uiGemeldet) return;"),
    "sonst laeuft im Ruhezustand ein Strom von Meldungen");
}

// Die Serveradresse geht durch dieselbe Pruefung wie am Rechner.
{
  const wp = require("../src/watchparty");
  pruefe("Die Bruecke reicht die Adressenpruefung des Rechners durch",
    wpBruecke.serverNormalisieren("  https://relay.example.org/  ") === "https://relay.example.org"
      && wpBruecke.serverNormalisieren === wp.serverNormalisieren
      && wpBruecke.serverBeanstandung === wp.serverBeanstandung,
    "eine zweite Auslegung derselben Adresse waere die naechste Fehlerquelle");
}

// --- Fassung merken -----------------------------------------------------------

const fassungBruecke = brueckeLaden("fassung-bruecke");
const taste = require("../src/taste");

pruefe("Die Bruecke laedt nur Module, die auch mitkopiert werden",
  typeof fassungBruecke.skript === "function",
  "sonst haette brueckeLaden oben geworfen");

// Der Anbieter und ein Eintrag, wie sie auf dem Geraet vorliegen.
const anbieter = { id: "aniworld", name: "AniWorld", startUrl: "https://aniworld.to/" };
const FOLGE1 = "https://aniworld.to/anime/stream/dandadan/staffel-1/episode-1";
const FOLGE2 = "https://aniworld.to/anime/stream/dandadan/staffel-1/episode-2";
const eintraege = [{ id: "a1", providerId: "aniworld", url: FOLGE1, title: "Dandadan" }];

// Der Schluessel: derselbe wie am Rechner. main.js bildet ihn in
// fassungSchluesselFuer() aus dem Titel des gefundenen Eintrags - ohne
// Staffel, weil die Sprache einer Serie sich ueber Staffeln nicht aendert.
pruefe("Derselbe Schluessel wie am Rechner: der Titel, ohne Staffel",
  fassungBruecke.skript(eintraege, anbieter, FOLGE1).schluessel === taste.titelSchluessel("Dandadan"),
  "ein anders gebildeter Schluessel macht den Geraeteabgleich still wirkungslos");
pruefe("Und main.js bildet ihn wirklich so",
  /function fassungSchluesselFuer[\s\S]*?return taste\.titelSchluessel\(/.test(MAIN)
  && !/function fassungSchluesselFuer[\s\S]{0,400}?marken\.schluessel/.test(MAIN),
  "ohne Staffel - anders als bei den Intromarken");
pruefe("Staffel 2 landet unter demselben Schluessel",
  fassungBruecke.skript(eintraege, anbieter,
    "https://aniworld.to/anime/stream/dandadan/staffel-2/episode-1").schluessel
  === fassungBruecke.skript(eintraege, anbieter, FOLGE1).schluessel);
pruefe("Eine Seite ohne Folge hat keinen Schluessel",
  fassungBruecke.skript(eintraege, anbieter, "https://aniworld.to/animes").schluessel === "",
  "auf der Uebersicht gibt es keine Fassung zu waehlen");

// Ohne gemerkte Fassung wird trotzdem eingespielt - nur ohne Sperre.
const frisch = fassungBruecke.skript(eintraege, anbieter, FOLGE1);
pruefe("Ohne gemerkte Fassung laeuft das Skript, aber der Autostart wartet nicht",
  frisch.skript.length > 0 && frisch.wartet === false,
  "es gibt nichts umzustellen, also gibt es nichts zu verzoegern");

// Die Vorgabe des Anbieters beim Laden.
const stand = fassungBruecke.meldung(eintraege, anbieter, FOLGE1,
  "__elfix:fassung:stand:1:german");
pruefe("Die Vorgabe beim Laden wird gemerkt", stand && stand.name === "Deutsch");
pruefe("Sie sagt nichts an",
  stand && stand.ansage === "",
  "die Folge laeuft ja genau so, wie sie dasteht");

// Eine zweite Vorgabe darf die erste nicht ueberschreiben.
const nochmal = fassungBruecke.meldung(eintraege, anbieter, FOLGE2,
  "__elfix:fassung:stand:2:japanese-german");
pruefe("Eine weitere Vorgabe ueberschreibt nichts",
  nochmal === null,
  "sonst haette die Vorwahl sich nach der ersten Folge selbst wieder abgewaehlt");

// Ein echter Klick zaehlt.
const wahl = fassungBruecke.meldung(eintraege, anbieter, FOLGE1,
  "__elfix:fassung:wahl:2:japanese-german");
pruefe("Ein Klick gilt immer",
  wahl && wahl.name === "Japanisch, Deutsche Untertitel");
pruefe("Und wird angesagt",
  wahl && wahl.ansage.includes("ab der nächsten Folge"),
  "ein Wechsel ist eine Entscheidung, von der man wissen will, dass sie ankam");

// Ab jetzt wartet der Autostart.
const gemerkt = fassungBruecke.skript(eintraege, anbieter, FOLGE2);
pruefe("Jetzt wartet der Autostart auf die Umschaltung",
  gemerkt.wartet === true && gemerkt.name === "Japanisch, Deutsche Untertitel",
  "die Anbieterseite zeigt nur die Hoster der gewaehlten Fassung");

// Die Auskunft fuer die Einstellungen.
const bericht = fassungBruecke.stand();
pruefe("Die Auskunft nennt Titel und Fassungen",
  bericht.titel === 1 && bericht.fassungen[0].name === "Japanisch, Deutsche Untertitel");
pruefe("Es gibt einen Weg zurueck",
  fassungBruecke.vergessen() === 1 && fassungBruecke.stand().titel === 0);

// Was aus der Datei kommt, kommt unveraendert an.
pruefe("Ein geladener Bestand wird uebernommen",
  fassungBruecke.laden({ dandadan: { key: "2", roh: "japanese-german", name: "Japanisch, Deutsche Untertitel", at: 1 } }) === 1
  && fassungBruecke.stand().titel === 1,
  "dasselbe Format wie fassungen.json am Rechner");

// --- Intro ueberspringen ------------------------------------------------------

const markenBruecke = brueckeLaden("marken-bruecke");
const marken = require("../src/marken");

// Der Schluessel traegt hier die Staffel - anders als bei der Fassung. Ein
// Intro kann ab Staffel 2 ein anderes sein.
pruefe("Der Markenschluessel traegt die Staffel",
  markenBruecke.skript(eintraege, anbieter, FOLGE1, true).schluessel
  === marken.schluessel(taste.titelSchluessel("Dandadan"), 1));
pruefe("Staffel 2 landet unter einem anderen Schluessel",
  markenBruecke.skript(eintraege, anbieter,
    "https://aniworld.to/anime/stream/dandadan/staffel-2/episode-1", true).schluessel
  !== markenBruecke.skript(eintraege, anbieter, FOLGE1, true).schluessel,
  "sonst traegt die zweite Staffel das Intro der ersten");
pruefe("Und main.js bildet ihn wirklich so",
  MAIN.includes("function markenSchluesselFuer")
  && MAIN.includes("return marken.schluessel(titel, identity.season);"),
  "mit Staffel - anders als bei der Fassung");

// Ein einzelner Sprung ergibt noch keine Marke.
const ersterSprung = markenBruecke.sprung(eintraege, anbieter, FOLGE1, 30, 120);
pruefe("Ein Sprung wird aufgenommen", ersterSprung !== null);
pruefe("Aber ergibt noch keine Marke",
  ersterSprung.marke === null && ersterSprung.ansage === "",
  "ein einzelner Sprung ist kein Intro, sondern ein Sprung");

// Derselbe Sprung in einer anderen Folge macht daraus eine Marke.
const zweiterSprung = markenBruecke.sprung(eintraege, anbieter, FOLGE2, 31, 121);
pruefe("Zwei uebereinstimmende Spruenge in zwei Folgen ergeben eine Marke",
  zweiterSprung && zweiterSprung.marke && zweiterSprung.marke.belege === 2);
pruefe("Und das wird einmal angesagt",
  zweiterSprung.ansage.includes("Intro gemerkt"));

// Ab jetzt traegt das Skript die Marke.
const mitMarke = markenBruecke.skript(eintraege, anbieter, FOLGE1, true);
pruefe("Das Skript bekommt die Marke mit",
  mitMarke.marke && mitMarke.marke.belege === 2 && mitMarke.skript.length > 0);
pruefe("Waehrend einer Watchparty wird nicht gelernt",
  markenBruecke.skript(eintraege, anbieter, FOLGE1, false).skript
  !== markenBruecke.skript(eintraege, anbieter, FOLGE1, true).skript,
  "der Player wird dort auf den Host gezogen - das sind nicht die eigenen Spruenge");

pruefe("Die Meldung aus der Seite wird gelesen",
  JSON.stringify(markenBruecke.sprungLesen("__elfix:sprung:30:120")) === JSON.stringify({ von: 30, nach: 120 }));
pruefe("Eine fremde Zeile nicht",
  markenBruecke.sprungLesen("irgendwas") === null);

pruefe("Die Auskunft zaehlt Staffeln und Marken",
  markenBruecke.stand().titel === 1 && markenBruecke.stand().marken === 1);
pruefe("Es gibt einen Weg zurueck",
  markenBruecke.vergessen() === 1 && markenBruecke.stand().titel === 0);

// --- Empfehlungen -------------------------------------------------------------
//
// Diese Bruecke ist die groesste der sechs, weil hinter ihr der ganze
// Empfehlungslauf haengt. Geprueft wird deshalb nicht nur, dass sie laedt,
// sondern der ganze Weg, den Android geht: Cache von einer abgefangenen Adresse
// lesen, rechnen, und den Cache in Stuecken wieder nach Java schicken.
//
// Der Umweg ueber Stuecke ist der Punkt. Die Bruecke zwischen JavaScript und
// Java traegt jeden Wert als eine einzige Zeichenkette, und ein
// Geschmacks-Cache mit mehreren tausend Katalogtiteln wird megabytegross. Geht
// dabei etwas verloren, faellt das nicht beim Schreiben auf, sondern erst beim
// naechsten Start - an einer halben Datei.

const WIRT = "https://anbieter.test";
const EMPF_ANBIETER = [{ id: "test", name: "Testanbieter", startUrl: WIRT + "/", enabled: true }];

function empfKachel(nummer) {
  return `<a href="${WIRT}/anime/stream/titel-${nummer}" title="Titel ${nummer}">`
    + `<img src="${WIRT}/bild/titel-${nummer}.jpg" alt="Titel ${nummer}"></a>`;
}

function empfSeite(adresse) {
  const url = new URL(adresse);
  if (url.pathname === "/") {
    const kacheln = [];
    for (let i = 1; i <= 12; i += 1) kacheln.push(empfKachel(i));
    return `<h2>Neue Animes</h2>${kacheln.join("")}`;
  }
  if (/^\/genre\//.test(url.pathname)) {
    const kacheln = [];
    for (let i = 0; i < 20; i += 1) kacheln.push(empfKachel(500 + i));
    return `<nav><a href="?page=2">2</a><a href="?page=4">4</a></nav>${kacheln.join("")}`;
  }
  const treffer = url.pathname.match(/titel-(\d+)$/);
  if (!treffer) return null;
  const nummer = Number(treffer[1]);
  const genres = ["action", "fantasy", "drama"]
    .map((name) => `<a href="${WIRT}/genre/${name}">${name}</a>`).join(" ");
  return `<h1>Titel ${nummer}</h1>${genres}`
    + `<h2>Das schauen andere</h2>${empfKachel(nummer + 200)}${empfKachel(nummer + 201)}`;
}

/**
 * Die Bruecke laden - mit allem, was sie im WebView vorfindet.
 *
 * Der Unterschied zu {@link brueckeLaden}: hier gibt es `fetch`, `setTimeout`,
 * `URL` und die beiden Java-Bruecken. Genau das steht im Kern-WebView zur
 * Verfuegung, und was hier fehlt, fehlt dort auch.
 */
function empfehlungsBrueckeLaden() {
  const quelle = fs.readFileSync(path.join(BRUECKEN, "empfehlung-bruecke.js"), "utf8");
  const modul = { exports: {} };
  const lader = (gesucht) => {
    if (!KERN_MODULE.has(gesucht)) {
      throw new Error(`"${gesucht}" steht nicht in kernModule und faehrt nicht mit`);
    }
    const unter = fs.existsSync(path.join(WURZEL, "src", `${gesucht}.js`)) ? "src" : "shared";
    return require(path.join(WURZEL, unter, `${gesucht}.js`));
  };

  // Was Java zu sehen bekommt: die Stuecke, in denen der Cache zurueckkommt.
  const lager = { stuecke: {}, fertig: {} };
  const gelegt = {};
  const AndroidEmpfehlung = {
    teil(art, nummer, text) {
      if (nummer === 0) lager.stuecke[art] = [];
      lager.stuecke[art].push(text);
    },
    fertig(art, anzahl) {
      lager.fertig[art] = anzahl;
    }
  };

  const fenster = {
    AndroidEmpfehlung,
    AndroidKern: { protokoll: () => {} },
    ElfixKern: {
      ereignis: () => {},
      // Das Gegenstueck zu Kern.zwischenAusliefern: eine Adresse, die nie ins
      // Netz geht, sondern eine Datei von der Platte liefert.
      browserAbruf: async (adresse) => {
        const name = String(adresse).replace("https://elfix.dateien/", "");
        if (!Object.prototype.hasOwnProperty.call(gelegt, name)) {
          return { ok: false, status: 404, text: async () => "" };
        }
        return { ok: true, status: 200, text: async () => gelegt[name] };
      }
    }
  };

  vm.runInNewContext(quelle, {
    require: lader,
    module: modul,
    exports: modul.exports,
    console,
    window: fenster,
    // Der Abruf der Anbieterseiten geht im Kern ueber Java - hier ueber
    // Papierseiten, damit die Pruefung ohne Netz laeuft.
    fetch: async (adresse) => {
      const html = empfSeite(adresse);
      if (html === null) return { ok: false, status: 404, url: adresse, text: async () => "" };
      return { ok: true, status: 200, url: adresse, text: async () => html };
    },
    setTimeout,
    clearTimeout,
    URL,
    TextEncoder,
    TextDecoder
  });
  return { bruecke: modul.exports, lager, gelegt };
}

(async () => {
  const { bruecke: empfehlung, lager, gelegt } = empfehlungsBrueckeLaden();

  pruefe("Die Empfehlungsbruecke laedt nur mitkopierte Module",
    typeof empfehlung.starten === "function",
    "sonst haette der Lader oben geworfen");
  pruefe("Vor dem Start beantwortet sie nichts",
    empfehlung.bereit() === false,
    "ohne Cache wuerde der erste Abruf zwei Dutzend Seiten holen, die schon dastehen");

  const stand = await empfehlung.starten({
    geschmackUrl: "https://elfix.dateien/geschmack.json",
    metadatenUrl: "https://elfix.dateien/metadaten.json",
    relay: "",
    grenzen: { poolGroesse: 60, listenGroesse: 80, genreKandidaten: 100 }
  });
  pruefe("Ohne Cache faengt sie leer an", stand.seiten === 0 && stand.listen === 0,
    "das ist der erste Start und kein Fehler");
  pruefe("Und ist danach bereit", empfehlung.bereit() === true);

  const ablage = [1, 2, 3].map((nummer) => ({
    id: "f" + nummer,
    providerId: "test",
    providerName: "Testanbieter",
    url: `${WIRT}/anime/stream/titel-${nummer}`,
    title: "Titel " + nummer,
    type: "serie",
    watched: true,
    completed: true,
    progress: 100,
    lastWatchedAt: new Date().toISOString()
  }));
  const gemeldet = empfehlung.standSetzen(EMPF_ANBIETER, ablage);
  pruefe("Anbieter und Ablage kommen an",
    gemeldet.anbieter === 1 && gemeldet.eintraege === 3);

  const neues = await empfehlung.neuesVonAnbietern(4, false);
  pruefe("Die Neuheiten-Reihe kommt zurueck", neues.length === 4, `${neues.length} Kacheln`);

  const persoenlich = await empfehlung.persoenlich(8, "", false, true);
  pruefe("Persoenliche Vorschlaege entstehen", persoenlich.length > 0,
    `${persoenlich.length} Titel`);
  pruefe("Und tragen ihren Grund mit",
    persoenlich.every((item) => item.grundText),
    (persoenlich[0] || {}).grundText || "");

  const seite = await empfehlung.entdeckungsSeite("anime", 0, 10, false);
  pruefe("Die Entdeckungsseite blaettert",
    Array.isArray(seite.items) && seite.items.length > 0,
    `${(seite.items || []).length} von ${seite.gesamt}`);

  // --- Der Rueckweg des Caches ------------------------------------------------
  //
  // Er ist verzoegert, damit ein Lauf mit vielen Seiten nicht dutzendfach
  // dieselbe Datei anfasst. Hier wird gewartet, statt die Verzoegerung
  // wegzudrehen: geprueft werden soll der Weg, den das Geraet wirklich geht.
  await new Promise((fertig) => setTimeout(fertig, 4500));
  pruefe("Der Cache geht in Stuecken nach Java",
    Array.isArray(lager.stuecke.geschmack) && lager.stuecke.geschmack.length > 0,
    `${(lager.stuecke.geschmack || []).length} Stueck(e)`);
  pruefe("Und Java erfaehrt, wie viele es waren",
    lager.fertig.geschmack === (lager.stuecke.geschmack || []).length,
    `${lager.fertig.geschmack}`);

  const zusammengesetzt = (lager.stuecke.geschmack || []).join("");
  let gelesen = null;
  try {
    gelesen = JSON.parse(zusammengesetzt);
  } catch (fehler) {
    gelesen = null;
  }
  pruefe("Zusammengesetzt ergibt es wieder gueltiges JSON", gelesen !== null,
    `${zusammengesetzt.length} Zeichen`);
  pruefe("Mit den gelesenen Detailseiten darin",
    gelesen && Object.keys(gelesen.pages || {}).length > 0,
    gelesen ? `${Object.keys(gelesen.pages || {}).length} Seiten` : "");

  // --- Und wieder herein ------------------------------------------------------
  //
  // Der eigentliche Zweck des ganzen Umwegs: beim naechsten Start liegt der
  // Cache da und der Lauf faengt nicht bei null an.
  gelegt["geschmack.json"] = zusammengesetzt;
  const { bruecke: zweite } = empfehlungsBrueckeLaden();
  // Der zweite Lauf liest dieselbe Datei - dafuer muss sie im neuen Lader
  // liegen, nicht im alten.
  const zweiterStand = await (async () => {
    const eigen = empfehlungsBrueckeLaden();
    eigen.gelegt["geschmack.json"] = zusammengesetzt;
    return eigen.bruecke.starten({
      geschmackUrl: "https://elfix.dateien/geschmack.json",
      metadatenUrl: "https://elfix.dateien/metadaten.json",
      relay: ""
    });
  })();
  pruefe("Beim naechsten Start steht der Cache wieder da",
    zweiterStand.seiten > 0,
    `${zweiterStand.seiten} Seiten, ${zweiterStand.listen} Listen`);
  pruefe("Die zweite Bruecke ist eine eigene",
    zweite.bereit() === false,
    "zwei Instanzen teilen ihren Zustand nicht");

  const fehler = pruefungen.filter((ok) => !ok).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  process.exit(fehler ? 1 : 0);
})().catch((fehler) => {
  console.log("FAIL  Empfehlungsbruecke abgebrochen   -> " + (fehler && fehler.stack || fehler));
  process.exit(1);
});
