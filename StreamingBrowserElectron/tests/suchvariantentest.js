"use strict";
// Die ganze Suche, wie sie laeuft - gegen nachgebaute Anbieter.
//
// Gemeldet: "Avatar" fand "Avatar - Die sieben Häfen", der volle Titel nie -
// auch nicht ueber den Vorschlag. Ursache war das gemeinsame Zeitlimit: die
// Anbieter ohne Treffer probierten ihre Schreibweisen durch, das Limit lief
// ab, und der fertige S.to-Treffer ging mit unter.
//
// Hier laufen die echten Suchfunktionen aus main.js gegen einen lokalen
// Server mit fuenf Anbietern:
//   S.to     findet nur Ein-Wort-Anfragen und verlinkt jeden Treffer zweimal
//            (erst das Bild ohne Text, dann den Namen) - wie die echte Seite.
//   Langsam  antwortet erst nach 1,5 s und findet nie etwas.
//   Leer     antwortet sofort, ohne Treffer.
//   Kaputt   antwortet mit HTTP 500.
//   Wolke    antwortet mit der Cloudflare-Abfrage.
// Jede Schreibweise des Titels muss den S.to-Treffer mit echtem Namen bringen.

const fs = require("fs");
const http = require("http");
const path = require("path");
const vm = require("vm");
const providerModel = require("../shared/provider-model");
const fortschritt = require("../src/fortschritt");

const quelle = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8").split("\r\n").join("\n");
const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(Boolean(b)); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };

function abschnitt(anfang) {
  const zeilen = quelle.split("\n");
  const von = zeilen.findIndex((z) => z.startsWith(anfang));
  if (von < 0) throw new Error("nicht gefunden: " + anfang);
  let bis = von;
  while (bis < zeilen.length && zeilen[bis] !== "}") bis += 1;
  return zeilen.slice(von, bis + 1).join("\n");
}

const KATALOG = [
  ["Avatar - Die sieben Häfen", "avatar-die-sieben-hafen"],
  ["Avatar - Der Herr der Elemente", "avatar-der-herr-der-elemente"],
  ["Die Legende von Korra", "die-legende-von-korra"]
];
const ZIEL = "/serie/avatar-die-sieben-hafen";
const LANGSAM_MS = 1500;
const BUDGET_MS = 3500;

function stoAntwort(term) {
  const woerter = String(term || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  // Wie beobachtet: S.to findet "Avatar", nicht aber den langen Titel.
  const treffer = woerter.length === 1
    ? KATALOG.filter(([titel]) => titel.toLowerCase().split(/[^\p{L}\p{N}]+/u).includes(woerter[0]))
    : [];
  const karten = treffer.map(([titel, slug]) => `<div class="card">
    <a href="/serie/${slug}"><img src="/img/${slug}.jpg" alt=""></a>
    <a href="/serie/${slug}"><h3>${titel.replace(/&/g, "&amp;")}</h3></a>
  </div>`).join("\n");
  return `<!doctype html><html><body>
    <a href="/">Startseite</a><a href="/serien">Serien</a><a href="/login">Anmelden</a>
    <form action="/suche"><input name="term" value="${term}"></form>
    ${karten}
  </body></html>`;
}

function server() {
  const zaehler = {};
  const app = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const anbieter = url.pathname.split("/")[1];
    zaehler[anbieter] = (zaehler[anbieter] || 0) + 1;
    const term = url.searchParams.get("term") || url.searchParams.get("q") || "";
    const html = (body, status = 200) => { res.writeHead(status, { "content-type": "text/html; charset=utf-8" }); res.end(body); };
    if (anbieter === "sto") return setTimeout(() => html(stoAntwort(term)), 120);
    if (anbieter === "langsam") {
      const t = setTimeout(() => html("<html><body>nichts</body></html>"), LANGSAM_MS);
      req.on("close", () => clearTimeout(t));
      return;
    }
    if (anbieter === "leer") return html("<html><body>Keine Ergebnisse</body></html>");
    if (anbieter === "kaputt") return html("Fehler", 500);
    if (anbieter === "wolke") {
      res.writeHead(403, { "content-type": "text/html" });
      return res.end("<title>Just a moment...</title><script src=\"/cdn-cgi/challenge-platform/h/b/orchestrate\"></script>");
    }
    html("nicht da", 404);
  });
  return new Promise((ok) => app.listen(0, "127.0.0.1", () => ok({
    basis: `http://127.0.0.1:${app.address().port}`, zaehler,
    zu: () => new Promise((fertig) => { app.closeAllConnections?.(); app.close(fertig); })
  })));
}

