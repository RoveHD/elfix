"use strict";

/**
 * Wann das Hauptfenster aufgehen darf - und was solange davorsteht.
 *
 * <h2>Der gemeldete Ablauf</h2>
 *
 * ELFIX startete bis hierher so: Hauptfenster sofort sichtbar, zweieinhalb
 * Sekunden spaeter die Updatepruefung, und wenn es etwas gab, lud die App im
 * Hintergrund, schloss sich und startete neu. Wer gerade angefangen hatte,
 * etwas zu suchen, verlor es wieder. Der Weg dorthin war technisch richtig
 * und fuer den, der davorsitzt, unbrauchbar.
 *
 * Gewuenscht ist die umgekehrte Reihenfolge: erst fragen, dann zeigen. Das
 * Hauptfenster entsteht zwar sofort - es soll waehrend der Pruefung schon
 * laden -, bleibt aber unsichtbar, bis feststeht, ob dieser Start ueberhaupt
 * der ist, den der Benutzer behalten soll.
 *
 * <h2>Warum das ein eigenes Modul ist</h2>
 *
 * Weil daran fast nichts mit Electron zu tun hat. Was hier steht, ist eine
 * Frage mit vier Antworten - warten, laden, installieren, aufmachen -, und
 * genau die laesst sich ohne Fenster, ohne Updateserver und ohne Netz pruefen
 * (tests/startfreigabetest.js). In main.js bleibt der Draht: Ereignisse
 * hinein, Fenster hinaus.
 *
 * <h2>Die zwei Zusagen</h2>
 *
 * <ol>
 *   <li><b>Einmal offen, immer offen.</b> Steht das Hauptfenster erst, darf
 *       keine spaete Meldung es wieder zumachen. Ein Update, das nach dem
 *       Zeitablauf doch noch gefunden wird, aendert am Fenster nichts mehr -
 *       sonst verschwaende die App unter den Haenden dessen, der sie gerade
 *       benutzt.</li>
 *   <li><b>Es gibt kein Warten ohne Ende.</b> Jeder Weg endet entweder beim
 *       offenen Fenster oder bei der Installation. Antwortet niemand, sorgt
 *       {@link STILLE_MS} dafuer, dass ELFIX trotzdem startet.</li>
 * </ol>
 */

/** Die Pruefung laeuft, nichts ist zu sehen. */
const WARTET = "wartet";
/** Ein Update wird geholt - das Hauptfenster bleibt zu. */
const LAEDT = "laedt";
/** Geladen, wird eingespielt. Danach startet die neue Fassung. */
const INSTALLIERT = "installiert";
/** Das Hauptfenster darf. Endzustand. */
const OFFEN = "offen";

/**
 * Wie lange gewartet wird, bevor ueberhaupt ein Vorhang erscheint.
 *
 * <p>Der haeufigste Fall ist "kein Update", und der ist nach einem
 * Augenblick beantwortet. Ein Vorhang, der dabei fuer zwei Bilder aufblitzt,
 * ist schlimmer als gar keiner - deshalb bekommt die Pruefung diesen
 * Vorsprung, und erst wenn sie ihn ueberschreitet, wird etwas gezeigt.
 */
const VERZUG_MS = 400;

/**
 * Wie lange Stille erlaubt ist, bevor ELFIX ohne Antwort startet.
 *
 * <p>Gemessen wird nicht der ganze Vorgang, sondern die Pause zwischen zwei
 * Meldungen: ein Download meldet seinen Fortschritt laufend und haelt sich
 * damit selbst am Leben, auch wenn er Minuten braucht. Wirklich abgelaufen
 * ist die Frist nur, wenn gar nichts mehr kommt - ein haengender Server, eine
 * Leitung, die mitten im Satz abbricht.
 */
const STILLE_MS = 15000;

const TEXT_PRUEFUNG = "Suche nach Updates …";
const TEXT_INSTALLATION = "Update wird installiert …";

/** Ein frischer Start: die Pruefung laeuft, nichts ist entschieden. */
function neu() {
  return { zustand: WARTET, text: TEXT_PRUEFUNG, prozent: 0, fassung: "" };
}

