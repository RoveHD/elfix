"use strict";

/*
 * Von der Messung zur Sitzung - einmal fuer beide Geraete.
 *
 * `statistik.js` kennt die Regeln: wann eine Sitzung beginnt, wann sie an
 * Stille stirbt, was sie ueberhaupt wert ist. Was dort fehlte, war der Schritt
 * davor - aus dem, was der Fortschritt gerade gemeldet hat, eine Meldung im
 * Sinne von `statistik.js` zu machen. Der stand in `main.js` (sitzungMelden)
 * und damit hinter Electron.
 *
 * Die Folge war nicht "Android zeigt weniger": Android hat *nie* eine Sekunde
 * Wiedergabezeit aufgezeichnet. Ein Rueckblick auf dem Telefon haette
 * zwangslaeufig eine leere Bilanz gezeigt - schlimmer als keiner, weil eine
 * Null wie eine Aussage aussieht.
 *
 * Deshalb steht der Schritt jetzt hier. Er kennt weder Dateisystem noch
 * Ablage: er bekommt die vorige offene Sitzung gereicht und gibt zurueck, was
 * daraus geworden ist. Wer sie wohin schreibt, entscheidet der Aufrufer - am
 * Rechner eine Datei, auf dem Telefon der Sitzungsspeicher in Java.
 */

const statistik = require("./statistik");
const { episodeIdentity, mediaProgressPercent, COMPLETED_PROGRESS_PERCENT } = require("./fortschritt");

/**
 * Ob diese Folge schon einmal zu Ende gesehen wurde.
 *
 * <p>Genau das macht ein erneutes Anschauen zur Wiederholung - und eine
 * Wiederholung zaehlt nicht als weitere Folge, sonst stuenden am Ende mehr
 * Folgen da, als es gibt.
 */
function istWiederholung(entry, url) {
  if (!entry) return false;
  const identity = episodeIdentity(url);
  if (identity && identity.episode) {
    // Derselbe Schluessel, den appendCompletedEpisode vergibt - sonst faende
    // man den vorhandenen Abschluss nie wieder.
    const schluessel = `${identity.key}:s${identity.season}:e${identity.episode}`;
    return (entry.completedEpisodes || []).some((eintrag) => eintrag.key === schluessel);
  }
  return Boolean(entry.completed);
}

/**
 * Die Meldung, wie `statistik.meldungEinarbeiten` sie erwartet.
 *
 * <p>Eigene Funktion, damit sie sich einzeln pruefen laesst: hier faellt die
 * Entscheidung, was als Folge, als Staffel und als Abschluss gilt, und ein
 * Fehler darin waere in einer Jahresbilanz nicht mehr zu erkennen.
 */
function meldungBauen(angaben = {}, vorher = null) {
  const { provider = null, url = "", entry = null, fortschritt = {} } = angaben;
  const identity = episodeIdentity(url);
  return {
    favoriteId: entry ? entry.id : "",
    url,
    titel: (entry && entry.title) || "",
    providerId: provider ? provider.id : "",
    providerName: (provider && provider.name) || "",
    type: (entry && entry.type) || "",
    season: (identity && identity.season) || (entry && entry.season) || 0,
    episode: (identity && identity.episode) || (entry && entry.episode) || 0,
    sekunden: Number(fortschritt.playedSeconds) || 0,
    position: Number(fortschritt.currentTime) || 0,
    laufzeit: Number(fortschritt.duration) || 0,
    abgeschlossen: Boolean(fortschritt.ended)
      || mediaProgressPercent(fortschritt.currentTime, fortschritt.duration) >= COMPLETED_PROGRESS_PERCENT,
    // Zum Zeitpunkt des Beginns gefragt, nicht am Ende: waehrend dieser Sitzung
    // wird die Folge ja gerade abgeschlossen, und danach saehe jede
    // Erstansicht wie eine Wiederholung aus.
    wiederholung: vorher && vorher.url === url ? Boolean(vorher.wiederholung) : istWiederholung(entry, url)
  };
}

