"use strict";

const discover = require("./discover");

// Sub oder Dub - gemerkt statt jedes Mal neu geklickt.
//
// AniWorld und S.to legen jede Folge mehrfach ab: einmal je Synchronfassung.
// Welche man bekommt, entscheidet eine Reihe kleiner Flaggen ueber der
// Hosterliste, und die steht bei jeder Folge wieder auf dem, was der Anbieter
// fuer richtig haelt - meistens Deutsch. Wer eine Serie auf Japanisch mit
// Untertiteln schaut, klickt das folglich zwanzig Mal.
//
// Erkennen laesst sich die richtige Fassung nicht, raten will man sie nicht.
// Also dasselbe Verfahren wie bei den Intromarken: gelernt wird aus dem, was
// jemand selbst tut. Die erste Folge einer Serie sagt, womit man angefangen
// hat; ab der zweiten klickt ELFIX sie an, bevor der Autostart nach einem
// Hoster sucht.
//
// Zwei Meldungen, nicht eine: was beim Laden dasteht, ist die Vorgabe des
// Anbieters und darf eine gelernte Fassung niemals ueberschreiben - sonst
// haette die Vorwahl sich nach der ersten Folge selbst wieder abgewaehlt. Nur
// ein echter Klick zaehlt als Entscheidung, und "echt" heisst hier
// `isTrusted`: der eigene Klick der Vorwahl traegt das nicht.

// So viele Titel bleiben gemerkt. Eine Fassung ist ein Wort und eine Zahl -
// mehr als vierhundert Serien hat niemand angefangen, und wer doch, verliert
// die aeltesten.
const MAX_TITEL = 400;

// Gemeldet wird ueber die Konsole. In einer fremden Seite gibt es ohne Preload
// keinen anderen Kanal - denselben Weg nehmen der Folgenknopf und die Marken.
const MELDE_STAND = "__elfix:fassung:stand:";
const MELDE_WAHL = "__elfix:fassung:wahl:";

// Die Rohangabe der Seite in Worte. Zwei Quellen: der Dateiname der Flagge
// ("japanese-german") und ihr Titeltext ("Mit Untertitel Deutsch"). Den ersten
// kennt discover.js laengst - dieselbe Funktion, die den Kalenderfilter
// beschriftet, damit nicht an zwei Stellen zwei Woerter fuer dieselbe Fassung
// entstehen. Den zweiten kennt nur diese Seite, also steht er hier.
function bezeichnung(roh) {
  const wert = String(roh || "").trim();
  if (!wert) return "";
  const klein = wert.toLowerCase();
  if (/^mit untertitel deutsch$/.test(klein)) return "Deutsche Untertitel";
  if (/^mit untertitel englisch$/.test(klein)) return "Englische Untertitel";
  return discover.spracheAusFlagge(wert);
}

// Eine Fassung, wie sie gespeichert wird. `key` ist die Angabe des Anbieters
// (`data-lang-key`), `roh` der Dateiname der Flagge - beides zusammen, weil
// keins von beidem allein verlaesslich ist: der Schluessel ist kurz und
// eindeutig, aber anbieterspezifisch; der Dateiname ueberlebt einen Umzug.
function normalisieren(fassung) {
  const key = String(fassung?.key ?? "").trim().slice(0, 20);
  const roh = String(fassung?.roh ?? "").trim().slice(0, 60);
  if (!key && !roh) return null;
  return { key, roh, name: bezeichnung(roh) };
}

// Zwei Fassungen meinen dasselbe, wenn der Schluessel oder die Rohangabe
// uebereinstimmt. Der Name reicht dafuer nicht: "Japanisch" und "Japanisch,
// Deutsche Untertitel" sind zwei Fassungen, aber unbekannte Angaben landen
// beide in derselben Grossschreibung.
function gleich(links, rechts) {
  if (!links || !rechts) return false;
  if (links.key && rechts.key) return links.key === rechts.key;
  if (links.roh && rechts.roh) return links.roh.toLowerCase() === rechts.roh.toLowerCase();
  return false;
}

function lesen(bestand, schluessel) {
  if (!schluessel) return null;
  const eintrag = bestand && bestand[schluessel];
  return eintrag ? normalisieren(eintrag) : null;
}

