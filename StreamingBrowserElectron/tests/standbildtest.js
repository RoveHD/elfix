"use strict";

/*
 * Beim Anhalten steht ueberall dasselbe Bild.
 *
 * <h2>Warum das ein eigener Pruefstand ist</h2>
 *
 * Gemeldet als "beim Pausieren zeigen zwei Geraete dieselbe Sekunde, aber
 * verschiedene Bilder". Das laesst sich nicht mit Textsuchen und nicht mit
 * einer einzelnen Funktion pruefen: es ist eine Eigenschaft der ganzen Kette.
 * Hier laufen deshalb drei *echte* Player - der Quelltext aus
 * src/renderer/spieler.js - gegen ein *echtes* Relay, mit derselben
 * Entscheidungslogik dazwischen, die auch main.js benutzt. Am Ende wird
 * verglichen, worauf jeder wirklich stehengeblieben ist.
 *
 * <h2>Das Video darunter</h2>
 *
 * Ein <video> ist kein Zahlenfach. `currentTime = x` startet eine Suche, sie
 * endet spaeter, und sie endet nicht unbedingt dort, wo man hinwollte: viele
 * Quellen setzen auf das naechste Schluesselbild auf. Genau das bildet das
 * nachgebaute Video hier ab - sonst prueft man eine Welt, in der der Fehler gar
 * nicht vorkommen kann.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const WS = require("../../sync-server/node_modules/ws");
const { WatchpartyRaeume } = require("../src/watchparty-raeume");
const sync = require("../src/watchparty-sync");

if (!globalThis.WebSocket) globalThis.WebSocket = WS;

const PORT = Number(process.env.TESTPORT) || 8791;
const ADRESSE = `ws://127.0.0.1:${PORT}`;
const RAUM = "standbildraum";
const SERIE = "https://aniworld.to/anime/stream/bleach";
const FOLGE = `${SERIE}/staffel-1/episode-4`;
const KEY = "serie:bleach-standbild";
const SPIELER = fs.readFileSync(path.join(__dirname, "../src/renderer/spieler.js"), "utf8");

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));
async function warteBis(bedingung, hoechstens = 6000) {
  const bis = Date.now() + hoechstens;
  while (Date.now() < bis) {
    let erfuellt = false;
    try { erfuellt = Boolean(bedingung()); } catch { erfuellt = false; }
    if (erfuellt) return true;
    await schlaf(40);
  }
  return false;
}

/* -------------------------------------------------------------- Das Video */

/**
 * Ein Video, das seine Suchvorgaenge ernst nimmt.
 *
 * @param raster optionale, künstliche Rasterung. Der Standard ist exakt: ein
 *               HTMLMediaElement meldet seine `currentTime` nicht zwangsweise
 *               auf 40 ms gerundet zurück. Eine solche Rundung würde die
 *               produktive 1-ms-Readiness-Schleife als Mock-Artefakt blockieren.
 */
function videoBauen(raster = 0) {
  const horcher = {};
  let stelle = 0;
  let laeuft = false;
  let uhr = null;
  const bild = {
    paused: true, ended: false, seeking: false, readyState: 4,
    duration: 1371, volume: 1, muted: false, playbackRate: 1, defaultPlaybackRate: 1,
    buffered: { length: 0 }, textTracks: [],
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(name, fn) { (horcher[name] ||= []).push(fn); },
    removeEventListener(name, fn) { horcher[name] = (horcher[name] || []).filter((f) => f !== fn); },
    dispatchEvent(e) { for (const fn of [...(horcher[e.type] || [])]) fn(e); },
    play() {
      if (!bild.paused) return Promise.resolve();
      bild.paused = false;
      laeuft = true;
      const ab = Date.now();
      const start = stelle;
      uhr = setInterval(() => { stelle = start + (Date.now() - ab) / 1000; }, 20);
      bild.dispatchEvent({ type: "play" });
      return Promise.resolve();
    },
    pause() {
      const lief = !bild.paused;
      bild.paused = true;
      laeuft = false;
      clearInterval(uhr);
      uhr = null;
      if (lief) bild.dispatchEvent({ type: "pause" });
    },
    load() {}, canPlayType() { return ""; },
    setAttribute() {}, getAttribute() { return ""; }, removeAttribute() {},
    append() {}, appendChild() {}, replaceChildren() {},
    aufraeumen() { clearInterval(uhr); }
  };
  Object.defineProperty(bild, "currentTime", {
    get() { return stelle; },
    set(wert) {
      bild.seeking = true;
      const lief = laeuft;
      clearInterval(uhr);
      uhr = null;
      setTimeout(() => {
        // So landet ein echter Player: auf dem Gitter unter dem Ziel.
        stelle = raster > 0 ? Math.floor(wert / raster) * raster : wert;
        bild.seeking = false;
        if (lief && !bild.paused) {
          const ab = Date.now();
          const start = stelle;
          uhr = setInterval(() => { stelle = start + (Date.now() - ab) / 1000; }, 20);
        }
        bild.dispatchEvent({ type: "seeked" });
      }, 8);
    }
  });
  return bild;
}

