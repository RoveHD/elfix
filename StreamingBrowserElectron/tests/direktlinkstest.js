"use strict";
// Welcher Hoster gefragt wird - und warum nicht einfach der erste.
//
// Zwei Haelften, wie beim Modul selbst: das Skript, das die Kaecheln aus der
// Folgenseite liest, und die Regel, die daraus einen Link macht.
//
// Fuer die erste Haelfte steht hier eine nachgebaute Anbieterseite, wie
// AniWorld und S.to sie bauen: je Synchronfassung eine eigene Hosterreihe, und
// nur die der gewaehlten Fassung ist sichtbar. Genau daran haengt der Fall, der
// dem Zuschauer sonst passiert: auf dem Schirm steht Deutsch, geholt wird die
// japanische Fassung, weil sie im Quelltext zuerst kommt.

const vm = require("vm");
const direktlinks = require("../src/direktlinks");

const pruefungen = [];
const pruefe = (name, bedingung, detail = "") => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

/* ------------------------------------------------------- Die nachgebaute Seite */

function element(tag, attrs = {}, kinder = []) {
  const node = {
    tagName: String(tag).toUpperCase(),
    attrs,
    className: attrs.class || "",
    kinder,
    parent: null,
    textContent: attrs.text || "",
    sichtbar: attrs.sichtbar !== false,
    get offsetParent() { return this.sichtbar ? { tagName: "BODY" } : null; },
    getClientRects() { return this.sichtbar ? [{ width: 120, height: 40 }] : []; },
    getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; },
    get href() {
      const wert = this.attrs.href || "";
      return wert ? new URL(wert, "https://anbieter.example/anime/stream/serie/staffel-1/episode-1").href : "";
    },
    closest(auswahl) {
      let lauf = this;
      while (lauf) {
        if (passt(lauf, auswahl)) return lauf;
        lauf = lauf.parent;
      }
      return null;
    },
    querySelector(auswahl) { return unten(this).find((kind) => passt(kind, auswahl)) || null; }
  };
  for (const kind of kinder) kind.parent = node;
  return node;
}

function unten(node) {
  const alle = [];
  for (const kind of node.kinder || []) alle.push(kind, ...unten(kind));
  return alle;
}

/**
 * Ein kleiner Waehler.
 *
 * Er kann genau so viel, wie das Skript braucht: Tagnamen, Klassen, ein
 * vorhandenes Attribut, `href*=` und `class*=`. Mehr nachzubauen hiesse, einen
 * Browser nachzubauen - und das waere dann keine Pruefung des Skripts mehr.
 */
function passt(node, auswahl) {
  return String(auswahl).split(",").map((teil) => teil.trim()).filter(Boolean).some((teil) => {
    const klassen = String(node.className || "").split(/\s+/).filter(Boolean);
    if (teil === "[data-link-target]") return node.getAttribute("data-link-target") !== null;
    if (teil === "[class*='oster']") return klassen.some((name) => name.includes("oster"));
    const href = /^([a-z]+)\[href\*='([^']+)'\]$/i.exec(teil);
    if (href) {
      return node.tagName === href[1].toUpperCase()
        && String(node.getAttribute("href") || "").includes(href[2]);
    }
    const mitKlasse = /^([a-z]+)\.([\w-]+)$/i.exec(teil);
    if (mitKlasse) return node.tagName === mitKlasse[1].toUpperCase() && klassen.includes(mitKlasse[2]);
    if (teil.startsWith(".")) return klassen.includes(teil.slice(1));
    if (teil.includes(" ")) return passt(node, teil.split(" ").pop());
    return node.tagName === teil.toUpperCase();
  });
}

/** Eine Folgenseite mit zwei Fassungen und drei Hostern je Fassung. */
function seite({ aktiv = "1" } = {}) {
  const kacheln = [];
  for (const key of ["1", "3"]) {
    for (const [nummer, name] of [["1", "Doodstream"], ["2", "VOE"], ["3", "Vidoza"]]) {
      kacheln.push(element("li", {
        "data-lang-key": key,
        "data-link-target": `/redirect/${key}${nummer}`,
        sichtbar: key === aktiv
      }, [
        element("h4", { text: name }),
        element("a", { class: "watchEpisode", href: `/redirect/${key}${nummer}` })
      ]));
    }
  }
  const wurzel = element("body", {}, [element("ul", { class: "hosterSiteVideo" }, kacheln)]);

  const kontext = {
    document: {
      querySelectorAll: (auswahl) => unten(wurzel).filter((node) => passt(node, auswahl))
    },
    location: { href: "https://anbieter.example/anime/stream/serie/staffel-1/episode-1" },
    URL, JSON, String, Boolean, Array, Object, Set
  };
  vm.createContext(kontext);
  return JSON.parse(vm.runInContext(direktlinks.hosterlinkScript(), kontext));
}

