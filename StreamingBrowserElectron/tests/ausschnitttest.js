"use strict";
// Der Ausschnitt des eigenen Titelhintergrunds.
//
// Der Anlass: ELFIX zeigte jedes eigene Bild mittig und vollflaechig - auf dem
// Banner der Startseite genauso wie auf den schmalen Karten in "Gemeinsam
// weiterschauen". Bei einem Titelbild, dessen Logo oben sitzt, schnitt es
// genau das Logo weg, und es gab keine Handhabe dagegen.
//
// Geprueft wird hier nicht, ob die Oberflaeche huebsch aussieht, sondern die
// eine Eigenschaft, an der alles haengt: dass die vier CSS-Zeilen in
// .karten-bild img wirklich den Ausschnitt ergeben, den die drei gespeicherten
// Zahlen versprechen. Dafuer steht unten eine zweite, unabhaengige Umsetzung
// dieser Regeln. Wuerde die Rechnung im Modul von der Bedeutung der Werte
// abweichen, zeigte die Vorschau spaeter etwas anderes als die Karte - und
// genau das darf nicht passieren.

const A = require("../shared/bildausschnitt");

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(b); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };
const nah = (a, b, toleranz = 0.6) => Math.abs(a - b) <= toleranz;

// --- Was der Browser aus den vier Zeilen macht -------------------------------
//
// Bewusst aus der CSS-Spezifikation nachgebaut und nicht aus dem Modul
// abgeleitet: sonst pruefte sich die Rechnung an sich selbst.
//
//   width / height   z * 100% der Karte
//   object-fit       cover in diesem Kasten
//   object-position  x% y%  ->  Versatz = (Kasten - Bild) * Anteil
//   left / top       (1 - z) * 100% * Anteil, in Prozent der Karte
function gerahmt(lage, kasten, bild) {
  const z = lage.scale;
  const kastenB = kasten.b * z;
  const kastenH = kasten.h * z;
  const faktor = Math.max(kastenB / bild.b, kastenH / bild.h);
  const breite = bild.b * faktor;
  const hoehe = bild.h * faktor;
  return {
    x: (1 - z) * kasten.b * lage.x + (kastenB - breite) * lage.x,
    y: (1 - z) * kasten.h * lage.y + (kastenH - hoehe) * lage.y,
    breite,
    hoehe
  };
}

// Eine Lage, wie das Modul sie liefert - ueber den Umweg eines vollstaendigen
// Ausschnitts, damit auch das Klemmen und Runden mitgeprueft wird.
const alsLage = (roh, format = "medium") => A.lage({ [format]: roh }, format);
const rahmen = (roh, kasten, bild, format = "medium") => gerahmt(alsLage(roh, format), kasten, bild);

// Die Kartenformen, in denen ELFIX ein eigenes Bild wirklich zeigt: das
// Hochformat der Poster-Karten, die gewoehnliche Karte, ein breites Backdrop
// und das sehr breite Banner der Startseite.
const KAESTEN = {
  poster: { b: 230, h: 330 },
  medium: { b: 290, h: 220 },
  large: { b: 462, h: 260 },
  banner: { b: 1280, h: 240 }
};

// Die Bilder aus der Aufgabenstellung, mit echten Kantenlaengen.
const BILDER = {
  sehrBreit: { b: 3840, h: 600 },
  sehrHoch: { b: 600, h: 3000 },
  quadratisch: { b: 900, h: 900 },
  klein: { b: 160, h: 90 },
  vierK: { b: 3840, h: 2160 }
};

const seite = (bild) => bild.b / bild.h;
const SKALEN = [1, 1.18, 1.5, 2.5, 4];
const LAGEN = [[0, 0], [0.5, 0.5], [1, 1], [0.42, 0.31]];

// --- Nichts wird gestreckt ----------------------------------------------------
//
// Die erste und wichtigste Zusage. Sie gilt fuer jedes Bild, jede Kartenform,
// jeden Zoom und jede Lage - deshalb wird sie ueber das Kreuzprodukt geprueft
// und nicht an einem Beispiel.

