"use strict";
/*
 * Die Serienuebersicht - die Seite vor der ersten Folge.
 *
 * Wer eine neue Serie anfaengt, soll auf dem Telefon und am Fernseher nicht
 * auf der Anbieterseite landen, sondern auf einer eigenen: wie viele Staffeln,
 * wie viele Folgen, und welche davon. Die Angaben dafuer stehen nur auf der
 * Anbieterseite und werden hinter dem Ladevorhang gelesen.
 *
 * Geprueft wird hier das Lesen - an nachgebauten Seiten, die den Aufbau der
 * echten Anbieter tragen: Staffelreiter, Folgentabelle, Doppelfolgen ohne
 * Hoster, und die Randspalte mit fremden Serien, die nicht mitzaehlen darf.
 *
 * Ohne Browser: das Skript laeuft in einer kleinen DOM-Nachbildung. Sie kann
 * genau das, was das Skript benutzt - querySelectorAll, getAttribute,
 * textContent, location und URL. Mehr braucht es nicht, und mehr waere ein
 * zweiter Browser, den niemand pflegen will.
 */

const seitendaten = require("../src/seitendaten.js");

const pruefungen = [];
const pruefe = (name, bedingung, detail) => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

// --- Die kleine DOM-Nachbildung ---------------------------------------------

class Knoten {
  constructor(tag, attribute = {}, text = "", kinder = []) {
    this.tag = String(tag).toLowerCase();
    this.attribute = attribute;
    this.eigenerText = text;
    this.kinder = kinder;
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attribute, name)
      ? this.attribute[name] : null;
  }

  get textContent() {
    return this.eigenerText + this.kinder.map((kind) => kind.textContent).join(" ");
  }

  alle() {
    return [this, ...this.kinder.flatMap((kind) => kind.alle())];
  }

  /**
   * Nur die Waehler, die das Skript wirklich benutzt.
   *
   * <p>Ein vollstaendiger CSS-Waehler waere hier fehl am Platz: er waere mehr
   * Code als das Gepruefte und haette eigene Fehler.
   */
  passt(waehler) {
    const teile = waehler.split(",").map((teil) => teil.trim());
    return teile.some((teil) => {
      if (teil === "a[href]") return this.tag === "a" && this.getAttribute("href") != null;
      if (teil === "tr, li" || teil === "tr" || teil === "li") return this.tag === "tr" || this.tag === "li";
      if (teil === "h1") return this.tag === "h1";
      if (teil === "img" || teil === "svg" || teil === "a" || teil === "button") return this.tag === teil;
      const klasse = teil.match(/^\[class\*='([^']+)'\]$/);
      if (klasse) return String(this.attribute.class || "").includes(klasse[1]);
      return false;
    });
  }

  querySelectorAll(waehler) {
    return this.alle().filter((knoten) => knoten !== this && knoten.passt(waehler));
  }

  querySelector(waehler) {
    return this.querySelectorAll(waehler)[0] || null;
  }
}

function fahre(skript, wurzel, pfad, host = "aniworld.to") {
  const document = {
    querySelectorAll: (waehler) => wurzel.querySelectorAll(waehler),
    querySelector: (waehler) => wurzel.querySelector(waehler),
    title: "Testseite"
  };
  const location = { pathname: pfad, href: `https://${host}${pfad}`, hostname: host };
  // eslint-disable-next-line no-new-func
  const lauf = new Function("document", "location", "URL", `return ${skript};`);
  return lauf(document, location, URL);
}

// --- Eine nachgebaute Anbieterseite -----------------------------------------

const SLUG = "black-torch";

function staffelReiter(nummer) {
  return new Knoten("a", { href: `/anime/stream/${SLUG}/staffel-${nummer}` }, `Staffel ${nummer}`);
}

function folgenZeile(staffel, folge, { ohneHoster = false, sammelIn = 0 } = {}) {
  const kinder = [
    new Knoten("td", { class: "episode-number" }, String(folge)),
    new Knoten("a", { href: `/anime/stream/${SLUG}/staffel-${staffel}/episode-${folge}` }, `Folge ${folge}`)
  ];
  const watch = new Knoten("td", { class: "watch-cell" }, "",
    ohneHoster ? [] : [new Knoten("img", { src: "voe.png" })]);
  kinder.push(watch);
  const text = sammelIn ? `[In E${sammelIn} enthalten]` : "";
  return new Knoten("tr", {}, text, kinder);
}

