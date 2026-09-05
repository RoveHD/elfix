"use strict";

/*
 * Der eigene Player.
 *
 * Er bekommt eine Adresse und spielt sie. Was er *nicht* tut, ist der Punkt an
 * der Sache: keine Werbeschicht wegraeumen, keine fremde Qualitaetswahl
 * uebersteuern, kein Ueberlagerungsknopf, den erst ein Klick wegnimmt. Das
 * alles gibt es nur, weil bisher ein fremder Player im Rahmen lief.
 *
 * <h2>Was hier gemessen und was gemeldet wird</h2>
 *
 * Gemeldet wird die Stelle - und dazu, wie viele Sekunden davon *wirklich*
 * gelaufen sind. Die Unterscheidung ist dieselbe wie in messung.js: ein Zug am
 * Regler bringt einen ans Ende der Folge, aber er hat sie nicht geschaut.
 * Gezaehlt wird deshalb nur, was zwischen zwei Meldungen des Videos in
 * normaler Geschwindigkeit vergangen ist.
 *
 * <h2>Warum der Fehlerfall einen Knopf hat</h2>
 *
 * Eine Playlist kann ablaufen, ein Auslieferungsserver kann dichtmachen, eine
 * Adresse kann von gestern sein. Dann steht hier nicht "Fehler 3", sondern der
 * Weg zurueck: der Rahmen des Hosters, der bisher immer lief. Der eigene Player
 * ist ein Angebot und keine Einbahnstrasse.
 */

const bruecke = window.elfixSpieler || {
  aufAuftrag() {}, bereit() {}, stand() {}, fehler() {}, schliessen() {}, vollbild() {}
};

const bild = document.getElementById("bild");
const regler = document.getElementById("regler");
const lautstaerke = document.getElementById("lautstaerke");
const stufenWahl = document.getElementById("stufen");
const knopfSpielen = document.getElementById("spielen");
const knopfTon = document.getElementById("ton");
const anzeigeStelle = document.getElementById("stelle");
const anzeigeDauer = document.getElementById("dauer");
const puffer = document.getElementById("puffer");
const fehlerKasten = document.getElementById("fehler");
const fehlerText = document.getElementById("fehlerText");
const schichten = [document.getElementById("kopf"), document.getElementById("leiste")];

/** Der laufende Auftrag - Adresse, Titel, Startzeit. */
let auftrag = null;
/** Die Bibliothek fuer HLS, falls eine gebraucht wird. */
let hls = null;
/** Wirklich gelaufene Sekunden. Siehe oben: nicht dasselbe wie die Stelle. */
let gelaufen = 0;
/** Die Stelle der vorigen Meldung - Grundlage der Zaehlung. */
let vorigeStelle = 0;
/** Ein einziger Rettungsversuch je Sorte Fehler, danach ist es einer. */
const gerettet = { netz: false, medium: false };
let zuletztGemeldet = 0;
let ruheUhr = 0;

/* ------------------------------------------------------------- Kleinigkeiten */

function zeit(sekunden) {
  const wert = Number(sekunden);
  if (!Number.isFinite(wert) || wert < 0) return "0:00";
  const ganz = Math.floor(wert);
  const s = ganz % 60;
  const m = Math.floor(ganz / 60) % 60;
  const h = Math.floor(ganz / 3600);
  const zwei = (zahl) => String(zahl).padStart(2, "0");
  return h > 0 ? `${h}:${zwei(m)}:${zwei(s)}` : `${m}:${zwei(s)}`;
}

function pufferZeigen(an) {
  puffer.hidden = !an || !fehlerKasten.hidden;
}

/**
 * Der Ausweg.
 *
 * Er meldet dem Hauptprozess, was schiefging, und macht zu. Was danach
 * passiert, entscheidet der: bisher ist das der Rahmen des Hosters.
 */
function aufgeben(text, grund) {
  fehlerText.textContent = String(text || "Die Quelle antwortet nicht.");
  fehlerKasten.hidden = false;
  pufferZeigen(false);
  bruecke.fehler(`${grund}: ${text}`);
}

