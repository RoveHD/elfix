"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const direktquelle = require("../src/direktquelle"), direktlauf = require("../src/direktlauf");
const direktbeobachtung = require("../src/direktbeobachtung"), streamspur = require("../src/streamspur");
const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
const funktion = name => { const start = main.search(new RegExp("(?:async )?function " + name + "\\(")); assert.ok(start >= 0, name); return main.slice(start, main.indexOf("\n}", start) + 2); };
const episode = "https://s.to/serie/test/staffel-1/episode-2", film = "https://cdn.example/film.m3u8";
const playlist = "#EXTM3U\n#EXT-X-TARGETDURATION:600\n#EXTINF:600,\nfilm.ts\n#EXT-X-ENDLIST\n";
const quelle = { ok: true, quelle: { adresse: film, typ: "hls", hoehe: 1080 }, seite: "https://voe.example/e/test" };
const de = { adresse: "https://s.to/redirect/de", hoster: "VOE", sprache: "de", sichtbar: true };
const en = { adresse: "https://s.to/redirect/en", hoster: "VOE", sprache: "en", sichtbar: true };
function observer() {
  let seite = episode, lagen = [], status = 200, abrufe = 0, resolverAbrufe = 0, holen = null;
  const view = { webContents: { id: 77, getURL: () => seite } }, signal = new AbortController();
  const c = vm.createContext({ direktBeobachter: new Map(), Date, direktquelle, direktlauf, direktbeobachtung, streamspur,
    episodeIdentity: url => url.includes("episode-") ? ({}) : null, isExpectedEpisodePage: (a, b) => a === b,
    isLiveView: () => true, isKnownVideoHosterUrl: url => url.includes("voe.example"),
    providerModel: { isHttpUrl: url => /^https?:/.test(url), hostFromUrl: url => new URL(url).hostname },
    browserSession: { getUserAgent: () => "Fixture", fetch: async (...args) => { abrufe++; return holen ? holen(...args) : new Response(status === 200 ? playlist : "Forbidden", { status }); } },
    executeJavaScriptInMediaFrames: async () => lagen,
    direktAufloeserHolen: () => ({ aufloesen: async () => { resolverAbrufe++; return { ok: false }; } }) });
  vm.runInContext(funktion("anbieterQuelleBeobachten"), c);
  const beobachter = c.anbieterQuelleBeobachten(view, episode);
  return { c, signal, beobachter, netz: item => c.direktBeobachter.get(77)(item),
    lesen: () => beobachter.pruefen({ signal: signal.signal, seit: 1 }),
    seite: wert => { seite = wert; }, lagen: wert => { lagen = wert; }, status: wert => { status = wert; },
    holen: wert => { holen = wert; }, get abrufe() { return abrufe; }, get resolverAbrufe() { return resolverAbrufe; } };
}
function uebergabe({ generation = () => true } = {}) {
  const lauf = { id: 7, providerId: "sto", url: episode, quelle: { adresse: "" }, link: de.adresse,
    hoster: "VOE", hosterliste: [de, en], startzeit: 42, rundeWarten: true, rundeUebernehmen: true };
  let optionen, oeffnungen = 0, abgleiche = 0, waehlen = async () => ({ link: de.adresse, hoster: "VOE", hosterliste: [de, en] });
  let einbauen = null;
  const auftrag = new AbortController();
  const c = vm.createContext({ spielerLauf: lauf, direktLaden: auftrag, spielerTakt: { stelle: 42 }, menschentorFenster: null,
    direktAnbieterFallback: { aktuell: { provider: { id: "sto" }, url: episode, signal: auftrag.signal, optionen: { istAktuell: generation } } },
    episodeIdentity: () => ({}), seiteGleich: (a, b) => a === b,
    anbieterSeitenAnsicht: { oeffnen: async (_provider, _url, options) => { optionen = options; return "geschlossen"; } },
    anbieterHosterWahl: (...args) => waehlen(...args), sanitizePositiveNumber: value => Math.max(0, Number(value) || 0),
    watchpartyLiveKeyForUrl: () => "runde", watchpartyRaumForUrl: () => "raum", isContentFullscreen: true,
    direktSpielerOeffnen: async (_provider, _url, ergebnis, opts) => {
      oeffnungen++; c.spielerLauf = { ...lauf, id: lauf.id + 1, quelle: ergebnis.quelle };
      return einbauen ? einbauen(ergebnis, opts) : true;
    }, watchpartyZustandUebernehmen: () => { abgleiche++; }, AbortController, AbortSignal });
  vm.runInContext(["direktAuftragBeginnen", "anbieterSeiteOeffnen"].map(funktion).join("\n"), c);
  return { c, lauf, auftrag,
    async vorbereiten() { await c.anbieterSeiteOeffnen({ id: "sto" }, episode, auftrag.signal); },
    uebernehmen: () => optionen.quelleUebernehmen(quelle, { signal: new AbortController().signal, wechseln: factory => factory() }),
    wahl: fn => { waehlen = fn; }, einbau: fn => { einbauen = fn; },
    get oeffnungen() { return oeffnungen; }, get abgleiche() { return abgleiche; } };
}
async function run() {
  let t = observer(); t.netz({ adresse: film, rahmen: episode, vonWerbung: true });
  assert.equal(await t.lesen(), null, "Werbeherkunft bleibt auch bei langer gueltiger Playlist verworfen");
  t = observer(); t.status(403); t.netz({ adresse: film, rahmen: episode });
  assert.equal(await t.lesen(), null); const fehlversuche = t.abrufe;
  assert.equal(await t.lesen(), null); assert.equal(t.abrufe, fehlversuche, "Kein pauschales Retry ohne neuen Beleg");
  t.status(200); t.netz({ adresse: film, rahmen: episode });
  assert.equal((await t.lesen()).quelle.adresse, film, "Neuer Netzbeleg erneuert negative Probe derselben URL");
  t = observer();
  t.holen(async url => new Response(url.includes("fehler-") ? "Forbidden" : playlist, { status: url.includes("fehler-") ? 403 : 200 }));
  t.netz({ adresse: film, rahmen: episode });
  for (let i = 0; i < 20; i++) t.netz({ adresse: `https://cdn.example/fehler-${i}.m3u8`, rahmen: episode });
  assert.equal(await t.lesen(), null, "Erste zwoelf neue Fehlbelege sind begrenzt");
  assert.equal((await t.lesen()).quelle.adresse, film, "Weitere Kandidaten bleiben nach zwoelf Fehlern erreichbar");
  assert.equal(t.abrufe, 21, "Fruehere Fehlbelege werden im zweiten Paket nicht erneut geholt");

  t = observer(); t.lagen([{ seite: "https://voe.example/e/test", html: "<body>Player laedt</body>" }]);
  assert.equal(await t.lesen(), null); assert.equal(t.resolverAbrufe, 1);
  t.lagen([{ seite: "https://voe.example/e/test", html: `<script>window.sources=[{file:"${film}"}]</script>` }]);
  assert.equal((await t.lesen()).quelle.adresse, film, "Spaet eingefuegte JS-Quelle desselben Iframes bleibt lesbar");
  assert.equal(t.resolverAbrufe, 1, "Geaendertes DOM braucht keinen erneuten Resolverfetch");
  t = observer(); t.status(403);
  t.lagen([{ seite: "https://voe.example/e/test", html: `<script>window.sources=[{file:"${film}"}]</script>` }]);
  assert.equal(await t.lesen(), null); t.status(200);
  t.lagen([{ seite: "https://voe.example/e/test", html: `<script>window.sources=[{file:"${film}"}];window.fertig=true</script>` }]);
  assert.equal((await t.lesen()).quelle.adresse, film, "Neuer DOM-Beleg hebt negative Manifestprobe auf");

  t = observer(); t.netz({ adresse: film, rahmen: episode }); t.seite(episode.replace("episode-2", "episode-3"));
  assert.equal(await t.lesen(), null); assert.equal(t.abrufe, 0, "Andere Episode wird schon vor der Probe abgewiesen");
  t = observer(); t.netz({ adresse: film, rahmen: episode });
  let fertig, begonnen; const beginnt = new Promise(resolve => { begonnen = resolve; });
  t.holen(() => new Promise(resolve => { fertig = resolve; begonnen(); }));
  const spaet = t.lesen(); await beginnt;
  t.seite(episode.replace("episode-2", "episode-3")); fertig(new Response(playlist));
  assert.equal(await spaet, null, "Episodenwechsel waehrend des geschuetzten Abrufs verwirft das Ergebnis");

  let u = uebergabe(); await u.vorbereiten(); u.c.spielerLauf = { ...u.lauf, id: 8 };
  assert.equal(await u.uebernehmen(), false); assert.equal(u.oeffnungen, 0, "Neuer Auftrag derselben URL gewinnt");
  u = uebergabe({ generation: () => false }); await u.vorbereiten();
  assert.equal(await u.uebernehmen(), false); assert.equal(u.oeffnungen, 0, "Urspruengliche Queue-/Barriere-Generation bleibt massgeblich");
  let generation = true; u = uebergabe({ generation: () => generation }); await u.vorbereiten();
  u.wahl(async () => { generation = false; return { link: de.adresse }; });
  assert.equal(await u.uebernehmen(), false); assert.equal(u.oeffnungen, 0, "Generation nach asynchronem Lesen erneut pruefen");
  generation = true; u = uebergabe({ generation: () => generation }); await u.vorbereiten();
  u.einbau(async () => { generation = false; return true; });
  assert.equal(await u.uebernehmen(), false); assert.equal(u.abgleiche, 0, "Keine Rundenfortsetzung nach veralteter Commitantwort");
  u = uebergabe(); await u.vorbereiten();
  let einbauFertig, einbauBegonnen;
  const wartet = new Promise(resolve => { einbauBegonnen = resolve; });
  u.einbau(() => new Promise(resolve => { einbauFertig = resolve; einbauBegonnen(); }));
  const einbauLaeuft = u.uebernehmen(); await wartet;
  u.c.spielerLauf = { ...u.c.spielerLauf, id: 55 }; einbauFertig(true);
  assert.equal(await einbauLaeuft, false); assert.equal(u.abgleiche, 0, "Auch Ersatzauftrag waehrend Commit wird erkannt");
  u = uebergabe(); await u.vorbereiten();
  u.einbau(async (_ergebnis, options) => { assert.equal(options.startzeit, 42); assert.equal(options.rundeWarten, true); assert.equal(options.rundeUebernehmen, true); return true; });
  assert.equal(await u.uebernehmen(), true); assert.equal(u.abgleiche, 1);
  assert.equal(u.auftrag.signal.aborted, true, "Alter Resolver wird gezielt vor der Uebernahme abgebrochen");

  let frisch = [de, en];
  const w = vm.createContext({ isLiveView: () => true, direktlinks: { hosterlinkScript: () => "fixture" } });
  vm.runInContext(funktion("anbieterHosterWahl"), w);
  const view = { webContents: { executeJavaScript: async () => JSON.stringify(frisch) } };
  assert.equal((await w.anbieterHosterWahl(view, { hoster: "VOE" }, { link: en.adresse, hosterliste: [de, en] })).link, en.adresse);
  assert.equal(await w.anbieterHosterWahl(view, { hoster: "VOE" }, { hosterliste: [de, en] }), null, "Bei zwei sichtbaren Sprachen keine erste Fassung raten");
  frisch = [de, { ...en, sichtbar: false }];
  const auswahl = await w.anbieterHosterWahl(view, { hoster: "VOE" }, { hosterliste: [de, en] });
  assert.equal(auswahl.link, de.adresse); assert.ok(auswahl.hosterliste.some(eintrag => eintrag.adresse === auswahl.link));
  console.log("OK Anbieterquelle: neue DOM-/Netzbelege, Werbefilter, Folgen-/Auftrags-/Queuegrenzen, servergepruefte Uebergabe und eindeutige Fassung");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
