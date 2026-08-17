"use strict";
// Die Sync-Strategie der Watchparty, Stueck fuer Stueck.
//
// Diese Funktionen laufen im Player-Rahmen - sie werden von dort woertlich
// hineingesetzt (siehe watchparty-sync.js). Was hier geprueft wird, ist also
// genau das, was beim Schauen entscheidet.

const {
  zielZeitBerechnen,
  driftEntscheiden,
  istVeraltet,
  versatzAusProben,
  alsQuelltext
} = require("../src/watchparty-sync");

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(b); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };
const nah = (a, b, toleranz = 0.001) => Math.abs(a - b) <= toleranz;

// --- 1. Smarter Start ---------------------------------------------------------

// Der Host drueckt bei 100 s Play. Die Nachricht braucht 300 ms.
const play = { videoTime: 100, timestamp: 1_000_000, playing: true, hatUhr: true };
pruefe("1. Play: die Laufzeit der Nachricht kommt auf die Stelle",
  nah(zielZeitBerechnen(play, 1_000_300), 100.3),
  `${zielZeitBerechnen(play, 1_000_300).toFixed(3)} statt 100`);

// Und noch einmal 700 ms spaeter, weil der Player erst puffern musste. Genau
// das ist die Neuberechnung unmittelbar vor dem play().
pruefe("1b. Nach dem Puffern wird neu gerechnet und das Ziel wandert mit",
  nah(zielZeitBerechnen(play, 1_001_000), 101),
  `${zielZeitBerechnen(play, 1_001_000).toFixed(3)} nach 1000 ms`);

pruefe("1c. Steht der Host, gilt seine Stelle unveraendert",
  zielZeitBerechnen({ ...play, playing: false }, 1_009_000) === 100,
  `${zielZeitBerechnen({ ...play, playing: false }, 1_009_000)}`);

// Ohne gemessene Uhr wird nicht hochgerechnet - sonst landete die Differenz
// zweier Systemuhren als Videozeit im Ergebnis.
pruefe("1d. Ohne Uhrmessung wird gar nicht hochgerechnet",
  zielZeitBerechnen({ ...play, hatUhr: false }, 1_060_000) === 100,
  `${zielZeitBerechnen({ ...play, hatUhr: false }, 1_060_000)}`);

pruefe("1e. Eine absurd alte Nachricht wird gedeckelt",
  zielZeitBerechnen(play, 1_000_000 + 600_000) === 130,
  `${zielZeitBerechnen(play, 1_000_000 + 600_000)} (Deckel 30 s)`);

pruefe("1f. Eine Nachricht aus der Zukunft schiebt nicht zurueck",
  zielZeitBerechnen(play, 999_000) === 100, `${zielZeitBerechnen(play, 999_000)}`);

// Ein Sprung des Hosts von 120 auf 500, waehrend er laeuft: der Client muss
// dorthin - plus die Laufzeit.
const sprung = { videoTime: 500, timestamp: 2_000_000, playing: true, hatUhr: true };
pruefe("1g. Manueller Sprung: die neue Stelle gilt sofort, samt Laufzeit",
  nah(zielZeitBerechnen(sprung, 2_000_250), 500.25),
  `${zielZeitBerechnen(sprung, 2_000_250).toFixed(3)}`);

// --- 2. Laufender Betrieb: ignorieren -----------------------------------------

const frischerZustand = () => ({ bestaetigt: 0, seitSprung: 0, letzteMessung: 0 });

{
  const S = frischerZustand();
  let jetzt = 100000;
  const taten = [];
  // Vier Sekunden Versatz, zwanzig Messungen lang. Es darf nichts passieren.
  for (let i = 0; i < 20; i += 1) {
    taten.push(driftEntscheiden(S, { drift: 4, jetzt, puffert: false, laeuft: true }));
    jetzt += 2000;
  }
  pruefe("2. Vier Sekunden Versatz: zwanzigmal 'ignore', nie ein Sprung",
    taten.every((tat) => tat === "ignore"), [...new Set(taten)].join(", "));
  pruefe("2b. Und der Zaehler bleibt bei null",
    S.bestaetigt === 0 && S.seitSprung === 0, `bestaetigt=${S.bestaetigt}`);
}

{
  const S = frischerZustand();
  const taten = [];
  for (const drift of [0.2, -1, 2.5, -4.9, 5]) {
    taten.push(driftEntscheiden(S, { drift, jetzt: 200000, puffert: false, laeuft: true }));
  }
  pruefe("2c. Auch genau fuenf Sekunden sind noch 'ignore'",
    taten.every((tat) => tat === "ignore"), taten.join(", "));
}

// --- 3. Notfall-Sprung: erst nach Bestaetigung --------------------------------

