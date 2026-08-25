"use strict";

// Der Autostart einer Watchparty-Folge.
//
//   FOLGENWECHSEL -> Auftrag -> Seite laedt -> Player wecken -> Stand des Hosts
//                 -> Stelle setzen -> Play oder Pause -> nachsehen, ob es laeuft
//                 -> fertig, oder ein weiterer Versuch
//
// Warum es das ueberhaupt gibt. Am Rechner ist der Player nach einem Wechsel
// selbstverstaendlich da: `scheduleProviderAutoplay` klopft im Takt an, drueckt
// Play und liest zurueck, ob wirklich etwas laeuft. Auf Android endete die
// Kette im Vollbild - und zwar mit Absicht, weil ein blinder Tipp auf eine
// fremde Seite auch das Gegenteil bewirken kann. Fuer eine Runde ist das aber
// zu wenig: wer der Runde folgt, sitzt danach vor einem angehaltenen Bild,
// waehrend die anderen weiterschauen.
//
// Gemessen am 25.08.2026 auf dem Telefon (AniWorld -> VOE), und daran haengt
// jede Zeile hier:
//
//   - Der Hoster-Rahmen traegt ein `<video>` *ohne Quelle*: duration=null,
//     readyState=0, src="". Erst der Klick auf seine eigene Ueberlagerung
//     ("Spielen", `.jw-icon-display`) laedt die Quelle. Ein `play()` davor
//     laeuft ins Leere - es gibt nichts abzuspielen.
//   - Nach dem Klick stand duration=1371, readyState=4, paused=false. Autoplay
//     ist auf diesem Geraet also *nicht* gesperrt; es fehlte der Klick.
//
// Entschieden wird hier, ausgefuehrt wird woanders: die Funktionen sind rein,
// und das Skript wird - wie in `watchparty-sync.js` - aus dem Quelltext der
// Funktionen zusammengebaut, statt die Rechnung ein zweites Mal hinzuschreiben.

const { zielZeitBerechnen, alsQuelltext } = require("./watchparty-sync");

/** Womit ein Bericht des Startskripts anfaengt. Java und main.js lesen daran mit. */
const MELDE_START = "__elfix:wp:start:";

/**
 * Die Ueberlagerung, hinter der ein Hoster seine Quelle zurueckhaelt.
 *
 * <p>Dieselbe Liste, mit der der Rechner in `startPlaybackInView` seit jeher
 * gegen haengende Player anklopft - sie steht hier, damit es sie genau einmal
 * gibt und beide Geraete denselben Knopf treffen. Am 25.08.2026 gegen VOE
 * gemessen: `.jw-icon-display`, 88x88, Aufschrift "Spielen".
 */
const UEBERLAGERUNG_WAEHLER = [
  ".jw-icon-display",
  ".jw-display-icon-display",
  ".jw-display-icon-container",
  ".vjs-big-play-button",
  ".plyr__control--overlaid",
  "[class*='big-play']",
  "[class*='play-button']",
  "[class*='playButton']",
  "[class*='display-icon']",
  "[aria-label='Play']",
  "[title='Play']"
];

/** Wie oft ein Auftrag hoechstens anklopft. Danach ist es ein Fehlschlag mit Begruendung. */
const HOECHSTVERSUCHE = 4;
/** Wie lange ein Auftrag ueberhaupt gilt - danach ist die Lage eine andere. */
const AUFTRAG_FRIST_MS = 180000;
/** Wie lange auf den Bericht eines Versuchs gewartet wird, bevor der naechste kommt. */
const BERICHT_FRIST_MS = 9000;
/**
 * Der Abstand vor dem jeweiligen Versuch.
 *
 * <p>Der erste geht sofort, danach wird es ruhiger. Kein fester Zeitgeber:
 * gemessen auf gedrosselter Leitung war AniWorld nach 150 Sekunden noch nicht
 * fertig, und jede Frist, die als Notbremse kurz genug waere, bricht einen
 * langsamen, aber gesunden Ladevorgang ab.
 */
const ABSTAND_MS = [0, 2000, 4000, 8000];

