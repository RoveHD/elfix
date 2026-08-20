"use strict";
// Der Werbefilter: Netzregeln, Kosmetik, Popups, Rahmen - und die Wiedergabe.
//
// Anlass ist der Umbau von einem selbst geschriebenen Listen-Teilparser auf
// @adguard/tsurlfilter. Der alte Parser warf jede kosmetische Regel weg, und
// er liess alles durch, was von einem bekannten Video-Hoster kam. Beides
// zusammen ergab die Fake-Gewinnspiele ueber dem Player: die Overlays sind
// gewoehnliche DIVs, und die Skripte, die sie bauen, liegen auf denselben
// Hostern wie das Video.
//
// Geprueft wird gegen die echten Bausteine, nicht gegen einen Nachbau: die
// Engine ist die richtige Engine mit einer kleinen, aber echten AdGuard-Liste,
// die Entscheidungsfunktionen werden aus main.js herausgeschnitten und
// aufgerufen. Was hier gruen ist, ist es auch in der App.

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const WURZEL = path.join(__dirname, "..");
const lies = (datei) => fs.readFileSync(path.join(WURZEL, datei), "utf8").split("\r\n").join("\n");

const pruefungen = [];
const pruefe = (n, b, d) => { pruefungen.push(Boolean(b)); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };

// Eine Funktion oder eine Konstante endet an der ersten Zeile, die nur eine
// schliessende Klammer traegt - so ist der Quelltext durchgehend formatiert.
// Klammern zu zaehlen scheitert an Regex- und Vorlagen-Literalen.
function abschnitt(quelle, anfang) {
  const zeilen = quelle.split("\n");
  const von = zeilen.findIndex((z) => z.startsWith(anfang));
  if (von < 0) throw new Error("nicht gefunden: " + anfang);
  if (/^const .*;$/.test(zeilen[von])) return zeilen[von];
  let bis = von;
  while (bis < zeilen.length && zeilen[bis] !== "}") bis += 1;
  return zeilen.slice(von, bis + 1).join("\n");
}

const { AdblockEngine } = require(path.join(WURZEL, "src", "adblock-engine.js"));
const kosmetikModul = require(path.join(WURZEL, "src", "adblock-kosmetik.js"));
const providerModel = require(path.join(WURZEL, "shared", "provider-model.js"));

// Eine kleine, aber echte AdGuard-Liste. Jede Zeile steht fuer einen
// Regeltyp, den die App koennen muss.
const TESTLISTE = [
  "! Titel: ELFIX-Pruefliste",
  "||werbenetz-test.com^",
  "||spur-test.com^$third-party",
  "||nurskript-test.com^$script",
  "||nurbild-test.com^$image",
  "||nurstil-test.com^$stylesheet",
  "||nurxhr-test.com^$xmlhttprequest",
  "||nurframe-test.com^$subdocument",
  "||domainfest-test.com^$domain=aniworld.to",
  "@@||werbenetz-test.com/erlaubt.js^",
  "||pemsrv.com^",
  "||propu.sh^",
  "voe.sx##.fake-giveaway",
  "##.generisches-banner",
  "voe.sx#@#.generisches-banner"
].join("\n");

// Die Tracking-Liste bekommt bewusst die AdGuard-Nummer 3 - daran haengt der
// Schalter "Tracking-Schutz".
const TRACKINGLISTE = "||zaehldienst-test.com^";

const PROVIDER = { id: "aniworld", name: "AniWorld", startUrl: "https://aniworld.to/", enabled: true, adblockEnabled: true };
const STO = { id: "sto", name: "S.to", startUrl: "https://s.to/", enabled: true, adblockEnabled: true };
const FILMO = { id: "filmo", name: "Filmo", startUrl: "https://filmo.co/", enabled: true, adblockEnabled: true };

