"use strict";

// Die YouTube-Watchparty im Relay - der zweite, bewusst eigene Modus.
//
// Die normale Watchparty dreht sich um einen Titel: jemand stellt eine Serie
// ein, andere treten ihr bei, und ab da laeuft der Fortschritt genau dieser
// Serie zusammen. Ein Wechsel auf etwas anderes beendet das Mitschauen.
//
// Bei YouTube waere das falsch herum gedacht. Dort ist nicht ein Video die
// Runde, sondern die Sitzung: man klickt sich durch Empfehlungen, Suche und
// "Naechstes Video", und genau dieses Weiterklicken sollen alle mitmachen. Ein
// Videowechsel beendet die Runde also nicht - er ist ihr haeufigster Vorgang.
//
// Deshalb liegt hier ein eigener Zustand je Raum, mit eigenen Nachrichten
// (alles mit "yt" davor) und eigener Ordnung. Mit der Titelverwaltung des
// Relays teilt er sich nur die Verbindung, den Raumcode und die Geraetekennung.
// Kein Aufruf von hier fasst raeume/titel an, und kein Zweig dort kennt diesen
// Zustand - eine Aenderung am einen kann das andere nicht mitnehmen.
//
// Es gibt keinen Host. Jedes Mitglied darf steuern; massgeblich ist, was hier
// zuletzt angenommen wurde. Jede Annahme erhoeht "rev", und jede Nachricht
// nach draussen traegt sie mit - damit kann ein Geraet einen Nachzuegler, der
// sich unterwegs ueberholen liess, an der Nummer erkennen und wegwerfen.
//
// Absichtlich fluechtig: der Zustand steht nur im Speicher. Position und
// Zeitstempel eines Videos von vorgestern waeren nach einem Neustart wertlos,
// und die Geraete melden sich nach jedem Verbindungsaufbau ohnehin neu an.

const AKTIONEN = ["video", "play", "pause", "seek"];
// YouTube-Kennungen sind elf Zeichen aus einem festen Vorrat. Etwas Luft nach
// oben, aber nichts, was als Pfad, Skript oder Adresse durchgehen koennte.
const VIDEO_ID = /^[A-Za-z0-9_-]{6,24}$/;
const MAX_MITGLIEDER = 50;
// Eine Hochrechnung ueber diese Spanne hinaus ist keine Antwort mehr, sondern
// geraten: dann stand die Runde offenbar laenger still, als ein Video dauert.
const HOCHRECHNUNG_DECKEL_S = 6 * 60 * 60;
// Raeume ohne Mitglieder verschwinden nach dieser Zeit von selbst.
const RAUM_LEBENSDAUER_MS = 12 * 60 * 60 * 1000;

// raumcode -> zustand
const raeume = new Map();

function raumHolen(code) {
  const vorhanden = raeume.get(code);
  if (vorhanden) {
    vorhanden.at = Date.now();
    return vorhanden;
  }
  const neu = {
    videoId: "",
    url: "",
    title: "",
    position: 0,
    playing: false,
    // Wann dieser Stand gesetzt wurde - Serverzeit, nie die eines Geraets.
    updatedAt: 0,
    rev: 0,
    byId: "",
    byName: "",
    members: new Map(),
    at: Date.now()
  };
  raeume.set(code, neu);
  return neu;
}

function text(wert, laenge) {
  return String(wert == null ? "" : wert).slice(0, laenge).trim();
}

function zahl(wert, max) {
  const n = Number(wert);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}

// Nur richtige Videoadressen kommen durch. Alles andere - fremde Hosts,
// javascript:, data: - faellt hier heraus und wird nie weitergereicht.
function videoAdresse(wert, videoId) {
  const roh = text(wert, 400);
  if (roh) {
    try {
      const adresse = new URL(roh);
      const host = adresse.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
      const erlaubt = host === "youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com";
      if ((adresse.protocol === "https:" || adresse.protocol === "http:") && erlaubt) return adresse.href;
    } catch {
      // Unbrauchbar - dann wird sie unten aus der Kennung gebaut.
    }
  }
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : "";
}

