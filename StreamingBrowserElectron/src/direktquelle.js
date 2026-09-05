"use strict";

/*
 * Die Quelle hinter dem Hoster.
 *
 * <h2>Worum es geht</h2>
 *
 * Bisher zeigt ELFIX die Seite des Hosters: ein Rahmen im Rahmen, darin ein
 * fremder Player. Alles, was ELFIX daran verbessern will, ist Arbeit gegen
 * diesen Player - die Werbeschichten wegraeumen, die Qualitaet hochdrehen, die
 * Stelle setzen, ohne dass er neu puffert. Jede dieser Stellen ist eine eigene
 * Massnahme gegen fremdes Verhalten, und jede geht kaputt, wenn der Hoster
 * seinen Player aendert.
 *
 * Hinter dem Player liegt aber eine ganz gewoehnliche Adresse: eine
 * HLS-Playlist oder eine MP4-Datei. Wer sie hat, braucht den Rahmen nicht mehr.
 * Dieses Modul holt sie aus dem Quelltext der Hosterseite.
 *
 * <h2>Was hier drin steht - und was nicht</h2>
 *
 * Hier steht *nur* das Lesen: Text hinein, Adresse heraus. Kein Netz, kein
 * DOM, kein Electron. Das hat zwei Gruende. Der erste ist Pruefbarkeit - so
 * laesst sich jede Spielart eines Hosters als Probe hinlegen und ohne Geraet
 * messen (tests/direktquelletest.js). Der zweite ist, dass dieselbe Rechnung
 * auf dem Telefon gebraucht wird: der Kern-WebView kann dieses Modul
 * unveraendert laden, so wie er es mit startphasen.js schon tut.
 *
 * Das Holen der Seite steht dort, wo es hingehoert - im Hauptprozess, der
 * Referer und Kennung mitschickt.
 *
 * <h2>Warum nichts geraten wird</h2>
 *
 * Ein falsch geratener Treffer ist schlimmer als gar keiner: er fuehrt zu einem
 * schwarzen Bild statt zu einem Film, und der Zuschauer weiss nicht, warum.
 * Deshalb gilt hier durchgehend: jeder Fund muss eine Adresse sein, die sich
 * als solche ausweist (http/https, ein Pfad, der nach Video aussieht), jede
 * Entschluesselung wird an ihrem Ergebnis geprueft und nicht daran, dass sie
 * ohne Fehler durchlief, und jeder Fund traegt seine `herkunft` mit. Findet
 * sich nichts, ist das ein sauberes "nichts" - der Aufrufer nimmt dann den
 * Rahmen des Hosters, so wie bisher.
 *
 * <h2>Woher das Verfahren fuer VOE stammt</h2>
 *
 * VOE verpackt seine Angaben in mehreren Lagen (Drehung, Fuellzeichen, zweimal
 * Base64, eine Verschiebung der Zeichen, eine Umkehrung). Die Reihenfolge ist
 * die, die die offenen Aufloeser benutzen - sie ist hier *nicht* an einer
 * lebenden Seite nachgemessen, sondern nachgebaut. Genau darum steht unter
 * jedem Schritt eine Pruefung: geht die Kette anders, faellt sie hier durch und
 * nicht erst beim Zuschauer.
 */

/** Adressen, die als Quelle in Frage kommen. */
const VIDEO_ENDUNGEN = /\.(m3u8|mp4|mkv|webm)(\?|#|$)/i;

/**
 * Die Fuellzeichen, die VOE in seinen Block streut.
 *
 * Sie stehen zwischen den echten Zeichen und sollen genau das verhindern, was
 * hier passiert. Entfernt wird nach der Drehung - vorher stuenden sie gedreht
 * da und wuerden nicht gefunden.
 */
const VOE_MUELL = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];

/** Um wie viel die Zeichen im vorletzten Schritt verschoben sind. */
const VOE_VERSATZ = 3;

/* ------------------------------------------------------------ Kleinigkeiten */

/** ROT13 - jeder Buchstabe um dreizehn Stellen weiter, alles andere bleibt. */
function drehen(text) {
  return String(text || "").replace(/[a-zA-Z]/g, (zeichen) => {
    const basis = zeichen <= "Z" ? 65 : 97;
    return String.fromCharCode(((zeichen.charCodeAt(0) - basis + 13) % 26) + basis);
  });
}

