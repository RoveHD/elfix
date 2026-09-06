"use strict";
// Tempo und Fassung gehoeren der Runde.
//
// Zwei Meldungen, ein Grundsatz. "Bei Watchparty immer bei beiden dieselbe
// Fassung spielen" und "2x und 0.5x - wenn der Host das einstellt, ist es bei
// allen eingestellt". Beides sind Einstellungen der Runde und keine Stellen:
// sie halten nichts an und springen nirgendwohin.
//
// Warum die Fassung ueberhaupt zaehlt, ist gemessen: zwei Fassungen derselben
// Folge sind bei Vidmoly 1371 und 1376 Sekunden lang. Dieselbe Stelle ist dort
// nicht dasselbe Bild - und kein Abgleich der Welt bringt das zusammen. Wer
// verschiedene Dateien synchronisiert, synchronisiert Zahlen, keine Bilder.
//
// Der dritte Teil ist die dritte Meldung: beim *Anhalten* muss die Stelle
// wirklich sitzen. Hier wird nachgesehen, dass der Befehl, der beim Anderen
// ankommt, die Stelle des Hosts auf die Millisekunde traegt - und dass das
// Urteil dazu "genau" lautet.

const WS = require("../../sync-server/node_modules/ws");
const { WatchpartyRaeume } = require("../src/watchparty-raeume");
const sync = require("../src/watchparty-sync");
const fs = require("fs");
const path = require("path");

if (!globalThis.WebSocket) globalThis.WebSocket = WS;

const PORT = Number(process.env.TESTPORT) || 8791;
const ADRESSE = `ws://127.0.0.1:${PORT}`;
const RAUM = "temporaum";
const WURZEL = path.join(__dirname, "..");
const lies = (datei) => fs.readFileSync(path.join(WURZEL, datei), "utf8").replace(/\r/g, "");

const SERIE = "https://aniworld.to/anime/stream/bleach";
const FOLGE = `${SERIE}/staffel-1/episode-4`;
const KEY = "serie:bleach-tempo";

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

// --- 1. Die Leiter und die Hochrechnung -------------------------------------

pruefe("Die Tempostufen sind eine feste Leiter",
  JSON.stringify(sync.TEMPO_STUFEN) === JSON.stringify([0.5, 0.75, 1, 1.25, 1.5, 2]));
for (const [roh, soll] of [[2, 2], [0.5, 0.5], [1.9, 2], [0.6, 0.5], [0, 1], [-3, 1], ["x", 1], [null, 1], [17, 2]]) {
  pruefe(`Tempo ${JSON.stringify(roh)} wird zu ${soll}`, sync.tempoLesen(roh) === soll);
}

// Der Kern der Sache: bei doppeltem Tempo ist die Quelle in derselben Zeit
// doppelt so weit. Ohne diesen Faktor stiege jeder Nachzuegler um die halbe
// Laufzeit der Nachricht zu frueh ein.
const ereignis = { videoTime: 100, timestamp: 1000, playing: true, hatUhr: true };
pruefe("Ohne Tempo zaehlt die Laufzeit einfach",
  sync.zielZeitBerechnen(ereignis, 3000) === 102);
pruefe("Bei 2x zaehlt sie doppelt",
  sync.zielZeitBerechnen({ ...ereignis, tempo: 2 }, 3000) === 104);
pruefe("Bei 0,5x zaehlt sie halb",
  sync.zielZeitBerechnen({ ...ereignis, tempo: 0.5 }, 3000) === 101);
pruefe("Steht der Host, bleibt seine Stelle die Antwort - auch bei 2x",
  sync.zielZeitBerechnen({ ...ereignis, playing: false, tempo: 2 }, 9000) === 100);
pruefe("Das Tempo reist im Ereignis mit",
  sync.ereignisFuerPlayer({ videoTime: 5, timestamp: 1, tempo: 2 }, true, 0, true).tempo === 2);

// --- 2. Die Urteile ----------------------------------------------------------

