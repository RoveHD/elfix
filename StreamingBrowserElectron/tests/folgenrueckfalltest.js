"use strict";
// Ein Herzschlag von der alten Seite reisst die Runde nicht zurueck.
//
// Gemessen an der echten Runde am 9.9.2026, "I Parry Everything", Rechner und
// S24 in derselben Watchparty. Der Gast blaettert am Telefon weiter, und die
// Raumkarte tut genau das:
//
//     15:23:49.826  KARTE  ... s1e3   host=Elias
//     15:23:50.031  KARTE  ... s1e12  host=Elias
//
// Zweihundert Millisekunden auf der neuen Folge, dann zurueck auf die alte.
// Das Telefon stand danach allein bei s1e3, der Rechner unbeirrt bei s1e12,
// und der gemeinsame Start kam fuer s1e12 - die Folge, die niemand gewaehlt
// hatte. Am Rechner stand "Warten auf alle".
//
// Der Grund steckt im Herzschlag. Er traegt Folge und Adresse der offenen
// Seite, und wer die Runde fuehrt, darf sie damit nachziehen - das ist
// richtig und der Grund, warum ein Wechsel am Telefon ueberhaupt ankommt,
// ohne dass jemand eine Meldung schicken muss.
//
// Waehrend einer Startverabredung ist es aber falsch. Der Host hat die neue
// Folge noch gar nicht offen: er laedt sie, er ist Teil der Schranke, und
// sein Herzschlag traegt weiter die alte. Als Fuehrender ueberschrieb er
// damit im Sekundentakt das Ziel, auf das sich die Runde gerade verabredet
// hatte. Die Bedingung fragte fuer den Host auch gar nicht, ob er selbst
// gewechselt hat - es genuegte, dass die Runde woanders stand als er.
//
// Waehrend die Schranke offen ist, entscheidet die Schranke. Derselbe
// Grundsatz, nach dem der Nachziehtakt dort ohnehin schon die Finger
// stillhaelt.

const crypto = require("node:crypto");
const WS = require("../../sync-server/node_modules/ws");

const PORT = Number(process.env.TESTPORT) || 8799;
const ADRESSE = `ws://127.0.0.1:${PORT}`;
const RAUM = "rueckfallraum";
const KEY = "serie:rueckfall";
const URL1 = "https://aniworld.to/anime/stream/rueckfall/staffel-1/episode-1";
const URL2 = "https://aniworld.to/anime/stream/rueckfall/staffel-1/episode-2";

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(Boolean(b)); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));
const nachweis = (name) => crypto.createHash("sha256").update(name).digest("base64url");

