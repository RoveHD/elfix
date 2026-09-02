"use strict";

/*
 * Die Statusseite nach der Installation von selbst zeigen.
 *
 * --- Warum ---------------------------------------------------------------------
 *
 * Eine Seite, die es gibt, aber niemand kennt, ist keine. Wer das Relay gerade
 * installiert hat, hat unter Windows ein Fenster mit Protokollzeilen vor sich
 * und unter Linux gar nichts - und die Frage, auf die es ankommt, ist "laeuft
 * es?". Beim ersten Start beantwortet das Relay sie ungefragt: es macht die
 * Statusseite im Browser auf.
 *
 * --- Und warum nur beim ersten Mal ----------------------------------------------
 *
 * Weil ein Programm, das bei jedem Start ein Fenster aufreisst, laestig ist.
 * Wer das Relay in den Autostart legt, bekaeme bei jeder Anmeldung einen
 * Browser - das ist die Sorte Zudringlichkeit, wegen der man solche Programme
 * wieder deinstalliert. Danach steht die Adresse nur noch in der Startzeile,
 * und wer sie doch will, setzt ELFIX_RELAY_SEITE=1.
 *
 * --- Wo ausdruecklich nichts aufgeht ---------------------------------------------
 *
 * Unter systemd. Dort gibt es keinen Bildschirm, keinen Benutzer und keinen
 * Browser - der Dienst laeuft unter einem eigenen Konto ohne Sitzung. Aus
 * demselben Grund unter Linux nur mit einer laufenden grafischen Sitzung: auf
 * einem Server im Rechenzentrum waere `xdg-open` ein Aufruf ins Leere.
 *
 * Und nie aus dem Quelltext heraus. Wer `node server.js` tippt, hat ein
 * Repository, kennt die Adresse und faende einen Browser, der sich beim
 * Entwickeln oder in den Pruefungen aufmacht, zu Recht unverschaemt.
 *
 * --- Warum die Entscheidung hier getrennt steht ----------------------------------
 *
 * Sie ist eine reine Funktion und laesst sich ohne Bildschirm pruefen. Was
 * einen Prozess startet, steht darunter und ist duenn.
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// Der Vermerk, dass die Seite schon einmal von selbst aufgegangen ist. Er liegt
// bei den Raeumen: derselbe Ordner, dieselbe Lebensdauer wie die Installation.
const MARKE = "statusseite-gezeigt";

/* --------------------------------------------------------------- Die Regeln */

/**
 * Ob die Seite jetzt aufgehen darf.
 *
 * @param {object} lage
 * @param {boolean} lage.gepackt   die eigenstaendige Datei, nicht der Quelltext
 * @param {string}  lage.plattform process.platform
 * @param {object}  lage.umgebung  process.env
 * @param {boolean} lage.ersterStart  noch keine Marke da
 */
function darfZeigen({ gepackt, plattform, umgebung = {}, ersterStart } = {}) {
  const wunsch = String(umgebung.ELFIX_RELAY_SEITE || "");
  // Ein ausdrueckliches Nein gilt immer und ueberall.
  if (wunsch === "0") return false;
  // Unter systemd nie - auch nicht auf Wunsch. Dort ist kein Browser, den man
  // aufmachen koennte, und ein Fehlschlag ins Journal hilft niemandem.
  if (umgebung.INVOCATION_ID) return false;
  if (!gepackt) return false;
  // Unter Linux nur mit grafischer Sitzung. Ohne DISPLAY oder Wayland ist
  // xdg-open ein Aufruf ins Leere.
  if (plattform !== "win32" && plattform !== "darwin"
    && !umgebung.DISPLAY && !umgebung.WAYLAND_DISPLAY) return false;
  // Ein ausdrueckliches Ja gilt bei jedem Start.
  if (wunsch === "1") return true;
  return Boolean(ersterStart);
}

/**
 * Ob dies der erste Start ist - und der Vermerk gleich mit.
 *
 * <p>Geschrieben wird sofort und nicht erst nach dem Oeffnen: geht der Browser
 * nicht auf, soll es beim naechsten Start trotzdem keinen zweiten Versuch
 * geben. Ein Rechner ohne Browser bekaeme sonst bei jedem Start denselben
 * vergeblichen Aufruf.
 *
 * <p>Laesst sich die Marke nicht schreiben, gilt der Start als *nicht* der
 * erste. Lieber einmal zu wenig aufgemacht als bei jedem Start.
 */
function ersterStart(ordner) {
  const marke = path.join(ordner, MARKE);
  try {
    if (fs.existsSync(marke)) return false;
    fs.writeFileSync(marke, `${new Date().toISOString()}\n`);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------- Das Oeffnen */

/** Womit die Plattform eine Adresse aufmacht. */
function befehl(plattform) {
  if (plattform === "win32") return { datei: "cmd", args: ["/c", "start", ""] };
  if (plattform === "darwin") return { datei: "open", args: [] };
  return { datei: "xdg-open", args: [] };
}

/**
 * Die Seite aufmachen. Fehler bleiben hier.
 *
 * <p>Kein Browser, kein Recht, kein Fenster - das darf ein Relay nicht
 * aufhalten. Es vermittelt Watchpartys; die Seite ist eine Bequemlichkeit.
 */
function oeffnen(adresse, plattform = process.platform) {
  const { datei, args } = befehl(plattform);
  try {
    const kind = spawn(datei, [...args, adresse], { detached: true, stdio: "ignore" });
    // Sonst haengt das Relay am Browser: der Prozess bliebe als Kind stehen,
    // und beim Beenden des Relays wuerde er mit abgeraeumt.
    kind.on("error", () => {});
    kind.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Beides zusammen: pruefen und, wenn es passt, aufmachen.
 *
 * @returns {boolean} ob die Seite aufgemacht wurde
 */
function vielleichtZeigen({ gepackt, ordner, port, protokoll = console.log } = {}) {
  const plattform = process.platform;
  // Die Marke wird nur gesetzt, wenn es ueberhaupt in Frage kommt - sonst
  // waere der erste Start auf einem Server schon "verbraucht", und beim
  // spaeteren Start am Bildschirm ginge nichts mehr auf.
  const vorpruefung = darfZeigen({ gepackt, plattform, umgebung: process.env, ersterStart: true });
  if (!vorpruefung) return false;
  if (!darfZeigen({ gepackt, plattform, umgebung: process.env, ersterStart: ersterStart(ordner) })) {
    return false;
  }
  const adresse = `http://localhost:${port}/status`;
  protokoll(`Erster Start - die Statusseite geht im Browser auf: ${adresse}`);
  return oeffnen(adresse, plattform);
}

module.exports = { darfZeigen, ersterStart, befehl, oeffnen, vielleichtZeigen, MARKE };
