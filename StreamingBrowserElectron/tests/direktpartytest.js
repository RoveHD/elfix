"use strict";

// Die Watchparty am eigenen Player - Rechner und Android in derselben Runde.
//
// `androidwatchpartytest.js` prueft dieselbe Strecke fuer den Hoster-Rahmen:
// dort traegt ein eingespieltes Skript die Stelle in das <video> des Hosters
// ein. Seit es den eigenen Player gibt, gilt auf beiden Seiten ein anderer Weg,
// und der war von keiner Pruefung gedeckt:
//
//   Rechner   applyWatchpartyControl -> spielerSteuernAusRunde -> spieler:steuern
//   Android   Mitschauen.ausfuehren  -> steuerungPruefen (lage.nativ)
//                                    -> DirektSpieler.befehlPruefen -> ExoPlayer
//
// Zwei Wege, ein Protokoll. Was hier laeuft, ist deshalb nicht nachgebaut,
// sondern das Echte: das Relay aus sync-server, die Bruecke aus den
// Android-Assets, und `spielerSteuernAusRunde` woertlich aus main.js. Nachgebaut
// ist genau eine Sache - der Player selbst, weil weder ExoPlayer noch <video>
// in Node laufen. Er tut dabei Schritt fuer Schritt das, was DirektSpieler.java
// und spieler.js tun: anhalten, springen, weiterlaufen.
//
// Gefunden hat dieser Test, dass `spielerSteuernAusRunde` auf "play", "pause"
// und "seek" abfragte - Urteile, die es gar nicht gibt: steuerungEntscheiden
// nennt sie alle "anwenden".

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const WS = require("../../sync-server/node_modules/ws");
const { WatchpartyRaeume } = require("../src/watchparty-raeume");
const wpSync = require("../src/watchparty-sync");
const taste = require("../src/taste");

if (!globalThis.WebSocket) globalThis.WebSocket = WS;

const PORT = Number(process.env.TESTPORT) || 8791;
const ADRESSE = `ws://127.0.0.1:${PORT}`;
const RAUM = "direktraum";
const WURZEL = path.join(__dirname, "..");
const BRUECKEN = path.join(WURZEL, "..", "android/app/src/main/assets/kern/eigen");
const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").replace(/\r/g, "");

const SERIE = "https://aniworld.to/anime/stream/bleach";
const folge = (n) => `${SERIE}/staffel-1/episode-${n}`;
const KEY = "serie:bleach";

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
    try { erfuellt = Boolean(bedingung()); } catch { erfuellt = false; }
    if (erfuellt) return true;
    await schlaf(40);
  }
  console.log(`      (Wartezeit abgelaufen: ${was})`);
  return false;
}

function nummer(url, was) {
  return Number((String(url).match(new RegExp(`${was}-(\\d+)`)) || [])[1] || 0);
}
function gleicheFolge(links, rechts) {
  if (!links || !rechts) return true;
  return taste.urlSchluessel(links) === taste.urlSchluessel(rechts)
    && nummer(links, "staffel") === nummer(rechts, "staffel")
    && nummer(links, "episode") === nummer(rechts, "episode");
}

/* ===================== Die Module, wie das Telefon sie laedt ================ */

function androidModul(datei, zusatz = {}) {
  const lader = (gesucht) => {
    const name = path.basename(String(gesucht), ".js");
    const unter = fs.existsSync(path.join(WURZEL, "src", `${name}.js`)) ? "src" : "shared";
    return require(path.join(WURZEL, unter, `${name}.js`));
  };
  const modul = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(BRUECKEN, datei), "utf8"), {
    require: lader, module: modul, exports: modul.exports, console,
    AbortController, AbortSignal, fetch: () => Promise.reject(new Error("kein Netz im Test")),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, JSON, Math, Number, String, Object, Array, Boolean,
    Set, Map, WeakSet, Error, RegExp, URL, Promise, Symbol, TextEncoder, TextDecoder,
    ...zusatz
  });
  return modul.exports;
}

/* ============================== Das Telefon ================================ */

