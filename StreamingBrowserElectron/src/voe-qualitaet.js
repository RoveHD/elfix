"use strict";

// Immer die beste Bildqualitaet beim Hoster.
//
// VOE laesst den Player auf "Auto" stehen. Auto waehlt nach Leitung und Puffer
// und liegt dabei gern eine Stufe unter dem, was moeglich waere - einmal nach
// unten geregelt, kommt es von selbst oft nicht wieder hoch. Wer einen
// 1080p-Bildschirm hat, moechte 1080p sehen.
//
// Gesetzt wird einmal je Folge, nicht dauernd. Der Unterschied ist wichtig: wer
// waehrend des Schauens von Hand auf 720p geht, hat einen Grund dafuer, und ein
// Skript, das ihn sofort wieder hochdreht, waere eine Bevormundung. Erst die
// naechste Folge faengt wieder oben an.
//
// Der Player ist ein JW Player im Rahmen des Hosters, nicht im Dokument von
// AniWorld. Deshalb geht das Skript in alle Frames und tut nur dort etwas, wo
// ein solcher Player wirklich liegt. Am Hostnamen laesst sich das nicht
// festmachen: VOE wechselt seine Adressen staendig.

// Die hoechste echte Stufe aus dem, was der Player anbietet.
//
// "Auto" steht in derselben Liste, ist aber keine Qualitaet, sondern der
// Verzicht auf die Wahl - genau der soll hier ja aufgehoben werden. Bei nur
// einer Stufe gibt es nichts zu waehlen; dann bleibt alles, wie es ist.
function hoechsteStufe(stufen) {
  if (!Array.isArray(stufen) || stufen.length < 2) return -1;
  let besterIndex = -1;
  let bester = 0;
  for (let i = 0; i < stufen.length; i += 1) {
    const stufe = stufen[i] || {};
    const beschriftung = String(stufe.label === undefined ? "" : stufe.label);
    if (/auto/i.test(beschriftung)) continue;
    // Der Hoehe nach. Fehlt sie, steht sie meist in der Beschriftung ("1080p");
    // fehlt auch die, bleibt die Bitrate als letzte Auskunft.
    const ausText = /(\d{3,4})\s*p/i.exec(beschriftung);
    const wert = Number(stufe.height) || (ausText ? Number(ausText[1]) : 0)
      || Number(stufe.bitrate) || 0;
    if (wert > bester) {
      bester = wert;
      besterIndex = i;
    }
  }
  return besterIndex;
}

// Die Anzeige, die der Player nach dem Umschalten stehen laesst.
//
// VOE schreibt bei jedem Stufenwechsel "Quality: 1080p" in ein eigenes Feld
// ueber dem Bild - `#QualityText`, ein DIV ohne Klasse in `.jw-media`, keine
// Einrichtung des JW Players. Es raeumt sie nie wieder ab: gemessen am
// 2026-09-03 im laufenden Player auf dem Telefon stand sie nach zwanzig
// Sekunden unveraendert auf `display:block, opacity 1`. Weg ging sie erst,
// als die Bedienelemente einmal auf- und wieder zugingen - daher "man muss
// zweimal reintippen".
//
// Sie erscheint nur, weil dieses Modul die Stufe gesetzt hat. Also raeumt es
// sie auch selbst wieder weg.
//
// Weggeraeumt wird der *Text* und nicht die Sichtbarkeit, und das ist der
// eigentliche Punkt. Der erste Versuch setzte `display:none !important` - und
// verlor: gemessen am 2026-09-03 stand kurz danach wieder `display: block`
// da, und im `style`-Attribut war von der Regel nichts mehr zu sehen. VOE
// schreibt den Stil dieses Feldes als ganzen Block immer wieder neu (Breite,
// Hoehe, Schrift, Lage, z-index) und wischt dabei jede eigene Eigenschaft
// mit weg. Wer dort um `display` streitet, muss dauerhaft dagegen anschreiben.
// Der Text dagegen wird nur bei einem Stufenwechsel gesetzt. Ein leeres Feld
// ist unsichtbar - es hat keinen Hintergrund, nur weisse Schrift.
//
// Verborgen wird zusaetzlich, solange es hilft; ueberschreibt VOE das gleich
// wieder, steht danach eben ein leeres Feld da, und das genuegt.
//
// Und nicht ueber ein Zeitfenster, sondern ueber einen Beobachter. Der zweite
// Versuch raeumte 2,5 Sekunden lang auf - danach stand der Text wieder da.
// Gemessen am 2026-09-03: `setCurrentQuality` ist nur die *Bitte*; VOE
// schreibt die Anzeige erst, wenn die Stufe wirklich greift, und das ist bei
// HLS eine Sache von Sekunden bis Zehnersekunden. Eine Frist, die das
// abdeckt, waere eine Uhr, die den halben Film mitlaeuft.
//
// Also wird das Feld beobachtet: schreibt dort jemand *unsere* Stufe hinein,
// wird es geleert. Genau diese Bedingung macht den Beobachter harmlos - wer
// spaeter von Hand auf 720p geht, schreibt einen anderen Text, und der bleibt
// stehen. Ein Zaehler deckelt das Ganze; ein Feld, das sich mit uns streitet,
// bekommt es nach zwanzig Runden zurueck.
function anzeigeWegraeumen(doc, kennung, stufe, hoechstens) {
  // Immer dieselbe Form zurueck, damit der Aufrufer nicht unterscheiden muss:
  // was es geworden ist, steht in `grund`.
  const ergebnis = (grund, loesen) => ({
    grund,
    loesen: loesen || (() => {}),
    toString: () => grund
  });
  if (!doc || typeof doc.getElementById !== "function") return ergebnis("kein-dokument");
  const marke = String(stufe || "").trim();
  if (!marke) return ergebnis("keine-stufe");
  const deckel = Math.max(1, Number(hoechstens) || 0);
  let geleert = 0;
  let gesehen = "";

  // Nur unsere eigene Ansage. "Quality: 1080p" enthaelt "1080p"; was ein
  // spaeterer Wechsel hineinschreibt, enthaelt es nicht.
  const unsere = (text) => text.indexOf(marke) >= 0;

  const wegraeumen = () => {
    const feld = doc.getElementById(kennung);
    if (!feld) return false;
    const text = String(feld.textContent || "").trim();
    if (!text || !unsere(text)) return false;
    gesehen = text;
    feld.textContent = "";
    geleert += 1;
    try {
      if (feld.style) feld.style.setProperty("display", "none", "important");
    } catch {
      // Ein Feld, das seinen Stil nicht hergibt, ist jetzt jedenfalls leer.
    }
    return true;
  };

  wegraeumen();

  const feld = doc.getElementById(kennung);
  const Wache = doc.defaultView && doc.defaultView.MutationObserver;
  if (!feld || typeof Wache !== "function") {
    return ergebnis(gesehen ? "einmal:" + gesehen : "ohne-wache");
  }
  const wache = new Wache(() => {
    wegraeumen();
    if (geleert >= deckel) wache.disconnect();
  });
  try {
    wache.observe(feld, { childList: true, characterData: true, subtree: true });
  } catch {
    return ergebnis(gesehen ? "einmal:" + gesehen : "ohne-wache");
  }
  return ergebnis("beobachtet:" + marke, () => wache.disconnect());
}

