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
  aufAuftrag() {}, aufNaechste() {}, aufMarke() {}, aufSteuern() {}, bereit() {}, autoplay() {}, schlussNachFolge() {}, stand() {},
  fehler() {}, schliessen() {}, vollbild() {}, folgen() {}, wechseln() {}, hoster() {},
  sprung() {}, takt() {}, aktion() {}
};

const bild = document.getElementById("bild");
const regler = document.getElementById("regler");
const lautstaerke = document.getElementById("lautstaerke");
const stufenWahl = document.getElementById("stufen");
const hosterWahl = document.getElementById("hosterWahl");
const fassungWahl = document.getElementById("fassungWahl");
const untertitelWahl = document.getElementById("untertitel");
const knopfSpielen = document.getElementById("spielen");
const knopfTon = document.getElementById("ton");
const knopfWeiter = document.getElementById("weiterKnopf");
const knopfAuto = document.getElementById("autoKnopf");
const knopfMarke = document.getElementById("marke");
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
const schichten = [
  document.getElementById("kopf"),
  document.getElementById("leiste"),
  // Die Karte zur naechsten Folge geht mit: sie steht ueber dem Bild, und ein
  // Knopf, der ueber einem laufenden Film dauerhaft stehenbleibt, stoert genau
  // so wie eine Leiste. Sichtbar wird sie beim Erreichen der Schwelle - danach
  // immer dann, wenn sich die Maus regt.
  document.getElementById("weiterKnopf")
];

/**
 * So lange laeuft der Countdown zur naechsten Folge - und ob ueberhaupt.
 *
 * Der Wert kommt aus dem Auftrag und wird nicht hier entschieden: der
 * Hauptprozess kennt die Einstellung "Nächste Folge von selbst starten" und
 * das einmalige "Danach aufhören", und beide enden bei derselben Zahl. Null
 * heisst: kein Zaehler, nur der Knopf.
 *
 * Vorher stand hier eine feste 8, ohne zu fragen. Wer Autoplay abgeschaltet
 * hatte, bekam es trotzdem.
 */
let weiterZaehler = 0;

/** Der Rueckfall, falls ein Auftrag ohne Angabe kommt. */
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
/** Die gelernte Intro-Marke dieser Staffel, falls es eine gibt. */
let marke = null;
/** Laeuft zu dieser Folge eine Watchparty? Dann geht der Takt hinaus. */
let inRunde = false;
/** Puffert das Video gerade? Eine Messung waehrend des Puffern taugt nichts. */
let puffert = false;
/**
 * Bis wann eine Aenderung als "kam von der Runde" gilt.
 *
 * Ohne diese Frist antwortete jede Pause der Runde mit einer eigenen Pause an
 * die Runde - und die naechste Antwort auf die Antwort. Die Frist ist knapp
 * gehalten: sie soll das Echo abfangen und nicht eine echte Tat verschlucken,
 * die eine Sekunde spaeter kommt.
 */
let ausRundeBis = 0;
/** Die gelesene Staffel- und Folgenliste. */
let folgenStand = null;
/** Welche Staffel im Panel gerade aufgeschlagen ist. */
let offeneStaffel = 0;
/** Solange ein Wechsel laeuft, darf kein zweiter angestossen werden. */
let wechselLaeuft = false;
/** Ob die gespeicherte Stelle fuer diesen Auftrag schon angesprungen wurde. */
let startGesetzt = false;
/**
 * Die Folge liegt bereit, gewaehlt ist sie nicht.
 *
 * Beim Aufmachen einer neuen Serie laedt ELFIX die erste Folge schon einmal
 * vor, waehrend die Liste offen dasteht. Sie darf dabei nicht von selbst
 * losgehen: gewaehlt wurde noch nichts, und ein Film, der ungefragt anfaengt,
 * waere genau das, was der eigene Player abschaffen sollte.
 */
let vorgeladen = false;

let zuletztGemeldet = 0;
let ruheUhr = 0;
let weiterUhr = 0;
let weiterRest = 0;
let weiterVerworfen = false;

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

