"use strict";

// Das Handy als Fernbedienung.
//
// Der dritte eigene Modus neben der YouTube-Runde und dem Geraeteabgleich, und
// aus demselben Grund eigen: er teilt sich mit der Watchparty nur die
// Verbindung. Hier gibt es keine Raeume, keine Titel und keinen Fortschritt -
// nur zwei Seiten, die einander zugeordnet sind.
//
// Die eine ist ELFIX auf dem Rechner: es meldet sich mit seinem Kopplungscode
// und wartet. Die andere ist eine Seite im Handybrowser: sie tippt denselben
// Code ein und darf ab da druecken. Eine App braucht es dafuer nicht - die
// Seite liefert dieses Relay gleich mit aus.
//
// Was hier durchgeht, ist bewusst duenn: ein paar feste Befehlswoerter in die
// eine Richtung, eine Zeile Zustand in die andere. Kein Titel, keine Adresse,
// keine Liste. Wer den Code hat, kann anhalten und weiterschalten - er
// bekommt nicht zu sehen, was jemand schaut.

// Der Code ist kurz genug zum Abtippen und lang genug, um nicht geraten zu
// werden: acht Zeichen aus zweiunddreissig sind vierzig Bit.
const CODE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
// So lange bleibt eine Kopplung ohne Lebenszeichen stehen.
const LEBENSDAUER_MS = 12 * 60 * 60 * 1000;
// Wer dreimal danebentippt, ist fuer diese Verbindung durch. Das Raten von
// vierzig Bit soll nicht daran scheitern, dass es zu lange dauert, sondern
// daran, dass es gar nicht erst geht.
const MAX_FEHLVERSUCHE = 3;
// So viele Titel gehen hoechstens an das Handy. Wer mehr offen hat, sucht sie
// besser am Rechner als auf einem Bildschirm von der Groesse einer Handflaeche.
const MAX_LISTE = 40;
// Nur diese Befehle gehen durch. Eine feste Liste, keine durchgereichte
// Zeichenkette: was die Fernbedienung kann, entscheidet ELFIX und nicht das,
// was jemand in eine Nachricht schreibt.
const BEFEHLE = [
  "umschalten", "abspielen", "pause",
  "vor", "zurueck",
  "naechste", "vorherige",
  "lauter", "leiser", "stumm",
  "vollbild"
];

// code -> { geraetId, at }
const kopplungen = new Map();

function istCode(wert) {
  return typeof wert === "string" && CODE.test(wert);
}

function text(wert, laenge) {
  return String(wert == null ? "" : wert).slice(0, laenge);
}

// Der Rechner meldet sich als steuerbar. Zurueck kommt nichts weiter - er
// wartet, bis jemand den Code eintippt.
function bereit(code, geraetId) {
  if (!istCode(code)) return false;
  kopplungen.set(code, { geraetId: text(geraetId, 64), at: Date.now() });
  return true;
}

function abmelden(code) {
  if (istCode(code)) kopplungen.delete(code);
}

function kennt(code) {
  if (!istCode(code)) return false;
  const eintrag = kopplungen.get(code);
  if (!eintrag) return false;
  eintrag.at = Date.now();
  return true;
}

function anzahl() {
  return kopplungen.size;
}

function aufraeumen() {
  const grenze = Date.now() - LEBENSDAUER_MS;
  for (const [code, eintrag] of kopplungen) {
    if (eintrag.at < grenze) kopplungen.delete(code);
  }
}

// Die Nachrichten. `senden` geht an den Absender, `anRechner` und `anHandys`
// an die jeweils andere Seite - wer das ist, weiss der Server anhand des
// Codes am Socket.
function behandeln({ nachricht, socket, senden, anRechner, anHandys }) {
  // Der Rechner macht sich steuerbar.
  if (nachricht.type === "fnbereit") {
    if (!istCode(nachricht.code)) {
      senden({ type: "fnfehler", message: "Ungueltiger Code" });
      return;
    }
    bereit(nachricht.code, nachricht.deviceId);
    socket.fernCode = nachricht.code;
    socket.fernSeite = "rechner";
    senden({ type: "fnbereit", code: nachricht.code });
    return;
  }

  // Das Handy koppelt sich an.
  if (nachricht.type === "fnhier") {
    // Falsch geraten zaehlt. Ein richtiger Code setzt den Zaehler nicht
    // zurueck - sonst waere er nach jedem Treffer wieder frei.
    if ((socket.fernFehler || 0) >= MAX_FEHLVERSUCHE) return;
    if (!kennt(nachricht.code)) {
      socket.fernFehler = (socket.fernFehler || 0) + 1;
      senden({ type: "fnfehler", message: "Der Code passt nicht" });
      return;
    }
    socket.fernCode = nachricht.code;
    socket.fernSeite = "handy";
    senden({ type: "fnda" });
    // Der Rechner soll gleich seinen Stand schicken, damit die Seite im Handy
    // nicht leer dasteht, bis sich etwas bewegt.
    anRechner({ type: "fnwach" });
    return;
  }

  if (!socket.fernCode) return;

  // Ein Druck auf einen Knopf.
  if (nachricht.type === "fnbefehl" && socket.fernSeite === "handy") {
    const befehl = text(nachricht.befehl, 20);
    if (!BEFEHLE.includes(befehl)) return;
    anRechner({ type: "fnbefehl", befehl });
    return;
  }

  // "Was kann ich denn schauen?" - das Handy fragt nach dem Weiterschauen des
  // Rechners. Weitergereicht wird nur die Frage; was darauf steht, entscheidet
  // ELFIX.
  if (nachricht.type === "fnliste" && socket.fernSeite === "handy") {
    anRechner({ type: "fnliste" });
    return;
  }

  // Und die Antwort darauf. Die Eintraege selbst schaut sich das Relay nicht
  // an - es kuerzt nur, damit eine Nachricht nicht ins Uferlose waechst.
  if (nachricht.type === "fnliste" && socket.fernSeite === "rechner") {
    const eintraege = (Array.isArray(nachricht.eintraege) ? nachricht.eintraege : [])
      .slice(0, MAX_LISTE)
      .map((eintrag) => ({
        key: text(eintrag?.key, 300),
        titel: text(eintrag?.titel, 200),
        folge: text(eintrag?.folge, 60),
        anteil: Number(eintrag?.anteil) || 0
      }))
      .filter((eintrag) => eintrag.key && eintrag.titel);
    anHandys({ type: "fnliste", eintraege });
    return;
  }

  // Einen davon oeffnen.
  if (nachricht.type === "fnoeffnen" && socket.fernSeite === "handy") {
    const key = text(nachricht.key, 300);
    if (!key) return;
    anRechner({ type: "fnoeffnen", key });
    return;
  }

  // Und was zurueckkommt: eine Zeile Zustand.
  if (nachricht.type === "fnstand" && socket.fernSeite === "rechner") {
    anHandys({
      type: "fnstand",
      titel: text(nachricht.titel, 200),
      folge: text(nachricht.folge, 60),
      laeuft: Boolean(nachricht.laeuft),
      position: Number(nachricht.position) || 0,
      dauer: Number(nachricht.dauer) || 0,
      stumm: Boolean(nachricht.stumm)
    });
  }
}

function zuruecksetzen() {
  kopplungen.clear();
}

module.exports = {
  BEFEHLE,
  MAX_LISTE,
  CODE,
  MAX_FEHLVERSUCHE,
  istCode,
  bereit,
  abmelden,
  kennt,
  anzahl,
  aufraeumen,
  behandeln,
  zuruecksetzen
};
