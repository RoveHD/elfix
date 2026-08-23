"use strict";
// Meine Geraete: Rechner gegen Telefon, an einem echten Relay.
//
// `geraetetest.js` prueft den Abgleich mit zwei nachgebauten Fassaden. Hier
// steht auf der einen Seite dieselbe Fassade und auf der anderen die *echte*
// Android-Bruecke - dieselbe Datei, die im Paket der App liegt. Das ist der
// Unterschied, auf den es ankommt: geprueft wird nicht, ob das Protokoll
// funktioniert, sondern ob die App es richtig bedient.
//
// Was hier schiefgehen kann und nirgends sonst auffiele:
//
//   - Die Bruecke bildet den Titelschluessel anders. Dann liegt derselbe Titel
//     beim Relay zweimal, beide Geraete melden "verbunden", und nichts kommt an.
//   - Die Bruecke merkt sich das Empfangene statt das daraus Gewordene. Dann
//     schieben Rechner und Telefon denselben Eintrag ewig hin und her - und
//     genau das ist der Normalfall, weil die Adresse auf beiden eine andere ist.
//   - Der erste Abgleich eines leeren Telefons ueberschreibt den Bestand des
//     Rechners. Das waere der teuerste Fehler von allen.
//
// Node 22 bringt WebSocket mit, deshalb laeuft die Bruecke hier wirklich - mit
// derselben Verbindung, die sie im WebView haette.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const WS = require("../../sync-server/node_modules/ws");
const schluesselModul = require("../src/geraete-schluessel");
const geraeteStand = require("../src/geraete-stand");
const { Geraeteabgleich } = require("../src/geraete");

const PORT = Number(process.env.TESTPORT) || 8799;
const ADRESSE = `ws://127.0.0.1:${PORT}`;
const WURZEL = path.join(__dirname, "..");
const BRUECKEN = path.join(WURZEL, "..", "android/app/src/main/assets/kern/eigen");

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Das Telefon: die echte Bruecke -------------------------------------------

const KERN_MODULE = new Set(
  fs.readFileSync(path.join(WURZEL, "..", "android/app/build.gradle"), "utf8")
    .split("\n")
    .map((zeile) => (zeile.match(/"((?:src|shared)\/[a-z-]+\.js)"/) || [])[1])
    .filter(Boolean)
    .map((pfad) => path.basename(pfad, ".js"))
);

function telefon(name) {
  const ereignisse = [];
  const gespeichert = { favoriten: null, sitzungen: null, spiegel: null, zustand: null };
  const lader = (gesucht) => {
    if (!KERN_MODULE.has(gesucht)) {
      throw new Error(`"${gesucht}" steht nicht in kernModule und faehrt nicht mit`);
    }
    const unter = fs.existsSync(path.join(WURZEL, "src", `${gesucht}.js`)) ? "src" : "shared";
    return require(path.join(WURZEL, unter, `${gesucht}.js`));
  };
  const modul = { exports: {} };
  const fenster = {
    crypto: { randomUUID: () => `${name}-${Math.random().toString(16).slice(2)}` },
    // Der Rueckkanal nach Java. Hier wird nur mitgeschrieben, was er sagt.
    ElfixKern: {
      ereignis: (art, nutzlast) => {
        ereignisse.push({ art, nutzlast });
        if (art === "geraete:favoriten") gespeichert.favoriten = nutzlast;
        if (art === "geraete:sitzungen") gespeichert.sitzungen = nutzlast;
        if (art === "geraete:spiegel") gespeichert.spiegel = nutzlast;
        if (art === "geraete:zustand") gespeichert.zustand = nutzlast;
      }
    },
    WebSocket: WS
  };
  vm.runInNewContext(fs.readFileSync(path.join(BRUECKEN, "geraete-bruecke.js"), "utf8"), {
    require: lader,
    module: modul,
    exports: modul.exports,
    console,
    window: fenster,
    // geraete.js greift auf globalThis.WebSocket zu, wenn keine Klasse
    // uebergeben wird - genau wie im WebView.
    WebSocket: WS,
    globalThis: { WebSocket: WS },
    setTimeout,
    clearTimeout,
    Date,
    JSON,
    Math,
    Number,
    String,
    Object,
    Array,
    Boolean,
    Set,
    Map,
    Error,
    RegExp,
    TextEncoder,
    TextDecoder,
    Buffer
  });
  return { bruecke: modul.exports, ereignisse, gespeichert };
}

// --- Der Rechner: dieselbe Fassade wie in geraetetest.js ----------------------

