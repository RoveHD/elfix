"use strict";

// Warum steht auf den Karten fast immer ein Genre-Satz?
//
// Dieses Werkzeug rechnet die Empfehlungen der laufenden Installation noch
// einmal nach - mit demselben Verlauf, denselben Kandidaten und demselben
// Metadaten-Cache, den die App gerade benutzt. Es geht ans Netz nur, wenn man
// es ausdruecklich verlangt (--holen), und es schreibt nichts.
//
// Gefragt wird nicht "funktioniert es", sondern an welcher der fuenf Stellen
// es haengt:
//
//   1. fehlende Zuordnung        - der Titel ist bei TMDB/AniList gar nicht
//                                  aufgeloest
//   2. fehlende Merkmale         - er ist aufgeloest, aber es gibt keine
//                                  Beziehung, keine gemeinsamen Tags, nichts
//   3. zu strenge Schwellen      - die Merkmale sind da und werden verworfen
//   4. falsche Reihenfolge       - der externe Grund existiert, verliert aber
//                                  gegen einen Genre-Grund
//   5. Oberflaeche               - der Grund stimmt, kommt aber nicht an
//
// Fuer jede der ersten vier gibt es unten eine Zahl. Die fuenfte beantwortet
// ein Blick auf die Zeitstempel: liegt `personal.at` im Geschmacks-Cache nach
// der letzten Aenderung am Metadaten-Cache, hat die Oberflaeche neu gerechnet.
//
// Aufruf:
//   node scripts/empfehlungsdiagnose.js [--karten 24] [--holen]

const fs = require("fs");
const os = require("os");
const path = require("path");

const empfehlung = require("../src/empfehlung");
const metadatenModul = require("../src/metadaten");
const titelModul = require("../src/titel");

function argument(name, ersatz) {
  const index = process.argv.indexOf("--" + name);
  if (index < 0) return ersatz;
  const wert = process.argv[index + 1];
  return wert && !wert.startsWith("--") ? wert : true;
}

const DATEN = String(argument("daten", path.join(os.homedir(), "AppData", "Roaming", "ELFIX")));
const KARTEN = Number(argument("karten", 24)) || 24;
const HOLEN = Boolean(argument("holen", false));
const S = empfehlung.SCHWELLEN;
const JETZT = Date.now();

function lesen(datei, ersatz) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATEN, datei), "utf8"));
  } catch {
    return ersatz;
  }
}

// --- Nachbau der Kette aus main.js -------------------------------------------

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

// --- Daten -------------------------------------------------------------------

const favoritesRoh = lesen("favorites.json", []);
const favorites = Array.isArray(favoritesRoh) ? favoritesRoh : (favoritesRoh.items || []);
const tasteCache = lesen("taste-cache.json", { pages: {}, lists: {} });
const providersRoh = lesen("providers.json", []);
const providers = Array.isArray(providersRoh) ? providersRoh : (providersRoh.providers || []);
const settings = lesen("settings.json", {});
const aktiv = new Set(providers.filter((p) => p.enabled !== false).map((p) => p.id));
const seiten = tasteCache.pages || {};
const listen = tasteCache.lists || {};

const verlauf = favorites
  .filter((f) => !aktiv.size || aktiv.has(f.providerId))
  .filter((f) => f.watched || f.favorite || f.completed || Number(f.position) > 0)
  .sort((a, b) => Date.parse(b.lastWatchedAt || b.openedAt || b.createdAt || 0)
    - Date.parse(a.lastWatchedAt || a.openedAt || a.createdAt || 0))
  // Wie main.js: der ganze aktive Verlauf, nicht die letzten N.
  .slice(0, 500);

const seitenEintrag = (url) => seiten[seriesPageUrl(url)] || null;
const metaAus = (url) => seitenEintrag(url)?.meta || null;

