"use strict";

/*
 * Bilder nachreichen, die eine Seite selbst nicht laedt.
 *
 * AniWorld haengt seine Cover nicht in den <img>, sondern daneben: im
 * Attribut data-src. Im src steht ein durchsichtiges Bild von einem Pixel, und
 * ein Skript von einem fremden Wirt (cdnjs.cloudflare.com, vanilla-lazyload)
 * soll beides beim Scrollen tauschen. Kommt dieses Skript nicht durch - kein
 * Netz, langsamer Wirt, oder ein Werbeblocker, der einen fremden Wirt nicht
 * durchlaesst -, bleibt jede Kachel leer. Deshalb tauscht ELFIX selbst.
 *
 * Das Skript steht hier und nicht mehr in main.js, damit es sich fahren laesst:
 * es entscheidet, welches Bild eine Seite wirklich meint, und diese
 * Entscheidung war schon einmal still falsch (siehe bildnachreichungtest).
 */

/** Das Skript als Quelltext, fertig zum Einspielen. */
function nachreichSkript() {
  return `(() => {
    if (window.__elflixAniWorldImageFixV2) return;
    window.__elflixAniWorldImageFixV2 = true;

    const abs = (value) => {
      try { return value ? new URL(value, location.href).href : ""; } catch (_) { return ""; }
    };
    // Ein Platzhalter ist kein Bild - auch wenn er wie eine gueltige Adresse
    // aussieht.
    //
    // Genau daran ist diese Nachreichung einmal blind geworden: AniWorld setzt
    // in den src ein durchsichtiges PNG von einem Pixel, eingebettet als
    // data:-Adresse. Die trug keines der Woerter unten, galt damit als
    // brauchbares Bild - und weil so ein Bild sofort fertig geladen ist
    // (img.complete === true), sah die Nachreichung ein Bild, das schon da war,
    // und liess das Cover daneben liegen. Auf der Seite blieb jede Kachel leer.
    //
    // Eingebettete Adressen sind hier deshalb nie das gemeinte Bild: was eine
    // Seite wirklich zeigen will, laedt sie, statt es mitzuschicken.
    const usefulImage = (value) => {
      const href = abs(value);
      if (!href) return false;
      if (/^(?:data|blob):/i.test(href)) return false;
      return !/(?:logo|favicon|sprite|icon|avatar|flag|placeholder|blank|transparent|loading|spinner)/i.test(href);
    };
    const firstUrlFromSrcset = (value) => String(value || "")
      .split(",")
      .map((entry) => entry.trim().split(/\\s+/)[0])
      .find(Boolean) || "";
    const hydrateImage = (img) => {
      if (!img) return;
      const lazySrcset = img.getAttribute("data-srcset") || img.getAttribute("data-lazy-srcset");
      const lazySrc = img.getAttribute("data-src")
        || img.getAttribute("data-lazy-src")
        || img.getAttribute("data-original")
        || img.getAttribute("data-url")
        || img.getAttribute("data-image")
        || firstUrlFromSrcset(lazySrcset);
      const key = [lazySrcset || "", lazySrc || "", img.getAttribute("src") || ""].join("|");
      if (img.dataset.elflixHydrated === "1" && img.dataset.elflixHydrationKey === key) return;
      if (lazySrcset && !img.getAttribute("srcset")) img.setAttribute("srcset", lazySrcset);
      if (usefulImage(lazySrc) && (!usefulImage(img.getAttribute("src")) || img.complete === false)) {
        img.setAttribute("src", abs(lazySrc));
      }
      img.loading = "eager";
      img.decoding = "async";
      img.dataset.elflixHydrated = "1";
      img.dataset.elflixHydrationKey = key;
    };
    const hydrateBackground = (node) => {
      if (!node) return;
      const raw = node.getAttribute("data-bg")
        || node.getAttribute("data-background")
        || node.getAttribute("data-image")
        || node.getAttribute("data-src");
      if (node.dataset.elflixBgHydrated === "1" && node.dataset.elflixBgHydrationKey === String(raw || "")) return;
      if (usefulImage(raw)) node.style.backgroundImage = 'url("' + abs(raw).replace(/"/g, "%22") + '")';
      node.dataset.elflixBgHydrated = "1";
      node.dataset.elflixBgHydrationKey = String(raw || "");
    };
    const hideInfoToggles = () => {
      for (const node of Array.from(document.querySelectorAll("button, a, [role='button'], .btn, [class*='button'], [class*='toggle'], [class*='info']"))) {
        const text = String(node.innerText || node.textContent || "").replace(/\\s+/g, " ").trim();
        if (!/^infos?\\s+(?:verstecken|anzeigen)\\b/i.test(text) || text.length > 40) continue;
        node.style.setProperty("display", "none", "important");
        node.setAttribute("aria-hidden", "true");
        node.tabIndex = -1;
      }
    };
    const run = () => {
      document.querySelectorAll("img").forEach(hydrateImage);
      document.querySelectorAll("[data-bg], [data-background], [data-image], [data-src]").forEach(hydrateBackground);
      hideInfoToggles();
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("resize"));
    };
    run();
    const observer = new MutationObserver(run);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-src", "data-srcset", "data-lazy-src", "data-original", "src"] });
    for (const delay of [250, 900, 1800, 3600]) setTimeout(run, delay);
  })()`;
}

module.exports = { nachreichSkript };
