"use strict";

// Kosmetisches Filtern: was tsurlfilter entscheidet, in die Seite bringen.
//
// tsurlfilter sagt nur, welche Selektoren auf dieser Seite verborgen gehoeren.
// Einspielen muss ELFIX selbst - eine Browsererweiterung hat dafuer Content
// Scripts, Electron hat frame.executeJavaScript(). Diese Datei enthaelt beide
// Haelften:
//
//   - die Skripte, die in der Seite laufen (Textbausteine, unten)
//   - die Entscheidung, ob ein verdaechtiges Overlay weg darf (istWerbeOverlay,
//     laeuft im Hauptprozess und ist damit pruefbar)
//
// Warum ueberhaupt eine eigene Overlay-Erkennung, wo doch die Listen gelten?
// Weil ein Teil der Fake-Gewinnspiele mit zufaellig erzeugten Klassennamen
// kommt, die in keiner Liste stehen koennen. Dagegen hilft nur, das Element
// an seinem Verhalten zu erkennen.
//
// Und warum dann nicht einfach "alles Grosse mit position:fixed und hohem
// z-index" wegwerfen? Weil genau so Player-Bedienung, Cloudflare-Abfragen,
// Anmeldefenster und Untertitel aussehen. Deshalb gilt hier: ohne ein echtes
// Werbesignal - ein Ziel, das die Filterlisten kennen, ein verraeterischer
// Text oder ein Werbename - wird nichts angeruehrt. Geometrie allein reicht
// nie aus.

const MELDE_PRAEFIX = "__elfix:ad:";
const KENNUNG = "__elfixAdblockV1";

// Namen, hinter denen etwas steht, das die Seite wirklich braucht. Trifft
// eines davon, ist die Sache erledigt - ohne Punkte, ohne Abwaegung.
const SCHUTZ_MUSTER = /(player|video|jwplayer|videojs|vjs-|plyr|shaka|hls|dash|control|steuer|captcha|turnstile|cf-chl|cf-turnstile|recaptcha|hcaptcha|challenge|login|signin|sign-in|anmeld|register|passwor|cookie|consent|dsgvo|gdpr|privacy|subtitle|untertitel|caption|volume|lautst|seek|progress|fullscreen|vollbild|settings|einstellung|watchparty|elfix|modal-dialog|age-?gate|fsk)/i;

// Namen, die von selbst nach Werbung klingen. Zaehlt als Signal, nicht als
// Beweis - "download" oder "sponsor" steht auch mal an etwas Echtem.
const WERBE_NAME_MUSTER = /(^|[^a-z])(ad|ads|adv|advert|advertis|werbung|banner|promo|popup|pop-?under|pop-?up|interstitial|sponsor|preroll|takeover|prestitial)([^a-z]|$)/i;

// Was in einem Fake-Gewinnspiel, einer Casino-Einblendung oder einer
// "Virus gefunden"-Meldung steht. Bewusst allgemein und zweisprachig - es geht
// um die Masche, nicht um eine bestimmte Kampagne.
const TEXT_MUSTER = [
  {
    name: "Gewinnspiel",
    muster: /(gewinnspiel|gewonnen|gewinner|glueckwunsch|glückwunsch|congratulation|you (have )?won|you are the winner|claim (your )?(prize|reward)|jackpot|preis gewonnen|sie sind der \d|you are the \d+|lucky (visitor|winner)|heutige[rn]? gewinner)/i
  },
  {
    name: "Casino",
    muster: /(casino|spielautomat|slot machine|freispiele|free spins|wetten|sportwetten|betting|bookmaker|bonus ?code|einzahlungsbonus|jetzt spielen und gewinnen|echtgeld)/i
  },
  {
    name: "Schadsoftware-Angst",
    muster: /(virus (gefunden|detected)|viren gefunden|infiziert|infected|malware|trojaner|spyware|jetzt scannen|scan now|systemwarnung|system warning|security (alert|warning)|sicherheitswarnung|ihr (pc|computer|geraet|gerät|system|iphone|android) (ist|wurde|hat)|your (pc|computer|device|system|iphone|android) (is|has been|was))/i
  },
  {
    name: "Fake-Update",
    muster: /(flash ?player|player aktualisieren|update (your )?(browser|player|flash|driver)|jetzt aktualisieren|treiber (veraltet|aktualisieren)|driver (outdated|update)|erforderliches update)/i
  },
  {
    name: "Dating",
    muster: /(singles? in (deiner|ihrer|your)|hot singles|treffe (frauen|maenner|männer)|sexdate|sex ?kontakte|meet (women|singles) near)/i
  }
];

