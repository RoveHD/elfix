"use strict";
// Real player HTML + sandboxed preload, deterministic metadata (no network).
const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const profil = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-filler-ui-"));
app.setPath("userData", profil);
app.disableHardwareAcceleration();
let fenster;
let nachtrag;
const frist = setTimeout(() => beenden(1, Error("Filler UI timeout")), 25000);
const labels = ["Manga-Canon", "Canon / Filler", "Filler", "Anime-Canon"];
const typen = ["manga_canon", "mixed_canon/filler", "filler", "anime_canon"];
const basis = "https://aniworld.to/anime/stream/beispiel/staffel-4";
const folgen = Array.from({ length: 24 }, (_, i) => ({ staffel: 4, folge: i + 1,
  url: `${basis}/episode-${i + 1}`, titel: i === 4 ? "" : "Ein langer Folgentitel zum Prüfen der Lesbarkeit",
  laeuft: i === 0, seen: i === 0 }));
const angereichert = { folgen: folgen.map((f, i) => ({ ...f, gesamtFolge: 451 + i, filler: i === 4 ? undefined : {
  type: typen[i % 4], label: labels[i % 4], source: "AnimeFillerList",
  sourceUrl: "https://www.animefillerlist.com/shows/beispiel", episode: i + 1
} })) };

async function warten(test) {
  const ende = Date.now() + 5000;
  while (Date.now() < ende) {
    if (await test()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw Error("UI did not update");
}
function beenden(code, error) {
  clearTimeout(frist);
  if (error) console.error(error);
  fenster?.destroy();
  app.exit(code);
}
app.whenReady().then(async () => {
  ipcMain.handle("spieler:folgen", async () => ({ titel: "Anime · Folgenauswahl", folgen,
    fillerQuelle: basis, staffeln: [{ staffel: 4, url: basis }] }));
  ipcMain.handle("spieler:folgen-filler", () => new Promise(resolve => { nachtrag = resolve; }));
  ipcMain.handle("spieler:chat-status", () => ({ active: false, messages: [] }));
  fenster = new BrowserWindow({ show: false, width: 1000, height: 820, webPreferences: {
    preload: path.join(__dirname, "../src/spieler-preload.js"), sandbox: true,
    contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
  } });
  await fenster.loadFile(path.join(__dirname, "../src/renderer/spieler.html"));
  const lesen = code => fenster.webContents.executeJavaScript(code);
  await lesen("folgenZeigen()");
  await warten(() => Boolean(nachtrag));
  assert.equal(await lesen("folgenListe.querySelectorAll('.folge').length"), 24);
  assert.equal(await lesen("folgenListe.querySelectorAll('.fillerBadge').length"), 0,
    "episodes are usable before metadata arrives");
  assert.equal(await lesen("folgenListe.children[2].querySelector('.nummer').textContent"), "S4 · Folge 3",
    "a missing offset is not presented as an absolute number");
  await lesen("folgenListe.querySelector('.folge').focus(); window.__fokus = document.activeElement; folgenListe.scrollTop = 70");
  const vorher = await lesen("folgenListe.scrollTop");
  nachtrag(angereichert);
  await warten(() => lesen("folgenListe.querySelectorAll('.fillerBadge').length === 23"));
  assert.deepEqual(await lesen("[...folgenListe.querySelectorAll('.fillerBadge')].slice(0,4).map(b=>b.textContent)"), labels);
  assert.equal(await lesen("document.activeElement === window.__fokus"), true, "metadata preserves focus");
  assert.equal(await lesen("folgenListe.scrollTop"), vorher, "metadata preserves scroll");
  assert.equal(await lesen("folgenListe.children[4].querySelector('.fillerBadge') === null"), true,
    "unknown stays unlabelled");
  assert.equal(await lesen("folgenListe.children[2].querySelector('.nummer').textContent"), "Folge 453 · S4 F3");
  assert.equal(await lesen("folgenListe.children[4].querySelector('.nummer').textContent"), "Folge 455 · S4 F5",
    "numbering does not depend on filler coverage");
  assert.equal(await lesen("folgenNummer({staffel:0,folge:2,gesamtFolge:452})"), "Film 2",
    "films remain outside series numbering");
  await lesen("folgenListe.scrollTop = 0; document.activeElement.blur()");
  await lesen("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const bounds = await lesen(`(() => {
    const list = folgenListe.getBoundingClientRect();
    return [...folgenListe.querySelectorAll('.fillerBadge')].every(b => {
      const r = b.getBoundingClientRect(); return r.left >= list.left && r.right <= list.right + 1;
    });
  })()`);
  assert(bounds, "badges fit inside the episode list");
  assert(await lesen(`(() => {
    const zeile = folgenListe.children[2];
    const nummer = zeile.querySelector('.nummer').getBoundingClientRect();
    const badge = zeile.querySelector('.fillerBadge').getBoundingClientRect();
    return nummer.right <= badge.left;
  })()`), "absolute numbers and filler labels do not overlap");
  const panelDesign = await lesen(`(() => ({
    width: folgenPanel.getBoundingClientRect().width,
    scrollbar: getComputedStyle(folgenListe).scrollbarWidth,
    spoilerRadius: getComputedStyle(spoilerSchutzBox).borderRadius,
    spoilerBorder: getComputedStyle(spoilerSchutzBox).borderTopWidth
  }))()`);
  assert(panelDesign.width >= 490, "episode panel uses the wider desktop layout");
  assert.equal(panelDesign.scrollbar, "thin", "episode list uses the compact scrollbar");
  assert.equal(panelDesign.spoilerRadius, "14px", "spoiler controls use the panel card design");
  assert.equal(panelDesign.spoilerBorder, "1px", "spoiler card remains visually separated");
  if (process.env.ELFIX_FILLER_SCREENSHOT) {
    // A hidden Electron window can present the previous compositor frame.
    await new Promise(resolve => setTimeout(resolve, 150));
    fs.writeFileSync(process.env.ELFIX_FILLER_SCREENSHOT, (await fenster.webContents.capturePage()).toPNG());
  }
  fenster.setContentSize(420, 680);
  await warten(() => lesen("window.innerWidth === 420"));
  assert(await lesen(`(() => [...folgenListe.querySelectorAll('.zeile')].every(z => {
    const nummer = z.querySelector('.nummer').getBoundingClientRect();
    const badge = z.querySelector('.fillerBadge')?.getBoundingClientRect();
    return !badge || nummer.right <= badge.left;
  }))()`), "numbers and filler labels also fit in a narrow player");
  console.log("OK Electron-Filler: echte Preload, vier Labels, optionale Daten, Fokus/Scroll und Layout");
  beenden(0);
}).catch(error => beenden(1, error));
