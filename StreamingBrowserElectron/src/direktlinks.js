"use strict";

/*
 * Welcher Hoster ueberhaupt gefragt wird.
 *
 * Eine Folgenseite bietet mehrere an - bei AniWorld stehen sie als Kaecheln
 * unter dem Player, je Synchronfassung eine eigene Reihe. Bevor irgendetwas
 * aufgeloest werden kann, muss also feststehen, welcher Link gemeint ist. Genau
 * das steht hier: das Skript, das die Liste aus der Seite holt, und die Regel,
 * nach der daraus einer wird.
 *
 * <h2>Warum die Regel nicht "der erste" ist</h2>
 *
 * Die Reihenfolge auf der Seite gehoert dem Anbieter, nicht dem Zuschauer. Sie
 * wechselt, sie kennt keine Fassungen, und sie stellt gern nach vorn, was gerade
 * beworben wird. Entschieden wird deshalb nach drei Dingen, in dieser
 * Reihenfolge:
 *
 *   1. Sichtbar. Die Kaecheln der *nicht* gewaehlten Fassung stehen im
 *      Quelltext genauso da wie die der gewaehlten - nur eben verborgen. Wer
 *      das uebergeht, holt die japanische Fassung, waehrend auf dem Schirm
 *      Deutsch ausgewaehlt ist. Dieselbe Unterscheidung trifft fassung.js.
 *   2. Die gewuenschte Fassung, falls eine gemerkt ist.
 *   3. Der Hoster, den die Aufloesung wirklich lesen kann.
 *
 * <h2>Punkt 3 ist eine Auskunft ueber uns, nicht ueber die Hoster</h2>
 *
 * VOE steht vorn, weil direktquelle.js seinen Block auspacken kann; Vidoza und
 * Streamtape folgen, weil ihre Angaben offen im Quelltext stehen. Doodstream
 * steht hinten, denn dort fuehrt der Weg ueber einen zweiten Abruf mit einem
 * Einmalschluessel - den geht dieses ELFIX (noch) nicht. Ein Hoster, der hier
 * nicht steht, ist damit nicht ausgeschlossen: er kommt nach den bekannten
 * dran, und wenn seine Seite die Adresse hergibt, laeuft er.
 *
 * Wird nichts gefunden, ist das kein Fehler, sondern die Ansage, es beim
 * Rahmen des Hosters zu belassen.
 */

/**
 * Die Hoster in der Reihenfolge, in der die Aufloesung mit ihnen zurechtkommt.
 * Kleingeschrieben, verglichen wird als Teilzeichenkette - "VOE.SX" und
 * "Voe" sind derselbe Hoster.
 */
const HOSTER_REIHE = ["voe", "vidoza", "streamtape", "filemoon", "luluvdo", "doodstream", "dood"];

/** Der Rang eines Hosters; unbekannte kommen nach den bekannten. */
function hosterRang(name) {
  const wert = String(name || "").toLowerCase();
  for (let i = 0; i < HOSTER_REIHE.length; i += 1) {
    if (wert.includes(HOSTER_REIHE[i])) return i;
  }
  return HOSTER_REIHE.length;
}

/**
 * Ein Eintrag, wie das Skript ihn liefert - auf das Noetige beschnitten.
 *
 * Beschnitten wird, weil der Text aus einer fremden Seite kommt: ein Hostername
 * ist ein Wort und keine Seite Text.
 */
function eintragNormalisieren(roh) {
  const adresse = String(roh?.adresse || "").trim();
  if (!adresse) return null;
  return {
    adresse,
    hoster: String(roh?.hoster || "").trim().slice(0, 40),
    sprache: String(roh?.sprache || "").trim().slice(0, 20),
    sichtbar: Boolean(roh?.sichtbar)
  };
}

/**
 * Die Liste, geordnet - und zwar vollstaendig, nicht nur ihr Kopf.
 *
 * Zurueck kommt die ganze Reihenfolge und nicht nur der Sieger, weil der
 * Aufrufer sie braucht: gibt der erste Hoster nichts her, ist der zweite dran.
 * Ein Aufloesungsversuch ist billig, ein Zuschauer vor einem schwarzen Bild
 * ist teuer.
 */
