"use strict";
// Die Bilanz ueber alle eigenen Geraete - Rechner, Telefon und Fernseher an
// einem echten Relay.
//
// Der gemeldete Fehler: PC drei Stunden, Handy zwei, Fernseher vier - und im
// Rueckblick stand auf jedem Geraet nur seine eigene Zahl. Der Abgleich war
// dafuer laengst gebaut, und `geraeteandroidtest.js` prueft ihn auch. Was er
// nicht prueft, ist der Weg der *Sitzungen*: sie gingen auf Android einmal beim
// Start in die Bruecke und danach nie wieder.
//
// Deshalb steht hier ausdruecklich das, was `geraeteandroidtest.js` nicht tut:
//
//   - Sitzungen entstehen *waehrend* der Abgleich schon laeuft. Genau das war
//     der Fehler: sie kamen nie hinaus, weil die Bruecke bis zum naechsten
//     App-Start die Liste von damals kannte.
//   - Drei Geraete, nicht zwei. Bei zweien faellt nicht auf, wenn ein Geraet
//     nur weitergibt, was es selbst gemessen hat.
//   - Gerechnet wird mit `statistik.auswerten` - derselben Funktion, aus der
//     Rueckblick und Wrapped ihre Zahlen ziehen -, und zwar auf genaue Sekunden.
//     "Ungefaehr neun Stunden" waere kein Ergebnis.
//   - Die laufende Sitzung bleibt drinnen. Sie waechst noch; was von ihr
//     hinausginge, stuende drueben fuer immer als fertige Sitzung da.
//
// Die Faelle tragen unten ihre Nummern aus der Aufgabe (S1 bis S8).

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const WS = require("../../sync-server/node_modules/ws");
const schluesselModul = require("../src/geraete-schluessel");
const statistik = require("../src/statistik");
const sitzungslauf = require("../src/sitzungslauf");
const { Geraeteabgleich, SITZUNG_PRAEFIX } = require("../src/geraete");

if (!globalThis.WebSocket) globalThis.WebSocket = WS;

const PORT = Number(process.env.TESTPORT) || 8799;
const ADRESSE = `ws://127.0.0.1:${PORT}`;
const WURZEL = path.join(__dirname, "..");
const BRUECKEN = path.join(WURZEL, "..", "android/app/src/main/assets/kern/eigen");

// Die Zahlen aus der Aufgabe. Drei Stunden, zwei Stunden, vier Stunden.
const PC_SEKUNDEN = 10800;
const HANDY_SEKUNDEN = 7200;
const TV_SEKUNDEN = 14400;
const ZUSAMMEN = PC_SEKUNDEN + HANDY_SEKUNDEN + TV_SEKUNDEN; // 32400 = 9 Stunden
const JAHR = 2026;

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

async function warteBis(bedingung, was, hoechstens = 15000) {
  const bis = Date.now() + hoechstens;
  while (Date.now() < bis) {
    let erfuellt = false;
    try {
      erfuellt = Boolean(bedingung());
    } catch {
      erfuellt = false;
    }
    if (erfuellt) return true;
    await schlaf(50);
  }
  console.log(`      (Wartezeit abgelaufen: ${was})`);
  return false;
}

/** Eine abgeschlossene Sitzung, wie sie in sitzungen.json steht. */
function satz(id, tag, sekunden, extra = {}) {
  return {
    id,
    favoriteId: "f1",
    url: "https://aniworld.to/anime/stream/attack-on-titan/staffel-2/episode-4",
    titel: "Attack on Titan",
    providerId: "aniworld",
    providerName: "AniWorld",
    type: "serie",
    season: 2,
    episode: 4,
    begonnenAm: `${JAHR}-${tag}T20:00:00.000Z`,
    beendetAm: `${JAHR}-${tag}T21:00:00.000Z`,
    sekunden,
    ...extra
  };
}

