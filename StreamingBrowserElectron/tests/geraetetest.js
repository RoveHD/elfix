"use strict";
// Meine Geraete - der Abgleich zwischen den Geraeten einer Person, gegen das
// echte Relay.
//
// Zwei Dinge sind hier heikel, und beide sieht man einem Quelltext nicht an:
//
// 1. Der Kreis. Jedes Uebernehmen schreibt die Favoriten, jedes Schreiben
//    meldet den Stand hinaus. Merkt sich ein Geraet das Empfangene statt das
//    daraus Gewordene, schieben sich zwei Geraete denselben Eintrag ewig hin
//    und her - besonders sicher dann, wenn die Adresse auf beiden eine andere
//    ist, und das ist bei S.to der Normalfall.
// 2. Das Geheimnis. Der Schluessel darf das Geraet nicht verlassen, und aus
//    dem, was beim Relay liegt, darf sich kein Titel ablesen lassen.
//
// Beides wird deshalb ausgefuehrt: zwei echte Fassaden an einer echten
// Verbindung, und ein Blick in die Ablage des Servers.

const fs = require("fs");
const path = require("path");
const WS = require("../../sync-server/node_modules/ws");
const schluessel = require("../src/geraete-schluessel");
const { Geraeteabgleich } = require("../src/geraete");

const PORT = Number(process.env.TESTPORT) || 8799;
const ADRESSE = `ws://127.0.0.1:${PORT}`;
const SERVER = fs.readFileSync(path.join(__dirname, "..", "..", "sync-server", "server.js"), "utf8").replace(/\r/g, "");

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

// Ein Geraet: es haelt seine eigenen Staende und benimmt sich wie main.js -
// uebernehmen, den eigenen Stand daraus bilden, hinausmelden.
function geraet(name, key, staende = []) {
  const eigen = new Map(staende.map((stand) => [stand.key, stand]));
  const ereignisse = [];
  const abgleich = new Geraeteabgleich({
    WebSocketKlasse: WS,
    onEintrag: (stand) => {
      ereignisse.push({ art: "herein", key: stand.key, position: stand.position });
      const vorher = eigen.get(stand.key) || {};
      // Wie main.js: die Adresse bleibt die eigene, wenn der Wirt ein anderer
      // ist. Genau daran entzuendet sich der Kreis.
      const eigenerWirt = String(vorher.url || stand.url).split("/")[2] || "";
      const url = eigenerWirt && stand.url.split("/")[2] !== eigenerWirt
        ? String(stand.url).replace(String(stand.url).split("/")[2], eigenerWirt)
        : stand.url;
      const neu = schluessel.stand({ ...stand, url });
      eigen.set(stand.key, neu);
      return neu;
    },
    onWeg: (key) => {
      ereignisse.push({ art: "weg", key });
      return eigen.delete(key);
    },
    onSpeichern: () => {},
    onStatus: () => {}
  });
  return {
    name, abgleich, eigen, ereignisse,
    an: () => abgleich.konfigurieren({ enabled: true, serverUrl: ADRESSE, schluessel: key, geraetId: name }),
    melden: () => abgleich.abgleichen([...eigen.values()]),
    setzen: (stand) => {
      eigen.set(stand.key, schluessel.stand(stand));
      return abgleich.abgleichen([...eigen.values()]);
    },
    loeschen: (key2) => {
      eigen.delete(key2);
      return abgleich.abgleichen([...eigen.values()]);
    },
    hinaus: () => ereignisse.filter((e) => e.art === "herein").length
  };
}

function stand(key, extra = {}) {
  return schluessel.stand({
    key,
    url: "https://aniworld.to/anime/stream/one-piece/staffel-1/episode-3",
    title: "One Piece",
    type: "serie",
    season: 1,
    episode: 3,
    position: 300,
    duration: 1400,
    progress: 21,
    ...extra
  });
}

