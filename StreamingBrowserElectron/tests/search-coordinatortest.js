"use strict";

const assert = require("assert");
const http = require("http");
const { createSearchCoordinator } = require("../src/search-coordinator");

const checks = [];
function check(name, condition) {
  checks.push(Boolean(condition));
  console.log(`${condition ? "OK  " : "FAIL"}  ${name}`);
}
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function server() {
  let slowRequests = 0;
  let fastRequests = 0;
  let slowClosed = 0;
  const instance = http.createServer((request, response) => {
    if (request.url === "/slow") {
      slowRequests += 1;
      request.on("close", () => { if (!response.writableEnded) slowClosed += 1; });
      setTimeout(() => {
        if (!response.writableEnded) response.end(JSON.stringify({ providerId: "slow", results: ["old"] }));
      }, 100);
      return;
    }
    fastRequests += 1;
    response.end(JSON.stringify({ providerId: "fast", results: ["new"] }));
  });
  await new Promise(resolve => instance.listen(0, "127.0.0.1", resolve));
  const port = instance.address().port;
  return {
    url: (path) => `http://127.0.0.1:${port}${path}`,
    counts: () => ({ slowRequests, fastRequests, slowClosed }),
    close: () => new Promise(resolve => instance.close(resolve))
  };
}

async function json(url, signal) {
  const response = await fetch(url, { signal });
  return response.json();
}

