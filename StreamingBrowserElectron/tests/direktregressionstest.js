"use strict";

// Verhaltenspruefungen der echten Funktionen: verspätete Antworten, neue
// Hoster-Marken und Videoereignisse lassen sich mit Textsuchen nicht testen.
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const fortschritt = require("../src/fortschritt");
const direktfolgen = require("../src/direktfolgen");
const beobachtung = require("../src/direktbeobachtung");
const haupt = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
const spieler = fs.readFileSync(path.join(__dirname, "../src/renderer/spieler.js"), "utf8");
const oberflaeche = fs.readFileSync(path.join(__dirname, "../src/renderer/renderer.js"), "utf8").replace(/\r\n/g, "\n");
const pruefungen = [];
const pruefe = (name, tun) => pruefungen.push({ name, tun });
const still = { log() {} };
function funktion(text, name) {
  const start = text.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return text.slice(start, text.indexOf("\n}", start) + 2);
}
function kontext(werte, namen, text = haupt) {
  const stand = vm.createContext({ console: still, AbortController, AbortSignal, ...werte });
  vm.runInContext(namen.map((name) => funktion(text, name)).join("\n"), stand);
  return stand;
}
function offen() {
  let fertig;
  const antwort = new Promise((resolve) => { fertig = resolve; });
  return { antwort, fertig };
}
const provider = { id: "p" };
const filmA = "https://filmo.example/film/a";
const filmB = "https://filmo.example/film/b";
const folge = (nummer, staffel = 1) => `https://aniworld.to/anime/stream/test/staffel-${staffel}/episode-${nummer}`;
const quelle = { ok: true, quelle: { adresse: "https://cdn.example/v.mp4", typ: "datei" }, stationen: [] };

pruefe("Filme und Folgen erhalten nur ihren eigenen gespeicherten Stand", () => {
  const c = kontext({ favorites: [
    { id: "a", providerId: "p", url: filmA, currentTime: 1200 },
    { id: "b", providerId: "p", url: filmB, currentTime: 300 },
    { id: "serie", providerId: "p", url: folge(5), currentTime: 900 }
  ], activeFavoriteId: "b", normalizeFavoriteUrl: (url) => url,
  naechsteFolgeLabel: () => "Titel", sanitizePositiveNumber: (wert) => Number(wert) || 0,
  spielerKopfzeilen: null, spielerLauf: null, spielerAuftragId: 0, spielerLetzterStand: null, spielerTakt: null }, ["spielerLaufSetzen"]);
  assert.equal(c.spielerLaufSetzen(provider, filmB, quelle).startzeit, 300);
  assert.equal(c.spielerLaufSetzen(provider, folge(1), quelle).startzeit, 0);
  assert.equal(c.spielerLaufSetzen(provider, folge(5), quelle).startzeit, 900);
  assert.equal(c.spielerLaufSetzen(provider, folge(5), quelle, { startzeit: 45 }).startzeit, 45);
});

function ladekontext(aufloesen) {
  const geoeffnet = [];
  const c = kontext({ direktLaden: new AbortController(), spielerView: null,
    providerModel: { isHttpUrl: () => true }, getProviderView: () => ({}),
    werkbankLesen: async () => ({ view: {}, links: [{ adresse: "hoster" }] }),
    direktQuelleFuerAnsicht: aufloesen,
    direktSpielerOeffnen: async (_provider, url) => { geoeffnet.push(url); return true; }
  }, ["direktAuftragBeginnen", "direktFolgeSpielen", "direktSpielerSchliessen"]);
  return { c, geoeffnet };
}

pruefe("Schliessen waehrend der Aufloesung verhindert ein Wiederaufgehen", async () => {
  const antwort = offen(); const gestartet = offen();
  const { c, geoeffnet } = ladekontext(() => { gestartet.fertig(); return antwort.antwort; });
  const lauf = c.direktFolgeSpielen(provider, folge(1));
  await gestartet.antwort;
  c.direktSpielerSchliessen("knopf");
  antwort.fertig(quelle);
  assert.equal((await lauf).abgebrochen, true);
  assert.deepEqual(geoeffnet, []);
});