// Verraet der sichtbare Text die Masche?
function textVerdaechtig(text) {
  const probe = String(text || "").toLowerCase();
  if (probe.length < 6) return { treffer: false, muster: "" };
  for (const eintrag of TEXT_MUSTER) {
    if (eintrag.muster.test(probe)) return { treffer: true, muster: eintrag.name };
  }
  return { treffer: false, muster: "" };
}

function nein(grund) {
  return { entfernen: false, grund, punkte: 0 };
}

// Darf dieses Overlay weg?
//
// "kandidat" beschreibt ein Element so, wie die Seite es gemeldet hat.
// "hilfen.istWerbeHost" beantwortet, ob ein Hostname den Filterlisten als
// Werbung bekannt ist - so entscheidet dieselbe Regelbasis mit, die auch das
// Netzwerk filtert, ohne dass hier eine zweite Domainliste entsteht.
function istWerbeOverlay(kandidat, hilfen = {}) {
  const k = kandidat || {};
  const istWerbeHost = typeof hilfen.istWerbeHost === "function" ? hilfen.istWerbeHost : () => false;
  const name = `${k.id || ""} ${k.klassen || ""}`;

  // Erst das, was auf keinen Fall angeruehrt wird.
  if (k.enthaeltVideo) return nein("enthaelt ein Video");
  if (k.istPlayer) return nein("gehoert zum Player");
  if (k.enthaeltCaptcha) return nein("enthaelt eine Verifizierung");
  if (k.enthaeltEingabe) return nein("enthaelt ein Eingabefeld");
  if (SCHUTZ_MUSTER.test(name)) return nein("geschuetzter Name");
  if (!k.sichtbar) return nein("nicht sichtbar");

  // Der Rahmen ohne Quelle - die eine Form, die ohne Werbesignal auskommt.
  //
  // Gemessen am 26.08.2026 auf AniWorld, auf dem Fire TV und auf dem Telefon:
  //
  //   <iframe style="position:fixed !important;z-index:2147483647 !important;
  //                  inset:0px 0px auto auto !important;max-width:420px;height:170px">
  //
  // direkt an <html> gehaengt, ohne src, ohne id, ohne Klasse - das einzige
  // Attribut ist der Stil. Sein Inhalt ("[1] BROWSER-UPDATE", "Herunterladen
  // und installieren", zwei Bilder von aichouphaugn.com) steht in seinem
  // *eigenen* Dokument.
  //
  // Daran scheitert jede der Fragen darunter, und zwar aus demselben Grund:
  // sie lesen alle das Element von aussen. Es gibt keinen Namen fuer
  // WERBE_NAME_MUSTER, keinen Text fuer TEXT_MUSTER (innerText eines Rahmens
  // ist leer), kein Ziel fuer istWerbeHost - und mit 420x170 auf einem
  // Fernsehschirm auch keine 20 Prozent Deckung. Die Werbung hat ihre
  // Merkmale hinter eine Dokumentgrenze gelegt.
  //
  // Bleibt das, was von aussen sichtbar ist: der Rahmen hat keine Quelle. Ein
  // Player wird immer von einer Adresse geholt - gemessen aniworld.to/redirect/
  // <id> und filmo.to/n/<id>, beide mit src und beide im Textfluss ihres
  // Kastens. Ein Rahmen ohne Adresse ist keiner. Liegt er zusaetzlich fest und
  // vor allem anderen, hat er keine andere Aufgabe, als auf der Seite zu
  // liegen.
  //
  // Warum das hier oben steht und nicht als Punkt weiter unten: Punkte wiegen
  // Beobachtungen gegeneinander ab, und hier gibt es nur eine einzige. Und
  // warum es trotzdem kein Freibrief ist: die Ebene muss wirklich hoch sein
  // (die eigenen Schichten dieser Seiten liegen zweistellig), der Rahmen muss
  // Flaeche haben, und wer fast den ganzen Schirm einnimmt, faellt heraus -
  // das waere eher eine Vollbildhuelle als eine Werbekarte.
  if (String(k.tag || "") === "IFRAME" && k.quellenlos) {
    const deckung = Number(k.deckung) || 0;
    if (k.position === "fixed" && (Number(k.zIndex) || 0) >= 1000 && deckung > 0 && deckung <= 0.9) {
      return { entfernen: true, grund: "Rahmen ohne Quelle liegt vor der Seite", punkte: 4 };
    }
  }

  if (!["fixed", "absolute", "sticky"].includes(String(k.position || ""))) return nein("liegt im Textfluss");
  if (!(Number(k.deckung) >= 0.2)) return nein("zu klein");

  // Dann die Frage, ob ueberhaupt etwas fuer Werbung spricht. Ohne eines
  // dieser drei Signale endet es hier - Groesse und z-index allein sind kein
  // Grund, irgendetwas auszublenden.
  const ziele = [...(k.linkHosts || []), ...(k.iframeHosts || [])];
  const werbeZiel = ziele.find((host) => istWerbeHost(host)) || "";
  const text = textVerdaechtig(k.textProbe);
  const werbeName = WERBE_NAME_MUSTER.test(name);
  if (!werbeZiel && !text.treffer && !werbeName) return nein("kein Werbesignal");

  let punkte = 0;
  const gruende = [];
  if (werbeZiel) {
    punkte += 3;
    gruende.push(`Ziel ${werbeZiel}`);
  }
  if (text.treffer) {
    punkte += 3;
    gruende.push(text.muster);
  }
  if (werbeName) {
    punkte += 2;
    gruende.push("Werbename");
  }
  if (Number(k.deckung) >= 0.5) {
    punkte += 1;
    gruende.push("halber Bildschirm");
  }
  if (Number(k.zIndex) >= 1000) {
    punkte += 1;
    gruende.push(`z-index ${k.zIndex}`);
  }
  if (k.position === "fixed") punkte += 1;
  if (k.nachgeladen) {
    punkte += 1;
    gruende.push("nachtraeglich eingefuegt");
  }

  if (punkte < 4) return nein(`zu schwach (${punkte} Punkte)`);
  return { entfernen: true, grund: gruende.join(", "), punkte };
}