/*
 * Zwei abgelehnte play()-Aufrufe, die keine Fehler sind.
 *
 * `play()` gibt ein Versprechen zurueck, und das wird abgelehnt, sobald vor
 * seiner Einloesung etwas anderes am Video passiert:
 *
 *   AbortError       "The play() request was interrupted by a call to
 *                    pause()." Wer auf Abspielen und gleich darauf auf Pause
 *                    tippt, loest genau das aus - und beides ist geschehen wie
 *                    gewollt. Dasselbe beim Hosterwechsel, wo mitten im
 *                    Anlaufen eine neue Quelle gesetzt wird.
 *   NotAllowedError  Der Browser laesst ohne Zutun keinen Ton zu. Die richtige
 *                    Antwort ist die Leiste mit dem Abspielknopf, nicht ein
 *                    Kasten, der behauptet, die Quelle sei kaputt.
 *
 * Gemeldet wurde bisher beides als "Die Quelle spielt nicht" - mitten in einer
 * Folge, die sichtbar lief. Ein Fehlerkasten ueber einem laufenden Bild ist
 * schlimmer als keiner: er sagt, man solle einen anderen Hoster nehmen,
 * obwohl dieser gerade tut, was er soll.
 */
const HARMLOSE_ABLEHNUNG = ["AbortError", "NotAllowedError"];

function spielenUmschalten() {
  if (!bild.paused) {
    bild.pause();
    return;
  }
  bild.play().catch((fehler) => {
    if (HARMLOSE_ABLEHNUNG.includes(String(fehler?.name || ""))) {
      // Nichts melden - nur zeigen, was jetzt zu tun ist.
      pufferZeigen(false);
      schichtenZeigen();
      return;
    }
    aufgeben(String(fehler?.message || fehler), "play");
  });
}

function springen(sekunden) {
  if (!Number.isFinite(bild.duration) || bild.duration <= 0) return;
  const von = bild.currentTime;
  bild.currentTime = Math.min(Math.max(0, von + sekunden), bild.duration - 0.5);
  bruecke.sprung(von, bild.currentTime, false);
  tatMelden("seek");
  schichtenZeigen();
}

/**
 * Das Intro ueberspringen.
 *
 * Ein Knopf, kein Automatismus - derselbe Grund wie in marken.js: ein Skript,
 * das ungefragt springt, ist eine Bevormundung, und ein falscher Sprung kostet
 * neunzig Sekunden Handlung, die man erst wiederfinden muss.
 */
function markeNutzen() {
  if (!marke) return;
  const von = bild.currentTime;
  bild.currentTime = Math.max(von + 1, marke.ziel);
  vorigeStelle = bild.currentTime;
  bruecke.sprung(von, bild.currentTime, true);
  knopfMarke.hidden = true;
}

/** Der Knopf steht nur in seinem Fenster - davor und danach waere er im Weg. */
function markeZeigen(stelle) {
  knopfMarke.hidden = !(marke && stelle >= marke.ab && stelle <= marke.bis);
}

/** Kam die letzte Aenderung aus der Runde? */
function ausRunde() {
  return Date.now() < ausRundeBis;
}

/**
 * Ein Befehl der Runde.
 *
 * `springen` ist falsch fuer den Host beim Gleichziehen: er steht schon dort,
 * wo alle hinsollen, und ein Sprung auf die eigene Stelle laesst nur neu
 * puffern.
 */
function steuernAusRunde(befehl) {
  if (!befehl) return;
  if (befehl.tun === "fern") {
    fernSteuern(befehl);
    return;
  }
  ausRundeBis = Date.now() + 900;
  const stelle = Number(befehl.stelle);
  if (befehl.springen !== false && Number.isFinite(stelle) && stelle >= 0) {
    bild.currentTime = stelle;
    vorigeStelle = stelle;
  }
  if (befehl.laufen) bild.play().catch(() => {});
  else bild.pause();
}

