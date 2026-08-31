"use strict";
/*
 * Die Watchlist: ein Werk, ein Eintrag.
 *
 * Gemeldet war dreierlei, und es hing alles an derselben Wurzel - ELFIX hatte
 * keine einheitliche Antwort darauf, welcher Titel ein Eintrag ist:
 *
 *   - "Pokémon · Staffel 1 Folge 16" stand zweimal in der Watchlist.
 *   - Titel liessen sich teilweise nicht entfernen.
 *   - Titel liessen sich teilweise nicht hinzufuegen.
 *
 * Nachgemessen an der echten Ablage vom 31.08.2026: drei private
 * "Pokémon"-Eintraege mit identischer Adresse, identischem Anbieter und
 * identischem Slug, zwei davon vorgemerkt. Entstanden sind sie am
 * Geraeteabgleich, der einen Titel ueber seinen *Titelschluessel* sucht -
 * "Pokémon" ergibt `pokmon`, "Pokemon" ergibt `pokemon`, weil
 * taste.titelSchluessel nur ä, ö, ü und ß faltet und jeden anderen Akzent
 * streicht. Findet er nichts, legt er an.
 *
 * Geprueft wird an Ergebnissen: dieselben Funktionen laufen im Kern der
 * Android-App. Nur die Stellen, die die Regel zwangslaeufig ein zweites Mal
 * aufrufen muessen - Oberflaeche, Hauptprozess, Bestand.java -, werden im
 * Quelltext nachgesehen.
 */

const fs = require("fs");
const path = require("path");
const watchlist = require("../src/watchlist");
const fortschritt = require("../src/fortschritt");

const WURZEL = path.join(__dirname, "..");
const lies = (datei) => fs.readFileSync(path.join(WURZEL, datei), "utf8").split("\r\n").join("\n");

const pruefungen = [];
const pruefe = (name, bedingung, detail) => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

const ANBIETER = { id: "p1", name: "Aniworld", startUrl: "https://aniworld.to/", logo: "AN" };
const ANDERER = { id: "p2", name: "S.to", startUrl: "https://s.to/", logo: "ST" };
const folge = (staffel, nummer) => `https://aniworld.to/anime/stream/pokmon/staffel-${staffel}/episode-${nummer}`;

const merken = (favoriten, url, angaben = {}, anbieter = ANBIETER) =>
  fortschritt.vonHandAnlegen({ favoriten }, anbieter, url, angaben);

/**
 * Ein Neustart der App.
 *
 * <p>Durch JSON und zurueck - alles, was nicht in der Datei steht, ist danach
 * weg - und dann durch die Bereinigung, die loadFavorites beim Laden faehrt.
 * Dass sie dort wirklich laeuft, prueft weiter unten eine eigene Zeile am
 * Quelltext.
 */
function neustart(favoriten) {
  const geladen = JSON.parse(JSON.stringify(favoriten));
  watchlist.doppelteZusammenfuehren(geladen);
  return geladen;
}

/* --- Der kanonische Schluessel ------------------------------------------- */

pruefe("Beide Schreibweisen ergeben denselben Schluessel",
  watchlist.werkSchluessel("Pokémon", folge(1, 1), "serie")
  === watchlist.werkSchluessel("Pokemon", folge(1, 16), "serie"),
  watchlist.werkSchluessel("Pokémon", folge(1, 1), "serie"));
pruefe("Die Folge steht nicht im Schluessel",
  watchlist.werkSchluessel("Pokémon", folge(1, 1), "serie")
  === watchlist.werkSchluessel("Pokémon", folge(4, 22), "serie"),
  "sonst waere jede Folge ein eigener Watchlist-Eintrag");
pruefe("Der Wirt steht nicht im Schluessel",
  watchlist.werkSchluessel("Korra", "http://186.2.175.5/serie/die-legende-von-korra/staffel-4/episode-13", "serie")
  === watchlist.werkSchluessel("Korra", "https://s.to/serie/die-legende-von-korra/staffel-1/episode-1", "serie"),
  "S.to laeuft hier ueber eine IP und dort ueber seine Domain");