function client(name) {
  const eingang = [];
  const wartende = [];
  let socket;
  const empfangen = (meldung) => {
    eingang.push(meldung);
    for (let i = wartende.length - 1; i >= 0; i -= 1) {
      const w = wartende[i];
      if (eingang.length <= w.ab || !w.passt(meldung)) continue;
      clearTimeout(w.timer);
      wartende.splice(i, 1);
      w.resolve(meldung);
    }
  };
  return {
    name, eingang, folge: 1, url: URL1, stelle: 100,
    marke() { return eingang.length; },
    senden(m) { try { socket.send(JSON.stringify(m)); } catch { /* zu */ } },
    warten(ab, passt, was, ms = 4000) {
      const da = eingang.slice(ab).find(passt);
      if (da) return Promise.resolve(da);
      return new Promise((resolve, reject) => {
        const w = { ab, passt, resolve, timer: null };
        w.timer = setTimeout(() => {
          const i = wartende.indexOf(w);
          if (i >= 0) wartende.splice(i, 1);
          reject(new Error(`Zeitueberschreitung: ${name} wartet auf ${was}`));
        }, ms);
        wartende.push(w);
      });
    },
    /** Die zuletzt gesehene Raumkarte fuer diesen Titel. */
    karte() {
      const karten = eingang.filter((m) => m.type === "state");
      for (let i = karten.length - 1; i >= 0; i -= 1) {
        const e = karten[i].shared?.find((x) => x.key === KEY);
        if (e) return e;
      }
      return null;
    },
    async verbinden() {
      socket = new WS(ADRESSE);
      socket.on("message", (roh) => empfangen(JSON.parse(String(roh))));
      await new Promise((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      const ab = eingang.length;
      this.senden({ type: "join", room: RAUM, name, deviceProof: nachweis(name) });
      return this.warten(ab, (m) => m.type === "state" && m.you, "Raumbeitritt");
    },
    schliessen() { try { socket?.close(); } catch { /* zu */ } }
  };
}

const pulse = [];
function puls(c) {
  const schlag = () => c.senden({
    type: "here", key: KEY, position: c.stelle, paused: false, duration: 1400,
    season: 1, episode: c.folge, url: c.url, playerSessionId: `${c.name}-e${c.folge}`
  });
  schlag();
  const t = setInterval(schlag, 400);
  pulse.push(t);
}
const pulseAus = () => { for (const t of pulse) clearInterval(t); pulse.length = 0; };

const karteWie = (geraet, passt, was) => geraet.warten(0,
  (m) => m.type === "state" && passt(m.shared?.find((e) => e.key === KEY)), was, 6000);

async function zustandNach(geraet, senden, passt, was) {
  const ab = geraet.marke();
  senden();
  return geraet.warten(ab, (m) => m.type === "state" && passt(m), was);
}

(async () => {
  const host = client("RueckfallHost");
  const gast = client("RueckfallGast");
  await host.verbinden();
  await gast.verbinden();

  await zustandNach(host, () => host.senden({
    type: "share",
    item: { key: KEY, url: URL1, title: "Rueckfall", type: "serie", season: 1, episode: 1 }
  }), (m) => m.shared?.some((e) => e.key === KEY), "geteilten Titel");
  await zustandNach(host, () => gast.senden({ type: "enter", key: KEY }),
    (m) => m.shared?.find((e) => e.key === KEY)?.memberIds?.length >= 2, "Beitritt des Gasts");

  // Der Host meldet zuerst und fuehrt damit - das ist die Lage, um die es
  // geht: der Fuehrende sitzt noch auf der alten Folge.
  puls(host);
  await karteWie(host, (e) => e?.hostName === host.name, "Fuehrung beim Host");
  puls(gast);
  await host.warten(host.marke(), (m) => m.type === "watchstate" && m.key === KEY
    && m.members?.length === 2, "beide Playerstaende");

  // --- Der Gast blaettert weiter --------------------------------------------
  const abHost = host.marke();
  gast.senden({ type: "control", key: KEY, action: "navigate", position: 0, url: URL2 });
  const vorbereitung = await host.warten(abHost,
    (m) => m.type === "syncprepare" && m.reason === "episode-change",
    "Folgenvorbereitung beim Host");
  pruefe("A. Der Wechsel des Gasts erreicht die Runde",
    Boolean(vorbereitung), vorbereitung ? `syncId ${vorbereitung.syncId}` : "nichts");

  await karteWie(host, (e) => e?.episode === 2, "Raumkarte bei Folge 2");
  pruefe("B. Die Raumkarte steht auf der neuen Folge", host.karte()?.episode === 2,
    `Karte bei Folge ${host.karte()?.episode}`);

  // Und jetzt das Entscheidende: der Host laedt noch. Sein Herzschlag traegt
  // weiter die alte Folge - Sekunde um Sekunde, waehrend die Schranke offen
  // ist. Genau das riss die Runde bisher zurueck.
  const gast2 = gast.folge;
  gast.folge = 2; gast.url = URL2; gast.stelle = 0;
  await schlaf(2500);

  pruefe("C. Der Herzschlag von der alten Seite zieht die Runde nicht zurueck",
    host.karte()?.episode === 2, `Karte bei Folge ${host.karte()?.episode}`);

  // --- Und der gemeinsame Start gilt der neuen Folge ------------------------
  host.folge = 2; host.url = URL2; host.stelle = 0;
  const abStart = host.marke();
  host.senden({ type: "syncready", key: KEY, syncId: vorbereitung.syncId });
  gast.senden({ type: "syncready", key: KEY, syncId: vorbereitung.syncId });
  const start = await host.warten(abStart,
    (m) => m.type === "syncstart" && m.syncId === vorbereitung.syncId,
    "gemeinsamen Start").catch(() => null);
  pruefe("D. Der gemeinsame Start gilt der neuen Folge",
    Boolean(start) && String(start.url || "").includes("episode-2"),
    start ? String(start.url || "").split("/").slice(-1)[0] : "kein Start");

  await schlaf(600);
  pruefe("E. Und danach steht die Runde dort auch still",
    host.karte()?.episode === 2, `Karte bei Folge ${host.karte()?.episode}`);
  void gast2;

  pulseAus();
  host.schliessen(); gast.schliessen();
  const fehler = pruefungen.filter((ok) => !ok).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  process.exit(fehler ? 1 : 0);
})().catch((f) => {
  console.log(`FAIL  Ablauf abgebrochen   -> ${f.message}`);
  pulseAus();
  process.exit(1);
});