/** Die Jahresbilanz - dieselbe Rechnung, die Rueckblick und Wrapped anstellen. */
function jahresSekunden(sitzungen) {
  const grenzen = sitzungslauf.zeitraumGrenzen(String(JAHR), Date.parse(`${JAHR}-12-31T23:59:00Z`));
  const bilanz = statistik.auswerten(sitzungen, {
    von: Number.isFinite(grenzen.von) ? grenzen.von : 0,
    bis: grenzen.bis
  });
  return bilanz.sekunden;
}

// --- Android: die echte Bruecke ----------------------------------------------

const KERN_MODULE = new Set(
  fs.readFileSync(path.join(WURZEL, "..", "android/app/build.gradle"), "utf8")
    .split("\n")
    .map((zeile) => (zeile.match(/"((?:src|shared)\/[a-z-]+\.js)"/) || [])[1])
    .filter(Boolean)
    .map((pfad) => path.basename(pfad, ".js"))
);

/**
 * Ein Android-Geraet: die echte Bruecke plus das, was Java um sie herum tut.
 *
 * <p>Java ist hier bewusst nachgebaut und nicht weggelassen - der Fehler sass
 * genau in dieser Naht. Nachgebaut wird deshalb wortwoertlich, was
 * `Statistik.java` und `Geraete.java` tun:
 *
 * <ul>
 *   <li>`Statistik` haelt die Liste im Speicher und meldet nach jedem Sichern.
 *   <li>`Geraete.sitzungenGemeldet()` reicht sie samt der offenen Kennungen in
 *       die Bruecke und stoesst den Abgleich gebuendelt an.
 *   <li>Was hereinkommt, geht ueber `Statistik.uebernehmen` - also durch
 *       dieselbe Entdoppelung ueber die Kennung, die `Sitzungen.vereinen` in
 *       Java macht.
 * </ul>
 */
