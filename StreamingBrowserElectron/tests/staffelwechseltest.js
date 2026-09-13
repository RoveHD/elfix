"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
const spieler = fs.readFileSync(path.join(__dirname, "../src/renderer/spieler.js"), "utf8").replace(/\r\n/g, "\n");

function funktion(text, name) {
  const start = text.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return text.slice(start, text.indexOf("\n}", start) + 2);
}

class WebContentsAttrappe {
  constructor(id) {
    this.id = id;
    this.horcher = new Map();
    this.zerstoert = false;
    this.stumm = false;
  }
  setAudioMuted(wert) { this.stumm = Boolean(wert); }
  setWindowOpenHandler(handler) { this.popup = handler; }
  on(name, handler) { this.horcher.set(name, handler); }
  once(name, handler) { this.horcher.set(name, handler); }
  isDestroyed() { return this.zerstoert; }
  close() {
    this.zerstoert = true;
    this.horcher.get("destroyed")?.();
  }
}

let nummer = 0;
class ViewAttrappe {
  constructor(optionen) {
    this.optionen = optionen;
    this.webContents = new WebContentsAttrappe(++nummer);
  }
  setBackgroundColor(farbe) { this.farbe = farbe; }
}

const folgenWerkbaenke = new Map();
const webContentsProvider = new Map();
const sitzung = {};
const werkbankKontext = vm.createContext({
  WebContentsView: ViewAttrappe,
  browserSession: sitzung,
  VIEW_BACKGROUND_COLOR: "#05070c",
  folgenWerkbaenke,
  webContentsProvider,
  isLiveView: (view) => Boolean(view && !view.webContents.isDestroyed()),
  shouldCancelNavigation: () => false,
  shouldCancelFrameNavigation: () => false
});
vm.runInContext([
  funktion(main, "folgenWerkbankHolen"),
  funktion(main, "folgenWerkbaenkeSchliessen")
].join("\n"), werkbankKontext);

const provider = { id: "aniworld" };
const erste = werkbankKontext.folgenWerkbankHolen(provider);
assert.equal(werkbankKontext.folgenWerkbankHolen(provider), erste,
  "Die leichte Folgen-Werkbank wird je Anbieter wiederverwendet");
assert.equal(erste.optionen.webPreferences.session, sitzung);
assert.equal(erste.webContents.stumm, true);
assert.equal(erste.webContents.popup().action, "deny");
assert.equal(webContentsProvider.get(erste.webContents.id), provider.id,
  "Der gemeinsame Sitzungsfilter kennt auch die Folgen-Werkbank");
werkbankKontext.folgenWerkbaenkeSchliessen();
assert.equal(erste.webContents.isDestroyed(), true);
assert.equal(folgenWerkbaenke.size, 0);
assert.equal(webContentsProvider.has(erste.webContents.id), false);

