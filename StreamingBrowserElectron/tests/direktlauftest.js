"use strict";
// Der Weg vom Link zur Adresse - mit allen Sackgassen.
//
// Geholt wird ueber eine hineingereichte Funktion, also steht hier eine
// Tabelle aus Adressen und Seiten statt eines Netzes. Gemessen wird nicht nur,
// dass der Weg ans Ziel fuehrt, sondern vor allem, dass er da aufhoert, wo er
// aufhoeren soll: bei der Schleife, beim vierten Sprung, beim 403, bei der
// Antwort, die zu gross ist, um eine Seite zu sein.
//
// Der Referer ist dabei kein Beiwerk, sondern Gegenstand der Pruefung. Die
// Auslieferung der Hoster haengt daran: eine Adresse, die im Player laeuft,
// liefert nackt abgerufen ein 403. Deshalb wird hier mitgeschrieben, mit
// welchem Referer jede Station geholt wurde - und geprueft, dass die
// zurueckgegebene Auskunft den nennt, unter dem die Quelle spaeter wirklich
// abzuspielen ist.

const direktlauf = require("../src/direktlauf");

const pruefungen = [];
const pruefe = (name, bedingung, detail = "") => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

/* ------------------------------------------------------------- Das Netz-Attrappe */

/**
 * Eine Antwort, wie `fetch` sie liefert - nur aus einer Tabelle.
 *
 * `kopfzeilen` ist absichtlich mit dabei: an `content-length` haengt die
 * Entscheidung, eine Antwort gar nicht erst zu lesen.
 */
function antwort(text, { status = 200, url = "", kopfzeilen = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (name) => kopfzeilen[String(name).toLowerCase()] ?? null },
    text: async () => text
  };
}

function netz(tabelle) {
  const protokoll = [];
  const holen = async (adresse, aufbau) => {
    protokoll.push({ adresse, referer: aufbau?.headers?.referer || "" });
    const eintrag = tabelle[adresse];
    if (typeof eintrag === "function") return eintrag(adresse, aufbau);
    if (eintrag === undefined) return antwort("", { status: 404, url: adresse });
    if (typeof eintrag === "string") return antwort(eintrag, { url: adresse });
    return antwort(eintrag.text || "", { status: eintrag.status, url: eintrag.url || adresse, kopfzeilen: eintrag.kopfzeilen });
  };
  return { holen, protokoll };
}

const PLAYLIST = "https://cdn.example/hls/abc/index.m3u8";
const spielerSeite = `<html><body><script>jwplayer("p").setup({ sources: [
  { file: "${PLAYLIST}", label: "1080p" }
]});</script></body></html>`;

/* ------------------------------------------------------------------ Der Weg */

