"use strict";
// Sicherung und Wiederherstellung.
//
// Diese Funktion kann Daten ueberschreiben - deshalb wird hier nicht nur
// geprueft, dass alles mitkommt, sondern auch, was ausdruecklich nicht
// mitkommen darf.

const {
  bauen, pruefen, umfang, fehlendeTeile, einstellungenUebernehmen,
  dateiname, selbstName, altePutzen, KENNUNG, FASSUNG
} = require("../src/sicherung");

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(b); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };

const einstellungen = () => ({
  version: 3,
  adblock: { enabled: true, whitelist: ["example.com"] },
  appearance: { designPreset: "elfix", layoutStyle: "standard" },
  playback: { pauseOnBlur: true },
  watchparty: { enabled: true, serverUrl: "wss://relay.example", rooms: ["familie", "freunde"], deviceName: "Wohnzimmer", deviceId: "geraet-abc" }
});

const favoriten = () => ([
  { id: "1", title: "Frieren", url: "https://aniworld.to/anime/stream/frieren", position: 412.5, customThumbnail: "data:image/jpeg;base64,AAAA" },
  { id: "2", title: "Dandadan", url: "https://aniworld.to/anime/stream/dandadan", position: 0 },
  { id: "3", title: "Vinland", url: "https://s.to/serie/stream/vinland", currentTime: 88, customThumbnail: "data:image/jpeg;base64,BBBB" }
]);

const anbieter = () => ([{ id: "aniworld", name: "AniWorld" }, { id: "sto", name: "S.to" }]);
const watchparty = () => ({ shared: [{ key: "serie:frieren", room: "familie" }], joined: [{ key: "serie:frieren", room: "familie" }] });

const voll = () => bauen({
  settings: einstellungen(),
  favorites: favoriten(),
  providers: anbieter(),
  watchparty: watchparty(),
  programm: "1.21.0"
});

// --- 1. Was mitkommt ---------------------------------------------------------

{
  const s = voll();
  // Gegen die Konstante und nicht gegen eine Zahl: die Fassung steigt, wenn
  // etwas dazukommt, und dann soll diese Pruefung mitwandern statt zu brechen.
  pruefe("1. Die Sicherung ist als solche erkennbar",
    s.kennung === KENNUNG && s.fassung === FASSUNG && s.programm === "1.21.0", `${s.kennung} v${s.fassung}`);
  pruefe("1b. Watchlist samt Weiterschauen-Staenden ist drin",
    s.favorites.length === 3 && s.favorites[0].position === 412.5, `${s.favorites.length} Eintraege`);
  pruefe("1c. Die eigenen Bilder sind drin",
    s.favorites.filter((f) => f.customThumbnail).length === 2,
    s.favorites.filter((f) => f.customThumbnail).map((f) => f.title).join(", "));
  pruefe("1d. Einstellungen, Anbieter und Watchparty-Ablage sind drin",
    s.settings.appearance.designPreset === "elfix" && s.providers.length === 2 && s.watchparty.shared.length === 1,
    `${s.providers.length} Anbieter, ${s.watchparty.shared.length} geteilt`);
  pruefe("1e. Die Watchparty-Raeume kommen mit",
    s.settings.watchparty.rooms.join(",") === "familie,freunde", s.settings.watchparty.rooms.join(", "));
  pruefe("1f. Und ein Zeitpunkt steht dabei",
    Boolean(Date.parse(s.erstellt)), s.erstellt);
}

// --- 2. Was ausdruecklich nicht mitkommt -------------------------------------

{
  const s = voll();
  pruefe("2. Die Geraetekennung bleibt draussen",
    s.settings.watchparty.deviceId === "", `"${s.settings.watchparty.deviceId}"`);
  pruefe("2b. Der Geraetename bleibt dagegen drin",
    s.settings.watchparty.deviceName === "Wohnzimmer", s.settings.watchparty.deviceName);
  // Sonst waere die Sicherung groesser als alles, was sie sichert.
  pruefe("2c. Die Zwischenspeicher sind nicht dabei",
    !("filterCache" in s) && !("taste" in s), Object.keys(s).join(", "));
}

{
  // Und das Original darf dabei nicht angefasst werden - sonst waere nach einer
  // Sicherung die eigene Kennung weg und das Geraet in allen Raeumen neu.
  const original = einstellungen();
  bauen({ settings: original, favorites: [], providers: [], watchparty: null, programm: "x" });
  pruefe("2d. Das Erstellen aendert die laufenden Einstellungen nicht",
    original.watchparty.deviceId === "geraet-abc", original.watchparty.deviceId);
}

// --- 3. Umfang, wie er im Dialog steht ---------------------------------------

