# Player-Komfort und zusammengefasste Suche

Stand: 8. September 2026. Geprüfte Erweiterungen für Version 2.0.19.

## Bedienung

- **Windows:** „Mini-Player“ öffnet das vorhandene Video als natives Bild-in-Bild-Fenster. Der Hauptplayer bleibt für Quellenwahl, Chat und weitere Einstellungen zuständig. Die optionale Pause beim Fokusverlust wird während Bild-in-Bild ausgesetzt. Watchparty-Play/Pause behält die gemeinsame Startlogik.
- **Android-Handy:** Bild-in-Bild ist bei unterstütztem Gerät während der Wiedergabe über den Mini-Player und beim Wechsel zu einer anderen App verfügbar. Android TV erhält keinen zusätzlichen PiP-Knopf.
- **Handy-Gesten:** Doppel-Tap auf die linke/rechte Hälfte springt zehn Sekunden zurück/vor. Horizontales Wischen zeigt den relativen Sprung; erst Loslassen übernimmt die Position. Abbrechen verwirft den Sprung. Watchparty-Gäste können damit keine Host-Beschränkung umgehen.
- **Bildvorschau:** Auf Windows zeigt die Zeitleiste beim Überfahren eine echte Videominiatur sowie Position und gegebenenfalls Intro/Rückblick/Abspann/Vorschau. Beim Ziehen bleibt die Hauptwiedergabe bis zum Loslassen unverändert. Android verwendet einen separaten stummen Decoder für die Vorschau beim Ziehen/Wischen.
- **Untertitel:** Die ausdrückliche Wahl wird anhand von Sprache und Bezeichnung gespeichert, nicht anhand einer wechselnden Spurnummer. Sprachcode-Aliase und regionale Varianten werden berücksichtigt. Eine fehlende Sprache löscht die Präferenz nicht; „Aus“ bleibt ausgeschaltet.
- **Suche:** Passende Treffer verschiedener Anbieter erscheinen gemeinsam. Anbieterwahl, Zieladresse, Bild und Watchlist beziehen sich weiter auf den jeweiligen Anbieter. YouTube bleibt getrennt.

## Grenzen und Ressourcen

Die Bildvorschau ist optional und darf die Wiedergabe nicht blockieren. Fehlende Seek-Unterstützung, Decoderfehler und Zeitüberschreitungen führen zu einer Zeitangabe ohne Bild beziehungsweise schließen die Android-Vorschau. Es werden keine Vorschaubilder aus fremden Episoden verwendet.

Desktop: 150 ms Verzögerung vor dem Abruf, höchstens ein aktiver Auftrag und der neueste wartende Wunsch, 16 kleine Bilder im Speicher, Zwei-Sekunden-Raster, drei Sekunden Zeitlimit. Progressive HTTP-Quellen müssen einen Byte-Range-Probeabruf unterstützen. HLS lädt eine niedrige Qualitätsstufe mit begrenztem Puffer und eigener Zeitachsen-Verankerung. Beim Verlassen oder Quellenwechsel werden die Vorschau-Abspieler und offene Abrufe aufgeräumt.

Android: 150 ms Verzögerung, separater stummer Media3-Player ohne Ton-/Textspuren, begrenzter Puffer und drei Sekunden Zeitlimit bis zum ersten dargestellten Bild. Die angebotene niedrigere Auflösung hängt von der Quelle ab. Ohne alternative Videospur muss auch eine kleine Vorschau die Originalspur dekodieren. Die Hauptwiedergabe wird nicht zum Erzeugen eines Vorschaubilds bewegt.

Die Suche nutzt die bereits vorliegenden Titel und belastbaren IDs. Sie startet keine zusätzlichen Metadatenabfragen. Jahr, Inhaltstyp, Staffel/Folge und YouTube-Sonderfälle verhindern offensichtliche Fehlgruppierungen. Abweichende Titel ohne passende bestätigte ID können weiterhin getrennt erscheinen.

Es wurde keine neue externe Abhängigkeit eingeführt. Ein nativer WebOS-Client ist in dieser Codebasis nicht vorhanden.

