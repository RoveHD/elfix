"use strict";

// Return YouTube Dislike.
//
// Der Dienst liefert keine von YouTube bestaetigte Zahl. Seine `dislikes`
// sind eine Schaetzung aus archivierten Daten und den Meldungen seiner
// Nutzer. Diese Datei nennt sie deshalb nie einfach "Dislikes", sondern
// kennzeichnet sie direkt am YouTube-Knopf als Schaetzung.
//
// Netz und Oberflaeche bleiben getrennt: main.js holt die kleine JSON-Antwort
// mit Electron-Netzrechten; `anzeigeScript` bekommt nur die bereits gepruefte
// Zahl. So trifft kein CORS- oder Cookie-Verhalten der eingebetteten Seite die
// Wiedergabe.

const STANDARD = Object.freeze({ enabled: true });
const API = "https://returnyoutubedislikeapi.com/votes";
const MELDE = "__elfix:youtube-dislikes:";

function einstellungenLesen(roh) {
  return { enabled: roh?.enabled !== false };
}

function videoIdGueltig(videoId) {
  return /^[A-Za-z0-9_-]{6,20}$/.test(String(videoId || ""));
}

function anfrageUrl(videoId) {
  const id = String(videoId || "");
  return videoIdGueltig(id) ? `${API}?videoId=${encodeURIComponent(id)}` : "";
}

// Kein `|| 0`: eine fehlende oder kaputte Zahl ist kein Ergebnis. Eine null
// waere eine Behauptung ueber ein Video, zu dem der Dienst nichts gesagt hat.
function datenAus(roh, videoId) {
  if (!roh || typeof roh !== "object") return null;
  const id = String(videoId || "");
  // `id` ist die API-Schreibweise, `videoId` die interne sichere Form. Beides
  // wird gegen die angefragte Kennung abgeglichen; dadurch kann das fertige
  // Datenobjekt ohne zweites, lockeres Umformen in das Seitenskript gehen.
  if (!videoIdGueltig(id) || String(roh.id || roh.videoId || "") !== id) return null;
  // Number(null) waere 0. Ein nicht vorhandener API-Wert darf niemals wie
  // eine bestaetigte Null im Knopf erscheinen.
  if (roh.dislikes === null || roh.dislikes === undefined || roh.dislikes === "") return null;
  const dislikes = Number(roh.dislikes);
  if (!Number.isFinite(dislikes) || dislikes < 0) return null;
  return { videoId: id, dislikes: Math.round(dislikes) };
}

