"use strict";
/*
 * Raeume bleiben, Titel haben einen Lebenslauf - am echten Relay.
 *
 * Gemeldet waren zwei Dinge, und sie hingen zusammen:
 *
 *   1. Watchparty-Raeume verschwanden nach dreissig Tagen von selbst. Im Relay
 *      stand dafuer RAUM_LEBENSDAUER_MS, und aufraeumen() loeschte jeden Raum,
 *      in dem so lange niemand war. Ein Raum ist aber kein Zwischenspeicher,
 *      sondern eine Verabredung: "Bangus" gehoert denselben Leuten, ob sie
 *      diese Woche zusammen geschaut haben oder ein halbes Jahr nicht.
 *
 *   2. Titel verschwanden dagegen nie. Ein zu Ende geschauter Film stand
 *      weiter in der Runde, und eine Serie, deren letzte verfuegbare Folge
 *      alle gesehen hatten, ebenso.
 *
 * Geprueft wird hier gegen den laufenden Server, nicht gegen eine Beschreibung
 * davon: Teil 1 mit einem eigenen Relay ueber einer vorbereiteten Ablage
 * (anders ist "der Raum ist ein Jahr alt" nicht herzustellen), Teil 2 gegen
 * das Relay, das der Testlauf ohnehin gestartet hat.
 *
 * Die Regel dahinter - wer archiviert, wann etwas wieder aktiv wird - steht in
 * raumarchivtest.js.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawn } = require("child_process");
const WS = require("../../sync-server/node_modules/ws");

if (!globalThis.WebSocket) globalThis.WebSocket = WS;

const WURZEL = path.join(__dirname, "..");
const BRUECKEN = path.join(WURZEL, "..", "android/app/src/main/assets/kern/eigen");

const PORT = Number(process.env.TESTPORT) || 8799;
const EIGENER_PORT = PORT + 40;
const RELAY = path.join(__dirname, "..", "..", "sync-server", "server.js");

const TAG_MS = 24 * 60 * 60 * 1000;
const SERIE = "https://aniworld.to/anime/stream/black-torch";
const folge = (staffel, nummer) => `${SERIE}/staffel-${staffel}/episode-${nummer}`;
const SERIEN_KEY = "serie:blacktorch";
const FILM = "https://filmo.to/movies/spider-man";
const FILM_KEY = "film:spiderman";

const pruefungen = [];
const pruefe = (name, bedingung, detail) => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

async function warteBis(bedingung, was, hoechstens = 6000) {
  const bis = Date.now() + hoechstens;
  while (Date.now() < bis) {
    let erfuellt = false;
    try {
      erfuellt = Boolean(bedingung());
    } catch {
      erfuellt = false;
    }
    if (erfuellt) return true;
    await schlaf(40);
  }
  console.log(`      (Wartezeit abgelaufen: ${was})`);
  return false;
}

/**
 * Ein Geraet an der Leitung - roh, damit hier wirklich das Protokoll geprueft
 * wird und nicht die Klasse, die es sonst bedient.
 */
function geraet(adresse, raum, name, kennung, konto = "") {
  let socket = null;
  const eingang = [];
  const api = {
    name,
    kennung,
    zustand: [],
    verbinde: () => new Promise((fertig, schiefgegangen) => {
      socket = new WS(adresse);
      socket.on("error", schiefgegangen);
      socket.on("message", (roh) => {
        const nachricht = JSON.parse(String(roh));
        eingang.push(nachricht);
        if (nachricht.type === "state" && Array.isArray(nachricht.shared)) {
          api.zustand = nachricht.shared;
        }
      });
      socket.on("open", () => {
        const gruss = { type: "join", room: raum, name, deviceId: kennung };
        if (konto) gruss.konto = konto;
        socket.send(JSON.stringify(gruss));
        fertig();
      });
    }),
    send: (nachricht) => socket.send(JSON.stringify(nachricht)),
    zu: () => { try { socket.close(); } catch { /* schon zu */ } },
    // Was dieses Geraet zuletzt im Raum gesehen hat.
    eintrag: (key) => api.zustand.find((titel) => titel.key === key) || null,
    // Und was davon als *aktiver* Titel gilt: dieselbe Sicht wie
    // watchpartyItems() am Rechner und eintraegeMitAnbieter() auf dem Telefon.
    aktive: () => api.zustand.filter((titel) => !titel.archived),
    eingegangen: (passt) => eingang.filter(passt)
  };
  return api;
}