// Wo steht die Runde jetzt? Bei laufender Wiedergabe zaehlt die Zeit seit der
// letzten Zustandsaenderung mit - genau der Fall aus der Aufgabe: 50 Sekunden,
// gespeichert vor vier Sekunden, ergibt 54.
function positionJetzt(zustand, jetzt = Date.now()) {
  const basis = Number(zustand && zustand.position) || 0;
  if (!zustand || !zustand.playing || !zustand.updatedAt) return basis;
  const vergangen = (jetzt - zustand.updatedAt) / 1000;
  if (!Number.isFinite(vergangen) || vergangen <= 0) return basis;
  return basis + Math.min(vergangen, HOCHRECHNUNG_DECKEL_S);
}

// Der Zustand, wie ihn ein Geraet bekommt.
//
// Mitgeschickt wird bewusst beides: die gespeicherte Stelle samt Zeitstempel
// UND die daraus hochgerechnete. Wer seinen Uhrversatz zum Relay gemessen hat,
// rechnet selbst und trifft genauer; wer das nicht kann, nimmt "livePosition"
// und liegt um die Laufzeit der Nachricht daneben statt um die Differenz
// zweier Systemuhren.
function nachAussen(code, zustand, zusatz = {}) {
  const jetzt = Date.now();
  return {
    type: "ytstate",
    room: code,
    videoId: zustand.videoId,
    url: zustand.url,
    title: zustand.title,
    position: Number(Number(zustand.position || 0).toFixed(3)),
    livePosition: Number(positionJetzt(zustand, jetzt).toFixed(3)),
    playing: Boolean(zustand.playing),
    updatedAt: zustand.updatedAt,
    serverNow: jetzt,
    rev: zustand.rev,
    byId: zustand.byId,
    byName: zustand.byName,
    members: [...zustand.members.entries()].map(([id, eintrag]) => ({ id, name: eintrag.name })),
    ...zusatz
  };
}

function mitgliedIds(zustand) {
  return new Set(zustand.members.keys());
}

// Eine Nachricht aus dem Netz wird zum neuen Zustand des Raums - oder nicht.
//
// Abgewiesen wird alles, was nicht zur laufenden Runde gehoert. Der wichtigste
// Fall ist der Nachzuegler: Wer bei Video X pausiert, waehrend die Runde
// laengst bei Y steht, darf Y nicht anhalten. Deshalb nennt jede Aktion ausser
// dem Videowechsel die Kennung des Videos, auf das sie sich bezieht.
function ereignisAnwenden(zustand, nachricht, geraetId, name) {
  const aktion = text(nachricht && nachricht.action, 10);
  if (!AKTIONEN.includes(aktion)) return null;

  const videoId = text(nachricht.videoId, 24);
  if (videoId && !VIDEO_ID.test(videoId)) return null;

  if (aktion === "video") {
    if (!videoId) return null;
    // Dieselbe Kennung noch einmal ist kein Wechsel. Das ist zugleich die
    // Bremse gegen die Schleife: wer gerade erst auf Y gezogen wurde, meldet
    // beim Ankommen Y - und genau das darf die Runde nicht erneut bewegen.
    if (videoId === zustand.videoId) return null;
    zustand.videoId = videoId;
    zustand.url = videoAdresse(nachricht.url, videoId);
    zustand.title = text(nachricht.title, 200);
    zustand.position = zahl(nachricht.position, 100000);
    // Ein neues Video laeuft an, sofern der Absender nichts anderes sagt.
    zustand.playing = nachricht.playing !== false;
  } else {
    // Ohne laufendes Video gibt es nichts zu steuern.
    if (!zustand.videoId) return null;
    if (videoId && videoId !== zustand.videoId) return null;
    zustand.position = zahl(nachricht.position, 100000);
    if (aktion === "play") zustand.playing = true;
    if (aktion === "pause") zustand.playing = false;
    // Ein Sprung sagt fuer sich genommen nichts darueber, ob gespielt wird -
    // der Player laeuft danach so weiter, wie er vorher stand. "playing" darf
    // trotzdem mitkommen, weil YouTube beim Spulen gelegentlich anhaelt.
    if (aktion === "seek" && typeof nachricht.playing === "boolean") {
      zustand.playing = nachricht.playing;
    }
    if (nachricht.title) zustand.title = text(nachricht.title, 200);
  }

  zustand.updatedAt = Date.now();
  zustand.rev += 1;
  zustand.byId = geraetId;
  zustand.byName = name;
  return aktion;
}