for (const [name, bild] of Object.entries(BILDER)) {
  let treu = true;
  let schlimmste = 0;
  for (const kasten of Object.values(KAESTEN)) {
    for (const scale of SKALEN) {
      for (const [x, y] of LAGEN) {
        const g = rahmen({ scale, x, y }, kasten, bild);
        const abweichung = Math.abs((g.breite / g.hoehe) - seite(bild));
        schlimmste = Math.max(schlimmste, abweichung);
        if (abweichung > 0.001) treu = false;
      }
    }
  }
  pruefe(`${name}: das Seitenverhaeltnis bleibt in jeder Form erhalten`, treu,
    treu ? "" : `Abweichung ${schlimmste.toFixed(4)}`);
}

// --- Keine leeren Flaechen ----------------------------------------------------
//
// "Das Bild darf keine leeren Bereiche innerhalb der Karte erzeugen." Weil der
// Zoom nie unter 1 faellt und "cover" den vergroesserten Kasten immer fuellt,
// gilt das ohne jede Fallunterscheidung - auch bei einem 600x3000 grossen Bild
// auf einem 1280x240 breiten Banner.

for (const [name, bild] of Object.entries(BILDER)) {
  let deckt = true;
  let daneben = "";
  for (const [formName, kasten] of Object.entries(KAESTEN)) {
    for (const scale of SKALEN) {
      for (const [x, y] of LAGEN) {
        const g = rahmen({ scale, x, y }, kasten, bild);
        const luecke = g.x > 0.01 || g.y > 0.01
          || g.x + g.breite < kasten.b - 0.01 || g.y + g.hoehe < kasten.h - 0.01;
        if (luecke && !daneben) daneben = `${formName} bei Zoom ${scale}, Lage ${x}/${y}`;
        if (luecke) deckt = false;
      }
    }
  }
  pruefe(`${name}: keine leere Flaeche, in keiner Form und bei keinem Zoom`, deckt, daneben);
}

// --- Zoom 1 ist genau die Deckung ---------------------------------------------

for (const [name, bild] of Object.entries(BILDER)) {
  let stimmt = true;
  for (const kasten of Object.values(KAESTEN)) {
    const g = rahmen({ scale: 1, x: 0.5, y: 0.5 }, kasten, bild);
    // Genau eine der beiden Achsen passt aufs Haar, die andere steht ueber.
    const passtBreite = nah(g.breite, kasten.b, 0.01);
    const passtHoehe = nah(g.hoehe, kasten.h, 0.01);
    if (!(passtBreite || passtHoehe)) stimmt = false;
    if (g.breite < kasten.b - 0.01 || g.hoehe < kasten.h - 0.01) stimmt = false;
  }
  pruefe(`${name}: Zoom 100 % deckt genau, ohne Rest`, stimmt);
}

// --- Zoom -----------------------------------------------------------------------

{
  const bild = BILDER.vierK;
  const kasten = KAESTEN.medium;
  const eins = rahmen({ scale: 1, x: 0.5, y: 0.5 }, kasten, bild);
  const zwei = rahmen({ scale: 2, x: 0.5, y: 0.5 }, kasten, bild);
  const vier = rahmen({ scale: 4, x: 0.5, y: 0.5 }, kasten, bild);
  pruefe("Zoom: doppelter Wert ist doppelt so gross",
    nah(zwei.breite, eins.breite * 2, 0.01) && nah(zwei.hoehe, eins.hoehe * 2, 0.01));
  pruefe("Zoom: vierfacher Wert ist viermal so gross",
    nah(vier.breite, eins.breite * 4, 0.01));
  pruefe("Zoom: beim Hineinzoomen bleibt die Mitte die Mitte",
    nah(zwei.x + zwei.breite / 2, kasten.b / 2, 0.01)
    && nah(zwei.y + zwei.hoehe / 2, kasten.h / 2, 0.01));
}

pruefe("Zoom: unter die Deckung geht es nicht - das gaebe leere Flaechen",
  A.zoomen({}, "medium", 0.4).medium.scale === A.MIN_SKALA && A.MIN_SKALA === 1);

pruefe("Zoom: nach oben ist bei vierfacher Deckung Schluss",
  A.zoomen({}, "medium", 9999).medium.scale === A.MAX_SKALA);

pruefe("Zoom: eine unsinnige Eingabe laesst den Wert stehen",
  A.zoomen({ medium: { scale: 1.5 } }, "medium", "viel").medium.scale === 1.5);

// --- Die Lage bedeutet, was sie verspricht -------------------------------------
//
// x = 0 heisst "linke Bildkante an der linken Kartenkante", x = 1 die andere
// Seite. Daran haengt, dass ein Zug bis zum Anschlag genau am Rand endet.

