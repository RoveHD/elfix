"use strict";

// Der Sicherheitsvertrag zwischen App und Relay: sichtbare Namen und Kennungen
// sind keine Besitznachweise. Nur der geheime, je Geraet gespeicherte Nachweis
// darf eine vorhandene Mitgliedschaft oder Besitzeraktion wiederaufnehmen.

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const WS = require("../../sync-server/node_modules/ws");
const {
  Watchparty,
  geraeteNachweisFuerServer,
  kontoNachweisFuerServer
} = require("../src/watchparty");
const { WatchpartyRaeume } = require("../src/watchparty-raeume");

const PORT = Number(process.env.TESTPORT) || 8799;
const ADRESSE = `ws://127.0.0.1:${PORT}`;
const RAUM = "sicherheitsraum";
const KEY = "serie:sicher";
const LEER_KEY = "serie:leer";
const URL1 = "https://aniworld.to/anime/stream/sicher/staffel-1/episode-1";
const URL2 = "https://aniworld.to/anime/stream/sicher/staffel-1/episode-2";
const URL3 = "https://aniworld.to/anime/stream/sicher/staffel-1/episode-3";
const URL4 = "https://aniworld.to/anime/stream/sicher/staffel-1/episode-4";

const pruefungen = [];
function pruefe(name, bedingung, detail = "") {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? ` -> ${detail}` : ""}`);
}

function nachweis(name) {
  return crypto.createHash("sha256").update(name).digest("base64url");
}

function client(name, secret = "") {
  let socket;
  const eingang = [];
  const warten = [];
  const api = {
    name,
    secret,
    deviceId: "",
    eingang,
    get socket() { return socket; },
    async verbinden(zusatz = {}) {
      await new Promise((resolve, reject) => {
        socket = new WS(ADRESSE);
        socket.once("open", resolve);
        socket.once("error", reject);
        socket.on("message", (roh) => {
          const meldung = JSON.parse(String(roh));
          eingang.push(meldung);
          if (meldung.type === "state" && meldung.you) api.deviceId = String(meldung.you);
          for (let i = warten.length - 1; i >= 0; i -= 1) {
            if (!warten[i].passt(meldung)) continue;
            warten[i].resolve(meldung);
            warten.splice(i, 1);
          }
        });
      });
      api.senden({
        type: "join", room: RAUM, name,
        ...(secret ? { deviceProof: secret } : {}),
        ...zusatz
      });
      return api.erwarte((m) => m.type === "state" || m.type === "error", "Beitrittsantwort");
    },
    senden(meldung) { socket.send(JSON.stringify(meldung)); },
    roh(wert) { socket.send(wert); },
    schliessen() { socket?.close(); },
    erwarte(passt, was, frist = 2000) {
      const vorhanden = eingang.find(passt);
      if (vorhanden) return Promise.resolve(vorhanden);
      return new Promise((resolve) => {
        const eintrag = { passt, resolve };
        warten.push(eintrag);
        setTimeout(() => {
          const index = warten.indexOf(eintrag);
          if (index >= 0) warten.splice(index, 1);
          resolve(null);
        }, frist).unref?.();
      });
    }
  };
  return api;
}

function gesund() {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path: "/health", timeout: 1000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

const schlafen = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function wartenBis(pruefung, frist = 2500) {
  const ende = Date.now() + frist;
  while (Date.now() < ende) {
    if (await pruefung()) return true;
    await schlafen(25);
  }
  return false;
}

async function legacyAblagePruefen() {
  const ablage = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-relay-legacy-"));
  fs.writeFileSync(path.join(ablage, "raeume.json"), JSON.stringify({
    raeume: {
      legacyraum: {
        at: Date.now(), graeber: [], titel: [{
          key: "serie:legacy", url: URL1, title: "Alt", type: "serie",
          addedBy: "Alt", addedById: "legacy-owner", members: [["legacy-owner", "Alt"]]
        }]
      }
    },
    geraete: {}
  }));
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const nummer = probe.address().port;
      probe.close((fehler) => fehler ? reject(fehler) : resolve(nummer));
    });
  });
  const relay = spawn(process.execPath, [path.join(__dirname, "../../sync-server/server.js")], {
    env: {
      ...process.env, PORT: String(port), STATE_DIRECTORY: ablage,
      ELFIX_RELAY_SEITE: "0", ELFIX_RELAY_LEISTE: "0"
    },
    stdio: "ignore"
  });
  try {
    const bereit = await wartenBis(() => new Promise((resolve) => {
      const req = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 200 }, (res) => {
        res.resume(); resolve(res.statusCode === 200);
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
    }));
    if (!bereit) return false;
    const antwort = await new Promise((resolve, reject) => {
      const socket = new WS(`ws://127.0.0.1:${port}`);
      socket.once("error", reject);
      socket.on("message", (roh) => {
        const meldung = JSON.parse(String(roh));
        if (meldung.type !== "state") return;
        socket.close();
        resolve(meldung);
      });
      socket.once("open", () => socket.send(JSON.stringify({
        type: "join", room: "legacyraum", name: "Alt",
        deviceId: "legacy-owner", deviceProof: nachweis("anderer-besitzer")
      })));
    });
    return antwort.you !== "legacy-owner"
      && antwort.shared?.[0]?.addedById === "legacy-owner"
      && antwort.shared?.[0]?.mine === false;
  } finally {
    relay.kill();
    await Promise.race([
      new Promise((resolve) => relay.once("exit", resolve)),
      schlafen(1000)
    ]);
    fs.rmSync(ablage, { recursive: true, force: true });
  }
}

