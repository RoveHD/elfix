"use strict";

// Das Opening zur Serie des Jahres.
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
function anfrageUrl(titel) {
  const name = String(titel || "").trim();
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
 * Ob zwei Titel denselben Anime meinen.
 *
 * <p>Mit derselben Normalisierung wie ueberall sonst in ELFIX - eine zweite
 * waere eine zweite Wahrheit. Der Vergleich ist streng, und das mit Absicht:
 * eine Suche liefert auch Aehnliches, und das Opening der falschen Serie ist
 * schlechter als gar keins. Wer "Naruto" geschaut hat, will nicht das Opening
 * von "Naruto Shippuden" hoeren und sich fragen, ob ELFIX seine Zahlen
 * genauso sorgfaeltig behandelt.
 */
function passt(gesucht, gefunden) {
  const links = taste.titelSchluessel(gesucht);
  const rechts = taste.titelSchluessel(gefunden);
  return Boolean(links) && links === rechts;
}

/**
 * Die Tonspur des Openings aus einer Antwort - oder null.
 *
 * <p>Bevorzugt wird der Vorspann ({@code OP}) mit der kleinsten Nummer, also
 * das erste Opening der Serie. Gibt es keinen, faellt die Wahl auf irgendeine
 * gefundene Tonspur des passenden Titels; ein Abspann ist besser als Stille.
 *
 * @param antwort das geparste JSON - beliebig geformt, auch Unsinn
 * @param titel   der Titel, um den es geht; nur er darf gewinnen
 * @return {{url, lied, anime}} oder null
 */
function openingAus(antwort, titel) {
  if (!antwort || typeof antwort !== "object") return null;

  // Die Anime-Eintraege koennen unter "anime" oder in einem "search"-Kasten
  // liegen. Gesammelt wird beides und danach entschieden.
  const kandidaten = sammle(antwort, ["anime"]).flat().filter(Boolean);
  const treffer = kandidaten.filter((eintrag) => {
    if (!eintrag || typeof eintrag !== "object") return false;
    const namen = [eintrag.name, ...sammle(eintrag, ["title"]).map(text)];
    return namen.some((name) => passt(titel, name));
  });
  if (!treffer.length) return null;

  let bestes = null;
  for (const anime of treffer) {
    for (const thema of sammle(anime, ["animethemes"]).flat().filter(Boolean)) {
      const art = text(thema?.type).toUpperCase();
      const nummer = Number(thema?.sequence) || 1;
      const adressen = [
        ...sammle(thema, ["audio"]).flatMap((a) => sammle(a, ["link"])),
        ...sammle(thema, ["videos"]).flat().flatMap((v) => sammle(v, ["link"]))
      ].map(text).filter((adresse) => /^https?:\/\//.test(adresse));
      if (!adressen.length) continue;
      // Rang: Vorspann vor Abspann, kleine Nummer vor grosser.
      const rang = (art === "OP" ? 0 : 1) * 1000 + nummer;
      if (!bestes || rang < bestes.rang) {
        bestes = {
          rang,
          url: adressen[0],
          lied: text(thema?.song?.title),
          anime: text(anime?.name)
        };
      }
    }
  }
  if (!bestes) return null;
  return { url: bestes.url, lied: bestes.lied, anime: bestes.anime };
}

module.exports = { WIRT, anfrageUrl, sammle, passt, openingAus };