// Der Metadaten-Cache der App - schreibgeschuetzt benutzt.
const CACHE_DATEI = path.join(DATEN, "metadaten-cache.json");
const basis = (() => {
  const roh = String(settings.watchparty?.serverUrl || "").trim();
  if (!roh) return "";
  const mitSchema = /^[a-z]+:\/\//i.test(roh) ? roh : "https://" + roh;
  return mitSchema.replace(/^wss?:/i, (t) => (t === "ws:" ? "http:" : "https:")).replace(/\/+$/, "");
})();
const client = metadatenModul.erstellen({
  basis: HOLEN ? basis : "",
  laden: () => JSON.parse(fs.readFileSync(CACHE_DATEI, "utf8")),
  speichern: () => {}
});

function wunschVon(titel, url) {
  const name = String(titel || "").trim();
  if (!name) return null;
  const meta = metaAus(url);
  return {
    art: candidateMediaType(url) || "serie",
    titel: name,
    jahr: meta?.jahr || 0,
    imdb: meta?.imdb || "",
    altTitel: meta?.titelAlt || []
  };
}

const externAus = (titel, url) => {
  const wunsch = wunschVon(titel, url);
  return wunsch ? client.ausCache(wunsch) : null;
};

function kandidatenBauen() {
  const kandidaten = [];
  const staerkste = Math.max(...verlauf.map((f) => empfehlung.signalStaerke(f)), 1e-9);
  for (const favorite of verlauf) {
    for (const item of seitenEintrag(favorite.url)?.related || []) {
      kandidaten.push({
        ...item, via: "related", seedTitle: favorite.title,
        seedWeight: empfehlung.signalStaerke(favorite) / staerkste, genres: []
      });
    }
  }
  const ausListen = new Map();
  for (const liste of Object.values(listen)) {
    for (const item of liste?.items || []) {
      if (!item?.url || ausListen.has(item.url)) continue;
      ausListen.set(item.url, {
        ...item, via: "genre",
        genres: (seitenEintrag(item.url)?.genres || []).map((g) => g.key)
      });
    }
  }
  kandidaten.push(...ausListen.values());
  return kandidaten.map((item) => ({
    ...item,
    type: candidateMediaType(item.url) === "film" ? "film" : "serie",
    art: candidateMediaType(item.url) || "",
    extern: externAus(item.baseTitle || item.title, item.url)
  }));
}

const ausschluss = new Set();
for (const favorite of favorites) {
  const art = candidateMediaType(favorite.url) === "film" ? "film" : favorite.type;
  ausschluss.add(titelModul.werkSchluessel(favorite.title, art));
}

// --- Die Nachrechnung der Grundauswahl ---------------------------------------
//
// Die Engine verwirft einen Grund an genau zwei Stellen: an seinen eigenen
// Belegbedingungen und an der Relevanzhuerde (`zaehlt`). Beides wird hier mit
// denselben Zahlen nachgerechnet - die Schwellen kommen aus der Engine, nicht
// aus einer Abschrift.

