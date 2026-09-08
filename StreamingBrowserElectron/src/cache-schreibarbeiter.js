"use strict";

// JSON-Serialisierung und Dateizugriff fuer die grossen optionalen Caches
// gehoeren nicht in den Electron-Hauptthread. Dieser Worker bearbeitet bewusst
// nur einen Auftrag zur Zeit: dadurch kann nie ein alter Schreibvorgang nach
// einem juengeren fertig werden und dessen Datei wieder ueberschreiben.
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { isMainThread, parentPort, threadId } = require("node:worker_threads");

const letzteFassung = new Map();
const letzterFehler = new Map();

async function atomarSchreiben({ datei, daten, fassung, einrueckung }) {
  const letzterStand = letzteFassung.get(datei) || 0;
  if (fassung <= letzterStand) {
    return { datei, fassung, uebersprungen: true };
  }

  // Erst serialisieren, dann die bestehende Datei anfassen. Scheitert etwa ein
  // ungeeigneter Wert, bleibt der letzte gute Cache vollstaendig erhalten.
  const inhalt = JSON.stringify(daten, null, einrueckung || undefined);
  if (inhalt === undefined) throw new TypeError("Cache-Daten lassen sich nicht als JSON ablegen");

  const ordner = path.dirname(datei);
  const temporaer = path.join(
    ordner,
    `.${path.basename(datei)}.${process.pid}-${threadId}-${fassung}-${randomUUID()}.tmp`
  );

  await fs.mkdir(ordner, { recursive: true });
  try {
    const griff = await fs.open(temporaer, "wx");
    try {
      await griff.writeFile(inhalt, "utf8");
      await griff.sync();
    } finally {
      await griff.close();
    }
    // Temporaer und Ziel liegen im selben Ordner. rename ist damit der eine
    // atomare Umschaltpunkt; bis dahin bleibt die vorige Datei unberuehrt.
    await fs.rename(temporaer, datei);
    letzteFassung.set(datei, fassung);
    return { datei, fassung, bytes: Buffer.byteLength(inhalt) };
  } catch (fehler) {
    await fs.unlink(temporaer).catch(() => {});
    throw fehler;
  }
}

function fehlerForm(fehler) {
  return {
    name: String(fehler?.name || "Error"),
    message: String(fehler?.message || fehler),
    code: fehler?.code ? String(fehler.code) : undefined
  };
}

if (!isMainThread && parentPort) {
  // Die Kette ist absichtlich seriell. Auch falls spaeter mehr als ein Auftrag
  // im Port wartet, kann ein alter Abschluss keinen neueren Stand ueberholen.
  let kette = Promise.resolve();
  parentPort.on("message", (nachricht) => {
    kette = kette.then(async () => {
      if (nachricht?.typ === "schreiben") {
        try {
          const ergebnis = await atomarSchreiben(nachricht);
          letzterFehler.delete(nachricht.datei);
          parentPort.postMessage({ typ: "geschrieben", id: nachricht.id, ok: true, ...ergebnis });
        } catch (fehler) {
          letzterFehler.set(nachricht.datei, fehlerForm(fehler));
          parentPort.postMessage({
            typ: "geschrieben",
            id: nachricht.id,
            ok: false,
            datei: nachricht.datei,
            fassung: nachricht.fassung,
            fehler: fehlerForm(fehler)
          });
        }
        return;
      }

      if (nachricht?.typ === "barriere" && nachricht.signal instanceof SharedArrayBuffer) {
        const signal = new Int32Array(nachricht.signal);
        // Ein frueherer Fehler, den ein spaeterer Stand derselben Datei geheilt
        // hat, macht den App-Abschluss nicht mehr nachtraeglich fehlerhaft.
        Atomics.store(signal, 1, letzterFehler.size);
        Atomics.store(signal, 0, 1);
        Atomics.notify(signal, 0);
      }
    });
  });
}

module.exports = { atomarSchreiben };
