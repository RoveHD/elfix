"use strict";
// Wer nicht vorbereiten kann, sagt es der Runde.
//
// Gemessen an der echten Runde am 9.9.2026: ein Gast befiehlt eine andere
// Folge, das Telefon zieht in zehn Sekunden nach - und der Rechner steht
// neunzig Sekunden lang still, bis die Schranke von selbst aufgibt:
//
//     +4.3s   SYNCPREPARE  grund=episode-change  folge=s1e9
//     +14.4s  Elias* s1e8@22P | Claude Gast s1e9@30P | S24 Elias s1e9@0P
//     +86.8s  Elias* s1e8@22P | Claude Gast s1e9@30P | S24 Elias s1e9@0P
//     +94.3s  SYNCFAILED
//     +103.2s Elias* s1e9@22
//
// In der ganzen Zeit geht nichts: der Player bleibt angehalten, die Anzeige
// steht auf "Warten auf alle", und wer drueckt, drueckt ins Leere. Erst die
// Absage der Schranke loest es, und danach holt der Nachziehtakt den
// Zurueckgebliebenen in Sekunden.
//
// Das Warten selbst ist richtig - gemeinsam heisst gemeinsam. Falsch ist, dass
// niemand erfaehrt, wenn einer es nicht schafft. Die Vorbereitung im
// Hoster-Rahmen laeuft in ihre Ladefrist und hoert danach einfach auf: sie
// setzt die Anzeige zurueck und schweigt. Die anderen warten weiter, bis die
// Frist des Relays ablaeuft.
//
// Im eigenen Player wird genau das schon richtig gemacht, mitsamt Begruendung
// im Quelltext ("Ohne diese Absage warteten alle anderen die volle Frist auf
// eine Bereitmeldung, die nicht mehr kommen kann"). Nur der zweite Weg tat es
// nicht.
//
// Eine Absage ist kein Aufgeben: das Relay startet die Runde ohne diesen
// einen, und der Nachziehtakt holt ihn fuenf Sekunden spaeter auf die neue
// Folge. Aus neunzig Sekunden Stillstand werden ein paar.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
function funktion(name) {
  const start = main.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} nicht gefunden`);
  return main.slice(start, main.indexOf("\n}\n", start) + 2);
}

const EINTRAG = { key: "serie:parry", room: "Bangus", url: "https://x/staffel-1/episode-8",
  title: "I Parry Everything" };

/**
 * Eine Vorbereitung, die nie fertig wird.
 *
 * Die Uhr wird gestellt statt gewartet: die Ladefrist eines Folgenwechsels ist
 * eine Minute, und die soll dieser Test nicht wirklich verbringen.
 */
function lauf({ bereitWerden, reason }) {
  const meldungen = [];
  let jetzt = 1_000_000;
  const context = vm.createContext({
    console,
    Date: { now: () => jetzt },
    // Jede Pause zwischen zwei Versuchen laesst die Uhr weiterlaufen. Damit
    // erreicht die Schleife ihre Frist, ohne dass der Test wartet.
    setTimeout: (fn) => { jetzt += 400; fn(); return 0; },
    Promise,
    sendWatchpartyLive: () => {},
    followWatchpartyEpisode: async () => {},
    providerViews: new Map([["aniworld", { webContents: { getURL: () => EINTRAG.url } }]]),
    providers: [{ id: "aniworld" }],
    scheduleProviderAutoplay: () => {}, stopAutoplayRequest: () => {},
    isLiveView: () => true,
    istGleicheFolge: () => true,
    executeJavaScriptInMediaFrames: async () => (bereitWerden ? ["bereit"] : []),
    watchpartyApplyScript: () => "",
    watchpartyEreignis: () => ({ videoTime: 0, playing: false }),
    watchparty: {
      bereitZumStart: (key, room, syncId, ok) => meldungen.push({ key, room, syncId, ok })
    }
  });
  vm.runInContext(funktion("prepareWatchpartySync"), context);
  return {
    meldungen,
    fertig: context.prepareWatchpartySync(EINTRAG,
      { url: EINTRAG.url, syncId: "sync-3858", reason, position: 0 }, () => true)
  };
}

(async () => {
  /* --- Der gemeldete Fall: die Folge wird nie bereit --------------------- */
  {
    const { meldungen, fertig } = lauf({ bereitWerden: false, reason: "episode-change" });
    await fertig;
    assert.equal(meldungen.length, 1,
      "Die Runde erfuhr nichts und wartete die volle Frist - das gemeldete \"Warten auf alle\"");
    assert.equal(meldungen[0].syncId, "sync-3858");
    assert.equal(meldungen[0].ok, false, "Eine Absage ist keine Bereitmeldung");
    console.log("OK  Wer die neue Folge nicht vorbereiten kann, sagt ab");
  }

  /* --- Und wer es schafft, meldet ganz normal bereit --------------------- */
  {
    const { meldungen, fertig } = lauf({ bereitWerden: true, reason: "episode-change" });
    await fertig;
    assert.equal(meldungen.length, 1);
    assert.equal(meldungen[0].ok, undefined,
      "Eine gelungene Vorbereitung darf nicht als Absage hinausgehen");
    console.log("OK  Eine gelungene Vorbereitung bleibt eine Bereitmeldung");
  }

  /* --- Auch beim blossen Gleichziehen darf niemand haengen --------------- */
  {
    const { meldungen, fertig } = lauf({ bereitWerden: false, reason: "sync-all" });
    await fertig;
    assert.equal(meldungen.length, 1, "Auch hier warten sonst alle die volle Frist");
    assert.equal(meldungen[0].ok, false);
    console.log("OK  Auch ein misslungenes Gleichziehen wird abgesagt");
  }

  console.log("OK Vorbereitung: eine Absage statt Schweigen");
})().catch((f) => {
  console.error(`FAIL ${f.message}`);
  process.exit(1);
});
