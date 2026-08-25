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

// --- 5. Was mit einem eingehenden Steuerbefehl zu geschehen hat ---------------
//
// Die letzte Regel, die noch zweimal dastand - einmal in main.js, und auf
// Android gar nicht, weshalb dort ueberhaupt nichts ankam. Sie ist rein: was
// hereinkommt, ist die Nachricht und die Lage; was herauskommt, ist eine
// Anweisung. Wer sie ausfuehrt - Electron mit mehreren Ansichten oder Android
// mit einem WebView -, ist ihre Sache und nicht die dieser Funktion.
//
// Die Reihenfolge ist nicht beliebig, jede Zeile davon ist ein behobener
// Fehler:
//
//   1. Veraltetes zuerst. Ein verspaetetes Play nach einem neueren Pause
//      liesse ein Geraet weiterlaufen, das alle anderen angehalten haben.
//   2. Der Folgenwechsel vor der Folgenpruefung - er muss gerade die
//      erreichen, die noch bei der alten Folge stehen.
//   3. Erst danach die Frage, ob ueberhaupt dieselbe Folge offen ist. Wer eine
//      Folge zurueckliegt, wird nicht mitpausiert.
//   4. Der Host springt nie. Er gibt den Takt vor; Anhalten und Weiterlaufen
//      macht er trotzdem mit, sonst liefe er waehrend eines Abgleichs davon.
//
// @param nachricht  das Ereignis des Relays
// @param lage       { letzter, binHost, hostId, offen: {season, episode}|null,
//                     gleicheAdresse: boolean }
// @return { tun, merken, genau, warten, nichtSpringen, grund }
function steuerungEntscheiden(nachricht, lage = {}) {
  const nichts = (grund) => ({
    tun: "nichts", merken: null, genau: false, warten: false, nichtSpringen: false, grund
  });
  if (!nachricht || !nachricht.action) return nichts("keine aktion");

  if (istVeraltet(lage.letzter, nachricht)) return nichts("veraltet");

  const merken = {
    sequenceId: Number(nachricht.sequenceId) || 0,
    timestamp: Number(nachricht.timestamp ?? nachricht.at) || 0,
    episodeId: String(nachricht.episodeId || "")
  };
  const binHost = Boolean(lage.binHost);
  const aktion = String(nachricht.action);

  // Der Folgenwechsel geht vor allem anderen durch: er richtet sich gerade an
  // die, bei denen noch die alte Folge steht.
  if (aktion === "navigate" && nachricht.url) {
    return { tun: "navigate", merken, genau: false, warten: false, nichtSpringen: false, grund: "folgenwechsel" };
  }

  // Ab hier zaehlt nur, wer dieselbe Folge offen hat - ueber die Adresse und
  // zusaetzlich ueber die Folgenangabe der Nachricht. Die Adresse allein
  // reicht nicht: ein Ereignis der vorigen Folge kann dieselbe Serienadresse
  // tragen, wenn der Absender inzwischen gewechselt hat.
  const passt = lage.gleicheAdresse !== false
    && folgePasst(nachricht.episodeId, lage.offen && lage.offen.season, lage.offen && lage.offen.episode);
  if (!passt) return { ...nichts("andere folge"), merken };

  if (aktion === "syncprepare") {
    return { tun: "syncprepare", merken, genau: true, warten: true, nichtSpringen: binHost, grund: "gleichziehen" };
  }

  // Die laufende Messung des Hosts. Sie ist keine Korrektur - der Player
  // entscheidet selbst, ob daraus etwas folgt, und meistens folgt nichts.
  if (aktion === "hostzeit") {
    // Der Host ist die Zeitquelle und wird nie nachgeregelt.
    if (binHost) return { ...nichts("selbst host"), merken };
    // Und eine Messung von einem Host, der es nicht mehr ist, beschreibt eine
    // Runde, die es so nicht mehr gibt.
    if (nachricht.hostId && lage.hostId && nachricht.hostId !== lage.hostId) {
      return { ...nichts("alter host"), merken };
    }
    return { tun: "drift", merken, genau: false, warten: false, nichtSpringen: false, grund: "messung" };
  }

  // Pause, gezielter Sprung, Abgleich und gemeinsamer Start muessen sitzen.
  // Nur beim beilaeufigen "der andere spielt weiter" darf es ungefaehr sein.
  const genau = aktion !== "play" || Boolean(nachricht.resync);
  return {
    tun: aktion === "syncstart" ? "syncstart" : "anwenden",
    merken,
    genau,
    warten: false,
    // Der Host springt nie - die anderen kommen zu ihm.
    nichtSpringen: binHost,
    grund: aktion
  };
}

