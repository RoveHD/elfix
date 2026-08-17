"use strict";
// Treibt das echte Relay mit zwei Clients: Host A, Gast B.
const WS = require("D:\\Dokumente\\Serien Filme und Animes\\sync-server\\node_modules\\ws");

const PORT = Number(process.env.TESTPORT) || 8799;
const ADRESSE = `ws://127.0.0.1:${PORT}`;
const RAUM = "testraum";
const KEY = "serie:theoffice";
const URL1 = "https://s.to/serie/stream/the-office/staffel-1/episode-1";
const URL2 = "https://s.to/serie/stream/the-office/staffel-1/episode-2";

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push({ name, ok: Boolean(bedingung), detail });
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}

function client(name, deviceId) {
  const socket = new WS(ADRESSE);
  const eingang = [];
  const warten = [];
  socket.on("message", (roh) => {
    const nachricht = JSON.parse(String(roh));
    eingang.push(nachricht);
    for (let i = warten.length - 1; i >= 0; i -= 1) {
      if (warten[i].passt(nachricht)) {
        warten[i].resolve(nachricht);
        warten.splice(i, 1);
      }
    }
  });
  return {
    name,
    deviceId,
    socket,
    offen: () => new Promise((r) => socket.on("open", r)),
    send: (m) => socket.send(JSON.stringify(m)),
    erwarte: (passt, was, ms = 1500) => new Promise((resolve, reject) => {
      const treffer = eingang.find(passt);
      if (treffer) return resolve(treffer);
      const eintrag = { passt, resolve };
      warten.push(eintrag);
      setTimeout(() => {
        const i = warten.indexOf(eintrag);
        if (i >= 0) warten.splice(i, 1);
        reject(new Error(`Zeitueberschreitung: ${was} (${name})`));
      }, ms);
    }),
    still: (passt, ms = 600) => new Promise((resolve) => {
      setTimeout(() => resolve(!eingang.some(passt)), ms);
    }),
    leeren: () => { eingang.length = 0; }
  };
}

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

// Jeder Client pulst durchgehend, genau wie der echte Player. Ohne Herzschlag
// gilt niemand als aktiv - und ohne aktive Teilnehmer gibt es keinen Host.
const pulse = [];
function pulsStarten(c, folgeNr, adresse) {
  c.folge = folgeNr;
  c.adresse = adresse;
  c.zuletzt = Date.now();
  const schlag = () => {
    // Wie ein echter Player: laeuft er, waechst die Stelle mit der Zeit.
    const jetzt = Date.now();
    if (!c.pausiert) c.stelle = (c.stelle || 0) + (jetzt - c.zuletzt) / 1000;
    c.zuletzt = jetzt;
    c.send({
      type: "here", key: KEY,
      position: c.stelle || 0,
      paused: Boolean(c.pausiert),
      season: 1, episode: c.folge,
      url: c.adresse,
      playerSessionId: `${c.deviceId}-e${c.folge}`
    });
  };
  schlag();
  const timer = setInterval(schlag, 800);
  timer.unref?.();
  pulse.push(timer);
}
function pulsFolge(c, folgeNr, adresse) {
  c.folge = folgeNr;
  c.adresse = adresse;
  c.stelle = 0;
  melde(c, {});
}
// Ein Steuerbefehl bewegt den eigenen Player mit: wer "play bei 100" schickt,
// steht danach bei 100 und meldet das auch. Sonst widersprechen sich Befehl
// und Herzschlag, und das Relay glaubt zu Recht dem Herzschlag.
function steuern(c, action, position, url) {
  if (position != null) c.stelle = position;
  if (action === "pause") c.pausiert = true;
  if (action === "play") c.pausiert = false;
  c.send({ type: "control", key: KEY, action, position, url });
  melde(c, {});
}

