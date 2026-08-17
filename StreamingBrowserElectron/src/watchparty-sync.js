"use strict";

// Die eine Sync-Strategie der Watchparty.
//
//   SMARTER START -> EREIGNIS-ABGLEICH -> normalen Drift ignorieren
//                 -> nur bestaetigter Drift ueber fuenf Sekunden
//                 -> NOTFALL-SPRUNG
//
// Alles, was diese Kette entscheidet, steht hier - und zwar als reine
// Funktionen ohne Zugriff auf irgendetwas ausserhalb. Das hat einen Grund: die
// Entscheidungen fallen dort, wo das Video haengt, also in einem eingesetzten
// Skript im Player-Rahmen. Dieses Skript wird aus dem Quelltext genau dieser
// Funktionen zusammengebaut (siehe `alsQuelltext`), statt die Logik ein zweites
// Mal hinzuschreiben. Damit gibt es keine zwei Fassungen, die auseinanderlaufen
// koennen - und die Pruefungen testen wirklich das, was im Player laeuft.
//
// Bedingung dafuer: keine Abhaengigkeit auf Modul-Ebene, keine Konstanten von
// draussen, kein `require`. Was eine Funktion braucht, steht in ihr drin.

// --- 1. Smarter Start: wo steht der Host jetzt? ------------------------------
//
// Der Host wartet nie. Er drueckt Play und laeuft los; die Nachricht ist
// unterwegs, und wenn sie ankommt, ist er laengst weiter. Wer auf die
// mitgeschickte Stelle springt, startet deshalb grundsaetzlich zu frueh - um
// die Laufzeit der Nachricht plus alles, was das eigene Puffern noch kostet.
//
// Also wird nicht die Stelle uebernommen, sondern die Stelle plus die Zeit, die
// seit dem Ereignis vergangen ist. Gerechnet wird in Serverzeit: die Uhren
// zweier Rechner gehen verschieden, und genau diese Differenz landete frueher
// ungeprueft im Ergebnis.
//
// `hatUhr` ist die Notbremse dagegen. Ohne gemessenen Uhrversatz wird gar nicht
// hochgerechnet - lieber ein paar hundert Millisekunden zu frueh einsteigen als
// die Abweichung zweier Systemuhren als Videozeit zu verrechnen.
function zielZeitBerechnen(ereignis, serverJetzt) {
  if (!ereignis) return 0;
  const stelle = Number(ereignis.videoTime);
  const basis = Number.isFinite(stelle) && stelle > 0 ? stelle : 0;
  // Steht der Host, ist seine Stelle die Antwort - da laeuft nichts weiter.
  if (!ereignis.playing || !ereignis.hatUhr) return basis;

  const stempel = Number(ereignis.timestamp);
  const jetzt = Number(serverJetzt);
  if (!Number.isFinite(stempel) || stempel <= 0 || !Number.isFinite(jetzt)) return basis;

  const vergangen = (jetzt - stempel) / 1000;
  if (!Number.isFinite(vergangen) || vergangen <= 0) return basis;
  // Nach oben gedeckelt: eine Nachricht, die eine halbe Minute unterwegs war,
  // ist kein Grund, eine halbe Minute weiterzuspringen - dann stimmt etwas
  // anderes nicht, und ein zu weiter Sprung waere die schlechtere Antwort.
  return basis + Math.min(vergangen, 30);
}

