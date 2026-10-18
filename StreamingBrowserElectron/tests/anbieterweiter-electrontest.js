"use strict";
const { app, BrowserWindow, WebContentsView, session, webContents, desktopCapturer } = require("electron");
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
async function nativeAufnahme(win, punkte = []) {
  const [width, height] = win.getSize();
  // Windows-Fensteraufnahme umfasst die nativen Geschwister-Views. PrintWindow
  // liefert hier nur den weissen Host-Renderer, keine zusammengesetzte Ansicht.
  let bild;
  await warte(async () => {
    const quellen = await desktopCapturer.getSources({ types: ["window"], fetchWindowIcons: false,
      thumbnailSize: { width, height } });
    bild = quellen.find(quelle => quelle.id === win.getMediaSourceId())?.thumbnail;
    if (!bild || bild.isEmpty()) return false;
    const [clientBreite, clientHoehe] = win.getContentSize(), size = bild.getSize();
    const faktor = size.width / clientBreite;
    const bitmap = bild.toBitmap({ scaleFactor: 1 });
    return punkte.every(punkt => {
      const x = Math.round(punkt.x * faktor), y = Math.round(size.height - clientHoehe * faktor + punkt.y * faktor);
      const pixel = bitmap.subarray((y * size.width + x) * 4, (y * size.width + x) * 4 + 3);
      return pixel.length === 3 && punkt.farbe.every((wert, i) => Math.abs(pixel[i] - wert) <= 3);
    });
  });
  return bild;
}
async function nativeBild(win, pfad, punkt) {
  const bild = await nativeAufnahme(win, punkt ? [{ ...punkt, farbe: [117, 154, 98] }] : []);
  fs.writeFileSync(pfad, bild.toPNG());
}

