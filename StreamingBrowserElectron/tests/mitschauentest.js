"use strict";
// Mitschauen: Rechner gegen Android, an einem echten Relay.
//
// `synctest.js` prueft das Protokoll mit zwei nachgebauten Fassaden. Hier steht
// auf der einen Seite die Watchparty des Rechners und auf der anderen die
// *echte* Android-Bruecke - dieselbe Datei, die im Paket der App liegt, mit
// derselben Verbindung, die sie im WebView haette.
//
// Geprueft wird damit nicht, ob das Relay funktioniert, sondern ob Android es
// richtig bedient. Was hier schiefgehen kann und nirgends sonst auffiele:
//
//   - Android sendet gar keinen Steuerbefehl. Genau das war der Zustand vor
//     diesem Umbau: die Watchparty lief als Fortschrittsabgleich, und Pause
//     drueckte man allein.
//   - Android wendet ein empfangenes Pause an, meldet es zurueck, der Rechner
//     wendet es an, meldet es zurueck - die Schleife.
//   - Nach einem Folgenwechsel weist die Veraltungspruefung jeden Befehl der
//     neuen Folge ab, weil die laufende Nummer kleiner ist als die gemerkte.
//   - Ein Geraet, das die Folge verlaesst, bleibt Host.
//
// Die Faelle sind die aus der Aufgabe (A bis N) und stehen unten mit ihren
// Buchstaben.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const WS = require("../../sync-server/node_modules/ws");
const { WatchpartyRaeume } = require("../src/watchparty-raeume");
const wpSync = require("../src/watchparty-sync");

if (!globalThis.WebSocket) globalThis.WebSocket = WS;

const PORT = Number(process.env.TESTPORT) || 8799;
const ADRESSE = `ws://127.0.0.1:${PORT}`;
const RAUM = "mitschauraum";
const WURZEL = path.join(__dirname, "..");
const BRUECKEN = path.join(WURZEL, "..", "android/app/src/main/assets/kern/eigen");

const SERIE = "https://aniworld.to/anime/stream/testserie";
const KEY = SERIE.toLowerCase();
const folge = (n) => `${SERIE}/staffel-1/episode-${n}`;

// Die Anbieter, wie Provider.alsJson() sie in die Bruecke reicht.
const ANBIETER = [
  { id: "aniworld", name: "AniWorld", startUrl: "https://aniworld.to/", searchUrl: "", logo: "AW" },
  { id: "sto", name: "S.to", startUrl: "https://s.to/", searchUrl: "", logo: "S" }
];

// Drei Titel in einem Raum - der Fall aus der Aufgabe.
const BLEACH = "https://aniworld.to/anime/stream/bleach";
const TORCH = "https://aniworld.to/anime/stream/black-torch";
const KORRA = "https://aniworld.to/anime/stream/die-legende-von-korra";
const folgeVon = (serie, staffel, n) => `${serie}/staffel-${staffel}/episode-${n}`;

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

async function warteBis(bedingung, was, hoechstens = 8000) {
  const bis = Date.now() + hoechstens;
  while (Date.now() < bis) {
    let erfuellt = false;
    try {
      erfuellt = Boolean(bedingung());
    } catch {
      erfuellt = false;
    }
    if (erfuellt) return true;
    await schlaf(40);
  }
  console.log(`      (Wartezeit abgelaufen: ${was})`);
  return false;
}

// --- Android: die echte Bruecke ----------------------------------------------

const KERN_MODULE = new Set(
  fs.readFileSync(path.join(WURZEL, "..", "android/app/build.gradle"), "utf8")
    .split("\n")
    .map((zeile) => (zeile.match(/"((?:src|shared)\/[a-z-]+\.js)"/) || [])[1])
    .filter(Boolean)
    .map((pfad) => path.basename(pfad, ".js"))
);