{
  const u = umfang(voll());
  pruefe("3. Der Umfang zaehlt richtig",
    u.favoriten === 3 && u.bilder === 2 && u.anbieter === 2 && u.raeume === 2 && u.einstellungen,
    `${u.favoriten} Eintraege, ${u.bilder} Bilder, ${u.anbieter} Anbieter, ${u.raeume} Raeume`);
  pruefe("3b. Weiterschauen zaehlt position und currentTime",
    u.weiterschauen === 2, `${u.weiterschauen} von 3`);
}

pruefe("3c. Eine leere Sicherung faellt im Dialog auf",
  umfang(bauen({})).favoriten === 0 && umfang(bauen({})).bilder === 0, "alles null");

// --- 4. Fremde und kaputte Dateien ------------------------------------------

pruefe("4. Eine echte Sicherung wird angenommen", pruefen(voll()).ok === true, "ok");
pruefe("4b. Eine fremde JSON-Datei nicht",
  pruefen({ irgendwas: 1 }).ok === false, pruefen({ irgendwas: 1 }).reason);
pruefe("4c. Und null auch nicht", pruefen(null).ok === false, pruefen(null).reason);
pruefe("4d. Eine Sicherung aus einer neueren Version wird abgelehnt",
  pruefen({ ...voll(), fassung: 99 }).ok === false, pruefen({ ...voll(), fassung: 99 }).reason);
pruefe("4e. Und die Begruendung sagt, woran es liegt",
  /neueren Version/.test(pruefen({ ...voll(), fassung: 99 }).reason), pruefen({ ...voll(), fassung: 99 }).reason);
pruefe("4f. Eine Sicherung ohne Fassung ist keine",
  pruefen({ kennung: KENNUNG }).ok === false, pruefen({ kennung: KENNUNG }).reason);

// --- 5. Beim Einlesen bleibt die eigene Kennung ------------------------------

{
  const s = voll();
  const uebernommen = einstellungenUebernehmen(s.settings, "geraet-dieser-rechner");
  pruefe("5. Beim Einlesen gilt die Kennung dieses Rechners",
    uebernommen.watchparty.deviceId === "geraet-dieser-rechner", uebernommen.watchparty.deviceId);
  pruefe("5b. Alles andere kommt aus der Sicherung",
    uebernommen.watchparty.rooms.join(",") === "familie,freunde"
      && uebernommen.appearance.designPreset === "elfix",
    `${uebernommen.watchparty.rooms.length} Raeume`);
  pruefe("5c. Die Sicherung selbst bleibt dabei unveraendert",
    s.settings.watchparty.deviceId === "", `"${s.settings.watchparty.deviceId}"`);
}

{
  // Frischer Rechner ohne eigene Kennung: dann bleibt sie leer und die App
  // vergibt beim naechsten Verbinden eine neue.
  const uebernommen = einstellungenUebernehmen(voll().settings, "");
  pruefe("5d. Ohne eigene Kennung bleibt das Feld leer",
    uebernommen.watchparty.deviceId === "", `"${uebernommen.watchparty.deviceId}"`);
}

pruefe("5e. Ohne Einstellungen in der Sicherung wird nichts uebernommen",
  einstellungenUebernehmen(null, "abc") === null, "null");

// --- 6. Rundlauf --------------------------------------------------------------

{
  // So, wie es wirklich laeuft: schreiben, lesen, pruefen, uebernehmen.
  const geschrieben = JSON.stringify(voll(), null, 2);
  const gelesen = JSON.parse(geschrieben);
  const u = umfang(gelesen);
  pruefe("6. Nach Schreiben und Lesen ist alles noch da",
    pruefen(gelesen).ok && u.favoriten === 3 && u.bilder === 2
      && gelesen.favorites[0].customThumbnail === "data:image/jpeg;base64,AAAA",
    `${geschrieben.length} Zeichen`);
}

// --- 7. Dateiname -------------------------------------------------------------

pruefe("7. Der Dateiname traegt das Datum",
  dateiname(new Date(2026, 7, 5)) === "ELFIX-Sicherung-2026-08-05.elfix.json",
  dateiname(new Date(2026, 7, 5)));


