"use strict";
// Der Werbeblocker auf Android - der ganze Weg, in einem Durchgang.
//
// Am Rechner traegt @adguard/tsurlfilter den Werbeblocker: die volle
// Regelsprache mit Pfaden, Bedingungen ($script, $third-party), Ausnahmen (@@)
// und den kosmetischen Regeln. Auf dem Telefon lief bis zuletzt nur ein
// Abgleich von Domainnamen, weil das Paket aus npm kommt und ein ES-Modul ist -
// beides gibt es dort nicht.
//
// Jetzt faehrt es mit, als gebuendelte Browserdatei. Dieser Weg hat vier
// Stellen, an denen er still brechen kann, und jede wird hier gefahren:
//
//   1. Das Buendel. Es entsteht beim Bauen aus scripts/kern-tsurlfilter.js.
//      Faellt esbuild aus oder aendert tsurlfilter seine Form, gibt es keine
//      Datei - und die APK filterte wieder nur nach Domains.
//   2. Es laeuft ohne Node. Ein einziger Zugriff auf require, process oder fs
//      genuegt, und im WebView kaeme nur ein Fehler.
//   3. adblock-engine.js findet es. Die Datei ist dieselbe wie am Rechner; nur
//      *woher* die Engine kommt, unterscheidet sich - und genau diese eine
//      Verzweigung wird hier belegt.
//   4. Die Bruecke tut, was Java von ihr erwartet: bauen, in Stapeln urteilen,
//      die kosmetischen Regeln einer Seite fertig zum Einspielen liefern.
//
// Gefahren wird alles in einem nackten vm-Kontext mit denselben Bausteinen,
// die ein WebView hat - und mit demselben CommonJS-Lader, den kern-host.js
// dort aufspannt.

const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..");
const BRUECKEN = path.join(WURZEL, "..", "android/app/src/main/assets/kern/eigen");
const GRADLE = fs.readFileSync(path.join(WURZEL, "..", "android/app/build.gradle"), "utf8");
const KERN_HOST = fs.readFileSync(
  path.join(WURZEL, "..", "android/app/src/main/assets/kern/kern-host.js"), "utf8");

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}

function fertig() {
  const bestanden = pruefungen.filter(Boolean).length;
  console.log(`${bestanden}/${pruefungen.length} bestanden`);
  process.exit(bestanden === pruefungen.length ? 0 : 1);
}

// --- 1. Das Buendel entsteht ------------------------------------------------

const ablage = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-tsurl-"));
const buendel = path.join(ablage, "tsurlfilter.js");
const bau = require("child_process").spawnSync(
  process.execPath, [path.join(WURZEL, "scripts/kern-tsurlfilter.js"), buendel],
  { encoding: "utf8", cwd: WURZEL });

if (bau.status !== 0) {
  // Ohne node_modules ist das kein Fehler dieser Aenderung, sondern eine
  // fehlende Abhaengigkeit - genau wie beim adblocktest.
  console.log(`FAIL  tsurlfilter laesst sich buendeln   -> ${String(bau.stderr || bau.stdout).trim().split("\n")[0]}`);
  console.log("0/1 bestanden");
  process.exit(1);
}
pruefe("tsurlfilter laesst sich buendeln", fs.existsSync(buendel),
  `${(fs.statSync(buendel).size / 1024 / 1024).toFixed(1)} MB`);

// --- 2. Es laeuft in dem, was ein WebView hat --------------------------------

/**
 * Ein Kontext ohne Node.
 *
 * Bewusst karg: kein require, kein process, kein Buffer. Was das Buendel oder
 * ein Modul darueber hinaus anfasst, faellt hier auf - und nicht erst auf dem
 * Telefon, wo es niemand sieht.
 */
function kontextBauen() {
  const kontext = vm.createContext({
    console, URL, URLSearchParams, TextEncoder, TextDecoder, Math, JSON, Date,
    setTimeout, clearTimeout, setInterval, clearInterval, performance,
    crypto: require("crypto").webcrypto
  });
  kontext.window = kontext;
  kontext.globalThis = kontext;
  kontext.self = kontext;
  return kontext;
}

const kontext = kontextBauen();
let ladefehler = null;
try {
  vm.runInContext(fs.readFileSync(buendel, "utf8"), kontext, { filename: "tsurlfilter.js" });
} catch (fehler) {
  ladefehler = fehler;
}
pruefe("Das Buendel laeuft ohne Node", !ladefehler, ladefehler && ladefehler.message);
pruefe("und haengt am erwarteten globalen Namen",
  Boolean(kontext.ELFIX_TSURLFILTER && kontext.ELFIX_TSURLFILTER.Engine));

// --- 3. + 4. Die geteilten Module und die Bruecke ---------------------------

/**
 * Der Lader des Kerns, nachgestellt.
 *
 * kern-host.js loest require("adblock-engine") ueber den blossen Dateinamen
 * auf, weil im Paket alle Module flach nebeneinander liegen. Ein Modul, das
 * hier gefunden wird, aber nicht in kernModule steht, faehrt gar nicht mit -
 * deshalb wird auch das geprueft.
 */
const KERN_MODULE = new Set(
  GRADLE.split("\n")
    .map((zeile) => (zeile.match(/"((?:src|shared)\/[a-z-]+\.js)"/) || [])[1])
    .filter(Boolean)
    .map((pfad) => path.basename(pfad, ".js"))
);

