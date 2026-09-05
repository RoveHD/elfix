"use strict";

/*
 * Was in einem Manifest steht.
 *
 * Eine Adresse endet auf ".m3u8" - das sagt noch nicht, was dahinter liegt. Es
 * kann eine Liste von Stufen sein (Master), eine Liste von Stuecken (Media),
 * ein Live-Kanal ohne Ende, oder etwas ganz anderes mit passender Endung. Die
 * Endung ist eine Behauptung der Adresse; hier wird nachgesehen.
 *
 * <h2>Warum das mehr ist als Neugier</h2>
 *
 * Drei Dinge haengen daran, und alle drei entscheiden ueber ein schwarzes Bild:
 *
 *   1. <b>Master oder Media.</b> Ein Master nennt die Stufen und ist das, was
 *      ein Player haben will. Eine Media-Playlist ist eine einzelne Stufe -
 *      spielbar, aber ohne Auswahl.
 *   2. <b>Die Laufzeit.</b> Die Summe der `#EXTINF` ist das schaerfste Mittel,
 *      um einen Werbe-Vorspann von einer Folge zu unterscheiden: 15 bis 90
 *      Sekunden gegen zwanzig Minuten. Keine Heuristik ueber Adressen kommt da
 *      heran (siehe streamspur.js).
 *   3. <b>Untertitel und Tonspuren.</b> Sie stehen im Master und nirgendwo
 *      sonst. Wer sie nicht hier liest, hat sie nicht.
 *
 * <h2>Was hier nicht passiert</h2>
 *
 * Kein Netz. Der Text kommt von aussen; wer ihn holt, weiss selbst am besten,
 * mit welchen Kopfzeilen. Und keine Vollstaendigkeit: das hier ist kein
 * HLS-Parser, sondern die Antwort auf die drei Fragen oben. Was darueber
 * hinausgeht, kann der Player selbst besser.
 */

/** So lange darf eine Playlist hoechstens sein, bevor sie abgeschnitten wird. */
const HOECHSTZEICHEN = 4 * 1024 * 1024;

/* --------------------------------------------------------------- Erkennen */

/**
 * Was ist das ueberhaupt?
 *
 * Gefragt wird der Inhalt, nicht die Endung. `#EXT-X-STREAM-INF` steht nur in
 * einem Master, `#EXTINF` nur in einer Media-Playlist; ein DASH-Manifest ist
 * XML und faengt mit `<MPD` an. Steht beides da - was vorkommt, wenn ein
 * Anbieter Stufen und Stuecke in eine Datei schreibt -, gilt der Master: er ist
 * die umfassendere Auskunft.
 */