function fernSteuern(auftragFern) {
  const befehl = auftragFern.befehl;
  if (befehl === "pause") bild.pause();
  else if (befehl === "abspielen") bild.play().catch(() => {});
  else if (befehl === "umschalten") spielenUmschalten();
  else if (befehl === "stumm") tonUmschalten();
  else if (befehl === "vollbild") bruecke.vollbild(true);
  else if (befehl === "folge") { folgeWechseln(auftragFern.url); return; }
  else if (befehl === "vor" || befehl === "zurueck") {
    springen(befehl === "vor" ? Number(auftragFern.vor) || 30 : -(Number(auftragFern.zurueck) || 10));
  } else if (befehl === "lauter" || befehl === "leiser") {
    bild.volume = Math.max(0, Math.min(1, bild.volume + (befehl === "lauter" ? 0.1 : -0.1)));
    if (befehl === "lauter") bild.muted = false;
    lautstaerke.value = String(Math.round(bild.volume * 100));
    knopfTon.textContent = bild.muted || bild.volume === 0 ? "🔇" : "🔊";
  }
  standMelden(true);
  schichtenZeigen();
}

/** Die eigene Tat an die Runde - aber nur, wenn es die eigene war. */
function tatMelden(aktion) {
  if (!inRunde || ausRunde()) return;
  bruecke.aktion(aktion, Number(bild.currentTime) || 0);
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

/*
 * Eine Staffel oeffnen.
 *
 * Sind ihre Folgen schon da, wird nur umgeschaltet. Sonst wird die Seite dieser
 * Staffel gelesen - das dauert einen Augenblick, deshalb sagt die Liste
 * solange, was sie tut. Die Staffelliste selbst kommt von jeder Staffelseite
 * mit, die Reiterzeile bleibt also vollstaendig.
 */
async function staffelOeffnen(staffel) {
  offeneStaffel = staffel;
  if (folgenStand?.folgen?.some((eintrag) => eintrag.staffel === staffel)) {
    folgenZeichnen();
    return;
  }
  const ziel = (folgenStand?.staffeln || []).find((eintrag) => eintrag.staffel === staffel);
  if (!ziel) {
    folgenZeichnen();
    return;
  }
  folgenListe.textContent = "";
  folgenLeer.hidden = false;
  folgenLeer.textContent = `Staffel ${staffel} wird gelesen …`;
  folgenZeichnen();
  const stand = await bruecke.folgen(false, ziel.url);
  if (!stand || !Array.isArray(stand.folgen) || !stand.folgen.length) {
    folgenLeer.hidden = false;
    folgenLeer.textContent = `Staffel ${staffel} ließ sich nicht lesen.`;
    return;
  }
  // Die gelesenen Folgen kommen dazu, die alten bleiben - wer hin und her
  // schaltet, soll nicht jedes Mal warten.
  const vorhanden = new Set((folgenStand.folgen || []).map((eintrag) => eintrag.url));
  folgenStand = {
    ...stand,
    staffeln: stand.staffeln?.length ? stand.staffeln : folgenStand.staffeln,
    folgen: [
      ...(folgenStand.folgen || []),
      ...stand.folgen.filter((eintrag) => !vorhanden.has(eintrag.url))
    ].sort((links, rechts) => (links.staffel - rechts.staffel) || (links.folge - rechts.folge))
  };
  folgenZeichnen();
}

function folgenZeichnen() {
  if (!folgenStand) return;
  // Der Hinweis wird hier NICHT pauschal ausgeblendet: waehrend eine Staffel
  // nachgelesen wird, steht dort "Staffel 3 wird gelesen ...", und diese
  // Funktion laeuft dazwischen, um die Reiterzeile schon umzustellen.
  // Ausgeblendet wird er unten, sobald wirklich Folgen dastehen.
  document.getElementById("folgenTitel").textContent = folgenStand.titel || "Folgen";

  /*
   * Die Reiterzeile kommt aus der Staffelliste, nicht aus den Folgen.
   *
   * Vorher wurden die Reiter aus den geladenen *Folgen* gebildet - und die
   * stammen alle von einer Seite. Also gab es nie mehr als eine Staffel, die
   * Zeile blendete sich weg, und man kam aus der laufenden Staffel nicht
   * heraus. Die Serie kennt ihre Staffeln aber (`folgenStand.staffeln`), auch
   * wenn deren Folgen noch nicht gelesen sind; die holt der Klick nach.
   */
  const bekannte = Array.isArray(folgenStand.staffeln) ? folgenStand.staffeln : [];
  const ausFolgen = [...new Set(folgenStand.folgen.map((eintrag) => eintrag.staffel))];
  const staffeln = [...new Set([...bekannte.map((eintrag) => eintrag.staffel), ...ausFolgen])]
    .filter((staffel) => Number.isFinite(staffel))
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
    knopf.addEventListener("click", () => staffelOeffnen(staffel));
    staffelReiter.appendChild(knopf);
  }

  folgenListe.textContent = "";
  const sichtbare = folgenStand.folgen.filter((wert) => wert.staffel === offeneStaffel);
  // Steht die Staffel im Reiter, sind ihre Folgen aber noch nicht gelesen,
  // bleibt der Hinweis von staffelOeffnen stehen.
  if (sichtbare.length) folgenLeer.hidden = true;
  for (const eintrag of sichtbare) {
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

/*
 * Zwei Fragen, zwei Felder.
 *
 * Vorher stand beides in einem: "Vidmoly · Fassung 1". Das beantwortete keine
 * der beiden Fragen gut - wer die Sprache wechseln wollte, musste sich durch
 * eine Liste arbeiten, in der jede Sprache so oft vorkam, wie es Hoster gibt.
 * Jetzt waehlt das eine Feld die Fassung und das andere den Hoster; das
 * Hosterfeld zeigt nur, was es zu dieser Fassung ueberhaupt gibt.
 */

/** Alles, was gerade zur Wahl steht - der Player behaelt es zwischen den Klicks. */
let hosterBestand = [];

/** Wie eine Fassung an dieser Kachel heisst. Das Wort schlaegt die Zahl. */
function fassungVon(eintrag) {
  return String(eintrag?.fassung || eintrag?.sprache || "").trim();
}

/**
 * VOE zuerst.
 *
 * Nicht Geschmack, sondern Erfahrung: VOEs Block laesst sich auspacken, er
 * liefert mehrere Stufen und die laengste Laufzeit. Steht er zur Wahl, ist er
 * die Vorgabe - bei der ersten Folge wie nach jedem Fassungswechsel.
 */
function bestenNehmen(eintraege) {
  const voe = eintraege.find((eintrag) => /voe/i.test(eintrag.hoster || ""));
  return voe || eintraege[0] || null;
}

function fassungSetzen(liste, laufender) {
  const eintraege = Array.isArray(liste) ? liste : [];
  const namen = [];
  for (const eintrag of eintraege) {
    const name = fassungVon(eintrag);
    if (name && !namen.includes(name)) namen.push(name);
  }
  fassungWahl.textContent = "";
  for (const name of namen) {
    const zeile = document.createElement("option");
    zeile.value = name;
    zeile.textContent = name;
    fassungWahl.appendChild(zeile);
  }
  // Eine einzige Fassung ist keine Wahl - dann steht sie nur da.
  fassungWahl.disabled = namen.length < 2;
  fassungWahl.hidden = namen.length === 0;
  const laufendeFassung = fassungVon(eintraege.find((eintrag) => eintrag.adresse === laufender));
  if (laufendeFassung) fassungWahl.value = laufendeFassung;
  else if (namen.length) fassungWahl.value = namen[0];
  return fassungWahl.value;
}

/**
 * Die Hosterliste in das Auswahlfeld - nur die zur gewaehlten Fassung.
 *
 * Beschriftet wird mit dem, was der Zuschauer wiedererkennt: dem Namen des
 * Hosters. Die Fassung steht nicht mehr dahinter; sie hat ihr eigenes Feld.
 */
function hosterSetzen(liste, laufender) {
  hosterBestand = Array.isArray(liste) ? liste : [];
  const fassung = fassungSetzen(hosterBestand, laufender);
  const passend = fassung
    ? hosterBestand.filter((eintrag) => fassungVon(eintrag) === fassung)
    : hosterBestand;

  hosterWahl.textContent = "";
  if (!laufender) {
    const auswahl = document.createElement("option");
    auswahl.value = "";
    auswahl.textContent = "Hoster wählen";
    auswahl.disabled = true;
    hosterWahl.appendChild(auswahl);
  }
  for (const eintrag of passend) {
    const zeile = document.createElement("option");
    zeile.value = eintrag.adresse;
    zeile.textContent = eintrag.hoster || "Hoster";
    hosterWahl.appendChild(zeile);
  }
  hosterWahl.disabled = passend.length === 0 || (Boolean(laufender) && passend.length < 2);
  if (laufender && passend.some((eintrag) => eintrag.adresse === laufender)) {
    hosterWahl.value = laufender;
  } else {
    hosterWahl.value = "";
  }
}

/**
 * Die Fassung wechseln.
 *
 * Genommen wird derselbe Hoster in der neuen Fassung, wenn es ihn dort gibt -
 * wer bei VOE war, bleibt bei VOE. Sonst der beste, den diese Fassung hergibt.
 */
function fassungWechseln(name) {
  const passend = hosterBestand.filter((eintrag) => fassungVon(eintrag) === name);
  if (!passend.length) return;
  const jetzige = hosterBestand.find((eintrag) => eintrag.adresse === hosterWahl.value);
  const gleicher = jetzige
    ? passend.find((eintrag) => (eintrag.hoster || "").toLowerCase() === (jetzige.hoster || "").toLowerCase())
    : null;
  const ziel = gleicher || bestenNehmen(passend);
  if (ziel) hosterWechseln(ziel.adresse);
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
  /*
   * Kein Feld, wo es nichts zu waehlen gibt.
   *
   * Vorher stand "Untertitel aus" auch dann da, wenn die Quelle gar keine
   * Spuren mitbringt - nur blass. Ein abgeblendetes Feld sieht aus wie eines,
   * das gerade nicht geht; tatsaechlich gibt es dort nie etwas. Es ganz
   * wegzulassen ist ehrlicher und macht die Leiste kuerzer.
   */
  const hatSpuren = Boolean((spuren || []).length);
  untertitelWahl.hidden = !hatSpuren;
  untertitelWahl.disabled = !hatSpuren;
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
    auftragId: auftrag?.id,
    stelle: Number(bild.currentTime) || 0,
    dauer: Number.isFinite(bild.duration) ? bild.duration : 0,
    gelaufen,
    laeuft: !bild.paused && !bild.ended,
    stumm: bild.muted || bild.volume === 0,
    beendet: Boolean(bild.ended)
  });
}