for (const [name, bild] of Object.entries(BILDER)) {
  let buendig = true;
  for (const kasten of Object.values(KAESTEN)) {
    for (const scale of SKALEN) {
      const links = rahmen({ scale, x: 0, y: 0 }, kasten, bild);
      const rechts = rahmen({ scale, x: 1, y: 1 }, kasten, bild);
      if (!nah(links.x, 0, 0.01) || !nah(links.y, 0, 0.01)) buendig = false;
      if (!nah(rechts.x + rechts.breite, kasten.b, 0.01)) buendig = false;
      if (!nah(rechts.y + rechts.hoehe, kasten.h, 0.01)) buendig = false;
    }
  }
  pruefe(`${name}: Lage 0 und 1 liegen genau an den Kartenkanten`, buendig);
}

// --- Verschieben ----------------------------------------------------------------
//
// Ein Zug um N Pixel muss das Bild um genau N Pixel bewegen. Sonst laeuft der
// Zeiger dem Bild davon, und das Ziehen fuehlt sich falsch an.

for (const [formName, kasten] of Object.entries(KAESTEN)) {
  const bild = BILDER.vierK;
  const start = A.normalisieren({ medium: { scale: 1.8, x: 0.5, y: 0.5 } });
  const vorher = gerahmt(A.lage(start, "medium"), kasten, bild);
  const gezogen = A.verschieben(start, "medium", 20, 12, kasten.b, kasten.h, seite(bild));
  const nachher = gerahmt(A.lage(gezogen, "medium"), kasten, bild);
  pruefe(`${formName}: 20 Pixel nach rechts bewegen das Bild um 20 Pixel`,
    nah(nachher.x - vorher.x, 20, 0.1), `gemessen ${(nachher.x - vorher.x).toFixed(2)}`);
  pruefe(`${formName}: 12 Pixel nach unten bewegen das Bild um 12 Pixel`,
    nah(nachher.y - vorher.y, 12, 0.1), `gemessen ${(nachher.y - vorher.y).toFixed(2)}`);
  pruefe(`${formName}: die Groesse aendert sich dabei nicht`,
    nah(nachher.breite, vorher.breite, 0.01) && nah(nachher.hoehe, vorher.hoehe, 0.01));
}

{
  // Am Rand ist Schluss - und dort liegt die Bildkante genau auf der
  // Kartenkante, keinen Pixel daneben.
  const bild = BILDER.vierK;
  const kasten = KAESTEN.medium;
  const start = A.normalisieren({ medium: { scale: 1.5, x: 0.5, y: 0.5 } });
  const weit = A.lage(A.verschieben(start, "medium", 100000, 100000, kasten.b, kasten.h, seite(bild)), "medium");
  const zurueck = A.lage(A.verschieben(start, "medium", -100000, -100000, kasten.b, kasten.h, seite(bild)), "medium");
  pruefe("Verschieben: ein Zug ins Nichts endet am Anschlag",
    weit.x === 0 && weit.y === 0 && zurueck.x === 1 && zurueck.y === 1,
    `${weit.x}/${weit.y} und ${zurueck.x}/${zurueck.y}`);
  const anschlag = gerahmt(weit, kasten, bild);
  pruefe("Verschieben: am Anschlag liegt die Bildkante auf der Kartenkante",
    nah(anschlag.x, 0, 0.01) && nah(anschlag.y, 0, 0.01));
}

{
  // Ein sehr breites Bild deckt die Hoehe bei Zoom 1 genau aus - dort gibt es
  // senkrecht keinen Spielraum, und ein Zug darf nichts kaputtmachen
  // (Teilung durch Null).
  const bild = BILDER.sehrBreit;
  const kasten = KAESTEN.banner;
  const start = A.normalisieren({});
  const gezogen = A.lage(A.verschieben(start, "banner", 40, 40, kasten.b, kasten.h, seite(bild)), "banner");
  pruefe("Verschieben: ohne Spielraum bleibt die Achse stehen, ohne NaN",
    Number.isFinite(gezogen.x) && Number.isFinite(gezogen.y) && gezogen.y === 0.5);
  pruefe("Verschieben: waagerecht laesst es sich trotzdem bewegen", gezogen.x !== 0.5);
}