/**
 * Ein Auftrag.
 *
 * <p>Er traegt alles, woran spaeter zu erkennen ist, ob er noch gemeint ist:
 * Raum und Titel (in einem Raum laufen mehrere Titel), Staffel und Folge, die
 * Zieladresse, eine laufende Nummer und die Zeit. Dazu, was vom Host bekannt
 * war, als er entstand - benutzt wird das nur als Vorgabe; unmittelbar vor dem
 * Start wird der Stand ohnehin neu geholt.
 */
function auftragAnlegen(angaben = {}) {
  const generation = Number(angaben.generation) || 0;
  const raum = String(angaben.raum || "");
  const key = String(angaben.key || "");
  const season = Number(angaben.season) || 0;
  const episode = Number(angaben.episode) || 0;
  return {
    id: `${raum}|${key}|s${season}e${episode}|${generation}`,
    generation,
    raum,
    key,
    season,
    episode,
    url: String(angaben.url || ""),
    hostId: String(angaben.hostId || ""),
    playing: Boolean(angaben.playing),
    // Ein oertlicher Auftrag ist derselbe Ablauf ohne Runde: Weiterschauen
    // druecken, und die Folge soll wirklich laufen statt im Vollbild zu
    // stehen. Er fragt niemanden nach dem Stand - er hat ihn schon
    // ({@code stelle}) - und benutzt sonst dieselben Fristen, dieselben
    // Abstaende und dasselbe Startskript. Zwei Ablaeufe nebeneinander waeren
    // zwei Fassungen derselben Sache, und eine davon liefe irgendwann falsch.
    oertlich: Boolean(angaben.oertlich),
    stelle: Number(angaben.stelle) || 0,
    erstellt: Number(angaben.jetzt) || 0,
    versuche: 0,
    letzterVersuch: 0,
    fertig: false,
    grund: ""
  };
}

/**
 * Meint dieser Auftrag noch, was gerade offen steht?
 *
 * <p>Die Frage, an der ein veralteter Auftrag scheitert. Ein Auftrag gilt nur
 * fuer seinen Raum, seinen Titel und seine Folge - und nur, solange keine
 * neuere Generation da ist. Damit kann ein Auftrag von vorhin nicht spaeter die
 * falsche Folge starten, und ein Ereignis eines anderen Titels im selben Raum
 * ruehrt ihn nicht an.
 */
function auftragGilt(auftrag, lage = {}) {
  if (!auftrag || auftrag.fertig) return false;
  const jetzt = Number(lage.jetzt) || 0;
  if (auftrag.erstellt && jetzt - auftrag.erstellt > AUFTRAG_FRIST_MS) return false;
  // Eine neuere Generation hat das letzte Wort: der Host hat noch einmal
  // gewechselt, waehrend dieser Auftrag noch lud.
  if (Number(lage.generation || 0) > auftrag.generation) return false;
  if (lage.raum !== undefined && String(lage.raum || "") !== auftrag.raum) return false;
  if (lage.key !== undefined && String(lage.key || "") !== auftrag.key) return false;
  // Staffel und Folge zaehlen nur, wenn beide Seiten sie kennen: waehrend die
  // Seite noch laedt, steht hier oft noch gar keine Folge.
  const season = Number(lage.season) || 0;
  const episode = Number(lage.episode) || 0;
  if (episode && auftrag.episode && (episode !== auftrag.episode || season !== auftrag.season)) {
    return false;
  }
  return true;
}

/**
 * Was als Naechstes zu tun ist.
 *
 * @param lage { jetzt, generation, raum, key, season, episode, berichtOffenSeit }
 * @return { tun: "anfordern"|"warten"|"aufgeben", grund, wartenMs }
 */
