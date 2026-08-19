"use strict";

// Was bringen die externen Metadaten wirklich?
//
// Synthetische Profile beantworten das nicht. Sie haben zwei Verlaufstitel und
// zehn Kandidaten; im Betrieb sind es zwoelf und mehrere tausend, und genau
// dort entstehen die Effekte, um die es geht - dass ein einzelner Titel zum
// Seed fuer alles wird, dass ein Sammelgenre den Pool auffuellt, dass die
// Haelfte der Kinderanimation ueber "Animation, Abenteuer" hereinkommt.
//
// Dieses Werkzeug rechnet deshalb mit den echten Daten aus %APPDATA%\ELFIX:
//
//   favorites.json    der Verlauf
//   taste-cache.json  Detailseiten (Genres, "Das schauen andere") und die
//                     Genre-Listen der Anbieter
//   providers.json    welche Anbieter aktiv sind
//   settings.json     die Adresse des Relays
//
// Geschrieben wird davon nichts. Der Metadaten-Cache dieses Laufs landet in
// einer eigenen Datei (--cache), nicht in der Ablage der App.
//
// Aufruf:
//   node scripts/empfehlungsmessung.js [--seiten 60] [--kandidaten 120]
//                                      [--profile] [--cache <datei>]
//
//   --seiten      wie viele Detailseiten der Anbieter nachgelesen werden, um
//                 IMDB-Kennung und Jahr zu bekommen (0 = keine)
//   --kandidaten  wie viele Kandidaten je Profil extern angereichert werden
//   --profile     zusaetzlich die vier Testprofile gegen denselben Katalog

const fs = require("fs");
const os = require("os");
const path = require("path");

const empfehlung = require("../src/empfehlung");
const metadatenModul = require("../src/metadaten");
const titelModul = require("../src/titel");
const { extractTitleMeta } = require("../src/discover");

// --- Aufruf ------------------------------------------------------------------

function argument(name, ersatz) {
  const index = process.argv.indexOf("--" + name);
  if (index < 0) return ersatz;
  const wert = process.argv[index + 1];
  return wert && !wert.startsWith("--") ? wert : true;
}

const SEITEN = Number(argument("seiten", 60)) || 0;
const KANDIDATEN = Number(argument("kandidaten", 120)) || 120;
const MIT_PROFILEN = Boolean(argument("profile", false));
const DATEN = String(argument("daten", path.join(os.homedir(), "AppData", "Roaming", "ELFIX")));
const CACHE_DATEI = String(argument("cache", path.join(os.tmpdir(), "elfix-metadaten-messung.json")));
const JETZT = Date.now();

function lesen(datei, ersatz) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATEN, datei), "utf8"));
  } catch {
    return ersatz;
  }
}

// --- Nachbau der Kette aus main.js -------------------------------------------
//
// Nur die drei Funktionen, die das Empfehlungssystem wirklich braucht. Sie
// stehen in main.js zwischen Electron-Aufrufen und lassen sich von dort nicht
// laden; hier sind sie zeichengleich nachgezogen.

function candidateMediaType(value) {
  try {
    const pfad = new URL(String(value || "")).pathname.toLowerCase();
    if (/\/anime(?:\/|$)/.test(pfad)) return "anime";
    if (/\/(?:movies?|filme?)(?:\/|-)/.test(pfad)) return "film";
    if (/\/(?:serie|series|show|tv)(?:\/|$)/.test(pfad)) return "serie";
    return "";
  } catch {
    return "";
  }
}

function seriesPageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname
      .replace(/\/(?:episode|folge|film)-\d+\/?$/i, "")
      .replace(/\/(?:staffel|season)-\d+\/?$/i, "")
      .replace(/\/+$/, "");
    return url.href;
  } catch {
    return "";
  }
}

async function inBatches(items, size, worker) {
  const ergebnisse = [];
  for (let index = 0; index < items.length; index += size) {
    const teil = items.slice(index, index + size);
    ergebnisse.push(...await Promise.all(teil.map((item) => worker(item).catch(() => null))));
  }
  return ergebnisse;
}

// --- Daten -------------------------------------------------------------------

const favorites = (() => {
  const roh = lesen("favorites.json", []);
  return Array.isArray(roh) ? roh : (roh.items || roh.favorites || []);
})();
const tasteCache = lesen("taste-cache.json", { pages: {}, lists: {} });
const providers = (() => {
  const roh = lesen("providers.json", []);
  return Array.isArray(roh) ? roh : (roh.providers || []);
})();
const settings = lesen("settings.json", {});
const aktiveAnbieter = new Set(providers.filter((p) => p.enabled !== false).map((p) => p.id));

