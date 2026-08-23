"use strict";

// Ein QR-Code, selbst gerechnet.
//
// Gebraucht wird er an genau einer Stelle: in den Einstellungen soll die
// Adresse der Fernbedienung samt Kopplungscode als Bild dastehen, damit man sie
// mit dem Handy abfotografiert statt sie abzutippen.
//
// Dafuer eine Abhaengigkeit aufzunehmen, waere teuer erkauft. ELFIX hat zwei
// Laufzeit-Abhaengigkeiten, und das Relay hat keine einzige - im README steht
// ausdruecklich, dass ein `npm ci` beim Aktualisieren nie noetig war. Ein
// Bildchen ist kein Grund, das aufzugeben.
//
// Also die Rechnung selbst. Sie ist gutmuetig, solange man sich an den engen
// Fall haelt: Byte-Modus, Fehlerkorrektur M, Fassungen 1 bis 10. Das reicht fuer
// 213 Zeichen - eine Adresse mit Code ist halb so lang.
//
// Geprueft wird das nicht am Aussehen, sondern am Ergebnis: die Suite erzeugt
// Codes, malt sie und liest sie mit einem fremden Decoder zurueck. Ein QR, der
// falsch ist, sieht naemlich vollkommen richtig aus.

// --- Rechnen in GF(256) -------------------------------------------------------
//
// Die Fehlerkorrektur nach Reed-Solomon lebt in einem Koerper mit 256
// Elementen. Multiplizieren wird dort zu Addieren von Logarithmen - deshalb
// zuerst zwei Tabellen.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    // Das Restpolynom des Koerpers, wie es die Norm vorschreibt.
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

function malnehmen(a, b) {
  if (!a || !b) return 0;
  return EXP[LOG[a] + LOG[b]];
}

// Das Generatorpolynom fuer so viele Fehlerkorrektur-Woerter.
function generator(anzahl) {
  let poly = [1];
  for (let i = 0; i < anzahl; i += 1) {
    const neu = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      neu[j] ^= poly[j];
      neu[j + 1] ^= malnehmen(poly[j], EXP[i]);
    }
    poly = neu;
  }
  return poly;
}

// Die Fehlerkorrektur-Woerter zu einem Block: der Rest der Division durch das
// Generatorpolynom.
function fehlerkorrektur(daten, anzahl) {
  const poly = generator(anzahl);
  const rest = new Array(anzahl).fill(0);
  for (const wert of daten) {
    const faktor = wert ^ rest[0];
    rest.shift();
    rest.push(0);
    if (!faktor) continue;
    for (let i = 0; i < anzahl; i += 1) {
      rest[i] ^= malnehmen(poly[i + 1], faktor);
    }
  }
  return rest;
}

// --- Die Tabellen der Norm ----------------------------------------------------
//
// Je Fassung bei Fehlerkorrektur M: wie viele Korrekturwoerter je Block, und wie
// die Datenwoerter auf Bloecke verteilt sind. Zwei Gruppen, weil die Bloecke
// nicht immer gleich gross sind.
const FASSUNGEN = {
  1: { ecc: 10, gruppen: [[1, 16]] },
  2: { ecc: 16, gruppen: [[1, 28]] },
  3: { ecc: 26, gruppen: [[1, 44]] },
  4: { ecc: 18, gruppen: [[2, 32]] },
  5: { ecc: 24, gruppen: [[2, 43]] },
  6: { ecc: 16, gruppen: [[4, 27]] },
  7: { ecc: 18, gruppen: [[4, 31]] },
  8: { ecc: 22, gruppen: [[2, 38], [2, 39]] },
  9: { ecc: 22, gruppen: [[3, 36], [2, 37]] },
  10: { ecc: 26, gruppen: [[4, 43], [1, 44]] }
};

// Wo die Ausrichtungsmuster sitzen. Fassung 1 hat keine.
const AUSRICHTUNG = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
};

function datenwoerter(fassung) {
  return FASSUNGEN[fassung].gruppen.reduce((summe, [bloecke, groesse]) => summe + bloecke * groesse, 0);
}

// Wie viele Zeichen in eine Fassung passen. Der Kopf kostet vier Bit fuer den
// Modus und acht (ab Fassung 10: sechzehn) fuer die Laenge.
function fasst(fassung) {
  const bits = datenwoerter(fassung) * 8 - 4 - (fassung < 10 ? 8 : 16);
  return Math.floor(bits / 8);
}

function kleinsteFassung(laenge) {
  for (let fassung = 1; fassung <= 10; fassung += 1) {
    if (laenge <= fasst(fassung)) return fassung;
  }
  return 0;
}

// --- Die Bitfolge -------------------------------------------------------------

