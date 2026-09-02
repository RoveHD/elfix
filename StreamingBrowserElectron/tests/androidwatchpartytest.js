"use strict";
// Android und Rechner in derselben Runde - an einem echten Relay.
//
// `mitschauentest.js` prueft, ob Android das Protokoll richtig bedient. Es
// reicht dabei den Titelschluessel als Konstante herein, auf beiden Seiten
// denselben - und genau darin lag die Luecke, durch die der gemeldete Fehler
// gefallen ist: im Betrieb reicht ihn niemand herein. Der Rechner bildet ihn
// aus Art und Titel ("serie:bleach"), Android bildete ihn aus der Serienadresse
// ("https://aniworld.to/anime/stream/bleach"). Zwei Schluessel, dieselbe Runde -
// und alles, was am Schluessel haengt, fand einander nie:
//
//   - Der am Rechner eingestellte Titel war fuer Android kein Titel: kein Raum,
//     kein Stand, keine Steuerung, keine Teilnehmerleiste.
//   - Der von Android gemeldete Stand landete im Raum unter einem Titel, den es
//     am Rechner nicht gab.
//   - Damit tauchte Android drueben weder als Mitschauer noch als Host auf.
//
// Hier wird der Schluessel deshalb nirgends vorgegeben. Jede Seite bildet ihn
// so, wie sie es im Betrieb tut, und der Test besteht darauf, dass dabei
// dasselbe herauskommt.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const WS = require("../../sync-server/node_modules/ws");
const { WatchpartyRaeume } = require("../src/watchparty-raeume");
const geraeteStand = require("../src/geraete-stand");
const wpSync = require("../src/watchparty-sync");

if (!globalThis.WebSocket) globalThis.WebSocket = WS;

const PORT = Number(process.env.TESTPORT) || 8799;
const ADRESSE = `ws://127.0.0.1:${PORT}`;
const RAUM = "androidraum";
const WURZEL = path.join(__dirname, "..");
const BRUECKEN = path.join(WURZEL, "..", "android/app/src/main/assets/kern/eigen");
const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").replace(/\r/g, "");

const SERIE = "https://aniworld.to/anime/stream/bleach";
const folge = (n) => `${SERIE}/staffel-1/episode-${n}`;
const ZWEITE = "https://s.to/serie/stream/dark";
const zweiteFolge = (n) => `${ZWEITE}/staffel-2/episode-${n}`;

// Ein Eintrag aus "Weiterschauen", wie ihn beide Geraete fuehren.
const EINTRAG = {
  id: "bleach-1",
  title: "Bleach",
  url: folge(4),
  type: "serie",
  season: 1,
  episode: 4,
  currentTime: 312.5,
  duration: 1400,
  providerName: "AniWorld"
};

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

// --- Android: die echte Bruecke, mit demselben Lader wie im WebView ----------

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
  vm.runInNewContext(fs.readFileSync(path.join(BRUECKEN, "watchparty-bruecke.js"), "utf8"), {
    require: lader,
    module: modul,
    exports: modul.exports,
    console,
    window: {
      crypto: { randomUUID: () => `${name}-${Math.random().toString(16).slice(2)}` },
      ElfixKern: { ereignis: (art, nutzlast) => ereignisse.push({ art, nutzlast }) },
      WebSocket: WS
    },
    WebSocket: WS,
    globalThis: { WebSocket: WS },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, JSON, Math, Number, String, Object, Array, Boolean,
    Set, Map, WeakSet, Error, RegExp, URL, Promise, Symbol
  });
  const bruecke = modul.exports;
  let sitzung = 1;
  let takt = null;
  let lage = null;
  const api = {
    name, bruecke, ereignisse,
    steuerung: () => ereignisse.filter((e) => e.art === "watchparty:steuerung").map((e) => e.nutzlast),
    staende: () => ereignisse.filter((e) => e.art === "watchparty:stand").map((e) => e.nutzlast),
    // Was Mitschauen.java tut: es fragt die Bruecke, zu welchem Titel und
    // welcher Runde die offene Adresse gehoert. Kein vorgegebener Schluessel.
    lageFuer: (offen) => bruecke.lageFuer(offen),
    // Der Horcher im Player, woertlich dieselbe Zeile.
    melden: (aktion, position, offen) => {
      const l = bruecke.lageFuer(offen);
      if (!l.key) return null;
      return bruecke.meldungSenden(
        `${wpSync.MELDE_AKTION}${aktion}:${position.toFixed(2)}`, l.key, offen, l.room);
    },
    stand: (position, pausiert, offen) => {
      const l = bruecke.lageFuer(offen);
      if (!l.key) return null;
      return bruecke.meldungStand(
        `${wpSync.MELDE_STAND}${position.toFixed(2)}:${pausiert ? 1 : 0}`, l.key, {
          url: offen,
          season: Number((String(offen).match(/staffel-(\d+)/) || [])[1] || 0),
          episode: Number((String(offen).match(/episode-(\d+)/) || [])[1] || 0),
          playerSessionId: `${name}-sitzung-${sitzung}`
        }, l.room);
    },
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
    neuerPlayer: () => { sitzung += 1; }
  };
  return api;
}

