"use strict";
// Der Folgen-Autostart - der Auftrag, das Startskript und die Serveradresse.
//
// Warum es diese Pruefung gibt. Auf Android wurde die neue Folge der Runde zwar
// geoeffnet, aber sie startete nicht: der Gast sass vor einem stehenden Bild,
// waehrend die anderen weiterschauten. Gemessen am 25.08.2026 auf dem Telefon
// (AniWorld -> VOE) lagen dahinter drei Dinge, und jedes davon steht hier als
// eigener Fall:
//
//   1. Der Rahmen des Hosters traegt ein <video> *ohne Quelle* - duration=null,
//      readyState=0, src="". Ein play() darauf laeuft ins Leere. Erst der Klick
//      auf die Ueberlagerung des Hosters ("Spielen", .jw-icon-display) laedt
//      die Quelle; danach stand duration=1371 und readyState=4.
//   2. Das Versprechen von play() wurde weggefangen. Ein abgelehntes play() sah
//      damit von aussen aus wie ein gelungenes.
//   3. Der Auftrag hing am WebView und nicht am Kern - eine Navigation raeumte
//      ihn ab, also konnte danach nichts mehr starten.
//
// Gefahren wird der echte Quelltext: `startScript` baut dasselbe Skript, das
// auf dem Telefon in den Rahmen des Hosters geht.

const {
  auftragAnlegen, auftragGilt, naechsterSchritt, versuchVermerken,
  berichtVerarbeiten, berichtLesen, startScript, standTraegtNichts,
  MELDE_START, HOECHSTVERSUCHE, AUFTRAG_FRIST_MS, BERICHT_FRIST_MS, ABSTAND_MS,
  UEBERLAGERUNG_WAEHLER
} = require("../src/watchparty-autostart");
const {
  serverNormalisieren, serverBeanstandung, websocketAdresse
} = require("../src/watchparty");
const { zielZeitBerechnen } = require("../src/watchparty-sync");

