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
    if (teil === "[class*='oster']") return klassen.some((name) => name.includes("oster"));
    // Ein oder zwei Attributbedingungen: "[data-link-target]" und
    // "[data-provider-chip][data-p]" - mehr braucht das Skript nicht.
    const attribute = [...String(teil).matchAll(/\[([\w-]+)\]/g)].map((treffer) => treffer[1]);
    if (attribute.length && attribute.length === (teil.match(/\[/g) || []).length && teil.startsWith("[")) {
      return attribute.every((name) => node.getAttribute(name) !== null);
    }
    const mitAttribut = /^([\w.-]+)\[([\w-]+)\]$/.exec(teil);
    if (mitAttribut) {
      const wieTag = mitAttribut[1].startsWith(".")
        ? klassen.includes(mitAttribut[1].slice(1))
        : node.tagName === mitAttribut[1].toUpperCase();
      return wieTag && node.getAttribute(mitAttribut[2]) !== null;
    }
    const href = /^([a-z]+)\[href\*='([^']+)'\]$/i.exec(teil);
    if (href) {
      return node.tagName === href[1].toUpperCase()
        && String(node.getAttribute("href") || "").includes(href[2]);
    }
    const mitKlasse = /^([a-z]+)\.([\w-]+)$/i.exec(teil);
    if (mitKlasse) return node.tagName === mitKlasse[1].toUpperCase() && klassen.includes(mitKlasse[2]);
    // Der Nachfahren-Auswahl zuerst: ".changeLanguageBox img[data-lang-key]"
    // faengt mit einem Punkt an, ist aber kein Klassenname - vorher schluckte
    // ihn die Zeile darunter und die Sprachleiste blieb ungelesen.
    if (teil.includes(" ")) return passt(node, teil.split(" ").pop());
    if (teil.startsWith(".")) return klassen.includes(teil.slice(1));
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
  // Die Sprachleiste - dieselbe, die AniWorld ueber die Hosterkacheln stellt.
  // Sie steht hier nicht der Vollstaendigkeit halber: das Skript liest sie, und
  // ein Fehler in genau diesem Zweig faellt sonst erst an der echten Seite auf.
  // Beim Einbauen war der regulaere Ausdruck zerbrochen ("//img/..." wurde zum
  // Zeilenkommentar) - das Skript uebersetzte sich sauber und warf beim
  // Ausfuehren "Cannot access 'treffer' before initialization".
  const sprachleiste = element("div", { class: "changeLanguageBox" }, [
    element("img", { "data-lang-key": "1", src: "/public/img/german.svg", title: "Deutsch" }),
    element("img", { "data-lang-key": "3", src: "/public/img/japanese-german.svg", title: "mit Untertitel Deutsch" })
  ]);
  const wurzel = element("body", {}, [
    sprachleiste,
    element("ul", { class: "hosterSiteVideo" }, kacheln)
  ]);

  return lesen(wurzel, "https://anbieter.example/anime/stream/serie/staffel-1/episode-1");
}

/*
 * Das Skript in einem nachgebauten Fenster laufen lassen.
 *
 * Es ist seit Filmo asynchron: dessen Kacheln tragen keine Adresse, sondern nur
 * eine verschluesselte Nutzlast, aus der sich die Seite erst eine Marke
 * ausstellen laesst. Das muss in der Seite passieren - Keks und CSRF-Marke
 * muessen aus derselben Abholung stammen, von aussen antwortet Filmo mit 419.
 *
 * `fenster` reicht herein, was die jeweilige Seite mitbringt: bei AniWorld und
 * S.to nichts, bei Filmo `window.filmoLibrary`, die Marke im <meta> und ein
 * `fetch`, das mitschreibt, was gefragt wurde.
 */
async function lesen(wurzel, adresse, fenster = {}) {
  const kontext = {
    document: {
      querySelectorAll: (auswahl) => unten(wurzel).filter((node) => passt(node, auswahl)),
      querySelector: (auswahl) => unten(wurzel).find((node) => passt(node, auswahl)) || fenster.meta || null
    },
    location: { href: adresse },
    window: fenster.window || {},
    fetch: fenster.fetch || (() => Promise.reject(new Error("kein Netz"))),
    URL, JSON, String, Boolean, Array, Object, Set, Promise, Error, encodeURIComponent
  };
  vm.createContext(kontext);
  return JSON.parse(await vm.runInContext(direktlinks.hosterlinkScript(), kontext));
}

