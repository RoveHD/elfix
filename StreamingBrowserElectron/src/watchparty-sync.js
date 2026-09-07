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
  // Beim doppelten Tempo ist die Quelle in derselben Zeit doppelt so weit. Ohne
  // diesen Faktor stiege jeder Nachzuegler bei 2x um die halbe Laufzeit der
  // Nachricht zu frueh ein - und bei 0,5x um dieselbe Spanne zu spaet.
  const tempo = Number(ereignis.tempo) > 0 ? Number(ereignis.tempo) : 1;
  // Nach oben gedeckelt: eine Nachricht, die eine halbe Minute unterwegs war,
  // ist kein Grund, eine halbe Minute weiterzuspringen - dann stimmt etwas
  // anderes nicht, und ein zu weiter Sprung waere die schlechtere Antwort.
  return basis + Math.min(vergangen, 30) * tempo;
}

// --- 1b. Der verabredete Start -----------------------------------------------
//
// Der smarte Start oben beantwortet "wo steht der Host jetzt?". Er beantwortet
// nicht die zweite Haelfte der Frage: "jetzt" ist der Augenblick, in dem die
// Nachricht ankommt - und bis das Video wirklich laeuft, vergeht noch etwas.
// Erst muss gesprungen werden, dann muss der Puffer an der neuen Stelle stehen,
// dann nimmt play() den Befehl an, und dann kommt das erste Bild. Auf einem
// Telefon sind das ein paar Zehntel, am Fernseher gern eine ganze Sekunde. Wer
// auf "wo der Host jetzt steht" springt und dann losfaehrt, ist deshalb
// grundsaetzlich um genau diese Spanne zu spaet - jedes Mal, und es bleibt fuer
// den Rest der Folge stehen.
//
// Also wird nicht "sofort" gestartet, sondern zu einem verabredeten Zeitpunkt:
// alle springen auf die Stelle, an der der Host in `vorlauf` Millisekunden
// stehen wird, machen sich fertig - und lassen dann gleichzeitig los. Der
// Vorlauf ist die Zeit, die das Fertigmachen bekommt; wer sie nicht braucht,
// wartet den Rest ab, statt zu frueh anzufangen.
//
// Der Host verabredet nichts. Er laeuft schon; sein Bild ist die Vorlage, nach
// der sich die anderen richten. Deshalb ruft ihn niemand mit einem Vorlauf auf.
const START_VORLAUF_MS = 800;

/**
 * Wohin springen und wie lange danach warten.
 *
 * @param ereignis    das Ereignis des Relays, durch ereignisFuerPlayer gegangen
 * @param serverJetzt die Serverzeit in diesem Augenblick
 * @param vorlaufMs   wieviel Zeit das Fertigmachen bekommt; 0 heisst "sofort"
 * @return { stelle, wartenMs }
 */
