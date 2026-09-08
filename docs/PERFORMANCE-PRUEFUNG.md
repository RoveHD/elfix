# Performance-Prüfung nach ELFIX 2.0.19

Stand: 8. September 2026. Die folgenden Befunde sind von der veröffentlichten Version 2.0.19 zu unterscheiden.

## Umgesetzte Vorschau-Korrektur

Die Desktop-Zeitleiste setzt ihren Abruf nicht mehr bei jeder Mausbewegung zurück. Ein Auftrag darf fertig werden; anschließend wird nach frühestens 90 ms das neueste Ziel verarbeitet. Bereits sichtbare Bilder bleiben beim Nachladen stehen. Weicht die Position des dargestellten Bildes vom Mausziel ab, nennt der Hinweis beide Zeiten. Mausbewegungen werden für das Layout auf einen Aufruf pro Animationsframe zusammengefasst. Quellenwechsel und Verlassen räumen Timer, Decoder und ausstehende Layout-Aufträge auf.

Verifiziert mit allen zwölf Electron-Suiten, der Vorschau-Unit-Suite, 79 Player-Prüfungen, Lint und `git diff --check`. Der neue Electron-Test erzeugt während fortlaufender Pointer-Events unterschiedliche echte rote/blaue Videobilder und prüft, dass weder Hauptvideo noch Watchparty dabei gespult werden. Die Veröffentlichung 2.0.19 enthält diesen nachträglichen Fix noch nicht.

## Miniplayer und Fensterbewegung

ELFIX verwendet Chromiums natives Bild-in-Bild-Fenster. Die Messung bewegte dessen tatsächliches Windows-Fenster mit kontrollierten Mauseingaben und erfasste die Fensterposition. Hardwarebeschleunigung war nach der Initialisierung aktiv; die Windows-Einstellung zur Darstellung des Fensterinhalts beim Ziehen war ebenfalls bereits eingeschaltet.

Im gepaarten Vergleich lagen die Abstände der Positionsänderungen ohne zusätzliche Last bei 16,0 ms im Median, 31,6 ms am 95. Perzentil und maximal 32,8 ms. Mit absichtlich erzeugten Hauptprozess-Pausen von 140 ms alle 300 ms stiegen das 95. Perzentil auf 141,4 ms und das Maximum auf 155,9 ms. Das reproduziert das Stocken des gesamten Fensters durch Hauptprozess-Blockaden. Es ist kein Nachweis, dass jede vom Nutzer beobachtete Unterbrechung genau aus einem bestimmten Cache-Auftrag stammt.

Im dritten Durchlauf lief derselbe künstliche 140-ms-Auftrag durch den neuen Cache-Aufschub. Während PiP wurden null Schreibvorgänge ausgeführt; nach dem Ausstieg genau einer mit dem neuesten Stand (Revision 69). Das 95. Perzentil der Positionsabstände sank auf 16,6 ms. Ein einzelner Ausreißer von 140,8 ms blieb bestehen: Die regelmäßig erzeugten Schreibpausen wurden verhindert, vollständige Ruckelfreiheit unter jeder Systemlast ist damit nicht bewiesen. Die aggregierten Messwerte stehen in `build/history-perf/miniplayer-drag-metrics.json`.

Der gezielte Fix verschiebt ausschließlich das Serialisieren und Schreiben des Empfehlungs- und Metadaten-Caches, solange der Miniplayer aktiv ist. Ein bereits vorher gestarteter Timer prüft diese Sperre ebenfalls. Die Daten werden im Speicher weiter aktualisiert; beim Beenden des Miniplayers oder Schließen des Players wird der neueste Stand über die bisherigen gebündelten Schreibwege nachgeholt. Beim direkten Beenden der gesamten App werden die ausstehenden Caches einmal synchron gespeichert und die Timer entfernt. Favoriten, Wiedergabefortschritt und Watchparty-Persistenz werden nicht ausgesetzt. Andere mögliche Hauptprozess-Blockaden werden damit nicht pauschal beseitigt.

