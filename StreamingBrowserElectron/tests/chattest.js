"use strict";
// Der Watchparty-Chat, gegen das echte Relay.
//
// Er ist ein kleiner Aufsatz auf viel Vorhandenem: das Relay kennt die
// Mitglieder eines Raums ohnehin und weiss, wer schreibt. Genau deshalb wird
// hier vor allem geprueft, dass er nichts anfasst, was ihm nicht gehoert - der
// Raumzustand darf sich durch eine Chatzeile nicht bewegen, und gespeichert
// wird nichts.
//
// Die zweite Haelfte gilt der Einblendung in der Anbieterseite: eingeklappt,
// bis man sie aufmacht, und sichtbar nur, solange die Maus sich bewegt. Das
// wird ausgefuehrt und nicht bloss gelesen - ob etwas nach ein paar Sekunden
// Stille wirklich verschwindet, sieht man einem Quelltext nicht an.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const WS = require("../../sync-server/node_modules/ws");

const PORT = Number(process.env.TESTPORT) || 8799;
const ADRESSE = `ws://127.0.0.1:${PORT}`;
const RAUM = "chatraum";

const WURZEL = path.join(__dirname, "..");
const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").replace(/\r/g, "");
const SERVER = fs.readFileSync(path.join(WURZEL, "..", "sync-server", "server.js"), "utf8").replace(/\r/g, "");
const CLIENT = fs.readFileSync(path.join(WURZEL, "src/watchparty.js"), "utf8").replace(/\r/g, "");

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

function abschnitt(quelle, anfang, ende = "}") {
  const zeilen = quelle.split("\n");
  const von = zeilen.findIndex((z) => z.startsWith(anfang));
  if (von < 0) throw new Error("nicht gefunden: " + anfang);
  let bis = von;
  while (bis < zeilen.length && zeilen[bis] !== ende) bis += 1;
  return zeilen.slice(von, bis + 1).join("\n");
}

function client(name, deviceId) {
  let socket;
  const eingang = [];
  const warten = [];
  const api = {
    name, deviceId, eingang,
    verbinde: () => new Promise((fertig) => {
      socket = new WS(ADRESSE);
      socket.on("message", (roh) => {
        const m = JSON.parse(String(roh));
        eingang.push(m);
        for (let i = warten.length - 1; i >= 0; i -= 1) {
          if (warten[i].passt(m)) { warten[i].resolve(m); warten.splice(i, 1); }
        }
      });
      socket.on("open", fertig);
    }),
    send: (m) => socket.send(JSON.stringify(m)),
    zu: () => socket.close(),
    leeren: () => { eingang.length = 0; },
    erwarte: (passt, ms = 1500) => new Promise((resolve) => {
      const treffer = eingang.find(passt);
      if (treffer) return resolve(treffer);
      const e = { passt, resolve };
      warten.push(e);
      setTimeout(() => {
        const i = warten.indexOf(e);
        if (i >= 0) { warten.splice(i, 1); resolve(null); }
      }, ms);
    })
  };
  return api;
}

