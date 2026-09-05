"use strict";

/*
 * Der eigene Player.
 *
 * Er bekommt eine Adresse und spielt sie. Was er *nicht* tut, ist der Punkt an
 * der Sache: keine Werbeschicht wegraeumen, keine fremde Qualitaetswahl
 * uebersteuern, kein Ueberlagerungsknopf, den erst ein Klick wegnimmt. Das
 * alles gibt es nur, weil bisher ein fremder Player im Rahmen lief.
 *
 * <h2>Warum hier alles drin sein muss</h2>
 *
 * Die Anbieterseite ist nicht mehr zu sehen. Alles, was man frueher dort tat -
 * die naechste Folge anklicken, die Staffel wechseln, eine andere Fassung
 * waehlen, einen anderen Hoster nehmen -, muss deshalb hier gehen. Ein Player,
 * der nur abspielt, waere eine Sackgasse: eine Folge, und danach kaeme man
 * nirgendwo mehr hin.
 *
 * <h2>Was gemessen und was gemeldet wird</h2>
 *
 * Gemeldet wird die Stelle - und dazu, wie viele Sekunden davon *wirklich*
 * gelaufen sind. Die Unterscheidung ist dieselbe wie in messung.js: ein Zug am
 * Regler bringt einen ans Ende der Folge, aber er hat sie nicht geschaut.
 * Gezaehlt wird deshalb nur, was zwischen zwei Meldungen des Videos in
 * normaler Geschwindigkeit vergangen ist.
 */

const bruecke = window.elfixSpieler || {
  aufAuftrag() {}, aufNaechste() {}, bereit() {}, stand() {}, fehler() {},
  schliessen() {}, vollbild() {}, folgen() {}, wechseln() {}, hoster() {}
};

const bild = document.getElementById("bild");
const regler = document.getElementById("regler");
const lautstaerke = document.getElementById("lautstaerke");
const stufenWahl = document.getElementById("stufen");
const hosterWahl = document.getElementById("hosterWahl");
const untertitelWahl = document.getElementById("untertitel");
const knopfSpielen = document.getElementById("spielen");
const knopfTon = document.getElementById("ton");
const knopfWeiter = document.getElementById("weiterKnopf");
const anzeigeStelle = document.getElementById("stelle");
const anzeigeDauer = document.getElementById("dauer");
const puffer = document.getElementById("puffer");
const fehlerKasten = document.getElementById("fehler");
const fehlerText = document.getElementById("fehlerText");
const folgenPanel = document.getElementById("folgenPanel");
const folgenListe = document.getElementById("folgenListe");
const folgenLeer = document.getElementById("folgenLeer");
const staffelReiter = document.getElementById("staffelReiter");
const weiterKasten = document.getElementById("weiter");
const weiterZahl = document.getElementById("weiterZahl");
const weiterTitel = document.getElementById("weiterTitel");
const schichten = [document.getElementById("kopf"), document.getElementById("leiste")];

/** So lange laeuft der Countdown zur naechsten Folge. */
const WEITER_SEKUNDEN = 8;

/** Der laufende Auftrag - Adresse, Titel, Startzeit, Hosterliste. */
let auftrag = null;
/** Die Bibliothek fuer HLS, falls eine gebraucht wird. */
let hls = null;
/** Wirklich gelaufene Sekunden. Siehe oben: nicht dasselbe wie die Stelle. */
let gelaufen = 0;
/** Die Stelle der vorigen Meldung - Grundlage der Zaehlung. */
let vorigeStelle = 0;
/** Ein einziger Rettungsversuch je Sorte Fehler, danach ist es einer. */
let gerettet = { netz: false, medium: false };
/** Die naechste Folge, sobald der Hauptprozess sie kennt. */
let naechste = null;
/** Die gelesene Staffel- und Folgenliste. */
let folgenStand = null;
/** Welche Staffel im Panel gerade aufgeschlagen ist. */
let offeneStaffel = 0;
/** Solange ein Wechsel laeuft, darf kein zweiter angestossen werden. */
let wechselLaeuft = false;
/** Ob die gespeicherte Stelle fuer diesen Auftrag schon angesprungen wurde. */
let startGesetzt = false;