function android(name) {
  const ereignisse = [];
  const lader = (gesucht) => {
    if (!KERN_MODULE.has(gesucht)) {
      throw new Error(`"${gesucht}" steht nicht in kernModule und faehrt nicht mit`);
    }
    const unter = fs.existsSync(path.join(WURZEL, "src", `${gesucht}.js`)) ? "src" : "shared";
    return require(path.join(WURZEL, unter, `${gesucht}.js`));
  };
  const modul = { exports: {} };

  // Das Gegenstueck zu Statistik.java: die Liste im Speicher und ihre offenen
  // Saetze. Bewusst *nicht* die Liste der Bruecke - dass beide auseinander
  // laufen koennen, ist der ganze Punkt der Pruefung.
  const eigene = { sitzungen: [], offene: new Set(), uebernommen: 0 };
  let anstossen = () => {};

  const fenster = {
    crypto: { randomUUID: () => `${name}-${Math.random().toString(16).slice(2)}` },
    ElfixKern: {
      ereignis: (art, nutzlast) => {
        ereignisse.push({ art, nutzlast });
        if (art !== "geraete:sitzungen") return;
        // Genau der Weg aus Geraete.java: nicht in die Datei, sondern durch
        // Statistik.uebernehmen - und die Nutzlast ist der Zuwachs, nicht die
        // ganze Liste.
        const { sitzungen: vereint, dazu } = statistik.vereinen(eigene.sitzungen, nutzlast);
        eigene.sitzungen = vereint;
        eigene.uebernommen += dazu;
        if (dazu) anstossen();
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
    WebSocket: WS,
    globalThis: { WebSocket: WS },
    setTimeout, clearTimeout, Date, JSON, Math, Number, String, Object, Array,
    Boolean, Set, Map, Error, RegExp, TextEncoder, TextDecoder, Buffer
  });
  const bruecke = modul.exports;

  // Geraete.sitzungenReichen() + abgleichenSpaeter(): die Leitung, die fehlte.
  const reichen = () => bruecke.sitzungenSetzen(eigene.sitzungen, [...eigene.offene]);
  anstossen = () => {
    reichen();
    bruecke.abgleichen();
  };

  return {
    name,
    bruecke,
    ereignisse,
    eigene,
    sekunden: () => jahresSekunden(eigene.sitzungen),
    ids: () => eigene.sitzungen.map((sitzung) => sitzung.id).sort(),
    /** Eine abgeschlossene Sitzung entsteht hier - Statistik.speichern() meldet. */
    messen: (sitzung) => {
      const { sitzungen: vereint } = statistik.vereinen(eigene.sitzungen, [sitzung]);
      eigene.sitzungen = vereint;
      eigene.offene.delete(sitzung.id);
      anstossen();
    },
    /** Eine Sitzung, die noch waechst. Sie steht in der Ablage, gehoert aber nicht hinaus. */
    laufend: (sitzung) => {
      const { sitzungen: vereint } = statistik.vereinen(eigene.sitzungen, [sitzung]);
      eigene.sitzungen = vereint;
      eigene.offene.add(sitzung.id);
      anstossen();
    },
    abschliessen: (id) => {
      eigene.offene.delete(id);
      anstossen();
    },
    an: (key) => {
      bruecke.spiegelSetzen({});
      bruecke.anbieterSetzen([]);
      bruecke.favoritenSetzen([]);
      reichen();
      bruecke.konfigurieren({
        enabled: true, serverUrl: ADRESSE, schluessel: key, geraetId: `${name}-id`
      });
    },
    aus: () => bruecke.konfigurieren({
      enabled: false, serverUrl: ADRESSE, schluessel: "", geraetId: `${name}-id`
    }),
    abgleichen: () => { reichen(); bruecke.abgleichen(); }
  };
}

// --- Der Rechner: dieselbe Buchfuehrung wie main.js ---------------------------

function rechner(name) {
  const eigene = { sitzungen: [], offene: new Set(), uebernommen: 0 };
  const abgleich = new Geraeteabgleich({
    WebSocketKlasse: WS,
    onEintrag: (stand) => schluesselModul.stand(stand),
    onWeg: () => false,
    // uebernimmGeraeteSitzung in main.js, Zeile fuer Zeile.
    onSitzung: (sitzung) => {
      if (!sitzung?.id || !sitzung?.begonnenAm) return false;
      const { sitzungen: vereint, dazu } = statistik.vereinen(eigene.sitzungen, [sitzung]);
      if (!dazu) return false;
      eigene.sitzungen = vereint;
      eigene.uebernommen += dazu;
      return true;
    },
    onSpeichern: () => {},
    onStatus: () => {}
  });
  // geraeteSitzungen() in main.js: alles, was der Spiegel noch nicht kennt -
  // ohne die, die noch laufen.
  const hinaus = () => {
    const liste = [];
    for (const sitzung of eigene.sitzungen) {
      const id = String(sitzung?.id || "");
      if (!id || eigene.offene.has(id)) continue;
      const key = `${SITZUNG_PRAEFIX}${id}`;
      if (abgleich.kennt(key)) continue;
      liste.push({ key, sitzung });
    }
    return liste;
  };
  const anstossen = () => {
    abgleich.abgleichen([]);
    abgleich.anhaengen(hinaus());
  };
  return {
    name,
    abgleich,
    eigene,
    sekunden: () => jahresSekunden(eigene.sitzungen),
    ids: () => eigene.sitzungen.map((sitzung) => sitzung.id).sort(),
    messen: (sitzung) => {
      const { sitzungen: vereint } = statistik.vereinen(eigene.sitzungen, [sitzung]);
      eigene.sitzungen = vereint;
      anstossen();
    },
    an: (key) => abgleich.konfigurieren({
      enabled: true, serverUrl: ADRESSE, schluessel: key, geraetId: `${name}-id`
    }),
    aus: () => abgleich.konfigurieren({
      enabled: false, serverUrl: ADRESSE, schluessel: "", geraetId: `${name}-id`
    }),
    abgleichen: anstossen
  };
}

(async () => {
  const key = schluesselModul.erzeugen();

  const pc = rechner("Rechner");
  const handy = android("Handy");
  const tv = android("Fernseher");

  /* ------------------------------------------------------------------- S1 */
  // Der Rechner hat Sitzung A, Android ist leer.

  pc.messen(satz("A", "01-05", PC_SEKUNDEN));
  pc.an(key);
  await warteBis(() => pc.abgleich.status().connected, "Rechner verbindet sich");
  pc.abgleichen();

  handy.an(key);
  await warteBis(() => handy.bruecke.status().connected, "Telefon verbindet sich");
  handy.abgleichen();

  await warteBis(() => handy.eigene.sitzungen.length === 1, "Telefon uebernimmt A");
  pruefe("S1. Ein leeres Telefon uebernimmt die Sitzung des Rechners",
    handy.ids().join(",") === "A",
    `Telefon hat [${handy.ids().join(",")}]`);
  pruefe("S1. Und rechnet sie in seiner Jahresbilanz mit",
    handy.sekunden() === PC_SEKUNDEN,
    `${handy.sekunden()} statt ${PC_SEKUNDEN} Sekunden`);
  pruefe("S1. Der Rechner verliert dabei nichts",
    pc.sekunden() === PC_SEKUNDEN, `${pc.sekunden()} Sekunden`);

  /* ------------------------------------------------------------------- S2 */
  // Und jetzt der eigentliche Fehler: das Telefon misst *waehrend* die App
  // laeuft. Vorher kannte die Bruecke bis zum naechsten Start nur die Liste vom
  // Start - diese Sitzung waere nie hinausgegangen.

  handy.messen(satz("B", "01-06", HANDY_SEKUNDEN));
  await warteBis(() => pc.eigene.sitzungen.length === 2, "Rechner bekommt B");
  pruefe("S2. Eine Sitzung, die erst zur Laufzeit entsteht, geht hinaus",
    pc.ids().join(",") === "A,B",
    `Rechner hat [${pc.ids().join(",")}] - vorher blieb B bis zum App-Neustart liegen`);
  pruefe("S2. Danach haben beide dieselbe Bilanz",
    pc.sekunden() === PC_SEKUNDEN + HANDY_SEKUNDEN
    && handy.sekunden() === PC_SEKUNDEN + HANDY_SEKUNDEN,
    `Rechner ${pc.sekunden()}, Telefon ${handy.sekunden()}`);

  /* ------------------------------------------------------------------- S3 */
  // Der Fernseher kommt dazu und legt C oben drauf.

  tv.an(key);
  await warteBis(() => tv.bruecke.status().connected, "Fernseher verbindet sich");
  tv.abgleichen();
  await warteBis(() => tv.eigene.sitzungen.length === 2, "Fernseher holt A und B");
  tv.messen(satz("C", "01-07", TV_SEKUNDEN));

  await warteBis(() => pc.eigene.sitzungen.length === 3
    && handy.eigene.sitzungen.length === 3
    && tv.eigene.sitzungen.length === 3, "alle drei haben A, B und C");

  pruefe("S3. Alle drei Geraete kennen A, B und C",
    pc.ids().join(",") === "A,B,C"
    && handy.ids().join(",") === "A,B,C"
    && tv.ids().join(",") === "A,B,C",
    `PC [${pc.ids()}] Handy [${handy.ids()}] TV [${tv.ids()}]`);

  /* ------------------------------------------------------------------- S8 */
  // Die Zahl aus der Aufgabe, auf die Sekunde: 10800 + 7200 + 14400 = 32400.

  pruefe("S8. Das Wrapped desselben Jahres zeigt auf allen drei 32.400 Sekunden",
    pc.sekunden() === ZUSAMMEN && handy.sekunden() === ZUSAMMEN && tv.sekunden() === ZUSAMMEN,
    `PC ${pc.sekunden()}, Handy ${handy.sekunden()}, TV ${tv.sekunden()} (erwartet ${ZUSAMMEN})`);
  pruefe("S8. Und das sind genau neun Stunden",
    pc.sekunden() / 3600 === 9, `${pc.sekunden() / 3600} Stunden`);

  /* ------------------------------------------------------------------- S4 */
  // Mehrfacher Abgleich. Keine Duplikate, keine achtzehn Stunden.

  const vorherUebernommen = pc.eigene.uebernommen + handy.eigene.uebernommen + tv.eigene.uebernommen;
  for (let runde = 0; runde < 4; runde += 1) {
    pc.abgleichen();
    handy.abgleichen();
    tv.abgleichen();
    await schlaf(300);
  }
  await schlaf(1200);

  pruefe("S4. Vier weitere Abgleiche bringen nichts Neues",
    pc.eigene.uebernommen + handy.eigene.uebernommen + tv.eigene.uebernommen === vorherUebernommen,
    `${pc.eigene.uebernommen + handy.eigene.uebernommen + tv.eigene.uebernommen} statt ${vorherUebernommen} Uebernahmen`);
  pruefe("S4. Und die Bilanz bleibt bei 32.400 Sekunden",
    pc.sekunden() === ZUSAMMEN && handy.sekunden() === ZUSAMMEN && tv.sekunden() === ZUSAMMEN,
    `PC ${pc.sekunden()}, Handy ${handy.sekunden()}, TV ${tv.sekunden()}`);
  pruefe("S4. Keine Sitzung steht zweimal da",
    [pc, handy, tv].every((geraet) => new Set(geraet.ids()).size === geraet.ids().length),
    `${pc.eigene.sitzungen.length}/${handy.eigene.sitzungen.length}/${tv.eigene.sitzungen.length} Saetze`);

  /* ------------------------------------------------------------------- S6 */
  // Dieselbe Sitzung noch einmal - von Hand nachgeschoben, als haette das
  // Relay sie zweimal ausgeliefert.

  const vorherSekunden = pc.sekunden();
  const nochmal = satz("C", "01-07", TV_SEKUNDEN);
  const { dazu: pcDazu } = statistik.vereinen(pc.eigene.sitzungen, [nochmal]);
  const { dazu: handyDazu } = statistik.vereinen(handy.eigene.sitzungen, [nochmal]);
  pruefe("S6. Exakt dieselbe Sitzung ein zweites Mal zaehlt nicht",
    pcDazu === 0 && handyDazu === 0, `dazu: PC ${pcDazu}, Handy ${handyDazu}`);
  pruefe("S6. Die Bilanz bleibt unveraendert",
    pc.sekunden() === vorherSekunden, `${pc.sekunden()} statt ${vorherSekunden}`);

  /* ------------------------------------------------------------------- S5 */
  // Dieselbe Folge auf zwei Geraeten, aber zwei wirklich verschiedene
  // Wiedergaben. Sie tragen verschiedene Kennungen, also zaehlen beide.

  const gleicheFolge = { season: 5, episode: 12, titel: "Bleach" };
  handy.messen(satz("handy-bleach", "03-01", 1200, gleicheFolge));
  tv.messen(satz("tv-bleach", "03-01", 1500, gleicheFolge));
  await warteBis(() => pc.eigene.sitzungen.length === 5, "beide Bleach-Sitzungen beim Rechner");

  pruefe("S5. Zwei echte Wiedergaben derselben Folge zaehlen beide",
    pc.sekunden() === ZUSAMMEN + 2700,
    `${pc.sekunden()} statt ${ZUSAMMEN + 2700} Sekunden`);
  pruefe("S5. Und stehen auf allen Geraeten gleich",
    handy.sekunden() === pc.sekunden() && tv.sekunden() === pc.sekunden(),
    `PC ${pc.sekunden()}, Handy ${handy.sekunden()}, TV ${tv.sekunden()}`);

  /* --------------------------------------------- Die laufende Sitzung */
  // Sie steht schon in der Ablage - damit ein Prozessabbruch sie nicht kostet -,
  // ist aber noch kein fertiger Satz. Ginge sie hinaus, stuende drueben ein
  // Zwischenstand als abgeschlossene Sitzung, und eine Sitzung wird nie wieder
  // ueberschrieben.

  const bilanzVorher = pc.sekunden();
  tv.laufend(satz("tv-laeuft", "04-01", 300));
  await schlaf(1500);
  pruefe("Eine noch laufende Sitzung bleibt beim eigenen Geraet",
    !pc.eigene.sitzungen.some((sitzung) => sitzung.id === "tv-laeuft")
    && pc.sekunden() === bilanzVorher,
    `Rechner: ${pc.sekunden()} Sekunden, ${pc.eigene.sitzungen.length} Saetze`);
  pruefe("Beim Fernseher selbst steht sie sehr wohl",
    tv.eigene.sitzungen.some((sitzung) => sitzung.id === "tv-laeuft"),
    "sonst waere sie bei einem Absturz verloren");

  // Und sobald sie abgeschlossen ist, geht sie hinaus - mit ihrer wirklichen
  // Dauer und nicht mit dem Zwischenstand.
  tv.eigene.sitzungen = tv.eigene.sitzungen.map((sitzung) =>
    (sitzung.id === "tv-laeuft" ? { ...sitzung, sekunden: 1800 } : sitzung));
  tv.abschliessen("tv-laeuft");
  await warteBis(() => pc.eigene.sitzungen.some((sitzung) => sitzung.id === "tv-laeuft"),
    "abgeschlossene Sitzung geht hinaus");
  const angekommen = pc.eigene.sitzungen.find((sitzung) => sitzung.id === "tv-laeuft");
  pruefe("Abgeschlossen geht sie hinaus - mit ihrer wirklichen Dauer",
    Boolean(angekommen) && angekommen.sekunden === 1800,
    angekommen ? `${angekommen.sekunden} Sekunden` : "nicht angekommen");

  /* --------------------------------------- Der Zuwachs statt der ganzen Liste */
  // Java bekommt nur das, was wirklich neu hereinkam. Vorher ging die ganze
  // Liste, und dann entschied die Reihenfolge zweier Nachrichten darueber, ob
  // eine gerade gemessene Sitzung ueberlebt.

  const schuebe = handy.ereignisse.filter((e) => e.art === "geraete:sitzungen");
  pruefe("Java bekommt den Zuwachs, nicht die ganze Liste",
    schuebe.length > 0
    && schuebe.every((schub) => Array.isArray(schub.nutzlast))
    && schuebe.some((schub) => schub.nutzlast.length < handy.eigene.sitzungen.length),
    `${schuebe.length} Schuebe, Groessen [${schuebe.map((s) => s.nutzlast.length).join(",")}], `
    + `Liste ${handy.eigene.sitzungen.length}`);

  /* ------------------------------------------- Ein fremder Schluessel */

  const fremd = android("Fremd");
  fremd.an(schluesselModul.erzeugen());
  await warteBis(() => fremd.bruecke.status().connected, "fremdes Geraet verbindet sich");
  fremd.abgleichen();
  await schlaf(800);
  pruefe("Ein anderer Schluessel bekommt keine Sitzung zu sehen",
    fremd.eigene.sitzungen.length === 0 && fremd.sekunden() === 0,
    `${fremd.eigene.sitzungen.length} Saetze`);

  pc.aus();
  handy.aus();
  tv.aus();
  fremd.aus();
  await schlaf(200);

  const ok = pruefungen.filter(Boolean).length;
  console.log(`\n${ok}/${pruefungen.length} bestanden`);
  process.exit(ok === pruefungen.length ? 0 : 1);
})().catch((fehler) => {
  console.log(`FAIL  Der Lauf brach ab   -> ${fehler?.stack || fehler}`);
  console.log(`\n0/${pruefungen.length + 1} bestanden`);
  process.exit(1);
});
