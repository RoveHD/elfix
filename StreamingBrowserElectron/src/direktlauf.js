"use strict";

/*
 * Vom Link zur Adresse: der Weg durch die Weiterleitungen.
 *
 * `direktquelle.js` liest eine einzelne Seite. Das genuegt selten: zwischen dem
 * Link auf der Folgenseite und dem Player liegen ueblicherweise zwei bis drei
 * Stationen - der Anbieter zeigt auf "/redirect/12345", das zeigt auf die
 * bekannte Adresse des Hosters, und die zeigt auf die Adresse des Tages, unter
 * der der Player wirklich liegt. Wer nur die erste Seite liest, findet nichts
 * und haelt den Hoster faelschlich fuer stumm.
 *
 * Dieses Modul geht den Weg zu Ende und bringt zurueck, was am Ende steht.
 *
 * <h2>Warum es das Netz nicht selbst anfasst</h2>
 *
 * Geholt wird ueber eine hineingereichte Funktion - dieselbe Bauart wie beim
 * Empfehlungslauf. Der Hauptprozess reicht `net.fetch` der Browser-Sitzung
 * hinein (damit Kennung, Cookies und Proxy dieselben sind wie in der Ansicht),
 * die Pruefung reicht eine Tabelle hinein. So laesst sich der ganze Weg
 * einschliesslich seiner Sackgassen ohne Netz messen.
 *
 * <h2>Was hier bewusst begrenzt ist</h2>
 *
 * Ein Aufloeser, der jeder Weiterleitung folgt, ist eine Maschine, mit der sich
 * fremde Server abklappern lassen. Deshalb: hoechstens vier Stationen, keine
 * zweimal, jede mit Frist, und alles, was groesser ist als eine Seite, wird
 * nicht einmal gelesen. Eine Kette, die dabei nicht ans Ziel kommt, ist keine
 * Kette, der man laenger nachgehen sollte - dann bleibt es beim Rahmen des
 * Hosters, und das ist ein vollstaendig brauchbarer Ausgang.
 */

const direktquelle = require("./direktquelle");

/** So viele Stationen darf ein Weg haben. */
const HOECHSTSTATIONEN = 4;

/** So lange darf eine einzelne Station brauchen. */
const FRIST_MS = 12000;

/**
 * So gross darf eine Hosterseite sein.
 *
 * Sie ist Text mit etwas Skript darin; ein paar hundert Kilobyte sind viel.
 * Was darueber liegt, ist keine Seite, sondern etwas, das man nicht in den
 * Speicher des Hauptprozesses laden will - im Zweifel das Video selbst.
 */
const HOECHSTGROESSE = 4 * 1024 * 1024;

/** Die Kennung, unter der gefragt wird, wenn keine hereingereicht wird. */
const KENNUNG = "Mozilla/5.0 ELFIX/0.2";

/**
 * Eine Antwort, wie sie hier immer aussieht.
 *
 * Auch der Fehlschlag traegt `stationen` mit: geht etwas schief, ist die Frage
 * "wo denn?" die erste, und ohne diese Liste ist sie nicht zu beantworten.
 */
function ergebnis(felder) {
  return {
    ok: false,
    quelle: null,
    quellen: [],
    seite: "",
    kopfzeilen: null,
    stationen: [],
    grund: "",
    ...felder
  };
}

/**
 * Die Kopfzeilen, mit denen die Quelle spaeter wirklich abgespielt wird.
 *
 * Das ist kein Beiwerk. Die Auslieferungsserver der Hoster pruefen den Referer:
 * dieselbe Adresse, die im Player laeuft, liefert nackt abgerufen ein 403. Wer
 * die Adresse also weiterreicht, muss dazusagen, in wessen Namen sie zu holen
 * ist - sonst faellt die Wiedergabe genau dort um, wo niemand mehr einen
 * Hoster sieht, an dem es liegen koennte.
 */
function kopfzeilenFuer(seite, kennung) {
  let herkunft = "";
  try {
    herkunft = new URL(seite).origin;
  } catch (_) {
    herkunft = "";
  }
  return {
    // Nur der Ursprung, nicht der ganze Pfad - der Grund steht bei
    // refererFuer(). Die Quelle liegt immer auf einer anderen Adresse als die
    // Spielerseite, dieser Abruf geht also grundsaetzlich ueber die
    // Ursprungsgrenze.
    referer: herkunft ? `${herkunft}/` : seite,
    origin: herkunft,
    "user-agent": kennung
  };
}

/** Ist die Adresse ueberhaupt eine, der man folgen darf? */
function brauchbareAdresse(roh) {
  try {
    const adresse = new URL(String(roh || ""));
    return adresse.protocol === "http:" || adresse.protocol === "https:" ? adresse.href : "";
  } catch (_) {
    return "";
  }
}

/**
 * Der Aufloeser.
 *
 * `holen(adresse, aufbau)` muss etwas liefern, das sich wie eine Antwort von
 * `fetch` verhaelt: `ok`, `status`, `url`, `headers.get()` und `text()`.
 */
