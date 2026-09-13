"use strict";

// Lokale Nachbildung der Anbieterseite, keine echte Cloudflare-Abfrage.
// Getestet werden die Produktionsskripte und die originale Electron-Uebergabe.
const { app, BrowserWindow, WebContentsView } = require("electron");
const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const http = require("http");
const verifizierungstor = require("../src/verifizierungstor");
const ablage = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-verifizierung-"));
app.setPath("userData", ablage);
app.disableHardwareAcceleration();
let fenster, player, view, zweiteView, server;
const frist = setTimeout(() => { console.error("FAIL Zeitlimit"); app.exit(1); }, 25000);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function warte(pruefen) {
  for (let i = 0; i < 100; i++) { if (await pruefen()) return; await pause(40); }
  throw Error("Erwarteter Zustand fehlt");
}
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#d00;color:white;font:16px Arial} #werbung{height:900px;background:#f00}
#dialog{position:fixed;left:100px;top:50px;width:500px;box-sizing:border-box;padding:24px;background:#181f28;border:1px solid #8595a8;border-radius:12px}
.cf-turnstile{width:300px;height:64px;background:#333;margin:24px auto} button{padding:15px;color:white;background:#327abd;border:0;border-radius:5px}
#weiter{width:100%} h2{font-size:22px} .alt{display:none}
</style></head><body><div class="alt"><div class="cf-turnstile">Alte Abfrage</div></div>
<div id="werbung">ANBIETERSEITE DARF NICHT SICHTBAR SEIN</div>
<section id="dialog" role="dialog"><h2>Video wird vorbereitet...</h2><p>Bestätige die lokale Testabfrage.</p>
<div class="cf-turnstile"><button id="bestaetigen" onclick="document.getElementById('token').value='lokaler-test'; this.textContent='Bestätigt'">Test: Mensch bestätigen</button></div>
<input id="token" name="cf-turnstile-response" type="hidden"><button id="weiter">Weiter</button></section>
<script>window.klicks=0;document.getElementById('weiter').onclick=()=>{window.klicks++;if(document.getElementById('token').value){document.cookie='freigabe=ja; SameSite=Lax';document.getElementById('dialog').style.display='none';window.videoBereit=true;}};</script></body></html>`;

app.whenReady().then(async () => {
  let abrufe = 0;
  server = http.createServer((_req, res) => { abrufe++; res.setHeader("content-type", "text/html"); res.end(html); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/episode`;
  fenster = new BrowserWindow({ show: false, width: 1040, height: 730 });
  await fenster.loadURL("data:text/html,<body style='background:%230d1627'>ELFIX Test</body>");
  player = new WebContentsView({ webPreferences: { sandbox: true } });
  player.setBounds({ x: 0, y: 0, width: 1040, height: 730 });
  fenster.contentView.addChildView(player);
  await player.webContents.loadURL("data:text/html," + encodeURIComponent('<body style="background:#0d1627;color:#92b5e7;font:24px Arial;padding:45px">ELFIX · Bestehender Player</body>'));
  view = new WebContentsView({ webPreferences: { sandbox: true, backgroundThrottling: false } });
  view.setBounds({ x: 0, y: 0, width: 1040, height: 730 });
  await view.webContents.loadURL(url);
  const js = (code) => view.webContents.executeJavaScript(code);
  assert.equal((await js(verifizierungstor.zustandScript())).offen, true);
  await js(verifizierungstor.torScript(1, false));
  await pause(650);
  assert.equal(await js("window.klicks"), 0, "kein Weiter vor der Bestätigung");

  const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
  const funktion = (name) => {
    const start = main.search(new RegExp("(?:async )?function " + name + "\\("));
    assert.ok(start >= 0, name);
    return main.slice(start, main.indexOf("\n}", start) + 2);
  };
  const c = vm.createContext({ mainWindow: fenster, spielerView: player, verifizierungstor,
    menschentorFenster: null, MENSCHENTOR_FRIST_MS: 4000, VIEW_BACKGROUND_COLOR: "#070a10", setTimeout,
    sendToast: () => {}, spielerLageSetzen: () => {}, torKlickZeit: new Map(), console });
  vm.runInContext(["isLiveView", "menschentorFensterPositionieren", "menschentorLoesenLassen"].map(funktion).join("\n"), c);
  const abbruch = new AbortController();
  const fertig = c.menschentorLoesenLassen({ id: "sto" }, view, { signal: abbruch.signal, voruebergehend: true });
  await warte(() => fenster.contentView.children.includes(view));
  assert.equal(await js("getComputedStyle(document.getElementById('werbung')).visibility"), "hidden");
  assert.equal(await js("getComputedStyle(document.getElementById('bestaetigen')).visibility"), "visible");
  assert.ok(view.getBounds().width <= 560);
  // Optionales QA-Bild des Ausschnitts; manche Windows-Sitzungen bieten
  // keine Viz-Aufnahme. Die Verhaltenspruefungen brauchen keinen Screenshot.
  if (process.env.ELFIX_VERIFIZIERUNG_BILD === "1") {
    fenster.showInactive();
    await pause(200);
    const bild = await view.webContents.capturePage();
    assert.equal(bild.isEmpty(), false);
    const bildPfad = path.join(ablage, "verifizierung-overlay.png");
    fs.writeFileSync(bildPfad, bild.toPNG());
    console.log("Screenshot: " + bildPfad);
  }
  await js("document.getElementById('bestaetigen').click()");
  assert.equal(await fertig, true);
  assert.equal(await js("window.klicks"), 1, "genau ein Weiter-Klick nach .value-Aenderung");
  assert.equal(await js("window.videoBereit"), true);
  assert.equal((await js(verifizierungstor.zustandScript())).offen, false, "verstecktes Rest-Widget ist kein offenes Tor");
  assert.equal(await js("document.getElementById('__elfixVerifizierungStil') === null"), true);
  assert.equal(fenster.contentView.children.includes(view), false);
  assert.equal(abrufe, 1, "keine neue Seite oder Sitzung zur Bestätigung");
  assert.ok((await view.webContents.session.cookies.get({ url })).some((cookie) => cookie.name === "freigabe"));
  console.log("OK Nur Verifizierungsfenster ueber Player, Token ohne DOM-Mutation, automatische Fortsetzung in derselben Sitzung");

  await js("document.getElementById('token').value='';document.getElementById('dialog').style.display='block'");
  const stop = new AbortController();
  const abgebrochen = c.menschentorLoesenLassen({ id: "sto" }, view, { signal: stop.signal });
  await warte(() => fenster.contentView.children.includes(view));
  let beendet = false;
  abgebrochen.then(() => { beendet = true; });
  await js("window.__elfixTorBestaetigt=true;console.log('__elfix:tor:tor-bestaetigt');document.getElementById('dialog').style.display='none'");
  await pause(700);
  assert.equal(beendet, false, "Verschwinden ohne Token ist keine Bestätigung");
  stop.abort();
  assert.equal(await abgebrochen, false);
  assert.equal(fenster.contentView.children.includes(view), false);
  assert.equal(await js("document.getElementById('__elfixVerifizierungStil') === null"), true);
  assert.equal(await js("window.klicks"), 1);
  console.log("OK Abbruch entfernt Fenster und CSS ohne neuen Weiter-Klick");

  // Eine andere Folge darf die bisherige Abfrage ersetzen, ohne eine alte
  // maskierte Ansicht oder einen Fokuswechsel zurueckzulassen.
  await js("document.getElementById('dialog').style.display='block'");
  const alteBounds = view.getBounds();
  const a = c.menschentorLoesenLassen({ id: "sto" }, view);
  await warte(() => fenster.contentView.children.includes(view));
  zweiteView = new WebContentsView({ webPreferences: { sandbox: true, backgroundThrottling: false } });
  zweiteView.setBounds({ x: 0, y: 0, width: 1000, height: 700 });
  await zweiteView.webContents.loadURL(url);
  const neuerAbbruch = new AbortController();
  const b = c.menschentorLoesenLassen({ id: "andere" }, zweiteView, { signal: neuerAbbruch.signal });
  await warte(() => fenster.contentView.children.includes(zweiteView));
  assert.equal(await a, false);
  assert.equal(await js("document.getElementById('__elfixVerifizierungStil') === null"), true);
  assert.deepEqual(view.getBounds(), alteBounds);
  assert.equal(fenster.contentView.children.includes(zweiteView), true);
  neuerAbbruch.abort();
  assert.equal(await b, false);
  console.log("OK Wechsel der Abfrage stellt alte Ansicht wieder her und behaelt neue Auswahl");

  await view.webContents.loadURL(url);
  await js("document.title='Just a moment...';document.getElementById('dialog').style.display='none';setTimeout(()=>{document.getElementById('dialog').style.display='block'},1100)");
  assert.equal((await js(verifizierungstor.zustandScript())).offen, true);
  const spaet = c.menschentorLoesenLassen({ id: "sto" }, view);
  await pause(600);
  assert.equal(fenster.contentView.children.includes(view), false);
  await warte(() => fenster.contentView.children.includes(view));
  await js("document.title='Folge';document.getElementById('bestaetigen').click()");
  assert.equal(await spaet, true);
  console.log("OK Spaet geladenes Widget wird trotz fertigem Hauptdokument abgewartet");

  await view.webContents.loadURL(url);
  await js("const s=document.createElement('div');s.id='cf-please-wait';s.textContent='Bitte warten';document.body.prepend(s)");
  await js(verifizierungstor.fensterScript());
  assert.equal(await js("getComputedStyle(document.getElementById('bestaetigen')).visibility"), "visible");
  assert.equal(await js("getComputedStyle(document.getElementById('cf-please-wait')).visibility"), "hidden");
  console.log("OK Checkbox hat Vorrang vor vorgeschalteter Statusmeldung");
}).then(() => ende(0), (error) => { console.error(error); ende(1); });

function ende(code) {
  clearTimeout(frist);
  if (view && !view.webContents.isDestroyed()) view.webContents.close();
  if (zweiteView && !zweiteView.webContents.isDestroyed()) zweiteView.webContents.close();
  if (player && !player.webContents.isDestroyed()) player.webContents.close();
  fenster?.destroy();
  server?.close();
  app.exit(code);
}
