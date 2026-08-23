"use strict";
// Die Node-Bausteine im Kern - Buffer und crypto auf Android.
//
// Der Geraeteabgleich steht und faellt damit, dass beide Seiten dieselben
// Bytes rechnen. Zwei Stellen koennen das verderben, und beide werden hier
// geprueft:
//
//   1. Krypto.java - dass javax.crypto dasselbe liefert wie Node. Das steht
//      nicht hier, sondern in android/kryptoprobe: dort laufen Vektoren, die
//      Node erzeugt hat, gegen die Java-Methoden (17/17).
//   2. kern-knoten.js - die Uebersetzung dazwischen. Ein Buffer, der beim
//      Zusammensetzen ein Byte verliert, oder ein Hex-Wandler, der bei Werten
//      unter 16 die fuehrende Null vergisst, faellt bei einem einzelnen
//      Aufruf nicht auf und bei jedem zweiten Titel.
//
// Hier laeuft (2), und zwar gegen das echte geraete-schluessel.js. Die
// Java-Seite wird durch Node ersetzt - mit genau dem Vertrag, den Krypto.java
// erfuellt, und der ist durch (1) belegt. Zusammen schliesst das den Kreis:
// was der Kern verschluesselt, macht der Rechner wieder auf, und umgekehrt.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

const WURZEL = path.join(__dirname, "..");
const KNOTEN = path.join(WURZEL, "..", "android/app/src/main/assets/kern/kern-knoten.js");

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}

// --- Die Java-Seite, wie Krypto.java sie erfuellt -----------------------------
//
// Alles geht als Hex hinein und heraus, und gcmZu gibt "daten:marke" zurueck -
// genau die Form, die android/kryptoprobe gegen javax.crypto abgenommen hat.
const AndroidKrypto = {
  zufall(anzahl) {
    return crypto.randomBytes(anzahl).toString("hex");
  },
  hkdf(ikmHex, salzHex, infoHex, laenge) {
    return Buffer.from(crypto.hkdfSync("sha256",
      Buffer.from(ikmHex, "hex"), Buffer.from(salzHex, "hex"),
      Buffer.from(infoHex, "hex"), laenge)).toString("hex");
  },
  hmac(schluesselHex, text) {
    return crypto.createHmac("sha256", Buffer.from(schluesselHex, "hex"))
      .update(String(text)).digest("hex");
  },
  hash(text) {
    return crypto.createHash("sha256").update(String(text)).digest("hex");
  },
  gcmZu(schluesselHex, ivHex, klartext) {
    const chiffre = crypto.createCipheriv("aes-256-gcm",
      Buffer.from(schluesselHex, "hex"), Buffer.from(ivHex, "hex"));
    const daten = Buffer.concat([chiffre.update(String(klartext), "utf8"), chiffre.final()]);
    return `${daten.toString("hex")}:${chiffre.getAuthTag().toString("hex")}`;
  },
  gcmAuf(schluesselHex, ivHex, datenHex, markeHex) {
    try {
      const auf = crypto.createDecipheriv("aes-256-gcm",
        Buffer.from(schluesselHex, "hex"), Buffer.from(ivHex, "hex"));
      auf.setAuthTag(Buffer.from(markeHex, "hex"));
      return Buffer.concat([auf.update(Buffer.from(datenHex, "hex")), auf.final()]).toString("utf8");
    } catch {
      return "";
    }
  }
};

// --- kern-knoten.js im eigenen Fenster laufen lassen ---------------------------

const fenster = {
  AndroidKrypto,
  crypto: { getRandomValues: (feld) => crypto.randomFillSync(feld) },
  TextEncoder,
  TextDecoder,
  btoa: (roh) => Buffer.from(roh, "binary").toString("base64"),
  atob: (text) => Buffer.from(text, "base64").toString("binary")
};
const umgebung = { window: fenster, TextEncoder, TextDecoder, console };
umgebung.btoa = fenster.btoa;
umgebung.atob = fenster.atob;
vm.runInNewContext(fs.readFileSync(KNOTEN, "utf8"), umgebung);

