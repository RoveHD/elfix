"use strict";
// Die Statusseite des Relays, gegen das echte Relay.
//
// Sie beantwortet die eine Frage, die man einem Dienst im Regal nicht ansieht:
// laeuft er noch? Geprueft wird deshalb dreierlei - dass ein Browser die Seite
// bekommt, dass /health die Zahlen dafuer wirklich liefert (Fassung, Laufzeit,
// offene Verbindungen), und vor allem, dass dabei nichts mit hinausgeht, was
// niemanden angeht: kein Raumcode, kein Titel, kein Pfad zur Ablage. Die Seite
// ist so oeffentlich wie das Relay - wer die Adresse kennt, sieht sie.
//
// Die vierte Pruefung gilt `curl`: die Wurzel steht in Anleitungen und in
// mancher Ueberwachung, und dort waere HTML statt einer Zeile Text eine
// Verschlechterung.

const fs = require("fs");
const path = require("path");
const WS = require("../../sync-server/node_modules/ws");
const statusSeite = require("../../sync-server/status-seite");

const WURZEL = path.join(__dirname, "..");
const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").replace(/\r/g, "");
const PRELOAD = fs.readFileSync(path.join(WURZEL, "src/preload.js"), "utf8").replace(/\r/g, "");
const RENDERER = fs.readFileSync(path.join(WURZEL, "src/renderer/renderer.js"), "utf8").replace(/\r/g, "");
const HTML = fs.readFileSync(path.join(WURZEL, "src/renderer/index.html"), "utf8").replace(/\r/g, "");

const PORT = Number(process.env.TESTPORT) || 8799;
const BASIS = `http://127.0.0.1:${PORT}`;
const RAUM = "statusraum";

const pruefungen = [];
const pruefe = (name, bedingung, detail) => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

const holen = (pfad, kopf) => fetch(BASIS + pfad, { headers: kopf || {} });