/**
 * Ein Ereignis melden und den neuen Stand bekommen.
 *
 * <p>Der Stand wird nicht veraendert, sondern ersetzt - wer den alten noch
 * haelt, sieht ihn unveraendert. Meldungen, die nichts aendern, geben denselben
 * Stand zurueck; daran erkennt der Aufrufer, dass nichts zu tun ist.
 *
 * @param lauf     der bisherige Stand
 * @param ereignis pruefung | update | fortschritt | geladen | kein-update |
 *                 fehler | stille | unverpackt
 * @param wert     bei "update" die Fassung, bei "fortschritt" die Prozent
 */
function melden(lauf, ereignis, wert) {
  // Zusage 1: Ein Endzustand bleibt einer.
  if (lauf.zustand === OFFEN || lauf.zustand === INSTALLIERT) return lauf;

  switch (ereignis) {
    case "update": {
      const fassung = String(wert || "");
      return {
        zustand: LAEDT,
        text: ladeText(fassung, 0),
        prozent: 0,
        fassung
      };
    }
    case "fortschritt": {
      // Vor dem "update" gibt es keinen Fortschritt zu zeigen. Kaeme er
      // trotzdem, waere er ein Fortschritt woran - also nichts.
      if (lauf.zustand !== LAEDT) return lauf;
      const prozent = grenzen(wert);
      if (prozent === lauf.prozent) return lauf;
      return { ...lauf, text: ladeText(lauf.fassung, prozent), prozent };
    }
    case "geladen":
      // Auch aus dem Warten heraus: ein Update, das schon fertig geladen
      // dalag, meldet nie "update-available" mit Download.
      return { zustand: INSTALLIERT, text: TEXT_INSTALLATION, prozent: 100, fassung: lauf.fassung };
    case "kein-update":
    case "fehler":
    case "stille":
    case "unverpackt":
      // Zusage 2: Jeder dieser Wege endet beim offenen Fenster. Ein Fehler
      // beim Update ist kein Grund, ELFIX nicht zu starten.
      return { zustand: OFFEN, text: "", prozent: lauf.prozent, fassung: lauf.fassung };
    case "pruefung":
    default:
      // Bekannt und ohne Folgen: die Meldung haelt nur die Frist am Leben.
      return lauf;
  }
}

/** Darf das Hauptfenster? */
function darfZeigen(lauf) {
  return lauf.zustand === OFFEN;
}

/** Wird gerade eingespielt? Dann kommt kein Fenster mehr, sondern ein Neustart. */
function installiert(lauf) {
  return lauf.zustand === INSTALLIERT;
}

/**
 * Gehoert jetzt ein Vorhang auf den Schirm?
 *
 * <p>Beim Laden und beim Installieren immer - dort weiss sonst niemand, warum
 * nichts geschieht. Waehrend der Pruefung erst nach {@link VERZUG_MS}, damit
 * der schnelle Normalfall ohne Vorhang auskommt.
 *
 * @param verstrichenMs seit dem Beginn des Starts
 */
function vorhangNoetig(lauf, verstrichenMs) {
  if (lauf.zustand === LAEDT || lauf.zustand === INSTALLIERT) return true;
  if (lauf.zustand !== WARTET) return false;
  return verstrichenMs >= VERZUG_MS;
}

function ladeText(fassung, prozent) {
  const name = fassung ? `ELFIX ${fassung}` : "Update";
  return `${name} wird geladen … ${grenzen(prozent)} %`;
}

function grenzen(wert) {
  const zahl = Math.round(Number(wert) || 0);
  if (!Number.isFinite(zahl) || zahl < 0) return 0;
  return zahl > 100 ? 100 : zahl;
}

module.exports = {
  WARTET,
  LAEDT,
  INSTALLIERT,
  OFFEN,
  VERZUG_MS,
  STILLE_MS,
  TEXT_PRUEFUNG,
  TEXT_INSTALLATION,
  neu,
  melden,
  darfZeigen,
  installiert,
  vorhangNoetig
};
