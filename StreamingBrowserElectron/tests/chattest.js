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
const seite = require("./seite");

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
  pruefe("Die Leiste sitzt links oben",
    buehne.leiste.style.left === "22px" && buehne.leiste.style.top === "22px"
    && !buehne.leiste.style.right && !buehne.leiste.style.bottom,
    [buehne.leiste.style.top, buehne.leiste.style.left,
      buehne.leiste.style.bottom, buehne.leiste.style.right].join(" / "));
  pruefe("Der Chat haengt in der Leiste, nicht am Dokument",
    buehne.kasten.parentElement === buehne.leiste && !buehne.kasten.style.position,
    "sonst laege er ueber dem Schalter statt neben ihm");
  pruefe("und steht rechts vom Schalter",
    buehne.kasten.style.order === "2",
    "der Schalter ist immer da, der Chat kommt und geht - der soll nicht springen");
  pruefe("Er waechst nach unten",
    buehne.kasten.style.alignItems === "flex-start"
    && buehne.kasten.children[0] === buehne.knopf,
    "der Knopf steht an derselben Ecke wie die Kopfzeile des Feldes, das er ersetzt");
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
    /const key = watchpartyLiveKeyForUrl\(view\.webContents\.getURL\(\)\);\s*\n\s*if \(key\) watchparty\.chatSenden\(key, chat\[1\]\);/.test(MAIN));
  pruefe("Empfangenes geht nur in eine Seite mit Runde",
    /if \(!watchpartyLiveKeyForUrl\(adresse\)\) return;/.test(abschnitt(MAIN, "function watchpartyChatZeigen(")));

  // --- Die Fassade, ausgefuehrt statt gelesen --------------------------------
  //
  // Der Chat lief zuerst durch keine einzige Runde. main.js spricht nicht mit
  // einer Watchparty, sondern mit der Fassade ueber alle Raeume - und die
  // kannte weder ein chatSenden noch das onChat, das ihr uebergeben wurde.
  // Beim Absenden stuerzte der Hauptprozess ab, Empfangenes verfiel still.
  //
  // Auffallen konnte das hier nicht: die Pruefung oben ist eine Regex ueber
  // main.js, und die stand richtig da. Ob der Aufruf am anderen Ende jemanden
  // findet, sieht man einem Quelltext nicht an - deshalb steht hier die echte
  // Fassade an einer echten Verbindung.

  const { WatchpartyRaeume } = require("../src/watchparty-raeume");
  const FKEY = "serie:fassade";
  const empfangen = [];
  const fassade = new WatchpartyRaeume({
    WebSocketKlasse: WS,
    onChat: (nachricht) => empfangen.push(nachricht)
  });
  fassade.konfigurieren({
    enabled: true, serverUrl: ADRESSE, rooms: [RAUM],
    name: "Dora", deviceId: "geraet-dora"
  });
  await schlaf(400);
  // Wer einstellt, ist beigetreten - erst dann laeuft der Titel in diesem Raum.
  fassade.teilen({
    key: FKEY, title: "X",
    url: "https://aniworld.to/anime/stream/x/staffel-1/episode-1"
  }, RAUM);
  await schlaf(400);

  pruefe("Die Fassade kennt ein chatSenden",
    typeof fassade.chatSenden === "function",
    "main.js ruft es auf - fehlt es, stuerzt der Hauptprozess ab");

  // Fehlt die Methode, wirft der Aufruf - und zwar genau die Zeile, mit der
  // ELFIX 1.28.1 abstuerzte. Abgefangen wird sie hier trotzdem: sonst endet die
  // Suite an dieser Stelle und der Rueckkanal darunter bliebe ungeprueft.
  const senden = (key, text) => {
    try {
      return fassade.chatSenden(key, text);
    } catch (fehler) {
      return String(fehler?.message || fehler);
    }
  };

  ben.leeren();
  const ging = senden(FKEY, "aus der Fassade");
  const ausFassade = await ben.erwarte((m) => m.type === "chat" && m.from === "Dora");
  pruefe("Eine Zeile aus der Fassade erreicht den Raum",
    ging === true && ausFassade?.text === "aus der Fassade",
    ging === true ? ausFassade?.text : String(ging));

  pruefe("Ohne diesen Titel im Raum geht nichts hinaus",
    senden("serie:gibtesnicht", "ins Leere") === false,
    "eine Zeile im falschen Raum waere schlimmer als keine");

  empfangen.length = 0;
  anna.send({ type: "chat", text: "kommt das an?" });
  await schlaf(400);
  pruefe("Empfangenes erreicht das onChat der Fassade",
    empfangen.some((m) => m.text === "kommt das an?"),
    "dieser Rueckkanal fehlte ganz - keine empfangene Zeile kam je in der Seite an");
  pruefe("und traegt den Raum, aus dem es kam",
    empfangen.length > 0 && empfangen.every((m) => m.room === RAUM),
    empfangen.map((m) => m.room).join(","));

  fassade.trennen();

  anna.zu();
  ben.zu();
  const fehler = pruefungen.filter((ok) => !ok).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  process.exit(fehler ? 1 : 0);
})();

// --- Die Einblendung auf der gemeinsamen Buehne -----------------------------
//
// Das Ersatz-DOM liegt in seite.js: seit der gemeinsamen Leiste links oben
// teilen der Chat und der Autoplay-Schalter sich dieselbe Buehne, und zwei
// Nachbauten waeren zwei Wahrheiten.

function seiteBauen() {
  const buehne = seite.seiteBauen();
  const ergebnis = buehne.lauf(seite.skriptBauen("watchpartyChatScript", { name: "Du" }));

  const leiste = buehne.leiste();
  const kasten = buehne.holen("__elfixChat");
  // Nach Gestalt statt nach Platz: der Kasten haelt genau einen Knopf und
  // genau ein Feld. Welcher von beiden zuerst kommt, haengt daran, in welcher
  // Ecke der Chat sitzt - und das darf sich aendern, ohne den Test zu brechen.
  const knopf = kasten.children.find((k) => k.tag === "button");
  const feld = kasten.children.find((k) => k.tag === "div");
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
    ergebnis, kasten, leiste, feld, knopf, zu, liste, eingabe,
    meldungen: buehne.meldungen,
    get tastenGestoppt() { return tastenGestoppt; },
    knopfSichtbar: () => knopf.style.display !== "none",
    feldSichtbar: () => feld.style.display === "flex",
    klick: (knoten) => knoten.ausloesen("click"),
    absenden: () => zeile.ausloesen("submit"),
    mausBewegen: () => buehne.mausBewegen(),
    mausDrauf: () => kasten.ausloesen("mouseenter"),
    mausWeg: () => kasten.ausloesen("mouseleave"),
    warten: (ms) => buehne.warten(ms),
    entfernen: () => buehne.lauf("window.__elfixChat.entfernen()"),
    leisteDa: () => Boolean(buehne.leiste()),
    melden: (nachricht) => buehne.lauf("window.__elfixChat").melden(nachricht),
    listeText: () => liste.children.map((k) => k.children.map((x) => x.textContent).join(" ")).join(" | ")
  };
}
