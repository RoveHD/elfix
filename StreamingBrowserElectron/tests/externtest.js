"use strict";
// Die Metadaten-Schicht der App.
//
// Zwei Fragen werden hier gestellt, und beide haben nichts damit zu tun, ob
// TMDB antwortet.
//
//   1. Wird ein falscher Treffer erkannt? Der Server ist grosszuegig, weil er
//      grosszuegig sein muss - er kennt nur den Titel, den man ihm schickt.
//      Die Pruefung findet hier statt, und sie muss den Fall "Es" gegen "Es
//      war einmal in Deutschland" wegwerfen, ohne "Demon Slayer" gegen "Demon
//      Slayer: Kimetsu no Yaiba" mitzunehmen.
//
//   2. Was passiert, wenn niemand antwortet? Kein Netz, Zeitgrenze, 429, 500,
//      Unsinn im Koerper - jedes Mal dieselbe Antwort: keine externen Daten,
//      kein Absturz, keine Haenger.
//
// Alle Antworten sind gestellt. Eine Pruefung, die ans Netz geht, prueft die
// Laune von jemand anderem.

const M = require("../src/metadaten");

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(b); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };

// --- Ein gestelltes Relay ----------------------------------------------------

function relayBauen(regeln = {}) {
  const rufe = [];
  const holen = async (url, aufbau = {}) => {
    rufe.push({ url: String(url), koerper: aufbau.body ? JSON.parse(aufbau.body) : null });
    if (regeln.wirft) throw Object.assign(new Error(regeln.wirft), { name: regeln.wirft });
    if (regeln.status && regeln.status >= 400) {
      return {
        ok: false,
        status: regeln.status,
        headers: { get: (name) => (name === "retry-after" ? String(regeln.wartenS || "") : null) },
        json: async () => ({ fehler: "x" })
      };
    }
    const koerper = aufbau.body ? JSON.parse(aufbau.body) : {};
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => (regeln.antwort ? regeln.antwort(koerper, rufe.length) : { treffer: [] })
    };
  };
  return { holen, rufe };
}

// Eine Antwort, wie sie das Relay wirklich schickt.
function treffer(id, form) {
  return { id, ...M.leerform("film"), ...form };
}

let uhr = 1000;
const jetzt = () => uhr;

function clientBauen(regeln, extra = {}) {
  const relay = relayBauen(regeln);
  const client = M.erstellen({
    basis: "https://relay.test",
    holen: relay.holen,
    jetzt,
    pause: 0,
    schlafen: async () => {},
    ...extra
  });
  return { client, relay };
}

// --- 1. Namensdeckung: der Kern der Sicherung --------------------------------

pruefe("1a. Gleicher Titel deckt voll", M.namensDeckung("Dark", "Dark") === 1);
pruefe("1b. Ein Wort in einem viel laengeren Titel deckt kaum",
  M.namensDeckung("Es", "Es war einmal in Deutschland") < 0.4,
  M.namensDeckung("Es", "Es war einmal in Deutschland").toFixed(2));
pruefe("1c. Aber die uebliche Kurzform bleibt erkennbar",
  M.namensDeckung("Demon Slayer", "Demon Slayer: Kimetsu no Yaiba") > 0.7,
  M.namensDeckung("Demon Slayer", "Demon Slayer: Kimetsu no Yaiba").toFixed(2));
pruefe("1d. Ein Jahreszusatz stoert nicht",
  M.namensDeckung("Hunter x Hunter", "Hunter x Hunter (2011)") >= 0.9);
pruefe("1e. Zwei fremde Titel decken sich nicht",
  M.namensDeckung("Paw Patrol", "Die Legende von Korra") < 0.2);
pruefe("1f. Satzzeichen und Gross-/Kleinschreibung zaehlen nicht",
  M.namensDeckung("Avatar - Der Herr der Elemente", "Avatar: Der Herr der Elemente") === 1);

// --- 2. Die Pruefung korrigiert nach unten ----------------------------------

