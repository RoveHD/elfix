"use strict";
// Die Sync-Strategie der YouTube-Watchparty, Stueck fuer Stueck.
//
// Diese Funktionen laufen im Player-Rahmen - sie werden von dort woertlich
// hineingesetzt (siehe youtube-sync.js). Was hier geprueft wird, ist also genau
// das, was beim gemeinsamen Schauen entscheidet.
//
// Geprueft wird ausserdem der Zustand auf der Serverseite: er ist die einzige
// Ordnung, die es in diesem Modus gibt.

const {
  zielPosition,
  driftEntscheiden,
  istVeraltet,
  brauchtAnwendung,
  alsQuelltext,
  beobachterScript,
  anwendenScript,
  abgleichScript,
  zuruecksetzenScript
} = require("../src/youtube-sync");
const serverParty = require("../../sync-server/youtube-party");
const { YoutubeWatchparty } = require("../src/youtube-watchparty");

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(b); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };
const nah = (a, b, toleranz = 0.001) => Math.abs(a - b) <= toleranz;

// --- 1. Wo steht die Runde jetzt? --------------------------------------------

// Der Fall aus der Aufgabe: Position 50, laeuft, gespeichert vor vier Sekunden.
const laeuft = { position: 50, updatedAt: 1_000_000, playing: true };
pruefe("1. Laeuft: die vergangene Zeit zaehlt mit (50 s + 4 s = 54 s)",
  nah(zielPosition(laeuft, 1_004_000), 54),
  `${zielPosition(laeuft, 1_004_000)}`);

pruefe("1b. Steht die Runde, gilt ihre Stelle unveraendert",
  zielPosition({ ...laeuft, playing: false }, 1_099_000) === 50,
  `${zielPosition({ ...laeuft, playing: false }, 1_099_000)}`);

pruefe("1c. Eine Nachricht aus der Zukunft schiebt nicht zurueck",
  zielPosition(laeuft, 999_000) === 50, `${zielPosition(laeuft, 999_000)}`);

pruefe("1d. Absurd alte Staende werden gedeckelt",
  zielPosition(laeuft, 1_000_000 + 10 * 3600 * 1000) === 50 + 3600,
  `${zielPosition(laeuft, 1_000_000 + 10 * 3600 * 1000)} (Deckel 1 h)`);

pruefe("1e. Ohne Zeitstempel bleibt es bei der Stelle",
  zielPosition({ position: 12, updatedAt: 0, playing: true }, 5_000_000) === 12);

// --- 2. Laufender Betrieb: fast immer nichts tun ------------------------------

const frisch = () => ({ bestaetigt: 0, zustandTreffer: 0, seitSprung: 0, letzteMessung: 0 });
const messung = (extra) => ({
  drift: 0, jetzt: 100000, puffert: false, werbung: false,
  laeuftSoll: true, laeuftIst: true, seitEigenerTat: 60000, ...extra
});

pruefe("2. Zwei Sekunden Versatz werden ausgehalten",
  driftEntscheiden(frisch(), messung({ drift: 2 })) === "ignore");

pruefe("2b. Auch 2,5 Sekunden sind noch kein Grund",
  driftEntscheiden(frisch(), messung({ drift: 2.5 })) === "ignore");

{
  const merker = frisch();
  const erste = driftEntscheiden(merker, messung({ drift: 4, jetzt: 100000 }));
  const zweite = driftEntscheiden(merker, messung({ drift: 4, jetzt: 102000 }));
  pruefe("2c. Erst die zweite bestaetigte Messung springt",
    erste === "beobachten" && zweite === "springen", `${erste} / ${zweite}`);
}