pruefe("Eine neuere Auswahl gewinnt gegen eine spaete alte Antwort", async () => {
  const alt = offen(); const gestartet = offen(); let nummer = 0;
  const { c, geoeffnet } = ladekontext(() => {
    if (++nummer === 1) { gestartet.fertig(); return alt.antwort; }
    return Promise.resolve(quelle);
  });
  const a = c.direktFolgeSpielen(provider, folge(1));
  await gestartet.antwort;
  await c.direktFolgeSpielen(provider, folge(2));
  alt.fertig(quelle);
  assert.equal((await a).abgebrochen, true);
  assert.deepEqual(geoeffnet, [folge(2)]);
});

pruefe("Ein abgebrochener Erstaufruf zeigt auch keine Fehler-Auswahl", async () => {
  const lesen = offen(); let angezeigt = 0;
  const c = kontext({ direktLaden: new AbortController(), direktModus: () => true,
    providerModel: { isHttpUrl: () => true }, werkbankLesen: () => lesen.antwort,
    direktZurueckZurOberflaeche: async () => { angezeigt++; }
  }, ["direktAuftragBeginnen", "direktUebernehmen"]);
  const lauf = c.direktUebernehmen(provider, filmB);
  c.direktLaden.abort(); lesen.fertig(null); await lauf;
  assert.equal(angezeigt, 0);
});

pruefe("Auch ein langsames Pausieren beim Anbieterwechsel kann eine neue Auswahl nicht verdraengen", async () => {
  const wartet = offen(); const navigationen = []; let pausen = 0;
  const c = kontext({ direktLaden: new AbortController(), spielerView: null,
    pendingAutostart: null, setOverlayOpen() {}, activeView: {}, activeProviderId: "alt",
    settings: { playback: { pauseOnProviderSwitch: true } },
    pauseProviderForSwitch: () => ++pausen === 1 ? wartet.antwort : Promise.resolve(),
    getProviderView: () => ({ webContents: { setAudioMuted() {} } }),
    providerModel: { normalizeUrl: (url) => url }, shouldBlockProviderNavigation: () => false,
    attachedProviderViews: new Set(), overlayReasons: new Set(), direktModus: () => true,
    providerViews: new Map(), applyBrowserBounds() {},
    direktUebernehmen: async (p) => { navigationen.push(p.id); }
  }, ["direktAuftragBeginnen", "direktSpielerSchliessen", "navigateProvider"]);
  const a = c.navigateProvider({ id: "eins" }, filmA);
  await c.navigateProvider({ id: "zwei" }, filmB);
  wartet.fertig(); await a;
  assert.equal(c.activeProviderId, "zwei");
  assert.deepEqual(navigationen, ["zwei"]);
});

pruefe("Navigation und DOM-Lesen bleiben trotz paralleler Folgenliste zusammen", async () => {
  const wartet = offen(); const protokoll = [];
  const c = kontext({ werkbankAuftraege: new Map(), werkbankAn: async (_p, url) => {
    protokoll.push(`laden:${url}`); return { url };
  } }, ["werkbankLesen"]);
  const a = c.werkbankLesen(provider, "folge", async (view) => { await wartet.antwort; protokoll.push(`lesen:${view.url}`); });
  const b = c.werkbankLesen(provider, "staffel", async (view) => { protokoll.push(`lesen:${view.url}`); });
  await Promise.resolve(); wartet.fertig(); await Promise.all([a, b]);
  assert.deepEqual(protokoll, ["laden:folge", "lesen:folge", "laden:staffel", "lesen:staffel"]);
});

pruefe("Filmo waehlt die neue Marke desselben Hosters und derselben Fassung", async () => {
  const anfragen = [];
  const alt = { adresse: "https://filmo.example/openMint/alt", hoster: "VOE", sprache: "Deutsch", spracheRoh: "Deutsch" };
  const neu = { ...alt, adresse: "https://filmo.example/openMint/neu" };
  const c = kontext({ isLiveView: () => true, DIREKT_HOECHSTVERSUCHE: 3,
    direktAufloeserHolen: () => ({ aufloesen: async (url) => { anfragen.push(url); return quelle; } }),
    direktLinksLesen: async () => [ { ...neu, sprache: "English", adresse: "falsch" }, neu ]
  }, ["direktQuelleFuerAnsicht"]);
  const ergebnis = await c.direktQuelleFuerAnsicht(provider, { webContents: { getURL: () => filmB } }, { nurDieser: alt.adresse, hosterWahl: alt });
  assert.equal(ergebnis.ok, true);
  assert.deepEqual(anfragen, [neu.adresse]);
});

