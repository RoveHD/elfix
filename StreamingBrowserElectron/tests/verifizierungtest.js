"use strict";
// Das Vorbereitungsfenster bei S.to - und was daneben liegt.
//
// S.to legt manchmal ein Fenster "Video wird vorbereitet..." vor den Stream,
// mit einer Cloudflare-Abfrage darin und einem Knopf "Weiter". Der Autostart
// wartete davor auf ein <video>, das erst hinter diesem Knopf entsteht, und
// gab nach seinem Zeitfenster auf.
//
// Ein Skript, das auf fremden Seiten Knoepfe drueckt, muss man scharf pruefen.
// Deshalb geht es hier weniger um den Treffer als um die Faelle daneben:
// Schliessen-Knopf, Werbe-Overlay, noch nicht bestandene Abfrage. Geprueft
// wird die echte Entscheidungsfunktion aus src/verifizierungstor.js - dieselbe,
// die per toString() in der Seite laeuft.

const path = require("path");
const { istFreigegebenesTor, torScript, WEITER_MUSTER } = require(path.join(__dirname, "..", "src", "verifizierungstor.js"));

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(Boolean(b)); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };

// Der Normalfall: sichtbares Fenster, Cloudflare darin, Abfrage bestanden,
// Knopf frei und beschriftet.
const tor = (extra) => istFreigegebenesTor({
  sichtbar: true,
  hatVerifizierung: true,
  knopfText: "Weiter",
  knopfDeaktiviert: false,
  geloest: true,
  ...extra
});

console.log("-- Der Fall, um den es geht --");
const echt = tor({});
pruefe("Das bestaetigte Vorbereitungsfenster wird geklickt", echt.klicken, echt.grund);
pruefe("Auch ohne Token-Feld, solange der Knopf frei ist",
  tor({ geloest: null }).klicken, tor({ geloest: null }).grund);
// Das ist die Ansage: nicht abwarten, bis Cloudflare fertig ist, sondern
// druecken und den Nutzer auf die Seite schicken. Kommt der Klick zu frueh,
// bleibt das Fenster stehen und der Beobachter versucht es gleich wieder.
const nochOffen = tor({ geloest: false });
pruefe("Auf die laufende Abfrage wird NICHT gewartet - es wird sofort geklickt",
  nochOffen.klicken, nochOffen.grund);
for (const wort of ["Weiter", "weiter", "WEITER", "Continue", "Fortfahren", "Proceed", "Zum Stream", "Jetzt ansehen"]) {
  if (!tor({ knopfText: wort }).klicken) pruefe(`Knopftext "${wort}" wird erkannt`, false);
}
pruefe("Die ueblichen Beschriftungen werden erkannt",
  ["Weiter", "weiter", "WEITER", "Continue", "Fortfahren", "Proceed", "Zum Stream", "Jetzt ansehen"]
    .every((w) => tor({ knopfText: w }).klicken));

console.log("\n-- Und alles, was daneben liegt --");
const ohneAbfrage = tor({ hatVerifizierung: false });
pruefe("Ohne Cloudflare-Abfrage wird nichts geklickt", !ohneAbfrage.klicken, ohneAbfrage.grund);
const unsichtbar = tor({ sichtbar: false });
pruefe("Ein unsichtbares Fenster wird nicht geklickt", !unsichtbar.klicken, unsichtbar.grund);
const gesperrt = tor({ knopfDeaktiviert: true });
pruefe("Ein gesperrter Knopf wird nicht geklickt", !gesperrt.klicken, gesperrt.grund);
const schliessen = tor({ knopfText: "Schliessen" });
pruefe("Der Schliessen-Knopf wird nicht geklickt", !schliessen.klicken, schliessen.grund);
const abbrechen = tor({ knopfText: "Abbrechen" });
pruefe("Abbrechen wird nicht geklickt", !abbrechen.klicken, abbrechen.grund);
const weitere = tor({ knopfText: "Weitere Informationen" });
pruefe("\"Weitere Informationen\" ist kein Weiter", !weitere.klicken, weitere.grund);
const kein = tor({ knopfText: "" });
pruefe("Ohne Knopf passiert nichts", !kein.klicken, kein.grund);

// Die Texte, mit denen die Fake-Gewinnspiele arbeiten - die duerfen selbst
// dann nicht durchgehen, wenn sonst alles passt.
const werbetexte = ["Jetzt gewinnen", "Herunterladen", "Download", "Jetzt spielen", "Bonus sichern", "OK", "Ja", "Zulassen", "Allow", "Anmelden"];
pruefe("Kein Werbe-Knopftext wird geklickt",
  werbetexte.every((w) => !tor({ knopfText: w }).klicken),
  werbetexte.filter((w) => tor({ knopfText: w }).klicken).join(", ") || "keiner");

console.log("\n-- Das Skript fuer die Seite --");
const skript = torScript();
pruefe("Das Skript sucht die Cloudflare-Abfrage als Anker",
  skript.includes("challenges.cloudflare.com") && skript.includes("cf-turnstile"));
pruefe("Es bringt die geprueften Regeln mit, statt sie nachzubauen",
  skript.includes("istFreigegebenesTor") && skript.includes(WEITER_MUSTER.source));
pruefe("Es begrenzt sich selbst auf wenige Versuche",
  /klicks >= MAX/.test(skript) && /letzterKlick < 1200/.test(skript) && /const MAX = 4;/.test(skript));
// Der Grund, warum es ueberhaupt "sofort" heissen darf: das Skript haengt sich
// ein und wartet nicht darauf, dass jemand nachfragt.
pruefe("Es haengt sich als Beobachter ein, statt auf den naechsten Takt zu warten",
  skript.includes("MutationObserver") && skript.includes("attributeFilter")
  && /"disabled"/.test(skript) && skript.includes("beobachter.observe"));
pruefe("Es meldet sich von selbst ueber die Konsole",
  skript.includes("console.log(MELDUNG"));
pruefe("Es haengt sich nur einmal je Dokument ein",
  /if \(window\[KENN\]\) return window\[KENN\]\.pruefen\(\);/.test(skript));
pruefe("Es ist gueltiges Javascript", (() => {
  try { new Function(`return ${skript};`); return true; } catch (fehler) { return String(fehler.message); }
})() === true);
pruefe("Ohne Abfrage im Dokument meldet es nichts zurueck",
  /if \(!abfrage\) return "";/.test(skript));

const gut = pruefungen.filter(Boolean).length;
console.log(`\n${gut}/${pruefungen.length} bestanden`);
process.exit(gut === pruefungen.length ? 0 : 1);
