"use strict";
// Die Verdrahtung des eigenen Players.
//
// Ein Player besteht hier aus vier Teilen, die einander nicht kennen: einer
// Seite (renderer/spieler.html), ihrem Skript (renderer/spieler.js), einer
// Bruecke (spieler-preload.js) und dem Hauptprozess (main.js). Zwischen ihnen
// liegen lauter Zeichenketten - Element-Kennungen, Kanalnamen, ein Dateipfad
// zu hls.js. Keine davon faellt beim Uebersetzen auf; sie fallen auf, wenn
// jemand vor einem schwarzen Bild sitzt.
//
// Genau diese Nahtstellen werden hier geprueft, und nur sie. Wie sich ein
// Video anfuehlt, kann kein Test beantworten - ob der Knopf, den das Skript
// sucht, in der Seite auch steht, dagegen schon.

const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..");
const lies = (datei) => fs.readFileSync(path.join(WURZEL, datei), "utf8");

const seite = lies("src/renderer/spieler.html");
const skript = lies("src/renderer/spieler.js");
const bruecke = lies("src/spieler-preload.js");
const haupt = lies("src/main.js");

const pruefungen = [];
const pruefe = (name, bedingung, detail = "") => {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? "OK  " : "FAIL"}  ${name}${detail ? "   -> " + detail : ""}`);
};

const alle = (text, muster) => [...text.matchAll(muster)].map((treffer) => treffer[1]);

/* -------------------------------------------------------------- Die Seite */

// hls.js kommt aus node_modules und wird von der Seite als Datei geladen. Ein
// Paket, das seine Dateien umbenennt, faellt sonst erst im Betrieb auf - und
// zwar als Player, der bei jeder HLS-Quelle "fehlt der Abspieler" sagt.
const hlsPfad = /<script src="([^"]*hls[^"]*\.js)"/.exec(seite)?.[1] || "";
pruefe("Die Seite laedt hls.js von einem Pfad",
  Boolean(hlsPfad),
  hlsPfad);
pruefe("Und diese Datei liegt wirklich dort",
  Boolean(hlsPfad) && fs.existsSync(path.join(WURZEL, "src", "renderer", hlsPfad)),
  path.join("src/renderer", hlsPfad));
pruefe("hls.js steht als Abhaengigkeit in der package.json",
  Boolean(JSON.parse(lies("package.json")).dependencies["hls.js"]),
  "sonst fehlt es nach npm ci --omit=dev in der gebauten App");

const kennungen = [...new Set(alle(skript, /getElementById\("([^"]+)"\)/g))];
const fehlend = kennungen.filter((kennung) => !seite.includes(`id="${kennung}"`));
pruefe("Jedes Element, das das Skript sucht, steht in der Seite",
  fehlend.length === 0,
  fehlend.join(", ") || `${kennungen.length} geprüft`);

pruefe("Die Seite laedt ihr eigenes Skript",
  seite.includes('<script src="spieler.js"></script>'));

/* ------------------------------------------------------------- Die Bruecke */

// Was das Skript an der Bruecke aufruft, muss die Bruecke auch anbieten. Der
// Ersatz oben in spieler.js (das leere Objekt) faengt ein fehlendes `window`
// ab - aber nicht eine Bruecke, die eine Sache weniger kann als gedacht.
const genutzt = [...new Set(alle(skript, /\bbruecke\.(\w+)\(/g))];
const angeboten = alle(bruecke, /^\s*(\w+):/gm);
const unbekannt = genutzt.filter((name) => !angeboten.includes(name));
pruefe("Die Bruecke kann alles, was das Skript von ihr verlangt",
  unbekannt.length === 0,
  unbekannt.join(", ") || genutzt.join(", "));
pruefe("Der Ersatz kennt dieselben Namen",
  genutzt.every((name) => new RegExp(`${name}\\(\\)\\s*\\{\\}`).test(skript)),
  "ohne window.elfixSpieler darf das Skript nicht schon beim Laden umfallen");

/* --------------------------------------------------------- Die Kanaele */

const gesendet = [...new Set(alle(bruecke, /ipcRenderer\.send\("([^"]+)"/g))];
const gehoert = alle(haupt, /ipcMain\.on\("(spieler:[^"]+)"/g);
const ungehoert = gesendet.filter((kanal) => !gehoert.includes(kanal));
pruefe("Jede Meldung der Bruecke hat im Hauptprozess einen Empfaenger",
  ungehoert.length === 0,
  ungehoert.join(", ") || gesendet.join(", "));

const empfangen = alle(bruecke, /ipcRenderer\.on\("([^"]+)"/g);
pruefe("Und was die Bruecke erwartet, schickt der Hauptprozess auch",
  empfangen.every((kanal) => haupt.includes(`send("${kanal}"`)),
  empfangen.join(", "));

// Die Nachfragen des Players (Folgenliste, Wechsel, Hoster) gehen ueber
// invoke und brauchen drueben ein handle. Ein fehlendes handle faellt zur
// Laufzeit als abgewiesenes Versprechen auf - also hier.
const gefragt = [...new Set(alle(bruecke, /ipcRenderer\.invoke\("([^"]+)"/g))];
const unbeantwortet = gefragt.filter((kanal) => !haupt.includes(`ipcMain.handle("${kanal}"`));
pruefe("Jede Nachfrage des Players wird im Hauptprozess beantwortet",
  unbeantwortet.length === 0,
  unbeantwortet.join(", ") || gefragt.join(", "));

pruefe("Die Oberflaeche kann den Player starten und beenden",
  /startDirekt:/.test(lies("src/preload.js"))
  && haupt.includes('ipcMain.handle("direkt:starten"')
  && haupt.includes('ipcMain.handle("direkt:beenden"'));

/* ------------------------------------------------- Was nicht passieren darf */

// Jede Meldung aus der Player-Ansicht wird gegen deren webContents geprueft.
// Ohne das koennte jede beliebige Seite der App Fortschritt verbuchen - und
// eine Anbieterseite ist fremder Code.
const stellen = alle(haupt, /ipcMain\.on\("spieler:[^"]+", \((\w+)/g);
pruefe("Es gibt Empfaenger fuer die Meldungen des Players",
  stellen.length >= 4,
  String(stellen.length));
const abschnitt = haupt.slice(haupt.indexOf('ipcMain.on("spieler:bereit"'));
const bereich = abschnitt.slice(0, abschnitt.indexOf('ipcMain.handle("direkt:starten"'));
const empfaenger = bereich.split('ipcMain.on("spieler:').slice(1);
// Geprueft wird entweder von Hand oder ueber `vomSpieler` - und dass dieser
// Pruefer wirklich den Absender vergleicht, steht gleich darunter. Ohne beides
// koennte jede beliebige Seite der App Fortschritt verbuchen; eine
// Anbieterseite ist fremder Code.
const bewacht = (teil) => teil.includes("ereignis.sender !== spielerView.webContents")
  || teil.includes("vomSpieler(ereignis)");
pruefe("Jeder von ihnen prueft, dass die Meldung wirklich vom Player kommt",
  empfaenger.length > 0 && empfaenger.every(bewacht),
  `${empfaenger.length} Empfänger`);
pruefe("Und der gemeinsame Pruefer vergleicht wirklich den Absender",
  /function vomSpieler\(ereignis\) \{[\s\S]*?ereignis\.sender === spielerView\.webContents/.test(haupt));
const nachgefragt = haupt.split('ipcMain.handle("spieler:').slice(1);
pruefe("Auch jede Nachfrage wird auf ihren Absender geprueft",
  nachgefragt.length > 0 && nachgefragt.every((teil) => teil.includes("vomSpieler(ereignis)")),
  `${nachgefragt.length} Nachfragen`);

// Die Watchparty laeuft jetzt gegen den eigenen Player: er meldet seinen Takt,
// meldet seine Taten und nimmt Befehle entgegen. Die Entscheidungen dahinter
// bleiben in watchparty-sync.js - dieselben, die auf dem Telefon fallen.
pruefe("Der Player meldet seinen Takt und seine Taten in die Runde",
  haupt.includes('ipcMain.on("spieler:takt"') && haupt.includes('ipcMain.on("spieler:aktion"')
  && haupt.includes("meldeWatchpartyStandAusSpieler"));
pruefe("Befehle der Runde erreichen ihn, bevor sie in die Ansichten gehen",
  haupt.includes("if (spielerLauf && await spielerSteuernAusRunde(eintrag, nachricht, urteil, binHost)) return;"));
pruefe("Gerechnet wird mit den Regeln der Runde und nicht mit eigenen",
  haupt.includes("watchpartySync.zielZeitBerechnen(ereignis, watchparty.serverJetzt(eintrag.room))")
  && haupt.includes("watchpartySync.driftEntscheiden(spielerDrift"),
  "sonst entschiede der Rechner anders als das Telefon");
pruefe("Was aus der Runde kam, geht nicht als eigene Tat zurueck",
  skript.includes("if (!inRunde || ausRunde()) return;"),
  "sonst haette jede Pause eine Antwort und die Antwort eine Antwort");

pruefe("Der Player wird geschlossen, wenn die Folge verlassen wird",
  haupt.includes('direktSpielerSchliessen("navigation")')
  && haupt.includes('direktSpielerSchliessen("startseite")'));

pruefe("Die Ansicht dahinter schweigt, solange der eigene Player laeuft",
  haupt.includes("setAudioMuted(true)"),
  "sonst laeuft ein Werbevideo der Anbieterseite unsichtbar mit");

// Die Webpruefung faellt nur dort, wo sie fallen muss - und die Ansicht, in
// der sie faellt, laesst nichts Fremdes herein. Beides gehoert zusammen: die
// Ausnahme ist nur so viel wert wie ihre Eingrenzung.
pruefe("Die Webpruefung faellt an genau einer Stelle",
  (haupt.match(/webSecurity:\s*false/g) || []).length === 1,
  String((haupt.match(/webSecurity:\s*false/g) || []).length));
pruefe("Und diese Ansicht bleibt bei ihrer eigenen Seite",
  haupt.includes('if (!String(ziel || "").startsWith("file://")) ereignis.preventDefault();'),
  "keine fremde Adresse in einer Ansicht ohne Webpruefung");

pruefe("Der Player laeuft in einer eigenen Sitzung",
  haupt.includes('const SPIELER_PARTITION = "persist:elfix-spieler"')
  && haupt.includes("spielerSessionHolen()"),
  "die Kopfzeilen der Quelle haben in der Sitzung der Anbieter nichts zu suchen");

/* --------------------------------------------- Was kein Fehler sein darf */

// `play()` wird abgelehnt, sobald vor der Einloesung etwas anderes am Video
// passiert - beim Tippen auf Pause, beim Hosterwechsel, und wenn der Browser
// ohne Zutun keinen Ton zulaesst. Beides ist kein Fehlschlag der Quelle.
// Vorher stand deshalb "Die Quelle spielt nicht" ueber einer sichtbar
// laufenden Folge, mit dem Rat, einen anderen Hoster zu nehmen.
pruefe("Ein abgebrochenes play() gilt nicht als kaputte Quelle",
  /HARMLOSE_ABLEHNUNG\s*=\s*\[[^\]]*"AbortError"/.test(skript)
  && /HARMLOSE_ABLEHNUNG\s*=\s*\[[^\]]*"NotAllowedError"/.test(skript),
  "AbortError und NotAllowedError");
pruefe("Und die Ablehnung wird wirklich vor dem Aufgeben geprueft",
  /HARMLOSE_ABLEHNUNG\.includes\(String\(fehler\?\.name[\s\S]{0,220}?aufgeben\(/.test(skript),
  "sonst stuende die Pruefung da und der Kasten trotzdem");
pruefe("Ein echter Fehler kommt weiterhin an",
  /aufgeben\(String\(fehler\?\.message \|\| fehler\), "play"\)/.test(skript),
  "entschaerfen heisst nicht verschlucken");

/* ------------------------------------------------ Nächste Folge und Autoplay */

// Der Player zaehlte bis zum letzten Stand immer herunter und schaltete um -
// ohne die Einstellung "Nächste Folge von selbst starten" und ohne "Danach
// aufhören" zu kennen. Beide enden im Hauptprozess bei derselben Zahl
// (autoplayZaehler); der Player fuehrt sie nur aus.
pruefe("Der Auftrag traegt den Zaehler zur naechsten Folge",
  /weiterZaehler: spielerZaehler\(\)/.test(haupt)
  && /function spielerZaehler\(\)[\s\S]{0,200}?autoplayZaehler\(/.test(haupt),
  "die Entscheidung faellt im Hauptprozess, nicht im Player");
pruefe("Und autoplayZaehler kennt beide Wege zu 'gar nicht'",
  /autoplayNextEpisode === false\) return 0;/.test(haupt)
  && /stopNachFolge\.get\(provider\?\.id\) === url\) return 0;/.test(haupt),
  "die Einstellung gilt dauerhaft, 'Danach aufhören' fuer eine Folge");
pruefe("Der Player liest den Zaehler aus dem Auftrag",
  /weiterZaehler = Number\.isFinite\(Number\(auftrag\.weiterZaehler\)\)/.test(skript));
pruefe("Ohne Zaehler laeuft nichts von selbst",
  /if \(!naechste \|\| weiterUhr \|\| weiterZaehler <= 0\) return;/.test(skript),
  "aber der Knopf bleibt - so steht es auch in den Einstellungen");
pruefe("Der Uebergang faengt so frueh an, wie der Zaehler lang ist",
  /bild\.duration - stelle <= weiterZaehler \+ 1/.test(skript),
  "sonst zaehlt er fuenf und beginnt nach acht");
pruefe("Der Knopf zur naechsten Folge haengt nicht am Zaehler",
  /function weiterKnopfZeigen\(\)[\s\S]{0,700}?const dran = prozent >= weiterAbProzent;/.test(skript)
  && !/knopfWeiter\.hidden = weiterZaehler/.test(skript),
  "er steht auch dann da, wenn Autoplay aus ist - er haengt an der Stelle, nicht am Zaehler");
pruefe("Und er erscheint erst gegen Ende, wie der alte",
  /weiterAbProzent = Number\.isFinite\(Number\(auftrag\.weiterAbProzent\)\)/.test(skript)
  && /weiterAbProzent: NEXT_EPISODE_PROMPT_PERCENT/.test(haupt),
  "dieselbe Schwelle wie am Knopf in der Anbieterseite, und sie steht nur einmal");
pruefe("Die Schwelle ist die alte",
  /const NEXT_EPISODE_PROMPT_PERCENT = 90;/.test(haupt));

/* --------------------------------- Was am Hoster-Rahmen hing und jetzt fehlte */

// Zwei Funktionen liefen frueher ueber die Anbieteransicht und waren mit dem
// eigenen Player still ausgefallen.

pruefe("Die Fernbedienung sieht den eigenen Player",
  /if \(spielerLauf\) \{[\s\S]{0,900}?fernbedienung\.standMelden\(/.test(haupt),
  "vorher las sie nur activeView - und dort laeuft seit der Direktwiedergabe nichts");
pruefe("Und sie bekommt Stelle und Dauer auch ohne Watchparty",
  /spielerLetzterStand = \{/.test(haupt) && /spieler:stand/.test(haupt),
  "spieler:takt laeuft nur in einer Runde");
pruefe("Der Stand des Players wird beim Schliessen vergessen",
  /spielerLauf = null;\s+spielerLetzterStand = null;/.test(haupt),
  "sonst zeigte die Fernbedienung eine Folge, die nicht mehr laeuft");

// Ein Film hat keine Folgenidentitaet. Wer zwei davon vergleicht, vergleicht
// undefined mit undefined - und der erste Film des Anbieters passt auf jeden
// anderen. So stand ueber "Prey" der Titel "Inception".
pruefe("Der Eintrag zu einer Adresse wird an einer Stelle gesucht",
  /function favoritZuAdresse\(provider, url\)/.test(haupt));
pruefe("Eine Folge ueber ihre Identitaet, ein Film ueber seine Adresse",
  /if \(identity\) return episodeIdentity\(favorite\.url\)\?\.key === identity\.key;[\s\S]{0,160}?normalizeFavoriteUrl\(favorite\.url\) === normalizeFavoriteUrl\(url\)/.test(haupt));
pruefe("Und niemand vergleicht mehr zwei fehlende Identitaeten",
  !/episodeIdentity\(favorite\.url\)\?\.key === identity\?\.key/.test(haupt),
  "genau diese Zeile stand an zwei Stellen");

pruefe("Ein Fassungswechsel im Player merkt sich auch das Wort",
  /roh: gewaehlt\.spracheRoh \|\| ""/.test(haupt),
  "ohne es stuende die gemerkte Fassung ohne Namen da");

/* -------------------------------------------------------- Staffeln wechseln */

pruefe("Die Reiterzeile kommt aus der Staffelliste, nicht aus den Folgen",
  /folgenStand\.staffeln/.test(skript)
  && /const bekannte = Array\.isArray\(folgenStand\.staffeln\)/.test(skript),
  "aus den Folgen gebildet gab es nie mehr als eine Staffel");
pruefe("Ein Klick auf eine ungelesene Staffel holt sie nach",
  /async function staffelOeffnen\(staffel\)/.test(skript)
  && /bruecke\.folgen\(false, ziel\.url\)/.test(skript));
pruefe("Schon gelesene Staffeln werden nicht noch einmal geholt",
  /folgenStand\?\.folgen\?\.some\(\(eintrag\) => eintrag\.staffel === staffel\)/.test(skript),
  "wer hin und her schaltet, soll nicht jedes Mal warten");
pruefe("Die Bruecke reicht die Staffel durch",
  /folgen: \(frisch = false, staffelUrl = ""\)/.test(bruecke));
pruefe("Der Hauptprozess nimmt sie entgegen und prueft sie",
  /ipcMain\.handle\("spieler:folgen", async \(ereignis, frisch = false, staffelUrl = ""\)/.test(haupt)
  && /new URL\(absolut\)\.host === new URL\(url\)\.host/.test(haupt),
  "ein Player darf nicht jede beliebige Seite lesen lassen");

/* ------------------------------------- Der Autoplay-Schalter und der Balken */

pruefe("Der Autoplay-Schalter steht in der Leiste, nicht im Uebergangskasten",
  /id="autoKnopf"/.test(seite)
  && seite.indexOf('id="autoKnopf"') < seite.indexOf('id="weiter"'),
  "im Kasten koennte man ihn ausschalten und nie wieder ein");
pruefe("Er schreibt dieselbe Einstellung wie der in den Einstellungen",
  /ipcMain\.handle\("spieler:autoplay"/.test(haupt)
  && /autoplayNextEpisode: Boolean\(an\)/.test(haupt));
pruefe("Und ein laufender Zaehler in der Anbieterseite spuert es auch",
  /nextEpisodePromptState\.delete\(provider\.id\)[\s\S]{0,120}?nextEpisodeAutostartState\.delete\(provider\.id\)/.test(haupt),
  "sonst zaehlt dort weiter, was hier gerade abgeschaltet wurde");
pruefe("'Danach aufhoeren' gilt nur fuer diese Folge",
  /ipcMain\.handle\("spieler:schluss"/.test(haupt)
  && /stopNachFolge\.set\(provider\.id, spielerLauf\.url\)/.test(haupt),
  "die Einstellung gilt dauerhaft, das hier ist danach wieder weg");
pruefe("Beide Wege enden bei derselben Zahl",
  /function spielerZaehler\(\)/.test(haupt)
  && (haupt.match(/return spielerZaehler\(\);/g) || []).length >= 2,
  "der Player soll die Regel nicht ein zweites Mal kennen");
pruefe("Der Schalter zeigt seinen Zustand",
  /knopfAuto\.classList\.toggle\("aus", !an\)/.test(skript)
  && /knopfAuto\.textContent = an \? "Autoplay an" : "Autoplay aus"/.test(skript),
  "Farbe allein sagt nur 'irgendwie anders', nicht 'aus'");
pruefe("Und er heisst nicht wie die Qualitaetswahl",
  /auto\.textContent = "Automatisch";/.test(skript)
  && !/knopfAuto\.textContent = "Auto"/.test(skript),
  "zweimal 'Auto' nebeneinander erklaert keines von beiden");
pruefe("Zwischen beiden Gruppen steht ein Strich",
  /class="trenner"/.test(seite)
  && seite.indexOf('class="trenner"') < seite.indexOf('id="autoKnopf"'),
  "links die laufende Folge, rechts die naechste");

pruefe("Der Balken zeigt Gespieltes und Geladenes getrennt",
  /--gespielt/.test(seite) && /--geladen/.test(seite)
  && /function reglerFaerben\(stelle\)/.test(skript));
pruefe("Genommen wird der Puffer, in dem die Stelle liegt",
  /bild\.buffered\.start\(i\) <= stelle && bild\.buffered\.end\(i\) >= stelle/.test(skript),
  "nach einem Sprung stehen mehrere in der Liste");
pruefe("Der Balken bleibt ein Schieberegler",
  /<input id="regler" type="range"/.test(seite),
  "gefaerbt wird der Hintergrund - mit den Pfeiltasten bedienbar bleibt er");

/* ------------------------------------------- Die Karte zur naechsten Folge */

pruefe("Sie ist eine Karte ueber dem Bild, kein Knopf in der Leiste",
  /#weiterKnopf \{[\s\S]{0,120}?position: fixed;/.test(seite)
  && !/id="weiterKnopf"[^>]*>\s*Nächste ›/.test(seite),
  "wie beim alten ELFIX und bei Netflix");
pruefe("Sie nennt die Folge, um die es geht",
  /id="weiterKnopfTitel"/.test(seite)
  && /getElementById\("weiterKnopfTitel"\)\.textContent = naechste\.beschriftung/.test(skript));
pruefe("Sie geht mit den Schichten weg und kommt mit ihnen wieder",
  /schichten = \[[\s\S]{0,600}?getElementById\("weiterKnopf"\)/.test(skript),
  "ein Knopf, der ueber einem laufenden Film stehenbleibt, stoert wie eine Leiste");
pruefe("Beim Erreichen der Schwelle zeigt sie sich einmal von selbst",
  /if \(dran && knopfWeiter\.hidden\) \{[\s\S]{0,260}?schichtenZeigen\(\);/.test(skript),
  "danach richtet sie sich nach der Maus");

pruefe("Ohne Untertitelspuren steht kein Untertitelfeld da",
  /untertitelWahl\.hidden = !hatSpuren;/.test(skript),
  "ein abgeblendetes Feld sieht aus wie eines, das gerade nicht geht");

/* -------------------------------------------------- Der Name der Folge oben */

// Oben stand nur "Serie · Staffel 4 Folge 13" - wo man ist, aber nicht, was
// man sieht. Der Name steht in der Folgenliste, die ohnehin im Hintergrund
// geholt wird; er kostet keinen zusaetzlichen Seitenaufruf.
pruefe("Der Folgentitel wird aus der Liste genommen",
  /direktfolgen\.istLaufende\(eintrag, kennung\)/.test(haupt)
  && /spielerLauf\.folgentitel = String\(laufend\?\.titel \|\| ""\)/.test(haupt));
pruefe("Er reist mit der naechsten Folge zusammen",
  /send\("spieler:naechste", spielerLauf\.naechste, spielerLauf\.folgentitel\)/.test(haupt)
  && /\(_ereignis, naechste, folgentitel\) => rueckruf\(naechste, folgentitel\)/.test(bruecke));
pruefe("Und steht auch im Auftrag, falls der Player neu laedt",
  /folgentitel: spielerLauf\.folgentitel \|\| ""/.test(haupt));
pruefe("Der Kopf setzt ihn hinter Serie und Folge",
  /function kopfTitelSetzen\(basis, folgentitel\)/.test(skript)
  && /\$\{kopfBasis\} · \$\{name\}/.test(skript));
pruefe("Ein leerer Name aendert die Zeile nicht",
  /if \(folgentitel\) kopfTitelSetzen\("", folgentitel\);/.test(skript),
  "bis die Liste da ist, bleibt die Zeile eben kuerzer");

/* ------------------------------------------------- Weiterschauen ohne Frage */

// Wer auf "Weiterschauen" tippt, hat schon entschieden. Bisher landete genau
// dieser Weg in der Auswahl, sobald die gespeicherte Adresse eine Serien- oder
// Staffelseite war - und dann musste man die Folge heraussuchen, bei der man
// ohnehin stehengeblieben war.
pruefe("Ohne Hoster wird zuerst der eigene Stand gesucht",
  /const schluessel = taste\.urlSchluessel\(url\);[\s\S]{0,420}?direktFolgeSpielen\(provider, weiter\.url/.test(haupt),
  "derselbe Schluessel, nach dem auch die Watchparty zwei Adressen vergleicht");
pruefe("Und zwar nur, wenn dort wirklich eine Folge steht",
  /&& episodeIdentity\(favorite\.url\)/.test(haupt),
  "eine Serienseite als Ziel waere dieselbe Sackgasse noch einmal");
pruefe("Die gespeicherte Stelle reist mit",
  /startzeit: sanitizePositiveNumber\(weiter\.currentTime \|\| weiter\.position\)/.test(haupt));
pruefe("Die Auswahl bleibt der Rueckfall",
  /if \(ergebnis\.ok\) return;\s*\}\s*console\.log\("\[ELFIX DIREKT\] kein Hoster[\s\S]{0,120}?await direktAuswahlOeffnen\(provider, url, \{ signal \}\);/.test(haupt),
  "ohne Eintrag, ohne Folgenadresse oder ohne Quelle");

/* ------------------------------------------- Die Seite wird einmal gelesen */

// Der Fehler, den erst der Lauf gegen die echte App zeigte: "Weiterschauen"
// endete in der Auswahl, obwohl auf der Seite zwoelf Hosterkacheln standen.
//
//   [ELFIX DIREKT] .../staffel-4/episode-11: 12 Hosterkachel(n)
//   [ELFIX DIREKT] keine Quelle (Kein Hoster auf der Seite) - Auswahl
//
// direktUebernehmen liest die Kacheln, oeffnet damit den Player - und danach
// las direktQuelleFuerAnsicht dieselbe Seite noch einmal. Zu diesem Zeitpunkt
// liegt der Player davor und das Skript kommt nicht mehr durch.
pruefe("Gelesene Kacheln werden weitergereicht",
  /direktFolgeSpielen\(provider, url, \{\s*links, signal, fullscreen: Boolean\(optionen\.fullscreen\)/.test(haupt),
  "sonst liest die zweite Runde eine Seite, die niemand mehr sieht");
pruefe("Und drueben auch benutzt",
  /const alle = Array\.isArray\(optionen\.links\)[\s\S]{0,120}?: await direktLinksLesen\(provider, view\);/.test(haupt));
pruefe("Ein misslungener Lesevorgang wird nicht als 'keine Hoster' getarnt",
  /Kacheln nicht lesbar/.test(haupt),
  "von aussen sah beides gleich aus");
pruefe("Welchen Weg der Direktbetrieb nimmt, steht im Log",
  /Hosterkachel\(n\)/.test(haupt)
  && /kein Hoster auf der Seite - es bleibt bei der Auswahl/.test(haupt)
  && /es bleibt bei der Auswahl/.test(haupt),
  "drei Ausgaenge, die von aussen gleich aussahen");

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`
${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
