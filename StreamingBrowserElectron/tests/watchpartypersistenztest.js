"use strict";

// Ein Raumzustand ist nur fuer genau den Raum verbindlich, dessen Relay ihn
// bestaetigt hat. Startzustand, Teilausfall und der automatische Wiederbeitritt
// duerfen die lokale Vorlage der anderen Raeume nicht leeren.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { Watchparty } = require("../src/watchparty");

const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
function funktion(name) {
  const start = main.search(new RegExp(`function ${name}\\(`));
  assert.ok(start >= 0, `${name} fehlt`);
  return main.slice(start, main.indexOf("\n}", start) + 2);
}

const rooms = ["Bangus", "losti", "test", "Gummikaese"];
const alt = {
  shared: rooms.map((room, index) => ({ key: `serie:${index}`, room, title: `Titel ${index}` })),
  joined: rooms.map((room, index) => ({ key: `serie:${index}`, room }))
};
const speicher = vm.createContext({});
vm.runInContext([
  funktion("watchpartyOperationsZeit"),
  funktion("watchpartyOperationenLesen"),
  funktion("watchpartyZustandAusEintraegen"),
  funktion("watchpartyZustandFuerSpeicher")
].join("\n"), speicher);

const rechnen = (eintraege, eingerichtet, bestaetigt, bisher = alt) => {
  const wert = speicher.watchpartyZustandFuerSpeicher(
    eintraege, bisher, new Set(eingerichtet), new Set(bestaetigt)
  );
  return { shared: [...wert.shared], joined: [...wert.joined] };
};
const keys = (liste) => liste.map((e) => `${e.room}|${e.key}`).sort();

// Der synthetische Leerzustand beim Konfigurieren und ein langsamer Start sind
// keine Relay-Antwort. Auch nach mehr als sechs Sekunden bleibt alles erhalten.
let ergebnis = rechnen([], rooms, []);
assert.deepEqual(keys(ergebnis.shared), keys(alt.shared));
assert.deepEqual(keys(ergebnis.joined), keys(alt.joined));

// Nur Bangus hat geantwortet. Sein Zustand wird ersetzt; die drei anderen
// Verbindungen bleiben aus ihrer lokalen Vorlage erhalten.
const bangus = [{
  key: "serie:neu", room: "Bangus", mine: true, joined: true,
  url: "https://s.to/serie/stream/neu", title: "Neu"
}];
ergebnis = rechnen(bangus, rooms, ["Bangus"]);
assert.deepEqual(keys(ergebnis.shared), [
  "Bangus|serie:neu", "Gummikaese|serie:3", "losti|serie:1", "test|serie:2"
].sort());
assert.deepEqual(keys(ergebnis.joined), [
  "Bangus|serie:neu", "Gummikaese|serie:3", "losti|serie:1", "test|serie:2"
].sort());

// Ein gueltiger leerer Zustand ist fuer seinen bestaetigten Raum verbindlich.
ergebnis = rechnen(bangus, rooms, ["Bangus", "losti"]);
assert.ok(!keys(ergebnis.shared).some((key) => key.startsWith("losti|")));
assert.ok(!keys(ergebnis.joined).some((key) => key.startsWith("losti|")));
assert.ok(keys(ergebnis.joined).includes("test|serie:2"), "unbestaetigter Raum ging verloren");

// Aus den Einstellungen entfernte Raeume bleiben nicht als ewige Vorlage
// liegen, selbst wenn ihre letzte Verbindung nie mehr antwortet.
ergebnis = rechnen([], rooms.slice(0, 3), []);
assert.ok(!keys(ergebnis.shared).some((key) => key.startsWith("Gummikaese|")));
assert.ok(!keys(ergebnis.joined).some((key) => key.startsWith("Gummikaese|")));

// Verlassen ist eine ausdrueckliche Aenderung: Der bestaetigte Raum bleibt
// geteilt, aber seine lokale Wiederbeitrittsvorlage wird entfernt.
const verlassen = [{ ...bangus[0], joined: false }];
ergebnis = rechnen(verlassen, rooms, ["Bangus"]);
assert.ok(keys(ergebnis.shared).includes("Bangus|serie:neu"));
assert.ok(!keys(ergebnis.joined).some((key) => key.startsWith("Bangus|")));