(async () => {
  const gelesenerStand = { folgen: [{ staffel: 2, folge: 1, url: "folge-1" }] };
  const hintergrund = { webContents: {
    isDestroyed: () => false,
    executeJavaScript: async () => gelesenerStand
  } };
  const player = { webContents: {} };
  const aufrufe = [];
  const context = vm.createContext({
    FOLGEN_FRISCHE_MS: 10 * 60 * 1000,
    folgenSpeicher: new Map(),
    spielerLauf: { url: "https://aniworld.to/anime/stream/test/staffel-1/episode-1" },
    spielerView: player,
    isLiveView: (view) => view === player || view === hintergrund,
    folgenWerkbankHolen: () => hintergrund,
    nachschub: { staffelSeiteUrl: (url) => url },
    episodeIdentity: () => null,
    providerModel: { isHttpUrl: () => true },
    seitendaten: { uebersichtSkript: () => "liste" },
    werkbankLesen: async (_provider, url, lesen, _gueltig, view) => {
      aufrufe.push({ url, view });
      return view ? lesen(view) : { folgen: [{ staffel: 1, folge: 1, url: `${url}/episode-1` }] };
    }
  });
  vm.runInContext(funktion(main, "folgenlisteLesen"), context);
  await context.folgenlisteLesen(provider, "https://aniworld.to/anime/stream/test/staffel-2");
  assert.equal(aufrufe[0].view, hintergrund,
    "Ein Staffelabruf bei laufendem Player bleibt aus der aktiven Provider-View heraus");

  context.spielerLauf = null;
  context.spielerView = null;
  context.folgenSpeicher.clear();
  await context.folgenlisteLesen(provider, "https://aniworld.to/anime/stream/test/staffel-1");
  assert.equal(aufrufe[1].view, null,
    "Vor dem Playerstart darf die bereits geladene aktive Provider-View weiterverwendet werden");

  const werkbankEreignisse = [];
  const stoppbareView = { webContents: {
    isDestroyed: () => false,
    stop: () => werkbankEreignisse.push("stop")
  } };
  let werkbankArt = "ok";
  const lesenKontext = vm.createContext({
    werkbankAuftraege: new Map(),
    browserdatenFrei: Promise.resolve(),
    isLiveView: (view) => view === stoppbareView,
    werkbankAn: async (_provider, url) => {
      werkbankEreignisse.push(`an:${url}`);
      if (werkbankArt === "null") return null;
      if (werkbankArt === "throw") throw new Error("laden fehlgeschlagen");
      return stoppbareView;
    }
  });
  vm.runInContext(funktion(main, "werkbankLesen"), lesenKontext);

  const abbruch = await lesenKontext.werkbankLesen(provider, "abbruch", async () => "nie", () => false, stoppbareView);
  assert.equal(abbruch, null);
  assert.deepEqual(werkbankEreignisse, ["stop"],
    "Auch ein vor dem Laden abgebrochener Auftrag stoppt seine eigene View");

  werkbankEreignisse.length = 0;
  werkbankArt = "null";
  const ohneView = await lesenKontext.werkbankLesen(provider, "null", async () => "nie", () => true, stoppbareView);
  assert.equal(ohneView, null);
  assert.deepEqual(werkbankEreignisse, ["an:null", "stop"],
    "Auch ein fehlgeschlagener View-Aufbau stoppt die eigene View");

  werkbankEreignisse.length = 0;
  werkbankArt = "throw";
  await assert.rejects(
    lesenKontext.werkbankLesen(provider, "throw", async () => "nie", () => true, stoppbareView),
    /laden fehlgeschlagen/
  );
  assert.deepEqual(werkbankEreignisse, ["an:throw", "stop"],
    "Auch ein Ladefehler stoppt die eigene View");

  werkbankEreignisse.length = 0;
  werkbankArt = "ok";
  await assert.rejects(
    lesenKontext.werkbankLesen(provider, "lesen", async () => {
      werkbankEreignisse.push("lesen:throw");
      throw new Error("lesen fehlgeschlagen");
    }, () => true, stoppbareView),
    /lesen fehlgeschlagen/
  );
  assert.deepEqual(werkbankEreignisse, ["an:lesen", "lesen:throw", "stop"],
    "Auch ein DOM-Lesefehler stoppt die eigene View");

  werkbankEreignisse.length = 0;
  let ersterFertig;
  const ersterDarfEnden = new Promise((resolve) => { ersterFertig = resolve; });
  const ersterAuftrag = lesenKontext.werkbankLesen(provider, "eins", async () => {
    werkbankEreignisse.push("lesen:eins");
    await ersterDarfEnden;
    return "eins";
  }, () => true, stoppbareView);
  const zweiterAuftrag = lesenKontext.werkbankLesen(provider, "zwei", async () => {
    werkbankEreignisse.push("lesen:zwei");
    return "zwei";
  }, () => true, stoppbareView);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(werkbankEreignisse, ["an:eins", "lesen:eins"],
    "Der zweite Auftrag wartet auf Lesen und Stoppen des ersten");
  ersterFertig();
  assert.deepEqual(await Promise.all([ersterAuftrag, zweiterAuftrag]), ["eins", "zwei"]);
  assert.deepEqual(werkbankEreignisse,
    ["an:eins", "lesen:eins", "stop", "an:zwei", "lesen:zwei", "stop"],
    "Stoppen bleibt innerhalb jedes serialisierten Auftrags");

  const schliessenQuelle = funktion(main, "direktSpielerSchliessen");
  assert.match(schliessenQuelle,
    /spielerLauf = null;\n  spielerLetzterStand = null;\n  folgenWerkbaenkeSchliessen\(\);/,
    "Player-Schliessen invalidiert den Lauf vor dem Schliessen seiner Folgen-Views");
  assert.match(schliessenQuelle,
    /if \(!spielerView\) \{\n    folgenWerkbaenkeSchliessen\(\);\n    return;/,
    "Verwaiste Folgen-Views werden auch ohne Player-View geschlossen");

  assert.match(spieler,
    /ereignis\.key === " " && ereignis\.target instanceof HTMLButtonElement\) return/,
    "Leertaste auf Staffelknopf bleibt dessen native Aktivierung");
  assert.match(spieler, /if \(taste === " " \|\| taste === "k"\)/,
    "Leertaste ausserhalb eines Knopfs bleibt Player-Kuerzel");
  console.log("OK Staffelwechsel: isolierte Werkbank, serialisiertes Cleanup und native Knopfaktivierung");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