function linksOrdnen(liste, wunschSprache = "") {
  const eintraege = (Array.isArray(liste) ? liste : [])
    .map(eintragNormalisieren)
    .filter(Boolean);

  const gesehen = new Set();
  const einmalig = eintraege.filter((eintrag) => {
    if (gesehen.has(eintrag.adresse)) return false;
    gesehen.add(eintrag.adresse);
    return true;
  });

  /*
   * Die gewuenschte Fassung - in allen Worten, unter denen sie auftreten kann.
   *
   * AniWorld nennt sie als Zahl (`data-lang-key="1"`), S.to als Wort
   * ("Deutsch"), Filmo als Ueberschrift der Kachelreihe ("English"). Was
   * `fassung.js` gemerkt hat, traegt beides: den Schluessel und die Rohangabe.
   * Verglichen wird deshalb gegen alle, und ohne Ruecksicht auf Gross- und
   * Kleinschreibung - sonst greift die gemerkte Fassung genau bei den zwei
   * Anbietern nicht, die keine Zahlen vergeben.
   */
  const woerter = (typeof wunschSprache === "object" && wunschSprache
    ? [wunschSprache.key, wunschSprache.roh, wunschSprache.name]
    : [wunschSprache])
    .map((wert) => String(wert || "").trim().toLowerCase())
    .filter(Boolean);
  const passt = (eintrag) => {
    if (woerter.length === 0) return true;
    const sprache = String(eintrag.sprache || "").trim().toLowerCase();
    return sprache ? woerter.includes(sprache) : false;
  };
  const punkte = (eintrag) => (eintrag.sichtbar ? 0 : 2) + (passt(eintrag) ? 0 : 1);

  return einmalig
    .map((eintrag, stelle) => ({ eintrag, stelle }))
    .sort((links, rechts) => {
      const abstand = punkte(links.eintrag) - punkte(rechts.eintrag);
      if (abstand) return abstand;
      const rang = hosterRang(links.eintrag.hoster) - hosterRang(rechts.eintrag.hoster);
      if (rang) return rang;
      return links.stelle - rechts.stelle;
    })
    .map((eintrag) => eintrag.eintrag);
}

/** Der eine Link, mit dem angefangen wird. */
function besterLink(liste, wunschSprache = "") {
  return linksOrdnen(liste, wunschSprache)[0] || null;
}

/**
 * So viele Kacheln laesst sich Filmo hoechstens eine Marke ausstellen.
 *
 * Filmo gibt seine Adressen nicht im Markup preis - jede muss einzeln
 * angefordert werden (siehe unten). Das ist je Kachel eine Anfrage, also wird
 * es begrenzt: eine Filmseite hat drei bis fuenf, und mehr als die besten
 * werden ohnehin nie probiert.
 */
const FILMO_HOECHSTENS = 6;

/**
 * Das Skript, das die Liste aus der Folgenseite holt.
 *
 * Es laeuft im Hauptdokument des Anbieters, nicht im Rahmen des Hosters - dort
 * stehen die Kaecheln. Gesucht wird an vier Stellen, weil die drei Anbieter es
 * verschieden halten - alle drei am 2026-09-05 nachgesehen:
 *
 *   AniWorld  der Link selbst (`/redirect/<id>`) und `data-link-target`.
 *   S.to      hat im Sommer 2026 umgebaut: `data-play-url="/r?t=<token>"`,
 *             daneben `data-provider-name` und `data-language-label`. Wer nur
 *             nach `/redirect/` sucht, findet dort seit dem Umbau nichts und
 *             meldet "kein Hoster auf der Seite".
 *   Filmo     gibt gar keine Adresse preis. Jede Kachel traegt ein
 *             verschluesseltes `data-p`; wer die Adresse will, laesst sich
 *             damit erst eine Marke ausstellen (POST auf `openMint`) und ruft
 *             sie dann ab. Das ist der "zweite Klick", den Filmo verlangt.
 *
 * Die Marke wird hier in der Seite geholt und nicht im Hauptprozess, und das
 * ist der Punkt: Sitzungskeks und CSRF-Marke muessen aus derselben Abholung
 * stammen. Von aussen angefragt antwortet Filmo mit 419.
 *
 * Das Skript gibt deshalb ein Versprechen zurueck - `executeJavaScript` wartet
 * darauf. Geht das Ausstellen schief, fehlt genau diese Kachel und der Rest
 * steht trotzdem da.
 *
 * "Sichtbar" wird an `offsetParent` gemessen und nicht an einer Klasse: wie
 * eine Seite ihre nicht gewaehlte Fassung wegblendet, ist ihre Sache, aber
 * weggeblendet ist weggeblendet.
 */
