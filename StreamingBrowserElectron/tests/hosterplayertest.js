"use strict";
// Was der Werbefilter im Rahmen des Hosters tun darf - und was nicht.
//
// Gemeldet war: bei Filmo zeigte der deutsche VOE-Stream "Werbeblocker sind auf
// VOE nicht erlaubt" statt des Films. Der Netzfilter war unschuldig; im
// Mitschnitt fiel keine einzige Anfrage an VOE selbst. Es lag an einer Datei,
// die er zu Recht abgewiesen hat:
//
//   https://imasdk.googleapis.com/js/sdkloader/ima3.js
//
// Das ist Googles Werbe-SDK. VOEs Player fragt danach - genauer: nach
// google.ima -, und findet er nichts, haelt er das fuer einen Werbeblocker und
// spielt nicht.
//
// AdGuard loest das seit Langem, aber domaingebunden: fuer voe.sx traegt die
// Regel ein $redirect=google-ima3, also "nicht abweisen, sondern eine Attrappe
// ausliefern", und dazu kommen sieben voe.sx-eigene Scriptlets. Gemessen am
// 24.08.2026 an den echten Listen:
//
//   voe.sx                -> 11 Scriptlets, ima3.js mit $redirect=google-ima3
//   tracylocalschool.com  ->  4 Scriptlets, ima3.js ohne Redirect
//
// VOE liefert seinen Player naemlich laengst nicht mehr von voe.sx, sondern von
// taeglich wechselnden Adressen. Dort greift keine dieser Regeln - und deshalb
// ist der Fehler zurueckgekommen, ohne dass an ELFIX etwas geaendert wurde.
//
// Geprueft wird hier dreierlei, alles ohne Netz:
//   1. die Attrappe ist da und tut, was sie soll
//   2. der Player-Rahmen wird als solcher erkannt
//   3. im Player-Rahmen fallen die generischen Verbergen-Regeln weg,
//      die hosterspezifischen aber nicht

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..");
const { AdblockEngine } = require("../src/adblock-engine");

const pruefungen = [];
const pruefe = (name, bedingung, detail = "") => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

// --- Der Player-Rahmen: echter Quelltext aus main.js ------------------------

const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").split("\r\n").join("\n");

function abschnitt(anfang, ende = "}") {
  const zeilen = MAIN.split("\n");
  const von = zeilen.findIndex((z) => z.startsWith(anfang));
  if (von < 0) throw new Error("nicht gefunden: " + anfang);
  let bis = von;
  while (bis < zeilen.length && zeilen[bis] !== ende) bis += 1;
  return zeilen.slice(von, bis + 1).join("\n");
}

const rahmenKontext = vm.createContext({
  console, String, Boolean, URL,
  providerModel: require("../shared/provider-model"),
  isProviderFirstParty: (host, provider) => {
    const name = String(provider?.name || "").toLowerCase();
    if (name.includes("filmo")) return String(host).includes("filmo");
    if (name.includes("aniworld")) return String(host).includes("aniworld");
    return false;
  }
});
rahmenKontext.globalThis = rahmenKontext;
vm.runInContext(abschnitt("function istFremderPlayerRahmen("), rahmenKontext);
const { istFremderPlayerRahmen } = rahmenKontext;

const FILMO = { id: "filmo", name: "Filmo", startUrl: "https://filmo.to/" };
const SEITE = "https://filmo.to/movies/horse-camp-sommer-der-abenteuer";
const PLAYER = "https://tracylocalschool.com/access/eyJpdiI6InV3amFn";
const VOE = "https://voe.sx/e/yxbdfb5klfaa";

pruefe("Das Hauptdokument des Anbieters ist kein Player-Rahmen",
  istFremderPlayerRahmen(FILMO, SEITE, true) === false);
pruefe("Ein eigener Unterrahmen des Anbieters auch nicht",
  istFremderPlayerRahmen(FILMO, "https://filmo.to/n/FTlqyEWdFiUJ", false) === false);
pruefe("Der eingebettete Rahmen des Hosters schon",
  istFremderPlayerRahmen(FILMO, PLAYER, false) === true);
