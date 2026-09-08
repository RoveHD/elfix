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
// exclusive_access, poi_highlight und chapter. ELFIX bietet die acht normalen
// Zeitbereiche an. Die drei Sonderfaelle chapter, poi_highlight und
// exclusive_access sind keine gewoehnlichen Zeitbereiche und werden deshalb
// nicht vorgespiegelt.
//
// **Und die YouTube-Watchparty?** Der Sprung ist ein gewoehnlicher Sprung im
// Player: der Horcher der Runde (youtube-sync.js) meldet ihn wie jeden anderen,
// das Relay nimmt ihn auf, und alle springen mit. Damit nicht mehrere Player
// denselben Abschnitt fast gleichzeitig melden, darf die Einspielung den
// automatischen Teil auf Folgern abschalten. Marker und manuelle Knopfdrucke
// bleiben dort erhalten.
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

// Die Zeitbereich-Kategorien, die ELFIX anbietet - in der Schreibweise der API.
const KATEGORIEN = [
  "sponsor", "selfpromo", "interaction", "intro", "outro", "preview",
  "music_offtopic", "filler"
];
const MODI = ["skip", "manual", "show", "off"];

// Was die API sonst noch kennt. Steht hier, damit der naechste Leser nicht
// suchen muss, warum die Liste oben kuerzer ist - nicht als Vorrat zum
// Anschalten.
const WEITERE_KATEGORIEN = ["exclusive_access", "poi_highlight", "chapter"];

// Standard: was Werbung ist, faellt weg; was zum Video gehoert, bleibt.
//
// Intro, Outro, Vorschau und Fuellmaterial sind ausdruecklich aus. Sie gehoeren
// zum Video; wer sie markieren oder wegspringen will, schaltet das gezielt ein.
const STANDARD = {
  enabled: true,
  sponsor: "skip",
  selfpromo: "skip",
  interaction: "skip",
  intro: "off",
  outro: "off",
  preview: "off",
  music_offtopic: "skip",
  filler: "off",
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
  const schalter = (name) => (typeof roh?.[name] === "boolean" ? roh[name] : STANDARD[name]);
  const modus = (name) => {
    const wert = roh?.[name];
    if (MODI.includes(wert)) return wert;
    // Bis einschliesslich 1.39.3 waren Kategorien einfache Schalter.
    if (typeof wert === "boolean") return wert ? "skip" : "off";
    return STANDARD[name];
  };
  return Object.fromEntries([
    ["enabled", schalter("enabled")],
    ...KATEGORIEN.map((name) => [name, modus(name)]),
    ["hinweis", schalter("hinweis")]
  ]);
}

