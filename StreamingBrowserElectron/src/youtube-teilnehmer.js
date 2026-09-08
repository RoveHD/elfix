"use strict";

// The only data that crosses into YouTube is this small, display-only model.
// In particular, the complete watchparty status never becomes page script.
function anzeigeScript(eingabe) {
  const roh = eingabe && typeof eingabe === "object" ? eingabe : {};
  const text = (wert, laenge = 64) => String(wert == null ? "" : wert)
    .replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, laenge);
  const aktiv = roh.enabled === true && roh.connected === true && roh.joined === true;
  const alle = Array.isArray(roh.members) ? roh.members : [];
  const mitglieder = [];
  for (const person of alle.slice(0, 50)) {
    const name = text(typeof person === "object" && person ? person.name : person);
    if (name) mitglieder.push({ id: text(typeof person === "object" && person ? person.id : ""), name });
  }
  const ichId = text(roh.me);
  const zustand = {
    aktiv,
    raum: text(roh.room, 80),
    anzahl: Math.min(9999, alle.length),
    ichId,
    mitglieder,
    weitere: Math.max(0, alle.length - mitglieder.length)
  };

  return `(() => {
    const next = ${JSON.stringify(zustand)};
    const KEY = "__elfixYoutubeTeilnehmer";
    const ID = "elfix-youtube-teilnehmer";
    const previous = window[KEY];
    if (!next.aktiv) {
      if (previous && typeof previous.abschalten === "function") previous.abschalten();
      else document.getElementById(ID)?.remove();
      return "youtube-teilnehmer-aus";
    }
    if (previous && typeof previous.aktualisieren === "function") return previous.aktualisieren(next);

    let state = next;
    let observer;
    let host = null;
    let overlay = null;
    let beendet = false;
    let zuletzt = "";
    let geplant = false;
    const spieler = () => document.querySelector("#movie_player") || document.querySelector(".html5-video-player");
    const entfernen = () => { overlay?.remove(); document.getElementById(ID)?.remove(); overlay = null; };
    const chip = (inhalt, hervorgehoben, titel = "") => {
      const element = document.createElement("span");
      // Participant and room names are page-untrusted even though their shape
      // was restricted by the main process. Never make them HTML.
      element.textContent = inhalt;
      if (titel) {
        element.title = titel;
        element.setAttribute("aria-label", titel);
        element.tabIndex = 0;
        element.style.pointerEvents = "auto";
      }
      Object.assign(element.style, {
        display: "block", flex: "0 1 auto", minWidth: "0", maxWidth: "180px", overflow: "hidden",
        textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "3px 7px", borderRadius: "999px",
        background: hervorgehoben ? "rgba(28,28,32,.92)" : "rgba(0,0,0,.72)",
        border: "1px solid rgba(255,255,255,.23)", color: "#fff",
        font: "500 12px/16px Roboto,Arial,sans-serif", boxShadow: "0 1px 4px rgba(0,0,0,.45)"
      });
      return element;
    };
    const zeichnen = () => {
      if (beendet) return;
      const naechsterHost = spieler();
      if (!naechsterHost) { entfernen(); host = null; zuletzt = ""; return; }
      overlay = overlay?.isConnected ? overlay : document.getElementById(ID);
      const schluessel = JSON.stringify(state);
      // Nothing is written for notifications caused by our own last write.
      // This prevents the subtree observer from turning into a mutation loop.
      if (overlay?.parentElement === naechsterHost && host === naechsterHost && zuletzt === schluessel) return;
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = ID;
        overlay.setAttribute("role", "status");
        overlay.setAttribute("aria-label", "Watchparty-Teilnehmende");
        Object.assign(overlay.style, {
          position: "absolute", top: "12px", left: "12px", right: "12px", zIndex: "2147483646",
          display: "flex", flexWrap: "nowrap", gap: "5px", alignItems: "center", pointerEvents: "none"
        });
      }
      if (overlay.parentElement !== naechsterHost) naechsterHost.appendChild(overlay);
      // Reserve the native top-controls row even while YouTube is fading it.
      // A fixed inset avoids covering title/share/watch-later after autoplay,
      // fullscreen, or a SPA control rebuild.
      const oben = 48;
      if (overlay.style.top !== oben + "px") overlay.style.top = oben + "px";
      const sichtbar = state.mitglieder.slice(0, 8);
      const verborgen = state.mitglieder.slice(8);
      const rest = state.weitere + verborgen.length;
      const restNamen = verborgen.map((person) => person.name).join(", ");
      overlay.replaceChildren(
        chip(state.raum || "Watchparty", true),
        chip(String(state.anzahl) + " dabei"),
        ...sichtbar.map((person) => chip(person.name + (state.ichId && person.id === state.ichId ? " (du)" : ""))),
        ...(rest ? [chip("+" + rest, false, restNamen || (rest + " weitere Teilnehmende"))] : [])
      );
      host = naechsterHost;
      zuletzt = schluessel;
    };
    const planen = () => {
      // One microtask combines a burst of YouTube mutations. There are no
      // timers, and mutations made by this overlay do not schedule a redraw.
      if (geplant || beendet) return;
      geplant = true;
      queueMicrotask(() => { geplant = false; zeichnen(); });
    };
    const abschalten = () => {
      if (beendet) return;
      beendet = true;
      observer?.disconnect();
      window.removeEventListener("pagehide", abschalten);
      entfernen();
      if (window[KEY]?.abschalten === abschalten) delete window[KEY];
    };
    observer = new MutationObserver((aenderungen) => {
      // A YouTube page changes constantly (comments, recommendations, player
      // controls). Only a detached player or a newly inserted player matters.
      if (host && !host.isConnected) return planen();
      if (host?.isConnected && overlay && !overlay.isConnected) return planen();
      if (!host && aenderungen.some((aenderung) => Array.from(aenderung.addedNodes).some((kind) =>
        kind.nodeType === 1 && (kind.matches?.("#movie_player, .html5-video-player")
          || kind.querySelector?.("#movie_player, .html5-video-player"))))) planen();
    });
    observer.observe(document.documentElement || document, { childList: true, subtree: true });
    window.addEventListener("pagehide", abschalten, { once: true });
    window[KEY] = {
      aktualisieren: (naechste) => {
        state = naechste;
        zuletzt = "";
        zeichnen();
        return "youtube-teilnehmer-aktualisiert";
      },
      abschalten
    };
    zeichnen();
    return "youtube-teilnehmer-eingerichtet";
  })()`;
}

module.exports = { anzeigeScript };
