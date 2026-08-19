"use strict";
// Die vier Profile, an denen sich entscheidet, ob externe Daten etwas bringen.
//
// Alle externen Angaben in metadaten-proben.json sind echte Antworten des
// laufenden Relays, einmal aufgezeichnet. Kein Test geht ans Netz - aber es
// wird auch nichts erfunden: die Beziehungen, Schlagworte, Tags und
// Besetzungen sind genau die, die TMDB und AniList wirklich liefern.
//
// Gefragt wird nicht "ist der Code gelaufen", sondern:
//
//   A) Erkennt die Engine, dass Naruto Shippuden die Fortsetzung von Naruto
//      ist - und dass One Piece es NICHT ist?
//   B) Kommt nach Iron Man zuerst Iron Man 2 und erst danach Iron Man 3?
//   C) Profitiert House of the Dragon von Game of Thrones, ohne dass eine
//      Universumsbeziehung behauptet wird, die die Daten nicht hergeben?
//   D) Lassen sich Die Legende von Korra und Paw Patrol jetzt unterscheiden,
//      obwohl beide beim Anbieter "Animation, Abenteuer" sind?
//
// Kein Titel ist irgendwo im Code verdrahtet. Wenn ein Test hier faellt, weil
// sich die Daten geaendert haben, ist das die richtige Reaktion - dann stimmt
// die Aussage nicht mehr.

const E = require("../src/empfehlung");
const proben = require("./metadaten-proben.json");

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(b); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };

const JETZT = Date.parse("2026-08-19T12:00:00Z");
const vorTagen = (n) => new Date(JETZT - n * 86400000).toISOString();

function form(id) {
  const probe = proben[id];
  if (!probe) throw new Error("Keine Probe: " + id);
  return probe.form;
}

