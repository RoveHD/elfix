"use strict";
// Echter Chromium-Aufbau: ein Originaldialog wird erst im naechsten Frame
// sichtbar (wie bei modalen CSS-Uebergaengen). Keine Challenge-Automation.
const { app, BrowserWindow, WebContentsView, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http");
const anbieter = require("../src/anbieteransicht"), tor = require("../src/verifizierungstor");
const offscreen = process.env.ELFIX_ANBIETER_OFFSCREEN === "1";
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "elfix-anbietersichtbarkeit-")));
app.disableHardwareAcceleration();
let parent, server, controller;
const frist = setTimeout(() => ende(1, Error("Sichtbarkeit Zeitlimit")), 45000);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function warte(fn) {
  const bis = Date.now() + 3500;
  while (Date.now() < bis) { if (await fn()) return; await pause(25); }
  throw Error("Originaldialog wird ohne Nutzer-Zwischenklick nicht automatisch sichtbar");
}
app.whenReady().then(async () => {
  server = http.createServer((_req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(`<!doctype html><style>body{margin:0;background:red}.modal{position:fixed;inset:0;opacity:0}
      .modal-content{width:460px;margin:80px auto;background:white;border-radius:8px;padding:20px}button{padding:12px}</style>
      <body><h1>ANBIETER AUSSENWELT</h1><div class="modal" id="playerPrepareModal"><div class="modal-content">
      <h5>Video wird vorbereitet...</h5><p>Originaldialog</p><button id="weiter">Weiter</button></div></div>
      <script>window.aufbau={sichtbarkeit:document.visibilityState,breite:innerWidth,hoehe:innerHeight,frame:false};
      requestAnimationFrame(()=>{aufbau.frame=true;document.querySelector('.modal').style.opacity='1'});</script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  parent = new BrowserWindow({ width: 1000, height: 760, show: !offscreen, webPreferences: { offscreen } });
  if (offscreen) { parent.isVisible = () => true; parent.focus = () => {}; }
  await parent.loadURL("data:text/html,<body>Bestehender Player</body>");
  const views = [];
  controller = anbieter.erstellen({ WebContentsView: function(options) {
    const view = new WebContentsView(options); views.push(view);
    if (offscreen) view.webContents.focus = () => {};
    return view;
  }, eltern: () => parent, sitzung: () => session.fromPartition("anbieter-sichtbarkeit"),
  zustandScript: tor.zustandScript, maskeScript: tor.dialogMaskeScript, persistieren: async () => {} });
  for (let wechsel = 0; wechsel < 24; wechsel++) {
    const abbruch = new AbortController();
    const fertig = controller.oeffnen({ id: "fixture" }, `http://127.0.0.1:${server.address().port}/episode/${wechsel}`, {
      signal: abbruch.signal,
      ...(wechsel % 4 === 0 ? { quelleVorbereiten: view => ({
        vorbereiten: () => view.webContents.executeJavaScript(`new Promise((resolve,reject)=>requestAnimationFrame(()=>{
          if (window.vorbereitet) {resolve(true);return;}
          const r=document.getElementById('weiter').getBoundingClientRect();
          if (!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('#__elfixAnbieterAbdeckung')) {reject(Error('Unvorbereitete Auswahl wurde freigegeben'));return;}
          window.vorbereitet=true;resolve(true);
        }))`),
        pruefen: async () => null, schliessen() {}
      }) } : {})
    });
    const [decke, view] = views.slice(-2), seite = view.webContents, lokal = decke.webContents;
    assert.equal(decke.getBounds().height, parent.getContentSize()[1], "Lokale Vollabdeckung steht vor dem ersten Provider-Paint");
    await warte(() => seite.executeJavaScript("Boolean(window.aufbau)").catch(() => false));
    const initial = await seite.executeJavaScript("aufbau");
    assert.ok(initial.breite > 0 && initial.hoehe > 0, "Provider hat von Beginn an einen echten Viewport");
    if (!wechsel) console.log("Initialer Provideraufbau:", initial);
    await warte(async () => (await lokal.executeJavaScript("document.body.dataset.phase")) === "dialog");
    assert.equal(await seite.executeJavaScript("aufbau.frame"), true, "Originaler rAF-Aufbau lief ohne Zwischenklick");
    if (wechsel % 4 === 0) assert.equal(await seite.executeJavaScript("window.vorbereitet"), true, "Asynchrone Auswahl ist vor Dialogfreigabe abgeschlossen");
    assert.equal(view.getVisible(), true);
    assert.equal(decke.getBounds().height, 52, "Erst fertige Maske gibt den Dialog frei");
    assert.equal(await lokal.executeJavaScript("document.getElementById('zurueckZumPlayer').textContent.trim()"), "Abbrechen");
    assert.equal(await lokal.executeJavaScript("Boolean(document.getElementById('anbieterSeiteAnzeigen')||document.getElementById('anbieterStatusHinweis'))"), false);
    const maske = await seite.executeJavaScriptInIsolatedWorld(987, [{ code: tor.dialogMaskeScript() }]);
    assert.ok(maske.width > 0 && maske.height > 0);
    assert.deepEqual([maske.viewportWidth, maske.viewportHeight], [view.getBounds().width, view.getBounds().height]);
    assert.equal(await seite.executeJavaScript("document.elementFromPoint(2,2)?.parentElement?.id"), "__elfixAnbieterAbdeckung", "Aussenwelt bleibt verdeckt und blockiert");
    if (wechsel % 3 === 0) {
      const punkt = await seite.executeJavaScript("(()=>{const r=document.getElementById('weiter').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
      seite.sendInputEvent({ type: "mouseDown", ...punkt, button: "left", clickCount: 1 });
      seite.sendInputEvent({ type: "mouseUp", ...punkt, button: "left", clickCount: 1 });
      await warte(async () => (await lokal.executeJavaScript("document.body.dataset.phase")) === "laden");
      assert.equal(await seite.executeJavaScript("document.getElementById('__elfixAnbieterLaden').textContent"), "Video wird geladen …");
      assert.equal(await seite.executeJavaScript("document.elementFromPoint(innerWidth/2,innerHeight/2)?.closest('#__elfixAnbieterAbdeckung')?.id"), "__elfixAnbieterAbdeckung");
      assert.equal(decke.getBounds().height, 52);
      assert.equal(await seite.executeJavaScript("new Promise(resolve=>requestAnimationFrame(()=>resolve(document.visibilityState)))"), offscreen ? "hidden" : "visible", "Auch nach echtem Weiter laufen Originalseite und Iframe weiter; Offscreen-Fenster bleibt nativ verborgen");
    } else if (wechsel % 3 === 1) {
      await seite.executeJavaScript("document.getElementById('playerPrepareModal').remove()");
      assert.equal(await seite.executeJavaScript("document.elementFromPoint(innerWidth/2,innerHeight/2)?.parentElement?.id"), "__elfixAnbieterAbdeckung", "Verschwundener Dialog schliesst das Loch vor dem naechsten Paint");
      await warte(async () => (await lokal.executeJavaScript("document.body.dataset.phase")) === "warten");
      assert.equal(decke.getBounds().height, 52, "DOM-Vollmaske behaelt einen aktiven Provider-Viewport");
      // Auch eine alte/gefremdete Konsolenmeldung darf die rohe Seite nie freigeben.
      lokal.emit("console-message", { message: "__elfix:anbieter:seite-zeigen" });
      await pause(50);
      assert.equal(decke.getBounds().height, 52);
    }
    abbruch.abort(); assert.equal(await fertig, "geschlossen");
    assert.equal(controller.offen, false);
    await warte(() => seite.isDestroyed());
  }
  console.log("OK Echter Electron: 24 Folgenwechsel mit automatischem rAF-Dialog, echtem Weiter/aktivem Loader, Dialogschluss und Abort ohne Seitenfreigabe");
}).then(() => ende(0), error => ende(1, error));
function ende(code, error) {
  if (error) console.error(error);
  clearTimeout(frist); controller?.schliessen();
  if (parent && !parent.isDestroyed()) parent.destroy();
  server?.close(); app.exit(code);
}