pruefe("Verschiedene Serien bleiben verschieden",
  watchlist.werkSchluessel("Bleach", "https://aniworld.to/anime/stream/bleach/staffel-1/episode-1", "serie")
  !== watchlist.werkSchluessel("Naruto", "https://aniworld.to/anime/stream/naruto/staffel-1/episode-1", "serie"));
pruefe("Deutsche Umlaute werden weiter gefaltet, nicht gestrichen",
  watchlist.werkSchluessel("Bär", "") !== watchlist.werkSchluessel("Bar", ""),
  `${watchlist.werkSchluessel("Bär", "")} / ${watchlist.werkSchluessel("Bar", "")}`);
pruefe("Zwei YouTube-Videos ohne Slug fallen nicht zusammen",
  watchlist.werkSchluessel("A", "https://www.youtube.com/watch?v=aaa")
  !== watchlist.werkSchluessel("B", "https://www.youtube.com/watch?v=bbb"),
  "sechs Videos mit leerem Schluessel waeren sonst zu einem geworden");
pruefe("Ohne Titel und ohne Adresse gibt es keinen Schluessel",
  watchlist.werkSchluessel("", "") === "",
  "der Rueckfalltitel \"Favorit\" darf keine Eintraege zusammenziehen");

/* --- Hinzufuegen --------------------------------------------------------- */

{
  const favoriten = [];
  const erst = merken(favoriten, folge(1, 1), { title: "Pokémon", type: "serie" });
  pruefe("Ein Titel laesst sich hinzufuegen",
    Boolean(erst.eintrag) && erst.neu === true && erst.eintrag.favorite === true);
  pruefe("Und steht danach auf der Watchlist",
    watchlist.liste(erst.favoriten).length === 1
    && watchlist.steht(erst.favoriten, erst.eintrag) === true);
}

/* --- Denselben Titel zweimal hinzufuegen --------------------------------- */

{
  const erst = merken([], folge(1, 1), { title: "Pokémon", type: "serie" });
  const nochmal = merken(erst.favoriten, folge(1, 1), { title: "Pokémon", type: "serie" });
  pruefe("Zweimal hinzufuegen legt keinen zweiten Eintrag an",
    nochmal.neu === false && nochmal.favoriten.length === 1,
    `${nochmal.favoriten.length} Eintrag/Eintraege`);
  pruefe("Und meldet, dass er schon dabei war", nochmal.schonDabei === true);
  pruefe("Die Watchlist zeigt ihn einmal", watchlist.liste(nochmal.favoriten).length === 1);
}

/* --- Dieselbe Serie, andere Folge ---------------------------------------- */

{
  const erst = merken([], folge(1, 1), { title: "Pokémon", type: "serie" });
  const spaeter = merken(erst.favoriten, folge(4, 22), { title: "Pokémon", type: "serie" });
  pruefe("Eine andere Folge derselben Serie erzeugt keinen zweiten Eintrag",
    spaeter.neu === false && spaeter.favoriten.length === 1,
    `${spaeter.favoriten.length} Eintrag/Eintraege`);
  pruefe("Die Watchlist bleibt bei einem Eintrag",
    watchlist.liste(spaeter.favoriten).length === 1);

  // Und der Fortschritt darf den Eintrag weitertragen, ohne dass daraus ein
  // zweiter wird - das ist der Kern von "serienbasiert, nicht folgenbasiert".
  const gelaufen = fortschritt.medienStandVerbuchen(
    { favoriten: spaeter.favoriten, aktiverFavoritId: spaeter.eintrag.id },
    ANBIETER, folge(1, 3),
    { currentTime: 400, duration: 1400, watchedSeconds: 400, finalSeason: 4, finalEpisode: 25 });
  pruefe("Fortschritt auf einer anderen Folge bleibt derselbe Eintrag",
    gelaufen.favoriten.length === 1 && gelaufen.eintrag.episode === 3,
    `${gelaufen.favoriten.length} Eintrag/Eintraege, jetzt bei Folge ${gelaufen.eintrag.episode}`);
  pruefe("Und die Watchlist zeigt weiterhin genau einen",
    watchlist.liste(gelaufen.favoriten).length === 1);
}

/* --- Derselbe Titel bei einem anderen Anbieter --------------------------- */

