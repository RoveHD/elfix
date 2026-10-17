"use strict";

// One complete desktop app per child process. Only provider/hoster responses
// are fixtures; Main, renderer, preload, player and relay traffic are real.
const { app, BrowserWindow, webContents, net } = require("electron");
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const config = JSON.parse(process.env.ELFIX_THREE_PC_CONFIG);
app.setPath("appData", config.profile);
app.setPath("userData", path.join(config.profile, "browser"));
app.setAppPath(path.resolve(__dirname, ".."));
app.disableHardwareAcceleration();
const data = path.join(config.profile, "ELFIX");
fs.mkdirSync(data, { recursive: true });
const write = (name, value) => fs.writeFileSync(path.join(data, name), JSON.stringify(value));
write("providers.json", [{ id: "sto", name: "S.to", startUrl: config.origin + "/",
  searchUrl: config.origin + "/suche?term={query}", enabled: true, adblockEnabled: false }]);
write("settings.json", { migrations: { youtubeProvider: true },
  adblock: { enabled: false, blockRedirects: false },
  watchparty: { enabled: true, rooms: [config.room], serverUrl: config.relay, deviceName: config.name },
  playback: { direktModus: true, pauseOnBlur: false, pauseOnMinimize: false },
  browser: { cacheMode: "normal" }, home: { showHero: false, showPersonal: false, showYoutube: false } });
// Existing membership and a saved room card, as after an ordinary app restart.
// The fixture deliberately uses an older address than the local provider.
const storedUrl = "http://s.to/serie/stream/avatar-die-sieben-hafen/staffel-1/episode-1";
const storedItem = { key: "serie:avatardiesiebenhafen", room: config.room, title: "Avatar Die Sieben Hafen",
  url: storedUrl, providerName: "S.to", type: "serie", season: 1, episode: 1 };
write("watchparty.json", { shared: [storedItem], joined: [{ key: storedItem.key, room: config.room }], left: [], roomOps: [] });
write("favorites.json", [{ ...storedItem, title: "Avatar - Die sieben Häfen", id: "avatar-party", providerId: "sto", watchpartyRoom: config.room,
  newEpisodeAt: new Date().toISOString(), newEpisodeLabel: "Folge 1 ist da",
  watched: true, continuePending: true, normalizedUrl: storedUrl, activity: [], createdAt: new Date().toISOString() }]);

// A valid, seekable media file, generated locally; no episode is downloaded.
const pcm = Buffer.alloc(180 * 8000, 128), media = Buffer.alloc(44 + pcm.length);
media.write("RIFF"); media.writeUInt32LE(media.length - 8, 4); media.write("WAVEfmt ", 8);
media.writeUInt32LE(16, 16); media.writeUInt16LE(1, 20); media.writeUInt16LE(1, 22);
media.writeUInt32LE(8000, 24); media.writeUInt32LE(8000, 28);
media.writeUInt16LE(1, 32); media.writeUInt16LE(8, 34); media.write("data", 36);
media.writeUInt32LE(pcm.length, 40); pcm.copy(media, 44);
const title = "Avatar - Die sieben Häfen", base = "/serie/avatar-die-sieben-hafen";
const page = episode => `<!doctype html><meta charset="utf-8"><title>${title} S01E0${episode} | SerienStream (S.to)</title>
  <meta property="og:title" content="${title}"><h1>${title}</h1>
  <a href="${base}/staffel-1">Staffel 1</a>
  ${[1, 2, 3].map(n => `<a href="${base}/staffel-1/episode-${n}">Episode ${n}</a>`).join("")}
  <button class="link-box" data-play-url="/r?t=${episode}" data-provider-name="VOE" data-language-label="Deutsch">VOE</button>`;
let heldEpisode = 0;
const heldResponses = new Set();
const mediaRequests = [];
const mediaServer = http.createServer(async (request, response) => {
  const trace = { at: Date.now(), url: request.url, method: request.method, range: request.headers.range,
    origin: request.headers.origin, referer: request.headers.referer };
  mediaRequests.push(trace);
  if (mediaRequests.length > 100) mediaRequests.shift();
  response.on("finish", () => { trace.finished = true; });
  response.on("close", () => { trace.closed = true; });
  const episode = Number(request.url.match(/(\d+)\.mp4/)?.[1]);
  if (heldEpisode === episode) await new Promise(resolve => {
    heldResponses.add(resolve);
    response.once("close", () => { heldResponses.delete(resolve); resolve(); });
  });
  if (response.destroyed) return;
  const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || "");
  const from = match ? Number(match[1]) : 0;
  const to = match?.[2] ? Math.min(Number(match[2]), media.length - 1) : media.length - 1;
  trace.status = match ? 206 : 200;
  response.writeHead(match ? 206 : 200, { "content-type": "audio/wav", "accept-ranges": "bytes",
    "content-length": String(to - from + 1), ...(match ? { "content-range": `bytes ${from}-${to}/${media.length}` } : {}) });
  response.end(media.subarray(from, to + 1));
});
const mediaReady = new Promise(resolve => mediaServer.listen(0, "127.0.0.1", resolve));
const fixtureRequests = [], fixtureSessions = [], contentsEvents = [];
const note = (list, value) => { list.push({ at: Date.now(), ...value }); if (list.length > 100) list.shift(); };
app.on("session-created", ses => {
  fixtureSessions.push(ses.getStoragePath());
  // The player's own production transport forwards to this provider session.
  if (!String(ses.getStoragePath()).endsWith("streaming-browser")) return;
  const respond = async request => {
    note(fixtureRequests, { method: request.method, url: request.url });
    const url = new URL(request.url);
    if (url.hostname === "localhost" && Number(url.port) === mediaServer.address().port) {
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    }
    if (!["s.to", "serienstream.to", "serienstream.cx", "186.2.175.5"].includes(url.hostname)) return new Response("Fixture: unavailable", { status: 404 });
    if (url.pathname === "/r") {
      await mediaReady;
      return new Response(`<video src="http://localhost:${mediaServer.address().port}/fixture-${url.searchParams.get("t")}.mp4"></video>`,
        { headers: { "content-type": "text/html" } });
    }
    // Model the same title opening under each PC's configured provider address.
    if (url.origin !== config.origin || url.pathname.startsWith("/serie/stream/")) {
      return Response.redirect(config.origin + url.pathname.replace("/serie/stream/", "/serie/") + url.search, 302);
    }
    await mediaReady;
    return new Response(page(Number(url.pathname.match(/episode-(\d+)/)?.[1]) || 1), { headers: { "content-type": "text/html" } });
  };
  ses.protocol.handle("http", respond);
  ses.protocol.handle("https", respond);
});

