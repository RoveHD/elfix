"use strict";

/*
 * Wer in eine laufende Runde hineingeht, fragt - er kuendigt nichts an.
 *
 * Gemeldet: ein Geraet tritt einer laufenden Watchparty bei, alle halten kurz
 * an, "damit synchronisiert werden kann" - und bleiben danach stehen. Jemand
 * muss von Hand wieder Play druecken.
 *
 * Der Weg dorthin ging ueber eine Verwechslung: der frisch geoeffnete Player
 * spielte von selbst los (das tut jeder Player), und dieses Losspielen ging als
 * `play` an die Runde. Fuer das Relay ist ein Play eine Absicht - es haelt
 * daraufhin alle an, verabredet einen gemeinsamen Start und wartet auf die
 * Bereitmeldungen. Ausgerechnet der Beitretende kann die nicht geben: seine
 * Quelle laedt gerade erst. Nach Ablauf der Frist stand die ganze Runde.
 *
 * Geprueft wird hier die Entscheidung im Hauptprozess: ein Player, der nicht
 * auf Ansage der Runde aufgeht, wartet und fragt nach dem autoritativen Stand.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const WURZEL = path.join(__dirname, "..");
const HAUPT = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").replace(/\r\n/g, "\n");

function funktion(name) {
  const start = HAUPT.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} nicht gefunden`);
  return HAUPT.slice(start, HAUPT.indexOf("\n}", start) + 2);
}

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}

const FOLGE = "https://aniworld.to/anime/stream/beitritt/staffel-1/episode-4";

function kontext({ live = true } = {}) {
  const abgleiche = [];
  const befehle = [];
  const fristen = [];
  const c = vm.createContext({
    console: { log() {} },
    Date, Boolean, Number, String, Math,
    // Die Frist wird hier von Hand ausgeloest, statt sechs Sekunden zu warten.
    setTimeout: (fn) => { fristen.push(fn); return { unref() {} }; },
    watchpartyLiveKeyForUrl: () => (live ? "serie:beitritt" : ""),
    watchpartyRaumForUrl: () => (live ? "wohnzimmer" : ""),
    watchparty: { abgleichen: (key, raum) => abgleiche.push({ key, raum }) },
    spielerTakt: { stelle: 128.5 },
    spielerBefehl: (befehl) => { befehle.push(befehl); c.spielerRundenUebernahme = null; return true; },
    wpLog: () => {},
    spielerRundenUebernahme: null,
    spielerLauf: null,
    RUNDE_UEBERNAHME_FRIST_MS: 6000
  });
  vm.runInContext(funktion("watchpartyZustandUebernehmen"), c);
  return { c, abgleiche, befehle, fristen };
}

/* --- 1. Der eigene Einstieg fragt die Runde ------------------------------- */
{
  const { c, abgleiche, befehle, fristen } = kontext();
  c.spielerLauf = { id: 7, url: FOLGE, rundeUebernehmen: true, rundeWarten: true };
  const gefragt = c.watchpartyZustandUebernehmen(FOLGE);
  pruefe("Der Beitritt fragt nach dem Stand der Runde",
    gefragt === true && abgleiche.length === 1 && abgleiche[0].raum === "wohnzimmer",
    JSON.stringify(abgleiche));
  pruefe("Und kuendigt dabei selbst nichts an",
    !befehle.some((befehl) => befehl.laufen === true), JSON.stringify(befehle));

  // Die Antwort der Runde kommt: sie ist ein Befehl an den Player, und damit
  // ist das Warten beendet. Die Frist darf danach nichts mehr tun.
  c.spielerBefehl({ tun: "stelle", stelle: 128.5, laufen: true, springen: true });
  befehle.length = 0;
  fristen.forEach((fn) => fn());
  pruefe("Nach der Antwort der Runde greift die Frist nicht mehr",
    befehle.length === 0, JSON.stringify(befehle));
}

/* --- 2. Ohne Antwort endet das Warten trotzdem ---------------------------- */
{
  const { c, befehle, fristen } = kontext();
  c.spielerLauf = { id: 8, url: FOLGE, rundeUebernehmen: true, rundeWarten: true };
  c.watchpartyZustandUebernehmen(FOLGE);
  fristen.forEach((fn) => fn());
  pruefe("Ohne Antwort wird der Player freigegeben",
    befehle.length === 1 && befehle[0].laufen === false && !befehle[0].bereitId,
    JSON.stringify(befehle));
  pruefe("Und zwar dort, wo er steht - kein Start auf Verdacht",
    befehle[0].stelle === 128.5 && befehle[0].springen === false);
}

/* --- 3. Auf Ansage der Runde wird nicht gefragt --------------------------- */
{
  const { c, abgleiche, fristen } = kontext();
  // Der Folgenwechsel und die Warteschlange oeffnen den Player selbst mit
  // `rundeWarten` - ihr Zustand kommt aus der Schranke und nicht aus einer
  // Nachfrage. Zweimal fragen hiesse: zwei Antworten auf denselben Player.
  c.spielerLauf = { id: 9, url: FOLGE, rundeUebernehmen: false, rundeWarten: true };
  const gefragt = c.watchpartyZustandUebernehmen(FOLGE);
  pruefe("Ein Player auf Ansage der Runde fragt nicht nach",
    gefragt === false && abgleiche.length === 0 && fristen.length === 0);
}

/* --- 4. Ohne laufende Runde bleibt alles, wie es war ---------------------- */
{
  const { c, abgleiche, befehle } = kontext({ live: false });
  c.spielerLauf = { id: 10, url: FOLGE, rundeUebernehmen: true, rundeWarten: true };
  const gefragt = c.watchpartyZustandUebernehmen(FOLGE);
  pruefe("Ohne Runde gibt es nichts zu uebernehmen",
    gefragt === false && abgleiche.length === 0 && befehle.length === 0);
}

/* --- 5. Ein neuer Auftrag laesst die alte Frist ins Leere laufen ---------- */
{
  const { c, befehle, fristen } = kontext();
  c.spielerLauf = { id: 11, url: FOLGE, rundeUebernehmen: true, rundeWarten: true };
  c.watchpartyZustandUebernehmen(FOLGE);
  // Inzwischen laeuft laengst ein anderer Auftrag - der Hosterwechsel, die
  // naechste Folge, ein zweiter Einstieg. Die Frist des alten darf ihm nichts
  // mehr schicken.
  c.spielerLauf = { id: 12, url: FOLGE, rundeUebernehmen: true, rundeWarten: true };
  fristen.forEach((fn) => fn());
  pruefe("Die Frist eines ueberholten Auftrags bleibt wirkungslos",
    befehle.length === 0, JSON.stringify(befehle));
}

/* --- 6. Und die Verdrahtung: Uebernahme heisst warten --------------------- */
{
  const quelle = HAUPT.slice(HAUPT.indexOf("function spielerLaufSetzen("));
  const rumpf = quelle.slice(0, quelle.indexOf("\n}") + 2);
  pruefe("Ein uebernehmender Auftrag wartet auf die Runde",
    /rundeWarten:\s*Boolean\(optionen\.rundeWarten\s*\|\|\s*optionen\.rundeUebernehmen\)/.test(rumpf),
    "sonst spielte der Player los und meldete es als Play an die Runde");
}

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`${pruefungen.length - fehler}/${pruefungen.length} bestanden `
  + "(Beitritt: der eigene Einstieg fragt die Runde, statt sie anzuhalten)");
if (fehler) process.exitCode = 1;