// Das Ereignis, wie es in die Player-Skripte geht. Vier Angaben zum Rechnen
// und der gemessene Uhrversatz - mehr braucht dort niemand, und mehr soll dort
// auch nicht ankommen.
function ereignisFuerPlayer(nachricht, laeuft, versatz, hatUhr) {
  return {
    videoTime: Number(nachricht.videoTime ?? nachricht.position) || 0,
    timestamp: Number(nachricht.timestamp ?? nachricht.at) || 0,
    playing: Boolean(laeuft),
    hatUhr: Boolean(hatUhr),
    versatz: Number(versatz) || 0
  };
}

// Laeuft das Video an der Quelle nach diesem Ereignis weiter? Nur dann wird die
// Laufzeit der Nachricht auf die Stelle aufgeschlagen. Ein aelteres Relay
// schickt das Feld nicht mit - dann entscheidet die Aktion.
function laeuftDanach(nachricht) {
  if (!nachricht) return false;
  if (typeof nachricht.playing === "boolean") return nachricht.playing;
  if (nachricht.action === "hostzeit") return nachricht.hostPlaying !== false;
  return nachricht.action === "play" || nachricht.action === "syncstart";
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
    // Womit play() abgelehnt hat, falls es das tat. Siehe unten: die Antwort
    // dieses Skripts soll den Unterschied zwischen "laeuft" und "abgelehnt"
    // wirklich tragen.
    let abgelehnt = "";
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
    //
    // Gemerkt wird in einer *Liste* und nicht in einem einzelnen Fach. Gemessen
    // am 25.08.2026 auf dem Telefon: das Relay schickt hinter ein Pause sofort
    // die genaue Stelle als "seek" hinterher. Beide Anweisungen kamen an,
    // bevor der Player sein Pause-Ereignis meldete - das Fach trug da schon
    // "seek", das Echo galt als eigene Tat und ging zurueck an die Runde.
    // Sichtbar wurde das an pausedBy: dort stand das Geraet, das die Pause
    // nur befolgt hatte, statt dessen, das sie ausgeloest hat.
    const merken = {
      aktion: anhalten ? "pause" : (laufen ? "play" : "seek"),
      ziel,
      bis: Date.now() + (warten ? 4000 : 1500)
    };
    // Das Fach bleibt: die Zielkorrektur weiter unten schreibt hinein, und der
    // Horcher liest es, wenn die Liste (noch) fehlt.
    window.__elfixWpErwartet = merken;
    const bisher = Array.isArray(window.__elfixWpEcho) ? window.__elfixWpEcho : [];
    window.__elfixWpEcho = bisher
      .filter((eintrag) => eintrag && Date.now() < eintrag.bis)
      .concat([merken])
      .slice(-6);

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
        // Das Versprechen von play() wird ausgewertet und nicht weggefangen.
        // Es still zu verschlucken war der Grund, warum ein abgelehntes play()
        // von aussen wie ein gelungenes aussah: die Antwort hiess "laeuft",
        // waehrend das Bild stand. Gewartet wird nur kurz - ein Player, der
        // sein Versprechen gar nicht einloest, soll den Befehl nicht aufhalten.
        try {
          const p = media.play();
          if (p && typeof p.then === "function") {
            await Promise.race([
              p.catch((fehler) => {
                abgelehnt = String((fehler && (fehler.name + ": " + fehler.message)) || fehler).slice(0, 120);
              }),
              new Promise((fertig) => setTimeout(fertig, 1200))
            ]);
          }
        } catch (fehler) {
          abgelehnt = String((fehler && fehler.message) || fehler).slice(0, 120);
        }
      }

      if (!warten) {
        if (laufen && abgelehnt) return "play-abgelehnt:" + abgelehnt;
        return anhalten ? "pausiert" : (laufen ? "laeuft" : "gesprungen");
      }
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