let shell;
app.on("web-contents-created", (_event, contents) => {
  note(contentsEvents, { id: contents.id, created: true });
  contents.on("did-start-navigation", (_e, url, _inPlace, mainFrame) => {
    if (mainFrame) note(contentsEvents, { id: contents.id, navigation: url });
  });
  for (const event of ["dom-ready", "did-frame-finish-load", "did-finish-load", "did-stop-loading", "unresponsive", "responsive"]) {
    contents.on(event, () => note(contentsEvents, { id: contents.id, event,
      pid: contents.getOSProcessId(), url: contents.getURL() }));
  }
  contents.on("destroyed", () => note(contentsEvents, { id: contents.id, destroyed: true }));
  contents.on("did-fail-load", (_e, code, description, url) => note(contentsEvents, { id: contents.id, code, description, url }));
  contents.on("console-message", details => note(contentsEvents, { id: contents.id, message: details.message }));
  contents.on("render-process-gone", (_e, details) => note(contentsEvents, { id: contents.id, gone: details }));
  contents.on("did-finish-load", () => {
    if (!contents.getURL().endsWith("/spieler.html")) return;
    contents.executeJavaScript(`for (const type of ['loadstart','loadedmetadata','loadeddata','canplay','playing','waiting','stalled','suspend','error']) {
      document.querySelector('video').addEventListener(type, event => console.log('fixture-media:' + JSON.stringify({
        type:event.type,ready:event.target.readyState,network:event.target.networkState,src:event.target.currentSrc,
        error:event.target.error?.message
      })));
    }`).catch(error => note(contentsEvents, { id: contents.id, observationError: error.message }));
  });
});
app.on("browser-window-created", (_event, window) => {
  window.setOpacity(process.env.CI ? 1 : 0);
  // Keep the real visible-window lifecycle without foregrounding or painting
  // test windows. Permanently hidden windows can defer Chromium media loads.
  window.show = () => window.showInactive();
  window.webContents.setAudioMuted(true);
  window.webContents.on("did-finish-load", () => {
    if (!window.webContents.getURL().endsWith("/index.html")) return;
    shell = window;
    process.send?.({ ready: true });
  });
});
const player = () => webContents.getAllWebContents().find(wc => wc.getURL().endsWith("/spieler.html"));
process.on("message", async message => {
  try {
    let result;
    if (message.action === "quit") { app.exit(0); return; }
    if (message.action === "hold") { heldEpisode = message.episode; result = true; }
    else if (message.action === "release") {
      heldEpisode = 0;
      for (const release of heldResponses) release();
      heldResponses.clear(); result = true;
    }
    else if (message.action === "fixture-status") result = { heldEpisode, pendingResponses: heldResponses.size };
    else if (message.action === "diagnostics") result = {
      at: Date.now(), locale: app.getLocale(), versions: process.versions, config, fixtureSessions, fixtureRequests, contentsEvents,
      mediaRequests, mediaAddress: mediaServer.address(), metrics: app.getAppMetrics(),
      windows: BrowserWindow.getAllWindows().map(window => ({ visible: window.isVisible(),
        minimized: window.isMinimized(), opacity: window.getOpacity(), bounds: window.getBounds() })),
      heldEpisode, pendingResponses: heldResponses.size,
      contents: webContents.getAllWebContents().map(wc => ({ id: wc.id,
        pid: wc.getOSProcessId(), url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading() }))
    };
    else if (message.action === "diagnostic-pages") {
      const bounded = work => Promise.race([work.catch(error => ({ error: error.stack })),
        new Promise(resolve => setTimeout(() => resolve({ error: "Diagnostic page query exceeded 1500ms" }), 1500))]);
      result = {
        contents: await Promise.all(webContents.getAllWebContents().map(async wc => ({ id: wc.id,
          page: await bounded(wc.executeJavaScript("({url:location.href,title:document.title,visibility:document.visibilityState,body:document.body?.innerText.slice(0,2000)})")) }))),
        state: shell && await bounded(shell.webContents.executeJavaScript(`(async () => ({
        init: await streamingBrowser.init(), live:watchpartyLiveOn,room:watchpartyLiveRoom,
        route:currentRoute,startRuhe,
        items:await streamingBrowser.getWatchpartyItems(),status:await streamingBrowser.getWatchpartyStatus()
      }))()`, true)) };
    }
    else if (message.action === "player") result = player() ? await player().executeJavaScript(message.code, true) : null;
    else result = await shell.webContents.executeJavaScript(message.code, true);
    process.send?.({ id: message.id, result });
  } catch (error) { process.send?.({ id: message.id, error: error.stack }); }
});
require("../src/main.js");
