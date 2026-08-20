"use strict";

// Die Sync-Strategie der YouTube-Watchparty.
//
// Sie steht bewusst neben watchparty-sync.js und nicht darin. Die Watchparty
// fuer Serien kennt einen Host, eine Folge und einen Abgleich, der die anderen
// an den Host heranzieht. Hier gibt es keinen Host: der Raumzustand auf dem
// Relay ist die Wahrheit, jeder darf ihn bewegen, und alle richten sich nach
// ihm. Das sind zwei verschiedene Rechnungen, und sie in eine Datei zu zwingen
// hiesse, an jeder Stelle zu fragen, in welchem Modus man gerade ist.
//
//   RAUMZUSTAND -> HOCHRECHNEN -> normale Abweichung aushalten
//               -> erst ab 2,5 s und zweimal bestaetigt korrigieren
//
// Wie im Serien-Modus gilt: die Entscheidungen fallen dort, wo das Video
// haengt, also in einem eingesetzten Skript. Deshalb sind sie hier reine
// Funktionen ohne Zugriff auf irgendetwas ausserhalb - die Skripte weiter
// unten setzen ihren Quelltext woertlich ein (siehe `alsQuelltext`). Es gibt
// also keine zweite Fassung, die auseinanderlaufen koennte, und die Pruefungen
// pruefen wirklich das, was im Player laeuft.
//
// Bedingung dafuer: keine Abhaengigkeit auf Modul-Ebene, keine Konstanten von
// draussen, kein `require` in den Funktionen, die eingesetzt werden.

// --- 1. Wo steht die Runde jetzt? --------------------------------------------
//
// Der Server merkt sich Stelle, Wiedergabezustand und den Zeitpunkt der letzten
// Aenderung. Laeuft das Video, gehoert die seither vergangene Zeit dazu - genau
// das ist der Fall aus der Aufgabe: 50 Sekunden, gespeichert vor vier Sekunden,
// ergibt 54.
//
// `jetzt` ist die Zeit in derselben Basis wie `updatedAt`. Wer seinen
// Uhrversatz zum Relay gemessen hat, gibt Serverzeit herein; wer nicht, rechnet
// mit der eigenen Uhr und einem Stempel, der beim Empfang gesetzt wurde. Beides
// ist in sich stimmig - gemischt waere es die Differenz zweier Systemuhren, und
// die betraegt auf ungepflegten Rechnern gern Minuten.
function zielPosition(zustand, jetzt) {
  if (!zustand) return 0;
  const stelle = Number(zustand.position);
  const basis = Number.isFinite(stelle) && stelle > 0 ? stelle : 0;
  // Steht die Runde, ist ihre Stelle die Antwort - da laeuft nichts weiter.
  if (!zustand.playing) return basis;

  const stempel = Number(zustand.updatedAt);
  const nun = Number(jetzt);
  if (!Number.isFinite(stempel) || stempel <= 0 || !Number.isFinite(nun)) return basis;

  const vergangen = (nun - stempel) / 1000;
  if (!Number.isFinite(vergangen) || vergangen <= 0) return basis;
  // Nach oben gedeckelt. Eine Stunde Hochrechnung ist keine Antwort mehr,
  // sondern geraten - dann stimmt etwas anderes nicht, und ein absurd weiter
  // Sprung waere die schlechtere Antwort.
  return basis + Math.min(vergangen, 3600);
}