const tempoUrteil = sync.steuerungEntscheiden({ action: "tempo", tempo: 2, episodeId: "" }, {});
pruefe("Ein Tempobefehl wird nicht zu einem Sprung",
  tempoUrteil.tun === "tempo" && tempoUrteil.tempo === 2, tempoUrteil.tun);
const fassungUrteil = sync.steuerungEntscheiden(
  { action: "fassung", fassung: "German Sub", hoster: "VOE", episodeId: "" }, {});
pruefe("Ein Fassungsbefehl auch nicht",
  fassungUrteil.tun === "fassung" && fassungUrteil.fassung === "German Sub"
  && fassungUrteil.hoster === "VOE", fassungUrteil.tun);
pruefe("Und beide halten nichts an",
  tempoUrteil.warten === false && fassungUrteil.warten === false
  && tempoUrteil.genau === false && fassungUrteil.genau === false);
// Die Pause dagegen muss sitzen: "genau" heisst, auf die Stelle des Hosts zu
// springen, auch wenn es nur eine Sekunde ist.
const pauseUrteil = sync.steuerungEntscheiden({ action: "pause", episodeId: "" }, {});
pruefe("Eine Pause bleibt genau", pauseUrteil.tun === "anwenden" && pauseUrteil.genau === true);
pruefe("Der Host springt dabei nicht",
  sync.steuerungEntscheiden({ action: "pause", episodeId: "" }, { binHost: true }).nichtSpringen === true);

const skript = sync.tempoScript(2);
pruefe("Das Skript fuer fremde Player setzt playbackRate",
  /playbackRate = 2;/.test(skript) && /querySelectorAll\("video"\)/.test(skript));
pruefe("Und es zwingt den Wert auf eine Stufe",
  /playbackRate = 2;/.test(sync.tempoScript(1.93)) && /playbackRate = 1;/.test(sync.tempoScript("boese")));

// --- 3. Am echten Relay ------------------------------------------------------

function geraet(name) {
  const steuerung = [];
  let zustand = [];
  const raeume = new WatchpartyRaeume({
    WebSocketKlasse: WS,
    onControl: (nachricht) => steuerung.push(nachricht),
    onState: (eintraege) => { zustand = eintraege; },
    onWatchstate: () => {}
  });
  raeume.konfigurieren({
    enabled: true, serverUrl: ADRESSE, rooms: [RAUM], name, deviceId: `${name}-id`
  });
  return {
    name, raeume, steuerung,
    eintrag: () => zustand.find((wert) => wert.key === KEY) || null,
    letzte: (aktion) => [...steuerung].reverse().find((wert) => wert.action === aktion) || null
  };
}

