"use strict";

// Der sichtbare Ausschnitt eines eigenen Titelbildes.
//
// ELFIX zeigt ein eigenes Bild an vielen Stellen: als Poster im Startbanner
// und als Karte in "Gemeinsam weiterschauen", auf der Watchlist, in der
// Mediathek und bei den Empfehlungen. Ueberall wurde es bisher mittig
// gedeckt - vollflaechig, abgeschnitten wo es nicht passt. Das ist fuer die
// meisten Bilder richtig und fuer manche falsch: ein Titelbild, dessen Logo
// oben sitzt, wird auf einer Karte genau dort beschnitten.
//
// --- Je Form ein eigener Ausschnitt --------------------------------------------
//
// Ein Ausschnitt fuer alles genuegt nicht. Selbst das Poster im Startbanner
// kann einen anderen Ausschnitt brauchen als die kleineren Karten darunter:
// dort steht Text daneben und das Bild ist der optische Anker. Deshalb haelt
// ein Eintrag vier Lagen, eine je Einsatzort, und jede laesst sich einzeln
// zoomen und verschieben:
//
//   {
//     format: "medium",                              zuletzt bearbeitet
//     poster: { scale: 1.4, x: 0.2,  y: 0.1 },
//     medium: { scale: 1,   x: 0.5,  y: 0.5 },
//     large:  { scale: 1.2, x: 0.42, y: 0.6 },
//     banner: { scale: 1,   x: 0.5,  y: 0.28 }
//   }
//
// `format` aendert nichts an der Darstellung. Es merkt sich nur, in welcher
// Form der Editor beim naechsten Mal aufgehen soll. Welche Lage eine Karte
// nimmt, entscheidet ihr Einsatzort - eine Poster-Karte nimmt "poster", das
// Poster im Startbanner "banner".
//
// Eine Lage besteht aus drei Zahlen, alle als Verhaeltnis und keine in Pixeln:
//
//   scale   Vielfaches der Deckungsgroesse. 1 heisst "fuellt genau aus".
//           Nie kleiner als 1, denn darunter entstuenden leere Flaechen in der
//           Karte - und die soll es nicht geben.
//   x, y    Welcher Punkt des Bildes im sichtbaren Bereich landet (0..1).
//           0 heisst linke bzw. obere Kante, 1 die gegenueberliegende. Das ist
//           die Bedeutung von object-position in Prozent, uebernommen statt
//           nachgebaut.
//
// Weil keine der Zahlen weiss, wie gross der Kasten gerade ist, zeigt dieselbe
// Lage bei jeder Fenstergroesse denselben Teil des Bildes.
//
// --- Warum das ohne Messen auskommt ------------------------------------------
//
// Die Rechnung steckt nicht hier, sondern im Stylesheet, und zwar in vier
// Zeilen, die ineinandergreifen (siehe .karten-bild img):
//
//   width/height    Das Bild bekommt einen Kasten von scale mal Kartengroesse.
//   object-fit      "cover" fuellt diesen Kasten - immer, in jeder Form, ohne
//                   je zu strecken und ohne je eine Luecke zu lassen.
//   object-position Verschiebt innerhalb dessen, was "cover" abschneidet.
//   left/top        Verschiebt den vergroesserten Kasten ueber der Karte.
//
// Die letzten beiden greifen ineinander: bei scale 1 gibt es nichts zu
// schieben ausser dem, was "cover" abschneidet - das erledigt object-position.
// Bei groesserem Zoom kommt der Ueberstand des Kastens dazu - das erledigt
// left/top. Beide haengen linear an denselben x und y und zeigen in dieselbe
// Richtung, zusammen decken sie genau den gesamten Ueberstand ab. Bei x = 0
// steht die linke Bildkante an der linken Kartenkante, bei x = 1 die rechte an
// der rechten - unabhaengig von Bildformat, Kartenformat und Zoom.
//
// Der Gewinn daraus: keine Stelle muss wissen, wie breit eine Karte gerade
// ist. Der Editor setzt dieselben drei Variablen auf dieselbe Komponente wie
// die Karte - die Vorschau ist damit nicht aehnlich, sondern dasselbe.

// Die vier Formen. Ihre Seitenverhaeltnisse stehen nicht hier, sondern in der
// Oberflaeche: sie kommen aus den echten Kartenmassen von ELFIX, und das
// Poster im Banner wird am laufenden Fenster gemessen.
const FORMATE = ["poster", "medium", "large", "banner"];