let zuletztGemeldet = 0;
let ruheUhr = 0;
let weiterUhr = 0;
let weiterRest = 0;

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
 * Er meldet dem Hauptprozess, was schiefging, und zeigt, was man tun kann. Der
 * Knopf darunter fuehrt nicht zurueck auf die Anbieterseite - die soll niemand
 * mehr sehen -, sondern zur Folgenliste und zur Hosterwahl: fast immer ist ein
 * anderer Hoster die Antwort.
 */
function aufgeben(text, grund) {
  fehlerText.textContent = String(text || "Die Quelle antwortet nicht.");
  fehlerKasten.hidden = false;
  pufferZeigen(false);
  schichtenZeigen();
  bruecke.fehler(`${grund}: ${text}`);
}

/* ---------------------------------------------------------- Die Bedienung */

function schichtenZeigen() {
  for (const schicht of schichten) schicht.classList.remove("weg");
  clearTimeout(ruheUhr);
  // Waehrend Pause, offener Liste oder Fehler bleibt die Leiste stehen: wer
  // pausiert, will etwas tun.
  ruheUhr = setTimeout(() => {
    if (!bild.paused && fehlerKasten.hidden && folgenPanel.hidden) {
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

/* ------------------------------------------------------- Die Folgenliste */

/**
 * Die Liste holen und zeigen.
 *
 * Sie kostet einen Seitenaufruf im Hintergrund, deshalb wird sie erst geholt,
 * wenn jemand sie aufklappt, und danach behalten. Wer sie nicht braucht, wartet
 * auch nicht auf sie.
 */
async function folgenZeigen() {
  folgenPanel.hidden = false;
  schichtenZeigen();
  if (folgenStand) return;
  folgenListe.textContent = "";
  folgenLeer.hidden = false;
  folgenLeer.textContent = "Folgen werden gelesen …";
  const stand = await bruecke.folgen(false);
  if (!stand || !Array.isArray(stand.folgen) || !stand.folgen.length) {
    folgenLeer.textContent = "Die Folgenliste ließ sich nicht lesen.";
    return;
  }
  folgenStand = stand;
  const laufend = stand.folgen.find((eintrag) => eintrag.laeuft);
  offeneStaffel = laufend ? laufend.staffel : (stand.folgen[0]?.staffel || 0);
  folgenZeichnen();
}

function folgenZeichnen() {
  if (!folgenStand) return;
  folgenLeer.hidden = true;
  document.getElementById("folgenTitel").textContent = folgenStand.titel || "Folgen";

  const staffeln = [...new Set(folgenStand.folgen.map((eintrag) => eintrag.staffel))]
    .sort((links, rechts) => links - rechts);
  staffelReiter.textContent = "";
  // Bei einer einzigen Staffel waere eine Reiterzeile mit genau einem Reiter
  // eine Zeile, die nichts entscheidet.
  staffelReiter.hidden = staffeln.length < 2;
  for (const staffel of staffeln) {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.textContent = staffel > 0 ? `Staffel ${staffel}` : "Filme";
    knopf.className = staffel === offeneStaffel ? "aktiv" : "";
    knopf.addEventListener("click", () => {
      offeneStaffel = staffel;
      folgenZeichnen();
    });
    staffelReiter.appendChild(knopf);
  }

  folgenListe.textContent = "";
  for (const eintrag of folgenStand.folgen.filter((wert) => wert.staffel === offeneStaffel)) {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = eintrag.laeuft ? "laeuft" : "";
    // Gesperrt heisst: die Nummer steht in der Liste, aber dahinter liegt keine
    // eigene Folge (sie ist in einer anderen enthalten). Anklickbar waere sie
    // ein Versprechen, das die Anbieterseite nicht haelt.
    knopf.disabled = Boolean(eintrag.gesperrt) || !eintrag.url;
    const nummer = document.createElement("span");
    nummer.className = "nummer";
    nummer.textContent = `Folge ${eintrag.folge}`;
    const titel = document.createElement("span");
    titel.textContent = eintrag.titel || (eintrag.gesperrt ? "in einer anderen Folge enthalten" : "");
    knopf.append(nummer, titel);
    knopf.addEventListener("click", () => folgeWechseln(eintrag.url));
    folgenListe.appendChild(knopf);
  }
}

/**
 * Zu einer anderen Folge.
 *
 * Der Stand der laufenden geht vorher noch einmal hinaus - danach gilt die
 * neue, und was bis hierher geschaut wurde, waere sonst verloren.
 */
async function folgeWechseln(url) {
  if (!url || wechselLaeuft) return;
  wechselLaeuft = true;
  weiterAbbrechen();
  standMelden(true);
  pufferZeigen(true);
  fehlerKasten.hidden = true;
  const ergebnis = await bruecke.wechseln(url);
  wechselLaeuft = false;
  if (!ergebnis || !ergebnis.ok) {
    aufgeben(ergebnis?.grund || "Die Folge ließ sich nicht öffnen.", "wechsel");
    return;
  }
  // Der neue Auftrag kommt ueber denselben Weg wie der erste; die Liste bleibt
  // stehen, nur ihre Markierung wandert.
  folgenPanel.hidden = true;
}

/* ------------------------------------------------- Hoster, Fassung, Untertitel */

/**
 * Die Hosterliste in das Auswahlfeld.
 *
 * Beschriftet wird mit dem, was der Zuschauer wiedererkennt: dem Namen des
 * Hosters. Die Fassung steht dahinter, aber nur, wenn es ueberhaupt mehr als
 * eine gibt - sonst waere es eine Angabe, die nie etwas unterscheidet.
 */
function hosterSetzen(liste, laufender) {
  const eintraege = Array.isArray(liste) ? liste : [];
  const sprachen = new Set(eintraege.map((eintrag) => eintrag.sprache).filter(Boolean));
  hosterWahl.textContent = "";
  for (const eintrag of eintraege) {
    const zeile = document.createElement("option");
    zeile.value = eintrag.adresse;
    const teile = [eintrag.hoster || "Hoster"];
    if (sprachen.size > 1 && eintrag.sprache) teile.push(`Fassung ${eintrag.sprache}`);
    zeile.textContent = teile.join(" · ");
    hosterWahl.appendChild(zeile);
  }
  hosterWahl.disabled = eintraege.length < 2;
  if (laufender) hosterWahl.value = laufender;
}

async function hosterWechseln(link) {
  if (!link || wechselLaeuft) return;
  wechselLaeuft = true;
  const stelle = Number(bild.currentTime) || 0;
  standMelden(true);
  pufferZeigen(true);
  fehlerKasten.hidden = true;
  const ergebnis = await bruecke.hoster(link, stelle);
  wechselLaeuft = false;
  if (!ergebnis || !ergebnis.ok) {
    aufgeben(ergebnis?.grund || "Dieser Hoster gibt nichts her.", "hosterwechsel");
  }
}

/**
 * Die Untertitelspuren.
 *
 * Sie stehen bei HLS in der Playlist und werden von hls.js gemeldet; bei einer
 * einzelnen Datei gibt es sie nicht. "Aus" steht immer oben - eine Spur, die
 * sich nicht abschalten laesst, waere schlimmer als keine.
 */
function untertitelSetzen(spuren) {
  untertitelWahl.textContent = "";
  const aus = document.createElement("option");
  aus.value = "-1";
  aus.textContent = "Untertitel aus";
  untertitelWahl.appendChild(aus);
  (spuren || []).forEach((spur, nummer) => {
    const zeile = document.createElement("option");
    zeile.value = String(nummer);
    zeile.textContent = spur.name || spur.lang || `Spur ${nummer + 1}`;
    untertitelWahl.appendChild(zeile);
  });
  untertitelWahl.disabled = !(spuren || []).length;
  untertitelWahl.value = "-1";
}

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

/* ------------------------------------------------------- Die naechste Folge */

function naechsteSetzen(wert) {
  naechste = wert && wert.url ? wert : null;
  knopfWeiter.hidden = !naechste;
  if (naechste) knopfWeiter.title = `Nächste Folge: ${naechste.beschriftung || ""}`;
}

/**
 * Der Uebergang.
 *
 * Sichtbar heruntergezaehlt, damit ein Abbruch moeglich bleibt - wer den
 * Abspann sehen will, soll ihn sehen. Und ohne naechste Folge passiert gar
 * nichts: das Ende einer Serie ist kein Fehler.
 */
function weiterAnbieten() {
  if (!naechste || weiterUhr) return;
  weiterRest = WEITER_SEKUNDEN;
  weiterTitel.textContent = naechste.beschriftung || "";
  weiterZahl.textContent = String(weiterRest);
  weiterKasten.hidden = false;
  weiterUhr = setInterval(() => {
    weiterRest -= 1;
    weiterZahl.textContent = String(Math.max(0, weiterRest));
    if (weiterRest <= 0) {
      const ziel = naechste?.url || "";
      weiterAbbrechen();
      folgeWechseln(ziel);
    }
  }, 1000);
}

function weiterAbbrechen() {
  if (weiterUhr) clearInterval(weiterUhr);
  weiterUhr = 0;
  weiterKasten.hidden = true;
}

/* ------------------------------------------------------------- Die Horcher */

document.getElementById("spielen").addEventListener("click", spielenUmschalten);
document.getElementById("zurueck").addEventListener("click", () => springen(-10));
document.getElementById("vor").addEventListener("click", () => springen(10));
document.getElementById("ton").addEventListener("click", tonUmschalten);
document.getElementById("gross").addEventListener("click", () => bruecke.vollbild(true));
document.getElementById("zu").addEventListener("click", () => beenden("knopf"));
document.getElementById("zurueckZumHoster").addEventListener("click", () => {
  fehlerKasten.hidden = true;
  folgenZeigen();
});
document.getElementById("folgenKnopf").addEventListener("click", () => {
  if (folgenPanel.hidden) folgenZeigen();
  else folgenPanel.hidden = true;
});
document.getElementById("folgenZu").addEventListener("click", () => { folgenPanel.hidden = true; });
knopfWeiter.addEventListener("click", () => folgeWechseln(naechste?.url || ""));
document.getElementById("weiterJetzt").addEventListener("click", () => {
  const ziel = naechste?.url || "";
  weiterAbbrechen();
  folgeWechseln(ziel);
});
document.getElementById("weiterAbbruch").addEventListener("click", weiterAbbrechen);
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
hosterWahl.addEventListener("change", () => hosterWechseln(hosterWahl.value));
untertitelWahl.addEventListener("change", () => {
  const nummer = Number(untertitelWahl.value);
  if (hls) {
    hls.subtitleTrack = nummer;
    hls.subtitleDisplay = nummer >= 0;
    return;
  }
  // Ohne hls.js sind es die Spuren des Videos selbst.
  const spuren = bild.textTracks || [];
  for (let i = 0; i < spuren.length; i += 1) {
    spuren[i].mode = i === nummer ? "showing" : "disabled";
  }
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
  else if (taste === "e") { if (folgenPanel.hidden) folgenZeigen(); else folgenPanel.hidden = true; }
  else if (taste === "n" && naechste) folgeWechseln(naechste.url);
  else if (taste === "Escape") {
    // Erst die Liste, dann der Player: Escape schliesst, was offen ist.
    if (!folgenPanel.hidden) folgenPanel.hidden = true;
    else beenden("escape");
  }
});

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
    // Der Uebergang faengt vor dem letzten Bild an - der Abspann laeuft weiter,
    // waehrend der Kasten schon dasteht. Wer ihn wegklickt, sieht ihn zu Ende.
    if (naechste && bild.duration - stelle <= WEITER_SEKUNDEN + 1) weiterAnbieten();
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
  schichtenZeigen();
  // Der Uebergang kann schon laufen (siehe timeupdate). Steht er noch nicht,
  // ist jetzt der Augenblick dafuer.
  weiterAnbieten();
});
bild.addEventListener("error", () => {
  const code = bild.error?.code || 0;
  // Ein Fehler ohne Quelle ist keiner: das Zuruecksetzen zwischen zwei Folgen
  // loest ihn selbst aus.
  if (!bild.getAttribute("src") && !hls) return;
  aufgeben(code === 4 ? "Das Format der Quelle spielt hier nicht." : "Die Quelle brach ab.", `video-${code}`);
});

/**
 * Die gespeicherte Stelle anspringen.
 *
 * Ein Horcher fuer alle Auftraege: er liest, was im laufenden Auftrag steht.
 * Je Auftrag einmal - sonst zoege ein zweites `loadedmetadata` (das kommt bei
 * einem Wechsel der Quelle) den Film wieder zurueck.
 */
bild.addEventListener("loadedmetadata", () => {
  anzeigeDauer.textContent = zeit(bild.duration);
  if (startGesetzt) return;
  startGesetzt = true;
  // Nicht am Ende: wer eine Folge zu neunundneunzig Prozent gesehen hat, will
  // sie von vorn und nicht die letzten zehn Sekunden.
  const start = Number(auftrag?.startzeit) || 0;
  if (start > 5 && Number.isFinite(bild.duration) && start < bild.duration - 20) {
    bild.currentTime = start;
    vorigeStelle = start;
  }
  bild.play().catch(() => {
    // Ohne Zutun kein Ton: dann steht der Film eben und wartet auf einen
    // Klick. Ein Fehler ist das nicht.
    pufferZeigen(false);
    schichtenZeigen();
  });
});

function beenden(grund) {
  standMelden(true);
  bruecke.schliessen(grund);
}

/* ------------------------------------------------------------- Das Starten */

/** Die Stufenliste von hls.js in das Auswahlfeld. */
function stufenSetzen(stufen) {
  stufenWahl.textContent = "";
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
  if (stufen.length > 1 && hls) {
    const beste = stufen.reduce((bester, stufe, nummer) => (
      (stufe.height || 0) > (stufen[bester].height || 0) ? nummer : bester
    ), 0);
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
    startLevel: -1
  });
  hls.on(Hls.Events.MANIFEST_PARSED, (_ereignis, daten) => {
    stufenSetzen(daten.levels || []);
    untertitelSetzen(daten.subtitleTracks || hls.subtitleTracks || []);
  });
  hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_ereignis, daten) => {
    untertitelSetzen(daten.subtitleTracks || []);
  });
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

