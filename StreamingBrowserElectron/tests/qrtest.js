"use strict";
// Der QR-Code.
//
// Das Heikle daran: ein falscher QR-Code sieht vollkommen richtig aus. Ein
// vertauschtes Format, eine Maske daneben, ein Bit verrutscht - das Bild bleibt
// ein huebsches Quadrat aus schwarzen Kaestchen, und kein Handy liest es. Genau
// das ist beim Bauen passiert, und aufgefallen ist es erst, als ein fremder
// Decoder nichts fand.
//
// Deshalb steht hier zweierlei:
//
// Was sich aus der Norm nachrechnen laesst, wird nachgerechnet - allen voran
// die Fehlerkorrektur, fuer die es eine bekannte Musterloesung gibt.
//
// Und fuer das Ganze ein Fingerabdruck. Die drei Codes unten wurden einmal
// gemalt und mit einem fremden Decoder (OpenCV) zurueckgelesen; seither steht
// ihr Muster fest. Aendert sich daran etwas, faellt diese Suite um - und dann
// gehoert das Ergebnis wieder gegen einen echten Leser geprueft und nicht bloss
// angesehen.

const crypto = require("crypto");
const qr = require("../src/qr");

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}

// --- Die Fehlerkorrektur ------------------------------------------------------

{
  // Die Musterloesung der Norm: Fassung 1, Fehlerkorrektur M, Inhalt "01234567".
  const daten = [16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17];
  const erwartet = [165, 36, 212, 193, 237, 54, 199, 135, 44, 85];
  pruefe("Reed-Solomon trifft die Musterloesung der Norm",
    JSON.stringify(qr.fehlerkorrektur(daten, 10)) === JSON.stringify(erwartet),
    qr.fehlerkorrektur(daten, 10).join(","));
  pruefe("Andere Laengen liefern andere Laengen",
    qr.fehlerkorrektur(daten, 26).length === 26);
}

// --- Wie gross wird der Code? -------------------------------------------------

{
  const grenzen = [[14, 1], [15, 2], [26, 2], [27, 3], [42, 3], [43, 4], [62, 4], [63, 5],
    [84, 5], [85, 6], [106, 6], [107, 7], [122, 7], [123, 8], [152, 8], [153, 9],
    [180, 9], [181, 10], [213, 10]];
  const falsch = grenzen.filter(([laenge, fassung]) => qr.kleinsteFassung(laenge) !== fassung);
  pruefe("Jede Fassung faengt genau da an, wo die vorige aufhoert",
    falsch.length === 0,
    falsch.map(([l, f]) => `${l}->${f}`).join(",") || "neunzehn Grenzen geprueft");
  pruefe("Laenger als 213 Zeichen geht nicht",
    qr.kleinsteFassung(214) === 0 && qr.matrix("x".repeat(214)) === null,
    "lieber gar kein Code als einer, der abgeschnitten ist");
  pruefe("Und die Kantenlaenge folgt der Fassung",
    qr.matrix("x").length === 21 && qr.matrix("x".repeat(200)).length === 57,
    "4 mal Fassung plus 17");
}

// --- Das Muster ---------------------------------------------------------------

{
  const feld = qr.matrix("https://watchparty.example.com/fern/?code=ABCD1234");
  const n = feld.length;

  // Ein Suchmuster ist ein 7x7-Ring mit einem 3x3-Kern. Ohne die drei findet
  // kein Leser den Code ueberhaupt.
  const suchmusterPasst = (zeile, spalte) => {
    for (let y = 0; y < 7; y += 1) {
      for (let x = 0; x < 7; x += 1) {
        const rand = y === 0 || y === 6 || x === 0 || x === 6;
        const kern = y >= 2 && y <= 4 && x >= 2 && x <= 4;
        if (feld[zeile + y][spalte + x] !== (rand || kern ? 1 : 0)) return false;
      }
    }
    return true;
  };
  pruefe("Die drei Suchmuster stehen in ihren Ecken",
    suchmusterPasst(0, 0) && suchmusterPasst(0, n - 7) && suchmusterPasst(n - 7, 0));
  pruefe("Die Taktreihen wechseln sich ab",
    feld[6].slice(8, n - 8).every((wert, i) => wert === (i % 2 === 0 ? 1 : 0)),
    "an ihnen misst der Leser die Kaestchengroesse");
  pruefe("Das dunkle Modul sitzt, wo es hingehoert",
    feld[n - 8][8] === 1);
  pruefe("Es gibt nur Nullen und Einsen",
    feld.every((zeile) => zeile.every((wert) => wert === 0 || wert === 1)),
    "ein leeres Feld waere ein Loch im Code");
}

// --- Der Fingerabdruck --------------------------------------------------------

{
  const abdruecke = [
    ["https://watchparty.example.com/fern/?code=ABCD1234", 33, "335aa40bc8b5d4d8"],
    ["kurz", 21, "6eb59378c44c9839"],
    ["Grüße mit Umlauten und ß — auch das muss durch", 33, "fb8a24261b2e0a3a"]
  ];
  for (const [text, groesse, erwartet] of abdruecke) {
    const feld = qr.matrix(text);
    const finger = crypto.createHash("sha256")
      .update(feld.map((zeile) => zeile.join("")).join("|"))
      .digest("hex")
      .slice(0, 16);
    pruefe(`Das Muster fuer „${text.slice(0, 28)}…“ ist unveraendert`,
      feld.length === groesse && finger === erwartet,
      finger === erwartet ? "" : `${finger} statt ${erwartet} - gegen einen echten Leser pruefen!`);
  }
  pruefe("Derselbe Text ergibt denselben Code",
    JSON.stringify(qr.matrix("gleich")) === JSON.stringify(qr.matrix("gleich")));
  pruefe("Ein anderer Text einen anderen",
    JSON.stringify(qr.matrix("gleich")) !== JSON.stringify(qr.matrix("gleich ")));
}

// --- Als Bild -----------------------------------------------------------------

{
  const svg = qr.alsSvg("https://x.example/fern/?code=ABCD1234");
  pruefe("Das SVG traegt einen hellen Grund und einen Pfad",
    svg.includes("<rect") && svg.includes("<path") && svg.startsWith("<svg"),
    "der helle Rand gehoert dazu - ohne ihn findet eine Kamera den Code nicht");
  const kasten = /viewBox="0 0 (\d+) \1"/.exec(svg);
  const feld = qr.matrix("https://x.example/fern/?code=ABCD1234");
  pruefe("Er ist um den Rand groesser als das Muster",
    kasten && Number(kasten[1]) === feld.length + 8,
    kasten ? kasten[1] : "kein viewBox");
  pruefe("Die Farben lassen sich setzen",
    qr.alsSvg("x", { hell: "#fff", dunkel: "#0b0f16" }).includes('fill="#0b0f16"'));
  pruefe("Zu langer Text ergibt kein Bild",
    qr.alsSvg("x".repeat(300)) === "",
    "lieber nichts anzeigen als etwas Unlesbares");
}

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