Die zusätzliche Suite `cache-schreibaufschubtest` prüft bereits geplante Timer, Änderungen während PiP, gebündeltes Nachholen des neuesten Standes und App-Ende ohne doppelte Schreibvorgänge. Die unabhängige Codeprüfung bestätigte außerdem Initialisierungsreihenfolge, schnelle Ein-/Ausstiegswechsel und die bestehende IPC-Absenderprüfung.

## Gemessene Kosten

Die vorhandenen JSON-Dateien wurden nur gelesen. Schreibmessungen liefen auf temporären Kopien im Arbeitsverzeichnis, nicht auf dem Benutzerprofil. Die Kopien wurden anschließend entfernt. Es handelt sich um isolierte lokale Messungen, nicht um eine vollständige Aufzeichnung der laufenden App.

| Vorgang | Datenmenge | Median | Maximum |
| --- | ---: | ---: | ---: |
| Favoriten serialisieren, 25 Durchläufe | 721 KB, 130 Einträge | 3,07 ms | 4,96 ms |
| Favoritenkopie synchron schreiben | 721 KB | 1,07 ms | 2,19 ms |
| Metadaten serialisieren und synchron schreiben, 15 Durchläufe | 6,07 MB | 41,98 ms | 137,14 ms |
| Empfehlungscache serialisieren und synchron schreiben, 15 Durchläufe | 7,51 MB | 41,18 ms | 50,41 ms |

Zum Zeitpunkt dieser Ausgangsmessung liefen die großen Cache-Schreibvorgänge im Electron-Hauptprozess (`src/main.js`, `saveTasteCacheSoon`, `metadatenSpeichernSoon`). Die Verzögerung von 1,5 beziehungsweise 2 Sekunden bündelt Aufträge, macht das anschließende Serialisieren und Schreiben aber nicht asynchron. Das kann die native Fensterbedienung unterbrechen. Ein konkreter Nachweis, dass genau diese Vorgänge das gemeldete Miniplayer-Ruckeln auslösen, steht aus.

## Beauftragte allgemeine Verbesserungen

1. **Cache-Arbeit aus dem Hauptprozess verlagern.** Serialisierung und Schreiben getrennt messen; nur `fs.promises.writeFile` beseitigt die JSON-Kosten nicht. Schreibaufträge zusammenfassen, ältere Stände nicht über neuere schreiben lassen und Dateien atomar ersetzen. Mit Ereignisschleifen-Latenz während des Speicherns sowie Wiederherstellung nach Schreibfehlern prüfen.
2. **Android-Listen mit begrenzter Zahl sichtbarer Ansichten.** `MainActivity.entdeckungKartenAnhaengen` hängt weitere Karten an; die Listenansicht erzeugt alle Einträge in einem Durchlauf. Die Bildverwaltung entlastet Bitmaps, aber nicht die wachsende Zahl von Views. Recycling oder kleine Aufbauetappen können große Bibliotheken und längeres Scrollen verbessern. Vorher/nachher mit 50, 200 und 500 Einträgen auf Handy und TV messen.
3. **Veraltete Suchen abbrechen und identische Suchen kurz cachen.** Desktop-`searchAllProviders`/`searchProvider` lässt alte Provider-Abfragen weiterlaufen; die Oberfläche verhindert vor allem die Anzeige alter Ergebnisse. Abbruch bis in den Netzwerkabruf weiterreichen und einen begrenzten Cache pro Anbieter und Suchtext verwenden. Langsame Antworten, schnelle Suchwechsel und die Zahl der Abrufe testen.
4. **Watchparty-Ersatzabfrage bei zuverlässigen Seitenmeldungen aussetzen.** `meldeWatchpartyStand` liest die Anbieteransicht regelmäßig erneut aus. Den Ersatzweg erst bei ausbleibenden Meldungen aktivieren; Wiederaufnahme und unterschiedliche Hoster müssen weiter funktionieren. Das ist ein Codebefund, keine bereits gemessene Einsparung.

Die anschließende Umsetzung dieser vier Punkte ist unten dokumentiert. Geräteabgleich und Watchparty behalten ihre bisherigen Speicherwege.

