"use strict";

// Die Hoster- und Fassungswahl ist eine Quellenentscheidung: privat darf sie
// jeder treffen, in einer Watchparty nur der Host. Die Sperre muss im
// Hauptprozess vor jedem Seiteneffekt greifen, weil eine deaktivierte
// Oberflaeche allein keinen IPC-Aufruf verhindert.

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");

function funktion(name) {
  const start = main.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} fehlt`);
  return main.slice(start, main.indexOf("\n}", start) + 2);
}

// Zuerst die eine Autoritaetsregel selbst. Ein privater Player bleibt frei;
// der Host darf jede angebotene Sprache und jeden Hoster waehlen; nur ein Gast
// in einer laufenden Runde wird gesperrt.
for (const [name, stand, erwartet] of [
  ["privat", { inRunde: false, binHost: false }, true],
  ["Host", { inRunde: true, binHost: true }, true],
  ["Authentifiziert und noch ohne Host", { inRunde: true, binHost: false, quelleStartbar: true }, true],
  ["Gast", { inRunde: true, binHost: false }, false]
]) {
  const kontext = vm.createContext({ spielerRundenEinstellung: () => stand });
  vm.runInContext(funktion("spielerQuellenwechselErlaubt"), kontext);
  assert.equal(kontext.spielerQuellenwechselErlaubt(), erwartet, name);
}

// Eine einzelne Person braucht ihre Rollenmeldung genauso wie eine Gruppe.
// Nur der Renderer darf danach die optische Teilnehmerleiste ausblenden.
{
  const gesendet = [];
  const kontext = vm.createContext({
    spielerLauf: {}, spielerView: { webContents: {
      isDestroyed: () => false, send: (...args) => gesendet.push(args)
    } }, formatUhr: () => "0:00"
  });
  vm.runInContext(funktion("zeigeLeisteImPlayer"), kontext);
  kontext.zeigeLeisteImPlayer([{ name: "Ich", me: true, host: true, paused: true, position: 0, age: 0 }]);
  assert.equal(gesendet[0][0], "spieler:leiste");
  assert.equal(gesendet[0][1].length, 1, "Solo-Host wurde aus der Rechte-Meldung entfernt");
  assert.equal(gesendet[0][1][0].host, true);
}

for (const [name, eintrag, verbunden, startbar] of [
  ["Solo vor Playerstart", { joined: true, myId: "ich", hostId: "" }, true, true],
  ["Anderer Host", { joined: true, myId: "ich", hostId: "andere" }, true, false],
  ["Verbindung getrennt", { joined: true, myId: "ich", hostId: "" }, false, false],
  ["Nicht beigetreten", { joined: false, myId: "ich", hostId: "" }, true, false],
  ["Keine authentifizierte Kennung", { joined: true, myId: "", hostId: "" }, true, false]
]) {
  const kontext = vm.createContext({
    spielerRunde: () => ({ key: "serie", raum: "raum" }),
    watchpartyEintrag: () => eintrag,
    watchpartySync: { tempoLesen: () => 1 },
    watchparty: { status: () => ({ rooms: [{ room: "raum", connected: verbunden }] }) }
  });
  vm.runInContext(funktion("spielerRundenEinstellung"), kontext);
  assert.equal(kontext.spielerRundenEinstellung().quelleStartbar, startbar, name);
}

// Der ausdrueckliche Wechsel aus dem eigenen Player und ein empfangener
// Wechsel benutzen die unsichtbare Anbieteransicht nur als Werkbank. Deren
// did-navigate darf deshalb keine zweite navigate-Nachricht erzeugen.
async function pruefeFolgenwechselEcho() {
  const meldungen = [];
  const provider = { id: "aniworld" };
  const folge = (nummer) => `https://aniworld.to/anime/stream/bleach/staffel-1/episode-${nummer}`;
  const kontext = vm.createContext({
    watchpartyFolgenwechselStumm: new Map(),
    seiteGleich: (links, rechts) => links === rechts,
    meldeWatchpartyFolgenwechsel: (url) => { meldungen.push(url); }
  });
  vm.runInContext([
    funktion("meldeWatchpartyFolgenwechselAusNavigation"),
    funktion("ohneWatchpartyFolgenwechselEcho")
  ].join("\n"), kontext);

  const wert = await kontext.ohneWatchpartyFolgenwechselEcho(provider, folge(5), async () => {
    kontext.meldeWatchpartyFolgenwechselAusNavigation(provider, folge(5));
    return "geladen";
  });
  assert.equal(wert, "geladen");
  assert.deepEqual(meldungen, [], "Werkbank hat den Folgenwechsel doppelt gemeldet");
  kontext.meldeWatchpartyFolgenwechselAusNavigation(provider, folge(5));
  assert.deepEqual(meldungen, [folge(5)], "Sperre blieb nach dem Wechsel liegen");

  // Zwei Wechsel koennen vor dem ersten did-navigate eintreffen. Beide Ziele
  // bleiben stumm, bis genau ihr eigener Auftrag fertig ist; das neuere Ziel
  // darf die Sperre des aelteren nicht ersetzen.
  let endeSechs;
  let endeSieben;
  const sechs = kontext.ohneWatchpartyFolgenwechselEcho(provider, folge(6),
    () => new Promise((fertig) => { endeSechs = fertig; }));
  const sieben = kontext.ohneWatchpartyFolgenwechselEcho(provider, folge(7),
    () => new Promise((fertig) => { endeSieben = fertig; }));
  kontext.meldeWatchpartyFolgenwechselAusNavigation(provider, folge(6));
  kontext.meldeWatchpartyFolgenwechselAusNavigation(provider, folge(7));
  assert.deepEqual(meldungen, [folge(5)], "Ueberlappende Ziele wurden nicht beide stumm gehalten");
  endeSechs();
  await sechs;
  kontext.meldeWatchpartyFolgenwechselAusNavigation(provider, folge(6));
  kontext.meldeWatchpartyFolgenwechselAusNavigation(provider, folge(7));
  assert.deepEqual(meldungen, [folge(5), folge(6)], "Falscher ueberlappender Auftrag wurde geloescht");
  endeSieben();
  await sieben;

  // Derselbe Zielaufruf braucht eine echte Mehrfachzaehlung: beendet sich der
  // erste, muss der zweite die Navigation weiterhin stumm halten.
  let endeAchtA;
  let endeAchtB;
  const achtA = kontext.ohneWatchpartyFolgenwechselEcho(provider, folge(8),
    () => new Promise((fertig) => { endeAchtA = fertig; }));
  const achtB = kontext.ohneWatchpartyFolgenwechselEcho(provider, folge(8),
    () => new Promise((fertig) => { endeAchtB = fertig; }));
  endeAchtA();
  await achtA;
  kontext.meldeWatchpartyFolgenwechselAusNavigation(provider, folge(8));
  assert.deepEqual(meldungen, [folge(5), folge(6)], "Gleiches zweites Ziel verlor seine Sperre");
  endeAchtB();
  await achtB;
  kontext.meldeWatchpartyFolgenwechselAusNavigation(provider, folge(8));
  assert.deepEqual(meldungen, [folge(5), folge(6), folge(8)], "Gleiches Ziel blieb nach beiden Auftraegen stumm");

  await assert.rejects(
    kontext.ohneWatchpartyFolgenwechselEcho(provider, folge(9), async () => { throw new Error("Ladefehler"); }),
    /Ladefehler/
  );
  assert.equal(kontext.watchpartyFolgenwechselStumm.has(provider.id), false,
    "Fehlgeschlagener Auftrag blieb als Sperre liegen");
  kontext.meldeWatchpartyFolgenwechselAusNavigation(provider, folge(9));
  assert.deepEqual(meldungen, [folge(5), folge(6), folge(8), folge(9)]);
}