const verlauf = favorites
  .filter((f) => !aktiveAnbieter.size || aktiveAnbieter.has(f.providerId))
  .filter((f) => f.watched || f.favorite || f.completed || Number(f.position) > 0)
  .sort((a, b) => Date.parse(b.lastWatchedAt || b.openedAt || b.createdAt || 0)
    - Date.parse(a.lastWatchedAt || a.openedAt || a.createdAt || 0))
  // Wie main.js: der ganze aktive Verlauf, nicht die letzten N.
  .slice(0, 500);

const seiten = tasteCache.pages || {};
const listen = tasteCache.lists || {};

function seitenEintrag(url) {
  return seiten[seriesPageUrl(url)] || null;
}

// --- Anbieterseiten nachlesen ------------------------------------------------
//
// Der Geschmacks-Cache dieser Installation stammt aus der Zeit vor den
// Seitenangaben - er kennt Genres, aber keine IMDB-Kennung und kein Jahr. Genau
// die entscheiden aber, ob ein Titel exakt zugeordnet wird. Also werden sie
// hier fuer die wichtigsten Titel einmal nachgelesen, so wie die App es beim
// naechsten Lauf ohnehin tun wird.

const nachgelesen = new Map();
let seitenAbrufe = 0;
let seitenFehler = 0;

async function metaHolen(url) {
  const seite = seriesPageUrl(url);
  if (!seite) return null;
  if (nachgelesen.has(seite)) return nachgelesen.get(seite);
  const bekannt = seiten[seite]?.meta;
  if (bekannt) return bekannt;
  try {
    seitenAbrufe += 1;
    const antwort = await fetch(seite, {
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 ELFIX/0.2" },
      signal: AbortSignal.timeout(9000)
    });
    if (!antwort.ok) {
      seitenFehler += 1;
      nachgelesen.set(seite, null);
      return null;
    }
    const meta = extractTitleMeta(await antwort.text(), seite);
    nachgelesen.set(seite, meta);
    return meta;
  } catch {
    seitenFehler += 1;
    nachgelesen.set(seite, null);
    return null;
  }
}

function metaAus(url) {
  const seite = seriesPageUrl(url);
  return nachgelesen.get(seite) || seiten[seite]?.meta || null;
}

// --- Der Metadaten-Client ----------------------------------------------------

const basis = (() => {
  const roh = String(process.env.ELFIX_METADATEN_SERVER || settings.watchparty?.serverUrl || "").trim();
  if (!roh) return "";
  const mitSchema = /^[a-z]+:\/\//i.test(roh) ? roh : "https://" + roh;
  return mitSchema.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:").replace(/\/+$/, "");
})();

let cacheStand = null;
const client = metadatenModul.erstellen({
  basis,
  laden: () => JSON.parse(fs.readFileSync(CACHE_DATEI, "utf8")),
  speichern: (daten) => {
    cacheStand = daten;
    fs.writeFileSync(CACHE_DATEI, JSON.stringify(daten));
  }
});

function wunschVon(titel, url) {
  const meta = metaAus(url);
  const name = String(titel || "").trim();
  if (!name) return null;
  return {
    art: candidateMediaType(url) || "serie",
    titel: name,
    jahr: meta?.jahr || 0,
    imdb: meta?.imdb || "",
    altTitel: meta?.titelAlt || []
  };
}

function externAus(titel, url) {
  const wunsch = wunschVon(titel, url);
  return wunsch ? client.ausCache(wunsch) : null;
}

// Der Client holt hoechstens 150 Titel je Aufruf - fuer eine Messung wird so
// lange nachgefasst, bis nichts mehr offen ist.
async function anreichern(wuensche) {
  const offen = wuensche.filter(Boolean);
  let runde = 0;
  while (runde < 12) {
    const fehlend = offen.filter((wunsch) => client.fehltImCache(wunsch));
    if (!fehlend.length) break;
    await client.nachschlagen(fehlend);
    runde += 1;
  }
}

// --- Kandidaten und Profil ---------------------------------------------------