## Branch-Bereinigung

19 alte lokale Branches entfernt: 17 vollständig in `main` enthaltene Arbeitsbranches, ein bereits patchgleich integrierter Sicherungsbranch und ein überholter Player-Prototyp. Die beiden zuletzt genannten Branch-Spitzen sind vorab in `build/history-perf/obsolete-branches-20260908.bundle` gesichert; `git bundle verify` war erfolgreich. Die Ausgangsliste liegt daneben in `branches-before-cleanup.txt`. Das Bundle benötigt die im Repository bereits vorhandene gemeinsame Historie.

Nach der weiteren Prüfung wurden auch die Dependabot-PRs #11–15 integriert und ihre Branches entfernt. Lokal und auf GitHub verbleibt `main`. Die folgenden Änderungen sind für Release 2.0.20 vorgesehen.


## Umsetzung am 8. September 2026

### Miniplayer und Navigation

Windows fordert beim Minimieren des Hauptfensters natives PiP an, wenn das eigene Video tatsächlich spielt. Ein pausiertes Video wird nicht gestartet. Vorbereitung und bestätigter PiP-Eintritt sind getrennte IPC-Phasen: erst die native Bestätigung blendet die Player-View aus und öffnet die Startseite. Die View, Quelle und Watchparty-Sitzung bleiben erhalten. Startseite, Suche und Mediathek verwenden weiter denselben internen Navigationsweg, ohne diese Wiedergabe zu schließen. Eine besuchte Anbieterseite kann die Player-Statusmeldungen nicht überschreiben.

Die Fokusverlust-Pause entscheidet nach dem Fensterwechsel; dadurch kann Windows' Reihenfolge blur/minimize den PiP-Start nicht abbrechen. Bei minimiertem Vollbild wird das Vollbild erst beim Wiederherstellen verlassen, da Windows sonst das Hauptfenster sofort wieder öffnen würde. Das Schließen von PiP im weiterhin minimierten Fenster berücksichtigt die vorhandene Pause-Einstellung.

Android Phone setzt ab Android 12 den automatischen PiP-Zustand bei Änderungen der tatsächlichen Wiedergabe. Android 8–11 verwenden den bestehenden Verlassen-Hook. Native Pause und Abmeldung der Watchparty werden erst in onStop entschieden, damit onPause während des PiP-Übergangs nichts unterbricht. Android TV bekommt kein automatisches Telefon-PiP.

### Allgemeine Performance

- **Optionale Caches:** Ein Worker serialisiert und schreibt Empfehlungs- und Metadaten-Cache atomar. Ein aktiver Auftrag und höchstens ein wartender Stand je Datei verhindern unbeschränktes Aufstauen. Die neueste Fassung gewinnt; Fehler erhalten die bisher gültige Datei. Beim App-Ende wartet eine begrenzte Barriere auf dieselbe Schreibkette. Die Bündelung von 1,5/2 Sekunden und der PiP-Aufschub bleiben bestehen. Favoriten, Verlauf und Raumdaten wurden nicht in diesen optionalen Kanal verschoben.
- **Android-Entdeckungsraster:** Ab 60 Karten werden nur die Zeilen rund um den sichtbaren Bereich aufgebaut. Überlappende Karten und deren Bilder werden wiederverwendet. Abstandshalter erhalten die Scrollhöhe; Nachladen außerhalb des Fensters erweitert dessen Höhe ohne Karten-Neuaufbau. TV-Zielkarten werden vor einem D-pad-Wechsel materialisiert, Fokus bleibt an einer vorhandenen Karte. Kleine Listen behalten ihren vollständigen Aufbau. Diese Optimierung betrifft das Entdeckungsraster, nicht pauschal alle Listen der App.
- **Suche:** Abbruchsignale reichen durch Ajax, HTML-Fallback und Suchvarianten. Veraltete Renderer-Anfragen werden beim Tippen oder Verlassen verworfen. Identische laufende Anfragen werden geteilt; erfolgreiche Antworten liegen zwölf Sekunden in einem Cache mit maximal 24 Einträgen. Schlüssel berücksichtigen die Anbieterkonfiguration. Fehler werden nicht gespeichert, eine Gesamtabfrage hat zwölf Sekunden Zeit. Tests decken auch verspätete interne Navigation ab.
- **Watchparty:** Frische Seitenmeldungen setzen die zusätzliche Frame-Abfrage aus. Nach vier Sekunden ohne Meldung wird der bestehende Fünf-Sekunden-Takt wieder nutzbar. Parallele sowie verspätete Antworten nach Navigation, Raum- oder Sitzungswechsel werden verworfen. Der eigene Player verwendet seinen vorhandenen direkten Meldeweg, auch im Miniplayer.

