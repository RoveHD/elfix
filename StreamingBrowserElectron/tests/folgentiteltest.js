"use strict";
// Was beim Wechsel zur naechsten Folge gleich bleiben muss - und was nicht.
//
// Gemeldet war: bei Attack on Titan standen nach dem Wechsel die Metadaten von
// "Young Ladies Don't Play Fighting Games" auf der Karte - Titel, Beschreibung,
// Genres. Das Titelbild blieb dabei das von Attack on Titan, was den Fall so
// verwirrend machte: die Karte zeigte zwei Serien gleichzeitig.
//
// In den echten Daten aus %APPDATA%\ELFIX sah das so aus:
//
//   url:          .../attack-on-titan/staffel-3/episode-20
//   thumbnail:    .../attack-on-titan-stream-cover-...
//   title:        "Young Ladies Don't Play Fighting Games"
//   finalSeason:  1     (Attack on Titan hat vier)
//   finalEpisode: 7
//
// Titel und Serienlaenge gehoerten der fremden Serie, Adresse und Bild der
// richtigen. Genau diese Mischung entsteht, wenn Adresse und Seitenangaben aus
// zwei verschiedenen Navigationen stammen.

const fortschritt = require("../src/fortschritt");
const metadaten = require("../src/metadaten");

const pruefungen = [];
const pruefe = (name, bedingung, detail = "") => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

const ANBIETER = { id: "aniworld", name: "Aniworld", startUrl: "https://aniworld.to/", logo: "AN" };
const AOT1 = "https://aniworld.to/anime/stream/attack-on-titan/staffel-1/episode-1";
const AOT2 = "https://aniworld.to/anime/stream/attack-on-titan/staffel-1/episode-2";
const FREMD = "https://aniworld.to/anime/stream/young-ladies-dont-play-fighting-games/staffel-1/episode-2";
const FREMD1 = "https://aniworld.to/anime/stream/young-ladies-dont-play-fighting-games/staffel-1/episode-1";

const eintrag = {
  id: "aot",
  providerId: ANBIETER.id,
  providerName: ANBIETER.name,
  title: "Attack on Titan",
  url: AOT1,
  normalizedUrl: fortschritt.normalizeFavoriteUrl(AOT1),
  type: "serie",
  season: 1,
  episode: 1,
  progress: 80,
  currentTime: 1200,
  position: 1200,
  duration: 1400,
  favorite: true,
  watched: true,
  completed: false,
  episodeCompleted: false,
  continuePending: false,
  completedEpisodes: [],
  activity: [],
  finalSeason: 4,
  finalEpisode: 30,
  hideFromContinueWatching: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastWatchedAt: "2026-01-01T00:00:00.000Z"
};

// ---------------------------------------------------------------------------
// (1) und (2) Die Serie bleibt, Staffel und Folge ruecken weiter
// ---------------------------------------------------------------------------

const ergebnis = fortschritt.medienStandVerbuchen(
  { favoriten: [eintrag], aktiverFavoritId: "aot", watchpartyFuehrt: false },
  ANBIETER,
  AOT1,
  {
    title: "Young Ladies Don't Play Fighting Games - Folge 2",
    currentTime: 1330,
    duration: 1400,
    watchedSeconds: 900,
    finalSeason: 4,
    finalEpisode: 30,
    nextUrl: FREMD
  }
);

pruefe("Die fremde naechste Folge wird nicht uebernommen", ergebnis.eintrag?.url === AOT2, ergebnis.eintrag?.url);
pruefe("Der Serientitel bleibt erhalten", ergebnis.eintrag?.title === "Attack on Titan", ergebnis.eintrag?.title);
pruefe("Der Eintrag steht offen auf der naechsten Folge",
  ergebnis.eintrag?.continuePending === true
  && ergebnis.eintrag?.progress === 0
  && ergebnis.eintrag?.season === 1
  && ergebnis.eintrag?.episode === 2,
  `S${ergebnis.eintrag?.season}E${ergebnis.eintrag?.episode}, ${ergebnis.eintrag?.progress}%`);

// ---------------------------------------------------------------------------
// (3) Die Adresse ist die Identitaet, nicht der Seitentext
// ---------------------------------------------------------------------------
//
// episodeIdentity() kann das auch - aber nur mit Folgennummer. Der
// Staffeluebersicht und der Serienseite fehlt die, und sie sind trotzdem
// dieselbe Serie. Fuer die Frage "gehoert das zusammen?" ist die Folgennummer
// die falsche Huerde.

