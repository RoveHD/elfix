"use strict";

// SponsorBlock - die bezahlten Einschuebe in YouTube-Videos ueberspringen.
//
// **Erkannt wird hier nichts.** Was ein Sponsorenblock ist, entscheiden die
// Leute, die ihn gemeldet haben; ELFIX holt das fertige Ergebnis bei
// sponsor.ajay.app und springt. Ein eigener Erkenner waere ein anderes
// Programm - und ein schlechteres, denn er saehe nur dieses eine Video, waehrend
// dort Tausende dasselbe schon eingetragen haben.
//
// **Nur YouTube.** Jede Funktion hier bekommt eine Videokennung, und die gibt
// es nur fuer YouTube-Adressen (youtube.js). An AniWorld, S.to, VOE, Streamtape
// und allem anderen aendert sich dadurch nichts - dort wird nicht einmal
// gefragt.
//
// **Der Weg der Daten.**
//
//   Adresse -> youtube.videoKennung -> Praefix des SHA-256 -> API -> Segmente
//           -> nach Einstellungen filtern -> Skript in die Seite -> Sprung
//
// Gefragt wird mit den ersten vier Zeichen des SHA-256 der Videokennung und
// nicht mit der Kennung selbst. Das ist der Weg, den auch die Erweiterung
// nimmt: die Antwort enthaelt dann alle Videos mit diesem Praefix - reichlich
// tausend -, und der Dienst erfaehrt nicht, welches davon hier laeuft. Fuer
// eine App, die nebenbei Werbung und Verfolger blockt, waere die genaue
// Kennung die falsche Wahl.
//
// **Was die API kennt.** Kategorien sind heute: sponsor, selfpromo,
// interaction, intro, outro, preview, music_offtopic, filler,
// exclusive_access, poi_highlight und chapter. ELFIX bietet die ersten fuenf
// an - die uebrigen sind entweder keine Werbung (preview, filler), gar keine
// Sprungmarke (chapter, poi_highlight) oder eine Warnung ohne Zeitbereich
// (exclusive_access). Geholt werden nur die fuenf; was der Dienst sonst
// zurueckgibt, faellt bei der Pruefung heraus.
//
// **Und die YouTube-Watchparty?** Sie laeuft weiter, und zwar ohne eine einzige
// Sonderregel. Der Sprung hier ist ein gewoehnlicher Sprung im Player: der
// Horcher der Runde (youtube-sync.js) meldet ihn wie jeden anderen, das Relay
// nimmt ihn auf, und alle springen mit. Das ist auch die richtige Antwort -
// wer in einer Runde einen Sponsorenblock ueberspringt, ueberspringt ihn fuer
// die Runde, genau wie beim Vorspulen von Hand.
//
// Umgekehrt gilt dasselbe: zieht die Runde den Player in ein Segment hinein -
// weil jemand dorthin zurueckgespult hat -, behandelt das Skript das wie ein
// Zurueckspulen von Hand und laesst dieses Segment fuer den Durchlauf in Ruhe.
// Sonst spraengen zwei Programme gegeneinander an, und der Mensch dazwischen
// gaebe auf.
//
// **Und `actionType`.** Ein Segment kann "skip", "mute", "full" oder "poi"
// sein. Uebersprungen wird nur "skip": "full" meint das ganze Video, "mute"
// waere ein Eingriff in die Lautstaerke, und "poi" ist ein einzelner Punkt
// ohne Dauer.

const crypto = require("crypto");

const WIRT = "https://sponsor.ajay.app";

// Die Kategorien, die ELFIX anbietet - in genau der Schreibweise der API.
const KATEGORIEN = ["sponsor", "selfpromo", "interaction", "intro", "outro"];

// Was die API sonst noch kennt. Steht hier, damit der naechste Leser nicht
// suchen muss, warum die Liste oben kuerzer ist - nicht als Vorrat zum
// Anschalten.
const WEITERE_KATEGORIEN = [
  "preview", "music_offtopic", "filler", "exclusive_access", "poi_highlight", "chapter"
];

// Standard: was Werbung ist, faellt weg; was zum Video gehoert, bleibt.
//
// Intro und Outro sind ausdruecklich aus. Ein Intro ist keine Werbung, sondern
// die Serie - wer es wegspringen will, schaltet es ein.
const STANDARD = {
  enabled: true,
  sponsor: true,
  selfpromo: true,
  interaction: true,
  intro: false,
  outro: false,
  hinweis: true
};