/* ------------------------------------------------------- Der echte Player */

function spielerLaden(bild, bruecke) {
  const elemente = new Map();
  function element(id) {
    if (id === "bild") return bild;
    if (elemente.has(id)) return elemente.get(id);
    const horcher = {};
    const el = {
      hidden: true, value: "", children: [], disabled: false,
      style: { setProperty() {} },
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(name, fn) { (horcher[name] ||= []).push(fn); },
      removeEventListener() {},
      dispatchEvent(e) { for (const fn of horcher[e.type] || []) fn(e); },
      appendChild(k) { this.children.push(k); return k; },
      append(...k) { this.children.push(...k); },
      replaceChildren(...k) { this.children = k; },
      querySelector() { return null; }, querySelectorAll() { return []; },
      setAttribute() {}, getAttribute() { return ""; }, removeAttribute() {},
      focus() {}, requestLayout() {}
    };
    Object.defineProperty(el, "textContent", {
      get() { return this.text || ""; },
      set(w) { this.text = w; this.children = []; }
    });
    elemente.set(id, el);
    return el;
  }
  const still = { log() {}, warn() {}, error() {}, info() {} };
  const c = vm.createContext({
    window: { elfixSpieler: bruecke }, console: still, Date, Event, Promise,
    document: { getElementById: element, createElement: () => element(Symbol()), addEventListener() {} },
    setTimeout, clearTimeout, setInterval, clearInterval
  });
  vm.runInContext(SPIELER, c);
  return c;
}

/* ---------------------------------------------------------- Ein Geraet */

/**
 * Ein Geraet: echter Player, echte Raumverbindung - und dazwischen genau die
 * Kette, die auch main.js fährt (steuerungEntscheiden, ereignisFuerPlayer,
 * startPlan). Was hier stimmt, stimmt dort auch.
 */
