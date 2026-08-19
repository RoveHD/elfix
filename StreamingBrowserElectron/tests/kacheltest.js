"use strict";
// Das Menue einer Kachel und was hinter seinen Eintraegen steht.
//
// Anlass ist Issue #1: aus "Weiterschauen" liess sich ein Titel nicht
// vormerken. Man musste ihn erst starten, um auf der geoeffneten Seite das
// Herz zu treffen - fuer etwas, das man gerade nicht weiterschauen, sondern
// aufheben will, ist das der falsche Weg.
//
// Geprueft wird der echte Quelltext, nicht ein Nachbau: die Kachel wird aus
// renderer.js herausgeschnitten und in einem kleinen Ersatz-DOM gebaut, der
// Merker-Handler aus main.js herausgeschnitten und aufgerufen.

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const WURZEL = path.join(__dirname, "..");
const lies = (datei) => fs.readFileSync(path.join(WURZEL, datei), "utf8").split("\r\n").join("\n");

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(b); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };

// Eine Funktion endet an der ersten Zeile, die nur eine schliessende Klammer
// traegt - so ist der Quelltext durchgehend formatiert. Klammern zu zaehlen
// scheitert an Regex- und Vorlagen-Literalen.
function abschnitt(quelle, anfang, ende = "}") {
  const zeilen = quelle.split("\n");
  const von = zeilen.findIndex((z) => z.startsWith(anfang));
  if (von < 0) throw new Error("nicht gefunden: " + anfang);
  let bis = von;
  while (bis < zeilen.length && zeilen[bis] !== ende) bis += 1;
  return zeilen.slice(von, bis + 1).join("\n");
}

// --- Ein Ersatz-DOM ---------------------------------------------------------

function element(tag) {
  return {
    tagName: tag, className: "", type: "", textContent: "", title: "", draggable: false,
    dataset: {}, style: {}, children: [],
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c) { if (this._s.has(c)) this._s.delete(c); else this._s.add(c); },
      contains(c) { return this._s.has(c); }
    },
    append(...k) { this.children.push(...k.filter(Boolean)); },
    appendChild(k) { this.children.push(k); return k; },
    replaceChildren(...k) { this.children = k; },
    setAttribute(name, wert) { (this._attr = this._attr || {})[name] = wert; },
    addEventListener(art, fn) { (this._h = this._h || {})[art] = fn; },
    auslösen(art) { return this._h?.[art]?.({ stopPropagation() {} }); },
    querySelector: () => null, querySelectorAll: () => [], remove() {}, focus() {}
  };
}

// Was die Kachel sonst noch aus renderer.js braucht, ist fuer diese Frage
// belanglos - unbekannte Namen werden zu harmlosen Platzhaltern.
function kachelBauen(zusatz = {}) {
  const gerufen = { watchlist: [], toasts: [], menue: [] };
  const kontext = {
    // Die Eintraege stehen seit 1.24.0 nicht mehr als Knoepfe in der Kachel,
    // sondern gehen beim Klick auf "⋯" an ein gemeinsames Kaestchen. Hier
    // steht der Empfaenger, damit sich weiter der echte Quelltext pruefen
    // laesst und nicht seine Beschreibung.
    kartenMenueOeffnen: (knopf, eintraege) => gerufen.menue.push({ knopf, eintraege }),
    document: { createElement: element, createDocumentFragment: () => element("frag") },
    favorites: [],
    api: {
      setFavoriteWatchlist: async (id, wert) => {
        gerufen.watchlist.push([id, wert]);
        return { favorites: [], favorite: wert !== false, gefunden: true };
      },
      ...zusatz
    },
    showToast: (t) => gerufen.toasts.push(t),
    displayFavoriteTitle: (f) => f.title || "",
    console, Math, Date, String, Number, Boolean, Array, Object, JSON, Set, Map, Promise
  };
  const platzhalter = () => "";
  const sandkasten = new Proxy(kontext, {
    has: () => true,
    get: (ziel, name) => (name in ziel ? ziel[name] : (typeof name === "symbol" ? undefined : platzhalter)),
    set: (ziel, name, wert) => { ziel[name] = wert; return true; }
  });
  vm.createContext(sandkasten);
  vm.runInContext(abschnitt(lies("src/renderer/renderer.js"), "function favoriteCard("), sandkasten);
  const karte = vm.runInContext("favoriteCard", sandkasten);
  return { karte, gerufen };
}

