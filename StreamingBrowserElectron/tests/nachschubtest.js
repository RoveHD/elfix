"use strict";
/*
 * Nachschub: kommt zu einer abgeschlossenen Serie noch etwas?
 *
 * Gemeldet: "Black Torch haengt davon ab, dass irgendwann ein Desktop-Geraet
 * laeuft." Und so war es auch - der ganze Vorgang stand in `main.js`, und was
 * dort steht, sieht das Telefon nie. Am Fernseher blieb der archivierte
 * Watchparty-Titel liegen, bis jemand den PC einschaltete.
 *
 * Die Entscheidung steht deshalb jetzt in `nachschub.js`. Geprueft wird hier
 * genau sie - an Ergebnissen und ohne Netz -, und zwar in beide Richtungen:
 * was einen Titel zurueckholt und, viel wichtiger, was ihn ausdruecklich
 * *nicht* zurueckholt. Ein falscher Nachschub ist teurer als ein verpasster: er
 * reisst einen Titel aus der Mediathek, setzt ihn auf eine Folge, die es nicht
 * gibt, und stellt eine archivierte Runde wieder auf aktiv.
 *
 * Der letzte Abschnitt laedt dasselbe Modul noch einmal - diesmal ueber den
 * Lader, den der WebView auf dem Telefon benutzt. Dass beide Seiten dieselbe
 * Datei fahren, ist damit keine Behauptung mehr.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const nachschub = require("../src/nachschub");
const fortschritt = require("../src/fortschritt");

const WURZEL = path.join(__dirname, "..");
const BRUECKEN = path.join(WURZEL, "..", "android/app/src/main/assets/kern/eigen");

const pruefungen = [];
const pruefe = (name, bedingung, detail) => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

const SERIE = "https://aniworld.to/anime/stream/black-torch";
const folge = (staffel, nummer) => `${SERIE}/staffel-${staffel}/episode-${nummer}`;

/** Eine abgeschlossene Serie, wie sie in der Mediathek liegt. */
function abgeschlossen(zusatz = {}) {
  return {
    id: "bt",
    providerId: "aniworld",
    providerName: "AniWorld",
    title: "Black Torch",
    type: "serie",
    url: folge(1, 8),
    normalizedUrl: folge(1, 8),
    season: 1,
    episode: 8,
    finalSeason: 1,
    finalEpisode: 8,
    completed: true,
    completedAt: "2026-08-30T10:00:00.000Z",
    completedManually: false,
    rewatching: false,
    episodeCompleted: false,
    continuePending: false,
    hideFromContinueWatching: false,
    favorite: false,
    progress: 100,
    duration: 1400,
    currentTime: 1399,
    ...zusatz
  };
}

/* ================= 1-5. Die Entscheidung, Fall fuer Fall ================== */

{
  const eintrag = abgeschlossen();
  const urteil = nachschub.nachschubUrteil(eintrag, { seasons: 1, episodes: 8 });
  pruefe("1. Keine neue Folge - der Titel bleibt abgeschlossen",
    urteil.art === "nichts" && urteil.grund === "nichts-neues" && eintrag.completed === true,
    urteil.grund);
}

{
  const eintrag = abgeschlossen();
  const urteil = nachschub.nachschubUrteil(eintrag, { seasons: 1, episodes: 9 });
  Object.assign(eintrag, urteil.aenderung || {});
  pruefe("2. S1E8 -> S1E9: der Titel wird wieder offen",
    urteil.art === "neu"
    && eintrag.url === folge(1, 9)
    && eintrag.season === 1 && eintrag.episode === 9
    && eintrag.completed === false
    && eintrag.episodeCompleted === false
    && eintrag.continuePending === true,
    `${eintrag.url} / ${urteil.label}`);
  pruefe("2b. Die Grenze wandert mit",
    eintrag.finalSeason === 1 && eintrag.finalEpisode === 9);
  pruefe("2c. Und der Stand faengt bei null an",
    eintrag.progress === 0 && eintrag.currentTime === 0 && eintrag.duration === 0,
    "sonst stuende die neue Folge mit dem Balken der alten da");
  pruefe("2d. Steht in Weiterschauen",
    fortschritt.hasContinueProgressRecord(eintrag) === true);
}