// Das Skript, das in jedem Dokument laeuft.
//
// Es entscheidet nichts. Es spielt das CSS der Filterlisten ein, meldet
// verdaechtige Overlays und blendet aus, was der Hauptprozess ihm nennt. Der
// Rueckweg laeuft ueber console.log mit festem Praefix - denselben Kanal
// benutzt ELFIX schon fuer den Player und die Watchparty, und er kommt ohne
// Preload und ohne geaenderte webPreferences aus. Das ist hier wichtig: an den
// webPreferences der Anbieteransicht haengen Autoplay, Vollbild und die
// Sandbox, und keines davon soll ein Werbefilter anfassen muessen.
function seitenScript() {
  return `(() => {
  const KENN = ${JSON.stringify(KENNUNG)};
  const PRAEFIX = ${JSON.stringify(MELDE_PRAEFIX)};
  if (window[KENN]) { try { window[KENN].anstossen(); } catch (_) {} return true; }

  const gesehen = new Set();
  let laufendeMarke = 0;
  let ersterDurchgang = true;
  let stapel = null;

  const melde = (art, nutzlast) => {
    try { console.log(PRAEFIX + art + ":" + JSON.stringify(nutzlast)); } catch (_) {}
  };

  // Der Stil haengt am documentElement, nicht am head: manche Seiten bauen
  // ihren head waehrend des Ladens neu auf, und der Stil waere wieder weg.
  const stilKnoten = () => {
    let knoten = document.querySelector("style[data-elfix-adblock]");
    if (!knoten || !knoten.isConnected) {
      knoten = document.createElement("style");
      knoten.setAttribute("data-elfix-adblock", "1");
      (document.documentElement || document).appendChild(knoten);
    }
    return knoten;
  };

  const stil = (css) => {
    try {
      const knoten = stilKnoten();
      if (knoten.textContent !== css) knoten.textContent = css;
      return true;
    } catch (_) { return false; }
  };

  // Ausgeblendet wird, nicht entfernt: viele Seitenskripte greifen spaeter
  // wieder auf ihre Knoten zu und werfen einen Fehler, wenn sie weg sind -
  // mitten im Player waere das ein Standbild.
  const entfernen = (marken) => {
    let zahl = 0;
    for (const marke of marken || []) {
      const el = document.querySelector('[data-elfix-ad="' + marke + '"]');
      if (!el) continue;
      try {
        el.style.setProperty("display", "none", "important");
        el.setAttribute("data-elfix-ad-weg", "1");
        zahl += 1;
      } catch (_) {}
    }
    return zahl;
  };

  const host = (wert) => {
    try { return new URL(wert, location.href).hostname.toLowerCase(); } catch (_) { return ""; }
  };

  const beschreibe = (el) => {
    if (!el || el.nodeType !== 1) return null;
    const tag = el.tagName;
    if (tag === "HTML" || tag === "BODY" || tag === "HEAD" || tag === "SCRIPT" || tag === "STYLE") return null;
    if (el.hasAttribute("data-elfix-ad-weg")) return null;

    let stilWerte;
    try { stilWerte = getComputedStyle(el); } catch (_) { return null; }
    const position = stilWerte.position;
    if (position !== "fixed" && position !== "absolute" && position !== "sticky") return null;

    // Ein Rahmen, dessen Quelle keine Adresse ist. Der Player kommt immer von
    // einer - deshalb ist das die eine Form, die auch klein noch gemeldet wird
    // (siehe istWerbeOverlay). "https?" und nicht "nicht leer": about:blank,
    // javascript: und srcdoc sind alle keine Adresse.
    const quellenlos = tag === "IFRAME"
      && !/^https?:/i.test(String(el.getAttribute("src") || "").trim());

    const rechteck = el.getBoundingClientRect();
    const flaeche = Math.max(0, Math.min(rechteck.right, innerWidth) - Math.max(rechteck.left, 0))
      * Math.max(0, Math.min(rechteck.bottom, innerHeight) - Math.max(rechteck.top, 0));
    const deckung = innerWidth && innerHeight ? flaeche / (innerWidth * innerHeight) : 0;
    // Ein solcher Rahmen ohne Flaeche wird bewusst *nicht* gemeldet, sondern
    // gar nicht beschrieben: wer beschrieben wird, landet in "gesehen" und
    // wird nie wieder angesehen. Ein Werbeskript haengt seinen Rahmen aber
    // gern ein, bevor er Groesse hat.
    if (deckung < 0.2 && !(quellenlos && position === "fixed" && deckung > 0)) return null;

    const sichtbar = stilWerte.display !== "none" && stilWerte.visibility !== "hidden" && Number(stilWerte.opacity) > 0.1;
    if (!sichtbar) return null;

    const marke = String(++laufendeMarke);
    el.setAttribute("data-elfix-ad", marke);

    const linkHosts = [];
    for (const a of el.querySelectorAll("a[href]")) {
      const h = host(a.getAttribute("href"));
      if (h && !linkHosts.includes(h)) linkHosts.push(h);
      if (linkHosts.length >= 8) break;
    }
    const iframeHosts = [];
    for (const rahmen of el.querySelectorAll("iframe[src]")) {
      const h = host(rahmen.getAttribute("src"));
      if (h && !iframeHosts.includes(h)) iframeHosts.push(h);
      if (iframeHosts.length >= 8) break;
    }
    if (el.tagName === "IFRAME") {
      const h = host(el.getAttribute("src") || "");
      if (h && !iframeHosts.includes(h)) iframeHosts.push(h);
    }

    return {
      marke,
      tag,
      id: String(el.id || "").slice(0, 80),
      klassen: (typeof el.className === "string" ? el.className : "").slice(0, 200),
      position,
      zIndex: Number(stilWerte.zIndex) || 0,
      deckung: Math.round(deckung * 100) / 100,
      sichtbar: true,
      textProbe: String(el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 400),
      linkHosts,
      iframeHosts,
      enthaeltVideo: Boolean(el.querySelector("video,audio")) || el.tagName === "VIDEO",
      enthaeltEingabe: Boolean(el.querySelector("input,textarea,select")),
      enthaeltCaptcha: Boolean(el.querySelector('iframe[src*="captcha" i],iframe[src*="turnstile" i],iframe[src*="challenges.cloudflare" i],[class*="captcha" i],[id*="captcha" i]')),
      istPlayer: Boolean(el.closest('video,[class*="player" i],[id*="player" i],[class*="jwplayer" i],[class*="video-js" i]')),
      quellenlos,
      nachgeladen: !ersterDurchgang
    };
  };

  // Wer verdeckt gerade die Mitte des Bildes? Das ist die billigste und
  // treffsicherste Frage: ein Overlay, das den Player zudeckt, liegt dort
  // zwangslaeufig obenauf. Die ganze Seite abzusuchen waere auf jeder
  // Mausbewegung zu teuer.
  const kandidaten = (zusatz) => {
    const gefunden = [];
    const pruefe = (el) => {
      let ziel = el;
      for (let tiefe = 0; ziel && tiefe < 4; tiefe += 1) {
        if (gesehen.has(ziel)) return;
        const info = beschreibe(ziel);
        if (info) { gesehen.add(ziel); gefunden.push(info); return; }
        ziel = ziel.parentElement;
      }
    };
    try {
      const mitte = document.elementsFromPoint(innerWidth / 2, innerHeight / 2) || [];
      for (const el of mitte.slice(0, 4)) pruefe(el);
      const oben = document.elementsFromPoint(innerWidth / 2, Math.min(80, innerHeight / 4)) || [];
      for (const el of oben.slice(0, 3)) pruefe(el);
    } catch (_) {}
    // Und die Rahmen, jeder einzeln statt ueber einen Punkt auf dem Schirm.
    // Die Werbekarte haengt in der Ecke; die beiden Punkte oben treffen sie
    // nicht, und ihr Elternteil ist <html> - da gibt es nichts, worueber sie
    // sich finden liesse. "beschreibe" wirft die Rahmen der Seite gleich
    // wieder weg (sie liegen im Textfluss), das kostet also nur die Schleife.
    try {
      const rahmen = document.querySelectorAll("iframe");
      for (let i = 0; i < rahmen.length && i < 20; i += 1) {
        const el = rahmen[i];
        if (gesehen.has(el)) continue;
        const info = beschreibe(el);
        if (info) { gesehen.add(el); gefunden.push(info); }
      }
    } catch (_) {}
    for (const el of zusatz || []) pruefe(el);
    return gefunden.slice(0, 6);
  };

  const durchgang = (zusatz) => {
    try {
      const liste = kandidaten(zusatz);
      if (liste.length) melde("kandidaten", liste);
    } catch (_) {}
    ersterDurchgang = false;
  };

  let wartend = null;
  const neueKnoten = new Set();
  const anstossen = (zusatz) => {
    for (const el of zusatz || []) neueKnoten.add(el);
    if (wartend) return;
    wartend = setTimeout(() => {
      wartend = null;
      const liste = [...neueKnoten].slice(0, 40);
      neueKnoten.clear();
      durchgang(liste);
    }, 250);
  };

  window[KENN] = { stil, entfernen, anstossen: () => anstossen([]) };

  try {
    stapel = new MutationObserver((eintraege) => {
      const neu = [];
      for (const eintrag of eintraege) {
        for (const knoten of eintrag.addedNodes || []) {
          if (knoten.nodeType === 1) neu.push(knoten);
        }
        if (eintrag.type === "attributes" && eintrag.target.nodeType === 1) neu.push(eintrag.target);
      }
      anstossen(neu);
    });
    stapel.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "id"]
    });
  } catch (_) {}

  durchgang([]);
  // Werbeskripte kommen oft mit Verzoegerung. Zwei Nachfassungen kosten nichts
  // und fangen das ab, was nach dem ersten Durchgang eingebaut wird.
  setTimeout(() => anstossen([]), 1500);
  setTimeout(() => anstossen([]), 5000);
  return true;
})()`;
}