// Kleiner als die Deckung darf es nicht werden - sonst blitzt der
// Kartenhintergrund durch. Nach oben ist bei vierfacher Deckung Schluss: ein
// eigenes Bild liegt mit 640 Pixeln Breite in der Ablage, alles darueber ist
// ohnehin nur noch Brei.
const MIN_SKALA = 1;
const MAX_SKALA = 4;
const STANDARD_FORMAT = "medium";
const STANDARD_LAGE = { scale: 1, x: 0.5, y: 0.5 };

function zahl(wert, ersatz) {
  const gelesen = Number(wert);
  return Number.isFinite(gelesen) ? gelesen : ersatz;
}

function klemmen(wert, min, max) {
  return Math.min(max, Math.max(min, wert));
}

// Gerundet wird, damit in der Ablage lesbare Zahlen stehen und nicht die
// Nachkommastellen eines Ziehvorgangs. Sechs Stellen sind auf jeder
// Bildschirmgroesse weit unter einem Pixel und trotzdem kurz genug fuers Auge.
function runden(wert) {
  return Math.round(wert * 1e6) / 1e6;
}

function lageNormalisieren(roh) {
  return {
    scale: runden(klemmen(zahl(roh?.scale, 1), MIN_SKALA, MAX_SKALA)),
    x: runden(klemmen(zahl(roh?.x, 0.5), 0, 1)),
    y: runden(klemmen(zahl(roh?.y, 0.5), 0, 1))
  };
}

function istStandardLage(lage) {
  return lage.scale === 1 && lage.x === 0.5 && lage.y === 0.5;
}

// Was aus der Ablage kommt, wird nicht uebernommen, sondern nachgebaut: nur
// diese Felder, nur diese Werte. Eine unbekannte Form ist "medium", eine
// unsinnige Zahl die Mitte.
//
// Aeltere Staende trugen eine einzige Lage fuer alles - erst mit "mode" und
// "aspect", spaeter mit "format" daneben. Sie steht dann in allen vier Formen,
// damit sich an dem, was der Benutzer sieht, durch das Update nichts aendert.
function normalisieren(roh) {
  const einzeln = roh && typeof roh === "object" && roh.scale !== undefined
    ? lageNormalisieren(roh)
    : null;
  const wert = { format: FORMATE.includes(roh?.format) ? roh.format : STANDARD_FORMAT };
  for (const form of FORMATE) {
    wert[form] = einzeln || lageNormalisieren(roh?.[form]);
  }
  return wert;
}

// Deckend, mittig, ohne Zoom in jeder Form - das ist, was ELFIX ohne jede
// Einstellung zeigt. Ein Ausschnitt, der darauf hinauslaeuft, braucht deshalb
// gar nicht erst gespeichert zu werden. Die zuletzt bearbeitete Form zaehlt
// dabei mit: wer sich fuer "Poster" entschieden hat, soll den Editor dort
// wieder aufgehen sehen.
function istStandard(roh) {
  const wert = normalisieren(roh);
  return wert.format === STANDARD_FORMAT && FORMATE.every((form) => istStandardLage(wert[form]));
}

function normalisierenOderNull(roh) {
  if (!roh || typeof roh !== "object") return null;
  return istStandard(roh) ? null : normalisieren(roh);
}

// Die Lage einer Form. Kennt eine Stelle ihre Form nicht, bekommt sie die
// gewoehnliche Karte - das ist der Fall, in dem frueher ohnehin nur eine Lage
// zur Verfuegung stand.
function lage(ausschnitt, format) {
  const wert = normalisieren(ausschnitt);
  return wert[FORMATE.includes(format) ? format : STANDARD_FORMAT];
}

// Die drei Werte, die an der Bildebene landen - als CSS-Variablen. Dieselbe
// Funktion beliefert Karte, Banner und die Vorschau im Editor; das ist der
// ganze Grund, warum die Vorschau nicht luegen kann.
function cssWerte(ausschnitt, format) {
  const wert = lage(ausschnitt, format);
  return {
    "--bild-zoom": String(wert.scale),
    "--bild-x": String(wert.x),
    "--bild-y": String(wert.y)
  };
}

// Eine einzelne Form aendern, die anderen bleiben, wie sie sind. Jede
// Bewegung im Editor geht durch diese Stelle - deshalb kann ein Zug im Poster
// die Lage im Banner nicht anfassen.
function mitLage(ausschnitt, format, neueLage) {
  const wert = normalisieren(ausschnitt);
  const form = FORMATE.includes(format) ? format : STANDARD_FORMAT;
  return { ...wert, [form]: lageNormalisieren(neueLage) };
}

