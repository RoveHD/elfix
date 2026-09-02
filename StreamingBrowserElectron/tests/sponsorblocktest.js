"use strict";
// SponsorBlock.
//
// Zwei Dinge entscheiden darueber, ob das Ganze taugt.
//
// Erstens: es darf nur YouTube betreffen. Ein Sprung auf einer Hosterseite
// waere kein Schoenheitsfehler, sondern ein Eingriff in ein fremdes Video an
// einer Stelle, die ein anderer Dienst fuer ein ganz anderes Video gemeldet
// hat.
//
// Zweitens: es darf nie gegen den Benutzer arbeiten. Ein Segment wird einmal
// uebersprungen; wer zurueckspult, kommt dort an und wird nicht wieder
// weggeschoben. Alles andere waere ein Kampf um den Abspielkopf, und den
// gewinnt das Programm - der Mensch gibt auf.
//
// Geprueft wird gegen dieselben Funktionen, die im Player laufen: das Skript
// setzt `sprungFuer` und `rueckkehrFuer` woertlich ein (siehe skipScript).

const fs = require("fs");
const path = require("path");
const sponsorblock = require("../src/sponsorblock.js");
const youtube = require("../src/youtube.js");

const WURZEL = path.join(__dirname, "..");
const MAIN = fs.readFileSync(path.join(WURZEL, "src/main.js"), "utf8").replace(/\r/g, "");
const RENDERER = fs.readFileSync(path.join(WURZEL, "src/renderer/renderer.js"), "utf8").replace(/\r/g, "");
const HTML = fs.readFileSync(path.join(WURZEL, "src/renderer/index.html"), "utf8").replace(/\r/g, "");

const pruefungen = [];
const pruefe = (name, bedingung, detail) => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

// --- Nur YouTube, und dort jede Schreibweise --------------------------------

pruefe("Die Videokennung kommt aus allen vier Schreibweisen",
  youtube.videoKennung("https://www.youtube.com/watch?v=abc12345678")?.id === "abc12345678"
  && youtube.videoKennung("https://youtu.be/abc12345678?si=xy")?.id === "abc12345678"
  && youtube.videoKennung("https://www.youtube.com/embed/abc12345678")?.id === "abc12345678"
  && youtube.videoKennung("https://www.youtube.com/shorts/abc12345678")?.id === "abc12345678",
  "watch, youtu.be, embed, shorts - dazu live und /v/");
pruefe("Und ELFIX oeffnet keine fuenfte, die hier fehlte",
  youtube.videoKennung(youtube.fortsetzenUrl("https://youtu.be/abc12345678", 90))?.id === "abc12345678",
  "die Adresse aus fortsetzenUrl ist selbst eine watch-Adresse");
pruefe("Ein fremder Anbieter hat keine Kennung",
  youtube.videoKennung("https://aniworld.to/anime/stream/one-piece/staffel-1/episode-2") === null
  && youtube.videoKennung("https://voe.sx/e/abcdef") === null,
  "ohne Kennung wird gar nicht erst gefragt");

// --- Die Kategorien ---------------------------------------------------------

pruefe("Genau die fuenf angebotenen Kategorien",
  sponsorblock.KATEGORIEN.join(",") === "sponsor,selfpromo,interaction,intro,outro");
pruefe("Standard: Werbung weg, Intro und Outro bleiben",
  sponsorblock.kategorienAus({}).join(",") === "sponsor,selfpromo,interaction",
  "ein Intro ist keine Werbung");
pruefe("Intro eingeschaltet zaehlt mit",
  sponsorblock.kategorienAus({ intro: true }).includes("intro"));
pruefe("Ausgeschaltet gilt keine einzige",
  sponsorblock.kategorienAus({ enabled: false }).length === 0,
  "und ohne Kategorie wird nicht gefragt");
pruefe("Die Anfrage nennt alle fuenf und nur Sprungsegmente",
  sponsorblock.anfrageUrl("5f6b").includes(encodeURIComponent(JSON.stringify(sponsorblock.KATEGORIEN)))
  && sponsorblock.anfrageUrl("5f6b").includes(encodeURIComponent(JSON.stringify(["skip"]))),
  "geholt wird unabhaengig von den Schaltern - der Dienst erfaehrt sie nicht");