/* ---------------------------------------------------------- Die Bedienung */

function schichtenZeigen() {
  for (const schicht of schichten) schicht.classList.remove("weg");
  clearTimeout(ruheUhr);
  // Waehrend Pause bleibt die Leiste stehen: wer pausiert, will etwas tun.
  ruheUhr = setTimeout(() => {
    if (!bild.paused && fehlerKasten.hidden) {
      for (const schicht of schichten) schicht.classList.add("weg");
    }
  }, 2800);
}

function spielenUmschalten() {
  if (bild.paused) bild.play().catch((fehler) => aufgeben(String(fehler?.message || fehler), "play"));
  else bild.pause();
}

function springen(sekunden) {
  if (!Number.isFinite(bild.duration) || bild.duration <= 0) return;
  bild.currentTime = Math.min(Math.max(0, bild.currentTime + sekunden), bild.duration - 0.5);
  schichtenZeigen();
}

function tonUmschalten() {
  bild.muted = !bild.muted;
  knopfTon.textContent = bild.muted || bild.volume === 0 ? "🔇" : "🔊";
}

document.getElementById("spielen").addEventListener("click", spielenUmschalten);
document.getElementById("zurueck").addEventListener("click", () => springen(-10));
document.getElementById("vor").addEventListener("click", () => springen(10));
document.getElementById("ton").addEventListener("click", tonUmschalten);
document.getElementById("gross").addEventListener("click", () => bruecke.vollbild(true));
document.getElementById("zu").addEventListener("click", () => beenden("knopf"));
document.getElementById("zurueckZumHoster").addEventListener("click", () => beenden("hoster"));
bild.addEventListener("click", spielenUmschalten);

regler.addEventListener("input", () => {
  if (!Number.isFinite(bild.duration) || bild.duration <= 0) return;
  bild.currentTime = (Number(regler.value) / 1000) * bild.duration;
  // Die Zaehlung darf einen Sprung nicht mitzaehlen - sonst waere der Regler
  // eine Abkuerzung zum "geschaut" der ganzen Serie.
  vorigeStelle = bild.currentTime;
});
lautstaerke.addEventListener("input", () => {
  bild.volume = Number(lautstaerke.value) / 100;
  bild.muted = bild.volume === 0;
  knopfTon.textContent = bild.muted ? "🔇" : "🔊";
});
stufenWahl.addEventListener("change", () => {
  if (!hls) return;
  hls.currentLevel = Number(stufenWahl.value);
});

document.addEventListener("mousemove", schichtenZeigen);
document.addEventListener("keydown", (ereignis) => {
  schichtenZeigen();
  const taste = ereignis.key;
  if (taste === " " || taste === "k") { ereignis.preventDefault(); spielenUmschalten(); }
  else if (taste === "ArrowLeft") springen(-10);
  else if (taste === "ArrowRight") springen(10);
  else if (taste === "ArrowUp") { lautstaerke.value = String(Math.min(100, Number(lautstaerke.value) + 5)); lautstaerke.dispatchEvent(new Event("input")); }
  else if (taste === "ArrowDown") { lautstaerke.value = String(Math.max(0, Number(lautstaerke.value) - 5)); lautstaerke.dispatchEvent(new Event("input")); }
  else if (taste === "m") tonUmschalten();
  else if (taste === "f") bruecke.vollbild(true);
  else if (taste === "Escape") beenden("escape");
});

/* -------------------------------------------------------------- Der Stand */

/**
 * Was der Hauptprozess ueber die Wiedergabe erfaehrt.
 *
 * Im Takt und nicht bei jedem Bild: `timeupdate` kommt viermal je Sekunde, und
 * viermal je Sekunde durch die Prozessgrenze zu gehen, um dieselbe Zahl um 0,25
 * zu erhoehen, waere Arbeit ohne Ertrag. Bei Pause, Sprung und Ende geht die
 * Meldung sofort - das sind die Augenblicke, in denen der Stand zaehlt.
 */