(async () => {
  const remote = await server();
  try {
    let time = 1_000;
    const coordinator = createSearchCoordinator({ now: () => time, ttlMs: 50, maxEntries: 2 });

    // Zwei Fenster teilen denselben Abruf. Das Verlassen eines Fensters darf
    // den Abruf nicht fuer das andere Fenster beenden.
    const first = coordinator.request({ key: "Naruto", owner: "window-a", execute: signal => json(remote.url("/slow"), signal) });
    const second = coordinator.request({ key: "Naruto", owner: "window-b", execute: signal => json(remote.url("/slow"), signal) });
    coordinator.cancel("window-a");
    await assert.rejects(first, error => error.name === "AbortError");
    const shared = await second;
    check("identische Suche wird zusammengelegt", remote.counts().slowRequests === 1 && shared.providerId === "slow");
    check("Abbruch eines Besitzers laesst Mitbenutzer weiterlaufen", remote.counts().slowClosed === 0);

    // Schnelles Tippen: die alte Suche des gleichen Renderers wird abgebrochen,
    // die neue Antwort kann sofort verwendet werden.
    const old = coordinator.request({ key: "one", owner: "typing", execute: signal => json(remote.url("/slow"), signal) });
    // Der erste Tastendruck hat den Provider bereits erreicht, bevor der
    // zweite folgt. Damit prueft der Fall den echten Netzwerkabbruch statt nur
    // das Abbrechen einer noch nicht gestarteten Promise.
    await sleep(20);
    const fresh = coordinator.request({ key: "onen", owner: "typing", execute: signal => json(remote.url("/fast"), signal) });
    await assert.rejects(old, error => error.name === "AbortError");
    check("neuer unterschiedlicher Begriff ersetzt die alte Suche", (await fresh).providerId === "fast");
    check("schnelles Tippen beendet einen bereits gestarteten Providerabruf", remote.counts().slowRequests >= 2);
    const retryOld = coordinator.request({ key: "one", owner: "typing", execute: signal => json(remote.url("/fast"), signal) });
    check("ein sofort erneut eingegebener Begriff startet nicht im alten Abbruch", (await retryOld).providerId === "fast");

    // Die Providerantwort bleibt unveraendert: Auswahl und Reihenfolge sind
    // Teil des Ergebnisses und werden nicht vom Koordinator sortiert.
    const providerStates = [
      { providerId: "alias-z", queryVariant: "one piece", results: [] },
      { providerId: "alias-a", queryVariant: "one-piece", results: ["Treffer"] }
    ];
    const ordered = await coordinator.request({ key: "provider-state", owner: "ui", execute: async () => providerStates });
    check("Providerauswahl, Reihenfolge und Alias bleiben erhalten", JSON.stringify(ordered) === JSON.stringify(providerStates));

    let cacheRuns = 0;
    const cached = () => coordinator.request({ key: "cache", owner: "cache", execute: async () => ({ runs: ++cacheRuns }) });
    await cached(); await cached();
    check("kurzfristiger Erfolgs-Cache verhindert Doppelabruf", cacheRuns === 1);
    time += 51;
    await cached();
    check("TTL laesst einen frischen Abruf zu", cacheRuns === 2);

    await coordinator.request({ key: "lru-a", owner: "lru", execute: async () => "a" });
    await coordinator.request({ key: "lru-b", owner: "lru", execute: async () => "b" });
    await coordinator.request({ key: "lru-c", owner: "lru", execute: async () => "c" });
    check("Cache bleibt begrenzt", coordinator.stats().cached === 2);

    let failures = 0;
    const timedOut = () => coordinator.request({
      key: "timeout", owner: "timeout", execute: async () => { failures += 1; throw new Error("timeout"); }
    });
    await assert.rejects(timedOut(), /timeout/); await assert.rejects(timedOut(), /timeout/);
    check("Fehler und Timeouts werden nicht gecacht", failures === 2);

    const predicateResult = await coordinator.request({
      key: "predicate", owner: "predicate", execute: async () => "antwort",
      isCacheable: () => { throw new Error("kaputte Cache-Regel"); }
    });
    check("fehlerhafte Cache-Regel laesst wartende Suche antworten", predicateResult === "antwort");
    check("fehlerhafte Cache-Regel schreibt nichts", coordinator.stats().cached === 2);

    const progress = createSearchCoordinator();
    let publish, finish, runs = 0;
    const updatesA = [], updatesB = [];
    const execute = (_signal, report) => {
      runs += 1;
      publish = report;
      return new Promise(resolve => { finish = resolve; });
    };
    const pendingA = progress.request({ key: "shared", owner: "a", execute, onProgress: value => updatesA.push(value) });
    await Promise.resolve();
    publish(["fast"]);
    const pendingB = progress.request({ key: "shared", owner: "b", execute, onProgress: value => updatesB.push(value) });
    check("fertige Treffer sind vor dem Ende verfuegbar und werden spaeten Mitbenutzern nachgereicht",
      updatesA.length === 1 && updatesB.length === 1 && updatesB[0][0] === "fast" && runs === 1);
    progress.cancel("a");
    await assert.rejects(pendingA, error => error.name === "AbortError");
    publish(["fast", "slow"]);
    check("abgemeldeter Besitzer bekommt keine weiteren Teilergebnisse", updatesA.length === 1 && updatesB.length === 2);
    finish(["fast", "slow"]);
    await pendingB;
    publish(["too late"]);
    check("nach Suchende werden keine Zwischenstaende mehr verteilt", updatesB.length === 2);

    let cancelledPublish, cancelledFinish;
    const cancelledUpdates = [];
    const stopped = progress.request({ key: "cancelled", owner: "c", execute: (_signal, report) => {
      cancelledPublish = report;
      return new Promise(resolve => { cancelledFinish = resolve; });
    }, onProgress: value => cancelledUpdates.push(value) });
    await Promise.resolve();
    progress.cancel("c");
    await assert.rejects(stopped, error => error.name === "AbortError");
    cancelledPublish(["stale"]);
    cancelledFinish([]);
    check("abgebrochene Provider koennen keine spaeten Treffer verteilen", cancelledUpdates.length === 0);

    const broken = progress.request({ key: "broken-ui", owner: "d", execute: async (_signal, report) => {
      report(["usable"]);
      return ["usable"];
    }, onProgress: () => { throw new Error("Fenster geschlossen"); } });
    check("defekter Fortschrittslistener verwirft keine Treffer", (await broken)[0] === "usable");
  } finally {
    await remote.close();
  }
  console.log(`${checks.filter(Boolean).length}/${checks.length} bestanden`);
  process.exit(checks.every(Boolean) ? 0 : 1);
})().catch(error => { console.error(error); process.exit(1); });