// Ein lokaler Join/Leave mit Operation wartet auf seine Socket-Barriere. Ein
// noch davor eingetroffener Relay-Snapshot darf den Wunsch nicht umkehren.
const offenJoin = {
  shared: [], joined: [{ key: "serie:join", room: "Bangus", at: Date.now() }],
  left: [], roomOps: []
};
ergebnis = rechnen([], rooms, [], offenJoin);
assert.deepEqual(keys(ergebnis.joined), ["Bangus|serie:join"]);
const offenLeave = {
  shared: [], joined: [],
  left: [{ key: "serie:leave", room: "Bangus", at: Date.now() }], roomOps: []
};
ergebnis = rechnen([{ key: "serie:leave", room: "Bangus", joined: true }], rooms, [], offenLeave);
assert.deepEqual(keys(ergebnis.joined), []);

// Beim ersten gueltigen Zustand wird ein bekannter Beitritt nachgetragen. Er
// bleibt bis zur darauf folgenden Relay-Antwort unbestaetigt und damit sicher.
const gesendet = [];
const gespeichert = [];
let barriereFertig = null;
const barriereCallbacks = [];
const beitritte = Array.from({ length: 8 }, (_, index) => ({
  key: `serie:${index}`, room: "Bangus"
}));
const raumzustand = beitritte.map((eintrag) => ({ ...eintrag, joined: false }));
const wiederbeitritt = vm.createContext({
  watchpartyLokal: { shared: [], joined: beitritte },
  watchpartyWiederhergestellt: new Set(),
  watchpartyZustandBestaetigt: new Set(),
  watchpartyWiederherstellungsBarrieren: new Map(),
  watchpartyBarriereNummer: 0,
  watchpartyShared: raumzustand,
  watchparty: {
    status: () => ({ rooms: [{ room: "Bangus", connected: true }] }),
    teilen: () => gesendet.push("share"),
    beitreten: (key, room) => gesendet.push(`enter:${room}|${key}`),
    verlassen: (key, room) => gesendet.push(`leave:${room}|${key}`),
    barriere: (room, fertig) => {
      gesendet.push(`barriere:${room}`);
      barriereFertig = fertig;
      barriereCallbacks.push(fertig);
      return true;
    }
  },
  rememberWatchpartyState: (eintraege) => gespeichert.push(eintraege),
  raeumeWatchpartyEintraegeAuf: () => gespeichert.push("aufgeraeumt"),
  console
});
vm.runInContext([
  funktion("offeneWatchpartyWiederherstellung"),
  funktion("restoreWatchparty"),
  funktion("bestaetigeWatchpartyZustand"),
  funktion("watchpartyRaumBarriereStarten")
].join("\n"), wiederbeitritt);

let phase = wiederbeitritt.restoreWatchparty(raumzustand, "Bangus");
wiederbeitritt.bestaetigeWatchpartyZustand("Bangus", phase);
assert.deepEqual(gesendet.filter((eintrag) => eintrag.startsWith("enter:")),
  beitritte.map((eintrag) => `enter:Bangus|${eintrag.key}`));
assert.equal(gesendet.filter((eintrag) => eintrag === "barriere:Bangus").length, 1);
assert.equal(wiederbeitritt.watchpartyZustandBestaetigt.has("Bangus"), false,
  "erster Zustand wurde vor der Wiederbeitrittsantwort gespeichert");

// Nur die erste der acht Antworten kommt vor einem Verbindungsabbruch an.
// Sie darf die sieben noch offenen Vorlagen nicht aus dem Speicher raeumen.
phase = wiederbeitritt.restoreWatchparty(raumzustand.map((eintrag, index) => ({
  ...eintrag, joined: index === 0
})), "Bangus");
wiederbeitritt.bestaetigeWatchpartyZustand("Bangus", phase);
assert.equal(phase.offen, 7);
assert.equal(wiederbeitritt.watchpartyZustandBestaetigt.has("Bangus"), false,
  "erste von acht Antworten bestaetigte den ganzen Raum");