pruefe("Der Rueckfall behaelt alle Hoster zur manuellen Auswahl", async () => {
  let auftrag;
  const c = kontext({ direktSpielerOeffnen: async (_p, _url, ergebnis) => { auftrag = ergebnis; return true; } }, ["direktAuswahlOeffnen"]);
  const hosterliste = [{ adresse: "eins" }, { adresse: "zwei" }, { adresse: "drei" }, { adresse: "vier" }];
  await c.direktAuswahlOeffnen(provider, filmB, { hosterliste });
  assert.deepEqual(auftrag.hosterliste, hosterliste);
});

pruefe("Ein noch gueltiger Hoster-Link hat Vorrang vor gleichnamigen Eintraegen", async () => {
  const hoster = { adresse: "zwei", hoster: "VOE", sprache: "1", spracheRoh: "Deutsch" };
  const c = kontext({ isLiveView: () => true, DIREKT_HOECHSTVERSUCHE: 3,
    direktAufloeserHolen: () => ({ aufloesen: async (url) => { assert.equal(url, "zwei"); return quelle; } }),
    direktLinksLesen: async () => [{ ...hoster, adresse: "eins" }, hoster]
  }, ["direktQuelleFuerAnsicht"]);
  assert.equal((await c.direktQuelleFuerAnsicht(provider, { webContents: { getURL: () => filmB } },
    { nurDieser: "zwei", hosterWahl: hoster })).ok, true);
});

pruefe("Spaete Fortschrittsmeldungen einer alten Quelle werden nicht der neuen Folge zugeschrieben", () => {
  let empfangen; let verbucht = 0;
  const sender = {};
  const c = vm.createContext({ ipcMain: { on: (_kanal, fn) => { empfangen = fn; } },
    spielerLauf: { id: 2, providerId: "p", url: folge(2) }, spielerView: { webContents: sender },
    spielerLetzterStand: null, sanitizePositiveNumber: (wert) => Number(wert) || 0,
    fernStandMelden: async () => {}, enabledProviders: () => [provider],
    mediaProgressPercent: (stelle, dauer) => stelle / dauer * 100, COMPLETED_PROGRESS_PERCENT: 90,
    recordMediaActivity: () => { verbucht++; return null; }
  });
  const start = haupt.indexOf('ipcMain.on("spieler:stand"');
  vm.runInContext(haupt.slice(start, haupt.indexOf("\n});", start) + 4), c);
  empfangen({ sender }, { auftragId: 1, stelle: 900, dauer: 1200, laeuft: true });
  assert.equal(verbucht, 0);
  empfangen({ sender }, { auftragId: 2, stelle: 10, dauer: 1200, laeuft: false });
  assert.equal(verbucht, 1);
  assert.equal(c.spielerLetzterStand.laeuft, false);
});

pruefe("Am Staffelende wird die erste spielbare Folge der naechsten Staffel geladen", async () => {
  const lauf = { url: folge(12) }; const gelesen = [];
  const c = kontext({ spielerLauf: lauf, spielerView: null, direktfolgen,
    episodeIdentity: fortschritt.episodeIdentity,
    folgenlisteLesen: async (_p, url) => {
      gelesen.push(url);
      return url === lauf.url
        ? { folgen: [{ staffel: 1, folge: 12, url: folge(12) }], staffeln: [{ staffel: 2, url: "staffel2" }] }
        : { folgen: [{ staffel: 2, folge: 1, url: folge(1, 2), gesperrt: true }, { staffel: 2, folge: 2, url: folge(2, 2) }] };
    }
  }, ["spielerNaechsteNachtragen"]);
  await c.spielerNaechsteNachtragen(provider, lauf.url);
  assert.equal(lauf.naechste.url, folge(2, 2));
  assert.deepEqual(gelesen, [lauf.url, "staffel2"]);
});

