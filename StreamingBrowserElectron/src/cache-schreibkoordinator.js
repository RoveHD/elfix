"use strict";

const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { Worker } = require("node:worker_threads");

const STANDARD_ARBEITER = path.join(__dirname, "cache-schreibarbeiter.js");

/**
 * Ein begrenzter Schreibkanal fuer grosse JSON-Caches.
 *
 * Es gibt genau einen aktiven Worker-Auftrag. Pro zugelassener Datei bleibt
 * hoechstens ein weiterer Stand im Hauptprozess; eine neuere Aenderung ersetzt
 * dort die aeltere, bevor sie strukturiert geklont wird.
 */
function erstellen({
  hoechstensDateien = 2,
  arbeiterDatei = STANDARD_ARBEITER,
  schlussFristMs = 10000,
  beiFehler = () => {}
} = {}) {
  if (!Number.isInteger(hoechstensDateien) || hoechstensDateien < 1) {
    throw new RangeError("hoechstensDateien muss eine positive ganze Zahl sein");
  }

  const staende = new Map();
  const warteschlange = [];
  const stilleWartende = new Set();
  let arbeiter = null;
  let aktiv = null;
  let naechsteId = 0;
  let naechsteFassung = 0;
  let gesendet = 0;
  let zusammengefasst = 0;
  let groessteWarteschlange = 0;
  let schliesst = false;
  let absichtlichBeendet = false;

  function zustandFuer(datei) {
    const voll = path.resolve(String(datei));
    let stand = staende.get(voll);
    if (!stand) {
      if (staende.size >= hoechstensDateien) {
        throw new RangeError(`Cache-Schreibkanal ist auf ${hoechstensDateien} Dateien begrenzt`);
      }
      stand = { datei: voll, wartend: null, wiederholung: null, eingereiht: false, fehler: null };
      staende.set(voll, stand);
    }
    return stand;
  }

  function einreihen(stand) {
    if (stand.eingereiht) return;
    stand.eingereiht = true;
    warteschlange.push(stand);
    groessteWarteschlange = Math.max(groessteWarteschlange, warteschlange.length);
  }

  function fehlerMelden(stand, fehler) {
    stand.fehler = fehler;
    try { beiFehler(fehler, stand.datei); } catch {}
  }

  function arbeiterHolen() {
    if (arbeiter) return arbeiter;
    const neu = new Worker(arbeiterDatei);
    neu.unref();
    arbeiter = neu;

    neu.on("message", (nachricht) => {
      if (nachricht?.typ !== "geschrieben" || !aktiv || nachricht.id !== aktiv.id) return;
      const erledigt = aktiv;
      aktiv = null;
      const stand = erledigt.stand;
      if (nachricht.ok) {
        stand.fehler = null;
        stand.wiederholung = null;
      } else {
        const fehler = Object.assign(new Error(nachricht.fehler?.message || "Cache konnte nicht geschrieben werden"),
          nachricht.fehler || {});
        // Gibt es bereits einen neueren Stand, ist nur dieser noch wichtig.
        if (!stand.wartend) stand.wiederholung = erledigt.auftrag;
        fehlerMelden(stand, fehler);
      }
      weiter();
    });

    let workerFehler = null;
    neu.once("error", (fehler) => { workerFehler = fehler; });
    neu.once("exit", (code) => {
      if (arbeiter === neu) arbeiter = null;
      if (absichtlichBeendet) return;
      const fehler = workerFehler || new Error(`Cache-Worker vorzeitig beendet (${code})`);
      if (aktiv) {
        const erledigt = aktiv;
        aktiv = null;
        if (!erledigt.stand.wartend) erledigt.stand.wiederholung = erledigt.auftrag;
        fehlerMelden(erledigt.stand, fehler);
      }
      // Auch noch nicht abgesandte Staende bleiben fuer einen spaeteren
      // Versuch erhalten. Der aktuelle Leerungsaufruf endet fail-open, statt
      // an einer Warteschlange ohne Worker haengen zu bleiben.
      for (const stand of warteschlange) {
        stand.eingereiht = false;
        if (stand.wartend) {
          stand.wiederholung = stand.wartend;
          stand.wartend = null;
        }
        fehlerMelden(stand, fehler);
      }
      warteschlange.length = 0;
      stilleMelden();
    });
    return neu;
  }

  function stilleMelden() {
    if (aktiv || warteschlange.length) return;
    arbeiter?.unref();
    const ergebnis = status();
    for (const fertig of stilleWartende) fertig(ergebnis);
    stilleWartende.clear();
  }

  function weiter() {
    if (aktiv) return;
    while (warteschlange.length) {
      const stand = warteschlange.shift();
      stand.eingereiht = false;
      const auftrag = stand.wartend;
      stand.wartend = null;
      if (!auftrag) continue;

      const id = ++naechsteId;
      aktiv = { id, stand, auftrag };
      try {
        const kanal = arbeiterHolen();
        kanal.ref();
        // postMessage klont synchron. Weil erst hier geklont wird, erreichen
        // ueberholte Zwischenstaende den Worker und seinen Speicher nie.
        kanal.postMessage({ typ: "schreiben", id, ...auftrag });
        gesendet += 1;
      } catch (fehler) {
        aktiv = null;
        if (!stand.wartend) stand.wiederholung = auftrag;
        fehlerMelden(stand, fehler);
        continue;
      }
      return;
    }
    stilleMelden();
  }

  function schreiben(datei, daten, { einrueckung = 0 } = {}) {
    if (schliesst) return false;
    const stand = zustandFuer(datei);
    const auftrag = {
      datei: stand.datei,
      daten,
      fassung: ++naechsteFassung,
      einrueckung: Number.isInteger(einrueckung) ? einrueckung : 0
    };
    if (stand.wartend) zusammengefasst += 1;
    stand.wartend = auftrag;
    stand.wiederholung = null;
    einreihen(stand);
    weiter();
    return auftrag.fassung;
  }

  function wiederholen() {
    if (schliesst) return;
    for (const stand of staende.values()) {
      if (!stand.wartend && stand.wiederholung) {
        stand.wartend = stand.wiederholung;
        stand.wiederholung = null;
        einreihen(stand);
      }
    }
    weiter();
  }

  function leeren({ fehlerWiederholen = true } = {}) {
    if (fehlerWiederholen) wiederholen();
    if (!aktiv && !warteschlange.length) return Promise.resolve(status());
    return new Promise((fertig) => stilleWartende.add(fertig));
  }

  function status() {
    const fehler = [];
    for (const stand of staende.values()) {
      if (stand.fehler) fehler.push({ datei: stand.datei, fehler: stand.fehler });
    }
    return {
      aktiv: Boolean(aktiv),
      wartend: warteschlange.length,
      dateien: staende.size,
      gesendet,
      zusammengefasst,
      groessteWarteschlange,
      fehler
    };
  }

  /**
   * Schreibt beim App-Ende alle juengsten Staende und wartet auf eine Barriere
   * im selben Worker. Die kurze Blockade ist nur fuer before-quit gedacht.
   */
  function beendenSynchron() {
    if (schliesst) return { ok: true, bereitsBeendet: true, dauerMs: 0, fehler: 0 };
    schliesst = true;
    // Wurde nie etwas geplant, gibt es weder einen alten Worker noch einen
    // finalen Stand. Besonders beim sehr fruehen App-Ende darf Quit deshalb
    // keinen Worker nur fuer eine leere Barriere starten.
    if (naechsteFassung === 0) {
      return { ok: true, keineArbeit: true, dauerMs: 0, fehler: 0 };
    }
    const beginn = performance.now();
    let kanal;
    try {
      kanal = arbeiterHolen();
      kanal.ref();
      for (const stand of staende.values()) {
        const auftrag = stand.wartend || stand.wiederholung;
        stand.wartend = null;
        stand.wiederholung = null;
        stand.eingereiht = false;
        if (!auftrag) continue;
        kanal.postMessage({ typ: "schreiben", id: ++naechsteId, ...auftrag });
        gesendet += 1;
      }
      warteschlange.length = 0;

      const puffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
      const signal = new Int32Array(puffer);
      kanal.postMessage({ typ: "barriere", signal: puffer });
      const warten = Atomics.wait(signal, 0, 0, schlussFristMs);
      const fehler = Atomics.load(signal, 1);
      absichtlichBeendet = true;
      void kanal.terminate();
      arbeiter = null;
      aktiv = null;
      return {
        ok: warten !== "timed-out" && fehler === 0,
        zeitUeberschritten: warten === "timed-out",
        dauerMs: performance.now() - beginn,
        fehler
      };
    } catch (fehler) {
      absichtlichBeendet = true;
      if (kanal) void kanal.terminate();
      arbeiter = null;
      aktiv = null;
      try { beiFehler(fehler, null); } catch {}
      return { ok: false, dauerMs: performance.now() - beginn, fehler: 1, grund: fehler };
    }
  }

  return { schreiben, wiederholen, leeren, beendenSynchron, status };
}

module.exports = { erstellen };
