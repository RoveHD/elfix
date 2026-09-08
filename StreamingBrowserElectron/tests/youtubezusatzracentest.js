"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const sponsorblock = require("../src/sponsorblock");
const youtubeDislikes = require("../src/youtube-dislikes");
const source = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
function funktion(name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}
async function pruefen(art, wechsel) {
  const codes = [];
  let fertig;
  let url = "https://www.youtube.com/watch?v=kJQP7kiw5Fk";
  const settings = { youtubeDislikes: { enabled: true }, sponsorblock: { enabled: true } };
  const warten = new Promise(resolve => { fertig = resolve; });
  const view = { webContents: { getURL: () => url, executeJavaScript: async code => { codes.push(code); } } };
  const kontext = vm.createContext({
    settings, youtubeDislikes, sponsorblock, isLiveView: () => true,
    youtube: { istYoutubeUrl: () => true, videoKennung: x => ({ id: new URL(x).searchParams.get("v") }) },
    youtubeDislikeDaten: () => warten, sponsorblockSegmente: () => warten,
    youtubeParty: { sponsorblockAutomatisch: () => true }
  });
  const name = art === "dislikes" ? "installYoutubeDislikes" : "installSponsorblock";
  vm.runInContext(funktion(name), kontext);
  const lauf = kontext[name](view, url);
  if (wechsel === "aus") {
    settings.youtubeDislikes.enabled = false;
    settings.sponsorblock.enabled = false;
    await kontext[name](view, url);
  } else url = "https://www.youtube.com/watch?v=ByhVrrP1QkQ";
  fertig(art === "dislikes" ? { videoId: "kJQP7kiw5Fk", dislikes: 123 } : []);
  await lauf;
  assert.ok(codes.every(code => !code.includes("MutationObserver")), `${art}/${wechsel}: veralteter Abruf injiziert einen Beobachter`);
  if (wechsel === "video") assert.equal(codes.length, 0, "Kein Skript darf im neuen Video landen");
}
(async () => {
  for (const art of ["dislikes", "sponsorblock"]) {
    await pruefen(art, "aus");
    await pruefen(art, "video");
  }
  console.log("OK YouTube-Zusatzanzeigen: Ausschalten und Videowechsel während verzögerter Antworten");
})().catch(error => { console.error(error); process.exitCode = 1; });
