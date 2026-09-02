"use strict";

// Das Opening zu einem Titel des Jahresrueckblicks.
//
// Der Jahresrueckblick war stumm. Musik dazu ist naheliegend - nur hat ELFIX
// keine: kein Ton im Paket, keine Tonspur ausser der des Anbieters. Mitliefern
// scheidet aus (fremdes Urheberrecht, und die APK ist vier Megabyte gross), und
// versteckt bei YouTube abspielen hiesse Werbung vor dem Opening und mal das
// richtige Lied, mal ein Cover.
//
// Bleibt animethemes.moe: ein offener Katalog der Vor- und Abspaenne von
// Anime, mit einer oeffentlichen Schnittstelle und direkten Adressen auf die
// Tonspur. Nur Anime - fuer Serien und Filme gibt es nichts Vergleichbares, und
// deshalb kann diese Datei auch nur fuer Anime etwas liefern.
//
// **Was hier steht und was nicht.** Dieses Modul rechnet und holt nichts: es
// baut die Adresse der Anfrage und liest die Antwort. Genau deshalb steht es
// hier und nicht in main.js - so laesst es sich pruefen, ohne das Netz zu
// fragen. Das ist hier mehr als eine Gewohnheit: geschrieben wurde es gegen
// eine Schnittstelle, die aus der Entwicklungsumgebung nicht erreichbar war
// (der Host ist dort gesperrt), also gegen eine Vorstellung ihrer Antwort und
// nicht gegen eine echte.
//
// Daraus folgt die Bauart: **lesen, was da ist, statt zu erwarten, was da sein
// soll.** Der Leser unten haelt sich an keinen festen Pfad, sondern sucht in
// dem, was hereinkommt, nach etwas Brauchbarem. Und findet er nichts, gibt er
// null zurueck - der Rueckblick bleibt dann stumm und laeuft weiter. Ein
// Rueckblick ohne Musik ist das, was es vorher gab; einer, der auf eine
// unerwartete Antwort mit einem Fehler antwortet, waere schlechter als beides.

const taste = require("./taste");

const WIRT = "https://api.animethemes.moe";

/**
 * Die Anfrage zu einem Titel.
 *
 * <p>Gesucht wird ueber die Suche und nicht ueber einen Namensfilter: die
 * Titel in ELFIX kommen von den Anbietern und sind mal "Attack on Titan", mal
 * "Shingeki no Kyojin", mal mit angehaengter Staffel. Ein exakter Filter
 * traefe davon genau eine Schreibweise.
 */
/**
 * Der Titel, mit dem gesucht wird.
 *
 * <p>Die Anbieter haengen an, um welchen Teil es geht: "One Piece Staffel 21",
 * "Vinland Saga Season 2", "Demon Slayer - Teil 3". Der Katalog fuehrt die
 * Serie unter ihrem Namen, und die Suche findet mit dem Anhang nichts oder das
 * Falsche. Abgeschnitten wird deshalb, was erkennbar eine Fortsetzung
 * bezeichnet - und nur das: aus "Attack on Titan" wird nichts, denn dort steht
 * keine Nummer.
 */
function suchTitel(titel) {
  return String(titel || "")
    .replace(/[\s:,\-–—]*\(?\b(?:staffel|season|teil|part|cour|vol\.?|volume)\b[\s.]*\d+\)?\s*$/i, "")
    .replace(/[\s:,\-–—]+$/, "")
    .trim();
}

function anfrageUrl(titel) {
  const name = suchTitel(titel);
  if (!name) return "";
  const felder = [
    "q=" + encodeURIComponent(name),
    "fields[search]=anime",
    "include[anime]=animethemes.animethemeentries.videos.audio,animethemes.song"
  ];
  return `${WIRT}/search?${felder.join("&")}`;
}