{
  const erst = merken([], folge(1, 1), { title: "Pokémon", type: "serie" });
  const woanders = merken(erst.favoriten,
    "https://s.to/serie/stream/pokmon/staffel-1/episode-1", { title: "Pokémon", type: "serie" }, ANDERER);
  pruefe("Derselbe Titel bei einem anderen Anbieter bleibt ein Eintrag",
    woanders.neu === false && woanders.favoriten.length === 1,
    "fuer die Watchlist ist eine Serie eine Serie");
}

/* --- Entfernen ----------------------------------------------------------- */

{
  const erst = merken([], folge(1, 1), { title: "Pokémon", type: "serie" });
  const urteil = watchlist.entfernen(erst.favoriten, erst.eintrag.id);
  pruefe("Ein Titel laesst sich entfernen", urteil.geaendert === true);
  pruefe("Und ist danach nicht mehr auf der Watchlist",
    watchlist.liste(urteil.favoriten).length === 0
    && watchlist.steht(urteil.favoriten, erst.eintrag) === false);
  pruefe("Der Eintrag selbst bleibt - nur die Merkliste ist er los",
    urteil.favoriten.length === 1 && urteil.favoriten[0].favorite === false,
    "sein Fortschritt und sein Verlauf gehen niemanden verloren");
}

/* --- Entfernen ueber die Kennung eines Raum-Eintrags --------------------- */
//
// Der gemeldete Fehler. Die Oberflaeche zeigte auf der Karte den weitesten
// Stand, und der gehoerte dem Eintrag der Watchparty-Runde. Dessen Kennung kam
// beim Entfernen an - ein Eintrag, der gar nicht auf der Watchlist stand.

{
  const erst = merken([], folge(1, 1), { title: "Pokémon", type: "serie" });
  const raumEintrag = {
    id: "raum-1", title: "Pokémon", url: folge(1, 16), type: "serie",
    watchpartyRoom: "Gummikäse", favorite: false, season: 1, episode: 16
  };
  const favoriten = [raumEintrag, ...erst.favoriten];

  pruefe("Der Raum-Eintrag steht nicht auf der Watchlist",
    watchlist.liste(favoriten).length === 1
    && watchlist.liste(favoriten)[0].id === erst.eintrag.id);

  const urteil = watchlist.entfernen(favoriten, "raum-1");
  pruefe("Entfernen ueber die Kennung des Raum-Eintrags trifft trotzdem",
    urteil.geaendert === true && watchlist.liste(urteil.favoriten).length === 0,
    "vorher lief das ins Leere und die Karte blieb stehen");
  pruefe("Der Raum-Eintrag selbst bleibt bestehen",
    urteil.favoriten.some((eintrag) => eintrag.id === "raum-1"),
    "er gehoert der Runde, nicht der Merkliste");
}

/* --- Umschalten ---------------------------------------------------------- */

{
  const erst = merken([], folge(1, 1), { title: "Pokémon", type: "serie" });
  const ab = watchlist.umschalten(erst.favoriten, { title: "Pokemon", url: folge(3, 7), type: "serie" });
  pruefe("Der Herz-Knopf findet den Titel ueber die Adresse",
    ab.gefunden === true && ab.vorgemerkt === false,
    "auch bei anderer Schreibweise und anderer Folge");
  const an = watchlist.umschalten(ab.favoriten, { title: "Pokémon", url: folge(1, 1), type: "serie" });
  pruefe("Und legt ihn genauso wieder auf", an.vorgemerkt === true && an.gefunden === true);
  pruefe("Ohne vorhandenen Eintrag meldet er das",
    watchlist.umschalten([], { title: "Naruto", url: "https://aniworld.to/anime/stream/naruto", type: "serie" }).gefunden === false,
    "dann ist vonHandAnlegen zustaendig");
}

/* --- Neustart ------------------------------------------------------------ */

{
  const erst = merken([], folge(1, 1), { title: "Pokémon", type: "serie" });
  const nachher = neustart(erst.favoriten);
  pruefe("Hinzugefuegt, Neustart, immer noch da",
    watchlist.liste(nachher).length === 1
    && watchlist.liste(nachher)[0].title === "Pokémon");

  const weg = watchlist.entfernen(erst.favoriten, erst.eintrag.id);
  const danach = neustart(weg.favoriten);
  pruefe("Entfernt, Neustart, immer noch weg",
    watchlist.liste(danach).length === 0);
  pruefe("Und kommt auch nicht ueber die Bereinigung zurueck",
    danach.length === 1 && danach[0].favorite === false);
}