/**
 * Base64 zurueck in Text - im Hauptprozess wie im WebView.
 *
 * Node kennt `Buffer`, der WebView kennt `atob`; dieses Modul laeuft in beiden.
 * Beide sind gutmuetig: sie ueberlesen Zeichen, die in Base64 nichts zu suchen
 * haben, und liefern dann Buchstabensalat statt eines Fehlers. Deshalb wird
 * vorher geprueft, ob ueberhaupt Base64 dasteht - sonst haelt der naechste
 * Schritt Salat fuer eine Zwischenstufe.
 */
function ausBase64(roh) {
  const text = String(roh || "").replace(/\s+/g, "");
  if (!text || text.length % 4 !== 0) return "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return "";
  try {
    if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
      return Buffer.from(text, "base64").toString("utf8");
    }
    if (typeof atob === "function") {
      const roh8 = atob(text);
      let ergebnis = "";
      for (let i = 0; i < roh8.length; i += 1) ergebnis += String.fromCharCode(roh8.charCodeAt(i) & 0xff);
      return ergebnis;
    }
  } catch (_) {
    return "";
  }
  return "";
}

/** Jedes Zeichen um `versatz` Stellen zurueck. */
function verschieben(text, versatz) {
  let ergebnis = "";
  for (let i = 0; i < text.length; i += 1) {
    ergebnis += String.fromCharCode(text.charCodeAt(i) - versatz);
  }
  return ergebnis;
}

/** Zeichenweise umgedreht. */
function umkehren(text) {
  return String(text || "").split("").reverse().join("");
}

/**
 * Eine Adresse, die wirklich eine ist.
 *
 * Relative Angaben kommen vor ("//streamtape.com/get_video?..."), deshalb die
 * Basis. Alles, was nicht http oder https wird, faellt weg - eine
 * `blob:`-Adresse aus dem Quelltext ist im eigenen Player wertlos.
 */