// --- Die Anfrage verraet das Video nicht ------------------------------------

const praefix = sponsorblock.hashPraefix("dQw4w9WgXcQ");
pruefe("Gefragt wird mit vier Zeichen des SHA-256",
  /^[0-9a-f]{4}$/.test(praefix) && praefix === "5f6b", praefix);
pruefe("Die Videokennung selbst steht nicht in der Adresse",
  !sponsorblock.anfrageUrl(praefix).includes("dQw4w9WgXcQ"),
  "die Antwort umfasst tausende Videos");
pruefe("Ein unsinniges Praefix ergibt keine Adresse",
  sponsorblock.anfrageUrl("") === "" && sponsorblock.anfrageUrl("../../etc") === ""
  && sponsorblock.anfrageUrl("zzzz") === "");

// --- Die Antwort lesen ------------------------------------------------------

const antwort = [
  {
    videoID: "abc12345678",
    hash: "5f6b00",
    segments: [
      { category: "sponsor", actionType: "skip", segment: [45.2, 71.8], UUID: "a" },
      { category: "selfpromo", actionType: "skip", segment: [300, 330], UUID: "b" },
      { category: "intro", actionType: "skip", segment: [0, 12], UUID: "c" }
    ]
  },
  {
    videoID: "zzz99999999",
    hash: "5f6b11",
    segments: [{ category: "sponsor", actionType: "skip", segment: [10, 20], UUID: "d" }]
  }
];

const segmente = sponsorblock.segmenteAus(antwort, "abc12345678");
pruefe("Aus der Antwort kommen die Segmente dieses Videos",
  segmente.length === 3, String(segmente.length));
pruefe("Und keins von einem fremden Video mit demselben Praefix",
  !segmente.some((eintrag) => eintrag.von === 10 && eintrag.bis === 20),
  "genau dafuer steht die Videokennung in der Antwort");
pruefe("Sie stehen nach der Zeit geordnet",
  segmente.map((eintrag) => eintrag.von).join(",") === "0,45.2,300");
pruefe("Ein Video ohne Eintraege ist ein normaler Zustand",
  sponsorblock.segmenteAus([], "abc12345678").length === 0
  && sponsorblock.segmenteAus(antwort, "gibtsnicht").length === 0);

// --- Und jetzt der eigentliche Punkt: nichts Fremdes kommt durch -------------

const unsinn = [
  { category: "sponsor", actionType: "skip", segment: [50, 40] },          // Ende vor Anfang
  { category: "sponsor", actionType: "skip", segment: [50, 50] },          // Ende gleich Anfang
  { category: "sponsor", actionType: "skip", segment: [-30, 10] },         // negativer Anfang
  { category: "sponsor", actionType: "skip", segment: [10, 10.4] },        // kuerzer als eine Sekunde
  { category: "sponsor", actionType: "skip", segment: ["45", "71"] },      // Text statt Zahl
  { category: "sponsor", actionType: "skip", segment: [null, 20] },
  { category: "sponsor", actionType: "skip", segment: [NaN, 20] },
  { category: "sponsor", actionType: "skip", segment: [10] },
  { category: "sponsor", actionType: "skip" },
  { category: "sponsor", actionType: "mute", segment: [10, 30] },          // nicht zum Springen
  { category: "sponsor", actionType: "full", segment: [0, 600] },
  { category: "poi_highlight", actionType: "skip", segment: [10, 30] },    // nicht angeboten
  { category: "chapter", actionType: "skip", segment: [10, 30] },
  { category: "<script>", actionType: "skip", segment: [10, 30] },
  { category: "sponsor", actionType: "skip", segment: [10, 30], description: "</script><img src=x onerror=alert(1)>" },
  null, 0, "x", []
];
const gelesen = sponsorblock.segmenteAus(
  [{ videoID: "abc12345678", segments: unsinn }], "abc12345678");
pruefe("Nur ein einziger dieser neunzehn Faelle ist ein Segment",
  gelesen.length === 1 && gelesen[0].von === 10 && gelesen[0].bis === 30,
  `${gelesen.length} durchgelassen`);
