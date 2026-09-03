"use strict";
// Die Skripte, die im Player-Rahmen laufen - gegen ein nachgebautes Video.
//
// Geprueft wird das, was sich sonst nur am echten VOE-Player zeigt: dass der
// Start die Laufzeit der Nachricht und die Pufferzeit einrechnet, dass im
// laufenden Betrieb nichts angefasst wird, und dass kein Weg im Skript je an
// playbackRate dreht.

const {
  applyScript, driftScript, zuruecksetzenScript, beobachterScript, aktionLesen, standLesen
} = require("../src/watchparty-sync");

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

  // --- 14. Der Horcher am Player -------------------------------------------
  //
  // Er ist das Stueck, das Android bis zum Umbau ganz gefehlt hat, und er ist
  // der Grund, warum eine Watchparty einen Folgenwechsel ueberlebt. Geprueft
  // wird hier, was sich am echten Hoster nur schwer zeigen laesst: dass er
  // nach einem Austausch des Videoelements weiterarbeitet, dass er das Echo
  // einer angewendeten Fremdanweisung verschluckt - und nur das.
  {
    // Eine Seite mit Ereignissen. Der Horcher haengt sich am Dokument in der
    // Abfangphase ein, genau wie im Browser.
    // Die Klasse gehoert zur Seite und nicht zum Aufruf: im Browser gibt es sie
    // genau einmal je Dokument, und ein Horcher, der beim ersten Einspielen
    // entstanden ist, prueft gegen dieselbe.
    class HTMLMediaElement {}
    const seite = (medien) => {
      const horcher = new Map();
      const logs = [];
      const liste = medien.slice();
      for (const m of liste) Object.setPrototypeOf(m, HTMLMediaElement.prototype);
      const dokument = {
        addEventListener: (name, fn) => {
          if (!horcher.has(name)) horcher.set(name, []);
          horcher.get(name).push(fn);
        },
        querySelectorAll: () => liste
      };
      return {
        dokument, logs, liste, horcher,
        fenster: {},
        // Ein Medienereignis, wie der Browser es liefert.
        feuern: (name, ziel) => {
          for (const fn of horcher.get(name) || []) fn({ target: ziel });
        },
        // Wieviele Horcher haengen insgesamt - fuer die Frage nach Doppelten.
        anzahl: () => [...horcher.values()].reduce((summe, l) => summe + l.length, 0)
      };
    };

    // Das Skript laeuft im Seitenkontext. HTMLMediaElement muss es geben:
    // daran erkennt der Horcher, ob ein Ereignis von einem Video kommt.
    const laufen = (welt, quelltext) => {
      for (const m of welt.liste) Object.setPrototypeOf(m, HTMLMediaElement.prototype);
      const umgebung = {
        document: welt.dokument,
        window: welt.fenster,
        console: { log: (zeile) => welt.logs.push(String(zeile)) },
        HTMLMediaElement,
        Date, Math, Number, Boolean, Array, JSON, setTimeout
      };
      const namen = Object.keys(umgebung);
      // eslint-disable-next-line no-new-func
      return new Function(...namen, `return ${quelltext};`)(...namen.map((n) => umgebung[n]));
    };

    // 14a. Play, Pause und Sprung werden gemeldet.
    {
      const m = video(120, { paused: false });
      const welt = seite([m]);
      const erst = laufen(welt, beobachterScript());
      welt.feuern("play", m);
      welt.feuern("pause", m);
      welt.feuern("seeked", m);
      const taten = welt.logs.map(aktionLesen).filter(Boolean).map((t) => t.aktion);
      pruefe("14a. Der Horcher meldet Play, Pause und Sprung",
        erst === "installiert" && taten.join(",") === "play,pause,seek",
        taten.join(",") || "nichts gemeldet");
      const staende = welt.logs.map(standLesen).filter(Boolean);
      pruefe("14b. Und wo das Geraet dabei steht",
        staende.length >= 3 && nah(staende[0].position, 120, 0.01),
        JSON.stringify(staende[0] || null));
    }

    // 14c. Zweimal einspielen ergibt keine doppelten Horcher. Das ist die
    // Antwort auf "ein Tastendruck, drei Ereignisse": das Skript wird bei
    // jeder Rahmenmeldung nachgereicht, und das darf nichts kosten.
    {
      const m = video(10, { paused: false });
      const welt = seite([m]);
      laufen(welt, beobachterScript());
      const nachEinem = welt.anzahl();
      const zweiter = laufen(welt, beobachterScript());
      welt.feuern("pause", m);
      const pausen = welt.logs.map(aktionLesen).filter((t) => t && t.aktion === "pause").length;
      pruefe("14c. Zweimal eingespielt haengt der Horcher trotzdem nur einmal",
        zweiter === "schon-da" && welt.anzahl() === nachEinem && pausen === 1,
        `${zweiter}, ${welt.anzahl()} Horcher, ${pausen} Meldungen`);
    }

    // 14d. Der Player wird ausgetauscht - Hoster-, Sprach- oder Folgenwechsel.
    // Der Horcher haengt am Dokument, nicht am Element, und gilt weiter.
    {
      const alt = video(10, { paused: false });
      const welt = seite([alt]);
      laufen(welt, beobachterScript());
      // Der Hoster ersetzt das Videoelement durch ein neues.
      const neu = video(0, { paused: true });
      Object.setPrototypeOf(neu, HTMLMediaElement.prototype);
      welt.liste.length = 0;
      welt.liste.push(neu);
      welt.logs.length = 0;
      welt.feuern("play", neu);
      const taten = welt.logs.map(aktionLesen).filter(Boolean).map((t) => t.aktion);
      pruefe("14d. Nach dem Austausch des Videoelements meldet er weiter",
        taten.includes("play"),
        taten.join(",") || "nichts gemeldet");
    }

    // 14e. Der Loop-Schutz. Ein angewendetes fremdes Pause meldet sich nicht
    // als eigene Tat zurueck - sonst schaukeln sich zwei Geraete auf.
    {
      const m = video(50, { paused: false });
      const welt = seite([m]);
      laufen(welt, beobachterScript());
      // So, wie applyScript es setzt, bevor es media.pause() ruft.
      welt.fenster.__elfixWpErwartet = { aktion: "pause", ziel: 50, bis: Date.now() + 1500 };
      welt.feuern("pause", m);
      const gemeldet = welt.logs.map(aktionLesen).filter((t) => t && t.aktion === "pause");
      pruefe("14e. Das Echo einer angewendeten Fremdanweisung wird verschluckt",
        gemeldet.length === 0,
        `${gemeldet.length} Meldungen`);

      // Aber nur das Echo: wer waehrend eines eingehenden Play selbst Pause
      // drueckt, meint das ernst.
      welt.logs.length = 0;
      welt.fenster.__elfixWpErwartet = { aktion: "play", ziel: 50, bis: Date.now() + 1500 };
      welt.feuern("pause", m);
      const echt = welt.logs.map(aktionLesen).filter((t) => t && t.aktion === "pause");
      pruefe("14f. Eine Gegenrichtung kommt weiterhin durch",
        echt.length === 1,
        `${echt.length} Meldungen`);
    }

    // 14e2. Zwei Anweisungen dicht hintereinander - und das Echo der ersten
    // kommt erst danach.
    //
    // Gemessen am 25.08.2026 auf dem Telefon (Rechner drueckt Pause, Handy
    // schaut mit): das Relay schickt hinter das Pause sofort die genaue Stelle
    // als "seek" nach. Beide Anweisungen waren angewendet, bevor der Player
    // sein Pause-Ereignis meldete. Der Merker trug da schon "seek", das Echo
    // ging als eigene Tat hinaus - und in der Runde stand danach
    // pausedBy="Handy", obwohl der Rechner pausiert hatte.
    {
      const m = video(110, { paused: false });
      const welt = seite([m]);
      laufen(welt, beobachterScript());
      const jetzt = Date.now();
      // So, wie zwei applyScript-Laeufe kurz hintereinander es hinterlassen.
      welt.fenster.__elfixWpEcho = [
        { aktion: "pause", ziel: 110, bis: jetzt + 1500 },
        { aktion: "seek", ziel: 110, bis: jetzt + 1500 }
      ];
      welt.fenster.__elfixWpErwartet = welt.fenster.__elfixWpEcho[1];
      welt.feuern("pause", m);
      const zurueck = welt.logs.map(aktionLesen).filter((t) => t && t.aktion === "pause");
      pruefe("14e2. Auch das Echo der vorletzten Anweisung wird verschluckt",
        zurueck.length === 0,
        `${zurueck.length} Meldungen - sonst steht in der Runde der falsche pausedBy`);

      // Und die Gegenrichtung kommt trotzdem durch: nach Ablauf beider Fristen
      // ist ein Pause wieder eine eigene Tat.
      welt.logs.length = 0;
      welt.fenster.__elfixWpEcho = [{ aktion: "pause", ziel: 110, bis: jetzt - 1 }];
      welt.fenster.__elfixWpErwartet = null;
      welt.feuern("pause", m);
      pruefe("14e3. Eine abgelaufene Anweisung verschluckt nichts mehr",
        welt.logs.map(aktionLesen).filter((t) => t && t.aktion === "pause").length === 1);
    }

    // 14g. Beim Sprung entscheidet die Stelle, nicht die Art: wer waehrend
    // eines fremden Sprungs selbst woandershin spult, meint das ernst.
    {
      const m = video(300, { paused: false });
      const welt = seite([m]);
      laufen(welt, beobachterScript());
      welt.fenster.__elfixWpErwartet = { aktion: "seek", ziel: 300, bis: Date.now() + 1500 };
      welt.feuern("seeked", m);
      const echo = welt.logs.map(aktionLesen).filter((t) => t && t.aktion === "seek").length;
      m._zeit = 900;
      welt.logs.length = 0;
      welt.feuern("seeked", m);
      const eigener = welt.logs.map(aktionLesen).filter((t) => t && t.aktion === "seek").length;
      pruefe("14g. Beim Sprung zaehlt die Zielstelle, nicht die Art",
        echo === 0 && eigener === 1,
        `Echo ${echo}, eigener ${eigener}`);
    }

    // 14h. Und die Anweisung, die der Horcher abfaengt, wird von applyScript
    // auch wirklich gesetzt - sonst haenge der Schutz in der Luft.
    {
      const m = video(0);
      const { fenster } = await ausfuehren(
        applyScript("pause", ereignis({ videoTime: 80, playing: false })), m);
      pruefe("14h. applyScript meldet seine Anweisung beim Horcher an",
        Boolean(fenster.__elfixWpErwartet) && fenster.__elfixWpErwartet.aktion === "pause",
        JSON.stringify(fenster.__elfixWpErwartet || null));
    }
  }

  // --- 15. Der Nachlauf eines langsamen Geraets -----------------------------
  //
  // Gemeldet vom Fire TV: "meistens ne Sekunde hinten, weils noch laedt,
  // waehrend die anderen schon schauen koennen." play() nimmt den Befehl an,
  // und das Bild steht noch. Die Notbremse faengt das nicht - sie greift erst
  // ab fuenf Sekunden, mit gutem Grund.
  {
    // Ein Video, das nach dem Start wirklich laeuft. Das ist der Unterschied
    // zum Nachbau oben: dort steht die Zeit still, hier vergeht sie.
    const laufendesVideo = (verzoegerung) => {
      const m = {
        duration: 1400, paused: true, readyState: 4, seeking: false,
        playbackRate: 1, tempoGesetzt: [], spruenge: [], gestartet: 0, gestoppt: 0,
        _zeit: 0, _losUm: 0
      };
      Object.defineProperty(m, "currentTime", {
        configurable: true,
        get: () => {
          if (!m._losUm || m.paused || Date.now() < m._losUm) return m._zeit;
          return m._zeit + (Date.now() - m._losUm) / 1000;
        },
        set: (wert) => {
          m.spruenge.push(Number(wert));
          m._zeit = Number(wert);
          // Ein Sprung setzt die Uhr neu an: von hier laeuft es weiter.
          if (m._losUm) m._losUm = Date.now();
        }
      });
      m.play = () => {
        m.gestartet += 1;
        m.paused = false;
        // Erst nach der Verzoegerung bewegt sich wirklich etwas - genau das,
        // was ein langsames Geraet tut.
        m._losUm = Date.now() + verzoegerung;
        return Promise.resolve();
      };
      m.pause = () => { m.gestoppt += 1; m.paused = true; };
      return m;
    };

    // Das Video braucht 900 ms, bis es wirklich losgeht - der Host laeuft in
    // dieser Zeit weiter.
    const m = laufendesVideo(900);
    const start = Date.now();
    await ausfuehren(
      applyScript("play", ereignis({ videoTime: 100, timestamp: start, playing: true })), m);
    const vorKorrektur = m.spruenge.length;
    // Der Nachlauf laeuft *nach* der Antwort - genau darum geht es.
    await new Promise((f) => setTimeout(f, 1400));
    pruefe("15. Ein langsames Geraet holt nach dem Start selbst auf",
      m.spruenge.length > vorKorrektur,
      `${vorKorrektur} Spruenge vorher, ${m.spruenge.length} nachher`);
    const letzter = m.spruenge[m.spruenge.length - 1];
    pruefe("15b. Und zwar nach vorn, auf die Stelle der Runde",
      letzter > 100 && nah(letzter, 100 + (Date.now() - start) / 1000, 0.5),
      `${letzter?.toFixed(2)}`);

    // Ein schnelles Geraet wird dagegen nicht angefasst: ein Sprung, den
    // niemand braucht, ist ein Puffervorgang, den niemand braucht.
    const flink = laufendesVideo(0);
    const start2 = Date.now();
    await ausfuehren(
      applyScript("play", ereignis({ videoTime: 100, timestamp: start2, playing: true })), flink);
    const vorher2 = flink.spruenge.length;
    await new Promise((f) => setTimeout(f, 1400));
    pruefe("15c. Ein schnelles Geraet bleibt unangetastet",
      flink.spruenge.length === vorher2,
      `${vorher2} -> ${flink.spruenge.length}`);
  }

  const fehler = pruefungen.filter((p) => !p).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  process.exit(fehler ? 1 : 0);
})().catch((f) => { console.error("Abgebrochen:", f.stack || f.message); process.exit(2); });
