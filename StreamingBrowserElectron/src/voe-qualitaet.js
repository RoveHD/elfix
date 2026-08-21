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

// Das Skript, das die Wahl in den Player traegt.
function qualitaetScript() {
  return `(() => {
    ${hoechsteStufe.toString()}

    const jw = typeof window.jwplayer === "function" ? window.jwplayer() : null;
    if (!jw || typeof jw.getQualityLevels !== "function") return "kein-player";

    // Schon eingerichtet: dann nur nachsehen, ob inzwischen Stufen dastehen.
    if (window.__elfixVoeQualitaet) return window.__elfixVoeQualitaet.anwenden();

    const zustand = { erledigt: false, zuletzt: "" };

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
      zustand.zuletzt = "gesetzt:" + String(stufen[ziel].label || ziel);
      return zustand.zuletzt;
    };

    // Die Stufen stehen erst mit dem Manifest fest, und eine neue Folge faengt
    // wieder bei "Auto" an - deshalb beide Ereignisse.
    try {
      jw.on("levels", anwenden);
      jw.on("playlistItem", () => {
        zustand.erledigt = false;
        zustand.zuletzt = "";
      });
    } catch {
      // Ein Player ohne diese Ereignisse bekommt eben nur den einen Versuch.
    }

    window.__elfixVoeQualitaet = { anwenden, zustand };
    return anwenden();
  })()`;
}

module.exports = { hoechsteStufe, qualitaetScript };