function android(name) {
  const ereignisse = [];
  const lader = (gesucht) => {
    if (!KERN_MODULE.has(gesucht)) {
      throw new Error(`"${gesucht}" steht nicht in kernModule und faehrt nicht mit`);
    }
    const unter = fs.existsSync(path.join(WURZEL, "src", `${gesucht}.js`)) ? "src" : "shared";
    return require(path.join(WURZEL, unter, `${gesucht}.js`));
  };
  const modul = { exports: {} };
  const fenster = {
    crypto: { randomUUID: () => `${name}-${Math.random().toString(16).slice(2)}` },
    ElfixKern: { ereignis: (art, nutzlast) => ereignisse.push({ art, nutzlast }) },
    WebSocket: WS
  };
  vm.runInNewContext(fs.readFileSync(path.join(BRUECKEN, "watchparty-bruecke.js"), "utf8"), {
    require: lader,
    module: modul,
    exports: modul.exports,
    console,
    window: fenster,
    WebSocket: WS,
    globalThis: { WebSocket: WS },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, JSON, Math, Number, String, Object, Array, Boolean,
    Set, Map, WeakSet, Error, RegExp, URL, Promise, Symbol
  });
  const bruecke = modul.exports;
  const steuerung = () => ereignisse.filter((e) => e.art === "watchparty:steuerung").map((e) => e.nutzlast);
  const eintragVon = () => bruecke.eintraege().find((e) => e.key === KEY) || null;
  let takt = null;
  let lage = null;
  let sitzung = 1;
  const api = {
    name, bruecke, ereignisse, steuerung, eintragVon,
    // Die Lage, wie Mitschauen.java sie zusammenstellt.
    lage: (offen) => {
      const eintrag = eintragVon();
      const treffer = String(offen || "").match(/episode-(\d+)/);
      return {
        binHost: Boolean(eintrag && eintrag.hostId && eintrag.hostId === eintrag.myId),
        hostId: (eintrag && eintrag.hostId) || "",
        gleicheAdresse: true,
        season: 1,
        episode: treffer ? Number(treffer[1]) : 0
      };
    },
    // Was der Horcher im Player melden wuerde - woertlich dieselbe Zeile.
    melden: (aktion, position, offen) =>
      bruecke.meldungSenden(`${wpSync.MELDE_AKTION}${aktion}:${position.toFixed(2)}`, KEY, offen, RAUM),
    stand: (position, pausiert, offen) =>
      bruecke.meldungStand(`${wpSync.MELDE_STAND}${position.toFixed(2)}:${pausiert ? 1 : 0}`, KEY, {
        url: offen,
        season: 1,
        episode: Number((String(offen).match(/episode-(\d+)/) || [])[1] || 0),
        playerSessionId: `${name}-sitzung-${sitzung}`
      }, RAUM),
    // Der Herzschlag. Ohne ihn faellt ein Geraet nach ein paar Sekunden aus
    // der Hostfolge - im Betrieb meldet der Horcher im Sekundentakt, hier
    // ebenso. Ein Test ohne Puls prueft die Uhr und nicht den Code.
    puls: (position, pausiert, offen) => {
      lage = { position, pausiert, offen };
      if (!takt) {
        takt = setInterval(() => {
          if (lage) api.stand(lage.position, lage.pausiert, lage.offen);
        }, 700);
        takt.unref?.();
      }
      api.stand(position, pausiert, offen);
    },
    stillstehen: () => {
      if (takt) clearInterval(takt);
      takt = null;
      lage = null;
    },
    // Ein neuer Player: neue Sitzung, wie nach einem Hoster- oder Folgenwechsel.
    neuerPlayer: () => { sitzung += 1; }
  };
  return api;
}

// --- Der Rechner: dieselbe Klasse wie in der App ------------------------------

function rechner(name, raum = RAUM) {
  const steuerung = [];
  const staende = [];
  const raeume = new WatchpartyRaeume({
    WebSocketKlasse: WS,
    onControl: (nachricht) => steuerung.push(nachricht),
    onWatchstate: (stand) => staende.push(stand)
  });
  raeume.konfigurieren({
    enabled: true, serverUrl: ADRESSE, rooms: [raum], name, deviceId: `${name}-id`
  });
  const eintragVon = () => raeume.eintraege().find((e) => e.key === KEY) || null;
  let takt = null;
  let lage = null;
  const api = {
    name, raeume, steuerung, staende, eintragVon,
    stand: (position, pausiert, offen) => raeume.meldeStand(KEY, {
      position, paused: pausiert, url: offen,
      season: 1,
      episode: Number((String(offen).match(/episode-(\d+)/) || [])[1] || 0),
      playerSessionId: `${name}-sitzung`
    }, raum),
    puls: (position, pausiert, offen) => {
      lage = { position, pausiert, offen };
      if (!takt) {
        takt = setInterval(() => {
          if (lage) api.stand(lage.position, lage.pausiert, lage.offen);
        }, 700);
        takt.unref?.();
      }
      api.stand(position, pausiert, offen);
    },
    stillstehen: () => {
      if (takt) clearInterval(takt);
      takt = null;
      lage = null;
    },
    melden: (aktion, position, offen) =>
      raeume.steuernMitAdresse(KEY, aktion, position, offen, raum)
  };
  return api;
}

