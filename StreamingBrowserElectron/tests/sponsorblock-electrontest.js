"use strict";

// Aufruf: npx electron tests/sponsorblock-electrontest.js
//
// Der Test fuehrt das Produktionsskript in echtem Chromium aus. Das Video und
// YouTubes Fortschrittsleiste kommen absichtlich erst nach der Einspielung und
// das Video wird danach ersetzt: genau diese beiden Lebenslaeufe gingen in der
// App verloren, wenn YouTube seinen Player spaet oder per SPA aufbaute.
const { app, BrowserWindow } = require("electron");
const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sponsorblock = require("../src/sponsorblock");

const ablage = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-sponsorblock-test-"));
app.setPath("userData", ablage);
app.disableHardwareAcceleration();

let fenster;
const frist = setTimeout(() => {
  console.error("FAIL  SponsorBlock-Electron-Test blieb stehen");
  app.exit(1);
}, 20000);

async function warten(pruefen) {
  const ende = Date.now() + 5000;
  while (Date.now() < ende) {
    const wert = await pruefen();
    if (wert) return wert;
    await new Promise((fertig) => setTimeout(fertig, 40));
  }
  throw Error("Erwarteter SponsorBlock-Zustand blieb aus");
}

app.whenReady().then(async () => {
  fenster = new BrowserWindow({ show: false, webPreferences: {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    backgroundThrottling: false
  } });
  await fenster.loadURL("data:text/html,<html><body><div id='movie_player'></div></body></html>");
  const lesen = (code) => fenster.webContents.executeJavaScript(code, true);
  const segmente = [
    { von: 112.62511, bis: 182.9566, kategorie: "sponsor", modus: "skip" },
    { von: 200, bis: 220, kategorie: "music_offtopic", modus: "show" },
    { von: 230, bis: 250, kategorie: "preview", modus: "manual" }
  ];

  await lesen(`document.getElementById("movie_player").getVideoData = () => ({
    video_id: "ByhVrrP1QkQ"
  }); true`);

  assert.equal(await lesen(sponsorblock.skipScript(segmente, {
    videoId: "ByhVrrP1QkQ",
    hinweis: true
  })), "wartet-auf-video");

  await lesen(`(() => {
    const leiste = document.createElement("div");
    leiste.className = "ytp-progress-bar-container";
    Object.assign(leiste.style, { position: "relative", width: "1000px", height: "12px" });
    document.getElementById("movie_player").appendChild(leiste);
    const media = document.createElement("video");
    media.className = "html5-main-video";
    Object.defineProperty(media, "duration", { configurable: true, value: 300 });
    Object.defineProperty(media, "currentTime", { configurable: true, writable: true, value: 0 });
    document.getElementById("movie_player").appendChild(media);
  })()`);

  await warten(() => lesen(`Boolean(window.__elfixSponsorblock.zustand.media
    && document.querySelector(".elfix-sponsorblock-marke"))`));
  const marke = await lesen(`(() => {
    const m = document.querySelector(".elfix-sponsorblock-marke");
    return { kategorie: m.dataset.kategorie, links: m.style.left,
      breite: m.style.width, farbe: m.style.background };
  })()`);
  assert.equal(marke.kategorie, "sponsor");
  assert.equal(marke.farbe, "rgb(0, 212, 0)");
  assert.ok(Math.abs(parseFloat(marke.links) - 37.5417) < 0.01);
  assert.ok(Math.abs(parseFloat(marke.breite) - 23.4438) < 0.01);
  const marken = await lesen(`Array.from(document.querySelectorAll(".elfix-sponsorblock-marke"))
    .map((m) => ({ kategorie: m.dataset.kategorie, modus: m.dataset.modus, farbe: m.style.background }))`);
  assert.deepEqual(marken, [
    { kategorie: "sponsor", modus: "skip", farbe: "rgb(0, 212, 0)" },
    { kategorie: "music_offtopic", modus: "show", farbe: "rgb(255, 153, 0)" },
    { kategorie: "preview", modus: "manual", farbe: "rgb(0, 143, 214)" }
  ]);
  await new Promise((fertig) => setTimeout(fertig, 250));
  assert.equal(await lesen(`document.querySelector(".elfix-sponsorblock-marke")
    === window.__elfixSponsorblock.zustand.marken.firstChild`), true);
  // Der Knoten muss derselbe bleiben; ein Observer, der seine eigenen
  // Aenderungen wieder zeichnet, wuerde ihn in jeder Runde ersetzen.
  assert.equal(await lesen(`window.__elfixSponsorblock.__markerProbe
    = document.querySelector(".elfix-sponsorblock-marke"); true`), true);
  await new Promise((fertig) => setTimeout(fertig, 250));
  assert.equal(await lesen(`window.__elfixSponsorblock.__markerProbe
    === document.querySelector(".elfix-sponsorblock-marke")`), true);

  await lesen(`(() => {
    const media = document.querySelector("video");
    document.getElementById("movie_player").classList.add("ad-showing");
    media.currentTime = 120;
    media.dispatchEvent(new Event("timeupdate"));
  })()`);
  assert.equal(await lesen("document.querySelector('video').currentTime"), 120);
  assert.equal(await lesen("document.querySelectorAll('.elfix-sponsorblock-marke').length"), 0);
  await lesen(`(() => {
    const media = document.querySelector("video");
    document.getElementById("movie_player").classList.remove("ad-showing");
    media.currentTime = 0;
    media.dispatchEvent(new Event("timeupdate"));
  })()`);
  await warten(() => lesen("document.querySelectorAll('.elfix-sponsorblock-marke').length === 3"));

  // "Nur markieren" veraendert die Wiedergabe nicht. "Manuell" zeigt den
  // kategorisierten Knopf mit Restzeit und springt erst auf den Klick.
  await lesen(`(() => {
    const media = document.querySelector("video");
    media.currentTime = 205;
    media.dispatchEvent(new Event("timeupdate"));
  })()`);
  assert.equal(await lesen("document.querySelector('video').currentTime"), 205);
  assert.doesNotMatch(await lesen("document.body.textContent"), /Nicht-Musik · noch/);
  await lesen(`(() => {
    const media = document.querySelector("video");
    media.currentTime = 235;
    media.dispatchEvent(new Event("timeupdate"));
  })()`);
  assert.equal(await lesen("document.querySelector('video').currentTime"), 235);
  assert.match(await lesen("document.body.textContent"), /Vorschau · noch 15 Sek\.Überspringen/);
  await lesen(`document.querySelector("button").click()`);
  assert.equal(await lesen("document.querySelector('video').currentTime"), 250);
  assert.match(await lesen("document.body.textContent"), /Vorschau übersprungen/);

  await lesen(`(() => {
    const media = document.querySelector("video");
    media.currentTime = 120;
    media.dispatchEvent(new Event("timeupdate"));
  })()`);
  assert.equal(await lesen("document.querySelector('video').currentTime"), 182.9566);
  assert.match(await lesen("document.body.textContent"), /Sponsor übersprungen/);

  // Ein Watchparty-Folger zeichnet dieselben Marken, darf aber keinen eigenen
  // Sprung ausloesen. Wird er fuer dasselbe Video zum ersten Mitglied, greift
  // der Rollenwechsel sofort und ohne zweiten Satz Ereignishorcher.
  await lesen(`document.querySelector("video").currentTime = 120; true`);
  assert.equal(await lesen(sponsorblock.skipScript(segmente, {
    videoId: "ByhVrrP1QkQ", hinweis: true, automatisch: false
  })), "aktualisiert");
  await lesen(`document.querySelector("video").dispatchEvent(new Event("timeupdate"))`);
  assert.equal(await lesen("document.querySelector('video').currentTime"), 120);
  assert.equal(await lesen(sponsorblock.skipScript(segmente, {
    videoId: "ByhVrrP1QkQ", hinweis: true, automatisch: true
  })), "aktualisiert");
  assert.equal(await lesen("document.querySelector('video').currentTime"), 182.9566);

  // YouTube darf den Player bei einer SPA-Navigation austauschen. Der alte
  // Horcher muss weg und der neue muss denselben Sprung ausfuehren.
  await lesen(`(() => {
    const alt = document.querySelector("video");
    const media = document.createElement("video");
    media.className = "html5-main-video";
    Object.defineProperty(media, "duration", { configurable: true, value: 300 });
    Object.defineProperty(media, "currentTime", { configurable: true, writable: true, value: 0 });
    alt.replaceWith(media);
  })()`);
  await warten(() => lesen("window.__elfixSponsorblock.zustand.media === document.querySelector('video')"));
  await lesen(`(() => {
    const media = document.querySelector("video");
    media.currentTime = 125;
    media.dispatchEvent(new Event("timeupdate"));
  })()`);
  assert.equal(await lesen("document.querySelector('video').currentTime"), 182.9566);

  // Adresse und Player-ID widersprechen sich waehrend einer SPA-Navigation.
  // Dann verschwinden alte Marken, und die alten Segmente duerfen nicht auf
  // das neue Video angewendet werden.
  await lesen(`(() => {
    document.getElementById("movie_player").getVideoData = () => ({ video_id: "NEUESVIDEO1" });
    window.dispatchEvent(new Event("yt-navigate-finish"));
  })()`);
  await warten(() => lesen("!document.querySelector('.elfix-sponsorblock-marke')"));
  await lesen(`(() => {
    const media = document.querySelector("video");
    media.currentTime = 120;
    media.dispatchEvent(new Event("timeupdate"));
  })()`);
  assert.equal(await lesen("document.querySelector('video').currentTime"), 120);

  // Auch wenn gerade eine DOM-Aenderung fuer den naechsten Frame vorgemerkt
  // wurde, darf Abschalten den Media-Horcher nicht wieder auferstehen lassen.
  assert.equal(await lesen(`(() => {
    document.body.appendChild(document.createElement("i"));
    return window.__elfixSponsorblock.abschalten();
  })()`), "aus");
  await new Promise((fertig) => setTimeout(fertig, 100));
  assert.equal(await lesen("window.__elfixSponsorblock.zustand.media === null"), true);
  assert.equal(await lesen("document.querySelectorAll('.elfix-sponsorblock-marke').length"), 0);
  console.log("OK    Echtes Chromium: Farben, Modi, Watchparty-Rolle, Sprung und SPA-Rebinding");
}).then(() => beenden(0), (fehler) => {
  console.error(`FAIL  ${fehler.stack}`);
  beenden(1);
});

function beenden(code) {
  clearTimeout(frist);
  fenster?.destroy();
  app.exit(code);
}