function seite({ staffeln = [1, 2, 3], offen = 1, folgen = 8, sonderfaelle = true } = {}) {
  const kinder = [new Knoten("h1", {}, "BLACK TORCH")];
  for (const nummer of staffeln) kinder.push(staffelReiter(nummer));
  for (let folge = 1; folge <= folgen; folge += 1) {
    const doppel = sonderfaelle && folge === 7;
    kinder.push(folgenZeile(offen, folge, doppel ? { sammelIn: 6, ohneHoster: true } : {}));
  }
  if (sonderfaelle) {
    // Die Randspalte: fremde Serien mit eigenen Staffel- und Folgenlinks. Sie
    // duerfen weder die Staffelzahl noch die Folgenliste beruehren.
    kinder.push(new Knoten("a", { href: "/anime/stream/bleach/staffel-17" }, "Bleach"));
    kinder.push(new Knoten("a", { href: "/anime/stream/bleach/staffel-17/episode-40" }, "Bleach F40"));
  }
  return new Knoten("body", {}, "", kinder);
}

const SKRIPT = seitendaten.uebersichtSkript();

// --- Was dabei herauskommen muss --------------------------------------------

{
  const ergebnis = fahre(SKRIPT, seite(), `/anime/stream/${SLUG}/staffel-1/episode-1`);

  pruefe("Der Titel kommt von der Seite", ergebnis.titel === "BLACK TORCH", ergebnis.titel);
  pruefe("Alle drei Staffeln stehen da",
    ergebnis.staffeln.map((s) => s.staffel).join(",") === "1,2,3",
    ergebnis.staffeln.map((s) => s.staffel).join(","));
  pruefe("Die Staffel einer fremden Serie zaehlt nicht mit",
    !ergebnis.staffeln.some((s) => s.staffel === 17),
    "Bleach hat siebzehn - BLACK TORCH nicht");
  pruefe("Jede Staffel bringt ihre Adresse mit",
    ergebnis.staffeln.every((s) => s.url.includes(`/${SLUG}/staffel-`)),
    ergebnis.staffeln[0] && ergebnis.staffeln[0].url);

  pruefe("Acht Folgen der offenen Staffel", ergebnis.folgen.length === 8, String(ergebnis.folgen.length));
  pruefe("Keine Folge einer fremden Serie",
    !ergebnis.folgen.some((f) => f.url.includes("bleach")));
  pruefe("Die Folgen stehen in ihrer Reihenfolge",
    ergebnis.folgen.map((f) => f.folge).join(",") === "1,2,3,4,5,6,7,8",
    ergebnis.folgen.map((f) => f.folge).join(","));
  pruefe("Die offene Staffel ist erkannt", ergebnis.offeneStaffel === 1, String(ergebnis.offeneStaffel));

  const doppel = ergebnis.folgen.find((f) => f.folge === 7);
  pruefe("Eine Doppelfolge ohne Hoster ist als gesperrt vermerkt",
    doppel && doppel.gesperrt === true,
    "sonst waehlt jemand eine Folge, die nicht laeuft");
  pruefe("Und die uebrigen sind es nicht",
    ergebnis.folgen.filter((f) => f.gesperrt).length === 1,
    `${ergebnis.folgen.filter((f) => f.gesperrt).length} gesperrt`);
}

// Eine Serie ohne Staffelreiter - viele Anbieter fuehren einteilige Serien so.
//
// Die Staffel steht dann trotzdem fest, denn die Folgenlinks tragen sie im
// Pfad. Das ist die bessere Auskunft: eine Serie mit acht Folgen und ohne
// Reiter hat eine Staffel, nicht null.
{
  const ergebnis = fahre(SKRIPT, seite({ staffeln: [], offen: 1, folgen: 4, sonderfaelle: false }),
    `/anime/stream/${SLUG}/staffel-1/episode-1`);
  pruefe("Ohne Reiter kommt die Staffel aus den Folgenlinks",
    ergebnis.staffeln.map((s) => s.staffel).join(",") === "1",
    ergebnis.staffeln.map((s) => s.staffel).join(",") || "(leer)");
  pruefe("Die Folgen stehen trotzdem da", ergebnis.folgen.length === 4, String(ergebnis.folgen.length));
}