let hosterHandler;
let folgenHandler;
let gemerkt = 0;
let gemeldet = 0;
let gestartet = 0;
let folgenGestartet = 0;
let folgenGemeldet = 0;
let folgenOhneEcho = 0;
let erlaubt = false;
const gewaehlt = {
  adresse: "https://aniworld.to/redirect/voe-deutsch",
  hoster: "VOE",
  sprache: "1",
  spracheRoh: "Deutsch"
};
const sender = {};
const kontext = vm.createContext({
  ipcMain: {
    handle(kanal, handler) {
      if (kanal === "spieler:hoster") hosterHandler = handler;
      if (kanal === "spieler:wechseln") folgenHandler = handler;
    }
  },
  vomSpieler: () => true,
  spielerQuellenwechselErlaubt: () => erlaubt,
  spielerAnbieter: () => ({ id: "aniworld" }),
  spielerLauf: {
    url: "https://aniworld.to/anime/stream/bleach/staffel-1/episode-4",
    hosterliste: [gewaehlt]
  },
  fassungMelden: () => { gemerkt += 1; },
  meldeFassungInDieRunde: () => { gemeldet += 1; },
  direktFolgeSpielen: async () => { gestartet += 1; return { ok: true }; },
  meldeWatchpartyFolgenwechsel: () => { folgenGemeldet += 1; },
  ohneWatchpartyFolgenwechselEcho: async (_provider, _url, arbeit) => {
    folgenOhneEcho += 1;
    return arbeit();
  },
  sanitizePositiveNumber: (wert) => Math.max(0, Number(wert) || 0),
  absoluteHttpUrl: (url) => url,
  spielerRunde: () => null,
  providerModel: { isHttpUrl: () => true }
});