function titel(key, url, art, staffel, nummer, name) {
  return { key, url, title: name, providerName: "AniWorld", type: art, season: staffel, episode: nummer };
}

function stand(url, staffel, nummer, zusatz = {}) {
  return {
    url, season: staffel, episode: nummer,
    position: 1399, duration: 1400, progress: 100,
    completed: false, episodeCompleted: false, archived: false,
    updatedAt: new Date().toISOString(), from: "Test",
    ...zusatz
  };
}

/**
 * Ein Android-Geraet - die echte Bruecke, mit demselben Lader wie im WebView.
 *
 * <p>Nicht nachgebaut, sondern geladen: `watchparty-bruecke.js` ist die Datei,
 * die auf dem Telefon laeuft, und sie darf nur Module sehen, die auch wirklich
 * mitfahren (kernModule in build.gradle). Genau deshalb steht sie hier - eine
 * Regel, die nur der Rechner kennt, ist auf dem Telefon keine.
 */
const KERN_MODULE = new Set(
  fs.readFileSync(path.join(WURZEL, "..", "android/app/build.gradle"), "utf8")
    .split("\n")
    .map((zeile) => (zeile.match(/"((?:src|shared)\/[a-z-]+\.js)"/) || [])[1])
    .filter(Boolean)
    .map((pfad) => path.basename(pfad, ".js"))
);

function android(name, kennung) {
  const lader = (gesucht) => {
    if (!KERN_MODULE.has(gesucht)) {
      throw new Error(`"${gesucht}" steht nicht in kernModule und faehrt nicht mit`);
    }
    const unter = fs.existsSync(path.join(WURZEL, "src", `${gesucht}.js`)) ? "src" : "shared";
    return require(path.join(WURZEL, unter, `${gesucht}.js`));
  };
  const modul = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(BRUECKEN, "watchparty-bruecke.js"), "utf8"), {
    require: lader,
    module: modul,
    exports: modul.exports,
    console,
    window: {
      crypto: { randomUUID: () => `${name}-${Math.random().toString(16).slice(2)}` },
      ElfixKern: { ereignis: () => {} },
      WebSocket: WS
    },
    WebSocket: WS,
    globalThis: { WebSocket: WS },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, JSON, Math, Number, String, Object, Array, Boolean,
    Set, Map, WeakSet, Error, RegExp, URL, Promise, Symbol
  });
  return { name, kennung, bruecke: modul.exports };
}

const ANBIETER = [
  { id: "aniworld", name: "AniWorld", startUrl: "https://aniworld.to/", searchUrl: "", logo: "AW" },
  { id: "filmo", name: "Filmo", startUrl: "https://filmo.to/", searchUrl: "", logo: "FI" }
];

/* ======================================================================== */
/* Teil 1: ein Raum, in dem ein Jahr niemand war                            */
/* ======================================================================== */