(async () => {
  const anna = client("Anna", "geraet-anna");
  const ben = client("Ben", "geraet-ben");
  await anna.verbinde();
  await ben.verbinde();
  anna.send({ type: "join", room: RAUM, name: anna.name, deviceId: anna.deviceId });
  ben.send({ type: "join", room: RAUM, name: ben.name, deviceId: ben.deviceId });
  await schlaf(200);
  anna.leeren();
  ben.leeren();

  // --- Der Weg durch den Raum ---

  anna.send({ type: "chat", text: "Läuft bei euch?" });
  const beiBen = await ben.erwarte((m) => m.type === "chat");
  pruefe("Eine Zeile kommt beim anderen Geraet an",
    beiBen?.text === "Läuft bei euch?",
    beiBen?.text);
  pruefe("Sie nennt den Absender",
    beiBen?.from === "Anna" && beiBen?.deviceId === "geraet-anna",
    `${beiBen?.from} / ${beiBen?.deviceId}`);
  pruefe("und einen Zeitpunkt",
    Number(beiBen?.at) > 0);

  const beiAnna = await anna.erwarte((m) => m.type === "chat");
  pruefe("Der Absender bekommt sie auch",
    beiAnna?.text === "Läuft bei euch?",
    "sonst saehe man die eigene Nachricht nicht im Verlauf");

  // --- Was der Chat nicht anfassen darf ---

  ben.leeren();
  anna.send({ type: "chat", text: "noch eine" });
  await schlaf(250);
  pruefe("Eine Chatzeile bewegt den Raumzustand nicht",
    !ben.eingang.some((m) => m.type === "state" || m.type === "watchstate" || m.type === "control"),
    ben.eingang.map((m) => m.type).join(","));

  // --- Grenzen ---

  ben.leeren();
  anna.send({ type: "chat", text: "   " });
  await schlaf(250);
  pruefe("Leerzeichen allein werden nicht verteilt",
    !ben.eingang.some((m) => m.type === "chat"),
    "sonst fuellte ein versehentliches Enter den Verlauf");

  ben.leeren();
  anna.send({ type: "chat", text: "x".repeat(900) });
  const lang = await ben.erwarte((m) => m.type === "chat");
  pruefe("Sehr lange Zeilen werden gekuerzt",
    lang && lang.text.length === 500,
    `${lang?.text.length} Zeichen`);

  // --- Ein Fremder ---

  const clara = client("Clara", "geraet-clara");
  await clara.verbinde();
  clara.send({ type: "join", room: "andererraum", name: clara.name, deviceId: clara.deviceId });
  await schlaf(200);
  clara.leeren();
  anna.send({ type: "chat", text: "nur fuer uns" });
  await schlaf(300);
  pruefe("Ein anderer Raum bekommt nichts davon",
    !clara.eingang.some((m) => m.type === "chat"),
    "sonst laege der Chat quer ueber alle Raeume");
  clara.zu();

  // --- Gespeichert wird nichts ---

  pruefe("Das Relay legt keinen Verlauf an",
    !/raum\.chat|chatVerlauf|nachrichten\.push/.test(SERVER)
    && /anRaumSenden\(socket\.raum, \{\s*\n\s*type: "chat"/.test(SERVER),
    "weitergereicht, nicht abgelegt");
  pruefe("und der Zustandsspeicher bleibt unberuehrt",
    !/zustandSpeichernSpaeter\(\);/.test(abschnitt(SERVER, '    if (nachricht.type === "chat") {', "    }")),
    "eine Chatzeile ist kein Raumzustand");

  pruefe("/health weist den Chat aus",
    /"chat"/.test(SERVER.slice(SERVER.indexOf("features: ["), SERVER.indexOf("features: [") + 400)),
    "sonst laesst sich nach dem Ausrollen nicht pruefen, ob die neue Fassung laeuft");

  // --- Die Seite des Clients ---

  pruefe("Der Client reicht den Chat an der Zustandsverarbeitung vorbei",
    CLIENT.indexOf('nachricht?.type === "chat"') < CLIENT.indexOf('nachricht?.type === "state"'),
    "er darf nie einen Fehler in den Raumzustand schreiben");
  pruefe("Er erkennt die eigene Nachricht",
    /eigen: String\(nachricht\.deviceId \|\| ""\) === String\(this\.geraetId \|\| ""\)/.test(CLIENT));
  pruefe("Leeres wird gar nicht erst gesendet",
    /const text = String\(zeile \|\| ""\)\.trim\(\)\.slice\(0, 500\);\s*\n\s*if \(!text\) return false;/.test(CLIENT));

  // --- Die Einblendung in der Seite -------------------------------------------

  const buehne = seiteBauen();
  pruefe("Die Einblendung meldet sich als eingerichtet",
    buehne.ergebnis.startsWith("chat-da@"),
    buehne.ergebnis);
  pruefe("Sie ist eingeklappt: nur ein Knopf",
    buehne.knopfSichtbar() && !buehne.feldSichtbar(),
    "eine offene Chatspalte neben einem Film waere eine Ablenkung, die man nicht bestellt hat");

  buehne.klick(buehne.knopf);
  pruefe("Ein Klick klappt sie auf",
    buehne.feldSichtbar() && !buehne.knopfSichtbar());
  buehne.klick(buehne.zu);
  pruefe("und der Strich wieder zu",
    !buehne.feldSichtbar() && buehne.knopfSichtbar());

  // Sichtbarkeit
  pruefe("Nach einer Mausbewegung ist sie da",
    buehne.kasten.style.opacity === "1");
  buehne.warten(4000);
  pruefe("Steht die Maus still, verschwindet sie",
    buehne.kasten.style.opacity === "0",
    "wer schaut, bewegt die Maus nicht");
  buehne.mausBewegen();
  pruefe("Jede Bewegung holt sie zurueck",
    buehne.kasten.style.opacity === "1");

  buehne.mausDrauf();
  buehne.warten(4000);
  pruefe("Unter dem Zeiger bleibt sie stehen",
    buehne.kasten.style.opacity === "1",
    "sonst verblasste sie unter der eigenen Hand");
  buehne.mausWeg();

  // Senden
  buehne.klick(buehne.knopf);
  buehne.eingabe.value = "  hallo  ";
  buehne.absenden();
  pruefe("Abschicken meldet die Zeile nach aussen",
    buehne.meldungen.some((z) => z === "__elfix:chat:hallo"),
    buehne.meldungen.join(" | "));
  pruefe("und leert das Feld",
    buehne.eingabe.value === "");
  buehne.eingabe.value = "   ";
  const vorher = buehne.meldungen.length;
  buehne.absenden();
  pruefe("Leeres wird nicht abgeschickt",
    buehne.meldungen.length === vorher);

  pruefe("Tasten im Eingabefeld erreichen den Player nicht",
    buehne.tastenGestoppt > 0,
    "sonst pausierte die Leertaste mitten im Satz");

  // Empfangen
  buehne.melden({ text: "Hi", from: "Ben", eigen: false });
  pruefe("Eine eingehende Nachricht steht in der Liste",
    buehne.listeText().includes("Hi") && buehne.listeText().includes("Ben"));
  buehne.klick(buehne.zu);
  buehne.melden({ text: "Noch da?", from: "Ben", eigen: false });
  pruefe("Bei zugeklapptem Chat meldet sich der Knopf leise",
    buehne.knopf.textContent.includes("•"),
    "ein Punkt, kein Fenster");

  for (let i = 0; i < 70; i += 1) buehne.melden({ text: `m${i}`, from: "Ben", eigen: false });
  pruefe("Die Liste waechst nicht endlos",
    buehne.liste.children.length <= 50,
    `${buehne.liste.children.length} Zeilen`);

  // --- Wann sie ueberhaupt eingespielt wird ---

  const install = abschnitt(MAIN, "async function installWatchpartyChat(");
  // Der Fehler, an dem der Chat zuerst gar nicht erschien: eingespielt wurde er
  // nur beim Laden der Seite. Da steht aber noch nicht fest, ob hier eine Runde
  // laeuft - die Steuerung der Watchparty wird aus genau diesem Grund seit
  // jeher auch im Fortschritts-Takt nachgezogen.
  const taktStelle = MAIN.indexOf("await installWatchpartyControls(provider, view, url)");
  pruefe("Der Chat wird im Fortschritts-Takt nachgezogen, nicht nur beim Laden",
    taktStelle > 0 && MAIN.slice(taktStelle, taktStelle + 600).includes("await installWatchpartyChat(provider, view, url)"),
    "wer erst nach dem Laden beitritt, bekaeme sonst nie einen Chat");
  pruefe("Endet die Runde, wird er wieder entfernt",
    /window\.__elfixChat && window\.__elfixChat\.entfernen\(\)/.test(MAIN),
    "ein Feld, dessen Nachrichten niemand bekommt, ist schlimmer als keines");

  pruefe("Eingespielt wird nur, wo eine Runde laeuft",
    /const key = watchpartyLiveKeyForUrl\(url\);/.test(install)
    && /if \(!key \|\| !watchparty\.aktiv\) \{/.test(install),
    "ohne Raum haette der Knopf niemanden, mit dem er spraeche");
  pruefe("Gesendet wird nur aus einer laufenden Runde",
    /const key = watchpartyLiveKeyForUrl\(view\.webContents\.getURL\(\)\);\s*\n\s*if \(key\) watchparty\.chatSenden\(chat\[1\]\);/.test(MAIN));
  pruefe("Empfangenes geht nur in eine Seite mit Runde",
    /if \(!watchpartyLiveKeyForUrl\(adresse\)\) return;/.test(abschnitt(MAIN, "function watchpartyChatZeigen(")));

  anna.zu();
  ben.zu();
  const fehler = pruefungen.filter((ok) => !ok).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  process.exit(fehler ? 1 : 0);
})();

// --- Ein Ersatz-DOM fuer die Einblendung ------------------------------------

function seiteBauen() {
  const meldungen = [];
  const uhr = { jetzt: 0 };
  const wartende = [];
  let nummer = 1;

  function element(tag) {
    const horcher = {};
    const knoten = {
      tag, id: "", textContent: "", type: "", value: "", maxLength: 0, placeholder: "",
      style: {}, children: [], parentElement: null,
      addEventListener(name, fn) { (horcher[name] = horcher[name] || []).push(fn); },
      removeEventListener() {},
      append(...k) { k.forEach((x) => { x.parentElement = knoten; knoten.children.push(x); }); },
      appendChild(k) { k.parentElement = knoten; knoten.children.push(k); return k; },
      remove() {
        if (knoten.parentElement) {
          knoten.parentElement.children = knoten.parentElement.children.filter((x) => x !== knoten);
        }
      },
      get firstChild() { return knoten.children[0] || null; },
      focus() { dokument.activeElement = knoten; },
      getBoundingClientRect: () => ({ width: 800, height: 450 }),
      scrollTop: 0, scrollHeight: 0,
      ausloesen(name, ereignis = {}) {
        const daten = { preventDefault() {}, stopPropagation() { daten.gestoppt = true; }, ...ereignis };
        for (const fn of horcher[name] || []) fn(daten);
        return daten;
      },
      hat: (name) => Boolean(horcher[name])
    };
    return knoten;
  }

  const video = element("video");
  const wurzel = element("html");
  const dokument = {
    documentElement: wurzel,
    fullscreenElement: null,
    activeElement: null,
    createElement: element,
    querySelectorAll: (auswahl) => (auswahl === "video" ? [video] : []),
    addEventListener(name, fn) { (dokument.__h = dokument.__h || {})[name] = fn; },
    removeEventListener() {}
  };
  const fenster = {};
  fenster.top = fenster;
  fenster.self = fenster;

  const kontext = {
    document: dokument,
    window: fenster,
    location: { hostname: "aniworld.to" },
    console: { log: (t) => meldungen.push(String(t)) },
    Object, Array, String, Number, Boolean, Math, JSON, Date,
    setTimeout: (fn, ms) => { const n = nummer++; wartende.push({ n, fn, faellig: uhr.jetzt + (Number(ms) || 0) }); return n; },
    clearTimeout: (n) => { const i = wartende.findIndex((w) => w.n === n); if (i >= 0) wartende.splice(i, 1); },
    requestAnimationFrame: (fn) => fn()
  };
  vm.createContext(kontext);

  const u = { JSON, String, Number };
  vm.createContext(u);
  vm.runInContext(MAIN.match(/^const CHAT_RUHE_MS = .+$/m)[0], u);
  vm.runInContext(abschnitt(MAIN, "function watchpartyChatScript("), u);
  const script = vm.runInContext("watchpartyChatScript", u)({ name: "Du" });
  const ergebnis = vm.runInContext(script, kontext);

  const kasten = wurzel.children.find((k) => k.id === "__elfixChat");
  const feld = kasten.children[0];
  const knopf = kasten.children[1];
  const kopf = feld.children[0];
  const liste = feld.children[1];
  const zeile = feld.children[2];
  const eingabe = zeile.children[0];
  const zu = kopf.children[1];

  let tastenGestoppt = 0;
  const echtesAusloesen = eingabe.ausloesen;
  eingabe.ausloesen = (name, ereignis) => {
    const daten = echtesAusloesen.call(eingabe, name, ereignis);
    if (daten.gestoppt) tastenGestoppt += 1;
    return daten;
  };
  eingabe.ausloesen("keydown");

  return {
    ergebnis, meldungen, kasten, feld, knopf, zu, liste, eingabe,
    get tastenGestoppt() { return tastenGestoppt; },
    knopfSichtbar: () => knopf.style.display !== "none",
    feldSichtbar: () => feld.style.display === "flex",
    klick: (knoten) => knoten.ausloesen("click"),
    absenden: () => zeile.ausloesen("submit"),
    mausBewegen: () => dokument.__h.mousemove({}),
    mausDrauf: () => kasten.ausloesen("mouseenter"),
    mausWeg: () => kasten.ausloesen("mouseleave"),
    // Die Uhr weiterdrehen und alles ausloesen, was faellig geworden ist.
    warten(ms) {
      uhr.jetzt += ms;
      for (const eintrag of wartende.splice(0).sort((a, b) => a.faellig - b.faellig)) {
        if (eintrag.faellig <= uhr.jetzt) eintrag.fn();
        else wartende.push(eintrag);
      }
    },
    melden: (nachricht) => vm.runInContext("window.__elfixChat", kontext).melden(nachricht),
    listeText: () => liste.children.map((k) => k.children.map((x) => x.textContent).join(" ")).join(" | ")
  };
}