### Messungen und Grenzen

Im kontrollierten Test der echten Hauptprozess-Funktionen entfallen bei 120 regelmäßigen Statusmeldungen über zwei Minuten alle 24 zusätzlichen Frame-Abfragen. Das ist eine Ablaufmessung mit kontrollierter Uhr, keine pauschale Aussage über Netzlast aller Hoster.

Ein 7,22-MB-Cache benötigte im ersten Gesamtlauf 24,1 ms für das strukturierte Klonen; danach liefen sieben Timer-Ticks während der Worker-Arbeit. Die synchrone Vergleichsarbeit benötigte 29,3 ms und ließ keinen Timer laufen. Unter paralleler Build-/Testlast stiegen beide Werte auf 79,3 beziehungsweise 152,6 ms. Das Klonen bleibt eine Hauptprozess-Pause; der Worker allein garantiert keine durchgehend flüssige Fensterbewegung. Genau deshalb bleibt der PiP-Aufschub aktiv.

### Verifikation

- Dreizehn Electron-Suiten bestanden. Der neue Miniplayer-Test verwendet einen echten BrowserWindow, WebContentsView, den echten Player samt Preload und natives Chromium-PiP mit lokal erzeugten bewegten Videobildern. Geprüft werden Minimieren, Pause, Fokusverlust, Navigation bei laufendem Video, Rückkehr, Vollbild und veraltete Antworten. Die Navigationsoberfläche im Test ist eine kleine lokale Fixture; das vollständige Benutzerprofil wird nicht verändert.
- Der erste gesamte Node-/Relay-Lauf bestand 136 von 141 Suiten. Ein VM-Test musste die neue Miniplayer-Hilfsfunktion laden; vier alte Relay-Fixtures teilten vor der bestätigten Geräteanmeldung. Die Fixtures warten jetzt auf den autorisierten Zustand; die Wiedergabeprüfungen wurden nicht abgeschwächt. Die Wiederholungen bestehen: Direktregression 21/21, Mitschauen 61/61, Android-Watchparty 36/36, Direktparty 34/34 und Drei-Geräte-Matrix 53/53. Die beiden zusätzlich registrierten Suchtests bestehen ebenfalls. Die Protokolle unterscheiden den ersten Gesamtlauf von diesen gezielten Wiederholungen.
- Neue Suchprüfungen: Koordinator 12/12, echter HTTP-Suchweg 4/4 und Renderer-Rennen 3/3. Cache-Tests prüfen atomare Dateien, Fehler, Wiederholung, Queue-Grenzen und den letzten Stand beim Beenden.
- Android-Unit-Tests (292 Tests in 32 Testklassen, keine Fehler) und Debug-/Instrumentation-Build bestehen. Auf dem angeschlossenen Fire TV besteht EntdeckungGeraeteTest mit 3/3: 50/200/500 Karten, Teilzeilen-Nachschlag, 60-Karten-Schwelle und D-pad-Fokus über das anfängliche Fenster hinaus. Die separate Debug-App wurde auf TV und Handy installiert; die Release-Daten bleiben unverändert. Der reale Phone-PiP-Test ist wegen der PIN-Sperre des Handys noch offen.

Protokolle stehen unter build/history-perf/performance-*.log. Die Änderungen werden mit Release 2.0.20 veröffentlicht; der tatsächliche Veröffentlichungsstatus ist auf GitHub zu prüfen.