function art(text) {
  const roh = String(text || "").slice(0, HOECHSTZEICHEN);
  if (/<MPD[\s>]/i.test(roh) || /urn:mpeg:dash:schema/i.test(roh)) return "dash";
  if (!/^\s*#EXTM3U/m.test(roh)) return "unbekannt";
  if (/#EXT-X-STREAM-INF/i.test(roh)) return "master";
  if (/#EXTINF/i.test(roh)) return "media";
  return "unbekannt";
}

/** Eine Adresse aus dem Manifest, an seiner eigenen Adresse festgemacht. */
function adresse(roh, basis) {
  const wert = String(roh || "").trim().replace(/^"|"$/g, "");
  if (!wert) return "";
  try {
    const ziel = new URL(wert, basis || undefined);
    return ziel.protocol === "http:" || ziel.protocol === "https:" ? ziel.href : "";
  } catch (_) {
    return "";
  }
}

/**
 * Ein Wert aus einer Attributzeile: `BANDWIDTH=123,NAME="x"`.
 *
 * Vor dem Namen darf ein Komma stehen oder der Doppelpunkt der Marke selbst -
 * `#EXT-X-MEDIA:TYPE=SUBTITLES` faengt mit dem ersten Attribut unmittelbar nach
 * dem Doppelpunkt an. Ohne diesen Fall waeren alle Spuren unsichtbar, und zwar
 * genau die, die es sonst nirgendwo zu lesen gibt.
 */
function attribut(zeile, name) {
  const muster = new RegExp(`(?:^|[,:])\\s*${name}=("[^"]*"|[^,]*)`, "i");
  const treffer = muster.exec(String(zeile || ""));
  if (!treffer) return "";
  return treffer[1].replace(/^"|"$/g, "").trim();
}

/* ------------------------------------------------------------------ Master */

/**
 * Die Stufen eines Masters.
 *
 * Jede Stufe sind zwei Zeilen: die Beschreibung (`#EXT-X-STREAM-INF:…`) und die
 * Adresse darunter. Kommentarzeilen dazwischen kommen vor und werden
 * uebersprungen - eine leere Adresse waere sonst eine Stufe ohne Ziel.
 */
function stufenLesen(text, basis) {
  const zeilen = String(text || "").split(/\r?\n/);
  const stufen = [];
  for (let i = 0; i < zeilen.length; i += 1) {
    if (!/^#EXT-X-STREAM-INF/i.test(zeilen[i])) continue;
    let ziel = "";
    for (let j = i + 1; j < zeilen.length; j += 1) {
      const kandidat = zeilen[j].trim();
      if (!kandidat || kandidat.startsWith("#")) continue;
      ziel = adresse(kandidat, basis);
      break;
    }
    if (!ziel) continue;
    const aufloesung = attribut(zeilen[i], "RESOLUTION");
    const hoehe = /\d+x(\d+)/i.exec(aufloesung);
    stufen.push({
      adresse: ziel,
      hoehe: hoehe ? Number(hoehe[1]) : 0,
      bandbreite: Number(attribut(zeilen[i], "BANDWIDTH")) || 0,
      name: attribut(zeilen[i], "NAME") || ""
    });
  }
  return stufen;
}

/**
 * Untertitel und Tonspuren.
 *
 * Beide stehen als `#EXT-X-MEDIA` da und unterscheiden sich nur im `TYPE`.
 * Eine Spur ohne eigene Adresse ist eine, die im Bild mitliegt - die kann der
 * Player selbst, sie gehoert hier nicht in die Liste.
 */
function spurenLesen(text, basis, typ) {
  const zeilen = String(text || "").split(/\r?\n/);
  const spuren = [];
  for (const zeile of zeilen) {
    if (!/^#EXT-X-MEDIA/i.test(zeile)) continue;
    if (attribut(zeile, "TYPE").toUpperCase() !== typ) continue;
    const ziel = adresse(attribut(zeile, "URI"), basis);
    if (!ziel && typ === "SUBTITLES") continue;
    spuren.push({
      adresse: ziel,
      sprache: attribut(zeile, "LANGUAGE"),
      name: attribut(zeile, "NAME"),
      vorgabe: /YES/i.test(attribut(zeile, "DEFAULT"))
    });
  }
  return spuren;
}

/* ------------------------------------------------------------------- Media */

/**
 * Die Laufzeit einer Media-Playlist.
 *
 * Die Summe aller `#EXTINF`. Bei einem Live-Kanal ist sie bedeutungslos - dort
 * steht immer nur ein Fenster von ein paar Minuten in der Liste -, deshalb
 * kommt `live` mit zurueck: eine Playlist ohne `#EXT-X-ENDLIST` ist nicht zu
 * Ende, sondern laeuft weiter.
 */
function laufzeitLesen(text) {
  const zeilen = String(text || "").split(/\r?\n/);
  let laufzeit = 0;
  let stuecke = 0;
  for (const zeile of zeilen) {
    const treffer = /^#EXTINF:\s*([\d.]+)/i.exec(zeile);
    if (!treffer) continue;
    const dauer = Number(treffer[1]);
    if (Number.isFinite(dauer) && dauer > 0) {
      laufzeit += dauer;
      stuecke += 1;
    }
  }
  const live = !/#EXT-X-ENDLIST/i.test(text) && !/#EXT-X-PLAYLIST-TYPE:\s*VOD/i.test(text);
  return { laufzeit: Math.round(laufzeit), stuecke, live };
}

/* ------------------------------------------------------------- Alles zusammen */

/**
 * Ein Manifest, gelesen.
 *
 * Immer dieselbe Form, egal welche Sorte - der Aufrufer soll nicht drei Faelle
 * unterscheiden muessen. Was es nicht gibt, ist leer oder null, nicht
 * undefiniert.
 */
function lesen(text, basis = "") {
  const roh = String(text || "").slice(0, HOECHSTZEICHEN);
  const sorte = art(roh);
  if (sorte === "master") {
    return {
      art: "master",
      stufen: stufenLesen(roh, basis),
      untertitel: spurenLesen(roh, basis, "SUBTITLES"),
      tonspuren: spurenLesen(roh, basis, "AUDIO"),
      laufzeit: 0,
      stuecke: 0,
      live: false
    };
  }
  if (sorte === "media") {
    const zeit = laufzeitLesen(roh);
    return {
      art: "media",
      stufen: [],
      untertitel: [],
      tonspuren: [],
      laufzeit: zeit.laufzeit,
      stuecke: zeit.stuecke,
      live: zeit.live
    };
  }
  if (sorte === "dash") {
    // Aus dem MPD kommt hier nur, was ohne XML-Werkzeug sicher zu lesen ist:
    // die angegebene Gesamtdauer. Alles Weitere kann der Player besser - und
    // ein halbgarer XML-Leser waere eine Fehlerquelle fuer einen Fall, der bei
    // diesen Hostern kaum vorkommt.
    const dauer = /mediaPresentationDuration="([^"]+)"/i.exec(roh);
    return {
      art: "dash",
      stufen: [],
      untertitel: [],
      tonspuren: [],
      laufzeit: dauer ? isoDauer(dauer[1]) : 0,
      stuecke: 0,
      live: /type="dynamic"/i.test(roh)
    };
  }
  return { art: "unbekannt", stufen: [], untertitel: [], tonspuren: [], laufzeit: 0, stuecke: 0, live: false };
}

/** "PT1H23M45.6S" in Sekunden. */
function isoDauer(wert) {
  const treffer = /^P(?:[^T]*)T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i
    .exec(String(wert || "").trim());
  if (!treffer) return 0;
  const stunden = Number(treffer[1]) || 0;
  const minuten = Number(treffer[2]) || 0;
  const sekunden = Number(treffer[3]) || 0;
  return Math.round(stunden * 3600 + minuten * 60 + sekunden);
}

/** Die beste Stufe eines Masters - nach Hoehe, sonst nach Bandbreite. */
function besteStufe(stufen) {
  const liste = Array.isArray(stufen) ? stufen.filter(Boolean) : [];
  if (!liste.length) return null;
  return liste.reduce((bester, stufe) => {
    if (stufe.hoehe !== bester.hoehe) return stufe.hoehe > bester.hoehe ? stufe : bester;
    return stufe.bandbreite > bester.bandbreite ? stufe : bester;
  }, liste[0]);
}

module.exports = { art, lesen, stufenLesen, spurenLesen, laufzeitLesen, besteStufe, isoDauer, HOECHSTZEICHEN };
