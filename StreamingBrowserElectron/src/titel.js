"use strict";

// Titel verstehen: Normalisierung, Werk-Identitaet und Filmreihen.
//
// Das ist die Grundlage des Empfehlungssystems, und zwar aus einem harten
// Grund: ausser Titel, Adresse, Typ und Genre gibt es in ELFIX keine
// Metadaten. Keine Collection-IDs, keine Beschreibungen, keine Besetzung, kein
// Erscheinungsjahr bei Filmen. Was eine Reihe ist und was nur zufaellig
// aehnlich heisst, muss deshalb aus dem Titel selbst kommen.
//
// Die Anbieter liefern zudem verschmutzte Titel:
//   "Reacher Staffel 1 | SerienStream (S.to)"
//   "Batman: The Dark Knight Returns, Teil 2"
//   "Avatar - Aufbruch nach Pandora"
//
// Und sie liefern Fallen. Diese drei stehen wirklich nebeneinander in der
// Ablage:
//   "Avatar - Aufbruch nach Pandora"      (Cameron)
//   "Avatar: The Way of Water"            (Cameron, dieselbe Reihe)
//   "Avatar Aang: Der Herr der Elemente"  (voellig anderes Werk)
//
// Alle drei fangen mit demselben Wort an. Wer nur auf gemeinsame Woerter
// schaut, wirft sie zusammen. Deshalb zaehlt hier nicht die blosse
// Ueberschneidung, sondern der Aufbau des Titels: was vor dem Untertitel steht
// (der "Stamm"), ist die Reihe - "Avatar" gegen "Avatar Aang" sind zwei
// verschiedene Staemme, und genau daran trennen sich die beiden Franchises.

// Woerter ohne Aussagekraft. Sie duerfen eine Reihe nie allein begruenden,
// werden aber nicht geloescht - "The Dark Knight" braucht seine Reihenfolge.
const FUELLWOERTER = new Set([
  "the", "a", "an", "der", "die", "das", "den", "dem", "des", "ein", "eine",
  "einen", "einem", "eines", "und", "and", "of", "von", "vom", "for", "fuer",
  "in", "im", "on", "at", "to", "le", "la", "les", "el", "il", "und"
]);

// Was die Anbieter an ihre Titel haengen. Steht am Ende und gehoert nie zum Werk.
const ANBIETER_SCHWANZ = /\s*[|·–-]\s*(?:aniworld|s\.?to|serienstream|filmo|movie4k|kinox)\b[^]*$/i;
const ANBIETER_KLAMMER = /\s*\((?:s\.?to|aniworld|serienstream|filmo)\)\s*$/i;

