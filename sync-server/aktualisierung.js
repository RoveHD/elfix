"use strict";

/*
 * Das Relay haelt sich selbst auf dem neuesten Stand.
 *
 * --- Warum ---------------------------------------------------------------------
 *
 * Ein Relay laeuft auf einer Maschine, an die niemand mehr denkt: ein
 * Raspberry im Regal, ein kleiner Server beim Anbieter. Genau deshalb bleibt es
 * stehen, waehrend die Geraete weiterziehen - und wenn App und Relay sich nicht
 * mehr verstehen, sucht man den Fehler ueberall, nur nicht dort.
 *
 * --- Wie ------------------------------------------------------------------------
 *
 * Es fragt die GitHub-Releases desselben Projekts, aus dem auch die App kommt.
 * Steht dort eine neuere Fassung, holt es die zu seiner Plattform passende
 * Datei, legt sie daneben und tauscht.
 *
 * --- Was hier nicht passiert ----------------------------------------------------
 *
 * Kein Neustart des Dienstes von innen heraus - jedenfalls nicht als Regel.
 * Unter systemd genuegt es, sich zu beenden: `Restart=always` bringt den Dienst
 * mit der neuen Datei zurueck. Wer das Relay von Hand gestartet hat, bekommt
 * die neue Fassung beim naechsten Start; ihm den Prozess unter den Fuessen
 * wegzuziehen waere eine Freiheit, die sich ein Programm nicht nimmt.
 *
 * Und kein Downgrade. Eine kleinere Fassung als die laufende wird nie geholt -
 * sonst genuegte ein zurueckgezogenes Release, um jedes Relay im Netz
 * zurueckzudrehen.
 *
 * --- Warum die Rechnerei hier getrennt steht -------------------------------------
 *
 * Fassungsvergleich und Dateiwahl sind reine Funktionen und lassen sich ohne
 * Netz pruefen. Was Netz und Platte anfasst, steht darunter und ist duenn.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");

const PROJEKT = "RoveHD/elfix";
const RELEASES = `https://api.github.com/repos/${PROJEKT}/releases/latest`;
// Einmal am Tag genuegt. ELFIX bekommt mehrere Fassungen in der Woche, aber
// keine, auf die ein Relay in Minuten reagieren muesste.
const ABSTAND_MS = 24 * 60 * 60 * 1000;
// Beim Start nicht sofort: erst soll das Relay erreichbar sein.
const ERSTER_BLICK_MS = 5 * 60 * 1000;
const NETZ_TIMEOUT_MS = 20_000;
// Eine Binaerdatei mit Node darin ist rund neunzig Megabyte. Alles jenseits
// davon ist nicht das, was hier erwartet wird.
const HOECHSTENS_BYTES = 200 * 1024 * 1024;

/* --------------------------------------------------------------- Die Regeln */

/**
 * Eine Fassung in Zahlen. "v1.61.0" und "1.61.0" sind dasselbe.
 *
 * @returns {number[]|null} null, wenn das keine Fassung ist
 */
function fassungLesen(wert) {
  const treffer = String(wert || "").trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!treffer) return null;
  return [Number(treffer[1]), Number(treffer[2]), Number(treffer[3])];
}

/**
 * Ist die eine Fassung neuer als die andere?
 *
 * <p>Ausdruecklich strikt groesser. Gleichstand ist kein Anlass, und eine
 * kleinere Fassung schon gar nicht: sonst genuegte ein zurueckgezogenes
 * Release, um jedes Relay im Netz zurueckzudrehen.
 */