/* ------------------------------------------------------------ Das Auslesen */

const gelesen = seite({ aktiv: "1" });
pruefe("Alle Kacheln werden gefunden, auch die verborgenen",
  gelesen.length === 6,
  String(gelesen.length));
pruefe("Jede Kachel bringt ihren Hosternamen mit",
  gelesen.filter((eintrag) => eintrag.hoster === "VOE").length === 2,
  gelesen.map((e) => e.hoster).join(","));
pruefe("Derselbe Link wird nicht zweimal gemeldet",
  new Set(gelesen.map((e) => e.adresse)).size === 6,
  "Kachel und Link zeigen auf dasselbe Ziel");
pruefe("Die Adressen sind vollstaendig, nicht halb",
  gelesen.every((eintrag) => eintrag.adresse.startsWith("https://anbieter.example/redirect/")),
  gelesen[0]?.adresse);
pruefe("Sichtbar ist nur die gewaehlte Fassung",
  gelesen.filter((eintrag) => eintrag.sichtbar).length === 3
  && gelesen.filter((eintrag) => eintrag.sichtbar).every((eintrag) => eintrag.sprache === "1"),
  gelesen.map((e) => `${e.sprache}${e.sichtbar ? "+" : "-"}`).join(" "));

/* --------------------------------------------------------------- Die Regel */

const geordnet = direktlinks.linksOrdnen(gelesen);
pruefe("Genommen wird VOE aus der sichtbaren Fassung",
  geordnet[0].hoster === "VOE" && geordnet[0].sprache === "1",
  `${geordnet[0].hoster}/${geordnet[0].sprache}`);
pruefe("Danach kommt der naechste lesbare Hoster derselben Fassung",
  geordnet[1].hoster === "Vidoza" && geordnet[1].sprache === "1",
  `${geordnet[1].hoster}/${geordnet[1].sprache}`);
pruefe("Doodstream steht hinten - der Weg dorthin fehlt uns noch",
  geordnet[2].hoster === "Doodstream",
  geordnet[2].hoster);
pruefe("Die verborgene Fassung kommt erst danach",
  geordnet.slice(3).every((eintrag) => eintrag.sprache === "3"),
  geordnet.map((e) => e.sprache).join(""));
pruefe("Es bleibt bei allen - die Reihenfolge ordnet, sie wirft nichts weg",
  geordnet.length === gelesen.length,
  `${geordnet.length}/${gelesen.length}`);

const mitWunsch = direktlinks.linksOrdnen(seite({ aktiv: "3" }), "3");
pruefe("Steht die japanische Fassung auf dem Schirm, wird sie auch geholt",
  mitWunsch[0].sprache === "3" && mitWunsch[0].hoster === "VOE",
  `${mitWunsch[0].hoster}/${mitWunsch[0].sprache}`);

pruefe("Ein unbekannter Hoster kommt nach den bekannten, aber er kommt",
  direktlinks.linksOrdnen([
    { adresse: "https://a.example/1", hoster: "Neuhoster", sichtbar: true },
    { adresse: "https://a.example/2", hoster: "VOE", sichtbar: true }
  ]).map((e) => e.hoster).join(",") === "VOE,Neuhoster");
pruefe("Ohne Hosternamen entscheidet die Reihenfolge der Seite",
  direktlinks.linksOrdnen([
    { adresse: "https://a.example/1", sichtbar: true },
    { adresse: "https://a.example/2", sichtbar: true }
  ])[0].adresse === "https://a.example/1");
pruefe("Doppelte Adressen fallen weg",
  direktlinks.linksOrdnen([
    { adresse: "https://a.example/1", hoster: "VOE", sichtbar: true },
    { adresse: "https://a.example/1", hoster: "VOE", sichtbar: true }
  ]).length === 1);
pruefe("Ohne Kacheln gibt es keinen Link",
  direktlinks.besterLink([]) === null && direktlinks.besterLink(null) === null);
pruefe("Ein Eintrag ohne Adresse ist keiner",
  direktlinks.linksOrdnen([{ hoster: "VOE", sichtbar: true }]).length === 0);

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`
${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