// Eine gezielte Meldung geht durch denselben Kanal wie der Puls - sonst
// ueberschreiben sich beide gegenseitig.
function melde(c, werte) {
  c.zuletzt = Date.now();
  if (werte.position != null) c.stelle = werte.position;
  if (werte.paused != null) c.pausiert = werte.paused;
  if (werte.episode != null) c.folge = werte.episode;
  c.send({
    type: "here", key: KEY,
    position: c.stelle || 0,
    paused: Boolean(c.pausiert),
    season: 1, episode: c.folge,
    url: c.adresse,
    playerSessionId: `${c.deviceId}-e${c.folge}`
  });
}
// Ausbleibende Nachricht ist ein Befund, kein Abbruch.
const leer = { position: NaN, action: "(nichts)", url: "(nichts)", fehlt: true };
const hole = (c, passt, was, ms = 1500) => c.erwarte(passt, was, ms).catch(() => leer);

(async () => {
  const A = client("A/Host", "geraet-a");
  const B = client("B/Gast", "geraet-b");
  await Promise.all([A.offen(), B.offen()]);

  A.send({ type: "join", room: RAUM, name: "A", deviceId: A.deviceId });
  await A.erwarte((m) => m.type === "state", "state A");
  A.send({ type: "share", item: { key: KEY, url: URL1, title: "The Office", type: "serie", season: 1, episode: 1 } });
  await A.erwarte((m) => m.type === "state" && m.shared.length, "share");

  B.send({ type: "join", room: RAUM, name: "B", deviceId: B.deviceId });
  await B.erwarte((m) => m.type === "state" && m.shared.length, "state B");
  B.send({ type: "enter", key: KEY });
  await B.erwarte((m) => m.type === "state" && m.shared[0].memberIds.includes(B.deviceId), "enter B");

  pulsStarten(A, 1, URL1);
  await schlaf(150);
  pulsStarten(B, 1, URL1);
  const stand = await B.erwarte((m) => m.type === "state" && m.shared[0]?.hostId, "host");
  pruefe("Host ist A", stand.shared[0].hostId === A.deviceId, `hostId=${stand.shared[0].hostId}`);

  // --- 1. Host spielt bei 100 -------------------------------------------
  A.leeren(); B.leeren();
  steuern(A, "play", 100);
  const play = await B.erwarte((m) => m.type === "control" && m.action === "play", "play an B");
  pruefe("Gast bekommt play mit Host-Position", Math.abs(play.position - 100) < 0.01, `position=${play.position}`);

  // --- 2. Gast pausiert: alle muessen auf die Host-Zeit ------------------
  await schlaf(700);
  A.leeren(); B.leeren();
  steuern(B, "pause", 50);
  const pauseA = await hole(A, (m) => m.type === "control" && m.action === "pause", "pause an A");
  const pauseB = await hole(B, (m) => m.type === "control" && m.action === "pause", "pause-Echo an B");
  pruefe("Pause geht auch an den Ausloeser zurueck", !pauseB.fehlt, `position=${pauseB.position}`);
  pruefe("Pause nutzt Host-Zeit statt der 50s des Gastes", pauseA.position > 100 && pauseA.position < 103,
    `position=${pauseA.position.toFixed(2)}`);
  pruefe("Beide bekommen dieselbe Sekunde", Math.abs(pauseA.position - pauseB.position) < 0.001,
    `A=${pauseA.position.toFixed(2)} B=${pauseB.position.toFixed(2)}`);

  // --- 3. Sync-Knopf: anhalten, gleiche Zeit, gemeinsam starten ----------
  A.leeren(); B.leeren();
  B.send({ type: "syncall", key: KEY, position: 7 });
  const vorA = await hole(A, (m) => m.type === "syncprepare", "syncprepare A");
  const vorB = await hole(B, (m) => m.type === "syncprepare", "syncprepare B");
  pruefe("Sync bereitet beide auf dieselbe Stelle vor", Math.abs(vorA.position - vorB.position) < 0.001,
    `A=${vorA.position.toFixed(2)} B=${vorB.position.toFixed(2)}`);
  pruefe("Sync nimmt die Host-Zeit, nicht die 7s des Ausloesers", vorA.position > 100,
    `position=${vorA.position.toFixed(2)}`);

  A.send({ type: "syncready", key: KEY });
  B.send({ type: "syncready", key: KEY });
  const startA = await hole(A, (m) => m.type === "syncstart", "syncstart A");
  const startB = await hole(B, (m) => m.type === "syncstart", "syncstart B");
  pruefe("Beide bekommen den gemeinsamen Start", !startA.fehlt && !startB.fehlt, `position=${startA.position.toFixed(2)}`);
  pruefe("Start liegt auf der vorbereiteten Stelle", Math.abs(startA.position - vorA.position) < 0.001,
    `start=${startA.position.toFixed(2)} vorbereitet=${vorA.position.toFixed(2)}`);
  pruefe("Startzeit ist fuer beide dieselbe", startA.position === startB.position, "");

  // --- 4. Folgenwechsel: Abgleich muss danach noch antworten -------------
  A.leeren(); B.leeren();
  A.send({ type: "control", key: KEY, action: "navigate", position: 0, url: URL2 });
  pulsFolge(A, 2, URL2);
  await schlaf(120);
  pulsFolge(B, 2, URL2);
  const nav = await hole(B, (m) => m.type === "control" && m.action === "navigate", "navigate an B");
  pruefe("Gast erfaehrt die neue Folge", nav.url === URL2, nav.url);

  // Genau hier steht der Host am Anfang der neuen Folge und spielt noch nicht.
  // Ein Abgleich muss trotzdem antworten - "0" ist eine Auskunft.
  B.leeren();
  B.send({ type: "resync", key: KEY });
  const amAnfang = await B.erwarte((m) => m.type === "control" && m.resync, "resync am Folgenanfang", 1200)
    .catch(() => ({ fehler: "keine Antwort" }));
  pruefe("Abgleich antwortet, wenn der Host bei 0 steht", !amAnfang.fehler,
    amAnfang.fehler || `action=${amAnfang.action} position=${amAnfang.position}`);

  // Der Gast zieht nach und meldet dieselbe Adresse zurueck.
  B.send({ type: "control", key: KEY, action: "navigate", position: 0, url: URL2 });
  await schlaf(200);
  // Host spielt die neue Folge ab 0 an.
  steuern(A, "play", 0);
  await schlaf(900);

  B.leeren();
  B.send({ type: "resync", key: KEY });
  const antwort = await B.erwarte((m) => m.type === "control" && m.resync, "resync-Antwort", 1500)
    .catch(() => ({ fehler: "keine Antwort" }));
  pruefe("Abgleich antwortet auch am Folgenanfang", !antwort.fehler,
    antwort.fehler || `action=${antwort.action} position=${antwort.position.toFixed(2)}`);
  if (!antwort.fehler) {
    pruefe("Abgleich zeigt auf die neue Folge", antwort.url === URL2, antwort.url);
    pruefe("Abgleich rechnet die Laufzeit mit (nicht zurueck auf 0)",
      antwort.position > 0.5 && antwort.position < 4, `position=${antwort.position.toFixed(2)}`);
  }

  // --- 5. Leiste: wer steht wo -------------------------------------------
  A.leeren(); B.leeren();
  A.send({ type: "progress", key: KEY, progress: { url: URL2, position: 42, duration: 1200, progress: 3 } });
  const leiste = await B.erwarte((m) => m.type === "watchstate", "watchstate an B", 1500)
    .catch(() => null);
  pruefe("Leiste kommt beim anderen an", Boolean(leiste), leiste ? `${leiste.members.length} Geraete` : "keine Nachricht");
  if (leiste) {
    const a = leiste.members.find((m) => m.id === "geraet-a");
    const b = leiste.members.find((m) => m.id === "geraet-b");
    pruefe("Beide Geraete stehen drin", Boolean(a && b), leiste.members.map((m) => m.name).join(", "));
    pruefe("Gemeldete Sekunde kommt durch", a && Math.abs(a.position - 42) < 0.01, a ? `A=${a.position}` : "");
    pruefe("Host ist markiert", Boolean(a?.host) && !b?.host, `A.host=${a?.host} B.host=${b?.host}`);
  }

  // Pause muss alle als angehalten fuehren.
  B.leeren();
  steuern(A, "pause", 42);
  const nachPause = await B.erwarte((m) => m.type === "watchstate", "watchstate nach Pause", 1500)
    .catch(() => null);
  pruefe("Nach einer Pause stehen alle auf pausiert",
    Boolean(nachPause) && nachPause.members.every((m) => m.paused),
    nachPause ? nachPause.members.map((m) => `${m.name}:${m.paused ? "pause" : "laeuft"}`).join(" ") : "keine Nachricht");

  // --- 6. Hochrechnung darf nicht davonlaufen -----------------------------
  // Der Host meldet Play bei 500, sein Player steht nach dem Puffern aber
  // wirklich bei 300. Massgeblich ist, was der Player meldet - nicht die
  // Hochrechnung aus der letzten Steuerung.
  A.leeren(); B.leeren();
  steuern(A, "play", 500);
  await schlaf(300);
  // Der Player des Hosts meldet die Wahrheit: er steht bei 300.
  melde(A, { position: 300 });
  A.send({ type: "progress", key: KEY, progress: { url: URL2, position: 300, duration: 1200, progress: 25 } });
  await schlaf(300);
  B.leeren();
  B.send({ type: "resync", key: KEY });
  const frisch = await B.erwarte((m) => m.type === "control" && m.resync, "resync nach Fortschritt", 1500)
    .catch(() => ({ fehler: "keine Antwort" }));
  pruefe("Abgleich folgt dem Player des Hosts, nicht der Hochrechnung",
    !frisch.fehler && frisch.position > 299 && frisch.position < 303,
    frisch.fehler || `position=${frisch.position.toFixed(2)} (erwartet ~300, nicht ~500)`);

  // --- 7. Der Fall aus dem Screenshot ------------------------------------
  // A pausiert bei 79s und sagt das selbst; B laeuft bei 118s weiter.
  A.leeren(); B.leeren();
  melde(A, { position: 79, paused: true, episode: 2 });
  melde(B, { position: 118, paused: false, episode: 2 });
  await schlaf(1300);
  const letzte = [...Array(1)].map(() => null);
  // Auf die Meldung warten, in der beide Geraete ihren eigenen Wert tragen:
  // A's Pause geht sofort raus, B's reine Stellenmeldung wird gebuendelt.
  const eigen = await B.erwarte((m) => m.type === "watchstate"
    && m.members.some((x) => x.id === "geraet-a" && x.paused)
    && m.members.some((x) => x.id === "geraet-b" && Math.abs(x.position - 118) < 0.01),
  "Stand mit Pause und eigener Stelle", 2500).catch(() => null);
  const wa = eigen?.members.find((m) => m.id === "geraet-a");
  const wb = eigen?.members.find((m) => m.id === "geraet-b");
  pruefe("Jedes Geraet meldet seine eigene Sekunde",
    wa && wb && Math.abs(wa.position - 79) < 0.01 && Math.abs(wb.position - 118) < 0.01,
    wa && wb ? `A=${wa.position} B=${wb.position}` : "keine Nachricht");
  pruefe("Pausiert wird als pausiert gefuehrt", Boolean(wa?.paused) && !wb?.paused,
    wa ? `A.paused=${wa.paused} B.paused=${wb?.paused}` : "");
  pruefe("Die Folge steht am Geraet", wa?.episode === 2 && wb?.episode === 2,
    wa ? `A=S${wa.season}E${wa.episode} B=S${wb?.season}E${wb?.episode}` : "");
  void letzte;

  // --- 8. Folgenwechsel muss die Runde umstellen -------------------------
  const URL3 = "https://s.to/serie/stream/the-office/staffel-1/episode-3";
  A.leeren(); B.leeren();
  A.send({ type: "control", key: KEY, action: "navigate", position: 0, url: URL3 });
  pulsFolge(A, 3, URL3);
  await schlaf(120);
  pulsFolge(B, 3, URL3);
  const neuerZustand = await B.erwarte((m) => m.type === "state"
    && m.shared[0]?.episode === 3, "Zustand mit Folge 3", 2000).catch(() => null);
  pruefe("Die Runde steht nach dem Wechsel auf der neuen Folge",
    Boolean(neuerZustand),
    neuerZustand ? `S${neuerZustand.shared[0].season}E${neuerZustand.shared[0].episode}` : "Folge blieb stehen");

  // --- 9. Zustandswechsel darf nicht auf die Drosselung warten -----------
  // Erst eine reine Stellenmeldung, damit die Drosselung frisch geladen ist.
  A.leeren(); B.leeren();
  melde(A, { position: 200, paused: false, episode: 3 });
  await B.erwarte((m) => m.type === "watchstate", "erste Standmeldung", 1500).catch(() => null);

  // Direkt danach die Pause: sie muss durch, nicht bis zum naechsten Buendel warten.
  B.leeren();
  const losGeschickt = Date.now();
  melde(A, { position: 201, paused: true, episode: 3 });
  const sofort = await B.erwarte((m) => m.type === "watchstate"
    && m.members.some((x) => x.id === "geraet-a" && x.paused), "Pause sofort", 1500).catch(() => null);
  const gebraucht = Date.now() - losGeschickt;
  pruefe("Eine Pause kommt ohne Drosselung durch", Boolean(sofort) && gebraucht < 250,
    sofort ? `${gebraucht} ms` : "kam nicht an");

  // Eine reine Stellenmeldung darf dagegen gebuendelt werden.
  B.leeren();
  const zweiter = Date.now();
  melde(A, { position: 202, paused: true, episode: 3 });
  const spaeter = await B.erwarte((m) => m.type === "watchstate"
    && m.members.some((x) => x.id === "geraet-a" && Math.abs(x.position - 202) < 0.01), "Stelle gebuendelt", 2500)
    .catch(() => null);
  pruefe("Eine reine Stellenmeldung wird gebuendelt", Boolean(spaeter) && Date.now() - zweiter > 200,
    spaeter ? `${Date.now() - zweiter} ms` : "kam nicht an");

  // --- 10. Keine fremde Uhr in der Anzeige --------------------------------
  A.leeren(); B.leeren();
  melde(A, { position: 300, paused: false, episode: 3 });
  const mitAlter = await B.erwarte((m) => m.type === "watchstate"
    && m.members.some((x) => x.id === "geraet-a" && Math.abs(x.position - 300) < 0.01), "Stand mit Alter", 2000)
    .catch(() => null);
  const wert = mitAlter?.members.find((m) => m.id === "geraet-a");
  pruefe("Das Relay liefert das Alter fertig mit", wert && typeof wert.age === "number",
    wert ? `age=${wert.age}` : "keine Nachricht");
  pruefe("Das Alter ist frisch, nicht die Differenz zweier Uhren",
    wert && wert.age >= 0 && wert.age < 2, wert ? `age=${wert.age.toFixed(3)} s` : "");
  pruefe("Kein roher Zeitstempel des Relays mehr dabei", wert && wert.at === undefined,
    wert ? `at=${wert.at}` : "");

  // --- 11. Folgenwechsel darf nicht in eine Pause laufen ------------------
  const URL4 = "https://s.to/serie/stream/the-office/staffel-1/episode-4";
  A.leeren(); B.leeren();
  A.send({ type: "control", key: KEY, action: "navigate", position: 0, url: URL4 });
  pulsFolge(A, 4, URL4);
  await schlaf(120);
  pulsFolge(B, 4, URL4);
  await schlaf(250);
  B.leeren();
  B.send({ type: "resync", key: KEY });
  const nachWechsel = await B.erwarte((m) => m.type === "control" && m.resync, "Abgleich nach Wechsel", 1500)
    .catch(() => ({ fehler: "keine Antwort" }));
  pruefe("Der Abgleich nach einem Folgenwechsel pausiert nicht",
    !nachWechsel.fehler && nachWechsel.action !== "pause",
    nachWechsel.fehler || `action=${nachWechsel.action} position=${nachWechsel.position}`);

  // --- 12. Stehengebliebenes Geraet wird geholt ---------------------------
  // Die Runde laeuft (Host spielt), B meldet sich als pausiert.
  A.leeren(); B.leeren();
  steuern(A, "play", 10);
  await schlaf(200);
  B.leeren();
  melde(B, { position: 10, paused: true, episode: 4 });
  const geholt = await B.erwarte((m) => m.type === "control" && m.action === "play" && m.resync,
    "Nachgereichtes Play", 1500).catch(() => null);
  pruefe("Wer stehen bleibt, waehrend die Runde laeuft, bekommt ein Play",
    Boolean(geholt), geholt ? `position=${geholt.position.toFixed(2)}` : "kam nicht");

  // Aber nicht im Sekundentakt dagegenhaemmern.
  B.leeren();
  melde(B, { position: 10, paused: true, episode: 4 });
  const nochmal = await B.erwarte((m) => m.type === "control" && m.action === "play" && m.resync,
    "Zweites Play", 800).catch(() => null);
  pruefe("Nachgereicht wird nicht im Sekundentakt", !nochmal, nochmal ? "kam sofort wieder" : "wartet ab");

  // --- 13. Alle richten sich nach der echten Stelle des Hosts -------------
  // Der Host meldet 640 aus seinem Player, seine letzte Steuerung sagt 600.
  // Massgeblich muss die Meldung aus dem Player sein - danach springt niemand
  // beim Host, sondern alle zu ihm.
  A.leeren(); B.leeren();
  steuern(A, "play", 600);
  await schlaf(250);
  melde(A, { position: 640, paused: false, episode: 4 });
  await schlaf(250);
  B.leeren();
  B.send({ type: "resync", key: KEY });
  const amHost = await B.erwarte((m) => m.type === "control" && m.resync, "Abgleich auf Host-Player", 1500)
    .catch(() => ({ fehler: "keine Antwort" }));
  pruefe("Der Abgleich nimmt die Stelle aus dem Player des Hosts",
    !amHost.fehler && amHost.position > 639 && amHost.position < 642,
    amHost.fehler || `position=${amHost.position.toFixed(2)} (erwartet ~640, nicht ~600)`);

  // --- 14. Jede Pause richtet alle exakt auf den Host aus -----------------
  // Die Runde laeuft. Der Gast pausiert - alle halten sofort an. Danach meldet
  // der Host-Player seine echte Stelle, und die gilt auf die Millisekunde.
  A.leeren(); B.leeren();
  steuern(A, "play", 800);
  await schlaf(200);
  A.leeren(); B.leeren();
  steuern(B, "pause", 777);
  const haltA = await hole(A, (m) => m.type === "control" && m.action === "pause", "Pause an Host");
  pruefe("Alle halten sofort an, ohne auf den Host zu warten", !haltA.fehlt,
    haltA.fehlt ? "kam nicht" : `position=${haltA.position.toFixed(2)}`);

  // Jetzt meldet der Host-Player seine echte Stelle: 800.42.
  B.leeren();
  melde(A, { position: 800.42, paused: true, episode: 4 });
  const genau = await B.erwarte((m) => m.type === "control" && m.action === "seek",
    "Ausrichtung auf die Host-Stelle", 1500).catch(() => null);
  pruefe("Nach der Pause ruecken alle exakt auf die Stelle des Hosts",
    genau && Math.abs(genau.position - 800.42) < 0.001,
    genau ? `position=${genau.position}` : "keine Ausrichtung");

  // Der Host selbst bekommt keinen Sprungbefehl.
  const anHost = await A.erwarte((m) => m.type === "control" && m.action === "seek", "Sprung an Host", 700)
    .catch(() => null);
  pruefe("Der Host bekommt dabei keinen Sprung", !anHost, anHost ? "er wurde gesprungen" : "bleibt stehen");

  // Und nur einmal je Pause, nicht bei jedem Herzschlag.
  B.leeren();
  melde(A, { position: 800.42, paused: true, episode: 4 });
  const nochmalGenau = await B.erwarte((m) => m.type === "control" && m.action === "seek", "zweite Ausrichtung", 800)
    .catch(() => null);
  pruefe("Ausgerichtet wird einmal je Pause", !nochmalGenau, nochmalGenau ? "kam erneut" : "nur einmal");

  for (const timer of pulse) clearInterval(timer);
  A.socket.close();
  B.socket.close();

  const fehler = pruefungen.filter((p) => !p.ok);
  console.log(`\n${pruefungen.length - fehler.length}/${pruefungen.length} bestanden`);
  process.exit(fehler.length ? 1 : 0);
})().catch((fehler) => {
  console.error("Testlauf abgebrochen:", fehler.message);
  process.exit(2);
});
