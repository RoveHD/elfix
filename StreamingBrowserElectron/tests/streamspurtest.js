"use strict";
// Welche der beobachteten Adressen der Film ist.
//
// Das ist die Stelle, an der ein Aufloeser danebengreift - und zwar unauffaellig:
// er liefert eine Adresse, sie spielt sogar, und der Zuschauer sieht neunzig
// Sekunden Werbung statt seiner Folge. "Die erste .m3u8 gewinnt" waere in
// mehreren dieser Proben falsch.
//
// Die Proben tragen den Ablauf einer echten Hosterseite nach: erst die Werbung,
// dann der Player, dann Stuecke. Genau in dieser Reihenfolge - denn wenn die
// Reihenfolge entschiede, waere immer die Werbung der Sieger.

const spur = require("../src/streamspur");

const pruefungen = [];
const pruefe = (name, bedingung, detail = "") => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

/** Eine Beobachtungsliste aus Adressen aufbauen - in der Reihenfolge des Netzes. */
function beobachtet(...eintraege) {
  return eintraege.reduce((liste, eintrag) => spur.aufnehmen(
    liste,
    typeof eintrag === "string" ? { adresse: eintrag } : eintrag
  ), []);
}

/* ------------------------------------------------------------- Die Einordnung */

pruefe("Eine Playlist ist eine Playlist",
  spur.art("https://a.example/x/index.m3u8?t=1") === "playlist"
  && spur.art("https://a.example/x/manifest.mpd") === "playlist");
pruefe("Ein Stück ist kein Stream",
  spur.art("https://a.example/x/seg-12.ts") === "stueck"
  && spur.art("https://a.example/x/chunk_3.m4s") === "stueck"
  && spur.art("https://a.example/x/init.mp4") === "stueck",
  "auch wenn init.mp4 auf .mp4 endet");
pruefe("Eine Datei ist eine Datei",
  spur.art("https://a.example/v/film_1080.mp4") === "datei");
pruefe("Ein Zählpixel ist nichts",
  spur.art("https://werbung.example/track?id=7") === "nichts");

/* ------------------------------------------- Der Fall, um den es eigentlich geht */

{
  // Die Werbung traegt hier absichtlich keinen verraeterischen Namen: geprueft
  // wird die Laufzeit, nicht ein Wort im Pfad. Genau so sehen die Adressen der
  // Werbenetze aus, die sich Muehe geben.
  const liste = beobachtet(
    "https://kante.example/w/8821/master.m3u8",
    "https://cdn.example/v/abc/master.m3u8",
    "https://cdn.example/v/abc/1080/seg-1.ts",
    "https://cdn.example/v/abc/1080/seg-2.ts"
  );
  const urteil = spur.waehlen(liste, {
    laufzeiten: {
      "https://kante.example/w/8821/master.m3u8": 30,
      "https://cdn.example/v/abc/master.m3u8": 1421
    }
  });
  pruefe("Der Vorspann gewinnt nicht, obwohl er zuerst kam",
    urteil.quelle === "https://cdn.example/v/abc/master.m3u8",
    urteil.quelle);
  pruefe("Und zwar an der Laufzeit, nicht an seinem Namen",
    /nur 30 s/.test(urteil.verworfen.find((w) => /kante\.example/.test(w.adresse))?.grund || ""),
    JSON.stringify(urteil.verworfen[0]));
}

{
  // Ohne gelesene Laufzeiten - dann müssen die Stücke entscheiden.
  const liste = beobachtet(
    "https://werbenetz.example/preroll/master.m3u8",
    "https://cdn.example/v/abc/master.m3u8",
    "https://cdn.example/v/abc/seg-1.ts",
    "https://cdn.example/v/abc/seg-2.ts",
    "https://cdn.example/v/abc/seg-3.ts"
  );
  const urteil = spur.waehlen(liste, {});
  pruefe("Ohne Manifest belegen die Stücke die richtige Playlist",
    urteil.quelle === "https://cdn.example/v/abc/master.m3u8",
    urteil.quelle);
  pruefe("Der Beleg wird auch so genannt",
    /3 Stücke belegen sie/.test(urteil.grund),
    urteil.grund);
  pruefe("Ein Stück selbst kommt nie zurück",
    !/\.ts$/.test(urteil.quelle));
}

/* ------------------------------------------------------- Das Videoelement */