// Ist diese erste Antwort zugleich der letzte Zustand vor der geordneten
// Rundlauf-Quittung, wurden die anderen sieben Befehle vom Relay absichtlich
// verworfen (fehlender Titel/Grabstein). Erst jetzt darf genau dieser Snapshot
// dauerhaft werden; sonst bliebe der Raum fuer immer unbestaetigt.
wiederbeitritt.watchpartyShared = raumzustand.map((eintrag, index) => ({
  ...eintrag, joined: index === 0
}));
assert.equal(typeof barriereFertig, "function");
barriereFertig();
assert.equal(wiederbeitritt.watchpartyZustandBestaetigt.has("Bangus"), true,
  "Tombstones blieben nach der Relay-Barriere ewig offen");
assert.equal(gespeichert[0], wiederbeitritt.watchpartyShared);

// Auch ohne die Barriere bestaetigt ein vollstaendiger Snapshot unmittelbar.
wiederbeitritt.watchpartyZustandBestaetigt.delete("Bangus");

phase = wiederbeitritt.restoreWatchparty(raumzustand.map((eintrag) => ({
  ...eintrag, joined: true
})), "Bangus");
wiederbeitritt.bestaetigeWatchpartyZustand("Bangus", phase);
assert.equal(wiederbeitritt.watchpartyZustandBestaetigt.has("Bangus"), true,
  "Wiederbeitrittsantwort bestaetigte den Raum nicht");

// Ein offline gesetzter Leave-Tombstone wird beim Wiederverbinden aktiv ans
// Relay nachgetragen. Ein alter joined-Snapshot bleibt bis zur Ack-Barriere
// unbestaetigt und kann den Benutzerwunsch nicht wieder umkehren.
wiederbeitritt.watchpartyLokal = {
  shared: [], joined: [],
  left: [{ room: "Bangus", key: "serie:alt", at: Date.now() }], roomOps: []
};
wiederbeitritt.watchpartyWiederhergestellt.delete("Bangus");
wiederbeitritt.watchpartyZustandBestaetigt.delete("Bangus");
wiederbeitritt.watchpartyWiederherstellungsBarrieren.clear();
gesendet.length = 0;
phase = wiederbeitritt.restoreWatchparty([
  { room: "Bangus", key: "serie:alt", joined: true }
], "Bangus");
wiederbeitritt.bestaetigeWatchpartyZustand("Bangus", phase);
assert.ok(gesendet.includes("leave:Bangus|serie:alt"));
assert.equal(wiederbeitritt.watchpartyZustandBestaetigt.has("Bangus"), false);

// Zwei schnelle gegensaetzliche Benutzeraktionen bekommen je eine Barriere.
// Der Ack der ersten darf die inzwischen neuere Absicht nicht bestaetigen.
wiederbeitritt.watchpartyWiederherstellungsBarrieren.clear();
wiederbeitritt.watchpartyZustandBestaetigt.delete("Bangus");
const vorherCallbacks = barriereCallbacks.length;
wiederbeitritt.watchpartyRaumBarriereStarten("Bangus", true);
wiederbeitritt.watchpartyRaumBarriereStarten("Bangus", true);
const ersteGeneration = barriereCallbacks[vorherCallbacks];
const zweiteGeneration = barriereCallbacks[vorherCallbacks + 1];
const vorherGespeichert = gespeichert.length;
ersteGeneration();
assert.equal(wiederbeitritt.watchpartyZustandBestaetigt.has("Bangus"), false,
  "alte Aktionsbarriere bestaetigte den neueren Benutzerwunsch");
assert.equal(gespeichert.length, vorherGespeichert);
zweiteGeneration();
assert.equal(wiederbeitritt.watchpartyZustandBestaetigt.has("Bangus"), true);

// Die Barriere selbst ist korreliert: Eine normale Uhrprobe kann sie nicht
// versehentlich ausloesen, und beim Trennen wird sie verworfen. Nur die exakt
// passende negative Zeitmarke quittiert die vorangegangenen Befehle.
function barrierenClient() {
  const ausgang = [];
  const client = new Watchparty();
  client.verbunden = true;
  client.identitaetBestaetigt = true;
  client.socket = {
    readyState: 1,
    send: (daten) => ausgang.push(JSON.parse(daten)),
    close: () => {}
  };
  return { client, ausgang };
}

