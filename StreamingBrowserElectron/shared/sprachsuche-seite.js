"use strict";

// Die unsichtbare Erkennungsseite der Sprachsuche.
//
// Zwei Arten zuzuhoeren:
//   einmal   - nach dem Mikrofonknopf: der naechste Satz ist die Suche,
//              danach ist das Mikrofon wieder zu.
//   weckwort - "Hey Elfix" ist eingeschaltet: das Mikrofon bleibt offen, und
//              nur ein Satz mit dem Weckwort zaehlt. Steht der Titel gleich
//              dahinter ("hey elfix avatar"), wird sofort gesucht; sonst ist
//              der naechste Satz die Suche.
// Erkannt wird mit Vosk in einem Worker dieser Seite - offline.
(function sprachsucheSeite() {
  const host = window.ElfixSprachsucheHost;
  const text = window.ELFIX_SPRACHSUCHE_TEXT;
  if (!host || !text || !window.Vosk) return;

  const STILLE_MS = 8000;
  let modell = null;
  let audio = null;
  let modus = "aus";
  let wartetAufAnfrage = false;
  let weckGemeldet = false;
  let frist = null;
  // Wer bei laufendem "Hey Elfix" den Knopf drueckt, hoert danach wieder
  // auf das Weckwort - statt das Mikrofon ganz zu schliessen.
  let danach = "aus";

  const melden = (ereignis) => host.melden(ereignis);

  function einmalFertig() {
    if (danach !== "weckwort") { stoppen(); return; }
    modus = "weckwort";
    danach = "aus";
    wartetAufAnfrage = false;
    weckGemeldet = false;
    melden({ typ: "zustand", zustand: "wartet" });
  }

  // createModel wartet nur auf "load" - ein Fehler im Worker liesse es ewig
  // haengen. Deshalb hier selbst: Laden, Fehler oder Frist, was zuerst kommt.
  function modellLaden() {
    if (!modell) {
      modell = host.modellUrl().then((url) => new Promise((fertig, fehler) => {
        const geladen = new window.Vosk.Model(url);
        // terminate() des Modells loescht ein Modell, das es dann nicht gibt.
        const beenden = () => { try { geladen.worker.terminate(); } catch { /* schon fort */ } };
        const uhr = setTimeout(() => { beenden(); fehler(new Error("Das Sprachmodell lädt nicht")); }, 90000);
        geladen.on("load", (nachricht) => {
          clearTimeout(uhr);
          if (nachricht.result) fertig(geladen);
          else { beenden(); fehler(Object.assign(new Error("Das Sprachmodell ist beschädigt"), { modell: true })); }
        });
        geladen.on("error", (nachricht) => {
          clearTimeout(uhr);
          beenden();
          console.warn("Vosk:", nachricht.error);
          fehler(Object.assign(new Error("Das Sprachmodell konnte nicht geladen werden"), { modell: true }));
        });
        geladen.worker.addEventListener("error", () => {
          clearTimeout(uhr);
          fehler(Object.assign(new Error("Die Spracherkennung ist abgestürzt"), { modell: true }));
        });
      }));
      modell.catch(() => { modell = null; });
    }
    return modell;
  }

  function fristSetzen() {
    clearTimeout(frist);
    frist = setTimeout(() => {
      melden({ typ: "nichts" });
      if (modus === "einmal") einmalFertig();
      else { wartetAufAnfrage = false; weckGemeldet = false; melden({ typ: "zustand", zustand: "wartet" }); }
    }, STILLE_MS);
  }

  function anfrage(gesagt, quelle) {
    clearTimeout(frist);
    wartetAufAnfrage = false;
    weckGemeldet = false;
    const suche = text.bereinigen(gesagt);
    if (suche) melden({ typ: "anfrage", text: suche, quelle });
    else melden({ typ: "nichts" });
    if (modus === "einmal") einmalFertig();
    else melden({ typ: "zustand", zustand: "wartet" });
  }

  function ergebnis(gesagt) {
    const satz = text.normal(gesagt);
    if (!satz) return;
    if (modus === "einmal" || wartetAufAnfrage) { anfrage(satz, modus === "einmal" ? "knopf" : "weckwort"); return; }
    const weck = text.weckwort(satz);
    if (!weck.erkannt) { weckGemeldet = false; return; }
    if (weck.rest) { anfrage(weck.rest, "weckwort"); return; }
    wartetAufAnfrage = true;
    if (!weckGemeldet) melden({ typ: "weckwort" });
    weckGemeldet = true;
    melden({ typ: "zustand", zustand: "hoert" });
    fristSetzen();
  }

  function teil(gesagt) {
    const satz = text.normal(gesagt);
    if (!satz) return;
    if (modus === "einmal" || wartetAufAnfrage) {
      melden({ typ: "teil", text: satz });
      fristSetzen();
      return;
    }
    // Das Weckwort schon im Teilergebnis melden: die Oberflaeche zeigt
    // "Ich hoere", waehrend der Titel noch gesprochen wird.
    if (!weckGemeldet && text.weckwort(satz).erkannt) {
      weckGemeldet = true;
      melden({ typ: "weckwort" });
    }
  }

  async function audioStarten() {
    if (audio) return;
    const geladen = await modellLaden();
    if (!(await host.mikrofon())) throw new Error("Mikrofon nicht freigegeben");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false
    });
    const kontext = new AudioContext();
    const erkenner = new geladen.KaldiRecognizer(kontext.sampleRate);
    erkenner.on("result", (nachricht) => ergebnis(nachricht.result?.text));
    erkenner.on("partialresult", (nachricht) => teil(nachricht.result?.partial));
    const quelle = kontext.createMediaStreamSource(stream);
    const knoten = kontext.createScriptProcessor(4096, 1, 1);
    knoten.onaudioprocess = (ereignis) => {
      try { erkenner.acceptWaveform(ereignis.inputBuffer); } catch { /* ein verlorener Block ist kein Abbruch */ }
    };
    quelle.connect(knoten);
    knoten.connect(kontext.destination);
    audio = { stream, kontext, erkenner, quelle, knoten };
  }

  function stoppen() {
    clearTimeout(frist);
    modus = "aus";
    danach = "aus";
    wartetAufAnfrage = false;
    weckGemeldet = false;
    if (audio) {
      const { stream, kontext, erkenner, quelle, knoten } = audio;
      audio = null;
      try { quelle.disconnect(); knoten.disconnect(); } catch { /* schon getrennt */ }
      for (const spur of stream.getTracks()) spur.stop();
      kontext.close().catch(() => {});
      try { erkenner.remove(); } catch { /* Worker schon fort */ }
    }
    melden({ typ: "zustand", zustand: "aus" });
  }

  async function starten(neu) {
    const vorher = modus;
    danach = neu === "einmal" && (vorher === "weckwort" || danach === "weckwort") ? "weckwort" : "aus";
    modus = neu;
    wartetAufAnfrage = false;
    weckGemeldet = false;
    if (!audio) melden({ typ: "zustand", zustand: "laedt" });
    try {
      await audioStarten();
    } catch (fehler) {
      modus = vorher === neu ? "aus" : vorher;
      melden({ typ: "fehler", text: String(fehler?.message || fehler || "Spracherkennung nicht verfügbar"),
        modell: fehler?.modell === true });
      if (!audio) melden({ typ: "zustand", zustand: "aus" });
      return;
    }
    if (modus !== neu) return;
    melden({ typ: "zustand", zustand: neu === "einmal" ? "hoert" : "wartet" });
    if (neu === "einmal") fristSetzen();
    else clearTimeout(frist);
  }

  host.onBefehl((befehl) => {
    if (befehl?.typ === "start" && (befehl.modus === "einmal" || befehl.modus === "weckwort")) starten(befehl.modus);
    else if (befehl?.typ === "stopp") stoppen();
  });
  melden({ typ: "bereit" });
}());
