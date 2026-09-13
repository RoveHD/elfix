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
const basis = "https://aniworld.to/anime/stream/beispiel/staffel-1";
const folgen = Array.from({ length: 24 }, (_, i) => ({ staffel: 1, folge: i + 1,
  url: `${basis}/episode-${i + 1}`, titel: i === 4 ? "" : "Ein langer Folgentitel zum Prüfen der Lesbarkeit",
  laeuft: i === 0, seen: i === 0 }));
const angereichert = { folgen: folgen.map((f, i) => ({ ...f, filler: i === 4 ? undefined : {
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
    fillerQuelle: basis, staffeln: [{ staffel: 1, url: basis }] }));
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
  await lesen("folgenListe.querySelector('.folge').focus(); window.__fokus = document.activeElement; folgenListe.scrollTop = 70");
  const vorher = await lesen("folgenListe.scrollTop");
  nachtrag(angereichert);
  await warten(() => lesen("folgenListe.querySelectorAll('.fillerBadge').length === 23"));
  assert.deepEqual(await lesen("[...folgenListe.querySelectorAll('.fillerBadge')].slice(0,4).map(b=>b.textContent)"), labels);
  assert.equal(await lesen("document.activeElement === window.__fokus"), true, "metadata preserves focus");
  assert.equal(await lesen("folgenListe.scrollTop"), vorher, "metadata preserves scroll");
  assert.equal(await lesen("folgenListe.children[4].querySelector('.fillerBadge') === null"), true,
    "unknown stays unlabelled");
  await lesen("folgenListe.scrollTop = 0; document.activeElement.blur()");
  await lesen("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const bounds = await lesen(`(() => {
    const list = folgenListe.getBoundingClientRect();
    return [...folgenListe.querySelectorAll('.fillerBadge')].every(b => {
      const r = b.getBoundingClientRect(); return r.left >= list.left && r.right <= list.right + 1;
    });
  })()`);
  assert(bounds, "badges fit inside the episode list");
  if (process.env.ELFIX_FILLER_SCREENSHOT) {
    // A hidden Electron window can present the previous compositor frame.
    await new Promise(resolve => setTimeout(resolve, 150));
    fs.writeFileSync(process.env.ELFIX_FILLER_SCREENSHOT, (await fenster.webContents.capturePage()).toPNG());
  }
  console.log("OK Electron-Filler: echte Preload, vier Labels, optionale Daten, Fokus/Scroll und Layout");
  beenden(0);
}).catch(error => beenden(1, error));