/**
 * Android: die echte Bruecke, davor ein Player, der sich wie ExoPlayer verhaelt.
 *
 * Die Schritte in {@link handy#empfangen} stehen so in
 * DirektSpieler.befehlPruefen - erst anhalten, dann die Stelle ueber
 * `befehlJetzt` neu ausrechnen (die Laufzeit der Nachricht zaehlt bis zum
 * Sprung mit), dann laufen lassen, wenn das Ereignis lief und nicht gewartet
 * werden soll.
 */
function handy(name) {
  const ereignisse = [];
  const direkt = androidModul("direkt-android.js");
  const bruecke = androidModul("watchparty-bruecke.js", {
    window: {
      crypto: { randomUUID: () => `${name}-${Math.random().toString(16).slice(2)}` },
      ElfixKern: { ereignis: (art, nutzlast) => ereignisse.push({ art, nutzlast }) },
      WebSocket: WS
    },
    WebSocket: WS,
    globalThis: { WebSocket: WS }
  });

  const player = { position: 0, laeuft: false, puffert: false, offen: folge(4) };
  const angewendet = [];
  let bereitGemeldet = 0;
  let takt = null;

  const api = {
    name, bruecke, player, angewendet, ereignisse,
    get bereitZahl() { return bereitGemeldet; },
    // Das Relay schickt jeden Steuerbefehl auch an den Absender zurueck. Hier
    // zaehlt nur, was von drueben kommt.
    steuerung: () => ereignisse.filter((e) => e.art === "watchparty:steuerung")
      .map((e) => (typeof e.nutzlast === "string" ? JSON.parse(e.nutzlast) : e.nutzlast))
      .filter(Boolean),

    /** Die Lage, die Mitschauen.java baut - mit nativem Player. */
    lage(nachricht) {
      const l = bruecke.lageFuer(player.offen);
      const gleichziehen = nachricht.action === "syncprepare";
      return {
        binHost: Boolean(l.binHost),
        hostId: l.hostId || "",
        nativ: true,
        spielstand: { position: player.position, paused: !player.laeuft, puffert: player.puffert },
        gleicheAdresse: gleichziehen || gleicheFolge(nachricht.url || "", player.offen),
        season: gleichziehen ? 0 : nummer(player.offen, "staffel"),
        episode: gleichziehen ? 0 : nummer(player.offen, "episode")
      };
    },

    /** Ein Befehl der Runde, den ganzen Weg bis in den Player. */
    empfangen(nachricht) {
      const urteil = bruecke.steuerungPruefen(nachricht, api.lage(nachricht));
      angewendet.push(urteil);
      if (urteil.tun === "nichts") return urteil;
      if (urteil.tun === "navigate") {
        player.offen = urteil.url;
        player.position = 0;
        return urteil;
      }
      // Ab hier DirektSpieler.befehlPruefen, Zeile fuer Zeile.
      const gerechnet = direkt.befehlJetzt(urteil);
      player.laeuft = false;
      if (!gerechnet.nichtSpringen) player.position = Math.max(0, Number(gerechnet.position) || 0);
      const ereignis = gerechnet.ereignis;
      player.laeuft = !gerechnet.warten && Boolean(ereignis && ereignis.playing);
      if (nachricht.action === "syncprepare") {
        bereitGemeldet += 1;
        bruecke.bereitZumStart(nachricht.key, nachricht.room);
      }
      return urteil;
    },

    /** Was der Zuschauer am Telefon selbst tut - DirektSpieler.liveMelden. */
    melden(aktion, position) {
      player.position = position;
      if (aktion === "play") player.laeuft = true;
      if (aktion === "pause") player.laeuft = false;
      const l = bruecke.lageFuer(player.offen);
      if (!l.key) return null;
      return bruecke.meldungSenden(
        `${wpSync.MELDE_AKTION}${aktion}:${position.toFixed(2)}`, l.key, player.offen, l.room);
    },
    /** Der Herzschlag: wo stehe ich gerade. */
    puls() {
      if (takt) return;
      takt = setInterval(() => api.stand(), 700);
      takt.unref?.();
      api.stand();
    },
    stillstehen() { if (takt) clearInterval(takt); takt = null; },
    stand() {
      const l = bruecke.lageFuer(player.offen);
      if (!l.key) return null;
      return bruecke.meldungStand(
        `${wpSync.MELDE_STAND}${player.position.toFixed(2)}:${player.laeuft ? 0 : 1}`, l.key, {
          url: player.offen,
          season: nummer(player.offen, "staffel"),
          episode: nummer(player.offen, "episode"),
          playerSessionId: `${name}-sitzung`
        }, l.room);
    }
  };
  return api;
}

