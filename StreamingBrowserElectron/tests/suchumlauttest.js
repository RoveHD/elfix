"use strict";
// Suche mit Umlauten und hinter Cloudflare.
//
// Gemeldet: "Avatar - Die sieben Häfen" fand nichts, obwohl S.to die Serie als
// /serie/avatar-die-sieben-hafen fuehrt. Die Anfrage wurde zu "haefen", die
// Adresse heisst "hafen" - keine Schreibweise passte zur anderen. Dazu lief
// die Suche ohne die Cookies der bestaetigten Cloudflare-Abfrage und bekam
// dann die Abfrageseite statt der Treffer.

const fs = require("fs");
const vm = require("vm");
const path = require("path");

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

const umgebung = { String, RegExp, Array, Set, URL, Number, decodeURIComponent };
vm.createContext(umgebung);
for (const name of ["matchesQuery", "umlautFalten", "searchablePathText", "normalizeSearchText",
  "stripSearchAccents", "decodeURIComponentSafe", "contentPathLooksPlayable", "queryTokens",
  "searchQueryVariants", "addSimilarTitleVariants", "addKnownTitleVariants", "singularSearchToken",
  "isKnownContentPath", "istCloudflareAbfrage"]) {
  vm.runInContext(abschnitt(`function ${name}(`), umgebung);
}
const r = (code) => vm.runInContext(code, umgebung);

const anfrage = "Avatar - Die sieben Häfen";
const adresse = "http://186.2.175.5/serie/avatar-die-sieben-hafen";
umgebung.anfrage = anfrage;
umgebung.adresse = adresse;
pruefe("Umlaut in der Anfrage passt zur Adresse ohne e",
  r("matchesQuery('', adresse, queryTokens(anfrage))"));
pruefe("Umlaut-Titel passt auch ueber den Titel",
  r("matchesQuery('Avatar - Die sieben Häfen', adresse, queryTokens(anfrage))"));
pruefe("Die Adresse ist ein S.to-Titel",
  r("isKnownContentPath('/serie/avatar-die-sieben-hafen', '186.2.175.5', { name: 'S.to' })"));
const varianten = r("searchQueryVariants(anfrage)");
pruefe("Die Suche fragt auch ohne e nach", varianten.some((v) => /häfen|hafen/.test(v) && !/haefen/.test(v) && /hafen/.test(v)),
  JSON.stringify(varianten.slice(0, 6)));
pruefe("Die Schreibweise mit e bleibt erhalten", varianten.some((v) => /haefen/.test(v)));
pruefe("Ein fremder Titel passt weiterhin nicht",
  !r("matchesQuery('Avatar', 'http://186.2.175.5/serie/avatar-der-herr-der-elemente', queryTokens(anfrage))"));
pruefe("Faltung gilt fuer beide Seiten: Schuessel/Schüssel",
  r("matchesQuery('', 'http://186.2.175.5/serie/die-schussel', queryTokens('Die Schüssel'))"));

const antwort = (status, kopf = {}) => ({ status, headers: { get: (n) => kopf[n.toLowerCase()] || "" } });
umgebung.antwort = antwort;
pruefe("Cloudflare-Abfrage wird erkannt (403 + Abfrageseite)",
  r("istCloudflareAbfrage(antwort(403), '<title>Just a moment...</title><script src=\"/cdn-cgi/challenge-platform/x\"></script>')"));
pruefe("cf-mitigated: challenge reicht",
  r("istCloudflareAbfrage(antwort(200, { 'cf-mitigated': 'challenge' }), '')"));
pruefe("Normale Trefferseite ist keine Abfrage",
  !r("istCloudflareAbfrage(antwort(200), '<a href=\"/serie/x\">X</a>')"));
pruefe("Ein schlichtes 404 ist keine Abfrage",
  !r("istCloudflareAbfrage(antwort(404), 'not found')"));

const quellAbruf = abschnitt("function anbieterAbruf(");
pruefe("Die Suche nutzt die Sitzung der Anbieteransichten mit Cookies",
  /browserSession/.test(quellAbruf) && /credentials: "include"/.test(quellAbruf) && /getUserAgent\(\)/.test(quellAbruf));