// --- Der Rechner: dieselbe Klasse und derselbe Schluessel wie in main.js -----

// main.js bildet ihn so, und nur so. Steht die Zeile dort einmal anders da,
// faellt es hier auf und nicht erst in einer Runde mit zwei Geraeten.
const MAIN_BILDET_KEY = MAIN.includes("return geraeteStand.titelSchluessel(favorite);");
const watchpartyKey = (favorit) => geraeteStand.titelSchluessel(favorit);

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
  let takt = null;
  let lage = null;
  const api = {
    name, raeume, steuerung, staende,
    eintragVon: (key) => raeume.eintraege().find((e) => e.key === key) || null,
    stand: (key, position, pausiert, offen) => raeume.meldeStand(key, {
      position, paused: pausiert, url: offen,
      season: Number((String(offen).match(/staffel-(\d+)/) || [])[1] || 0),
      episode: Number((String(offen).match(/episode-(\d+)/) || [])[1] || 0),
      playerSessionId: `${name}-sitzung`
    }, RAUM),
    puls: (key, position, pausiert, offen) => {
      lage = { key, position, pausiert, offen };
      if (!takt) {
        takt = setInterval(() => {
          if (lage) api.stand(lage.key, lage.position, lage.pausiert, lage.offen);
        }, 700);
        takt.unref?.();
      }
      api.stand(key, position, pausiert, offen);
    },
    stillstehen: () => {
      if (takt) clearInterval(takt);
      takt = null;
      lage = null;
    },
    melden: (key, aktion, position, offen) =>
      raeume.steuernMitAdresse(key, aktion, position, offen, RAUM)
  };
  return api;
}

