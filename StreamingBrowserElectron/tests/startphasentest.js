"use strict";
// Die Ladephasen beim Start einer Folge.
//
// Warum es diese Pruefung gibt. Der Ladebildschirm der App darf keinen
// erfundenen Fortschritt zeigen - er springt nur, wenn ein Schritt der
// Startkette wirklich hinter ihr liegt. Genau das laesst sich ohne Geraet
// pruefen, und genau das ist die Zusage, die hier festgehalten wird:
//
//   1. Der Balken geht nie rueckwaerts. Die Kette meldet Schritte mehrfach -
//      jeder Takt des Autostarts sieht denselben Zustand wieder.
//   2. Ohne gespeicherten Stand gibt es den Schritt "Zur gespeicherten Stelle"
//      gar nicht; er stuende sonst als Schritt da, den niemand je meldet.
//   3. Jeder Schritt hat seine eigene Frist, und ueber allem steht ein Deckel.
//      Beides muss greifen, sonst haengt ein Ladebildschirm fuer immer.
//   4. Das Modell, das Android beim Start abholt, traegt alles, was die App
//      zum Zeichnen braucht - Namen, Beschriftungen, Anteile, Fristen und die
//      Fehlertexte. Fehlt dort etwas, faellt es auf dem Geraet auf und nicht
//      hier, und dann steht die Tabelle zweimal.

const startphasen = require("../src/startphasen");
const autostart = require("../src/watchparty-autostart");

