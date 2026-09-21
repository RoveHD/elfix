"use strict";

// Der Vollbildknopf nach dem Mini-Player.
//
// Der Fehler dahinter: wer den Mini-Player aufmacht und danach wieder in den
// Player zurueckkehrt, konnte das Vollbild nicht mehr einschalten. Der Knopf
// tat nichts, kein Fehler, keine Meldung.
//
// Der Grund lag nicht im Knopf. enterHomeMode() gibt fuers Stoebern waehrend
// des Mini-Players `activeView` bewusst ab - vorne liegt die Oberflaeche, und
// die Anwesenheit gehoert solange dem Player. Nur nahm die Rueckkehr sie nicht
// wieder auf, und enterContentFullscreen() stieg ohne aktive Ansicht als
// Erstes aus. Also wird hier beides geprueft: dass die Rueckkehr die Werkbank
// wieder fuehrt, und dass das Vollbild auch ohne Anbieteransicht geht, solange
// der eigene Player laeuft.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");

function quelle(name) {
  const treffer = main.match(new RegExp(`(?:async )?function ${name}\\([^]*?^}`, "m"));
  assert.ok(treffer, `${name} fehlt`);
  return treffer[0];
}

function handler(kanal) {
  const start = main.indexOf(`ipcMain.on("${kanal}",`);
  assert.ok(start >= 0, `${kanal} fehlt`);
  return main.slice(start, main.indexOf("\n});", start) + 4);
}

const url = "https://aniworld.example/anime/stream/serie/staffel-1/episode-2";
const playerContents = { isDestroyed: () => false };
const providerContents = {
  isDestroyed: () => false,
  getURL: () => url,
  setAudioMuted() {},
  executeJavaScript: () => Promise.resolve()
};
const providerView = { webContents: providerContents };
const playerView = {
  webContents: playerContents,
  setVisible() {},
  setBounds(bounds) { playerView.bounds = bounds; },
  bounds: null
};

function buehne() {
  const handlers = new Map();
  const fensterVollbild = [];
  const kontext = vm.createContext({
    activeView: providerView,
    activeProviderId: "provider-a",
    attachedProviderViews: new Set(["provider-a"]),
    browserBounds: { x: 40, y: 80, width: 1120, height: 700 },
    clamp: (wert, min, max) => Math.max(min, Math.min(max, wert)),
    ipcMain: { on: (name, rueckruf) => handlers.set(name, rueckruf) },
    isContentFullscreen: false,
    isLiveView: (view) => Boolean(view && view.webContents && !view.webContents.isDestroyed()),
    installContentFullscreenExitOverlay() {},
    applyBrowserBounds() {},
    sendFullscreenState() {},
    sendActiveState() {},
    optionaleCachesNachMiniPlanen() {},
    pauseActivePlayback() {},
    setOverlayOpen: (grund, an) => (an
      ? kontext.overlayReasons.add(grund)
      : kontext.overlayReasons.delete(grund)),
    overlayReasons: new Set(),
    providerViews: new Map([["provider-a", providerView]]),
    settings: { playback: { pauseOnMinimize: false } },
    spielerLauf: { id: 7, providerId: "provider-a", url },
    spielerMiniAktiv: false,
    spielerMiniVorbereitung: false,
    spielerView: playerView,
    mainWindow: {
      isDestroyed: () => false,
      isMinimized: () => false,
      getContentSize: () => [1600, 900],
      setFullScreen: (an) => fensterVollbild.push(an),
      contentView: { removeChildView() {}, addChildView() {} },
      webContents: { send() {} }
    },
    Boolean, Number, String
  });

  for (const name of [
    "spielerMiniBehalten", "spielerImVordergrund", "werkbankNachMiniZurueck",
    "spielerLageSetzen", "enterHomeMode", "enterContentFullscreen",
    "leaveContentFullscreen", "vomSpieler"
  ]) vm.runInContext(quelle(name), kontext);

  vm.runInContext(handler("spieler:mini-status"), kontext);
  vm.runInContext(handler("spieler:vollbild"), kontext);
  return { kontext, handlers, fensterVollbild };
}

const vomPlayer = { sender: playerContents };
const { kontext, handlers, fensterVollbild } = buehne();

// --- Hinein in den Mini-Player ----------------------------------------------

handlers.get("spieler:mini-status")(vomPlayer, true, false);
assert.equal(kontext.spielerMiniAktiv, true, "der Mini-Player laeuft");
assert.equal(kontext.activeView, null, "waehrend des Stoeberns fuehrt keine Anbieteransicht");
assert.equal(kontext.overlayReasons.has("shell"), true, "die Oberflaeche liegt vorn");

// --- Und wieder zurueck ------------------------------------------------------

handlers.get("spieler:mini-status")(vomPlayer, false, false);
assert.equal(kontext.spielerMiniAktiv, false, "der Mini-Player ist zu");
assert.equal(kontext.activeView, providerView, "die Werkbank fuehrt wieder");
assert.equal(kontext.activeProviderId, "provider-a", "und zwar die des laufenden Films");
assert.equal(kontext.overlayReasons.size, 0, "kein Vorhang mehr");

// --- Der Knopf, um den es geht ----------------------------------------------

handlers.get("spieler:vollbild")(vomPlayer);
assert.equal(kontext.isContentFullscreen, true, "der Vollbildknopf schaltet nach dem Mini-Player ein");
assert.equal(fensterVollbild.at(-1), true, "und das Fenster geht mit");
// Von Hand verglichen und nicht mit deepEqual: das Objekt entsteht im
// vm-Kontext und traegt dessen Object.prototype.
const lage = kontext.spielerView.bounds;
assert.equal(`${lage.x},${lage.y},${lage.width},${lage.height}`, "0,0,1600,900",
  "der Player fuellt das Bild");

handlers.get("spieler:vollbild")(vomPlayer);
assert.equal(kontext.isContentFullscreen, false, "und derselbe Knopf wieder aus");
assert.equal(fensterVollbild.at(-1), false, "auch hier geht das Fenster mit");

// --- Ohne Werkbank, aber mit Player -----------------------------------------
//
// Die Werkbank kann weg sein - ein Hoster in eigener Ansicht, eine geschlossene
// Folgenseite. Solange der eigene Player laeuft, ist er selbst das Bild, und
// das Vollbild muss trotzdem gehen.

const ohne = buehne();
ohne.kontext.providerViews.clear();
ohne.handlers.get("spieler:mini-status")(vomPlayer, true, false);
ohne.handlers.get("spieler:mini-status")(vomPlayer, false, false);
assert.equal(ohne.kontext.activeView, null, "ohne Werkbank gibt es nichts zurueckzuholen");
ohne.handlers.get("spieler:vollbild")(vomPlayer);
assert.equal(ohne.kontext.isContentFullscreen, true,
  "der Player kommt auch ohne Anbieteransicht ins Vollbild");

// --- Und ohne alles bleibt es, wie es war ------------------------------------

const leer = buehne().kontext;
leer.activeView = null;
leer.activeProviderId = null;
leer.spielerLauf = null;
leer.spielerView = null;
vm.runInContext("enterContentFullscreen()", leer);
assert.equal(leer.isContentFullscreen, false,
  "ohne Ansicht und ohne Player gibt es nichts gross zu machen");

console.log("OK Mini-Player: die Rueckkehr fuehrt die Werkbank wieder, und der Vollbildknopf greift");