/* --- Bestehende Doppelte zusammenfuehren --------------------------------- */

{
  // Genau der Zustand aus der echten Ablage: drei private Eintraege desselben
  // Werks, zwei davon vorgemerkt, mit verteiltem Verlauf.
  const favoriten = [
    { id: "a", title: "Pokémon", url: folge(1, 12), type: "serie", watchpartyRoom: "",
      favorite: false, completed: false, season: 1, episode: 12, createdAt: "2026-08-28T20:41:56.774Z",
      activity: [{ at: "2026-08-28T21:00:00.000Z", url: folge(1, 12), label: "Staffel 1 Folge 12" }],
      completedEpisodes: [{ key: "k:s1:e11" }, { key: "k:s1:e12" }], finalSeason: 1, finalEpisode: 25 },
    { id: "b", title: "Pokémon", url: folge(1, 1), type: "serie", watchpartyRoom: "",
      favorite: true, completed: false, season: 1, episode: 1, createdAt: "2026-08-16T10:52:23.643Z",
      activity: [{ at: "2026-08-20T10:00:00.000Z", url: folge(1, 1), label: "Staffel 1 Folge 1" }],
      completedEpisodes: [], customThumbnail: "data:image/png;base64,AAA", libraryOrder: 3 },
    { id: "c", title: "Pokemon", url: folge(1, 1), type: "serie", watchpartyRoom: "",
      favorite: true, completed: false, season: 1, episode: 1, createdAt: "2026-08-14T16:46:38.233Z",
      activity: [], completedEpisodes: [] },
    { id: "raum", title: "Pokémon", url: folge(1, 16), type: "serie", watchpartyRoom: "Gummikäse",
      favorite: false, completed: false, season: 1, episode: 16, createdAt: "2026-08-29T04:59:06.988Z" },
    { id: "fremd", title: "Bleach", url: "https://aniworld.to/anime/stream/bleach/staffel-1/episode-1",
      type: "serie", watchpartyRoom: "", favorite: true, completed: false, createdAt: "2026-08-01T00:00:00.000Z" }
  ];

  const urteil = watchlist.doppelteZusammenfuehren(favoriten);
  pruefe("Die drei Pokémon-Eintraege werden zu einem",
    urteil.zusammengefuehrt === 2 && favoriten.filter((e) => e.title.startsWith("Pok")).length === 2,
    `${urteil.zusammengefuehrt} entfernt`);
  const leit = favoriten.find((eintrag) => eintrag.watchpartyRoom === "" && /^Pok/.test(eintrag.title));
  pruefe("Der weiteste Stand gibt den Zustand vor",
    leit.id === "a" && leit.episode === 12,
    `behalten: ${leit.id} bei Folge ${leit.episode}`);
  pruefe("Vorgemerkt bleibt vorgemerkt", leit.favorite === true,
    "aus einem \"steht drauf\" und einem \"steht nicht\" folgt kein Herunternehmen");
  pruefe("Der Verlauf beider Eintraege geht mit",
    leit.activity.length === 2,
    `${leit.activity.length} Ereignisse`);
  pruefe("Die abgeschlossenen Folgen gehen mit", leit.completedEpisodes.length === 2);
  pruefe("Das eigene Bild geht mit", leit.customThumbnail === "data:image/png;base64,AAA");
  pruefe("Die gelegte Stelle der Mediathek geht mit", leit.libraryOrder === 3);
  pruefe("Die Serienlaenge geht mit", leit.finalSeason === 1 && leit.finalEpisode === 25);
  pruefe("Das aelteste Anlegedatum gewinnt", leit.createdAt === "2026-08-14T16:46:38.233Z",
    leit.createdAt);
  pruefe("Der Raum-Eintrag bleibt unberuehrt",
    favoriten.some((eintrag) => eintrag.id === "raum"),
    "er ist ein eigener Stand und kein Doppel");
  pruefe("Ein fremder Titel wird nicht angefasst",
    favoriten.some((eintrag) => eintrag.id === "fremd"));
  pruefe("Danach zeigt die Watchlist zwei Titel",
    watchlist.liste(favoriten).length === 2);
  pruefe("Und ein zweiter Durchlauf aendert nichts mehr",
    watchlist.doppelteZusammenfuehren(favoriten).zusammengefuehrt === 0);
}

