"use strict";

/*
 * Der Pruefstand fuer die Direktaufloesung.
 *
 * Er baut nichts um. Er beantwortet eine Frage, und zwar an echten Folgen:
 * <b>Kommt ELFIX zuverlaessig an eine Adresse, die sich wirklich abspielen
 * laesst?</b>
 *
 * <h2>Warum unter Electron und nicht unter Node</h2>
 *
 * Weil sonst etwas anderes gemessen wuerde. Die Anbieter kennen die Sitzung der
 * App: ihre Kekse, ihre Kennung, ihren Netzweg. Ein nackter Node-Abruf laeuft
 * bei Cloudflare in eine Abfrage, die mit der Aufloesung nichts zu tun hat -
 * und der Bericht saehe aus wie ein Fehlschlag des Verfahrens. Deshalb laeuft
 * der Pruefstand in derselben Sitzung wie die App:
 *
 *     npx electron scripts/direktprobe.js https://anbieter.example/…/episode-3
 *     npx electron scripts/direktprobe.js --aus-mediathek 5
 *     npx electron scripts/direktprobe.js --selbsttest
 *
 * <h2>Was er nicht ausgibt</h2>
 *
 * Keine Schluessel, keine Kekse, keine eigene IP. Signierte Adressen tragen
 * genau das mit; ein Bericht, den man nicht herumzeigen kann, ist nutzlos.
 * Gekuerzt wird in streamspur.js, und diese Kuerzung ist selbst geprueft
 * (tests/streamspurtest.js).
 *
 * <h2>Der Ablauf je Folge</h2>
 *
 * <ol>
 *   <li>Folgenseite in einer unsichtbaren Ansicht laden.
 *   <li>Hosterkacheln lesen und ordnen (direktlinks.js).
 *   <li>Je Hoster: Stufe 1 aufloesen (direktlauf.js -> direktquelle.js).
 *   <li><b>Abnahme.</b> Das ist der Punkt, an dem sich ein Fund als brauchbar
 *       erweist oder nicht: Manifest holen, am Inhalt einordnen (manifest.js),
 *       Laufzeit lesen, bei einer Datei einen Bereichsabruf. Erst danach steht
 *       "abspielbar: ja" im Bericht.
 *   <li>Zusaetzlich wird gemessen, was die Quelle wirklich verlangt: ohne
 *       Referer, ohne Kekse, mit fremder Kennung - je ein Abruf.
 * </ol>
 */

// Electron wird bewusst erst dort geladen, wo es gebraucht wird: der
// Selbsttest unten laeuft ohne Browser und ohne Netz, und damit laeuft er auch
// in der Pruefsuite (tests/direktprobetest.js). Ein Pruefstand, dessen eigene
// Verdrahtung ungeprueft ist, taugt nichts - ein leerer Bericht waere dann
// nicht von einem kaputten Pruefstand zu unterscheiden.
const fs = require("fs");
const path = require("path");

const direktlinks = require("../src/direktlinks");
const direktlauf = require("../src/direktlauf");
const manifest = require("../src/manifest");
const spur = require("../src/streamspur");

/** Dieselbe Sitzung wie die App - sonst fehlen die Kekse der Anbieter. */
const PARTITION = "persist:streaming-browser";
/** Eine zweite, absichtlich leere: an ihr wird gemessen, ob Kekse noetig sind. */
const PARTITION_NACKT = "elfix-probe-nackt";
/** So viele Hoster je Folge werden durchprobiert. */
const HOSTER_JE_FOLGE = 3;
/** So lange wird beim Beobachten zugesehen. */
const BEOBACHTUNG_MS = 20000;