// Der Einstieg fuer server.js. Rueckgabe false heisst "nicht meine Nachricht" -
// dann laeuft die normale Behandlung unveraendert weiter.
//
// `senden` geht an den Absender, `verteilen(nachricht, ids)` an alle
// Verbindungen des Raums, deren Geraetekennung in `ids` steht.
function behandeln({ nachricht, raumcode, geraetId, name, senden, verteilen }) {
  const art = String((nachricht && nachricht.type) || "");
  if (!art.startsWith("yt")) return false;
  if (!raumcode || !geraetId) return true;

  const zustand = raumHolen(raumcode);

  if (art === "ytjoin") {
    if (!zustand.members.has(geraetId) && zustand.members.size >= MAX_MITGLIEDER) {
      senden({ type: "yterror", room: raumcode, message: "Diese YouTube-Runde ist voll" });
      return true;
    }
    zustand.members.set(geraetId, { name: text(name, 40) || "Gerät", at: Date.now() });
    // Alle bekommen den Stand: die Mitgliederliste hat sich fuer jeden
    // geaendert, und der Neue braucht ohnehin das ganze Bild.
    verteilen(nachAussen(raumcode, zustand, { reason: "join" }), mitgliedIds(zustand));
    return true;
  }

  if (art === "ytleave") {
    if (!zustand.members.delete(geraetId)) return true;
    // Der Aussteigende bekommt die Nachricht noch mit - sonst zeigt seine
    // Oberflaeche die Runde weiter an, aus der er gerade herausgegangen ist.
    const ids = mitgliedIds(zustand);
    ids.add(geraetId);
    verteilen(nachAussen(raumcode, zustand, { reason: "leave" }), ids);
    return true;
  }

  // Nach einem Verbindungsabriss: der ganze Stand noch einmal, nur an den, der
  // fragt. Nichts wird dabei nachgereicht, was dieses Geraet in der Zwischen-
  // zeit getan hat - alte Ereignisse sind vorbei.
  if (art === "ytsync") {
    zustand.members.set(geraetId, { name: text(name, 40) || "Gerät", at: Date.now() });
    senden(nachAussen(raumcode, zustand, { reason: "resync" }));
    return true;
  }

  if (art === "ytevent") {
    if (!zustand.members.has(geraetId)) return true;
    const aktion = ereignisAnwenden(zustand, nachricht, geraetId, text(name, 40) || "Gerät");
    if (!aktion) return true;
    // Auch der Absender bekommt die Nachricht zurueck. Er hat die Tat lokal
    // schon vollzogen und wendet sie nicht erneut an - aber er erfaehrt so die
    // Nummer, unter der sie angenommen wurde, und weist damit spaeter
    // ueberholte Nachrichten ab.
    verteilen(nachAussen(raumcode, zustand, { type: "ytevent", action: aktion }), mitgliedIds(zustand));
    return true;
  }

  return true;
}

// Eine Verbindung ist weg. Wer nur kurz herausfaellt, meldet sich beim
// naechsten Aufbau mit "ytjoin" von selbst wieder an.
function abmelden({ raumcode, geraetId, verteilen }) {
  if (!raumcode || !geraetId) return;
  const zustand = raeume.get(raumcode);
  if (!zustand || !zustand.members.delete(geraetId)) return;
  verteilen(nachAussen(raumcode, zustand, { reason: "left" }), mitgliedIds(zustand));
}

function aufraeumen(jetzt = Date.now()) {
  for (const [code, zustand] of raeume) {
    if (zustand.members.size === 0 && jetzt - zustand.at > RAUM_LEBENSDAUER_MS) raeume.delete(code);
  }
}

// Nur fuer Pruefungen und /health.
function zustandLesen(code) {
  const zustand = raeume.get(code);
  return zustand ? nachAussen(code, zustand) : null;
}

function anzahl() {
  return raeume.size;
}

function zuruecksetzen() {
  raeume.clear();
}

module.exports = {
  AKTIONEN,
  VIDEO_ID,
  positionJetzt,
  videoAdresse,
  ereignisAnwenden,
  behandeln,
  abmelden,
  aufraeumen,
  zustandLesen,
  anzahl,
  zuruecksetzen
};