const knoten = fenster.ElfixKnoten;
pruefe("Der Ersatz meldet sich an", knoten && knoten.Buffer && knoten.crypto);

// --- Der Buffer ----------------------------------------------------------------

const B = knoten.Buffer;
pruefe("Text hin und zurueck",
  B.from("ümläut ✓").toString() === "ümläut ✓",
  "UTF-8 ueber TextEncoder, nicht ueber charCodeAt");
pruefe("Hex mit fuehrender Null",
  B.from([0, 1, 15, 16, 255]).toString("hex") === "00010f10ff",
  "die haeufigste Art, sich hier zu vertun");
pruefe("Base64 hin und zurueck",
  B.from(B.from("Hallo Welt").toString("base64"), "base64").toString() === "Hallo Welt");
pruefe("concat setzt in der richtigen Reihenfolge zusammen",
  B.concat([B.from([1, 2]), B.from([3]), B.from([4, 5])]).toString("hex") === "0102030405");
pruefe("subarray schneidet und bleibt ein Buffer",
  B.from([1, 2, 3, 4, 5]).subarray(1, 3).toString("hex") === "0203");
pruefe("Ein Buffer laesst sich durchlaufen",
  [...B.from([7, 8, 9])].join(",") === "7,8,9",
  "davon lebt die Base32-Kodierung des Schluessels");
pruefe("length stimmt bei Mehrbytezeichen",
  B.from("ä").length === 2);

// --- geraete-schluessel.js mit diesem Ersatz -----------------------------------
//
// Das echte Modul, nur mit ausgetauschtem crypto und Buffer. Was es hier
// ausrechnet, muss dasselbe sein wie mit Node.

function schluesselModulMit(kryptoErsatz, bufferErsatz) {
  const quelle = fs.readFileSync(path.join(WURZEL, "src/geraete-schluessel.js"), "utf8");
  const modul = { exports: {} };
  vm.runInNewContext(quelle, {
    module: modul,
    exports: modul.exports,
    require: (name) => (name === "crypto" ? kryptoErsatz : require(name)),
    Buffer: bufferErsatz,
    console,
    JSON,
    Math,
    Number,
    String,
    Object,
    Array,
    Boolean,
    RegExp,
    Set,
    Map,
    Date
  });
  return modul.exports;
}

const alsAndroid = schluesselModulMit(knoten.crypto, knoten.Buffer);
const alsRechner = require("../src/geraete-schluessel");

// Ein fester Schluessel - derselbe auf beiden Seiten.
const SCHLUESSEL = "PDWNBCRH-J6KZNF0A-R69V7408-KEMSJJX9";

pruefe("Ein Schluessel gilt hier wie dort",
  alsAndroid.istGueltig(SCHLUESSEL) && alsRechner.istGueltig(SCHLUESSEL));
pruefe("Abgetipptes wird gleich geradegezogen",
  alsAndroid.normalisieren("pdwnbcrh j6kzn f0a-r69v7408-kemsjjx9")
  === alsRechner.normalisieren("pdwnbcrh j6kzn f0a-r69v7408-kemsjjx9"),
  "Kleinschreibung, Leerzeichen, Striche - und I/L zu 1, O zu 0");
pruefe("Auch die Verwechslungen beim Abschreiben",
  alsAndroid.normalisieren(SCHLUESSEL.replace("0", "O"))
  === alsRechner.normalisieren(SCHLUESSEL),
  "wer ein O statt einer Null tippt, landet trotzdem im richtigen Verbund");

const androidAbgeleitet = alsAndroid.ableiten(SCHLUESSEL);
const rechnerAbgeleitet = alsRechner.ableiten(SCHLUESSEL);
pruefe("Derselbe Raum",
  androidAbgeleitet.raum === rechnerAbgeleitet.raum,
  "sonst suchen die Geraete an zwei verschiedenen Stellen");