// --- 2. Laufender Betrieb: fast immer nichts tun -----------------------------
//
// Waehrend beide laufen, wird der Player nicht angefasst. Kein Tempo, keine
// kleinen Korrekturen, kein Nachregeln. Ein paar Sekunden Versatz sieht beim
// gemeinsamen Schauen niemand; jede Korrektur dagegen ruckelt, klingt schief
// oder laesst den Hoster neu puffern - und das Puffern erzeugt genau den
// Versatz, den man beheben wollte.
//
// Erst wenn der Versatz ueber fuenf Sekunden liegt UND das dreimal
// hintereinander gemessen wurde, wird einmal gesprungen. Die Bestaetigung ist
// wichtig: eine einzelne Messung faellt schon dann aus dem Rahmen, wenn der
// Host gerade selbst puffert oder eine Meldung verspaetet ankam.
//
// `zustand` wird dabei fortgeschrieben und gehoert zum Player - nicht zur
// Nachricht. Beim Folgenwechsel faengt er von vorn an.
function driftEntscheiden(zustand, messung) {
  const GRENZE_S = 5;
  const NOETIGE_TREFFER = 3;
  const RUHE_MS = 15000;
  // So lange gilt eine Messung als Vorgaengerin der naechsten. Reisst die
  // Reihe - weil das Relay nichts mehr meldet, seit der Versatz klein ist -,
  // faengt das Zaehlen von vorn an.
  const REIHE_MS = 8000;

  const jetzt = Number(messung.jetzt) || 0;
  const betrag = Math.abs(Number(messung.drift) || 0);

  // Waehrend gepuffert, gespult oder gestockt wird, ist jede Messung wertlos:
  // die Stelle steht, waehrend die Zeit laeuft. Also nicht messen, nicht
  // springen - und danach neu bewerten statt auf alten Zahlen aufzubauen.
  if (messung.puffert) {
    zustand.bestaetigt = 0;
    zustand.letzteMessung = 0;
    return "puffert";
  }
  // Steht der Host oder steht man selbst, entscheidet nicht der Versatz:
  // Pause und Play kommen als eigene Ereignisse und setzen die Stelle genau.
  if (!messung.laeuft) {
    zustand.bestaetigt = 0;
    zustand.letzteMessung = 0;
    return "steht";
  }

  if (zustand.letzteMessung && jetzt - zustand.letzteMessung > REIHE_MS) zustand.bestaetigt = 0;
  zustand.letzteMessung = jetzt;

  // Der Normalfall, und der einzige, der oft vorkommt.
  if (betrag <= GRENZE_S) {
    zustand.bestaetigt = 0;
    return "ignore";
  }

  zustand.bestaetigt += 1;
  if (zustand.bestaetigt < NOETIGE_TREFFER) return "beobachten";
  if (zustand.seitSprung && jetzt - zustand.seitSprung < RUHE_MS) return "cooldown";

  // Einmal springen - danach faengt die Zaehlung von vorn an und die Ruhezeit
  // laeuft. Wer dauerhaft hinterherhaengt, soll nicht alle paar Sekunden
  // nach vorn gezogen werden: genau das macht ihn noch langsamer.
  zustand.bestaetigt = 0;
  zustand.seitSprung = jetzt;
  return "hard-seek";
}

// --- 3. Veraltete Ereignisse abweisen ----------------------------------------
//
// Nachrichten koennen sich ueberholen. Ein verspaetetes Play darf nicht nach
// einem neueren Pause angewendet werden - sonst laeuft ein Geraet weiter, das
// alle anderen laengst angehalten haben.
//
// Massgeblich ist die laufende Nummer, die das Relay je Titel vergibt. Der
// Zeitstempel entscheidet nur mit, damit ein neu gestartetes Relay - das wieder
// bei eins anfaengt - nicht dauerhaft ausgesperrt wird.
function istVeraltet(letzter, ereignis) {
  if (!letzter || !ereignis) return false;

  const nummer = Number(ereignis.sequenceId) || 0;
  const stempel = Number(ereignis.timestamp) || 0;
  const letzteNummer = Number(letzter.sequenceId) || 0;
  const letzterStempel = Number(letzter.timestamp) || 0;

  // Andere Folge: eine laufende Nummer aus der Folge davor sagt hier nichts.
  // Es bleibt die Zeit - und ein Nachzuegler aus der alten Folge ist aelter als
  // der Wechsel, der gerade stattgefunden hat. Der Wechsel selbst ist neuer als
  // alles davor und kommt damit durch.
  if (ereignis.episodeId && letzter.episodeId && ereignis.episodeId !== letzter.episodeId) {
    return Boolean(stempel && letzterStempel && stempel < letzterStempel);
  }

  if (nummer && letzteNummer) {
    if (nummer > letzteNummer) return false;
    // Gleiche oder kleinere Nummer bei nicht neuerer Zeit: das ist ein
    // Nachzuegler. Ist die Zeit dagegen weiter, wurde das Relay neu gestartet.
    return stempel <= letzterStempel;
  }
  // Ein aelteres Relay vergibt keine Nummern - dann bleibt nur die Zeit.
  if (stempel && letzterStempel) return stempel < letzterStempel;
  return false;
}