const AOT_STAFFEL = "https://aniworld.to/anime/stream/attack-on-titan/staffel-3";
const AOT_SERIE = "https://aniworld.to/anime/stream/attack-on-titan";
const AOT_S3E20 = "https://aniworld.to/anime/stream/attack-on-titan/staffel-3/episode-20";
const AOT_S3E21 = "https://aniworld.to/anime/stream/attack-on-titan/staffel-3/episode-21";
const STO_AOT = "https://s.to/serie/stream/attack-on-titan/staffel-1/episode-1";

const kennung = fortschritt.serienKennungAusUrl;

pruefe("Eine Folgenadresse wird auf die Serie normalisiert",
  kennung(AOT_S3E21) === "aniworld.to:attack-on-titan", kennung(AOT_S3E21));
pruefe("Die Staffeladresse ergibt dieselbe Kennung",
  kennung(AOT_STAFFEL) === kennung(AOT_S3E21), kennung(AOT_STAFFEL));
pruefe("Die Serienseite ergibt dieselbe Kennung",
  kennung(AOT_SERIE) === kennung(AOT_S3E21), kennung(AOT_SERIE));
pruefe("www, Anhaengsel und Sprungmarke aendern nichts",
  kennung("https://www.aniworld.to/anime/stream/attack-on-titan/staffel-3/episode-21?ref=x#top") === kennung(AOT_S3E21));
pruefe("Eine fremde Serie bekommt eine andere Kennung",
  kennung(FREMD) !== kennung(AOT_S3E21), kennung(FREMD));
pruefe("Derselbe Slug bei einem anderen Anbieter ist eine andere Kennung",
  kennung(STO_AOT) !== kennung(AOT_S3E21), `${kennung(STO_AOT)} gegen ${kennung(AOT_S3E21)}`);

// Eine Folgenueberschrift taugt nicht als Serientitel: sie waere beim naechsten
// Wechsel schon wieder falsch, und die Adresse weiss es besser.
const ausUeberschrift = fortschritt.serienTitel("Episode 21 Staffel 3 von Attack on Titan | AniWorld.to", AOT_S3E21, "Aniworld");
pruefe("Eine Folgenueberschrift wird auf den Serientitel zurueckgefuehrt",
  ausUeberschrift === "Attack On Titan", ausUeberschrift);
pruefe("Mit Staffelangabe am Ende ebenso",
  fortschritt.serienTitel("Attack on Titan Staffel 3 Folge 21", AOT_S3E21, "Aniworld") === "Attack on Titan");
pruefe("Ohne Seitentitel entscheidet die Adresse und nicht der letzte Pfadteil",
  fortschritt.serienTitel("", AOT_S3E21, "Aniworld") === "Attack On Titan",
  fortschritt.serienTitel("", AOT_S3E21, "Aniworld"));
pruefe("Ein echter Serientitel bleibt unangetastet",
  fortschritt.serienTitel("Young Ladies Don't Play Fighting Games", FREMD, "Aniworld")
    === "Young Ladies Don't Play Fighting Games");

// ---------------------------------------------------------------------------
// (4) Ein verspaetetes Ergebnis der vorigen Navigation
// ---------------------------------------------------------------------------
//
// So ist der Fehler wirklich entstanden. syncViewMediaProgress() merkt sich die
// Adresse ganz oben und schickt das Seitenskript erst ein Dutzend Awaits
// spaeter los - Watchparty-Steuerung, Chat, Bildstufe, Autoplay und Marke
// liegen dazwischen. Wechselt die Folge in diesem Fenster, liest das Skript die
// *neue* Seite, waehrend der Aufrufer noch die *alte* Adresse haelt.
//
// Der Stempel `seiteUrl` macht den Unterschied sichtbar: ohne ihn ist ein
// verspaetetes Ergebnis von einem richtigen nicht zu unterscheiden.

const spaetesErgebnis = {
  seiteUrl: FREMD1,
  title: "Young Ladies Don't Play Fighting Games",
  type: "serie",
  thumbnail: "https://aniworld.to/public/img/cover/young-ladies-dont-play-fighting-games.png",
  finalSeason: 1,
  finalEpisode: 7
};

const gefiltert = fortschritt.gepruefteSeitendaten(spaetesErgebnis, AOT_S3E20);
pruefe("Der Titel der fremden Seite faellt heraus", gefiltert.title === undefined, String(gefiltert.title));
pruefe("Ihr Titelbild faellt heraus", gefiltert.thumbnail === undefined, String(gefiltert.thumbnail));
pruefe("Ihre Serienlaenge faellt heraus",
  gefiltert.finalSeason === undefined && gefiltert.finalEpisode === undefined,
  `${gefiltert.finalSeason}/${gefiltert.finalEpisode}`);
