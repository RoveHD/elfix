"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { serienKennungAusUrl } = require("../src/fortschritt");
const empfehlung = require("../src/empfehlungslauf");
const skipsegmente = require("../src/skipsegmente");
const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
const extrahieren = name => {
  const start = main.indexOf(`async function ${name}(`);
  assert(start >= 0);
  return main.slice(start, main.indexOf("\n}", start) + 2);
};
const basis = "https://aniworld.to/anime/stream/black-clover";
const folgen = [51, 51, 52, 16, 3].map((anzahl, i) => ({
  offeneStaffel: i + 1,
  staffeln: [0, 1, 2, 3, 4, 5].map(staffel => ({ staffel, url: `${basis}/${staffel ? `staffel-${staffel}` : "filme"}` })),
  folgen: Array.from({ length: anzahl }, (_, j) => ({ staffel: i + 1, folge: j + 1,
    url: `${basis}/staffel-${i + 1}/episode-${j + 1}` }))
}));
const lauf = empfehlung.erstellen({
  cacheLesen: () => ({ pages: {} }),
  metadaten: () => ({ ausCache: () => ({ konfidenz: "EXACT", externeIds: { mal: 34572 }, folgenGesamt: 170 }) })
});

(async () => {
  let aktuell = { id: 7, titel: "Black Clover", url: `${basis}/staffel-2/episode-20` };
  let aktiv = true;
  let abrufe = [];
  let listeLesen = async (_provider, url, optionen) => {
    assert.equal(optionen.still, true, "Intro-Details duerfen keine Bestaetigung oeffnen");
    abrufe.push(url);
    return folgen[Number(url.match(/staffel-(\d+)/)[1]) - 1];
  };
  const kontext = vm.createContext({
    Number, URL, serienKennungAusUrl, lauf,
    settings: { playback: { skipSegments: true } }, spielerLauf: aktuell,
    cleanBaseMediaTitle: x => x, vomSpieler: e => e.echt,
    spielerAnbieter: () => ({ id: "aniworld" }),
    providerModel: { isHttpUrl: url => /^https?:\/\//.test(url) },
    folgenlisteLesen: (...args) => listeLesen(...args),
    skipClient: () => skipsegmente.erstellen({ holen: async url => {
      assert.match(url, /\/34572\/71\?/);
      return { ok: true, json: async () => ({ found: true, results: [
        { interval: { startTime: 0, endTime: 157 }, skipType: "op", episodeLength: 1432.125 }
      ] }) };
    } })
  });
  vm.runInContext(extrahieren("spielerSkipStaffeln") + "\n" + extrahieren("spielerSkipLesen"), kontext);
  const result = await kontext.spielerSkipLesen({ echt: true }, 7, 1430.1);
  assert.deepEqual(result.map(s => [s.type, s.start, s.end]), [["intro", 0, 157]],
    "Echter IPC -> Staffelcollector -> MAL-Zuordnung -> Adapter liefert Black-Clover-Intro");
  assert.deepEqual(abrufe.map(url => Number(url.match(/staffel-(\d+)/)[1])), [2, 1, 3, 4],
    "Aktuelle Staffel wiederverwenden, bei 170 stoppen, neue Staffel 5 nie abrufen");

  const roh = await lauf.skipKontext(aktuell.titel, aktuell.url);
  abrufe = [];
  assert.equal((await kontext.spielerSkipStaffeln(aktuell, { ...roh, malEpisode: 71 }, () => aktiv)).length, 0);
  assert.equal((await kontext.spielerSkipStaffeln(aktuell, { ...roh, season: 1 }, () => aktiv)).length, 0);
  assert.equal((await kontext.spielerSkipStaffeln(aktuell, { ...roh, malFolgenGesamt: 0 }, () => aktiv)).length, 0);
  assert.equal((await kontext.spielerSkipStaffeln(aktuell, roh, () => false)).length, 0);
  assert.equal(abrufe.length, 0);

  listeLesen = async () => { aktiv = false; return folgen[1]; };
  assert.equal((await kontext.spielerSkipStaffeln(aktuell, roh, () => aktiv)).length, 0,
    "Folgenwechsel waehrend des Lesens stoppt weitere Abrufe");
  aktiv = true;
  listeLesen = async () => { throw Error("Anbieter offline"); };
  assert.equal((await kontext.spielerSkipStaffeln(aktuell, roh, () => aktiv)).length, 0);

  for (const manifest of [
    [folgen[1].staffeln[2]],
    [{ staffel: 1, url: "https://aniworld.to/anime/stream/fremd/staffel-1" }],
    [{ staffel: 1, url: "file:///staffel-1" }]
  ]) {
    abrufe = [];
    listeLesen = async (_provider, url) => { abrufe.push(url); return { ...folgen[1], staffeln: manifest }; };
    assert.equal((await kontext.spielerSkipStaffeln(aktuell, roh, () => aktiv)).length, 0);
    assert.equal(abrufe.length, 1, "Fremde oder lueckenhafte Staffellinks nicht abrufen");
  }

  // Eine automatisch gelesene Staffel darf die laufende Wiedergabe nicht
  // hinter eine neu geoeffnete Cloudflare-Bestaetigung legen.
  let bestaetigungen = 0;
  const ansicht = { webContents: { getURL: () => `${basis}/staffel-1`, isLoading: () => false } };
  const werkbank = vm.createContext({
    providerModel: { isHttpUrl: () => true }, isLiveView: () => true,
    getProviderView: () => ansicht, seiteGleich: (a, b) => a === b,
    direktModus: () => true,
    menschentorErkennen: async () => true,
    menschentorLoesenLassen: async () => { bestaetigungen++; return true; }
  });
  vm.runInContext(extrahieren("werkbankAn"), werkbank);
  assert.equal(await werkbank.werkbankAn({}, `${basis}/staffel-1`, () => true, ansicht, { still: true }), null);
  assert.equal(bestaetigungen, 0, "Intro-Nachtrag oeffnet keine Cloudflare-Bestaetigung");
  assert.equal(await werkbank.werkbankAn({}, `${basis}/staffel-1`, () => true, ansicht), ansicht);
  assert.equal(bestaetigungen, 1, "Explizite bisherige Anbieterabfrage bietet Bestaetigung weiter an");
  console.log("OK Skip-Staffeln: Black Clover durch alle Schichten, Abbruch, Fremdlinks und passive Abfragen");
})().catch(error => { console.error(error); process.exitCode = 1; });