function rechner(name, key, staende = []) {
  const eigen = new Map(staende.map((stand) => [stand.key, stand]));
  const herein = [];
  const abgleich = new Geraeteabgleich({
    WebSocketKlasse: WS,
    onEintrag: (stand) => {
      herein.push(stand.key);
      const neu = schluesselModul.stand(stand);
      eigen.set(stand.key, neu);
      return neu;
    },
    onWeg: (key2) => eigen.delete(key2),
    onSitzung: () => true,
    onSpeichern: () => {},
    onStatus: () => {}
  });
  return {
    abgleich,
    eigen,
    herein,
    an: () => abgleich.konfigurieren({ enabled: true, serverUrl: ADRESSE, schluessel: key, geraetId: name }),
    melden: () => abgleich.abgleichen([...eigen.values()]),
    setzen: (stand) => {
      eigen.set(stand.key, schluesselModul.stand(stand));
      return abgleich.abgleichen([...eigen.values()]);
    },
    loeschen: (key2) => {
      eigen.delete(key2);
      return abgleich.abgleichen([...eigen.values()]);
    }
  };
}

// Ein Favorit, wie er in favorites.json steht - nicht wie ein "Stand".
function favorit(extra = {}) {
  return {
    id: "f1",
    providerId: "aniworld",
    providerName: "AniWorld",
    title: "One Piece",
    url: "https://aniworld.to/anime/stream/one-piece/staffel-1/episode-3",
    type: "serie",
    season: 1,
    episode: 3,
    position: 300,
    duration: 1400,
    progress: 21,
    completedEpisodes: [],
    watchpartyRoom: "",
    ...extra
  };
}

const ANBIETER = [{
  id: "aniworld",
  name: "AniWorld",
  // Bewusst ein anderer Wirt als beim Rechner: das ist der Normalfall, an dem
  // sich der Kreis entzuendet.
  startUrl: "https://185.148.128.1/",
  enabled: true
}];