pruefe("Was nicht zur Identitaet gehoert, bleibt stehen", gefiltert.type === "serie", String(gefiltert.type));

// Und dieselben Angaben von der *eigenen* Seite gehen unveraendert durch. Ohne
// diese Probe waere "nichts kommt mehr an" ein bestandener Test.
const durchgelassen = fortschritt.gepruefteSeitendaten(
  { ...spaetesErgebnis, seiteUrl: AOT_S3E20, title: "Attack on Titan", finalSeason: 4, finalEpisode: 28 },
  AOT_S3E20
);
pruefe("Die eigene Seite kommt vollstaendig durch",
  durchgelassen.title === "Attack on Titan" && durchgelassen.finalSeason === 4 && durchgelassen.finalEpisode === 28);
pruefe("Auch von der Staffeluebersicht derselben Serie",
  fortschritt.gepruefteSeitendaten({ seiteUrl: AOT_STAFFEL, title: "Attack on Titan" }, AOT_S3E20).title === "Attack on Titan");
pruefe("Ein Ergebnis ohne Stempel gilt weiter - da ist nichts zu widerlegen",
  fortschritt.gepruefteSeitendaten({ title: "Attack on Titan" }, AOT_S3E20).title === "Attack on Titan");

// Der ganze Weg, wie main.js ihn geht: erst filtern, dann verbuchen.
const bestand = () => ({
  ...eintrag,
  id: "aot2",
  url: AOT_S3E20,
  normalizedUrl: fortschritt.normalizeFavoriteUrl(AOT_S3E20),
  thumbnail: "https://aniworld.to/public/img/cover/attack-on-titan.png",
  season: 3,
  episode: 20,
  finalSeason: 4,
  finalEpisode: 28
});
const takt = (meta) => fortschritt.medienStandVerbuchen(
  { favoriten: [bestand()], aktiverFavoritId: "aot2", watchpartyFuehrt: false },
  ANBIETER,
  AOT_S3E20,
  { ...meta, currentTime: 1330, duration: 1400, watchedSeconds: 900 }
);

const nachSpaetem = takt(gefiltert);
pruefe("Der Eintrag behaelt seinen Titel", nachSpaetem.eintrag?.title === "Attack on Titan", nachSpaetem.eintrag?.title);
pruefe("Er behaelt seine Serienlaenge",
  nachSpaetem.eintrag?.finalSeason === 4 && nachSpaetem.eintrag?.finalEpisode === 28,
  `S${nachSpaetem.eintrag?.finalSeason} E${nachSpaetem.eintrag?.finalEpisode}`);
pruefe("Er behaelt sein Titelbild",
  !String(nachSpaetem.eintrag?.thumbnail || "").includes("young-ladies"), nachSpaetem.eintrag?.thumbnail);

// Zum Vergleich dieselben Takte ohne den Riegel. Ohne diese Gegenprobe
// bestaetigt der Test bloss, dass nichts passiert - nicht, dass etwas
// verhindert wurde.
//
// Der Schaden nimmt zwei Wege, und beide stehen in den echten Daten:
//
//   a) Gibt es noch keinen Eintrag, wird einer *angelegt* - mit der Adresse der
//      alten Folge und dem Titel der neuen Seite. Genau so kam der Eintrag mit
//      der Adresse von Attack on Titan zu seinem fremden Titel.
//   b) Gibt es schon einen, bleibt der Titel stehen, aber die Serienlaenge
//      wandert mit - solange sie waechst. Der Eintrag der fremden Serie trug
//      deshalb finalSeason 32: die Staffelzahl von Pokemon.

const neuAngelegt = (meta) => fortschritt.medienStandVerbuchen(
  { favoriten: [], aktiverFavoritId: "", watchpartyFuehrt: false },
  ANBIETER,
  AOT_S3E20,
  { ...meta, currentTime: 1330, duration: 1400, watchedSeconds: 900 }
);

const ohneRiegelNeu = neuAngelegt(spaetesErgebnis);
pruefe("(a) Ohne den Riegel entstuende der Eintrag unter fremdem Titel",
  ohneRiegelNeu.eintrag?.title === "Young Ladies Don't Play Fighting Games", ohneRiegelNeu.eintrag?.title);