{
  const S = frischerZustand();
  const taten = [];
  let jetzt = 300000;
  for (let i = 0; i < 3; i += 1) {
    taten.push(driftEntscheiden(S, { drift: 9, jetzt, puffert: false, laeuft: true }));
    jetzt += 2000;
  }
  pruefe("3. Erst die dritte Messung ueber fuenf Sekunden loest aus",
    taten[0] === "beobachten" && taten[1] === "beobachten" && taten[2] === "hard-seek",
    taten.join(" -> "));
}

{
  const S = frischerZustand();
  let jetzt = 400000;
  // Zwei zu weit, dann eine im Rahmen: die Reihe ist gebrochen.
  driftEntscheiden(S, { drift: 9, jetzt, puffert: false, laeuft: true });
  driftEntscheiden(S, { drift: 9, jetzt: jetzt += 2000, puffert: false, laeuft: true });
  const dazwischen = driftEntscheiden(S, { drift: 1, jetzt: jetzt += 2000, puffert: false, laeuft: true });
  const danach = driftEntscheiden(S, { drift: 9, jetzt: jetzt += 2000, puffert: false, laeuft: true });
  pruefe("3b. Eine Messung im Rahmen setzt die Zaehlung zurueck",
    dazwischen === "ignore" && danach === "beobachten", `${dazwischen} -> ${danach}`);
}

{
  const S = frischerZustand();
  let jetzt = 500000;
  driftEntscheiden(S, { drift: 9, jetzt, puffert: false, laeuft: true });
  driftEntscheiden(S, { drift: 9, jetzt: jetzt += 2000, puffert: false, laeuft: true });
  // VOE puffert. Die Messung waehrenddessen ist wertlos und die Reihe reisst.
  const beimPuffern = driftEntscheiden(S, { drift: 12, jetzt: jetzt += 2000, puffert: true, laeuft: true });
  const danach = driftEntscheiden(S, { drift: 9, jetzt: jetzt += 2000, puffert: false, laeuft: true });
  pruefe("3c. Waehrend des Puffems wird nicht gemessen und nicht gesprungen",
    beimPuffern === "puffert" && danach === "beobachten", `${beimPuffern} -> ${danach}`);
}

{
  const S = frischerZustand();
  let jetzt = 600000;
  driftEntscheiden(S, { drift: 9, jetzt, puffert: false, laeuft: true });
  driftEntscheiden(S, { drift: 9, jetzt: jetzt += 2000, puffert: false, laeuft: true });
  // Neun Sekunden Pause in den Meldungen: die Reihe zaehlt nicht mehr.
  const spaet = driftEntscheiden(S, { drift: 9, jetzt: jetzt += 9000, puffert: false, laeuft: true });
  pruefe("3d. Reisst die Reihe der Messungen, faengt das Zaehlen von vorn an",
    spaet === "beobachten", spaet);
}

{
  // Zwei Minuten Dauerversatz - der Fall, den es zu daempfen gilt: wer
  // hinterherhaengt, weil die Leitung lahm ist, wird durch staendiges
  // Nachvornziehen nur noch langsamer.
  const S = frischerZustand();
  let jetzt = 700000;
  const spruenge = [];
  for (let i = 0; i < 60; i += 1) {
    if (driftEntscheiden(S, { drift: 20, jetzt, puffert: false, laeuft: true }) === "hard-seek") {
      spruenge.push(jetzt);
    }
    jetzt += 2000;
  }
  const abstaende = spruenge.slice(1).map((wert, i) => wert - spruenge[i]);
  pruefe("4. Dauerhafter Versatz springt hoechstens alle fuenfzehn Sekunden",
    spruenge.length > 1 && abstaende.every((abstand) => abstand >= 15000),
    `${spruenge.length} Spruenge in 120 s, Abstaende ${abstaende.join("/")} ms`);
  pruefe("4b. Und der erste Sprung kommt erst nach drei Messungen",
    spruenge[0] === 704000, `nach ${(spruenge[0] - 700000) / 1000} s`);
}

{
  const S = frischerZustand();
  const steht = driftEntscheiden(S, { drift: 30, jetzt: 800000, puffert: false, laeuft: false });
  pruefe("4c. Steht der Host, entscheidet nicht der Versatz",
    steht === "steht", steht);
}

{
  // Mehrere Minuten Wiedergabe mit dem Versatz, der beim Schauen normal ist.
  const S = frischerZustand();
  let jetzt = 900000;
  let gesprungen = 0;
  for (let i = 0; i < 300; i += 1) {
    const drift = Math.sin(i / 7) * 3.5;
    if (driftEntscheiden(S, { drift, jetzt, puffert: false, laeuft: true }) === "hard-seek") gesprungen += 1;
    jetzt += 2000;
  }
  pruefe("4d. Zehn Minuten normaler Drift: der Player wird nie angefasst",
    gesprungen === 0, `${gesprungen} Spruenge in 600 Messungen`);
}