// Kuerzere Segmente werden nicht angefasst. Ein Sprung ueber eine halbe
// Sekunde bringt nichts und laesst den Player neu puffern - das faellt mehr auf
// als das, was da uebersprungen wuerde.
const MIN_DAUER_S = 1;
// So viele Segmente reichen fuer jedes Video. Mehr waere ein Zeichen dafuer,
// dass die Antwort nicht zu diesem Video gehoert - und ein Skript, das mit
// hundert Bereichen rechnet, laeuft bei jedem timeupdate durch sie alle.
const MAX_SEGMENTE = 48;

const MELDE = "__elfix:sponsorblock:";

/**
 * Die Einstellungen in eine Form bringen, auf die sich alles Weitere verlassen
 * kann.
 *
 * <p>Fehlt etwas, gilt der Standard - und zwar auch dann, wenn die ganze
 * Abteilung fehlt. Eine Ablage aus einer aelteren Fassung kennt sie nicht.
 */
function einstellungenLesen(roh) {
  const wert = (name) => (typeof roh?.[name] === "boolean" ? roh[name] : STANDARD[name]);
  return {
    enabled: wert("enabled"),
    sponsor: wert("sponsor"),
    selfpromo: wert("selfpromo"),
    interaction: wert("interaction"),
    intro: wert("intro"),
    outro: wert("outro"),
    hinweis: wert("hinweis")
  };
}

/** Welche Kategorien dieser Benutzer wirklich uebersprungen haben will. */
function kategorienAus(einstellungen) {
  const gelesen = einstellungenLesen(einstellungen);
  if (!gelesen.enabled) return [];
  return KATEGORIEN.filter((name) => gelesen[name] === true);
}

/**
 * Die ersten vier Zeichen des SHA-256 der Videokennung.
 *
 * <p>Damit wird gefragt. Der Dienst sieht ein Praefix, das auf tausende Videos
 * passt, und nicht das eine, das hier laeuft.
 */
function hashPraefix(videoId) {
  const kennung = String(videoId || "");
  if (!kennung) return "";
  return crypto.createHash("sha256").update(kennung).digest("hex").slice(0, 4);
}

/**
 * Die Adresse der Anfrage.
 *
 * <p>Geholt werden immer alle fuenf Kategorien und nicht nur die eingeschalteten.
 * Zwei Gruende: die Antwort liegt dann fuer jede Einstellung schon da - wer
 * "Intros ueberspringen" einschaltet, braucht keine neue Anfrage -, und der
 * Dienst erfaehrt nichts darueber, was hier eingeschaltet ist.
 */
function anfrageUrl(praefix) {
  const teil = String(praefix || "").toLowerCase();
  if (!/^[0-9a-f]{4}$/.test(teil)) return "";
  const felder = [
    `categories=${encodeURIComponent(JSON.stringify(KATEGORIEN))}`,
    `actionTypes=${encodeURIComponent(JSON.stringify(["skip"]))}`
  ];
  return `${WIRT}/api/skipSegments/${teil}?${felder.join("&")}`;
}

// Eine Zeitangabe ist eine Zahl. Nicht eine Zeichenkette, die sich in eine
// verwandeln laesst: was der Dienst schickt, ist JSON, und dort steht eine Zahl
// als Zahl. Kommt sie als Text, stimmt an dieser Antwort etwas nicht - und
// dann ist Nichtstun die richtige Antwort.
function zahl(wert) {
  return typeof wert === "number" && Number.isFinite(wert) ? wert : null;
}

/**
 * Die Segmente eines Videos aus der Antwort - streng gelesen.
 *
 * <p>Die Antwort kommt von einem fremden Dienst, und was hier durchgeht, wird
 * gleich darauf in ein Skript geschrieben, das in der YouTube-Seite laeuft.
 * Also kommt nichts durch, das nicht zu erwarten war: die Kategorie muss eine
 * der bekannten sein, der Zeitbereich zwei endliche Zahlen mit Ende nach
 * Anfang, und in das Skript geht am Ende nur, was diese Pruefung ueberlebt hat
 * - Zahlen und Namen aus der eigenen Liste, keine Zeichenkette von draussen.
 *
 * <p>Die Antwort auf das Hash-Praefix enthaelt viele Videos; gemeint ist nur
 * das eine. Die Form der Antwort auf die einfache Anfrage (eine Liste von
 * Segmenten) wird ebenfalls gelesen - dieselbe Pruefung, nur ein Schritt
 * weniger.
 */