function standMelden(sofort = false) {
  const jetzt = Date.now();
  if (!sofort && jetzt - zuletztGemeldet < 5000) return;
  zuletztGemeldet = jetzt;
  bruecke.stand({
    stelle: Number(bild.currentTime) || 0,
    dauer: Number.isFinite(bild.duration) ? bild.duration : 0,
    gelaufen,
    laeuft: !bild.paused && !bild.ended,
    beendet: Boolean(bild.ended)
  });
}

bild.addEventListener("timeupdate", () => {
  const stelle = Number(bild.currentTime) || 0;
  const abstand = stelle - vorigeStelle;
  // Nur ein Schritt, der in normaler Geschwindigkeit vergangen sein kann,
  // zaehlt als geschaut. Alles darueber ist ein Sprung, alles darunter ein
  // Ruecksprung - beides ist keine gesehene Sekunde.
  if (abstand > 0 && abstand < 2 && !bild.paused) gelaufen += abstand;
  vorigeStelle = stelle;

  anzeigeStelle.textContent = zeit(stelle);
  if (Number.isFinite(bild.duration) && bild.duration > 0) {
    regler.value = String(Math.round((stelle / bild.duration) * 1000));
  }
  standMelden();
});

bild.addEventListener("durationchange", () => {
  anzeigeDauer.textContent = zeit(bild.duration);
});
bild.addEventListener("play", () => {
  knopfSpielen.textContent = "⏸";
  pufferZeigen(false);
  standMelden(true);
  schichtenZeigen();
});
bild.addEventListener("pause", () => {
  knopfSpielen.textContent = "▶";
  standMelden(true);
  schichtenZeigen();
});
bild.addEventListener("waiting", () => pufferZeigen(true));
bild.addEventListener("playing", () => pufferZeigen(false));
bild.addEventListener("seeked", () => { vorigeStelle = bild.currentTime; standMelden(true); });
bild.addEventListener("ended", () => {
  standMelden(true);
  // Nicht selbst zumachen: was nach dem Ende kommt - naechste Folge, Abspann,
  // nichts -, entscheidet der Hauptprozess. Er weiss, ob es eine naechste gibt.
  schichtenZeigen();
});
bild.addEventListener("error", () => {
  const code = bild.error?.code || 0;
  aufgeben(code === 4 ? "Das Format der Quelle spielt hier nicht." : "Die Quelle brach ab.", `video-${code}`);
});

function beenden(grund) {
  standMelden(true);
  bruecke.schliessen(grund);
}

/* ------------------------------------------------------------- Das Starten */

/** Die Stufenliste von hls.js in das Auswahlfeld. */
function stufenSetzen(stufen) {
  stufenWahl.innerHTML = "";
  const auto = document.createElement("option");
  auto.value = "-1";
  auto.textContent = "Auto";
  stufenWahl.appendChild(auto);
  stufen.forEach((stufe, nummer) => {
    const eintrag = document.createElement("option");
    eintrag.value = String(nummer);
    eintrag.textContent = stufe.height ? `${stufe.height}p` : `${Math.round((stufe.bitrate || 0) / 1000)} kbit/s`;
    stufenWahl.appendChild(eintrag);
  });
  stufenWahl.disabled = stufen.length < 2;
  // Die hoechste Stufe von Anfang an - derselbe Grund wie bei voe-qualitaet.js:
  // "Auto" regelt einmal nach unten und kommt von selbst oft nicht wieder hoch.
  if (stufen.length > 1) {
    const beste = stufen.reduce((bester, stufe, nummer) => (
      (stufe.height || 0) > (stufen[bester].height || 0) ? nummer : bester
    ), 0);
    hls.startLevel = beste;
    hls.currentLevel = beste;
    stufenWahl.value = String(beste);
  }
}

