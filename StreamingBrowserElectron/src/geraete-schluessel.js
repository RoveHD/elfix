"use strict";

// Der Geraeteschluessel: was er ist, was aus ihm folgt, und was von einem
// Eintrag ueberhaupt hinausgeht.
//
// Ein Konto besteht aus einer Kennung, die jemand vergibt, und einem Beweis,
// dass man sie fuehren darf. Beides braucht eine Stelle, die das verwaltet.
// Hier gibt es nur ein Geheimnis, das auf dem ersten Geraet entsteht und auf
// das zweite abgetippt wird. Aus ihm faellt alles Weitere:
//
//   Raum      HKDF(...)      wo das Relay die Eintraege ablegt
//   Chiffre   HKDF(...)      womit sie verschlossen sind
//   Kennung   HKDF(...)      womit ein Titel zu einer Eintragskennung wird
//
// Das Relay bekommt Raum und Kennungen zu sehen, nie den Schluessel. Es kann
// die Eintraege damit einander zuordnen und weitergeben, aber nicht lesen -
// und ohne den Schluessel folgt aus einer Eintragskennung auch nicht der
// Titel, denn sie ist ein HMAC und keine Pruefsumme.
//
// Das Modul rechnet nur. Es kennt weder Electron noch eine Verbindung und
// laesst sich deshalb ohne laufende App pruefen.

const crypto = require("crypto");

// Crockford-Base32: ohne I, L, O und U. Wer den Schluessel abschreibt, soll
// nicht an einer Eins scheitern, die wie ein l aussieht.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const SCHLUESSEL_BYTES = 20;
const SCHLUESSEL_ZEICHEN = 32;
const GRUPPE = 8;
// Ein festes Salz. Es haelt zwei Ableitungen mit demselben Zweckwort aus
// verschiedenen Fassungen auseinander, falls sich hier je etwas aendert.
const SALZ = Buffer.from("elfix-geraete-v1");

// --- Schluessel -------------------------------------------------------------

