"use strict";

// Doppelte Mitglieder und die verlorene Ersteller-Rolle.
//
// Gemeldet mit einem Bildschirmfoto: "11 dabei", und jeder Name stand zweimal
// darin - und der Ersteller bekam niemanden mehr heraus. Eine Mitgliedschaft
// haengt an der Geraetekennung und ueberlebt Verbindungsabbrueche; das ist
// richtig. Nach einer Neuinstallation bekommt dasselbe Geraet aber eine neue
// Kennung, und die alte blieb fuer immer stehen. Aus demselben Grund zaehlte
// der Ersteller nicht mehr als solcher: `kick` fragte allein nach der
// Geraete-ID, waehrend Karte und Herausnehmen laengst das Konto akzeptierten.

const crypto = require("node:crypto");
const WS = require("../../sync-server/node_modules/ws");

const PORT = Number(process.env.TESTPORT) || 8799;
const ADRESSE = `ws://127.0.0.1:${PORT}`;
const RAUM = "mitglieder-aufraeumen";
const KEY = "serie:aufraeumen";
const URL = "https://aniworld.to/anime/stream/aufraeumen/staffel-1/episode-1";

let bestanden = 0;

const nachweis = (wert) => crypto.createHash("sha256").update(wert).digest("base64url");
const kontoMarke = () => crypto.randomBytes(16).toString("hex");

