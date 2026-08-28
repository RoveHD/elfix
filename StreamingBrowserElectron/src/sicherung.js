"use strict";

// Sicherung und Wiederherstellung.
//
// Der Grundsatz: hinein gehoert alles, was nicht wiederkommt, wenn es weg ist.
// Alles andere bleibt draussen.
//
// DRIN
//   settings     die Einstellungen
//   favorites    Watchlist, Weiterschauen, Mediathek, Verlauf, eigene Bilder
//   providers    die eigenen Anbieter
//   watchparty   welche Titel eingestellt und welche Runden beigetreten sind
//   sitzungen    die gemessenen Wiedergabesitzungen - der ganze Rueckblick
//   fassungen    welche Sprachfassung je Titel gemerkt ist
//   marken       Intro und Abspann je Staffel
//
// DRAUSSEN, und warum
//   Filterlisten, Geschmacksprofil und der Metadaten-Zwischenspeicher. Sie
//   sind zusammen ueber zehn Megabyte - mehr als alles andere zusammen - und
//   bauen sich von selbst wieder auf. Sie zu sichern hiesse, eine Sicherung
//   unbrauchbar gross zu machen fuer Daten, die niemand vermisst.
//
//   Der Spiegel des Geraeteabgleichs. Er beschreibt, was ein *anderes* Geraet
//   schon kennt; auf einem wiederhergestellten Stand waere er eine Behauptung
//   ueber eine Vergangenheit, die es dort nicht gab. Er baut sich beim ersten
//   Abgleich neu auf.
//
//   Die Geraetekennung. Sonst gaebe es nach dem Einlesen auf einem zweiten
//   Rechner zwei Geraete mit derselben Kennung, und das Relay haelt sie fuer
//   eines - Host-Wahl und Leiste waeren dahin.
//
// WAS EINMAL GEFEHLT HAT
//
// Bis Fassung 2 waren sitzungen, fassungen und marken nicht dabei. Das war
// still und teuer: die Sitzungen sind gemessene Zeit, die nie wiederkommt -
// beim Benutzer 224 Saetze ueber siebzehn Stunden -, und wer eine Sicherung
// einlas, verlor seinen ganzen Rueckblick, ohne dass irgendwo etwas davon
// stand. Fassungen und Marken sind Handarbeit je Titel und ebenso wenig
// nachzubauen.
//
// Das Modul rechnet nur; Dateien und Dialoge bleiben im Hauptprozess. Dadurch
// laesst sich das Heikle daran - was uebernommen wird und was nicht - ohne
// laufende App pruefen.

const KENNUNG = "elfix-sicherung";
// 2: sitzungen, fassungen und marken kamen dazu. Eine Sicherung der Fassung 1
// laesst sich weiter einlesen - was fehlt, bleibt dann eben stehen, statt
// geleert zu werden.
const FASSUNG = 2;

// Eine Sicherung aus dem laufenden Zustand.
//
// Die Geraetekennung bleibt bewusst draussen. Sonst gaebe es nach dem Einlesen
// auf einem zweiten Rechner zwei Geraete mit derselben Kennung, und das Relay
// haelt sie fuer eines - Host-Wahl und Leiste waeren dahin. Ein
// wiederhergestelltes Geraet erkennt das Relay ohnehin am Namen wieder und
// zieht seinen Stand auf die neue Kennung um.
function bauen({ settings, favorites, providers, watchparty, sitzungen, fassungen, marken,
  programm, anlass } = {}) {
  const einstellungen = settings ? JSON.parse(JSON.stringify(settings)) : null;
  if (einstellungen && einstellungen.watchparty) einstellungen.watchparty.deviceId = "";
  return {
    kennung: KENNUNG,
    fassung: FASSUNG,
    erstellt: new Date().toISOString(),
    programm: String(programm || ""),
    // Woher diese Sicherung kommt: von Hand, vor einem Update, vor dem
    // Einlesen einer anderen. Steht in der Datei, damit man ihr ansieht,
    // warum es sie gibt.
    anlass: String(anlass || "hand"),
    settings: einstellungen,
    favorites: Array.isArray(favorites) ? favorites : [],
    providers: Array.isArray(providers) ? providers : [],
    watchparty: watchparty || null,
    sitzungen: Array.isArray(sitzungen) ? sitzungen : [],
    // Fassungen und Marken sind Karten nach Titel, keine Listen.
    fassungen: fassungen && typeof fassungen === "object" ? fassungen : null,
    marken: marken && typeof marken === "object" ? marken : null
  };
}

// Ist das ueberhaupt eine Sicherung, und eine, die diese Fassung lesen kann?
function pruefen(daten) {
  if (!daten || typeof daten !== "object") return { ok: false, reason: "Das ist keine ELFIX-Sicherung" };
  if (daten.kennung !== KENNUNG) return { ok: false, reason: "Das ist keine ELFIX-Sicherung" };
  const fassung = Number(daten.fassung);
  if (!Number.isFinite(fassung) || fassung < 1) return { ok: false, reason: "Das ist keine ELFIX-Sicherung" };
  if (fassung > FASSUNG) {
    return { ok: false, reason: "Die Sicherung stammt aus einer neueren Version von ELFIX" };
  }
  return { ok: true };
}

