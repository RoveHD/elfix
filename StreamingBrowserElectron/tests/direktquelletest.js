"use strict";
// Was aus dem Quelltext einer Hosterseite herauskommt - und was nicht.
//
// Geprueft wird das Lesen, nicht das Holen: `direktquelle.js` bekommt Text und
// liefert eine Adresse. Genau deshalb laesst es sich hier ohne Netz und ohne
// Hoster messen.
//
// Zwei Sorten Pruefungen stehen hier, und die Unterscheidung ist wichtig:
//
//   1. Die *Kette* von VOE wird vorwaerts und rueckwaerts gefahren. Der Test
//      verpackt ein Objekt nach derselben Vorschrift, nach der das Modul es
//      auspackt, und vergleicht. Das beweist nicht, dass VOE es genauso macht -
//      das kann nur eine lebende Seite -, aber es beweist, dass die sechs
//      Schritte zueinander passen und keiner davon still danebengreift.
//      Stimmt die Vorschrift eines Tages nicht mehr, faellt hier nichts durch;
//      dafuer sorgt Punkt 2.
//   2. Jeder *Fehlschlag* muss ein sauberer sein. Buchstabensalat, eine halbe
//      Seite, ein Block ohne Adresse: nichts davon darf eine Quelle ergeben und
//      nichts davon darf werfen. Ein falscher Treffer waere schlimmer als
//      keiner - er fuehrt zu einem schwarzen Bild statt zum Rahmen des Hosters.

const {
  aufloesen, besteQuelle, weiterleitung, voeEntschluesseln,
  adresseAusWert, typBestimmen, hoeheBestimmen, VOE_MUELL, VOE_VERSATZ
} = require("../src/direktquelle");

const pruefungen = [];
const pruefe = (name, bedingung, detail = "") => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

/* ------------------------------------------------- Die Kette, rueckwaerts */

const drehen = (text) => String(text).replace(/[a-zA-Z]/g, (z) => {
  const basis = z <= "Z" ? 65 : 97;
  return String.fromCharCode(((z.charCodeAt(0) - basis + 13) % 26) + basis);
});

/**
 * Ein Block, wie VOE ihn hinlegen wuerde.
 *
 * Die Umkehrung der sechs Schritte, in umgekehrter Reihenfolge. `muell` streut
 * die Fuellzeichen ein - an einer Stelle, an der sie nicht mit der Auffuellung
 * am Ende kollidieren, denn die gehoert zu Base64 und nicht zum Muell.
 */
function verpacken(werte, mitMuell) {
  const eins = Buffer.from(JSON.stringify(werte), "utf8").toString("base64");
  const zwei = eins.split("").reverse().join("");
  let drei = "";
  for (let i = 0; i < zwei.length; i += 1) drei += String.fromCharCode(zwei.charCodeAt(i) + VOE_VERSATZ);
  const vier = Buffer.from(drei, "utf8").toString("base64");
  if (!mitMuell) return drehen(vier);
  // Zwischen die Zeichen gestreut, nicht angehaengt: haengte man sie an, wuerde
  // die Auffuellung "=" nach hinten rutschen und die Pruefung waere zu leicht.
  let fuenf = "";
  for (let i = 0; i < vier.length; i += 1) {
    fuenf += vier[i];
    if (i % 7 === 3) fuenf += VOE_MUELL[i % VOE_MUELL.length];
  }
  return drehen(fuenf);
}

const beispiel = {
  source: "https://delivery.example/hls/abc/index.m3u8",
  direct_access_url: "https://delivery.example/dl/abc_1080.mp4",
  file_code: "abc123",
  video_height: 1080
};

const schlicht = voeEntschluesseln(verpacken(beispiel, false));
pruefe("Der verpackte Block kommt unveraendert zurueck",
  schlicht && schlicht.source === beispiel.source && schlicht.video_height === 1080,
  schlicht ? schlicht.source : "null");

const mitMuell = voeEntschluesseln(verpacken(beispiel, true));
pruefe("Die Fuellzeichen stoeren die Kette nicht",
  mitMuell && mitMuell.source === beispiel.source,
  mitMuell ? mitMuell.source : "null");

