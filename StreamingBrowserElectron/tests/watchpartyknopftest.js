"use strict";

/*
 * Der ⇄ Knopf gehoert zu der Folge, die laeuft.
 *
 * Gemeldet: "wenn ich in der Folge drin bin, muss oben der Watchparty-Knopf zu
 * sehen sein". War er nicht. Die Kopfzeile richtete sich allein nach der Route,
 * und die zeigt im Direktbetrieb weiter dorthin, von wo die Folge geoeffnet
 * wurde - auf die Startseite, die Mediathek, die Suche. Wer mitten in einer
 * Folge sass, hatte den Knopf also ausgerechnet dann nicht, wenn es etwas in
 * eine Watchparty zu stellen gibt.
 *
 * Zwei Haelften, und beide werden hier am echten Quelltext geprueft:
 *
 *   1. Der Hauptprozess meldet, was im eigenen Player offen ist (`activeState`),
 *      und die Oberflaeche zeigt den Knopf danach (`renderChromeButtons`).
 *   2. Ein Druck darauf teilt die Folge des Players - nicht das, worauf die
 *      unsichtbare Anbieteransicht zufaellig gerade steht
 *      (`watchpartyAktuellesTeilen`).
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const taste = require("../src/taste");
const fortschritt = require("../src/fortschritt");

const WURZEL = path.join(__dirname, "..");
const HAUPT = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").replace(/\r\n/g, "\n");
const OBERFLAECHE = fs.readFileSync(path.join(WURZEL, "src/renderer/renderer.js"), "utf8")
  .replace(/\r\n/g, "\n");

function funktion(quelle, name) {
  const start = quelle.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} nicht gefunden`);
  return quelle.slice(start, quelle.indexOf("\n}", start) + 2);
}

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
}

const SERIE = "https://aniworld.to/anime/stream/wise-mans-grandchild";
const FOLGE = `${SERIE}/staffel-1/episode-3`;
const STAFFELSEITE = `${SERIE}/staffel-1`;
const ANDERE = "https://aniworld.to/anime/stream/black-clover/staffel-1/episode-7";

/** Eine Anbieteransicht, die irgendwo steht - so wie im Direktbetrieb. */
function ansicht(url, titel = "") {
  return {
    webContents: {
      getURL: () => url,
      getTitle: () => titel,
      isLoading: () => false,
      navigationHistory: { canGoBack: () => false, canGoForward: () => false }
    }
  };
}