/* =============================== Der Rechner =============================== */

/** Eine Funktion woertlich aus main.js - dieselbe Technik wie im Regressionstest. */
function funktion(name) {
  const start = MAIN.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} steht nicht in main.js`);
  return MAIN.slice(start, MAIN.indexOf("\n}", start) + 2);
}

/**
 * Der Rechner mit eigenem Player.
 *
 * Transport und Buchfuehrung wie im Betrieb (WatchpartyRaeume), die Entscheidung
 * aus watchparty-sync, und die Ausfuehrung woertlich aus main.js. Der Player
 * dahinter ist derselbe Nachbau wie drueben: `spieler:steuern` traegt "gehe auf
 * diese Stelle und lauf dann (nicht) weiter" - genau das tut spieler.js.
 */
function rechner(name) {
  const steuerung = [];
  const befehle = [];
  const raeume = new WatchpartyRaeume({
    WebSocketKlasse: WS,
    // Auch die eigenen Echos: das Relay schickt jeden Steuerbefehl an alle,
    // und der Anstoss zum Gleichziehen kommt beim Absender genauso an wie bei
    // den anderen - applyWatchpartyControl behandelt ihn dort ebenso.
    onControl: (nachricht) => steuerung.push(nachricht),
    onWatchstate: () => {}
  });
  raeume.konfigurieren({
    enabled: true, serverUrl: ADRESSE, rooms: [RAUM], name, deviceId: `${name}-id`
  });

  const player = { url: folge(4), position: 312.5, laeuft: false, puffert: false };
  const letzteEreignisse = new Map();
  const driftStand = { bestaetigt: 0, letzteMessung: 0, seitSprung: 0 };
  let takt = null;

  const zusammenhang = vm.createContext({
    console: { log() {} }, Date, Math, Number, String, Boolean, Object, Array, JSON,
    watchpartySync: wpSync,
    watchparty: {
      aktiv: true,
      serverJetzt: (raum) => raeume.serverJetzt(raum),
      uhrStand: (raum) => raeume.uhrStand(raum)
    },
    taste,
    aktiverWatchpartyRaum: () => RAUM,
    episodeIdentity: (url) => {
      const staffel = nummer(url, "staffel");
      const folgeNr = nummer(url, "episode");
      return staffel || folgeNr ? { season: staffel, episode: folgeNr } : null;
    },
    istGleicheFolge: gleicheFolge,
    spielerAnbieter: () => ({ id: "aniworld" }),
    direktFolgeSpielen: async (anbieter, url) => {
      player.url = url;
      player.position = 0;
      befehle.push({ tun: "folge", url });
    },
    // Was spieler.js aus dem Befehl macht: Stelle setzen, laufen oder nicht.
    spielerBefehl: (befehl) => {
      befehle.push(befehl);
      if (typeof befehl.stelle === "number" && befehl.springen !== false) {
        player.position = befehl.stelle;
      }
      player.laeuft = Boolean(befehl.laufen);
      return true;
    },
    get spielerLauf() { return { url: player.url, id: "lauf-1", providerId: "aniworld" }; },
    get spielerTakt() {
      return { stelle: player.position, laeuft: player.laeuft, puffert: player.puffert, at: Date.now() };
    },
    spielerDrift: driftStand
  });
  vm.runInContext([
    funktion("watchpartyEreignis"),
    funktion("watchpartyLaeuftDanach"),
    funktion("watchpartyPasstZurFolge"),
    funktion("spielerSteuernAusRunde")
  ].join("\n"), zusammenhang);

  const api = {
    name, raeume, steuerung, befehle, player,
    eintragVon: (key) => raeume.eintraege().find((e) => e.key === key) || null,

    /** Der Weg aus applyWatchpartyControl: erst entscheiden, dann an den Player. */
    async empfangen(nachricht) {
      const eintrag = api.eintragVon(nachricht.key) || { key: nachricht.key, room: RAUM, url: player.url };
      const merker = `${nachricht.room || RAUM}|${nachricht.key}`;
      const urteil = wpSync.steuerungEntscheiden(nachricht, {
        letzter: letzteEreignisse.get(merker),
        binHost: Boolean(eintrag.hostId) && eintrag.hostId === eintrag.myId,
        hostId: eintrag.hostId,
        gleicheAdresse: true,
        offen: null
      });
      if (urteil.merken) letzteEreignisse.set(merker, urteil.merken);
      if (urteil.tun === "nichts") return { ...urteil, erledigt: false };
      const binHost = Boolean(eintrag.hostId) && eintrag.hostId === eintrag.myId;
      const erledigt = await zusammenhang.spielerSteuernAusRunde(eintrag, nachricht, urteil, binHost);
      // Beim Gleichziehen meldet prepareWatchpartySync die Bereitschaft. Sie
      // haengt nicht am Player - auch wer die Folge gar nicht offen hat, meldet
      // sich, sonst warten die anderen bis zum Zeitlimit.
      if (urteil.tun === "syncprepare") raeume.bereitZumStart(eintrag.key, eintrag.room || RAUM);
      return { ...urteil, erledigt };
    },

    /** Was der Zuschauer am Rechner tut - ipcMain "spieler:aktion". */
    melden(aktion, position) {
      player.position = position;
      if (aktion === "play") player.laeuft = true;
      if (aktion === "pause") player.laeuft = false;
      return raeume.steuernMitAdresse(KEY, aktion, position, player.url, RAUM);
    },
    puls() {
      if (takt) return;
      takt = setInterval(() => api.stand(), 700);
      takt.unref?.();
      api.stand();
    },
    stillstehen() { if (takt) clearInterval(takt); takt = null; },
    stand() {
      return raeume.meldeStand(KEY, {
        position: player.position, paused: !player.laeuft, url: player.url,
        season: nummer(player.url, "staffel"), episode: nummer(player.url, "episode"),
        playerSessionId: `${name}-sitzung`
      }, RAUM);
    }
  };
  return api;
}

/* ================================= Der Lauf ================================ */

(async () => {
  const pc = rechner("Rechner");
  const tv = handy("Handy");
  tv.bruecke.konfigurieren({
    enabled: true, serverUrl: ADRESSE, rooms: [RAUM], deviceName: "Handy", deviceId: "handy-id"
  });

  await warteBis(() => pc.raeume.verbunden, "Rechner verbunden");
  await warteBis(() => tv.bruecke.status().connected, "Android verbunden");
  pruefe("1. Beide Geraete sind am Relay",
    pc.raeume.verbunden && tv.bruecke.status().connected);

  pc.raeume.teilen({
    key: KEY, url: folge(4), title: "Bleach", providerName: "AniWorld",
    type: "serie", season: 1, episode: 4
  }, RAUM);
  await warteBis(() => tv.bruecke.eintraege().some((e) => e.key === KEY), "Titel am Telefon");
  pruefe("2a. Der Titel des Rechners steht am Telefon",
    tv.bruecke.eintraege().some((e) => e.key === KEY));

  pc.raeume.beitreten(KEY, RAUM);
  tv.bruecke.beitreten(KEY, RAUM);
  await schlaf(300);

  // Der Herzschlag beider Player. Ohne ihn waehlt das Relay keinen Host, und
  // ohne Host setzt es die Stelle jedes Befehls auf den Rundenstand - also auf
  // null. Im Betrieb meldet jede Seite im Sekundentakt (spieler:takt am
  // Rechner, DirektSpieler.takt am Telefon); hier also auch.
  pc.player.position = 312.5;
  pc.player.laeuft = true;
  tv.player.position = 312.5;
  tv.player.laeuft = true;
  pc.puls();
  tv.puls();
  await warteBis(() => (pc.eintragVon(KEY) || {}).hostId, "Host gewaehlt");
  const host = (pc.eintragVon(KEY) || {}).hostId;
  pruefe("2b. Das Relay waehlt einen Host", Boolean(host), `hostId=${host}`);
  const pcIstHost = host === "Rechner-id";

  /* ---------------- 3. Der Rechner steuert, das Telefon folgt -------------- */

  pc.melden("pause", 300);
  await warteBis(() => tv.steuerung().some((n) => n.action === "pause" && n.from === "Rechner"), "Pause am Telefon");
  const pause = tv.steuerung().find((n) => n.action === "pause" && n.from === "Rechner");
  pruefe("3a. Die Pause des Rechners kommt am Telefon an", Boolean(pause));
  if (pause) {
    tv.empfangen(pause);
    // Die Stelle stammt vom Host; ist der Rechner es, ist es seine eigene.
    pruefe("3b. Der Player am Telefon haelt an, auf der Stelle der Runde",
      !tv.player.laeuft && Math.abs(tv.player.position - pause.position) < 1.5,
      `laeuft=${tv.player.laeuft} stelle=${tv.player.position.toFixed(2)} soll=${pause.position}`);
  }

  pc.melden("play", 300);
  await warteBis(() => tv.steuerung().some((n) => n.action === "play" && n.from === "Rechner"), "Play am Telefon");
  const play = tv.steuerung().find((n) => n.action === "play" && n.from === "Rechner");
  if (play) {
    tv.empfangen(play);
    pruefe("3c. Das Telefon laeuft weiter, mit der Laufzeit der Nachricht",
      tv.player.laeuft && tv.player.position >= play.position && tv.player.position < play.position + 2,
      `stelle=${tv.player.position.toFixed(2)} nachricht=${play.position}`);
  }

  // Spulen bewegt die Runde nur vom Host aus (server.js: "seek" && !istHost).
  if (pcIstHost) {
    pc.melden("seek", 900);
    const kam = await warteBis(() => tv.steuerung().some((n) => n.action === "seek" && n.from === "Rechner"), "Sprung am Telefon");
    const sprung = tv.steuerung().find((n) => n.action === "seek" && n.from === "Rechner");
    pruefe("3d. Der Sprung des Hosts erreicht das Telefon", kam && Boolean(sprung));
    if (sprung) {
      tv.empfangen(sprung);
      pruefe("3e. Der Sprung sitzt am Telefon",
        tv.player.position >= 900 && tv.player.position < 902,
        `stelle=${tv.player.position.toFixed(2)}`);
    }
  } else {
    tv.melden("seek", 900);
    const kam = await warteBis(() => pc.steuerung.some((n) => n.action === "seek" && n.from === "Handy"), "Sprung am Rechner");
    const sprung = pc.steuerung.find((n) => n.action === "seek" && n.from === "Handy");
    pruefe("3d. Der Sprung des Hosts erreicht den Rechner", kam && Boolean(sprung));
    if (sprung) {
      await pc.empfangen(sprung);
      pruefe("3e. Der Sprung sitzt am Rechner",
        pc.player.position >= 900 && pc.player.position < 902,
        `stelle=${pc.player.position.toFixed(2)}`);
    }
  }

  /* ---------------- 4. Das Telefon steuert, der Rechner folgt -------------- */

  const vorPause = pc.befehle.length;
  tv.melden("pause", 640);
  await warteBis(() => pc.steuerung.some((n) => n.action === "pause" && n.from === "Handy"), "Pause am Rechner");
  const pcPause = pc.steuerung.find((n) => n.action === "pause" && n.from === "Handy");
  pruefe("4a. Die Pause des Telefons kommt am Rechner an", Boolean(pcPause));
  if (pcPause) {
    const urteil = await pc.empfangen(pcPause);
    pruefe("4b. Der eigene Player des Rechners nimmt den Befehl an",
      urteil.erledigt === true, `erledigt=${urteil.erledigt} tun=${urteil.tun}`);
    pruefe("4c. Und haelt an",
      !pc.player.laeuft && pc.befehle.length > vorPause,
      `laeuft=${pc.player.laeuft} befehle=${pc.befehle.length - vorPause}`);
    // Der Host springt nicht auf seine eigene Stelle - das laesst nur neu puffern.
    const letzter = pc.befehle[pc.befehle.length - 1];
    pruefe("4d. Dem Host wird kein Sprung aufgedraengt",
      pcIstHost ? letzter.springen === false : letzter.springen === true,
      `host=${pcIstHost} springen=${letzter.springen}`);
  }

  tv.melden("play", 640);
  await warteBis(() => pc.steuerung.some((n) => n.action === "play" && n.from === "Handy"), "Play am Rechner");
  const pcPlay = pc.steuerung.find((n) => n.action === "play" && n.from === "Handy");
  if (pcPlay) {
    await pc.empfangen(pcPlay);
    pruefe("4e. Der Rechner laeuft wieder", pc.player.laeuft,
      `stelle=${pc.player.position.toFixed(2)}`);
  }

  /* ------------------------ 5. Gemeinsam gleichziehen ---------------------- */

  const vorher = tv.bereitZahl;
  pc.raeume.gleichziehen(KEY, pc.player.position, RAUM);
  await warteBis(() => tv.steuerung().some((n) => n.action === "syncprepare"), "syncprepare am Telefon");
  const vorbereiten = tv.steuerung().find((n) => n.action === "syncprepare");
  pruefe("5a. Das Gleichziehen erreicht das Telefon", Boolean(vorbereiten));
  if (vorbereiten) {
    tv.empfangen(vorbereiten);
    pruefe("5b. Das Telefon haelt an und meldet sich bereit",
      !tv.player.laeuft && tv.bereitZahl === vorher + 1,
      `laeuft=${tv.player.laeuft} bereit=${tv.bereitZahl}`);
  }
  const pcVorbereiten = pc.steuerung.find((n) => n.action === "syncprepare");
  if (pcVorbereiten) {
    const urteilPc = await pc.empfangen(pcVorbereiten);
    pruefe("5c. Auch der Rechner haelt zum Gleichziehen an",
      !pc.player.laeuft, `laeuft=${pc.player.laeuft} erledigt=${urteilPc.erledigt}`);
  } else {
    pruefe("5c. Auch der Rechner haelt zum Gleichziehen an", false, "kein syncprepare");
  }
  // Was danach kommt, ist bewusst kein Startbefehl des Relays: "syncall" setzt
  // `eintrag.sync` ausdruecklich auf null (server.js), es wartet also auf keine
  // Bereitmeldung und schickt kein "syncstart". Gleichziehen heisst: alle
  // stehen auf derselben Stelle. Weiter geht es, wenn jemand Play drueckt.
  pruefe("5d. Beide stehen danach auf derselben Stelle",
    Math.abs(tv.player.position - pc.player.position) < 1.5,
    `Telefon=${tv.player.position.toFixed(2)} Rechner=${pc.player.position.toFixed(2)}`);

  const vorWeiter = tv.steuerung().filter((n) => n.action === "play").length;
  pc.melden("play", pc.player.position);
  await warteBis(() => tv.steuerung().filter((n) => n.action === "play").length > vorWeiter,
    "Weiterlaufen am Telefon");
  const weiter = tv.steuerung().filter((n) => n.action === "play" && n.from === "Rechner").pop();
  if (weiter) {
    tv.empfangen(weiter);
    pruefe("5e. Ein Play danach laesst beide gemeinsam weiterlaufen",
      tv.player.laeuft, `stelle=${tv.player.position.toFixed(2)}`);
  } else {
    pruefe("5e. Ein Play danach laesst beide gemeinsam weiterlaufen", false, "kein Play am Telefon");
  }

  /* --------------------------- 6. Die Notbremse ---------------------------- */

  // Der Versatz wird gemessen, aber nicht gleich behoben: ein Sprung ruckelt
  // mehr, als ein paar Sekunden Versatz stoeren. Erst ab fuenf bestaetigten
  // Sekunden greift die Notbremse. Gefragt wird der Rechner - mit einer
  // Messung, wie das Relay sie schickt (hostzeit).
  // Der Host ist die Zeitquelle und wird nie nachgeregelt (steuerungEntscheiden:
  // "selbst host"). Fuer diese Pruefung gehoert die Rolle also dem Telefon.
  if (pcIstHost) {
    pc.raeume.hostUebergeben(KEY, "handy-id", RAUM);
    await warteBis(() => (pc.eintragVon(KEY) || {}).hostId === "handy-id", "Telefon ist Host");
  }
  pruefe("6. Die Rolle des Hosts laesst sich uebergeben",
    (pc.eintragVon(KEY) || {}).hostId === "handy-id",
    `hostId=${(pc.eintragVon(KEY) || {}).hostId}`);
  pc.stillstehen();
  pc.player.laeuft = true;
  const hostzeit = (stelle) => ({
    action: "hostzeit", key: KEY, room: RAUM, position: stelle, videoTime: stelle,
    timestamp: Date.now(), playing: true, hostPlaying: true, url: folge(4),
    episodeId: "s1e4", from: "Handy", sequenceId: 0
  });
  const vorZahl = pc.befehle.length;
  for (let i = 0; i < 4; i++) {
    pc.player.position = 1002;
    await pc.empfangen(hostzeit(1000));
    await schlaf(1100);
  }
  pruefe("6b. Zwei Sekunden Versatz loesen keinen Sprung aus",
    pc.befehle.length === vorZahl,
    `${pc.befehle.length - vorZahl} Befehle`);

  for (let i = 0; i < 6 && pc.befehle.length === vorZahl; i++) {
    pc.player.position = 1012;
    await pc.empfangen(hostzeit(1000));
    await schlaf(1100);
  }
  const gesprungen = pc.befehle.slice(vorZahl).find((b) => b.tun === "stelle" && b.springen);
  pruefe("6c. Ab fuenf bestaetigten Sekunden springt der Rechner",
    Boolean(gesprungen),
    gesprungen ? `auf ${Number(gesprungen.stelle).toFixed(1)}` : "kein Sprung");
  pc.puls();

  /* ------------------------- 7. Der Folgenwechsel -------------------------- */

  const naechste = folge(5);
  pc.raeume.steuernMitAdresse(KEY, "navigate", 0, naechste, RAUM);
  await warteBis(() => tv.steuerung().some((n) => n.action === "navigate" && n.url === naechste),
    "Folgenwechsel am Telefon");
  const wechsel = tv.steuerung().filter((n) => n.action === "navigate" && n.url === naechste).pop();
  pruefe("7a. Der Folgenwechsel des Rechners erreicht das Telefon", Boolean(wechsel));
  if (wechsel) {
    tv.empfangen(wechsel);
    pruefe("7b. Das Telefon steht auf der neuen Folge", tv.player.offen === naechste, tv.player.offen);
  }

  // Und andersherum: das Telefon schaltet weiter, der Rechner zieht nach.
  const uebernaechste = folge(6);
  tv.bruecke.steuernMitAdresse(KEY, "navigate", 0, uebernaechste, RAUM);
  await warteBis(() => pc.steuerung.some((n) => n.action === "navigate" && n.url === uebernaechste),
    "Folgenwechsel am Rechner");
  const pcWechsel = pc.steuerung.filter((n) => n.action === "navigate" && n.url === uebernaechste).pop();
  pruefe("7c. Der Folgenwechsel des Telefons erreicht den Rechner", Boolean(pcWechsel));
  if (pcWechsel) {
    await pc.empfangen(pcWechsel);
    pruefe("7d. Der Rechner laedt die neue Folge im eigenen Player",
      pc.player.url === uebernaechste, pc.player.url);
  }

  pc.stillstehen();
  tv.stillstehen();
  pc.raeume.trennen();
  tv.bruecke.trennen();
  await schlaf(200);

  const gut = pruefungen.filter(Boolean).length;
  console.log(`\n${gut}/${pruefungen.length} bestanden`);
  process.exit(gut === pruefungen.length ? 0 : 1);
})();