function kodieren(bytes) {
  let bits = 0;
  let wert = 0;
  let aus = "";
  for (const byte of bytes) {
    wert = (wert << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      aus += ALPHABET[(wert >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) aus += ALPHABET[(wert << (5 - bits)) & 31];
  return aus;
}

function dekodieren(schluessel) {
  const sauber = normalisieren(schluessel);
  if (!sauber) return null;
  const bytes = [];
  let bits = 0;
  let wert = 0;
  for (const zeichen of sauber) {
    wert = (wert << 5) | ALPHABET.indexOf(zeichen);
    bits += 5;
    if (bits < 8) continue;
    bytes.push((wert >>> (bits - 8)) & 255);
    bits -= 8;
  }
  return Buffer.from(bytes.slice(0, SCHLUESSEL_BYTES));
}

// Ein neuer Schluessel. 160 Bit aus dem Zufall des Betriebssystems - geraten
// wird das nicht, auch nicht von jemandem, der das Relay betreibt.
function erzeugen() {
  return anzeigen(kodieren(crypto.randomBytes(SCHLUESSEL_BYTES)));
}

// Wie er dasteht: vier Gruppen zu acht Zeichen. Getrennt wird nur fuers Auge -
// gerechnet wird immer mit der zusammenhaengenden Fassung.
function anzeigen(schluessel) {
  const sauber = normalisieren(schluessel);
  if (!sauber) return "";
  return (sauber.match(new RegExp(`.{1,${GRUPPE}}`, "g")) || []).join("-");
}

// Abgetipptes geradeziehen: Kleinschreibung, Trennstriche, Leerzeichen. Und
// die drei Verwechslungen, die beim Abschreiben wirklich vorkommen - I und L
// werden zur Eins, O zur Null. Was danach nicht ins Alphabet passt, ist kein
// Schluessel; ein "fast richtig" gibt es hier nicht.
function normalisieren(wert) {
  const roh = String(wert == null ? "" : wert)
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  if (roh.length !== SCHLUESSEL_ZEICHEN) return "";
  for (const zeichen of roh) {
    if (!ALPHABET.includes(zeichen)) return "";
  }
  return roh;
}

function istGueltig(wert) {
  return Boolean(normalisieren(wert));
}

// --- Ableitungen ------------------------------------------------------------

function teilschluessel(schluessel, zweck, laenge) {
  const roh = dekodieren(schluessel);
  if (!roh) return null;
  return Buffer.from(crypto.hkdfSync("sha256", roh, SALZ, Buffer.from(zweck), laenge));
}

// Alles, was ein Geraet aus dem Schluessel braucht - einmal gerechnet und
// danach behalten. HKDF ist billig, aber nicht so billig, dass man es je
// Eintrag und Sekunde noch einmal machen muesste.
function ableiten(schluessel) {
  const raum = teilschluessel(schluessel, "raum", 16);
  if (!raum) return null;
  return {
    raum: raum.toString("hex"),
    chiffre: teilschluessel(schluessel, "chiffre", 32),
    kennung: teilschluessel(schluessel, "kennung", 32)
  };
}

// Aus dem Titelschluessel ("serie:one-piece") die Kennung, unter der dieser
// Eintrag beim Relay liegt. Ein HMAC, kein Hash: ohne das Geheimnis laesst sich
// keine Liste bekannter Titel durchprobieren.
function eintragId(abgeleitet, key) {
  if (!abgeleitet?.kennung || !key) return "";
  return crypto.createHmac("sha256", abgeleitet.kennung).update(String(key)).digest("hex").slice(0, 32);
}

// --- Verschluesseln ---------------------------------------------------------

function verschluesseln(abgeleitet, wert) {
  if (!abgeleitet?.chiffre) return "";
  const iv = crypto.randomBytes(12);
  const chiffre = crypto.createCipheriv("aes-256-gcm", abgeleitet.chiffre, iv);
  const daten = Buffer.concat([chiffre.update(JSON.stringify(wert), "utf8"), chiffre.final()]);
  return Buffer.concat([iv, chiffre.getAuthTag(), daten]).toString("base64");
}

// Rueckgabe null heisst "damit ist nichts anzufangen" - falscher Schluessel,
// beschaedigter Klumpen, fremde Fassung. Geworfen wird hier nichts: ein
// einzelner unlesbarer Eintrag darf nicht den ganzen Abgleich anhalten.
function entschluesseln(abgeleitet, blob) {
  if (!abgeleitet?.chiffre || !blob) return null;
  try {
    const roh = Buffer.from(String(blob), "base64");
    if (roh.length < 29) return null;
    const entschluessler = crypto.createDecipheriv("aes-256-gcm", abgeleitet.chiffre, roh.subarray(0, 12));
    entschluessler.setAuthTag(roh.subarray(12, 28));
    const klar = Buffer.concat([entschluessler.update(roh.subarray(28)), entschluessler.final()]).toString("utf8");
    const wert = JSON.parse(klar);
    return wert && typeof wert === "object" ? wert : null;
  } catch {
    return null;
  }
}

// --- Was von einem Eintrag hinausgeht ---------------------------------------

function zahl(wert, hoechstens) {
  const n = Number(wert);
  if (!Number.isFinite(n) || n < 0) return 0;
  return hoechstens ? Math.min(n, hoechstens) : n;
}

function zeichen(wert, laenge) {
  return String(wert == null ? "" : wert).slice(0, laenge);
}

// Der Stand eines Titels, wie ihn das andere Geraet braucht - und nicht mehr.
//
// Draussen bleiben mit Absicht:
//   - die Kennung des Eintrags. Sie ist auf jedem Geraet eine andere; zugeordnet
//     wird ueber den Titelschluessel.
//   - das eigene Bild. Es liegt als Data-URL vor und ist um ein Vielfaches
//     groesser als alles andere zusammen. Ein Bild ist kein Fortschritt.
//   - der Verlauf je Eintrag. Er ist eine Chronik dieses Geraets; was daraus
//     zaehlt, steht ohnehin im Stand.
//   - alles, was dieses Geraet selbst ausrechnet: Anbieterkennung, Favicon,
//     Hinweise auf neue Folgen.
function stand(favorit) {
  return {
    key: zeichen(favorit?.key, 300),
    url: zeichen(favorit?.url, 800),
    title: zeichen(favorit?.title, 300),
    type: zeichen(favorit?.type, 20),
    providerName: zeichen(favorit?.providerName, 80),
    thumbnail: /^https?:\/\//i.test(String(favorit?.thumbnail || "")) ? zeichen(favorit.thumbnail, 800) : "",
    season: zahl(favorit?.season, 999),
    episode: zahl(favorit?.episode, 9999),
    position: Math.round(zahl(favorit?.position, 100000)),
    duration: Math.round(zahl(favorit?.duration, 100000)),
    progress: zahl(favorit?.progress, 100),
    completed: Boolean(favorit?.completed),
    episodeCompleted: Boolean(favorit?.episodeCompleted),
    completedManually: Boolean(favorit?.completedManually),
    completedAt: zeichen(favorit?.completedAt, 40),
    continuePending: Boolean(favorit?.continuePending),
    hideFromContinueWatching: Boolean(favorit?.hideFromContinueWatching),
    // Wiederansehen. Ohne diese beiden Felder saehe das andere Geraet einen
    // abgeschlossenen Titel und blendete ihn aus "Weiterschauen" aus - mitten
    // in einem Durchlauf, den es selbst gerade weiterschreibt.
    rewatching: Boolean(favorit?.rewatching && favorit?.completed),
    rewatchCount: zahl(favorit?.rewatchCount, 9999),
    rewatchedAt: zeichen(favorit?.rewatchedAt, 40),
    watched: Boolean(favorit?.watched),
    favorite: favorit?.favorite !== false,
    finalSeason: zahl(favorit?.finalSeason, 999),
    finalEpisode: zahl(favorit?.finalEpisode, 9999),
    completedEpisodes: (Array.isArray(favorit?.completedEpisodes) ? favorit.completedEpisodes : [])
      .slice(-500)
      .map((eintrag) => ({
        key: zeichen(eintrag?.key, 300),
        season: zahl(eintrag?.season, 999),
        episode: zahl(eintrag?.episode, 9999),
        completedAt: zeichen(eintrag?.completedAt, 40)
      })),
    libraryOrder: Number.isFinite(Number(favorit?.libraryOrder)) && Number(favorit?.libraryOrder) >= 0
      ? Number(favorit.libraryOrder)
      : null,
    lastWatchedAt: zeichen(favorit?.lastWatchedAt, 40),
    createdAt: zeichen(favorit?.createdAt, 40)
  };
}

// Woran ein Geraet erkennt, dass sich wirklich etwas geaendert hat.
//
// Ohne diesen Vergleich liefe der Abgleich im Kreis: jedes Uebernehmen
// schriebe die Favoriten, jedes Schreiben meldete den Stand hinaus, und drueben
// begaenne dasselbe von vorn. Verglichen wird genau das, was hinausgeht - nicht
// der Eintrag: an dem haengt viel, das nur dieses Geraet angeht.
function standHash(wert) {
  return crypto.createHash("sha256").update(JSON.stringify(wert)).digest("hex").slice(0, 32);
}

module.exports = {
  ALPHABET,
  SCHLUESSEL_ZEICHEN,
  erzeugen,
  anzeigen,
  normalisieren,
  istGueltig,
  ableiten,
  eintragId,
  verschluesseln,
  entschluesseln,
  stand,
  standHash
};