function naechsterSchritt(auftrag, lage = {}) {
  const jetzt = Number(lage.jetzt) || 0;
  if (!auftrag) return { tun: "aufgeben", grund: "kein auftrag", wartenMs: 0 };
  if (auftrag.fertig) return { tun: "aufgeben", grund: auftrag.grund || "fertig", wartenMs: 0 };
  if (!auftragGilt(auftrag, lage)) return { tun: "aufgeben", grund: "veraltet", wartenMs: 0 };

  // Ein Versuch laeuft noch: der Player hat Zeit, sich zu melden. Ohne diese
  // Geduld schoesse der naechste Versuch in den laufenden hinein, und zwei
  // gleichzeitige Anlaeufe pausieren einander zuverlaessig.
  const offenSeit = Number(lage.berichtOffenSeit) || 0;
  if (offenSeit && jetzt - offenSeit < BERICHT_FRIST_MS) {
    return { tun: "warten", grund: "bericht offen", wartenMs: BERICHT_FRIST_MS - (jetzt - offenSeit) };
  }

  if (auftrag.versuche >= HOECHSTVERSUCHE) {
    return { tun: "aufgeben", grund: auftrag.grund || "kein start nach " + HOECHSTVERSUCHE + " Versuchen", wartenMs: 0 };
  }

  const abstand = ABSTAND_MS[Math.min(auftrag.versuche, ABSTAND_MS.length - 1)];
  if (auftrag.letzterVersuch && jetzt - auftrag.letzterVersuch < abstand) {
    return { tun: "warten", grund: "abstand", wartenMs: abstand - (jetzt - auftrag.letzterVersuch) };
  }
  return { tun: "anfordern", grund: "versuch " + (auftrag.versuche + 1), wartenMs: 0 };
}

/** Einen Versuch verbuchen. Der Auftrag wird dabei fortgeschrieben. */
function versuchVermerken(auftrag, jetzt) {
  if (!auftrag) return auftrag;
  auftrag.versuche += 1;
  auftrag.letzterVersuch = Number(jetzt) || 0;
  return auftrag;
}

/**
 * Einen Bericht des Startskripts einarbeiten.
 *
 * <p>Ein Bericht aus einem anderen Auftrag wird abgewiesen - sonst meldete der
 * Player der vorigen Folge diesen hier als erledigt.
 *
 * @return ob der Bericht zu diesem Auftrag gehoerte
 */
function berichtVerarbeiten(auftrag, bericht) {
  if (!auftrag || !bericht) return false;
  if (String(bericht.auftrag || "") !== auftrag.id) return false;
  auftrag.grund = String(bericht.grund || bericht.zustand || "");
  if (bericht.ok) {
    auftrag.fertig = true;
    auftrag.grund = String(bericht.zustand || "laeuft");
  }
  return true;
}

/** Eine Berichtszeile zerlegen: `__elfix:wp:start:{...}`. */
function berichtLesen(zeile) {
  const text = String(zeile || "");
  if (!text.startsWith(MELDE_START)) return null;
  try {
    const wert = JSON.parse(text.slice(MELDE_START.length));
    return wert && typeof wert === "object" ? wert : null;
  } catch (_) {
    return null;
  }
}

/**
 * Das Skript, das im Rahmen des Hosters wirklich startet.
 *
 * <p>Es geht in *alle* gemeldeten Rahmen und nicht nur in die mit Video: das
 * ist der Punkt. Solange die Quelle nicht geladen ist, gibt es kein Video mit
 * Laufzeit, und ein Skript, das nur dorthin faehrt, kaeme nie an. Ein Rahmen
 * ohne jedes `<video>` ist trotzdem still - Werberahmen bringen keins mit, und
 * dort wird nichts angeklickt.
 *
 * <p>Der Bericht geht ueber die Konsole hinaus, wie alle Meldungen aus dem
 * Player: das ist der einzige Weg, der aus einem fremden Rahmen heraus auf
 * beiden Geraeten funktioniert. `evaluateJavascript` erreicht ihn nicht, und
 * der Rueckkanal der Rahmen traegt keine Antwort.
 */