const manifest = "#EXTM3U\n#EXT-X-TARGETDURATION:600\n#EXTINF:600,\nfilm1.ts\n#EXTINF:600,\nfilm2.ts\n#EXTINF:600,\nfilm3.ts\n#EXT-X-ENDLIST\n";
app.whenReady().then(async () => {
  let basis, weiterAbrufe = 0, manifestAbrufe = 0;
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://fixture.test"), mode = url.searchParams.get("mode") || "xhr";
    if (url.pathname === "/r") {
      weiterAbrufe++; res.setHeader("set-cookie", "released=fixture; Path=/; SameSite=Lax");
      res.setHeader("content-type", "text/html; charset=utf-8");
      if (["iframe", "short"].includes(mode)) { res.writeHead(302, { location: "/voe-fixture?mode=" + mode }); res.end(); }
      else if (mode === "none") res.end("Nur freies HTML, kein Stream");
      else if (mode === "fehler") res.end('<script>const el=parent.document.getElementById("player-prepare-error");el.textContent="Die Bestätigung ist abgelaufen. Bitte erneut bestätigen.";el.style.display="block";</script>');
      else if (mode === "erneut") res.end('<script>parent.document.getElementById("player-prepare-token").value="";parent.document.getElementById("player-prepare-turnstile").style.display="none";parent.document.getElementById("player-prepare-altcha").style.display="flex";</script>');
      else res.end(`<script>parent.document.getElementById('player-prepare-token').value='';fetch('/film.m3u8?mode=${mode}')</script>`);
      return;
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
    if (mode === "unbekannt") { res.end('<html><body><header>Ganze Anbieterseite</header><main style="max-width:760px"><h5>Video wird vorbereitet...</h5><p>Normale Anbieterseite ohne Dialog</p><button>Weiter</button></main></body></html>'); return; }
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Folge</title><style>
      body{margin:0;background:#d33;color:white;font:18px Arial}header,aside{padding:50px;background:#f03}
      .modal{position:fixed;inset:0;z-index:1050;overflow-y:auto}.modal-dialog{position:relative;width:auto;max-width:500px;margin:28px auto;transform:translateZ(0)}
      .modal-dialog-centered{display:flex;align-items:center;min-height:calc(100% - 56px)}
      .modal-content{position:relative;width:100%;background:#161e29;border:1px solid #495057;border-radius:8px;box-shadow:0 10px 50px #0008}
      .modal-header,.modal-body{padding:16px}h5{font-size:20px;margin:0}.modal-header{border-bottom:1px solid #495057}p{font-size:14px;line-height:1.5;margin:0 0 16px;color:#abb5c0}
      #player-prepare-turnstile,#player-prepare-altcha{display:flex;justify-content:center;height:66px;margin-bottom:16px}
      #player-prepare-error{color:#fb8a8a;font-size:14px;margin-bottom:14px}button{width:100%;padding:12px;border:0;border-radius:6px;background:#629a75;color:white;font:16px Arial}
      </style></head><body><header id="aussen">POSTER UND ANBIETER-NAVIGATION</header><aside>HOSTERLISTE DARF NICHT SICHTBAR SEIN</aside>
      <iframe id="player-iframe" name="player-iframe"></iframe>
      <div class="modal fade show" id="playerPrepareModal" tabindex="-1" aria-labelledby="playerPrepareModalLabel" aria-hidden="false">
        <div class="modal-dialog modal-dialog-centered"><div class="modal-content border-secondary">
          <div class="modal-header border-secondary"><h5 class="modal-title" id="playerPrepareModalLabel">Video wird vorbereitet...</h5></div>
          <div class="modal-body"><p>Das dauert nur einen Moment. Schließe den Schritt unten ab und tippe dann auf Weiter, um den Stream zu öffnen.</p>
            <div id="player-prepare-error" style="display:none"></div>
            <form id="player-prepare-form" method="POST" action="/r?mode=${mode}" target="player-iframe">
              <input type="hidden" name="t" id="player-prepare-token" value="fixture-token">
              <div id="player-prepare-turnstile" class="d-flex justify-content-center mb-3"></div>
              <div id="player-prepare-altcha" class="d-flex justify-content-center mb-3" style="display:none"></div>
              <button id="weiter" type="submit">Weiter</button>
            </form>
          </div>
        </div></div>
      </div>
      <script>
        ${mode === 'spaet' ? "document.getElementById('playerPrepareModal').style.display='none';" : ''}
        document.getElementById('player-prepare-turnstile').attachShadow({mode:'closed'}).innerHTML='<style>:host{background:#f4f4f4;color:#173320;align-items:center;width:300px;border-radius:4px}</style><span>✓ Erfolgreich</span>';
        document.getElementById('weiter').onclick=event=>{window.fixtureEingabe={x:event.clientX,y:event.clientY,trusted:event.isTrusted}};
        document.getElementById('player-prepare-form').onsubmit=()=>{${["none", "short"].includes(mode) ? "document.querySelector('.modal').style.display='none';" : ""}};
      </script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); basis = `http://127.0.0.1:${server.address().port}`;
  const browserSession = session.fromPartition("persist:anbieterweiter");
  parent = new BrowserWindow({ show: true, width: 1050, height: 790 });
  await parent.loadURL("data:text/html,<body>ELFIX Fixture</body>");
  player = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true } });
  parent.contentView.addChildView(player); player.setBounds({ x: 0, y: 0, width: 1050, height: 790 });
  await player.webContents.loadURL("data:text/html,<body>ELFIX vorhandener Player<script>window.watchparty='gleiche-runde';window.position=37</script></body>");
  const playerUrl = player.webContents.getURL(), ansichten = [], uebernahmen = [], abgleiche = [];
  let bereich = null;
  controller = ansicht.erstellen({ grenzen: () => bereich, WebContentsView: function(options) { const view = new WebContentsView(options); ansichten.push(view); return view; }, eltern: () => parent, sitzung: () => browserSession,
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
  const inhalt = () => webContents.getAllWebContents().find(inhalt => inhalt.session === browserSession && !inhalt.isDestroyed());
  const phase = win => win.executeJavaScript("document.body.dataset.phase");
  const bereit = async win => {
    await warte(() => inhalt(win).executeJavaScriptInIsolatedWorld(987, [{ code: "Boolean(globalThis.__elfixAnbieterDialog)" }]).catch(() => false));
    await warte(async () => (await phase(win)) === "dialog");
  };
  async function oeffnen(mode) {
    c.direktLaden.abort(); c.direktLaden = new AbortController();
    const url = basis + "/episode?mode=" + mode;
    c.spielerLauf = { id: 1, providerId: "sto", url, quelle: { adresse: "" }, startzeit: 37,
      rundeWarten: true, rundeUebernehmen: true, hoster: "VOE", link: basis + "/redirect/123",
      hosterliste: [{ adresse: basis + "/redirect/123", hoster: "VOE", sprache: "de" }] };
    const fertig = c.anbieterSeiteOeffnen(provider, url, c.direktLaden.signal);
    assert.equal(ansichten.at(-1).getVisible(), false, "Provider bleibt vor fertiger Maske und erstem lokalen Paint nativ verborgen");
    const win = parent, decke = ansichten.at(-2), leiste = decke.webContents;
    if (["unbekannt", "spaet"].includes(mode)) await warte(() => inhalt().executeJavaScript("Boolean(document.getElementById('__elfixAnbieterAbdeckung'))"));
    else await bereit(leiste);
    return { fertig, win, decke, leiste, view: ansichten.at(-1), seite: inhalt(), url };
  }
  async function klicken(seite) {
    parent.focus();
    await warte(() => Promise.resolve(parent.isFocused()));
    seite.focus();
    const punkt = await seite.executeJavaScript("(()=>{const r=document.getElementById('weiter').getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);return{x,y,hit:document.elementFromPoint(x,y)?.id}})()");
    assert.equal(punkt.hit, "weiter", "Maskierung belaesst den echten Knopf im Hit-Test");
    seite.sendInputEvent({ type: "mouseMove", x: punkt.x, y: punkt.y });
    seite.sendInputEvent({ type: "mouseDown", x: punkt.x, y: punkt.y, button: "left", clickCount: 1 });
    seite.sendInputEvent({ type: "mouseUp", x: punkt.x, y: punkt.y, button: "left", clickCount: 1 });
  }
  async function lokalKlicken(win, id) {
    parent.focus(); await warte(() => Promise.resolve(parent.isFocused())); win.focus();
    const punkt = await win.executeJavaScript(`(()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    win.sendInputEvent({ type: "mouseMove", ...punkt });
    win.sendInputEvent({ type: "mouseDown", ...punkt, button: "left", clickCount: 1 });
    win.sendInputEvent({ type: "mouseUp", ...punkt, button: "left", clickCount: 1 });
  }
  let offen = await oeffnen("xhr");
  const geometry = await offen.seite.executeJavaScript("(()=>{const k=document.querySelector('.modal-content'),r=k.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,button:getComputedStyle(document.getElementById('weiter')).visibility,aussen:getComputedStyle(document.getElementById('aussen')).visibility}})()");
  assert.equal(geometry.button, "visible"); assert.equal(geometry.aussen, "visible", "Anbieterseite bleibt unveraendert unter dem Overlay");
  assert.equal(await offen.seite.executeJavaScript(tor.zustandScript()).then(lage => lage.offen), false,
    "Echte S.to-Struktur ohne cf-turnstile-Klasse/mit geschlossenem ShadowDOM wird semantisch erkannt");
  assert.equal(BrowserWindow.getAllWindows().length, 1, "Anbieteransicht erzeugt kein zusaetzliches Fenster");
  assert.equal(parent.contentView.children.at(-1), offen.decke, "Lokale Rueckkehrleiste liegt ueber dem vorhandenen Player");
  assert.equal(parent.contentView.children.at(-2), offen.view, "Provider liegt unter der lokalen deckenden Flaeche");
  assert.ok(parent.contentView.children.includes(player));
  async function overlayPruefen(seite) {
    // Native Bounds und der DOM-Resize werden nacheinander zugestellt.
    // Die Pixelpruefung gilt fuer den tatsaechlich praesentierten Frame.
    await seite.executeJavaScript("Promise.race([new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true)))),new Promise((_,reject)=>setTimeout(()=>reject(Error('Sichtbare Anbieteransicht praesentiert keinen Frame')),5000))])");
    const pruefung = await seite.executeJavaScript(`(() => {
      const r=document.querySelector('.modal-content').getBoundingClientRect();
      const punkte=[[innerWidth/2,r.top/2],[innerWidth/2,(r.bottom+innerHeight)/2],
        [r.left/2,(r.top+r.bottom)/2],[(r.right+innerWidth)/2,(r.top+r.bottom)/2]];
      return {abgedeckt:punkte.every(([x,y])=>{const el=document.elementFromPoint(x,y),s=el&&getComputedStyle(el);
        return el?.parentElement?.id==='__elfixAnbieterAbdeckung'&&s.backgroundColor==='rgb(11, 17, 26)'&&s.opacity==='1';}),
        weiter:(()=>{const b=document.getElementById('weiter').getBoundingClientRect();return{x:b.left+10,y:b.top+b.height/2}})(),
        ecken:[[Math.ceil(r.left),Math.ceil(r.top)],[Math.floor(r.right)-1,Math.ceil(r.top)],
          [Math.ceil(r.left),Math.floor(r.bottom)-1],[Math.floor(r.right)-1,Math.floor(r.bottom)-1]]};
    })()`);
    assert.equal(pruefung.abgedeckt, true, "Vier undurchsichtige Overlayflaechen verdecken und blockieren die Umgebung");
    // capturePage veraendert in Electron den HiddenButPainting-Zustand und
    // kann die native Surface selbst zerstoeren. Die echten Fensterpixel
    // belegen sowohl deckende Dialogecken als auch den sichtbaren Weiterknopf.
    const bounds = parent.contentView.children.find(view => view.webContents === seite).getBounds();
    await nativeAufnahme(parent, [
      ...pruefung.ecken.map(([x, y]) => ({ x: bounds.x + x, y: bounds.y + y, farbe: [26, 17, 11] })),
      { x: bounds.x + pruefung.weiter.x, y: bounds.y + pruefung.weiter.y, farbe: [117, 154, 98] }
    ]);
  }
  await overlayPruefen(offen.seite);
  parent.contentView.addChildView(player); controller.anordnen();
  assert.equal(parent.contentView.children.at(-1), offen.decke, "Neue Player-Z-Order behaelt die lokale Rueckkehrleiste oben");
  assert.equal(parent.contentView.children.at(-2), offen.view, "Anordnen hebt den freigegebenen Provider wieder ueber den Player");
  await overlayPruefen(offen.seite);
  assert.equal(await offen.seite.executeJavaScript("(()=>{document.getElementById('__elfixAnbieterMaske').remove();document.getElementById('__elfixAnbieterAbdeckung').remove();const r=document.querySelector('.modal-content').getBoundingClientRect();return Math.abs(r.x-" + geometry.x + ")+Math.abs(r.y-" + geometry.y + ")})()"), 0, "Originalgeometrie unter transformierten Vorfahren bleibt erhalten");
  bereich = { x: 20, y: 40, width: 900, height: 600 };
  controller.anordnen();
  assert.deepEqual(offen.decke.getBounds(), { ...bereich, height: 52 }, "Overlay folgt exakt der eingebetteten Playerflaeche");
  assert.deepEqual(await offen.seite.executeJavaScript("[innerWidth,innerHeight]"), [900,548]);
  await overlayPruefen(offen.seite);
  bereich = null; controller.anordnen();
  // Kein Vorababruf, kein automatisch ausgeloester Weiter-/Captcha-Klick.
  assert.equal(weiterAbrufe, 0); assert.equal(uebernahmen.length, 0);
  offen.win.setSize(800, 650);
  await warte(() => offen.seite.executeJavaScript("Boolean(document.getElementById('__elfixAnbieterMaske'))"));
  const resize = await offen.seite.executeJavaScript("(()=>{const r=document.getElementById('weiter').getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()");
  assert.equal(resize, true, "Weiter nach Resize vollstaendig erreichbar");
  assert.deepEqual(await offen.seite.executeJavaScript("[innerWidth,innerHeight]"),
    [offen.win.getContentSize()[0], offen.win.getContentSize()[1]-52], "Provider nimmt weiterhin die volle Fensterflaeche ein");
  await overlayPruefen(offen.seite);
  if (process.env.ELFIX_ANBIETER_BILD === "1") {
    const ordner = path.join(__dirname, "../build/history-perf/provider-weiter"); fs.mkdirSync(ordner, { recursive: true });
    const punkt = await offen.seite.executeJavaScript("(()=>{const r=document.getElementById('weiter').getBoundingClientRect();return{x:r.left+10,y:r.top+r.height/2}})()");
    const bounds = offen.view.getBounds();
    await nativeBild(offen.win, path.join(ordner, "anbieter-overlay-nativ.png"), { x: bounds.x + punkt.x, y: bounds.y + punkt.y });
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
  assert.equal(await offen.seite.executeJavaScript("document.getElementById('player-prepare-token').value"), "",
    "Normaler erfolgreicher POST verbraucht das Redirect-Ticket t");
  assert.equal(await offen.seite.executeJavaScript("getComputedStyle(document.getElementById('playerPrepareModal')).display !== 'none'"), true,
    "Leeres Redirect-Ticket bei weiterhin sichtbarem Dialog stoppt die Quellenuebernahme nicht");
  assert.equal(await phase(offen.leiste), "laden");
  assert.equal(offen.view.getVisible(), false, "Fremde Provideransicht nach echtem Weiter vollstaendig abgedeckt");
  assert.equal(offen.decke.getBounds().height, parent.getContentSize()[1], "Ladeansicht deckt den ganzen Playerbereich wieder ab");
  assert.equal(await offen.leiste.executeJavaScript("document.getElementById('anbieterStatusTitel').textContent"), "Video wird geladen …");
  assert.equal(await offen.leiste.executeJavaScript("document.querySelector('[role=progressbar]').hasAttribute('aria-valuenow')"), false,
    "Indeterminierte Ladeleiste erfindet keine Prozentwerte");
  if (process.env.ELFIX_ANBIETER_BILD === "1") await nativeBild(offen.win, path.join(__dirname, "../build/history-perf/provider-weiter/video-laden-nativ.png"));
  await lokalKlicken(offen.leiste, "anbieterDialogAnzeigen");
  await warte(async () => (await phase(offen.leiste)) === "dialog");
  assert.equal(offen.view.getVisible(), true, "Lokaler Retryzugang zeigt ausschliesslich den erhaltenen Originaldialog");
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

  offen = await oeffnen("spaet");
  assert.equal(offen.view.getVisible(), false, "Spaeter Dialog laesst die rohe Seite nie vorab erscheinen");
  assert.equal(await offen.seite.executeJavaScript("document.getElementById('__elfixAnbieterAbdeckung').children.length"), 1);
  const vorPaint = await offen.seite.executeJavaScript(`(async()=>{
    document.getElementById('playerPrepareModal').style.display='';
    await Promise.resolve();
    const el=document.elementFromPoint(3,3);
    return el?.parentElement?.id==='__elfixAnbieterAbdeckung';
  })()`);
  assert.equal(vorPaint, true, "DOM-Observer deckt Umgebung synchron vor dem ersten Dialog-Paint ab");
  await bereit(offen.leiste);
  await overlayPruefen(offen.seite);
  const nachSchluss = await offen.seite.executeJavaScript(`(async()=>{
    document.getElementById('playerPrepareModal').style.display='none';
    await Promise.resolve();
    const r=document.elementFromPoint(innerWidth/2,innerHeight/2);
    return r?.parentElement?.id==='__elfixAnbieterAbdeckung';
  })()`);
  assert.equal(nachSchluss, true, "Dialogschluss hinterlaesst kein unmaskiertes Loch bis zum naechsten Poll");
  controller.schliessen(); assert.equal(await offen.fertig, "geschlossen");

  offen = await oeffnen("iframe"); await klicken(offen.seite);
  assert.equal(await offen.fertig, "uebernommen", "Frisch freigegebener Hosteriframe ohne Play wird aufgeloest");
  assert.equal(uebernahmen.length, 2); assert.ok(manifestAbrufe >= 2);
  for (const mode of ["none", "short"]) {
    offen = await oeffnen(mode); const abrufe = weiterAbrufe; await klicken(offen.seite);
    await warte(() => Promise.resolve(weiterAbrufe > abrufe));
    await warte(() => offen.seite.executeJavaScript("getComputedStyle(document.querySelector('.modal')).display === 'none'"));
    await warte(() => offen.seite.executeJavaScript("document.getElementById('__elfixAnbieterAbdeckung')?.children.length === 1"));
    assert.equal(controller.offen, true); assert.equal(uebernahmen.length, 2, "HTML-Freigabe/kurze Werbung uebernimmt keinen Film");
    assert.equal(await phase(offen.leiste), "laden"); assert.equal(offen.view.getVisible(), false,
      "Auch ohne Quelle wird nach Weiter keine ganze Anbieter-Seite sichtbar");
    await lokalKlicken(offen.leiste, "zurueckZumPlayer"); assert.equal(await offen.fertig, "geschlossen");
  }
  for (const mode of ["fehler", "erneut"]) {
    offen = await oeffnen(mode); const abrufe = weiterAbrufe; await klicken(offen.seite);
    await warte(() => Promise.resolve(weiterAbrufe > abrufe));
    await warte(async () => (await phase(offen.leiste)) === "dialog");
    assert.equal(offen.view.getVisible(), true, "Providerfehler/neue Bestätigung macht den originalen Dialog wieder erreichbar");
    assert.equal(uebernahmen.length, 2);
    if (mode === "fehler") assert.equal(await offen.seite.executeJavaScript("getComputedStyle(document.getElementById('player-prepare-error')).display !== 'none'"), true);
    controller.schliessen(); assert.equal(await offen.fertig, "geschlossen");
  }
  offen = await oeffnen("unbekannt");
  assert.equal(offen.view.getVisible(), false, "Ohne fertigen Dialog blitzt keine Anbieterseite auf");
  assert.equal(await offen.leiste.executeJavaScript("document.getElementById('anbieterStatus').hidden"), false);
  await lokalKlicken(offen.leiste, "anbieterSeiteAnzeigen");
  await warte(async () => (await phase(offen.leiste)) === "seite");
  assert.equal(offen.view.getVisible(), true, "Ganze Seite ausschliesslich nach ausdruecklicher Nutzerwahl erreichbar");
  await lokalKlicken(offen.leiste, "zurueckZumPlayer");
  assert.equal(await offen.fertig, "geschlossen", "Lokale Rueckkehr auch ohne erkannten Dialog erreichbar");
  offen = await oeffnen("delay"); await klicken(offen.seite); await warte(() => Promise.resolve(Boolean(gehalten)));
  c.direktLaden.abort(); c.spielerLauf = { id: 99, providerId: "sto", url: basis + "/episode-neu", quelle: { adresse: "neue-quelle" } };
  assert.equal(await offen.fertig, "geschlossen"); gehalten.end(manifest); gehalten = null;
  assert.equal(uebernahmen.length, 2); assert.equal(c.spielerLauf.id, 99);
  assert.equal(player.webContents.getURL(), playerUrl); assert.equal(await player.webContents.executeJavaScript("window.position"), 37);
  assert.equal(await player.webContents.executeJavaScript("window.watchparty"), "gleiche-runde");
  console.log("OK Echter Electron: eingebetteter Originaldialog ohne neues Fenster oder Seitenblitz, Resize/ShadowDOM/FormPOST, lokaler Video-Loader/Retry/Rueckkehr, Providerfehler/erneutePruefung, servergepruefte Quellenuebergabe und Abort sicher");
}).then(() => ende(0), error => ende(1, error));
function ende(code, error) { if (error) console.error(error); clearTimeout(frist); gehalten?.end(); controller?.schliessen(); if (player?.webContents && !player.webContents.isDestroyed()) player.webContents.close(); if (parent && !parent.isDestroyed()) parent.destroy(); server?.close(); app.exit(code); }