/* ------------------------------------------------------- Die naechste Folge */

/*
 * Ab wann der Knopf zur naechsten Folge dasteht.
 *
 * Nicht von Sekunde eins an: am alten Knopf in der Anbieterseite erschien er
 * ab neunzig Prozent (NEXT_EPISODE_PROMPT_PERCENT) und blieb bis zum Ende
 * stehen. Der Player zeigte ihn die ganze Folge lang - eine Einladung, in der
 * dritten Minute versehentlich weiterzuspringen.
 *
 * Die Zahl kommt aus dem Auftrag, damit sie nicht an zwei Stellen steht.
 */
let weiterAbProzent = 90;

function weiterKnopfZeigen() {
  if (!naechste) {
    knopfWeiter.hidden = true;
    return;
  }
  const dauer = Number(bild.duration);
  const prozent = Number.isFinite(dauer) && dauer > 0
    ? (bild.currentTime / dauer) * 100
    : 0;
  // Ohne obere Grenze: sonst verschwindet er in den letzten Sekunden wieder,
  // bevor der Uebergang greift. Dieselbe Ueberlegung wie drueben.
  const dran = prozent >= weiterAbProzent;
  if (dran && knopfWeiter.hidden) {
    // Einmal, beim Erreichen der Schwelle: die Karte soll auffallen, auch wenn
    // die Leiste gerade weg ist. Danach richtet sie sich nach den Schichten.
    knopfWeiter.hidden = false;
    schichtenZeigen();
  } else if (!dran) {
    knopfWeiter.hidden = true;
  }
}