// --- 5. Veraltete Ereignisse ---------------------------------------------------

const letzterPause = { sequenceId: 42, timestamp: 5_000_000, episodeId: "s1e3" };

pruefe("5. Ein verspaetetes Play nach einem neueren Pause wird abgewiesen",
  istVeraltet(letzterPause, { sequenceId: 41, timestamp: 4_999_000, episodeId: "s1e3" }),
  "seq 41 nach seq 42");

pruefe("5b. Das naechste echte Ereignis kommt durch",
  !istVeraltet(letzterPause, { sequenceId: 43, timestamp: 5_001_000, episodeId: "s1e3" }),
  "seq 43");

pruefe("5c. Dieselbe Nummer zweimal gilt als Nachzuegler",
  istVeraltet(letzterPause, { sequenceId: 42, timestamp: 5_000_000, episodeId: "s1e3" }), "seq 42 erneut");

// Das Relay wurde neu gestartet und zaehlt wieder bei eins - die Zeit ist aber
// weiter. Ohne diese Ausnahme waere der Player dauerhaft taub.
pruefe("5d. Ein neu gestartetes Relay sperrt sich nicht selbst aus",
  !istVeraltet(letzterPause, { sequenceId: 1, timestamp: 5_400_000, episodeId: "s1e3" }),
  "seq 1, aber spaeter");

pruefe("5e. Ein Nachzuegler aus der vorigen Folge kommt nicht mehr an",
  istVeraltet(letzterPause, { sequenceId: 40, timestamp: 4_998_000, episodeId: "s1e2" }),
  "Folge 2 nach Folge 3");

pruefe("5f. Der Wechsel auf die naechste Folge kommt durch",
  !istVeraltet(letzterPause, { sequenceId: 43, timestamp: 5_002_000, episodeId: "s1e4" }),
  "Folge 4");

pruefe("5g. Ohne Vorgeschichte wird nichts abgewiesen",
  !istVeraltet(null, { sequenceId: 1, timestamp: 1, episodeId: "s1e1" }), "erstes Ereignis");

// Ein aelteres Relay vergibt keine Nummern - dann bleibt nur die Zeit.
pruefe("5h. Ohne laufende Nummer entscheidet der Zeitstempel",
  istVeraltet({ sequenceId: 0, timestamp: 5_000_000, episodeId: "" }, { sequenceId: 0, timestamp: 4_000_000, episodeId: "" }),
  "aelterer Stempel");

// --- 6. Uhrversatz -------------------------------------------------------------

{
  // Die Serveruhr geht 5000 ms vor, der Weg dauert je 50 ms.
  const proben = [
    { t0: 1000, t1: 1000 + 50 + 5000, t2: 1100 },
    { t0: 2000, t1: 2000 + 400 + 5000, t2: 2800 },
    { t0: 3000, t1: 3000 + 20 + 5000, t2: 3040 }
  ];
  const beste = versatzAusProben(proben);
  pruefe("6. Der Versatz wird aus der schnellsten Probe bestimmt",
    beste && nah(beste.versatz, 5000, 1) && beste.umlauf === 40,
    beste ? `${beste.versatz} ms bei ${beste.umlauf} ms Umlauf` : "nichts");
}

pruefe("6b. Unbrauchbare Proben zaehlen nicht",
  versatzAusProben([{ t0: 5000, t1: 1, t2: 1000 }, { t0: 0, t1: 1, t2: 99000 }]) === null,
  "negativer und viel zu langsamer Umlauf");

pruefe("6c. Ohne Proben gibt es keinen Versatz",
  versatzAusProben([]) === null && versatzAusProben(null) === null, "leer");

// --- 7. Der Quelltext landet wirklich im Player --------------------------------

{
  const quelle = alsQuelltext(zielZeitBerechnen, driftEntscheiden);
  // eslint-disable-next-line no-new-func
  const gebaut = new Function(`${quelle}\nreturn { zielZeitBerechnen, driftEntscheiden };`)();
  const S = frischerZustand();
  pruefe("7. Der eingesetzte Quelltext rechnet identisch",
    nah(gebaut.zielZeitBerechnen(play, 1_000_500), zielZeitBerechnen(play, 1_000_500))
    && gebaut.driftEntscheiden(S, { drift: 2, jetzt: 1, puffert: false, laeuft: true }) === "ignore",
    "im Player laeuft dieselbe Logik");
  pruefe("7b. Und bringt keine Abhaengigkeit von draussen mit",
    !/require\(|module\./.test(quelle), "kein require, kein module");
}

const fehler = pruefungen.filter((p) => !p).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