// --- 4. Uhrversatz aus Ping/Pong ---------------------------------------------
//
// Nach dem Muster von NTP: t0 ist das Absenden hier, t1 die Serverzeit bei der
// Antwort, t2 der Empfang hier. Unter der Annahme, dass Hin- und Rueckweg
// gleich lang sind, ist der Versatz t1 - (t0 + t2) / 2.
//
// Aus mehreren Proben zaehlt die mit dem kuerzesten Umlauf. Das ist keine
// Sparsamkeit, sondern die genaueste: je kuerzer der Umlauf, desto kleiner der
// Fehler, den eine ungleiche Verteilung auf Hin- und Rueckweg anrichten kann.
// Ein Mittelwert waere schlechter - er zieht die verzoegerten Proben mit hinein.
function versatzAusProben(proben) {
  let beste = null;
  for (const probe of proben || []) {
    const t0 = Number(probe && probe.t0);
    const t1 = Number(probe && probe.t1);
    const t2 = Number(probe && probe.t2);
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || !Number.isFinite(t2)) continue;
    const umlauf = t2 - t0;
    // Unbrauchbar: negative Umlaeufe (die Uhr wurde waehrenddessen gestellt)
    // und alles, was so lange gebraucht hat, dass die Annahme nicht mehr traegt.
    if (umlauf < 0 || umlauf > 5000) continue;
    const versatz = t1 - (t0 + t2) / 2;
    if (!beste || umlauf < beste.umlauf) beste = { versatz, umlauf };
  }
  return beste;
}

// Der Quelltext einer dieser Funktionen, zum Einsetzen in ein Seiten-Skript.
// Siehe der Hinweis oben: so laeuft im Player wortgleich das, was hier geprueft
// wird.
function alsQuelltext(...funktionen) {
  return funktionen.map((funktion) => funktion.toString()).join("\n");
}

// --- Die Skripte, die das alles in den Player tragen --------------------------
//
// Sie stehen hier und nicht im Hauptprozess, weil sie zur Strategie gehoeren -
// und weil sie sich so gegen ein nachgebautes Video pruefen lassen, statt nur
// als Zeichenkette durch die Gegend gereicht zu werden.

