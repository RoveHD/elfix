"use strict";
// Die Testmatrix der Watchparty: Rechner, Telefon und Fernseher gegeneinander,
// an einem echten Relay.
//
// `mitschauentest.js` prueft Rechner gegen ein Android-Geraet. Was dort fehlt,
// ist genau das, worum es bei "Android soll dem Desktop entsprechen" geht:
//
//   - Zwei Android-Geraete unter sich. Bei Rechner-gegen-Android faellt nicht
//     auf, wenn die Bruecke etwas nur deshalb richtig macht, weil der Rechner
//     es fuer sie ausgleicht.
//   - Der Einstieg nach einem Folgenwechsel. Der Gast laedt Sekunden, waehrend
//     der Host weiterlaeuft - und muss danach dort sein, wo der Host *jetzt*
//     ist, nicht wo er beim Absenden war.
//   - Und der Gegenfall: haelt der Host waehrenddessen an, darf gar nicht
//     hochgerechnet werden. Der Gast kommt pausiert an.
//
// Die Faelle tragen unten ihre Nummern aus der Aufgabe (W1 bis W16). Was schon
// in `mitschauentest.js` steht, ist dort vermerkt statt hier doppelt geprueft.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const WS = require("../../sync-server/node_modules/ws");
const { WatchpartyRaeume } = require("../src/watchparty-raeume");
const wpSync = require("../src/watchparty-sync");

if (!globalThis.WebSocket) globalThis.WebSocket = WS;

const PORT = Number(process.env.TESTPORT) || 8799;
const ADRESSE = `ws://127.0.0.1:${PORT}`;
const RAUM = "matrixraum";
const WURZEL = path.join(__dirname, "..");
const BRUECKEN = path.join(WURZEL, "..", "android/app/src/main/assets/kern/eigen");

const SERIE = "https://aniworld.to/anime/stream/attack-on-titan";
const KEY = SERIE.toLowerCase();
const folge = (n) => `${SERIE}/staffel-2/episode-${n}`;

const ANBIETER = [
  { id: "aniworld", name: "AniWorld", startUrl: "https://aniworld.to/", searchUrl: "", logo: "AW" }
];

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

