"use strict";
// Spiegelt die Auswahl des weitesten Stands aus der Watchlist.
function normalisierterTitel(wert) {
  return String(wert || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function basisTitel(wert) {
  return String(wert || "").replace(/\s*[·|-]?\s*staffel\s*\d+.*$/i, "").trim();
}
function istGleicheSerieLokal(links, rechts) {
  const schluessel = (wert) => {
    try {
      const adresse = new URL(String(wert || ""));
      const pfad = adresse.pathname
        .replace(/\/(?:staffel|season)-\d+(?:\/(?:episode|folge)-\d+)?\/?$/i, "")
        .replace(/\/+$/, "");
      return `${adresse.host}${pfad}`.toLowerCase();
    } catch { return ""; }
  };
  const a = schluessel(links?.url); const b = schluessel(rechts?.url);
  if (a && b) return a === b;
  return normalisierterTitel(basisTitel(links?.title)) === normalisierterTitel(basisTitel(rechts?.title));
}
function folgeVergleich(links, rechts) {
  const sL = Number(links?.season || 0), sR = Number(rechts?.season || 0);
  if (sL !== sR) return sL - sR;
  const fL = Number(links?.episode || 0), fR = Number(rechts?.episode || 0);
  if (fL !== fR) return fL - fR;
  return Number(links?.position || 0) - Number(rechts?.position || 0);
}
let favorites = [];
function weitesterStand(favorite) {
  const gruppe = favorites.filter((a) => a.id === favorite.id || (!a.completed && istGleicheSerieLokal(a, favorite)));
  if (gruppe.length < 2) return favorite;
  return gruppe.reduce((bester, k) => (folgeVergleich(k, bester) > 0 ? k : bester), favorite);
}

const u = (serie, st, fo) => `https://aniworld.to/anime/stream/${serie}/staffel-${st}/episode-${fo}`;
const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(b); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };

// Der Fall aus dem Screenshot: privat Folge 1, Runde Folge 3.
favorites = [
  { id: "1", title: "Black Torch", url: u("black-torch",1,1), season: 1, episode: 1, watchpartyRoom: "" },
  { id: "2", title: "Black Torch", url: u("black-torch",1,3), season: 1, episode: 3, watchpartyRoom: "Bangus" },
  { id: "3", title: "Bleach", url: u("bleach",1,1), season: 1, episode: 1, watchpartyRoom: "" },
  { id: "4", title: "Bleach", url: u("bleach",3,14), season: 3, episode: 14, watchpartyRoom: "Bangus" },
  { id: "5", title: "Pokémon", url: u("pokemon",1,1), season: 1, episode: 1, watchpartyRoom: "" },
  { id: "6", title: "Attack On Titan", url: u("aot",3,10), season: 3, episode: 10, watchpartyRoom: "" },
  { id: "7", title: "Naruto", url: u("naruto",1,5), season: 1, episode: 5, watchpartyRoom: "", completed: true },
  { id: "8", title: "Naruto", url: u("naruto",1,2), season: 1, episode: 2, watchpartyRoom: "" }
];
const w = (id) => weitesterStand(favorites.find((f) => f.id === id));

pruefe("Runde ist weiter: Folge 3 statt 1", w("1").id === "2", `Folge ${w("1").episode}`);
pruefe("Hoehere Staffel schlaegt hoehere Folge", w("3").id === "4", `S${w("3").season}E${w("3").episode}`);
pruefe("Ohne zweiten Eintrag bleibt alles", w("5").id === "5", `Folge ${w("5").episode}`);
pruefe("Andere Serien werden nicht vermischt", w("6").id === "6", w("6").title);
pruefe("Abgeschlossene zaehlen nicht mit", w("8").id === "8", `Folge ${w("8").episode}`);

// Gleiche Folge, weitere Stelle
favorites = [
  { id: "a", title: "X", url: u("x",1,2), season: 1, episode: 2, position: 100, watchpartyRoom: "" },
  { id: "b", title: "X", url: u("x",1,2), season: 1, episode: 2, position: 900, watchpartyRoom: "R" }
];
pruefe("Bei gleicher Folge zaehlt die weitere Stelle",
  weitesterStand(favorites[0]).id === "b", `position=${weitesterStand(favorites[0]).position}`);

// Titel ohne brauchbare Adresse
favorites = [
  { id: "c", title: "Bleach · Staffel 1 Folge 1", url: "", season: 1, episode: 1, watchpartyRoom: "" },
  { id: "d", title: "Bleach · Staffel 3 Folge 14", url: "", season: 3, episode: 14, watchpartyRoom: "R" }
];
pruefe("Ohne Adresse entscheidet der bereinigte Titel",
  weitesterStand(favorites[0]).id === "d", `S${weitesterStand(favorites[0]).season}`);

const fehler = pruefungen.filter((x) => !x).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
