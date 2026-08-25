"use strict";

/*
 * Der Anbieterkalender - einmal fuer beide Geraete.
 *
 * Die beiden Parser standen schon immer im gemeinsamen `discover.js`; was
 * fehlte, war die Runde darum herum: welche Adressen probiert werden, in
 * welcher Reihenfolge, wie lange eine Antwort gilt und auf welche Woche
 * gekuerzt wird. Das stand in `main.js` und damit hinter Electron - der Grund,
 * warum die Android-App als einzige Startseitenfunktion gar keinen Kalender
 * hatte.
 *
 * Also dieselbe Aufteilung wie beim Empfehlungslauf: die Rechnung hierher, die
 * eine Bindung an die Aussenwelt (`holen`) als Umgebung herein. Am Rechner
 * reicht `main.js` seinen `fetchProviderHtml` hinein, auf dem Telefon die
 * Bruecke im Kern - danach kommt auf beiden Geraeten dasselbe heraus.
 *
 * Die Umgebung, die {@link erstellen} erwartet:
 *
 *   holen(url)   -> Promise<{ html, url } | null>   eine Anbieterseite
 *   anbieter()   -> Provider[]                      nur die eingeschalteten
 *   protokoll(t) -> void                            eine Zeile fuer das Log
 *   jetzt()      -> number                          fuer die Proben
 */

const providerModel = require("../shared/provider-model");
const { absoluteHttpUrl } = require("./fortschritt");
const { extractCalendarEntries, extractCalendarJson, WOCHENTAGE } = require("./discover");

/*
 * Zwei Bauarten, vier Adressen.
 *
 * AniWorld liefert fertiges HTML unter /animekalender. S.to laedt seinen
 * Kalender per JavaScript nach; die Daten liegen unter /api/calendar und sind
 * nach Datum geordnet. Probiert wird deshalb erst die Schnittstelle, dann die
 * Seite - was zuerst etwas hergibt, gewinnt.
 */
const KALENDER_QUELLEN = [
  { pfad: "api/calendar", art: "json" },
  { pfad: "animekalender", art: "html" },
  { pfad: "serienkalender", art: "html" },
  { pfad: "kalender", art: "html" }
];

/** So lange gilt eine geholte Woche als frisch. */
const KALENDER_CACHE_MS = 30 * 60 * 1000;

/** So weit reicht die Ansicht - siehe {@link inDerWoche}. */
const KALENDER_TAGE = 7;

function erstellen(umgebung = {}) {
  const holen = typeof umgebung.holen === "function" ? umgebung.holen : async () => null;
  const anbieter = typeof umgebung.anbieter === "function" ? umgebung.anbieter : () => [];
  const protokoll = typeof umgebung.protokoll === "function" ? umgebung.protokoll : () => {};
  const jetzt = typeof umgebung.jetzt === "function" ? umgebung.jetzt : () => Date.now();

  let cache = null;
  let laufend = null;

  /**
   * Die Eintraege eines Anbieters.
   *
   * <p>Der erste Weg, der etwas hergibt, gewinnt. Ein Anbieter ohne Kalender
   * durchlaeuft alle vier und liefert eine leere Liste - das ist kein Fehler
   * und wird auch nicht als einer gemeldet.
   */
  async function vonAnbieter(provider) {
    const basis = providerModel.normalizeUrl(provider.startUrl || "");
    if (!basis) return [];
    for (const quelle of KALENDER_QUELLEN) {
      try {
        const adresse = new URL(quelle.pfad, basis).href;
        // `holen` liefert { html, url } - und null, wenn die Seite nicht
        // antwortet. Beides muss hier ausgepackt werden, sonst sieht der Parser
        // "[object Object]" und findet nie etwas.
        const antwort = await holen(adresse);
        if (!antwort || !antwort.html) continue;
        const eintraege = quelle.art === "json"
          ? extractCalendarJson(antwort.html)
          : extractCalendarEntries(antwort.html);
        if (!eintraege.length) continue;
        protokoll(`${provider.name}: ${eintraege.length} Eintraege aus ${quelle.pfad}`);
        return eintraege.map((eintrag) => ({
          ...eintrag,
          url: absoluteHttpUrl(eintrag.url, basis),
          // Die Cover stehen relativ zur Anbieterseite.
          image: eintrag.image ? absoluteHttpUrl(eintrag.image, basis) : "",
          providerId: provider.id,
          providerName: provider.name || ""
        }));
      } catch {
        // Diese Quelle kennt der Anbieter nicht - die naechste ist dran.
      }
    }
    return [];
  }

  /**
   * Nur die kommende Woche.
   *
   * <p>S.to liefert ueber die Schnittstelle knapp drei Wochen am Stueck - dann
   * stuenden unter "Montag" gleich drei verschiedene Montage untereinander.
   */
  function wochenfilter() {
    const heute = new Date(jetzt());
    heute.setHours(0, 0, 0, 0);
    const grenze = new Date(heute);
    grenze.setDate(grenze.getDate() + KALENDER_TAGE);
    return (eintrag) => {
      if (!eintrag.date) return true;
      const wann = new Date(`${eintrag.date}T00:00:00`);
      return wann >= heute && wann < grenze;
    };
  }

  async function holenUndBauen() {
    const listen = await Promise.all(anbieter().map((provider) => vonAnbieter(provider)));
    const eintraege = listen.flat().filter(wochenfilter());

    // Welches Datum gehoert zu welchem Wochentag? Kommt aus den Eintraegen
    // selbst, damit die Reiter dasselbe zeigen wie die Karten darunter.
    const datumJeTag = {};
    for (const eintrag of eintraege) {
      if (eintrag.date && !datumJeTag[eintrag.day]) datumJeTag[eintrag.day] = eintrag.date;
    }
    return { days: [...WOCHENTAGE], dates: datumJeTag, entries: eintraege };
  }

  /**
   * Die Woche.
   *
   * <p>Zwei Dinge halten den Aufwand klein: der Zwischenspeicher und der
   * Merker auf den laufenden Abruf. Ohne den zweiten holt eine Ansicht, die
   * sich waehrend des Ladens neu zeichnet, jede Anbieterseite ein zweites Mal.
   */
  async function laden(refresh = false) {
    if (!refresh && cache && jetzt() - cache.at < KALENDER_CACHE_MS) return cache.daten;
    if (laufend) return laufend;
    laufend = holenUndBauen()
      .then((daten) => {
        // Ein leeres Ergebnis wird nicht abgelegt: sonst gilt ein Ausfall des
        // Netzes eine halbe Stunde lang als "diese Woche kommt nichts".
        if (daten.entries.length) cache = { at: jetzt(), daten };
        return daten;
      })
      .finally(() => {
        laufend = null;
      });
    return laufend;
  }

  /** Ob etwas im Zwischenspeicher liegt - fuer den Offline-Fall. */
  function ausCache() {
    return cache ? cache.daten : null;
  }

  function verwerfen() {
    cache = null;
  }

  return { laden, ausCache, verwerfen };
}

module.exports = {
  erstellen,
  KALENDER_QUELLEN,
  KALENDER_CACHE_MS,
  KALENDER_TAGE,
  WOCHENTAGE_LISTE: WOCHENTAGE
};