// Wie weit steht das Bild ueber den sichtbaren Kasten hinaus, in Pixeln?
//
// Das braucht nur das Ziehen mit Maus oder Finger: um wie viel sich x und y
// aendern muessen, haengt davon ab, wie viel Bild ueberhaupt daneben liegt.
// Die Deckungsgroesse ist die kleinere Vergroesserung, die den Kasten noch
// ganz fuellt - mal Zoom ist das die wirkliche Bildgroesse.
function ueberstand(ausschnitt, format, boxBreite, boxHoehe, bildSeite) {
  const wert = lage(ausschnitt, format);
  if (!(boxBreite > 0) || !(boxHoehe > 0) || !(bildSeite > 0)) return { x: 0, y: 0 };
  const deckungBreite = Math.max(boxBreite, boxHoehe * bildSeite);
  const deckungHoehe = Math.max(boxHoehe, boxBreite / bildSeite);
  return {
    x: deckungBreite * wert.scale - boxBreite,
    y: deckungHoehe * wert.scale - boxHoehe
  };
}

// Ein Zug mit Maus oder Finger, in Pixeln des sichtbaren Kastens.
//
// x = 0 heisst "linke Bildkante an der linken Kartenkante", x = 1 die andere
// Seite. Das Bild um dx Pixel nach rechts zu ziehen heisst deshalb, x um
// dx / Ueberstand zu verkleinern.
function verschieben(ausschnitt, format, dx, dy, boxBreite, boxHoehe, bildSeite) {
  const wert = lage(ausschnitt, format);
  const rand = ueberstand(ausschnitt, format, boxBreite, boxHoehe, bildSeite);
  // Deckt das Bild eine Achse genau, gibt es dort nichts zu schieben - und
  // teilen laesst sich durch die Null ohnehin nicht.
  const x = rand.x < 0.5 ? wert.x : klemmen(wert.x - dx / rand.x, 0, 1);
  const y = rand.y < 0.5 ? wert.y : klemmen(wert.y - dy / rand.y, 0, 1);
  return mitLage(ausschnitt, format, { ...wert, x, y });
}

// Zoomen aendert nur die Skala. Die Lage bleibt, wo sie ist - der Punkt, den
// der Benutzer ins Bild gerueckt hat, soll dort bleiben.
function zoomen(ausschnitt, format, skala) {
  const wert = lage(ausschnitt, format);
  return mitLage(ausschnitt, format, { ...wert, scale: zahl(skala, wert.scale) });
}

// Bild zentrieren: Zoom bleibt, nur die Lage geht in die Mitte.
function zentrieren(ausschnitt, format) {
  return mitLage(ausschnitt, format, { ...lage(ausschnitt, format), x: 0.5, y: 0.5 });
}

// Zuruecksetzen gilt fuer die Form, die gerade zu sehen ist - nicht fuer alle
// vier. Wer das Poster verstellt hat und es zurueckholt, soll dabei nicht die
// Arbeit am Banner verlieren.
function zuruecksetzen(ausschnitt, format) {
  return mitLage(ausschnitt, format, STANDARD_LAGE);
}

function formatSetzen(ausschnitt, format) {
  return { ...normalisieren(ausschnitt), format: FORMATE.includes(format) ? format : STANDARD_FORMAT };
}

const schnittstelle = {
  FORMATE,
  MIN_SKALA,
  MAX_SKALA,
  STANDARD_FORMAT,
  STANDARD_LAGE,
  normalisieren,
  normalisierenOderNull,
  istStandard,
  lage,
  cssWerte,
  mitLage,
  ueberstand,
  verschieben,
  zoomen,
  zentrieren,
  zuruecksetzen,
  formatSetzen
};

// Zwei Verbraucher, ein Modul: der Hauptprozess laedt es als CommonJS, die
// Oberflaeche als gewoehnliches Skript. Ohne diese Doppelung muesste die
// Rechnung zweimal dastehen - und genau dann laufen Vorschau und Anzeige
// irgendwann auseinander.
if (typeof module !== "undefined" && module.exports) module.exports = schnittstelle;
if (typeof globalThis !== "undefined") globalThis.ELFIX_BILDAUSSCHNITT = schnittstelle;