// Alles, was in einem Baum unter einem der genannten Namen steht - egal wie
// tief. Der Leser weiter unten lebt davon: er muss die Verschachtelung der
// Antwort nicht kennen, sondern nur, wie die Dinge heissen, die er sucht.
function sammle(wert, namen, tiefe = 0) {
  if (!wert || typeof wert !== "object" || tiefe > 8) return [];
  if (Array.isArray(wert)) return wert.flatMap((teil) => sammle(teil, namen, tiefe + 1));
  const treffer = [];
  for (const [name, inhalt] of Object.entries(wert)) {
    if (namen.includes(name)) treffer.push(inhalt);
    treffer.push(...sammle(inhalt, namen, tiefe + 1));
  }
  return treffer;
}

function text(wert) {
  return typeof wert === "string" ? wert.trim() : "";
}

/**
 * Ob zwei Titel denselben Anime meinen - mit derselben Normalisierung wie
 * ueberall sonst in ELFIX.
 */
function passt(gesucht, gefunden) {
  const links = taste.titelSchluessel(gesucht);
  const rechts = taste.titelSchluessel(gefunden);
  return Boolean(links) && links === rechts;
}

/**
 * Die Nummer eines Vor- oder Abspanns.
 *
 * <p>Steht meistens in {@code sequence} - aber eben nur meistens. In der
 * aufgezeichneten Antwort ist sie bei acht von dreizehn Themen {@code null},
 * und die Nummer steht dann nur im {@code slug}: "OP1", "OP2", "OP1-TV".
 * Ohne diesen Rueckfall waeren alle gleichauf, und welches Opening gewinnt,
 * haenge an der Reihenfolge der Antwort.
 */
function nummerAus(thema) {
  const roh = Number(thema?.sequence);
  if (Number.isFinite(roh) && roh > 0) return roh;
  const ausSlug = String(thema?.slug || "").match(/(\d+)/);
  return ausSlug ? Number(ausSlug[1]) : 1;
}

/**
 * Welcher Anime von den gefundenen gemeint ist.
 *
 * <p><b>Hier waere die Anbindung gescheitert.</b> Geschrieben war sie auf einen
 * genauen Titelvergleich - und der trifft in der Praxis fast nie: die Anbieter
 * nennen die Serie "Attack on Titan", der Katalog fuehrt sie unter "Shingeki no
 * Kyojin". Kein Treffer, keine Musik, und zwar bei so ziemlich jedem Anime mit
 * englischem Titel. Aufgefallen ist das erst an einer echten Antwort.
 *
 * <p>Der genaue Vergleich bleibt trotzdem die erste Wahl - wo er trifft
 * ("Naruto"), ist er unbestechlich. Trifft er nicht, entscheidet, was die
 * Antwort selbst hergibt:
 *
 * <ul>
 *   <li><b>Fernsehfassung vor allem anderen.</b> Unter den fuenfzehn Treffern
 *       zu "Attack on Titan" sind Filme, OVAs, Specials und
 *       Zusammenschnitte - der erste davon ist ein Recap-Film, dessen einziges
 *       Stueck ein Abspann ist. Wer die Serie geschaut hat, meint die Serie.
 *   <li><b>Das aelteste Jahr.</b> Zwischen "Shingeki no Kyojin" (2013) und
 *       seinen fuenf Fortsetzungen ist die Grundserie gemeint; sie ist die
 *       aelteste. Nebenbei faellt damit auch die Schulparodie von 2015 weg.
 * </ul>
 *
 * <p>Das ist eine Heuristik und keine Gewissheit - deshalb nennt der
 * Rueckblick den Namen des gewaehlten Anime am Knopf. Wer dort etwas anderes
 * liest, als er erwartet hat, sieht sofort, dass danebengegriffen wurde,
 * statt sich ueber ein fremdes Lied zu wundern.
 *
 * <p><b>Sie gilt fuer jede Gattung, die ueberhaupt gefragt wird.</b> Eine
 * Zeitlang galt sie nur fuer Anime, und alles, was die Anbieter als
 * gewoehnliche Serie fuehren, brauchte einen genauen Titeltreffer. Damit blieb
 * fast jede Serie stumm: "One Piece" steht bei den Anbietern als Serie, und
 * ein genauer Vergleich trifft aus denselben Gruenden selten wie oben. Der
 * Preis ist bekannt und in Kauf genommen - eine Serie ohne Gegenstueck im
 * Katalog bekommt das Opening dessen, was die Suche fuer aehnlich haelt. Am
 * Knopf steht, was laeuft und woher; ein Fehlgriff ist damit sichtbar.
 */