/*
 * Was oben steht.
 *
 * "Attack on Titan · Staffel 4 Folge 13" sagt, wo man ist - aber nicht, was
 * man sieht. Der Name der Folge steht in der Folgenliste und kommt mit ihr
 * nach; bis dahin bleibt die Zeile eben kuerzer. Nachgeschoben wird nur, was
 * wirklich ankommt: ein leerer Name aendert nichts.
 */
let kopfBasis = "";

function kopfTitelSetzen(basis, folgentitel) {
  if (basis) kopfBasis = basis;
  const name = String(folgentitel || "").trim();
  document.getElementById("titel").textContent = name
    ? `${kopfBasis} · ${name}`
    : kopfBasis;
}

function naechsteSetzen(wert) {
  naechste = wert && wert.url ? wert : null;
  weiterKnopfZeigen();
  if (naechste) {
    knopfWeiter.title = `Nächste Folge: ${naechste.beschriftung || ""}`;
    document.getElementById("weiterKnopfTitel").textContent = naechste.beschriftung || "";
  }
}

/**
 * Der Uebergang.
 *
 * Sichtbar heruntergezaehlt, damit ein Abbruch moeglich bleibt - wer den
 * Abspann sehen will, soll ihn sehen. Und ohne naechste Folge passiert gar
 * nichts: das Ende einer Serie ist kein Fehler.
 */