// --- 2. Laufender Betrieb: fast immer nichts tun -----------------------------
//
// Ein bis zwei Sekunden Versatz sieht beim gemeinsamen Schauen niemand; jede
// Korrektur dagegen laesst YouTube neu puffern, und das Puffern erzeugt genau
// den Versatz, den man beheben wollte. Also wird erst ab 2,5 Sekunden ueber-
// haupt hingeschaut, und auch dann erst nach der zweiten Messung gesprungen.
//
// Zwei Dinge stehen ausdruecklich vor dem Versatz:
//
//   - Werbung. Waehrend eines Werbespots gehoert die Stelle im Player der
//     Werbung, nicht dem Video. Jede Messung darauf ist Unsinn.
//   - Der eigene Griff ans Steuer. Wer gerade selbst pausiert hat, ist fuer
//     einen Moment neuer als der Raumzustand, den das Relay noch bestaetigt.
//     In diesem Fenster wird nichts korrigiert, sonst nimmt die Korrektur die
//     eigene Tat zurueck.
//
// Play und Pause werden vor dem Versatz behandelt: laeuft es hier, obwohl die
// Runde steht, ist ein Ereignis verlorengegangen. Das ueber die Stelle
// reparieren zu wollen, waere aussichtslos.
function driftEntscheiden(merker, messung) {
  const GRENZE_S = 2.5;
  const NOETIGE_TREFFER = 2;
  const RUHE_MS = 10000;
  // So lange gilt eine Messung als Vorgaengerin der naechsten. Reisst die
  // Reihe, faengt das Zaehlen von vorn an.
  const REIHE_MS = 9000;
  // So lange nach einer eigenen Tat wird gar nicht gemessen.
  const EIGENE_TAT_MS = 3000;

  const jetzt = Number(messung.jetzt) || 0;
  const vergessen = () => {
    merker.bestaetigt = 0;
    merker.zustandTreffer = 0;
    merker.letzteMessung = 0;
  };

  if (messung.werbung) {
    vergessen();
    return "werbung";
  }
  // Waehrend gepuffert oder gespult wird, steht die Stelle, waehrend die Zeit
  // laeuft. Nicht messen, nicht springen - und danach neu bewerten statt auf
  // alten Zahlen aufzubauen.
  if (messung.puffert) {
    vergessen();
    return "puffert";
  }
  const seit = Number(messung.seitEigenerTat);
  if (Number.isFinite(seit) && seit >= 0 && seit < EIGENE_TAT_MS) {
    vergessen();
    return "frisch";
  }

  if (merker.letzteMessung && jetzt - merker.letzteMessung > REIHE_MS) vergessen();
  merker.letzteMessung = jetzt;

  // Play/Pause zuerst - und ebenfalls erst nach Bestaetigung. Zwischen der
  // eigenen Tat und ihrer Rueckkehr vom Relay liegen Millisekunden; wer sofort
  // gegensteuert, kaempft gegen die Nachricht, die schon unterwegs ist.
  if (Boolean(messung.laeuftSoll) !== Boolean(messung.laeuftIst)) {
    merker.zustandTreffer += 1;
    if (merker.zustandTreffer < NOETIGE_TREFFER) return "beobachten";
    merker.zustandTreffer = 0;
    return messung.laeuftSoll ? "play" : "pause";
  }
  merker.zustandTreffer = 0;

  const betrag = Math.abs(Number(messung.drift) || 0);
  // Der Normalfall, und der einzige, der oft vorkommt.
  if (betrag <= GRENZE_S) {
    merker.bestaetigt = 0;
    return "ignore";
  }

  merker.bestaetigt += 1;
  if (merker.bestaetigt < NOETIGE_TREFFER) return "beobachten";
  if (merker.seitSprung && jetzt - merker.seitSprung < RUHE_MS) return "cooldown";

  // Einmal springen - danach faengt die Zaehlung von vorn an und die Ruhezeit
  // laeuft. Wer dauerhaft hinterherhaengt, soll nicht alle paar Sekunden nach
  // vorn gezogen werden: genau das macht ihn noch langsamer.
  merker.bestaetigt = 0;
  merker.seitSprung = jetzt;
  return "springen";
}

// --- 3. Ueberholte Nachrichten abweisen --------------------------------------
//
// Der Server ist die Ordnung: jede angenommene Aktion erhoeht "rev". Ein
// verspaetetes Play mit kleinerer Nummer darf ein neueres Pause nicht
// ueberschreiben - sonst laeuft ein Geraet weiter, das alle anderen laengst
// angehalten haben.
//
// Der Zeitstempel entscheidet nur dort mit, wo die Nummer nichts sagt: ein neu
// gestartetes Relay faengt wieder bei eins an und waere sonst dauerhaft
// ausgesperrt.
function istVeraltet(letzter, neu) {
  if (!letzter || !neu) return false;

  const nummer = Number(neu.rev) || 0;
  const stempel = Number(neu.updatedAt) || 0;
  const letzteNummer = Number(letzter.rev) || 0;
  const letzterStempel = Number(letzter.updatedAt) || 0;

  if (nummer && letzteNummer) {
    if (nummer > letzteNummer) return false;
    // Gleiche oder kleinere Nummer bei nicht neuerer Zeit: ein Nachzuegler.
    // Ist die Zeit dagegen weiter, wurde das Relay neu gestartet.
    return stempel <= letzterStempel;
  }
  if (stempel && letzterStempel) return stempel < letzterStempel;
  return false;
}

