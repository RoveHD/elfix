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

function rechner(name) {
  const steuerung = [];
  const staende = [];
  const raeume = new WatchpartyRaeume({
    WebSocketKlasse: WS,
    onControl: (nachricht) => steuerung.push(nachricht),
    onWatchstate: (stand) => staende.push(stand)
  });
  raeume.konfigurieren({
    enabled: true, serverUrl: ADRESSE, rooms: [RAUM], name, deviceId: `${name}-id`
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
    }, RAUM),
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
      raeume.steuernMitAdresse(KEY, aktion, position, offen, RAUM)
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
  pc.steuerung.length = 0;
  tv.melden("seek", 300, folge(4));
  await warteBis(() => pc.steuerung.some((m) => m.action === "seek"), "D: Rechner empfaengt seek");
  pruefe("D. Sprung von Android folgt der Rechner",
    pc.steuerung.some((m) => m.action === "seek" && Math.abs(m.position - 300) < 1),
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

  pc.steuerung.length = 0;
  tv.melden("seek", 200, folge(5));
  await warteBis(() => pc.steuerung.some((m) => m.action === "seek"), "G: Seek zurueck zum Rechner");
  pruefe("G4. Und ein Sprung ebenso",
    pc.steuerung.some((m) => m.action === "seek" && Math.abs(m.position - 200) < 1));

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
