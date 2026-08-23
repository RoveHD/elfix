"use strict";

// Intro ueberspringen - gelernt statt erkannt.
//
// Ein Intro zu *erkennen* geht hier nicht: ELFIX sieht das Video nie, es liegt
// im Rahmen des Hosters. Bild- oder Tonanalyse waere ohnehin ein anderes
// Programm.
//
// Also andersherum. Wer eine Serie schaut, spult das Intro selbst weg - jede
// Folge an derselben Stelle, um dieselbe Laenge. Diese Sprünge sind das
// Einzige, was ELFIX von einem Intro je erfahren kann, und sie sind genau: der
// Player meldet Anfang und Ziel auf die Sekunde. Aus zwei uebereinstimmenden
// Sprüngen in zwei verschiedenen Folgen wird eine Marke, und ab der naechsten
// Folge steht dort ein Knopf.
//
// Ein Knopf, kein Automatismus. Aus demselben Grund, aus dem die Bildstufe nur
// einmal je Folge gesetzt wird: ein Skript, das ungefragt eingreift, ist eine
// Bevormundung - und ein falscher Sprung kostet neunzig Sekunden Handlung, die
// man erst wiederfinden muss.
//
// Nur Intros, keine Abspanne. Was am Ende einer Folge zu tun ist, weiss ELFIX
// laengst: dort steht der Knopf zur naechsten Folge, mit Zaehler.

// Ein Intro liegt vorn. Was spaeter kommt, ist Handlung - da wird nichts
// gelernt, auch wenn jemand oft an derselben Stelle spult.
const FRUEHESTENS_S = 0;
const SPAETESTENS_S = 600;
// Kuerzer ist kein Intro, sondern ein Verspieler; laenger ist keine Titelmelodie
// mehr, sondern eine halbe Folge.
const MIN_DAUER_S = 20;
const MAX_DAUER_S = 180;
// So weit duerfen zwei Sprünge auseinanderliegen und trotzdem dasselbe meinen.
// Der Beginn schwankt staerker als die Laenge: davor liegt mal ein Rueckblick,
// mal keiner.
const TOLERANZ_BEGINN_S = 12;
const TOLERANZ_DAUER_S = 6;
// So viele Folgen muessen uebereinstimmen. Zwei, nicht eine: ein einzelner
// Sprung ist vielleicht Langeweile. Und zwei *verschiedene* Folgen - zweimal in
// derselben ist Herumspulen.
const BELEGE_NOETIG = 2;
// Mehr braucht niemand, um einen Median zu bilden. Was aelter ist, faellt raus -
// so folgt die Marke einem Intro, das ab Folge 40 kuerzer wird.
const MAX_SPRUENGE = 12;
// Wann der Knopf zu sehen ist: kurz bevor die Marke beginnt, und noch eine
// Weile danach. Wer zwei Sekunden zu spaet hinsieht, soll ihn nicht verpasst
// haben.
const FENSTER_VOR_S = 4;
const FENSTER_NACH_S = 25;

function zahl(wert) {
  const n = Number(wert);
  return Number.isFinite(n) ? n : 0;
}

// Taugt dieser Sprung als Beleg fuer ein Intro?
//
// Steht so auch im Skript in der Seite: dort entscheidet dieselbe Funktion, ob
// eine Meldung ueberhaupt hinausgeht. Zwei Auslegungen davon waeren zwei
// Wahrheiten - deshalb wird sie unten in den Quelltext hineingeschrieben statt
// noch einmal getippt.
function sprungLohnt(von, nach) {
  const start = Number(von);
  const ziel = Number(nach);
  if (!Number.isFinite(start) || !Number.isFinite(ziel)) return false;
  if (start < FRUEHESTENS_S || start > SPAETESTENS_S) return false;
  const dauer = ziel - start;
  return dauer >= MIN_DAUER_S && dauer <= MAX_DAUER_S;
}

function median(werte) {
  const sortiert = [...werte].sort((links, rechts) => links - rechts);
  if (!sortiert.length) return 0;
  const mitte = Math.floor(sortiert.length / 2);
  return sortiert.length % 2 ? sortiert[mitte] : (sortiert[mitte - 1] + sortiert[mitte]) / 2;
}

// Einen Sprung in die Liste aufnehmen. Rueckgabe ist die neue Liste - gerechnet
// wird ohne Nebenwirkung, damit der Aufrufer entscheidet, wann geschrieben wird.
function sprungAufnehmen(spruenge, sprung) {
  const liste = Array.isArray(spruenge) ? spruenge : [];
  const von = zahl(sprung?.von);
  const dauer = zahl(sprung?.nach) - von;
  if (!sprungLohnt(von, zahl(sprung?.nach))) return liste;
  const folge = zahl(sprung?.folge);
  // Je Folge zaehlt der letzte Sprung. Wer dreimal hintereinander nachjustiert,
  // hat am Ende einmal das Intro uebersprungen, nicht dreimal.
  const ohneDiese = liste.filter((eintrag) => zahl(eintrag.folge) !== folge);
  return [...ohneDiese, { folge, von, dauer, at: sprung?.at || new Date().toISOString() }]
    .slice(-MAX_SPRUENGE);
}

