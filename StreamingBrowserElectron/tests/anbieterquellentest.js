"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const direktquelle = require("../src/direktquelle"), direktlauf = require("../src/direktlauf");
const direktbeobachtung = require("../src/direktbeobachtung"), streamspur = require("../src/streamspur");
const direktlinks = require("../src/direktlinks"), fassung = require("../src/fassung");
const taste = require("../src/taste"), watchpartySync = require("../src/watchparty-sync");
const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
const funktion = name => { const start = main.search(new RegExp("(?:async )?function " + name + "\\(")); assert.ok(start >= 0, name); return main.slice(start, main.indexOf("\n}", start) + 2); };
const episode = "https://s.to/serie/test/staffel-1/episode-2", film = "https://cdn.example/film.m3u8";
const playlist = "#EXTM3U\n#EXT-X-TARGETDURATION:600\n#EXTINF:600,\nfilm.ts\n#EXT-X-ENDLIST\n";
const quelle = { ok: true, quelle: { adresse: film, typ: "hls", hoehe: 1080 }, seite: "https://voe.example/e/test" };
const de = { adresse: "https://s.to/redirect/de", hoster: "VOE", sprache: "de", sichtbar: true };
const en = { adresse: "https://s.to/redirect/en", hoster: "VOE", sprache: "en", sichtbar: true };
function observer() {
  let seite = episode, lagen = [], status = 200, abrufe = 0, resolverAbrufe = 0, holen = null;
  let kacheln = [];
  const view = { webContents: { id: 77, getURL: () => seite, executeJavaScript: async () => JSON.stringify(kacheln) } }, signal = new AbortController();
  const c = vm.createContext({ direktBeobachter: new Map(), Date, URL, direktlinks, direktquelle, direktlauf, direktbeobachtung, streamspur,
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
    kacheln: wert => { kacheln = wert; },
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
    async vorbereiten() { await c.anbieterSeiteOeffnen({ id: "sto" }, episode, c.direktLaden.signal); },
    uebernehmen: () => optionen.quelleUebernehmen(quelle, { signal: new AbortController().signal, wechseln: factory => factory() }),
    wahl: fn => { waehlen = fn; }, einbau: fn => { einbauen = fn; },
    get oeffnungen() { return oeffnungen; }, get abgleiche() { return abgleiche; } };
}
async function run() {
  // Eine Originalbestaetigung kann laenger offen sein als die Startschranke.
  // Neuere Steuerung derselben Folge verwirft den alten Play-Befehl, nicht
  // die weiterhin benoetigte Quelle. Dispatcher und Uebergabe sind produktiv.
  for (const action of ["syncprepare", "syncstart"]) {
    for (const danach of ["pause", "syncstart", "andere-folge", "abbruch"]) {
      const befehle = [], bereit = [];
      let quellOptionen, ladenBeenden;
      const eintrag = { key: "serie:test", room: "probe", hostId: "host", myId: "gast" };
      const c = vm.createContext({ taste, console, Date, watchpartySync,
        spielerLauf: { id: 6, url: episode.replace("episode-2", "episode-1") },
        spielerTakt: { stelle: 0, laeuft: false, at: Date.now() },
        spielerFolgenVorbereitung: null, spielerSyncBereit: null,
        providerViews: new Map(), watchpartyLetztesEreignis: new Map(),
        aktiverWatchpartyRaum: () => eintrag.room, watchpartyEintrag: () => eintrag,
        episodeIdentity: url => /episode-(\d+)/.test(url || "") ? { season: 1, episode: Number(RegExp.$1) } : null,
        istGleicheFolge: (a, b) => a === b,
        watchpartyPasstZurFolge: (id, url) => id === `s1e${String(url).match(/episode-(\d+)/)?.[1]}`,
        isLiveView: () => false, spielerAnbieter: () => ({ id: "sto" }),
        spielerBefehl: befehl => { befehle.push(befehl); return true; },
        ohneWatchpartyFolgenwechselEcho: (_provider, _url, fn) => fn(),
        direktFolgeSpielen: (_provider, url, options) => {
          c.spielerLauf = { id: 7, url, laden: true, quelle: { adresse: "" } };
          quellOptionen = options;
          return new Promise(resolve => { ladenBeenden = resolve; });
        },
        watchparty: { verbunden: true, serverJetzt: () => Date.now(), abgleichen() {},
          bereitZumStart: (_key, _room, _id, ok) => bereit.push(ok) },
        sendToast() {}, sendWatchpartyLive() {}, wpLog() {}, tempoAusRundeSetzen() {}, fassungAusRundeSetzen: async () => {},
        watchpartyEreignis: nachricht => ({ videoTime: nachricht.position, playing: nachricht.playing }),
        watchpartyLaeuftDanach: nachricht => Boolean(nachricht.playing)
      });
      vm.runInContext(["watchpartySerienSchluessel", "spielerRundenNachrichtPasst", "spielerSteuernAusRunde",
        "watchpartySteuerungHatZiel", "applyWatchpartyControl"].map(funktion).join("\n"), c);
      const nachricht = { ...eintrag, action, reason: "episode-change", url: episode, episodeId: "s1e2",
        syncId: "folge-zwei", sequenceId: 1, timestamp: Date.now(), position: 0, playing: action === "syncstart" };
      const laedt = c.applyWatchpartyControl(nachricht);
      assert.ok(quellOptionen?.istAktuell, "Rundenauftrag traegt die Quellen-Lebensdauer");
      const u = uebergabe({ generation: quellOptionen.istAktuell }); await u.vorbereiten();
      const alteLadungBeenden = ladenBeenden;
      const neuerBefehl = c.applyWatchpartyControl({ ...nachricht, action: ["syncstart", "andere-folge"].includes(danach) ? "syncstart" : "pause",
        reason: "", syncId: "", sequenceId: 2, timestamp: nachricht.timestamp + 106000,
        url: danach === "andere-folge" ? episode.replace("episode-2", "episode-3") : episode,
        episodeId: danach === "andere-folge" ? "s1e3" : "s1e2", playing: false });
      if (danach !== "andere-folge") await neuerBefehl;
      if (danach === "abbruch") u.auftrag.abort();
      const erlaubt = danach === "pause" || danach === "syncstart";
      assert.equal(await u.uebernehmen(), erlaubt,
        `${action}: Quellenfreigabe nach 106s und ${danach}`);
      alteLadungBeenden({ ok: erlaubt }); await laedt;
      if (danach === "andere-folge") { ladenBeenden({ ok: false }); await neuerBefehl; }
      assert.equal(befehle.some(befehl => befehl.laufen === true), false, "Alter Start spielt nach neuerer Pause nicht");
      assert.equal(bereit.includes(true), false, "Keine Bereitmeldung fuer die alte Startschranke");
    }
  }
  // Echte Auftragsfunktion: Folge 1 spielt noch, Folge 2 braucht eine
  // manuelle Freigabe. Der neue Ladeauftrag muss bereits vor dem Netz gelten.
  {
    const u = uebergabe();
    const alt = episode.replace("episode-2", "episode-1");
    Object.assign(u.c, {
      spielerLauf: { ...u.lauf, url: alt, quelle: { adresse: "https://cdn.example/alte-folge.m3u8" } },
      spielerTakt: { stelle: 913, laeuft: true }, spielerAuftragId: 7,
      spielerCfAbbrechen() {}, spielerCfVersuche: new Map(), spielerCfErfolgGemeldet: new Set(), spielerCfWeiterhinGemeldet: new Set(),
      geraeteWiedergabeMelden() {}, favorites: [], activeFavoriteId: null, normalizeFavoriteUrl: value => value,
      naechsteFolgeLabel: (_provider, url) => url, spielerRtxStop() {}, console: { log() {} },
      watchpartyAdresseFuerProvider: (_provider, url) => url, merkeGeoeffneteFolge() {},
      providerModel: { isHttpUrl: url => /^https?:/.test(url) },
      rundenFassungFuer: () => null, linkFuerFassung: () => null, direktFallbackErfolg() {}
    });
    let lesenFertig, lesenBegonnen, aufloesenFertig, aufloesenBegonnen;
    const liest = new Promise(resolve => { lesenBegonnen = resolve; });
    const loest = new Promise(resolve => { aufloesenBegonnen = resolve; });
    u.c.werkbankLesen = () => new Promise(resolve => { lesenFertig = resolve; lesenBegonnen(); });
    u.c.direktQuelleFuerAnsicht = () => new Promise(resolve => { aufloesenFertig = resolve; aufloesenBegonnen(); });
    u.c.direktFallbackStarten = (provider, url, signal, optionen) => {
      u.c.direktAnbieterFallback.aktuell = { provider, url, signal, optionen }; return u.c.direktAnbieterFallback.aktuell;
    };
    vm.runInContext(["spielerLaufSetzen", "direktFolgeSpielen"].map(funktion).join("\n"), u.c);
    const auftraege = [];
    u.c.direktSpielerOeffnen = async (provider, url, ergebnis, options) => {
      if (options.signal?.aborted || (options.istAktuell && !options.istAktuell())) return false;
      const lauf = u.c.spielerLaufSetzen(provider, url, ergebnis, options);
      auftraege.push({ lauf, options }); return true;
    };
    const wechsel = u.c.direktFolgeSpielen({ id: "sto" }, episode, { startzeit: 0, rundeWarten: true });
    await liest;
    assert.equal(u.c.spielerLauf.url, episode, "Die neue Folge gilt schon vor der ersten Netzantwort");
    assert.equal(u.c.spielerLauf.quelle.adresse, "", "Der neue Auftrag enthaelt niemals die alte Videoquelle");
    assert.equal(u.c.spielerLauf.laden, true); assert.equal(u.c.spielerTakt.stelle, 0);
    assert.equal(u.c.spielerLauf.startzeit, 0); assert.equal(u.c.spielerLauf.rundeWarten, true);
    const ladeLauf = u.c.spielerLauf;
    lesenFertig({ view: {}, links: [de, en] }); await loest;
    assert.equal(u.c.spielerLauf, ladeLauf, "Kachellesen ersetzt den offenen Bestaetigungsauftrag nicht");
    assert.equal(u.c.spielerLauf.hosterliste[0].adresse, de.adresse);
    await u.vorbereiten();
    assert.equal(await u.uebernehmen(), true);
    assert.equal(u.c.spielerLauf.url, episode); assert.equal(u.c.spielerLauf.quelle.adresse, film);
    assert.equal(u.c.spielerLauf.startzeit, 0, "913s der alten Folge werden nicht uebernommen");
    assert.equal(u.c.spielerLauf.rundeWarten, true); assert.equal(u.abgleiche, 1);
    aufloesenFertig({ ok: false, grund: "VOE: Keine spielbare Quelle beobachtet" });
    assert.equal((await wechsel).abgebrochen, true, "Spaeter Resolverfehler wird nach Quellencommit verworfen");
    assert.equal(auftraege.length, 2, "Genau Ladeauftrag und gepruefte neue Quelle werden eingebaut");
  }
  {
    let ersatz = 0, bestaetigungsAuftrag;
    const c = vm.createContext({
      direktModus: () => true, providerModel: { isHttpUrl: () => true },
      direktFallbackStarten: () => ({}), werkbankLesen: async () => [de],
      console: { log() {} }, kurzeUrl: value => value, sendToast() {}, seiteGleich: (a, b) => a === b,
      direktSpielerOeffnen: async (provider, url) => { c.spielerLauf = { id: 12, providerId: provider.id, url, laden: true }; return true; },
      direktFolgeSpielen: async () => { bestaetigungsAuftrag = c.spielerLauf; return { ok: false, grund: "VOE: Keine spielbare Quelle beobachtet" }; },
      direktAuswahlOeffnen: async () => { ersatz++; return { ok: true }; }
    });
    vm.runInContext(funktion("direktUebernehmen"), c);
    await c.direktUebernehmen({ id: "sto" }, episode, new AbortController().signal);
    assert.equal(ersatz, 0, "S.to-Fehler ersetzt keinen bereits bestaetigbaren Ladeauftrag durch eine neue ID");
    assert.equal(c.spielerLauf, bestaetigungsAuftrag);
  }
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
  u = uebergabe(); u.lauf.rundeUebernehmen = false; await u.vorbereiten();
  let frischerStand = 0;
  Object.assign(u.c, { spielerRundenUebernahme: null, RUNDE_UEBERNAHME_FRIST_MS: 6000, wpLog() {},
    watchparty: { abgleichen: () => { frischerStand++; } }, setTimeout: () => ({ unref() {} }) });
  vm.runInContext(funktion("watchpartyZustandUebernehmen"), u.c);
  u.einbau(async (_ergebnis, options) => {
    assert.equal(options.rundeWarten, true, "Spaete Quelle startet nie von selbst");
    assert.equal(options.rundeUebernehmen, true,
      "Spaete Bestaetigung fragt auch nach ueberholter Startschranke den aktuellen Rundenstand ab");
    u.c.spielerLauf.rundeUebernehmen = options.rundeUebernehmen;
    return true;
  });
  assert.equal(await u.uebernehmen(), true);
  assert.equal(frischerStand, 1, "Produktiver Uebernahme-Helper fragt nach der spaeten Quelle wirklich den Raumzustand ab");

  let frisch = [de, en];
  const w = vm.createContext({ isLiveView: () => true, direktlinks: { hosterlinkScript: () => "fixture" } });
  vm.runInContext(funktion("anbieterHosterWahl"), w);
  const view = { webContents: { executeJavaScript: async () => JSON.stringify(frisch) } };
  assert.equal(await w.anbieterHosterWahl(view, { hoster: "VOE" }, { link: de.adresse, hosterliste: [de, en] }), null,
    "Der gewuenschte deutsche Link belegt nicht die Sprache der fremden Quelle");
  assert.equal((await w.anbieterHosterWahl(view, { hoster: "VOE", anbieterLinks: [en.adresse] },
    { link: de.adresse, hosterliste: [de, en] })).link, en.adresse, "Englischer Quellenbeleg wird niemals deutsch beschriftet");
  assert.equal(await w.anbieterHosterWahl(view, { hoster: "VOE" }, { hosterliste: [de, en] }), null, "Bei zwei sichtbaren Sprachen keine erste Fassung raten");
  frisch = [de, { ...en, sichtbar: false }];
  const auswahl = await w.anbieterHosterWahl(view, { hoster: "VOE" }, { hosterliste: [de, en] });
  assert.equal(auswahl.link, de.adresse); assert.ok(auswahl.hosterliste.some(eintrag => eintrag.adresse === auswahl.link));
  // Neuer S.to-Dialog: der Linktoken steht im POST-Body statt in der URL.
  const deutsch = { ...de, adresse: "https://s.to/r?t=frisch-de", sprache: "Deutsch" };
  const englisch = { ...en, adresse: "https://s.to/r?t=frisch-en", sprache: "Englisch" };
  t = observer(); t.kacheln([deutsch, englisch]);
  t.netz({ formularToken: "frisch-de", anfrageId: 1, angefragt: true });
  t.netz({ formularToken: "frisch-en", anfrageId: 2, angefragt: true });
  t.netz({ adresse: "https://s.to/r", anfrageId: 2, rahmen: episode });
  t.netz({ adresse: film, rahmen: "https://voe.example/e/test" });
  const englischeQuelle = await t.lesen();
  assert.ok(englischeQuelle.anbieterLinks.includes(englisch.adresse));
  assert.ok(!englischeQuelle.anbieterLinks.includes(deutsch.adresse), "Abgebrochener deutscher POST ist kein Beleg");
  frisch = [deutsch, englisch];
  assert.equal((await w.anbieterHosterWahl(view, englischeQuelle,
    { link: deutsch.adresse, hosterliste: [deutsch, englisch] })).link, englisch.adresse);
  const tokenVm = vm.createContext({ direktBeobachter: new Map([[77, true]]), URLSearchParams, Buffer });
  vm.runInContext(funktion("anbieterFormularToken"), tokenVm);
  const request = { method: "POST", webContentsId: 77, uploadData: [{ bytes: Buffer.from("t=frisch%2Bde&cf-turnstile-response=privat&_token=privat") }] };
  assert.equal(tokenVm.anbieterFormularToken(request), "frisch+de");
  assert.equal(tokenVm.anbieterFormularToken({ ...request, webContentsId: 88 }), "");
  assert.equal(tokenVm.anbieterFormularToken({ ...request, method: "GET" }), "");

  const wunschVm = vm.createContext({ fassung, direktlinks, fassungSchluesselFuer: () => "serie", loadFassungen: () => ({}),
    rundenFassungFuer: () => null });
  vm.runInContext(["fassungsname", "linkFuerFassung", "anbieterWunschWahl"].map(funktion).join("\n"), wunschVm);
  const lauf = { link: deutsch.adresse, hosterliste: [deutsch, englisch] };
  assert.equal(wunschVm.anbieterWunschWahl({}, episode, lauf).sprache, "Deutsch");
  assert.equal(wunschVm.anbieterWunschWahl({}, episode, lauf, { hosterWahl: englisch }).sprache, "Englisch");
  wunschVm.rundenFassungFuer = () => ({ fassung: "Englisch", hoster: "VOE" });
  assert.equal(wunschVm.anbieterWunschWahl({}, episode, { hosterliste: [deutsch, englisch] }).sprache, "Englisch");
  wunschVm.rundenFassungFuer = () => null;
  wunschVm.loadFassungen = () => ({ serie: { key: "Englisch", roh: "Englisch" } });
  assert.equal(wunschVm.anbieterWunschWahl({}, episode, { hosterliste: [deutsch, englisch] }).sprache, "Englisch");
  assert.equal(wunschVm.anbieterWunschWahl({}, episode, { hosterliste: [] }, {}, [deutsch, englisch]).sprache, "Englisch",
    "Frische Kacheln setzen die gemerkte Fassung auch bei leerer Werkbank um");
  console.log("OK Anbieterquelle: neue DOM-/Netzbelege, Werbefilter, Folgen-/Auftrags-/Queuegrenzen, servergepruefte Uebergabe und eindeutige Fassung");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