function profilBauen(externAn) {
  return empfehlung.profilBauen(verlauf.map((favorite) => ({
    ...favorite,
    baseTitle: favorite.title,
    art: candidateMediaType(favorite.url) || favorite.type || "",
    genres: (seitenEintrag(favorite.url)?.genres || []).map((g) => g.key),
    extern: externAn ? externAus(favorite.title, favorite.url) : null
  })), JETZT);
}

// Der Kandidatenpool: was die Anbieter auf den Seiten des Verlaufs als verwandt
// fuehren, und was in den zwischengespeicherten Genre-Listen steht. Das ist
// dieselbe Quelle, aus der die App schoepft.
function kandidatenBauen() {
  const kandidaten = [];
  const staerkste = Math.max(...verlauf.map((f) => empfehlung.signalStaerke(f)), 1e-9);
  for (const favorite of verlauf) {
    const eintrag = seitenEintrag(favorite.url);
    for (const item of eintrag?.related || []) {
      kandidaten.push({
        ...item,
        via: "related",
        seedTitle: favorite.title,
        seedWeight: empfehlung.signalStaerke(favorite) / staerkste,
        genres: []
      });
    }
  }
  const ausListen = new Map();
  for (const liste of Object.values(listen)) {
    for (const item of liste?.items || []) {
      if (!item?.url || ausListen.has(item.url)) continue;
      const eigene = seitenEintrag(item.url);
      ausListen.set(item.url, {
        ...item,
        via: "genre",
        genres: (eigene?.genres || []).map((g) => g.key)
      });
    }
  }
  kandidaten.push(...ausListen.values());
  return kandidaten.map((item) => ({
    ...item,
    type: candidateMediaType(item.url) === "film" ? "film" : "serie",
    art: candidateMediaType(item.url) || ""
  }));
}

const normal = (wert) => String(wert || "").toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();

const ausschluss = new Set();
for (const favorite of favorites) {
  const art = candidateMediaType(favorite.url) === "film" ? "film" : favorite.type;
  ausschluss.add(titelModul.werkSchluessel(favorite.title, art));
}

function rechnen(kandidaten, profil, externAn, limit = 24) {
  const mit = kandidaten.map((item) => ({
    ...item,
    extern: externAn ? externAus(item.baseTitle || item.title, item.url) : null
  }));
  const beginn = process.hrtime.bigint();
  const liste = empfehlung.empfehlen(mit, profil, {
    jetzt: JETZT, limit, ausschluss, debug: true
  });
  const dauer = Number(process.hrtime.bigint() - beginn) / 1e6;
  return { liste, dauer };
}

// --- Berichtsteile -----------------------------------------------------------

function zeile(index, eintrag) {
  return `${String(index + 1).padStart(2)}. ${eintrag.title.slice(0, 40).padEnd(42)}`
    + `${eintrag.score.toFixed(3).padStart(7)}  ${String(eintrag.grund).padEnd(24)} „${eintrag.grundText}“`;
}

// Wie viel Kinderprogramm steht in der Liste? Nicht an Titeln festgemacht,
// sondern an dem, was die Daten sagen: die Altersfreigabe der Anbieterseite und
// das TMDB-Genre "Kids". Beides steht in den Daten, beides ist nachpruefbar.
function kinderAnteil(liste) {
  const treffer = [];
  for (const eintrag of liste) {
    const meta = metaAus(eintrag.url);
    const extern = externAus(eintrag.title, eintrag.url);
    const kindGenre = (extern?.genres || []).some((g) => /^(kids|kinder|family)$/i.test(g));
    const kindFsk = meta && meta.fsk === 0;
    if (kindGenre || kindFsk) {
      treffer.push(`${eintrag.title}${kindFsk ? " (FSK 0)" : ""}${kindGenre ? " (TMDB Kids)" : ""}`);
    }
  }
  return treffer;
}

function konfidenzVerteilung(wuensche) {
  const zaehler = { EXACT: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNMATCHED: 0, ohne: 0 };
  for (const wunsch of wuensche) {
    if (!wunsch) { zaehler.ohne += 1; continue; }
    const form = client.ausCache(wunsch);
    if (!form) { zaehler.ohne += 1; continue; }
    zaehler[form.konfidenz] = (zaehler[form.konfidenz] || 0) + 1;
  }
  return zaehler;
}

// --- Lauf --------------------------------------------------------------------