// Merken - und zwar so, dass der Aufrufer sieht, ob es etwas zu speichern gibt:
// bleibt alles beim Alten, kommt derselbe Bestand zurueck. `nurWennNeu` ist der
// Unterschied zwischen Vorgabe und Entscheidung: der Stand beim Laden traegt
// ihn, ein Klick nicht.
function merken(bestand, schluessel, fassung, optionen = {}) {
  const sauber = normalisieren(fassung);
  if (!schluessel || !sauber) return bestand;
  const alt = bestand[schluessel];
  if (alt && optionen.nurWennNeu) return bestand;
  if (alt && gleich(normalisieren(alt), sauber) && alt.name === sauber.name) return bestand;

  const at = Number(optionen.at) || Date.now();
  const neu = { ...bestand, [schluessel]: { ...sauber, at } };
  const schluesselListe = Object.keys(neu);
  if (schluesselListe.length <= MAX_TITEL) return neu;

  // Zu viele: die aeltesten fallen raus. Der gerade geschriebene Eintrag ist
  // der juengste und bleibt damit in jedem Fall.
  schluesselListe
    .sort((links, rechts) => (Number(neu[links]?.at) || 0) - (Number(neu[rechts]?.at) || 0))
    .slice(0, schluesselListe.length - MAX_TITEL)
    .forEach((weg) => { delete neu[weg]; });
  return neu;
}

// Eine Konsolenzeile aus der Seite lesen.
function meldung(zeile) {
  const text = String(zeile || "");
  const art = text.startsWith(MELDE_WAHL) ? "wahl" : (text.startsWith(MELDE_STAND) ? "stand" : "");
  if (!art) return null;
  const rest = text.slice((art === "wahl" ? MELDE_WAHL : MELDE_STAND).length);
  const trenner = rest.indexOf(":");
  if (trenner < 0) return null;
  let roh = "";
  try {
    roh = decodeURIComponent(rest.slice(trenner + 1));
  } catch {
    // Eine kaputte Kodierung ist kein Grund, die Meldung wegzuwerfen - der
    // Schluessel allein genuegt zum Wiederfinden.
    roh = "";
  }
  const fassung = normalisieren({ key: rest.slice(0, trenner), roh });
  return fassung ? { art, fassung } : null;
}

// --- Das Skript in der Seite -------------------------------------------------
//
// Es tut drei Dinge und laeuft mehrfach: einmal, sobald das Dokument steht, und
// noch einmal, wenn die Seite fertig geladen ist. Der zweite Lauf ist kein
// Luxus - beim ersten sind die eigenen Klickhorcher des Anbieters manchmal noch
// nicht eingehaengt, und ein Klick ins Leere waehlt nichts aus.