function bitfolge(bytes, fassung) {
  const bits = [];
  const schieben = (wert, anzahl) => {
    for (let i = anzahl - 1; i >= 0; i -= 1) bits.push((wert >> i) & 1);
  };
  // Byte-Modus.
  schieben(0b0100, 4);
  schieben(bytes.length, fassung < 10 ? 8 : 16);
  for (const byte of bytes) schieben(byte, 8);

  const platz = datenwoerter(fassung) * 8;
  // Abschluss: bis zu vier Nullen, dann auf ein ganzes Byte auffuellen.
  for (let i = 0; i < 4 && bits.length < platz; i += 1) bits.push(0);
  while (bits.length % 8) bits.push(0);

  // Und den Rest mit den beiden Fuellwoertern der Norm.
  const fuellung = [0xec, 0x11];
  let welches = 0;
  while (bits.length < platz) {
    schieben(fuellung[welches], 8);
    welches = 1 - welches;
  }

  const woerter = [];
  for (let i = 0; i < bits.length; i += 8) {
    let wert = 0;
    for (let j = 0; j < 8; j += 1) wert = (wert << 1) | bits[i + j];
    woerter.push(wert);
  }
  return woerter;
}

// Datenwoerter und Korrekturwoerter blockweise verschraenken - so verlangt es
// die Norm, damit ein Kratzer nicht einen ganzen Block trifft.
function verschraenken(woerter, fassung) {
  const { ecc, gruppen } = FASSUNGEN[fassung];
  const bloecke = [];
  let gelesen = 0;
  for (const [anzahl, groesse] of gruppen) {
    for (let i = 0; i < anzahl; i += 1) {
      const daten = woerter.slice(gelesen, gelesen + groesse);
      gelesen += groesse;
      bloecke.push({ daten, ecc: fehlerkorrektur(daten, ecc) });
    }
  }

  const aus = [];
  const laengste = Math.max(...bloecke.map((block) => block.daten.length));
  for (let i = 0; i < laengste; i += 1) {
    for (const block of bloecke) {
      if (i < block.daten.length) aus.push(block.daten[i]);
    }
  }
  for (let i = 0; i < ecc; i += 1) {
    for (const block of bloecke) aus.push(block.ecc[i]);
  }
  return aus;
}

// --- Das Muster ---------------------------------------------------------------

function leer(groesse) {
  return Array.from({ length: groesse }, () => new Array(groesse).fill(null));
}

function suchmuster(feld, zeile, spalte) {
  for (let y = -1; y <= 7; y += 1) {
    for (let x = -1; x <= 7; x += 1) {
      const zy = zeile + y;
      const zx = spalte + x;
      if (zy < 0 || zx < 0 || zy >= feld.length || zx >= feld.length) continue;
      const rand = y === -1 || y === 7 || x === -1 || x === 7;
      const innen = y >= 0 && y <= 6 && x >= 0 && x <= 6
        && (y === 0 || y === 6 || x === 0 || x === 6 || (y >= 2 && y <= 4 && x >= 2 && x <= 4));
      feld[zy][zx] = rand ? 0 : (innen ? 1 : 0);
    }
  }
}

function grundmuster(fassung) {
  const groesse = fassung * 4 + 17;
  const feld = leer(groesse);

  suchmuster(feld, 0, 0);
  suchmuster(feld, 0, groesse - 7);
  suchmuster(feld, groesse - 7, 0);

  // Die Taktreihen.
  for (let i = 8; i < groesse - 8; i += 1) {
    const wert = i % 2 === 0 ? 1 : 0;
    feld[6][i] = wert;
    feld[i][6] = wert;
  }

  // Ausrichtungsmuster - aber nicht dort, wo schon ein Suchmuster sitzt.
  const stellen = AUSRICHTUNG[fassung];
  for (const zeile of stellen) {
    for (const spalte of stellen) {
      const beiSuchmuster = (zeile <= 8 && spalte <= 8)
        || (zeile <= 8 && spalte >= groesse - 9)
        || (zeile >= groesse - 9 && spalte <= 8);
      if (beiSuchmuster) continue;
      for (let y = -2; y <= 2; y += 1) {
        for (let x = -2; x <= 2; x += 1) {
          const rand = Math.abs(y) === 2 || Math.abs(x) === 2;
          feld[zeile + y][spalte + x] = rand || (y === 0 && x === 0) ? 1 : 0;
        }
      }
    }
  }

  // Das dunkle Modul - es steht immer an derselben Stelle.
  feld[groesse - 8][8] = 1;
  return feld;
}

