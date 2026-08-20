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

// Die Startsekunde, die in einer Adresse steht.
//
// YouTube schreibt sie als "t" und laesst dabei mehrere Schreibweisen zu: "90",
// "90s", "1m30s", "1h2m3s". Wer nur parseInt darauf wirft, liest aus "1m30s"
// eine Sekunde. Fuer die Watchparty zaehlt das: wird ein Video mit Startzeit
// geoeffnet, ist genau diese Sekunde die Stelle, an der die Runde einsteigt.
function startSekunde(url) {
  if (!istYoutubeUrl(url)) return 0;
  let adresse;
  try {
    adresse = new URL(String(url));
  } catch {
    return 0;
  }
  const roh = String(adresse.searchParams.get("t") || adresse.searchParams.get("start") || "").trim();
  if (!roh) return 0;
  if (/^\d+(\.\d+)?$/.test(roh)) return Math.max(0, Math.floor(Number(roh)));

  const treffer = roh.toLowerCase().match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!treffer || !treffer.slice(1).some(Boolean)) return 0;
  const stunden = Number(treffer[1] || 0);
  const minuten = Number(treffer[2] || 0);
  const sekunden = Number(treffer[3] || 0);
  return stunden * 3600 + minuten * 60 + sekunden;
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

// Vollbild bei YouTube.
//
// Der allgemeine Weg von ELFIX endet hier im Falschen. Er sucht erst einen
// Vollbild-Knopf und faellt, wenn der nichts bewirkt, auf einen Notfall
// zurueck: "nimm das groesste iframe der Seite und zieh es ins Vollbild".
//
// Auf einer YouTube-Seite ist das groesste iframe nachgemessen dieses:
//
//   https://accounts.google.com/ServiceLogin?service=youtube&...   (0 x 0)
//
// Ein unsichtbarer Anmelde-Rahmen. Der ging ins Vollbild, der Player nicht -
// und weil ELFIX daraufhin sein Fenster auf Vollbild stellt, sah es aus, als
// waere "alles" im Vollbild statt des Players. Genau das war zu sehen.
//
// Der Knopf davor hilft nicht weiter: requestFullscreen() verlangt eine echte
// Nutzergeste, und ein nachgebauter Klick bringt keine mit. YouTube ruft ihn
// also auf und wird abgewiesen.
//
// Hier wird deshalb direkt das Richtige angesprochen: "#movie_player" ist
// YouTubes eigener Player-Container, und ELFIX fuehrt sein Skript mit echter
// Nutzergeste aus. YouTube hoert auf "fullscreenchange" und stellt seine
// Bedienung selbst auf Vollbild um - es sieht also genauso aus, als haette man
// den Knopf gedrueckt.
//
// Das Hauptdokument und der Koerper der Seite werden nie angefasst. Ueber sie
// kaeme genau der Zustand zustande, der hier abgestellt wird.
function vollbildScript(ueberKnopf = false) {
  if (ueberKnopf) {
    return `(() => {
  if (document.fullscreenElement) return "yt-vollbild-schon-aktiv";
  const knopf = document.querySelector(".ytp-fullscreen-button");
  if (!knopf) return "yt-kein-knopf";
  const r = knopf.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return "yt-knopf-verdeckt";
  const o = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
  try {
    knopf.dispatchEvent(new PointerEvent("pointerdown", o));
    knopf.dispatchEvent(new MouseEvent("mousedown", o));
    knopf.dispatchEvent(new PointerEvent("pointerup", o));
    knopf.dispatchEvent(new MouseEvent("mouseup", o));
    knopf.dispatchEvent(new MouseEvent("click", o));
    if (typeof knopf.click === "function") knopf.click();
  } catch (fehler) {
    return "yt-knopf-fehler:" + String(fehler && fehler.message).slice(0, 50);
  }
  return "yt-vollbild-knopf-geklickt";
})()`;
  }

  return `(() => {
  if (document.fullscreenElement) return "yt-vollbild-schon-aktiv";
  // Nur YouTubes Player - ausdruecklich nicht documentElement oder body.
  const player = document.querySelector("#movie_player") || document.querySelector(".html5-video-player");
  if (!player || typeof player.requestFullscreen !== "function") return "yt-kein-player";
  try {
    const ergebnis = player.requestFullscreen();
    if (ergebnis && typeof ergebnis.then === "function") {
      return ergebnis
        .then(() => "yt-vollbild-player")
        .catch((fehler) => "yt-vollbild-abgelehnt:" + String((fehler && fehler.message) || fehler).slice(0, 60));
    }
    return "yt-vollbild-player";
  } catch (fehler) {
    return "yt-vollbild-abgelehnt:" + String((fehler && fehler.message) || fehler).slice(0, 60);
  }
})()`;
}

