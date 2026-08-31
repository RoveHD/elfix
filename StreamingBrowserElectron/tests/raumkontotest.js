"use strict";
/*
 * Aus dem Raum nehmen - und es bleibt draussen.
 *
 * Gemeldet: "ich kann das grad nicht entfernen es kommt immer wieder neu".
 * Dahinter lagen zwei Dinge, und jedes allein genuegt fuer den Fehler.
 *
 * Erstens durfte nur das Geraet herausnehmen, das eingestellt hatte
 * (`eintrag.addedById !== socket.geraetId` -> stilles return). Wer den
 * Geraeteabgleich benutzt, hat aber kein "der Rechner" und "das Handy",
 * sondern ein Konto; dass ein Titel sich nur dort herausnehmen liess, wo er
 * zufaellig eingestellt wurde, war nicht zu erklaeren.
 *
 * Zweitens traegt jedes Geraet beim Verbinden nach, was es selbst eingestellt
 * hatte und im Raum vermisst (restoreWatchparty). Nimmt einer den Titel
 * heraus, waehrend das andere Geraet aus ist, stellt dieses ihn beim naechsten
 * Start wieder ein - fuer den Benutzer kommt er "immer wieder neu".
 *
 * Beides wird hier gegen das echte Relay geprueft, nicht gegen eine
 * Beschreibung davon.
 */

const WS = require("../../sync-server/node_modules/ws");

const PORT = Number(process.env.TESTPORT) || 8799;
const ADRESSE = `ws://127.0.0.1:${PORT}`;
const RAUM = "kontoraum";
const KEY = "film:avataraangderherrderelemente";
const URL = "https://filmo.to/movies/avatar-aang-der-herr-der-elemente";
// Zwei Geraete derselben Person: dasselbe Konto, verschiedene Kennungen und
// verschiedene Namen. Genau die Lage aus der Meldung ("Elias" und "S24 Elias").
const KONTO = "a".repeat(32);
const FREMDES_KONTO = "b".repeat(32);

const pruefungen = [];
const pruefe = (name, bedingung, detail) => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name, deviceId, konto) {
  let socket;
  const eingang = [];
  const warten = [];
  const api = {
    name, deviceId, konto,
    zustand: null,
    verbinde: () => new Promise((fertig) => {
      socket = new WS(ADRESSE);
      socket.on("message", (roh) => {
        const m = JSON.parse(String(roh));
        eingang.push(m);
        if (m.type === "state" && Array.isArray(m.shared)) api.zustand = m.shared;
        for (let i = warten.length - 1; i >= 0; i -= 1) {
          if (warten[i].passt(m)) { warten[i].resolve(m); warten.splice(i, 1); }
        }
      });
      socket.on("open", fertig);
    }),
    send: (m) => socket.send(JSON.stringify(m)),
    zu: () => socket.close(),
    erwarte: (passt, ms = 1500) => new Promise((resolve) => {
      const treffer = eingang.find(passt);
      if (treffer) return resolve(treffer);
      const e = { passt, resolve };
      warten.push(e);
      setTimeout(() => {
        const i = warten.indexOf(e);
        if (i >= 0) { warten.splice(i, 1); resolve(null); }
      }, ms);
    }),
    // Was der Client zuletzt im Raum gesehen hat.
    hatTitel: () => Boolean((api.zustand || []).find((x) => x.key === KEY)),
    eintrag: () => (api.zustand || []).find((x) => x.key === KEY) || null
  };
  return api;
}

async function beitreten(c) {
  await c.verbinde();
  const nachricht = { type: "join", room: RAUM, name: c.name, deviceId: c.deviceId };
  if (c.konto) nachricht.konto = c.konto;
  c.send(nachricht);
  await c.erwarte((m) => m.type === "state");
}

const titel = { key: KEY, url: URL, title: "Avatar Aang: Der Herr der Elemente", type: "film", season: 0, episode: 0 };