const mitRiegelNeu = neuAngelegt(gefiltert);
pruefe("(a) Mit dem Riegel bekommt er den Titel seiner eigenen Adresse",
  mitRiegelNeu.eintrag?.title === "Attack On Titan", mitRiegelNeu.eintrag?.title);
pruefe("(a) und die Adresse stimmt ohnehin",
  fortschritt.serienKennungAusUrl(mitRiegelNeu.eintrag?.url) === "aniworld.to:attack-on-titan",
  mitRiegelNeu.eintrag?.url);

// Eine *groessere* Serienlaenge wird uebernommen - eine kleinere gilt als halb
// geladene Seite. Deshalb hier die Zahlen von Pokemon und nicht die der
// kurzen Serie: nur so ist der Weg ueberhaupt offen.
const vonPokemon = { seiteUrl: "https://aniworld.to/anime/stream/pokmon/staffel-1/episode-11", finalSeason: 32, finalEpisode: 44 };
const ohneRiegelAlt = takt(vonPokemon);
pruefe("(b) Ohne den Riegel zoege die fremde Serienlaenge in den Eintrag ein",
  ohneRiegelAlt.eintrag?.finalSeason === 32 && ohneRiegelAlt.eintrag?.finalEpisode === 44,
  `S${ohneRiegelAlt.eintrag?.finalSeason} E${ohneRiegelAlt.eintrag?.finalEpisode}`);
const mitRiegelAlt = takt(fortschritt.gepruefteSeitendaten(vonPokemon, AOT_S3E20));
pruefe("(b) Mit dem Riegel bleibt es bei der eigenen",
  mitRiegelAlt.eintrag?.finalSeason === 4 && mitRiegelAlt.eintrag?.finalEpisode === 28,
  `S${mitRiegelAlt.eintrag?.finalSeason} E${mitRiegelAlt.eintrag?.finalEpisode}`);

const ohneRiegel = ohneRiegelNeu;

// ---------------------------------------------------------------------------
// (5) Zwei Serien, zwei Cache-Eintraege
// ---------------------------------------------------------------------------
//
// Im echten Metadaten-Cache stand dieser Eintrag:
//
//   anime|young ladies dont play fighting games|2013|tt2560140
//
// Jahr und IMDB-Kennung gehoeren Attack on Titan. Sie stammen aus dem
// Seiten-Cache, der nach der kanonischen Serienadresse abgelegt ist und
// deshalb stimmte. Falsch war allein der Titel - und der kam aus dem
// verdorbenen Eintrag. Herausgekommen ist ein Eintrag, der zu keiner der
// beiden Serien gehoert, mit Konfidenz UNMATCHED: einer, der auch nie wieder
// etwas nachliefert.

const seitenAoT = { jahr: 2013, imdb: "tt2560140", altTitel: ["Shingeki no Kyojin"] };
const seitenFremd = { jahr: 2026, imdb: "tt37015024", altTitel: ["GGWP"] };
const MISCHLING = "anime|young ladies dont play fighting games|2013|tt2560140";

const wunschAoT = metadaten.wunschBauen({ art: "anime", titel: nachSpaetem.eintrag?.title, ...seitenAoT });
const wunschFremd = metadaten.wunschBauen({ art: "anime", titel: "Young Ladies Don't Play Fighting Games", ...seitenFremd });

pruefe("Der Wunsch der Serie traegt ihren eigenen Titel",
  wunschAoT.schluessel === "anime|attack on titan|2013|tt2560140", wunschAoT.schluessel);
pruefe("Die fremde Serie bekommt einen eigenen Schluessel",
  wunschFremd.schluessel !== wunschAoT.schluessel, wunschFremd.schluessel);
pruefe("Kein Mischling aus fremdem Titel und eigener Kennung",
  wunschAoT.schluessel !== MISCHLING, wunschAoT.schluessel);

// Und der Weg dorthin: genau der verdorbene Titel erzeugt den Mischling wieder.
// Das ist der Beleg, dass der Cache-Eintrag eine Folge des Titels war und
// nicht seine Ursache.
const mischling = metadaten.wunschBauen({ art: "anime", titel: ohneRiegel.eintrag?.title || "x", ...seitenAoT });
pruefe("Aus dem verdorbenen Titel entstuende er sofort wieder",
  ohneRiegel.eintrag?.title === "Attack on Titan" || mischling.schluessel === MISCHLING,
  mischling.schluessel);

const fehler = pruefungen.filter((wert) => !wert).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
