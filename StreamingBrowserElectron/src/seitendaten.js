"use strict";

/*
 * Was auf der Anbieterseite steht: Titel, Art, Titelbild, Favicon und die
 * Grenzen der Serie.
 *
 * Dieses Skript laeuft in der Anbieterseite selbst, nicht in ELFIX. Es stand
 * bis hierher als Textblock mitten in main.js und war damit nur am Rechner zu
 * haben - mit der Folge, dass auf dem Telefon jeder Eintrag ohne Bild blieb
 * und die Karten Buchstaben zeigten, wo am Rechner das Titelbild steht.
 *
 * Es liegt jetzt neben messung.js und aus demselben Grund: der Kern der
 * Android-App laedt dieselbe Datei und spielt denselben Quelltext in den
 * WebView ein. Ein Bild, das der Rechner findet, findet das Telefon damit
 * auch - und wenn sich die Bildsuche aendert, aendert sie sich fuer beide.
 *
 * Jedes Ergebnis traegt seine eigene Adresse mit (`seiteUrl`). Das klingt
 * ueberfluessig - der Aufrufer weiss doch, welche Seite er gefragt hat -, ist
 * es aber nicht: zwischen "Adresse merken" und "Skript ausgewertet" liegen
 * beim Folgenwechsel mehrere Awaits, und wer danach beides zusammenlegt, legt
 * womoeglich die Adresse der alten Folge auf die Angaben der neuen. Genau so
 * bekam ein Eintrag von Attack on Titan den Titel einer fremden Serie. Mit dem
 * Stempel laesst sich das pruefen statt hoffen - siehe seitendatenPassenZu()
 * in fortschritt.js.
 *
 * Herausgesucht wird ein Titelbild und kein beliebiges: Platzhalter, Logos,
 * Fahnen und die Poster aus den Empfehlungsspalten fallen durch, und was
 * uebrig bleibt, wird an den Woertern des Titels gemessen. Ein falsches Bild
 * waere schlimmer als keins.
 */

