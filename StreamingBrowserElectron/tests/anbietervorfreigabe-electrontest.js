"use strict";
const { app, BrowserWindow, WebContentsView, session, webFrameMain } = require("electron");
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http"), vm = require("node:vm");
const anbieter = require("../src/anbieteransicht"), tor = require("../src/verifizierungstor"), direktlinks = require("../src/direktlinks");
const direktquelle = require("../src/direktquelle"), direktlauf = require("../src/direktlauf"), direktbeobachtung = require("../src/direktbeobachtung"), streamspur = require("../src/streamspur");
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "elfix-vorfreigabe-")));
app.disableHardwareAcceleration();
const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
const funktion = name => { const start = main.search(new RegExp("(?:async )?function " + name + "\\(")); assert.ok(start >= 0, name); return main.slice(start, main.indexOf("\n}", start) + 2); };
const maskeCallback = main.match(/^\s*maskeScript:\s*(.+),\s*$/m);
assert.ok(maskeCallback, "Produktiver Maskenadapter");
const produktiveMaske = vm.runInNewContext("(" + maskeCallback[1] + ")", { verifizierungstor: tor });
let parent, server, hosterServer, controller, gehalten;
const frist = setTimeout(() => ende(1, Error("Vorfreigabe Zeitlimit")), 30000);
async function warte(fn, beschreibung) { const bis = Date.now() + 5000; while (Date.now() < bis) { const wert = await fn(); if (wert) return wert; await new Promise(resolve => setTimeout(resolve, 20)); } throw Error(beschreibung || "Vorfreigabe-Zustand fehlt"); }
app.whenReady().then(async () => {
  let basis, hosterBasis, posts = 0, probes = 0, vorbereitungen = 0;
  const playlist = "#EXTM3U\n#EXT-X-TARGETDURATION:600\n#EXTINF:600,\nfilm.ts\n#EXT-X-ENDLIST\n";
  const antworten = (req, res) => {
    const url = new URL(req.url, "http://fixture.test"), mode = url.searchParams.get("mode") || "frei";
    if (url.pathname === "/r") {
      if (req.method === "POST") {
        posts++; req.resume(); req.on("end", () => { res.setHeader("content-type","text/html");res.end(`<script>location.href=${JSON.stringify(hosterBasis+"/hoster/de?mode="+mode)}</script>`); });
      } else if(mode === "ohne-beleg") { res.end("Blanker Provider-Rahmen"); }
      else { res.setHeader("content-type","text/html");res.end(`<script>location.href=${JSON.stringify(hosterBasis+"/hoster/"+url.searchParams.get("t")+"?mode="+mode)}</script>`); }
      return;
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (url.pathname.startsWith("/film-")) {
      probes++; if (["dialog","abbruch","spaeter-dialog"].includes(mode)) { gehalten = res; return; }
      res.setHeader("content-type", "application/vnd.apple.mpegurl"); res.end(mode === "kurz" ? playlist.replaceAll("600", "10") : playlist); return;
    }
    if (url.pathname.startsWith("/hoster/")) {
      const sprache = url.pathname.endsWith("/de") ? "de" : "en";
      res.end(`<body>Hoster Play 0 seconds${mode === "fremdframe" ? "" : `<script>window.sources=[{file:"${hosterBasis}/film-${sprache}.m3u8?mode=${mode}"}]</script>`}</body>`); return;
    }
    const de = "/r?t=de&mode=" + mode, en = "/r?t=en&mode=" + mode;
    res.end(`<!doctype html><style>body{margin:0;height:1800px}.modal{position:fixed;inset:0;overflow-y:auto}.modal-content{width:480px;margin:70px auto;background:white;padding:20px}button{padding:12px}</style>
      <body><h1>Provider Aussenwelt</h1><button class="link-box ${mode === "falscher-rahmen" ? "active" : ""}" data-play-url="${de}" data-provider-name="VOE" data-language-label="Deutsch">Deutsch VOE</button>
      <button class="link-box ${mode === "falscher-rahmen" ? "" : "active"}" data-play-url="${en}" data-provider-name="VOE" data-language-label="Englisch">English VOE</button>
      <iframe id="player-iframe" name="player-iframe" src="${en}"></iframe>
      ${mode === "fremdframe" ? '<iframe name="werbung" src="'+hosterBasis+'/hoster/de?mode=frei"></iframe>' : ''}
      <div id="playerPrepareModal" class="modal" style="display:${mode === "dialog" ? "block" : "none"}"><div class="modal-content"><h5>Video wird vorbereitet...</h5>
      <form id="player-prepare-form" action="/r?mode=${mode}" method="POST" target="player-iframe"><input id="player-prepare-token" name="t" value="${mode === "dialog" ? "en" : ""}"><button id="weiter">Weiter</button></form></div></div>
      <script>document.querySelectorAll('[data-play-url]').forEach(node=>node.onclick=()=>{
        document.querySelectorAll('[data-play-url]').forEach(other=>other.classList.remove('active'));node.classList.add('active');
        requestAnimationFrame(()=>{const iframe=document.getElementById('player-iframe');${mode === "ohne-beleg" ? `let direkt=false;iframe.onload=()=>{if(!direkt){direkt=true;iframe.contentWindow.location=${JSON.stringify(hosterBasis+"/hoster/de?mode="+mode)}}};` : ""}iframe.src=node.dataset.playUrl;${mode === "dialog" ? "document.getElementById('player-prepare-token').value=new URL(node.dataset.playUrl,location.href).searchParams.get('t');" : ""}});
      });document.getElementById('player-prepare-form').onsubmit=()=>{document.getElementById('playerPrepareModal').style.display='none';requestAnimationFrame(()=>document.getElementById('player-prepare-token').value='')};</script>`);
  };
  server = http.createServer(antworten); hosterServer = http.createServer(antworten);
  await new Promise(resolve => hosterServer.listen(0, "127.0.0.1", resolve)); hosterBasis = `http://localhost:${hosterServer.address().port}`;
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); basis = `http://127.0.0.1:${server.address().port}`;
  const browserSession = session.fromPartition("vorfreigabe-fixture"), views = [], commits = [];
  parent = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: { offscreen: true } });
  parent.isVisible = () => true; parent.focus = () => {}; parent.webContents.focus = () => {};
  await parent.loadURL("data:text/html,<body>Bestehender Player</body>");
  controller = anbieter.erstellen({ WebContentsView: function(options) { const view = new WebContentsView(options); view.webContents.focus = () => {}; views.push(view); return view; },
    eltern: () => parent, sitzung: () => browserSession, zustandScript: () => `(window.proben=(window.proben||0)+1,${tor.zustandScript()})`, maskeScript: produktiveMaske, persistieren: async () => {} });
  const c = vm.createContext({ Date, URL, URLSearchParams, Buffer, AbortController, AbortSignal, webFrameMain, direktlinks, direktquelle, direktlauf, direktbeobachtung, streamspur,
    direktBeobachter: new Map(), browserSession, direktLaden: new AbortController(), direktAnbieterFallback: { aktuell: null }, menschentorFenster: null,
    anbieterSeitenAnsicht: controller, spielerTakt: { stelle: 0 }, isContentFullscreen: false,
    episodeIdentity: url => url.includes("episode-") ? ({}) : null, seiteGleich: (a,b) => a === b, isExpectedEpisodePage: (a,b) => a === b,
    shouldBlockProviderNavigation: ziel => !ziel.startsWith(basis), isLiveView: view => !view.webContents.isDestroyed(),
    providerModel: { isHttpUrl: url => /^https?:/.test(url), hostFromUrl: url => new URL(url).hostname }, isKnownVideoHosterUrl: () => false,
    anbieterWunschWahl: (_provider,_url,_lauf,_options,frisch) => frisch.find(e => e.sprache === "Deutsch"), sanitizePositiveNumber: n => Math.max(0,Number(n)||0),
    watchpartyLiveKeyForUrl: () => "", watchpartyRaumForUrl: () => "", watchpartyZustandUebernehmen() {}, direktAufloeserHolen: () => null,
    executeJavaScriptInMediaFrames: async (view, script) => (await Promise.all([view.webContents.mainFrame,...view.webContents.mainFrame.frames].map(frame => frame.executeJavaScript(script).catch(()=>null)))).filter(Boolean),
    direktSpielerOeffnen: async (_provider,url,ergebnis) => { commits.push({url,ergebnis}); c.spielerLauf={...c.spielerLauf,id:c.spielerLauf.id+1,quelle:ergebnis.quelle};return true; }
  });
  vm.runInContext(["direktAuftragBeginnen","anbieterSeiteOeffnen","anbieterQuelleBeobachten","anbieterFormularToken","anbieterAnfrageErfassen","anbieterHosterWahl"].map(funktion).join("\n"), c);
  const quelleBeobachten=c.anbieterQuelleBeobachten;
  c.anbieterQuelleBeobachten=(...args)=>{
    const quelle=quelleBeobachten(...args), vorbereiten=quelle.vorbereiten;
    quelle.vorbereiten=async (...options)=>{vorbereitungen++;return vorbereiten(...options)};return quelle;
  };
  browserSession.webRequest.onBeforeRequest((details,callback) => {
    // Der Provider-POST wird absichtlich OHNE lesbares uploadData gespiegelt.
    // Der aktuelle Frame-/Auswahlbeleg muss auch dann funktionieren.
    c.anbieterAnfrageErfassen({...details,frame:null,uploadData:[]});
    callback({});
  });
  browserSession.webRequest.onResponseStarted(details => {
    if (details.statusCode>=200&&details.statusCode<400) c.direktBeobachter.get(details.webContentsId)?.({ adresse:details.url,anfrageId:details.id,rahmen:details.referrer||"" });
  });
  async function oeffnen(mode) {
    c.direktLaden.abort(); c.direktLaden=new AbortController();
    const url=basis+"/serie/avatar/staffel-1/episode-2?mode="+mode;
    c.spielerLauf={id:1,providerId:"sto",url,quelle:{adresse:""},hosterliste:[]};
    const fertig=c.anbieterSeiteOeffnen({id:"sto"},url,c.direktLaden.signal), [decke,view]=views.slice(-2);
    return {fertig,decke,seite:view.webContents};
  }
  let offen=await oeffnen("frei");
  await warte(()=>commits.length===1,"Vorfreigegebene deutsche Quelle wird ohne Weiterdialog nicht uebernommen");
  assert.equal(await offen.fertig,"uebernommen"); assert.equal(posts,0);
  assert.ok(commits[0].ergebnis.quelle.adresse.includes("film-de.m3u8")); assert.ok(commits[0].ergebnis.link.includes("t=de"));
  assert.equal(commits[0].ergebnis.hoster,"VOE","Hostername stammt aus der belegten Kachel statt aus dem unbekannten Alias");
  offen=await oeffnen("dialog");
  await warte(()=>offen.decke.webContents.executeJavaScript("document.body.dataset.phase==='dialog'"));
  await warte(()=>offen.seite.executeJavaScript("window.proben>=3"));
  assert.equal(commits.length,1,"Vorhandener Hoster umgeht keinen echten Originaldialog"); assert.equal(posts,0);
  const punkt=await offen.seite.executeJavaScript("(()=>{const r=document.getElementById('weiter').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
  offen.seite.sendInputEvent({type:"mouseDown",...punkt,button:"left",clickCount:1}); offen.seite.sendInputEvent({type:"mouseUp",...punkt,button:"left",clickCount:1});
  await warte(()=>Boolean(gehalten));
  assert.equal(await offen.seite.executeJavaScript("document.getElementById('__elfixAnbieterLaden')?.textContent"),"Video wird geladen …","Produktiver main.js-Adapter reicht die Ladephase bis in die DOM-Maske durch");
  await offen.seite.executeJavaScript("new Promise(resolve=>requestAnimationFrame(()=>{const node=document.getElementById('__elfixAnbieterLaden');window.__loaderProbe={node,animation:document.getAnimations().find(a=>node.contains(a.effect?.target))};resolve(true)}))");
  for(let tick=0;tick<4;tick++) await offen.seite.executeJavaScriptInIsolatedWorld(987,[{code:produktiveMaske("probe","laden")}]);
  assert.equal(await offen.seite.executeJavaScript("(()=>{const p=window.__loaderProbe;return p.node===document.getElementById('__elfixAnbieterLaden')&&p.animation===document.getAnimations().find(a=>p.node.contains(a.effect?.target))})()"),true,"Loader-DOM und dieselbe laufende Animation bleiben ueber wiederholte Maskenticks erhalten");
  gehalten.end(playlist);gehalten=null;
  await warte(()=>commits.length===2,"Echtes Weiter ohne uploadData-Beleg bleibt im Loader haengen"); assert.equal(await offen.fertig,"uebernommen");assert.equal(posts,1);
  assert.ok(commits[1].ergebnis.quelle.adresse.includes("film-de.m3u8"));assert.ok(commits[1].ergebnis.link.includes("t=de"));
  for(const mode of ["falscher-rahmen","ohne-beleg","fremdframe"]) {
    const vorbereitung=vorbereitungen, vorherigeProben=probes;offen=await oeffnen(mode);
    await warte(()=>vorbereitungen>=vorbereitung+4);
    assert.equal(commits.length,2,mode+": weder fremde Fassung noch unbelegter oder fremder Frame wird uebernommen");
    assert.equal(probes,vorherigeProben,mode+": fremde Quellen werden nicht einmal zur Playlistprobe zugelassen");
    assert.equal(await offen.seite.executeJavaScript("[getComputedStyle(document.documentElement).overflow,getComputedStyle(document.body).overflow,getComputedStyle(document.documentElement).scrollbarWidth].join('|')"),"hidden|hidden|none","Provider-Scrollbar bleibt hinter der Maske verschwunden");
    c.direktLaden.abort();assert.equal(await offen.fertig,"geschlossen");
  }
  const vorProbe=probes; offen=await oeffnen("kurz"); await warte(()=>probes>vorProbe); await warte(()=>offen.seite.executeJavaScript("window.proben>=3"));
  assert.equal(commits.length,2,"Kurze Werbung ist auch ohne Dialog keine Folge");c.direktLaden.abort();assert.equal(await offen.fertig,"geschlossen");
  offen=await oeffnen("abbruch");await warte(()=>Boolean(gehalten));c.direktLaden.abort();assert.equal(await offen.fertig,"geschlossen");gehalten.end(playlist);gehalten=null;
  assert.equal(commits.length,2,"Abgebrochene Playlistprobe uebernimmt nichts");
  offen=await oeffnen("spaeter-dialog");await warte(()=>Boolean(gehalten));
  await offen.seite.executeJavaScript("document.getElementById('playerPrepareModal').style.display='block';document.getElementById('player-prepare-token').value='de'");
  gehalten.end(playlist);gehalten=null;
  await warte(()=>offen.decke.webContents.executeJavaScript("document.body.dataset.phase==='dialog'"));
  assert.equal(commits.length,2,"Spaet geoeffnete echte Challenge sperrt auch eine inzwischen erfolgreich gepruefte Quelle");
  c.direktLaden.abort();assert.equal(await offen.fertig,"geschlossen");
  console.log("OK Vorfreigabe: GET/POST ohne uploadData, unbekannter Alias nur im belegten Frame, richtige Fassung, echte/spaete Challenge, Fremdframe/fehlender Beleg, Scrollbar, Werbung und Abort; alles offscreen");
}).then(()=>ende(0),error=>ende(1,error));
function ende(code,error) { if(error)console.error(error);clearTimeout(frist);gehalten?.end();controller?.schliessen();if(parent&&!parent.isDestroyed())parent.destroy();server?.close();hosterServer?.close();app.exit(code); }
