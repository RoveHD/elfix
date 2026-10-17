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
  // Metadata may spell the display title differently from the relay's stable
  // key. A connected, confirmed member still belongs to the same room/URL.
  const cleanup = kontext();
  cleanup.watchparty = { aktiv: true, codes: [room], eintraege: () => [],
    status: () => ({ rooms: [{ room, connected: true }] }) };
  cleanup.watchpartyZustandBestaetigt = new Set([room]);
  cleanup.watchpartyKey = () => "serie:avatardiesiebenhaefen";
  cleanup.saveFavorites = () => {};
  cleanup.sendActiveState = () => {};
  cleanup.console = { log() {} };
  vm.runInContext(funktion("raeumeWatchpartyEintraegeAuf"), cleanup);
  cleanup.raeumeWatchpartyEintraegeAuf();
  assert.equal(cleanup.favorites[0].watchpartyRoom, room, "Metadaten-Titel darf einen bestaetigten Raum nicht auf privat umstellen");
  const peer = kontext();
  peer.favorites[0].providerId = "sto";
  peer.favorites[0].type = "serie";
  peer.favorites[0].title = "Avatar - Die sieben Häfen";
  peer.watchpartyKey = () => "serie:avatardiesiebenhaefen";
  peer.fortschritt = fortschritt;
  peer.saveFavorites = () => {};
  peer.sendActiveState = () => {};
  peer.console = { log() {} };
  peer.providerForWatchpartyUrl = () => providers[0];
  peer.createWatchpartyFavorite = () => { throw Error("Peer-Fortschritt legte trotz bestehendem URL/Raum-Eintrag eine Dublette an"); };
  for (const name of ["lokalerWatchpartyEintrag", "watchpartyEintrag", "applyWatchpartyProgress"]) vm.runInContext(funktion(name), peer);
  peer.applyWatchpartyProgress(key, { url: folge("https://serienstream.to"), season: 1, episode: 2,
    position: 15, duration: 180, updatedAt: new Date().toISOString(), from: "PC2" }, room);
  assert.equal(peer.favorites.length, 1);
  assert.equal(peer.favorites[0].id, "party", "Peer-Fortschritt erhaelt die bestehende Favoriten-ID");
  const heilung = kontext();
  heilung.favorites = [{ ...peer.favorites[0], id: "party" },
    { ...peer.favorites[0], id: "erhalten", url: folge("https://serienstream.cx", 3), season: 1, episode: 3 },
    { ...peer.favorites[0], id: "privat", watchpartyRoom: "" }];
  heilung.fortschritt = fortschritt;
  heilung.watchpartyKey = () => "serie:avatardiesiebenhaefen";
  heilung.console = { log() {} };
  for (const name of ["lokalerWatchpartyEintrag", "raumDublettenHeilen"]) vm.runInContext(funktion(name), heilung);
  assert.equal(heilung.raumDublettenHeilen(), true);
  assert.equal(heilung.activeFavoriteId, "erhalten", "Heilung uebertraegt den aktiven Raumkontext auf den erhaltenen Eintrag");
  assert.equal(heilung.favorites.find(f => f.id === "privat").watchpartyRoom, "", "Bestehender privater Stand bleibt privat");
  cleanup.watchpartyShared[0].joined = false;
  cleanup.raeumeWatchpartyEintraegeAuf();
  assert.equal(cleanup.favorites[0].watchpartyRoom, "", "Echtes Verlassen wird weiterhin bestaetigt");
  const spieler = fs.readFileSync(path.join(__dirname, "../src/renderer/spieler.js"), "utf8").replace(/\r\n/g, "\n");
  const start = spieler.indexOf("function steuernAusRunde(");
  const native = vm.createContext({
    auftrag: { id: 7 }, inRunde: true, rundenKontext: "A|avatar", binHost: false, startAuftrag: 10,
    startAusstehend: true, startNotbremse: 0, rundeWarten: true, rundeQuellenWarten: true,
    rundenVorbereitung: { id: "pending" }, clearTimeout,
    rundeWartenZeigen() {}, spielenZeichnen() {}, tempoSetzen() {}, tempoRechteSetzen() {}
  });
  vm.runInContext(spieler.slice(start, spieler.indexOf("\n}", start) + 2), native);
  native.steuernAusRunde({ tun: "runde", auftragId: 7, aktiv: true, kontext: "A|avatar", host: true, tempo: 1 });
  assert.equal(native.rundeWarten, true, "Wiederholter Live-Takt darf eine echte laufende Startbarriere nicht freigeben");
  assert.equal(native.startAuftrag, 10);
  native.steuernAusRunde({ tun: "runde", auftragId: 6, aktiv: true, kontext: "B|avatar" });
  assert.equal(native.inRunde, true, "Alter Quellenauftrag darf aktuellen Rundenzustand nicht aendern");
  assert.equal(native.rundenKontext, "A|avatar");
  native.steuernAusRunde({ tun: "runde", auftragId: 7, aktiv: true, kontext: "B|avatar", host: true, tempo: 1 });
  assert.equal(native.rundeWarten, false, "Raum A nach B verwirft auch bei aktivem Live die alte Startschranke");
  assert.equal(native.rundenVorbereitung, null);
  native.rundeWarten = true;
  native.rundenVorbereitung = { id: "B-prepare" };
  native.steuernAusRunde({ tun: "runde", auftragId: 7, aktiv: true, kontext: "B|avatar", host: true, tempo: 1 });
  assert.equal(native.rundeWarten, true, "Identischer Kontext B behaelt seine echte Startschranke");
  native.steuernAusRunde({ tun: "runde", auftragId: 7, aktiv: false });
  assert.equal(native.inRunde, false);
  assert.equal(native.rundeWarten, false, "Bewusster Kontextwechsel gibt alte lokale Warteschranke frei");
  assert.equal(native.rundenVorbereitung, null);
  native.steuernAusRunde({ tun: "runde", auftragId: 7, aktiv: true, kontext: "B|avatar", host: true, tempo: 1 });
  assert.equal(native.inRunde, true);
  assert.equal(native.binHost, true);
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