// Beste Qualitaet, keine Untertitel.
//
// Beides stellt YouTube selbst her, sobald es darf: die Qualitaet faellt auf
// "Auto" zurueck, und Untertitel kommen wieder, wenn sie im Konto voreingestellt
// sind. Deshalb setzt ELFIX es aktiv - aber nur einmal je Video.
//
// Das "nur einmal" ist der ganze Punkt. Ein Skript, das dauernd nachstellt,
// waere kein Standard, sondern eine Sperre: wer Untertitel fuer eine Szene
// einschaltet oder bei schlechter Leitung heruntergeht, saehe seine Wahl sofort
// wieder ueberschrieben. Gesetzt wird also beim Ankommen auf einem Video, und
// danach gehoert der Player wieder dir.
//
// Der Beobachter haengt an "yt-navigate-finish": YouTube wechselt das Video
// ohne Neuladen, ein Klick auf eine Empfehlung wuerde sonst nichts ausloesen.
// Beim Wechsel kann der Player noch die alte Videokennung tragen und die Liste
// der Qualitaetsstufen noch leer sein - darum die paar Anlaeufe.
function wiedergabeScript() {
  return `(() => {
  if (window.__elfixYtPrefs) { window.__elfixYtPrefs(); return "yt-prefs-schon-da"; }

  const erledigt = new Set();

  function spieler() {
    const p = document.querySelector("#movie_player") || document.querySelector(".html5-video-player");
    return p && typeof p.getAvailableQualityLevels === "function" ? p : null;
  }

  function kennung() {
    try {
      const p = spieler();
      const daten = p && typeof p.getVideoData === "function" ? p.getVideoData() : null;
      if (daten && daten.video_id) return String(daten.video_id);
    } catch (_) {}
    try { return new URL(location.href).searchParams.get("v") || ""; } catch (_) { return ""; }
  }

  // Die Liste kommt von YouTube bereits nach Guete sortiert, beste zuerst.
  // "auto" steht als Wort mit darin und waere das Gegenteil dessen, was hier
  // gewollt ist - es faellt raus.
  function beste(stufen) {
    return (stufen || []).find((stufe) => stufe && stufe !== "auto" && stufe !== "unknown") || "";
  }

  function setzen() {
    const p = spieler();
    if (!p) return false;
    const id = kennung();
    if (!id || erledigt.has(id)) return Boolean(id);

    let stufen = [];
    try { stufen = p.getAvailableQualityLevels() || []; } catch (_) {}
    const ziel = beste(stufen);
    if (!ziel) return false;

    try {
      if (typeof p.setPlaybackQualityRange === "function") p.setPlaybackQualityRange(ziel, ziel);
      if (typeof p.setPlaybackQuality === "function") p.setPlaybackQuality(ziel);
    } catch (_) {}

    // Untertitel heissen im Player je nach Alter des Bausteins "captions" oder
    // "cc". Beides zu versuchen kostet nichts; was es nicht gibt, wirft.
    try { if (typeof p.unloadModule === "function") p.unloadModule("captions"); } catch (_) {}
    try { if (typeof p.unloadModule === "function") p.unloadModule("cc"); } catch (_) {}
    try { if (typeof p.setOption === "function") p.setOption("captions", "track", {}); } catch (_) {}

    erledigt.add(id);
    return true;
  }

  // Nachsehen, bis es einmal geklappt hat - dann sofort aufhoeren.
  //
  // Eine feste Leiter aus ein paar Anlaeufen war zu wenig: steht der Player
  // erst nach ihrem letzten Sprosse da, wird er nie bedient, und genau das
  // passiert bei einem langsamen Start oder einer Seite, die im Hintergrund
  // laedt. Der Takt haelt durch, bis ein Player mit einer Stufenliste da ist.
  //
  // Er haelt aber auch an. Ohne Grenze liefe er auf jeder Seite ohne Player
  // ewig weiter, und ohne das Aufhoeren nach dem ersten Erfolg waere aus der
  // Vorgabe eine Sperre geworden.
  const TAKT_MS = 500;
  const GRENZE = 40;
  let takt = null;
  let versuche = 0;

  function anhalten() {
    if (takt !== null) clearInterval(takt);
    takt = null;
  }

  function anlauf() {
    versuche += 1;
    let fertig = false;
    try { fertig = setzen(); } catch (_) {}
    if (!fertig && versuche < GRENZE) return false;
    anhalten();
    return true;
  }

  function versuchen() {
    // Ein Videowechsel gibt dem Takt sein volles Fenster zurueck.
    versuche = 0;
    anhalten();
    // Steht der Player schon, ist es hier vorbei - dann faengt gar kein Takt
    // an zu laufen.
    if (anlauf()) return;
    takt = setInterval(anlauf, TAKT_MS);
  }

  window.__elfixYtPrefs = versuchen;
  window.addEventListener("yt-navigate-finish", versuchen, true);
  versuchen();
  return "yt-prefs-gesetzt";
})()`;
}