pruefe("Buchstabensalat ergibt kein Objekt",
  voeEntschluesseln("Y".repeat(120)) === null);
pruefe("Ein zu kurzer Block wird gar nicht erst angefasst",
  voeEntschluesseln("abc") === null);
pruefe("Base64 ohne JSON dahinter ergibt kein Objekt",
  voeEntschluesseln(drehen(Buffer.from("kein json, nur text", "utf8").toString("base64"))) === null);

/* --------------------------------------------------------- Die ganze Seite */

const voeSeite = `<!doctype html><html><head><title>VOE</title>
<script type="application/json">{"consent":"ja","laufzeit":12}</script>
<script type="application/json">["${verpacken(beispiel, true)}"]</script>
</head><body><div id="player"></div></body></html>`;

const ausVoe = aufloesen(voeSeite, "https://irgendein.hoster.example/e/abc123");
pruefe("Die Seite von VOE gibt eine Quelle her",
  ausVoe.quelle && ausVoe.quelle.adresse === beispiel.source,
  ausVoe.quelle ? ausVoe.quelle.adresse : ausVoe.grund);
pruefe("Genommen wird die Playlist, nicht die Datei",
  ausVoe.quelle && ausVoe.quelle.typ === "hls",
  ausVoe.quelle ? ausVoe.quelle.typ : "-");
pruefe("Die Datei bleibt als zweite Moeglichkeit stehen",
  ausVoe.quellen.some((q) => q.typ === "datei" && /1080\.mp4$/.test(q.adresse)),
  String(ausVoe.quellen.length));
pruefe("Der kurze JSON-Block der Seite fuehrt nicht in die Irre",
  ausVoe.quelle && ausVoe.quelle.herkunft === "voe-block",
  ausVoe.quelle ? ausVoe.quelle.herkunft : "-");

/* ------------------------------------------------------- Die Weiterleitung */

const zeigerSeite = `<html><head><script>window.location.href = "https://neuer.hoster.example/e/abc123";</script></head><body></body></html>`;
const ausZeiger = aufloesen(zeigerSeite, "https://alter.hoster.example/e/abc123");
pruefe("Eine Seite, die nur weiterzeigt, wird als solche gemeldet",
  ausZeiger.weiter === "https://neuer.hoster.example/e/abc123",
  ausZeiger.weiter || ausZeiger.grund);
pruefe("Vor der Weiterleitung wird keine Quelle behauptet",
  ausZeiger.quelle === null);
pruefe("Der Zeiger auf sich selbst ist keine Weiterleitung",
  weiterleitung(`<script>window.location.href = "https://gleich.example/e/1";</script>`,
    "https://gleich.example/e/1") === "");

/* ------------------------------------------------------- Die Quellenliste */

const jwSeite = `<html><body><script>
jwplayer("player").setup({ sources: [
  { file: "https://cdn.example/v/480.mp4", label: "480p" },
  { file: "https://cdn.example/v/1080.mp4", label: "1080p" },
  { file: "https://cdn.example/v/720.mp4", label: "720p" }
], image: "https://cdn.example/v/vorschau.jpg" });
</script></body></html>`;
const ausJw = aufloesen(jwSeite, "https://cdn.example/e/1");
pruefe("Aus einer Stufenliste wird die hoechste Stufe gewaehlt",
  ausJw.quelle && ausJw.quelle.hoehe === 1080,
  ausJw.quelle ? `${ausJw.quelle.hoehe}` : ausJw.grund);
pruefe("Das Vorschaubild wandert nicht in die Quellen",
  ausJw.quellen.every((q) => !/\.jpg$/.test(q.adresse)),
  ausJw.quellen.map((q) => q.adresse).join(" "));

/* ----------------------------------------------------------- Streamtape */