// --- 4. Was ist ueberhaupt eine Aenderung? -----------------------------------
//
// Nicht jede Nachricht vom Relay muss den Player anfassen. Kommt der eigene
// Zug zurueck, ist er hier laengst vollzogen; kommt derselbe Stand ein zweites
// Mal, gibt es nichts zu tun. Beides anzuwenden waere nicht falsch, aber es
// kostet jedes Mal einen Sprung im Bild.
function brauchtAnwendung(vorher, neu, eigeneKennung) {
  if (!neu || !neu.videoId) return false;
  // Der eigene Zug. Er ist hier schon geschehen - der Rueckweg dient nur dazu,
  // die Nummer zu erfahren, unter der er angenommen wurde.
  if (eigeneKennung && neu.byId === eigeneKennung) return false;
  if (!vorher) return true;
  if (vorher.videoId !== neu.videoId) return true;
  if (Boolean(vorher.playing) !== Boolean(neu.playing)) return true;
  return (Number(neu.rev) || 0) !== (Number(vorher.rev) || 0);
}

// Der Quelltext einer dieser Funktionen, zum Einsetzen in ein Seiten-Skript.
function alsQuelltext(...funktionen) {
  return funktionen.map((funktion) => funktion.toString()).join("\n");
}

// Nur die Angaben, mit denen im Player gerechnet wird - und nichts, was eine
// Zeichenkette aus dem Netz in das Skript tragen koennte.
function zustandSaeubern(zustand) {
  return {
    position: Number(zustand && zustand.position) || 0,
    updatedAt: Number(zustand && zustand.updatedAt) || 0,
    playing: Boolean(zustand && zustand.playing)
  };
}

// --- Die Skripte, die das in die YouTube-Seite tragen ------------------------

// Das gemeinsame Stueck jedes Skripts: das richtige Video finden und wissen,
// ob gerade Werbung laeuft.
//
// YouTube fuehrt genau ein <video>-Element und spielt die Werbung darin ab.
// Waehrenddessen traegt "#movie_player" die Klasse "ad-showing", und Stelle wie
// Laufzeit gehoeren dem Spot. Wer das nicht prueft, meldet die Sekunde einer
// Werbung als Wiedergabestelle - und zieht alle anderen dorthin.
function spielerQuelltext() {
  return `
    const ytSpieler = document.querySelector("#movie_player");
    const ytWerbung = Boolean(ytSpieler && ytSpieler.classList
      && (ytSpieler.classList.contains("ad-showing") || ytSpieler.classList.contains("ad-interrupting")));
    const ytMedien = Array.from(document.querySelectorAll("video")).filter((m) => Number(m.duration) > 0);
    const media = document.querySelector("video.html5-main-video")
      || ytMedien.sort((links, rechts) => rechts.duration - links.duration)[0];`;
}

// Der Horcher in der Seite.
//
// Er meldet nur, was zur gemeinsamen Wiedergabe gehoert: Play, Pause und
// Sprung. Lautstaerke, Stumm, Vollbild, Untertitel, Fenstergroesse und alles
// andere bleiben ausdruecklich hier - die Runde teilt die Mediennavigation,
// nicht die Bedienung des Geraets.
//
// Der Echoschutz ist die wichtigste Zeile darin. Wird ein Befehl von aussen
// angewendet, meldet der eigene Player ihn als eigenes Ereignis zurueck; ohne
// diese Sperre schaukeln sich zwei Player gegenseitig auf. Verschluckt wird
// aber nur genau das erwartete Echo: drueckt jemand Pause, waehrend gerade ein
// Play hereinkam, ist das eine echte Tat und muss durch.
function beobachterScript() {
  return `(() => {
    if (window.__elfixYtInstalled) return "schon-da";
    window.__elfixYtInstalled = true;
    window.__elfixYtErwartet = null;
    window.__elfixYtTat = 0;

    const melden = (aktion, media) => {
      const spieler = document.querySelector("#movie_player");
      if (spieler && spieler.classList
        && (spieler.classList.contains("ad-showing") || spieler.classList.contains("ad-interrupting"))) return;

      const erwartet = window.__elfixYtErwartet;
      if (erwartet && Date.now() < erwartet.bis) {
        if (aktion === "seek") {
          // Beim Sprung entscheidet die Stelle: nur der Sprung auf genau das
          // erwartete Ziel ist das Echo. Wer waehrenddessen selbst woandershin
          // spult, meint das ernst.
          if (Math.abs(Number(media.currentTime) - erwartet.ziel) < 2) return;
        } else if (aktion === erwartet.aktion) {
          return;
        }
      }

      // Merker fuer den Abgleich: kurz nach einer eigenen Tat wird nicht
      // korrigiert, sonst nimmt die Korrektur sie wieder zurueck.
      window.__elfixYtTat = Date.now();
      console.log("__elfix:yt:" + aktion
        + ":" + (Number(media.currentTime) || 0).toFixed(2)
        + ":" + (media.paused ? 1 : 0));
    };

    // Am Dokument in der Abfangphase, nicht an einzelnen Videos: Medien-
    // Ereignisse steigen nicht auf, lassen sich aber abfangen. Damit gilt das
    // auch fuer ein Video, das YouTube spaeter einsetzt - und beim Wechsel
    // innerhalb der Seite setzt YouTube es regelmaessig neu.
    const passt = (ziel) => ziel instanceof HTMLMediaElement && Number(ziel.duration) > 0;
    const horchen = (name, tun) => document.addEventListener(name, (ereignis) => {
      if (passt(ereignis.target)) tun(ereignis.target);
    }, true);

    horchen("play", (media) => melden("play", media));
    horchen("pause", (media) => melden("pause", media));
    horchen("seeked", (media) => melden("seek", media));
    return "installiert";
  })()`;
}