// Das Kartenbild.
//
// ELFIX sucht sich das Bild einer Seite sonst zusammen: es bewertet alle
// Bilder im Dokument nach Groesse, Lage und Umgebungstext und nimmt das beste.
// Fuer AniWorld, S.to und Filmo gibt es dazu je einen eigenen Zweig, weil die
// Heuristik dort danebengriff.
//
// Auf YouTube greift sie besonders zuverlaessig daneben. Das groesste und am
// weitesten oben liegende Bild ist nicht das laufende Video - das ist ein
// <video>-Element und gar kein Bild -, sondern die erste Empfehlung in der
// rechten Spalte. Auf der Karte stand deshalb das Vorschaubild eines fremden
// Videos.
//
// Geraten werden muss hier aber gar nichts: YouTube legt das Vorschaubild
// jedes Videos unter einer festen Adresse ab, die sich aus der Videokennung
// ergibt. Die kennt ELFIX bereits.
//
// Zwei Groessen, in dieser Reihenfolge:
//
//   maxresdefault.jpg   1280x720, 16:9 - gibt es aber nicht fuer jedes Video
//   mqdefault.jpg        320x180, 16:9 - gibt es immer
//
// "hqdefault" waere ebenfalls immer da, ist aber 4:3 und haette auf der Karte
// schwarze Balken. Deshalb lieber das kleinere mqdefault im richtigen Format.
function vorschaubildKandidaten(url) {
  const kennung = videoKennung(url);
  if (!kennung) return [];
  return [
    `https://i.ytimg.com/vi/${kennung.id}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${kennung.id}/mqdefault.jpg`
  ];
}

// Gehoert diese Adresse zu YouTubes Bilderdienst? Damit laesst sich erkennen,
// ob an einer Karte noch ein zusammengesuchtes Bild haengt oder schon das
// richtige.
function istVorschaubildUrl(url) {
  const host = hostVon(url);
  return host === "ytimg.com" || host.endsWith(".ytimg.com");
}

// Ein Short.
//
// Die dauern Sekunden und laufen in einer Endlosschleife. In "Weiterschauen"
// haben sie nichts verloren - dort geht es darum, etwas Angefangenes zu Ende
// zu bringen. Ein Short, den man einmal durchgewischt hat, ist kein
// angefangenes Werk, und bei dreissig gewischten Shorts waere die Liste nur
// noch Rauschen.
function istShortsUrl(url) {
  return videoKennung(url)?.kurz === true;
}

module.exports = {
  YOUTUBE_HOSTS,
  MINDEST_SEKUNDEN,
  ENDE_ANTEIL,
  istYoutubeUrl,
  videoKennung,
  normalisiereYoutubeUrl,
  fortsetzenUrl,
  startSekunde,
  brauchtNachsprung,
  vollbildScript,
  wiedergabeScript,
  vorschaubildKandidaten,
  istVorschaubildUrl,
  istShortsUrl
};
