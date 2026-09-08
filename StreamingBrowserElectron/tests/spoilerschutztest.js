"use strict";

const path = require("path");
const schutz = require(path.join(__dirname, "..", "src", "spoilerschutz.js"));

const pruefungen = [];
function pruefe(name, bedingung, detail = "") {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? `   -> ${detail}` : ""}`);
}

pruefe("Boolesche und leere IDs sind keine Folgennummern", [{season:true,episode:1},{season:0,episode:true},{season:" ",episode:1},{season:[],episode:1}].every(value => schutz.episodenSchluessel(value) === ""));

const folge = (episode, season = 1) => ({ season, episode });
const abgeschlossen = (episode, season = 1) => ({ season, episode, completedAt: "2026-09-08T12:00:00.000Z" });

pruefe("Schutz aus laesst jede Folge sichtbar", !schutz.folgeVerbergen({
  enabled: false, episode: folge(8), completedEpisodes: []
}));

pruefe("Nur ein expliziter Abschluss gibt eine persoenliche Folge frei", !schutz.folgeVerbergen({
  enabled: true, episode: folge(3), completedEpisodes: [abgeschlossen(3)]
}));

pruefe("Resume-Position ist kein Abschluss", schutz.folgeVerbergen({
  enabled: true, episode: folge(3), completedEpisodes: [], progress: 95, position: 1200
}));

pruefe("Die angezeigte naechste Folge ist kein Abschluss", schutz.folgeVerbergen({
  enabled: true, episode: folge(4), completedEpisodes: [abgeschlossen(3)],
  continuePending: true
}));

pruefe("Staffeln bleiben getrennt", schutz.folgeVerbergen({
  enabled: true, episode: folge(3, 2), completedEpisodes: [abgeschlossen(3, 1)]
}));

pruefe("Raumaggregate ersetzt niemals den eigenen Abschluss", schutz.folgeVerbergen({
  enabled: true, roomMinimum: true, roomActive: true, episode: folge(4), completedEpisodes: [],
  roomMemberCompletions: [{ completedEpisodes: [abgeschlossen(4)] }]
}));

for (const season of [undefined, null, "", -1, 1.5, "ungueltig"]) {
  pruefe("Ungueltige Staffel gibt keine Folge frei: " + String(season),
    !schutz.folgeIstGesehen({ season, episode: 4 }, [{ season, episode: 4 }]));
}
const alle = [{ completedEpisodes: [abgeschlossen(4)] }, { completedEpisodes: [abgeschlossen(4)] }];
pruefe("Raummodus gibt eine Folge nur frei, wenn jedes Mitglied sie abgeschlossen hat", !schutz.folgeVerbergen({
  enabled: true, roomMinimum: true, roomActive: true, episode: folge(4), completedEpisodes: [abgeschlossen(4)], roomMemberCompletions: alle
}));

pruefe("Ein bekannt leeres Abschlussprotokoll schuetzt die Folge", schutz.folgeVerbergen({
  enabled: true, roomMinimum: true, roomActive: true, episode: folge(4),
  roomMemberCompletions: [{ completedEpisodes: [abgeschlossen(4)] }, { completedEpisodes: [] }]
}));

pruefe("Ein unbekanntes Mitglied schuetzt fail-closed", schutz.folgeVerbergen({
  enabled: true, roomMinimum: true, roomActive: true, episode: folge(4),
  roomMemberCompletions: [{ completedEpisodes: [abgeschlossen(4)] }, null]
}));

pruefe("Kein Raumprotokoll schuetzt fail-closed", schutz.folgeVerbergen({
  enabled: true, roomMinimum: true, roomActive: true, episode: folge(4), roomMemberCompletions: []
}));

pruefe("Raumposition allein zaehlt nie als Abschluss", schutz.folgeVerbergen({
  enabled: true, roomMinimum: true, roomActive: true, episode: folge(4),
  roomMemberCompletions: [{ completedEpisodes: [abgeschlossen(4)] }, { season: 1, episode: 9, position: 1 }]
}));

pruefe("Ohne aktive Runde gilt weiter nur der persoenliche Abschluss", !schutz.folgeVerbergen({
  enabled: true, roomMinimum: true, roomActive: false, episode: folge(4), completedEpisodes: [abgeschlossen(4)]
}));

{
  const original = {
    staffel: 2, folge: 4, url: "https://beispiel.test/staffel-2/episode-4", gesperrt: false,
    titel: "Der Verrat", title: "The Betrayal", beschreibung: "Die Figur stirbt.",
    description: "A character dies.", overview: "A death.",
    image: "episode.jpg", imageUrl: "episode-large.jpg", thumbnail: "episode-thumb.jpg"
  };
  const geschuetzt = schutz.protectEpisode(original, { enabled: true, completedEpisodes: [] });
  pruefe("Projektion markiert eine ungesehene Folge als geschuetzt und nicht gesehen",
    geschuetzt.spoilerProtected === true && geschuetzt.seen === false);
  pruefe("Projektion maskiert nur Spoilerfelder mit neutralem Text oder leerem Bild",
    geschuetzt.titel === "Noch nicht gesehen" && geschuetzt.title === "Noch nicht gesehen"
      && geschuetzt.beschreibung === "Noch nicht gesehen" && geschuetzt.description === "Noch nicht gesehen"
      && geschuetzt.overview === "Noch nicht gesehen" && !geschuetzt.image && !geschuetzt.imageUrl && !geschuetzt.thumbnail);
  pruefe("Projektion erhaelt Nummer, Adresse und Sperrstatus fuer die Navigation",
    geschuetzt.staffel === original.staffel && geschuetzt.folge === original.folge
      && geschuetzt.url === original.url && geschuetzt.gesperrt === original.gesperrt);
  pruefe("Projektion veraendert die Quelldaten nicht", original.titel === "Der Verrat" && original.image === "episode.jpg");

  const gesehenAberRaumGeschuetzt = schutz.protectEpisode(original, {
    enabled: true, roomMinimum: true, roomActive: true, completedEpisodes: [abgeschlossen(4, 2)],
    roomMemberCompletions: [{ completedEpisodes: [abgeschlossen(4, 2)] }, { completedEpisodes: [] }]
  });
  pruefe("Eigenes seen bleibt wahr, wenn das Raum-Minimum die Folge noch schuetzt",
    gesehenAberRaumGeschuetzt.seen === true && gesehenAberRaumGeschuetzt.spoilerProtected === true);

  const sichtbar = schutz.protectEpisode(original, {
    enabled: true, completedEpisodes: [abgeschlossen(4, 2)]
  });
  pruefe("Gesehene Folge behaelt ihre Metadaten", sichtbar.seen === true && !sichtbar.spoilerProtected
    && sichtbar.titel === original.titel && sichtbar.image === original.image);
}

{
  let gelesen = 0;
  const completed = Array.from({length:500}, (_, i) => ({ get season() { gelesen++; return 1; }, episode: i+1 }));
  const episodes = Array.from({length:500}, (_,i) => ({season:1,episode:i+1,title:"Titel"}));
  const result = schutz.protectEpisodes(episodes,{enabled:true,completedEpisodes:completed});
  pruefe("Grosse Folgenliste normalisiert Abschluesse nur einmal", gelesen === 500 && result.every(e => e.seen));
}
if (pruefungen.some((ergebnis) => !ergebnis)) process.exitCode = 1;