function startScript(auftragId, ereignis, optionen = {}) {
  const kennung = JSON.stringify(String(auftragId || ""));
  const waehler = JSON.stringify(UEBERLAGERUNG_WAEHLER);
  const sollLaufen = optionen.playing ? "true" : "false";
  const melde = JSON.stringify(MELDE_START);
  return `(async () => {
    ${alsQuelltext(zielZeitBerechnen)}

    const AUFTRAG = ${kennung};
    const WAEHLER = ${waehler};
    const SOLL_LAUFEN = ${sollLaufen};
    const E = ${JSON.stringify(ereignisSaeubern(ereignis))};
    const versatz = ${Number(ereignis && ereignis.versatz) || 0};
    const zielJetzt = () => zielZeitBerechnen(E, Date.now() + versatz);

    const berichten = (ok, zustand, grund, stelle) => {
      try {
        console.log(${melde} + JSON.stringify({
          auftrag: AUFTRAG,
          ok: Boolean(ok),
          zustand: String(zustand || ""),
          grund: String(grund || ""),
          stelle: Number(stelle) || 0
        }));
      } catch (_) {}
    };

    // Ein Rahmen ganz ohne Videoelement ist nicht der Player. Still bleiben:
    // hier wird nichts gesucht, nichts geklickt und nichts gemeldet.
    const alle = () => Array.from(document.querySelectorAll("video"));
    if (!alle().length) return "kein-player";

    // Das groesste Video mit Laufzeit - und solange keins eine hat, irgendeins:
    // vor dem Klick auf die Ueberlagerung traegt es weder Quelle noch Dauer.
    const holen = () => {
      const mitZeit = alle().filter((m) => Number(m.duration) > 0);
      if (mitZeit.length) return mitZeit.sort((a, b) => b.duration - a.duration)[0];
      return alle()[0] || null;
    };

    const warten = (bedingung, frist) => new Promise((fertig) => {
      const bis = Date.now() + frist;
      const sehen = () => {
        let wert = null;
        try { wert = bedingung(); } catch (_) { wert = null; }
        if (wert) return fertig(wert);
        if (Date.now() > bis) return fertig(null);
        setTimeout(sehen, 60);
      };
      sehen();
    });

    const sichtbar = (knoten) => {
      try {
        const stil = getComputedStyle(knoten);
        const feld = knoten.getBoundingClientRect();
        return stil.display !== "none" && stil.visibility !== "hidden"
          && Number(stil.opacity || 1) > 0.05 && feld.width > 24 && feld.height > 24;
      } catch (_) {
        return false;
      }
    };

    // Ein echter Klick und kein .click(): manche Player horchen auf
    // pointerdown und lassen den blossen Klick liegen.
    const klicken = (knoten) => {
      try {
        const feld = knoten.getBoundingClientRect();
        const wie = {
          bubbles: true, cancelable: true, view: window,
          clientX: feld.left + feld.width / 2, clientY: feld.top + feld.height / 2
        };
        knoten.dispatchEvent(new PointerEvent("pointerdown", wie));
        knoten.dispatchEvent(new MouseEvent("mousedown", wie));
        knoten.dispatchEvent(new PointerEvent("pointerup", wie));
        knoten.dispatchEvent(new MouseEvent("mouseup", wie));
        knoten.dispatchEvent(new MouseEvent("click", wie));
        return true;
      } catch (_) {
        try { knoten.click(); return true; } catch (__) { return false; }
      }
    };

    const ueberlagerung = () => {
      for (const w of WAEHLER) {
        let treffer = [];
        try { treffer = Array.from(document.querySelectorAll(w)); } catch (_) { treffer = []; }
        const knoten = treffer.filter(sichtbar)[0];
        if (knoten) return knoten;
      }
      return null;
    };

    let media = holen();
    // Die Quelle haengt noch hinter der Ueberlagerung des Hosters. Gemessen bei
    // VOE: davor duration=null und readyState=0, danach duration=1371 und
    // readyState=4. Ohne diesen Klick startet nichts, egal wie oft play()
    // gerufen wird.
    if (!media || !(Number(media.duration) > 0)) {
      const knopf = ueberlagerung();
      if (!knopf) {
        berichten(false, "keine-quelle", "video ohne Laufzeit und keine Ueberlagerung", 0);
        return "keine-quelle";
      }
      klicken(knopf);
      media = await warten(() => {
        const m = holen();
        return m && Number(m.duration) > 0 ? m : null;
      }, 8000);
      if (!media) {
        berichten(false, "keine-quelle", "Ueberlagerung geklickt, Quelle blieb aus", 0);
        return "keine-quelle";
      }
    }

    try { if (media.playbackRate !== 1) media.playbackRate = 1; } catch (_) {}

    // Der Klick auf die Ueberlagerung startet die Wiedergabe. Steht der Host,
    // gehoert sie sofort wieder angehalten - lieber ein Wimpernschlag Ton als
    // ein Gast, der als Einziger laeuft.
    if (!SOLL_LAUFEN) {
      try { media.pause(); } catch (_) {}
    }

    const ziel = zielJetzt();
    const springbar = ziel >= 0 && ziel < Number(media.duration) - 1;
    if (springbar && Math.abs(Number(media.currentTime) - ziel) > 0.5) {
      try { media.currentTime = ziel; } catch (_) {}
    }

    // Was der eigene Horcher gleich melden wird, ist das Echo dieser Anweisung
    // und keine eigene Tat. Dieselbe Liste, die applyScript fuehrt - eine
    // zweite waere eine zweite Wahrheit, und der Horcher liest nur eine.
    try {
      const merken = {
        aktion: SOLL_LAUFEN ? "play" : "pause",
        ziel,
        bis: Date.now() + 4000
      };
      window.__elfixWpErwartet = merken;
      const bisher = Array.isArray(window.__elfixWpEcho) ? window.__elfixWpEcho : [];
      window.__elfixWpEcho = bisher
        .filter((eintrag) => eintrag && Date.now() < eintrag.bis)
        .concat([merken])
        .slice(-6);
    } catch (_) {}

    if (!SOLL_LAUFEN) {
      try { media.pause(); } catch (_) {}
      const steht = await warten(() => (media.paused ? "ja" : null), 1500);
      berichten(true, "pausiert", steht ? "" : "bleibt laufend", media.currentTime);
      return "pausiert";
    }

    // Genug geladen abwarten und unmittelbar davor noch einmal nachrechnen -
    // der Host hat waehrend des Puffems ja weitergeschaut.
    await warten(() => (media.readyState >= 3 && !media.seeking ? "ja" : null), 2500);
    const nachgerechnet = zielJetzt();
    if (springbar && Math.abs(Number(media.currentTime) - nachgerechnet) > 0.35) {
      try { media.currentTime = nachgerechnet; } catch (_) {}
    }
    try { window.__elfixWpErwartet.ziel = zielJetzt(); } catch (_) {}

    // Und hier wird das Versprechen von play() wirklich ausgewertet. Es still
    // wegzufangen war der Grund, warum ein Fehlschlag wie ein Erfolg aussah.
    let abgelehnt = "";
    try {
      const versprechen = media.play();
      if (versprechen && typeof versprechen.then === "function") {
        await versprechen.catch((fehler) => {
          abgelehnt = String((fehler && (fehler.name + ": " + fehler.message)) || fehler).slice(0, 120);
        });
      }
    } catch (fehler) {
      abgelehnt = String((fehler && fehler.message) || fehler).slice(0, 120);
    }

    // Nicht "play() hat nicht geworfen", sondern "die Stelle laeuft weiter":
    // ein Player, der am Puffern haengt, meldet paused=false und steht still.
    const vorher = Number(media.currentTime) || 0;
    const laeuft = await warten(() => {
      const jetzt = Number(media.currentTime) || 0;
      return !media.paused && !media.ended && media.readyState >= 2 && jetzt > vorher + 0.15 ? "ja" : null;
    }, 4000);

    if (laeuft) {
      berichten(true, "laeuft", "", media.currentTime);
      return "laeuft";
    }
    berichten(false, "blockiert", abgelehnt || ("paused=" + media.paused + " ready=" + media.readyState),
      media.currentTime);
    return "blockiert";
  })()`;
}

/** Nur die vier Angaben, mit denen im Player gerechnet wird. Wie in watchparty-sync. */
function ereignisSaeubern(ereignis) {
  return {
    videoTime: Number(ereignis && ereignis.videoTime) || 0,
    timestamp: Number(ereignis && ereignis.timestamp) || 0,
    playing: Boolean(ereignis && ereignis.playing),
    hatUhr: Boolean(ereignis && ereignis.hatUhr)
  };
}

module.exports = {
  MELDE_START,
  UEBERLAGERUNG_WAEHLER,
  HOECHSTVERSUCHE,
  AUFTRAG_FRIST_MS,
  BERICHT_FRIST_MS,
  ABSTAND_MS,
  auftragAnlegen,
  auftragGilt,
  naechsterSchritt,
  versuchVermerken,
  berichtVerarbeiten,
  berichtLesen,
  startScript
};