// Welche Felder gehoeren der Formatangabe (und bei grossen Fassungen der
// Fassungsangabe)? Sie werden beim Verteilen der Daten uebersprungen.
function belegt(feld, fassung) {
  const groesse = feld.length;
  const frei = leer(groesse).map((zeile) => zeile.map(() => false));
  for (let i = 0; i < groesse; i += 1) {
    for (let j = 0; j < groesse; j += 1) {
      if (feld[i][j] !== null) frei[i][j] = true;
    }
  }
  for (let i = 0; i < 9; i += 1) {
    frei[8][i] = true;
    frei[i][8] = true;
  }
  for (let i = 0; i < 8; i += 1) {
    frei[8][groesse - 1 - i] = true;
    frei[groesse - 1 - i][8] = true;
  }
  if (fassung >= 7) {
    for (let i = 0; i < 6; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        frei[i][groesse - 11 + j] = true;
        frei[groesse - 11 + j][i] = true;
      }
    }
  }
  return frei;
}

// Die Daten im Zickzack von rechts unten nach links oben.
function datenLegen(feld, gesperrt, woerter) {
  const groesse = feld.length;
  const bits = [];
  for (const wort of woerter) {
    for (let i = 7; i >= 0; i -= 1) bits.push((wort >> i) & 1);
  }

  let index = 0;
  let aufwaerts = true;
  for (let rechts = groesse - 1; rechts > 0; rechts -= 2) {
    // Die senkrechte Taktreihe zaehlt nicht als Spalte.
    if (rechts === 6) rechts -= 1;
    for (let schritt = 0; schritt < groesse; schritt += 1) {
      const zeile = aufwaerts ? groesse - 1 - schritt : schritt;
      for (const spalte of [rechts, rechts - 1]) {
        if (gesperrt[zeile][spalte]) continue;
        feld[zeile][spalte] = index < bits.length ? bits[index] : 0;
        index += 1;
      }
    }
    aufwaerts = !aufwaerts;
  }
}

const MASKEN = [
  (z, s) => (z + s) % 2 === 0,
  (z) => z % 2 === 0,
  (_z, s) => s % 3 === 0,
  (z, s) => (z + s) % 3 === 0,
  (z, s) => (Math.floor(z / 2) + Math.floor(s / 3)) % 2 === 0,
  (z, s) => ((z * s) % 2) + ((z * s) % 3) === 0,
  (z, s) => (((z * s) % 2) + ((z * s) % 3)) % 2 === 0,
  (z, s) => (((z + s) % 2) + ((z * s) % 3)) % 2 === 0
];

// Wie unschoen ein Muster ist. Die Norm nennt vier Regeln; gewaehlt wird die
// Maske mit der kleinsten Summe. Das ist kein Geschmack, sondern Lesbarkeit:
// grosse gleichfarbige Flaechen und Muster, die dem Suchmuster aehneln,
// verwirren den Leser im Handy.
function unschoenheit(feld) {
  const groesse = feld.length;
  let summe = 0;

  // Regel 1: fuenf oder mehr gleiche in einer Reihe.
  for (let i = 0; i < groesse; i += 1) {
    for (const waagerecht of [true, false]) {
      let laufend = 1;
      for (let j = 1; j < groesse; j += 1) {
        const jetzt = waagerecht ? feld[i][j] : feld[j][i];
        const vorher = waagerecht ? feld[i][j - 1] : feld[j - 1][i];
        if (jetzt === vorher) {
          laufend += 1;
          continue;
        }
        if (laufend >= 5) summe += 3 + (laufend - 5);
        laufend = 1;
      }
      if (laufend >= 5) summe += 3 + (laufend - 5);
    }
  }

  // Regel 2: gleichfarbige Bloecke aus zwei mal zwei.
  for (let i = 0; i < groesse - 1; i += 1) {
    for (let j = 0; j < groesse - 1; j += 1) {
      const wert = feld[i][j];
      if (wert === feld[i][j + 1] && wert === feld[i + 1][j] && wert === feld[i + 1][j + 1]) summe += 3;
    }
  }

  // Regel 3: Folgen, die wie ein Suchmuster aussehen.
  const muster = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const umgekehrt = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let i = 0; i < groesse; i += 1) {
    for (let j = 0; j + 11 <= groesse; j += 1) {
      for (const waagerecht of [true, false]) {
        const stelle = (k) => (waagerecht ? feld[i][j + k] : feld[j + k][i]);
        let passt = true;
        let passtUmgekehrt = true;
        for (let k = 0; k < 11; k += 1) {
          if (stelle(k) !== muster[k]) passt = false;
          if (stelle(k) !== umgekehrt[k]) passtUmgekehrt = false;
        }
        if (passt || passtUmgekehrt) summe += 40;
      }
    }
  }

  // Regel 4: das Verhaeltnis von hell zu dunkel.
  let dunkel = 0;
  for (const zeile of feld) {
    for (const wert of zeile) dunkel += wert;
  }
  const anteil = (dunkel * 100) / (groesse * groesse);
  summe += Math.floor(Math.abs(anteil - 50) / 5) * 10;
  return summe;
}

