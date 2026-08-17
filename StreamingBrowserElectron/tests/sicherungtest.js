"use strict";
// Sicherung und Wiederherstellung.
//
// Diese Funktion kann Daten ueberschreiben - deshalb wird hier nicht nur
// geprueft, dass alles mitkommt, sondern auch, was ausdruecklich nicht
// mitkommen darf.

const { bauen, pruefen, umfang, einstellungenUebernehmen, dateiname, KENNUNG } = require("../src/sicherung");

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
  pruefe("1. Die Sicherung ist als solche erkennbar",
    s.kennung === KENNUNG && s.fassung === 1 && s.programm === "1.21.0", `${s.kennung} v${s.fassung}`);
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

const fehler = pruefungen.filter((p) => !p).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
