"use strict";

// Meine Geraete - der Abgleich zwischen den Geraeten einer Person.
//
// Die Watchparty verbindet Menschen: jemand stellt eine Serie ein, andere
// treten bei, und ab da laeuft der Fortschritt dieser Serie zusammen. Hier ist
// niemand einzuladen und nichts beizutreten. Wer denselben Schluessel traegt,
// ist dasselbe Konto - nur ohne Konto. Laptop und Rechner sollen einfach
// denselben Stand haben, ohne dass jemand etwas "teilt".
//
// Deshalb ein eigener Modus mit eigenem Zustand und eigenen Nachrichten (alles
// mit "gr" davor). Mit der Titelverwaltung teilt er sich nur die Verbindung.
// Kein Aufruf von hier fasst raeume/titel an.
//
// Das Wichtigste an diesem Modul ist, was es nicht weiss. Es sieht:
//
//   - eine Raumkennung: 32 Hexzeichen, aus dem Schluessel abgeleitet. Der
//     Schluessel selbst kommt nie hier an, und aus der Kennung folgt er nicht.
//   - je Eintrag eine Kennung: ein HMAC ueber den Titelschluessel, ebenfalls
//     mit dem Geheimnis gebildet. "serie:one-piece" laesst sich daraus nicht
//     zurueckrechnen.
//   - einen verschlossenen Klumpen: AES-256-GCM, der Schluessel dazu liegt auf
//     den Geraeten.
//
// Was jemand schaut, steht damit nirgends auf der Platte des Relays - anders
// als bei der Watchparty, wo die Runde die Titel kennen muss, um sie
// anzuzeigen. Hier muss sie das nicht: es liest ohnehin nur der Besitzer.
// Sichtbar bleibt, wie viele Eintraege es gibt und wann sie sich aendern.
//
// Anders als die YouTube-Runde liegt das hier auf der Platte. Der ganze Zweck
// ist ja, dass ein Geraet, das eine Woche aus war, den Stand nachgereicht
// bekommt - ein fluechtiger Zustand koennte genau das nicht.

// Mehr Titel hat niemand offen; wer daran stoesst, hat einen Fehler im Client.
const MAX_EINTRAEGE_JE_RAUM = 2000;
// Ein Eintrag mit fuenfhundert abgehakten Folgen ist gross. Doppelt so viel
// waere kein Eintrag mehr, sondern ein Versehen.
const MAX_BLOB = 128 * 1024;
const MAX_JE_NACHRICHT = 200;
// So viel geht hoechstens in einer Nachricht hinaus. Die Verbindung nimmt 256
// KiB - ein einzelner grosser Eintrag darf den Rahmen sprengen, zwei nicht.
const MAX_JE_SCHUB = 100 * 1024;
// Beides sind Ableitungen fester Laenge - was anders aussieht, kommt nicht von
// einem ELFIX.
const KENNUNG = /^[0-9a-f]{32}$/;
// Geloeschtes bleibt als Grabstein liegen, sonst holt ein Geraet, das lange aus
// war, den Eintrag beim naechsten Abgleich zurueck.
const GRAB_LEBENSDAUER_MS = 30 * 24 * 60 * 60 * 1000;
// Ein halbes Jahr ohne ein einziges Geraet: dann gibt es diesen Schluessel
// nicht mehr.
const RAUM_LEBENSDAUER_MS = 180 * 24 * 60 * 60 * 1000;
// Die Geraete rechnen ihre Zeitstempel auf die Uhr des Relays um. Bleibt trotz
// allem etwas in der Zukunft, wird es hier gekappt - sonst gewaenne ein Geraet
// mit falsch gestellter Uhr jeden Vergleich, fuer immer.
const ZUKUNFT_TOLERANZ_MS = 5 * 60 * 1000;

// raumId -> { eintraege: Map<id, {at, nr, blob, weg}>, nr, at }
const raeume = new Map();