function grundLage(eintrag) {
  const b = eintrag.beitraege || {};
  const belege = eintrag.belege || {};
  const stumm = new Set(["anbieter", "externRang"]);
  const erklaerbar = Object.entries(b).filter(([name]) => !stumm.has(name)).map(([, wert]) => wert);
  const gesamt = erklaerbar.reduce((summe, wert) => summe + Math.max(0, wert), 0);
  const groesster = Math.max(...erklaerbar, 0);
  const zaehlt = (wert, konkret) => wert > 0
    && (wert >= gesamt * (konkret ? S.GRUND_RELEVANZ_PAAR : S.GRUND_RELEVANZ) || wert >= groesster);

  const lagen = [];
  const pruefen = (name, beitrag, bedingungen, konkret = true) => {
    const gescheitert = bedingungen.filter((bed) => !bed.ok).map((bed) => bed.name);
    const relevant = zaehlt(beitrag, konkret);
    lagen.push({
      name,
      beitrag,
      anteil: gesamt > 0 ? beitrag / gesamt : 0,
      belegt: !gescheitert.length,
      relevant,
      genommen: !gescheitert.length && relevant,
      gescheitert: gescheitert.length ? gescheitert : (relevant ? [] : ["nicht relevant genug"])
    });
  };

  pruefen("EXTERNAL_SEQUEL/PREQUEL/COLLECTION/FRANCHISE", b.externRelation, [
    { name: "keine belegte Beziehung", ok: Boolean(belege.beziehung) }
  ]);
  pruefen("EXTERNAL_TAG_SIMILARITY", b.externInhalt, [
    { name: "kein tragender Verlaufstitel", ok: Boolean(belege.inhaltTitel) },
    { name: `spezifische Merkmale < ${S.EXTERN_GEMEINSAM}`,
      ok: (belege.inhaltSpezifisch || 0) >= S.EXTERN_GEMEINSAM },
    { name: `Deckung < ${S.EXTERN_DECKUNG}`, ok: (belege.inhaltDeckung || 0) >= S.EXTERN_DECKUNG },
    { name: `Vorsprung < ${S.EXTERN_VORSPRUNG}`, ok: (belege.inhaltVorsprung || 0) >= S.EXTERN_VORSPRUNG }
  ]);
  pruefen("EXTERNAL_RECOMMENDATION", b.externEmpfehlung, [
    { name: "keine fremde Empfehlung", ok: Boolean(belege.empfehlungTitel) }
  ]);
  pruefen("SAME_ACTOR/DIRECTOR/CREATOR/STUDIO", b.externPersonen, [
    { name: "keine gemeinsame Person, kein Studio",
      ok: Boolean(belege.schauspieler || belege.regie || belege.autor || belege.studio) }
  ]);
  pruefen("STRONG_SEED_SIMILARITY (Anbieter)", b.verlauf, [
    { name: "Seed traegt nicht", ok: Boolean(belege.verlaufTitel) }
  ]);
  pruefen("SPECIFIC_TAG / BASED_ON_GENRE (Anbieter)", Math.max(b.genre, b.sitzung), [
    { name: "kein nennbares Genre/Tag", ok: Boolean(belege.tag || belege.genre) }
  ], false);
  return { lagen, gesamt };
}

// --- Bericht -----------------------------------------------------------------

