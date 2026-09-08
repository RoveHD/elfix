"use strict";

const assert = require("node:assert/strict");
const vorschau = require("../src/renderer/spieler-vorschau");

class EreignisZiel {
  constructor() { this.horcher = new Map(); }
  addEventListener(name, fn) {
    if (!this.horcher.has(name)) this.horcher.set(name, new Set());
    this.horcher.get(name).add(fn);
  }
  removeEventListener(name, fn) { this.horcher.get(name)?.delete(fn); }
  senden(name) { for (const fn of [...(this.horcher.get(name) || [])]) fn(); }
}

class VideoProbe extends EreignisZiel {
  constructor(verzoegerung = 0) {
    super();
    this.style = {};
    this.readyState = 0;
    this.videoWidth = 640;
    this.videoHeight = 360;
    this.duration = 20;
    this._zeit = 0;
    this.gesetzt = 0;
    this.verzoegerung = verzoegerung;
    this.frame = [];
  }
  set currentTime(wert) {
    this.gesetzt += 1;
    this._zeit = Number(wert);
    setTimeout(() => {
      this.readyState = 2;
      this.senden("seeked");
      const rueckruf = this.frame.shift();
      rueckruf?.(0, { mediaTime: this._zeit });
    }, this.verzoegerung);
  }
  get currentTime() { return this._zeit; }
  requestVideoFrameCallback(fn) { this.frame.push(fn); }
  setAttribute() {}
  removeAttribute() { this.src = ""; }
  pause() {}
  remove() {}
  load() {
    if (!this.src) return;
    setTimeout(() => { this.readyState = 2; this.senden("loadedmetadata"); }, this.verzoegerung);
  }
}

function canvasProbe() {
  const aufrufe = [];
  const context = {
    fillStyle: "",
    fillRect() {},
    clearRect() {},
    drawImage(...werte) { aufrufe.push(werte); }
  };
  return { width: 0, height: 0, aufrufe, getContext: () => context };
}

const altesDokument = global.document;
const altesBitmap = global.createImageBitmap;
global.document = { createElement: (name) => name === "canvas" ? canvasProbe() : new VideoProbe(),
  body: { appendChild() {} } };
global.createImageBitmap = async (canvas) => ({ canvas, geschlossen: false,
  close() { this.geschlossen = true; } });