/* --- Von Hand abgehakt ueberlebt das Zusammenfuehren --------------------- */

{
  const favoriten = [
    { id: "a", title: "Korra", url: "https://s.to/serie/die-legende-von-korra/staffel-4/episode-13",
      type: "serie", watchpartyRoom: "", favorite: false, completed: true, season: 4, episode: 13,
      createdAt: "2026-08-16T17:14:46.972Z", activity: [], completedEpisodes: [] },
    { id: "b", title: "Die Legende von Korra", url: "http://186.2.175.5/serie/die-legende-von-korra/staffel-3/episode-1",
      type: "serie", watchpartyRoom: "", favorite: false, completed: true, completedManually: true,
      season: 3, episode: 1, createdAt: "2026-08-14T10:49:22.789Z", activity: [], completedEpisodes: [] }
  ];
  watchlist.doppelteZusammenfuehren(favoriten);
  pruefe("Zwei Wirte desselben Anbieters werden zusammengefuehrt", favoriten.length === 1);
  pruefe("Von Hand abgehakt ueberlebt",
    favoriten[0].completedManually === true && favoriten[0].completed === true);
  pruefe("Und der Titel steht damit nicht auf der Watchlist",
    favoriten[0].favorite === false && watchlist.liste(favoriten).length === 0);
}

/* --- Ein Eintrag ohne Schluessel wird nie verschmolzen ------------------- */

{
  const favoriten = [
    { id: "a", title: "", url: "", type: "", watchpartyRoom: "", favorite: true, createdAt: "1" },
    { id: "b", title: "", url: "", type: "", watchpartyRoom: "", favorite: true, createdAt: "2" }
  ];
  const urteil = watchlist.doppelteZusammenfuehren(favoriten);
  pruefe("Ohne Schluessel wird nichts zusammengelegt",
    urteil.zusammengefuehrt === 0 && favoriten.length === 2,
    "lieber ein Eintrag zu viel als zwei verschmolzene, die nichts gemein haben");
}

/* --- Der Abgleich legt keine Doppelten mehr an --------------------------- */

{
  const geraeteStand = require("../src/geraete-stand");
  const lokal = [{
    id: "lokal", title: "Pokémon", url: folge(1, 1), type: "serie", watchpartyRoom: ""
  }];
  // Das andere Geraet meldet denselben Titel ohne Akzent - und damit unter
  // einem anderen Titelschluessel. Genau daran sind die Doppelten entstanden.
  const vomHandy = { key: "serie:pokemon", title: "Pokemon", url: folge(1, 5), type: "serie" };
  pruefe("Der alte Schluessel geht daneben",
    geraeteStand.titelSchluessel(lokal[0]) !== vomHandy.key,
    `${geraeteStand.titelSchluessel(lokal[0])} != ${vomHandy.key}`);
  pruefe("Ohne den Stand findet die Suche nichts",
    geraeteStand.eintragFinden(lokal, vomHandy.key) === null,
    "so entstand der zweite Eintrag");
  pruefe("Mit dem Stand findet sie den vorhandenen Eintrag",
    geraeteStand.eintragFinden(lokal, vomHandy.key, vomHandy)?.id === "lokal",
    "die Adresse im Stand traegt den kanonischen Schluessel");
  pruefe("Der Schluessel auf der Leitung bleibt unveraendert",
    geraeteStand.titelSchluessel(lokal[0]) === "serie:pokmon",
    "an ihm haengt der Raumschluessel der Watchparty");
}

/* --- Eine Identitaet, nicht vier ----------------------------------------- */