{
  const merker = frisch();
  driftEntscheiden(merker, messung({ drift: 4, jetzt: 100000 }));
  driftEntscheiden(merker, messung({ drift: 4, jetzt: 102000 }));
  const dritte = driftEntscheiden(merker, messung({ drift: 4, jetzt: 104000 }));
  const vierte = driftEntscheiden(merker, messung({ drift: 4, jetzt: 106000 }));
  pruefe("2d. Danach laeuft eine Ruhezeit - es wird nicht nachgehaemmert",
    dritte === "beobachten" && vierte === "cooldown", `${dritte} / ${vierte}`);
}

{
  const merker = frisch();
  driftEntscheiden(merker, messung({ drift: 4, jetzt: 100000 }));
  const spaet = driftEntscheiden(merker, messung({ drift: 4, jetzt: 120000 }));
  pruefe("2e. Reisst die Reihe, faengt das Zaehlen von vorn an",
    spaet === "beobachten", spaet);
}

pruefe("2f. Waehrend Werbung wird gar nicht gemessen",
  driftEntscheiden(frisch(), messung({ drift: 30, werbung: true })) === "werbung");

pruefe("2g. Waehrend des Pufferns wird gar nicht gemessen",
  driftEntscheiden(frisch(), messung({ drift: 30, puffert: true })) === "puffert");

// Der wichtigste Schutz gegen das Zurueckdrehen einer eigenen Tat: wer gerade
// selbst pausiert hat, ist fuer einen Moment neuer als der Raumzustand.
pruefe("2h. Direkt nach einer eigenen Tat wird nichts korrigiert",
  driftEntscheiden(frisch(), messung({ drift: 30, laeuftSoll: false, seitEigenerTat: 500 })) === "frisch");

{
  const merker = frisch();
  const erste = driftEntscheiden(merker, messung({ laeuftSoll: false, laeuftIst: true, jetzt: 100000 }));
  const zweite = driftEntscheiden(merker, messung({ laeuftSoll: false, laeuftIst: true, jetzt: 102000 }));
  pruefe("2i. Ein verpasstes Pause wird nachgeholt - aber erst bestaetigt",
    erste === "beobachten" && zweite === "pause", `${erste} / ${zweite}`);
}

{
  const merker = frisch();
  driftEntscheiden(merker, messung({ laeuftSoll: true, laeuftIst: false, jetzt: 100000 }));
  const zweite = driftEntscheiden(merker, messung({ laeuftSoll: true, laeuftIst: false, jetzt: 102000 }));
  pruefe("2j. Und ein verpasstes Play genauso", zweite === "play", zweite);
}

pruefe("2k. Der Laufzustand kommt vor dem Versatz",
  driftEntscheiden(frisch(), messung({ drift: 30, laeuftSoll: false, laeuftIst: true })) === "beobachten");

// --- 3. Ueberholte Nachrichten abweisen ---------------------------------------

pruefe("3. Ohne Vorgeschichte ist nichts veraltet",
  istVeraltet(null, { rev: 1, updatedAt: 5 }) === false);

pruefe("3b. Eine hoehere Nummer ist immer neuer",
  istVeraltet({ rev: 4, updatedAt: 100 }, { rev: 5, updatedAt: 90 }) === false);

pruefe("3c. Ein verspaetetes Play mit kleinerer Nummer wird abgewiesen",
  istVeraltet({ rev: 9, updatedAt: 200 }, { rev: 7, updatedAt: 150 }) === true);

pruefe("3d. Dieselbe Nummer noch einmal ist ein Nachzuegler",
  istVeraltet({ rev: 9, updatedAt: 200 }, { rev: 9, updatedAt: 200 }) === true);

// Ein neu gestartetes Relay faengt wieder bei eins an. Wuerde nur die Nummer
// zaehlen, waere es dauerhaft ausgesperrt.
pruefe("3e. Ein neu gestartetes Relay wird nicht ausgesperrt",
  istVeraltet({ rev: 40, updatedAt: 1000 }, { rev: 1, updatedAt: 9000 }) === false);

// --- 4. Was ueberhaupt angewendet werden muss ---------------------------------

const stand = (extra) => ({ videoId: "aaaaaaaaaaa", playing: true, rev: 5, byId: "fremd", ...extra });