/* ------------------------------------------- Uebersetzt sich das Skript ueberhaupt? */

// Das Kachelskript ist eine Zeichenkette. `node --check src/direktlinks.js`
// sieht darin nichts - ein `continue` in einem forEach, eine fehlende Klammer,
// ein falsch entkommenes Zeichen faellt erst auf, wenn die Seite offen ist und
// nichts passiert. Genau das ist beim Einbauen der Sprachleiste passiert.
try {
  new Function(`return ${direktlinks.hosterlinkScript()}`);
  pruefe("Das Kachelskript uebersetzt sich", true);
} catch (fehler) {
  pruefe("Das Kachelskript uebersetzt sich", false, fehler.message);
}

/* ------------------------------------------------------------ Das Auslesen */

(async () => {

const gelesen = await seite({ aktiv: "1" });
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
pruefe("Aus der Sprachleiste wird das Wort zur Zahl",
  gelesen.every((eintrag) => (eintrag.sprache === "1" ? eintrag.spracheRoh === "german" : true))
  && gelesen.some((eintrag) => eintrag.spracheRoh === "japanese-german"),
  gelesen.map((e) => `${e.sprache}=${e.spracheRoh}`).join(" "));
pruefe("Und dieses Wort ergibt dieselbe Bezeichnung wie ueberall sonst",
  require("../src/fassung").bezeichnung("german") === "Deutsch"
  && require("../src/fassung").bezeichnung("japanese-german") === "Japanisch, Deutsche Untertitel",
  "sonst stuende im Player 'Fassung 1'");
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

const mitWunsch = direktlinks.linksOrdnen(await seite({ aktiv: "3" }), "3");
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

/* ------------------------------------------- Das neue S.to und das neue Filmo */

// Beide Anbieter haben ihr Markup umgebaut, und beide wurden dadurch unsichtbar:
// wer nur nach "/redirect/" und "data-link-target" sucht, findet auf ihren
// Seiten seit dem Umbau nichts und meldet "kein Hoster auf der Seite". Am
// 2026-09-05 an beiden Seiten nachgesehen und hier nachgebaut.

// S.to legt sein Ziel jetzt in `data-play-url` und nennt Hoster und Fassung in
// eigenen Feldern statt in einer Ueberschrift.
const stoSeite = element("body", {}, [
  element("div", {
    class: "link-box",
    "data-link-id": "19318900",
    "data-play-url": "/r?t=eyJpdiI6IkFsNE9M",
    "data-provider-name": "VOE",
    "data-language-label": "Deutsch"
  }),
  element("div", {
    class: "link-box",
    "data-link-id": "16345465",
    "data-play-url": "/r?t=eyJpdiI6InpMMkpV",
    "data-provider-name": "Vidmoly",
    "data-language-label": "Englisch",
    sichtbar: false
  })
]);

  const ausSto = await lesen(stoSeite, "http://186.2.175.5/serie/breaking-bad/staffel-1/episode-1");
  pruefe("S.to: beide Kacheln werden gefunden",
    ausSto.length === 2, String(ausSto.length));
  pruefe("S.to: die Adresse wird vervollstaendigt",
    ausSto[0].adresse === "http://186.2.175.5/r?t=eyJpdiI6IkFsNE9M",
    ausSto[0].adresse);
  pruefe("S.to: Hoster und Fassung stehen in eigenen Feldern",
    ausSto[0].hoster === "VOE" && ausSto[0].sprache === "Deutsch"
    && ausSto[1].hoster === "Vidmoly" && ausSto[1].sprache === "Englisch",
    ausSto.map((e) => `${e.hoster}/${e.sprache}`).join(" "));
  pruefe("S.to: verborgen bleibt verborgen",
    ausSto[0].sichtbar === true && ausSto[1].sichtbar === false);

  /* --------------------------------------------------------------- Filmo */

  // Filmo gibt gar keine Adresse preis. Jede Kachel traegt eine verschluesselte
  // Nutzlast; die Adresse muss man sich damit ausstellen lassen. Das geschieht
  // in der Seite, weil Keks und CSRF-Marke aus derselben Abholung stammen
  // muessen - von aussen antwortet Filmo mit 419.
  const gefragt = [];
  const filmoSeite = element("body", {}, [
    element("div", { class: "provider-row" }, [
      element("span", { class: "provider-row__lang", text: "Deutsch" }),
      element("div", { class: "provider-chip", "data-provider-chip": "", "data-p": "NUTZLAST-A" }, [
        element("span", { class: "provider-chip__name", text: "VOE" })
      ])
    ]),
    element("div", { class: "provider-row" }, [
      element("span", { class: "provider-row__lang", text: "English" }),
      element("div", { class: "provider-chip", "data-provider-chip": "", "data-p": "NUTZLAST-B" }, [
        element("span", { class: "provider-chip__name", text: "Byse" })
      ])
    ])
  ]);
  const filmoFenster = {
    window: { filmoLibrary: { urls: { openMint: "https://filmo.to/n" } } },
    meta: { content: "CSRF-MARKE" },
    fetch: (adresse, aufbau) => {
      gefragt.push({ adresse, ...aufbau });
      const nutzlast = JSON.parse(aufbau.body).p;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ x: `marke-fuer-${nutzlast}` })
      });
    }
  };

  const ausFilmo = await lesen(filmoSeite, "https://filmo.to/movies/matrix-reloaded", filmoFenster);
  pruefe("Filmo: aus jeder Kachel wird eine Adresse",
    ausFilmo.length === 2, String(ausFilmo.length));
  pruefe("Filmo: die Marke wird bei openMint geholt",
    gefragt.length === 2 && gefragt[0].adresse === "https://filmo.to/n" && gefragt[0].method === "POST",
    gefragt.map((g) => g.adresse).join(" "));
  pruefe("Filmo: die CSRF-Marke reist mit",
    gefragt[0].headers["x-csrf-token"] === "CSRF-MARKE",
    "ohne sie antwortet Filmo mit 419");
  pruefe("Filmo: die Kekse der Seite gehen mit",
    gefragt[0].credentials === "same-origin",
    "Marke und Sitzung muessen zusammenpassen");
  pruefe("Filmo: die ausgestellte Marke wird zur Adresse",
    ausFilmo[0].adresse === "https://filmo.to/n/marke-fuer-NUTZLAST-A",
    ausFilmo[0].adresse);
  pruefe("Filmo: der Name kommt aus dem Chip",
    ausFilmo[0].hoster === "VOE" && ausFilmo[1].hoster === "Byse",
    ausFilmo.map((e) => e.hoster).join(" "));
  pruefe("Filmo: die Fassung steht in der Zeile darueber",
    ausFilmo[0].sprache === "Deutsch" && ausFilmo[1].sprache === "English",
    "Filmo ordnet nach Fassung, nicht nach Hoster");

  // Und wenn das Ausstellen scheitert, faellt nur diese eine Kachel weg.
  const halbFenster = {
    ...filmoFenster,
    fetch: (adresse, aufbau) => (JSON.parse(aufbau.body).p === "NUTZLAST-A"
      ? Promise.reject(new Error("nein"))
      : Promise.resolve({ ok: true, json: () => Promise.resolve({ x: "marke-B" }) }))
  };
  const halb = await lesen(filmoSeite, "https://filmo.to/movies/matrix-reloaded", halbFenster);
  pruefe("Filmo: eine abgelehnte Marke reisst die anderen nicht mit",
    halb.length === 1 && halb[0].hoster === "Byse",
    halb.map((e) => e.hoster).join(" "));

  // Ohne die Angaben der Seite wird gar nicht erst gefragt.
  const ohne = await lesen(filmoSeite, "https://filmo.to/movies/matrix-reloaded", {});
  pruefe("Filmo: ohne openMint und Marke wird nichts angefordert",
    ohne.length === 0,
    "lieber keine Kachel als eine Anfrage, die sicher abgelehnt wird");


const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`
${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);

})();