{
  const eintrag = abgeschlossen({ url: folge(1, 12), episode: 12, finalEpisode: 12 });
  const urteil = nachschub.nachschubUrteil(eintrag, { seasons: 2, episodes: 1 });
  Object.assign(eintrag, urteil.aenderung || {});
  pruefe("3. S1E12 -> S2E1: der Staffelwechsel wird erkannt",
    urteil.art === "neu" && urteil.grund === "neue-staffel" && eintrag.url === folge(2, 1),
    `${eintrag.url} / ${urteil.label}`);
  pruefe("3b. Die neue Staffel steht als Grenze",
    eintrag.finalSeason === 2);
}

{
  pruefe("4. Dieselben Grenzen wie vorher aendern nichts",
    nachschub.nachschubUrteil(abgeschlossen(), { seasons: 1, episodes: 8 }).art === "nichts");
  pruefe("4b. Auch dann nicht, wenn die Staffelzahl gleich bleibt und die Folge fehlt",
    nachschub.nachschubUrteil(abgeschlossen(), { seasons: 1, episodes: 0 }).art === "nichts",
    "eine Seite ohne lesbare Folgenliste ist keine Auskunft");
}

{
  pruefe("5. Weniger Folgen als vorher: nichts geschieht",
    nachschub.nachschubUrteil(abgeschlossen(), { seasons: 1, episodes: 5 }).grund === "umfang-geschrumpft",
    "so sieht eine halb geladene Staffeluebersicht aus");
  pruefe("5b. Weniger Staffeln ebenso",
    nachschub.nachschubUrteil(
      abgeschlossen({ url: folge(3, 4), season: 3, episode: 4, finalSeason: 3, finalEpisode: 4 }),
      { seasons: 1, episodes: 12 }).grund === "umfang-geschrumpft");
  pruefe("5c. Und gar keine Staffelzahl auch nicht",
    nachschub.nachschubUrteil(abgeschlossen(), { seasons: 0, episodes: 99 }).grund === "umfang-unlesbar");
  pruefe("5d. Ohne bekannte Grenze wird nicht geraten",
    nachschub.nachschubUrteil(abgeschlossen({ finalSeason: 0 }), { seasons: 4, episodes: 9 })
      .grund === "grenze-unbekannt",
    "wer nie eine Grenze gelesen hat, kann keine Ueberschreitung feststellen");
}

/* ================= 6. Was die Anbieterseite alles anrichtet =============== */
//
// Hier laeuft der ganze Durchgang, nicht nur die Entscheidung - mit einem
// Abruf, der sich so schlecht benimmt, wie Anbieterseiten es tun.

const SERIENSEITE = `<a href="/anime/stream/black-torch/staffel-1">1</a>`;
const staffelseite = (bis) => Array.from({ length: bis }, (_, i) => (
  `<tr><td class="episode-number">${i + 1}</td>`
  + `<td class="episode-watch"><a href="/anime/stream/black-torch/staffel-1/episode-${i + 1}">los</a></td></tr>`
)).join("");

async function durchgang(eintrag, holen) {
  const lauf = nachschub.erstellen({ holen, jetzt: () => new Date("2026-09-05T08:00:00.000Z") });
  const liste = [eintrag];
  const ergebnis = await lauf.lauf(liste, 6);
  return { eintrag, ergebnis };
}

