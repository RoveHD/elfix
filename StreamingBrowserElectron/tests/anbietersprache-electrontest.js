"use strict";
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http"), vm = require("node:vm");
const direktlinks = require("../src/direktlinks"), direktquelle = require("../src/direktquelle"), direktlauf = require("../src/direktlauf");
const direktbeobachtung = require("../src/direktbeobachtung"), streamspur = require("../src/streamspur"), fassung = require("../src/fassung");
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "elfix-anbietersprache-")));
app.disableHardwareAcceleration();
const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
const funktion = name => { const start = main.search(new RegExp("(?:async )?function " + name + "\\(")); assert.ok(start >= 0, name); return main.slice(start, main.indexOf("\n}", start) + 2); };
let win, server;
const frist = setTimeout(() => ende(1, Error("Sprachtest Zeitlimit")), 20000);
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function warte(fn) { const bis = Date.now() + 6000; while (Date.now() < bis) { const wert = await fn(); if (wert) return wert; await pause(); } throw Error("Sprachtest: Zustand fehlt"); }
app.whenReady().then(async () => {
  let basis, posts = 0, manifestAnfragen = 0;
  const playlist = "#EXTM3U\n#EXT-X-TARGETDURATION:600\n#EXTINF:600,\nfilm.ts\n#EXT-X-ENDLIST\n";
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://fixture.test");
    if (url.pathname === "/r") {
      posts++; let body = ""; req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        const token = new URLSearchParams(body).get("t");
        res.setHeader("content-type", "text/html");
        res.end(`<script>parent.document.getElementById('player-prepare-token').value='';fetch('/film-${token}.m3u8')</script>`);
      }); return;
    }
    if (url.pathname.endsWith(".m3u8")) {
      manifestAnfragen++; res.setHeader("content-type", "application/vnd.apple.mpegurl"); res.end(playlist); return;
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(`<!doctype html><body>
      <button class="link-box" data-play-url="/r?t=frisch-de" data-provider-name="VOE" data-language-label="Deutsch">Deutsch</button>
      <button class="link-box active" data-play-url="/r?t=frisch-en" data-provider-name="VOE" data-language-label="Englisch">Englisch</button>
      <form id="player-prepare-form" method="POST" action="/r" target="player-iframe">
        <input name="t" id="player-prepare-token" value="frisch-en"><button id="weiter">Weiter</button>
      </form><iframe name="player-iframe"></iframe><script>
        document.querySelectorAll('[data-play-url]').forEach(node => node.onclick = () => {
          document.querySelectorAll('[data-play-url]').forEach(other => other.classList.remove('active'));
          node.classList.add('active');
          requestAnimationFrame(() => document.getElementById('player-prepare-token').value = new URL(node.dataset.playUrl,location.href).searchParams.get('t'));
        });
      </script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); basis = `http://127.0.0.1:${server.address().port}`;
  const episode = basis + "/serie/avatar/staffel-1/episode-4", browserSession = session.fromPartition("anbieter-sprache-fixture");
  // Offscreen: keine sichtbaren Fenster, kein Fokus und keine Desktopaufnahme.
  win = new BrowserWindow({ show: false, webPreferences: { session: browserSession, offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true } });
  win.webContents.setBackgroundThrottling(false);
  const view = { webContents: win.webContents }, signal = new AbortController();
  const alteKacheln = [
    { adresse: basis + "/r?t=alt-de", hoster: "VOE", sprache: "Deutsch", sichtbar: true },
    { adresse: basis + "/r?t=alt-en", hoster: "VOE", sprache: "Englisch", sichtbar: true }
  ];
  let lauf = { link: alteKacheln[0].adresse, hosterliste: alteKacheln };
  const c = vm.createContext({ Date, URL, URLSearchParams, Buffer, direktlinks, direktquelle, direktlauf, direktbeobachtung, streamspur, fassung,
    direktBeobachter: new Map(), browserSession, isLiveView: () => !win.isDestroyed(),
    episodeIdentity: url => url.includes("episode-") ? ({}) : null, isExpectedEpisodePage: (a, b) => a === b,
    fassungSchluesselFuer: () => "avatar", loadFassungen: () => ({ avatar: { key: "Deutsch", roh: "Deutsch" } }), rundenFassungFuer: () => null,
    providerModel: { isHttpUrl: url => /^https?:/.test(url), hostFromUrl: url => new URL(url).hostname },
    isKnownVideoHosterUrl: () => false,
    executeJavaScriptInMediaFrames: async () => [], direktAufloeserHolen: () => null });
  vm.runInContext(["fassungsname", "linkFuerFassung", "anbieterWunschWahl", "anbieterFormularToken", "anbieterQuelleBeobachten", "anbieterHosterWahl"].map(funktion).join("\n"), c);
  const beobachter = c.anbieterQuelleBeobachten(view, episode, frisch => c.anbieterWunschWahl({}, episode, lauf, {}, frisch));
  browserSession.webRequest.onBeforeRequest((details, callback) => {
    const formularToken = c.anbieterFormularToken(details);
    if (formularToken) c.direktBeobachter.get(details.webContentsId)?.({ formularToken, anfrageId: details.id, angefragt: true });
    callback({});
  });
  browserSession.webRequest.onResponseStarted(details => {
    if (details.statusCode >= 200 && details.statusCode < 400) c.direktBeobachter.get(details.webContentsId)?.({ adresse: details.url, anfrageId: details.id });
  });
  await win.loadURL(episode);
  await warte(() => beobachter.vorbereiten({ signal: signal.signal }));
  assert.equal(await win.webContents.executeJavaScript("document.getElementById('player-prepare-token').value"), "frisch-de", "Deutsche Kachel mit frischem Token vor Weiter");
  assert.equal(posts, 0, "Vorwahl klickt niemals Weiter oder sendet das Formular");
  assert.equal(manifestAnfragen, 0);
  // Auch wenn die Werkbank noch keine einzige Kachel lieferte, gilt die
  // gespeicherte Fassung bereits im frisch geladenen Originaldialog.
  lauf = { hosterliste: [] };
  await win.loadURL(episode);
  await warte(() => beobachter.vorbereiten({ signal: signal.signal }));
  assert.equal(await win.webContents.executeJavaScript("document.getElementById('player-prepare-token').value"), "frisch-de");
  assert.equal(posts, 0);
  const klickZeit = Date.now();
  await win.webContents.executeJavaScript("document.getElementById('weiter').click()");
  await warte(() => posts === 1 && manifestAnfragen > 0);
  const quelle = await warte(() => beobachter.pruefen({ signal: signal.signal, seit: klickZeit }));
  assert.ok(quelle.quelle.adresse.endsWith("/film-frisch-de.m3u8"));
  assert.ok(quelle.anbieterLinks.includes(basis + "/r?t=frisch-de"));
  assert.ok(!quelle.anbieterLinks.includes(basis + "/r?t=frisch-en"));
  const wahl = await c.anbieterHosterWahl(view, quelle, { link: alteKacheln[1].adresse, hosterliste: alteKacheln });
  assert.equal(wahl.link, basis + "/r?t=frisch-de", "Tatsaechlicher deutscher POST gilt auch gegen alten englischen Lauf");
  assert.equal(await beobachter.vorbereiten({ signal: signal.signal }), true, "Geleerte Form nach Weiter loest keine neue Auswahl aus");
  assert.equal(posts, 1, "Kein automatischer zweiter Weiter-Aufruf");
  beobachter.schliessen();
  console.log("OK Anbieter-Sprache: alte/frische Tokens, leere Werkbank, dynamische Originalform, keine automatische Bestaetigung, echter POST/Manifestbeleg und korrekte Fassung");
  ende(0);
}).catch(error => ende(1, error));
function ende(code, error) { clearTimeout(frist); if (error) console.error(error); if (win && !win.isDestroyed()) win.destroy(); server?.close(); app.exit(code); }
