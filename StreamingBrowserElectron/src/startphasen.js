"use strict";

/**
 * Die Ladephasen beim Start einer Folge.
 *
 * <h2>Warum es dieses Modul gibt</h2>
 *
 * Zwischen "Weiterschauen" gedrueckt und "das Video laeuft im Vollbild" liegen
 * mehrere Schritte, die keiner Uhr folgen: die Folgenseite muss geladen sein,
 * der Hoster muss seinen Player bauen, der Player muss seine Quelle holen, der
 * gespeicherte Stand muss gesetzt werden, und erst danach ergibt Vollbild
 * ueberhaupt einen Sinn. Waehrenddessen liegt auf beiden Geraeten ein Vorhang
 * davor - sonst sieht man den Seitenaufbau, die Ueberlagerung des Hosters und
 * den Sprung ins Vollbild.
 *
 * Ein Ladebalken, der dabei einfach hochzaehlt, waere gelogen: er saehe bei
 * einer Leitung, die dreissig Sekunden braucht, genauso aus wie bei einer, die
 * drei braucht. Deshalb zaehlt hier nicht die Zeit, sondern die *Phase*. Jede
 * Phase entspricht einem Schritt, den die Startkette wirklich hinter sich
 * gebracht hat; der Balken springt weiter, wenn ein Schritt gemeldet wird, und
 * sonst gar nicht.
 *
 * <h2>Warum es geteilt ist</h2>
 *
 * Die Kette gibt es zweimal - main.js am Rechner, MainActivity und Mitschauen
 * auf Android -, aber sie hat dieselben Schritte, und was der Zuschauer dabei
 * liest, soll auf beiden Geraeten dasselbe sein. Namen, Reihenfolge,
 * Beschriftungen und Fristen stehen darum hier und nur hier. Android holt die
 * Tabelle beim Start einmal ueber den Kern ab (siehe Startphasen.java), der
 * Rechner ruft die Funktionen unmittelbar auf.
 *
 * Reine Rechnung, kein DOM, kein Node: das Modul laeuft im Kern-WebView
 * genauso wie im Hauptprozess, und es laesst sich ohne Geraet pruefen
 * (tests/startphasentest.js).
 */

/**
 * Die Schritte, in ihrer Reihenfolge.
 *
 * `fristMs` ist die Geduld fuer genau diesen Schritt - nicht fuer den ganzen
 * Start. Sie sind absichtlich unterschiedlich: eine Folgenseite darf lange
 * laden (gemessen wurden auf einer gedrosselten Leitung ueber 150 Sekunden bis
 * zum letzten Werbebild, waehrend der Teil, auf den es ankommt, laengst
 * dastand), ein Vollbild dagegen ist entweder sofort da oder gar nicht.
 *
 * `anteil` ist der Stand des Balkens, *wenn diese Phase beginnt*. Bewusst als
 * Tabelle und nicht als Nummer durch Laenge: die Schritte dauern
 * unterschiedlich lang, und ein Balken, der beim Warten auf den Hoster in der
 * Mitte steht, sagt mehr als einer, der in gleichen Fuenfteln springt.
 */
const PHASEN = [
  { name: "seite", text: "Folge wird geöffnet", anteil: 0.08, fristMs: 90000 },
  { name: "hoster", text: "Player wird geladen", anteil: 0.32, fristMs: 60000 },
  { name: "spieler", text: "Video wird vorbereitet", anteil: 0.58, fristMs: 45000 },
  { name: "stelle", text: "Zur gespeicherten Stelle", anteil: 0.78, fristMs: 25000 },
  { name: "vollbild", text: "Vollbild wird gesetzt", anteil: 0.90, fristMs: 15000 },
  { name: "laeuft", text: "Wiedergabe läuft", anteil: 1, fristMs: 0 }
];

/** Die Phase, in der ein Start anfaengt. */
const ERSTE = PHASEN[0].name;

/** Die Phase, nach der es nichts mehr zu tun gibt. */
const LETZTE = PHASEN[PHASEN.length - 1].name;

/**
 * Der Deckel ueber allem.
 *
 * Die Einzelfristen koennen sich addieren - jede fuer sich plausibel, in Summe
 * aber laenger, als irgendjemand vor einem Ladebildschirm sitzen will. Nach
 * dieser Zeit ist Schluss, egal in welchem Schritt es haengt.
 */
const GESAMT_FRIST_MS = 150000;

function phaseAus(name) {
  return PHASEN.find((phase) => phase.name === String(name || "")) || null;
}

function nummer(name) {
  return PHASEN.findIndex((phase) => phase.name === String(name || ""));
}

/**
 * Welche Schritte dieser Start durchlaeuft.
 *
 * Ohne gespeicherten Stand gibt es nichts zu springen - dann faellt "stelle"
 * heraus, statt als Schritt dazustehen, den niemand je meldet.
 *
 * @param {{stelle?: number}} optionen
 */
function phasen(optionen = {}) {
  const stelle = Number(optionen.stelle) || 0;
  return PHASEN
    .filter((phase) => phase.name !== "stelle" || stelle > 0)
    .map((phase) => ({ ...phase }));
}

/** Was in dieser Phase dasteht. Leer, wenn der Name keiner ist. */
function beschriftung(name) {
  const phase = phaseAus(name);
  return phase ? phase.text : "";
}

/** Wie voll der Balken in dieser Phase ist, 0 bis 1. */
function anteil(name) {
  const phase = phaseAus(name);
  return phase ? phase.anteil : 0;
}

/**
 * Einen Start anlegen.
 *
 * @param {{titel?: string, stelle?: number, jetzt?: number}} angaben
 */