const varianteQuelle = abschnitt("async function searchProviderVariant(");
pruefe("HTML-Suche geht ueber anbieterAbruf, nicht Nodes fetch",
  /anbieterAbruf\(searchUrl/.test(varianteQuelle) && !/await fetch\(/.test(varianteQuelle));

// --- Der Titel aus dem Treffer, nicht aus der Adresse ----------------------
//
// S.to setzt je Treffer erst einen Verweis um das Bild und dann einen um den
// Namen. Der erste brachte "Avatar Die Sieben Hafen" aus der Adresse.
const fortschritt = require("../src/fortschritt");
Object.assign(umgebung, {
  Map, Object, JSON, decodeURIComponent,
  absoluteHttpUrl: fortschritt.absoluteHttpUrl,
  isAllowedResultHost: fortschritt.isAllowedResultHost,
  titleFromPath: fortschritt.titleFromPath,
  trefferbild: { bilderZuAdressen: () => new Map(), ausMarkup: () => "" },
  isFilmoProvider: () => false
});
vm.runInContext(quelle.match(/const INLINE_TAGS = [^;]+;/)[0].replace("const ", "var "), umgebung);
for (const name of ["extractSearchLinks", "bildTitel", "normalizeSearchResultTitle", "usableResultTitle",
  "isNoiseTitle", "isNoiseUrl", "isProviderResultUrl", "readHtmlAttribute", "cleanAnchorText",
  "decodeHtmlEntities", "appendRawContentLinks", "kernwoerter", "escapeRegExp", "titleCaseGenre"]) {
  vm.runInContext(abschnitt(`function ${name}(`), umgebung);
}
const STO = `<div class="treffer">
  <a href="/serie/avatar-die-sieben-hafen"><img src="/bild.jpg" alt=""></a>
  <a href="/serie/avatar-die-sieben-hafen"><h3>Avatar - Die sieben Häfen</h3></a>
  <a href="/serie/avatar-der-herr-der-elemente"><img src="/b2.jpg"></a>
  <a href="/serie/avatar-der-herr-der-elemente"><h3>Avatar - Der Herr der Elemente</h3></a>
</div>`;
umgebung.STO = STO;
const sto = r("extractSearchLinks(STO, 'http://186.2.175.5/suche?term=Avatar', 'Avatar', { name: 'S.to' })");
pruefe("Der echte Name ersetzt den Namen aus der Adresse",
  sto.length === 2 && sto[0].title === "Avatar - Die sieben Häfen" && sto[1].title === "Avatar - Der Herr der Elemente",
  JSON.stringify(sto.map((t) => t.title)));
const gefiltert = r("extractSearchLinks(STO, 'http://186.2.175.5/suche?term=Avatar', anfrage, { name: 'S.to' })");
pruefe("Kernwortsuche: die Antwort auf 'Avatar' wird nach dem vollen Titel gefiltert",
  gefiltert.length === 1 && gefiltert[0].title === "Avatar - Die sieben Häfen", JSON.stringify(gefiltert.map((t) => t.title)));
const nurBild = r("extractSearchLinks('<a href=\"/serie/x-y\"><img alt=\"X & Y\"></a>', 'http://186.2.175.5/suche?term=x', 'x y', { name: 'S.to' })");
pruefe("Ein Verweis nur mit Bild nimmt den Namen aus alt", nurBild[0]?.title === "X & Y", JSON.stringify(nurBild));
pruefe("Kernwoerter: erstes und laengstes tragendes Wort",
  JSON.stringify(r("kernwoerter(anfrage)")) === JSON.stringify(["Avatar", "sieben"]),
  JSON.stringify(r("kernwoerter(anfrage)")));
pruefe("Ein einzelnes Wort braucht keine Kernwortsuche", r("kernwoerter('Avatar')").length === 0);
const sucheQuelle = abschnitt("async function searchProvider(");
pruefe("Die Kernwortsuche kommt vor den uebrigen Schreibweisen (Zeitlimit)",
  sucheQuelle.indexOf("kernwoerter(query)") < sucheQuelle.indexOf("variants.slice(3)")
  && sucheQuelle.indexOf("kernwoerter(query)") < sucheQuelle.indexOf("fremdtitelListe("));

console.log(`${pruefungen.filter(Boolean).length}/${pruefungen.length} bestanden`);
process.exit(pruefungen.every(Boolean) ? 0 : 1);