let quittiert = 0;
let probe = barrierenClient();
assert.equal(probe.client.barriere(() => { quittiert += 1; }), true);
const marke = probe.ausgang[0].t0;
assert.ok(marke < 0);
probe.client.uhrAntwort({ t0: Date.now(), t1: Date.now() });
assert.equal(quittiert, 0, "normale Uhrprobe loeste Restore-Barriere aus");
probe.client.trennen();
probe.client.uhrAntwort({ t0: marke, t1: Date.now() });
assert.equal(quittiert, 0, "abgebrochene Verbindung bestaetigte Restore spaeter");
assert.equal(probe.client.uhrProben.length, 0,
  "veraltete Barrierenmarke verfaelschte die Uhrmessung");

probe = barrierenClient();
probe.client.barriere(() => { quittiert += 1; });
probe.client.uhrAntwort({ t0: probe.ausgang[0].t0, t1: Date.now() });
assert.equal(quittiert, 1, "passende Relay-Barriere wurde nicht quittiert");

// Der Geraeteabgleich ist ab Version 2 je Mitgliedschaft kausal. Alte
// Gesamtschnappschuesse duerfen hinzufuegen, aber durch blosses Fehlen nichts
// mehr entfernen. Explizite Tombstones und Rejoins gewinnen per Zeitstempel.
const konto = vm.createContext({ Date });
vm.runInContext([
  funktion("watchpartyOperationsZeit"),
  funktion("watchpartyOperationenLesen"),
  funktion("watchpartyKontostaendeVereinen")
].join("\n"), konto);
const lokalFuenf = {
  rooms: ["Bangus"], roomOps: [], left: [],
  joined: Array.from({ length: 5 }, (_, index) => ({ room: "Bangus", key: `serie:${index}` }))
};
let vereinigt = konto.watchpartyKontostaendeVereinen(lokalFuenf, { rooms: [], joined: [] });
assert.equal(vereinigt.joined.length, 5, "alter Leersnapshot loeschte wiederhergestellte Beitritte");
assert.deepEqual([...vereinigt.rooms], ["Bangus"], "alter Leersnapshot loeschte den Raum");

const basis = Date.now() - 1000;
vereinigt = konto.watchpartyKontostaendeVereinen(lokalFuenf, {
  version: 2,
  rooms: ["Bangus"],
  joined: [{ room: "Bangus", key: "serie:neu", at: basis }],
  left: [{ room: "Bangus", key: "serie:1", at: basis + 1 }]
});
assert.ok(keys(vereinigt.joined).includes("Bangus|serie:neu"));
assert.ok(!keys(vereinigt.joined).includes("Bangus|serie:1"));

// Ein spaeterer Legacy-Client kennt den Tombstone nicht und sendet den alten
// Join erneut. Additions-only darf ihn nicht wiederbeleben.
vereinigt = konto.watchpartyKontostaendeVereinen(vereinigt, {
  rooms: ["Bangus"], joined: [{ room: "Bangus", key: "serie:1" }]
});
assert.ok(!keys(vereinigt.joined).includes("Bangus|serie:1"));

// Ein neuer, wirklich ausdruecklicher Rejoin ist dagegen eine juengere
// positive Operation und hebt den Tombstone auf.
vereinigt = konto.watchpartyKontostaendeVereinen(vereinigt, {
  version: 2, rooms: ["Bangus"],
  joined: [{ room: "Bangus", key: "serie:1", at: basis + 2 }], left: []
});
assert.ok(keys(vereinigt.joined).includes("Bangus|serie:1"));

// Bei exakt gleichem Zeitstempel gewinnt Leave deterministisch. Unbrauchbare
// Operationen werden ignoriert, statt einen gueltigen Stand zu loeschen.
vereinigt = konto.watchpartyKontostaendeVereinen({
  rooms: ["Bangus"], joined: [{ room: "Bangus", key: "gleich", at: basis }]
}, {
  rooms: ["Bangus"], left: [
    { room: "Bangus", key: "gleich", at: basis },
    { room: "Bangus", key: "kaputt", at: "morgen" }
  ], joined: [{ room: "Bangus", key: "kaputt" }]
});
assert.ok(!keys(vereinigt.joined).includes("Bangus|gleich"));
assert.ok(keys(vereinigt.joined).includes("Bangus|kaputt"));

