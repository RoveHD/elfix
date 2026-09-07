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
  sprung() {}, takt() {}, aktion() {}, aufLeiste() {}, tempo() {}, aufTempo() {}
};

/* --------------------------------------------------------- Das Auswahlfeld
 *
 * Fuenf Felder in der Leiste - Fassung, Hoster, Untertitel, Qualitaet, Tempo -
 * waren bis hierher ganz gewoehnliche <select>. Drei Dinge sprachen dagegen,
 * und alle drei waren zu sehen:
 *
 *   1. Das aufgeklappte Menue eines <select> ist ein Fenster des Systems und
 *      nicht Teil der Seite. Der Player laeuft in einer WebContentsView, die
 *      im Fenster verschoben sitzt - das Menue landete daneben, und "Tempo
 *      auswaehlen" ging schlicht nicht.
 *   2. Kopf und Leiste blenden sich nach 2,8 Sekunden aus. Solange ein
 *      Systemmenue offensteht, kommt keine Mausbewegung mehr in der Seite an;
 *      die Leiste ging also weg, waehrend man noch waehlte, und nahm das Feld
 *      mit.
 *   3. Am Fernseher gibt es keine Maus. In ein Systemmenue kommt ein
 *      Steuerkreuz nicht hinein.
 *
 * Also ein eigenes Feld. Nach aussen sieht es aus wie ein <select> - `value`,
 * `disabled`, `hidden`, `appendChild(option)`, `addEventListener("change")` -,
 * damit die Stellen, die es fuellen, unveraendert bleiben konnten. Nach innen
 * ist es ein Knopf mit einer Liste, die der Seite gehoert: sie haelt die
 * Leiste wach, sie laesst sich mit Pfeiltasten und OK bedienen, und sie sieht
 * aus wie die Blende auf Android.
 */

/** Alle offenen Menues - fuer die Frage, ob die Leiste stehenbleiben muss. */
const wahlOffene = new Set();

/** Steht gerade ein Menue offen? Dann ruehrt sich weder Leiste noch Tastatur. */
function wahlOffen() {
  return wahlOffene.size > 0;
}

function wahlAlleZu() {
  for (const wahl of [...wahlOffene]) wahl.zu(false);
}

class Wahl {
  /**
   * @param id     die Kennung des Platzhalters in spieler.html
   * @param titel  die Ueberschrift im Menue und der Text, wenn nichts gewaehlt ist
   */
  constructor(id, titel) {
    this.wurzel = document.getElementById(id);
    this.titelText = titel;
    this.eintraege = [];
    this._wert = "";
    this._aus = false;
    this.beiWechsel = [];

    this.knopf = document.createElement("button");
    this.knopf.type = "button";
    this.knopf.className = "wahlKnopf";
    this.text = document.createElement("span");
    this.text.className = "wahlText";
    const pfeil = document.createElement("span");
    pfeil.className = "wahlPfeil";
    pfeil.textContent = "\u25BE";
    pfeil.setAttribute("aria-hidden", "true");
    this.knopf.append(this.text, pfeil);

    this.menue = document.createElement("div");
    this.menue.className = "wahlMenue";
    this.menue.hidden = true;
    this.wurzel.append(this.knopf, this.menue);
    // Der Rueckweg vom Platzhalter zum Feld. Er kostet nichts und macht das
    // Feld von aussen sichtbar - die Pruefungen fassen es darueber an, so wie
    // sie vorher das <select> selbst angefasst haben.
    this.wurzel.wahl = this;

    this.knopf.addEventListener("click", (ereignis) => {
      ereignis.stopPropagation();
      if (this._aus) return;
      if (this.offen()) this.zu(true);
      else this.auf();
    });
    // Pfeile und OK machen auf. Beides ausdruecklich und nicht ueber den
    // Klick, den ein Knopf von selbst aus Enter macht: die Leertaste gehoert
    // sonst dem Player (Abspielen), und am Fernseher kommt OK als Enter an.
    this.knopf.addEventListener("keydown", (ereignis) => {
      const auf = ereignis.key === "ArrowUp" || ereignis.key === "ArrowDown"
        || ereignis.key === "Enter" || ereignis.key === " ";
      if (!auf) return;
      ereignis.preventDefault();
      ereignis.stopPropagation();
      if (!this._aus) this.auf();
    });
    this.beschriften();
  }

  /* --- Was die fuellenden Stellen von einem <select> erwarten --- */

  set textContent(wert) {
    if (String(wert) !== "") return;
    this.eintraege = [];
    this.beschriften();
  }

  appendChild(option) {
    this.eintraege.push({
      wert: String(option.value),
      text: String(option.textContent || ""),
      aus: Boolean(option.disabled)
    });
    this.beschriften();
    return option;
  }

  get value() { return this._wert; }

  set value(wert) {
    const text = String(wert);
    // Wie beim <select>: ein Wert, den es nicht gibt, waehlt nichts aus.
    this._wert = this.eintraege.some((eintrag) => eintrag.wert === text) ? text : "";
    this.beschriften();
    if (this.offen()) this.zeichnen();
  }

  get disabled() { return this._aus; }

  set disabled(wert) {
    this._aus = Boolean(wert);
    this.knopf.disabled = this._aus;
    this.wurzel.classList.toggle("aus", this._aus);
    if (this._aus) this.zu(false);
  }

  set hidden(wert) {
    this.wurzel.hidden = Boolean(wert);
    if (wert) this.zu(false);
  }

  get hidden() { return this.wurzel.hidden; }

  set title(wert) { this.knopf.title = String(wert || ""); }

  addEventListener(art, rueckruf) {
    if (art === "change") this.beiWechsel.push(rueckruf);
  }

  /* --- Das Menue --- */

  beschriften() {
    const gewaehlt = this.eintraege.find((eintrag) => eintrag.wert === this._wert);
    this.text.textContent = gewaehlt ? gewaehlt.text : this.titelText;
    this.knopf.setAttribute("aria-label", this.titelText + ": " + this.text.textContent);
  }

  offen() { return !this.menue.hidden; }

  auf() {
    if (this._aus || this.wurzel.hidden) return;
    wahlAlleZu();
    this.zeichnen();
    this.menue.hidden = false;
    this.wurzel.classList.add("auf");
    wahlOffene.add(this);
    schichtenZeigen();
    const laufend = this.menue.querySelector("button.laeuft:not([disabled])");
    const erster = this.menue.querySelector("button:not([disabled])");
    (laufend || erster)?.focus();
  }