function adresseNormalisieren(roh, basis) {
  const wert = String(roh || "").trim().replace(/\\\//g, "/");
  if (!wert) return "";
  try {
    const adresse = new URL(wert, basis || undefined);
    if (adresse.protocol !== "http:" && adresse.protocol !== "https:") return "";
    return adresse.href;
  } catch (_) {
    return "";
  }
}

/**
 * Steht in diesem Wert eine Adresse - notfalls eine verpackte?
 *
 * VOE legt seine Adressen mal im Klartext ab und mal als Base64. Beides kommt
 * an derselben Stelle vor, also wird beides versucht: erst, was dasteht, dann
 * das Ausgepackte. Ausgepackt wird nur, wenn dabei wieder eine Adresse
 * herauskommt - sonst bliebe es beim Salat.
 */
function adresseAusWert(roh, basis) {
  const wert = String(roh || "").trim();
  if (!wert) return "";
  const gerade = adresseNormalisieren(wert, basis);
  if (gerade && /^https?:/i.test(wert)) return gerade;
  const ausgepackt = ausBase64(wert);
  if (ausgepackt && /^https?:\/\//i.test(ausgepackt.trim())) {
    return adresseNormalisieren(ausgepackt.trim(), basis);
  }
  return gerade && /^\/\//.test(wert) ? gerade : "";
}

/** HLS oder Datei? Entschieden wird an der Endung, nicht am Hoster. */
function typBestimmen(adresse) {
  if (/\.m3u8(\?|#|$)/i.test(adresse)) return "hls";
  if (/\.mpd(\?|#|$)/i.test(adresse)) return "dash";
  return "datei";
}

/**
 * Die Hoehe zu einer Quelle, wenn sie sich ohne Raten ergibt.
 *
 * Drei Quellen, in dieser Reihenfolge: eine mitgelieferte Zahl, eine
 * Beschriftung ("1080p") und der Dateiname (".../1080.mp4"). Ergibt keine davon
 * etwas, bleibt es bei 0 - das ist kein Mangel, sondern heisst nur, dass diese
 * Quelle bei der Wahl nicht ueber ihre Hoehe punkten kann.
 */
function hoeheBestimmen(angabe, beschriftung, adresse) {
  const zahl = Number(angabe);
  if (Number.isFinite(zahl) && zahl >= 100 && zahl <= 4320) return Math.round(zahl);
  const ausText = /(\d{3,4})\s*p/i.exec(String(beschriftung || ""));
  if (ausText) return Number(ausText[1]);
  const ausAdresse = /(?:^|[^\d])(\d{3,4})p?\.(?:mp4|mkv|webm|m3u8)/i.exec(String(adresse || ""));
  if (ausAdresse) {
    const wert = Number(ausAdresse[1]);
    if (wert >= 100 && wert <= 4320) return wert;
  }
  return 0;
}

/** Ein Fund, wie ihn alle Verfahren hier abliefern. */
function quelle(adresse, herkunft, beschriftung, hoehe) {
  if (!adresse) return null;
  return {
    adresse,
    typ: typBestimmen(adresse),
    hoehe: hoeheBestimmen(hoehe, beschriftung, adresse),
    beschriftung: String(beschriftung || "").trim().slice(0, 40),
    herkunft
  };
}

/* --------------------------------------------------------------- VOE-Block */

/**
 * Der verpackte Block von VOE, Lage fuer Lage.
 *
 * Sechs Schritte, und nach jedem wird nachgesehen, ob noch etwas Sinnvolles
 * dasteht. Kommt am Ende kein Objekt heraus, ist es keins - dann liefert die
 * Funktion `null` und der Aufrufer nimmt das naechste Verfahren.
 */
function voeEntschluesseln(roh) {
  const eingabe = String(roh || "").trim();
  if (eingabe.length < 24) return null;

  const gedreht = drehen(eingabe);
  const ohneMuell = VOE_MUELL.reduce((text, muell) => text.split(muell).join(""), gedreht);
  const ersteLage = ausBase64(ohneMuell);
  if (!ersteLage) return null;

  const zurueckgeschoben = verschieben(ersteLage, VOE_VERSATZ);
  const zweiteLage = ausBase64(umkehren(zurueckgeschoben));
  if (!zweiteLage) return null;

  try {
    const werte = JSON.parse(zweiteLage);
    return werte && typeof werte === "object" ? werte : null;
  } catch (_) {
    return null;
  }
}

/**
 * Die Felder, in denen VOE seine Adresse ablegt.
 *
 * Mehrere, weil ueber die Jahre mehrere benutzt wurden und eine Seite oft
 * gleich zwei davon traegt: die Playlist unter `source`, die Datei unter
 * `direct_access_url`. Genommen werden alle, die eine Adresse hergeben; welche
 * am Ende laeuft, entscheidet `besteQuelle`.
 */
const VOE_FELDER = ["source", "direct_access_url", "hls", "mp4", "file", "videoLink", "video_url"];

function quellenAusObjekt(werte, basis, herkunft) {
  const gefunden = [];
  if (!werte || typeof werte !== "object") return gefunden;
  const hoehe = werte.video_height || werte.height;
  for (const feld of VOE_FELDER) {
    const adresse = adresseAusWert(werte[feld], basis);
    if (adresse) gefunden.push(quelle(adresse, herkunft, feld, hoehe));
  }
  return gefunden.filter(Boolean);
}

/* ------------------------------------------------------------- Die Verfahren */

/**
 * Die Zeichen, aus denen ein verpackter Block bestehen darf.
 *
 * Base64 und die Fuellzeichen - und die stehen nicht noch einmal von Hand hier,
 * sondern kommen aus derselben Liste, nach der sie spaeter wieder entfernt
 * werden. Getrennt gepflegt waeren es zwei Listen, die auseinanderlaufen: eine
 * Fuellfolge, die dort steht und hier fehlt, macht den Block unauffindbar,
 * ohne dass an der Entschluesselung etwas falsch waere.
 */
const VOE_BLOCK_ZEICHEN = (() => {
  const zeichen = [...new Set(VOE_MUELL.join("").split(""))]
    .map((z) => z.replace(/[\^\]\\-]/, "\\$&"))
    .join("");
  return new RegExp(`"([A-Za-z0-9+/=${zeichen}]{40,})"`);
})();

/**
 * Der JSON-Block im Quelltext.
 *
 * `<script type="application/json">["..."]</script>` - ein Feld mit einer
 * einzigen langen Zeichenkette. Genommen wird der laengste Block der Seite:
 * kurze JSON-Bloecke stehen auf solchen Seiten reichlich herum
 * (Einwilligungen, Statistik), und keiner davon ist der gesuchte.
 */
function ausJsonBlock(html, basis) {
  const bloecke = String(html || "").match(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  const kandidaten = [];
  for (const block of bloecke) {
    const inhalt = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    const treffer = VOE_BLOCK_ZEICHEN.exec(inhalt);
    if (treffer) kandidaten.push(treffer[1]);
  }
  kandidaten.sort((links, rechts) => rechts.length - links.length);
  for (const kandidat of kandidaten) {
    const werte = voeEntschluesseln(kandidat);
    const gefunden = quellenAusObjekt(werte, basis, "voe-block");
    if (gefunden.length) return gefunden;
  }
  return [];
}

/**
 * Die Angaben im Klartext.
 *
 * Aeltere VOE-Seiten - und einige andere Hoster - schreiben `'hls': '...'` oder
 * `var sources = {"mp4": "..."}` einfach hin, mal als Adresse, mal als Base64.
 * Beides holt `adresseAusWert` auseinander.
 */
function ausKlartext(html, basis) {
  const text = String(html || "");
  const gefunden = [];
  const muster = /["']?\b(hls|mp4|source|direct_access_url|videoLink|file)\b["']?\s*[:=]\s*["']([^"']{8,})["']/gi;
  let treffer = muster.exec(text);
  while (treffer) {
    const adresse = adresseAusWert(treffer[2], basis);
    if (adresse) gefunden.push(quelle(adresse, "klartext", treffer[1], 0));
    treffer = muster.exec(text);
  }
  return gefunden.filter(Boolean);
}

/**
 * Die Quellenliste eines JW Players.
 *
 * `sources: [{ file: "...", label: "1080p" }, ...]` - der Fall, in dem der
 * Hoster mehrere Stufen nebeneinanderlegt. Hier steht die Beschriftung dabei,
 * also ist die Hoehe bekannt und die Wahl faellt nicht ins Blaue.
 */
function ausSpielerliste(html, basis) {
  const text = String(html || "");
  const listen = text.match(/sources\s*:\s*\[[\s\S]{0,4000}?\]/gi) || [];
  const gefunden = [];
  for (const liste of listen) {
    const eintraege = liste.match(/\{[^{}]*\}/g) || [];
    for (const eintrag of eintraege) {
      const adresseRoh = /(?:file|src)\s*:\s*["']([^"']+)["']/i.exec(eintrag);
      if (!adresseRoh) continue;
      const adresse = adresseNormalisieren(adresseRoh[1], basis);
      if (!adresse || !VIDEO_ENDUNGEN.test(adresse)) continue;
      const beschriftung = /(?:label|res|height)\s*:\s*["']?([^"',}]+)["']?/i.exec(eintrag);
      gefunden.push(quelle(adresse, "spielerliste", beschriftung ? beschriftung[1] : "", 0));
    }
  }
  return gefunden.filter(Boolean);
}

/**
 * Streamtape: die Adresse in zwei Haelften.
 *
 * Der Hoster legt die halbe Adresse in ein verstecktes Feld und setzt die
 * andere Haelfte per Skript daneben - mit einem Anfang, der weggeschnitten
 * wird. Ohne dieses Abschneiden kaeme eine Adresse heraus, die aussieht wie
 * eine und mit 403 endet.
 */
function ausStreamtape(html, basis) {
  const text = String(html || "");
  const treffer = /innerHTML\s*=\s*["']([^"']+)["']\s*\+\s*\(?\s*["']([^"']+)["']\s*\)?\s*\.substring\(\s*(\d+)\s*\)/i.exec(text);
  if (!treffer) return [];
  const zweiteHaelfte = String(treffer[2]).substring(Number(treffer[3]) || 0);
  const adresse = adresseNormalisieren(treffer[1] + zweiteHaelfte, basis);
  if (!adresse) return [];
  const fund = quelle(adresse, "streamtape", "", 0);
  return fund ? [fund] : [];
}

/**
 * Die nackte Adresse im Quelltext - der letzte Anlauf.
 *
 * Findet keines der Verfahren etwas, steht die Playlist manchmal trotzdem
 * unverpackt da. Das ist der unsicherste Fund der Reihe, deshalb steht er
 * zuletzt und traegt seine Herkunft: eine `.m3u8` in einer Werbeeinblendung
 * waere ebenfalls eine `.m3u8`.
 */
function ausRohtext(html, basis) {
  const text = String(html || "");
  const muster = /https?:\\?\/\\?\/[^\s"'<>\\]+\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi;
  const gefunden = [];
  const gesehen = new Set();
  let treffer = muster.exec(text);
  while (treffer) {
    const adresse = adresseNormalisieren(treffer[0], basis);
    if (adresse && !gesehen.has(adresse)) {
      gesehen.add(adresse);
      gefunden.push(quelle(adresse, "rohtext", "", 0));
    }
    treffer = muster.exec(text);
  }
  return gefunden.filter(Boolean);
}

/* ---------------------------------------------------------- Die Weiterleitung */

/**
 * Seiten, die nur weiterzeigen.
 *
 * VOE liefert unter seiner bekannten Adresse oft nur eine Zeile Skript, die
 * woandershin zeigt; erst dort steht der Player. Wer das nicht mitgeht, findet
 * nichts und haelt den Hoster faelschlich fuer stumm.
 *
 * Zurueckgegeben wird nur, was auch wirklich woanders hinfuehrt: dieselbe
 * Adresse noch einmal waere eine Schleife.
 */
function weiterleitung(html, basis) {
  const text = String(html || "");
  const muster = [
    /window\.location\.href\s*=\s*["']([^"']+)["']/i,
    /window\.location\.replace\(\s*["']([^"']+)["']\s*\)/i,
    /location\.href\s*=\s*["']([^"']+)["']/i,
    /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"';]+)["']/i
  ];
  for (const regel of muster) {
    const treffer = regel.exec(text);
    if (!treffer) continue;
    const ziel = adresseNormalisieren(treffer[1], basis);
    if (ziel && ziel !== adresseNormalisieren(basis, basis)) return ziel;
  }
  return "";
}

/* ------------------------------------------------------------------ Die Wahl */

/**
 * Welche der gefundenen Quellen gespielt wird.
 *
 * HLS zuerst, und das aus einem Grund, der nichts mit Qualitaet zu tun hat: die
 * Playlist traegt alle Stufen in sich, der Spieler waehlt spaeter selbst und
 * kann waehrend des Films wechseln. Eine feste Datei kann das nicht.
 *
 * Danach die Hoehe, danach die Reihenfolge des Fundes - und die ist die
 * Reihenfolge der Verfahren, also von "sicher erkannt" nach "notfalls".
 */
function besteQuelle(quellen) {
  const liste = Array.isArray(quellen) ? quellen.filter(Boolean) : [];
  if (!liste.length) return null;
  const rang = (eintrag) => (eintrag.typ === "hls" ? 2 : eintrag.typ === "dash" ? 1 : 0);
  let beste = liste[0];
  for (const eintrag of liste.slice(1)) {
    if (rang(eintrag) > rang(beste)) beste = eintrag;
    else if (rang(eintrag) === rang(beste) && eintrag.hoehe > beste.hoehe) beste = eintrag;
  }
  return beste;
}

/**
 * Alles zusammen: aus einer geladenen Hosterseite wird eine Auskunft.
 *
 * Drei moegliche Antworten, und der Aufrufer muss alle drei kennen:
 *
 *   - `weiter`  : diese Seite zeigt nur woandershin. Nochmal holen, dann
 *                 nochmal hierher.
 *   - `quelle`  : gefunden. `quellen` traegt alles, was sonst noch dastand.
 *   - keins von beidem: nichts gefunden, `grund` sagt warum. Dann bleibt es
 *                 beim Rahmen des Hosters.
 *
 * Die Verfahren laufen in fester Reihenfolge, und das erste, das etwas
 * hergibt, gewinnt. Am Hostnamen wird dabei nichts festgemacht: VOE wechselt
 * seine Adressen staendig (siehe voe-qualitaet.js), und ein Verfahren, das nur
 * bei bekanntem Namen greift, waere am Tag darauf blind.
 */
function aufloesen(html, adresse) {
  const text = String(html || "");
  const basis = String(adresse || "");
  if (!text.trim()) return { quelle: null, quellen: [], weiter: "", grund: "leere Seite" };

  const ziel = weiterleitung(text, basis);
  if (ziel) return { quelle: null, quellen: [], weiter: ziel, grund: "" };

  const verfahren = [ausJsonBlock, ausSpielerliste, ausStreamtape, ausKlartext, ausRohtext];
  for (const versuch of verfahren) {
    let gefunden = [];
    try {
      gefunden = versuch(text, basis) || [];
    } catch (_) {
      gefunden = [];
    }
    if (gefunden.length) {
      return { quelle: besteQuelle(gefunden), quellen: gefunden, weiter: "", grund: "" };
    }
  }
  return { quelle: null, quellen: [], weiter: "", grund: "keine Quelle im Quelltext" };
}

module.exports = {
  aufloesen,
  besteQuelle,
  weiterleitung,
  voeEntschluesseln,
  adresseAusWert,
  adresseNormalisieren,
  typBestimmen,
  hoeheBestimmen,
  VOE_MUELL,
  VOE_VERSATZ
};
