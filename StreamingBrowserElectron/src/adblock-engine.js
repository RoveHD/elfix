"use strict";

// Der Adblock-Kern von ELFIX: @adguard/tsurlfilter.
//
// Vorher stand hier ein selbst geschriebener Teilparser fuer AdGuard-Listen.
// Er zog aus jeder Liste im Wesentlichen Domainnamen heraus und warf alles
// andere weg - Optionen ($script, $third-party, $domain=), Ausnahmen (@@) und
// vor allem jede kosmetische Regel ("##.werbe-overlay"). Genau die fehlten
// aber: die Fake-Gewinnspiele auf den Streaming-Seiten sind meist kein zweites
// Fenster und oft nicht einmal eine eigene Anfrage, sondern ein paar DIVs, die
// ein laengst geladenes Skript in die Seite haengt. Gegen so etwas hilft kein
// Domainfilter.
//
// tsurlfilter ist die Engine, die AdGuard selbst in seiner Browsererweiterung
// benutzt. Sie liest dieselben Listen, die ELFIX ohnehin schon herunterlaedt,
// und versteht sie vollstaendig. Nachgemessen an den vier Listen (Base,
// Tracking, Annoyances, German - rund 23 MB, 531.000 Regeln):
//
//   Engine bauen     ~3,8 s   (deshalb asynchron, siehe unten)
//   Speicher         ~480 MB RSS im Hauptprozess, dauerhaft
//   Pruefen          ~2,4 us je Anfrage bei wiederkehrenden Adressen
//                    (~155 us beim allerersten Treffer einer neuen Domain)
//   Kosmetik je Seite ~4,5 ms
//
// Der Speicherbedarf ist der Preis dieser Engine und laesst sich nicht
// wegkonfigurieren; "ignoreCosmetic" auf der Tracking-Liste bringt gemessene
// 3 MB und kostet sieben Scriptlets auf voe.sx - deshalb bleibt es aus.
//
// Zwei Dinge folgen daraus fuer die Einbindung:
//
// 1. Gebaut wird asynchron, nachdem das Fenster steht. Bis die Engine bereit
//    ist, filtert die eingebaute Notfallliste weiter - ELFIX startet also nie
//    ungeschuetzt und wartet nie auf den Adblocker.
// 2. Die Rohtexte der Listen liegen auf der Platte. Beim Start wird nichts
//    heruntergeladen, solange der Zwischenspeicher jung genug ist; ohne Netz
//    laeuft ELFIX mit dem letzten gueltigen Stand.
//
// tsurlfilter v6 wird nur noch als ES-Modul ausgeliefert (die im
// package.json angekuendigte UMD-Datei fehlt im Paket). ELFIX ist CommonJS,
// deshalb der dynamische import() - der laeuft in Electrons Hauptprozess und
// passt ohnehin zum asynchronen Aufbau.
//
// Auf dem Telefon gibt es weder npm noch import(): dort liegt das Paket als
// gebuendelte Datei neben dem Kern (siehe scripts/kern-tsurlfilter.js), haengt
// am globalen Namen und ist schon da, bevor dieses Modul geladen wird. Deshalb
// wird zuerst dort nachgesehen - und deshalb ist diese Datei die einzige
// Stelle, an der die Herkunft der Engine ueberhaupt vorkommt. Alles darunter
// ist auf beiden Geraeten dasselbe.

let modulVersprechen = null;

function ladeModul() {
  if (!modulVersprechen) {
    const gebuendelt = typeof globalThis !== "undefined" && globalThis.ELFIX_TSURLFILTER;
    modulVersprechen = gebuendelt
      ? Promise.resolve(gebuendelt)
      : import("@adguard/tsurlfilter").catch(() => null);
  }
  return modulVersprechen;
}

// Diese Liste gilt immer: bevor die Engine steht, wenn keine Liste erreichbar
// war und wenn tsurlfilter gar nicht geladen werden konnte. Sie deckt die
// Netze ab, die auf Streaming-Seiten die Popups und Popunder ausliefern -
// ohne sie haengt der Schutz an einem Download.
function defaultAdDomains() {
  return [
    // Anzeigen-Vermarkter
    "doubleclick.net",
    "googlesyndication.com",
    "googleadservices.com",
    "adservice.google.com",
    "adsystem.com",
    "amazon-adsystem.com",
    "taboola.com",
    "outbrain.com",
    "scorecardresearch.com",
    "adnxs.com",
    "pubmatic.com",
    "rubiconproject.com",
    "criteo.com",
    "zedo.com",
    "smartadserver.com",
    "adform.net",
    "openx.net",
    "casalemedia.com",
    "moatads.com",
    "media.net",
    "mgid.com",
    "adskeeper.com",
    "revcontent.com",
    // Popup- und Popunder-Netze
    "popads.net",
    "popcash.net",
    "popunder.net",
    "popmyads.com",
    "poptm.com",
    "onclickads.net",
    "onclickalgo.com",
    "clickadu.com",
    "adcash.com",
    "propellerads.com",
    "propeller-tracking.com",
    "propu.sh",
    "adsterra.com",
    "adsterra.net",
    "highperformanceformat.com",
    "profitableratecpm.com",
    "effectiveratecpm.com",
    "displaycontentnetwork.com",
    "exoclick.com",
    "exosrv.com",
    "exdynsrv.com",
    "realsrv.com",
    "magsrv.com",
    "pemsrv.com",
    "trafficjunky.net",
    "trafficstars.com",
    "tsyndicate.com",
    "juicyads.com",
    "hilltopads.net",
    "hilltopads.com",
    "adspyglass.com",
    "bidgear.com",
    "adnium.com",
    "adsupply.com"
  ];
}