function umgebungBauen() {
  const von = quelle.indexOf("async function searchAllProviders(");
  const bis = quelle.indexOf("// --- Das Bild eines Treffers", von);
  const umgebung = {
    fetch, Headers, AbortSignal, URL, URLSearchParams, Set, Map, Array, String, Object, Promise, Number,
    RegExp, JSON, Math, Date, setTimeout, clearTimeout, decodeURIComponent, console,
    providerModel, enabledProviders: () => [],
    fremdtitelSuchen: async () => [],
    absoluteHttpUrl: fortschritt.absoluteHttpUrl,
    isAllowedResultHost: fortschritt.isAllowedResultHost,
    titleFromPath: fortschritt.titleFromPath,
    trefferbild: { bilderZuAdressen: () => new Map(), ausMarkup: () => "" },
    isFilmoProvider: () => false
  };
  vm.createContext(umgebung);
  vm.runInContext(quelle.match(/const INLINE_TAGS = [^;]+;/)[0].replace("const ", "var "), umgebung);
  vm.runInContext(quelle.slice(von, bis), umgebung);
  for (const name of ["usesAniWorldAjaxSearch", "providerSearchFailure", "extractSearchLinks", "bildTitel",
    "normalizeSearchResultTitle", "titleCaseGenre", "escapeRegExp", "appendRawContentLinks", "searchQueryVariants",
    "stripSearchAccents", "addKnownTitleVariants", "addSimilarTitleVariants", "singularSearchToken", "queryTokens",
    "matchesQuery", "umlautFalten", "decodeURIComponentSafe", "searchablePathText", "normalizeSearchText",
    "contentPathLooksPlayable", "isProviderResultUrl", "isKnownContentPath", "readHtmlAttribute", "usableResultTitle",
    "isNoiseUrl", "cleanAnchorText", "decodeHtmlEntities", "isNoiseTitle"]) {
    vm.runInContext(abschnitt(`function ${name}(`), umgebung);
  }
  return umgebung;
}

(async () => {
  const s = await server();
  try {
    const umgebung = umgebungBauen();
    const anbieter = (id, name, pfad) => ({ id, name, startUrl: `${s.basis}/${pfad}/`, searchUrl: `${s.basis}/${pfad}/suche?term={query}` });
    const alle = [
      anbieter("sto", "S.to", "sto"), anbieter("langsam", "Langsam", "langsam"),
      anbieter("leer", "Leer", "leer"), anbieter("kaputt", "Kaputt", "kaputt"), anbieter("wolke", "Wolke", "wolke")
    ];
    const suche = (frage) => umgebung.searchAllProviders(frage, new AbortController().signal, alle, BUDGET_MS);

    const SCHREIBWEISEN = [
      "Avatar - Die sieben Häfen",
      "Avatar - Die sieben Häfen (2026)",
      "avatar die sieben häfen",
      "Avatar Die sieben Haefen",
      "avatar die sieben hafen",
      "AVATAR – DIE SIEBEN HÄFEN",
      "Avatar: Die sieben Häfen",
      "Avatar - Die sieben HAfen",
      "  Avatar   -  Die  sieben Häfen  ",
      "Die sieben Häfen",
      "sieben häfen",
      "Sieben hafen avatar",
      "Häfen Avatar",
      "Avatar"
    ];
    const antworten = [], laufzeiten = [];
    // Eine Suche fragt weiterhin alle fuenf Anbieter gleichzeitig ab. Nicht
    // vierzehn unabhaengige Suchvorgaenge auf denselben lokalen HTTP-Server
    // stapeln: diese Testlast kann das Anbieterbudget bereits verbrauchen.
    for (let i = 0; i < SCHREIBWEISEN.length; i += 2) {
      antworten.push(...await Promise.all(SCHREIBWEISEN.slice(i, i + 2).map(async frage => {
        const beginn = Date.now();
        const antwort = await suche(frage);
        laufzeiten.push(Date.now() - beginn);
        return antwort;
      })));
    }
    const dauer = Math.max(...laufzeiten);

    SCHREIBWEISEN.forEach((frage, i) => {
      const sto = antworten[i].find((a) => a.providerId === "sto");
      const ziel = sto.results.find((t) => new URL(t.url).pathname === ZIEL);
      pruefe(`"${frage.trim()}" findet den S.to-Treffer mit echtem Namen`,
        ziel && ziel.title === "Avatar - Die sieben Häfen",
        ziel ? `${ziel.title} ueber "${sto.queryVariant}"` : JSON.stringify(sto));
      if (frage.trim() !== "Avatar") {
        pruefe(`"${frage.trim()}" bringt keine fremde Avatar-Serie mit`,
          sto.results.every((t) => new URL(t.url).pathname === ZIEL), JSON.stringify(sto.results.map((t) => t.title)));
      }
    });
    const avatar = antworten[SCHREIBWEISEN.indexOf("Avatar")].find((a) => a.providerId === "sto");
    pruefe("\"Avatar\" allein bringt beide Avatar-Serien", avatar.results.length === 2,
      JSON.stringify(avatar.results.map((t) => t.title)));

    const erste = antworten[0];
    const fehler = (id) => erste.find((a) => a.providerId === id)?.error;
    pruefe("Der langsame Anbieter endet mit Zeitueberschreitung, ohne die anderen mitzunehmen",
      /Zeitüberschreitung/.test(fehler("langsam") || ""), fehler("langsam"));
    pruefe("Cloudflare wird als solches gemeldet", fehler("wolke") === "cloudflare", fehler("wolke"));
    pruefe("Ein Serverfehler bleibt beim Anbieter", fehler("kaputt") === "HTTP 500", fehler("kaputt"));
    pruefe("Der leere Anbieter meldet keinen Fehler", !fehler("leer"), fehler("leer"));
    pruefe("Alle Suchen enden im Zeitbudget je Anbieter", dauer < BUDGET_MS + 1500, `${dauer} ms`);
  } finally {
    await s.zu();
  }
  console.log(`${pruefungen.filter(Boolean).length}/${pruefungen.length} bestanden`);
  process.exit(pruefungen.every(Boolean) ? 0 : 1);
})().catch((fehler) => { console.error(fehler); process.exit(1); });
