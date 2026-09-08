"use strict";

// Manueller Netztest, absichtlich nicht Teil der CI:
//   npx electron tests/sponsorblock-youtubetest.js
//
// Er holt echte Segmente von sponsor.ajay.app, oeffnet das dazugehoerige
// YouTube-Video in Chromium und prueft Marker sowie Sprung in der echten DOM.
const { app, BrowserWindow, session, net } = require("electron");
const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sponsorblock = require("../src/sponsorblock");
const youtubeDislikes = require("../src/youtube-dislikes");

const VIDEO_ID = process.env.ELFIX_SPONSORBLOCK_VIDEO || "ByhVrrP1QkQ";
const SICHTBAR = process.env.ELFIX_SPONSORBLOCK_SHOW === "1";
const AUSGABE = path.join(__dirname, "../../build/history-perf");
const BILD = path.join(AUSGABE, `sponsorblock-youtube-real-${VIDEO_ID}.png`);
const MARKER_BILD = path.join(AUSGABE, `sponsorblock-youtube-marker-real-${VIDEO_ID}.png`);
const DISLIKE_BILD = path.join(AUSGABE, `youtube-dislike-real-${VIDEO_ID}.png`);
const profil = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-sponsorblock-youtube-"));
app.setPath("userData", profil);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let fenster;
const frist = setTimeout(() => {
  console.error("FAIL  Echter YouTube-Test blieb stehen");
  app.exit(1);
}, 120000);

async function warten(pruefen, dauer = 40000) {
  const ende = Date.now() + dauer;
  let letzter;
  while (Date.now() < ende) {
    try {
      letzter = await pruefen();
      if (letzter) return letzter;
    } catch (_) {}
    await new Promise((fertig) => setTimeout(fertig, 250));
  }
  throw Error(`YouTube-Zustand blieb aus: ${JSON.stringify(letzter)}`);
}