const streamtapeSeite = `<html><body>
<div id="robotlink" style="display:none;">/get_video?id=abc&expires=1&ip=2&token=xyz</div>
<script>document.getElementById('robotlink').innerHTML = '//streamtape.example/get_video?id=abc&expires=1' + ('QQQ&ip=2&token=echt').substring(3);</script>
</body></html>`;
const ausStreamtape = aufloesen(streamtapeSeite, "https://streamtape.example/e/abc");
pruefe("Streamtape: die beiden Haelften ergeben eine Adresse",
  ausStreamtape.quelle
    && ausStreamtape.quelle.adresse === "https://streamtape.example/get_video?id=abc&expires=1&ip=2&token=echt",
  ausStreamtape.quelle ? ausStreamtape.quelle.adresse : ausStreamtape.grund);

/* ------------------------------------------------------------- Der Klartext */

const klartextSeite = `<html><body><script>
var sources = { 'hls': '${Buffer.from("https://cdn.example/hls/xyz/index.m3u8", "utf8").toString("base64")}' };
</script></body></html>`;
const ausKlartext = aufloesen(klartextSeite, "https://hoster.example/e/xyz");
pruefe("Eine als Base64 abgelegte Playlist wird ausgepackt",
  ausKlartext.quelle && ausKlartext.quelle.adresse === "https://cdn.example/hls/xyz/index.m3u8",
  ausKlartext.quelle ? ausKlartext.quelle.adresse : ausKlartext.grund);

pruefe("Base64, hinter dem keine Adresse steht, ergibt nichts",
  adresseAusWert(Buffer.from("nur text", "utf8").toString("base64"), "https://a.example/") === "");
pruefe("Eine Adresse ohne Schema wird an der Seite festgemacht",
  adresseAusWert("//cdn.example/v/1.mp4", "https://hoster.example/e/1") === "https://cdn.example/v/1.mp4");
pruefe("javascript: ist keine Quelle",
  adresseAusWert("javascript:alert(1)", "https://hoster.example/e/1") === "");

/* ------------------------------------------------------------- Der Notnagel */

const rohSeite = `<html><body><video src="https://cdn.example/roh/film.mp4"></video></body></html>`;
const ausRoh = aufloesen(rohSeite, "https://hoster.example/e/roh");
pruefe("Die nackte Adresse wird genommen, aber als solche ausgewiesen",
  ausRoh.quelle && ausRoh.quelle.herkunft === "rohtext",
  ausRoh.quelle ? ausRoh.quelle.herkunft : ausRoh.grund);

/* ----------------------------------------------------------------- Nichts */

const leer = aufloesen("<html><body><p>Datei nicht gefunden</p></body></html>", "https://hoster.example/e/weg");
pruefe("Eine Seite ohne Video meldet sauber, dass nichts da ist",
  leer.quelle === null && leer.weiter === "" && leer.grund !== "",
  leer.grund);
pruefe("Auch gar kein Text bringt nichts zum Absturz",
  aufloesen("", "").quelle === null);
pruefe("Eine Werbeseite ohne Video erfindet keine Quelle",
  aufloesen(`<html><body><script>var werbung = {"file": "nicht wirklich"};</script></body></html>`,
    "https://hoster.example/e/1").quelle === null);

/* -------------------------------------------------------------- Die Wahl */

pruefe("Die Playlist schlaegt die groessere Datei",
  besteQuelle([
    { adresse: "a.mp4", typ: "datei", hoehe: 1080 },
    { adresse: "b.m3u8", typ: "hls", hoehe: 0 }
  ]).typ === "hls");
pruefe("Unter Dateien gewinnt die hoehere",
  besteQuelle([
    { adresse: "a.mp4", typ: "datei", hoehe: 480 },
    { adresse: "b.mp4", typ: "datei", hoehe: 1080 }
  ]).hoehe === 1080);
pruefe("Ohne Quellen gibt es keine beste",
  besteQuelle([]) === null && besteQuelle(null) === null);

pruefe("Der Typ haengt an der Endung, nicht am Hoster",
  typBestimmen("https://a.example/x/index.m3u8?t=1") === "hls"
  && typBestimmen("https://a.example/x/film.mp4") === "datei");
pruefe("Eine Hoehe wird nur uebernommen, wenn sie eine sein kann",
  hoeheBestimmen(99999, "", "") === 0 && hoeheBestimmen(0, "1080p", "") === 1080);

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`
${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
