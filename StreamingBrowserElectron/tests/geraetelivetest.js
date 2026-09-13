"use strict";

// Laufende Wiedergabe im eigenen Geraeteverbund, gegen das echte Relay.
// Geprueft werden nicht nur zwei Methoden gegeneinander, sondern Anmeldung,
// verschluesselte Leitung, Anfangsschnappschuss und das Aufraeumen am Socket.

const crypto = require("crypto");
const WS = require("../../sync-server/node_modules/ws");
const schluessel = require("../src/geraete-schluessel");
const { Geraeteabgleich } = require("../src/geraete");
const relayGeraete = require("../../sync-server/geraete");

const PORT = Number(process.env.TESTPORT) || 8799;
const ADRESSE = `ws://127.0.0.1:${PORT}`;
const FRIST = 3500;
const schlafen = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pruefen(bedingung, text) {
  if (!bedingung) throw new Error(text);
}

async function wartenBis(pruefung, text, frist = FRIST) {
  const ende = Date.now() + frist;
  while (Date.now() < ende) {
    if (pruefung()) return;
    await schlafen(20);
  }
  throw new Error(`Zeitueberschreitung: ${text}`);
}

function geheimnis(name) {
  return crypto.createHash("sha256").update(`geraetelive:${name}`).digest("base64url");
}

function nachweis(wert) {
  return crypto.createHmac("sha256", wert)
    .update(`elfix-watchparty-device-v2\0${new URL(ADRESSE).href}`, "utf8")
    .digest("base64url");
}

function geraet(id, kontoSchluessel, optionen = {}) {
  const staende = [];
  const abgleich = new Geraeteabgleich({
    WebSocketKlasse: WS,
    onStatus: (status) => staende.push(status),
    onSpeichern: () => {},
    ...optionen
  });
  abgleich.konfigurieren({
    enabled: true,
    serverUrl: ADRESSE,
    schluessel: kontoSchluessel,
    geraetId: id,
    geraetName: id,
    geraetTyp: id.includes("tv") ? "tv" : "pc",
    geraetGeheimnis: geheimnis(id)
  });
  return { abgleich, staende };
}

function playback(status, id) {
  return status.devices.find((geraet2) => geraet2.id === id)?.playback || null;
}

function roherClient(raum, id) {
  const meldungen = [];
  const socket = new WS(ADRESSE);
  socket.on("message", (roh) => meldungen.push(JSON.parse(String(roh))));
  return new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.once("open", async () => {
      socket.send(JSON.stringify({
        type: "grhello",
        room: raum,
        seit: 0,
        device: { id, name: id, typ: "handy" },
        deviceProof: nachweis(geheimnis(id))
      }));
      try {
        await wartenBis(() => meldungen.some((m) => m.type === "grstate" && m.fertig), `${id} wird angemeldet`);
        resolve({ socket, meldungen });
      } catch (fehler) {
        reject(fehler);
      }
    });
  });
}