async function teilEins() {
  const ablage = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-archiv-"));
  const jetzt = Date.now();
  // Ein Raum, in dem seit einem Jahr niemand war, mit einem Titel darin. Dazu
  // zwei Grabsteine: einer aus der Zeit vor der Frist, einer von gestern.
  fs.writeFileSync(path.join(ablage, "raeume.json"), JSON.stringify({
    raeume: {
      bangus: {
        at: jetzt - 365 * TAG_MS,
        graeber: [
          { key: "serie:uralt", at: jetzt - 200 * TAG_MS },
          { key: "serie:frisch", at: jetzt - 1 * TAG_MS }
        ],
        titel: [{
          key: SERIEN_KEY,
          url: folge(1, 4),
          title: "Black Torch",
          providerName: "AniWorld",
          type: "serie",
          season: 1,
          episode: 4,
          addedBy: "Alter Rechner",
          addedById: "geraet-alt",
          addedByKonto: "",
          addedAt: new Date(jetzt - 365 * TAG_MS).toISOString(),
          members: [["geraet-alt", "Alter Rechner"]]
        }]
      }
    }
  }));

  const server = spawn(process.execPath, [RELAY], {
    env: { ...process.env, PORT: String(EIGENER_PORT), STATE_DIRECTORY: ablage },
    stdio: "ignore"
  });
  // Diese Pruefung braucht ihr *eigenes* Relay: sie legt vorher eine Ablage an
  // und will sehen, was daraus geladen wird. Liegt auf dem Port schon eines,
  // beendet sich der frisch gestartete Prozess mit EADDRINUSE - und die
  // Pruefung liefe gegen fremden Zustand, ohne dass es jemand merkt. Genau so
  // kamen am 4.9.2026 Fehlschlaege zustande, die es im Quelltext nicht gab.
  let gestorben = false;
  server.on("exit", () => { gestorben = true; });
  await schlaf(1400);
  if (gestorben) {
    console.log(`FAIL  Eigenes Relay auf Port ${EIGENER_PORT}`
      + "   -> dort laeuft schon eines; diese Pruefung braucht ihre eigene Ablage");
    process.exit(1);
  }

  const adresse = `ws://127.0.0.1:${EIGENER_PORT}`;
  const pc = geraet(adresse, "bangus", "Rechner", "geraet-neu");
  await pc.verbinde();
  await warteBis(() => pc.zustand.length > 0 || pc.eingegangen((m) => m.type === "state").length > 0,
    "erster Zustand");

  pruefe("1a. Ein Raum, in dem ein Jahr niemand war, ist noch da",
    Boolean(pc.eintrag(SERIEN_KEY)),
    "vorher loeschte aufraeumen() ihn nach dreissig Tagen samt allen Mitgliedschaften");
  pruefe("1b. Und der Titel darin steht bei derselben Folge wie vorher",
    pc.eintrag(SERIEN_KEY)?.episode === 4,
    `Folge ${pc.eintrag(SERIEN_KEY)?.episode}`);
  pruefe("1c. Die Mitgliedschaft des alten Geraets hat es ueberlebt",
    (pc.eintrag(SERIEN_KEY)?.memberIds || []).includes("geraet-alt"));

  // Die Grabsteine dagegen verfallen wie bisher. Geprueft wird das an ihrer
  // Wirkung: ein Nachtrag kommt nur durch, wo kein Grabstein mehr liegt.
  pc.send({ type: "share", item: titel("serie:uralt", `${SERIE}-uralt/staffel-1/episode-1`, "serie", 1, 1, "Uralt"), restore: true });
  pc.send({ type: "share", item: titel("serie:frisch", `${SERIE}-frisch/staffel-1/episode-1`, "serie", 1, 1, "Frisch"), restore: true });
  await schlaf(500);

  pruefe("2a. Ein abgelaufener Grabstein ist weg - der Nachtrag kommt durch",
    Boolean(pc.eintrag("serie:uralt")),
    "die Frist der Grabsteine bleibt, nur die der Raeume faellt weg");
  pruefe("2b. Ein frischer Grabstein haelt weiter draussen",
    !pc.eintrag("serie:frisch"),
    "sonst holte ihn das naechste Geraet, das sich verbindet, ungefragt zurueck");

  pc.zu();
  await schlaf(150);
  server.kill();
  await schlaf(200);
  fs.rmSync(ablage, { recursive: true, force: true });
}

/* ======================================================================== */
/* Teil 2: der Lebenslauf eines Titels                                      */
/* ======================================================================== */

