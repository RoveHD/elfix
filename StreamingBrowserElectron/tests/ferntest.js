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
const fernIcon = require("../../sync-server/fern-icon");
const { Fernbedienung, codeErzeugen, codeNormalisieren, kopplungsAdresse, relayLage, relayHinweis } = require("../src/fernbedienung");

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

  // --- Die Liste ------------------------------------------------------------
  //
  // Seit 1.35.0 darf das Handy auch auswaehlen, wenn nichts laeuft. Damit geht
  // erstmals mehr hinaus als "was gerade laeuft" - und deshalb ist hier
  // wichtig, dass es genau die Liste ist und nichts weiter.

  rechner.leeren();
  handy.send({ type: "fnliste" });
  const gefragt = await rechner.erwarte((m) => m.type === "fnliste");
  pruefe("Das Handy kann nach dem Weiterschauen fragen",
    Boolean(gefragt));

  handy.leeren();
  rechner.send({
    type: "fnliste",
    eintraege: [
      { key: "f1", titel: "One Piece", folge: "S1 · F3", anteil: 42 },
      { key: "f2", titel: "Dark", folge: "S2 · F1", anteil: 0 },
      { key: "", titel: "ohne Kennung" },
      { titel: "", key: "f4" }
    ]
  });
  const angekommen = await handy.erwarte((m) => m.type === "fnliste");
  pruefe("Die Antwort erreicht das Handy",
    angekommen?.eintraege?.length === 2,
    `${angekommen?.eintraege?.length} Eintraege`);
  pruefe("Eintraege ohne Kennung oder Titel fallen weg",
    angekommen.eintraege.every((eintrag) => eintrag.key && eintrag.titel),
    "ein Knopf ohne Ziel waere ein Knopf ins Leere");
  pruefe("Und es kommt nur, was hingehoert",
    Object.keys(angekommen.eintraege[0]).sort().join(",") === "anteil,folge,key,titel",
    "keine Adresse, kein Anbieter, kein Verlauf");

  rechner.send({
    type: "fnliste",
    eintraege: Array.from({ length: 90 }, (_, i) => ({ key: `k${i}`, titel: `Titel ${i}` }))
  });
  const gekuerzt = await handy.erwarte((m) => m.type === "fnliste" && m.eintraege.length !== 2);
  pruefe("Sehr lange Listen werden gekuerzt",
    gekuerzt?.eintraege.length === fern.MAX_LISTE,
    `${gekuerzt?.eintraege.length} statt 90`);

  rechner.leeren();
  handy.send({ type: "fnoeffnen", key: "f1" });
  const oeffnen = await rechner.erwarte((m) => m.type === "fnoeffnen");
  pruefe("Ein Titel aus der Liste laesst sich oeffnen",
    oeffnen?.key === "f1");

  rechner.leeren();
  handy.send({ type: "fnoeffnen", key: "" });
  await schlaf(200);
  pruefe("Ohne Kennung geschieht nichts",
    !rechner.eingang.some((m) => m.type === "fnoeffnen"));

  handy.leeren();
  rechner.send({ type: "fnoeffnen", key: "f1" });
  await schlaf(200);
  pruefe("Und der Rechner kann sich nicht selbst etwas oeffnen lassen",
    !handy.eingang.some((m) => m.type === "fnoeffnen"),
    "die Richtung haengt an der Seite");

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

  // --- Als App auf dem Startbildschirm --------------------------------------
  //
  // Chrome bietet "Installieren" nur an, wenn drei Dinge zusammenkommen: ein
  // Manifest mit Symbol, ein Service Worker mit fetch-Behandlung und eine
  // Startadresse, die im Geltungsbereich dieses Workers liegt. Fehlt eines
  // davon, bleibt es ein Lesezeichen mit Browserleiste - und das faellt erst
  // am Handy auf.

  const ohneStrich = await fetch(`http://127.0.0.1:${PORT}/fern`, { redirect: "manual" });
  pruefe("/fern leitet auf /fern/ um",
    ohneStrich.status === 302 && ohneStrich.headers.get("location") === "/fern/",
    "der Service Worker gilt fuer sein Verzeichnis - eine Startadresse ohne"
    + " Schraegstrich laege ausserhalb, und Chrome verweigerte die Installation");

  const manifestAntwort = await fetch(`http://127.0.0.1:${PORT}/fern/manifest.webmanifest`);
  const manifest = await manifestAntwort.json();
  pruefe("Das Manifest wird ausgeliefert",
    manifestAntwort.status === 200
    && manifestAntwort.headers.get("content-type").includes("application/manifest+json"),
    manifestAntwort.headers.get("content-type"));
  pruefe("Es macht daraus eine App und kein Lesezeichen",
    manifest.display === "standalone" && manifest.name && manifest.short_name,
    manifest.display);
  pruefe("Startadresse und Geltungsbereich stehen relativ da",
    manifest.start_url === "./" && manifest.scope === "./",
    "aufgeloest wird gegen die Adresse des Manifests - so stimmt es auch, wenn"
    + " das Relay hinter einem Vorspann wie /elfix/ haengt. Stuende dort"
    + " \"/fern/\", oeffnete die installierte App eine 404-Seite");
  {
    // Genau das nachrechnen, was der Browser rechnet: gegen die Adresse des
    // Manifests aufloesen. Beide Male muss die Seite herauskommen, die es
    // ausgeliefert hat - an der Wurzel wie hinter einem Vorspann.
    for (const basis of [`http://127.0.0.1:${PORT}/fern/`, "https://haus.example/elfix/fern/"]) {
      const manifestAdresse = new URL("manifest.webmanifest", basis);
      pruefe(`Aufgeloest gegen ${basis} zeigt start_url auf die Seite selbst`,
        new URL(manifest.start_url, manifestAdresse).href === basis);
      pruefe(`und der Geltungsbereich umfasst sie`,
        new URL(manifest.start_url, manifestAdresse).href.startsWith(new URL(manifest.scope, manifestAdresse).href));
    }
  }
  pruefe("Es nennt beide Groessen, die Chrome kennt",
    ["192x192", "512x512"].every((groesse) => manifest.icons.some((symbol) => symbol.sizes === groesse)),
    JSON.stringify(manifest.icons.map((i) => i.sizes)));
  pruefe("Es traegt keine feste Kennung",
    manifest.id === undefined,
    "Chrome leitet sie aus start_url ab, und die ist jetzt an jeder Stelle die"
    + " richtige - eine feste \"/fern/\" waere hinter einem Vorspann die falsche");
  pruefe("Und es schaltet die Installation nicht selbst ab",
    manifest.prefer_related_applications === false,
    "das Feld ist die einzige Angabe im Manifest, die genau das koennte");
  pruefe("und eines, das sich ausschneiden laesst",
    manifest.icons.some((symbol) => String(symbol.purpose).includes("maskable")),
    "sonst klebt auf runden Startbildschirmen ein Quadrat");

  // Jedes Symbol einzeln: was das Manifest verspricht, muss auch dastehen und
  // muss die Groesse haben, die es behauptet. Ein Symbol in der falschen Groesse
  // faellt erst auf dem Startbildschirm auf.
  for (const [datei, groesse] of [["icon.png", 512], ["icon-192.png", 192]]) {
    const symbol = await fetch(`http://127.0.0.1:${PORT}/fern/${datei}`);
    const bytes = Buffer.from(await symbol.arrayBuffer());
    pruefe(`${datei} ist ein echtes PNG`,
      symbol.status === 200 && symbol.headers.get("content-type") === "image/png"
      && bytes.subarray(1, 4).toString() === "PNG");
    pruefe(`und ${groesse} mal ${groesse} gross, wie das Manifest sagt`,
      bytes.readUInt32BE(16) === groesse && bytes.readUInt32BE(20) === groesse,
      `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`);
  }
  pruefe("Beide liegen als Base64 in einer .js-Datei",
    fernIcon.ICON_512.length > 1000 && fernIcon.ICON_192.length > 1000,
    "beim Aktualisieren des Relays werden nur .js-Dateien kopiert");
  for (const symbol of manifest.icons) {
    const antwort = await fetch(`http://127.0.0.1:${PORT}/fern/${symbol.src}`);
    pruefe(`Das Manifest zeigt mit ${symbol.src} nicht ins Leere`,
      antwort.status === 200, String(antwort.status));
  }

  const worker = await fetch(`http://127.0.0.1:${PORT}/fern/sw.js`);
  const workerText = await worker.text();
  pruefe("Der Service Worker wird ausgeliefert",
    worker.status === 200 && worker.headers.get("content-type").includes("javascript"));
  pruefe("Er behandelt Anfragen",
    /addEventListener\("fetch"/.test(workerText),
    "ohne fetch-Behandlung bietet Chrome das Installieren gar nicht erst an");
  pruefe("und kommt nie aus dem Zwischenspeicher",
    worker.headers.get("cache-control") === "no-store",
    "sonst liesse sich eine Fassung, die etwas falsch macht, nicht mehr abloesen");
  pruefe("Die Seite meldet ihn an und bringt das Manifest mit",
    fernSeite.SEITE.includes('rel="manifest"')
    && fernSeite.SEITE.includes('navigator.serviceWorker.register("sw.js")'));
  pruefe("Sie bietet das Installieren auch selbst an",
    fernSeite.SEITE.includes("beforeinstallprompt"),
    "im Chrome-Menue ist es gut versteckt");
  pruefe("Sie bringt die Weiterschauen-Liste mit",
    fernSeite.SEITE.includes('id="liste"') && fernSeite.SEITE.includes('type: "fnoeffnen"'),
    "wer nichts offen hat, soll vom Sofa aus waehlen koennen");
  pruefe("Und sie sagt, woran das Installieren haengt",
    fernSeite.SEITE.includes('id="installPruefung"')
    && fernSeite.SEITE.includes("getRegistration")
    && fernSeite.SEITE.includes('fetch("manifest.webmanifest"'),
    "Chrome nennt seine Gruende nirgends, wo man sie am Handy zu sehen bekaeme");
  pruefe("Die Auskunft sammelt erst und setzt dann ein",
    fernSeite.SEITE.includes("$(\"installPruefung\").replaceChildren(...zeilen)"),
    "zwei Laeufe nebeneinander schrieben sonst jede Zeile doppelt");
  pruefe("Sie traegt die Angabe, nach der Chrome fragt",
    fernSeite.SEITE.includes('name="mobile-web-app-capable"'),
    "die Apple-Fassung allein ist veraltet und Chrome sagt das auch");
  pruefe("Und sie sagt, warum es gerade nicht geht",
    fernSeite.SEITE.includes("window.isSecureContext")
    && fernSeite.SEITE.includes("Ohne https gibt es nur eine Verknüpfung"),
    "ohne diese Zeile passiert schlicht nichts, und niemand erfaehrt den Grund");
  pruefe("Laeuft sie schon als App, bietet sie es nicht noch einmal an",
    fernSeite.SEITE.includes('matchMedia("(display-mode: standalone)")'));

  // Der QR-Code traegt den Kopplungscode in der Adresse. Die Seite muss ihn
  // von dort nehmen - und sofort wieder daraus entfernen.
  pruefe("Die Seite nimmt den Code aus der Adresse",
    fernSeite.SEITE.includes('new URLSearchParams(location.search).get("code")'),
    "wer den QR scannt, soll nichts mehr abtippen");
  pruefe("und raeumt ihn gleich wieder weg",
    fernSeite.SEITE.includes('history.replaceState(null, "", location.pathname)'),
    "im Verlauf des Browsers hat ein Geheimnis nichts verloren");

  const kopplung = kopplungsAdresse("wss://relay.example.com", code);
  pruefe("Die Adresse fuer den QR-Code passt zur Seite",
    kopplung === `https://relay.example.com/fern/?code=${code}`,
    kopplung);
  pruefe("Ohne Server-Adresse gibt es keinen QR-Code",
    kopplungsAdresse("", code) === "" && kopplungsAdresse("wss://x.example", "") === "",
    "ein Code, der ins Leere zeigt, ist schlimmer als keiner");

  const seite = await fetch(`http://127.0.0.1:${PORT}/fern/`);
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
  pruefe("und getrennt davon, dass sie sich installieren laesst",
    health.features.includes("fernapp"),
    "das Relay wird von Hand aktualisiert, die App von selbst. Ohne diesen"
    + " Eintrag kann die App nicht erkennen, dass drueben eine Fassung ohne"
    + " Manifest laeuft - und der Nutzer bekommt am Handy still eine"
    + " Verknuepfung statt einer App");
  pruefe("und zaehlt die Kopplungen",
    Number.isFinite(health.fernbedienungen),
    String(health.fernbedienungen));

  // --- Die Fassade des Rechners, ausgefuehrt --------------------------------

  // --- Was die App ueber das Relay drueben sagen kann ------------------------
  //
  // Der Fall, an dem das Installieren wirklich haengengeblieben ist: das Relay
  // liefert die Fernbedienung aus, aber ohne Manifest, Symbol und Service
  // Worker. Chrome legt davon eine Verknuepfung an und sagt nirgends warum.

  {
    const alt133 = { ok: true, features: ["fern", "chat", "geraete"] };
    const lageAlt = relayLage("https://haus.example", alt133);
    pruefe("Ein Relay mit \"fern\", aber ohne \"fernapp\", gilt als zu alt",
      lageAlt.fern && !lageAlt.app && lageAlt.erreichbar);
    pruefe("und der Hinweis nennt den Grund und den Handgriff",
      /Manifest/.test(relayHinweis(lageAlt)) && /sync-server/.test(relayHinweis(lageAlt)));

    const lageNeu = relayLage("https://haus.example", { ok: true, features: ["fern", "fernapp"] });
    pruefe("Ein aktuelles Relay ueber https sagt nichts",
      relayHinweis(lageNeu) === "",
      "eine Zeile 'alles in Ordnung' liest nach dem zweiten Mal niemand");

    const lageHttp = relayLage("http://192.168.0.5:8787", { ok: true, features: ["fern", "fernapp"] });
    pruefe("Ueber http steht der Grund trotzdem da",
      /https/.test(relayHinweis(lageHttp)),
      "ohne https bietet Chrome nur eine Verknuepfung an");

    const lageWeg = relayLage("https://haus.example", null);
    pruefe("Ein Relay, das nicht antwortet, ist die erste Meldung",
      !lageWeg.erreichbar && /nicht erreichbar/i.test(relayHinweis(lageWeg)));

    const lageOhneFern = relayLage("https://haus.example", { ok: true, features: ["chat"] });
    pruefe("Ein Relay ganz ohne Fernbedienung wird als solches genannt",
      /kennt die Fernbedienung nicht/.test(relayHinweis(lageOhneFern)),
      "das ist ein anderer Handgriff als 'zu alt fuer die App'");

    pruefe("Der echte /health-Stand dieses Relays gilt als tauglich",
      relayHinweis(relayLage("https://haus.example", health)) === "",
      "sonst warnte die App vor ihrem eigenen, aktuellen Relay");
  }

  const dritterCode = codeErzeugen();
  const empfangen = [];
  const fassade = new Fernbedienung({
    WebSocketKlasse: WS,
    onBefehl: (b) => empfangen.push(b),
    onWach: () => empfangen.push("wach"),
    onListe: () => empfangen.push("liste"),
    onOeffnen: (key) => empfangen.push("oeffnen:" + key)
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
  drittesHandy.send({ type: "fnliste" });
  await schlaf(300);
  pruefe("Die Fassade wird nach der Liste gefragt",
    empfangen.includes("liste"),
    empfangen.join(","));
  fassade.listeMelden([{ key: "f9", titel: "Loki", folge: "S1 · F1", anteil: 12 }]);
  const ausFassade = await drittesHandy.erwarte((m) => m.type === "fnliste");
  pruefe("und ihre Antwort kommt an",
    ausFassade?.eintraege[0]?.titel === "Loki");
  drittesHandy.send({ type: "fnoeffnen", key: "f9" });
  await schlaf(300);
  pruefe("Ein Griff in die Liste erreicht sie",
    empfangen.includes("oeffnen:f9"),
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
  const inMain = MAIN.slice(MAIN.indexOf("async function fernBefehl("), MAIN.indexOf("async function fernStandMelden("));
  const fehlend = fern.BEFEHLE.filter((befehl) => !inMain.includes(`"${befehl}"`));
  pruefe("Jeder Befehl des Relays wird im Hauptprozess behandelt",
    fehlend.length === 0,
    fehlend.join(",") || "alle acht");

  // Vollbild heisst der Player und nicht das Fenster. Das Fenster gross zu
  // machen laesst das Video in seinem Kasten sitzen, mit Kopfzeile und
  // Empfehlungen ringsum - und genau das tat der Knopf zuerst.
  pruefe("Vollbild geht ueber den Player",
    /await vollbildUmschalten\(\);/.test(inMain)
    && /requestFullscreen/.test(MAIN.slice(MAIN.indexOf("function vollbildScript("), MAIN.indexOf("function vollbildScript(") + 2000)),
    "das Fenster ist nur der Rueckfall, wenn die Seite kein Vollbild zulaesst");
  pruefe("Es nimmt das groesste Video",
    /clientWidth \* rechts.clientHeight/.test(MAIN),
    "auf Anbieterseiten liegen Vorschauen in Briefmarkengroesse daneben");
  pruefe("Und es schaltet auch wieder aus",
    /if \(document.fullscreenElement\) \{/.test(MAIN));

  const seiteBefehle = [...fernSeite.SEITE.matchAll(/data-befehl="([a-z]+)"/g)].map((t) => t[1]);
  const unbekannt = seiteBefehle.filter((befehl) => !fern.BEFEHLE.includes(befehl));
  pruefe("Und jeder Knopf der Seite ist einer davon",
    unbekannt.length === 0 && seiteBefehle.length >= 6,
    unbekannt.join(",") || `${seiteBefehle.length} Knoepfe`);

  const fehlerAnzahl = pruefungen.filter((ok) => !ok).length;
  console.log(`\n${pruefungen.length - fehlerAnzahl}/${pruefungen.length} bestanden`);
  process.exit(fehlerAnzahl ? 1 : 0);
})();