const pruefungen = [];
const pruefe = (n, b, d) => {
  pruefungen.push(Boolean(b));
  console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`);
};

/* ------------------------------------------------------ Die Reihenfolge */

const namen = startphasen.PHASEN.map((phase) => phase.name);
pruefe("Die Schritte stehen in der Reihenfolge der Startkette",
  namen.join(",") === "seite,hoster,spieler,stelle,vollbild,laeuft", namen.join(","));

pruefe("Der Balken waechst mit jedem Schritt",
  startphasen.PHASEN.every((phase, i) => i === 0 || phase.anteil > startphasen.PHASEN[i - 1].anteil));

pruefe("Der letzte Schritt ist der volle Balken",
  startphasen.anteil(startphasen.LETZTE) === 1);

pruefe("Der erste Schritt faengt nicht bei null an - etwas geschieht ja schon",
  startphasen.anteil(startphasen.ERSTE) > 0 && startphasen.anteil(startphasen.ERSTE) < 0.2);

pruefe("Jeder Schritt hat eine Beschriftung",
  startphasen.PHASEN.every((phase) => typeof phase.text === "string" && phase.text.length > 3));

/* ------------------------------------------------- Der Stand entscheidet */

const mitStand = startphasen.phasen({ stelle: 182.7 }).map((p) => p.name);
const ohneStand = startphasen.phasen({ stelle: 0 }).map((p) => p.name);
pruefe("Mit gespeichertem Stand gehoert der Sprung dazu", mitStand.includes("stelle"));
pruefe("Ohne gespeicherten Stand faellt er heraus", !ohneStand.includes("stelle"),
  ohneStand.join(","));
pruefe("Sonst sind es dieselben Schritte",
  ohneStand.join(",") === mitStand.filter((n) => n !== "stelle").join(","));

/* --------------------------------------------------- Nur nach vorn */

{
  const lauf = startphasen.starten({ titel: "Attack on Titan · Staffel 2 Folge 5", stelle: 182.7, jetzt: 1000 });
  pruefe("Ein Start faengt beim ersten Schritt an", lauf.phase === "seite");

  const a = startphasen.melden(lauf, "spieler", 2000);
  pruefe("Ein Sprung nach vorn zaehlt", a.geaendert && lauf.phase === "spieler");

  const b = startphasen.melden(lauf, "hoster", 3000);
  pruefe("Ein Schritt hinter dem Stand wird verworfen",
    !b.geaendert && lauf.phase === "spieler", lauf.phase);

  const c = startphasen.melden(lauf, "spieler", 4000);
  pruefe("Derselbe Schritt noch einmal aendert nichts", !c.geaendert && lauf.seit === 2000);

  const d = startphasen.melden(lauf, "kennt-keiner", 5000);
  pruefe("Ein unbekannter Name aendert nichts", !d.geaendert && lauf.phase === "spieler");

  const e = startphasen.melden(lauf, "laeuft", 6000);
  pruefe("Der letzte Schritt macht den Start fertig", e.fertig && lauf.fertig);
  pruefe("Und faerbt den Balken voll", e.anteil === 1, String(e.anteil));
}

/* --------------------------------------------------------- Die Fristen */

{
  const lauf = startphasen.starten({ titel: "T", stelle: 0, jetzt: 0 });
  const frist = startphasen.PHASEN[0].fristMs;

  pruefe("Kurz vor der Frist wird gewartet",
    startphasen.pruefen(lauf, frist - 1).tun === "warten");

  const abgelaufen = startphasen.pruefen(lauf, frist);
  pruefe("Mit der Frist ist Schluss", abgelaufen.tun === "fehler" && abgelaufen.grund === "seite",
    abgelaufen.grund);
  pruefe("Und der Zuschauer bekommt einen Satz, mit dem er etwas anfangen kann",
    /Internetverbindung/i.test(abgelaufen.text), abgelaufen.text);
}

{
  // Jeder Schritt kommt gerade noch rechtzeitig - und trotzdem ist irgendwann
  // Schluss. Ohne den Deckel liesse sich ein Ladebildschirm beliebig lange
  // offenhalten, indem jede Phase kurz vor ihrer Frist weiterspringt.
  const lauf = startphasen.starten({ titel: "T", stelle: 5, jetzt: 0 });
  let zeit = 0;
  for (const name of ["hoster", "spieler"]) {
    // Immer eine Sekunde vor der Frist des laufenden Schrittes melden: jeder
    // einzelne Schritt bleibt damit im Rahmen.
    zeit += startphasen.PHASEN.find((p) => p.name === lauf.phase).fristMs - 1000;
    startphasen.melden(lauf, name, zeit);
    pruefe("Rechtzeitig gemeldet, also weiter (" + name + ")",
      startphasen.pruefen(lauf, zeit + 10).tun === "warten");
  }
  pruefe("Zusammen sind sie laenger als der Deckel", zeit > startphasen.GESAMT_FRIST_MS - 5000,
    zeit + " ms");
  const spaet = startphasen.pruefen(lauf, startphasen.GESAMT_FRIST_MS);
  pruefe("Der Deckel greift auch dann", spaet.tun === "fehler" && spaet.grund === "gesamt",
    spaet.grund);
}

{
  const lauf = startphasen.starten({ titel: "T", stelle: 0, jetzt: 0 });
  startphasen.melden(lauf, "laeuft", 10);
  pruefe("Ein fertiger Start laeuft in keine Frist",
    startphasen.pruefen(lauf, startphasen.GESAMT_FRIST_MS * 5).tun === "warten");
}

/* -------------------------------------------- Das Modell fuer das Geraet */

{
  const modell = startphasen.modell();
  pruefe("Das Modell traegt alle Schritte", modell.phasen.length === startphasen.PHASEN.length);
  pruefe("Mit Namen, Text, Anteil und Frist", modell.phasen.every((phase) => (
    typeof phase.name === "string" && phase.name.length > 0
      && typeof phase.text === "string" && phase.text.length > 0
      && typeof phase.anteil === "number"
      && typeof phase.fristMs === "number"
  )));
  pruefe("Es nennt Anfang und Ende",
    modell.erste === startphasen.ERSTE && modell.letzte === startphasen.LETZTE);
  pruefe("Und den Deckel", modell.gesamtFristMs === startphasen.GESAMT_FRIST_MS);
  pruefe("Zu jedem Schritt steht ein Fehlertext",
    startphasen.PHASEN.every((phase) => (modell.fehlertexte[phase.name] || "").length > 5));
  pruefe("Dazu der Deckel und der Abbruch",
    (modell.fehlertexte.gesamt || "").length > 5 && (modell.fehlertexte.abgebrochen || "").length > 5);
  pruefe("Und ein Satz fuer alles Uebrige", (modell.fehlertexte[""] || "").length > 5);
  pruefe("Das Modell ist eine Kopie - wer daran dreht, dreht nicht an der Tabelle",
    (() => {
      modell.phasen[0].text = "kaputt";
      return startphasen.beschriftung(startphasen.ERSTE) !== "kaputt";
    })());
}

/* ------------------------------- Die Zwischenmeldungen aus dem Player */

// Sie sind der Grund, warum der Balken zwischen "Player gefunden" und "es
// laeuft" ueberhaupt etwas zu melden hat. Ohne sie stuende er dort zehn
// Sekunden still - und genau dann faengt jemand an, Zeit hochzuzaehlen.
{
  const skript = autostart.startScript("auftrag-1", { videoTime: 12, timestamp: Date.now(), playing: true, hatUhr: true }, { playing: true });
  pruefe("Das Startskript meldet den gefundenen Rahmen",
    skript.includes(`meldePhase(${JSON.stringify(autostart.PHASE_RAHMEN)})`));
  pruefe("Und die geladene Quelle",
    skript.includes(`meldePhase(${JSON.stringify(autostart.PHASE_QUELLE)})`));
  pruefe("Ueber denselben Kanal wie der Bericht - die Konsole",
    skript.includes(`console.log("${autostart.MELDE_PHASE}"`));
  pruefe("Die Meldung faengt mit dem gemeinsamen Praefix an - sonst hoert Java gar nicht hin",
    autostart.MELDE_PHASE.startsWith("__elfix:wp:"), autostart.MELDE_PHASE);
  pruefe("Und laesst sich wieder auseinandernehmen",
    autostart.phaseLesen(autostart.MELDE_PHASE + "quelle") === "quelle");
  pruefe("Was keine ist, ist keine",
    autostart.phaseLesen(autostart.MELDE_START + "{}") === "");
  pruefe("Der gemeldete Rahmenname ist einer der Schritte",
    namen.includes(autostart.PHASE_RAHMEN), autostart.PHASE_RAHMEN);
}

const fehlgeschlagen = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehlgeschlagen}/${pruefungen.length} bestanden`);
process.exit(fehlgeschlagen ? 1 : 0);
