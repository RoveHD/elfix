"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const teilnehmer = require("../src/youtube-teilnehmer");
let fenster;

const warten = (pruefen, ms = 3000) => new Promise((resolve, reject) => {
  const ende = Date.now() + ms;
  const takt = async () => {
    try { const wert = await pruefen(); if (wert) return resolve(wert); } catch (_) {}
    if (Date.now() >= ende) return reject(Error("Fixture-Zustand blieb aus"));
    setTimeout(takt, 30);
  };
  takt();
});

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  // A visible native window makes requestFullscreen exercise Chromium's real
  // fullscreen path rather than the compositor-only offscreen variant.
  fenster = new BrowserWindow({ show: true, width: 960, height: 620, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
  } });
  await fenster.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><style>
    body{margin:0;background:#111}.html5-video-player{position:relative;width:900px;height:506px;margin:20px;background:#333}
    .ytp-chrome-top{height:36px;color:#fff;padding:8px;box-sizing:border-box}
  </style><div id='movie_player' class='html5-video-player'><div class='ytp-chrome-top'>Titel · Teilen · Später ansehen</div></div>`));
  const ausfuehren = code => fenster.webContents.executeJavaScript(code, true);
  const status = { enabled: true, connected: true, joined: true, room: "Nachtkino", me: "mich",
    members: [{ id: "mich", name: "Elias" }, { id: "n", name: "Nora" }] };
  await ausfuehren(teilnehmer.anzeigeScript(status));
  const erste = await warten(() => ausfuehren(`(() => {
    const overlay = document.getElementById('elfix-youtube-teilnehmer');
    return overlay && { parent: overlay.parentElement.id, text: overlay.textContent, pointer: overlay.style.pointerEvents,
      top: overlay.getBoundingClientRect().top - overlay.parentElement.getBoundingClientRect().top };
  })()`));
  assert.equal(erste.parent, "movie_player", "Anzeige ist ein Kind des Players, nicht der App-Leiste");
  assert.equal(erste.pointer, "none", "Anzeige faengt keine Klicks ab");
  assert.equal(erste.top, 48, "Anzeige sitzt unter den nativen Player-Steuerelementen");
  assert.match(erste.text, /Nachtkino.*2 dabei.*Elias \(du\).*Nora/, "Raum, Anzahl, Selbstmarker und Namen sind sichtbar");
  assert.doesNotMatch(erste.text, /Du: Elias/, "die eigene Person erscheint nur einmal");
  await ausfuehren(teilnehmer.anzeigeScript({ ...status, members: Array.from({ length: 10 }, (_, index) => ({
    id: "p" + index, name: "Gast " + index
  })) }));
  const begrenzt = await ausfuehren(`(() => { const overlay = document.getElementById('elfix-youtube-teilnehmer');
    return { wrap: getComputedStyle(overlay).flexWrap, pointer: getComputedStyle(overlay.lastElementChild).pointerEvents, hidden: overlay.getAttribute('aria-hidden'), chips: overlay.children.length, rest: Array.from(overlay.children).find(el => el.textContent === '+2')?.title || '' }; })()`);
  assert.equal(begrenzt.wrap, "nowrap", "Namen vergroessern den Streifen nicht auf mehrere Zeilen");
  assert.equal(begrenzt.pointer, "auto", "Restnamen-Tooltip ist mit der Maus erreichbar");
  assert.notEqual(begrenzt.hidden, "true", "Teilnehmende bleiben fuer Vorlesefunktionen erreichbar");
  assert.equal(begrenzt.chips, 11, "Raum, Anzahl und hoechstens acht Namen bleiben eine kompakte Reihe");
  assert.match(begrenzt.rest, /Gast 8, Gast 9/, "der Restzaehler beschreibt die nicht sichtbaren Namen");
  await ausfuehren(teilnehmer.anzeigeScript(status));

  if (process.env.ELFIX_SCREENSHOT_PATH) {
    fs.mkdirSync(path.dirname(process.env.ELFIX_SCREENSHOT_PATH), { recursive: true });
    await new Promise(resolve => setTimeout(resolve, 100));
    fs.writeFileSync(process.env.ELFIX_SCREENSHOT_PATH, (await fenster.webContents.capturePage()).toPNG());
    console.log(`Screenshot: ${process.env.ELFIX_SCREENSHOT_PATH}`);
  }

  // Fullscreen moves #movie_player itself; the overlay must remain beneath it.
  await ausfuehren("document.querySelector('#movie_player').requestFullscreen?.();");
  assert.equal(await warten(() => ausfuehren("document.fullscreenElement === document.querySelector('#movie_player')")), true,
    "#movie_player erreicht das echte DOM-Vollbild");
  assert.equal(await ausfuehren("document.getElementById('elfix-youtube-teilnehmer')?.parentElement === document.fullscreenElement"), true,
    "Anzeige bleibt auch beim Vollbild im Player");
  await ausfuehren("document.exitFullscreen?.();");
  await warten(() => ausfuehren("!document.fullscreenElement"));

  await ausfuehren("document.querySelector('#movie_player').replaceWith(Object.assign(document.createElement('div'), { id: 'movie_player', className: 'html5-video-player' }));");
  assert.equal(await warten(() => ausfuehren("document.getElementById('elfix-youtube-teilnehmer')?.parentElement?.id === 'movie_player'")), true,
    "ein ersetzter YouTube-Player erhaelt die Anzeige erneut");
  await ausfuehren("document.getElementById('elfix-youtube-teilnehmer').remove();");
  assert.equal(await warten(() => ausfuehren("Boolean(document.getElementById('elfix-youtube-teilnehmer'))")), true,
    "ein von YouTube ausgeraeumtes Overlay wird ohne Intervall repariert");

  await ausfuehren(teilnehmer.anzeigeScript({ ...status, me: "", members: [{ id: "x", name: "<img src=x onerror=alert(1)>" }] }));
  const sicher = await ausfuehren("({ bilder: document.querySelectorAll('#elfix-youtube-teilnehmer img').length, html: document.getElementById('elfix-youtube-teilnehmer').innerHTML })");
  assert.equal(sicher.bilder, 0, "Namen werden nicht als HTML eingesetzt");
  assert.match(sicher.html, /&lt;img/, "bösartiger Name bleibt Text");
  assert.doesNotMatch(await ausfuehren("document.getElementById('elfix-youtube-teilnehmer').textContent"), /\(du\)/,
    "ohne eigene Kennung wird kein Selbstmarker erfunden");

  await ausfuehren(teilnehmer.anzeigeScript({ ...status, connected: false }));
  assert.equal(await ausfuehren("document.getElementById('elfix-youtube-teilnehmer') === null"), true,
    "bei Verlassen oder Deaktivierung wird die Anzeige entfernt");
  console.log("OK YouTube-Teilnehmer: Overlay, Vollbild, Ersatz, sichere Namen und Abschalten");
}).then(() => ende(0), (fehler) => { console.error(fehler.stack || fehler); ende(1); });

function ende(code) {
  fenster?.destroy();
  app.exit(code);
}