function defaultTrackerDomains() {
  return [
    "google-analytics.com",
    "googletagmanager.com",
    "facebook.net",
    "hotjar.com",
    "mixpanel.com",
    "segment.io",
    "clarity.ms",
    "amplitude.com"
  ];
}

// Electron und tsurlfilter benennen Ressourcentypen unterschiedlich. Ohne
// diese Uebersetzung landet alles bei "Other" - und damit greift keine Regel
// mit $script, $image, $subdocument oder $xmlhttprequest mehr.
const ELECTRON_TYPEN = {
  mainFrame: "Document",
  subFrame: "SubDocument",
  stylesheet: "Stylesheet",
  script: "Script",
  image: "Image",
  font: "Font",
  object: "Object",
  xhr: "XmlHttpRequest",
  ping: "Ping",
  cspReport: "CspReport",
  media: "Media",
  webSocket: "WebSocket",
  other: "Other"
};

class AdblockEngine {
  constructor() {
    this.modul = null;
    this.engine = null;
    this.regelzahl = 0;
    this.notfallDomains = new Set(defaultAdDomains());
    this.notfallTracker = new Set(defaultTrackerDomains());
    this.bauLaeuft = null;
  }

  // Ist tsurlfilter ueberhaupt da? Wenn nicht, laeuft alles ueber die
  // Notfallliste, und der Bericht in den Einstellungen soll das sagen duerfen.
  istVerfuegbar() {
    return Boolean(this.modul);
  }

  // Steht eine gebaute Engine? Die Regelzahl taugt dafuer nicht - die
  // Notfalldomains sind immer dabei, sie ist also nie null.
  istBereit() {
    return Boolean(this.engine);
  }

  hatGeladeneListen() {
    return Boolean(this.engine);
  }

  ruleCount() {
    return this.regelzahl || (this.notfallDomains.size + this.notfallTracker.size);
  }

  // Baut die Engine aus den Rohtexten der Listen.
  //
  // "listen" ist [{ id, text }]. Die ID ist die AdGuard-Listennummer; sie
  // steckt spaeter in jedem Treffer und macht im Protokoll nachvollziehbar,
  // aus welcher Liste eine Regel kam.
  //
  // Laeuft schon ein Aufbau, wird auf ihn gewartet, statt einen zweiten zu
  // starten - zwei gleichzeitige Aufbauten waeren knapp eine Sekunde
  // Rechenzeit und rund ein Gigabyte Speicher fuer nichts.
  async bauen(listen) {
    if (this.bauLaeuft) await this.bauLaeuft.catch(() => {});
    this.bauLaeuft = this.bauenIntern(listen);
    try {
      return await this.bauLaeuft;
    } finally {
      this.bauLaeuft = null;
    }
  }

  async bauenIntern(listen) {
    const modul = await ladeModul();
    if (!modul) return false;
    this.modul = modul;

    // Ohne diese Angabe haelt sich tsurlfilter fuer eine CoreLibs-Umgebung und
    // verwirft Regeln, die nur die Browsererweiterung kennt.
    try {
      modul.setConfiguration({
        engine: "extension",
        version: "1.0.0",
        verbose: false,
        compatibility: modul.CompatibilityTypes.Extension
      });
    } catch {
      // Aeltere Fassungen kennen setConfiguration nicht - dann gelten die
      // Voreinstellungen, und das ist kein Grund, ohne Engine dazustehen.
    }

    const filters = (listen || [])
      .filter((liste) => liste && String(liste.text || "").trim())
      .map((liste) => ({ id: Number(liste.id) || 0, content: String(liste.text) }));
    if (!filters.length) return false;

    // createAsync gibt zwischendurch den Ereignis-Takt frei. Der Aufbau dauert
    // gut drei Sekunden; synchron waere das ein eingefrorenes Fenster.
    this.engine = await modul.Engine.createAsync({ filters });
    this.regelzahl = this.engine.getRulesCount();
    return true;
  }

