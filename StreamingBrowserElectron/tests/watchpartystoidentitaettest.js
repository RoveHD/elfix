"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const taste = require("../src/taste");
const fortschritt = require("../src/fortschritt");
const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
function funktion(name) {
  const start = main.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return main.slice(start, main.indexOf("\n}", start) + 2);
}

const serie = "https://s.to/serie/avatar-die-sieben-hafen";
const folge = (host, n = 2) => `${host}/serie/avatar-die-sieben-hafen/staffel-1/episode-${n}`;
const key = "serie:avatardiesiebenhafen";
const room = "sto-probe";
const providers = [{ id: "sto", name: "S.to", startUrl: "https://serienstream.to/" }];
function kontext(url = folge("http://186.2.175.5")) {
  const c = vm.createContext({
    URL, taste, episodeIdentity: fortschritt.episodeIdentity,
    enabledProviders: () => providers,
    youtube: { videoKennung: () => null }, youtubeModusGiltFuer: () => false,
    activeFavoriteId: "party", favorites: [{ id: "party", watchpartyRoom: room, url }],
    watchpartyLiveAus: new Set(),
    watchpartyShared: [{ key, room, joined: true, url: serie }],
    spielerLauf: { id: 1, providerId: "sto", url },
    watchpartyPasstZurFolge: (id, address) => {
      const episode = fortschritt.episodeIdentity(address);
      return !id || id === `s${episode?.season}e${episode?.episode}`;
    }
  });
  if (main.includes("function watchpartySerienSchluessel(")) {
    vm.runInContext(funktion("watchpartySerienSchluessel"), c);
    vm.runInContext(funktion("watchpartyAdresseFuerProvider"), c);
    vm.runInContext(funktion("ohneWatchpartyFolgenwechselEcho"), c);
    vm.runInContext(funktion("meldeWatchpartyFolgenwechselAusNavigation"), c);
    vm.runInContext(funktion("installWatchpartyControls"), c);
  }
  for (const name of ["istGleicheSerie", "istGleicheFolge", "aktiverWatchpartyRaum", "watchpartyRaeumeForUrl",
    "watchpartyRaumForUrl", "watchpartySerieForUrl", "watchpartyLiveKeyForUrl", "liveMerker", "watchpartyLiveAktiv",
    "spielerRundenNachrichtPasst", "spielerRunde"]) vm.runInContext(funktion(name), c);
  return c;
}

async function pruefen() {
  const c = kontext();
  assert.equal(c.watchpartyLiveKeyForUrl(c.spielerLauf.url), key,
    "S.to-IP und Domain muessen dieselbe Live-Mitgliedschaft behalten");
  assert.equal(c.spielerRunde().raum, room);
  assert.equal(c.istGleicheFolge(folge("https://s.to"), c.spielerLauf.url), true);
  assert.equal(c.istGleicheFolge(folge("https://serienstream.to"), c.spielerLauf.url), true);
  assert.equal(c.istGleicheFolge(folge("https://serienstream.cx"), c.spielerLauf.url), true);
  const legacy = folge("https://s.to").replace("/serie/", "/serie/stream/");
  assert.equal(c.istGleicheFolge(legacy, c.spielerLauf.url), true, "Alter /serie/stream/-Pfad bleibt dieselbe Folge");
  assert.equal(c.watchpartyAdresseFuerProvider(providers[0], legacy), folge("https://serienstream.to"));
  assert.equal(c.watchpartyAdresseFuerProvider(providers[0], folge("https://s.to") + "?sprache=de#player"),
    folge("https://serienstream.to") + "?sprache=de#player", "Alte tote Domain wird beim aktuellen Anbieter geladen");
  assert.equal(c.watchpartyAdresseFuerProvider(providers[0], folge("https://serienstream.cx")),
    folge("https://serienstream.to"));
  assert.equal(c.watchpartyAdresseFuerProvider({ ...providers[0], startUrl: "https://serienstream.cx/" }, folge("https://s.to")),
    folge("https://serienstream.cx"));
  assert.equal(c.watchpartyAdresseFuerProvider(providers[0], folge("https://example.org")), folge("https://example.org"));
  assert.equal(c.watchpartyAdresseFuerProvider({ name: "Aniworld", startUrl: "https://aniworld.to/" }, folge("https://s.to")), folge("https://s.to"));
  c.watchpartyFolgenwechselStumm = new Map();
  c.seiteGleich = (a, b) => a === b;
  const navigationen = [];
  c.meldeWatchpartyFolgenwechsel = url => navigationen.push(url);
  await c.ohneWatchpartyFolgenwechselEcho(providers[0], folge("https://serienstream.cx", 3), async () => {
    c.meldeWatchpartyFolgenwechselAusNavigation(providers[0], folge("https://serienstream.to", 3));
  });
  assert.deepEqual(navigationen, [], "Lokale Anbieter-Navigation darf den fremden Folgenwechsel nicht wiederholen");
  c.spielerView = {};
  c.isLiveView = () => true;
  c.pushWatchpartyLiveState = () => { throw Error("Die Werkbank fordert neben dem eigenen Player einen zweiten Abgleich an"); };
  await c.installWatchpartyControls(providers[0], {}, folge("https://serienstream.to", 3));
  assert.equal(c.spielerRundenNachrichtPasst(c.watchpartyShared[0], {
    url: folge("https://s.to"), episodeId: "s1e2"
  }, { tun: "syncprepare" }), true, "Vorbereitung muss den Player am Alias erreichen");
  assert.equal(c.spielerRundenNachrichtPasst(c.watchpartyShared[0], {
    url: folge("https://s.to", 3), episodeId: "s1e3", reason: "episode-change"
  }, { tun: "syncprepare" }), true, "Auch der Folgenwechsel bleibt dieselbe Runde");
  assert.equal(c.istGleicheFolge(folge("https://s.to", 3), c.spielerLauf.url), false);
  assert.equal(c.istGleicheSerie(serie, "https://aniworld.to/serie/avatar-die-sieben-hafen"), false);
  assert.equal(c.istGleicheSerie(serie, "https://example.org/serie/avatar-die-sieben-hafen"), false);
  assert.equal(c.istGleicheSerie(serie, "http://192.0.2.12/serie/avatar-die-sieben-hafen"), false,
    "Eine beliebige fremde IP ist kein konfigurierter S.to-Alias");
  assert.equal(c.istGleicheSerie(serie, "https://s.to/serie/avatar-der-herr-der-elemente"), false);
  c.activeFavoriteId = null;
  assert.equal(c.watchpartyLiveKeyForUrl(c.spielerLauf.url), "", "Privat bleibt privat");
  console.log("OK S.to-Watchparty: IP/Domain, Live-Raum, Startvorbereitung, Folgenwechsel und Anbietergrenzen");
}

if (require.main === module) pruefen().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { kontext, folge, key, room, serie };