// Das Feld, das VOE fuer diese Anzeige benutzt, und der Deckel darauf.
//
// Der Name ist gemessen und nicht geraten: `#QualityText`, ein DIV ohne Klasse
// in `.jw-media`. Zwanzig Runden sind reichlich fuer die zwei oder drei
// Schreibvorgaenge eines Stufenwechsels und niedrig genug, dass ein Feld, das
// sich mit uns streitet, den Streit gewinnt statt ihn endlos zu fuehren.
const ANZEIGE_KENNUNG = "QualityText";
const ANZEIGE_HOECHSTENS = 20;

// Das Skript, das die Wahl in den Player traegt.
function qualitaetScript() {
  return `(() => {
    ${hoechsteStufe.toString()}
    ${anzeigeWegraeumen.toString()}

    const jw = typeof window.jwplayer === "function" ? window.jwplayer() : null;
    if (!jw || typeof jw.getQualityLevels !== "function") return "kein-player";

    // Schon eingerichtet: dann nur nachsehen, ob inzwischen Stufen dastehen.
    if (window.__elfixVoeQualitaet) return window.__elfixVoeQualitaet.anwenden();

    const zustand = { erledigt: false, zuletzt: "", anzeige: "" };
    // Was vor dem ersten Griff dasteht - so muss keine Stelle auf null pruefen.
    const leereAnzeige = { grund: "", loesen: () => {}, toString: () => "" };
    let anzeige = leereAnzeige;

    const anwenden = () => {
      if (zustand.erledigt) return zustand.zuletzt;
      let stufen = [];
      try {
        stufen = jw.getQualityLevels() || [];
      } catch {
        return "keine-liste";
      }
      const ziel = hoechsteStufe(stufen);
      // Vor dem Manifest kennt der Player nur "Auto". Dann ist hier nichts zu
      // tun - das Ereignis "levels" kommt gleich noch.
      if (ziel < 0) return "noch-keine-stufen";
      try {
        jw.setCurrentQuality(ziel);
      } catch {
        return "nicht-setzbar";
      }
      zustand.erledigt = true;
      const stufenName = String(stufen[ziel].label || ziel);
      // Und die Anzeige, die der Player daraufhin stehen laesst, gleich mit.
      // Sie ist die Folge genau dieses Griffs - siehe anzeigeWegraeumen().
      // Der Beobachter haelt bis zum Folgenwechsel; geloest wird er dort.
      anzeige.loesen();
      anzeige = anzeigeWegraeumen(
        typeof document === "undefined" ? null : document,
        ${JSON.stringify(ANZEIGE_KENNUNG)}, stufenName, ${ANZEIGE_HOECHSTENS});
      zustand.anzeige = String(anzeige);
      zustand.zuletzt = "gesetzt:" + stufenName;
      return zustand.zuletzt;
    };

    // Die Stufen stehen erst mit dem Manifest fest, und eine neue Folge faengt
    // wieder bei "Auto" an - deshalb beide Ereignisse.
    try {
      jw.on("levels", anwenden);
      jw.on("playlistItem", () => {
        zustand.erledigt = false;
        zustand.zuletzt = "";
        // Die neue Folge bringt ihre eigene Anzeige mit; der Beobachter der
        // alten haette nur noch deren Stufenname im Gedaechtnis.
        anzeige.loesen();
        anzeige = leereAnzeige;
        zustand.anzeige = "";
      });
    } catch {
      // Ein Player ohne diese Ereignisse bekommt eben nur den einen Versuch.
    }

    window.__elfixVoeQualitaet = { anwenden, zustand };
    return anwenden();
  })()`;
}

module.exports = {
  hoechsteStufe,
  anzeigeWegraeumen,
  qualitaetScript,
  ANZEIGE_KENNUNG,
  ANZEIGE_HOECHSTENS
};