pruefe("Dieselbe Chiffre",
  Buffer.from(androidAbgeleitet.chiffre).toString("hex")
  === rechnerAbgeleitet.chiffre.toString("hex"));
pruefe("Dieselbe Eintragskennung",
  alsAndroid.eintragId(androidAbgeleitet, "serie:one-piece")
  === alsRechner.eintragId(rechnerAbgeleitet, "serie:one-piece"),
  "sonst liegt derselbe Titel beim Relay zweimal");

// --- Der Kreis: was das eine verschliesst, macht das andere auf ---------------

const stand = alsRechner.stand({
  key: "serie:dandadan",
  url: "https://aniworld.to/anime/stream/dandadan/staffel-1/episode-5",
  title: "Dandadan",
  type: "anime",
  season: 1,
  episode: 5,
  position: 421.5,
  duration: 1440,
  progress: 29,
  completedEpisodes: [{ key: "a:s1:e4", season: 1, episode: 4, completedAt: "2026-08-01T10:00:00.000Z" }],
  lastWatchedAt: "2026-08-24T09:00:00.000Z"
});

const vomRechner = alsRechner.verschluesseln(rechnerAbgeleitet, stand);
const beimTelefon = alsAndroid.entschluesseln(androidAbgeleitet, vomRechner);
pruefe("Was der Rechner verschliesst, macht das Telefon auf",
  beimTelefon && beimTelefon.key === "serie:dandadan" && beimTelefon.position === 422,
  "der eigentliche Punkt der ganzen Uebung");

const vomTelefon = alsAndroid.verschluesseln(androidAbgeleitet, stand);
const beimRechner = alsRechner.entschluesseln(rechnerAbgeleitet, vomTelefon);
pruefe("Und umgekehrt",
  beimRechner && beimRechner.title === "Dandadan" && beimRechner.episode === 5);
pruefe("Auch die abgeschlossenen Folgen kommen ganz an",
  beimRechner && beimRechner.completedEpisodes.length === 1
  && beimRechner.completedEpisodes[0].episode === 4);
pruefe("Jeder Klumpen ist ein anderer",
  alsAndroid.verschluesseln(androidAbgeleitet, stand)
  !== alsAndroid.verschluesseln(androidAbgeleitet, stand),
  "der Zufallsvorspann ist jedes Mal neu - sonst waere am Klumpen ablesbar, "
  + "dass sich nichts geaendert hat");

pruefe("Derselbe Stand ergibt denselben Hash",
  alsAndroid.standHash(stand) === alsRechner.standHash(stand),
  "sonst schoeben sich die Geraete denselben Eintrag ewig hin und her");

// Ein fremder Schluessel darf nichts hergeben - und nichts werfen.
const fremd = alsAndroid.ableiten("00000000-00000000-00000000-00000000");
pruefe("Ein fremder Schluessel oeffnet nichts",
  alsAndroid.entschluesseln(fremd, vomRechner) === null);
pruefe("Ein beschaedigter Klumpen ebenfalls nicht",
  alsAndroid.entschluesseln(androidAbgeleitet, "das ist kein base64 klumpen") === null,
  "ein einzelner unlesbarer Eintrag darf den Abgleich nicht anhalten");
pruefe("Und ein zu kurzer auch nicht",
  alsAndroid.entschluesseln(androidAbgeleitet, Buffer.from("kurz").toString("base64")) === null);

// Ein frisch erzeugter Schluessel muss auf der Gegenseite gelten.
const frisch = alsAndroid.erzeugen();
pruefe("Ein auf dem Telefon erzeugter Schluessel gilt am Rechner",
  alsRechner.istGueltig(frisch),
  frisch.replace(/[^-]/g, "x"));
pruefe("Und fuehrt dort zum selben Raum",
  alsRechner.ableiten(frisch).raum === alsAndroid.ableiten(frisch).raum);

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