(async () => {
  /* ============================ 1. Der Schluessel ========================= */

  const tv = android("Handy");
  pruefe("1a. main.js bildet den Titelschluessel weiter ueber geraete-stand",
    MAIN_BILDET_KEY,
    "sonst gilt der Vergleich unten nicht mehr");

  const pcKey = watchpartyKey(EINTRAG);
  const androidKey = tv.bruecke.titelSchluessel(EINTRAG);
  pruefe("1b. Android bildet denselben Titelschluessel wie der Rechner",
    androidKey === pcKey && pcKey === "serie:bleach",
    `Android="${androidKey}" Rechner="${pcKey}"`);

  // Der alte Weg - festgehalten, damit niemand versehentlich dorthin zurueck
  // faellt. Er ist nicht bloss anders, er ist mit dem Rechner unvertraeglich.
  const alterAndroidKey = EINTRAG.url
    .replace(/(?:\/(?:staffel|season)-\d+(?:\/(?:episode|folge)-\d+)?)\/?$/i, "")
    .toLowerCase();
  pruefe("1c. Der frueher gebildete Adressschluessel war ein anderer",
    alterAndroidKey !== pcKey,
    `${alterAndroidKey} != ${pcKey}`);

  pruefe("1d. Ein Film bekommt seine eigene Art in den Schluessel",
    tv.bruecke.titelSchluessel({ title: "Dune", url: "https://s.to/filme/stream/dune", type: "film" })
      === watchpartyKey({ title: "Dune", url: "https://s.to/filme/stream/dune", type: "film" }),
    tv.bruecke.titelSchluessel({ title: "Dune", url: "https://s.to/filme/stream/dune", type: "film" }));

  /* ====================== 2. Beide in derselben Runde ===================== */

  const pc = rechner("Rechner");
  tv.bruecke.konfigurieren({
    enabled: true, serverUrl: ADRESSE, rooms: [RAUM], deviceName: "Handy", deviceId: "handy-id"
  });
  await warteBis(() => pc.raeume.verbunden, "Rechner verbunden");
  await warteBis(() => tv.bruecke.status().connected, "Android verbunden");
  pruefe("2a. Beide Geraete sind am Relay",
    pc.raeume.verbunden && tv.bruecke.status().connected);

  // Der Rechner stellt den Titel ein - mit *seinem* Schluessel, so wie er es
  // in openWatchpartyItem tut.
  pc.raeume.teilen({
    key: pcKey, url: folge(4), title: EINTRAG.title, providerName: "AniWorld",
    type: "serie", season: 1, episode: 4
  }, RAUM);
  await warteBis(() => tv.bruecke.eintraege().some((e) => e.key === pcKey),
    "Android sieht den Titel des Rechners");
  pruefe("2b. Android sieht den vom Rechner eingestellten Titel",
    tv.bruecke.eintraege().some((e) => e.key === pcKey));

  pc.raeume.beitreten(pcKey, RAUM);
  tv.bruecke.beitreten(pcKey, RAUM);
  await warteBis(() => pc.eintragVon(pcKey)?.joined
    && tv.bruecke.eintraege().find((e) => e.key === pcKey)?.joined, "beide beigetreten");

  // Und hier die eigentliche Reparatur: Android findet ueber die *offene
  // Adresse* zurueck zu Titel und Raum. Vorher rechnete es sich selbst einen
  // Schluessel aus, der auf keinen Eintrag passte - und damit war die Seite
  // fuer die Watchparty privat.
  const lage = tv.lageFuer(folge(4));
  pruefe("2c. Android findet ueber die offene Folge Titel und Raum",
    lage.key === pcKey && lage.room === RAUM,
    JSON.stringify(lage));
  pruefe("2d. Auch fuer eine andere Folge derselben Serie",
    tv.lageFuer(folge(9)).key === pcKey,
    tv.lageFuer(folge(9)).key);
  pruefe("2e. Und fuer eine fremde Serie gilt sie nicht",
    tv.lageFuer(zweiteFolge(1)).key === "",
    tv.lageFuer(zweiteFolge(1)).key);

  /* ===== 2f. Der Beitritt allein genuegt fuer "Gemeinsam weiterschauen" ==== */
  //
  // Gemeldet: auf dem Fernseher gab es die Reihe gar nicht, auf dem Telefon
  // schon, und auf keinem Geraet standen alle Runden darin. Die Reihe zeigt
  // Eintraege der eigenen Ablage mit Raum - und einen solchen legte bisher nur
  // ein *eingehender Fortschritt* an. Ein Titel, den in der Runde noch niemand
  // angefangen hat, meldet nie einen; ein Geraet, das gerade nicht lief,
  // verpasst ihn. Beigetreten war man trotzdem.
  //
  // Hier steht genau diese Lage: beigetreten, kein Fortschritt gemeldet. Java
  // ruft nach jedem Raumzustand fuer jeden betretenen Titel
  // `raumEintragSichern` - mit leerem Stand, weil es keinen gibt.
  {
    const anbieter = [{ id: "aniworld", name: "AniWorld", startUrl: "https://aniworld.to/" }];
    const leer = tv.bruecke.raumEintragSichern({ favoriten: [] }, pcKey, RAUM, anbieter, {});
    pruefe("2f. Ein betretener Titel ergibt einen Eintrag mit Raum",
      Boolean(leer.eintragId) && leer.neu === true
      && leer.favoriten.some((f) => f.watchpartyRoom === RAUM),
      JSON.stringify({ id: leer.eintragId, neu: leer.neu, raeume: leer.favoriten.map((f) => f.watchpartyRoom) }));

    // Und zweimal gerufen entsteht nicht zweimal etwas: Raumzustaende kommen
    // oft, ein Eintrag je Titel und Raum reicht.
    const nochmal = tv.bruecke.raumEintragSichern({ favoriten: leer.favoriten }, pcKey, RAUM, anbieter, {});
    pruefe("2g. Ein zweiter Aufruf legt nichts Zweites an",
      nochmal.neu === false && nochmal.favoriten.length === leer.favoriten.length,
      `${nochmal.favoriten.length} Eintraege`);

    // Der leere Stand darf den des Raums nicht verdecken. `{}` ist wahr - ohne
    // die Unterscheidung faenge ein beim Beitritt entstehender Eintrag bei
    // null Sekunden an, obwohl der Raum laengst eine Stelle kennt.
    const mitStand = tv.bruecke.raumEintragSichern({ favoriten: [] }, pcKey, RAUM, anbieter, {});
    const ausRaum = tv.bruecke.eintraege().find((e) => e.key === pcKey)?.progress;
    const angelegt = mitStand.favoriten.find((f) => f.watchpartyRoom === RAUM);
    pruefe("2h. Ein leerer Stand verdeckt den des Raums nicht",
      !ausRaum || Math.round(angelegt.position || 0) === Math.round(ausRaum.position || 0),
      `Raum ${ausRaum ? Math.round(ausRaum.position || 0) : "-"}s, Eintrag ${Math.round(angelegt.position || 0)}s`);
  }

  /* ===== 2i. Zwei Runden, ein Aufruf ====================================== */
  //
  // Der Fehler, den das hier festhaelt: Java rief `raumEintragSichern` je
  // Titel einmal, in einer Schleife. Jeder Aufruf reicht die ganze Ablage in
  // den Kern und bekommt eine neue Liste zurueck - aber erst spaeter, denn der
  // Kern antwortet asynchron. Die Schleife war also durch, bevor die erste
  // Antwort kam: alle Aufrufe trugen denselben Schnappschuss, und die letzte
  // Antwort ueberschrieb die Ablage mit einer Liste, in der die anderen
  // Neuzugaenge nie standen.
  //
  // Am 2026-08-29 am Fire TV Stick gemessen: vier Eintraege gemeldet, Bestand
  // danach 80 -> 81, drei davon beim naechsten Start wieder neu. Auf der
  // Startseite kam je Start genau eine Runde dazu.
  //
  // Deshalb laeuft die Schleife jetzt im Kern, und der Test fragt genau das:
  // zwei betretene Titel, ein Aufruf, zwei Eintraege.
  {
    const anbieter = [
      { id: "aniworld", name: "AniWorld", startUrl: "https://aniworld.to/" },
      { id: "sto", name: "S.to", startUrl: "https://s.to/" }
    ];
    const zweiterKey = watchpartyKey({ title: "Dark", url: zweiteFolge(1), type: "serie" });
    pc.raeume.teilen({
      key: zweiterKey, url: zweiteFolge(1), title: "Dark", providerName: "S.to",
      type: "serie", season: 2, episode: 1
    }, RAUM);
    await warteBis(() => tv.bruecke.eintraege().some((e) => e.key === zweiterKey),
      "Android sieht die zweite Runde");
    tv.bruecke.beitreten(zweiterKey, RAUM);
    await warteBis(() => tv.bruecke.eintraege().find((e) => e.key === zweiterKey)?.joined,
      "Android ist der zweiten Runde beigetreten");

    const alle = tv.bruecke.raumEintraegeSichern({ favoriten: [] }, anbieter);
    const raeumeDrin = alle.favoriten.filter((f) => f.watchpartyRoom === RAUM);
    pruefe("2i. Ein Aufruf legt beide betretenen Runden an",
      alle.angelegt === 2 && raeumeDrin.length === 2
      && alle.gesichert.length === 2,
      JSON.stringify({ angelegt: alle.angelegt, eintraege: raeumeDrin.map((f) => f.title) }));

    // Und ein zweiter Durchgang auf derselben Liste legt nichts nach.
    const wieder = tv.bruecke.raumEintraegeSichern({ favoriten: alle.favoriten }, anbieter);
    pruefe("2j. Ein zweiter Durchgang legt nichts nach",
      wieder.angelegt === 0 && wieder.favoriten.length === alle.favoriten.length,
      `${wieder.favoriten.length} Eintraege`);
  }

  /* ================= 3. Presence: wer steht auf welcher Seite ============= */

  pc.puls(pcKey, 0, true, folge(4));
  await schlaf(200);
  tv.puls(0, true, folge(4));

  const mitgliederAus = (staende, key) => {
    for (let i = staende.length - 1; i >= 0; i -= 1) {
      const eintrag = typeof staende[i] === "string" ? JSON.parse(staende[i]) : staende[i];
      if (eintrag && eintrag.key === key) return eintrag.members || [];
    }
    return [];
  };

  await warteBis(() => mitgliederAus(pc.staende, pcKey).length >= 2,
    "der Rechner sieht beide Teilnehmer");
  const amRechner = mitgliederAus(pc.staende, pcKey);
  pruefe("3a. Android erscheint am Rechner als Mitschauer",
    amRechner.some((m) => m.name === "Handy"),
    JSON.stringify(amRechner.map((m) => m.name)));
  pruefe("3b. Der Rechner steht dort ebenfalls",
    amRechner.some((m) => m.name === "Rechner"),
    JSON.stringify(amRechner.map((m) => m.name)));
  pruefe("3c. Niemand steht doppelt",
    new Set(amRechner.map((m) => m.id)).size === amRechner.length,
    JSON.stringify(amRechner.map((m) => m.id)));

  await warteBis(() => mitgliederAus(tv.staende(), pcKey).length >= 2,
    "Android sieht beide Teilnehmer");
  const amHandy = mitgliederAus(tv.staende(), pcKey);
  pruefe("3d. Der Rechner erscheint auf Android als Mitschauer",
    amHandy.some((m) => m.name === "Rechner"),
    JSON.stringify(amHandy.map((m) => m.name)));

  // Der Host: der Rechner war zuerst an dieser Folge.
  pruefe("3e. Beide Seiten nennen denselben Host",
    amRechner.find((m) => m.host)?.name === "Rechner"
    && amHandy.find((m) => m.host)?.name === "Rechner",
    `Rechner sagt ${amRechner.find((m) => m.host)?.name}, `
    + `Android sagt ${amHandy.find((m) => m.host)?.name}`);
  pruefe("3f. Und der Raumzustand nennt ihn auch so",
    tv.bruecke.eintraege().find((e) => e.key === pcKey)?.hostName === "Rechner",
    tv.bruecke.eintraege().find((e) => e.key === pcKey)?.hostName);

  /* ================== 4. Steuerung in beide Richtungen ==================== */

  pc.steuerung.length = 0;
  tv.ereignisse.length = 0;
  tv.melden("pause", 84, folge(4));
  await warteBis(() => pc.steuerung.some((m) => m.action === "pause"),
    "Pause von Android kommt am Rechner an");
  pruefe("4a. Pause von Android pausiert den Rechner",
    pc.steuerung.some((m) => m.action === "pause"),
    JSON.stringify(pc.steuerung.map((m) => m.action)));

  tv.ereignisse.length = 0;
  pc.melden(pcKey, "play", 90, folge(4));
  await warteBis(() => tv.steuerung().some((m) => m.action === "play"),
    "Play vom Rechner kommt auf Android an");
  const spielen = tv.steuerung().find((m) => m.action === "play");
  pruefe("4b. Play vom Rechner kommt auf Android an", Boolean(spielen));
  const urteil = spielen ? tv.bruecke.steuerungPruefen(spielen, {
    binHost: false, hostId: "Rechner-id", gleicheAdresse: true, season: 1, episode: 4
  }) : null;
  pruefe("4c. Android wendet es auf den Player an",
    Boolean(urteil) && urteil.tun === "anwenden" && urteil.skript.includes("media.play()"),
    urteil ? urteil.tun : "kein Urteil");

  // Keine Schleife: der angewendete Befehl darf nicht als eigene Tat
  // zurueckgehen. Das Skript setzt dafuer den Erwartungsmerker im Player.
  pruefe("4d. Der angewendete Befehl traegt den Echo-Schutz",
    Boolean(urteil) && urteil.skript.includes("__elfixWpErwartet"),
    "sonst meldet der eigene Player das Echo als eigene Tat zurueck");

  // Manueller Sprung von Android - und der bleibt jetzt bei Android.
  //
  // Der Rechner hat geteilt und ist Host. Frueher reichte das Relay den Sprung
  // eines Gasts an alle weiter; der Host sprang mit und wurde vom naechsten
  // Ausgleich wieder zurueckgeholt. Seit der Host-Autoritaet bewegt nur der
  // Host die Runde durch Spulen. Android spult bei sich - wo es steht,
  // erfahren die anderen mit dem naechsten Herzschlag.
  pc.steuerung.length = 0;
  tv.melden("seek", 640, folge(4));
  await new Promise((r) => setTimeout(r, 1200));
  pruefe("4e. Ein Sprung von Android bewegt den Host nicht",
    !pc.steuerung.some((m) => m.action === "seek"),
    JSON.stringify(pc.steuerung.map((m) => `${m.action}@${Math.round(m.position)}`)));

  /* ========== 5. Android geht voran - der Host bleibt trotzdem ========== */

  // Android geht eine Folge weiter und meldet sich dort zuerst an.
  // Frueher wurde es damit Host: die Rolle hing daran, wer die Folge zuerst
  // betreten hat, also gewann, wessen Hoster schneller laedt. Jetzt bleibt der
  // Rechner Host - der Folgenwechsel allein ist keine Hostfrage. Play und Pause
  // von Android wirken weiterhin (5c), nur Spulen nicht mehr.
  pc.steuerung.length = 0;
  tv.stillstehen();
  tv.neuerPlayer();
  tv.bruecke.folgenwechselMelden(pcKey, folge(5), RAUM);
  await warteBis(() => pc.steuerung.some((m) => m.action === "navigate"),
    "der Rechner erfaehrt vom Folgenwechsel");
  pruefe("5a. Ein Folgenwechsel von Android erreicht den Rechner",
    pc.steuerung.some((m) => m.action === "navigate" && String(m.url).includes("episode-5")),
    JSON.stringify(pc.steuerung.map((m) => m.action)));

  tv.puls(0, false, folge(5));
  await schlaf(400);
  pc.stillstehen();
  pc.puls(pcKey, 0, false, folge(5));
  await schlaf(600);
  const neueRunde = mitgliederAus(pc.staende, pcKey);
  pruefe("5b. Wer die neue Folge schneller laedt, wird davon nicht Host",
    neueRunde.find((m) => m.host)?.name === "Rechner",
    `Host laut Rechner: ${neueRunde.find((m) => m.host)?.name}`);

  pc.steuerung.length = 0;
  tv.melden("pause", 120, folge(5));
  await warteBis(() => pc.steuerung.some((m) => m.action === "pause"),
    "Pause des Android-Hosts erreicht den Rechner");
  pruefe("5c. Die Pause des Android-Hosts haelt den Rechner an",
    pc.steuerung.some((m) => m.action === "pause"),
    JSON.stringify(pc.steuerung.map((m) => m.action)));

  /* ================ 6. Android stellt selbst einen Titel ein ============== */

  const eigenerTitel = {
    title: "Dark", url: ZWEITE, type: "serie", season: 2, episode: 1,
    providerName: "S.to", thumbnail: ""
  };
  // Ohne Schluessel - genau so, wie Watchparty.java ihn jetzt einstellt.
  tv.bruecke.teilen(eigenerTitel, RAUM);
  const darkKey = watchpartyKey(eigenerTitel);
  await warteBis(() => pc.eintragVon(darkKey), "der Rechner sieht den Titel von Android");
  pruefe("6a. Ein von Android eingestellter Titel traegt den Schluessel des Rechners",
    Boolean(pc.eintragVon(darkKey)) && darkKey === "serie:dark",
    darkKey);
  pruefe("6b. Und der Rechner kann ihn seinem eigenen Eintrag zuordnen",
    watchpartyKey({ title: "Dark", url: zweiteFolge(3), type: "serie" }) === darkKey,
    "sonst legt der Rechner einen zweiten Weiterschauen-Eintrag an");

  /* ======================= 7. Verlassen und Reconnect ===================== */

  tv.stillstehen();
  tv.bruecke.verlasseStand(pcKey, RAUM);
  await warteBis(() => !mitgliederAus(pc.staende, pcKey).some((m) => m.name === "Handy"),
    "Android verschwindet aus der Leiste");
  pruefe("7a. Wer den Player verlaesst, verschwindet aus der Teilnehmerleiste",
    !mitgliederAus(pc.staende, pcKey).some((m) => m.name === "Handy"),
    JSON.stringify(mitgliederAus(pc.staende, pcKey).map((m) => m.name)));

  tv.neuerPlayer();
  tv.puls(130, false, folge(5));
  await warteBis(() => mitgliederAus(pc.staende, pcKey).some((m) => m.name === "Handy"),
    "Android meldet sich zurueck");
  pruefe("7b. Und ist nach der Rueckkehr sofort wieder dabei",
    mitgliederAus(pc.staende, pcKey).some((m) => m.name === "Handy"));
  pruefe("7c. Auch dann nur einmal",
    mitgliederAus(pc.staende, pcKey).filter((m) => m.name === "Handy").length === 1,
    JSON.stringify(mitgliederAus(pc.staende, pcKey).map((m) => m.name)));

  /* ========== 8. Die Gegenprobe: mit dem alten Schluessel geht nichts ===== */

  // Nicht als Beschreibung, sondern ausgefuehrt. Unter dem Adressschluessel,
  // den Android frueher bildete, ist dieses Geraet in keinem Titel Mitglied -
  // das Relay laesst Stand und Steuerung fallen, und genau deshalb tauchte das
  // Telefon am Rechner nie auf.
  pc.staende.length = 0;
  pc.steuerung.length = 0;
  tv.bruecke.meldeStand(alterAndroidKey, {
    position: 999, paused: false, url: folge(5), season: 1, episode: 5,
    playerSessionId: "gegenprobe"
  }, RAUM);
  tv.bruecke.steuernMitAdresse(alterAndroidKey, "pause", 999, folge(5), RAUM);
  await schlaf(1200);
  pruefe("8a. Unter dem alten Adressschluessel kommt kein Stand an",
    !pc.staende.some((eintrag) => {
      const wert = typeof eintrag === "string" ? JSON.parse(eintrag) : eintrag;
      return wert && wert.key === alterAndroidKey;
    }),
    "das Relay kennt diesen Titel nicht - Android waere unsichtbar");
  pruefe("8b. Und keine Steuerung",
    !pc.steuerung.some((m) => m.key === alterAndroidKey),
    "Pause vom Telefon ging damit ins Leere");

  tv.stillstehen();
  pc.stillstehen();
  tv.bruecke.trennen();
  pc.raeume.trennen();
  await schlaf(200);

  const fehler = pruefungen.filter((ok) => !ok).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  process.exit(fehler ? 1 : 0);
})().catch((fehler) => {
  console.log("FAIL  Abbruch   -> " + (fehler && fehler.stack || fehler));
  process.exit(1);
});