(async () => {
  const adblock = new AdblockEngine();
  const gebaut = await adblock.bauen([
    { id: 2, text: TESTLISTE },
    { id: 3, text: TRACKINGLISTE }
  ]);
  pruefe("tsurlfilter laesst sich laden und bauen", gebaut && adblock.istBereit(),
    gebaut ? `${adblock.ruleCount()} Regeln` : "Engine fehlt");
  if (!gebaut) {
    console.log("0/1 bestanden");
    process.exit(1);
  }

  // --- Die Entscheidungsfunktionen aus main.js ----------------------------
  const main = lies("src/main.js");
  const teile = [
    "const MEDIEN_ENDUNGEN",
    "const MEDIEN_PFADE",
    "const MEDIEN_TYPEN",
    "function wiedergabeAusnahme",
    "function frameQuelle",
    "function adblockUrteil",
    "function blockKategorie",
    "function shouldCancelNavigation",
    "function shouldCancelFrameNavigation",
    "function shouldBlockTarget",
    "function istPopupNavigation",
    "function istErlaubtesHauptziel",
    "function isAllowedNewWindowTarget",
    "function istVerifizierungsFenster",
    "function shouldBlockProviderNavigation",
    "function isOtherConfiguredProviderHost",
    "function isAllowedProviderHost",
    "function isAllowedResultHost",
    "function isKnownVideoHosterUrl",
    "function istCaptchaHost",
    "function isChallengeOrVerificationUrl",
    "function isStoProviderLike",
    "function isStoHost",
    "function isWhitelisted",
    "function isProviderFirstParty",
    "function isKnownAuthHost",
    "function stripWww",
    "function enabledProviders"
  ].map((anfang) => abschnitt(main, anfang)).join("\n\n");

  const protokoll = [];
  const sandkasten = {
    // Ein frischer vm-Kontext hat nur die Sprache, keine Web-Globalen. Ohne
    // diese Zeile wirft jedes "new URL(...)" in den herausgeschnittenen
    // Funktionen, und weil die es abfangen, waere jede Pruefung still gruen
    // beziehungsweise still rot - je nachdem, was der Fangzweig zurueckgibt.
    URL,
    URLSearchParams,
    providerModel,
    adblock,
    providers: [PROVIDER, STO, FILMO],
    TRACKING_LISTEN_ID: 3,
    settings: {
      adblock: { enabled: true, trackingProtection: true, blockPopups: true, blockRedirects: true, whitelist: [] }
    },
    logBlockedUrl: (url, provider, rule, type, kategorie) => protokoll.push({ url, rule, type, kategorie }),
    console
  };
  vm.createContext(sandkasten);
  vm.runInContext(teile, sandkasten);
  const {
    adblockUrteil, wiedergabeAusnahme, shouldCancelNavigation, shouldCancelFrameNavigation,
    isAllowedNewWindowTarget, blockKategorie
  } = sandkasten;
  const urteil = (url, resourceType, quelle, provider = PROVIDER) =>
    adblockUrteil({ url, resourceType, referrer: quelle || "" }, provider);

  // --- 1-3: Netzregeln und Ausnahmen --------------------------------------
  console.log("\n-- Netzregeln --");
  pruefe("1. normale Werbedomain wird blockiert",
    urteil("https://werbenetz-test.com/banner.js", "script", "https://aniworld.to/x").block);
  pruefe("2. Tracker wird blockiert",
    urteil("https://spur-test.com/pixel.gif", "image", "https://aniworld.to/x").block);
  pruefe("3. @@-Ausnahme laesst durch",
    !urteil("https://werbenetz-test.com/erlaubt.js", "script", "https://aniworld.to/x").block,
    urteil("https://werbenetz-test.com/erlaubt.js", "script", "https://aniworld.to/x").kategorie);

  // Die Typoptionen muessen wirklich unterscheiden - sonst haette der alte
  // Parser genuegt.
  pruefe("$script trifft nur Skripte",
    urteil("https://nurskript-test.com/a.js", "script", "https://aniworld.to/x").block
    && !urteil("https://nurskript-test.com/a.png", "image", "https://aniworld.to/x").block);
  pruefe("$image, $stylesheet, $xmlhttprequest, $subdocument greifen",
    urteil("https://nurbild-test.com/a.png", "image", "https://aniworld.to/x").block
    && urteil("https://nurstil-test.com/a.css", "stylesheet", "https://aniworld.to/x").block
    && urteil("https://nurxhr-test.com/api", "xhr", "https://aniworld.to/x").block
    && urteil("https://nurframe-test.com/f.html", "subFrame", "https://aniworld.to/x").block);
  pruefe("$third-party greift nur von fremder Seite",
    urteil("https://spur-test.com/a.js", "script", "https://aniworld.to/x").block
    && !urteil("https://spur-test.com/a.js", "script", "https://spur-test.com/eigen").block);
  pruefe("$domain= beachtet die Seite",
    urteil("https://domainfest-test.com/a.js", "script", "https://aniworld.to/x").block
    && !urteil("https://domainfest-test.com/a.js", "script", "https://s.to/x", STO).block);
  pruefe("Der Tracking-Schalter wirkt auf die Tracking-Liste",
    urteil("https://zaehldienst-test.com/t.js", "script", "https://aniworld.to/x").block
    && blockKategorie("script", { listId: 3 }) === "TRACKER_BLOCKED");
  sandkasten.settings.adblock.trackingProtection = false;
  pruefe("Aus geschaltet laesst der Tracking-Schutz die Liste 3 durch, Werbung aber nicht",
    !urteil("https://zaehldienst-test.com/t.js", "script", "https://aniworld.to/x").block
    && urteil("https://werbenetz-test.com/a.js", "script", "https://aniworld.to/x").block);
  sandkasten.settings.adblock.trackingProtection = true;

  // --- 4-5: Kosmetik ------------------------------------------------------
  console.log("\n-- Kosmetik --");
  const voe = adblock.kosmetik("https://voe.sx/e/abc");
  const ani = adblock.kosmetik("https://aniworld.to/anime/x");
  pruefe("4. ##-Regel erreicht die richtige Seite",
    voe.stile.includes(".fake-giveaway") && !ani.stile.includes(".fake-giveaway"),
    `voe: ${voe.stile.length} Selektoren`);
  pruefe("5. #@#-Ausnahme nimmt die allgemeine Regel genau dort zurueck",
    !voe.stile.includes(".generisches-banner") && ani.stile.includes(".generisches-banner"));
  const css = kosmetikModul.stilAusSelektoren(voe.stile);
  pruefe("Aus den Selektoren wird gueltiges CSS",
    css.includes(".fake-giveaway") && css.includes("display: none !important"));
  pruefe("Das Seitenskript laesst sich zweimal einspielen, ohne doppelt zu laufen",
    kosmetikModul.seitenScript().includes("if (window[KENN])"));

  // --- 6: Overlays --------------------------------------------------------
  console.log("\n-- Overlay-Erkennung --");
  const hilfen = { istWerbeHost: (h) => adblock.istWerbeHost(h) };
  const overlay = (extra) => kosmetikModul.istWerbeOverlay({
    tag: "DIV", id: "", klassen: "", position: "fixed", zIndex: 9999, deckung: 0.8,
    sichtbar: true, textProbe: "", linkHosts: [], iframeHosts: [],
    enthaeltVideo: false, enthaeltEingabe: false, enthaeltCaptcha: false,
    istPlayer: false, nachgeladen: true, ...extra
  }, hilfen);

  const gewinnspiel = overlay({ textProbe: "Herzlichen Glueckwunsch! Sie sind der 1000. Besucher und haben gewonnen." });
  pruefe("6. Fake-Gewinnspiel-Overlay wird entfernt", gewinnspiel.entfernen, gewinnspiel.grund);
  const casino = overlay({ textProbe: "Jetzt im Casino spielen - 200 Freispiele Bonus", deckung: 0.6 });
  pruefe("   Casino-Einblendung wird entfernt", casino.entfernen, casino.grund);
  const virus = overlay({ textProbe: "Achtung: Ihr Computer ist infiziert! Jetzt scannen." });
  pruefe("   Virus-Schreckmeldung wird entfernt", virus.entfernen, virus.grund);
  const werbeZiel = overlay({ textProbe: "Weiter", linkHosts: ["werbenetz-test.com"] });
  pruefe("   Overlay mit Ziel aus den Filterlisten wird entfernt", werbeZiel.entfernen, werbeZiel.grund);
  const dynamisch = overlay({ klassen: "ad-interstitial", nachgeladen: true, textProbe: "" });
  pruefe("   dynamisch erzeugtes Werbe-Overlay wird entfernt", dynamisch.entfernen, dynamisch.grund);

  // Und das, was auf keinen Fall angefasst werden darf.
  const controls = overlay({ klassen: "vjs-control-bar", textProbe: "Vollbild", deckung: 0.3 });
  pruefe("   Player-Bedienung bleibt", !controls.entfernen, controls.grund);
  const captcha = overlay({ enthaeltCaptcha: true, textProbe: "Bestaetigen Sie, dass Sie ein Mensch sind" });
  pruefe("   Cloudflare-Abfrage bleibt", !captcha.entfernen, captcha.grund);
  const login = overlay({ klassen: "login-modal", enthaeltEingabe: true, textProbe: "Anmelden" });
  pruefe("   Anmeldefenster bleibt", !login.entfernen, login.grund);
  const video = overlay({ enthaeltVideo: true });
  pruefe("   Ein Kasten mit dem Video bleibt", !video.entfernen, video.grund);
  const nurGross = overlay({ textProbe: "Bitte waehlen Sie eine Staffel", klassen: "season-picker" });
  pruefe("   Grosses Element ohne Werbesignal bleibt (kein pauschales Loeschen)",
    !nurGross.entfernen, nurGross.grund);
  const cookie = overlay({ klassen: "cookie-consent", textProbe: "Wir verwenden Cookies" });
  pruefe("   Cookie-Hinweis bleibt", !cookie.entfernen, cookie.grund);

  // --- 7-9: Popups und Umleitungen ---------------------------------------
  console.log("\n-- Popups, Umleitungen, Rahmen --");
  pruefe("7. window.open() auf eine Werbeseite wird verweigert",
    !isAllowedNewWindowTarget("https://werbenetz-test.com/gewinnspiel", PROVIDER));
  pruefe("   window.open() auf einen Hoster wird ebenfalls verweigert (der Player braucht kein Fenster)",
    !isAllowedNewWindowTarget("https://voe.sx/e/abc", PROVIDER));
  pruefe("   window.open() fuer die Cloudflare-Abfrage geht auf",
    isAllowedNewWindowTarget("https://challenges.cloudflare.com/turnstile/", PROVIDER));

  protokoll.length = 0;
  pruefe("8. Werbeumleitung des Hauptdokuments wird abgebrochen",
    shouldCancelNavigation("https://werbenetz-test.com/gewinnspiel", PROVIDER, true)
    && protokoll.some((e) => e.kategorie === "POPUP" || e.kategorie === "MAIN_FRAME_REDIRECT"));

  protokoll.length = 0;
  pruefe("9. Werbeumleitung eines eingebetteten Rahmens wird abgebrochen",
    shouldCancelFrameNavigation("https://werbenetz-test.com/gewinnspiel", PROVIDER, "https://voe.sx/e/abc")
    && protokoll.some((e) => e.kategorie === "FRAME_REDIRECT"));
  pruefe("   Der Hosterrahmen darf innerhalb seiner Seite weiterleiten",
    !shouldCancelFrameNavigation("https://voe.sx/e/abc2", PROVIDER, "https://voe.sx/e/abc"));
  pruefe("   Ein Rahmen darf nicht in einen App-Store springen",
    shouldCancelFrameNavigation("intent://oeffne-app", PROVIDER, "https://voe.sx/e/abc"));

  // --- 10-13: Wiedergabe gegen Werbung auf denselben Hostern -------------
  console.log("\n-- Hoster: Wiedergabe vs. Werbung --");
  const HOSTER = [
    ["VOE", "https://voe.sx/e/abc", "https://delivery-node-7.voe-network.net/engine/hls2/01/9/x.m3u8", "https://delivery-node-7.voe-network.net/engine/hls2/01/9/seg-12.ts"],
    ["Filemoon", "https://filemoon.sx/e/abc", "https://filemoon.sx/hls/1/master.m3u8", "https://filemoon.sx/hls/1/seg-3.ts"],
    ["StreamWish", "https://streamwish.to/e/abc", "https://streamwish.to/hls2/01/master.m3u8", "https://streamwish.to/hls2/01/seg-1.ts"],
    ["Dood", "https://dood.li/e/abc", "https://dood.li/video/playlist.m3u8", "https://dood.li/video/seg-2.ts"],
    ["Vidmoly", "https://vidmoly.to/embed-abc.html", "https://vidmoly.to/hls/master.m3u8", "https://vidmoly.to/hls/seg-1.ts"],
    ["Streamtape", "https://streamtape.com/e/abc", "https://streamtape.com/get_video?id=abc", "https://streamtape.com/get_video?id=abc&range=2"]
  ];
  let rahmenOk = true;
  let manifestOk = true;
  let segmentOk = true;
  let werbungOk = true;
  for (const [name, rahmen, manifest, segment] of HOSTER) {
    const r = urteil(rahmen, "subFrame", "https://aniworld.to/anime/stream/x");
    const ma = urteil(manifest, "xhr", rahmen);
    const se = urteil(segment, "xhr", rahmen);
    // Werbung und Popunder aus demselben Rahmen heraus.
    const werbung = urteil("https://pemsrv.com/ads.js", "script", rahmen);
    const popunder = urteil("https://propu.sh/ntfc.php", "script", rahmen);
    if (r.block) { rahmenOk = false; console.log(`        ${name}: Rahmen faellt`); }
    if (ma.block) { manifestOk = false; console.log(`        ${name}: Manifest faellt`); }
    if (se.block) { segmentOk = false; console.log(`        ${name}: Segment faellt`); }
    if (!werbung.block || !popunder.block) { werbungOk = false; console.log(`        ${name}: Werbung kommt durch`); }
  }
  pruefe("10. Der Player-Rahmen aller sechs Hoster wird eingebettet", rahmenOk);
  pruefe("11. HLS-/DASH-Manifeste laufen", manifestOk);
  pruefe("12. Video-Segmente laufen", segmentOk);
  pruefe("13. Werbe- und Popunder-Skripte werden trotz Hoster geprueft und fallen", werbungOk);

  pruefe("   Chromiums eigene Medien-Kennzeichnung genuegt",
    wiedergabeAusnahme("https://irgendwo.example/film.bin", PROVIDER, "media", "https://voe.sx/e/1") === "MEDIA_ALLOWED");
  pruefe("   Ein Skript vom Hoster bekommt keine Wiedergabe-Freigabe mehr",
    wiedergabeAusnahme("https://voe.sx/js/pop.js", PROVIDER, "script", "https://voe.sx/e/1") === "");
  pruefe("   Ein zweites Iframe im Hosterrahmen bekommt keine Freigabe",
    wiedergabeAusnahme("https://werbenetz-test.com/f.html", PROVIDER, "subFrame", "https://voe.sx/e/1") === "");
  pruefe("   Eine .mp4 von einem Werbenetz bekommt keine Freigabe",
    wiedergabeAusnahme("https://werbenetz-test.com/spot.mp4", PROVIDER, "xhr", "https://aniworld.to/x") === "");
  pruefe("   Der eingebettete Rahmen wird als PLAYER_ALLOWED gefuehrt",
    wiedergabeAusnahme("https://voe.sx/e/abc", PROVIDER, "subFrame", "https://aniworld.to/x") === "PLAYER_ALLOWED");

  // --- 14: Verifizierung --------------------------------------------------
  console.log("\n-- Verifizierung und Navigation --");
  const captchaFaelle = [
    "https://challenges.cloudflare.com/turnstile/v0/api.js",
    "https://hcaptcha.com/1/api.js",
    "https://www.google.com/recaptcha/api.js",
    "https://s.to/cdn-cgi/challenge-platform/h/b/jsd"
  ];
  pruefe("14. Cloudflare, Turnstile und Captchas kommen durch",
    captchaFaelle.every((u) => !urteil(u, "script", "https://s.to/serie/x", STO).block),
    captchaFaelle.map((u) => urteil(u, "script", "https://s.to/serie/x", STO).kategorie || "-").join(" "));
  pruefe("   Verifizierung wird als CAPTCHA_ALLOWED gefuehrt",
    urteil("https://challenges.cloudflare.com/turnstile/v0/api.js", "script", "https://s.to/x", STO).kategorie === "CAPTCHA_ALLOWED");

  // --- 15: Normale Navigation der Anbieter --------------------------------
  const navigation = [
    [PROVIDER, "https://aniworld.to/anime/stream/naruto/staffel-1/episode-1"],
    [PROVIDER, "https://aniworld.sx/anime/stream/naruto"],
    [STO, "https://s.to/serie/stream/dark/staffel-1/episode-2"],
    [FILMO, "https://filmo.co/film/beispiel"]
  ];
  let navOk = true;
  for (const [provider, url] of navigation) {
    if (shouldCancelNavigation(url, provider, true)) { navOk = false; console.log(`        abgebrochen: ${url}`); }
  }
  pruefe("15. AniWorld, S.to und Filmo navigieren normal", navOk);
  pruefe("   Der Sprung zum Hoster bleibt erlaubt",
    !shouldCancelNavigation("https://voe.sx/e/abc", PROVIDER, true));
  pruefe("   Anfragen der Anbieterseite selbst werden nicht gefiltert",
    !urteil("https://aniworld.to/public/js/app.js", "script", "https://aniworld.to/x").block);
  pruefe("   Die Ausnahmeliste des Nutzers sticht die Filterlisten",
    (() => {
      sandkasten.settings.adblock.whitelist = ["werbenetz-test.com"];
      const frei = urteil("https://werbenetz-test.com/a.js", "script", "https://aniworld.to/x");
      sandkasten.settings.adblock.whitelist = [];
      return !frei.block && frei.kategorie === "FILTER_EXCEPTION";
    })());

  // --- Protokoll ----------------------------------------------------------
  console.log("\n-- Protokoll --");
  const kategorien = new Set();
  protokoll.length = 0;
  shouldCancelNavigation("https://werbenetz-test.com/x", PROVIDER, true);
  shouldCancelFrameNavigation("https://werbenetz-test.com/x", PROVIDER, "https://voe.sx/e/1");
  for (const eintrag of protokoll) kategorien.add(eintrag.kategorie);
  pruefe("Popup und Frame-Umleitung landen mit eigener Kategorie im Protokoll",
    kategorien.has("POPUP") && kategorien.has("FRAME_REDIRECT"),
    [...kategorien].join(", "));
  pruefe("Geblockte Skripte und Tracker sind im Protokoll unterscheidbar",
    blockKategorie("script", { listId: 2 }) === "SCRIPT_BLOCKED"
    && blockKategorie("script", { listId: 3 }) === "TRACKER_BLOCKED"
    && blockKategorie("image", { listId: 2 }) === "NETWORK_RULE");

  const gut = pruefungen.filter(Boolean).length;
  console.log(`\n${gut}/${pruefungen.length} bestanden`);
  process.exit(gut === pruefungen.length ? 0 : 1);
})().catch((fehler) => {
  console.log("FAIL  Die Pruefung selbst ist gescheitert   -> " + (fehler?.stack || fehler));
  process.exit(1);
});