// Wie viel steckt drin? Das steht im Dialog vor dem Einlesen - damit niemand
// eine fast leere Sicherung ueber eine volle Ablage legt, ohne es vorher zu
// sehen.
function umfang(daten) {
  const eintraege = Array.isArray(daten?.favorites) ? daten.favorites : [];
  const zahl = (wert) => (Number.isFinite(Number(wert)) && Number(wert) > 0 ? Number(wert) : 0);
  const zaehle = (wert) => (wert && typeof wert === "object" ? Object.keys(wert).length : 0);
  return {
    favoriten: eintraege.length,
    bilder: eintraege.filter((eintrag) => eintrag && eintrag.customThumbnail).length,
    weiterschauen: eintraege.filter((eintrag) => zahl(eintrag?.position) > 0 || zahl(eintrag?.currentTime) > 0).length,
    anbieter: Array.isArray(daten?.providers) ? daten.providers.length : 0,
    raeume: Array.isArray(daten?.settings?.watchparty?.rooms) ? daten.settings.watchparty.rooms.length : 0,
    einstellungen: Boolean(daten?.settings),
    // Eine Sicherung der Fassung 1 kennt diese drei nicht. Dann steht dort
    // null - und der Dialog kann sagen, dass sie nichts davon enthaelt,
    // statt eine Null zu behaupten.
    sitzungen: Array.isArray(daten?.sitzungen) ? daten.sitzungen.length : null,
    fassungen: daten && "fassungen" in daten ? zaehle(daten.fassungen) : null,
    marken: daten && "marken" in daten ? zaehle(daten.marken) : null
  };
}

// Ein Satz darueber, was fehlt.
//
// Eine Sicherung der Fassung 1 hat keine Sitzungen, keine Fassungen und keine
// Marken - nicht, weil sie leer waeren, sondern weil es sie dort nicht gab.
// Der Unterschied gehoert vor das Einlesen: was hier steht, bleibt stehen,
// statt geleert zu werden.
function fehlendeTeile(daten) {
  const fehlt = [];
  if (!daten || !("sitzungen" in daten)) fehlt.push("Wiedergabezeiten");
  if (!daten || !("fassungen" in daten)) fehlt.push("gemerkte Sprachfassungen");
  if (!daten || !("marken" in daten)) fehlt.push("Intromarken");
  return fehlt;
}

// Die Einstellungen, wie sie beim Einlesen gelten sollen: alles aus der
// Sicherung, aber mit der Kennung dieses Rechners. Fehlt hier noch eine, bleibt
// sie leer - dann vergibt die App beim naechsten Verbinden eine neue.
function einstellungenUebernehmen(ausSicherung, eigeneKennung) {
  if (!ausSicherung) return null;
  const uebernommen = JSON.parse(JSON.stringify(ausSicherung));
  uebernommen.watchparty = { ...(uebernommen.watchparty || {}), deviceId: String(eigeneKennung || "") };
  return uebernommen;
}

// Ein Dateiname mit Datum - beim zweiten Mal am selben Tag fragt der Dialog von
// selbst nach dem Ueberschreiben.
function dateiname(jetzt = new Date()) {
  const zwei = (wert) => String(wert).padStart(2, "0");
  return `ELFIX-Sicherung-${jetzt.getFullYear()}-${zwei(jetzt.getMonth() + 1)}-${zwei(jetzt.getDate())}.elfix.json`;
}

// Der Name einer Sicherung, die die App selbst anlegt.
//
// Mit Uhrzeit, nicht nur mit Datum: vor einem Update kann zweimal am selben
// Tag eine entstehen, und die zweite darf die erste nicht ueberschreiben -
// sonst waere die Rueckfahrkarte weg, sobald man sie zweimal braucht.
function selbstName(anlass, jetzt = new Date()) {
  const zwei = (wert) => String(wert).padStart(2, "0");
  const stempel = `${jetzt.getFullYear()}${zwei(jetzt.getMonth() + 1)}${zwei(jetzt.getDate())}`
    + `-${zwei(jetzt.getHours())}${zwei(jetzt.getMinutes())}${zwei(jetzt.getSeconds())}`;
  const sauber = String(anlass || "auto").replace(/[^a-z0-9-]/gi, "").toLowerCase() || "auto";
  return `ELFIX-${sauber}-${stempel}.elfix.json`;
}

// Welche selbst angelegten Sicherungen weg duerfen.
//
// Sie sammeln sich sonst: vor jedem Update eine, und ELFIX bekommt mehrere
// Fassungen in der Woche. Behalten wird die juengste Handvoll - genug, um ein
// misslungenes Update zu ueberstehen, und wenig genug, dass der Datenordner
// nicht zulaeuft.
//
// Sortiert wird nach dem Namen, und das genuegt: der Zeitstempel darin ist so
// gebaut, dass alphabetisch und chronologisch dasselbe ist.
function altePutzen(namen, behalten = 5) {
  const eigene = (Array.isArray(namen) ? namen : [])
    .filter((name) => /^ELFIX-[a-z0-9-]+-\d{8}-\d{6}\.elfix\.json$/i.test(String(name)))
    .sort();
  const wieViele = Math.max(0, Number(behalten) || 0);
  return eigene.slice(0, Math.max(0, eigene.length - wieViele));
}

module.exports = {
  KENNUNG, FASSUNG, bauen, pruefen, umfang, fehlendeTeile,
  einstellungenUebernehmen, dateiname, selbstName, altePutzen
};