(async () => {
  console.log("=".repeat(78));
  console.log("MESSUNG: externe Metadaten in der Empfehlungskette");
  console.log("=".repeat(78));
  console.log(`Daten:   ${DATEN}`);
  console.log(`Relay:   ${basis || "(keine Adresse - es wird nichts geholt)"}`);
  console.log(`Verlauf: ${verlauf.length} Titel   Detailseiten im Cache: ${Object.keys(seiten).length}`
    + `   Genre-Listen: ${Object.keys(listen).length}`);

  const status = await client.status();
  console.log(`Status:  ${JSON.stringify(status)}`);

  const kandidaten = kandidatenBauen();
  console.log(`Kandidatenpool: ${kandidaten.length} Eintraege`);

  // 1. Ohne externe Daten - der Stand vor dieser Aenderung.
  const profilOhne = profilBauen(false);
  // Der Vorlauf reicht weiter als die sichtbare Liste: aus ihm entsteht die
  // Rangfolge der Anreicherung, und die soll mehr als zwei Dutzend Titel
  // umfassen.
  const vorlaufOhne = rechnen(kandidaten, profilOhne, false, Math.max(24, KANDIDATEN));
  const ohne = { liste: vorlaufOhne.liste.slice(0, 24), dauer: vorlaufOhne.dauer };
  console.log("");
  console.log("-".repeat(78));
  console.log("1. VORHER - nur Anbieterdaten");
  console.log("-".repeat(78));
  ohne.liste.slice(0, 15).forEach((e, i) => console.log(zeile(i, e)));
  console.log(`Rechenzeit: ${ohne.dauer.toFixed(0)} ms`);

  // 2. Seitenangaben nachlesen. In der App passiert das nebenbei beim Lesen der
  //    Detailseiten; hier einmal gebuendelt.
  const wichtig = [
    ...verlauf.map((f) => ({ titel: f.title, url: f.url })),
    ...vorlaufOhne.liste.map((e) => ({ titel: e.title, url: e.url }))
  ];
  if (SEITEN > 0) {
    const beginnSeiten = Date.now();
    await inBatches(wichtig.slice(0, SEITEN), 4, (eintrag) => metaHolen(eintrag.url));
    console.log("");
    console.log(`Detailseiten nachgelesen: ${seitenAbrufe} (${seitenFehler} Fehler)`
      + `   ${Date.now() - beginnSeiten} ms`);
    const mitImdb = wichtig.slice(0, SEITEN).filter((e) => metaAus(e.url)?.imdb).length;
    const mitJahr = wichtig.slice(0, SEITEN).filter((e) => metaAus(e.url)?.jahr).length;
    console.log(`  davon mit IMDB-Kennung: ${mitImdb}   mit Jahr: ${mitJahr}`);
  }

  // 3. Anreichern - in derselben Rangfolge wie in der App.
  const wuenscheVerlauf = verlauf.map((f) => wunschVon(f.title, f.url));
  const wuenscheOben = vorlaufOhne.liste.slice(0, KANDIDATEN)
    .map((e) => wunschVon(e.title, e.url));
  const beginnAnreichern = Date.now();
  await anreichern([...wuenscheVerlauf, ...wuenscheOben]);
  const dauerAnreichern = Date.now() - beginnAnreichern;

  const statistik = client.statistik();
  console.log("");
  console.log("-".repeat(78));
  console.log("2. ZUORDNUNG");
  console.log("-".repeat(78));
  console.log(`Dauer der Anreicherung: ${dauerAnreichern} ms fuer ${statistik.titel} Titel`
    + `   (${statistik.anfragen} Anfragen, ${statistik.dauerJeAnfrageMs} ms je Anfrage)`);
  console.log(`AniList-Titel: ${statistik.anilistTitel}   TMDB-Titel: ${statistik.tmdbTitel}`);
  console.log(`Lokale Cache-Treffer: ${statistik.cacheTreffer} von`
    + ` ${statistik.cacheTreffer + statistik.cacheFehlgriffe}`
    + `   (Quote ${(100 * statistik.cacheQuote).toFixed(0)}%)`);
  console.log(`Konfidenz: EXACT ${statistik.EXACT}   HIGH ${statistik.HIGH}`
    + `   MEDIUM ${statistik.MEDIUM}   LOW ${statistik.LOW}   UNMATCHED ${statistik.UNMATCHED}`);
  console.log(`Vom Client herabgestuft: ${statistik.herabgestuft}`
    + `   ueber die Kurzform gerettet: ${statistik.kurzformTreffer}`);
  console.log(`Fehler: ${statistik.fehler}   gebremst: ${statistik.gebremst}`
    + `   Zeitgrenzen: ${statistik.timeouts}`);
  console.log(`Verlauf allein: ${JSON.stringify(konfidenzVerteilung(wuenscheVerlauf))}`);

  // Was nicht zugeordnet werden konnte - und das moeglichst konkret. Eine
  // Quote sagt nur, dass etwas fehlt; die Liste sagt, warum.
  const nichtZugeordnet = [...wuenscheVerlauf, ...wuenscheOben].filter(Boolean)
    .filter((wunsch) => {
      const form = client.ausCache(wunsch);
      return form && form.konfidenz === "UNMATCHED";
    });
  const einmalig = [...new Map(nichtZugeordnet.map((w) => [w.schluessel || w.titel, w])).values()];
  console.log(`Nicht zugeordnet (${einmalig.length}):`);
  for (const wunsch of einmalig.slice(0, 30)) {
    console.log(`  ${wunsch.art.padEnd(6)} ${String(wunsch.jahr || "----")}`
      + ` ${wunsch.imdb ? "imdb " : "     "} ${wunsch.titel}`);
  }

  const serverStatus = await client.status();
  if (serverStatus?.statistik) {
    console.log(`Server-Cache: ${serverStatus.statistik.cacheTreffer} Treffer,`
      + ` ${serverStatus.statistik.cacheFehlgriffe} Fehlgriffe,`
      + ` Quote ${(100 * (serverStatus.statistik.trefferquote || 0)).toFixed(0)}%,`
      + ` Groesse ${serverStatus.statistik.cacheGroesse}`);
  }

  // 4. Mit externen Daten.
  const profilMit = profilBauen(true);
  const mit = rechnen(kandidaten, profilMit, true);
  console.log("");
  console.log("-".repeat(78));
  console.log("3. NACHHER - mit externen Metadaten");
  console.log("-".repeat(78));
  mit.liste.slice(0, 15).forEach((e, i) => console.log(zeile(i, e)));
  console.log(`Rechenzeit: ${mit.dauer.toFixed(0)} ms`
    + `   (vorher ${ohne.dauer.toFixed(0)} ms)`);

  console.log("");
  const kinderVorher = kinderAnteil(ohne.liste.slice(0, 20));
  const kinderNachher = kinderAnteil(mit.liste.slice(0, 20));
  console.log(`Kinderinhalte in den ersten 20: vorher ${kinderVorher.length}, nachher ${kinderNachher.length}`);
  if (kinderVorher.length) console.log(`  vorher:  ${kinderVorher.join(" | ")}`);
  if (kinderNachher.length) console.log(`  nachher: ${kinderNachher.join(" | ")}`);

  const gruendeVorher = new Map();
  const gruendeNachher = new Map();
  for (const e of ohne.liste) gruendeVorher.set(e.grund, (gruendeVorher.get(e.grund) || 0) + 1);
  for (const e of mit.liste) gruendeNachher.set(e.grund, (gruendeNachher.get(e.grund) || 0) + 1);
  console.log("");
  console.log(`Gruende vorher:  ${[...gruendeVorher].map(([g, n]) => `${g} ${n}`).join("   ")}`);
  console.log(`Gruende nachher: ${[...gruendeNachher].map(([g, n]) => `${g} ${n}`).join("   ")}`);

  // 5. Startzeit: der Weg, den die App wirklich nimmt - nur der lokale Cache,
  //    kein einziger Netzabruf.
  console.log("");
  console.log("-".repeat(78));
  console.log("4. STARTZEIT (nur lokaler Cache, kein Netz)");
  console.log("-".repeat(78));
  const warm = [];
  for (let i = 0; i < 5; i += 1) warm.push(rechnen(kandidaten, profilMit, true).dauer);
  const kalt = [];
  for (let i = 0; i < 5; i += 1) kalt.push(rechnen(kandidaten, profilOhne, false).dauer);
  const mittel = (werte) => (werte.reduce((a, b) => a + b, 0) / werte.length).toFixed(0);
  console.log(`Mit warmem Metadaten-Cache: ${mittel(warm)} ms   (${warm.map((w) => w.toFixed(0)).join(", ")})`);
  console.log(`Ohne Metadaten-Cache:       ${mittel(kalt)} ms   (${kalt.map((w) => w.toFixed(0)).join(", ")})`);
  console.log("Beides ohne Netzabruf - die Anreicherung laeuft danach im Hintergrund.");

  // 6. Der ausfuehrliche Bericht zu den ersten fuenf.
  console.log("");
  console.log("-".repeat(78));
  console.log("5. WARUM - Bericht zu den ersten fuenf");
  console.log("-".repeat(78));
  for (const eintrag of mit.liste.slice(0, 5)) {
    console.log(empfehlung.debugBericht(eintrag));
    console.log("-".repeat(60));
  }

  // 7. Die vier Testprofile gegen denselben echten Katalog.
  if (MIT_PROFILEN) {
    const profile = [
      ["A) Naruto stark geschaut", { art: "anime", titel: "Naruto", jahr: 2002 }],
      ["B) Iron Man stark geschaut", { art: "film", titel: "Iron Man", jahr: 2008, imdb: "tt0371746" }],
      ["C) Game of Thrones stark geschaut", { art: "serie", titel: "Game of Thrones", jahr: 2011 }],
      ["D) Korra stark geschaut", { art: "serie", titel: "Die Legende von Korra", jahr: 2012, imdb: "tt1695360" }]
    ];
    for (const [name, saatWunsch] of profile) {
      // Die Saat muss aus demselben Katalog stammen wie die Kandidaten -
      // sonst hat sie keine Anbietergenres, das halbe Ranking faellt aus und
      // uebrig bleibt Rauschen. Gesucht wird deshalb der echte Eintrag.
      const gesucht = normal(saatWunsch.titel);
      const ausKatalog = kandidaten.find((item) => normal(item.title) === gesucht
        && (item.genres || []).length);
      if (!ausKatalog) {
        console.log("");
        console.log(`PROFIL ${name}: im Katalog dieser Installation nicht gefunden - uebersprungen`);
        continue;
      }
      await anreichern([wunschVon(ausKatalog.title, ausKatalog.url) || saatWunsch]);
      const saatForm = externAus(ausKatalog.title, ausKatalog.url);
      const profil = empfehlung.profilBauen([{
        title: ausKatalog.title,
        baseTitle: ausKatalog.title,
        genres: ausKatalog.genres,
        art: candidateMediaType(ausKatalog.url) || saatWunsch.art,
        type: candidateMediaType(ausKatalog.url) === "film" ? "film" : "serie",
        url: ausKatalog.url,
        providerId: ausKatalog.providerId, providerName: ausKatalog.providerName,
        completed: true, watched: true, progress: 100,
        lastWatchedAt: new Date(JETZT - 2 * 86400000).toISOString(),
        extern: saatForm
      }], JETZT);

      // Erst provider-seitig ranken, dann die vordersten anreichern - genau die
      // Rangfolge, die die App benutzt.
      // Ohne die "Das schauen andere"-Kandidaten: die haengen an den Seiten des
      // echten Verlaufs und wuerden diesem Profil ein Herkunftssignal
      // andichten, das es nicht hat. Uebrig bleibt der Katalog - und genau an
      // ihm soll sich zeigen, was die externen Daten leisten.
      const ohneSaat = kandidaten.filter((item) => item.via !== "related"
        && normal(item.title) !== gesucht);
      const vorlauf = rechnen(ohneSaat, profil, false, KANDIDATEN);
      await anreichern(vorlauf.liste.map((e) => wunschVon(e.title, e.url)));
      const fertig = rechnen(ohneSaat, profil, true, 15);
      console.log("");
      console.log("-".repeat(78));
      console.log(`PROFIL ${name}   (Saat: ${saatForm?.konfidenz || "UNMATCHED"})`);
      console.log("-".repeat(78));
      fertig.liste.forEach((e, i) => console.log(zeile(i, e)));
      const kinder = kinderAnteil(fertig.liste);
      console.log(`Kinderinhalte in den 15: ${kinder.length}${kinder.length ? " -> " + kinder.join(" | ") : ""}`);
    }
  }

  console.log("");
  console.log("=".repeat(78));
  console.log(`Metadaten-Cache dieses Laufs: ${CACHE_DATEI} (${client._cacheGroesse()} Eintraege)`);
  console.log(`Gesamtstatistik: ${JSON.stringify(client.statistik())}`);
  void cacheStand;
})().catch((fehler) => {
  console.error("Messung abgebrochen:", fehler);
  process.exit(1);
});
