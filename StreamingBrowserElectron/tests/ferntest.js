"use strict";
// Das Handy als Fernbedienung, gegen das echte Relay.
//
// Zwei Seiten, die einander nie sehen: der Rechner meldet sich als steuerbar,
// das Handy tippt einen Code ein, und ab da geht in die eine Richtung ein
// Knopfdruck und in die andere eine Zeile Zustand. Geprueft wird vor allem, was
// *nicht* durchgeht - ein falscher Code, ein fremder Code, ein Befehl, den es
// nicht gibt. Denn was hier durchkommt, greift in eine laufende Wiedergabe ein.

const fs = require("fs");
const path = require("path");
const WS = require("../../sync-server/node_modules/ws");
const fern = require("../../sync-server/fern");
const fernSeite = require("../../sync-server/fern-seite");
const { Fernbedienung, codeErzeugen, codeNormalisieren } = require("../src/fernbedienung");

const PORT = Number(process.env.TESTPORT) || 8799;
const ADRESSE = `ws://127.0.0.1:${PORT}`;
const WURZEL = path.join(__dirname, "..");
const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").replace(/\r/g, "");

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

function client() {
  let socket;
  const eingang = [];
  const warten = [];
  return {
    eingang,
    verbinde: () => new Promise((fertig) => {
      socket = new WS(ADRESSE);
      socket.on("message", (roh) => {
        const m = JSON.parse(String(roh));
        eingang.push(m);
        for (let i = warten.length - 1; i >= 0; i -= 1) {
          if (warten[i].passt(m)) { warten[i].resolve(m); warten.splice(i, 1); }
        }
      });
      socket.on("open", fertig);
    }),
    send: (m) => socket.send(JSON.stringify(m)),
    zu: () => socket.close(),
    leeren: () => { eingang.length = 0; },
    erwarte: (passt, ms = 1200) => new Promise((resolve) => {
      const treffer = eingang.find(passt);
      if (treffer) return resolve(treffer);
      const e = { passt, resolve };
      warten.push(e);
      setTimeout(() => {
        const i = warten.indexOf(e);
        if (i >= 0) { warten.splice(i, 1); resolve(null); }
      }, ms);
    })
  };
}