// Selektoren in einen Stil giessen. In Bloecken, weil eine einzelne Regel mit
// 16.000 Selektoren zwar gueltig ist, sich aber in keinem Werkzeug mehr lesen
// laesst - und ein einziger kaputter Selektor sonst den ganzen Block killt.
function stilAusSelektoren(selektoren, blockGroesse = 1500) {
  const sauber = (selektoren || []).map((s) => String(s || "").trim()).filter(Boolean);
  if (!sauber.length) return "";
  const bloecke = [];
  for (let i = 0; i < sauber.length; i += blockGroesse) {
    bloecke.push(`${sauber.slice(i, i + blockGroesse).join(",\n")} { display: none !important; }`);
  }
  return bloecke.join("\n");
}

// Aufrufe an das Skript in der Seite.
function stilAufrufScript(css) {
  return `(() => { const a = window[${JSON.stringify(KENNUNG)}]; return a ? a.stil(${JSON.stringify(css)}) : false; })()`;
}

function entfernenAufrufScript(marken) {
  return `(() => { const a = window[${JSON.stringify(KENNUNG)}]; return a ? a.entfernen(${JSON.stringify(marken)}) : 0; })()`;
}

// Eine Meldung aus der Seite auseinandernehmen.
function meldungLesen(nachricht) {
  const roh = String(nachricht || "");
  if (!roh.startsWith(MELDE_PRAEFIX)) return null;
  const rest = roh.slice(MELDE_PRAEFIX.length);
  const trenner = rest.indexOf(":");
  if (trenner < 0) return null;
  const art = rest.slice(0, trenner);
  try {
    return { art, daten: JSON.parse(rest.slice(trenner + 1)) };
  } catch {
    return null;
  }
}

module.exports = {
  MELDE_PRAEFIX,
  KENNUNG,
  SCHUTZ_MUSTER,
  WERBE_NAME_MUSTER,
  TEXT_MUSTER,
  textVerdaechtig,
  istWerbeOverlay,
  seitenScript,
  stilAusSelektoren,
  stilAufrufScript,
  entfernenAufrufScript,
  meldungLesen
};
