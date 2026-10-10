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

console.log(`${pruefungen.filter(Boolean).length}/${pruefungen.length} bestanden`);
process.exit(pruefungen.every(Boolean) ? 0 : 1);
