"use strict";
// Der Empfehlungslauf ausserhalb von Electron.
//
// Das ist der Punkt dieser Pruefung. Bis vor kurzem stand der ganze Lauf -
// Geschmacksprofil, Kandidatensuche, Katalogtiefe, Entdeckungsseiten - in
// main.js und war damit an Electron gebunden: an `net.fetch`, an eine Datei auf
// der Platte, an ein `BrowserWindow`. Er laeuft jetzt in `empfehlungslauf.js`
// und bekommt diese drei Dinge gereicht. Genau das macht ihn auf Android
// benutzbar, wo derselbe Code im Kern-WebView laeuft (siehe
// android/app/src/main/assets/kern/eigen/empfehlung-bruecke.js).
//
// Die Umgebung hier ist deshalb absichtlich die eines fremden Wirts: kein
// Electron, kein Node-`fetch`, keine Datei. Nur Funktionen. Laeuft der Lauf
// damit durch, laeuft er auch auf dem Telefon - und wenn nicht, faellt es hier
// auf und nicht erst auf einem Geraet.
//
// Gefragt wird nicht "ist der Code gelaufen", sondern:
//
//   A) Kommt aus den Anbieterseiten ueberhaupt eine Reihe "Neu bei deinen
//      Anbietern" heraus - und traegt sie das Erscheinungsdatum?
//   B) Entstehen persoenliche Vorschlaege mit einem sichtbaren Grund?
//   C) Blaettert die Entdeckungsseite ohne Dubletten und ohne Luecke?
//   D) Wird der Geschmacks-Cache genau einmal gelesen und ueberhaupt
//      geschrieben - der Weg, ueber den Android ihn auf die Platte bringt?
//   E) Wirken die kleineren Grenzen, mit denen das Telefon rechnet?

const empfehlungslauf = require("../src/empfehlungslauf");

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(b); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };

// --- Ein Anbieter aus Papier --------------------------------------------------
//
// Drei Seitenarten, genau so aufgebaut wie bei den echten Anbietern: eine
// Startseite mit einer Neuheiten-Reihe, Detailseiten mit Genres und einem
// "Das schauen andere"-Block, und blaetterbare Genre-Uebersichten.

const WIRT = "https://anbieter.test";
const ANBIETER = [{ id: "test", name: "Testanbieter", startUrl: WIRT + "/", enabled: true }];

const GENRES = ["action", "abenteuer", "fantasy", "komoedie", "drama", "isekai"];

function kachel(nummer) {
  const slug = "titel-" + nummer;
  return `<a href="${WIRT}/anime/stream/${slug}" title="Titel ${nummer}">`
    + `<img src="${WIRT}/bild/${slug}.jpg" alt="Titel ${nummer}"></a>`;
}

function startseite() {
  const kacheln = [];
  for (let i = 1; i <= 20; i += 1) kacheln.push(kachel(i));
  return `<html><body>
    <h2>Beliebt bei anderen</h2>${kachel(900)}
    <h2>Neue Animes</h2>${kacheln.join("")}
  </body></html>`;
}

// Welche Genres ein Titel hat, haengt an seiner Nummer - stabil, damit zwei
// Laeufe dasselbe Ergebnis liefern. Titel 1 bis 6 tragen jeweils drei Genres,
// alle weiteren zwei; so gibt es Ueberschneidungen, aber keine Einheitssuppe.
function genreFuer(nummer) {
  const aus = [];
  for (let i = 0; i < 3; i += 1) aus.push(GENRES[(nummer + i) % GENRES.length]);
  return aus;
}

function detailseite(nummer) {
  const links = genreFuer(nummer)
    .map((name) => `<a href="${WIRT}/genre/${name}">${name}</a>`).join(" ");
  // Zwei Nachbarn als "Das schauen andere" - der Block, aus dem die staerksten
  // Kandidaten kommen.
  const nachbarn = [kachel(nummer + 100), kachel(nummer + 101)].join("");
  return `<html><body>
    <h1>Titel ${nummer}</h1>
    <div class="genres">${links}</div>
    <span data-imdb="tt${String(1000000 + nummer)}"></span>
    <span itemprop="startDate">201${nummer % 10}</span>
    <p>Erscheinungsdatum: 12.03.2024</p>
    <h2>Das schauen andere</h2>${nachbarn}
  </body></html>`;
}