function segmenteAus(antwort, videoId) {
  const kennung = String(videoId || "");
  if (!kennung || !Array.isArray(antwort)) return [];

  let roh = [];
  if (antwort.length && antwort.some((eintrag) => Array.isArray(eintrag?.segments))) {
    for (const eintrag of antwort) {
      if (String(eintrag?.videoID || "") !== kennung) continue;
      if (Array.isArray(eintrag.segments)) roh = roh.concat(eintrag.segments);
    }
  } else {
    roh = antwort;
  }

  const segmente = [];
  for (const eintrag of roh) {
    if (!eintrag || typeof eintrag !== "object") continue;
    const kategorie = String(eintrag.category || "");
    if (!KATEGORIEN.includes(kategorie)) continue;
    // Fehlt die Angabe, ist es ein Sprungsegment - so verhaelt sich die API.
    const art = eintrag.actionType === undefined ? "skip" : String(eintrag.actionType);
    if (art !== "skip") continue;
    if (!Array.isArray(eintrag.segment) || eintrag.segment.length < 2) continue;
    const von = zahl(eintrag.segment[0]);
    const bis = zahl(eintrag.segment[1]);
    if (von === null || bis === null) continue;
    if (von < 0 || bis <= von) continue;
    if (bis - von < MIN_DAUER_S) continue;
    segmente.push({ von, bis, kategorie });
  }

  return segmente
    .sort((links, rechts) => links.von - rechts.von)
    .slice(0, MAX_SEGMENTE);
}

/** Nur die Kategorien, die eingeschaltet sind. */
function gefiltert(segmente, einstellungen) {
  const erlaubt = kategorienAus(einstellungen);
  if (!erlaubt.length) return [];
  return (Array.isArray(segmente) ? segmente : []).filter(
    (eintrag) => erlaubt.includes(eintrag?.kategorie));
}

/**
 * Das Segment, in dem die Wiedergabe gerade steht - oder null.
 *
 * <p>Diese Funktion faellt die einzige Entscheidung, die es hier zu faellen
 * gibt, und sie wird woertlich in das Skript gesetzt (siehe unten). Die
 * Pruefungen fahren also dieselbe Funktion, die im Player laeuft.
 *
 * <p>{@code aus} sind die Segmente, die fuer diesen Durchlauf nicht mehr
 * gelten: der Benutzer hat "Rueckgaengig" gedrueckt oder ist von sich aus
 * dorthin zurueckgespult. Sie kommen nie wieder - das ist die ganze
 * Schutzlogik, und mehr braucht es nicht.
 *
 * <p>Kurz vor dem Ende wird nicht mehr gesprungen ({@code bis - 0.5}). Sonst
 * loeste der Sprung sich selbst wieder aus: das Ziel liegt an der Grenze, und
 * ein Player, der eine Zehntelsekunde davor landet, spraenge erneut.
 */
function sprungFuer(segmente, stelle, aus) {
  const jetzt = Number(stelle);
  if (!Array.isArray(segmente) || !Number.isFinite(jetzt)) return null;
  const ausnahmen = Array.isArray(aus) ? aus : [];
  for (let i = 0; i < segmente.length; i += 1) {
    const eintrag = segmente[i];
    if (!eintrag || ausnahmen.indexOf(i) >= 0) continue;
    if (jetzt >= eintrag.von - 0.15 && jetzt < eintrag.bis - 0.5) {
      return { index: i, von: eintrag.von, bis: eintrag.bis, kategorie: eintrag.kategorie };
    }
  }
  return null;
}

/**
 * In welches Segment jemand von Hand zurueckgespult ist.
 *
 * <p>Wer das tut, will es sehen. Das Segment gilt dann fuer diesen Durchlauf
 * nicht mehr - sonst spraenge das Skript sofort wieder dagegen an, und der
 * Benutzer kaeme nicht dorthin, wo er hinwollte.
 */
function rueckkehrFuer(segmente, stelle) {
  const jetzt = Number(stelle);
  if (!Array.isArray(segmente) || !Number.isFinite(jetzt)) return -1;
  for (let i = 0; i < segmente.length; i += 1) {
    const eintrag = segmente[i];
    if (eintrag && jetzt >= eintrag.von && jetzt < eintrag.bis) return i;
  }
  return -1;
}

