"use strict";

// Die Queue ist absichtlich ein eigenständiges Renderer-Modul. Dieser kleine
// DOM-Harness prüft deshalb ihre echte öffentliche Oberfläche ohne Electron:
// eine Favoriten-ID wird vorgeschlagen, und eine URL wird nur im YouTube-Modus
// akzeptiert.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

class Node {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.listeners = new Map();
    this.classList = { toggle: () => {} }; this.value = ""; this.textContent = "";
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) {
    this.children = nodes;
    // Wie ein echtes <select>: nach einem Neuaufbau ist die erste Option
    // ausgewählt, sofern kein Wert wiederhergestellt wurde.
    if (this.tagName === "SELECT" && !this.value && nodes[0]?.value) this.value = nodes[0].value;
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  setAttribute() {}
  trigger(name) { return this.listeners.get(name)?.({ preventDefault() {} }); }
}

function find(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.children || []) { const hit = find(child, predicate); if (hit) return hit; }
  return null;
}

const commands = [];
const context = {
  URL, console, document: { createElement: (tag) => new Node(tag) }, globalThis: {},
  setTimeout, clearTimeout
};
context.globalThis = context;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "raumqueue.js"), "utf8"), context);

(async () => {
const root = new Node("section");
const api = {
  getRoomQueue: async (room, mode) => ({ room, mode, connected:true, supported:true, rev: 4, items: [], selectedId: "" }),
  roomQueueCommand: async (room, mode, command, payload) => commands.push({ room, mode, command, payload })
};
context.ElfixRaumqueue.erstellen({
  root, api,
  favorites: () => [{ id: "f-1", title: "Beispielserie" }],
  rooms: () => [{ room: "kino" }]
});

const form = find(root, (node) => node.tagName === "FORM");
assert.ok(form, "Queue hat ein Vorschlagsformular");
await new Promise(resolve=>setTimeout(resolve,0));
form.trigger("submit");
assert.deepEqual(commands[0], { room: "kino", mode: "normal", command: "propose", payload: { favoriteId: "f-1" } });

const youtubeTab = find(root, (node) => node.tagName === "BUTTON" && node.dataset.mode === "youtube");
youtubeTab.trigger("click");
const url = find(root, (node) => node.tagName === "INPUT");
url.value = "https://www.youtube.com/watch?v=abc";
await new Promise(resolve=>setTimeout(resolve,0));
form.trigger("submit");
assert.deepEqual(commands[1], { room: "kino", mode: "youtube", command: "propose", payload: { url: "https://www.youtube.com/watch?v=abc" } });

console.log("OK  raumqueue UI: Favorit und YouTube-URL erzeugen getrennte Vorschläge");
})().catch(error=>{console.error(error);process.exitCode=1;});

(async () => {
  const root2 = new Node("section");
  const api2 = {
    getRoomQueue: async (room, mode) => ({ room, mode, connected:true, supported:true, rev: 9, pending: true, items: [], selectedId: "" }),
    roomQueueCommand: async () => ({ ok: false, error: "nicht verbunden" })
  };
  context.ElfixRaumqueue.erstellen({
    root: root2, api: api2,
    favorites: () => [{ id: "f-2", title: "Film" }], rooms: () => [{ room: "wohnzimmer" }]
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const status = find(root2, (node) => node.className === "raumqueue-status");
  assert.match(status.textContent, /aktualisiert/, "Relay-pending bleibt im UI sichtbar");
  find(root2, (node) => node.tagName === "FORM").trigger("submit");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(status.textContent, "nicht verbunden", "der konkrete Grund der abgelehnten Relay-Antwort bleibt sichtbar");
  console.log("OK  raumqueue UI: Relay-pending und abgelehnte Befehle bleiben ehrlich sichtbar");
})().catch((error) => { console.error(error); process.exitCode = 1; });

(async () => {
  const waiting = [];
  const root3 = new Node("section");
  context.ElfixRaumqueue.erstellen({
    root: root3,
    api: {
      getRoomQueue: (room, mode) => new Promise((resolve) => waiting.push({ room, mode, resolve })),
      roomQueueCommand: async () => ({ ok: true })
    },
    favorites: () => [{ id: "f-3", title: "Serie" }], rooms: () => [{ room: "kino" }]
  });
  find(root3, (node) => node.tagName === "BUTTON" && node.dataset.mode === "youtube").trigger("click");
  assert.deepEqual(waiting.map((request) => request.mode), ["normal", "youtube"], "Moduswechsel startet zwei getrennte Abfragen");
  waiting[1].resolve({ room: "kino", mode: "youtube", rev: 2, items: [], selectedId: "" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  waiting[0].resolve({ room: "kino", mode: "normal", rev: 1, items: [{ id: "veraltet" }], selectedId: "" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const status = find(root3, (node) => node.className === "raumqueue-status");
  assert.match(status.textContent, /Noch keine Vorschläge/, "eine späte Antwort des alten Modus überschreibt den aktuellen Stand nicht");
  console.log("OK  raumqueue UI: späte Antworten eines alten Modus werden verworfen");
})().catch((error) => { console.error(error); process.exitCode = 1; });
(async () => {
  for (const flags of [{connected:false,supported:true},{connected:true,supported:false}]) {
    const target = new Node("section");
    context.ElfixRaumqueue.erstellen({root:target,api:{getRoomQueue:async(room,mode)=>({room,mode,items:[],...flags}),roomQueueCommand:async()=>({ok:true})},favorites:()=>[{id:"f",title:"Serie"}],rooms:()=>["R"]});
    await new Promise(r=>setTimeout(r,0));
    assert.equal(find(target,n=>n.tagName==="BUTTON"&&n.type==="submit").disabled,true,"normal offline/legacy add disabled");
    find(target,n=>n.dataset.mode==="youtube").trigger("click");
    await new Promise(r=>setTimeout(r,0));
    assert.equal(find(target,n=>n.tagName==="INPUT").disabled,true,"YouTube offline/legacy input disabled");
    assert.equal(find(target,n=>n.tagName==="BUTTON"&&n.type==="submit").disabled,true,"YouTube offline/legacy add disabled");
  }
  console.log("OK raumqueue UI: Offline und alte Relays sperren beide Vorschlagsformulare");
})().catch(e=>{console.error(e);process.exitCode=1;});
