"use strict";

// Was aus gesprochenem Text eine Suchanfrage macht - am Desktop und, als
// Zwilling in SprachSuche.java, auf Android.
//
// Die Spracherkennung liefert Woerter, wie sie gehoert wurden: klein, ohne
// Satzzeichen, und "Elfix" kennt sie nicht. Das Weckwort wird deshalb an den
// Schreibweisen erkannt, die eine deutsche Erkennung daraus macht ("elf fix",
// "elf ix", "helfix" ...). Damit ein Satz im Film nicht staendig die Suche
// oeffnet, braucht es davor eine Anrede ("hey", "hallo", "okay") - oder es
// steht ganz am Anfang des Gesagten.
(function sprachsucheTextUmd(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ELFIX_SPRACHSUCHE_TEXT = api;
}(globalThis, function createSprachsucheText() {
  const NAME = "(?:elf\\s*fix(?:e|es)?|elf\\s*ix|elf\\s*vix|elf\\s*ficks|elf\\s*fisch|elfi[sx]?|helf\\s*fix|helf\\s*ix|hell\\s*fix|el\\s*fix)";
  const ANREDE = "(?:hey|hei|hej|hay|he|hi|ey|hallo|okay|ok|o\\s*k)";
  const MIT_ANREDE = new RegExp(`(?:^|\\s)${ANREDE}\\s+${NAME}(?=\\s|$)`, "u");
  const AM_ANFANG = new RegExp(`^${NAME}(?=\\s|$)`, "u");

  function normal(text) {
    return String(text || "").toLocaleLowerCase("de")
      .replace(/[.,!?;:"„“”'’]+/g, " ")
      .replace(/\s+/g, " ").trim();
  }

  /**
   * Steht das Weckwort im Gesagten? `rest` ist, was danach kam - bei
   * "hey elfix avatar" also gleich die Suche.
   */
  function weckwort(text) {
    const satz = normal(text);
    const treffer = MIT_ANREDE.exec(satz) || AM_ANFANG.exec(satz);
    if (!treffer) return { erkannt: false, rest: "" };
    return { erkannt: true, rest: bereinigen(satz.slice(treffer.index + treffer[0].length)) };
  }

  // Was vor dem Titel steht, wenn man mit einer App spricht.
  const VORNE = [
    /^(?:bitte\s+)?(?:such(?:e)?|finde?|zeig(?:e)?|oeffne|öffne|spiel(?:e)?|starte?|schau(?:e)?|guck(?:e)?)(?:\s+(?:mal|bitte|mir|uns))*(?:\s+(?:nach|die|den|das|der|serie|film|anime))*\s+/u,
    /^ich\s+(?:will|möchte|moechte|würde\s+gern|wuerde\s+gern)(?:\s+(?:gern|gerne))?\s+/u,
    /^(?:die\s+)?(?:serie|film|anime)\s+/u
  ];
  const HINTEN = /\s+(?:suchen|anschauen|schauen|sehen|gucken|abspielen|spielen|anzeigen|starten|bitte|finden|ab)$/u;

  /** Aus dem Gesagten die Anfrage: Weckwort und Befehlswoerter weg. */
  function bereinigen(text) {
    let satz = normal(text);
    const weck = MIT_ANREDE.exec(satz) || AM_ANFANG.exec(satz);
    if (weck && weck.index === 0) satz = satz.slice(weck[0].length).trim();
    for (let runde = 0; runde < 3; runde += 1) {
      const vorher = satz;
      for (const muster of VORNE) satz = satz.replace(muster, "");
      satz = satz.replace(HINTEN, "").trim();
      if (satz === vorher) break;
    }
    return satz;
  }

  return { weckwort, bereinigen, normal };
}));