async function warteBis(bedingung, was, hoechstens = 9000) {
  // Gewartet wird auf ein Ereignis und nicht auf eine Zahl: ein Abgleich ueber
  // eine echte Verbindung dauert unterschiedlich lange, auf einem geteilten
  // Rechner leicht das Fuenffache.
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

/**
 * Ein Android-Geraet - Bruecke plus das, was Mitschauen.java darum herum tut.
 *
 * <p>Nachgebaut wird ausdruecklich das Verhalten und nicht nur der Aufruf:
 * welche Folge offen steht, wann der Player wirklich da ist, und dass sich
 * dieses Geraet erst dann bei der Runde einklinkt. Genau in dieser Reihenfolge
 * sass der Fehler.
 */
function android(name, kennung) {
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

  let offen = "";
  let sitzung = 1;
  let takt = null;
  let lage = null;
  // Der Merker aus Mitschauen.java: je Raum, Titel und Folge einmal einklinken.
  const angeklinkt = new Set();

  const steuerung = () => ereignisse
    .filter((e) => e.art === "watchparty:steuerung").map((e) => e.nutzlast);
  const eintragVon = () => bruecke.eintraege().find((e) => e.key === KEY) || null;
  const folgeAus = (url) => Number((String(url).match(/episode-(\d+)/) || [])[1] || 0);

  const api = {
    name,
    kennung,
    bruecke,
    ereignisse,
    steuerung,
    eintragVon,
    offene: () => offen,
    /**
     * Die Lage, wie Mitschauen.steuerung() sie zusammenstellt.
     *
     * <p>Mit derselben Ausnahme: das gemeinsame Gleichziehen richtet sich
     * ausdruecklich auch an die, bei denen die falsche Folge steht - sie sollen
     * erst wechseln und dann mitkommen. Waere die Folgenpruefung dafuer scharf,
     * faenden sie sich als "andere Folge" abgewiesen wieder und blieben zurueck,
     * waehrend alle anderen gemeinsam starten. Der Rechner fragt an derselben
     * Stelle mit {@code gleicheAdresse: true, offen: null}.
     */
    lage: (nachricht) => {
      const eintrag = eintragVon();
      const gleichziehen = Boolean(nachricht) && nachricht.action === "syncprepare";
      return {
        binHost: Boolean(eintrag && eintrag.hostId && eintrag.hostId === eintrag.myId),
        hostId: (eintrag && eintrag.hostId) || "",
        gleicheAdresse: true,
        season: gleichziehen ? 0 : 2,
        episode: gleichziehen ? 0 : folgeAus(offen)
      };
    },
    binHost: () => {
      const eintrag = eintragVon();
      return Boolean(eintrag && eintrag.hostId && eintrag.hostId === eintrag.myId);
    },
    stand: (position, pausiert) => bruecke.meldungStand(
      `${wpSync.MELDE_STAND}${position.toFixed(2)}:${pausiert ? 1 : 0}`, KEY, {
        url: offen, season: 2, episode: folgeAus(offen),
        playerSessionId: `${name}-sitzung-${sitzung}`
      }, RAUM),
    puls: (position, pausiert) => {
      lage = { position, pausiert };
      if (!takt) {
        takt = setInterval(() => { if (lage) api.stand(lage.position, lage.pausiert); }, 700);
        takt.unref?.();
      }
      api.stand(position, pausiert);
    },
    stillstehen: () => {
      if (takt) clearInterval(takt);
      takt = null;
      lage = null;
    },
    melden: (aktion, position) => bruecke.meldungSenden(
      `${wpSync.MELDE_AKTION}${aktion}:${position.toFixed(2)}`, KEY, offen, RAUM),

    /**
     * Eine Folge oeffnen - so, wie die App es tut.
     *
     * <p>Der Player ist danach *noch nicht* da: auf dem Telefon wird erst die
     * Seite geladen und dann der Hoster angeklickt. Genau dieses Zeitfenster
     * ist der Unterschied, an dem der Einstieg frueher scheiterte.
     */
    oeffnen: (url) => {
      bruecke.zuruecksetzen(KEY, RAUM);
      angeklinkt.clear();
      sitzung += 1;
      offen = url;
    },
    /**
     * Der Player ist da - jetzt klinkt sich das Geraet ein.
     *
     * <p>Mitschauen.anPlayer(): sobald sich ein Rahmen mit Video meldet, geht
     * der eigene Stand hinaus und der Stand der Runde wird angefordert.
     */
    playerDa: () => {
      const marke = `${RAUM}|${KEY}|e${folgeAus(offen)}`;
      if (angeklinkt.has(marke)) return false;
      angeklinkt.add(marke);
      api.stand(0, true);
      bruecke.abgleichen(KEY, RAUM);
      return true;
    },
    an: (raeume = [RAUM]) => bruecke.konfigurieren({
      enabled: true, serverUrl: ADRESSE, rooms: raeume, deviceName: name, deviceId: kennung
    }),
    aus: () => bruecke.trennen()
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
  let offen = "";
  let takt = null;
  let lage = null;
  const eintragVon = () => raeume.eintraege().find((e) => e.key === KEY) || null;
  const api = {
    name, raeume, steuerung, staende, eintragVon,
    offene: () => offen,
    oeffnen: (url) => { offen = url; },
    binHost: () => {
      const eintrag = eintragVon();
      return Boolean(eintrag && eintrag.hostId && eintrag.hostId === eintrag.myId);
    },
    stand: (position, pausiert) => raeume.meldeStand(KEY, {
      position, paused: pausiert, url: offen, season: 2,
      episode: Number((String(offen).match(/episode-(\d+)/) || [])[1] || 0),
      playerSessionId: `${name}-sitzung`
    }, RAUM),
    puls: (position, pausiert) => {
      lage = { position, pausiert };
      if (!takt) {
        takt = setInterval(() => { if (lage) api.stand(lage.position, lage.pausiert); }, 700);
        takt.unref?.();
      }
      api.stand(position, pausiert);
    },
    stillstehen: () => {
      if (takt) clearInterval(takt);
      takt = null;
      lage = null;
    },
    melden: (aktion, position) => raeume.steuernMitAdresse(KEY, aktion, position, offen, RAUM)
  };
  return api;
}

/** Das Ereignis, das ein erzeugtes Player-Skript wirklich mitbekommt. */
function ereignisAusSkript(skript) {
  const treffer = String(skript || "").match(/const E = (\{[^\n]*?\});/);
  if (!treffer) return null;
  try {
    return JSON.parse(treffer[1]);
  } catch {
    return null;
  }
}

(async () => {
  const pc = rechner("Rechner");
  const tv = android("AndroidTV", "tv-id");
  const handy = android("Handy", "handy-id");
  tv.an();
  handy.an();

  await warteBis(() => pc.raeume.verbunden, "Rechner verbunden");
  await warteBis(() => tv.bruecke.status().connected, "Fernseher verbunden");
  await warteBis(() => handy.bruecke.status().connected, "Telefon verbunden");
  pruefe("Alle drei Geraete sind am Relay",
    pc.raeume.verbunden && tv.bruecke.status().connected && handy.bruecke.status().connected);

  pc.raeume.teilen({
    key: KEY, url: folge(4), title: "Attack on Titan", providerName: "AniWorld",
    type: "serie", season: 2, episode: 4
  }, RAUM);
  await warteBis(() => tv.eintragVon() && handy.eintragVon(), "beide Android-Geraete sehen den Titel");
  pc.raeume.beitreten(KEY, RAUM);
  tv.bruecke.beitreten(KEY, RAUM);
  handy.bruecke.beitreten(KEY, RAUM);
  await warteBis(() => tv.eintragVon()?.joined && handy.eintragVon()?.joined, "beide beigetreten");

  /* ------------------------------------------------------------------- W3 */
  // Android TV fuehrt, das Telefon ist Gast. Zwei Android-Geraete unter sich -
  // ohne einen Rechner, der etwas ausgleichen koennte.

  tv.oeffnen(folge(4));
  tv.puls(0, true);
  await schlaf(200);
  handy.oeffnen(folge(4));
  handy.puls(0, true);
  await warteBis(() => tv.binHost(), "W3: der Fernseher fuehrt");
  pruefe("W3. Der Fernseher fuehrt - er war zuerst an der Folge",
    tv.binHost() && !handy.binHost(),
    `hostId=${tv.eintragVon()?.hostId}`);

  handy.ereignisse.length = 0;
  tv.melden("play", 30);
  await warteBis(() => handy.steuerung().some((m) => m.action === "play"),
    "W3: das Telefon empfaengt play");
  {
    const play = handy.steuerung().find((m) => m.action === "play");
    const urteil = play ? handy.bruecke.steuerungPruefen(play, handy.lage(play)) : null;
    pruefe("W3. Play vom Fernseher startet das Telefon",
      Boolean(urteil) && urteil.tun === "anwenden" && urteil.skript.includes("media.play()"),
      urteil ? `${urteil.tun} (${urteil.grund})` : "kein Urteil");
  }

  handy.ereignisse.length = 0;
  tv.melden("pause", 45);
  await warteBis(() => handy.steuerung().some((m) => m.action === "pause"),
    "W3: das Telefon empfaengt pause");
  {
    const pause = handy.steuerung().find((m) => m.action === "pause");
    const urteil = pause ? handy.bruecke.steuerungPruefen(pause, handy.lage(pause)) : null;
    pruefe("W3. Pause vom Fernseher haelt das Telefon an",
      Boolean(urteil) && urteil.tun === "anwenden" && urteil.skript.includes("media.pause()"),
      urteil ? urteil.tun : "kein Urteil");
  }

  tv.ereignisse.length = 0;
  handy.melden("seek", 300);
  await warteBis(() => tv.steuerung().some((m) => m.action === "seek"),
    "W3: der Fernseher empfaengt den Sprung des Telefons");
  pruefe("W3. Und ein Sprung des Gasts erreicht den Fernseher",
    tv.steuerung().some((m) => m.action === "seek" && Math.abs(m.position - 300) < 1),
    tv.steuerung().map((m) => `${m.action}@${Math.round(m.position)}`).join(","));

  /* --------------------------------------------------------------- W6 + W8 */
  // Der Host wechselt auf Folge 5 und laeuft dort weiter. Der Gast folgt,
  // braucht aber Zeit zum Laden - und muss danach dort einsteigen, wo der Host
  // *jetzt* steht.

  handy.ereignisse.length = 0;
  tv.oeffnen(folge(5));
  tv.bruecke.folgenwechselMelden(KEY, folge(5), RAUM);
  tv.puls(0, false);
  await warteBis(() => handy.steuerung().some((m) => m.action === "navigate"),
    "W6: das Telefon bekommt den Folgenwechsel");
  {
    const nav = handy.steuerung().find((m) => m.action === "navigate");
    const urteil = nav ? handy.bruecke.steuerungPruefen(nav, handy.lage(nav)) : null;
    pruefe("W6. Der Folgenwechsel kommt als Wechsel an, mit der neuen Adresse",
      Boolean(urteil) && urteil.tun === "navigate" && urteil.url === folge(5),
      urteil ? `${urteil.tun} ${urteil.url}` : "kein Urteil");
  }

  // Der Host laeuft weiter, waehrend der Gast laedt.
  tv.puls(12, false);
  await schlaf(300);

  // Das Telefon oeffnet Folge 5 - und der Player ist noch nicht da.
  handy.oeffnen(folge(5));
  handy.ereignisse.length = 0;
  // Fuenf Sekunden Ladezeit. Genau das Fenster, in dem der Host weiterlaeuft.
  const geladenAb = Date.now();
  await schlaf(1200);
  tv.puls(13.2, false);
  await schlaf(300);

  // Jetzt steht der Player - erst hier klinkt sich das Telefon ein.
  const eingeklinkt = handy.playerDa();
  pruefe("W6. Der Gast klinkt sich erst ein, wenn sein Player wirklich da ist",
    eingeklinkt, "vorher lief die Anfrage ins Leere und der Gast startete bei 0:00");
  await warteBis(() => handy.steuerung().some((m) => m.resync),
    "W8: die Antwort der Runde kommt an");

  const antwort = handy.steuerung().filter((m) => m.resync).pop();
  pruefe("W8. Die Antwort traegt Folge, Stelle und Laufzustand des Hosts",
    Boolean(antwort) && String(antwort.url || "").includes("episode-5")
    && antwort.playing === true && Number(antwort.videoTime) > 10,
    antwort ? `${antwort.action}@${Number(antwort.videoTime).toFixed(1)} playing=${antwort.playing}` : "nichts");

  {
    const urteil = antwort ? handy.bruecke.steuerungPruefen(antwort, handy.lage(antwort)) : null;
    pruefe("W8. Der Gast wendet sie an, statt sie als andere Folge zu verwerfen",
      Boolean(urteil) && urteil.tun === "anwenden",
      urteil ? `${urteil.tun} (${urteil.grund})` : "kein Urteil");

    const ereignis = urteil ? ereignisAusSkript(urteil.skript) : null;
    pruefe("W8. Das Skript bekommt Stelle, Zeitstempel und Laufzustand mit",
      Boolean(ereignis) && ereignis.playing === true
      && Number(ereignis.timestamp) > 0 && Number(ereignis.videoTime) > 10,
      ereignis ? JSON.stringify(ereignis) : "kein Ereignis im Skript");
    pruefe("W8. Und rechnet die Zielzeit erst beim Anwenden aus - nicht beim Empfangen",
      Boolean(urteil) && urteil.skript.includes("const zielJetzt = ()")
      && urteil.skript.includes("zielZeitBerechnen"),
      "genau das ist der smarte Start: die Ladezeit steht in der Rechnung drin");

    // Und jetzt die Rechnung selbst, mit genauen Zahlen. Die Nachricht ist
    // beim Anwenden fuenf Sekunden alt; der Host laeuft, also kommen sie dazu.
    if (ereignis) {
      const gerechnet = wpSync.zielZeitBerechnen(
        { ...ereignis, hatUhr: true }, Number(ereignis.timestamp) + 5000);
      pruefe("W8. Fuenf Sekunden Ladezeit ergeben fuenf Sekunden Vorlauf",
        Math.abs(gerechnet - (Number(ereignis.videoTime) + 5)) < 0.001,
        `${gerechnet.toFixed(2)} statt ${(Number(ereignis.videoTime) + 5).toFixed(2)}`);
    }
    pruefe("W8. Die Ladezeit war wirklich eine Wartezeit",
      Date.now() - geladenAb > 1000, `${Date.now() - geladenAb} ms`);
  }

  /* --------------------------------------------------- Die Rechnung selbst */
  // Das Beispiel aus der Aufgabe, an genauen Zahlen: Play bei 12,0 s, der Gast
  // braucht 5 s - er soll bei 17 s einsteigen, nicht bei 12 s.
  {
    const stempel = 1_700_000_000_000;
    const laufend = { videoTime: 12, timestamp: stempel, playing: true, hatUhr: true };
    pruefe("W8. Play bei 12,0 s und 5 s Ladezeit ergeben 17,0 s",
      wpSync.zielZeitBerechnen(laufend, stempel + 5000) === 17,
      String(wpSync.zielZeitBerechnen(laufend, stempel + 5000)));

    // W7: der Host haelt an. Dann wird nicht hochgerechnet - er steht ja.
    const stehend = { videoTime: 12, timestamp: stempel, playing: false, hatUhr: true };
    pruefe("W7. Steht der Host, wird nicht hochgerechnet",
      wpSync.zielZeitBerechnen(stehend, stempel + 5000) === 12,
      String(wpSync.zielZeitBerechnen(stehend, stempel + 5000)));

    // Ohne gemessenen Uhrversatz ebenso: lieber ein paar hundert
    // Millisekunden zu frueh als die Differenz zweier Systemuhren als
    // Videozeit verrechnet.
    const ohneUhr = { videoTime: 12, timestamp: stempel, playing: true, hatUhr: false };
    pruefe("W8. Ohne vertrauenswuerdigen Uhrabgleich wird konservativ gestartet",
      wpSync.zielZeitBerechnen(ohneUhr, stempel + 5000) === 12,
      String(wpSync.zielZeitBerechnen(ohneUhr, stempel + 5000)));

    // Und nach oben gedeckelt: eine halbe Minute Laufzeit ist kein Grund, eine
    // halbe Minute weiterzuspringen.
    pruefe("W8. Ein absurd alter Befehl springt hoechstens dreissig Sekunden weiter",
      wpSync.zielZeitBerechnen(laufend, stempel + 600000) === 42,
      String(wpSync.zielZeitBerechnen(laufend, stempel + 600000)));
  }

  /* ------------------------------------------------------------------- W7 */
  // Der Host pausiert, waehrend der Gast laedt. Der Gast muss pausiert
  // ankommen - und zwar genau auf der Stelle des Hosts.

  {
    tv.puls(48, true);
    tv.melden("pause", 48);
    await schlaf(600);

    // Ein dritter Gast steigt ein: der Rechner, an derselben Folge.
    pc.oeffnen(folge(5));
    pc.steuerung.length = 0;
    pc.puls(0, true);
    await schlaf(300);
    pc.raeume.abgleichen(KEY, RAUM);
    // Gewartet wird auf die Pause und nicht auf irgendeine Antwort.
    //
    // Ein Nachzuegler bekommt unter Umstaenden zwei Nachrichten: erst ein
    // "seek" auf die Stelle, gleich darauf das Urteil "pause". Wer auf die
    // erste wartet und dann die letzte liest, liest auf einem langsamen
    // Rechner die erste - dort liegen die beiden weit genug auseinander.
    // Gefallen ist das auf einem Windows-Runner ("seek playing=false"),
    // waehrend derselbe Stand oertlich fuenfmal hintereinander durchlief.
    //
    // Die Android-Haelfte gleich darunter wartet seit jeher richtig; hier
    // stand die schwaechere Bedingung. Die Aussage bleibt dieselbe: kommt
    // die Pause gar nicht, laeuft warteBis in seine Frist und die Pruefung
    // schlaegt fehl, wie sie soll.
    await warteBis(() => pc.steuerung.some((m) => m.resync && m.action === "pause"),
      "W7: Antwort fuer den Nachzuegler");
    const beiPause = pc.steuerung.filter((m) => m.resync).pop();
    pruefe("W7. Haelt der Host an, meldet die Runde 'pause' und nicht 'play'",
      Boolean(beiPause) && beiPause.action === "pause" && beiPause.playing === false,
      beiPause ? `${beiPause.action} playing=${beiPause.playing}` : "nichts");
    pruefe("W7. Und zwar auf der Stelle des Hosts",
      Boolean(beiPause) && Math.abs(Number(beiPause.position) - 48) < 3,
      beiPause ? `position=${Number(beiPause.position).toFixed(1)}` : "nichts");

    // Dasselbe auf Android: das Urteil muss den Player anhalten.
    handy.ereignisse.length = 0;
    handy.bruecke.abgleichen(KEY, RAUM);
    await warteBis(() => handy.steuerung().some((m) => m.resync && m.action === "pause"),
      "W7: Android bekommt die Pause");
    const androidPause = handy.steuerung().filter((m) => m.resync).pop();
    const urteil = androidPause
      ? handy.bruecke.steuerungPruefen(androidPause, handy.lage(androidPause)) : null;
    pruefe("W7. Der Gast kommt auf Android pausiert an",
      Boolean(urteil) && urteil.tun === "anwenden" && urteil.skript.includes("media.pause()"),
      urteil ? `${urteil.tun} (${urteil.grund})` : "kein Urteil");
    const ereignis = urteil ? ereignisAusSkript(urteil.skript) : null;
    pruefe("W7. Und rechnet dabei nichts hoch",
      Boolean(ereignis) && ereignis.playing === false,
      ereignis ? `playing=${ereignis.playing}` : "kein Ereignis");
  }

  /* --------------------------------------------------------------- W9 + W10 */
  // Die Driftregel, an den Zahlen der Aufgabe. Sie ist geteilt; hier steht der
  // Beleg, dass Android wirklich dieselbe befragt.
  {
    const klein = { bestaetigt: 0, seitSprung: 0, letzteMessung: 0 };
    const kleineTaten = [];
    for (let i = 0; i < 6; i += 1) {
      kleineTaten.push(wpSync.driftEntscheiden(klein,
        { drift: 2, jetzt: 1000 + i * 2000, puffert: false, laeuft: true }));
    }
    pruefe("W9. Zwei Sekunden daneben werden nie korrigiert",
      kleineTaten.every((tat) => tat === "ignore"), kleineTaten.join(","));

    const gross = { bestaetigt: 0, seitSprung: 0, letzteMessung: 0 };
    const grosseTaten = [];
    for (let i = 0; i < 6; i += 1) {
      grosseTaten.push(wpSync.driftEntscheiden(gross,
        { drift: 6.5, jetzt: 1000 + i * 2000, puffert: false, laeuft: true }));
    }
    pruefe("W10. Ueber fuenf Sekunden wird nach drei Messungen einmal gesprungen",
      grosseTaten[0] === "beobachten" && grosseTaten[1] === "beobachten"
      && grosseTaten[2] === "hard-seek",
      grosseTaten.join(","));
    // Und danach faengt die Zaehlung von vorn an, statt sofort wieder zu
    // springen: erst wieder zwei Beobachtungen, dann greift die Ruhezeit von
    // fuenfzehn Sekunden. Genau ein Sprung, kein sekuendliches Ruecken.
    pruefe("W10. Danach ist Ruhe - genau ein Sprung, kein sekuendliches Springen",
      grosseTaten[3] === "beobachten" && grosseTaten[4] === "beobachten"
      && grosseTaten[5] === "cooldown"
      && grosseTaten.filter((tat) => tat === "hard-seek").length === 1,
      grosseTaten.join(","));
  }

  /* ------------------------------------------- "Mit Host synchronisieren" */
  // Die Aktion aus der Leiste des Rechners, jetzt auch auf Android. Sie darf
  // ausdruecklich auch von jemandem kommen, der bei der falschen Folge steht -
  // dann wechselt er zuerst dorthin und kommt danach mit.
  //
  // Eigener Titel im selben Raum: die Hostwahl haengt daran, wer zuerst an
  // einer Folge war, und ein Titel mit Vorgeschichte gaebe hier ein Ergebnis,
  // das von den Faellen davor abhaengt statt von diesem.
  {
    const SYNC_SERIE = "https://aniworld.to/anime/stream/vinland-saga";
    const SYNC_KEY = SYNC_SERIE.toLowerCase();
    const syncFolge = (n) => `${SYNC_SERIE}/staffel-1/episode-${n}`;
    const syncStand = (geraet, url, position, pausiert) => {
      const nummer = Number((String(url).match(/episode-(\d+)/) || [])[1] || 0);
      const rumpf = {
        url, season: 1, episode: nummer,
        playerSessionId: `${geraet.name}-sync-sitzung`
      };
      if (geraet.bruecke) {
        geraet.bruecke.meldungStand(
          `${wpSync.MELDE_STAND}${position.toFixed(2)}:${pausiert ? 1 : 0}`,
          SYNC_KEY, rumpf, RAUM);
        return;
      }
      geraet.raeume.meldeStand(SYNC_KEY, { ...rumpf, position, paused: pausiert }, RAUM);
    };
    const syncEintrag = (geraet) => (geraet.bruecke
      ? geraet.bruecke.eintraege() : geraet.raeume.eintraege())
      .find((e) => e.key === SYNC_KEY) || null;

    pc.raeume.teilen({
      key: SYNC_KEY, url: syncFolge(5), title: "Vinland Saga", providerName: "AniWorld",
      type: "serie", season: 1, episode: 5
    }, RAUM);
    await warteBis(() => syncEintrag(tv) && syncEintrag(handy), "Sync: der Titel steht im Raum");
    tv.bruecke.beitreten(SYNC_KEY, RAUM);
    handy.bruecke.beitreten(SYNC_KEY, RAUM);
    pc.raeume.beitreten(SYNC_KEY, RAUM);
    await warteBis(() => syncEintrag(tv)?.joined && syncEintrag(handy)?.joined,
      "Sync: beide beigetreten");

    // Der Fernseher ist zuerst an Folge 5 und fuehrt damit. Ein Puls haelt ihn
    // aktiv - ohne ihn faellt er nach fuenfzehn Sekunden aus der Hostfolge.
    const tvPuls = setInterval(() => syncStand(tv, syncFolge(5), 300, false), 700);
    tvPuls.unref?.();
    syncStand(tv, syncFolge(5), 300, false);
    await warteBis(() => syncEintrag(tv)?.hostId === "tv-id", "Sync: der Fernseher fuehrt");
    pruefe("Sync. Der Fernseher fuehrt bei Folge 5",
      syncEintrag(tv)?.hostId === "tv-id", `hostId=${syncEintrag(tv)?.hostId}`);

    // Und das Telefon steht bei Folge 4.
    const handyPuls = setInterval(() => syncStand(handy, syncFolge(4), 20, false), 700);
    handyPuls.unref?.();
    syncStand(handy, syncFolge(4), 20, false);
    await schlaf(600);

    handy.ereignisse.length = 0;
    handy.bruecke.gleichziehen(SYNC_KEY, 20, RAUM);
    await warteBis(() => handy.steuerung().some((m) => m.action === "syncprepare"),
      "Sync: die Vorbereitung kommt an");
    const vorbereiten = handy.steuerung().filter((m) => m.action === "syncprepare").pop();
    pruefe("Sync. Jeder Teilnehmer darf abgleichen - nicht nur der Host",
      Boolean(vorbereiten), vorbereiten ? `position=${Math.round(vorbereiten.position)}` : "nichts");
    pruefe("Sync. Massgeblich ist die Stelle des Hosts und nicht die eigene",
      Boolean(vorbereiten) && Number(vorbereiten.position) > 250,
      vorbereiten ? `${Math.round(vorbereiten.position)} statt 20` : "nichts");
    pruefe("Sync. Und die Vorbereitung nennt die Folge, bei der die Runde steht",
      Boolean(vorbereiten) && String(vorbereiten.url || "").includes("episode-5"),
      vorbereiten ? String(vorbereiten.url).split("/stream/")[1] : "nichts");

    // Der entscheidende Teil: das Telefon steht bei Folge 4 - die Vorbereitung
    // darf trotzdem nicht als "andere Folge" verworfen werden. Genau daran
    // waere sie auf Android bisher gescheitert.
    // So fragt Mitschauen.java: fuer ein syncprepare bleibt die Folgenpruefung
    // aussen vor, weil erst danach feststeht, ob gewechselt werden muss.
    const urteil = vorbereiten
      ? handy.bruecke.steuerungPruefen(vorbereiten, handy.lage(vorbereiten)) : null;
    pruefe("Sync. Wer bei der falschen Folge steht, wird nicht abgewiesen",
      Boolean(urteil) && urteil.tun === "syncprepare",
      urteil ? `${urteil.tun} (${urteil.grund})` : "kein Urteil");

    // Und die Gegenprobe: mit scharfer Folgenpruefung faellt genau dieses
    // Geraet heraus - das war der Zustand davor. Mit einer hoeheren laufenden
    // Nummer, sonst wiese die Veraltungspruefung sie schon vorher ab und die
    // Gegenprobe pruefte gar nichts.
    const scharf = vorbereiten ? handy.bruecke.steuerungPruefen(
      { ...vorbereiten, sequenceId: Number(vorbereiten.sequenceId || 0) + 1 }, {
        binHost: false, hostId: "tv-id", gleicheAdresse: true, season: 1, episode: 4
      }) : null;
    pruefe("Sync. Mit scharfer Folgenpruefung fiele er heraus - die Gegenprobe",
      Boolean(scharf) && scharf.tun === "nichts" && scharf.grund === "andere folge",
      scharf ? `${scharf.tun} (${scharf.grund})` : "kein Urteil");
    pruefe("Sync. Und die Vorbereitung sagt ihm, wohin er wechseln muss",
      Boolean(vorbereiten) && String(vorbereiten.url || "").includes("episode-5"),
      "ohne die Adresse spraenge er auf eine Stelle der falschen Folge");

    // Sind alle so weit, gibt die Runde gemeinsam das Startsignal.
    clearInterval(handyPuls);
    syncStand(handy, syncFolge(5), 300, true);
    handy.ereignisse.length = 0;
    handy.bruecke.bereitZumStart(SYNC_KEY, RAUM);
    tv.bruecke.bereitZumStart(SYNC_KEY, RAUM);
    pc.raeume.bereitZumStart(SYNC_KEY, RAUM);
    await warteBis(() => handy.steuerung().some((m) => m.action === "syncstart"),
      "Sync: das gemeinsame Startsignal", 12000);
    pruefe("Sync. Sind alle so weit, gibt die Runde das Startsignal",
      handy.steuerung().some((m) => m.action === "syncstart"),
      handy.steuerung().map((m) => m.action).join(","));

    clearInterval(tvPuls);
    // Der eigene Titel bleibt im Raum stehen - genau das prueft W16 gleich
    // mit: mehrere Titel nebeneinander, jeder mit eigenem Host.
  }

  /* -------------------------------------------------------------------- W13 */
  // Drei Geraete gleichzeitig an derselben Folge: die Standmeldung muss alle
  // drei tragen, genau einen als Host, und jedes mit seiner Kennung.
  {
    pc.staende.length = 0;
    tv.puls(120, false);
    handy.oeffnen(folge(5));
    handy.playerDa();
    handy.puls(118, false);
    pc.puls(119, false);
    await warteBis(() => pc.staende.some((s) => (s.members || []).length >= 3),
      "W13: alle drei stehen in der Leiste");
    const leiste = pc.staende.filter((s) => (s.members || []).length >= 3).pop();
    pruefe("W13. Die Leiste traegt alle drei Geraete",
      Boolean(leiste) && leiste.members.length === 3,
      leiste ? leiste.members.map((m) => m.name).join(", ") : "nichts");
    pruefe("W13. Und genau einer fuehrt",
      Boolean(leiste) && leiste.members.filter((m) => m.host).length === 1,
      leiste ? leiste.members.map((m) => `${m.name}:${m.host}`).join(",") : "nichts");
    pruefe("W13. Jedes Geraet traegt Kennung, Stelle, Pausenzustand und Alter",
      Boolean(leiste) && leiste.members.every((m) =>
        typeof m.id === "string" && m.id.length > 0 && typeof m.position === "number"
        && typeof m.paused === "boolean" && typeof m.age === "number"),
      leiste ? JSON.stringify(leiste.members[0]) : "nichts");
    pruefe("W13. Und seine Folge - daran erkennt die Anzeige, wer woanders steht",
      Boolean(leiste) && leiste.members.every((m) => Number(m.episode) === 5),
      leiste ? leiste.members.map((m) => `s${m.season}e${m.episode}`).join(",") : "nichts");
  }

  /* -------------------------------------------------------------------- W14 */
  // Einem Teilnehmer bricht das Netz weg. Er darf nicht ewig als "schaut
  // gerade" dastehen - das Relay laesst ihn aus der Liste fallen, und bis
  // dahin traegt seine Meldung ein wachsendes Alter.
  {
    handy.stillstehen();
    pc.staende.length = 0;
    // Die Frischegrenze des Relays sind fuenfzehn Sekunden. Hier wird wirklich
    // so lange gewartet: ein Test, der frueher abbricht, prueft die Uhr und
    // nicht die Regel.
    await warteBis(() => pc.staende.some((s) =>
      !(s.members || []).some((m) => m.id === "handy-id")),
      "W14: das stille Geraet faellt aus der Liste", 25000);
    const nachher = pc.staende.pop();
    pruefe("W14. Wer nichts mehr meldet, verschwindet aus der Teilnehmerliste",
      Boolean(nachher) && !(nachher.members || []).some((m) => m.id === "handy-id"),
      nachher ? nachher.members.map((m) => m.name).join(", ") : "keine Meldung");
    // Und die Anzeige rechnet zusaetzlich selbst: eine Meldung, die zu alt ist,
    // faellt heraus, auch wenn gar keine neue mehr kommt. Geprueft wird das in
    // LivestandTest (JVM) an genauen Zahlen.
    handy.puls(118, false);
    await warteBis(() => pc.staende.some((s) =>
      (s.members || []).some((m) => m.id === "handy-id")), "W14: es meldet sich wieder");
    pruefe("W14. Und kommt zurueck, sobald es sich wieder meldet",
      pc.staende.some((s) => (s.members || []).some((m) => m.id === "handy-id")));
  }

  /* -------------------------------------------------------------------- W11 */
  // Der Host verlaesst die Folge. Sein Nachfolger muss jemand sein, der
  // wirklich an dieser Folge teilnimmt - kein Geister-Host.
  {
    // Alle drei stehen an derselben Folge und melden. Wer davon gerade fuehrt,
    // entscheidet das Relay - der Test haengt sich ausdruecklich nicht an einen
    // bestimmten Namen, sondern nimmt den, der es wirklich ist.
    for (const geraet of [pc, tv, handy]) {
      geraet.oeffnen(folge(5));
      if (geraet.playerDa) geraet.playerDa();
      geraet.puls(150, false);
    }
    await warteBis(() => handy.eintragVon()?.hostId, "W11: ein Host steht fest");
    const vorher = handy.eintragVon()?.hostId;
    const abtretend = [pc, tv, handy].find((geraet) =>
      (geraet.kennung || `${geraet.name}-id`) === vorher);
    pruefe("W11. Vor dem Verlassen fuehrt genau ein Geraet",
      Boolean(abtretend), `hostId=${vorher}`);

    abtretend.stillstehen();
    if (abtretend.bruecke) abtretend.bruecke.verlasseStand(KEY, RAUM);
    else abtretend.raeume.verlasseStand(KEY, RAUM);

    const beobachter = abtretend === handy ? tv : handy;
    await warteBis(() => beobachter.eintragVon()?.hostId
      && beobachter.eintragVon()?.hostId !== vorher, "W11: jemand anderes uebernimmt");
    const neuerHost = beobachter.eintragVon()?.hostId;
    pruefe("W11. Verlaesst der Host die Folge, uebernimmt ein anderer",
      Boolean(neuerHost) && neuerHost !== vorher,
      `vorher ${vorher}, jetzt ${neuerHost}`);
    // Und zwar jemand, der wirklich an dieser Folge mitschaut - kein
    // Geister-Host, der die Folge laengst verlassen hat.
    const nochDa = [pc, tv, handy]
      .filter((geraet) => geraet !== abtretend)
      .map((geraet) => geraet.kennung || `${geraet.name}-id`);
    pruefe("W11. Und zwar jemand, der wirklich an dieser Folge mitschaut",
      nochDa.includes(neuerHost), `hostId=${neuerHost}, noch dabei: ${nochDa.join(", ")}`);

    // Der Abgetretene meldet sich wieder - sonst fehlt er den folgenden Faellen.
    abtretend.puls(150, false);
    await schlaf(400);
  }

  /* -------------------------------------------------------------------- W12 */
  // pausedBy und lastAction, auf allen Plattformen. Wer gedrueckt hat, ist
  // etwas anderes als wer gerade angehalten dasteht.
  {
    pc.staende.length = 0;
    handy.melden("pause", 130);
    await warteBis(() => pc.staende.some((s) => s.lastAction), "W12: die Pause steht in der Leiste");
    const nachPause = pc.staende.filter((s) => s.lastAction).pop();
    pruefe("W12. lastAction nennt Art und Namen dessen, der gedrueckt hat",
      nachPause.lastAction.type === "pause" && nachPause.lastAction.name === "Handy",
      JSON.stringify(nachPause.lastAction));
    pruefe("W12. Und pausedBy ebenso",
      nachPause.pausedBy === "Handy", `"${nachPause.pausedBy}"`);

    // Ein Play loescht pausedBy wieder - sonst stuende dort ein Name aus der
    // Vergangenheit, waehrend alle laufen.
    pc.staende.length = 0;
    handy.melden("play", 131);
    await warteBis(() => pc.staende.some((s) => s.lastAction?.type === "play"),
      "W12: das Play steht in der Leiste");
    const nachPlay = pc.staende.filter((s) => s.lastAction).pop();
    pruefe("W12. Nach einem Play steht dort kein Pausierender mehr",
      nachPlay.pausedBy === "" && nachPlay.lastAction.type === "play",
      `pausedBy="${nachPlay.pausedBy}", lastAction=${nachPlay.lastAction.type}`);
  }

  /* -------------------------------------------------------------------- W15 */
  // Wiederanschluss: Raum, Folge und Teilnahme stehen danach wieder.
  {
    const vorher = handy.eintragVon();
    handy.bruecke.trennen();
    await warteBis(() => !handy.bruecke.status().connected, "W15: getrennt");
    pruefe("W15. Die Verbindung war wirklich weg", !handy.bruecke.status().connected);
    handy.an();
    await warteBis(() => handy.bruecke.status().connected, "W15: wieder verbunden");
    await warteBis(() => handy.eintragVon()?.joined, "W15: Raum und Teilnahme wieder da");
    const nachher = handy.eintragVon();
    pruefe("W15. Nach dem Wiederanschluss stehen Raum, Titel und Teilnahme wieder",
      Boolean(nachher) && nachher.room === vorher.room && nachher.key === vorher.key
      && nachher.joined === true,
      nachher ? `${nachher.room}/${nachher.key.split("/stream/")[1]} joined=${nachher.joined}` : "nichts");

    // Und die Steuerung laeuft danach weiter.
    handy.oeffnen(folge(5));
    handy.playerDa();
    handy.puls(140, false);
    await schlaf(500);
    pc.steuerung.length = 0;
    handy.melden("pause", 141);
    await warteBis(() => pc.steuerung.some((m) => m.action === "pause"),
      "W15: die Steuerung laeuft wieder");
    pruefe("W15. Und die Steuerung laeuft danach weiter",
      pc.steuerung.some((m) => m.action === "pause"));
  }

  /* -------------------------------------------------------------------- W16 */
  // Mehrere Titel im selben Raum. Jeder fuehrt seinen eigenen Host, seinen
  // eigenen Stand und seine eigene Teilnehmerliste.
  {
    const BLEACH = "https://aniworld.to/anime/stream/bleach";
    const KORRA = "https://aniworld.to/anime/stream/die-legende-von-korra";
    for (const [serie, titel, staffel, nummer] of [
      [BLEACH, "Bleach", 3, 8], [KORRA, "Die Legende von Korra", 2, 5]
    ]) {
      pc.raeume.teilen({
        key: serie.toLowerCase(), url: `${serie}/staffel-${staffel}/episode-${nummer}`,
        title: titel, providerName: "AniWorld", type: "serie", season: staffel, episode: nummer
      }, RAUM);
      await schlaf(150);
    }
    await warteBis(() => handy.bruecke.eintraege().length >= 3, "W16: drei Titel im Raum");

    const alle = handy.bruecke.eintraegeMitAnbieter(ANBIETER);
    pruefe("W16. Der Raum fuehrt drei Titel nebeneinander",
      alle.length >= 3, `${alle.length} Eintraege`);

    const bleach = alle.find((e) => e.key === BLEACH.toLowerCase());
    const korra = alle.find((e) => e.key === KORRA.toLowerCase());
    const aot = alle.find((e) => e.key === KEY);
    pruefe("W16. Und jeder traegt seine eigene Staffel und Folge",
      bleach?.staffel === 3 && bleach?.folge === 8
      && korra?.staffel === 2 && korra?.folge === 5,
      `Bleach s${bleach?.staffel}e${bleach?.folge}, Korra s${korra?.staffel}e${korra?.folge}`);
    pruefe("W16. Der Host haengt am Titel und nicht am Raum",
      Boolean(aot?.hostId) && !bleach?.hostId && !korra?.hostId,
      `AoT host=${aot?.hostId || "-"}, Bleach host=${bleach?.hostId || "-"}, `
      + `Korra host=${korra?.hostId || "-"}`);

    // Und eine Standmeldung des einen Titels faerbt nicht auf die anderen ab.
    pc.staende.length = 0;
    handy.melden("pause", 200);
    await warteBis(() => pc.staende.some((s) => s.key === KEY),
      "W16: die Pause erreicht nur den eigenen Titel");
    await schlaf(600);
    pruefe("W16. Eine Standmeldung gilt genau einem Titel",
      pc.staende.every((s) => s.key === KEY),
      [...new Set(pc.staende.map((s) => s.key.split("/stream/")[1]))].join(","));

    const zielBleach = handy.bruecke.oeffnungsZiel(BLEACH.toLowerCase(), RAUM, ANBIETER);
    const zielAot = handy.bruecke.oeffnungsZiel(KEY, RAUM, ANBIETER);
    pruefe("W16. Und ein Klick auf Bleach oeffnet Bleach und nicht Attack on Titan",
      zielBleach?.url.includes("bleach/staffel-3/episode-8")
      && zielAot?.url.includes("attack-on-titan"),
      `${zielBleach?.url.split("/stream/")[1]} vs ${zielAot?.url.split("/stream/")[1]}`);
  }

  pc.stillstehen();
  tv.stillstehen();
  handy.stillstehen();
  pc.raeume.trennen();
  tv.aus();
  handy.aus();
  await schlaf(200);

  const ok = pruefungen.filter(Boolean).length;
  console.log(`\n${ok}/${pruefungen.length} bestanden`);
  process.exit(ok === pruefungen.length ? 0 : 1);
})().catch((fehler) => {
  console.log(`FAIL  Der Lauf brach ab   -> ${fehler?.stack || fehler}`);
  console.log(`\n0/${pruefungen.length + 1} bestanden`);
  process.exit(1);
});