// --- Was wirklich alles mitmuss ---------------------------------------------
//
// Gemeldet als Wunsch: "es soll wirklich alles vom Benutzer sichern".
//
// Drei Dinge fehlten, und das teuerste davon still: die gemessenen
// Wiedergabesitzungen. Sie sind der ganze Rueckblick - beim Benutzer 224 Saetze
// ueber siebzehn Stunden -, und wer eine Sicherung einlas, verlor sie
// vollstaendig, ohne dass irgendwo etwas davon stand. Fassungen und Marken sind
// Handarbeit je Titel und ebenso wenig nachzubauen.
{
  const voll = bauen({
    settings: { watchparty: { deviceId: "hier", rooms: ["Salon"] } },
    favorites: [{ id: "a", position: 30 }],
    providers: [{ id: "p" }],
    watchparty: { shared: [], joined: [] },
    sitzungen: [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
    fassungen: { "aniworld:bleach": "Deutsch" },
    marken: { "aniworld:bleach:1": { intro: 85 } },
    programm: "1.61.0",
    anlass: "vor-update"
  });

  pruefe("Die Wiedergabesitzungen sind dabei",
    Array.isArray(voll.sitzungen) && voll.sitzungen.length === 3,
    "sie sind gemessene Zeit und kommen nie wieder");
  pruefe("Die gemerkten Sprachfassungen sind dabei",
    voll.fassungen && voll.fassungen["aniworld:bleach"] === "Deutsch");
  pruefe("Die Intromarken sind dabei",
    voll.marken && voll.marken["aniworld:bleach:1"].intro === 85);
  pruefe("Der Anlass steht in der Datei", voll.anlass === "vor-update", voll.anlass);
  pruefe("Die Fassung ist auf 2 gestiegen", voll.fassung === 2 && FASSUNG === 2,
    String(voll.fassung));
  pruefe("Die Geraetekennung bleibt weiter draussen",
    voll.settings.watchparty.deviceId === "",
    "zwei Geraete mit derselben Kennung gelten im Raum als eines");

  const gezaehlt = umfang(voll);
  pruefe("Der Umfang nennt die Sitzungen", gezaehlt.sitzungen === 3, String(gezaehlt.sitzungen));
  pruefe("Der Umfang nennt Fassungen und Marken",
    gezaehlt.fassungen === 1 && gezaehlt.marken === 1,
    JSON.stringify({ f: gezaehlt.fassungen, m: gezaehlt.marken }));
  pruefe("Einer vollen Sicherung fehlt nichts", fehlendeTeile(voll).length === 0);
}

// Eine Sicherung der alten Fassung. Sie muss weiter lesbar sein - und ihr Fehlen
// muss sich von einer leeren Liste unterscheiden lassen: was sie nicht kennt,
// soll beim Einlesen stehenbleiben statt geleert zu werden.
{
  const alt = { kennung: KENNUNG, fassung: 1, settings: null, favorites: [{ id: "a" }], providers: [] };
  pruefe("Eine Sicherung der Fassung 1 bleibt lesbar", pruefen(alt).ok === true);
  const gezaehlt = umfang(alt);
  pruefe("Ihre Sitzungen sind unbekannt und nicht null",
    gezaehlt.sitzungen === null && gezaehlt.fassungen === null && gezaehlt.marken === null,
    JSON.stringify(gezaehlt));
  pruefe("Und es laesst sich benennen, was ihr fehlt",
    fehlendeTeile(alt).join(", ") === "Wiedergabezeiten, gemerkte Sprachfassungen, Intromarken",
    fehlendeTeile(alt).join(", "));
}

// --- Sicherungen, die die App selbst anlegt ---------------------------------
{
  const name = selbstName("vor-update", new Date(2026, 7, 28, 9, 5, 3));
  pruefe("Der Name einer eigenen Sicherung traegt Anlass und Zeit",
    name === "ELFIX-vor-update-20260828-090503.elfix.json", name);
  pruefe("Zwei am selben Tag ueberschreiben einander nicht",
    selbstName("vor-update", new Date(2026, 7, 28, 9, 5, 3))
      !== selbstName("vor-update", new Date(2026, 7, 28, 9, 5, 4)),
    "sonst waere die Rueckfahrkarte weg, sobald man sie zweimal braucht");

  const sieben = [];
  for (let tag = 1; tag <= 7; tag += 1) {
    sieben.push(`ELFIX-vor-update-2026080${tag}-120000.elfix.json`);
  }
  const weg = altePutzen(sieben, 5);
  pruefe("Von sieben eigenen bleiben fuenf", weg.length === 2, `${weg.length} weg`);
  pruefe("Und zwar die aeltesten",
    weg[0].includes("20260801") && weg[1].includes("20260802"), weg.join(", "));
  pruefe("Fremde Dateien im Ordner bleiben unangetastet",
    altePutzen([...sieben, "meine-eigene-sicherung.json", "ELFIX-Sicherung-2026-08-01.elfix.json"], 0)
      .every((name) => /^ELFIX-[a-z-]+-\d{8}-\d{6}/.test(name)),
    "eine von Hand gespeicherte Sicherung raeumt niemand weg");
  pruefe("Weniger als die Grenze raeumt gar nichts weg", altePutzen(sieben.slice(0, 3), 5).length === 0);
}

const fehler = pruefungen.filter((p) => !p).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
