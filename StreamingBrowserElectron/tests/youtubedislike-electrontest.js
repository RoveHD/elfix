"use strict";

// Deterministische Electron-DOM-Pruefung; ELFIX_REAL_YOUTUBE=1 erweitert sie
// um einen echten YouTube-/RYD-Lauf.
const assert = require("assert/strict");
const { app, BrowserWindow, session, net } = require("electron");
const os = require("os");
const fs = require("fs");
const path = require("path");
const dislikes = require("../src/youtube-dislikes");
const VIDEO_ID = "dQw4w9WgXcQ";
const VIDEO_B = "9bZkp7q19f0";
const FIXTURE = path.join(__dirname, "fixtures", "youtube-dislike-controls.html");
const profil = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-youtube-dislike-"));
let fenster;

function warten(pruefen, ms = 5000) {
  const bis = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const takt = async () => {
      try { const wert = await pruefen(); if (wert) return resolve(wert); } catch (_) {}
      if (Date.now() >= bis) return reject(Error("Fixture-Zustand blieb aus"));
      setTimeout(takt, 40);
    };
    takt();
  });
}

function controlsScript(id) {
  return `(() => {
    document.querySelector('#segmented-dislike-button')?.remove();
    document.querySelectorAll('[data-elfix-hidden-dislike]').forEach(el => el.remove());
    // YouTube haelt versteckte Duplikate fuer Uebergaenge und Vorlagen im DOM.
    // Der erste passende Selektor darf daher nicht automatisch der sichtbare sein.
    const verborgen = document.createElement('div'); verborgen.id = 'segmented-dislike-button';
    verborgen.dataset.elfixHiddenDislike = '1';
    verborgen.style.display = 'none';
    const verborgenKnopf = document.createElement('button'); verborgenKnopf.textContent = 'Ablehnen';
    verborgen.appendChild(verborgenKnopf); document.querySelector('#watch-metadata').appendChild(verborgen);
    const gruppe = document.createElement('div'); gruppe.id = 'segmented-dislike-button';
    const knopf = document.createElement('button'); knopf.textContent = 'Ablehnen'; gruppe.appendChild(knopf);
    document.querySelector('#watch-metadata').appendChild(gruppe);
    document.querySelector('#movie_player').getVideoData = () => ({ video_id: ${JSON.stringify(id)} });
  })()`;
}