function hosterlinkScript() {
  return `(async () => {
    const raus = [];
    const gesehen = new Set();
    const nimm = (knoten, adresse, zusatz) => {
      if (!adresse || gesehen.has(adresse)) return;
      gesehen.add(adresse);
      const kachel = knoten.closest("li, .generateInlinePlayer, .hosterSiteVideo li, .link-box, .provider-chip") || knoten;
      const name = kachel.querySelector("h4, .hoster, .provider-chip__name, [class*='oster']");
      const beschriftung = String(
        (zusatz && zusatz.hoster)
        || (name && name.textContent)
        || kachel.getAttribute("data-provider-name")
        || kachel.getAttribute("title")
        || ""
      ).trim();
      // Der Hostername steht als Ueberschrift in der Kachel. Fehlt er, taugt
      // die Adresse selbst als Auskunft - aber nur die des Anbieters, denn
      // "/redirect/123" nennt keinen Hoster. Dann bleibt es leer, und die
      // Reihenfolge entscheidet.
      raus.push({
        adresse,
        hoster: beschriftung.slice(0, 40),
        sprache: String(
          (zusatz && zusatz.sprache)
          || kachel.getAttribute("data-lang-key")
          || kachel.getAttribute("data-language-label")
          || ""
        ),
        sichtbar: Boolean(kachel.offsetParent) || kachel.getClientRects().length > 0
      });
    };

    // AniWorld und das alte S.to.
    document.querySelectorAll("a[href*='/redirect/'], a.watchEpisode").forEach((knoten) => {
      nimm(knoten, knoten.href || "");
    });
    document.querySelectorAll("[data-link-target]").forEach((knoten) => {
      const ziel = knoten.getAttribute("data-link-target") || "";
      if (!ziel) return;
      try { nimm(knoten, new URL(ziel, location.href).href); } catch (_) {}
    });

    // Das neue S.to.
    document.querySelectorAll("[data-play-url]").forEach((knoten) => {
      const ziel = knoten.getAttribute("data-play-url") || "";
      if (!ziel) return;
      try { nimm(knoten, new URL(ziel, location.href).href); } catch (_) {}
    });

    // Filmo: erst eine Marke, dann die Adresse.
    const mint = (() => {
      try { return (window.filmoLibrary && window.filmoLibrary.urls && window.filmoLibrary.urls.openMint) || ""; }
      catch (_) { return ""; }
    })();
    const marke = (document.querySelector('meta[name="csrf-token"]') || {}).content || "";
    if (mint && marke) {
      const chips = Array.from(document.querySelectorAll("[data-provider-chip][data-p]")).slice(0, ${FILMO_HOECHSTENS});
      for (const chip of chips) {
        const nutzlast = chip.getAttribute("data-p") || "";
        if (!nutzlast) continue;
        // Die Fassung steht eine Ebene hoeher, in der Ueberschrift der Reihe -
        // Filmo ordnet nach Fassung und nicht nach Hoster.
        const reihe = chip.closest(".provider-row");
        const spracheKnoten = reihe && reihe.querySelector(".provider-row__lang");
        const nameKnoten = chip.querySelector(".provider-chip__name");
        try {
          const antwort = await fetch(mint, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "accept": "application/json",
              "x-csrf-token": marke,
              "x-requested-with": "XMLHttpRequest"
            },
            body: JSON.stringify({ p: nutzlast }),
            credentials: "same-origin"
          });
          if (!antwort.ok) continue;
          const daten = await antwort.json();
          if (!daten || !daten.x) continue;
          nimm(chip, mint.replace(/\\/+$/, "") + "/" + encodeURIComponent(daten.x), {
            hoster: nameKnoten ? nameKnoten.textContent : "",
            sprache: spracheKnoten ? spracheKnoten.textContent.trim() : ""
          });
        } catch (_) { /* diese Kachel eben nicht - die anderen stehen trotzdem */ }
      }
    }

    return JSON.stringify(raus.slice(0, 40));
  })()`;
}

module.exports = {
  hosterlinkScript,
  linksOrdnen,
  besterLink,
  hosterRang,
  HOSTER_REIHE
};