const geladen = {};
function kernRequire(name) {
  if (geladen[name]) return geladen[name].exports;
  if (!KERN_MODULE.has(name)) {
    throw new Error(`"${name}" steht nicht in kernModule und faehrt nicht mit`);
  }
  const unter = fs.existsSync(path.join(WURZEL, "src", `${name}.js`)) ? "src" : "shared";
  const quelle = fs.readFileSync(path.join(WURZEL, unter, `${name}.js`), "utf8");
  const modul = { exports: {} };
  geladen[name] = modul;
  vm.runInContext(
    `(function(module, exports, require, globalThis){${quelle}\n})`,
    kontext, { filename: `${name}.js` }
  )(modul, modul.exports, kernRequire, kontext);
  return modul.exports;
}

pruefe("adblock-engine.js faehrt in den Assets mit", KERN_MODULE.has("adblock-engine"));
pruefe("adblock-kosmetik.js ebenfalls", KERN_MODULE.has("adblock-kosmetik"));
pruefe("kern-host.js haelt den eigenen Abruf des WebViews fest",
  /browserAbruf/.test(KERN_HOST));

// Die Listen holt die Bruecke ueber den eigenen Abruf des WebViews von der
// Adresse, unter der Java sie ausliefert. Hier steht eine kleine Liste, in der
// jede Regelart genau einmal vorkommt.
const LISTE = [
  "! Titel: Probeliste",
  "||werbenetz.example^",
  "||anbieter.example/ads/*$script",
  "@@||anbieter.example/player^",
  "||zaehler.example^$image,domain=anbieter.example",
  "anbieter.example##.werbe-schicht"
].join("\n");

kontext.ElfixKern = {
  browserAbruf: (adresse) => Promise.resolve({
    ok: String(adresse).endsWith("/2.txt"),
    status: String(adresse).endsWith("/2.txt") ? 200 : 404,
    text: () => Promise.resolve(LISTE)
  })
};

const bruecke = (() => {
  const quelle = fs.readFileSync(path.join(BRUECKEN, "adblock-bruecke.js"), "utf8");
  const modul = { exports: {} };
  vm.runInContext(
    `(function(module, exports, require, globalThis){${quelle}\n})`,
    kontext, { filename: "adblock-bruecke.js" }
  )(modul, modul.exports, kernRequire, kontext);
  return modul.exports;
})();

pruefe("Die Bruecke bietet, was Java ruft",
  ["bauen", "urteile", "seitenregeln", "werbeHost", "stand"]
    .every((name) => typeof bruecke[name] === "function"));

bruecke.bauen([{ id: 2, url: "https://elfix.listen/2.txt" }]).then((stand) => {
  pruefe("Die Engine baut sich aus der abgelegten Liste",
    stand && stand.bereit === true && stand.listen === 1,
    stand && JSON.stringify(stand));
  pruefe("und zaehlt die Regeln", stand && stand.regeln >= 5, stand && String(stand.regeln));

  const urteile = bruecke.urteile([
    { url: "https://werbenetz.example/pop.js", typ: "script", quelle: "https://anbieter.example/serie" },
    { url: "https://anbieter.example/ads/banner.js", typ: "script", quelle: "https://anbieter.example/serie" },
    { url: "https://anbieter.example/player/hls.js", typ: "script", quelle: "https://anbieter.example/serie" },
    { url: "https://zaehler.example/pixel.png", typ: "image", quelle: "https://anbieter.example/serie" },
    { url: "https://zaehler.example/pixel.png", typ: "script", quelle: "https://anbieter.example/serie" }
  ]);
  const sagt = (i) => (urteile[i] || {});

  pruefe("Eine Domainsperre blockt", sagt(0).block === true);
  // Genau das kann eine Domainliste nicht: dieselbe Domain, einmal gesperrt
  // und einmal erlaubt - entschieden am Pfad.
  pruefe("Ein Pfad mit $script blockt", sagt(1).block === true, sagt(1).regel);
  pruefe("Eine @@-Ausnahme erlaubt ausdruecklich",
    sagt(2).block === false && sagt(2).erlaubt === true, sagt(2).regel);
  pruefe("$image mit $domain= greift", sagt(3).block === true, sagt(3).regel);
  pruefe("dieselbe Adresse als Skript aber nicht", sagt(4).block === false);
  pruefe("Jedes Urteil nennt seine Liste", sagt(0).liste === 2, String(sagt(0).liste));
  // Java ordnet die Antworten ueber genau diese drei Angaben wieder seinen
  // Fragen zu und nicht ueber die Reihenfolge. Fehlte eine davon, landeten
  // Urteile an fremden Adressen - und das sieht man erst an einer Seite, die
  // nicht mehr laedt.
  pruefe("und traegt Adresse, Art und Quelle zurueck",
    urteile.every((urteil) => urteil.url && urteil.typ
      && urteil.quelle === "https://anbieter.example/serie"));

  const regeln = bruecke.seitenregeln("https://anbieter.example/serie/stream/etwas");
  pruefe("Kosmetische Regeln kommen fertig zum Einspielen",
    regeln.selektoren === 1 && regeln.stil.includes(".werbe-schicht"),
    JSON.stringify(regeln.stil).slice(0, 90));
  pruefe("Eine fremde Seite bekommt sie nicht",
    bruecke.seitenregeln("https://woanders.example/x").selektoren === 0);

  pruefe("Ein Werbewirt ist als solcher zu erkennen",
    bruecke.werbeHost("werbenetz.example") === true);

  fs.rmSync(ablage, { recursive: true, force: true });
  fertig();
}).catch((fehler) => {
  pruefe("Die Engine baut sich aus der abgelegten Liste", false, fehler && fehler.message);
  fs.rmSync(ablage, { recursive: true, force: true });
  fertig();
});