// Eine Genre-Uebersicht mit Blaetterleiste. Seite 1 traegt die Leiste, jede
// Seite dreissig Titel - der Nummernkreis haengt an der Seitenzahl, damit
// Seite 7 andere Titel zeigt als Seite 1.
const GENRE_SEITEN = 12;

function genreListe(seite) {
  const kacheln = [];
  const anfang = 1000 + seite * 100;
  for (let i = 0; i < 30; i += 1) kacheln.push(kachel(anfang + i));
  const blaettern = [];
  for (let n = 2; n <= GENRE_SEITEN; n += 1) {
    blaettern.push(`<a href="?page=${n}">${n}</a>`);
  }
  return `<html><body><nav>${blaettern.join("")}</nav>${kacheln.join("")}</body></html>`;
}

let abrufe = 0;

function seiteFuer(adresse) {
  abrufe += 1;
  const url = new URL(adresse);
  if (url.pathname === "/" || url.pathname === "") {
    return { html: startseite(), url: adresse };
  }
  const genre = url.pathname.match(/^\/genre\/([a-z]+)$/);
  if (genre) {
    const nummer = Number(url.searchParams.get("page") || 1);
    return { html: genreListe(nummer), url: adresse };
  }
  const titel = url.pathname.match(/^\/anime\/stream\/titel-(\d+)$/);
  if (titel) return { html: detailseite(Number(titel[1])), url: adresse };
  return null;
}

// --- Der Verlauf --------------------------------------------------------------

const JETZT = Date.parse("2026-08-24T12:00:00Z");
const vorTagen = (n) => new Date(JETZT - n * 86400000).toISOString();

function verlaufsEintrag(nummer, tage) {
  return {
    id: "f" + nummer,
    providerId: "test",
    providerName: "Testanbieter",
    url: `${WIRT}/anime/stream/titel-${nummer}`,
    title: "Titel " + nummer,
    type: "serie",
    watched: true,
    completed: true,
    progress: 100,
    lastWatchedAt: vorTagen(tage),
    completedEpisodes: []
  };
}

const ABLAGE = [1, 2, 3, 4, 5, 6].map((nummer, i) => verlaufsEintrag(nummer, i + 1));

// --- Die Umgebung -------------------------------------------------------------

function umgebungBauen(grenzen) {
  const zustand = {
    gelesen: 0,
    geschrieben: 0,
    gemeldet: 0,
    cache: { version: 3, pages: {}, lists: {}, anzeigen: {}, personal: null }
  };
  const umgebung = {
    holen: async (adresse) => seiteFuer(adresse),
    cacheLesen: () => {
      zustand.gelesen += 1;
      return zustand.cache;
    },
    cacheSchreiben: () => {
      zustand.geschrieben += 1;
    },
    anbieter: () => ANBIETER,
    eintraege: () => ABLAGE,
    // Ohne Relay gibt es keine externen Daten. Das ist der Normalfall beim
    // ersten Start und darf den Lauf nicht aufhalten - genau deshalb steht
    // hier ein Client, der nichts weiss.
    metadaten: () => ({
      bereit: () => false,
      gesperrt: () => false,
      ausCache: () => null,
      fehltImCache: () => true,
      nachschlagen: async () => new Map(),
      statistik: () => ({})
    }),
    melden: () => {
      zustand.gemeldet += 1;
    },
    debug: false
  };
  if (grenzen) umgebung.grenzen = grenzen;
  return { umgebung, zustand };
}