function kartenBericht(eintrag, index) {
  const belege = eintrag.belege || {};
  const b = eintrag.beitraege || {};
  const teil = eintrag.teilwerte || {};
  const extern = Object.entries(b)
    .filter(([name]) => name.startsWith("extern"))
    .reduce((summe, [, wert]) => summe + wert, 0);
  const anbieter = Object.entries(b)
    .filter(([name]) => !name.startsWith("extern"))
    .reduce((summe, [, wert]) => summe + wert, 0);
  const geteilt = belege.inhaltGeteilt || [];
  const auswahl = (praefix) => geteilt.filter((k) => k.startsWith(praefix)).map((k) => k.slice(2));
  const { lagen } = grundLage(eintrag);

  const zeilen = [
    `${String(index + 1).padStart(2)}. ${eintrag.title}`,
    `    Welt ${eintrag.welt}   Score ${eintrag.score.toFixed(3)}   Confidence ${eintrag.confidence}`,
    `    staerkster Seed (Anbieter): ${belege.verlaufBester || "(keiner)"}`
      + `   Deckung ${(belege.verlaufDeckung || 0).toFixed(2)}`
      + `   Anteil ${(100 * (belege.verlaufAnteil || 0)).toFixed(0)}%`,
    `    externe Quelle: ${belege.externQuelle || "(keine Zuordnung)"}`
      + `   ID ${belege.externId || "-"}   Konfidenz ${belege.externKonfidenz || "-"}`,
    `    Score-Anteile: Anbieter ${anbieter.toFixed(3)}   extern ${extern.toFixed(3)}`,
    `    Beziehung: ${belege.beziehung
      ? `${belege.beziehung} (${belege.beziehungQuelle} ${belege.beziehungBelegt || ""}) zu ${belege.beziehungTitel}`
      : "(keine)"}`
      + `   Sammlung ${belege.sammlung ? belege.sammlungTitel + " #" + belege.sammlung : "(keine)"}`,
    `    externe Naehe zu: ${belege.inhaltTitel || "(keiner)"}`
      + `   Deckung ${(belege.inhaltDeckung || 0).toFixed(3)}`
      + `   Vorsprung ${Number.isFinite(belege.inhaltVorsprung) ? belege.inhaltVorsprung.toFixed(2) + "x" : "allein"}`
      + `   Merkmale ${geteilt.length}`,
    `      Sachmerkmale: ${auswahl("s:").join(", ") || "(keine)"}`,
    `      Genres:      ${auswahl("g:").join(", ") || "(keine)"}`,
    `    Schauspieler ${belege.schauspieler || "-"}   Regie ${belege.regie || "-"}`
      + `   Autor ${belege.autor || "-"}   Studio ${belege.studio || "-"}`,
    `    fremde Empfehlung: ${belege.empfehlungTitel || "(keine)"}`
      + `   Bewertung ${belege.bewertung === null || belege.bewertung === undefined ? "-" : belege.bewertung}`
      + ` (${belege.bewertungStimmen || 0} Stimmen, ${belege.rangBelegt ? "zaehlt" : "zaehlt nicht"})`,
    "    Grund-Kandidaten:"
  ];
  for (const lage of lagen) {
    const marke = lage.genommen ? "JA " : "NEIN";
    zeilen.push(`      ${marke} ${lage.name.padEnd(46)} Beitrag ${lage.beitrag.toFixed(3)}`
      + ` (${(100 * lage.anteil).toFixed(0)}%)`
      + (lage.gescheitert.length ? `   verworfen: ${lage.gescheitert.join(", ")}` : ""));
  }
  zeilen.push(`    -> gewaehlt: ${eintrag.grund}   „${eintrag.grundText}“`);
  void teil;
  return zeilen.join("\n");
}

// --- Lauf --------------------------------------------------------------------

