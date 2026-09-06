"use strict";

// FilterList konvertiert Rohlisten synchron, auch innerhalb createAsync().
// Auf Desktop findet dieser Teil deshalb ausserhalb des Hauptthreads statt.
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

function vorbereiten(filters) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: filters });
    let fertig = false;
    const timer = setTimeout(() => {
      fertig = true;
      void worker.terminate();
      reject(new Error("Filter-Vorbereitung hat das Zeitlimit ueberschritten"));
    }, 120000);
    worker.once("message", (result) => {
      fertig = true;
      clearTimeout(timer);
      resolve(result);
    });
    worker.once("error", (error) => {
      fertig = true;
      clearTimeout(timer);
      reject(error);
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (!fertig) reject(new Error(`Filter-Worker vorzeitig beendet (${code})`));
    });
  });
}

if (!isMainThread) {
  (async () => {
    const modul = await import("@adguard/tsurlfilter");
    modul.setConfiguration({ engine: "extension", version: "1.0.0", verbose: false,
      compatibility: modul.CompatibilityTypes.Extension });
    const result = workerData.map((filter) => {
      const liste = new modul.FilterList(filter.content, filter.id);
      return { id: filter.id, content: liste.getContent(), data: liste.getConversionData() };
    });
    parentPort.postMessage(result);
  })().catch((error) => { throw error; });
}

module.exports = { vorbereiten };