pruefe("Verschieben: ohne Kasten gibt es keine Rechnung mit Null",
  Number.isFinite(A.verschieben({}, "medium", 10, 10, 0, 0, 1.7).medium.x));

pruefe("Verschieben: ohne bekanntes Bildformat bleibt die Lage stehen",
  A.verschieben({ medium: { scale: 2 } }, "medium", 30, 0, 300, 200, 0).medium.x === 0.5);

// --- Derselbe Ausschnitt in jeder Groesse ---------------------------------------
//
// Der Ausschnitt steht in Verhaeltnissen, nicht in Pixeln. Dieselben drei
// Zahlen muessen deshalb auf einer schmalen und einer breiten Karte denselben
// Teil des Bildes zeigen - nicht denselben Pixelbereich. Genau das verlangt
// "Wenn dieselbe Kartengroesse verwendet wird, muss der sichtbare Ausschnitt
// identisch sein" - und mehr noch: auch beim Wachsen bleibt er derselbe.

{
  const bild = BILDER.vierK;
  const ausschnitt = A.lage({ medium: { scale: 1.5, x: 0.25, y: 0.75 } }, "medium");
  const anteil = (kasten) => {
    const g = gerahmt(ausschnitt, kasten, bild);
    return { x: -g.x / g.breite, y: -g.y / g.hoehe, b: kasten.b / g.breite, h: kasten.h / g.hoehe };
  };
  const gross = anteil({ b: 580, h: 440 });
  const klein = anteil({ b: 290, h: 220 });
  pruefe("Derselbe Ausschnitt bei doppelter Kartengroesse",
    nah(gross.x, klein.x, 0.0001) && nah(gross.y, klein.y, 0.0001)
    && nah(gross.b, klein.b, 0.0001) && nah(gross.h, klein.h, 0.0001),
    `${gross.x.toFixed(4)}/${gross.b.toFixed(4)} gegen ${klein.x.toFixed(4)}/${klein.b.toFixed(4)}`);
}

{
  // Bei einer anderen Kartenform aendert sich die Deckungsgroesse - und der
  // Zoom meint weiterhin "Vielfaches der Deckung", nicht eine feste Zahl.
  const bild = BILDER.vierK;
  const ausschnitt = A.lage({}, "medium");
  for (const [name, kasten] of Object.entries(KAESTEN)) {
    const g = gerahmt(ausschnitt, kasten, bild);
    pruefe(`Zoom 100 % deckt auch die Form "${name}"`,
      g.breite >= kasten.b - 0.01 && g.hoehe >= kasten.h - 0.01);
  }
}

// --- Speichern und wieder oeffnen ------------------------------------------------

pruefe("Der Normalfall wird nicht gespeichert - er aendert nichts",
  A.normalisierenOderNull({ format: "medium" }) === null
  && A.normalisierenOderNull({}) === null);

pruefe("Ein eigener Ausschnitt wird gespeichert",
  A.normalisierenOderNull({ poster: { scale: 1.18, x: 0.42, y: 0.31 } })?.poster.scale === 1.18);

pruefe("Auch eine allein gewaehlte Form wird gespeichert",
  A.normalisierenOderNull({ format: "banner" })?.format === "banner");

pruefe("Kein Ausschnitt bleibt kein Ausschnitt",
  A.normalisierenOderNull(null) === null && A.normalisierenOderNull("cover") === null
  && A.normalisierenOderNull(undefined) === null);

{
  // Erneutes Bearbeiten: was gespeichert wurde, kommt unveraendert zurueck in
  // den Editor - sonst rutscht der Ausschnitt bei jedem Oeffnen ein Stueck.
  const gespeichert = A.normalisierenOderNull({
    format: "large",
    poster: { scale: 1.4, x: 0.2, y: 0.1 },
    large: { scale: 1.62, x: 0.23, y: 0.78 }
  });
  const wiedergeoeffnet = A.normalisieren(gespeichert);
  pruefe("Erneutes Bearbeiten: der gespeicherte Ausschnitt kommt unveraendert zurueck",
    JSON.stringify(gespeichert) === JSON.stringify(wiedergeoeffnet), JSON.stringify(wiedergeoeffnet));

  const nochmal = A.normalisieren(A.normalisieren(A.normalisieren(gespeichert)));
  pruefe("Erneutes Bearbeiten: auch mehrfaches Speichern verschiebt nichts",
    JSON.stringify(gespeichert) === JSON.stringify(nochmal));
}

