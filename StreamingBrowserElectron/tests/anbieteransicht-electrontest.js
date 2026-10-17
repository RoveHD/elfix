"use strict";
// Echte native Fenster, lokaler HTTP-Server und echte Chromium-Cookies.
// Die Fixture-Nutzeraktion ist kein Cloudflare-/Hoster-Sicherheitsbypass.
const { app, BrowserWindow, WebContentsView, session, desktopCapturer } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http");
const ansicht = require("../src/anbieteransicht");
const tor = require("../src/verifizierungstor");
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "elfix-anbieteransicht-")));
app.disableHardwareAcceleration();
let parent, player, server, controller;
const frist = setTimeout(() => ende(1, Error("Anbieteransicht Zeitlimit")), 30000);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function warte(fn) {
  const bis = Date.now() + 7000;
  while (Date.now() < bis) { if (await fn()) return; await pause(30); }
  throw Error("Anbieteransicht: Zustand fehlt");
}
const challenge = `<!doctype html><html><head><title>Lokale Anbieterseite</title><style>
body{margin:0;background:#102338;color:#edf4ff;font:18px sans-serif}header{background:#284c70;padding:30px}main{padding:30px}
#challenge-form{padding:22px;border:2px solid #90bfff;max-width:500px}button{padding:15px}footer{padding:35px;background:#284c70}
</style></head><body><header id="anbieterKopf">Lokaler Anbieter · ganze Seite</header><main>
<h1>Beispielserie · Staffel 1, Folge 2</h1><p id="beschreibung">Auch der Inhalt ausserhalb der Abfrage bleibt sichtbar.</p>
<form id="challenge-form" action="/confirm"><p>Lokale Testabfrage</p><button id="bestaetigen">Test manuell bestätigen</button></form>
</main><footer id="anbieterFuss">Anbieter-Fusszeile</footer></body></html>`;
const frei = '<!doctype html><html><head><title>Lokale Folge</title></head><body id="freigegeben">Server hat die Testbestaetigung angenommen</body></html>';
function wav() {
  const daten = Buffer.alloc(8000 * 60 * 2 + 44);
  daten.write("RIFF", 0); daten.writeUInt32LE(daten.length - 8, 4); daten.write("WAVEfmt ", 8);
  daten.writeUInt32LE(16, 16); daten.writeUInt16LE(1, 20); daten.writeUInt16LE(1, 22);
  daten.writeUInt32LE(8000, 24); daten.writeUInt32LE(16000, 28); daten.writeUInt16LE(2, 32); daten.writeUInt16LE(16, 34);
  daten.write("data", 36); daten.writeUInt32LE(daten.length - 44, 40); return daten;
}
app.whenReady().then(async () => {
  const audio = wav();
  server = http.createServer((req, res) => {
    const route = new URL(req.url, "http://127.0.0.1").pathname;
    if (route === "/tone.wav") {
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
      const start = range ? Number(range[1]) : 0, end = range?.[2] ? Number(range[2]) : audio.length - 1;
      res.writeHead(range ? 206 : 200, { "content-type": "audio/wav", "accept-ranges": "bytes",
        "content-length": end - start + 1, ...(range ? { "content-range": `bytes ${start}-${end}/${audio.length}` } : {}) });
      res.end(audio.subarray(start, end + 1)); return;
    }
    if (route === "/player") { res.setHeader("content-type", "text/html; charset=utf-8"); res.end('<!doctype html><body style="background:#071321;color:white"><h1>Bestehender Player</h1><video id="video" src="/tone.wav" preload="auto"></video><script>window.sessionId="bestehende-watchparty"</script></body>'); return; }
    if (route === "/confirm") { res.writeHead(302, { location: "/episode", "set-cookie": "cf_clearance=lokale-bestaetigung; Path=/; SameSite=Lax" }); res.end(); return; }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(String(req.headers.cookie || "").includes("cf_clearance=") ? frei : challenge);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const basis = `http://127.0.0.1:${server.address().port}`, url = basis + "/episode";
  const browserSession = session.fromPartition("persist:anbieteransicht-fixture");
  parent = new BrowserWindow({ width: 1050, height: 760, show: true });
  await parent.loadURL("data:text/html,<body>ELFIX</body>");
  player = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  parent.contentView.addChildView(player); player.setBounds({ x: 0, y: 0, width: 1050, height: 760 });
  await player.webContents.loadURL(basis + "/player");
  const js = code => player.webContents.executeJavaScript(code);
  await warte(() => js("video.readyState >= 2"));
  await js("video.currentTime=12.5;video.pause()");
  await warte(() => js("!video.seeking && video.currentTime === 12.5"));
  const playerUrl = player.webContents.getURL();
  let geladen = 0;
  player.webContents.on("did-start-navigation", () => geladen++);
  const fenster = [];
  const seite = win => win.contentView.children.find(view => view.webContents?.session === browserSession).webContents;
  const seiteBereit = win => seite(win).executeJavaScript("Boolean(window.__anbieterProben)");
  let pruefungen = 0;
  controller = ansicht.erstellen({
    BrowserWindow: function (options) { const win = new BrowserWindow(options); fenster.push(win); return win; },
    WebContentsView,
    eltern: () => parent, sitzung: () => browserSession,
    zustandScript: () => `(window.__anbieterProben=(window.__anbieterProben||0)+1,${tor.zustandScript()})`,
    persistieren: sitzung => sitzung.cookies.flushStore()
  });
  const provider = { id: "fixture", name: "Testanbieter" };
  const pruefen = async (adresse, signal) => {
    pruefungen++;
    const response = await browserSession.fetch(adresse, { signal, credentials: "include" });
    return response.ok && (await response.text()).includes('id="freigegeben"');
  };
  let bestaetigung = controller.oeffnen(provider, url, { pruefen });
  await warte(() => seiteBereit(fenster[0]));
  assert.equal(controller.offen, true);
  const kind = fenster[0];
  const inhalt = seite(kind);
  assert.equal(kind.getParentWindow(), parent); assert.equal(kind.isModal(), true);
  assert.equal(kind.isVisible(), true); assert.equal(inhalt.session, browserSession);
  assert.ok(parent.contentView.children.includes(player), "Player bleibt eingehaengt");
  for (const selector of ["anbieterKopf", "beschreibung", "challenge-form", "anbieterFuss"]) {
    assert.equal(await inhalt.executeJavaScript(`getComputedStyle(document.getElementById(${JSON.stringify(selector)})).visibility`), "visible", selector);
  }
  assert.equal(await inhalt.executeJavaScript("document.getElementById('__elfixVerifizierungStil') === null"), true);
  const prefs = inhalt.getLastWebPreferences();
  assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.webSecurity, true); assert.equal(prefs.webviewTag, false); assert.ok(!prefs.preload);
  assert.equal(await inhalt.executeJavaScript("typeof require"), "undefined");
  assert.equal(await inhalt.executeJavaScript("typeof window.elfix"), "undefined");
  assert.equal(await inhalt.executeJavaScript("document.getElementById('zurueckZumPlayer') === null"), true,
    "Untrusted Seite besitzt weder die Rueckkehrsteuerung noch eine Bridge");
  const leiste = kind.webContents;
  await warte(() => leiste.executeJavaScript("Boolean(document.getElementById('zurueckZumPlayer'))"));
  assert.ok(leiste.getURL().startsWith("file:"));
  assert.notEqual(leiste.session, inhalt.session);
  const lokalPrefs = leiste.getLastWebPreferences();
  assert.equal(lokalPrefs.sandbox, true); assert.equal(lokalPrefs.contextIsolation, true);
  assert.equal(lokalPrefs.nodeIntegration, false); assert.ok(!lokalPrefs.preload);
  assert.equal(await leiste.executeJavaScript("typeof window.elfix"), "undefined");
  assert.equal(kind.contentView.children.find(v => v.webContents === inhalt).getBounds().y, 52);
  if (process.env.ELFIX_ANBIETER_BILD === "1") {
    // webContents.capturePage erfasst nur den lokalen Renderer, nicht seine
    // Geschwister-Views. Fuer das echte zusammengesetzte Fenster OS-Capture.
    const quellen = await desktopCapturer.getSources({ types: ["window"], fetchWindowIcons: false,
      thumbnailSize: { width: 1600, height: 1200 } });
    const nativeAufnahme = quellen.find(quelle => quelle.id === kind.getMediaSourceId())?.thumbnail;
    const bild = nativeAufnahme && !nativeAufnahme.isEmpty() ? nativeAufnahme : await inhalt.capturePage();
    assert.equal(bild.isEmpty(), false);
    const pfad = path.join(__dirname, "../build/history-perf/provider-overlay/anbieteransicht.png");
    fs.mkdirSync(path.dirname(pfad), { recursive: true }); fs.writeFileSync(pfad, bild.toPNG());
    console.log((nativeAufnahme ? "Screenshot Fenster: " : "OS-Aufnahme nicht verfuegbar; Screenshot Anbieter-Renderer: ") + pfad);
    if (!nativeAufnahme) {
      const lokaleAufnahme = await leiste.capturePage({ x: 0, y: 0, width: kind.getContentSize()[0], height: 52 });
      fs.writeFileSync(path.join(path.dirname(pfad), "rueckkehrleiste.png"), lokaleAufnahme.toPNG());
    }
  }
  assert.equal(controller.oeffnen(provider, url, { pruefen }), bestaetigung, "Erneuter Klick hat dasselbe Fenster und Ergebnis");
  assert.equal(fenster.length, 1); assert.equal(pruefungen, 0, "Kein unsichtbarer Vorababruf vor dem Oeffnen");
  // Keine Fake-Bestaetigung durch Entfernen des DOMs oder blosses Schliessen.
  await inhalt.executeJavaScript("document.getElementById('challenge-form').remove()");
  await warte(() => Promise.resolve(pruefungen === 1));
  assert.equal(controller.offen, true, "Server verweigert weiterhin trotz entferntem Widget");
  await inhalt.executeJavaScript("window.onbeforeunload=()=>{return 'Seite behalten'};true");
  kind.close(); assert.equal(await bestaetigung, "geschlossen", "Natives X uebergeht beforeunload und bestaetigt nichts");

  bestaetigung = controller.oeffnen(provider, url, { pruefen });
  const zweite = fenster[1];
  await warte(() => seiteBereit(zweite));
  await seite(zweite).executeJavaScript("window.onbeforeunload=()=>{return 'Seite behalten'};true");
  seite(zweite).sendInputEvent({ type: "keyDown", keyCode: "ESC" });
  seite(zweite).sendInputEvent({ type: "keyUp", keyCode: "ESC" });
  assert.equal(await bestaetigung, "geschlossen", "Escape schliesst nur Anbieterfenster");

  bestaetigung = controller.oeffnen(provider, url, { pruefen });
  const dritte = fenster[2];
  await warte(() => seiteBereit(dritte));
  // Echter Nutzerklick der lokalen Fixture: Cookie und Freigabe kommen vom Server.
  await seite(dritte).executeJavaScript("document.getElementById('bestaetigen').click()", true);
  assert.equal(await bestaetigung, "bestaetigt");
  assert.equal((await browserSession.cookies.get({ url })).find(c => c.name === "cf_clearance")?.value, "lokale-bestaetigung");
  const antwort = await browserSession.fetch(url); assert.ok((await antwort.text()).includes('id="freigegeben"'));
  assert.equal(player.webContents.getURL(), playerUrl); assert.equal(geladen, 0);
  assert.equal(await js("video.currentTime"), 12.5); assert.equal(await js("video.paused"), true);
  assert.equal(await js("window.sessionId"), "bestehende-watchparty");

  bestaetigung = controller.oeffnen(provider, url, { pruefen });
  const freie = fenster[3];
  await warte(() => seiteBereit(freie));
  assert.equal(controller.offen, true, "Auch schon freie Anbieter bleiben vollstaendig sichtbar");
  // Navigation und Umbauten der fremden Webseite erreichen die feste lokale
  // Rueckkehrleiste nicht. Ihr echter Klick schliesst nur dieses Modal.
  const leistenUrl = freie.webContents.getURL();
  await seite(freie).loadURL(basis + "/andere-seite");
  await seite(freie).executeJavaScript("document.body.innerHTML='<h1>Andere Anbieterseite</h1>';true");
  assert.equal(freie.webContents.getURL(), leistenUrl);
  assert.equal(await freie.webContents.executeJavaScript("getComputedStyle(document.getElementById('zurueckZumPlayer')).display !== 'none'"), true);
  await freie.webContents.executeJavaScript("document.getElementById('zurueckZumPlayer').click()", true).catch(error => {
    if (!freie.isDestroyed()) throw error;
  });
  assert.equal(await bestaetigung, "geschlossen", "Zurueck zum Player funktioniert nach fremder Seitennavigation");
  assert.equal(player.webContents.getURL(), playerUrl); assert.equal(geladen, 0);
  assert.equal(await js("video.currentTime"), 12.5); assert.equal(await js("window.sessionId"), "bestehende-watchparty");
  const abbruch = new AbortController();
  bestaetigung = controller.oeffnen(provider, url, { signal: abbruch.signal, pruefen });
  await warte(() => seiteBereit(fenster[4]));
  abbruch.abort(); assert.equal(await bestaetigung, "geschlossen");
  assert.equal(controller.offen, false);
  console.log("OK Echter Electron: vollstaendige native Anbieteransicht ueber bestehendem Player, gleiche Sitzung, Serverbeleg, X/Esc/Abort, beforeunload, Security, unveraenderte URL/Position/Watchparty");
}).then(() => ende(0), error => ende(1, error));
function ende(code, error) {
  if (error) console.error(error);
  clearTimeout(frist); controller?.schliessen();
  if (player?.webContents && !player.webContents.isDestroyed()) player.webContents.close();
  if (parent && !parent.isDestroyed()) parent.destroy();
  server?.close(); app.exit(code);
}
