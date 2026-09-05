"use strict";
// Der Pruefstand selbst.
//
// Er faehrt gegen echte Hoster - und genau deshalb muss seine eigene
// Verdrahtung geprueft sein. Ein leerer Bericht waere sonst nicht von einem
// kaputten Pruefstand zu unterscheiden, und man suchte den Fehler beim
// Anbieter, waehrend er im Werkzeug steckt.
//
// Gefahren wird sein `--selbsttest`: derselbe Ablauf, nur mit einer
// hineingereichten Netz-Attrappe statt des Netzes und ohne Electron. Er
// beweist nicht, dass sich ein Hoster aufloesen laesst - das kann nur das Netz.
// Er beweist, dass gelesen, abgenommen, gekuerzt und berichtet wird.

const { spawnSync } = require("child_process");
const path = require("path");

const pruefungen = [];
const pruefe = (name, bedingung, detail = "") => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

const lauf = spawnSync(process.execPath,
  [path.join(__dirname, "..", "scripts", "direktprobe.js"), "--selbsttest"],
  { encoding: "utf8" });
const ausgabe = String(lauf.stdout || "") + String(lauf.stderr || "");

pruefe("Der Selbsttest läuft ohne Electron durch",
  lauf.status === 0,
  `Status ${lauf.status}${lauf.stderr ? " · " + String(lauf.stderr).slice(0, 120) : ""}`);

/* ------------------------------------------------------ Der Bericht ist vollständig */

// Diese Zeilen sind die Abmachung: nach ihnen wird der PoC beurteilt. Fehlt
// eine, ist der Bericht nicht auswertbar - egal wie gut die Aufloesung war.
for (const feld of ["Anbieter", "Episode", "Hoster", "Hoster-URL", "Erkannter Typ",
  "Direkte Stream-URL", "Manifest-Typ", "Laufzeit lt. Manifest", "Referer nötig",
  "Cookies nötig", "Weitere Header", "Untertitel", "Im separaten Player", "Fehler"]) {
  pruefe(`Der Bericht nennt "${feld}"`, ausgabe.includes(`${feld}:`));
}

/* ------------------------------------------------------------- Die Abnahme */

pruefe("Die Quelle wird abgenommen, nicht nur gefunden",
  /Im separaten Player:\s+ja/.test(ausgabe),
  "das ist der Unterschied zwischen 'Adresse da' und 'es läuft'");
pruefe("Der Master wird als Master erkannt",
  /Manifest-Typ:\s+master/.test(ausgabe));
pruefe("Und die Laufzeit kommt aus der Stufe darunter",
  /Laufzeit lt\. Manifest:\s+23:20/.test(ausgabe),
  "beim Master steht sie nicht im Master");
pruefe("Was ohne Kekse abgewiesen wird, steht als 'ja' im Bericht",
  /Cookies nötig:\s+ja/.test(ausgabe));
pruefe("Am Ende steht eine Bilanz",
  /1\/1 Folgen mit abgenommener Quelle/.test(ausgabe)
  && /Hoster, die getragen haben: VOE/.test(ausgabe));

/* --------------------------------------------------------------- Der Schutz */

// Die Attrappe liefert eine signierte Adresse, wie die Hoster es tun. Steht der
// Schluessel im Bericht, ist der Bericht nichts, was man herumzeigen kann - und
// dafuer ist er da.
pruefe("Der Schlüssel der Quelle steht nicht im Bericht",
  !ausgabe.includes("GEHEIMESZEICHENFOLGE1234567"),
  "gekürzt wird der Wert, nicht der Name");
pruefe("Dass ein token verlangt wird, bleibt trotzdem lesbar",
  ausgabe.includes("token=<gekürzt>"));

/* ------------------------------------------------------------- Der Aufruf */

const ohneArgumente = spawnSync(process.execPath,
  [path.join(__dirname, "..", "scripts", "direktprobe.js"), "--selbsttest", "--hilfe-erzwingen"],
  { encoding: "utf8" });
pruefe("Auch ein unbekannter Schalter bringt ihn nicht zum Absturz",
  ohneArgumente.status === 0,
  `Status ${ohneArgumente.status}`);

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`
${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