function besterAnime(kandidaten, titel) {
  const brauchbar = kandidaten.filter((eintrag) => eintrag && typeof eintrag === "object");
  const genau = brauchbar.filter((eintrag) => {
    const namen = [eintrag.name, ...sammle(eintrag, ["title"]).map(text)];
    return namen.some((name) => passt(titel, name));
  });
  if (genau.length) return genau;
  const fernsehen = brauchbar.filter(
    (eintrag) => text(eintrag.media_format).toUpperCase() === "TV");
  const feld = fernsehen.length ? fernsehen : brauchbar;
  return [...feld]
    .sort((links, rechts) => (Number(links.year) || 9999) - (Number(rechts.year) || 9999))
    .slice(0, 1);
}

/**
 * Die Tonspur des Openings aus einer Antwort - oder null.
 *
 * <p>Bevorzugt wird der Vorspann ({@code OP}) mit der kleinsten Nummer, also
 * das erste Opening. Gibt es keinen, ist ein Abspann besser als Stille.
 *
 * <p>Eintraege, die der Katalog selbst als {@code spoiler} kennzeichnet, kommen
 * zuletzt - das sind die Abspaenne, die das Ende verraten. Ein Rueckblick, der
 * seine eigene Pointe schuetzt, sollte nicht die der Serie ausplaudern.
 *
 * @param antwort das geparste JSON - beliebig geformt, auch Unsinn
 * @param titel   der Titel, um den es geht
 * @return {{url, lied, anime}} oder null
 */
function openingAus(antwort, titel) {
  if (!antwort || typeof antwort !== "object") return null;
  const name = suchTitel(titel);
  const kandidaten = sammle(antwort, ["anime"]).flat().filter(Boolean);
  const treffer = besterAnime(kandidaten, name);
  if (!treffer.length) return null;

  let bestes = null;
  for (const anime of treffer) {
    for (const thema of sammle(anime, ["animethemes"]).flat().filter(Boolean)) {
      if (!thema || typeof thema !== "object") continue;
      const art = text(thema.type).toUpperCase();
      const eintraege = sammle(thema, ["animethemeentries"]).flat().filter(Boolean);
      const verraet = eintraege.length > 0 && eintraege.every((eintrag) => eintrag?.spoiler === true);
      const adressen = [
        ...sammle(thema, ["audio"]).flatMap((wert) => sammle(wert, ["link"])),
        ...sammle(thema, ["videos"]).flat().flatMap((wert) => sammle(wert, ["link"]))
      ].map(text).filter((adresse) => /^https?:\/\//.test(adresse));
      if (!adressen.length) continue;
      // Rang, in dieser Ordnung: kein Spoiler, Vorspann, kleine Nummer.
      const rang = (verraet ? 1 : 0) * 10000 + (art === "OP" ? 0 : 1) * 100 + nummerAus(thema);
      if (!bestes || rang < bestes.rang) {
        bestes = { rang, url: adressen[0], lied: text(thema.song?.title), anime: text(anime.name) };
      }
    }
  }
  if (!bestes) return null;
  return { url: bestes.url, lied: bestes.lied, anime: bestes.anime };
}

module.exports = { WIRT, suchTitel, anfrageUrl, sammle, passt, nummerAus, besterAnime, openingAus };
