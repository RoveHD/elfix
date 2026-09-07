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
  if (typeof hoechstens !== "number") hoechstens = 6000;
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
pruefe("Auch der Auslöser folgt der autoritativen Pause",
  sync.steuerungEntscheiden({ action: "pause", episodeId: "" }, { binHost: true }).nichtSpringen === false);

// --- Der verabredete Start ---------------------------------------------------
//
// "Beim Anhalten auf die Millisekunde, beim Starten gleichzeitig." Das erste
// steht weiter unten am echten Relay; das zweite ist diese Rechnung: nicht die
// Stelle von *jetzt* und sofort losfahren, sondern die Stelle von *gleich* und
// zum verabredeten Zeitpunkt loslassen. Die Spanne dazwischen ist die, in der
// gesprungen und gepuffert wird - vorher lag sie als Rueckstand fest.
const laufend = { videoTime: 100, timestamp: 1000, playing: true, hatUhr: true };
const plan = sync.startPlan(laufend, 1000, 600);
pruefe("Der Start wird verabredet, nicht sofort genommen",
  plan.wartenMs === 600, String(plan.wartenMs));
pruefe("Gesprungen wird dorthin, wo der Host beim Loslassen steht",
  Math.abs(plan.stelle - 100.6) < 1e-9, String(plan.stelle));
pruefe("Bei doppeltem Tempo ist das doppelt so weit",
  Math.abs(sync.startPlan({ ...laufend, tempo: 2 }, 1000, 600).stelle - 101.2) < 1e-9);
const halt = sync.startPlan({ ...laufend, playing: false }, 9000, 600);
pruefe("Eine Pause verabredet nichts - ihre Stelle gilt sofort und genau",
  halt.wartenMs === 0 && halt.stelle === 100, `${halt.wartenMs} / ${halt.stelle}`);
pruefe("Ohne gemessene Uhr wird nichts verabredet",
  sync.startPlan({ ...laufend, hatUhr: false }, 1000, 600).wartenMs === 0);
pruefe("Und ohne Vorlauf - der Host - auch nicht",
  sync.startPlan(laufend, 1000, 0).wartenMs === 0);
pruefe("Der Vorlauf ist gedeckelt; was hereinkommt, kommt aus einer Nachricht",
  sync.startPlan(laufend, 1000, 999999).wartenMs === 5000
  && sync.startPlan(laufend, 1000, -5).wartenMs === 0);
pruefe("Es gibt genau einen Vorlauf, und er steht im Modul",
  sync.START_VORLAUF_MS > 0 && sync.START_VORLAUF_MS <= 2000, String(sync.START_VORLAUF_MS));

const skript = sync.tempoScript(2);
pruefe("Das Skript fuer fremde Player setzt playbackRate",
  /playbackRate = 2;/.test(skript) && /querySelectorAll\("video"\)/.test(skript));
pruefe("Und es zwingt den Wert auf eine Stufe",
  /playbackRate = 2;/.test(sync.tempoScript(1.93)) && /playbackRate = 1;/.test(sync.tempoScript("boese")));

// --- 3. Am echten Relay ------------------------------------------------------

function geraet(name) {
  const steuerung = [];
  const gesendet = [];
  const nachrichten = [];
  const eingang = [];
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
  for (const raum of raeume.raeume.values()) {
    const verarbeiten = raum.nachrichtVerarbeiten.bind(raum);
    raum.nachrichtVerarbeiten = (roh) => {
      try { eingang.push(JSON.parse(String(roh))); } catch { /* ungueltig */ }
      return verarbeiten(roh);
    };
    const senden = raum.senden.bind(raum);
    raum.senden = (nachricht) => {
      nachrichten.push({ ...nachricht });
      if (nachricht?.type === "syncready") gesendet.push({ ...nachricht });
      return senden(nachricht);
    };
  }
  return {
    name, raeume, steuerung, gesendet, nachrichten, eingang,
    eintrag: () => zustand.find((wert) => wert.key === KEY) || null,
    letzte: (aktion) => [...steuerung].reverse().find((wert) => wert.action === aktion) || null
  };
}