// Ein Befehl von aussen. Waehrend er ausgefuehrt wird, meldet dieses Geraet
// selbst nichts zurueck.
//
// `genau` heisst: auf die Stelle des Hosts springen, auch wenn es nur eine
// Sekunde ist. Das gilt fuer jede Pause und fuers gemeinsame Gleichziehen -
// dort ist "ungefaehr" zu wenig. Beim blossen Mitlaufen bleibt es bei einer
// groben Toleranz, sonst puffert der Hoster bei jedem Takt neu.
// `warten` haelt das Versprechen offen, bis der Sprung wirklich vollzogen und
// genug gepuffert ist - erst dann darf gemeldet werden, dass dieses Geraet
// startbereit ist.
function applyScript(action, ereignis, optionen = {}) {
  // Die Aktion kommt aus einer Nachricht und landet in einem Skript-Text. Was
  // nicht auf dieser Liste steht, wird zu "seek" - so kann aus dem Netz nichts
  // in den Player-Rahmen geschrieben werden, was dort nicht hingehoert.
  const erlaubt = ["play", "pause", "seek", "syncprepare", "syncstart"];
  const sicher = erlaubt.includes(String(action)) ? String(action) : "seek";
  const genau = optionen.genau ? "true" : "false";
  const warten = optionen.warten ? "true" : "false";
  // Der Host springt nie. Er gibt den Takt vor - alle anderen richten sich nach
  // ihm, nicht umgekehrt. Anhalten und Weiterlaufen gelten fuer ihn trotzdem,
  // sonst liefe er waehrend eines Abgleichs davon.
  const nichtSpringen = optionen.nichtSpringen ? "true" : "false";
  return `(async () => {
    ${alsQuelltext(zielZeitBerechnen)}

    const medien = Array.from(document.querySelectorAll("video")).filter((m) => Number(m.duration) > 0);
    const media = medien.sort((links, rechts) => rechts.duration - links.duration)[0];
    if (!media) return "kein-video";

    const aktion = "${sicher}";
    const genau = ${genau};
    const warten = ${warten};
    const nichtSpringen = ${nichtSpringen};
    const anhalten = aktion === "pause" || aktion === "syncprepare";
    const laufen = aktion === "play" || aktion === "syncstart";

    // Das Ereignis, wie es das Relay geschickt hat, plus der gemessene
    // Uhrversatz. Damit laesst sich die Zielzeit hier im Rahmen jederzeit neu
    // ausrechnen - und genau darum geht es: zwischen dem Empfang der Nachricht
    // und dem Augenblick, in dem das Video wirklich anlaeuft, vergeht Zeit.
    const E = ${JSON.stringify(ereignisSaeubern(ereignis))};
    const versatz = ${Number(ereignis && ereignis.versatz) || 0};
    const zielJetzt = () => zielZeitBerechnen(E, Date.now() + versatz);

    // Tempo gehoert nicht zu dieser Architektur. Steht noch eines von einer
    // aelteren Fassung oder von der Seite selbst, kommt es hier weg.
    try { if (media.playbackRate !== 1) media.playbackRate = 1; } catch (_) {}

    const ziel = zielJetzt();
    // Was der eigene Player gleich von sich aus melden wird, ist nur das Echo
    // dieser Anweisung. Nur genau das wird verschluckt - eine Gegenrichtung
    // kommt weiter durch, damit Pausieren auch direkt nach einem Sync wirkt.
    window.__elfixWpErwartet = {
      aktion: anhalten ? "pause" : (laufen ? "play" : "seek"),
      ziel,
      bis: Date.now() + (warten ? 4000 : 1500)
    };

    // Warten, bis der Sprung wirklich sitzt und genug geladen ist. Wer zu
    // frueh weitermacht, startet mitten im Nachladen und liegt sofort wieder
    // hinter den anderen.
    const abwarten = (stelle, frist) => new Promise((fertig) => {
      const bis = Date.now() + frist;
      const pruefen = () => {
        const nah = stelle == null || Math.abs(Number(media.currentTime) - stelle) <= 0.5;
        if (nah && !media.seeking && media.readyState >= 3) return fertig(true);
        if (Date.now() > bis) return fertig(nah);
        setTimeout(pruefen, 80);
      };
      pruefen();
    });

    try {
      // Bei einer Pause und beim Gleichziehen sitzt jeder auf derselben Stelle
      // wie der Host - da zaehlt der Bruchteil. Sonst reicht eine halbe
      // Sekunde: naeher heranzuspringen kostet einen Puffervorgang und bringt
      // weniger, als er stoert.
      const toleranz = genau ? 0.05 : 0.5;
      const springbar = !nichtSpringen && ziel >= 0 && ziel < media.duration - 1 && (genau || ziel > 0);
      if (springbar && Math.abs(Number(media.currentTime) - ziel) > toleranz) {
        media.currentTime = ziel;
      }
      if (anhalten) media.pause();

      if (laufen) {
        // Der smarte Start. Erst dorthin, wo der Host beim Absenden war plus
        // die Laufzeit der Nachricht - dann abwarten, bis genug gepuffert ist,
        // und unmittelbar vor dem play() noch einmal nachrechnen. Der Host hat
        // waehrend des Puffems ja weitergeschaut.
        if (springbar) {
          await abwarten(ziel, 2500);
          const nachgerechnet = zielJetzt();
          // Die Schwelle liegt bewusst niedrig. Was hier fehlt, ist genau die
          // Pufferzeit von eben - und der zweite Sprung geht ein Stueck nach
          // vorn in den Bereich, der gerade geladen wurde, kostet also im
          // Regelfall keinen zweiten Puffervorgang. Bei 0,75 blieb der
          // uebliche Fall von einer halben Sekunde unkorrigiert stehen.
          if (Math.abs(Number(media.currentTime) - nachgerechnet) > 0.35) {
            media.currentTime = nachgerechnet;
            // Kuerzer und ohne Anspruch auf volle Pufferung: ein zweites
            // langes Warten wuerde das Ergebnis wieder veralten lassen.
            await abwarten(nachgerechnet, 900);
          }
          window.__elfixWpErwartet.ziel = zielJetzt();
        }
        const p = media.play();
        if (p && typeof p.then === "function") p.catch(() => {});
      }

      if (!warten) return anhalten ? "pausiert" : (laufen ? "laeuft" : "gesprungen");
      const bereit = await abwarten(nichtSpringen ? null : ziel, 2200);
      return bereit ? "bereit" : "ungenau";
    } catch (_) {
      return "fehlgeschlagen";
    }
  })()`;
}

