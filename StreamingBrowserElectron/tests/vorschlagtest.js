"use strict";

// Vorschlaege beim Tippen.
//
// Zwei Dinge werden hier geprueft, und beide an echtem Code: der Client
// (src/metadaten.js) mit seinem lokalen Cache und seinem Weg zum Relay, und die
// Mischung im Hauptprozess (src/main.js), die vier Quellen zu einer Liste
// macht.
//
// Die Reihenfolge ist der Kern der Sache: was sich sofort oeffnen laesst -
// Watchlist und Anbieter-Schnellsuche, beide mit Adresse - steht vor dem, was
// erst noch gesucht werden muss. Und unter zwei Zeichen wird gar nichts
// gefragt: ein Buchstabe ist kein Suchbegriff, aber er waere ein Abruf.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const metadatenModul = require("../src/metadaten");
const { sanitizePositiveNumber } = require("../src/fortschritt");

const WURZEL = path.join(__dirname, "..");
const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").replace(/\r\n/g, "\n");
const RENDERER = fs.readFileSync(path.join(WURZEL, "src/renderer/renderer.js"), "utf8").replace(/\r\n/g, "\n");

const pruefungen = [];
const pruefe = (name, bedingung, detail) => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

function quelle(name) {
  const treffer = MAIN.match(new RegExp(`(?:async )?function ${name}\\([^]*?^}`, "m"));
  assert.ok(treffer, `${name} fehlt`);
  return treffer[0];
}

function konstante(name) {
  const treffer = MAIN.match(new RegExp(`^const ${name} = [^;]+;`, "m"));
  assert.ok(treffer, `${name} fehlt`);
  return treffer[0];
}

const JETZT = 1_800_000_000_000;
const SPAETER = JETZT + 7 * 24 * 3600 * 1000;

// Der Cache, wie er auf der Platte liegt: Schluessel -> verdichtete Form.
function cacheAblage(eintraege) {
  return {
    version: 2,
    eintraege: Object.fromEntries(eintraege.map(([schluessel, form, bis]) => [
      schluessel, { form, bis: bis || SPAETER }
    ]))
  };
}

const EISKOENIGIN = {
  titel: "Die Eiskönigin – Völlig unverfroren",
  originalTitel: "Frozen",
  altTitel: ["Frozen"],
  art: "film", jahr: 2013, beliebtheit: 120, konfidenz: "HIGH"
};
const HARRY = {
  titel: "Harry Potter und der Stein der Weisen",
  originalTitel: "Harry Potter and the Philosopher's Stone",
  altTitel: [], art: "film", jahr: 2001, beliebtheit: 90, konfidenz: "EXACT"
};
const SPAETER_HARRY = {
  titel: "Ein Abend mit Harry",
  originalTitel: "", altTitel: [], art: "serie", jahr: 2019, beliebtheit: 300, konfidenz: "HIGH"
};
const UNBEKANNT = {
  titel: "", originalTitel: "", altTitel: [], art: "film", jahr: 0, konfidenz: "UNMATCHED"
};
const ABGELAUFEN = {
  titel: "Frozen Planet", originalTitel: "", altTitel: [],
  art: "serie", jahr: 2011, konfidenz: "HIGH"
};

// --- Der Client: lokaler Cache und Relay ------------------------------------

function client(zustand = {}) {
  const rufe = [];
  return {
    rufe,
    client: metadatenModul.erstellen({
      basis: zustand.ohneRelay ? "" : "http://relay.test",
      jetzt: () => JETZT,
      pause: 0,
      laden: () => zustand.ablage || cacheAblage([]),
      speichern() {},
      holen: async (url, aufbau) => {
        rufe.push({ url: String(url), koerper: aufbau?.body ? JSON.parse(aufbau.body) : null });
        if (zustand.status && zustand.status >= 400) {
          return { ok: false, status: zustand.status, headers: { get: () => null }, json: async () => ({}) };
        }
        return {
          ok: true, status: 200, headers: { get: () => null },
          json: async () => zustand.antwort || { vorschlaege: [], quellen: { tmdb: "configured" } }
        };
      }
    })
  };
}