  // Das Urteil ueber eine einzelne Anfrage.
  //
  // "allowlist" heisst: eine @@-Regel hat ausdruecklich erlaubt. Das ist kein
  // stilles Durchwinken, sondern eine Entscheidung der Liste - Cloudflare
  // Turnstile, hCaptcha und reCAPTCHA kommen genau darueber durch, ohne dass
  // ELFIX sie kennen muss.
  matchRequest({ url, resourceType, sourceUrl }) {
    if (!this.engine) return this.notfallUrteil(url, resourceType);

    const { Request, RequestType } = this.modul;
    let ergebnis;
    try {
      const typ = RequestType[ELECTRON_TYPEN[String(resourceType || "other")] || "Other"];
      const anfrage = new Request(String(url || ""), sourceUrl ? String(sourceUrl) : null, typ);
      ergebnis = this.engine.matchRequest(anfrage);
    } catch {
      return { block: false };
    }

    const regel = ergebnis.getBasicResult();
    if (!regel) return { block: false };
    const listId = typeof regel.getFilterListId === "function" ? regel.getFilterListId() : 0;
    if (regel.isAllowlist()) {
      return { block: false, allowlist: true, rule: this.regelText(regel), listId };
    }
    return { block: true, rule: this.regelText(regel), listId };
  }

  // Der Regeltext steht nicht in der Regel selbst. tsurlfilter haelt die Listen
  // im Rohtext und merkt sich je Treffer nur, in welcher Liste und in welcher
  // Zeile er stand - erst darueber kommt man an den Wortlaut. Ohne ihn stuende
  // im Protokoll nur "geblockt", und man wuesste nie, welche Regel es war.
  regelText(regel) {
    try {
      const direkt = typeof regel.getText === "function" ? regel.getText() : "";
      if (direkt) return direkt;
      const text = this.engine.retrieveRuleText(regel.getFilterListId(), regel.getIndex());
      if (text) return text;
    } catch {
      // Eine Liste, die zwischenzeitlich ersetzt wurde.
    }
    return "Regel";
  }

  // Ohne Engine: der alte Domainabgleich. Deutlich grober, aber besser als
  // gar nichts - und genau das laeuft in den ersten Sekunden nach dem Start.
  notfallUrteil(url, resourceType) {
    let hostname;
    try {
      hostname = new URL(String(url || "")).hostname.toLowerCase();
    } catch {
      return { block: false };
    }
    const treffer = findeDomainRegel(hostname, this.notfallDomains);
    if (treffer) return { block: true, rule: `notfall:${treffer}`, notfall: true };
    if (!["media", "mainFrame"].includes(String(resourceType || ""))) {
      const spur = findeDomainRegel(hostname, this.notfallTracker);
      if (spur) return { block: true, rule: `notfall-tracking:${spur}`, notfall: true };
    }
    return { block: false };
  }

  // Ist dieser Hostname ein Werbe- oder Zaehldienst? Damit bewertet die
  // Overlay-Erkennung, wohin ein verdaechtiges Element verlinkt, ohne dafuer
  // eine eigene Domainliste zu pflegen.
  istWerbeHost(hostname) {
    const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
    if (!host || !host.includes(".")) return false;
    if (findeDomainRegel(host, this.notfallDomains)) return true;
    if (findeDomainRegel(host, this.notfallTracker)) return true;
    if (!this.engine) return false;
    // Als Frame gepruefte Adresse: so entscheidet dieselbe Regelbasis, die
    // auch ein echtes Werbe-Iframe von dieser Domain aufgehalten haette.
    return this.matchRequest({
      url: `https://${host}/`,
      resourceType: "subFrame",
      sourceUrl: "https://example.invalid/"
    }).block === true;
  }

  // Die kosmetischen Regeln fuer genau dieses Dokument.
  //
  // Welche Regelarten gelten duerfen, entscheidet nicht ELFIX, sondern die
  // Listen: getCosmeticOption() wertet $elemhide, $generichide und
  // $specifichide aus. Wer diese Ausnahmen uebergeht, blendet auf Seiten
  // Elemente aus, fuer die AdGuard das ausdruecklich untersagt hat - und genau
  // dort sitzen erfahrungsgemaess Player und Anmeldedialoge.
  kosmetik(url) {
    const leer = { stile: [], skripte: [] };
    if (!this.engine) return leer;
    const { Request, RequestType } = this.modul;
    try {
      const anfrage = new Request(String(url || ""), null, RequestType.Document);
      const option = this.engine.matchRequest(anfrage).getCosmeticOption();
      const ergebnis = this.engine.getCosmeticResult(anfrage, option);
      const stile = [
        ...ergebnis.elementHiding.generic,
        ...ergebnis.elementHiding.specific
      ].map((regel) => regel.getContent()).filter(Boolean);
      const skripte = ergebnis.getScriptRules()
        .map((regel) => {
          try {
            return regel.getScript({ debug: false, request: anfrage });
          } catch {
            return "";
          }
        })
        .filter(Boolean);
      return { stile, skripte };
    } catch {
      return leer;
    }
  }
}

function findeDomainRegel(hostname, regeln) {
  for (const regel of regeln) {
    if (hostname === regel || hostname.endsWith(`.${regel}`)) return regel;
  }
  return "";
}

module.exports = {
  AdblockEngine,
  defaultAdDomains,
  defaultTrackerDomains,
  ELECTRON_TYPEN
};