function istNeuer(dort, hier) {
  const a = fassungLesen(dort);
  const b = fassungLesen(hier);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

/** Wie diese Plattform in einem Dateinamen heisst. */
function plattformName(plattform = os.platform(), bogen = os.arch()) {
  const art = plattform === "win32" ? "win" : plattform === "darwin" ? "mac" : "linux";
  return `${art}-${bogen === "arm64" ? "arm64" : "x64"}`;
}

/**
 * Die Datei, die zu dieser Maschine gehoert.
 *
 * <p>Gesucht wird nach dem Plattformnamen im Dateinamen und, unter Windows,
 * nach der Endung. Ein Paket (.deb) ist ausdruecklich nicht gemeint: wer
 * ueber die Paketverwaltung installiert hat, soll auch ueber sie
 * aktualisieren - eine Binaerdatei, die sich unter einem verwalteten Pfad
 * selbst austauscht, waere ein Paket, das seiner Verwaltung widerspricht.
 */
function passendeDatei(dateien, plattform = os.platform(), bogen = os.arch()) {
  const marke = plattformName(plattform, bogen);
  const liste = Array.isArray(dateien) ? dateien : [];
  return liste.find((datei) => {
    const name = String(datei?.name || "");
    if (!name.startsWith("ELFIX-Relay-")) return false;
    if (name.endsWith(".deb") || name.endsWith(".rpm")) return false;
    if (!name.includes(marke)) return false;
    return plattform === "win32" ? name.endsWith(".exe") : !name.endsWith(".exe");
  }) || null;
}

/**
 * Ob sich diese Datei ueberhaupt austauschen laesst.
 *
 * <p>Unter einem von der Paketverwaltung betreuten Pfad nicht: dort gehoert
 * die Datei dem Paket, und ein Selbsttausch machte aus einem verwalteten
 * System ein halb verwaltetes. Wer das .deb installiert hat, bekommt seine
 * Aktualisierung von apt.
 */
function darfTauschen(pfad, plattform = os.platform()) {
  if (plattform === "win32") return true;
  const voll = String(pfad || "");
  return !(voll.startsWith("/usr/") || voll.startsWith("/bin/") || voll.startsWith("/sbin/"));
}

/* ------------------------------------------------------------ Netz und Platte */

function holen(adresse, alsText = true) {
  return new Promise((fertig, schiefgegangen) => {
    const anfrage = https.get(adresse, {
      timeout: NETZ_TIMEOUT_MS,
      headers: {
        // GitHub verlangt einen Namen; ohne ihn kommt 403.
        "User-Agent": "ELFIX-Relay",
        Accept: alsText ? "application/vnd.github+json" : "application/octet-stream"
      }
    }, (antwort) => {
      if (antwort.statusCode === 301 || antwort.statusCode === 302) {
        antwort.resume();
        holen(antwort.headers.location, alsText).then(fertig, schiefgegangen);
        return;
      }
      if (antwort.statusCode !== 200) {
        antwort.resume();
        schiefgegangen(new Error(`HTTP ${antwort.statusCode}`));
        return;
      }
      const stuecke = [];
      let umfang = 0;
      antwort.on("data", (stueck) => {
        umfang += stueck.length;
        if (umfang > HOECHSTENS_BYTES) {
          anfrage.destroy();
          schiefgegangen(new Error("Antwort zu gross"));
          return;
        }
        stuecke.push(stueck);
      });
      antwort.on("end", () => {
        const alles = Buffer.concat(stuecke);
        fertig(alsText ? alles.toString("utf8") : alles);
      });
    });
    anfrage.on("timeout", () => {
      anfrage.destroy();
      schiefgegangen(new Error("Zeit abgelaufen"));
    });
    anfrage.on("error", schiefgegangen);
  });
}

/**
 * Einmal nachsehen und, wenn etwas da ist, tauschen.
 *
 * @returns {Promise<string>} was geschehen ist - fuer das Protokoll
 */
async function nachsehen({ fassung, pfad, jetztBeenden }) {
  const roh = await holen(RELEASES, true);
  const release = JSON.parse(roh);
  const dort = String(release?.tag_name || "");
  if (!istNeuer(dort, fassung)) return `aktuell (hier ${fassung}, dort ${dort || "nichts"})`;

  const datei = passendeDatei(release?.assets);
  if (!datei) return `${dort} liegt vor, aber keine Datei fuer ${plattformName()}`;
  if (!darfTauschen(pfad)) {
    return `${dort} liegt vor - unter ${pfad} taeuscht sich das Relay nicht selbst aus,`
      + " das gehoert der Paketverwaltung";
  }

  const inhalt = await holen(datei.browser_download_url, false);
  if (!inhalt || inhalt.length < 1024 * 1024) throw new Error("Die geladene Datei ist zu klein");

  // Erst daneben schreiben, dann tauschen. Ein abgebrochener Ladevorgang
  // hinterlaesst sonst eine halbe Datei an der Stelle, an der gleich der
  // Dienst starten soll.
  const neben = `${pfad}.neu`;
  fs.writeFileSync(neben, inhalt);
  if (os.platform() !== "win32") fs.chmodSync(neben, 0o755);

  // Die laufende Datei umbenennen statt zu loeschen: unter Windows laesst sich
  // eine laufende Binaerdatei umbenennen, aber nicht ueberschreiben. Unter
  // Linux geht beides - der Weg ist derselbe, damit es nur einen gibt.
  const alt = `${pfad}.alt`;
  try {
    fs.rmSync(alt, { force: true });
  } catch {
    // Eine alte Sicherung, die nicht weggeht, ist kein Grund aufzuhoeren.
  }
  fs.renameSync(pfad, alt);
  fs.renameSync(neben, pfad);

  if (typeof jetztBeenden === "function") jetztBeenden();
  return `${dort} eingesetzt (vorher ${fassung})`;
}

/**
 * Den Takt stellen.
 *
 * <p>Alles hier ist unkritisch: kein Netz, kein GitHub, eine kaputte Antwort -
 * das Relay laeuft weiter und sieht morgen wieder nach. Ein Relay, das wegen
 * einer Aktualisierung nicht mehr vermittelt, waere die schlechtere Fassung
 * seiner selbst.
 */
function starten({ fassung, pfad, protokoll = console.log } = {}) {
  const eigene = fassungLesen(fassung);
  if (!eigene) {
    protokoll("[RELAY UPDATE] keine Fassung bekannt - es wird nicht nachgesehen");
    return () => {};
  }
  if (process.env.ELFIX_RELAY_KEIN_UPDATE === "1") {
    protokoll("[RELAY UPDATE] abgeschaltet (ELFIX_RELAY_KEIN_UPDATE=1)");
    return () => {};
  }

  const lauf = async () => {
    try {
      const wort = await nachsehen({
        fassung,
        pfad,
        jetztBeenden: () => {
          // Unter systemd bringt `Restart=always` den Dienst mit der neuen
          // Datei zurueck. Wer von Hand gestartet hat, bekommt sie beim
          // naechsten Start - deshalb wird nur beendet, wo ein Aufpasser da
          // ist.
          if (!process.env.INVOCATION_ID && process.env.ELFIX_RELAY_NEUSTART !== "1") {
            protokoll("[RELAY UPDATE] neue Fassung liegt bereit - sie gilt beim naechsten Start");
            return;
          }
          protokoll("[RELAY UPDATE] beendet sich, damit die neue Fassung startet");
          setTimeout(() => process.exit(0), 200);
        }
      });
      protokoll(`[RELAY UPDATE] ${wort}`);
    } catch (fehler) {
      protokoll(`[RELAY UPDATE] nicht nachgesehen: ${fehler?.message || fehler}`);
    }
  };

  const ersterBlick = setTimeout(lauf, ERSTER_BLICK_MS);
  const takt = setInterval(lauf, ABSTAND_MS);
  // Der Takt darf den Prozess nicht am Leben halten.
  if (typeof ersterBlick.unref === "function") ersterBlick.unref();
  if (typeof takt.unref === "function") takt.unref();
  return () => {
    clearTimeout(ersterBlick);
    clearInterval(takt);
  };
}

module.exports = { fassungLesen, istNeuer, plattformName, passendeDatei, darfTauschen, starten };