pruefe("Und von ihm bleiben nur Zahlen und ein bekannter Name",
  Object.keys(gelesen[0]).sort().join(",") === "bis,kategorie,von",
  "die Beschreibung des Dienstes wird nicht mitgenommen");

const skript = sponsorblock.skipScript(gelesen, { videoId: "abc12345678" });
pruefe("Im Skript steht nichts aus der fremden Antwort",
  !skript.includes("onerror") && !skript.includes("</script>"),
  "was hineingeht, hat die Pruefung ueberlebt");
pruefe("Auch die Videokennung wird gesaeubert",
  !sponsorblock.skipScript([], { videoId: "a\";alert(1);//" }).includes("alert(1)"));
pruefe("Keine unerwartete Antwort bringt den Leser zum Werfen",
  [null, undefined, 0, "kein json", {}, { error: "x" }, [{}], [{ segments: null }]]
    .every((fall) => {
      try {
        return Array.isArray(sponsorblock.segmenteAus(fall, "abc12345678"));
      } catch (fehler) {
        console.log("   wirft bei:", JSON.stringify(fall), "->", fehler.message);
        return false;
      }
    }));

// --- Die Entscheidung: springen oder nicht ----------------------------------
//
// Der Fall aus der Aufgabe: 45,2 bis 71,8 Sekunden. Steht die Wiedergabe bei
// 46, wird auf 71,8 gesprungen - und danach nicht noch einmal.

const drei = [
  { von: 45.2, bis: 71.8, kategorie: "sponsor" },
  { von: 300, bis: 330, kategorie: "selfpromo" },
  { von: 600, bis: 640, kategorie: "outro" }
];

pruefe("Mitten im Segment wird gesprungen",
  sponsorblock.sprungFuer(drei, 46, [])?.bis === 71.8);
pruefe("Am Anfang des Segments ebenfalls",
  sponsorblock.sprungFuer(drei, 45.2, [])?.bis === 71.8);
pruefe("Davor nicht",
  sponsorblock.sprungFuer(drei, 44, []) === null);
pruefe("Am Ziel des Sprungs nicht noch einmal",
  sponsorblock.sprungFuer(drei, 71.8, []) === null,
  "sonst loeste der Sprung sich selbst wieder aus");
pruefe("Und kurz davor auch nicht mehr",
  sponsorblock.sprungFuer(drei, 71.4, []) === null,
  "der Rest ist kuerzer als die Ungenauigkeit des Players");
pruefe("Mehrere Segmente in einem Video werden alle erkannt",
  sponsorblock.sprungFuer(drei, 46, [])?.kategorie === "sponsor"
  && sponsorblock.sprungFuer(drei, 305, [])?.kategorie === "selfpromo"
  && sponsorblock.sprungFuer(drei, 610, [])?.kategorie === "outro");
pruefe("Sponsor und Eigenwerbung stehen nebeneinander",
  sponsorblock.gefiltert(drei, {}).map((eintrag) => eintrag.kategorie).join(",")
    === "sponsor,selfpromo",
  "das Outro faellt heraus, solange es aus ist");
pruefe("Mit eingeschaltetem Outro sind es drei",
  sponsorblock.gefiltert(drei, { outro: true }).length === 3);
pruefe("Ausgeschaltet bleibt nichts uebrig",
  sponsorblock.gefiltert(drei, { enabled: false }).length === 0,
  "und ohne Segmente springt das Skript nie");

// --- Zurueckspulen: der Benutzer gewinnt ------------------------------------

pruefe("Ein Segment, das ausgenommen ist, wird nicht mehr uebersprungen",
  sponsorblock.sprungFuer(drei, 46, [0]) === null,
  "sonst kaeme niemand mehr dorthin");
pruefe("Die anderen gelten weiter",
  sponsorblock.sprungFuer(drei, 305, [0])?.kategorie === "selfpromo");
pruefe("Wer zurueckspult, landet in einem bekannten Segment",
  sponsorblock.rueckkehrFuer(drei, 50) === 0
  && sponsorblock.rueckkehrFuer(drei, 310) === 1);
pruefe("Ausserhalb wird nichts ausgenommen",
  sponsorblock.rueckkehrFuer(drei, 100) === -1
  && sponsorblock.rueckkehrFuer(drei, 71.8) === -1);