function starten(angaben = {}) {
  const jetzt = Number(angaben.jetzt) || 0;
  return {
    titel: String(angaben.titel || ""),
    stelle: Math.max(0, Number(angaben.stelle) || 0),
    phase: ERSTE,
    begonnen: jetzt,
    seit: jetzt,
    fertig: false,
    fehler: ""
  };
}

/**
 * Einen Schritt melden.
 *
 * Rueckwaerts geht es nicht: die Kette meldet manche Schritte mehrfach (jeder
 * Takt des Autostarts sieht denselben Zustand wieder), und ein Balken, der
 * dabei zurueckspringt, sieht aus wie ein Fehler. Eine Meldung, die hinter dem
 * Stand liegt, wird darum still verworfen.
 *
 * @return {{zustand, geaendert: boolean, phase: string, text: string, anteil: number, fertig: boolean}}
 */
function melden(zustand, name, jetzt = 0) {
  const antwort = (geaendert) => ({
    zustand,
    geaendert,
    phase: zustand ? zustand.phase : "",
    text: beschriftung(zustand ? zustand.phase : ""),
    anteil: anteil(zustand ? zustand.phase : ""),
    fertig: Boolean(zustand && zustand.fertig)
  });
  if (!zustand || zustand.fehler) return antwort(false);
  const ziel = nummer(name);
  if (ziel < 0) return antwort(false);
  if (ziel <= nummer(zustand.phase)) return antwort(false);
  zustand.phase = PHASEN[ziel].name;
  zustand.seit = Number(jetzt) || 0;
  if (zustand.phase === LETZTE) zustand.fertig = true;
  return antwort(true);
}

/**
 * Steht der Start noch, oder ist er haengengeblieben?
 *
 * Zwei Fristen, und beide muessen sein: die des Schrittes faengt den Fall, in
 * dem ein einzelner Schritt nie antwortet, der Gesamtdeckel den, in dem jeder
 * Schritt gerade noch rechtzeitig kommt und es trotzdem ewig dauert.
 *
 * @return {{tun: "warten"|"fehler", grund: string, text: string}}
 */
function pruefen(zustand, jetzt = 0) {
  if (!zustand) return { tun: "fehler", grund: "kein start", text: fehlertext("kein start") };
  if (zustand.fertig) return { tun: "warten", grund: "fertig", text: "" };
  if (zustand.fehler) return { tun: "fehler", grund: zustand.fehler, text: fehlertext(zustand.fehler) };
  const zeit = Number(jetzt) || 0;
  // Ohne Kurzschluss auf `begonnen`: eine Uhr, die bei null anfaengt, ist eine
  // gueltige Uhr. Mit `zustand.begonnen &&` davor war der Deckel genau dann
  // abgeschaltet, wenn der Start im ersten Zeittakt begonnen hatte - und in
  // jeder Pruefung, die bei null zu zaehlen anfaengt.
  if (zeit - zustand.begonnen >= GESAMT_FRIST_MS) {
    return { tun: "fehler", grund: "gesamt", text: fehlertext("gesamt") };
  }
  const phase = phaseAus(zustand.phase);
  if (phase && phase.fristMs > 0 && zeit - zustand.seit >= phase.fristMs) {
    return { tun: "fehler", grund: zustand.phase, text: fehlertext(zustand.phase) };
  }
  return { tun: "warten", grund: zustand.phase, text: beschriftung(zustand.phase) };
}

/**
 * Was dem Zuschauer gesagt wird, wenn es nicht weitergeht.
 *
 * Je Schritt eine eigene Antwort. "Zeitueberschreitung" waere richtig und
 * nutzlos - wer liest, dass der Hoster keinen Player geliefert hat, weiss,
 * dass ein zweiter Versuch etwas bringen kann, und wer liest, dass die Seite
 * nicht laedt, sieht zuerst nach seiner Verbindung.
 */
function fehlertext(grund) {
  switch (String(grund || "")) {
    case "seite":
      return "Die Folgenseite lädt nicht. Prüfe deine Internetverbindung.";
    case "hoster":
      return "Der Hoster hat keinen Player geliefert.";
    case "spieler":
      return "Der Player hat kein Video geladen.";
    case "stelle":
      return "Der Player ist nicht zur gespeicherten Stelle gesprungen.";
    case "vollbild":
      return "Das Video läuft, aber das Vollbild kam nicht zustande.";
    case "gesamt":
      return "Der Start dauert zu lange.";
    case "abgebrochen":
      return "Der Start wurde abgebrochen.";
    default:
      return "Die Folge konnte nicht gestartet werden.";
  }
}

/**
 * Die ganze Tabelle als schlichte Angaben - fuer Aufrufer ohne JavaScript.
 *
 * Android liest sie beim Start einmal aus und zeichnet danach ohne Rueckfrage.
 * Ein Weg ueber den Kern je Balkenschritt waere ein Rundlauf fuer eine
 * Division, und der Vorhang muss sofort dastehen.
 */
function modell() {
  return {
    phasen: PHASEN.map((phase) => ({ ...phase })),
    erste: ERSTE,
    letzte: LETZTE,
    gesamtFristMs: GESAMT_FRIST_MS,
    fehlertexte: PHASEN
      .map((phase) => phase.name)
      .concat(["gesamt", "abgebrochen", ""])
      .reduce((sammlung, name) => {
        sammlung[name] = fehlertext(name);
        return sammlung;
      }, {})
  };
}

module.exports = {
  PHASEN,
  ERSTE,
  LETZTE,
  GESAMT_FRIST_MS,
  phasen,
  beschriftung,
  anteil,
  starten,
  melden,
  pruefen,
  fehlertext,
  modell
};