/** Welche Kategorien sichtbar oder aktiv sein sollen. */
function kategorienAus(einstellungen) {
  const gelesen = einstellungenLesen(einstellungen);
  if (!gelesen.enabled) return [];
  return KATEGORIEN.filter((name) => gelesen[name] !== "off");
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
 * <p>Geholt werden immer alle acht Kategorien und nicht nur die eingeschalteten.
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

/** Nur eingeschaltete Kategorien, mit ihrem Verhalten fuer den Player. */
function gefiltert(segmente, einstellungen) {
  const gelesen = einstellungenLesen(einstellungen);
  if (!gelesen.enabled) return [];
  return (Array.isArray(segmente) ? segmente : []).flatMap((eintrag) => {
    const modus = gelesen[eintrag?.kategorie];
    return modus && modus !== "off" ? [{ ...eintrag, modus }] : [];
  });
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
    // Fehlender Modus ist die alte Form und bleibt abwaertskompatibel ein
    // automatischer Sprung.
    if (eintrag.modus && eintrag.modus !== "skip") continue;
    if (jetzt >= eintrag.von - 0.15 && jetzt < eintrag.bis - 0.5) {
      return { index: i, von: eintrag.von, bis: eintrag.bis,
        kategorie: eintrag.kategorie, modus: "skip" };
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
    if (eintrag && (!eintrag.modus || eintrag.modus === "skip")
        && jetzt >= eintrag.von && jetzt < eintrag.bis) return i;
  }
  return -1;
}

/** Ein Abschnitt, den der Benutzer auf Wunsch selbst ueberspringen kann. */
function manuellFuer(segmente, stelle, aus) {
  const jetzt = Number(stelle);
  if (!Array.isArray(segmente) || !Number.isFinite(jetzt)) return null;
  const ausnahmen = Array.isArray(aus) ? aus : [];
  for (let i = 0; i < segmente.length; i += 1) {
    const eintrag = segmente[i];
    if (!eintrag || eintrag.modus !== "manual" || ausnahmen.indexOf(i) >= 0) continue;
    if (jetzt >= eintrag.von && jetzt < eintrag.bis - 0.15) {
      return { index: i, von: eintrag.von, bis: eintrag.bis,
        kategorie: eintrag.kategorie, modus: "manual" };
    }
  }
  return null;
}

// Die Beschriftung der Einblendung. Feste Woerter zu festen Kategorien - aus
// der Antwort des Dienstes kommt kein einziges Zeichen in die Seite.
const NAMEN = {
  sponsor: "Sponsor",
  selfpromo: "Eigenwerbung",
  interaction: "Interaktion",
  intro: "Intro",
  outro: "Outro",
  preview: "Vorschau",
  music_offtopic: "Nicht-Musik",
  filler: "Füllmaterial"
};

// Dieselben Farben wie SponsorBlock. Sie bleiben im Kern, damit Desktop,
// Android und Fernseher fuer dieselbe Kategorie dieselbe Zeitlinie zeichnen.
const FARBEN = {
  sponsor: "#00d400",
  selfpromo: "#ffff00",
  interaction: "#cc00ff",
  intro: "#00ffff",
  outro: "#0202ff",
  preview: "#008fd6",
  music_offtopic: "#ff9900",
  filler: "#7300ff"
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
  const sauber = (Array.isArray(segmente) ? segmente : []).flatMap((eintrag) => {
    const modus = MODI.includes(eintrag?.modus) ? eintrag.modus : "skip";
    if (modus === "off") return [];
    return [{
      von: Number(eintrag?.von) || 0,
      bis: Number(eintrag?.bis) || 0,
      kategorie: KATEGORIEN.includes(eintrag?.kategorie) ? eintrag.kategorie : "sponsor",
      modus
    }];
  });
  const daten = JSON.stringify({
    segmente: sauber,
    hinweis: optionen.hinweis !== false,
    automatisch: optionen.automatisch !== false,
    videoId: String(optionen.videoId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20)
  });
  return `(() => {
    ${alsQuelltext(sprungFuer, rueckkehrFuer, manuellFuer)}
    const NAMEN = ${JSON.stringify(NAMEN)};
    const FARBEN = ${JSON.stringify(FARBEN)};
    const MELDE = ${JSON.stringify(MELDE)};
    const neu = ${daten};

    if (window.__elfixSponsorblock) return window.__elfixSponsorblock.aktualisieren(neu);

    const zustand = {
      segmente: neu.segmente,
      hinweis: neu.hinweis,
      automatisch: neu.automatisch,
      videoId: neu.videoId,
      aus: [],
      eigen: 0,
      kasten: null,
      uhr: 0,
      letzter: null,
      manuell: null,
      kastenArt: "",
      media: null,
      marken: null,
      markenSignatur: "",
      zeichnung: 0,
      aktiv: false
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
        if (zustand.kastenArt === "manual") manuellSpringen();
        else zurueck();
      }, true);
      kasten.append(text, knopf);
      kasten.__text = text;
      kasten.__knopf = knopf;
      (document.fullscreenElement || document.body).appendChild(kasten);
      return kasten;
    };

    const verstecken = () => {
      clearTimeout(zustand.uhr);
      zustand.uhr = 0;
      if (zustand.kasten) zustand.kasten.style.display = "none";
      zustand.kastenArt = "";
      zustand.manuell = null;
    };

    const einblenden = (text, knopf, art, zeit = 0) => {
      if (!zustand.kasten) zustand.kasten = kastenBauen();
      // Im Vollbild ist nicht das Dokument der Rahmen, sondern das
      // Vollbild-Element - sonst haengt die Meldung hinter dem Video.
      const buehne = document.fullscreenElement || document.body;
      if (zustand.kasten.parentElement !== buehne) buehne.appendChild(zustand.kasten);
      zustand.kasten.__text.textContent = text;
      zustand.kasten.__knopf.textContent = knopf;
      zustand.kastenArt = art;
      zustand.kasten.style.display = "flex";
      clearTimeout(zustand.uhr);
      zustand.uhr = zeit > 0 ? setTimeout(verstecken, zeit) : 0;
    };

    const zeigen = (kategorie, dauer) => {
      if (!zustand.hinweis) return verstecken();
      einblenden((NAMEN[kategorie] || "Abschnitt") + " übersprungen · "
        + Math.max(1, Math.round(dauer)) + " Sek.", "Rückgängig", "undo", 6000);
    };

    const manuellZeigen = (treffer, stelle) => {
      zustand.manuell = treffer;
      const rest = Math.max(1, Math.ceil(treffer.bis - stelle));
      einblenden((NAMEN[treffer.kategorie] || "Abschnitt") + " · noch "
        + rest + " Sek.", "Überspringen", "manual");
    };

    const markenEntfernen = () => {
      if (zustand.marken && zustand.marken.parentElement) zustand.marken.remove();
      zustand.marken = null;
      zustand.markenSignatur = "";
    };

    // Auf einer SPA-Seite koennen Adresse und Player fuer einen kurzen Moment
    // verschiedene Videos nennen. In dieser Luecke gelten weder die alten
    // Segmente fuer den neuen Player noch umgekehrt.
    const aktuelleKennung = () => {
      let ausPlayer = "";
      let ausAdresse = "";
      try {
        const spieler = document.querySelector("#movie_player");
        const daten = spieler && typeof spieler.getVideoData === "function"
          ? spieler.getVideoData()
          : null;
        ausPlayer = String(daten && daten.video_id || "");
      } catch (_) {}
      try {
        const adresse = new URL(location.href);
        const pfad = adresse.pathname.replace(/\\/+$/, "");
        ausAdresse = String(adresse.searchParams.get("v") || "");
        if (!ausAdresse) {
          const treffer = pfad.match(/^\\/(?:shorts|embed|live|v)\\/([^/]+)/);
          if (treffer) ausAdresse = treffer[1];
          else if (adresse.hostname === "youtu.be") ausAdresse = pfad.split("/").filter(Boolean)[0] || "";
        }
      } catch (_) {}
      if (ausPlayer && ausAdresse && ausPlayer !== ausAdresse) return "";
      return ausPlayer || ausAdresse;
    };

    // YouTubes rote Fortschrittsleiste liegt in diesem Rahmen. Die farbigen
    // Bereiche sind reine Anzeige: sie nehmen weder Maus noch Fernbedienung an
    // sich und veraendern YouTubes eigene Leiste nicht.
    const markenZeichnen = () => {
      const media = zustand.media;
      const dauer = Number(media && media.duration);
      const leiste = document.querySelector(".ytp-progress-bar-container")
        || document.querySelector(".ytp-progress-bar");
      if (werbung() || aktuelleKennung() !== zustand.videoId || !leiste
          || !Number.isFinite(dauer) || dauer <= 0 || !zustand.segmente.length) {
        markenEntfernen();
        return;
      }

      const signatur = zustand.videoId + "|" + dauer + "|" + zustand.segmente
        .map((eintrag) => eintrag.kategorie + ":" + eintrag.modus + ":"
          + eintrag.von + ":" + eintrag.bis)
        .join(",");
      if (zustand.marken && zustand.marken.parentElement === leiste
          && zustand.markenSignatur === signatur) return;

      if (!zustand.marken || zustand.marken.parentElement !== leiste) {
        markenEntfernen();
        const ebene = document.createElement("div");
        ebene.className = "elfix-sponsorblock-marken";
        ebene.setAttribute("aria-hidden", "true");
        Object.assign(ebene.style, {
          position: "absolute",
          inset: "0",
          // YouTubes eigene Kapitel-, Puffer- und Abspielbalken liegen in
          // dieser Fortschrittsleiste uebereinander. 32 ist deren obere
          // Ebene; die Markierungen muessen darueber sichtbar bleiben.
          zIndex: "33",
          overflow: "hidden",
          pointerEvents: "none"
        });
        leiste.appendChild(ebene);
        zustand.marken = ebene;
      }

      if (typeof zustand.marken.replaceChildren === "function") zustand.marken.replaceChildren();
      else while (zustand.marken.firstChild) zustand.marken.removeChild(zustand.marken.firstChild);
      for (const eintrag of zustand.segmente) {
        const von = Math.max(0, Math.min(dauer, Number(eintrag.von) || 0));
        const bis = Math.max(von, Math.min(dauer, Number(eintrag.bis) || 0));
        if (bis <= von) continue;
        const marke = document.createElement("span");
        marke.className = "elfix-sponsorblock-marke";
        marke.dataset.kategorie = eintrag.kategorie;
        marke.dataset.modus = eintrag.modus;
        marke.title = (NAMEN[eintrag.kategorie] || "Abschnitt") + " · "
          + (eintrag.modus === "skip" ? "automatisch"
            : eintrag.modus === "manual" ? "manuell" : "markiert");
        Object.assign(marke.style, {
          position: "absolute",
          top: "0",
          bottom: "0",
          left: (von / dauer * 100) + "%",
          width: ((bis - von) / dauer * 100) + "%",
          minWidth: "2px",
          background: FARBEN[eintrag.kategorie] || FARBEN.sponsor,
          opacity: "0.9",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.18) inset"
        });
        zustand.marken.appendChild(marke);
      }
      zustand.markenSignatur = signatur;
    };

    // Rueckgaengig: zurueck an den Anfang des Segments - und dieses Segment
    // gilt fuer diesen Durchlauf nicht mehr.
    const zurueck = () => {
      const letzter = zustand.letzter;
      const media = zustand.media;
      if (!letzter || !media) return;
      if (zustand.aus.indexOf(letzter.index) < 0) zustand.aus.push(letzter.index);
      zustand.letzter = null;
      try {
        zustand.eigen = Date.now();
        media.currentTime = letzter.von;
        console.log(MELDE + "zurueck:" + letzter.kategorie);
      } catch (_) {}
      verstecken();
    };

    const manuellSpringen = () => {
      const treffer = zustand.manuell;
      const media = zustand.media;
      if (!treffer || !media || aktuelleKennung() !== zustand.videoId) return verstecken();
      const dauer = Math.max(0, treffer.bis - (Number(media.currentTime) || treffer.von));
      try {
        zustand.eigen = Date.now();
        media.currentTime = treffer.bis;
      } catch (_) {
        return;
      }
      zustand.manuell = null;
      zustand.letzter = treffer;
      zeigen(treffer.kategorie, dauer);
      console.log(MELDE + "sprung:" + treffer.kategorie + ":" + Math.round(dauer));
    };

    const pruefen = () => {
      const media = zustand.media;
      if (!media || !zustand.segmente.length) return;
      if (werbung()) {
        markenEntfernen();
        if (zustand.kastenArt === "manual") verstecken();
        return;
      }
      if (aktuelleKennung() !== zustand.videoId) {
        if (zustand.kastenArt === "manual") verstecken();
        return;
      }
      if (!zustand.marken) markenZeichnen();
      const stelle = Number(media.currentTime) || 0;
      const treffer = zustand.automatisch
        ? sprungFuer(zustand.segmente, stelle, zustand.aus)
        : null;
      if (treffer) {
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
        return;
      }
      const manuellerTreffer = manuellFuer(zustand.segmente, stelle, zustand.aus);
      if (manuellerTreffer) manuellZeigen(manuellerTreffer, stelle);
      else if (zustand.kastenArt === "manual") verstecken();
    };

    // Wer von Hand in ein Segment zurueckspult, meint das. Es gilt dann fuer
    // diesen Durchlauf nicht mehr - ohne das kaeme er dort nie an.
    const nachSprung = () => {
      const media = zustand.media;
      if (!media || aktuelleKennung() !== zustand.videoId) return;
      const eigen = zustand.eigen && Date.now() - zustand.eigen < 1500;
      zustand.eigen = 0;
      if (eigen) return;
      const index = rueckkehrFuer(zustand.segmente, Number(media.currentTime) || 0);
      if (index >= 0 && zustand.aus.indexOf(index) < 0) zustand.aus.push(index);
    };

    const videoSuchen = () => {
      const haupt = document.querySelector("video.html5-main-video");
      if (haupt) return haupt;
      return Array.from(document.querySelectorAll("video"))
        .sort((links, rechts) => (Number(rechts.duration) || 0) - (Number(links.duration) || 0))[0]
        || null;
    };

    // Beim ersten dom-ready steht YouTubes <video> nicht zwingend schon da.
    // Und beim Wechsel ohne Neuladen darf YouTube das Element ersetzen. Darum
    // wird nicht nur einmal gesucht, sondern bei DOM-Aenderungen neu gebunden.
    const verbinden = () => {
      if (!zustand.aktiv) return false;
      const media = videoSuchen();
      if (media === zustand.media) {
        markenZeichnen();
        return Boolean(media);
      }
      if (zustand.media) {
        zustand.media.removeEventListener("timeupdate", pruefen);
        zustand.media.removeEventListener("seeked", nachSprung);
        zustand.media.removeEventListener("loadedmetadata", markenZeichnen);
        zustand.media.removeEventListener("durationchange", markenZeichnen);
      }
      zustand.media = media;
      if (!media) {
        markenEntfernen();
        return false;
      }
      media.addEventListener("timeupdate", pruefen);
      media.addEventListener("seeked", nachSprung);
      media.addEventListener("loadedmetadata", markenZeichnen);
      media.addEventListener("durationchange", markenZeichnen);
      markenZeichnen();
      pruefen();
      return true;
    };

    const planen = () => {
      if (!zustand.aktiv || zustand.zeichnung) return;
      const spaeter = typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (taak) => setTimeout(taak, 0);
      zustand.zeichnung = spaeter(() => {
        zustand.zeichnung = 0;
        if (!zustand.aktiv) return;
        verbinden();
      });
    };

    let beobachter = null;
    let navigationAktiv = false;
    const istMarkenKnoten = (knoten) => Boolean(knoten && knoten.nodeType === 1
      && knoten.classList && (knoten.classList.contains("elfix-sponsorblock-marken")
        || knoten.classList.contains("elfix-sponsorblock-marke")));
    const nurEigeneAenderung = (aenderung) => {
      if (istMarkenKnoten(aenderung.target)) return true;
      const knoten = [...aenderung.addedNodes, ...aenderung.removedNodes];
      return knoten.length > 0 && knoten.every(istMarkenKnoten);
    };
    const beobachten = () => {
      zustand.aktiv = true;
      if (!beobachter && typeof MutationObserver === "function") {
        beobachter = new MutationObserver((aenderungen) => {
          if (aenderungen.length && aenderungen.every(nurEigeneAenderung)) return;
          planen();
        });
        beobachter.observe(document.documentElement, { childList: true, subtree: true });
      }
      if (!navigationAktiv) {
        window.addEventListener("yt-navigate-finish", planen, true);
        navigationAktiv = true;
      }
    };
    const ruhen = () => {
      zustand.aktiv = false;
      if (beobachter) beobachter.disconnect();
      beobachter = null;
      if (navigationAktiv) window.removeEventListener("yt-navigate-finish", planen, true);
      navigationAktiv = false;
      if (zustand.media) {
        zustand.media.removeEventListener("timeupdate", pruefen);
        zustand.media.removeEventListener("seeked", nachSprung);
        zustand.media.removeEventListener("loadedmetadata", markenZeichnen);
        zustand.media.removeEventListener("durationchange", markenZeichnen);
      }
      zustand.media = null;
      markenEntfernen();
    };

    window.__elfixSponsorblock = {
      zustand,
      aktualisieren: (naechste) => {
        // Anderes Video oder andere Segmentauswahl: Index-Ausnahmen des
        // vorigen Satzes gelten fuer den neuen nicht.
        const andereSegmente = JSON.stringify(naechste.segmente) !== JSON.stringify(zustand.segmente);
        if (naechste.videoId !== zustand.videoId || andereSegmente) {
          zustand.aus = [];
          zustand.letzter = null;
          zustand.videoId = naechste.videoId;
          verstecken();
        }
        zustand.segmente = naechste.segmente;
        zustand.hinweis = naechste.hinweis;
        zustand.automatisch = naechste.automatisch;
        if (!zustand.segmente.length) {
          verstecken();
          ruhen();
          return "aktualisiert";
        }
        beobachten();
        verbinden();
        pruefen();
        return "aktualisiert";
      },
      abschalten: () => {
        zustand.segmente = [];
        zustand.letzter = null;
        zustand.manuell = null;
        verstecken();
        ruhen();
        return "aus";
      }
    };
    if (zustand.segmente.length) {
      beobachten();
      verbinden();
    }
    return !zustand.segmente.length
      ? "ohne-segmente"
      : zustand.media ? "eingerichtet" : "wartet-auf-video";
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
  MODI,
  WEITERE_KATEGORIEN,
  STANDARD,
  MIN_DAUER_S,
  MAX_SEGMENTE,
  MELDE,
  NAMEN,
  FARBEN,
  einstellungenLesen,
  kategorienAus,
  hashPraefix,
  anfrageUrl,
  segmenteAus,
  gefiltert,
  sprungFuer,
  rueckkehrFuer,
  manuellFuer,
  skipScript,
  abschaltenScript
};