(async () => {
  // --- Der Code -------------------------------------------------------------

  const code = codeErzeugen();
  pruefe("Ein erzeugter Code passt zu dem, was das Relay erwartet",
    fern.istCode(code), code);
  pruefe("Er ist acht Zeichen lang",
    code.length === 8);
  pruefe("Zwei Codes sind verschieden",
    codeErzeugen() !== codeErzeugen());
  pruefe("Abgetipptes wird geradegezogen",
    codeNormalisieren(code.toLowerCase()) === code
    && codeNormalisieren(` ${code} `) === code);
  pruefe("Verwechslungen beim Abschreiben auch",
    codeNormalisieren("O0O0O0O0") === "00000000"
    && codeNormalisieren("ILILILIL") === "11111111",
    "dasselbe Alphabet wie beim Geraeteschluessel");
  pruefe("Was nicht passt, ist kein Code",
    !fern.istCode("kurz") && !fern.istCode("ABCDEFGHI") && !fern.istCode("ABCDEFGU"),
    "U gehoert nicht zum Alphabet");

  // --- Kopplung -------------------------------------------------------------

  const rechner = client();
  const handy = client();
  await rechner.verbinde();
  await handy.verbinde();

  rechner.send({ type: "fnbereit", code, deviceId: "rechner-1" });
  const bereit = await rechner.erwarte((m) => m.type === "fnbereit");
  pruefe("Der Rechner meldet sich als steuerbar",
    bereit?.code === code);

  handy.send({ type: "fnhier", code });
  const da = await handy.erwarte((m) => m.type === "fnda");
  pruefe("Das Handy koppelt sich mit dem Code an",
    Boolean(da));
  const wach = await rechner.erwarte((m) => m.type === "fnwach");
  pruefe("und der Rechner wird geweckt",
    Boolean(wach),
    "sonst stuende die Seite im Handy leer da, bis sich zufaellig etwas bewegt");

  // --- Was durchgeht --------------------------------------------------------

  rechner.leeren();
  handy.send({ type: "fnbefehl", befehl: "umschalten" });
  const befehl = await rechner.erwarte((m) => m.type === "fnbefehl");
  pruefe("Ein Knopfdruck erreicht den Rechner",
    befehl?.befehl === "umschalten");

  handy.leeren();
  rechner.send({
    type: "fnstand", titel: "One Piece", folge: "Staffel 1 · Folge 3",
    laeuft: true, position: 312, dauer: 1440
  });
  const stand = await handy.erwarte((m) => m.type === "fnstand");
  pruefe("Der Stand erreicht das Handy",
    stand?.titel === "One Piece" && stand?.position === 312 && stand?.laeuft === true,
    JSON.stringify(stand?.titel));

  // --- Und was nicht --------------------------------------------------------

  rechner.leeren();
  handy.send({ type: "fnbefehl", befehl: "loeschen" });
  handy.send({ type: "fnbefehl", befehl: "eval('x')" });
  await schlaf(250);
  pruefe("Ein Befehl, den es nicht gibt, kommt nicht an",
    !rechner.eingang.some((m) => m.type === "fnbefehl"),
    "die Liste steht im Relay - was drin ist, entscheidet ELFIX und nicht die Nachricht");

  handy.leeren();
  rechner.send({ type: "fnbefehl", befehl: "umschalten" });
  await schlaf(250);
  pruefe("Der Rechner kann sich nicht selbst fernsteuern",
    !handy.eingang.some((m) => m.type === "fnbefehl"),
    "die Richtung haengt an der Seite, nicht am Absender");

  // Ein fremdes Handy an einem fremden Code.
  const fremd = client();
  await fremd.verbinde();
  fremd.send({ type: "fnhier", code: "ZZZZZZZZ" });
  const fehler = await fremd.erwarte((m) => m.type === "fnfehler");
  pruefe("Ein falscher Code wird abgewiesen",
    Boolean(fehler));
  rechner.leeren();
  fremd.send({ type: "fnbefehl", befehl: "pause" });
  await schlaf(250);
  pruefe("und wer nicht gekoppelt ist, drueckt ins Leere",
    !rechner.eingang.some((m) => m.type === "fnbefehl"));

  fremd.send({ type: "fnhier", code: "YYYYYYYY" });
  fremd.send({ type: "fnhier", code: "XXXXXXXX" });
  await schlaf(250);
  fremd.leeren();
  // Der vierte Versuch - jetzt ist Schluss, auch mit dem richtigen Code.
  fremd.send({ type: "fnhier", code });
  await schlaf(300);
  pruefe("Nach drei Fehlversuchen ist fuer diese Verbindung Schluss",
    !fremd.eingang.some((m) => m.type === "fnda"),
    "vierzig Bit soll niemand durchprobieren koennen");
  fremd.zu();

  // Zwei Rechner, zwei Codes - nichts geht quer.
  const zweiterRechner = client();
  const zweitesHandy = client();
  await zweiterRechner.verbinde();
  await zweitesHandy.verbinde();
  const zweiterCode = codeErzeugen();
  zweiterRechner.send({ type: "fnbereit", code: zweiterCode, deviceId: "rechner-2" });
  await schlaf(200);
  zweitesHandy.send({ type: "fnhier", code: zweiterCode });
  await schlaf(250);
  rechner.leeren();
  zweitesHandy.send({ type: "fnbefehl", befehl: "naechste" });
  const beimZweiten = await zweiterRechner.erwarte((m) => m.type === "fnbefehl");
  await schlaf(200);
  pruefe("Zwei Kopplungen kommen einander nicht in die Quere",
    beimZweiten?.befehl === "naechste" && !rechner.eingang.some((m) => m.type === "fnbefehl"),
    "sonst hielte das Handy des einen den Film des anderen an");

  // --- Geht der Rechner, ist nichts mehr zu steuern -------------------------

  handy.leeren();
  rechner.zu();
  const weg = await handy.erwarte((m) => m.type === "fnweg");
  pruefe("Verschwindet der Rechner, erfaehrt es das Handy",
    Boolean(weg));
  const nachher = client();
  await nachher.verbinde();
  nachher.send({ type: "fnhier", code });
  const abgewiesen = await nachher.erwarte((m) => m.type === "fnfehler");
  pruefe("und der Code koppelt niemanden mehr",
    Boolean(abgewiesen),
    "eine Kopplung ohne Gegenstelle waere ein Knopf ins Leere");
  nachher.zu();

  // --- Die Seite und die Auskunft -------------------------------------------

  const seite = await fetch(`http://127.0.0.1:${PORT}/fern`);
  const inhalt = await seite.text();
  pruefe("Das Relay liefert die Fernbedienung aus",
    seite.status === 200 && seite.headers.get("content-type").includes("text/html"),
    String(seite.status));
  pruefe("Sie fragt nach dem Code und bringt ihre Knoepfe mit",
    inhalt.includes('id="code"') && inhalt.includes('data-befehl="umschalten"'),
    "eine Seite, die nachladen muss, waere im Mobilfunk eine Zumutung");
  pruefe("und wird nicht zwischengespeichert",
    seite.headers.get("cache-control") === "no-store",
    "sonst haelt ein Handy nach dem Aktualisieren wochenlang an der alten fest");
  pruefe("Die Seite steht in einer .js-Datei",
    fernSeite.SEITE.length > 1000,
    "beim Aktualisieren des Relays werden nur .js-Dateien kopiert");

  const health = await fetch(`http://127.0.0.1:${PORT}/health`).then((a) => a.json());
  pruefe("/health weist die Fernbedienung aus",
    Array.isArray(health.features) && health.features.includes("fern"));
  pruefe("und zaehlt die Kopplungen",
    Number.isFinite(health.fernbedienungen),
    String(health.fernbedienungen));

  // --- Die Fassade des Rechners, ausgefuehrt --------------------------------

  const dritterCode = codeErzeugen();
  const empfangen = [];
  const fassade = new Fernbedienung({
    WebSocketKlasse: WS,
    onBefehl: (b) => empfangen.push(b),
    onWach: () => empfangen.push("wach")
  });
  fassade.konfigurieren({ enabled: true, serverUrl: ADRESSE, code: dritterCode, geraetId: "fassade" });
  await schlaf(400);
  pruefe("Die Fassade meldet sich beim Relay an",
    fassade.status().connected && fassade.status().code === dritterCode,
    JSON.stringify(fassade.status()));

  const drittesHandy = client();
  await drittesHandy.verbinde();
  drittesHandy.send({ type: "fnhier", code: dritterCode });
  await schlaf(300);
  pruefe("Das Koppeln weckt sie",
    empfangen.includes("wach"));

  drittesHandy.send({ type: "fnbefehl", befehl: "pause" });
  await schlaf(300);
  pruefe("Ein Knopfdruck erreicht ihren Rueckruf",
    empfangen.includes("pause"),
    empfangen.join(","));

  drittesHandy.leeren();
  fassade.standMelden({ titel: "Dark", folge: "Folge 1", laeuft: true, position: 10, dauer: 100 });
  const ersterStand = await drittesHandy.erwarte((m) => m.type === "fnstand");
  pruefe("Der Stand geht hinaus",
    ersterStand?.titel === "Dark");
  drittesHandy.leeren();
  const nochmal = fassade.standMelden({ titel: "Dark", folge: "Folge 1", laeuft: true, position: 10, dauer: 100 });
  await schlaf(250);
  pruefe("Derselbe Stand aber nicht noch einmal",
    nochmal === false && !drittesHandy.eingang.some((m) => m.type === "fnstand"),
    "sonst liefe je Takt eine Nachricht durch, auch wenn das Bild steht");
  fassade.standMelden({ titel: "Dark", folge: "Folge 1", laeuft: true, position: 11, dauer: 100 });
  const zweiterStand = await drittesHandy.erwarte((m) => m.type === "fnstand");
  pruefe("Eine Sekunde weiter schon",
    zweiterStand?.position === 11);

  fassade.trennen();
  drittesHandy.zu();
  zweiterRechner.zu();
  zweitesHandy.zu();
  handy.zu();

  // --- Beide Seiten muessen dieselben Befehle kennen ------------------------
  //
  // Ein Befehl, den das Relay durchlaesst und den ELFIX nicht kennt, waere ein
  // Knopf, der nichts tut - und einer, den ELFIX kennt und das Relay nicht
  // durchlaesst, ein Knopf, der nie ankommt.
  const inMain = MAIN.slice(MAIN.indexOf("async function fernBefehl("), MAIN.indexOf("function fernMediaScript("))
    + MAIN.slice(MAIN.indexOf("function fernMediaScript("), MAIN.indexOf("async function fernStandMelden("));
  const fehlend = fern.BEFEHLE.filter((befehl) => !inMain.includes(`"${befehl}"`));
  pruefe("Jeder Befehl des Relays wird im Hauptprozess behandelt",
    fehlend.length === 0,
    fehlend.join(",") || "alle acht");

  const seiteBefehle = [...fernSeite.SEITE.matchAll(/data-befehl="([a-z]+)"/g)].map((t) => t[1]);
  const unbekannt = seiteBefehle.filter((befehl) => !fern.BEFEHLE.includes(befehl));
  pruefe("Und jeder Knopf der Seite ist einer davon",
    unbekannt.length === 0 && seiteBefehle.length >= 6,
    unbekannt.join(",") || `${seiteBefehle.length} Knoepfe`);

  const fehlerAnzahl = pruefungen.filter((ok) => !ok).length;
  console.log(`\n${pruefungen.length - fehlerAnzahl}/${pruefungen.length} bestanden`);
  process.exit(fehlerAnzahl ? 1 : 0);
})();