async function teilZwei() {
  const adresse = `ws://127.0.0.1:${PORT}`;
  const KONTO = "c".repeat(32);

  // --- Film: zu Ende geschaut ---------------------------------------------

  const pc = geraet(adresse, "bangus", "PC", "archiv-pc", KONTO);
  const handy = geraet(adresse, "bangus", "Handy", "archiv-handy", KONTO);
  await pc.verbinde();
  await handy.verbinde();
  await schlaf(200);

  pc.send({ type: "share", item: titel(FILM_KEY, FILM, "film", 0, 0, "Spider-Man") });
  pc.send({ type: "share", item: titel(SERIEN_KEY, folge(1, 8), "serie", 1, 8, "Black Torch") });
  handy.send({ type: "enter", key: FILM_KEY });
  handy.send({ type: "enter", key: SERIEN_KEY });
  await warteBis(() => pc.aktive().length === 2 && handy.aktive().length === 2, "beide Titel im Raum");
  pruefe("3a. Zwei Titel stehen aktiv in der Runde",
    pc.aktive().map((eintrag) => eintrag.key).sort().join(",") === [FILM_KEY, SERIEN_KEY].sort().join(","),
    pc.aktive().map((eintrag) => eintrag.key).join(","));

  // Der Film laeuft am PC zu Ende. Genau das, was watchpartyStand() dabei
  // hinausschickt: completed und daraus abgeleitet archived.
  pc.send({ type: "enter", key: FILM_KEY });
  await schlaf(150);
  pc.send({ type: "progress", key: FILM_KEY, progress: stand(FILM, 0, 0, { completed: true, archived: true }) });
  await warteBis(() => pc.aktive().length === 1, "Film verschwindet aus dem aktiven Bestand");

  pruefe("3b. Der abgeschlossene Film ist kein aktiver Titel der Runde mehr",
    !pc.aktive().some((eintrag) => eintrag.key === FILM_KEY),
    "vorher stand er dauerhaft in „Gemeinsam weiterschauen“");
  pruefe("3c. Geloescht ist er trotzdem nicht - er liegt archiviert im Raum",
    pc.eintrag(FILM_KEY)?.archived === true,
    "so weiss jedes Geraet, dass die Runde ihn hinter sich hat");
  pruefe("3d. Und das andere Geraet erfaehrt es sofort",
    handy.eintrag(FILM_KEY)?.archived === true);

  pruefe("4a. Der Raum selbst bleibt bestehen",
    pc.zustand.length === 2 && Boolean(pc.eintrag(SERIEN_KEY)),
    "ein abgeschlossener Film nimmt die Runde nicht mit");
  pruefe("4b. Die Mitgliedschaft am Film bleibt ebenfalls stehen",
    (pc.eintrag(FILM_KEY)?.memberIds || []).includes("archiv-handy"),
    "wer den Titel zurueckholt, muss niemanden neu einladen");

  // --- Geraete-Restore: der Film kommt nicht zurueck -----------------------

  handy.zu();
  await schlaf(200);
  const handyNeu = geraet(adresse, "bangus", "Handy", "archiv-handy", KONTO);
  await handyNeu.verbinde();
  await schlaf(250);
  // Was restoreWatchparty beim Verbinden tut - und was ein Geraet mit einem
  // veralteten Stand obendrein meldet.
  handyNeu.send({ type: "share", item: titel(FILM_KEY, FILM, "film", 0, 0, "Spider-Man"), restore: true });
  handyNeu.send({ type: "enter", key: FILM_KEY });
  await schlaf(150);
  handyNeu.send({ type: "progress", key: FILM_KEY, progress: stand(FILM, 0, 0, { position: 900, progress: 12 }) });
  await schlaf(500);

  pruefe("5a. Ein spaeter startendes Geraet holt den fertigen Film nicht zurueck",
    handyNeu.eintrag(FILM_KEY)?.archived === true && pc.eintrag(FILM_KEY)?.archived === true,
    "der Nachtrag ist kein Wiedereinstellen");
  pruefe("5b. Und sein alter Stand dreht die Runde nicht zurueck",
    Number(pc.eintrag(FILM_KEY)?.progress?.progress) === 100,
    `Fortschritt ${pc.eintrag(FILM_KEY)?.progress?.progress}%`);

  // --- Serie: alles gesehen, was es gibt ----------------------------------

  handyNeu.send({ type: "enter", key: SERIEN_KEY });
  await schlaf(150);
  pc.send({ type: "enter", key: SERIEN_KEY });
  await schlaf(150);
  pc.send({
    type: "progress",
    key: SERIEN_KEY,
    progress: stand(folge(1, 8), 1, 8, { episodeCompleted: true, completed: true, archived: true })
  });
  await warteBis(() => pc.eintrag(SERIEN_KEY)?.archived === true, "Serie archiviert");

  pruefe("6a. Die durchgeschaute Serie wird archiviert",
    pc.eintrag(SERIEN_KEY)?.archived === true);
  pruefe("6b. Geloescht wird sie ausdruecklich nicht",
    Boolean(pc.eintrag(SERIEN_KEY)) && pc.eintrag(SERIEN_KEY).title === "Black Torch",
    "sonst gaebe es beim naechsten Nachschub nichts mehr zu wecken");
  pruefe("6c. Sie steht nicht mehr im aktiven Bestand",
    pc.aktive().length === 0,
    `${pc.aktive().length} aktive Titel`);

  // Ein Geraet, das aus war, meldet seinen alten Stand nach - das darf sie
  // nicht wecken.
  handyNeu.send({ type: "progress", key: SERIEN_KEY, progress: stand(folge(1, 5), 1, 5, { position: 300, progress: 20 }) });
  await schlaf(500);
  pruefe("7a. Ein alter Stand weckt die archivierte Serie nicht",
    pc.eintrag(SERIEN_KEY)?.archived === true,
    "sonst stuende sie nach jedem Handystart wieder bei Folge 5 in der Reihe");
  pruefe("7b. Und die Runde bleibt auf Folge 8 stehen",
    Number(pc.eintrag(SERIEN_KEY)?.progress?.episode) === 8,
    `Folge ${pc.eintrag(SERIEN_KEY)?.progress?.episode}`);

  // --- Samstag: Folge 9 ---------------------------------------------------

  const vorher = pc.eintrag(SERIEN_KEY);
  handyNeu.send({
    type: "progress",
    key: SERIEN_KEY,
    progress: stand(folge(1, 9), 1, 9, { position: 0, duration: 0, progress: 0, archived: false })
  });
  await warteBis(() => pc.eintrag(SERIEN_KEY)?.archived === false, "Serie wieder aktiv");

  const nachher = pc.eintrag(SERIEN_KEY);
  pruefe("8a. Eine neue Folge holt denselben Raumtitel zurueck",
    nachher?.archived === false,
    "reaktiviert, nicht neu eingestellt");
  pruefe("8b. Er zeigt jetzt auf Folge 9",
    Number(nachher?.progress?.episode) === 9 && nachher?.episode === 9,
    `Folge ${nachher?.episode}`);
  pruefe("8c. Raum, Werk und Mitglieder sind dieselben geblieben",
    nachher?.key === vorher?.key
    && nachher?.addedById === vorher?.addedById
    && (nachher?.memberIds || []).length === (vorher?.memberIds || []).length,
    `${(nachher?.memberIds || []).length} Mitglieder`);
  pruefe("8d. Und er steht wieder im aktiven Bestand",
    pc.aktive().some((eintrag) => eintrag.key === SERIEN_KEY));

  // --- Und eine neue Staffel genauso --------------------------------------

  pc.send({
    type: "progress",
    key: SERIEN_KEY,
    progress: stand(folge(1, 12), 1, 12, { episodeCompleted: true, completed: true, archived: true })
  });
  await warteBis(() => pc.eintrag(SERIEN_KEY)?.archived === true, "wieder archiviert");
  pruefe("9a. Nach dem Staffelende ist der Titel wieder archiviert",
    pc.eintrag(SERIEN_KEY)?.archived === true);

  handyNeu.send({
    type: "progress",
    key: SERIEN_KEY,
    progress: stand(folge(2, 1), 2, 1, { position: 0, duration: 0, progress: 0, archived: false })
  });
  await warteBis(() => pc.eintrag(SERIEN_KEY)?.archived === false, "neue Staffel weckt");
  pruefe("9b. Eine neue Staffel weckt ihn ebenso",
    pc.eintrag(SERIEN_KEY)?.archived === false
    && Number(pc.eintrag(SERIEN_KEY)?.season) === 2
    && Number(pc.eintrag(SERIEN_KEY)?.episode) === 1,
    `S${pc.eintrag(SERIEN_KEY)?.season}E${pc.eintrag(SERIEN_KEY)?.episode}`);

  // --- Korra: es kommt nie etwas nach -------------------------------------

  const KORRA_KEY = "serie:diclegendevonkorra";
  const KORRA = "https://aniworld.to/anime/stream/korra/staffel-4/episode-13";
  pc.send({ type: "share", item: titel(KORRA_KEY, KORRA, "serie", 4, 13, "Die Legende von Korra") });
  await warteBis(() => Boolean(pc.eintrag(KORRA_KEY)), "Korra im Raum");
  pc.send({ type: "enter", key: KORRA_KEY });
  await schlaf(150);
  pc.send({
    type: "progress",
    key: KORRA_KEY,
    progress: stand(KORRA, 4, 13, { episodeCompleted: true, completed: true, archived: true })
  });
  await warteBis(() => pc.eintrag(KORRA_KEY)?.archived === true, "Korra archiviert");

  // Ein Jahr lang meldet sich jedes Geraet beim Start - und nichts davon ist
  // eine neue Folge.
  for (let lauf = 0; lauf < 3; lauf += 1) {
    handyNeu.send({ type: "share", item: titel(KORRA_KEY, KORRA, "serie", 4, 13, "Die Legende von Korra"), restore: true });
    handyNeu.send({ type: "enter", key: KORRA_KEY });
    handyNeu.send({ type: "progress", key: KORRA_KEY, progress: stand(KORRA, 4, 13, { position: 400 }) });
  }
  await schlaf(600);
  pruefe("10a. Ohne neue Folge bleibt Korra archiviert",
    pc.eintrag(KORRA_KEY)?.archived === true,
    "sie stoert niemanden");
  pruefe("10b. Der Raum steht trotzdem weiter da",
    pc.zustand.length === 3,
    `${pc.zustand.length} Titel im Raum`);

  // --- Wer ihn bewusst zurueckholt, bekommt ihn ---------------------------

  pc.send({ type: "share", item: titel(KORRA_KEY, KORRA, "serie", 4, 13, "Die Legende von Korra") });
  await warteBis(() => pc.eintrag(KORRA_KEY)?.archived === false, "Korra von Hand zurueck");
  pruefe("11. Ausdruecklich wieder einstellen holt ihn zurueck",
    pc.eintrag(KORRA_KEY)?.archived === false,
    "dieselbe Trennung wie beim Grabstein: Nachtrag nein, Absicht ja");

  // --- Zwei Raeume, derselbe Titel ---------------------------------------

  const familie = geraet(adresse, "familie", "PC", "archiv-pc", KONTO);
  await familie.verbinde();
  await schlaf(200);
  familie.send({ type: "share", item: titel(SERIEN_KEY, folge(1, 4), "serie", 1, 4, "Black Torch") });
  familie.send({ type: "enter", key: SERIEN_KEY });
  await warteBis(() => Boolean(familie.eintrag(SERIEN_KEY)), "Black Torch in Familie");
  familie.send({ type: "progress", key: SERIEN_KEY, progress: stand(folge(1, 4), 1, 4, { position: 200, progress: 15 }) });
  await schlaf(300);

  // In "bangus" wird derselbe Titel jetzt archiviert.
  pc.send({
    type: "progress",
    key: SERIEN_KEY,
    progress: stand(folge(2, 6), 2, 6, { episodeCompleted: true, completed: true, archived: true })
  });
  await warteBis(() => pc.eintrag(SERIEN_KEY)?.archived === true, "Bangus archiviert");
  await schlaf(300);

  // Frisch nachgesehen und nicht aus dem Posteingang: ein Fortschritt loest
  // fuer sich keinen neuen Raumzustand aus, und der letzte, den dieses Geraet
  // gesehen hat, ist von vor der Meldung.
  const familieLeser = geraet(adresse, "familie", "Zweitgeraet", "archiv-familie-2");
  await familieLeser.verbinde();
  await warteBis(() => Boolean(familieLeser.eintrag(SERIEN_KEY)), "Zustand der Runde Familie");

  pruefe("12a. Bangus ist archiviert",
    pc.eintrag(SERIEN_KEY)?.archived === true);
  pruefe("12b. Familie laeuft davon unberuehrt weiter",
    familieLeser.eintrag(SERIEN_KEY)?.archived === false
    && Number(familieLeser.eintrag(SERIEN_KEY)?.progress?.episode) === 4,
    `Folge ${familieLeser.eintrag(SERIEN_KEY)?.progress?.episode}, archiviert=${familieLeser.eintrag(SERIEN_KEY)?.archived}`);
  pruefe("12c. Und der Titel steht in Familie weiter im aktiven Bestand",
    familieLeser.aktive().some((eintrag) => eintrag.key === SERIEN_KEY));
  pruefe("12d. Die beiden Raeume fuehren denselben Titel getrennt",
    Number(pc.eintrag(SERIEN_KEY)?.progress?.episode) === 6
    && Number(familieLeser.eintrag(SERIEN_KEY)?.progress?.episode) === 4,
    "kein Zustand faellt vom einen Raum in den anderen");

  for (const wer of [pc, handyNeu, familie, familieLeser]) wer.zu();
  await schlaf(150);
}

