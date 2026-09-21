"use strict";

// Die Suche nach einem Titel in einer anderen Sprache.
//
// Der gemeldete Fall: "Frozen" eingeben und nichts bekommen. Die Anbieter
// fuehren deutsche Titel, dort heisst der Film "Die Eiskoenigin - Voellig
// unverfroren", und keine Schreibweise des englischen Titels trifft ihn.
//
// Geprueft wird deshalb dreierlei, und zwar an den echten Funktionen aus
// main.js: dass aus dem Suchbegriff der Titel des Anbieters wird, dass die
// Suche ihn erst holt, wenn sie ihn braucht, und dass ein zweifelhafter oder
// unbrauchbarer Name gar nicht erst als Suchbegriff endet. Dazu die Zeile, die
// der Oberflaeche sagt, unter welchem Namen der Titel hier laeuft.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const metadatenModul = require("../src/metadaten");

const WURZEL = path.join(__dirname, "..");
const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").replace(/\r\n/g, "\n");
const RENDERER = fs.readFileSync(path.join(WURZEL, "src/renderer/renderer.js"), "utf8").replace(/\r\n/g, "\n");

const pruefungen = [];
const pruefe = (name, bedingung, detail) => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

function quelle(text, name) {
  const treffer = text.match(new RegExp(`(?:async )?function ${name}\\([^]*?^}`, "m"));
  assert.ok(treffer, `${name} fehlt`);
  return treffer[0];
}

function konstante(name) {
  const treffer = MAIN.match(new RegExp(`^const ${name} = [^;]+;`, "m"));
  assert.ok(treffer, `${name} fehlt`);
  return treffer[0];
}

// Die Suchfunktionen im Stueck - derselbe Ausschnitt, den auch der
// Suchintegrationstest laedt.
const von = MAIN.indexOf("async function searchAllProviders(");
const bis = MAIN.indexOf("// --- Das Bild eines Treffers", von);
assert.ok(von >= 0 && bis > von, "Suchfunktionen in main.js nicht gefunden");
const SUCHE = MAIN.slice(von, bis);

const EISKOENIGIN = "Die Eiskönigin – Völlig unverfroren";
const FILM_FORM = {
  titel: EISKOENIGIN,
  originalTitel: "Frozen",
  altTitel: ["Frozen"],
  konfidenz: "HIGH"
};
const LEER = { titel: "", originalTitel: "", altTitel: [], konfidenz: "UNMATCHED" };

const ANBIETER = { id: "filmo", name: "Filmo", startUrl: "https://filmo.example/search" };
const ZWEITER = { id: "sto", name: "S.to", startUrl: "https://sto.example/search" };
const trifftEiskoenigin = (query) => /eiskoenigin|eiskönigin/i.test(String(query));

// --- Die Buehne --------------------------------------------------------------
//
// Alles echt ausser zweierlei: der Metadaten-Client antwortet mit den Formen,
// die das Relay liefern wuerde, und der Abruf beim Anbieter merkt sich nur,
// wonach gesucht wurde.

function buehne(zustand = {}) {
  const protokoll = { nachgeschlagen: 0, gesucht: [] };
  const kontext = vm.createContext({
    Array, Boolean, Map, Number, Object, Promise, Set, String, RegExp,
    setTimeout, clearTimeout, encodeURIComponent,
    metadatenModul,
    protokoll,
    trifft: zustand.trifft || (() => false),
    metadatenClient: () => {
      if (zustand.ohneRelay) return { bereit: () => false, gesperrt: () => false };
      return {
        bereit: () => true,
        gesperrt: () => Boolean(zustand.gesperrt),
        nachschlagen: async (wuensche) => {
          protokoll.nachgeschlagen += 1;
          if (zustand.haengt) return new Promise(() => {});
          const nach = new Map();
          for (const wunsch of wuensche) {
            const form = (zustand.formen || {})[wunsch.art];
            if (form) nach.set(wunsch.schluessel, form);
          }
          return nach;
        }
      };
    },
    providerModel: { buildSearchUrl: (provider, query) => `${provider.startUrl}?q=${encodeURIComponent(query)}` },
    enabledProviders: () => [],
    providerSearchFailure: (provider, searchUrl, fehler) => ({
      providerId: provider.id, providerName: provider.name, searchUrl, error: fehler, results: []
    })
  });

  for (const name of ["normalizeSearchText", "stripSearchAccents", "fremdtitelTauglich",
    "fremdtitelSuchen", "mitKurzformen", "searchQueryVariants", "addKnownTitleVariants",
    "addSimilarTitleVariants", "singularSearchToken"]) {
    vm.runInContext(quelle(MAIN, name), kontext);
  }
  for (const name of ["FREMDTITEL_ARTEN", "FREMDTITEL_HOECHSTENS"]) {
    vm.runInContext(konstante(name), kontext);
  }
  vm.runInContext(SUCHE, kontext);
  vm.runInContext(`searchProviderVariant = async (provider, query) => {
    protokoll.gesucht.push(query);
    return {
      providerId: provider.id,
      providerName: provider.name,
      searchUrl: "",
      results: trifft(query) ? [{ title: "Treffer", url: provider.startUrl + "/titel", image: "" }] : []
    };
  };`, kontext);
  return { kontext, protokoll };
}