function raumHolen(raumId) {
  const vorhanden = raeume.get(raumId);
  if (vorhanden) {
    vorhanden.at = Date.now();
    return vorhanden;
  }
  const neu = { eintraege: new Map(), nr: 0, at: Date.now() };
  raeume.set(raumId, neu);
  return neu;
}

function istKennung(wert) {
  return typeof wert === "string" && KENNUNG.test(wert);
}

function zahl(wert) {
  const n = Number(wert);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Alles, was dieses Geraet noch nicht kennt - der Reihe nach, wie es angenommen
// wurde. Die laufende Nummer vergibt das Relay: sie ist das Einzige an diesem
// Abgleich, das sich verlaesslich ordnen laesst. Die Zeitstempel kommen von den
// Geraeten und entscheiden, wer gewinnt; welcher Eintrag noch fehlt, sagen sie
// nicht - ein Geraet, das eine Woche aus war, aendert etwas mit einem alten
// Zeitstempel, und das darf trotzdem nicht verlorengehen.
function nachschub(raumId, seit) {
  const raum = raeume.get(raumId);
  if (!raum) return { eintraege: [], nr: 0 };
  const ab = zahl(seit);
  const eintraege = [...raum.eintraege.entries()]
    .filter(([, eintrag]) => eintrag.nr > ab)
    .sort((links, rechts) => links[1].nr - rechts[1].nr)
    .map(([id, eintrag]) => ({ id, at: eintrag.at, nr: eintrag.nr, blob: eintrag.blob || "", weg: Boolean(eintrag.weg) }));
  return { eintraege, nr: raum.nr };
}

// Ein Eintrag wird angenommen, wenn er neuer ist als der, der schon dasteht.
// Gleichstand zaehlt nicht: sonst schoebe ein Geraet, das denselben Stand noch
// einmal meldet, die Nummer hoch und alle anderen laden ihn erneut.
function annehmen(raum, roh) {
  const id = String(roh?.id || "");
  if (!istKennung(id)) return null;
  const weg = Boolean(roh?.weg);
  const blob = weg ? "" : String(roh?.blob || "");
  if (!weg && (!blob || blob.length > MAX_BLOB)) return null;
  const at = Math.min(zahl(roh?.at) || Date.now(), Date.now() + ZUKUNFT_TOLERANZ_MS);
  if (!at) return null;

  const bekannt = raum.eintraege.get(id);
  if (bekannt && bekannt.at >= at) return null;
  if (!bekannt && raum.eintraege.size >= MAX_EINTRAEGE_JE_RAUM) return null;

  raum.nr += 1;
  const eintrag = { at, nr: raum.nr, blob, weg };
  raum.eintraege.set(id, eintrag);
  return { id, at, nr: eintrag.nr, blob, weg };
}

// Die Nachrichten. `senden` geht an den Absender, `verteilen` an die uebrigen
// Geraete desselben Schluessels - wer das ist, weiss der Server, nicht dieses
// Modul.
//
// Rueckgabe sagt nur, ob sich am gespeicherten Zustand etwas geaendert hat: der
// Server haengt daran sein Sichern.
function behandeln({ nachricht, raumId, senden, verteilen }) {
  if (!istKennung(raumId)) return false;

  if (nachricht.type === "grhello") {
    const { eintraege, nr } = nachschub(raumId, nachricht.seit);
    // In Haeppchen: ein einzelner Eintrag darf gross sein, und die Verbindung
    // nimmt nur 256 KiB je Nachricht. Der letzte Teil traegt "fertig" - daran
    // erkennt das Geraet, dass es alles hat, und schreibt seine Nummer fort.
    let teil = [];
    let umfang = 0;
    for (const eintrag of eintraege) {
      const gross = (eintrag.blob?.length || 0) + 120;
      if (teil.length && (umfang + gross > MAX_JE_SCHUB || teil.length >= MAX_JE_NACHRICHT)) {
        senden({ type: "grstate", eintraege: teil, nr, fertig: false });
        teil = [];
        umfang = 0;
      }
      teil.push(eintrag);
      umfang += gross;
    }
    senden({ type: "grstate", eintraege: teil, nr, fertig: true });
    // Ein Raum, den ein Geraet gerade benutzt, ist nicht verwaist - auch dann
    // nicht, wenn es nichts zu melden gibt.
    if (raeume.has(raumId)) raumHolen(raumId);
    return false;
  }

  if (nachricht.type === "grput") {
    const roh = Array.isArray(nachricht.eintraege) ? nachricht.eintraege.slice(0, MAX_JE_NACHRICHT) : [];
    if (!roh.length) return false;
    const raum = raumHolen(raumId);
    const angenommen = [];
    for (const eintrag of roh) {
      const fertig = annehmen(raum, eintrag);
      if (fertig) angenommen.push(fertig);
    }
    // Die Bestaetigung geht immer heraus, auch wenn nichts angenommen wurde:
    // das Geraet wartet darauf, bevor es seinen naechsten Schub schickt.
    senden({ type: "grack", nr: raum.nr, angenommen: angenommen.map((e) => e.id), abgelehnt: roh.length - angenommen.length });
    if (!angenommen.length) return false;
    verteilen({ type: "grput", eintraege: angenommen, nr: raum.nr });
    return true;
  }

  return false;
}

function aufraeumen() {
  const jetzt = Date.now();
  let geaendert = false;
  for (const [raumId, raum] of raeume) {
    if (raum.at < jetzt - RAUM_LEBENSDAUER_MS) {
      raeume.delete(raumId);
      geaendert = true;
      continue;
    }
    for (const [id, eintrag] of raum.eintraege) {
      if (!eintrag.weg || eintrag.at >= jetzt - GRAB_LEBENSDAUER_MS) continue;
      raum.eintraege.delete(id);
      geaendert = true;
    }
  }
  return geaendert;
}

// Fuer die Ablage des Servers. Maps werden zu Listen - ein Objekt mit
// Kennungen als Feldnamen waere zwar kuerzer, aber ein Eintrag namens
// "__proto__" braucht hier niemand.
function zustandLesen() {
  const roh = {};
  for (const [raumId, raum] of raeume) {
    roh[raumId] = {
      at: raum.at,
      nr: raum.nr,
      eintraege: [...raum.eintraege.entries()].map(([id, eintrag]) => ({
        id, at: eintrag.at, nr: eintrag.nr, blob: eintrag.blob || "", weg: Boolean(eintrag.weg)
      }))
    };
  }
  return roh;
}

function zustandSetzen(roh) {
  raeume.clear();
  for (const [raumId, raum] of Object.entries(roh || {})) {
    if (!istKennung(raumId)) continue;
    const eintraege = new Map();
    let hoechste = 0;
    for (const eintrag of raum?.eintraege || []) {
      if (!istKennung(eintrag?.id)) continue;
      const nr = zahl(eintrag.nr);
      eintraege.set(eintrag.id, {
        at: zahl(eintrag.at),
        nr,
        blob: String(eintrag.blob || ""),
        weg: Boolean(eintrag.weg)
      });
      if (nr > hoechste) hoechste = nr;
    }
    // Die Nummer nie kleiner als die groesste gespeicherte: sonst vergaebe der
    // Server nach einem Neustart Nummern doppelt, und ein Geraet mit hohem
    // Stand bekaeme nie wieder etwas zu sehen.
    raeume.set(raumId, { eintraege, nr: Math.max(zahl(raum?.nr), hoechste), at: zahl(raum?.at) || Date.now() });
  }
}

function anzahl() {
  return raeume.size;
}

function zuruecksetzen() {
  raeume.clear();
}

module.exports = {
  MAX_BLOB,
  MAX_EINTRAEGE_JE_RAUM,
  istKennung,
  nachschub,
  behandeln,
  aufraeumen,
  zustandLesen,
  zustandSetzen,
  anzahl,
  zuruecksetzen
};