pruefe("4. Der eigene Zug wird nicht noch einmal angewendet",
  brauchtAnwendung(stand(), stand({ rev: 6, byId: "ich" }), "ich") === false);

pruefe("4b. Der Zug eines anderen schon",
  brauchtAnwendung(stand(), stand({ rev: 6 }), "ich") === true);

pruefe("4c. Derselbe Stand ein zweites Mal aendert nichts",
  brauchtAnwendung(stand(), stand(), "ich") === false);

pruefe("4d. Der erste Stand ueberhaupt wird immer angewendet",
  brauchtAnwendung(null, stand(), "ich") === true);

pruefe("4e. Ohne Video gibt es nichts anzuwenden",
  brauchtAnwendung(null, stand({ videoId: "" }), "ich") === false);

// --- 5. Der Zustand auf der Serverseite ---------------------------------------

serverParty.zuruecksetzen();

function neuerZustand() {
  return {
    videoId: "", url: "", title: "", position: 0, playing: false,
    updatedAt: 0, rev: 0, byId: "", byName: "", members: new Map(), at: Date.now()
  };
}

{
  const z = neuerZustand();
  const aktion = serverParty.ereignisAnwenden(z, {
    action: "video", videoId: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  }, "a", "Anna");
  pruefe("5. Ein Videowechsel setzt Video, Nummer und Urheber",
    aktion === "video" && z.videoId === "dQw4w9WgXcQ" && z.rev === 1 && z.byName === "Anna" && z.playing === true);

  const nochmal = serverParty.ereignisAnwenden(z, { action: "video", videoId: "dQw4w9WgXcQ" }, "b", "Ben");
  pruefe("5b. Dasselbe Video noch einmal ist kein Wechsel - das bricht die Schleife",
    nochmal === null && z.rev === 1, `${nochmal} / rev ${z.rev}`);

  const fremd = serverParty.ereignisAnwenden(z, { action: "pause", videoId: "AAAAAAAAAAA", position: 10 }, "b", "Ben");
  pruefe("5c. Eine Pause aus einem anderen Video haelt die Runde nicht an",
    fremd === null && z.playing === true && z.rev === 1);

  const pause = serverParty.ereignisAnwenden(z, { action: "pause", videoId: "dQw4w9WgXcQ", position: 500 }, "b", "Ben");
  pruefe("5d. Eine Pause aus demselben Video zaehlt",
    pause === "pause" && z.playing === false && z.position === 500 && z.rev === 2);

  const sprung = serverParty.ereignisAnwenden(z, { action: "seek", videoId: "dQw4w9WgXcQ", position: 8 * 60 + 20 }, "c", "Cem");
  pruefe("5e. Ein Sprung auf 8:20 gilt fuer alle",
    sprung === "seek" && z.position === 500 && z.rev === 3 && z.byName === "Cem");

  const unfug = serverParty.ereignisAnwenden(z, { action: "loeschen", videoId: "dQw4w9WgXcQ" }, "c", "Cem");
  pruefe("5f. Was keine bekannte Aktion ist, bewegt nichts",
    unfug === null && z.rev === 3);

  const boese = serverParty.ereignisAnwenden(z, { action: "video", videoId: "../../etc" }, "c", "Cem");
  pruefe("5g. Eine unmoegliche Videokennung wird abgewiesen", boese === null && z.rev === 3);
}

{
  const z = neuerZustand();
  z.videoId = "dQw4w9WgXcQ";
  z.position = 50;
  z.playing = true;
  z.updatedAt = Date.now() - 4000;
  pruefe("5h. Der Server rechnet fuer Nachzuegler mit (50 s + 4 s)",
    nah(serverParty.positionJetzt(z), 54, 0.2), `${serverParty.positionJetzt(z).toFixed(2)}`);
}