  /** @param zurueck ob der Knopf den Fokus zurueckbekommt - nach einer Tat ja, beim Aufraeumen nein. */
  zu(zurueck) {
    if (!this.offen()) {
      wahlOffene.delete(this);
      return;
    }
    this.menue.hidden = true;
    this.menue.replaceChildren();
    this.wurzel.classList.remove("auf");
    wahlOffene.delete(this);
    if (zurueck) this.knopf.focus();
    schichtenZeigen();
  }

  zeichnen() {
    const kopf = document.createElement("div");
    kopf.className = "wahlKopf";
    kopf.textContent = this.titelText;
    const stuecke = [kopf];
    for (const eintrag of this.eintraege) {
      const zeile = document.createElement("button");
      zeile.type = "button";
      const haken = document.createElement("span");
      haken.className = "wahlHaken";
      haken.textContent = eintrag.wert === this._wert ? "\u2713" : "";
      const name = document.createElement("span");
      name.textContent = eintrag.text;
      zeile.append(haken, name);
      if (eintrag.wert === this._wert) zeile.classList.add("laeuft");
      if (eintrag.aus) zeile.disabled = true;
      zeile.addEventListener("click", (ereignis) => {
        ereignis.stopPropagation();
        this.waehlen(eintrag.wert);
      });
      zeile.addEventListener("keydown", (ereignis) => this.taste(ereignis, eintrag.wert));
      stuecke.push(zeile);
    }
    this.menue.replaceChildren(...stuecke);
  }

  waehlen(wert) {
    const vorher = this._wert;
    this.value = wert;
    this.zu(true);
    if (this._wert !== vorher) for (const rueckruf of this.beiWechsel) rueckruf();
  }

  /**
   * Pfeile, OK, Escape.
   *
   * Das ist der ganze Grund, warum dieses Feld existiert: eine Fernbedienung
   * kennt genau diese Tasten, und ein Systemmenue kennt sie nicht.
   */
  taste(ereignis, wert) {
    // OK nimmt die Zeile. Ein <button> tut das von selbst, wenn Enter kommt -
    // aber nur, wenn der Druck als Klick durchgeht; die Leertaste gehoert
    // ausserdem dem Abspielen. Hier steht es deshalb ausgeschrieben.
    if (ereignis.key === "Enter" || ereignis.key === " ") {
      ereignis.preventDefault();
      ereignis.stopPropagation();
      this.waehlen(wert);
      return;
    }
    const zeilen = [...this.menue.querySelectorAll("button:not([disabled])")];
    const jetzt = zeilen.indexOf(document.activeElement);
    if (ereignis.key === "ArrowDown" || ereignis.key === "ArrowUp") {
      ereignis.preventDefault();
      ereignis.stopPropagation();
      const schritt = ereignis.key === "ArrowDown" ? 1 : -1;
      const ziel = (jetzt + schritt + zeilen.length) % zeilen.length;
      zeilen[ziel]?.focus();
      return;
    }
    if (ereignis.key === "Home" || ereignis.key === "End") {
      ereignis.preventDefault();
      ereignis.stopPropagation();
      (ereignis.key === "Home" ? zeilen[0] : zeilen[zeilen.length - 1])?.focus();
      return;
    }
    if (ereignis.key === "Escape" || ereignis.key === "ArrowRight" || ereignis.key === "ArrowLeft") {
      ereignis.preventDefault();
      ereignis.stopPropagation();
      this.zu(true);
    }
  }
}

const bild = document.getElementById("bild");
// currentTime can sit between two frames. Keep the actual presented PTS so
// Media3 and Chromium can select the same still image after pausing.
let dargestelltesBild = null;
const bildZeitMessbar = typeof bild.requestVideoFrameCallback === "function";
if (bildZeitMessbar) {
  const merken = (_, metadata) => {
    dargestelltesBild = Number.isFinite(metadata.mediaTime) ? metadata.mediaTime : null;
    bild.requestVideoFrameCallback(merken);
  };
  bild.requestVideoFrameCallback(merken);
  bild.addEventListener("emptied", () => { dargestelltesBild = null; });
}
function pausiertesBild() {
  return bild.paused && !bild.seeking && dargestelltesBild != null
    && Math.abs(dargestelltesBild - bild.currentTime) < .25 ? dargestelltesBild : undefined;
}
const regler = document.getElementById("regler");
const lautstaerke = document.getElementById("lautstaerke");
const stufenWahl = new Wahl("stufen", "Bildqualit\u00e4t");
const hosterWahl = new Wahl("hosterWahl", "Hoster");
const fassungWahl = new Wahl("fassungWahl", "Fassung");
const untertitelWahl = new Wahl("untertitel", "Untertitel");
const knopfSpielen = document.getElementById("spielen");
const knopfMitte = document.getElementById("mitteSpielen");
const knopfZurueck = document.getElementById("zurueck");
const knopfVor = document.getElementById("vor");
const tempoWahl = new Wahl("tempo", "Tempo");
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
const rundeLeiste = document.getElementById("runde");
const schichten = [
  document.getElementById("kopf"),
  document.getElementById("leiste"),
  // Die Teilnehmerleiste geht mit: sie steht ueber dem Bild, gehoert zur
  // Bedienung und nicht zum Film.
  rundeLeiste,
  // Die Karte zur naechsten Folge geht mit: sie steht ueber dem Bild, und ein
  // Knopf, der ueber einem laufenden Film dauerhaft stehenbleibt, stoert genau
  // so wie eine Leiste. Sichtbar wird sie beim Erreichen der Schwelle - danach
  // immer dann, wenn sich die Maus regt.
  document.getElementById("weiterKnopf"),
  // Und der Knopf in der Mitte: er gehoert zur Bedienung, nicht zum Film.
  knopfMitte
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
/**
 * Die erste HLS-Probe legt den Ursprung der Medienzeit fest.
 *
 * Beginnt hls.js direkt an einer gespeicherten Stelle, behandelt es den dort
 * zuerst gelesenen TS-Zeitstempel als Ursprung. Derselbe Film bekommt dann je
 * nach Einstieg eine andere Zeitachse. Darum wird Fragment null zuerst
 * gelesen; bis dessen INIT_PTS_FOUND darf kein Sprung hls.js zu einem spaeteren
 * Fragment schicken.
 */
let hlsAnker = null;
const HLS_ANKER_FRIST_MS = 12000;
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
/** Bin ich in dieser Runde der Host? Nur er stellt das Tempo fuer alle. */
let binHost = false;
/** Das laufende Tempo - in einer Runde das der Runde. */
let tempo = 1;
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
  spielenZeichnen();
}

