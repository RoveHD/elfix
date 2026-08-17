"use strict";
// Die Skripte, die im Player-Rahmen laufen - gegen ein nachgebautes Video.
//
// Geprueft wird das, was sich sonst nur am echten VOE-Player zeigt: dass der
// Start die Laufzeit der Nachricht und die Pufferzeit einrechnet, dass im
// laufenden Betrieb nichts angefasst wird, und dass kein Weg im Skript je an
// playbackRate dreht.

const { applyScript, driftScript, zuruecksetzenScript } = require("../src/watchparty-sync");

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(b); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };
const nah = (a, b, toleranz = 0.05) => Math.abs(a - b) <= toleranz;

// Ein Video, wie der Player es sieht. `puffern` verzoegert das Fertigwerden
// eines Sprungs - genau das, was VOE staendig tut.
function video(start = 0, optionen = {}) {
  const m = {
    duration: optionen.duration || 1400,
    paused: optionen.paused !== false,
    readyState: optionen.readyState === undefined ? 4 : optionen.readyState,
    seeking: false,
    playbackRate: optionen.playbackRate || 1,
    tempoGesetzt: [],
    spruenge: [],
    gestartet: 0,
    gestoppt: 0,
    _zeit: start
  };
  Object.defineProperty(m, "currentTime", {
    get: () => m._zeit,
    set: (wert) => {
      m.spruenge.push(Number(wert));
      m.seeking = true;
      // Nur der erste Sprung puffert. Der zweite geht ein Stueck nach vorn in
      // den Bereich, der gerade geladen wurde - so verhaelt sich auch ein
      // echter Player.
      const dauer = m.spruenge.length === 1 ? (optionen.puffern || 0) : 0;
      const fertig = () => { m._zeit = Number(wert); m.seeking = false; };
      if (dauer > 0) setTimeout(fertig, dauer);
      else fertig();
    }
  });
  Object.defineProperty(m, "playbackRate", {
    get: () => m._tempo === undefined ? (optionen.playbackRate || 1) : m._tempo,
    set: (wert) => { m.tempoGesetzt.push(Number(wert)); m._tempo = Number(wert); }
  });
  m.play = () => { m.gestartet += 1; m.paused = false; return Promise.resolve(); };
  m.pause = () => { m.gestoppt += 1; m.paused = true; };
  return m;
}

// Das Skript laeuft im Seitenkontext. Hier bekommt es genau das, was es dort
// vorfindet: ein document mit Videos, ein window und console.
// `fenster` wird bewusst durchgereicht: in der echten Seite ueberlebt window
// jeden Aufruf, und genau daran haengt die Zaehlung bestaetigter Messungen.
async function ausfuehren(quelltext, medien, fenster = {}) {
  const liste = Array.isArray(medien) ? medien : [medien];
  const logs = [];
  const umgebung = {
    document: { querySelectorAll: () => liste },
    window: fenster,
    console: { log: (zeile) => logs.push(String(zeile)) },
    setTimeout,
    Date,
    Math,
    Number,
    Boolean,
    Array,
    JSON,
    Promise
  };
  const namen = Object.keys(umgebung);
  // eslint-disable-next-line no-new-func
  const bauen = new Function(...namen, `return ${quelltext};`);
  const ergebnis = await bauen(...namen.map((name) => umgebung[name]));
  return { ergebnis, logs, fenster };
}

const ereignis = (felder) => ({ videoTime: 0, timestamp: Date.now(), playing: false, hatUhr: true, versatz: 0, ...felder });