const argumente = process.argv.slice(2).filter((wert) => !wert.startsWith("--inspect"));
const schalter = new Set(argumente.filter((wert) => wert.startsWith("--")));
const adressen = argumente.filter((wert) => /^https?:\/\//i.test(wert));
const zahlNach = (name, vorgabe) => {
  const stelle = argumente.indexOf(name);
  const wert = stelle >= 0 ? Number(argumente[stelle + 1]) : NaN;
  return Number.isFinite(wert) && wert > 0 ? wert : vorgabe;
};

/* --------------------------------------------------------------- Ausgabe */

const zeile = (name, wert) => console.log(`${(name + ":").padEnd(24)}${wert}`);
const zeit = (sekunden) => {
  const ganz = Math.round(Number(sekunden) || 0);
  if (!ganz) return "–";
  const m = Math.floor(ganz / 60);
  const s = String(ganz % 60).padStart(2, "0");
  return `${m}:${s}`;
};

/* --------------------------------------------------------------- Die Abnahme */

/**
 * Holt sich die Quelle wirklich abspielen?
 *
 * Das ist der Unterschied zwischen "eine Adresse gefunden" und "es laeuft".
 * Gemessen wird an dem, was zurueckkommt - nicht an der Endung.
 */
async function abnehmen(holen, quelle, kopfzeilen) {
  const kopf = {
    referer: kopfzeilen?.referer || "",
    origin: kopfzeilen?.origin || "",
    "user-agent": kopfzeilen?.["user-agent"] || ""
  };

  if (quelle.typ === "hls" || quelle.typ === "dash") {
    const erste = await holen(quelle.adresse, { headers: kopf });
    if (!erste.ok) return { ok: false, grund: `Manifest: HTTP ${erste.status}` };
    const text = await erste.text();
    const gelesen = manifest.lesen(text, erste.url || quelle.adresse);
    if (gelesen.art === "unbekannt") {
      return { ok: false, grund: "die Antwort ist kein Manifest", inhalt: text.slice(0, 60) };
    }
    if (gelesen.art !== "master") {
      return { ok: true, manifest: gelesen, stufen: [], laufzeit: gelesen.laufzeit, live: gelesen.live };
    }
    // Beim Master steht die Laufzeit erst eine Ebene tiefer.
    const beste = manifest.besteStufe(gelesen.stufen);
    let laufzeit = 0;
    let live = false;
    if (beste) {
      const zweite = await holen(beste.adresse, { headers: kopf }).catch(() => null);
      if (zweite && zweite.ok) {
        const tiefer = manifest.lesen(await zweite.text(), beste.adresse);
        laufzeit = tiefer.laufzeit;
        live = tiefer.live;
      }
    }
    return { ok: true, manifest: gelesen, stufen: gelesen.stufen, laufzeit, live };
  }

  // Eine Datei: ein Bereichsabruf ueber die ersten Kilobyte beweist mehr als
  // ein HEAD - manche Auslieferungen beantworten HEAD gar nicht.
  const antwort = await holen(quelle.adresse, { headers: { ...kopf, range: "bytes=0-65535" } });
  if (!antwort.ok && antwort.status !== 206) return { ok: false, grund: `HTTP ${antwort.status}` };
  const typ = antwort.headers.get("content-type") || "";
  if (/text\/html/i.test(typ)) return { ok: false, grund: "es kommt HTML zurück, kein Video" };
  return { ok: true, manifest: null, stufen: [], laufzeit: 0, live: false, inhaltstyp: typ };
}

/**
 * Was die Quelle wirklich verlangt.
 *
 * Drei Abrufe, jeder laesst genau eine Sache weg. Das ist die Auskunft, die der
 * Player spaeter braucht - und die man nicht raten sollte: ein Referer, den
 * niemand prueft, kostet nichts, aber ein fehlender kostet die Wiedergabe.
 */
async function bedingungenMessen(holen, holenNackt, quelle, kopfzeilen) {
  const grund = { referer: "unklar", kekse: "unklar", kennung: "unklar" };
  const teil = quelle.typ === "datei" ? { range: "bytes=0-1024" } : {};

  const ohneReferer = await holen(quelle.adresse, {
    headers: { "user-agent": kopfzeilen?.["user-agent"] || "", ...teil }
  }).catch(() => null);
  grund.referer = ohneReferer && (ohneReferer.ok || ohneReferer.status === 206) ? "nein" : "ja";

  const ohneKekse = await holenNackt(quelle.adresse, {
    headers: {
      referer: kopfzeilen?.referer || "",
      "user-agent": kopfzeilen?.["user-agent"] || "",
      ...teil
    }
  }).catch(() => null);
  grund.kekse = ohneKekse && (ohneKekse.ok || ohneKekse.status === 206) ? "nein" : "ja";

  const fremdeKennung = await holen(quelle.adresse, {
    headers: { referer: kopfzeilen?.referer || "", "user-agent": "curl/8.0", ...teil }
  }).catch(() => null);
  grund.kennung = fremdeKennung && (fremdeKennung.ok || fremdeKennung.status === 206)
    ? "nein" : "ja";

  return grund;
}

/* ----------------------------------------------------------- Der Bericht */

function berichten(lage) {
  console.log("");
  console.log("─".repeat(72));
  zeile("Anbieter", lage.anbieter);
  zeile("Episode", lage.episode);
  zeile("Hoster", lage.hoster || "?");
  zeile("Hoster-URL", spur.adresseKuerzen(lage.hosterUrl));
  zeile("Erkannter Typ", lage.stufe === 2 ? "beobachtet (Stufe 2)" : "aus dem Quelltext (Stufe 1)");

  if (!lage.quelle) {
    zeile("Direkte Stream-URL", "–");
    zeile("Fehler", lage.fehler || "keine Quelle gefunden");
    return;
  }

  zeile("Direkte Stream-URL", spur.adresseKuerzen(lage.quelle.adresse));
  const art = lage.abnahme?.manifest?.art;
  zeile("Manifest-Typ", art
    ? `${art}${lage.abnahme.stufen.length ? ` · ${lage.abnahme.stufen.length} Stufen (${lage.abnahme.stufen.map((s) => s.hoehe || "?").join("/")})` : ""}`
    : (lage.quelle.typ === "datei" ? `Datei · ${lage.abnahme?.inhaltstyp || "?"}` : "–"));
  zeile("Laufzeit lt. Manifest", lage.abnahme?.live ? "live" : zeit(lage.abnahme?.laufzeit));
  zeile("Referer nötig", lage.bedingungen?.referer || "nicht gemessen");
  zeile("Cookies nötig", lage.bedingungen?.kekse || "nicht gemessen");
  zeile("Weitere Header", lage.bedingungen?.kennung === "ja"
    ? "User-Agent (ohne Browser-Kennung abgewiesen)" : "keine");
  const untertitel = lage.abnahme?.manifest?.untertitel || [];
  zeile("Untertitel", untertitel.length ? untertitel.map((u) => u.sprache || u.name).join(", ") : "keine");
  zeile("Im separaten Player", lage.abnahme?.ok ? `ja  (${lage.dauerMs} ms bis zur Abnahme)` : "nein");
  zeile("Fehler", lage.abnahme?.ok ? "–" : (lage.abnahme?.grund || lage.fehler || "–"));
}

/* ------------------------------------------------------------- Der Lauf */

async function folgePruefen(umgebung, adresse) {
  const { laden, lesen, holen, holenNackt, beobachten } = umgebung;
  const anbieter = (() => {
    try {
      return new URL(adresse).hostname;
    } catch (_) {
      return "?";
    }
  })();
  const kurzeEpisode = (() => {
    try {
      return new URL(adresse).pathname;
    } catch (_) {
      return adresse;
    }
  })();

  const geladen = await laden(adresse);
  if (!geladen) {
    berichten({ anbieter, episode: kurzeEpisode, hosterUrl: adresse, fehler: "Folgenseite lädt nicht" });
    return [{ ok: false }];
  }

  const roh = await lesen(direktlinks.hosterlinkScript());
  let liste = [];
  try {
    liste = JSON.parse(String(roh || "[]"));
  } catch (_) {
    liste = [];
  }
  const links = direktlinks.linksOrdnen(liste).slice(0, zahlNach("--hoster", HOSTER_JE_FOLGE));
  if (!links.length) {
    berichten({ anbieter, episode: kurzeEpisode, hosterUrl: adresse, fehler: "kein Hoster auf der Seite" });
    return [{ ok: false }];
  }

  const aufloeser = direktlauf.erstellen({ holen, kennung: umgebung.kennung });
  const ergebnisse = [];

  for (const eintrag of links) {
    const begonnen = Date.now();
    const lage = {
      anbieter,
      episode: kurzeEpisode,
      hoster: eintrag.hoster,
      hosterUrl: eintrag.adresse,
      stufe: 1
    };

    const gefunden = await aufloeser.aufloesen(eintrag.adresse, adresse);
    if (gefunden.ok) {
      lage.quelle = gefunden.quelle;
      lage.abnahme = await abnehmen(holen, gefunden.quelle, gefunden.kopfzeilen).catch((f) => ({
        ok: false, grund: String(f?.message || f)
      }));
      if (lage.abnahme.ok) {
        lage.bedingungen = await bedingungenMessen(holen, holenNackt, gefunden.quelle, gefunden.kopfzeilen)
          .catch(() => null);
      }
    } else {
      lage.fehler = gefunden.grund;
    }

    // Stufe 2: nur wenn Stufe 1 nichts hergibt - oder auf Verlangen.
    if ((!lage.abnahme || !lage.abnahme.ok) && beobachten && !schalter.has("--nur-stufe1")) {
      const gesehen = await beobachten(eintrag.adresse).catch(() => null);
      if (gesehen) {
        const gewaehlt = spur.waehlen(gesehen.beobachtungen, {
          currentSrc: gesehen.currentSrc,
          rahmen: gesehen.rahmen
        });
        if (gewaehlt.quelle) {
          lage.stufe = 2;
          lage.quelle = {
            adresse: gewaehlt.quelle,
            typ: gewaehlt.art === "playlist" ? "hls" : "datei",
            hoehe: 0
          };
          lage.kopfzeilen = gesehen.kopfzeilen;
          lage.abnahme = await abnehmen(holen, lage.quelle, gesehen.kopfzeilen).catch((f) => ({
            ok: false, grund: String(f?.message || f)
          }));
          if (lage.abnahme.ok) {
            lage.bedingungen = await bedingungenMessen(holen, holenNackt, lage.quelle, gesehen.kopfzeilen)
              .catch(() => null);
          }
          lage.beobachtung = { ...gesehen, gewaehlt };
        } else {
          lage.fehler = `${lage.fehler || ""} · beobachtet: ${gewaehlt.grund}`.trim();
        }
      }
    }

    lage.dauerMs = Date.now() - begonnen;
    berichten(lage);
    if (lage.beobachtung && schalter.has("--proben-schreiben")) probeSchreiben(lage);
    ergebnisse.push({ ok: Boolean(lage.abnahme?.ok), hoster: eintrag.hoster });
    if (lage.abnahme?.ok) break;
  }
  return ergebnisse;
}

/**
 * Was beobachtet wurde, als Probe fuer spaeter.
 *
 * Gereinigt, versteht sich: die Datei landet im Repository und damit in der
 * Oeffentlichkeit. Sie ist die Grundlage fuer die Auswahlregeln in
 * streamspur.js - erfundene Proben belegen nichts.
 */
function probeSchreiben(lage) {
  const ordner = path.join(__dirname, "..", "tests", "proben");
  fs.mkdirSync(ordner, { recursive: true });
  const name = `beobachtung-${(lage.hoster || "hoster").toLowerCase().replace(/[^a-z0-9]+/g, "")}-${Date.now()}.json`;
  const inhalt = {
    hoster: lage.hoster,
    rahmen: spur.adresseKuerzen(lage.beobachtung.rahmen || ""),
    currentSrc: /^blob:/i.test(lage.beobachtung.currentSrc || "")
      ? "blob:<eigen>"
      : spur.adresseKuerzen(lage.beobachtung.currentSrc || ""),
    beobachtungen: lage.beobachtung.beobachtungen.map((eintrag) => ({
      adresse: spur.adresseKuerzen(eintrag.adresse),
      art: eintrag.art,
      treffer: eintrag.treffer
    })),
    gewaehlt: spur.adresseKuerzen(lage.beobachtung.gewaehlt.quelle),
    grund: lage.beobachtung.gewaehlt.grund
  };
  fs.writeFileSync(path.join(ordner, name), JSON.stringify(inhalt, null, 2));
  console.log(`   → Probe geschrieben: tests/proben/${name}`);
}

/* ------------------------------------------------------ Die echte Umgebung */

function echteUmgebung() {
  const { BrowserWindow, session } = require("electron");
  const sitzung = session.fromPartition(PARTITION, { cache: true });
  const nackt = session.fromPartition(PARTITION_NACKT, { cache: false });
  const fenster = new BrowserWindow({
    show: schalter.has("--sichtbar"),
    width: 1280,
    height: 800,
    webPreferences: { session: sitzung, contextIsolation: true, sandbox: true }
  });

  const warten = (frist = 25000) => new Promise((fertig) => {
    let erledigt = false;
    const schluss = (ok) => {
      if (erledigt) return;
      erledigt = true;
      clearTimeout(uhr);
      fenster.webContents.off("dom-ready", auf);
      fertig(ok);
    };
    const auf = () => schluss(true);
    const uhr = setTimeout(() => schluss(false), frist);
    fenster.webContents.on("dom-ready", auf);
  });

  return {
    kennung: sitzung.getUserAgent(),
    holen: (url, aufbau) => sitzung.fetch(url, { redirect: "follow", ...aufbau }),
    holenNackt: (url, aufbau) => nackt.fetch(url, { redirect: "follow", ...aufbau }),
    laden: async (url) => {
      const versprechen = warten();
      fenster.webContents.loadURL(url).catch(() => {});
      return versprechen;
    },
    lesen: (skript) => fenster.webContents.executeJavaScript(skript, true).catch(() => ""),
    /**
     * Zusehen, was der Hoster holt.
     *
     * Der Mitschreiber haengt an der Sitzung und nicht an der Ansicht: die
     * Anfragen kommen aus Rahmen, die es beim Einhaengen noch gar nicht gab.
     */
    beobachten: async (hosterUrl) => {
      let beobachtungen = [];
      const werbung = /(doubleclick|googlesyndication|adservice|popads|propeller|adsco|exoclick|juicyads)/i;
      sitzung.webRequest.onCompleted({ urls: ["http://*/*", "https://*/*"] }, (details) => {
        beobachtungen = spur.aufnehmen(beobachtungen, {
          adresse: details.url,
          vonWerbung: werbung.test(details.url),
          groesse: 0
        });
      });
      const versprechen = warten();
      fenster.webContents.loadURL(hosterUrl).catch(() => {});
      await versprechen;
      await new Promise((fertig) => setTimeout(fertig, BEOBACHTUNG_MS));
      const currentSrc = await fenster.webContents.executeJavaScript(`(() => {
        const alle = Array.from(document.querySelectorAll("video,audio"));
        const beste = alle.sort((a, b) => (Number(b.duration) || 0) - (Number(a.duration) || 0))[0];
        return beste ? (beste.currentSrc || beste.src || "") : "";
      })()`, true).catch(() => "");
      sitzung.webRequest.onCompleted(null);
      return {
        beobachtungen,
        currentSrc,
        rahmen: hosterUrl,
        kopfzeilen: direktlauf.kopfzeilenFuer(hosterUrl, sitzung.getUserAgent())
      };
    },
    schliessen: () => fenster.destroy()
  };
}

/* -------------------------------------------------------- Der Selbsttest */

/**
 * Derselbe Lauf, ohne Netz.
 *
 * Er beweist nicht, dass ein Hoster sich aufloesen laesst - das kann nur das
 * Netz. Er beweist, dass der Pruefstand selbst funktioniert: dass er liest,
 * abnimmt, kuerzt und berichtet. Ohne diesen Lauf waere ein leerer Bericht
 * nicht von einem kaputten Pruefstand zu unterscheiden.
 */
function selbsttestUmgebung() {
  const SEITE = `<html><body><ul class="hosterSiteVideo">
    <li data-lang-key="1" data-link-target="/redirect/1"><h4>VOE</h4></li>
  </ul></body></html>`;
  const MASTER = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=4200000,RESOLUTION=1920x1080\n1080/index.m3u8\n";
  // Zwanzig Stuecke zu 70 Sekunden: eine Folgenlaenge, keine Werbung. So faehrt
  // der Selbsttest auch die Laufzeitpruefung und nicht nur das Lesen.
  const MEDIA = "#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n"
    + "#EXTINF:70.0,\ns1.ts\n".repeat(20) + "#EXT-X-ENDLIST\n";
  const antwort = (text, status = 200, url = "") => ({
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (name) => (String(name).toLowerCase() === "content-type" ? "application/x-mpegurl" : null) },
    text: async () => text
  });

  return {
    kennung: "Selbsttest/1",
    holen: async (url) => {
      if (/redirect\/1$/.test(url)) {
        // Mit Schluessel in der Adresse - genau so kommen sie von den Hostern,
        // und genau der darf im Bericht nicht auftauchen.
        return antwort(`<script>jwplayer("p").setup({ sources: [
          { file: "https://cdn.example/v/abc/master.m3u8?token=GEHEIMESZEICHENFOLGE1234567",
            label: "1080p" } ]});</script>`, 200, url);
      }
      if (/master\.m3u8/.test(url)) return antwort(MASTER, 200, url);
      if (/1080\/index\.m3u8$/.test(url)) return antwort(MEDIA, 200, url);
      return antwort("", 404, url);
    },
    holenNackt: async () => antwort("", 403),
    laden: async () => true,
    lesen: async () => JSON.stringify([{
      adresse: "https://anbieter.example/redirect/1",
      hoster: "VOE",
      sprache: "1",
      sichtbar: true
    }]),
    beobachten: null,
    schliessen: () => {},
    seite: SEITE
  };
}