(async () => {
  // --- 1. Ein anderes Geraet desselben Kontos darf herausnehmen ------------

  const handy = client("S24 Elias", "geraet-handy", KONTO);
  const rechner = client("Elias", "geraet-rechner", KONTO);

  await beitreten(handy);
  handy.send({ type: "share", item: titel });
  await handy.erwarte((m) => m.type === "state" && m.shared?.some((x) => x.key === KEY));

  await beitreten(rechner);
  await schlaf(200);
  pruefe("Das Handy hat den Titel eingestellt", handy.hatTitel() && rechner.hatTitel());

  const amRechner = rechner.eintrag();
  pruefe("Der Rechner ist nicht das einstellende Geraet",
    amRechner.addedById === "geraet-handy",
    `eingestellt von ${amRechner.addedById}`);
  pruefe("Aber beide tragen dasselbe Konto",
    amRechner.addedByKonto === KONTO,
    "wer den Abgleich benutzt, ist ein Konto und nicht zwei Geraete");

  rechner.send({ type: "unshare", key: KEY });
  // Auf "ist weg" laesst sich mit erwarte() nicht warten: es durchsucht auch
  // den alten Posteingang, und vor dem Einstellen stand dort ein Zustand ohne
  // diesen Titel. Was zaehlt, ist der zuletzt gesehene Zustand.
  await schlaf(500);
  pruefe("Der Rechner nimmt den Titel des Handys heraus",
    !rechner.hatTitel() && !handy.hatTitel(),
    "vorher lief das still ins Leere");

  // --- 2. Und er kommt nicht wieder ---------------------------------------
  //
  // Das Handy verbindet sich neu und traegt nach, was es vermisst - genau das,
  // was restoreWatchparty in der App tut.

  handy.zu();
  await schlaf(150);
  const handyNeu = client("S24 Elias", "geraet-handy", KONTO);
  await beitreten(handyNeu);
  handyNeu.send({ type: "share", item: titel, restore: true });
  await schlaf(400);
  pruefe("Ein Nachtrag holt den herausgenommenen Titel nicht zurueck",
    !handyNeu.hatTitel() && !rechner.hatTitel(),
    "der Grabstein haelt ihn draussen");

  // --- 3. Ausdruecklich wieder einstellen geht trotzdem --------------------

  handyNeu.send({ type: "share", item: titel });
  await handyNeu.erwarte((m) => m.type === "state" && m.shared?.some((x) => x.key === KEY));
  pruefe("Wer ihn bewusst wieder einstellt, bekommt ihn zurueck",
    handyNeu.hatTitel(),
    "ein Grabstein ist keine Sperre");

  // --- 4. Ein fremdes Konto darf nicht ------------------------------------

  const fremd = client("Jemand anders", "geraet-fremd", FREMDES_KONTO);
  await beitreten(fremd);
  await schlaf(200);
  pruefe("Ein fremdes Geraet sieht den Titel", fremd.hatTitel());
  fremd.send({ type: "unshare", key: KEY });
  await schlaf(400);
  pruefe("Aber es darf ihn nicht herausnehmen",
    fremd.hatTitel() && handyNeu.hatTitel(),
    "das Konto entscheidet, nicht die Anwesenheit");

  // --- 5. Ohne Konto bleibt alles wie vorher ------------------------------
  //
  // Wer den Geraeteabgleich nicht benutzt, schickt kein Konto. Dann darf
  // weiterhin nur das einstellende Geraet herausnehmen.

  const RAUM2 = "kontolos";
  const ohneA = client("Ohne A", "ohne-a", "");
  const ohneB = client("Ohne B", "ohne-b", "");
  for (const c of [ohneA, ohneB]) {
    await c.verbinde();
    c.send({ type: "join", room: RAUM2, name: c.name, deviceId: c.deviceId });
    await c.erwarte((m) => m.type === "state");
  }
  ohneA.send({ type: "share", item: titel });
  await ohneA.erwarte((m) => m.type === "state" && m.shared?.some((x) => x.key === KEY));
  await schlaf(200);
  ohneB.send({ type: "unshare", key: KEY });
  await schlaf(400);
  pruefe("Ohne Konto darf ein fremdes Geraet weiterhin nicht herausnehmen",
    ohneA.hatTitel(),
    "die bisherige Regel gilt unveraendert");
  ohneA.send({ type: "unshare", key: KEY });
  await schlaf(500);
  pruefe("Und das einstellende Geraet darf es wie bisher", !ohneA.hatTitel());

  for (const c of [handy, handyNeu, rechner, fremd, ohneA, ohneB]) {
    try { c.zu(); } catch { /* schon zu */ }
  }
  const fehler = pruefungen.filter((x) => !x).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  process.exit(fehler ? 1 : 0);
})().catch((fehler) => {
  console.error("Abgebrochen:", fehler.message);
  process.exit(2);
});