(async () => {
  // --- 1. Gemeinsamer Start ------------------------------------------------
  {
    // Der Host drueckte vor 400 ms bei 100 s Play. Wir muessen bei ~100,4
    // einsteigen, nicht bei 100.
    const m = video(0);
    const { ergebnis } = await ausfuehren(
      applyScript("play", ereignis({ videoTime: 100, timestamp: Date.now() - 400, playing: true })), m);
    pruefe("1. Play startet die Wiedergabe", ergebnis === "laeuft" && m.gestartet === 1, ergebnis);
    pruefe("1b. Und steigt dort ein, wo der Host inzwischen steht",
      m.spruenge.length > 0 && nah(m.spruenge[0], 100.4, 0.15),
      `Sprung auf ${m.spruenge[0]?.toFixed(3)} statt 100`);
  }

  {
    // Derselbe Start, aber der Hoster braucht 600 ms zum Puffern. Vor dem
    // play() muss noch einmal nachgerechnet worden sein.
    const m = video(0, { puffern: 600 });
    const start = Date.now();
    const { ergebnis } = await ausfuehren(
      applyScript("play", ereignis({ videoTime: 100, timestamp: start, playing: true })), m);
    const gedauert = Date.now() - start;
    const letzter = m.spruenge[m.spruenge.length - 1];
    pruefe("2. Puffert der Hoster, wird vor dem Start nachgerechnet",
      m.spruenge.length >= 2 && letzter > m.spruenge[0],
      `${m.spruenge.map((s) => s.toFixed(2)).join(" -> ")} in ${gedauert} ms`);
    pruefe("2b. Und die Pufferzeit steckt im Ziel",
      nah(letzter, 100 + gedauert / 1000, 0.3),
      `${letzter?.toFixed(2)} bei ${gedauert} ms Verzoegerung`);
    pruefe("2c. Erst danach laeuft es los", ergebnis === "laeuft" && m.gestartet === 1, ergebnis);
  }

  // --- 3. Pause: die Stelle ist endgueltig ---------------------------------
  {
    const m = video(250, { paused: false });
    const { ergebnis } = await ausfuehren(
      applyScript("pause", ereignis({ videoTime: 240, timestamp: Date.now() - 3000, playing: false }),
        { genau: true }), m);
    pruefe("3. Pause haelt an und springt auf die genaue Stelle",
      ergebnis === "pausiert" && m.gestoppt === 1 && nah(m.spruenge[0], 240, 0.001),
      `${ergebnis}, Sprung auf ${m.spruenge[0]}`);
    pruefe("3b. Bei einer Pause wird nichts hochgerechnet",
      m.spruenge.every((s) => nah(s, 240, 0.001)), m.spruenge.join(", "));
  }

  // --- 4. Manueller Sprung des Hosts ---------------------------------------
  {
    // Von 120 auf 500, waehrend er laeuft: der Client muss direkt dorthin.
    const m = video(120, { paused: false });
    await ausfuehren(
      applyScript("seek", ereignis({ videoTime: 500, timestamp: Date.now() - 200, playing: true })), m);
    pruefe("4. Ein Sprung des Hosts wird sofort uebernommen",
      m.spruenge.length === 1 && nah(m.spruenge[0], 500.2, 0.15),
      `auf ${m.spruenge[0]?.toFixed(3)}`);
  }

  // --- 5. Der Host selbst rueckt nie ---------------------------------------
  {
    const m = video(300, { paused: false });
    const { ergebnis } = await ausfuehren(
      applyScript("play", ereignis({ videoTime: 999, timestamp: Date.now(), playing: true }),
        { nichtSpringen: true }), m);
    pruefe("5. Der Host springt nie, laeuft aber mit",
      m.spruenge.length === 0 && m.gestartet === 1, `${ergebnis}, ${m.spruenge.length} Spruenge`);
  }

  // --- 6. Ohne Uhrmessung wird nicht hochgerechnet --------------------------
  {
    const m = video(0);
    await ausfuehren(
      applyScript("play", ereignis({ videoTime: 100, timestamp: Date.now() - 5000, playing: true, hatUhr: false })), m);
    pruefe("6. Ohne Uhrmessung gilt die Stelle, wie sie kam",
      nah(m.spruenge[0], 100, 0.001), `auf ${m.spruenge[0]}`);
  }

  // --- 7. Laufender Betrieb: nichts anfassen -------------------------------
  {
    const m = video(297, { paused: false });
    const jetzt = Date.now();
    const fenster = {};
    const taten = [];
    for (let i = 0; i < 10; i += 1) {
      const { ergebnis } = await ausfuehren(
        driftScript(ereignis({ videoTime: 300, timestamp: jetzt, playing: true })), m, fenster);
      taten.push(ergebnis);
    }
    pruefe("7. Drei Sekunden Versatz: zehnmal 'ignore'",
      taten.every((tat) => tat === "ignore"), [...new Set(taten)].join(", "));
    pruefe("7b. Und der Player wird dabei nicht angefasst",
      m.spruenge.length === 0 && m.gestartet === 0 && m.gestoppt === 0,
      `${m.spruenge.length} Spruenge`);
  }

  // --- 8. Notfall-Sprung erst nach drei Messungen --------------------------
  {
    const m = video(280, { paused: false });
    const jetzt = Date.now();
    const fenster = {};
    const taten = [];
    for (let i = 0; i < 3; i += 1) {
      const { ergebnis } = await ausfuehren(
        driftScript(ereignis({ videoTime: 300, timestamp: jetzt, playing: true })), m, fenster);
      taten.push(ergebnis);
    }
    pruefe("8. Zwanzig Sekunden Versatz springen erst beim dritten Mal",
      taten.join(",") === "beobachten,beobachten,hard-seek", taten.join(" -> "));
    pruefe("8b. Und dann genau einmal, auf die Stelle des Hosts",
      m.spruenge.length === 1 && nah(m.spruenge[0], 300, 0.5), `auf ${m.spruenge[0]?.toFixed(2)}`);
  }

  // --- 9. Waehrend des Puffems wird nicht gesprungen ------------------------
  {
    const m = video(280, { paused: false, readyState: 2 });
    const jetzt = Date.now();
    const fenster = {};
    const taten = [];
    for (let i = 0; i < 5; i += 1) {
      const { ergebnis } = await ausfuehren(
        driftScript(ereignis({ videoTime: 300, timestamp: jetzt, playing: true })), m, fenster);
      taten.push(ergebnis);
    }
    pruefe("9. VOE puffert: keine Messung, kein Sprung",
      taten.every((tat) => tat === "puffert") && m.spruenge.length === 0, taten[0]);
  }

  {
    const m = video(280, { paused: true });
    const { ergebnis } = await ausfuehren(
      driftScript(ereignis({ videoTime: 300, timestamp: Date.now(), playing: true })), m);
    pruefe("9b. Steht der eigene Player, entscheidet nicht der Versatz",
      ergebnis === "steht" && m.spruenge.length === 0, ergebnis);
  }

  // --- 10. 'ignore' steht im Log -------------------------------------------
  {
    const m = video(298, { paused: false });
    const { logs } = await ausfuehren(
      driftScript(ereignis({ videoTime: 300, timestamp: Date.now(), playing: true })), m);
    const zeile = logs.find((l) => l.startsWith("__elfix:wp:sync:"));
    const bericht = zeile ? JSON.parse(zeile.slice("__elfix:wp:sync:".length)) : null;
    pruefe("10. Der Bericht steht im Log und sagt ausdruecklich 'ignore'",
      bericht && bericht.action === "ignore" && nah(bericht.drift, 2, 0.2),
      bericht ? `action=${bericht.action} drift=${bericht.drift}` : "kein Bericht");
  }

  // --- 11. Nirgends wird am Tempo gedreht ----------------------------------
  {
    // Ein Player, an dem eine aeltere Fassung noch 1,02 stehen liess.
    const m = video(300, { paused: false, playbackRate: 1.02 });
    await ausfuehren(driftScript(ereignis({ videoTime: 300, timestamp: Date.now(), playing: true })), m);
    const n = video(100);
    await ausfuehren(applyScript("play", ereignis({ videoTime: 100, timestamp: Date.now(), playing: true })), n);
    pruefe("11. Ein fremdes Tempo wird auf 1 zurueckgestellt",
      m.tempoGesetzt.length === 1 && m.tempoGesetzt[0] === 1, m.tempoGesetzt.join(", ") || "gar nicht");
    pruefe("11b. Und sonst wird es nie angefasst",
      n.tempoGesetzt.length === 0, n.tempoGesetzt.join(", ") || "nie");
  }

  {
    // Der harte Nachweis: in keinem der Skripte steht ein Zuweisen von
    // playbackRate auf etwas anderes als 1.
    const alle = [
      applyScript("play", ereignis({ playing: true })),
      applyScript("pause", ereignis({})),
      driftScript(ereignis({ playing: true })),
      zuruecksetzenScript()
    ].join("\n");
    const zuweisungen = alle.match(/playbackRate\s*=\s*[^;]+/g) || [];
    pruefe("11c. Kein Skript setzt playbackRate je auf etwas anderes als 1",
      zuweisungen.every((z) => /=\s*1\b/.test(z)), zuweisungen.join(" | ") || "keine Zuweisung");
  }

  // --- 11d. Aus dem Netz kommt nichts in den Skript-Text -------------------
  {
    const boese = applyScript('play"; window.geknackt = 1; const x = "', ereignis({ playing: true }));
    pruefe("11d. Eine erfundene Aktion landet nicht im Skript",
      !boese.includes("geknackt") && boese.includes('const aktion = "seek"'),
      "faellt auf 'seek' zurueck");
    const m = video(100);
    const { fenster } = await ausfuehren(boese, m);
    pruefe("11e. Und richtet im Player nichts an",
      fenster.geknackt === undefined, "kein fremder Code gelaufen");
  }

  // --- 12. Kein Video, keine Wirkung ---------------------------------------
  {
    const leer = await ausfuehren(driftScript(ereignis({ playing: true })), []);
    const leer2 = await ausfuehren(applyScript("play", ereignis({ playing: true })), []);
    pruefe("12. Ohne Video passiert nichts",
      leer.ergebnis === "kein-video" && leer2.ergebnis === "kein-video",
      `${leer.ergebnis} / ${leer2.ergebnis}`);
  }

  // --- 13. Zuruecksetzen beim Folgenwechsel --------------------------------
  {
    const m = video(500, { paused: false, playbackRate: 1.02 });
    const { ergebnis, fenster } = await ausfuehren(zuruecksetzenScript(), m);
    pruefe("13. Der Folgenwechsel setzt Zaehlung und Tempo zurueck",
      ergebnis === "zurueckgesetzt" && fenster.__elfixWpSync.bestaetigt === 0
        && fenster.__elfixWpSync.seitSprung === 0 && m.tempoGesetzt[0] === 1,
      JSON.stringify(fenster.__elfixWpSync));
  }

  const fehler = pruefungen.filter((p) => !p).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  process.exit(fehler ? 1 : 0);
})().catch((f) => { console.error("Abgebrochen:", f.stack || f.message); process.exit(2); });
