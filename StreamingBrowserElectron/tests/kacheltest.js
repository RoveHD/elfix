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

// --- Rechtsklick auf die Kachel ---------------------------------------------
//
// Der Knopf mit den drei Punkten ist klein und sitzt in einer Ecke. Wer mit
// der Maus arbeitet, drueckt die rechte Taste dort, wo der Zeiger schon steht.
// Beides soll dasselbe Menue bringen.

{
  // Ein Ersatz-DOM, das nur kann, was der Weg nach oben braucht: sich selbst
  // erkennen, das eigene Kind finden und sein Elternteil nennen.
  function knoten(className, kinder = []) {
    const k = {
      className,
      parentElement: null,
      matches: (wahl) => wahl === "." + className,
      querySelector: (wahl) => (wahl === ":scope > .favorite-menu"
        ? kinder.find((kind) => kind.className === "favorite-menu") || null
        : null)
    };
    for (const kind of kinder) kind.parentElement = k;
    return k;
  }

  function bindungBauen() {
    const horcher = {};
    const gerufen = { auf: [], zu: 0 };
    const koerper = knoten("body");
    const kontext = {
      document: {
        body: koerper,
        addEventListener: (art, fn) => { (horcher[art] = horcher[art] || []).push(fn); }
      },
      kartenMenue: { classList: { add() {}, remove() {} } },
      kartenMenueKnopf: null,
      kartenMenueOeffnen: (knopf, eintraege) => gerufen.auf.push({ knopf, eintraege }),
      kartenMenueSchliessen: () => { gerufen.zu += 1; },
      console, Math, Date, String, Number, Boolean, Array, Object, JSON, Set, Map, Promise
    };
    const platzhalter = () => "";
    const sand = new Proxy(kontext, {
      has: () => true,
      get: (ziel, name) => (name in ziel ? ziel[name] : (typeof name === "symbol" ? undefined : platzhalter)),
      set: (ziel, name, wert) => { ziel[name] = wert; return true; }
    });
    vm.createContext(sand);
    const quelle = lies("src/renderer/renderer.js");
    for (const name of ["function kartenMenueKnopfZu(", "function kartenMenueBinden("]) {
      vm.runInContext(abschnitt(quelle, name), sand);
    }
    vm.runInContext("kartenMenueBinden()", sand);
    const rechtsklick = (ziel) => {
      let verhindert = false;
      for (const fn of horcher.contextmenu || []) fn({ target: ziel, preventDefault() { verhindert = true; } });
      return verhindert;
    };
    return { rechtsklick, gerufen, koerper, knopfSuche: vm.runInContext("kartenMenueKnopfZu", sand) };
  }

  const EINTRAEGE = [{ gruppe: "vormerken", symbol: "♡", text: "Auf die Watchlist", tun() {} }];
  function kachelMitKnopf(eintraege = EINTRAEGE, zusatz = {}) {
    const knopf = Object.assign(knoten("favorite-menu"), { kartenEintraege: eintraege }, zusatz);
    const titel = knoten("card-title");
    const karte = knoten("favorite-card", [titel, knopf]);
    return { karte, knopf, titel };
  }

  const b = bindungBauen();
  pruefe("Der Rechtsklick wird ueberhaupt abgehorcht", typeof b.rechtsklick === "function");

  {
    const { karte, knopf, titel } = kachelMitKnopf();
    karte.parentElement = b.koerper;
    pruefe("Ein Druck mitten in die Kachel findet ihren Knopf", b.knopfSuche(titel) === knopf);
    pruefe("Ein Druck auf den Knopf selbst ebenso", b.knopfSuche(knopf) === knopf);
    pruefe("Neben allen Kacheln gibt es keinen Knopf", b.knopfSuche(b.koerper) === null);
    pruefe("Ohne Ziel auch nicht", b.knopfSuche(null) === null);
  }

  {
    const s = bindungBauen();
    const { karte, knopf, titel } = kachelMitKnopf();
    karte.parentElement = s.koerper;
    const verhindert = s.rechtsklick(titel);
    pruefe("Der Rechtsklick oeffnet das Menue der Kachel",
      s.gerufen.auf.length === 1 && s.gerufen.auf[0].knopf === knopf
      && s.gerufen.auf[0].eintraege === EINTRAEGE);
    pruefe("Und das Menue des Systems bleibt weg", verhindert === true);
    // Erst zu, dann auf: der Rechtsklick soll oeffnen und nicht schalten,
    // sonst bliebe das Menue bei einem zweiten Druck auf dieselbe Kachel zu.
    pruefe("Ein offenes Menue wird vorher geschlossen", s.gerufen.zu === 1);
  }

  {
    // Neben den Kacheln bleibt das Menue des Systems, und geoeffnet wird nichts.
    const s = bindungBauen();
    const verhindert = s.rechtsklick(s.koerper);
    pruefe("Neben den Kacheln passiert nichts",
      s.gerufen.auf.length === 0 && verhindert === false);
  }

  {
    // Ein Vorschlag kann zwischen zwei Klicks vorgemerkt worden sein - dann
    // gehoert der Eintrag nicht mehr ins Menue. Der Rechtsklick fragt deshalb
    // dieselbe Funktion wie der Knopf.
    const s = bindungBauen();
    const frisch = [{ gruppe: "vormerken", symbol: "✓", text: "Als gesehen abhaken", tun() {} }];
    const { karte, knopf, titel } = kachelMitKnopf(EINTRAEGE, { eintraegeFrisch: () => frisch });
    karte.parentElement = s.koerper;
    s.rechtsklick(titel);
    pruefe("Der Rechtsklick nimmt die frisch gefragten Eintraege",
      s.gerufen.auf[0]?.eintraege === frisch && knopf.kartenEintraege === frisch);
  }

  {
    // Eine Kachel ohne Eintraege traegt gar keinen Knopf - und wo doch einer
    // haengt, ohne dass etwas drinsteht, bleibt das Menue zu.
    const s = bindungBauen();
    const { karte, titel } = kachelMitKnopf([]);
    karte.parentElement = s.koerper;
    s.rechtsklick(titel);
    pruefe("Ohne Eintraege oeffnet der Rechtsklick nichts", s.gerufen.auf.length === 0);
  }

  // Und der Vorschlagsknopf bietet die frische Liste wirklich an.
  pruefe("Der Vorschlagsknopf hinterlegt seine frische Liste",
    /knopf\.eintraegeFrisch = \(\) => vorschlagEintraege\(item\);/.test(renderer));
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

  // --- Vorschlaege und Suchtreffer ------------------------------------------
  //
  // Ein Vorschlag auf der Startseite und ein Treffer in der Suche waren bisher
  // Sackgassen: vormerken ging nur ueber das Herz in der Suche, abhaken gar
  // nicht - man musste den Titel dafuer erst beim Anbieter oeffnen.
  //
  // Geprueft wird wieder der echte Quelltext: die Funktionen werden aus
  // renderer.js herausgeschnitten und mit einer eigenen Favoritenliste
  // aufgerufen.

  function vorschlagBauen(liste) {
    const kontext = {
      favorites: liste,
      document: { createElement: element },
      console, Math, Date, String, Number, Boolean, Array, Object, JSON, Set, Map, Promise, RegExp
    };
    const platzhalter = () => "";
    const sand = new Proxy(kontext, {
      has: () => true,
      get: (ziel, name) => (name in ziel ? ziel[name] : (typeof name === "symbol" ? undefined : platzhalter)),
      set: (ziel, name, wert) => { ziel[name] = wert; return true; }
    });
    vm.createContext(sand);
    const quelle = lies("src/renderer/renderer.js");
    for (const name of ["function adressSchluessel(", "function gleicheAdresse(",
      "function stehtInWatchlist(", "function vorschlagEintraege(", "function vorschlagMenueAnhaengen("]) {
      vm.runInContext(abschnitt(quelle, name), sand);
    }
    return {
      eintraege: vm.runInContext("vorschlagEintraege", sand),
      anhaengen: vm.runInContext("vorschlagMenueAnhaengen", sand),
      gleich: vm.runInContext("gleicheAdresse", sand)
    };
  }

  const VORSCHLAG = {
    providerId: "aniworld",
    providerName: "Aniworld",
    url: "https://aniworld.to/anime/stream/bleach",
    title: "Bleach",
    image: ""
  };

  {
    const leer = vorschlagBauen([]);
    const namen = leer.eintraege(VORSCHLAG).map((e) => e.text);
    pruefe("Ein unbekannter Vorschlag laesst sich vormerken und abhaken",
      namen.includes("Auf die Watchlist") && namen.includes("Als gesehen abhaken"),
      namen.join(" | "));
    pruefe("Die Eintraege tragen Herz und Haken",
      leer.eintraege(VORSCHLAG).find((e) => e.text === "Auf die Watchlist")?.symbol === "♡"
      && leer.eintraege(VORSCHLAG).find((e) => e.text === "Als gesehen abhaken")?.symbol === "✓",
      leer.eintraege(VORSCHLAG).map((e) => `${e.symbol} ${e.text}`).join(" | "));
    pruefe("Jeder Eintrag traegt eine Handlung",
      leer.eintraege(VORSCHLAG).every((e) => typeof e.tun === "function"));
  }

  {
    // Steht der Titel schon auf der Watchlist, waere der Eintrag ohne Wirkung.
    const drin = vorschlagBauen([{ id: "a", url: VORSCHLAG.url, favorite: true }]);
    const namen = drin.eintraege(VORSCHLAG).map((e) => e.text);
    pruefe("Was schon vorgemerkt ist, laesst sich nicht noch einmal vormerken",
      !namen.includes("Auf die Watchlist"), namen.join(" | "));
    pruefe("Abhaken geht trotzdem", namen.includes("Als gesehen abhaken"), namen.join(" | "));

    // Protokoll und Schraegstrich sagen nichts ueber den Titel.
    const anders = vorschlagBauen([{ id: "a", url: "http://aniworld.to/anime/stream/bleach/", favorite: true }]);
    pruefe("Der Abgleich stoert sich nicht an http und Schraegstrich",
      !anders.eintraege(VORSCHLAG).map((e) => e.text).includes("Auf die Watchlist"));
    pruefe("Ein anderer Titel wird nicht verwechselt",
      vorschlagBauen([{ id: "a", url: "https://aniworld.to/anime/stream/naruto", favorite: true }])
        .eintraege(VORSCHLAG).map((e) => e.text).includes("Auf die Watchlist"));
    pruefe("Ein heruntergenommener Eintrag zaehlt nicht als vorgemerkt",
      vorschlagBauen([{ id: "a", url: VORSCHLAG.url, favorite: false }])
        .eintraege(VORSCHLAG).map((e) => e.text).includes("Auf die Watchlist"));
  }

  {
    // Der Knopf haengt nur dort, wo es auch etwas anzulegen gibt.
    const bau = vorschlagBauen([]);
    const mitKnopf = () => { const k = element("div"); bau.anhaengen(k, VORSCHLAG); return k.children.length; };
    pruefe("Ein richtiger Vorschlag bekommt den Knopf", mitKnopf() === 1);

    const ohne = (aenderung) => {
      const k = element("div");
      bau.anhaengen(k, { ...VORSCHLAG, ...aenderung });
      return k.children.length;
    };
    // Ein Vorschlag, der nur zur Suche des Anbieters fuehrt, traegt die
    // Suchadresse - die gehoert nicht auf die Watchlist.
    pruefe("Ein Vorschlag, der nur zur Suche fuehrt, bekommt keinen", ohne({ viaSearch: true }) === 0);
    pruefe("Ohne Adresse bekommt er keinen", ohne({ url: "" }) === 0);
    pruefe("Ohne Anbieter bekommt er keinen", ohne({ providerId: "" }) === 0);
  }

  // Und die Karten benutzen das auch wirklich.
  pruefe("Die Vorschlagskarte haengt das Menue an",
    /bildEbeneSetzen\(card, item\.image, null\);[\s\S]{0,300}?vorschlagMenueAnhaengen\(card, item\)/.test(renderer));
  pruefe("Die Suchkarte haengt es ebenfalls an",
    /card\.append\(herz\);[\s\S]{0,400}?vorschlagMenueAnhaengen\(card, \{/.test(renderer));

  const gut = pruefungen.filter(Boolean).length;
  console.log(`${gut}/${pruefungen.length} bestanden`);
  process.exit(gut === pruefungen.length ? 0 : 1);
})();