(async () => {
  // --- Die Seite ------------------------------------------------------------

  const status = await holen("/status");
  const seite = await status.text();
  pruefe("/status liefert eine Seite",
    status.status === 200 && String(status.headers.get("content-type")).includes("text/html"),
    `${status.status} ${status.headers.get("content-type")}`);
  pruefe("Es ist die Statusseite", seite.includes("<title>ELFIX Relay</title>"));
  pruefe("Sie ist dieselbe, die im Relay steht", seite === statusSeite.SEITE,
    "sonst liegt eine zweite Fassung irgendwo herum");
  pruefe("Sie wird nicht zwischengespeichert",
    String(status.headers.get("cache-control")).includes("no-store"),
    "eine Seite aus dem Zwischenspeicher zeigt ein Relay, das es so nicht mehr gibt");

  // --- Die Wurzel: Browser und curl -----------------------------------------

  const imBrowser = await holen("/", { accept: "text/html,application/xhtml+xml" });
  pruefe("Ein Browser bekommt die Seite schon auf der Wurzel",
    String(imBrowser.headers.get("content-type")).includes("text/html")
    && (await imBrowser.text()).includes("<title>ELFIX Relay</title>"),
    "wer die Adresse eintippt, soll nicht erst /status suchen muessen");

  const mitCurl = await holen("/", { accept: "*/*" });
  const zeile = await mitCurl.text();
  pruefe("curl bekommt weiter seine Zeile Text",
    String(mitCurl.headers.get("content-type")).includes("text/plain") && !zeile.includes("<html"),
    "die Wurzel steht in Anleitungen und in mancher Ueberwachung");
  pruefe("Und die Zeile sagt, wo die Seite steht", zeile.includes("/status"));

  // --- Die Zahlen -----------------------------------------------------------

  const vorher = await holen("/health").then((a) => a.json());
  pruefe("/health weist die Statusseite aus",
    Array.isArray(vorher.features) && vorher.features.includes("status"),
    "ohne den Eintrag laeuft drueben eine aeltere Fassung");
  pruefe("Es nennt die Fassung", typeof vorher.fassung === "string" && vorher.fassung.length > 0,
    vorher.fassung);
  pruefe("Es nennt die Laufzeit", Number.isFinite(vorher.laeuftSeitS) && vorher.laeuftSeitS >= 0,
    `${vorher.laeuftSeitS}s`);
  pruefe("Es nennt den Port", vorher.port === PORT, String(vorher.port));
  pruefe("Und es zaehlt die offenen Verbindungen", vorher.verbindungen === 0,
    String(vorher.verbindungen));

  const socket = new WS(`ws://127.0.0.1:${PORT}`);
  await new Promise((fertig) => socket.on("open", fertig));
  socket.send(JSON.stringify({ type: "join", room: RAUM, name: "Wohnzimmer", deviceId: "geraet-1" }));
  await new Promise((r) => setTimeout(r, 300));

  const drin = await holen("/health").then((a) => a.json());
  pruefe("Ein verbundenes Geraet steht in der Zahl", drin.verbindungen === 1,
    String(drin.verbindungen));
  pruefe("Und sein Raum auch", drin.raeume >= 1, String(drin.raeume));

  // --- Was nicht hinausgeht -------------------------------------------------

  const roh = JSON.stringify(drin);
  pruefe("Kein Raumcode in der Auskunft", !roh.toLowerCase().includes(RAUM),
    "der Raumcode ist der einzige Zugangsschutz");
  pruefe("Kein Geraetename in der Auskunft", !roh.includes("Wohnzimmer"));
  pruefe("Kein Pfad zur Ablage in der Auskunft",
    !roh.includes("raeume.json") && !roh.includes("/tmp") && !roh.includes("STATE"));
  pruefe("Und die Seite selbst traegt keine Zahlen mit sich",
    !statusSeite.SEITE.includes(RAUM),
    "alles Bewegliche kommt aus /health, sonst waere die Seite beim Laden veraltet");

  socket.close();
  await new Promise((r) => setTimeout(r, 200));
  const danach = await holen("/health").then((a) => a.json());
  pruefe("Nach dem Trennen ist die Verbindung wieder weg", danach.verbindungen === 0,
    String(danach.verbindungen));

  // --- Wie die Seite ihre Zahlen holt ---------------------------------------

  pruefe("Die Seite fragt relativ zu sich selbst nach",
    /new URL\("health", location\.href\)/.test(statusSeite.SEITE),
    "sonst bricht sie hinter einem Tunnel unter einem Unterpfad");
  pruefe("Sie fragt immer wieder nach",
    /setInterval\(fragen, \d+\)/.test(statusSeite.SEITE),
    "eine Seite, die nur beim Laden stimmt, taugt fuer diese Frage nicht");
  pruefe("Und sie sagt es, wenn keine Antwort mehr kommt",
    statusSeite.SEITE.includes("Keine Antwort") && statusSeite.SEITE.includes("veraltet"),
    "die alten Zahlen duerfen dann nicht wie aktuelle aussehen");

  // --- Der Weg aus der App dorthin ------------------------------------------

  pruefe("Die Einstellungen haben einen Knopf zur Statusseite",
    HTML.includes('id="watchpartyStatusseite"') && /Statusseite öffnen/.test(HTML));
  pruefe("Er haengt an einer Funktion",
    /watchpartyStatusseite\?\.addEventListener\("click", relayStatusseiteOeffnen\)/.test(RENDERER));
  pruefe("Die Bruecke gibt es",
    /openRelayStatus: \(\) => ipcRenderer\.invoke\("watchparty:statusseite"\)/.test(PRELOAD));
  pruefe("Und der Hauptprozess oeffnet sie im richtigen Browser",
    /ipcMain\.handle\("watchparty:statusseite"/.test(MAIN)
    && /shell\.openExternal\(`\$\{adresse\}\/status`\)/.test(MAIN));
  pruefe("Die Adresse kommt dabei aus den Einstellungen und nicht aus der Oberflaeche",
    /const adresse = webAdresse\(settings\.watchparty\?\.serverUrl \|\| ""\);/.test(MAIN)
    && /api\.openRelayStatus\?\.\(\)/.test(RENDERER)
    && !/openRelayStatus\?\.\([^)]/.test(RENDERER),
    "sonst waere jede Stelle im Renderer eine moegliche Quelle einer fremden Adresse");
  pruefe("Ohne eingetragene Adresse sagt die App, was fehlt",
    /keine-adresse/.test(MAIN) && /keine-adresse/.test(RENDERER));

  // --- Und die Frage danach: kann dieses Relay, was die App braucht? --------
  //
  // "Laeuft es" beantwortet die Seite. Offen blieb die Frage dahinter, und sie
  // hat einen Abend gekostet: zu einem Film, zu dem TMDB einen deutschen
  // Trailer fuehrt, sagte ELFIX "kein Trailer hinterlegt". Das Relay kannte
  // das Feld nur nicht - und die App konnte es nicht wissen.

  pruefe("/health weist auch die Trailer aus",
    vorher.features.includes("trailer"),
    "daran erkennt die App, ob dieses Relay sie ueberhaupt liefern kann");
  pruefe("Die App fragt danach",
    /ipcMain\.handle\("relay:status"/.test(MAIN)
    && /\$\{adresse\}\/health/.test(MAIN)
    && /AbortSignal\.timeout\(RELAY_FRIST_MS\)/.test(MAIN),
    "dieselbe Auskunft, die auch die Statusseite liest");
  pruefe("Die Bruecke dafuer gibt es",
    /getRelayStatus: \(\) => ipcRenderer\.invoke\("relay:status"\)/.test(PRELOAD));
  pruefe("Und die Einstellungen zeigen die Antwort",
    /id="relayStand"/.test(HTML) && /id="relayPruefen"/.test(HTML)
    && /function relayStandText\(stand\)/.test(RENDERER));
  pruefe("Jeder Fall wird beim Namen genannt",
    /Nicht erreichbar/.test(RENDERER) && /Trailer: ja/.test(RENDERER)
    && /diese Fassung kennt sie noch nicht/.test(RENDERER),
    "nicht erreichbar, laeuft mit Trailern, laeuft ohne");

  const fehlerAnzahl = pruefungen.filter((ok) => !ok).length;
  console.log(`\n${pruefungen.length - fehlerAnzahl}/${pruefungen.length} bestanden`);
  process.exit(fehlerAnzahl ? 1 : 0);
})();