// Einen Raumzustand auf diesen Player bringen.
//
// `aktion` sagt, was ausgeloest hat - fuer die Toleranz. Ein ausdruecklicher
// Sprung oder eine Pause soll genau sitzen; beim blossen Angleichen reicht
// grob, sonst puffert YouTube bei jedem Takt neu.
//
// Beim Anlaufen wird zweimal gerechnet: einmal vor dem Sprung und einmal
// unmittelbar vor dem play(). Dazwischen liegt das Puffern, und die anderen
// haben waehrenddessen weitergeschaut.
function anwendenScript(zustand, optionen = {}) {
  const erlaubt = ["play", "pause", "seek", "video", "state"];
  const sicher = erlaubt.includes(String(optionen.aktion)) ? String(optionen.aktion) : "state";
  const versatz = Number(optionen.versatz) || 0;
  const genau = sicher === "pause" || sicher === "seek" ? "true" : "false";
  return `(async () => {
    ${alsQuelltext(zielPosition)}
    ${spielerQuelltext()}
    if (!media) return "kein-video";
    if (ytWerbung) return "werbung";

    const Z = ${JSON.stringify(zustandSaeubern(zustand))};
    const versatz = ${versatz};
    const genau = ${genau};
    const zielJetzt = () => zielPosition(Z, Date.now() + versatz);

    // Tempo gehoert nicht zu dieser Architektur. Steht noch eines von der Seite
    // oder aus einer aelteren Fassung, kommt es hier weg.
    try { if (media.playbackRate !== 1) media.playbackRate = 1; } catch (_) {}

    const setzeErwartung = (aktion, ziel, frist) => {
      window.__elfixYtErwartet = { aktion, ziel, bis: Date.now() + frist };
    };
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
      const ziel = zielJetzt();
      const laenge = Number(media.duration) || 0;
      const springbar = ziel >= 0 && (!laenge || ziel < laenge - 1);
      const toleranz = genau ? 0.3 : 1;

      if (Z.playing) {
        setzeErwartung("play", ziel, 4000);
        if (springbar && Math.abs(Number(media.currentTime) - ziel) > toleranz) {
          media.currentTime = ziel;
          await abwarten(ziel, 2500);
          // Neu rechnen: waehrend des Pufferns sind die anderen weitergelaufen.
          const nachgerechnet = zielJetzt();
          if (Math.abs(Number(media.currentTime) - nachgerechnet) > 0.35) {
            media.currentTime = nachgerechnet;
            await abwarten(nachgerechnet, 900);
          }
        }
        window.__elfixYtErwartet.ziel = zielJetzt();
        const p = media.play();
        if (p && typeof p.then === "function") p.catch(() => {});
        return "laeuft";
      }

      // Die Erwartung wird hier bewusst nicht ueberschrieben. media.pause()
      // meldet sein Ereignis nicht sofort, sondern eine Runde spaeter; stuende
      // dann schon "seek" darin, ginge die Pause als eigene Tat hinaus und die
      // Runde pausierte ein zweites Mal. Der Sprung darunter braucht auch
      // keinen eigenen Eintrag: beim Sprung entscheidet die Stelle, und die
      // ist dieselbe.
      setzeErwartung("pause", ziel, 2500);
      media.pause();
      if (springbar && Math.abs(Number(media.currentTime) - ziel) > toleranz) {
        media.currentTime = ziel;
      }
      return "pausiert";
    } catch (_) {
      return "fehlgeschlagen";
    }
  })()`;
}