// Studio-Marken vor dem eigentlichen Titel. "Marvel's The Avengers" ist
// derselbe Film wie "The Avengers" - die Marke gehoert dem Studio, nicht dem
// Werk, und ohne diesen Schnitt faende die Reihe "Avengers: Endgame" nicht.
const STUDIO_PRAEFIX = /^(?:marvel|disney|dc|pixar|dreamworks|netflix)(?:'|’)?s\s+/i;

// Sprachfassungen. "Attack on Titan Ger Dub" und "Attack on Titan Ger Sub"
// sind dasselbe Werk und duerfen nicht zwei Empfehlungsplaetze belegen.
const SPRACHMARKE = /\s*[\[(]?\b(?:ger|german|deutsch|eng|english|jap|japanese)[\s-]*(?:dub|sub|subbed|dubbed)\b[\])]?\s*/gi;
const SPRACHMARKE_KURZ = /\s*[\[(]?\b(?:omu|omdu|untertitel|subbed|dubbed|synchro)\b[\])]?\s*/gi;

// Staffel- und Folgenangaben in allen Schreibweisen, die in der Ablage stehen.
const FOLGENANGABE = [
  /\s*[-–·|:,]?\s*(?:staffel|season)\s*\d+\s*[-–·|:,]?\s*(?:folge|episode|ep\.?)\s*\d+.*$/i,
  /\s*[-–·|:,]?\s*(?:folge|episode|ep\.?)\s*\d+\s*$/i,
  /\s*[-–·|:,]?\s*(?:staffel|season)\s*\d+\s*$/i,
  /\s*[-–·|:,]?\s*\bs\s*\d{1,3}\s*[.\- ]?\s*e\s*\d{1,4}\b.*$/i,
  /\s*[-–·|:,]?\s*\b\d{1,3}x\d{1,4}\b.*$/i
];

// Roemische Zahlen bis 20 - mehr Teile hat keine Reihe, und weiter oben faengt
// man sich nur falsche Treffer ein ("I" als Wort, "X" als Titel).
const ROEMISCH = new Map(Object.entries({
  ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15
}));

// Wie ein Teil einer Reihe angekuendigt wird. Die Zahl dahinter ist die
// Nummer - "Kapitel 4", "Part II", "Teil 2", "Vol. 3", "Season 2".
const TEIL_WORT = /\b(?:kapitel|chapter|teil|part|vol\.?|volume|episode|film)\s*([0-9]{1,2}|[ivx]{1,5})\b/i;
// Eine nackte Zahl ganz am Ende: "Iron Man 2", "Deadpool 2", "Spider-Man 3".
const TEIL_ZAHL_ENDE = /\s(\d{1,2})\s*$/;
// Eine nackte roemische Zahl am Ende: "John Wick Kapitel IV" faengt oben,
// "Rocky II" hier.
const TEIL_ROEMISCH_ENDE = /\s([ivx]{2,5})\s*$/i;

function umlauteAufloesen(wert) {
  return String(wert || "")
    .replace(/ä/gi, "ae").replace(/ö/gi, "oe").replace(/ü/gi, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Ein Jahr in Klammern am Ende - "(2023)". Nur vierstellig und plausibel,
// sonst faengt man Titel wie "2012" oder "1917" ein, die selbst Jahreszahlen
// sind. Es wird nur entfernt, wenn es geklammert ist.
const JAHR_KLAMMER = /\s*[\[(](19\d{2}|20\d{2})[\])]\s*$/;

// Der ganze Weg von "JOHN WICK: KAPITEL 4 (2023)" zu etwas Vergleichbarem.
//
// Rueckgabe:
//   klar     - lesbar gesaeubert, mit Gross-/Kleinschreibung wie geliefert
//   stamm    - was vor dem Untertitel steht, normalisiert ("john wick")
//   untertitel - was dahinter steht ("kapitel 4")
//   tokens   - alle bedeutungstragenden Woerter des ganzen Titels
//   stammTokens - dieselben, aber nur aus dem Stamm
//   teil     - die Teilnummer, wenn eine erkennbar ist
//   jahr     - das geklammerte Jahr, wenn eines dranstand
function zerlegen(roh) {
  let text = String(roh || "").replace(/\s+/g, " ").trim();

  text = text.replace(ANBIETER_SCHWANZ, "").replace(ANBIETER_KLAMMER, "").replace(STUDIO_PRAEFIX, "");
  const jahrTreffer = text.match(JAHR_KLAMMER);
  const jahr = jahrTreffer ? Number(jahrTreffer[1]) : 0;
  text = text.replace(JAHR_KLAMMER, "");
  text = text.replace(SPRACHMARKE, " ").replace(SPRACHMARKE_KURZ, " ");
  for (const muster of FOLGENANGABE) text = text.replace(muster, "");
  text = text.replace(/\s+/g, " ").replace(/[\s\-–·|:,]+$/, "").trim();

  const klar = text;
  const teil = teilNummer(text);

  // Der Stamm ist, was vor dem ersten echten Untertitel-Trenner steht. Genau
  // das trennt "Avatar" von "Avatar Aang" - und damit zwei Franchises, die
  // sonst nicht auseinanderzuhalten waeren.
  //
  // Ein Bindestrich zaehlt nur mit Leerzeichen drumherum: "Spider-Man" ist ein
  // Wort, "Avatar - Aufbruch nach Pandora" sind zwei Teile.
  const trenner = text.match(/\s*[:–]\s+|\s+[-–]\s+|\s*:\s*/);
  const stammText = trenner ? text.slice(0, trenner.index) : text;
  const untertitel = trenner ? text.slice(trenner.index + trenner[0].length) : "";

  return {
    roh: String(roh || ""),
    klar,
    stamm: normalisieren(stammText),
    untertitel: normalisieren(untertitel),
    tokens: tokenisieren(text),
    stammTokens: tokenisieren(stammText),
    teil,
    jahr
  };
}

// Kleinschreibung, Umlaute aufgeloest, alles Nicht-Alphanumerische zu Leerraum.
function normalisieren(wert) {
  return umlauteAufloesen(wert)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Ein Schluessel ohne Leerzeichen - fuer exakte Vergleiche und als Kartenindex.
function schluessel(wert) {
  return normalisieren(wert).replace(/ /g, "");
}

function tokenisieren(wert) {
  return normalisieren(wert).split(" ").filter(Boolean);
}

// Traegt dieses Wort Bedeutung? Fuellwoerter und reine Zahlen nicht - eine
// gemeinsame "2" macht aus "Iron Man 2" und "Rush Hour 2" keine Reihe.
function istInhaltswort(token) {
  return Boolean(token) && !FUELLWOERTER.has(token) && !/^\d+$/.test(token);
}

// Die Teilnummer eines Titels, oder 0.
//
// Reihenfolge der Versuche ist Absicht: ein ausdrueckliches "Kapitel 4" ist
// verlaesslicher als eine Zahl am Ende, und eine Zahl am Ende verlaesslicher
// als eine roemische. Sonst wuerde "Vol. 2" ueber die roemische Regel zu 0.
function teilNummer(titel) {
  const text = String(titel || "");

  const wort = text.match(TEIL_WORT);
  if (wort) {
    const wert = wort[1].toLowerCase();
    if (/^\d+$/.test(wert)) return Number(wert);
    if (wert === "i") return 1;
    return ROEMISCH.get(wert) || 0;
  }

  const zahl = text.match(TEIL_ZAHL_ENDE);
  // Ein Jahr am Ende ist keine Teilnummer. Zweistellig hoert es hier ohnehin
  // auf, aber "Blade Runner 2049" faellt schon an der Stellenzahl durch.
  if (zahl) {
    const wert = Number(zahl[1]);
    if (wert >= 2 && wert <= 20) return wert;
  }

  const roemisch = text.match(TEIL_ROEMISCH_ENDE);
  if (roemisch) return ROEMISCH.get(roemisch[1].toLowerCase()) || 0;

  return 0;
}

// --- Aehnlichkeit -------------------------------------------------------------

// Levenshtein, auf zwei Zeilen gerechnet. Nur fuer kurze Zeichenketten
// gedacht - Titel sind kurz, und laenger als 60 Zeichen wird abgebrochen.
function editAbstand(links, rechts) {
  const a = String(links || "");
  const b = String(rechts || "");
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  if (a.length > 60 || b.length > 60) return Math.abs(a.length - b.length) + 1;

  let vorige = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 0; i < a.length; i += 1) {
    const aktuelle = [i + 1];
    for (let j = 0; j < b.length; j += 1) {
      const kosten = a[i] === b[j] ? 0 : 1;
      aktuelle[j + 1] = Math.min(aktuelle[j] + 1, vorige[j + 1] + 1, vorige[j] + kosten);
    }
    vorige = aktuelle;
  }
  return vorige[b.length];
}

// 1 bei gleich, 0 bei voellig verschieden.
function zeichenAehnlichkeit(links, rechts) {
  const a = normalisieren(links).replace(/ /g, "");
  const b = normalisieren(rechts).replace(/ /g, "");
  if (!a && !b) return 0;
  if (a === b) return 1;
  const laenge = Math.max(a.length, b.length);
  return Math.max(0, 1 - editAbstand(a, b) / laenge);
}

// Wie viele Woerter teilen sich zwei Titel? Gewichtet: Fuellwoerter zaehlen
// wenig, seltene Woerter viel. "der" ist kein Hinweis, "wick" schon.
//
// `haeufigkeit` ist optional und sagt, wie oft ein Wort im gesamten Bestand
// vorkommt - damit wird "man" in einer Marvel-lastigen Ablage automatisch
// schwaecher als "frieren".
function tokenAehnlichkeit(linksTokens, rechtsTokens, haeufigkeit = null) {
  const a = new Set(linksTokens || []);
  const b = new Set(rechtsTokens || []);
  if (!a.size || !b.size) return 0;

  const gewicht = (token) => {
    if (!istInhaltswort(token)) return 0.15;
    if (!haeufigkeit) return 1;
    // Je haeufiger, desto weniger aussagekraeftig - grob nach IDF.
    const n = haeufigkeit.get(token) || 1;
    return 1 / (1 + Math.log(n));
  };

  let gemeinsam = 0;
  let gesamt = 0;
  for (const token of new Set([...a, ...b])) {
    const w = gewicht(token);
    gesamt += w;
    if (a.has(token) && b.has(token)) gemeinsam += w;
  }
  return gesamt > 0 ? gemeinsam / gesamt : 0;
}

// Wie viele Woerter stehen am Anfang beider Titel in derselben Reihenfolge?
// Das ist der staerkste Hinweis auf eine Reihe, die keine Nummern verwendet:
// "Harry Potter und der Stein der Weisen" gegen "Harry Potter und die Kammer
// des Schreckens" teilen sich drei fuehrende Woerter.
function gemeinsamerAnfang(linksTokens, rechtsTokens) {
  const a = linksTokens || [];
  const b = rechtsTokens || [];
  let laenge = 0;
  while (laenge < a.length && laenge < b.length && a[laenge] === b[laenge]) laenge += 1;
  const inhalt = a.slice(0, laenge).filter(istInhaltswort).length;
  return { laenge, inhalt };
}

// --- Franchise ---------------------------------------------------------------

// Gehoeren zwei Titel zur selben Reihe? Ergebnis zwischen 0 und 1.
//
// Kein einzelnes Signal entscheidet allein. Was zaehlt, ist der Aufbau:
//
//   gleicher Stamm, verschiedene Untertitel  -> sehr stark
//   ein Stamm ist Anfang des anderen         -> stark, ab zwei Inhaltswoertern
//   langer gemeinsamer Wortanfang            -> stark
//   nur gemeinsame Woerter irgendwo          -> schwach, nie allein genug
//
// Die Grenze bei zwei Inhaltswoertern ist der Grund, warum "Avatar" und
// "Avatar Aang" getrennt bleiben: der kuerzere Stamm hat nur ein Inhaltswort,
// und ein einzelnes gemeinsames Wort begruendet keine Reihe.
function franchiseKonfidenz(links, rechts) {
  const a = links && links.tokens ? links : zerlegen(links);
  const b = rechts && rechts.tokens ? rechts : zerlegen(rechts);
  if (!a.tokens.length || !b.tokens.length) return 0;

  // Derselbe Titel ist keine Reihe, sondern dasselbe Werk. Das entscheidet
  // die Dublettenerkennung, nicht diese Funktion.
  if (a.klar && a.klar === b.klar) return 1;

  const stammA = a.stamm;
  const stammB = b.stamm;
  const inhaltA = a.stammTokens.filter(istInhaltswort);
  const inhaltB = b.stammTokens.filter(istInhaltswort);
  if (!inhaltA.length || !inhaltB.length) return 0;

  let konfidenz = 0;

  // Verglichen werden die Inhaltswoerter des Stamms, nicht sein Wortlaut.
  // Sonst faellt jede Reihe durch, deren Nummer im Stamm steckt: "Deadpool"
  // und "Deadpool 2" haben verschiedene Staemme, aber dieselben Inhaltswoerter
  // - und die Zahl ist ja gerade der Hinweis auf die Reihe. Dasselbe gilt fuer
  // Fuellwoerter: "The Avengers" und "Avengers: Endgame".
  const inhaltTextA = inhaltA.join(" ");
  const inhaltTextB = inhaltB.join(" ");

  if (inhaltTextA && inhaltTextA === inhaltTextB) {
    // Gleicher Stamm, verschiedene Untertitel oder Nummern: "John Wick:
    // Kapitel 2" und "John Wick: Kapitel 4". Ein Stamm aus einem einzigen
    // kurzen Wort bleibt vorsichtiger - "Es" oder "Halt" sagen wenig.
    konfidenz = inhaltA.length >= 2 || inhaltTextA.length >= 5 ? 0.92 : 0.6;
  } else if (stammA && stammA === stammB) {
    konfidenz = inhaltA.length >= 2 || stammA.length >= 5 ? 0.92 : 0.6;
  } else {
    const kurz = inhaltA.length <= inhaltB.length ? inhaltA : inhaltB;
    const lang = inhaltA.length <= inhaltB.length ? inhaltB : inhaltA;
    const istAnfang = kurz.every((token, index) => lang[index] === token);
    // Auch hinten angesetzt: "The Amazing Spider-Man" ist ein Neuanfang von
    // "Spider-Man", nicht ein anderes Werk. Dass daraus keine direkte
    // Fortsetzung wird, entscheidet spaeter die Reihenfolge - hier geht es
    // nur um die Zugehoerigkeit zur Reihe.
    const versatz = lang.length - kurz.length;
    const istEnde = kurz.every((token, index) => lang[index + versatz] === token);
    if ((istAnfang || istEnde) && kurz.length >= 2) {
      // "The Dark Knight" und "The Dark Knight Rises".
      konfidenz = 0.82;
    } else if ((istAnfang || istEnde) && kurz.length === 1 && kurz[0].length >= 6) {
      // Ein einziges gemeinsames Wort - aber ein langes, seltenes:
      // "Deadpool 2" und "Deadpool & Wolverine".
      //
      // Bewusst unterhalb der Schwelle, ab der etwas als Reihe gilt. Dieselbe
      // Form haben naemlich auch "Avatar" und "Avatar Aang: Der Herr der
      // Elemente" - zwei voellig verschiedene Werke. Ohne Metadaten laesst
      // sich das eine vom anderen nicht unterscheiden, also wird es nur als
      // Aehnlichkeit gewertet und nie als Fortsetzung.
      konfidenz = 0.5;
    } else {
      // Kein Stamm-Verhaeltnis: dann zaehlt der gemeinsame Wortanfang des
      // ganzen Titels. Das faengt die Reihen ohne Nummern und ohne
      // Doppelpunkt - Harry Potter etwa.
      const anfang = gemeinsamerAnfang(a.tokens, b.tokens);
      if (anfang.inhalt >= 2) konfidenz = 0.78;
      else if (anfang.inhalt === 1 && anfang.laenge >= 3) konfidenz = 0.5;
      else return 0;
    }
  }

  // Traegt einer der beiden eine Teilnummer, spricht das zusaetzlich dafuer -
  // Reihen nummerieren sich. Bei gleichem Stamm und verschiedenen Nummern ist
  // das kein Beiwerk, sondern der Beweis: "Es" und "Es: Kapitel 2" sind
  // dieselbe Reihe, auch wenn der Stamm fuer sich genommen nichtssagend ist.
  if (inhaltTextA === inhaltTextB && a.teil !== b.teil && (a.teil || b.teil)) {
    konfidenz = Math.max(konfidenz, 0.85);
  } else if (a.teil || b.teil) {
    konfidenz = Math.min(1, konfidenz + 0.05);
  }
  // Sind die Titel zusaetzlich zeichenweise sehr aehnlich, festigt das die
  // Sache. Verschiedene Schreibweisen desselben Namens landen hier.
  if (zeichenAehnlichkeit(a.klar, b.klar) > 0.7) konfidenz = Math.min(1, konfidenz + 0.05);

  return Number(konfidenz.toFixed(3));
}

// Der Schluessel, unter dem eine Reihe gefuehrt wird. Titel mit demselben
// Schluessel sind Kandidaten fuer dieselbe Reihe - die Konfidenz entscheidet
// danach, ob sie es wirklich sind.
function franchiseSchluessel(titel) {
  const zerlegt = titel && titel.tokens ? titel : zerlegen(titel);
  const inhalt = zerlegt.stammTokens.filter(istInhaltswort);
  if (!inhalt.length) return schluessel(zerlegt.klar);
  // Hoechstens zwei Woerter. Bei drei fielen "Harry Potter und der Stein der
  // Weisen" und "... die Kammer des Schreckens" auseinander - beide haben
  // keinen Untertitel-Trenner, also ist der ganze Titel der Stamm, und das
  // dritte Inhaltswort ist schon der Unterschied.
  //
  // Grob zu schluesseln ist ungefaehrlich: der Schluessel sucht nur
  // Kandidaten heraus. Ob es wirklich dieselbe Reihe ist, entscheidet danach
  // `franchiseKonfidenz`.
  return inhalt.slice(0, 2).join("");
}

// Die Identitaet eines Werks - fuer Dubletten ueber Anbieter hinweg.
//
// Ein Werk ist dasselbe, wenn Titel, Typ und (falls bekannt) Jahr passen.
// Sprachfassungen und Anbieter-Zusaetze sind vorher schon weg, deshalb
// fallen "Attack on Titan Ger Dub" und "Attack on Titan Ger Sub" hier
// zusammen. Der Typ gehoert dazu: eine Serie und ein gleichnamiger Film sind
// zwei Werke.
function werkSchluessel(titel, typ = "", jahr = 0) {
  const zerlegt = titel && titel.tokens ? titel : zerlegen(titel);
  const art = String(typ || "").toLowerCase() === "film" ? "f" : "s";
  const wann = Number(jahr) || zerlegt.jahr || 0;
  return `${art}:${schluessel(zerlegt.klar)}${wann ? `:${wann}` : ""}`;
}

// Wie oft kommt jedes Wort im Bestand vor? Daraus wird die Gewichtung
// seltener Woerter. Einmal je Durchlauf gebaut, nicht je Vergleich.
function haeufigkeiten(titelListe) {
  const zaehler = new Map();
  for (const titel of titelListe || []) {
    const zerlegt = titel && titel.tokens ? titel : zerlegen(titel);
    for (const token of new Set(zerlegt.tokens)) {
      zaehler.set(token, (zaehler.get(token) || 0) + 1);
    }
  }
  return zaehler;
}

module.exports = {
  zerlegen,
  normalisieren,
  schluessel,
  tokenisieren,
  istInhaltswort,
  teilNummer,
  editAbstand,
  zeichenAehnlichkeit,
  tokenAehnlichkeit,
  gemeinsamerAnfang,
  franchiseKonfidenz,
  franchiseSchluessel,
  werkSchluessel,
  haeufigkeiten,
  FUELLWOERTER
};