(async () => {
  const host = geraet("Host");
  const gast = geraet("Gast");
  await warteBis(() => host.raeume.status().rooms?.[0]?.connected && gast.raeume.status().rooms?.[0]?.connected);

  host.raeume.teilen({
    key: KEY, url: FOLGE, title: "Bleach", providerName: "AniWorld", type: "serie", season: 1, episode: 4
  }, RAUM);
  await warteBis(() => host.eintrag() && gast.eintrag());
  // Wer einstellt, ist noch nicht dabei: Host wird, wer beitritt und die Folge
  // offen hat.
  host.raeume.beitreten(KEY, RAUM);
  gast.raeume.beitreten(KEY, RAUM);
  await warteBis(() => host.eintrag()?.joined && gast.eintrag()?.joined);
  // Beide melden ihre Folge - ohne das gilt ein Befehl nur unter Gleichfolgigen.
  host.raeume.meldeStand(KEY, { position: 312.5, paused: false, url: FOLGE, season: 1, episode: 4, playerSessionId: "host-sitzung" }, RAUM);
  gast.raeume.meldeStand(KEY, { position: 300, paused: false, url: FOLGE, season: 1, episode: 4, playerSessionId: "gast-sitzung" }, RAUM);
  await schlaf(300);

  const wirklichHost = host.eintrag()?.hostId === "Host-id";
  pruefe("Der Einsteller ist Host der Runde", wirklichHost, host.eintrag()?.hostName || "");

  // --- Das Tempo des Hosts gilt fuer alle ---
  host.raeume.steuernMitEinstellung(KEY, "tempo", 312.5, FOLGE, RAUM, { tempo: 2 });
  const kam = await warteBis(() => gast.letzte("tempo"));
  pruefe("Das Tempo des Hosts kommt beim Gast an", kam, JSON.stringify(gast.letzte("tempo")?.tempo));
  pruefe("Und zwar als die gesetzte Stufe", gast.letzte("tempo")?.tempo === 2);
  pruefe("Der Host bekommt sein eigenes Tempo nicht als Echo zurueck",
    host.letzte("tempo") === null);
  await warteBis(() => gast.eintrag()?.tempo === 2);
  pruefe("Die Runde selbst fuehrt es mit", gast.eintrag()?.tempo === 2, String(gast.eintrag()?.tempo));

  // --- Ein Gast darf es nicht ---
  const vorher = gast.eintrag()?.tempo;
  gast.raeume.steuernMitEinstellung(KEY, "tempo", 300, FOLGE, RAUM, { tempo: 0.5 });
  await schlaf(500);
  pruefe("Ein Gast stellt das Tempo der Runde nicht",
    gast.eintrag()?.tempo === vorher && host.letzte("tempo") === null,
    String(gast.eintrag()?.tempo));

  // --- Jeder Befehl traegt das Tempo der Runde ---
  host.raeume.steuern(KEY, "play", 320, RAUM);
  await warteBis(() => gast.letzte("play"));
  pruefe("Auch ein Play traegt das Tempo der Runde mit",
    gast.letzte("play")?.tempo === 2, String(gast.letzte("play")?.tempo));

  // --- Die Fassung ---
  host.raeume.steuernMitEinstellung(KEY, "fassung", 320, FOLGE, RAUM,
    { fassung: "Japanisch mit deutschen Untertiteln", hoster: "VOE" });
  await warteBis(() => gast.letzte("fassung"));
  pruefe("Die Fassung des Hosts kommt an",
    gast.letzte("fassung")?.fassung === "Japanisch mit deutschen Untertiteln"
    && gast.letzte("fassung")?.hoster === "VOE");
  await warteBis(() => gast.eintrag()?.fassung);
  pruefe("Und steht in der Karte, damit ein Beitretender sie ohne Nachfrage sieht",
    gast.eintrag()?.fassung === "Japanisch mit deutschen Untertiteln"
    && gast.eintrag()?.hoster === "VOE", gast.eintrag()?.fassung);

  // --- Die Pause auf die Millisekunde ---
  const STELLE = 421.037;
  host.raeume.meldeStand(KEY, { position: STELLE, paused: false, url: FOLGE, season: 1, episode: 4, playerSessionId: "host-sitzung" }, RAUM);
  await schlaf(200);
  const vorPause = gast.steuerung.length;
  host.raeume.steuern(KEY, "pause", STELLE, RAUM);
  await warteBis(() => gast.steuerung.length > vorPause && gast.letzte("pause"));
  const pause = gast.letzte("pause");
  pruefe("Die Pause traegt die Stelle des Hosts auf die Millisekunde",
    pause?.position === STELLE && pause?.videoTime === STELLE,
    `${pause?.position} / ${pause?.videoTime}`);
  pruefe("Und der Empfaenger springt genau dorthin - ohne Hochrechnung",
    sync.zielZeitBerechnen(sync.ereignisFuerPlayer(pause, sync.laeuftDanach(pause), 0, true),
      Date.now() + 5000) === STELLE);
  const urteil = sync.steuerungEntscheiden(pause, { gleicheAdresse: true, offen: { season: 1, episode: 4 } });
  pruefe("Das Urteil dazu lautet: genau anwenden",
    urteil.tun === "anwenden" && urteil.genau === true && urteil.nichtSpringen === false, urteil.tun);

  host.raeume.trennen();
  gast.raeume.trennen();
  await schlaf(150);

  // --- 4. Der Weg durch die Geraete ------------------------------------------

  const main = lies("src/main.js");
  pruefe("Der Rechner setzt das Tempo im eigenen Player und in fremden Rahmen",
    /spielerView\.webContents\.send\("spieler:rundentempo"/.test(main)
    && /watchpartySync\.tempoScript\(wert\)/.test(main));
  pruefe("Tempo und Fassung laufen an der Stellenrechnung vorbei",
    /if \(urteil\.tun === "tempo"\)[\s\S]{0,200}if \(urteil\.tun === "fassung"\)/.test(main));
  pruefe("Wer in einer Runde startet, nimmt deren Fassung",
    /rundenFassungFuer\(url\)/.test(main) && /linkFuerFassung\(gelesen\.links/.test(main));
  pruefe("Gibt sie nichts her, bleibt es nicht schwarz",
    /zurueck zur freien Wahl/.test(main));
  pruefe("Als Host wird die eigene Fassungswahl gemeldet",
    /meldeFassungInDieRunde\(gewaehlt\)/.test(main));

  const spieler = lies("src/renderer/spieler.js");
  pruefe("Der Player kennt dieselbe Leiter",
    /const TEMPO_STUFEN = \[0\.5, 0\.75, 1, 1\.25, 1\.5, 2\]/.test(spieler));
  pruefe("In einer Runde stellt nur der Host das Tempo",
    /const gesperrt = inRunde && !binHost;/.test(spieler));
  pruefe("Was aus der Runde kam, geht nicht zurueck",
    /bruecke\.aufTempo\(\(wert, host\) => \{[\s\S]{0,200}tempoSetzen\(wert, false\)/.test(spieler));
  pruefe("Eine neue Quelle bekommt das Tempo wieder aufgesetzt",
    /if \(bild\.playbackRate !== tempo\) tempoSetzen\(tempo, false\);/.test(spieler));

  const relay = lies("../sync-server/server.js");
  pruefe("Das Relay nimmt Tempo und Fassung nur vom Host",
    /if \(aktion === "tempo" \|\| aktion === "fassung"\) \{\s*\r?\n\s*if \(!istHost\) return;/.test(relay));
  pruefe("Und traegt das Tempo in jeden Befehl",
    /tempo: eintrag\.tempo \|\| 1,/.test(relay));
  pruefe("Die Karte der Runde fuehrt beides mit",
    /tempo: eintrag\.tempo \|\| 1,\s*\r?\n\s*fassung: eintrag\.fassung/.test(relay));

  const androidSpieler = lies("../android/app/src/main/java/local/elflix/android/DirektSpieler.java");
  pruefe("Android setzt das Tempo am Player",
    /player\.setPlaybackSpeed\(\(float\) tempo\)/.test(androidSpieler));
  pruefe("Android springt genau - nicht auf das Schluesselbild davor",
    /SeekParameters\.EXACT/.test(androidSpieler));
  pruefe("Beim Anhalten wird ohne Toleranz gesprungen",
    /boolean nahGenug = laeuftDanach\s*\r?\n\s*&& Math\.abs\(position\(\) - befehl\.ziel\) <= SPRUNG_AB_SEKUNDEN;/.test(androidSpieler));
  pruefe("Und der Puffer haelt hinter der Stelle etwas vor",
    /setBackBuffer\(30_000, true\)/.test(androidSpieler));

  const androidWiedergabe = lies("../android/app/src/main/java/local/elflix/android/DirektWiedergabe.java");
  pruefe("Android startet in der Fassung der Runde",
    /int rundenZeile = rundenFassungZeile\(\);/.test(androidWiedergabe));
  pruefe("Und uebernimmt sie, wenn der Host sie wechselt",
    /private void fassungAusRunde\(String fassung, String hosterName\)/.test(androidWiedergabe));

  const gut = pruefungen.filter(Boolean).length;
  console.log(`${gut}/${pruefungen.length} bestanden`);
  process.exit(gut === pruefungen.length ? 0 : 1);
})();