(async () => {
  const drei = netz({
    "https://anbieter.example/redirect/12345": `<html><head><meta http-equiv="refresh" content="0;url=https://hoster.example/e/abc"></head></html>`,
    "https://hoster.example/e/abc": `<html><script>window.location.href = "https://tages.example/e/abc";</script></html>`,
    "https://tages.example/e/abc": spielerSeite
  });
  const lauf = direktlauf.erstellen({ holen: drei.holen, kennung: "PruefKennung/1" });
  const gefunden = await lauf.aufloesen("https://anbieter.example/redirect/12345",
    "https://anbieter.example/anime/stream/serie/staffel-1/episode-1");

  pruefe("Drei Stationen fuehren zur Playlist",
    gefunden.ok && gefunden.quelle.adresse === PLAYLIST,
    gefunden.ok ? gefunden.quelle.adresse : gefunden.grund);
  pruefe("Der Weg wird mitgeschrieben",
    gefunden.stationen.length === 3 && gefunden.stationen[2] === "https://tages.example/e/abc",
    gefunden.stationen.join(" -> "));
  pruefe("Die erste Station bekommt die Folgenseite als Referer",
    drei.protokoll[0].referer === "https://anbieter.example/anime/stream/serie/staffel-1/episode-1",
    drei.protokoll[0].referer);
  pruefe("Jede weitere Station bekommt die vorige",
    drei.protokoll[1].referer === "https://anbieter.example/redirect/12345"
    && drei.protokoll[2].referer === "https://hoster.example/e/abc",
    drei.protokoll.map((e) => e.referer).join(" | "));
  pruefe("Zurueck kommt der Referer, unter dem die Quelle wirklich laeuft",
    gefunden.kopfzeilen.referer === "https://tages.example/e/abc"
    && gefunden.kopfzeilen.origin === "https://tages.example",
    JSON.stringify(gefunden.kopfzeilen));
  pruefe("Die Kennung geht mit hinaus und kommt mit zurueck",
    gefunden.kopfzeilen["user-agent"] === "PruefKennung/1");

  /* ------------------------------------------------------------ Die Sackgassen */

  const kreis = netz({
    "https://a.example/1": `<script>window.location.href = "https://b.example/2";</script>`,
    "https://b.example/2": `<script>window.location.href = "https://a.example/1";</script>`
  });
  const imKreis = await direktlauf.erstellen({ holen: kreis.holen }).aufloesen("https://a.example/1");
  pruefe("Eine Weiterleitung im Kreis wird erkannt und nicht ausgesessen",
    !imKreis.ok && imKreis.grund === "Weiterleitung im Kreis",
    imKreis.grund);
  pruefe("Und sie kostet nur zwei Abrufe",
    kreis.protokoll.length === 2,
    String(kreis.protokoll.length));

  const kette = {};
  for (let i = 0; i < 9; i += 1) {
    kette[`https://k.example/${i}`] = `<script>window.location.href = "https://k.example/${i + 1}";</script>`;
  }
  const lang = netz(kette);
  const zuLang = await direktlauf.erstellen({ holen: lang.holen }).aufloesen("https://k.example/0");
  pruefe("Nach vier Stationen ist Schluss",
    !zuLang.ok && zuLang.grund === "zu viele Weiterleitungen" && lang.protokoll.length === 4,
    `${zuLang.grund} nach ${lang.protokoll.length}`);

  const verboten = netz({ "https://h.example/e/1": { status: 403, text: "nope" } });
  const abgewiesen = await direktlauf.erstellen({ holen: verboten.holen }).aufloesen("https://h.example/e/1");
  pruefe("Ein 403 wird als solches gemeldet, nicht als 'nichts gefunden'",
    !abgewiesen.ok && abgewiesen.grund === "HTTP 403",
    abgewiesen.grund);

  const riesig = netz({
    "https://h.example/e/2": { text: "x", kopfzeilen: { "content-length": String(direktlauf.HOECHSTGROESSE + 1) } }
  });
  const zuGross = await direktlauf.erstellen({ holen: riesig.holen }).aufloesen("https://h.example/e/2");
  pruefe("Was zu gross fuer eine Seite ist, wird nicht gelesen",
    !zuGross.ok && zuGross.grund === "Antwort zu gross",
    zuGross.grund);

  const stumm = netz({ "https://h.example/e/3": "<html><body>Datei nicht gefunden</body></html>" });
  const ohneQuelle = await direktlauf.erstellen({ holen: stumm.holen }).aufloesen("https://h.example/e/3");
  pruefe("Ein Hoster ohne Quelle ist ein sauberes Nein",
    !ohneQuelle.ok && ohneQuelle.quelle === null && ohneQuelle.grund !== "",
    ohneQuelle.grund);

  const kaputt = { holen: async () => { throw new Error("ERR_CONNECTION_RESET"); } };
  const nichtDa = await direktlauf.erstellen(kaputt).aufloesen("https://h.example/e/4");
  pruefe("Ein Netzfehler wirft nicht, er wird gemeldet",
    !nichtDa.ok && /ERR_CONNECTION_RESET/.test(nichtDa.grund),
    nichtDa.grund);

  const ohneNetz = await direktlauf.erstellen({}).aufloesen("https://h.example/e/5");
  pruefe("Ohne hineingereichtes Netz passiert gar nichts",
    !ohneNetz.ok && ohneNetz.grund === "kein Netzzugang gereicht");

  const schrott = await direktlauf.erstellen({ holen: async () => antwort("") })
    .aufloesen("javascript:alert(1)");
  pruefe("Was keine Adresse ist, wird nicht geholt",
    !schrott.ok && schrott.grund === "keine brauchbare Adresse",
    schrott.grund);

  /* ------------------------------------------------- Die Adresse der Antwort */

  const umgeleitet = netz({
    "https://h.example/e/6": { text: spielerSeite, url: "https://tages.example/e/6" }
  });
  const nachUmleitung = await direktlauf.erstellen({ holen: umgeleitet.holen }).aufloesen("https://h.example/e/6");
  pruefe("Leitet der Server selbst um, gilt die Adresse, bei der man ankam",
    nachUmleitung.ok && nachUmleitung.seite === "https://tages.example/e/6"
    && nachUmleitung.kopfzeilen.referer === "https://tages.example/e/6",
    nachUmleitung.seite);

  const fehler = pruefungen.filter((ok) => !ok).length;
  console.log(`
${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  process.exit(fehler ? 1 : 0);
})();