/**
 * Ein Auftrag - der erste oder ein weiterer.
 *
 * Weitere kommen bei jedem Folgen- und Hosterwechsel. Deshalb faengt das hier
 * mit Aufraeumen an: eine hls.js-Instanz, die man stehen laesst, laedt ihre
 * alte Playlist munter weiter und schreibt in dasselbe <video>.
 */
function starten(neuerAuftrag) {
  auftrag = neuerAuftrag || {};
  startGesetzt = false;
  gelaufen = 0;
  vorigeStelle = 0;
  gerettet = { netz: false, medium: false };
  weiterAbbrechen();

  if (hls) {
    try {
      hls.destroy();
    } catch (_) {
      // Eine Instanz, die sich nicht abraeumen laesst, ist trotzdem fort.
    }
    hls = null;
  }
  bild.pause();
  bild.removeAttribute("src");
  bild.load();

  document.getElementById("titel").textContent = auftrag.titel || "Wiedergabe";
  document.getElementById("hoster").textContent = [auftrag.hoster, auftrag.stufe].filter(Boolean).join(" · ");
  fehlerKasten.hidden = true;
  pufferZeigen(true);
  hosterSetzen(auftrag.hosterliste, auftrag.link);
  untertitelSetzen([]);
  naechsteSetzen(auftrag.naechste);
  // Die Liste bleibt, ihre Markierung nicht: welche Folge laeuft, steht im
  // Stand und nicht im Auftrag - also wird sie beim naechsten Aufklappen neu
  // geholt.
  folgenStand = null;

  if (!auftrag.adresse) {
    aufgeben("Es kam keine Adresse an.", "ohne-adresse");
    return;
  }

  if (auftrag.typ === "hls") hlsStarten(auftrag.adresse);
  else bild.src = auftrag.adresse;

  schichtenZeigen();
}

bruecke.aufAuftrag(starten);
bruecke.aufNaechste(naechsteSetzen);
bruecke.bereit();