// Der Kern der Sache: erkannt wird die Einbettung, nicht der Name. Eine Liste
// von VOE-Adressen waere schon beim Aufschreiben veraltet.
pruefe("Auch unter einem Namen, der nichts von einem Hoster verraet",
  istFremderPlayerRahmen(FILMO, "https://irgendwas-harmloses.example/access/x", false) === true);
pruefe("Und unter der alten Adresse von VOE ebenso",
  istFremderPlayerRahmen(FILMO, VOE, false) === true);

// --- Die Attrappe -----------------------------------------------------------

(async () => {
  const engine = new AdblockEngine();

  // Zwei Regeln reichen: eine generische und eine, die den Wirt nennt. An
  // echten Listen liesse sich derselbe Unterschied zeigen, aber nicht ohne
  // 23 MB Text und vier Sekunden Aufbau.
  const liste = [{
    id: 1,
    name: "probe",
    text: [
      "##.werbe-generisch",
      "tracylocalschool.com##.werbe-vom-hoster",
      "||werbenetz.example^$script"
    ].join("\n")
  }];
  const gebaut = await engine.bauen(liste);
  pruefe("Die Engine steht", gebaut === true && engine.istBereit());

  const inhalt = engine.ersatzInhalt("google-ima3");
  pruefe("AdGuards Attrappe fuer das IMA-SDK liegt bei",
    typeof inhalt === "string" && inhalt.length > 1000, `${inhalt.length} Zeichen`);

  // Sie muss nicht nur da sein, sie muss auch das tun, wonach der Player fragt.
  const attrappenKontext = vm.createContext({ console });
  attrappenKontext.window = attrappenKontext;
  attrappenKontext.globalThis = attrappenKontext;
  attrappenKontext.document = {
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener() {},
    documentElement: { appendChild() {} },
    head: { appendChild() {} },
    body: { appendChild() {} }
  };
  let lief = "";
  try {
    vm.runInContext(inhalt, attrappenKontext, { filename: "google-ima3.js", timeout: 5000 });
  } catch (fehler) {
    lief = String(fehler.message || fehler);
  }
  pruefe("Sie laesst sich ausfuehren", !lief, lief);
  pruefe("Und danach gibt es google.ima - genau das fragt der Player ab",
    Boolean(attrappenKontext.google && attrappenKontext.google.ima),
    attrappenKontext.google ? Object.keys(attrappenKontext.google).join(",") : "kein google");
  // Eine Attrappe, die Werbung zeigen koennte, waere keine.
  const alsText = String(inhalt);
  pruefe("Sie holt nichts aus dem Netz nach",
    !/XMLHttpRequest\s*\(|fetch\s*\(\s*["'`]https?:/i.test(alsText));

  // --- Kosmetik: generisch faellt weg, hosterspezifisch bleibt --------------

  const voll = engine.kosmetik(PLAYER);
  const eng = engine.kosmetik(PLAYER, { generisch: false });
  pruefe("Voll gefragt kommt die generische Regel mit",
    voll.stile.some((s) => s.includes("werbe-generisch")), voll.stile.join(" "));
  pruefe("Eng gefragt bleibt sie weg",
    !eng.stile.some((s) => s.includes("werbe-generisch")), eng.stile.join(" "));
  pruefe("Die Regel, die den Hoster nennt, bleibt in beiden Faellen",
    voll.stile.some((s) => s.includes("werbe-vom-hoster"))
    && eng.stile.some((s) => s.includes("werbe-vom-hoster")),
    eng.stile.join(" "));

  // Und der Netzfilter bleibt der Netzfilter - die Einschraenkung oben gilt
  // nur fuer das Verbergen, nicht fuers Blocken.
  const werbung = engine.matchRequest({
    url: "https://werbenetz.example/anzeige.js",
    resourceType: "script",
    sourceUrl: PLAYER
  });
  pruefe("Werbung im Player-Rahmen faellt weiter", werbung.block === true, JSON.stringify(werbung));

  const fehler = pruefungen.filter((wert) => !wert).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  process.exit(fehler ? 1 : 0);
})().catch((f) => {
  console.error("FEHLER:", f);
  process.exit(1);
});