(async () => {
  // --- A) Neu bei deinen Anbietern -------------------------------------------
  {
    const { umgebung, zustand } = umgebungBauen(null);
    const lauf = empfehlungslauf.erstellen(umgebung);
    const neues = await lauf.neuesVonAnbietern(6, false);
    pruefe("A1 Neuheiten-Reihe entsteht", neues.length === 6, `${neues.length} Kacheln`);
    pruefe("A2 nur aus der Neuheiten-Reihe",
      neues.every((item) => /titel-\d+$/.test(item.url)) && !neues.some((item) => /titel-900$/.test(item.url)),
      neues.map((item) => item.title).join(", "));
    // Das Erscheinungsdatum steht auf der Detailseite, nicht auf der
    // Startseite. Vorher ging das ganze Abrufergebnis in die Extraktion und
    // `String({html,url})` machte daraus "[object Object]" - kein Muster fand
    // je etwas, und auf keiner Kachel stand jemals ein Datum.
    pruefe("A3 Erscheinungsdatum wird nachgeholt",
      neues.every((item) => item.releasedAt === "2024-03-12"),
      neues.map((item) => item.releasedAt || "-").join(", "));
    // Die Neuheiten-Reihe fasst den Geschmacks-Cache nicht an: sie merkt sich
    // ihre Kacheln und die Erscheinungsdaten im Speicher des Laufs. Das ist
    // richtig so - und wird hier festgehalten, damit es nicht unbemerkt zu
    // Schreibzugriffen kommt, die auf dem Telefon jedes Mal eine Datei ueber
    // die Bruecke schicken wuerden.
    pruefe("A4 die Neuheiten-Reihe schreibt nichts", zustand.geschrieben === 0,
      `${zustand.geschrieben} Mal`);
  }

  // --- B) Persoenliche Vorschlaege -------------------------------------------
  let vorschlaege = [];
  {
    const { umgebung, zustand } = umgebungBauen(null);
    const lauf = empfehlungslauf.erstellen(umgebung);
    vorschlaege = await lauf.persoenlich(24, false, "", true);
    pruefe("B1 Vorschlaege entstehen", vorschlaege.length > 0, `${vorschlaege.length} Titel`);
    pruefe("B2 nichts aus der Ablage",
      !vorschlaege.some((item) => ABLAGE.some((eintrag) => eintrag.url === item.url)),
      vorschlaege.slice(0, 3).map((item) => item.title).join(", "));
    // Der sichtbare Satz. Ohne ihn ist eine Vorschlagskarte eine Behauptung
    // ohne Begruendung - und genau diese Zeile traegt die Reihe auf dem
    // Telefon wie am Rechner.
    const mitGrund = vorschlaege.filter((item) => item.grundText && item.grundText.length > 3);
    pruefe("B3 jeder Vorschlag traegt einen Grund",
      mitGrund.length === vorschlaege.length,
      `${mitGrund.length}/${vorschlaege.length}, z. B. "${(vorschlaege[0] || {}).grundText}"`);
    pruefe("B4 jeder Vorschlag hat eine Werk-Kennung",
      vorschlaege.every((item) => item.werkKey), "");
    pruefe("B5 Anbieterseiten wurden wirklich gelesen", zustand.gelesen > 0 && abrufe > 0,
      `${abrufe} Abrufe`);
    // Der Weg, ueber den Android den Cache auf die Platte bekommt: der Lauf
    // legt Detailseiten und Genre-Listen ab und meldet, dass zu sichern ist.
    // Ohne diesen Ruf holte das Telefon bei jedem Start denselben Katalog neu.
    pruefe("B6 Detailseiten landen im Cache",
      Object.keys(zustand.cache.pages).length > 0,
      `${Object.keys(zustand.cache.pages).length} Seiten`);
    pruefe("B7 Genre-Listen landen im Cache",
      Object.keys(zustand.cache.lists).length > 0,
      `${Object.keys(zustand.cache.lists).length} Listen`);
    pruefe("B8 der Wirt wird zum Sichern aufgefordert", zustand.geschrieben > 0,
      `${zustand.geschrieben} Mal`);
  }

  // --- C) Die Entdeckungsseite ------------------------------------------------
  {
    const { umgebung } = umgebungBauen(null);
    const lauf = empfehlungslauf.erstellen(umgebung);
    const erste = await lauf.entdeckungsSeite("anime", 0, 30, false);
    const zweite = await lauf.entdeckungsSeite("anime", erste.items.length, 30, false);
    pruefe("C1 erste Seite ist voll", erste.items.length === 30, `${erste.items.length}`);
    pruefe("C2 zweite Seite bringt Neues", zweite.items.length > 0, `${zweite.items.length}`);
    const schluessel = new Set(erste.items.map((item) => item.werkKey));
    const doppelt = zweite.items.filter((item) => schluessel.has(item.werkKey));
    pruefe("C3 keine Dublette ueber die Seitengrenze", doppelt.length === 0,
      doppelt.map((item) => item.title).join(", "));
    pruefe("C4 Antwort sagt, ob noch etwas kommt",
      typeof erste.fertig === "boolean" && typeof erste.waechst === "boolean",
      `fertig=${erste.fertig} waechst=${erste.waechst}`);
    // Dieselbe Anfrage noch einmal muss dieselben Titel liefern - sonst
    // verschoebe sich die Liste unter dem Nutzer, waehrend er scrollt, und der
    // Versatz zeigte auf einen anderen Titel als beim vorigen Abruf.
    const nochmal = await lauf.entdeckungsSeite("anime", 0, 30, false);
    pruefe("C5 die Reihenfolge steht still",
      nochmal.items.map((item) => item.werkKey).join("|")
        === erste.items.map((item) => item.werkKey).join("|"), "");
  }

  // --- D) Die Arten trennen sich ---------------------------------------------
  {
    const { umgebung } = umgebungBauen(null);
    const lauf = empfehlungslauf.erstellen(umgebung);
    const anime = await lauf.persoenlich(20, false, "anime", false);
    const filme = await lauf.persoenlich(20, false, "film", false);
    pruefe("D1 Anime-Reihe ist gefuellt", anime.length > 0, `${anime.length}`);
    pruefe("D2 alle sind wirklich Anime",
      anime.every((item) => item.url.includes("/anime/")), "");
    // Der Papieranbieter fuehrt nur Anime. Eine Filmreihe darf dann leer sein -
    // aber sie darf nicht mit Anime gefuellt werden.
    pruefe("D3 Filmreihe erfindet nichts", filme.length === 0, `${filme.length}`);
  }

  // --- E) Die Grenzen des Telefons -------------------------------------------
  {
    const gross = empfehlungslauf.erstellen(umgebungBauen(null).umgebung);
    const klein = empfehlungslauf.erstellen(umgebungBauen({
      poolGroesse: 40, listenGroesse: 60, genreKandidaten: 50
    }).umgebung);
    const weit = await gross.entdeckungsSeite("anime", 0, 30, false);
    const eng = await klein.entdeckungsSeite("anime", 0, 30, false);
    pruefe("E1 der kleine Pool ist wirklich kleiner",
      eng.gesamt < weit.gesamt, `${eng.gesamt} gegen ${weit.gesamt}`);
    pruefe("E2 und trotzdem brauchbar", eng.items.length > 0, `${eng.items.length}`);
    // Dieselbe Rechnung, nur kuerzer: der beste Titel darf nicht ein anderer
    // sein, bloss weil das Telefon weniger tief schaut.
    pruefe("E3 dieselbe Rangfolge an der Spitze",
      eng.items[0] && weit.items[0] && eng.items[0].werkKey === weit.items[0].werkKey,
      `${(eng.items[0] || {}).title} gegen ${(weit.items[0] || {}).title}`);
  }

  // --- F) Muedigkeit ----------------------------------------------------------
  {
    const { umgebung, zustand } = umgebungBauen(null);
    const lauf = empfehlungslauf.erstellen(umgebung);
    const liste = await lauf.persoenlich(12, false, "", true);
    const angezeigt = Object.keys(zustand.cache.anzeigen || {}).length;
    pruefe("F1 Anzeigen werden gezaehlt", angezeigt === liste.length,
      `${angezeigt} von ${liste.length}`);
    const ziel = liste[0];
    lauf.vergissMuedigkeit(ziel.url, ziel.title, "");
    pruefe("F2 ein geoeffneter Vorschlag faengt von vorn an",
      Object.keys(zustand.cache.anzeigen).length === angezeigt - 1,
      ziel.title);
  }

  const bestanden = pruefungen.filter(Boolean).length;
  console.log(`${bestanden}/${pruefungen.length} bestanden`);
  process.exit(bestanden === pruefungen.length ? 0 : 1);
})().catch((fehler) => {
  console.log("FAIL  Lauf abgebrochen   -> " + (fehler && fehler.stack || fehler));
  process.exit(1);
});