const pruefungen = [];
const pruefe = (n, b, d) => {
  pruefungen.push(Boolean(b));
  console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`);
};
const nah = (a, b, toleranz = 0.2) => Math.abs(a - b) <= toleranz;

/* -------------------------------------------------------- Die nachgebaute Seite */

/**
 * Ein Video, wie der Hoster es hinstellt.
 *
 * `quelleFehlt` baut genau den gemessenen Zustand nach: das Element ist da,
 * aber ohne Laufzeit. Erst `quelleLaden()` - im Test der Klick auf die
 * Ueberlagerung - macht daraus ein spielbares Video.
 */
function video(optionen = {}) {
  const m = {
    duration: optionen.quelleFehlt ? null : (optionen.duration || 1371),
    paused: optionen.paused !== false,
    ended: false,
    readyState: optionen.quelleFehlt ? 0 : 4,
    seeking: false,
    playbackRate: 1,
    tempoGesetzt: [],
    spruenge: [],
    gestartet: 0,
    gestoppt: 0,
    playFehler: optionen.playFehler || null,
    _zeit: optionen.start || 0,
    _laeuft: false
  };
  Object.defineProperty(m, "currentTime", {
    get: () => m._zeit,
    set: (wert) => { m.spruenge.push(Number(wert)); m._zeit = Number(wert); }
  });
  Object.defineProperty(m, "playbackRate", {
    get: () => 1,
    set: (wert) => m.tempoGesetzt.push(Number(wert))
  });
  m.quelleLaden = () => {
    m.duration = optionen.duration || 1371;
    m.readyState = 4;
    // Der Hoster startet nach dem Klick von selbst - so stand es in der Messung.
    m.paused = false;
    m._laeuft = true;
  };
  m.play = () => {
    m.gestartet += 1;
    if (m.playFehler) return Promise.reject(m.playFehler);
    if (!(Number(m.duration) > 0)) {
      // Ohne Quelle passiert nichts. Genau das war der stille Fehlschlag.
      return Promise.resolve();
    }
    m.paused = false;
    m._laeuft = true;
    return Promise.resolve();
  };
  m.pause = () => { m.gestoppt += 1; m.paused = true; m._laeuft = false; };
  // Die Zeit laeuft, solange das Video laeuft - daran erkennt das Skript, ob
  // wirklich etwas geschieht und nicht nur paused=false dasteht.
  m._takt = setInterval(() => { if (m._laeuft) m._zeit += 0.1; }, 40);
  m._takt.unref?.();
  return m;
}

/** Ein sichtbarer Knopf, wie ihn ein Player als Ueberlagerung hinstellt. */
function knopf(klasse, beiKlick, optionen = {}) {
  const n = {
    klasse,
    klicks: [],
    ereignisse: [],
    getBoundingClientRect: () => ({
      left: 100, top: 100,
      width: optionen.breite === undefined ? 88 : optionen.breite,
      height: optionen.hoehe === undefined ? 88 : optionen.hoehe
    }),
    dispatchEvent: (ereignis) => {
      n.ereignisse.push(ereignis && ereignis.type);
      // Nur der echte Klick zaehlt - so wie beim Player, der auf pointerdown
      // horcht und den Rest liegen laesst.
      if (ereignis && ereignis.type === "pointerdown") {
        n.klicks.push(Date.now());
        if (beiKlick) beiKlick();
      }
      return true;
    },
    click: () => { n.klicks.push(Date.now()); if (beiKlick) beiKlick(); }
  };
  return n;
}

/**
 * Die Umgebung, die das Skript im Rahmen des Hosters vorfindet.
 *
 * @param videos  was `document.querySelectorAll("video")` liefert
 * @param knoepfe was die Waehler der Ueberlagerung liefern, als { waehler: [knoten] }
 */
async function ausfuehren(quelltext, videos, knoepfe = {}, fenster = {}) {
  const liste = Array.isArray(videos) ? videos : (videos ? [videos] : []);
  const logs = [];
  const ereignisKlasse = class {
    constructor(typ, wie) { this.type = typ; Object.assign(this, wie || {}); }
  };
  const umgebung = {
    document: {
      querySelectorAll: (waehler) => {
        if (waehler === "video") return liste;
        return knoepfe[waehler] || [];
      }
    },
    window: fenster,
    console: { log: (zeile) => logs.push(String(zeile)) },
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    PointerEvent: ereignisKlasse,
    MouseEvent: ereignisKlasse,
    setTimeout, Date, Math, Number, Boolean, String, Array, JSON, Promise
  };
  const namen = Object.keys(umgebung);
  // eslint-disable-next-line no-new-func
  const bauen = new Function(...namen, `return ${quelltext};`);
  const ergebnis = await bauen(...namen.map((n) => umgebung[n]));
  const berichte = logs.map(berichtLesen).filter(Boolean);
  return { ergebnis, logs, berichte, fenster };
}

const ereignis = (felder) => ({
  videoTime: 0, timestamp: Date.now(), playing: false, hatUhr: true, versatz: 0, ...felder
});

(async () => {

  /* ============================================================ 1. Das Skript */

  // 1. Der gemessene Fall: ein <video> ohne Quelle hinter einer Ueberlagerung.
  {
    const m = video({ quelleFehlt: true });
    const k = knopf(".jw-icon-display", () => m.quelleLaden());
    const start = Date.now();
    const { ergebnis, berichte } = await ausfuehren(
      startScript("a|k|s1e5|1", ereignis({ videoTime: 12, timestamp: start, playing: true }),
        { playing: true }),
      m, { ".jw-icon-display": [k] });
    pruefe("1. Ein Video ohne Quelle wird ueber die Ueberlagerung geweckt",
      k.klicks.length === 1 && ergebnis === "laeuft",
      `Klicks ${k.klicks.length}, Ergebnis ${ergebnis}`);
    pruefe("1b. Und der Bericht sagt, dass es wirklich laeuft",
      berichte.length === 1 && berichte[0].ok === true && berichte[0].zustand === "laeuft"
        && berichte[0].auftrag === "a|k|s1e5|1",
      JSON.stringify(berichte[0] || null));
    pruefe("1c. Ein echter Klick und kein blosses .click()",
      k.ereignisse.includes("pointerdown") && k.ereignisse.includes("click"),
      k.ereignisse.join(","));
    clearInterval(m._takt);
  }

  // 2. Play waehrend des Ladens: der Gast steigt an der hochgerechneten Stelle
  //    ein. Der Host stand bei 12 s und spielt seit fuenf Sekunden weiter.
  {
    const m = video({ quelleFehlt: true });
    const k = knopf(".jw-icon-display", () => m.quelleLaden());
    const { berichte } = await ausfuehren(
      startScript("a|k|s1e5|1",
        ereignis({ videoTime: 12, timestamp: Date.now() - 5000, playing: true }),
        { playing: true }),
      m, { ".jw-icon-display": [k] });
    const ziel = m.spruenge[0];
    pruefe("2. Play waehrend des Ladens: Einstieg bei ~17 s, nicht bei 12 und nicht bei 0",
      m.spruenge.length > 0 && nah(ziel, 17, 0.6) && berichte[0] && berichte[0].ok,
      `Sprung auf ${ziel === undefined ? "gar nichts" : ziel.toFixed(2)}`);
    clearInterval(m._takt);
  }

  // 3. Pause waehrend des Ladens: nicht hochrechnen, pausiert ankommen.
  {
    const m = video({ quelleFehlt: true });
    const k = knopf(".jw-icon-display", () => m.quelleLaden());
    const { ergebnis, berichte } = await ausfuehren(
      startScript("a|k|s1e5|1",
        ereignis({ videoTime: 12, timestamp: Date.now() - 5000, playing: false }),
        { playing: false }),
      m, { ".jw-icon-display": [k] });
    pruefe("3. Pausiert der Host, kommt der Gast pausiert an - und bei 12 s",
      ergebnis === "pausiert" && m.paused === true && nah(m.spruenge[0], 12, 0.05),
      `${ergebnis}, paused=${m.paused}, Sprung ${m.spruenge[0]}`);
    pruefe("3b. Und die Ueberlagerung wurde trotzdem geklickt - sonst gaebe es keine Quelle",
      k.klicks.length === 1 && berichte[0] && berichte[0].ok === true,
      JSON.stringify(berichte[0] || null));
    clearInterval(m._takt);
  }

  // 4. Ohne zuverlaessigen Uhrabgleich wird nicht hochgerechnet.
  {
    const m = video({ quelleFehlt: true });
    const k = knopf(".jw-icon-display", () => m.quelleLaden());
    await ausfuehren(
      startScript("a|k|s1e5|1",
        ereignis({ videoTime: 12, timestamp: Date.now() - 5000, playing: true, hatUhr: false }),
        { playing: true }),
      m, { ".jw-icon-display": [k] });
    pruefe("4. Ohne Uhrabgleich wird konservativ bei 12 s eingestiegen",
      m.spruenge.length > 0 && nah(m.spruenge[0], 12, 0.05),
      `Sprung auf ${m.spruenge[0]}`);
    clearInterval(m._takt);
  }

  // 5. Kein Rahmen mit Video: still bleiben. Ein Werberahmen soll nichts
  //    anklicken und nichts melden.
  {
    const k = knopf(".jw-icon-display", () => {});
    const { ergebnis, berichte } = await ausfuehren(
      startScript("a|k|s1e5|1", ereignis({ playing: true }), { playing: true }),
      [], { ".jw-icon-display": [k] });
    pruefe("5. Ein Rahmen ohne Video klickt nichts und meldet nichts",
      ergebnis === "kein-player" && k.klicks.length === 0 && berichte.length === 0,
      `${ergebnis}, Klicks ${k.klicks.length}, Berichte ${berichte.length}`);
  }

  // 6. Keine Quelle und keine Ueberlagerung: ein Fehlschlag, der das auch sagt.
  {
    const m = video({ quelleFehlt: true });
    const { ergebnis, berichte } = await ausfuehren(
      startScript("a|k|s1e5|1", ereignis({ playing: true }), { playing: true }), m, {});
    pruefe("6. Ohne Quelle und ohne Ueberlagerung wird der Fehlschlag gemeldet",
      ergebnis === "keine-quelle" && berichte.length === 1 && berichte[0].ok === false
        && berichte[0].zustand === "keine-quelle" && berichte[0].grund.length > 0,
      JSON.stringify(berichte[0] || null));
    clearInterval(m._takt);
  }

  // 7. play() wird abgelehnt: der Grund steht im Bericht, und ok ist falsch.
  //    Das ist der Fall, der frueher wie ein Erfolg aussah.
  {
    const m = video({ playFehler: Object.assign(new Error("play() failed"),
      { name: "NotAllowedError", message: "play() failed" }) });
    const { ergebnis, berichte } = await ausfuehren(
      startScript("a|k|s1e5|1", ereignis({ videoTime: 5, playing: true }), { playing: true }),
      m, {});
    pruefe("7. Ein abgelehntes play() gilt nicht als Erfolg",
      ergebnis === "blockiert" && berichte.length === 1 && berichte[0].ok === false,
      `${ergebnis} / ${JSON.stringify(berichte[0] || null)}`);
    pruefe("7b. Und der Grund steht im Bericht statt nur im Protokoll",
      berichte[0] && /NotAllowed/.test(berichte[0].grund),
      berichte[0] ? berichte[0].grund : "kein Bericht");
    clearInterval(m._takt);
  }

  // 8. Ein laufendes Video wird nicht angeklickt - ein Klick haette es
  //    angehalten.
  {
    const m = video({ paused: false, start: 30 });
    m._laeuft = true;
    const k = knopf(".jw-icon-display", () => m.pause());
    const { ergebnis } = await ausfuehren(
      startScript("a|k|s1e5|1", ereignis({ videoTime: 30, playing: true }), { playing: true }),
      m, { ".jw-icon-display": [k] });
    pruefe("8. Laeuft schon etwas, bleibt die Ueberlagerung unberuehrt",
      k.klicks.length === 0 && ergebnis === "laeuft" && m.gestoppt === 0,
      `Klicks ${k.klicks.length}, ${ergebnis}, Pausen ${m.gestoppt}`);
    clearInterval(m._takt);
  }

  // 9. Am Tempo wird nie gedreht. Dieselbe Regel wie im laufenden Betrieb.
  {
    const m = video({ quelleFehlt: true });
    const k = knopf(".jw-icon-display", () => m.quelleLaden());
    await ausfuehren(
      startScript("a|k|s1e5|1", ereignis({ videoTime: 12, playing: true }), { playing: true }),
      m, { ".jw-icon-display": [k] });
    pruefe("9. Kein PlaybackRate-Flattern",
      m.tempoGesetzt.every((wert) => wert === 1), m.tempoGesetzt.join(","));
    clearInterval(m._takt);
  }

  // 10. Der Merker gegen das Echo steht - sonst meldete der eigene Horcher das
  //     Play als eigene Tat zurueck an die Runde.
  {
    const m = video({ quelleFehlt: true });
    const k = knopf(".jw-icon-display", () => m.quelleLaden());
    const fenster = {};
    await ausfuehren(
      startScript("a|k|s1e5|1", ereignis({ videoTime: 12, playing: true }), { playing: true }),
      m, { ".jw-icon-display": [k] }, fenster);
    pruefe("10. Das erwartete Echo ist angekuendigt",
      fenster.__elfixWpErwartet && fenster.__elfixWpErwartet.aktion === "play",
      JSON.stringify(fenster.__elfixWpErwartet || null));
    clearInterval(m._takt);
  }

  // 11. Zu kleine Knoten sind keine Ueberlagerung - ein Pixelpunkt ist kein Knopf.
  {
    const m = video({ quelleFehlt: true });
    const k = knopf(".jw-icon-display", () => m.quelleLaden(), { breite: 8, hoehe: 8 });
    const { ergebnis } = await ausfuehren(
      startScript("a|k|s1e5|1", ereignis({ playing: true }), { playing: true }),
      m, { ".jw-icon-display": [k] });
    pruefe("11. Ein winziger Knoten gilt nicht als Ueberlagerung",
      k.klicks.length === 0 && ergebnis === "keine-quelle", ergebnis);
    clearInterval(m._takt);
  }

  // 12. Das groesste Video mit Laufzeit gewinnt - der Werbeclip daneben nicht.
  {
    const werbung = video({ duration: 15, paused: false, start: 3 });
    werbung._laeuft = true;
    const echt = video({ duration: 1371 });
    const { ergebnis } = await ausfuehren(
      startScript("a|k|s1e5|1", ereignis({ videoTime: 100, playing: true }), { playing: true }),
      [werbung, echt], {});
    pruefe("12. Nicht der Werbeclip, sondern das lange Video wird gestartet",
      echt.gestartet >= 1 && echt.spruenge.length > 0 && nah(echt.spruenge[0], 100, 0.5)
        && ergebnis === "laeuft",
      `echt gestartet ${echt.gestartet}, Werbung gestartet ${werbung.gestartet}`);
    clearInterval(werbung._takt);
    clearInterval(echt._takt);
  }

  /* =========================================================== 2. Der Auftrag */

  const jetzt = 1_000_000;
  const basis = () => auftragAnlegen({
    generation: 3, raum: "wohnzimmer", key: "https://aniworld.to/anime/stream/bleach",
    season: 1, episode: 5, url: "https://aniworld.to/anime/stream/bleach/staffel-1/episode-5",
    hostId: "rechner", playing: true, jetzt
  });

  // 13. Ein Auftrag traegt alles, woran zu erkennen ist, ob er gemeint ist.
  {
    const a = basis();
    pruefe("13. Der Auftrag traegt Raum, Titel, Folge, Ziel, Generation und Zeit",
      a.raum === "wohnzimmer" && a.key.endsWith("bleach") && a.season === 1 && a.episode === 5
        && a.generation === 3 && a.erstellt === jetzt && a.url.endsWith("episode-5")
        && a.hostId === "rechner" && a.playing === true && a.id.includes("|3"),
      a.id);
  }

  // 14. Ein Ereignis eines anderen Titels im selben Raum ruehrt ihn nicht an.
  //     Bleach, Korra und BLACK TORCH liegen im selben Raum.
  {
    const a = basis();
    pruefe("14. Ein anderer Titel im selben Raum macht den Auftrag nicht gueltig",
      auftragGilt(a, { jetzt, generation: 3, raum: "wohnzimmer", key: "https://aniworld.to/anime/stream/korra" }) === false
      && auftragGilt(a, { jetzt, generation: 3, raum: "wohnzimmer", key: a.key }) === true);
    pruefe("14b. Und ein anderer Raum ebenso wenig",
      auftragGilt(a, { jetzt, generation: 3, raum: "kueche", key: a.key }) === false);
  }

  // 15. Eine neuere Generation hat das letzte Wort: der Host hat waehrend des
  //     Ladens erneut gewechselt.
  {
    const a = basis();
    pruefe("15. Eine neuere Generation macht den Auftrag ungueltig",
      auftragGilt(a, { jetzt, generation: 4, raum: a.raum, key: a.key }) === false
      && auftragGilt(a, { jetzt, generation: 3, raum: a.raum, key: a.key }) === true);
  }

  // 16. Ein Auftrag von vorhin startet spaeter nicht die falsche Folge.
  {
    const a = basis();
    pruefe("16. Steht eine andere Folge offen, gilt der Auftrag nicht",
      auftragGilt(a, { jetzt, generation: 3, raum: a.raum, key: a.key, season: 1, episode: 6 }) === false
      && auftragGilt(a, { jetzt, generation: 3, raum: a.raum, key: a.key, season: 1, episode: 5 }) === true);
    pruefe("16b. Solange die Seite noch laedt und keine Folge dasteht, gilt er weiter",
      auftragGilt(a, { jetzt, generation: 3, raum: a.raum, key: a.key, season: 0, episode: 0 }) === true);
  }

  // 17. Und er gilt nicht ewig.
  {
    const a = basis();
    pruefe("17. Nach der Frist ist der Auftrag ungueltig",
      auftragGilt(a, { jetzt: jetzt + AUFTRAG_FRIST_MS + 1, generation: 3, raum: a.raum, key: a.key }) === false
      && auftragGilt(a, { jetzt: jetzt + AUFTRAG_FRIST_MS - 1000, generation: 3, raum: a.raum, key: a.key }) === true);
  }

  // 18. Der erste Versuch geht sofort, die naechsten mit wachsendem Abstand.
  {
    const a = basis();
    const lage = (t, extra = {}) => ({ jetzt: t, generation: 3, raum: a.raum, key: a.key, ...extra });
    const erst = naechsterSchritt(a, lage(jetzt));
    pruefe("18. Der erste Versuch geht sofort", erst.tun === "anfordern", erst.grund);
    versuchVermerken(a, jetzt);
    const gleich = naechsterSchritt(a, lage(jetzt + 100));
    pruefe("18b. Und der naechste erst nach dem Abstand",
      gleich.tun === "warten" && gleich.wartenMs > 0,
      `${gleich.tun} ${gleich.wartenMs}`);
    const spaeter = naechsterSchritt(a, lage(jetzt + ABSTAND_MS[1] + 10));
    pruefe("18c. Ist der Abstand um, wird erneut angefordert",
      spaeter.tun === "anfordern", spaeter.tun);
  }

  // 19. Ein laufender Versuch wird nicht ueberholt. Zwei gleichzeitige Anlaeufe
  //     pausieren einander zuverlaessig.
  {
    const a = basis();
    const schritt = naechsterSchritt(a, {
      jetzt: jetzt + 500, generation: 3, raum: a.raum, key: a.key, berichtOffenSeit: jetzt
    });
    pruefe("19. Solange ein Bericht offen ist, wartet der naechste Versuch",
      schritt.tun === "warten" && schritt.grund === "bericht offen",
      `${schritt.tun}/${schritt.grund}`);
    const danach = naechsterSchritt(a, {
      jetzt: jetzt + BERICHT_FRIST_MS + 10, generation: 3, raum: a.raum, key: a.key,
      berichtOffenSeit: jetzt
    });
    pruefe("19b. Meldet sich der Player gar nicht, geht es trotzdem weiter",
      danach.tun === "anfordern", danach.tun);
  }

  // 20. Keine Endlosschleife: nach den Versuchen ist Schluss, mit Begruendung.
  {
    const a = basis();
    let t = jetzt;
    for (let i = 0; i < HOECHSTVERSUCHE; i += 1) {
      t += 20000;
      const schritt = naechsterSchritt(a, { jetzt: t, generation: 3, raum: a.raum, key: a.key });
      if (schritt.tun === "anfordern") versuchVermerken(a, t);
    }
    const ende = naechsterSchritt(a, { jetzt: t + 20000, generation: 3, raum: a.raum, key: a.key });
    pruefe("20. Nach den erlaubten Versuchen wird aufgegeben",
      ende.tun === "aufgeben" && a.versuche === HOECHSTVERSUCHE,
      `${ende.tun} nach ${a.versuche} Versuchen: ${ende.grund}`);
    pruefe("20b. Und der Grund ist lesbar", ende.grund.length > 0, ende.grund);
  }

  // 21. Ein Bericht aus einem anderen Auftrag wird abgewiesen - sonst meldete
  //     der Player der vorigen Folge diesen hier als erledigt.
  {
    const a = basis();
    pruefe("21. Ein fremder Bericht gehoert nicht zu diesem Auftrag",
      berichtVerarbeiten(a, { auftrag: "wohnzimmer|x|s1e4|2", ok: true }) === false
        && a.fertig === false);
    pruefe("21b. Der eigene schon",
      berichtVerarbeiten(a, { auftrag: a.id, ok: true, zustand: "laeuft" }) === true
        && a.fertig === true && a.grund === "laeuft");
  }

  // 22. Nach dem Erfolg ist Ruhe - kein sekuendliches Nachklopfen.
  {
    const a = basis();
    berichtVerarbeiten(a, { auftrag: a.id, ok: true, zustand: "laeuft" });
    const schritt = naechsterSchritt(a, { jetzt: jetzt + 30000, generation: 3, raum: a.raum, key: a.key });
    pruefe("22. Nach dem Erfolg wird nicht weiter angeklopft",
      schritt.tun === "aufgeben" && schritt.grund === "laeuft", `${schritt.tun}/${schritt.grund}`);
  }

  // 23. Ein misslungener Versuch beendet den Auftrag nicht - er bekommt einen
  //     weiteren, und der Grund bleibt stehen.
  {
    const a = basis();
    berichtVerarbeiten(a, { auftrag: a.id, ok: false, zustand: "keine-quelle", grund: "Quelle blieb aus" });
    pruefe("23. Ein Fehlschlag beendet den Auftrag nicht",
      a.fertig === false && a.grund === "Quelle blieb aus", a.grund);
    const schritt = naechsterSchritt(a, { jetzt: jetzt + 10, generation: 3, raum: a.raum, key: a.key });
    pruefe("23b. Und es gibt einen weiteren Versuch", schritt.tun === "anfordern", schritt.tun);
  }

  // 24. Die Berichtszeile ist die, auf die Java horcht.
  {
    const zeile = MELDE_START + JSON.stringify({ auftrag: "a", ok: true, zustand: "laeuft", stelle: 17.2 });
    const gelesen = berichtLesen(zeile);
    pruefe("24. Eine Berichtszeile wird zerlegt",
      gelesen && gelesen.ok === true && gelesen.stelle === 17.2, JSON.stringify(gelesen));
    pruefe("24b. Und alles andere nicht",
      berichtLesen("__elfix:wp:stand:{}") === null && berichtLesen("irgendwas") === null
        && berichtLesen(MELDE_START + "kein json") === null);
  }

  // 25. Der Waehler der Ueberlagerung ist genau einer - und der, den auch der
  //     Rechner benutzt.
  {
    const main = require("fs").readFileSync(require("path").join(__dirname, "../src/main.js"), "utf8");
    pruefe("25. Der Rechner benutzt dieselbe Liste und nicht seine eigene Abschrift",
      main.includes("watchpartyAutostart.UEBERLAGERUNG_WAEHLER")
        && UEBERLAGERUNG_WAEHLER[0] === ".jw-icon-display");
  }

  /* ================================================== 3. Die Serveradresse */

  // 26. In Form gebracht: was aus einer Fernbedienungstastatur kommt.
  {
    const faelle = [
      ["  https://watchparty.example.at  ", "https://watchparty.example.at"],
      ["https://watchparty.example.at/", "https://watchparty.example.at"],
      ["https://watchparty.example.at///", "https://watchparty.example.at"],
      ["http://192.168.1.10:8787", "http://192.168.1.10:8787"],
      ["http://192.168.1.10:8787/", "http://192.168.1.10:8787"],
      ["​https://relay.example.org﻿", "https://relay.example.org"],
      ["", ""],
      [null, ""],
      [undefined, ""]
    ];
    let alle = true;
    for (const [roh, soll] of faelle) {
      const ist = serverNormalisieren(roh);
      if (ist !== soll) { alle = false; console.log(`      ${JSON.stringify(roh)} -> ${JSON.stringify(ist)}, erwartet ${JSON.stringify(soll)}`); }
    }
    pruefe("26. Leerzeichen, Schraegstriche und unsichtbare Zeichen fallen weg", alle);
  }

  // 27. Was durchgeht.
  {
    const gut = [
      "https://watchparty.example.at",
      "http://192.168.1.10:8787",
      "https://relay.example.org/",
      "  http://relay.example.org:8080  ",
      "wss://relay.example.org",
      "ws://192.168.1.10:8787",
      ""
    ];
    const schlecht = gut.filter((wert) => serverBeanstandung(wert) !== "");
    pruefe("27. Gueltige Adressen werden angenommen - auch die leere",
      schlecht.length === 0, schlecht.map((w) => `${w}: ${serverBeanstandung(w)}`).join(" | "));
  }

  // 28. Und was nicht - mit einem Grund, den man lesen kann.
  {
    const schlecht = [
      ["watchparty.example.at", /Protokoll/],
      ["192.168.1.10:8787", /Protokoll/],
      ["ftp://relay.example.org", /Erlaubt/],
      ["https://relay.example.org:99999", /Port|unvollst/],
      ["https://relay.example.org:", /Port/],
      ["https://", /Rechnername|unvollst/],
      ["http://relay example.org", /Leerzeichen/]
    ];
    let alle = true;
    for (const [wert, muster] of schlecht) {
      const grund = serverBeanstandung(wert);
      if (!grund || !muster.test(grund)) {
        alle = false;
        console.log(`      ${JSON.stringify(wert)} -> ${JSON.stringify(grund)}`);
      }
    }
    pruefe("28. Ungueltige Adressen werden verstaendlich abgelehnt", alle);
  }

  // 29. Und daraus wird dieselbe Leitung, egal wie sie eingetippt wurde.
  {
    const gleich = websocketAdresse("https://watchparty.example.at/")
      === websocketAdresse("  https://watchparty.example.at  ");
    pruefe("29. Ein Schraegstrich am Ende ergibt keine andere Verbindung",
      gleich && websocketAdresse("https://watchparty.example.at/") === "wss://watchparty.example.at",
      websocketAdresse("https://watchparty.example.at/"));
    pruefe("29b. http wird ws, https wird wss, ein Port bleibt stehen",
      websocketAdresse("http://192.168.1.10:8787") === "ws://192.168.1.10:8787"
        && websocketAdresse("wss://relay.example.org") === "wss://relay.example.org",
      websocketAdresse("http://192.168.1.10:8787"));
  }

  /* ============================================ 4. Die Rechnung des Einstiegs */

  // 30. Dieselbe Rechnung, die im Skript steckt - hier ohne Player.
  {
    const t = 1_700_000_000_000;
    const laeuft = zielZeitBerechnen({ videoTime: 12, timestamp: t, playing: true, hatUhr: true }, t + 5000);
    const steht = zielZeitBerechnen({ videoTime: 12, timestamp: t, playing: false, hatUhr: true }, t + 5000);
    const ohneUhr = zielZeitBerechnen({ videoTime: 12, timestamp: t, playing: true, hatUhr: false }, t + 5000);
    const lange = zielZeitBerechnen({ videoTime: 12, timestamp: t, playing: true, hatUhr: true }, t + 120000);
    pruefe("30. Fuenf Sekunden Ladezeit stehen in der Rechnung", nah(laeuft, 17, 0.001), String(laeuft));
    pruefe("30b. Ein stehender Host wird nicht hochgerechnet", steht === 12, String(steht));
    pruefe("30c. Ohne Uhrabgleich ebenso wenig", ohneUhr === 12, String(ohneUhr));
    pruefe("30d. Und ein absurd alter Stempel wird gedeckelt", lange === 42, String(lange));
  }

  /* ======================== 5. Eine Pause bei null ist kein Befehl */

  // Gemeldet und am 2026-08-29 am Fire TV Stick nachgestellt: "Folge öffnen"
  // aus der Watchparty liess den Player im Vollbild bei 0:00 stehen. Im
  // Protokoll "Autostart fertig: pausiert bei 0s", danach im Sekundentakt
  // "wirklich gespielt 0.0s". Der Grund war kein Fehler im Ablauf, sondern
  // seine Folgerichtigkeit: den Titel hatte in der Runde noch nie jemand
  // gestartet, sein Stand war "pausiert bei 0", und genau das stellte das
  // Startskript her. Damit wartete jedes Mitglied auf jedes andere.
  {
    const leer = { videoTime: 0, timestamp: 1, playing: false, hatUhr: false };
    const angefangen = { videoTime: 97, timestamp: 1, playing: false, hatUhr: false };
    const laufend = { videoTime: 0, timestamp: 1, playing: true, hatUhr: true };
    pruefe("31. Pausiert bei null ist ein Stand, dem niemand folgen kann",
      standTraegtNichts(leer) === true);
    pruefe("31b. Mitten in der Folge angehalten ist eine echte Ansage",
      standTraegtNichts(angefangen) === false);
    pruefe("31c. Und wer laeuft, laeuft - auch bei null",
      standTraegtNichts(laufend) === false);
    pruefe("31d. Ein Antippen bei 0,3s zaehlt noch als nicht angefangen",
      standTraegtNichts({ videoTime: 0.3, playing: false }) === true);

    // Und das ist der Punkt: dasselbe Skript startet jetzt, statt anzuhalten.
    const skriptLeer = startScript("a|k|s1e1|1", leer, { playing: false });
    const skriptPause = startScript("a|k|s1e1|1", angefangen, { playing: false });
    pruefe("31e. Beim leeren Stand geht das Startskript auf Wiedergabe",
      /SOLL_LAUFEN = true/.test(skriptLeer));
    pruefe("31f. Beim echten Pausenstand bleibt es beim Anhalten",
      /SOLL_LAUFEN = false/.test(skriptPause));
  }

  const fehlgeschlagen = pruefungen.filter((p) => !p).length;
  console.log(`${pruefungen.length - fehlgeschlagen}/${pruefungen.length} bestanden`);
  process.exit(fehlgeschlagen ? 1 : 0);
})();