function fassungScript(gewuenscht) {
  const wunsch = normalisieren(gewuenscht);
  return `(() => {
    const wunsch = ${JSON.stringify(wunsch ? { key: wunsch.key, roh: wunsch.roh } : null)};
    // Die Flaggenreihe steht auf der Anbieterseite. Im Rahmen des Hosters gibt
    // es nichts zu waehlen, und das Skript geht in alle Rahmen.
    if (window.top !== window) return "";

    const sichtbar = (node) => {
      if (!node) return false;
      const stil = getComputedStyle(node);
      if (stil.display === "none" || stil.visibility === "hidden") return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    // Wie die Fassung heisst. Der Dateiname der Flagge zuerst: er ist die
    // Angabe, die auch der Kalender kennt.
    const flaggenName = (node) => {
      const img = node.tagName === "IMG" ? node : node.querySelector("img");
      const quelle = String(img && (img.getAttribute("data-src") || img.getAttribute("src")) || "");
      const datei = (quelle.match(/\\/([a-z0-9-]+)\\.svg(?:[?#]|$)/i) || [])[1] || "";
      if (datei) return datei;
      const titel = String((img && (img.getAttribute("title") || img.getAttribute("alt")))
        || node.getAttribute("title") || "").trim();
      if (titel) return titel;
      return String(node.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 40);
    };

    // Flagge oder Hostereintrag? Beide tragen "data-lang-key", und der
    // Unterschied entscheidet alles: die Flaggen sind zum Klicken da, die
    // Hostereintraege verraten, welche Fassung gerade laeuft.
    const istWaehler = (node) => {
      if (node.closest(".changeLanguageBox")) return true;
      const img = node.tagName === "IMG" ? node : node.querySelector("img");
      if (!img) return false;
      if (node.querySelector("a[href*='redirect'], a[href*='stream']")) return false;
      return /\\.svg(?:[?#]|$)/i.test(String(img.getAttribute("data-src") || img.getAttribute("src") || ""));
    };

    const keyVon = (node) => String(node.getAttribute("data-lang-key") || "").trim();

    // Welche Fassung laeuft: die der sichtbaren Hostereintraege. Das ist die
    // Auskunft der Seite selbst und nicht der Name einer Klasse, den der
    // Anbieter beim naechsten Umbau anders schreibt.
    const aktivAus = (knoten) => {
      const zaehler = new Map();
      for (const node of knoten) {
        if (!sichtbar(node)) continue;
        const key = keyVon(node);
        if (!key) continue;
        zaehler.set(key, (zaehler.get(key) || 0) + 1);
      }
      let beste = "";
      let meiste = 0;
      for (const [key, anzahl] of zaehler) {
        if (anzahl > meiste) { meiste = anzahl; beste = key; }
      }
      return beste;
    };

    const alle = Array.from(document.querySelectorAll("[data-lang-key]"));
    if (!alle.length) return "keine-fassungen";
    const waehler = alle.filter(istWaehler);
    const eintraege = alle.filter((node) => !istWaehler(node));
    if (!waehler.length) return "keine-fassungen";

    const markiert = waehler.find((node) => /(^|\\s)(selected|active|aktiv)(\\s|$)/i.test(String(node.className || ""))
      || node.getAttribute("aria-selected") === "true");
    const aktiv = aktivAus(eintraege) || (markiert ? keyVon(markiert) : "");
    const rohVon = (key) => {
      const node = waehler.find((eintrag) => keyVon(eintrag) === key);
      return node ? flaggenName(node) : "";
    };

    if (!window.__elfixFassung) {
      // Ein echter Klick auf eine Flagge ist die einzige Entscheidung, die
      // ELFIX je zu sehen bekommt. Der eigene Klick weiter unten traegt
      // isTrusted nicht - er lernt also nichts von sich selbst.
      document.addEventListener("click", (ereignis) => {
        if (!ereignis.isTrusted) return;
        const ziel = ereignis.target && ereignis.target.closest && ereignis.target.closest("[data-lang-key]");
        if (!ziel || !istWaehler(ziel)) return;
        const key = keyVon(ziel);
        if (!key) return;
        console.log(${JSON.stringify(MELDE_WAHL)} + key + ":" + encodeURIComponent(flaggenName(ziel)));
      }, true);
      window.__elfixFassung = { seit: Date.now() };
      // Was hier steht, bevor irgendwer etwas anklickt: die Vorgabe des
      // Anbieters. Sie zaehlt nur, solange fuer den Titel noch nichts bekannt
      // ist - darum kuemmert sich die andere Seite.
      if (aktiv) console.log(${JSON.stringify(MELDE_STAND)} + aktiv + ":" + encodeURIComponent(rohVon(aktiv)));
    }

    if (!wunsch) return "ohne-wunsch";
    const passt = waehler.find((node) => wunsch.key && keyVon(node) === wunsch.key)
      || (wunsch.roh ? waehler.find((node) => flaggenName(node).toLowerCase() === wunsch.roh.toLowerCase()) : null);
    // Die gemerkte Fassung gibt es hier nicht - etwa eine Staffel, die nur
    // untertitelt vorliegt. Dann bleibt stehen, was der Anbieter anbietet;
    // etwas anderes anzuklicken waere schlechter als nichts zu tun.
    if (!passt) return "fehlt";
    const wunschKey = keyVon(passt);
    if (wunschKey && wunschKey === aktiv) return "steht";

    const anklicken = passt.querySelector("a,button,img") || passt;
    for (const art of ["pointerdown", "mousedown", "mouseup", "click"]) {
      try {
        anklicken.dispatchEvent(new MouseEvent(art, { bubbles: true, cancelable: true, view: window }));
      } catch (_) {
        // Ein Knoten, der keine Ereignisse annimmt, bekommt eben keinen Klick.
      }
    }

    // Sofort nachsehen, ob es angekommen ist. "geklickt" heisst: gedrueckt,
    // aber die Seite hat noch nicht umgeschaltet - dann ist der zweite Lauf
    // dran, und bis dahin darf der Autostart nicht auf einen Hoster gehen.
    const jetzt = aktivAus(Array.from(document.querySelectorAll("[data-lang-key]")).filter((node) => !istWaehler(node)));
    return (jetzt && jetzt === wunschKey ? "gewechselt:" : "geklickt:") + flaggenName(passt);
  })()`;
}

module.exports = {
  MAX_TITEL,
  MELDE_STAND,
  MELDE_WAHL,
  bezeichnung,
  normalisieren,
  gleich,
  lesen,
  merken,
  meldung,
  fassungScript
};