/**
 * Eine HLS-Playlist.
 *
 * Chromium spielt HLS nicht von sich aus - anders als Safari, das es nativ
 * kann. Deshalb hls.js: es liest die Playlist, laedt die Stuecke und legt sie
 * ueber die Media Source Extensions in das ganz gewoehnliche <video>. Kann der
 * Browser es doch selbst (dann steht es in canPlayType), bleibt es dabei - eine
 * Bibliothek, die nichts hinzufuegt, ist eine Fehlerquelle mehr.
 */
function hlsStarten(adresse) {
  const nativ = bild.canPlayType("application/vnd.apple.mpegurl");
  if (nativ) {
    bild.src = adresse;
    return;
  }
  if (typeof Hls === "undefined" || !Hls.isSupported()) {
    aufgeben("Für diese Playlist fehlt der Abspieler.", "hls-fehlt");
    return;
  }
  hls = new Hls({
    // Grosszuegig puffern: die Auslieferung der Hoster ist unstet, und ein
    // Nachladen mitten im Satz faellt mehr auf als ein paar Megabyte mehr.
    maxBufferLength: 60,
    backBufferLength: 30,
    // Bei jedem Stueck neu entscheiden waere hier falsch: die Stufe wird
    // einmal gesetzt (siehe stufenSetzen) und bleibt dann stehen.
    startLevel: -1
  });
  hls.on(Hls.Events.MANIFEST_PARSED, (_ereignis, daten) => stufenSetzen(daten.levels || []));
  hls.on(Hls.Events.LEVEL_SWITCHED, (_ereignis, daten) => {
    if (stufenWahl.value !== "-1") stufenWahl.value = String(daten.level);
  });
  hls.on(Hls.Events.ERROR, (_ereignis, daten) => {
    if (!daten.fatal) return;
    // Ein Netzfehler und ein Medienfehler haben je einen Versuch. Der zweite
    // desselben Fehlers ist keiner mehr, sondern eine Schleife.
    if (daten.type === Hls.ErrorTypes.NETWORK_ERROR && !gerettet.netz) {
      gerettet.netz = true;
      hls.startLoad();
      return;
    }
    if (daten.type === Hls.ErrorTypes.MEDIA_ERROR && !gerettet.medium) {
      gerettet.medium = true;
      hls.recoverMediaError();
      return;
    }
    aufgeben("Die Playlist des Hosters bricht ab.", `hls-${daten.details || daten.type}`);
  });
  hls.loadSource(adresse);
  hls.attachMedia(bild);
}

function starten(neuerAuftrag) {
  auftrag = neuerAuftrag || {};
  document.getElementById("titel").textContent = auftrag.titel || "Wiedergabe";
  document.getElementById("hoster").textContent = [auftrag.hoster, auftrag.stufe].filter(Boolean).join(" · ");
  fehlerKasten.hidden = true;
  pufferZeigen(true);
  gelaufen = 0;
  vorigeStelle = 0;

  if (!auftrag.adresse) {
    aufgeben("Es kam keine Adresse an.", "ohne-adresse");
    return;
  }

  if (auftrag.typ === "hls") hlsStarten(auftrag.adresse);
  else bild.src = auftrag.adresse;

  bild.addEventListener("loadedmetadata", () => {
    // Die gespeicherte Stelle - aber nicht am Ende: wer eine Folge zu
    // neunundneunzig Prozent gesehen hat, will sie von vorn und nicht die
    // letzten zehn Sekunden.
    const start = Number(auftrag.startzeit) || 0;
    if (start > 5 && Number.isFinite(bild.duration) && start < bild.duration - 20) {
      bild.currentTime = start;
      vorigeStelle = start;
    }
    anzeigeDauer.textContent = zeit(bild.duration);
    bild.play().catch(() => {
      // Ohne Zutun kein Ton: dann steht der Film eben und wartet auf einen
      // Klick. Ein Fehler ist das nicht.
      pufferZeigen(false);
      schichtenZeigen();
    });
  }, { once: true });

  schichtenZeigen();
}

bruecke.aufAuftrag(starten);
bruecke.bereit();