function geraet(name, raster) {
  const bild = videoBauen(raster);
  const letzte = { ereignis: null };
  let raeume = null;
  let player = null;

  const bruecke = {
    aufAuftrag(rueckruf) { bruecke._auftrag = rueckruf; },
    aufNaechste() {}, aufMarke() {}, aufLeiste() {}, aufTempo() {},
    aufSteuern(rueckruf) { bruecke._steuern = rueckruf; },
    bereit() {}, autoplay: async () => 0, schlussNachFolge: async () => 0,
    folgen: async () => null, wechseln: async () => ({ ok: true }), hoster: async () => ({ ok: true }),
    fehler() {}, schliessen() {}, vollbild() {}, sprung() {}, takt() {}, tempo() {},
    stand(stand) {
      if (!raeume) return;
      raeume.meldeStand(KEY, {
        position: Number(stand.stelle) || 0,
        paused: !stand.laeuft,
        duration: Number(stand.dauer) || 0,
        url: FOLGE, season: 1, episode: 4,
        playerSessionId: `${name}-sitzung`
      }, RAUM);
    },
    aktion(aktion, stelle) {
      if (!raeume) return;
      if (aktion === "play") {
        const jetzt = raeume.serverJetzt(RAUM);
        const startAt = jetzt == null ? 0 : jetzt + sync.START_VORLAUF_MS;
        raeume.steuernMitEinstellung(KEY, "play", stelle, FOLGE, RAUM, { startAt });
        // Der Ausloeser bleibt bis zu seinem eigenen Relay-Echo stehen. Erst
        // syncprepare bestätigt die Bereitschaft, syncstart lässt alle los.
        return;
      }
      raeume.steuernMitAdresse(KEY, aktion, stelle, FOLGE, RAUM);
    }
  };
  bruecke.syncBereit = (syncId) => raeume.bereitZumStart(KEY, RAUM, syncId);

  const geraetObjekt = {
    name, bild, zustand: [], protokoll: [],
    eintrag: () => geraetObjekt.zustand.find((w) => w.key === KEY) || null,
    binHost: () => {
      const e = geraetObjekt.eintrag();
      return Boolean(e?.hostId) && e.hostId === e.myId;
    }
  };

  raeume = new WatchpartyRaeume({
    WebSocketKlasse: WS,
    onControl: (nachricht) => empfangen(nachricht),
    onState: (eintraege) => { geraetObjekt.zustand = eintraege; },
    onWatchstate: () => {}
  });
  raeume.konfigurieren({
    enabled: true, serverUrl: ADRESSE, rooms: [RAUM], name, deviceId: `${name}-id`
  });
  player = spielerLaden(bild, bruecke);
  geraetObjekt.raeume = raeume;
  geraetObjekt.player = player;
  /*
   * Der Herzschlag im Sekundentakt - auch im Stehen.
   *
   * Genau den schickt main.js, solange eine Runde laeuft (spieler:takt), und
   * genau an ihm haengt die Ausrichtung nach der Pause im Relay. Ohne ihn
   * prueft dieser Pruefstand eine Welt, in der der gemeldete Fehler gar nicht
   * vorkommen kann - er ist am 7.9.2026 zwischen Rechner und Telefon
   * aufgetreten und hier zunaechst durchgerutscht.
   */
  geraetObjekt.takt = setInterval(() => {
    try { player.standMelden(true); } catch (_) { }
  }, 1000);

  /** Dieselbe Kette wie applyWatchpartyControl + spielerSteuernAusRunde. */
  function empfangen(nachricht) {
    const eintrag = geraetObjekt.eintrag();
    const binHost = geraetObjekt.binHost();
    const urteil = sync.steuerungEntscheiden(nachricht, {
      letzter: letzte.ereignis,
      binHost,
      hostId: eintrag?.hostId,
      gleicheAdresse: true,
      offen: { season: 1, episode: 4 }
    });
    if (urteil.merken) letzte.ereignis = urteil.merken;
    if (urteil.tun !== "anwenden" && urteil.tun !== "syncprepare" && urteil.tun !== "syncstart") return;
    const stand = raeume.uhrStand(RAUM);
    const ereignis = sync.ereignisFuerPlayer(
      nachricht, sync.laeuftDanach(nachricht), stand ? stand.versatz : 0,
      raeume.serverJetzt(RAUM) != null);
    const laufen = sync.laeuftDanach(nachricht);
    const plan = sync.startPlan(ereignis, raeume.serverJetzt(RAUM),
      laufen ? sync.START_VORLAUF_MS : 0);
    const befehl = {
      tun: "stelle",
      stelle: plan.stelle,
      laufen,
      springen: !urteil.nichtSpringen,
      wartenMs: plan.wartenMs,
      genau: urteil.genau,
      bereitId: urteil.tun === "syncprepare" ? String(nachricht.syncId || "") : ""
    };
    geraetObjekt.protokoll.push({
      aktion: nachricht.action,
      resync: Boolean(nachricht.resync),
      kam: nachricht.videoTime ?? nachricht.position,
      angewendet: befehl.stelle,
      laufen: befehl.laufen,
      springen: befehl.springen,
      genau: befehl.genau
    });
    player.steuernAusRunde(befehl);
  }

  return geraetObjekt;
}