pruefe("5i. Nur echte YouTube-Adressen kommen durch",
  serverParty.videoAdresse("javascript:alert(1)", "dQw4w9WgXcQ") === "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  && serverParty.videoAdresse("https://boese.example/x", "dQw4w9WgXcQ") === "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  && serverParty.videoAdresse("https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ") === "https://youtu.be/dQw4w9WgXcQ");

// --- 6. Die Fassade in der App ------------------------------------------------

{
  const gesendet = [];
  const angewendet = [];
  const partei = new YoutubeWatchparty({
    senden: (raum, nachricht) => gesendet.push({ raum, ...nachricht }),
    // Fester Uhrversatz: damit ist die Rechnung hier nachvollziehbar.
    serverJetzt: () => Date.now() + 1000,
    onState: (zustand, hinweis) => angewendet.push({ zustand, hinweis })
  });
  partei.kennung("ich");
  partei.einschalten("wohnzimmer");
  partei.verbindung("wohnzimmer", true);
  pruefe("6. Beim Verbindungsaufbau wird angemeldet",
    gesendet.some((n) => n.type === "ytjoin" && n.raum === "wohnzimmer"));

  const zustandVomRelay = (extra) => ({
    type: "ytstate", room: "wohnzimmer", videoId: "dQw4w9WgXcQ",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Etwas",
    position: 50, livePosition: 52, playing: true,
    updatedAt: Date.now() + 1000, serverNow: Date.now() + 1000,
    rev: 1, byId: "fremd", byName: "Ben",
    members: [{ id: "ich", name: "Ich" }, { id: "fremd", name: "Ben" }],
    ...extra
  });

  partei.nachricht(zustandVomRelay());
  pruefe("6b. Der erste Stand wird angewendet und die Mitglieder stehen",
    angewendet.length === 1 && angewendet[0].hinweis.anwenden === true && partei.beigetreten === true);
  pruefe("6c. Mit gemessener Uhr wird die Serverzeit benutzt",
    partei.stand.zeitbasis === "server" && partei.stand.position === 50, partei.stand.zeitbasis);

  // Ein Nachzuegler mit kleinerer Nummer darf den Stand nicht zuruecksetzen.
  partei.nachricht(zustandVomRelay({ type: "ytevent", action: "pause", rev: 0, playing: false, updatedAt: 1 }));
  pruefe("6d. Ein Nachzuegler bewegt nichts",
    partei.stand.playing === true && angewendet.length === 1);

  partei.nachricht(zustandVomRelay({ type: "ytevent", action: "pause", rev: 2, playing: false, position: 61 }));
  pruefe("6e. Ein neueres Pause dagegen schon",
    partei.stand.playing === false && angewendet.length === 2 && angewendet[1].hinweis.action === "pause");

  // Der eigene Zug kommt zurueck, damit die Nummer bekannt wird - angewendet
  // wird er nicht, er ist hier laengst geschehen.
  partei.nachricht(zustandVomRelay({ type: "ytevent", action: "play", rev: 3, byId: "ich", byName: "Ich" }));
  pruefe("6f. Der eigene Zug wird nicht noch einmal angewendet",
    angewendet.length === 3 && angewendet[2].hinweis.anwenden === false && angewendet[2].hinweis.selbst === true);

  gesendet.length = 0;
  const ausAltemVideo = partei.melden("pause", { videoId: "AAAAAAAAAAA", position: 5 });
  pruefe("6g. Wer noch beim alten Video steht, haelt das neue nicht an",
    ausAltemVideo === false && gesendet.length === 0);

  const echt = partei.melden("pause", { videoId: "dQw4w9WgXcQ", position: 120 });
  pruefe("6h. Eine Pause im laufenden Video geht hinaus",
    echt === true && gesendet[0].type === "ytevent" && gesendet[0].action === "pause");

  // Ein Videowechsel muss auch dann durchkommen, wenn die Runde noch woanders
  // steht - das ist ja gerade der Sinn.
  gesendet.length = 0;
  partei.melden("video", { videoId: "AAAAAAAAAAA", url: "https://www.youtube.com/watch?v=AAAAAAAAAAA" });
  pruefe("6i. Ein Videowechsel kommt immer durch",
    gesendet.length === 1 && gesendet[0].action === "video");

  // Ein fremder Raum darf diesen Player nicht mitziehen.
  const vorher = partei.stand.rev;
  partei.nachricht(zustandVomRelay({ room: "kueche", rev: 99, videoId: "BBBBBBBBBBB" }));
  pruefe("6j. Eine Nachricht aus einem fremden Raum wird liegengelassen",
    partei.stand.rev === vorher, `rev ${partei.stand.rev}`);

  gesendet.length = 0;
  partei.ausschalten();
  pruefe("6k. Ausschalten meldet ordentlich ab",
    gesendet.some((n) => n.type === "ytleave") && partei.aktiv === false);
}

{
  // Ohne gemessene Uhr zaehlt die vom Relay hochgerechnete Stelle, gestempelt
  // mit der eigenen Uhr. Sonst landete die Differenz zweier Systemuhren als
  // Videozeit im Ergebnis.
  const partei = new YoutubeWatchparty({ senden: () => {}, serverJetzt: () => null });
  partei.kennung("ich");
  partei.einschalten("wohnzimmer");
  partei.verbindung("wohnzimmer", true);
  partei.nachricht({
    type: "ytstate", room: "wohnzimmer", videoId: "dQw4w9WgXcQ",
    position: 50, livePosition: 54, playing: true,
    updatedAt: Date.now() - 500000, rev: 1, members: [{ id: "ich", name: "Ich" }]
  });
  pruefe("6l. Ohne Uhrmessung wird auf die eigene Zeitbasis umgestellt",
    partei.stand.zeitbasis === "lokal" && partei.stand.position === 54 && partei.stand.versatz === 0,
    `${partei.stand.zeitbasis} / ${partei.stand.position}`);
}

// --- 7. Die Skripte -----------------------------------------------------------

// Sie werden aus dem Quelltext genau der oben geprueften Funktionen gebaut. Geht
// das schief, laeuft im Player etwas anderes als hier.
pruefe("7. Die geprueften Funktionen stehen woertlich in den Skripten",
  abgleichScript({ position: 1, updatedAt: 2, playing: true }).includes(alsQuelltext(driftEntscheiden))
  && anwendenScript({ position: 1, updatedAt: 2, playing: true }).includes(alsQuelltext(zielPosition)));

pruefe("7b. Jedes Skript ist fuer sich ein gueltiger Ausdruck", (() => {
  for (const quelle of [
    beobachterScript(),
    zuruecksetzenScript(),
    anwendenScript({ position: 5, updatedAt: 9, playing: true }, { aktion: "play", versatz: 12 }),
    abgleichScript({ position: 5, updatedAt: 9, playing: false }, { versatz: -30 })
  ]) {
    try {
      // eslint-disable-next-line no-new-func
      new Function(`return ${quelle};`);
    } catch (fehler) {
      console.log(`      ${fehler.message}`);
      return false;
    }
  }
  return true;
})());

// Aus dem Netz darf nichts in den Player-Rahmen geschrieben werden.
{
  const boese = anwendenScript(
    { position: 1, updatedAt: 2, playing: true, title: '";alert(1);//' },
    { aktion: 'play"; alert(1); //' }
  );
  pruefe("7c. Nichts aus einer Nachricht landet als Text im Skript",
    !boese.includes("alert(1)"));
  // Von der Nachricht kommen nur die drei Zahlen an, mit denen gerechnet wird.
  pruefe("7d. Uebernommen werden nur Stelle, Zeitstempel und Laufzustand",
    boese.includes('{"position":1,"updatedAt":2,"playing":true}'));
}

const durchgefallen = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - durchgefallen}/${pruefungen.length} bestanden`);
process.exit(durchgefallen ? 1 : 0);
