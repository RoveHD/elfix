"use strict";

// Ein Anbieter zieht um.
//
// AniWorld und S.to wechseln ihre Adresse - nicht oft, aber regelmaessig, und
// manchmal von einer Domain auf eine blosse IP. Danach zeigt jeder Eintrag ins
// Leere: die Watchlist, die Mediathek, die abgehakten Folgen, der Verlauf, und
// die Bilder gleich mit. Von Hand ist das ein Nachmittag.
//
// Umgezogen wird ausschliesslich der Wirt. Pfad, Abfrage und Anker bleiben, wie
// sie sind - die Serie liegt drueben unter demselben Pfad, sonst waere es ein
// anderer Anbieter und kein Umzug. Und betroffen ist nur, was wirklich beim
// alten Wirt lag: ein Bild auf einem fremden Server bleibt, wo es ist.
//
// Das Modul rechnet nur; Dateien, Rueckfragen und das Schreiben bleiben im
// Hauptprozess. Dadurch laesst sich das Heikle daran - was angefasst wird und
// was nicht - ohne laufende App pruefen.

const providerModel = require("../shared/provider-model");

// Was an einem Eintrag eine Adresse ist und deshalb mitziehen kann. Bewusst
// eine Liste und keine Suche ueber alle Felder: ein eigenes Bild liegt als
// Data-URL vor, und ein Titel darf zufaellig wie eine Adresse aussehen, ohne
// eine zu sein.
const FAVORITEN_FELDER = ["url", "thumbnail", "favicon"];

function text(wert) {
  return String(wert == null ? "" : wert);
}

// Die neue Adresse als Wurzel: Schema, Wirt und Port. Alles dahinter ist die
// Sache des einzelnen Eintrags.
//
// Strenger als sonst in ELFIX, und zwar mit Absicht. Beim Anlegen eines
// Anbieters ist eine grosszuegige Auslegung richtig - da wird "s.to" gern zu
// "https://s.to". Hier nicht: ein Vertipper zoege die ganze Watchlist auf einen
// Wirt, den es nicht gibt, und die alte Adresse waere danach nirgends mehr
// nachzuschlagen. "ftp://s.to" etwa wird zu "https://ftp://s.to" - ein
// gueltiges Gebilde mit dem Wirt "ftp".
//
// Deshalb muss der Wirt aussehen wie einer: erlaubte Zeichen, mindestens ein
// Punkt. Namen ohne Punkt gibt es im Netz, aber keinen Anbieter, der unter
// einem erreichbar waere.
function wurzel(adresse) {
  try {
    const ziel = new URL(providerModel.normalizeUrl(text(adresse)));
    if (!/^https?:$/.test(ziel.protocol)) return "";
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(ziel.hostname)) return "";
    return ziel.origin;
  } catch {
    return "";
  }
}

// Taugt der Umzug ueberhaupt? Rueckgabe nennt den Grund, damit die Oberflaeche
// nicht raten muss, warum nichts passiert.
function pruefen(alteAdresse, neueAdresse) {
  const vonHost = providerModel.hostFromUrl(alteAdresse);
  const nachWurzel = wurzel(neueAdresse);
  const nachHost = providerModel.hostFromUrl(neueAdresse);
  if (!vonHost) return { ok: false, grund: "Die bisherige Adresse ist keine Adresse" };
  if (!nachWurzel || !nachHost) return { ok: false, grund: "Das ist keine gueltige Adresse" };
  // Derselbe Wirt heisst: es gibt nichts umzuziehen. Ein Wechsel von http auf
  // https ist trotzdem einer - dann unterscheidet sich die Wurzel.
  if (vonHost === nachHost && wurzel(alteAdresse) === nachWurzel) {
    return { ok: false, grund: "Das ist dieselbe Adresse" };
  }
  return { ok: true, vonHost, nachWurzel };
}

// Eine einzelne Adresse. Rueckgabe ist leer, wenn dieser Eintrag den alten
// Wirt gar nicht traegt - dann bleibt er unangetastet.
//
// Verglichen wird der Wirt, ersetzt wird die Wurzel. Das ist der Grund, warum
// hier geparst und nicht ersetzt wird: stuende der alte Wirt in einer
// Abfrage ("?weiter=alt.example/x"), truege eine Textersetzung ihn dort mit um.
function adresse(wert, vonHost, nachWurzel) {
  const roh = text(wert);
  if (!roh || !vonHost || !nachWurzel) return "";
  let ziel;
  try {
    ziel = new URL(roh);
  } catch {
    return "";
  }
  if (!/^https?:$/.test(ziel.protocol)) return "";
  if (ziel.host !== vonHost) return "";
  return nachWurzel + ziel.pathname + ziel.search + ziel.hash;
}

// Der Anbieter selbst: Startseite, Such-Adresse und die zuletzt geoeffnete
// Seite. Die Such-Adresse traegt {query} und ist deshalb keine gueltige
// Adresse - fuer sie wird der Platzhalter kurz durch etwas Harmloses ersetzt.
const PLATZHALTER = "__elfixquery__";

