"use strict";
const { app, BrowserWindow, WebContentsView, session } = require("electron");
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http"), vm = require("node:vm");
const ansicht = require("../src/anbieteransicht"), tor = require("../src/verifizierungstor");
const direktquelle = require("../src/direktquelle"), direktlauf = require("../src/direktlauf");
const direktbeobachtung = require("../src/direktbeobachtung"), streamspur = require("../src/streamspur");
const direktlinks = require("../src/direktlinks");
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "elfix-anbieterweiter-")));
app.disableHardwareAcceleration();
const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
const funktion = name => { const start = main.search(new RegExp("(?:async )?function " + name + "\\(")); assert.ok(start >= 0, name); return main.slice(start, main.indexOf("\n}", start) + 2); };
let parent, player, controller, server, gehalten, c;
const frist = setTimeout(() => ende(1, Error("Weiter-Test Zeitlimit")), 45000);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function warte(fn) { const bis = Date.now() + 6000; while (Date.now() < bis) { if (await fn()) return; await pause(25); } throw Error("Weiter-Test: Zustand fehlt"); }
const manifest = "#EXTM3U\n#EXT-X-TARGETDURATION:600\n#EXTINF:600,\nfilm1.ts\n#EXTINF:600,\nfilm2.ts\n#EXTINF:600,\nfilm3.ts\n#EXT-X-ENDLIST\n";
app.whenReady().then(async () => {
  let basis, weiterAbrufe = 0, manifestAbrufe = 0;
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://fixture.test"), mode = url.searchParams.get("mode") || "xhr";
    if (url.pathname === "/release") {
      weiterAbrufe++; res.setHeader("set-cookie", "released=fixture; Path=/; SameSite=Lax"); res.end("freigegeben"); return;
    }
    if (url.pathname === "/film.m3u8") {
      manifestAbrufe++;
      if (!String(req.headers.cookie || "").includes("released=fixture")) { res.writeHead(403); res.end("Challenge"); return; }
      if (mode === "delay") { gehalten = res; return; }
      res.setHeader("content-type", "application/vnd.apple.mpegurl");
      res.end(mode === "short" ? manifest.replaceAll("600", "10") : manifest); return;
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (url.pathname === "/voe-fixture") {
      res.end(`<html><body><div>Hoster: Player noch nicht gestartet</div><script>window.sources=[{file:"${basis}/film.m3u8?mode=${mode}"}];</script></body></html>`); return;
    }
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Folge</title><style>
      body{margin:0;background:#d33;color:white;font:18px Arial}header,aside{padding:50px;background:#f03}
      .modal{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:1050}
      .modal-dialog{width:560px;max-width:calc(100vw - 36px);transform:translateZ(0)}
      .modal-content{background:#1d2029;border-radius:12px;box-shadow:0 10px 50px #0008}
      .modal-header,.modal-body,.modal-footer{padding:22px}.modal-footer{border-top:1px solid #414650}
      .cf-turnstile{padding:18px;background:#f4f4f4;color:#172b20}button{width:100%;padding:16px;border:0;border-radius:6px;background:#629a75;color:white;font:18px Arial}
      </style></head><body><header id="aussen">POSTER UND ANBIETER-NAVIGATION</header><aside>HOSTERLISTE DARF NICHT SICHTBAR SEIN</aside>
      <div class="modal"><div class="modal-dialog"><section class="modal-content" role="dialog">
      <div class="modal-header"><h2>Video wird vorbereitet...</h2></div><div class="modal-body"><div class="cf-turnstile">✓ Erfolgreich</div><input name="cf-turnstile-response" value="fixture-token" type="hidden"></div>
      <div class="modal-footer"><button id="weiter">Weiter</button></div></section></div></div>
      <script>document.getElementById('weiter').onclick=async(event)=>{
        window.fixtureEingabe={x:event.clientX,y:event.clientY,trusted:event.isTrusted};
        await fetch('/release?mode=${mode}');
        ${["iframe", "short"].includes(mode) ? `document.querySelector('.modal').remove();const f=document.createElement('iframe');f.src='/voe-fixture?mode=${mode}';document.body.append(f);`
          : mode === "none" ? "document.querySelector('.modal').remove();document.body.append('Nur freies HTML, kein Stream');"
            : `await fetch('/film.m3u8?mode=${mode}');`}
      };</script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); basis = `http://127.0.0.1:${server.address().port}`;
  const browserSession = session.fromPartition("persist:anbieterweiter");
  parent = new BrowserWindow({ show: true, width: 1050, height: 790 });
  await parent.loadURL("data:text/html,<body>ELFIX Fixture</body>");
  player = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true } });
  parent.contentView.addChildView(player); player.setBounds({ x: 0, y: 0, width: 1050, height: 790 });
  await player.webContents.loadURL("data:text/html,<body>ELFIX vorhandener Player<script>window.watchparty='gleiche-runde';window.position=37</script></body>");
  const playerUrl = player.webContents.getURL(), fenster = [], uebernahmen = [], abgleiche = [];
  controller = ansicht.erstellen({ BrowserWindow: function(options) { const win = new BrowserWindow(options); fenster.push(win); return win; },
    WebContentsView, eltern: () => parent, sitzung: () => browserSession,
    zustandScript: tor.zustandScript, maskeScript: tor.dialogMaskeScript,
    persistieren: sitzung => sitzung.cookies.flushStore() });
  const provider = { id: "sto", name: "S.to", startUrl: basis };
  let commitFreigeben = null, commitWartet = false;
  c = vm.createContext({ browserSession, direktAnbieterFallback: { aktuell: null }, direktLaden: new AbortController(),
    spielerLauf: null, spielerTakt: { stelle: 37 }, menschentorFenster: null, anbieterSeitenAnsicht: controller,
    episodeIdentity: url => url.includes("/episode") ? ({ season: 1, episode: 2 }) : null,
    isExpectedEpisodePage: (a, b) => a === b, seiteGleich: (a, b) => a === b,
    shouldBlockProviderNavigation: ziel => !ziel.startsWith(basis),
    direktBeobachter: new Map(), direktquelle, direktlauf, direktbeobachtung, streamspur, direktlinks,
    providerModel: { isHttpUrl: url => /^https?:/.test(url), hostFromUrl: url => new URL(url).hostname },
    isLiveView: view => !view.webContents.isDestroyed(),
    isKnownVideoHosterUrl: url => url.includes("/voe-fixture"),
    direktAufloeserHolen: () => direktlauf.erstellen({ holen: (url, options) => browserSession.fetch(url, options), kennung: browserSession.getUserAgent() }),
    executeJavaScriptInMediaFrames: async (view, script) => {
      const frames = [view.webContents.mainFrame, ...view.webContents.mainFrame.frames];
      return (await Promise.all(frames.map(frame => frame.executeJavaScript(script).catch(() => null)))).filter(Boolean);
    },
    sanitizePositiveNumber: zahl => Math.max(0, Number(zahl) || 0),
    watchpartyLiveKeyForUrl: () => "fixture", watchpartyRaumForUrl: () => "gleiche-runde", isContentFullscreen: false,
    watchpartyZustandUebernehmen: url => abgleiche.push(url),
    direktSpielerOeffnen: async (_provider, url, ergebnis, optionen) => {
      commitWartet = true;
      c.spielerLauf = { ...c.spielerLauf, id: c.spielerLauf.id + 1, quelle: ergebnis.quelle, link: ergebnis.link, hoster: ergebnis.hoster, hosterliste: ergebnis.hosterliste };
      if (commitFreigeben) await new Promise(resolve => { commitFreigeben = resolve; });
      if (optionen.signal.aborted) return false;
      uebernahmen.push({ url, ergebnis, optionen });
      await player.webContents.executeJavaScript(`window.freigegebeneQuelle=${JSON.stringify(ergebnis.quelle.adresse)}`);
      return true;
    }, anbieterAbruf: (url, options) => browserSession.fetch(url, options),
    istCloudflareAbfrage: () => false, AbortController, AbortSignal, URL, Date
  });
  vm.runInContext(["direktAuftragBeginnen", "anbieterQuelleBeobachten", "anbieterSeiteOeffnen", "anbieterHosterWahl"].map(funktion).join("\n"), c);
  browserSession.webRequest.onResponseStarted(details => {
    if (details.statusCode >= 200 && details.statusCode < 400) c.direktBeobachter.get(details.webContentsId)?.({ adresse: details.url, rahmen: details.frame?.url || details.referrer || "" });
  });
  const inhalt = win => win.contentView.children.find(view => view.webContents?.session === browserSession).webContents;
  const bereit = async win => {
    await warte(() => inhalt(win).executeJavaScriptInIsolatedWorld(987, [{ code: "Boolean(globalThis.__elfixAnbieterDialog)" }]).catch(() => false));
  };
  async function oeffnen(mode) {
    c.direktLaden.abort(); c.direktLaden = new AbortController();
    const url = basis + "/episode?mode=" + mode;
    c.spielerLauf = { id: 1, providerId: "sto", url, quelle: { adresse: "" }, startzeit: 37,
      rundeWarten: true, rundeUebernehmen: true, hoster: "VOE", link: basis + "/redirect/123",
      hosterliste: [{ adresse: basis + "/redirect/123", hoster: "VOE", sprache: "de" }] };
    const fertig = c.anbieterSeiteOeffnen(provider, url, c.direktLaden.signal);
    const win = fenster.at(-1); await bereit(win);
    return { fertig, win, seite: inhalt(win), url };
  }
  async function klicken(seite) {
    fenster.at(-1).focus();
    await warte(() => Promise.resolve(fenster.at(-1).isFocused()));
    seite.focus();
    const punkt = await seite.executeJavaScript("(()=>{const r=document.getElementById('weiter').getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);return{x,y,hit:document.elementFromPoint(x,y)?.id}})()");
    assert.equal(punkt.hit, "weiter", "Maskierung belaesst den echten Knopf im Hit-Test");
    seite.sendInputEvent({ type: "mouseMove", x: punkt.x, y: punkt.y });
    seite.sendInputEvent({ type: "mouseDown", x: punkt.x, y: punkt.y, button: "left", clickCount: 1 });
    seite.sendInputEvent({ type: "mouseUp", x: punkt.x, y: punkt.y, button: "left", clickCount: 1 });
  }
  let offen = await oeffnen("xhr");
  const geometry = await offen.seite.executeJavaScript("(()=>{const k=document.querySelector('.modal-content'),r=k.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,button:getComputedStyle(document.getElementById('weiter')).visibility,aussen:getComputedStyle(document.getElementById('aussen')).visibility}})()");
  assert.equal(geometry.button, "visible"); assert.equal(geometry.aussen, "hidden");
  assert.equal(await offen.seite.executeJavaScript("(()=>{const s=document.getElementById('__elfixAnbieterMaske');s.remove();const r=document.querySelector('.modal-content').getBoundingClientRect();return Math.abs(r.x-" + geometry.x + ")+Math.abs(r.y-" + geometry.y + ")})()"), 0, "Originalgeometrie unter transformierten Vorfahren bleibt erhalten");
  // Kein Vorababruf, kein automatisch ausgeloester Weiter-/Captcha-Klick.
  assert.equal(weiterAbrufe, 0); assert.equal(uebernahmen.length, 0);
  offen.win.setSize(800, 650);
  await warte(() => offen.seite.executeJavaScript("Boolean(document.getElementById('__elfixAnbieterMaske'))"));
  const resize = await offen.seite.executeJavaScript("(()=>{const r=document.getElementById('weiter').getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()");
  assert.equal(resize, true, "Weiter nach Resize vollstaendig erreichbar");
  if (process.env.ELFIX_ANBIETER_BILD === "1") {
    const ordner = path.join(__dirname, "../build/history-perf/provider-weiter"); fs.mkdirSync(ordner, { recursive: true });
    fs.writeFileSync(path.join(ordner, "dialogmaske.png"), (await offen.seite.capturePage()).toPNG());
    fs.writeFileSync(path.join(ordner, "rueckkehrleiste.png"), (await offen.win.webContents.capturePage({ x: 0, y: 0, width: offen.win.getContentSize()[0], height: 52 })).toPNG());
  }
  commitFreigeben = true;
  const meldungen = [];
  offen.seite.on("console-message", (...args) => { meldungen.push(args.map(wert => wert?.message || (typeof wert === "string" ? wert : "")).filter(Boolean).join(" ")); });
  await klicken(offen.seite);
  await warte(() => Promise.resolve(commitWartet && typeof commitFreigeben === "function")).catch(async error => {
    const dom = await offen.seite.executeJavaScript("JSON.stringify({focus:document.activeElement.id,visible:getComputedStyle(document.getElementById('weiter')).visibility,onclick:typeof document.getElementById('weiter').onclick,ready:document.readyState,width:innerWidth,height:innerHeight})");
    throw Error(error.message + ` (Weiter=${weiterAbrufe}, Manifest=${manifestAbrufe}, Meldungen=${meldungen.join("|")}, DOM=${dom}, focused=${offen.seite.isFocused()})`);
  });
  assert.equal(controller.offen, true, "Modal bleibt bis zum committed Player offen");
  const eingabe = await offen.seite.executeJavaScript("window.fixtureEingabe");
  assert.equal(eingabe.trusted, true, "Echte lokale Eingabe, kein JS-click");
  const hit = await offen.seite.executeJavaScript(`document.elementFromPoint(${eingabe.x},${eingabe.y})?.id`);
  assert.equal(hit, "weiter", "Native Inputkoordinaten sind Viewkoordinaten, ohne 52px-Leistenoffset");
  commitFreigeben(); commitFreigeben = null;
  assert.equal(await offen.fertig, "uebernommen");
  assert.equal(uebernahmen.length, 1); assert.equal(uebernahmen[0].url, offen.url);
  assert.equal(uebernahmen[0].optionen.startzeit, 37); assert.equal(uebernahmen[0].optionen.rundeWarten, true);
  assert.equal(uebernahmen[0].ergebnis.hosterliste[0].sprache, "de"); assert.equal(abgleiche.length, 1);
  c.fassung = { bezeichnung: wert => wert };
  let erneut = 0; c.direktFolgeSpielen = () => { erneut++; };
  vm.runInContext(["fassungsname", "linkFuerFassung", "fassungAusRundeSetzen"].map(funktion).join("\n"), c);
  await c.fassungAusRundeSetzen("de", "VOE"); assert.equal(erneut, 0, "Gleiches Runden-Fassungsupdate startet keinen neuen Resolver");

  offen = await oeffnen("iframe"); await klicken(offen.seite);
  assert.equal(await offen.fertig, "uebernommen", "Frisch freigegebener Hosteriframe ohne Play wird aufgeloest");
  assert.equal(uebernahmen.length, 2); assert.ok(manifestAbrufe >= 2);
  for (const mode of ["none", "short"]) {
    offen = await oeffnen(mode); const abrufe = weiterAbrufe; await klicken(offen.seite);
    await warte(() => Promise.resolve(weiterAbrufe > abrufe));
    await warte(() => offen.seite.executeJavaScript("!document.querySelector('.modal')"));
    await warte(() => offen.seite.executeJavaScript("document.getElementById('__elfixAnbieterMaske') === null"));
    assert.equal(controller.offen, true); assert.equal(uebernahmen.length, 2, "HTML-Freigabe/kurze Werbung uebernimmt keinen Film");
    offen.win.close(); assert.equal(await offen.fertig, "geschlossen");
  }
  offen = await oeffnen("delay"); await klicken(offen.seite); await warte(() => Promise.resolve(Boolean(gehalten)));
  c.direktLaden.abort(); c.spielerLauf = { id: 99, providerId: "sto", url: basis + "/episode-neu", quelle: { adresse: "neue-quelle" } };
  assert.equal(await offen.fertig, "geschlossen"); gehalten.end(manifest); gehalten = null;
  assert.equal(uebernahmen.length, 2); assert.equal(c.spielerLauf.id, 99);
  assert.equal(player.webContents.getURL(), playerUrl); assert.equal(await player.webContents.executeJavaScript("window.position"), 37);
  assert.equal(await player.webContents.executeJavaScript("window.watchparty"), "gleiche-runde");
  console.log("OK Echter Electron: Originaldialog+Weiter maskiert, Transform/Resize, echter Klick->XHR/Hosteriframe->servergepruefte Quelle->Player vor Close, kein Stream/kurze Werbung/Abort/alte Folge sicher");
}).then(() => ende(0), error => ende(1, error));
function ende(code, error) { if (error) console.error(error); clearTimeout(frist); gehalten?.end(); controller?.schliessen(); if (player?.webContents && !player.webContents.isDestroyed()) player.webContents.close(); if (parent && !parent.isDestroyed()) parent.destroy(); server?.close(); app.exit(code); }