// Ein Play ist jetzt eine Schranke: beide Player müssen die vom Relay
// angeordnete Pause/den Seek wirklich vorbereitet haben. Diese Helferfunktion
// bestätigt deshalb nicht blind, sondern verlangt auf beiden Seiten denselben
// syncId-tragenden `syncprepare` und wartet danach auf `syncstart`.
async function gemeinsamStarten(host, gast) {
  await warteBis(() => host.letzte("syncprepare") && gast.letzte("syncprepare"), "syncprepare fuer beide");
  const vorHost = host.letzte("syncprepare");
  const vorGast = gast.letzte("syncprepare");
  const syncId = String(vorHost?.syncId || "");
  const vorSendenHost = host.nachrichten.length;
  const vorSendenGast = gast.nachrichten.length;
  const vorEingangHost = host.eingang.length;
  const vorEingangGast = gast.eingang.length;
  pruefe("Beide bereiten denselben Start vor",
    Boolean(syncId) && syncId === String(vorGast?.syncId || "")
      && vorHost.playing === false && vorGast.playing === false,
    `${syncId} / ${vorGast?.syncId || ""}`);
  host.raeume.bereitZumStart(KEY, RAUM, syncId);
  gast.raeume.bereitZumStart(KEY, RAUM, syncId);
  const gestartet = await warteBis(() => host.letzte("syncstart") && gast.letzte("syncstart"), "syncstart fuer beide");
  pruefe("Nach beiden echten Bereitmeldungen kommt syncstart für beide", gestartet,
    `${host.letzte("syncstart")?.syncId || "-"} / ${gast.letzte("syncstart")?.syncId || "-"}; `
      + `ready=${host.gesendet.at(-1)?.syncId || "-"}/${gast.gesendet.at(-1)?.syncId || "-"}; `
      + `nachher=${host.nachrichten.slice(vorSendenHost).map((n) => n.type).join(",")}`
      + `/${gast.nachrichten.slice(vorSendenGast).map((n) => n.type).join(",")}; `
      + `eingang=${host.eingang.slice(vorEingangHost).map((n) => `${n.type}:${n.syncId || ""}`).join(",")}`
      + `/${gast.eingang.slice(vorEingangGast).map((n) => `${n.type}:${n.syncId || ""}`).join(",")}`);
  return { vorHost, vorGast, startHost: host.letzte("syncstart"), startGast: gast.letzte("syncstart") };
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
  // Nacheinander und nicht gleichzeitig: Host der Runde wird, wer zuerst
  // beitritt, und zwei Beitritte auf zwei Verbindungen koennen sich unterwegs
  // ueberholen. Genau das liess diese Pruefung gelegentlich mit "Der Einsteller
  // ist Host der Runde -> Gast" scheitern, ohne dass sich am Quelltext etwas
  // geaendert haette.
  host.raeume.beitreten(KEY, RAUM);
  await warteBis(() => host.eintrag()?.joined);
  gast.raeume.beitreten(KEY, RAUM);
  await warteBis(() => gast.eintrag()?.joined);
  // Beide melden ihre Folge - ohne das gilt ein Befehl nur unter Gleichfolgigen.
  host.raeume.meldeStand(KEY, { position: 312.5, paused: false, url: FOLGE, season: 1, episode: 4, playerSessionId: "host-sitzung" }, RAUM);
  // Die Hostwahl folgt dem ersten aktiven Player, nicht bloss der
  // Beitrittsreihenfolge. Erst dessen Meldung verarbeiten lassen, dann den
  // zweiten Player melden; zwei gleichzeitige WebSocket-Pakete waeren kein
  // belastbarer Test dafuer, wer die Runde fuehrt.
  await warteBis(() => host.eintrag()?.hostId === host.eintrag()?.myId);
  gast.raeume.meldeStand(KEY, { position: 300, paused: false, url: FOLGE, season: 1, episode: 4, playerSessionId: "gast-sitzung" }, RAUM);
  await schlaf(300);

  const wirklichHost = host.eintrag()?.hostId === host.eintrag()?.myId;
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
  // Und zwar wirklich als Zahl, nicht als gerundete Naeherung: 421, 421.0 und
  // 421.04 waeren alle "ungefaehr richtig" und alle das falsche Bild.
  pruefe("Nichts auf dem Weg rundet sie",
    pause?.position !== 421 && pause?.position !== 421.04
    && Math.abs(pause?.position - STELLE) === 0, String(pause?.position));
  pruefe("Eine Pause verabredet keinen Startzeitpunkt",
    !pause?.startAt, String(pause?.startAt));
  pruefe("Und der Empfaenger springt genau dorthin - ohne Hochrechnung",
    sync.zielZeitBerechnen(sync.ereignisFuerPlayer(pause, sync.laeuftDanach(pause), 0, true),
      Date.now() + 5000) === STELLE);
  const urteil = sync.steuerungEntscheiden(pause, { gleicheAdresse: true, offen: { season: 1, episode: 4 } });
  pruefe("Das Urteil dazu lautet: genau anwenden",
    urteil.tun === "anwenden" && urteil.genau === true && urteil.nichtSpringen === false, urteil.tun);

  // --- Der gemeinsame Start am echten Relay ---
  host.steuerung.length = 0;
  gast.steuerung.length = 0;
  const vorPlay = gast.steuerung.length;
  host.raeume.steuernMitEinstellung(KEY, "play", STELLE, FOLGE, RAUM,
    { startAt: Date.now() + sync.START_VORLAUF_MS });
  await warteBis(() => gast.steuerung.length > vorPlay && gast.letzte("syncprepare"));
  const start = await gemeinsamStarten(host, gast);
  const losfahrt = start.startGast;
  pruefe("Auch der gemeinsame Start traegt das Tempo der Runde mit",
    losfahrt?.tempo === 2, String(losfahrt?.tempo));
  pruefe("Ein Play traegt einen gemeinsamen Zeitpunkt",
    Number(losfahrt?.startAt) > Date.now(), String(losfahrt?.startAt));
  pruefe("Er liegt in der nahen Zukunft und nicht irgendwo",
    Number(losfahrt?.startAt) - Date.now() <= 5000);
  pruefe("Und die Stelle dazu ist die des Ausloesers, unveraendert",
    losfahrt?.videoTime === STELLE, String(losfahrt?.videoTime));
  // Derselbe Zeitpunkt, zwei Geraete: was jedes noch warten muss, endet im
  // selben Augenblick. Genau das ist "gleichzeitig".
  const startEreignis = losfahrt ? sync.ereignisFuerPlayer(losfahrt, true, 0, true) : null;
  const alsHost = startEreignis ? sync.startPlan(startEreignis, losfahrt.at) : null;
  const alsGast = startEreignis ? sync.startPlan(startEreignis, losfahrt.at + 200) : null;
  pruefe("Beide zielen auf denselben Serverzeitpunkt",
    Boolean(losfahrt) && losfahrt.at + alsHost.wartenMs === (losfahrt.at + 200) + alsGast.wartenMs,
    `${alsHost?.wartenMs} / ${alsGast?.wartenMs}`);
  pruefe("Und auf dieselbe Stelle",
    alsHost?.stelle === STELLE && alsGast?.stelle === STELLE);

  host.raeume.trennen();
  gast.raeume.trennen();
  await schlaf(150);

  // --- 4. Der Weg durch die Geraete ------------------------------------------

  const main = lies("src/main.js");
  pruefe("Der Rechner setzt das Tempo im eigenen Player und in fremden Rahmen",
    /spielerView\.webContents\.send\("spieler:rundentempo"/.test(main)
    && /watchpartySync\.tempoScript\(wert\)/.test(main));
  pruefe("Der Rechner verabredet den Start, statt sofort loszufahren",
    /watchpartySync\.startPlan\(/.test(main) && /wartenMs: plan\.wartenMs/.test(main));
  pruefe("Auch der Ausloeser wartet den gemeinsamen Augenblick ab",
    /laufen \? watchpartySync\.START_VORLAUF_MS : 0/.test(main)
    && /watchparty\.steuernMitEinstellung\(runde\.key, "play", wo, runde\.adresse, runde\.raum, \{ startAt \}\)/.test(main));
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
  pruefe("Der eigene Player wartet den verabredeten Zeitpunkt ab",
    /async function startVerabredet\(stelle, wartenMs, springen = true,[\s\S]{0,80}startLokal = Date.now\(\) \+ wartenMs, frameZiel = null\)/.test(spieler)
    && /await bereitFuerStart\(springen \? stelle : Number\(bild\.currentTime\) \|\| 0, 2500\);/.test(spieler));
  pruefe("Wer zu spaet fertig wird, bekommt die Verspaetung an der Stelle gutgeschrieben",
    /const zuspaet = \(Date\.now\(\) - frist\) \/ 1000;/.test(spieler)
    && /stelleSetzen\(stelle \+ zuspaet \* tempo, meiner\)/.test(spieler));
  const spielerSeite = lies("src/renderer/spieler.html");
  pruefe("Und das Tempo waehlt man nicht mehr in einem Systemmenue",
    /class Wahl \{/.test(spieler)
    && /<div class="wahl" id="tempo"><\/div>/.test(spielerSeite)
    && !/<\/select>/.test(spielerSeite),
    "eigenes Auswahlfeld");

  const relay = lies("../sync-server/server.js");
  pruefe("Das Relay nimmt Tempo und Fassung nur vom Host",
    /if \(aktion === "tempo" \|\| aktion === "fassung"\) \{\s*\r?\n\s*if \(!istHost\) return;/.test(relay));
  pruefe("Und traegt das Tempo in jeden Befehl",
    /tempo: eintrag\.tempo \|\| 1,/.test(relay));
  pruefe("Die Karte der Runde fuehrt beides mit",
    /tempo: eintrag\.tempo \|\| 1,\s*\r?\n\s*fassung: eintrag\.fassung/.test(relay));

  const androidSpieler = lies("../android/app/src/main/java/local/elflix/android/DirektSpieler.java");
  const androidKern = lies("../android/app/src/main/assets/kern/eigen/direkt-android.js");
  pruefe("Android rechnet denselben Plan - im geteilten Kern",
    /sync\.startPlan\(e, Date\.now\(\) \+ \(e\.versatz \|\| 0\), vorlauf\)/.test(androidKern)
    && /!urteil\.nichtSpringen && !urteil\.warten && e\.playing/.test(androidKern));
  pruefe("Android wartet den Zeitpunkt ab, statt sofort loszulassen",
    /long rest = befehl\.startBei - SystemClock\.uptimeMillis\(\);/.test(
      lies("../android/app/src/main/java/local/elflix/android/DirektSpieler.java")));
  pruefe("Android setzt das Tempo am Player",
    /player\.setPlaybackSpeed\(\(float\) tempo\)/.test(androidSpieler));
  pruefe("Android springt genau - nicht auf das Schluesselbild davor",
    /SeekParameters\.EXACT/.test(androidSpieler));
  pruefe("Beim Anhalten wird ohne Toleranz gesprungen",
    /boolean nahGenug = laeuftDanach && !Double\.isFinite\(befehl\.frameZiel\)\s*\r?\n\s*&& Math\.abs\(position\(\) - befehl\.ziel\) <= SPRUNG_AB_SEKUNDEN;/.test(androidSpieler));
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