function startPlan(ereignis, serverJetzt, vorlaufMs) {
  const roh = Number(vorlaufMs);
  const vorlauf = Number.isFinite(roh) ? Math.max(0, Math.min(roh, 5000)) : START_VORLAUF_MS;
  const sofort = { stelle: zielZeitBerechnen(ereignis, serverJetzt), wartenMs: 0 };

  /*
   * Der verabredete Zeitpunkt schlaegt alles andere.
   *
   * Steht er im Ereignis, hat das Relay ihn festgelegt und an alle geschickt -
   * an den, der Play gedrueckt hat, genauso wie an die anderen. `videoTime`
   * ist dann die Stelle *zu diesem Zeitpunkt* und nicht die von jetzt: der
   * Ausloeser bleibt bis dahin stehen, also aendert sie sich nicht. Deshalb
   * wird hier auch nicht hochgerechnet - es gibt nichts hochzurechnen.
   *
   * Wer erst nach dem Zeitpunkt bereit wird, bekommt die verstrichene Zeit an
   * der Stelle gutgeschrieben; bei doppeltem Tempo doppelt so viel Film.
   */
  const verabredet = Number(ereignis && ereignis.startAt);
  if (ereignis && ereignis.playing && ereignis.hatUhr
    && Number.isFinite(verabredet) && verabredet > 0 && Number.isFinite(Number(serverJetzt))) {
    const basis = Number(ereignis.videoTime);
    const stelle = Number.isFinite(basis) && basis > 0 ? basis : 0;
    const warten = verabredet - Number(serverJetzt);
    const tempo = Number(ereignis.tempo) > 0 ? Number(ereignis.tempo) : 1;
    // Nach oben gedeckelt wie in zielZeitBerechnen: ein Zeitpunkt, der eine
    // halbe Minute zurueckliegt, beschreibt keinen gemeinsamen Start mehr.
    const zuspaet = Math.min(Math.max(0, -warten), 30000) / 1000;
    return { stelle: stelle + zuspaet * tempo, wartenMs: Math.max(0, warten) };
  }

  // Steht die Quelle, gibt es nichts zu verabreden: die Stelle des Absenders
  // ist die Antwort, und zwar auf die Millisekunde. Genau das ist der Fall
  // "Pause" - dort zaehlt das Bild, nicht der Zeitpunkt.
  if (!ereignis || !ereignis.playing) return sofort;
  // Ohne gemessenen Uhrversatz laesst sich kein gemeinsamer Zeitpunkt
  // ausrechnen - dieselbe Notbremse wie in zielZeitBerechnen.
  if (!ereignis.hatUhr || !vorlauf) return sofort;
  const jetzt = Number(serverJetzt);
  if (!Number.isFinite(jetzt)) return sofort;
  return { stelle: zielZeitBerechnen(ereignis, jetzt + vorlauf), wartenMs: vorlauf };
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
//   4. Die Stelle des Relays ist verbindlich. Auch der Ausloeser folgt ihr bei
//      Pause, Sprung, Gleichziehen und geplantem Start.
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
    return { tun: "syncprepare", merken, genau: true, warten: true, nichtSpringen: false, grund: "gleichziehen" };
  }

  // Tempo und Fassung sind Einstellungen der Runde, keine Stellen. Sie halten
  // nichts an, springen nirgendwohin und laufen deshalb an der ganzen
  // Stellenrechnung vorbei. Beides darf nur der Host setzen - das steht im
  // Relay, wo es niemand umgehen kann.
  if (aktion === "tempo") {
    return {
      tun: "tempo", merken, genau: false, warten: false, nichtSpringen: false,
      tempo: tempoLesen(nachricht.tempo), grund: "tempo"
    };
  }
  if (aktion === "fassung") {
    return {
      tun: "fassung", merken, genau: false, warten: false, nichtSpringen: false,
      fassung: String(nachricht.fassung || ""), hoster: String(nachricht.hoster || ""),
      grund: "fassung"
    };
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
    // Das Relay hat die autoritative Stelle festgelegt. Auch der Ausloeser
    // folgt ihr bei Pause, Seek und geplantem Play, damit kein lokaler Stand
    // als zweite Zeitquelle übrig bleibt.
    nichtSpringen: false,
    grund: aktion
  };
}

// Das Ereignis, wie es in die Player-Skripte geht. Vier Angaben zum Rechnen
// und der gemessene Uhrversatz - mehr braucht dort niemand, und mehr soll dort
// auch nicht ankommen.
function ereignisFuerPlayer(nachricht, laeuft, versatz, hatUhr) {
  const roheFrameTime = nachricht && nachricht.frameTime;
  const frameTime = typeof roheFrameTime === "number" && Number.isFinite(roheFrameTime)
    && roheFrameTime >= 0 ? roheFrameTime : NaN;
  const ereignis = {
    videoTime: Number(nachricht.videoTime ?? nachricht.position) || 0,
    timestamp: Number(nachricht.timestamp ?? nachricht.at) || 0,
    playing: Boolean(laeuft),
    hatUhr: Boolean(hatUhr),
    versatz: Number(versatz) || 0,
    // Der gemeinsame Startzeitpunkt in Serverzeit. Null heisst: keiner
    // verabredet - dann gilt die Hochrechnung aus timestamp wie bisher.
    startAt: Number(nachricht.startAt) || 0,
    // Das Tempo der Runde reist mit jedem Ereignis mit: die Hochrechnung im
    // Player braucht es, und dort steht sonst nichts darueber.
    tempo: tempoLesen(nachricht.tempo)
  };
  // `0` ist ein gueltiger erster Frame. Fehlt die Metadatenangabe hingegen,
  // darf sie nicht durch Number(null) als erfundene 0:00 weiterreisen.
  if (Number.isFinite(frameTime)) ereignis.frameTime = frameTime;
  return ereignis;
}