// Die Beschriftung der Einblendung. Feste Woerter zu festen Kategorien - aus
// der Antwort des Dienstes kommt kein einziges Zeichen in die Seite.
const NAMEN = {
  sponsor: "Sponsor",
  selfpromo: "Eigenwerbung",
  interaction: "Interaktion",
  intro: "Intro",
  outro: "Outro"
};

function alsQuelltext(...funktionen) {
  return funktionen.map((funktion) => funktion.toString()).join("\n");
}

/**
 * Das Skript, das in der YouTube-Seite laeuft.
 *
 * <p>Es horcht auf {@code timeupdate} - das Ereignis, das der Player ohnehin
 * viermal je Sekunde schickt. Ein eigener Zeitgeber waere ein zweiter Takt
 * neben einem, der schon laeuft.
 *
 * <p>Es haengt sich einmal ein und wird danach nur noch nachgefuettert
 * ({@code aktualisieren}): YouTube wechselt das Video ohne Neuladen, und ein
 * zweiter Satz Horcher an demselben Element wuerde jeden Sprung doppelt
 * ausloesen.
 *
 * <p>Waehrend der Werbung von YouTube passiert nichts. Dort laeuft dieselbe
 * {@code <video>}-Marke mit einer ganz anderen Zeitachse; ein Sprung auf
 * Sekunde 71 waere ein Sprung im Werbespot.
 */