async function haupt() {
  {
    const canvas = canvasProbe();
    const video = new VideoProbe();
    const instanz = vorschau.erstellen({ canvas, video, timeoutMs: 500 });
    assert.equal(instanz.quelle({ id: 1, adresse: "file:///probe.webm", typ: "datei", dauer: 20 }), true);
    const frisch = await instanz.zeigen(3.1);
    assert.equal(frisch.ok, true);
    assert.equal(frisch.stelle, 4);
    const gemerkt = await instanz.zeigen(3.8);
    assert.equal(gemerkt.ok, true);
    assert.equal(gemerkt.ausCache, true);
    assert.equal(gemerkt.stelle, 4);
    instanz.zerstoeren();
  }

  {
    const video = new VideoProbe();
    const instanz = vorschau.erstellen({ canvas: canvasProbe(), video, timeoutMs: 500 });
    instanz.quelle({ adresse: "file:///anfang.webm", typ: "datei", dauer: 20 });
    const anfang = await instanz.zeigen(0);
    assert.equal(anfang.ok, true);
    assert.equal(video.gesetzt, 1, "Auch Ziel null fordert ein wirkliches Decoderbild an");
    assert.ok(anfang.stelle >= 0 && anfang.stelle < 0.02);
    instanz.zerstoeren();
  }

  {
    let abgebrochen = 0;
    const instanz = vorschau.erstellen({ canvas: canvasProbe(), video: new VideoProbe(), timeoutMs: 300,
      fetch: async () => ({ status: 200, headers: { get: () => null },
        body: { async cancel() { abgebrochen += 1; } } }) });
    assert.equal(instanz.quelle({ adresse: "https://video.example/alles.mp4", typ: "datei", dauer: 10 }), true);
    const wert = await instanz.zeigen(2);
    assert.equal(wert.ok, false);
    assert.match(wert.grund, /Bereichsabruf/);
    assert.equal(abgebrochen, 1);
    instanz.zerstoeren();
  }

  {
    const canvas = canvasProbe();
    const video = new VideoProbe(30);
    const instanz = vorschau.erstellen({ canvas, video, timeoutMs: 300 });
    instanz.quelle({ id: "alt", adresse: "file:///alt.webm", typ: "datei", dauer: 20 });
    const alt = instanz.zeigen(8);
    instanz.quelle({ id: "neu", adresse: "file:///neu.webm", typ: "datei", dauer: 20 });
    assert.equal((await alt).ok, false);
    await new Promise((fertig) => setTimeout(fertig, 80));
    assert.equal(canvas.aufrufe.length, 0);
    instanz.zerstoeren();
  }

  {
    const canvas = canvasProbe();
    const instanz = vorschau.erstellen({ canvas, video: new VideoProbe(20), timeoutMs: 500 });
    instanz.quelle({ adresse: "file:///schnell.webm", typ: "datei", dauer: 20 });
    const erster = instanz.zeigen(2);
    const mitte = instanz.zeigen(4);
    const letzter = instanz.zeigen(8);
    assert.equal((await mitte).grund, "ersetzt");
    assert.equal((await erster).grund, "ersetzt");
    assert.equal((await letzter).ok, true);
    assert.equal(canvas.aufrufe.length, 1);
    instanz.zerstoeren();
  }

  {
    const reihenfolge = [];
    class HlsProbe {
      static Events = { MANIFEST_PARSED: "manifest", INIT_PTS_FOUND: "pts", ERROR: "error" };
      static isSupported() { return true; }
      constructor() { this.horcher = new Map(); }
      on(name, fn) { this.horcher.set(name, fn); }
      loadSource() {}
      attachMedia() {
        queueMicrotask(() => {
          this.horcher.get("manifest")?.();
          queueMicrotask(() => this.horcher.get("pts")?.("pts", { id: "main" }));
        });
      }
      startLoad(stelle) { reihenfolge.push(["start", stelle]); }
      stopLoad() { reihenfolge.push(["stop"]); }
      destroy() { reihenfolge.push(["destroy"]); }
    }
    const instanz = vorschau.erstellen({ canvas: canvasProbe(), video: new VideoProbe(),
      Hls: HlsProbe, timeoutMs: 500 });
    instanz.quelle({ adresse: "https://video.example/master.m3u8", typ: "hls", dauer: 30 });
    const wert = await instanz.zeigen(6);
    assert.equal(wert.ok, true);
    assert.deepEqual(reihenfolge.slice(0, 4), [["start", 0], ["stop"], ["start", 6], ["stop"]]);
    instanz.verbergen();
    assert.equal(reihenfolge.some((eintrag) => eintrag[0] === "destroy"), true);
    instanz.zerstoeren();
  }

  {
    let alteAntwort;
    const hlsAufrufe = [];
    const zustaende = [];
    class NeueHlsProbe {
      static Events = { MANIFEST_PARSED: "manifest", INIT_PTS_FOUND: "pts", ERROR: "error" };
      static isSupported() { return true; }
      constructor() { this.horcher = new Map(); }
      on(name, fn) { this.horcher.set(name, fn); }
      off(name, fn) { if (this.horcher.get(name) === fn) this.horcher.delete(name); }
      loadSource() {}
      attachMedia() {
        queueMicrotask(() => {
          this.horcher.get("manifest")?.();
          queueMicrotask(() => this.horcher.get("pts")?.("pts", { id: "main" }));
        });
      }
      startLoad(stelle) { hlsAufrufe.push(["start", stelle]); }
      stopLoad() { hlsAufrufe.push(["stop"]); }
      destroy() { hlsAufrufe.push(["destroy"]); }
    }
    const instanz = vorschau.erstellen({ canvas: canvasProbe(), Hls: NeueHlsProbe,
      timeoutMs: 500, beiZustand: (wert) => zustaende.push(wert),
      fetch: () => new Promise((fertig) => { alteAntwort = fertig; }) });
    instanz.quelle({ id: "alt", adresse: "https://video.example/alt.mp4", typ: "datei", dauer: 20 });
    const alterAuftrag = instanz.zeigen(4);
    await new Promise((fertig) => setTimeout(fertig, 0));
    instanz.quelle({ id: "neu", adresse: "https://video.example/neu.m3u8", typ: "hls", dauer: 20 });
    assert.equal((await alterAuftrag).grund, "quellenwechsel");
    assert.equal((await instanz.zeigen(6)).ok, true);
    const stopsVorher = hlsAufrufe.filter(([name]) => name === "stop").length;
    alteAntwort({ status: 200, headers: { get: () => null }, body: { async cancel() {} } });
    await new Promise((fertig) => setTimeout(fertig, 20));
    assert.equal(hlsAufrufe.filter(([name]) => name === "stop").length, stopsVorher);
    assert.equal(zustaende.at(-1).art, "bild");
    instanz.zerstoeren();
  }

  console.log("OK Spielervorschau: Range-Schranke, Quellenwechsel, Cache und HLS-Anker");
}

haupt().finally(() => {
  global.document = altesDokument;
  global.createImageBitmap = altesBitmap;
}).catch((fehler) => {
  console.error(fehler);
  process.exitCode = 1;
});