// --- Das Skript -------------------------------------------------------------

pruefe("Es horcht auf timeupdate statt auf einen eigenen Zeitgeber",
  /media\.addEventListener\("timeupdate", pruefen\)/.test(skript)
  && !/setInterval/.test(skript),
  "der Player schickt es ohnehin viermal je Sekunde");
pruefe("Waehrend der YouTube-Werbung wird nicht gesprungen",
  /ad-showing/.test(skript) && /if \(!zustand\.segmente\.length \|\| werbung\(\)\) return;/.test(skript),
  "dort gehoert die Zeitachse dem Spot");
pruefe("Es haengt sich nur einmal ein",
  /if \(window\.__elfixSponsorblock\) return window\.__elfixSponsorblock\.aktualisieren/.test(skript),
  "sonst loeste jeder Videowechsel den Sprung doppelt aus");
pruefe("Beim Videowechsel gelten die Ausnahmen des vorigen nicht mehr",
  /if \(naechste\.videoId !== zustand\.videoId\)/.test(skript));
pruefe("Die Meldung nimmt keine Klicks an ausser auf dem Knopf",
  /pointerEvents: "none"/.test(skript) && /pointerEvents: "auto"/.test(skript));
pruefe("Und sie holt sich nie den Fokus",
  !/\.focus\(\)/.test(skript),
  "auf dem Fernseher wuerde sie sonst die Steuerung an sich reissen");
pruefe("Sie verschwindet von selbst",
  /setTimeout\(verstecken, 6000\)/.test(skript));
pruefe("Rueckgaengig nimmt genau dieses Segment aus",
  /if \(zustand\.aus\.indexOf\(letzter\.index\) < 0\) zustand\.aus\.push\(letzter\.index\);/.test(skript));
pruefe("Ohne Hinweis wird nichts eingeblendet",
  /if \(!zustand\.hinweis\) return;/.test(sponsorblock.skipScript(gelesen, { hinweis: false })));
pruefe("Abschalten raeumt die Segmente weg",
  /__elfixSponsorblock\.abschalten\(\)/.test(sponsorblock.abschaltenScript()));

// --- Die Verkabelung am Rechner ---------------------------------------------

pruefe("Gefragt wird nur bei einer YouTube-Adresse",
  /if \(!isLiveView\(view\) \|\| !youtube\.istYoutubeUrl\(url\)\) return;/.test(MAIN),
  "andere Anbieter sind davon nicht betroffen");
pruefe("Ohne Kategorie keine Anfrage",
  /if \(!kennung\?\.id \|\| !kategorien\.length\) \{/.test(MAIN));
pruefe("Die Anfrage hat ein Zeitlimit",
  /AbortSignal\.timeout\(SPONSORBLOCK_FRIST_MS\)/.test(MAIN),
  "ein Video darf nicht darauf warten, dass jemand anderes antwortet");
pruefe("Und ein Gedaechtnis, auch fuer das Nichtergebnis",
  /sponsorblockCache\.set\(kennung, \{ segmente, zeit: Date\.now\(\) \}\)/.test(MAIN)
  && /Date\.now\(\) - gemerkt\.zeit < SPONSORBLOCK_ALTER_MS/.test(MAIN),
  "sonst faellt bei jedem Takt eine Anfrage an, die genauso ausgeht");
pruefe("Jeder Fehler endet als \"keine Segmente\"",
  /} catch \{[\s\S]{0,400}?\n  \}\n  sponsorblockCache\.set/.test(MAIN),
  "kein Netz, kein Treffer, unerwartete Antwort - die Wiedergabe merkt nichts");
pruefe("Nach dem Laden wird geprueft, ob noch dasselbe Video laeuft",
  /if \(youtube\.videoKennung\(view\.webContents\.getURL\(\)\)\?\.id !== kennung\.id\) return;/.test(MAIN),
  "sonst gehoerten die Segmente zu einem Video, das hier nicht mehr steht");
pruefe("Der Videowechsel ohne Neuladen wird mitgenommen",
  /installSponsorblock\(view, url\)\.catch/.test(MAIN)
  && /installSponsorblock\(view, view\.webContents\.getURL\(\)\)\.catch/.test(MAIN),
  "YouTube wechselt das Video, ohne die Seite neu zu laden");