function erstellen(umgebung = {}) {
  const holen = typeof umgebung.holen === "function" ? umgebung.holen : null;
  const kennung = String(umgebung.kennung || KENNUNG);
  const frist = Number(umgebung.frist) > 0 ? Number(umgebung.frist) : FRIST_MS;
  const stationen = Number(umgebung.stationen) > 0 ? Number(umgebung.stationen) : HOECHSTSTATIONEN;

  /**
   * Eine Station holen - und dabei nichts verschlucken.
   *
   * Ein Fehlschlag beim Holen ist hier eine Antwort und keine Ausnahme: der
   * Aufrufer soll wissen, ob der Hoster nicht antwortet oder ob er antwortet
   * und nichts hergibt. Das sind zwei verschiedene Fehler mit zwei
   * verschiedenen Aussichten auf einen zweiten Versuch.
   */
  /*
   * Der Referer fuer die naechste Station.
   *
   * Innerhalb desselben Ursprungs die volle Vorstation, darueber hinaus nur
   * der Ursprung. Genau so haelt es ein Browser seit
   * `strict-origin-when-cross-origin`, und genau daran haengt hier mehr als
   * Hoeflichkeit.
   *
   * Gemessen am 2026-09-05 auf einem Rechner mit laufendem AdGuard, dreimal
   * wiederholt: derselbe Abruf auf VOEs Tagesadresse geht mit
   * `https://aniworld.to/` durch (HTTP 200, 125 kB) und wird mit
   * `https://aniworld.to/redirect/2626179` als ERR_BLOCKED_BY_CLIENT
   * abgewiesen. Im selben Prozess, in derselben Sitzung. Der volle Pfad war
   * damit der Grund, warum VOE im Pruefstand ueberhaupt nicht auftauchte -
   * "0/1 Folgen mit abgenommener Quelle", obwohl an der Auflösung nichts fehlte.
   *
   * Nebenbei ist es auch das Richtige: der ganze Pfad verraet der Gegenstelle,
   * welche Folge jemand sieht. Der Ursprung genuegt ihr.
   */
  function refererFuer(vorstation, ziel) {
    try {
      const von = new URL(vorstation);
      const nach = new URL(ziel);
      return von.origin === nach.origin ? vorstation : `${von.origin}/`;
    } catch {
      return "";
    }
  }

  async function seiteHolen(adresse, referer) {
    let antwort = null;
    try {
      antwort = await holen(adresse, {
        headers: {
          "accept": "text/html,application/xhtml+xml,*/*;q=0.8",
          "accept-language": "de-DE,de;q=0.9,en;q=0.8",
          "user-agent": kennung,
          ...(referer ? { referer } : {})
        },
        redirect: "follow",
        signal: AbortSignal.timeout(frist)
      });
    } catch (fehler) {
      return { fehler: String(fehler?.message || fehler || "nicht erreichbar") };
    }
    if (!antwort) return { fehler: "keine Antwort" };
    if (!antwort.ok) return { fehler: `HTTP ${antwort.status || "?"}` };

    // Erst die Groesse, dann der Text: eine Datei, die als Seite ausgeliefert
    // wird, soll gar nicht erst in den Speicher.
    const laenge = Number(antwort.headers?.get?.("content-length") || 0);
    if (Number.isFinite(laenge) && laenge > HOECHSTGROESSE) return { fehler: "Antwort zu gross" };

    let text = "";
    try {
      text = String(await antwort.text());
    } catch (fehler) {
      return { fehler: String(fehler?.message || fehler || "nicht lesbar") };
    }
    if (text.length > HOECHSTGROESSE) return { fehler: "Antwort zu gross" };
    return { text, adresse: brauchbareAdresse(antwort.url) || adresse };
  }

  /**
   * Der ganze Weg.
   *
   * `referer` ist die Seite, von der der Link stammt - die Folgenseite des
   * Anbieters. Die erste Station will sie sehen; ab da traegt jede Station die
   * vorige.
   */
  async function aufloesen(start, referer = "") {
    if (!holen) return ergebnis({ grund: "kein Netzzugang gereicht" });
    let adresse = brauchbareAdresse(start);
    if (!adresse) return ergebnis({ grund: "keine brauchbare Adresse" });

    let woher = String(referer || "");
    const weg = [];
    const gesehen = new Set();

    for (let schritt = 0; schritt < stationen; schritt += 1) {
      if (gesehen.has(adresse)) {
        return ergebnis({ stationen: weg, grund: "Weiterleitung im Kreis" });
      }
      gesehen.add(adresse);
      weg.push(adresse);

      const geholt = await seiteHolen(adresse, woher);
      if (geholt.fehler) return ergebnis({ stationen: weg, grund: geholt.fehler });

      const gelesen = direktquelle.aufloesen(geholt.text, geholt.adresse);
      if (gelesen.quelle) {
        return ergebnis({
          ok: true,
          quelle: gelesen.quelle,
          quellen: gelesen.quellen,
          seite: geholt.adresse,
          kopfzeilen: kopfzeilenFuer(geholt.adresse, kennung),
          stationen: weg
        });
      }
      if (!gelesen.weiter) {
        return ergebnis({ stationen: weg, grund: gelesen.grund || "keine Quelle" });
      }
      woher = refererFuer(geholt.adresse, gelesen.weiter);
      adresse = gelesen.weiter;
    }

    return ergebnis({ stationen: weg, grund: "zu viele Weiterleitungen" });
  }

  return { aufloesen };
}

module.exports = {
  erstellen,
  kopfzeilenFuer,
  HOECHSTSTATIONEN,
  HOECHSTGROESSE,
  FRIST_MS,
  KENNUNG
};