// --- Jede Form fuer sich -----------------------------------------------------------
//
// Der Kern der Erweiterung: ein Zug im Poster darf das Banner nicht anfassen.
// Ein Hochformat von 2:3 und ein Banner von 5:1 zeigen bei derselben Lage
// voellig verschiedene Teile des Bildes - deshalb hat jede Form ihre eigene.

{
  const start = A.normalisieren({});
  const gezogen = A.verschieben(start, "poster", 30, 20, 230, 330, 3840 / 2160);
  pruefe("Ein Zug im Poster aendert das Poster",
    gezogen.poster.x !== 0.5 || gezogen.poster.y !== 0.5);
  pruefe("Ein Zug im Poster laesst die anderen drei Formen in Ruhe",
    JSON.stringify(gezogen.medium) === JSON.stringify(A.STANDARD_LAGE)
    && JSON.stringify(gezogen.large) === JSON.stringify(A.STANDARD_LAGE)
    && JSON.stringify(gezogen.banner) === JSON.stringify(A.STANDARD_LAGE),
    JSON.stringify(gezogen));

  const gezoomt = A.zoomen(gezogen, "banner", 2.4);
  pruefe("Ein Zoom im Banner aendert nur das Banner",
    gezoomt.banner.scale === 2.4 && gezoomt.poster.scale === 1
    && JSON.stringify(gezoomt.poster) === JSON.stringify(gezogen.poster));

  pruefe("Zentrieren fasst nur die eine Form an",
    A.zentrieren(gezoomt, "poster").poster.x === 0.5
    && A.zentrieren(gezoomt, "poster").banner.scale === 2.4);

  pruefe("Zuruecksetzen fasst nur die eine Form an",
    A.zuruecksetzen(gezoomt, "banner").banner.scale === 1
    && JSON.stringify(A.zuruecksetzen(gezoomt, "banner").poster) === JSON.stringify(gezogen.poster));

  pruefe("Zuruecksetzen aller vier Formen fuehrt auf den Normalfall",
    A.istStandard(["poster", "medium", "large", "banner"]
      .reduce((wert, form) => A.zuruecksetzen(wert, form), A.formatSetzen(gezoomt, "medium"))));
}

{
  // Und die Anzeige greift die richtige Lage heraus.
  const ausschnitt = A.normalisieren({
    poster: { scale: 2, x: 0.1, y: 0.2 },
    banner: { scale: 1.5, x: 0.9, y: 0.8 }
  });
  pruefe("Eine Poster-Karte bekommt die Lage des Posters",
    A.cssWerte(ausschnitt, "poster")["--bild-zoom"] === "2"
    && A.cssWerte(ausschnitt, "poster")["--bild-x"] === "0.1");
  pruefe("Das Banner bekommt die Lage des Banners",
    A.cssWerte(ausschnitt, "banner")["--bild-zoom"] === "1.5"
    && A.cssWerte(ausschnitt, "banner")["--bild-y"] === "0.8");
  pruefe("Eine Form ohne eigene Einstellung bleibt beim Normalfall",
    A.cssWerte(ausschnitt, "medium")["--bild-zoom"] === "1"
    && A.cssWerte(ausschnitt, "medium")["--bild-x"] === "0.5");
  pruefe("Eine unbekannte Form faellt auf die gewoehnliche Karte zurueck",
    JSON.stringify(A.lage(ausschnitt, "zauberei")) === JSON.stringify(A.lage(ausschnitt, "medium")));
}

pruefe("Die Form laesst sich wechseln, ohne dass Zoom und Lage springen",
  ["poster", "medium", "large", "banner"].every((format) => {
    const vorher = A.normalisieren({ format: "medium", medium: { scale: 1.7, x: 0.2, y: 0.8 } });
    const gewechselt = A.formatSetzen(vorher, format);
    return gewechselt.format === format
      && JSON.stringify(gewechselt.medium) === JSON.stringify(vorher.medium);
  }));

// --- Was aus der Ablage kommt, wird nicht geglaubt ---------------------------------

pruefe("Eine unbekannte Form faellt auf die gewoehnliche Karte zurueck",
  A.normalisieren({ format: "zauberei" }).format === "medium");

pruefe("Eine Lage ausserhalb des Bildes wird eingefangen",
  alsLage({ x: 5, y: -3 }).x === 1 && alsLage({ x: 5, y: -3 }).y === 0);