// `darfEntfernen` ist bei favoriteCard() das zweite Argument und nicht Teil der
// Optionen - ohne es fehlt der Eintrag "Aus Watchlist entfernen" ganz.
function menue(favorite, optionen, zusatz, darfEntfernen = false) {
  const { karte, gerufen } = kachelBauen(zusatz);
  const gebaut = karte(favorite, darfEntfernen, optionen);
  const knopf = gebaut.children.find((k) => k?.className === "favorite-menu");
  // Erst der Klick auf "⋯" bringt die Eintraege hervor.
  knopf?.auslösen("click");
  const eintraege = gerufen.menue.at(-1)?.eintraege || [];
  return { knopf, eintraege, namen: eintraege.map((e) => e.text), gerufen };
}

// --- Die Reihen, wie renderer.js sie wirklich baut --------------------------

const renderer = lies("src/renderer/renderer.js");
pruefe("Weiterschauen-Reihe erlaubt das Vormerken",
  /const weiterOptionen = \{[\s\S]{0,220}?allowWatchlistAdd: true/.test(renderer));
pruefe("Weiterschauen auf der Startseite ebenfalls",
  /const kartenOptionen = \{[\s\S]{0,220}?allowWatchlistAdd: true/.test(renderer));

const OFFEN = { id: "1", title: "Naruto", url: "https://aniworld.to/anime/stream/naruto", favorite: false, progress: 40 };
const WEITER = { showProgress: true, allowContinueRemove: true, allowComplete: true, allowWatchlistAdd: true };
const START = { showProgress: true, allowImage: true, allowContinueRemove: true, allowWatchlistAdd: true };

const w = menue(OFFEN, WEITER);
pruefe("Weiterschauen: der Eintrag steht im Menue", w.namen.includes("Auf die Watchlist"), w.namen.join(" | "));
pruefe("Weiterschauen: die bisherigen Eintraege bleiben",
  w.namen.includes("Aus Weiterschauen entfernen") && w.namen.includes("Als gesehen abhaken"), w.namen.join(" | "));
pruefe("Startseite: der Eintrag steht auch dort",
  menue(OFFEN, START).namen.includes("Auf die Watchlist"));

// Ein Titel, der schon vorgemerkt ist, braucht den Eintrag nicht.
pruefe("Schon vorgemerkt: der Eintrag fehlt",
  !menue({ ...OFFEN, favorite: true }, WEITER).namen.includes("Auf die Watchlist"));
// Und in der Watchlist selbst waere er sinnlos.
pruefe("In der Watchlist-Reihe: kein Eintrag",
  !menue(OFFEN, { allowImage: true }).namen.includes("Auf die Watchlist"));

// --- Das Menue haengt nicht mehr in der Kachel ------------------------------
//
// Eine Kachel schneidet mit overflow:hidden alles ab, was ueber ihren Rand
// hinausragt. Ein Menue mit sechs Eintraegen ist hoeher als eine Kachel von
// 220 Pixeln und war unten abgeschnitten - sichtbar nur deshalb, weil es die
// ganze Kachel verdeckte. Deshalb traegt die Kachel jetzt nur noch den Knopf.

{
  const gebaut = menue(OFFEN, WEITER);
  pruefe("Die Kachel traegt nur noch den Knopf, kein Eintragsfach", Boolean(gebaut.knopf));
  pruefe("Der Knopf oeffnet das gemeinsame Menue", gebaut.gerufen.menue.length === 1);
  pruefe("Das Menue bekommt den Knopf als Anker mit", gebaut.gerufen.menue[0].knopf === gebaut.knopf);
  pruefe("Jeder Eintrag traegt Text und eine Handlung",
    gebaut.eintraege.length > 0
    && gebaut.eintraege.every((e) => typeof e.text === "string" && e.text && typeof e.tun === "function"),
    gebaut.namen.join(" | "));
}

// Ohne einen einzigen Eintrag braucht es auch keinen Knopf.
pruefe("Ohne Eintraege gibt es keinen Knopf",
  !menue(OFFEN, { allowImage: false }).knopf);

// Loeschen ist der einzige Eintrag, der als gefaehrlich zaehlt.
{
  const mediathek = menue(OFFEN, { allowLibraryRemove: true, allowImage: false });
  pruefe("Aus der Mediathek loeschen ist als gefaehrlich gekennzeichnet",
    mediathek.eintraege.length === 1 && mediathek.eintraege[0].gefahr === true,
    mediathek.namen.join(" | "));
  pruefe("Die uebrigen Eintraege sind es nicht",
    menue(OFFEN, WEITER).eintraege.every((e) => !e.gefahr));
}

// --- Symbole und Reihenfolge ------------------------------------------------
//
// Acht gleich aussehende Zeilen untereinander liest niemand. Jeder Eintrag
// traegt deshalb ein Symbol, und die Eintraege stehen in drei Gruppen:
// vormerken, Bild, wegnehmen - in dieser Reihenfolge, mit dem Wegnehmen unten.

{
  const alles = menue(OFFEN, { showProgress: true, allowContinueRemove: true, allowComplete: true,
    allowWatchlistAdd: true, allowImage: true, allowLibraryRemove: true });
  pruefe("Jeder Eintrag traegt ein Symbol",
    alles.eintraege.every((e) => typeof e.symbol === "string" && e.symbol.length > 0),
    alles.eintraege.map((e) => `${e.symbol} ${e.text}`).join(" | "));
  pruefe("Jeder Eintrag gehoert zu einer Gruppe",
    alles.eintraege.every((e) => ["vormerken", "bild", "weg"].includes(e.gruppe)),
    alles.eintraege.map((e) => e.gruppe).join(" "));

  // Die Gruppen stehen am Stueck und in fester Reihenfolge - sonst braechte
  // der Trennstrich im Menue nichts.
  const folge = alles.eintraege.map((e) => e.gruppe).filter((g, i, a) => g !== a[i - 1]);
  pruefe("Die Gruppen stehen am Stueck und in fester Reihenfolge",
    folge.join(">") === "vormerken>bild>weg", folge.join(">"));
  pruefe("Das Wegnehmen steht unten",
    alles.eintraege.at(-1).gruppe === "weg" && alles.eintraege.at(-1).gefahr === true,
    alles.eintraege.at(-1).text);

  // Die Watchlist traegt in ELFIX ein Herz - hohl, solange ein Titel nicht
  // vorgemerkt ist, voll wenn doch. Das Menue benutzt dasselbe Zeichen wie der
  // Knopf in der Kopfleiste; geprueft wird gegen dessen Quelltext, damit die
  // beiden nicht auseinanderlaufen.
  pruefe("Der Knopf in der Kopfleiste benutzt hohles und volles Herz",
    /button\.textContent = active \? "♥" : "♡"/.test(renderer));
  pruefe("\"Auf die Watchlist\" traegt das hohle Herz",
    alles.eintraege.find((e) => e.text === "Auf die Watchlist")?.symbol === "♡");
  const watchlist = menue(OFFEN, { allowImage: false }, undefined, true);
  pruefe("\"Aus Watchlist entfernen\" traegt das volle Herz",
    watchlist.eintraege.find((e) => e.text === "Aus Watchlist entfernen")?.symbol === "♥",
    watchlist.eintraege.map((e) => `${e.symbol} ${e.text}`).join(" | "));

  // Ein eigenes Bild bringt zwei weitere Eintraege in dieselbe Gruppe.
  const mitBild = menue({ ...OFFEN, customThumbnail: "data:image/png;base64,x" }, { allowImage: true });
  pruefe("Mit eigenem Bild kommen Ausschnitt und Entfernen dazu",
    mitBild.namen.includes("Ausschnitt bearbeiten") && mitBild.namen.includes("Eigenes Bild entfernen")
    && mitBild.namen.includes("Anderes Bild wählen"),
    mitBild.namen.join(" | "));
  pruefe("Ohne eigenes Bild fehlen sie",
    !menue(OFFEN, { allowImage: true }).namen.includes("Ausschnitt bearbeiten"));
}

// --- Was der Eintrag ausloest ----------------------------------------------

(async () => {
  const geklickt = menue(OFFEN, WEITER);
  await geklickt.eintraege.find((e) => e.text === "Auf die Watchlist").tun();
  pruefe("Klick meldet genau diesen Titel zum Vormerken",
    geklickt.gerufen.watchlist.length === 1 && geklickt.gerufen.watchlist[0][0] === "1"
    && geklickt.gerufen.watchlist[0][1] === true,
    JSON.stringify(geklickt.gerufen.watchlist));
  pruefe("Klick bestaetigt sichtbar", geklickt.gerufen.toasts.some((t) => /Watchlist/.test(t)),
    geklickt.gerufen.toasts.join(" | "));

  // Eine aeltere Bruecke kennt die Funktion nicht - dann darf nichts abstuerzen.
  const alt = menue(OFFEN, WEITER, { setFavoriteWatchlist: undefined });
  let geplatzt = false;
  try { await alt.eintraege.find((e) => e.text === "Auf die Watchlist").tun(); } catch { geplatzt = true; }
  pruefe("Ohne die Bruecke: kein Absturz, sondern ein Hinweis",
    !geplatzt && alt.gerufen.toasts.some((t) => /nicht/i.test(t)), alt.gerufen.toasts.join(" | "));

  // --- Der Merker im Hauptprozess -------------------------------------------
  //
  // Der Handler wird aus main.js herausgeschnitten und mit einer eigenen Liste
  // aufgerufen. So wird der echte Code geprueft, nicht seine Beschreibung.

  const quelle = abschnitt(lies("src/main.js"), 'ipcMain.handle("favorites:set-watchlist"', "});");
  function handlerBauen(liste) {
    const gespeichert = { male: 0, gemeldet: 0 };
    const umgebung = {
      favorites: liste,
      saveFavorites: () => { gespeichert.male += 1; },
      sendActiveState: () => { gespeichert.gemeldet += 1; },
      ipcMain: { handle: (_name, fn) => { umgebung.__fn = fn; } },
      Date, String, Boolean, Object, Array
    };
    vm.createContext(umgebung);
    vm.runInContext(quelle, umgebung);
    return { rufen: (id, wert) => umgebung.__fn(null, id, wert), gespeichert };
  }

  const liste = [
    { id: "a", title: "Naruto", favorite: false, completed: false },
    { id: "b", title: "Loki", favorite: false, completed: true, completedManually: true, completedAt: "2026-01-01" }
  ];
  const h = handlerBauen(liste);

  const gesetzt = h.rufen("a", true);
  pruefe("Handler setzt den Merker", liste[0].favorite === true && gesetzt.favorite === true);
  pruefe("Handler speichert und meldet den neuen Stand",
    h.gespeichert.male === 1 && h.gespeichert.gemeldet === 1,
    JSON.stringify(h.gespeichert));

  // Zweimal dasselbe soll nicht zweimal schreiben.
  h.rufen("a", true);
  pruefe("Unveraenderter Merker schreibt nicht erneut", h.gespeichert.male === 1, "gespeichert " + h.gespeichert.male + "x");

  // Ein abgehakter Titel, den man wieder vormerkt, darf nicht gleichzeitig in
  // der Mediathek und unter "will ich sehen" stehen.
  h.rufen("b", true);
  pruefe("Vormerken hebt das Abhaken auf",
    liste[1].favorite === true && liste[1].completed === false
    && liste[1].completedManually === false && liste[1].completedAt === "",
    JSON.stringify({ favorite: liste[1].favorite, completed: liste[1].completed }));

  pruefe("Wieder herunternehmen geht auch", h.rufen("a", false).favorite === false && liste[0].favorite === false);

  const unbekannt = h.rufen("gibtesnicht", true);
  pruefe("Unbekannte Kennung aendert nichts", unbekannt.gefunden === false && unbekannt.favorite === false);

  const gut = pruefungen.filter(Boolean).length;
  console.log(`${gut}/${pruefungen.length} bestanden`);
  process.exit(gut === pruefungen.length ? 0 : 1);
})();