/**
 * Ein Takt.
 *
 * @param vorher  die offene Sitzung dieses Anbieters, oder {@code null}
 * @param angaben { provider, url, entry, fortschritt }
 * @param jetzt   der Zeitpunkt - als Wert, damit sich das Ganze pruefen laesst
 * @returns {{offen: object|null, geschlossen: object|null,
 *            ablegen: object|null, verwerfen: string}}
 *          <ul>
 *            <li>{@code offen} - die Sitzung, die weiterlaeuft
 *            <li>{@code geschlossen} - eine, die gerade endete (schon
 *                geschlossen, noch nicht bewertet)
 *            <li>{@code ablegen} - der Stand, der jetzt in die Ablage gehoert
 *            <li>{@code verwerfen} - die Kennung eines Standes, der aus der
 *                Ablage gehoert, weil er sich nicht mehr lohnt
 *          </ul>
 */
function schritt(vorher, angaben = {}, jetzt = Date.now()) {
  const leer = { offen: null, geschlossen: null, ablegen: null, verwerfen: "" };
  if (!angaben.provider || !angaben.entry) return { ...leer, offen: vorher || null };

  const ergebnis = statistik.meldungEinarbeiten(vorher, meldungBauen(angaben, vorher), jetzt);
  const antwort = {
    offen: ergebnis.offen || null,
    geschlossen: ergebnis.geschlossen || null,
    ablegen: null,
    verwerfen: ""
  };
  if (ergebnis.offen) {
    const stand = statistik.sitzungSchliessen(ergebnis.offen);
    if (statistik.sitzungLohnt(stand)) antwort.ablegen = stand;
  }
  return antwort;
}

/**
 * Eine offene Sitzung beenden - beim Anbieterwechsel, beim Schliessen einer
 * Ansicht und beim Beenden der App.
 *
 * <p>Ohne das bliebe die letzte Folge eines Abends ungezaehlt.
 *
 * @returns {{ablegen: object|null, verwerfen: string}}
 */
function beenden(offen) {
  if (!offen) return { ablegen: null, verwerfen: "" };
  const stand = statistik.sitzungSchliessen(offen);
  if (statistik.sitzungLohnt(stand)) return { ablegen: stand, verwerfen: "" };
  return { ablegen: null, verwerfen: String(stand.id || "") };
}

/**
 * Ein Zeitraum als Name statt als zwei Zeitstempel.
 *
 * <p>Die Seite fragt nach "letzte 30 Tage", nicht nach zwei
 * Millisekundenwerten. Stand ebenfalls in main.js; der Rueckblick des Telefons
 * braucht dieselben Grenzen, sonst heisst "dieses Jahr" dort etwas anderes.
 */
function zeitraumGrenzen(name, jetzt = Date.now()) {
  const heute = new Date(jetzt);
  const tagesBeginn = (datum) => new Date(datum.getFullYear(), datum.getMonth(), datum.getDate()).getTime();
  const vorTagen = (anzahl) => tagesBeginn(new Date(jetzt - anzahl * 86400000));
  switch (String(name || "")) {
    case "7tage": return { von: vorTagen(6), bis: jetzt };
    case "30tage": return { von: vorTagen(29), bis: jetzt };
    case "monat": return { von: new Date(heute.getFullYear(), heute.getMonth(), 1).getTime(), bis: jetzt };
    case "jahr": return { von: new Date(heute.getFullYear(), 0, 1).getTime(), bis: jetzt };
    case "alles": return { von: Number.NEGATIVE_INFINITY, bis: jetzt };
    default: {
      // Eine Jahreszahl - "2025" heisst das ganze Kalenderjahr.
      const jahr = Number(name);
      if (Number.isFinite(jahr) && jahr > 2000) {
        return { von: new Date(jahr, 0, 1).getTime(), bis: new Date(jahr + 1, 0, 1).getTime() - 1 };
      }
      return { von: Number.NEGATIVE_INFINITY, bis: jetzt };
    }
  }
}

module.exports = { istWiederholung, meldungBauen, schritt, beenden, zeitraumGrenzen };
