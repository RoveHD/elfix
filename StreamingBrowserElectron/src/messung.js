"use strict";

/*
 * Der Fuehler: was gerade wirklich lief.
 *
 * Dieses Skript laeuft in der Anbieterseite selbst, nicht in ELFIX. Es sucht
 * das groesste sichtbare Video, liest Position und Laufzeit und - das ist der
 * eigentliche Punkt - zaehlt mit, wie viele Sekunden davon *tatsaechlich*
 * abgespielt wurden. Ein Sprung mit dem Regler zaehlt nicht mit; nur was in
 * Echtzeit weitergelaufen ist. Ohne diese Unterscheidung waere die
 * 2:30-Schwelle wertlos, denn man kaeme mit einem Zug am Regler ans Ende jeder
 * Serie.
 *
 * Gemerkt wird der Stand je Video in der Seite selbst (`__elfixMediaWatchTracker`),
 * weil nur dort ueber die Takte hinweg bekannt ist, was schon gezaehlt wurde.
 *
 * Am Rechner spielt der Hauptprozess das Skript in die Rahmen der Seite,
 * auf dem Telefon tut es die App im WebView - dasselbe Skript, damit
 * "geschaut" auf beiden Geraeten dasselbe heisst.
 */

/** Das Skript als Quelltext, fertig zum Einspielen. */
function messSkript() {
  return `(() => {
    const finite = (value) => Number.isFinite(value) ? value : 0;
    const abs = (value) => {
      try { return value ? new URL(value, location.href).href : ""; } catch (_) { return ""; }
    };
    // Welche Serie steht hier? Dieselbe Markerliste wie episodeIdentity() in
    // fortschritt.js - der Pfad nennt das Werk hinter "stream", "serie" oder
    // "film".
    const serienName = (pfad) => {
      const teile = String(pfad || "").split("/").filter(Boolean);
      const marken = ["stream", "serie", "film", "filme", "movie", "movies", "title"];
      for (let index = 0; index < teile.length - 1; index += 1) {
        if (marken.includes(teile[index].toLowerCase())) return teile[index + 1].toLowerCase();
      }
      return "";
    };
    const eigeneSerie = serienName(location.pathname);
    // Ohne diese Frage nimmt der Fuehler den erstbesten Folgenlink der Seite -
    // und auf einer Anbieterseite stehen davon Dutzende: "Neue Episoden", "Das
    // schauen andere", die Vorschlagsspalte. Gemeldet wurde genau das: aus
    // Attack on Titan wurde beim Weiterschalten immer dieselbe fremde Serie.
    const gleicheSerie = (href) => {
      try {
        const url = new URL(href, location.href);
        const wirt = (name) => String(name || "").toLowerCase().replace(/^www\\./, "");
        if (wirt(url.hostname) !== wirt(location.hostname)) return false;
        if (!eigeneSerie) return true;
        return serienName(url.pathname) === eigeneSerie;
      } catch (_) {
        return false;
      }
    };
    const nextEpisodeUrl = () => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const currentEpisodeMatch = location.pathname.match(/\\/(?:episode|folge)-(\\d+)(?:\\/?|$)/i);
      const currentEpisode = currentEpisodeMatch ? Number(currentEpisodeMatch[1]) : 0;
      const nextTextPattern = /\\b(next|weiter|naechste|nächste)\\b|[›»→]/i;
      const semantic = anchors.find((anchor) => {
        const label = [
          anchor.rel,
          anchor.textContent,
          anchor.title,
          anchor.getAttribute("aria-label"),
          anchor.className
        ].join(" ");
        const href = abs(anchor.getAttribute("href"));
        return href && nextTextPattern.test(label)
          && /\\/(?:episode|folge)-\\d+(?:[/?#]|$)/i.test(href)
          && gleicheSerie(href);
      });
      if (semantic) return abs(semantic.getAttribute("href"));
      if (!currentEpisode) return "";
      const directPattern = new RegExp("\\\\/(?:episode|folge)-" + (currentEpisode + 1) + "(?:[/?#]|$)", "i");
      const direct = anchors.find((anchor) => {
        const href = abs(anchor.getAttribute("href"));
        return href && directPattern.test(href) && gleicheSerie(href);
      });
      return direct ? abs(direct.getAttribute("href")) : "";
    };
    const visibleArea = (node) => {
      try {
        const rect = node.getBoundingClientRect();
        return Math.max(0, rect.width) * Math.max(0, rect.height);
      } catch (_) {
        return 0;
      }
    };
    const now = Date.now();
    window.__elfixMediaWatchTracker = window.__elfixMediaWatchTracker || new WeakMap();
    const medias = Array.from(document.querySelectorAll("video, audio"))
      .map((media) => {
        const currentTime = finite(media.currentTime);
        const duration = finite(media.duration);
        const sourceKey = [location.href, media.currentSrc || media.src || media.getAttribute("src") || ""].join("|");
        const paused = Boolean(media.paused);
        const ended = Boolean(media.ended);
        const stored = window.__elfixMediaWatchTracker.get(media);
        const previous = stored && stored.sourceKey === sourceKey ? stored : {
          currentTime,
          sampledAt: now,
          playedSeconds: 0,
          sourceKey
        };
        const timeDelta = Math.max(0, (now - previous.sampledAt) / 1000);
        const mediaDelta = currentTime - previous.currentTime;
        const naturalPlaybackDelta = mediaDelta > 0 && mediaDelta <= timeDelta + 2
          ? Math.min(mediaDelta, timeDelta + 2)
          : 0;
        const playedSeconds = Math.min(duration || Number.MAX_SAFE_INTEGER, previous.playedSeconds + naturalPlaybackDelta);
        window.__elfixMediaWatchTracker.set(media, {
          currentTime,
          sampledAt: now,
          playedSeconds,
          sourceKey
        });
        return {
          currentTime,
          duration,
          playedSeconds,
          paused,
          ended,
          readyState: Number(media.readyState || 0),
          area: visibleArea(media),
          frameUrl: location.href,
          nextUrl: nextEpisodeUrl()
        };
      })
      .filter((item) => item.duration > 0 && item.currentTime >= 0 && item.currentTime <= item.duration + 3 && item.readyState > 0)
      .sort((left, right) => {
        if (left.ended !== right.ended) return left.ended ? -1 : 1;
        if (left.paused !== right.paused) return left.paused ? 1 : -1;
        return right.area - left.area;
      });
    return medias[0] || null;
  })()`;
}

module.exports = { messSkript };
