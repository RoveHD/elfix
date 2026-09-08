"use strict";
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
function fn(name) {
  const match = new RegExp("(?:async )?function " + name + "\\(").exec(source);
  assert.ok(match, name);
  const end = source.indexOf("\n}", match.index);
  return source.slice(match.index, end + 2);
}
const reports = [], proposals = [];
let state = { room: "R", rev: 1, items: [], reason: "", selectedId: "p" };
let resolveEpisodes = true, sent = true, reject = "";
const c = {
  console, Date, Map, Set, Boolean, Number, String,
  settings: { playback: { spoilerProtection: { enabled: true, roomMinimum: false, shareWatchedWithRoom: false } } },
  favorites: [ { id: "f", url: "https://aniworld.to/anime/stream/test", title: "Test", type: "anime", providerName: "AniWorld", completedEpisodes: [{ season: 1, episode: 1 }] } ],
  watchpartyShared: [{ key: "test", room: "R", joined: true, url: "https://aniworld.to/anime/stream/test" }],
  spielerLauf: { url: "https://aniworld.to/anime/stream/test/staffel-1/episode-2" },
  activeView: null, spoilerGesendet: new Map(), spoilerRaumStaende: new Map(), queueManuell: new Map(), queueBestaetigt: new Set(["R|normal", "R|youtube"]),
  spoilerschutz: require("../src/spoilerschutz"),
  istGleicheSerie: (a,b) => a.split("/staffel-")[0] === b.split("/staffel-")[0],
  watchpartyLiveKeyForUrl: () => "test", watchpartyRaumForUrl: () => "R",
  watchparty: {
    codes: ["R"], status: () => ({ rooms: [{ room: "R", connected: true }] }), queueStatus: () => state,
    spoilerMelden: (key, data, room) => { reports.push({key,data,room}); return sent; },
    queuePropose: (item, room) => { proposals.push({item,room}); state = {...state, rev: state.rev+1}; return true; },
    queueAdvance: () => { state = {...state, reason: reject}; return true; }
  },
  youtubeParty: { raum: "R", beigetreten: true, queueStatus: () => state,
    queuePropose: item => { proposals.push({ youtube: true, item }); return true; } },
  providerForWatchpartyUrl: url => String(url).startsWith("https://aniworld.to/") ? { id: "ani" } : null,
  episodeIdentity: url => { const m=/staffel-(\d+)\/episode-(\d+)/.exec(url);return m ? { season:+m[1],episode:+m[2] } : null; },
  folgenlisteLesen: async () => resolveEpisodes ? { folgen: [{ url: "https://aniworld.to/anime/stream/test/staffel-1/episode-1" }] } : null,
  ersteFolgeAus: l => l.folgen[0].url,
  normalizeMediaType: t => t, inferMediaType: () => "anime", watchpartyKey: () => "test",
  cleanBaseMediaTitle: t => t,
  youtube: { istYoutubeUrl: u => String(u).startsWith("https://www.youtube.com/") },
  youtubeVideoIdAus: u => new URL(u).searchParams.get("v"),
  spielerRunde: () => null,
  raumQueueQuittung: async () => true
};
vm.createContext(c);
for (const name of ["spoilerAbgeschlosseneFolgen", "spoilerOptionen", "spoilerAbschluesseMelden", "raumQueueStatus", "raumQueueFehler", "raumQueueBefehl"]) vm.runInContext(fn(name), c);
(async () => {
  c.spoilerAbschluesseMelden(); assert.equal(reports.length,0,"no history leaves without opt-in");
  c.settings.playback.spoilerProtection.shareWatchedWithRoom=true;
  c.spoilerAbschluesseMelden();c.spoilerAbschluesseMelden();assert.equal(reports.length,1,"dedup same history");
  c.settings.playback.spoilerProtection.shareWatchedWithRoom=false;
  c.spoilerAbschluesseMelden();assert.equal(reports[1].data,null,"opt-out withdraws prior report");
  c.settings.playback.spoilerProtection.shareWatchedWithRoom=true;
  sent=false;c.spoilerAbschluesseMelden();sent=true;c.spoilerAbschluesseMelden();assert.equal(reports.length,4,"failed send retries");
  c.watchpartyLiveKeyForUrl=()=>"other";c.spoilerAbschluesseMelden();assert.equal(reports.at(-1).data,null,"leaving active title withdraws");
  let r=await c.raumQueueBefehl("R","normal","propose",{favoriteId:"f"});assert.equal(r.ok,true);assert.equal(proposals[0].item.url,"https://aniworld.to/anime/stream/test/staffel-1/episode-1");assert.equal(proposals[0].item.episode,1);
  resolveEpisodes=false;r=await c.raumQueueBefehl("R","normal","propose",{favoriteId:"f"});assert.equal(r.ok,false);assert.equal(proposals.length,1,"failed resolution never sends");
  r=await c.raumQueueBefehl("R","youtube","propose",{url:"https://www.youtube.com/watch?v=abcdefghijk"});assert.equal(r.ok,true);assert.equal(proposals.at(-1).youtube,true);
  reject="selection-changed";r=await c.raumQueueBefehl("R","normal","advance",{expectedId:"p",expectedRev:1});assert.equal(r.ok,false);assert.equal(c.queueManuell.size,0,"rejected start clears permission");
  console.log("OK Desktop integration: opt-in, dedup, withdrawal, retry, active title, concrete episode, resolver failure, separate YouTube and rejected start");
})().catch(e=>{console.error(e);process.exitCode=1;});