pruefe("Text statt Zahl wird zur Mitte",
  alsLage({ x: "links", y: null }).x === 0.5);

// Eine Zahl, die zu gross oder zu klein ist, wird auf die Grenze gezogen - sie
// meint ja etwas. Was gar keine Zahl mehr ist, meint nichts, und dann ist die
// Deckungsgroesse die richtige Antwort.
pruefe("Ein Zoom ausserhalb des Moeglichen wird auf die Grenze gezogen",
  alsLage({ scale: 99 }).scale === A.MAX_SKALA && alsLage({ scale: 0 }).scale === A.MIN_SKALA);

pruefe("Ein Zoom, der keine Zahl mehr ist, faellt auf die Deckung zurueck",
  alsLage({ scale: Number.POSITIVE_INFINITY }).scale === 1
  && alsLage({ scale: Number.NaN }).scale === 1);

pruefe("Aus der Ablage kommen nur die bekannten Felder",
  JSON.stringify(Object.keys(A.normalisieren({ format: "poster", boeses: "feld" })))
    === JSON.stringify(["format", "poster", "medium", "large", "banner"])
  && JSON.stringify(Object.keys(alsLage({ scale: 2, boeses: "feld" }))) === JSON.stringify(["scale", "x", "y"]));

// --- Alte Staende ------------------------------------------------------------------
//
// Bis 1.23.0 stand in der Ablage ein Ausschnitt mit "mode" und "aspect", und
// "contain" durfte leere Flaechen lassen. Danach stand dort eine einzige Lage
// fuer alle Formen. Beide muessen weiterhin genau das zeigen, was sie vorher
// zeigten - eine einzelne Lage gilt deshalb fuer alle vier Formen, und ein
// Zoom unter der Deckung wird auf die Deckung gehoben.

{
  const alt = A.normalisieren({ mode: "contain", scale: 0.0625, x: 0.5, y: 0.5, aspect: 0.2 });
  pruefe("Ein alter Eintrag mit \"Einpassen\" wird zur Deckung",
    A.istStandard(alt) && alt.mode === undefined, JSON.stringify(alt));
  const g = gerahmt(A.lage(alt, "medium"), KAESTEN.medium, BILDER.sehrHoch);
  pruefe("Ein alter Eintrag mit \"Einpassen\" laesst keine Luecke mehr",
    g.x <= 0.01 && g.y <= 0.01
    && g.x + g.breite >= KAESTEN.medium.b - 0.01 && g.y + g.hoehe >= KAESTEN.medium.h - 0.01);
}

{
  const alt = A.normalisieren({ mode: "manual", scale: 1.18, x: 0.42, y: 0.31, aspect: 1.778 });
  pruefe("Ein alter manueller Eintrag behaelt Zoom und Lage",
    alt.medium.scale === 1.18 && alt.medium.x === 0.42 && alt.medium.y === 0.31);
  pruefe("Ein alter Eintrag gilt zunaechst fuer alle vier Formen - es aendert sich nichts",
    ["poster", "medium", "large", "banner"].every((form) =>
      alt[form].scale === 1.18 && alt[form].x === 0.42 && alt[form].y === 0.31));
}

{
  const alt = A.normalisieren({ format: "poster", scale: 1.5, x: 0.2, y: 0.8 });
  pruefe("Ein Eintrag mit einer Lage und einer Form behaelt beides",
    alt.format === "poster" && alt.poster.scale === 1.5 && alt.banner.x === 0.2);
}

// --- Die Werte, die an der Bildebene landen ------------------------------------------

{
  const werte = A.cssWerte({ poster: { scale: 1.18, x: 0.42, y: 0.31 } }, "poster");
  pruefe("Die Bildebene bekommt genau drei Variablen",
    JSON.stringify(werte) === JSON.stringify({ "--bild-zoom": "1.18", "--bild-x": "0.42", "--bild-y": "0.31" }),
    JSON.stringify(werte));
}

pruefe("Ohne Ausschnitt stehen dort die Werte, die ELFIX immer schon zeigte",
  A.cssWerte(null, "medium")["--bild-zoom"] === "1" && A.cssWerte(null, "banner")["--bild-x"] === "0.5");

const gut = pruefungen.filter(Boolean).length;
console.log(`${gut}/${pruefungen.length} bestanden`);
process.exit(gut === pruefungen.length ? 0 : 1);
