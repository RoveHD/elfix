"use strict";

// YouTube und "Weiterschauen".
//
// Bei den Anbietern, fuer die ELFIX gebaut ist, ist eine Folge eine Adresse.
// "Weiterschauen" heisst dort: diese Adresse wieder oeffnen - der Hoster
// erinnert sich meist selbst, wo man war, und mehr braucht es nicht.
//
// YouTube passt in dieses Bild nicht. Ein Video ist eine einzige Adresse und
// kann Stunden lang sein. Wer dort auf "Weiterschauen" drueckt, landet wieder
// bei null, weil ELFIX nur die Adresse geoeffnet und die Sekunde nie
// mitgegeben hat.
//
// Dazu kommt ein zweites, unauffaelligeres Problem. YouTube haengt an
// dieselbe Adresse je nach Herkunft alles Moegliche an:
//
//   https://www.youtube.com/watch?v=ABC
//   https://www.youtube.com/watch?v=ABC&list=PL123&index=4
//   https://www.youtube.com/watch?v=ABC&pp=ygUJdGVzdA%3D%3D
//   https://youtu.be/ABC?si=xyz
//
// Fuer ELFIX waren das vier verschiedene Titel. Jeder bekam seinen eigenen
// Eintrag mit eigenem Stand, und welcher davon in "Weiterschauen" auftauchte,
// war Zufall - oft eben der frische mit null Prozent. Das sah genauso aus wie
// "faengt von vorne an", hatte aber einen ganz anderen Grund.
//
// Beides loest diese Datei, und sie loest es nur fuer YouTube: jede Funktion
// hier prueft zuerst, ob die Adresse ueberhaupt zu YouTube gehoert, und gibt
// sonst unveraendert zurueck, was sie bekommen hat. An AniWorld, S.to, Filmo
// und den Hostern aendert sich dadurch nichts.

const YOUTUBE_HOSTS = [
  "youtube.com",
  "youtu.be",
  "youtube-nocookie.com"
];

// Unter dieser Marke lohnt das Fortsetzen nicht - wer zehn Sekunden gesehen
// hat, faengt lieber vorne an.
const MINDEST_SEKUNDEN = 15;
// So nah am Ende gilt das Video als durch. Dann wieder an die Stelle zu
// springen hiesse, direkt in den Abspann zu starten.
const ENDE_ANTEIL = 0.97;

function hostVon(url) {
  try {
    return new URL(String(url || "")).hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "").replace(/^music\./, "");
  } catch {
    return "";
  }
}

function istYoutubeUrl(url) {
  const host = hostVon(url);
  if (!host) return false;
  return YOUTUBE_HOSTS.some((eintrag) => host === eintrag || host.endsWith(`.${eintrag}`));
}

// Die Kennung des Videos - egal in welcher der vielen Schreibweisen sie kommt.
//
// "kurz" merkt sich, ob es ein Short war. Fuer die zaehlt das Fortsetzen
// nicht: sie dauern Sekunden, und YouTube nimmt dort keine Startzeit an.
function videoKennung(url) {
  if (!istYoutubeUrl(url)) return null;
  let adresse;
  try {
    adresse = new URL(String(url));
  } catch {
    return null;
  }

  const host = hostVon(url);
  const pfad = adresse.pathname.replace(/\/+$/, "");
  const liste = adresse.searchParams.get("list") || "";

  // youtu.be/ABC
  if (host === "youtu.be") {
    const id = pfad.split("/").filter(Boolean)[0] || "";
    return id ? { id, liste, kurz: false } : null;
  }

  // /watch?v=ABC
  const ausParameter = adresse.searchParams.get("v");
  if (pfad === "/watch" && ausParameter) {
    return { id: ausParameter, liste, kurz: false };
  }

  // /shorts/ABC, /embed/ABC, /live/ABC, /v/ABC
  const treffer = pfad.match(/^\/(shorts|embed|live|v)\/([^/]+)/);
  if (treffer) {
    return { id: treffer[2], liste, kurz: treffer[1] === "shorts" };
  }

  return null;
}

// Ein Video, ein Eintrag. Das ist der Schluessel, unter dem ELFIX den Titel
// wiedererkennt - ohne Playlist, ohne Herkunftsverweis, ohne Startzeit.
//
// Gibt "" zurueck, wenn es keine YouTube-Videoadresse ist. Der Aufrufer
// behaelt dann seine eigene Normalisierung.
function normalisiereYoutubeUrl(url) {
  const kennung = videoKennung(url);
  if (!kennung) return "";
  return `https://www.youtube.com/watch?v=${kennung.id}`;
}

// Die Adresse, mit der "Weiterschauen" wirklich weiterschaut.
//
// YouTube kennt dafuer den Parameter "t". Ihn beim Oeffnen mitzugeben ist
// deutlich verlaesslicher, als nach dem Laden im Player herumzuspringen: der
// Player startet dann von sich aus an der richtigen Stelle, ohne dass etwas
// zurueckspult, was der Nutzer sieht.
//
// Die Playlist bleibt erhalten, falls eine dabei war - sonst risse das
// Fortsetzen den Zusammenhang auseinander, in dem das Video lief.
function fortsetzenUrl(url, sekunden, dauer = 0) {
  const kennung = videoKennung(url);
  if (!kennung) return String(url || "");

  const ziel = Math.floor(Number(sekunden) || 0);
  if (kennung.kurz) return kanonisch(kennung, 0);
  if (ziel < MINDEST_SEKUNDEN) return kanonisch(kennung, 0);
  const laenge = Number(dauer) || 0;
  if (laenge > 0 && ziel >= laenge * ENDE_ANTEIL) return kanonisch(kennung, 0);

  return kanonisch(kennung, ziel);
}

function kanonisch(kennung, sekunden) {
  const adresse = new URL("https://www.youtube.com/watch");
  adresse.searchParams.set("v", kennung.id);
  if (kennung.liste) adresse.searchParams.set("list", kennung.liste);
  if (sekunden > 0) adresse.searchParams.set("t", String(sekunden));
  return adresse.href;
}

// Lohnt sich der Nachsprung im Player? Nur, wenn die Adresse ihre Startzeit
// mitbekommen hat und der Player trotzdem woanders steht - YouTube ignoriert
// "t" gelegentlich, etwa wenn es selbst einen Stand gespeichert hat.
function brauchtNachsprung(sekunden, dauer = 0) {
  const ziel = Math.floor(Number(sekunden) || 0);
  if (ziel < MINDEST_SEKUNDEN) return false;
  const laenge = Number(dauer) || 0;
  if (laenge > 0 && ziel >= laenge * ENDE_ANTEIL) return false;
  return true;
}

module.exports = {
  YOUTUBE_HOSTS,
  MINDEST_SEKUNDEN,
  ENDE_ANTEIL,
  istYoutubeUrl,
  videoKennung,
  normalisiereYoutubeUrl,
  fortsetzenUrl,
  brauchtNachsprung
};