pruefe("Fernbefehle und Pause-Einstellungen erreichen ausschliesslich den eigenen Player", async () => {
  const befehle = [];
  const c = kontext({ spielerLauf: {}, FERN_VOR_S: 30, FERN_ZURUECK_S: 10,
    spielerBefehl: (befehl) => { befehle.push(befehl); return true; },
    activeProvider: () => { throw Error("Anbieter statt Player"); },
    pauseViewPlayback: () => { throw Error("Anbieter statt Player"); }
  }, ["fernBefehl", "pauseActivePlayback"]);
  for (const befehl of ["pause", "abspielen", "umschalten", "stumm", "vor", "zurueck", "lauter", "leiser", "vollbild"]) {
    await c.fernBefehl(befehl);
  }
  c.pauseActivePlayback(true);
  assert.equal(befehle.length, 10);
  assert.ok(befehle.every((befehl) => befehl.tun === "fern"));
});

function playerKontext() {
  const elemente = new Map(); const intervalle = new Map(); let timerId = 0;
  const meldungen = [];
  function element(id) {
    if (elemente.has(id)) return elemente.get(id);
    const horcher = {};
    const el = { hidden: true, value: "", children: [], paused: true, ended: false, currentTime: 0, duration: NaN, volume: 1, muted: false,
      buffered: { length: 0 }, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(name, fn) { (horcher[name] ||= []).push(fn); },
      dispatchEvent(event) { for (const fn of horcher[event.type] || []) fn(event); },
      appendChild(child) { this.children.push(child); }, append(...children) { this.children.push(...children); },
      setAttribute() {}, getAttribute() { return this.src || ""; }, removeAttribute() { this.src = ""; },
      play() { this.paused = false; this.dispatchEvent({ type: "play" }); return Promise.resolve(); },
      pause() { const lief = !this.paused; this.paused = true; if (lief) this.dispatchEvent({ type: "pause" }); },
      load() { this.currentTime = 0; this.duration = NaN; }, canPlayType() { return ""; }
    };
    Object.defineProperty(el, "textContent", { get() { return this.text || ""; }, set(wert) { this.text = wert; this.children = []; } });
    elemente.set(id, el); return el;
  }
  const bruecke = new Proxy({ stand: (wert) => meldungen.push(wert), folgen: async () => null,
    wechseln: async () => ({ ok: true }) }, { get: (objekt, key) => objekt[key] || (() => {}) });
  const c = vm.createContext({ window: { elfixSpieler: bruecke }, console: still, Date, Event,
    document: { getElementById: element, createElement: () => element(Symbol()), addEventListener() {} },
    setTimeout: () => ++timerId, clearTimeout() {},
    setInterval: (fn) => { const id = ++timerId; intervalle.set(id, fn); return id; }, clearInterval: (id) => intervalle.delete(id)
  });
  vm.runInContext(spieler, c);
  return { c, element, meldungen, intervalle };
}

pruefe("Abgebrochener Countdown bleibt bei weiteren Videotakten und am Ende aus", () => {
  const { c, element } = playerKontext();
  c.starten({ adresse: "video.mp4", weiterZaehler: 8, naechste: { url: folge(2) } });
  const bild = element("bild"); bild.duration = 100; bild.currentTime = 93; bild.paused = false;
  bild.dispatchEvent({ type: "timeupdate" }); assert.equal(element("weiter").hidden, false);
  element("weiterAbbruch").dispatchEvent({ type: "click" });
  for (let i = 0; i < 5; i++) bild.dispatchEvent({ type: "timeupdate" });
  bild.ended = true; bild.dispatchEvent({ type: "ended" });
  assert.equal(element("weiter").hidden, true);
  c.starten({ adresse: "neu.mp4", weiterZaehler: 8, naechste: { url: folge(3) } });
  bild.duration = 100; bild.currentTime = 93; bild.dispatchEvent({ type: "timeupdate" });
  assert.equal(element("weiter").hidden, false);
});