function anbieter(eintrag, vonHost, nachWurzel) {
  const neu = { ...eintrag };
  let geaendert = 0;
  for (const feld of ["startUrl", "lastUrl"]) {
    const gezogen = adresse(neu[feld], vonHost, nachWurzel);
    if (!gezogen) continue;
    neu[feld] = gezogen;
    geaendert += 1;
  }
  const suche = text(neu.searchUrl);
  if (suche.includes("{query}")) {
    const gezogen = adresse(suche.replace("{query}", PLATZHALTER), vonHost, nachWurzel);
    if (gezogen) {
      neu.searchUrl = gezogen.replace(PLATZHALTER, "{query}");
      geaendert += 1;
    }
  } else {
    const gezogen = adresse(suche, vonHost, nachWurzel);
    if (gezogen) {
      neu.searchUrl = gezogen;
      geaendert += 1;
    }
  }
  return { anbieter: neu, geaendert };
}

// Ein Eintrag der Watchlist. `normalisieren` kommt von aussen: wie eine Adresse
// zum Vergleichsschluessel wird, entscheidet der Hauptprozess, und zwei
// Auslegungen davon waeren zwei Wahrheiten.
function favorit(eintrag, vonHost, nachWurzel, normalisieren) {
  const neu = { ...eintrag };
  let geaendert = 0;

  for (const feld of FAVORITEN_FELDER) {
    const gezogen = adresse(neu[feld], vonHost, nachWurzel);
    if (!gezogen) continue;
    neu[feld] = gezogen;
    geaendert += 1;
  }
  // Der Vergleichsschluessel wird neu gerechnet, nicht mitgezogen: er ist eine
  // Ableitung der Adresse und keine zweite Adresse.
  if (neu.url !== eintrag.url) {
    neu.normalizedUrl = typeof normalisieren === "function" ? normalisieren(neu.url) : neu.url;
  }

  const folgen = Array.isArray(neu.completedEpisodes) ? neu.completedEpisodes : null;
  if (folgen) {
    let folgenGeaendert = 0;
    const gezogen = folgen.map((folge) => {
      const ziel = adresse(folge?.url, vonHost, nachWurzel);
      if (!ziel) return folge;
      folgenGeaendert += 1;
      return { ...folge, url: ziel };
    });
    if (folgenGeaendert) {
      neu.completedEpisodes = gezogen;
      geaendert += folgenGeaendert;
    }
  }

  const verlauf = Array.isArray(neu.activity) ? neu.activity : null;
  if (verlauf) {
    let verlaufGeaendert = 0;
    const gezogen = verlauf.map((zeile) => {
      const ziel = adresse(zeile?.url, vonHost, nachWurzel);
      if (!ziel) return zeile;
      verlaufGeaendert += 1;
      return { ...zeile, url: ziel };
    });
    if (verlaufGeaendert) {
      neu.activity = gezogen;
      geaendert += verlaufGeaendert;
    }
  }

  return { favorit: neu, geaendert };
}

// Der ganze Umzug. Rueckgabe enthaelt neue Listen und einen Bericht - was er
// nennt, steht anschliessend in der Rueckfrage, und was dort nicht steht, wird
// auch nicht angefasst.
//
// Bewusst ohne Nebenwirkung: nichts wird hier geschrieben. Wer nur wissen will,
// was passieren wuerde, ruft dasselbe auf und sieht sich den Bericht an.
function umziehen({ providers, favorites, providerId, neueAdresse, normalisieren } = {}) {
  const liste = Array.isArray(providers) ? providers : [];
  const eintraege = Array.isArray(favorites) ? favorites : [];
  const dieser = liste.find((eintrag) => eintrag?.id === providerId);
  if (!dieser) return { ok: false, grund: "Diesen Anbieter gibt es nicht" };

  const geprueft = pruefen(dieser.startUrl, neueAdresse);
  if (!geprueft.ok) return geprueft;
  const { vonHost, nachWurzel } = geprueft;

  // Zieht ein anderer Anbieter auf demselben Wirt mit um? Das waere kein
  // Umzug, sondern ein Durcheinander - zwei Anbieter mit derselben Adresse
  // sind nicht mehr auseinanderzuhalten.
  const mitbewohner = liste.filter((eintrag) => eintrag?.id !== providerId
    && providerModel.hostFromUrl(eintrag?.startUrl) === vonHost);

  const neueAnbieter = liste.map((eintrag) => (
    eintrag.id === providerId ? anbieter(eintrag, vonHost, nachWurzel).anbieter : eintrag
  ));

  let betroffeneEintraege = 0;
  let felder = 0;
  const neueFavoriten = eintraege.map((eintrag) => {
    const ergebnis = favorit(eintrag, vonHost, nachWurzel, normalisieren);
    if (!ergebnis.geaendert) return eintrag;
    betroffeneEintraege += 1;
    felder += ergebnis.geaendert;
    return ergebnis.favorit;
  });

  return {
    ok: true,
    vonHost,
    nachWurzel,
    providers: neueAnbieter,
    favorites: neueFavoriten,
    bericht: {
      vonHost,
      nachWurzel,
      eintraege: betroffeneEintraege,
      felder,
      // Nur zur Anzeige: wie viele davon in der Mediathek stehen und wie viele
      // ein Bild vom alten Wirt tragen.
      mediathek: neueFavoriten.filter((eintrag, i) => eintrag !== eintraege[i] && eintrag.completed).length,
      bilder: eintraege.filter((eintrag) => adresse(eintrag?.thumbnail, vonHost, nachWurzel)).length,
      mitbewohner: mitbewohner.map((eintrag) => eintrag.name)
    }
  };
}

module.exports = {
  FAVORITEN_FELDER,
  wurzel,
  pruefen,
  adresse,
  anbieter,
  favorit,
  umziehen
};