// Die Notbremse. Laeuft im Takt und tut fast immer nichts - das ist Absicht,
// siehe driftEntscheiden.
function abgleichScript(zustand, optionen = {}) {
  const versatz = Number(optionen.versatz) || 0;
  return `(() => {
    ${alsQuelltext(zielPosition, driftEntscheiden)}
    ${spielerQuelltext()}
    if (!media) return "kein-video";

    const S = (window.__elfixYtSync = window.__elfixYtSync
      || { bestaetigt: 0, zustandTreffer: 0, seitSprung: 0, letzteMessung: 0, gemeldet: 0 });
    const Z = ${JSON.stringify(zustandSaeubern(zustand))};
    const versatz = ${versatz};
    const zielJetzt = () => zielPosition(Z, Date.now() + versatz);

    if (typeof media.playbackRate === "number" && media.playbackRate !== 1) {
      try { media.playbackRate = 1; } catch (_) {}
    }

    const stelle = Number(media.currentTime) || 0;
    const ziel = zielJetzt();
    const tat = driftEntscheiden(S, {
      drift: ziel - stelle,
      jetzt: Date.now(),
      puffert: media.readyState < 3 || media.seeking,
      werbung: ytWerbung,
      laeuftSoll: Z.playing,
      laeuftIst: !media.paused,
      seitEigenerTat: Date.now() - (Number(window.__elfixYtTat) || 0)
    });

    // Jede Korrektur meldet sich vorher an, sonst schickt der Horcher sie als
    // eigene Tat wieder hinaus und die Runde zieht nach.
    if (tat === "springen") {
      try {
        const frisch = zielJetzt();
        window.__elfixYtErwartet = { aktion: "seek", ziel: frisch, bis: Date.now() + 2500 };
        media.currentTime = frisch;
      } catch (_) {}
    } else if (tat === "play") {
      try {
        const frisch = zielJetzt();
        window.__elfixYtErwartet = { aktion: "play", ziel: frisch, bis: Date.now() + 3000 };
        if (Math.abs(stelle - frisch) > 1) media.currentTime = frisch;
        const p = media.play();
        if (p && typeof p.then === "function") p.catch(() => {});
      } catch (_) {}
    } else if (tat === "pause") {
      try {
        window.__elfixYtErwartet = { aktion: "pause", ziel: ziel, bis: Date.now() + 2500 };
        media.pause();
        if (Math.abs(stelle - ziel) > 0.5) media.currentTime = ziel;
      } catch (_) {}
    }

    // "ignore" ist der Normalfall und soll im Log sichtbar sein - aber nicht im
    // Zwei-Sekunden-Takt. Ein Eingriff wird immer geschrieben.
    const laut = tat === "springen" || tat === "play" || tat === "pause";
    if (laut || (tat !== "steht" && Date.now() - S.gemeldet > 15000)) {
      if (!laut) S.gemeldet = Date.now();
      console.log("__elfix:yt:sync:" + JSON.stringify({
        soll: Number(ziel.toFixed(2)),
        ist: Number(stelle.toFixed(2)),
        drift: Number((ziel - stelle).toFixed(2)),
        action: tat,
        confirmed: S.bestaetigt
      }));
    }
    return tat;
  })()`;
}

// Neues Video, neue Rechnung: bestaetigte Messungen, Ruhezeit und Merker
// gehoeren zum Video davor.
function zuruecksetzenScript() {
  return `(() => {
    window.__elfixYtSync = { bestaetigt: 0, zustandTreffer: 0, seitSprung: 0, letzteMessung: 0, gemeldet: 0 };
    window.__elfixYtErwartet = null;
    window.__elfixYtTat = 0;
    for (const media of document.querySelectorAll("video")) {
      try { if (typeof media.playbackRate === "number") media.playbackRate = 1; } catch (_) {}
    }
    return "zurueckgesetzt";
  })()`;
}

module.exports = {
  zielPosition,
  driftEntscheiden,
  istVeraltet,
  brauchtAnwendung,
  alsQuelltext,
  zustandSaeubern,
  beobachterScript,
  anwendenScript,
  abgleichScript,
  zuruecksetzenScript
};