/**
 * Die beiden Abspielknoepfe zeigen dasselbe: der in der Leiste und der in der
 * Mitte.
 *
 * Der in der Mitte tritt zurueck, sobald etwas Wichtigeres dort steht - der
 * Puffer oder ein Fehlerkasten. Beide liegen an derselben Stelle, und zwei
 * Dinge uebereinander beantworten die Frage "warum sehe ich nichts?" schlechter
 * als eines.
 */
function spielenZeichnen() {
  const pausiert = bild.paused && !startAusstehend;
  const zustand = pausiert ? "play" : "pause";
  const beschreibung = startAusstehend ? "Gemeinsamen Start abbrechen (Leertaste)"
    : pausiert ? "Abspielen (Leertaste)" : "Pause (Leertaste)";
  for (const knopf of [knopfSpielen, knopfMitte]) {
    if (knopf.getAttribute("data-play-state") !== zustand) {
      knopf.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
        + (pausiert ? '<path d="M8 5v14l11-7z"/>'
          : '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>')
        + '</svg>';
      knopf.setAttribute("data-play-state", zustand);
    }
    knopf.title = beschreibung;
    knopf.setAttribute("aria-label", beschreibung);
    knopf.setAttribute("aria-busy", String(startAusstehend));
  }
  knopfMitte.hidden = !puffer.hidden || !fehlerKasten.hidden;
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
  // Waehrend Pause, offener Liste, offenem Menue oder Fehler bleibt die Leiste
  // stehen: wer pausiert oder gerade waehlt, will etwas tun.
  ruheUhr = setTimeout(() => {
    if (!bild.paused && fehlerKasten.hidden && folgenPanel.hidden && !wahlOffen()) {
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

/**
 * Abspielen und Pause.
 *
 * In einer Runde faengt niemand allein an. Wer drueckt, bleibt stehen und
 * fragt die Runde nach einem Zeitpunkt; losgefahren wird dann gemeinsam. Vorher
 * lief der Ausloeser sofort los und die anderen holten auf - der Rueckstand war
 * die Laufzeit der Nachricht plus Springen und Puffern, und er blieb stehen.
 */
function spielenUmschalten() {
  if (inRunde && (startAusstehend || !bild.paused)) {
    pauseAnfordern();
    return;
  }
  if (!bild.paused) {
    bild.pause();
    return;
  }
  // Dieser Aufruf kommt vom Zuschauer. Die Echo-Sperre gilt nur fuer
  // Medienereignisse, nicht fuer einen Play-Klick direkt nach einer Pause.
  if (inRunde) {
    startAnfordern();
    return;
  }
  spielenJetzt();
}

/** Ohne bestaetigten Zeitpunkt bleibt die Runde angehalten. */
let startNotbremse = 0;
let startAusstehend = false;

function pauseAnfordern() {
  ++startAuftrag;
  startAusstehend = false;
  clearTimeout(startNotbremse);
  ausRundeBis = Date.now() + 900;
  bild.pause();
  bruecke.aktion("pause", Number(bild.currentTime) || 0);
  spielenZeichnen();
}

function startAnfordern() {
  clearTimeout(startNotbremse);
  startAusstehend = true;
  spielenZeichnen();
  bruecke.aktion("play", Number(bild.currentTime) || 0);
  // Ein Verbindungsproblem darf keinen einzelnen Zuschauer starten lassen.
  startNotbremse = setTimeout(() => {
    startAusstehend = false;
    spielenZeichnen();
  }, 10000);
  schichtenZeigen();
}

function spielenJetzt() {
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

async function springen(sekunden) {
  if (!lokalesSpulenErlaubt()) return;
  if (!Number.isFinite(bild.duration) || bild.duration <= 0) return;
  const von = bild.currentTime;
  const ziel = Math.min(Math.max(0, von + sekunden), bild.duration - 0.5);
  if (!await stelleSetzen(ziel)) return;
  bruecke.sprung(von, ziel, false);
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
async function markeNutzen() {
  if (!lokalesSpulenErlaubt()) return;
  if (!marke) return;
  const von = bild.currentTime;
  const ziel = Math.max(von + 1, marke.ziel);
  if (!await stelleSetzen(ziel)) return;
  bruecke.sprung(von, ziel, true);
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
  // Die Runde antwortet - die Notbremse wird nicht mehr gebraucht.
  clearTimeout(startNotbremse);
  ausRundeBis = Date.now() + 900;
  let stelle = Number(befehl.stelle);
  const frist = Number(befehl.startLokal) || (Date.now() + (Number(befehl.wartenMs) || 0));
  // Der Frame-Zeitstempel ist das sichtbare Standbild, currentTime kann
  // zwischen Bildern liegen. Nach der Startfrist gilt dagegen bereits die
  // um die Verspaetung erhoehte Wiedergabestelle.
  let frameZiel = null;
  if (typeof befehl.frameTime === "number" && Number.isFinite(befehl.frameTime)
    && befehl.frameTime >= 0 && Math.abs(befehl.frameTime - stelle) < .25
    && (!befehl.laufen || frist > Date.now())) {
    frameZiel = befehl.frameTime;
    stelle = frameZiel;
  }
  const warten = Math.max(0, frist - Date.now());
  const springbar = befehl.springen !== false && Number.isFinite(stelle) && stelle >= 0;
  // Ein verabredeter Start: springen, fertigmachen, und erst zum vereinbarten
  // Zeitpunkt loslassen - Host wie Gast, zur selben Serverzeit. Der Ausloeser
  // springt dabei nicht (er steht schon dort), wartet aber genauso.
  if (befehl.laufen && (befehl.startLokal || warten > 0)) {
    startVerabredet(stelle, warten, springbar, frist, frameZiel);
    return;
  }
  const meiner = ++startAuftrag;
  startAusstehend = Boolean(befehl.bereitId);
  spielenZeichnen();

  // Anhalten. Erst stehen, dann genau auf die Stelle - in dieser Reihenfolge,
  // sonst laeuft das Bild waehrend des Sprungs noch ein Stueck weiter.
  if (!befehl.laufen) {
    bild.pause();
    if (springbar) {
      const fertig = genauSetzen(stelle, befehl.genau !== false, meiner, true, frameZiel);
      if (befehl.bereitId) fertig.then(async (gesetzt) => {
        if (!gesetzt) return;
        const bereit = await bereitFuerStart(stelle, 2500);
        if (bereit && meiner === startAuftrag) bruecke.syncBereit?.(befehl.bereitId);
      });
    } else if (befehl.genau !== false) {
      /*
       * Der Host springt nicht auf die Stelle der Runde - er *ist* sie. Aber er
       * setzt sich auf seine eigene.
       *
       * Das klingt nach nichts und ist der Unterschied zwischen "dieselbe
       * Sekunde" und "dasselbe Bild". Ein Video, das im Laufen angehalten wird,
       * bleibt irgendwo zwischen zwei Bildern stehen - bei 302.435 etwa. Diese
       * Zahl geht an alle, die springen darauf und landen auf dem Bild
       * darunter, bei 302.400: ein Video kann nur Bilder zeigen, die es gibt.
       * Der Host bliebe als Einziger dazwischen.
       *
       * Gemessen mit drei Playern an einem echten Relay (standbildtest.js):
       * die Gaeste waren untereinander bitgleich, der Ausloeser lag jedes Mal
       * ein Bild daneben. Setzt er sich auf seine eigene Stelle, landet er auf
       * demselben Raster wie alle anderen - und meldet von da an auch diese
       * Zahl weiter.
       */
      genauSetzen(Number(bild.currentTime) || 0, true, meiner);
    }
    return;
  }

  const gesetzt = springbar
    ? genauSetzen(stelle, false, meiner, true, frameZiel)
    : hlsAnkerAbwarten(meiner);
  gesetzt.then((bereit) => {
    if (!bereit || meiner !== startAuftrag) return;
    bild.play().catch(() => {});
  });
}

/**
 * So nah muss die Stelle sitzen, damit es dasselbe Bild ist.
 *
 * Eine Millisekunde entspricht der Zeitaufloesung des nativen Players.
 * Fuer das gemeinsame Standbild wird zusaetzlich der echte Frame-PTS benutzt.
 */
const SEEK_TOLERANZ_S = 0.001;

/**
 * Genau auf eine Stelle - und nachsehen, ob es gesessen hat.
 *
 * `video.currentTime = x` ist keine Zuweisung, sondern der Anfang eines
 * Suchvorgangs. Wo er endet, steht erst hinterher fest: manche Quellen setzen
 * auf das naechste Schluesselbild auf, andere landen ein paar Hundertstel
 * daneben. Bisher hat das niemand nachgemessen - deshalb standen zwei Geraete
 * in derselben Sekunde und trotzdem auf verschiedenen Bildern.
 *
 * Also: setzen, das `seeked` abwarten, den wirklichen Wert lesen, und bei zu
 * grosser Abweichung **einmal** nachsetzen. Kein zweites Mal: ein Player, der
 * die Stelle zweimal verfehlt, trifft sie auch beim dritten Mal nicht, und
 * eine Schleife am Video ist schlimmer als ein Hundertstel Abweichung.
 */
async function genauSetzen(ziel, genau, meiner, vonRunde = true, frameZiel = null) {
  // Das Nachmessen dauert; solange gilt alles am Video als "kam von der Runde".
  // Nicht beim eigenen Anhalten: dort waere die Sperre eine Sperre gegen den
  // naechsten Knopfdruck des Zuschauers, und der soll wieder die Runde fragen.
  if (vonRunde) ausRundeBis = Math.max(ausRundeBis, Date.now() + 2500);
  const hatFrame = typeof frameZiel === "number" && Number.isFinite(frameZiel) && frameZiel >= 0;
  const sprungZiel = hatFrame ? frameSuchStelle(frameZiel) : ziel;
  if (!await stelleSetzen(sprungZiel, meiner)) return genauAbbrechen(meiner);
  if (!genau && !hatFrame) return true;

  await seekAbwarten();
  if (meiner !== startAuftrag) return false;
  if (Math.abs(Number(bild.currentTime) - sprungZiel) > SEEK_TOLERANZ_S) {
    bild.currentTime = sprungZiel;
    await seekAbwarten();
    if (meiner !== startAuftrag) return false;
  }
  if (hatFrame && !await dargestelltesBildAbwarten(frameZiel)) {
    return genauAbbrechen(meiner);
  }
  if (meiner !== startAuftrag) return false;
  vorigeStelle = Number(bild.currentTime) || 0;
  if (genau) standMelden(true);
  return true;
}

/** Eine misslungene Genauigkeitspruefung laesst keinen Wartezustand zurueck. */
function genauAbbrechen(meiner) {
  // Ein neuerer Auftrag besitzt seinen Zustand selbst und darf von einem
  // spaeten Ergebnis des alten nicht veraendert werden.
  if (meiner === startAuftrag && startAusstehend) {
    startAusstehend = false;
    spielenZeichnen();
  }
  return false;
}

/** Chromium sucht intern auf Millisekunden; die naechste volle liegt im Frame. */
function frameSuchStelle(frameZeit) {
  // Das kleine Epsilon verhindert, dass 299.591 als 299.59100000000007
  // versehentlich auf die darauffolgende Millisekunde aufgerundet wird.
  return Math.ceil(frameZeit * 1000 - 0.000001) / 1000;
}

/** Ein genauer Befehl gilt erst, wenn Chromium wirklich diesen Frame zeigt. */
function dargestelltesBildAbwarten(frameZeit, hoechstens = 800) {
  if (!bildZeitMessbar) return Promise.resolve(true);
  return new Promise((fertig) => {
    const bis = Date.now() + hoechstens;
    const pruefen = () => {
      const rechenEpsilon = Number.EPSILON
        * Math.max(1, Math.abs(dargestelltesBild || 0), Math.abs(frameZeit));
      if (dargestelltesBild !== null
        && Math.abs(dargestelltesBild - frameZeit) <= 0.000001 + rechenEpsilon) {
        return fertig(true);
      }
      if (Date.now() >= bis) return fertig(false);
      setTimeout(pruefen, 10);
    };
    pruefen();
  });
}

/** Wartet nur bei hls.js; MP4-Spruenge bleiben synchrone Zuweisungen. */
async function hlsAnkerAbwarten(meiner = null) {
  const anker = hlsAnker;
  if (!anker) return meiner === null || meiner === startAuftrag;
  const bereit = await anker.bereit;
  return bereit && anker.verankert && hlsAnker === anker
    && (meiner === null || meiner === startAuftrag);
}

/** Setzt eine Stelle erst, wenn HLS seine Zeitachse an Fragment null kennt. */
function stelleSetzen(ziel, meiner = null) {
  if (!hlsAnker) {
    if (meiner !== null && meiner !== startAuftrag) return Promise.resolve(false);
    bild.currentTime = ziel;
    vorigeStelle = ziel;
    return Promise.resolve(true);
  }
  return hlsAnkerAbwarten(meiner).then((bereit) => {
    if (!bereit) return false;
    bild.currentTime = ziel;
    vorigeStelle = ziel;
    return true;
  });
}

/** Auf das Ende eines Suchvorgangs warten - aber nicht ewig. */
function seekAbwarten(hoechstens = 1200) {
  if (!bild.seeking) return Promise.resolve(true);
  return new Promise((fertig) => {
    let erledigt = false;
    const abschliessen = (gesessen) => {
      if (erledigt) return;
      erledigt = true;
      bild.removeEventListener("seeked", beiSeeked);
      clearTimeout(uhr);
      fertig(gesessen);
    };
    const beiSeeked = () => abschliessen(true);
    // Sass die Stelle schon, kommt gar kein `seeked` - dann entscheidet die Uhr.
    bild.addEventListener("seeked", beiSeeked);
    const uhr = setTimeout(() => abschliessen(false), hoechstens);
  });
}

/**
 * Der gemeinsame Start.
 *
 * Zwischen "die Nachricht ist da" und "das erste Bild bewegt sich" liegen der
 * Sprung, das Puffern an der neuen Stelle und die Annahme von play(). Wer
 * sofort losfaehrt, ist um genau diese Spanne zu spaet - und bleibt es, denn
 * die Notbremse greift erst bei fuenf Sekunden Versatz.
 *
 * Deshalb: auf die Stelle springen, an der der Host in `wartenMs` stehen wird,
 * das Fertigmachen in diese Spanne legen und dann zum verabredeten Zeitpunkt
 * loslassen. Wer frueher fertig ist, wartet den Rest ab. Wer laenger braucht,
 * bekommt die Verspaetung an der Stelle gutgeschrieben - das ist billiger als
 * ein Rueckstand, der bleibt.
 */
let startAuftrag = 0;

async function startVerabredet(stelle, wartenMs, springen = true,
  startLokal = Date.now() + wartenMs, frameZiel = null) {
  const meiner = ++startAuftrag;
  startAusstehend = true;
  spielenZeichnen();
  // So lange gilt alles, was hier am Video geschieht, als "kam von der Runde" -
  // sonst meldete die Pause von gleich eine eigene Pause zurueck.
  ausRundeBis = Date.now() + wartenMs + 3200;
  const frist = startLokal;
  bild.pause();
  if (!await hlsAnkerAbwarten(meiner)) {
    if (meiner === startAuftrag) {
      startAusstehend = false;
      spielenZeichnen();
    }
    return;
  }
  if (springen && (frameZiel !== null
    || Math.abs(Number(bild.currentTime) - stelle) > SEEK_TOLERANZ_S)) {
    if (frameZiel !== null) {
      if (!await genauSetzen(stelle, true, meiner, true, frameZiel)) return;
    } else if (!await stelleSetzen(stelle, meiner)) return;
  }

  const bereit = await bereitFuerStart(springen ? stelle : Number(bild.currentTime) || 0, 2500);
  if (meiner !== startAuftrag) return;
  if (!bereit) {
    // A source can lose its buffer after acknowledging preparation. Pause the
    // round instead of letting this player start alone when buffering ends.
    if (inRunde) pauseAnfordern();
    else startAusstehend = false;
    return;
  }

  const rest = frist - Date.now();
  if (rest > 0) {
    await new Promise((fertig) => setTimeout(fertig, rest));
    if (meiner !== startAuftrag) return;
  }

  // Zu spaet fertig geworden? Dann fehlt genau die Verspaetung an der Stelle -
  // beim doppelten Tempo doppelt so viel Film. Nur nach vorn: etwas noch
  // einmal zu zeigen faellt auf, ein bisschen Vorsprung nicht.
  const zuspaet = (Date.now() - frist) / 1000;
  if (springen && zuspaet > 0.15) {
    if (!await stelleSetzen(stelle + zuspaet * tempo, meiner)) return;
  }
  startAusstehend = false;
  ausRundeBis = Date.now() + 900;
  bild.play().catch(() => {});
}

/** Sitzt der Sprung, und ist genug geladen? Hoechstens so lange wird gewartet. */
function bereitFuerStart(stelle, hoechstens) {
  return new Promise((fertig) => {
    const bis = Date.now() + hoechstens;
    const pruefen = () => {
      const nah = Math.abs(Number(bild.currentTime) - stelle) <= SEEK_TOLERANZ_S;
      if (nah && !bild.seeking && bild.readyState >= 3) return fertig(true);
      if (Date.now() > bis) return fertig(false);
      setTimeout(pruefen, 40);
    };
    pruefen();
  });
}

function fernSteuern(auftragFern) {
  const befehl = auftragFern.befehl;
  if (befehl === "pause") { if (inRunde) pauseAnfordern(); else bild.pause(); }
  else if (befehl === "abspielen") { if (bild.paused) spielenUmschalten(); }
  else if (befehl === "umschalten") spielenUmschalten();
  else if (befehl === "stumm") tonUmschalten();
  else if (befehl === "vollbild") bruecke.vollbild(true);
  else if (befehl === "folge") { folgeWechseln(auftragFern.url); return; }
  else if (befehl === "vor" || befehl === "zurueck") {
    springen(befehl === "vor" ? Number(auftragFern.vor) || 30
      : -(Number(auftragFern.zurueck) || 10));
  } else if (befehl === "lauter" || befehl === "leiser") {
    bild.volume = Math.max(0, Math.min(1, bild.volume + (befehl === "lauter" ? 0.1 : -0.1)));
    if (befehl === "lauter") bild.muted = false;
    lautstaerke.value = String(Math.round(bild.volume * 100));
    knopfTon.textContent = bild.muted || bild.volume === 0 ? "🔇" : "🔊";
  }
  standMelden(true);
  schichtenZeigen();
}

/**
 * Die eigene Tat an die Runde - aber nur, wenn es die eigene war.
 *
 * <h3>Warum der Ausloeser beim Anhalten selbst springt</h3>
 *
 * Weil er sonst als Einziger woanders steht. Gemessen mit drei Playern an einem
 * echten Relay (tests/standbildtest.js): der Host haelt bei 302.438 an und
 * schickt diese Zahl; alle anderen setzen sie und landen auf 302.400 - dem
 * Bild darunter, denn ein Video kann nur Bilder zeigen, die es gibt. Die Gaeste
 * waren dabei untereinander *bitgleich*; der Ausloeser war der Ausreisser, und
 * zwar jedes Mal.
 *
 * Die Zahl allein macht also noch kein gemeinsames Bild - erst der Sprung
 * darauf macht es. Wer die Zahl verschickt, geht deshalb denselben Weg wie
 * alle, die sie empfangen: er springt auf sie. Beim stehenden Bild kostet das
 * nichts, und es ist der einzige Weg, auf dem am Ende ueberall dasselbe steht.
 */
function tatMelden(aktion) {
  if (!inRunde || ausRunde()) return;
  const stelle = Number(bild.currentTime) || 0;
  bruecke.aktion(aktion, stelle);
  if (aktion === "pause") genauSetzen(stelle, true, ++startAuftrag, false);
}

function tonUmschalten() {
  bild.muted = !bild.muted;
  knopfTon.textContent = bild.muted || bild.volume === 0 ? "🔇" : "🔊";
}

/* ------------------------------------------------------------------ Das Tempo
 *
 * Eine feste Leiter von 0,5× bis 2×. In einer Runde gehoert sie dem Host: er
 * stellt sie fuer alle, bei den anderen steht sie nur noch da. Der Grund ist
 * derselbe wie beim Spulen - zwei Geraete mit verschiedenem Tempo laufen
 * unweigerlich auseinander, und kein Abgleich kann das einholen.
 */
const TEMPO_STUFEN = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** "0,5x" bis "2x" - mit Komma, weil die Oberflaeche deutsch ist. */
function tempoName(stufe) {
  return String(stufe).replace(".", ",") + "×";
}

// Die Leiter steht einmal im Feld und aendert sich nie. Frueher stand sie in
// spieler.html; seit das Feld der Seite gehoert, steht sie dort, wo auch die
// Stufen stehen - zwei Listen, die auseinanderlaufen koennen, waren es vorher.
for (const stufe of TEMPO_STUFEN) {
  const eintrag = document.createElement("option");
  eintrag.value = String(stufe);
  eintrag.textContent = tempoName(stufe);
  tempoWahl.appendChild(eintrag);
}
tempoWahl.value = "1";

/** Auf eine der Stufen zwingen. Was hereinkommt, kommt aus einer Nachricht. */
function tempoStufe(wert) {
  const zahl = Number(wert);
  if (!Number.isFinite(zahl) || zahl <= 0) return 1;
  return TEMPO_STUFEN.reduce((beste, stufe) => (
    Math.abs(stufe - zahl) < Math.abs(beste - zahl) ? stufe : beste
  ), 1);
}

/**
 * Das Tempo setzen.
 *
 * `melden` unterscheidet die eigene Tat von der Anweisung der Runde: was von
 * dort kam, geht nicht zurueck - sonst haette jede Einstellung ein Echo.
 */
function tempoSetzen(wert, melden) {
  tempo = tempoStufe(wert);
  bild.playbackRate = tempo;
  bild.defaultPlaybackRate = tempo;
  tempoWahl.value = String(tempo);
  if (melden) bruecke.tempo(tempo);
}

/** Eine Stufe hoch oder runter - fuer die Tastatur. */
function tempoSchieben(richtung) {
  if (tempoWahl.disabled) return;
  const jetzt = TEMPO_STUFEN.indexOf(tempoStufe(tempo));
  const naechster = Math.max(0, Math.min(TEMPO_STUFEN.length - 1, jetzt + richtung));
  if (naechster === jetzt) return;
  tempoSetzen(TEMPO_STUFEN[naechster], true);
  schichtenZeigen();
}

/**
 * Wer das Tempo stellen darf.
 *
 * Allein: immer. In einer Runde: nur der Host. Abgeschaltet steht es trotzdem
 * da - man soll sehen, womit die Runde laeuft, und warum man es nicht aendern
 * kann.
 */
function tempoRechteSetzen() {
  const gesperrt = inRunde && !binHost;
  tempoWahl.disabled = gesperrt;
  tempoWahl.title = gesperrt
    ? "In einer Runde stellt der Host das Tempo"
    : "Tempo (Shift + , und Shift + .)";
  spulenRechteSetzen();
}

/** Nur der Host veraendert in einer Runde die gemeinsame Wiedergabestelle. */
function lokalesSpulenErlaubt() {
  return !inRunde || binHost;
}

/** Zeigt Gaesten schon an den Bedienelementen, wem die Stelle gehoert. */
function spulenRechteSetzen() {
  const gesperrt = !lokalesSpulenErlaubt();
  regler.disabled = gesperrt;
  regler.title = gesperrt ? "Spulen steuert der Host" : "Stelle";
  knopfZurueck.disabled = gesperrt;
  knopfZurueck.title = gesperrt ? "Spulen steuert der Host" : "10 Sekunden zurück";
  knopfVor.disabled = gesperrt;
  knopfVor.title = gesperrt ? "Spulen steuert der Host" : "10 Sekunden vor";
  knopfMarke.disabled = gesperrt;
  knopfMarke.title = gesperrt ? "Spulen steuert der Host" : "Intro überspringen";
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
  // Erst den Fehlerkasten weg, dann den Puffer zeigen: pufferZeigen richtet
  // sich nach ihm (und der Knopf in der Mitte nach beiden).
  fehlerKasten.hidden = true;
  pufferZeigen(true);
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
  // Erst den Fehlerkasten weg, dann den Puffer zeigen: pufferZeigen richtet
  // sich nach ihm (und der Knopf in der Mitte nach beiden).
  fehlerKasten.hidden = true;
  pufferZeigen(true);
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
knopfMitte.addEventListener("click", spielenUmschalten);
knopfZurueck.addEventListener("click", () => springen(-10));
knopfVor.addEventListener("click", () => springen(10));
document.getElementById("ton").addEventListener("click", tonUmschalten);
document.getElementById("gross").addEventListener("click", () => bruecke.vollbild(true));
document.getElementById("zu").addEventListener("click", () => beenden("knopf"));
document.getElementById("zurueckZumHoster").addEventListener("click", () => {
  fehlerKasten.hidden = true;
  spielenZeichnen();
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
bild.addEventListener("click", () => {
  // Ein Klick, der nur ein offenes Menue wegnehmen soll, haelt nicht auch noch
  // den Film an. Das Menue geht weg, mehr nicht - der naechste Klick spielt.
  if (wahlOffen()) { wahlAlleZu(); return; }
  spielenUmschalten();
});

regler.addEventListener("input", async () => {
  if (!lokalesSpulenErlaubt()) return;
  if (!Number.isFinite(bild.duration) || bild.duration <= 0) return;
  const von = bild.currentTime;
  const ziel = (Number(regler.value) / 1000) * bild.duration;
  if (!await stelleSetzen(ziel)) return;
  // Die Zaehlung darf einen Sprung nicht mitzaehlen - sonst waere der Regler
  // eine Abkuerzung zum "geschaut" der ganzen Serie.
  bruecke.sprung(von, ziel, false);
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
tempoWahl.addEventListener("change", () => tempoSetzen(tempoWahl.value, true));
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
// Ein Klick daneben macht das offene Menue zu - das erwartet jeder, und ohne
// es bliebe es stehen, bis man den Knopf noch einmal traefe.
document.addEventListener("click", () => wahlAlleZu());
document.addEventListener("keydown", (ereignis) => {
  schichtenZeigen();
  // Steht ein Menue offen, gehoeren die Tasten ihm. Pfeile, OK und Escape hat
  // es schon abgefangen (Wahl.taste); alles Uebrige - Leertaste, f, e - taete
  // hinter dem Menue etwas, das gerade niemand sehen kann.
  if (wahlOffen()) {
    if (ereignis.key === "Escape") wahlAlleZu();
    return;
  }
  const taste = ereignis.key;
  if (taste === " " || taste === "k") { ereignis.preventDefault(); spielenUmschalten(); }
  else if (taste === "ArrowLeft") springen(-10);
  else if (taste === "ArrowRight") springen(10);
  else if (taste === "ArrowUp") { lautstaerke.value = String(Math.min(100, Number(lautstaerke.value) + 5)); lautstaerke.dispatchEvent(new Event("input")); }
  else if (taste === "ArrowDown") { lautstaerke.value = String(Math.max(0, Number(lautstaerke.value) - 5)); lautstaerke.dispatchEvent(new Event("input")); }
  else if (taste === "<" || taste === ",") tempoSchieben(-1);
  else if (taste === ">" || taste === ".") tempoSchieben(1);
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
  pufferZeigen(false);
  standMelden(true);
  tatMelden("play");
  schichtenZeigen();
});
bild.addEventListener("pause", () => {
  spielenZeichnen();
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
bild.addEventListener("loadedmetadata", async () => {
  anzeigeDauer.textContent = zeit(bild.duration);
  // Eine neue Quelle faengt bei einfachem Tempo an - auch mitten in einer
  // Runde, die auf 2x laeuft. Also hier wieder daraufsetzen, und zwar bei
  // *jedem* loadedmetadata: der Hosterwechsel ist genau der Fall.
  if (bild.playbackRate !== tempo) tempoSetzen(tempo, false);
  if (startGesetzt) return;
  startGesetzt = true;
  // Nicht am Ende: wer eine Folge zu neunundneunzig Prozent gesehen hat, will
  // sie von vorn und nicht die letzten zehn Sekunden.
  const start = Number(auftrag?.startzeit) || 0;
  if (start > 5 && Number.isFinite(bild.duration) && start < bild.duration - 20) {
    if (!await stelleSetzen(start)) return;
  } else if (!await hlsAnkerAbwarten()) {
    return;
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
  if (stufen.length > 1) {
    const beste = stufen.reduce((bester, stufe, nummer) => (
      (stufe.height || 0) > (stufen[bester].height || 0) ? nummer : bester
    ), 0);
    if (hls) hls.currentLevel = beste;
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
  const instanz = new Hls({
    // Der erste gelesene Medienzeitstempel muss immer aus Fragment null
    // stammen. Sonst verschiebt ein Direkteinstieg die gesamte HLS-Zeitachse.
    autoStartLoad: false,
    startPosition: 0,
    testBandwidth: false,
    // Grosszuegig puffern: die Auslieferung der Hoster ist unstet, und ein
    // Nachladen mitten im Satz faellt mehr auf als ein paar Megabyte mehr.
    maxBufferLength: 60,
    backBufferLength: 30,
    startLevel: -1
  });
  hls = instanz;
  const anker = hlsAnkerErzeugen(instanz);
  instanz.on(Hls.Events.INIT_PTS_FOUND, (_ereignis, daten) => {
    if (hls !== instanz || (daten?.id && daten.id !== "main")) return;
    anker.beenden(true);
  });
  instanz.on(Hls.Events.MANIFEST_PARSED, (_ereignis, daten) => {
    if (hls !== instanz) return;
    stufenSetzen(daten.levels || []);
    untertitelSetzen(daten.subtitleTracks || instanz.subtitleTracks || []);
    instanz.startLoad(0);
  });
  instanz.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_ereignis, daten) => {
    if (hls !== instanz) return;
    untertitelSetzen(daten.subtitleTracks || []);
  });
  instanz.on(Hls.Events.LEVEL_SWITCHED, (_ereignis, daten) => {
    if (hls !== instanz) return;
    if (stufenWahl.value !== "-1") stufenWahl.value = String(daten.level);
  });
  instanz.on(Hls.Events.ERROR, (_ereignis, daten) => {
    if (hls !== instanz) return;
    if (!daten.fatal) return;
    // Ein Netzfehler und ein Medienfehler haben je einen Versuch. Der zweite
    // desselben Fehlers ist keiner mehr, sondern eine Schleife.
    if (daten.type === Hls.ErrorTypes.NETWORK_ERROR && !gerettet.netz) {
      gerettet.netz = true;
      instanz.startLoad(anker.verankert ? -1 : 0);
      return;
    }
    if (daten.type === Hls.ErrorTypes.MEDIA_ERROR && !gerettet.medium) {
      gerettet.medium = true;
      instanz.recoverMediaError();
      return;
    }
    anker.beenden(false);
    // Auch ein bereits gesetzter Anker kann spaeter endgueltig scheitern.
    // Laufende Vorbereitungen und Startuhren duerfen danach nicht aus einem
    // Fehlerbild heraus doch noch play() aufrufen.
    ++startAuftrag;
    startAusstehend = false;
    clearTimeout(startNotbremse);
    spielenZeichnen();
    aufgeben("Die Playlist des Hosters bricht ab.", `hls-${daten.details || daten.type}`);
  });
  instanz.loadSource(adresse);
  instanz.attachMedia(bild);
}

/** Eine neue Quelle beendet alle Wartenden der alten, ohne spaeter zu springen. */
function hlsAnkerZuruecksetzen() {
  if (hlsAnker) hlsAnker.beenden(false);
  hlsAnker = null;
}

/** Oeffnet die Schranke bis hls.js den ersten Hauptstream-Zeitstempel meldet. */
function hlsAnkerErzeugen(instanz) {
  hlsAnkerZuruecksetzen();
  let fertig;
  let erledigt = false;
  let uhr = 0;
  const anker = {
    instanz,
    verankert: false,
    bereit: new Promise((resolve) => { fertig = resolve; }),
    beenden(erfolg) {
      // false widerruft auch einen bereits gemeldeten Erfolg. Das Versprechen
      // ist dann zwar schon erfuellt, doch hlsAnkerAbwarten prueft zusaetzlich
      // diesen Zustand und laufende Startauftraege werden invalidiert.
      if (erledigt) {
        if (!erfolg) anker.verankert = false;
        return;
      }
      erledigt = true;
      anker.verankert = Boolean(erfolg);
      clearTimeout(uhr);
      fertig(anker.verankert);
    }
  };
  hlsAnker = anker;
  uhr = setTimeout(() => {
    if (hlsAnker !== anker || anker.verankert) return;
    anker.beenden(false);
    try { instanz.stopLoad(); } catch (_) {}
    aufgeben("Die Zeitachse der Playlist konnte nicht gelesen werden.", "hls-zeitanker");
  }, HLS_ANKER_FRIST_MS);
  return anker;
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
  hlsAnkerZuruecksetzen();

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
  ++startAuftrag;
  startAusstehend = false;
  clearTimeout(startNotbremse);
  binHost = Boolean(auftrag.rundeHost);
  // Das Tempo der Runde gilt ab der ersten Sekunde - auch fuer den, der gerade
  // erst dazukommt. Gemeldet wird es dabei nicht: es kam ja von dort.
  tempoSetzen(inRunde ? auftrag.rundeTempo : tempo, false);
  tempoRechteSetzen();
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
// Das Tempo der Runde: gesetzt wird es hier, gemeldet wird nichts zurueck.
bruecke.aufTempo((wert, host) => {
  binHost = Boolean(host);
  tempoSetzen(wert, false);
  tempoRechteSetzen();
});

/**
 * Der Takt der Runde.
 *
 * Einmal je Sekunde, und nur wenn ueberhaupt eine Runde laeuft. Er ist die
 * Grundlage der Driftmessung drueben: ohne ihn wuesste niemand, wo dieses
 * Geraet steht, und die Leiste zeigte "woanders".
 */
/**
 * Wer sonst noch bei dieser Folge sitzt.
 *
 * Dieselben Marken wie im Hoster-Rahmen (watchpartyLeisteScript in main.js):
 * Zeichen, Name, "HOST", Uhr. Der Hauptprozess schickt sie fertig - gerechnet
 * wird hier nichts, damit nicht zwei Uhren gegeneinander laufen.
 *
 * Allein in der Runde bleibt sie weg: eine Leiste, auf der nur "Du" steht,
 * beantwortet keine Frage.
 */
let rundeBild = "";

function zeichneRunde(leute) {
  const dabei = Array.isArray(leute) ? leute : [];
  // Die Rollenmeldung kommt mit jedem Leistentakt, auch wenn nur eine Person
  // im Raum ist und die Leiste deshalb unsichtbar bleibt. Ohne dieses Update
  // behielte ein neuer Host bis zur naechsten Tempoaenderung die Gastrechte.
  const ich = dabei.find((person) => person?.me);
  if (inRunde && ich && binHost !== Boolean(ich.host)) {
    binHost = Boolean(ich.host);
    tempoRechteSetzen();
  }
  if (!rundeLeiste) return;
  rundeLeiste.hidden = dabei.length < 2;
  if (rundeLeiste.hidden) {
    rundeLeiste.replaceChildren();
    return;
  }
  rundeLeiste.replaceChildren(...dabei.map((person) => {
    const marke = document.createElement("span");
    marke.className = "rundeMarke";
    marke.classList.toggle("ich", Boolean(person.me));
    marke.classList.toggle("haelt", Boolean(person.paused));
    marke.classList.toggle("fuehrt", Boolean(person.host));

    const zeichen = document.createElement("span");
    zeichen.className = "rundeZeichen";
    zeichen.textContent = person.paused ? "❚❚" : "▶";

    const name = document.createElement("span");
    name.className = "rundeName";
    name.textContent = person.name || "Gerät";
    marke.append(zeichen, name);

    if (person.host) {
      const host = document.createElement("span");
      host.className = "rundeHost";
      host.textContent = "HOST";
      marke.append(host);
    }
    const uhr = document.createElement("span");
    uhr.className = "rundeUhr";
    uhr.textContent = person.zeit || "";
    marke.append(uhr);
    return marke;
  }));
  // Wer dazukommt oder aussteigt, ist eine Neuigkeit - dann darf die Leiste
  // sich von selbst zeigen. Der Sekundentakt der Uhren ist keine: wuerde er
  // hier landen, ginge die Bedienleiste nie wieder weg.
  const bild = dabei.map((person) => `${person.name}|${person.host ? 1 : 0}`).join(",");
  if (bild !== rundeBild) {
    rundeBild = bild;
    schichtenZeigen();
  }
}

bruecke.aufLeiste(zeichneRunde);

setInterval(() => {
  if (!inRunde) return;
  bruecke.takt({
    auftragId: auftrag?.id,
    stelle: Number(bild.currentTime) || 0,
    frameTime: pausiertesBild(),
    laeuft: !bild.paused && !bild.ended,
    puffert
  });
}, 1000);
bruecke.bereit();
