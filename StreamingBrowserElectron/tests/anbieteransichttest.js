"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { fallbackErstellen } = require("../src/anbieteransicht");
const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
function funktion(name) {
  const start = main.search(new RegExp("(?:async )?function " + name + "\\("));
  assert.ok(start >= 0, name);
  return main.slice(start, main.indexOf("\n}", start) + 2);
}
function uhr() {
  let jetzt = 0, nummer = 0;
  const jobs = new Map();
  return { setzen(fn, ms) { const id = ++nummer; jobs.set(id, { fn, zeit: jetzt + ms }); return id; },
    loeschen(id) { jobs.delete(id); },
    async weiter(ms) {
      jetzt += ms;
      for (const [id, job] of [...jobs]) if (job.zeit <= jetzt) { jobs.delete(id); await job.fn(); }
    }, get zahl() { return jobs.size; } };
}
function aufbau() {
  const zeit = uhr(), gezeigt = [], fortgesetzt = [];
  let antwort = "geschlossen";
  const fallback = fallbackErstellen({ setzen: zeit.setzen, loeschen: zeit.loeschen,
    oeffnen: async versuch => { gezeigt.push(versuch.url); return antwort; } });
  const controller = new AbortController();
  const optionen = { provider: { id: "sto" }, url: "https://s.to/serie/staffel-1/episode-1",
    signal: controller.signal, fortsetzen: () => fortgesetzt.push(optionen.url) };
  return { zeit, gezeigt, fortgesetzt, fallback, controller, optionen, antwort: wert => { antwort = wert; } };
}
async function run() {
  let t = aufbau();
  const a = t.fallback.starten(t.optionen);
  await t.zeit.weiter(19999); assert.equal(t.gezeigt.length, 0);
  assert.equal(t.fallback.starten(t.optionen), a, "Uebergang zum Aufloeser startet die Frist nicht neu");
  await t.zeit.weiter(1); assert.deepEqual(t.gezeigt, [t.optionen.url]);
  await t.zeit.weiter(60000); assert.equal(t.gezeigt.length, 1, "Schliessen oeffnet nicht erneut");
  assert.equal(t.fortgesetzt.length, 0, "Schliessen bestaetigt nichts");

  t = aufbau(); t.fallback.starten(t.optionen); t.controller.abort();
  await t.zeit.weiter(20000); assert.equal(t.gezeigt.length, 0, "Abbruch");
  t = aufbau(); const erfolg = t.fallback.starten(t.optionen); t.fallback.erfolg(erfolg);
  await t.zeit.weiter(20000); assert.equal(t.gezeigt.length, 0, "Quelle beendet Frist vor Player-/Watchparty-Warten");
  t = aufbau(); const alt = t.fallback.starten(t.optionen);
  t.optionen = { ...t.optionen, url: "https://s.to/serie/staffel-1/episode-2" };
  t.fallback.starten(t.optionen); t.fallback.erfolg(alt);
  await t.zeit.weiter(20000); assert.deepEqual(t.gezeigt, [t.optionen.url], "Spaetes altes Ergebnis loescht neue Frist nicht");
  t = aufbau(); t.fallback.starten(t.optionen); await t.zeit.weiter(10000); t.fallback.manuell();
  await t.zeit.weiter(30000); assert.equal(t.gezeigt.length, 0, "Manuell vor 20s verbraucht genau diesen Hinweis");
  t = aufbau(); t.antwort("bestaetigt"); t.fallback.starten(t.optionen);
  await t.zeit.weiter(20000); assert.equal(t.fortgesetzt.length, 1, "Nur belegte Bestaetigung setzt fort");
  t = aufbau(); t.fallback.starten({ ...t.optionen, unterdrueckt: true });
  await t.zeit.weiter(40000); assert.equal(t.gezeigt.length, 0, "Fortsetzung hat keine endlose Fensterkette");
  t = aufbau(); let aktuell = true; t.fallback.starten({ ...t.optionen, gueltig: () => aktuell }); aktuell = false;
  await t.zeit.weiter(20000); assert.equal(t.gezeigt.length, 0, "Veralteter Lauf");
  t = aufbau();
  let antwort, fehler;
  const verspaetet = fallbackErstellen({ setzen: t.zeit.setzen, loeschen: t.zeit.loeschen,
    oeffnen: () => new Promise(resolve => { antwort = resolve; }) });
  verspaetet.starten(t.optionen);
  const imFenster = t.zeit.weiter(20000);
  t.controller.abort(); antwort("bestaetigt"); await imFenster;
  assert.equal(t.fortgesetzt.length, 0, "Spaete Fensterantwort nach Close/Navigationsabbruch setzt nichts fort");
  t = aufbau();
  const wirft = fallbackErstellen({ setzen: t.zeit.setzen, loeschen: t.zeit.loeschen,
    oeffnen: async () => "bestaetigt", fehler: error => { fehler = error; } });
  wirft.starten({ ...t.optionen, fortsetzen: async () => { throw Error("Resolver defekt"); } });
  await t.zeit.weiter(20000); assert.equal(fehler.message, "Resolver defekt", "Fehlgeschlagene Fortsetzung hat einen kontrollierten Fehlerpfad");

  // Produktions-Callback unterdrueckt nur tatsaechlich sichtbare Challenges.
  let geoeffnet = 0;
  const view = {};
  const sichtbar = vm.createContext({ anbieteransicht: { fallbackErstellen: options => options },
    menschentorFenster: { view }, mainWindow: { contentView: { children: [] } },
    anbieterSeitenAnsicht: { offen: false }, AbortSignal,
    anbieterSeiteOeffnen: async () => { geoeffnet++; return "geschlossen"; } });
  const anfang = main.indexOf("const direktAnbieterFallback =");
  vm.runInContext(main.slice(anfang, main.indexOf("\n});", anfang) + 4)
    + "\nglobalThis.autoOeffnen = direktAnbieterFallback.oeffnen", sichtbar);
  const pruefVersuch = { ...t.optionen, fensterAbbruch: new AbortController() };
  await sichtbar.autoOeffnen(pruefVersuch); assert.equal(geoeffnet, 1, "Noch nicht maskierbare Challenge zeigt volle Seite");
  sichtbar.mainWindow.contentView.children.push(view);
  await sichtbar.autoOeffnen(pruefVersuch); assert.equal(geoeffnet, 1, "Sichtbares Tor bekommt kein zweites Fenster");
  sichtbar.mainWindow.contentView.children = []; sichtbar.anbieterSeitenAnsicht.offen = true;
  await sichtbar.autoOeffnen(pruefVersuch); assert.equal(geoeffnet, 1, "Manuelles Fenster bekommt kein Duplikat");

  // Die Auswahl des produktiven Einstiegspfads: keine Staffeluebersicht,
  // Vorladung oder fremde Anbieter. Bei Fehlern bleibt die Frist bestehen.
  t = aufbau();
  const c = vm.createContext({ direktAnbieterFallback: t.fallback,
    isStoProviderLike: provider => provider.id === "sto", episodeIdentity: url => /episode-/.test(url),
    spielerLauf: null });
  vm.runInContext(funktion("direktFallbackStarten"), c);
  const url = t.optionen.url;
  assert.equal(c.direktFallbackStarten({ id: "aniworld" }, url, t.controller.signal), null);
  assert.equal(c.direktFallbackStarten({ id: "sto" }, "https://s.to/serie/staffel-1", t.controller.signal), null);
  assert.equal(c.direktFallbackStarten({ id: "sto" }, url, t.controller.signal, { vorladen: true }), null);
  assert.equal(t.zeit.zahl, 0);
  c.direktFallbackStarten({ id: "sto" }, url, t.controller.signal);
  await t.zeit.weiter(20000); assert.deepEqual(t.gezeigt, [url]);

  // Echte Quellenfindungsfunktion, nicht nur der Timer: vorhandene Hoster-
  // Kacheln mit gescheiterter Aufloesung behalten die Frist. Eine spielbare
  // Quelle beendet sie vor jedwedem anschliessenden Player-/Rundenwarten.
  for (const quelleGefunden of [false, true]) {
    t = aufbau();
    const d = vm.createContext({ direktAnbieterFallback: t.fallback,
      isStoProviderLike: provider => provider.id === "sto", episodeIdentity: () => true,
      providerModel: { isHttpUrl: () => true }, watchpartyAdresseFuerProvider: (_provider, adresse) => adresse,
      merkeGeoeffneteFolge() {}, getProviderView: () => ({}), rundenFassungFuer: () => null,
      direktQuelleFuerAnsicht: async () => quelleGefunden
        ? { ok: true, quelle: { typ: "hls", hoehe: 1080 } } : { ok: false, grund: "Kein Video beim Hoster" },
      watchpartyLiveKeyForUrl: () => "", watchpartyRaumForUrl: () => "", watchpartyZustandUebernehmen() {},
      direktSpielerOeffnen: async () => { assert.equal(t.zeit.zahl, 0, "Quellenfund beendet Timer schon vor Player/Puffer/Watchparty"); return true; }
    });
    vm.runInContext(["direktFallbackStarten", "direktFallbackErfolg", "direktFolgeSpielen"].map(funktion).join("\n"), d);
    await d.direktFolgeSpielen({ id: "sto" }, url, { signal: t.controller.signal, links: [{ adresse: "https://hoster.example/folge" }] });
    await t.zeit.weiter(20000);
    assert.equal(t.gezeigt.length, quelleGefunden ? 0 : 1);
  }

  // Manueller IPC auf der Startseite darf kein altes abgebrochenes Signal
  // erben. Der volle Aufruf geschieht auch bei bereits freier Anbieterseite.
  let handler, aufrufe = 0;
  const abgebrochen = new AbortController(); abgebrochen.abort();
  const ipc = vm.createContext({ ipcMain: { handle: (_name, fn) => { handler = fn; } },
    enabledProviders: () => [{ id: "sto" }], anbieterSeitenAdresse: () => url,
    direktAnbieterFallback: { aktuell: null, manuell() {} }, direktLaden: abgebrochen,
    anbieterSeiteOeffnen: async (_provider, ziel, signal) => {
      assert.equal(ziel, url); assert.equal(signal?.aborted, undefined); aufrufe++; return "geschlossen";
    }
  });
  const start = main.indexOf('ipcMain.handle("provider:cloudflare",');
  vm.runInContext(funktion("anbieterSeiteManuellOeffnen") + "\n" + main.slice(start, main.indexOf("\n});", start) + 4), ipc);
  assert.equal(await handler(null, "sto"), "geschlossen"); assert.equal(aufrufe, 1);
  assert.equal(await handler(null, "fehlt"), "fehlgeschlagen");
  ipc.vomSpieler = event => event?.sender === "player";
  ipc.spielerLauf = { id: 7, quelle: { adresse: "" } };
  ipc.spielerAnbieter = () => ({ id: "sto" });
  const spielerStart = main.indexOf('ipcMain.handle("spieler:anbieter-seite",');
  vm.runInContext(main.slice(spielerStart, main.indexOf("\n});", spielerStart) + 4), ipc);
  assert.equal(await handler({ sender: "fremd" }, 7), "fehlgeschlagen");
  assert.equal(await handler({ sender: "player" }, 6), "fehlgeschlagen");
  ipc.spielerLauf.quelle.adresse = "https://cdn.example/video.mp4";
  assert.equal(await handler({ sender: "player" }, 7), "fehlgeschlagen");
  assert.equal(aufrufe, 1, "Fremde Renderer, alte ID und vorhandene Quelle oeffnen nichts");
  ipc.spielerLauf.quelle.adresse = "";
  assert.equal(await handler({ sender: "player" }, 7), "geschlossen"); assert.equal(aufrufe, 2);

  // Aktuelle Playerfolge hat auch waehrend PiP/Stoebern Vorrang vor der
  // Werkbank; ohne dieselben Anbieter wird die echte Startseite gezeigt.
  const adresse = vm.createContext({ spielerLauf: { providerId: "sto", url },
    activeProvider: () => ({ id: "anderer" }), activeView: null,
    isLiveView: () => false,
    providerModel: { isHttpUrl: wert => /^https?:/.test(wert) }, shouldBlockProviderNavigation: () => false });
  vm.runInContext(funktion("anbieterSeitenAdresse"), adresse);
  assert.equal(adresse.anbieterSeitenAdresse({ id: "sto", startUrl: "https://s.to" }), url);
  assert.equal(adresse.anbieterSeitenAdresse({ id: "anderer", startUrl: "https://anderer.test" }), "https://anderer.test");
  console.log("OK Anbieteransicht: genau 20s, Abbruch/Wechsel/Erfolg, einmalige Fortsetzung, manuell, Startseite und Anbietergrenzen");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