{
  const RENDERER = lies("src/renderer/renderer.js");
  const MAIN = lies("src/main.js");
  const PRELOAD = lies("src/preload.js");
  const BESTAND = fs.readFileSync(path.join(WURZEL, "..", "android", "app", "src", "main", "java",
    "local", "elflix", "android", "Bestand.java"), "utf8");
  const ACTIVITY = fs.readFileSync(path.join(WURZEL, "..", "android", "app", "src", "main", "java",
    "local", "elflix", "android", "MainActivity.java"), "utf8");
  const GRADLE = fs.readFileSync(path.join(WURZEL, "..", "android", "app", "build.gradle"), "utf8");

  pruefe("Die Oberflaeche rechnet den Schluessel nicht selbst aus",
    /api\.werkSchluessel\?\.\(/.test(RENDERER)
    && !/function werkSchluessel\(titel/.test(RENDERER),
    "sie fragt ueber die Bruecke dieselbe Funktion");
  pruefe("Die Bruecke reicht genau diese Funktion durch",
    /werkSchluessel: \(titel, url, art\) => watchlist\.werkSchluessel\(titel, url, art\)/.test(PRELOAD));
  pruefe("Die Watchlist der Oberflaeche haelt je Werk eine Karte",
    /function favoriteEntries\(\)[\s\S]{0,1200}?nachWerk\.set\(schluessel, item\)/.test(RENDERER));
  pruefe("Die Karte behaelt die Kennung ihres eigenen Eintrags",
    /oeffnenId: bester\.id/.test(RENDERER)
    && /api\.openFavorite\(favorite\.oeffnenId \|\| favorite\.id/.test(RENDERER),
    "gehandelt wird auf dem Watchlist-Eintrag, geoeffnet der weiteste Stand");
  pruefe("Die Oberflaeche hat keinen eigenen Serienvergleich mehr",
    !/function istGleicheSerieLokal\(/.test(RENDERER)
    && /const schluessel = werkSchluessel\(favorite\);/.test(RENDERER),
    "auch der weiteste Stand gruppiert jetzt ueber den kanonischen Schluessel");
  pruefe("Der Herz-Knopf fragt nach dem Werk, nicht nach der Adresse",
    /function renderFavoriteToggle\(\)[\s\S]{0,700}?werkSchluessel\(favorite\) === offen/.test(RENDERER));

  pruefe("Der Hauptprozess entfernt ueber die zentrale Regel",
    /ipcMain\.handle\("favorites:remove"[\s\S]{0,1400}?watchlist\.entfernen\(favorites, kennung\)/.test(MAIN));
  pruefe("Und merkt ueber dieselbe vor",
    /ipcMain\.handle\("favorites:set-watchlist"[\s\S]{0,900}?watchlist\.aufnehmen\(favorites, kennung\)/.test(MAIN));
  pruefe("Die Bereinigung laeuft beim Laden",
    /function loadFavorites\(\)[\s\S]{0,6000}?watchlist\.doppelteZusammenfuehren\(geladen\)/.test(MAIN));

  pruefe("Android fuehrt mit derselben Regel zusammen",
    /kern\.rufe\("watchlist\.doppelteZusammenfuehren"/.test(BESTAND));
  pruefe("Und schaltet die Watchlist mit derselben um",
    /kern\.rufe\("watchlist\.umschalten"/.test(BESTAND));
  pruefe("Der Herz-Knopf des Telefons fragt nicht mehr den aktiven Eintrag",
    /bestand\.watchlistUmschalten\(url, titel/.test(ACTIVITY)
    && !/Favorite vorhanden = bestand\.mitId\(bestand\.aktiverEintragId\(\)\);\s*\n\s*if \(vorhanden != null && vorhanden\.istWatchlist/.test(ACTIVITY));
  pruefe("Die Watchlist des Telefons laesst Raum-Eintraege draussen",
    /public List<Favorite> watchlist\(\)[\s\S]{0,400}?watchpartyRaum\(\)\.isEmpty\(\)\) continue;/.test(BESTAND));
  pruefe("Das Modul liegt im Kern der Android-App",
    /"src\/watchlist\.js"/.test(GRADLE),
    "sonst faende der Kern es nicht");
  pruefe("Android baut den Schluessel nirgends selbst nach",
    !/werkSchluessel/.test(BESTAND) && !/werkSchluessel/.test(ACTIVITY),
    "die Identitaet kommt ausschliesslich aus dem Kern");
}

const fehler = pruefungen.filter((x) => !x).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