(async () => {
  const hostSecret = nachweis("host-geheimnis");
  const gastSecret = nachweis("gast-geheimnis");
  const kontoProof = nachweis("gemeinsames-konto");
  const host = client("Doppelname", hostSecret);
  const ersterStand = await host.verbinden({ accountProof: kontoProof });
  pruefe("Das Relay bestaetigt das sichere Identitaetsprotokoll",
    ersterStand?.identityVersion === 2 && Boolean(host.deviceId));

  host.senden({
    type: "share",
    item: { key: KEY, url: URL1, title: "Sicher", type: "serie", season: 1, episode: 1 }
  });
  const geteilt = await host.erwarte((m) => m.type === "state" && m.shared?.some((x) => x.key === KEY), "geteilt");
  const hostEintrag = geteilt?.shared?.find((x) => x.key === KEY);
  pruefe("Geheime Kontokennzeichen verlassen das Relay nicht",
    hostEintrag?.mine === true && !("addedByKonto" in hostEintrag));

  // Besitz und Player-Rolle sind getrennt. Vor dem ersten Playerstand gibt es
  // bewusst noch keinen Host; der erste echte Stand des allein beigetretenen
  // Geraets muss die Rolle aber sofort an dessen nachgewiesene ID binden.
  host.senden({
    type: "here", key: KEY, position: 0, paused: true, season: 1, episode: 1,
    playerSessionId: "host-bootstrap"
  });
  const alleinHost = await host.erwarte((m) => m.type === "state"
    && m.shared?.find((x) => x.key === KEY)?.hostId === host.deviceId, "alleiniger Host");
  pruefe("Der erste aktive Stand macht das alleinige Mitglied zum Host",
    alleinHost?.shared?.find((x) => x.key === KEY)?.hostId === host.deviceId);
  host.senden({ type: "control", key: KEY, action: "pause", position: 3, url: URL1 });
  const alleinSteuert = await host.erwarte((m) => m.type === "control"
    && m.action === "pause" && m.position === 3, "Steuerung als alleiniger Host");
  pruefe("Der alleinige Host kann die Runde danach steuern", Boolean(alleinSteuert));

  const gast = client("Doppelname", gastSecret);
  const gastStand = await gast.verbinden({ konto: kontoProof });
  const vorBeitritt = gastStand?.shared?.find((x) => x.key === KEY);
  pruefe("Der echte Relayvertrag behaelt Peer-Namen als Strings",
    Array.isArray(gastStand?.peers) && gastStand.peers.includes("Doppelname"));
  pruefe("Doppelte Anzeigenamen uebertragen keine Mitgliedschaft",
    gast.deviceId !== host.deviceId
      && vorBeitritt?.addedById === host.deviceId
      && vorBeitritt?.memberIds?.includes(host.deviceId)
      && !vorBeitritt?.memberIds?.includes(gast.deviceId));
  pruefe("Doppelte Anzeigenamen uebertragen keine Besitzerrechte", vorBeitritt?.mine === false);

  // Bereits geparstes, aber falsch geformtes JSON muss innerhalb desselben
  // Sockets folgenlos bleiben. Danach beweist eine echte Chatzeile, dass der
  // Handler und der Prozess weiterarbeiten.
  for (const roh of ["null", "42", "[]", "\"text\"", "{}", '{"type":[]}',
    '{"type":"share","item":[]}', '{"type":"progress","key":"x","progress":[]}',
    '{"type":"chat","text":{"toString":1}}',
    '{"type":"control","key":{"toString":1},"action":"play","position":{"valueOf":1}}',
    `{"type":"here","key":"${KEY}","position":{"valueOf":1},"episode":1,"season":1}`]) {
    gast.roh(roh);
  }
  gast.senden({ type: "chat", text: "noch da" });
  const chat = await host.erwarte((m) => m.type === "chat" && m.text === "noch da", "Chat nach Fehleingaben");
  pruefe("Fehlgeformte JSON-Nachrichten beenden weder Handler noch Relay", Boolean(chat) && await gesund());

  const boeserName = client({ toString: 1 }, nachweis("boeser-name"));
  const boeserNameStand = await boeserName.verbinden();
  pruefe("Auch falsch typisierte Felder beim Beitritt bleiben folgenlos",
    boeserNameStand?.type === "state" && await gesund());

  const spion = client("Doppelname");
  const abgewiesen = await spion.verbinden({ deviceId: host.deviceId });
  pruefe("Eine sichtbare Geraetekennung ohne Geheimnis wird abgewiesen",
    abgewiesen?.type === "error" && abgewiesen?.code === "identity-required");
  spion.senden({ type: "unshare", key: KEY });

  const zweiterSpion = client("Doppelname", nachweis("fremder-nachweis"));
  const kollisionsStand = await zweiterSpion.verbinden({ deviceId: host.deviceId });
  pruefe("Auch ein anderer gueltiger Nachweis kann keine belegte Kennung reservieren",
    kollisionsStand?.type === "state" && zweiterSpion.deviceId !== host.deviceId
      && kollisionsStand.shared?.find((x) => x.key === KEY)?.addedById === host.deviceId);

  // Ein legitimer Neustart besitzt dagegen denselben geheimen Nachweis. Die
  // serverseitige Mitgliedschaft und Besitzerkennung bleiben unveraendert.
  host.schliessen();
  const wieder = client("Umbenannt", hostSecret);
  const wiederStand = await wieder.verbinden({ accountProof: kontoProof });
  const wiederEintrag = wiederStand?.shared?.find((x) => x.key === KEY);
  pruefe("Der geheime Nachweis nimmt dieselbe Geraetekennung wieder auf", wieder.deviceId === host.deviceId);
  pruefe("Legitime Wiederverbindung behaelt Mitgliedschaft und Besitz",
    wiederEintrag?.memberIds?.includes(wieder.deviceId)
      && wiederEintrag?.addedById === wieder.deviceId
      && wiederEintrag?.mine === true);

  gast.senden({ type: "enter", key: KEY });
  await gast.erwarte((m) => m.type === "state"
    && m.shared?.find((x) => x.key === KEY)?.memberIds?.includes(gast.deviceId), "Gastbeitritt");
  gast.senden({
    type: "here", key: KEY, position: 12.13, paused: false, season: 1, episode: 1,
    frameTime: 12.125, playbackRate: 1.25, buffering: true, playerSessionId: "gast-e1"
  });
  const diagnose = await wieder.erwarte((m) => m.type === "watchstate"
    && m.members?.some((mitglied) => mitglied.id === gast.deviceId), "Diagnosestand");
  const gastDiagnose = diagnose?.members?.find((mitglied) => mitglied.id === gast.deviceId);
  pruefe("Der Relay-Diagnosestand traegt nur wirklich gemeldete Playerwerte",
    gastDiagnose?.frameTime === 12.125 && gastDiagnose?.playbackRate === 1.25
      && gastDiagnose?.buffering === true && diagnose?.tempo === 1);
  gast.senden({ type: "control", key: KEY, action: "navigate", position: 0, url: URL2 });
  const folge2 = await wieder.erwarte((m) => m.type === "state"
    && m.shared?.find((x) => x.key === KEY)?.episode === 2, "Folge 2");
  pruefe("Beigetretene Gaeste duerfen weiterhin die naechste Folge starten", Boolean(folge2));

  // Ein Folgenwechsel startet keinen Player fuer sich allein: alle aktuell
  // verbundenen Mitglieder laden erst die neue Folge und bestaetigen danach
  // dieselbe Vorbereitung.
  const dritter = client("Dritter", nachweis("dritter-nachweis"));
  await dritter.verbinden();
  dritter.senden({ type: "enter", key: KEY });
  await dritter.erwarte((m) => m.type === "state"
    && m.shared?.find((x) => x.key === KEY)?.memberIds?.includes(dritter.deviceId), "dritter Beitritt");
  // Und alle drei haben den Titel wirklich im Player. Erwartet wird beim
  // Folgenwechsel, wer ihn offen hat: ein Geraet, das nur im Raum sitzt, hat
  // nichts vorzubereiten und hielt die uebrigen sonst die volle Frist fest.
  // Der wiederverbundene Host gehoert dazu - sein alter Stand ging mit dem
  // alten Socket.
  dritter.senden({
    type: "here", key: KEY, position: 0, paused: true, season: 1, episode: 2,
    playerSessionId: "dritter-player"
  });
  wieder.senden({
    type: "here", key: KEY, position: 0, paused: true, season: 1, episode: 2,
    playerSessionId: "host-wieder"
  });
  await dritter.erwarte((m) => m.type === "watchstate" && m.key === KEY
    && m.members?.length >= 3, "Playerstaende aller drei");
  gast.senden({ type: "control", key: KEY, action: "navigate", position: 0, url: URL1 });
  const [vorHost, vorGast, vorDritter] = await Promise.all([
    wieder.erwarte((m) => m.type === "syncprepare" && m.reason === "episode-change" && m.url === URL1,
      "Host Vorbereitung"),
    gast.erwarte((m) => m.type === "syncprepare" && m.reason === "episode-change" && m.url === URL1,
      "Gast Vorbereitung"),
    dritter.erwarte((m) => m.type === "syncprepare" && m.reason === "episode-change" && m.url === URL1,
      "Dritter Vorbereitung")
  ]);
  const syncId = vorHost?.syncId;
  pruefe("Der Gast-Folgenwechsel bereitet alle verbundenen Mitglieder gemeinsam vor",
    Boolean(syncId) && vorGast?.syncId === syncId && vorDritter?.syncId === syncId
      && vorHost?.url === URL1 && vorHost?.episodeId === "s1e1",
    JSON.stringify({ host: vorHost, gast: vorGast, dritter: vorDritter }));
  wieder.senden({ type: "syncready", key: KEY, syncId });
  gast.senden({ type: "syncready", key: KEY, syncId });
  await schlafen(150);
  pruefe("Vor der letzten Bereitschaft startet kein Mitglied",
    ![wieder, gast, dritter].some((geraet) => geraet.eingang
      .some((m) => m.type === "syncstart" && m.syncId === syncId)));
  dritter.senden({ type: "syncready", key: KEY, syncId });
  const starts = await Promise.all([wieder, gast, dritter].map((geraet) =>
    geraet.erwarte((m) => m.type === "syncstart" && m.syncId === syncId, "gemeinsamer Folgenstart")));
  pruefe("Nach allen Bereitschaften folgt genau ein gemeinsamer Start",
    starts.every((start) => start?.url === URL1 && start?.episodeId === "s1e1")
      && [wieder, gast, dritter].every((geraet) => geraet.eingang
        .filter((m) => m.type === "syncstart" && m.syncId === syncId).length === 1),
    JSON.stringify(starts));

  // Die Schranke gehoert zur authentifizierten Geraete-ID, nicht zum alten
  // Socket. Ein Wiederanschluss muss dieselbe Generation neu bekommen und
  // wieder als unbereit zaehlen, bis sein neuer Player wirklich steht.
  gast.senden({ type: "control", key: KEY, action: "navigate", position: 0, url: URL3 });
  const [wiederVorReconnect, gastVorReconnect, dritterVorReconnect] = await Promise.all([
    wieder.erwarte((m) => m.type === "syncprepare" && m.reason === "episode-change" && m.url === URL3,
      "Host Vorbereitung vor Reconnect"),
    gast.erwarte((m) => m.type === "syncprepare" && m.reason === "episode-change" && m.url === URL3,
      "Gast Vorbereitung vor Reconnect"),
    dritter.erwarte((m) => m.type === "syncprepare" && m.reason === "episode-change" && m.url === URL3,
      "Dritter Vorbereitung vor Reconnect")
  ]);
  const reconnectSyncId = wiederVorReconnect?.syncId;
  dritter.schliessen();
  await schlafen(120);
  const dritterNeu = client("Dritter neu", nachweis("dritter-nachweis"));
  await dritterNeu.verbinden();
  const reconnectVorbereitung = await dritterNeu.erwarte((m) =>
    m.type === "syncprepare" && m.syncId === reconnectSyncId, "Vorbereitung nach Reconnect");
  pruefe("Ein authentifizierter Wiederanschluss bekommt die offene Vorbereitung erneut",
    dritterNeu.deviceId === dritter.deviceId
      && reconnectVorbereitung?.url === URL3
      && gastVorReconnect?.syncId === reconnectSyncId
      && dritterVorReconnect?.syncId === reconnectSyncId,
    JSON.stringify({ alt: dritter.deviceId, neu: dritterNeu.deviceId,
      reconnectSyncId, reconnectVorbereitung, gast: gastVorReconnect?.syncId,
      dritter: dritterVorReconnect?.syncId,
      eingang: dritterNeu.eingang.map((m) => `${m.type}:${m.syncId || ""}`) }));
  wieder.senden({ type: "syncready", key: KEY, syncId: reconnectSyncId });
  gast.senden({ type: "syncready", key: KEY, syncId: reconnectSyncId });
  await schlafen(150);
  pruefe("Der neue Socket muss seine eigene Vorbereitung bestaetigen",
    ![wieder, gast, dritterNeu].some((geraet) => geraet.eingang
      .some((m) => m.type === "syncstart" && m.syncId === reconnectSyncId)));
  dritterNeu.senden({ type: "syncready", key: KEY, syncId: reconnectSyncId });
  const reconnectStarts = await Promise.all([wieder, gast, dritterNeu].map((geraet) =>
    geraet.erwarte((m) => m.type === "syncstart" && m.syncId === reconnectSyncId,
      "gemeinsamer Start nach Reconnect")));
  // Der neue Socket meldet seinen Playerstand nach - der alte ging mit der
  // getrennten Verbindung. Ohne ihn gehoert er zur naechsten Schranke nicht
  // mehr dazu; im Betrieb erledigt das der Herzschlag im Sekundentakt.
  dritterNeu.senden({
    type: "here", key: KEY, position: 0, paused: true, season: 1, episode: 3,
    playerSessionId: "dritter-neu-player"
  });
  await dritterNeu.erwarte((m) => m.type === "watchstate" && m.key === KEY
    && m.members?.some((mitglied) => mitglied.id === dritterNeu.deviceId),
  "Playerstand des wiederverbundenen Dritten");
  pruefe("Nach der neuen Bereitschaft startet dieselbe Generation gemeinsam",
    reconnectStarts.every((start) => start?.url === URL3 && start?.episodeId === "s1e3"),
    JSON.stringify(reconnectStarts));

  // Trennt sich nur der letzte noch unbereite Teilnehmer, warten die uebrigen
  // verbundenen Geraete nicht die vollen 90 Sekunden auf einen toten Socket.
  gast.senden({ type: "control", key: KEY, action: "navigate", position: 0, url: URL4 });
  const [wiederVorAbbruch, gastVorAbbruch, dritterVorAbbruch] = await Promise.all([
    wieder.erwarte((m) => m.type === "syncprepare" && m.reason === "episode-change" && m.url === URL4,
      "Host Vorbereitung vor Abbruch"),
    gast.erwarte((m) => m.type === "syncprepare" && m.reason === "episode-change" && m.url === URL4,
      "Gast Vorbereitung vor Abbruch"),
    dritterNeu.erwarte((m) => m.type === "syncprepare" && m.reason === "episode-change" && m.url === URL4,
      "Dritter Vorbereitung vor Abbruch")
  ]);
  const abbruchSyncId = wiederVorAbbruch?.syncId;
  wieder.senden({ type: "syncready", key: KEY, syncId: abbruchSyncId });
  gast.senden({ type: "syncready", key: KEY, syncId: abbruchSyncId });
  await schlafen(100);
  pruefe("Solange der dritte Socket offen ist, bleibt die Schranke geschlossen",
    !wieder.eingang.some((m) => m.type === "syncstart" && m.syncId === abbruchSyncId)
      && gastVorAbbruch?.syncId === abbruchSyncId && dritterVorAbbruch?.syncId === abbruchSyncId);
  dritterNeu.schliessen();
  const startsNachAbbruch = await Promise.all([wieder, gast].map((geraet) =>
    geraet.erwarte((m) => m.type === "syncstart" && m.syncId === abbruchSyncId,
      "Start nach Trennung", 1500)));
  pruefe("Ein getrennter letzter Warter blockiert die verbundenen Teilnehmer nicht",
    startsNachAbbruch.every((start) => start?.url === URL4 && start?.episodeId === "s1e4"));

  // Ein zweites echtes Geraet desselben Kontos bekommt die Besitzerentscheidung
  // vom Relay, obwohl seine Geraeteidentitaet verschieden ist. Die alte rohe
  // `konto`-Behauptung des Gasts oben hat genau dieses Recht nicht erhalten.
  const kontoGeraet = client("Kontogeraet", nachweis("konto-geraet"));
  const kontoStand = await kontoGeraet.verbinden({ accountProof: kontoProof });
  pruefe("Ein zweites nachgewiesenes Kontogeraet erhaelt Besitzerrechte",
    kontoGeraet.deviceId !== wieder.deviceId
      && kontoStand?.shared?.find((x) => x.key === KEY)?.mine === true
      && gastStand?.shared?.find((x) => x.key === KEY)?.mine === false);
  kontoGeraet.senden({ type: "unshare", key: KEY });
  const entfernt = await gast.erwarte((m) => m.type === "state" && !m.shared?.some((x) => x.key === KEY), "entfernt");
  pruefe("Das nachgewiesene Kontogeraet darf den Titel entfernen", Boolean(entfernt));
  await schlafen(1200);
  const zustandsPfad = path.join(process.env.STATE_DIRECTORY || "", "raeume.json");
  const gespeicherterText = fs.existsSync(zustandsPfad) ? fs.readFileSync(zustandsPfad, "utf8") : "";
  const gespeicherterStand = gespeicherterText ? JSON.parse(gespeicherterText) : null;
  pruefe("Die Relay-Ablage enthaelt nur Fingerabdruecke, keine rohen Nachweise",
    Boolean(gespeicherterStand)
      && ![hostSecret, gastSecret, kontoProof].some((geheimnis) => gespeicherterText.includes(geheimnis))
      && gespeicherterStand.identitaeten?.every((eintrag) =>
        /^[0-9a-f]{64}$/.test(eintrag.fingerabdruck)
        && (!eintrag.konto || /^[0-9a-f]{64}$/.test(eintrag.konto))));

  // Die echte gemeinsame Clientimplementierung muss den gespeicherten
  // Wurzelnachweis servergebunden ableiten und darf ihn nie als JSON senden.
  const joins = [];
  class BeobachteterSocket extends WS {
    send(daten, ...rest) {
      try {
        const meldung = JSON.parse(String(daten));
        if (meldung.type === "join") joins.push(meldung);
      } catch {}
      return super.send(daten, ...rest);
    }
  }
  const identitaeten = [];
  const fassade = new WatchpartyRaeume({
    WebSocketKlasse: BeobachteterSocket,
    onDeviceIdentity: (identitaet) => identitaeten.push(identitaet)
  });
  fassade.konfigurieren({
    enabled: true, serverUrl: ADRESSE, rooms: ["clientraum"], name: "Echter Client",
    deviceId: "", deviceSecret: ""
  });
  await wartenBis(() => identitaeten.some((eintrag) => eintrag.deviceId));
  const clientIdentitaet = identitaeten.find((eintrag) => eintrag.deviceId);
  pruefe("Der echte Client erhaelt eine getrennte private und oeffentliche Identitaet",
    /^[A-Za-z0-9_-]{43}$/.test(clientIdentitaet?.deviceSecret || "")
      && Boolean(clientIdentitaet?.deviceId));
  pruefe("Auf der Leitung steht nur der servergebundene Beweis, nie das Wurzelgeheimnis",
    /^[A-Za-z0-9_-]{43}$/.test(joins[0]?.deviceProof || "")
      && !("deviceSecret" in (joins[0] || {}))
      && joins[0]?.deviceProof !== clientIdentitaet?.deviceSecret);
  fassade.trennen();

  let unsicherGebaut = 0;
  class UnsichererSocket { constructor() { unsicherGebaut += 1; } }
  const unsicher = new Watchparty({ WebSocketKlasse: UnsichererSocket });
  unsicher.konfigurieren({
    enabled: true, serverUrl: "ws://relay.example", room: "clientraum", name: "Test",
    deviceSecret: nachweis("wurzel")
  });
  pruefe("Ein privater Nachweis geht nie ueber eine entfernte Klartextverbindung",
    unsicherGebaut === 0 && /verschlüsselte/.test(unsicher.status().error));

  const wurzel = nachweis("serverbindung");
  pruefe("Geraete- und Kontonachweise sind an genau ein Relay gebunden",
    geraeteNachweisFuerServer(wurzel, "wss://eins.example")
      !== geraeteNachweisFuerServer(wurzel, "wss://zwei.example")
      && kontoNachweisFuerServer("b".repeat(32), "wss://eins.example")
        !== kontoNachweisFuerServer("b".repeat(32), "wss://zwei.example"));

  const altSockets = [];
  class AltesRelaySocket {
    constructor() { this.readyState = 0; this.gesendet = []; altSockets.push(this); }
    send(daten) { this.gesendet.push(JSON.parse(String(daten))); }
    close() { this.readyState = 3; }
  }
  const alt = new Watchparty({ WebSocketKlasse: AltesRelaySocket });
  alt.konfigurieren({
    enabled: true, serverUrl: "ws://127.0.0.1:8787", room: "clientraum", name: "Alt",
    deviceSecret: wurzel
  });
  altSockets[0].readyState = 1;
  altSockets[0].onopen();
  altSockets[0].onmessage({ data: JSON.stringify({ type: "state", you: "frei-behauptet", shared: [] }) });
  pruefe("Ein altes Relay wird erkannt und nicht still im unsicheren Modus benutzt",
    alt.unvereinbar === true && /aktualisiert/.test(alt.status().error)
      && altSockets[0].readyState === 3);

  let clientSchemaSicher = true;
  let bereinigterChat = null;
  class BoesesRelaySocket {
    constructor() { this.readyState = 0; }
    close() { this.readyState = 3; }
  }
  const schemaClient = new Watchparty({
    WebSocketKlasse: BoesesRelaySocket,
    onChat: (meldung) => { bereinigterChat = meldung; }
  });
  schemaClient.konfigurieren({
    enabled: true, serverUrl: "ws://127.0.0.1:8788", room: "clientraum", name: "Schema",
    deviceSecret: wurzel
  });
  try {
    schemaClient.nachrichtVerarbeiten(JSON.stringify({
      type: "state", identityVersion: 2, you: "sichere-id",
      shared: [null, 7, { key: { toString: 1 } }, {
        key: "serie:sauber", title: { toString: 1 }, memberIds: [{}, "sichere-id"],
        progress: { season: 1, from: { toString: 1 } }
      }]
    }));
    schemaClient.nachrichtVerarbeiten(JSON.stringify({
      type: "chat", text: { toString: 1 }, from: { toString: 1 }, at: { valueOf: 1 }
    }));
    schemaClient.nachrichtVerarbeiten(JSON.stringify({
      type: "timeack", t0: { valueOf: 1 }, t1: { valueOf: 1 }
    }));
  } catch {
    clientSchemaSicher = false;
  }
  const saubererEintrag = schemaClient.eintraege()[0];
  pruefe("Der Client bereinigt falsch typisierte Relay-Zustaende vor Rueckrufen",
    clientSchemaSicher && schemaClient.eintraege().length === 1
      && saubererEintrag?.key === "serie:sauber" && saubererEintrag?.title === undefined
      && saubererEintrag?.memberIds?.length === 1 && bereinigterChat?.text === "");

  let falscheVersionSicher = true;
  const versionsClient = new Watchparty({ WebSocketKlasse: BoesesRelaySocket });
  versionsClient.konfigurieren({
    enabled: true, serverUrl: "ws://127.0.0.1:8789", room: "clientraum", name: "Version",
    deviceSecret: wurzel
  });
  try {
    versionsClient.nachrichtVerarbeiten(JSON.stringify({
      type: "state", identityVersion: { valueOf: 2 }, you: "boese", shared: []
    }));
  } catch {
    falscheVersionSicher = false;
  }
  pruefe("Eine objektfoermige Protokollversion wird sicher abgewiesen",
    falscheVersionSicher && versionsClient.unvereinbar === true);

  pruefe("Eine belegte Kennung aus einer alten Relay-Ablage wird nicht still uebernommen",
    await legacyAblagePruefen());

  // Wenn wirklich alle Teilnehmer fort sind, darf das Relay nicht in den
  // leeren Raum starten. Die offene Generation bleibt stattdessen erhalten
  // und wird dem ersten legitimen Wiederanschluss erneut angeboten.
  wieder.senden({
    type: "share",
    item: { key: LEER_KEY, url: URL1, title: "Leerer Raum", type: "serie", season: 1, episode: 1 }
  });
  await wieder.erwarte((m) => m.type === "state" && m.shared?.some((x) => x.key === LEER_KEY),
    "zweiter Titel");
  gast.senden({ type: "enter", key: LEER_KEY });
  await gast.erwarte((m) => m.type === "state"
    && m.shared?.find((x) => x.key === LEER_KEY)?.memberIds?.includes(gast.deviceId), "zweiter Beitritt");
  // Beide haben den Titel im Player - nur so gehoeren beide zur Schranke, und
  // nur dann ist der leere Raum danach wirklich leer.
  for (const geraet of [wieder, gast]) {
    geraet.senden({
      type: "here", key: LEER_KEY, position: 0, paused: true, season: 1, episode: 1,
      playerSessionId: `${geraet.deviceId}-leer`
    });
  }
  await gast.erwarte((m) => m.type === "watchstate" && m.key === LEER_KEY
    && m.members?.length === 2, "beide Playerstaende im zweiten Titel");
  gast.senden({ type: "control", key: LEER_KEY, action: "navigate", position: 0, url: URL2 });
  const [leerVorHost, leerVorGast] = await Promise.all([
    wieder.erwarte((m) => m.type === "syncprepare" && m.key === LEER_KEY, "leere Host-Vorbereitung"),
    gast.erwarte((m) => m.type === "syncprepare" && m.key === LEER_KEY, "leere Gast-Vorbereitung")
  ]);
  const leerSyncId = leerVorHost?.syncId;
  wieder.schliessen();
  gast.schliessen();
  await schlafen(180);
  const alleinZurueck = client("Allein zurueck", hostSecret);
  await alleinZurueck.verbinden({ accountProof: kontoProof });
  const leerWiederholt = await alleinZurueck.erwarte((m) =>
    m.type === "syncprepare" && m.key === LEER_KEY && m.syncId === leerSyncId,
    "Vorbereitung nach leerem Raum");
  pruefe("Das Relay startet nicht blind, wenn waehrend der Schranke alle fort sind",
    leerVorGast?.syncId === leerSyncId && leerWiederholt?.url === URL2);
  alleinZurueck.senden({ type: "syncready", key: LEER_KEY, syncId: leerSyncId });
  const leerStart = await alleinZurueck.erwarte((m) =>
    m.type === "syncstart" && m.key === LEER_KEY && m.syncId === leerSyncId,
    "Start nach Rueckkehr");
  pruefe("Der erste Wiederanschluss kann die erhaltene Generation fertigstellen",
    leerStart?.url === URL2 && leerStart?.episodeId === "s1e2");
  alleinZurueck.schliessen();

  wieder.schliessen();
  gast.schliessen();
  spion.schliessen();
  zweiterSpion.schliessen();
  boeserName.schliessen();
  dritter.schliessen();
  dritterNeu.schliessen();
  kontoGeraet.schliessen();
  const bestanden = pruefungen.filter(Boolean).length;
  console.log(`${bestanden}/${pruefungen.length} bestanden`);
  process.exit(bestanden === pruefungen.length ? 0 : 1);
})().catch((fehler) => {
  console.error("FAIL", fehler.stack || fehler);
  process.exit(1);
});