function anzeigeScript(daten) {
  const sicher = datenAus(daten, daten?.videoId);
  if (!sicher) return abstellenScript();
  return `(() => {
    const neu = ${JSON.stringify(sicher)};
    const QUELLE = "Return YouTube Dislike";
    const HINWEIS = "Geschätzte Ablehnungen von Return YouTube Dislike (returnyoutubedislike.com)";

    const videokennung = () => {
      let ausAdresse = "";
      let ausSpieler = "";
      try {
        const adresse = new URL(location.href);
        ausAdresse = adresse.searchParams.get("v") || "";
        if (!ausAdresse) {
          const treffer = adresse.pathname.match(/^\\/(?:shorts|embed|live|v)\\/([^/]+)/);
          if (treffer) ausAdresse = treffer[1];
          else if (adresse.hostname.replace(/^www\\./, "") === "youtu.be") {
            ausAdresse = adresse.pathname.split("/").filter(Boolean)[0] || "";
          }
        }
      } catch (_) {}
      try {
        const spieler = document.querySelector("#movie_player");
        const daten = spieler && typeof spieler.getVideoData === "function" ? spieler.getVideoData() : null;
        ausSpieler = String(daten && daten.video_id || "");
      } catch (_) {}
      // Beim SPA-Wechsel zeigt die Adresse kurz auf das neue, der Player aber
      // noch auf das alte Video. In diesem Fenster zeigen wir keine fremde Zahl.
      if (ausAdresse && ausSpieler && ausAdresse !== ausSpieler) return "";
      return ausSpieler || ausAdresse;
    };

    const sichtbar = (element) => {
      if (!element || !element.isConnected || !element.getClientRects().length) return false;
      try {
        const stil = getComputedStyle(element);
        return stil.display !== "none" && stil.visibility !== "hidden" && Number(stil.opacity || 1) > 0;
      } catch (_) { return false; }
    };

    const knopf = () => {
      const kandidaten = [
        ...document.querySelectorAll("#segmented-dislike-button button"),
        ...document.querySelectorAll("#segmented-dislike-button yt-button-shape button"),
        ...document.querySelectorAll("ytd-watch-metadata #segmented-dislike-button button"),
        // Die aktuelle YouTube-Oberflaeche hat die alte Segmentgruppe auf
        // eigene View-Model-Elemente umgestellt.
        ...document.querySelectorAll("dislike-button-view-model button"),
        ...document.querySelectorAll("ytd-segmented-like-dislike-button-renderer button[aria-label*='Dislike']"),
        ...document.querySelectorAll("ytd-segmented-like-dislike-button-renderer button[aria-label*='Ablehnen']"),
        // Mobile YouTube verwendet die schlanke Aktionsleiste.
        ...document.querySelectorAll("ytm-slim-video-action-bar-renderer button[aria-label*='Dislike']"),
        ...document.querySelectorAll("ytm-slim-video-action-bar-renderer button[aria-label*='Ablehnen']"),
        ...document.querySelectorAll("ytm-watch button[aria-label*='Dislike']"),
        ...document.querySelectorAll("ytm-watch button[aria-label*='Ablehnen']")
      ];
      return kandidaten.find(sichtbar) || null;
    };

    const entfernen = () => {
      for (const element of document.querySelectorAll(".elfix-youtube-dislike-count")) element.remove();
    };

    const formatieren = (zahl) => {
      try {
        return new Intl.NumberFormat(document.documentElement.lang || undefined, {
          notation: "compact", compactDisplay: "short", maximumSignificantDigits: 3
        }).format(zahl);
      } catch (_) { return String(zahl); }
    };

    const zustand = { daten: neu };

    const zeichnen = () => {
      const daten = zustand.daten;
      if (videokennung() !== daten.videoId) { entfernen(); return false; }
      const ziel = knopf();
      if (!ziel || !ziel.isConnected) return false;
      let wert = ziel.querySelector(".elfix-youtube-dislike-count");
      if (!wert) {
        wert = document.createElement("span");
        wert.className = "elfix-youtube-dislike-count";
        Object.assign(wert.style, {
          display: "inline-block", marginInlineStart: "6px", whiteSpace: "nowrap",
          font: "inherit", fontWeight: "500", letterSpacing: "normal", pointerEvents: "none"
        });
        // Der echte YouTube-Knopf bleibt unveraendert bedienbar; der Wert ist
        // ein Kind davon und bekommt deshalb dieselbe Groesse und Farbe.
        ziel.appendChild(wert);
      }
      const text = formatieren(daten.dislikes);
      const beschreibung = "Geschätzte Ablehnungen: " + daten.dislikes + ". " + HINWEIS;
      // textContent setzt auch bei gleichem Text eine Mutation. Der Beobachter
      // unten wuerde sich damit selbst alle 80 ms erneut anstossen.
      if (wert.textContent !== text) wert.textContent = text;
      if (wert.title !== HINWEIS) wert.title = HINWEIS;
      if (wert.getAttribute("aria-label") !== beschreibung) wert.setAttribute("aria-label", beschreibung);
      if (wert.dataset.source !== QUELLE) wert.dataset.source = QUELLE;
      return true;
    };

    const alt = window.__elfixYoutubeDislikes;
    if (alt && typeof alt.aktualisieren === "function") return alt.aktualisieren(neu);

    let timer = 0;
    const planen = () => {
      clearTimeout(timer);
      timer = setTimeout(zeichnen, 80);
    };
    const beobachter = new MutationObserver(planen);
    beobachter.observe(document.documentElement || document, { childList: true, subtree: true });
    document.addEventListener("yt-navigate-finish", planen, true);
    window.__elfixYoutubeDislikes = {
      aktualisieren: (naechste) => {
        if (!naechste || typeof naechste.videoId !== "string"
            || !Number.isFinite(Number(naechste.dislikes)) || Number(naechste.dislikes) < 0) {
          entfernen();
          return "youtube-dislikes-ungueltig";
        }
        const vorherigeId = zustand.daten.videoId;
        zustand.daten = { videoId: naechste.videoId, dislikes: Math.round(Number(naechste.dislikes)) };
        if (vorherigeId !== zustand.daten.videoId) entfernen();
        planen();
        return "youtube-dislikes-aktualisiert";
      },
      abschalten: () => {
        clearTimeout(timer);
        beobachter.disconnect();
        document.removeEventListener("yt-navigate-finish", planen, true);
        entfernen();
        delete window.__elfixYoutubeDislikes;
      }
    };
    planen();
    return "youtube-dislikes-eingerichtet";
  })()`;
}

function abstellenScript() {
  return `(() => {
    if (window.__elfixYoutubeDislikes && typeof window.__elfixYoutubeDislikes.abschalten === "function") {
      window.__elfixYoutubeDislikes.abschalten();
    } else {
      for (const element of document.querySelectorAll(".elfix-youtube-dislike-count")) element.remove();
    }
    return "youtube-dislikes-aus";
  })()`;
}

module.exports = { STANDARD, API, MELDE, einstellungenLesen, videoIdGueltig, anfrageUrl, datenAus, anzeigeScript, abstellenScript };