// Die Marke aus den gesammelten Sprüngen - oder null, solange sich nichts
// wiederholt hat.
//
// Gesucht wird die groesste Gruppe von Sprüngen, die einander aehneln. Nicht
// der Durchschnitt ueber alles: wer einmal mitten in die Folge gesprungen ist,
// zoege ihn sonst mit.
function markeAus(spruenge) {
  const liste = (Array.isArray(spruenge) ? spruenge : [])
    .filter((eintrag) => sprungLohnt(zahl(eintrag?.von), zahl(eintrag?.von) + zahl(eintrag?.dauer)));
  if (liste.length < BELEGE_NOETIG) return null;

  let beste = null;
  for (const kern of liste) {
    const gruppe = liste.filter((eintrag) => (
      Math.abs(zahl(eintrag.von) - zahl(kern.von)) <= TOLERANZ_BEGINN_S
      && Math.abs(zahl(eintrag.dauer) - zahl(kern.dauer)) <= TOLERANZ_DAUER_S
    ));
    const folgen = new Set(gruppe.map((eintrag) => zahl(eintrag.folge)));
    if (folgen.size < BELEGE_NOETIG) continue;
    if (!beste || folgen.size > beste.folgen) {
      beste = { gruppe, folgen: folgen.size };
    }
  }
  if (!beste) return null;

  return {
    von: Math.round(median(beste.gruppe.map((eintrag) => zahl(eintrag.von)))),
    dauer: Math.round(median(beste.gruppe.map((eintrag) => zahl(eintrag.dauer)))),
    belege: beste.folgen
  };
}

// Steht der Knopf jetzt an? Ausdruecklich ein Fenster und kein Zeitpunkt: der
// Beginn eines Intros schwankt von Folge zu Folge.
function markePasst(marke, position) {
  if (!marke) return false;
  const jetzt = zahl(position);
  return jetzt >= zahl(marke.von) - FENSTER_VOR_S && jetzt <= zahl(marke.von) + FENSTER_NACH_S;
}

// Wohin gesprungen wird. Das Ende des Intros ist die stabilere Groesse als sein
// Beginn - deshalb wird es aus der Marke gerechnet und nicht aus der Stelle, an
// der jemand gerade steht. Zurueck geht es dabei nie.
function zielZeit(marke, position) {
  if (!marke) return 0;
  return Math.max(zahl(position) + 1, zahl(marke.von) + zahl(marke.dauer));
}

// Der Schluessel, unter dem eine Marke liegt: Titel und Staffel.
//
// Nicht die Folge - dann waere jede Marke nach einmal Benutzen wertlos. Aber
// auch nicht nur der Titel: Intros wechseln zwischen Staffeln, und eine Marke
// aus Staffel 1 waere in Staffel 2 an der falschen Stelle.
function schluessel(titelSchluessel, staffel) {
  const titel = String(titelSchluessel || "").trim();
  if (!titel) return "";
  return `${titel}|s${Math.max(0, Math.round(zahl(staffel)))}`;
}

// --- Was in der Seite laeuft -------------------------------------------------
//
// Ein Skript, zwei Aufgaben, weil beide dieselbe Buchhaltung brauchen: die
// Stelle, an der der Player *vor* dem Spulen stand. Zum Zeitpunkt von "seeked"
// ist sie weg, also wird sie laufend aus "timeupdate" mitgeschrieben.
//
// Gemeldet wird ueber eine Konsolenzeile - denselben Weg nehmen der
// Folgenknopf und die Watchparty. In einer fremden Seite gibt es ohne Preload
// keinen anderen Kanal.
const MELDE_SPRUNG = "__elfix:sprung:";
const MELDE_GENUTZT = "__elfix:marke:genutzt";