// Die Serienuebersicht selbst - ohne /staffel-N im Pfad.
{
  const ergebnis = fahre(SKRIPT, seite({ staffeln: [1, 2], offen: 1, folgen: 3, sonderfaelle: false }),
    `/anime/stream/${SLUG}`);
  pruefe("Auf der Serienseite ist keine Staffel offen", ergebnis.offeneStaffel === 0,
    String(ergebnis.offeneStaffel));
  pruefe("Die Staffeln stehen dort trotzdem", ergebnis.staffeln.length === 2);
}

// Eine Seite ohne alles darf nichts behaupten.
{
  const ergebnis = fahre(SKRIPT, new Knoten("body", {}, "", []), `/anime/stream/${SLUG}`);
  pruefe("Eine leere Seite ergibt eine leere Uebersicht",
    ergebnis.staffeln.length === 0 && ergebnis.folgen.length === 0,
    "lieber keine Auskunft als eine erfundene");
}

/* ------------------------------- Und was keine Uebersicht bekommt ---------- */
//
// Der zweite Teil derselben Weiche, und der gemeldete Fehler sass hier: nicht
// alles, was jemand antippt, ist eine Serie. Ein Film hat keine Staffeln, also
// faellt er aus der Uebersicht heraus - und landete bisher auf der nackten
// Anbieterseite, ohne Ladevorhang, ohne Autostart, ohne Vollbild. Gemeldet vom
// Fernseher: AniWorld und s.to starteten, die Filme von filmo.to nicht.
//
// Geprueft am Quelltext, weil die Weiche in MainActivity steht und dort keine
// reine Rechnung ist: sie oeffnet Ansichten.
{
  const fs2 = require("fs");
  const path2 = require("path");
  const HAUPT = fs2.readFileSync(
    path2.join(__dirname, "..", "..", "android/app/src/main/java/local/elflix/android/MainActivity.java"),
    "utf8");

  pruefe("Ohne Uebersicht wird gestartet und nicht nur geoeffnet",
    /!uebersichtLohnt\(url\)\) \{[\s\S]{0,1500}?if \(direktStartLohnt\(url\)\) \{\s*direktStarten\(provider, url, titel\);/
      .test(HAUPT),
    "sonst steht der Film auf der Anbieterseite und niemand hat ihn angefangen");

  pruefe("Der direkte Start zieht denselben Vorhang wie Weiterschauen",
    /private void direktStarten\([\s\S]{0,900}?startBegleiten\(provider, url,[\s\S]{0,300}?armAutoStart\(url, stelle\)/
      .test(HAUPT));

  pruefe("und nimmt einen gespeicherten Stand mit",
    /private void direktStarten\([\s\S]{0,400}?bestand\.zuAdresse\(url\)[\s\S]{0,200}?currentTime\(\)/
      .test(HAUPT),
    "ein halb gesehener Film faengt nicht wieder vorn an");

  // Die Grenze der neuen Weiche. Eine Serienseite ohne Folge ist kein
  // Startpunkt - dort gibt es keinen Player, und der Autostart wartete
  // neunzig Sekunden auf einen, den es nie geben wird.
  pruefe("Eine Serienseite ohne Folge wird nicht gestartet",
    /private boolean direktStartLohnt\(String url\) \{[\s\S]{0,600}?return !adresseSiehtNachSerieAus\(url\);/
      .test(HAUPT));
  pruefe("und YouTube ebenso wenig",
    /private boolean direktStartLohnt\(String url\) \{[\s\S]{0,400}?youtube\.istYoutube\(url\)\) return false;/
      .test(HAUPT),
    "es bringt seinen eigenen Weg mit");
}

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