vereinigt = konto.watchpartyKontostaendeVereinen({
  rooms: ["Bangus"], roomOps: [], joined: lokalFuenf.joined, left: []
}, {
  rooms: [], roomOps: [{ room: "Bangus", present: false, at: basis }], joined: []
});
assert.deepEqual([...vereinigt.rooms], []);
assert.deepEqual([...vereinigt.joined], []);
vereinigt = konto.watchpartyKontostaendeVereinen(vereinigt, {
  rooms: ["Bangus"], roomOps: [{ room: "Bangus", present: true, at: basis + 1 }], joined: []
});
assert.deepEqual([...vereinigt.rooms], ["Bangus"]);
assert.deepEqual([...vereinigt.joined], [], "Raum-Rejoin belebte alte Mitgliedschaften wieder");

// Lokale Operationen sind auch bei rueckwaerts gehender Uhr strikt monoton:
// der neue Wunsch liegt mindestens eine Einheit ueber dem bekannten Gegenwert.
const monotonic = vm.createContext({
  Date,
  watchpartyLokal: {
    joined: [{ room: "Bangus", key: "uhr", at: basis + 10 }], left: []
  }
});
vm.runInContext([
  funktion("watchpartyOperationsZeit"),
  funktion("watchpartyMitgliedschaftLokalSetzen")
].join("\n"), monotonic);
assert.equal(monotonic.watchpartyMitgliedschaftLokalSetzen("uhr", "Bangus", false, basis), true);
assert.equal(monotonic.watchpartyLokal.left[0].at, basis + 11);

// Der echte main-Callback darf den lokalen Fuenferstand durch einen alten
// leeren Kontosatz nicht ersetzen. Er plant aber eine Gegenmeldung, damit der
// Geraete-Spiegel den vereinigten Stand wieder zum alten Client traegt.
const kontoMain = vm.createContext({
  Date, JSON,
  settings: { watchparty: { rooms: ["Bangus"] } },
  watchpartyLokal: { ...lokalFuenf, shared: [] },
  watchpartyWiederhergestellt: new Set(["Bangus"]),
  watchpartyZustandBestaetigt: new Set(["Bangus"]),
  gespeichert: 0, synchronisiert: 0, geplant: 0, verlassen: [], barrieren: [],
  saveSettings: () => {},
  saveWatchpartyLocal: () => { kontoMain.gespeichert += 1; },
  syncWatchparty: () => { kontoMain.synchronisiert += 1; },
  restoreWatchpartyJetzt: () => {},
  watchpartyRaumBarriereStarten: (room) => kontoMain.barrieren.push(room),
  geraeteAbgleichSpaeter: () => { kontoMain.geplant += 1; },
  watchparty: { verlassen: (key, room) => kontoMain.verlassen.push(`${room}|${key}`) },
  console: { log: () => {} }
});
vm.runInContext([
  funktion("watchpartyOperationsZeit"),
  funktion("watchpartyOperationenLesen"),
  funktion("watchpartyKontostaendeVereinen"),
  funktion("uebernimmGeraeteWatchparty")
].join("\n"), kontoMain);
assert.equal(kontoMain.uebernimmGeraeteWatchparty({ rooms: [], joined: [] }, basis), false);
assert.equal(kontoMain.watchpartyLokal.joined.length, 5);
assert.equal(kontoMain.gespeichert, 0);
assert.equal(kontoMain.geplant, 1, "vereinigter Satz wurde nicht zurueckgemeldet");

assert.equal(kontoMain.uebernimmGeraeteWatchparty({
  version: 2, rooms: ["Bangus"], joined: [],
  left: [{ room: "Bangus", key: "serie:1", at: basis }]
}, basis), true);
assert.ok(!keys(kontoMain.watchpartyLokal.joined).includes("Bangus|serie:1"));
assert.deepEqual([...kontoMain.verlassen], ["Bangus|serie:1"]);
assert.ok(kontoMain.barrieren.includes("Bangus"));

console.log("OK Watchparty-Persistenz: vier Raeume, Teilausfall, Leerzustand und Wiederbeitritt");