(async () => {
  // --- Der Schluessel, ohne Verbindung --------------------------------------

  const key = schluessel.erzeugen();
  pruefe("Ein erzeugter Schluessel ist gueltig",
    schluessel.istGueltig(key) && schluessel.normalisieren(key).length === 32,
    key);
  pruefe("Abgetipptes wird geradegezogen",
    schluessel.normalisieren(key.toLowerCase().replace(/-/g, " ")) === schluessel.normalisieren(key),
    "Kleinschreibung, Striche und Leerzeichen duerfen nicht entscheiden");
  pruefe("Verwechslungen beim Abschreiben auch",
    schluessel.normalisieren("O0O0O0O0-11111111-22222222-33333333")
    === schluessel.normalisieren("00000000-ILILILIL-22222222-33333333"),
    "O ist eine Null, I und L sind Einsen - genau dafuer laesst Crockford sie weg");
  pruefe("Zwei Schluessel sind verschieden",
    schluessel.erzeugen() !== schluessel.erzeugen());
  pruefe("Unsinn ist kein Schluessel",
    !schluessel.istGueltig("hallo") && !schluessel.istGueltig("") && !schluessel.istGueltig(key + "X"));

  const abgeleitet = schluessel.ableiten(key);
  const fremd = schluessel.ableiten(schluessel.erzeugen());
  pruefe("Aus dem Schluessel faellt eine Raumkennung",
    /^[0-9a-f]{32}$/.test(abgeleitet.raum),
    abgeleitet.raum);
  pruefe("Der Schluessel steckt nicht darin",
    !abgeleitet.raum.includes(schluessel.normalisieren(key).toLowerCase().slice(0, 8)),
    "sonst waere die Ableitung eine Verkleidung und keine");
  pruefe("Ein anderer Schluessel ist ein anderer Raum",
    fremd.raum !== abgeleitet.raum);

  const klumpen = schluessel.verschluesseln(abgeleitet, stand("serie:one-piece"));
  pruefe("Der Titel steht nicht im Klumpen",
    !Buffer.from(klumpen, "base64").toString("latin1").includes("One Piece")
    && !klumpen.includes("aniworld"),
    "verschlossen heisst verschlossen");
  pruefe("Mit dem Schluessel geht er wieder auf",
    schluessel.entschluesseln(abgeleitet, klumpen)?.title === "One Piece");
  pruefe("Ohne ihn nicht",
    schluessel.entschluesseln(fremd, klumpen) === null,
    "AES-GCM merkt, dass der Schluessel nicht passt - es kommt nicht etwa Muell heraus");
  pruefe("Ein beschaedigter Klumpen wirft nicht",
    schluessel.entschluesseln(abgeleitet, klumpen.slice(0, 40)) === null
    && schluessel.entschluesseln(abgeleitet, "kein base64 !!") === null,
    "ein einzelner unlesbarer Eintrag darf nicht den ganzen Abgleich anhalten");

  const id = schluessel.eintragId(abgeleitet, "serie:one-piece");
  pruefe("Die Eintragskennung ist stabil",
    id === schluessel.eintragId(abgeleitet, "serie:one-piece") && /^[0-9a-f]{32}$/.test(id));
  pruefe("und mit einem anderen Schluessel eine andere",
    schluessel.eintragId(fremd, "serie:one-piece") !== id,
    "sonst liesse sich ueber Raeume hinweg zaehlen, wer denselben Titel schaut");

  const projiziert = schluessel.stand({
    key: "serie:x", url: "https://x.to/a", title: "X",
    customThumbnail: "data:image/png;base64,AAAA", activity: [{ at: "gestern" }],
    id: "lokale-kennung", providerId: "aniworld", favicon: "f"
  });
  pruefe("Das eigene Bild geht nicht mit hinaus",
    !("customThumbnail" in projiziert) && !JSON.stringify(projiziert).includes("base64"),
    "es ist um ein Vielfaches groesser als alles andere zusammen");
  pruefe("Der Verlauf je Eintrag auch nicht",
    !("activity" in projiziert),
    "er ist die Chronik dieses Geraets");
  pruefe("Und nichts, was jedes Geraet fuer sich fuehrt",
    !("id" in projiziert) && !("providerId" in projiziert) && !("favicon" in projiziert));

  // --- Zwei Geraete an einer echten Leitung ---------------------------------

  const laptop = geraet("laptop", key, [stand("serie:one-piece")]);
  const rechner = geraet("rechner", key);
  laptop.an();
  rechner.an();
  await schlaf(500);

  laptop.melden();
  await schlaf(500);

  pruefe("Der Stand des einen kommt beim anderen an",
    rechner.eigen.get("serie:one-piece")?.position === 300,
    JSON.stringify(rechner.eigen.get("serie:one-piece")?.position));
  pruefe("Der Titel kommt mit",
    rechner.eigen.get("serie:one-piece")?.title === "One Piece");

  // --- Der Kreis ------------------------------------------------------------
  //
  // Der Rechner hat den Eintrag eben uebernommen und dabei seine Favoriten
  // geschrieben - in main.js loest genau das den naechsten Abgleich aus. Was
  // jetzt passiert, entscheidet, ob die beiden zur Ruhe kommen.

  const vorherLaptop = laptop.hinaus();
  const vorherRechner = rechner.hinaus();
  for (let i = 0; i < 4; i += 1) {
    rechner.melden();
    laptop.melden();
    await schlaf(200);
  }
  pruefe("Ein uebernommener Stand wird nicht zurueckgemeldet",
    laptop.hinaus() === vorherLaptop && rechner.hinaus() === vorherRechner,
    `Laptop ${laptop.hinaus() - vorherLaptop} / Rechner ${rechner.hinaus() - vorherRechner} weitere Uebernahmen`);

  // Und jetzt mit verschiedenen Adressen - der Fall, der den Kreis wirklich
  // ausloest. S.to laeuft auf dem einen Geraet ueber eine IP, auf dem anderen
  // ueber die Domain; der projizierte Stand ist damit auf beiden Geraeten ein
  // anderer, obwohl nichts weiter geschehen ist.
  laptop.setzen(stand("serie:sto", { url: "https://s.to/serie/stream/dark/staffel-1/episode-1", title: "Dark", position: 60 }));
  await schlaf(400);
  rechner.eigen.set("serie:sto", schluessel.stand({
    ...rechner.eigen.get("serie:sto"),
    url: "https://185.1.2.3/serie/stream/dark/staffel-1/episode-1"
  }));
  const vorWechsel = { laptop: laptop.hinaus(), rechner: rechner.hinaus() };
  for (let i = 0; i < 5; i += 1) {
    rechner.melden();
    laptop.melden();
    await schlaf(200);
  }
  pruefe("Auch bei verschiedenen Adressen kommt es zur Ruhe",
    laptop.hinaus() - vorWechsel.laptop <= 1 && rechner.hinaus() - vorWechsel.rechner <= 1,
    `Laptop ${laptop.hinaus() - vorWechsel.laptop} / Rechner ${rechner.hinaus() - vorWechsel.rechner}`);
  pruefe("Und jedes Geraet behaelt seine eigene Adresse",
    rechner.eigen.get("serie:sto")?.url.includes("185.1.2.3")
    && laptop.eigen.get("serie:sto")?.url.includes("s.to"),
    `${laptop.eigen.get("serie:sto")?.url} | ${rechner.eigen.get("serie:sto")?.url}`);

  // --- Wer gewinnt ----------------------------------------------------------

  rechner.setzen(stand("serie:one-piece", { position: 900, episode: 4 }));
  await schlaf(400);
  pruefe("Der neuere Stand setzt sich durch",
    laptop.eigen.get("serie:one-piece")?.position === 900
    && laptop.eigen.get("serie:one-piece")?.episode === 4,
    JSON.stringify(laptop.eigen.get("serie:one-piece")?.position));

  // Ein Stand mit einem alten Zeitstempel - so, wie ihn ein Geraet meldet, das
  // lange aus war. Er darf den neueren nicht ueberschreiben.
  const alt = stand("serie:one-piece", { position: 5, episode: 1 });
  const eintragKennung = schluessel.eintragId(abgeleitet, "serie:one-piece");
  const roh = new WS(ADRESSE);
  await new Promise((fertig) => { roh.on("open", fertig); });
  roh.send(JSON.stringify({ type: "grhello", room: abgeleitet.raum, seit: 0 }));
  await schlaf(200);
  roh.send(JSON.stringify({
    type: "grput",
    eintraege: [{ id: eintragKennung, at: Date.now() - 3600000, blob: schluessel.verschluesseln(abgeleitet, alt) }]
  }));
  await schlaf(400);
  pruefe("Ein aelterer Stand ueberschreibt den neueren nicht",
    laptop.eigen.get("serie:one-piece")?.position === 900,
    JSON.stringify(laptop.eigen.get("serie:one-piece")?.position));

  // --- Loeschen -------------------------------------------------------------

  laptop.loeschen("serie:sto");
  await schlaf(500);
  pruefe("Geloeschtes verschwindet auch drueben",
    !rechner.eigen.has("serie:sto"),
    [...rechner.eigen.keys()].join(","));

  const vorNachhall = rechner.hinaus();
  for (let i = 0; i < 4; i += 1) {
    rechner.melden();
    laptop.melden();
    await schlaf(200);
  }
  pruefe("und kommt nicht von selbst zurueck",
    !rechner.eigen.has("serie:sto") && !laptop.eigen.has("serie:sto")
    && rechner.hinaus() === vorNachhall,
    "ohne Grabstein meldete das andere Geraet den Titel als neu wieder hinaus");

  // --- Ein fremder Schluessel ----------------------------------------------

  const fremderSchluessel = schluessel.erzeugen();
  const fremdesGeraet = geraet("fremd", fremderSchluessel);
  fremdesGeraet.an();
  await schlaf(400);
  laptop.setzen(stand("serie:geheim", { title: "Nur fuer mich" }));
  await schlaf(400);
  pruefe("Ein anderer Schluessel bekommt nichts davon",
    fremdesGeraet.eigen.size === 0,
    [...fremdesGeraet.eigen.keys()].join(","));

  // --- Was beim Relay liegt -------------------------------------------------

  const ablage = path.join(process.env.STATE_DIRECTORY || path.join(__dirname, "..", "..", "sync-server"), "raeume.json");
  await schlaf(1200);
  const gespeichert = fs.existsSync(ablage) ? fs.readFileSync(ablage, "utf8") : "";
  pruefe("Der Server legt den Abgleich ab",
    gespeichert.includes(abgeleitet.raum),
    "ein Geraet, das eine Woche aus war, muss den Stand nachgereicht bekommen");
  pruefe("Aber kein Titel steht darin",
    gespeichert && !gespeichert.includes("One Piece") && !gespeichert.includes("Nur fuer mich")
    && !gespeichert.includes("aniworld"),
    "was jemand schaut, geht das Relay nichts an");
  pruefe("Und der Schluessel auch nicht",
    gespeichert && !gespeichert.includes(schluessel.normalisieren(key)),
    "er verlaesst das Geraet nie");

  // --- Ein Geraet, das dazukommt -------------------------------------------

  const drittes = geraet("tablet", key);
  drittes.an();
  await schlaf(700);
  pruefe("Ein neues Geraet bekommt den ganzen Stand nachgereicht",
    drittes.eigen.get("serie:one-piece")?.position === 900
    && drittes.eigen.has("serie:geheim"),
    [...drittes.eigen.keys()].join(","));
  pruefe("und den Grabstein nicht als Eintrag",
    !drittes.eigen.has("serie:sto"),
    "sonst holte jedes neue Geraet die geloeschten Titel zurueck");

  // --- Der Weg zurueck ------------------------------------------------------
  //
  // Ein Geraet kann einen Eintrag ablehnen - in ELFIX dann, wenn ihm der
  // Anbieter dazu fehlt. Der Wasserstand laeuft trotzdem weiter, der Eintrag
  // kaeme also nie wieder. Dafuer gibt es "Jetzt abgleichen": es holt den
  // ganzen Raum noch einmal.

  const waehlerisch = geraet("waehlerisch", key);
  let nimmtAn = false;
  const echtesUebernehmen = waehlerisch.abgleich.aufEintrag;
  waehlerisch.abgleich.aufEintrag = (stand2, at2) => (nimmtAn ? echtesUebernehmen(stand2, at2) : null);
  waehlerisch.an();
  await schlaf(700);
  pruefe("Ein abgelehnter Eintrag landet nirgends",
    waehlerisch.eigen.size === 0,
    [...waehlerisch.eigen.keys()].join(","));

  nimmtAn = true;
  waehlerisch.melden();
  await schlaf(400);
  pruefe("und kommt vom laufenden Abgleich auch nicht wieder",
    waehlerisch.eigen.size === 0,
    "der Wasserstand steht laengst dahinter - genau dafuer gibt es den Knopf");

  waehlerisch.abgleich.vollAbgleichen();
  await schlaf(700);
  pruefe("„Jetzt abgleichen“ holt den ganzen Raum noch einmal",
    waehlerisch.eigen.get("serie:one-piece")?.position === 900,
    [...waehlerisch.eigen.keys()].join(","));

  // Und dasselbe noch einmal auf einem Geraet, das schon alles hat: was hier
  // steht, traegt denselben Zeitstempel wie drueben und faellt beim Vergleich
  // heraus. Sonst waere der Knopf ein Weg, sich den ganzen Bestand doppelt
  // durch die Uebernahme zu ziehen.
  const vorVoll = rechner.hinaus();
  rechner.abgleich.vollAbgleichen();
  await schlaf(700);
  pruefe("Auf einem Geraet, das alles hat, aendert er nichts",
    rechner.hinaus() === vorVoll,
    `${rechner.hinaus() - vorVoll} Uebernahmen`);

  // --- Was das Relay ausweist ----------------------------------------------

  const health = await fetch(`http://127.0.0.1:${PORT}/health`).then((a) => a.json());
  pruefe("/health weist den Geraeteabgleich aus",
    Array.isArray(health.features) && health.features.includes("geraete"),
    "sonst laesst sich nach dem Kopieren nicht pruefen, ob die neue Fassung laeuft");
  pruefe("und zaehlt die Schluessel",
    health.geraeteRaeume >= 1,
    String(health.geraeteRaeume));
  // Das fremde Geraet von eben hat sich angemeldet und nie etwas gemeldet.
  // Sein Raum darf deshalb gar nicht erst entstanden sein - sonst sammelte das
  // Relay einen Raum je Vertipper.
  pruefe("Ein blosses Anmelden legt keinen Raum an",
    !gespeichert.includes(schluessel.ableiten(fremderSchluessel).raum),
    "ein vertippter Schluessel darf nichts hinterlassen");

  pruefe("Der Abgleich haengt an keinem Raumcode",
    /if \(String\(nachricht\?\.type \|\| ""\)\.startsWith\("gr"\)\) \{/.test(SERVER)
    && SERVER.indexOf('startsWith("gr")') < SERVER.indexOf("if (!socket.raum) return;"),
    "wer nur seine eigenen Geraete zusammenhaelt, soll keine Watchparty betreten muessen");

  laptop.abgleich.trennen();
  rechner.abgleich.trennen();
  drittes.abgleich.trennen();
  waehlerisch.abgleich.trennen();
  fremdesGeraet.abgleich.trennen();
  roh.close();

  const fehler = pruefungen.filter((ok) => !ok).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  process.exit(fehler ? 1 : 0);
})();