Die Android-Lebenszyklusbehandlung folgt der [offiziellen PiP-Dokumentation](https://developer.android.com/develop/ui/views/picture-in-picture): sichtbare Wiedergabe kann während `onPause` fortbestehen; `onStop` beendet die sichtbare Wiedergabe und pausiert sie.

## Relevante Dateien

- Desktop: `src/renderer/spieler.js`, `spieler.html`, `spieler-vorschau.js`, `src/untertitelwahl.js`, `src/main.js`, `src/spieler-preload.js`.
- Suche: `shared/search-grouping.js`, `src/renderer/renderer.js`, `styles.css`, `index.html`.
- Android: `DirektSpieler.java`, `DirektWiedergabe.java`, `SpielerVorschau.java`, `SucheGruppen.java`, `MainActivity.java`, `AndroidManifest.xml`.
- Tests: `untertitelwahltest.js`, `spielervorschautest.js`, `searchgroupingtest.js`, `playerkomfort-electrontest.js`, `spielervorschau-electrontest.js`, `searchgroup-electrontest.js`, `komfort-video.js`, `DirektSpielerFrameTest.java`, `SucheGruppenTest.java`, `DirektSpielerGeraeteTest.java`, `MainActivityPipGeraeteTest.java` sowie bestehende Player-Testumgebungen.

Die separaten Skip-Datenquellen und ihre API-/Cache-Dokumentation stehen in `SKIP-SEGMENTE.md`.

## Verifikation

- `npm test`: 136 Node-/Relay-Suiten erfolgreich; darunter die bestehenden gemeinsamen Start-, Pause-, Seek- und Standbildtests.
- `npm run test:electron`: zwölf Electron-Suiten erfolgreich. Die neuen Tests öffnen ein echtes natives Mini-Fenster, prüfen Untertitelwechsel und testen Videominiaturen anhand selbst erzeugter roter/blauer Frames. Hauptwiedergabe und Watchparty-Seeks bleiben während der Vorschau unverändert; Loslassen erzeugt genau einen Seek. Gruppierte Suchkarten werden im tatsächlichen DOM mit Maus, Tastatur und einem verspäteten Watchlist-Ergebnis geprüft.
- `npm run lint` und `git diff --check`: erfolgreich.
- Lokales Windows-Paket gebaut; sieben relevante Dateien in `app.asar` byteweise mit dem aktuellen Quellstand verglichen.
- Samsung SM-S928B über USB: echte Videovorschau mit Media3 getestet und Screenshot visuell geprüft. Die Miniatur zeigt Frame 1353 des Testvideos, während das Hauptvideo noch Frame 9 darstellt. Eine `TextureView` stellt die kleine Vorschau als normale Ansicht über dem Hauptvideo dar; abweichende Seitenverhältnisse erhalten schwarze Ränder statt Verzerrung.
- Der echte PiP-Test deckte einen Seitenneuaufbau beim Wechsel der Fenstergröße auf. `onConfigurationChanged` lässt jetzt auch den nativen Player bestehen, damit die Startseite ihn beim Eintritt ins Mini-Fenster nicht schließt.
- Android: 289 Unit-Tests ohne Fehler; Debug-APK erfolgreich gebaut und auf dem SM-S928B installiert. Drei gezielte Gerätetests erfolgreich: Gesten/Spulen/Abbruch/Gastrechte, tatsächliche Vorschau mit zwei unterschiedlichen Bildpositionen und Aufräumen, vollständiger MainActivity-PiP-Ablauf einschließlich fortlaufender Wiedergabe, Rückkehr zum selben Player, Pause und Schließen. Die letzte PiP-Prüfung bestand in 8,717 Sekunden.
- Der Fernseher war für diesen abschließenden Durchlauf nicht in ADB verfügbar. TV-spezifische Bedienung wurde im Code und in Android-Unit-Tests berücksichtigt, aber nicht erneut am echten Fernseher bestätigt. Ein vollständiger Test aller externen Hoster beziehungsweise aller HLS-Varianten auf dem Handy ist mit diesen lokalen Medienfixtures nicht abgedeckt.
- Die YouTube-Integrationstests dieser Suite laufen mit Fixtures. Ein erneuter Test gegen die öffentliche YouTube-Seite ist nicht Teil dieses Komfort-Arbeitsstands.