pruefe("Fernbedienung pausiert, spult und aendert den Ton im echten Player-Skript", () => {
  const { c, element, meldungen } = playerKontext();
  const bild = element("bild"); bild.duration = 1000; bild.currentTime = 100; bild.paused = false;
  c.steuernAusRunde({ tun: "fern", befehl: "pause" }); assert.equal(bild.paused, true);
  c.steuernAusRunde({ tun: "fern", befehl: "vor", vor: 30 }); assert.equal(bild.currentTime, 130);
  c.steuernAusRunde({ tun: "fern", befehl: "stumm" }); assert.equal(bild.muted, true);
  c.steuernAusRunde({ tun: "fern", befehl: "lauter" }); assert.equal(bild.muted, false);
  assert.equal(meldungen.at(-1).laeuft, false);
});

pruefe("Auch ein einzelner Hoster ist im Fehlerfall waehlbar", () => {
  const { c, element } = playerKontext();
  c.hosterSetzen([{ adresse: "eins", hoster: "VOE", fassung: "Deutsch" }], "");
  assert.equal(element("hosterWahl").disabled, false);
  assert.equal(element("hosterWahl").value, "");
  assert.equal(element("hosterWahl").children[1].value, "eins");
});

pruefe("Der neue Hinweis erscheint auch bei bereits weitestem eigenen Eintrag", () => {
  const eigen = { id: "eigen", episode: 10 };
  const c = kontext({ favorites: [eigen, { id: "runde", episode: 9, newEpisodeAt: "2026-09-05", newEpisodeLabel: "Folge 11" }],
    werkSchluessel: () => "werk", folgeVergleich: (a, b) => a.episode - b.episode
  }, ["weitesterStand"], oberflaeche);
  assert.equal(c.weitesterStand(eigen).newEpisodeLabel, "Folge 11");
  assert.equal(eigen.newEpisodeLabel, undefined);
});

pruefe("Stream-Beobachtung verwirft Werbung und nimmt die lange Folge", async () => {
  let geschlossen = 0;
  const ergebnis = await beobachtung.beobachten({ kennung: "Test",
    oeffnen: async (_url, _referer, aufnehmen) => {
      aufnehmen({ adresse: "https://cdn.example/ad.m3u8" });
      aufnehmen({ adresse: "https://cdn.example/folge.m3u8" });
      return { lesen: async () => ({ seite: "https://hoster.example/embed" }), schliessen: () => { geschlossen++; } };
    },
    holen: async (url) => new Response(`#EXTM3U\n#EXTINF:${url.includes("/ad.") ? 30 : 1400},\na.ts\n#EXT-X-ENDLIST\n`)
  }, "https://hoster.example/embed", "https://anbieter.example");
  assert.equal(ergebnis.ok, true);
  assert.equal(ergebnis.quelle.adresse, "https://cdn.example/folge.m3u8");
  assert.equal(geschlossen, 1);
});

pruefe("Abgebrochene Beobachtung schliesst ihre Ansicht ohne Quelle", async () => {
  const abbruch = new AbortController(); let geschlossen = 0;
  const ergebnis = await beobachtung.beobachten({ kennung: "Test",
    oeffnen: async () => { abbruch.abort(); return { lesen: async () => ({}), schliessen: () => { geschlossen++; } }; }
  }, "https://hoster.example/embed", "https://anbieter.example", abbruch.signal);
  assert.equal(ergebnis.ok, false);
  assert.equal(geschlossen, 1);
});

pruefe("Ein Master mit kaputter Unterplaylist gilt nicht als spielbar", async () => {
  const laenge = await beobachtung.playlistPruefen(async (url) => url.endsWith("master.m3u8")
    ? new Response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nmedia.m3u8\n")
    : new Response("weg", { status: 404 }), "https://cdn.example/master.m3u8", { referer: "", origin: "", "user-agent": "Test" });
  assert.equal(laenge, 0);
});

(async () => {
  const frist = setTimeout(() => { console.log("FAIL  Eine Regressionstest-Antwort blieb aus"); process.exit(1); }, 15000);
  let bestanden = 0;
  for (const { name, tun } of pruefungen) {
    try { await tun(); bestanden++; console.log(`OK    ${name}`); }
    catch (fehler) { console.log(`FAIL  ${name} -> ${fehler.stack}`); }
  }
  console.log(`${bestanden}/${pruefungen.length} bestanden`);
  clearTimeout(frist);
  process.exitCode = bestanden === pruefungen.length ? 0 : 1;
})();