/* --------------------------------------------------------------- Der Start */

async function lauf() {
  const selbsttest = schalter.has("--selbsttest");
  const umgebung = selbsttest ? selbsttestUmgebung() : echteUmgebung();

  let ziele = adressen;
  if (!selbsttest && schalter.has("--aus-mediathek")) {
    ziele = ziele.concat(ausMediathek(zahlNach("--aus-mediathek", 3)));
  }
  if (selbsttest) ziele = ["https://anbieter.example/anime/stream/serie/staffel-1/episode-3"];

  if (!ziele.length) {
    console.log("Aufruf: npx electron scripts/direktprobe.js <folgen-adresse> …");
    console.log("        npx electron scripts/direktprobe.js --aus-mediathek 5");
    console.log("        npx electron scripts/direktprobe.js --selbsttest");
    console.log("");
    console.log("Weitere Schalter: --hoster N, --nur-stufe1, --sichtbar, --proben-schreiben");
    return 2;
  }

  console.log(`Prüfstand Direktauflösung · ${ziele.length} Folge(n)`
    + `${selbsttest ? " · Selbsttest ohne Netz" : ""}`);

  const alle = [];
  for (const adresse of ziele) {
    const ergebnisse = await folgePruefen(umgebung, adresse).catch((fehler) => {
      console.log(`FEHLER bei ${adresse}: ${fehler?.message || fehler}`);
      return [{ ok: false }];
    });
    alle.push({ adresse, ergebnisse });
  }

  console.log("");
  console.log("═".repeat(72));
  const gelungen = alle.filter((eintrag) => eintrag.ergebnisse.some((wert) => wert.ok));
  const hoster = [...new Set(alle.flatMap((eintrag) => eintrag.ergebnisse
    .filter((wert) => wert.ok).map((wert) => wert.hoster)))];
  console.log(`${gelungen.length}/${alle.length} Folgen mit abgenommener Quelle`);
  console.log(`Hoster, die getragen haben: ${hoster.length ? hoster.join(", ") : "keiner"}`);
  umgebung.schliessen();
  return gelungen.length === alle.length ? 0 : 1;
}

/** Ein paar Folgen aus der eigenen Ablage - schneller als Adressen abzutippen. */
function ausMediathek(anzahl) {
  try {
    const { app } = require("electron");
    const datei = path.join(app.getPath("appData"), "ELFIX", "favorites.json");
    const eintraege = JSON.parse(fs.readFileSync(datei, "utf8"));
    return (Array.isArray(eintraege) ? eintraege : [])
      .map((eintrag) => String(eintrag?.url || ""))
      .filter((url) => /^https?:/i.test(url))
      .slice(0, anzahl);
  } catch (fehler) {
    console.log(`Mediathek nicht lesbar: ${fehler?.message || fehler}`);
    return [];
  }
}

if (schalter.has("--selbsttest")) {
  // Ohne Electron, ohne Fenster, ohne Netz - damit die Pruefsuite ihn fahren kann.
  lauf().then((code) => process.exit(code)).catch((fehler) => {
    console.error(fehler);
    process.exit(1);
  });
} else {
  const { app } = require("electron");
  app.whenReady().then(() => lauf()
    .then((code) => app.exit(code))
    .catch((fehler) => {
      console.error(fehler);
      app.exit(1);
    }));
}