const lauf = (kontext, ausdruck, zusatz = {}) => {
  Object.assign(kontext, zusatz);
  return vm.runInContext(ausdruck, kontext);
};

(async () => {
  // --- Aus dem Suchbegriff wird der Titel des Anbieters ----------------------

  {
    const { kontext } = buehne({ formen: { film: FILM_FORM, serie: LEER, anime: LEER } });
    const namen = await lauf(kontext, `fremdtitelSuchen("Frozen")`);
    pruefe("Der englische Filmtitel wird zum deutschen",
      namen[0] === EISKOENIGIN, namen.join(" | "));
    pruefe("Und der eingegebene Begriff steht nicht noch einmal in der Liste",
      !namen.some((name) => name.toLowerCase() === "frozen"),
      "danach wurde schon gesucht");
    pruefe("Gleich dahinter die Kurzform ohne den Zusatz",
      namen[1] === "Die Eiskönigin", namen.join(" | "));
  }

  {
    // Anime kommt von AniList: dort ist `titel` englisch, `originalTitel`
    // japanisch, und in `altTitel` stehen Romaji und Synonyme.
    const { kontext } = buehne({
      formen: {
        film: LEER, serie: LEER,
        anime: {
          titel: "Demon Slayer", originalTitel: "鬼滅の刃",
          altTitel: ["Kimetsu no Yaiba", "鬼滅の刃"], konfidenz: "EXACT"
        }
      }
    });
    const namen = await lauf(kontext, `fremdtitelSuchen("Demon Slayer")`);
    pruefe("Beim Anime kommen die Romaji als Suchbegriff heraus",
      namen.includes("Kimetsu no Yaiba"), namen.join(" | "));
    pruefe("Der japanische Originaltitel dagegen nicht",
      namen.every((name) => !/[\u3000-\u9fff]/.test(name)),
      "kein deutscher Anbieter fuehrt ihn - das waere ein Fehlschlag mit Zeitverlust");
  }

  {
    const { kontext } = buehne({
      formen: { film: { ...FILM_FORM, konfidenz: "LOW" }, serie: LEER, anime: LEER }
    });
    const namen = await lauf(kontext, `fremdtitelSuchen("Frozen")`);
    pruefe("Ein unsicherer Fund wird nicht zum Suchbegriff", namen.length === 0,
      "ein falscher Titel ist schlimmer als keiner");
  }

  {
    const { kontext, protokoll } = buehne({ ohneRelay: true, formen: { film: FILM_FORM } });
    const namen = await lauf(kontext, `fremdtitelSuchen("Frozen")`);
    pruefe("Ohne Relay bleibt es still", namen.length === 0 && protokoll.nachgeschlagen === 0);
  }

  {
    const { kontext, protokoll } = buehne({ gesperrt: true, formen: { film: FILM_FORM } });
    const namen = await lauf(kontext, `fremdtitelSuchen("Frozen")`);
    pruefe("Und waehrend einer Sperre nach Ausfaellen ebenfalls",
      namen.length === 0 && protokoll.nachgeschlagen === 0);
  }

  // --- Die Suche selbst -----------------------------------------------------

  {
    const { kontext, protokoll } = buehne({
      formen: { film: FILM_FORM, serie: LEER, anime: LEER },
      trifft: trifftEiskoenigin
    });
    const ergebnis = await lauf(kontext,
      `searchProvider(anbieter, "Frozen", null, fremdtitelLauf("Frozen"))`, { anbieter: ANBIETER });
    pruefe("Die Suche nach dem englischen Titel findet den deutschen Eintrag",
      ergebnis.results.length === 1, JSON.stringify(ergebnis.results));
    pruefe("Und der Treffer sagt, unter welchem Namen er gefunden wurde",
      ergebnis.fremdtitel === EISKOENIGIN, String(ergebnis.fremdtitel));
    pruefe("Zuerst wurde trotzdem der eingegebene Begriff versucht",
      protokoll.gesucht[0] === "Frozen", protokoll.gesucht.slice(0, 3).join(" | "));
    pruefe("Keine Schreibweise wird zweimal abgefragt",
      new Set(protokoll.gesucht).size === protokoll.gesucht.length,
      protokoll.gesucht.join(" | "));
  }

  {
    const { kontext, protokoll } = buehne({
      formen: { film: FILM_FORM, serie: LEER, anime: LEER },
      trifft: () => true
    });
    const ergebnis = await lauf(kontext,
      `searchProvider(anbieter, "Tatort", null, fremdtitelLauf("Tatort"))`, { anbieter: ANBIETER });
    pruefe("Wer gleich etwas findet, fragt gar nicht erst nach einer Uebersetzung",
      ergebnis.results.length === 1 && protokoll.nachgeschlagen === 0 && !ergebnis.fremdtitel,
      `nachgeschlagen: ${protokoll.nachgeschlagen}`);
  }

  {
    const { kontext, protokoll } = buehne({
      formen: { film: FILM_FORM, serie: LEER, anime: LEER },
      trifft: trifftEiskoenigin
    });
    const alle = await lauf(kontext, `searchAllProviders("Frozen", null, [anbieter, zweiter])`,
      { anbieter: ANBIETER, zweiter: ZWEITER });
    // Zwei Aufrufe, einer je Stapel (Werke und Anime) - aber nicht je Anbieter.
    pruefe("Zwei Anbieter teilen sich eine einzige Uebersetzung",
      protokoll.nachgeschlagen === 2, `nachgeschlagen: ${protokoll.nachgeschlagen}`);
    pruefe("Und beide finden darueber ihren Treffer",
      alle.length === 2 && alle.every((eintrag) => eintrag.results.length === 1
        && eintrag.fremdtitel === EISKOENIGIN));
  }

  {
    // Die Frist: haengt das Nachschlagen, wartet die Suche nicht darauf.
    // Geprueft ueber den Abbruch - er loest dieselbe Stelle aus, ohne dass die
    // Pruefung fuenf Sekunden stillsteht.
    const { kontext } = buehne({ haengt: true });
    const steuerung = new AbortController();
    const warten = lauf(kontext, `fremdtitelLauf("Frozen").hole(signal)`, { signal: steuerung.signal });
    steuerung.abort();
    const namen = await warten;
    pruefe("Ein haengendes Nachschlagen haelt die Suche nicht fest",
      Array.isArray(namen) && namen.length === 0, JSON.stringify(namen));
  }

  // --- Die Zeile in der Oberflaeche ------------------------------------------

  {
    const kontext = vm.createContext({ Array, String });
    vm.runInContext(quelle(RENDERER, "fremdtitelHinweis"), kontext);
    const hinweis = vm.runInContext(
      `fremdtitelHinweis([{ fremdtitel: ${JSON.stringify(EISKOENIGIN)} }, {}], "Frozen")`, kontext);
    pruefe("Die Oberflaeche sagt, unter welchem Namen der Titel hier laeuft",
      hinweis.includes("Frozen") && hinweis.includes(EISKOENIGIN), hinweis);
    pruefe("Ohne fremden Titel bleibt die Zeile, wie sie war",
      vm.runInContext(`fremdtitelHinweis([{ results: [] }], "Tatort")`, kontext) === "");
  }

  console.log(`${pruefungen.filter(Boolean).length}/${pruefungen.length} bestanden`);
  process.exit(pruefungen.every(Boolean) ? 0 : 1);
})().catch((fehler) => { console.error(fehler); process.exit(1); });
