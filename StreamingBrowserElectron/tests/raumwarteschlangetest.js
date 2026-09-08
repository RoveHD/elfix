"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { AbstimmungsWarteschlange } = require("../../sync-server/warteschlange");

const warten = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const item = (key) => ({ key, url: `https://example.test/${key}`, title: key });
const actor = (id, konto = "") => ({
  principal: konto ? `konto:${konto}` : `geraet:${id}`, id, name: id
});

function queue(optionen = {}) {
  return new AbstimmungsWarteschlange({
    art: "title",
    saeubern: (wert) => wert && wert.key && wert.url ? item(String(wert.key)) : null,
    schluessel: (wert) => wert.key,
    ...optionen
  });
}

(async () => {
  const relayQuelle = fs.readFileSync(path.join(__dirname, "../../sync-server/server.js"), "utf8");
  assert.match(relayQuelle, /\^\[a-z\]\[a-z0-9:-\]\{0,31\}\$/,
    "Relay-Validator liess namespaced queue:-Nachrichten nicht durch");
  const a = actor("a", "konto-a");
  const a2 = actor("a2", "konto-a");
  const b = actor("b");
  const q = queue();

  assert.equal(q.vorschlagen(item("eins"), a).ok, true);
  const revNachVorschlag = q.rev;
  assert.equal(q.vorschlagen(item("eins"), a2).unchanged, true,
    "dasselbe Konto durfte nicht doppelt vorschlagen/abstimmen");
  assert.equal(q.rev, revNachVorschlag, "idempotenter Vorschlag erhoehte die Revision");
  const id = q.zustand(a).selectedId;
  // Ein Vorschlag ist noch keine Stimme: wer drei gewichtete Stimmen hat, soll
  // selbst entscheiden, ob und wie schwer er den eigenen Vorschlag waehlt.
  assert.equal(q.zustand(a).items[0].votes, 0, "der Vorschlag vergab schon eine Stimme");
  assert.equal(q.zustand(a).items[0].myVote, 0);
  assert.equal(q.zustand(a).items[0].voted, false);

  assert.equal(q.abstimmen(id, true, b).ok, true);
  // Ohne ausdrueckliches Gewicht gilt die leichteste freie Stimme.
  assert.equal(q.zustand(b).items[0].myVote, 1);
  assert.equal(q.zustand(a).items[0].votes, 1);
  assert.equal(q.zustand(a).items[0].voters, 1);
  assert.equal(q.zustand(a).items[0].voted, false, "die Stimme des anderen war nicht die eigene");
  assert.equal(q.zustand(b).items[0].mine, false);
  assert.equal(JSON.stringify(q.zustand(a)).includes("konto-a"), false,
    "Kontofingerabdruck wurde nach aussen getragen");
  const revNachStimme = q.rev;
  assert.equal(q.abstimmen(id, 1, b).unchanged, true);
  assert.equal(q.rev, revNachStimme, "idempotente Stimme erhoehte die Revision");

  // Drei Gewichte je Person, jedes genau einmal, je Vorschlag hoechstens eines.
  assert.deepEqual(q.zustand(b).freeWeights, [3, 2], "die vergebene Eins galt noch als frei");
  assert.equal(q.abstimmen(id, 3, b).gewicht, 3, "das Gewicht liess sich nicht anheben");
  assert.equal(q.zustand(a).items[0].votes, 3, "das alte Gewicht blieb zusaetzlich liegen");
  assert.deepEqual(q.zustand(b).freeWeights, [2, 1]);

  assert.equal(q.vorschlagen(item("zwei"), a).ok, true);
  const zweiterId = q.zustand(a).items.find((eintrag) => eintrag.id !== id).id;
  assert.equal(q.abstimmen(zweiterId, 3, b).gewicht, 3);
  const nachUmzug = q.zustand(b);
  assert.equal(nachUmzug.items.find((eintrag) => eintrag.id === id).votes, 0,
    "das Dreier lag danach doppelt");
  assert.equal(nachUmzug.items.find((eintrag) => eintrag.id === zweiterId).votes, 3);
  assert.equal(nachUmzug.items[0].id, zweiterId, "die Liste ordnete nicht nach Punkten");

  // Alle drei vergeben, dann ist Schluss.
  assert.equal(q.abstimmen(id, 2, b).gewicht, 2);
  assert.equal(q.abstimmen(id, 1, b).gewicht, 1, "je Vorschlag zaehlt eine Stimme, das Gewicht wandert");
  assert.equal(q.zustand(b).items.find((eintrag) => eintrag.id === id).votes, 1);
  assert.deepEqual(q.zustand(b).freeWeights, [2]);
  assert.equal(q.abstimmen(id, false, b).ok, true);
  assert.deepEqual(q.zustand(b).freeWeights, [2, 1]);

  // Und zurueck auf einen Vorschlag mit einer Stimme, damit die Faelle darunter
  // von derselben Ausgangslage ausgehen wie bisher.
  assert.equal(q.entfernen(zweiterId, a).ok, true);
  assert.equal(q.abstimmen(id, 1, b).gewicht, 1);
  assert.equal(q.zustand(a).selectedId, id);

  assert.equal(q.starten("falsch", { fromKey: "alt" }, new Set(["a", "b"]), a).reason,
    "selection-changed");
  assert.equal(q.zustand(a).items.length, 1, "CAS-Fehler verbrauchte den Eintrag");

  let starts = 0;
  let ready = 0;
  const abbrueche = [];
  let letzterGrund = "";
  const streng = queue({
    fristMs: 30,
    onChange: (grund) => { letzterGrund = grund; },
    onStart: () => { starts += 1; },
    onCancel: (pending, grund) => { abbrueche.push({ startId: pending.startId, grund, targets: [...pending.targets] }); },
    onReady: (_pending, ids) => { ready += 1; assert.deepEqual([...ids].sort(), ["a", "b"]); }
  });
  streng.vorschlagen(item("zwei"), a);
  const strengId = streng.zustand(a).selectedId;
  const start = streng.starten(strengId, { fromKey: "alt" }, new Set(["a", "b"]), a);
  assert.equal(start.ok, true);
  const startNachricht = streng.startNachricht(a);
  assert.equal(startNachricht.startId, start.startId);
  assert.ok(startNachricht.at > 0 && startNachricht.expiresAt > startNachricht.at,
    "Startnachricht enthielt keine belastbare Ladefrist");
  assert.equal(starts, 1);
  streng.gestartet(start.startId, true, "a");
  assert.equal(ready, 0, "ein bereites Geraet startete die Gruppe vorzeitig");
  await warten(45);
  assert.equal(ready, 0, "ein haengendes Geraet wurde beim Fristablauf uebersprungen");
  assert.equal(streng.zustand(a).items.length, 1, "Fristablauf legte den Eintrag nicht zurueck");
  assert.equal(letzterGrund, "lease-expired");
  assert.deepEqual(abbrueche, [{ startId: start.startId, grund: "lease-expired", targets: ["a", "b"] }],
    "Fristablauf meldete den betroffenen Startkreis nicht ab");

  const abgelehnt = queue({ onCancel: (pending, grund) => abbrueche.push({ startId: pending.startId, grund }) });
  abgelehnt.vorschlagen(item("nack"), a);
  const nackStart = abgelehnt.starten(abgelehnt.zustand(a).selectedId, { fromKey: "alt" }, new Set(["a", "b"]), a);
  abgelehnt.gestartet(nackStart.startId, true, "a");
  abgelehnt.gestartet(nackStart.startId, false, "b");
  assert.equal(abbrueche.at(-1).grund, "start-failed", "NACK loeste keinen gezielten Abbruch aus");
  assert.equal(abgelehnt.zustand(a).items.length, 1, "NACK legte den Vorschlag nicht zurueck");

  const gemeinsam = queue({ onReady: () => { ready += 1; } });
  gemeinsam.vorschlagen(item("drei"), a);
  const gemeinsamId = gemeinsam.zustand(a).selectedId;
  const gemeinsamStart = gemeinsam.starten(gemeinsamId, { fromKey: "alt" }, new Set(["a", "b"]), a);
  gemeinsam.gestartet(gemeinsamStart.startId, true, "a");
  gemeinsam.gestartet(gemeinsamStart.startId, true, "b");
  assert.equal(ready, 1, "alle Bereiten loesten nicht genau einen Start aus");
  assert.equal(gemeinsam.zustand(a).pending, null);

  const ablage = queue();
  ablage.vorschlagen(item("vier"), a);
  const ablageId = ablage.zustand(a).selectedId;
  ablage.starten(ablageId, { fromKey: "alt" }, new Set(["a"]), a);
  const neu = queue();
  neu.laden(ablage.serialisieren());
  assert.equal(neu.zustand(a).pending, null, "ein Start ueberlebte faelschlich den Neustart");
  assert.equal(neu.zustand(a).items[0].key, "vier", "pending Eintrag ging beim Neustart verloren");

  console.log("OK Raumwarteschlange: idempotente Stimmen, CAS, strikte Bereitschaft, Frist und Persistenz");
})().catch((fehler) => {
  console.error("FAIL Raumwarteschlange:", fehler);
  process.exitCode = 1;
});