// --- Das Tempo der Runde -----------------------------------------------------
//
// Eine feste Leiter statt einer freien Zahl. Zwei Gruende: was hier hereinkommt,
// kommt aus dem Netz und landet in einem Player - und eine Runde, in der einer
// auf 1,03 steht, laeuft langsam auseinander, ohne dass jemand sagen koennte,
// woran es liegt.
const TEMPO_STUFEN = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** Die naechstliegende Stufe. Alles Unbrauchbare wird zu 1 - dem Normalfall. */
function tempoLesen(wert) {
  const zahl = Number(wert);
  if (!Number.isFinite(zahl) || zahl <= 0) return 1;
  let beste = 1;
  let abstand = Infinity;
  for (const stufe of TEMPO_STUFEN) {
    const weite = Math.abs(stufe - zahl);
    if (weite < abstand) { abstand = weite; beste = stufe; }
  }
  return beste;
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

/**
 * Eine Stelle als Text, ohne Verlust.
 *
 * <p>Die Meldungen aus dem Hoster-Rahmen gehen als Konsolenzeile hinaus und
 * werden drueben wieder gelesen. Die Zahl darf dabei nichts verlieren -
 * `String(421.037)` ist "421.037" und `Number("421.037")` wieder 421.037.
 *
 * <p>Der einzige Fall, in dem `String` nicht taugt, ist die
 * Exponentialschreibweise: `String(1e-7)` ergibt "1e-7", und das Muster auf der
 * Gegenseite liest nur Ziffern und Punkt. Eine Videostelle unter einer
 * Millionstelsekunde ist null, also wird sie es auch.
 */
function genaueZahl(wert) {
  const zahl = Number(wert);
  if (!Number.isFinite(zahl) || zahl <= 0) return "0";
  if (zahl < 1e-6) return "0";
  const text = String(zahl);
  return /e/i.test(text) ? zahl.toFixed(6) : text;
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
  return `(async () => {
    ${alsQuelltext(zielZeitBerechnen, startPlan)}

    const medien = Array.from(document.querySelectorAll("video")).filter((m) => Number(m.duration) > 0);
    const media = medien.sort((links, rechts) => rechts.duration - links.duration)[0];
    if (!media) return "kein-video";

    const aktion = "${sicher}";
    const genau = ${genau};
    const warten = ${warten};
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
    const serverJetzt = () => Date.now() + versatz;
    const planJetzt = () => startPlan(E, serverJetzt(), 0);
    // currentTime kann zwischen zwei Bildern liegen. Fuer eine Pause und den
    // vorbereiteten gemeinsamen Start ist die rVFC-Medienzeit das sichtbare
    // Bild und damit die maßgebliche Stelle; das Relay setzt videoTime dazu
    // ebenfalls auf denselben Wert.
    const frameZiel = Number(E.frameTime);
    const hatFrameZiel = Number.isFinite(frameZiel) && frameZiel >= 0;
    const zielJetzt = () => {
      // Nach der gemeinsamen Startlinie beschreibt videoTime bereits die
      // kanonische laufende Stelle. frameTime war das Standbild beim
      // Vorbereiten und darf dann nicht die Verspätung abschneiden.
      const geplant = Number(E.startAt);
      const nochVorStart = laufen && Number.isFinite(geplant) && geplant > serverJetzt();
      return (hatFrameZiel && (anhalten || nochVorStart)) ? frameZiel : planJetzt().stelle;
    };
    // Jede neue Anweisung macht alle noch wartenden Teile der vorherigen
    // ungültig. Das schließt ein lokales Pause/Seek aus dem Beobachter ein.
    const generation = (Number(window.__elfixWpGeneration) || 0) + 1;
    window.__elfixWpGeneration = generation;
    const aktuell = () => window.__elfixWpGeneration === generation;
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

    // Warten, bis der Sprung wirklich sitzt und genug geladen ist. Bei Pause
    // und gezieltem Seek ist ein Millisekunden-Bild die Vorgabe, nicht eine
    // grobe Naeherung.
    const abwarten = (stelle, frist, toleranz) => new Promise((fertig) => {
      const bis = Date.now() + frist;
      const pruefen = () => {
        if (!aktuell()) return fertig(false);
        const nah = stelle == null || Math.abs(Number(media.currentTime) - stelle) <= toleranz;
        if (nah && !media.seeking && media.readyState >= 3) return fertig(true);
        if (Date.now() > bis) return fertig(nah && !media.seeking && media.readyState >= 3);
        setTimeout(pruefen, 25);
      };
      pruefen();
    });

    const sprungSitzen = async (stelle, genau) => {
      const toleranz = genau ? 0.001 : 0.35;
      // Manche Hoster verwerfen den ersten Seek, solange sie noch laden.
      // Drei kurze, begrenzte Versuche sind genug; danach bleibt das Ergebnis
      // sichtbar als "ungenau", statt eine alte Aktion endlos fortzusetzen.
      for (let versuch = 0; versuch < 3 && aktuell(); versuch += 1) {
        if (Math.abs(Number(media.currentTime) - stelle) > toleranz) media.currentTime = stelle;
        if (await abwarten(stelle, 450, toleranz)) return true;
      }
      return Math.abs(Number(media.currentTime) - stelle) <= toleranz
        && !media.seeking && media.readyState >= 3;
    };

    const bisZeitpunkt = (ms) => new Promise((fertig) => {
      const warten = () => {
        if (!aktuell() || Date.now() >= ms) return fertig(aktuell());
        setTimeout(warten, Math.min(25, Math.max(1, ms - Date.now())));
      };
      warten();
    });

    const fremdPausieren = () => {
      const pauseEcho = { aktion: "pause", ziel: Number(media.currentTime), bis: Date.now() + 1500 };
      window.__elfixWpEcho = (Array.isArray(window.__elfixWpEcho) ? window.__elfixWpEcho : [])
        .concat([pauseEcho]).slice(-6);
      media.pause();
    };

    try {
      const praezise = genau || anhalten || aktion === "seek";
      const springbar = ziel >= 0 && ziel <= media.duration && (praezise || ziel > 0);
      // Beim Anhalten muss erst das laufende Bild stehen. Ein asynchroner Seek
      // auf einem noch laufenden Video verschiebt sonst gerade die Stelle, die
      // als gemeinsames Standbild gelten soll. Auch ein geplanter Start hält
      // vor dem Vorbereiten an.
      if (anhalten || laufen) fremdPausieren();
      if (springbar) await sprungSitzen(ziel, praezise);
      if (!aktuell()) return "abgebrochen";

      if (laufen) {
        // Der Serverzeitpunkt ist die gemeinsame Startlinie. Bis dahin bleibt
        // auch der Ausloeser stehen; ältere asynchrone Plays verlieren hier
        // gegen jedes spätere Pause/Seek.
        const plan = planJetzt();
        if (plan.wartenMs > 0 && !(await bisZeitpunkt(Date.now() + plan.wartenMs))) return "abgebrochen";
        if (!aktuell()) return "abgebrochen";
        const nachgerechnet = zielJetzt();
        // Nach der Deadline wird nicht noch auf einen millisekundengenauen
        // Seek gewartet: das würde gerade den gemeinsamen Start verpassen.
        // Ein nennenswerter später Timer wird einmal direkt korrigiert.
        if (nachgerechnet >= 0 && nachgerechnet <= media.duration
          && Math.abs(Number(media.currentTime) - nachgerechnet) > 0.02) {
          media.currentTime = nachgerechnet;
          merken.ziel = nachgerechnet;
          window.__elfixWpErwartet = merken;
        }
        // Das Versprechen von play() wird ausgewertet und nicht weggefangen.
        // Es still zu verschlucken war der Grund, warum ein abgelehntes play()
        // von aussen wie ein gelungenes aussah: die Antwort hiess "laeuft",
        // waehrend das Bild stand. Gewartet wird nur kurz - ein Player, der
        // sein Versprechen gar nicht einloest, soll den Befehl nicht aufhalten.
        try {
          if (!aktuell()) return "abgebrochen";
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

        // Nimmt ein langsamer Player play() an, bewegt sein erstes Bild sich
        // manchmal erst deutlich später. Ein einmaliger Sprung nach vorn holt
        // nur diesen Startnachlauf auf; jede spätere Korrektur bleibt weiter
        // der konservativen Driftregel vorbehalten.
        if (!abgelehnt && aktuell()) {
          const bis = Date.now() + 1500;
          let vorher = Number(media.currentTime);
          const nachlauf = () => {
            if (!aktuell()) return;
            const stelle = Number(media.currentTime);
            if (media.paused || media.seeking || media.readyState < 3 || stelle <= vorher) {
              vorher = stelle;
              if (Date.now() < bis) setTimeout(nachlauf, 50);
              return;
            }
            const soll = zielJetzt();
            const rueckstand = soll - stelle;
            if (rueckstand > 0.6 && rueckstand < 15 && soll >= 0 && soll <= media.duration) {
              media.currentTime = soll;
              merken.ziel = soll;
              merken.bis = Date.now() + 1500;
              window.__elfixWpErwartet = merken;
            }
          };
          setTimeout(nachlauf, 50);
        }

      }

      if (!warten) {
        if (laufen && abgelehnt) return "play-abgelehnt:" + abgelehnt;
        return anhalten ? "pausiert" : (laufen ? "laeuft" : "gesprungen");
      }
      const bereit = await abwarten(anhalten ? ziel : null, 2200, anhalten ? 0.001 : 0.35);
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
// Ob die Bedienelemente des Players gerade zu sehen sind. Daran haengt die
// Teilnehmerleiste im Vollbild: sie soll mit ihnen kommen und mit ihnen gehen
// und nicht nach einem eigenen Zeitgeber, der irgendwann danebenliegt.
const MELDE_UI = "__elfix:wp:ui:";

/**
 * Wie lange ohne jede Regung als "die Steuerung ist weg" gilt.
 *
 * <p>Nur der Rueckfall fuer Player, deren Leiste sich nicht finden laesst.
 * Drei Sekunden ist, was JW Player selbst einstellt; laenger fuehlt sich der
 * Streifen an, als bliebe er haengen.
 */
const UI_RUHE_MS = 3200;

// Eine Aktionsmeldung zerlegen: "__elfix:wp:play:123.45".
function aktionLesen(zeile) {
  const treffer = String(zeile || "").match(/^__elfix:wp:(play|pause|seek):(\d+(?:\.\d+)?)$/);
  return treffer ? { aktion: treffer[1], position: Number(treffer[2]) } : null;
}

// Eine Standmeldung zerlegen: "__elfix:wp:stand:123.45:0".
function standLesen(zeile) {
  // Die Laufzeit kam spaeter dazu und ist deshalb wahlfrei: eine Zeile ohne
  // sie stammt von einer aelteren Fassung und bleibt lesbar. `duration` ist
  // dann undefined - und genau daran erkennt der Empfaenger, dass diese
  // Gegenstelle ueber ihre Gueltigkeit nichts sagen kann.
  const treffer = String(zeile || "")
    .match(/^__elfix:wp:stand:(\d+(?:\.\d+)?):([01])(?::(\d+(?:\.\d+)?))?(?::(\d+(?:\.\d+)?))?$/);
  if (!treffer) return null;
  const stand = { position: Number(treffer[1]), paused: treffer[2] === "1" };
  if (treffer[3] !== undefined) stand.duration = Number(treffer[3]);
  if (treffer[4] !== undefined) stand.frameTime = Number(treffer[4]);
  return stand;
}

// Eine Meldung ueber die Bedienelemente zerlegen: "__elfix:wp:ui:1".
//
// Rueckgabe null heisst "keine solche Zeile" - nicht "unsichtbar". Der
// Unterschied zaehlt: eine unlesbare Zeile darf die Leiste nicht wegnehmen.
function uiLesen(zeile) {
  const treffer = String(zeile || "").match(/^__elfix:wp:ui:([01])$/);
  return treffer ? { sichtbar: treffer[1] === "1" } : null;
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

// Sie reist mit in den Rahmen: das Beobachterskript wird aus Quelltext
// zusammengesetzt (siehe alsQuelltext), und was es ruft, muss dort stehen.
function beobachterScript() {
  return `(() => {
    if (window.__elfixWpInstalled) return "schon-da";
    window.__elfixWpInstalled = true;
    window.__elfixWpErwartet = null;
    window.__elfixWpEcho = [];

    ${alsQuelltext(genaueZahl)}

    // requestVideoFrameCallback liefert die Medienzeit des tatsächlich
    // gezeichneten Frames. currentTime kann dazwischen liegen und beschreibt
    // dann auf Android und Chromium verschiedene Nachbarbilder.
    const frames = new WeakMap();
    const rahmenBeobachten = (media) => {
      if (!media || typeof media.requestVideoFrameCallback !== "function") return;
      let zustand = frames.get(media);
      if (!zustand) {
        zustand = { frameTime: null, gueltig: true, wartet: false };
        frames.set(media, zustand);
      }
      if (zustand.wartet) return;
      zustand.wartet = true;
      try {
        media.requestVideoFrameCallback((_, meta) => {
          zustand.wartet = false;
          if (!zustand.gueltig || frames.get(media) !== zustand) return;
          const zeit = meta && meta.mediaTime;
          zustand.frameTime = typeof zeit === "number" && Number.isFinite(zeit) && zeit >= 0 ? zeit : null;
          rahmenBeobachten(media);
        });
      } catch (_) { zustand.wartet = false; }
    };
    const frameZeit = (media) => {
      rahmenBeobachten(media);
      const wert = frames.get(media)?.frameTime;
      const stelle = Number(media.currentTime);
      return media.paused && !media.seeking && typeof wert === "number" && Number.isFinite(wert)
        && Number.isFinite(stelle) && Math.abs(wert - stelle) < 0.25 ? wert : null;
    };
    const frameVergessen = (media) => {
      const zustand = frames.get(media);
      if (zustand) zustand.gueltig = false;
      frames.delete(media);
      rahmenBeobachten(media);
    };

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
      for (let index = 0; index < offen.length; index += 1) {
        const erwartet = offen[index];
        if (!erwartet || Date.now() >= erwartet.bis) continue;
        // Beim Sprung entscheidet die Stelle: nur der Sprung auf genau das
        // erwartete Ziel ist das Echo. Wer waehrenddessen selbst woandershin
        // spult, meint das ernst - vorher verschluckte diese Pruefung jeden
        // zweiten Sprung, weil sie nur auf die Art schaute.
        if (aktion === "seek") {
          if (Math.abs(Number(media.currentTime) - erwartet.ziel) <= 0.001) {
            window.__elfixWpEcho = offen.filter((eintrag, i) => i !== index && eintrag && Date.now() < eintrag.bis);
            if (window.__elfixWpErwartet === erwartet) window.__elfixWpErwartet = null;
            return;
          }
        } else if (aktion === erwartet.aktion) {
          window.__elfixWpEcho = offen.filter((eintrag, i) => i !== index && eintrag && Date.now() < eintrag.bis);
          if (window.__elfixWpErwartet === erwartet) window.__elfixWpErwartet = null;
          return;
        }
      }
      // Die volle Zahl, nicht zwei Nachkommastellen.
      //
      // Hier stand toFixed(2). Das sind Hundertstelsekunden - und damit war
      // die Stelle gerundet, *bevor* sie den Player verlassen hat: aus 421.037
      // wurde 421.04. Bei vierundzwanzig Bildern je Sekunde ist ein Bild rund
      // 42 Millisekunden lang; zehn Millisekunden Rundung treffen deshalb oft
      // noch dasselbe Bild, aber eben nicht immer - und wo zwei Geraete
      // gegenlaeufig runden, sind es zwanzig. Genau das war "dieselbe Sekunde,
      // anderes Standbild".
      console.log("__elfix:wp:" + aktion + ":" + genaueZahl(media.currentTime));
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
      // Die Laufzeit gehoert dazu, und zwar als dritter Teil.
      //
      // Sie ist die Auskunft, an der ein Empfaenger "steht wirklich bei 0:00"
      // von "Player ist noch nicht bereit" unterscheiden kann: ein frisch
      // geladenes Video meldet currentTime 0 *und* duration 0, ein Zuschauer
      // am Anfang der Folge meldet 0 mit echter Laufzeit. Ohne sie ist beides
      // dieselbe Zahl.
      //
      // Angehaengt und nicht eingeschoben: eine aeltere Gegenstelle liest die
      // Zeile weiter mit ihrem alten Muster und ignoriert den Rest.
      const laufzeit = Number(media.duration);
      const frame = frameZeit(media);
      console.log("__elfix:wp:stand:"
        + genaueZahl(media.currentTime) + ":" + (media.paused ? 1 : 0)
        + ":" + (Number.isFinite(laufzeit) && laufzeit > 0 ? genaueZahl(laufzeit) : "0")
        + (frame == null ? "" : ":" + genaueZahl(frame)));
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

    horchen("play", (media) => {
      // Ein lokales Weiter darf nicht vor der Relay-Antwort loslaufen. Es
      // meldet den Wunsch, hält sofort wieder an und wartet auf den
      // autoritativen geplanten Play-Befehl, der auch zum Auslöser zurückgeht.
      const liste = Array.isArray(window.__elfixWpEcho) ? window.__elfixWpEcho : [];
      const intern = liste.some((eintrag) => eintrag && Date.now() < eintrag.bis
        && eintrag.aktion === "play");
      if (!intern) {
        window.__elfixWpGeneration = (Number(window.__elfixWpGeneration) || 0) + 1;
        const pause = { aktion: "pause", ziel: Number(media.currentTime), bis: Date.now() + 1500 };
        window.__elfixWpErwartet = pause;
        window.__elfixWpEcho = liste.concat([pause]).slice(-6);
        melden("play", media);
        try { media.pause(); } catch (_) {}
      } else {
        melden("play", media);
      }
      standMelden(media, true);
    });
    horchen("pause", (media) => {
      const liste = Array.isArray(window.__elfixWpEcho) ? window.__elfixWpEcho : [];
      const intern = liste.some((eintrag) => eintrag && Date.now() < eintrag.bis
        && eintrag.aktion === "pause");
      if (!intern) window.__elfixWpGeneration = (Number(window.__elfixWpGeneration) || 0) + 1;
      melden("pause", media); standMelden(media, true);
    });
    horchen("seeked", (media) => {
      const liste = Array.isArray(window.__elfixWpEcho) ? window.__elfixWpEcho : [];
      const intern = liste.some((eintrag) => eintrag && Date.now() < eintrag.bis
        && Math.abs(Number(media.currentTime) - Number(eintrag.ziel)) < 0.001);
      if (!intern) window.__elfixWpGeneration = (Number(window.__elfixWpGeneration) || 0) + 1;
      melden("seek", media); standMelden(media, true);
    });
    // Ein neuer Source darf niemals die Framezeit der vorherigen Folge
    // mitsenden. Der neue Callback wird sofort wieder scharf gemacht.
    horchen("loadstart", frameVergessen);
    horchen("emptied", frameVergessen);
    // Puffern ist keine Pause, sieht fuer die anderen aber genauso aus:
    // die Stelle bleibt stehen. Also sofort melden, wenn es stockt.
    horchen("waiting", (media) => standMelden(media, true));
    horchen("playing", (media) => standMelden(media, true));
    horchen("timeupdate", (media) => standMelden(media, false));

    // --- Sind die Bedienelemente des Players gerade zu sehen? ---------------
    //
    // Die Teilnehmerleiste im Vollbild haengt daran. Ein eigener Zeitgeber
    // waere die falsche Antwort: er faengt an, wenn ELFIX es fuer richtig
    // haelt, und der Player blendet aus, wann *er* es fuer richtig haelt -
    // zwei Uhren, die nach zwei Sekunden auseinanderlaufen.
    //
    // Zuerst wird deshalb der wirkliche Zustand gesucht. JW Player, den VOE
    // fuehrt, setzt am Wurzelknoten "jw-flag-user-inactive" und blendet die
    // Leiste per Deckkraft aus; video.js und Plyr machen es ueber eigene
    // Klassen an einer Leiste, die man messen kann. Findet sich davon nichts,
    // bleibt die Regung im Rahmen als Ersatz - und die ist immer noch besser
    // als ein Zeitgeber, der nichts beobachtet.
    // Die Leiste selbst, nicht ihr Rahmen.
    //
    // Gemessen am 25.08.2026 im VOE-Rahmen (JW Player), waehrend die
    // Bedienelemente ausgeblendet waren:
    //
    //   .jw-controls     832x384  opacity 1  visible   <- der Rahmen, immer da
    //   .jw-controlbar   832x60   opacity 0  hidden    <- die Leiste
    //
    // Wer den Rahmen misst, bekommt immer "sichtbar" und die Teilnehmerleiste
    // verschwindet nie. Deshalb steht hier nur, was wirklich die Leiste ist.
    const LEISTEN = [
      ".jw-controlbar", ".vjs-control-bar", ".plyr__controls",
      "[class*='control-bar']", "[class*='controlbar']"
    ];
    const sichtbarerKnoten = (knoten) => {
      try {
        const stil = getComputedStyle(knoten);
        const feld = knoten.getBoundingClientRect();
        if (stil.display === "none" || stil.visibility === "hidden") return false;
        if (Number(stil.opacity || 1) <= 0.05) return false;
        return feld.width > 8 && feld.height > 4;
      } catch (_) {
        return false;
      }
    };
    // Alle Kandidaten, nicht der erste Waehler mit Treffern.
    //
    // Gemessen am 25.08.2026 auf dem Telefon (AniWorld -> VOE): die Seite
    // traegt eine JW-artige Leiste, die zu diesem Player gar nicht gehoert und
    // dauerhaft unsichtbar ist. Wer beim ersten Waehler mit Treffern stehen
    // bleibt, misst genau die - und meldet "ausgeblendet", waehrend die
    // wirklichen Bedienelemente sichtbar unten stehen. Die Teilnehmerleiste
    // verschwand daraufhin, obwohl der Player seine Leiste zeigte.
    const leisten = () => {
      const alle = [];
      for (const w of LEISTEN) {
        try {
          for (const knoten of document.querySelectorAll(w)) {
            if (alle.indexOf(knoten) < 0) alle.push(knoten);
          }
        } catch (_) {}
      }
      return alle;
    };
    let letzteRegung = Date.now();
    const regung = () => { letzteRegung = Date.now(); };
    for (const name of ["pointerdown", "pointermove", "mousemove", "touchstart", "keydown", "click"]) {
      try { document.addEventListener(name, regung, true); } catch (_) {}
    }
    // Von aussen anstossen: tippt jemand auf den Vollbild-Rahmen, sieht dieses
    // Dokument davon unter Umstaenden nichts - Android reicht die Regung dann
    // hier herein, statt die Leiste auf gut Glueck einzublenden.
    try { window.__elfixWpRegung = regung; } catch (_) {}

    const uiZustand = () => {
      const gefunden = leisten();
      // Sichtbar ist die Steuerung, sobald *irgendeine* gefundene Leiste
      // wirklich zu sehen ist. Deckkraft zaehlt dabei mit: JW Player laesst
      // seine Leiste stehen und blendet sie nur aus.
      if (gefunden.length) return gefunden.some(sichtbarerKnoten);
      // Kein Player, dessen Leiste sich finden laesst: dann zaehlt die Regung.
      return Date.now() - letzteRegung < ${UI_RUHE_MS};
    };

    let uiGemeldet = null;
    const uiPruefen = () => {
      let jetzt = false;
      try { jetzt = uiZustand(); } catch (_) { jetzt = false; }
      if (jetzt === uiGemeldet) return;
      uiGemeldet = jetzt;
      console.log("__elfix:wp:ui:" + (jetzt ? "1" : "0"));
    };
    // Kein teurer Takt: drei Abfragen auf einem Dokument, viermal je Sekunde.
    // Gemeldet wird nur die Aenderung - im Ruhezustand geht gar nichts hinaus.
    setInterval(uiPruefen, 250);
    uiPruefen();
    return "installiert";
  })()`;
}

// Beim Folgenwechsel faengt alles von vorn an - die Zaehlung bestaetigter
// Messungen, die Ruhezeit und die Merker gehoeren zur Folge davor. Das Tempo
// wird mit zurueckgesetzt: der Abgleich stellt zwar keins mehr ein, eine
// aeltere Fassung oder die Seite selbst aber schon.
/**
 * Das Tempo der Runde in einen fremden Player tragen.
 *
 * Fuer die Anbieteransicht, in der kein eigenes Video haengt. `playbackRate` ist
 * die eine Stelle, die jeder HTML-Player hat - ob der Hoster sie in seiner
 * Bedienung anbietet oder nicht.
 *
 * Der Wert wird hier noch einmal auf die Leiter gezwungen: was im Skripttext
 * landet, kommt aus einer Nachricht aus dem Netz.
 */
function tempoScript(tempo) {
  const wert = tempoLesen(tempo);
  return `(() => {
    const medien = Array.from(document.querySelectorAll("video")).filter((m) => Number(m.duration) > 0);
    if (!medien.length) return "kein-video";
    for (const media of medien) {
      try { media.playbackRate = ${wert}; } catch (_) {}
    }
    return "tempo:${wert}";
  })()`;
}

function zuruecksetzenScript() {
  return `(() => {
    window.__elfixWpSync = { bestaetigt: 0, seitSprung: 0, letzteMessung: 0, gemeldet: 0 };
    window.__elfixWpGeneration = (Number(window.__elfixWpGeneration) || 0) + 1;
    return "zurueckgesetzt";
  })()`;
}

// Nur die vier Angaben, mit denen im Player gerechnet wird - und nichts, was
// eine Zeichenkette aus dem Netz in das Skript tragen koennte.
function ereignisSaeubern(ereignis) {
  const roheFrameTime = ereignis && ereignis.frameTime;
  const frameTime = typeof roheFrameTime === "number" && Number.isFinite(roheFrameTime)
    && roheFrameTime >= 0 ? roheFrameTime : NaN;
  const sauber = {
    videoTime: Number(ereignis && ereignis.videoTime) || 0,
    timestamp: Number(ereignis && ereignis.timestamp) || 0,
    playing: Boolean(ereignis && ereignis.playing),
    hatUhr: Boolean(ereignis && ereignis.hatUhr),
    startAt: Number(ereignis && ereignis.startAt) || 0,
    tempo: tempoLesen(ereignis && ereignis.tempo)
  };
  if (Number.isFinite(frameTime)) sauber.frameTime = frameTime;
  return sauber;
}

module.exports = {
  steuerungEntscheiden,
  ereignisFuerPlayer,
  laeuftDanach,
  MELDE_AKTION,
  MELDE_STAND,
  MELDE_SYNC,
  MELDE_UI,
  UI_RUHE_MS,
  aktionLesen,
  standLesen,
  uiLesen,
  folgePasst,
  beobachterScript,
  zielZeitBerechnen,
  driftEntscheiden,
  istVeraltet,
  versatzAusProben,
  startPlan,
  START_VORLAUF_MS,
  alsQuelltext,
  applyScript,
  driftScript,
  tempoScript,
  zuruecksetzenScript,
  TEMPO_STUFEN,
  tempoLesen,
  ereignisSaeubern
};
