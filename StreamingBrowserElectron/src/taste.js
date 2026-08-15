"use strict";

// Der Empfehlungs-Algorithmus fuer "Empfohlen fuer dich".
//
// Grundgedanke: Aus dem, was tatsaechlich geschaut wurde, wird ein
// Geschmacksprofil aus gewichteten Genres gebaut. Frisch Geschautes zaehlt mehr
// als Altes, Durchgeschautes mehr als kurz Angetipptes. Kandidaten werden
// danach bewertet, wie gut sie zu diesem Profil passen - plus einem kraeftigen
// Bonus, wenn der Anbieter den Titel selbst als aehnlich ausweist
// ("Das schauen andere", "Verwandte Filme").
//
// Bewusst ein eigenes Modul ohne HTML und ohne Netz, damit die Bewertung mit
// erfundenen Daten geprueft werden kann.

const HALBWERTSZEIT_TAGE = 30;
const MIN_AKTUALITAET = 0.15;
const AEHNLICH_BONUS = 1.6;
const ANBIETER_BONUS = 0.3;
const NEUHEIT_BONUS = 0.15;
const MIN_PUNKTE = 0.08;

function zahl(value) {
  const wert = Number(value);
  return Number.isFinite(wert) ? wert : 0;
}

// Wie frisch ist der Eintrag? Halbiert sich alle 30 Tage, faellt aber nie auf
// null - auch alte Lieblingsserien sagen noch etwas ueber den Geschmack.
function aktualitaet(entry, now) {
  const zeitpunkt = Date.parse(entry?.lastWatchedAt || entry?.openedAt || entry?.createdAt || "") || 0;
  if (!zeitpunkt) return 0.3;
  const tage = Math.max(0, (now - zeitpunkt) / 86400000);
  return Math.max(MIN_AKTUALITAET, 0.5 ** (tage / HALBWERTSZEIT_TAGE));
}

// Wie intensiv wurde geschaut? Eine abgeschlossene Serie mit vielen Folgen
// wiegt deutlich schwerer als ein Titel, der nur kurz geoeffnet war.
function intensitaet(entry) {
  const dauer = zahl(entry?.duration);
  const stelle = zahl(entry?.position || entry?.currentTime);
  const anteil = dauer > 0 ? stelle / dauer : 0;
  const folgen = Array.isArray(entry?.completedEpisodes) ? entry.completedEpisodes.length : 0;

  let basis = 0.35;
  if (entry?.watched) basis = 0.6;
  if (anteil >= 0.15 || zahl(entry?.progress) >= 15) basis = Math.max(basis, 0.75);
  if (entry?.completed || entry?.episodeCompleted || anteil >= 0.85 || zahl(entry?.progress) >= 85) basis = 1;
  if (entry?.favorite) basis = Math.max(basis, 0.9);
  return basis * (1 + Math.min(folgen, 12) * 0.08);
}

function watchWeight(entry, now = Date.now()) {
  return aktualitaet(entry, now) * intensitaet(entry);
}

// Titel und Adressen so vereinheitlichen, dass derselbe Titel nicht zweimal
// vorgeschlagen wird - und nichts, was schon in der Liste steht.
function urlSchluessel(value) {
  try {
    const url = new URL(String(value || ""));
    const pfad = url.pathname
      .replace(/\/(?:staffel|season)-\d+(?:\/(?:episode|folge)-\d+)?\/?$/i, "")
      .replace(/\/+$/, "");
    return `${url.host}${pfad}`.toLowerCase();
  } catch {
    return String(value || "").trim().toLowerCase();
  }
}

function titelSchluessel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

// Aus den Saatgut-Eintraegen (geschaute Titel samt ihren Genres) wird das
// Profil: welche Genres wie stark, welcher Anbieter wie oft.
function buildTasteProfile(seeds, now = Date.now()) {
  const genres = new Map();
  const anbieter = new Map();
  let gesamt = 0;

  for (const seed of seeds || []) {
    const gewicht = zahl(seed?.weight) || watchWeight(seed?.entry || {}, now);
    if (gewicht <= 0) continue;
    gesamt += gewicht;
    anbieter.set(seed.providerId, (anbieter.get(seed.providerId) || 0) + gewicht);

    // Die Anbieter listen das Hauptgenre zuerst; spaetere Eintraege sind
    // Nebengenres und zaehlen weniger.
    (seed.genres || []).forEach((genre, index) => {
      if (!genre?.key) return;
      const eintrag = genres.get(genre.key) || {
        key: genre.key,
        label: genre.label || genre.key,
        score: 0,
        urls: new Map(),
        titles: []
      };
      eintrag.score += gewicht / (1 + index * 0.35);
      if (genre.url && !eintrag.urls.has(seed.providerId)) eintrag.urls.set(seed.providerId, genre.url);
      if (seed.title && !eintrag.titles.includes(seed.title) && eintrag.titles.length < 3) {
        eintrag.titles.push(seed.title);
      }
      genres.set(genre.key, eintrag);
    });
  }

  const hoechster = Math.max(...[...genres.values()].map((genre) => genre.score), 0);
  if (hoechster > 0) {
    for (const genre of genres.values()) genre.score /= hoechster;
  }
  const sortiert = [...genres.values()].sort((links, rechts) => rechts.score - links.score);

  return {
    genres: sortiert,
    genreScore: (key) => genres.get(key)?.score || 0,
    genreLabel: (key) => genres.get(key)?.label || key,
    providerShare: (id) => (gesamt > 0 ? (anbieter.get(id) || 0) / gesamt : 0),
    seedCount: (seeds || []).length,
    isEmpty: sortiert.length === 0
  };
}