(async () => {
  const pc = rechner("Rechner");
  const tv = android("AndroidTV");
  tv.bruecke.konfigurieren({
    enabled: true, serverUrl: ADRESSE, rooms: [RAUM], deviceName: "AndroidTV", deviceId: "tv-id"
  });

  await warteBis(() => pc.raeume.verbunden, "Rechner verbunden");
  await warteBis(() => tv.bruecke.status().connected, "Android verbunden");
  pruefe("Beide Geraete sind am Relay", pc.raeume.verbunden && tv.bruecke.status().connected);

  // Titel einstellen und beitreten.
  pc.raeume.teilen({
    key: KEY, url: folge(4), title: "Testserie", providerName: "AniWorld",
    type: "serie", season: 1, episode: 4
  }, RAUM);
  await warteBis(() => tv.eintragVon(), "Android sieht den Titel");
  pc.raeume.beitreten(KEY, RAUM);
  tv.bruecke.beitreten(KEY, RAUM);
  await warteBis(() => pc.eintragVon()?.joined && tv.eintragVon()?.joined, "beide beigetreten");
  pruefe("Beide sind der Runde beigetreten",
    Boolean(pc.eintragVon()?.joined && tv.eintragVon()?.joined));

  // Beide melden sich an derselben Folge an - daran haengt die Hostwahl.
  pc.puls(0, true, folge(4));
  await schlaf(150);
  tv.puls(0, true, folge(4));
  await warteBis(() => tv.eintragVon()?.hostId, "ein Host steht fest");
  pruefe("Der Rechner fuehrt (er war zuerst an der Folge)",
    tv.eintragVon()?.hostId === "Rechner-id",
    `hostId=${tv.eintragVon()?.hostId}`);

  /* ---------------------------------------------------------------- Test A */
  pc.steuerung.length = 0;
  tv.ereignisse.length = 0;
  pc.melden("play", 30, folge(4));
  await warteBis(() => tv.steuerung().some((m) => m.action === "play"), "A: TV empfaengt play");
  const aPlay = tv.steuerung().find((m) => m.action === "play");
  pruefe("A1. Play vom Rechner kommt auf Android an", Boolean(aPlay),
    aPlay ? `position=${aPlay.position}` : "nichts empfangen");
  const aUrteil = aPlay ? tv.bruecke.steuerungPruefen(aPlay, tv.lage(folge(4))) : null;
  pruefe("A2. Android wendet es auf den Player an",
    Boolean(aUrteil) && aUrteil.tun === "anwenden" && aUrteil.skript.includes("media.play()"),
    aUrteil ? aUrteil.tun : "kein Urteil");

  tv.ereignisse.length = 0;
  pc.melden("pause", 45, folge(4));
  await warteBis(() => tv.steuerung().some((m) => m.action === "pause"), "A: TV empfaengt pause");
  const aPause = tv.steuerung().find((m) => m.action === "pause");
  const aPauseUrteil = aPause ? tv.bruecke.steuerungPruefen(aPause, tv.lage(folge(4))) : null;
  pruefe("A3. Pause vom Rechner pausiert Android",
    Boolean(aPauseUrteil) && aPauseUrteil.tun === "anwenden"
    && aPauseUrteil.skript.includes("media.pause()"),
    aPauseUrteil ? aPauseUrteil.tun : "kein Urteil");

  /* ---------------------------------------------------------------- Test B */
  // Android fuehrt: es meldet sich zuerst an einer neuen Folge an.
  pc.steuerung.length = 0;
  const gesendet = tv.melden("play", 60, folge(4));
  pruefe("B1. Android sendet ueberhaupt einen Steuerbefehl", Boolean(gesendet),
    gesendet ? `${gesendet.aktion}@${gesendet.position}` : "nichts gesendet");
  await warteBis(() => pc.steuerung.some((m) => m.action === "play"), "B: Rechner empfaengt play");
  pruefe("B2. Play von Android startet den Rechner",
    pc.steuerung.some((m) => m.action === "play" && Math.abs(m.position - 60) < 1),
    JSON.stringify(pc.steuerung.map((m) => m.action)));

  pc.steuerung.length = 0;
  tv.melden("pause", 75, folge(4));
  await warteBis(() => pc.steuerung.some((m) => m.action === "pause"), "B: Rechner empfaengt pause");
  pruefe("B3. Pause von Android pausiert den Rechner",
    pc.steuerung.some((m) => m.action === "pause"),
    JSON.stringify(pc.steuerung.map((m) => m.action)));

  /* ---------------------------------------------------------------- Test C */
  tv.ereignisse.length = 0;
  pc.melden("seek", 720, folge(4));
  await warteBis(() => tv.steuerung().some((m) => m.action === "seek"), "C: TV empfaengt seek");
  const cSeek = tv.steuerung().find((m) => m.action === "seek");
  const cUrteil = cSeek ? tv.bruecke.steuerungPruefen(cSeek, tv.lage(folge(4))) : null;
  pruefe("C. Sprung des Rechners auf 12:00 kommt als Sprung an",
    Boolean(cSeek) && Math.abs(cSeek.position - 720) < 1
    && Boolean(cUrteil) && cUrteil.tun === "anwenden",
    cSeek ? `position=${cSeek.position}` : "nichts");

  /* ---------------------------------------------------------------- Test D */
  // Umgekehrte Richtung - und hier gilt seit der Host-Autoritaet das Gegenteil
  // von vorher. Der Rechner hat geteilt und ist Host; Android ist Gast.
  //
  // Frueher stand hier "der Rechner folgt dem Sprung von Android". Genau das
  // war der gemeldete Fehler: ein Gast riss die anderen auf seine Stelle, und
  // der naechste Ausgleich zog sie gleich wieder zum Host zurueck. Android
  // darf bei sich spulen, soviel es will - ein Befehl an die Runde wird daraus
  // nicht mehr. Test C darueber zeigt die erlaubte Richtung.
  pc.steuerung.length = 0;
  tv.melden("seek", 300, folge(4));
  await new Promise((r) => setTimeout(r, 1200));
  pruefe("D. Der Sprung eines Gasts bewegt den Host nicht",
    !pc.steuerung.some((m) => m.action === "seek"),
    JSON.stringify(pc.steuerung.map((m) => `${m.action}@${m.position}`)));

  /* ------------------------------------------------------------ Test E + F */
  // Die Driftregel ist geteilt und wird hier an genau den Zahlen der Aufgabe
  // geprueft: 0,9 Sekunden sind nichts, ueber fuenf Sekunden werden nach drei
  // bestaetigten Messungen einmal korrigiert.
  const zustandE = { bestaetigt: 0, seitSprung: 0, letzteMessung: 0 };
  const eTaten = [];
  for (let i = 0; i < 5; i += 1) {
    eTaten.push(wpSync.driftEntscheiden(zustandE, {
      drift: 0.9, jetzt: 1000 + i * 2000, puffert: false, laeuft: true
    }));
  }
  pruefe("E. Rund eine Sekunde Unterschied bleibt unangetastet",
    eTaten.every((tat) => tat === "ignore"), eTaten.join(","));

  const zustandF = { bestaetigt: 0, seitSprung: 0, letzteMessung: 0 };
  const fTaten = [];
  for (let i = 0; i < 3; i += 1) {
    fTaten.push(wpSync.driftEntscheiden(zustandF, {
      drift: 7.5, jetzt: 1000 + i * 2000, puffert: false, laeuft: true
    }));
  }
  pruefe("F. Ueber fuenf Sekunden wird nach drei Messungen einmal gesprungen",
    fTaten[0] === "beobachten" && fTaten[1] === "beobachten" && fTaten[2] === "hard-seek",
    fTaten.join(","));

  /* ---------------------------------------------------------------- Test G */
  pc.steuerung.length = 0;
  tv.ereignisse.length = 0;
  pc.melden("navigate", 0, folge(5));
  await warteBis(() => tv.steuerung().some((m) => m.action === "navigate"), "G: TV empfaengt navigate");
  const gNav = tv.steuerung().find((m) => m.action === "navigate");
  const gUrteil = gNav ? tv.bruecke.steuerungPruefen(gNav, tv.lage(folge(4))) : null;
  pruefe("G1. Folgenwechsel des Rechners kommt als Wechsel an",
    Boolean(gUrteil) && gUrteil.tun === "navigate" && gUrteil.url === folge(5),
    gUrteil ? `${gUrteil.tun} ${gUrteil.url}` : "kein Urteil");

  // Android folgt: es meldet sich an Folge 5 an - und der alte Zustand faellt.
  tv.bruecke.zuruecksetzen(KEY, RAUM);
  tv.neuerPlayer();
  tv.puls(0, true, folge(5));
  pc.puls(0, true, folge(5));
  await schlaf(400);

  // Und jetzt der gemeldete Fehler: wirkt Play/Pause danach noch?
  tv.ereignisse.length = 0;
  pc.melden("pause", 12, folge(5));
  await warteBis(() => tv.steuerung().some((m) => m.action === "pause" && m.url === folge(5)),
    "G: Pause auf der neuen Folge");
  const gPause = tv.steuerung().filter((m) => m.action === "pause").pop();
  const gPauseUrteil = gPause ? tv.bruecke.steuerungPruefen(gPause, tv.lage(folge(5))) : null;
  pruefe("G2. Nach dem Folgenwechsel wirkt Pause weiterhin",
    Boolean(gPauseUrteil) && gPauseUrteil.tun === "anwenden",
    gPauseUrteil ? `${gPauseUrteil.tun} (${gPauseUrteil.grund})` : "kein Urteil");

  pc.steuerung.length = 0;
  tv.melden("play", 20, folge(5));
  await warteBis(() => pc.steuerung.some((m) => m.action === "play"), "G: Play zurueck zum Rechner");
  pruefe("G3. Und Play von Android kommt weiterhin an",
    pc.steuerung.some((m) => m.action === "play"),
    JSON.stringify(pc.steuerung.map((m) => m.action)));

  // Ein Sprung dagegen nicht: der bewegt die Stelle der Runde, und die gehoert
  // dem Host. Der Rechner hat geteilt und fuehrt auch nach dem Folgenwechsel
  // weiter - Android spult bei sich.
  pc.steuerung.length = 0;
  tv.melden("seek", 200, folge(5));
  await schlaf(1200);
  pruefe("G4. Ein Sprung des Gasts dagegen nicht",
    !pc.steuerung.some((m) => m.action === "seek"),
    JSON.stringify(pc.steuerung.map((m) => m.action)));

  /* ---------------------------------------------------------------- Test H */
  pc.steuerung.length = 0;
  const hGesendet = tv.bruecke.folgenwechselMelden(KEY, folge(6), RAUM);
  await warteBis(() => pc.steuerung.some((m) => m.action === "navigate" && m.url === folge(6)),
    "H: Rechner empfaengt den Wechsel");
  pruefe("H1. Folgenwechsel von Android meldet Android auch",
    Boolean(hGesendet) && pc.steuerung.some((m) => m.action === "navigate" && m.url === folge(6)),
    JSON.stringify(pc.steuerung.map((m) => `${m.action}:${m.url || ""}`)));

  tv.bruecke.zuruecksetzen(KEY, RAUM);
  tv.neuerPlayer();
  tv.puls(0, true, folge(6));
  pc.puls(0, true, folge(6));
  await schlaf(400);
  tv.ereignisse.length = 0;
  pc.melden("play", 5, folge(6));
  await warteBis(() => tv.steuerung().some((m) => m.action === "play" && m.url === folge(6)),
    "H: Play auf Folge 6");
  const hPlay = tv.steuerung().filter((m) => m.action === "play").pop();
  const hUrteil = hPlay ? tv.bruecke.steuerungPruefen(hPlay, tv.lage(folge(6))) : null;
  pruefe("H2. Auch nach dem Wechsel durch Android laeuft die Steuerung",
    Boolean(hUrteil) && hUrteil.tun === "anwenden",
    hUrteil ? hUrteil.tun : "kein Urteil");

  /* ---------------------------------------------------------- Test I und J */
  // Hoster- und Sprachwechsel sind aus Sicht der Runde dasselbe: das Dokument
  // bleibt, der Player wird ausgetauscht. Was dabei zaehlt, ist, dass der
  // Zustand zurueckgesetzt wird und die Steuerung danach weiterlaeuft - die
  // Folge aendert sich nicht, also darf auch nichts nachgezogen werden.
  const vorher = pc.steuerung.length;
  const iSkript = tv.bruecke.zuruecksetzen(KEY, RAUM);
  await schlaf(200);
  pruefe("I1. Der Hosterwechsel setzt den Player zurueck, ohne etwas zu senden",
    iSkript.includes("__elfixWpSync") && pc.steuerung.length === vorher,
    `skript=${iSkript.length} Zeichen, neue Nachrichten=${pc.steuerung.length - vorher}`);

  tv.ereignisse.length = 0;
  pc.melden("pause", 42, folge(6));
  await warteBis(() => tv.steuerung().some((m) => m.action === "pause" && m.position >= 40),
    "I: Pause nach dem Hosterwechsel");
  const iPause = tv.steuerung().filter((m) => m.action === "pause").pop();
  const iUrteil = iPause ? tv.bruecke.steuerungPruefen(iPause, tv.lage(folge(6))) : null;
  pruefe("I2. Nach dem Hosterwechsel wirkt die Steuerung weiter",
    Boolean(iUrteil) && iUrteil.tun === "anwenden",
    iUrteil ? `${iUrteil.tun} (${iUrteil.grund})` : "kein Urteil");
  pruefe("J. Dasselbe gilt fuer einen Sprachwechsel - derselbe Weg",
    Boolean(iUrteil) && iUrteil.tun === "anwenden");

  /* ---------------------------------------------------------------- Test K */
  // Der Rechner verlaesst die Folge. Danach darf er nicht mehr Host sein.
  pc.stillstehen();
  pc.raeume.verlasseStand(KEY, RAUM);
  await warteBis(() => tv.eintragVon()?.hostId === "tv-id", "K: Android uebernimmt");
  pruefe("K. Verlaesst der Host die Folge, uebernimmt der naechste Aktive",
    tv.eintragVon()?.hostId === "tv-id",
    `hostId=${tv.eintragVon()?.hostId}, hostName=${tv.eintragVon()?.hostName}`);

  /* ---------------------------------------------------------------- Test L */
  // Ein neuer Teilnehmer kommt dazu und fragt den Stand ab.
  // Der Host laeuft wirklich - erst dann ist "laeuft" auch der Rundenzustand.
  tv.puls(757, false, folge(6));
  tv.melden("play", 757, folge(6));
  await schlaf(400);
  const neu = rechner("Nachzuegler");
  await warteBis(() => neu.raeume.verbunden, "L: Nachzuegler verbunden");
  neu.raeume.beitreten(KEY, RAUM);
  await warteBis(() => neu.eintragVon()?.joined, "L: Nachzuegler beigetreten");
  neu.steuerung.length = 0;
  neu.raeume.abgleichen(KEY, RAUM);
  await warteBis(() => neu.steuerung.length > 0, "L: Antwort auf den Abgleich");
  const lAntwort = neu.steuerung[0];
  pruefe("L1. Der Beitretende bekommt Folge und Stelle des Hosts",
    Boolean(lAntwort) && Math.abs(Number(lAntwort.position) - 757) < 12
    && String(lAntwort.url || "").includes("episode-6"),
    lAntwort ? `${lAntwort.action}@${Math.round(lAntwort.position)} ${lAntwort.url}` : "nichts");
  pruefe("L2. Und den Laufzustand des Hosts",
    Boolean(lAntwort) && lAntwort.playing === true,
    lAntwort ? `playing=${lAntwort.playing}` : "nichts");

  /* ---------------------------------------------------------------- Test M */
  // Kurzer Verbindungsverlust: die Bruecke haengt neu an und der Raum steht
  // danach wieder.
  tv.bruecke.trennen();
  await warteBis(() => !tv.bruecke.status().connected, "M: Android getrennt");
  pruefe("M1. Die Verbindung war wirklich weg", !tv.bruecke.status().connected);
  tv.bruecke.konfigurieren({
    enabled: true, serverUrl: ADRESSE, rooms: [RAUM], deviceName: "AndroidTV", deviceId: "tv-id"
  });
  await warteBis(() => tv.bruecke.status().connected, "M: Android wieder verbunden");
  await warteBis(() => tv.eintragVon(), "M: Raumzustand wieder da");
  pruefe("M2. Nach dem Wiederanschluss steht der Raum wieder",
    tv.bruecke.status().connected && Boolean(tv.eintragVon()),
    `verbunden=${tv.bruecke.status().connected}`);
  tv.puls(760, false, folge(6));
  await schlaf(400);
  neu.steuerung.length = 0;
  tv.melden("pause", 765, folge(6));
  await warteBis(() => neu.steuerung.some((m) => m.action === "pause"), "M: Steuerung laeuft wieder");
  pruefe("M3. Und die Steuerung laeuft danach weiter",
    neu.steuerung.some((m) => m.action === "pause"));

  /* ---------------------------------------------------------------- Test N */
  // Zehnmal Play/Pause: genau zehn Nachrichten, nicht dreissig.
  neu.steuerung.length = 0;
  for (let i = 0; i < 10; i += 1) {
    tv.melden(i % 2 === 0 ? "play" : "pause", 800 + i, folge(6));
    await schlaf(60);
  }
  await schlaf(600);
  const nZaehler = neu.steuerung.filter((m) => m.action === "play" || m.action === "pause").length;
  pruefe("N. Zehn Tastendruecke ergeben genau zehn Ereignisse",
    nZaehler === 10, `${nZaehler} statt 10`);

  /* -------------------------------------------- Der Loop-Schutz im Player */
  // Er sitzt im Beobachterskript und wird dort gegen ein nachgebautes Video
  // geprueft (siehe mitschauenplayertest.js). Hier nur die Gegenprobe, dass
  // ein angewendetes Ereignis wirklich eine Erwartung setzt.
  const loopUrteil = tv.bruecke.steuerungPruefen(
    { key: KEY, room: RAUM, action: "pause", position: 100, videoTime: 100,
      timestamp: Date.now(), sequenceId: 9999, episodeId: "s1e6", url: folge(6) },
    tv.lage(folge(6))
  );
  pruefe("Loop-Schutz: das angewendete Ereignis meldet sich beim Horcher an",
    loopUrteil.skript.includes("__elfixWpErwatet") === false
    && loopUrteil.skript.includes("__elfixWpErwartet"),
    loopUrteil.tun);

  // Und dieselbe Nachricht ein zweites Mal ist ein Nachzuegler.
  const nochmal = tv.bruecke.steuerungPruefen(
    { key: KEY, room: RAUM, action: "play", position: 100, videoTime: 100,
      timestamp: Date.now() - 5000, sequenceId: 9998, episodeId: "s1e6", url: folge(6) },
    tv.lage(folge(6))
  );
  pruefe("Veraltet: ein ueberholtes Ereignis wird abgewiesen",
    nochmal.tun === "nichts" && nochmal.grund === "veraltet",
    `${nochmal.tun}/${nochmal.grund}`);

  /* --------------------------------------------- Oeffnen eines Eintrags */
  // Der Teil, den Android gar nicht hatte: unter jedem Eintrag stand genau
  // "Verlassen". Geprueft wird, was die Bruecke der Oberflaeche antwortet -
  // Anbieter, Adresse, Staffel und Folge.
  {
    const ziel = tv.bruecke.oeffnungsZiel(KEY, RAUM, ANBIETER);
    pruefe("O1. Ein Eintrag laesst sich oeffnen und nennt seinen Anbieter",
      Boolean(ziel) && ziel.providerId === "aniworld",
      ziel ? `providerId=${ziel.providerId}` : "kein Ziel");
    // Die Runde steht bei Folge 6 - also muss dorthin geoeffnet werden und
    // nicht auf die Serienuebersicht.
    pruefe("O2. Geoeffnet wird die Folge, nicht die Serie",
      Boolean(ziel) && ziel.url.includes("episode-6"),
      ziel ? ziel.url : "kein Ziel");
    pruefe("O3. Staffel und Folge stehen dabei",
      Boolean(ziel) && ziel.season === 1 && ziel.episode === 6,
      ziel ? `s${ziel.season}e${ziel.episode}` : "kein Ziel");
    pruefe("O4. Und der Raum, aus dem geoeffnet wurde",
      Boolean(ziel) && ziel.room === RAUM,
      ziel ? ziel.room : "kein Ziel");

    // Ohne passenden Anbieter bleibt der Knopf wirkungslos - und sagt das.
    const ohne = tv.bruecke.oeffnungsZiel(KEY, RAUM, [
      { id: "filmo", name: "Filmo", startUrl: "https://filmo.to/" }
    ]);
    pruefe("O5. Ohne eingerichteten Anbieter gibt es kein Ziel",
      Boolean(ohne) && ohne.providerId === "",
      ohne ? `providerId="${ohne.providerId}"` : "kein Ziel");

    pruefe("O6. Ein unbekannter Titel liefert gar nichts",
      tv.bruecke.oeffnungsZiel("https://aniworld.to/anime/stream/gibtsnicht", RAUM, ANBIETER) === null);
  }

  /* ------------------------------------ Mehrere Titel in einem Raum */
  // Raum Bangus mit Bleach, BLACK TORCH und Korra. Ein Klick auf Bleach darf
  // niemals Korra oeffnen - das ist die eigentliche Gefahr, wenn Schluessel
  // und Raum nicht zusammen gefuehrt werden.
  {
    for (const [serie, titel, staffel, nummer] of [
      [BLEACH, "Bleach", 3, 8],
      [TORCH, "BLACK TORCH", 1, 2],
      [KORRA, "Die Legende von Korra", 2, 5]
    ]) {
      pc.raeume.teilen({
        key: serie.toLowerCase(), url: folgeVon(serie, staffel, nummer), title: titel,
        providerName: "AniWorld", type: "serie", season: staffel, episode: nummer
      }, RAUM);
      await schlaf(120);
    }
    await warteBis(() => tv.bruecke.eintraege().length >= 4, "drei weitere Titel im Raum");

    const alle = tv.bruecke.eintraegeMitAnbieter(ANBIETER);
    pruefe("M1. Der Raum fuehrt mehrere Titel nebeneinander",
      alle.length >= 4, `${alle.length} Eintraege`);

    const proben = [
      ["Bleach", BLEACH, 3, 8],
      ["BLACK TORCH", TORCH, 1, 2],
      ["Die Legende von Korra", KORRA, 2, 5]
    ];
    let sauber = true;
    const gemeldet = [];
    for (const [titel, serie, staffel, nummer] of proben) {
      const ziel = tv.bruecke.oeffnungsZiel(serie.toLowerCase(), RAUM, ANBIETER);
      const passt = Boolean(ziel)
        && ziel.titel === titel
        && ziel.url === folgeVon(serie, staffel, nummer)
        && ziel.season === staffel && ziel.episode === nummer;
      if (!passt) sauber = false;
      gemeldet.push(`${titel} -> ${ziel ? ziel.url.split("/stream/")[1] : "nichts"}`);
    }
    pruefe("M2. Jeder Titel oeffnet genau sich selbst", sauber, gemeldet.join(" | "));

    const bleach = alle.find((e) => e.key === BLEACH.toLowerCase());
    const korra = alle.find((e) => e.key === KORRA.toLowerCase());
    pruefe("M3. Und traegt seine eigene Staffel und Folge",
      Boolean(bleach) && bleach.staffel === 3 && bleach.folge === 8
      && Boolean(korra) && korra.staffel === 2 && korra.folge === 5,
      bleach && korra ? `Bleach s${bleach.staffel}e${bleach.folge}, Korra s${korra.staffel}e${korra.folge}` : "fehlt");
    pruefe("M4. Alle liegen im selben Raum und sind oeffenbar",
      alle.every((e) => e.room === RAUM && e.openable === true),
      alle.map((e) => `${e.title}:${e.room}:${e.openable}`).join(" | "));

    // Und die Sync laeuft danach unveraendert weiter - der Steuerbefehl fuer
    // den einen Titel darf die anderen nicht anfassen.
    neu.steuerung.length = 0;
    tv.melden("pause", 900, folge(6));
    await warteBis(() => neu.steuerung.some((m) => m.action === "pause" && m.key === KEY),
      "M: Pause erreicht nur den eigenen Titel");
    pruefe("M5. Ein Steuerbefehl gilt nur dem Titel, aus dem er kam",
      neu.steuerung.every((m) => m.key === KEY),
      neu.steuerung.map((m) => m.key.split("/stream/")[1]).join(","));
  }

  /* ---------------------------------- Ein Titel in zwei Raeumen */
  // Derselbe Anime kann in zwei Runden stehen. Dann muss der Raum mitreisen,
  // sonst oeffnet man den Eintrag der falschen Runde.
  {
    const ZWEITER = "zweiterraum";
    const pc2 = rechner("ZweiterRaum", ZWEITER);
    tv.bruecke.konfigurieren({
      enabled: true, serverUrl: ADRESSE, rooms: [RAUM, ZWEITER],
      deviceName: "AndroidTV", deviceId: "tv-id"
    });
    await warteBis(() => pc2.raeume.verbunden, "zweiter Raum verbunden");
    pc2.raeume.teilen({
      key: BLEACH.toLowerCase(), url: folgeVon(BLEACH, 5, 1), title: "Bleach",
      providerName: "AniWorld", type: "serie", season: 5, episode: 1
    }, ZWEITER);
    await warteBis(
      () => tv.bruecke.eintraege().filter((e) => e.key === BLEACH.toLowerCase()).length === 2,
      "Bleach steht in zwei Raeumen");

    const ausEins = tv.bruecke.oeffnungsZiel(BLEACH.toLowerCase(), RAUM, ANBIETER);
    const ausZwei = tv.bruecke.oeffnungsZiel(BLEACH.toLowerCase(), ZWEITER, ANBIETER);
    pruefe("R1. Derselbe Titel in zwei Raeumen bleibt unterscheidbar",
      Boolean(ausEins) && Boolean(ausZwei)
      && ausEins.url.includes("staffel-3/episode-8")
      && ausZwei.url.includes("staffel-5/episode-1"),
      `${ausEins ? ausEins.url.split("/stream/")[1] : "-"} vs ${ausZwei ? ausZwei.url.split("/stream/")[1] : "-"}`);
    pruefe("R2. Und jeder nennt seinen eigenen Raum",
      ausEins.room === RAUM && ausZwei.room === ZWEITER,
      `${ausEins.room} / ${ausZwei.room}`);
    pc2.stillstehen();
    pc2.raeume.trennen();
  }

  /* --------------------------- Was die Startseite von der Runde braucht */
  // Die Kacheln in "Gemeinsam weiterschauen" zeigen, wer gerade schaut, wo er
  // steht und wer fuehrt - und wer angehalten hat. Alles davon schickt das
  // Relay laengst; die letzten beiden Angaben wurden auf dem Weg in die App
  // verworfen, und genau deshalb blieb die Zeile "Angehalten von ..." leer.
  {
    pc.staende.length = 0;
    pc.puls(120, false, folge(6));
    tv.puls(118, false, folge(6));
    await warteBis(() => pc.staende.some((s) => (s.members || []).length >= 2),
      "S: beide Geraete stehen in der Leiste");
    const leiste = pc.staende.filter((s) => (s.members || []).length >= 2).pop();
    const jemand = leiste.members[0];
    pruefe("S1. Die Leiste nennt Name, Stelle, Pausenzustand und Alter",
      typeof jemand.name === "string" && typeof jemand.position === "number"
      && typeof jemand.paused === "boolean" && typeof jemand.age === "number",
      JSON.stringify(jemand));
    pruefe("S2. Und genau einer fuehrt",
      leiste.members.filter((m) => m.host).length === 1,
      leiste.members.map((m) => `${m.name}:${m.host}`).join(","));
    pruefe("S3. Jedes Mitglied traegt seine Kennung - daran erkennt ein Geraet sich selbst",
      leiste.members.every((m) => typeof m.id === "string" && m.id.length > 0),
      leiste.members.map((m) => m.id).join(","));

    pc.staende.length = 0;
    tv.melden("pause", 130, folge(6));
    await warteBis(() => pc.staende.some((s) => s.lastAction),
      "S: die Pause steht in der Leiste");
    const nachPause = pc.staende.filter((s) => s.lastAction).pop();
    pruefe("S4. Wer angehalten hat, kommt bis in die App",
      nachPause.lastAction.type === "pause" && nachPause.lastAction.name === "AndroidTV",
      JSON.stringify(nachPause.lastAction));
    pruefe("S5. Und pausedBy ebenso",
      nachPause.pausedBy === "AndroidTV", `"${nachPause.pausedBy}"`);
  }

  pc.stillstehen();
  tv.stillstehen();
  neu.stillstehen();
  pc.raeume.trennen();
  neu.raeume.trennen();
  tv.bruecke.trennen();
  await schlaf(200);

  const ok = pruefungen.filter(Boolean).length;
  console.log(`\n${ok}/${pruefungen.length} bestanden`);
  process.exit(ok === pruefungen.length ? 0 : 1);
})();