/* ======================================================================== */
/* Teil 3: das Telefon sieht dasselbe                                       */
/* ======================================================================== */

/*
 * "Desktop und Android verhalten sich gleich" ist hier keine Behauptung,
 * sondern ein Lauf: die echte Bruecke haengt sich an dasselbe Relay und
 * bekommt dieselben Zustaende. Geprueft wird, was ein Telefon daraus macht -
 * die Liste der Runde, der eigene Bestand und das, was es dabei *nicht* tut.
 */
async function teilDrei() {
  const adresse = `ws://127.0.0.1:${PORT}`;
  const RAUM = "telefonraum";

  const pc = geraet(adresse, RAUM, "PC", "tel-pc");
  await pc.verbinde();
  await schlaf(200);
  pc.send({ type: "share", item: titel(FILM_KEY, FILM, "film", 0, 0, "Spider-Man") });
  pc.send({ type: "share", item: titel(SERIEN_KEY, folge(1, 8), "serie", 1, 8, "Black Torch") });
  await warteBis(() => pc.zustand.length === 2, "zwei Titel im Raum");

  const handy = android("Handy", "tel-handy");
  handy.bruecke.konfigurieren({
    enabled: true, serverUrl: adresse, rooms: [RAUM], deviceName: "Handy", deviceId: "tel-handy"
  });
  await warteBis(() => handy.bruecke.eintraege().length === 2, "Telefon sieht die Runde");
  handy.bruecke.beitreten(FILM_KEY, RAUM);
  handy.bruecke.beitreten(SERIEN_KEY, RAUM);
  await warteBis(() => handy.bruecke.eintraege().every((eintrag) => eintrag.joined), "Telefon beigetreten");

  // Der eigene Bestand des Telefons - so, wie Bestand.java ihn hereinreicht.
  let ablage = { favoriten: [] };
  ablage = { favoriten: handy.bruecke.raumEintraegeSichern(ablage, ANBIETER).favoriten };
  pruefe("13a. Das Telefon legt zu beiden Titeln einen Eintrag an",
    ablage.favoriten.length === 2,
    `${ablage.favoriten.length} Eintraege`);
  pruefe("13b. Und beide gehoeren dem Raum, nicht der eigenen Merkliste",
    ablage.favoriten.every((eintrag) => eintrag.watchpartyRoom === RAUM && eintrag.favorite === false));

  // Jetzt schaut der Rechner den Film zu Ende.
  pc.send({ type: "enter", key: FILM_KEY });
  await schlaf(150);
  pc.send({ type: "progress", key: FILM_KEY, progress: stand(FILM, 0, 0, { completed: true, archived: true }) });
  await warteBis(() => handy.bruecke.eintraege().some((eintrag) => eintrag.key === FILM_KEY && eintrag.archived),
    "Telefon erfaehrt vom Archiv");

  const lauf = handy.bruecke.raumEintraegeSichern(ablage, ANBIETER);
  ablage = { favoriten: lauf.favoriten };
  const filmEintrag = ablage.favoriten.find((eintrag) => eintrag.type === "film");
  pruefe("14a. Der Eintrag des Telefons zieht nach: archiviert",
    filmEintrag?.watchpartyArchived === true,
    "auch wenn dieses Geraet beim Abschluss gar nichts gemeldet hat");
  pruefe("14b. Damit faellt er dort aus „Gemeinsam weiterschauen“",
    require("../src/fortschritt").hasContinueProgressRecord(filmEintrag) === false,
    "dieselbe Regel wie Favorite.stehtInWeiterschauen auf dem Telefon");
  pruefe("14c. Geloescht wird er nicht - die Mediathek behaelt ihn",
    Boolean(filmEintrag) && ablage.favoriten.length === 2);

  pruefe("15a. In der Liste der Runde steht er nicht mehr",
    handy.bruecke.eintraegeMitAnbieter(ANBIETER).map((eintrag) => eintrag.key).join(",") === SERIEN_KEY,
    handy.bruecke.eintraegeMitAnbieter(ANBIETER).map((eintrag) => eintrag.key).join(","));

  // Ein frisch dazugekommenes Telefon legt fuer den archivierten Titel gar
  // keinen Eintrag an - genau der Fall "Handy startet spaeter".
  const frisch = handy.bruecke.raumEintraegeSichern({ favoriten: [] }, ANBIETER);
  pruefe("16a. Ein leerer Bestand bekommt den fertigen Film nicht nachgetragen",
    frisch.favoriten.length === 1 && frisch.favoriten[0].type === "serie",
    frisch.favoriten.map((eintrag) => eintrag.type).join(","));

  // Und die archivierte Serie weckt es auch nicht.
  pc.send({ type: "enter", key: SERIEN_KEY });
  await schlaf(150);
  pc.send({
    type: "progress",
    key: SERIEN_KEY,
    progress: stand(folge(1, 8), 1, 8, { episodeCompleted: true, completed: true, archived: true })
  });
  await warteBis(() => handy.bruecke.eintraege().every((eintrag) => eintrag.archived), "beide archiviert");
  const leer = handy.bruecke.raumEintraegeSichern({ favoriten: [] }, ANBIETER);
  pruefe("16b. Und die archivierte Serie ebenso wenig",
    leer.favoriten.length === 0,
    `${leer.favoriten.length} Eintraege`);
  pruefe("16c. Der Raum steht dem Telefon trotzdem weiter offen",
    handy.bruecke.eintraege().length === 2 && handy.bruecke.status().connected,
    "archiviert heisst nicht geloescht");

  handy.bruecke.trennen();
  pc.zu();
  await schlaf(150);
}

(async () => {
  await teilEins();
  await teilZwei();
  await teilDrei();
  const fehler = pruefungen.filter((x) => !x).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  process.exit(fehler ? 1 : 0);
})().catch((fehler) => {
  console.error("Abgebrochen:", fehler.stack || fehler.message);
  process.exit(2);
});