// Die Notbremse im Player-Frame.
//
// Das Relay meldet im Zwei-Sekunden-Takt, wo der Host steht. Dieses Skript
// misst daraus den Versatz - und tut fast immer nichts damit. Kein Tempo, keine
// kleinen Korrekturen, kein Nachregeln. Beides, was frueher hier stand, hat bei
// VOE mehr kaputtgemacht als geradegerueckt:
//
// - am Tempo drehen: der Hoster wechselt dabei hoerbar die Tonhoehe, und
//   manche Player setzen die Rate von sich aus wieder zurueck, worauf sofort
//   die naechste Korrektur ansetzt
// - currentTime setzen: jedes Setzen laesst den Hoster neu puffern, und das
//   Puffern erzeugt genau den Versatz, den der Sprung beheben sollte
//
// Der Zustand liegt in dem Frame, in dem das Video wirklich haengt - bei VOE
// ist das der Rahmen des Hosters, nicht das Dokument von AniWorld. Deshalb geht
// dieses Skript in alle Frames und tut nur dort etwas, wo ein Video mit
// Laufzeit liegt.
function driftScript(ereignis) {
  return `(() => {
    ${alsQuelltext(zielZeitBerechnen, driftEntscheiden)}

    const medien = Array.from(document.querySelectorAll("video"))
      .filter((m) => Number(m.duration) > 0);
    const media = medien.sort((a, b) => b.duration - a.duration)[0];
    if (!media) return "kein-video";

    const S = (window.__elfixWpSync = window.__elfixWpSync
      || { bestaetigt: 0, seitSprung: 0, letzteMessung: 0, gemeldet: 0 });
    const E = ${JSON.stringify(ereignisSaeubern(ereignis))};
    const versatz = ${Number(ereignis && ereignis.versatz) || 0};
    const zielJetzt = () => zielZeitBerechnen(E, Date.now() + versatz);

    // Ein Tempo aus einer aelteren Fassung koennte noch stehen - dieses Skript
    // stellt keins mehr ein, raeumt ein fremdes aber weg.
    if (typeof media.playbackRate === "number" && media.playbackRate !== 1) {
      try { media.playbackRate = 1; } catch (_) {}
    }

    const stelle = Number(media.currentTime) || 0;
    const drift = zielJetzt() - stelle;
    const tat = driftEntscheiden(S, {
      drift,
      jetzt: Date.now(),
      // Puffern, Spulen und Stocken machen jede Messung wertlos: die Stelle
      // steht, waehrend die Zeit laeuft.
      puffert: media.readyState < 3 || media.seeking,
      laeuft: E.playing && !media.paused
    });

    if (tat === "hard-seek") {
      // Frisch nachrechnen: zwischen Messung und Sprung liegt zwar wenig Zeit,
      // aber es kostet nichts, und der Sprung soll sitzen.
      try { media.currentTime = zielJetzt(); } catch (_) {}
    }

    // "ignore" ist der Normalfall und soll im Log sichtbar sein - aber nicht
    // im Zwei-Sekunden-Takt. Ein Sprung wird immer geschrieben.
    const laut = tat === "hard-seek";
    if (laut || (tat !== "steht" && Date.now() - S.gemeldet > 10000)) {
      if (!laut) S.gemeldet = Date.now();
      console.log("__elfix:wp:sync:" + JSON.stringify({
        expectedHostTime: Number(zielJetzt().toFixed(2)),
        clientTime: Number(stelle.toFixed(2)),
        drift: Number(drift.toFixed(2)),
        action: tat,
        confirmed: S.bestaetigt
      }));
    }
    return tat;
  })()`;
}

// Beim Folgenwechsel faengt alles von vorn an - die Zaehlung bestaetigter
// Messungen, die Ruhezeit und die Merker gehoeren zur Folge davor. Das Tempo
// wird mit zurueckgesetzt: der Abgleich stellt zwar keins mehr ein, eine
// aeltere Fassung oder die Seite selbst aber schon.
function zuruecksetzenScript() {
  return `(() => {
    window.__elfixWpSync = { bestaetigt: 0, seitSprung: 0, letzteMessung: 0, gemeldet: 0 };
    for (const media of document.querySelectorAll("video")) {
      try { if (typeof media.playbackRate === "number") media.playbackRate = 1; } catch (_) {}
    }
    return "zurueckgesetzt";
  })()`;
}

// Nur die vier Angaben, mit denen im Player gerechnet wird - und nichts, was
// eine Zeichenkette aus dem Netz in das Skript tragen koennte.
function ereignisSaeubern(ereignis) {
  return {
    videoTime: Number(ereignis && ereignis.videoTime) || 0,
    timestamp: Number(ereignis && ereignis.timestamp) || 0,
    playing: Boolean(ereignis && ereignis.playing),
    hatUhr: Boolean(ereignis && ereignis.hatUhr)
  };
}

module.exports = {
  zielZeitBerechnen,
  driftEntscheiden,
  istVeraltet,
  versatzAusProben,
  alsQuelltext,
  applyScript,
  driftScript,
  zuruecksetzenScript
};