{
  const wunsch = M.wunschBauen({ art: "film", titel: "Es", jahr: 2017 });
  const geprueft = M.pruefen(wunsch, {
    konfidenz: "HIGH", titel: "Es war einmal in Deutschland",
    originalTitel: "Es war einmal in Deutschland", jahr: 2017, quelle: "tmdb"
  });
  pruefe("2a. Der falsche Treffer faellt durch, obwohl der Server HIGH meldet",
    geprueft.konfidenz === "UNMATCHED", geprueft.konfidenz + " / " + geprueft.grund);
}
{
  const wunsch = M.wunschBauen({ art: "serie", titel: "The Flash", jahr: 2014 });
  const geprueft = M.pruefen(wunsch, {
    konfidenz: "EXACT", titel: "The Flash", originalTitel: "The Flash", jahr: 2023, quelle: "tmdb"
  });
  pruefe("2b. Das falsche Jahr kippt den Treffer",
    geprueft.konfidenz === "UNMATCHED", geprueft.konfidenz + " / " + geprueft.grund);
}
{
  // Serien laufen ueber Jahre. Nennt der Anbieter das Jahr einer spaeteren
  // Staffel, ist das kein anderes Werk.
  const wunsch = M.wunschBauen({ art: "serie", titel: "Game of Thrones", jahr: 2015 });
  const geprueft = M.pruefen(wunsch, {
    konfidenz: "HIGH", titel: "Game of Thrones", jahr: 2011, bisJahr: 2019, quelle: "tmdb"
  });
  pruefe("2c. Ein Jahr innerhalb der Laufzeit bleibt gueltig",
    geprueft.konfidenz === "HIGH", geprueft.konfidenz);
}
{
  const wunsch = M.wunschBauen({ art: "film", titel: "Irgendwas", jahr: 1999, imdb: "tt0371746" });
  const geprueft = M.pruefen(wunsch, {
    konfidenz: "LOW", titel: "Iron Man", jahr: 2008, quelle: "tmdb",
    externeIds: { tmdb: 1726, imdb: "tt0371746" }
  });
  pruefe("2d. Die IMDB-Kennung entscheidet allein - Titel und Jahr zaehlen dann nicht",
    geprueft.konfidenz === "EXACT", geprueft.konfidenz);
}
{
  const wunsch = M.wunschBauen({ art: "serie", titel: "Avatar - Der Herr der Elemente", jahr: 2005 });
  const geprueft = M.pruefen(wunsch, {
    konfidenz: "HIGH", titel: "Avatar - Der Herr der Elemente",
    originalTitel: "Avatar: The Last Airbender", jahr: 2005,
    altTitel: ["Avatar: Der Herr der Elemente"], quelle: "tmdb"
  });
  pruefe("2e. Der deutsche Titel wird auch unter den Alternativtiteln gefunden",
    geprueft.konfidenz === "HIGH", geprueft.konfidenz + " Deckung " + geprueft.deckung);
}
{
  const wunsch = M.wunschBauen({ art: "film", titel: "Spider-Man" });
  const geprueft = M.pruefen(wunsch, {
    konfidenz: "EXACT", titel: "Spider-Man", jahr: 2002, quelle: "tmdb"
  });
  pruefe("2f. Ohne Jahr bleibt selbst ein voller Namenstreffer bei EXACT nur, wenn der Name genau passt",
    geprueft.konfidenz === "EXACT", geprueft.konfidenz);
}

// --- 2b. Die Korrektur nach oben - und ihre Grenzen --------------------------