pruefe("Der Schalter wirkt sofort, nicht erst beim naechsten Video",
  /if \(activeView\) \{\s*\n\s*installSponsorblock\(activeView/.test(MAIN));
pruefe("Gelesen wird die Antwort in einem Modul ohne Netz",
  /const sponsorblock = require\("\.\/sponsorblock"\);/.test(MAIN),
  "sonst liesse sich das Lesen nicht ohne den Dienst pruefen");

// --- Und die Einstellungen --------------------------------------------------

pruefe("Sieben Schalter, wie besprochen",
  ["sponsorblockEnabled", "sponsorblockSponsor", "sponsorblockSelfpromo",
    "sponsorblockInteraction", "sponsorblockIntro", "sponsorblockOutro",
    "sponsorblockHinweis"].every((name) => HTML.includes(`id="${name}"`)));
pruefe("Sie werden gespeichert",
  /settings\.sponsorblock = Object\.fromEntries/.test(RENDERER)
  && /sponsorblock: sponsorblock\.einstellungenLesen\(raw\?\.sponsorblock\)/.test(MAIN),
  "und ueberstehen damit den Neustart");
pruefe("Und beim Start wieder angezeigt",
  /feld\.checked = settings\.sponsorblock\?\.\[name\] \?\? SPONSORBLOCK_STANDARD\[name\]/.test(RENDERER));
pruefe("Der Standard steht in der Ablage einer frischen Installation",
  /sponsorblock: \{ \.\.\.sponsorblock\.STANDARD \}/.test(MAIN));
pruefe("Und die Einstellungssuche findet sie",
  /"SponsorBlock", "Sponsor Werbung überspringen YouTube/.test(RENDERER));

// --- Und die YouTube-Watchparty ---------------------------------------------
//
// Beide Skripte haengen an demselben <video>. Die Runde darf davon nichts
// kaputtgehen, und umgekehrt darf die Runde nicht gegen den Sprung anlaufen.
//
// Geloest ist das ohne Sonderregel: der Sprung ist ein gewoehnliches "seeked",
// der Horcher der Runde meldet ihn wie jedes andere, und alle springen mit.
// Was dagegen nicht passieren darf, ist ein unterdruecktes Echo - dann wuesste
// das Relay nichts von dem Sprung und zoege den Player in den Sponsorenblock
// zurueck.

const SYNC = fs.readFileSync(path.join(WURZEL, "src/youtube-sync.js"), "utf8").replace(/\r/g, "");

pruefe("Die beiden Skripte fassen einander nicht an",
  /window\.__elfixSponsorblock/.test(skript) && !/__elfixYt/.test(skript)
  && !/__elfixSponsorblock/.test(SYNC),
  "getrennte Merker, getrennte Wege");
pruefe("Der Sprung wird der Runde nicht verheimlicht",
  !/__elfixYtErwartet/.test(skript),
  "sonst zoege die Runde den Player in den Sponsorenblock zurueck");
pruefe("Und der Horcher der Runde meldet ihn als das, was er ist",
  /horchen\("seeked", \(media\) => melden\("seek", media\)\);/.test(SYNC),
  "ein Sprung im Player ist ein Sprung, egal wer ihn ausgeloest hat");
pruefe("Zieht die Runde in ein Segment, wird nicht dagegen gesprungen",
  sponsorblock.rueckkehrFuer(drei, 50) === 0
  && sponsorblock.sprungFuer(drei, 50, [sponsorblock.rueckkehrFuer(drei, 50)]) === null,
  "sonst spraengen zwei Programme gegeneinander an");
pruefe("Waehrend der Werbung meldet auch die Runde nichts",
  /ad-showing/.test(SYNC) && /ad-showing/.test(skript),
  "dort gehoert die Zeitachse dem Spot - beiden Skripten gleichermassen");

// --- Und dieselbe Sache auf Android und am Fernseher -------------------------
//
// Geprueft wird hier nur die Verkabelung: dass Android dasselbe Modul benutzt
// und nicht ein zweites daneben. Was gerechnet wird, steht oben und gilt fuer
// beide - genau darum geht der Umweg ueber den Kern.

const ANDROID = path.join(WURZEL, "..", "android");
const lies = (teil) => fs.readFileSync(path.join(ANDROID, teil), "utf8").replace(/\r/g, "");
const GRADLE = lies("app/build.gradle");
const BRUECKE = lies("app/src/main/assets/kern/eigen/sponsorblock-bruecke.js");
const JAVA = lies("app/src/main/java/local/elflix/android/Sponsorblock.java");
const ACTIVITY = lies("app/src/main/java/local/elflix/android/MainActivity.java");

pruefe("Das Modul liegt im Paket der App",
  /"src\/sponsorblock\.js",/.test(GRADLE),
  "sonst faende der Kern es nicht - und Android haette eine zweite Regel");
pruefe("Die Bruecke entscheidet nichts selbst",
  /require\("sponsorblock"\)/.test(BRUECKE) && /require\("youtube"\)/.test(BRUECKE)
  && !/actionType|segment\[0\]/.test(BRUECKE),
  "sie holt und reicht weiter, mehr nicht");
pruefe("Auch dort wird nur bei YouTube gefragt",
  /if \(!youtube\.istYoutubeUrl\(url\)\) return "";/.test(BRUECKE));
pruefe("Der Abruf hat ein Zeitlimit",
  /mitFrist\(fetch\(adresse/.test(BRUECKE),
  "der fetch des Kerns kennt kein signal - also ein Wettlauf gegen die Uhr");
pruefe("Und ein Gedaechtnis, auch fuer das Nichtergebnis",
  /gedaechtnis\.set\(videoId, \{ segmente, zeit: Date\.now\(\) \}\)/.test(BRUECKE));
pruefe("Ein Fehler endet als \"kein Skript\"",
  /} catch \(fehler\) \{[\s\S]{0,200}?return "";/.test(BRUECKE),
  "die Wiedergabe darf davon nie etwas merken");

pruefe("Die Schalter liegen in den Einstellungen des Geraets",
  /getSharedPreferences\(PREFS, Context\.MODE_PRIVATE\)/.test(JAVA)
  && /"sponsorblock_" \+ name/.test(JAVA),
  "damit ueberstehen sie den Neustart");
pruefe("Intro und Outro sind auch dort aus",
  /!"intro"\.equals\(name\) && !"outro"\.equals\(name\)/.test(JAVA));
pruefe("Und das Skript kommt aus dem Kern, nicht aus Java",
  /kern\.rufe\("sponsorblock-bruecke\.skript"/.test(JAVA)
  && !/currentTime|timeupdate/.test(JAVA),
  "ein Java-Gegenstueck zu skipScript waere die zweite Fassung");
pruefe("Ein leeres Ergebnis geht nicht in die Seite",
  /if \(skript\.isEmpty\(\)\) return;/.test(JAVA),
  "leer heisst: hier laeuft kein YouTube");

pruefe("Am Telefon wird beim Rahmen mit Video eingespielt",
  /if \(sponsorblock != null && youtube != null && youtube\.istYoutube\(seite\)\) \{/.test(ACTIVITY));
pruefe("Der Videowechsel ohne Neuladen wird auch dort mitgenommen",
  /public void doUpdateVisitedHistory\(WebView view, String url, boolean istNachladen\)/.test(ACTIVITY)
  && /sponsorblock\.einspielen\(view, url\);/.test(ACTIVITY),
  "es gibt dann kein onPageFinished und keinen neuen Rahmen");
pruefe("Die Meldung wird gelesen wie am Rechner",
  /sponsorblock\.istMeldung\(text\)/.test(ACTIVITY));
pruefe("Die sieben Schalter stehen auch auf dem Fernseher",
  /private void sponsorblockKarten\(LinearLayout koerper, boolean fernseher, int luecke\)/.test(ACTIVITY)
  && (ACTIVITY.match(/sponsorblockKategorie\(koerper/g) || []).length === 5,
  "dieselbe Karte fuer Telefon und Fernseher - lebendeKarte kennt beides");
pruefe("Und der Schalter wirkt dort ebenfalls sofort",
  /private void sponsorblockNachziehen\(\)/.test(ACTIVITY));

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