app.setPath("userData", profil);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-software-rasterizer");
app.whenReady().then(async () => {
  fenster = new BrowserWindow({ show: false, width: 900, height: 500, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
  } });
  await fenster.loadFile(FIXTURE, { query: { v: VIDEO_ID } });
  const lesen = code => fenster.webContents.executeJavaScript(code, true);
  await lesen(dislikes.anzeigeScript({ videoId: VIDEO_ID, dislikes: 518406 }));
  assert.equal(await lesen("document.querySelector('.elfix-youtube-dislike-count')"), null,
    "ohne Bedienelement darf kein Wert entstehen");

  // SPA-Adresse und alter Player widersprechen sich: keine falsche Zahl.
  await lesen(controlsScript("anderesVideo1"));
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(await lesen("document.querySelector('.elfix-youtube-dislike-count')"), null,
    "eine alte Player-ID darf keinen Wert zeigen");
  await lesen(`document.querySelector('#movie_player').getVideoData = () => ({ video_id: ${JSON.stringify(VIDEO_ID)} });
    document.dispatchEvent(new Event('yt-navigate-finish', { bubbles: true }));`);
  const erster = await warten(() => lesen(`(() => {
    const wert = document.querySelector('.elfix-youtube-dislike-count');
    const knopf = Array.from(document.querySelectorAll('#segmented-dislike-button button'))
      .find(el => el.getClientRects().length);
    return wert && knopf && knopf.contains(wert) ? { text: wert.textContent, title: wert.title } : null;
  })()`));
  assert.match(erster.text, /\d/);
  assert.match(erster.title, /Geschätzte.*Return YouTube Dislike/);

  // YouTube darf die ganze Bedienelementgruppe ersetzen.
  await lesen(controlsScript(VIDEO_ID));
  assert.equal(await warten(() => lesen("Array.from(document.querySelectorAll('#segmented-dislike-button button')).some(el => el.getClientRects().length && el.querySelector('.elfix-youtube-dislike-count'))")), true,
    "ein ersetzter Knopf bekommt den Wert erneut");

  // Eine neue Desktop-Injektion fuer das naechste SPA-Video aktualisiert
  // dieselbe Beobachtung; sie darf nicht am alten `neu` haengenbleiben.
  await lesen(`history.replaceState({}, '', '?v=${VIDEO_B}');`);
  await lesen(controlsScript(VIDEO_B));
  await lesen(dislikes.anzeigeScript({ videoId: VIDEO_B, dislikes: 12 }));
  assert.equal(await warten(() => lesen("document.querySelector('.elfix-youtube-dislike-count')?.getAttribute('aria-label')")),
    "Geschätzte Ablehnungen: 12. Geschätzte Ablehnungen von Return YouTube Dislike (returnyoutubedislike.com)");
  await lesen(dislikes.anzeigeScript({ videoId: VIDEO_B, dislikes: 34 }));
  assert.equal(await warten(() => lesen("document.querySelector('.elfix-youtube-dislike-count')?.getAttribute('aria-label') === 'Geschätzte Ablehnungen: 34. Geschätzte Ablehnungen von Return YouTube Dislike (returnyoutubedislike.com)'")), true,
    "ein neuer Wert desselben Videos wird sichtbar aktualisiert");

  // Nach einer stabilen Anzeige duerfen die eigenen textContent-Schreibungen
  // keinen MutationObserver-Kreis erzeugen.
  await lesen(`window.__fixtureMutationen = 0;
    new MutationObserver(() => { window.__fixtureMutationen += 1; })
      .observe(document.body, { childList: true, subtree: true, characterData: true });`);
  await new Promise(resolve => setTimeout(resolve, 420));
  assert.ok(await lesen("window.__fixtureMutationen") <= 1,
    "die Anzeige bleibt im Leerlauf ohne Mutationsschleife");

  await lesen(dislikes.abstellenScript());
  assert.equal(await lesen("document.querySelector('.elfix-youtube-dislike-count')"), null,
    "Ausschalten raeumt die Anzeige weg");
  await lesen(controlsScript(VIDEO_ID));
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(await lesen("document.querySelector('.elfix-youtube-dislike-count')"), null,
    "nach Abschalten bleibt ein Ersatzknopf sauber");
  console.log("OK Fixture: verzögert, SPA-sicher, DOM-Ersatz und Abschalten");

  if (process.env.ELFIX_REAL_YOUTUBE !== "1") {
    console.log("SKIP Echter YouTube-DOM: ELFIX_REAL_YOUTUBE=1 setzen.");
    return;
  }
  console.log("LIVE Echter YouTube-DOM startet.");
  const realId = process.env.ELFIX_YOUTUBE_DISLIKE_VIDEO || "kJQP7kiw5Fk";
  const ses = session.defaultSession;
  await ses.cookies.set({ url: "https://www.youtube.com", name: "SOCS", value: "CAI",
    secure: true, sameSite: "lax" }).catch(() => {});
  // Dasselbe Fenster und dieselbe Sitzung halten den Electron-Lauf stabil;
  // ein zweites Fenster kann in dieser Testumgebung den App-Lebenszyklus
  // beenden, bevor dessen Navigation wirklich begonnen hat.
  fenster.webContents.setAudioMuted(true);
  fenster.webContents.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    + "(KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36");
  const live = code => fenster.webContents.executeJavaScript(code, true);
  const antwort = await net.fetch(dislikes.anfrageUrl(realId), { signal: AbortSignal.timeout(15000) });
  assert.equal(antwort.ok, true, `RYD API HTTP ${antwort.status}`);
  const echt = dislikes.datenAus(await antwort.json(), realId);
  assert.ok(echt, "RYD-Antwort enthielt keine lesbare Schaetzung");
  await fenster.loadURL(`https://www.youtube.com/watch?v=${realId}`).catch(fehler => {
    if (fehler?.code !== "ERR_ABORTED") throw fehler;
  });
  await live(`(() => Array.from(document.querySelectorAll('button, tp-yt-paper-button'))
    .find((el) => /reject all|alle ablehnen/i.test(el.textContent || ''))?.click())()`);
  const bereit = await warten(() => live(`(() => {
    const media = document.querySelector('video.html5-main-video');
    const player = document.querySelector('#movie_player');
    let id = ''; try { id = player && player.getVideoData().video_id || ''; } catch (_) {}
    const werbung = Boolean(player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting')));
    if (werbung && media) { media.playbackRate = 16; media.play().catch(() => {}); }
    document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button-modern')?.click();
    return !werbung && media && Number(media.duration) > 30 && document.querySelector('.ytp-progress-bar-container')
      ? { id, url: location.href, title: document.title } : null;
  })()`), 70000);
  assert.equal(bereit.id, realId, `YouTube lud ${bereit.id || 'keine Kennung'}`);
  await live(dislikes.anzeigeScript(echt));
  const diagnose = () => live(`(() => ({
    url: location.href, title: document.title,
    kandidaten: Array.from(document.querySelectorAll('dislike-button-view-model, #segmented-dislike-button, ytd-segmented-like-dislike-button-renderer'))
      .map(el => ({ tag: el.tagName, id: el.id, klasse: el.className, html: el.outerHTML.slice(0, 500) })),
    knoepfe: Array.from(document.querySelectorAll('button')).filter(el => /dislike|ablehnen/i.test((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '')))
      .slice(0, 10).map(el => ({ aria: el.getAttribute('aria-label'), text: el.textContent, klasse: el.className }))
  }))()`);
  let real;
  try {
    real = await warten(() => live("document.querySelector('.elfix-youtube-dislike-count')?.textContent"), 50000);
  } catch (fehler) {
    throw Error(`${fehler.message}; Diagnose: ${JSON.stringify(await diagnose())}`);
  }
  assert.match(real, /\d/);
  console.log(`OK Echter YouTube-DOM: ${realId}, Anzeige ${real}`);
}).then(() => beenden(0), fehler => { console.error(`FAIL ${fehler.stack || fehler}`); beenden(1); });

function beenden(code) {
  fenster?.destroy();
  // Chromium kann die Profilablage noch einen Moment festhalten. Das darf eine
  // erfolgreiche DOM-Pruefung nicht nachtraeglich als unhandled rejection
  // erscheinen lassen; der temporaere Ordner ist ohnehin wegwerfbar.
  try { fs.rmSync(profil, { recursive: true, force: true }); } catch (_) {}
  app.exit(code);
}