function client(name, geheimnis, konto) {
  const eingang = [];
  const wartende = [];
  let socket;

  function empfangen(meldung) {
    eingang.push(meldung);
    for (let i = wartende.length - 1; i >= 0; i -= 1) {
      const warte = wartende[i];
      if (eingang.length <= warte.ab || !warte.passt(meldung)) continue;
      clearTimeout(warte.timer);
      wartende.splice(i, 1);
      warte.resolve(meldung);
    }
  }

  return {
    name,
    eingang,
    deviceId: "",
    marke() { return eingang.length; },
    senden(meldung) { socket.send(JSON.stringify(meldung)); },
    warten(ab, passt, was) {
      const vorhanden = eingang.slice(ab).find(passt);
      if (vorhanden) return Promise.resolve(vorhanden);
      return new Promise((resolve, reject) => {
        const warte = { ab, passt, resolve, timer: null };
        warte.timer = setTimeout(() => {
          const index = wartende.indexOf(warte);
          if (index >= 0) wartende.splice(index, 1);
          reject(new Error(`Zeitueberschreitung: ${name} wartet auf ${was}`));
        }, 2500);
        warte.timer.unref?.();
        wartende.push(warte);
      });
    },
    async verbinden() {
      socket = new WS(ADRESSE);
      socket.on("message", (roh) => empfangen(JSON.parse(String(roh))));
      await new Promise((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      const ab = eingang.length;
      this.senden({ type: "join", room: RAUM, name,
        deviceProof: nachweis(geheimnis),
        accountProof: nachweis(`konto:${konto}`) });
      const stand = await this.warten(ab, (m) => m.type === "state" && m.you, "Raumbeitritt");
      this.deviceId = stand.you;
      return stand;
    },
    async schliessenUndWarten() {
      const zu = new Promise((resolve) => socket.once("close", resolve));
      socket.close();
      return zu;
    },
    schliessen() { socket?.close(); }
  };
}

const eintragVon = (meldung) => meldung?.shared?.find((eintrag) => eintrag.key === KEY);

function pruefen(bedingung, text) {
  if (!bedingung) throw new Error(text);
  bestanden += 1;
}

(async () => {
  const konto = kontoMarke();
  // Dasselbe Geraet vor und nach einer Neuinstallation: gleicher Name,
  // gleiches Konto, neuer Besitznachweis - und damit eine neue Kennung.
  const alt = client("Elias TV", "tv-vor-neuinstallation", konto);
  const neu = client("Elias TV", "tv-nach-neuinstallation", konto);
  // Ein zweites echtes Geraet derselben Person. Es heisst anders und muss
  // stehenbleiben.
  const zweites = client("Elias Handy", "handy", konto);
  const fremd = client("David", "david", kontoMarke());
  try {
    await alt.verbinden();
    await zweites.verbinden();
    await fremd.verbinden();

    const geteilt = alt.marke();
    alt.senden({ type: "share", item: { key: KEY, url: URL, title: "Aufraeumen",
      type: "serie", season: 1, episode: 1 } });
    await alt.warten(geteilt, (m) => m.type === "state" && eintragVon(m), "geteilten Titel");

    for (const geraet of [zweites, fremd]) {
      const ab = alt.marke();
      geraet.senden({ type: "enter", key: KEY });
      await alt.warten(ab, (m) => m.type === "state"
        && eintragVon(m)?.memberIds?.includes(geraet.deviceId), `Beitritt von ${geraet.name}`);
    }
    const vorher = await alt.warten(0, (m) => m.type === "state"
      && eintragVon(m)?.memberIds?.length === 3, "drei Mitglieder");
    pruefen(eintragVon(vorher).memberIds.length === 3, "Der Aufbau stimmt nicht");

    // Das alte Geraet verschwindet und kommt als Neuinstallation zurueck.
    await alt.schliessenUndWarten();
    await neu.verbinden();
    pruefen(neu.deviceId !== alt.deviceId, "Die Neuinstallation bekam dieselbe Kennung");

    const ab = neu.marke();
    neu.senden({ type: "enter", key: KEY });
    const danach = await neu.warten(ab, (m) => m.type === "state"
      && eintragVon(m)?.memberIds?.includes(neu.deviceId), "Beitritt nach Neuinstallation");
    const mitglieder = eintragVon(danach);
    pruefen(!mitglieder.memberIds.includes(alt.deviceId),
      `Das Vorgaengergeraet blieb in der Liste: ${JSON.stringify(mitglieder.members)}`);
    pruefen(mitglieder.memberIds.length === 3,
      `Erwartet drei Mitglieder, gezaehlt ${mitglieder.memberIds.length}: ${JSON.stringify(mitglieder.members)}`);
    pruefen(mitglieder.memberIds.includes(zweites.deviceId),
      "Das zweite echte Geraet derselben Person wurde mit weggeraeumt");
    pruefen(mitglieder.memberIds.includes(fremd.deviceId), "Ein fremdes Geraet wurde weggeraeumt");
    pruefen(mitglieder.members.filter((name) => name === "Elias TV").length === 1,
      `Der Name steht weiterhin doppelt: ${JSON.stringify(mitglieder.members)}`);

    // Und der Ersteller ist derselbe geblieben - ueber das Konto, nicht ueber
    // die Kennung, die es nicht mehr gibt.
    pruefen(mitglieder.mine === true, "Die Neuinstallation gilt nicht mehr als Ersteller");

    const vorKick = neu.marke();
    neu.senden({ type: "kick", key: KEY, memberId: fremd.deviceId });
    const nachKick = await neu.warten(vorKick, (m) => m.type === "state"
      && eintragVon(m) && !eintragVon(m).memberIds.includes(fremd.deviceId),
    "Entfernen durch den Ersteller");
    pruefen(eintragVon(nachKick).memberIds.length === 2,
      "Nach dem Entfernen stimmt die Zahl nicht");

    // Wer den Titel nicht eingestellt hat, darf weiterhin niemanden entfernen.
    const vorFremd = neu.marke();
    zweites.senden({ type: "kick", key: KEY, memberId: neu.deviceId });
    zweites.senden({ type: "chat", text: "kick-marke" });
    await zweites.warten(0, (m) => m.type === "chat" && m.text === "kick-marke", "Ordnungsmarkierung");
    pruefen(!neu.eingang.slice(vorFremd).some((m) => m.type === "state"
      && eintragVon(m) && !eintragVon(m).memberIds.includes(neu.deviceId)),
    "Ein Mitglied ohne Besitz konnte den Ersteller entfernen");

    console.log(`${bestanden}/${bestanden} bestanden `
      + "(Mitglieder: Vorgaengergeraet weg, echte Geraete bleiben, Ersteller ueber das Konto)");
  } finally {
    for (const geraet of [alt, neu, zweites, fremd]) geraet.schliessen();
  }
})().catch((fehler) => {
  console.error(`FAIL ${fehler.stack || fehler}`);
  process.exitCode = 1;
});