const adresse = (name, art) => `https://anbieter.test/${art}/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

// Ein Verlaufseintrag, wie ihn die Ablage fuehrt - mit den Anbietergenres und
// den externen Daten, so wie main.js sie anhaengt.
function gesehen(id, genres, extra = {}) {
  const probe = proben[id];
  const art = probe.anfrage.art;
  return {
    title: probe.anfrage.titel,
    genres,
    art,
    type: art === "film" ? "film" : "serie",
    url: adresse(probe.anfrage.titel, art),
    providerId: "p", providerName: "Anbieter",
    completed: true, watched: true, progress: 100,
    lastWatchedAt: vorTagen(2),
    extern: probe.form,
    ...extra
  };
}

// Ein Kandidat. `id` null heisst: zu diesem Titel gibt es keine externen Daten
// - genau der Fall, der weiter funktionieren muss.
function kandidat(id, name, art, genres) {
  const probe = id ? proben[id] : null;
  const titel = probe ? probe.anfrage.titel : name;
  const echteArt = probe ? probe.anfrage.art : art;
  return {
    title: titel,
    genres,
    art: echteArt,
    type: echteArt === "film" ? "film" : "serie",
    url: adresse(titel, echteArt),
    providerId: "p", providerName: "Anbieter",
    via: "genre",
    extern: probe ? probe.form : null
  };
}

function lauf(verlauf, kandidaten, optionen = {}) {
  const profil = E.profilBauen(verlauf, JETZT);
  return E.empfehlen(kandidaten, profil, { jetzt: JETZT, limit: 20, debug: true, ...optionen });
}

// Die Titel kommen aus den Proben und stehen dort so, wie die Anbieter sie
// schreiben ("ONE PIECE", "PAW Patrol") - gesucht wird deshalb ohne Ruecksicht
// auf Gross- und Kleinschreibung.
const passt = (eintrag, teil) => eintrag.title.toLowerCase().includes(teil.toLowerCase());
const rang = (liste, teil) => liste.findIndex((e) => passt(e, teil));
const finde = (liste, teil) => liste.find((e) => passt(e, teil));
const zeigen = (liste) => liste.map((e) => `${e.title} ${e.score.toFixed(2)}`).join(" | ");

// --- A) Naruto ---------------------------------------------------------------

{
  const SHOUNEN = ["action", "abenteuer", "fighting-shounen"];
  const liste = lauf(
    [gesehen("naruto", SHOUNEN)],
    [
      kandidat("shippuden", null, null, SHOUNEN),
      kandidat("onepiece", null, null, SHOUNEN),
      kandidat("hxh", null, null, ["action", "abenteuer"]),
      kandidat("bleach", null, null, ["action", "abenteuer"]),
      kandidat("boruto", null, null, ["action", "abenteuer"]),
      kandidat("fruitsbasket", null, null, ["romanze", "drama"]),
      kandidat("yurucamp", null, null, ["alltagsleben"])
    ]
  );

  const shippuden = finde(liste, "Shippuden");
  pruefe("A1. Naruto Shippuden steht ganz oben", rang(liste, "Shippuden") === 0, zeigen(liste));
  pruefe("A2. Und zwar als belegte Fortsetzung, nicht als Titelaehnlichkeit",
    shippuden?.grund === E.GRUND.EXTERN_FORTSETZUNG, shippuden?.grund);
  pruefe("A3. Der sichtbare Satz nennt den Vorgaenger",
    shippuden?.grundText === "Fortsetzung von Naruto", shippuden?.grundText);
  pruefe("A4. Die Beziehung stammt aus AniList und ist als SEQUEL belegt",
    shippuden?.belege?.beziehungQuelle === "anilist" && shippuden?.belege?.beziehungBelegt === "SEQUEL",
    `${shippuden?.belege?.beziehungQuelle} ${shippuden?.belege?.beziehungBelegt}`);

  const onePiece = finde(liste, "One Piece");
  pruefe("A5. One Piece kommt weit oben mit", rang(liste, "One Piece") >= 0 && rang(liste, "One Piece") <= 3,
    String(rang(liste, "One Piece")));
  pruefe("A6. Aber ausdruecklich NICHT als Reihe oder Fortsetzung",
    onePiece?.merkmale === undefined && onePiece?.teilwerte?.externRelation === 0,
    `externRelation ${onePiece?.teilwerte?.externRelation}`);
  pruefe("A7. Sondern ueber die Aehnlichkeit zu Naruto",
    /Naruto/.test(onePiece?.grundText || ""), onePiece?.grundText);
  pruefe("A8. Die Aehnlichkeit stuetzt sich auf gemeinsame Sachmerkmale, nicht auf breite Genres",
    (onePiece?.belege?.inhaltGeteilt || []).filter((key) => key.startsWith("s:")).length >= 3,
    (onePiece?.belege?.inhaltGeteilt || []).join(", "));

  pruefe("A9. Hunter x Hunter und Bleach stehen vor dem, was nicht passt",
    Math.max(rang(liste, "Hunter"), rang(liste, "Bleach")) < rang(liste, "Yuru"),
    zeigen(liste));
  pruefe("A10. Boruto gilt nicht als Fortsetzung von Naruto - AniList verbindet die beiden nicht direkt",
    finde(liste, "Boruto")?.teilwerte?.externRelation === 0,
    String(finde(liste, "Boruto")?.teilwerte?.externRelation));
}

// --- B) Iron Man -------------------------------------------------------------

{
  const liste = lauf(
    [gesehen("ironman", ["action", "scifi"])],
    [
      kandidat("ironman2", null, null, ["action", "scifi"]),
      kandidat("ironman3", null, null, ["action", "scifi"]),
      kandidat("avengers", null, null, ["action", "scifi"]),
      kandidat("strange", null, null, ["action", "fantasy"]),
      kandidat("darkknight", null, null, ["action", "krimi"]),
      kandidat("titanic", null, null, ["romanze", "drama"]),
      kandidat(null, "Ein unbekannter Actionfilm", "film", ["action", "scifi"])
    ]
  );

  pruefe("B1. Iron Man 2 steht vor Iron Man 3", rang(liste, "Iron Man 2") < rang(liste, "Iron Man 3"),
    zeigen(liste));
  pruefe("B2. Beide vor allem anderen",
    Math.max(rang(liste, "Iron Man 2"), rang(liste, "Iron Man 3")) < rang(liste, "Avengers"),
    zeigen(liste));
  const zwei = finde(liste, "Iron Man 2");
  pruefe("B3. Und die Sammlung ist der Beleg",
    zwei?.belege?.sammlung === "131292", zwei?.belege?.sammlung);
  pruefe("B4. Der Satz nennt den Vorgaenger",
    /Iron Man/.test(zwei?.grundText || ""), zwei?.grundText);

  const avengers = finde(liste, "Avengers");
  pruefe("B5. Avengers gehoert zu einer anderen Sammlung - keine Reihenbeziehung",
    avengers?.teilwerte?.externRelation === 0, String(avengers?.teilwerte?.externRelation));
  pruefe("B6. Profitiert aber ueber die echten Daten: Schlagworte, Besetzung, Studio",
    avengers?.teilwerte?.externInhalt > 0 && avengers?.teilwerte?.externPersonen > 0,
    `Inhalt ${avengers?.teilwerte?.externInhalt?.toFixed(2)} Personen ${avengers?.teilwerte?.externPersonen?.toFixed(2)}`);
  pruefe("B7. Robert Downey Jr. ist als gemeinsame Besetzung belegt",
    avengers?.belege?.schauspieler === "Robert Downey Jr.", avengers?.belege?.schauspieler);
  pruefe("B8. Und steht vor einem beliebigen Actionfilm",
    rang(liste, "Avengers") < rang(liste, "unbekannter"), zeigen(liste));
  pruefe("B9. Titanic bleibt hinten", rang(liste, "Titanic") >= liste.length - 2, zeigen(liste));
}

// --- C) Game of Thrones ------------------------------------------------------

{
  const liste = lauf(
    [gesehen("got", ["fantasy", "drama", "action"])],
    [
      kandidat("hotd", null, null, ["fantasy", "drama", "action"]),
      kandidat("witcher", null, null, ["fantasy", "action"]),
      kandidat("lastkingdom", null, null, ["drama", "action", "historie"]),
      kandidat("vikings", null, null, ["drama", "action", "historie"]),
      kandidat("friends", null, null, ["komoedie"])
    ]
  );

  const hotd = finde(liste, "House of the Dragon");
  pruefe("C1. House of the Dragon steht oben", rang(liste, "House of the Dragon") === 0, zeigen(liste));
  pruefe("C2. TMDB fuehrt es in der Empfehlungsliste von Game of Thrones - das ist belegt",
    hotd?.teilwerte?.externEmpfehlung > 0, String(hotd?.teilwerte?.externEmpfehlung?.toFixed(2)));
  pruefe("C3. Eine Sammlung gibt es nicht - TMDB fuehrt fuer Serien keine",
    !hotd?.belege?.sammlung, hotd?.belege?.sammlung || "(keine)");
  pruefe("C4. Deshalb wird auch keine Reihen- oder Universumsbeziehung behauptet",
    hotd?.teilwerte?.externRelation === 0
      && ![E.GRUND.EXTERN_FORTSETZUNG, E.GRUND.EXTERN_SAMMLUNG, E.GRUND.EXTERN_REIHE].includes(hotd?.grund),
    `${hotd?.grund}: „${hotd?.grundText}“`);
  pruefe("C5. Der Satz bleibt bei dem, was die Daten hergeben",
    /Game of Thrones/.test(hotd?.grundText || "")
      && !/Welt|Reihe/.test(hotd?.grundText || ""), hotd?.grundText);
  pruefe("C6. Getragen wird es von gemeinsamen Sachmerkmalen",
    (hotd?.belege?.inhaltGeteilt || []).filter((key) => key.startsWith("s:")).length >= 3,
    (hotd?.belege?.inhaltGeteilt || []).join(", "));
  pruefe("C7. Friends bleibt hinten", rang(liste, "Friends") === liste.length - 1, zeigen(liste));
}

// --- D) Korra gegen Kinderprogramm -------------------------------------------

{
  const ANIMATION = ["animation", "abenteuer", "action"];
  const liste = lauf(
    [gesehen("korra", ANIMATION)],
    [
      kandidat("avatar", null, null, ANIMATION),
      kandidat("teentitans", null, null, ANIMATION),
      // Paw Patrol traegt beim Anbieter dieselben Genres wie Korra. Genau
      // darum geht es.
      kandidat("paw", null, null, ["animation", "abenteuer"]),
      kandidat(null, "Irgendeine Kinderserie", "serie", ["animation", "abenteuer"])
    ]
  );

  const paw = finde(liste, "Paw Patrol");
  const avatar = finde(liste, "Avatar");
  pruefe("D1. Avatar steht vor Paw Patrol", rang(liste, "Avatar") < rang(liste, "Paw Patrol"),
    zeigen(liste));
  pruefe("D2. Und deutlich davor - nicht knapp",
    avatar.score > paw.score * 1.8, `${avatar.score.toFixed(2)} gegen ${paw.score.toFixed(2)}`);
  pruefe("D3. Im feinen Vokabular haben Korra und Paw Patrol praktisch nichts gemeinsam",
    (paw?.belege?.inhaltGeteilt || []).length <= 1,
    (paw?.belege?.inhaltGeteilt || []).join(", ") || "(nichts)");
  pruefe("D4. Bei Avatar dagegen viel",
    (avatar?.belege?.inhaltGeteilt || []).length >= 3,
    (avatar?.belege?.inhaltGeteilt || []).join(", "));
  pruefe("D5. Paw Patrol behauptet keinen Bezug zu Korra mehr",
    !/Korra/.test(paw?.grundText || ""), `„${paw?.grundText}“`);
  pruefe("D6. Teen Titans steht ueber Paw Patrol - beide sind Animation, nur eines passt",
    rang(liste, "Teen Titans") < rang(liste, "Paw Patrol"), zeigen(liste));
}

// --- D2) Wenn der Titel eine Reihe behauptet, die es nicht gibt --------------
//
// "Tomb Raider King" (Anime) und "Tomb Raider: The Legend of Lara Croft"
// (Zeichentrickserie) teilen zwei Inhaltswoerter. Die Titelanalyse kommt damit
// auf eine Konfidenz von 0.82 und meldet dieselbe Reihe - es sind aber zwei
// verschiedene Werke, die denselben Markennamen tragen. Die Datenbanken wissen
// das: keine Beziehung, kein einziges gemeinsames Sachmerkmal.

{
  const liste = lauf(
    [gesehen("tombraiderking", ["action", "abenteuer", "fantasy"])],
    [
      kandidat("laracroft", null, null, ["action", "abenteuer", "animation"]),
      kandidat("onepiece", null, null, ["action", "abenteuer"])
    ]
  );
  const lara = finde(liste, "Lara Croft");
  pruefe("D7. Die Titel-Reihe wird von den Daten widerlegt",
    lara?.teilwerte?.reihe === 0 && lara?.teilwerte?.naechsterTeil === 0,
    `reihe ${lara?.teilwerte?.reihe} naechsterTeil ${lara?.teilwerte?.naechsterTeil}`);
  pruefe("D8. Und der Widerspruch ist nachlesbar",
    lara?.belege?.reiheWiderlegt === "Tomb Raider King", lara?.belege?.reiheWiderlegt);
  pruefe("D9. Auf der Karte steht keine Reihe mehr",
    ![E.GRUND.REIHE, E.GRUND.NAECHSTER_TEIL].includes(lara?.grund),
    `${lara?.grund}: „${lara?.grundText}“`);
  pruefe("D10. Und kein Satz nennt Tomb Raider King",
    !/Tomb Raider King/.test(lara?.grundText || ""), lara?.grundText);
}

{
  // Die Gegenprobe: eine echte Reihe darf davon nicht getroffen werden. Naruto
  // und Naruto Shippuden haben eine belegte Beziehung - kein Gegenbeweis
  // moeglich.
  const liste = lauf(
    [gesehen("naruto", ["action", "abenteuer"])],
    [kandidat("shippuden", null, null, ["action", "abenteuer"])]
  );
  pruefe("D11. Eine belegte Beziehung wird nie widerlegt",
    !finde(liste, "Shippuden")?.belege?.reiheWiderlegt,
    finde(liste, "Shippuden")?.belege?.reiheWiderlegt || "(nicht widerlegt)");
}

// --- E) Was ohne externe Daten passiert --------------------------------------
//
// Die wichtigste Pruefung ueberhaupt: faellt das Relay aus, muss dieselbe
// Rechnung herauskommen wie vor der ganzen Erweiterung.

{
  const SHOUNEN = ["action", "abenteuer", "fighting-shounen"];
  const ohne = (eintrag) => ({ ...eintrag, extern: null });
  const verlauf = [ohne(gesehen("naruto", SHOUNEN))];
  const kandidaten = [
    ohne(kandidat("shippuden", null, null, SHOUNEN)),
    ohne(kandidat("onepiece", null, null, SHOUNEN)),
    ohne(kandidat("yurucamp", null, null, ["alltagsleben"]))
  ];
  const liste = lauf(verlauf, kandidaten);
  pruefe("E1. Ohne externe Daten wird trotzdem gerechnet", liste.length === 3, zeigen(liste));
  pruefe("E2. Und die Reihenerkennung aus dem Titel traegt weiter",
    rang(liste, "Shippuden") === 0, zeigen(liste));
  pruefe("E3. Kein externer Beitrag taucht auf",
    liste.every((e) => e.teilwerte.externRelation === 0 && e.teilwerte.externInhalt === 0));
  pruefe("E4. Und kein Satz behauptet etwas Externes",
    liste.every((e) => !String(e.grund).startsWith("EXTERNAL_")),
    liste.map((e) => e.grund).join(" | "));
}

// Eine unsichere Zuordnung darf keine Beziehung tragen - auch wenn die Daten
// dahinter stimmen wuerden.
{
  const unsicher = (probe, stufe) => ({ ...probe, konfidenz: stufe });
  const verlauf = [{ ...gesehen("naruto", ["action"]), extern: unsicher(form("naruto"), "MEDIUM") }];
  const kandidaten = [{
    ...kandidat("shippuden", null, null, ["action"]),
    extern: unsicher(form("shippuden"), "MEDIUM")
  }];
  const liste = lauf(verlauf, kandidaten);
  pruefe("E5. Bei nur MEDIUM zugeordneten Titeln zaehlt die Beziehung nicht",
    liste[0]?.teilwerte?.externRelation === 0, String(liste[0]?.teilwerte?.externRelation));
  pruefe("E6. Die inhaltliche Aehnlichkeit aber schon - sie behauptet weniger",
    liste[0]?.teilwerte?.externInhalt > 0, String(liste[0]?.teilwerte?.externInhalt?.toFixed(2)));

  const zuSchwach = [{
    ...kandidat("shippuden", null, null, ["action"]),
    extern: unsicher(form("shippuden"), "LOW")
  }];
  const listeLow = lauf(verlauf, zuSchwach);
  pruefe("E7. Bei LOW zaehlt gar nichts Externes mehr",
    listeLow[0]?.teilwerte?.externInhalt === 0 && listeLow[0]?.teilwerte?.externRelation === 0);
}

// --- F) Bewertung und Bekanntheit bleiben Beiwerk ----------------------------

{
  const beliebt = { ...form("titanic"), bewertung: 9.5, bewertungStimmen: 50000, beliebtheit: 999 };
  const unbekannt = { ...form("titanic"), externeIds: { tmdb: 999999 }, bewertung: 9.9,
    bewertungStimmen: 3, beliebtheit: 1 };
  const werte = E.externeMerkmale({ extern: beliebt, externKeys: [] },
    { eintraege: [] }, {}).werte;
  const werteDuenn = E.externeMerkmale({ extern: unbekannt, externKeys: [] },
    { eintraege: [] }, {}).werte;
  pruefe("F1. Eine gut belegte Bewertung zaehlt ein wenig", werte.rang > 0, werte.rang.toFixed(2));
  pruefe("F2. Eine Bewertung aus drei Stimmen zaehlt nicht", werteDuenn.rang === 0);
  pruefe("F3. Und selbst die beste Bewertung bleibt klein gegen alles andere",
    E.GEWICHTE.externRang * 1 < E.GEWICHTE.genre * 0.5,
    `${E.GEWICHTE.externRang} gegen ${E.GEWICHTE.genre}`);
}

const gut = pruefungen.filter(Boolean).length;
console.log(`${gut}/${pruefungen.length} bestanden`);
process.exit(gut === pruefungen.length ? 0 : 1);