const hosterStart = main.indexOf('ipcMain.handle("spieler:hoster"');
const hosterEnd = main.indexOf('ipcMain.handle("direkt:beenden"', hosterStart);
vm.runInContext(main.slice(hosterStart, hosterEnd), kontext);

// Ein Gast wird abgewiesen, bevor Sprache, Rundenzustand oder Quelle veraendert
// werden. Damit kann auch ein von Hand ausgeloester IPC-Aufruf die UI-Sperre
// nicht umgehen.
(async () => {
  await pruefeFolgenwechselEcho();
  const abgewiesen = await hosterHandler({ sender }, gewaehlt.adresse, 123);
  assert.deepEqual({ ...abgewiesen }, {
    ok: false,
    grund: "Nur der Host kann Hoster und Fassung ändern",
    nichtHost: true
  });
  assert.deepEqual([gemerkt, gemeldet, gestartet], [0, 0, 0]);

  // Als Host bleibt dieselbe Auswahl ohne Sprachfilter erlaubt.
  erlaubt = true;
  const host = await hosterHandler({ sender }, gewaehlt.adresse, 123);
  assert.equal(host.ok, true);
  assert.deepEqual([gemerkt, gemeldet, gestartet], [1, 1, 1]);

  // Der Folgenwechsel ist absichtlich nicht Teil der Quellensperre: auch ein
  // Gast darf die naechste oder eine andere Folge auswaehlen.
  kontext.direktFolgeSpielen = async () => { folgenGestartet += 1; return { ok: true }; };
  const folgenStart = main.indexOf('ipcMain.handle("spieler:wechseln"');
  vm.runInContext(main.slice(folgenStart, hosterStart), kontext);
  erlaubt = false;
  const folge = await folgenHandler({ sender }, "https://aniworld.to/anime/stream/bleach/staffel-1/episode-5");
  assert.equal(folge.ok, true);
  assert.equal(folgenGestartet, 1);
  assert.equal(folgenGemeldet, 1);
  assert.equal(folgenOhneEcho, 1);

  // In einer Runde schickt auch der Gast nur den Wunsch an das Relay. Die
  // Quelle oeffnet sich erst nach dessen gemeinsamer Vorbereitung.
  const wuensche = [];
  kontext.spielerRunde = () => ({ key: "serie:bleach", raum: "probe" });
  kontext.taste = require("../src/taste");
  kontext.watchparty = {
    status: () => ({ rooms: [{ room: "probe", connected: true }] }),
    steuernMitAdresse: (...args) => wuensche.push(args)
  };
  const gemeinsam = await folgenHandler({ sender }, "https://aniworld.to/anime/stream/bleach/staffel-1/episode-5");
  assert.equal(gemeinsam.ok, true);
  assert.equal(gemeinsam.wartetAufRunde, true);
  assert.equal(folgenGestartet, 1, "Gast darf nicht vor dem Relay lokal laden/starten");
  assert.equal(wuensche.length, 1);
  assert.equal(wuensche[0][1], "navigate");
  assert.equal(wuensche[0][4], "probe");

  console.log("OK Watchparty-Quellenwahl: Host frei, Gast gesperrt, Folgenwechsel frei");
})().catch((fehler) => {
  console.error(fehler);
  process.exitCode = 1;
});