// Die fuenfzehn Bit der Formatangabe: Fehlerkorrektur und Maske, gesichert mit
// einem BCH-Code und verwuerfelt, damit sie nie ganz leer ist.
function formatbits(maske) {
  // Fehlerkorrektur M ist die Null.
  let wert = (0b00 << 3) | maske;
  let rest = wert << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((rest >> i) & 1) rest ^= 0b10100110111 << (i - 10);
  }
  return ((wert << 10) | rest) ^ 0b101010000010010;
}

// Und achtzehn Bit fuer die Fassung, ab Fassung 7.
function fassungsbits(fassung) {
  let rest = fassung << 12;
  for (let i = 17; i >= 12; i -= 1) {
    if ((rest >> i) & 1) rest ^= 0b1111100100 << (i - 12);
  }
  return (fassung << 12) | rest;
}

function angabenLegen(feld, fassung, maske) {
  const groesse = feld.length;
  const format = formatbits(maske);
  const bit = (n) => (format >> n) & 1;

  // Die erste Fassung steht senkrecht neben dem Suchmuster oben links und
  // biegt dann waagerecht darunter ab. Zeile und Spalte sind hier leicht zu
  // vertauschen - und ein vertauschter Code sieht vollkommen richtig aus und
  // laesst sich von keinem Handy lesen.
  for (let i = 0; i <= 5; i += 1) feld[i][8] = bit(i);
  feld[7][8] = bit(6);
  feld[8][8] = bit(7);
  feld[8][7] = bit(8);
  for (let i = 9; i <= 14; i += 1) feld[8][14 - i] = bit(i);

  // Die zweite laeuft waagerecht am rechten Rand und senkrecht am unteren.
  for (let i = 0; i <= 7; i += 1) feld[8][groesse - 1 - i] = bit(i);
  for (let i = 8; i <= 14; i += 1) feld[groesse - 15 + i][8] = bit(i);

  if (fassung < 7) return;
  const fbits = fassungsbits(fassung);
  for (let i = 0; i < 18; i += 1) {
    const wert = (fbits >> i) & 1;
    const zeile = Math.floor(i / 3);
    const spalte = i % 3;
    feld[zeile][groesse - 11 + spalte] = wert;
    feld[groesse - 11 + spalte][zeile] = wert;
  }
}

// --- Der Weg von aussen -------------------------------------------------------

// Der fertige Code als Feld aus Nullen und Einsen. Rueckgabe null heisst: zu
// lang fuer die Fassungen, die dieses Modul kennt.
function matrix(text) {
  const bytes = Buffer.from(String(text == null ? "" : text), "utf8");
  const fassung = kleinsteFassung(bytes.length);
  if (!fassung) return null;

  const woerter = verschraenken(bitfolge(bytes, fassung), fassung);
  const grund = grundmuster(fassung);
  const gesperrt = belegt(grund, fassung);

  let bestes = null;
  let besteNote = Infinity;
  for (let maske = 0; maske < 8; maske += 1) {
    const feld = grund.map((zeile) => [...zeile]);
    datenLegen(feld, gesperrt, woerter);
    // Maskiert wird nur, was Daten traegt - Suchmuster und Angaben bleiben.
    for (let z = 0; z < feld.length; z += 1) {
      for (let s = 0; s < feld.length; s += 1) {
        if (gesperrt[z][s]) continue;
        if (MASKEN[maske](z, s)) feld[z][s] ^= 1;
      }
    }
    angabenLegen(feld, fassung, maske);
    const note = unschoenheit(feld);
    if (note < besteNote) {
      besteNote = note;
      bestes = feld;
    }
  }
  return bestes;
}

// Als SVG, fertig zum Einsetzen. Der helle Rand gehoert dazu: ohne ihn findet
// ein Handy den Code auf einem dunklen Bildschirm nicht.
function alsSvg(text, optionen = {}) {
  const feld = matrix(text);
  if (!feld) return "";
  const rand = Number.isFinite(optionen.rand) ? optionen.rand : 4;
  const groesse = feld.length + rand * 2;
  const hell = String(optionen.hell || "#ffffff");
  const dunkel = String(optionen.dunkel || "#000000");

  let pfad = "";
  for (let z = 0; z < feld.length; z += 1) {
    for (let s = 0; s < feld.length; s += 1) {
      if (feld[z][s]) pfad += `M${s + rand} ${z + rand}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${groesse} ${groesse}" shape-rendering="crispEdges" role="img" aria-label="QR-Code">`
    + `<rect width="${groesse}" height="${groesse}" fill="${hell}"/>`
    + `<path d="${pfad}" fill="${dunkel}"/></svg>`;
}

module.exports = { matrix, alsSvg, kleinsteFassung, fasst, fehlerkorrektur };