{
  // Anbieter schreiben zusammen, Datenbanken trennen. Der Server sieht keine
  // gemeinsamen Woerter und meldet LOW; hier ist es derselbe Name.
  const wunsch = M.wunschBauen({ art: "anime", titel: "Dragonball", jahr: 1986 });
  const geprueft = M.pruefen(wunsch, {
    konfidenz: "LOW", quelle: "anilist", titel: "Dragon Ball",
    originalTitel: "DRAGON BALL", jahr: 1986, externeIds: { anilist: 223 }
  });
  pruefe("2g. Gleicher Name, nur anders getrennt: der Treffer wird angehoben",
    geprueft.konfidenz === "HIGH", geprueft.konfidenz + " / " + geprueft.grund);
}
{
  // Aber nur mit passendem Jahr.
  const wunsch = M.wunschBauen({ art: "anime", titel: "Dragonball" });
  const geprueft = M.pruefen(wunsch, {
    konfidenz: "LOW", quelle: "anilist", titel: "Dragon Ball", jahr: 1986
  });
  pruefe("2h. Ohne Jahr wird nichts angehoben", geprueft.konfidenz === "LOW", geprueft.konfidenz);
}
{
  // Und niemals bei einem Namen, der sich nicht deckt - der Fall "Es" bleibt,
  // wie er war.
  const wunsch = M.wunschBauen({ art: "film", titel: "Es", jahr: 2017 });
  const geprueft = M.pruefen(wunsch, {
    konfidenz: "LOW", titel: "Es war einmal in Deutschland", jahr: 2017, quelle: "tmdb"
  });
  pruefe("2i. Ein halber Name wird auch mit passendem Jahr nicht angehoben",
    geprueft.konfidenz === "UNMATCHED", geprueft.konfidenz);
}
{
  // Die Anhebung endet bei HIGH - EXACT bleibt der IMDB-Aufloesung vorbehalten.
  const wunsch = M.wunschBauen({ art: "serie", titel: "Dark", jahr: 2017 });
  const geprueft = M.pruefen(wunsch, {
    konfidenz: "MEDIUM", titel: "Dark", jahr: 2017, quelle: "tmdb"
  });
  pruefe("2j. Angehoben wird hoechstens bis HIGH", geprueft.konfidenz === "HIGH", geprueft.konfidenz);
}
{
  // Ein bereits hoeherer Wert bleibt unangetastet.
  const wunsch = M.wunschBauen({ art: "serie", titel: "Dark", jahr: 2017 });
  const geprueft = M.pruefen(wunsch, {
    konfidenz: "EXACT", titel: "Dark", jahr: 2017, quelle: "tmdb"
  });
  pruefe("2k. EXACT bleibt EXACT", geprueft.konfidenz === "EXACT", geprueft.konfidenz);
}
{
  // Zusammengeschrieben heisst gleich, nicht enthalten.
  pruefe("2l. Die Zusammenschreibung macht aus Dragonball kein Dragon Ball Z",
    M.namensDeckung("Dragonball", "Dragon Ball Z") === 0,
    String(M.namensDeckung("Dragonball", "Dragon Ball Z")));
}

// --- 3. Kurzform als zweiter Versuch ----------------------------------------

pruefe("3a. Ein Zusatz wird abgetrennt", M.kurzform("Avatar - Der Herr der Elemente") === "Avatar");
pruefe("3b. Ein Titel ohne Zusatz ergibt keine Kurzform", M.kurzform("Iron Man") === "");
pruefe("3c. Und kein Bruchstueck", M.kurzform("Es - x") === "");

{
  // Erster Versuch findet nichts, der zweite mit der Kurzform trifft - und der
  // volle Titel taucht bei TMDB unter den Alternativtiteln wieder auf.
  const { client, relay } = clientBauen({
    antwort: (koerper) => ({
      treffer: koerper.titel.map((wunsch) => (
        wunsch.titel === "Avatar"
          ? treffer(wunsch.id, {
            konfidenz: "HIGH", quelle: "tmdb", titel: "Avatar - Der Herr der Elemente",
            originalTitel: "Avatar: The Last Airbender", jahr: 2005,
            altTitel: ["Avatar: Der Herr der Elemente"], externeIds: { tmdb: 246 }
          })
          : treffer(wunsch.id, { konfidenz: "UNMATCHED" })
      ))
    })
  });
  (async () => {
    const wunsch = { art: "serie", titel: "Avatar - Der Herr der Elemente", jahr: 2005 };
    const ergebnis = await client.nachschlagen([wunsch]);
    const form = ergebnis.get(M.wunschBauen(wunsch).schluessel);
    pruefe("3d. Der zweite Versuch rettet den deutschen Titel",
      form?.konfidenz === "HIGH", form?.konfidenz + " / " + form?.titel);
    pruefe("3e. Und dafuer wurden genau zwei Anfragen gestellt", relay.rufe.length === 2,
      String(relay.rufe.length));
    // Gemerkt wird unter dem vollen Titel - beim naechsten Mal fragt niemand
    // mehr.
    pruefe("3f. Beim naechsten Mal kommt es aus dem Cache",
      client.ausCache(wunsch)?.konfidenz === "HIGH");
    weiter();
  })();
}