/** Das Skript als Quelltext, fertig zum Einspielen. */
function seitenSkript() {
  return `(() => {
    const abs = (value) => {
      try { return value ? new URL(value, location.href).href : ""; } catch (_) { return ""; }
    };
    const imageUrl = (node) => node && (
      node.currentSrc
      || node.src
      || node.getAttribute("data-src")
      || node.getAttribute("data-lazy-src")
      || node.getAttribute("data-original")
      || node.getAttribute("data-image")
      || node.getAttribute("src")
    );
    const imageMeta = document.querySelector("meta[property='og:image'], meta[name='twitter:image']");
    const icon = document.querySelector("link[rel~='icon'], link[rel='shortcut icon']");
    const candidates = [];
    const isStoPage = location.hostname === "s.to"
      || location.hostname.endsWith(".s.to")
      || /^\\d{1,3}(?:\\.\\d{1,3}){3}$/.test(location.hostname);
    const isFilmoPage = location.hostname.toLowerCase().includes("filmo");
    const isAniWorldPage = location.hostname.toLowerCase().includes("aniworld");
    const pushCandidate = (url, score) => {
      const href = abs(url);
      if (!href || /(?:logo|favicon|sprite|icon|avatar|flag|placeholder|blank)/i.test(href)) return;
      candidates.push({ href, score });
    };
    const imageText = (img) => [
      img.alt,
      img.title,
      img.className,
      img.id,
      img.closest("[class], [id]") && img.closest("[class], [id]").className,
      img.closest("[class], [id]") && img.closest("[class], [id]").id
    ].join(" ");
    const nearbyText = (node, depth) => {
      const parts = [];
      let current = node;
      for (let index = 0; current && index < depth; index += 1) {
        parts.push(current.textContent || "");
        if (current.previousElementSibling) parts.push(current.previousElementSibling.textContent || "");
        if (current.nextElementSibling) parts.push(current.nextElementSibling.textContent || "");
        current = current.parentElement;
      }
      return parts.join(" ").replace(/\\s+/g, " ").trim();
    };
    const styleImageUrl = (node) => {
      try {
        const value = getComputedStyle(node).backgroundImage || "";
        const match = value.match(/url\\(["']?([^"')]+)["']?\\)/i);
        return match ? match[1] : "";
      } catch (_) {
        return "";
      }
    };
    const nodeImageUrl = (node) => node && node.tagName === "IMG" ? imageUrl(node) : styleImageUrl(node);
    const mediaSlug = (() => {
      const parts = location.pathname.split("/").filter(Boolean);
      for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index].toLowerCase();
        if (part === "anime" && parts[index + 1]?.toLowerCase() === "stream" && parts[index + 2]) return parts[index + 2];
        if (part === "serie" && parts[index + 1]?.toLowerCase() === "stream" && parts[index + 2]) return parts[index + 2];
        if ((part === "serie" || part === "stream") && parts[index + 1]) return parts[index + 1];
      }
      return parts.find((part) => !/^(anime|serie|stream|staffel-\\d+|episode-\\d+)$/i.test(part)) || "";
    })().toLowerCase();
    const normalizeText = (value) => String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\\s+/g, " ")
      .trim();
    // Fuellwoerter wie "der" oder "the" stehen in fast jedem Titel und wuerden
    // das Bild einer fremden Serie als passend durchgehen lassen. Bleibt nach
    // dem Aussortieren nichts uebrig, wird die ungefilterte Liste genommen.
    const fuellwoerter = /^(?:der|die|das|dem|den|des|ein|eine|einen|einem|eines|und|oder|aber|mit|von|vom|zum|zur|fur|fuer|auf|aus|bei|ist|sind|wie|als|auch|nur|nicht|sich|ihre|sein|seine|dass|dann|the|and|for|with|from|that|this|you|are|was|were|his|her|its|has|had|have|not|but)$/i;
    const mediaTokens = mediaSlug.split(/[-_]+/).filter((token) => token.length > 2);
    const titleTokens = normalizeText((document.querySelector("h1")?.textContent || "") + " " + (document.title || ""))
      .split(" ")
      .filter((token) => token.length > 2 && !/^(serie|staffel|folge|episode|stream|kostenlos|ansehen|season)$/i.test(token));
    const alleTokens = Array.from(new Set([...mediaTokens, ...titleTokens]));
    const ohneFuellwoerter = alleTokens.filter((token) => !fuellwoerter.test(token));
    const expectedTokens = ohneFuellwoerter.length ? ohneFuellwoerter : alleTokens;
    const episodeIdentityFromHref = (href) => {
      try {
        const url = new URL(href, location.href);
        const parts = url.pathname.split("/").filter(Boolean);
        let slug = "";
        let season = 0;
        let episode = 0;
        for (let index = 0; index < parts.length; index += 1) {
          const part = parts[index].toLowerCase();
          if (part === "anime" && parts[index + 1]?.toLowerCase() === "stream" && parts[index + 2]) slug = parts[index + 2].toLowerCase();
          if (part === "serie" && parts[index + 1]?.toLowerCase() === "stream" && parts[index + 2]) slug = parts[index + 2].toLowerCase();
          if ((part === "serie" || part === "stream") && parts[index + 1] && !slug) slug = parts[index + 1].toLowerCase();
          const seasonMatch = part.match(/^(?:staffel|season)-(\\d+)$/i);
          if (seasonMatch) season = Number(seasonMatch[1]);
          const episodeMatch = part.match(/^(?:episode|folge)-(\\d+)$/i);
          if (episodeMatch) episode = Number(episodeMatch[1]);
        }
        if (!episode || !Number.isFinite(episode)) return null;
        if (mediaSlug && slug && slug !== mediaSlug) return null;
        return { season: season || 1, episode, href: url.href };
      } catch (_) {
        return null;
      }
    };
    // Manche Folgen sind auf der Uebersicht gelistet, aber nicht abspielbar:
    // S.to fasst z. B. Doppelfolgen zusammen und schreibt in die restlichen
    // Zeilen "[In E18 enthalten]" - ohne Hoster und ohne Sprachfahne. Wuerde
    // eine solche Folge als letzte gelten, liesse sich die Serie nie
    // abschliessen, weil sie niemand abspielen kann.
    const unplayableEpisodes = (() => {
      const gesperrt = new Set();
      const rows = Array.from(document.querySelectorAll("tr, li"));
      for (const row of rows) {
        const nummerZelle = row.querySelector("[class*='episode-number']");
        const ausZelle = Number(String(nummerZelle?.textContent || "").trim());
        const linkTreffer = String(row.getAttribute("onclick") || "")
          .concat(" ", row.querySelector("a[href]")?.getAttribute("href") || "")
          .match(/(?:episode|folge)-(\\d+)/i);
        const nummer = Number.isFinite(ausZelle) && ausZelle > 0
          ? ausZelle
          : Number(linkTreffer?.[1] || 0);
        if (!Number.isFinite(nummer) || nummer <= 0) continue;

        const text = String(row.textContent || "");
        const sammelfolge = /\\[\\s*in\\s+(?:e|ep|episode|folge)\\s*\\d+\\s+enthalten\\s*\\]/i.test(text);
        const watchZelle = row.querySelector("[class*='watch-cell'], [class*='episode-watch']");
        const ohneHoster = Boolean(watchZelle)
          && !watchZelle.querySelector("img, svg, a, button, [class*='watch-link']");
        if (sammelfolge || ohneHoster) gesperrt.add(nummer);
      }
      return gesperrt;
    })();
    const pageSeason = (() => {
      const match = location.pathname.match(/\\/(?:staffel|season)-(\\d+)/i);
      return match ? Number(match[1]) : 0;
    })();
    const seriesBounds = (() => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const links = anchors
        .map((anchor) => episodeIdentityFromHref(anchor.getAttribute("href")))
        .filter(Boolean);
      const seasonNumbers = anchors
        .map((anchor) => {
          const href = abs(anchor.getAttribute("href"));
          const hrefMatch = href.match(/\\/(?:staffel|season)-(\\d+)(?:[/?#]|$)/i);
          return hrefMatch ? Number(hrefMatch[1]) : 0;
        })
        .filter((number) => Number.isFinite(number) && number > 0);
      const finalSeason = Math.max(0, ...seasonNumbers, ...links.map((link) => link.season || 0));
      const derStaffel = links
        .filter((link) => !finalSeason || link.season === finalSeason)
        .sort((left, right) => right.episode - left.episode);
      const hoechste = derStaffel[0];

      // Nur die Folgen der gerade angezeigten Staffel lassen sich beurteilen -
      // fuer andere Staffeln steht keine Liste auf der Seite.
      const beurteilbar = !pageSeason || !finalSeason || pageSeason === finalSeason;
      const spielbar = beurteilbar
        ? derStaffel.filter((link) => !unplayableEpisodes.has(link.episode))
        : derStaffel;
      const best = spielbar[0] || hoechste;
      return {
        finalSeason,
        finalEpisode: best?.episode || 0,
        finalEpisodeTrimmed: Boolean(best && hoechste && best.episode < hoechste.episode),
        unplayableSeason: pageSeason,
        unplayableEpisodes: beurteilbar || pageSeason ? Array.from(unplayableEpisodes) : []
      };
    })();
    const visibleTitle = () => {
      const h1 = document.querySelector("h1");
      const mainTitle = String(h1?.textContent || "").replace(/\\s+/g, " ").trim();
      if (mainTitle) return mainTitle;
      return String(document.title || "").replace(/\\s+/g, " ").trim();
    };
    const currentFilmTitle = () => {
      const path = location.pathname.toLowerCase();
      const match = path.match(/\\/(?:filme|film|movies|movie)\\/(?:film|movie)?-?(\\d+)(?:\\/|$)/i)
        || path.match(/\\/(?:film|movie)-(\\d+)(?:\\/|$)/i);
      if (!match) return "";
      const number = Number(match[1]);
      if (!Number.isFinite(number) || number <= 0) return "";
      const targetHref = new RegExp("/(?:filme|film|movies|movie)/(?:film|movie)?-?" + number + "(?:/|$)|/(?:film|movie)-" + number + "(?:/|$)", "i");
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const matchingAnchor = anchors.find((anchor) => targetHref.test(abs(anchor.getAttribute("href"))));
      const row = matchingAnchor?.closest("tr, li, .row, [class*='episode'], [class*='film'], [class*='movie']");
      const raw = String(row?.textContent || matchingAnchor?.textContent || "")
        .replace(/\\s+/g, " ")
        .trim();
      const cleaned = raw
        .replace(new RegExp("^Film\\\\s*" + number + "\\\\s*", "i"), "")
        .replace(/\\b(?:hoster|sprache|deutsch|english|voe|streamtape|doodstream|vidoza)\\b.*$/i, "")
        .replace(/\\s+/g, " ")
        .trim();
      if (cleaned) return cleaned;

      const seriesTitle = normalizeText(visibleTitle());
      const lines = String(document.body?.innerText || "")
        .split(/\\n+/)
        .map((line) => line.replace(/\\s+/g, " ").trim())
        .filter((line) => line.length >= 8 && line.length <= 180);
      return lines.find((line) => {
        const normalized = normalizeText(line);
        if (!normalized || normalized === seriesTitle) return false;
        if (/^(home|animes|staffeln?|filme|film\\s*\\d+|episoden?|hoster|sprache|kommentare)$/i.test(line)) return false;
        return /\\[(?:movie|film|ova)[^\\]]*\\]|\\b(?:movie|ova|film)\\b/i.test(line);
      }) || "";
    };
    const mediaTitle = () => currentFilmTitle() || visibleTitle();
    const activeMediaType = () => {
      const path = location.pathname.toLowerCase();
      if (/\\/(?:staffel|season)-\\d+(?:\\/|$)/i.test(path) || /\\/(?:episode|folge)-\\d+(?:\\/|$)/i.test(path)) {
        return "serie";
      }
      if (/\\/(?:filme|film|movie|movies)(?:\\/|$)/i.test(path) || /\\/(?:film|movie)-\\d+(?:\\/|$)/i.test(path)) {
        return "film";
      }
      const pageText = [
        ...Array.from(document.querySelectorAll(".breadcrumb, nav, [class*='breadcrumb'], [class*='season'], [class*='staffel']"))
          .slice(0, 12)
          .map((node) => node.textContent || "")
      ].join(" ");
      const activeTabText = Array.from(document.querySelectorAll(".active, .selected, [aria-current='page'], [class*='active']"))
        .map((node) => node.textContent || "")
        .join(" ");
      if (isAniWorldPage && /(?:^|\\s|›|>)(filme|film)(?:\\s|$|›|>)/i.test(activeTabText || pageText)) return "film";
      if (isFilmoPage) return "film";
      if (isStoPage || isAniWorldPage) return "serie";
      return "";
    };
    const isRecommendationArea = (img) => {
      const text = nearbyText(img, 4).toLowerCase();
      if (/(?:das schauen andere|schauen andere|empfehlungen|aehnliche|ähnliche|kommentare|kommentar)/i.test(text)) return true;
      let current = img;
      for (let index = 0; current && index < 8; index += 1) {
        let sibling = current.previousElementSibling;
        for (let count = 0; sibling && count < 4; count += 1) {
          if (/(?:das schauen andere|schauen andere|empfehlungen|aehnliche|ähnliche|kommentare)/i.test(sibling.textContent || "")) return true;
          sibling = sibling.previousElementSibling;
        }
        current = current.parentElement;
      }
      return false;
    };
    // Titelfaehige Woerter (avatar, black, flag) nur im Ordnerpfad als
    // Ausschluss werten - im Dateinamen steht der Name der Serie.
    const istMuellBild = (href) => {
      const wert = String(href || "");
      if (!wert || /(?:favicon|sprite|placeholder|blank|transparent|loading|spinner|no-?image|og-image)/i.test(wert)) return true;
      const ohneQuery = wert.split(/[?#]/)[0];
      const ordner = ohneQuery.slice(0, ohneQuery.lastIndexOf("/") + 1);
      return /(?:logo|icon|avatar|flag|banner|button|rating|language|login|register|facebook|twitter|social|share|ads?)/i.test(ordner);
    };
    const isStoChannelArtwork = (href) => /\\/media\\/images\\/channel\\/(?:2x-)?desktop\\/[^?#]+/i.test(href)
      && !istMuellBild(href);
    const bestSrcsetImage = (img) => {
      const srcset = img.getAttribute("data-srcset") || img.getAttribute("srcset") || "";
      const candidates = srcset.split(",")
        .map((entry) => {
          const parts = entry.trim().split(/\\s+/);
          const href = abs(parts[0] || "");
          const descriptor = parts[1] || "";
          const scale = descriptor.endsWith("x") ? Number.parseFloat(descriptor) || 1 : 1;
          return { href, scale };
        })
        .filter((candidate) => isStoChannelArtwork(candidate.href))
        .sort((a, b) => b.scale - a.scale);
      return candidates[0]?.href || "";
    };
    const stoChannelImageUrl = (img) => {
      const fromSrcset = bestSrcsetImage(img);
      if (fromSrcset) return fromSrcset;
      const raw = img.getAttribute("data-src")
        || img.getAttribute("src")
        || img.currentSrc
        || img.src
        || "";
      const href = abs(raw);
      return isStoChannelArtwork(href) ? href : "";
    };
    const stoInfoPanelImage = () => {
      const nodes = Array.from(document.querySelectorAll([
        "img[src*='/media/images/channel/']",
        "img[data-src*='/media/images/channel/']",
        "img[srcset*='/media/images/channel/']",
        "img[data-srcset*='/media/images/channel/']"
      ].join(",")));
      let best = null;
      let bestScore = 0;
      for (const img of nodes) {
        const href = stoChannelImageUrl(img);
        if (!href) continue;
        if (isRecommendationArea(img)) continue;
        const rect = img.getBoundingClientRect();
        const width = img.naturalWidth || rect.width || 0;
        const height = img.naturalHeight || rect.height || 0;
        const ratio = width / Math.max(1, height);
        if (width < 80 || height < 110 || ratio < 0.35 || ratio > 1.05) continue;

        const near = nearbyText(img, 8).toLowerCase();
        const combined = normalizeText(imageText(img) + " " + near + " " + href);
        const overlap = expectedTokens.filter((token) => combined.includes(token)).length;
        if (expectedTokens.length && overlap === 0) continue;
        let score = 1800;
        if (/\\/2x-desktop\\//i.test(href)) score += 320;
        score += overlap * 420;
        if (/(?:staffeln?:|episoden?:|fsk\\s*\\d+|mehr anzeigen|beschreibung|bewertungen|veröffentlicht|veroeffentlicht)/i.test(near)) score += 900;
        if (rect.left > innerWidth * 0.42) score += 420;
        if (rect.top >= 0 && rect.top < Math.max(780, innerHeight)) score += 260;
        if (/(?:das schauen andere|schauen andere|empfehlungen|kommentare)/i.test(near)) score -= 4000;
        score += Math.max(0, 220 - Math.abs(ratio - 0.68) * 350);
        if (score > bestScore) {
          bestScore = score;
          best = href;
        }
      }
      return best || "";
    };
    const isAniWorldArtwork = (href) => {
      try {
        const url = new URL(href, location.href);
        const value = url.href.toLowerCase();
        return url.hostname.toLowerCase().includes("aniworld")
          && !/(?:logo|favicon|sprite|icon|avatar|flag|placeholder|blank|transparent|loading|spinner|play|button|rating|language|login|register|facebook|twitter|og-image|social|share|default|noimage|no-image)/i.test(value)
          && /\\/public\\/img\\/cover\\/[^/?#]+\\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname);
      } catch (_) {
        return false;
      }
    };
    const bestAniWorldSrcsetImage = (node) => {
      const srcset = node.getAttribute("data-srcset") || node.getAttribute("srcset") || "";
      const candidates = srcset.split(",")
        .map((entry) => {
          const parts = entry.trim().split(/\\s+/);
          const href = abs(parts[0] || "");
          const descriptor = parts[1] || "";
          const scale = descriptor.endsWith("x") ? Number.parseFloat(descriptor) || 1 : 1;
          const width = descriptor.endsWith("w") ? Number.parseFloat(descriptor) || 0 : 0;
          return { href, scale, width };
        })
        .filter((candidate) => isAniWorldArtwork(candidate.href))
        .sort((a, b) => (b.scale - a.scale) || (b.width - a.width));
      return candidates[0]?.href || "";
    };
    const aniWorldNodeImageUrl = (node) => {
      if (!node) return "";
      if (node.tagName === "IMG") {
        return bestAniWorldSrcsetImage(node)
          || abs(node.getAttribute("data-src"))
          || abs(node.getAttribute("data-lazy-src"))
          || abs(node.getAttribute("data-original"))
          || abs(node.getAttribute("data-image"))
          || abs(node.currentSrc || node.src || node.getAttribute("src"));
      }
      return abs(
        node.getAttribute("data-bg")
        || node.getAttribute("data-background")
        || node.getAttribute("data-image")
        || styleImageUrl(node)
      );
    };
    const aniWorldMainImage = () => {
      const metaHref = abs(imageMeta && imageMeta.getAttribute("content"));
      const nodes = [
        ...Array.from(document.querySelectorAll("main img, article img, aside img, [class*='cover'] img, [class*='poster'] img, [class*='series'] img, [class*='anime'] img, [class*='description'] img, [class*='info'] img")),
        ...Array.from(document.querySelectorAll("main [style*='background-image'], article [style*='background-image'], aside [style*='background-image'], [class*='cover'][style*='background-image'], [class*='poster'][style*='background-image'], [class*='anime'][style*='background-image']"))
      ];
      const seen = new Set();
      let best = "";
      let bestScore = 0;
      const currentSlug = mediaSlug;
      const badContext = (node) => {
        let current = node;
        for (let depth = 0; current && depth < 7; depth += 1) {
          const label = String(current.className || "") + " " + String(current.id || "") + " " + String(current.textContent || "");
          if (/(?:recommend|similar|carousel|slider|popular|beliebt|kommentare|comment|episode-list|language|login|register)/i.test(label)) return true;
          current = current.parentElement;
        }
        return false;
      };
      const add = (href, node, baseScore) => {
        if (!href || seen.has(href) || !isAniWorldArtwork(href)) return;
        seen.add(href);
        const context = normalizeText((node ? imageText(node) + " " + nearbyText(node, 8) : "") + " " + href + " " + (document.querySelector("h1")?.textContent || ""));
        const overlap = expectedTokens.filter((token) => context.includes(token)).length;
        if (expectedTokens.length && overlap === 0 && !(currentSlug && href.toLowerCase().includes(currentSlug))) return;
        let score = baseScore + overlap * 560;
        if (currentSlug && href.toLowerCase().includes(currentSlug)) score += 900;
        if (node && /cover|poster|series?|serie|anime|stream|description|info/i.test(imageText(node) + " " + nearbyText(node, 4))) score += 320;
        if (node) {
          const rect = node.getBoundingClientRect();
          if (rect.top >= -120 && rect.top < Math.max(900, innerHeight * 1.3)) score += 160;
          if (rect.left > innerWidth * 0.35) score += 120;
        }
        if (score > bestScore) {
          bestScore = score;
          best = href;
        }
      };

      add(metaHref, null, 1400);
      for (const node of nodes) {
        if (badContext(node)) continue;
        const href = aniWorldNodeImageUrl(node);
        if (!href) continue;
        const rect = node.getBoundingClientRect();
        const width = node.naturalWidth || rect.width || 0;
        const height = node.naturalHeight || rect.height || 0;
        if (node.tagName === "IMG" && width > 0 && height > 0 && (width < 70 || height < 70)) continue;
        add(href, node, 1800);
      }
      return best || "";
    };
    const filmoImageUrl = (node) => {
      if (!node) return "";
      if (node.tagName === "IMG") {
        const srcset = node.getAttribute("data-srcset") || node.getAttribute("srcset") || "";
        const best = srcset.split(",")
          .map((entry) => {
            const parts = entry.trim().split(/\\s+/);
            const href = abs(parts[0] || "");
            const descriptor = parts[1] || "";
            const scale = descriptor.endsWith("x") ? Number.parseFloat(descriptor) || 1 : 1;
            return { href, scale };
          })
          .filter((item) => item.href && !/(?:logo|favicon|sprite|icon|avatar|flag|placeholder|blank|transparent|play|spinner)/i.test(item.href))
          .sort((a, b) => b.scale - a.scale)[0]?.href || "";
        if (best) return best;
        return abs(imageUrl(node));
      }
      return abs(
        node.getAttribute("data-bg")
        || node.getAttribute("data-background")
        || node.getAttribute("data-image")
        || styleImageUrl(node)
      );
    };
    const filmoMainImage = () => {
      const metaHref = abs(imageMeta && imageMeta.getAttribute("content"));
      const nodes = [
        ...Array.from(document.querySelectorAll("main img, article img, [class*='hero'] img, [class*='detail'] img, [class*='cover'] img, [class*='poster'] img")),
        ...Array.from(document.querySelectorAll("main [style*='background-image'], article [style*='background-image'], [class*='hero'][style*='background-image'], [class*='detail'][style*='background-image'], [class*='cover'][style*='background-image'], [class*='poster'][style*='background-image']"))
      ];
      const seen = new Set();
      let best = "";
      let bestScore = 0;
      const badContext = (node) => {
        let current = node;
        for (let depth = 0; current && depth < 7; depth += 1) {
          const label = String(current.className || "") + " " + String(current.id || "");
          if (/(?:recommend|similar|carousel|slider|popular|beliebt|entdecken)/i.test(label)) return true;
          let sibling = current.previousElementSibling;
          for (let count = 0; sibling && count < 4; count += 1) {
            if (/(?:das schauen andere|schauen andere|empfehlungen|aehnliche|ähnliche|beliebt|entdecken|kinder|familienfilme|neu veröffentlicht|neu veroeffentlicht|mehr anzeigen|kommentare)/i.test(sibling.textContent || "")) return true;
            sibling = sibling.previousElementSibling;
          }
          current = current.parentElement;
        }
        return false;
      };
      const add = (href, context, baseScore) => {
        if (!href || seen.has(href)) return;
        seen.add(href);
        if (/(?:logo|favicon|sprite|icon|avatar|flag|placeholder|blank|transparent|play|spinner|language|rating)/i.test(href)) return;
        const combined = normalizeText(context + " " + href);
        const overlap = expectedTokens.filter((token) => combined.includes(token)).length;
        if (expectedTokens.length && overlap === 0) return;
        let score = baseScore + overlap * 650;
        if (/\\.(?:jpg|jpeg|png|webp)(?:\\?|$)/i.test(href)) score += 80;
        if (mediaSlug && href.toLowerCase().includes(mediaSlug)) score += 500;
        if (score > bestScore) {
          bestScore = score;
          best = href;
        }
      };

      add(metaHref, String(document.title || "") + " " + mediaSlug, 2100);
      for (const node of nodes) {
        const href = filmoImageUrl(node);
        if (!href || badContext(node)) continue;
        const rect = node.getBoundingClientRect();
        const width = node.naturalWidth || rect.width || 0;
        const height = node.naturalHeight || rect.height || 0;
        if (node.tagName === "IMG" && (width < 90 || height < 90)) continue;
        const context = imageText(node) + " " + nearbyText(node, 8) + " " + (document.querySelector("h1")?.textContent || "");
        let score = 1200;
        if (/hero|detail|cover|poster|backdrop|title|movie|film/i.test(imageText(node))) score += 320;
        if (rect.top >= -120 && rect.top < Math.max(900, innerHeight * 1.2)) score += 180;
        add(href, context, score);
      }
      return best || "";
    };
    if (isStoPage) {
      const infoPanelPoster = stoInfoPanelImage();
      if (infoPanelPoster) {
        return {
          title: mediaTitle(),
          type: activeMediaType(),
          favicon: abs(icon && icon.getAttribute("href")),
          seiteUrl: location.href,
          thumbnail: infoPanelPoster,
          ...seriesBounds
        };
      }

      return {
        title: mediaTitle(),
        type: activeMediaType(),
        favicon: abs(icon && icon.getAttribute("href")),
        seiteUrl: location.href,
        thumbnail: "",
        ...seriesBounds
      };
    }
    if (isFilmoPage) {
      return {
        title: mediaTitle(),
        type: activeMediaType(),
        favicon: abs(icon && icon.getAttribute("href")),
        seiteUrl: location.href,
        thumbnail: filmoMainImage(),
        ...seriesBounds
      };
    }
    if (isAniWorldPage) {
      return {
        title: mediaTitle(),
        type: activeMediaType(),
        favicon: abs(icon && icon.getAttribute("href")),
        seiteUrl: location.href,
        thumbnail: aniWorldMainImage(),
        ...seriesBounds
      };
    }
    pushCandidate(imageMeta && imageMeta.getAttribute("content"), 70);
    for (const img of Array.from(document.images || [])) {
      const href = imageUrl(img);
      if (!href) continue;
      const rect = img.getBoundingClientRect();
      const width = img.naturalWidth || rect.width || 0;
      const height = img.naturalHeight || rect.height || 0;
      const text = imageText(img);
      const lower = text.toLowerCase();
      const urlLower = String(href).toLowerCase();
      const combined = lower + " " + urlLower;
      if (/(?:logo|favicon|sprite|icon|avatar|flag|language|rating|play|spinner)/i.test(combined)) continue;
      if (width < 90 || height < 90) continue;
      const ratio = width / Math.max(1, height);
      let score = Math.min(45, Math.round(Math.max(width, height) / 18));
      if (isStoPage) {
        if (rect.left > innerWidth * 0.45 && ratio > 0.42 && ratio < 0.92) score += 220;
        if (ratio >= 1.15 || rect.left < innerWidth * 0.35) score -= 180;
      }
      if (/cover|poster|series?|serie|film|movie|anime|stream|title|thumbnail|teaser/i.test(combined)) score += 52;
      if (ratio > 0.48 && ratio < 0.86) score += 34;
      if (ratio >= 0.86 && ratio < 1.9) score += 16;
      if (rect.top >= -80 && rect.top < Math.max(900, innerHeight * 1.4)) score += 12;
      pushCandidate(href, score);
    }
    candidates.sort((a, b) => b.score - a.score);
    return {
      title: mediaTitle(),
      type: activeMediaType(),
      favicon: abs(icon && icon.getAttribute("href")),
      seiteUrl: location.href,
      thumbnail: candidates[0]?.href || "",
      ...seriesBounds
    };
  })()`;
}

module.exports = { seitenSkript };