{
  const liste = beobachtet(
    "https://werbenetz.example/preroll/master.m3u8",
    "https://cdn.example/v/abc/master.m3u8"
  );
  const urteil = spur.waehlen(liste, { currentSrc: "https://cdn.example/v/abc/1080.mp4" });
  pruefe("Was im Videoelement steht, schlägt die ganze Liste",
    urteil.quelle === "https://cdn.example/v/abc/1080.mp4" && urteil.grund === "aus dem Videoelement",
    urteil.quelle);
}
{
  const liste = beobachtet("https://cdn.example/v/abc/master.m3u8");
  const urteil = spur.waehlen(liste, { currentSrc: "blob:https://hoster.example/8f2a-…" });
  pruefe("Eine blob:-Adresse ist keine Antwort",
    urteil.quelle === "https://cdn.example/v/abc/master.m3u8",
    "dann läuft MSE, und die Playlist dahinter ist gesucht");
}

/* ------------------------------------------------------------- Die Nebensachen */

{
  const liste = beobachtet(
    "https://cdn.example/v/abc/preview.mp4",
    "https://cdn.example/v/abc/storyboard/sprite.mp4",
    "https://cdn.example/v/abc/film.mp4"
  );
  const urteil = spur.waehlen(liste, {});
  pruefe("Vorschau und Streifenbilder fallen weg",
    urteil.quelle === "https://cdn.example/v/abc/film.mp4",
    urteil.quelle);
}
{
  const liste = beobachtet(
    { adresse: "https://werbung.example/x/master.m3u8", vonWerbung: true },
    "https://cdn.example/v/abc/master.m3u8"
  );
  const urteil = spur.waehlen(liste, {});
  pruefe("Was der Filter als Werbenetz kennt, zählt nicht mit",
    urteil.quelle === "https://cdn.example/v/abc/master.m3u8"
    && urteil.verworfen.some((w) => w.grund === "Werbenetz"));
}

/* ------------------------------------------------------------------ Die Ränder */

pruefe("Nichts beobachtet, nichts gewählt",
  spur.waehlen([], {}).quelle === "" && spur.waehlen(null, {}).quelle === "");
pruefe("Nur Stücke ergeben keine Quelle",
  spur.waehlen(beobachtet("https://a.example/x/seg-1.ts"), {}).quelle === "",
  "ein Stück ist ein Zeuge, kein Ergebnis");
pruefe("Dieselbe Adresse zweimal ist ein Eintrag mit zwei Treffern",
  beobachtet("https://a.example/x/i.m3u8", "https://a.example/x/i.m3u8").length === 1);
pruefe("Was keine Adresse ist, wird nicht aufgenommen",
  spur.aufnehmen([], { adresse: "blob:xyz" }).length === 0
  && spur.aufnehmen([], { adresse: "" }).length === 0);

/* --------------------------------------------------------------- Der Schutz */

{
  const roh = "https://cdn.example/hls/9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c/index.m3u8"
    + "?token=abcdef0123456789abcdef&expires=1788610000&ip=203.0.113.7&q=1080";
  const kurz = spur.adresseKuerzen(roh);
  pruefe("Der Schlüssel steht nicht im Bericht",
    !kurz.includes("abcdef0123456789abcdef"), kurz);
  pruefe("Die eigene IP auch nicht", !kurz.includes("203.0.113.7"));
  pruefe("Aber dass ein token verlangt wird, bleibt lesbar",
    kurz.includes("token=<gekürzt>"),
    "das ist die Auskunft, auf die es ankommt");
  pruefe("Ein langer Pfadteil wird ebenfalls gekürzt",
    !kurz.includes("9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c"), kurz);
  pruefe("Harmlose Angaben bleiben stehen", kurz.includes("q=1080"));
  pruefe("Der Wirt bleibt lesbar - ohne ihn sagt der Bericht nichts",
    kurz.startsWith("https://cdn.example/"));
  pruefe("Was keine Adresse ist, wird auch nicht ausgegeben",
    spur.adresseKuerzen("nicht wirklich") === "<keine Adresse>");
}
pruefe("Von den Keksen bleiben nur die Namen",
  spur.kekseKuerzen("sid=geheim123; lang=de").join(",") === "sid,lang",
  "dass es einen sid gibt, ist die Auskunft - sein Wert nicht");

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`
${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
