# Skip-Segmente im eigenen ELFIX-Player

Stand der API-Prüfung: 8. September 2026. Es werden ausschließlich öffentliche
Lesezugriffe verwendet. Keine API-Keys, Anmeldung, Schreibzugriffe oder neuen
externen Dependencies. YouTube/SponsorBlock bleibt ein separates System.

Die Zeitleiste markiert belegte Abschnitte auf Desktop, Handy und Android TV:
Intro türkis, Rückblick orange, Abspann violett und Vorschau rosa. Die
Desktop-Zeitleiste benennt beim Überfahren den Abschnitt samt Zeitbereich;
außerhalb der Markierungen zeigt der Hinweis die Zeitposition.
Die
Skip-Buttons behalten ihre bisherige Darstellung. „Nächste Folge“ erscheint
ab Beginn eines belegten Abspanns und bleibt danach verfügbar. Ohne gültige
Abspann-Daten gilt die bisherige 90-%-Schwelle. Der Autoplay-Countdown wird
dadurch nicht vorgezogen. Beim Quellenwechsel oder Ausschalten der
Skip-Erkennung verschwinden die alten Markierungen.

Nachprüfung der Zeitleistenfarben und Abspann-Karte: echter Electron-Player-Test
bestanden (alle vier Farben, Segmentposition, frühe/späte Abspann-Schwelle,
90-%-Fallback und Quellenwechsel); 14 bestehende Electron-Bedienungsprüfungen
und 79 statische Player-Prüfungen bestanden. Android: 285 Tests ohne Fehler.
Die Karte blendet die Bedienung beim Erreichen der Schwelle einmal ein,
auch auf Handy und TV. Diese Ergänzungen wurden noch nicht am physischen
Handy oder Fernseher visuell geprüft und sind nicht veröffentlicht.

## Verifizierte Quellen und Endpoints

| Quelle | Tatsächlicher GET-Endpoint | Identität / Parameter | Ohne Key |
| --- | --- | --- | --- |
| AniSkip | `https://api.aniskip.com/v2/skip-times/{mal}/{episode}` | MAL-ID, Episode innerhalb des MAL-Eintrags; wiederholtes `types=op`, `types=ed`, `types=recap`; `episodeLength` in Sekunden | Ja |
| SkipDB | `https://api.skipdb.tv/api/segments` | `imdb_id`; Episoden zusätzlich `season`, `episode`, Filme ohne beide; `duration` in Sekunden, `adjust=conservative` | Ja |
| IntroDB | `https://api.introdb.app/segments` | `imdb_id`, `season`, `episode`; ausschließlich Episoden | Ja |
| TheIntroDB | `https://api.theintrodb.org/v3/media` | Vorzugsweise `tmdb_id`, sonst `tvdb_id` oder `imdb_id`; Episoden zusätzlich `season`, `episode`; `duration_ms` | Ja |

Offizielle Verträge:

- [AniSkip OpenAPI](https://api.aniskip.com/api-docs) und
  [versionierter Controller samt Modellen](https://github.com/aniskip/aniskip-api/blob/main/src/skip-times/skip-times.controller.v2.ts).
- [SkipDB API](https://skipdb.tv/docs) und [Datenexport](https://skipdb.tv/data).
- [IntroDB API](https://introdb.app/docs/api) und [OpenAPI](https://api.introdb.app/openapi.json).
- [TheIntroDB OpenAPI](https://theintrodb.org/openapi.yaml) und
  [offizieller Client](https://github.com/TheIntroDB/theintrodb-npm).

IntroDB und TheIntroDB sind unterschiedliche Dienste. AniSkip verwendet
Sekunden, die übrigen Adapter wandeln die dokumentierten Millisekundenfelder
in Sekunden um. Schreib- und Nutzerfunktionen dieser Dienste sind nicht Teil
der Integration. Für TheIntroDB wird kein optionaler Schlüssel angefordert.

## Reihenfolge und Datenprüfung

- Anime-Episoden: AniSkip → SkipDB → IntroDB → TheIntroDB.
- Serien: SkipDB → IntroDB → TheIntroDB.
- Filme: SkipDB → TheIntroDB.

Die Reihenfolge gilt je Segmenttyp. Eine nachrangige Quelle ergänzt fehlende
Typen, ersetzt aber keinen bereits plausiblen Treffer. Quellen ohne benötigte
ID werden nicht angefragt. Abfragen laufen innerhalb eines Inhalts nacheinander;
dadurch entfallen unnötige Fallback-Requests. Verschiedene Inhalte dürfen mit
begrenzter Parallelität laden. Der Filmstart wartet auf keine dieser Abfragen.

Intern: `{ type, start, end, source, confidence }`, Sekunden und die Typen
`intro`, `recap`, `outro`, `preview`. Fehlende Quellen-Konfidenz bleibt `null`.
Ein ausdrücklicher Beleg für einen nicht vorhandenen Abschnitt von SkipDB oder
TheIntroDB wird als
`absent: true` gespeichert; er ist kein sichtbarer Knopf und wird nicht durch
einen nachrangigen Treffer oder ein gelerntes Intro ersetzt.

Es gibt keine gemittelten Zeitgrenzen. Nahezu gleiche Abschnitte innerhalb
einer Quelle werden mit zwei Sekunden Grenztoleranz zusammengefasst; bei
überlappenden Varianten entscheidet die verfügbare Quellen-Konfidenz, dann
eine stabile Reihenfolge. Zwischen Quellen entscheidet die obige Priorität.
Widersprüchliche überlappende Typen aus nachrangigen Quellen werden verworfen.
Nicht endliche, negative, leere oder außerhalb der Videolänge liegende Intervalle
erzeugen keinen Knopf. Antwort-Identitäten werden, soweit mitgeliefert, geprüft.

AniSkip-Mischsegmente `mixed-op`/`mixed-ed` werden nicht angeboten, weil sie
Handlung enthalten können. Die gemeldete Episodenlänge muss bis auf zwei
Sekunden zur abgespielten Datei passen. ELFIX skaliert oder verschiebt sie nicht.
SkipDBs `out-of-range` wird verworfen; dessen dokumentierte serverseitige
konservative Anpassung wird übernommen, ohne ein zweites Mal zu verschieben.
Der Schätzwert `intro_length_estimate_ms` wird nicht verwendet. IntroDB liefert
keine verlässliche Editions-/Offsetzuordnung; hier gelten die Rohzeiten und die
Videogrenzen. TheIntroDB erhält die echte Laufzeit, kann laut Vertrag aber
trotzdem auf die Fassung mit den meisten Einsendungen zurückfallen. Die Antwort
enthält keine gewählte Fassungslänge; ein Editionsabgleich ist damit nicht
garantiert. Dokumentierte offene Grenzen werden bei Intro/Rückblick mit
Videobeginn und bei Abspann/Vorschau mit Videoende aufgelöst.

## Vorhandene IDs und Metadaten

`empfehlungslauf.skipKontext()` liest zuerst die bereits vorhandenen Anbieter-
und Metadatencaches. Anbieter-IMDb sowie sicher zugeordnete (`HIGH`/`EXACT`)
MAL-, AniList-, TMDB-, IMDb- und TVDB-IDs werden wiederverwendet. Bereits im
TMDB-Anhang mitgelieferte TVDB-IDs gehen beim Normalisieren nicht mehr verloren;
dafür wird kein zusätzlicher API-Request eingeführt.

Fehlen IDs, wird ausschließlich die schon vorhandene Metadatenauflösung mit
ihrem Cache, ihrer Deduplizierung und Ausfallsperre benutzt. Keine neue
Titel-/ID-Suchmaschine, kein neuer Anbieter-Seitenabruf und keine neue
TMDB-Key-Anforderung. Ein vorhandenes Relay kann weiterhin seine bisherige
Metadatenkonfiguration verwenden. Ohne passende IDs bleibt die Skip-Liste leer.
AniList-IDs sind selbst keine Episoden-IDs für AniSkip.

Die aktuelle ELFIX-Metadatenzuordnung kennt noch keine verifizierte Abbildung
aller Anbieter-Staffeln auf einzelne MAL-Cours. Daher wird die Haupttitel-MAL-ID
nur für Staffel 1 und innerhalb einer bekannten Episodenzahl verwendet.
Weitere Staffeln können über IMDb-/TMDB-Quellen Segmente erhalten. Anime-Filme
unter einem Franchise erhalten niemals dessen Serien-ID; dafür ist eine
gesonderte Filmidentität nötig. Unsichere Zuordnungen erzeugen keine geratenen
Skip-Zeiten.

## Cache und Fehlerverhalten

- Höchstens 512 Einträge; Cache-Schlüssel enthält Inhaltstyp, IDs,
  Staffel/Episode/MAL-Episode und Videolänge.
- Erfolgreiche Ergebnisse: 7 Tage. Keine Daten: 6 Stunden.
  Abruf-/API-Fehler einschließlich Teilausfällen: 5 Minuten.
- Identische laufende Inhalts- und URL-Abfragen werden zusammengelegt.
- Höchstens drei gleichzeitige HTTP-Abfragen; 3 Sekunden Zeitlimit je Quelle,
  auch wenn ein Netzwerkadapter das Abort-Signal ignoriert.
- `429` berücksichtigt `Retry-After` und sperrt weitere Abrufe zum selben Host;
  ohne diese Angabe gilt eine Pause von einer Minute. Kein unbeschränkter Retry.
- Antwortgröße ist begrenzt. Ungültiges JSON, Fehler, Timeouts und beschädigte
  Cache-Dateien bleiben ohne Auswirkung auf die Wiedergabe.
- Desktop: `ELFIX/skipsegmente-cache.json`. Android: `skipsegmente.json` im
  bestehenden Kern-Zwischenspeicher, mit derselben Cache-Struktur.

Kein neuer Relay-Cache oder Dump-Importer: Der am Prüftag angebotene SkipDB-Dump
hat rund 30,2 MB und 101.952 Datensätze, darunter auch nicht freigegebene Stände.
Der dokumentierte API-Dump-Pfad war beim Prüfen nicht erreichbar; die Website
verlinkte den veröffentlichten Export. Einzelabfragen vermeiden Download,
Indexierung und Replikation der gesamten Datenbank auf jedem Endgerät. Die
Datenquelle bleibt SkipDB mit ihrer [ODbL-/Reciprocity-Lizenz](https://skipdb.tv/docs).

## Player und Plattformen

Der vorhandene Knopf wird wiederverwendet: „Intro überspringen“, „Rückblick
überspringen“, „Abspann überspringen“, „Vorschau überspringen“. Sichtbar nur in
`start <= currentTime < end`; ein Klick verwendet den vorhandenen Spulweg ans
Ende. Kein automatisches Überspringen und kein zusätzlicher Autoplay-Countdown.
Watchparty erhält eine normale Seek-Aktion. Solche Sprünge werden nicht als
neue manuell gelernte Intros gewertet. Gelernte Intros bleiben ein getrennt
abschaltbarer Fallback.

Desktop verwendet die gemeinsame Auswahl direkt; Android/Phone und Android TV
verwenden dieselben normalisierten Daten im vorhandenen Media3-Player. Die
native Auswahl pro Positionsaktualisierung braucht keinen zusätzlichen
WebView-Aufruf. Wenn ein fokussierter Skip-Knopf verschwindet, geht der Fokus
auf Play. Quellenwechsel, geänderte Laufzeiten und Ausschalten verwerfen
unpassende Antworten.

Im Repository existiert kein WebOS-Player oder WebOS-Build. Das gemeinsame
JavaScript-Modul ist auch im Browser nutzbar; eine tatsächliche WebOS-Anbindung
wird nicht behauptet. In fremden Hoster-Webseiten bleibt der bisherige gelernte
Intro-Weg bestehen; die neue öffentliche Segmenterkennung gilt für den eigenen
Desktop-/Media3-Player.

## Validierung

Die automatischen Prüfungen stehen in `skipsegmentetest.js`,
`skipintegrationtest.js`, `skipspielerelectrontest.js` und
`DirektSpielerFrameTest.java`. Sie prüfen Quellenformate, Priorität, fehlende
IDs/Daten, Ausfälle, Cache, Deduplizierung, Laufzeiten, Inhaltstypen,
Quellenwechsel, Ausschalten, Fokus und den bestehenden Watchparty-Spulweg.
Der echte Electron-Player startet auch bei einer noch ausstehenden
Skip-Antwort. Bestehende Electron-Player-/Sicherheits-/YouTube-Tests werden
zusätzlich ausgeführt.

Öffentliche Live-Proben ohne Schlüssel: AniSkip MAL 9253/Episode 1 mit
1418,624 Sekunden liefert ein Intro von 638,489 bis 728,489 Sekunden.
SkipDB IMDb tt0903747/S1E1 mit 3500 Sekunden liefert Intro 229,5–246,5 und
Abspann 3434–3500 Sekunden. Ergebnisse können sich mit der Community-Datenbasis
ändern; die normalen Tests verwenden deshalb dokumentationsgetreue Fixtures.

## Geänderte Dateien

- android/app/build.gradle
- android/app/src/main/assets/kern/eigen/empfehlung-bruecke.js
- android/app/src/main/assets/kern/eigen/skipsegmente-bruecke.js
- android/app/src/main/assets/kern/kern-knoten.js
- android/app/src/main/java/local/elflix/android/DirektSpieler.java
- android/app/src/main/java/local/elflix/android/DirektWiedergabe.java
- android/app/src/main/java/local/elflix/android/MainActivity.java
- android/app/src/test/java/local/elflix/android/DirektSpielerFrameTest.java
- android/kryptoprobe/KnotenProbe.js
- docs/SKIP-SEGMENTE.md
- StreamingBrowserElectron/package.json
- StreamingBrowserElectron/src/empfehlungslauf.js
- StreamingBrowserElectron/src/main.js
- StreamingBrowserElectron/src/renderer/index.html
- StreamingBrowserElectron/src/renderer/renderer.js
- StreamingBrowserElectron/src/renderer/spieler.html
- StreamingBrowserElectron/src/renderer/spieler.js
- StreamingBrowserElectron/src/skipsegmente.js
- StreamingBrowserElectron/src/spieler-preload.js
- StreamingBrowserElectron/tests/appearanceeditortest.js
- StreamingBrowserElectron/tests/knotentest.js
- StreamingBrowserElectron/tests/run.js
- StreamingBrowserElectron/tests/skipintegrationtest.js
- StreamingBrowserElectron/tests/skipsegmentetest.js
- StreamingBrowserElectron/tests/skipspielerelectrontest.js
- StreamingBrowserElectron/tests/spielertest.js
- sync-server/metadaten.js

Ergebnis des Abschlusslaufs: 133 Node-/Relay-Suiten bestanden, vollständige
Electron-Suite bestanden, 16 gezielte Quellenprüfungen bestanden, 281 Android-Tests
mit null Fehlern und null ausgelassenen Tests; Debug-APK und Windows-Testbuild
erfolgreich erstellt. Der zusätzliche Android-HMAC-Fix wurde am echten Handy
mit erfolgreichem Raumbeitritt in der getrennten Test-App bestätigt.

## Zusätzlich gemeldeter Android-Raumbeitrittsfehler

Die Android-Krypto-Brücke gab für `digest("base64")` einen Buffer statt eines
Strings wie Node zurück. Der HMAC-Nachweis brach dadurch vor dem Raumbeitritt
ab. `kern-knoten.js` korrigiert die Rückgabeform ohne Änderung des Nachweises
oder Abschwächung der Identitätsprüfung. Die neue Krypto-Regressionsprobe
prüft vier Fälle; die Java-Kryptovektoren bestehen mit 17/17.

Am physischen SM-S928B zeigte die getrennte Test-App danach „Verbunden“, trat
dem Raum `test` bei und erkannte ein weiteres Gerät. Die Test-App wurde danach
entfernt. Die installierte Release-App 2.0.18 und ihre Daten blieben unverändert.
Der Fire TV war nicht über ADB erreichbar. Lokal liegt kein Release-Keystore;
ein Update der installierten Apps benötigt deshalb die regulär signierte APK
aus dem bestehenden GitHub-Release-Workflow. Es wurde nichts veröffentlicht.