(async () => {
  const vollerRaum = "a".repeat(32);
  relayGeraete.zustandSetzen({ [vollerRaum]: {
    at: Date.now(), nr: 0, eintraege: [],
    geraete: Array.from({ length: 100 }, (_, index) => ({
      id: `voll-${index}`, name: `Voll ${index}`, typ: "pc", zuletzt: Date.now()
    }))
  } });
  let verteilt = 0;
  relayGeraete.behandeln({
    nachricht: { type: "grlive", blob: "klein" },
    raumId: vollerRaum,
    geraetId: "nicht-im-roster",
    senden: () => {},
    verteilen: () => { verteilt += 1; }
  });
  pruefen(verteilt === 0,
    "Eine an der Roster-Grenze abgewiesene Kennung konnte Live-Speicher belegen");
  relayGeraete.zuruecksetzen();

  const konto = schluessel.erzeugen();
  const abgeleitet = schluessel.ableiten(konto);

  // Ein spaeter Anfangsschnappschuss darf den Relay-Satz nicht auf eine neue
  // volle Frist verlaengern. Der Client zaehlt die vom Relay genannte
  // Restdauer mit seiner eigenen Uhr herunter.
  const ttlProbe = new Geraeteabgleich({ onStatus: () => {}, liveEmpfangMs: 1000 });
  ttlProbe.geraetId = "ttl-eigen";
  ttlProbe.abgeleitet = abgeleitet;
  ttlProbe.geraete = [{ id: "ttl-fremd", name: "TTL", typ: "tv", lastSeen: Date.now(), online: true }];
  const ttlBlob = schluessel.verschluesseln(abgeleitet, { playback: {
    title: "Fast veraltet", url: "https://example.invalid/ttl", paused: true
  } });
  ttlProbe.liveUebernehmen({ id: "ttl-fremd", blob: ttlBlob, ttl: 80 });
  pruefen(playback(ttlProbe.status(), "ttl-fremd")?.title === "Fast veraltet",
    "Der Live-Schnappschuss wurde nicht angenommen");
  await schlafen(130);
  pruefen(!playback(ttlProbe.status(), "ttl-fremd"),
    "Ein spaeter Schnappschuss bekam faelschlich eine neue volle Frist");

  const pc = geraet("live-pc", konto);
  const tv = geraet("live-tv", konto);
  const roh = await roherClient(abgeleitet.raum, "live-angreifer");
  const alle = [pc.abgleich, tv.abgleich];

  try {
    await wartenBis(() => pc.abgleich.status().devices.length >= 3
      && tv.abgleich.status().devices.length >= 3, "alle eigenen Geraete erscheinen");

    const stand = {
      title: "Wise Man's Grandchild",
      url: "https://aniworld.to/anime/stream/wise-mans-grandchild/staffel-1/episode-3",
      season: 1,
      episode: 3,
      position: 51,
      duration: 1400,
      paused: false
    };
    pc.abgleich.liveSetzen(stand);
    await wartenBis(() => playback(tv.abgleich.status(), "live-pc")?.episode === 3,
      "der Fernseher sieht die laufende Folge");
    pruefen(playback(tv.abgleich.status(), "live-pc").title === "Wise Man's Grandchild",
      "Titel oder Folge kamen beim anderen Geraet nicht an");

    const leitungsMeldung = await (async () => {
      await wartenBis(() => roh.meldungen.some((m) => m.type === "grlive" && m.id === "live-pc"),
        "der rohe Beobachter empfaengt den Live-Satz");
      return roh.meldungen.find((m) => m.type === "grlive" && m.id === "live-pc");
    })();
    pruefen(Boolean(leitungsMeldung.blob)
      && !JSON.stringify(leitungsMeldung).includes("Wise Man")
      && !JSON.stringify(leitungsMeldung).includes("aniworld"),
    "Der Relay sah Klartext der laufenden Wiedergabe");

    const handy = geraet("live-handy", konto);
    alle.push(handy.abgleich);
    await wartenBis(() => playback(handy.abgleich.status(), "live-pc")?.position === 51,
      "ein spaeteres Geraet bekommt den frischen Anfangsschnappschuss");
    handy.abgleich.aktiv = false;
    handy.abgleich.socket.terminate();
    await wartenBis(() => !handy.abgleich.status().connected, "Empfaenger verliert seine Leitung");
    pruefen(!playback(handy.abgleich.status(), "live-pc"),
      "Ein getrennter Empfaenger zeigte fremde Wiedergabe bis zum TTL weiter");

    pc.abgleich.liveSetzen(null);
    await wartenBis(() => !playback(tv.abgleich.status(), "live-pc"),
      "explizites Playerende verschwindet sofort");

    // Eine behauptete Zielkennung ist wirkungslos. Der Relay bindet den Satz
    // an die beim Hello nachgewiesene Socket-Identitaet.
    const falsch = schluessel.verschluesseln(abgeleitet, { playback: {
      title: "Manipuliert", url: "https://example.invalid/falsch", season: 9,
      episode: 9, position: 9, duration: 99, paused: true
    } });
    roh.socket.send(JSON.stringify({ type: "grlive", id: "live-pc", blob: falsch }));
    await wartenBis(() => playback(tv.abgleich.status(), "live-angreifer")?.title === "Manipuliert",
      "der Satz wird seiner echten Socket-Identitaet zugeordnet");
    pruefen(!playback(tv.abgleich.status(), "live-pc"),
      "Eine behauptete Kennung konnte den Live-Stand eines anderen Geraets schreiben");
    roh.socket.send(JSON.stringify({
      type: "grhello", room: "b".repeat(32), seit: 0,
      device: { id: "live-angreifer", name: "live-angreifer", typ: "handy" },
      deviceProof: nachweis(geheimnis("live-angreifer"))
    }));
    await wartenBis(() => !playback(tv.abgleich.status(), "live-angreifer"),
      "ein Raumwechsel am selben Socket raeumt den alten Live-Stand auf");

    const abbau = geraet("live-abbau", konto);
    alle.push(abbau.abgleich);
    await wartenBis(() => tv.abgleich.status().devices.some((g) => g.id === "live-abbau"),
      "Geraet fuer expliziten Abbau wird angemeldet");
    abbau.abgleich.liveSetzen({ ...stand, title: "Nur vor dem Abbau" });
    await wartenBis(() => playback(tv.abgleich.status(), "live-abbau")?.title === "Nur vor dem Abbau",
      "Stand vor explizitem Abbau erscheint");
    abbau.abgleich.trennen();
    await wartenBis(() => !playback(tv.abgleich.status(), "live-abbau"),
      "expliziter Abbau loescht den Live-Stand");
    abbau.abgleich.konfigurieren({ enabled: true, serverUrl: ADRESSE, schluessel: konto,
      geraetId: "live-abbau", geraetName: "live-abbau", geraetTyp: "pc",
      geraetGeheimnis: geheimnis("live-abbau") });
    await wartenBis(() => abbau.abgleich.status().connected, "Geraet wird rasch wieder eingeschaltet");
    await schlafen(250);
    pruefen(!playback(tv.abgleich.status(), "live-abbau"),
      "Explizit beendete Wiedergabe wurde beim raschen Einschalten erneut gesendet");

    pc.abgleich.liveSetzen({ ...stand, paused: true, position: 80 });
    await wartenBis(() => playback(tv.abgleich.status(), "live-pc")?.position === 80,
      "Live-Stand ist vor dem Leitungsabbruch sichtbar");
    pc.abgleich.aktiv = false;
    pc.abgleich.socket.terminate();
    await wartenBis(() => !playback(tv.abgleich.status(), "live-pc"),
      "ein harter Leitungsabbruch raeumt Live sofort auf");

    const kurz = geraet("live-kurz", konto, { liveProduzentMs: 280, livePulsMs: 50 });
    alle.push(kurz.abgleich);
    await wartenBis(() => tv.abgleich.status().devices.some((g) => g.id === "live-kurz"),
      "kurzlebiger Produzent wird angemeldet");
    kurz.abgleich.liveSetzen({ ...stand, title: "Haengender Player" });
    await wartenBis(() => playback(tv.abgleich.status(), "live-kurz")?.title === "Haengender Player",
      "kurzlebiger Produzent erscheint");
    await wartenBis(() => !playback(tv.abgleich.status(), "live-kurz"),
      "fehlende Player-Messwerte beenden auch bei offener Leitung den Live-Stand", 1800);

    console.log("OK  verschluesselte Live-Wiedergabe folgt dem echten Geraete-Relay und endet verlaesslich");
  } finally {
    for (const eintrag of alle) eintrag.trennen();
    if (roh.socket.readyState !== WS.CLOSED) roh.socket.close();
  }
})().catch((fehler) => {
  console.error("FAIL", fehler?.stack || fehler);
  process.exitCode = 1;
});