// --- Der Horcher am Player ---------------------------------------------------
//
// Er stand bis hierher in main.js und damit nur dem Rechner zur Verfuegung.
// Android hatte nichts davon: dort lief die Watchparty ueberhaupt nur als
// Fortschrittsabgleich, weil das Stueck fehlte, das Pause und Weiter
// ueberhaupt bemerkt. Ihn hier ein zweites Mal hinzuschreiben waere die
// dritte Fassung derselben Regel gewesen - also steht er jetzt an der Stelle,
// an der die uebrige Sync-Strategie schon stand, und beide Geraete setzen
// woertlich dasselbe Skript in ihren Player.
//
// Zwei Dinge macht er, und das zweite ist der Grund, warum eine Watchparty
// einen Folgenwechsel ueberlebt:
//
//   1. Er meldet Play, Pause und Sprung - aber nicht das Echo einer eben
//      ausgefuehrten fremden Anweisung. Das ist der Loop-Schutz, und er
//      arbeitet ueber `window.__elfixWpErwartet`, das `applyScript` setzt.
//      Kein Zeitgeber, keine pauschale Stille: verglichen wird die Art der
//      Aktion und beim Sprung zusaetzlich die Zielstelle.
//
//   2. Er haengt am *Dokument* in der Abfangphase und nicht an einzelnen
//      Videoelementen. Medienereignisse steigen nicht auf, lassen sich aber
//      abfangen - damit gilt der Horcher auch fuer ein Video, das die Seite
//      erst spaeter einsetzt. Genau das passiert bei jedem Hoster-, Sprach-
//      und Folgenwechsel, und genau daran ist die Synchronisation frueher
//      gestorben: die Horcher hingen an einem Element, das niemand mehr sah,
//      waehrend der Merker "schon eingehaengt" jede Neuanlage verhinderte.
//
// Die Meldungen gehen ueber die Konsole hinaus. Das ist kein Notbehelf: der
// Player liegt in einem fremden Rahmen, und die Konsole ist der einzige Weg,
// der aus ihm heraus auf beiden Geraeten funktioniert.

/** Womit eine Meldung dieses Horchers anfaengt. Java und main.js lesen daran mit. */
const MELDE_AKTION = "__elfix:wp:";
const MELDE_STAND = "__elfix:wp:stand:";
const MELDE_SYNC = "__elfix:wp:sync:";

// Eine Aktionsmeldung zerlegen: "__elfix:wp:play:123.45".
function aktionLesen(zeile) {
  const treffer = String(zeile || "").match(/^__elfix:wp:(play|pause|seek):(\d+(?:\.\d+)?)$/);
  return treffer ? { aktion: treffer[1], position: Number(treffer[2]) } : null;
}

// Eine Standmeldung zerlegen: "__elfix:wp:stand:123.45:0".
function standLesen(zeile) {
  const treffer = String(zeile || "").match(/^__elfix:wp:stand:(\d+(?:\.\d+)?):([01])$/);
  return treffer ? { position: Number(treffer[1]), paused: treffer[2] === "1" } : null;
}

// Meint diese Nachricht die Folge, die hier offen ist? Ein aelteres Relay
// schickt die Angabe nicht mit - dann bleibt es bei der Pruefung ueber die
// Adresse, die es schon immer gab.
function folgePasst(episodeId, season, episode) {
  const gemeint = String(episodeId || "");
  if (!gemeint) return true;
  const staffel = Number(season) || 0;
  const folge = Number(episode) || 0;
  if (!staffel && !folge) return true;
  return gemeint === `s${staffel}e${folge}`;
}