(async () => {
  {
    const { client: c } = client({
      ablage: cacheAblage([
        ["film|die eiskoenigin voellig unverfroren|2013|", EISKOENIGIN],
        ["film|harry potter und der stein der weisen|2001|", HARRY],
        ["serie|ein abend mit harry|2019|", SPAETER_HARRY],
        ["film|nichts|0|", UNBEKANNT],
        ["serie|frozen planet|2011|", ABGELAUFEN, JETZT - 1000]
      ])
    });

    const frozen = c.vorschlaegeAusCache("froz");
    pruefe("Der englische Name findet den deutschen Titel im eigenen Cache",
      frozen[0]?.titel === EISKOENIGIN.titel, JSON.stringify(frozen.map((e) => e.titel)));
    pruefe("Und der Vorschlag traegt Art und Jahr",
      frozen[0]?.art === "film" && frozen[0]?.jahr === 2013, JSON.stringify(frozen[0]));
    pruefe("Ein abgelaufener Eintrag wird nicht vorgeschlagen",
      !frozen.some((eintrag) => eintrag.titel === "Frozen Planet"),
      "er ist alt, nicht falsch - gefragt wird neu");

    const harry = c.vorschlaegeAusCache("harr");
    pruefe("Der Titelanfang wiegt schwerer als die Mitte",
      harry[0]?.titel === HARRY.titel, JSON.stringify(harry.map((e) => e.titel)));
    pruefe("Die Mitte kommt aber mit",
      harry.some((eintrag) => eintrag.titel === SPAETER_HARRY.titel),
      JSON.stringify(harry.map((e) => e.titel)));

    pruefe("Ein Eintrag ohne Zuordnung hat keinen Titel zum Vorschlagen",
      c.vorschlaegeAusCache("nichts").length === 0);
    pruefe("Unter zwei Zeichen wird im Cache nicht gesucht",
      c.vorschlaegeAusCache("f").length === 0);
  }

  {
    const { client: c, rufe } = client({
      antwort: {
        vorschlaege: [
          { titel: "Die Eiskönigin – Völlig unverfroren", jahr: 2013, art: "film", quelle: "tmdb" },
          { titel: "Kimetsu no Yaiba", jahr: 2019, art: "anime", quelle: "anilist" },
          { titel: "", jahr: 0, art: "film", quelle: "tmdb" }
        ],
        quellen: { tmdb: "configured", anilist: "available" }
      }
    });
    const liste = await c.vorschlagen("frozen");
    pruefe("Das Relay wird auf seiner eigenen Route gefragt",
      rufe.length === 1 && rufe[0].url.endsWith("/metadata/vorschlag")
      && rufe[0].koerper?.frage === "frozen", rufe[0]?.url);
    pruefe("Die Antwort kommt nachgebaut zurueck, nicht durchgereicht",
      liste.length === 2 && liste[0].titel === EISKOENIGIN.titel && liste[1].art === "anime",
      JSON.stringify(liste));
    pruefe("Ein Vorschlag ohne Titel faellt heraus",
      liste.every((eintrag) => eintrag.titel), JSON.stringify(liste.map((e) => e.titel)));
    pruefe("Unter zwei Zeichen geht nichts hinaus",
      (await c.vorschlagen("f")).length === 0 && rufe.length === 1, `${rufe.length} Aufrufe`);
  }

  {
    // Ein aelteres Relay kennt die Route nicht. Das darf die Anreicherung nicht
    // in die Ausfallsperre treiben - sonst legte das Tippen sie schlafen.
    const { client: c, rufe } = client({ status: 404 });
    for (const frage of ["fro", "froz", "froze", "frozen"]) await c.vorschlagen(frage);
    pruefe("Eine fehlende Route wird einmal gefragt und dann nicht mehr",
      rufe.length === 1, `${rufe.length} Aufrufe`);
    pruefe("Und sie zaehlt nicht als Ausfall des Relays",
      c.gesperrt() === false, "sonst schwiege auch die Anreicherung fuenf Minuten");
  }

  {
    const { client: c, rufe } = client({ ohneRelay: true });
    pruefe("Ohne Relay-Adresse bleibt die Vorschlagssuche lokal",
      (await c.vorschlagen("frozen")).length === 0 && rufe.length === 0);
  }

  // --- Die Mischung im Hauptprozess -----------------------------------------

  const ANBIETER = [
    { id: "ani", name: "Aniworld", startUrl: "https://aniworld.example/" },
    { id: "filmo", name: "Filmo", startUrl: "https://filmo.example/" }
  ];

  function buehne(zustand = {}) {
    const protokoll = { ajax: [], relay: 0 };
    const kontext = vm.createContext({
      Array, Boolean, Map, Number, Object, Promise, Set, String, RegExp, JSON,
      console: { log() {} },
      sanitizePositiveNumber,
      favorites: zustand.favorites || [],
      enabledProviders: () => ANBIETER,
      usesAniWorldAjaxSearch: (provider) => /aniworld/i.test(provider.name),
      providerModel: {
        buildSearchUrl: (provider, frage) => `${provider.startUrl}search?q=${encodeURIComponent(frage)}`,
        isHttpUrl: (wert) => /^https?:\/\//i.test(String(wert || ""))
      },
      encodeURIComponent,
      searchProviderAjax: async (provider, frage) => {
        protokoll.ajax.push({ provider: provider.id, frage });
        if (zustand.ajaxWirft) throw new Error("Anbieter antwortet nicht");
        return zustand.ajax || [];
      },
      metadatenClient: () => ({
        vorschlaegeAusCache: () => zustand.cache || [],
        vorschlagen: async () => {
          protokoll.relay += 1;
          if (zustand.relayWirft) throw new Error("Relay antwortet nicht");
          return zustand.relay || [];
        }
      })
    });
    for (const name of ["normalizeSearchText", "stripSearchAccents", "vorschlagSchluessel",
      "vorschlagAufnehmen", "vorschlaegeAusWatchlist", "vorschlaegeVonAnbietern",
      "vorschlaegeAusMetadaten", "vorschlaegeVomRelay", "suchvorschlaege"]) {
      vm.runInContext(quelle(name), kontext);
    }
    for (const name of ["VORSCHLAG_MAX", "VORSCHLAG_MIN_LAENGE", "VORSCHLAG_JE_QUELLE"]) {
      vm.runInContext(konstante(name), kontext);
    }
    return { kontext, protokoll };
  }

  {
    const { kontext, protokoll } = buehne({
      favorites: [
        { title: "Frozen Fever", url: "https://filmo.example/film/frozen-fever", providerId: "filmo", providerName: "Filmo", type: "film", favorite: true },
        { title: "Irgendwas", url: "https://filmo.example/film/irgendwas", providerId: "filmo", providerName: "Filmo", favorite: true },
        { title: "Frozen Ground", url: "https://filmo.example/film/abgewaehlt", providerId: "filmo", providerName: "Filmo", favorite: false }
      ],
      ajax: [{ title: "Frozen Layer", url: "https://aniworld.example/anime/stream/frozen-layer", image: "" }],
      cache: [{ titel: "Die Eiskönigin – Völlig unverfroren", jahr: 2013, art: "film" }],
      relay: [{ titel: "Frozen Planet", jahr: 2011, art: "serie", quelle: "tmdb" }]
    });
    const liste = await vm.runInContext(`suchvorschlaege("frozen", null)`, kontext);
    pruefe("Alle vier Quellen kommen vor",
      liste.length === 4, JSON.stringify(liste.map((e) => e.titel)));
    pruefe("Die Watchlist steht vorn - sie ist der wahrscheinlichste Treffer",
      liste[0]?.titel === "Frozen Fever" && liste[0]?.url.includes("frozen-fever"),
      JSON.stringify(liste[0]));
    pruefe("Dann der Anbieter, auch mit Adresse",
      liste[1]?.titel === "Frozen Layer" && liste[1]?.providerName === "Aniworld",
      JSON.stringify(liste[1]));
    pruefe("Erst danach, was erst noch gesucht werden muss",
      !liste[2]?.url && !liste[3]?.url,
      JSON.stringify(liste.slice(2).map((e) => ({ t: e.titel, url: e.url }))));
    pruefe("Ein abgewaehlter Watchlist-Eintrag gehoert nicht dazu",
      !liste.some((eintrag) => eintrag.titel === "Frozen Ground"));
    pruefe("Was nicht zur Eingabe passt, bleibt weg",
      !liste.some((eintrag) => eintrag.titel === "Irgendwas"));
    pruefe("Die Schnellsuche laeuft nur beim Anbieter, der eine hat",
      protokoll.ajax.length === 1 && protokoll.ajax[0].provider === "ani",
      JSON.stringify(protokoll.ajax));
  }

  {
    const doppelt = { titel: "Frozen", jahr: 2013, art: "film" };
    const { kontext } = buehne({
      favorites: [{ title: "Frozen", url: "https://filmo.example/film/frozen", providerId: "filmo", providerName: "Filmo", favorite: true }],
      cache: [doppelt],
      relay: [{ ...doppelt, quelle: "tmdb" }]
    });
    const liste = await vm.runInContext(`suchvorschlaege("frozen", null)`, kontext);
    pruefe("Derselbe Titel steht nur einmal da - und zwar mit seiner Adresse",
      liste.length === 1 && liste[0].url.endsWith("/film/frozen"), JSON.stringify(liste));
  }

  {
    const viele = Array.from({ length: 12 }, (_wert, i) => ({ titel: `Frozen ${i}`, jahr: 2000 + i, art: "film" }));
    const { kontext } = buehne({ cache: viele, relay: viele });
    const liste = await vm.runInContext(`suchvorschlaege("frozen", null)`, kontext);
    pruefe("Die Liste bleibt kurz", liste.length === 8, `${liste.length} Vorschlaege`);
  }

  {
    const { kontext, protokoll } = buehne({ cache: [{ titel: "Frozen", art: "film" }] });
    const liste = await vm.runInContext(`suchvorschlaege("f", null)`, kontext);
    pruefe("Ein einzelner Buchstabe fragt nirgends nach",
      liste.length === 0 && protokoll.ajax.length === 0 && protokoll.relay === 0);
  }

  {
    // Faellt eine Quelle aus, tragen die anderen die Liste.
    const { kontext } = buehne({
      ajaxWirft: true, relayWirft: true,
      cache: [{ titel: "Die Eiskönigin – Völlig unverfroren", jahr: 2013, art: "film" }]
    });
    const liste = await vm.runInContext(`suchvorschlaege("frozen", null)`, kontext);
    pruefe("Eine ausgefallene Quelle nimmt die anderen nicht mit",
      liste.length === 1 && liste[0].titel === EISKOENIGIN.titel, JSON.stringify(liste));
  }

  // --- Die Oberflaeche --------------------------------------------------------
  //
  // Das Kaestchen selbst braucht ein Fenster und steht in der Electron-Pruefung.
  // Zwei Dinge lassen sich aber hier festhalten, weil sie sonst unbemerkt
  // kaputtgehen: dass beide Suchfelder angebunden sind, und dass der Tastengriff
  // in der Abfangphase haengt - ohne das schickt Enter die Suche ab, bevor die
  // gewaehlte Zeile zum Zug kommt.

  pruefe("Beide Suchfelder bekommen Vorschlaege",
    /vorschlagFeldAnbinden\(omnibox\);/.test(RENDERER)
    && /vorschlagFeldAnbinden\(homeQuickSearch\);/.test(RENDERER));
  pruefe("Der Tastengriff haengt in der Abfangphase",
    /addEventListener\("keydown", \(event\) => vorschlagTaste\(event, feld\), true\)/.test(RENDERER),
    "sonst gilt Enter der Suche und nicht der gewaehlten Zeile");
  pruefe("Auf einer Anbieterseite bleibt das Kaestchen zu",
    /function vorschlagMoeglich\(\)[\s\S]{0,200}?startsWith\("provider:"\)/.test(MAIN + RENDERER),
    "eine Systemansicht liegt darueber - HTML waere dahinter unsichtbar");

  console.log(`${pruefungen.filter(Boolean).length}/${pruefungen.length} bestanden`);
  process.exit(pruefungen.every(Boolean) ? 0 : 1);
})().catch((fehler) => { console.error(fehler); process.exit(1); });
