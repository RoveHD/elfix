"use strict";

/*
 * Intro ueberspringen - die Verkabelung, nicht die Regel.
 *
 * Was aus zwei Spruengen eine Marke macht, wie gross die Toleranz ist und wann
 * der Knopf ueberhaupt erscheint, steht in `marken.js`, demselben Modul wie am
 * Rechner. Hier steht das Gegenstueck zu main.js: unter welchem Schluessel die
 * Marke dieser Seite liegt, welcher Bestand gilt und was Java zu speichern hat.
 *
 * Der Schluessel traegt die Staffel - anders als bei der Fassung. Ein Intro
 * kann ab Staffel 2 ein anderes sein; die Sprache, in der man eine Serie
 * schaut, aendert sich nicht.
 */
(function () {
  const marken = require("marken");
  const fortschritt = require("fortschritt");
  const taste = require("taste");

  // Schluessel -> {spruenge: [...], marke: {...}|null}, wie marken.json am
  // Rechner sie traegt.
  let bestand = {};

  function laden(eintraege) {
    bestand = eintraege && typeof eintraege === "object" ? eintraege : {};
    return Object.keys(bestand).length;
  }

  function schluesselFuer(eintraege, anbieter, url) {
    const identity = fortschritt.episodeIdentity(url);
    if (!identity) return "";
    const liste = Array.isArray(eintraege) ? eintraege : [];
    const treffer = liste.find((eintrag) => eintrag
      && eintrag.providerId === (anbieter && anbieter.id)
      && (fortschritt.episodeIdentity(eintrag.url) || {}).key === identity.key);
    const titel = taste.titelSchluessel(
      (treffer && treffer.title) || fortschritt.cleanBaseMediaTitle("", url));
    return marken.schluessel(titel, identity.season);
  }

  /**
   * Das Skript fuer diese Folge.
   *
   * <p>`lernen` ist aus, solange eine Watchparty laeuft: der Player wird dort
   * staendig auf den Host gezogen, und diese Spruenge sind nicht die
   * Entscheidung dessen, der hier sitzt.
   */
  function skript(eintraege, anbieter, url, lernen) {
    const schluessel = schluesselFuer(eintraege, anbieter, url);
    if (!schluessel) return { skript: "", schluessel: "", marke: null };
    const eintrag = bestand[schluessel];
    const marke = (eintrag && eintrag.marke) || null;
    return {
      skript: marken.markenScript(marke, { lernen: lernen !== false }),
      schluessel,
      marke
    };
  }

  /** Das Skript, das den Knopf sofort wegnimmt - beim Abschalten. */
  function abschalten() {
    return "window.__elfixMarke && window.__elfixMarke.entfernen()";
  }

  /**
   * Ein Sprung aus der Seite.
   *
   * <p>Zurueck kommt nur, wenn sich wirklich etwas geaendert hat - `marken.js`
   * gibt bei einem Sprung, der nichts beitraegt, dieselbe Liste zurueck.
   */
  function sprung(eintraege, anbieter, url, von, nach) {
    const schluessel = schluesselFuer(eintraege, anbieter, url);
    if (!schluessel) return null;
    const identity = fortschritt.episodeIdentity(url);
    const vorher = bestand[schluessel] || { spruenge: [], marke: null };
    const spruenge = marken.sprungAufnehmen(vorher.spruenge, {
      folge: (identity && identity.episode) || 0,
      von,
      nach
    });
    if (spruenge === vorher.spruenge) return null;

    const marke = marken.markeAus(spruenge);
    bestand = { ...bestand, [schluessel]: { spruenge, marke } };

    const vorherBelege = (vorher.marke && vorher.marke.belege) || 0;
    const neu = marke && marke.belege > vorherBelege;
    return {
      eintraege: bestand,
      schluessel,
      marke,
      // Erst ab der zweiten Uebereinstimmung gibt es ueberhaupt etwas zu
      // zeigen - vorher ist es ein einzelner Sprung und keine Erkenntnis.
      ansage: neu && vorherBelege === 0
        ? "Intro gemerkt — ab der nächsten Folge steht der Knopf da"
        : "",
      log: marke
        ? `${schluessel}: Intro bei ${marke.von}s, ${marke.dauer}s lang (${marke.belege} Folgen)`
        : `${schluessel}: Sprung aufgenommen`
    };
  }

  /** Die Meldung aus der Seite lesen: "__elfix:sprung:<von>:<nach>". */
  function sprungLesen(zeile) {
    const text = String(zeile || "");
    if (!text.startsWith(marken.MELDE_SPRUNG)) return null;
    const teile = text.slice(marken.MELDE_SPRUNG.length).split(":");
    if (teile.length < 2) return null;
    const von = Number(teile[0]);
    const nach = Number(teile[1]);
    if (!Number.isFinite(von) || !Number.isFinite(nach)) return null;
    return { von, nach };
  }

  /** Was gemerkt wurde - fuer die Einstellungen. */
  function stand() {
    const schluessel = Object.keys(bestand);
    const mitMarke = schluessel.filter((name) => bestand[name] && bestand[name].marke);
    return { titel: schluessel.length, marken: mitMarke.length };
  }

  function vergessen() {
    const anzahl = Object.keys(bestand).length;
    bestand = {};
    return anzahl;
  }

  module.exports = {
    laden,
    skript,
    abschalten,
    sprung,
    sprungLesen,
    stand,
    vergessen,
    MELDE_SPRUNG: marken.MELDE_SPRUNG,
    MELDE_GENUTZT: marken.MELDE_GENUTZT
  };
})();