(async () => {
  console.log("=".repeat(80));
  console.log("DIAGNOSE: warum stehen auf den Karten Genre-Saetze?");
  console.log("=".repeat(80));

  const cacheStand = (() => {
    try {
      return fs.statSync(CACHE_DATEI).mtime;
    } catch {
      return null;
    }
  })();
  const personal = tasteCache.personal;
  console.log(`Metadaten-Cache:     ${cacheStand ? cacheStand.toISOString() : "(fehlt)"}`
    + `   ${client._cacheGroesse()} Eintraege`);
  console.log(`Sichtbare Liste:     ${personal ? new Date(personal.at).toISOString() : "(keine)"}`
    + `   ${(personal?.items || []).length} Eintraege`);
  if (cacheStand && personal) {
    const nachher = personal.at >= cacheStand.getTime();
    console.log(`Punkt 5 (Oberflaeche): die sichtbare Liste ist ${nachher ? "NEUER" : "AELTER"}`
      + ` als der Metadaten-Cache -> ${nachher
        ? "sie wurde nach der Anreicherung neu gerechnet, das Wiring greift"
        : "sie wurde seit der Anreicherung NICHT neu gerechnet"}`);
  }
  if (personal?.items?.length) {
    const gruende = new Map();
    for (const item of personal.items) gruende.set(item.grund, (gruende.get(item.grund) || 0) + 1);
    console.log(`Gruende der sichtbaren Liste: ${[...gruende].map(([g, n]) => `${g} ${n}`).join("   ")}`);
  }

  const kandidaten = kandidatenBauen();
  const profil = empfehlung.profilBauen(verlauf.map((favorite) => ({
    ...favorite,
    baseTitle: favorite.title,
    art: candidateMediaType(favorite.url) || favorite.type || "",
    genres: (seitenEintrag(favorite.url)?.genres || []).map((g) => g.key),
    extern: externAus(favorite.title, favorite.url)
  })), JETZT);

  console.log("");
  console.log(`Verlauf: ${verlauf.length} Titel, davon mit externen Daten:`
    + ` ${profil.eintraege.filter((e) => e.extern).length}`);
  const verlaufKonf = new Map();
  for (const favorite of verlauf) {
    const form = externAus(favorite.title, favorite.url);
    const stufe = form ? form.konfidenz : "(nicht im Cache)";
    verlaufKonf.set(stufe, (verlaufKonf.get(stufe) || 0) + 1);
  }
  console.log(`  Konfidenz im Verlauf: ${[...verlaufKonf].map(([k, n]) => `${k} ${n}`).join("   ")}`);
  console.log(`Kandidatenpool: ${kandidaten.length}`
    + `   davon mit externen Daten: ${kandidaten.filter((k) => k.extern).length}`);

  const liste = empfehlung.empfehlen(kandidaten, profil, {
    jetzt: JETZT, limit: Math.max(KARTEN, 150), ausschluss, debug: true
  });
  const sichtbar = liste.slice(0, KARTEN);

  // --- Punkt 5: Konfidenz der sichtbaren Kandidaten -------------------------
  console.log("");
  console.log("-".repeat(80));
  console.log(`ZUORDNUNG DER ${sichtbar.length} SICHTBAREN KARTEN`);
  console.log("-".repeat(80));
  const konf = new Map();
  for (const eintrag of sichtbar) {
    const stufe = eintrag.belege?.externKonfidenz || "(nicht im Cache)";
    konf.set(stufe, (konf.get(stufe) || 0) + 1);
  }
  for (const [stufe, anzahl] of [...konf].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(stufe).padEnd(18)} ${anzahl}`);
  }

  // --- Punkt 4: woran scheitert welcher Grund? -------------------------------
  const gescheitertAn = new Map();
  const belegtAber = new Map();
  const genommen = new Map();
  for (const eintrag of sichtbar) {
    for (const lage of grundLage(eintrag).lagen) {
      if (lage.genommen) {
        genommen.set(lage.name, (genommen.get(lage.name) || 0) + 1);
        continue;
      }
      if (lage.belegt && !lage.relevant) {
        belegtAber.set(lage.name, (belegtAber.get(lage.name) || 0) + 1);
      }
      for (const grund of lage.gescheitert) {
        const schluessel = `${lage.name} :: ${grund}`;
        gescheitertAn.set(schluessel, (gescheitertAn.get(schluessel) || 0) + 1);
      }
    }
  }
  console.log("");
  console.log("-".repeat(80));
  console.log("WORAN SCHEITERT WELCHER GRUND (ueber die sichtbaren Karten)");
  console.log("-".repeat(80));
  for (const [schluessel, anzahl] of [...gescheitertAn].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(anzahl).padStart(3)}x  ${schluessel}`);
  }
  console.log("  --- genommen ---");
  for (const [name, anzahl] of [...genommen].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(anzahl).padStart(3)}x  ${name}`);
  }
  console.log("  --- belegt, aber nicht relevant genug (Punkt 4: Reihenfolge) ---");
  for (const [name, anzahl] of [...belegtAber].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(anzahl).padStart(3)}x  ${name}`);
  }

  // --- Punkt 4 der Anfrage: die Verteilung der gemeinsamen Merkmale ---------
  console.log("");
  console.log("-".repeat(80));
  console.log("EXTERNAL_TAG_SIMILARITY: wie oft ist die Regel ueberhaupt erfuellbar?");
  console.log("-".repeat(80));
  const merkmalHisto = new Map();
  const deckungHisto = new Map();
  const vorsprungHisto = new Map();
  let ohneZuordnung = 0;
  let ohneNaehe = 0;
  const abgelehnt = { merkmale: 0, deckung: 0, vorsprung: 0, relevanz: 0, genommen: 0 };
  const gepruefte = liste.slice(0, 150);
  for (const eintrag of gepruefte) {
    const belege = eintrag.belege || {};
    if (!belege.externQuelle) { ohneZuordnung += 1; continue; }
    if (!belege.inhaltTitel) { ohneNaehe += 1; continue; }
    const anzahl = belege.inhaltSpezifisch || 0;
    const stufe = anzahl >= 3 ? "3+" : String(anzahl);
    merkmalHisto.set(stufe, (merkmalHisto.get(stufe) || 0) + 1);
    const d = belege.inhaltDeckung || 0;
    const dStufe = d < 0.1 ? "<0.10" : d < 0.15 ? "0.10-0.15" : d < 0.2 ? "0.15-0.20"
      : d < 0.25 ? "0.20-0.25" : d < 0.35 ? "0.25-0.35" : "0.35+";
    deckungHisto.set(dStufe, (deckungHisto.get(dStufe) || 0) + 1);
    const v = belege.inhaltVorsprung || 0;
    const vStufe = !Number.isFinite(v) ? "allein" : v < 1.05 ? "<1.05" : v < 1.15 ? "1.05-1.15"
      : v < 1.25 ? "1.15-1.25" : v < 1.5 ? "1.25-1.50" : "1.50+";
    vorsprungHisto.set(vStufe, (vorsprungHisto.get(vStufe) || 0) + 1);

    // Welche einzelne Bedingung kippt es?
    if (anzahl < S.EXTERN_GEMEINSAM) abgelehnt.merkmale += 1;
    else if (d < S.EXTERN_DECKUNG) abgelehnt.deckung += 1;
    else if (v < S.EXTERN_VORSPRUNG) abgelehnt.vorsprung += 1;
    else {
      const lage = grundLage(eintrag).lagen.find((l) => l.name === "EXTERNAL_TAG_SIMILARITY");
      if (lage?.relevant) abgelehnt.genommen += 1;
      else abgelehnt.relevanz += 1;
    }
  }
  const sortiert = (karte) => [...karte].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  console.log(`Von ${gepruefte.length} Kandidaten:`);
  console.log(`  ohne externe Zuordnung:            ${ohneZuordnung}`);
  console.log(`  zugeordnet, aber keine Naehe:      ${ohneNaehe}`);
  console.log(`  gemeinsame Merkmale: ${sortiert(merkmalHisto).map(([k, n]) => `${k}: ${n}`).join("   ")}`);
  console.log(`  gewichtete Deckung:  ${sortiert(deckungHisto).map(([k, n]) => `${k}: ${n}`).join("   ")}`);
  console.log(`  Vorsprung:           ${sortiert(vorsprungHisto).map(([k, n]) => `${k}: ${n}`).join("   ")}`);
  console.log("Abgelehnt durch die erste greifende Bedingung:");
  console.log(`  zu wenige Merkmale (< ${S.EXTERN_GEMEINSAM}):  ${abgelehnt.merkmale}`);
  console.log(`  Deckung < ${S.EXTERN_DECKUNG}:                ${abgelehnt.deckung}`);
  console.log(`  Vorsprung < ${S.EXTERN_VORSPRUNG}:              ${abgelehnt.vorsprung}`);
  console.log(`  Relevanzhuerde (${S.GRUND_RELEVANZ}):          ${abgelehnt.relevanz}`);
  console.log(`  wuerde durchkommen:               ${abgelehnt.genommen}`);

  // --- Kalibrierung: welche Regel trennt die Daten wirklich? ----------------
  //
  // Die heutige Regel zaehlt alle gemeinsamen Merkmale gleich - auch die
  // breiten Genres der Datenbank ("action", "fantasy"). Genau die tragen aber
  // nichts: dass zwei Anime beide "action" sind, ist derselbe leere Satz wie
  // beim Anbieter. Interessant ist, wie viele *spezifische* Merkmale (Tags und
  // Schlagworte) ein Paar teilt. Hier stehen beide Zaehlungen nebeneinander,
  // damit sich an echten Paaren entscheiden laesst, welche trennt.
  console.log("");
  console.log("-".repeat(80));
  console.log("KALIBRIERUNG: breite Genres gegen spezifische Merkmale");
  console.log("-".repeat(80));
  const paare = [];
  for (const eintrag of gepruefte) {
    const belege = eintrag.belege || {};
    if (!belege.externQuelle || !belege.inhaltTitel) continue;
    const geteilt = belege.inhaltGeteilt || [];
    paare.push({
      titel: eintrag.title,
      seed: belege.inhaltTitel,
      alle: geteilt.length,
      spezifisch: geteilt.filter((k) => k.startsWith("s:")).length,
      deckung: belege.inhaltDeckung || 0,
      vorsprung: belege.inhaltVorsprung || 0,
      merkmale: geteilt.filter((k) => k.startsWith("s:")).map((k) => k.slice(2))
    });
  }
  const histo = new Map();
  for (const paar of paare) {
    const stufe = paar.spezifisch >= 6 ? "6+" : String(paar.spezifisch);
    histo.set(stufe, (histo.get(stufe) || 0) + 1);
  }
  console.log(`Spezifische gemeinsame Merkmale (Tags/Schlagworte, ohne breite Genres):`);
  console.log(`  ${[...histo].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([k, n]) => `${k}: ${n}`).join("   ")}`);

  const regeln = [
    ["heute:      >=3 Merkmale, Deckung >=0.25, Vorsprung >=1.25",
      (p) => p.alle >= 3 && p.deckung >= 0.25 && p.vorsprung >= 1.25],
    ["nur Zaehlung: >=3 spezifische Merkmale",
      (p) => p.spezifisch >= 3],
    ["A: >=3 spezifisch, Vorsprung >=1.1",
      (p) => p.spezifisch >= 3 && p.vorsprung >= 1.1],
    ["B: >=3 spezifisch, Deckung >=0.15",
      (p) => p.spezifisch >= 3 && p.deckung >= 0.15],
    ["C: >=3 spezifisch, Deckung >=0.15, Vorsprung >=1.1",
      (p) => p.spezifisch >= 3 && p.deckung >= 0.15 && p.vorsprung >= 1.1],
    ["D: >=4 spezifisch, Deckung >=0.15",
      (p) => p.spezifisch >= 4 && p.deckung >= 0.15]
  ];
  console.log("");
  for (const [name, regel] of regeln) {
    console.log(`  ${String(paare.filter(regel).length).padStart(3)} von ${paare.length}   ${name}`);
  }

  console.log("");
  console.log("Die Paare, sortiert nach spezifischen Merkmalen - zum Nachsehen,");
  console.log("ob eine Nennung ehrlich waere:");
  for (const paar of [...paare].sort((a, b) => b.spezifisch - a.spezifisch).slice(0, 28)) {
    console.log(`  ${paar.spezifisch >= 3 ? "*" : " "} ${String(paar.spezifisch).padStart(2)} spez`
      + ` / ${String(paar.alle).padStart(2)} ges   D ${paar.deckung.toFixed(2)}`
      + `   V ${Number.isFinite(paar.vorsprung) ? paar.vorsprung.toFixed(2) : "inf"}`
      + `   ${paar.titel.slice(0, 30).padEnd(32)} <- ${paar.seed.slice(0, 26).padEnd(28)}`
      + `   ${paar.merkmale.slice(0, 5).join(", ")}`);
  }

  // --- Die Karten im Einzelnen ----------------------------------------------
  console.log("");
  console.log("-".repeat(80));
  console.log(`DIE ERSTEN ${sichtbar.length} KARTEN IM EINZELNEN`);
  console.log("-".repeat(80));
  sichtbar.forEach((eintrag, index) => {
    console.log(kartenBericht(eintrag, index));
    console.log("");
  });
})().catch((fehler) => {
  console.error("Diagnose abgebrochen:", fehler);
  process.exit(1);
});
