"use strict";
// Was in einem Manifest steht - und was die Endung nicht verrät.
//
// Drei Fragen haengen an diesem Modul, und jede entscheidet ueber ein schwarzes
// Bild: Master oder Media, wie lang, und welche Spuren es gibt. Die Proben hier
// tragen die Form echter Playlists, sind aber von Hand geschrieben - eine echte
// gehoert nicht in ein oeffentliches Repository, sie enthaelt einen Schluessel.

const manifest = require("../src/manifest");

const pruefungen = [];
const pruefe = (name, bedingung, detail = "") => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

const MASTER = `#EXTM3U
#EXT-X-VERSION:4
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Deutsch",LANGUAGE="de",DEFAULT=YES,URI="subs/de.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Japanisch",LANGUAGE="ja",DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,NAME="360p"
360/index.m3u8
# eine Bemerkung dazwischen
#EXT-X-STREAM-INF:BANDWIDTH=4200000,RESOLUTION=1920x1080,NAME="1080p"
1080/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2100000,RESOLUTION=1280x720
720/index.m3u8`;

const MEDIA = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:10.0,
seg-1.ts
#EXTINF:10.0,
seg-2.ts
#EXTINF:4.5,
seg-3.ts
#EXT-X-ENDLIST`;

const VORSPANN = `#EXTM3U
#EXTINF:15.0,
werbung-1.ts
#EXTINF:15.0,
werbung-2.ts
#EXT-X-ENDLIST`;

const LIVE = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:9331
#EXTINF:6.0,
9331.ts
#EXTINF:6.0,
9332.ts`;

/* ------------------------------------------------------------- Die Einordnung */

pruefe("Ein Master wird als Master erkannt", manifest.art(MASTER) === "master");
pruefe("Eine Media-Playlist als Media", manifest.art(MEDIA) === "media");
pruefe("Ein MPD als DASH", manifest.art(`<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011">`) === "dash");
pruefe("Eine HTML-Fehlerseite ist kein Manifest",
  manifest.art("<html><body>404</body></html>") === "unbekannt",
  "sie kommt oft genug unter einer .m3u8-Adresse");
pruefe("Leerer Text auch nicht", manifest.art("") === "unbekannt");
pruefe("Stehen Stufen und Stücke zusammen, gilt der Master",
  manifest.art(`${MASTER}\n#EXTINF:10.0,\nx.ts`) === "master",
  "er ist die umfassendere Auskunft");

/* ---------------------------------------------------------------- Der Master */

const gelesen = manifest.lesen(MASTER, "https://cdn.example/v/abc/master.m3u8");
pruefe("Alle drei Stufen stehen da", gelesen.stufen.length === 3, String(gelesen.stufen.length));
pruefe("Die Adressen sind vollständig",
  gelesen.stufen[0].adresse === "https://cdn.example/v/abc/360/index.m3u8",
  gelesen.stufen[0].adresse);
pruefe("Die Höhe kommt aus der Auflösung",
  gelesen.stufen.map((s) => s.hoehe).join(",") === "360,1080,720");
pruefe("Eine Bemerkung zwischen Beschreibung und Adresse stört nicht",
  gelesen.stufen[1].adresse.endsWith("1080/index.m3u8"),
  gelesen.stufen[1].adresse);
pruefe("Die beste Stufe ist die höchste",
  manifest.besteStufe(gelesen.stufen).hoehe === 1080);
pruefe("Untertitel werden gefunden",
  gelesen.untertitel.length === 1 && gelesen.untertitel[0].sprache === "de"
  && gelesen.untertitel[0].adresse === "https://cdn.example/v/abc/subs/de.m3u8",
  JSON.stringify(gelesen.untertitel));
pruefe("Eine Tonspur ohne eigene Adresse zählt trotzdem",
  gelesen.tonspuren.length === 1 && gelesen.tonspuren[0].name === "Japanisch",
  "sie liegt im Bild mit - der Player wählt sie");

/* ----------------------------------------------------------------- Die Media */

const media = manifest.lesen(MEDIA);
pruefe("Die Laufzeit ist die Summe der Stücke", media.laufzeit === 25, String(media.laufzeit));
pruefe("Und die Stücke werden gezählt", media.stuecke === 3);
pruefe("Mit ENDLIST ist sie nicht live", media.live === false);
pruefe("Ohne ENDLIST schon", manifest.lesen(LIVE).live === true,
  "dort ist die Laufzeit bedeutungslos - es steht nur ein Fenster in der Liste");

/* ------------------------------------------------ Wofür das alles gebraucht wird */

// Das ist der Fall, um den es geht: zwei Playlists, gleiche Endung, gleiche
// Herkunft - und nur eine davon ist der Film.
pruefe("Vorspann und Folge sind an der Laufzeit zu unterscheiden",
  manifest.lesen(VORSPANN).laufzeit === 30 && manifest.lesen(MEDIA).laufzeit === 25,
  "keine Heuristik über Adressen kommt da heran");

/* ------------------------------------------------------------------- DASH */

const dash = manifest.lesen(`<MPD type="static" mediaPresentationDuration="PT1H23M45.6S"></MPD>`);
pruefe("Aus dem MPD kommt die Gesamtdauer", dash.laufzeit === 5026, String(dash.laufzeit));
pruefe("Und ein dynamisches MPD ist live",
  manifest.lesen(`<MPD type="dynamic"></MPD>`).live === true);
pruefe("Eine kaputte Dauer bringt nichts zum Absturz",
  manifest.isoDauer("Unsinn") === 0 && manifest.isoDauer("") === 0);

/* ----------------------------------------------------------------- Robustheit */

pruefe("Nichts hinein, nichts heraus - aber immer dieselbe Form",
  manifest.lesen("").art === "unbekannt"
  && Array.isArray(manifest.lesen("").stufen)
  && Array.isArray(manifest.lesen(null).untertitel),
  "der Aufrufer soll nicht drei Fälle unterscheiden müssen");
pruefe("Eine Stufe ohne Adresse fällt weg",
  manifest.lesen("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n").stufen.length === 0);
pruefe("Ein javascript:-Ziel ist keine Stufe",
  manifest.lesen("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\njavascript:alert(1)").stufen.length === 0);

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`
${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