/* ------------------------------------------- 1. Der gemeldete Zustand */
{
  const c = vm.createContext({
    providerModel: { isHttpUrl: (wert) => /^https?:\/\//.test(String(wert || "")) },
    activeProviderId: "aniworld",
    activeView: ansicht(STAFFELSEITE, "Staffel 1"),
    favorites: [],
    spielerLauf: { url: FOLGE, providerId: "aniworld", titel: "Wise Man's Grandchild · Staffel 1 Folge 3" }
  });
  vm.runInContext(funktion(HAUPT, "activeState"), c);

  const mitSpieler = c.activeState();
  pruefe("Der gemeldete Zustand kennt die Folge im eigenen Player",
    mitSpieler.spieler?.url === FOLGE, JSON.stringify(mitSpieler.spieler));
  pruefe("Und die Anbieteransicht bleibt daneben, wo sie ist",
    mitSpieler.url === STAFFELSEITE, mitSpieler.url);

  c.spielerLauf = null;
  pruefe("Ohne Player meldet er keinen", c.activeState().spieler === null);

  // Der Player ohne Video - er zeigt nur die Folgenliste. Offen ist trotzdem
  // etwas, und teilen laesst es sich auch.
  c.spielerLauf = { url: STAFFELSEITE, providerId: "aniworld", auswahl: true };
  pruefe("Auch die offene Folgenliste zaehlt als offener Titel",
    c.activeState().spieler?.auswahl === true);
}

/* ------------------------------- 2. Die Kopfzeile richtet sich danach */
{
  const knoepfe = new Map();
  function knopf(auswahl) {
    if (!knoepfe.has(auswahl)) {
      knoepfe.set(auswahl, {
        versteckt: false,
        classList: {
          toggle(_name, an) { knoepfe.get(auswahl).versteckt = Boolean(an); }
        }
      });
    }
    return knoepfe.get(auswahl);
  }
  const versteckt = (auswahl) => knoepfe.get(auswahl)?.versteckt;

  const c = vm.createContext({
    currentRoute: "start",
    spielerLage: null,
    settings: { playback: { direktModus: true } },
    aufYoutubeSeite: () => false,
    renderYoutubePartyBanner: () => {},
    document: { querySelector: knopf }
  });
  vm.runInContext(funktion(OBERFLAECHE, "renderChromeButtons"), c);

  c.renderChromeButtons();
  pruefe("Ohne Player und ohne Anbieterseite bleibt der ⇄ Knopf weg",
    versteckt("#watchpartyShareButton") === true);

  c.spielerLage = { url: FOLGE, providerId: "aniworld" };
  c.renderChromeButtons();
  pruefe("In der Folge steht der ⇄ Knopf da - auch auf der Startseite",
    versteckt("#watchpartyShareButton") === false);

  // Und wenn der Player wieder zugeht, ist er weg.
  c.spielerLage = null;
  c.renderChromeButtons();
  pruefe("Nach dem Schliessen des Players ist er wieder weg",
    versteckt("#watchpartyShareButton") === true);

  // Auf der Anbieterseite bleibt alles, wie es war.
  c.currentRoute = "provider:aniworld";
  c.renderChromeButtons();
  pruefe("Auf der Anbieterseite steht er wie bisher",
    versteckt("#watchpartyShareButton") === false);
  c.aufYoutubeSeite = () => true;
  c.renderChromeButtons();
  pruefe("Auf YouTube bleibt er weg", versteckt("#watchpartyShareButton") === true);
}

/* ----------------------------------- 3. Geteilt wird, was wirklich laeuft */
(async () => {
  const geteilt = [];
  const c = vm.createContext({
    console,
    providerModel: { isHttpUrl: (wert) => /^https?:\/\//.test(String(wert || "")) },
    taste,
    serienTitel: fortschritt.serienTitel,
    episodeIdentity: fortschritt.episodeIdentity,
    normalizeFavoriteUrl: fortschritt.normalizeFavoriteUrl,
    normalizeMediaType: fortschritt.normalizeMediaType,
    inferMediaType: fortschritt.inferMediaType,
    isLiveView: (view) => Boolean(view),
    readPageMetadata: async (view) => ({ title: view.webContents.getTitle() }),
    shareWatchpartyFavorite: async (favorite, room) => {
      geteilt.push({ favorite, room });
      return { shared: true, room: room || "raum" };
    },
    favorites: [],
    activeFavoriteId: "",
    activeProvider: () => ({ id: "aniworld", name: "AniWorld" }),
    spielerAnbieter: () => ({ id: "aniworld", name: "AniWorld" }),
    // Die Werkbank steht im Direktbetrieb irgendwo - hier bei einer ganz
    // anderen Serie, so wie nach einem Wechsel aus der Mediathek heraus.
    activeView: ansicht(ANDERE, "Black Clover Staffel 1 Folge 7 | AniWorld"),
    spielerLauf: { url: FOLGE, providerId: "aniworld" }
  });
  vm.runInContext(funktion(HAUPT, "watchpartyAktuellesTeilen"), c);

  const ausSpieler = await c.watchpartyAktuellesTeilen("");
  pruefe("Geteilt wird die Folge aus dem Player", ausSpieler.shared === true
    && geteilt[0]?.favorite.url === FOLGE, geteilt[0]?.favorite.url);
  pruefe("Und ihr Titel kommt nicht von der Seite, die im Hintergrund steht",
    !/black clover/i.test(geteilt[0]?.favorite.title || ""), geteilt[0]?.favorite.title);
  pruefe("Staffel und Folge stehen dabei", geteilt[0]?.favorite.season === 1
    && geteilt[0]?.favorite.episode === 3,
    `${geteilt[0]?.favorite.season}/${geteilt[0]?.favorite.episode}`);

  // Ein Eintrag der eigenen Liste zu einer anderen Folge darf die laufende
  // nicht verdraengen - auch dann nicht, wenn er der zuletzt geoeffnete ist.
  geteilt.length = 0;
  c.activeFavoriteId = "fremd";
  c.favorites = [{ id: "fremd", url: ANDERE, normalizedUrl: fortschritt.normalizeFavoriteUrl(ANDERE),
    title: "Black Clover" }];
  await c.watchpartyAktuellesTeilen("");
  pruefe("Der zuletzt geoeffnete Eintrag verdraengt die laufende Folge nicht",
    geteilt[0]?.favorite.url === FOLGE, geteilt[0]?.favorite.url);

  // Der eigene Eintrag zur laufenden Folge bringt Bild und Titel mit.
  geteilt.length = 0;
  c.favorites = [{ id: "eigen", url: FOLGE, normalizedUrl: fortschritt.normalizeFavoriteUrl(FOLGE),
    title: "Wise Man's Grandchild", thumbnail: "bild.jpg" }];
  c.activeFavoriteId = "eigen";
  await c.watchpartyAktuellesTeilen("");
  pruefe("Der eigene Eintrag zur laufenden Folge wird genommen",
    geteilt[0]?.favorite.thumbnail === "bild.jpg", JSON.stringify(geteilt[0]?.favorite.title));

  // Ohne Player gilt wieder die Anbieteransicht.
  geteilt.length = 0;
  c.spielerLauf = null;
  c.favorites = [];
  c.activeFavoriteId = "";
  await c.watchpartyAktuellesTeilen("");
  pruefe("Ohne Player teilt der Knopf die offene Anbieterseite",
    geteilt[0]?.favorite.url === ANDERE, geteilt[0]?.favorite.url);

  c.activeView = null;
  const nichts = await c.watchpartyAktuellesTeilen("");
  pruefe("Und ohne beides sagt er das auch", nichts.shared === false && Boolean(nichts.reason),
    nichts.reason);

  const fehler = pruefungen.filter((ok) => !ok).length;
  console.log(`${pruefungen.length - fehler}/${pruefungen.length} bestanden `
    + "(Watchparty-Knopf: sichtbar in der laufenden Folge, teilt sie auch)");
  if (fehler) process.exitCode = 1;
})().catch((fehler) => {
  console.error(`FAIL ${fehler.stack || fehler}`);
  process.exitCode = 1;
});