(async () => {
  {
    const { eintrag, ergebnis } = await durchgang(abgeschlossen(), async () => null);
    pruefe("6a. Kein Netz: der Eintrag bleibt unangetastet",
      ergebnis.gefunden.length === 0 && eintrag.completed === true && eintrag.url === folge(1, 8));
    pruefe("6b. Der Versuch wird trotzdem gestempelt",
      Boolean(eintrag.newEpisodeCheckedAt),
      "sonst stuende derselbe Titel beim naechsten Durchgang wieder vorn und verstopfte die Runde");
  }

  {
    const { eintrag } = await durchgang(abgeschlossen(), async () => { throw new Error("ECONNRESET"); });
    pruefe("6c. Eine geworfene Ausnahme reisst den Lauf nicht mit",
      eintrag.completed === true && eintrag.url === folge(1, 8));
  }

  {
    const { eintrag } = await durchgang(abgeschlossen(), async () => ({ html: "" }));
    pruefe("6d. Eine leere Seite ist keine Auskunft",
      eintrag.completed === true && eintrag.url === folge(1, 8));
  }

  {
    const { eintrag } = await durchgang(abgeschlossen(),
      async () => ({ html: "<html><body>Just a moment... Cloudflare</body></html>" }));
    pruefe("6e. Eine kaputte Parserantwort ebenso wenig",
      eintrag.completed === true && eintrag.url === folge(1, 8),
      "keine Staffellinks = keine Staffelzahl = kein Nachschub");
  }

  {
    // Die Staffeluebersicht antwortet, die Serienseite nicht.
    const { eintrag } = await durchgang(abgeschlossen(), async (url) => (
      url.includes("staffel-") ? { html: staffelseite(9) } : null
    ));
    pruefe("6f. Halbe Antwort: die Serienseite fehlt, also geschieht nichts",
      eintrag.completed === true && eintrag.url === folge(1, 8));
  }

  {
    // Und jetzt beide, mit einer echten neunten Folge.
    const { eintrag, ergebnis } = await durchgang(abgeschlossen(), async (url) => (
      url.includes("staffel-") ? { html: staffelseite(9) } : { html: SERIENSEITE }
    ));
    pruefe("6g. Antworten beide Seiten, wird der Nachschub gefunden",
      ergebnis.gefunden.length === 1 && eintrag.url === folge(1, 9) && eintrag.completed === false,
      eintrag.url);
    pruefe("6h. Mit Hinweis fuer die Oberflaeche",
      eintrag.newEpisodeLabel === "Folge 9 ist da" && Boolean(eintrag.newEpisodeAt),
      eintrag.newEpisodeLabel);
  }

  {
    // Eine zusammengefasste Folge ist kein Nachschub: sie steht in der Liste,
    // laesst sich aber nicht abspielen.
    const gesammelt = staffelseite(8)
      + `<tr><td class="episode-number">9</td><td class="episode-watch">[In E8 enthalten]</td></tr>`;
    const { eintrag } = await durchgang(abgeschlossen(), async (url) => (
      url.includes("staffel-") ? { html: gesammelt } : { html: SERIENSEITE }
    ));
    pruefe("6i. Eine nur gelistete, nicht abspielbare Folge zaehlt nicht",
      eintrag.completed === true && eintrag.url === folge(1, 8),
      "dieselbe Unterscheidung wie beim Weiterschauen");
  }

  /* ============ 7-8. Watchparty: derselbe Titel, mehrere Raeume =========== */

  {
    const bangus = abgeschlossen({
      id: "bt-bangus", watchpartyRoom: "bangus", watchpartyArchived: true
    });
    const urteil = nachschub.nachschubUrteil(bangus, { seasons: 1, episodes: 9 });
    Object.assign(bangus, urteil.aenderung || {});
    pruefe("7a. Der archivierte Raumtitel wird reaktiviert",
      urteil.art === "neu" && bangus.watchpartyArchived === false && bangus.url === folge(1, 9));
    pruefe("7b. Es bleibt derselbe Eintrag - kein zweiter daneben",
      bangus.id === "bt-bangus" && bangus.watchpartyRoom === "bangus");
    pruefe("7c. Und die private Watchlist entsteht daraus nicht",
      bangus.favorite === false,
      "ein Raum-Eintrag gehoert seiner Runde, nicht der eigenen Merkliste");
    pruefe("7d. Er steht wieder in „Gemeinsam weiterschauen“",
      fortschritt.hasContinueProgressRecord(bangus) === true);
    pruefe("7e. Und meldet sich der Runde als nicht mehr archiviert",
      fortschritt.watchpartyStand(bangus, "Handy").archived === false
      && fortschritt.watchpartyStand(bangus, "Handy").episode === 9,
      "genau diese Meldung holt den Raumtitel drueben zurueck");
  }

  {
    // Bangus ist durch, Familie steht bei Folge 4. Beide gehoeren demselben
    // Werk und duerfen sich trotzdem nicht anfassen.
    const bangus = abgeschlossen({
      id: "bt-bangus", watchpartyRoom: "bangus", watchpartyArchived: true
    });
    const familie = {
      id: "bt-familie", title: "Black Torch", type: "serie", providerId: "aniworld",
      url: folge(1, 4), season: 1, episode: 4, finalSeason: 1, finalEpisode: 8,
      completed: false, continuePending: true, watchpartyRoom: "familie",
      watchpartyArchived: false, progress: 30, duration: 1400, currentTime: 420
    };
    const liste = [bangus, familie];
    const gewaehlt = nachschub.kandidaten(liste, 6);
    pruefe("8a. Nur der abgeschlossene Raumtitel kommt in den Durchgang",
      gewaehlt.length === 1 && gewaehlt[0].id === "bt-bangus",
      gewaehlt.map((e) => e.id).join(","));

    Object.assign(bangus, nachschub.nachschubUrteil(bangus, { seasons: 1, episodes: 9 }).aenderung);
    pruefe("8b. Bangus rueckt auf Folge 9",
      bangus.url === folge(1, 9) && bangus.watchpartyArchived === false);
    pruefe("8c. Familie bleibt bei Folge 4",
      familie.url === folge(1, 4) && familie.currentTime === 420 && familie.progress === 30,
      "kein Stand faellt vom einen Raum in den anderen");
  }

  /* ================= 9-11. Privat, von Hand, Wiederansehen ================ */

  {
    const privat = abgeschlossen({ id: "bt-privat" });
    Object.assign(privat, nachschub.nachschubUrteil(privat, { seasons: 1, episodes: 9 }).aenderung);
    pruefe("9a. Eine private Serie kommt zurueck auf die Watchlist",
      privat.favorite === true && privat.completed === false && privat.continuePending === true);
    pruefe("9b. Und in Weiterschauen",
      fortschritt.hasContinueProgressRecord(privat) === true);
    pruefe("9c. Der Abschlusszeitpunkt geht mit dem Abschluss",
      privat.completedAt === "",
      "ein Titel, der wieder offen ist, wurde nicht an jenem Tag beendet");
  }

  {
    const vonHand = abgeschlossen({ completedManually: true });
    const urteil = nachschub.nachschubUrteil(vonHand, { seasons: 1, episodes: 9 });
    Object.assign(vonHand, urteil.aenderung || {});
    pruefe("10a. Ein von Hand abgehakter Titel wird von echtem Nachschub geoeffnet",
      urteil.art === "neu" && vonHand.completed === false);
    pruefe("10b. Und der Merker geht mit - kein Widerspruch bleibt stehen",
      vonHand.completedManually === false,
      "„abgehakt, aber nicht abgeschlossen“ ist der Zustand, ueber den Titel unrettbar verschwanden");
    const ohneNachschub = abgeschlossen({ completedManually: true });
    nachschub.nachschubUrteil(ohneNachschub, { seasons: 1, episodes: 8 });
    pruefe("10c. Ohne Nachschub bleibt er abgehakt",
      ohneNachschub.completed === true && ohneNachschub.completedManually === true);
  }

  {
    const wieder = abgeschlossen({ rewatching: true, url: folge(1, 2), episode: 2 });
    pruefe("11a. Ein laufendes Wiederansehen kommt gar nicht erst in den Durchgang",
      nachschub.kandidaten([wieder], 6).length === 0,
      "es steht auf einer fruehen Folge und saehe aus wie eine haengengebliebene Serie");
    const urteil = nachschub.nachschubUrteil(wieder, { seasons: 2, episodes: 4 });
    pruefe("11b. Und selbst gefragt sagt die Regel nein",
      urteil.art === "nichts" && urteil.grund === "nicht-abgeschlossen");
    pruefe("11c. Der Durchlauf bleibt unversehrt",
      wieder.url === folge(1, 2) && wieder.completed === true && wieder.rewatching === true);
  }

  /* ==================== Die faire Runde durch den Bestand ================= */

  {
    const bestand = [];
    for (let i = 1; i <= 10; i += 1) {
      bestand.push(abgeschlossen({
        id: `s${i}`,
        title: `Serie ${i}`,
        url: `https://aniworld.to/anime/stream/serie-${i}/staffel-1/episode-8`,
        newEpisodeCheckedAt: i <= 6 ? `2026-09-0${i}T00:00:00.000Z` : ""
      }));
    }
    const erste = nachschub.kandidaten(bestand, 6).map((e) => e.id);
    pruefe("12a. Wer noch nie geprueft wurde, kommt zuerst dran",
      erste.slice(0, 4).sort().join(",") === "s10,s7,s8,s9",
      erste.join(","));
    pruefe("12b. Danach der aelteste Blick",
      erste[4] === "s1" && erste[5] === "s2",
      erste.join(","));

    // Nach einem Durchgang stehen die Geprueften hinten - die Runde wandert.
    for (const eintrag of nachschub.kandidaten(bestand, 6)) {
      eintrag.newEpisodeCheckedAt = "2026-09-10T00:00:00.000Z";
    }
    const zweite = nachschub.kandidaten(bestand, 6).map((e) => e.id);
    pruefe("12c. Beim naechsten Durchgang sind andere dran",
      zweite.includes("s3") && zweite.includes("s4") && !zweite.includes("s7"),
      zweite.join(","));
  }

  /* ============ Dieselbe Entscheidung auf dem Telefon ===================== */
  //
  // Nicht nachgebaut, sondern geladen: der Lader ist derselbe, den der WebView
  // benutzt, und er laesst nur durch, was auch wirklich mitfaehrt.

  const KERN_MODULE = new Set(
    fs.readFileSync(path.join(WURZEL, "..", "android/app/build.gradle"), "utf8")
      .split("\n")
      .map((zeile) => (zeile.match(/"((?:src|shared)\/[a-z-]+\.js)"/) || [])[1])
      .filter(Boolean)
      .map((pfad) => path.basename(pfad, ".js"))
  );
  pruefe("13a. nachschub.js faehrt auf dem Telefon mit",
    KERN_MODULE.has("nachschub"),
    "ohne den Eintrag in kernModule fehlt das Modul zur Laufzeit");

  const antworten = new Map();
  const modul = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(BRUECKEN, "nachschub-bruecke.js"), "utf8"), {
    require: (gesucht) => {
      if (!KERN_MODULE.has(gesucht)) {
        throw new Error(`"${gesucht}" steht nicht in kernModule und faehrt nicht mit`);
      }
      const unter = fs.existsSync(path.join(WURZEL, "src", `${gesucht}.js`)) ? "src" : "shared";
      return require(path.join(WURZEL, unter, `${gesucht}.js`));
    },
    module: modul,
    exports: modul.exports,
    console,
    window: { AndroidKern: { protokoll: () => {} } },
    // Der fetch des Telefons geht ueber Java. Hier steht an seiner Stelle die
    // Antwort, die auch der Rechner bekommen wuerde - gepruefte wird die
    // Entscheidung, nicht die Leitung.
    fetch: async (url) => {
      const html = antworten.get(url.includes("staffel-") ? "staffel" : "serie");
      if (html == null) return { ok: false };
      return { ok: true, url, text: async () => html };
    },
    setTimeout, clearTimeout, Date, JSON, Math, Number, String, Object, Array, Boolean,
    Set, Map, Error, RegExp, URL, Promise, Symbol
  });
  const bruecke = modul.exports;

  pruefe("13b. Die Bruecke faehrt dieselben Zahlen wie der Rechner",
    bruecke.PRO_LAUF === nachschub.PRO_LAUF && bruecke.INTERVALL_MS === nachschub.INTERVALL_MS,
    `${bruecke.PRO_LAUF} / ${bruecke.INTERVALL_MS}`);

  antworten.set("serie", SERIENSEITE);
  antworten.set("staffel", staffelseite(9));

  // Derselbe Eintrag, einmal ueber den Rechner, einmal ueber das Telefon.
  const amRechner = abgeschlossen({ id: "bt-pc", watchpartyRoom: "bangus", watchpartyArchived: true });
  const amTelefon = abgeschlossen({ id: "bt-tv", watchpartyRoom: "bangus", watchpartyArchived: true });

  const rechnerLauf = nachschub.erstellen({
    holen: async (url) => ({ html: antworten.get(url.includes("staffel-") ? "staffel" : "serie") })
  });
  await rechnerLauf.lauf([amRechner], 6);
  const telefonErgebnis = await bruecke.lauf({ favoriten: [amTelefon] }, 6);

  const vergleichbar = (eintrag) => JSON.stringify({
    url: eintrag.url,
    season: eintrag.season,
    episode: eintrag.episode,
    finalSeason: eintrag.finalSeason,
    finalEpisode: eintrag.finalEpisode,
    completed: eintrag.completed,
    completedManually: eintrag.completedManually,
    episodeCompleted: eintrag.episodeCompleted,
    continuePending: eintrag.continuePending,
    favorite: eintrag.favorite,
    watchpartyArchived: eintrag.watchpartyArchived,
    label: eintrag.newEpisodeLabel
  });

  const gleich = vergleichbar(amRechner) === vergleichbar(amTelefon);
  pruefe("13c. Rechner und Telefon entscheiden fuer dieselbe Eingabe dasselbe",
    gleich,
    gleich ? "dieselbe Datei, dieselbe Antwort" : `${vergleichbar(amRechner)} != ${vergleichbar(amTelefon)}`);
  pruefe("13d. Das Telefon meldet den Fund samt Raum zurueck",
    telefonErgebnis.gefunden.length === 1
    && telefonErgebnis.gefunden[0].raum === "bangus"
    && telefonErgebnis.gefunden[0].label === "Folge 9 ist da",
    JSON.stringify(telefonErgebnis.gefunden));
  pruefe("13e. Damit haengt der Nachschub an keinem Desktop mehr",
    amTelefon.watchpartyArchived === false && amTelefon.url === folge(1, 9),
    amTelefon.url);

  // Und dieselbe Vorsicht drueben: keine Antwort, keine Aenderung.
  antworten.clear();
  const stur = abgeschlossen({ id: "bt-stur" });
  await bruecke.lauf({ favoriten: [stur] }, 6);
  pruefe("13f. Auch auf dem Telefon aendert ein Fehlschlag nichts",
    stur.completed === true && stur.url === folge(1, 8) && Boolean(stur.newEpisodeCheckedAt));

  const fehler = pruefungen.filter((x) => !x).length;
  console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
  process.exit(fehler ? 1 : 0);
})().catch((fehler) => {
  console.error("Abgebrochen:", fehler.stack || fehler.message);
  process.exit(2);
});