function weiterAnbieten() {
  if (weiterVerworfen) return;
  // Ohne Zaehler passiert nichts von selbst - der Knopf "Nächste ›" steht
  // trotzdem da, genau wie es die Einstellung verspricht.
  if (!naechste || weiterUhr || weiterZaehler <= 0) return;
  weiterRest = weiterZaehler;
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

/*
 * Der Autoplay-Schalter.
 *
 * Er zeigt, was gilt, und schaltet um. Entschieden wird drueben - zurueck
 * kommt der neue Zaehler, also dieselbe Zahl, nach der sich auch der Uebergang
 * richtet. Null heisst aus.
 */
function autoZeigen() {
  const an = weiterZaehler > 0;
  knopfAuto.classList.toggle("aus", !an);
  // Der Zustand steht im Wort und nicht nur in der Farbe: "Autoplay an" ist
  // ohne Nachdenken zu lesen, ein blasses "Auto" nicht - erst recht nicht
  // neben der Qualitaetswahl, die ebenfalls "Automatisch" anbietet.
  knopfAuto.textContent = an ? "Autoplay an" : "Autoplay aus";
  knopfAuto.setAttribute("aria-pressed", an ? "true" : "false");
  knopfAuto.title = an
    ? "Nächste Folge startet von selbst - zum Abschalten klicken"
    : "Nächste Folge startet nicht von selbst - zum Einschalten klicken";
}

async function autoUmschalten() {
  const neuerZaehler = await bruecke.autoplay(weiterZaehler <= 0);
  weiterZaehler = Number(neuerZaehler) || 0;
  if (weiterZaehler > 0) weiterVerworfen = false;
  if (weiterZaehler <= 0) weiterAbbrechen();
  autoZeigen();
}

async function schlussUmschalten() {
  const neuerZaehler = await bruecke.schlussNachFolge(true);
  weiterZaehler = Number(neuerZaehler) || 0;
  weiterAbbrechen();
  autoZeigen();
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
knopfMarke.addEventListener("click", markeNutzen);
document.getElementById("weiterJetzt").addEventListener("click", () => {
  const ziel = naechste?.url || "";
  weiterAbbrechen();
  folgeWechseln(ziel);
});
document.getElementById("weiterAbbruch").addEventListener("click", () => {
  weiterVerworfen = true;
  weiterAbbrechen();
});
document.getElementById("weiterSchluss").addEventListener("click", schlussUmschalten);
knopfAuto.addEventListener("click", autoUmschalten);
bild.addEventListener("click", spielenUmschalten);

regler.addEventListener("input", () => {
  if (!Number.isFinite(bild.duration) || bild.duration <= 0) return;
  const von = bild.currentTime;
  bild.currentTime = (Number(regler.value) / 1000) * bild.duration;
  // Die Zaehlung darf einen Sprung nicht mitzaehlen - sonst waere der Regler
  // eine Abkuerzung zum "geschaut" der ganzen Serie.
  vorigeStelle = bild.currentTime;
  bruecke.sprung(von, bild.currentTime, false);
  tatMelden("seek");
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
fassungWahl.addEventListener("change", () => fassungWechseln(fassungWahl.value));
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
  else if (taste === "s") markeNutzen();
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
  markeZeigen(stelle);
  if (Number.isFinite(bild.duration) && bild.duration > 0) {
    regler.value = String(Math.round((stelle / bild.duration) * 1000));
    reglerFaerben(stelle);
    weiterKnopfZeigen();
    // Der Uebergang faengt vor dem letzten Bild an - der Abspann laeuft weiter,
    // waehrend der Kasten schon dasteht. Wer ihn wegklickt, sieht ihn zu Ende.
    if (naechste && weiterZaehler > 0 && bild.duration - stelle <= weiterZaehler + 1) weiterAnbieten();
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
  tatMelden("play");
  schichtenZeigen();
});
bild.addEventListener("pause", () => {
  knopfSpielen.textContent = "▶";
  standMelden(true);
  // Das Ende ist keine Pause, die man an die anderen meldet - sie kommen von
  // selbst dorthin, und der Uebergang zur naechsten Folge macht den Rest.
  if (!bild.ended) tatMelden("pause");
  schichtenZeigen();
});
bild.addEventListener("waiting", () => { puffert = true; pufferZeigen(true); });
bild.addEventListener("playing", () => { puffert = false; pufferZeigen(false); });
// Der Puffer waechst auch, wenn die Stelle stillsteht - etwa in der Pause.
bild.addEventListener("progress", () => reglerFaerben(bild.currentTime));
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
  // Eine vorgeladene Folge steht und wartet. Das Bild ist da, die Leiste zeigt
  // die Laenge - es fehlt nur der Druck auf Start.
  if (vorgeladen) {
    pufferZeigen(false);
    schichtenZeigen();
    return;
  }
  bild.play().catch(() => {
    // Ohne Zutun kein Ton: dann steht der Film eben und wartet auf einen
    // Klick. Ein Fehler ist das nicht.
    pufferZeigen(false);
    schichtenZeigen();
  });
});

/*
 * Die drei Zonen des Balkens.
 *
 * Gespielt bis zur Stelle, geladen bis zum Ende des Puffers, dahinter die
 * Spur. Genommen wird der Pufferbereich, in dem die Stelle gerade liegt - und
 * nicht der letzte oder groesste: nach einem Sprung stehen mehrere in der
 * Liste, und die anderen sagen ueber das, was jetzt laeuft, nichts.
 */
function reglerFaerben(stelle) {
  const dauer = Number(bild.duration);
  if (!Number.isFinite(dauer) || dauer <= 0) return;

  let geladenBis = stelle;
  for (let i = 0; i < bild.buffered.length; i += 1) {
    if (bild.buffered.start(i) <= stelle && bild.buffered.end(i) >= stelle) {
      geladenBis = bild.buffered.end(i);
      break;
    }
  }
  const anteil = (wert) => `${Math.max(0, Math.min(100, (wert / dauer) * 100))}%`;
  regler.style.setProperty("--gespielt", anteil(stelle));
  regler.style.setProperty("--geladen", anteil(geladenBis));
}

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
  // "Automatisch" und nicht "Auto": daneben sitzt der Autoplay-Schalter, und
  // zweimal "Auto" nebeneinander erklaert keines von beiden.
  auto.textContent = "Automatisch";
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
  vorgeladen = Boolean(auftrag.vorladen);
  gelaufen = 0;
  vorigeStelle = 0;
  gerettet = { netz: false, medium: false };
  weiterAbbrechen();
  weiterVerworfen = false;

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

  kopfTitelSetzen(auftrag.titel || "Wiedergabe", auftrag.folgentitel || "");
  document.getElementById("hoster").textContent = [auftrag.hoster, auftrag.stufe].filter(Boolean).join(" · ");
  fehlerKasten.hidden = true;
  pufferZeigen(true);
  hosterSetzen(auftrag.hosterliste, auftrag.link);
  untertitelSetzen([]);
  naechsteSetzen(auftrag.naechste);
  weiterAbProzent = Number.isFinite(Number(auftrag.weiterAbProzent))
    ? Number(auftrag.weiterAbProzent)
    : 90;
  weiterZaehler = Number.isFinite(Number(auftrag.weiterZaehler))
    ? Math.max(0, Number(auftrag.weiterZaehler))
    : WEITER_SEKUNDEN;
  autoZeigen();
  marke = auftrag.marke || null;
  knopfMarke.hidden = true;
  inRunde = Boolean(auftrag.runde);
  ausRundeBis = 0;
  puffert = false;
  // Die Liste bleibt, ihre Markierung nicht: welche Folge laeuft, steht im
  // Stand und nicht im Auftrag - also wird sie beim naechsten Aufklappen neu
  // geholt.
  folgenStand = null;

  // Der Player vor dem Video: die Quelle wird noch gesucht. Er steht schon da,
  // damit die Flaeche nicht leer bleibt, waehrend im Hintergrund die Seite
  // geladen und die Adresse aufgeloest wird.
  if (auftrag.laden) {
    pufferZeigen(true);
    document.getElementById("hoster").textContent = "Quelle wird gesucht …";
    return;
  }

  // Der Player ohne Video: eine Serie ist geoeffnet, aber keine Folge gewaehlt.
  // Das ist kein Fehler, sondern der Anfang - also steht die Liste offen da
  // statt einer Fehlermeldung.
  if (auftrag.auswahl) {
    pufferZeigen(false);
    document.getElementById("hoster").textContent = "Folge wählen";
    folgenZeigen();
    return;
  }

  if (!auftrag.adresse) {
    aufgeben("Es kam keine Adresse an.", "ohne-adresse");
    return;
  }

  if (auftrag.typ === "hls") hlsStarten(auftrag.adresse);
  else bild.src = auftrag.adresse;

  // Vorgeladen: die Quelle haengt am Video, die Liste bleibt offen. Gestartet
  // wird von Hand - oder gar nicht, wenn eine andere Folge gewaehlt wird.
  if (vorgeladen) folgenZeigen();

  schichtenZeigen();
}

bruecke.aufAuftrag(starten);
bruecke.aufNaechste((wert, folgentitel) => {
  naechsteSetzen(wert);
  // Der Name der Folge kommt mit derselben Nachricht - die Liste kennt beides.
  if (folgentitel) kopfTitelSetzen("", folgentitel);
});
bruecke.aufMarke((neue) => { marke = neue || null; });
bruecke.aufSteuern(steuernAusRunde);

/**
 * Der Takt der Runde.
 *
 * Einmal je Sekunde, und nur wenn ueberhaupt eine Runde laeuft. Er ist die
 * Grundlage der Driftmessung drueben: ohne ihn wuesste niemand, wo dieses
 * Geraet steht, und die Leiste zeigte "woanders".
 */
setInterval(() => {
  if (!inRunde) return;
  bruecke.takt({
    auftragId: auftrag?.id,
    stelle: Number(bild.currentTime) || 0,
    laeuft: !bild.paused && !bild.ended,
    puffert
  });
}, 1000);
bruecke.bereit();