(async () => {
  const key = schluesselModul.erzeugen();

  // --- Der Schluessel kommt an ------------------------------------------------

  const handy = telefon("handy");
  const geprueft = handy.bruecke.pruefen(` ${key.toLowerCase().replace(/-/g, " ")} `);
  pruefe("Ein abgetippter Schluessel wird angenommen",
    geprueft.ok && geprueft.key === schluesselModul.normalisieren(key),
    "Kleinschreibung, Leerzeichen und Striche duerfen nicht entscheiden");
  pruefe("Unsinn wird abgewiesen",
    !handy.bruecke.pruefen("hallo").ok && !handy.bruecke.pruefen("").ok);
  pruefe("Die Anzeigeform ist dieselbe wie am Rechner",
    handy.bruecke.anzeigen(key) === schluesselModul.anzeigen(key),
    "vier Gruppen zu acht Zeichen");

  // --- Der Rechner hat etwas, das Telefon ist leer ---------------------------

  const pc = rechner("rechner", key, [geraeteStand.staende([favorit()])[0]]);
  pc.an();
  await schlaf(400);
  pc.melden();
  await schlaf(400);

  handy.bruecke.anbieterSetzen(ANBIETER);
  handy.bruecke.favoritenSetzen([]);
  handy.bruecke.sitzungenSetzen([]);
  handy.bruecke.konfigurieren({
    enabled: true, serverUrl: ADRESSE, schluessel: key, geraetId: "handy"
  });
  await schlaf(900);

  const beimHandy = handy.gespeichert.favoriten || [];
  pruefe("Das Telefon uebernimmt den Bestand des Rechners",
    beimHandy.length === 1 && beimHandy[0].title === "One Piece" && beimHandy[0].episode === 3,
    "Fall 2 der Liste: ein leeres Telefon bekommt den bestehenden Stand");
  pruefe("Und ordnet ihn dem eigenen Anbieter zu",
    beimHandy.length === 1 && beimHandy[0].providerId === "aniworld",
    "gefunden ueber den Namen, weil der Wirt hier ein anderer ist");
  pruefe("Ein neuer Eintrag traegt zunaechst die Adresse des anderen Geraets",
    beimHandy.length === 1 && beimHandy[0].url.includes("aniworld.to"),
    "genau wie am Rechner: erst der naechste Abgleich schreibt nur noch die Folge um");
  pruefe("Der Stand selbst kommt vollstaendig an",
    beimHandy.length === 1 && beimHandy[0].position === 300 && beimHandy[0].progress === 21);

  const standVorher = pc.eigen.get(geraeteStand.titelSchluessel(favorit()));
  pruefe("Der Rechner hat dabei nichts verloren",
    pc.eigen.size === 1 && standVorher && standVorher.position === 300,
    "Fall 15: der erste Abgleich eines leeren Telefons darf nichts ueberschreiben");

  // --- Kein Kreis ------------------------------------------------------------

  const spiegelStand = handy.ereignisse.filter((e) => e.art === "geraete:favoriten").length;
  await schlaf(1200);
  handy.bruecke.abgleichen();
  pc.melden();
  await schlaf(900);
  pruefe("Danach ist Ruhe",
    handy.ereignisse.filter((e) => e.art === "geraete:favoriten").length === spiegelStand
    && pc.herein.length <= 1,
    "sonst schoeben sich beide denselben Eintrag ewig hin und her");

  // --- Das Telefon schaut weiter, der Rechner bekommt es --------------------

  const telefonFavoriten = handy.gespeichert.favoriten;
  telefonFavoriten[0].position = 812;
  telefonFavoriten[0].progress = 58;
  telefonFavoriten[0].episode = 4;
  handy.bruecke.favoritenSetzen(telefonFavoriten);
  handy.bruecke.abgleichen();
  await schlaf(900);

  const beimRechner = pc.eigen.get(geraeteStand.titelSchluessel(favorit()));
  pruefe("Was am Telefon laeuft, steht danach am Rechner",
    beimRechner && beimRechner.position === 812 && beimRechner.episode === 4,
    "Fall 3 der Liste");
  pruefe("Und der Rechner behaelt dabei seine eigene Adresse",
    beimRechner && beimRechner.url.includes("aniworld.to"),
    "umgeschrieben wird nur die Folge, nicht der Wirt");

  // --- Der aeltere Stand gewinnt nicht ---------------------------------------

  const alt = schluesselModul.stand({
    ...favorit(), position: 5, progress: 1, episode: 1
  });
  alt.key = geraeteStand.titelSchluessel(favorit());
  // Von Hand in die Ablage des Rechners und gemeldet - das Relay vergibt einen
  // neueren Zeitstempel, also *gewinnt* er hier. Genau das ist die Regel.
  pc.setzen(alt);
  await schlaf(900);
  const nachAlt = handy.gespeichert.favoriten;
  pruefe("Der zuletzt gemeldete Stand gilt",
    nachAlt[0].episode === 1 && nachAlt[0].position === 5,
    "Fall 7: zwei Geraete am selben Titel - es entscheidet die Zeit des Relays, nicht der Inhalt");

  // --- Geloescht bleibt geloescht --------------------------------------------

  pc.loeschen(geraeteStand.titelSchluessel(favorit()));
  await schlaf(900);
  pruefe("Ein geloeschter Titel verschwindet auch am Telefon",
    (handy.gespeichert.favoriten || []).length === 0,
    "der Grabstein - ohne ihn holte das Telefon ihn beim naechsten Abgleich zurueck");

  // --- Was das Relay zu sehen bekommt ----------------------------------------

  const zustand = handy.gespeichert.zustand;
  pruefe("Der Zustand nennt sich verbunden",
    zustand && zustand.enabled === true && zustand.connected === true,
    "Fall 4 der Statusliste");
  pruefe("Der Zustand traegt den Schluessel nur in Anzeigeform",
    zustand && zustand.key === schluesselModul.anzeigen(key),
    "er geht an die eigene Oberflaeche und sonst nirgendwohin");

  // --- Ein fremder Schluessel sieht nichts -----------------------------------

  const fremdes = telefon("fremd");
  fremdes.bruecke.anbieterSetzen(ANBIETER);
  fremdes.bruecke.favoritenSetzen([]);
  fremdes.bruecke.konfigurieren({
    enabled: true, serverUrl: ADRESSE, schluessel: schluesselModul.erzeugen(), geraetId: "fremd"
  });
  await schlaf(900);
  pruefe("Ein fremder Schluessel bekommt nichts zu sehen",
    (fremdes.gespeichert.favoriten || []).length === 0,
    "Fall 13: ein anderer Schluessel ist ein anderer Raum - und ein anderes Schloss");

  // --- Der Spiegel wandert auf die Platte ------------------------------------

  pruefe("Der Spiegel wird zum Speichern gemeldet",
    handy.gespeichert.spiegel && Array.isArray(handy.gespeichert.spiegel.eintraege),
    "sonst faengt jeder Start von vorn an und holt alles noch einmal");
  pruefe("Im Spiegel steht kein Titel und kein Schluessel",
    JSON.stringify(handy.gespeichert.spiegel).indexOf("One Piece") < 0
    && JSON.stringify(handy.gespeichert.spiegel).indexOf(schluesselModul.normalisieren(key)) < 0,
    "er ist eine Buchfuehrung, kein zweiter Bestand");

  // Verbindungen schliessen. Ein Lauf, der seine Sockets offen laesst, macht
  // dem naechsten das Leben schwer - und die Suite laeuft alle Relay-Proben
  // hintereinander am selben Server.
  handy.bruecke.konfigurieren({ enabled: false, serverUrl: ADRESSE, schluessel: "", geraetId: "handy" });
  fremdes.bruecke.konfigurieren({ enabled: false, serverUrl: ADRESSE, schluessel: "", geraetId: "fremd" });
  pc.abgleich.konfigurieren({ enabled: false, serverUrl: ADRESSE, schluessel: "", geraetId: "rechner" });
  await schlaf(200);

  const fehler = pruefungen.filter((ok) => !ok).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  process.exit(fehler ? 1 : 0);
})().catch((fehler) => {
  console.log(`FAIL  Der Lauf brach ab   -> ${fehler?.message || fehler}`);
  console.log(`\n0/${pruefungen.length + 1} bestanden`);
  process.exit(1);
});