function weiter() {
  // --- 4. Cache: was gilt wie lange? ----------------------------------------

  (async () => {
    {
      const { client, relay } = clientBauen({
        antwort: (koerper) => ({
          treffer: koerper.titel.map((wunsch) => treffer(wunsch.id, {
            konfidenz: "EXACT", quelle: "tmdb", titel: "Dark", jahr: 2017, externeIds: { tmdb: 70523 }
          }))
        })
      });
      const wunsch = { art: "serie", titel: "Dark", jahr: 2017 };
      await client.nachschlagen([wunsch]);
      pruefe("4a. Ein Treffer liegt danach im Cache", Boolean(client.ausCache(wunsch)));
      await client.nachschlagen([wunsch]);
      pruefe("4b. Und wird nicht noch einmal geholt", relay.rufe.length === 1, String(relay.rufe.length));
      uhr += M.GRENZEN.GUT_MS + 1;
      pruefe("4c. Nach der Frist ist er weg", client.ausCache(wunsch) === null);
      uhr = 1000;
    }

    {
      const { client, relay } = clientBauen({
        antwort: (koerper) => ({
          treffer: koerper.titel.map((wunsch) => treffer(wunsch.id, { konfidenz: "UNMATCHED" }))
        })
      });
      const wunsch = { art: "film", titel: "Gibt Es Nicht", jahr: 1999 };
      await client.nachschlagen([wunsch]);
      const vorher = relay.rufe.length;
      await client.nachschlagen([wunsch]);
      pruefe("4d. Auch 'nicht gefunden' wird gemerkt", relay.rufe.length === vorher,
        `${vorher} -> ${relay.rufe.length}`);
      uhr += M.GRENZEN.NICHT_GEFUNDEN_MS + 1;
      await client.nachschlagen([wunsch]);
      pruefe("4e. Aber kuerzer als ein Treffer", relay.rufe.length > vorher);
      uhr = 1000;
    }

    {
      // Zwei gleiche Wuensche in einem Aufruf sind eine Anfrage.
      const { client, relay } = clientBauen({
        antwort: (koerper) => ({
          treffer: koerper.titel.map((wunsch) => treffer(wunsch.id, {
            konfidenz: "EXACT", quelle: "tmdb", titel: "Dark", jahr: 2017
          }))
        })
      });
      await client.nachschlagen([
        { art: "serie", titel: "Dark", jahr: 2017 },
        { art: "serie", titel: "dark", jahr: 2017 },
        { art: "serie", titel: "Dark", jahr: 2017 }
      ]);
      pruefe("4f. Derselbe Titel geht einmal hinaus",
        relay.rufe[0].koerper.titel.length === 1, String(relay.rufe[0].koerper.titel.length));
    }

    // --- 5. Ausfaelle ---------------------------------------------------------

    const ausfaelle = [
      ["kein Netz", { wirft: "TypeError" }],
      ["Zeitgrenze", { wirft: "TimeoutError" }],
      ["HTTP 429", { status: 429, wartenS: 30 }],
      ["HTTP 500", { status: 500 }],
      ["HTTP 503", { status: 503 }],
      ["Unsinn im Koerper", { antwort: () => ({ treffer: "kaputt" }) }],
      ["leere Antwort", { antwort: () => ({}) }]
    ];
    for (const [name, regeln] of ausfaelle) {
      uhr = 1000;
      const { client } = clientBauen(regeln);
      const wunsch = { art: "film", titel: "Iron Man", jahr: 2008 };
      let geflogen = false;
      let ergebnis = null;
      try {
        ergebnis = await client.nachschlagen([wunsch]);
      } catch {
        geflogen = true;
      }
      const form = ergebnis?.get(M.wunschBauen(wunsch).schluessel);
      pruefe(`5. ${name}: keine Ausnahme, keine externen Daten`,
        !geflogen && (!form || form.konfidenz === "UNMATCHED"),
        geflogen ? "Ausnahme" : String(form?.konfidenz));
    }

    {
      // Nach mehreren Fehlschlaegen wird eine Weile gar nicht mehr gefragt.
      uhr = 1000;
      const { client, relay } = clientBauen({ wirft: "TypeError" });
      for (let i = 0; i < M.GRENZEN.AUSFALL_SCHWELLE; i += 1) {
        await client.nachschlagen([{ art: "film", titel: "Titel " + i, jahr: 2000 + i }]);
      }
      const nachSchwelle = relay.rufe.length;
      pruefe("6a. Der Ausfallschalter greift", client.gesperrt());
      await client.nachschlagen([{ art: "film", titel: "Noch einer", jahr: 1999 }]);
      pruefe("6b. Danach geht keine Anfrage mehr hinaus", relay.rufe.length === nachSchwelle,
        `${nachSchwelle} -> ${relay.rufe.length}`);
      uhr += M.GRENZEN.AUSFALL_PAUSE_MS + 1;
      pruefe("6c. Nach der Pause wieder", !client.gesperrt());
    }

    {
      // HTTP 429 nennt eine Wartezeit - die wird eingehalten.
      uhr = 1000;
      const { client } = clientBauen({ status: 429, wartenS: 30 });
      await client.nachschlagen([{ art: "film", titel: "Iron Man", jahr: 2008 }]);
      pruefe("6d. Nach 429 wird gewartet", client.gesperrt());
      uhr += 29 * 1000;
      pruefe("6e. Und zwar so lange, wie der Server sagt", client.gesperrt());
      uhr += 2 * 1000;
      pruefe("6f. Danach nicht mehr", !client.gesperrt());
    }

    // --- 7. Ohne Adresse laeuft alles weiter ----------------------------------

    {
      const client = M.erstellen({ basis: "", jetzt, pause: 0 });
      pruefe("7a. Ohne Relay-Adresse ist der Client nicht bereit", !client.bereit());
      const ergebnis = await client.nachschlagen([{ art: "film", titel: "Iron Man", jahr: 2008 }]);
      pruefe("7b. Und liefert einfach nichts", ergebnis.size === 0);
    }

    // --- 8. Stapelgroessen ----------------------------------------------------

    {
      uhr = 1000;
      const { client, relay } = clientBauen({
        antwort: (koerper) => ({
          treffer: koerper.titel.map((wunsch) => treffer(wunsch.id, { konfidenz: "UNMATCHED" }))
        })
      });
      const viele = [];
      for (let i = 0; i < 30; i += 1) viele.push({ art: "anime", titel: "Anime " + i, jahr: 2000 });
      await client.nachschlagen(viele);
      const groessen = relay.rufe.map((ruf) => ruf.koerper.titel.length);
      pruefe("8a. Kein Stapel ueberschreitet die Grenze des Servers",
        groessen.every((n) => n <= 25), groessen.join("+"));
      pruefe("8b. Und es sind so wenige Anfragen wie moeglich", relay.rufe.length === 2,
        groessen.join("+"));
    }
    {
      uhr = 1000;
      const { client, relay } = clientBauen({
        antwort: (koerper) => ({
          treffer: koerper.titel.map((wunsch) => treffer(wunsch.id, { konfidenz: "UNMATCHED" }))
        })
      });
      const viele = [];
      for (let i = 0; i < 30; i += 1) viele.push({ art: "film", titel: "Film " + i, jahr: 2000 });
      await client.nachschlagen(viele);
      pruefe("8c. Filme und Serien gehen in kleineren Stapeln - der Server loest sie einzeln auf",
        relay.rufe.every((ruf) => ruf.koerper.titel.length <= M.GRENZEN.STAPEL_WERK),
        relay.rufe.map((r) => r.koerper.titel.length).join("+"));
    }

    // --- 9. Was gespeichert und wiedergelesen wird ----------------------------

    {
      uhr = 1000;
      let ablage = null;
      const relay = relayBauen({
        antwort: (koerper) => ({
          treffer: koerper.titel.map((wunsch) => treffer(wunsch.id, {
            konfidenz: "EXACT", quelle: "tmdb", titel: "Dark", jahr: 2017,
            externeIds: { tmdb: 70523 }, schlagworte: ["time travel"]
          }))
        })
      });
      const erste = M.erstellen({
        basis: "https://relay.test", holen: relay.holen, jetzt, pause: 0,
        speichern: (daten) => { ablage = daten; }
      });
      await erste.nachschlagen([{ art: "serie", titel: "Dark", jahr: 2017 }]);
      pruefe("9a. Der Cache wird geschrieben", Boolean(ablage?.eintraege));

      const zweite = M.erstellen({
        basis: "https://relay.test", holen: relay.holen, jetzt, pause: 0,
        laden: () => ablage
      });
      const wieder = zweite.ausCache({ art: "serie", titel: "Dark", jahr: 2017 });
      pruefe("9b. Und beim naechsten Start ohne Netz gelesen",
        wieder?.konfidenz === "EXACT" && wieder.schlagworte[0] === "time travel");

      const kaputt = M.erstellen({
        basis: "https://relay.test", holen: relay.holen, jetzt, pause: 0,
        laden: () => { throw new Error("Datei kaputt"); }
      });
      pruefe("9c. Eine kaputte Ablage ist kein Absturz",
        kaputt.ausCache({ art: "serie", titel: "Dark", jahr: 2017 }) === null);
    }

    const gut = pruefungen.filter(Boolean).length;
    console.log(`${gut}/${pruefungen.length} bestanden`);
    process.exit(gut === pruefungen.length ? 0 : 1);
  })();
}