function skipScript(segmente, optionen = {}) {
  const sauber = (Array.isArray(segmente) ? segmente : []).map((eintrag) => ({
    von: Number(eintrag.von) || 0,
    bis: Number(eintrag.bis) || 0,
    kategorie: KATEGORIEN.includes(eintrag.kategorie) ? eintrag.kategorie : "sponsor"
  }));
  const daten = JSON.stringify({
    segmente: sauber,
    hinweis: optionen.hinweis !== false,
    videoId: String(optionen.videoId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20)
  });
  return `(() => {
    ${alsQuelltext(sprungFuer, rueckkehrFuer)}
    const NAMEN = ${JSON.stringify(NAMEN)};
    const MELDE = ${JSON.stringify(MELDE)};
    const neu = ${daten};

    if (window.__elfixSponsorblock) return window.__elfixSponsorblock.aktualisieren(neu);

    const videos = Array.from(document.querySelectorAll("video"))
      .filter((media) => Number(media.duration) > 0);
    const media = document.querySelector("video.html5-main-video")
      || videos.sort((links, rechts) => rechts.duration - links.duration)[0];
    if (!media) return "kein-video";

    const zustand = {
      segmente: neu.segmente,
      hinweis: neu.hinweis,
      videoId: neu.videoId,
      aus: [],
      eigen: 0,
      kasten: null,
      uhr: 0,
      letzter: null
    };

    // Waehrend YouTube Werbung zeigt, gehoert die Zeitachse dem Spot.
    const werbung = () => {
      const spieler = document.querySelector("#movie_player");
      return Boolean(spieler && spieler.classList
        && (spieler.classList.contains("ad-showing")
          || spieler.classList.contains("ad-interrupting")));
    };

    // Die Einblendung. Sie nimmt keine Klicks an ausser auf dem einen Knopf und
    // holt sich nie den Fokus - auf dem Fernseher wuerde sie sonst die
    // Steuerung des Players an sich reissen.
    const kastenBauen = () => {
      const kasten = document.createElement("div");
      Object.assign(kasten.style, {
        position: "fixed",
        left: "50%",
        bottom: "96px",
        transform: "translateX(-50%)",
        zIndex: "2147483000",
        display: "none",
        alignItems: "center",
        gap: "14px",
        padding: "10px 16px",
        borderRadius: "10px",
        background: "rgba(12, 16, 22, 0.92)",
        color: "#f4f7fb",
        font: "600 14px/1.2 system-ui, sans-serif",
        boxShadow: "0 12px 34px rgba(0, 0, 0, 0.45)",
        pointerEvents: "none"
      });
      const text = document.createElement("span");
      const knopf = document.createElement("button");
      knopf.type = "button";
      knopf.textContent = "Rückgängig";
      Object.assign(knopf.style, {
        pointerEvents: "auto",
        minHeight: "32px",
        padding: "0 12px",
        border: "0",
        borderRadius: "8px",
        background: "rgba(255, 255, 255, 0.94)",
        color: "#0b0f16",
        font: "800 13px/1 system-ui, sans-serif",
        cursor: "pointer"
      });
      knopf.addEventListener("click", (ereignis) => {
        ereignis.preventDefault();
        ereignis.stopPropagation();
        zurueck();
      }, true);
      kasten.append(text, knopf);
      kasten.__text = text;
      (document.fullscreenElement || document.body).appendChild(kasten);
      return kasten;
    };

    const verstecken = () => {
      if (zustand.kasten) zustand.kasten.style.display = "none";
    };

    const zeigen = (kategorie, dauer) => {
      if (!zustand.hinweis) return;
      if (!zustand.kasten) zustand.kasten = kastenBauen();
      // Im Vollbild ist nicht das Dokument der Rahmen, sondern das
      // Vollbild-Element - sonst haengt die Meldung hinter dem Video.
      const buehne = document.fullscreenElement || document.body;
      if (zustand.kasten.parentElement !== buehne) buehne.appendChild(zustand.kasten);
      zustand.kasten.__text.textContent =
        (NAMEN[kategorie] || "Abschnitt") + " übersprungen · " + Math.round(dauer) + " Sek.";
      zustand.kasten.style.display = "flex";
      clearTimeout(zustand.uhr);
      zustand.uhr = setTimeout(verstecken, 6000);
    };

    // Rueckgaengig: zurueck an den Anfang des Segments - und dieses Segment
    // gilt fuer diesen Durchlauf nicht mehr.
    const zurueck = () => {
      const letzter = zustand.letzter;
      if (!letzter) return;
      if (zustand.aus.indexOf(letzter.index) < 0) zustand.aus.push(letzter.index);
      zustand.letzter = null;
      try {
        zustand.eigen = Date.now();
        media.currentTime = letzter.von;
        console.log(MELDE + "zurueck:" + letzter.kategorie);
      } catch (_) {}
      verstecken();
    };

    const pruefen = () => {
      if (!zustand.segmente.length || werbung()) return;
      const stelle = Number(media.currentTime) || 0;
      const treffer = sprungFuer(zustand.segmente, stelle, zustand.aus);
      if (!treffer) return;
      const dauer = treffer.bis - stelle;
      try {
        zustand.eigen = Date.now();
        media.currentTime = treffer.bis;
      } catch (_) {
        return;
      }
      zustand.letzter = treffer;
      zeigen(treffer.kategorie, dauer);
      console.log(MELDE + "sprung:" + treffer.kategorie + ":" + Math.round(dauer));
    };

    media.addEventListener("timeupdate", pruefen);

    // Wer von Hand in ein Segment zurueckspult, meint das. Es gilt dann fuer
    // diesen Durchlauf nicht mehr - ohne das kaeme er dort nie an.
    media.addEventListener("seeked", () => {
      const eigen = zustand.eigen && Date.now() - zustand.eigen < 1500;
      zustand.eigen = 0;
      if (eigen) return;
      const index = rueckkehrFuer(zustand.segmente, Number(media.currentTime) || 0);
      if (index >= 0 && zustand.aus.indexOf(index) < 0) zustand.aus.push(index);
    });

    window.__elfixSponsorblock = {
      zustand,
      aktualisieren: (naechste) => {
        // Anderes Video: die Ausnahmen des vorigen gelten dort nicht.
        if (naechste.videoId !== zustand.videoId) {
          zustand.aus = [];
          zustand.letzter = null;
          zustand.videoId = naechste.videoId;
          verstecken();
        }
        zustand.segmente = naechste.segmente;
        zustand.hinweis = naechste.hinweis;
        return "aktualisiert";
      },
      abschalten: () => {
        zustand.segmente = [];
        zustand.letzter = null;
        verstecken();
        return "aus";
      }
    };
    return "eingerichtet";
  })()`;
}

/**
 * Aus heisst aus - auch mitten im Video.
 *
 * <p>Wer den Schalter umlegt, waehrend etwas laeuft, soll nicht bis zum
 * naechsten Video warten muessen. Das Skript bleibt haengen, springt aber
 * nicht mehr.
 */
function abschaltenScript() {
  return `(() => {
    if (!window.__elfixSponsorblock) return "nicht-da";
    return window.__elfixSponsorblock.abschalten();
  })()`;
}

module.exports = {
  WIRT,
  KATEGORIEN,
  WEITERE_KATEGORIEN,
  STANDARD,
  MIN_DAUER_S,
  MAX_SEGMENTE,
  MELDE,
  NAMEN,
  einstellungenLesen,
  kategorienAus,
  hashPraefix,
  anfrageUrl,
  segmenteAus,
  gefiltert,
  sprungFuer,
  rueckkehrFuer,
  skipScript,
  abschaltenScript
};