function beobachterScript() {
  return `(() => {
    if (window.__elfixWpInstalled) return "schon-da";
    window.__elfixWpInstalled = true;
    window.__elfixWpErwartet = null;
    window.__elfixWpEcho = [];

    const melden = (aktion, media) => {
      // Der eigene Player meldet eine eben ausgefuehrte fremde Anweisung als
      // eigenes Ereignis zurueck - sonst schaukeln sich zwei Player auf. Genau
      // dieses Echo wird verschluckt, aber auch nur das: drueckt jemand Pause,
      // waehrend gerade ein Play hereinkam, ist das eine echte Tat und muss
      // durch. Vorher schwieg das Geraet pauschal ein paar Sekunden lang, und
      // genau in dieser Zeit ging Pausieren nach einem Sync ins Leere.
      // Alle Anweisungen, die noch offen stehen - nicht nur die letzte. Zwei
      // koennen dicht aufeinander folgen (Pause und die genaue Stelle danach),
      // und dann gehoert das Echo der ersten immer noch dazu.
      const liste = Array.isArray(window.__elfixWpEcho) ? window.__elfixWpEcho : [];
      const einzeln = window.__elfixWpErwartet;
      const offen = einzeln && liste.indexOf(einzeln) < 0 ? liste.concat([einzeln]) : liste;
      for (const erwartet of offen) {
        if (!erwartet || Date.now() >= erwartet.bis) continue;
        // Beim Sprung entscheidet die Stelle: nur der Sprung auf genau das
        // erwartete Ziel ist das Echo. Wer waehrenddessen selbst woandershin
        // spult, meint das ernst - vorher verschluckte diese Pruefung jeden
        // zweiten Sprung, weil sie nur auf die Art schaute.
        if (aktion === "seek") {
          if (Math.abs(Number(media.currentTime) - erwartet.ziel) < 2) return;
        } else if (aktion === erwartet.aktion) {
          return;
        }
      }
      // Auf zwei Nachkommastellen: gerundete Sekunden reichen nicht, wenn alle
      // exakt auf derselben Stelle stehen sollen.
      console.log("__elfix:wp:" + aktion + ":" + (Number(media.currentTime) || 0).toFixed(2));
    };

    // Wo dieses Geraet steht - fuer die Leiste der anderen. Das haengt nicht am
    // Echo-Schutz: eine Standmeldung ist kein Befehl, sie schaukelt nichts auf.
    // Sie geht sofort raus, sobald sich etwas aendert, und waehrend der
    // Wiedergabe nebenher im Sekundentakt. Vorher hat der Hauptprozess dafuer
    // alle Frames der Seite abgefragt - langsam und teuer zugleich.
    let letzteMeldung = 0;
    const standMelden = (media, sofort) => {
      const jetzt = Date.now();
      if (!sofort && jetzt - letzteMeldung < 1000) return;
      letzteMeldung = jetzt;
      console.log("__elfix:wp:stand:"
        + (Number(media.currentTime) || 0).toFixed(2) + ":" + (media.paused ? 1 : 0));
    };

    // Am Dokument in der Abfangphase, nicht an einzelnen Videos: Medien-
    // Ereignisse steigen nicht auf, lassen sich aber abfangen. Damit gilt das
    // auch fuer ein Video, das die Seite spaeter einsetzt.
    //
    // Vorher hingen die Horcher an den Elementen, die beim Einhaengen zufaellig
    // schon da waren. Tauscht der Anbieter den Player aus - anderer Hoster,
    // andere Qualitaet, neu geladener Rahmen -, waren sie an einem Element, das
    // niemand mehr sieht, und das Geraet meldete Pause und Weiter gar nicht
    // mehr. Der Merker stand ja auf "schon eingehaengt".
    const passt = (ziel) => ziel instanceof HTMLMediaElement && Number(ziel.duration) > 0;
    const horchen = (name, tun) => document.addEventListener(name, (ereignis) => {
      if (passt(ereignis.target)) tun(ereignis.target);
    }, true);

    horchen("play", (media) => { melden("play", media); standMelden(media, true); });
    horchen("pause", (media) => { melden("pause", media); standMelden(media, true); });
    horchen("seeked", (media) => { melden("seek", media); standMelden(media, true); });
    // Puffern ist keine Pause, sieht fuer die anderen aber genauso aus:
    // die Stelle bleibt stehen. Also sofort melden, wenn es stockt.
    horchen("waiting", (media) => standMelden(media, true));
    horchen("playing", (media) => standMelden(media, true));
    horchen("timeupdate", (media) => standMelden(media, false));
    return "installiert";
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
  steuerungEntscheiden,
  ereignisFuerPlayer,
  laeuftDanach,
  MELDE_AKTION,
  MELDE_STAND,
  MELDE_SYNC,
  aktionLesen,
  standLesen,
  folgePasst,
  beobachterScript,
  zielZeitBerechnen,
  driftEntscheiden,
  istVeraltet,
  versatzAusProben,
  alsQuelltext,
  applyScript,
  driftScript,
  zuruecksetzenScript
};