/* -------------------------------------------------------------- Der Lauf */

(async () => {
  // Drei Geraete mit *verschiedenem* Suchverhalten - so ist es in Wirklichkeit
  // auch: der eine Hoster liefert feine Bruchstuecke, der andere setzt auf
  // Schluesselbilder auf.
  const raster = Number(process.env.RASTER ?? 0);
  const host = geraet("Host", raster);
  const gastA = geraet("GastA", raster);
  const gastB = geraet("GastB", raster);
  const alle = [host, gastA, gastB];

  await warteBis(() => alle.every((g) => g.raeume.status().rooms?.[0]?.connected));

  host.raeume.teilen({
    key: KEY, url: FOLGE, title: "Bleach", providerName: "AniWorld",
    type: "serie", season: 1, episode: 4
  }, RAUM);
  await warteBis(() => alle.every((g) => g.eintrag()));

  // Nacheinander beitreten: Host der Runde wird, wer zuerst da ist.
  host.raeume.beitreten(KEY, RAUM);
  await warteBis(() => host.eintrag()?.joined);
  gastA.raeume.beitreten(KEY, RAUM);
  await warteBis(() => gastA.eintrag()?.joined);
  gastB.raeume.beitreten(KEY, RAUM);
  await warteBis(() => gastB.eintrag()?.joined);

  // Jeder Player bekommt seinen Auftrag - erst damit weiss er, dass eine Runde
  // laeuft, und erst dann meldet er eine eigene Pause ueberhaupt hinaus.
  for (const g of alle) {
    g.player.starten({
      id: 1, adresse: "https://cdn.example/folge.m3u8", typ: "datei",
      titel: "Bleach", runde: true, rundeHost: g.binHost(), rundeTempo: 1,
      weiterZaehler: 0, weiterAbProzent: 90
    });
  }
  await schlaf(50);

  // Jeder meldet seinen Stand - ohne das gilt ein Befehl nur unter Gleichfolgigen.
  for (const g of alle) {
    g.bild.currentTime = 300;
    await schlaf(20);
    g.player.standMelden(true);
  }
  await schlaf(400);
  pruefe("Der Einsteller ist Host der Runde", host.binHost(), host.eintrag()?.hostName || "");

  /* --- 1. Der Host haelt an ---------------------------------------------- */

  // Alle laufen los - ueber den echten Weg: der Host drueckt Play, die Runde
  // verabredet einen Zeitpunkt, alle fahren los.
  host.player.spielenUmschalten();
  await warteBis(() => alle.every((g) => !g.bild.paused), 4000);
  await schlaf(1200);
  for (const g of alle) g.player.standMelden(true);
  await schlaf(1200);

  pruefe("Vor der Pause laufen alle", alle.every((g) => !g.bild.paused),
    alle.map((g) => `${g.name}=${g.bild.currentTime.toFixed(3)}`).join("  "));

  // Und jetzt haelt der Host an - wie ein Mensch, ohne vorher zu springen.
  for (const g of alle) g.protokoll.length = 0;
  host.player.spielenUmschalten();
  await schlaf(2500);

  const hostStand = host.bild.currentTime;
  console.log("    Host steht bei " + hostStand.toFixed(6));
  for (const g of alle) {
    console.log("    " + g.name.padEnd(6) + " " + g.bild.currentTime.toFixed(6)
      + "   Abstand " + ((g.bild.currentTime - hostStand) * 1000).toFixed(1) + " ms");
    for (const z of g.protokoll) {
      console.log("        empfangen " + z.aktion + (z.resync ? " (resync)" : "")
        + " kam=" + Number(z.kam).toFixed(6) + " angewendet=" + Number(z.angewendet).toFixed(6)
        + " laufen=" + z.laufen + " springen=" + z.springen + " genau=" + z.genau);
    }
  }

  // Nicht "nah genug", sondern gleich. Ein Bild ist entweder dasselbe oder
  // nicht; eine Toleranz waere hier eine Ausrede.
  pruefe("Nach der Pause des Hosts steht ueberall dasselbe Bild",
    alle.every((g) => g.bild.currentTime === hostStand),
    alle.map((g) => `${g.name}=${g.bild.currentTime.toFixed(6)}`).join("  "));
  pruefe("Alle stehen wirklich", alle.every((g) => g.bild.paused),
    alle.map((g) => `${g.name}=${g.bild.paused}`).join("  "));

  /* --- 2. Ein Gast haelt an ---------------------------------------------- */

  // Erst die Sperre nach dem Ausrichten ablaufen lassen - sonst faengt der
  // naechste Druck oertlich an, statt die Runde zu fragen.
  await schlaf(3000);
  host.player.spielenUmschalten();
  const liefen = await warteBis(() => alle.every((g) => !g.bild.paused), 5000);
  pruefe("Fuer den zweiten Teil laufen wieder alle", liefen,
    alle.map((g) => `${g.name}=${g.bild.paused ? "steht" : "laeuft"}`).join("  "));
  await schlaf(1500);
  for (const g of alle) g.player.standMelden(true);
  await schlaf(1200);

  for (const g of alle) g.protokoll.length = 0;
  // Jetzt ist es wirklich eine Pause und kein Start.
  pruefe("Der Gast laeuft, bevor er anhaelt", !gastB.bild.paused);
  gastB.player.spielenUmschalten();
  await schlaf(3500);

  const hostStand2 = host.bild.currentTime;
  console.log("    Host steht bei " + hostStand2.toFixed(6));
  for (const g of alle) {
    console.log("    " + g.name.padEnd(6) + " " + g.bild.currentTime.toFixed(6)
      + "   Abstand " + ((g.bild.currentTime - hostStand2) * 1000).toFixed(1) + " ms");
    for (const z of g.protokoll) {
      console.log("        empfangen " + z.aktion + (z.resync ? " (resync)" : "")
        + " kam=" + Number(z.kam).toFixed(6) + " angewendet=" + Number(z.angewendet).toFixed(6)
        + " laufen=" + z.laufen + " springen=" + z.springen + " genau=" + z.genau);
    }
  }

  pruefe("Auch nach der Pause eines Gastes steht ueberall dasselbe Bild",
    alle.every((g) => g.bild.currentTime === hostStand2),
    alle.map((g) => `${g.name}=${g.bild.currentTime.toFixed(6)}`).join("  "));
  pruefe("Alle stehen", alle.every((g) => g.bild.paused));

  /* --- 3. Und noch einmal - der zweite Durchgang war der kaputte ---------- */

  await schlaf(3000);
  host.player.spielenUmschalten();
  await warteBis(() => alle.every((g) => !g.bild.paused), 5000);
  await schlaf(1500);
  for (const g of alle) g.protokoll.length = 0;
  gastA.player.spielenUmschalten();
  await schlaf(3500);

  const hostStand3 = host.bild.currentTime;
  console.log("    Host steht bei " + hostStand3.toFixed(6));
  for (const g of alle) {
    console.log("    " + g.name.padEnd(6) + " " + g.bild.currentTime.toFixed(6)
      + "   Abstand " + ((g.bild.currentTime - hostStand3) * 1000).toFixed(1) + " ms");
  }
  pruefe("Auch beim zweiten Mal - das war der gemeldete Fehler",
    alle.every((g) => g.bild.currentTime === hostStand3),
    alle.map((g) => `${g.name}=${g.bild.currentTime.toFixed(6)}`).join("  "));
  pruefe("Und alle stehen", alle.every((g) => g.bild.paused));

  for (const g of alle) { clearInterval(g.takt); g.bild.aufraeumen(); g.raeume.trennen(); }
  await schlaf(200);

  const gut = pruefungen.filter(Boolean).length;
  console.log(`${gut}/${pruefungen.length} bestanden`);
  process.exit(gut === pruefungen.length ? 0 : 1);
})();