// Wie gut passen die Genres eines Kandidaten zum Profil? Das staerkste Genre
// zaehlt voll, weitere Treffer nur noch anteilig - sonst gewinnen Titel, die
// einfach in sehr vielen Genres stehen.
function genrePassung(keys, profile) {
  const werte = [...new Set(keys || [])]
    .map((key) => ({ key, score: profile.genreScore(key) }))
    .filter((eintrag) => eintrag.score > 0)
    .sort((links, rechts) => rechts.score - links.score);
  let summe = 0;
  werte.forEach((eintrag, index) => {
    summe += eintrag.score / (1 + index * 0.6);
  });
  return { score: summe, treffer: werte };
}

function begruendung(candidate, treffer, profile) {
  if (candidate.via === "related" && candidate.seedTitle) {
    return `Weil du „${candidate.seedTitle}“ geschaut hast`;
  }
  const labels = treffer.slice(0, 2).map((eintrag) => profile.genreLabel(eintrag.key));
  if (labels.length) return `Passt zu ${labels.join(" & ")}`;
  if (candidate.genreLabel) return `Passt zu ${candidate.genreLabel}`;
  return candidate.providerName || "";
}

// Bewertet und mischt die Kandidaten. Am Ende wird reihum durch die Anbieter
// gegangen, damit nicht eine einzige Seite die ganze Reihe fuellt.
function scoreCandidates(candidates, profile, options = {}) {
  const limit = options.limit || 24;
  const proQuelle = options.perSeed || 3;
  const ausschluss = options.exclude || new Set();
  const bewertet = [];
  const gesehen = new Map();

  for (const candidate of candidates || []) {
    if (!candidate?.url || !candidate?.title) continue;
    const schluessel = urlSchluessel(candidate.url);
    const titelkey = titelSchluessel(candidate.title);
    if (ausschluss.has(schluessel) || ausschluss.has(titelkey)) continue;

    const { score: passung, treffer } = genrePassung(candidate.genres, profile);
    // Ohne Genre-Treffer bleibt nur uebrig, was der Anbieter selbst als
    // aehnlich ausweist - alles andere waere geraten.
    if (!treffer.length && candidate.via !== "related") continue;
    let punkte = passung;
    if (candidate.via === "related") punkte += AEHNLICH_BONUS * (zahl(candidate.seedWeight) || 0.5);
    if (candidate.via === "new") punkte += NEUHEIT_BONUS;
    punkte += ANBIETER_BONUS * profile.providerShare(candidate.providerId);
    punkte += zahl(candidate.bonus);
    if (punkte < MIN_PUNKTE) continue;

    // Denselben Titel koennen mehrere Quellen liefern - dann zaehlt die beste,
    // und ein kleiner Aufschlag belohnt die Uebereinstimmung.
    const vorhanden = gesehen.get(schluessel) || gesehen.get(titelkey);
    if (vorhanden) {
      if (punkte > vorhanden.score) {
        vorhanden.score = punkte;
        vorhanden.reason = begruendung(candidate, treffer, profile);
        vorhanden.via = candidate.via;
        vorhanden.seedTitle = candidate.seedTitle || vorhanden.seedTitle;
      }
      vorhanden.score += 0.2;
      continue;
    }

    const eintrag = {
      title: candidate.title,
      url: candidate.url,
      image: candidate.image || "",
      providerId: candidate.providerId,
      providerName: candidate.providerName,
      viaSearch: Boolean(candidate.viaSearch),
      via: candidate.via,
      seedTitle: candidate.seedTitle || "",
      score: punkte,
      reason: begruendung(candidate, treffer, profile)
    };
    bewertet.push(eintrag);
    gesehen.set(schluessel, eintrag);
    if (titelkey) gesehen.set(titelkey, eintrag);
  }

  bewertet.sort((links, rechts) => rechts.score - links.score);

  const proSaat = new Map();
  const nachAnbieter = new Map();
  for (const eintrag of bewertet) {
    if (eintrag.seedTitle) {
      const anzahl = proSaat.get(eintrag.seedTitle) || 0;
      if (anzahl >= proQuelle) continue;
      proSaat.set(eintrag.seedTitle, anzahl + 1);
    }
    const liste = nachAnbieter.get(eintrag.providerId) || [];
    liste.push(eintrag);
    nachAnbieter.set(eintrag.providerId, liste);
  }

  const ergebnis = [];
  const listen = [...nachAnbieter.values()];
  for (let index = 0; ergebnis.length < limit; index += 1) {
    let etwasGefunden = false;
    for (const liste of listen) {
      if (!liste[index]) continue;
      etwasGefunden = true;
      ergebnis.push(liste[index]);
      if (ergebnis.length >= limit) break;
    }
    if (!etwasGefunden) break;
  }
  return ergebnis;
}

module.exports = {
  buildTasteProfile,
  scoreCandidates,
  watchWeight,
  urlSchluessel,
  titelSchluessel
};