function markenScript(marke, optionen = {}) {
  const daten = marke ? { von: zahl(marke.von), dauer: zahl(marke.dauer) } : null;
  return `(() => {
    ${zahl.toString()}
    ${sprungLohnt.toString()}
    ${markePasst.toString()}
    ${zielZeit.toString()}
    const FRUEHESTENS_S = ${FRUEHESTENS_S};
    const SPAETESTENS_S = ${SPAETESTENS_S};
    const MIN_DAUER_S = ${MIN_DAUER_S};
    const MAX_DAUER_S = ${MAX_DAUER_S};
    const FENSTER_VOR_S = ${FENSTER_VOR_S};
    const FENSTER_NACH_S = ${FENSTER_NACH_S};

    const marke = ${JSON.stringify(daten)};
    const lernen = ${optionen.lernen === false ? "false" : "true"};

    const videos = Array.from(document.querySelectorAll("video"))
      .filter((media) => Number(media.duration) > 0);
    const media = videos.sort((links, rechts) => rechts.duration - links.duration)[0];
    if (!media) return "kein-video";

    // Schon eingerichtet: dann nur die Marke nachreichen. Das Skript laeuft im
    // Fortschritts-Takt erneut, und ein zweiter Satz Ereignisse an demselben
    // Video wuerde jeden Sprung doppelt melden.
    if (window.__elfixMarke) return window.__elfixMarke.aktualisieren(marke, lernen);

    const zustand = { stelle: 0, marke, lernen, knopf: null, media };

    const knopfBauen = () => {
      const knopf = document.createElement("button");
      knopf.type = "button";
      knopf.textContent = "Intro überspringen";
      Object.assign(knopf.style, {
        position: "fixed",
        right: "26px",
        bottom: "92px",
        zIndex: "2147483000",
        display: "none",
        minHeight: "44px",
        padding: "0 20px",
        border: "0",
        borderRadius: "10px",
        background: "rgba(255, 255, 255, 0.94)",
        color: "#0b0f16",
        font: "800 15px/1 system-ui, sans-serif",
        boxShadow: "0 12px 34px rgba(0, 0, 0, 0.45)",
        cursor: "pointer"
      });
      knopf.addEventListener("click", (ereignis) => {
        ereignis.preventDefault();
        ereignis.stopPropagation();
        if (!zustand.marke) return;
        const ziel = zielZeit(zustand.marke, Number(zustand.media.currentTime) || 0);
        try {
          // Der eigene Sprung darf nicht als Beleg zurueckkommen - sonst
          // lernte die Marke von sich selbst.
          zustand.eigen = Date.now();
          zustand.media.currentTime = ziel;
          console.log(${JSON.stringify(MELDE_GENUTZT)});
        } catch (_) {
          // Ein Player, der sich nicht setzen laesst, bekommt eben keinen Sprung.
        }
        knopf.style.display = "none";
      }, true);
      (document.fullscreenElement || document.body).appendChild(knopf);
      return knopf;
    };

    const zeigen = () => {
      if (!zustand.marke) {
        if (zustand.knopf) zustand.knopf.style.display = "none";
        return;
      }
      if (!zustand.knopf) zustand.knopf = knopfBauen();
      // Im Vollbild haengt der Knopf sonst hinter dem Video: dort ist nicht das
      // Dokument der Rahmen, sondern das Vollbild-Element.
      const buehne = document.fullscreenElement || document.body;
      if (zustand.knopf.parentElement !== buehne) buehne.appendChild(zustand.knopf);
      const sichtbar = markePasst(zustand.marke, Number(zustand.media.currentTime) || 0);
      zustand.knopf.style.display = sichtbar ? "block" : "none";
    };

    // Die Stelle laufend mitschreiben - beim Spulen ist sie sonst weg, denn zum
    // Zeitpunkt von "seeked" steht dort laengst das Ziel.
    media.addEventListener("timeupdate", () => {
      // Waehrend eines Sprungs feuert timeupdate ebenfalls, und dann stuende
      // hier schon das Ziel. Deshalb der Merker: nur ausserhalb eines Sprungs
      // wird mitgeschrieben.
      if (!zustand.spult) zustand.stelle = Number(media.currentTime) || 0;
      zeigen();
    });

    media.addEventListener("seeking", () => {
      zustand.spult = true;
      zustand.vonStelle = zustand.stelle;
    });

    media.addEventListener("seeked", () => {
      zustand.spult = false;
      const von = Number(zustand.vonStelle) || 0;
      const nach = Number(media.currentTime) || 0;
      zustand.stelle = nach;
      // Der eigene Sprung von eben zaehlt nicht.
      const eigen = zustand.eigen && Date.now() - zustand.eigen < 2000;
      zustand.eigen = 0;
      if (!eigen && zustand.lernen && sprungLohnt(von, nach)) {
        console.log(${JSON.stringify(MELDE_SPRUNG)} + Math.round(von) + ":" + Math.round(nach));
      }
      zeigen();
    });

    window.__elfixMarke = {
      zustand,
      aktualisieren: (neueMarke, neuLernen) => {
        zustand.marke = neueMarke;
        zustand.lernen = neuLernen;
        zeigen();
        return neueMarke ? "marke" : "ohne-marke";
      },
      entfernen: () => {
        if (zustand.knopf && zustand.knopf.parentElement) zustand.knopf.parentElement.removeChild(zustand.knopf);
        zustand.knopf = null;
        zustand.marke = null;
      }
    };
    zeigen();
    return marke ? "marke" : "ohne-marke";
  })()`;
}

module.exports = {
  FRUEHESTENS_S,
  SPAETESTENS_S,
  MIN_DAUER_S,
  MAX_DAUER_S,
  BELEGE_NOETIG,
  MAX_SPRUENGE,
  FENSTER_VOR_S,
  FENSTER_NACH_S,
  MELDE_SPRUNG,
  MELDE_GENUTZT,
  sprungLohnt,
  median,
  sprungAufnehmen,
  markeAus,
  markePasst,
  zielZeit,
  schluessel,
  markenScript
};