app.whenReady().then(async () => {
  fs.mkdirSync(AUSGABE, { recursive: true });
  const ses = session.fromPartition(`elfix-sponsorblock-real-${Date.now()}`);
  await ses.cookies.set({ url: "https://www.youtube.com", name: "SOCS", value: "CAI",
    secure: true, sameSite: "lax" }).catch(() => {});
  fenster = new BrowserWindow({ show: SICHTBAR, width: 1280, height: 760, webPreferences: {
    session: ses,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    backgroundThrottling: false
  } });
  fenster.webContents.setAudioMuted(true);
  fenster.webContents.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    + "(KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36");
  const lesen = (code) => fenster.webContents.executeJavaScript(code, true);

  const adresse = sponsorblock.anfrageUrl(sponsorblock.hashPraefix(VIDEO_ID));
  const antwort = await fetch(adresse, { signal: AbortSignal.timeout(15000) });
  assert.equal(antwort.ok, true, `SponsorBlock-API: HTTP ${antwort.status}`);
  const segmente = sponsorblock.gefiltert(
    sponsorblock.segmenteAus(await antwort.json(), VIDEO_ID), sponsorblock.STANDARD);
  assert.ok(segmente.length > 0, `Kein aktives Segment fuer ${VIDEO_ID}`);
  const dislikeAntwort = await net.fetch(youtubeDislikes.anfrageUrl(VIDEO_ID), {
    signal: AbortSignal.timeout(15000)
  });
  assert.equal(dislikeAntwort.ok, true, `RYD-API: HTTP ${dislikeAntwort.status}`);
  const dislikeDaten = youtubeDislikes.datenAus(await dislikeAntwort.json(), VIDEO_ID);
  assert.ok(dislikeDaten, `Keine lesbare RYD-Schaetzung fuer ${VIDEO_ID}`);

  await fenster.loadURL(`https://www.youtube.com/watch?v=${VIDEO_ID}`).catch((fehler) => {
    // YouTube haengt beim ersten Aufruf gelegentlich themeRefresh=1 an. Chromium
    // meldet die alte Navigation dann als abgebrochen, waehrend die neue Seite
    // bereits mit derselben Video-ID weiterlaedt.
    if (fehler?.code !== "ERR_ABORTED") throw fehler;
  });
  // Falls die EU-Einwilligung als Dialog statt als Cookie greift, reicht die
  // nicht personalisierte Ablehnung; der Test braucht kein Konto.
  await lesen(`(() => {
    const knopf = Array.from(document.querySelectorAll("button, tp-yt-paper-button"))
      .find((el) => /reject all|alle ablehnen/i.test(el.textContent || ""));
    if (knopf) knopf.click();
  })()`).catch(() => {});

  // Die erste lesbare Dauer kann zu einem Werbespot gehoeren. Warten, bis
  // Player-ID, Dauer und ad-showing gemeinsam das eigentliche Video belegen.
  await new Promise((fertig) => setTimeout(fertig, 1500));
  const bereit = await warten(() => lesen(`(() => {
    const media = document.querySelector("video.html5-main-video");
    const spieler = document.querySelector("#movie_player");
    let id = "";
    try { id = spieler && spieler.getVideoData().video_id || ""; } catch (_) {}
    const werbung = Boolean(spieler && (spieler.classList.contains("ad-showing")
      || spieler.classList.contains("ad-interrupting")));
    if (werbung && media) {
      media.playbackRate = 16;
      media.play().catch(() => {});
    } else if (media) media.playbackRate = 1;
    const ueberspringen = document.querySelector(".ytp-skip-ad-button, .ytp-ad-skip-button-modern");
    if (ueberspringen) ueberspringen.click();
    return !werbung && media && Number(media.duration) > ${JSON.stringify(segmente[0].bis + 1)}
      && document.querySelector(".ytp-progress-bar-container")
      ? { id, dauer: media.duration, titel: document.title, url: location.href }
      : null;
  })()`), 70000);
  assert.equal(bereit.id, VIDEO_ID, `YouTube lud ${bereit.id || "keine Kennung"}`);

  assert.match(await lesen(sponsorblock.skipScript(segmente, {
    videoId: VIDEO_ID,
    hinweis: true
  })), /eingerichtet|aktualisiert/);
  const marker = await warten(() => lesen(`(() => {
    const marken = Array.from(document.querySelectorAll(".elfix-sponsorblock-marke"));
    return marken.length ? marken.map((m) => ({
      kategorie: m.dataset.kategorie, links: m.style.left, breite: m.style.width
    })) : null;
  })()`));
  assert.equal(marker.length, segmente.length);
  assert.match(await lesen(youtubeDislikes.anzeigeScript(dislikeDaten)),
    /youtube-dislikes-eingerichtet|youtube-dislikes-aktualisiert/);
  const dislike = await warten(() => lesen(`(() => {
    const wert = document.querySelector(".elfix-youtube-dislike-count");
    const knopf = wert && wert.closest("button");
    if (!wert || !knopf) return null;
    const r = wert.getBoundingClientRect();
    return { text: wert.textContent, aria: wert.getAttribute("aria-label"),
      quelle: wert.dataset.source, sichtbar: r.width > 0 && r.height > 0,
      knopfAria: knopf.getAttribute("aria-label") || "" };
  })()`), 30000);
  assert.match(dislike.text, /\d/);
  assert.equal(dislike.quelle, "Return YouTube Dislike");
  assert.equal(dislike.sichtbar, true);

  // Ein Segment am Start koennte bereits waehrend der Installation springen.
  // Fuer den beobachteten natuerlichen Sprung ist ein spaeteres belastbarer.
  const segment = segmente.find((eintrag) => eintrag.von > 5) || segmente[0];
  const start = Math.max(0, segment.von - 1.25);
  await lesen(`new Promise((resolve, reject) => {
    const media = document.querySelector("video.html5-main-video");
    media.pause();
    const ende = () => resolve(media.currentTime);
    media.addEventListener("seeked", ende, { once: true });
    media.currentTime = ${JSON.stringify(start)};
    setTimeout(() => reject(Error("Seek vor Sponsor blieb aus")), 5000);
  })`);
  fenster.showInactive();
  fenster.webContents.sendInputEvent({ type: "mouseMove", x: 640, y: 690 });
  await new Promise((fertig) => setTimeout(fertig, 500));
  const markerLayout = await lesen(`(() => {
    const m = document.querySelector(".elfix-sponsorblock-marke");
    const e = document.querySelector(".elfix-sponsorblock-marken");
    const l = document.querySelector(".ytp-progress-bar-container");
    const info = (x) => { if (!x) return null; const r = x.getBoundingClientRect(); const s = getComputedStyle(x);
      return { x: r.x, y: r.y, width: r.width, height: r.height,
        display: s.display, opacity: s.opacity, zIndex: s.zIndex, background: s.backgroundColor }; };
    return { marke: info(m), ebene: info(e), leiste: info(l) };
  })()`);
  const vorSprung = (await fenster.webContents.capturePage()).toPNG();
  fs.writeFileSync(MARKER_BILD, vorSprung);
  fs.writeFileSync(DISLIKE_BILD, vorSprung);
  await lesen(`document.querySelector("video.html5-main-video").play().then(() => true)`);
  const sprung = await warten(() => lesen(`(() => {
    const media = document.querySelector("video.html5-main-video");
    const text = document.body.textContent || "";
    return media.currentTime >= ${JSON.stringify(segment.bis - 0.1)}
      ? { stelle: media.currentTime,
        meldung: text.includes(${JSON.stringify((sponsorblock.NAMEN[segment.kategorie] || "Abschnitt") + " übersprungen")}) }
      : null;
  })()`), 12000);
  assert.ok(sprung.stelle >= segment.bis - 0.1,
    `Sprung blieb bei ${sprung.stelle}, erwartet ${segment.bis}`);
  assert.equal(sprung.meldung, true, "Hinweis nach natuerlichem Sprung fehlt");

  fenster.webContents.sendInputEvent({ type: "mouseMove", x: 640, y: 690 });
  await new Promise((fertig) => setTimeout(fertig, 500));
  fs.writeFileSync(BILD, (await fenster.webContents.capturePage()).toPNG());
  console.log(`OK    Echte API: ${VIDEO_ID}, ${segmente.length} Segment(e)`);
  console.log(`OK    Echtes YouTube: ${bereit.titel}, Dauer ${Math.round(bereit.dauer)} s`);
  console.log(`OK    Marker ${marker.map((m) => `${m.kategorie}@${m.links}+${m.breite}`).join(", ")}`);
  console.log(`OK    RYD ${dislike.text}, sichtbar im nativen Ablehnen-Knopf`);
  console.log(`LAYOUT ${JSON.stringify(markerLayout)}`);
  console.log(`OK    Sprung ${segment.kategorie} ${segment.von.toFixed(3)} -> ${sprung.stelle.toFixed(3)} s`);
  console.log(`BILD  ${BILD}`);
  console.log(`MARKER-BILD  ${MARKER_BILD}`);
  console.log(`DISLIKE-BILD  ${DISLIKE_BILD}`);
}).then(() => beenden(0), async (fehler) => {
  const diagnose = await fenster?.webContents.executeJavaScript(`(() => {
    const media = document.querySelector("video.html5-main-video");
    const spieler = document.querySelector("#movie_player");
    let id = "";
    try { id = spieler && spieler.getVideoData().video_id || ""; } catch (_) {}
    return { title: document.title, url: location.href, id,
      duration: Number(media && media.duration) || 0,
      ad: Boolean(spieler && (spieler.classList.contains("ad-showing")
        || spieler.classList.contains("ad-interrupting"))),
      text: String(document.body && document.body.innerText || "").slice(0, 500) };
  })()`, true).catch(() => null);
  if (diagnose) console.error(`DIAG  ${JSON.stringify(diagnose)}`);
  console.error(`FAIL  ${fehler.stack}`);
  beenden(1);
});

function beenden(code) {
  clearTimeout(frist);
  fenster?.destroy();
  app.exit(code);
}
